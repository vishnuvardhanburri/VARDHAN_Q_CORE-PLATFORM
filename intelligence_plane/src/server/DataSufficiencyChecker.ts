/**
 * VARDHAN — DATA SUFFICIENCY CHECKER (§1)
 * ─────────────────────────────────────────────────────────────────────────────
 * Determines whether a dataset record for a company provides enough information
 * to skip Live Web Research, or whether the live-web fallback must be triggered.
 *
 * A dataset is a SEED, not the final truth. If critical information is missing
 * or stale, LIVE_WEB_RESEARCH is triggered.
 */

import type { GrowjoCompany, ProviderCompanyLike } from './DeepTypes';
import type { CompanySurface } from './IntelligenceCase';

export type SufficiencyFlag =
  | 'company_identity'
  | 'domain'
  | 'industry'
  | 'employees'
  | 'people'
  | 'role'
  | 'contact'
  | 'technical_sources'
  | 'freshness';

export interface SufficiencyCheck {
  sufficient: boolean;
  missing: SufficiencyFlag[];
  stale: SufficiencyFlag[];
  reasons: string[];
  /** Whether live-web research should be triggered (missing or stale critical data). */
  needs_live_research: boolean;
  /** Whether the dataset should be used as-is (sufficient + fresh enough). */
  use_dataset: boolean;
}

/** Age threshold (in days) beyond which a dataset record is considered stale. */
const STALE_AFTER_DAYS = 180;

export class DataSufficiencyChecker {
  /**
   * Check whether provider data is sufficient for a company.
   * Critical fields: company identity, domain, people (optional), contact
   * (optional), technical sources (always needs live web).
   */
  static check(
    company: GrowjoCompany | ProviderCompanyLike | null,
    surface: CompanySurface | null,
    now: string = new Date().toISOString()
  ): SufficiencyCheck {
    const missing: SufficiencyFlag[] = [];
    const stale: SufficiencyFlag[] = [];
    const reasons: string[] = [];

    if (!company) {
      return {
        sufficient: false,
        missing: ['company_identity', 'domain'],
        stale: [],
        reasons: ['No dataset record available — full live-web research required.'],
        needs_live_research: true,
        use_dataset: false,
      };
    }

    // company identity
    if (!company.company || !company.canonical_name) {
      missing.push('company_identity');
      reasons.push('Company name missing from dataset.');
    }

    // domain
    if (!company.domain) {
      missing.push('domain');
      reasons.push('Domain missing from dataset.');
    }

    // industry
    if ('industry' in company && !company.industry) {
      missing.push('industry');
      reasons.push('Industry missing from dataset.');
    }

    // employees (informational, not critical)
    if ('employee_count' in company && company.employee_count == null) {
      missing.push('employees');
      // not a blocker — just informational
    }

    // people
    const personName = company.primary_person_name || '';
    const isPlaceholder = personName === company.company || /^(see lead411|lead411|n\/a|na|tbd|tba|unknown|\s*)$/i.test(personName);
    const hasPerson = !!personName && !isPlaceholder;
    if (!hasPerson) {
      missing.push('people');
      reasons.push('No person data in dataset — live-web person discovery will be used.');
    }

    // role
    if (!company.primary_title) {
      missing.push('role');
      reasons.push('No role/title in dataset.');
    }

    // contact
    if (!company.primary_email && !company.primary_phone && !company.linkedin_url) {
      missing.push('contact');
      reasons.push('No contact information in dataset.');
    }

    // technical sources
    if (!surface || surface.discovered_pages.length === 0) {
      missing.push('technical_sources');
      reasons.push('No technical sources discovered — live-web research required.');
    }

    // freshness
    if (company.retrieved_at) {
      const retrieved = Date.parse(company.retrieved_at);
      const ageDays = (Date.now() - retrieved) / (1000 * 60 * 60 * 24);
      if (ageDays > STALE_AFTER_DAYS) {
        stale.push('freshness');
        reasons.push(`Dataset record is ${Math.round(ageDays)} days old (stale threshold: ${STALE_AFTER_DAYS} days).`);
      }
    } else {
      stale.push('freshness');
      reasons.push('No retrieval timestamp — cannot verify freshness.');
    }

    // Critical missing fields that force live research:
    // domain, technical_sources, people (person discovery), contact
    // Industry and employees are informational — don't force live research.
    const criticalMissing = missing.filter(f =>
      f === 'domain' || f === 'technical_sources' || f === 'people' || f === 'contact'
    );
    const needs_live_research = criticalMissing.length > 0 || stale.length > 0;
    const sufficient = !needs_live_research;

    return {
      sufficient,
      missing,
      stale,
      reasons,
      needs_live_research,
      use_dataset: sufficient,
    };
  }

  /** Staleness threshold in days (exported for configuration). */
  static readonly STALE_AFTER_DAYS = STALE_AFTER_DAYS;
}
