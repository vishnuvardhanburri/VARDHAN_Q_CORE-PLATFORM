import { Evidence, IntelligenceCase } from '../IntelligenceCase';

export enum GitHubWebSourceType {
  REPOSITORY = 'REPOSITORY',
  ISSUE = 'ISSUE',
  PULL_REQUEST = 'PULL_REQUEST',
  RELEASE = 'RELEASE',
  README = 'README'
}

export interface GitHubWebDiscovery {
  url: string;
  type: GitHubWebSourceType;
  title?: string;
  description?: string;
}

/**
 * GitHubWebProvider treats GitHub as a public web surface.
 * It focuses on discovering public URLs that can be fetched and analyzed
 * as standard HTML pages by the LivePublicObservationProvider.
 */
export class GitHubWebProvider {
  readonly name = 'GitHubWebProvider';

  /**
   * Discovery logic for GitHub public surfaces.
   * This is used as a pointer generator for the SourceDiscoveryOrchestrator.
   */
  async discoverPublicSurfaces(companyName: string, domain: string): Promise<GitHubWebDiscovery[]> {
    // Note: In a full implementation, this would use search discovery (site:github.com)
    // or a lightweight web crawl of the org page.
    // For now, it serves as a placeholder for the la-mode architecture.

    console.log(`[GITHUB_WEB] Discovering public surfaces for ${companyName}...`);

    // This is a discovery signal, not evidence.
    // The orchestrator will take these URLs and fetch them.
    return [];
  }

  /**
   * Helper to classify a GitHub URL into a source type.
   */
  classifyUrl(url: string): GitHubWebSourceType | null {
    if (url.includes('/releases')) return GitHubWebSourceType.RELEASE;
    if (url.includes('/issues')) return GitHubWebSourceType.ISSUE;
    if (url.includes('/pull')) return GitHubWebSourceType.PULL_REQUEST;
    if (url.endsWith('/blob/main/README.md') || url.endsWith('/blob/master/README.md')) return GitHubWebSourceType.README;
    if (url.match(/\.com\/[^\/]+\/[^\/]+$/)) return GitHubWebSourceType.REPOSITORY;
    return null;
  }
}
