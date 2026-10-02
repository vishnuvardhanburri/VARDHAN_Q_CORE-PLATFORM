/**
 * VARDHAN — PROVIDER REGISTRY
 * ─────────────────────────────────────────────────────────────────────────────
 * Manages all configured providers and implements the provider waterfall.
 *
 * Provider order is CONFIGURABLE, not hardcoded (spec §1). No provider is
 * inherently primary — Growjo, CSV, public datasets, licensed providers and
 * future providers all participate as equals. The operator configures the
 * order.
 *
 * Field-level precedence (spec §2) is handled via FieldPrecedenceConfig:
 *   COMPANY_IDENTITY: official company → licensed → public dataset
 *   CONTACT:           licensed → imported → public professional
 *   TECHNICAL_EVIDENCE: direct observation → official source → public GitHub
 *   PERSON_IDENTITY:   explicit evidence → licensed → imported dataset
 *
 * Each provider is OPTIONAL. Provider failure does not kill the pipeline.
 */
import type { CanonicalCompany, CanonicalPerson, CanonicalContact, Provenance, SourceEntry } from './Model';
import { CompanyDataProvider, type ProviderLookupResult } from './ProviderInterface';
import { ResearchPolicyManager } from '../ResearchPolicyManager';

export interface ProviderConfig {
  /** Unique key for this provider instance. */
  key: string;
  /** The provider instance. */
  provider: CompanyDataProvider;
  /** Priority in the waterfall (lower = earlier). */
  priority: number;
}

/**
 * Per-field provider precedence (spec §2). Each field type lists the provider
 * keys in the order they should be consulted. This replaces the hardcoded
 * "Growjo primary" semantic with field-level precedence.
 *
 * Example:
 *   {
 *     company_identity: ['growjo', 'csv', 'public-dataset', 'manual'],
 *     contact:          ['growjo', 'hunter', 'public', 'unknown'],
 *     person_identity:  ['growjo', 'csv', 'public'],
 *   }
 */
export interface FieldPrecedenceConfig {
  /** Provider order for company identity (name, domain, website). */
  company_identity: string[];
  /** Provider order for contact info (email, phone, LinkedIn). */
  contact: string[];
  /** Provider order for person identity (name, title, role). */
  person_identity: string[];
  /** Provider order for technical evidence (signals, observations). */
  technical_evidence: string[];
}

/** Default field-level precedence — all providers are EQUAL priority. */
export const DEFAULT_FIELD_PRECEDENCE: FieldPrecedenceConfig = {
  company_identity: ['official', 'growjo', 'csv', 'public-dataset', 'manual'],
  contact: ['growjo', 'hunter', 'public', 'unknown'],
  person_identity: ['growjo', 'csv', 'public-dataset', 'public'],
  technical_evidence: ['direct', 'official', 'github', 'public'],
};

export class ProviderRegistry {
  private readonly providers: ProviderConfig[] = [];

  add(config: ProviderConfig): void {
    this.providers.push(config);
    this.providers.sort((a, b) => a.priority - b.priority);
  }

  /** All registered providers (ordered by waterfall priority). */
  getProviders(): CompanyDataProvider[] {
    return this.providers.map(p => p.provider);
  }

  /** Field-level precedence configuration. */
  fieldPrecedence: FieldPrecedenceConfig = { ...DEFAULT_FIELD_PRECEDENCE };

  /**
   * Set field-level precedence (overrides the default). No provider is
   * inherently primary — the caller decides the order per field type.
   */
  setFieldPrecedence(config: Partial<FieldPrecedenceConfig>): void {
    this.fieldPrecedence = { ...this.fieldPrecedence, ...config };
  }

  /** Whether any contact-verification provider is available. */
  get hasContactProvider(): boolean {
    return this.providers.some(p => p.provider.capabilities.verifyContact && p.provider.enabled);
  }

  /**
   * Waterfall lookup using field-level precedence for COMPANY_IDENTITY
   * (spec §1, §2). No provider is inherently primary. Returns all companies
   * found from providers consulted in the configured order; provenance is
   * preserved per result.
   */
  async lookupCompany(nameOrDomain: string): Promise<ProviderLookupResult> {
    const companies: CanonicalCompany[] = [];
    const contributing: string[] = [];
    const tried: string[] = [];

    // Consult providers in the field-specific order for company identity.
    // Fall back to global priority order for providers not listed in the field config.
    const fieldOrder = this.fieldPrecedence.company_identity;
    const orderedProviders = this.providers.slice().sort((a, b) => {
      const ai = fieldOrder.indexOf(a.key);
      const bi = fieldOrder.indexOf(b.key);
      const pa = ai >= 0 ? ai : fieldOrder.length + a.priority;
      const pb = bi >= 0 ? bi : fieldOrder.length + b.priority;
      return pa - pb;
    });

    for (const pc of orderedProviders) {
      if (!pc.provider.enabled) continue;

      // POLICY GUARD: Block paid providers if research mode is FREE_ONLY
      if (!ResearchPolicyManager.isProviderAllowed(pc.provider.costClass)) {
        console.log(`[POLICY_BLOCK] Provider ${pc.key} blocked by policy: ${ResearchPolicyManager.getBlockedReason()}`);
        tried.push(`${pc.key}:BLOCKED_BY_POLICY`);
        continue;
      }

      tried.push(pc.key);
      try {
        if (pc.provider.capabilities.resolveCompany) {
          const found = await pc.provider.resolveCompany(nameOrDomain);
          if (found) {
            companies.push(found);
            contributing.push(pc.key);
          }
        }
      } catch (e) {
        // Provider failure does not kill the pipeline — just skip.
        tried.push(`${pc.key}:error`);
      }
    }

    return {
      companies,
      contributing_providers: [...new Set(contributing)],
      tried_providers: tried,
      has_contact_provider: this.hasContactProvider,
    };
  }

  /**
   * Search all providers for companies matching a query.
   * Aggregates results from every provider that supports search.
   */
  async searchCompany(query: string): Promise<CanonicalCompany[]> {
    const results: CanonicalCompany[] = [];
    for (const pc of this.providers) {
      if (!pc.provider.enabled || !pc.provider.capabilities.searchCompanies) continue;

      // POLICY GUARD
      if (!ResearchPolicyManager.isProviderAllowed(pc.provider.costClass)) {
        console.log(`[POLICY_BLOCK] Provider ${pc.key} blocked by policy: ${ResearchPolicyManager.getBlockedReason()}`);
        continue;
      }

      try {
        const hits = await pc.provider.searchCompanies(query);
        results.push(...hits);
      } catch {
        // skip failed provider
      }
    }
    return results;
  }

  /**
   * Contact waterfall for a person:
   *   1. licensed provider data (already attached by import)
   *   2. findContacts via configured licensed provider (Hunter, Apollo)
   *   3. publicly listed professional contact
   *   4. CONTACT_UNKNOWN
   */
  async resolveContacts(person: CanonicalPerson): Promise<CanonicalContact[]> {
    const contacts: CanonicalContact[] = [];

    // 1. Any contacts already attached to the person (from CSV import etc.)
    // These carry their own provenance.

    // 2. Query each contact-capable provider
    for (const pc of this.providers) {
      if (!pc.provider.enabled || !pc.provider.capabilities.findContacts) continue;

      // POLICY GUARD
      if (!ResearchPolicyManager.isProviderAllowed(pc.provider.costClass)) {
        console.log(`[POLICY_BLOCK] Provider ${pc.key} blocked by policy: ${ResearchPolicyManager.getBlockedReason()}`);
        continue;
      }

      try {
        const found = await pc.provider.findContacts(person);
        contacts.push(...found);
      } catch {
        // skip
      }
    }

    // 3. Public professional sources — handled by LivePublicObservationProvider
    // in the main pipeline (PeopleExtractor finds LinkedIn profiles etc.)

    // 4. If nothing found, the caller can mark as CONTACT_UNKNOWN
    return contacts;
  }

  /** Collect all sources from all providers for the SourceRegistry. */
  getAllSources(): SourceEntry[] {
    const sources: SourceEntry[] = [];
    for (const pc of this.providers) {
      const providerSources = pc.provider.getSources?.() || [];
      sources.push(...providerSources);
    }
    return sources;
  }
}
