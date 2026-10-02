import { LivePublicObservationProvider } from './src/server/LivePublicObservationProvider';
import { TargetVerificationEngine } from './src/server/TargetVerificationEngine';
import { IntelligenceCase, AffectedTargetCandidate, LiveTechnicalEvent, BehavioralMarker } from './src/server/IntelligenceCase';

async function probeTarget(companyName: string, targetUrl: string, provider: string, symptom: string, signature: BehavioralMarker[]) {
  console.log(`\n--- HUNTING: ${companyName} ---`);
  
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
    id: 'ev-hunt-1',
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
    id: 'can-hunt-1',
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

  const result = await verificationEngine.verify(candidate, targetCase);
  
  if (result.status === 'VERIFIED') {
    console.log(`!!! POSITIVE FINDING FOUND for ${companyName} !!!`);
    console.log(JSON.stringify(result, null, 2));
    return true;
  } else {
    console.log(`No verified finding for ${companyName}. Status: ${result.status}`);
    return false;
  }
}

async function main() {
  // We will try a few companies known to have public technical surfaces
  // and check for repeatable symptoms (e.g. high latency or specific errors).
  const targets = [
    { name: 'ExampleCorp', url: 'https://api.example.com/health', provider: 'AWS', symptom: 'Latency', signature: [{ type: 'LATENCY', value: 1500, operator: 'GREATER_THAN' }] },
    { name: 'RealTarget1', url: 'https://status.sendgrid.com/', provider: 'Twilio', symptom: 'Latency', signature: [{ type: 'LATENCY', value: 2000, operator: 'GREATER_THAN' }] },
  ];

  for (const t of targets) {
    const found = await probeTarget(t.name, t.url, t.provider, t.symptom, t.signature);
    if (found) break;
  }
}

main().catch(console.error);
