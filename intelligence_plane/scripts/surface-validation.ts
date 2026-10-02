import { VardhanSystemManager } from '../src/server/system/VardhanSystemManager';
import { AutonomousOrganizationDiscoveryEngine } from '../src/server/discovery/AutonomousOrganizationDiscoveryEngine';
import { ExternalSurfaceIntelligenceService } from '../src/server/discovery/ExternalSurfaceIntelligenceService';
import { BroadIntelligenceOrchestrator } from '../src/server/BroadIntelligenceOrchestrator';
import { CompanyResearchContext } from '../src/server/CompanyResearchContext';
import { IntelligenceCase } from '../src/server/IntelligenceCase';

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
        { url: 'https://api.zetaflow.ai/docs', title: 'API Docs', snippet: 'Official API reference.' },
        { url: 'https://status.zetaflow.ai', title: 'Status', snippet: 'Current system health.' },
        { url: 'https://login.zetaflow.ai', title: 'Login', snippet: 'User authentication.' }
      ];
    }
    return [];
  }
};

async function main() {
  console.log(`\n==================================================`);
  console.log(`VARDHAN EXTERNAL SURFACE DISCOVERY VALIDATION`);
  console.log(`==================================================`);

  const manager = new VardhanSystemManager({
    fetcher: async (u, i) => fetch(u, i) as any,
    searchProvider: MockSearchProvider as any,
  });

  const discoveryEngine = new AutonomousOrganizationDiscoveryEngine(manager);
  const surfaceService = new ExternalSurfaceIntelligenceService(manager);

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
  console.log(`\nTarget: ${cand.organizationName} (${cand.domain})`);

  const profile = await surfaceService.generateSurfaceProfile(cand.organizationName, cand.domain || '');
  
  console.log(`\n--- Identity Graph ---`);
  profile.aliases.forEach(a => console.log(`${a.type}: ${a.alias} (${a.provenance})`));

  console.log(`\n--- External Surfaces ---`);
  profile.surfaces.forEach(s => console.log(`${s.type} -> ${s.exposure} | ${s.url}`));

  console.log(`\n--- Intelligence Pipeline Feed ---`);
  const context = new CompanyResearchContext(cand.organizationName, {});
  const caseData: IntelligenceCase = {
    company: cand.organizationName,
    domain: cand.domain || '',
    fit_status: 'UNKNOWN' as any,
    evidence: [...profile.evidence],
    prospect_decision: 'RESEARCH_MORE',
    internalState: 'IDLE'
  } as any;

  const result = await manager.broadIntelOrchestrator.orchestrate(caseData, context);
  console.log(`Final State: ${result.internalState}`);
  console.log(`Complexity Nodes: ${result.complexityMap?.nodes.length || 0}`);
}

main().catch(console.error);
