import assert from 'assert';
import { DeepSignalExtractor } from '../src/server/DeepSignalExtractor';
import { Evidence } from '../src/server/IntelligenceCase';
import { SignalCorrelationEngine } from '../src/server/signals/SignalCorrelationEngine';
import { OpportunityDetector } from '../src/server/findings/OpportunityDetector';
import { VardhanNoiseFilter } from '../src/server/findings/VardhanNoiseFilter';
import type { DeepSignal } from '../src/server/DeepTypes';
import type { SignalCandidate } from '../src/server/DeepSignalExtractor';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
describe('Migrated Suite', () => {
  test('Migrated Test', async () => {
/**
 * VARDHAN — SIGNAL QUALITY & PROMOTION AUDIT (§22)
 * ─────────────────────────────────────────────────────────────────────────────
 * Regression tests for signal generation quality. These tests ensure that
 * generic observations do NOT over-generate signals, that one observation
 * maps to at most a bounded number of signals, and that the qualification
 * gate enforces specificity.
 *
 * Covers items 1-12 from the signal quality audit:
 *   1.  HTTP 200 → no signal
 *   2.  generic CDN → no signal
 *   3.  generic framework → no signal
 *   4.  meaningful architecture observation → signal
 *   5.  meaningful scaling observation → signal
 *   6.  one observation cannot fan out into unlimited signals
 *   7.  duplicate signals collapse
 *   8.  high evidence score + generic observation → no signal
 *   9.  valid cross-source correlation
 *   10. unsupported correlation rejected
 *   11. opportunity requires meaningful pressure
 *   12. RESEARCH_MORE vs OPPORTUNITY semantics remain consistent
 */


// ── Helpers ─────────────────────────────────────────────────────────────────

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

function makeSignal(type: string, sourceUrl: string, excerpt: string, strength: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW'): DeepSignal {
  return {
    signal_id: 'sig_cand_' + Math.random().toString(36).slice(2, 8),
    type: type as any,
    source_url: sourceUrl,
    excerpt,
    provenance: 'REAL_PUBLIC_OBSERVATION' as any,
    signal_strength: strength,
    relevance: 'test signal',
    related_evidence_ids: [],
  };
}

// ── TESTS ───────────────────────────────────────────────────────────────────

console.log('Running signal quality tests...\n');

// 1. HTTP 200 → no signal
{
  const html = '<html><body><h1>Welcome</h1><p>HTTP 200 observed</p></body></html>';
  const htmlMap = new Map([['https://example.com/', html]]);
  const obs = [{ url: 'https://example.com/', type: 'PUBLIC_INSIGHT', category: 'homepage', url_normalized: 'https://example.com/' }];
  const signals = DeepSignalExtractor.extract(obs as any, htmlMap, []);
  const httpSignals = signals.filter(s => s.excerpt.includes('HTTP 200'));
  assert.strictEqual(httpSignals.length, 0, 'HTTP 200 observed should NOT produce any signal');
  console.log('  ✓ TEST 1: HTTP 200 → no signal');
}

// 2. Generic CDN → no signal
{
  const html = '<html><body><p>This site is protected by Cloudflare.</p><p>CDN powered by Akamai.</p></body></html>';
  const htmlMap = new Map([['https://example.com/', html]]);
  const obs = [{ url: 'https://example.com/', type: 'PUBLIC_INSIGHT', category: 'homepage' }];
  const signals = DeepSignalExtractor.extract(obs as any, htmlMap, []);
  const cdnSignals = signals.filter(s => /cloudflare|akamai|cdn/i.test(s.excerpt));
  assert.strictEqual(cdnSignals.length, 0, 'Generic CDN mention should NOT produce a signal');
  console.log('  ✓ TEST 2: Generic CDN → no signal');
}

// 3. Generic framework → no signal
{
  const html = '<html><body><p>Powered by Next.js and React.</p></body></html>';
  const htmlMap = new Map([['https://example.com/', html]]);
  const obs = [{ url: 'https://example.com/', type: 'PUBLIC_INSIGHT', category: 'homepage' }];
  const signals = DeepSignalExtractor.extract(obs as any, htmlMap, []);
  const frameworkSignals = signals.filter(s => /next\.js|react/i.test(s.excerpt));
  assert.strictEqual(frameworkSignals.length, 0, 'Generic framework mention should NOT produce a signal');
  console.log('  ✓ TEST 3: Generic framework → no signal');
}

// 4. Meaningful architecture observation → signal
{
  const html = '<html><body><article>We run a microservices architecture on Kubernetes, deployed across AWS and GCP.</article></body></html>';
  const htmlMap = new Map([['https://example.com/arch', html]]);
  const obs = [{ url: 'https://example.com/arch', type: 'PUBLIC_INSIGHT', category: 'engineering' }];
  const signals = DeepSignalExtractor.extract(obs as any, htmlMap, []);
  const archSignals = signals.filter(s => s.type === 'ARCHITECTURE_DISCUSSION');
  assert(archSignals.length > 0, 'Meaningful architecture description should produce ARCHITECTURE_DISCUSSION signal');
  console.log('  ✓ TEST 4: Meaningful architecture observation → signal');
}

// 5. Meaningful scaling observation → signal
{
  const html = '<html><body><article>We handle 50 million requests per day with our sharded PostgreSQL cluster.</article></body></html>';
  const htmlMap = new Map([['https://example.com/blog', html]]);
  const obs = [{ url: 'https://example.com/blog', type: 'PUBLIC_INSIGHT', category: 'blog' }];
  const signals = DeepSignalExtractor.extract(obs as any, htmlMap, []);
  const scalingSignals = signals.filter(s => s.type === 'ENGINEERING_ARTICLE');
  assert(scalingSignals.length > 0, 'Meaningful scaling description should produce ENGINEERING_ARTICLE signal');
  console.log('  ✓ TEST 5: Meaningful scaling observation → signal');
}

// 6. One observation cannot fan out into unlimited signals
{
  const html = '<html><body>' +
    '<article>We migrated to microservices on Kubernetes running in AWS and GCP.</article>' +
    '</body></html>';
  const htmlMap = new Map([['https://example.com/blog', html]]);
  const obs = [{ url: 'https://example.com/blog', type: 'PUBLIC_INSIGHT', category: 'blog' }];
  const signals = DeepSignalExtractor.extract(obs as any, htmlMap, []);
  assert(signals.length <= 1, `One page observation should produce at most 1 signal (got ${signals.length})`);
  console.log('  ✓ TEST 6: One observation → bounded signals (≤1)');
}

// 7. Duplicate signals collapse (deduped by source_url + type)
{
  const html = '<html><body><article>Available on AWS, Azure, and GCP.</article></body></html>';
  const htmlMap = new Map([['https://example.com/blog', html]]);
  const obs = [{ url: 'https://example.com/blog', type: 'PUBLIC_INSIGHT', category: 'blog' }];
  const signals = DeepSignalExtractor.extract(obs as any, htmlMap, []);
  const archSignals = signals.filter(s => s.type === 'ARCHITECTURE_DISCUSSION');
  assert.strictEqual(archSignals.length, 1, 'Should produce exactly 1 ARCHITECTURE_DISCUSSION signal (deduped)');
  console.log('  ✓ TEST 7: Duplicate signals collapse');
}

// 8. High evidence score + generic observation → no signal
{
  const html = '<html><body><article>Powered by Next.js. Protected by Cloudflare CDN.</article></body></html>';
  const htmlMap = new Map([['https://example.com/', html]]);
  const obs = [{ url: 'https://example.com/', type: 'PUBLIC_INSIGHT', category: 'homepage' }];
  const signals = DeepSignalExtractor.extract(obs as any, htmlMap, []);
  const hasGenericSignal = signals.some(s =>
    (s.excerpt.includes('next.js') || s.excerpt.includes('cloudflare') || s.excerpt.includes('cdn')) &&
    !s.excerpt.includes('Available on AWS') && !s.excerpt.includes('Kubernetes')
  );
  assert(!hasGenericSignal, 'Generic framework/CDN observation should NOT produce a signal even with evidence');
  console.log('  ✓ TEST 8: High evidence score + generic observation → no signal');
}

// 9. Valid cross-source correlation
{
  const signals: DeepSignal[] = [
    makeSignal('ARCHITECTURE_DISCUSSION', 'https://acme.com/blog', 'We migrated to microservices on Kubernetes', 'MEDIUM'),
    makeSignal('ARCHITECTURE_DISCUSSION', 'https://docs.acme.com', 'Running Kubernetes clusters on AWS', 'MEDIUM'),
    makeSignal('ENGINEERING_ARTICLE', 'https://acme.com/blog', 'database sharding at scale for 50M requests', 'HIGH'),
  ];
  const evidence: Evidence[] = [
    makeEvidence({ id: 'ev1', public_url: 'https://acme.com/blog', evidence_text: 'We migrated to microservices on Kubernetes' }),
    makeEvidence({ id: 'ev2', public_url: 'https://docs.acme.com', evidence_text: 'Running Kubernetes clusters on AWS' }),
  ];
  const result = SignalCorrelationEngine.correlate(signals, evidence);
  assert(result.correlationCount > 0, 'Should produce at least 1 correlation group from cross-source signals');
  const hasCrossSource = result.groups.some(g => g.independentSources && g.independentSources.length >= 2);
  assert(hasCrossSource, 'Should have at least one cross-source correlation group');
  console.log('  ✓ TEST 9: Valid cross-source correlation');
}

// 10. Unsupported correlation rejected
{
  const signals: DeepSignal[] = [
    makeSignal('PUBLIC_INCIDENT', 'https://acme.com/status', 'outage', 'HIGH'),
  ];
  const evidence: Evidence[] = [
    makeEvidence({ id: 'ev1', public_url: 'https://acme.com/status', evidence_text: 'outage' }),
  ];
  const result = SignalCorrelationEngine.correlate(signals, evidence);
  // Single signal from single source should not produce cross-correlated group
  const crossSourceGroups = result.groups.filter(g => g.independentSources && g.independentSources.length >= 2);
  assert.strictEqual(crossSourceGroups.length, 0, 'Single-source correlation should not be treated as cross-correlated');
  console.log('  ✓ TEST 10: Unsupported (single-source) correlation rejected');
}

// 11. Opportunity requires meaningful pressure
{
  const signals: DeepSignal[] = [
    makeSignal('ARCHITECTURE_DISCUSSION', 'https://acme.com/blog', 'We use AWS and Kubernetes', 'HIGH'),
    makeSignal('ARCHITECTURE_DISCUSSION', 'https://acme.com/docs', 'Kubernetes on GCP clusters', 'HIGH'),
    makeSignal('ENGINEERING_ARTICLE', 'https://acme.com/blog', 'sharded PostgreSQL database at scale', 'HIGH'),
    makeSignal('API_REFERENCE', 'https://acme.com/api', 'REST API endpoint documentation', 'MEDIUM'),
  ];
  const evidence: Evidence[] = [
    makeEvidence({ id: 'ev1', public_url: 'https://acme.com/blog', evidence_text: 'We use AWS and Kubernetes' }),
    makeEvidence({ id: 'ev2', public_url: 'https://acme.com/docs', evidence_text: 'Kubernetes on GCP clusters' }),
    makeEvidence({ id: 'ev3', public_url: 'https://acme.com/api', evidence_text: 'REST API endpoint documentation' }),
  ];
  const corrResult = SignalCorrelationEngine.correlate(signals, evidence);
  assert(corrResult.correlationCount > 0, 'Should have correlations for opportunity test');
  const opps = OpportunityDetector.detect(signals, evidence);
  assert(opps.length > 0, 'Should detect at least one opportunity with meaningful signals');
  const assessment = OpportunityDetector.evaluateFinding(opps[0]!, evidence.length, corrResult.correlationCount);
  assert(assessment.classification !== 'LOW_VALUE', 'Meaningful signals + correlation should not be LOW_VALUE');
  console.log('  ✓ TEST 11: Opportunity requires meaningful pressure');
}

// 12. RESEARCH_MORE vs OPPORTUNITY semantics remain consistent
{
  // Low-quality signals with single source → RESEARCH_MORE / LOW_VALUE
  const weakSignals: DeepSignal[] = [
    makeSignal('API_REFERENCE', 'https://acme.com/api', 'REST API endpoint', 'LOW'),
  ];
  const weakEvidence: Evidence[] = [
    makeEvidence({ id: 'ev1', public_url: 'https://acme.com/api', evidence_text: 'REST API endpoint' }),
  ];
  const weakOpps = OpportunityDetector.detect(weakSignals, weakEvidence);
  if (weakOpps.length > 0) {
    const weakAssessment = OpportunityDetector.evaluateFinding(weakOpps[0]!, 1, 0);
    assert(weakAssessment.classification === 'LOW_VALUE', 'Single low-quality signal should be LOW_VALUE');
  }
  console.log('  ✓ TEST 12: RESEARCH_MORE vs OPPORTUNITY semantics consistent');
}

// ── NEGATION / CONTEXT TESTS (items 13-18) ──────────────────────────────────

// 13. "service experienced downtime" → PUBLIC_INCIDENT (positive context)
{
  const html = '<html><body>' +
    '<article>Our service experienced downtime yesterday when an outage lasted 20 minutes.</article>' +
    '</body></html>';
  const htmlMap = new Map([['https://example.com/status', html]]);
  const obs = [{ url: 'https://example.com/status', type: 'PUBLIC_INSIGHT', category: 'status_ops' }];
  const signals = DeepSignalExtractor.extract(obs as any, htmlMap, []);
  const incidentSignals = signals.filter(s => s.type === 'PUBLIC_INCIDENT');
  assert(incidentSignals.length > 0, '"service experienced downtime" should produce PUBLIC_INCIDENT');
  console.log('  ✓ TEST 13: "service experienced downtime" → PUBLIC_INCIDENT');
}

// 14. "no downtime" → NOT_INCIDENT (negated context rejected)
{
  const html = '<html><body>' +
    '<article>Identical output, no downtime. Our zero-downtime deployment ensures high availability.</article>' +
    '</body></html>';
  const htmlMap = new Map([['https://example.com/ai-gateway', html]]);
  const obs = [{ url: 'https://example.com/ai-gateway', type: 'PUBLIC_INSIGHT', category: 'landing' }];
  const signals = DeepSignalExtractor.extract(obs as any, htmlMap, []);
  const incidentSignals = signals.filter(s => s.type === 'PUBLIC_INCIDENT');
  assert.strictEqual(incidentSignals.length, 0, '"no downtime" should NOT produce PUBLIC_INCIDENT (negated)');
  console.log('  ✓ TEST 14: "no downtime" → NOT_INCIDENT (rejected)');
}

// 15. "zero downtime deployment" → NOT_INCIDENT (preventive/instructional)
{
  const html = '<html><body>' +
    '<article>Our zero-downtime deployment strategy prevents service disruptions and avoids outages.</article>' +
    '</body></html>';
  const htmlMap = new Map([['https://example.com/blog', html]]);
  const obs = [{ url: 'https://example.com/blog', type: 'PUBLIC_INSIGHT', category: 'engineering' }];
  const signals = DeepSignalExtractor.extract(obs as any, htmlMap, []);
  const incidentSignals = signals.filter(s => s.type === 'PUBLIC_INCIDENT');
  assert.strictEqual(incidentSignals.length, 0, '"zero downtime deployment" should NOT produce PUBLIC_INCIDENT');
  console.log('  ✓ TEST 15: "zero downtime deployment" → NOT_INCIDENT (rejected)');
}

// 16. "prevent outages" → NOT_INCIDENT (instructional/preventive)
{
  const html = '<html><body>' +
    '<article>Our architecture prevents outages through redundant design and automatic failover.</article>' +
    '</body></html>';
  const htmlMap = new Map([['https://example.com/blog', html]]);
  const obs = [{ url: 'https://example.com/blog', type: 'PUBLIC_INSIGHT', category: 'engineering' }];
  const signals = DeepSignalExtractor.extract(obs as any, htmlMap, []);
  const incidentSignals = signals.filter(s => s.type === 'PUBLIC_INCIDENT');
  assert.strictEqual(incidentSignals.length, 0, '"prevent outages" should NOT produce PUBLIC_INCIDENT');
  console.log('  ✓ TEST 16: "prevent outages" → NOT_INCIDENT (rejected)');
}

// 17. "incident caused downtime" → PUBLIC_INCIDENT (positive + past)
{
  const html = '<html><body>' +
    '<article>Last month we had an incident that caused downtime for 30 minutes.</article>' +
    '</body></html>';
  const htmlMap = new Map([['https://example.com/postmortem/001', html]]);
  const obs = [{ url: 'https://example.com/postmortem/001', type: 'PUBLIC_INSIGHT', category: 'engineering' }];
  const signals = DeepSignalExtractor.extract(obs as any, htmlMap, []);
  const incidentSignals = signals.filter(s => s.type === 'PUBLIC_INCIDENT');
  assert(incidentSignals.length > 0, '"incident caused downtime" should produce PUBLIC_INCIDENT');
  console.log('  ✓ TEST 17: "incident caused downtime" → PUBLIC_INCIDENT');
}

// 18. "incident was resolved" → HISTORICAL/RESOLVED context (not current incident)
// Also: meaningful technical context (reliability info) can still create a non-incident signal
{
  const html = '<html><body>' +
    '<article>After the incident was resolved, we analyzed root causes and improved our monitoring. ' +
    'Our system now handles 50M requests per day on AWS with auto-scaling Kubernetes clusters.</article>' +
    '</body></html>';
  const htmlMap = new Map([['https://example.com/postmortem/002', html]]);
  const obs = [{ url: 'https://example.com/postmortem/002', type: 'PUBLIC_INSIGHT', category: 'engineering' }];
  const signals = DeepSignalExtractor.extract(obs as any, htmlMap, []);
  // The "downtime/resolved" context should NOT produce PUBLIC_INCIDENT (historical)
  const incidentSignals = signals.filter(s => s.type === 'PUBLIC_INCIDENT');
  // But the technical content about AWS + Kubernetes scaling should still produce a signal
  const techSignals = signals.filter(s => s.type === 'ARCHITECTURE_DISCUSSION' || s.type === 'ENGINEERING_ARTICLE');
  assert.strictEqual(incidentSignals.length, 0, '"incident was resolved" should NOT produce current PUBLIC_INCIDENT');
  assert(techSignals.length > 0, 'Resolved incident page with technical content should still produce a non-incident signal');
  console.log('  ✓ TEST 18: "incident was resolved" → no incident, technical context still signals');
}

console.log('\n=== ALL SIGNAL QUALITY TESTS PASSED ===');

  });
});