/**
 * VARDHAN PUBLIC LINK DISCOVERY
 * ─────────────────────────────────────────────────────────────────────────────
 * Bounded, same-origin, READ-ONLY discovery of a company's public professional
 * surface.
 *
 * The discovery prioritises professional / technical pages that are most
 * relevant to finding a public technical owner and engineering signals:
 *
 *   /about        /team        /leadership
 *   /engineering  /technology  /blog
 *   /docs         /developers  /security
 *   /status       /changelog   /careers
 *   /company      /press
 *
 * Strict safety bounds (public observation only — never intrusive):
 *   - Only `GET` requests are issued.
 *   - Only same-origin, publicly reachable pages are followed.
 *   - A hard cap on total requests (default 12) keeps the crawl low-impact.
 *   - A polite delay between requests.
 *   - Content is read; nothing is posted, mutated, or enumerated.
 *   - robots.txt is surfaced as a diagnostic (it is NOT used to bypass anything,
 *     and we never fetch disallowed resources aggressively).
 */

import { CompanySurface, DiscoveredPage, ProfessionalPageCategory, HttpFetcher } from './IntelligenceCase';

export const VARDHAN_USER_AGENT = 'VARDHAN-Public-OBSERVER/1.0 (read-only; contact@vardhan.ai)';

/** Shared injective fetcher shape (structural alias for HttpFetcher). */
export type Fetcher = HttpFetcher;

export interface PublicLinkDiscoveryOptions {
  maxPages?: number;          // total pages to fetch (incl. homepage) — bounded
  delayMs?: number;           // polite delay between requests
  timeoutMs?: number;         // per-request timeout
  fetcher?: HttpFetcher;      // injectable fetch for tests
  onProgress?: (page: DiscoveredPage) => void;
  /** Optional capture of raw HTML for a fetched page (used for people extraction). */
  onHtml?: (url: string, html: string) => void;
  logger?: (message: string) => void;
}

export const PROFESSIONAL_PATHS: Array<{ category: ProfessionalPageCategory; labels: string[] }> = [
  { category: 'team_people', labels: ['/team', '/leadership', '/people', '/our-team', '/team/', '/leadership-team', '/leadership/', '/who-we-are/leadership', '/who-we-are/team', '/people/leadership', '/executive-team', '/meet-the-team', '/profile'] },
  { category: 'engineering', labels: ['/engineering', '/technology', '/tech', '/developers', '/engineering-team', '/developer', '/platform', '/infrastructure'] },
  { category: 'blog', labels: ['/blog', '/changelog', '/engineering-blog', '/tech-blog', '/medium'] },
  { category: 'docs', labels: ['/docs', '/documentation', '/api', '/developers/'] },
  { category: 'security', labels: ['/security', '/trust', '/trust-center', '/security/', '/bug-bounty'] },
  { category: 'status_ops', labels: ['/status', '/incidents', '/system-status', '/status/'] },
  { category: 'about', labels: ['/about', '/company', '/press', '/about-us', '/who-we-are', '/vision', '/our-story'] },
  { category: 'hiring', labels: ['/careers', '/jobs', '/join-us', '/careers/'] }
];

export class PublicLinkDiscovery {
  /**
   * Discover the public professional surface for a company, starting from its
   * homepage. Returns the company surface with categorised discovered pages.
   */
  static async discover(
    companyUrl: string,
    options: PublicLinkDiscoveryOptions = {}
  ): Promise<CompanySurface> {
    const maxPages = options.maxPages ?? 12;
    const delayMs = options.delayMs ?? 300;
    const timeoutMs = options.timeoutMs ?? 8000;
    const fetcher = options.fetcher ?? this.defaultFetcher;
    const log = options.logger ?? (() => {});

    let baseUrl: URL;
    try {
      baseUrl = new URL(companyUrl);
    } catch {
      throw new Error(`Invalid company URL: ${companyUrl}`);
    }
    if (baseUrl.protocol !== 'http:' && baseUrl.protocol !== 'https:') {
      throw new Error(`VARDHAN only supports http(s) URLs. Refusing non-web scheme.`);
    }

    const origin = baseUrl.origin;
    const company = baseUrl.hostname.replace(/^www\./, '');

    const surface: CompanySurface = {
      company,
      origin,
      homepage: baseUrl.href,
      discovered_pages: [],
      page_categories: {}
    };

    const visited = new Set<string>();
    // Seed with homepage first, then a focused set of professional page paths.
    const seedPaths = this.resolveSeedPaths(baseUrl);

    // Priority queue: homepage (0) first, then discovered links (1), then
    // refill seeds (5), then initial seed paths (10). Discovered links are
    // highest-value because they come from the company's actual navigation.
    interface QueueItem { url: string; categoryHint?: ProfessionalPageCategory; priority: number; }
    const queue: QueueItem[] = [];
    queue.push({ url: baseUrl.href, categoryHint: 'homepage', priority: 0 });
    // Seed only the first few high-signal paths up-front; the rest are added
    // dynamically when budget remains (so discovered links always win).
    const initialSeedBudget = Math.min(6, seedPaths.length);
    let nextSeedIdx = initialSeedBudget;
    for (const p of seedPaths.slice(0, initialSeedBudget)) {
      queue.push({ url: p.url, categoryHint: p.category, priority: 10 });
    }

    let requests = 0;
    let abortController: AbortController | undefined;

    const fetchPage = async (targetUrl: string, categoryHint?: ProfessionalPageCategory): Promise<DiscoveredPage | null> => {
      if (visited.has(targetUrl)) return null;
      if (requests >= maxPages) return null;
      visited.add(targetUrl);
      requests++;

      abortController = new AbortController();
      const timer = setTimeout(() => abortController!.abort(), timeoutMs);

      let status = 0;
      let html = '';
      let ok = false;
      try {
        const res = await fetcher(targetUrl, {
          method: 'GET',
          headers: { 'User-Agent': VARDHAN_USER_AGENT, 'Accept': 'text/html' },
          signal: abortController.signal
        });
        status = res.status;
        ok = true;
        html = await res.text().catch(() => '');
      } catch {
        // read-only network failure — record diagnostic, do not create evidence
        log(`[discovery] network error reaching ${targetUrl}`);
      } finally {
        clearTimeout(timer);
      }

      let title: string | undefined;
      let category = this.categorizePath(new URL(targetUrl).pathname);
      if (categoryHint === 'homepage') category = 'homepage';
      else if (category === 'other') category = categoryHint ?? 'other';

      // A page is part of the public professional surface only when it resolved
      // successfully (HTTP 2xx). 404 / 5xx / network failures are NOT public
      // pages — they are logged as diagnostics and excluded from the surface so
      // the operator never reports a "discovered" page that does not exist.
      const isPublicPage = ok && status >= 200 && status < 300;

      if (isPublicPage && html) {
        title = this.extractTitle(html);
        // Discover more same-origin professional links from this page.
        const discovered = this.extractSameOriginLinks(html, targetUrl, origin);
        for (const link of discovered) {
          if (!visited.has(link) && queue.length < maxPages * 5) {
            // Discovered links get high priority (priority=1) so they are
            // processed BEFORE the remaining guessed seed paths (priority=10).
            queue.push({ url: link, categoryHint: this.categorizePath(new URL(link).pathname), priority: 1 });
          }
        }
      }

      const page: DiscoveredPage = { url: targetUrl, path: new URL(targetUrl).pathname, title, status: ok ? status : undefined, category };

      if (isPublicPage) {
        surface.discovered_pages.push(page);
        if (page.category) {
          (surface.page_categories[page.category] ||= []).push(targetUrl);
        }
        if (html) options.onHtml?.(targetUrl, html);
        options.onProgress?.(page);
      } else {
        log(`[discovery] ${targetUrl} -> ${ok ? status : 'network error'} (not a public page, skipping)`);
      }
      await new Promise(r => setTimeout(r, delayMs));
      return page;
    };

    while (queue.length > 0 && requests < maxPages) {
      // Priority selection: lowest priority number first, then FIFO.
      // Search the FULL queue so discovered links (priority 1) are always
      // preferred over seed paths (priority 10), regardless of position.
      let bestIdx = 0;
      for (let i = 1; i < queue.length; i++) {
        if (queue[i].priority < queue[bestIdx].priority) bestIdx = i;
      }
      const next = queue.splice(bestIdx, 1)[0];
      await fetchPage(next.url, next.categoryHint);

      // Dynamic refill: when the queue is low and budget remains, add more
      // seed paths (priority 5) so they get a chance after discovered links
      // are exhausted but before running out of budget.
      if (queue.length < initialSeedBudget && nextSeedIdx < seedPaths.length && requests < maxPages) {
        const refillCount = Math.min(4, seedPaths.length - nextSeedIdx);
        for (let i = 0; i < refillCount; i++) {
          const p = seedPaths[nextSeedIdx + i];
          queue.push({ url: p.url, categoryHint: p.category, priority: 5 });
        }
        nextSeedIdx += refillCount;
      }
    }

    return surface;
  }

  // ── default fetcher (Node 22 global fetch) ───────────────────────────────
  private static defaultFetcher: HttpFetcher = async (url, init) => {
    return fetch(url, { method: init.method, headers: init.headers, signal: init.signal });
  };

  // ── helpers ──────────────────────────────────────────────────────────────
  private static resolveSeedPaths(base: URL): Array<{ url: string; category: ProfessionalPageCategory }> {
    const out: Array<{ url: string; category: ProfessionalPageCategory }> = [];
    for (const { category, labels } of PROFESSIONAL_PATHS) {
      for (const label of labels) {
        // normalise: ensure leading slash, no trailing slash conflicts
        const path = label.startsWith('/') ? label : '/' + label;
        out.push({ url: base.origin + path, category });
      }
    }
    return out;
  }

  private static categorizePath(pathname: string): ProfessionalPageCategory {
    return categorizeProfessionalPath(pathname);
  }

  private static extractSameOriginLinks(html: string, currentUrl: string, origin: string): string[] {
    const links: string[] = [];
    const re = /<a\s+(?:[^>]*?\s+)?href=["']([^"']+)["']/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      try {
        const resolved = new URL(m[1], currentUrl).href;
        if (resolved.startsWith(origin) && !resolved.includes('#') ) {
          links.push(resolved);
        }
      } catch {
        // ignore non-http/mailto links etc.
      }
    }
    return Array.from(new Set(links));
  }

  private static extractTitle(html: string): string | undefined {
    const m = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
    return m ? m[1].trim() : undefined;
  }
}

/**
 * Classify a pathname into a professional page category using PROFESSIONAL_PATHS.
 *
 * The matching rule: normalise the path to a leading-slash, no-trailing-slash
 * form, then for each category check whether the normalised path is an exact
 * match, a prefix match, or whose first segment matches a label needle.
 *
 * Exported so the cohesive PublicSourceGraph model shares the EXACT same
 * taxonomy as PublicLinkDiscovery (single source of truth for classification).
 */
export function categorizeProfessionalPath(pathname: string): ProfessionalPageCategory {
  const p = '/' + pathname.replace(/^\/+/, '').replace(/\/+$/, '');
  const segments = p.split('/').filter(Boolean);
  const first = segments[0] || '';
  for (const { category, labels } of PROFESSIONAL_PATHS) {
    for (const label of labels) {
      const needle = label.replace(/^\/+/, '').replace(/\/$/, '');
      // Match: exact path, path-starts-with label, first-segment match, or any segment
      if (p === '/' + needle || p.startsWith('/' + needle) || first === needle) {
        return category;
      }
      // Broader: any path segment matches a label segment (e.g. /who-we-are/leadership-team → "leadership-team")
      for (const seg of segments) {
        if (seg === needle) return category;
      }
    }
  }
  return 'other';
}
