import type { HttpFetcher, Evidence } from '../src/server/IntelligenceCase';
import type { SearchProvider } from '../src/server/WebSearchProvider';
import type { VardhanModelGateway } from '../src/server/VardhanModelGateway';
import type { DeepSignal, SignalSourceType } from '../src/server/DeepTypes';
import { BudgetController, BUDGET_TIERS } from '../src/server/research/ResearchBudget';
import { TriageEngine } from '../src/server/research/TriageEngine';
import { HypothesisEngine, type Hypothesis } from '../src/server/research/HypothesisEngine';
import { ResearchActionSelector } from '../src/server/research/ResearchActionSelector';
import { VardhanResearchController } from '../src/server/research/VardhanResearchController';
import { VardhanNoiseFilter } from '../src/server/findings/VardhanNoiseFilter';
import { OpportunityDetector, type EngineeringOpportunity } from '../src/server/findings/OpportunityDetector';
import { SignalCorrelationEngine } from '../src/server/signals/SignalCorrelationEngine';
import { FindingQA, type QAContext } from '../src/server/findings/FindingQA';
import { FindingGraph } from '../src/server/findings/FindingGraph';
import { ChangeDetector as OriginalChangeDetector, snapshotFromProspect } from '../src/server/ChangeDetector';
import { ChangeDetector as FreshnessChangeDetector } from '../src/server/freshness/ChangeDetector';
import { EvidenceLedger } from '../src/server/EvidenceLedger';
import { StatePersistence, type PersistedResearchState } from '../src/server/StatePersistence';
import { VardhanSystemManager } from '../src/server/system/VardhanSystemManager';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
describe('Migrated Suite', () => {
  test('Migrated Test', async () => {
/**
 * VARDHAN — RESEARCH CONTROLLER + FINDING INTEGRATION TESTS (§22)
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests for all 22 testing areas:
 *   1.  Fast triage (PASS vs STOP)
 *   2.  Early stop on low-value companies
 *   3.  Adaptive escalation (TRIAGE → TARGETED → DEEP)
 *   4.  Hypothesis generation
 *   5.  Research action ranking
 *   6.  Budget accounting
 *   7.  Noise filtering (1×403/429/timeout rejection, generic tech rejection,
 *       stale article, single latency, single job posting, funding alone)
 *   8.  Repeated observation escalation
 *   9.  Cross-source correlation
 *  10.  Finding evaluation
 *  11.  Evidence provenance preservation (all 6 tags)
 *  12.  Freshness / change detection
 *  13.  Research resume (state persistence)
 *  14.  Acquisition fallback (errors don't crash)
 *  15.  Model evidence binding
 *  16.  Adversarial finding QA (FindingQA)
 *  17.  FindingGraph traceability
 *  18.  Owner gate
 *  19.  Outreach gate
 *  20.  End-to-end controller integration
 *  21.  SystemManager orchestration
 *  22.  No fabrication (evidence provenance check)
 */




let pass = 0, fail = 0; const failures: string[] = [];
const assert = (c: boolean, m: string) => { if (c) pass++; else { fail++; failures.push(m); console.log('[FAIL] ' + m); } };
const assertEq = <T,>(a: T, b: T, m: string) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (ok) pass++; else { fail++; failures.push(`${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); console.log('[FAIL] ' + m); } };
const assertGT = (a: number, b: number, m: string) => { const ok = a > b; if (ok) pass++; else { fail++; failures.push(`${m} (got ${a}, want > ${b})`); console.log('[FAIL] ' + m); } };
const assertGE = (a: number, b: number, m: string) => { const ok = a >= b; if (ok) pass++; else { fail++; failures.push(`${m} (got ${a}, want >= ${b})`); console.log('[FAIL] ' + m); } };
const assertLE = (a: number, b: number, m: string) => { const ok = a <= b; if (ok) pass++; else { fail++; failures.push(`${m} (got ${a}, want <= ${b})`); console.log('[FAIL] ' + m); } };
const assertNE = (a: any, b: any, m: string) => { const ok = a !== b; if (ok) pass++; else { fail++; failures.push(`${m} (got ${JSON.stringify(a)})`); console.log('[FAIL] ' + m); } };

// ── Test helpers ──────────────────────────────────────────────────────────

function makeFakeFetcher(routes: Record<string, { status?: number; html: string; latency?: number; headers?: Record<string, string> }>): HttpFetcher {
  return (async (input: string | URL, init?: any) => {
    const url = String(input).replace(/\/$/, '');
    const route = routes[url] || routes['https://' + url];
    if (!route) {
      return new Response('', { status: 404 });
    }
    if (route.latency) await new Promise(r => setTimeout(r, route.latency));
    return new Response(route.html, { status: route.status ?? 200, headers: route.headers });
  }) as unknown as HttpFetcher;
}

function makeNullSearchProvider(): SearchProvider {
  return {
    name: 'null-search',
    search: async (_q: string, _o?: any) => ({ query: _q, results: [], totalResults: 0, source: 'NULL', cached: false, latencyMs: 0 }),
    close: async () => {},
  } as unknown as SearchProvider;
}

function makeFakeModelGateway(): VardhanModelGateway {
  return {
    name: 'fake-model',
    available: true,
    generate: async (request: any) => ({
      text: JSON.stringify({ classification: 'ENGINEERING_OPPORTUNITY', confidence: 'MEDIUM', explanation: 'Test finding.' }),
      model: 'fake',
      metrics: { total_tokens: 20, prompt_tokens: 10, completion_tokens: 10, latency_ms: 5, cost_usd: 0 },
      refused: false,
    }),
    addProvider: () => {},
    checkHealth: async () => true,
    listModels: async () => ['fake-model'],
    listAllModels: async () => ({ 'fake-model': ['fake'] }),
    get hasAvailableModel() { return true; },
  } as unknown as VardhanModelGateway;
}

function makeSignal(overrides: Partial<DeepSignal> & Pick<DeepSignal, 'signal_id'>): DeepSignal {
  return {
    signal_id: overrides.signal_id || 'sig_cand_' + Math.random().toString(36).slice(2, 8),
    type: (overrides.type || 'BLOG') as SignalSourceType,
    source_url: overrides.source_url || 'https://example.com/blog',
    excerpt: (overrides.excerpt || (overrides as any).text || 'technical article'),
    provenance: (overrides.provenance || 'REAL_PUBLIC_OBSERVATION') as any,
    signal_strength: (overrides.signal_strength || 'MEDIUM') as any,
    relevance: overrides.relevance || 'test',
    ...(overrides as any),
  } as DeepSignal;
}

function makeEvidence(overrides: Partial<Evidence> & Pick<Evidence, 'id'>): Evidence {
  return {
    evidence_origin: overrides.evidence_origin || 'REAL_PUBLIC_OBSERVATION',
    public_url: overrides.public_url || 'https://example.com',
    source_type: overrides.source_type || 'UNKNOWN',
    observed_behavior: overrides.observed_behavior || 'test observation',
    reproductions: overrides.reproductions ?? 1,
    repeatable: overrides.repeatable ?? true,
    tested_without_auth: overrides.tested_without_auth ?? true,
    not_tested: overrides.not_tested ?? [],
    retrieved_at: overrides.retrieved_at || new Date().toISOString(),
    evidence_text: overrides.evidence_text || 'test',
    ...(overrides as any),
  } as Evidence;
}

// ═══════════════════════════════════════════════════
// Test suites
// ══════════════════════════════════════════════════════════════════════════

async function runAll(): Promise<void> {
  console.log('Running §22 research controller + finding tests...\n');

  // ── 1 & 6. BudgetController ──────────────────────────────────────────
  {
    const b = new BudgetController('TRIAGE');
    const alloc = b.get('TRIAGE');
    assertEq(alloc.budget.maxHttpRequests, 10, 'TRIAGE http limit');
    assertEq(alloc.budget.maxSearchQueries, 3, 'TRIAGE search limit');
    assertEq(alloc.budget.maxBrowserPages, 0, 'TRIAGE browser limit');
    assertEq(alloc.budget.maxModelCalls, 1, 'TRIAGE model limit');
    assertEq(alloc.budget.maxRuntimeMs, 30_000, 'TRIAGE time limit');

    const b2 = new BudgetController('DEEP');
    const alloc2 = b2.get('DEEP');
    assertEq(alloc2.budget.maxHttpRequests, 100, 'DEEP http limit');
    assertEq(alloc2.budget.maxSearchQueries, 20, 'DEEP search limit');
    assertEq(alloc2.budget.maxBrowserPages, 15, 'DEEP browser limit');
    assertEq(alloc2.budget.maxRuntimeMs, 600_000, 'DEEP time limit');

    // consume + canAfford
    const b3 = new BudgetController('TRIAGE');
    b3.consume('TRIAGE', 'httpRequests');
    b3.consume('TRIAGE', 'httpRequests');
    assertEq(b3.get('TRIAGE').consumed.httpRequests, 2, 'consume tracks http');
    assert(b3.canAfford('TRIAGE', 'http'), 'canAfford true after 2');
    b3.consume('TRIAGE', 'httpRequests', 8);
    assertEq(b3.get('TRIAGE').consumed.httpRequests, 10, 'consume 8 more = 10');
    assert(!b3.canAfford('TRIAGE', 'http'), 'canAfford false at 10');

    // shouldStop when exhausted
    const b4 = new BudgetController('TRIAGE');
    b4.consume('TRIAGE', 'httpRequests', 10);
    assert(b4.isExhausted('TRIAGE'), 'exhausted at max http');
    assert(b4.shouldStop('TRIAGE'), 'shouldStop when exhausted');

    // escalate
    b.escalate('TRIAGE', 'TARGETED');
    const targetAlloc = b.get('TARGETED');
    assertEq(targetAlloc.budget.maxHttpRequests, 30, 'escalate to TARGETED');

    // stopEarly
    const b6 = new BudgetController('TRIAGE');
    b6.stopEarly('TRIAGE');
    assert(b6.shouldStop('TRIAGE'), 'shouldStop when stopEarly');

    // summarize
    const s = b.summarize('TRIAGE');
    assert(s.includes('TRIAGE'), 'summarize contains tier name');
  }
  console.log('  ✓ BudgetController (§1, §6)');

  // ── 2. Fast triage (PASS vs STOP) ────────────────────────────────
  {
    const fetcher = makeFakeFetcher({
      'https://example.com': {
        status: 200,
        html: `<html><body>
          <a href="/github">GitHub</a>
          <a href="/api/docs">API Docs</a>
          <a href="/careers/engineering">Engineering Jobs</a>
          <a href="/status">Status Page</a>
          <a href="/blog">Engineering Blog</a>
        </body></html>`,
        headers: { 'x-powered-by': 'Express' },
      },
      'https://example.com/robots.txt': { status: 200, html: 'User-agent: *\nDisallow: /admin/' },
      'https://example.com/sitemap.xml': { status: 200, html: '<urlset><url><loc>https://example.com/api/docs</loc></url></urlset>' },
    });

    const result = await TriageEngine.triage('Example Inc', 'example.com', fetcher, { maxRequests: 10, maxRuntimeMs: 30000 });
    assertEq(result.decision, 'PASS_FOR_DEEP_RESEARCH', 'triage passes with tech surface');
    assertGT(result.signals.length, 0, 'triage finds signals');
    assertLE(result.httpRequestsUsed, 10, 'triage within 10 HTTP requests');
    assertLE(result.timeMs, 30000, 'triage within 30s');
    assertGT(result.sourcesChecked.length, 0, 'triage checks sources');
  }

  // ── Low value company → STOP ──
  {
    const fetcher = makeFakeFetcher({
      'https://lowvalue.com': {
        status: 200,
        html: `<html><body><h1>Welcome to Low Value Corp</h1><p>We sell paper.</p></body></html>`,
      },
      'https://lowvalue.com/robots.txt': { status: 200, html: '' },
    });
    const result = await TriageEngine.triage('Low Value Corp', 'lowvalue.com', fetcher, { maxRequests: 10, maxRuntimeMs: 30000 });
    assertEq(result.decision, 'STOP_LOW_VALUE', 'triage stops low value');
  }
  console.log('  ✓ TriageEngine (§2)');

  // ── 3. Adaptive escalation ──────────────────────────────────────────
  {
    // STOP → not escalated
    const fetcher = makeFakeFetcher({
      'https://no-tech.com': { status: 200, html: '<html><body>No tech links</body></html>' },
      'https://no-tech.com/robots.txt': { status: 200, html: '' },
    });
    const controller = new VardhanResearchController({
      fetcher, searchProvider: makeNullSearchProvider(), modelGateway: makeFakeModelGateway(),
      maxTriageRuntimeMs: 1000, artifactsDir: '/tmp/vardhan-test-nontech',
    });
    const result = await controller.researchCompany('NoTech', 'no-tech.com', []);
    assertEq(result.phase, 'COMPLETE', 'STOP company phase COMPLETE');
    assertEq(result.triage!.decision, 'STOP_LOW_VALUE', 'no-tech stops at triage');
    assert(result.finding === null, 'no-tech: no finding');
    assertEq(result.outreachReady, false, 'no-tech: not outreach ready');
    assertLE(result.triage!.httpRequestsUsed, 10, 'no-tech: within 10 requests');
  }
  console.log('  ✓ Adaptive Escalation (§3)');

  // ── 4. Hypothesis generation ────────────────────────────────────────
  {
    const signals: DeepSignal[] = [
      makeSignal({
        signal_id: 'sig_cand_1',
        type: 'BLOG' as SignalSourceType,
        excerpt: 'scaling our database infrastructure',
        source_url: 'https://company.com/blog',
        signal_strength: 'HIGH' as any,
      }),
      makeSignal({
        signal_id: 'sig_cand_2',
        type: 'TECHNICAL_HIRING' as SignalSourceType,
        excerpt: 'hiring database engineers and SREs',
        source_url: 'https://company.com/jobs',
        signal_strength: 'HIGH' as any,
      }),
    ];
    const evidence = [makeEvidence({ id: 'ev-1', observed_behavior: 'blog about scaling', public_url: 'https://company.com/blog' })];
    const correlations = SignalCorrelationEngine.correlate(signals, evidence);
    const hypotheses = HypothesisEngine.generate(signals, evidence, correlations.groups);

    assertGT(hypotheses.length, 0, 'hypotheses generated from correlated signals');
    if (hypotheses.length > 0) {
      const h = hypotheses[0]!;
      assert(!!h.id, 'hypothesis has id');
      assert(!!h.type, 'hypothesis has type');
      assert(!!h.statement, 'hypothesis has statement');
      assertGT(h.supportingEvidenceIds.length, 0, 'hypothesis has evidence');
      assertGT(h.nextActions.length, 0, 'hypothesis has next actions');
    }

    // Empty
    assertEq(HypothesisEngine.generate([], [], []).length, 0, 'empty hypothesis list');
  }
  console.log('  ✓ HypothesisEngine (§4)');

  // ── 5. Research action ranking ──────────────────────────────────────
  {
    const hypotheses: Hypothesis[] = [{
      id: 'hyp-1',
      type: 'SCALING_PRESSURE',
      statement: 'Company is scaling database',
      supportingEvidenceIds: ['ev-1'],
      signalIds: ['sig-1'],
      nextActions: ['inspect_github', 'inspect_docs', 'inspect_status'],
      estimatedInfoGain: 0.8,
      estimatedCost: 0.3,
    }];

    const actions = ResearchActionSelector.rank(hypotheses, null);
    assertGT(actions.length, 0, 'actions ranked');
    for (let i = 1; i < actions.length; i++) {
      assertLE(actions[i]!.priority, actions[i - 1]!.priority, 'actions sorted by priority desc');
    }

    assertEq(ResearchActionSelector.rank([], null).length, 0, 'no hypotheses → no actions');
  }
  console.log('  ✓ ResearchActionSelector (§5)');

  // ── 7. Noise filtering ────────────────────────────────────────────
  {
    // Single 403
    let a = VardhanNoiseFilter.assess({ type: 'API_ENDPOINT', source_url: 'https://api.example.com/v1', status: 403, excerpt: 'Access denied', evidence_count: 1, reproducible: false });
    assert(a.isNoise, 'single 403 is noise');
    assertNE(a.category, 'REAL_CANDIDATE', 'single 403 not real candidate');

    // Single 429
    a = VardhanNoiseFilter.assess({ type: 'API_ENDPOINT', source_url: 'https://api.example.com/v1', status: 429, excerpt: 'Too many requests', evidence_count: 1, reproducible: false });
    assert(a.isNoise, 'single 429 is noise');

    // Single timeout (504)
    a = VardhanNoiseFilter.assess({ type: 'API_ENDPOINT', source_url: 'https://api.example.com/v1', status: 504, excerpt: 'Gateway timeout', evidence_count: 1, reproducible: false });
    assert(a.isNoise, 'single timeout is noise');

    // Generic framework
    a = VardhanNoiseFilter.assess({ type: 'TECH_STACK', source_url: 'https://example.com', status: 200, excerpt: 'X-Powered-By', content: 'express.js react vue.js', evidence_count: 1, reproducible: false });
    assert(a.isNoise, 'generic framework is noise');

    // Generic CDN
    a = VardhanNoiseFilter.assess({ type: 'TECH_STACK', source_url: 'https://example.com', status: 200, excerpt: 'CDN', content: '', headers: { 'server': 'cloudflare', 'cf-ray': 'xxx' }, evidence_count: 1, reproducible: false });
    assertEq(a.category, 'NORMAL', 'generic CDN rejected');

    // Old article
    a = VardhanNoiseFilter.assess({ type: 'ENGINEERING_ARTICLE', source_url: 'https://example.com/blog/old', status: 200, excerpt: 'old', age_days: 365, evidence_count: 1, reproducible: false });
    assertEq(a.category, 'STALE', 'old article is stale');

    // Generic job
    a = VardhanNoiseFilter.assess({ type: 'TECHNICAL_HIRING', source_url: 'https://example.com/jobs', status: 200, excerpt: 'hiring', age_days: 0, evidence_count: 1, reproducible: false });
    assert(a.isNoise, 'generic job posting is noise');

    // Funding alone
    a = VardhanNoiseFilter.assess({ type: 'FUNDING_ANNOUNCEMENT', source_url: 'https://example.com/news', status: 200, excerpt: 'raised $50M', age_days: 10, evidence_count: 1, reproducible: false });
    assert(a.isNoise, 'funding alone is noise');

    // GitHub existence
    a = VardhanNoiseFilter.assess({ type: 'GITHUB_REPO', source_url: 'https://github.com/company', status: 200, excerpt: 'repo exists', evidence_count: 1, reproducible: false });
    assert(a.isNoise, 'github existence is noise');

    // Single latency
    a = VardhanNoiseFilter.assess({ type: 'LATENCY_OBSERVATION', source_url: 'https://api.example.com', status: 200, excerpt: 'latency sample: 500ms', evidence_count: 1, reproducible: false });
    assert(a.isNoise, 'single latency is noise');

    // Normal API behavior
    a = VardhanNoiseFilter.assess({ type: 'API_ENDPOINT', source_url: 'https://api.example.com', status: 200, excerpt: '{"status":"ok"}', evidence_count: 1, reproducible: false });
    assert(a.isNoise, 'normal API is noise');

    // Repeated observation → REAL_CANDIDATE
    a = VardhanNoiseFilter.assess({ type: 'API_ENDPOINT', source_url: 'https://api.example.com/v1', status: 403, excerpt: 'consistent 403', evidence_count: 3, reproducible: true });
    assertEq(a.category, 'REAL_CANDIDATE', 'repeated observation is real candidate');
  }
  console.log('  ✓ NoiseFilter (§7)');

  // ── 8. Repeated observation escalation ──────────────────────────────
  {
    const single = VardhanNoiseFilter.assess({ type: 'API_ENDPOINT', source_url: 'https://api.example.com', status: 403, excerpt: '403 once', evidence_count: 1, reproducible: false });
    assert(single.isNoise, 'single 403 is noise');

    const repeated = VardhanNoiseFilter.assess({ type: 'API_ENDPOINT', source_url: 'https://api.example.com', status: 403, excerpt: '403 three times', evidence_count: 3, reproducible: true });
    assertEq(repeated.category, 'REAL_CANDIDATE', 'repeated 403 escalates');
  }
  console.log('  ✓ Repeated Observation Escalation (§8)');

  // ── 9. Cross-source correlation ─────────────────────────────────────
  {
    const signals: DeepSignal[] = [
      makeSignal({ signal_id: 'sig_cand_1', type: 'BLOG' as SignalSourceType, excerpt: 'database sharding and scaling strategy', source_url: 'https://company.com/blog', signal_strength: 'HIGH' as any }),
      makeSignal({ signal_id: 'sig_cand_2', type: 'TECHNICAL_HIRING' as SignalSourceType, excerpt: 'hiring distributed systems engineers', source_url: 'https://company.com/jobs', signal_strength: 'HIGH' as any }),
      makeSignal({ signal_id: 'sig_cand_3', type: 'STATUS_PAGE' as SignalSourceType, excerpt: 'database scaling incident reported', source_url: 'https://status.company.com', signal_strength: 'HIGH' as any }),
      makeSignal({ signal_id: 'sig_cand_4', type: 'API_REFERENCE' as SignalSourceType, excerpt: 'database API migration notices', source_url: 'https://api.company.com', signal_strength: 'MEDIUM' as any }),
    ];
    const evidence = signals.map((s, i) => makeEvidence({ id: `ev-${i}`, observed_behavior: s.excerpt, public_url: s.source_url }));

    const result = SignalCorrelationEngine.correlate(signals, evidence);
    assertGT(result.correlationCount, 0, 'correlations found');
    assert(!!result.dominantTheme, 'dominant theme set');
    assert(result.shouldDeepResearch, 'should deep research');
    assertGT(result.groups.length, 0, 'groups formed');

    // Unrelated signals
    const unrelated = SignalCorrelationEngine.correlate([
      makeSignal({ signal_id: 'sig_cand_u1', type: 'BLOG' as SignalSourceType, excerpt: 'company culture', source_url: 'https://c.com/blog' }),
      makeSignal({ signal_id: 'sig_cand_u2', type: 'TECHNICAL_HIRING' as SignalSourceType, excerpt: 'hiring sales reps', source_url: 'https://c.com/jobs' }),
    ], []);
    assert(!unrelated.shouldDeepResearch, 'unrelated signals do not trigger deep research');
  }
  console.log('  ✓ SignalCorrelationEngine (§9)');

  // ── 10. Finding evaluation ──────────────────────────────────────────
  {
    const opp: EngineeringOpportunity = {
      opportunity_id: 'opp-1',
      title: 'Database scaling migration',
      type: 'SCALING_PRESSURE',
      technicalArea: 'database_data',
      signalIds: ['sig-1', 'sig-2'],
      evidenceIds: ['ev-1', 'ev-2', 'ev-3'],
      freshness: { level: 'FRESH', ageDays: 5 },
      reasons: ['Multi-source scaling signals'],
      whyNow: ['Recent hiring + blog + status page'],
      confidence: 'HIGH',
      nextAction: 'Verify database API behavior',
      unknowns: ['Internal architecture'],
    };

    const out = OpportunityDetector.evaluateFinding(opp, 3, 3);
    assertEq(out.classification, 'ENGINEERING_OPPORTUNITY', 'strong opportunity → ENGINEERING_OPPORTUNITY');

    // Low value
    const opp2: EngineeringOpportunity = {
      opportunity_id: 'opp-2', title: 'Single weak signal', type: 'RECENT_ENGINEERING',
      technicalArea: 'general', signalIds: ['sig-1'], evidenceIds: [],
      freshness: { level: 'STALE', ageDays: 200 }, reasons: ['single'], whyNow: [],
      confidence: 'LOW', nextAction: 'Monitor', unknowns: ['everything'],
    };
    assertEq(OpportunityDetector.evaluateFinding(opp2, 0, 0).classification, 'LOW_VALUE', 'low conf no corr → LOW_VALUE');

    // Moderate → RESEARCH_MORE
    const opp3: EngineeringOpportunity = {
      opportunity_id: 'opp-3', title: 'Possible scaling', type: 'SCALING_PRESSURE',
      technicalArea: 'scalability', signalIds: ['sig-1'], evidenceIds: ['ev-1'],
      freshness: { level: 'FRESH', ageDays: 5 }, reasons: ['scaling'], whyNow: ['recent'],
      confidence: 'MEDIUM', nextAction: 'Deepen', unknowns: ['details'],
    };
    assertEq(OpportunityDetector.evaluateFinding(opp3, 1, 0).classification, 'RESEARCH_MORE', 'moderate → RESEARCH_MORE');
  }
  console.log('  ✓ Finding Evaluation (§10)');

  // ── 11. Evidence provenance preservation ─────────────────────────────
  {
    const validOrigins = [
      'GROWJO_SOURCE', 'OFFICIAL_COMPANY_SOURCE', 'PUBLIC_PROFESSIONAL_SOURCE',
      'REAL_PUBLIC_OBSERVATION', 'DOCUMENTED_FACT', 'VARDHAN_INFERENCE',
    ];

    const ledger = new EvidenceLedger('/tmp/vardhan-test-provenance');
    const evidence = makeEvidence({ id: 'ev-test', observed_behavior: 'test observation', public_url: 'https://example.com' });
    for (const origin of validOrigins) {
      ledger.record('test-co.com', 'run-1', evidence, 'OBSERVATION', origin);
    }

    const ce = ledger.getCompanyEvidence('test-co.com');
    assertEq(ce.evidence.length, 6, 'ledger stores 6 provenance records');
    const tags = new Set(ce.evidence.map(e => e.provenance_tag));
    for (const v of validOrigins) {
      assert(tags.has(v), `provenance tag preserved: ${v}`);
    }

    // Mock evidence not converted to REAL
    const mockLedger = new EvidenceLedger('/tmp/vardhan-test-mock-ev');
    const mockEv = makeEvidence({ id: 'ev-mock', observed_behavior: 'mock', public_url: 'https://example.com', evidence_origin: 'MOCK_TEST' as any });
    const record = mockLedger.record('mock-co.com', 'run-1', mockEv, 'OBSERVATION', 'MOCK_TEST');
    assertEq(record.evidence_origin, 'MOCK_TEST', 'mock origin preserved');
    assertNE(record.provenance, 'REAL_PUBLIC_OBSERVATION', 'mock not converted to REAL');
  }
  console.log('  ✓ Evidence Provenance (§11)');

  // ── 12. Freshness / change detection ─────────────────────────────────
  {
    // First run with null → empty
    assertEq(OriginalChangeDetector.detect(null, null).length, 0, 'no prev → no changes');

    // Freshness ChangeDetector (in freshness/ dir)
    assertEq(FreshnessChangeDetector.isLightweightScanNeeded(null), false, 'first run = not lightweight');

    const signals: DeepSignal[] = [makeSignal({ signal_id: 'sig-1', excerpt: 'test', source_url: 'https://test.com' })];
    const evidence = [makeEvidence({ id: 'ev-1', observed_behavior: 'obs', public_url: 'https://test.com' })];

    // Freshness snapshot — sources is a Map
    const state = FreshnessChangeDetector.snapshot('test.com', 'TestCo', evidence, signals, ['finding-1'], ['Owner'], [], []);
    assert(state.sources.size > 0, 'freshness snapshot captures sources');
    assert(state.signals.size > 0, 'freshness snapshot captures signals');

    // Lightweight scan check
    assert(FreshnessChangeDetector.isLightweightScanNeeded(state, 48), 'recent state = lightweight scan');

    // Original ChangeDetector.compare for content change detection
    const changes = FreshnessChangeDetector.compare(state, state);
    assertEq(changes.length, 0, 'identical state → no changes');
  }
  console.log('  ✓ Freshness & Change Detection (§12)');

  // ── 13. Research resume (state persistence) ──────────────────────────
  {
    const sp = new StatePersistence('/tmp/vardhan-test-resume');
    const state: PersistedResearchState = {
      company: 'ResumeTest', domain: 'resume-test.com',
      last_researched_at: new Date().toISOString(), stage_reached: 3, last_error: null,
      state_snapshot: {
        company: 'ResumeTest', domain: 'resume-test.com',
        sources: new Set<string>(), signals: [], findings: ['finding-1'],
        owners: ['Owner'], people: [], contacts: [], activities: [], evidence_ids: ['ev-1'],
        retrieved_at: new Date().toISOString(),
      },
      search_cache: [],
    };
    sp.save('resume-test.com', state);
    const loaded = sp.load('resume-test.com');
    assert(loaded !== null, 'state loaded');
    assertEq(loaded!.stage_reached, 3, 'stage_reached persisted');
    assert(loaded!.state_snapshot.findings.includes('finding-1'), 'findings persisted');

    assertEq(sp.load('does-not-exist.com'), null, 'null for non-existent');

    sp.save('test-list.com', state);
    assertGT(sp.listAll().length, 0, 'listAll returns states');
  }
  console.log('  ✓ Research Resume (§13)');

  // ── 14. Acquisition fallback ─────────────────────────────────────────
  {
    const fetcher = makeFakeFetcher({
      'https://fail-all.com': { status: 500, html: '' },
      'https://fail-all.com/robots.txt': { status: 500, html: '' },
    });
    const controller = new VardhanResearchController({
      fetcher, searchProvider: makeNullSearchProvider(), modelGateway: makeFakeModelGateway(),
      maxTriageRuntimeMs: 5000, artifactsDir: '/tmp/vardhan-test-fail',
    });
    const result = await controller.researchCompany('FailCo', 'fail-all.com', []);
    assert(result !== null, 'controller returns result even on failure');
    assertEq(result.phase, 'COMPLETE', 'phase COMPLETE on failure');
    assert(!!result.triage, 'triage result present');
  }
  console.log('  ✓ Acquisition Fallback (§14)');

  // ── 15. Model evidence binding ───────────────────────────────────────
  {
    // Model evidence binding
    const model = makeFakeModelGateway();
    assert(typeof (model as any).generate === 'function', 'model has generate()');
    assert(typeof model.addProvider === 'function', 'model has addProvider()');
    const resp = await (model as any).generate({ prompt: 'test', capability: 'page_understanding' });
    const parsed = JSON.parse(resp.text);
    assert(!!parsed.classification, 'model returns classification');
    assert(!!parsed.confidence, 'model returns confidence');
    assert(!!parsed.explanation, 'model returns explanation');
  }
  console.log('  ✓ Model Evidence Binding (§15)');

  // ── 16. Adversarial finding QA (FindingQA) ───────────────────────────
  {
    // Pass — well evidenced with owner
    const signals: DeepSignal[] = [makeSignal({ signal_id: 'sig-1', excerpt: 'scaling', source_url: 'https://c.com/blog', signal_strength: 'HIGH' as any })];
    const evidence: Evidence[] = [
      makeEvidence({ id: 'ev-1', observed_behavior: 'API returns 403', public_url: 'https://api.c.com/v1', evidence_origin: 'REAL_PUBLIC_OBSERVATION' as any, reproductions: 3, repeatable: true }),
      makeEvidence({ id: 'ev-2', observed_behavior: 'Blog mentions scaling', public_url: 'https://c.com/blog', evidence_origin: 'REAL_PUBLIC_OBSERVATION' as any, reproductions: 1, repeatable: true }),
    ];
    const ctx1: QAContext = {
      finding: { findingId: 'f-1', title: 'Test', type: 'ENGINEERING_OPPORTUNITY', status: 'ACTIVE', evidenceIds: ['ev-1', 'ev-2'], signalIds: ['sig-1'], sourceIds: [], createdAt: new Date().toISOString(), lastVerifiedAt: null, corroboratingSignalIds: [], confidence: 0.8 },
      evidence, signals,
      owner: { name: 'Jane Doe', confidence: 'HIGH' },
      contacts: [{ value: 'jane@company.com', confidence: 'VERIFIED_PUBLIC' as any }],
    };
    const qa1 = FindingQA.validate(ctx1);
    assert(qa1.pass, 'QA passes for well-evidenced finding');
    assert(qa1.outreachReady, 'outreachReady true for well-evidenced finding');

    // Fail — no owner
    const ctx2: QAContext = { ...ctx1, owner: null, contacts: [] };
    const qa2 = FindingQA.validate(ctx2);
    assert(!qa2.pass, 'QA fails without owner');
    assert(!qa2.outreachReady, 'outreachReady false without owner');

    // Fail — inference-only evidence
    const infEv: Evidence[] = [
      makeEvidence({ id: 'e1', observed_behavior: 'inferred', public_url: 'https://c.com', evidence_origin: 'VARDHAN_INFERENCE' as any, reproductions: 0, repeatable: false }),
      makeEvidence({ id: 'e2', observed_behavior: 'inferred2', public_url: 'https://c.com', evidence_origin: 'VARDHAN_INFERENCE' as any, reproductions: 0, repeatable: false }),
    ];
    const ctx3: QAContext = { ...ctx1, evidence: infEv };
    const qa3 = FindingQA.validate(ctx3);
    const obsCheck = qa3.checks.find(c => c.name === 'actually_observed');
    assert(!!obsCheck, 'QA has actually_observed check');
    assert(!obsCheck!.passed, 'actually_observed fails for inference-only evidence');
  }
  console.log('  ✓ FindingQA (§16)');

  // ── 17. FindingGraph traceability ────────────────────────────────────
  {
    const graph = new FindingGraph();
    const findingId = 'finding-1';
    graph.addFinding({
      findingId, title: 'Test Finding', type: 'ENGINEERING_OPPORTUNITY',
      status: 'ACTIVE', evidenceIds: ['ev-1'], signalIds: ['sig-1'], sourceIds: ['https://c.com/blog'],
      createdAt: new Date().toISOString(), lastVerifiedAt: null, corroboratingSignalIds: [], confidence: 0.8,
    });
    graph.addEdge('finding-1', 'sig-1', 'HAS_SIGNAL', ['ev-1'], 1.0);
    graph.addEdge('sig-1', 'ev-1', 'HAS_EVIDENCE', ['ev-1'], 1.0);
    graph.addEdge('ev-1', 'https://c.com/blog', 'SOURCE_URL', ['ev-1'], 1.0);

    const chain = graph.getEvidenceChain('finding-1');
    assertGT(chain.length, 1, 'evidence chain built');
    assert(chain.includes('ev-1'), 'chain includes evidence ID');

    const backward = graph.traceBackward('finding-1');
    assertGT(backward.length, 0, 'traceBackward finds edges');
    assert(backward.some(e => e.toId === 'sig-1'), 'backward trace finds signal');

    const json = graph.toJSON();
    assertEq(json.nodes.length, 1, 'toJSON has 1 node');
    assertEq(json.edges.length, 3, 'toJSON has 3 edges');
  }
  console.log('  ✓ FindingGraph (§17)');

  // ── 18. Owner gate ────────────────────────────────────────────────────
  {
    const fetcher = makeFakeFetcher({
      'https://no-owner-test.com': {
        status: 200,
        html: `<html><body><a href="/api">API</a><a href="/docs">Docs</a><a href="/status">Status</a><a href="/blog">Blog</a></body></html>`,
      },
      'https://no-owner-test.com/robots.txt': { status: 200, html: '' },
      'https://no-owner-test.com/api': { status: 200, html: '{"api":"ok"}' },
      'https://no-owner-test.com/status': { status: 200, html: '<html>Status page</html>' },
      'https://no-owner-test.com/blog': { status: 200, html: '<html>Blog</html>' },
    });
    const controller = new VardhanResearchController({
      fetcher, searchProvider: makeNullSearchProvider(), modelGateway: makeFakeModelGateway(),
      maxTriageRuntimeMs: 3000, maxDeepRuntimeMs: 5000, artifactsDir: '/tmp/vardhan-test-owner',
    });
    const result = await controller.researchCompany('NoOwner', 'no-owner-test.com', []);
    // Outreach gate: if classification is OPPORTUNITY or VERIFIED, owner MUST exist
    if (result.finding && (result.finding.classification === 'ENGINEERING_OPPORTUNITY' || result.finding.classification === 'VERIFIED_FINDING')) {
      assert(result.owner !== null, 'ENGINEERING_OPPORTUNITY requires owner');
    }
    if (result.owner === null) {
      assertEq(result.outreachReady, false, 'no owner → not outreach ready');
    }
  }
  console.log('  ✓ Owner Gate (§18)');

  // ── 19. Outreach gate ─────────────────────────────────────────────────
  {
    const fetcher = makeFakeFetcher({
      'https://outreach-test.com': {
        status: 200,
        html: '<html><body><a href="/api">API</a><a href="/docs">Docs</a></body></html>',
      },
      'https://outreach-test.com/robots.txt': { status: 200, html: '' },
    });
    const controller = new VardhanResearchController({
      fetcher, searchProvider: makeNullSearchProvider(), modelGateway: makeFakeModelGateway(),
      maxTriageRuntimeMs: 3000, maxDeepRuntimeMs: 3000, artifactsDir: '/tmp/vardhan-test-outreach',
    });
    const result = await controller.researchCompany('OutreachTest', 'outreach-test.com', []);

    if (result.finding) {
      assert(['LOW_VALUE', 'RESEARCH_MORE', 'ENGINEERING_OPPORTUNITY', 'VERIFIED_FINDING'].includes(result.finding.classification), 'valid finding classification');
    }
    // Outreach gate logic check
    if (result.outreachReady) {
      assert(result.owner !== null, 'outreach ready → owner exists');
      assertGT(result.finding!.evidenceIds.length, 0, 'outreach ready → evidence exists');
    }
  }
  console.log('  ✓ Outreach Gate (§19)');

  // ── 20. End-to-end controller integration ─────────────────────────────
  {
    const fetcher = makeFakeFetcher({
      'https://e2e-test.com': {
        status: 200,
        html: `<html><body><a href="/api">API</a><a href="/docs">Docs</a><a href="/status">Status</a><a href="/blog">Blog</a><a href="/jobs">Jobs</a></body></html>`,
      },
      'https://e2e-test.com/robots.txt': { status: 200, html: '' },
      'https://e2e-test.com/sitemap.xml': { status: 200, html: '<urlset></urlset>' },
    });
    const controller = new VardhanResearchController({
      fetcher, searchProvider: makeNullSearchProvider(), modelGateway: makeFakeModelGateway(),
      maxTriageRuntimeMs: 3000, maxDeepRuntimeMs: 10000, artifactsDir: '/tmp/vardhan-test-e2e',
    });
    const result = await controller.researchCompany('E2ECorp', 'e2e-test.com', []);

    assertEq(result.company, 'E2ECorp', 'report company');
    assertEq(result.domain, 'e2e-test.com', 'report domain');
    assertEq(result.phase, 'COMPLETE', 'report phase COMPLETE');
    assert(!!result.runId, 'report has runId');
    assert(!!result.triage, 'report has triage');
    assertEq(result.triage!.decision, 'PASS_FOR_DEEP_RESEARCH', 'e2e triage passes');
    assert(!!result.finding, 'report has finding');
    assert(!!result.finding!.classification, 'finding has classification');
    assert(!!result.finding!.explanation, 'finding has explanation');
    assertEq(result.failures.length, 0, 'no failures in happy path');
    assertGT(result.auditTrail.length, 0, 'audit trail populated');
  }
  console.log('  ✓ End-to-End Controller (§20)');

  // ── 21. SystemManager orchestration ────────────────────────────────────
  {
    const fetcher = makeFakeFetcher({
      'https://sm-e2e.com': {
        status: 200,
        html: `<html><body><a href="/api">API</a><a href="/docs">Docs</a><a href="/status">Status</a><a href="/blog">Blog</a><a href="/jobs">Jobs</a></body></html>`,
      },
      'https://sm-e2e.com/robots.txt': { status: 200, html: '' },
      'https://sm-e2e.com/sitemap.xml': { status: 200, html: '<urlset></urlset>' },
    });

    const mgr = new VardhanSystemManager({
      fetcher, searchProvider: makeNullSearchProvider(), modelGateway: makeFakeModelGateway(),
      artifactsDir: '/tmp/vardhan-test-sysmgr', maxTriageRuntimeMs: 5000, maxDeepRuntimeMs: 10000,
      output: { write: () => {} },
    });

    const report = await mgr.researchCompany('SME2ECorp', 'sm-e2e.com', []);
    assertEq(report.company, 'SME2ECorp', 'report company');
    assertEq(report.domain, 'sm-e2e.com', 'report domain');
    assert(!!report.state, 'report has state');
    assertEq(report.phase, 'COMPLETE', 'report phase');
    assertGT(report.auditTrail.length, 0, 'audit trail populated');
    assert(report.triage !== null, 'triage present');

    // Queue summary (no import needed for path/os)
    const pathMod = await import('path');
    const fsMod = await import('fs');
    const osMod = await import('os');
    const queuePath = pathMod.join(osMod.tmpdir(), `vardhan-test-q-${Date.now()}.jsonl`);
    try { fsMod.unlinkSync(queuePath); } catch { /* ok */ }
    const mgr2 = new VardhanSystemManager({
      artifactsDir: '/tmp/vardhan-test-sysmgr',
      queuePath: queuePath,
      output: { write: () => {} },
    });
    const summary = mgr2.getQueueSummary();
    assertEq(summary.total, 0, 'empty queue total 0');
  }
  console.log('  ✓ SystemManager Orchestration (§21)');

  // ── 22. No fabrication check ─────────────────────────────────────────
  {
    const fetcher = makeFakeFetcher({
      'https://no-fake.com': { status: 200, html: '<html><body><a href="/api">API</a><a href="/docs">Docs</a></body></html>' },
      'https://no-fake.com/robots.txt': { status: 200, html: '' },
    });
    const controller = new VardhanResearchController({
      fetcher, searchProvider: makeNullSearchProvider(), modelGateway: makeFakeModelGateway(),
      maxTriageRuntimeMs: 3000, artifactsDir: '/tmp/vardhan-test-nofake',
    });
    const result = await controller.researchCompany('NoFake', 'no-fake.com', []);

    if (result.finding && result.finding.evidenceIds.length > 0) {
      const ledger = new EvidenceLedger('/tmp/vardhan-test-nofake/artifacts/intelligence/evidence');
      const ce = ledger.getCompanyEvidence('no-fake.com');
      for (const ev of ce.evidence) {
        assert(!ev.public_url.includes('fake-url'), 'no fabricated URLs: ' + ev.public_url);
        assert(!ev.public_url.includes('fabricated'), 'no fabricated URLs: ' + ev.public_url);
        assertNE(ev.evidence_origin, 'MOCK_TEST', 'no mock evidence in finding path');
      }
    }
  }
  console.log('  ✓ No Fabrication (§22)');

  // ── Summary ────────────────────────────────────────────────────────────
  console.log(`\n§22 Results: ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log('Failures:');
    for (const f of failures) console.log('  - ' + f);
    expect(fail).toBe(0);
  }
  console.log('✓ All §22 tests passed.\n');
}

runAll().catch(e => { console.error(e); expect(fail).toBe(0); });

  });
});