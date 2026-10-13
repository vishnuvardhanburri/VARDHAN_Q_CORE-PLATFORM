import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

// Import the full contract types from the canonical definition
import { VerifiedFindingContract } from '../VerifiedFindingContract';

// Re-export the full contract types so tests can import them from here
export type {
  VerifiedFindingContract,
  IntelligenceIdentity,
  OrganizationIdentity,
  ResourceIdentity,
  EvidenceRef,
  ProvenanceChain,
  AuthorizationContext,
  FINDING_CONTRACT_VERSION,
  computeEvidenceContentHash,
  VARDHAN_CORE_INTELLIGENCE_POLICY_V1,
  SEAL_VERIFIED_FINDING,
  REQUIRED_DECISION_CANDIDATES,
} from '../VerifiedFindingContract';

// Receipt Model
export interface DualSignature {
  ed25519_sig: string;
  ed25519_key_id: string;
  ml_dsa_87_sig: string;
  ml_dsa_87_key_id: string;
}

export interface EvidenceCommitment {
  evidence_id: string;
  content_hash: string;
  category: string;
}

export interface QCoreReceipt {
  receipt_id: string;
  schema_version: string;
  transaction_id: string;
  status: 'SEALED' | 'REJECTED_UNAUTHORIZED' | 'REJECTED_MALFORMED' | 'REJECTED_PROVENANCE' | 'ERROR';
  tenant_id: string;
  subject_id: string;
  actor_identity: string;
  proposed_action: string;
  policy_id: string;
  policy_version: string;
  evidence_commitments: EvidenceCommitment[];
  authority_reference: string;
  decision: string;
  outcome_code: string;
  timestamp_ms: number;
  ledger_commit_index: number;
  payload_hash: string;
  issuer_key_fingerprint: string;
  signatures: DualSignature;
  parent_receipt_id?: string;
  correlation_id?: string;
  error_details?: string;
}

export interface QCoreValidationRequest {
  contract: VerifiedFindingContract;
  actor_workload_id: string;
}

export class QCoreAdapter {
  private apiBaseUrl: string;

  constructor(apiBaseUrl?: string) {
    this.apiBaseUrl = apiBaseUrl || "http://localhost:8080";
  }

  public async validateAndSeal(request: QCoreValidationRequest, organizationId: string): Promise<QCoreReceipt> {
    try {
      const response = await fetch(`${this.apiBaseUrl}/api/v1/organizations/${organizationId}/security/validate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Q-Core API error: ${response.statusText}`);
      }

      return await response.json();
    } catch (e) {
      console.error(`Q-Core Integration Error: ${e}`);
      return {
        receipt_id: 'NONE',
        schema_version: '1.0',
        transaction_id: 'NONE',
        status: 'ERROR',
        tenant_id: request.contract?.organization?.organization_id || 'UNKNOWN',
        subject_id: request.contract?.finding_id || 'UNKNOWN',
        actor_identity: 'NONE',
        proposed_action: 'NONE',
        policy_id: 'NONE',
        policy_version: '1.0',
        evidence_commitments: [],
        authority_reference: 'NONE',
        decision: 'REJECTED',
        outcome_code: `Integration failed: ${e instanceof Error ? e.message : 'Unknown'}`,
        timestamp_ms: 0,
        ledger_commit_index: 0,
        payload_hash: 'NONE',
        issuer_key_fingerprint: 'NONE',
        signatures: { ed25519_sig: '', ed25519_key_id: '', ml_dsa_87_sig: '', ml_dsa_87_key_id: '' },
        error_details: `Integration failed: ${e instanceof Error ? e.message : 'Unknown'}`
      };
    }
  }
}
