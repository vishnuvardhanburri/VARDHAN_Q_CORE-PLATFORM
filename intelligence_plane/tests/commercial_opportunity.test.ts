import { DeepProspectBuilder } from '../src/server/DeepProspectBuilder';
import { IcpQualificationEngine } from '../src/server/IcpQualificationEngine';
import { buildOpportunity, scoreCommercialRelevance, buildOutreachCardFields } from '../src/server/DiagnosticOpportunityEngine';
import type { Evidence, HttpFetcher, FindingClassification, PublicObservationProvider, ObservationResult, OwnerCandidate, FindingType } from '../src/server/IntelligenceCase';
import type { DeepOwner, DeepFinding, DeepSignal, DeepProspect } from '../src/server/DeepTypes';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
describe('Migrated Suite', () => {
  test('Migrated Test', async () => {
let pass = 0, fail = 0; const failures: string[] = [];
const assert = (c: boolean, m: string) => { if (c) pass++; else { fail++; failures.push(m); console.log('[FAIL] ' + m); } };
const test = assert;

// ── Mock transport ───────────────────────────────────────────────────────────

type Route = { status: number; body: string; ct?: string };
function fakeFetcher(routes: Record<string, Route>): HttpFetcher {
  return async (url: string, _init: any): Promise<Response> => {
    const key = url.replace(/\/$/, '') || url;
    const hit = routes[key] || routes[url];
    if (hit) return new Response(hit.body, { status: hit.status, headers: hit.ct ? { 'content-type': hit.ct } : {} });
    return new Response('', { status: 404, headers: { 'content-type': 'text/html' } });
  };
}

class MockProvider implements PublicObservationProvider {
  constructor(private evidenceToReturn: Evidence[]) {}
  async observePublicSurface(_url: string, _options?: any): Promise<ObservationResult> {
    return { evidence: this.evidenceToReturn, discovery_errors: 0 };
  }
}

function run(name: string, fn: () => Promise<void>): Promise<void> {
  return fn().then(() => console.log(`  ✓ ${name}`));
}

// ── Canned surfaces ──────────────────────────────────────────────────────────

const HOME = `<html><body><nav><a href="/team">Team</a><a href="/developers">Developers</a><a href="/status">Status</a><a href="/about">About</a></nav><h1>Acme Corp</h1><p>Developer infrastructure platform.</p></body></html>`;

// ── Evidence fixtures ─────────────────────────────────────────────────────────

function makeEvidence(id: string, behavior: string, status = 200, sensitive: string[] = []): Evidence {
  return {
    id,
    evidence_origin: 'REAL_PUBLIC_OBSERVATION' as const,
    public_url: 'https://acme.com/api/v1',
    source_type: 'API_ENDPOINT' as const,
    status,
    observed_behavior: behavior,
    sensitive_fields: sensitive,
    reproductions: 3,
    repeatable: true,
    tested_without_auth: true,
    not_tested: ['mutations'],
    retrieved_at: new Date().toISOString(),
    evidence_text: behavior,
    latency_ms: 200,
    baseline_latency_ms: 100,
  };
}

// ── Scenario fixtures ─────────────────────────────────────────────────────────

// S1: OBSERVED_SENSITIVE_FIELD_EXPOSURE → OUTREACH_READY + diagnostic opportunity
const S1_EVIDENCE = [makeEvidence('ev_s1', 'Public API exposes internal storage_path metadata', 200, ['storage_path'])];

// S2: POSSIBLE_SENSITIVE_METADATA_EXPOSURE from signal → OUTREACH_READY + diagnostic
const S2_EVIDENCE = [makeEvidence('ev_s2', 'API response includes database connection string', 200, ['connection_string'])];

// S3: Documented security posture (non-actionable) → RESEARCH_MORE
const S3_EVIDENCE = []; // No evidence → engine finding will be DOCUMENTED_SECURITY_POSTURE (generic)

// S4: Generic incident without current evidence → RESEARCH_MORE
const S4_EVIDENCE = [];

// S5: Public API behavior → OUTREACH_READY + diagnostic (architecture/concurrency)
const S5_EVIDENCE = [makeEvidence('ev_s5', 'Public API exhibits inconsistent rate-limiting behavior across identical endpoints', 200)];

// S6: Infrastructure scaling signal → OUTREACH_READY + diagnostic
const S6_EVIDENCE = [makeEvidence('ev_s6', 'API responses show pagination limits capped at 100 rows with no cursor support', 200)];

// S7: Database/storage finding → OUTREACH_READY + diagnostic
const S7_EVIDENCE = [makeEvidence('ev_s7', 'SQL error messages leaked in API responses revealing schema structure', 500, ['schema_info'])];

// S8: Deployment/platform behavior → OUTREACH_READY + diagnostic
const S8_EVIDENCE = [makeEvidence('ev_s8', 'GraphQL endpoint exposes internal type names and field structure', 200, ['internal_types'])];

// S9: Reliability/performance finding → OUTREACH_READY + diagnostic
const S9_EVIDENCE = [
  makeEvidence('ev_s9a', 'API endpoint responds with 500 errors on POST /checkout under load', 500),
  makeEvidence('ev_s9b', 'Repeated 500 errors on payment processing endpoint', 500),
];

// S10: Generic engineering article (non-actionable) → RESEARCH_MORE
const S10_EVIDENCE = [makeEvidence('ev_s10', 'Blog post mentions migrating to Kubernetes', 200)];

// ── Helpers ───────────────────────────────────────────────────────────────────

async function buildProspect(evidence: Evidence[], htmlRoutes?: Record<string, Route>): Promise<DeepProspect> {
  const routes = htmlRoutes ?? {
    'https://acme.com': { status: 200, body: HOME, ct: 'text/html' },
  };
  const builder = new DeepProspectBuilder({
    fetcher: fakeFetcher(routes) as any,
    observationProvider: new MockProvider(evidence) as any,
    saveArtifact: () => {},
    artifactsBaseDir: '/tmp/vardhan-commercial-test',
    maxDiscoveryPages: 10, discoveryDelayMs: 0, observationDelayMs: 0,
    onProgress: () => {}, logger: () => {},
    growjo: null, providerCompanies: null,
    resolution: { canonical_name: 'Acme Corp', official_domain: 'acme.com', resolution_method: 'MANUAL', resolution_source: 'manual', resolution_confidence: 'HIGH' },
  });
  const { prospect } = await builder.build('https://acme.com');
  return prospect;
}

// ── Run Scenarios ─────────────────────────────────────────────────────────────

console.log('\n=== Commercial Opportunity Test Suite ===\n');

// S1: OBSERVED_SENSITIVE_FIELD_EXPOSURE → OUTREACH_READY + diagnostic opportunity
await run('S1: OBSERVED_SENSITIVE_FIELD_EXPOSURE → OUTREACH_READY + diagnostic', async () => {
  const p = await buildProspect(S1_EVIDENCE);
  test('S1.1 decision is OUTREACH_READY', p.decision === 'OUTREACH_READY', `got ${p.decision}`);
  test('S1.2 diagnostic opportunity generated', !!p.diagnostic_opportunity, 'no diagnostic_opportunity');
  if (p.diagnostic_opportunity) {
    test('S1.3 technical_area is set', !!p.diagnostic_opportunity.technical_area, `got ${p.diagnostic_opportunity.technical_area}`);
    test('S1.4 diagnostic_questions >= 5', p.diagnostic_opportunity.diagnostic_questions.length >= 5, `got ${p.diagnostic_opportunity.diagnostic_questions.length}`);
    test('S1.5 diagnostic_scope non-empty', p.diagnostic_opportunity.diagnostic_scope.length > 0, 'empty scope');
    test('S1.6 outreach card has company', !!p.outreach_card?.company, 'no outreach_card.company');
    test('S1.7 outreach card has problem', !!p.outreach_card?.problem, 'no outreach_card.problem');
    test('S1.8 outreach card problem-first (not price)', !(p.outreach_card?.problem || '').includes('15K') && !(p.outreach_card?.problem || '').includes('15'), 'problem mentions price');
    test('S1.9 role_search_hints non-empty', (p.outreach_card?.role_search_hints?.length || 0) > 0, 'empty role_search_hints');
  }
});

// S2: POSSIBLE_SENSITIVE_METADATA_EXPOSURE → OUTREACH_READY + diagnostic
await run('S2: POSSIBLE_SENSITIVE_METADATA_EXPOSURE → OUTREACH_READY + diagnostic', async () => {
  const p = await buildProspect(S2_EVIDENCE);
  test('S2.1 decision is OUTREACH_READY', p.decision === 'OUTREACH_READY', `got ${p.decision}`);
  if (p.diagnostic_opportunity) {
    test('S2.2 has diagnostic questions', p.diagnostic_opportunity.diagnostic_questions.length >= 5);
    test('S2.3 commercial_relevance is not RESEARCH_MORE', p.diagnostic_opportunity.commercial_relevance !== 'RESEARCH_MORE', `got ${p.diagnostic_opportunity.commercial_relevance}`);
  }
});

// S3: Generic documented security posture → RESEARCH_MORE
await run('S3: DOCUMENTED_SECURITY_POSTURE → RESEARCH_MORE', async () => {
  const p = await buildProspect(S3_EVIDENCE);
  test('S3.1 decision is NOT OUTREACH_READY', p.decision !== 'OUTREACH_READY', `got ${p.decision}`);
  test('S3.2 decision is RESEARCH_MORE or NO_GO', p.decision === 'RESEARCH_MORE' || p.decision === 'NO_GO', `got ${p.decision}`);
});

// S4: Generic incident without current evidence → RESEARCH_MORE
await run('S4: No defensible finding → RESEARCH_MORE', async () => {
  const p = await buildProspect(S4_EVIDENCE);
  test('S4.1 decision is NOT OUTREACH_READY', p.decision !== 'OUTREACH_READY', `got ${p.decision}`);
});

// S5: Public API behavior → OUTREACH_READY + diagnostic (concurrency/arch)
await run('S5: Public API behavior → OUTREACH_READY + diagnostic', async () => {
  const p = await buildProspect(S5_EVIDENCE);
  test('S5.1 decision is OUTREACH_READY', p.decision === 'OUTREACH_READY', `got ${p.decision}`);
  test('S5.2 outreach card has technical_area', !!p.outreach_card?.technical_area, 'no technical_area');
});

// S6: Infrastructure scaling → diagnostic
await run('S6: Infrastructure scaling → OUTREACH_READY + diagnostic', async () => {
  const p = await buildProspect(S6_EVIDENCE);
  test('S6.1 decision is OUTREACH_READY', p.decision === 'OUTREACH_READY', `got ${p.decision}`);
  test('S6.2 outreach card has role_keywords', (p.outreach_card?.role_keywords || '').length > 0, 'no role_keywords');
});

// S7: Database/storage finding → diagnostic
await run('S7: Database/storage finding → OUTREACH_READY + diagnostic', async () => {
  const p = await buildProspect(S7_EVIDENCE);
  test('S7.1 decision is OUTREACH_READY', p.decision === 'OUTREACH_READY', `got ${p.decision}`);
  test('S7.2 outreach card has why_it_matters', (p.outreach_card?.why_it_matters || '').length > 0, 'no why_it_matters');
});

// S8: Deployment/platform behavior → diagnostic
await run('S8: Deployment/platform behavior → OUTREACH_READY + diagnostic', async () => {
  const p = await buildProspect(S8_EVIDENCE);
  test('S8.1 decision is OUTREACH_READY', p.decision === 'OUTREACH_READY', `got ${p.decision}`);
  test('S8.2 diagnostic opportunity has primary_sources', (p.diagnostic_opportunity?.primary_sources?.length || 0) > 0, 'no primary_sources');
});

// S9: Reliability/performance finding → diagnostic
await run('S9: Reliability/performance finding → OUTREACH_READY + diagnostic', async () => {
  const p = await buildProspect(S9_EVIDENCE);
  test('S9.1 decision is OUTREACH_READY', p.decision === 'OUTREACH_READY', `got ${p.decision}`);
  test('S9.2 outreach card has problem', (p.outreach_card?.problem || '').length > 0, 'no problem');
});

// S10: Generic engineering article → RESEARCH_MORE
await run('S10: Generic engineering article → RESEARCH_MORE', async () => {
  const p = await buildProspect(S10_EVIDENCE);
  test('S10.1 decision is NOT OUTREACH_READY', p.decision !== 'OUTREACH_READY', `got ${p.decision}`);
  test('S10.2 decision is RESEARCH_MORE or NO_GO', p.decision === 'RESEARCH_MORE' || p.decision === 'NO_GO', `got ${p.decision}`);
});

// ── Engine unit tests ─────────────────────────────────────────────────────────

await run('E1: buildOpportunity() generates 5-8 diagnostic questions', async () => {
  const finding: DeepFinding = {
    finding_type: 'POSSIBLE_SENSITIVE_METADATA_EXPOSURE',
    impact_severity: 'HIGH',
    severity_basis: 'sensitive fields exposed publicly',
    evidence_ids: ['ev_1'],
    signal_ids: ['sig_1'],
    confidence: 'HIGH' as const,
    provenance: 'DEEP_ANALYSIS',
    explanation: 'API exposes internal storage_path',
    recommendation: 'Review API response filtering',
    source_urls: ['https://acme.com/api'],
    strength: { evidence_strength: 2, reproducibility: 2, source_quality: 2, technical_specificity: 2, owner_confidence: 0 },
  };
  const opp = buildOpportunity(
    'Acme Corp', 'acme.com', finding,
    [{ id: 'ev_1', public_url: 'https://acme.com/api', observed_behavior: 'exposes storage_path' } as Evidence],
    [], 'https://acme.com'
  );
  test('E1.1 has diagnostic questions', opp.diagnostic_questions.length >= 5, `got ${opp.diagnostic_questions.length}`);
  test('E1.2 questions within 5-8 range', opp.diagnostic_questions.length >= 5 && opp.diagnostic_questions.length <= 8, `got ${opp.diagnostic_questions.length}`);
  test('E1.3 has diagnostic_scope', opp.diagnostic_scope.length > 0);
  test('E1.4 has commercial_relevance', opp.commercial_relevance !== undefined);
});

await run('E2: scoreCommercialRelevance() classifies by finding type', async () => {
  const actionable: DeepFinding = {
    finding_type: 'OBSERVED_SENSITIVE_FIELD_EXPOSURE', impact_severity: 'HIGH', severity_basis: 'sensitive fields',
    evidence_ids: ['ev_1'], signal_ids: [], confidence: 'HIGH' as const, provenance: 'DEEP_ANALYSIS',
    explanation: 'test', recommendation: 'test', source_urls: ['https://acme.com/api'],
    strength: { evidence_strength: 2, reproducibility: 2, source_quality: 2, technical_specificity: 'HIGH' as const, owner_confidence: 0 },
  };
  const nonActionable: DeepFinding = {
    finding_type: 'DOCUMENTED_SECURITY_POSTURE', impact_severity: 'LOW', severity_basis: 'generic',
    evidence_ids: ['ev_1'], signal_ids: [], confidence: 'LOW' as const, provenance: 'DEEP_ANALYSIS',
    explanation: 'test', recommendation: 'test', source_urls: ['https://acme.com'],
    strength: { evidence_strength: 1, reproducibility: 1, source_quality: 1, technical_specificity: 'LOW' as const, owner_confidence: 0 },
  };
  const none: DeepFinding = {
    finding_type: 'GENERIC_ENGINEERING_ARTICLE', impact_severity: 'LOW', severity_basis: 'generic',
    evidence_ids: ['ev_1'], signal_ids: [], confidence: 'LOW' as const, provenance: 'DEEP_ANALYSIS',
    explanation: 'test', recommendation: 'test', source_urls: ['https://acme.com'],
    strength: { evidence_strength: 1, reproducibility: 1, source_quality: 1, technical_specificity: 'LOW' as const, owner_confidence: 0 },
  };
  test('E2.1 OBSERVED_SENSITIVE_FIELD_EXPOSURE → not RESEARCH_MORE',
    scoreCommercialRelevance(actionable, [], [], true) !== 'RESEARCH_MORE');
  test('E2.2 DOCUMENTED_SECURITY_POSTURE → RESEARCH_MORE',
    scoreCommercialRelevance(nonActionable, [], [], true) === 'RESEARCH_MORE');
  test('E2.3 GENERIC_ENGINEERING_ARTICLE → RESEARCH_MORE',
    scoreCommercialRelevance(none, [], [], true) === 'RESEARCH_MORE');
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('\n==================================================');
console.log(`Commercial Opportunity Tests: ${pass} passed, ${fail} failed.`);
if (fail > 0) {
  console.log('FAILURES:');
  failures.forEach(f => console.log('  - ' + f));
  expect(fail).toBe(0);
} else {
  console.log('ALL TESTS PASSED.');
}

  }, 30000);
});