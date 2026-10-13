import { ExternalSurface, SurfaceType } from './SurfaceTypes';
import { SurfaceSemanticAssessment } from './SemanticTypes';

export interface SurfaceSnapshot {
  timestamp: Date;
  surfaceId: string;
  role: string;
  authModel: string;
  state: string;
}

export interface SurfaceChange {
  surfaceId: string;
  changeType: 'NEW_SURFACE' | 'ROLE_CHANGE' | 'AUTH_MODEL_CHANGE' | 'STATE_CHANGE';
  previousValue: any;
  currentValue: any;
  timestamp: Date;
}

export class SurfaceChangeDetectionEngine {
  /**
   * Compares current surface state against a previous snapshot.
   */
  detectChanges(previous: Map<string, SurfaceSnapshot>, current: Map<string, SurfaceSemanticAssessment>): SurfaceChange[] {
    const changes: SurfaceChange[] = [];

    current.forEach((curr, id) => {
      const prev = previous.get(id);
      if (!prev) {
        changes.push({
          surfaceId: id,
          changeType: 'NEW_SURFACE',
          previousValue: null,
          currentValue: curr.functionalRole,
          timestamp: new Date()
        });
        return;
      }

      if (prev.role !== curr.functionalRole) {
        changes.push({
          surfaceId: id,
          changeType: 'ROLE_CHANGE',
          previousValue: prev.role,
          currentValue: curr.functionalRole,
          timestamp: new Date()
        });
      }

      if (prev.authModel !== curr.authExpectation) {
        changes.push({
          surfaceId: id,
          changeType: 'AUTH_MODEL_CHANGE',
          previousValue: prev.authModel,
          currentValue: curr.authExpectation,
          timestamp: new Date()
        });
      }
    });

    return changes;
  }
}
