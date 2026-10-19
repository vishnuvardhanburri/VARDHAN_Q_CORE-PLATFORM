import { describe, test, expect } from 'vitest';
import type { HttpFetcher } from '../src/server/IntelligenceCase.ts';
import type { SearchOptions, SearchProvider, SearchProviderResponse } from '../src/server/WebSearchProvider.ts';
import {
  CompanyResearchPipeline,
  canonicalizeUrl,
  planQueries,
  type CompanyResearchResult,
} from '../src/server/company/CompanyResearchPipeline.ts';

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
        results: sliced.map((h) => ({ url: h.url, title: h.title, snippet: h.snippet })),
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
  return async (
    _url: string,
    _init: { method: string; headers: Record<string, string>; signal: AbortSignal },
  ): Promise<Response> => {
    const hit = routes[_url];
    if (hit !== undefined) {
      return new Response(hit.html, { status: hit.status, headers: { 'content-type': 'text/html' } });
    }
    return new Response('<html><body>not found</body></html>', {
      status: 404,
      headers: { 'content-type': 'text/html' },
    });
  };
}

describe('CompanyResearchPipeline (deterministic, no network)', () => {
  test('(g) canonicalizeUrl unit cases', () => {
    // Lowercase host + strip tracking params + trailing slash.
    expect(canonicalizeUrl('https://Example.COM/Quantum/?utm_source=x&gclid=abc&fbclid=z&id=7')).toBe(
      'https://example.com/Quantum?id=7',
    );
    // Default port dropped, fragment dropped.
    expect(canonicalizeUrl('https://example.com:443/a/#frag')).toBe('https://example.com/a');
    // Root path collapses to bare origin.
    expect(canonicalizeUrl('https://example.com/')).toBe('https://example.com');
    // Non-tracking params preserved and sorted.
    expect(canonicalizeUrl('https://example.com/p?b=2&a=1')).toBe('https://example.com/p?a=1&b=2');
    // Invalid input passes through untouched, never throws.
    expect(canonicalizeUrl('not a url')).toBe('not a url');
  });

  test('(a) dedup: utm variants collapse to 1 source, duplicateRate > 0', async () => {
    const hits: FakeHit[] = [
      { url: 'https://acme.com/quantum?utm_source=ddg', title: 'Acme Quantum Strategy Summit', snippet: 'post-quantum roadmap' },
      { url: 'https://acme.com/quantum?gclid=xyz', title: 'Acme Quantum Strategy Summit', snippet: 'post-quantum roadmap' },
      { url: 'https://acme.com/quantum/', title: 'Acme Quantum Strategy Summit', snippet: 'post-quantum roadmap' },
    ];
    const fetcher = fakeFetcher({
      'https://acme.com/quantum': { status: 200, html: '<html><body>Acme post-quantum crypto-agility programme</body></html>' },
    });
    const pipeline = new CompanyResearchPipeline(fakeSearch(hits), fetcher);
    const result: CompanyResearchResult = await pipeline.run('Acme Corp', 'acme.com', { maxSources: 12, verifyTop: 6 });
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].canonicalUrl).toBe('https://acme.com/quantum');
    expect(result.stats.sourcesAttempted).toBeGreaterThan(1);
    expect(result.stats.duplicateRate).toBeGreaterThan(0);
  });

  test('(b) unverified snippet: search-only hit beyond verifyTop → verified=false + limitation', async () => {
    const hits: FakeHit[] = [
      { url: 'https://acme.com/a', title: 'Acme Security Strategy Overview', snippet: 'security programme' },
      { url: 'https://acme.com/b', title: 'Acme Audit Attestation Report', snippet: 'audit assurance' },
    ];
    const fetcher = fakeFetcher({
      'https://acme.com/a': { status: 200, html: '<html><body>security strategy content</body></html>' },
    });
    const pipeline = new CompanyResearchPipeline(fakeSearch(hits), fetcher);
    const result: CompanyResearchResult = await pipeline.run('Acme Corp', 'acme.com', { maxSources: 2, verifyTop: 1 });
    expect(result.sources).toHaveLength(2);
    const unfetched = result.sources.find((s) => s.canonicalUrl === 'https://acme.com/b');
    expect(unfetched).toBeDefined();
    const sig = result.signals.find((s) => s.sourceUrls.includes('https://acme.com/b'));
    expect(sig).toBeDefined();
    expect(sig?.verified).toBe(false);
    expect(result.limitations.length).toBeGreaterThan(0);
  });

  test('(c) corroboration: shared title keywords link two sources', async () => {
    const hits: FakeHit[] = [
      {
        url: 'https://acme.com/quantum-summit',
        title: 'Acme Quantum Security Summit Announces Post-Quantum Roadmap',
        snippet: 'post-quantum cryptography migration plan detailed at summit',
      },
      {
        url: 'https://news.example.org/acme-quantum',
        title: 'Acme Quantum Security Summit Covers Post-Quantum Roadmap',
        snippet: 'coverage of Acme summit on post-quantum cryptography roadmap',
      },
    ];
    const fetcher = fakeFetcher({
      'https://acme.com/quantum-summit': { status: 200, html: '<html><body>post-quantum cryptography migration roadmap summit</body></html>' },
      'https://news.example.org/acme-quantum': { status: 200, html: '<html><body>coverage summit post-quantum cryptography roadmap migration</body></html>' },
    });
    const pipeline = new CompanyResearchPipeline(fakeSearch(hits), fetcher);
    const result: CompanyResearchResult = await pipeline.run('Acme Corp', 'acme.com', { maxSources: 2, verifyTop: 2 });
    expect(result.sources).toHaveLength(2);
    expect(result.sources.every((s) => s.corroboratedBy.length > 0)).toBe(true);
  });

  test('(d) date separation: publishedDate vs retrievedAt are distinct fields', async () => {
    const hits: FakeHit[] = [
      { url: 'https://acme.com/attestation', title: 'Acme Audit Attestation Statement', snippet: 'annual audit attestation' },
    ];
    const fetcher = fakeFetcher({
      'https://acme.com/attestation': {
        status: 200,
        html: '<html><head><meta property="article:published_time" content="2024-03-15T00:00:00Z"></head><body>audit attestation statement</body></html>',
      },
    });
    const pipeline = new CompanyResearchPipeline(fakeSearch(hits), fetcher);
    const result: CompanyResearchResult = await pipeline.run('Acme Corp', 'acme.com', { maxSources: 1, verifyTop: 1 });
    const src = result.sources[0];
    expect(src.publishedDate).toBeDefined();
    expect(src.retrievedAt).toBeDefined();
    expect(src.publishedDate).not.toBe(src.retrievedAt);
    expect(src.publishedDate as string).toContain('2024');
  });

  test('(e) contradictions: launch vs discontinue clash recorded', async () => {
    const hits: FakeHit[] = [
      {
        url: 'https://acme.com/custody-launch',
        title: 'Acme Custody Platform Launches Institutional Service',
        snippet: 'Acme launches institutional digital asset custody platform service',
      },
      {
        url: 'https://news.example.org/acme-custody-exit',
        title: 'Acme Custody Platform Discontinues Institutional Service',
        snippet: 'Acme discontinues institutional digital asset custody platform service',
      },
    ];
    const fetcher = fakeFetcher({
      'https://acme.com/custody-launch': { status: 200, html: '<html><body>Acme launches institutional custody platform service</body></html>' },
      'https://news.example.org/acme-custody-exit': { status: 200, html: '<html><body>Acme discontinues institutional custody platform service</body></html>' },
    });
    const pipeline = new CompanyResearchPipeline(fakeSearch(hits), fetcher);
    const result: CompanyResearchResult = await pipeline.run('Acme Corp', 'acme.com', { maxSources: 2, verifyTop: 2 });
    expect(result.contradictions.length).toBeGreaterThan(0);
  });

  test('(f) empty search → 0 sources, limitations non-empty, no throw', async () => {
    const pipeline = new CompanyResearchPipeline(emptySearch(), fakeFetcher({}));
    let result: CompanyResearchResult | undefined;
    await expect((async () => {
      result = await pipeline.run('Acme Corp', 'acme.com');
    })()).resolves.toBeUndefined();
    expect(result?.sources).toHaveLength(0);
    expect(result?.limitations.length).toBeGreaterThan(0);
    expect(result?.stats.sourcesRetrieved).toBe(0);
  });

  test('planQueries returns 8 focused queries mentioning company', () => {
    const queries: string[] = planQueries('Acme Corp', 'acme.com');
    expect(queries).toHaveLength(8);
    expect(queries.every((q) => q.includes('Acme Corp'))).toBe(true);
  });
});
