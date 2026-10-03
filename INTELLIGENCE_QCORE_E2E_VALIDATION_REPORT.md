# VARDHAN INTELLIGENCE → Q-CORE E2E VALIDATION REPORT

## 1. OBJECTIVE
Prove the true executable end-to-end integration path from the Intelligence Plane's verifiable findings to Q-Core's governed cryptographic sealing, strictly enforcing identity separation, trust boundaries, and policy evaluation without relying on synthetic architecture mocks.

## 2. ACTUAL RUNTIME PATH (VERIFIED BY TEST)
The following path was actively tested and verified over a local HTTP E2E execution:
1. `TargetVerificationEngine` (TS) executes against a synthetic deterministic observation.
2. Differential matching enforces that a control endpoint is healthy while the target is affected.
3. `VerificationToContractAdapter` maps the `VerificationReport` to `VerifiedFindingContract` v1.0.
4. `TrustBoundaryValidator` (TS) validates the contract, asserting evidence hashes match the payload.
5. `QCoreIntegrationService` issues an HTTP POST to `http://127.0.0.1:8080/api/v1/seal`.
6. Q-Core Gateway (`handle_seal`) receives the complete contract and `actor_workload_id`.
7. `TrustBoundaryValidator::validate` (Rust) independently verifies 20 explicit trust constraints.
8. `GatewayAuthorityEvaluator` resolves tenant, actor, and policy to produce `AuthorityResult`.
9. `VardhanKeystore` signs a `DualSignature` over the canonical payload.
10. `VardhanSealedReceipt` is returned to the Intelligence Plane.

## 3. IDENTITIES & AUTHORITY (VERIFIED BY TEST)
Identity dimensions are explicitly segregated and independently validated. 
Test cases confirm that identity substitution fails:
- `test_s_identity_substitution_fails`: Attempting to pass `organization_id` (Tenant Identity) into `actor_workload_id` (Workload Identity) results in an active rejection from the Trust Boundary.
- `test_m_unauthorized_actor_rejects`: A valid contract with an unauthorized `actor_workload_id` successfully passes TrustBoundary, but fails in the Authority evaluation phase (Fail Closed).

## 4. TRUST BOUNDARY RESULTS (VERIFIED BY TEST)
The TrustBoundary explicitly checks the following cases natively in Rust, isolated from the authority layer:
- TEST B (Modify Evidence Hash): REJECTED
- TEST D (Change Tenant): REJECTED
- TEST F (Replace Verified Status): REJECTED
- TEST G (Break Expectation Linkage): REJECTED
- TEST J (Historical Evidence): REJECTED
- TEST K (Contradictory Evidence): REJECTED
- TEST L (Invalid Policy): REJECTED
- TEST P (Malformed Version): REJECTED

## 5. INDEPENDENT VERIFICATION RESULTS (VERIFIED BY TEST)
`test_r_alter_sealed_receipt_fails_verification`: The generated `VardhanSealedReceipt` includes an Ed25519/ML-DSA-87 DualSignature. Modifying any signed field (e.g. `tenant_id`) after sealing actively fails signature verification using the independent `VardhanVerifier` struct.

## 6. REPLAY IDEMPOTENCY (OBSERVED LIMITATION)
`test_q_replay_identical_transaction_idempotency` explicitly demonstrates that submitting the identical `finding_id` a second time successfully yields a new receipt. The Q-Core `VardhanTransaction` currently lacks a local idempotency cache or distributed ledger integration to identify and halt redundant submissions. This is an explicit gap in the current implementation.

## 7. EVIDENCE VALIDATION (PARTIALLY VERIFIED)
The `TrustBoundaryValidator` only confirms that the `content_hash` provided in the contract matches a syntactically valid 64-character SHA256/BLAKE3 hash string. Because the underlying raw evidence bytes are deliberately kept on the Intelligence Plane, the Gateway does NOT re-hash the evidence. This proves the *contract* is well-formed, but it relies on external systems (or auditors utilizing the Merkle ledger) to verify the data integrity.

## 8. TEST EXECUTION EVIDENCE
The following commands were successfully executed and verified against the repository:
1. `cargo fmt --check` (fixed deviations via `cargo fmt`)
2. `cargo check` (Passed without errors)
3. `cargo test -p vardhan_keystore` (8/8 Passed)
4. `cargo test -p vardhan_receipt` (29/29 Passed)
5. `npx tsx src/server/run_qcore_e2e.ts` (Passed - successfully simulated `TargetVerificationEngine` differential matching and HTTP network payload delivery to Q-Core on port 8080).
6. `npx vitest run` (33 tests Passed. 7 tests Failed. The failures were isolated entirely within pre-existing regression tests for `ResearchBudget` and `entryPointAccuracy`, unrelated to the TrustBoundary).

## 9. NOT YET IMPLEMENTED
- Distributed Raft Idempotency / Replay Protection.
- KMS/HSM Integration for Keystore.
- Live Database/Ledger Synchronization.
- E2E AI Agent Loop triggers (TargetVerificationEngine currently orchestrated by deterministic synthetic test script).
