import { VardhanSystemManager } from '../src/server/system/VardhanSystemManager';
import { ExternalSurfaceIntelligenceService } from '../src/server/discovery/ExternalSurfaceIntelligenceService';
import { ExternalBoundaryCapabilityEngine } from '../src/server/discovery/ExternalBoundaryCapabilityEngine';
import { Evidence } from '../src/server/IntelligenceCase';

const MockSearchProvider = {
  search: async (query: string) => {
    if (query.includes('engineering blog')) {
      return [{
        url: 'https://engineering.zetaflow.ai/blog',
        title: 'ZetaFlow Engineering',
        snippet: 'Our engineering blog discusses our global GPU orchestrator.'
      }];
    }
    if (query.includes('zetaflow.ai')) {
      return [
        { url: 'https://api.zetaflow.ai/docs', title: 'API Docs', snippet: 'Our API is public. No auth required for GET /status.' },
        { url: 'https://login.zetaflow.ai', title: 'Login', snippet: 'Secure enterprise login.' },
        { url: 'https://status.zetaflow.ai', title: 'Status', snippet: 'System health.' }
      ];
    }
    return [];
  }
};

async function main() {
  console.log(`\n==================================================`);
  console.log(`VARDHAN BOUNDARY RECONCILIATION REGRESSION (ZetaFlow)`);
  console.log(`==================================================`);

  const manager = new VardhanSystemManager({
    fetcher: async (u, i) => fetch(u, i) as any,
    searchProvider: MockSearchProvider as any,
  });

  const surfaceService = new ExternalSurfaceIntelligenceService(manager);
  const boundaryEngine = new ExternalBoundaryCapabilityEngine();

  const company = "ZetaFlow";
  const domain = "zetaflow.ai";

  const profile = await surfaceService.generateSurfaceProfile(company, domain);
  
  // MANUALLY ADD BEHAVIORAL EVIDENCE to simulate successful safe probes (200 OK)
  const behavioralEvidence: Evidence[] = profile.surfaces.map(s => ({
    id: `ev_beh_${s.id}`,
    provenance: {
      source_url: s.url,
      canonical_url: s.url,
      source_type: 'SEARCH_RESULT' as any,
      discovery_mechanism: 'SEARCH',
      retrieval_timestamp: new Date().toISOString(),
      provider: 'BehavioralProbe',
      attribution: 'Safe Observation',
      classification: 'OBSERVATION'
    },
    evidence_origin: 'DISCOVERY',
    public_url: s.url,
    source_type: 'SEARCH_RESULT' as any,
    retrieved_at: new Date().toISOString(),
    observed_behavior: 'HTTP 200 OK - Success',
    evidence_text: 'HTTP 200 OK - Success',
  } as any));

  const assessments = await boundaryEngine.assessCapability(profile, [...profile.evidence, ...behavioralEvidence], []);

  console.log(`\nOrganization: ${company}`);
  
  assessments.forEach(a => {
    console.log(`\nSurface: ${a.surfaceId} (${a.surfaceType})`);
    console.log(`  Boundary: ${a.boundaryType}`);
    console.log(`  Auth Model: ${a.accessModel}`);
    console.log(`  Consistency: ${a.consistencyState}`);
    console.log(`  Exposure: ${a.exposureState}`);
    console.log(`  Capability: ${a.capabilityState}`);
    console.log(`  Unknowns: ${a.unknowns.join(', ') || 'None'}`);
    console.log(`  Next Safe Observation: ${a.requiredVerification}`);
  });
}

main().catch(console.error);
