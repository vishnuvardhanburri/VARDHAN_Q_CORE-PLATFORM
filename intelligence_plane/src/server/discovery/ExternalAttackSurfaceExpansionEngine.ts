import { VardhanSystemManager } from '../system/VardhanSystemManager';
import { OrganizationIdentityGraph } from './OrganizationIdentityGraph';
import { ExternalSurface, SurfaceType, DiscoveryState, ExpectationSource } from './SurfaceTypes';

export interface ExternalSurfaceInventory {
  organization: string;
  surfaces: Map<string, ExternalSurface>;
  metrics: {
    totalDiscovered: number;
    uniqueSurfaces: number;
    documentedSurfaces: number;
    observedSurfaces: number;
    sourceDiversity: Record<string, number>;
  };
}

export class ExternalAttackSurfaceExpansionEngine {
  constructor(private manager: VardhanSystemManager) {}

  async expandSurfaceInventory(company: string, aliases: any[]): Promise<ExternalSurfaceInventory> {
    const inventory = new Map<string, ExternalSurface>();
    const domains = aliases.map((a: any) => a.alias);
    
    console.log(`[SurfaceExpansion] Expanding attack surface for ${company} across ${domains.length} domains...`);

    for (const domain of domains) {
      const discoveryQueries = [
        `site:${domain} "API"`,
        `site:${domain} "developer"`,
        `site:${domain} "status"`,
        `site:${domain} "login"`,
        `site:${domain} "admin"`,
        `site:${domain} "docs"`,
        `site:${domain} "portal"`,
      ];

      for (const q of discoveryQueries) {
        const results = await this.manager.search(q);
        for (const res of results) {
          const surface = this.classifySurface(res);
          if (surface) {
            const canonicalUrl = this.normalizeUrl(surface.url);
            inventory.set(canonicalUrl, surface);
          }
        }
      }
    }

    const finalSurfaces = Array.from(inventory.values());
    
    return {
      organization: company,
      surfaces: inventory,
      metrics: {
        totalDiscovered: finalSurfaces.length,
        uniqueSurfaces: inventory.size,
        documentedSurfaces: finalSurfaces.filter(s => s.discoveryState === 'DOCUMENTED').length,
        observedSurfaces: finalSurfaces.filter(s => s.discoveryState === 'PUBLICLY_REACHABLE').length,
        sourceDiversity: this.calculateSourceDiversity(finalSurfaces)
      }
    };
  }

  private classifySurface(result: any): ExternalSurface | null {
    const url = result.url;
    const snippet = (result.snippet || '').toLowerCase();
    
    let type: SurfaceType = 'PUBLIC_WEB';
    let state: DiscoveryState = 'SURFACE_DISCOVERED';
    let expSource: ExpectationSource = 'UNKNOWN';

    if (url.includes('api') || snippet.includes('api')) {
      type = 'PUBLIC_API';
      state = 'DOCUMENTED';
      expSource = 'EXPLICIT_DOCUMENTATION';
    } else if (url.includes('login') || url.includes('auth') || snippet.includes('sign in')) {
      type = 'PUBLIC_AUTHENTICATION';
      state = 'SURFACE_DISCOVERED';
      expSource = 'PUBLIC_BEHAVIOR';
    } else if (url.includes('status') || snippet.includes('system health')) {
      type = 'PUBLIC_STATUS';
      state = 'DOCUMENTED';
      expSource = 'EXPLICIT_DOCUMENTATION';
    } else if (url.includes('docs') || snippet.includes('documentation')) {
      type = 'PUBLIC_DOCUMENTATION';
      state = 'DOCUMENTED';
      expSource = 'EXPLICIT_DOCUMENTATION';
    } else if (snippet.includes('admin') || url.includes('admin')) {
      type = 'PUBLIC_ADMIN';
      state = 'SURFACE_DISCOVERED';
      expSource = 'PUBLIC_BEHAVIOR';
    }

    return {
      id: `surf_${Math.random().toString(36).substr(2, 9)}`,
      url: url,
      type: type,
      exposure: 'NONE',
      provenance: 'Public search result',
      sourceUrl: result.url,
      isVerified: false,
      discoveryState: state,
      expectationSource: expSource
    };
  }

  private normalizeUrl(url: string): string {
    try {
      const u = new URL(url);
      return `${u.protocol}//${u.hostname}${u.pathname}`;
    } catch {
      return url;
    }
  }

  private calculateSourceDiversity(surfaces: ExternalSurface[]): Record<string, number> {
    const div: Record<string, number> = {};
    surfaces.forEach(s => {
      div[s.type] = (div[s.type] || 0) + 1;
    });
    return div;
  }
}
