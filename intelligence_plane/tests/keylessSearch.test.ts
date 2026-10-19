import { describe, test, expect } from 'vitest';
import type { HttpFetcher } from '../src/server/IntelligenceCase.ts';
import { KeylessSearchProvider } from '../src/server/providers/KeylessSearchProvider.ts';

type Route = { status: number; body: string };

function fakeFetcher(routes: Record<string, Route>): HttpFetcher {
  return async (
    url: string,
    _init: { method: string; headers: Record<string, string>; signal: AbortSignal },
  ): Promise<Response> => {
    const hit = routes[url];
    if (hit) {
      return new Response(hit.body, {
        status: hit.status,
        headers: { 'content-type': 'text/html' },
      });
    }
    return new Response('', { status: 404, headers: { 'content-type': 'text/html' } });
  };
}

function ddgUrl(query: string): string {
  return `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
}

const VALID_HTML = [
  '<html><body><div>duckduckgo results</div>',
  '<div class="results_links">',
  '<div class="result"><h2>',
  '<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.hsbc.com%2Fquantum&amp;rut=abc123">HSBC <b>Quantum</b> Computing</a>',
  '</h2><div class="result__snippet">HSBC partners with IBM on <b>quantum</b> computing research.</div></div>',
  '<div class="result"><h2>',
  '<a rel="nofollow" class="result__a" href="https://www.ibm.com/quantum">IBM Quantum Platform</a>',
  '</h2><div class="result__snippet">IBM quantum systems overview.</div></div>',
  '</div></body></html>',
].join('');

const EMPTY_HTML =
  '<html><head><title>duckduckgo</title></head><body>' +
  '<div class="results_links"><div class="no-results">No results found</div></div>' +
  '</body></html>';

const GARBAGE_HTML =
  '<html><body><div class="app"><p>Hello world, totally unrelated markup</p></div></body></html>';

describe('KeylessSearchProvider (deterministic, no network)', () => {
  test('(a) parses DDG results incl. uddg redirect, strips tags', async () => {
    const fetcher = fakeFetcher({ [ddgUrl('hsbc quantum')]: { status: 200, body: VALID_HTML } });
    const provider = new KeylessSearchProvider({ fetcher, politenessMs: 0 });
    const res = await provider.search('hsbc quantum', { maxResults: 8 });
    expect(res.available).toBe(true);
    expect(res.providerName).toBe('KeylessSearchProvider');
    expect(res.results).toHaveLength(2);
    expect(res.results[0].url).toBe('https://www.hsbc.com/quantum');
    expect(res.results[0].title).toBe('HSBC Quantum Computing');
    expect(res.results[0].snippet).toBe('HSBC partners with IBM on quantum computing research.');
    expect(res.results[1].url).toBe('https://www.ibm.com/quantum');
  });

  test('(b) empty results page maps to SEARCH_EMPTY', async () => {
    const fetcher = fakeFetcher({ [ddgUrl('zzz-no-match')]: { status: 200, body: EMPTY_HTML } });
    const provider = new KeylessSearchProvider({ fetcher, politenessMs: 0 });
    const res = await provider.search('zzz-no-match');
    expect(res.available).toBe(true);
    expect(res.results).toHaveLength(0);
    expect(res.failureReason).toBe('SEARCH_EMPTY');
  });

  test('(c) HTTP 429 maps to SEARCH_RATE_LIMITED', async () => {
    const fetcher = fakeFetcher({ [ddgUrl('hsbc')]: { status: 429, body: '' } });
    const provider = new KeylessSearchProvider({ fetcher, politenessMs: 0 });
    const res = await provider.search('hsbc');
    expect(res.available).toBe(false);
    expect(res.results).toHaveLength(0);
    expect(res.failureReason).toBe('SEARCH_RATE_LIMITED');
  });

  test('(d) garbage HTML on 200 maps to SEARCH_PARSE_ERROR', async () => {
    const fetcher = fakeFetcher({ [ddgUrl('hsbc')]: { status: 200, body: GARBAGE_HTML } });
    const provider = new KeylessSearchProvider({ fetcher, politenessMs: 0 });
    const res = await provider.search('hsbc');
    expect(res.available).toBe(false);
    expect(res.failureReason).toBe('SEARCH_PARSE_ERROR');
  });

  test('(e) fetcher throw maps to SEARCH_UNAVAILABLE, never throws', async () => {
    const throwing: HttpFetcher = async (): Promise<Response> => {
      throw new Error('boom');
    };
    const provider = new KeylessSearchProvider({ fetcher: throwing, politenessMs: 0 });
    const res = await provider.search('hsbc');
    expect(res.available).toBe(false);
    expect(res.results).toHaveLength(0);
    expect(res.failureReason).toBe('SEARCH_UNAVAILABLE');
    expect(res.error).toContain('boom');
  });

  test('(f) politeness delay honored between consecutive calls', async () => {
    const fetcher = fakeFetcher({ [ddgUrl('hsbc')]: { status: 200, body: VALID_HTML } });
    const provider = new KeylessSearchProvider({ fetcher, politenessMs: 30 });
    const started = Date.now();
    await provider.search('hsbc', { maxResults: 1 });
    await provider.search('hsbc', { maxResults: 1 });
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(30);
  });

  test('(g) maxResults caps parsed results', async () => {
    const fetcher = fakeFetcher({ [ddgUrl('hsbc')]: { status: 200, body: VALID_HTML } });
    const provider = new KeylessSearchProvider({ fetcher, politenessMs: 0 });
    const res = await provider.search('hsbc', { maxResults: 1 });
    expect(res.available).toBe(true);
    expect(res.results).toHaveLength(1);
    expect(res.results[0].url).toBe('https://www.hsbc.com/quantum');
  });
});
