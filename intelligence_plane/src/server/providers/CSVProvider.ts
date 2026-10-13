/**
 * VARDHAN — CSV PROVIDER
 * ─────────────────────────────────────────────────────────────────────────────
 * Generic CSV import. Accepts any CSV with a configurable column-alias mapping.
 * The Growjo CSV format and the generic company-CSV format both flow through
 * this provider.
 *
 * Never guesses emails / phones from name+domain conventions.
 * Every field preserves provenance (source = "CSV", source_url, retrieved_at).
 */
import type { CanonicalCompany, CanonicalPerson, CanonicalContact, Provenance } from './Model';
import type { ProviderCapabilities } from './ProviderInterface';
import { CompanyDataProvider } from './ProviderInterface';
import type { ProviderCostClass } from '../IntelligenceCase';

// Reusable CSV parser (handles quoted fields with embedded commas/newlines).
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let cur = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (ch === '\r') { /* skip — handle \r\n */ }
    else if (ch === ',') { row.push(cur); cur = ''; }
    else cur += ch;
  }
  if (cur || row.length > 0 || rows.length > 0) { row.push(cur); rows.push(row); }
  return rows;
}

/**
 * A CSV schema maps canonical field names → list of accepted column-header
 * aliases (lowercased).  Providers build their own alias tables from this.
 */
export type CsvSchema = Record<string, string[]>;

/** Default schema that accepts the Growjo CSV + generic company CSV formats. */
export const DEFAULT_CSV_SCHEMA: CsvSchema = {
  company:         ['company', 'company_name', 'name', 'companyname'],
  domain:          ['domain', 'website', 'url', 'homepage', 'site', 'domain_url'],
  industry:        ['industry', 'industry_vertical', 'vertical', 'sector', 'category', 'sic_description'],
  employee_count:  ['employees', 'current_employees', 'employees_2024', 'employee_count', 'num_employees'],
  employee_growth_pct: ['employee_growth', 'employee_growth_pct', 'employee_growth_rate'],
  funding:         ['total_funding', 'funding', 'funding_usd', 'funding_amount'],
  valuation:       ['valuation', 'valuation_usd', 'last_valuation', 'post_money_valuation'],
  primary_person_name: ['person_name', 'person', 'contact_name', 'full_name', 'primary_contact', 'contact_person'],
  primary_title:   ['person_title', 'title', 'job_title', 'role', 'contact_title'],
  primary_email:   ['email', 'primary_email', 'contact_email', 'person_email', 'lead_email'],
  primary_phone:   ['phone', 'primary_phone', 'contact_phone', 'person_phone', 'mobile'],
  linkedin_url:    ['linkedin_url', 'linkedin', 'linkedin_profile', 'linkedin_company_profile'],
  revenue:         ['revenue', 'revenue_usd', 'yearly_revenue', 'revenue_2024', 'annual_revenue'],
};

type NumOrNull = number | null;
function toNum(v: unknown): NumOrNull {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function currencyFrom(raw: string): string | null {
  raw = raw.trim().toUpperCase();
  if (raw.includes('€')) return 'EUR';
  if (raw.includes('£')) return 'GBP';
  if (raw.includes('$')) return 'USD';
  return null;
}

export interface CsvProviderOptions {
  /** Path or label for the CSV (used in provenance source_url). */
  sourceUrl?: string;
  /** ISO timestamp; defaults to now. */
  retrievedAt?: string;
  /** Override the default column-alias schema. */
  schema?: CsvSchema;
  /** Only parse companies whose domain is non-empty (skip blanks). */
  requireDomain?: boolean;
}

/** Result of parsing a CSV into canonical companies. */
export interface CsvImportResult {
  companies: CanonicalCompany[];
  column_mapping: Record<string, string>;
  total_rows: number;
  duplicate_domains_dropped: number;
  warnings: string[];
}

export class CSVProvider extends CompanyDataProvider {
  readonly costClass: ProviderCostClass = 'FREE';
  readonly name = 'csv';
  readonly enabled = true;
  readonly capabilities: ProviderCapabilities = {
    searchCompanies: true, resolveCompany: true, findPeople: true,
    findContacts: false, enrichCompany: false, enrichPerson: false,
    verifyContact: false,
  };

  constructor(private readonly opts: CsvProviderOptions = {}) {
    super();
  }

  /**
   * Parse CSV text into canonical companies.
   * Accepts the Growjo CSV, the FT1000 CSV, or any CSV using the alias schema.
   */
  parseCsv(csvText: string): CsvImportResult {
    const warnings: string[] = [];
    const schema = this.opts.schema || DEFAULT_CSV_SCHEMA;
    // Strip UTF-8 BOM if present
    const rows = parseCsvRows(csvText.replace(/^\uFEFF/, ''));
    if (rows.length === 0) {
      return { companies: [], column_mapping: {}, total_rows: 0, duplicate_domains_dropped: 0, warnings: ['CSV had no data rows.'] };
    }

    const header = rows[0].map(h => h.trim().toLowerCase());
    const columnMapping: Record<string, string> = {};
    const seenCanonicals = new Set<string>();
    for (const h of header) {
      let found = false;
      for (const [canonical, aliases] of Object.entries(schema)) {
        if (aliases.includes(h) && !seenCanonicals.has(canonical)) {
          columnMapping[h] = canonical;
          seenCanonicals.add(canonical);
          found = true;
          break;
        }
      }
      if (!found) warnings.push(`Unmapped column "${h}" ignored.`);
    }

    const retrievedAt = this.opts.retrievedAt || new Date().toISOString();
    const sourceUrl = this.opts.sourceUrl || 'CSV import';

    const companies: CanonicalCompany[] = [];
    const seenDomains = new Set<string>();
    let dupCount = 0;

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (row.length < header.length && row.every(c => c === '' || c === undefined)) continue; // skip blank rows
      const raw: Record<string, string> = {};
      for (let c = 0; c < header.length; c++) raw[header[c]] = row[c] || '';

      // Resolve canonical fields via column mapping
      const get = (canonical: string): string => {
        const h = Object.keys(columnMapping).find(k => columnMapping[k] === canonical);
        return h ? raw[h.trim()] || '' : '';
      };

      const companyName = get('company')?.trim() || '';
      const domainVal = get('domain')?.trim() || '';

      if (this.opts.requireDomain && !domainVal) continue;
      if (!companyName && !domainVal) continue;

      // Dedup by canonical domain
      const canonDomain = domainVal.replace(/^https?:\/\//, '').split('/')[0].toLowerCase().replace(/^www\./, '');
      if (canonDomain && seenDomains.has(canonDomain)) { dupCount++; continue; }
      if (canonDomain) seenDomains.add(canonDomain);

      const company: CanonicalCompany = {
        source: 'CSV',
        company: companyName,
        canonical_name: companyName || domainVal,
        domain: domainVal || null,
        website: domainVal ? (domainVal.startsWith('http') ? domainVal : `https://${domainVal}`) : null,
        industry: get('industry') || null,
        employee_count: toNum(get('employee_count')),
        employee_growth_pct: toNum(get('employee_growth_pct')),
        funding: toNum(get('funding')),
        funding_currency: null,
        revenue: toNum(get('revenue')),
        revenue_currency: null,
        valuation: toNum(get('valuation')),
        valuation_currency: null,
        primary_person_name: get('primary_person_name') || null,
        primary_title: get('primary_title') || null,
        primary_email: get('primary_email') || null,
        primary_phone: get('primary_phone') || null,
        linkedin_url: get('linkedin_url') || null,
        growjo_url: null,
        source_url: sourceUrl,
        retrieved_at: retrievedAt,
        column_mapping: columnMapping,
        raw: raw,
        people: [],
        contacts: [],
        entity_sources: [{ source: 'CSV', source_url: sourceUrl, retrieved_at: retrievedAt, confidence: 'HIGH' }],
      };

      // Build person (if name present and ≠ company name)
      const personName = company.primary_person_name;
      if (personName && personName.trim() !== company.company) {
        company.people.push({
          id: `${company.canonical_name}::${personName}`,
          name: personName,
          title: company.primary_title,
          company: company.canonical_name,
          linkedin_url: company.linkedin_url,
          email: company.primary_email,
          phone: company.primary_phone,
          sources: [{ source: 'CSV', source_url: sourceUrl, retrieved_at: retrievedAt, confidence: 'HIGH' }],
        });
      }

      companies.push(company);
    }

    return { companies, column_mapping: columnMapping, total_rows: rows.length - 1, duplicate_domains_dropped: dupCount, warnings };
  }

  // ── CompanyDataProvider interface ──

  async searchCompanies(query: string): Promise<CanonicalCompany[]> {
    return [];
  }

  async resolveCompany(nameOrDomain: string): Promise<CanonicalCompany | null> {
    return null;
  }

  async findPeople(company: CanonicalCompany): Promise<CanonicalPerson[]> {
    return company.people || [];
  }

  async findContacts(_person: CanonicalPerson): Promise<CanonicalContact[]> {
    return []; // CSV provider never guesses contacts
  }
}
