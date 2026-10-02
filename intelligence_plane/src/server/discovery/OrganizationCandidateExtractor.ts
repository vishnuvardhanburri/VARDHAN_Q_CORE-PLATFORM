export interface OrganizationCandidate {
  organizationName: string;
  domain?: string;
  sourceUrl: string;
  sourceType: string;
  discoveryQuery: string;
  discoveryReason: string;
  provenance: string;
}

export class OrganizationCandidateExtractor {
  async extractCandidates(result: any): Promise<OrganizationCandidate[]> {
    // Handle both raw arrays and SearchProviderResponse wrappers
    const results = Array.isArray(result) ? result : (result?.results || []);
    const candidates: OrganizationCandidate[] = [];

    for (const res of results) {
      const text = (res.snippet || '').toLowerCase();
      const url = res.url;

      if (!url) continue;

      try {
        const domain = new URL(url).hostname.replace('www.', '');

        if (this.isOrganizationSurface(text, url)) {
          candidates.push({
            organizationName: this.extractOrgName(text, url),
            domain: domain,
            sourceUrl: url,
            sourceType: this.inferSourceType(url),
            discoveryQuery: 'Autonomous Discovery',
            discoveryReason: 'Technical surface identified',
            provenance: 'Public Web Search'
          });
        }
      } catch (e) {
        continue;
      }
    }

    return candidates;
  }

  private isOrganizationSurface(text: string, url: string): boolean {
    const surfaceKeywords = [
      'engineering', 'blog', 'docs', 'api', 'infrastructure',
      'architecture', 'platform', 'developer', 'scaling', 'status',
      'about', 'company', 'team', 'careers'
    ];

    const hasKeyword = surfaceKeywords.some(k => text.includes(k));
    const hasTechnicalUrl = /blog|docs|api|status|engineering|developer|about/.test(url.toLowerCase());

    return hasKeyword || hasTechnicalUrl;
  }

  private extractOrgName(text: string, url: string): string {
    const domain = new URL(url).hostname.replace('www.', '');
    const parts = domain.split('.');
    if (parts.length < 2) return 'Unknown Org';
    return parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
  }

  private inferSourceType(url: string): string {
    if (url.includes('status')) return 'STATUS_PAGE';
    if (url.includes('docs')) return 'DOCUMENTATION';
    if (url.includes('api')) return 'API_ENDPOINT';
    if (url.includes('blog')) return 'ENGINEERING_BLOG';
    return 'OTHER_PUBLIC_SOURCE';
  }
}
