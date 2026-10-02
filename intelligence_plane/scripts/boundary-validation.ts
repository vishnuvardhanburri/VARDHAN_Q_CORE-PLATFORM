import { VardhanSystemManager } from '../src/server/system/VardhanSystemManager';
import { ExternalSurfaceIntelligenceService } from '../src/server/discovery/ExternalSurfaceIntelligenceService';
import { ExternalBoundaryCapabilityEngine } from '../src/server/discovery/ExternalBoundaryCapabilityEngine';

const MockSearchProvider = {
  search: async (query: string) => {
    if (query.includes('engineering blog')) {
      return [{
        url: 'https://engineering.zetaflow.ai/blog',
        title: 'ZetaFlow Engineering',
        snippet: 'Our engineering blog discusses our global GPU orchestrator.'
      }];
    }
    if (query.includes('zetaflow.ai')) {
      return [
        { url: 'https://api.zetaflow.ai/docs', title: 'API Docs', snippet: 'Our API uses JWT auth. Admin endpoints are at /admin' },
        { url: 'https://login.zetaflow.ai', title: 'Login', snippet: 'Enterprise SSO login portal.' },
        { url: 'https://status.zetaflow.ai', title: 'Status', snippet: 'System health metrics.' }
      ];
    }
    return [];
  }
};

async function main() {
  console.log(`\n==================================================`);
  console.log(`VARDHAN BOUNDARY CAPABILITY VALIDATION`);
  console.log(`==================================================`);

  const manager = new VardhanSystemManager({
    fetcher: async (u, i) => fetch(u, i) as any,
    searchProvider: MockSearchProvider as any,
  });

  const surfaceService = new ExternalSurfaceIntelligenceService(manager);
  const boundaryEngine = new ExternalBoundaryCapabilityEngine();

  const company = "ZetaFlow";
  const domain = "zetaflow.ai";

  const profile = await surfaceService.generateSurfaceProfile(company, domain);
  const assessments = await boundaryEngine.assessCapability(profile, profile.evidence, []);

  console.log(`\nOrganization: ${company}`);
  console.log(`Discovered Surfaces: ${profile.surfaces.length}`);
  
  console.log(`\n--- Boundary Assessments ---`);
  assessments.forEach(a => {
    console.log(`Surface: ${a.surfaceId} (${a.surfaceType})`);
    console.log(`  Boundary: ${a.boundaryType}`);
    console.log(`  Capability State: ${a.capabilityState}`);
    console.log(`  Access Model: ${a.accessModel}`);
    console.log(`  Auth Required: ${a.authorizationRequired}`);
    console.log(`  Verification Path: ${a.requiredVerification}`);
    console.log(`--------------------------------------------------`);
  });
}

main().catch(console.error);
