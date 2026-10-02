import { VardhanSystemManager } from '../src/server/system/VardhanSystemManager';
import { AutonomousOrganizationDiscoveryEngine } from '../src/server/discovery/AutonomousOrganizationDiscoveryEngine';
import { ExternalSurfaceIntelligenceService } from '../src/server/discovery/ExternalSurfaceIntelligenceService';
import { OpportunityDecisionEngine } from '../src/server/discovery/OpportunityDecisionEngine';
import { OutreachEligibilityGate } from '../src/server/discovery/OutreachEligibilityGate';
import { CompanyResearchContext } from '../src/server/CompanyResearchContext';
import { IntelligenceCase } from '../src/server/IntelligenceCase';

async function runPipeline(manager: VardhanSystemManager, discoveryEngine: any, surfaceService: any, decisionEngine: any, outreachGate: any, count: number) {
  console.log(`\n--- Processing ${count} Organizations ---`);
  
  const candidates = await discoveryEngine.discover({
    objective: "Find VARDHAN targets",
    maxCandidates: count,
    researchBudget: {},
    researchMode: 'FREE_FIRST'
  } as any);

  if (candidates.length === 0) {
    console.log("No candidates discovered.");
    return null;
  }

  const results = [];
  for (const candidate of candidates.slice(0, count)) {
    try {
      const context = new CompanyResearchContext(candidate.organizationName, {
        maxSearchQueries: 20,
        maxPagesFetched: 30,
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

      const resultCase = await manager.broadIntelOrchestrator.orchestrate(caseData, context);
      const surfaceProfile = await surfaceService.generateSurfaceProfile(candidate.organizationName, candidate.domain || '');
      
      const decision = await decisionEngine.decide(
        candidate,
        resultCase.evidence,
        resultCase.hypotheses?.map(h => h.claim) || [],
        resultCase.complexityMap,
        surfaceProfile.graph || { nodes: new Map(), edges: [] },
        surfaceProfile.assessments,
        [],
        resultCase.hypotheses || [],
        [],
        {}
      );

      const packet = await decisionEngine.createEvidencePacket(candidate, decision, {
        signals: resultCase.hypotheses?.map(h => h.claim) || [],
        evidenceIds: resultCase.evidence.map(e => e.id),
        hypotheses: resultCase.hypotheses,
        surfaceSummary: surfaceProfile.narrative
      });

      const eligibility = outreachGate.checkEligibility(packet);

      results.push({
        company: candidate.organizationName,
        domain: candidate.domain,
        decision: decision.state,
        evidenceCount: resultCase.evidence.length,
        complexity: resultCase.complexityMap?.nodes.length || 0,
        outreachEligible: eligibility.eligible
      });
    } catch (e) {
      console.error(`Error processing ${candidate.organizationName}: ${e}`);
    }
  }

  return results;
}

async function main() {
  const manager = new VardhanSystemManager({
    fetcher: async (u, i) => fetch(u, i) as any,
    searchProvider: (await import('../src/server/WebSearchProvider')).PublicWebSearchProvider 
      ? new (await import('../src/server/WebSearchProvider')).PublicWebSearchProvider({ fetcher: async (u, i) => fetch(u, i) as any })
      : null,
    output: { write: (s: string) => process.stdout.write(s) }
  });

  const discoveryEngine = new AutonomousOrganizationDiscoveryEngine(manager);
  const surfaceService = new ExternalSurfaceIntelligenceService(manager);
  const decisionEngine = new OpportunityDecisionEngine();
  const outreachGate = new OutreachEligibilityGate();

  // Stage 1: 3 Companies
  const stage1 = await runPipeline(manager, discoveryEngine, surfaceService, decisionEngine, outreachGate, 3);
  console.log(`Stage 1 (3 Co) Results:`, stage1);
  if (!stage1 || stage1.length === 0) {
    console.log("Canary failed at 3 companies.");
    return;
  }

  // Stage 2: 10 Companies
  const stage2 = await runPipeline(manager, discoveryEngine, surfaceService, decisionEngine, outreachGate, 10);
  console.log(`Stage 2 (10 Co) Results:`, stage2);
  if (!stage2 || stage2.length === 0) {
    console.log("Canary failed at 10 companies.");
    return;
  }

  console.log(`\nSUCCESS: Staged validation passed. Ready for larger batches.`);
}

main().catch(console.error);
