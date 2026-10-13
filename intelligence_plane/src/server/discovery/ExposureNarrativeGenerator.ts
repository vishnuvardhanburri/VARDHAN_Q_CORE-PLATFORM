import { ExposureGraph } from './ExternalExposureGraphEngine';
import { SurfaceSemanticAssessment } from './SemanticTypes';
import { ExposureAssessment } from './SemanticTypes';

export class ExposureNarrativeGenerator {
  /**
   * Transforms a graph of surfaces and exposures into a human-readable technical narrative.
   */
  generateNarrative(
    orgName: string, 
    graph: ExposureGraph, 
    exposures: ExposureAssessment[]
  ): string {
    let narrative = `External Exposure Analysis for ${orgName}\n`;
    narrative += `==================================================\n\n`;

    if (exposures.length === 0) {
      narrative += `No high-interest exposure contradictions identified. Surfaces are consistent with public documentation.\n`;
      return narrative;
    }

    exposures.forEach((exp, i) => {
      const node = graph.nodes.get(exp.surfaceId);
      const relationships = graph.edges.filter(e => e.targetSurfaceId === exp.surfaceId);
      
      narrative += `${i+1}. Exposure: ${exp.exposureType}\n`;
      narrative += `   Surface: ${node?.surfaceId} (Role: ${node?.functionalRole})\n`;
      narrative += `   Reasoning: ${exp.rationale}\n`;
      
      if (relationships.length > 0) {
        narrative += `   Contextual Links:\n`;
        relationships.forEach(rel => {
          const source = graph.nodes.get(rel.sourceSurfaceId);
          narrative += `     - ${rel.sourceSurfaceId} (${source?.functionalRole}) ${rel.type} this surface\n`;
        });
      }
      narrative += `\n`;
    });

    return narrative;
  }
}
