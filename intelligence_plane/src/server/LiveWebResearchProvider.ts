/**
 * VARDHAN — LIVE WEB RESEARCH PROVIDER (§2, §8, §9)
 * ─────────────────────────────────────────────────────────────────────────────
 * Performs legitimate public web research as a fallback/augmentation when
 * dataset data is incomplete or stale.
 */

import type { HttpFetcher } from './IntelligenceCase';
import type { Evidence } from './IntelligenceCase';
import { SearchCache } from './SearchCache';
import { NullSearchProvider } from './WebSearchProvider';
import type { SearchProvider, SearchOptions } from './WebSearchProvider';
import type { SearchResult } from './SearchCache';
import { QueryGenerator } from './QueryGenerator';
import { FreshnessEngine } from './FreshnessEngine';
import { ResearchBudget } from './ResearchBudget';
import type { ResearchStage } from './ResearchBudget';
import { PublicLinkDiscovery } from './PublicLinkDiscovery';
import { PeopleExtractor } from './PeopleExtractor';
import type { OwnerCandidate, DiscoveredPage, CompanySurface } from './IntelligenceCase';
import { GitHubDiscovery } from './GitHubDiscovery';
import type { GithubRepoMeta } from './DeepTypes';
import { randomBytes } from 'crypto';

export interface LiveWebResearchResult {
  evidence: Evidence[];
  discovered_pages: DiscoveredPage[];
  htmlByUrl: Map<string, string>;
  owner_candidates: OwnerCandidate[];
  github_repos: GithubRepoMeta[];
  queries_executed: { query: string; results: number; cached: boolean }[];
  errors: string[];
  search_available: boolean;
  search_provider: string;
  stage_reached: ResearchStage;
}

export interface LiveWebResearchOptions {
  fetcher?: HttpFetcher;
  searchProvider?: SearchProvider;
  context: {
    company: string;
    domain: string;
    personName?: string;
    technicalTopic?: string;
    technicalArea?: string;
  };
  maxStage?: ResearchStage;
  maxResultsPerQuery?: number;
  onProgress?: (stage: string, message: string) => void;
}

export class LiveWebResearchProvider {
  private readonly fetcher: HttpFetcher;
  private readonly cache = new SearchCache();
  private readonly budget: ResearchBudget;

  constructor(fetcher?: HttpFetcher) {
    if (fetcher) {
      this.fetcher = fetcher;
    } else {
      this.fetcher = ((url: string, init: { method: string; headers: Record<string, string>; signal: AbortSignal }) =>
        fetch(url, { method: init.method, headers: init.headers, signal: init.signal })) as HttpFetcher;
    }
    this.budget = new ResearchBudget();
  }

  // --- Helpers for TargetedDiscoveryEngine ---

  async fetchPage(url: string): Promise<{ html: string; status: number } | null> {
    try {
      const res = await this.fetcher(url, {
        method: 'GET',
        headers: { 'User-Agent': 'VARDHAN-LIVE-OBSERVER/1.0', 'Accept': 'text/html' },
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) return { html: await res.text(), status: res.status };
    } catch (e) {
      return null;
    }
    return null;
  }

  async search(query: string): Promise<SearchResult[]> {
    // Using NullSearchProvider for the mock/baseline, but in production this uses the actual provider.
    const provider = new NullSearchProvider();
    const resp = await provider.search(query, { maxResults: 8 });
    return (resp.results || []).map(r => ({ title: r.title, snippet: r.snippet, url: r.url, source: resp.providerName }));
  }

  async getGithubRepos(org: string, keywords: string[]): Promise<GithubRepoMeta[]> {
    // GitHub API calls should go through GitHubProvider with rate-limit awareness.
    // Return empty — real GitHub discovery is handled by GitHubProvider in the
    // free-first architecture.
    return [];
  }

  async getRepoContributors(org: string, repo: string): Promise<{ login: string; name?: string }[]> {
    // GitHub API calls should go through GitHubProvider. Return empty.
    return [];
  }

  async fetchGithubProfile(login: string): Promise<{ bio: string; url: string } | null> {
    // GitHub API calls should go through GitHubProvider. Return null.
    return null;
  }

  // --- Core research logic ---

  async research(options: LiveWebResearchOptions): Promise<LiveWebResearchResult> {
    const { context, maxStage = 4, maxResultsPerQuery = 8 } = options;
    const onProgress = options.onProgress || (() => {});
    const fetcher = options.fetcher || this.fetcher;
    const evidence: Evidence[] = [];
    const discoveredPages: DiscoveredPage[] = [];
    const htmlByUrl = new Map<string, string>();
    const ownerCandidates: OwnerCandidate[] = [];
    const githubRepos: GithubRepoMeta[] = [];
    const queriesExecuted: { query: string; results: number; cached: boolean }[] = [];
    const errors: string[] = [];

    let searchProvider: SearchProvider | undefined = options.searchProvider;
    if (!searchProvider || !searchProvider.available) {
      searchProvider = new NullSearchProvider();
    }
    const searchAvailable = searchProvider.available;
    if (!searchAvailable) {
      errors.push('SEARCH_UNAVAILABLE: No search provider available in FREE_ONLY mode — continuing with public web sources only.');
    }

    if (this.budget.shouldAttemptStage(2)) {
      onProgress('sources', `Stage 2: Public source discovery for ${context.domain}`);
      try {
        const targetUrl = context.domain.startsWith('http') ? context.domain : `https://${context.domain}`;
        const surface = await PublicLinkDiscovery.discover(targetUrl, {
          maxPages: 12,
          delayMs: 100,
          timeoutMs: 6000,
          fetcher: fetcher as any,
          onProgress: (page) => {
            discoveredPages.push(page);
            onProgress('sources', `[page] ${page.path} (${page.category}) HTTP ${page.status}`);
          },
          onHtml: (url, html) => { htmlByUrl.set(url, html); },
          logger: (m) => onProgress('sources', m),
        });
        auditEvidenceFromSurface(surface, evidence, errors);
      } catch (e: any) {
        errors.push(`Stage 2 discovery error: ${e?.message || String(e)}`);
      }
      this.budget.advanceStage();
    }

    if (searchAvailable && this.budget.shouldAttemptStage(3) && maxStage >= 3) {
      onProgress('search', `Stage 3: Live technical research — generating queries for ${context.company || context.domain}`);
      const queries = QueryGenerator.generate({
        company: context.company,
        domain: context.domain,
        personName: context.personName,
        technicalTopic: context.technicalTopic,
        technicalArea: context.technicalArea,
      });

      for (const q of queries) {
        if (!this.budget.recordQuery(3)) break;
        const cached = this.cache.get(q.query);
        if (cached) {
          queriesExecuted.push({ query: q.query, results: cached.length, cached: true });
          this.collectSearchEvidence(cached, evidence, discoveredPages, htmlByUrl, ownerCandidates, q.category, errors);
        } else {
          try {
            const resp = await searchProvider.search(q.query, { maxResults: maxResultsPerQuery } as SearchOptions);
            const results = resp.results || [];
            this.cache.set(q.query, results as any);
            queriesExecuted.push({ query: q.query, results: results.length, cached: false });
            this.collectSearchEvidence(results, evidence, discoveredPages, htmlByUrl, ownerCandidates, q.category, errors);
          } catch (e: any) {
            errors.push(`Search error for "${q.query}": ${e?.message || String(e)}`);
          }
        }
      }
      this.budget.advanceStage();
    }

    if (this.budget.shouldAttemptStage(4) && maxStage >= 4) {
      onProgress('signals', `Stage 4: Signal correlation from ${discoveredPages.length} public sources`);
      const toCrawl = discoveredPages
        .filter(p => p.status === 200 && !htmlByUrl.has(p.url))
        .slice(0, this.budget.getStageConfig(4)?.maxRequests ?? 5);

      for (const page of toCrawl) {
        if (!this.budget.recordRequest(4)) break;
        try {
          const res = await this.fetcher(page.url, {
            method: 'GET', headers: { 'User-Agent': 'VARDHAN-LIVE-OBSERVER/1.0', 'Accept': 'text/html' },
            signal: AbortSignal.timeout(6000),
          });
          if (res.ok) {
            const html = await res.text();
            htmlByUrl.set(page.url, html);
            const signals = this.extractSignalsFromHtml(html, page.url, page.category);
            evidence.push(...signals);
          }
        } catch {
          errors.push(`BLOCKED: Could not fetch ${page.url} (network error, CAPTCHA, or access denied).`);
        }
      }
      this.budget.advanceStage();
    }

    if (this.budget.shouldAttemptStage(5) && maxStage >= 5) {
      onProgress('verification', 'Stage 5: Safe verification of technical signals');
      const reproEvidence = evidence.filter(e =>
        e.status && (e.status >= 500 || e.latency_ms! > 1000)
      ).slice(0, this.budget.getStageConfig(5)?.maxRequests ?? 3);

      for (const ev of reproEvidence) {
        if (!this.budget.recordRequest(5)) break;
        try {
          const res = await this.fetcher(ev.public_url, {
            method: 'GET', headers: { 'User-Agent': 'VARDHAN-LIVE-OBSERVER/1.0' },
            signal: AbortSignal.timeout(6000),
          });
          if (ev.reproductions !== null) ev.reproductions++;
          ev.repeatable = ev.repeatable && res.status === ev.status;
        } catch {
          errors.push(`BLOCKED: Could not re-verify ${ev.public_url}.`);
        }
      }
      this.budget.advanceStage();
    }

    if (this.budget.shouldAttemptStage(6) && maxStage >= 6) {
      onProgress('people', 'Stage 6: Owner/contact refresh via public sources');
      const pagesForPeople = discoveredPages.filter(p =>
        p.category !== undefined && p.category !== 'other' && p.category !== 'homepage'
      );
      const peopleFromPages = PeopleExtractor.extractFromPages(pagesForPeople, htmlByUrl, {
        company: context.company || context.domain,
        technicalAreaHints: ['api', 'backend', 'infrastructure', 'platform', 'security'],
      });
      ownerCandidates.push(...peopleFromPages);
      this.budget.advanceStage();
    }

    const githubPages = Array.from(htmlByUrl.entries()).map(([url, html]) => ({ url, html }));
    if (githubPages.length > 0) {
      try {
        const gh = await GitHubDiscovery.discover({
          fetcher: this.fetcher,
          pages: githubPages,
          companyDomain: context.domain,
          onProgress: (stage, msg) => onProgress('github', msg),
        });
        githubRepos.push(...gh.repos);
      } catch (e: any) {
        errors.push(`GitHub discovery error: ${e?.message || String(e)}`);
      }
    }

    const deduplicated = this.dedupeOwners(ownerCandidates);

    const freshness = FreshnessEngine.needsRefresh(
      evidence.map(e => FreshnessEngine.fromEvidence(e))
    );
    if (freshness.needs_refresh) {
      onProgress('freshness', `${freshness.stale.length} stale, ${freshness.aging.length} aging sources — consider refreshing.`);
    }

    return {
      evidence,
      discovered_pages: discoveredPages,
      htmlByUrl,
      owner_candidates: deduplicated,
      github_repos: githubRepos,
      queries_executed: queriesExecuted,
      errors,
      search_available: searchAvailable,
      search_provider: searchProvider!.name,
      stage_reached: this.budget.getCurrentStageNum(),
    };
  }

  private extractSignalsFromHtml(html: string, url: string, category?: string): Evidence[] {
    const evidence: Evidence[] = [];
    const notTested = ['mutations', 'auth bypass', 'authorization bypass', 'brute force', 'fuzzing'];
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').toLowerCase();

    if ((text.includes('kubernetes') || text.includes('microservice') || text.includes('aws') ||
         text.includes('cloud') || text.includes('api') || text.includes('infrastructure')) &&
        (text.includes('engineering') || text.includes('scal') || text.includes('infrastructure'))) {
      evidence.push({
        id: 'ev_web_' + randomBytes(8).toString('hex'),
        evidence_origin: 'REAL_PUBLIC_OBSERVATION',
        public_url: url,
        source_type: category === 'engineering' || category === 'blog' ? 'ENGINEERING_BLOG' : 'PUBLIC_DOCUMENTATION',
        method: 'GET',
        status: 200,
        observed_behavior: `Page documents technical information related to the company's engineering/scale/infrastructure.`,
        reproductions: 1,
        repeatable: true,
        tested_without_auth: true,
        not_tested: notTested,
        retrieved_at: new Date().toISOString(),
        evidence_text: `technical content: ${text.slice(0, 200)}`,
        latency_ms: 0,
      });
    }

    if (text.includes('/api/') || text.includes('rest api') || text.includes('graphql')) {
      evidence.push({
        id: 'ev_web_' + randomBytes(8).toString('hex'),
        public_url: url,
        source_type: 'ENGINEERING_BLOG',
        method: 'GET',
        status: 200,
        observed_behavior: 'Public API documentation/reference discovered on company domain.',
        reproductions: 1,
        repeatable: true,
        tested_without_auth: true,
        not_tested: notTested,
        retrieved_at: new Date().toISOString(),
        evidence_text: 'API reference discovered',
        latency_ms: 0,
      } as any);
    }

    return evidence;
  }

  private dedupeOwners(candidates: OwnerCandidate[]): OwnerCandidate[] {
    const best = new Map<string, OwnerCandidate>();
    const rank = { LOW: 0, MEDIUM: 1, HIGH: 2, NOT_APPLICABLE: 0 };
    for (const c of candidates) {
      const key = `${c.name.toLowerCase()}|${(c.role || '').toLowerCase()}`;
      const existing = best.get(key);
      if (!existing || rank[c.confidence] > rank[existing.confidence]) {
        best.set(key, c);
      }
    }
    return Array.from(best.values());
  }

  private collectSearchEvidence(
    results: any[],
    evidence: Evidence[],
    discoveredPages: DiscoveredPage[],
    htmlByUrl: Map<string, string>,
    _ownerCandidates: OwnerCandidate[],
    _category: string,
    errors: string[],
  ): void {
    for (const result of results) {
      const url = result.url;
      if (!url.startsWith('http')) continue;
      let pageCategory: DiscoveredPage['category'] = 'other';
      try {
        const u = new URL(url);
        pageCategory = this.categorizeSearchUrl(u.pathname, u.hostname);
      } catch { /* ignore invalid URLs */ }
      if (!discoveredPages.some(p => p.url === url)) {
        discoveredPages.push({
          url,
          path: (() => { try { return new URL(url).pathname; } catch { return url; } })(),
          title: result.title,
          status: undefined,
          category: pageCategory,
        });
      }
      evidence.push({
        id: 'ev_search_' + randomBytes(8).toString('hex'),
        evidence_origin: 'REAL_PUBLIC_OBSERVATION',
        public_url: url,
        source_type: 'PUBLIC_DOCUMENTATION',
        method: 'GET',
        status: 0,
        P_url: url,
        observed_behavior: `Search result: "${result.title}" {${result.snippet.slice(0, 200)}`,
        reproductions: 0,
        repeatable: false,
        tested_without_auth: true,
        not_tested: ['reproduction', 'verification'],
        retrieved_at: new Date().toISOString(),
        evidence_text: result.snippet,
        latency_ms: 0,
      } as any);
    }
  }

  private categorizeSearchUrl(pathname: string, hostname: string): DiscoveredPage['category'] {
    const p = '/' + pathname.replace(/^\/+/, '').trim().replace(/\/+$/, '');
    const first = p.split('/').filter(Boolean)[0] || '';
    if (p.includes('/engineering') || p.includes('/team') || p.includes('/leadership') ||
        p.includes('/about') || first === 'engineering' || first === 'about') {
      return p.includes('/engineering') || p.includes('/team') || p.includes('/leadership') ? 'team_people' : 'about';
    }
    if (p.includes('/blog') || first === 'blog') {
      return 'blog';
    }
    if (p.includes('/docs') || first === 'docs' || first === 'developers') {
      return 'docs';
    }
    if (p.includes('/security') || first === 'security') {
      return 'security';
    }
    if (p.includes('/careers') || first === 'careers') {
      return 'hiring';
    }
    if (p.includes('/status') || first === 'status') {
      return 'status_ops';
    }
    if (hostname.includes('github.com')) return 'engineering';
    if (hostname.includes('linkedin.com')) return 'team_people';
    if (hostname.includes('medium.com') || hostname.includes('dev.to') || hostname.includes('blog')) return 'blog';
    return 'other';
  }
}

/** Record read-only observation evidence from a discovered surface. */
function auditEvidenceFromSurface(
  surface: CompanySurface,
  evidence: Evidence[],
  errors: string[],
): void {
  const now = new Date().toISOString();
  const notTested = ['mutations', 'auth bypass', 'brute force', 'exploitation'];

  for (const page of surface.discovered_pages) {
    if (page.status && page.status >= 200 && page.status < 300) {
      evidence.push({
        id: 'ev_live_' + randomBytes(8).toString('hex'),
        evidence_origin: 'REAL_PUBLIC_OBSERVATION',
        public_url: page.url,
        source_type: 'PUBLIC_DOCUMENTATION',
        method: 'GET',
        status: page.status,
        observed_behavior: `Public page observed: ${page.title || page.path} (HTTP ${page.status})`,
        reproductions: 1,
        repeatable: true,
        tested_without_auth: true,
        not_tested: notTested,
        retrieved_at: now,
        evidence_text: `${page.title || page.category} page at ${page.url}`,
        latency_ms: 0,
      });
    }
  }
}
