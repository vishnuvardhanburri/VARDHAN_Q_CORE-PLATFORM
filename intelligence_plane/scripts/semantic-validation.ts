import { VardhanSystemManager } from '../src/server/system/VardhanSystemManager';
import { AutonomousOrganizationDiscoveryEngine } from '../src/server/discovery/AutonomousOrganizationDiscoveryEngine';
import { ExternalSurfaceIntelligenceService } from '../src/server/discovery/ExternalSurfaceIntelligenceService';
import { SurfaceSemanticValidator } from '../src/server/discovery/SurfaceSemanticValidator';
import { ExposureCorrelationEngine } from '../src/server/discovery/ExposureCorrelationEngine';
import { SurfaceInvestigationPrioritizer } from '../src/server/discovery/SurfaceInvestigationPrioritizer';

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
        { url: 'https://api.zetaflow.ai/docs', title: 'API Docs', snippet: 'Our API is public. No auth required for GET /status.' },
        { url: 'https://login.zetaflow.ai', title: 'Login', snippet: 'Secure enterprise login.' },
        { url: 'https://status.zetaflow.ai', title: 'Status', snippet: 'System health.' },
        { url: 'https://admin.zetaflow.ai', title: 'Admin', snippet: 'Internal management portal.' }
      ];
    }
    return [];
  }
};

async function main() {
  console.log(`\n==================================================`);
  console.log(`VARDHAN SURFACE SEMANTIC VALIDATION REGRESSION`);
  console.log(`==================================================`);

  const manager = new VardhanSystemManager({
    fetcher: async (u, i) => fetch(u, i) as any,
    searchProvider: MockSearchProvider as any,
  });

  const discoveryEngine = new AutonomousOrganizationDiscoveryEngine(manager);
  const surfaceService = new ExternalSurfaceIntelligenceService(manager);
  const validator = new SurfaceSemanticValidator();
  const correlator = new ExposureCorrelationEngine();
  const prioritizer = new SurfaceInvestigationPrioritizer();

  const candidates = await discoveryEngine.discover({
    objective: "Find orgs",
    maxCandidates: 1,
    researchBudget: {},
    researchMode: 'FREE_FIRST'
  });

  if (candidates.length === 0) return;

  const cand = candidates[0];
  const profile = await surfaceService.generateSurfaceProfile(cand.organizationName, cand.domain || '');
  
  const semanticAssessments = [];
  for (const s of profile.surfaces) {
    const assessment = await validator.validate(s, profile.evidence, (manager as any).identityGraph);
    semanticAssessments.push(assessment);
  }

  const exposures = await correlator.correlate(semanticAssessments, [], [], []);
  const priorities = prioritizer.prioritize(semanticAssessments, exposures);

  console.log(`\nOrganization: ${cand.organizationName}`);
  
  semanticAssessments.forEach(sa => {
    const exp = exposures.find(e => e.surfaceId === sa.surfaceId);
    const prio = priorities.find(p => p.surfaceId === sa.surfaceId);
    
    console.log(`\nSurface: ${sa.surfaceId}`);
    console.log(`  Role: ${sa.functionalRole} | Auth: ${sa.authExpectation}`);
    console.log(`  Exposure: ${exp ? exp.exposureType : 'NONE'}`);
    console.log(`  Priority: ${prio?.priority}`);
    console.log(`  Confidence: ${sa.confidence}`);
  });
}

main().catch(console.error);
