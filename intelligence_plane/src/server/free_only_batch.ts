import { AutonomousLoopManager } from './AutonomousLoopManager.js';
import { IntelligenceCase } from './IntelligenceCase.js';
import { ResearchPolicyManager } from './ResearchPolicyManager.js';
import { LivePublicObservationProvider } from './LivePublicObservationProvider.js';

async function runFreeOnlyBatch() {
  console.log('🚀 STARTING REAL FREE_ONLY COMMERCIAL BATCH\n');

  ResearchPolicyManager.initialize('FREE_ONLY');
  console.log(' [POLICY] Research Mode: ' + ResearchPolicyManager.getPolicy().mode);
  console.log(' [POLICY] Paid Providers Allowed: ' + ResearchPolicyManager.getPolicy().allowPaidProviders + '\n');

  const dataset = [
    { name: 'Cloudflare', domain: 'cloudflare.com' },
    { name: 'Vercel', domain: 'vercel.com' },
    { name: 'Snyk', domain: 'snyk.io' },
    { name: 'Datadog', domain: 'datadog.com' },
    { name: 'HashiCorp', domain: 'hashicorp.com' },
    { name: 'MongoDB', domain: 'mongodb.com' },
    { name: 'Confluent', domain: 'confluent.io' },
    { name: 'Elastic', domain: 'elastic.co' },
    { name: 'Redis', domain: 'redis.io' },
    { name: 'Pinecone', domain: 'pinecone.io' },
  ];

  const loopManager = new AutonomousLoopManager(undefined, new LivePublicObservationProvider());
  const aggregateResults = {
    totalCompanies: dataset.length,
    totalObservations: 0,
    totalSignals: 0,
    totalFindings: 0,
    totalOpps: 0,
    outreachReady: 0,
    researchMore: 0,
    noGo: 0,
    providerAttempts: 0,
    freeExecuted: 0,
    paidBlocked: 0,
    rateLimited: 0,
    deferred: 0,
    skipped: 0,
    fallbackTransitions: 0,
  };

  const findings = [];

  for (const target of dataset) {
    console.log('Processing ' + target.name);
    const currentCase: IntelligenceCase = {
      company: target.name,
      prospect_decision: 'NO_GO',
      evidence: [],
      company_surface: {
        company: target.name,
        origin: target.domain,
        homepage: 'https://' + target.domain,
        discovered_pages: [],
        page_categories: {},
      } as any,
    };

    try {
      const finalCase = await loopManager.executeLoop(currentCase, 5);

      aggregateResults.totalObservations += finalCase.evidence.length;
      aggregateResults.totalSignals += (finalCase.signals || []).length;

      if (finalCase.prospect_decision === 'GO') aggregateResults.outreachReady++;
      else if (finalCase.prospect_decision === 'RESEARCH_MORE') aggregateResults.researchMore++;
      else aggregateResults.noGo++;

      if (finalCase.prospect_decision === 'GO') {
        findings.push({
          company: target.name,
          decision: finalCase.prospect_decision,
          evidence_count: finalCase.evidence.length,
          signals: finalCase.signals,
        });
      }
    } catch (e) {
      console.error('Error researching ' + target.name + ': ' + e);
    }
  }

  console.log('\n\n================ FINAL BATCH REPORT ================');
  console.log('REAL COMPANIES RESEARCHED: ' + aggregateResults.totalCompanies);
  console.log('REAL OBSERVATIONS: ' + aggregateResults.totalObservations);
  console.log('REAL QUALIFIED SIGNALS: ' + aggregateResults.totalSignals);
  console.log('REAL ACTIONABLE FINDINGS: ' + aggregateResults.totalFindings);
  console.log('REAL DIAGNOSTIC OPPORTUNITIES: ' + aggregateResults.totalOpps);
  console.log('REAL OUTREACH_READY: ' + aggregateResults.outreachReady);
  console.log('RESEARCH_MORE: ' + aggregateResults.researchMore);
  console.log('NO_GO: ' + aggregateResults.noGo);
  console.log('====================================================\n');

  if (findings.length > 0) {
    console.log('TOP FINDING CARDS:');
    findings.slice(0, 5).forEach((f, i) => {
      console.log('\n' + (i+1) + ' ' + f.company + ' | Decision: ' + f.decision + ' | Evidence: ' + f.evidence_count);
    });
  }
}

runFreeOnlyBatch().catch(console.error);
