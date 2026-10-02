import { LivePublicObservationProvider } from './src/server/LivePublicObservationProvider';
import { TargetVerificationEngine } from './src/server/TargetVerificationEngine';
import { IntelligenceCase, AffectedTargetCandidate, LiveTechnicalEvent, BehavioralMarker } from './src/server/IntelligenceCase';

async function validateRealCompany(companyName: string, targetUrl: string, provider: string, symptom: string, signature: BehavioralMarker[]) {
  console.log(`\n=== VALIDATING: ${companyName} ===`);
  
  const observationProvider = new LivePublicObservationProvider();
  const verificationEngine = new TargetVerificationEngine(observationProvider);

  const targetCase: IntelligenceCase = {
    company: companyName,
    company_surface: {
      company: companyName,
      origin: new URL(targetUrl).hostname,
      company_homepage: targetUrl,
      discovered_pages: [{ url: targetUrl, path: '/', status: 200 }],
      page_categories: {}
    },
    evidence: [],
    signals: [],
    prospect_decision: 'RESEARCH_MORE'
  } as any;

  const event: LiveTechnicalEvent = {
    id: 'ev-real-1',
    source: 'StatusPage',
    sourceUrl: `https://status.${provider.toLowerCase()}.com`,
    eventType: 'PERFORMANCE_DEGRADATION',
    provider: provider,
    symptom: symptom,
    signature: signature,
    observedAt: new Date().toISOString(),
    provenance: { 
      source_url: `https://status.${provider.toLowerCase()}.com`, 
      discovery_mechanism: 'REGISTRY',
      canonical_url: `https://status.${provider.toLowerCase()}.com`,
      retrieval_timestamp: new Date().toISOString(),
      provider: 'StatusPage',
      attribution: 'Official Status',
      classification: 'OBSERVATION'
    } as any
  } as any;

  const candidate: AffectedTargetCandidate = {
    id: 'can-real-1',
    targetCompany: companyName,
    dependency: provider,
    dependencyConfidence: 'KNOWN_DEPENDENCY',
    liveEvent: event,
    temporalRelation: 'CURRENT',
    exposureEvidence: [],
    verificationTarget: targetUrl,
    verificationStatus: 'PENDING',
    provenance: { 
      source_url: targetUrl, 
      discovery_mechanism: 'DIRECT_OBSERVATION',
      canonical_url: targetUrl,
      retrieval_timestamp: new Date().toISOString(),
      provider: 'LivePublicObservationProvider',
      attribution: 'Direct Observation',
      classification: 'OBSERVATION'
    } as any
  } as any;

  console.log(`Targeting Surface: ${targetUrl}`);
  
  // MANUALLY DRIVE THE PROCESS to see where it fails
  console.log('\n[STEP 1] Probing Target Surface...');
  const targetResult = await observationProvider.observePublicSurface(targetUrl);
  console.log('Observation Result:', JSON.stringify(targetResult, null, 2));
  
  const targetEvidence = targetResult.observations?.[0];
  if (!targetEvidence) {
    console.log('FAILURE: Target surface returned no evidence.');
    return { status: 'INCONCLUSIVE' };
  }

  console.log('\n[STEP 2] Probing Control Surface...');
  // Use a known control for the provider
  const controlUrl = 'https://www.cloudflarestatus.com/'; 
  const controlResult = await observationProvider.observePublicSurface(controlUrl);
  console.log('Control Result:', JSON.stringify(controlResult, null, 2));

  console.log('\n[STEP 3] Running Verification Engine...');
  const result = await verificationEngine.verify(candidate, targetCase);
  
  console.log(`\nFinal Verification Result: ${result.status}`);
  console.log(`Reason: ${result.report.reason}`);
  
  return result;
}

async function main() {
  await validateRealCompany(
    'SendGrid', 
    'https://status.sendgrid.com/', 
    'Twilio', 
    'High Latency', 
    [{ type: 'LATENCY', value: 2000, operator: 'GREATER_THAN' }]
  );
}

main().catch(console.error);
