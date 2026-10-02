import { VardhanSystemManager } from '../src/server/system/VardhanSystemManager';
import { BroadIntelligenceOrchestrator } from '../src/server/BroadIntelligenceOrchestrator';
import { ExternalSurfaceIntelligenceService } from '../src/server/discovery/ExternalSurfaceIntelligenceService';
import { OpportunityDecisionEngine } from '../src/server/discovery/OpportunityDecisionEngine';
import { OutreachEligibilityGate } from '../src/server/discovery/OutreachEligibilityGate';
import { CompanyResearchContext } from '../src/server/CompanyResearchContext';
import { CSVParser } from '../src/server/discovery/CSVParser';
import fs from 'fs';

class MockSearchProvider {
  async search(query: string): Promise<any[]> {
    const lowerQuery = query.toLowerCase();
    if (lowerQuery.includes('gpu') || lowerQuery.includes('orchestration')) {
      return [
        { url: 'https://engineering.blog/scaling-gpu-clusters', title: 'Scaling our GPU Clusters' },
        { url: 'https://docs.company.com/infra/gpu-scheduling', title: 'GPU Scheduling' }
      ];
    }
    return [{ url: 'https://company.com/about', title: 'About Us' }];
  }
}

async function main() {
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
  (manager as any).controller = mockController;

  const orchestrator = manager.broadIntelOrchestrator;
  const surfaceService = new ExternalSurfaceIntelligenceService(manager);
  const decisionEngine = new OpportunityDecisionEngine();
  const outreachGate = new OutreachEligibilityGate();

  const csvPath = '/Users/vishnuvardhanburri/Downloads/vardhan-outreach-dashboard/dataset.csv';
  const content = fs.readFileSync(csvPath, 'utf8');
  const allCompanies = CSVParser.parse(content);
  const targets = allCompanies.filter(c => c.name === 'Mercor' || c.name === 'Together AI');

  console.log(`\n==================================================`);
  console.log(`VARDHAN — PRE-SCALE AUDIT`);
  console.log(`==================================================`);

  for (const company of targets) {
    console.log(`\n>>> AUDITING: ${company.name}`);
    
    const context = new CompanyResearchContext(company.name, {});
    const caseData = { company: company.name, domain: company.domain || '', evidence: [], prospect_decision: 'RESEARCH_MORE', internalState: 'IDLE' } as any;
    
    const resultCase = await orchestrator.orchestrate(caseData, context);
    const surfaceProfile = await surfaceService.generateSurfaceProfile(company.name, company.domain || '');
    
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

    const packet = await decisionEngine.createEvidencePacket(company, decision, {
      signals: resultCase.hypotheses?.map(h => h.claim) || [],
      evidenceIds: resultCase.evidence.map(e => e.id),
      hypotheses: resultCase.hypotheses,
      surfaceSummary: surfaceProfile.narrative
    });

    const eligibility = outreachGate.checkEligibility(packet);

    console.log(`Decision: ${decision.state}`);
    console.log(`Evidence Count: ${resultCase.evidence.length}`);
    console.log(`Evidence IDs: ${JSON.stringify(resultCase.evidence.map(e => e.id))}`);
    console.log(`Complexity: ${resultCase.complexityMap?.nodes.length || 0} nodes`);
    console.log(`Hypothesis: ${resultCase.hypotheses?.[0]?.claim || 'NONE'}`);
    console.log(`Reason: ${decision.reason}`);
    console.log(`OutreachEligible: ${eligibility.eligible}`);
    console.log(`Eligibility Reason: ${eligibility.reason}`);
  }
}

main().catch(console.error);
