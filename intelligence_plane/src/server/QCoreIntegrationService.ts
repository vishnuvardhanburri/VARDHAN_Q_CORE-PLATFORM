import { TrustBoundaryValidator } from './TrustBoundaryValidator';
import type { VerifiedFindingContract } from './VerifiedFindingContract';
import type { Evidence } from './IntelligenceCase';
import type { IQCoreIntegrationService } from './QCoreSubmissionOrchestrator';

// We inline a simple HTTP client since @vardhan/qcore-sdk might not have the new schema
export class QCoreIntegrationService implements IQCoreIntegrationService {
  private readonly validator: TrustBoundaryValidator;

  constructor(private qcoreUrl: string = 'http://127.0.0.1:8080') {
    this.validator = new TrustBoundaryValidator();
  }

  async submitFinding(
    contract: VerifiedFindingContract,
    evidenceStore: Evidence[],
    actorWorkloadId?: string
  ): Promise<any> {
    if (!actorWorkloadId) {
      throw new Error('Missing actor workload identity — actorWorkloadId must be provided upstream.');
    }

    const validation = this.validator.validate(contract, evidenceStore);
    if (!validation.passed) {
      const codes = validation.failures.map(f => f.code).join(', ');
      throw new Error(`[TRUST-BOUNDARY] Contract rejected: ${codes}`);
    }

    const payload = {
      contract,
      actor_workload_id: actorWorkloadId
    };

    const response = await fetch(`${this.qcoreUrl}/api/v1/seal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Q-Core rejected submission: HTTP ${response.status} - ${errorText}`);
    }

    return await response.json();
  }
}
