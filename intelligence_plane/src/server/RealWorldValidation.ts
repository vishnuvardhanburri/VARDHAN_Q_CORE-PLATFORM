import { AutonomousLoopManager } from './AutonomousLoopManager';
import { IntelligenceCase } from './IntelligenceCase';

async function runValidation() {
  const companies = [
    { name: 'Cloudflare', domain: 'cloudflare.com', homepage: 'https://www.cloudflare.com' },
    { name: 'Graphite', domain: 'graphite.dev', homepage: 'https://graphite.dev' },
    { name: 'Snyk', domain: 'snyk.io', homepage: 'https://snyk.io' },
  ];

  for (const comp of companies) {
    console.log(`\n=== VALIDATING: ${comp.name} ===`);
    
    const loopManager = new AutonomousLoopManager(comp.name);
    const initialCase: IntelligenceCase = {
      company: comp.name,
      fit_status: 'FIT',
      evidence: [],
      resolved_evidence: [],
      discovery_errors: 0,
      contradictions: [],
      prospect_decision: 'RESEARCH_MORE',
      subject: '',
      body: '',
      claim_validation: '',
      audit_trail: [],
      mode: 'PRODUCTION',
      company_surface: {
        company: comp.name,
        origin: comp.domain,
        homepage: comp.homepage,
        discovered_pages: [],
        page_categories: {},
      },
      signals: [],
      correlated_groups: [],
    };

    const finalCase = await loopManager.executeLoop(initialCase, (msg) => {
      console.log(`[Loop] ${msg}`);
    });

    console.log(`\n--- FINAL RESULTS for ${comp.name} ---`);
    console.log(`Decision: ${finalCase.prospect_decision}`);
    console.log(`Pressure: ${finalCase.pressure_classification}`);
    console.log(`Signals found: ${finalCase.signals.length}`);
    console.log(`Correlations: ${finalCase.correlated_groups.length}`);
    console.log(`Owner: ${finalCase.technical_owner?.name || 'None'}`);
    console.log(`Audit Trail Length: ${finalCase.audit_trail.length}`);
  }
}

runValidation().catch(console.error);
