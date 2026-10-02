// GitHubDiscovery.ts
// -------------------
// Finds GitHub activity that the company itself links to from its public pages.
// Never guesses an org name: an org/repo is only discovered if a github.com/<org>
// link is present on a page the company publishes. Uses the unauthenticated
// GitHub REST API (60 req/hr) and is rate-limit aware.

import type { GithubRepoMeta } from './DeepTypes';
import type { HttpFetcher } from './IntelligenceCase';

export interface GitHubDiscoveryOptions {
  fetcher: HttpFetcher;
  /** Company pages (URL -> HTML) to scan for github links. */
  pages: Array<{ url: string; html: string }>;
  /** Extra candidate pages to crawl for links (e.g. /about, /team, /contact). */
  crawlPaths?: string[];
  /** Company's official domain (for same-origin link scoping). */
  companyDomain?: string;
  onProgress?: (stage: string, message: string) => void;
  signal?: AbortSignal;
}

export interface GitHubDiscoveryResult {
  repos: GithubRepoMeta[];
  rate_limited: boolean;
  scanned_pages: number;
  errors: string[];
}

const GITHUB_REPO_RE = /https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)(?:\/|$|\?[^\s"]*|#)|https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9._-]+)\/(?:$|[^\s<"]+)/gi;
const GITHUB_ORG_RE = /https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9._-]+)(?=\/|$|\s|<|"|\)|,)/gi;

export class GitHubDiscovery {
  static async discover(opts: GitHubDiscoveryOptions): Promise<GitHubDiscoveryResult> {
    const { fetcher } = opts;
    const errors: string[] = [];
    const foundOrgs = new Map<string, string>(); // org -> discovered_via page url

    const pages = opts.pages || [];
    for (const page of pages) {
      const html = page.html || '';
      let m: RegExpExecArray | null;
      // Org/repo links first (most specific).
      const repoRe = new RegExp(GITHUB_REPO_RE);
      while ((m = repoRe.exec(html)) !== null) {
        const org = (m[1] || m[3])?.toLowerCase();
        const repo = m[2];
        if (org && repo) foundOrgs.set(org, page.url);
      }
      // Bare org links.
      const orgRe = new RegExp(GITHUB_ORG_RE);
      while ((m = orgRe.exec(html)) !== null) {
        const org = m[1]?.toLowerCase();
        if (org) foundOrgs.set(org, page.url);
      }
    }

    const repos: GithubRepoMeta[] = [];
    let rateLimited = false;
    let remaining = 60;
    opts.onProgress?.('github', `Found ${foundOrgs.size} public GitHub link(s) on company pages.`);

    for (const org of Array.from(foundOrgs.keys())) {
      if (remaining <= 0) { rateLimited = true; opts.onProgress?.('github', `GitHub rate limit reached (${remaining} remaining); stopping.`); break; }
      try {
        const res = await fetcher(`https://api.github.com/orgs/${org}/repos?per_page=100&type=public`, {
          method: 'GET',
          headers: { accept: 'application/vnd.github+json', 'user-agent': 'vardhan-discovery' },
          signal: opts.signal || AbortSignal.timeout(8000),
        });
        // `res.headers` may be a real Headers object (use .get) or a plain
        // record (mock fetchers). Bracket access on a Headers object returns
        // undefined, so probe correctly before reading the rate-limit header.
        const rh = typeof (res.headers as any)?.get === 'function'
          ? (res.headers as any).get('x-ratelimit-remaining')
          : (res.headers as any)?.['x-ratelimit-remaining'];
        const parsed = typeof rh === 'string' ? parseInt(rh, 10) : NaN;
        remaining = Number.isNaN(parsed) ? remaining : parsed;
        if (res.status === 403 && remaining === 0) { rateLimited = true; opts.onProgress?.('github', `Rate limited for org ${org}.`); break; }
        if (!res.ok) { errors.push(`github api ${res.status} for ${org}`); continue; }
        const list = await res.json() as GitHubRepo[];
        for (const r of list) {
          repos.push({
            org,
            repo: r.name,
            url: r.html_url || `https://github.com/${org}/${r.name}`,
            discovered_via: foundOrgs.get(org) || '',
            stars: r.stargazers_count ?? null,
            language: r.language ?? null,
            description: r.description ?? null,
            updated_at: r.updated_at ?? null,
          });
        }
        opts.onProgress?.('github', `GitHub org ${org}: ${list.length} public repo(s).`);
      } catch (e: any) {
        errors.push(`github fetch ${org}: ${e?.message || String(e)}`);
      }
    }

    return { repos, rate_limited: rateLimited, scanned_pages: pages.length, errors };
  }
}

interface GitHubRepo {
  name: string;
  html_url?: string;
  stargazers_count?: number;
  language?: string | null;
  description?: string | null;
  updated_at?: string | null;
}
