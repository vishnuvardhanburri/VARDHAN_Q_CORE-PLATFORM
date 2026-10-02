import { TargetVerificationEngine } from '../../src/server/TargetVerificationEngine';
import { LivePublicObservationProvider } from '../../src/server/LivePublicObservationProvider';
import { LiveTechnicalEvent, AffectedTargetCandidate } from '../../src/server/LiveIncidentModels';
import { IntelligenceCase } from '../../src/server/IntelligenceCase';

// Mock Observation Provider for deterministic testing
class MockObservationProvider extends LivePublicObservationProvider {
  private mockResponses: Record<string, any> = {};

  setResponse(url: string, response: any) {
    this.mockResponses[url] = response;
  }

  async observePublicSurface(url: string, options?: any) {
    const response = this.mockResponses[url];
    if (!response) {
      return {
        status: 'ERROR',
        evidence: [],
        observations: [],
        provider: 'MockProvider'
      } as any;
    }
    return {
      status: 'SUCCESS',
      evidence: response.evidence || [],
      observations: response.observations || [],
      provider: 'MockProvider'
    } as any;
  }
}

describe('TargetVerificationEngine Golden Corpus', () => {
  let engine: TargetVerificationEngine;
  let mockProvider: MockObservationProvider;

  beforeEach(() => {
    mockProvider = new MockObservationProvider();
    engine = new TargetVerificationEngine(mockProvider);
  });

  const createMockCase = (company: string, origin: string, pages: string[] = []): IntelligenceCase => ({
    company,
    company_surface: {
      company,
      origin,
      homepage: `https://${origin}`,
      discovered_pages: pages.map(p => ({ url: `https://${origin}${p}`, path: p, status: 200 })),
      page_categories: {}
    },
    evidence: [],
    signals: [],
    budget_state: { requestsUsed: 0, queriesUsed: 0, githubObservations: 0, stoppedEarly: false, pagesFetched: 0, technicalSurfaces: 0 }
  } as any);

  const createMockEvent = (id: string, provider: string, symptom: string, signature: any[] = []): LiveTechnicalEvent => ({
    id,
    source: 'StatusPage',
    sourceUrl: 'https://status.provider.com',
    eventType: 'SERVICE_OUTAGE',
    provider,
    symptom,
    signature,
    observedAt: new Date().toISOString(),
    provenance: { source_url: 'https://status.provider.com', discovery_mechanism: 'REGISTRY' } as any
  } as any);

  test('POSITIVE: Provider 503 + Target 503 (Direct Signature Match)', async () => {
    const event = createMockEvent('ev-1', 'Supabase', 'API Outage', [
      { type: 'STATUS_CODE', value: 503, operator: 'EQUALS' }
    ]);
    const targetCase = createMockCase('TargetCorp', 'target.com', ['/health']);
    const candidate: AffectedTargetCandidate = {
      id: 'can-1',
      targetCompany: 'TargetCorp',
      dependency: 'Supabase',
      dependencyConfidence: 'KNOWN_DEPENDENCY',
      liveEvent: event,
      temporalRelation: 'CURRENT',
      exposureEvidence: [],
      verificationTarget: 'https://target.com/health',
      verificationStatus: 'PENDING',
      provenance: { source_url: '...', discovery_mechanism: '...', canonical_url: '...', retrieval_timestamp: '...' } as any
    } as any;

    // Setup: Target is failing with 503, Control is healthy (200)
    mockProvider.setResponse('https://target.com/health', {
      evidence: [{ status: 503, raw_observation: 'Service Unavailable', id: 'ev-target' }]
    });
    mockProvider.setResponse('https://status.supabase.com/', {
      evidence: [{ status: 200, raw_observation: 'OK', id: 'ev-control' }]
    });

    const result = await engine.verify(candidate, targetCase);
    expect(result.status).toBe('VERIFIED');
    expect(result.report.differential_result).toBe('CONTROL_HEALTHY');
  });

  test('NEGATIVE: Provider Incident + Target Healthy (No Signature Match)', async () => {
    const event = createMockEvent('ev-2', 'AWS', 'S3 Latency', [
      { type: 'LATENCY', value: 1000, operator: 'GREATER_THAN' }
    ]);
    const targetCase = createMockCase('HealthyCorp', 'healthy.com', ['/health']);
    const candidate: AffectedTargetCandidate = {
      id: 'can-2',
      targetCompany: 'HealthyCorp',
      dependency: 'AWS',
      dependencyConfidence: 'KNOWN_DEPENDENCY',
      liveEvent: event,
      temporalRelation: 'CURRENT',
      exposureEvidence: [],
      verificationTarget: 'https://healthy.com/health',
      verificationStatus: 'PENDING',
      provenance: { source_url: '...', discovery_mechanism: '...', canonical_url: '...', retrieval_timestamp: '...' } as any
    } as any;

    // Setup: Target is fast (100ms), Control is healthy (200)
    mockProvider.setResponse('https://healthy.com/health', {
      evidence: [{ status: 200, latency_ms: 100, raw_observation: 'OK', id: 'ev-target' }]
    });
    mockProvider.setResponse('https://health.aws.amazon.com/', {
      evidence: [{ status: 200, raw_observation: 'OK', id: 'ev-control' }]
    });

    const result = await engine.verify(candidate, targetCase);
    expect(result.status).toBe('REFUTED');
  });

  test('NEGATIVE: Provider Incident + Target and Control both affected (Global Noise)', async () => {
    const event = createMockEvent('ev-3', 'Cloudflare', 'DNS Outage', [
      { type: 'STATUS_CODE', value: 502, operator: 'EQUALS' }
    ]);
    const targetCase = createMockCase('NoiseCorp', 'noise.com', ['/health']);
    const candidate: AffectedTargetCandidate = {
      id: 'can-3',
      targetCompany: 'NoiseCorp',
      dependency: 'Cloudflare',
      dependencyConfidence: 'KNOWN_DEPENDENCY',
      liveEvent: event,
      temporalRelation: 'CURRENT',
      exposureEvidence: [],
      verificationTarget: 'https://noise.com/health',
      verificationStatus: 'PENDING',
      provenance: { source_url: '...', discovery_mechanism: '...', canonical_url: '...', retrieval_timestamp: '...' } as any
    } as any;

    // Setup: Both target and control are 502 (global internet issue)
    mockProvider.setResponse('https://noise.com/health', {
      evidence: [{ status: 502, raw_observation: 'Bad Gateway', id: 'ev-target' }]
    });
    mockProvider.setResponse('https://www.cloudflarestatus.com/', {
      evidence: [{ status: 502, raw_observation: 'Bad Gateway', id: 'ev-control' }]
    });

    const result = await engine.verify(candidate, targetCase);
    expect(result.status).toBe('REFUTED');
    expect(result.report.differential_result).toBe('CONTROL_ALSO_AFFECTED');
  });

  test('INCONCLUSIVE: No evidence-derived endpoint', async () => {
    const event = createMockEvent('ev-4', 'Vercel', 'Edge Failure', []);
    const targetCase = createMockCase('GhostCorp', 'ghost.com', []); // No health page
    const candidate: AffectedTargetCandidate = {
      id: 'can-4',
      targetCompany: 'GhostCorp',
      dependency: 'Vercel',
      dependencyConfidence: 'KNOWN_DEPENDENCY',
      liveEvent: event,
      temporalRelation: 'CURRENT',
      exposureEvidence: [],
      verificationTarget: 'https://ghost.com/health',
      verificationStatus: 'PENDING',
      provenance: { source_url: '...', discovery_mechanism: '...', canonical_url: '...', retrieval_timestamp: '...' } as any
    } as any;

    const result = await engine.verify(candidate, targetCase);
    expect(result.status).toBe('INCONCLUSIVE');
    expect(result.report.reason).toContain('Blind probing forbidden');
  });
});
