import { CompanyDataProvider } from './ProviderInterface';
import { IntelligenceCase, Evidence } from '../IntelligenceCase';
import { WebSearchProviderManager, SearchProvider, PublicWebSearchProvider, SerperSearchProvider } from '../WebSearchProvider';
import { GitHubProvider } from './GitHubProvider';

export class TargetedSearchProvider {
  private searchManager: WebSearchProviderManager;
  private ghProvider: GitHubProvider;

  constructor() {
    const providers: SearchProvider[] = [];
    const serper = new SerperSearchProvider();
    if (serper.available) {
      providers.push(serper);
    }
    providers.push(new PublicWebSearchProvider());
    this.searchManager = new WebSearchProviderManager(providers);
    this.ghProvider = new GitHubProvider();
  }

  public async discoverSource(company: string, domain: string, type: 'GITHUB' | 'BLOG' | 'STATUS' | 'JOBS' | 'DOCS' | 'CHANGELOG' | 'SECURITY' | 'NEWS' | 'COMMUNITY' | 'BROAD'): Promise<{ results: string[], failureReason?: string }> {
    if (type === 'GITHUB') {
      const org = await this.ghProvider.resolveOrg(company, domain);
      if (org) {
        return { results: [org.html_url] };
      }
    }

    const queryFamilies = this.getQueryFamilies(type, company, domain);
    const allResults = new Set<string>();
    let lastFailure: string | undefined;

    for (const query of queryFamilies) {
      try {
        const searchResponse = await this.searchManager.search(query);
        if (searchResponse && searchResponse.results && searchResponse.results.length > 0) {
          searchResponse.results.forEach(res => allResults.add(res.url));
        } else if (searchResponse?.failureReason) {
          lastFailure = searchResponse.failureReason;
        }
      } catch (e) {
        lastFailure = 'SEARCH_NETWORK_ERROR';
      }
    }

    return {
      results: Array.from(allResults),
      failureReason: allResults.size > 0 ? undefined : lastFailure
    };
  }

  private getQueryFamilies(type: string, company: string, domain: string): string[] {
    const families: Record<string, string[]> = {
      'GITHUB': [`${company} github`, `site:github.com ${company}`, `${domain} github`],
      'BLOG': [`${company} engineering blog`, `${company} tech blog`, `site:${domain} blog engineering`],
      'STATUS': [`${company} status page`, `${company} system status`, `site:${domain} status`],
      'JOBS': [`${company} platform engineering jobs`, `${company} SRE jobs`],
      'DOCS': [`${company} developer documentation`, `site:${domain} docs`],
      'CHANGELOG': [`${company} changelog`, `site:${domain} changelog`],
      'SECURITY': [`${company} security policy`, `site:${domain} security`],
      'BROAD': [`${company} engineering`, `site:${domain} engineering`],
      'NEWS': [`${company} technical news`, `site:${domain} news`],
      'COMMUNITY': [`${company} community forum`, `${company} discord`],
    };
    return families[type] || [`${company} ${type}`];
  }

  public async observePublicSurface(url: string): Promise<{ evidence: Evidence[], discovery_errors: number }> {
    try {
      // Delegate to the existing real public observation provider logic
      // Since we are inside a provider, we use a shared instance or instantiate a temporary one
      // In a real production setup, this would be injected, but for the repair we use the known good provider.
      const provider = new (require('../LivePublicObservationProvider').LivePublicObservationProvider)();
      return await provider.observePublicSurface(url);
    } catch (e) {
      return { evidence: [], discovery_errors: 1 };
    }
  }
}
