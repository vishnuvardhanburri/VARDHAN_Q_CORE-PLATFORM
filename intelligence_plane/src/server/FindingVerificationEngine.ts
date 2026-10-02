import {
  SignalCandidate,
  DeepSignal,
  VerifiedFinding
} from './DeepTypes';
import {
  Evidence,
  SourceRelationship
} from './IntelligenceCase';
import {
  getContractForType,
  ProofContract
} from './FindingProofContracts';

export interface SubjectAttribution {
  subject: 'TARGET_COMPANY' | 'CUSTOMER' | 'PARTNER' | 'VENDOR' | 'INDUSTRY' | 'UNKNOWN';
  basis: string;
}

export interface VerificationResult {
  isVerified: boolean;
  verifiedFinding?: VerifiedFinding;
  reasons: string[];
  status: 'VERIFIED' | 'REJECTED' | 'CONTEXT_ONLY';
  attribution?: SubjectAttribution;
}

export class FindingVerificationEngine {
  /**
   * Evaluates a candidate signal against its proof contract.
   * PROOF must be derived from evidence, not candidate wording.
   */
  static verify(
    candidate: SignalCandidate,
    evidence: Evidence[],
    companyName: string
  ): VerificationResult {
    const contract = getContractForType(candidate.type);
    const reasons: string[] = [];

    if (!contract) {
      return { isVerified: false, reasons: ['NO_PROOF_CONTRACT: No verification contract defined for this signal type.'], status: 'REJECTED' };
    }

    // 1. DERIVE ATTRIBUTION FROM EVIDENCE (Not from candidate text)
    const attribution = this.deriveAttribution(evidence, candidate.evidence_ids);

    // Check if the derived attribution satisfies the contract's minimum relationship
    const hasRequiredIdentity = evidence
      .filter(e => candidate.evidence_ids.includes(e.id))
      .some(e => {
        const rel = e.relationship_type || 'UNVERIFIED';
        if (rel === 'VERIFIED_OWNED') return true;
        if (rel === 'VERIFIED_EXTERNAL' && contract.identity.minimumRelationship !== 'VERIFIED_OWNED') return true;
        return false;
      });

    if (!hasRequiredIdentity) {
      reasons.push(`IDENTITY_FAILURE: Requires ${contract.identity.minimumRelationship}`);
      return { isVerified: false, reasons, status: 'REJECTED', attribution };
    }

    // Attribution check: Is the subject actually the target company?
    if (contract.identity.requireTargetAttribution && attribution.subject !== 'TARGET_COMPANY') {
      reasons.push(`ATTRIBUTION_FAILURE: Subject is ${attribution.subject} (${attribution.basis}), not TARGET_COMPANY`);
      return { isVerified: false, reasons, status: 'CONTEXT_ONLY', attribution };
    }

    // 2. EVIDENCE QUANTITY & TYPE
    const relatedEvidence = evidence.filter(e => candidate.evidence_ids.includes(e.id));
    if (relatedEvidence.length < contract.evidence.minimumEvidenceItems) {
      reasons.push(`INSUFFICIENT_EVIDENCE: Requires ${contract.evidence.minimumEvidenceItems} items`);
      return { isVerified: false, reasons, status: 'REJECTED', attribution };
    }


    // 2.5 STRICT BOUNDARY & TEMPORAL CHECKS (Vardhan Quality Model)
    const hasHistorical = relatedEvidence.some(e => e.temporal_status === 'HISTORICAL');
    const isContextArtifact = relatedEvidence.some(e => e.is_context_artifact === true);

    if (hasHistorical && !contract.evidence.allowHistorical) {
      reasons.push('TEMPORAL_CONTAMINATION: Historical evidence cannot be used to verify a current finding');
      return { isVerified: false, reasons, status: 'REJECTED', attribution };
    }

    if (isContextArtifact && contract.evidence.requirePhysicalSurface) {
      reasons.push('PHYSICAL_SURFACE_FAILURE: Context artifacts (e.g. docs, github) cannot be used to verify a live physical vulnerability');
      return { isVerified: false, reasons, status: 'REJECTED', attribution };
    }

    // 3. REPRODUCIBILITY (Evidence-derived)
    if (contract.evidence.requireReproduction) {
      const allRepeatable = relatedEvidence.every(e => e.repeatable === true);
      if (!allRepeatable) {
        reasons.push('REPRODUCTION_FAILURE: Behavioral evidence not repeatable');
        return { isVerified: false, reasons, status: 'REJECTED', attribution };
      }
    }

    // 4. SPECIFICITY (Evidence-derived)
    if (contract.specificity.requireTechnicalPivot) {
      if (!this.hasTechnicalPivotInEvidence(relatedEvidence)) {
        reasons.push('SPECIFICITY_FAILURE: No concrete technical pivot detected in evidence');
        return { isVerified: false, reasons, status: 'REJECTED', attribution };
      }
    }

    // 5. CORROBORATION (Independent Sources)
    if (contract.evidence.requireIndependentSource) {
      // CORROBORATION FIX: Count genuinely independent provenance sources.
      // We use public_url as the primary identity of a source artifact.
      const independentSources = new Set(
        relatedEvidence
          .map(e => e.public_url?.replace(/\/$/, '') || e.id)
          .filter(Boolean)
      );

      if (independentSources.size < contract.evidence.minimumIndependentSources) {
        reasons.push(`CORROBORATION_FAILURE: Requires ${contract.evidence.minimumIndependentSources} independent source artifacts; found ${independentSources.size}`);
        return { isVerified: false, reasons, status: 'REJECTED', attribution };
      }
    }

    // PROMOTED TO VERIFIED FINDING
    return {
      isVerified: true,
      status: 'VERIFIED',
      reasons: ['Proof contract satisfied'],
      attribution,
      verifiedFinding: {
        signal_id: `sig_${candidate.id}`,
        type: candidate.type,
        source_url: candidate.source_url,
        excerpt: candidate.raw_match,
        provenance: candidate.provenance as any,
        signal_strength: candidate.initial_strength,
        relevance: `Verified finding of type ${candidate.type} satisfying proof contract.`,
        related_evidence_ids: candidate.evidence_ids,
        verification_timestamp: new Date().toISOString(),
        proof_contract_id: candidate.type,
        verification_reasons: ['Proof contract satisfied'],
        _verified: true,
      }
    };
  }

  private static deriveAttribution(evidence: Evidence[], evidenceIds: string[]): SubjectAttribution {
    const related = evidence.filter(e => evidenceIds.includes(e.id));
    if (related.length === 0) return { subject: 'UNKNOWN', basis: 'NO_EVIDENCE' };

    // Priority: VERIFIED_OWNED takes precedence
    if (related.some(e => e.relationship_type === 'VERIFIED_OWNED')) {
      return { subject: 'TARGET_COMPANY', basis: 'VERIFIED_OWNED_SOURCE' };
    }

    // Check for explicit mentions of target vs others in the evidence text
    // (Simplified for this audit: assume relationship_type handles the core logic)
    if (related.some(e => e.relationship_type === 'VERIFIED_EXTERNAL')) {
      return { subject: 'TARGET_COMPANY', basis: 'VERIFIED_EXTERNAL_SOURCE' };
    }

    return { subject: 'UNKNOWN', basis: 'UNVERIFIED_SOURCE' };
  }

  private static hasTechnicalPivotInEvidence(evidence: Evidence[]): boolean {
    const pivotPatterns = [
      /\bmigrating\s+from\b/i,
      /\bmoving\s+from\b/i,
      /\breplacing\b/i,
      /\bdeprecated\b/i,
      /\bin\s+favor\s+of\b/i,
      /\btransitioning\s+to\b/i,
    ];
    // Search the actual evidence text, NOT the candidate raw_match
    return evidence.some(e => {
      const text = (e.text || '').toLowerCase();
      return pivotPatterns.some(p => p.test(text));
    });
  }
}
