import { CompanyDataProvider } from './ProviderInterface';
import { IntelligenceCase, Evidence } from '../IntelligenceCase';

export enum GitHubProviderStatus {
  SUCCESS = 'SUCCESS',
  UNAUTHENTICATED = 'UNAUTHENTICATED',
  AUTHENTICATED = 'AUTHENTICATED',
  RATE_LIMITED = 'RATE_LIMITED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  NETWORK_ERROR = 'NETWORK_ERROR',
  PARSE_ERROR = 'PARSE_ERROR',
  EMPTY = 'EMPTY'
}

export class GitHubApiError extends Error {
  constructor(public status: GitHubProviderStatus, message: string) {
    super(message);
    this.name = 'GitHubApiError';
  }
}

export interface GitHubOrgResolution {
  login: string;
  html_url: string;
  verified: boolean;
  confidence: number;
  evidence: Evidence[];
  reason: string;
  state: 'VERIFIED' | 'PROBABLE' | 'AMBIGUOUS' | 'NOT_FOUND';
}

export interface GitHubRepoInfo {
  name: string;
  full_name: string;
  html_url: string;
  description: string;
  stargazers_count: number;
  updated_at: string;
  language: string;
  intelligence_score: number;
  score_breakdown: Record<string, number>;
}

export class GitHubProvider {
  readonly name = 'GitHubProvider';
  private token?: string;
  private currentStatus: GitHubProviderStatus = GitHubProviderStatus.UNAUTHENTICATED;

  constructor() {
    this.token = process.env.GITHUB_TOKEN;
    if (this.token) this.currentStatus = GitHubProviderStatus.AUTHENTICATED;
  }

  getStatus(): GitHubProviderStatus {
    return this.currentStatus;
  }

  private async request(endpoint: string, params: Record<string, string | number> = {}): Promise<any> {
    const query = new URLSearchParams(params as Record<string, string>).toString();
    const url = `https://api.github.com${endpoint}${query ? `?${query}` : ''}`;
    
    // DEBUG LOGGING
    console.log(`[GH-API-REQ] ${url}`);

    const res = await fetch(url, {
      headers: {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'VARDHAN-Intelligence-Engine',
        ...(this.token ? { 'Authorization': `token ${this.token}` } : {}),
      },
    });

    const limit = res.headers.get('x-ratelimit-limit');
    const remaining = res.headers.get('x-ratelimit-remaining');
    const reset = res.headers.get('x-ratelimit-reset');

    if (res.status === 403 && remaining === '0') {
      this.currentStatus = GitHubProviderStatus.RATE_LIMITED;
      throw new GitHubApiError(GitHubProviderStatus.RATE_LIMITED, `GitHub Rate Limit Exceeded. Resets at ${reset}`);
    }
    if (res.status === 403) {
      this.currentStatus = GitHubProviderStatus.FORBIDDEN;
      throw new GitHubApiError(GitHubProviderStatus.FORBIDDEN, `GitHub Access Forbidden`);
    }
    if (res.status === 404) {
      this.currentStatus = GitHubProviderStatus.NOT_FOUND;
      return null;
    }

    if (!res.ok) {
      this.currentStatus = GitHubProviderStatus.NETWORK_ERROR;
      throw new GitHubApiError(GitHubProviderStatus.NETWORK_ERROR, `GitHub API error: ${res.status} ${res.statusText}`);
    }

    this.currentStatus = this.token ? GitHubProviderStatus.AUTHENTICATED : GitHubProviderStatus.UNAUTHENTICATED;
    return res.json();
  }

  async resolveOrg(companyName: string, domain: string): Promise<GitHubOrgResolution | null> {
    try {
      const searchRes = await this.request('/search/users', { q: companyName, type: 'org' });
      if (!searchRes || !searchRes.items) return null;

      const candidates = searchRes.items;
      for (const cand of candidates) {
        const detail = await this.request(`/orgs/${cand.login}`);
        if (!detail) continue;

        const isVerified = detail.verified;
        const domainMatch = detail.description?.toLowerCase().includes(domain.toLowerCase()) || detail.url === domain;
        
        if (isVerified && domainMatch) {
          return {
            login: cand.login,
            html_url: `https://github.com/${cand.login}`,
            verified: true,
            confidence: 1.0,
            evidence: [{
              id: `ev-gh-org-verified-${cand.login}`,
              evidence_origin: 'REAL_PUBLIC_OBSERVATION',
              public_url: `https://github.com/${cand.login}`,
              source_type: 'GITHUB',
              observed_behavior: 'Organization verified via domain and official metadata',
              retrieved_at: new Date().toISOString(),
              evidence_text: detail.description || '',
              reproductions: 1, repeatable: true, tested_without_auth: true, not_tested: []
            }],
            reason: 'Verified organization match via domain and API metadata',
            state: 'VERIFIED'
          };
        }
        if (isVerified || domainMatch) {
          return {
            login: cand.login,
            html_url: `https://github.com/${cand.login}`,
            verified: false,
            confidence: 0.7,
            evidence: [],
            reason: 'Probable match based on name or partial metadata',
            state: 'PROBABLE'
          };
        }
      }
      return null;
    } catch (e) {
      console.error(`GitHub resolveOrg error: ${e}`);
      return null;
    }
  }

  async discoverRepositories(org: string): Promise<GitHubRepoInfo[]> {
    try {
      const repos = await this.request(`/orgs/${org}/repos`, { sort: 'updated', per_page: 100 });
      if (!repos) return [];

      return repos.map((r: any) => {
        const score = this.calculateRepoScore(r);
        return {
          name: r.name,
          full_name: r.full_name,
          html_url: r.html_url,
          description: r.description,
          stargazers_count: r.stargazers_count,
          updated_at: r.updated_at,
          language: r.language,
          intelligence_score: score.total,
          score_breakdown: score.breakdown
        };
      }).sort((a: any, b: any) => b.intelligence_score - a.intelligence_score);
    } catch (e) {
      console.error(`GitHub discoverRepositories error: ${e}`);
      return [];
    }
  }

  private calculateRepoScore(repo: any): { total: number, breakdown: Record<string, number> } {
    const breakdown: Record<string, number> = { activity: 0, importance: 0, relevance: 0 };
    const lastUpdate = new Date(repo.updated_at).getTime();
    const daysSince = (Date.now() - lastUpdate) / (1000 * 60 * 60 * 24);
    breakdown.activity = daysSince < 30 ? 50 : daysSince < 180 ? 20 : 0;
    breakdown.importance = Math.min(repo.stargazers_count / 100, 30);
    const name = repo.name.toLowerCase();
    if (name.includes('infra') || name.includes('platform') || name.includes('core') || name.includes('api')) {
      breakdown.relevance = 20;
    }
    return { total: breakdown.activity + breakdown.importance + breakdown.relevance, breakdown };
  }

  async observeRepository(owner: string, repo: string, prevCase?: IntelligenceCase): Promise<{ evidence: Evidence[], metrics: any }> {
    const evidence: Evidence[] = [];
    const metrics: any = { commit_count: 0, release_count: 0, temporal_deltas: [] as any[] };
    
    try {
      const commits = await this.request(`/repos/${owner}/${repo}/commits`, { per_page: 30 });
      if (commits) {
        metrics.commit_count = commits.length;
        for (const c of commits) {
          evidence.push({
            id: `ev-gh-commit-${c.sha.slice(0,7)}`,
            evidence_origin: 'REAL_PUBLIC_OBSERVATION',
            public_url: c.html_url,
            source_type: 'GITHUB',
            observed_behavior: `Commit ${c.commit.message} by ${c.commit.author.name}`,
            retrieved_at: new Date().toISOString(),
            evidence_text: c.commit.message,
            reproductions: 1, repeatable: true, tested_without_auth: true, not_tested: []
          });
        }
      }

      const releases = await this.request(`/repos/${owner}/${repo}/releases`);
      if (releases) {
        metrics.release_count = releases.length;
        for (const r of releases) {
          evidence.push({
            id: `ev-gh-rel-${r.id}`,
            evidence_origin: 'REAL_PUBLIC_OBSERVATION',
            public_url: r.html_url,
            source_type: 'GITHUB',
            observed_behavior: `Release ${r.tag_name}: ${r.name}`,
            retrieved_at: new Date().toISOString(),
            evidence_text: r.body,
            reproductions: 1, repeatable: true, tested_without_auth: true, not_tested: []
          });
        }
      }

      if (prevCase?.github_memory?.repositories?.[repo]) {
        const prev = prevCase.github_memory.repositories[repo];
        const delta = metrics.commit_count - (prev.activity_score || 0);
        metrics.temporal_deltas.push({
          metric: 'commit_delta',
          value: delta,
          type: delta > 0 ? 'ACCELERATION' : delta < 0 ? 'DECLINE' : 'STABLE'
        });
      }

    } catch (e) {
      console.error(`GitHub observeRepository error: ${e}`);
    }

    return { evidence, metrics };
  }
}
