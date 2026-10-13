import { VardhanSystemManager } from '../src/server/system/VardhanSystemManager';
import { BroadIntelligenceOrchestrator } from '../src/server/BroadIntelligenceOrchestrator';
import { ExternalSurfaceIntelligenceService } from '../src/server/discovery/ExternalSurfaceIntelligenceService';
import { OpportunityDecisionEngine } from '../src/server/discovery/OpportunityDecisionEngine';
import { OutreachEligibilityGate } from '../src/server/discovery/OutreachEligibilityGate';
import { CompanyResearchContext } from '../src/server/CompanyResearchContext';
import { CSVParser } from '../src/server/discovery/CSVParser';
import { PublicWebSearchProvider } from '../src/server/WebSearchProvider';
import fs from 'fs';

async function main() {
  console.log(`\n==================================================`);
  console.log(`VARDHAN — FINAL 1,000-COMPANY REAL SCALE VALIDATION`);
  console.log(`==================================================`);

  // 1. Real Network Canary
  console.log(`\n--- Running Network Canary ---`);
  try {
    const res = await fetch('https://google.com');
    console.log(`Canary Fetch: https://google.com -> HTTP ${res.status} ✅`);
  } catch (e) {
    console.error(`Canary Fetch FAILED: ${e}`);
    process.exit(1);
  }

  // 2. Canonical Provider Wiring (No Mocks)
  const fetcher = async (url: string, init: any) => fetch(url, init);
  const searchProvider = new PublicWebSearchProvider({ fetcher });
  
  const manager = new VardhanSystemManager({
    fetcher: fetcher as any,
    output: { write: (s: string) => {} }
  });

  if (!manager.controller) {
    throw new Error("Manager controller not initialized");
  }
  manager.controller.searchProvider = searchProvider;

  // Verify Search Provider
  console.log(`\n--- Verifying Search Provider ---`);
  const testResults = await manager.search('Vardhan Technical Intelligence');
  console.log(`Search Test: Found ${testResults.length} results. ${testResults.length > 0 ? '✅' : '❌'}`);

  const orchestrator = manager.broadIntelOrchestrator;
  const surfaceService = new ExternalSurfaceIntelligenceService(manager);
  const decisionEngine = new OpportunityDecisionEngine();
  const outreachGate = new OutreachEligibilityGate();

  // 3. Real Company Loading
  const csvPath = '/Users/vishnuvardhanburri/Downloads/vardhan-outreach-dashboard/dataset.csv';
  const content = fs.readFileSync(csvPath, 'utf8');
  const allCompanies = CSVParser.parse(content);
  const companies = allCompanies.slice(0, 1000);

  console.log(`\nCOMPANIES_SELECTED = ${companies.length}`);

  const metrics = {
    processed: 0,
    completed: 0,
    failed: 0,
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

  // 4. Full Pipeline with Bounded Fan-out (12 workers)
  const BATCH_SIZE = 12;
  for (let i = 0; i < companies.length; i += BATCH_SIZE) {
    const batch = companies.slice(i, i + BATCH_SIZE);
    console.log(`\nProcessing Batch ${Math.floor(i/BATCH_SIZE)+1} (${i} to ${Math.min(i+BATCH_SIZE, companies.length)})...`);
    
    await Promise.all(batch.map(async (company) => {
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

        metrics.completed++;
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
          domain: company.domain,
          decision: decision,
          resultCase,
          surfaceProfile,
          eligibility,
          evidenceCount: resultCase.evidence.length
        });

      } catch (e) {
        metrics.failed++;
        console.error(`[Pipeline Failure] ${company.name}: ${e}`);
        metrics.results.push({
          company: company.name,
          domain: company.domain,
          error: String(e),
          decision: { state: 'REJECT' },
          eligibility: { eligible: false }
        });
      }
    }));
  }

  // 5. Final Reporting
  console.log(`\n==================================================`);
  console.log(`FINAL SCALE MEASUREMENTS (1000)`);
  console.log(`==================================================`);
  console.log(`COMPANIES_SELECTED: ${companies.length}`);
  console.log(`COMPANIES_PROCESSED: ${metrics.processed}`);
  console.log(`COMPANIES_COMPLETED: ${metrics.completed}`);
  console.log(`COMPANIES_FAILED: ${metrics.failed}`);
  console.log(`EVIDENCE_ITEMS: ${metrics.evidenceItems}`);
  console.log(`AVG_EVIDENCE_PER_COMPANY: ${(metrics.evidenceItems / metrics.processed).toFixed(2)}`);
  console.log(`TECHNICAL_ENTITIES: ${metrics.technicalEntities}`);
  console.log(`RELATIONSHIPS: ${metrics.relationships}`);
  console.log(`COMPLEXITY_NODES: ${metrics.complexityNodes}`);
  console.log(`HYPOTHESES: ${metrics.hypotheses}`);
  console.log(`EXTERNAL_SURFACES: ${metrics.surfaces}`);
  console.log(`BOUNDARY_ASSESSMENTS: ${metrics.boundaryAssessments}`);

  console.log(`\nDECISION DISTRIBUTION:`);
  Object.entries(metrics.decisions).forEach(([k, v]) => console.log(`  ${k}: ${v}`));

  console.log(`\nELIGIBILITY:`);
  console.log(`  OUTREACH_ELIGIBLE: ${metrics.eligibility['OUTREACH_ELIGIBLE'] || 0}`);

  console.log(`\nSCALE METRICS:`);
  console.log(`  EVIDENCE_RATE: ${((metrics.completed > 0 ? metrics.results.filter(r => r.evidenceCount > 0).length / metrics.completed : 0) * 100).toFixed(2)}%`);
  console.log(`  SIGNAL_RATE: ${((metrics.hypotheses / metrics.processed) * 100).toFixed(2)}%`);
  console.log(`  COMPLEXITY_RATE: ${((metrics.complexityNodes / metrics.processed) * 100).toFixed(2)}%`);
  console.log(`  HYPOTHESIS_RATE: ${((metrics.hypotheses / metrics.processed) * 100).toFixed(2)}%`);
  console.log(`  OPPORTUNITY_RATE: ${(( (metrics.decisions['VERIFIED_FINDING'] || 0) + (metrics.decisions['ADVISORY_OPPORTUNITY'] || 0) + (metrics.decisions['INVESTIGATION_OPPORTUNITY'] || 0) ) / metrics.processed * 100).toFixed(2)}%`);
  console.log(`  OUTREACH_ELIGIBLE_RATE: ${(( (metrics.eligibility['OUTREACH_ELIGIBLE'] || 0) / metrics.processed) * 100).toFixed(2)}%`);

  // Quality Audit
  console.log(`\n==================================================`);
  console.log(`QUALITY AUDIT - TOP OPPORTUNITIES`);
  console.log(`==================================================`);
  const opportunities = metrics.results.filter(r => ['VERIFIED_FINDING', 'ADVISORY_OPPORTUNITY', 'INVESTIGATION_OPPORTUNITY'].includes(r.decision.state));
  opportunities.forEach(op => {
    console.log(`\nCompany: ${op.company} (${op.domain})`);
    console.log(`Decision: ${op.decision.state}`);
    console.log(`Hypothesis: ${op.resultCase?.hypotheses?.[0]?.claim || 'NONE'}`);
    console.log(`Evidence IDs: ${JSON.stringify(op.resultCase?.evidence.map(e => e.id) || [])}`);
    console.log(`Eligible: ${op.eligibility.eligible}`);
    console.log(`Reason: ${op.decision.reason}`);
  });

  console.log(`\n==================================================`);
  console.log(`FINAL DIAGNOSIS`);
  console.log(`==================================================`);
  if (metrics.completed === metrics.processed && metrics.failed === 0 && metrics.eligibility['OUTREACH_ELIGIBLE'] > 0) {
    console.log(`FULL_INTELLIGENCE_VALIDATED`);
  } else {
    console.log(`INTELLIGENCE_SCALE_PARTIAL`);
  }
}

main().catch(console.error);
