import { ExternalSurface, ExternalSurfaceProfile } from './SurfaceTypes';
import {
  SurfaceSemanticAssessment,
  ExposureAssessment
} from './SemanticTypes';
import { SurfaceSemanticValidator } from './SurfaceSemanticValidator';
import { ExposureCorrelationEngine } from './ExposureCorrelationEngine';
import { ExternalExposureGraphEngine, ExposureGraph } from './ExternalExposureGraphEngine';
import { ExposureNarrativeGenerator } from './ExposureNarrativeGenerator';
import { Evidence } from '../IntelligenceCase';
import { VardhanSystemManager } from '../system/VardhanSystemManager';

export class ExternalSurfaceIntelligenceService {
  private validator = new SurfaceSemanticValidator();
  private correlator = new ExposureCorrelationEngine();
  private graphEngine = new ExternalExposureGraphEngine();
  private narrativeGen = new ExposureNarrativeGenerator();

  constructor(private manager: VardhanSystemManager) {}

  async generateSurfaceProfile(orgName: string, domain: string): Promise<ExternalSurfaceProfile> {
    // 1. Real Surface Discovery
    // We attempt to find surfaces using the search provider
    const surfaces: ExternalSurface[] = [];
    const query = `${domain} (api OR status OR admin OR docs OR developer)`;
    const results = await this.manager.search(query);

    if (results && results.length > 0) {
      for (const res of results) {
        surfaces.push({
          id: `s_${Math.random().toString(36).substr(2, 9)}`,
          url: res.url,
          type: this.inferSurfaceType(res.url)
        });
      }
    } else {
      // Fallback to common patterns if no search results to ensure we have a footprint to test
      surfaces.push(
        { id: 's_api', url: `https://api.${domain}`, type: 'API' },
        { id: 's_status', url: `https://status.${domain}`, type: 'STATUS' },
        { id: 's_admin', url: `https://admin.${domain}`, type: 'ADMIN' }
      );
    }

    // 2. Evidence Collection
    // For each surface, we do a light observation to get evidence
    const evidence: Evidence[] = [];
    for (const s of surfaces) {
      try {
        const response = await this.manager.controller.getFetcher()(s.url, {
          method: 'GET',
          headers: {},
          signal: AbortSignal.timeout(2000)
        });

        evidence.push({
          id: `e_${s.id}`,
          public_url: s.url,
          source_type: 'API_ENDPOINT',
          retrieved_at: new Date().toISOString(),
          observed_behavior: `Response status: ${response.status}`,
          evidence_text: `Surface ${s.url} returned ${response.status}`,
          provenance: {
            source_url: s.url,
            canonical_url: s.url,
            source_type: 'API_ENDPOINT',
            discovery_mechanism: 'API_DISCOVERY',
            retrieval_timestamp: new Date().toISOString(),
            provider: 'VARDHAN_OBSERVER',
            attribution: 'Direct Observation',
            classification: 'SURFACE'
          },
          evidence_origin: 'REAL_PUBLIC_OBSERVATION'
        } as any);
      } catch (e) {
        // Log failure but keep going
      }
    }

    // 3. Semantic Validation
    const assessments: SurfaceSemanticAssessment[] = [];
    for (const s of surfaces) {
      const assessment = await this.validator.validate(s, evidence, (this.manager as any).identityGraph || new Map());
      assessments.push(assessment);
    }

    // 4. Exposure Correlation
    const exposures = await this.correlator.correlate(assessments, [], [], []);

    // 5. Graph Construction
    const graph = await this.graphEngine.buildGraph(surfaces, assessments, evidence);

    // 6. Narrative Synthesis
    const narrative = this.narrativeGen.generateNarrative(orgName, graph, exposures);

    return {
      organizationName: orgName,
      domain,
      surfaces,
      assessments,
      exposures,
      narrative,
      evidence,
      graph
    };
  }

  private inferSurfaceType(url: string): string {
    if (url.includes('api')) return 'API';
    if (url.includes('status')) return 'STATUS';
    if (url.includes('admin')) return 'ADMIN';
    if (url.includes('docs')) return 'DOCUMENTATION';
    return 'SERVICE';
  }
}
