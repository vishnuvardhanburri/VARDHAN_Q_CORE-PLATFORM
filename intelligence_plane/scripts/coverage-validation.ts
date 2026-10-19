import { VardhanSystemManager } from '../src/server/system/VardhanSystemManager';
import { AutonomousOrganizationDiscoveryEngine } from '../src/server/discovery/AutonomousOrganizationDiscoveryEngine';
import { ExternalSurfaceIntelligenceService } from '../src/server/discovery/ExternalSurfaceIntelligenceService';
import { ExternalBoundaryCapabilityEngine } from '../src/server/discovery/ExternalBoundaryCapabilityEngine';

const MockSearchProvider = {
  search: async (query: string) => {
    // Organization Discovery
    if (query.includes('engineering blog')) {
      return [{
        url: 'https://engineering.zetaflow.ai/blog',
        title: 'ZetaFlow Engineering',
        snippet: 'Our engineering blog discusses our global GPU orchestrator.'
      }];
    }
    // Surface Expansion
    if (query.includes('zetaflow.ai')) {
      return [
        { url: 'https://api.zetaflow.ai/docs', title: 'API Docs', snippet: 'Our API is public. No auth required for GET /status.' },
        { url: 'https://login.zetaflow.ai', title: 'Login', snippet: 'Secure enterprise login.' },
        { url: 'https://status.zetaflow.ai', title: 'Status', snippet: 'System health.' },
        { url: 'https://dev.zetaflow.ai', title: 'Dev Portal', snippet: 'Developer resources.' },
        { url: 'https://admin.zetaflow.ai', title: 'Admin', snippet: 'Internal admin panel.' },
        { url: 'https://legacy.zetaflow.ai', title: 'Old API', snippet: 'Legacy API version 1.' }
      ];
    }
    return [];
  }
};

async function main() {
  console.log(`\n==================================================`);
  console.log(`VARDHAN EXTERNAL ATTACK-SURFACE COVERAGE VALIDATION`);
  console.log(`==================================================`);

  const manager = new VardhanSystemManager({
    fetcher: async (u, i) => fetch(u, i) as any,
    searchProvider: MockSearchProvider as any,
  });

  const discoveryEngine = new AutonomousOrganizationDiscoveryEngine(manager);
  const surfaceService = new ExternalSurfaceIntelligenceService(manager);
  const boundaryEngine = new ExternalBoundaryCapabilityEngine();

  const candidates = await discoveryEngine.discover({
    objective: "Find orgs",
    maxCandidates: 1,
    researchBudget: {},
    researchMode: 'FREE_FIRST'
  });

  if (candidates.length === 0) {
    console.log("No candidates found.");
    return;
  }

  const cand = candidates[0];
  const profile = await surfaceService.generateSurfaceProfile(cand.organizationName, cand.domain || '');
  const assessments = await boundaryEngine.assessCapability(profile, profile.evidence, []);

  console.log(`\nOrganization: ${cand.organizationName}`);
  console.log(`Aliases: ${profile.aliases.map(a => a.alias).join(', ')}`);
  
  console.log(`\n--- Surface Inventory ---`);
  profile.surfaces.forEach(s => {
    const assessment = assessments.find(a => a.surfaceId === s.id);
    console.log(`Surface: ${s.url}`);
    console.log(`  Class: ${s.type} | State: ${s.discoveryState} | Expectation: ${s.expectationSource}`);
    if (assessment) {
      console.log(`  Boundary: ${assessment.boundaryType} | Capability: ${assessment.capabilityState}`);
    }
    console.log(`--------------------------------------------------`);
  });

  console.log(`\n--- Coverage Metrics ---`);
  console.log(`Total Surfaces: ${profile.surfaces.length}`);
  console.log(`Unique Domains: ${new Set(profile.surfaces.map(s => new URL(s.url).hostname)).size}`);
}

main().catch(console.error);
