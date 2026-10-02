import { VardhanSystemManager } from '../src/server/system/VardhanSystemManager';
import { AutonomousOrganizationDiscoveryEngine } from '../src/server/discovery/AutonomousOrganizationDiscoveryEngine';
import { CompanyResearchContext } from '../src/server/CompanyResearchContext';
import { IntelligenceCase } from '../src/server/IntelligenceCase';
import { TechnicalEntityExtractor } from '../src/server/TechnicalEntityExtractor';

const MockSearchProvider = {
  search: async (query: string) => {
    // Match Organization Discovery queries (exact match or contains)
    if (query === '"engineering blog"' || query === '"developer portal"') {
      return [{
        url: 'https://engineering.zetaflow.ai/blog',
        title: 'ZetaFlow Engineering Blog',
        snippet: 'Our engineering blog discusses how we use a global GPU orchestrator to manage inference clusters.'
      }];
    }
    
    // Match Signal Discovery queries
    // The query format is: "ZetaFlow" OR "zetaflow.ai" ("keywords")
    if (query.includes('"ZetaFlow"') || query.includes('"zetaflow.ai"')) {
      // Only support a few specific signals to avoid noise
      if (query.includes('outage') || query.includes('reliability') || query.includes('infrastructure')) {
        return [{
          url: 'https://zetaflow.ai/status',
          title: 'ZetaFlow Status',
          snippet: 'Recent outage in us-east-1 due to database replication lag during regional failover.'
        }];
      }
    }
    
    // Match Context Expansion queries
    if (query.includes('zetaflow.ai') && (query.includes('architecture') || query.includes('infrastructure'))) {
      return [{
        url: 'https://zetaflow.ai/blog/arch',
        title: 'ZetaFlow Architecture',
        snippet: 'Our multi-region data coordination is handled by a custom replication layer to minimize latency.'
      }];
    }
    
    return [];
  }
};

async function main() {
  const manager = new VardhanSystemManager({
    fetcher: async (u, i) => fetch(u, i) as any,
    searchProvider: MockSearchProvider as any,
  });

  const discoveryEngine = new AutonomousOrganizationDiscoveryEngine(manager);
  const candidates = await discoveryEngine.discover({
    objective: "Find orgs",
    maxCandidates: 2,
    researchBudget: {},
    researchMode: 'FREE_FIRST'
  });

  if (candidates.length === 0) {
    console.log("No candidates discovered. Check MockSearchProvider.");
    return;
  }

  for (const cand of candidates) {
    console.log(`\n=== TRACING: ${cand.organizationName} ===`);
    console.log(`Discovery: ${cand.discoveryReason}`);
    console.log(`Footprint: ${cand.domain}`);
    console.log(`Signal State: ${cand.signalState}`);
    
    const context = new CompanyResearchContext(cand.organizationName, {});
    const caseData: IntelligenceCase = {
      company: cand.organizationName,
      domain: cand.domain || '',
      fit_status: 'UNKNOWN' as any,
      evidence: [],
      prospect_decision: 'RESEARCH_MORE',
      internalState: 'IDLE',
      supportedSignals: cand.supportedSignals
    } as any;

    const result = await manager.broadIntelOrchestrator.orchestrate(caseData, context);
    
    console.log(`Evidence Count: ${result.evidence.length}`);
    const entities = new TechnicalEntityExtractor().extractEntities(result.evidence);
    console.log(`Entities: ${entities.map(e => e.canonicalLabel).join(', ')}`);
    console.log(`Complexity Nodes: ${result.complexityMap?.nodes.length || 0}`);
    console.log(`Hypotheses: ${result.hypotheses?.length || 0}`);
    console.log(`Final State: ${result.internalState}`);
  }
}

main().catch(console.error);
