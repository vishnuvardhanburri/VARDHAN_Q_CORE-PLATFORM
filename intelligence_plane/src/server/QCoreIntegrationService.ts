/**
 * VARDHAN — Q-CORE INTEGRATION SERVICE (Hardened)
 * ─────────────────────────────────────────────────────────────────────────────
 * Submits a VerifiedFindingContract to the Q-Core Sovereign Substrate.
 *
 * Trust model:
 *   1. Intelligence Plane populates a VerifiedFindingContract.
 *   2. TrustBoundaryValidator runs 14 independent checks client-side.
 *   3. If any check fails, the request is rejected before any network call.
 *   4. If all checks pass, the contract is submitted to Q-Core.
 *   5. Q-Core performs its own independent validation on receipt.
 *
 * The decision.state === 'VERIFIED_FINDING' label is NOT the trust decision.
 * The contract content and its validation results are.
 *
 * Identity separation:
 *   tenant_id         ← contract.organization.organization_id (customer org)
 *   source_identity   ← contract.intelligence.engine_id       (engine identity)
 *   version           ← contract.intelligence.engine_version
 *
 * Evidence integrity:
 *   The evidence data_hash submitted to Q-Core is derived from the sorted
 *   content_hashes in contract.evidence_refs — not from re-serialising raw
 *   evidence objects. This means Q-Core can independently audit the hash
 *   against what the Intelligence Plane declared in the contract.
 */

import { QCoreClient, QCoreValidationRequest, VardhanSealedReceipt } from '@vardhan/qcore-sdk';
import { TrustBoundaryValidator } from './TrustBoundaryValidator';
import type { VerifiedFindingContract } from './VerifiedFindingContract';
import type { Evidence } from './IntelligenceCase';
import { createHash } from 'crypto';

export class QCoreIntegrationService {
  private readonly client: QCoreClient;
  private readonly validator: TrustBoundaryValidator;

  constructor(qcoreUrl: string = 'http://localhost:8080') {
    this.client = new QCoreClient(qcoreUrl);
    this.validator = new TrustBoundaryValidator();
  }

  /**
   * Submit a VerifiedFindingContract to Q-Core for cryptographic sealing.
   *
   * Throws if:
   *   - any of the 14 trust-boundary checks fail
   *   - Q-Core rejects the request
   *   - network failure
   *
   * Returns:
   *   VardhanSealedReceipt — the cryptographically sealed governance receipt.
   */
  async submitFinding(
    contract: VerifiedFindingContract,
    evidenceStore: Evidence[]
  ): Promise<VardhanSealedReceipt> {
    // ── Step 1: Pre-flight validation ─────────────────────────────────────────
    const validation = this.validator.validate(contract, evidenceStore);
    if (!validation.passed) {
      const codes = validation.failures.map(f => f.code).join(', ');
      const detail = validation.failures
        .map(f => `  [${f.code}] ${f.message}`)
        .join('\n');
      throw new Error(
        `[TRUST-BOUNDARY] Contract rejected — ${validation.failures.length} failure(s) (${codes}):\n${detail}`
      );
    }

    // ── Step 2: Derive evidence package hash ──────────────────────────────────
    // Hash is computed from sorted evidence content_hashes declared in the
    // contract — not from re-serialising the raw evidence store.
    const evidenceHashInput = [...contract.evidence_refs]
      .sort((a, b) => a.evidence_id.localeCompare(b.evidence_id))
      .map(r => r.content_hash)
      .join('|');
    const dataHash = createHash('sha256').update(evidenceHashInput).digest('hex');

    // ── Step 3: Build the Q-Core request using separated identity fields ──────
    const request: QCoreValidationRequest = {
      tenant_id: contract.organization.organization_id,
      finding_id: contract.finding_id,
      provenance: {
        source_identity: contract.intelligence.engine_id,
        timestamp: contract.created_at,
        version: contract.intelligence.engine_version,
      },
      evidence_package: {
        evidence_id: `ev_pkg_${contract.finding_id}`,
        data_hash: dataHash,
        category: contract.technical_area,
      },
      decision_candidate: {
        action_type: 'SEAL_VERIFIED_FINDING',
        policy_reference: 'VARDHAN_CORE_INTELLIGENCE_POLICY_V1',
      },
    };

    // ── Step 4: Submit to Q-Core ──────────────────────────────────────────────
    const receipt = await this.client.sealTransaction(request);
    return receipt;
  }
}
