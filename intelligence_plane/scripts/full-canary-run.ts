import { VardhanSystemManager } from '../src/server/system/VardhanSystemManager';
import { BroadIntelligenceOrchestrator } from '../src/server/BroadIntelligenceOrchestrator';
import { ExternalSurfaceIntelligenceService } from '../src/server/discovery/ExternalSurfaceIntelligenceService';
import { OpportunityDecisionEngine } from '../src/server/discovery/OpportunityDecisionEngine';
import { OutreachEligibilityGate } from '../src/server/discovery/OutreachEligibilityGate';
import { CompanyResearchContext } from '../src/server/CompanyResearchContext';
import { IntelligenceCase } from '../src/server/IntelligenceCase';
import { CSVParser } from '../src/server/discovery/CSVParser';
import fs from 'fs';

async function main() {
  console.log(`\n==================================================`);
  console.log(`VARDHAN — 3-COMPANY FULL PIPELINE CANARY`);
  console.log(`==================================================`);

  const manager = new VardhanSystemManager({
    fetcher: async (u, i) => fetch(u, i) as any,
    output: { write: (s: string) => process.stdout.write(s) }
  });

  const orchestrator = manager.broadIntelOrchestrator;
  const surfaceService = new ExternalSurfaceIntelligenceService(manager);
  const decisionEngine = new OpportunityDecisionEngine();
  const outreachGate = new OutreachEligibilityGate();

  const csvPath = '/Users/vishnuvardhanburri/Downloads/vardhan-outreach-dashboard/dataset.csv';
  const content = fs.readFileSync(csvPath, 'utf8');
  const allCompanies = CSVParser.parse(content);
  const companies = allCompanies.slice(0, 3);

  let overallEvidenceCount = 0;
  let overallSuccess = true;

  for (const company of companies) {
    console.log(`\n--------------------------------------------------`);
    console.log(`COMPANY: ${company.name}`);
    console.log(`DOMAIN:  ${company.domain}`);
    console.log(`--------------------------------------------------`);

    try {
      const context = new CompanyResearchContext(company.name, {
        maxSearchQueries: 10,
        maxPagesFetched: 10,
        maxGithubRequests: 5
      });

      const caseData: IntelligenceCase = {
        company: company.name,
        domain: company.domain || '',
        fit_status: 'UNKNOWN' as any,
        evidence: [],
        prospect_decision: 'RESEARCH_MORE',
        internalState: 'IDLE'
      } as any;

      // 1. Broad Intelligence
      console.log(`\n[1] Broad Intelligence Orchestration...`);
      const resultCase = await orchestrator.orchestrate(caseData, context);
      console.log(`   - Evidence Items: ${resultCase.evidence.length}`);
      console.log(`   - Sources: ${context.getDiscoveredSources().length}`);
      
      overallEvidenceCount += resultCase.evidence.length;

      // 2. Technical Entities & Complexity
      console.log(`\n[2] Technical Synthesis...`);
      console.log(`   - Entities: ${resultCase.complexityMap?.nodes.length || 0}`);
      console.log(`   - Relationships: ${resultCase.complexityMap?.edges.length || 0}`);
      console.log(`   - Hypotheses: ${resultCase.hypotheses?.length || 0}`);

      // 3. External Surface Intelligence
      console.log(`\n[3] External Surface Intelligence...`);
      const surfaceProfile = await surfaceService.generateSurfaceProfile(company.name, company.domain || '');
      console.log(`   - Surfaces: ${surfaceProfile.surfaces.length}`);
      console.log(`   - Boundary Assessments: ${surfaceProfile.assessments.length}`);

      // 4. Opportunity Decision
      console.log(`\n[4] Opportunity Decision...`);
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
      console.log(`   - Decision: ${decision.state}`);
      console.log(`   - Reason: ${decision.reason}`);
      console.log(`   - Supporting Evidence IDs: ${decision.supportingEvidenceIds.join(', ') || 'None'}`);

      // 5. Outreach Eligibility
      console.log(`\n[5] Outreach Eligibility...`);
      const packet = await decisionEngine.createEvidencePacket(company, decision, {
        signals: resultCase.hypotheses?.map(h => h.claim) || [],
        evidenceIds: resultCase.evidence.map(e => e.id),
        hypotheses: resultCase.hypotheses,
        surfaceSummary: surfaceProfile.narrative
      });
      const eligibility = outreachGate.checkEligibility(packet);
      console.log(`   - Eligible: ${eligibility.eligible}`);
      if (!eligibility.eligible) {
        console.log(`   - Gaps: ${eligibility.gaps.join(', ')}`);
      }

    } catch (e) {
      console.error(`\n❌ PIPELINE FAILURE for ${company.name}: ${e}`);
      overallSuccess = false;
    }
  }

  console.log(`\n==================================================`);
  console.log(`FINAL CANARY RESULT`);
  console.log(`==================================================`);
  
  if (overallSuccess && overallEvidenceCount > 0) {
    console.log(`FULL_CANARY_PASS`);
  } else if (overallSuccess && overallEvidenceCount === 0) {
    console.log(`FULL_CANARY_FAIL`);
    console.log(`Reason: No real evidence entered the pipeline.`);
  } else {
    console.log(`FULL_CANARY_FAIL`);
    console.log(`Reason: Pipeline exceptions occurred.`);
  }
}

main().catch(console.error);
