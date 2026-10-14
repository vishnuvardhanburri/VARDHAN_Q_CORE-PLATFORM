import { describe, beforeAll, expect, test } from "vitest";
import { QCoreAdapter, QCoreValidationRequest } from './QCoreAdapter.ts';
import {
  VerifiedFindingContract,
  FINDING_CONTRACT_VERSION,
  VARDHAN_CORE_INTELLIGENCE_POLICY_V1,
  SEAL_VERIFIED_FINDING,
} from '../VerifiedFindingContract';

// Dev-mode tenants from backend/vardhan_receipt/src/auth_config.rs default_for_development()
const VALID_TENANT_ID = 'org-vardhan-intelligence';
const AUTHORIZED_ACTOR_PREFIX = 'svc:vardhan-intelligence:';
const INVALID_TENANT_ID = '00000000-0000-0000-0000-000000000000';

const NOW_ISO = new Date().toISOString();
const VALID_CONTENT_HASH = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';

function createValidContract(overrides: Partial<VerifiedFindingContract> = {}): VerifiedFindingContract {
  return {
    schema_version: FINDING_CONTRACT_VERSION,
    finding_id: '987e6543-e21b-34d3-a456-426614174999',
    intelligence: {
      engine_id: 'intel-node-01',
      engine_version: '1.0.0',
      run_id: 'run-001',
    },
    organization: {
      organization_id: VALID_TENANT_ID,
      canonical_domain: 'company.example',
    },
    affected_resource: {
      canonical_url: 'https://vpn.company.example/',
      surface_type: 'API_REST',
      entry_point_id: 'ep-001',
    },
    technical_area: 'SSL_VPN',
    technical_mechanism: 'CVE-2022-39952',
    expected_behavior: 'SSL-VPN should not have known RCE vulnerability',
    observed_behavior: 'SSL-VPN on port 443 is running FortiOS 7.2.5 with CVE-2022-39952',
    differential_state: 'CONFIRMED_MISMATCH',
    materiality: 'HIGH',
    evidence_refs: [
      {
        evidence_id: '11111111-1111-1111-1111-111111111111',
        public_url: 'https://nmap.online/domain/vpn.company.example',
        temporal_status: 'CURRENT',
        is_context_artifact: false,
        evidence_origin: 'REAL_PUBLIC_OBSERVATION',
        content_hash: VALID_CONTENT_HASH,
      },
      {
        evidence_id: '22222222-2222-2222-2222-222222222222',
        public_url: 'https://nvd.nist.gov/vuln/detail/CVE-2022-39952',
        temporal_status: 'CURRENT',
        is_context_artifact: false,
        evidence_origin: 'REAL_PUBLIC_OBSERVATION',
        content_hash: VALID_CONTENT_HASH,
      },
    ],
    provenance_chain: {
      expectation_id: 'exp-001',
      observation_ids: ['obs-001', 'obs-002'],
      differential_id: 'diff-001',
      hypothesis_id: 'hyp-001',
      verification_contract_id: 'contract-001',
    },
    contradictory_evidence_ids: [],
    uncertainty: [],
    benign_explanation: '',
    authorization_context: {
      requires_authorized_assessment: false,
    },
    decision_candidate: SEAL_VERIFIED_FINDING,
    policy_reference: VARDHAN_CORE_INTELLIGENCE_POLICY_V1,
    created_at: NOW_ISO,
    evidence_earliest_retrieved_at: NOW_ISO,
    evidence_latest_retrieved_at: NOW_ISO,
    ...overrides,
  };
}

function createValidRequest(overrides: Partial<VerifiedFindingContract> = {}): QCoreValidationRequest {
  return {
    contract: createValidContract(overrides),
    actor_workload_id: `${AUTHORIZED_ACTOR_PREFIX}intel-cluster-01`,
  };
}

describe('Vardhan Intelligence -> Q-Core Boundary Integration', () => {
  let adapter: QCoreAdapter;

  beforeAll(() => {
    adapter = new QCoreAdapter();
  });

  test('1. Synthetic Verified Finding - Should seal successfully', async () => {
    const req = createValidRequest();
    const receipt = await adapter.validateAndSeal(req);

    expect(receipt.status).toBe('SEALED');
    expect(receipt.receipt_id).toBeTruthy();
    expect(receipt.receipt_id).not.toBe('NONE');
    expect(receipt.schema_version).toBe('1.0');
    expect(receipt.transaction_id).toBeTruthy();
    expect(receipt.transaction_id).not.toBe('NONE');
    expect(receipt.payload_hash).toBeTruthy();
    expect(receipt.payload_hash).not.toBe('NONE');
    expect(receipt.issuer_key_fingerprint).toBeTruthy();
    expect(receipt.issuer_key_fingerprint).not.toBe('NONE');
    expect(receipt.policy_id).toBeTruthy();
    expect(receipt.policy_version).toBe('1.0');
    expect(receipt.signatures.ed25519_sig).toBeTruthy();
    expect(receipt.signatures.ed25519_sig).not.toBe('NONE');
    expect(receipt.signatures.ed25519_key_id).toBeTruthy();
    expect(receipt.signatures.ml_dsa_87_sig).toBeTruthy();
    expect(receipt.signatures.ml_dsa_87_sig).not.toBe('NONE');
    expect(receipt.evidence_commitments).toBeInstanceOf(Array);
    expect(receipt.evidence_commitments.length).toBeGreaterThan(0);
  });

  test('2. Negative Test - Unauthorized Tenant', async () => {
    const req = createValidRequest({
      organization: {
        organization_id: INVALID_TENANT_ID,
        canonical_domain: 'company.example',
      },
    });

    const receipt = await adapter.validateAndSeal(req);
    expect(receipt.status).toBe('DENY_TENANT_UNKNOWN');
    expect(receipt.outcome_code).toContain('tenant');
  });

  test('3. Negative Test - Invalid Provenance (Empty Observation IDs)', async () => {
    // Empty observation_ids should fail trust boundary check 12
    const req = createValidRequest({
      provenance_chain: {
        expectation_id: 'exp-001',
        observation_ids: [], // <-- triggers trust boundary rejection
        differential_id: 'diff-001',
        hypothesis_id: 'hyp-001',
        verification_contract_id: 'contract-001',
      },
    });

    const receipt = await adapter.validateAndSeal(req);
    expect(receipt.status).toBe('REJECTED_TRUST_BOUNDARY');
    expect(receipt.outcome_code).toContain('observation_ids');
  });

  test('4. Negative Test - Unauthorized Action', async () => {
    const req = createValidRequest({
      decision_candidate: 'UNAUTHORIZED_ACTION',
    });

    const receipt = await adapter.validateAndSeal(req);
    expect(receipt.status).toBe('REJECTED_TRUST_BOUNDARY');
    expect(receipt.outcome_code).toContain('action_type');
  });

  test('5. Malformed Payload (missing contract field)', async () => {
    const rawBrokenPayload = {
      tenant_id: VALID_TENANT_ID,
      // missing required fields entirely
    } as any;

    const receipt = await adapter.validateAndSeal(rawBrokenPayload);
    expect(receipt.status).toBe('REJECTED_MALFORMED');
    expect(receipt.outcome_code).toContain('missing field');
  });
});
