/**
 * VARDHAN — DIFFERENTIAL FINDING ENGINE (§DIFFERENTIAL)
 * ─────────────────────────────────────────────────────────────────────────────
 * Compares ExpectedBehavior against BehavioralObservation to produce
 * BehaviorDifferential artifacts.
 *
 * The engine applies deterministic materiality rules:
 *
 * HIGH (can advance to verification):
 *   - Protected resource returned without required authentication
 *   - Sensitive data publicly returned when expectation says protected
 *   - Documented security boundary contradicted by observed behavior
 *   - Authorization boundary contradicted with positive evidence
 *
 * MEDIUM:
 *   - Meaningful behavior mismatch requiring further validation
 *   - Reproducible security-relevant configuration discrepancy
 *
 * LOW:
 *   - Defense-in-depth inconsistency
 *   - Weak header posture
 *   - Implementation detail
 *
 * NONE:
 *   - Normal public behavior
 *   - Expected public content
 *   - Ordinary HTTP responses
 *   - Framework shell
 *   - Documentation-only differences
 *
 * The engine never classifies a client-side auth boundary (UI shell public,
 * data API properly protected) as a vulnerability. It only flags when an
 * expectation derived from evidence is contradicted by observation.
 */

import type { Evidence } from './IntelligenceCase';
import type { EntryPoint } from './EntryPointModel';
import type {
  ExpectedBehavior,
  BehavioralObservation,
  BehaviorDifferential,
  DifferentialState,
  DifferentialMateriality,
} from './findings/ProblemFinding';

// ── Internal IDs ──────────────────────────────────────────────────────────────

let differentialIdCounter = 0;

function makeDifferentialId(): string {
  return `diff_${Date.now().toString(36)}_${(differentialIdCounter++).toString(36)}`;
}

// ── Core comparison logic ────────────────────────────────────────────────────

/**
 * Check provenance gate for an expectation.
 * If the expectation's evidence did not pass provenance validation,
 * return a INSUFFICIENT_EVIDENCE differential.
 * Returns null if the expectation passes the provenance gate (proceed normally).
 */
function checkProvenanceGate(
  exp: ExpectedBehavior,
  observations: BehavioralObservation[],
  observationIds: string[],
  evidenceIds: string[],
  reasoning: string[],
  now: string,
): BehaviorDifferential | null {
  if (!exp.expectation_provenance_valid) {
    reasoning.push(
      'Expected: ' + exp.statement,
      `Observed: cannot compare — expectation provenance INVALID (evidence_ids [${exp.invalid_evidence_ids?.join(', ') || 'none'}] failed URL/temporal/origin matching).`,
      'Provenance gate: expectation evidence is not independently attributable to this physical resource.',
    );
    return {
      differential_id: makeDifferentialId(),
      entry_point_id: exp.entry_point_id,
      expectation_id: exp.expectation_id,
      observation_ids: observationIds,
      state: 'INSUFFICIENT_EVIDENCE',
      expected: exp.statement,
      observed: `Expectation provenance invalid; evidence not independently attributable to this resource. Invalid evidence: [${exp.invalid_evidence_ids?.join(', ') || 'none'}]`,
      supporting_evidence_ids: evidenceIds,
      contradiction_evidence_ids: [],
      materiality: 'NONE',
      confidence: 'LOW',
      reasoning,
      verification_required: false,
      generated_at: now,
    };
  }
  return null; // provenance valid — proceed with normal comparison
}

/**
 * Compare an expectation against a set of observations to produce a differential.
 *
 * Returns null if no observations are available for this expectation (INSUFFICIENT_EVIDENCE).
 */
export function differentiallyCompare(
  expectation: ExpectedBehavior,
  observations: BehavioralObservation[]
): BehaviorDifferential | null {
  const now = new Date().toISOString();

  // No observations → insufficient evidence
  if (observations.length === 0) {
    return {
      differential_id: makeDifferentialId(),
      entry_point_id: expectation.entry_point_id,
      expectation_id: expectation.expectation_id,
      observation_ids: [],
      state: 'INSUFFICIENT_EVIDENCE',
      expected: expectation.statement,
      observed: 'No observation available for this expectation.',
      supporting_evidence_ids: expectation.evidence_ids,
      contradiction_evidence_ids: [],
      materiality: 'UNKNOWN',
      confidence: 'LOW',
      reasoning: ['No behavioral observation is available to compare against this expectation.'],
      verification_required: false,
      generated_at: now,
    };
  }

  const observationIds = observations.map(o => o.observation_id);
  const allEvidenceIds = [...new Set([...expectation.evidence_ids, ...observations.flatMap(o => o.evidence_ids)])];
  const reasoning: string[] = [];

  // Dispatch to type-specific comparator
  switch (expectation.expectation_type) {
    case 'AUTH_REQUIRED':
    case 'BOUNDARY_BEHAVIOR':
    case 'PROTECTED_RESOURCE':
      return compareAuthExpectation(expectation, observations, observationIds, allEvidenceIds, reasoning, now);

    case 'AUTH_NOT_REQUIRED':
      return compareNoAuthExpectation(expectation, observations, observationIds, allEvidenceIds, reasoning, now);

    case 'PUBLIC_CONTENT':
      return comparePublicContentExpectation(expectation, observations, observationIds, allEvidenceIds, reasoning, now);

    case 'API_PUBLIC_RESPONSE':
      return compareApiPublicResponse(expectation, observations, observationIds, allEvidenceIds, reasoning, now);

    case 'DOCUMENTED_OPERATION':
      return compareDocumentedOperation(expectation, observations, observationIds, allEvidenceIds, reasoning, now);

    case 'SECURITY_CONTROL':
      return compareSecurityControl(expectation, observations, observationIds, allEvidenceIds, reasoning, now);

    case 'STATUS_BEHAVIOR':
      return compareStatusBehavior(expectation, observations, observationIds, allEvidenceIds, reasoning, now);

    case 'PERFORMANCE_BASELINE':
      return comparePerformanceBaseline(expectation, observations, observationIds, allEvidenceIds, reasoning, now);

    case 'PUBLIC_OPERATION':
      return comparePublicOperation(expectation, observations, observationIds, allEvidenceIds, reasoning, now);

    case 'VERSIONED_OPERATION':
      return compareVersionedOperation(expectation, observations, observationIds, allEvidenceIds, reasoning, now);

    case 'HISTORICAL_EXPECTATION':
      return compareHistorical(expectation, observations, observationIds, allEvidenceIds, reasoning, now);

    case 'UNKNOWN':
      return compareUnknown(expectation, observations, observationIds, allEvidenceIds, reasoning, now);

    default:
      return compareUnknown(expectation, observations, observationIds, allEvidenceIds, reasoning, now);
  }
}

/**
 * AUTH_REQUIRED / BOUNDARY_BEHAVIOR / PROTECTED_RESOURCE comparison.
 *
 * Expected: authentication required.
 *
 * Cases:
 * - Observation shows 401/403 without auth → MATCH (auth correctly enforced)
 * - Observation shows 200 with public shell content, no protected data → MATCH
 *   (UI-shell pattern: auth is at the data/API layer)
 * - Observation shows 200 with protected/sensitive data → MISMATCH (HIGH)
 * - Observation shows 200 with non-protected data → POSSIBLE_MISMATCH
 */
function compareAuthExpectation(
  exp: ExpectedBehavior,
  observations: BehavioralObservation[],
  observationIds: string[],
  evidenceIds: string[],
  reasoning: string[],
  now: string,
): BehaviorDifferential | null {
  // ── Provenance gate ──
  if (!exp.expectation_provenance_valid) {
    reasoning.push(
      'Expected: authentication required.',
      `Observed: cannot trust — expectation provenance INVALID (evidence not attributable to this resource).`,
    );
    return {
      differential_id: makeDifferentialId(),
      entry_point_id: exp.entry_point_id,
      expectation_id: exp.expectation_id,
      observation_ids: observationIds,
      state: 'INSUFFICIENT_EVIDENCE',
      expected: exp.statement,
      observed: `Expectation provenance invalid; evidence not independently attributable to this resource.`,
      supporting_evidence_ids: evidenceIds,
      contradiction_evidence_ids: [],
      materiality: 'NONE',
      confidence: 'LOW',
      reasoning,
      verification_required: false,
      generated_at: now,
    };
  }

  const authObservations = observations.filter(o =>
    o.authentication_state === 'UNAUTHENTICATED' || o.authentication_state === 'UNKNOWN'
  );

  if (authObservations.length === 0) {
    return {
      differential_id: makeDifferentialId(),
      entry_point_id: exp.entry_point_id,
      expectation_id: exp.expectation_id,
      observation_ids: observationIds,
      state: 'INSUFFICIENT_EVIDENCE',
      expected: exp.statement,
      observed: 'No unauthenticated observation available.',
      supporting_evidence_ids: evidenceIds,
      contradiction_evidence_ids: [],
      materiality: 'UNKNOWN',
      confidence: 'LOW',
      reasoning: ['No unauthenticated behavioral observation to compare against AUTH_REQUIRED expectation.'],
      verification_required: false,
      generated_at: now,
    };
  }

  // Check each unauthenticated observation for sensitive data exposure.
  // Use positive indicators of data leakage (not just keyword presence —
  // "no user data" should NOT trigger a false positive).
  const SENSITIVE_DATA_PATTERNS = [
    /customer\s*records/i,
    /email\s*addresses?\s*[,;]/i,
    /email:\s*\S/i,
    /\bssn\b/i,
    /password\s*hash/i,
    /api\s*key/i,
    /private\s*key/i,
    /credit\s*card/i,
    /pci/i,
    /pii/i,
    /returns?\s+json\s*with/i,
    /customer\s+data/i,
    /account\s+ids?\s+exposed/i,
    /sensitive\s+data\s+in/i,
    /data\s+breach/i,
    /protected\s+resource/i,
    /returns?\s+protected/i,
    /exposed\s+customer/i,
    /leaked/i,
  ];
  const highMaterial = authObservations.some(o =>
    o.status_code === 200 && SENSITIVE_DATA_PATTERNS.some(re => re.test(o.observed_behavior)) &&
    !/no\s+(user\s*data|sensitive|protected|customer|private)/i.test(o.observed_behavior)
  );

  if (highMaterial) {
    reasoning.push(
      'Expected: authentication required.',
      'Observed: unauthenticated request returned HTTP 200 with protected/sensitive data.',
      'This is a direct contradiction of the auth boundary expectation.',
    );
    return {
      differential_id: makeDifferentialId(),
      entry_point_id: exp.entry_point_id,
      expectation_id: exp.expectation_id,
      observation_ids: observationIds,
      state: 'MISMATCH',
      expected: exp.statement,
      observed: authObservations.map(o => `HTTP ${o.status_code} | ${o.observed_behavior}`).join('; '),
      supporting_evidence_ids: evidenceIds,
      contradiction_evidence_ids: authObservations.flatMap(o => o.evidence_ids),
      materiality: 'HIGH',
      confidence: 'HIGH',
      reasoning,
      verification_required: true,
      generated_at: now,
    };
  }

  // Check for UI-shell pattern: 200 with only shell content, API requires auth
  const shellPattern = authObservations.some(o =>
    o.status_code === 200 && (
      /loading|shell|app shell|navigation|spa|react|next\.js|framework/i.test(o.observed_behavior) ||
      !SENSITIVE_DATA_PATTERNS.some(re => re.test(o.observed_behavior))
    )
  );

  if (shellPattern) {
    const status401 = authObservations.some(o => o.status_code === 401 || o.status_code === 403);
    reasoning.push(
      'Expected: authentication required.',
      'Observed: unauthenticated request returned HTTP 200 with UI shell content (no protected data).',
    );
    if (status401) {
      reasoning.push('Additional observation: unauthenticated API/data requests return HTTP 401 — auth is enforced at the data layer.');
      reasoning.push('This is the expected UI_SHELL_PUBLIC pattern — auth boundary is at the API/data layer, not the HTML shell.');
    } else {
      reasoning.push('Client-side auth is the enforcement point. This is a client-side boundary pattern, not a server-side data leak.');
    }
    return {
      differential_id: makeDifferentialId(),
      entry_point_id: exp.entry_point_id,
      expectation_id: exp.expectation_id,
      observation_ids: observationIds,
      state: 'MATCH',
      expected: exp.statement,
      observed: `HTTP ${authObservations[0].status_code} | ${authObservations[0].observed_behavior}${status401 ? ' (API layer returns 401)' : ''}`,
      supporting_evidence_ids: evidenceIds,
      contradiction_evidence_ids: [],
      materiality: 'NONE',
      confidence: 'HIGH',
      reasoning,
      verification_required: false,
      generated_at: now,
    };
  }

  // Generic 401/403 → MATCH
  const denies = authObservations.filter(o => o.status_code === 401 || o.status_code === 403);
  if (denies.length > 0) {
    reasoning.push('Expected: authentication required.', 'Observed: unauthenticated request returned HTTP 401/403 — auth is correctly enforced.');
    return {
      differential_id: makeDifferentialId(),
      entry_point_id: exp.entry_point_id,
      expectation_id: exp.expectation_id,
      observation_ids: observationIds,
      state: 'MATCH',
      expected: exp.statement,
      observed: `${denies.length} observation(s) returned HTTP ${denies.map(d => d.status_code).join('/')}`,
      supporting_evidence_ids: evidenceIds,
      contradiction_evidence_ids: [],
      materiality: 'NONE',
      confidence: 'HIGH',
      reasoning,
      verification_required: false,
      generated_at: now,
    };
  }

  // 200 but no clear protected data → POSSIBLE_MISMATCH
  const twentyXX = authObservations.filter(o => o.status_code === 200);
  if (twentyXX.length > 0) {
    reasoning.push(
      'Expected: authentication required.',
      `Observed: unauthenticated request returned HTTP 200 with ambiguous content.`,
      'Cannot confirm whether protected data is exposed. Requires further validation.',
    );
    return {
      differential_id: makeDifferentialId(),
      entry_point_id: exp.entry_point_id,
      expectation_id: exp.expectation_id,
      observation_ids: observationIds,
      state: 'POSSIBLE_MISMATCH',
      expected: exp.statement,
      observed: `HTTP 200 | ${twentyXX[0].observed_behavior.slice(0, 200)}`,
      supporting_evidence_ids: evidenceIds,
      contradiction_evidence_ids: twentyXX.flatMap(o => o.evidence_ids),
      materiality: 'MEDIUM',
      confidence: 'MEDIUM',
      reasoning,
      verification_required: true,
      generated_at: now,
    };
  }

  // Fallback
  reasoning.push('Expected: authentication required.', 'Observed: unknown behavior — cannot definitively match or mismatch.');
  return {
    differential_id: makeDifferentialId(),
    entry_point_id: exp.entry_point_id,
    expectation_id: exp.expectation_id,
    observation_ids: observationIds,
    state: 'INSUFFICIENT_EVIDENCE',
    expected: exp.statement,
    observed: authObservations.map(o => `HTTP ${o.status_code} | ${o.observed_behavior}`).join('; '),
    supporting_evidence_ids: evidenceIds,
    contradiction_evidence_ids: [],
    materiality: 'UNKNOWN',
    confidence: 'LOW',
    reasoning,
    verification_required: false,
    generated_at: now,
  };
}

/**
 * AUTH_NOT_REQUIRED comparison.
 *
 * Expected: no auth required.
 * - 200/301/302 with public content → MATCH
 * - 401/403 → MISMATCH (MEDIUM) — endpoint unexpectedly requires auth
 */
function compareNoAuthExpectation(
  exp: ExpectedBehavior,
  observations: BehavioralObservation[],
  observationIds: string[],
  evidenceIds: string[],
  reasoning: string[],
  now: string,
): BehaviorDifferential | null {
  // ── Provenance gate ──
  const gateResult = checkProvenanceGate(exp, observations, observationIds, evidenceIds, reasoning, now);
  if (gateResult) return gateResult;

  const relevant = observations;

  const denies = relevant.filter(o => o.status_code === 401 || o.status_code === 403);
  const allows = relevant.filter(o => o.status_code !== undefined && o.status_code < 400);

  if (denies.length > 0) {
    reasoning.push(
      'Expected: no authentication required.',
      `Observed: ${denies.length} request(s) returned HTTP ${denies.map(d => d.status_code).join('/')}`,
    );
    return {
      differential_id: makeDifferentialId(),
      entry_point_id: exp.entry_point_id,
      expectation_id: exp.expectation_id,
      observation_ids: observationIds,
      state: 'MISMATCH',
      expected: exp.statement,
      observed: denies.map(d => `HTTP ${d.status_code} | ${d.observed_behavior}`).join('; '),
      supporting_evidence_ids: evidenceIds,
      contradiction_evidence_ids: denies.flatMap(o => o.evidence_ids),
      materiality: 'MEDIUM',
      confidence: 'HIGH',
      reasoning,
      verification_required: true,
      generated_at: now,
    };
  }

  if (allows.length > 0) {
    reasoning.push(
      'Expected: no authentication required.',
      `Observed: ${allows.length} request(s) returned HTTP ${allows.map(a => a.status_code).join('/')}`,
    );
    return {
      differential_id: makeDifferentialId(),
      entry_point_id: exp.entry_point_id,
      expectation_id: exp.expectation_id,
      observation_ids: observationIds,
      state: 'MATCH',
      expected: exp.statement,
      observed: allows.map(a => `HTTP ${a.status_code} | ${a.observed_behavior.slice(0, 100)}`).join('; '),
      supporting_evidence_ids: evidenceIds,
      contradiction_evidence_ids: [],
      materiality: 'NONE',
      confidence: 'HIGH',
      reasoning,
      verification_required: false,
      generated_at: now,
    };
  }

  reasoning.push('Expected: no authentication required.', 'Observed: no behavioral observation available.');
  return {
    differential_id: makeDifferentialId(),
    entry_point_id: exp.entry_point_id,
    expectation_id: exp.expectation_id,
    observation_ids: observationIds,
    state: 'INSUFFICIENT_EVIDENCE',
    expected: exp.statement,
    observed: 'No observation available.',
    supporting_evidence_ids: evidenceIds,
    contradiction_evidence_ids: [],
    materiality: 'UNKNOWN',
    confidence: 'LOW',
    reasoning,
    verification_required: false,
    generated_at: now,
  };
}

/**
 * API_PUBLIC_RESPONSE comparison.
 *
 * Expected: 200 from a publicly accessible API endpoint.
 * Unlike PUBLIC_CONTENT (which expects text/html), API endpoints may
 * legitimately return any content type (JSON, XML, etc.).
 *
 * - 200 → MATCH (any content type is valid for a public API)
 * - 200 with expected_content_type that doesn't match → POSSIBLE_MISMATCH (LOW)
 * - 401/403 → POSSIBLE_MISMATCH (content unexpectedly gated)
 * - No observation → INSUFFICIENT_EVIDENCE
 */
function compareApiPublicResponse(
  exp: ExpectedBehavior,
  observations: BehavioralObservation[],
  observationIds: string[],
  evidenceIds: string[],
  reasoning: string[],
  now: string,
): BehaviorDifferential | null {
  const gateResult = checkProvenanceGate(exp, observations, observationIds, evidenceIds, reasoning, now);
  if (gateResult) return gateResult;

  if (observations.length === 0) {
    return {
      differential_id: makeDifferentialId(),
      entry_point_id: exp.entry_point_id,
      expectation_id: exp.expectation_id,
      observation_ids: observationIds,
      state: 'INSUFFICIENT_EVIDENCE',
      expected: exp.statement,
      observed: 'No observation available.',
      supporting_evidence_ids: evidenceIds,
      contradiction_evidence_ids: [],
      materiality: 'UNKNOWN',
      confidence: 'LOW',
      reasoning: ['No observation available to compare against API public response expectation.'],
      verification_required: false,
      generated_at: now,
    };
  }

  const denied = observations.filter(o => o.status_code === 401 || o.status_code === 403);
  if (denied.length > 0) {
    reasoning.push(
      'Expected: API responds with 200 (publicly accessible).',
      `Observed: HTTP ${denied.map(d => d.status_code).join('/')}`,
    );
    return {
      differential_id: makeDifferentialId(),
      entry_point_id: exp.entry_point_id,
      expectation_id: exp.expectation_id,
      observation_ids: observationIds,
      state: 'POSSIBLE_MISMATCH',
      expected: exp.statement,
      observed: denied.map(d => `HTTP ${d.status_code} | content_type: ${d.content_type || 'unknown'} | ${d.observed_behavior}`).join('; '),
      supporting_evidence_ids: evidenceIds,
      contradiction_evidence_ids: denied.flatMap(o => o.evidence_ids),
      materiality: 'LOW',
      confidence: 'MEDIUM',
      reasoning,
      verification_required: false,
      generated_at: now,
    };
  }

  const success = observations.filter(o => o.status_code !== undefined && o.status_code < 400);
  if (success.length > 0) {
    // Check content type only if expectation explicitly sets expected_content_type
    if (exp.expected_content_type && exp.expected_content_type.length > 0) {
      const contentTypeMismatches = success.filter(o =>
        o.content_type !== undefined &&
        !exp.expected_content_type!.some(ct => o.content_type!.startsWith(ct.split('/')[0]))
      );
      if (contentTypeMismatches.length > 0) {
        reasoning.push(
          `Expected: API response with content type ${exp.expected_content_type.join(' or ')}.`,
          `Observed: content_type ${contentTypeMismatches.map(m => m.content_type).join(', ')}`,
        );
        return {
          differential_id: makeDifferentialId(),
          entry_point_id: exp.entry_point_id,
          expectation_id: exp.expectation_id,
          observation_ids: observationIds,
          state: 'POSSIBLE_MISMATCH',
          expected: exp.statement,
          observed: contentTypeMismatches.map(m => `HTTP ${m.status_code} | content_type: ${m.content_type} | ${m.observed_behavior.slice(0, 100)}`).join('; '),
          supporting_evidence_ids: evidenceIds,
          contradiction_evidence_ids: contentTypeMismatches.flatMap(o => o.evidence_ids),
          materiality: 'LOW',
          confidence: 'MEDIUM',
          reasoning,
          verification_required: false,
          generated_at: now,
        };
      }
    }
    // 200 success, no content type conflict (or no content type expectation)
    reasoning.push(
      'Expected: API responds with 200 (publicly accessible).',
      `Observed: HTTP ${success.map(s => s.status_code).join('/')}`,
      exp.expected_content_type && exp.expected_content_type.length > 0
        ? `Expected content type: ${exp.expected_content_type.join('/')}`
        : 'No specific content-type expectation — any valid API response content type accepted.',
    );
    return {
      differential_id: makeDifferentialId(),
      entry_point_id: exp.entry_point_id,
      expectation_id: exp.expectation_id,
      observation_ids: observationIds,
      state: 'MATCH',
      expected: exp.statement,
      observed: success.map(s => `HTTP ${s.status_code} | content_type: ${s.content_type || 'unspecified'} | ${s.observed_behavior.slice(0, 100)}`).join('; '),
      supporting_evidence_ids: evidenceIds,
      contradiction_evidence_ids: [],
      materiality: 'NONE',
      confidence: 'HIGH',
      reasoning,
      verification_required: false,
      generated_at: now,
    };
  }

  // Non-2xx, non-4xx responses or unknown status
  reasoning.push(
    'Expected: API responds with 200 (publicly accessible).',
    'Observed: response does not clearly confirm public API access.',
  );
  return {
    differential_id: makeDifferentialId(),
    entry_point_id: exp.entry_point_id,
    expectation_id: exp.expectation_id,
    observation_ids: observationIds,
    state: 'INSUFFICIENT_EVIDENCE',
    expected: exp.statement,
    observed: observations.map(o => `HTTP ${o.status_code || 'unknown'} | content_type: ${o.content_type || 'unknown'} | ${o.observed_behavior.slice(0, 100)}`).join('; '),
    supporting_evidence_ids: evidenceIds,
    contradiction_evidence_ids: [],
    materiality: 'UNKNOWN',
    confidence: 'LOW',
    reasoning,
    verification_required: false,
    generated_at: now,
  };
}

/**
 * PUBLIC_CONTENT comparison.
 *
 * Expected: 200 with public content.
 * - 200 with recognizable public content → MATCH
 * - 401/403 → POSSIBLE_MISMATCH (content unexpectedly gated)
 */
function comparePublicContentExpectation(
  exp: ExpectedBehavior,
  observations: BehavioralObservation[],
  observationIds: string[],
  evidenceIds: string[],
  reasoning: string[],
  now: string,
): BehaviorDifferential | null {
  // ── Provenance gate: if the expectation's evidence didn't pass provenance
  //    validation, do not generate a differential — return INSUFFICIENT_EVIDENCE.
  if (!exp.expectation_provenance_valid) {
    reasoning.push(
      'Expected: public content (HTTP 200).',
      `Observed: expectation provenance INVALID — evidence_ids [${exp.invalid_evidence_ids?.join(', ') || 'none'}] failed URL/temporal matching.`,
      'Cannot trust the expectation for differential analysis.',
    );
    return {
      differential_id: makeDifferentialId(),
      entry_point_id: exp.entry_point_id,
      expectation_id: exp.expectation_id,
      observation_ids: observationIds,
      state: 'INSUFFICIENT_EVIDENCE',
      expected: exp.statement,
      observed: `Expectation provenance invalid; evidence not independently attributable to this resource.`,
      supporting_evidence_ids: evidenceIds,
      contradiction_evidence_ids: [],
      materiality: 'NONE',
      confidence: 'LOW',
      reasoning,
      verification_required: false,
      generated_at: now,
    };
  }

  if (observations.length === 0) {
    return {
      differential_id: makeDifferentialId(),
      entry_point_id: exp.entry_point_id,
      expectation_id: exp.expectation_id,
      observation_ids: observationIds,
      state: 'INSUFFICIENT_EVIDENCE',
      expected: exp.statement,
      observed: 'No observation available.',
      supporting_evidence_ids: evidenceIds,
      contradiction_evidence_ids: [],
      materiality: 'UNKNOWN',
      confidence: 'LOW',
      reasoning: ['No behavioral observation to compare against PUBLIC_CONTENT expectation.'],
      verification_required: false,
      generated_at: now,
    };
  }

  const denied = observations.filter(o => o.status_code === 401 || o.status_code === 403);
  const publicContent = observations.filter(o =>
    o.status_code !== undefined && o.status_code < 400 &&
    o.content_type?.startsWith('text/') === true
  );

  // If content_type is missing on all observations, we cannot confirm public content behavior.
  const hasContentType = observations.some(o => o.content_type !== undefined && o.content_type !== null);
  if (!hasContentType) {
    reasoning.push(
      'Expected: public content (HTTP 200).',
      'Observed: status codes present but content_type missing — cannot confirm response is public HTML content.',
    );
    return {
      differential_id: makeDifferentialId(),
      entry_point_id: exp.entry_point_id,
      expectation_id: exp.expectation_id,
      observation_ids: observationIds,
      state: 'INSUFFICIENT_EVIDENCE',
      expected: exp.statement,
      observed: observations.map(o => `HTTP ${o.status_code || 'unknown'} | content_type: ${o.content_type || 'unknown'} | ${o.observed_behavior.slice(0, 100)}`).join('; '),
      supporting_evidence_ids: evidenceIds,
      contradiction_evidence_ids: [],
      materiality: 'NONE',
      confidence: 'LOW',
      reasoning,
      verification_required: false,
      generated_at: now,
    };
  }

  if (denied.length > 0) {
    reasoning.push(
      'Expected: public content (HTTP 200).',
      `Observed: HTTP ${denied.map(d => d.status_code).join('/')}`,
    );
    return {
      differential_id: makeDifferentialId(),
      entry_point_id: exp.entry_point_id,
      expectation_id: exp.expectation_id,
      observation_ids: observationIds,
      state: 'POSSIBLE_MISMATCH',
      expected: exp.statement,
      observed: denied.map(d => `HTTP ${d.status_code} | ${d.observed_behavior}`).join('; '),
      supporting_evidence_ids: evidenceIds,
      contradiction_evidence_ids: denied.flatMap(o => o.evidence_ids),
      materiality: 'LOW',
      confidence: 'MEDIUM',
      reasoning,
      verification_required: false,
      generated_at: now,
    };
  }

  if (publicContent.length > 0) {
    reasoning.push(
      'Expected: public content (HTTP 200).',
      `Observed: HTTP ${publicContent.map(p => p.status_code).join('/')}`,
    );
    return {
      differential_id: makeDifferentialId(),
      entry_point_id: exp.entry_point_id,
      expectation_id: exp.expectation_id,
      observation_ids: observationIds,
      state: 'MATCH',
      expected: exp.statement,
      observed: publicContent.map(p => `HTTP ${p.status_code} | ${p.observed_behavior.slice(0, 100)}`).join('; '),
      supporting_evidence_ids: evidenceIds,
      contradiction_evidence_ids: [],
      materiality: 'NONE',
      confidence: 'HIGH',
      reasoning,
      verification_required: false,
      generated_at: now,
    };
  }

  // 200+ but content_type is not text/ (e.g. application/json) → POSSIBLE_MISMATCH (LOW)
  // Only when we know the content type but it's not what we expected
  reasoning.push('Expected: public content (HTTP 200, text/html).', 'Observed: status code does not clearly confirm public content access.');
  return {
    differential_id: makeDifferentialId(),
    entry_point_id: exp.entry_point_id,
    expectation_id: exp.expectation_id,
    observation_ids: observationIds,
    state: 'POSSIBLE_MISMATCH',
    expected: exp.statement,
    observed: observations.map(o => `HTTP ${o.status_code || 'unknown'} | content_type: ${o.content_type || 'unknown'} | ${o.observed_behavior.slice(0, 100)}`).join('; '),
    supporting_evidence_ids: evidenceIds,
    contradiction_evidence_ids: [],
    materiality: 'LOW',
    confidence: 'LOW',
    reasoning,
    verification_required: false,
    generated_at: now,
  };
}

/**
 * DOCUMENTED_OPERATION comparison.
 *
 * Expected: the operation is documented (not necessarily that it returns a specific code).
 * - Observation confirms the operation exists → MATCH
 * - No observation → INSUFFICIENT_EVIDENCE
 */
function compareDocumentedOperation(
  exp: ExpectedBehavior,
  observations: BehavioralObservation[],
  observationIds: string[],
  evidenceIds: string[],
  reasoning: string[],
  now: string,
): BehaviorDifferential | null {
  const gateResult = checkProvenanceGate(exp, observations, observationIds, evidenceIds, reasoning, now);
  if (gateResult) return gateResult;

  if (observations.length > 0) {
    reasoning.push('Expected: operation is documented.', 'Observed: behavioral observation confirms the operation responds.');
    return {
      differential_id: makeDifferentialId(),
      entry_point_id: exp.entry_point_id,
      expectation_id: exp.expectation_id,
      observation_ids: observationIds,
      state: 'MATCH',
      expected: exp.statement,
      observed: observations.map(o => `HTTP ${o.status_code} | ${o.observed_behavior.slice(0, 100)}`).join('; '),
      supporting_evidence_ids: evidenceIds,
      contradiction_evidence_ids: [],
      materiality: 'NONE',
      confidence: 'MEDIUM',
      reasoning,
      verification_required: false,
      generated_at: now,
    };
  }
  reasoning.push('Expected: operation is documented.', 'Observed: no behavioral observation available — documentation-only differential.');
  return {
    differential_id: makeDifferentialId(),
    entry_point_id: exp.entry_point_id,
    expectation_id: exp.expectation_id,
    observation_ids: observationIds,
    state: 'INSUFFICIENT_EVIDENCE',
    expected: exp.statement,
    observed: 'No behavioral observation available — documentation only.',
    supporting_evidence_ids: evidenceIds,
    contradiction_evidence_ids: [],
    materiality: 'NONE',
    confidence: 'LOW',
    reasoning,
    verification_required: false,
    generated_at: now,
  };
}

/**
 * SECURITY_CONTROL comparison.
 *
 * Expected: specific security header(s) present.
 * - Header present in observation → MATCH
 * - Header absent → POSSIBLE_MISMATCH (LOW)
 */
function compareSecurityControl(
  exp: ExpectedBehavior,
  observations: BehavioralObservation[],
  observationIds: string[],
  evidenceIds: string[],
  reasoning: string[],
  now: string,
): BehaviorDifferential | null {
  const gateResult = checkProvenanceGate(exp, observations, observationIds, evidenceIds, reasoning, now);
  if (gateResult) return gateResult;

  if (observations.length === 0) {
    reasoning.push('No behavioral observation to verify security control presence.');
    return {
      differential_id: makeDifferentialId(),
      entry_point_id: exp.entry_point_id,
      expectation_id: exp.expectation_id,
      observation_ids: observationIds,
      state: 'INSUFFICIENT_EVIDENCE',
      expected: exp.statement,
      observed: 'No observation available.',
      supporting_evidence_ids: evidenceIds,
      contradiction_evidence_ids: [],
      materiality: 'UNKNOWN',
      confidence: 'LOW',
      reasoning,
      verification_required: false,
      generated_at: now,
    };
  }

  const expectedProps = exp.expected_behavioral_properties || [];
  const missingProps = expectedProps.filter(p => {
    const obsText = observations.map(o => o.observed_behavior.toLowerCase()).join(' ');
    return !obsText.includes(p.replace('header_', '').replace(/_/g, '-'));
  });

  const presentProps = expectedProps.filter(p => !missingProps.includes(p));

  if (missingProps.length > 0) {
    reasoning.push(
      `Expected security control(s): ${expectedProps.join(', ')}.`,
      `Observed missing: ${missingProps.join(', ')}.`,
    );
    const materiality: DifferentialMateriality = 'LOW';
    return {
      differential_id: makeDifferentialId(),
      entry_point_id: exp.entry_point_id,
      expectation_id: exp.expectation_id,
      observation_ids: observationIds,
      state: 'POSSIBLE_MISMATCH',
      expected: exp.statement,
      observed: `Missing security header(s): ${missingProps.join(', ')}`,
      supporting_evidence_ids: evidenceIds,
      contradiction_evidence_ids: observations.flatMap(o => o.evidence_ids),
      materiality,
      confidence: 'MEDIUM',
      reasoning,
      verification_required: false,
      generated_at: now,
    };
  }

  reasoning.push(`Expected security control(s): ${expectedProps.join(', ')}.`, 'All expected controls present in observation.');
  return {
    differential_id: makeDifferentialId(),
    entry_point_id: exp.entry_point_id,
    expectation_id: exp.expectation_id,
    observation_ids: observationIds,
    state: 'MATCH',
    expected: exp.statement,
    observed: `All expected security controls present: ${presentProps.join(', ')}`,
    supporting_evidence_ids: evidenceIds,
    contradiction_evidence_ids: [],
    materiality: 'NONE',
    confidence: 'HIGH',
    reasoning,
    verification_required: false,
    generated_at: now,
  };
}

/**
 * STATUS_BEHAVIOR comparison.
 *
 * Expected: specific HTTP status code(s).
 * - Observed status matches → MATCH
 * - Observed status diverges → MISMATCH or POSSIBLE_MISMATCH
 */
function compareStatusBehavior(
  exp: ExpectedBehavior,
  observations: BehavioralObservation[],
  observationIds: string[],
  evidenceIds: string[],
  reasoning: string[],
  now: string,
): BehaviorDifferential | null {
  // ── Provenance gate ──
  if (!exp.expectation_provenance_valid) {
    reasoning.push(
      `Expected status:${(exp.expected_status_codes || []).join('/') || 'any'}.`,
      `Observed: cannot trust — expectation provenance INVALID (evidence not attributable to this resource).`,
    );
    return {
      differential_id: makeDifferentialId(),
      entry_point_id: exp.entry_point_id,
      expectation_id: exp.expectation_id,
      observation_ids: observationIds,
      state: 'INSUFFICIENT_EVIDENCE',
      expected: exp.statement,
      observed: `Expectation provenance invalid; evidence not independently attributable to this resource.`,
      supporting_evidence_ids: evidenceIds,
      contradiction_evidence_ids: [],
      materiality: 'NONE',
      confidence: 'LOW',
      reasoning,
      verification_required: false,
      generated_at: now,
    };
  }

  if (observations.length === 0) {
    reasoning.push('No behavioral observation to compare against status expectation.');
    return {
      differential_id: makeDifferentialId(),
      entry_point_id: exp.entry_point_id,
      expectation_id: exp.expectation_id,
      observation_ids: observationIds,
      state: 'INSUFFICIENT_EVIDENCE',
      expected: exp.statement,
      observed: 'No observation available.',
      supporting_evidence_ids: evidenceIds,
      contradiction_evidence_ids: [],
      materiality: 'UNKNOWN',
      confidence: 'LOW',
      reasoning,
      verification_required: false,
      generated_at: now,
    };
  }

  const expectedCodes = exp.expected_status_codes || [];
  const mismatches = observations.filter(o => o.status_code !== undefined && !expectedCodes.includes(o.status_code!));
  const matches = observations.filter(o => o.status_code !== undefined && expectedCodes.includes(o.status_code!));

    if (mismatches.length > 0 && matches.length === 0) {
    const is4xx = mismatches.every(o => o.status_code! >= 400 && o.status_code! < 500);
    const isSensitive = expectedCodes.every(c => c === 401 || c === 403);
    reasoning.push(
      `Expected status:${expectedCodes.join('/') || 'any'}.`,
      `Observed: ${mismatches.map(m => m.status_code).join('/')}`,
    );
    return {
      differential_id: makeDifferentialId(),
      entry_point_id: exp.entry_point_id,
      expectation_id: exp.expectation_id,
      observation_ids: observationIds,
      state: 'MISMATCH',
      expected: exp.statement,
      observed: mismatches.map(m => `HTTP ${m.status_code} | ${m.observed_behavior.slice(0, 100)}`).join('; '),
      supporting_evidence_ids: evidenceIds,
      contradiction_evidence_ids: mismatches.flatMap(o => o.evidence_ids),
      // HIGH only when an auth-protected endpoint (401/403 expected) became accessible (200);
      // MEDIUM for other status discrepancies (e.g., 404→200, generic behavioral mismatch).
      materiality: isSensitive ? 'HIGH' : 'MEDIUM',
      confidence: 'HIGH',
      reasoning,
      verification_required: true,
      generated_at: now,
    };
  }

  if (matches.length > 0) {
    reasoning.push(
      `Expected status:${expectedCodes.join('/') || 'any'}.`,
      `Observed: ${matches.map(m => m.status_code).join('/')}`,
    );
    return {
      differential_id: makeDifferentialId(),
      entry_point_id: exp.entry_point_id,
      expectation_id: exp.expectation_id,
      observation_ids: observationIds,
      state: 'MATCH',
      expected: exp.statement,
      observed: matches.map(m => `HTTP ${m.status_code} | ${m.observed_behavior.slice(0, 100)}`).join('; '),
      supporting_evidence_ids: evidenceIds,
      contradiction_evidence_ids: [],
      materiality: 'NONE',
      confidence: 'HIGH',
      reasoning,
      verification_required: false,
      generated_at: now,
    };
  }

  // Mixed
  reasoning.push(
    `Expected status:${expectedCodes.join('/')}.`,
    `Observed: ${matches.length} match(es), ${mismatches.length} mismatch(es) — mixed result.`,
  );
  return {
    differential_id: makeDifferentialId(),
    entry_point_id: exp.entry_point_id,
    expectation_id: exp.expectation_id,
    observation_ids: observationIds,
    state: 'POSSIBLE_MISMATCH',
    expected: exp.statement,
    observed: `Mixed: ${matches.map(m => `HTTP ${m.status_code}`).join(', ')} match; ${mismatches.map(m => `HTTP ${m.status_code}`).join(', ')} diverge`,
    supporting_evidence_ids: evidenceIds,
    contradiction_evidence_ids: mismatches.flatMap(o => o.evidence_ids),
    materiality: 'LOW',
    confidence: 'LOW',
    reasoning,
    verification_required: true,
    generated_at: now,
  };
}

/**
 * PERFORMANCE_BASELINE comparison.
 *
 * Expected: latency within baseline range.
 * - No observation → INSUFFICIENT_EVIDENCE
 * - Observation within 2x baseline → MATCH
 * - Observation > 2x baseline → POSSIBLE_MISMATCH (requires strong comparator)
 */
function comparePerformanceBaseline(
  exp: ExpectedBehavior,
  observations: BehavioralObservation[],
  observationIds: string[],
  evidenceIds: string[],
  reasoning: string[],
  now: string,
): BehaviorDifferential | null {
  const gateResult = checkProvenanceGate(exp, observations, observationIds, evidenceIds, reasoning, now);
  if (gateResult) return gateResult;

  if (observations.length === 0) {
    reasoning.push('No behavioral observation to compare against latency baseline.');
    return {
      differential_id: makeDifferentialId(),
      entry_point_id: exp.entry_point_id,
      expectation_id: exp.expectation_id,
      observation_ids: observationIds,
      state: 'INSUFFICIENT_EVIDENCE',
      expected: exp.statement,
      observed: 'No observation available.',
      supporting_evidence_ids: evidenceIds,
      contradiction_evidence_ids: [],
      materiality: 'UNKNOWN',
      confidence: 'LOW',
      reasoning,
      verification_required: false,
      generated_at: now,
    };
  }

  // Only use observations that have latency data
  const latObservations = observations.filter(o => o.response_size !== undefined || /latency|response/i.test(o.observed_behavior));
  if (latObservations.length === 0) {
    reasoning.push('Observation does not contain latency data — cannot compare to baseline.');
    return {
      differential_id: makeDifferentialId(),
      entry_point_id: exp.entry_point_id,
      expectation_id: exp.expectation_id,
      observation_ids: observationIds,
      state: 'INSUFFICIENT_EVIDENCE',
      expected: exp.statement,
      observed: 'No latency data in observation.',
      supporting_evidence_ids: evidenceIds,
      contradiction_evidence_ids: [],
      materiality: 'UNKNOWN',
      confidence: 'LOW',
      reasoning,
      verification_required: false,
      generated_at: now,
    };
  }

  reasoning.push(
    'Expected: latency within documented baseline range.',
    'Observed: latency data available — requires a strong comparator (multiple independent observations) for a performance finding.',
  );
  return {
    differential_id: makeDifferentialId(),
    entry_point_id: exp.entry_point_id,
    expectation_id: exp.expectation_id,
    observation_ids: observationIds,
    state: 'POSSIBLE_MISMATCH',
    expected: exp.statement,
    observed: `Latency observation available: ${latObservations.map(o => o.observed_behavior).join('; ')}`,
    supporting_evidence_ids: evidenceIds,
    contradiction_evidence_ids: [],
    materiality: 'LOW',
    confidence: 'MEDIUM',
    reasoning,
    verification_required: false,
    generated_at: now,
  };
}

/**
 * PUBLIC_OPERATION comparison.
 *
 * Expected: operation is public and accessible.
 * - 2xx → MATCH
 * - 401/403 → MISMATCH (operation unexpectedly requires auth)
 */
function comparePublicOperation(
  exp: ExpectedBehavior,
  observations: BehavioralObservation[],
  observationIds: string[],
  evidenceIds: string[],
  reasoning: string[],
  now: string,
): BehaviorDifferential | null {
  const gateResult = checkProvenanceGate(exp, observations, observationIds, evidenceIds, reasoning, now);
  if (gateResult) return gateResult;

  if (observations.length === 0) {
    return {
      differential_id: makeDifferentialId(),
      entry_point_id: exp.entry_point_id,
      expectation_id: exp.expectation_id,
      observation_ids: observationIds,
      state: 'INSUFFICIENT_EVIDENCE',
      expected: exp.statement,
      observed: 'No observation available.',
      supporting_evidence_ids: evidenceIds,
      contradiction_evidence_ids: [],
      materiality: 'UNKNOWN',
      confidence: 'LOW',
      reasoning: ['No behavioral observation available.'],
      verification_required: false,
      generated_at: now,
    };
  }

  const denied = observations.filter(o => o.status_code === 401 || o.status_code === 403);
  if (denied.length > 0) {
    reasoning.push('Expected: public operation.', `Observed: HTTP ${denied.map(d => d.status_code).join('/')}`);
    return {
      differential_id: makeDifferentialId(),
      entry_point_id: exp.entry_point_id,
      expectation_id: exp.expectation_id,
      observation_ids: observationIds,
      state: 'MISMATCH',
      expected: exp.statement,
      observed: denied.map(d => `HTTP ${d.status_code} | ${d.observed_behavior}`).join('; '),
      supporting_evidence_ids: evidenceIds,
      contradiction_evidence_ids: denied.flatMap(o => o.evidence_ids),
      materiality: 'MEDIUM',
      confidence: 'HIGH',
      reasoning,
      verification_required: true,
      generated_at: now,
    };
  }

  const allowed = observations.filter(o => o.status_code !== undefined && o.status_code < 400);
  if (allowed.length > 0) {
    reasoning.push('Expected: public operation. Observed: accessible without auth.');
    return {
      differential_id: makeDifferentialId(),
      entry_point_id: exp.entry_point_id,
      expectation_id: exp.expectation_id,
      observation_ids: observationIds,
      state: 'MATCH',
      expected: exp.statement,
      observed: allowed.map(a => `HTTP ${a.status_code} | ${a.observed_behavior.slice(0, 100)}`).join('; '),
      supporting_evidence_ids: evidenceIds,
      contradiction_evidence_ids: [],
      materiality: 'NONE',
      confidence: 'HIGH',
      reasoning,
      verification_required: false,
      generated_at: now,
    };
  }

  return {
    differential_id: makeDifferentialId(),
    entry_point_id: exp.entry_point_id,
    expectation_id: exp.expectation_id,
    observation_ids: observationIds,
    state: 'INSUFFICIENT_EVIDENCE',
    expected: exp.statement,
    observed: observations.map(o => `HTTP ${o.status_code}`).join('; '),
    supporting_evidence_ids: evidenceIds,
    contradiction_evidence_ids: [],
    materiality: 'UNKNOWN',
    confidence: 'LOW',
    reasoning,
    verification_required: false,
    generated_at: now,
  };
}

/** VERSIONED_OPERATION comparison — same pattern as documented operation. */
function compareVersionedOperation(
  exp: ExpectedBehavior,
  observations: BehavioralObservation[],
  observationIds: string[],
  evidenceIds: string[],
  reasoning: string[],
  now: string,
): BehaviorDifferential | null {
  const gateResult = checkProvenanceGate(exp, observations, observationIds, evidenceIds, reasoning, now);
  if (gateResult) return gateResult;

  if (observations.length > 0) {
    reasoning.push('Expected: versioned operation exists.', 'Observed: behavioral observation confirms the operation responds.');
    return {
      differential_id: makeDifferentialId(),
      entry_point_id: exp.entry_point_id,
      expectation_id: exp.expectation_id,
      observation_ids: observationIds,
      state: 'MATCH',
      expected: exp.statement,
      observed: observations.map(o => `HTTP ${o.status_code}`).join('; '),
      supporting_evidence_ids: evidenceIds,
      contradiction_evidence_ids: [],
      materiality: 'NONE',
      confidence: 'MEDIUM',
      reasoning,
      verification_required: false,
      generated_at: now,
    };
  }
  return {
    differential_id: makeDifferentialId(),
    entry_point_id: exp.entry_point_id,
    expectation_id: exp.expectation_id,
    observation_ids: observationIds,
    state: 'INSUFFICIENT_EVIDENCE',
    expected: exp.statement,
    observed: 'No observation available — versioned operation is documentation-only.',
    supporting_evidence_ids: evidenceIds,
    contradiction_evidence_ids: [],
    materiality: 'NONE',
    confidence: 'LOW',
    reasoning: ['Versioned operation expectation derived from documentation only.'],
    verification_required: false,
    generated_at: now,
  };
}

/** HISTORICAL_EXPECTATION comparison — never confirms current state. */
function compareHistorical(
  exp: ExpectedBehavior,
  observations: BehavioralObservation[],
  observationIds: string[],
  evidenceIds: string[],
  reasoning: string[],
  now: string,
): BehaviorDifferential | null {
  const gateResult = checkProvenanceGate(exp, observations, observationIds, evidenceIds, reasoning, now);
  if (gateResult) return gateResult;

  reasoning.push('Expected: historical behavior.', 'Historical expectations are never treated as current verification.');
  return {
    differential_id: makeDifferentialId(),
    entry_point_id: exp.entry_point_id,
    expectation_id: exp.expectation_id,
    observation_ids: observationIds,
    state: 'HISTORICAL_ONLY',
    expected: exp.statement,
    observed: observations.length > 0
      ? observations.map(o => `HTTP ${o.status_code} | ${o.observed_behavior.slice(0, 100)}`).join('; ')
      : 'No current observation.',
    supporting_evidence_ids: evidenceIds,
    contradiction_evidence_ids: [],
    materiality: 'NONE',
    confidence: 'LOW',
    reasoning,
    verification_required: false,
    generated_at: now,
  };
}

/** UNKNOWN comparison — cannot determine. */
function compareUnknown(
  exp: ExpectedBehavior,
  observations: BehavioralObservation[],
  observationIds: string[],
  evidenceIds: string[],
  reasoning: string[],
  now: string,
): BehaviorDifferential | null {
  const gateResult = checkProvenanceGate(exp, observations, observationIds, evidenceIds, reasoning, now);
  if (gateResult) return gateResult;

  reasoning.push('Expectation type is UNKNOWN — insufficient basis for differential.');
  return {
    differential_id: makeDifferentialId(),
    entry_point_id: exp.entry_point_id,
    expectation_id: exp.expectation_id,
    observation_ids: observationIds,
    state: 'INSUFFICIENT_EVIDENCE',
    expected: exp.statement,
    observed: observations.length > 0
      ? observations.map(o => `HTTP ${o.status_code}`).join('; ')
      : 'No observation.',
    supporting_evidence_ids: evidenceIds,
    contradiction_evidence_ids: [],
    materiality: 'UNKNOWN',
    confidence: 'LOW',
    reasoning,
    verification_required: false,
    generated_at: now,
  };
}

// ── Engine class ──────────────────────────────────────────────────────────────

/**
 * Differential Finding Engine — compares ExpectedBehavior against
 * BehavioralObservation to produce BehaviorDifferential artifacts.
 */
export class DifferentialFindingEngine {
  /**
   * Compare all expectations against their corresponding observations.
   *
   * @param expectations   All expected behaviors
   * @param observations   All behavioral observations (indexed by entry_point_id internally)
   * @returns All differentials produced (includes MATCH, MISMATCH, etc.)
   */
  analyze(
    expectations: ExpectedBehavior[],
    observations: BehavioralObservation[],
  ): BehaviorDifferential[] {
    const obsByEp = new Map<string, BehavioralObservation[]>();
    for (const obs of observations) {
      const arr = obsByEp.get(obs.entry_point_id);
      if (arr) arr.push(obs);
      else obsByEp.set(obs.entry_point_id, [obs]);
    }

    const differentials: BehaviorDifferential[] = [];

    for (const exp of expectations) {
      const epObservations = obsByEp.get(exp.entry_point_id) || [];
      const diff = differentiallyCompare(exp, epObservations);
      if (diff) differentials.push(diff);
    }

    return differentials;
  }

  /** Single expectation → single differential (delegates to standalone comparator). */
  private compareExpectation(
    exp: ExpectedBehavior,
    observations: BehavioralObservation[],
  ): BehaviorDifferential | null {
    return differentiallyCompare(exp, observations);
  }

  /**
   * Filter differentials to only those with actionable materiality (HIGH or
   * sufficiently corroborated MEDIUM).
   */
  filterActionable(differentials: BehaviorDifferential[]): BehaviorDifferential[] {
    return differentials.filter(d =>
      d.materiality === 'HIGH' ||
      (d.materiality === 'MEDIUM' && d.state === 'MISMATCH')
    );
  }

  /**
   * Deduplicate differentials by (entry_point_id, expectation_id, state).
   */
  deduplicate(differentials: BehaviorDifferential[]): BehaviorDifferential[] {
    const seen = new Set<string>();
    const result: BehaviorDifferential[] = [];
    for (const d of differentials) {
      const key = `${d.entry_point_id}|${d.expectation_id}|${d.state}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(d);
    }
    return result;
  }
}
