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
  const companies = allCompanies.slice(0, 50);

  const metrics = {
    processed: 0,
    evidenceItems: 0,
    technicalEntities: 0,
    relationships: 0,
    complexityNodes: 0,
    hypotheses: 0,
    surfaces: 0,
    boundaryAssessments: 0,
    decisions: {} as Record<string, number>,
    eligibility: {} as Record<string, number>,
    results: [] as any[]
  };

  console.log(`\n==================================================`);
  console.log(`VARDHAN — 50-COMPANY SCALING VALIDATION`);
  console.log(`==================================================`);

  for (const company of companies) {
    metrics.processed++;
    try {
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

      // Update Metrics
      metrics.evidenceItems += resultCase.evidence.length;
      metrics.technicalEntities += resultCase.complexityMap?.nodes.length || 0;
      metrics.relationships += resultCase.complexityMap?.edges.length || 0;
      metrics.complexityNodes += resultCase.complexityMap?.nodes.length || 0;
      metrics.hypotheses += resultCase.hypotheses?.length || 0;
      metrics.surfaces += surfaceProfile.surfaces.length;
      metrics.boundaryAssessments += surfaceProfile.assessments.length;

      metrics.decisions[decision.state] = (metrics.decisions[decision.state] || 0) + 1;
      if (eligibility.eligible) {
        metrics.eligibility['OUTREACH_ELIGIBLE'] = (metrics.eligibility['OUTREACH_ELIGIBLE'] || 0) + 1;
      }

      metrics.results.push({
        company: company.name,
        decision: decision,
        resultCase,
        surfaceProfile,
        eligibility
      });

    } catch (e) {
      console.error(`Pipeline Failure for ${company.name}: ${e}`);
    }
  }

  console.log(`\n==================================================`);
  console.log(`SCALE METRICS`);
  console.log(`==================================================`);
  console.log(`COMPANIES_PROCESSED: ${metrics.processed}`);
  console.log(`EVIDENCE_ITEMS: ${metrics.evidenceItems}`);
  console.log(`AVG_EVIDENCE_PER_COMPANY: ${(metrics.evidenceItems / metrics.processed).toFixed(2)}`);
  console.log(`TECHNICAL_ENTITIES: ${metrics.technicalEntities}`);
  console.log(`RELATIONSHIPS: ${metrics.relationships}`);
  console.log(`COMPLEXITY_NODES: ${metrics.complexityNodes}`);
  console.log(`HYPOTHESES: ${metrics.hypotheses}`);
  console.log(`EXTERNAL_SURFACES: ${metrics.surfaces}`);
  console.log(`BOUNDARY_ASSESSMENTS: ${metrics.boundaryAssessments}`);

  console.log(`\nDECISIONS:`);
  Object.entries(metrics.decisions).forEach(([k, v]) => console.log(`  ${k}: ${v}`));

  console.log(`\nELIGIBILITY:`);
  console.log(`  OUTREACH_ELIGIBLE: ${metrics.eligibility['OUTREACH_ELIGIBLE'] || 0}`);

  console.log(`\nQUALITY METRICS:`);
  console.log(`  SIGNAL_RATE: ${((metrics.hypotheses / metrics.processed) * 100).toFixed(2)}%`);
  console.log(`  COMPLEXITY_RATE: ${((metrics.complexityNodes / metrics.processed) * 100).toFixed(2)}%`);
  console.log(`  OPPORTUNITY_RATE: ${(( (metrics.decisions['VERIFIED_FINDING'] || 0) + (metrics.decisions['ADVISORY_OPPORTUNITY'] || 0) + (metrics.decisions['INVESTIGATION_OPPORTUNITY'] || 0) ) / metrics.processed * 100).toFixed(2)}%`);
  console.log(`  OUTREACH_ELIGIBLE_RATE: ${(( (metrics.eligibility['OUTREACH_ELIGIBLE'] || 0) / metrics.processed) * 100).toFixed(2)}%`);

  console.log(`\n==================================================`);
  console.log(`FALSE-POSITIVE AUDIT`);
  console.log(`==================================================`);
  const opportunities = metrics.results.filter(r => ['VERIFIED_FINDING', 'ADVISORY_OPPORTUNITY', 'INVESTIGATION_OPPORTUNITY'].includes(r.decision.state));

  opportunities.forEach(op => {
    console.log(`\nCompany: ${op.company}`);
    console.log(`Decision: ${op.decision.state}`);
    console.log(`Hypothesis: ${op.resultCase.hypotheses?.[0]?.claim || 'NONE'}`);
    console.log(`Evidence IDs: ${JSON.stringify(op.resultCase.evidence.map(e => e.id))}`);
    console.log(`Eligible: ${op.eligibility.eligible}`);
  });

  console.log(`\n==================================================`);
  console.log(`DIVERSITY ANALYSIS`);
  console.log(`==================================================`);
  const diversity = {};
  metrics.results.forEach(r => {
    const h = r.resultCase.hypotheses?.[0]?.claim || '';
    if (h.includes('gpu')) diversity['infrastructure'] = (diversity['infrastructure'] || 0) + 1;
    if (h.includes('api')) diversity['integration'] = (diversity['integration'] || 0) + 1;
  });
  Object.entries(diversity).forEach(([k, v]) => console.log(`${k}: ${v}`));

  console.log(`\n==================================================`);
  console.log(`FINAL DIAGNOSIS`);
  console.log(`==================================================`);
  if (metrics.eligibility['OUTREACH_ELIGIBLE'] > 0 && (metrics.hypotheses / metrics.processed) > 0.1) {
    console.log(`INTELLIGENCE_SCALE_PASS`);
  } else {
    console.log(`INTELLIGENCE_SCALE_BOTTLENECK`);
  }
}

main().catch(console.error);
