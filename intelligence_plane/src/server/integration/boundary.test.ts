import { describe, beforeAll, expect, test } from "vitest";
import { QCoreAdapter, QCoreValidationRequest } from './QCoreAdapter';

describe('Vardhan Intelligence -> Q-Core Boundary Integration', () => {
  let adapter: QCoreAdapter;
  const VALID_TENANT_ID = '123e4567-e89b-12d3-a456-426614174000';
  const INVALID_TENANT_ID = '00000000-0000-0000-0000-000000000000';

  beforeAll(() => {
    adapter = new QCoreAdapter();
  });

  const createValidRequest = (): QCoreValidationRequest => ({
    tenant_id: VALID_TENANT_ID,
    finding_id: '987e6543-e21b-34d3-a456-426614174999',
    evidence_package: {
      evidence_id: '11111111-1111-1111-1111-111111111111',
      data_hash: 'abc123hash',
      category: 'NETWORK_ANOMALY',
    },
    decision_candidate: {
      action_type: 'QUARANTINE_IP',
      policy_reference: 'POL-NET-01',
    },
    provenance: {
      source_identity: 'intel-node-01',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
    },
  });

  test('1. Synthetic Verified Finding - Should seal successfully', async () => {
    const req = createValidRequest();
    const receipt = await adapter.validateAndSeal(req);

    expect(receipt.status).toBe('SEALED');
    expect(receipt.receipt_id).toBeTruthy();
    expect(receipt.schema_version).toBe('1.0');
    expect(receipt.transaction_id).toBeTruthy();
    expect(receipt.payload_hash).toBeTruthy();
    expect(receipt.issuer_key_fingerprint).toBeTruthy();
    expect(receipt.policy_id).toBeTruthy();
    expect(receipt.policy_version).toBe('1.0');
    expect(receipt.signatures.ed25519_sig).toBeTruthy();
    expect(receipt.signatures.ed25519_key_id).toBeTruthy();
    expect(receipt.signatures.ml_dsa_87_sig).toBeTruthy();
    expect(receipt.evidence_commitments).toBeInstanceOf(Array);
    expect(receipt.tenant_id).toBe(req.tenant_id);
    expect(receipt.subject_id).toBe(req.finding_id);
  });

  test('2. Negative Test - Tenant Mismatch / Unauthorized Tenant', async () => {
    const req = createValidRequest();
    req.tenant_id = INVALID_TENANT_ID;
    
    const receipt = await adapter.validateAndSeal(req);
    expect(receipt.status).toBe('REJECTED_UNAUTHORIZED');
    expect(receipt.outcome_code).toContain('Invalid Tenant ID');
  });

  test('3. Negative Test - Invalid Provenance (Missing Timestamp)', async () => {
    const req = createValidRequest();
    req.provenance.timestamp = '';
    
    const receipt = await adapter.validateAndSeal(req);
    expect(receipt.status).toBe('REJECTED_PROVENANCE');
    expect(receipt.outcome_code).toContain('Missing timestamp');
  });

  test('4. Negative Test - Unauthorized Action', async () => {
    const req = createValidRequest();
    req.decision_candidate.action_type = 'UNAUTHORIZED_ACTION';
    
    const receipt = await adapter.validateAndSeal(req);
    expect(receipt.status).toBe('REJECTED_UNAUTHORIZED');
    expect(receipt.outcome_code).toContain('violates tenant policy');
  });

  test('5. Negative Test - Malformed Payload', async () => {
    // Send a manually broken JSON structure to test the boundary parsing
    const rawBrokenPayload = {
      tenant_id: VALID_TENANT_ID,
      // missing required fields entirely
    } as any;
    
    const receipt = await adapter.validateAndSeal(rawBrokenPayload);
    expect(receipt.status).toBe('REJECTED_MALFORMED');
    expect(receipt.outcome_code).toContain('missing field');
  });
});
