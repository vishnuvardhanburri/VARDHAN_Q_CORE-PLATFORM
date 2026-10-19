import { OwnerPipeline } from '../src/server/OwnerPipeline';
import { PeopleExtractor } from '../src/server/PeopleExtractor';
import { LiveWebResearchProvider } from '../src/server/LiveWebResearchProvider';
import type { FindingClassification, Evidence, FindingType } from '../src/server/IntelligenceCase';

async function runHunt() {
  const companies = [
    { name: 'Vercel', url: 'https://vercel.com', type: 'OBSERVED_LATENCY', evidence: ['Latency in API Gateway observed'] },
    { name: 'Supabase', url: 'https://supabase.com', type: 'POSSIBLE_PUBLIC_EXPOSURE', evidence: ['Internal storage path leaked'] },
    { name: 'Stripe', url: 'https://stripe.com', type: 'REPEATED_ERRORS', evidence: ['500s on /payments endpoint'] },
    { name: 'Shopify', url: 'https://shopify.com', type: 'DOCUMENTED_ENGINEERING_FAILURE', evidence: ['Outage in checkout service'] },
    { name: 'GitLab', url: 'https://gitlab.com', type: 'POSSIBLE_SENSITIVE_METADATA_EXPOSURE', evidence: ['Node ID leaked in headers'] },
  ];

  const researchProvider = new LiveWebResearchProvider();
  const peopleExtractor = new PeopleExtractor();
  const pipeline = new OwnerPipeline(researchProvider, peopleExtractor);

  console.log('=== VARDHAN REAL-WORLD OWNER HUNT (PIPELINE VALIDATION) ===\n');

  for (const co of companies) {
    console.log(`Hunting for ${co.name}...`);
    
    const mockClassification: FindingClassification = {
      finding_type: co.type as FindingType,
      impact_severity: 'HIGH',
      severity_basis: 'Observed in production',
      confidence: 'HIGH',
      strength: 'HIGH'
    };

    const mockEvidence: Evidence[] = co.evidence.map((text, i) => ({
      id: `ev_${co.name}_${i}`,
      evidence_origin: 'REAL_PUBLIC_OBSERVATION',
      public_url: co.url,
      source_type: 'PUBLIC_OBSERVATION',
      observed_behavior: text,
      retrieved_at: new Date().toISOString(),
      status: 200,
      reproductions: 1,
      repeatable: true,
      tested_without_auth: true,
      not_tested: [],
    } as any));

    const resolution = await pipeline.resolve(
      `opp_${co.name}`,
      mockClassification,
      mockEvidence
    );

    console.log(`  - Opportunity: ${co.type}`);
    console.log(`  - Resolution State: ${resolution.verification_state}`);
    console.log(`  - Primary Candidate: ${resolution.primary_candidate?.name || 'NONE'}`);
    console.log(`  - Dimensions:`);
    console.log(`    - Identity: ${resolution.identity_confidence.toFixed(2)}`);
    console.log(`    - Role: ${resolution.role_confidence.toFixed(2)}`);
    console.log(`    - Technical Rel: ${resolution.technical_relevance.toFixed(2)}`);
    console.log(`    - Ownership: ${resolution.ownership_confidence.toFixed(2)}`);
    console.log(`    - Employment: ${resolution.contactability_confidence.toFixed(2)}`);
    console.log(`  - Next Action: ${resolution.next_action}`);
    console.log('--------------------------------------------------\n');
  }
}

runHunt().catch(console.error);
