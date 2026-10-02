import { SurfaceType, ExposureType, ExternalSurface } from './SurfaceTypes';
import { VardhanSystemManager } from '../system/VardhanSystemManager';

export class ExternalSurfaceDiscoveryEngine {
  async discoverSurfaces(aliases: string[], manager: VardhanSystemManager): Promise<ExternalSurface[]> {
    const surfaces: ExternalSurface[] = [];

    for (const domain of aliases) {
      // 1. Discover APIs via official documentation evidence
      const apiResults = await manager.search(`site:${domain} "API documentation" OR "developer portal"`);
      for (const res of apiResults) {
        surfaces.push({
          id: `surf_api_${Math.random().toString(36).substr(2, 9)}`,
          url: res.url,
          type: 'PUBLIC_API',
          exposure: 'PUBLIC_API',
          provenance: 'Official API documentation reference',
          sourceUrl: res.url,
          isVerified: false
        } as any);
      }

      // 2. Discover Auth surfaces
      const authResults = await manager.search(`site:${domain} "login" OR "sign-in" OR "SSO"`);
      for (const res of authResults) {
        if (res.url.includes('login') || res.url.includes('auth')) {
          surfaces.push({
            id: `surf_auth_${Math.random().toString(36).substr(2, 9)}`,
            url: res.url,
            type: 'PUBLIC_AUTHENTICATION',
            exposure: 'PUBLIC_AUTH_SURFACE',
            provenance: 'Publicly reachable authentication entry',
            sourceUrl: res.url,
            isVerified: false
          } as any);
        }
      }

      // 3. Discover Status surfaces
      const statusResults = await manager.search(`site:${domain} "status page" OR "system health"`);
      for (const res of statusResults) {
        surfaces.push({
          id: `surf_status_${Math.random().toString(36).substr(2, 9)}`,
          url: res.url,
          type: 'PUBLIC_STATUS',
          exposure: 'PUBLIC_SERVICE_SURFACE',
          provenance: 'Public status page discovery',
          sourceUrl: res.url,
          isVerified: false
        } as any);
      }
    }

    return surfaces;
  }
}
