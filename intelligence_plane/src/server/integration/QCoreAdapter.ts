import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

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
  tenant_id: string;
  finding_id: string;
  evidence_package: {
    evidence_id: string;
    data_hash: string;
    category: string;
  };
  decision_candidate: {
    action_type: string;
    policy_reference: string;
  };
  provenance: {
    source_identity: string;
    timestamp: string;
    version: string;
  };
}

export class QCoreAdapter {
  private binaryPath: string;

  constructor(binaryPath?: string) {
    this.binaryPath = binaryPath || path.resolve(__dirname, '../../../../target/release/vardhan-receipt');
    if (!fs.existsSync(this.binaryPath)) {
        console.warn(`WARNING: Q-Core binary not found at ${this.binaryPath}. Ensure cargo build --release was run.`);
    }
  }

  public async validateAndSeal(request: QCoreValidationRequest): Promise<QCoreReceipt> {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify(request);

      const process = spawn(this.binaryPath, ['validate-canonical']);

      let stdoutData = '';
      let stderrData = '';

      process.stdout.on('data', (data) => {
        stdoutData += data.toString();
      });

      process.stderr.on('data', (data) => {
        stderrData += data.toString();
      });

      process.on('close', (code) => {
        // Even on validation failures (like REJECTED_UNAUTHORIZED), the binary returns JSON with status.
        try {
          // Parse the last JSON object from stdout
          const lines = stdoutData.trim().split('\n');
          const lastLine = lines[lines.length - 1];
          if (!lastLine) {
            throw new Error(`Empty response from Q-Core. Stderr: ${stderrData}`);
          }
          const receipt: QCoreReceipt = JSON.parse(lastLine);
          resolve(receipt);
        } catch (e) {
          resolve({
            receipt_id: 'NONE',
            schema_version: '1.0',
            transaction_id: 'NONE',
            status: 'ERROR',
            tenant_id: request.tenant_id,
            subject_id: request.finding_id,
            actor_identity: 'NONE',
            proposed_action: 'NONE',
            policy_id: 'NONE',
            policy_version: '1.0',
            evidence_commitments: [],
            authority_reference: 'NONE',
            decision: 'REJECTED',
            outcome_code: `Failed to parse Q-Core response: ${e instanceof Error ? e.message : 'Unknown'}. Output: ${stdoutData}`,
            timestamp_ms: 0,
            ledger_commit_index: 0,
            payload_hash: 'NONE',
            issuer_key_fingerprint: 'NONE',
            signatures: { ed25519_sig: '', ed25519_key_id: '', ml_dsa_87_sig: '', ml_dsa_87_key_id: '' },
            error_details: `Failed to parse Q-Core response: ${e instanceof Error ? e.message : 'Unknown'}. Output: ${stdoutData}`
          });
        }
      });

      process.stdin.write(payload);
      process.stdin.end();
    });
  }
}
