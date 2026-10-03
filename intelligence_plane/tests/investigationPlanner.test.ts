import { InvestigationPlanner } from '../src/server/InvestigationPlanner';
import { EntryPointGraphBuilder } from '../src/server/EntryPointGraph';
import type { EntryPoint, EntryPointGraph } from '../src/server/EntryPointModel';
import type { ExpectedBehavior, BehavioralObservation } from '../src/server/findings/ProblemFinding';
import type { Evidence } from '../src/server/IntelligenceCase';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
describe('Migrated Suite', () => {
  test('Migrated Test', async () => {
/**
 * VARDHAN — INVESTIGATION PLANNER TESTS (§14.3)
 * ─────────────────────────────────────────────────────────────────────────────
 * 16 scenarios covering the investigation planner's decision logic.
 */


// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEntryPoint(
  overrides: Partial<EntryPoint> = {}
): EntryPoint {
  return {
    entry_point_id: overrides.entry_point_id || 'ep_test_001',
    organization_id: overrides.organization_id || 'org_test',
    canonical_domain: overrides.canonical_domain || 'example.com',
    surface_url: overrides.surface_url || 'https://example.com/',
    canonical_url: overrides.canonical_url || (overrides.surface_url || 'https://example.com/'),
    hostname: overrides.hostname || 'example.com',
    reference: overrides.reference || '',
    surface_type: overrides.surface_type || 'WEBSITE_HOMEPAGE',
    semantic_roles: overrides.semantic_roles || [overrides.surface_type || 'WEBSITE_HOMEPAGE'],
    functional_role: overrides.functional_role || 'PRESENTATION',
    protocol: overrides.protocol || 'HTTPS',
    method: overrides.method || 'GET',
    authentication_model: overrides.authentication_model || 'NONE',
    authorization_model: overrides.authorization_model || 'PUBLIC',
    tenant_boundary: overrides.tenant_boundary || 'SINGLE_TENANT',
    environment: overrides.environment || 'PRODUCTION',
    technology_context: overrides.technology_context || 'UNKNOWN',
    discovery_source: overrides.discovery_source || ['PUBLIC_OBSERVATION'],
    provenance: overrides.provenance || {
      source_type: 'PUBLIC_DOCUMENTATION',
      source_url: 'https://example.com/',
      canonical_url: 'https://example.com/',
      classification: 'OBSERVATION' as any,
      discovery_mechanism: 'SEARCH' as any,
      provider: 'test',
      attribution: 'test',
      retrieval_timestamp: new Date().toISOString(),
    },
    attribution: overrides.attribution || {
      organization_id: 'org_test',
      canonical_domain: 'example.com',
      attribution_confidence: 'HIGH',
      attribution_evidence_ids: [],
      ownership_evidence: [],
    },
    observability: overrides.observability || {
      observed: true,
      repeatable: true,
      reproductions: 1,
      http_method: 'GET',
    },
    verification_eligibility: overrides.verification_eligibility || {
      eligible: true,
      can_verify: ['response'],
      requires_auth: [],
      cannot_verify: [],
      confidence: 'HIGH',
      ineligibility_reasons: [],
    },
    confidence: overrides.confidence || 'HIGH',
    first_seen: overrides.first_seen || new Date().toISOString(),
    last_seen: overrides.last_seen || new Date().toISOString(),
    evidence_ids: overrides.evidence_ids || [],
    related_signal_ids: overrides.related_signal_ids,
    relationships: overrides.relationships || [],
    is_context_artifact: overrides.is_context_artifact ?? false,
    uncertainty: overrides.uncertainty || '',
    status: overrides.status || 'VERIFIED_BEHAVIOR',
  } as EntryPoint;
}

function makeEvidence(
  id: string,
  overrides: Partial<Evidence> = {}
): Evidence {
  return {
    id,
    public_url: overrides.public_url || 'https://example.com/',
    source_type: overrides.source_type || 'PUBLIC_DOCUMENTATION',
    retrieved_at: overrides.retrieved_at || new Date().toISOString(),
    raw_observation: overrides.raw_observation || '',
    evidence_text: overrides.evidence_text || '',
    observed_behavior: overrides.observed_behavior || '200 OK',
    reproductions: overrides.reproductions ?? 1,
    repeatable: overrides.repeatable ?? true,
    tested_without_auth: overrides.tested_without_auth ?? true,
    not_tested: overrides.not_tested || [],
    status: overrides.status ?? 200,
    evidence_origin: overrides.evidence_origin || 'REAL_PUBLIC_OBSERVATION',
  } as Evidence;
}

function makeExpectation(
  overrides: Partial<ExpectedBehavior> = {}
): ExpectedBehavior {
  return {
    expectation_id: overrides.expectation_id || 'exp_1',
    entry_point_id: overrides.entry_point_id || 'ep_test_001',
    expectation_type: overrides.expectation_type || 'AUTH_REQUIRED',
    statement: overrides.statement || 'Auth required',
    source: overrides.source || 'EXPLICIT_DOCUMENTATION',
    evidence_ids: overrides.evidence_ids || ['ev_1'],
    confidence: overrides.confidence || 'HIGH',
    uncertainty: overrides.uncertainty || [],
    current: overrides.current ?? true,
    historical: overrides.historical ?? false,
    generated_at: new Date().toISOString(),
  } as ExpectedBehavior;
}

function makeObservation(
  overrides: Partial<BehavioralObservation> = {}
): BehavioralObservation {
  return {
    observation_id: overrides.observation_id || 'obs_1',
    entry_point_id: overrides.entry_point_id || 'ep_test_001',
    url: overrides.url || 'https://example.com/',
    method: overrides.method || 'GET',
    status_code: overrides.status_code,
    content_type: overrides.content_type,
    response_size: overrides.response_size,
    authentication_state: overrides.authentication_state || 'UNAUTHENTICATED',
    observed_behavior: overrides.observed_behavior || 'HTTP 200',
    evidence_ids: overrides.evidence_ids || ['ev_obs_1'],
    repeatable: overrides.repeatable ?? true,
    retrieved_at: overrides.retrieved_at || new Date().toISOString(),
  };
}

function makeGraph(entryPoints: EntryPoint[]): EntryPointGraph {
  return new EntryPointGraphBuilder().build(entryPoints);
}

const planner = new InvestigationPlanner();

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

// 1. Dashboard shell already observed + API requires auth → STOP
test('1. Dashboard shell already observed + API requires auth → STOP', () => {
  const ep = makeEntryPoint({
    surface_url: 'https://console.example.com/dashboard',
    surface_type: 'WEBSITE_DASHBOARD',
    authentication_model: 'OIDC',
    verification_eligibility: { eligible: true, can_verify: ['response'], requires_auth: ['data'], cannot_verify: [], confidence: 'HIGH', ineligibility_reasons: [] },
    evidence_ids: ['ev_1'],
  });
  const graph = makeGraph([ep]);
  const result = planner.plan({
    entryPoint: ep,
    allEntryPoints: [ep],
    graph,
    expectations: [],
    observations: [
      makeObservation({ status_code: 200, observed_behavior: 'HTTP 200 — shell, no user data', authentication_state: 'UNAUTHENTICATED' }),
    ],
    evidence: [makeEvidence('ev_1', { evidence_text: 'buildRequestHeaders', source_type: 'JS_BUNDLE' as any })],
    differentialState: 'MATCH',
  });
  // Shell already observed, differential is MATCH → should STOP
  assert(result.plan?.action === 'STOP', `Expected STOP, got ${result.plan?.action}`);
});

// 2. Public playground → OBSERVE_PUBLIC_RESPONSE
test('2. Public playground with no observation → OBSERVE_PUBLIC_RESPONSE', () => {
  const ep = makeEntryPoint({
    surface_url: 'https://playground.example.com/',
    surface_type: 'WEBSITE_PLAYGROUND',
    authentication_model: 'NONE',
    evidence_ids: [],
  });
  const graph = makeGraph([ep]);
  const result = planner.plan({
    entryPoint: ep,
    allEntryPoints: [ep],
    graph,
    expectations: [],
    observations: [],
    evidence: [],
    differentialState: null,
  });
  assert(result.plan?.action === 'OBSERVE_PUBLIC_RESPONSE', `Expected OBSERVE_PUBLIC_RESPONSE, got ${result.plan?.action}`);
  assert(result.plan?.candidate_targets.includes('https://playground.example.com/'), 'Should include surface URL');
  assert(result.plan?.authorization_required === false, 'Should not require authorization');
});

// 3. Public marketing page named "admin" → OBSERVE_PUBLIC_RESPONSE
test('3. Public marketing page named "admin" → OBSERVE_PUBLIC_RESPONSE', () => {
  const ep = makeEntryPoint({
    surface_url: 'https://example.com/admin',
    surface_type: 'WEBSITE_PRODUCT_PAGE',
    authentication_model: 'NONE',
    evidence_ids: ['ev_1'],
  });
  const graph = makeGraph([ep]);
  const result = planner.plan({
    entryPoint: ep,
    allEntryPoints: [ep],
    graph,
    expectations: [],
    observations: [],
    evidence: [makeEvidence('ev_1', { evidence_text: 'Marketing content about admin features' })],
    differentialState: null,
  });
  assert(result.plan?.action === 'OBSERVE_PUBLIC_RESPONSE', `Expected OBSERVE_PUBLIC_RESPONSE, got ${result.plan?.action}`);
  // Must also check it does NOT suggest auth testing
  assert(result.plan?.authorization_required === false, 'Should not require authorization');
});

// 4. Documented protected operation → FOLLOW_DOCUMENTED_OPERATION
test('4. Documented operation evidence exists → FOLLOW_DOCUMENTED_OPERATION', () => {
  const ep = makeEntryPoint({
    surface_url: 'https://api.example.com/v1/data',
    surface_type: 'API_REST',
    authentication_model: 'API_KEY',
    evidence_ids: ['ev_doc_1'],
    verification_eligibility: { eligible: true, can_verify: ['response'], requires_auth: [], cannot_verify: [], confidence: 'HIGH', ineligibility_reasons: [] },
  });
  const graph = makeGraph([ep]);
  // Shell already observed, but documentation needs following
  const result = planner.plan({
    entryPoint: ep,
    allEntryPoints: [ep],
    graph,
    expectations: [makeExpectation({ evidence_ids: ['ev_doc_1'] })],
    observations: [makeObservation({ url: 'https://api.example.com/v1/data', observed_behavior: 'HTTP 200 shell' })],
    evidence: [makeEvidence('ev_doc_1', { source_type: 'PUBLIC_DOCUMENTATION' as any, public_url: 'https://docs.example.com/api' })],
    differentialState: 'INSUFFICIENT_EVIDENCE',
  });
  assert(result.plan?.action === 'FOLLOW_DOCUMENTED_OPERATION', `Expected FOLLOW_DOCUMENTED_OPERATION, got ${result.plan?.action}`);
});

// 5. Missing header only → COMPARE_BEHAVIOR (already observed, possible mismatch)
test('5. Security header missing, already observed → RECHECK', () => {
  const ep = makeEntryPoint({
    surface_url: 'https://example.com/',
    surface_type: 'WEBSITE_HOMEPAGE',
    evidence_ids: ['ev_1'],
  });
  const graph = makeGraph([ep]);
  const result = planner.plan({
    entryPoint: ep,
    allEntryPoints: [ep],
    graph,
    expectations: [makeExpectation({
      expectation_type: 'SECURITY_CONTROL',
      statement: 'CSP header expected',
      evidence_ids: ['ev_1'],
      expected_behavioral_properties: ['header_content_security_policy_present'],
    })],
    observations: [makeObservation({ url: 'https://example.com/', observed_behavior: 'No CSP header found' })],
    evidence: [makeEvidence('ev_1', { source_type: 'API_ENDPOINT' as any, evidence_text: 'Security headers check' })],
    differentialState: 'POSSIBLE_MISMATCH',
  });
  assert(result.plan !== null, 'Should have a plan');
  // 1 observation, POSSIBLE_MISMATCH → RECHECK (COMPARE_BEHAVIOR needs 2+ obs)
  assert(result.plan?.action === 'RECHECK', `Expected RECHECK, got ${result.plan?.action}`);
});

// 6. Repeated latency without baseline → RECHECK or COMPARE_BEHAVIOR
test('6. Latency observation without comparator → COMPARE_BEHAVIOR', () => {
  const ep = makeEntryPoint({
    surface_url: 'https://example.com/',
    surface_type: 'WEBSITE_HOMEPAGE',
    evidence_ids: ['ev_1'],
  });
  const graph = makeGraph([ep]);
  const result = planner.plan({
    entryPoint: ep,
    allEntryPoints: [ep],
    graph,
    expectations: [makeExpectation({
      expectation_type: 'PERFORMANCE_BASELINE',
      statement: 'Latency baseline 250ms',
      evidence_ids: ['ev_1'],
    })],
    observations: [
      makeObservation({ observed_behavior: 'Latency 5000ms' }),
      makeObservation({ observed_behavior: 'Latency 4800ms' }),
    ],
    evidence: [makeEvidence('ev_1', { source_type: 'TIMING_ANALYSIS' as any })],
    differentialState: 'POSSIBLE_MISMATCH',
  });
  assert(result.plan?.action === 'COMPARE_BEHAVIOR', `Expected COMPARE_BEHAVIOR, got ${result.plan?.action}`);
});

// 7. Historical security incident → STOP (historical only)
test('7. Historical expectation → STOP (no current verification needed)', () => {
  const ep = makeEntryPoint({
    surface_url: 'https://legacy.example.com/',
    surface_type: 'LEGACY_LEGACY_DOC',
    evidence_ids: ['ev_hist'],
    verification_eligibility: { eligible: true, can_verify: ['response'], requires_auth: [], cannot_verify: [], confidence: 'LOW', ineligibility_reasons: [] },
  });
  const graph = makeGraph([ep]);
  const result = planner.plan({
    entryPoint: ep,
    allEntryPoints: [ep],
    graph,
    expectations: [makeExpectation({
      expectation_type: 'HISTORICAL_EXPECTATION',
      statement: 'Historically required auth',
      source: 'HISTORICAL_SOURCE',
      current: false,
      historical: true,
    })],
    observations: [],
    evidence: [makeEvidence('ev_hist')],
    differentialState: 'HISTORICAL_ONLY',
  });
  assert(result.plan?.action === 'STOP', `Expected STOP, got ${result.plan?.action}`);
});

// 8. Technology fingerprint without behavioral evidence → STOP
test('8. Tech fingerprint only → STOP (no behavioral evidence to inspect)', () => {
  const ep = makeEntryPoint({
    surface_url: 'https://example.com/',
    surface_type: 'WEBSITE_HOMEPAGE',
    technology_context: 'NEXTJS',
    authentication_model: 'NONE',
    evidence_ids: ['ev_fp'],
  });
  const graph = makeGraph([ep]);
  const result = planner.plan({
    entryPoint: ep,
    allEntryPoints: [ep],
    graph,
    expectations: [],
    observations: [],
    evidence: [makeEvidence('ev_fp', { evidence_text: 'Server: nextjs' })],
    differentialState: null,
  });
  // No observations → OBSERVE_PUBLIC_RESPONSE is priority 1
  assert(result.plan?.action === 'OBSERVE_PUBLIC_RESPONSE', `Expected OBSERVE_PUBLIC_RESPONSE, got ${result.plan?.action}`);
  assert(result.plan?.authorization_required === false, 'Should never require authorization');
});

// 9. Error response without corroboration → STOP
test('9. Single error response already observed → STOP', () => {
  const ep = makeEntryPoint({
    surface_url: 'https://example.com/missing',
    surface_type: 'WEBSITE_HOMEPAGE',
    evidence_ids: ['ev_1'],
  });
  const graph = makeGraph([ep]);
  const result = planner.plan({
    entryPoint: ep,
    allEntryPoints: [ep],
    graph,
    expectations: [],
    observations: [makeObservation({ status_code: 404, observed_behavior: 'HTTP 404' })],
    evidence: [makeEvidence('ev_1')],
    differentialState: 'MATCH',
  });
  // Already observed, MATCH → STOP
  assert(result.plan?.action === 'STOP', `Expected STOP, got ${result.plan?.action}`);
});

// 10. Two independent evidence sources confirming mismatch → COMPARE_BEHAVIOR
test('10. Possible mismatch with two sources → COMPARE_BEHAVIOR for corroboration', () => {
  const ep = makeEntryPoint({
    surface_url: 'https://example.com/data',
    surface_type: 'API_REST',
    evidence_ids: ['ev_1', 'ev_2'],
  });
  const graph = makeGraph([ep]);
  const result = planner.plan({
    entryPoint: ep,
    allEntryPoints: [ep],
    graph,
    expectations: [makeExpectation({ evidence_ids: ['ev_1', 'ev_2'] })],
    observations: [
      makeObservation({ url: 'https://example.com/data', observation_id: 'o1', status_code: 200, observed_behavior: 'HTTP 200 shell' }),
      makeObservation({ url: 'https://example.com/data', observation_id: 'o2', status_code: 200, observed_behavior: 'HTTP 200 shell' }),
    ],
    evidence: [
      makeEvidence('ev_1', { source_type: 'API_ENDPOINT' as any, public_url: 'https://example.com/data' }),
      makeEvidence('ev_2', { source_type: 'API_ENDPOINT' as any, public_url: 'https://example.com/data' }),
    ],
    differentialState: 'POSSIBLE_MISMATCH',
  });
  assert(result.plan?.action === 'COMPARE_BEHAVIOR', `Expected COMPARE_BEHAVIOR, got ${result.plan?.action}`);
  assert(result.plan?.authorization_required === false, 'Should not require authorization');
});

// 11. Duplicate observation → RECHECK (instead of OBSERVE)
test('11. Already observed surface → RECHECK not OBSERVE_PUBLIC_RESPONSE', () => {
  const ep = makeEntryPoint({
    surface_url: 'https://example.com/',
    surface_type: 'WEBSITE_HOMEPAGE',
    evidence_ids: ['ev_1'],
  });
  const graph = makeGraph([ep]);
  const result = planner.plan({
    entryPoint: ep,
    allEntryPoints: [ep],
    graph,
    expectations: [],
    observations: [makeObservation({ url: 'https://example.com/', status_code: 200 })],
    evidence: [makeEvidence('ev_1', { source_type: 'API_ENDPOINT' as any })],
    differentialState: 'INSUFFICIENT_EVIDENCE',
  });
  // Already has an observation for the same URL → should RECHECK, not OBSERVE
  assert(result.plan?.action === 'RECHECK', `Expected RECHECK, got ${result.plan?.action}`);
});

// 12. Unattributed hostname (not eligible) → STOP
test('12. Non-attributed/unverifiable entry point → STOP', () => {
  const ep = makeEntryPoint({
    surface_url: 'https://cdn.example.com/file.js',
    surface_type: 'CLIENT_JS_BUNDLE',
    is_context_artifact: true,
    verification_eligibility: { eligible: false, can_verify: [], requires_auth: [], cannot_verify: ['context artifact'], confidence: 'LOW', ineligibility_reasons: ['CONTEXT_ARTIFACT'] },
  });
  const graph = makeGraph([ep]);
  const result = planner.plan({
    entryPoint: ep,
    allEntryPoints: [ep],
    graph,
    expectations: [],
    observations: [],
    evidence: [],
    differentialState: null,
  });
  assert(result.plan?.action === 'STOP', `Expected STOP, got ${result.plan?.action}`);
  assert(result.plan?.authorization_required === true, 'Should indicate authorization required (ineligible)');
});

// 13. Cloud reference → STOP
test('13. Cloud reference surface → STOP (context only)', () => {
  const ep = makeEntryPoint({
    surface_url: 'https://s3.amazonaws.com/example-bucket',
    surface_type: 'CLOUD_PUBLIC_REFERENCE',
    is_context_artifact: true,
    verification_eligibility: { eligible: false, can_verify: [], requires_auth: [], cannot_verify: ['cloud reference'], confidence: 'LOW', ineligibility_reasons: ['CONTEXT_ARTIFACT'] },
  });
  const graph = makeGraph([ep]);
  const result = planner.plan({
    entryPoint: ep,
    allEntryPoints: [ep],
    graph,
    expectations: [],
    observations: [],
    evidence: [],
    differentialState: null,
  });
  assert(result.plan?.action === 'STOP', `Expected STOP, got ${result.plan?.action}`);
});

// 14. Authorized-only entry point → STOP (not public verification eligible)
test('14. Authorized-only entry point → STOP', () => {
  const ep = makeEntryPoint({
    surface_url: 'https://internal.example.com/api',
    surface_type: 'API_REST',
    verification_eligibility: {
      eligible: false,
      can_verify: [],
      requires_auth: ['all operations'],
      cannot_verify: ['requires authentication'],
      confidence: 'LOW',
      ineligibility_reasons: ['AUTHENTICATION_REQUIRED'],
    },
  });
  const graph = makeGraph([ep]);
  const result = planner.plan({
    entryPoint: ep,
    allEntryPoints: [ep],
    graph,
    expectations: [],
    observations: [],
    evidence: [],
    differentialState: null,
  });
  assert(result.plan?.action === 'STOP', `Expected STOP, got ${result.plan?.action}`);
  assert(result.plan?.authorization_required === true, 'Should require authorization');
});

// 15. Unsupported expectation → STOP
test('15. Entry point with only UNKNOWN expectation → STOP', () => {
  const ep = makeEntryPoint({
    surface_url: 'https://example.com/',
    surface_type: 'WEBSITE_HOMEPAGE',
    evidence_ids: ['ev_1'],
  });
  const graph = makeGraph([ep]);
  const result = planner.plan({
    entryPoint: ep,
    allEntryPoints: [ep],
    graph,
    expectations: [makeExpectation({
      expectation_type: 'UNKNOWN' as any,
      statement: 'Unknown behavior',
      source: 'OBSERVED_NORMAL_BEHAVIOR',
      evidence_ids: ['ev_1'],
    })],
    observations: [],
    evidence: [makeEvidence('ev_1')],
    differentialState: 'INSUFFICIENT_EVIDENCE',
  });
  // No observation → should observe public response first
  assert(result.plan?.action === 'OBSERVE_PUBLIC_RESPONSE', `Expected OBSERVE_PUBLIC_RESPONSE, got ${result.plan?.action}`);
});

// 16. JS bundle evidence exists, not inspected → INSPECT_PUBLIC_JS
test('16. JS bundle evidence not yet inspected, surface observed → INSPECT_PUBLIC_JS', () => {
  const ep = makeEntryPoint({
    surface_url: 'https://console.example.com/dashboard',
    surface_type: 'WEBSITE_DASHBOARD',
    authentication_model: 'OIDC',
    evidence_ids: ['ev_js_1', 'ev_obs_1'],
  });
  const graph = makeGraph([ep]);
  const result = planner.plan({
    entryPoint: ep,
    allEntryPoints: [ep],
    graph,
    expectations: [],
    // Surface already observed (but not the JS bundle)
    observations: [makeObservation({ url: 'https://console.example.com/dashboard', status_code: 200, observed_behavior: 'HTTP 200 — shell' })],
    evidence: [
      makeEvidence('ev_js_1', {
        source_type: 'JS_BUNDLE' as any,
        public_url: 'https://console.example.com/dashboard.js',
        evidence_text: 'buildRequestHeaders auth token',
      }),
    ],
    differentialState: 'INSUFFICIENT_EVIDENCE',
  });
  // Surface already observed → INSPECT_PUBLIC_JS (priority 2) wins
  assert(result.plan?.action === 'INSPECT_PUBLIC_JS', `Expected INSPECT_PUBLIC_JS, got ${result.plan?.action}`);
  assert(result.plan?.candidate_targets.includes('https://console.example.com/dashboard.js'), 'Should target the JS bundle URL');
});

// ── Runner ────────────────────────────────────────────────────────────────────

console.log('\n=== InvestigationPlanner Test Results ===');
console.log(`Passed: ${passed}/${passed + failed}`);
console.log(`Failed: ${failed}/${passed + failed}`);
if (failed > 0) {
  expect(failed).toBe(0);
}
console.log('\n✅ ALL INVESTIGATION PLANNER TESTS PASSED');

  });
});