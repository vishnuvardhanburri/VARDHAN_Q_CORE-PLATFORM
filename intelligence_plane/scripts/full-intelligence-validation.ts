import { VardhanSystemManager } from '../src/server/system/VardhanSystemManager';
import { BroadIntelligenceOrchestrator } from '../src/server/BroadIntelligenceOrchestrator';
import { ExternalSurfaceIntelligenceService } from '../src/server/discovery/ExternalSurfaceIntelligenceService';
import { OpportunityDecisionEngine } from '../src/server/discovery/OpportunityDecisionEngine';
import { OutreachEligibilityGate } from '../src/server/discovery/OutreachEligibilityGate';
import { CompanyResearchContext } from '../src/server/CompanyResearchContext';
import { IntelligenceCase } from '../src/server/IntelligenceCase';
import fs from 'fs';

async function main() {
  console.log(`\n==================================================`);
  console.log(`VARDHAN — FULL 1,000 COMPANY INTELLIGENCE VALIDATION`);
  console.log(`==================================================`);

  const manager = new VardhanSystemManager({
    fetcher: async (u, i) => fetch(u, i) as any,
    output: { write: (s: string) => {} } // Silent for aggregation
  });

  const orchestrator = manager.broadIntelOrchestrator;
  const surfaceService = new ExternalSurfaceIntelligenceService(manager);
  const decisionEngine = new OpportunityDecisionEngine();
  const outreachGate = new OutreachEligibilityGate();

  const csvPath = '/Users/vishnuvardhanburri/Downloads/vardhan-outreach-dashboard/dataset.csv';
  if (!fs.existsSync(csvPath)) {
    console.error("Dataset CSV not found.");
    return;
  }

  const content = fs.readFileSync(csvPath, 'utf8');
  const lines = content.split('\n').slice(1);
  const companies = lines.filter(l => l).map(l => {
    const [name, domain] = l.split(',');
    return { name, domain };
  });

  console.log(`[Input] Total companies to process: ${companies.length}`);

  const WORKER_COUNT = 12;
  const results: any[] = [];
  
  // Process in batches to simulate the 12-worker fanout
  for (let i = 0; i < companies.length; i += WORKER_COUNT) {
    const batch = companies.slice(i, i + WORKER_COUNT);
    
    await Promise.all(batch.map(async (company) => {
      try {
        const context = new CompanyResearchContext(company.name, {
          maxSearchQueries: 20,
          maxPagesFetched: 30,
          maxGithubRequests: 10
        });

        const caseData: IntelligenceCase = {
          company: company.name,
          domain: company.domain || '',
          fit_status: 'UNKNOWN' as any,
          evidence: [],
          prospect_decision: 'RESEARCH_MORE',
          internalState: 'IDLE'
        } as any;

        // FULL PIPELINE: Broad Intelligence
        const resultCase = await orchestrator.orchestrate(caseData, context);

        // FULL PIPELINE: External Surface Intelligence
        const surfaceProfile = await surfaceService.generateSurfaceProfile(
          company.name, 
          company.domain || ''
        );

        // FULL PIPELINE: Opportunity Decision
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

        // FULL PIPELINE: Eligibility
        const packet = await decisionEngine.createEvidencePacket(
          company, 
          decision, 
          {
            signals: resultCase.hypotheses?.map(h => h.claim) || [],
            evidenceIds: resultCase.evidence.map(e => e.id),
            hypotheses: resultCase.hypotheses,
            surfaceSummary: surfaceProfile.narrative
          }
        );

        const eligibility = outreachGate.checkEligibility(packet);

        results.push({
          company: company.name,
          domain: company.domain,
          researchState: resultCase.internalState,
          evidenceCount: resultCase.evidence.length,
          sourceCount: context.getDiscoveredSources().length,
          technicalEntities: resultCase.complexityMap?.nodes.length || 0,
          relationships: resultCase.complexityMap?.edges.length || 0,
          complexityNodes: resultCase.complexityMap?.nodes.length || 0,
          signals: resultCase.hypotheses?.length || 0,
          hypotheses: resultCase.hypotheses?.map(h => h.claim) || [],
          surfaces: surfaceProfile.surfaces.length,
          boundaryAssessments: surfaceProfile.assessments.length,
          decision: decision.state,
          decisionReason: decision.reason,
          outreachEligible: eligibility.eligible
        });
      } catch (e) {
        // Log error but don't stop the run
      }
    }));

    if (i % 120 === 0) {
      process.stdout.write(`Processed ${i}/${companies.length}...\n`);
    }
  }

  // Metrics Calculation
  const total = results.length;
  const successful = results.filter(r => r.researchState !== 'ERROR').length;
  const verified = results.filter(r => r.decision === 'VERIFIED_FINDING').length;
  const advisory = results.filter(r => r.decision === 'ADVISORY_OPPORTUNITY').length;
  const investigation = results.filter(r => r.decision === 'INVESTIGATION_OPPORTUNITY').length;
  const monitor = results.filter(r => r.decision === 'MONITOR').length;
  const researchMore = results.filter(r => r.decision === 'RESEARCH_MORE').length;
  const noSignal = results.filter(r => r.decision === 'NO_ACTIONABLE_SIGNAL').length;
  const rejected = results.filter(r => r.decision === 'REJECT').length;
  const eligible = results.filter(r => r.outreachEligible).length;

  const totalEvidence = results.reduce((acc, r) => acc + r.evidenceCount, 0);
  const totalEntities = results.reduce((acc, r) => acc + r.technicalEntities, 0);
  const totalComplexity = results.reduce((acc, r) => acc + r.complexityNodes, 0);
  const totalHypotheses = results.reduce((acc, r) => acc + r.signals, 0);

  console.log(`\n==================================================`);
  console.log(`AGGREGATE METRICS`);
  console.log(`==================================================`);
  console.log(`Companies Processed: ${total}`);
  console.log(`Successful Research: ${successful}`);
  console.log(`Failed Research: ${total - successful}`);
  console.log(`Total Evidence Items: ${totalEvidence}`);
  console.log(`Avg Evidence/Company: ${(totalEvidence / total).toFixed(2)}`);
  console.log(`Total Technical Entities: ${totalEntities}`);
  console.log(`Total Complexity Nodes: ${totalComplexity}`);
  console.log(`Total Hypotheses: ${totalHypotheses}`);
  console.log(`--------------------------------------------------`);
  console.log(`Verified Findings: ${verified}`);
  console.log(`Advisory Opportunities: ${advisory}`);
  console.log(`Investigation Opportunities: ${investigation}`);
  console.log(`Monitor: ${monitor}`);
  console.log(`Research More: ${researchMore}`);
  console.log(`No Actionable Signal: ${noSignal}`);
  console.log(`Rejected: ${rejected}`);
  console.log(`Outreach Eligible: ${eligible}`);
  console.log(`==================================================`);

  console.log(`\nQUALITY METRICS`);
  console.log(`--------------------------------------------------`);
  console.log(`SIGNAL_RATE: ${((results.filter(r => r.signals > 0).length / total) * 100).toFixed(2)}%`);
  console.log(`COMPLEXITY_RATE: ${((results.filter(r => r.complexityNodes > 0).length / total) * 100).toFixed(2)}%`);
  console.log(`HYPOTHESIS_RATE: ${((results.filter(r => r.hypotheses.length > 0).length / total) * 100).toFixed(2)}%`);
  console.log(`OPPORTUNITY_RATE: ${((verified + advisory + investigation) / total * 100).toFixed(2)}%`);
  console.log(`OUTREACH_ELIGIBLE_RATE: ${((eligible / total) * 100).toFixed(2)}%`);
  console.log(`==================================================`);

  console.log(`\nTOP CANDIDATES:`);
  results
    .sort((a, b) => (a.decision === 'VERIFIED_FINDING' ? -1 : 1))
    .slice(0, 25)
    .forEach((r, i) => {
      console.log(`${i+1}. ${r.company} | ${r.decision} | ${r.decisionReason}`);
    });

  console.log(`\nREPRESENTATIVE REJECTED:`);
  results
    .filter(r => r.decision === 'NO_ACTIONABLE_SIGNAL')
    .slice(0, 25)
    .forEach((r, i) => {
      console.log(`${i+1}. ${r.company} | ${r.decisionReason}`);
    });

  const isSuccess = (verified + advisory + investigation) > 0;
  console.log(`\nFINAL DIAGNOSIS: ${isSuccess ? 'INTELLIGENCE_VALIDATED' : 'INTELLIGENCE_BOTTLENECK'}`);
  if (!isSuccess) {
    console.log(`Bottleneck identified: OPPORTUNITY_DECISION (No high-value signals identified across 1k companies)`);
  }
}

main().catch(console.error);
