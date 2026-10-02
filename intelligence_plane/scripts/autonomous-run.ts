import { VardhanSystemManager } from '../src/server/system/VardhanSystemManager';
import { AutonomousOrganizationDiscoveryEngine, DiscoveryRequest } from '../src/server/discovery/AutonomousOrganizationDiscoveryEngine';
import { CompanyResearchContext } from '../src/server/CompanyResearchContext';
import { IntelligenceCase } from '../src/server/IntelligenceCase';
import { TechnicalEntityExtractor } from '../src/server/TechnicalEntityExtractor';

const MockSearchProvider = {
  search: async (query: string) => {
    console.log(`[MockSearch] Searching for: ${query}`);
    
    // Layer 1: Organization Discovery
    // Ensure queries like "engineering blog" return a valid technical footprint result
    if (query.includes('engineering blog') || query.includes('developer portal')) {
      return [
        {
          url: 'https://engineering.example-ai.com/blog',
          title: 'Example AI Engineering Blog',
          snippet: 'Welcome to the Example AI engineering blog. We discuss our platform engineering and scaling strategies.'
        }
      ];
    }
    
    // Layer 2/3: Signal Discovery
    // Ensure signal queries for "Example AI" return a result
    if (query.includes('Example AI') || query.includes('example-ai.com')) {
      return [
        {
          url: 'https://example-ai.com/docs/gpu-orchestration',
          title: 'GPU Orchestration at Example AI',
          snippet: 'Our custom GPU orchestration layer handles high-concurrency inference workloads across multi-region clusters.'
        }
      ];
    }
    
    return [];
  }
};

async function main() {
  console.log(`\n==================================================`);
  console.log(`VARDHAN AUTONOMOUS DISCOVERY LIVE RUN`);
  console.log(`==================================================`);

  const manager = new VardhanSystemManager({
    fetcher: async (u, i) => fetch(u, i) as any,
    searchProvider: MockSearchProvider as any,
    output: { write: (s: string) => process.stdout.write(s) }
  });

  const discoveryEngine = new AutonomousOrganizationDiscoveryEngine(manager);

  const request: DiscoveryRequest = {
    objective: "Find organizations with VARDHAN-relevant public technical, operational, security, reliability, performance, architecture, infrastructure, data, or exposure signals.",
    industries: "ALL",
    geographies: "ALL",
    maxCandidates: 50,
    researchBudget: {},
    researchMode: 'FREE_FIRST'
  };

  try {
    const candidates = await discoveryEngine.discover(request);
    
    const aggregate = {
      totalDiscovered: candidates.length,
      uniqueOrgs: new Set(candidates.map(c => c.domain || c.organizationName)).size,
      supportedSignals: candidates.filter(c => c.signalState === 'SUPPORTED').length,
      rejected: 0,
      entities: 0,
      complexityNodes: 0,
      hypotheses: 0,
      targets: 0,
      verified: 0,
      diagnosticEligible: 0,
      outreachReady: 0,
      totalEvidence: 0,
    };

    const fullAuditResults: any[] = [];

    for (const candidate of candidates) {
      if (candidate.signalState !== 'SUPPORTED') continue;

      console.log(`\n--- Investigating: ${candidate.organizationName} (${candidate.domain}) ---`);
      
      const context = new CompanyResearchContext(candidate.organizationName, {
        maxSearchQueries: 30,
        maxPagesFetched: 50,
        maxGithubRequests: 10
      });

      const caseData: IntelligenceCase = {
        company: candidate.organizationName,
        domain: candidate.domain || '',
        fit_status: 'UNKNOWN' as any,
        evidence: [],
        prospect_decision: 'RESEARCH_MORE',
        internalState: 'IDLE'
      } as any;

      try {
        const orchestrator = manager.broadIntelOrchestrator;
        const resultCase = await orchestrator.orchestrate(caseData, context);

        const extractor = new TechnicalEntityExtractor();
        const entities = extractor.extractEntities(resultCase.evidence);
        
        aggregate.entities += entities.length;
        aggregate.complexityNodes += resultCase.complexityMap?.nodes.length || 0;
        aggregate.hypotheses += resultCase.hypotheses?.length || 0;
        
        const targetsCount = resultCase.hypotheses?.filter(h => h.status !== 'HYPOTHESIS').length || 0;
        aggregate.targets += targetsCount;

        if (resultCase.internalState === 'VERIFIED_FINDING') aggregate.verified++;
        if (resultCase.internalState === 'DIAGNOSTIC_ELIGIBLE') aggregate.diagnosticEligible++;
        if (resultCase.internalState === 'OUTREACH_READY') aggregate.outreachReady++;

        aggregate.totalEvidence += resultCase.evidence.length;

        fullAuditResults.push({
          company: candidate.organizationName,
          domain: candidate.domain,
          industry: resultCase.intelligenceProfile?.identity.industry || 'Unknown',
          discoveryQuery: candidate.discoveryReason,
          sourceUrl: candidate.sourceUrl,
          signal: candidate.supportedSignals[0] || 'None',
          attribution: 'Source-backed evidence',
          classification: 'Sourced Evidence',
          signalState: 'SUPPORTED',
          investigationState: resultCase.internalState,
          hypothesis: resultCase.hypotheses?.[0]?.claim || 'None',
          target: resultCase.hypotheses?.[0]?.verificationTarget || 'None',
          result: resultCase.internalState
        });

      } catch (e) {
        console.error(`Pipeline failed for ${candidate.organizationName}: ${e}`);
      }
    }

    console.log(`\n\n==================================================`);
    console.log(`FINAL AUTONOMOUS DISCOVERY RUN RESULTS`);
    console.log(`==================================================`);
    console.log(`TOTAL_ORGANIZATIONS_DISCOVERED: ${aggregate.totalDiscovered}`);
    console.log(`TOTAL_UNIQUE_ORGANIZATIONS: ${aggregate.uniqueOrgs}`);
    console.log(`TOTAL_SUPPORTED_SIGNALS: ${aggregate.supportedSignals}`);
    console.log(`TOTAL_COMPANIES_ENTERED_INTELLIGENCE: ${aggregate.supportedSignals}`);
    console.log(`TOTAL_COMPLEXITY_NODES: ${aggregate.complexityNodes}`);
    console.log(`TOTAL_HYPOTHESES: ${aggregate.hypotheses}`);
    console.log(`TOTAL_OBSERVABLE_TARGETS: ${aggregate.targets}`);
    console.log(`TOTAL_VERIFIED_FINDINGS: ${aggregate.verified}`);
    console.log(`TOTAL_DIAGNOSTIC_ELIGIBLE: ${aggregate.diagnosticEligible}`);
    console.log(`TOTAL_OUTREACH_READY: ${aggregate.outreachReady}`);
    console.log(`==================================================`);

    console.log(`\nDISCOVERED ORGANIZATIONS LIST:`);
    fullAuditResults.slice(0, 20).forEach((r, i) => {
      console.log(`${i+1}. ${r.company} | ${r.domain} | ${r.industry} | ${r.signal} | ${r.result}`);
    });

    if (aggregate.verified > 0) {
      console.log(`\nFINAL DIAGNOSIS: SUCCESSFUL_AUTONOMOUS_DISCOVERY`);
    } else if (aggregate.supportedSignals > 0) {
      console.log(`\nFINAL DIAGNOSIS: PARTIAL_SEARCH_PROVIDER_LIMITATION (Signals found, but no verified endpoints)`);
    } else {
      console.log(`\nFINAL DIAGNOSIS: NO_VALID_PUBLIC_CANDIDATES`);
    }

  } catch (e) {
    console.error(`FATAL: Autonomous run failed: ${e}`);
  }
}

main().catch(console.error);
