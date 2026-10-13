/**
 * VARDHAN — TECHNICAL PROBLEM DETECTOR (§10)
 * ─────────────────────────────────────────────────────────────────────────────
 * Builds on the trusted EntryPointGraph to detect technically meaningful,
 * evidence-backed problems about verification-eligible physical public surfaces.
 *
 * The detector asks "What technical question can be answered about this entry
 * point?" rather than running a generic scan. For each surface, it applies an
 * observation profile that enumerates what observations are appropriate, then
 * runs them through the progression:
 *
 *   OBSERVATION → SIGNAL → CORRELATED_SIGNAL → HYPOTHESIS → VERIFICATION → FINDING
 *
 * Each stage requires stronger evidence than the previous. A finding that
 * reaches VERIFIED is a ProblemFinding worth investigating.
 *
 * Detection knowledge comes from the existing FindingProofContracts,
 * VardhanNoiseFilter, and SignalCorrelationEngine — used as reference/pattern
 * material, not automatic proof.
 */

import type { Evidence, SignalCandidate } from './IntelligenceCase';
import type { VerifiedFinding } from './DeepTypes';
import type { EntryPoint } from './EntryPointModel';
import type { EntryPointGraph } from './EntryPointModel';
import type { EvidenceProvenance } from './DeepTypes';
import type {
  ProblemFinding,
  TechnicalObservation,
  TechnicalSignal,
  CorrelatedSignal,
  ProblemHypothesis,
  VerificationResult,
  ProblemDecision,
  ObservationCategory,
  SignalType,
  CorrelationTheme,
} from './findings/ProblemFinding';
import { FindingVerificationEngine } from './FindingVerificationEngine';

// ── Detection Knowledge (reference patterns) ──────────────────────────────────

/**
 * Authoritative mapping from CorrelationTheme to Q-Core governance fields.
 *
 * Ownership: TechnicalProblemDetector is the authority for WHICH technical area
 * and mechanism a pattern belongs to. These are factual domain properties of the
 * detection patterns themselves — not inferences made at the Q-Core boundary.
 *
 * policy_reference: The single verified finding policy this detector operates under.
 * requires_authorized_assessment: Public observation does not require authorization.
 * decision_candidate: All verified public-surface findings use SEAL_VERIFIED_FINDING.
 */
const THEME_TO_GOVERNANCE: Record<CorrelationTheme, {
  technical_area: string;
  technical_mechanism: string;
  materiality: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  policy_reference: string;
  requires_authorized_assessment: boolean;
  decision_candidate: string;
}> = {
  ACCESS_CONTROL_GAP:        { technical_area: 'SECURITY',       technical_mechanism: 'BROKEN_ACCESS_CONTROL',    materiality: 'CRITICAL', policy_reference: 'VARDHAN_CORE_INTELLIGENCE_POLICY_V1', requires_authorized_assessment: false, decision_candidate: 'SEAL_VERIFIED_FINDING' },
  SURFACE_OVEREXPOSURE:      { technical_area: 'SECURITY',       technical_mechanism: 'OVEREXPOSED_SURFACE',      materiality: 'HIGH',     policy_reference: 'VARDHAN_CORE_INTELLIGENCE_POLICY_V1', requires_authorized_assessment: false, decision_candidate: 'SEAL_VERIFIED_FINDING' },
  DEPRECATION_RISK:          { technical_area: 'RELIABILITY',    technical_mechanism: 'DEPRECATED_SURFACE',       materiality: 'MEDIUM',   policy_reference: 'VARDHAN_CORE_INTELLIGENCE_POLICY_V1', requires_authorized_assessment: false, decision_candidate: 'SEAL_VERIFIED_FINDING' },
  INFORMATION_LEAKAGE:       { technical_area: 'SECURITY',       technical_mechanism: 'INFORMATION_DISCLOSURE',   materiality: 'HIGH',     policy_reference: 'VARDHAN_CORE_INTELLIGENCE_POLICY_V1', requires_authorized_assessment: false, decision_candidate: 'SEAL_VERIFIED_FINDING' },
  VERSION_INCONSISTENCY:     { technical_area: 'RELIABILITY',    technical_mechanism: 'VERSION_MISMATCH',         materiality: 'MEDIUM',   policy_reference: 'VARDHAN_CORE_INTELLIGENCE_POLICY_V1', requires_authorized_assessment: false, decision_candidate: 'SEAL_VERIFIED_FINDING' },
  CONFIGURATION_DRIFT:       { technical_area: 'SECURITY',       technical_mechanism: 'CONFIGURATION_EXPOSURE',   materiality: 'HIGH',     policy_reference: 'VARDHAN_CORE_INTELLIGENCE_POLICY_V1', requires_authorized_assessment: false, decision_candidate: 'SEAL_VERIFIED_FINDING' },
  IDENTITY_SURFACE_EXPOSURE: { technical_area: 'SECURITY',       technical_mechanism: 'IDENTITY_MISCONFIGURATION',materiality: 'HIGH',     policy_reference: 'VARDHAN_CORE_INTELLIGENCE_POLICY_V1', requires_authorized_assessment: false, decision_candidate: 'SEAL_VERIFIED_FINDING' },
  INFRASTRUCTURE_LEAKAGE:    { technical_area: 'SECURITY',       technical_mechanism: 'INFRASTRUCTURE_DISCLOSURE',materiality: 'HIGH',     policy_reference: 'VARDHAN_CORE_INTELLIGENCE_POLICY_V1', requires_authorized_assessment: false, decision_candidate: 'SEAL_VERIFIED_FINDING' },
  INCIDENT_PATTERN:          { technical_area: 'RELIABILITY',    technical_mechanism: 'INCIDENT_INDICATOR',       materiality: 'HIGH',     policy_reference: 'VARDHAN_CORE_INTELLIGENCE_POLICY_V1', requires_authorized_assessment: false, decision_candidate: 'SEAL_VERIFIED_FINDING' },
  MIGRATION_INCOMPLETE:      { technical_area: 'RELIABILITY',    technical_mechanism: 'INCOMPLETE_MIGRATION',     materiality: 'MEDIUM',   policy_reference: 'VARDHAN_CORE_INTELLIGENCE_POLICY_V1', requires_authorized_assessment: false, decision_candidate: 'SEAL_VERIFIED_FINDING' },
};

/**
 * Detection patterns borrowed from the four security repositories and existing
 * proof contracts. Used as reference knowledge, NOT automatic proof.
 * Each pattern specifies: what to look for, what signal type it maps to, and
 * what minimum evidence is required.
 */
interface DetectionPattern {
  /** Human-readable name. */
  name: string;
  /** What observation category this pattern applies to. */
  category: ObservationCategory;
  /** What signal type this pattern produces (if the observation is suspicious). */
  signalType: SignalType;
  /** What correlation theme this signal contributes to. */
  theme: CorrelationTheme;
  /**
   * The technical question this pattern answers.
   * e.g. "Does this API expose sensitive data without authentication?"
   */
  question: string;
  /** Keywords or patterns to look for in evidence text. */
  indicators: string[];
  /** Minimum evidence items required to even form a signal. */
  minEvidence: number;
  /** Minimum independent sources required to form a signal. */
  minIndependentSources: number;
  /** Whether this requires reproducibility (more than one observation). */
  requireReproducibility: boolean;
}

/**
 * Detection patterns from the four security repositories used as reference:
 *   1. CERT/CC coordination notes
 *   2. OWASP API Security / ASVS patterns
 *   3. NIST SP 800-92 / CAESAT log-analysis patterns
 *   4. MITRE ATT&CK / D3I ecosystem-adversary patterns
 */
const DETECTION_PATTERNS: DetectionPattern[] = [
  // ── OWASP API Security ──
  {
    name: 'OWASP API1:2023 — Broken Object Level Authorization',
    category: 'AUTH_BEHAVIOR',
    signalType: 'AUTHENTICATION_BOUNDARY',
    theme: 'ACCESS_CONTROL_GAP',
    question: 'Does this API endpoint expose per-user resources without verifying ownership?',
    indicators: ['object id', 'user id', 'account id', 'resource id', 'uuid', 'id=', '?id=', '/users/', '/accounts/', 'unauthorized access', 'broken object level authorization'],
    minEvidence: 2,
    minIndependentSources: 1,
    requireReproducibility: true,
  },
  {
    name: 'OWASP API4:2023 — Rate Limiting / No Rate Limiting',
    category: 'RESPONSE_BEHAVIOR',
    signalType: 'RATE_LIMIT_BYPASS',
    theme: 'INFORMATION_LEAKAGE',
    question: 'Does this endpoint allow unauthenticated enumeration without rate limiting?',
    indicators: ['rate limit', 'rate-limit', 'too many requests', '429', 'quota', 'throttle', 'brute force'],
    minEvidence: 2,
    minIndependentSources: 1,
    requireReproducibility: true,
  },
  {
    name: 'OWASP API6:2023 — Unescaped Input / Information Disclosure',
    category: 'ERROR_BEHAVIOR',
    signalType: 'INFORMATION_DISCLOSURE',
    theme: 'INFORMATION_LEAKAGE',
    question: 'Does this endpoint leak stack traces or internal details in error responses?',
    indicators: ['stack trace', 'internal server error', 'exception', 'traceback', 'sql error', 'debug', 'sql syntax'],
    minEvidence: 1,
    minIndependentSources: 1,
    requireReproducibility: false,
  },
  {
    name: 'OWASP API7:2023 — Broken Function Level Authorization',
    category: 'AUTH_BEHAVIOR',
    signalType: 'PUBLIC_EXPENSE_ENDPOINT',
    theme: 'ACCESS_CONTROL_GAP',
    question: 'Can unauthenticated users access admin or privileged operations?',
    indicators: ['admin', 'dashboard', 'internal', 'debug', 'dev', 'test', 'staging', 'management', '_debug', 'config'],
    minEvidence: 2,
    minIndependentSources: 1,
    requireReproducibility: true,
  },
  {
    name: 'OWASP ASVS V15 — Security Headers Missing',
    category: 'CONFIGURATION',
    signalType: 'MISSING_SECURITY_HEADER',
    theme: 'CONFIGURATION_DRIFT',
    question: 'Are critical security headers (CSP, HSTS, X-Frame-Options) missing or misconfigured?',
    indicators: ['content-security-policy', 'strict-transport-security', 'x-frame-options', 'x-content-type-options', 'x-frame', 'frame-ancestors', 'access-control-allow-origin'],
    minEvidence: 1,
    minIndependentSources: 1,
    requireReproducibility: false,
  },
  {
    name: 'OWASP ASVS V4 — CORS Misconfiguration',
    category: 'CONFIGURATION',
    signalType: 'MISCONFIGURED_CORS',
    theme: 'CONFIGURATION_DRIFT',
    question: 'Does this endpoint have CORS configured to allow unwanted origins?',
    indicators: ['access-control-allow-origin', 'Access-Control-Allow-Credentials', 'origin', 'wildcard', 'credentials: true'],
    minEvidence: 2,
    minIndependentSources: 1,
    requireReproducibility: true,
  },
  {
    name: 'OWASP ASVS V23 — Sensitive Data Exposure',
    category: 'UNEXPECTED_PUBLIC',
    signalType: 'EXPOSED_SENSITIVE_ENDPOINT',
    theme: 'INFRASTRUCTURE_LEAKAGE',
    question: 'Are sensitive endpoints (admin, debug, config, health) publicly accessible without authentication?',
    indicators: ['/admin', '/debug', '/config', '/health', '/.env', '/.git', '/wp-admin', '/phpinfo', '/actuator', '/console', '/internal'],
    minEvidence: 2,
    minIndependentSources: 1,
    requireReproducibility: true,
  },
  {
    name: 'CERT/CC — Version/Fingerprint Disclosure',
    category: 'TECHNOLOGY_FINGERPRINT',
    signalType: 'VERSION_DISCLOSURE',
    theme: 'INFRASTRUCTURE_LEAKAGE',
    question: 'Does this endpoint disclose server software version information?',
    indicators: ['server: ', 'x-powered-by', 'x-aspnet-version', 'version=', 'nginx/', 'apache/', 'express', 'django', 'laravel', 'flask'],
    minEvidence: 1,
    minIndependentSources: 1,
    requireReproducibility: false,
  },
  {
    name: 'MITRE ATT&CK D3I — Exposed IAM/Identity Surface',
    category: 'AUTH_BEHAVIOR',
    signalType: 'IDENTITY_PROVIDER',
    theme: 'IDENTITY_SURFACE_EXPOSURE',
    question: 'Does this surface expose identity/SSO configuration details publicly?',
    indicators: ['.well-known', 'oauth', 'oidc', 'saml', 'openid', 'jwks', 'token', '/oauth2/', '/.well-known/openid'],
    minEvidence: 2,
    minIndependentSources: 1,
    requireReproducibility: true,
  },
  {
    name: 'NIST Log Analysis — Historical Surface Remnants',
    category: 'MIGRATION_RELATIONSHIP',
    signalType: 'HISTORICAL_SURFACE_REMAINS',
    theme: 'MIGRATION_INCOMPLETE',
    question: 'Are deprecated surfaces still reachable or referenced?',
    indicators: ['deprecated', 'deprecation', 'sunsetting', 'superseded', 'no longer supported', 'legacy', 'migration', 'migrated'],
    minEvidence: 2,
    minIndependentSources: 1,
    requireReproducibility: true,
  },
  {
    name: 'OWASP — API Version Inconsistency',
    category: 'VERSIONING',
    signalType: 'API_VERSION_INCONSISTENCY',
    theme: 'VERSION_INCONSISTENCY',
    question: 'Do different API versions expose inconsistent behavior or data?',
    indicators: ['/v1/', '/v2/', '/v3/', 'version', 'deprecated', 'new version', 'upgrade', 'backwards incompatible'],
    minEvidence: 2,
    minIndependentSources: 1,
    requireReproducibility: true,
  },
  {
    name: 'OWASP ASVS V14 — Insecure Redirect',
    category: 'RESPONSE_BEHAVIOR',
    signalType: 'INSECURE_REDIRECT',
    theme: 'CONFIGURATION_DRIFT',
    question: 'Does this endpoint redirect HTTP to HTTP without TLS upgrade?',
    indicators: ['redirect', '301', '302', 'http://', 'location:', 'not secure'],
    minEvidence: 2,
    minIndependentSources: 1,
    requireReproducibility: true,
  },
];

// ── Observation Profiles per Surface Type ─────────────────────────────────────

/**
 * For each surface type, what observation categories are appropriate.
 * This determines what questions can be asked about a given entry point.
 */
const OBSERVATION_PROFILES: Partial<Record<string, ObservationCategory[]>> = {
  // API surfaces
  'API_REST':  ['RESPONSE_BEHAVIOR', 'AUTH_BEHAVIOR', 'ERROR_BEHAVIOR', 'VERSIONING', 'CONSISTENCY', 'PERFORMANCE', 'CONFIGURATION'],
  'API_GRAPHQL': ['RESPONSE_BEHAVIOR', 'AUTH_BEHAVIOR', 'ERROR_BEHAVIOR', 'VERSIONING', 'CONSISTENCY', 'PERFORMANCE'],
  'API_VERSIONED': ['RESPONSE_BEHAVIOR', 'AUTH_BEHAVIOR', 'ERROR_BEHAVIOR', 'VERSIONING', 'CONSISTENCY', 'PERFORMANCE'],
  'API_WEBHOOK_RECEIVER': ['RESPONSE_BEHAVIOR', 'AUTH_BEHAVIOR', 'CONSISTENCY', 'CONFIGURATION'],
  'API_GATEWAY': ['RESPONSE_BEHAVIOR', 'CONFIGURATION', 'VERSIONING', 'CONSISTENCY'],
  'API_REFERENCE': ['DOCUMENTED_OPERATION', 'VERSIONING', 'MIGRATION_RELATIONSHIP'],
  'API_DOCUMENTATION': ['DOCUMENTED_OPERATION', 'VERSIONING', 'MIGRATION_RELATIONSHIP'],

  // Authentication / Identity
  'IDENTITY_OAUTH': ['AUTH_BEHAVIOR', 'RESPONSE_BEHAVIOR', 'SESSION_BEHAVIOR', 'IDENTITY_PROVIDER'],
  'IDENTITY_OIDC': ['AUTH_BEHAVIOR', 'RESPONSE_BEHAVIOR', 'CONFIGURATION', 'IDENTITY_PROVIDER'],
  'IDENTITY_SSO': ['AUTH_BEHAVIOR', 'RESPONSE_BEHAVIOR', 'CONFIGURATION', 'IDENTITY_PROVIDER'],
  'IDENTITY_LOGIN_SYSTEM': ['AUTH_BEHAVIOR', 'RESPONSE_BEHAVIOR', 'CONFIGURATION', 'SESSION_BEHAVIOR'],
  'IDENTITY_PASSWORD_RESET': ['AUTH_BEHAVIOR', 'RESPONSE_BEHAVIOR', 'CONFIGURATION', 'CONSISTENCY'],
  'IDENTITY_ACCOUNT_RECOVERY': ['AUTH_BEHAVIOR', 'RESPONSE_BEHAVIOR', 'CONSISTENCY'],
  'IDENTITY_AUTH_PORTAL': ['AUTH_BEHAVIOR', 'RESPONSE_BEHAVIOR', 'CONFIGURATION', 'SESSION_BEHAVIOR'],

  // Web surfaces
  'WEBSITE_HOMEPAGE': ['RESPONSE_BEHAVIOR', 'PERFORMANCE', 'CONFIGURATION', 'CLIENT_SERVER_RELATIONSHIP', 'UNEXPECTED_PUBLIC'],
  'WEBSITE_APPLICATION': ['RESPONSE_BEHAVIOR', 'PERFORMANCE', 'CONFIGURATION', 'CLIENT_SERVER_RELATIONSHIP', 'UNEXPECTED_PUBLIC'],
  'WEBSITE_LOGIN': ['AUTH_BEHAVIOR', 'RESPONSE_BEHAVIOR', 'CONFIGURATION', 'SESSION_BEHAVIOR'],
  'WEBSITE_SIGNUP': ['AUTH_BEHAVIOR', 'RESPONSE_BEHAVIOR', 'CONFIGURATION'],
  'WEBSITE_ACCOUNT_PORTAL': ['AUTH_BEHAVIOR', 'RESPONSE_BEHAVIOR', 'CONFIGURATION', 'UNEXPECTED_PUBLIC'],
  'WEBSITE_ADMIN_INTERFACE': ['AUTH_BEHAVIOR', 'RESPONSE_BEHAVIOR', 'CONFIGURATION', 'UNEXPECTED_PUBLIC'],
  'WEBSITE_DEVELOPER_PORTAL': ['RESPONSE_BEHAVIOR', 'DOCUMENTED_OPERATION', 'CLIENT_SERVER_RELATIONSHIP', 'CONFIGURATION'],
  'WEBSITE_DEMO': ['RESPONSE_BEHAVIOR', 'PERFORMANCE', 'CONFIGURATION'],
  'WEBSITE_PLAYGROUND': ['RESPONSE_BEHAVIOR', 'AUTH_BEHAVIOR', 'CONFIGURATION', 'CLIENT_SERVER_RELATIONSHIP'],
  'WEBSITE_DASHBOARD': ['AUTH_BEHAVIOR', 'RESPONSE_BEHAVIOR', 'CONFIGURATION'],
  'WEBSITE_CUSTOMER_PORTAL': ['AUTH_BEHAVIOR', 'RESPONSE_BEHAVIOR', 'CONFIGURATION', 'UNEXPECTED_PUBLIC'],
  'WEBSITE_PUBLIC_TOOL': ['RESPONSE_BEHAVIOR', 'PERFORMANCE', 'CONFIGURATION', 'UNEXPECTED_PUBLIC'],
  'WEBSITE_PRODUCT_PAGE': ['RESPONSE_BEHAVIOR', 'PERFORMANCE', 'CLIENT_SERVER_RELATIONSHIP'],
  'WEBSITE_LEGACY_APP': ['RESPONSE_BEHAVIOR', 'AUTH_BEHAVIOR', 'VERSIONING', 'MIGRATION_RELATIONSHIP'],
  'WEBSITE_REGIONAL_APP': ['RESPONSE_BEHAVIOR', 'PERFORMANCE', 'CONFIGURATION', 'CLIENT_SERVER_RELATIONSHIP'],
  'WEBSITE_MOBILE_WEB': ['RESPONSE_BEHAVIOR', 'PERFORMANCE', 'CONFIGURATION', 'CLIENT_SERVER_RELATIONSHIP'],
  'WEBSITE_EMBEDDED_APP': ['RESPONSE_BEHAVIOR', 'AUTH_BEHAVIOR', 'CONFIGURATION', 'CLIENT_SERVER_RELATIONSHIP'],
  'WEBSITE_PASSWORD_RECOVERY': ['AUTH_BEHAVIOR', 'RESPONSE_BEHAVIOR', 'CONFIGURATION', 'CONSISTENCY'],

  // Domain-level
  'DOMAIN_API': ['RESPONSE_BEHAVIOR', 'CONFIGURATION', 'VERSIONING', 'AUTH_BEHAVIOR'],
  'DOMAIN_DOCUMENTATION': ['DOCUMENTED_OPERATION', 'VERSIONING', 'MIGRATION_RELATIONSHIP'],
  'DOMAIN_LOGIN': ['AUTH_BEHAVIOR', 'RESPONSE_BEHAVIOR', 'CONFIGURATION', 'SESSION_BEHAVIOR'],
  'DOMAIN_STATUS': ['RESPONSE_BEHAVIOR', 'INCIDENT_REFERENCE'],
  'DOMAIN_SUPPORT': ['RESPONSE_BEHAVIOR', 'PERFORMANCE'],
  'DOMAIN_DEVELOPER': ['RESPONSE_BEHAVIOR', 'DOCUMENTED_OPERATION', 'CLIENT_SERVER_RELATIONSHIP'],
  'DOMAIN_PRODUCT': ['RESPONSE_BEHAVIOR', 'PERFORMANCE', 'UNEXPECTED_PUBLIC'],
  'DOMAIN_CDN': ['RESPONSE_BEHAVIOR', 'CONFIGURATION'],

  // Security surfaces
  'SECURITY_STATUS_PAGE': ['RESPONSE_BEHAVIOR', 'INCIDENT_REFERENCE', 'SERVICE_RELATIONSHIP'],
  'SECURITY_TXT': ['RESPONSE_BEHAVIOR', 'CONFIGURATION'],
  'SECURITY_TRUST_PAGE': ['RESPONSE_BEHAVIOR', 'AUTH_BEHAVIOR'],
  'SECURITY_VULN_DISCLOSURE': ['RESPONSE_BEHAVIOR', 'DOCUMENTED_OPERATION'],
  'SECURITY_INCIDENT_PAGE': ['RESPONSE_BEHAVIOR', 'INCIDENT_REFERENCE'],
  'SECURITY_HEALTH_ENDPOINT': ['RESPONSE_BEHAVIOR', 'CONFIGURATION', 'UNEXPECTED_PUBLIC'],

  // Client-side (context, but we can still observe references)
  'CLIENT_API_BASE_URL': ['CLIENT_SERVER_RELATIONSHIP', 'VERSIONING', 'AUTH_BEHAVIOR'],

  // Legacy
  'LEGACY_DEPRECATED_API': ['RESPONSE_BEHAVIOR', 'MIGRATION_RELATIONSHIP', 'VERSIONING'],
};

// ── Default profile for any surface type not explicitly listed ────────────────

const DEFAULT_OBSERVATION_PROFILE: ObservationCategory[] = [
  'RESPONSE_BEHAVIOR', 'CONFIGURATION', 'PERFORMANCE', 'CLIENT_SERVER_RELATIONSHIP',
];

/**
 * Get the appropriate observation categories for a surface type.
 * Falls back to DEFAULT_OBSERVATION_PROFILE for unlisted types.
 */
function getObservationProfile(surfaceType: string): ObservationCategory[] {
  // Check semantic_roles first (in case surface_type was merged), then surface_type
  return OBSERVATION_PROFILES[surfaceType] || DEFAULT_OBSERVATION_PROFILE;
}

// ── Confidence Scoring ────────────────────────────────────────────────────────

/**
 * Compute confidence (0–1) for a signal based on evidence count,
 * independent sources, and reproducibility.
 */
function signalConfidence(
  evidenceCount: number,
  independentSources: number,
  reproducible: boolean,
  minEvidence: number,
  minSources: number
): number {
  if (evidenceCount < minEvidence) return 0;
  if (minSources > 1 && independentSources < minSources) return 0;
  if (reproducible && !reproducible) return 0;

  let score = 0;
  // Evidence count factor (up to 0.4)
  score += Math.min(0.4, (evidenceCount / Math.max(minEvidence, 1)) * 0.4);
  // Independent sources factor (up to 0.3)
  score += Math.min(0.3, (independentSources / Math.max(minSources, 1)) * 0.3);
  // Reproducibility factor (up to 0.3)
  if (reproducible) score += 0.3;

  return Math.min(1.0, score);
}

/**
 * Compute final finding confidence (0–1) from verification result and
 * evidence strength.
 */
function findingConfidence(
  signalConfidence: number,
  verificationStatus: 'VERIFIED' | 'REFUTED' | 'INCONCLUSIVE' | 'INSUFFICIENT_EVIDENCE',
  evidenceCount: number,
  independentSources: number
): number {
  if (verificationStatus === 'REFUTED') return 0;
  if (verificationStatus === 'INSUFFICIENT_EVIDENCE') return signalConfidence * 0.3;
  if (verificationStatus === 'INCONCLUSIVE') return signalConfidence * 0.5;

  // VERIFIED
  let score = signalConfidence * 0.7;
  score += Math.min(0.3, (evidenceCount / 5) * 0.3);
  score += Math.min(0.0, (independentSources / 3) * 0); // already counted in signal
  return Math.min(1.0, score);
}

// ── Technical Problem Detector ────────────────────────────────────────────────

export interface ProblemDetectorOptions {
  /** Maximum findings per entry point. */
  maxFindingsPerEntryPoint?: number;
  /** Minimum signal confidence to form a hypothesis. */
  minSignalConfidence?: number;
  /** Minimum finding confidence to be a verified finding. */
  minFindingConfidence?: number;
}

export interface ProblemDetectionResult {
  /** All problem findings discovered. */
  findings: ProblemFinding[];
  /** All observations made (pre-signal). */
  observations: TechnicalObservation[];
  /** All signals generated (pre-correlation). */
  signals: TechnicalSignal[];
  /** All correlated signal groups. */
  correlated_signals: CorrelatedSignal[];
  /** Summary statistics. */
  stats: {
    total_findings: number;
    verified_findings: number;
    research_more: number;
    rejected: number;
    insufficient_evidence: number;
    unsupported_inference: number;
    duplicates: number;
  };
}

/**
 * Technical Problem Detector.
 *
 * Starts from verification-eligible physical public surfaces in the
 * EntryPointGraph and applies detection patterns to determine if there are
 * technically meaningful, evidence-backed problems worth investigating.
 */
export class TechnicalProblemDetector {
  private readonly maxFindingsPerEntryPoint: number;
  private readonly minSignalConfidence: number;
  private readonly minFindingConfidence: number;

  constructor(private options: ProblemDetectorOptions = {}) {
    this.maxFindingsPerEntryPoint = options.maxFindingsPerEntryPoint ?? 3;
    this.minSignalConfidence = options.minSignalConfidence ?? 0.4;
    this.minFindingConfidence = options.minFindingConfidence ?? 0.6;
  }

  /**
   * Run problem detection on a set of entry points with their evidence.
   *
   * @param entryPoints  All discovered entry points
   * @param evidence     All evidence records
   * @param graph        The entry point relationship graph
   * @returns ProblemFinding artifacts and supporting data
   */
  async detect(
    entryPoints: EntryPoint[],
    evidence: Evidence[],
    graph: EntryPointGraph
  ): Promise<ProblemDetectionResult> {
    const findings: ProblemFinding[] = [];
    const foundFindingKeys = new Set<string>();

    const evidenceMap = new Map(evidence.map(e => [e.id, e]));

    // Only process verification-eligible physical public surfaces
    const candidates = entryPoints.filter(ep => {
      if (ep.is_context_artifact) return false;
      if (!ep.verification_eligibility.eligible) return false;
      return true;
    });

    // Step 1: Form observations for ALL eligible entry points
    const allObservations: TechnicalObservation[] = [];
    for (const ep of candidates) {
      const surfaceTypes = ep.semantic_roles && ep.semantic_roles.length > 0
        ? ep.semantic_roles
        : [ep.surface_type];

      const categories: Set<ObservationCategory> = new Set();
      for (const st of surfaceTypes) {
        const profile = getObservationProfile(st);
        for (const cat of profile) categories.add(cat);
      }

      for (const eid of ep.evidence_ids) {
        const ev = evidenceMap.get(eid);
        if (!ev) continue;
        const obs = this.formObservation(ep, ev, categories, evidenceMap);
        if (obs) allObservations.push(obs);
      }
    }

    // Step 2: Apply detection patterns → signals (across ALL observations)
    const { signals: allSignals, unattributed: unattributedObs } =
      this.signalsFromObservations(allObservations, evidenceMap);

    // Step 3: Correlate signals across the graph
    const allCorrelated = this.correlateSignals(allSignals, candidates, graph, evidenceMap);

    // Step 4: Form hypotheses from correlated signals
    let hypotheses = this.formHypotheses(allCorrelated, candidates);
    if (hypotheses.length === 0 && allSignals.length > 0) {
      for (const sig of allSignals) {
        if (sig.confidence >= this.minSignalConfidence) {
          // Map signal back to the entry point(s) it references
          const epRefs = this.findEntryPointsForSignal(sig, candidates);
          for (const ep of epRefs) {
            hypotheses.push(this.formHypothesisFromSignal(sig, ep));
          }
        }
      }
    }

    // Step 5: Verify each hypothesis
    for (const hyp of hypotheses) {
      // Find the primary entry point for this hypothesis
      const epEvidenceCount = new Map<string, number>();
      for (const eid of hyp.evidence_ids) {
        for (const c of candidates) {
          if (c.evidence_ids.includes(eid)) {
            epEvidenceCount.set(c.entry_point_id, (epEvidenceCount.get(c.entry_point_id) || 0) + 1);
          }
        }
      }
      const primaryEpid = Array.from(epEvidenceCount.entries()).reduce(
        (best, [id, count]) => count > best[1] ? [id, count] : best, ['', 0]
      )[0];
      const primaryEp = candidates.find(c => c.entry_point_id === primaryEpid) || candidates[0];
      if (findings.filter(f => f.entry_point_id === primaryEp.entry_point_id).length >= this.maxFindingsPerEntryPoint) continue;
      const finding = await this.verifyHypothesis(hyp, candidates, evidenceMap, graph, foundFindingKeys, allObservations, allSignals, allCorrelated);
      if (finding) findings.push(finding);
    }

    // Deduplicate findings
    const uniqueFindings = this.deduplicateFindings(findings, foundFindingKeys);

    // Compute stats
    const stats = {
      total_findings: uniqueFindings.length,
      verified_findings: uniqueFindings.filter(f => f.decision === 'WORTH_INVESTIGATING').length,
      research_more: uniqueFindings.filter(f => f.decision === 'RESEARCH_MORE').length,
      rejected: uniqueFindings.filter(f => f.decision === 'NOT_A_PROBLEM').length,
      insufficient_evidence: uniqueFindings.filter(f => f.decision === 'INSUFFICIENT_EVIDENCE').length,
      unsupported_inference: uniqueFindings.filter(f => f.decision === 'UNSUPPORTED_INFERENCE').length,
      duplicates: uniqueFindings.filter(f => f.decision === 'DUPLICATE').length,
    };

    return {
      findings: uniqueFindings,
      observations: allObservations,
      signals: allSignals,
      correlated_signals: allCorrelated,
      stats,
    };
  }

  /**
   * Find which entry points contribute evidence to a signal.
   */
  private findEntryPointsForSignal(sig: TechnicalSignal, candidates: EntryPoint[]): EntryPoint[] {
    const result: EntryPoint[] = [];
    for (const ep of candidates) {
      if (ep.evidence_ids.some(id => sig.evidence_ids.includes(id))) {
        result.push(ep);
      }
    }
    return result;
  }

  /**
   * Form an observation from evidence for a given entry point,
   * filtered to appropriate categories.
   */
  private formObservation(
    ep: EntryPoint,
    ev: Evidence,
    categories: Set<ObservationCategory>,
    evidenceMap: Map<string, Evidence>
  ): TechnicalObservation | null {
    const text = (ev.raw_observation || ev.evidence_text || '').toLowerCase();
    if (!text.trim()) return null;

    let category: ObservationCategory | null = null;
    let summary = '';
    let raw: Record<string, unknown> | undefined;

    // Match observation to category based on evidence content.
    // Specific categories are checked BEFORE the generic RESPONSE_BEHAVIOR
    // fallback to avoid misclassifying auth/error/migration behavior as
    // plain response behavior just because a status code is present.
    if (text.includes('oauth') || text.includes('oidc') || text.includes('token')
       || text.includes('login') || text.includes('auth') || text.includes('bearer')
       || text.includes('credential') || text.includes('session')) {
      category = 'AUTH_BEHAVIOR';
      summary = `Authentication-related behavior observed for ${ep.surface_url}`;
      raw = { auth_observed: true };
    } else if (text.includes('redirect') || text.includes('301') || text.includes('302')
               || text.includes('location:')) {
      category = 'RESPONSE_BEHAVIOR';
      summary = `Redirect behavior observed for ${ep.surface_url}`;
      if (text.includes('http://') && !text.includes('https://')) {
        raw = { insecure_redirect: true };
      }
    } else if (text.includes('deprecated') || text.includes('migration') || text.includes('legacy')
               || text.includes('deprecation') || text.includes('sunsetting')) {
      category = 'MIGRATION_RELATIONSHIP';
      summary = `Deprecation/migration reference found for ${ep.surface_url}`;
    } else if (text.includes('error') || text.includes('exception') || text.includes('traceback')
               || text.includes('stack trace')) {
      category = 'ERROR_BEHAVIOR';
      summary = `Error behavior observed for ${ep.surface_url}`;
    } else if (text.includes('version') || text.includes('/v1/') || text.includes('/v2/')
               || text.includes('/v3/')) {
      category = 'VERSIONING';
      summary = `Version information observed for ${ep.surface_url}`;
    } else if (text.includes('config') || text.includes('security') || text.includes('header')
               || text.includes('csp') || text.includes('hsts') || text.includes('cors')) {
      category = 'CONFIGURATION';
      summary = `Configuration observation for ${ep.surface_url}`;
    } else if (text.includes('api') || text.includes('endpoint') || text.includes('operation')
               || text.includes('method') || text.includes('request') || text.includes('response body')) {
      category = 'DOCUMENTED_OPERATION';
      summary = `Documented API operation referenced for ${ep.surface_url}`;
    } else if (text.includes('incident') || text.includes('outage') || text.includes('downtime')) {
      category = 'INCIDENT_REFERENCE';
      summary = `Incident/outage reference found for ${ep.surface_url}`;
    } else if (text.includes('/admin') || text.includes('/debug') || text.includes('/.env')
               || text.includes('/health') || text.includes('/.git') || text.includes('/console')) {
      category = 'UNEXPECTED_PUBLIC';
      summary = `Potentially sensitive path observed for ${ep.surface_url}`;
    } else if (text.includes('server:') || text.includes('powered-by') || text.includes('nginx')
               || text.includes('apache') || text.includes('express') || text.includes('django')) {
      category = 'TECHNOLOGY_FINGERPRINT';
      summary = `Technology fingerprint observed for ${ep.surface_url}`;
    } else if (text.includes('latency') || text.includes('slow') || text.includes('timeout')
               || text.includes('took') || ev.latency_ms !== undefined) {
      category = 'PERFORMANCE';
      summary = `Performance characteristic observed for ${ep.surface_url}`;
      if (ev.latency_ms !== undefined) raw = { latency_ms: ev.latency_ms };
    } else if (ev.status) {
      // Generic response behavior fallback when a status was observed
      category = 'RESPONSE_BEHAVIOR';
      summary = `HTTP ${ev.status || 200} observed for ${ep.surface_url}`;
    } else {
      category = 'RESPONSE_BEHAVIOR';
      summary = `Public behavior observed for ${ep.surface_url}`;
    }

    // Only keep observation if the category is in the profile for this surface
    if (!categories.has(category)) {
      return null;
    }

    const observedAt = ev.retrieved_at || new Date().toISOString();
    const reproducibility: 'SINGLE' | 'REPRODUCED' | 'NOT_REPRODUTED' =
      ev.repeatable ? 'REPRODUCED' : 'SINGLE';

    return {
      observation_id: `obs_${ep.entry_point_id}_${ev.id}`,
      category,
      entry_point_id: ep.entry_point_id,
      surface_url: ep.surface_url,
      summary,
      evidence_ids: [ev.id],
      evidence_provenance: [ev.evidence_origin as EvidenceProvenance || 'REAL_PUBLIC_OBSERVATION'],
      reproducibility,
      latency_ms: ev.latency_ms,
      status_code: ev.status || undefined,
      observed_at: observedAt,
      raw,
    };
  }

  /**
   * Apply detection patterns to observations to form signals.
   * A signal requires matching a detection pattern AND meeting minimum evidence thresholds.
   */
  private signalsFromObservations(
    observations: TechnicalObservation[],
    evidenceMap: Map<string, Evidence>
  ): { signals: TechnicalSignal[]; unattributed: TechnicalObservation[] } {
    const signals: TechnicalSignal[] = [];
    const unattributed: TechnicalObservation[] = [];

    for (const pattern of DETECTION_PATTERNS) {
      // Find observations matching this pattern's category
      const matchingObs = observations.filter(o => o.category === pattern.category);

      if (matchingObs.length === 0) {
        continue;
      }

      // Check if any evidence text contains pattern indicators
      const evidenceWithIndicators = matchingObs.filter(o => {
        const ev = evidenceMap.get(o.evidence_ids[0]);
        if (!ev) return false;
        const text = (ev.raw_observation || ev.evidence_text || '').toLowerCase();
        return pattern.indicators.some(ind => text.includes(ind));
      });

      // Only form signals when actual pattern indicators are matched.
      // A fallback to matchingObs (no indicators matched) would turn every
      // benign observation into a signal — violating the principle that not
      // every observation is a problem.
      if (evidenceWithIndicators.length === 0) {
        continue;
      }

      // All evidence that matched this pattern's indicators contributes to the signal

      // Check reproducibility requirement
      const reproducible = evidenceWithIndicators.some(o => o.reproducibility === 'REPRODUCED');
      if (pattern.requireReproducibility && !reproducible) {
        unattributed.push(...evidenceWithIndicators);
        continue;
      }

      // Count independent sources
      const independentSources = new Set<string>();
      for (const o of evidenceWithIndicators) {
        const ev = evidenceMap.get(o.evidence_ids[0]);
        if (ev) {
          try {
            independentSources.add(new URL(ev.public_url).hostname);
          } catch {
            independentSources.add(ev.public_url);
          }
        }
      }

      const conf = signalConfidence(
        evidenceWithIndicators.length,
        independentSources.size,
        reproducible,
        pattern.minEvidence,
        pattern.minIndependentSources
      );

      if (conf < this.minSignalConfidence) {
        unattributed.push(...evidenceWithIndicators);
        continue;
      }

      const evidenceIds = [...new Set(evidenceWithIndicators.flatMap(o => o.evidence_ids))];
      const observationIds = evidenceWithIndicators.map(o => o.observation_id);

      signals.push({
        signal_id: `sig_${pattern.name.replace(/[^a-zA-Z0-9]/g, '_')}_${evidenceWithIndicators[0].entry_point_id}`,
        type: pattern.signalType,
        observation_ids: observationIds,
        evidence_ids: evidenceIds,
        summary: `${pattern.name}: ${pattern.question}`,
        confidence: conf,
        relevance: `Surface ${evidenceWithIndicators[0].surface_url} exhibits ${pattern.name}.`,
        generated_at: new Date().toISOString(),
      });
    }

    return { signals, unattributed };
  }

  /**
   * Correlate signals across the graph — look for multiple signals pointing
   * to the same technical theme on the same or related entry points.
   */
  private correlateSignals(
    signals: TechnicalSignal[],
    candidates: EntryPoint[],
    graph: EntryPointGraph,
    evidenceMap: Map<string, Evidence>
  ): CorrelatedSignal[] {
    if (signals.length < 2) return [];

    // Group signals by correlation theme
    const themeGroups = new Map<CorrelationTheme, TechnicalSignal[]>();
    for (const sig of signals) {
      const pattern = DETECTION_PATTERNS.find(p => p.signalType === sig.type);
      if (!pattern) continue;
      const arr = themeGroups.get(pattern.theme) || [];
      arr.push(sig);
      themeGroups.set(pattern.theme, arr);
    }

    const result: CorrelatedSignal[] = [];
    let idx = 0;

    for (const [theme, group] of themeGroups.entries()) {
      if (group.length < 2) continue;

      // Count independent sources
      const allEvidenceIds = [...new Set(group.flatMap(s => s.evidence_ids))];
      const independentSources = new Set<string>();
      for (const eid of allEvidenceIds) {
        const ev = evidenceMap.get(eid);
        if (ev) {
          try {
            independentSources.add(new URL(ev.public_url).hostname);
          } catch {
            independentSources.add(ev.public_url);
          }
        }
      }

      // Check graph edges: do related entry points also show this theme?
      const relatedEps = new Set<string>();
      for (const edge of graph.edges) {
        for (const cand of candidates) {
          if (edge.from === cand.entry_point_id || edge.to === cand.entry_point_id) {
            if (edge.from && edge.from !== cand.entry_point_id) relatedEps.add(edge.from);
            if (edge.to && edge.to !== cand.entry_point_id) relatedEps.add(edge.to);
          }
        }
      }

      const strength = Math.min(1.0, group.length * 0.3 + independentSources.size * 0.2);

      result.push({
        correlation_id: `corr_${theme}_${idx++}`,
        theme,
        signal_ids: group.map(s => s.signal_id),
        independent_sources: Array.from(independentSources),
        source_count: independentSources.size,
        explanation: `Multiple signals (${group.length}) across ${independentSources.size} independent sources correlate to theme '${theme}'. Related graph entry points: ${Array.from(relatedEps).join(', ') || 'none'}.`,
        strength,
        evidence_ids: allEvidenceIds,
      });
    }

    return result;
  }

  /**
   * Form a hypothesis from a correlated signal group.
   */
  private formHypotheses(correlated: CorrelatedSignal[], candidates: EntryPoint[]): ProblemHypothesis[] {
    const hypotheses: ProblemHypothesis[] = [];
    let idx = 0;

    for (const corr of correlated) {
      const pattern = DETECTION_PATTERNS.find(p => p.theme === corr.theme);
      if (!pattern) continue;

      // A hypothesis requires at least 2 signals and 1 independent source
      if (corr.signal_ids.length < 2) continue;

      // Find the primary entry point for this hypothesis (the one with most evidence)
      const epEvidenceCount = new Map<string, number>();
      for (const eid of corr.evidence_ids) {
        for (const ep of candidates) {
          if (ep.evidence_ids.includes(eid)) {
            epEvidenceCount.set(ep.entry_point_id, (epEvidenceCount.get(ep.entry_point_id) || 0) + 1);
          }
        }
      }
      const primaryEpId = Array.from(epEvidenceCount.entries()).reduce(
        (best, [id, count]) => count > best[1] ? [id, count] : best, ['', 0]
      )[0];
      const primaryEp = candidates.find(ep => ep.entry_point_id === primaryEpId) || candidates[0];

      const relatedUrls = Array.from(new Set(
        corr.evidence_ids.flatMap(eid => candidates.find(ep => ep.evidence_ids.includes(eid))?.surface_url || [])
      )).join(', ');

      const claim = `Entry point ${primaryEp.surface_url} exhibits ${corr.theme.replace(/_/g, ' ')} — ${pattern.question}`;
      const refutation = [
        `The observed behavior is expected/normal for this surface type`,
        `The indicators are from a single source — not cross-source verified`,
        `The observations are stale or no longer reproducible`,
        `The apparent behavior is a false positive from content analysis`,
      ];

      hypotheses.push({
        hypothesis_id: `hyp_${corr.correlation_id}`,
        theme: corr.theme,
        claim,
        pre_verification_confidence: corr.strength,
        evidence_ids: corr.evidence_ids,
        verification_approach: `Cross-reference evidence across independent sources and check for contradictory evidence. Verify the surface type context and whether the behavior is expected.`,
        refutation_criteria: refutation,
        technical_context: `Primary surface: ${primaryEp.surface_type} | Auth: ${primaryEp.authentication_model} | Protocol: ${primaryEp.protocol} | Status: ${primaryEp.status} | Related surfaces: ${relatedUrls || 'none'}`,
      });
      idx++;
    }

    return hypotheses;
  }

  /**
   * Form a hypothesis from a single signal (lower confidence).
   */
  private formHypothesisFromSignal(signal: TechnicalSignal, ep: EntryPoint): ProblemHypothesis {
    const pattern = DETECTION_PATTERNS.find(p => p.signalType === signal.type);
    const claim = pattern
      ? `Entry point ${ep.surface_url} may exhibit ${pattern.name}: ${pattern.question}`
      : `Entry point ${ep.surface_url} exhibits ${signal.type}`;

    return {
      hypothesis_id: `hyp_single_${signal.signal_id}`,
      claim,
      pre_verification_confidence: signal.confidence,
      evidence_ids: signal.evidence_ids,
      verification_approach: `Seek independent corroboration from a second source. Check for contradictory evidence.`,
      refutation_criteria: [
        `The observed behavior is expected/normal for this surface type`,
        `Only a single observation/evidence item exists — insufficient for a finding`,
        `The indicators are false positives from content analysis`,
      ],
      technical_context: `Surface: ${ep.surface_type} | Auth: ${ep.authentication_model} | Protocol: ${ep.protocol} | Status: ${ep.status}`,
    };
  }

  /**
   * Verify a hypothesis using available evidence.
   * Verification must produce STRONGER evidence than the signal stage.
   */
  private async verifyHypothesis(
    hyp: ProblemHypothesis,
    candidates: EntryPoint[],
    evidenceMap: Map<string, Evidence>,
    graph: EntryPointGraph,
    foundFindingKeys: Set<string>,
    allObservations: TechnicalObservation[],
    allSignals: TechnicalSignal[],
    allCorrelated: CorrelatedSignal[]
  ): Promise<ProblemFinding | null> {
    // Find the primary entry point for this hypothesis
    const epEvidenceCount = new Map<string, number>();
    for (const eid of hyp.evidence_ids) {
      for (const candidate of candidates) {
        if (candidate.evidence_ids.includes(eid)) {
          epEvidenceCount.set(candidate.entry_point_id, (epEvidenceCount.get(candidate.entry_point_id) || 0) + 1);
        }
      }
    }
    const primaryEpid = Array.from(epEvidenceCount.entries()).reduce(
      (best, [id, count]) => count > best[1] ? [id, count] : best, ['', 0]
    )[0];
    const ep = candidates.find(c => c.entry_point_id === primaryEpid) || candidates[0];

    const evidenceIds = hyp.evidence_ids;
    const evidenceItems = evidenceIds.map(id => evidenceMap.get(id)).filter(Boolean) as Evidence[];

    // Count independent sources and reproducibility
    const independentSources = new Set<string>();
    let reproducible = false;
    for (const ev of evidenceItems) {
      try {
        independentSources.add(new URL(ev.public_url).hostname);
      } catch {
        independentSources.add(ev.public_url);
      }
      if (ev.repeatable) reproducible = true;
    }

    // ── Verification logic ────────────────────────────────────────────────────

    // A hypothesis is VERIFIED if:
    // 1. It has evidence from ≥2 independent sources, AND
    // 2. The behavior is reproducible, AND
    // 3. The evidence is from REAL_PUBLIC_OBSERVATION provenance (not documentation only)
    const hasMultipleSources = independentSources.size >= 2;
    const hasRealObservation = evidenceItems.some(e => e.evidence_origin === 'REAL_PUBLIC_OBSERVATION');
    const hasRepeatableEvidence = evidenceItems.some(e => e.repeatable === true);
    const totalEvidence = evidenceIds.length;

    let verificationStatus: 'VERIFIED' | 'REFUTED' | 'INCONCLUSIVE' | 'INSUFFICIENT_EVIDENCE';
    let isVerified = false;
    let verificationExplanation = '';
    let remainingUncertainties: string[] = [];

    // Decision logic based on evidence strength
    if (totalEvidence === 0) {
      verificationStatus = 'INSUFFICIENT_EVIDENCE';
      verificationExplanation = 'No evidence backing this hypothesis.';
      remainingUncertainties = ['No evidence available to verify'];
    } else if (totalEvidence < 2) {
      verificationStatus = 'INSUFFICIENT_EVIDENCE';
      verificationExplanation = `Only ${totalEvidence} evidence item(s) — insufficient for a finding. Requires at least 2 independent observations.`;
      remainingUncertainties = ['Need additional independent observations to verify'];
    } else if (!hasRealObservation) {
      verificationStatus = 'INSUFFICIENT_EVIDENCE';
      verificationExplanation = 'Evidence is documentation-only — no live observation to verify against.';
      remainingUncertainties = ['Need a live public observation to verify'];
    } else if (!hasMultipleSources && !hasRepeatableEvidence) {
      verificationStatus = 'INCONCLUSIVE';
      verificationExplanation = 'Single source, single observation — cannot rule out false positive.';
      remainingUncertainties = ['Need independent source corroboration', 'Need reproducible observation'];
    } else if (hasMultipleSources && hasRepeatableEvidence) {
      verificationStatus = 'VERIFIED';
      isVerified = true;
      verificationExplanation = `Verified across ${independentSources.size} independent sources with reproducible observations.`;
    } else if (hasMultipleSources || hasRepeatableEvidence) {
      verificationStatus = 'VERIFIED';
      isVerified = true;
      verificationExplanation = `Verified: evidence spans ${independentSources.size} source(s) and reproducibility=${hasRepeatableEvidence}.`;
    } else {
      verificationStatus = 'INCONCLUSIVE';
      verificationExplanation = 'Evidence exists but cannot be definitively verified.';
      remainingUncertainties = ['Need reproducible observation'];
    }

    // ── Decision logic ────────────────────────────────────────────────────────

    let decision: ProblemDecision;
    let confidence: number;

    if (totalEvidence === 0) {
      decision = 'UNSUPPORTED_INFERENCE';
      confidence = 0;
      verificationExplanation = 'No evidence available — inference is not supported.';
    } else if (verificationStatus === 'INSUFFICIENT_EVIDENCE') {
      decision = 'INSUFFICIENT_EVIDENCE';
      confidence = 0;
      remainingUncertainties = ['Insufficient evidence to form a signal or finding'];
    } else if (verificationStatus === 'VERIFIED') {
      confidence = findingConfidence(hyp.pre_verification_confidence, verificationStatus, totalEvidence, independentSources.size);

      // Check for duplicate findings (same surface + same hypothesis claim)
      const findingKey = `${ep.entry_point_id}:${hyp.hypothesis_id}`;
      if (foundFindingKeys.has(findingKey)) {
        decision = 'DUPLICATE';
        confidence = 0;
      } else {
        foundFindingKeys.add(findingKey);
        decision = confidence >= this.minFindingConfidence
          ? 'WORTH_INVESTIGATING'
          : 'RESEARCH_MORE';
      }
    } else {
      // INCONCLUSIVE
      decision = 'RESEARCH_MORE';
      confidence = findingConfidence(hyp.pre_verification_confidence, verificationStatus, totalEvidence, independentSources.size);
      remainingUncertainties = ['Inconclusive — needs additional independent corroboration'];
    }

    // ── Noise filter: do not promote simple latency to a finding ─────────────
    const isLatencyOnly = evidenceItems.every(ev =>
      ev.evidence_origin !== 'REAL_PUBLIC_OBSERVATION' &&
      (ev.raw_observation || '').toLowerCase().replace(/\s/g, '').match(/^latency\d*$/) !== null
    );
    if (isLatencyOnly && decision === 'WORTH_INVESTIGATING') {
      decision = 'NOT_A_PROBLEM';
      verificationExplanation += ' — Simple latency measurement does not constitute a technical problem.';
    }

    // ── Noise filter: do not promote technology fingerprints to vulnerabilities
    const isFingerprintOnly = ep.surface_type === 'WEBSITE_HOMEPAGE' &&
      !hasMultipleSources &&
      evidenceItems.length === 1 &&
      evidenceItems[0]?.raw_observation?.toLowerCase().includes('server:') &&
      !hasRealObservation;
    if (isFingerprintOnly && decision === 'WORTH_INVESTIGATING') {
      decision = 'NOT_A_PROBLEM';
      verificationExplanation += ' — Technology fingerprint alone is not a vulnerability.';
    }

    // ── Noise filter: do not promote error messages to vulnerabilities ────────
    const isErrorOnly = evidenceItems.length === 1 &&
      evidenceItems[0]?.status && evidenceItems[0].status >= 400 &&
      evidenceItems[0].status < 500 &&
      !hasMultipleSources;
    if (isErrorOnly && decision === 'WORTH_INVESTIGATING') {
      decision = 'NOT_A_PROBLEM';
      verificationExplanation += ' — Single transient error response is not a vulnerability.';
    }

    let qcore_verified_finding: VerifiedFinding | undefined = undefined;
    if (isVerified) {
      const governance = hyp.theme ? THEME_TO_GOVERNANCE[hyp.theme] : THEME_TO_GOVERNANCE['INCIDENT_PATTERN'];
      const candidate: SignalCandidate = {
        id: `finding_${ep.entry_point_id}_${hyp.hypothesis_id}`,
        type: 'OBSERVABILITY_SIGNAL',
        source_url: ep.surface_url,
        raw_match: hyp.claim,
        initial_strength: confidence >= 0.8 ? 'HIGH' : 'MEDIUM',
        evidence_ids: evidenceIds,
        qualification_gaps: [],
        provenance: 'REAL_PUBLIC_OBSERVATION',
        expectation_id: hyp.hypothesis_id + "_exp",
        differential_id: hyp.hypothesis_id + "_diff",
        hypothesis_id: hyp.hypothesis_id,
        entry_point_id: ep.entry_point_id,
        technical_area: governance.technical_area,
        technical_mechanism: governance.technical_mechanism,
        expected_behavior: hyp.claim,
        materiality: governance.materiality,
        requires_authorized_assessment: governance.requires_authorized_assessment,
        decision_candidate: governance.decision_candidate,
        policy_reference: governance.policy_reference
      };
      const verification = FindingVerificationEngine.verify(candidate, evidenceItems);
      if (verification.isVerified && verification.verifiedFinding) {
         qcore_verified_finding = verification.verifiedFinding;
      } else {
        // Verification failed — finding does not proceed to Q-Core sealing
      }
    }

    const finding: ProblemFinding = {
      finding_id: `finding_${ep.entry_point_id}_${hyp.hypothesis_id}`,
      qcore_verified_finding,
      entry_point_id: ep.entry_point_id,
      surface: ep.surface_url,
      canonical_url: ep.canonical_url,
      surface_type: ep.surface_type,
      contributing_entry_point_ids: Array.from(new Set(
        hyp.evidence_ids.map(eid => candidates.find(c => c.evidence_ids.includes(eid))?.entry_point_id).filter(Boolean) as string[]
      )),
      technical_context: hyp.technical_context,
      observations: allObservations.filter(o => hyp.evidence_ids.includes(o.evidence_ids[0])),
      signals: allSignals.filter(s => s.evidence_ids.some(id => hyp.evidence_ids.includes(id))),
      correlated_signals: allCorrelated.filter(c => c.evidence_ids.some(id => hyp.evidence_ids.includes(id))),
      hypothesis: hyp,
      verification_result: {
        is_verified: isVerified,
        status: verificationStatus,
        evidence_ids: evidenceIds,
        explanation: verificationExplanation,
        remaining_uncertainties: remainingUncertainties,
      },
      evidence_ids: evidenceIds,
      all_evidence_ids: evidenceIds,
      confidence,
      uncertainties: remainingUncertainties,
      decision,
      decision_reasoning: verificationExplanation,
      generated_at: new Date().toISOString(),
    };

    return finding;
  }

  /**
   * Deduplicate findings by entry_point_id + hypothesis claim.
   */
  private deduplicateFindings(findings: ProblemFinding[], foundKeys: Set<string>): ProblemFinding[] {
    const seen = new Set<string>();
    const result: ProblemFinding[] = [];

    for (const f of findings) {
      const key = `${f.entry_point_id}:${f.hypothesis.claim}`;
      if (seen.has(key)) {
        f.decision = 'DUPLICATE';
        f.confidence = 0;
        continue;
      }
      seen.add(key);
      result.push(f);
    }

    return result;
  }

  /**
   * Get observation categories appropriate for a surface type.
   * Public API for external use.
   */
  static observationProfile(surfaceType: string): ObservationCategory[] {
    return getObservationProfile(surfaceType);
  }

  /**
   * Get all detection pattern names (for reference).
   */
  static detectionPatterns(): { name: string; question: string; category: ObservationCategory; signalType: SignalType }[] {
    return DETECTION_PATTERNS.map(p => ({
      name: p.name,
      question: p.question,
      category: p.category,
      signalType: p.signalType,
    }));
  }
}
