import {
  IntelligenceCase,
  Evidence,
  SourceType,
  Provenance,
  EvidenceClassification,
  SourceState,
  HttpFetcher
} from './IntelligenceCase';
import { LivePublicObservationProvider } from './LivePublicObservationProvider';
import { TargetedSearchProvider } from './providers/TargetedSearchProvider';
import { ResearchBudget } from './ResearchBudget';
import { GitHubWebProvider } from './providers/GitHubWebProvider';

export interface DiscoveryURL {
  url: string;
  mechanism: Provenance['discovery_mechanism'];
  type: SourceType;
  attribution: string;
}

export interface DiscoveredSource {
  source_id: string;
  kind: string;
  url: string;
  title: string | null;
  tier: number;
  discovered_via: string;
  relationship: 'OFFICIAL' | 'LINKED' | 'DISCOVERED' | 'LIKELY' | 'VERIFIED';
  confidence: number;
  provenance: string;
  freshness: any;
  html: string | null;
  status: number | null;
  blocked: boolean;
  error: string | null;
}

export interface SourceDiscoveryOptions {
  fetcher?: HttpFetcher;
  searchProvider?: any;
  maxSources?: number;
  companyName: string;
  domain: string;
  seedUrls?: string[];
  onProgress?: (stage: string, message: string) => void;
}

export interface SourceDiscoveryResult {
  sources: DiscoveredSource[];
  htmlByUrl: Map<string, string>;
  evidence: Evidence[];
  errors: string[];
  blockedSources: DiscoveredSource[];
}

export class SourceDiscoveryOrchestrator {
  private githubWeb = new GitHubWebProvider();

  /**
   * Static entry point for source discovery. Creates a minimal orchestrator
   * instance and delegates to discoverTechnicalSurfaces.
   */
  static async discover(options: SourceDiscoveryOptions): Promise<SourceDiscoveryResult> {
    const { companyName, domain, seedUrls = [], maxSources = 40, onProgress = () => {} } = options;
    const fetcher = options.fetcher || (globalThis.fetch as any);
    const observationProvider = new LivePublicObservationProvider({ fetcher, maxRequests: maxSources });
    const searchProvider = new TargetedSearchProvider();
    const budget = new ResearchBudget();
    const orch = new SourceDiscoveryOrchestrator(observationProvider, searchProvider, budget);

    onProgress('discovery', `Starting source discovery for ${companyName} (${domain})`);

    const caseState: IntelligenceCase = {
      company: companyName,
      domain,
      company_surface: { company: companyName, origin: domain, company_homepage: `https://${domain}`, homepage: `https://${domain}`, discovered_pages: [], page_categories: {} },
    } as any;

    const result = await orch.discoverTechnicalSurfaces(caseState);

    return {
      sources: [],
      htmlByUrl: new Map(),
      evidence: result.newEvidence,
      errors: [],
      blockedSources: [],
    };
  }

  constructor(
    private observationProvider: LivePublicObservationProvider,
    private searchProvider: TargetedSearchProvider,
    private budget: ResearchBudget
  ) {}

  /**
   * The core "Truth Hunt" sequence.
   * Discovery (Search/Sitemap) -> Evaluation (Fetch) -> Promotion (Evidence).
   */
  async discoverTechnicalSurfaces(caseState: IntelligenceCase): Promise<{
    newEvidence: Evidence[];
    discoveryResults: { url: string; status: SourceState }[];
  }> {
    const discoveredUrls: DiscoveryURL[] = [];
    const newEvidence: Evidence[] = [];
    const discoveryResults: { url: string; status: SourceState }[] = [];

    // 1. Positive Discovery via Sitemaps & Robots.txt
    const origin = caseState.company_surface?.origin || '';
    if (origin) {
      const sitemapUrls = await this.discoverFromSitemap(`https://${origin}/sitemap.xml`);
      discoveredUrls.push(...sitemapUrls);

      const robotsUrls = await this.discoverFromRobots(`https://${origin}/robots.txt`);
      discoveredUrls.push(...robotsUrls);
    }

    // 2. GitHub Web Surface Discovery
    const ghSurfaces = await this.githubWeb.discoverPublicSurfaces(caseState.company, origin);
    for (const gh of ghSurfaces) {
      discoveredUrls.push({
        url: gh.url,
        mechanism: 'GITHUB_WEB_DISCOVERY',
        type: 'GITHUB',
        attribution: `GitHub Web: ${gh.type}`
      });
    }

    // 3. Search as Discovery (Pointers only)
    const searchQueries = [
      `site:${origin} "api"`,
      `site:${origin} "docs"`,
      `site:${origin} "status"`,
      `site:github.com "${caseState.company}"`,
      `site:stackoverflow.com "${caseState.company}"`
    ];

    for (const query of searchQueries) {
      if (!this.budget.checkAndConsume('QUERY', 'search', caseState)) break;

      const searchResult = await this.searchProvider.discoverSource(caseState.company, caseState.company_surface?.origin || '', 'BROAD');
      for (const url of (searchResult.results || [])) {
        discoveredUrls.push({
          url,
          mechanism: 'SEARCH',
          type: this.inferSourceType(url),
          attribution: `Search Query: ${query}`
        });
      }
    }

    // 4. The "Fetch-and-Verify" Gate
    // No search snippet becomes evidence without a successful fetch.
    for (const item of discoveredUrls) {
      if (!this.budget.checkAndConsume('PAGE', 'web_fetch', caseState)) break;

      try {
        const observation = await this.observationProvider.observePublicSurface(item.url);

        // Only promote to Evidence if we actually got content (Success/Empty)
        // If RATE_LIMITED or ERROR, we record the state but don't create Evidence
        if (observation.evidence.length > 0) {
          const enrichedEvidence = observation.evidence.map(ev => ({
            ...ev,
            provenance: {
              source_url: item.url,
              canonical_url: item.url, // Simplified
              source_type: item.type,
              discovery_mechanism: item.mechanism,
              retrieval_timestamp: new Date().toISOString(),
              provider: 'LivePublicObservationProvider',
              attribution: item.attribution,
              classification: this.classifyEvidence(ev)
            }
          }));
          newEvidence.push(...enrichedEvidence);
          discoveryResults.push({ url: item.url, status: 'SUCCESS' });
        } else {
          discoveryResults.push({ url: item.url, status: 'EMPTY' });
        }
      } catch (e) {
        discoveryResults.push({ url: item.url, status: 'ERROR' });
      }
    }

    return { newEvidence, discoveryResults };
  }

  private async discoverFromSitemap(url: string): Promise<DiscoveryURL[]> {
    try {
      const res = await this.observationProvider.observePublicSurface(url);
      // Simple regex for <loc> tags in sitemap
      const locs = res.evidence[0]?.raw_observation?.match(/<loc>(.*?)<\/loc>/g) || [];
      return locs.map(loc => ({
        url: loc.replace(/<\/?loc>/g, ''),
        mechanism: 'SITEMAP',
        type: 'PUBLIC_DOCUMENTATION',
        attribution: 'Found in sitemap.xml'
      }));
    } catch {
      return [];
    }
  }

  private async discoverFromRobots(url: string): Promise<DiscoveryURL[]> {
    try {
      const res = await this.observationProvider.observePublicSurface(url);
      const lines = res.evidence[0]?.raw_observation?.split('\\n') || [];
      const paths = lines.filter(l => l.startsWith('Disallow:') || l.startsWith('Allow:')).map(l => l.split(': ')[1]);
      return paths.map(p => ({
        url: `https://${url.split('/')[2]}${p}`,
        mechanism: 'ROBOTS',
        type: 'OTHER_PUBLIC_SOURCE' as SourceType,
        attribution: 'Found in robots.txt'
      }));
    } catch {
      return [];
    }
  }

  private inferSourceType(url: string): SourceType {
    if (url.includes('github.com')) return 'GITHUB';
    if (url.includes('stackoverflow.com')) return 'OTHER_PUBLIC_SOURCE';
    if (url.includes('status')) return 'STATUS_PAGE';
    if (url.includes('docs')) return 'PUBLIC_DOCUMENTATION';
    return 'OTHER_PUBLIC_SOURCE';
  }

  private classifyEvidence(ev: any): EvidenceClassification {
    const text = (ev.raw_observation || '').toLowerCase();
    if (ev.status && ev.status !== 200) return 'OBSERVATION';
    if (text.includes('issue') || text.includes('forum') || text.includes('discussion')) return 'DISCUSSION';
    if (text.length > 1000 && (text.includes('guide') || text.includes('documentation'))) return 'DOCUMENT';
    return 'OBSERVATION';
  }
}
