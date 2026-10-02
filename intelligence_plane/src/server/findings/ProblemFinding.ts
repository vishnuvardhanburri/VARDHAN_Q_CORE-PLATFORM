/**
 * VARDHAN — PROBLEM FINDING ARTIFACT (§10)
 * ─────────────────────────────────────────────────────────────────────────────
 * A structured, independently-inspectable record of a technically meaningful,
 * evidence-backed problem discovered about an entry point.
 *
 * Finding progression:
 *   OBSERVATION → SIGNAL → CORRELATED_SIGNAL → HYPOTHESIS → VERIFICATION → FINDING
 *
 * A finding must require stronger evidence than a signal.
 * A signal must require stronger evidence than a raw observation.
 */

import type { EvidenceProvenance } from '../DeepTypes';
import type { EntryPoint } from '../EntryPointModel';

// ── Progression Stages ────────────────────────────────────────────────────────

/** Raw, uninterpreted technical observation from evidence. */
export interface TechnicalObservation {
  /** Stable identifier for this observation. */
  observation_id: string;
  /** What category of thing was observed. */
  category: ObservationCategory;
  /** The entry point this observation is about. */
  entry_point_id: string;
  /** The canonical URL of the entry point. */
  surface_url: string;
  /** Machine-readable summary of what was observed. */
  summary: string;
  /** Verbatim or excerpt evidence text supporting the observation. */
  evidence_ids: string[];
  /** Provenance of the underlying evidence. */
  evidence_provenance: EvidenceProvenance[];
  /** Confidence the observation is real (not a fluke). */
  reproducibility: 'SINGLE' | 'REPRODUCED' | 'NOT_REPRODUCED';
  /** Latency in ms if measured. */
  latency_ms?: number;
  /** HTTP status code if observed. */
  status_code?: number;
  /** When this observation was made. */
  observed_at: string;
  /** Optional raw data associated with the observation. */
  raw?: Record<string, unknown>;
}

/** Categories of technical observations appropriate for each surface type. */
export type ObservationCategory =
  | 'RESPONSE_BEHAVIOR'     // HTTP status, redirects, response timing
  | 'AUTH_BEHAVIOR'         // Authentication flows, token handling, redirects
  | 'DOCUMENTED_OPERATION'  // API operations documented but not observed
  | 'VERSIONING'            // Version information, deprecation notices
  | 'ERROR_BEHAVIOR'        // Error responses, error handling patterns
  | 'CONSISTENCY'           // Consistency across requests/reproductions
  | 'PERFORMANCE'           // Latency, throughput, reliability
  | 'CONFIGURATION'         // Security headers, config exposure, debug mode
  | 'UNEXPECTED_PUBLIC'     // Unexpectedly public resources (directories, files)
  | 'CLIENT_SERVER_RELATIONSHIP' // References between client and server surfaces
  | 'IDENTITY_PROVIDER'     // IdP relationships, OAu th/OIDC endpoints
  | 'SESSION_BEHAVIOR'      // Session handling, token lifecycle
  | 'SERVICE_RELATIONSHIP'  // Relationship to other services
  | 'MIGRATION_RELATIONSHIP' // Legacy → current migration references
  | 'INCIDENT_REFERENCE'    // References to incidents/outages
  | 'TECHNOLOGY_FINGERPRINT'; // Server/framework version information

/** A signal derived from one or more observations. */
export interface TechnicalSignal {
  /** Stable identifier. */
  signal_id: string;
  /** What kind of signal this is. */
  type: SignalType;
  /** Observations that contributed to this signal. */
  observation_ids: string[];
  /** Evidence IDs backing the observations. */
  evidence_ids: string[];
  /** Human-readable summary. */
  summary: string;
  /** Confidence in the signal (0–1). */
  confidence: number;
  /** Why this signal is relevant. */
  relevance: string;
  /** When generated. */
  generated_at: string;
}

/** Types of technical signals. */
export type SignalType =
  | 'AUTHENTICATION_BOUNDARY'     // Public auth flow with specific characteristics
  | 'PUBLIC_EXPENSE_ENDPOINT'    // Endpoint exposing resource enumeration
  | 'INCONSISTENT_AUTH_BEHAVIOR' // Same endpoint behaves differently across calls
  | 'EXPOSED_CONFIGURATION'      // Config/keys/debug info publicly accessible
  | 'PUBLIC_DIRECTORY_LISTING'   // Directory listing or file enumeration possible
  | 'DEPRECATED_OPERATION'       // API operation marked deprecated in docs
  | 'VERSION_DISCLOSURE'         // Server/framework version leaked
  | 'INSECURE_REDIRECT'         // HTTP → HTTP redirect (no TLS upgrade)
  | 'UNAUTHENTICATED_RESOURCE_ACCESS' // Sensitive resources accessible without auth
  | 'MISSING_SECURITY_HEADER'   // Critical security header absent
  | 'RATE_LIMIT_BYPASS'          // Rate limiting inconsistently applied
  | 'EXPOSED_SENSITIVE_ENDPOINT' // Endpoint exposing sensitive operation without auth
  | 'MISCONFIGURED_CORS'         // CORS allows unwanted origins
  | 'INFORMATION_DISCLOSURE'     // Error messages reveal internal details
  | 'HISTORICAL_SURFACE_REMAINS' // Legacy/deprecated surface still active
  | 'API_VERSION_INCONSISTENCY'  // Multiple versions with inconsistent behavior
  | 'SERVICE_ACCOUNT_EXPOSURE'   // Service account info publicly accessible
  | 'TOKEN_ENDPOINT_MISUSE'      // Token endpoint accessible without proper safeguards
  | 'PUBLIC_SSO_MISCONFIG'       // SSO/IdP configuration exposed
  | 'UNPROTECTED_HEALTH_ENDPOINT' // Health/status endpoint exposing internals
  | 'IDENTITY_PROVIDER';         // Identity provider endpoint exposed

/** Multiple signals that correlate to a single technical theme. */
export interface CorrelatedSignal {
  /** Stable identifier. */
  correlation_id: string;
  /** The technical theme. */
  theme: CorrelationTheme;
  /** Signals in this correlated group. */
  signal_ids: string[];
  /** Independent source domains contributing. */
  independent_sources: string[];
  /** How many independent sources corroborate. */
  source_count: number;
  /** Explanation of why these signals correlate. */
  explanation: string;
  /** Correlation strength (0–1). */
  strength: number;
  /** Evidence IDs across all correlated signals. */
  evidence_ids: string[];
}

/** Themes that multiple signals can corroborate. */
export type CorrelationTheme =
  | 'ACCESS_CONTROL_GAP'      // Inconsistent auth across surfaces
  | 'SURFACE_OVEREXPOSURE'    // Too many surfaces publicly reachable
  | 'DEPRECATION_RISK'        // Deprecated surfaces still active or referenced
  | 'INFORMATION_LEAKAGE'     // Multiple disclosures of the same info
  | 'VERSION_INCONSISTENCY'   // Different versions serving inconsistent behavior
  | 'CONFIGURATION_DRIFT'     // Config exposed across multiple entry points
  | 'IDENTITY_SURFACE_EXPOSURE' // Auth/identity surfaces misconfigured
  | 'INFRASTRUCTURE_LEAKAGE'  // Internal infrastructure details disclosed
  | 'INCIDENT_PATTERN'        // Recurring incident-related indicators
  | 'MIGRATION_INCOMPLETE'    // Migration references without full cutover

/** A working hypothesis about a technical problem. */
export interface ProblemHypothesis {
  /** Stable identifier. */
  hypothesis_id: string;
  /** What the hypothesis claims. */
  claim: string;
  /** Confidence before verification (0–1). */
  pre_verification_confidence: number;
  /** Evidence IDs supporting the hypothesis. */
  evidence_ids: string[];
  /** What verification approach is needed. */
  verification_approach: string;
  /** What evidence would refute this hypothesis. */
  refutation_criteria: string[];
  /** Technical context: surface type, auth model, etc. */
  technical_context: string;
}

/** Result of verifying a hypothesis. */
export interface VerificationResult {
  /** Whether the hypothesis was verified. */
  is_verified: boolean;
  /** Status of verification. */
  status: 'VERIFIED' | 'REFUTED' | 'INCONCLUSIVE' | 'INSUFFICIENT_EVIDENCE';
  /** Evidence IDs that verified or refuted. */
  evidence_ids: string[];
  /** Explanation of the verification outcome. */
  explanation: string;
  /** Remaining uncertainties after verification. */
  remaining_uncertainties: string[];
}

/** Decision on whether this is a finding worth investigating. */
export type ProblemDecision =
  | 'WORTH_INVESTIGATING'  // Evidence-backed problem justifying diagnostic investigation
  | 'RESEARCH_MORE'        // Signal exists but needs more corroboration
  | 'NOT_A_PROBLEM'        // Normal behavior, not an issue
  | 'INSUFFICIENT_EVIDENCE' // Signal too thin to promote
  | 'DUPLICATE'            // Already captured in a prior finding
  | 'UNSUPPORTED_INFERENCE' // Cannot be supported by available evidence; no verification path

// ── Expected-Behavior + Differential Finding (§NEW) ─────────────────────────

/**
 * The type of expected behavior an entry point should exhibit, derived from
 * evidence-backed knowledge about how the surface should behave.
 */
export type ExpectationType =
  | 'AUTH_REQUIRED'
  | 'AUTH_NOT_REQUIRED'
  | 'PUBLIC_CONTENT'
  | 'API_PUBLIC_RESPONSE'
  | 'DOCUMENTED_OPERATION'
  | 'DOCUMENTED_API_OPERATION'
  | 'PROTECTED_RESOURCE'
  | 'PUBLIC_OPERATION'
  | 'VERSIONED_OPERATION'
  | 'STATUS_BEHAVIOR'
  | 'SECURITY_CONTROL'
  | 'PERFORMANCE_BASELINE'
  | 'BOUNDARY_BEHAVIOR'
  | 'HISTORICAL_EXPECTATION'
  | 'UNKNOWN';

/**
 * How the expected behavior was established — always evidence-backed.
 */
export type ExpectationSource =
  | 'EXPLICIT_DOCUMENTATION'
  | 'PUBLIC_API_DOCUMENTATION'
  | 'PUBLIC_CLIENT_CODE'
  | 'PUBLIC_SECURITY_STATEMENT'
  | 'PUBLIC_ARCHITECTURE_EVIDENCE'
  | 'OBSERVED_NORMAL_BEHAVIOR'
  | 'MULTI_SOURCE_CORRELATION'
  | 'HISTORICAL_SOURCE';

/**
 * Evidence-backed expected behavior for a single aspect of an entry point.
 *
 * Expectations are NEVER inferred from URL naming, path structure, or
 * technology fingerprinting alone. Each expectation requires at least one
 * evidence record backing its claim.
 */
export interface ExpectedBehavior {
  /** Stable identifier for this expectation. */
  expectation_id: string;
  /** The entry point this expectation applies to. */
  entry_point_id: string;

  /** What category of behavior is expected. */
  expectation_type: ExpectationType;

  /** Human-readable statement of what is expected. */
  statement: string;

  /** The evidence source that established this expectation. */
  source: ExpectationSource;
  /** Evidence IDs backing this expectation. */
  evidence_ids: string[];

  /** Expected authentication behavior. */
  expected_authentication?: 'REQUIRED' | 'NOT_REQUIRED' | 'UNKNOWN';
  /** Expected authorization behavior. */
  expected_authorization?: 'REQUIRED' | 'NOT_REQUIRED' | 'UNKNOWN';

  /** Expected HTTP status codes for an unauthenticated request. */
  expected_status_codes?: number[];
  /** Expected content types for the response. */
  expected_content_type?: string[];

  /** Behavioral properties expected (e.g. "returns_401_without_jwt"). */
  expected_behavioral_properties?: string[];

  /** Whether this expectation reflects the current state (vs historical only). */
  current: boolean;
  /** Whether this expectation is based on historical evidence. */
  historical: boolean;

  /**
   * Whether every evidence_id backing this expectation satisfies the
   * provenance invariant:
   *   1. evidence.public_url canonicalizes to the same resource as entry_point.canonical_url
   *   2. evidence.temporal_status is not 'HISTORICAL'
   *   3. evidence.evidence_origin is a recognized public-observation origin
   * If false, the expectation should NOT be trusted for differential analysis.
   */
  expectation_provenance_valid: boolean;
  /** Evidence IDs that failed the provenance invariant (if any). */
  invalid_evidence_ids: string[];
  /** Human-readable explanation of provenance validation failures (empty if valid). */
  provenance_details: string[];

  /** Confidence in the expectation. */
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';

  /** What we do not know about this expectation. */
  uncertainty: string[];

  /** When this expectation was generated. */
  generated_at: string;
}

/**
 * The state of a comparison between expected and observed behavior.
 */
export type DifferentialState =
  | 'MATCH'
  | 'MISMATCH'
  | 'POSSIBLE_MISMATCH'
  | 'INSUFFICIENT_EVIDENCE'
  | 'UNVERIFIABLE'
  | 'HISTORICAL_ONLY';

/**
 * Materiality of a behavioral differential — determines whether it can
 * advance toward a finding.
 */
export type DifferentialMateriality = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN';

/**
 * A factual observation of runtime behavior, captured for differential
 * comparison. Each observation is backed by evidence.
 */
export interface BehavioralObservation {
  /** Stable identifier for this observation. */
  observation_id: string;
  /** The entry point this observation is about. */
  entry_point_id: string;

  url: string;
  method: string;

  /** HTTP status code if observed. */
  status_code?: number;
  /** Content-Type of the response, if observed. */
  content_type?: string;
  /** Response body size in bytes, if measured. */
  response_size?: number;

  /** Authentication state at the time of observation. */
  authentication_state: 'UNAUTHENTICATED' | 'AUTHENTICATED' | 'UNKNOWN';

  /** Machine-readable summary of what was observed. */
  observed_behavior: string;

  /** Evidence IDs backing this observation. */
  evidence_ids: string[];

  /** Whether this observation has been reproduced. */
  repeatable: boolean;

  /** When this observation was made. */
  retrieved_at: string;
}

/**
 * A structured comparison of expected vs. observed behavior for an entry point.
 */
export interface BehaviorDifferential {
  /** Stable identifier for this differential. */
  differential_id: string;

  /** The entry point this differential is about. */
  entry_point_id: string;

  /** The expectation being compared. */
  expectation_id: string;
  /** Observation IDs that were compared against the expectation. */
  observation_ids: string[];

  /** The result of the comparison. */
  state: DifferentialState;

  /** What was expected (human-readable). */
  expected: string;
  /** What was observed (human-readable). */
  observed: string;

  /** Evidence IDs supporting this differential. */
  supporting_evidence_ids: string[];
  /** Evidence IDs contradicting this differential. */
  contradiction_evidence_ids: string[];

  /** How severe the differential is. */
  materiality: DifferentialMateriality;

  /** Confidence in the differential (0–1). */
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';

  /** Step-by-step reasoning for the differential classification. */
  reasoning: string[];

  /** Whether verification is needed to confirm this differential. */
  verification_required: boolean;

  /** When this differential was generated. */
  generated_at: string;
}

/**
 * A plan for the next useful public observation about an entry point.
 * The planner never produces plans that require authentication, credential
 * attacks, brute force, or private-data access.
 */
export interface InvestigationPlan {
  /** Stable identifier for this plan. */
  plan_id: string;

  /** The entry point this plan is for. */
  entry_point_id: string;

  /** Why this plan is the next most useful action. */
  reason: string;

  /** What the plan is trying to establish. */
  objective: string;

  /** The action to take. */
  action:
    | 'OBSERVE_PUBLIC_RESPONSE'
    | 'INSPECT_PUBLIC_JS'
    | 'FOLLOW_DOCUMENTED_OPERATION'
    | 'FOLLOW_PUBLIC_RELATION'
    | 'COMPARE_BEHAVIOR'
    | 'RECHECK'
    | 'STOP';

  /** URLs or targets to observe (all public, unauthenticated). */
  candidate_targets: string[];

  /** Evidence IDs that this plan depends on or will validate. */
  required_evidence: string[];

  /** What success looks like for this plan. */
  success_condition: string;

  /** What causes this plan to stop early. */
  stop_condition: string;

  /** Whether this plan requires authentication (always false in PUBLIC mode). */
  authorization_required: boolean;
}

/**
 * A structured, independently-inspectable problem finding.
 *
 * This is the terminal artifact of the observation → signal → hypothesis →
 * verification pipeline. Every field is grounded in evidence.
 */
export interface ProblemFinding {
  /** Stable finding identifier. */
  finding_id: string;
  /** The entry point this finding is about. */
  entry_point_id: string;
  /** The surface URL. */
  surface: string;
  /** The canonical URL of the entry point. */
  canonical_url: string;
  /** Surface type of the entry point. */
  surface_type: string;
  /** Other entry point IDs that contributed evidence to this finding (for multi-EP hypotheses). */
  contributing_entry_point_ids: string[];
  /** Technical context: what kind of surface, tech, auth model. */
  technical_context: string;
  /**
   * The progression of evidence that led to this finding.
   * Each stage requires stronger evidence than the previous.
   */
  observations: TechnicalObservation[];
  signals: TechnicalSignal[];
  correlated_signals: CorrelatedSignal[];
  hypothesis: ProblemHypothesis;
  verification_result: VerificationResult;
  /** Evidence IDs directly backing this finding. */
  evidence_ids: string[];
  /** All evidence IDs touched by the finding chain. */
  all_evidence_ids: string[];
  /** Final confidence in the finding (0–1). */
  confidence: number;
  /** What we don't know / remaining uncertainties. */
  uncertainties: string[];
  /** Final decision: is this worth investigating? */
  decision: ProblemDecision;
  /** Why this decision was reached. */
  decision_reasoning: string;
  /** When this finding was generated. */
  generated_at: string;
  // ── Expected-Behavior + Differential (§NEW) ──────────────────────────
  /** The expected behavior that this finding is grounded in. */
  expectation?: ExpectedBehavior;
  /** The behavioral differential (expected vs. observed) backing this finding. */
  differential?: BehaviorDifferential;
  /** The entry point that this finding is primarily about (full object). */
  entry_point?: EntryPoint;
  /** Investigation plan that led to the observations for this finding. */
  investigation_plan?: InvestigationPlan;
}
