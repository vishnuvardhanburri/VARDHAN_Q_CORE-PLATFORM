/**
 * VARDHAN — PUBLIC DATASET PROVIDER
 * ─────────────────────────────────────────────────────────────────────────────
 * Ingests structured public company datasets (e.g. the companydatacom/public-datasets
 * city business registries: Paris, London, Berlin, Amsterdam, Madrid, Rome, NYC, LA).
 *
 * These datasets are FIRMGRAPHIC only — no person contact data, no domains.
 * Company resolution relies on name + DomainResolver later in the pipeline.
 *
 * License: CC0 (Creative Commons Zero) per the dataset READMEs.
 * No scraping, no CAPTCHA bypass, no private data.
 */
import type { CanonicalCompany, CanonicalPerson, CanonicalContact, Provenance, SourceEntry, SourceCategory } from './Model';
import type { ProviderCapabilities } from './ProviderInterface';
import { CompanyDataProvider } from './ProviderInterface';
import type { ProviderCostClass } from '../IntelligenceCase';
import { CSVProvider, type CsvSchema, type CsvImportResult } from './CSVProvider';

/**
 * Schema for the companydatacom/public-datasets city business CSVs.
 * These are semicolon-delimited, but we normalize via the generic CSV provider
 * by accepting any delimiter.
 */
const CITYDATA_SCHEMA: CsvSchema = {
  company:         ['company name', 'companyname'],
  domain:          ['website', 'url', 'homepage', 'domain', 'site'],
  industry:        ['business category code 1 - description', 'business_category_description', 'sic_description'],
  employee_count:  ['employees total', 'employees_total', 'employees'],
  employee_growth_pct: ['employee_growth'],
  funding:         ['total_funding', 'funding'],
  valuation:       ['valuation'],
  primary_person_name: ['ceo name', 'ceo_name', 'primary_person_name'],
  primary_title:   ['job_title', 'title', 'ceo_title'],
  primary_email:   ['email', 'primary_email'],
  primary_phone:   ['phone', 'primary_phone'],
  linkedin_url:    ['linkedin_url', 'linkedin', 'linkedin_company_profile'],
  revenue:         ['yearly revenue in u.s. dollars', 'yearly_revenue_in_u.s._dollars', 'revenue_usd', 'revenue'],
};

export interface PublicDatasetOptions {
  sourceUrl: string;
  datasetName: string;
  retrievedAt?: string;
  requireDomain?: boolean;
}

export class PublicDatasetProvider extends CompanyDataProvider {
  readonly costClass: ProviderCostClass = 'FREE';
  readonly name = 'public-dataset';
  readonly enabled = true;
  readonly capabilities: ProviderCapabilities = {
    searchCompanies: true, resolveCompany: true, findPeople: false,
    findContacts: false, enrichCompany: true, enrichPerson: false,
    verifyContact: false,
  };

  private readonly csv: CSVProvider;
  private readonly datasetName: string;
  private readonly sourceUrl: string;

  constructor(opts: PublicDatasetOptions) {
    super();
    this.datasetName = opts.datasetName;
    this.sourceUrl = opts.sourceUrl;
    this.csv = new CSVProvider({
      sourceUrl: opts.sourceUrl,
      retrievedAt: opts.retrievedAt,
      schema: CITYDATA_SCHEMA,
      requireDomain: opts.requireDomain,
    });
  }

  /**
   * Parse a CityData-format CSV (semicolon-delimited).
   * Returns canonical companies with source = "PUBLIC_DATASET".
   */
  parseCsv(csvText: string, delimiter: ';' | ',' = ';'): CsvImportResult {
    // CityData CSVs use semicolons; the generic CSVProvider handles quoted
    // fields. We re-parse with semicolon splitting if needed.
    if (delimiter === ';') {
      const result = this.parseSemicolonCsv(csvText);
      // Override the source field to "PUBLIC_DATASET"
      result.companies = result.companies.map(c => ({ ...c, source: 'PUBLIC_DATASET' }));
      return result;
    }
    // Fall back to comma (some datasets may be comma-delimited)
    const result = this.csv.parseCsv(csvText);
    result.companies = result.companies.map(c => ({ ...c, source: 'PUBLIC_DATASET' }));
    return result;
  }

  /** Parse semicolon-delimited CSV with proper quote handling. */
  private parseSemicolonCsv(text: string): CsvImportResult {
    // Strip BOM
    const cleanText = text.replace(/^\uFEFF/, '');
    const rows: string[][] = [];
    let cur = '';
    let row: string[] = [];
    let inQuotes = false;
    for (let i = 0; i < cleanText.length; i++) {
      const ch = cleanText[i];
      if (inQuotes) {
        if (ch === '"') {
          if (cleanText[i + 1] === '"') { cur += '"'; i++; }
          else inQuotes = false;
        } else cur += ch;
      } else if (ch === '"') inQuotes = true;
      else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (ch === '\r') { /* skip */ }
      else if (ch === ';') { row.push(cur); cur = ''; }
      else cur += ch;
    }
    if (cur || row.length > 0 || rows.length > 0) { row.push(cur); rows.push(row); }

    const warnings: string[] = [];
    if (rows.length === 0) return { companies: [], column_mapping: {}, total_rows: 0, duplicate_domains_dropped: 0, warnings: ['CSV had no data rows.'] };

    const header = rows[0].map(h => h.trim().toLowerCase());
    const columnMapping: Record<string, string> = {};
    const seenCanonicals = new Set<string>();
    for (const h of header) {
      let found = false;
      for (const [canonical, aliases] of Object.entries(CITYDATA_SCHEMA)) {
        if (aliases.includes(h) && !seenCanonicals.has(canonical)) {
          columnMapping[h] = canonical;
          seenCanonicals.add(canonical);
          found = true;
          break;
        }
      }
      if (!found) warnings.push(`Unmapped column "${h}" ignored.`);
    }

    const retrievedAt = new Date().toISOString();
    const companies: CanonicalCompany[] = [];
    const seenNames = new Set<string>();
    let dupCount = 0;

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (row.length < header.length && row.every(c => !c || c === '')) continue;
      const raw: Record<string, string> = {};
      for (let c = 0; c < header.length; c++) raw[header[c]] = row[c] || '';

      const get = (canonical: string): string => {
        const h = Object.keys(columnMapping).find(k => columnMapping[k] === canonical);
        return h ? raw[h.trim()] || '' : '';
      };

      const companyName = get('company')?.trim() || '';
      // CityData doesn't have website/domain in the standard schema
      const domainVal = get('domain')?.trim() || '';

      if (!companyName && !domainVal) continue;

      // Dedup by company name (CityData often has subsidiaries of same group)
      const key = companyName.toLowerCase();
      if (seenNames.has(key)) { dupCount++; continue; }
      seenNames.add(key);

      const company: CanonicalCompany = {
        source: 'PUBLIC_DATASET',
        company: companyName,
        canonical_name: companyName,
        domain: domainVal || null,
        website: domainVal ? (domainVal.startsWith('http') ? domainVal : `https://${domainVal}`) : null,
        industry: get('industry') || null,
        employee_count: this.parseEmployees(get('employee_count')),
        employee_growth_pct: null,
        funding: null,
        funding_currency: null,
        revenue: this.parseRevenue(get('revenue')),
        revenue_currency: 'USD',
        valuation: null,
        valuation_currency: null,
        primary_person_name: get('primary_person_name') || get('primary_person_name') || null,
        primary_title: get('primary_title') || null,
        primary_email: get('primary_email') || null,
        primary_phone: get('primary_phone') || null,
        linkedin_url: get('linkedin_url') || null,
        growjo_url: null,
        source_url: this.sourceUrl,
        retrieved_at: retrievedAt,
        column_mapping: columnMapping,
        raw: raw,
        people: [],
        contacts: [],
        entity_sources: [{ source: 'PUBLIC_DATASET', source_url: this.sourceUrl, retrieved_at: retrievedAt, confidence: 'HIGH' }],
      };

      // CEO is NOT a verified technical owner — keep as metadata, not as a
      // Growjo-style person for owner resolution.
      const ceoName = get('primary_person_name');
      if (ceoName && ceoName.trim()) {
        company.people.push({
          id: `${company.canonical_name}::${ceoName}`,
          name: ceoName,
          title: 'CEO',
          company: company.canonical_name,
          linkedin_url: null,
          email: null,
          phone: null,
          sources: [{ source: 'PUBLIC_DATASET', source_url: this.sourceUrl, retrieved_at: retrievedAt, confidence: 'HIGH' }],
        });
      }

      companies.push(company);
    }

    return {
      companies,
      column_mapping: columnMapping,
      total_rows: rows.length - 1,
      duplicate_domains_dropped: dupCount,
      warnings,
    };
  }

  private parseEmployees(raw: string): number | null {
    if (!raw) return null;
    // Handle "1,085" or "1085"
    const cleaned = raw.replace(/[,"]/g, '').trim();
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }

  private parseRevenue(raw: string): number | null {
    if (!raw) return null;
    // Handle "3,5063E+11" (Excel scientific notation) or "$12,345"
    const cleaned = raw.replace(/[$",\s]/g, '').trim();
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }

  // ── CompanyDataProvider interface ──

  async searchCompanies(query: string): Promise<CanonicalCompany[]> {
    return [];
  }

  async resolveCompany(nameOrDomain: string): Promise<CanonicalCompany | null> {
    return null;
  }

  async enrichCompany(company: CanonicalCompany): Promise<CanonicalCompany> {
    return company;
  }

  async findPeople(company: CanonicalCompany): Promise<CanonicalPerson[]> {
    return company.people || [];
  }

  async findContacts(_person: CanonicalPerson): Promise<CanonicalContact[]> {
    return [];
  }

  // ── Source registry ──

  getSources(): SourceEntry[] {
    return [
      {
        domain: 'companydata.com',
        category: 'COMPANY' as SourceCategory,
        priority: 90,
        authority_metadata: { dataset_name: this.datasetName, license: 'CC0' },
        allowed: true,
        blocked: false,
        last_checked: new Date().toISOString(),
        notes: `Public dataset: ${this.datasetName} (${this.sourceUrl})`,
      },
    ];
  }
}
