/**
 * VARDHAN — PROVIDER INTERFACE
 * ─────────────────────────────────────────────────────────────────────────────
 * The contract every data provider implements. Providers are OPTIONAL —
 * the system works with none, some, or all of them.
 *
 * Each provider normalizes into the canonical model (see Model.ts).
 * Provenance is always preserved.
 */
import type { CanonicalCompany, CanonicalPerson, CanonicalContact, Provenance, SourceEntry } from './Model';
import { ProviderCostClass } from '../IntelligenceCase';

export interface ProviderCapabilities {
  searchCompanies: boolean;
  resolveCompany: boolean;
  findPeople: boolean;
  findContacts: boolean;
  enrichCompany: boolean;
  enrichPerson: boolean;
  verifyContact: boolean;
}

export abstract class CompanyDataProvider {
  /** Human-readable provider name (e.g. "growjo", "csv", "public-dataset"). */
  abstract readonly name: string;
  /** Whether this provider is configured / enabled. */
  abstract readonly enabled: boolean;
  /** Whether this provider is FREE or PAID. */
  abstract readonly costClass: ProviderCostClass;
  /** What this provider can do. */
  abstract readonly capabilities: ProviderCapabilities;

  // ── Company-level operations ──

  /**
   * Search for companies by name, domain, or keyword.
   * Returns canonical companies with provenance attached.
   */
  abstract searchCompanies(query: string): Promise<CanonicalCompany[]>;

  /**
   * Resolve a company by exact name or domain.
   * Returns null if not found (provider waterfall continues).
   */
  abstract resolveCompany(nameOrDomain: string): Promise<CanonicalCompany | null>;

  /**
   * Enrich a canonical company with additional firmographics.
   * Providers that can't enrich return the company unchanged.
   */
  async enrichCompany(company: CanonicalCompany): Promise<CanonicalCompany> {
    return company;
  }

  // ── People / contact operations ──

  /**
   * Find people at a company. Returns empty array if this provider
   * doesn't supply person data (e.g. the Growjo CSV with only lead411 redirects).
   */
  abstract findPeople(company: CanonicalCompany): Promise<CanonicalPerson[]>;

  /**
   * Find contact information for a person.
   * Never guesses emails from name+domain conventions.
   * Returns empty array if the person can't be contacted via this provider.
   */
  abstract findContacts(person: CanonicalPerson): Promise<CanonicalContact[]>;

  /**
   * Enrich a person with title, LinkedIn, etc. from this provider's sources.
   */
  async enrichPerson(person: CanonicalPerson): Promise<CanonicalPerson> {
    return person;
  }

  /**
   * Verify a contact (email, phone) using this provider's verification API.
   * Only for providers with licensed verification (Hunter, Apollo).
   * Defaults to unknown.
   */
  async verifyContact(contact: CanonicalContact): Promise<CanonicalContact> {
    return { ...contact, verification_status: 'pending' };
  }

  // ── Source registry integration ──

  /**
   * Return the public sources this provider would use for discovery
   * (for the SourceRegistry). Empty if N/A (e.g. CSV-only providers).
   */
  getSources?(): SourceEntry[];
}

/** Result of a provider waterfall lookup. */
export interface ProviderLookupResult {
  /** Companies from each provider that had a hit (provenance-preserved). */
  companies: CanonicalCompany[];
  /** Which providers contributed. */
  contributing_providers: string[];
  /** Which providers were queried but returned nothing. */
  tried_providers: string[];
  /** Whether a licensed contact provider is available. */
  has_contact_provider: boolean;
}
