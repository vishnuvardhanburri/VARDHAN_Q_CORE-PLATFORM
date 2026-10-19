import assert from 'assert';
import { DeepSignalExtractor } from '../src/server/DeepSignalExtractor';
import { SignalCorrelationEngine } from '../src/server/signals/SignalCorrelationEngine';
import { OpportunityDetector } from '../src/server/findings/OpportunityDetector';
import type { Evidence } from '../src/server/IntelligenceCase';
import type { DeepSignal } from '../src/server/DeepTypes';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
describe('Migrated Suite', () => {
  test('Migrated Test', async () => {

function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: 'ev_test_' + Math.random().toString(36).slice(2, 8),
    company_id: 'test-co',
    evidence_origin: 'REAL_PUBLIC_OBSERVATION',
    type: 'PUBLIC_OBSERVATION' as any,
    public_url: 'https://example.com/api',
    source_type: 'API_ENDPOINT',
    source_title: 'Test API',
    relationship_type: 'OWNED',
    retrieved_at: new Date().toISOString(),
    observed_behavior: 'HTTP 200 observed',
    reproductions: 1,
    repeatable: false,
    tested_without_auth: true,
    not_tested: ['mutations', 'auth bypass'] as string[],
    status: 200,
    evidence_text: '',
    raw_observation: '',
    ...overrides,
  } as Evidence;
}

console.log('Running Regression: Pseudo-Signal Invariant Tests...\n');

// 1. RAW EVIDENCE -> 0 QUALIFIED SIGNALS -> 0 CORRELATIONS -> RESEARCH_MORE
{
  console.log('Testing: Raw Evidence -> No Opportunity');

  // Raw evidence that looks like a signal but is too generic to qualify
  const evidence = [
    makeEvidence({
      id: 'ev_raw_1',
      public_url: 'https://vercel.com/api',
      observed_behavior: 'HTTP 200 observed'
    }),
    makeEvidence({
      id: 'ev_raw_2',
      public_url: 'https://vercel.com/status',
      observed_behavior: 'All systems operational'
    })
  ];

  // Mock observations that would lead to these pieces of evidence
  const observations = [
    { url: 'https://vercel.com/api', type: 'PUBLIC_INSIGHT', category: 'api' },
    { url: 'https://vercel.com/status', type: 'PUBLIC_INSIGHT', category: 'status_ops' }
  ];
  const htmlMap = new Map([
    ['https://vercel.com/api', '<html><body>HTTP 200 observed</body></html>'],
    ['https://vercel.com/status', '<html><body>All systems operational</body></html>']
  ]);

  // Extract & Qualify
  const signals = DeepSignalExtractor.extract(observations as any, htmlMap, evidence);

  console.log(`  - Qualified signals count: ${signals.length}`);
  assert.strictEqual(signals.length, 0, 'Generic raw evidence must NOT produce qualified signals');

  // Correlation
  const corrResult = SignalCorrelationEngine.correlate(signals, evidence);
  console.log(`  - Correlation count: ${corrResult.correlationCount}`);
  assert.strictEqual(corrResult.correlationCount, 0, 'Unqualified signals must NOT produce correlations');

  // Opportunity
  const opps = OpportunityDetector.detect(signals, evidence);
  const assessment = opps.length > 0
    ? OpportunityDetector.evaluateFinding(opps[0]!, evidence.length, corrResult.correlationCount)
    : { classification: 'RESEARCH_MORE' as any };

  console.log(`  - Final Decision: ${assessment.classification}`);
  assert.strictEqual(assessment.classification, 'RESEARCH_MORE', 'Raw evidence should result in RESEARCH_MORE');
  console.log('  ✓ PASSED: Raw Evidence -> RESEARCH_MORE');
}

// 2. PSEUDO-SIGNAL IDs (sig_ev_*) -> REJECTED BY CORRELATION ENGINE
{
  console.log('\nTesting: Pseudo-Signal ID Rejection');

  const pseudoSignals: any[] = [
    {
      signal_id: 'sig_ev_live_123', // The forbidden pattern
      type: 'PUBLIC_INCIDENT',
      source_url: 'https://example.com/status',
      excerpt: 'Major outage reported',
      provenance: 'REAL_PUBLIC_OBSERVATION',
      signal_strength: 'HIGH',
      related_evidence_ids: ['ev_123']
    }
  ];
  const evidence = [makeEvidence({ id: 'ev_123' })];

  const corrResult = SignalCorrelationEngine.correlate(pseudoSignals, evidence);
  console.log(`  - Correlation count: ${corrResult.correlationCount}`);
  assert.strictEqual(corrResult.correlationCount, 0, 'CorrelationEngine must reject sig_ev_* pseudo-signals');
  console.log('  ✓ PASSED: Pseudo-Signal IDs Rejected');
}

// 3. POSITIVE PATH: QUALIFIED SIGNAL -> VALID CORRELATION -> OPPORTUNITY
{
  console.log('\nTesting: Positive Path (Qualified Signal -> Opportunity)');

  const evidence = [
    makeEvidence({
      id: 'ev_q1',
      public_url: 'https://acme.com/blog',
      observed_behavior: 'We migrated to microservices on Kubernetes',
      strength: 'HIGH'
    }),
    makeEvidence({
      id: 'ev_q2',
      public_url: 'https://docs.acme.com',
      observed_behavior: 'Running Kubernetes clusters on AWS',
      strength: 'HIGH'
    })
  ];

  const observations = [
    { url: 'https://acme.com/blog', type: 'PUBLIC_INSIGHT', category: 'blog' },
    { url: 'https://docs.acme.com', type: 'PUBLIC_INSIGHT', category: 'docs' }
  ];
  const htmlMap = new Map([
    ['https://acme.com/blog', '<html><body>We migrated to microservices on Kubernetes</body></html>'],
    ['https://docs.acme.com', '<html><body>Running Kubernetes clusters on AWS</body></html>']
  ]);

  const signals = DeepSignalExtractor.extract(observations as any, htmlMap, evidence);
  console.log(`  - Qualified signals count: ${signals.length}`);
  assert(signals.length >= 2, 'Should produce at least 2 qualified signals');

  const corrResult = SignalCorrelationEngine.correlate(signals, evidence);
  console.log(`  - Correlation count: ${corrResult.correlationCount}`);
  assert(corrResult.correlationCount > 0, 'Should produce at least 1 correlation');

  const opps = OpportunityDetector.detect(signals, evidence);
  const assessment = opps.length > 0
    ? OpportunityDetector.evaluateFinding(opps[0]!, { a: 1 } as any, corrResult.correlationCount)
    : { classification: 'RESEARCH_MORE' as any };

  console.log(`  - Final Decision: ${assessment.classification}`);
  assert(assessment.classification === 'ENGINEERING_OPPORTUNITY' || assessment.classification === 'VERIFIED_FINDING', 'Qualified signals + correlation should produce an Opportunity');
  console.log('  ✓ PASSED: Qualified Path -> Opportunity');
}

console.log('\n=== ALL REGRESSION TESTS PASSED ===');

  });
});