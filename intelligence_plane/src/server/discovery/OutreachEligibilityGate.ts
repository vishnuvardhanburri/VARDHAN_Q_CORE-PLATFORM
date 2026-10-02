import { OpportunityEvidencePacket } from './SemanticTypes';

export class OutreachEligibilityGate {
  /**
   * Determines if an Evidence Packet is ready for human-led outreach.
   * Hard Invariants:
   * - No evidence = Not eligible.
   * - Research_More = Not eligible.
   * - No Actionable Signal = Not eligible.
   * - Reject = Not eligible.
   */
  checkEligibility(packet: OpportunityEvidencePacket): { eligible: boolean; gaps: string[] } {
    const gaps: string[] = [];

    // 1. Basic Identity
    if (!packet.organization || !packet.domain) {
      gaps.push('Missing basic organization identity');
    }

    // 2. Hard Evidence Invariant
    const evidenceCount = packet.supportingEvidence ? packet.supportingEvidence.length : 0;
    if (evidenceCount === 0) {
      gaps.push('Zero supporting evidence: cannot proceed to outreach');
    }

    // 3. Decision State Invariants
    const state = packet.decision.state;
    if (state === 'RESEARCH_MORE') {
      gaps.push('State is RESEARCH_MORE: further research required before outreach');
    } else if (state === 'NO_ACTIONABLE_SIGNAL') {
      gaps.push('State is NO_ACTIONABLE_SIGNAL: no valid opportunity identified');
    } else if (state === 'REJECT') {
      gaps.push('State is REJECT: organization specifically rejected');
    }

    // 4. Provenance check
    if (!packet.provenance || packet.provenance === 'UNKNOWN') {
      gaps.push('Missing source provenance');
    }

    // 5. Speculation check
    if (packet.decisionReason && (
      packet.decisionReason.toLowerCase().includes('maybe') ||
      packet.decisionReason.toLowerCase().includes('possibly')
    )) {
      gaps.push('Decision reasoning is too speculative for outreach');
    }

    return {
      eligible: gaps.length === 0,
      gaps
    };
  }
}
