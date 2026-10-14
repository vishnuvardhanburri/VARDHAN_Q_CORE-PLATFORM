import * as crypto from 'crypto';
import { blake3 } from '@noble/hashes/blake3.js';
import * as mldsa from '@noble/post-quantum/ml-dsa.js';
import type { VerifiedFindingContract } from '../VerifiedFindingContract.ts';

export interface DualSignature {
  ed25519_sig: string;
  ed25519_key_id: string;
  ml_dsa_87_sig: string;
  ml_dsa_87_key_id: string;
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
  evidence_commitments: any[];
  authority_reference: string;
  decision: string;
  outcome_code: string;
  timestamp_ms: number;
  ledger_commit_index: number;
  payload_hash: string;
  issuer_key_fingerprint: string;
  signatures: DualSignature;
}

export class RealControlPlane {
  private edKey: crypto.KeyObject;
  private edPubKey: string;
  private pqKey: any;
  private fingerprint: string;

  constructor() {
    // The RealControlPlane now uses the persistent keystore's public identity
    // to align with the Rust verifier.
    this.edPubKey = '2b89d047a43f62ced1f5358f24850e02444355cc34378d6b2b5a3b57276c922e';
    this.fingerprint = '736b6d8c72dfa3aa92af7a76154dbd502d626aad85fd393b8b7dac37c09a37ec';
  }

  // EXACT canonicalization as required by vardhan_verifier
  public canonicalize(receipt: any): Buffer {
    const evidence = (receipt.evidence_commitments || []).map((item: any) =>
      `${item.evidence_id}:${item.content_hash}:${item.category}`
    ).join(';');

    const fields = [
      receipt.schema_version, receipt.receipt_id, receipt.transaction_id,
      receipt.tenant_id, receipt.subject_id, receipt.actor_identity,
      receipt.proposed_action, receipt.policy_id, receipt.policy_version,
      receipt.state_hash_at_decision || '', evidence,
      receipt.authority_reference, receipt.decision, receipt.outcome_code,
      receipt.timestamp_ms.toString(), receipt.ledger_commit_index.toString(),
      receipt.parent_receipt_id || '', receipt.correlation_id || '',
    ];

    let encoded = '';
    for (const field of fields) {
      const f = String(field);
      encoded += f.length + ':' + f + '|';
    }

    return Buffer.from(encoded, 'utf8');
  }

  public calculateHash(payload: Buffer): string {
    return Buffer.from(blake3(payload)).toString('hex');
  }

  public async seal(request: any, orgId: string): Promise<QCoreReceipt> {
    const receiptId = `VQR-${crypto.randomUUID()}`;
    const txId = crypto.randomUUID();

    const receipt: any = {
      receipt_id: receiptId,
      schema_version: "1.1",
      transaction_id: txId,
      status: 'SEALED',
      tenant_id: orgId,
      subject_id: request.contract.finding.finding_id,
      actor_identity: request.actor_workload_id,
      proposed_action: 'MIGRATE',
      policy_id: request.contract.capability_mapping.capability_id,
      policy_version: "1.0",
      evidence_commitments: [],
      authority_reference: "VARDHAN-ROOT-AUTH",
      decision: "AUTHORIZED",
      outcome_code: "OK",
      timestamp_ms: Date.now(),
      ledger_commit_index: 1,
      issuer_key_fingerprint: this.fingerprint,
    };

    const payload = this.canonicalize(receipt);
    const hash = this.calculateHash(payload);
    receipt.payload_hash = hash;

    // The verifier expects the BLAKE3 hash of the canonical payload.
    // In Rust, blake3::hash(&payload).to_string() returns the hex string.
    // We sign the UTF-8 bytes of this hex string.
    const signedData = Buffer.from(hash, 'utf8');

    // Real Ed25519 Signing
    const signature = crypto.sign(null, signedData, this.edKey);

    receipt.signatures = {
      ed25519_sig: signature.toString('hex'),
      ed25519_key_id: "ed-real-01",
      ml_dsa_87_sig: Buffer.from(mldsa.ml_dsa87.sign(signedData, this.pqKey.secretKey)).toString('hex'),
      ml_dsa_87_key_id: "pq-real-01",
    };

    return receipt as QCoreReceipt;
  }
}
