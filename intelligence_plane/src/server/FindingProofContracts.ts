/**
 * VARDHAN — FINDING PROOF CONTRACTS
 * ─────────────────────────────────────────────────────────────────────────────
 * Defines the strict evidence requirements that must be satisfied for a
 * CandidateSignal to be promoted to a VerifiedFinding.
 */

import { SignalSourceType, SourceRelationship } from './IntelligenceCase';

export interface ProofContract {
  identity: {
    minimumRelationship: SourceRelationship;
    requireTargetAttribution: boolean;
  };
  evidence: {
    minimumEvidenceItems: number;
    minimumIndependentSources: number;
    requireIndependentSource: boolean;
    requireReproduction: boolean;
    allowHistorical?: boolean;
    requirePhysicalSurface?: boolean;
  };
  specificity: {
    requireTechnicalPivot: boolean;
    requireConcreteArtifact: boolean;
  };
  freshness?: {
    maxAgeDays: number;
  };
}

export const FINDING_PROOF_CONTRACTS: Record<string, ProofContract> = {
  'OBSERVED_LATENCY': {
    identity: {
      minimumRelationship: 'VERIFIED_OWNED',
      requireTargetAttribution: true,
    },
    evidence: {
      minimumEvidenceItems: 3,
      minimumIndependentSources: 1,
      requireIndependentSource: false,
      requireReproduction: true,
      allowHistorical: false,
      requirePhysicalSurface: true,
    },
    specificity: {
      requireTechnicalPivot: false,
      requireConcreteArtifact: true,
    },
  },
  'SCALING_PAIN': {
    identity: {
      minimumRelationship: 'VERIFIED_EXTERNAL',
      requireTargetAttribution: true,
    },
    evidence: {
      minimumEvidenceItems: 1,
      minimumIndependentSources: 2,
      requireIndependentSource: true,
      requireReproduction: false,
      allowHistorical: false,
      requirePhysicalSurface: true,
    },
    specificity: {
      requireTechnicalPivot: true,
      requireConcreteArtifact: true,
    },
  },
  'ARCHITECTURE_SHIFT': {
    identity: {
      minimumRelationship: 'VERIFIED_EXTERNAL',
      requireTargetAttribution: true,
    },
    evidence: {
      minimumEvidenceItems: 1,
      minimumIndependentSources: 2,
      requireIndependentSource: true,
      requireReproduction: false,
      allowHistorical: false,
      requirePhysicalSurface: true,
    },
    specificity: {
      requireTechnicalPivot: true,
      requireConcreteArtifact: true,
    },
  },
};

export function getContractForType(type: string): ProofContract | null {
  return FINDING_PROOF_CONTRACTS[type] || null;
}
