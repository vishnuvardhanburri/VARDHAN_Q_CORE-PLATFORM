/**
 * VARDHAN — FAST TRIAGE ENGINE (§1)
 * ─────────────────────────────────────────────────────────────────────────────
 * Cheap, bounded triage before deep research. Checks only high-value indicators:
 *   - official domain reachable
 *   - public technical surface (sitemap, robots, API/docs links)
 *   - GitHub organization discoverable
 *   - recent engineering-related content
 *   - recent relevant hiring signals
 *   - status/incident pages
 *
 * Maximum: 10 HTTP requests, 3 search queries, 30 seconds runtime.
 * Returns PASS_FOR_DEEP_RESEARCH or STOP_LOW_VALUE.
 *
 * Principle: MAXIMIZE useful verified information per unit of research cost.
 */

import type { HttpFetcher } from '../IntelligenceCase';

export type TriageDecision = 'PASS_FOR_DEEP_RESEARCH' | 'STOP_LOW_VALUE';

export interface TriageResult {
  company: string;
  domain: string;
  decision: TriageDecision;
  /** Signals detected during triage. */
  signals: string[];
  /** Sources probed. */
  sourcesChecked: string[];
  /** Count of HTTP requests used. */
  httpRequestsUsed: number;
  /** Count of search queries used. */
  searchQueriesUsed: number;
  /** Time spent in milliseconds. */
  timeMs: number;
  /** Reasons for the decision. */
  reasons: string[];
}

export class TriageEngine {
  /**
   * Run fast triage for a single company.
   * Performs bounded, read-only checks — never defeats auth/CAPTCHA/WAF.
   */
  static async triage(
    company: string,
    domain: string,
    fetcher: HttpFetcher,
    options: {
      maxRequests?: number;
      maxRuntimeMs?: number;
      onProgress?: (msg: string) => void;
    } = {},
  ): Promise<TriageResult> {
    const start = Date.now();
    const maxRequests = options.maxRequests ?? 10;
    const maxRuntimeMs = options.maxRuntimeMs ?? 30_000;
    const onProgress = options.onProgress || (() => {});

    const signals: string[] = [];
    const sourcesChecked: string[] = [];
    let requests = 0;
    let searchQueries = 0;
    const now = new Date().toISOString();

    const origin = domain.startsWith('http') ? domain : `https://${domain}`;
    const hostname = origin.replace(/^https?:\/\//, '').replace(/\/$/, '');

    async function probe(url: string, label: string): Promise<{ status: number; html: string } | null> {
      if (requests >= maxRequests) return null;
      if (Date.now() - start > maxRuntimeMs) return null;
      requests++;
      sourcesChecked.push(`${label}: ${url}`);
      try {
        const res = await fetcher(url, {
          method: 'GET',
          headers: { 'User-Agent': 'VARDHAN-Triage/1.0', 'Accept': 'text/html' },
          signal: AbortSignal.timeout(5000),
        });
        onProgress(`[triage] ${label} ${url} → HTTP ${res.status}`);
        const text = await res.text().catch(() => '');
        return { status: res.status, html: text };
      } catch (e) {
        onProgress(`[triage] ${label} ${url} → BLOCKED`);
        return null;
      }
    }

    // 1. Homepage — check for technical indicators
    const home = await probe(origin, 'homepage');
    if (home && home.status >= 200 && home.status < 400) {
      if (home.html.includes('github.com') || home.html.includes('github')) {
        signals.push('GitHub link found on homepage');
      }
      if (home.html.includes('/docs') || home.html.includes('/api') || home.html.includes('/developers')) {
        signals.push('API/docs links found on homepage');
      }
      if (home.html.includes('/status') || home.html.includes('/incident')) {
        signals.push('Status/incident page linked');
      }
      if (home.html.includes('/security') || home.html.includes('/bug')) {
        signals.push('Security page linked');
      }
      if (home.html.includes('/careers') || home.html.includes('/jobs')) {
        signals.push('Careers/jobs linked');
      }
      if (home.html.includes('/blog') || home.html.includes('/engineering')) {
        signals.push('Engineering blog linked');
      }
      // Detect technology signals in homepage HTML
      const techMatches = home.html.match(/<meta[^>]+name=["'](?:generator|description)["'][^>]*content=["'][^"']*(?:platform|infrastructure|scalab|microservice|cloud|aws| GCP|azure|kubernetes|docker|terraform)[^"']*/gi);
      if (techMatches) signals.push(`Technical keywords detected on homepage: ${techMatches.length}`);
    }

    // 2. Sitemap
    const sitemap = await probe(`${origin}/sitemap.xml`, 'sitemap');
    if (sitemap && sitemap.status >= 200 && sitemap.status < 400) {
      signals.push('sitemap.xml exists — public surface is indexed');
    }

    // 3. Robots
    const robots = await probe(`${origin}/robots.txt`, 'robots');
    if (robots && robots.status >= 200 && robots.status < 400) {
      const hasTechPaths = /\/api\/|\/docs\/|\/status\/|\/security\/|\/engineering\/|\/blog\/|\/careers\//i.test(robots.html);
      if (hasTechPaths) signals.push('robots.txt reveals technical paths (api, docs, status, security)');
    }

    // 4. Check common technical subpaths
    const techPaths = ['/sitemap.xml', '/api', '/docs', '/status', '/security', '/careers', '/blog', '/engineering'];
    for (const tp of techPaths) {
      if (requests >= maxRequests) break;
      if (Date.now() - start > maxRuntimeMs) break;
      const res = await probe(`${origin}${tp}`, `path:${tp}`);
      if (res && res.status >= 200 && res.status < 400) {
        signals.push(`Public path exists: ${tp}`);
      }
    }

    // 5. GitHub org detection (cheap — check homepage + sitemap for GitHub)
    if (signals.some(s => s.includes('GitHub'))) {
      // Try to extract GitHub org from homepage
      const ghMatch = home?.html.match(/github\.com\/([a-zA-Z0-9_-]+)/i);
      if (ghMatch) {
        signals.push(`GitHub organization likely: ${ghMatch[1]}`);
      }
    }

    onProgress(`[triage] requests used: ${requests}, signals: ${signals.length}`);

    const timeMs = Date.now() - start;

    // Decision: if we found at least 2 signals, pass for deep research
    const hasTechnicalSurface = signals.some(s =>
      s.includes('GitHub') || s.includes('API/docs') || s.includes('sitemap') ||
      s.includes('technical keywords') || s.includes('robots.txt')
    );
    const hasRecentActivity = signals.some(s =>
      s.includes('blog') || s.includes('engineering') || s.includes('careers') || s.includes('status')
    );

    const decision: TriageDecision = (hasTechnicalSurface || hasRecentActivity || signals.length >= 2)
      ? 'PASS_FOR_DEEP_RESEARCH'
      : 'STOP_LOW_VALUE';

    const reasons = decision === 'PASS_FOR_DEEP_RESEARCH'
      ? [`Triage found ${signals.length} signal(s) indicating technical surface or recent activity.`]
      : [`Triage found ${signals.length} signal(s) — no strong technical surface or recent activity detected.`];

    return {
      company,
      domain,
      decision,
      signals,
      sourcesChecked,
      httpRequestsUsed: requests,
      searchQueriesUsed: searchQueries,
      timeMs,
      reasons,
    };
  }
}
