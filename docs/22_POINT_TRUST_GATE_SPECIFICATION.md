# 22-Point Trust Boundary Specification

## 1. Executive Summary and Architecture Overview

The Vardhan Q-Core platform enforces a deterministic, fail-closed 22-point trust boundary gate before allowing any transaction, intelligence finding, or receipt to be signed, sealed, or stored in the cryptographic ledger. Every invariant is verified synchronously before any state mutation occurs.

The gate is evaluated across two synchronized layers:
1. **Pre-Execution Ingestion Layer (`process_transaction`)**: Enforces pre-execution durable replay protection (INV-21) and atomic single-winner compare-and-swap reservation (INV-22).
2. **Cryptographic Trust Boundary Validator (`TrustBoundaryValidator::validate`)**: Enforces 20 structural, provenance, temporal, cryptographic integrity, and policy compliance invariants (INV-01 through INV-20).

Failure at any point immediately halts processing with an explicit error code, releases any transient in-flight reservations, and guarantees that no downstream ledger state, key usage, or receipt emission occurs.

---

## 2. Complete 22-Point Trust Invariant Matrix

| ID | Invariant Name | Enforcing Component | Code Location | Deterministic Rule | Rejection Error Code |
|:---|:---|:---|:---|:---|:---|
| **INV-01** | Schema Version Alignment | `TrustBoundaryValidator::validate` | `backend/vardhan_receipt/src/trust_boundary.rs:8` | `contract.schema_version ∈ {"1.0", "1.1"}` | `Invalid schema_version, expected 1.0 or 1.1` |
| **INV-02** | Tenant Identity Non-Empty | `TrustBoundaryValidator::validate` | `backend/vardhan_receipt/src/trust_boundary.rs:13` | `!contract.organization.organization_id.is_empty()` | `organization_id must not be empty` |
| **INV-03** | Intelligence Identity Completeness | `TrustBoundaryValidator::validate` | `backend/vardhan_receipt/src/trust_boundary.rs:18` | `!intelligence.engine_id.is_empty() ∧ !intelligence.run_id.is_empty()` | `intelligence identity fields must not be empty` |
| **INV-04** | Organization Canonical Domain | `TrustBoundaryValidator::validate` | `backend/vardhan_receipt/src/trust_boundary.rs:23` | `!organization.canonical_domain.is_empty()` | `canonical_domain must not be empty` |
| **INV-05** | Resource Identity Completeness | `TrustBoundaryValidator::validate` | `backend/vardhan_receipt/src/trust_boundary.rs:28` | `!affected_resource.canonical_url.is_empty() ∧ !affected_resource.entry_point_id.is_empty()` | `resource identity fields must not be empty` |
| **INV-06** | Unique Finding Identifier | `TrustBoundaryValidator::validate` | `backend/vardhan_receipt/src/trust_boundary.rs:35` | `!contract.finding_id.is_empty()` | `finding_id must not be empty` |
| **INV-07** | Evidence Set Non-Empty | `TrustBoundaryValidator::validate` | `backend/vardhan_receipt/src/trust_boundary.rs:40` | `!contract.evidence_refs.is_empty()` | `evidence_refs must not be empty` |
| **INV-08** | Evidence Cryptographic Integrity | `TrustBoundaryValidator::validate` | `backend/vardhan_receipt/src/trust_boundary.rs:48` | `∀ ev: ev.content_hash.len() == 64 ∧ is_ascii_hexdigit(ev.content_hash)` (SHA-256) | `Invalid evidence content_hash for {id} — expected 64-char SHA-256 hex` / `not valid hex` |
| **INV-09** | Evidence Provenance Origin | `TrustBoundaryValidator::validate` | `backend/vardhan_receipt/src/trust_boundary.rs:65` | `∀ ev: !ev.evidence_origin.is_empty()` | `evidence_origin missing for {id}` |
| **INV-10** | Evidence Temporal Validity | `TrustBoundaryValidator::validate` | `backend/vardhan_receipt/src/trust_boundary.rs:72` | `∀ ev: ev.temporal_status == "CURRENT"` (Reject `"HISTORICAL"`) | `Historical evidence presented as current is REJECTED: {id}` |
| **INV-11** | Expectation Linkage | `TrustBoundaryValidator::validate` | `backend/vardhan_receipt/src/trust_boundary.rs:88` | `!provenance_chain.expectation_id.is_empty()` | `expectation_id missing in provenance_chain` |
| **INV-12** | Observation Linkage | `TrustBoundaryValidator::validate` | `backend/vardhan_receipt/src/trust_boundary.rs:93` | `!provenance_chain.observation_ids.is_empty()` | `observation_ids missing in provenance_chain` |
| **INV-13** | Differential Linkage | `TrustBoundaryValidator::validate` | `backend/vardhan_receipt/src/trust_boundary.rs:98` | `!provenance_chain.differential_id.is_empty()` | `differential_id missing in provenance_chain` |
| **INV-14** | Verification Provenance Linkage | `TrustBoundaryValidator::validate` | `backend/vardhan_receipt/src/trust_boundary.rs:103` | `!provenance_chain.hypothesis_id.is_empty() ∧ !provenance_chain.verification_contract_id.is_empty()` | `verification linkage missing in provenance_chain` |
| **INV-15** | Differential Verification State | `TrustBoundaryValidator::validate` | `backend/vardhan_receipt/src/trust_boundary.rs:113` | `contract.differential_state == "CONFIRMED_MISMATCH"` | `differential_state must be CONFIRMED_MISMATCH to be a verified finding` |
| **INV-16** | Materiality Consistency | `TrustBoundaryValidator::validate` | `backend/vardhan_receipt/src/trust_boundary.rs:121` | `contract.materiality ∈ {"HIGH", "MEDIUM", "LOW"}` | `materiality must be HIGH, MEDIUM, or LOW` |
| **INV-17** | Contradiction Exclusion | `TrustBoundaryValidator::validate` | `backend/vardhan_receipt/src/trust_boundary.rs:129` | `contract.contradictory_evidence_ids.is_empty()` | `Contradictory evidence present, finding is REJECTED` |
| **INV-18** | Action Candidate Whitelist | `TrustBoundaryValidator::validate` | `backend/vardhan_receipt/src/trust_boundary.rs:134` | `contract.decision_candidate ∈ ["SEAL_VERIFIED_FINDING"]` | `action_type '{act}' is not in the allowed policy whitelist` |
| **INV-19** | Policy Registry Reference | `TrustBoundaryValidator::validate` | `backend/vardhan_receipt/src/trust_boundary.rs:143` | `contract.policy_reference ∈ ["VARDHAN_CORE_INTELLIGENCE_POLICY_V1"]` | `policy_reference '{pol}' is not registered in the Q-Core policy registry` |
| **INV-20** | Authority Context Completeness | `TrustBoundaryValidator::validate` | `backend/vardhan_receipt/src/trust_boundary.rs:152` | `authorization_context.requires_authorized_assessment ⇒ authorization_context.authorized_by.is_some()` | `authorization_context requires authorized_by if requires_authorized_assessment is true` |
| **INV-21** | Pre-Execution Durable Replay Guard | `process_transaction` | `backend/vardhan_receipt/src/main.rs:561` | `!is_finding_already_sealed(&finding_id)` (persisted store check) | `REJECTED_REPLAY: Finding '{id}' has already been sealed` |
| **INV-22** | Atomic Single-Winner Concurrency CAS | `process_transaction` | `backend/vardhan_receipt/src/main.rs:577` | `reserve_finding(&finding_id) == true` (atomic memory CAS) | `REJECTED_REPLAY: Finding '{id}' is being sealed by another process` |

---

## 3. Detailed Invariant Specifications

### INV-01: Schema Version Validation
- **Requirement:** Contracts must declare schema version 1.0 or 1.1. Any unknown schema version indicates incompatible payload formatting or version-probing attacks.
- **Fail-Closed Behavior:** Contract rejected immediately before field deserialization or authority validation.

### INV-02: Tenant Identity Integrity
- **Requirement:** `organization.organization_id` must be non-empty and conform to canonical institutional identifiers (`org-[a-z0-9-]+`).
- **Fail-Closed Behavior:** Cross-tenant leakage is prevented; unauthenticated or tenantless requests cannot proceed.

### INV-03: Intelligence Identity
- **Requirement:** Both `engine_id` and `run_id` must be populated, establishing the originating audit pipeline instance and execution run.
- **Fail-Closed Behavior:** Reject anonymous or unlinked intelligence submissions.

### INV-04: Organization Identity
- **Requirement:** `organization.canonical_domain` must be non-empty, preventing cross-domain spoofing.

### INV-05: Resource Identity
- **Requirement:** Both `canonical_url` and `entry_point_id` must be provided, binding the finding to a specific system endpoint.

### INV-06: Finding Identifier
- **Requirement:** `finding_id` must be a globally unique, non-empty identifier. Used as the primary key for idempotency tracking.

### INV-07: Evidence Set Non-Empty
- **Requirement:** At least one evidence reference must be present. Zero-evidence assertions are rejected without exception.

### INV-08: Cryptographic Evidence Integrity
- **Requirement:** Every evidence item must commit to a 64-character hexadecimal SHA-256 digest (`[a-f0-9]{64}`).
- **Fail-Closed Behavior:** Any malformed, non-hex, or truncated hash fails validation, preventing tampered evidence from binding to receipts.

### INV-09: Evidence Provenance Origin
- **Requirement:** `evidence_origin` must describe the observation tool or scan system (e.g. `scan`, `dast`, `sast`).

### INV-10: Evidence Temporal Validity
- **Requirement:** `temporal_status` must equal `"CURRENT"`. Stale or `"HISTORICAL"` evidence presented as current is explicitly rejected.

### INV-11 through INV-14: Provenance Chain Linkages
- **Requirement:** The provenance chain must contain non-empty IDs for `expectation_id`, `observation_ids`, `differential_id`, `hypothesis_id`, and `verification_contract_id`.
- **Fail-Closed Behavior:** Broken or unlinked provenance chains are rejected.

### INV-15: Differential Verification State
- **Requirement:** Only verified findings with `differential_state == "CONFIRMED_MISMATCH"` may be sealed. Unconfirmed hypotheses or benign states cannot be sealed.

### INV-16: Materiality Classification
- **Requirement:** Materiality must be strictly classified as `"HIGH"`, `"MEDIUM"`, or `"LOW"`. Unranked or invalid strings are rejected.

### INV-17: Contradiction Exclusion
- **Requirement:** `contradictory_evidence_ids` must be empty. Findings containing unresolved contradictory evidence cannot be certified.

### INV-18: Action Candidate Whitelist
- **Requirement:** `decision_candidate` must match whitelisted operations (`"SEAL_VERIFIED_FINDING"`). Arbitrary or unauthorized action types are rejected.

### INV-19: Policy Registry Reference
- **Requirement:** `policy_reference` must exist in the authoritative policy registry (`"VARDHAN_CORE_INTELLIGENCE_POLICY_V1"`).

### INV-20: Authorization Context Integrity
- **Requirement:** When `requires_authorized_assessment` is true, `authorized_by` must specify the approving officer identity.

### INV-21: Pre-Execution Durable Replay Guard
- **Requirement:** The persistent idempotency store (RocksDB / durable storage) is queried before any signature computation or state modification.
- **Fail-Closed Behavior:** Replay attempts return `REJECTED_REPLAY` and abort before invoking key protection or cryptographic routines.

### INV-22: Atomic Single-Winner Concurrency Guard
- **Requirement:** Concurrent requests attempting to seal the same `finding_id` compete via an atomic Compare-And-Swap (CAS) reservation.
- **Fail-Closed Behavior:** Only the winning process proceeds; losing concurrent threads receive `REJECTED_REPLAY` and exit without executing duplicate state changes.

---

## 4. Test Verification Evidence

All 22 invariants are verified via dedicated negative tests in `backend/vardhan_receipt/src/main.rs`:
- `test_inv01_schema_version_invalid_rejects`
- `test_inv02_empty_organization_id_rejects`
- `test_inv03_empty_intelligence_identity_rejects`
- `test_inv04_empty_canonical_domain_rejects`
- `test_inv05_empty_resource_identity_rejects`
- `test_inv06_empty_finding_id_rejects`
- `test_inv07_empty_evidence_refs_rejects`
- `test_inv08_invalid_evidence_content_hash_rejects`
- `test_inv09_empty_evidence_origin_rejects`
- `test_inv10_historical_evidence_rejects`
- `test_inv11_empty_expectation_linkage_rejects`
- `test_inv12_empty_observation_linkage_rejects`
- `test_inv13_empty_differential_linkage_rejects`
- `test_inv14_empty_verification_linkage_rejects`
- `test_inv15_differential_state_not_confirmed_mismatch_rejects`
- `test_inv16_invalid_materiality_rejects`
- `test_inv17_contradictory_evidence_rejects`
- `test_inv18_unauthorized_action_candidate_rejects`
- `test_inv19_unregistered_policy_reference_rejects`
- `test_inv20_missing_authorized_by_when_required_rejects`
- `test_inv21_durable_replay_rejects`
- `test_inv22_concurrent_duplicate_reservation_single_winner`
