import { VerifiedFinding } from './DeepTypes';

export interface DiagnosticOpportunity {
  finding_id: string;
  is_eligible: boolean;
  diagnostic_scope: 'LOCAL' | 'SUBSYSTEM' | 'SYSTEMIC' | 'UNKNOWN';
  root_cause_status: 'PUBLICLY_KNOWN_AND_RESOLVED' | 'PUBLICLY_KNOWN_BUT_UNRESOLVED' | 'PARTIALLY_KNOWN' | 'UNKNOWN' | 'CONTRADICTED';
  internal_evidence_needed: string[];
  measurable_outcome: string;
  remediation_hypotheses: string[];
  reasons: string[];
}

export class DiagnosticFitEngine {
  /**
   * Determines if a VerifiedFinding qualifies as a £15K Diagnostic Opportunity.
   */
  static evaluate(finding: VerifiedFinding): DiagnosticOpportunity {
    // RUNTIME PROTECTION: Reject forged VerifiedFinding objects.
    if (!finding._verified || !finding.verification_timestamp || !finding.proof_contract_id) {
      return {
        finding_id: finding.signal_id,
        is_eligible: false,
        diagnostic_scope: 'UNKNOWN',
        root_cause_status: 'CONTRADICTED',
        internal_evidence_needed: [],
        measurable_outcome: 'Invalid Verification Metadata',
        remediation_hypotheses: [],
        reasons: ['UNTRUSTED_FINDING: Missing required verification metadata. Finding must be produced by FindingVerificationEngine.'],
      };
    }

    const reasons: string[] = [];
    let isEligible = true;

    // 1. Root Cause Status
    const rootCauseStatus = this.determineRootCauseStatus(finding);
    if (rootCauseStatus === 'PUBLICLY_KNOWN_AND_RESOLVED' || rootCauseStatus === 'CONTRADICTED') {
      isEligible = false;
      reasons.push(`ROOT_CAUSE_STATUS: ${rootCauseStatus} — No uncertainty to reduce.`);
    }

    // 2. Internal Evidence Need
    const internalEvidence = this.identifyNeededInternalEvidence(finding);
    if (internalEvidence.length === 0) {
      isEligible = false;
      reasons.push('INTERNAL_EVIDENCE_NEED: No internal data identified that would materially change the conclusion.');
    }

    // 3. Bounded Investigation & Measurable Outcome
    const outcome = this.defineMeasurableOutcome(finding);
    if (!outcome) {
      isEligible = false;
      reasons.push('MEASURABLE_OUTCOME: No concrete technical metric identified for measurement.');
    }

    // 4. Technical Depth
    if (!this.hasTechnicalDepth(finding)) {
      isEligible = false;
      reasons.push('TECHNICAL_DEPTH: Finding lacks sufficient engineering depth for a diagnostic engagement.');
    }

    return {
      finding_id: finding.signal_id,
      is_eligible: isEligible,
      diagnostic_scope: this.determineScope(finding),
      root_cause_status: rootCauseStatus,
      internal_evidence_needed: internalEvidence,
      measurable_outcome: outcome || 'Unknown',
      remediation_hypotheses: this.generateRemediationHypotheses(finding),
      reasons: isEligible ? ['Satisfies diagnostic fit criteria'] : reasons,
    };
  }

  private static determineRootCauseStatus(finding: VerifiedFinding): DiagnosticOpportunity['root_cause_status'] {
    const text = (finding.excerpt + ' ' + finding.relevance).toLowerCase();
    if (text.includes('resolved by') || text.includes('fixed in version') || text.includes('resolution:')) {
      return 'PUBLICLY_KNOWN_AND_RESOLVED';
    }
    if (text.includes('suspected') || text.includes('likely caused by')) {
      return 'PARTIALLY_KNOWN';
    }
    // Check if it's known but not explicitly resolved
    if (text.includes('known issue') || text.includes('documented limitation')) {
      return 'PUBLICLY_KNOWN_BUT_UNRESOLVED';
    }
    return 'UNKNOWN';
  }

  private static identifyNeededInternalEvidence(finding: VerifiedFinding): string[] {
    const needs: string[] = [];
    const text = (finding.excerpt + ' ' + finding.relevance).toLowerCase();

    if (text.includes('latency') || text.includes('slow') || text.includes('timeout')) {
      needs.push('distributed traces', 'p99 latency metrics', 'database query logs');
    }
    if (text.includes('scaling') || text.includes('cpu') || text.includes('memory') || text.includes('oom')) {
      needs.push('infrastructure resource metrics', 'heap dumps', 'autoscaling logs');
    }
    if (text.includes('error') || text.includes('crash') || text.includes('exception')) {
      needs.push('application error logs', 'stack traces', 'exception telemetry');
    }
    if (text.includes('architecture') || text.includes('migration')) {
      needs.push('internal architecture diagrams', 'deployment configurations', 'service mesh topology');
    }

    return needs;
  }

  private static defineMeasurableOutcome(finding: VerifiedFinding): string | null {
    const text = (finding.excerpt + ' ' + finding.relevance).toLowerCase();
    if (text.includes('latency')) return 'reduction in response time (e.g. median or p95)';
    if (text.includes('scaling') || text.includes('throughput')) return 'increase in requests per second (RPS) per node';
    if (text.includes('error')) return 'reduction in error rate / 5xx responses';
    if (text.includes('memory') || text.includes('cpu')) return 'reduction in peak resource utilization';
    return null;
  }

  private static determineScope(finding: VerifiedFinding): DiagnosticOpportunity['diagnostic_scope'] {
    const text = (finding.excerpt + ' ' + finding.relevance).toLowerCase();
    if (text.includes('systemic') || text.includes('global') || text.includes('platform-wide')) return 'SYSTEMIC';
    if (text.includes('service') || text.includes('module') || text.includes('subsystem')) return 'SUBSYSTEM';
    return 'LOCAL';
  }

  private static hasTechnicalDepth(finding: VerifiedFinding): boolean {
    const depthKeywords = ['performance', 'scalability', 'reliability', 'distributed', 'database', 'infrastructure', 'architecture', 'observability', 'migration'];
    const text = (finding.excerpt + ' ' + finding.relevance).toLowerCase();

    // If the finding is an OBSERVED_LATENCY type, the measured behavior itself
    // constitutes engineering depth, regardless of vocabulary.
    if (finding.type === 'OBSERVED_LATENCY') return true;

    return depthKeywords.some(k => text.includes(k));
  }

  private static generateRemediationHypotheses(finding: VerifiedFinding): string[] {
    const hypotheses: string[] = [];
    const text = (finding.excerpt + ' ' + finding.relevance).toLowerCase();

    if (text.includes('latency') || text.includes('slow')) hypotheses.push('caching layer optimization', 'database query tuning');
    if (text.includes('scaling') || text.includes('capacity')) hypotheses.push('autoscaling policy refinement', 'horizontal pod autoscaling optimization');
    if (text.includes('error') || text.includes('reliability')) hypotheses.push('circuit breaker implementation', 'retry policy optimization');
    if (text.includes('architecture') || text.includes('migration')) hypotheses.push('service decomposition', 'api gateway refactoring');

    return hypotheses.length > 0 ? hypotheses : ['General technical optimization'];
  }
}
