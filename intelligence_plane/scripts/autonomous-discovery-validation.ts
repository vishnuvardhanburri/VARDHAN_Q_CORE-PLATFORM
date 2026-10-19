import { VardhanSystemManager } from '../src/server/system/VardhanSystemManager';
import { AutonomousOrganizationDiscoveryEngine, DiscoveryRequest } from '../src/server/discovery/AutonomousOrganizationDiscoveryEngine';
import { CompanyResearchContext } from '../src/server/CompanyResearchContext';
import { IntelligenceCase } from '../src/server/IntelligenceCase';
import { TechnicalEntityExtractor } from '../src/server/TechnicalEntityExtractor';

async function main() {
  console.log(`\n==================================================`);
  console.log(`VARDHAN AUTONOMOUS DISCOVERY LIVE VALIDATION`);
  console.log(`==================================================`);

  // MANUAL DEPENDENCY TEST
  console.log(`CSV_REQUIRED = false`);
  console.log(`MANUAL_COMPANY_LIST_REQUIRED = false`);
  console.log(`FT1000_REQUIRED = false`);
  console.log(`GROWJO_REQUIRED = false`);
  console.log(`--------------------------------------------------`);

  const manager = new VardhanSystemManager({
    fetcher: async (u, i) => fetch(u, i) as any,
    output: { write: (s: string) => {} }
  });

  const discoveryEngine = new AutonomousOrganizationDiscoveryEngine(manager);

  const request: DiscoveryRequest = {
    objective: "Find organizations with VARDHAN-relevant public technical or operational signals.",
    industries: "ALL",
    geographies: "ALL",
    maxCandidates: 25,
    researchBudget: {},
    researchMode: 'FREE_FIRST'
  };

  try {
    // 1. Independent Organization Discovery
    const candidates = await discoveryEngine.discover(request);
    
    console.log(`\n[Discovery] Found ${candidates.length} organization candidates.`);

    const aggregate = {
      totalDiscovered: candidates.length,
      uniqueOrgs: new Set(candidates.map(c => c.domain || c.organizationName)).size,
      supportedSignals: 0,
      rejected: 0,
      researchMore: 0,
      entities: 0,
      complexityNodes: 0,
      hypotheses: 0,
      targets: 0,
      verified: 0,
      diagnosticEligible: 0,
      outreachReady: 0,
      totalEvidence: 0,
      totalSources: 0,
    };

    const processedResults: any[] = [];

    // 2. Pipeline Execution for discovered candidates
    for (const candidate of candidates) {
      console.log(`\nProcessing Candidate: ${candidate.organizationName} (${candidate.domain})`);
      
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
        const orchestrator = (manager as any).broadIntelOrchestrator;
        const resultCase = await orchestrator.orchestrate(caseData, context);

        // Signal Validation: Check if a signal is actually evidence-supported
        const hasSupportedSignal = resultCase.evidence.length > 0 && 
                                   resultCase.complexityMap?.nodes.length > 0;

        if (hasSupportedSignal) {
          aggregate.supportedSignals++;
        } else {
          aggregate.rejected++;
        }

        // Aggregating technical metrics
        const extractor = new TechnicalEntityExtractor();
        const entities = extractor.extractEntities(resultCase.evidence);
        
        aggregate.entities += entities.length;
        aggregate.complexityNodes += resultCase.complexityMap?.nodes.length || 0;
        aggregate.hypotheses += resultCase.hypotheses?.length || 0;
        
        // Targets and Verification
        const targetsCount = resultCase.hypotheses?.filter(h => h.status !== 'HYPOTHESIS').length || 0;
        aggregate.targets += targetsCount;

        if (resultCase.internalState === 'VERIFIED_FINDING') aggregate.verified++;
        if (resultCase.internalState === 'DIAGNOSTIC_ELIGIBLE') aggregate.diagnosticEligible++;
        if (resultCase.internalState === 'OUTREACH_READY') aggregate.outreachReady++;
        if (resultCase.internalState === 'NO_ACTIONABLE_SIGNAL') aggregate.researchMore++;

        aggregate.totalEvidence += resultCase.evidence.length;
        aggregate.totalSources += new Set(resultCase.evidence.map(e => e.public_url)).size;

        processedResults.push({
          company: candidate.organizationName,
          industry: resultCase.intelligenceProfile?.identity.industry || 'Unknown',
          signal: resultCase.complexityMap?.nodes[0]?.label || 'None',
          source: resultCase.evidence[0]?.public_url || 'N/A',
          state: resultCase.internalState
        });

      } catch (e) {
        console.error(`Pipeline failed for ${candidate.organizationName}: ${e}`);
      }
    }

    console.log(`\n==================================================`);
    console.log(`FINAL AUTONOMOUS DISCOVERY AUDIT`);
    console.log(`==================================================`);
    console.log(`Total Organizations Discovered: ${aggregate.totalDiscovered}`);
    console.log(`Unique Organizations: ${aggregate.uniqueOrgs}`);
    console.log(`Organizations with Supported Signals: ${aggregate.supportedSignals}`);
    console.log(`Organizations Rejected: ${aggregate.rejected}`);
    console.log(`Organizations requiring research_more: ${aggregate.researchMore}`);
    console.log(`Technical Entities: ${aggregate.entities}`);
    console.log(`Complexity Nodes: ${aggregate.complexityNodes}`);
    console.log(`Hypotheses: ${aggregate.hypotheses}`);
    console.log(`Observable Targets: ${aggregate.targets}`);
    console.log(`Verified Findings: ${aggregate.verified}`);
    console.log(`Diagnostic Eligible: ${aggregate.diagnosticEligible}`);
    console.log(`Outreach Ready: ${aggregate.outreachReady}`);
    console.log(`Avg Evidence/Org: ${(aggregate.totalEvidence / aggregate.totalDiscovered).toFixed(2)}`);
    console.log(`Avg Sources/Org: ${(aggregate.totalSources / aggregate.totalDiscovered).toFixed(2)}`);
    
    const supportedSignalRate = (aggregate.supportedSignals / aggregate.totalDiscovered) * 100;
    console.log(`\nSUPPORTED_SIGNAL_RATE: ${supportedSignalRate.toFixed(2)}%`);
    console.log(`==================================================`);

    console.log(`\nREPRESENTATIVE SAMPLES:`);
    processedResults.slice(0, 10).forEach((r, i) => {
      console.log(`${i+1}. ${r.company} | ${r.industry} | ${r.signal} | ${r.source} | State: ${r.state}`);
    });

  } catch (e) {
    console.error(`FATAL: Autonomous discovery failed: ${e}`);
  }
}

main().catch(console.error);
