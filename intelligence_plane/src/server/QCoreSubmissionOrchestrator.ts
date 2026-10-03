import { VerificationToContractAdapter } from './VerificationToContractAdapter';
import { QCoreIntegrationService } from './QCoreIntegrationService';
import type { ProblemFinding } from './findings/ProblemFinding';
import type { IntelligenceRunContext } from './DeepTypes';
import type { Evidence } from './IntelligenceCase';
import type { VerifiedFindingContract } from './VerifiedFindingContract';

/** Interface that any Q-Core integration service must implement. */
export interface IQCoreIntegrationService {
  submitFinding(
    contract: VerifiedFindingContract,
    evidenceStore: Evidence[],
    actorWorkloadId?: string
  ): Promise<any>;
}

export class QCoreSubmissionOrchestrator {
  private qcoreService: IQCoreIntegrationService;

  constructor(qcoreService?: IQCoreIntegrationService | string) {
    if (qcoreService && typeof qcoreService === 'object') {
      this.qcoreService = qcoreService;
    } else {
      this.qcoreService = new QCoreIntegrationService(
        typeof qcoreService === 'string' ? qcoreService : 'http://127.0.0.1:8080'
      );
    }
  }

  /**
   * Orchestrates the submission of technically verified problem findings to Q-Core.
   *
   * ORCHESTRATION ONLY — no fabrication of identity, governance, or provenance.
   * Consumes the authoritative VerifiedFinding produced upstream by
   * FindingVerificationEngine.verify() and dispatches through:
   *   VerifiedFinding → VerificationToContractAdapter → QCoreIntegrationService
   *
   * Fail-closed: findings without an authoritative VerifiedFinding are skipped
   * with an error result. The adapter enforces strict field presence.
   * The runContext must be an authoritative IntelligenceRunContext from the
   * actual execution layer — never reconstructed at this boundary.
   */
  async submitFindings(
    problemFindings: ProblemFinding[],
    evidenceStore: Evidence[],
    runContext: IntelligenceRunContext,
    onProgress: (stage: string, msg: string) => void
  ): Promise<{ receipt?: any; error?: string; finding_id: string }[]> {
    const results = [];
    const submittedFindingIds = new Set<string>();

    for (const pf of problemFindings) {
      if (pf.verification_result.status !== 'VERIFIED') continue;

      onProgress('qcore', `Orchestrating verified technical finding: ${pf.finding_id}`);

      // Extract the authoritative verified finding produced upstream
      if (!pf.qcore_verified_finding) {
         onProgress('qcore', `Finding ${pf.finding_id} lacks authoritative VerifiedFinding — skipping Q-Core submission.`);
         results.push({ finding_id: pf.finding_id, error: 'Missing authoritative VerifiedFinding' });
         continue;
      }

      // Deduplicate: if multiple ProblemFindings reference the same VerifiedFinding,
      // submit only once to avoid redundant Q-Core sealing.
      const vfSignalId = pf.qcore_verified_finding.signal_id;
      if (submittedFindingIds.has(vfSignalId)) {
        onProgress('qcore', `Finding ${pf.finding_id} references already-submitted VerifiedFinding (signal_id: ${vfSignalId}) — deduplicating.`);
        results.push({ finding_id: pf.finding_id, error: 'Duplicate verified finding already submitted' });
        continue;
      }
      submittedFindingIds.add(vfSignalId);

      onProgress('qcore', `Finding ${pf.finding_id} has authoritative VerifiedFinding, preparing Q-Core contract...`);

      try {
        // Adapter strictly enforces field presence — no fallbacks fabricated here
        const contract = VerificationToContractAdapter.adapt(pf.qcore_verified_finding, runContext, evidenceStore);
        
        // Q-Core Tollbooth Submit — actor workload identity comes from runContext, never hardcoded
        const receipt = await this.qcoreService.submitFinding(contract, evidenceStore, runContext.actor_workload_id);
        
        onProgress('qcore', `✅ Q-Core SEAL SUCCESS for ${pf.finding_id}. Receipt ID: ${receipt.receipt_id}`);
        results.push({ finding_id: pf.finding_id, receipt });
      } catch (err: any) {
        onProgress('qcore', `❌ Q-Core SEAL FAILURE for ${pf.finding_id}: ${err.message}`);
        results.push({ finding_id: pf.finding_id, error: err.message });
      }
    }

    return results;
  }
}
