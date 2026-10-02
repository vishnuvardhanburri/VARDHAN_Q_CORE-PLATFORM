import { 
  BoundaryAssessment, 
  AuthModel, 
  ConsistencyState, 
  CapabilityState,
  TrustBoundary 
} from './BoundaryTypes';
import { Evidence, ExternalSurface } from '../IntelligenceCase';

export class BoundaryEvidenceReconciler {
  reconcile(
    surface: any, 
    docEvidence: Evidence[], 
    behaviorEvidence: Evidence[], 
    historicalEvidence: Evidence[]
  ): BoundaryAssessment {
    const surfaceId = surface.id;
    const boundaryType = this.inferBoundaryType(surface.type);
    
    const docText = docEvidence.map(e => e.observed_behavior || '').join(' ').toLowerCase();
    const behText = behaviorEvidence.map(e => e.observed_behavior || '').join(' ').toLowerCase();
    
    let authModel: AuthModel = 'AUTH_MODEL_UNKNOWN';
    let consistency: ConsistencyState = 'INSUFFICIENT_EVIDENCE';
    let capability: CapabilityState = 'ENTRY_POINT_IDENTIFIED';
    let exposure = 'NONE';
    
    const supportingIds: string[] = [];
    const contradictingIds: string[] = [];
    const unknowns: string[] = [];

    const requiresAuth = docText.includes('auth') || docText.includes('login') || docText.includes('key');
    const isPublicDoc = docText.includes('public endpoint') || docText.includes('unauthenticated');

    if (requiresAuth) authModel = 'AUTH_EXPECTED';
    else if (isPublicDoc) authModel = 'AUTH_MODEL_KNOWN';
    else authModel = 'AUTH_REQUIREMENT_UNCLEAR';

    const isReachable = behaviorEvidence.length > 0;
    const behavesPublicly = behText.includes('200 ok') || behText.includes('success') || behText.includes('public');

    if (authModel === 'AUTH_EXPECTED' && behavesPublicly) {
      consistency = 'AUTH_BEHAVIOR_MISMATCH';
      capability = 'EXPOSURE_INDICATED';
      exposure = 'POTENTIAL_UNAUTHORIZED_ACCESS';
      contradictingIds.push(...behaviorEvidence.map(e => e.id));
    } else if (authModel === 'AUTH_MODEL_UNKNOWN' && behavesPublicly) {
      consistency = 'AUTH_MODEL_UNKNOWN';
      capability = 'PUBLIC_REACHABILITY_ONLY';
      authModel = 'AUTH_OBSERVED';
      supportingIds.push(...behaviorEvidence.map(e => e.id));
    } else if (authModel === 'AUTH_MODEL_KNOWN' && behavesPublicly) {
      consistency = 'EXPECTED_PUBLIC';
      capability = 'PUBLIC_REACHABILITY_ONLY';
      supportingIds.push(...behaviorEvidence.map(e => e.id));
    } else if (!isReachable) {
      consistency = 'INSUFFICIENT_EVIDENCE';
      unknowns.push('Surface not reachable via safe observation');
    } else {
      consistency = 'CONSISTENT';
      capability = 'ENTRY_POINT_IDENTIFIED';
    }

    if (historicalEvidence.length > 0) {
      if (consistency === 'CONSISTENT' || consistency === 'EXPECTED_PUBLIC') {
        consistency = 'HISTORICAL_ONLY';
        exposure = 'HISTORICAL_EXPOSURE';
      }
    }

    return {
      surfaceId,
      boundaryType,
      authModel,
      consistencyState: consistency,
      exposureState: exposure,
      capabilityState: capability,
      supportingEvidenceIds: supportingIds,
      contradictingEvidenceIds: contradictingIds,
      unknowns: unknowns,
      provenance: 'Boundary Evidence Reconciliation'
    };
  }

  private inferBoundaryType(type: string): TrustBoundary {
    if (type.includes('AUTH')) return 'AUTHENTICATION';
    if (type.includes('API')) return 'AUTHORIZATION';
    if (type.includes('STATUS')) return 'SERVICE_BOUNDARY';
    if (type.includes('STORAGE')) return 'DATA_BOUNDARY';
    return 'NETWORK_BOUNDARY';
  }
}
