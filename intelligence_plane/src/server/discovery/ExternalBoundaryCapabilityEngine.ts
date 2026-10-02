import { ExternalSurfaceProfile } from './ExternalSurfaceIntelligenceService';
import { Evidence } from '../IntelligenceCase';
import { 
  BoundaryCapabilityAssessment, 
  CapabilityState, 
  TrustBoundary, 
  AuthorizationState 
} from './BoundaryTypes';
import { BoundaryEvidenceReconciler } from './BoundaryEvidenceReconciler';

export class ExternalBoundaryCapabilityEngine {
  private reconciler = new BoundaryEvidenceReconciler();

  async assessCapability(
    profile: ExternalSurfaceProfile, 
    evidenceStore: Evidence[], 
    hypotheses: any[]
  ): Promise<BoundaryCapabilityAssessment[]> {
    const assessments: BoundaryCapabilityAssessment[] = [];

    for (const surface of profile.surfaces) {
      const surfaceEvidence = evidenceStore.filter(e => e.public_url === surface.url);
      
      const docEvidence = surfaceEvidence.filter(e => e.provenance.classification === 'DOCUMENT');
      const behaviorEvidence = surfaceEvidence.filter(e => e.provenance.classification === 'OBSERVATION');
      const historicalEvidence = surfaceEvidence.filter(e => e.provenance.attribution.includes('Historical'));

      const reconciled = this.reconciler.reconcile(surface, docEvidence, behaviorEvidence, historicalEvidence);

      assessments.push({
        surfaceId: surface.id,
        surfaceType: surface.type,
        boundaryType: reconciled.boundaryType,
        accessModel: reconciled.authModel,
        exposureState: reconciled.exposureState,
        capabilityState: reconciled.capabilityState,
        supportingEvidenceIds: reconciled.supportingEvidenceIds,
        contradictingEvidenceIds: reconciled.contradictingEvidenceIds,
        unknowns: reconciled.unknowns,
        requiredVerification: this.determineVerificationPath(reconciled.capabilityState),
        authorizationRequired: this.determineAuthRequirement(reconciled.capabilityState),
        confidence: 0.8,
        provenance: reconciled.provenance
      });
    }

    return assessments;
  }

  private determineVerificationPath(state: CapabilityState): string {
    switch (state) {
      case 'EXPOSURE_INDICATED': return 'Safe-probe for missing auth headers.';
      case 'CAPABILITY_INDICATED': return 'Analyze RBAC implementation via public metadata.';
      case 'ENTRY_POINT_IDENTIFIED': return 'Determine required authentication method.';
      default: return 'Observation of public behavior.';
    }
  }

  private determineAuthRequirement(state: CapabilityState): AuthorizationState {
    if (state === 'VERIFIED_CAPABILITY' || state === 'CAPABILITY_INDICATED') {
      return 'REQUIRED';
    }
    return 'NOT_REQUIRED';
  }
}
