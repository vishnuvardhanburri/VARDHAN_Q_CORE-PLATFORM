import { AutonomousLoopManager } from './AutonomousLoopManager';
import { IntelligenceCase } from './IntelligenceCase';
import { ClaimAndMetricValidator } from './targetQualificationEngine';
import { LivePublicObservationProvider } from './LivePublicObservationProvider';
import { PersonDiscoveryEngine } from './PersonDiscoveryEngine';
import { DeepOwnerResolver } from './DeepOwnerResolver';
import { ContactabilityFinder } from './ContactabilityFinder';

async function runProductionTest() {
  const companies = [
    { name: 'Cloudflare', domain: 'cloudflare.com', homepage: 'https://www.cloudflare.com' },
    { name: 'Graphite', domain: 'graphite.dev', homepage: 'https://graphite.dev' },
    { name: 'Snyk', domain: 'snyk.io', homepage: 'https://snyk.io' },
    { name: 'Vercel', domain: 'vercel.com', homepage: 'https://vercel.com' },
    { name: 'Netlify', domain: 'netlify.com', homepage: 'https://netlify.com' },
    { name: 'HashiCorp', domain: 'hashicorp.com', homepage: 'https://hashicorp.com' },
    { name: 'Datadog', domain: 'datadog.com', homepage: 'https://datadog.com' },
    { name: 'New Relic', domain: 'newrelic.com', homepage: 'https://newrelic.com' },
    { name: 'Splunk', domain: 'splunk.com', homepage: 'https://splunk.com' },
    { name: 'Confluent', domain: 'confluent.io', homepage: 'https://confluent.io' },
    { name: 'MongoDB', domain: 'mongodb.com', homepage: 'https://mongodb.com' },
    { name: 'Elastic', domain: 'elastic.co', homepage: 'https://elastic.co' },
    { name: 'Redis', domain: 'redis.io', homepage: 'https://redis.io' },
    { name: 'Pinecone', domain: 'pinecone.io', homepage: 'https://pinecone.io' },
    { name: 'Milvus', domain: 'milvus.io', homepage: 'https://milvus.io' },
    { name: 'Weaviate', domain: 'weaviate.io', homepage: 'https://weaviate.io' },
    { name: 'Qdrant', domain: 'qdrant.tech', homepage: 'https://qdrant.tech' },
    { name: 'Chroma', domain: 'trychroma.com', homepage: 'https://trychroma.com' },
    { name: 'Supabase', domain: 'supabase.com', homepage: 'https://supabase.com' },
    { name: 'PlanetScale', domain: 'planetscale.com', homepage: 'https://planetscale.com' },
    { name: 'Neon', domain: 'neon.tech', homepage: 'https://neon.tech' },
    { name: 'CockroachDB', domain: 'cockroachlabs.com', homepage: 'https://cockroachlabs.com' },
    { name: 'SurrealDB', domain: 'surrealdb.com', homepage: 'https://surrealdb.com' },
    { name: 'EdgeDB', domain: 'edgedb.com', homepage: 'https://edgedb.com' },
    { name: 'Fly.io', domain: 'fly.io', homepage: 'https://fly.io' },
  ];

  const globalMetrics = {
    totalCompanies: companies.length,
    sources: new Map<string, number>(),
    searches: 0,
    fetches: 0,
    voiIterations: 0,
    opportunities: 0,
    findings: 0,
    researchMore: 0,
    noGo: 0,
    ownersFound: 0,
    contactsFound: 0,
    claimPass: 0,
    claimFail: 0,
    verificationSuccess: 0,
    verificationFailed: 0,
    verificationInconclusive: 0,
    blockedSources: 0,
  };

  const companyResults = [];

  for (const comp of companies) {
    console.log(`\n\n================================================================================`);
    console.log(`PROD TEST: ${comp.name}`);
    console.log(`================================================================================`);

    const start = Date.now();
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
      console.log(msg);
    });

    const duration = Date.now() - start;

    // Last-mile execution
    let verificationResult = 'NOT_JUSTIFIED';
    if (finalCase.pressure_classification && finalCase.pressure_classification !== 'UNKNOWN') {
      const targetUrl = finalCase.evidence[0]?.public_url || finalCase.company_surface?.homepage;
      if (targetUrl) {
        const observer = new LivePublicObservationProvider();
        const obs = await observer.observePublicSurface(targetUrl);
        verificationResult = obs.evidence.length > 0 ? 'SUCCESS' : 'FAILED';
        if (verificationResult === 'SUCCESS') globalMetrics.verificationSuccess++;
        else globalMetrics.verificationFailed++;
      }
    } else {
      globalMetrics.verificationInconclusive++;
    }

    let ownerResult = 'NOT_JUSTIFIED';
    let resolvedOwner = null;
    if (finalCase.pressure_classification && finalCase.pressure_classification !== 'UNKNOWN') {
      const candidates = await PersonDiscoveryEngine.discover({
        company: finalCase.company,
        domain: finalCase.company_surface?.origin || '',
        technicalArea: finalCase.pressure_classification,
        providerCompanies: [],
        pages: finalCase.company_surface?.discovered_pages || [],
        htmlByUrl: new Map(),
      });
      resolvedOwner = DeepOwnerResolver.resolve(candidates, finalCase.pressure_classification, finalCase.finding_classification || null, finalCase.evidence);
      if (resolvedOwner) {
        ownerResult = 'FOUND';
        globalMetrics.ownersFound++;
      } else {
        ownerResult = 'UNAVAILABLE';
      }
    }

    let contactResult = 'NOT_JUSTIFIED';
    if (resolvedOwner) {
      const contacts = ContactabilityFinder.find(finalCase.company_surface?.discovered_pages || [], new Map(), () => {}, null);
      if (contacts.length > 0) {
        contactResult = 'FOUND';
        globalMetrics.contactsFound++;
      } else {
        contactResult = 'UNAVAILABLE';
      }
    }

    let claimPass = 0;
    let claimFail = 0;
    const claims = finalCase.evidence.map(e => e.evidence_text);
    claims.forEach(claim => {
      if (ClaimAndMetricValidator.validate(claim).isValid) claimPass++;
      else claimFail++;
    });
    globalMetrics.claimPass += claimPass;
    globalMetrics.claimFail += claimFail;

    // Metrics
    if (finalCase.prospect_decision === 'GO') globalMetrics.findings++;
    else if (finalCase.prospect_decision === 'OPPORTUNITY') globalMetrics.opportunities++;
    else if (finalCase.prospect_decision === 'RESEARCH_MORE') globalMetrics.researchMore++;
    else globalMetrics.noGo++;

    companyResults.push({
      company: comp.name,
      duration,
      pressure: finalCase.pressure_classification,
      signals: finalCase.signals.length,
      correlations: finalCase.correlated_groups.length,
      decision: finalCase.prospect_decision,
      verification: verificationResult,
      owner: ownerResult,
      contact: contactResult,
      claimPass,
      claimFail
    });
  }

  console.log(`\n\n================================================================================`);
  console.log(`FINAL 25-COMPANY PRODUCTION REPORT`);
  console.log(`================================================================================`);
  console.log(`TOTAL COMPANIES: ${globalMetrics.totalCompanies}`);
  console.log(`OPPORTUNITIES: ${globalMetrics.opportunities}`);
  console.log(`FINDINGS: ${globalMetrics.findings}`);
  console.log(`RESEARCH_MORE: ${globalMetrics.researchMore}`);
  console.log(`NO_GO: ${globalMetrics.noGo}`);
  console.log(`OWNERS FOUND: ${globalMetrics.ownersFound}`);
  console.log(`CONTACTS FOUND: ${globalMetrics.contactsFound}`);
  console.log(`CLAIM QA PASS: ${globalMetrics.claimPass}`);
  console.log(`CLAIM QA FAIL: ${globalMetrics.claimFail}`);
  console.log(`VERIFICATION SUCCESS: ${globalMetrics.verificationSuccess}`);
  console.log(`VERIFICATION FAILED: ${globalMetrics.verificationFailed}`);
}

runProductionTest().catch(console.error);
