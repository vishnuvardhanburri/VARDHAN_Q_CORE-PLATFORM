import { DifferentialFindingEngine } from '../src/server/DifferentialFindingEngine';
import type {
  ExpectedBehavior,
  BehavioralObservation,
  BehaviorDifferential,
  DifferentialState,
  DifferentialMateriality,
} from '../src/server/findings/ProblemFinding';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
describe('Migrated Suite', () => {
  test('Migrated Test', async () => {
/**
 * VARDHAN — DIFFERENTIAL FINDING ENGINE TESTS (§14.2)
 * ─────────────────────────────────────────────────────────────────────────────
 * 16 scenarios covering the expected-vs-observed differential analysis.
 */


// ── Helpers ───────────────────────────────────────────────────────────────────

let expCounter = 0;
let obsCounter = 0;
let diffCounter = 0;

function makeExpectation(
  overrides: Partial<ExpectedBehavior> = {}
): ExpectedBehavior {
  expCounter++;
  return {
    expectation_id: overrides.expectation_id || `exp_${expCounter}`,
    entry_point_id: overrides.entry_point_id || 'ep_test_001',
    expectation_type: overrides.expectation_type || 'AUTH_REQUIRED',
    statement: overrides.statement || 'Authentication is required.',
    source: overrides.source || 'EXPLICIT_DOCUMENTATION',
    evidence_ids: overrides.evidence_ids || ['ev_1'],
    expected_authentication: overrides.expected_authentication,
    expected_authorization: overrides.expected_authorization,
    expected_status_codes: overrides.expected_status_codes,
    expected_content_type: overrides.expected_content_type,
    expected_behavioral_properties: overrides.expected_behavioral_properties,
    current: overrides.current ?? true,
    historical: overrides.historical ?? false,
    confidence: overrides.confidence || 'HIGH',
    uncertainty: overrides.uncertainty || [],
    generated_at: overrides.generated_at || new Date().toISOString(),
    expectation_provenance_valid: overrides.expectation_provenance_valid ?? true,
    invalid_evidence_ids: overrides.invalid_evidence_ids || [],
    provenance_details: overrides.provenance_details || [],
  };
}

function makeObservation(
  overrides: Partial<BehavioralObservation> = {}
): BehavioralObservation {
  obsCounter++;
  return {
    observation_id: overrides.observation_id || `obs_${obsCounter}`,
    entry_point_id: overrides.entry_point_id || 'ep_test_001',
    url: overrides.url || 'https://example.com/',
    method: overrides.method || 'GET',
    status_code: overrides.status_code,
    content_type: overrides.content_type,
    response_size: overrides.response_size,
    authentication_state: overrides.authentication_state || 'UNAUTHENTICATED',
    observed_behavior: overrides.observed_behavior || 'HTTP 200 OK',
    evidence_ids: overrides.evidence_ids || ['ev_obs_1'],
    repeatable: overrides.repeatable ?? true,
    retrieved_at: overrides.retrieved_at || new Date().toISOString(),
  };
}

const engine = new DifferentialFindingEngine();

// ── Tests ─────────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e: any) {
    failed++;
    console.log(`  ✗ ${name}: ${e?.message || String(e)}`);
  }
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// 1. Authenticated dashboard shell with protected API → MATCH
test('1. Auth-required + unauthenticated 200 shell (no protected data) + runtime API requires JWT → MATCH', () => {
  const exp = makeExpectation({
    expectation_type: 'AUTH_REQUIRED',
    statement: 'Authentication is required; API data layer requires JWT.',
    source: 'MULTI_SOURCE_CORRELATION',
    expected_authentication: 'REQUIRED',
  });
  const observations: BehavioralObservation[] = [
    makeObservation({
      status_code: 200,
      observed_behavior: 'HTTP 200 — Next.js SSR HTML shell with navigation, no user data. Loading... GroqCloud',
      authentication_state: 'UNAUTHENTICATED',
    }),
    makeObservation({
      url: 'https://api.example.com/v1/orgs/me/metrics',
      status_code: 401,
      observed_behavior: 'HTTP 401 — missing or malformed jwt',
      authentication_state: 'UNAUTHENTICATED',
    }),
  ];
  const result = engine.analyze([exp], observations);
  assert(result.length === 1, `Should produce 1 differential, got ${result.length}`);
  assert(result[0].state === 'MATCH', `Should be MATCH, got ${result[0].state}`);
  assert(result[0].materiality === 'NONE', `Materiality should be NONE, got ${result[0].materiality}`);
  assert(result[0].verification_required === false, 'Should not require verification');
});

// 2. Public playground → MATCH
test('2. AUTH_NOT_REQUIRED + 200 public playground UI → MATCH', () => {
  const exp = makeExpectation({
    expectation_type: 'AUTH_NOT_REQUIRED',
    statement: 'No authentication required.',
    source: 'EXPLICIT_DOCUMENTATION',
    expected_authentication: 'NOT_REQUIRED',
  });
  const obs = makeObservation({
    status_code: 200,
    observed_behavior: 'HTTP 200 — public playground UI with model selector and chat input.',
    authentication_state: 'UNAUTHENTICATED',
  });
  const result = engine.analyze([exp], [obs]);
  assert(result[0].state === 'MATCH', `Should be MATCH, got ${result[0].state}`);
  assert(result[0].materiality === 'NONE', `Materiality should be NONE`);
});

// 3. Public marketing page named "admin" → MATCH (public content expected)
test('3. PUBLIC_CONTENT + 200 marketing content with "admin" in name → MATCH', () => {
  const exp = makeExpectation({
    expectation_type: 'PUBLIC_CONTENT',
    statement: 'Page serves public marketing content.',
    source: 'OBSERVED_NORMAL_BEHAVIOR',
    expected_status_codes: [200],
  });
  const obs = makeObservation({
    status_code: 200,
    content_type: 'text/html',
    observed_behavior: 'Marketing page about admin features. HTTP 200.',
    authentication_state: 'UNAUTHENTICATED',
  });
  const result = engine.analyze([exp], [obs]);
  assert(result[0].state === 'MATCH', `Should be MATCH, got ${result[0].state}`);
  assert(result[0].materiality === 'NONE', 'Materiality should be NONE');
});

// 4. Documented protected operation + unauthorized protected data → MISMATCH (HIGH)
test('4. AUTH_REQUIRED + 200 with protected user data → MISMATCH (HIGH)', () => {
  const exp = makeExpectation({
    expectation_type: 'AUTH_REQUIRED',
    statement: 'Authentication required for this API endpoint.',
    source: 'EXPLICIT_DOCUMENTATION',
    evidence_ids: ['ev_doc_1'],
    expected_authentication: 'REQUIRED',
  });
  const obs = makeObservation({
    status_code: 200,
    observed_behavior: 'HTTP 200 — Returns JSON with customer records, email addresses, and account IDs.',
    authentication_state: 'UNAUTHENTICATED',
    evidence_ids: ['ev_obs_1'],
  });
  const result = engine.analyze([exp], [obs]);
  assert(result[0].state === 'MISMATCH', `Should be MISMATCH, got ${result[0].state}`);
  assert(result[0].materiality === 'HIGH', `Materiality should be HIGH, got ${result[0].materiality}`);
  assert(result[0].verification_required === true, 'Should require verification');
});

// 5. Missing header only → POSSIBLE_MISMATCH (LOW)
test('5. SECURITY_CONTROL expected + header missing → POSSIBLE_MISMATCH (LOW)', () => {
  const exp = makeExpectation({
    expectation_type: 'SECURITY_CONTROL',
    statement: 'Content-Security-Policy header is expected.',
    source: 'OBSERVED_NORMAL_BEHAVIOR',
    expected_behavioral_properties: ['header_content_security_policy_present'],
  });
  const obs = makeObservation({
    observed_behavior: 'HTTP 200 — Response headers do not include Content-Security-Policy or CSP.',
    authentication_state: 'UNAUTHENTICATED',
  });
  const result = engine.analyze([exp], [obs]);
  assert(result[0].state === 'POSSIBLE_MISMATCH', `Should be POSSIBLE_MISMATCH, got ${result[0].state}`);
  assert(result[0].materiality === 'LOW', `Materiality should be LOW, got ${result[0].materiality}`);
  assert(result[0].verification_required === false, 'Should not require verification');
});

// 6. Repeated latency without baseline → POSSIBLE_MISMATCH
test('6. PERFORMANCE_BASELINE + latency observation without comparator → POSSIBLE_MISMATCH', () => {
  const exp = makeExpectation({
    expectation_type: 'PERFORMANCE_BASELINE',
    statement: 'Expected latency baseline ≈ 250ms.',
    source: 'OBSERVED_NORMAL_BEHAVIOR',
    expected_behavioral_properties: ['latency_baseline_250ms'],
  });
  const obs = makeObservation({
    observed_behavior: 'Latency observation available: response time 5000ms',
    authentication_state: 'UNAUTHENTICATED',
  });
  const result = engine.analyze([exp], [obs]);
  assert(result[0].state === 'POSSIBLE_MISMATCH', `Should be POSSIBLE_MISMATCH, got ${result[0].state}`);
  assert(result[0].materiality === 'LOW', `Materiality should be LOW, got ${result[0].materiality}`);
});

// 7. Repeated latency with strong comparator → investigation candidate
test('7. Latency with strong comparator → verification candidate', () => {
  const exp = makeExpectation({
    expectation_type: 'PERFORMANCE_BASELINE',
    statement: 'Expected latency baseline ≈ 250ms across 3 samples.',
    source: 'MULTI_SOURCE_CORRELATION',
    evidence_ids: ['ev_base_1', 'ev_base_2', 'ev_base_3'],
    expected_behavioral_properties: ['latency_baseline_250ms'],
  });
  const observations: BehavioralObservation[] = [
    makeObservation({ observation_id: 'obs_a', observed_behavior: 'Latency 240ms', evidence_ids: ['ev_obs_a'] }),
    makeObservation({ observation_id: 'obs_b', observed_behavior: 'Latency 5200ms', evidence_ids: ['ev_obs_b'] }),
    makeObservation({ observation_id: 'obs_c', observed_behavior: 'Latency 4800ms', evidence_ids: ['ev_obs_c'] }),
  ];
  const result = engine.analyze([exp], observations);
  assert(result[0].state === 'POSSIBLE_MISMATCH', `Should be POSSIBLE_MISMATCH, got ${result[0].state}`);
  assert(result[0].materiality === 'LOW', `Materiality should be LOW (requires corroboration), got ${result[0].materiality}`);
  assert(result[0].verification_required === false, 'Performance alone should not auto-verify without strong comparator');
});

// 8. Historical security incident → HISTORICAL_ONLY
test('8. HISTORICAL_EXPECTATION → always HISTORICAL_ONLY', () => {
  const exp = makeExpectation({
    expectation_type: 'HISTORICAL_EXPECTATION',
    statement: 'Historically required authentication (deprecated surface).',
    source: 'HISTORICAL_SOURCE',
    current: false,
    historical: true,
  });
  const obs = makeObservation({
    observed_behavior: 'HTTP 200 — public page',
    authentication_state: 'UNAUTHENTICATED',
  });
  const result = engine.analyze([exp], [obs]);
  assert(result[0].state === 'HISTORICAL_ONLY', `Should be HISTORICAL_ONLY, got ${result[0].state}`);
  assert(result[0].materiality === 'NONE', 'Materiality should be NONE');
});

// 9. Technology fingerprint without behavioral evidence → INSUFFICIENT_EVIDENCE
test('9. TECH fingerprint only → no behavioral observation → INSUFFICIENT_EVIDENCE', () => {
  const exp = makeExpectation({
    expectation_type: 'AUTH_REQUIRED',
    statement: 'Auth required based on tech fingerprint.',
    source: 'PUBLIC_ARCHITECTURE_EVIDENCE',
    confidence: 'LOW',
  });
  const result = engine.analyze([exp], []);
  assert(result[0].state === 'INSUFFICIENT_EVIDENCE', `Should be INSUFFICIENT_EVIDENCE, got ${result[0].state}`);
  assert(result[0].materiality === 'UNKNOWN', `Materiality should be UNKNOWN, got ${result[0].materiality}`);
});

// 10. Error response without corroboration → no finding-level differential
test('10. Single 404 without corroboration → STATUS_BEHAVIOR comparison', () => {
  const exp = makeExpectation({
    expectation_type: 'STATUS_BEHAVIOR',
    statement: 'Expected 404 for non-existent endpoint.',
    source: 'OBSERVED_NORMAL_BEHAVIOR',
    expected_status_codes: [404],
  });
  const obs = makeObservation({
    status_code: 404,
    observed_behavior: 'HTTP 404 — Page not found',
    authentication_state: 'UNAUTHENTICATED',
  });
  const result = engine.analyze([exp], [obs]);
  assert(result[0].state === 'MATCH', `Should be MATCH (404 is expected), got ${result[0].state}`);
  assert(result[0].materiality === 'NONE', 'Materiality should be NONE');
});

// 11. Two independent evidence sources confirming mismatch → stronger differential
test('11. Two independent sources confirming mismatch → stronger differential', () => {
  const exp = makeExpectation({
    expectation_type: 'AUTH_REQUIRED',
    statement: 'Authentication required for /admin/data endpoint.',
    source: 'MULTI_SOURCE_CORRELATION',
    evidence_ids: ['ev_doc_1', 'ev_js_1'],
    expected_authentication: 'REQUIRED',
  });
  const observations: BehavioralObservation[] = [
    makeObservation({
      url: 'https://api.example.com/admin/data',
      status_code: 200,
      observed_behavior: 'HTTP 200 — Returns customer PII (names, emails, account IDs).',
      evidence_ids: ['ev_obs_1'],
    }),
    makeObservation({
      url: 'https://cdn.example.com/logs/admin-data.log',
      status_code: 200,
      observed_behavior: 'HTTP 200 — Log file contains customer PII.',
      evidence_ids: ['ev_obs_2'],
    }),
  ];
  const result = engine.analyze([exp], observations);
  assert(result[0].state === 'MISMATCH', `Should be MISMATCH, got ${result[0].state}`);
  assert(result[0].materiality === 'HIGH', `Materiality should be HIGH, got ${result[0].materiality}`);
  assert(result[0].confidence === 'HIGH', `Confidence should be HIGH, got ${result[0].confidence}`);
  assert(result[0].supporting_evidence_ids.length >= 2, 'Should reference evidence from at least 2 sources');
});

// 12. Duplicate observation → deduplicated
test('12. Duplicate observations are deduplicated', () => {
  const exp = makeExpectation({
    expectation_type: 'STATUS_BEHAVIOR',
    statement: 'Expected 401 for unauthenticated access.',
    source: 'OBSERVED_NORMAL_BEHAVIOR',
    expected_status_codes: [401],
  });
  const observations: BehavioralObservation[] = [
    makeObservation({ observation_id: 'obs_1', status_code: 401, observed_behavior: 'HTTP 401 — missing or malformed jwt', evidence_ids: ['ev_1'] }),
    makeObservation({ observation_id: 'obs_1', status_code: 401, observed_behavior: 'HTTP 401 — missing or malformed jwt', evidence_ids: ['ev_1'] }),
  ];
  const result = engine.analyze([exp], observations);
  assert(result.length === 1, `Should produce 1 differential (deduplicated), got ${result.length}`);
  // The deduplicate method should remove duplicates
  const deduped = engine.deduplicate(result);
  assert(deduped.length === 1, `After dedup should still be 1, got ${deduped.length}`);
});

// 13. Unattributed hostname → INSUFFICIENT_EVIDENCE
test('13. Unattributed hostname → no behavioral evidence → INSUFFICIENT_EVIDENCE', () => {
  const exp = makeExpectation({
    expectation_type: 'BOUNDARY_BEHAVIOR',
    statement: 'Auth boundary: requires JWT.',
    source: 'OBSERVED_NORMAL_BEHAVIOR',
  });
  const result = engine.analyze([exp], []);
  assert(result[0].state === 'INSUFFICIENT_EVIDENCE', `Should be INSUFFICIENT_EVIDENCE, got ${result[0].state}`);
});

// 14. Cloud reference → context only, no behavioral expectation → INSUFFICIENT_EVIDENCE
test('14. Cloud reference expectation → INSUFFICIENT_EVIDENCE', () => {
  const exp = makeExpectation({
    expectation_type: 'SECURITY_CONTROL',
    statement: 'Cloud provider security controls expected (AWS reference only).',
    source: 'PUBLIC_ARCHITECTURE_EVIDENCE',
  });
  const result = engine.analyze([exp], []);
  assert(result[0].state === 'INSUFFICIENT_EVIDENCE', `Should be INSUFFICIENT_EVIDENCE, got ${result[0].state}`);
  assert(result[0].materiality === 'UNKNOWN', `Materiality should be UNKNOWN, got ${result[0].materiality}`);
});

// 15. Authorized-only entry point → no public observation → INSUFFICIENT_EVIDENCE
test('15. AUTH_REQUIRED expectation with no unauthenticated observation → INSUFFICIENT_EVIDENCE', () => {
  const exp = makeExpectation({
    expectation_type: 'AUTH_REQUIRED',
    statement: 'Authentication required.',
    source: 'EXPLICIT_DOCUMENTATION',
    expected_authentication: 'REQUIRED',
  });
  // All observations are authenticated — no public observation to compare
  const obs = makeObservation({
    status_code: 200,
    observed_behavior: 'HTTP 200 — admin dashboard data (authenticated session)',
    authentication_state: 'AUTHENTICATED',
  });
  const result = engine.analyze([exp], [obs]);
  // When all observations are AUTHENTICATED, no UNAUTHENTICATED observation exists
  assert(result[0].state === 'INSUFFICIENT_EVIDENCE', `Should be INSUFFICIENT_EVIDENCE (no unauthenticated obs), got ${result[0].state}`);
});

// 16. Unsupported expectation type → UNKNOWN
test('16. UNKNOWN expectation type → INSUFFICIENT_EVIDENCE', () => {
  const exp = makeExpectation({
    expectation_type: 'UNKNOWN',
    statement: 'Behavior is unknown.',
    source: 'OBSERVED_NORMAL_BEHAVIOR',
  });
  const obs = makeObservation({
    observed_behavior: 'HTTP 200 — response received',
  });
  const result = engine.analyze([exp], [obs]);
  assert(result[0].state === 'INSUFFICIENT_EVIDENCE', `Should be INSUFFICIENT_EVIDENCE, got ${result[0].state}`);
  assert(result[0].materiality === 'UNKNOWN', `Materiality should be UNKNOWN, got ${result[0].materiality}`);
});

// ── Runner ────────────────────────────────────────────────────────────────────

console.log('\n=== DifferentialFindingEngine Test Results ===');
console.log(`Passed: ${passed}/${passed + failed}`);
console.log(`Failed: ${failed}/${passed + failed}`);
if (failed > 0) {
  expect(typeof fail !== 'undefined' ? fail : (typeof failed !== 'undefined' ? failed : 0)).toBe(0);
}
console.log('\n✅ ALL DIFFERENTIAL FINDING ENGINE TESTS PASSED');

  });
});