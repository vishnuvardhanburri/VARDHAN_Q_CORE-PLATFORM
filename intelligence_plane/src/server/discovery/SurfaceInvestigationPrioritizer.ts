import { SurfaceSemanticAssessment } from './SemanticTypes';
import { ExposureAssessment } from './SemanticTypes';

export class SurfaceInvestigationPrioritizer {
  prioritize(
    assessments: SurfaceSemanticAssessment[], 
    exposures: ExposureAssessment[]
  ): { surfaceId: string, priority: string }[] {
    const priorities: { surfaceId: string, priority: string }[] = [];

    for (const a of assessments) {
      const exp = exposures.find(e => e.surfaceId === a.surfaceId);
      
      if (exp && exp.priority === 'HIGH') {
        priorities.push({ surfaceId: a.surfaceId, priority: 'HIGH_PRIORITY_OBSERVATION' });
      } else if (exp && exp.priority === 'MEDIUM') {
        priorities.push({ surfaceId: a.surfaceId, priority: 'MEDIUM_PRIORITY_OBSERVATION' });
      } else if (a.functionalRole === 'ADMINISTRATION' || a.functionalRole === 'AUTHENTICATION') {
        priorities.push({ surfaceId: a.surfaceId, priority: 'MEDIUM_PRIORITY_OBSERVATION' });
      } else {
        priorities.push({ surfaceId: a.surfaceId, priority: 'LOW_PRIORITY_OBSERVATION' });
      }
    }

    return priorities;
  }
}
