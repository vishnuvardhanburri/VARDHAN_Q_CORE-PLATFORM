import { VardhanSystemManager } from '../src/server/system/VardhanSystemManager';
import { BroadIntelligenceOrchestrator } from '../src/server/BroadIntelligenceOrchestrator';
import { ExternalSurfaceIntelligenceService } from '../src/server/discovery/ExternalSurfaceIntelligenceService';
import { OpportunityDecisionEngine } from '../src/server/discovery/OpportunityDecisionEngine';
import { OutreachEligibilityGate } from '../src/server/discovery/OutreachEligibilityGate';
import { CompanyResearchContext } from '../src/server/CompanyResearchContext';
import { IntelligenceCase } from '../src/server/IntelligenceCase';
import { CSVParser } from '../src/server/discovery/CSVParser';
import fs from 'fs';

// Realistic Mock Search Provider to test pipeline density
class MockSearchProvider {
  async search(query: string): Promise<any[]> {
    const lowerQuery = query.toLowerCase();
    if (lowerQuery.includes('gpu') || lowerQuery.includes('orchestration')) {
      return [
        { url: 'https://engineering.blog/scaling-gpu-clusters', title: 'Scaling our GPU Clusters' },
        { url: 'https://docs.company.com/infra/gpu-scheduling', title: 'GPU Scheduling' }
      ];
    }
    if (lowerQuery.includes('api') || lowerQuery.includes('admin')) {
      return [
        { url: 'https://api.company.com/v1', title: 'Public API' },
        { url: 'https://admin.company.com', title: 'Admin Portal' }
      ];
    }
    return [{ url: 'https://company.com/about', title: 'About Us' }];
  }
}

async function main() {
  console.log(`\n==================================================`);
  console.log(`VARDHAN — 10-COMPANY INTELLIGENCE DENSITY VALIDATION`);
  console.log(`==================================================`);

  // Mocking the controller and search provider
  const mockController = {
    searchProvider: new MockSearchProvider(),
    getFetcher: () => async (url: string, options: any) => ({
      status: 200,
      text: () => Promise.resolve('OK'),
      json: () => Promise.resolve({}),
    })
  };

  const manager = new VardhanSystemManager({
    fetcher: async (u, i) => ({ status: 200, text: () => Promise.resolve('OK'), json: () => Promise.resolve({}) } as any),
    output: { write: (s: string) => {} }
  } as any);
  
  // Inject the mock controller into the manager
  (manager as any).controller = mockController;

  const orchestrator = manager.broadIntelOrchestrator;
  const surfaceService = new ExternalSurfaceIntelligenceService(manager);
  const decisionEngine = new OpportunityDecisionEngine();
  const outreachGate = new OutreachEligibilityGate();

  const csvPath = '/Users/vishnuvardhanburri/Downloads/vardhan-outreach-dashboard/dataset.csv';
  const content = fs.readFileSync(csvPath, 'utf8');
  const allCompanies = CSVParser.parse(content);
  const companies = allCompanies.slice(0, 10);

  const results: any[] = [];

  for (const company of companies) {
    console.log(`\n--- Processing: ${company.name} (${company.domain}) ---`);
    
    try {
      const context = new CompanyResearchContext(company.name, {
        maxSearchQueries: 30,
        maxPagesFetched: 40,
        maxGithubRequests: 15
      });

      const caseData: IntelligenceCase = {
        company: company.name,
        domain: company.domain || '',
        fit_status: 'UNKNOWN' as any,
        evidence: [],
        prospect_decision: 'RESEARCH_MORE',
        internalState: 'IDLE'
      } as any;

      // 1. Full Broad Intelligence Pipeline
      const resultCase = await orchestrator.orchestrate(caseData, context);
      
      // 2. External Surface Intelligence
      const surfaceProfile = await surfaceService.generateSurfaceProfile(company.name, company.domain || '');
      
      // 3. Opportunity Decision
      const decision = await decisionEngine.decide(
        company,
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

      // 4. Eligibility
      const packet = await decisionEngine.createEvidencePacket(company, decision, {
        signals: resultCase.hypotheses?.map(h => h.claim) || [],
        evidenceIds: resultCase.evidence.map(e => e.id),
        hypotheses: resultCase.hypotheses,
        surfaceSummary: surfaceProfile.narrative
      });
      const eligibility = outreachGate.checkEligibility(packet);

      results.push({
        company: company.name,
        domain: company.domain,
        evidenceCount: resultCase.evidence.length,
        evidenceIds: resultCase.evidence.map(e => e.id),
        sources: context.getDiscoveredSources(),
        entities: resultCase.complexityMap?.nodes.length || 0,
        relationships: resultCase.complexityMap?.edges.length || 0,
        complexity: resultCase.complexityMap?.nodes.length || 0,
        hypotheses: resultCase.hypotheses || [],
        surfaces: surfaceProfile.surfaces.length,
        boundaryAssessments: surfaceProfile.assessments.length,
        decision: decision.state,
        decisionReason: decision.reason,
        outreachEligible: eligibility.eligible,
        researchState: resultCase.internalState
      });

      console.log(`   TRACE:`);
      console.log(`     - Evidence: ${resultCase.evidence.length} items`);
      console.log(`     - Entities: ${resultCase.complexityMap?.nodes.length || 0}`);
      console.log(`     - Complexity: ${resultCase.complexityMap?.nodes.length || 0} nodes`);
      console.log(`     - Hypotheses: ${resultCase.hypotheses?.length || 0}`);
      console.log(`     - Surfaces: ${surfaceProfile.surfaces.length}`);
      console.log(`     - Decision: ${decision.state}`);
      console.log(`     - Eligible: ${eligibility.eligible}`);

    } catch (e) {
      console.error(`Pipeline Failure for ${company.name}: ${e}`);
    }
  }

  const total = results.length;
  const evidenceCount = results.filter(r => r.evidenceCount > 0).length;
  const signalCount = results.filter(r => r.hypotheses.length > 0).length;
  const entityCount = results.filter(r => r.entities > 0).length;
  const complexityCount = results.filter(r => r.complexity > 0).length;
  const hypothesisCount = results.filter(r => r.hypotheses.length > 0).length;
  const opportunityCount = results.filter(r => ['VERIFIED_FINDING', 'ADVISORY_OPPORTUNITY', 'INVESTIGATION_OPPORTUNITY'].includes(r.decision)).length;
  const outreachCount = results.filter(r => r.outreachEligible).length;

  console.log(`\n==================================================`);
  console.log(`PRIMARY METRICS`);
  console.log(`==================================================`);
  console.log(`EVIDENCE_RATE: ${(evidenceCount / total * 100).toFixed(2)}%`);
  console.log(`SIGNAL_RATE: ${(signalCount / total * 100).toFixed(2)}%`);
  console.log(`ENTITY_RATE: ${(entityCount / total * 100).toFixed(2)}%`);
  console.log(`COMPLEXITY_RATE: ${(complexityCount / total * 100).toFixed(2)}%`);
  console.log(`HYPOTHESIS_RATE: ${(hypothesisCount / total * 100).toFixed(2)}%`);
  console.log(`OPPORTUNITY_RATE: ${(opportunityCount / total * 100).toFixed(2)}%`);
  console.log(`OUTREACH_RATE: ${(outreachCount / total * 100).toFixed(2)}%`);
  console.log(`==================================================`);

  if (evidenceCount > 0 && (entityCount > 0 || hypothesisCount > 0)) {
    console.log(`\nFINAL DIAGNOSIS: INTELLIGENCE_DENSITY_PASS`);
  } else if (evidenceCount > 0) {
    console.log(`\nFINAL DIAGNOSIS: INTELLIGENCE_DENSITY_BOTTLENECK`);
    console.log(`Bottleneck identified: ENTITY_EXTRACTION / HYPOTHESIS_GENERATION`);
  } else {
    console.log(`\nFINAL DIAGNOSIS: NETWORK_OR_PROVIDER_BOTTLENECK`);
  }
}

main().catch(console.error);
