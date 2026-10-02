/**
 * VARDHAN — CANONICAL INTERNAL MODEL
 * ─────────────────────────────────────────────────────────────────────────────
 * Every provider (Growjo, CSV, PublicDataset, Hunter, Apollo, GitHub, PublicWeb)
 * normalizes its data into these canonical types. No provider-specific logic
 * leaks into the core intelligence engine.
 *
 * Every field preserves provenance: source, source_url, retrieved_at.
 * No provider is mandatory.
 */
import type { EvidenceProvenance } from '../DeepTypes';

/** Confidence level — matches StrengthLevel from IntelligenceCase. */
export type ConfidenceLevel = 'LOW' | 'MEDIUM' | 'HIGH';

/** Every field-level or entity-level source attribution. */
export interface Provenance {
  /** Which provider produced this piece of data. */
  source: string;
  /** The public URL (or licensed API endpoint) it was retrieved from. */
  source_url: string | null;
  /** ISO-8601 timestamp of retrieval. */
  retrieved_at: string;
  /** Confidence in this specific field's accuracy. */
  confidence: ConfidenceLevel;
}

/** A public source that the crawler is allowed to visit. */
export type SourceCategory =
  | 'COMPANY' | 'ENGINEERING' | 'TECHNOLOGY' | 'DOCS' | 'API'
  | 'GITHUB' | 'SECURITY' | 'STATUS' | 'CHANGELOG' | 'CAREERS' | 'PRESS'
  | 'PROFESSIONAL' | 'BLOG' | 'OTHER';

export interface SourceEntry {
  domain: string;
  category: SourceCategory;
  priority: number;            // higher = crawl sooner
  authority_metadata: Record<string, unknown>;
  allowed: boolean;
  blocked: boolean;
  last_checked: string | null;
  notes: string | null;
}

/** Canonical person — normalizes across Growjo / CSV / LinkedIn / etc. */
export interface CanonicalPerson {
  id: string;                    // stable hash across sources
  name: string;
  title: string | null;
  company: string | null;
  linkedin_url: string | null;
  email: string | null;
  phone: string | null;
  sources: Provenance[];
}

/** Canonical contact — never guessed. Each contact is tied to a provider. */
export interface CanonicalContact {
  type: 'email' | 'phone' | 'linkedin' | 'other';
  value: string;
  person_id: string | null;
  company_name: string | null;
  provider: string;             // which provider supplied this contact
  source_url: string | null;
  verified_at: string | null;
  verification_status: 'verified' | 'unverified' | 'pending';
  confidence: ConfidenceLevel;
}

/** Canonical company — the GrowjoCompany shape generalized for any provider. */
export interface CanonicalCompany {
  /** Provider that produced this record (GROWJO, CSV, PUBLIC_DATASET, etc.). */
  source: string;
  company: string;
  canonical_name: string;
  domain: string | null;
  website: string | null;
  industry: string | null;
  employee_count: number | null;
  employee_growth_pct: number | null;
  funding: number | null;
  funding_currency: string | null;
  revenue: number | null;
  revenue_currency: string | null;
  valuation: number | null;
  valuation_currency: string | null;
  primary_person_name: string | null;
  primary_title: string | null;
  primary_email: string | null;
  primary_phone: string | null;
  linkedin_url: string | null;
  growjo_url: string | null;
  source_url: string | null;
  retrieved_at: string;
  column_mapping: Record<string, string>;
  raw: Record<string, string>;

  /** People attached to this company (from this or other providers). */
  people: CanonicalPerson[];
  /** Contacts for people at this company. */
  contacts: CanonicalContact[];
  /** All sources that contributed to this entity. */
  entity_sources: Provenance[];
}
