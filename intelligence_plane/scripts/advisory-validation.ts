import { VardhanSystemManager } from '../src/server/system/VardhanSystemManager';
import { AutonomousOrganizationDiscoveryEngine } from '../src/server/discovery/AutonomousOrganizationDiscoveryEngine';
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
      return [{
        url: 'https://zetaflow.ai/status',
        title: 'ZetaFlow Status',
        snippet: 'Recent outage in us-east-1 due to database replication lag during regional failover.'
      }];
    }
    return [];
  }
};

async function main() {
  console.log(`\n==================================================`);
  console.log(`VARDHAN ADVISORY PATH VALIDATION (ZetaFlow Regression)`);
  console.log(`==================================================`);

  const manager = new VardhanSystemManager({
    fetcher: async (u, i) => fetch(u, i) as any,
    searchProvider: MockSearchProvider as any,
  });

  const discoveryEngine = new AutonomousOrganizationDiscoveryEngine(manager);
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
  
  const researchContext = new CompanyResearchContext(cand.organizationName, {
    maxSearchQueries: 50,
    maxPagesFetched: 50,
    maxGithubRequests: 10
  });

  const caseData: IntelligenceCase = {
    company: cand.organizationName,
    domain: cand.domain || '',
    fit_status: 'UNKNOWN' as any,
    evidence: [],
    prospect_decision: 'RESEARCH_MORE',
    internalState: 'IDLE',
    supportedSignals: cand.supportedSignals
  } as any;

  const result = await manager.broadIntelOrchestrator.orchestrate(caseData, researchContext);

  console.log(`\n--- Final Result ---`);
  console.log(`Company: ${result.company}`);
  console.log(`Final State: ${result.internalState}`);
  
  if (result.internalState === 'ADVISORY_NOTICE') {
    console.log(`SUCCESS: System correctly identified that while verification failed, an Advisory Notice is eligible.`);
  } else if (result.internalState === 'VERIFIED_FINDING') {
    console.log(`FAILURE: System manufactured a verified finding without a target.`);
  } else {
    console.log(`FAILURE: System failed to trigger advisory path. State: ${result.internalState}`);
  }
}

main().catch(console.error);
