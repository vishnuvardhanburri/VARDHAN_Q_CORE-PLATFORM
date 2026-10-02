import { 
  InvestigationHypothesis, 
  ComplexityNode, 
  IntelligenceCase, 
  Evidence,
  TargetType
} from './IntelligenceCase';
import { CompanyResearchContext } from './CompanyResearchContext';

export interface TargetCandidate {
  targetId: string;
  url: string;
  targetType: TargetType;
  discoverySource: string;
  hypothesisId: string;
  observableProperty: string;
  verificationMethod: string;
  safeToProbe: boolean;
  authRequired: boolean;
  relevance: number; 
  rationale: string;
  method?: string;
  operation?: string;
  discoveryArtifact?: string;
}

export class VerificationTargetPlanner {
  /**
   * Discovers and ranks potential verification targets for a given hypothesis.
   * Implements the ObservablePublicBoundary model: targets are not just API endpoints.
   */
  async planTarget(
    hypothesis: InvestigationHypothesis, 
    caseData: IntelligenceCase, 
    context: CompanyResearchContext
  ): Promise<TargetCandidate | null> {
    const candidates: TargetCandidate[] = [];
    
    const surfaces = (caseData as any).intelligenceProfile?.surfaces;
    if (!surfaces) return null;

    const allSurfaces: {url: string, type: string}[] = [];
    
    if (surfaces.apiDeveloper) surfaces.apiDeveloper.forEach((u: string) => allSurfaces.push({url: u, type: 'API_DOCUMENTATION'}));
    if (surfaces.docs) surfaces.docs.forEach((u: string) => allSurfaces.push({url: u, type: 'API_DOCUMENTATION'}));
    if (surfaces.statusReliability) surfaces.statusReliability.forEach((u: string) => allSurfaces.push({url: u, type: 'PUBLIC_SURFACE'}));
    if (surfaces.architectureEngineering) surfaces.architectureEngineering.forEach((u: string) => allSurfaces.push({url: u, type: 'INFORMATIONAL_TARGET'}));
    if (surfaces.releasesChangelog) surfaces.releasesChangelog.forEach((u: string) => allSurfaces.push({url: u, type: 'INFORMATIONAL_TARGET'}));

    // Inspect evidence for explicitly discovered boundaries (API, JS, Status, etc.)
    caseData.evidence.forEach(e => {
      const text = (e.factualObservation || e.observed_behavior || '').toLowerCase();
      
      // 1. Explicit API Operations (extracted by ApiOperationParser)
      if (e.classification === 'SURFACE' && text.includes('documented executable operation')) {
        allSurfaces.push({url: e.public_url, type: 'EXECUTABLE_BEHAVIOR_TARGET'});
      }
      
      // 2. Public Status Components (e.g., status.example.com, or a /status page with observable state)
      if (e.classification === 'SURFACE' && (e.public_url.includes('status') || text.includes('status component'))) {
        allSurfaces.push({url: e.public_url, type: 'EXECUTABLE_BEHAVIOR_TARGET'});
      }

      // 3. Public Web Behavior (measurable runtime routes)
      if (e.classification === 'SURFACE' && text.includes('runtime behavior') && text.includes('measurable')) {
        allSurfaces.push({url: e.public_url, type: 'EXECUTABLE_BEHAVIOR_TARGET'});
      }
    });

    for (const surface of allSurfaces) {
      const score = this.calculateRelevance(surface, hypothesis);
      
      if (score.relevance > 0) {
        candidates.push({
          targetId: `tgt_${Math.random().toString(36).substr(2, 9)}`,
          url: surface.url,
          targetType: surface.type as any,
          discoverySource: 'PUBLIC_SURFACE_DISCOVERY',
          hypothesisId: hypothesis.id,
          observableProperty: score.property,
          verificationMethod: 'SAFE_OBSERVATION',
          safeToProbe: true,
          authRequired: false,
          relevance: score.relevance,
          rationale: score.rationale,
          method: score.method || 'GET',
          operation: score.operation || surface.url,
          discoveryArtifact: 'discovered_surface'
        });
      }
    }

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => b.relevance - a.relevance);
    
    const executable = candidates.filter(c => c.targetType === 'EXECUTABLE_BEHAVIOR_TARGET');
    if (executable.length > 0) return executable[0];

    return null; 
  }

  private calculateRelevance(surface: {url: string, type: string}, hypothesis: InvestigationHypothesis): {relevance: number, property: string, rationale: string, method?: string, operation?: string} {
    const area = hypothesis.technicalArea.toLowerCase();
    const url = surface.url.toLowerCase();
    const type = surface.type.toLowerCase();

    // Executable targets (API, Status, Runtime)
    if (type === 'executable_behavior_target') {
      if ((area.includes('api') || area.includes('orchestration') || area.includes('inference') || area.includes('data') || area.includes('reliability'))) {
        return {
          relevance: 0.9,
          property: 'runtime_behavior_and_headers',
          rationale: `Independently discovered public boundary is a direct target for ${area}.`,
          method: 'GET',
          operation: url
        };
      }
    }

    // Documentation Targets
    if (type === 'api_documentation' || type === 'informational_target') {
      if (area.includes('api') || area.includes('orchestration')) {
        return {
          relevance: 0.3,
          property: 'documented_constraints',
          rationale: `Documentation for ${area} provides context but is not an executable boundary.`
        };
      }
    }

    return { relevance: 0, property: '', rationale: '' };
  }
}
