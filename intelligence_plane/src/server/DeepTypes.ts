/**
 * VARDHAN — DEEP INTELLIGENCE LAYER (additive)
 * ─────────────────────────────────────────────────────────────────────────────
 * This module defines the types for the high-precision prospect research operator
 * (`deep` command). It is intentionally additive: it REUSES the existing
 * IntelligenceCase evidence model, FindingClassification, OwnerCandidate, and
 * CompanySurface. It does NOT redefine or replace them.
 *
 * The Deep prospect is a super-structure that layers:
 *   - structured technical signal discovery
 *   - ICP qualification
 *   - contactability (public professional links only)
 *   - an owner graph (finding → subsystem → responsibility → candidate)
 *   - a finding-led email with explicit angles / subjects / uncertainty
 *
 * Evidence IDs are carried through from the underlying IntelligenceCase so the
 * full lineage (observation → finding → owner → email) remains traceable.
 */

import type {
  Evidence, EvidenceClaim, FindingClassification, FindingType,
  OwnerCandidate, CompanySurface, DiscoveredPage, IntelligenceCase,
  SeverityLevel, StrengthLevel, FindingStrength
} from './IntelligenceCase';
import type { ChangeRecord } from './ChangeDetector';

// ── Signals ──────────────────────────────────────────────────────────────────

/** Broad bucket of a publicly observable technical artefact. */
export type SignalSourceType =
  | 'ENGINEERING_ARTICLE'
  | 'TECHNICAL_DOCUMENTATION'
  | 'API_REFERENCE'
  | 'SDK_DOCS'
  | 'STATUS_PAGE'
  | 'PUBLIC_INCIDENT'
  | 'SECURITY_PAGE'
  | 'TECHNICAL_HIRING'
  | 'ARCHITECTURE_DISCUSSION'
  | 'BLOG'
  | 'NEWS';

/**
 * Every signal MUST be one of these — categories are never blurred.
 *  - DOCUMENTED_FACT        : explicitly stated on a public company source
 *  - REAL_PUBLIC_OBSERVATION: a public resource we actually fetched/observed
 *  - VARDHAN_INFERENCE       : a conclusion drawn from other public signals
 * An inference is never written as an observed fact.
 */
export type EvidenceProvenance =
  | 'DOCUMENTED_FACT'
  | 'REAL_PUBLIC_OBSERVATION'
  | 'VARDHAN_INFERENCE';

export type SignalStrength = 'LOW' | 'MEDIUM' | 'HIGH';

export interface DeepSignal {
  signal_id: string;
  type: SignalSourceType;
  source_url: string;
  source_title?: string;
  published_at?: string;
  /** Sanitised, length-capped evidence excerpt taken from the public page. */
  excerpt: string;
  provenance: EvidenceProvenance;
  signal_strength: SignalStrength;
  /** Why this signal is relevant to technical outreach for this company. */
  relevance: string;
  /** Evidence IDs from the observation/finding layer this connects to. */
  related_evidence_ids?: string[];
}

// ── Contactability ───────────────────────────────────────────────────────────

export type ContactKind =
  | 'PROFESSIONAL_PROFILE'        // public LinkedIn / Twitter / GitHub profile link (legacy, broad)
  | 'PROFILE'                     // generic public professional profile link (non-LinkedIn)
  | 'PROFESSIONAL_EMAIL'          // broad professional email (kept for backward compat / Growjo licensed)
  | 'OWNER_VERIFIED_EMAIL'        // email explicitly linked to a specific person (mailto on person's page, licensed lead email)
  | 'COMPANY_BUSINESS_EMAIL'      // role account email (sales@, oauth@, support@, info@) found on company pages
  | 'PUBLIC_PROFESSIONAL_CONTACT' // public professional profile link associated with a specific person
  | 'LINKEDIN'                    // public LinkedIn profile link (Growjo or explicit)
  | 'PHONE'                       // publicly listed professional phone number
  | 'PRESS_CONTACT'               // press / media contact
  | 'CONTACT_PAGE'                // a publicly linked contact page
  | 'UNVERIFIED_POSSIBLE_EMAIL';  // never used — no address guessing (type reserved for clarity)

export type ContactConfidence = 'LOW' | 'MEDIUM' | 'HIGH';

/** Only information that is PUBLICLY visible or already configured is captured. */
export interface DeepContact {
  type: ContactKind;
  value: string;
  source_url: string;
  confidence: ContactConfidence;
  /** If this contact is linked to a specific person (e.g. their profile page), the owner's name. */
  owner_name?: string;
  /** Human readable note describing how the value was observed. */
  note?: string;
}

// ── Owner graph ──────────────────────────────────────────────────────────────

export type OwnerConfidence =
  | 'NO_OWNER_FOUND'
  | 'POSSIBLE_OWNER'
  | 'OWNER_VERIFIED'
  | 'OWNER_HIGH_CONFIDENCE'
  | 'OWNER_VERIFIED_CONTACTABLE';

export interface OwnerSearchPlan {
  target_subsystem: string;
  role_personas: string[];
  technical_keywords: string[];
  seniority_target: 'LEADERSHIP' | 'STAFF' | 'INDIVIDUAL_CONTRIBUTOR';
  opportunity_id: string;
}

export interface PersonEvidence {
  claim: string;
  source_url: string;
  source_type: string;
  observed_at: string;
  freshness: 'FRESH' | 'AGING' | 'STALE' | 'UNKNOWN';
  evidence_id: string;
  confidence: number;
}

export interface EvidenceLedger {
  claims: PersonEvidence[];
}

export interface OwnerResolutionResult {
  opportunity_id: string;
  candidates: DeepOwner[];
  primary_candidate: DeepOwner | null;
  identity_confidence: number;
  role_confidence: number;
  technical_relevance: number;
  ownership_confidence: number;
  contactability_confidence: number;
  evidence_ids: string[];
  source_urls: string[];
  verification_state: OwnerConfidence;
  next_action: 'OUTREACH_CANDIDATE' | 'RESEARCH_MORE';
}

/**
 * Which provenance layer produced an owner (kept separate per spec).
 * - GROWJO_SOURCE            : licensed Growjo lead record (identity + role + company)
 * - OFFICIAL_COMPANY_SOURCE  : person listed on the company's own people/team/about page
 * - PUBLIC_PROFESSIONAL_SOURCE: person on any other public professional surface
 * - REAL_PUBLIC_OBSERVATION  : observed via public crawl (no explicit listing)
 * - DOCUMENTED_FACT          : asserted in a documented public fact (status/incident/etc.)
 * - VARDHAN_INFERENCE         : residual fallback when no explicit person evidence exists
 */
export type OwnerProvenance =
  | 'GROWJO_SOURCE'
  | 'OFFICIAL_COMPANY_SOURCE'
  | 'PUBLIC_PROFESSIONAL_SOURCE'
  | 'REAL_PUBLIC_OBSERVATION'
  | 'DOCUMENTED_FACT'
  | 'VARDHAN_INFERENCE';

/**
 * A person linked, via evidence, to a specific responsibility area of a finding.
 * The engine's TechnicalOwner is preserved in the provenance trail.
 */
export interface DeepOwner {
  name: string;
  role: string;
  company: string;
  source_urls: string[];
  /** Verbatim public evidence backing the ownership claim. */
  owner_evidence: string[];
  /** Which responsibility area of the finding this owner covers. */
  responsibility_match: string;
  confidence: string;
  /** The subsystem/topic of the finding this owner is responsible for. */
  finding_link?: string;
  /** Primary provenance layer that produced this owner (Growjo is primary). */
  deep_owner_provenance?: OwnerProvenance;
}

// ── ICP qualification ────────────────────────────────────────────────────────

export interface IcpDimension {
  name: string;
  /** 0 = absent, 1 = partial, 2 = strong. */
  score: 0 | 1 | 2;
  /** Public evidence backing the score. */
  evidence: string[];
}

export type IcpFit = 'STRONG' | 'WEAK' | 'POOR';
/** Deep ICP outcome. OUTREACH_READY replaces the prior PASS gate. */
export type IcpOverall = 'OUTREACH_READY' | 'RESEARCH_MORE' | 'NO_GO';

export interface IcpQualification {
  overall: IcpOverall;
  fit: IcpFit;
  dimensions: IcpDimension[];
  reasons: string[];
  /** The single strict gate, if any, that blocked an OUTREACH_READY. */
  gated_reason?: string;
}

export interface VerifiedFinding extends DeepSignal {
  verification_timestamp: string;
  proof_contract_id: string;
  verification_reasons: string[];
  _verified: true;
  
  // --- Q-Core Governance & Semantic Context ---
  technical_area: string;
  technical_mechanism: string;
  expected_behavior: string;
  materiality: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  requires_authorized_assessment: boolean;
  decision_candidate: string;
  policy_reference: string;
  entry_point_id: string;
  expectation_id: string;
  differential_id: string;
  hypothesis_id: string;
  
  // --- Provenance Integrity (from verification analysis) ---
  contradictory_evidence_ids: string[];
  uncertainty: string[];
  benign_explanation: string;
}

// ── Email ────────────────────────────────────────────────────────────────────

export interface DeepEmailDraft {
  primary_subject: string;
  alternate_subject: string;
  body: string;
  /** Claims reused from the engine's FindingLedEmail — evidence IDs preserved. */
  claims: EvidenceClaim[];
  generated: boolean;
  blocked_reason?: string;
}

export interface DeepFinding {
  /** Mirrors FindingClassification so it can drive the engine/ICP gate. */
  finding_type: FindingType;
  impact_severity: SeverityLevel;
  severity_basis: string;
  /** Public evidence backing the finding — IDs preserved end-to-end. */
  evidence_ids: string[];
  source_urls: string[];
  provenance: EvidenceProvenance;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  strength: FindingStrength;
  /** Plain-language explanation of why it qualifies (and what it does NOT claim). */
  explanation: string;
  recommendation: string;
}

// ── Dossier / decision ───────────────────────────────────────────────────────

export type DeepDecision = 'OUTREACH_READY' | 'RESEARCH_MORE' | 'NO_GO';
export type DeepConfidence = 'LOW' | 'MEDIUM' | 'HIGH';

/** Fields of a commercial outreach card (problem-first, contact secondary). */
export interface OutreachCardFields {
  company: string;
  company_url: string;
  person: string;
  role: string;
  contact: string;
  contact_status: string;
  why_this_person: string;
  problem: string;
  finding_type: string;
  primary_source: string;
  supporting_sources: string[];
  supporting_evidence: string[];
  technical_area: string;
  recommended_responsibility: string;
  role_search_hints: string[];
  subject: string;
  email: string;
  backup_subject: string;
  backup_email: string;
  reply_evidence_pack: { claim_type: string; text: string; evidence_ids: string[] }[];
  diagnostic_angle: string;
  confidence: string;
  diagnostic_potential: string;
  next_action: string;
}
/**
 * Commercial relevance classification — an internal workflow signal, NOT a
 * claim about the company's internal state. Answers: "Is there enough public
 * evidence that a paid diagnostic could reasonably investigate this area?"
 */
export type CommercialRelevance =
  | 'HIGH_DIAGNOSTIC_POTENTIAL'
  | 'MEDIUM_DIAGNOSTIC_POTENTIAL'
  | 'LOW_DIAGNOSTIC_POTENTIAL'
  | 'RESEARCH_MORE';

/** Technical problem category used to route a DiagnosticOpportunity. */
export type TechnicalProblemType =
  | 'API_BEHAVIOR'
  | 'PERFORMANCE_LATENCY'
  | 'AVAILABILITY'
  | 'SCALING_CAPACITY'
  | 'PUBLIC_EXPOSURE'
  | 'CONFIGURATION'
  | 'DATABASE_STORAGE'
  | 'ARCHITECTURE'
  | 'SECURITY_POSTURE'
  | 'DEPLOYMENT_PLATFORM'
  | 'RELIABILITY'
  | 'INFO_DISCLOSURE'
  | 'ACCESS_BOUNDARY'
  | 'GENERAL_ENGINEERING'
  | 'NEEDS_RESEARCH';

/**
 * A diagnostic opportunity — the core commercial output of VARDHAN.
 * Represents a company/problem pair with enough public evidence that a £15K
 * diagnostic engagement could reasonably investigate the area.
 *
 * It does NOT claim a problem exists internally — it proposes a diagnostic
 * hypothesis backed by observable public evidence.
 */
export interface DiagnosticOpportunity {
  company: string;
  company_url: string;

  problem: string;
  problem_type: TechnicalProblemType;

  /** Why this is worth a diagnostic — derived strictly from evidence. */
  why_it_matters: string;

  /** IDs of evidence records backing the finding (traceable). */
  evidence_ids: string[];
  /** Source URLs of the primary evidence. */
  primary_sources: string[];

  /** IDs of supporting signals (correlations). */
  signal_ids: string[];
  /** IDs of correlation groups backing the finding. */
  correlation_ids: string[];
  supporting_sources: string[];

  technical_area: string;
  recommended_responsibility: string;
  role_keywords: string[];
  search_hints: string[];

  /** 5–8 diagnostic questions, generated from evidence only. */
  diagnostic_questions: string[];
  /** Proposed scope items for a £15K diagnostic. */
  diagnostic_scope: string[];

  /** The finding that backs this opportunity. */
  finding_type: FindingType;
  finding_confidence: 'LOW' | 'MEDIUM' | 'HIGH';

  commercial_relevance: CommercialRelevance;
  decision: DeepDecision;
  confidence: DeepConfidence;
}

export interface DeepProspect {
  company: string;
  domain: string;
  industry: string;
  fit: IcpFit;
  qualification_reasons: string[];
  public_surface: CompanySurface;
  technical_signals: DeepSignal[];
  documented_facts: DeepSignal[];
  public_observations: DeepSignal[];
  inferences: DeepSignal[];
  people: OwnerCandidate[];
  owner_candidates: OwnerCandidate[];
  selected_owner: DeepOwner | null;
  owner_evidence: string[];
  contactability: DeepContact[];
  /** Status of contact verification — distinguishes owner-verified email from
   * company/role mailboxes and unverified profiles. */
  contact_status: 'OWNER_VERIFIED_EMAIL' | 'COMPANY_BUSINESS_EMAIL' | 'UNVERIFIED_POSSIBLE_EMAIL' | 'PUBLIC_PROFESSIONAL_CONTACT' | 'CONTACT_PAGE' | 'NO_VERIFIED_CONTACT';
  findings: FindingClassification | null;
  /** Deep-layer finding (supplements `findings` with evidence IDs + provenance). */
  deep_finding: DeepFinding | null;
  evidence: Evidence[];
  primary_angle: string;
  secondary_angle: string | null;
  recommended_subjects: string[];
  email_draft: DeepEmailDraft;
  decision: DeepDecision;
  confidence: DeepConfidence;
  artifact_path: string;
  audit_trail: string[];
  /** Full link to the engine case for end-to-end lineage. */
  case_ref?: IntelligenceCase;
  /** Growjo lead data that seeded this company (provenance-preserved). */
  growjo_data?: GrowjoCompany | null;
  /** Additional provider companies that seeded this company (non-Growjo). */
  provider_data?: ProviderCompanyLike[] | null;
  /** Domain resolution provenance (canonical name, official domain, method, confidence). */
  resolution?: CompanyResolution | null;
  /** GitHub activity discovered on the company's own public pages. */
  github_activity?: GithubRepoMeta[];
  /** Synthesized activity timeline (findings + evidence + GitHub, provenance-tracked). */
  activity_timeline?: ActivityEvent[];
  /** Data sufficiency assessment (dataset check + live-web trigger). */
  data_sufficiency?: {
    sufficient: boolean;
    needs_live_research: boolean;
    missing: string[];
    stale: string[];
    reasons: string[];
  };
  /** Live-web research results (evidence, search queries, github repos from search). */
  live_web_evidence?: Evidence[];
  /** Search queries executed during live-web research (audit trail). */
  search_queries?: { query: string; results: number; cached: boolean }[];
  /** Outreach card for manual contact (problem-first, contact secondary). */
  outreach_card?: Partial<OutreachCardFields>;
  /** Diagnostic opportunity derived from the public finding (commercial intelligence). */
  diagnostic_opportunity?: DiagnosticOpportunity | null;
  /** Whether live-web research was performed (search + augmentation). */
  live_web_researched?: boolean;
  /** Change-detection diff (new/changed/unchanged) vs. previously stored state. */
  changes?: ChangeRecord[];
  /** Adaptive investigation telemetry — structured records of pivot attempts
   * and boundary-aware discovery. Present on all prospects; `attempted` is
   * false when no adaptive investigation occurred. */
  adaptive_investigation?: {
    attempted: boolean;
    records: import('./AdaptiveInvestigationEngine').AdaptiveInvestigationRecord[];
    aggregate: import('./AdaptiveInvestigationEngine').AdaptiveInvestigationAggregate;
  };
  /** Entry Point Intelligence — full externally-observable technical perimeter. */
  entry_points?: import('./EntryPointModel').EntryPoint[];
  /** Entry-point aggregate telemetry (coverage, attribution, verification rates). */
  entry_point_telemetry?: import('./EntryPointModel').EntryPointTelemetry;
  /** Entry-point relationship graph (directed, evidence-backed edges). */
  entry_point_graph?: import('./EntryPointModel').EntryPointGraph;
  /** Entry-point changes detected vs. prior run (empty array if no prior). */
  entry_point_changes?: import('./EntryPointModel').EntryPointChange[];
  /** Expected-behavior models generated for entry points (evidence-backed). */
  expectations?: import('./findings/ProblemFinding').ExpectedBehavior[];
  /** Behavioral differentials (expected vs. observed) for entry points. */
  differentials?: import('./findings/ProblemFinding').BehaviorDifferential[];
  /** Behavioral observations used for differential analysis. */
  observations?: import('./findings/ProblemFinding').BehavioralObservation[];
  /** Technical problem findings (verification-eligible surfaces, evidence-backed). */
  technical_findings?: import('./findings/ProblemFinding').ProblemFinding[];
  /** Investigation plans generated for entry points. */
  investigation_plans?: import('./findings/ProblemFinding').InvestigationPlan[];
}

// ── Builder I/O ─�────────────────────────────────────────────────────────────

/** Progressive stage events emitted while research runs. */
export type DeepStage =
  | 'company' | 'completeness' | 'search' | 'sources'
  | 'engineering' | 'deepening' | 'verification'
  | 'qualification' | 'surface'
  | 'signals' | 'findings' | 'people' | 'owners' | 'evidence'
  | 'contactability' | 'email' | 'decision';

export interface DeepBuilderOptions {
  /** Injectable fetcher (defaults to globalThis.fetch in PRODUCTION). */
  fetcher?: (url: string, init: { method: string; headers: Record<string, string>; signal: AbortSignal }) => Promise<Response>;
  /** Inject a live/mock observation provider; null => LivePublicObservationProvider (real). */
  observationProvider?: PublicObservationProviderLike | null;
  maxDiscoveryPages?: number;
  discoveryDelayMs?: number;
  discoveryTimeoutMs?: number;
  observationDelayMs?: number;
  /** Persist artifact when true; provide a path to write. */
  saveArtifact?: (path: string, data: string) => void;
  /** Progressive stage output (human readable). */
  onProgress?: (stage: DeepStage, message: string) => void;
  /** Optional logger mirroring the operator's discovery diagnostics. */
  logger?: (msg: string) => void;
  artifactsBaseDir?: string;
  /** Growjo lead data that seeded this company (provenance-preserved). */
  growjo?: GrowjoCompany | null;
  /** Additional provider companies (CSV, PublicDataset, etc.) — optional, non-Growjo sources. */
  providerCompanies?: ProviderCompanyLike[] | null;
  /** Pre-resolved canonical domain (from DomainResolver); null if not yet resolved. */
  resolution?: CompanyResolution | null;
  /** Override the search provider (for testing / injectable search). */
  searchProvider?: any;
  /** Inject a StatePersistence instance (for resume / refresh / changes). */
  statePersistence?: any;
  /** Skip live-web research entirely (use dataset/surface only). */
  skipLiveWebResearch?: boolean;
  /** Enable adaptive investigation layer (default: false). When enabled,
   * the builder runs an AdaptiveInvestigationEngine after the standard
   * pipeline and attaches structured telemetry to the prospect. */
  enableAdaptiveInvestigation?: boolean;
  /** Options for the adaptive investigation engine. */
  adaptiveInvestigationOptions?: import('./AdaptiveInvestigationEngine').AdaptiveInvestigationOptions;
}

/** Minimal interface the builder relies on from the live provider. */
export interface PublicObservationProviderLike {
  observePublicSurface(url: string, options?: { timeoutMs?: number; headers?: Record<string, string> }): Promise<{ evidence: Evidence[]; discovery_errors: number }>;
}

// ── Growjo input model ──────────────────────────────────────────────────────

export type GrowjoSource = 'GROWJO';

/**
 * Minimal structural view of a provider company that the OwnerPipeline
 * can accept from ANY provider (Growjo, CSV, PublicDataset, etc.).
 * Every field is checked against the company under research; if no person
 * or domain is available, the role-match gate naturally rejects the candidate
 * — no owners are invented.
 */
export interface ProviderCompanyLike {
  source: string;
  company: string;
  canonical_name: string;
  domain: string | null;
  website: string | null;
  primary_person_name: string | null;
  primary_title: string | null;
  primary_email: string | null;
  primary_phone: string | null;
  linkedin_url: string | null;
  growjo_url: string | null;
  source_url: string | null;
  retrieved_at: string;
}

/**
 * Canonical lead record imported from a Growjo CSV export / licensed API.
 * Every field preserves its provenance: source, source_url, retrieved_at.
 * Numeric estimates are explicitly typed as such — never silently promoted
 * to internal "facts".
 */
export interface GrowjoCompany {
  source: GrowjoSource;
  /** The list/company name exactly as imported. */
  company: string;
  /** Canonical display name (trimmed). */
  canonical_name: string;
  /** Primary domain (may be absent). */
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
  /** A single verified professional contact (if legitimately licensed). */
  primary_person_name: string | null;
  primary_title: string | null;
  primary_email: string | null;
  primary_phone: string | null;
  linkedin_url: string | null;
  growjo_url: string | null;
  source_url: string | null;
  retrieved_at: string;
  /** Original column alias mapping that produced this record. */
  column_mapping: Record<string, string>;
  /** Raw imported row (for audit). */
  raw: Record<string, string>;
}

export interface CompanyResolution {
  canonical_name: string;
  official_domain: string | null;
  /** How the domain was resolved (never guessed). */
  resolution_method: 'GROWJO_DOMAIN' | 'GROWJO_HOMEPAGE_CANONICAL' | 'PUBLIC_REDIRECT' | 'PUBLIC_CANONICAL_LINK' | 'OGP_URL' | 'AMBIGUOUS';
  /** Public source that backs the resolution. */
  resolution_source: string | null;
  resolution_confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface GithubRepoMeta {
  org: string;
  repo: string;
  url: string;
  /** How the link to this repo/org was discovered (a public page on the company domain). */
  discovered_via: string;
  stars: number | null;
  language: string | null;
  description: string | null;
  updated_at: string | null;
}

export type ActivityType =
  | 'TECHNICAL_SIGNAL' | 'PUBLIC_INCIDENT' | 'ENGINEERING_RELEASE'
  | 'SECURITY_UPDATE' | 'STATUS_DEGRADATION' | 'HIRING_FOR_ROLE'
  | 'ARCHITECTURE_CHANGE';

export interface ActivityEvent {
  activity_id: string;
  company_id: string;
  type: ActivityType;
  source_url: string;
  title: string;
  published_at: string | null;
  observed_at: string;
  evidence: string;
  provenance: 'DOCUMENTED_FACT' | 'REAL_PUBLIC_OBSERVATION' | 'VARDHAN_INFERENCE';
  strength: 'LOW' | 'MEDIUM' | 'HIGH';
  related_evidence_ids: string[];
}

// ── Outreach Intelligence ───────────────────────────────────────────────────────

export type ClaimType =
  | 'SOURCE_FACT'
  | 'VARDHAN_OBSERVATION'
  | 'VARDHAN_INFERENCE'
  | 'UNSUPPORTED_ASSUMPTION';

export interface OutreachClaim {
  claim_id: string;
  text: string;
  type: ClaimType;
  supporting_evidence_ids: string[];
  supporting_signal_ids: string[];
  supporting_correlation_ids: string[];
  confidence: number;
  allowed_in_email: boolean;
  reason?: string;
}

export interface EvidencePack {
  primary_finding: DeepFinding;
  supporting_evidence: Evidence[];
  evidence_ids: string[];
}

export type OutreachStrategyType =
  | 'EVIDENCE_FIRST'
  | 'TECHNICAL_OBSERVATION'
  | 'QUESTION_LED'
  | 'CURIOSITY_LED'
  | 'PEER_TO_PEER'
  | 'DIAGNOSTIC_CONTEXT';

export interface OutreachStrategy {
  type: OutreachStrategyType;
  justification: string;
  angle: string;
  tone_constraints: string[];
}

export interface OutreachInput {
  opportunity_id: string;
  company_id: string;
  company_name: string;
  person_id: string;
  recipient_name: string;
  recipient_role: string;
  opportunity_type: string;
  subsystem: string;
  qualified_signal_ids: string[];
  correlation_ids: string[];
  evidence_ids: string[];
  source_urls: string[];
  key_observation: string;
  technical_context: string;
  owner_reason: string;
  contactability: DeepContact[];
  freshness: string;
  confidence_dimensions: Record<string, number>;
  source_relationships: string[];
}

export interface OutreachQualityScore {
  evidence_specificity: number;
  recipient_relevance: number;
  technical_relevance: number;
  claim_support: number;
  naturalness: number;
  brevity: number;
  cta_quality: number;
  reasoning: Record<string, string>;
}

export type OutreachValidationStatus = 'SUPPORTED' | 'INFERENCE' | 'UNSUPPORTED';

export interface OutreachValidationResult {
  sentence: string;
  claim_id: string;
  status: OutreachValidationStatus;
  evidence_id?: string;
  reason?: string;
}

export interface OutreachPackage {
  recipient: {
    name: string;
    role: string;
    email: string;
  };
  subject: string;
  body: string;
  opportunity_id: string;
  evidence_pack_id: string;
  claim_ledger: OutreachClaim[];
  quality_score: OutreachQualityScore;
  verification_state: 'VERIFIED' | 'BLOCKED' | 'NEEDS_REVIEW';
  qa_status: 'QA_PASSED' | 'QA_FAILED';
  next_action: 'HUMAN_REVIEW' | 'BLOCKED';
}

export type ContactStatus =
  | 'VERIFIED_EMAIL'
  | 'PUBLIC_BUSINESS_CONTACT'
  | 'LICENSED_PROVIDER_CONTACT'
  | 'UNVERIFIED_POSSIBLE_EMAIL'
  | 'NO_VERIFIED_CONTACT';

export interface ManualOutreachCard {
  company: string;
  person: string;
  role: string;
  contact: string;
  contactStatus: ContactStatus;
  whyThisPerson: string;
  finding: string;
  primarySource: string;
  subject: string;
  email: string;
  backupSubject: string;
  backupEmail: string;
  replyEvidencePack: string;
  confidence: DeepConfidence;
}

export type QueueState =
  | 'QUEUED' | 'RESOLVING' | 'RESEARCHING' | 'RESEARCH_MORE'
  | 'NO_GO' | 'OUTREACH_READY' | 'CONTACT_READY' | 'APPROVED' | 'SENT';

export interface QueuedCompany {
  id: string;
  company: string;
  domain: string | null;
  state: QueueState;
  growjo?: GrowjoCompany | null;
  resolution?: CompanyResolution | null;
  artifact_path: string | null;
  prospect: { decision: DeepDecision; finding: string | null; owner: string | null; confidence: DeepConfidence } | null;
  attempt: number;
  last_error: string | null;
  enqueued_at: string;
  updated_at: string;
}

export interface DeepBuilderResult {
  prospect: DeepProspect;
  case_ref?: IntelligenceCase;
}

// ── Intelligence Run Context ─────────────────────────────────────────────────
export interface IntelligenceRunContext {
  engine_identity: string;      // e.g., 'VARDHAN_INTELLIGENCE_CORE'
  engine_version: string;       // e.g., '2.4.1'
  run_id: string;               // Unique execution ID
  organization_id: string;      // The canonical organization identity (tenant mapping)
  target_canonical_domain: string; // The primary domain being investigated
  /** Authorized workload identity for Q-Core API submission. Comes from the execution platform, never hardcoded. */
  actor_workload_id: string;
}
