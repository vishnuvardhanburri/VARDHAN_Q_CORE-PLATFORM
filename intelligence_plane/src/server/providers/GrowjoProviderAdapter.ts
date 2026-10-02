/**
 * VARDHAN — GROWJO PROVIDER ADAPTER
 * ─────────────────────────────────────────────────────────────────────────────
 * Wraps the existing GrowjoProvider to the canonical CompanyDataProvider
 * interface. This makes Growjo an OPTIONAL, pluggable provider.
 *
 * The Growjo CSV remains the PRIMARY / preferred initial lead source,
 * but the system works perfectly without it.
 */
import type { CanonicalCompany, CanonicalPerson, CanonicalContact, SourceEntry, SourceCategory } from './Model';
import type { ProviderCapabilities } from './ProviderInterface';
import { CompanyDataProvider } from './ProviderInterface';
import type { ProviderCostClass } from '../IntelligenceCase';
import { GrowjoProvider } from '../GrowjoProvider';
import type { GrowjoCompany } from '../DeepTypes';

export interface GrowjoProviderOptions {
  enabled?: boolean;
  sourceUrl?: string;
  retrievedAt?: string;
}

export class GrowjoProviderAdapter extends CompanyDataProvider {
  readonly costClass: ProviderCostClass = 'FREE';
  readonly name = 'growjo';
  readonly enabled: boolean;
  readonly capabilities: ProviderCapabilities = {
    searchCompanies: true, resolveCompany: true, findPeople: true,
    findContacts: false, enrichCompany: false, enrichPerson: false,
    verifyContact: false,
  };

  private readonly growjo: typeof GrowjoProvider;

  constructor(opts: GrowjoProviderOptions = {}) {
    super();
    this.enabled = opts.enabled ?? true;
    this.growjo = GrowjoProvider;
  }

  /** Parse a Growjo CSV into canonical companies. */
  parseCsv(csvText: string) {
    const result = this.growjo.parseCsv(csvText, {
      source_url: this.growjoUrl,
      retrievedAt: new Date().toISOString(),
    });
    // Enrich each GrowjoCompany with people/contacts arrays (canonical)
    const enriched: CanonicalCompany[] = result.companies.map(gc => ({
      source: 'GROWJO',
      company: gc.company,
      canonical_name: gc.canonical_name,
      domain: gc.domain,
      website: gc.website,
      industry: gc.industry,
      employee_count: gc.employee_count,
      employee_growth_pct: gc.employee_growth_pct,
      funding: gc.funding,
      funding_currency: gc.funding_currency,
      revenue: gc.revenue,
      revenue_currency: gc.revenue_currency,
      valuation: gc.valuation,
      valuation_currency: gc.valuation_currency,
      primary_person_name: gc.primary_person_name,
      primary_title: gc.primary_title,
      primary_email: gc.primary_email,
      primary_phone: gc.primary_phone,
      linkedin_url: gc.linkedin_url,
      growjo_url: gc.growjo_url,
      source_url: gc.source_url,
      retrieved_at: gc.retrieved_at,
      column_mapping: gc.column_mapping,
      raw: gc.raw,
      people: this.buildPeople(gc),
      contacts: [],
      entity_sources: [{
        source: 'GROWJO',
        source_url: gc.source_url || gc.growjo_url || null,
        retrieved_at: gc.retrieved_at,
        confidence: 'HIGH' as const,
      }],
    }));
    return { ...result, companies: enriched };
  }

  private growjoUrl = 'https://growjo.com';

  /** Build canonical people from a GrowjoCompany record.
   * Only builds a person if the record has a primary_person_name
   * that differs from the company name (real title or email). */
  private buildPeople(gc: GrowjoCompany): CanonicalPerson[] {
    const name = gc.primary_person_name;
    if (!name || name.trim() === gc.company) return [];
    return [{
      id: `${gc.canonical_name}::${name}`,
      name,
      title: gc.primary_title,
      company: gc.canonical_name,
      linkedin_url: gc.linkedin_url,
      email: gc.primary_email,
      phone: gc.primary_phone,
      sources: [{
        source: 'GROWJO',
        source_url: gc.source_url || gc.growjo_url || null,
        retrieved_at: gc.retrieved_at,
        confidence: 'HIGH' as const,
      }],
    }];
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
    return []; // Growjo CSV has no licensed contact verification
  }

  getSources(): SourceEntry[] {
    return [{
      domain: 'growjo.com',
      category: 'COMPANY' as SourceCategory,
      priority: 100,
      authority_metadata: { trust_score: 85, structured_data: true },
      allowed: true,
      blocked: false,
      last_checked: null,
      notes: 'Growjo — licensed B2B company/person data.',
    }];
  }
}
