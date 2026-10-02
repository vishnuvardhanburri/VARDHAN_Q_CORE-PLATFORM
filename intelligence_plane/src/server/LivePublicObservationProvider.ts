import { Evidence, PublicObservationProvider, ObservationOptions, ObservationResult, HttpFetcher } from './IntelligenceCase';
import { randomBytes } from 'crypto';

/** Conservative subdomain candidates to probe (only on the same root domain). */
const SUBDOMAIN_CANDIDATES = ['api', 'www', 'docs', 'developer', 'status', 'api-docs'];

/** Conservative API endpoint paths to probe on discovered subdomains. */
const API_PATH_CANDIDATES = ['/v1', '/v1/', '/api/v1', '/api', '/health', '/healthz', '/status', '/.well-known/security.txt'];

/** Extract the registrable root domain from a hostname (e.g. "example.com" from "api.sub.example.com"). */
function extractRootDomain(hostname: string): string {
  let h = hostname.replace(/^www\./, '');
  const parts = h.split('.');
  if (parts.length >= 3) {
    h = parts.slice(-2).join('.');
  }
  return h;
}

/** Check if a hostname is on the same root domain. */
function isSameRootDomain(hostname: string, rootDomain: string): boolean {
  return hostname === rootDomain || hostname.endsWith('.' + rootDomain);
}

export class LivePublicObservationProvider implements PublicObservationProvider {
  private visited = new Set<string>();
  private queue: string[] = [];
  /** Subdomains discovered from public evidence (HTML links, canonical, sitemap). */
  private discoveredSubdomains: Set<string> = new Set();
  private rateLimitedUrls: string[] = [];
  private discovery_errors = 0;

  constructor(private options?: {
    onPage?: (url: string, status: number, latency: number) => void;
    /** Injectable fetcher (defaults to the runtime global fetch). */
    fetcher?: HttpFetcher;
    /** Polite delay between requests (default 200ms). */
    delayMs?: number;
    /** Delay between reproducibility samples (default 300ms). */
    sampleDelayMs?: number;
    /** Operator-supplied target subdomains to include (e.g. ['api.example.com']). */
    extraSubdomains?: string[];
    /** Maximum requests across all subdomains. */
    maxRequests?: number;
  }) {}

  /** Returns subdomains discovered during the last observation run. */
  getDiscoveredSubdomains(): string[] {
    return [...this.discoveredSubdomains];
  }

  /** Returns URLs that returned HTTP 429 (rate-limited), distinct from unreachable. */
  getRateLimitedUrls(): string[] {
    return this.rateLimitedUrls;
  }

  // ── Shared helpers ──────────────────────────────────────────────────────────

  /** Probe a single URL and return the response details. */
  private async probeUrl(url: string, options?: ObservationOptions): Promise<{
    status: number; latency: number; text: string; contentType: string | null;
  }> {
    const fetcher: HttpFetcher = this.options?.fetcher ?? (async (u, init) => fetch(u, { method: init.method, headers: init.headers, signal: init.signal }));
    const start = performance.now();
    const response = await fetcher(url, {
      method: 'GET',
      headers: options?.headers || { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      signal: AbortSignal.timeout(options?.timeoutMs || 8000),
    });
    const latency = Math.round(performance.now() - start);
    const text = await response.text().catch(() => '');
    return {
      status: response.status,
      latency,
      text,
      contentType: response.headers.get('content-type'),
    };
  }

  /** Observe a single URL: fetch, measure, classify, and return evidence + extracted links. */
  private async observeUrl(url: string, options: any, notTested: string[], rootDomain: string): Promise<{
    evidence: Evidence | null;
    subdomains: string[];
  }> {
    const start = performance.now();
    let response: Response;
    try {
      const fetcher: HttpFetcher = this.options?.fetcher ?? (async (u, init) => fetch(u, { method: init.method, headers: init.headers, signal: init.signal }));
      response = await fetcher(url, {
        method: 'GET',
        headers: options?.headers || { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
        signal: AbortSignal.timeout(options?.timeoutMs || 8000),
      });
    } catch (err: any) {
      if (err.name === 'AbortError' || err.message?.includes('429') || err.message?.includes('rate')) {
        this.rateLimitedUrls.push(url);
      } else {
        this.discovery_errors++;
        console.log(`[FETCH_FAILED] ${url}: ${err.message}`);
      }
      return { evidence: null, subdomains: [] };
    }

    const latency = Math.round(performance.now() - start);
    const text = await response.text().catch(() => '');
    const status = response.status;

    if (status === 429) {
      this.rateLimitedUrls.push(url);
    }

    const subtypes: string[] = [];
    const isJson = response.headers.get('content-type')?.includes('application/json');
    const source_type = isJson || url.includes('/api/') ? 'API_ENDPOINT' : 'PUBLIC_DOCUMENTATION';

    const evidence = this.createEvidence(url, status, `HTTP ${status} observed`, 1, false, notTested, text);
    evidence.latency_ms = latency;
    evidence.baseline_latency_ms = latency;
    evidence.source_type = source_type;

    const latencyTriggered = latency > 1500;

    if (status >= 500 || latencyTriggered || isJson) {
      const samples = await this.performRepeatedObservations(url, 2, options);
      evidence.latency_samples = [latency, ...samples.map(s => s.latency)];
      evidence.baseline_latency_ms = Math.min(...evidence.latency_samples) || latency;
      evidence.reproductions = 1 + samples.length;

      if (latencyTriggered) {
        const slowSamples = evidence.latency_samples.filter(s => s >= 1000).length;
        evidence.repeatable = slowSamples >= Math.ceil(evidence.latency_samples.length / 2)
          && samples.every(s => s.status === status);
      } else {
        evidence.repeatable = samples.every(s => s.status === status);
      }

      if (status >= 500 && evidence.repeatable && evidence.latency_samples.length >= 3) {
        evidence.observed_behavior = `Repeated HTTP ${status} response`;
      }
      if (latencyTriggered && evidence.repeatable) {
        evidence.observed_behavior = evidence.observed_behavior
          ? `${evidence.observed_behavior} — slow latency reproduced across ${evidence.reproductions} sample(s).`
          : `Slow latency (${latency}ms) reproduced across ${evidence.reproductions} sample(s).`;
      }
    }

    if (isJson && text) {
      try {
        const parsed = JSON.parse(text);
        const fields = this.extractFields(parsed);
        evidence.observed_fields = fields;
        const sensitive = fields.filter(f =>
          /(password|passwd|token|secret|credential|api_key|private_key|storage_path|internal_path|cluster_ip|internal_host|debug|stack_trace)/i.test(f)
        );
        if (sensitive.length > 0) {
          evidence.sensitive_fields = sensitive;
          evidence.observed_behavior = `Exposes fields matching sensitive or operational internal metadata.`;
        }
      } catch (e) {}
    }

    // Discover subdomains from this response
    const subs = this.discoverSubdomains(text, url, rootDomain);

    this.options?.onPage?.(url, status, latency);
    return { evidence, subdomains: subs };
  }

  /** Extract subdomains from HTML links, canonical URLs, script/src, JSON-LD. */
  private discoverSubdomains(html: string, baseUrl: string, rootDomain: string): string[] {
    const found: string[] = [];
    if (!html) return found;
    const seen = new Set<string>();

    const addHost = (raw: string) => {
      try {
        const host = new URL(raw, baseUrl).hostname;
        if (isSameRootDomain(host, rootDomain) && host !== rootDomain && !host.startsWith('www.')) {
          if (!seen.has(host)) {
            seen.add(host);
            found.push(host);
            this.discoveredSubdomains.add(host);
          }
        }
      } catch (e) {}
    };

    // 1. <a href> links
    const linkRegex = /<a\s+(?:[^>]*?\s+)?href=["']([^"']+)["']/gi;
    let match;
    while ((match = linkRegex.exec(html)) !== null) addHost(match[1]);

    // 2. <link rel="canonical">
    const canonRegex = /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/gi;
    let m2;
    while ((m2 = canonRegex.exec(html)) !== null) addHost(m2[1]);

    // 3. <script src> / <link href> asset hosts
    const assetRegex = /<(?:script|link)[^>]+(?:src|href)=["']([^"']+)["']/gi;
    let m3;
    while ((m3 = assetRegex.exec(html)) !== null) addHost(m3[1]);

    // 4. JSON-LD "url" fields
    const jsonLdRegex = /"url"\s*:\s*"(https?:\/\/[^"]+)"/gi;
    let m4;
    while ((m4 = jsonLdRegex.exec(html)) !== null) addHost(m4[1]);

    return found;
  }

  /** Build the full set of subdomain candidates, deduplicated, same-root only. */
  private buildSubdomainCandidates(rootDomain: string, primaryHost: string): string[] {
    const candidates = new Set<string>();

    // 1. Discovered from public evidence
    for (const sub of this.discoveredSubdomains) {
      if (isSameRootDomain(sub, rootDomain) && sub !== primaryHost) {
        candidates.add(sub);
      }
    }

    // 2. Operator-supplied explicit targets
    if (this.options?.extraSubdomains) {
      for (const sub of this.options.extraSubdomains) {
        const host = sub.replace(/^https?:\/\//, '').replace(/\/$/, '');
        if (isSameRootDomain(host, rootDomain)) {
          candidates.add(host);
        }
      }
    }

    // 3. Conservative candidates (api, www, docs, developer, status)
    for (const prefix of SUBDOMAIN_CANDIDATES) {
      const host = `${prefix}.${rootDomain}`;
      candidates.add(host);
    }

    return [...candidates];
  }

  /** Extract the root domain for API path probing from a URL. */
  private getApiPathCandidates(currentUrl: string): string[] {
    // Only probe API paths on URLs that look like API endpoints
    if (currentUrl.includes('/api/') || currentUrl.includes('/v1/')) {
      return [currentUrl];
    }
    return [];
  }

  // ── Main entry point ────────────────────────────────────────────────────────

  async observePublicSurface(url: string, options?: any): Promise<ObservationResult> {
    this.visited.clear();
    this.queue = [];
    this.discoveredSubdomains.clear();
    this.rateLimitedUrls = [];
    this.discovery_errors = 0;

    const baseUrl = new URL(url);
    const targetOrigin = baseUrl.origin;
    const targetHostname = baseUrl.hostname;
    const rootDomain = extractRootDomain(targetHostname);

    // IDENTITY GUARD
    if (options?.requiredOrigin) {
      if (targetOrigin !== options?.requiredOrigin) {
        console.log(`[IDENTITY_GUARD] Blocked access to external origin: ${targetOrigin}. Required: ${options?.requiredOrigin}`);
        this.discovery_errors++;
        return { evidence: [], discovery_errors: 1 };
      }
    }

    const evidenceList: Evidence[] = [];
    const notTested = ['mutations', 'auth bypass', 'authorization bypass', 'brute force', 'fuzzing', 'exploit execution'];
    let requestCount = 0;
    const maxRequests = this.options?.maxRequests ?? 20;

    // Phase 1: Crawl the primary origin (same as original implementation)
    this.queue.push(url);
    this.queue.push(`${targetOrigin}/robots.txt`);
    this.queue.push(`${targetOrigin}/sitemap.xml`);

    while (this.queue.length > 0 && requestCount < maxRequests) {
      const currentUrl = this.queue.shift()!;
      if (this.visited.has(currentUrl)) continue;
      this.visited.add(currentUrl);

      requestCount++;
      const { evidence, subdomains } = await this.observeUrl(currentUrl, options, notTested, rootDomain);
      if (evidence) evidenceList.push(evidence);

      // Discover more links from HTML pages (same-origin only)
      // This is handled inside observeUrl via discoverSubdomains, but also
      // follow same-origin links for same-origin crawling
      if (evidence?.raw_observation && evidence.source_type === 'PUBLIC_DOCUMENTATION') {
        const html = evidence.raw_observation;
        const linkRegex = /<a\s+(?:[^>]*?\s+)?href=["']([^"']+)["']/gi;
        let match;
        while ((match = linkRegex.exec(html)) !== null) {
          try {
            const discoveredUrl = new URL(match[1], currentUrl).href;
            const discoveredHost = new URL(discoveredUrl).hostname;
            if (isSameRootDomain(discoveredHost, rootDomain) && !this.visited.has(discoveredUrl)) {
              if (this.queue.length < 30) this.queue.push(discoveredUrl);
            }
          } catch (e) {}
        }
      }

      await new Promise(r => setTimeout(r, this.options?.delayMs ?? 200));
    }

    // Phase 2: Discover and probe subdomains
    // Re-scan discovered evidence for subdomains we may have found
    const allSubdomainCandidates = this.buildSubdomainCandidates(rootDomain, targetHostname);

    for (const candidate of allSubdomainCandidates) {
      const subOrigin = `https://${candidate}`;
      const pathsToProbe = ['', '/robots.txt', '/sitemap.xml', ...API_PATH_CANDIDATES];

      for (const p of pathsToProbe) {
        if (requestCount >= maxRequests) break;
        const probeUrl = `${subOrigin}${p}`;
        if (this.visited.has(probeUrl)) continue;
        this.visited.add(probeUrl);

        requestCount++;
        const { evidence, subdomains } = await this.observeUrl(probeUrl, options, notTested, rootDomain);
        if (evidence) evidenceList.push(evidence);

        await new Promise(r => setTimeout(r, this.options?.delayMs ?? 200));
      }
    }

    return { evidence: evidenceList, discovery_errors: this.discovery_errors };
  }

  // ── Repeated observations (same logic as original, unchanged) ──────────────

  private async performRepeatedObservations(url: string, count: number, options?: ObservationOptions) {
    const results = [];
    for (let i = 0; i < count; i++) {
      await new Promise(r => setTimeout(r, this.options?.sampleDelayMs ?? 300));
      const start = performance.now();
      try {
        const fetcher: HttpFetcher = this.options?.fetcher ?? (async (u, init) => fetch(u, { method: init.method, headers: init.headers, signal: init.signal }));
        const res = await fetcher(url, { method: 'GET', headers: options?.headers || {}, signal: AbortSignal.timeout(options?.timeoutMs || 8000) });
        await res.arrayBuffer().catch(()=>null);
        results.push({ status: res.status, latency: Math.round(performance.now() - start) });
      } catch (err) {
        // Drop network failures from repetition samples safely
      }
    }
    return results;
  }

  // ── Field extraction (unchanged) ────────────────────────────────────────────

  private extractFields(obj: any, prefix = '', limit = 100): string[] {
    let fields: string[] = [];
    if (fields.length > limit) return fields;

    if (obj !== null && typeof obj === 'object') {
      if (Array.isArray(obj)) {
        if (obj.length > 0) fields.push(...this.extractFields(obj[0], prefix, limit));
      } else {
        for (const [key, val] of Object.entries(obj)) {
          fields.push(key);
          fields.push(...this.extractFields(val, key + '.', limit));
        }
      }
    }
    return Array.from(new Set(fields)).slice(0, limit);
  }

  private createEvidence(url: string, status: number, behavior: string, reps: number, rep: boolean, notTested: string[], text: string = ''): Evidence {
    return {
      id: 'ev_live_' + randomBytes(8).toString('hex'),
      evidence_origin: 'REAL_PUBLIC_OBSERVATION',
      public_url: url,
      source_type: 'UNKNOWN',
      method: 'GET',
      status,
      observed_behavior: behavior,
      reproductions: reps,
      repeatable: rep,
      tested_without_auth: true,
      not_tested: notTested,
      retrieved_at: new Date().toISOString(),
      evidence_text: text,
      raw_observation: text // Ensure we preserve the body content for extractors
    };
  }
}
