import { 
  SurfaceSemanticAssessment, 
  SurfaceRelationship, 
  SurfaceRelationshipType 
} from './SemanticTypes';
import { ExternalSurface } from './SurfaceTypes';
import { Evidence } from '../IntelligenceCase';

export interface ExposureGraph {
  nodes: Map<string, SurfaceSemanticAssessment>;
  edges: SurfaceRelationship[];
}

export class ExternalExposureGraphEngine {
  /**
   * Constructs a relational graph of surfaces and identifies meaningful paths.
   */
  async buildGraph(
    surfaces: ExternalSurface[], 
    assessments: SurfaceSemanticAssessment[], 
    evidence: Evidence[]
  ): Promise<ExposureGraph> {
    const nodes = new Map<string, SurfaceSemanticAssessment>();
    const edges: SurfaceRelationship[] = [];

    assessments.forEach(a => nodes.set(a.surfaceId, a));

    // Relationship Inference Engine
    for (const a of assessments) {
      for (const b of assessments) {
        if (a.surfaceId === b.surfaceId) continue;

        // Pattern 1: Auth -> API (AUTHENTICATES)
        if (a.functionalRole === 'AUTHENTICATION' && b.functionalRole === 'API') {
          edges.push({
            sourceSurfaceId: a.surfaceId,
            targetSurfaceId: b.surfaceId,
            type: 'AUTHENTICATES',
            evidenceIds: [],
            rationale: 'Authentication surface discovered for API surface on same organizational footprint.'
          });
        }

        // Pattern 2: Admin -> Service (MANAGES)
        if (a.functionalRole === 'ADMINISTRATION' && b.functionalRole === 'SERVICE') {
          edges.push({
            sourceSurfaceId: a.surfaceId,
            targetSurfaceId: b.surfaceId,
            type: 'MANAGES',
            evidenceIds: [],
            rationale: 'Administrative surface discovered that appears to manage the target service.'
          });
        }

        // Pattern 3: Docs -> API (DOCUMENTS)
        if (a.functionalRole === 'DOCUMENTATION' && b.functionalRole === 'API') {
          edges.push({
            sourceSurfaceId: a.surfaceId,
            targetSurfaceId: b.surfaceId,
            type: 'DOCUMENTS',
            evidenceIds: [],
            rationale: 'Documentation surface provides reference for the API surface.'
          });
        }
      }
    }

    return { nodes, edges };
  }
}
