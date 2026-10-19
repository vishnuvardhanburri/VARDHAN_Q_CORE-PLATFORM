import { spawn, spawnSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

// Import the full contract types from the canonical definition
import type { VerifiedFindingContract } from '../VerifiedFindingContract.ts';

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
} from '../VerifiedFindingContract.ts';

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

function resolveReceiptBinary(): string | null {
  if (process.env.VARDHAN_RECEIPT_BIN && fs.existsSync(process.env.VARDHAN_RECEIPT_BIN)) {
    return process.env.VARDHAN_RECEIPT_BIN;
  }
  const root = path.resolve(__dirname, '../../../../');
  const candidates = [
    path.join(root, 'target/release/vardhan-receipt'),
    path.join(root, 'target/debug/vardhan-receipt'),
    path.join(process.cwd(), 'target/release/vardhan-receipt'),
    path.join(process.cwd(), 'target/debug/vardhan-receipt'),
    path.join(process.cwd(), '../target/release/vardhan-receipt'),
    path.join(process.cwd(), '../target/debug/vardhan-receipt'),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

export class QCoreAdapter {
  private apiBaseUrl: string;
  private authToken: string | null = null;

  constructor(apiBaseUrl?: string) {
    this.apiBaseUrl = apiBaseUrl || "http://localhost:8080";
  }

  public async setToken(token: string) {
    this.authToken = token;
  }

  public async validateAndSeal(request: QCoreValidationRequest, organizationId?: string): Promise<QCoreReceipt> {
    // 1. Attempt API Gateway call if online
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (this.authToken) {
        headers['Authorization'] = `Bearer ${this.authToken}`;
      }

      const response = await fetch(`${this.apiBaseUrl}/api/v1/seal`, {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
      });

      const bodyText = await response.text();
      let data: any = {};
      try {
        data = JSON.parse(bodyText);
      } catch {
        /* non-json body */
      }

      if (response.ok) {
        if (data.status === "SEALED_AND_PUBLISHED" || data.status === "SEALED_BUT_NOT_PUBLISHED") {
          return data.receipt;
        }
        if (data.receipt) {
          return data.receipt;
        }
        if (data.status === 'SEALED') {
          return data as QCoreReceipt;
        }
      } else if (data && (data.code || data.status)) {
        const status = data.code || data.status;
        return {
          receipt_id: data.receipt_id || 'NONE',
          schema_version: '1.0',
          transaction_id: data.transaction_id || 'NONE',
          status: status as any,
          tenant_id: request.contract?.organization?.organization_id || 'UNKNOWN',
          subject_id: request.contract?.finding_id || 'UNKNOWN',
          actor_identity: 'NONE',
          proposed_action: 'NONE',
          policy_id: 'NONE',
          policy_version: '1.0',
          evidence_commitments: [],
          authority_reference: 'NONE',
          decision: 'REJECTED',
          outcome_code: data.message || data.error || status,
          timestamp_ms: 0,
          ledger_commit_index: 0,
          payload_hash: 'NONE',
          issuer_key_fingerprint: 'NONE',
          signatures: { ed25519_sig: '', ed25519_key_id: '', ml_dsa_87_sig: '', ml_dsa_87_key_id: '' },
        };
      }
    } catch {
      // Network/HTTP unavailable — fallback to local canonical engine
    }

    // 2. Canonical local execution boundary (direct invocation of vardhan-receipt validate-canonical)
    const binPath = resolveReceiptBinary();
    if (binPath) {
      try {
        const child = spawnSync(binPath, ['validate-canonical'], {
          input: JSON.stringify(request),
          encoding: 'utf-8',
          timeout: 10000,
        });

        const stdout = (child.stdout || '').trim();
        const lines = stdout.split('\n').filter(Boolean);
        const lastLine = lines[lines.length - 1];
        if (lastLine) {
          const receipt = JSON.parse(lastLine) as QCoreReceipt;
          if (receipt && receipt.status) {
            return receipt;
          }
        }
      } catch (execErr) {
        console.error(`Local engine execution failed: ${execErr}`);
      }
    }

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
      outcome_code: 'Integration failed: receipt engine unavailable',
      timestamp_ms: 0,
      ledger_commit_index: 0,
      payload_hash: 'NONE',
      issuer_key_fingerprint: 'NONE',
      signatures: { ed25519_sig: '', ed25519_key_id: '', ml_dsa_87_sig: '', ml_dsa_87_key_id: '' },
      error_details: 'Integration failed: receipt engine unavailable',
    };
  }
}
