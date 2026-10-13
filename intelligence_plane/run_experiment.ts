import { AutonomousLoopManager } from './src/server/AutonomousLoopManager';
import { IntelligenceCase } from './src/server/IntelligenceCase';
import { LivePublicObservationProvider } from './src/server/LivePublicObservationProvider';

async function runControl(company: string, domain: string) {
  console.log(`\n=== CONTROL RUN: ${company} ===`);
  const loop = new AutonomousLoopManager(company, new LivePublicObservationProvider());
  const caseState: IntelligenceCase = {
    company,
    fit_status: 'NOT_FIT',
    prospect_decision: 'RESEARCH_MORE',
    evidence: [],
    discovery_errors: 0,
    company_surface: {
      company,
      origin: domain,
      company_homepage: `https://${domain}`,
      discovered_pages: [],
      page_categories: {}
    }
  };

  const result = await loop.executeLoop(caseState, 5);
  console.log(`\nResult for ${company}:`);
  console.log(`- Evidence Count: ${result.evidence.length}`);
  console.log(`- Decision: ${result.prospect_decision}`);
  if (result.evidence.length > 0) {
    console.log(`- Sample Evidence: ${result.evidence[0].observed_behavior}`);
  }
}

async function runExperiment() {
  // 1. SendGrid Control
  await runControl('SendGrid', 'sendgrid.com');

  // 2. 5-Company Batch
  const companies = [
    { name: 'Cloudflare', domain: 'cloudflare.com' },
    { name: 'Vercel', domain: 'vercel.com' },
    { name: 'Snyk', domain: 'snyk.io' },
    { name: 'Datadog', domain: 'datadoghq.com' },
    { name: 'HashiCorp', domain: 'hashicorp.com' },
  ];

  console.log('\n\n==================================================');
  console.log('VARDHAN 5-COMPANY GITHUB-API-INDEPENDENT EXPERIMENT');
  console.log('==================================================');

  const results = [];
  for (const co of companies) {
    console.log(`\nProcessing ${co.name}...`);
    const loop = new AutonomousLoopManager(co.name, new LivePublicObservationProvider());
    const caseState: IntelligenceCase = {
      company: co.name,
      fit_status: 'NOT_FIT',
      prospect_decision: 'RESEARCH_MORE',
      evidence: [],
      discovery_errors: 0,
      company_surface: {
        company: co.name,
        origin: co.domain,
        company_homepage: `https://${co.domain}`,
        discovered_pages: [],
        page_categories: {}
      }
    };
    const result = await loop.executeLoop(caseState, 10);
    results.push({ company: co.name, result });
  }

  // Final Report
  console.log('\n\n==================================================');
  console.log('FINAL EXPERIMENT REPORT');
  console.log('==================================================');
  
  let totalObservations = 0;
  let totalEvidence = 0;
  let totalReady = 0;

  results.forEach(r => {
    console.log(`\nCompany: ${r.company}`);
    console.log(`- Evidence: ${r.result.evidence.length}`);
    console.log(`- Decision: ${r.result.prospect_decision}`);
    totalEvidence += r.result.evidence.length;
    if (r.result.prospect_decision === 'GO') totalReady++;
  });

  console.log('\nGLOBAL METRICS:');
  console.log(`Total Companies: ${companies.length}`);
  console.log(`Total Evidence: ${totalEvidence}`);
  console.log(`Outreach Ready: ${totalReady}`);
  console.log(`GitHub API Attempts: 0 (DISABLED)`);
  
  const success = totalReady > 0;
  console.log(`\nREAL TECHNICAL EVIDENCE WITHOUT GITHUB API = ${success ? 'YES' : 'NO'}`);
}

runExperiment().catch(console.error);
