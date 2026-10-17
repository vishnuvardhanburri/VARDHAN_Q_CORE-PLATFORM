/**
 * VARDHAN — KEYLESS SEARCH PROVIDER
 * ─────────────────────────────────────────────────────────────────────────────
 * Zero-credential live-web search via the DuckDuckGo html endpoint.
 *
 * - No API keys, no new npm dependencies (dependency-free regex parsing only).
 * - Read-only GETs against https://html.duckduckgo.com/html/?q=…
 * - Polite by default: configurable delay between consecutive queries plus an
 *   identifying User-Agent.
 * - NEVER throws: every failure mode maps to a SearchProviderResponse with a
 *   SearchFailureReason (see IntelligenceCase.ts).
 *
 * Failure mapping:
 *   HTTP 429 / 202              → SEARCH_RATE_LIMITED
 *   other non-2xx               → SEARCH_UNAVAILABLE (status in `error`, no secrets)
 *   200, DDG page, zero results → SEARCH_EMPTY
 *   200, non-DDG / garbage HTML → SEARCH_PARSE_ERROR (probable layout change)
 *   fetcher throws / abort      → SEARCH_UNAVAILABLE
 */

import type { HttpFetcher } from '../IntelligenceCase.ts';
import {
  NullSearchProvider,
  WebSearchProviderManager,
} from '../WebSearchProvider.ts';
import type {
  SearchOptions,
  SearchProvider,
  SearchProviderResponse,
} from '../WebSearchProvider.ts';

const DDG_HTML_ENDPOINT = 'https://html.duckduckgo.com/html/?q=';
const USER_AGENT = 'Mozilla/5.0 (compatible; VardhanIntelligence/1.0)';
const DEFAULT_POLITENESS_MS = 1200;
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_RESULTS = 8;

export interface KeylessSearchProviderOptions {
  fetcher?: HttpFetcher;
  politenessMs?: number;
  timeoutMs?: number;
}

interface ParsedResult {
  url: string;
  title: string;
  snippet: string;
}

const defaultFetcher: HttpFetcher = async (url, init) => fetch(url, init);

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** Minimal HTML-entity decoder for DDG hrefs, titles and snippets. */
function decodeEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, '/')
    .replace(/&nbsp;/g, ' ');
}

/** Strip tags, decode entities, collapse whitespace. */
function cleanText(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function classAttribute(attrs: string): string {
  const match = attrs.match(/\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
  if (!match) return '';
  return `${match[1] ?? ''} ${match[2] ?? ''}`;
}

function isResultAnchor(attrs: string): boolean {
  const cls = classAttribute(attrs);
  return cls.includes('result__a') || cls.includes('result-link');
}

function extractHref(attrs: string): string {
  const match = attrs.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
  return (match?.[1] ?? match?.[2] ?? '').trim();
}

/**
 * Unwrap DuckDuckGo redirect links (//duckduckgo.com/l/?uddg=<encoded-target>&…).
 * Returns the decoded target URL, or the normalised original href.
 */
function unwrapDuckDuckGoHref(rawHref: string): string {
  const href = decodeEntities(rawHref.trim());
  const marker = '/l/?';
  const markerIndex = href.indexOf(marker);
  if (markerIndex !== -1) {
    const queryString = href.slice(markerIndex + marker.length);
    const target = new URLSearchParams(queryString).get('uddg');
    if (target) {
      try {
        return decodeURIComponent(target);
      } catch {
        return target;
      }
    }
  }
  if (href.startsWith('//')) return `https:${href}`;
  return href;
}

/** Keep only http(s) result URLs. */
function isHttpUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://');
}

/**
 * Parse DDG html-endpoint markup with dependency-free regexes.
 * Two dedicated passes (anchors, then snippets) so nested <div> layout
 * cannot misalign matches: result anchors (class `result__a` /
 * `result-link`) pair positionally with the i-th `result__snippet`
 * element, matching DDG's one-snippet-per-result layout.
 */
function parseDuckDuckGoHtml(html: string): ParsedResult[] {
  const results: ParsedResult[] = [];
  const anchorPattern = /<a\b([^>]*?)>([\s\S]*?)<\/a>/gi;
  let anchorMatch: RegExpExecArray | null;
  while ((anchorMatch = anchorPattern.exec(html)) !== null) {
    const attrs = anchorMatch[1];
    if (!isResultAnchor(attrs)) continue;
    const url = unwrapDuckDuckGoHref(extractHref(attrs));
    if (!isHttpUrl(url)) continue;
    results.push({ url, title: cleanText(anchorMatch[2]), snippet: '' });
  }
  if (results.length === 0) return results;
  // Snippet bodies carry inline tags only (<b>, <em>), never nested <div>s,
  // so a targeted non-greedy capture is safe here.
  const snippetPattern =
    /<div\b[^>]*\bclass\s*=\s*(?:"[^"]*result__snippet[^"]*"|'[^']*result__snippet[^']*')[^>]*>([\s\S]*?)<\/div>/gi;
  const snippets: string[] = [];
  let snippetMatch: RegExpExecArray | null;
  while ((snippetMatch = snippetPattern.exec(html)) !== null) {
    snippets.push(cleanText(snippetMatch[1]));
  }
  for (let i = 0; i < results.length; i++) {
    if (i < snippets.length) results[i].snippet = snippets[i];
  }
  return results.filter((r) => r.title.length > 0 || r.snippet.length > 0);
}

/**
 * Distinguish a genuine (empty) DDG results page from garbage HTML.
 * A real DDG page always carries DDG markers; anything else on HTTP 200
 * signals a layout change or a captive-portal / block page.
 */
function looksLikeDuckDuckGoPage(html: string): boolean {
  if (html.trim().length === 0) return true;
  const lowered = html.toLowerCase();
  return (
    lowered.includes('duckduckgo') ||
    lowered.includes('result__') ||
    lowered.includes('result-link') ||
    lowered.includes('results_links') ||
    lowered.includes('no-results') ||
    lowered.includes('no results') ||
    lowered.includes('not many results')
  );
}

export class KeylessSearchProvider implements SearchProvider {
  readonly name = 'KeylessSearchProvider';
  readonly available = true;

  private readonly fetcher: HttpFetcher;
  private readonly politenessMs: number;
  private readonly timeoutMs: number;
  private lastQueryAt = 0;

  constructor(options: KeylessSearchProviderOptions = {}) {
    this.fetcher = options.fetcher ?? defaultFetcher;
    this.politenessMs = options.politenessMs ?? DEFAULT_POLITENESS_MS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private async applyPolitenessDelay(): Promise<void> {
    if (this.lastQueryAt === 0 || this.politenessMs <= 0) {
      this.lastQueryAt = Date.now();
      return;
    }
    const elapsed = Date.now() - this.lastQueryAt;
    if (elapsed < this.politenessMs) {
      await sleep(this.politenessMs - elapsed);
    }
    this.lastQueryAt = Date.now();
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchProviderResponse> {
    try {
      await this.applyPolitenessDelay();

      const endpoint = `${DDG_HTML_ENDPOINT}${encodeURIComponent(query)}`;
      const response = await this.fetcher(endpoint, {
        method: 'GET',
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html',
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (response.status === 429 || response.status === 202) {
        return {
          available: false,
          providerName: this.name,
          results: [],
          error: `DuckDuckGo rate limit (HTTP ${response.status})`,
          failureReason: 'SEARCH_RATE_LIMITED',
        };
      }

      if (!response.ok) {
        return {
          available: false,
          providerName: this.name,
          results: [],
          error: `DuckDuckGo unavailable (HTTP ${response.status})`,
          failureReason: 'SEARCH_UNAVAILABLE',
        };
      }

      let html: string;
      try {
        html = await response.text();
      } catch {
        return {
          available: false,
          providerName: this.name,
          results: [],
          error: 'DuckDuckGo response body unreadable',
          failureReason: 'SEARCH_UNAVAILABLE',
        };
      }

      const parsed = parseDuckDuckGoHtml(html);
      if (parsed.length === 0) {
        if (looksLikeDuckDuckGoPage(html)) {
          return {
            available: true,
            providerName: this.name,
            results: [],
            failureReason: 'SEARCH_EMPTY',
          };
        }
        return {
          available: false,
          providerName: this.name,
          results: [],
          error: 'DuckDuckGo layout unrecognized (no parseable results)',
          failureReason: 'SEARCH_PARSE_ERROR',
        };
      }

      const cap = options.maxResults ?? DEFAULT_MAX_RESULTS;
      const limit = Number.isFinite(cap) && cap > 0 ? Math.floor(cap) : DEFAULT_MAX_RESULTS;
      const results = parsed
        .slice(0, limit)
        .map((r) => ({ url: r.url, title: r.title, snippet: r.snippet }));
      return { available: true, providerName: this.name, results };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown fetch error';
      return {
        available: false,
        providerName: this.name,
        results: [],
        error: `Keyless search failed: ${message}`,
        failureReason: 'SEARCH_UNAVAILABLE',
      };
    }
  }
}

/**
 * Keyless-first fallback chain: live DDG-html search, then the dormant
 * NullSearchProvider terminator. Serper providers stay out of the chain
 * until an operator configures credentials.
 */
export function buildKeylessChain(fetcher?: HttpFetcher): WebSearchProviderManager {
  const keyless =
    fetcher === undefined ? new KeylessSearchProvider() : new KeylessSearchProvider({ fetcher });
  return new WebSearchProviderManager([keyless, new NullSearchProvider()]);
}
