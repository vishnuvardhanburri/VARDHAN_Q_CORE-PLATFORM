/**
 * VARDHAN — live opportunity sweep tests (STAGE 7 part B).
 * Deterministic, no network: a fake search provider plus a fake fetcher
 * drive CompanyResearchPipeline, and the pure per-company
 * `briefForCompany(pipelineResult, company, domain)` helper from
 * src/server/commercial/SweepBriefing.ts is unit-tested directly
 * (scripts/ can't be easily imported — the script stays a thin wrapper).
 * Run with:
 *   npx vitest run tests/liveOpportunitySweep.test.ts
 */
import { describe, test, expect } from 'vitest';
import type { HttpFetcher } from '../src/server/IntelligenceCase.ts';
import type {
  SearchOptions,
  SearchProvider,
  SearchProviderResponse,
} from '../src/server/WebSearchProvider.ts';
import {
  CompanyResearchPipeline,
  type CompanyResearchResult,
} from '../src/server/company/CompanyResearchPipeline.ts';
import {
  briefForCompany,
  dropBrief,
  rankBriefs,
  sweepCompanies,
  type SweepBrief,
  type SweepTarget,
} from '../src/server/commercial/SweepBriefing.ts';

/** Fixed "now" so freshness math stays deterministic. */
const NOW_ISO = '2026-10-17T00:00:00.000Z';

interface FakeHit {
  url: string;
  title: string;
  snippet: string;
}

/** Deterministic fake search: returns canned hits for every query, no network. */
function fakeSearch(hits: FakeHit[]): SearchProvider {
  return {
    name: 'FakeSearchProvider',
    available: true,
    async search(_query: string, options: SearchOptions = {}): Promise<SearchProviderResponse> {
      const cap = options.maxResults ?? hits.length;
      const sliced = hits.slice(0, Math.max(0, Math.floor(cap)));
      return {
        available: true,
        providerName: 'FakeSearchProvider',
        results: sliced.map((h: FakeHit) => ({ url: h.url, title: h.title, snippet: h.snippet })),
      };
    },
  };
}

function emptySearch(): SearchProvider {
  return {
    name: 'EmptySearchProvider',
    available: true,
    async search(): Promise<SearchProviderResponse> {
      return { available: true, providerName: 'EmptySearchProvider', results: [] };
    },
  };
}

/** Deterministic fake fetcher: route URL → { status, html }. No network. */
function fakeFetcher(routes: Record<string, { status: number; html: string }>): HttpFetcher {
  return async (url: string): Promise<Response> => {
    const hit: { status: number; html: string } | undefined = routes[url];
    if (hit !== undefined) {
      return new Response(hit.html, { status: hit.status, headers: { 'content-type': 'text/html' } });
    }
    return new Response('<html><body>not found</body></html>', {
      status: 404,
      headers: { 'content-type': 'text/html' },
    });
  };
}

function goHits(): FakeHit[] {
  return [
    {
      url: 'https://testbank.com/news/payments-programme',
      title: 'TestBank announces payments modernisation programme',
      snippet: 'TestBank payments modernisation programme review',
    },
    {
      url: 'https://news.example.org/testbank-payments',
      title: 'TestBank payments modernisation programme gains pace',
      snippet: 'coverage of TestBank payments modernisation programme',
    },
  ];
}

function goRoutes(): Record<string, { status: number; html: string }> {
  return {
    'https://testbank.com/news/payments-programme': {
      status: 200,
      html:
        '<html><head><meta property="article:published_time" content="2026-09-01T00:00:00.000Z">' +
        '</head><body>TestBank post-quantum cryptography migration roadmap summit programme payments modernisation review</body></html>',
    },
    'https://news.example.org/testbank-payments': {
      status: 200,
      html:
        '<html><head><meta property="article:published_time" content="2026-09-05T00:00:00.000Z">' +
        '</head><body>Coverage TestBank post-quantum cryptography migration roadmap summit programme payments review</body></html>',
    },
  };
}

/** End-to-end without network: fake research → pure brief. */
async function goResult(): Promise<CompanyResearchResult> {
  const pipeline = new CompanyResearchPipeline(fakeSearch(goHits()), fakeFetcher(goRoutes()));
  return pipeline.run('TestBank', 'testbank.com', { maxSources: 8 });
}

async function emptyResult(): Promise<CompanyResearchResult> {
  const pipeline = new CompanyResearchPipeline(
    emptySearch(),
    fakeFetcher({}),
  );
  return pipeline.run('Ghost Bank', 'ghost.example', { maxSources: 8 });
}

describe('live opportunity sweep (STAGE 7 part B)', () => {
  test('(a) GO path: corroborated fresh source → verdict GO + draft non-null', async () => {
    const result: CompanyResearchResult = await goResult();
    const brief: SweepBrief = briefForCompany(result, 'TestBank', 'testbank.com', NOW_ISO);
    expect(brief.verdict).toBe('GO');
    expect(brief.whyNow).not.toBeNull();
    expect(brief.whyNow?.sourceUrl.startsWith('https://')).toBe(true);
    expect(brief.publicFacts.length).toBeGreaterThan(0);
    expect(brief.draft).not.toBeNull();
    expect(brief.draftBlockedReason).toBeNull();
    if (brief.draft === null) return;
    expect(brief.draft.wordCount).toBeGreaterThanOrEqual(60);
    expect(brief.draft.wordCount).toBeLessThanOrEqual(100);
    expect(brief.draft.body).toContain('Would it be worth a 10-minute review?');
  });

  test('(b) empty search → HOLD/DROP brief, draft null (honest empty)', async () => {
    const result: CompanyResearchResult = await emptyResult();
    const brief: SweepBrief = briefForCompany(result, 'Ghost Bank', 'ghost.example', NOW_ISO);
    expect(brief.verdict === 'HOLD' || brief.verdict === 'DROP').toBe(true);
    expect(brief.verdict).not.toBe('GO');
    expect(brief.whyNow).toBeNull();
    expect(brief.draft).toBeNull();
    expect(brief.draftBlockedReason).not.toBeNull();
    expect(brief.limitations.length).toBeGreaterThan(0);
  });

  test('(c) ranking sort GO-first, then score desc', async () => {
    const fresh: CompanyResearchResult = await goResult();
    const goBrief: SweepBrief = briefForCompany(fresh, 'TestBank', 'testbank.com', NOW_ISO);
    expect(goBrief.verdict).toBe('GO');
    // Same evidence scored later: staler trigger → lower freshness score, still GO.
    const staleGo: SweepBrief = briefForCompany(fresh, 'TestBank', 'testbank.com', '2026-12-01T00:00:00.000Z');
    expect(staleGo.verdict).toBe('GO');
    expect(goBrief.score).toBeGreaterThan(staleGo.score);
    const holdBrief: SweepBrief = briefForCompany(await emptyResult(), 'Ghost Bank', 'ghost.example', NOW_ISO);
    const drop: SweepBrief = dropBrief('Boom Bank', 'boom.example', 'fixture failure');
    const ranked: SweepBrief[] = rankBriefs([drop, holdBrief, staleGo, goBrief]);
    expect(ranked.map((b: SweepBrief) => b.verdict)).toEqual(['GO', 'GO', holdBrief.verdict, 'DROP']);
    expect(ranked[0].score).toBeGreaterThanOrEqual(ranked[1].score);
    expect(ranked[0].company).toBe('TestBank');
  });

  test('(d) per-company failure isolation (one company throws → others still briefed)', async () => {
    const good: CompanyResearchResult = await goResult();
    const targets: SweepTarget[] = [
      { company: 'Good One', domain: 'good-one.example' },
      { company: 'Boom Bank', domain: 'boom.example' },
      { company: 'Good Two', domain: 'good-two.example' },
    ];
    const briefs: SweepBrief[] = await sweepCompanies(
      targets,
      async (company: string, _domain: string): Promise<CompanyResearchResult> => {
        if (company === 'Boom Bank') throw new Error('kablam');
        return good;
      },
      NOW_ISO,
    );
    expect(briefs).toHaveLength(3);
    expect(briefs[0].verdict).toBe('GO');
    expect(briefs[1].verdict).toBe('DROP');
    expect(briefs[1].limitations.join(' ')).toContain('kablam');
    expect(briefs[2].verdict).toBe('GO');
    expect(briefs[2].draft).not.toBeNull();
  });
});
