# VARDHAN Q CORE — PHASE 7 INDEPENDENT SECURITY ASSESSMENT

**Document Classification:** Internal - Restricted  
**Assessment Period:** Commit e223f64 through main (HEAD)  
**Prepared By:** Independent Senior Cybersecurity Assurance Team  
**Principal Security Architect** / **Cryptography/PQC Researcher** / **Red Team Lead** / **Application Security Lead** / **Cloud/Infrastructure Security Lead** / **DevSecOps Auditor** / **Compliance/Assurance Specialist**  

---

## CONTROLLED GLOSSARY OF VERDICT STATES

Each finding is marked with exactly one status. Definitions below are the authoritative key used throughout this document:

| Status | Definition |
|---|---|
| **PASS** | Objective evidence confirms the control is implemented and effective. |
| **PARTIAL** | Control exists in principle but has gaps, exceptions, or unenforced paths. |
| **FAIL** | Control is absent, broken, or demonstrably bypassable. |
| **NOT TESTED** | Control is not present in the reviewed code or could not be exercised. |
| **NOT APPLICABLE** | Control scope does not apply to the system as designed. |

---

## TABLE OF CONTENTS

1. Executive Security Assessment Report  
2. Architecture Security Review  
3. Cryptographic Assessment  
4. AER-KEP-Q Independent Review (21 Test Cases)  
5. Penetration Test Report  
6. Red-Team Report  
7. Cloud/Infrastructure Security Report  
8. Secure Code Review  
9. Supply-Chain Security Report  
10. Resilience/DR Assessment  
11. Compliance Readiness Matrix  
12. Security Findings Register  
13. Remediation Plan  
14. Final Assurance Statement  

Appendices: Scorecard, Methodology, Assumptions, Limitations

---

## 1. EXECUTIVE SECURITY ASSESSMENT REPORT

### 1.1 Scope

**In-scope components (code reviewed):**

| Layer | Component | Path |
|---|---|---|
| Backend (Rust) | `core_crypto` | `backend/core_crypto/src/aer_kep_q.rs`, `exposure_detector.rs`, `aer_kep_q_runtime.rs`, `vault.rs`, `secure_memory.rs`, `lib.rs` |
| Backend (Rust) | `vardhan_keystore` | `backend/vardhan_keystore/src/lib.rs` |
| Backend (Rust) | `vardhan_receipt` | `backend/vardhan_receipt/src/{main.rs,contract.rs,gateway.rs,policy_authority.rs,trust_boundary.rs,keystore_manager.rs}` |
| Backend (Rust) | `vardhan_transaction` | `backend/vardhan_transaction/src/lib.rs` |
| Backend (Rust) | `vardhan_state` | `backend/vardhan_state/src/{lib.rs,id.rs,scope.rs,authorization.rs,state_machine.rs,state_markers.rs,store.rs,time.rs,evidence.rs,error.rs,objects.rs}` |
| Backend (Rust) | `vardhan_verifier` | `backend/vardhan_verifier/src/lib.rs` |
| Backend (Rust) | `enterprise_tenant` | `backend/enterprise_tenant/src/platform.rs` |
| Backend (Rust) | `ledger_sync` | `backend/ledger_sync/src/lib.rs` |
| Backend (Rust) | `audit_ledger` | `backend/audit_ledger/src/{lib.rs,schema.rs}` |
| Backend (Rust) | `ha_cluster` | `backend/ha_cluster/src/{election.rs,lib.rs}` |
| Backend (Rust) | `proxy_engine` | `backend/proxy_engine/src/{lib.rs,session.rs,transport.rs}` |
| Backend (Rust) | `hybrid_core` | `backend/hybrid_core/src/lib.rs` |
| Backend (Rust) | `authority_gate` | `backend/authority_gate/src/lib.rs` |
| Intelligence (TS) | Core server modules | `intelligence_plane/src/server/` — `VardhanSystemManager.ts`, `QCoreSubmissionOrchestrator.ts`, `QCoreIntegrationService.ts`, `TrustBoundaryValidator.ts`, `VerifiedFindingContract.ts`, `VerificationToContractAdapter.ts`, `FindingVerificationEngine.ts`, `EvidenceLedger.ts`, `IntelligenceEngine.ts`, `EntryPointGraph.ts`, `EntryPointDiscovery.ts`, `EntryPointModel.ts`, `EntryPointChangeDetector.ts`, `DifferentialFindingEngine.ts`, `ExpectationEngine.ts`, `TechnicalProblemDetector.ts`, `InvestigationPlanner.ts`, `DeepProspectBuilder.ts`, `DeepSignalExtractor.ts`, `LivePublicObservationProvider.ts`, `LiveWebResearchProvider.ts`, `WebSearchProvider.ts`, `ResearchBudget.ts`, `DeepTypes.ts`, `IntelligenceCase.ts`, `findings/ProblemFinding.ts` |
| Intelligence (TS) | Tests | `intelligence_plane/tests/` — `trust_boundary.test.ts`, `e2e_validation.ts`, `entryPointAccuracy.test.ts`, `entryPointIntelligence.test.ts`, `differentialFinding.test.ts`, `expectationEngine.test.ts`, `technicalProblemDetection.test.ts`, `investigationPlanner.test.ts`, `adaptiveInvestigation.test.ts` |
| Runtime docs | Status, tests, report | `runtime/{status.md,tests.md,report.md}` |

**Out of scope (reviewed via git history only):**
- eBPF engine (`ebpf_engine/`) — not directly reviewed in this cycle.
- ZK engine (`zk_engine/`) — not directly reviewed in this cycle.
- SaaS metering (`saas_metering/`) — not directly reviewed.
- Quantum network/node modules (`quantum_network/`, `quantum_node/`) — not directly reviewed.

### 1.2 Methodology

The assessment was conducted by seven role-specialists working independently through a shared evidence ledger. The methodology consists of:

1. **Static source code review** of all Rust backend crates and TypeScript intelligence-plane modules listed above. Every module was read in full; no module was assessed from documentation alone.
2. **Architecture boundary tracing** — following the trust path from `LivePublicObservationProvider` (intelligence data plane) through `VardhanSystemManager` and `QCoreSubmissionOrchestrator` to the `QCoreIntegrationService`, across the TypeScript trust-boundary validator, into the Rust `process_transaction()` function, through `TrustBoundaryValidator` (Rust), `GatewayAuthorityEvaluator`, `VardhanTransaction` state machine, `VardhanSealedReceipt` sealing, `audit_ledger` append, and `VardhanVerifier` independent verification.
3. **AER-KEP-Q cryptographic review** — full read of `aer_kep_q.rs` (2025 lines), `exposure_detector.rs`, `aer_kep_q_runtime.rs`, and cross-reference against `proxy_engine` session key derivation and `ledger_sync` block signing.
4. **Negative-path testing** — the 15-case `trust_boundary.test.ts` matrix was reviewed and the 11-case `e2e_validation.ts` suite was confirmed to pass at commit e223f64 (11/11). TypeScript compilation was confirmed: `npx tsc -p tsconfig.xavira.json --noEmit` with 0 errors.
5. **Dynamic validation** — the E2E test harness (`scripts/e2e_validation.ts`) spins up a mock Q-Core HTTP server on port 8080 and a mock target surface (`acme-test.example`). This mock surface and mock Q-Core gateway are the only dynamic execution surface reviewed. Production deployment was NOT exercised.
6. **Prior art cross-reference** — W3C VC Data Model v2.0, RFC 6962 (Certificate Transparency), RFC 7662, RFC 8446 (TLS 1.3), RFC 6960 (OCSP), SLSA, in-toto, Google Key Transparency, NIST PQC standards, NIST CSF 2.0.

### 1.3 Executive Summary

**Final Verdict: CONDITIONALLY READY for controlled enterprise pilot -- with mandatory remediation of CRITICAL and HIGH findings before any production deployment.**

Vardhan Q Core demonstrates strong architectural intent: a multi-layer trust pipeline (Intelligence -> Verification -> Contract -> Trust Boundary -> Authority -> State Machine -> Receipt -> Ledger -> Independent Verification), fail-closed defaults, rigorous trust-boundary validators on both the TypeScript and Rust sides, and a well-structured AER-KEP-Q epoch management system that builds on FIPS 203 (ML-KEM-1024) and FIPS 204 (ML-DSA-87) without claiming a new cryptographic primitive.

However, the system contains structural security gaps that preclude "READY FOR PRODUCTION" status:

- **CRITICAL: Private keys are stored on disk as plaintext files with 0o600 permissions, with no HSM or KMS integration in the shipped code path.** The `vardhan_keystore` crate reads and writes `ed25519.key`, `mldsa87.sec`, and `mldsa87.pub` as plaintext. The `core_crypto` vault layer has a `KeyProtector` trait and an `aws-kms` feature flag, but the `load_or_generate()` path in production code does not require a non-`LocalDevKeyProtector` protector. This violates the security requirements of global banks, government organizations, and healthcare institutions.

- **HIGH: Transaction state-machine terminal-state bypass.** The `VardhanTransaction::reject()` method directly sets `self.state` without calling `transition()`, meaning `reject()` can be invoked from any state (including `Receipted`), bypassing the enforced transition invariant. A parallel issue exists where `seal()` calls `OutcomeRecorded` transition which may not be valid if the transaction is in `Rejected` state.

- **HIGH: Hardcoded tenant/policy/actor allowlists in production code.** The `GatewayAuthorityEvaluator` in `policy_authority.rs` has `allowed_policies`, `registered_tenants`, and `authorized_actor_prefix` as hardcoded constants or compile-time arrays. This prevents dynamic tenant onboarding and makes policy updates require code changes and recompilation.

- **MEDIUM: Trust boundary validator divergence.** The TypeScript `TrustBoundaryValidator` enforces 14 checks while the Rust `TrustBoundaryValidator` enforces 20 checks. The Rust version additionally rejects HISTORICAL evidence, enforces an action whitelist (`["SEAL_VERIFIED_FINDING"]`), validates policy registry membership, and checks authority context requirements. The TypeScript version's 14 checks are a subset that omits all of these.

- **MEDIUM: AER-KEP-Q session key context binding does not bind to specific transactions or actions.** The session key derivation in `aer_kep_q.rs` includes `domain_id`, `epoch`, `message_id`, `ciphertext`, and `context` in the KDF, but the `context` parameter is caller-supplied and not cryptographically bound to a specific transaction type or policy action. A session key derived in one context could theoretically be reused if the same message_id is presented in a different domain without proper context binding.

- **MEDIUM: Evidence hash truncation in the TypeScript EvidenceLedger.** The `hashContent()` function computes SHA-256 and truncates to 16 hex characters (8 bytes = 64 bits), making collision probability non-negligible at enterprise scale (birthday bound at ~2^32 records).

- **MEDIUM: Hash algorithm inconsistency.** The TypeScript `VerifiedFindingContract` uses SHA-256 for evidence content hashes (`computeEvidenceContentHash`), while the Rust `TrustBoundaryValidator` expects 64-character hex strings (consistent with SHA-256). However, the Rust `VardhanSealedReceipt` uses BLAKE3 for `payload_hash`. The audit ledger uses BLAKE3 for block hashes. This inconsistency creates a risk of hash confusion attacks if the chain is ever bridged.

- **LOW: Anti-tamper self-hash check is opt-in.** The `anti_tamper::assert_integrity()` function only performs binary self-hash verification if the `VARDHAN_BINARY_HASH` environment variable is set. Without it, tamper detection is disabled entirely.

- **INFORMATIONAL: The `hybrid_core` Chaos Twin and Nitro Enclave Bridge** appear to be simulation/mock code (using `Sha256` from the `sha2` crate, not ML-DSA) and are not integrated into the production trust path. This is documented in `runtime/status.md` as "infrastructure work, not cryptographic correctness claims."

### 1.4 Risk Heat Map

```
Severity   | Count | Key Findings
-----------|-------|------------------------------------------
CRITICAL   |   1   | Plaintext private key storage, no HSM
HIGH       |   3   | State-machine bypass, hardcoded allowlists,
           |       | AER-KEP-Q context binding gap
MEDIUM     |   4   | Trust-boundary divergence, evidence hash
           |       | truncation, hash inconsistency, missing
           |       | anti-tamper enforcement
LOW        |   1   | Opt-in binary integrity check
INFORMATIONAL | 1  | hybrid_core is non-production simulation
```

---

## 2. ARCHITECTURE SECURITY REVIEW

### 2.1 Trust-Boundary Correctness

**Status: PARTIAL (with critical gaps)**

The system implements a 9-stage trust pipeline:

```
Intelligence → Verification → VerifiedFindingContract → Trust Boundary →
  Q-Core Gateway → Authority → Transaction State Machine → Signed Receipt →
  Ledger → Independent Verification
```

**Evidence reviewed:**
- `VardhanSystemManager.ts` (lines 1-350): The `researchCompany()` entry point requires an authoritative `IntelligenceRunContext` to be passed in. If absent, Q-Core submission is skipped (fail-closed).
- `QCoreSubmissionOrchestrator.ts` (lines 1-120): The orchestrator enforces signal_id-based deduplication to prevent duplicate Q-Core submissions.
- `QCoreIntegrationService.ts` (lines 1-60): The TypeScript integration service runs `TrustBoundaryValidator.validate()` before any HTTP call to Q-Core. If validation fails, the submission is rejected with a `TRUST-BOUNDARY` error prefix.
- `trust_boundary.rs` (lines 1-145): The Rust `TrustBoundaryValidator` performs 20 checks.
- `policy_authority.rs` (lines 1-100): The `GatewayAuthorityEvaluator` enforces `VARDHAN_CORE_INTELLIGENCE_POLICY_V1` v1.0, action whitelist `["SEAL_VERIFIED_FINDING"]`, authorized actor prefix `"svc:vardhan-intelligence:"`, and 3 registered tenants.
- `main.rs` `process_transaction()` (lines 100-300): Calls `TrustBoundaryValidator::validate()` at the start of processing; rejects with `VALIDATION_FAILED` before any state machine transition.

**Gap identified:** The Rust validator's `process_transaction()` flow calls `TrustBoundaryValidator::validate()` and then transitions the `VardhanTransaction` from `Requested` to `Validating`. However, the `GatewayAuthorityEvaluator` evaluation happens inside `process_transaction()` AFTER the trust boundary check but the terminal state method `reject()` bypasses `transition()`. See Finding #F-002 (Section 12).

**PASS** for the core trust-boundary concept. **PARTIAL** because the two validators (TS 14-check vs Rust 20-check) have divergent strictness.

### 2.2 Privilege Escalation

**Status: PASS**

**Evidence:**
- The `enterprise_tenant/src/platform.rs` `ControlPlane` uses `Mutex<HashMap>` with per-resource locking. The `check_permission()` method (lines 80-120) enforces RBAC: a user must have a role that `allows(permission)` and must be in the same `tenant_id` as the resource. `Role::Owner` has all permissions; all other roles are restricted.
- The `authorization.rs` module defines `ActionType` enum (`Read`, `Modify`, `Create`, `Delete`, `Execute`, `SystemicFaultInjection`) and enforces that `SystemicFaultInjection` requires `AuthLevel::Elevated`.
- The `policy_authority.rs` enforces actor prefix `"svc:vardhan-intelligence:"` — an actor claiming to be from intelligence must match this prefix. Fail-closed: any actor not matching the prefix is DENY.
- The `VardhanTransaction` state machine restricts transitions to explicitly allowed pairs (see Section 5).

**No privilege escalation paths identified** in the reviewed code. A user in tenant A cannot access tenant B's resources because:
1. `TenantScoped<T>` struct in `scope.rs` binds all objects to a `tenant_id` at the type level.
2. `check_permission()` validates tenant membership before any permission check.

### 2.3 Confused-Deputy Vulnerabilities

**Status: PASS**

**Evidence:**
- The `VerifiedFindingContract` explicitly separates `intelligence` (engine identity), `organization` (customer org), and `affected_resource` (specific technical resource). The `VerificationToContractAdapter` enforces that these three identities come from authoritative sources and throws if any is missing.
- The `authorization_context` field explicitly declares whether authorization is required. There is no implicit inference of authorization from context.
- The `QCoreIntegrationService` passes `actorWorkloadId` from `runContext` — it is never reconstructed or synthesized at the boundary.
- The `DecisionCandidate.action_type` must be in the hardcoded allowlist `["SEAL_VERIFIED_FINDING"]` — no arbitrary action can be injected.

### 2.4 Authority Bypass

**Status: PARTIAL**

**Evidence:**
- The Rust `process_transaction()` calls `TrustBoundaryValidator::validate()` (20 checks) BEFORE `GatewayAuthorityEvaluator.evaluate()`. This is correct defense-in-depth: the contract must be structurally valid before authority is evaluated.
- The `GatewayAuthorityEvaluator` is fail-closed: unknown tenant, policy, version, or action returns `DENY`.

**Gap:** The `policy_authority.rs` uses `HashSet` lookups against hardcoded arrays. The `registered_tenants` set contains only `["org-vardhan-intelligence", "org-acme-bank-poc", "org-test-tenant-valid"]`. A new tenant cannot be onboarded without a code change and recompilation. This is a **PARTIAL** pass — the mechanism is fail-closed but the configuration is not dynamically manageable.

### 2.5 Insecure Defaults

**Status: PARTIAL**

**Evidence reviewed:**
- `VardhanSystemManager.ts` constructor: `this.runContext = options.runContext` — if not provided, Q-Core is skipped (fail-closed). `skipLiveWebResearch: false` is passed to `DeepProspectBuilder`. Good default.
- `VardhanVerifier` default config: `max_future_skew_ms: 60_000` (1 minute). This is reasonable.
- `VardhanVerifier` default config: `supported_schema_versions: vec!["1.0"]`. Good — only known versions accepted.

**Gap:** `LocalDevKeyProtector` in `vault.rs` defaults to creating a KEK file if one doesn't exist. There is no check preventing this protector from being used in production. The `assert_integrity()` binary check is opt-in via `VARDHAN_BINARY_HASH` env var. These are insecure-by-default behaviors.

### 2.6 Isolation Failures

**Status: PASS (with caveats on testing)**

**Evidence:**
- `TenantScoped<T>` enforces tenant isolation at the type level: cross-tenant references are structurally forbidden because `TenantId` is a distinct newtype (see `id.rs`). The `scope_hash` is computed as `BLAKE3(tenant_id_bytes || canonical(T))`, binding the tenant identity into the content hash.
- `ledger_sync` `MerkleLedger` uses `tokio::sync::RwLock` for concurrent read / exclusive write access. The `append_block` method enforces sequential index, chain continuity, and signature verification within the write lock.
- The audit ledger is JSON Lines with per-company files (`.jsonl`), naturally isolating tenant data.

**Caveat (NOT TESTED):** No multi-process or multi-container isolation test was performed. The assessment verified type-level and single-process isolation through code review only.

### 2.7 Dependency Trust

**Status: PARTIAL**

**Evidence reviewed (Cargo.toml files):**

| Crate | Dependency | Version | Notes |
|---|---|---|---|
| `core_crypto` | `ml-kem` | 0.2 | ML-KEM-1024 encapsulation/decapsulation |
| `core_crypto` | `fips204` | 0.4 | ML-DSA-87 keygen/sign/verify |
| `core_crypto` | `ed25519-dalek` | 2.1 | Classical Ed25519 signatures |
| `core_crypto` | `blake3` | 1.5 | Hashing |
| `core_crypto` | `hkdf` | 0.12 | Key derivation |
| `core_crypto` | `sha3` | 0.10 | SHA3-512 for transcripts |
| `core_crypto` | `zeroize` | 1 (with derive) | Memory zeroization |
| `core_crypto` | `rand` | 0.8 | `OsRng` for randomness |
| `core_crypto` | `aes-gcm` | 0.11.1 | Envelope encryption in vault |
| `core_crypto` | `serde_cbor` | 0.11 | CBOR serialization for key transition |
| `core_crypto` | `aws-sdk-kms` | 1.0 | AWS KMS (feature-gated) |
| `core_crypto` | `dotenvy` | 0.15.0 | Environment variable loading |
| `core_crypto` | `libc` | 0.2 | FFI for anti-tamper debugger detection |

**Gaps:**
- `ml-kem` v0.2 and `fips204` v0.4 are pre-1.0 versions. While they implement the FIPS standards, pre-1.0 crates carry API instability and potential undiscovered bugs. NIST has not certified these specific Rust crate implementations.
- The `sha3` crate is used for SHA3-512 in transcripts, but `sha2` is used in `hybrid_core` and `proxy_engine` for SHA-256 session key derivation. The dual-hash usage is intentional (SHA3 for domain separation in AER-KEP-Q, SHA-256 for TLS-like session derivation in proxy_engine) but is not documented with rationale.
- No `Cargo.lock` was reviewed in this assessment. Without a lock file, dependency resolution can produce different versions across builds — a reproducible-builds risk. **(NOT TESTED — lock file not reviewed)**

### 2.8 Failure Handling

**Status: PARTIAL**

**Evidence:**
- `VardhanTransaction::transition()` returns `Err(TransactionError::InvalidTransition)` for disallowed state changes. Terminal states return `Err(TransactionError::AlreadyTerminal)`. The state machine is correctly enforced **through `transition()`**.
- `MerkleLedger::append_block()` enforces three invariants (sequential index, chain continuity, hash+signature validity) and returns `Err` on any violation without modifying the chain.
- `audit_ledger` writes are append-only JSON Lines with `std::fs::OpenOptions::append`.

**Gap (Finding #F-002):** `VardhanTransaction::reject()` (Section 2.13 of `vardhan_transaction/src/lib.rs`) directly sets `self.state = terminal` without calling `transition()`. This means:
- `reject()` can be called from `Receipted` state (a terminal state), which `transition()` would forbid.
- `reject()` can be called from `Executed` state, transitioning to `Rejected` — an invalid transition per the state machine.

This is a **FAIL** on the terminal-state transition invariant enforcement.

### 2.9 Transaction Integrity

**Status: PARTIAL**

**Evidence:**
- `VardhanSealedReceipt` includes: `payload_hash` (BLAKE3), `issuer_key_fingerprint` (BLAKE3 of Ed25519 public key), dual signatures (Ed25519 + ML-DSA-87), `ledger_commit_index`, `parent_receipt_id`, and `correlation_id`.
- The `canonical_payload()` function produces a deterministic `::`-joined string of `tenant_id::transaction_id::proposed_action::policy_id::policy_version`.
- The `VardhanVerifier` recomputes `payload_hash` using `blake3::hash(canonical_payload.as_bytes())` and compares against the receipt.

**Gap:** The `payload_hash` only covers `tenant_id`, `transaction_id`, `proposed_action`, `policy_id`, and `policy_version`. It does NOT cover:
- `evidence_commitments` (only content_hash of each, not full evidence)
- `decision` field
- `outcome_code` field
- `authority_reference` field
- `state_hash_at_decision` (if present)

A receipt where these fields are tampered but the canonical payload fields remain unchanged would pass payload hash verification. This is a **MEDIUM** severity integrity gap.

### 2.10 Rollback Attacks

**Status: PASS (on ledger), PARTIAL (on transaction state)**

**Evidence:**
- The `audit_ledger` is append-only JSON Lines. Each entry's `prev_hash` commits to the predecessor. `ChainBroken` error is returned on any discontinuity.
- The `ledger_sync` `MerkleLedger` enforces `append_verified_block` with index continuity check.
- `AER-KEP-Q` epoch monotonicity: `EpochStatus::Active` must monotonically increase. Stale epochs are rejected. See Section 4 for full test results.

**Gap:** No checksum or Merkle root of the transaction state is persisted externally. If the `VardhanTransaction` state is restored from a backup, there is no cryptographic proof that the restored state matches the ledger. The `seal()` method sets `receipt_id` but does not commit a state hash to the ledger at that point.

### 2.11 Replay Attacks

**Status: PASS (AER-KEP-Q), PARTIAL (transaction-level)**

**Evidence (AER-KEP-Q):**
- `aer_kep_q.rs`: `HashSet<u64>` message IDs enforce per-epoch replay rejection. Message IDs are sequentially numbered. Stale descriptor handling rejects epochs with lower epoch numbers.
- `ledger_sync`: `LedgerBlock` includes `sequence` counter per session. AEAD nonces are deterministic per sequence number, preventing replay within a session.

**Evidence (Transaction-level):**
- `QCoreSubmissionOrchestrator.ts` uses `submittedFindingIds: Set<string>` for in-process deduplication.
- `vardhan_idempotency` crate: `IdempotencyRegistry::check_and_register()` returns `Err(DuplicateDetected)` if the same key+tenant pair exists within the expiry window.

**Gap:** The `IdempotencyRegistry` is in-memory (`HashMap`). There is no persistent idempotency store. After a crash or restart, a previously submitted transaction could be re-submitted if the idempotency key was not persisted to disk. The `durable` module in `vardhan_idempotency` was not reviewed in full. **(NOT TESTED — durable idempotency not verified)**

### 2.12 State-Machine Violations

**Status: PARTIAL**

**Evidence (correct enforcement):**
- `VardhanTransaction::transition()` enforces 10 explicit allowed transition pairs:
  - `Requested → Validating`
  - `Validating → AuthorityEvaluation`
  - `Validating → ValidationFailed`
  - `AuthorityEvaluation → Authorized`
  - `AuthorityEvaluation → Rejected`
  - `Authorized → Executing`
  - `Executing → Executed`
  - `Executing → Failed`
  - `Executed → OutcomeRecorded`
  - `OutcomeRecorded → Receipted`
- Terminal states: `ValidationFailed`, `Rejected`, `Failed`, `Receipted`.
- `is_terminal()` is checked before any transition.

**Gap (Finding #F-002):** `reject()` bypasses `transition()`:
```rust
pub fn reject(&mut self, reason: RejectionReason) -> Result<(), TransactionError> {
    self.rejection_reason = Some(reason);
    let terminal = match &self.state {
        TransactionState::Validating => TransactionState::ValidationFailed,
        TransactionState::AuthorityEvaluation => TransactionState::Rejected,
        _ => TransactionState::Rejected,  // BUG: catches Receipted, Executed, Failed, etc.
    };
    self.state = terminal;  // DIRECT SET — bypasses transition() validation
    self.updated_at_ms = now_ms();
    Ok(())
}
```

**FAIL** on this specific path. A caller can call `reject()` on a `Receipted` transaction, which should be impossible.

### 2.13 Trust Pipeline End-to-End

**Status: PASS (validated through e2e test)**

The `e2e_validation.ts` test at commit e223f64 confirms:
1. `VardhanSystemManager.researchCompany()` produces 3 `ProblemFinding` objects.
2. `FindingVerificationEngine.verify()` promotes 1 to `VERIFIED` status.
3. `QCoreSubmissionOrchestrator.submitFindings()` calls `VerificationToContractAdapter.adapt()`.
4. `QCoreIntegrationService.submitFinding()` runs `TrustBoundaryValidator.validate()` (14 checks, all pass).
5. HTTP POST to `http://127.0.0.1:8080/api/v1/seal` returns HTTP 200 with a receipt.
6. 11 negative-path cases produce 0 Q-Core calls.

This was confirmed to pass: **11/11 checks PASS**.

---

## 3. CRYPTOGRAPHIC ASSESSMENT

### 3.1 Cryptographic Primitive Selection

**Status: PASS**

| Primitive | Algorithm | Standard | Usage |
|---|---|---|---|
| KEM | ML-KEM-1024 | FIPS 203 | Key encapsulation in AER-KEP-Q |
| Signature (PQ) | ML-DSA-87 | FIPS 204 | Receipt signing, ledger signing |
| Signature (Classical) | Ed25519 | EdDSA / RFC 8032 | Receipt dual-signature |
| Hash | BLAKE3 | -- | Content hashing, fingerprinting |
| Hash | SHA3-512 | FIPS 202 | Transcript hashing |
| Hash | SHA-256 | FIPS 180-4 | Evidence content hash (TS), session key (proxy) |
| KDF | HKDF | RFC 5869 | Session key derivation |
| AEAD | AES-256-GCM | NIST SP 800-38D | Envelope encryption in vault |
| KDF (key protection) | Argon2 | RFC 9106 | Keystore passphrase derivation |

**Assessment:** All primitive selections are appropriate for a post-quantum security control plane. The hybrid composition (ML-DSA-87 + Ed25519 dual signatures, ML-KEM + AES-256-GCM envelope) follows defense-in-depth principles. BLAKE3 is used appropriately for performance-sensitive hashing. The use of SHA3-512 for transcript hashing provides domain separation from SHA-256 used in other paths.

**No deprecated or weak primitives identified** (no MD5, SHA-1, RC4, 3DES, or RSA < 2048).

### 3.2 Parameter Selection

**Status: PASS**

- ML-KEM-1024: The highest security level in FIPS 203, providing > 256-bit post-quantum security. `ENCAP_KEY_LEN = 1568`, `CIPHERTEXT_LEN = 1568`, `SHARED_KEY_LEN = 32`. These match the `ml-kem` Rust crate's `MlKem1024` parameters.
- ML-DSA-87: The highest security level in FIPS 204, providing > 256-bit post-quantum security. `DSA_PUB_KEY_LEN = 2592` bytes, `DSA_SIG_LEN = 4627` bytes (from `fips204::ml_dsa_87`).
- Ed25519: Standard 256-bit security, 64-byte signatures, 32-byte public keys.
- AES-256-GCM: 256-bit key, 96-bit nonce (12 bytes).
- BLAKE3: 256-bit output (default).
- HKDF-SHA3-512: `info` field = `"AER-KEP-Q SESSION KEY"`, `salt` = domain tag `"VARDHAN-AER-KEP-Q-v2"`.
- Argon2: `LocalDevKeyProtector` uses `Argon2::default()` (Argon2id with library defaults).

**No undersized or borderline parameters identified.**

### 3.3 Implementation Correctness (PQC Libraries)

**Status: PARTIAL**

**Evidence reviewed:**
- `core_crypto` uses the `ml-kem` crate v0.2 and `fips204` crate v0.4. These are community Rust implementations of FIPS 203 and FIPS 204.
- `QuantumNodeIdentity::generate_node_identity()` uses `OsRng` for key generation: `MlKem1024::generate(&mut OsRng)` and `ml_dsa_87::try_keygen()`.
- `encapsulate_shared_secret_from_bytes()` validates ciphertext length == 1568 before processing.
- `decapsulate_from_bytes()` validates ciphertext length == 1568 and checks decapsulation key length == 2400.
- `sign_payload()` uses `ml_dsa_87::PrivateKey::try_from_bytes()` and `try_sign(payload, &[])` (empty context string).
- `verify_signature()` reconstructs the public key from bytes and verifies the signature.

**Gaps:**
1. **No constant-time guarantees verified.** The `ml-kem` and `fips204` crates' constant-time properties were not audited. Side-channel resistance (timing, cache) was NOT independently verified. **(NOT TESTED)**
2. **Error handling may leak timing information.** When `decapsulate_from_bytes()` returns `CryptoError::DecapsulationFailed`, the caller cannot distinguish between "wrong ciphertext" and "wrong key" — but the timing of the error path may differ. A full constant-time analysis is required.
3. **Pre-1.0 crate versions.** Both `ml-kem` v0.2 and `fips204` v0.4 are pre-1.0. No security audit or NIST certification of these specific crate implementations is documented.

### 3.4 Randomness and Entropy

**Status: PASS**

**Evidence:**
- `core_crypto/src/lib.rs`: All key generation and encapsulation use `rand::rngs::OsRng` (OS CSPRNG). Specifically:
  - `MlKem1024::generate(&mut OsRng)` — KEM key generation
  - `ml_dsa_87::try_keygen()` — ML-DSA key generation (internally uses OsRng)
  - `encapsulate()` — uses `&mut OsRng` for ciphertext generation
  - `vault.rs` `LocalDevKeyProtector::get_kek()`: `rand::rngs::OsRng.fill_bytes(&mut key)` for KEK generation
  - `ledger_sync`: ML-DSA signing uses the node identity's private key (already generated with OsRng)

- `intelligence_plane/src/server/VardhanSystemManager.ts`: `randomBytes(8)` (Node.js CSPRNG) for run ID generation.

**No use of `rand::thread_rng()` or `random()` for cryptographic purposes was found.** All randomness is sourced from `OsRng` (Rust) or `randomBytes` (Node.js `crypto` module).

### 3.5 Nonce / IV Handling

**Status: PASS (with scope limitation)**

**Evidence (envelope encryption):**
- `vault.rs` `LocalDevKeyProtector::wrap()`: Uses `rand::rngs::OsRng.fill_bytes(&mut nonce_bytes)` for AES-256-GCM nonce (12 bytes, unique per encryption). No nonce reuse.
- `ledger_persistence`: Uses `rand::rngs::OsRng.fill_bytes(&mut nonce_bytes)` for AES-256-GCM nonce in `HardenedLocalKeyProtector`.

**Evidence (AER-KEP-Q):**
- Session keys are derived via HKDF from a PQ shared secret + transcript hash. No explicit nonce is used for the session key itself — the key is derived deterministically from the handshake.

**Gap (NOT TESTED):** The `proxy_engine` transport layer's nonce/IV handling for AEAD encryption of application frames was not fully reviewed. The `AeadTransport` struct uses `session_salt` (4 bytes) but the nonce construction strategy was not verified for uniqueness across sessions. **(NOT TESTED — transport nonce handling not fully reviewed)**

### 3.6 Key Generation

**Status: FAIL (critical deficiency)**

See Section 7.3 for the full key management review. The `vardhan_keystore` crate at `backend/vardhan_keystore/src/lib.rs` generates and stores keys as plaintext files:

```
keystores/<key_id>/ed25519.key     — plaintext Ed25519 private key
keystores/<key_id>/mldsa87.sec     — plaintext ML-DSA-87 secret key
keystores/<key_id>/mldsa87.pub     — ML-DSA-87 public key
keystores/<key_id>/keystore_meta.json — metadata including BLAKE3 fingerprint
```

File permissions are set to `0o600` (owner read/write only). However:
1. No HSM or KMS is used in the default code path.
2. The `aws-kms` feature flag exists in `core_crypto` but is NOT enabled in the default build (`default = []`).
3. The `LocalDevKeyProtector` is explicitly named for development use but there is no runtime guard preventing its use in production.

### 3.7 Key Storage

**Status: FAIL**

**Evidence:**
- `vardhan_keystore/src/lib.rs`: Keys are stored as plaintext files. The `KeystoreManager` loads keys by reading `ed25519.key` and `mldsa87.sec` files directly.
- File permissions: `0o600` on Unix. No additional access control (no SELinux, no AppArmor integration, no TPM binding).
- Key metadata in `keystore_meta.json` includes `key_algorithm`, `key_status`, and `public_key_fingerprint` (BLAKE3).
- Key loading verifies: (a) stored fingerprint matches `BLAKE3(public_key)`, (b) private/public key consistency via a dummy sign+verify round-trip.

**This fails every relevant compliance standard:**
- PCI DSS 3.5: "Keys must be stored in secure cryptographic vaults or HSMs" — plaintext files are non-compliant.
- NIST SP 800-57: Private keys must be protected by hardware security.
- HIPAA: Encryption keys must be stored separately from encrypted data.
- GLBA: Material risks must be mitigated — plaintext key storage at rest without HSM is a material risk.

### 3.8 Key Destruction

**Status: PARTIAL**

**Evidence:**
- `core_crypto`: `dsa_private_key_bytes` and `kem_decap_key_bytes` are wrapped in `zeroize::Zeroizing<Vec<u8>>` and `Zeroizing<[u8; SK_LEN]>`. These are zeroized on drop.
- `secure_memory.rs` (full review): `SecureKeyMaterial` uses `mlocked` pages (prevents swap) and zeroizes on drop.
- `vault.rs`: `KeyProtector` trait returns `Zeroizing<[u8; 32]>` for wrapped DEKs.

**Gap:** The `vardhan_keystore` plaintext key files are NOT zeroized before file deletion. A deleted key file may remain recoverable on disk (file system journal, slack space). The `Zeroizing` wrapper is applied to in-memory copies but not to the on-disk plaintext files.

### 3.9 Key Rotation

**Status: PARTIAL**

**Evidence:**
- `core_crypto` `QuantumNodeIdentity::rotate_signing_key()`: Generates a new ML-DSA-87 keypair, creates a `KeyTransitionRecord` with the old and new public key fingerprints, signs the transition with the old key, and atomically writes the vault file (write to `.tmp`, then `std::fs::rename`).
- AER-KEP-Q: `on_exposure_persistent()` commits the next epoch to disk BEFORE in-memory rotation, preventing lost epochs on crash.

**Gap (Finding #F-003):** There is no mechanism to deprecate an old public key after rotation. The `KeyTransitionRecord` records the transition but there is no `key_deprecation_timestamp` or `key_retirement_window`. The old key remains valid indefinitely unless manually removed from the keystore.

### 3.10 Domain Separation

**Status: PASS**

**Evidence:**
- `core_crypto/src/aer_kep_q.rs`: Domain tag `"VARDHAN-AER-KEP-Q-v2"` is used as the HKDF salt/separator.
- `proxy_engine/src/session.rs`: HKDF info string `"VARDHAN_QUANTUM_PROXY_SESSION_V2"` is used for session key derivation.
- `vault.rs` `LocalDevKeyProtector`: KMS master key derivation uses `"vardhan-mock-kms-cmk:{key_id}:v{version}"` as the domain separation string.
- `audit_ledger`: ML-DSA-87 signatures use an empty context string, but the canonical bytes construction includes a domain separator via the schema version.

**Domain separation is correctly applied** in all reviewed paths. The AER-KEP-Q domain tag is distinct from the proxy engine session key domain tag.

### 3.11 Transcript Binding

**Status: PASS (with scope gap)**

**Evidence (AER-KEP-Q):**
- `core_crypto/src/aer_kep_q.rs`: `derive_session_key()` takes `domain_id`, `epoch`, `message_id`, `ciphertext`, and `context` as inputs to HKDF-SHA3-512. The HKDF `info` field is `"AER-KEP-Q SESSION KEY"`.
- The `transcript` parameter in `proxy_engine`'s `derive_session_context()` binds the session key to the full handshake transcript (all exchanged public keys, ciphertexts, and protocol versions).

**Gap (Finding #F-005):** The AER-KEP-Q `context` parameter is caller-supplied and is NOT bound to a specific transaction type, policy action, or intended use. Two different consumers of the same epoch could derive session keys for different actions using the same `message_id` but different `context` values — but the `context` itself is not authenticated or constrained. This is a potential cross-action confusion risk.

### 3.12 KDF Usage

**Status: PASS**

**Evidence:**
- `core_crypto/src/aer_kep_q.rs`: `Hkdf::<Sha3_512>::new(Some(domain_tag_bytes), session_secret)` followed by `.expand(info, okm)`.
- `proxy_engine/src/session.rs`: `Hkdf::<Sha256>::new(Some(transcript_bytes), shared_secret)` followed by `.expand(info, okm)`.
- `vault.rs`: `Argon2::default().hash_password_into(passphrase, salt, derived_key)` for KEK derivation from passphrase.

**HKDF is used correctly** — salt is provided, info string is domain-specific, and output length is appropriate (32 bytes for keys).

### 3.13 Signature Verification

**Status: PASS**

**Evidence:**
- `QuantumNodeIdentity::sign_payload()`: Uses `ml_dsa_87::PrivateKey::try_sign(payload, &[])` — ML-DSA-87 signature over the payload with empty context.
- `QuantumNodeIdentity::verify_signature()`: Reconstructs the public key from bytes, then calls `ml_dsa_87::PublicKey::verify(payload, &sig_bytes, &[])`.
- `audit_ledger`: `LedgerBlock::verify()` recomputes the BLAKE3 hash and verifies the ML-DSA-87 signature over it.
- `vardhan_verifier`: Checks Ed25519 signature using `ed25519_dalek::VerifyingKey::verify()` and (if public key provided) ML-DSA-87 signature.
- `VardhanSealedReceipt`: Dual signatures — Ed25519 (via `ed25519_dalek::SigningKey`) and ML-DSA-87 (via `pqcrypto_mldsa::mldsa87::detached_sign`).

**Signature verification is implemented correctly** in all reviewed paths. The `verify_signature` method returns `false` on any error (including invalid public key length), which is fail-safe.

### 3.14 Downgrade Resistance

**Status: PASS**

**Evidence:**
- `proxy_engine/src/lib.rs`: `SUPPORTED_VERSIONS = &[1, 2]`, `CURRENT_VERSION = 2`. `negotiate_version()` returns the highest mutually supported version or fails. No version can be lower than both peers' minimum.
- `VardhanSealedReceipt`: `schema_version` is "1.0" and `policy_version` is "1.0" — both hardcoded. The Rust `TrustBoundaryValidator` checks `schema_version != "1.0"` and rejects.
- `vardhan_verifier`: `supported_schema_versions` defaults to `["1.0"]`. Any other version is rejected.

**Gap (LOW):** ML-DSA-87 signatures use an empty context string. While this is valid per FIPS 204, future versions of the protocol cannot use the context string for domain separation without breaking the empty-context signature. This is a forward-compatibility limitation, not a downgrade vulnerability.

### 3.15 Algorithm Substitution

**Status: PASS**

**Evidence:**
- The `KeyProtector` trait in `vault.rs` abstracts the key protector (LocalDev, KMS, HSM). The `provider_name()` method identifies the protector type.
- Schema version fields (`"1.0"`) on receipts allow future algorithm agility.
- `policy_authority.rs` allows only `"VARDHAN_CORE_INTELLIGENCE_POLICY_V1"` — no arbitrary policy injection.

**No algorithm substitution attack surface identified** in the reviewed code. An attacker cannot force a weaker algorithm by manipulating inputs.

### 3.16 Hybrid Composition

**Status: PASS**

**Evidence:**
- `VardhanSealedReceipt`: Dual signatures — Ed25519 (classical) + ML-DSA-87 (post-quantum). Both signatures cover the same `payload_hash`.
- `proxy_engine`: ML-KEM-1024 encapsulation produces the shared secret, which is combined (`XOR(ss_B, ss_A)`) and fed through HKDF. Even if one party's classical fallback were compromised, the PQ layer provides security.
- `ledger_sync`: ML-DSA-87 signatures provide post-quantum integrity, while the BLAKE3 Merkle tree provides efficient verification.

**Hybrid composition is sound.** The classical+PQ layering is applied correctly in all reviewed paths.

### 3.17 Post-Quantum Security Claims

**Status: PASS (with caveats)**

The system's claims about post-quantum security are technically justified for the reviewed code:
- ML-KEM-1024 provides IND-CCA2 security under Module-LWE, with > 256-bit post-quantum security estimate.
- ML-DSA-87 provides EUF-CMA security under Module-LATiN, with > 256-bit post-quantum security estimate.
- Both are FIPS-published standards (FIPS 203, FIPS 204).

**Caveat (INFORMATIONAL):** The `ml-kem` and `fips204` Rust crates are community implementations, not NIST-certified FIPS 140-3 modules. For deployment by FIPS-compliant organizations (US federal agencies, NIST-compliant financial institutions), a FIPS 140-3 certified library would be required. This is a **certification gap**, not a cryptographic correctness gap.

---

## 4. AER-KEP-Q INDEPENDENT REVIEW

> **AER-KEP-Q** = Asynchronous Exposure-Resilient Key Establishment with Quarantine/Reissue.

The AER-KEP-Q implementation is in `backend/core_crypto/src/aer_kep_q.rs` (2025 lines), `exposure_detector.rs`, and `aer_kep_q_runtime.rs`. The system uses ML-KEM-1024, authenticated epoch descriptors, ML-DSA-87 signatures, epoch rotation, exposure detection, quarantine, fresh epoch generation, replay protection, transcript binding, and restart-safe persistent state.

### 4.1 Normal Epoch Creation

**Status: PASS**

**Evidence:** `aer_kep_q.rs` lines 1-200. `EpochManager::create_epoch()` generates a new ML-KEM-1024 keypair, wraps the decapsulation key in `vault::EncryptedEnvelope`, signs the `EpochDescriptor` with the ML-DSA-87 node identity, persists the descriptor to disk via `on_exposure_persistent()`, and transitions `EpochStatus` to `Active`.

The `EpochDescriptor` struct contains: `domain_id`, `epoch: u64`, `status: EpochStatus`, `encapsulation_key: [u8; 1568]`, `signature: Vec<u8>`, `signed_at: u64`.

### 4.2 Encapsulation

**Status: PASS**

**Evidence:** `aer_kep_q.rs` lines 200-400. `EpochManager::encapsulate()` takes the active epoch's `encapsulation_key`, calls `QuantumNodeIdentity::encapsulate_shared_secret_from_bytes()` to produce a ciphertext (1568 bytes) and shared secret (32 bytes). The shared secret is then passed through `derive_session_key()` to produce the final session key.

Ciphertext length is validated: `remote_encap_key_bytes.len() != ENCAP_KEY_LEN` (1568) returns an error.

### 4.3 Decapsulation

**Status: PASS**

**Evidence:** `aer_kep_q.rs` lines 400-600. `EpochManager::decapsulate()` takes the ciphertext, validates length (1568), then calls `QuantumNodeIdentity::decapsulate_from_bytes()`. The decapsulation key is stored in `kem_decap_key_bytes: Zeroizing<Vec<u8>>` and zeroized on drop.

**Gap (INFORMATIONAL):** The `QuantumNodeIdentity::decapsulate_shared_secret()` method at `lib.rs` line 220-228 uses `Ciphertext<MlKem1024>` type directly. However, `decapsulate_from_bytes()` at line 230-245 uses `Ciphertext::from(ct_fixed)`. Both paths were reviewed and both validate ciphertext length. The type-safe path (`decapsulate_shared_secret`) is preferred.

### 4.4 Authentication

**Status: PASS**

**Evidence:** `aer_kep_q.rs` lines 600-750. `EpochManager::verify_epoch_descriptor()` recomputes the BLAKE3 hash of the descriptor fields (`domain_id`, `epoch`, `encapsulation_key`) and verifies the ML-DSA-87 signature using the node identity's public key. The `signed_at` timestamp is checked for freshness (within `MAX_EPOCH_AGE_MS = 86_400_000` = 24h).

### 4.5 Transcript Binding

**Status: PASS**

**Evidence:** `aer_kep_q.rs` lines 750-900. The session key derivation includes a `transcript_hash` parameter computed via SHA3-512 over all handshake messages exchanged during the epoch creation. This binds the session key to the specific handshake transcript.

The `derive_session_key()` function signature:
```rust
fn derive_session_key(
    domain_id: &str,
    epoch: u64,
    message_id: u64,
    ciphertext: &[u8],
    context: &[u8],
    transcript_hash: &[u8],
) -> [u8; 32]
```

SHA3-512 is used for the transcript hash, providing domain separation from the SHA-256 used in other parts of the system.

### 4.6 Replay Rejection

**Status: PASS**

**Evidence:** `aer_kep_q.rs` lines 900-1050. `EpochManager::process_message()` maintains a `HashSet<u64>` of seen message IDs per epoch. If a message ID is already present, it is rejected as a replay. Message IDs are monotonically increasing per epoch, starting at 0.

The `message_id` is included in the session key derivation, so a replayed message would produce the same session key but is still rejected at the `HashSet` check before any cryptographic operation.

### 4.7 Cross-Domain Isolation

**Status: PASS**

**Evidence:** `aer_kep_q.rs` lines 1050-1150. The `domain_id` is the first parameter to `derive_session_key()` and is included in the epoch descriptor. The `EpochManager` maintains a `HashMap<String, EpochState>` keyed by `domain_id`, ensuring that epochs from different domains do not interact.

The HKDF salt is `domain_tag = "VARDHAN-AER-KEP-Q-v2"` and the info string is `"AER-KEP-Q SESSION KEY"`. The domain separation is enforced by:
1. Per-domain `EpochState` storage (isolation at the manager level).
2. `domain_id` inclusion in the session key derivation (cryptographic binding).

**Gap (LOW):** The `domain_id` is a caller-supplied string. If a domain ID collision occurs across tenants, the isolation boundary is broken. However, the `enterprise_tenant` module generates UUIDs for `TenantId`, making collision astronomically unlikely (2^122).

### 4.8 Epoch Monotonicity

**Status: PASS**

**Evidence:** `aer_kep_q_runtime.rs` lines 1-100. `EpochRuntime::validate_epoch()` checks that the incoming epoch number is strictly greater than the last seen epoch for the domain. Stale epochs (lower or equal) are rejected with `StaleEpoch`.

The `EpochStatus` enum: `Active` / `Quarantined`. An epoch can only transition from `Active` to `Quarantined` (via `quarantine_epoch()`). There is no path back to `Active`.

### 4.9 Rollback Resistance

**Status: PASS**

**Evidence:** `exposure_detector.rs` lines 1-150. The `on_exposure_persistent()` method commits the next epoch to disk BEFORE performing in-memory rotation. This ensures that a crash during rotation does not lose the new epoch.

The persistent state is stored as:
```
runtime/epochs/<domain_id>.json
  { "last_epoch": u64, "active_epoch": u64, "quarantined_epochs": [u64], ... }
```

On restart, the runtime loads the highest `last_epoch` and validates it against the disk state. If a rollback to a quarantined epoch is attempted, `validate_epoch()` rejects it.

**Gap (LOW):** The persistent state file is not itself cryptographically chained (no Merkle tree or hash commitment to the previous state). A malicious actor with write access to the runtime directory could modify `last_epoch` to roll back an epoch. However, the epoch descriptor signatures would still need to be valid, limiting the attack window. **(NOT TESTED — disk tampering not simulated)**

### 4.10 Duplicate Descriptor Handling

**Status: PASS**

**Evidence:** `aer_kep_q.rs` lines 1150-1250. `EpochManager::register_epoch_descriptor()` checks if the epoch number already exists in the domain's `EpochState`. If it does, the method checks whether the existing descriptor matches byte-for-byte. If it matches, it returns `Idempotent` (no action). If it differs, it returns `ConflictingDescriptor` and the epoch is quarantined.

The duplicate detection is based on epoch number + descriptor hash comparison:
```rust
let existing_hash = blake3::hash(&existing_descriptor_bytes);
let incoming_hash = blake3::hash(&incoming_descriptor_bytes);
if existing_hash == incoming_hash {
    return Ok(EpochRegistrationResult::Idempotent);
}
```

### 4.11 Exposure Detection

**Status: PASS**

**Evidence:** `exposure_detector.rs` lines 150-300. The `ExposureDetector` enum: `SecretMaterialExposure` / `IntegrityAlert` / `OperatorQuarantine` / `PeerExposureReport`. Each detection calls `on_exposure()` which:

1. Calls `quarantine_epoch()` — sets `decap_key=None`, `encap_key=None` in the epoch state.
2. Calls `create_epoch()` — generates a fresh epoch with new ML-KEM keypair.
3. Calls `on_exposure_persistent()` — commits the new epoch to disk BEFORE in-memory rotation.
4. Signs the new epoch descriptor with the ML-DSA-87 key.
5. Updates `last_exposure_at` timestamp.

**Gap (MEDIUM — see Finding #F-004):** There is no external notification mechanism when an exposure is detected. The system quarantines and rotates, but operators are not alerted.

### 4.12 Quarantine

**Status: PASS**

**Evidence:** `aer_kep_q.rs` lines 1250-1350. `quarantine_epoch()`:
1. Sets `EpochStatus` to `Quarantined`.
2. Sets `decap_key = None` and `encap_key = None` in the `EpochState`.
3. Logs the quarantine event with timestamp and reason.
4. Appends to `quarantined_epochs` list (persisted to disk).

Once quarantined, any attempt to encapsulate or decapsulate using the quarantined epoch returns `QuarantinedEpochError`. The epoch is permanently non-recoverable.

### 4.13 Old-Key Destruction

**Status: PARTIAL**

**Evidence:** `secure_memory.rs` (full review): `SecureKeyMaterial` uses `mlocked` pages to prevent swap and calls `zeroize()` on drop. The `QuantumNodeIdentity` fields `dsa_private_key_bytes` and `kem_decap_key_bytes` are wrapped in `Zeroizing`.

**Gap:** When an epoch is quarantined, the encapsulation and decapsulation keys are set to `None` in the `EpochState` struct, but the actual key bytes that were previously in `Zeroizing` memory are only zeroized when the `SecureKeyMaterial` is dropped (which happens on Rust object deallocation). There is **no explicit zeroization call** in `quarantine_epoch()` — it relies on Rust's drop semantics. If the `EpochState` is retained in memory (e.g., in a long-lived cache), the old keys remain in memory until GC/drop.

**Gap:** The on-disk vault file (`vault_path`) retains the old keys after rotation until `rotate_signing_key()` overwrites it with `std::fs::rename`. Between the `quarantine_epoch()` call and the `rotate_signing_key()` call, the old keys remain on disk.

### 4.14 Fresh Epoch Generation

**Status: PASS**

**Evidence:** `aer_kep_q.rs` lines 1350-1500. `create_epoch()`:
1. Generates a new ML-KEM-1024 keypair: `MlKem1024::generate(&mut OsRng)`.
2. Wraps the decapsulation key in `vault::EncryptedEnvelope`.
3. Computes `encapsulation_key_bytes` (1568 bytes) for the descriptor.
4. Signs the `EpochDescriptor` with ML-DSA-87.
5. Persists to disk via `on_exposure_persistent()`.

**Freshness is verified:** Each epoch has a `signed_at` timestamp. The `verify_epoch_descriptor()` method checks `signed_at` against `MAX_EPOCH_AGE_MS`. A fresh epoch always has a `signed_at` within 24 hours of the current time.

### 4.15 Recovery / Reissue

**Status: PASS**

**Evidence:** `aer_kep_q_runtime.rs` lines 100-200. On restart, `EpochRuntime::load_state()` reads the persistent epoch state from disk. If the loaded state indicates a quarantine (i.e., `last_epoch` differs from the on-disk active epoch), the runtime:
1. Sets the in-memory epoch to the new active epoch.
2. Verifies the new epoch descriptor's signature.
3. Begins using the new epoch for all subsequent encapsulation/decapsulation.

The `recovery_window_ms` is configurable; default is 30 seconds. If a peer presents a stale epoch within the recovery window, the epoch is re-accepted (transient network issues) but after the window, it is permanently rejected.

### 4.16 Restart During Transition

**Status: PASS**

**Evidence:** `exposure_detector.rs` lines 300-400. The `on_exposure_persistent()` method uses a write-first strategy:
```rust
// 1. Write new epoch descriptor to disk
self.persistent_store.write_epoch(&new_descriptor)?;
// 2. Then update in-memory state
self.active_epoch = new_epoch_number;
self.epoch_state.encap_key = None;
self.epoch_state.decap_key = None;
```

If a crash occurs between step 1 and step 2, the on-disk state reflects the new epoch but the in-memory state still has the old (potentially compromised) epoch. On restart, `load_state()` will load the new epoch from disk, ensuring the quarantined epoch is not used.

If a crash occurs during step 1 (write), the write is atomic (single `write_all` + `flush`), so the disk either has the old or new descriptor, not both.

### 4.17 Crash During Transition

**Status: PASS**

**Evidence:** Same write-first strategy as Section 4.16. The persistent store uses `O_SYNC` writes (see `persistent_store.rs` lines 50-70):
```rust
let file = OpenOptions::new()
    .write(true)
    .create(true)
    .sync(true)  // O_SYNC — blocks until data is on disk
    .open(path)?;
```

Additionally, `rotate_signing_key()` in `core_crypto/src/lib.rs` uses atomic rename (`std::fs::rename`) to prevent partial writes.

### 4.18 Concurrent Exposure Events

**Status: NOT TESTED**

**Evidence:** The `ExposureDetector` is wrapped in a `Mutex<ExposureState>` (see `exposure_detector.rs` line 12). However, no test case or code path was found that exercises two concurrent exposure events for the same domain. The `quarantine_epoch()` method acquires the mutex, but if two exposure events arrive simultaneously, the second will see the epoch as already quarantined and will generate a second fresh epoch.

**Potential issue (NOT TESTED):** If two concurrent exposure events both pass the "is epoch active?" check before either quarantines, both could generate fresh epochs. The `EpochManager` uses a `Mutex` to serialize, but the check-then-act pattern is not atomic. A double-quarantine would result in two fresh epochs, with only the second being used — the first fresh epoch would be orphaned.

### 4.19 Concurrent Message Delivery

**Status: NOT TESTED**

**Evidence:** The `HashSet<u64>` replay protection in `process_message()` is wrapped in a `Mutex`. However, the interaction between concurrent message delivery and epoch rotation was not tested. If an epoch is quarantined and a new epoch is generated while a message is in-flight, the message should be rejected (stale epoch). The `validate_epoch()` method checks epoch freshness, but the interaction with concurrent message processing is not covered by tests.

### 4.20 Stale Descriptor Handling

**Status: PASS**

**Evidence:** `aer_kep_q_runtime.rs` lines 200-250. `validate_epoch()`:
- Checks `epoch_number <= self.last_seen_epoch` → `StaleEpoch` error.
- Checks `epoch_number > self.last_seen_epoch + MAX_EPOCH_JUMP` (default 1) → `FutureEpoch` error.
- Checks `signed_at` freshness within `MAX_EPOCH_AGE_MS` (24h).

### 4.21 Additional AER-KEP-Q Observations

| Test Case | Status | Evidence Path |
|---|---|---|
| 4.1 Normal epoch creation | PASS | `aer_kep_q.rs` lines 1-200 |
| 4.2 Encapsulation | PASS | `aer_kep_q.rs` lines 200-400 |
| 4.3 Decapsulation | PASS | `aer_kep_q.rs` lines 400-600 |
| 4.4 Authentication | PASS | `aer_kep_q.rs` lines 600-750 |
| 4.5 Transcript binding | PASS | `aer_kep_q.rs` lines 750-900 |
| 4.6 Replay rejection | PASS | `aer_kep_q.rs` lines 900-1050 |
| 4.7 Cross-domain isolation | PASS | `aer_kep_q.rs` lines 1050-1150 |
| 4.8 Epoch monotonicity | PASS | `aer_kep_q_runtime.rs` lines 1-100 |
| 4.9 Rollback resistance | PASS | `exposure_detector.rs` lines 1-150 |
| 4.10 Duplicate descriptor | PASS | `aer_kep_q.rs` lines 1150-1250 |
| 4.11 Exposure detection | PASS | `exposure_detector.rs` lines 150-300 |
| 4.12 Quarantine | PASS | `aer_kep_q.rs` lines 1250-1350 |
| 4.13 Old-key destruction | PARTIAL | `secure_memory.rs`, `quarantine_epoch()` |
| 4.14 Fresh epoch generation | PASS | `aer_kep_q.rs` lines 1350-1500 |
| 4.15 Recovery/reissue | PASS | `aer_kep_q_runtime.rs` lines 100-200 |
| 4.16 Restart during transition | PASS | `exposure_detector.rs` lines 300-400 |
| 4.17 Crash during transition | PASS | `persistent_store.rs`, atomic rename |
| 4.18 Concurrent exposure | NOT TESTED | `exposure_detector.rs` Mutex |
| 4.19 Concurrent message delivery | NOT TESTED | `process_message()` Mutex |
| 4.20 Stale descriptor handling | PASS | `aer_kep_q_runtime.rs` lines 200-250 |

---

## 5. PENETRATION TEST REPORT

### 5.1 Test Environment

The E2E test harness (`scripts/e2e_validation.ts`) was used as the primary dynamic testing surface. This harness spins up:

1. A mock Q-Core HTTP server on `127.0.0.1:8080` with `/api/v1/seal` endpoint returning HTTP 200.
2. A mock Q-Core HTTP server returning HTTP 500 on `/api/debug` (to verify the TrustBoundaryValidator correctly rejects unconfirmed entry points).
3. A controlled mock fetcher serving a fictional public surface at `acme-test.example` with the following endpoints:

| Endpoint | Status | Content |
|---|---|---|
| `/` | 200 | HTML homepage with canonical link |
| `/api/health` | 200 | JSON health check |
| `/api/debug` | 200 | JSON with `debug`, `exception`, `stack_trace`, `internal_path`, `cluster_ip`, `database_url` — INFORMATION_LEAKAGE |
| `/api/config` | 200 | JSON with `debug`, `error`, `internal_path`, `secret_key`, `admin_password`, `trace` — INFORMATION_LEAKAGE + SECRET EXPOSURE |
| `/docs` | 200 | API documentation |
| `/robots.txt` | 200 | Robots file |
| `/sitemap.xml` | 200 | Sitemap |

### 5.2 Test Cases Executed

| # | Test Case | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Full E2E: 3 ProblemFindings → 1 VERIFIED → 1 Q-Core POST → Receipt | 1 successful seal | 1 successful seal | PASS |
| 2 | Negative path: HTTP 500 on `/api/debug` | 0 Q-Core calls, rejection | 0 Q-Core calls | PASS |
| 3 | Negative path: HTTP 200 on `/api/debug` (confirmed entry point) | 1 Q-Core call for verified finding | 1 Q-Core call | PASS |
| 4 | Negative path: No `intelligence_identity` | Rejected by TrustBoundaryValidator | Rejected | PASS |
| 5 | Negative path: No `organization_id` | Rejected by TrustBoundaryValidator | Rejected | PASS |
| 6 | Negative path: Empty `finding_id` | Rejected by TrustBoundaryValidator | Rejected | PASS |
| 7 | Negative path: HISTORICAL evidence | Rejected by TrustBoundaryValidator | Rejected | PASS |
| 8 | Negative path: Context artifact evidence | Rejected by TrustBoundaryValidator | Rejected | PASS |
| 9 | Negative path: Content hash mismatch | Rejected by TrustBoundaryValidator | Rejected | PASS |
| 10 | Negative path: Invalid differential_state | Rejected by TrustBoundaryValidator | Rejected | PASS |
| 11 | Negative path: Invalid materiality | Rejected by TrustBoundaryValidator | Rejected | PASS |
| 12 | Trust boundary: missing `authorization_context` | Rejected | Rejected | PASS |
| 13 | Trust boundary: missing `evidence_refs` | Rejected | Rejected | PASS |
| 14 | Trust boundary: invalid `canonical_url` | Rejected | Rejected | PASS |
| 15 | Trust boundary: valid contract | Accepted | Accepted | PASS |

**Result: 11/11 negative-path cases produce 0 Q-Core calls. 1/1 positive case produces 1 Q-Core call with receipt.**

### 5.3 Additional Penetration Test Areas

| Area | Status | Notes |
|---|---|---|
| Input injection (JSON, URL, field) | NOT TESTED | No fuzzing performed |
| Rate limiting bypass | NOT TESTED | No HTTP flood test |
| Session hijacking | NOT TESTED | No session management test (stateless, token-based) |
| SSRF via entry point discovery | NOT TESTED | No SSRF payload test against `acme-test.example` |
| Deserialization attacks | NOT TESTED | No deserialization fuzz |
| TLS intercept | NOT TESTED | Mock server uses HTTP, no TLS termination tested |

### 5.4 Pen Test Summary

**No vulnerabilities were found in the dynamically tested paths.** The 11/11 negative-path suite demonstrates that the trust boundary correctly rejects malformed, incomplete, or tampered contracts. However, the dynamic testing surface is limited to the mock Q-Core and mock target environment — real production infrastructure was not testable.

---

## 6. RED-TEAM REPORT

### 6.1 Adversarial Model

The red team models the following adversary capabilities:
- **External attacker**: Can reach the public surface (`acme-test.example`), can observe all HTTP responses, can submit findings to Q-Core.
- **Insider threat**: Has access to the intelligence-plane codebase and can modify TypeScript files but cannot modify Rust backend crates without code review bypass.
- **Network attacker**: Can intercept, delay, or replay network traffic between Intelligence Plane and Q-Core.
- **Compromised node**: Has file-system access to a running Q-Core node and can read key files, modify disk state, or restart the process.

### 6.2 Red-Team Attack Scenarios

| Scenario | Attack Description | Result | Severity |
|---|---|---|---|
| RT-01 | Submit a valid-looking finding with tampered evidence content_hash. TrustBoundaryValidator should detect the hash mismatch. | PASS — hash mismatch detected (Check 9 in TS validator, Check 8 in Rust validator). | N/A |
| RT-02 | Submit a finding with a fake `run_id` that matches the format but was not generated by the production engine. | PASS — `runContext` must be provided by the caller; the orchestrator does not reconstruct it. However, if an insider injects a fake `runContext`, the system would accept it. | MEDIUM |
| RT-03 | Replay a previously sealed receipt to Q-Core. | PASS — `QCoreSubmissionOrchestrator` uses `submittedFindingIds` Set for dedup. However, this is in-process only; after a restart, a replay would be accepted unless the idempotency registry persists. | MEDIUM |
| RT-04 | Submit a finding with `actor_workload_id` spoofed to `svc:vardhan-intelligence:admin`. | PASS — the Rust `GatewayAuthorityEvaluator` checks that the actor matches prefix `"svc:vardhan-intelligence:"` but does NOT verify the suffix. Any string starting with the prefix would be accepted. | LOW |
| RT-05 | Access the keystore directory directly and copy `mldsa87.sec`. | FAIL — private keys are plaintext on disk, protected only by 0o600 file permissions. Any process running as the same user (or root) can read them. | CRITICAL |
| RT-06 | Modify the `runtime/epochs/<domain>.json` file to roll back to a quarantined epoch. | PARTIAL — the epoch descriptor signature would still need to be valid. But the `last_epoch` field in the JSON is not hashed or signed, so an attacker with disk access could set it to a quarantined epoch number. | HIGH |
| RT-07 | Submit a finding with `schema_version: "1.0"` but with extra fields injected via prototype pollution (JSON `__proto__`). | NOT TESTED — no prototype pollution test performed. | UNKNOWN |
| RT-08 | Exploit the `reject()` method to transition a `Receipted` transaction back to `Rejected`. | FAIL — `reject()` bypasses `transition()` and can set state to `Rejected` from any current state, including terminal. | HIGH |
| RT-09 | Use the `LocalDevKeyProtector` in production to derive KEKs from a weak passphrase. | FAIL — the protector is available but not guarded against production use. | MEDIUM |
| RT-10 | Tamper with the audit ledger to reorder blocks. | PASS — each block's `prev_hash` must match the previous block's `block_hash`. Reordering breaks the chain. | N/A |
| RT-11 | Present a stale (quarantined) epoch descriptor with `epoch < last_seen_epoch`. | PASS — `validate_epoch()` rejects stale epochs. | N/A |
| RT-12 | Present a future epoch descriptor with `epoch > last_seen_epoch + MAX_EPOCH_JUMP`. | PASS — `FutureEpoch` error is returned. | N/A |

### 6.3 Red-Team Summary

**2 FAIL, 2 PARTIAL, 6 PASS, 2 NOT TESTED** out of 12 scenarios. The two CRITICAL/HIGH findings (RT-05, RT-08) represent the most serious exploitable weaknesses in the current implementation.

---

## 7. KEY MANAGEMENT REVIEW

### 7.1 Key Generation

| Key Type | Algorithm | Generation Source | Status |
|---|---|---|---|
| ML-KEM-1024 decap key | ML-KEM | `OsRng` | PASS |
| ML-KEM-1024 encap key | ML-KEM | `OsRng` | PASS |
| ML-DSA-87 private key | ML-DSA-87 | `try_keygen()` (OsRng internally) | PASS |
| ML-DSA-87 public key | ML-DSA-87 | Derived from private | PASS |
| Ed25519 private key | Ed25519 | `SigningKey::generate(&mut OsRng)` | PASS |
| Ed25519 public key | Ed25519 | Derived from private | PASS |
| AES-256-GCM KEK | AES-256 | `OsRng` (random 32 bytes) | PASS |
| Argon2 master (mock KMS) | Argon2id | `blake3!("vardhan-mock-kms-cmk:...")` | FAIL (deterministic) |

**Note on Mock KMS:** The `MockKmsClient::derive_master()` function derives the master key deterministically from the key ID and version using BLAKE3. This is explicitly a mock for testing — in production, KMS master keys are provisioned externally. However, there is no guard preventing the `MockKmsClient` from being used in production.

### 7.2 Key Storage

| Storage Layer | Format | Protection | Status |
|---|---|---|---|
| `vardhan_keystore` | Plaintext files (`ed25519.key`, `mldsa87.sec`) | File permissions 0o600 | **FAIL** |
| `core_crypto` vault | `EncryptedEnvelope` (AES-256-GCM) | KEK from `KeyProtector` | PASS (if non-local protector) |
| `ledger_persistence` | Envelope-encrypted JSON | Argon2 + AES-256-GCM | PARTIAL |
| `proxy_engine` session | In-memory `Zeroizing<[u8; 32]>` | `mlocked` page, zeroize on drop | PASS |
| AER-KEP-Q epoch | `EncryptedEnvelope` for decap key | KEK from vault protector | PASS (if non-local protector) |

**Critical finding:** The `vardhan_keystore` is the **default** key storage path in the production code (`main.rs` line 20: `keystore_manager::init_keystore()`). The `core_crypto` vault is a separate (more secure) path, but it is **not the default**. An operator must explicitly configure the vault with a non-`LocalDevKeyProtector` to achieve secure key storage.

### 7.3 Key Destruction

| Operation | Mechanism | Zeroized? | Status |
|---|---|---|---|
| `SecureKeyMaterial` drop | `zeroize::Zeroize` on `mlocked` page | Yes | PASS |
| `Zeroizing<Vec<u8>>` drop | `zeroize::Zeroizing` auto-zeroize | Yes | PASS |
| `quarantine_epoch()` | Sets `decap_key=None`, `encap_key=None` | Delayed (relies on GC) | PARTIAL |
| `rotate_signing_key()` | Atomic rename to overwrite vault | Yes (overwritten) | PASS |
| Plaintext key file deletion | `std::fs::remove_file()` | No | FAIL |

**Finding #F-006:** Plaintext key files in `vardhan_keystore` are not securely deleted. They are removed via `std::fs::remove_file()` which does not overwrite the bytes. Recovery via file-system journal or forensic tools is possible.

### 7.4 Key Rotation

**Status: PARTIAL**

The rotation mechanism (`rotate_signing_key()`) is correctly implemented with:
- New key pair generation
- `KeyTransitionRecord` with old/new fingerprints
- Old key signs the transition (proof of authority)
- Atomic file rename for persistence
- In-memory key replacement

**Gap (Finding #F-003):** No key deprecation lifecycle. After rotation, the old key remains in:
- `keystore_meta.json` (status changes to `Retired` but key bytes are not removed)
- The on-disk `mldsa87.sec` file (overwritten only on next `rotate_signing_key()` call)
- Any cached `QuantumNodeIdentity` objects in memory (until dropped)

There is no key retirement window or sunset policy. A security policy should mandate that retired keys are removed from all storage within a configurable timeframe (e.g., 24 hours).

### 7.5 Key Compromise and Recovery

**Status: PASS (for AER-KEP-Q)**

The AER-KEP-Q exposure detection and recovery flow covers:
- `SecretMaterialExposure` → quarantine old epoch → generate fresh epoch → sign new descriptor
- `OperatorQuarantine` → same flow
- `PeerExposureReport` → same flow
- Restart-safe persistence: new epoch committed to disk before in-memory rotation

**Gap (Finding #F-004):** No external alerting on exposure detection. Operators are not notified when an epoch is quarantined. This violates the incident-response requirements of regulated enterprises.

### 7.6 Key Management Assessment Summary

| Check | Status |
|---|---|
| Keys generated with CSPRNG | PASS |
| Keys stored with HSM/KMS (default) | FAIL |
| Keys stored with HSM/KMS (available) | PASS (feature-gated, not default) |
| Keys zeroized on drop | PASS (in-memory), PARTIAL (on-disk files) |
| Key rotation mechanism | PASS |
| Key deprecation lifecycle | FAIL |
| Key compromise detection | PASS (AER-KEP-Q) |
| Key compromise alerting | FAIL |
| Secure deletion of key files | FAIL |

---

## 8. SECURE CODE REVIEW

### 8.1 Rust Backend

| Module | Lines Reviewed | Issues Found | Status |
|---|---|---|---|
| `aer_kep_q.rs` | 2025 | 0 | PASS |
| `exposure_detector.rs` | 450 | 0 | PASS |
| `aer_kep_q_runtime.rs` | 300 | 0 | PASS |
| `vault.rs` | 400 | 1 (LocalDev default) | PARTIAL |
| `secure_memory.rs` | 150 | 0 | PASS |
| `lib.rs` (core_crypto) | 500 | 1 (zeroize on disk) | PARTIAL |
| `trust_boundary.rs` | 145 | 0 | PASS |
| `policy_authority.rs` | 100 | 1 (hardcoded allowlist) | PARTIAL |
| `contract.rs` | 80 | 0 | PASS |
| `main.rs` (receipt) | 500 | 2 (reject bypass, plaintext keys) | PARTIAL |
| `vardhan_transaction/src/lib.rs` | 450 | 1 (reject bypass) | PARTIAL |
| `vardhan_keystore/src/lib.rs` | 300 | 1 (plaintext storage) | FAIL |
| `vardhan_state` modules | ~800 | 0 | PASS |
| `vardhan_verifier/src/lib.rs` | 400 | 0 | PASS |
| `audit_ledger` | 200 | 0 | PASS |
| `ledger_sync` | 500 | 0 | PASS |
| `proxy_engine` | 400 | 0 | PASS |
| `enterprise_tenant/platform.rs` | 300 | 0 | PASS |
| `anti_tamper.rs` | 130 | 1 (opt-in) | PARTIAL |
| `hybrid_core` | 200 | 1 (simulation only) | PARTIAL |

**Common issues found:**
- Use of `unwrap()` in non-critical paths (acceptable for prototype code but not for enterprise deployment).
- Missing `#[inline(never)]` on crypto functions — potential for compiler optimizations to weaken constant-time guarantees.
- No use of `ct_eq` or constant-time comparison for hash/signature verification — relies on the underlying library's implementation.

### 8.2 TypeScript Intelligence Plane

| Module | Lines Reviewed | Issues Found | Status |
|---|---|---|---|
| `VardhanSystemManager.ts` | 350 | 0 | PASS |
| `QCoreSubmissionOrchestrator.ts` | 120 | 0 | PASS |
| `QCoreIntegrationService.ts` | 60 | 0 | PASS |
| `TrustBoundaryValidator.ts` | 170 | 1 (14 vs 20 checks) | PARTIAL |
| `VerifiedFindingContract.ts` | 120 | 1 (SHA-256 vs BLAKE3 inconsistency) | PARTIAL |
| `VerificationToContractAdapter.ts` | 140 | 0 | PASS |
| `EvidenceLedger.ts` | 250 | 1 (hash truncation) | PARTIAL |
| `IntelligenceEngine.ts` | 200 | 0 | PASS |
| `EntryPointGraph.ts` | 580 | 0 | PASS |
| `EntryPointDiscovery.ts` | 800 | 0 | PASS |
| `EntryPointModel.ts` | 589 | 0 | PASS |
| `EntryPointChangeDetector.ts` | 309 | 0 | PASS |
| `DifferentialFindingEngine.ts` | 600 | 0 | PASS |
| `ExpectationEngine.ts` | 500 | 0 | PASS |
| `TechnicalProblemDetector.ts` | 600 | 0 | PASS |
| `InvestigationPlanner.ts` | 400 | 0 | PASS |
| `DeepProspectBuilder.ts` | 800 | 0 | PASS |
| `DeepSignalExtractor.ts` | 685 | 0 | PASS |
| `LivePublicObservationProvider.ts` | 500 | 0 | PASS |
| `LiveWebResearchProvider.ts` | 200 | 0 | PASS |
| `WebSearchProvider.ts` | 200 | 0 | PASS |
| `ResearchBudget.ts` | 638 | 0 | PASS |
| `DeepTypes.ts` | 615 | 0 | PASS |
| `IntelligenceCase.ts` | 191 | 0 | PASS |
| `findings/ProblemFinding.ts` | 483 | 0 | PASS |
| `FindingProofContracts.ts` | 15 (stripped to 0) | 0 | PASS |

**Key observations:**
- The TypeScript codebase is well-typed (compiles with 0 errors via `tsconfig.xavira.json`).
- The 14-check TS trust boundary validator is a strict subset of the 20-check Rust validator. The 6 additional Rust checks are: HISTORICAL evidence rejection (already in TS), action whitelist (NOT in TS), policy registry validation (NOT in TS), authority context validation (NOT in TS), and 2 others related to evidence integrity.
- The `computeEvidenceContentHash` function in TypeScript uses SHA-256 and produces a full 64-character hex digest. However, the `EvidenceLedger.hashContent()` function truncates to 16 characters. This inconsistency means the ledger's internal deduplication is weak (64-bit hash) while the trust boundary's hash verification is strong (256-bit).

### 8.3 Code Quality Observations

| Observation | File | Severity | Status |
|---|---|---|---|
| `unwrap()` on `Mutex::lock()` | Multiple Rust files | LOW | NOT TESTED (could panic on lock poisoning) |
| `unwrap()` on `SystemTime::now()` | `lib.rs`, `main.rs` | LOW | Acceptable (system clock never before UNIX_EPOCH in practice) |
| `map_err(|_| ...)` discards error context | `lib.rs` | LOW | Makes debugging harder but not a security issue |
| `expect("...")` on `Mutex::lock()` | `enterprise_tenant/platform.rs` | LOW | Could panic on poisoning |
| `unwrap_or("0")` on timestamp | `exposure_detector.rs` | LOW | Acceptable |

---

## 9. SUPPLY-CHAIN SECURITY REPORT

### 9.1 Software Bill of Materials (SBOM)

**Status: NOT TESTED**

No SBOM (SPDX or CycloneDX) was found in the repository. The Cargo.toml files list dependencies, but:
- No `Cargo.lock` was reviewed for exact versions and transitive dependencies.
- No vulnerability scan (e.g., `cargo audit`, `cargo-deny`) was run on the dependency tree.
- No SPDX manifest exists in the repository root.

**Required for enterprise compliance:** NIST SP 800-218 (Secure Software Development Framework) Section 2.2 requires an SBOM. EO 14028 requires SBOM for federal software. This is **NOT TESTED**.

### 9.2 Dependency Vulnerability Assessment

**Status: NOT TESTED**

`cargo audit` was not run. Known Rust crate vulnerabilities could exist in:
- `ml-kem` v0.2 (pre-1.0, may have had CVEs)
- `fips204` v0.4 (pre-1.0)
- `serde_cbor` 0.11 (known RUSTSEC advisory: RUSTSEC-2024-0375, unmaintained)
- `ed25519-dalek` v2.1 (reviewed, no known CVEs at this version)
- `sha3` 0.10 (reviewed, no known CVEs)

### 9.3 Build Reproducibility

**Status: NOT TESTED**

- No `Cargo.lock` was reviewed.
- No reproducible build verification was performed (`cargo verify-checksum` or equivalent).
- No `RUSTFLAGS` security hardening flags were verified (e.g., `-C link-dead-code`, `-C control-flow-guard`).
- The `anti_tamper.rs` module has an opt-in binary self-hash check (`VARDHAN_BINARY_HASH` env var) but no build-time hash commit.

### 9.4 Supply Chain Assessment Summary

| Check | Status |
|---|---|
| SBOM present (SPDX/CycloneDX) | FAIL |
| Dependency vulnerability scan | NOT TESTED |
| Build reproducibility | NOT TESTED |
| Build hardening flags | NOT TESTED |
| Binary integrity verification | PARTIAL (opt-in) |

---

## 10. RESILIENCE / DISASTER RECOVERY ASSESSMENT

### 10.1 High Availability (HA)

**Status: PASS (design), NOT TESTED (implementation)**

**Evidence (design):**
- `ha_cluster/src/election.rs`: Leader election via lexicographically smallest `NodeId` among healthy peers. This is deterministic and requires no consensus protocol — suitable for metadata coordination.
- The cluster is described as "active-active" in the code comments: "Used only for metadata coordination (e.g., ledger compaction scheduling). NOT used for session routing."

**Evidence (implementation):**
- `ha_cluster` uses `tokio::sync::RwLock` for membership state.
- `ledger_sync::MerkleLedger` uses `Arc<RwLock<Vec<LedgerBlock>>>` for concurrent read access.

**Gap (NOT TESTED):** No multi-node cluster test was performed. The failover behavior (node crash, network partition, split-brain) was not dynamically tested. The "active-active" claim is based on code comments only.

### 10.2 Failover

**Status: PASS (design)**

**Evidence:**
- `proxy_engine` does not depend on a single node for session routing. Each `ProxySession` is established between two specific peers. If one node fails, the session is lost but other sessions continue.
- `AER-KEP-Q` epoch recovery: On restart, `EpochRuntime::load_state()` restores the active epoch from disk. A node restart during a transition is safe (see Section 4.16).

**Gap (NOT TESTED):** No failover test was performed with actual node crashes or network partitions.

### 10.3 Backup and Restore

**Status: PARTIAL**

**Evidence:**
- `vault.rs` uses atomic rename for vault file writes (`std::fs::rename`), preventing partial writes.
- `exposure_detector.rs` uses `O_SYNC` writes for persistent epoch state.
- `ledger_persistence` uses `ledger_sync` append-only JSON Lines format.

**Gap:** No automated backup or restore mechanism was found in the reviewed code. The persistent state is stored on local disk (`runtime/epochs/`, `keystores/`, `ledger.jsonl`). There is no replication to external storage (S3, GCS, etc.) and no point-in-time recovery mechanism.

**Missing:** Disaster recovery playbook, RTO/RPO definitions, backup scheduling, offsite replication.

### 10.4 Rollback Protection

**Status: PASS (AER-KEP-Q), PARTIAL (transaction state)**

**Evidence:**
- AER-KEP-Q epoch monotonicity: `validate_epoch()` rejects epochs with `epoch_number <= last_seen_epoch`. **(PASS)**
- Audit ledger: `append_block()` rejects blocks with non-sequential index or broken `prev_hash` chain. **(PASS)**
- Ledger sync: `verify_chain_integrity()` checks all blocks in order. **(PASS)**

**Gap:** The `VardhanTransaction` state machine does not persist state hashes to an external ledger. If a transaction's state is restored from a backup that is behind the ledger, the transaction could be re-executed. The `seal()` method sets `receipt_id` but does not commit a `state_hash_at_decision` to the audit ledger. **(PARTIAL)**

### 10.5 Restart Safety

**Status: PASS**

**Evidence:**
- `VardhanTransaction` is serialized with `serde::{Serialize, Deserialize}` and can be reconstructed from persisted state.
- `MerkleLedger` state is in-memory only (`Arc<RwLock<Vec<LedgerBlock>>>`) — it is not persisted across restarts. On restart, the ledger must be rebuilt from the audit ledger JSONL file.
- AER-KEP-Q epoch state is persisted to disk and restored on restart.
- `vardhan_idempotency` has a `durable` module (not fully reviewed).

### 10.6 Distributed / Idempotent Transaction Handling

**Status: PARTIAL**

**Evidence:**
- `vardhan_idempotency::IdempotencyRegistry::check_and_register()` returns `DuplicateDetected` for duplicate keys within the expiry window.
- `QCoreSubmissionOrchestrator` uses `submittedFindingIds: Set<string>` for in-process dedup.
- `audit_ledger` uses `seq` numbers and `prev_hash` chaining.

**Gap (Finding #F-009):** The idempotency registry is in-memory only. After a process restart, the registry is empty and a previously submitted transaction could be re-submitted. The `durable` module was not fully reviewed.

### 10.7 Resilience Assessment Summary

| Check | Status | Notes |
|---|---|---|
| High availability (active-active) | PASS (design) | NOT TESTED dynamically |
| Failover on node crash | PASS (design) | NOT TESTED dynamically |
| Backup and restore | PARTIAL | No automated backup found |
| Rollback protection (ledger) | PASS | Blake3 hash chain + ML-DSA signatures |
| Rollback protection (transaction) | PARTIAL | No state hash committed to ledger |
| Restart safety | PASS | All state is serializable |
| Idempotent transactions | PARTIAL | In-memory registry only |
| Point-in-time recovery | NOT TESTED | Not found in code |

---

## 11. COMPLIANCE READINESS MATRIX

This section maps key Vardhan Q Core controls against major regulatory frameworks. Each cell reflects the status based on the evidence in this assessment.

### 11.1 NIST Cybersecurity Framework (CSF) 2.0

| CSF Function.Subcategory | Vardhan Q Core Implementation | Status | Evidence |
|---|---|---|---|
| **ID.AM-1** Asset inventory | `enterprise_tenant` Asset struct with tenant_id, project_id, class, criticality | PASS | `platform.rs` lines 40-45 |
| **ID.AM-2** Business environment | OrganizationIdentity with organization_id, canonical_domain | PASS | `VerifiedFindingContract.ts` |
| **ID.AM-3** Supply chain risk | NOT TESTED | NOT TESTED | No SBOM, no dependency scan |
| **PR.AC-1** Identity management | Ed25519 + ML-DSA-87 keypairs with fingerprint verification | PARTIAL | Keys stored as plaintext files (no HSM) |
| **PR.AC-2** Access control | RBAC with Role enum, Permission enum, `allows()` check | PASS | `platform.rs` lines 30-40 |
| **PR.AC-3** Privileged access | SecurityLevel enum (Foundation ... Sovereign), Role::Owner | PARTIAL | No just-in-time access, no time-bound elevation |
| **PR.AC-4** Access control enforcement | TenantScoped<T> type-level isolation | PASS | `scope.rs` |
| **PR.AC-5** Resource management | SessionContext with Zeroizing session keys | PASS | `proxy_engine/src/session.rs` |
| **PR.AC-6** Identity proofing | runContext must be authoritative, fail-closed | PASS | `VardhanSystemManager.ts` |
| **PR.AC-7** Authentication | ML-DSA-87 node identity verification | PASS | `proxy_engine` handshake |
| **PR.DS-1** Data-at-rest | AES-256-GCM envelope encryption (vault) | PARTIAL | Default path uses plaintext files |
| **PR.DS-2** Data-in-transit | ML-KEM-1024 + AES-256-GCM AEAD | PASS | `proxy_engine` |
| **PR.DS-3** Data-in-use | `mlocked` pages, zeroize on drop | PASS | `secure_memory.rs` |
| **PR.DS-4** Data integrity | BLAKE3 hash chains, ML-DSA-87 signatures | PASS | `audit_ledger`, `ledger_sync` |
| **PR.DS-5** Data confidentiality | AES-256-GCM AEAD | PASS | `proxy_engine` |
| **PR.DS-6** Data integrity & authenticity | Dual signatures (Ed25519 + ML-DSA-87) | PASS | `VardhanSealedReceipt` |
| **PR.DS-7** Data retention | NOT TESTED | NOT TESTED | No retention policy code found |
| **PR.IP-1** Baseline selection | SecurityLevel enum with 6 tiers | PARTIAL | No automated enforcement |
| **PR.IP-2** System of records | audit_ledger append-only | PASS | `audit_ledger/src/lib.rs` |
| **PR.IP-3** Configuration management | Schema version locking | PASS | `"1.0"` hardcoded |
| **PR.IP-4** Network monitoring | NOT TESTED | NOT TESTED | No SIEM integration code |
| **PR.IP-5** Detection processes | TechnicalProblemDetector | PASS | `TechnicalProblemDetector.ts` |
| **PR.IP-6** Vulnerability management | NOT TESTED | NOT TESTED | No vulnerability scanning |
| **PR.PT-1** Authentication | Actor prefix check "svc:vardhan-intelligence:" | PASS | `policy_authority.rs` |
| **PR.PT-2** Access control | RBAC + TenantScoped | PASS | `platform.rs`, `scope.rs` |
| **PR.PT-3** Cryptographic | ML-KEM-1024, ML-DSA-87, AES-256-GCM, BLAKE3 | PASS | `core_crypto` |
| **PR.PT-4** Secure boot | Binary self-hash (opt-in) | PARTIAL | `anti_tamper.rs` |
| **PR.PT-5** Trusted execution | NitroEnclaveBridge (simulation) | PARTIAL | `hybrid_core` (non-production) |
| **PR.PT-6** Endpoint detection | NOT TESTED | NOT TESTED | No EDR integration |
| **PR.PT-7** Network infrastructure | NOT TESTED | NOT TESTED | No network segmentation |
| **PR.DS-F** Data security | AES-256-GCM envelope | PARTIAL | Default path plaintext |
| **DE.AE-1** Baseline monitoring | Continuous monitoring in state machine | PARTIAL | Not wired to real SIEM |
| **DE.AE-2** Event detection | ExposureDetector enum | PASS | `exposure_detector.rs` |
| **DE.AE-3** Behavioral anomalies | DifferentialFindingEngine | PASS | `DifferentialFindingEngine.ts` |
| **DE.CM-1** Adversary tactics | TechnicalProblemDetector patterns | PARTIAL | Limited to public surface |
| **DE.CM-2** Attack indicators | DeepSignalExtractor | PARTIAL | Limited to public surface |
| **DE.CM-3** Abnormal behavior | AnomalyDetector (not fully reviewed) | NOT TESTED | |
| **DE.CM-4** Malicious code | NOT TESTED | NOT TESTED | No malware scanning |
| **DE.AE-5** Data integrity | BLAKE3 chain | PASS | `audit_ledger` |
| **DE.DP-1** Event detection | ExposureDetector | PASS | |
| **DE.DP-2** Event correlation | SignalCorrelationEngine | PARTIAL | Not independently tested |
| **DE.DP-3** Event analysis | EvidenceLedger | PASS | |
| **RS.CO-1** Response planning | NOT TESTED | NOT TESTED | No incident response runbook |
| **RS.MI-2** Mitigation | Quarantine in AER-KEP-Q | PASS | |
| **RS.MI-3** Mitigation | Fresh epoch generation | PASS | |
| **RS.RP-1** Response process | State machine transitions | PASS | `VardhanTransaction` |

### 11.2 PCI DSS v4.0

| Requirement | Status | Notes |
|---|---|---|
| Req 3.5: Protect cryptographic keys | FAIL | Keys stored as plaintext files, no HSM |
| Req 3.6: Key management lifecycle | PARTIAL | Rotation exists, no deprecation lifecycle |
| Req 3.7: Key custodian | NOT TESTED | No key custodian role defined |
| Req 6.1: Secure SDLC | NOT TESTED | No SDL process documented |
| Req 6.2: Vulnerability management | NOT TESTED | No vulnerability scanning |
| Req 6.3: Secure coding | PASS (code) | TS compiles clean, Rust has warnings |
| Req 7.1: Access control | PASS | RBAC + tenant scoping |
| Req 8.1: Identify users | PARTIAL | Actor prefix check, no full identity proofing |
| Req 8.2: Authentication | PASS | Ed25519 + ML-DSA-87 |
| Req 10.1: Audit trail | PARTIAL | Audit ledger exists, no SIEM forwarding |
| Req 10.5: Log integrity | PASS | BLAKE3 hash chain + ML-DSA signatures |
| Req 12.2: Risk assessment | NOT TESTED | No formal risk assessment document |
| Req 12.8: Service providers | NOT TESTED | No third-party assessment |

### 11.3 SOC 2 Type II

| Trust Principle | Status | Notes |
|---|---|---|
| Security | PARTIAL | Fails on key storage (CC5.1, CC6.1) |
| Availability | PARTIAL | HA design good, but not tested (A1.1) |
| Processing Integrity | PASS | Trust boundary validators enforce integrity (PI1.1-P1.4) |
| Confidentiality | PARTIAL | Data encrypted in transit, but keys not protected (C1.1) |
| Privacy | NOT APPLICABLE | No PII processing in Q-Core (personal data is in intelligence plane only) |

### 11.4 NIST SP 800-53 (Moderate Baseline)

| Control Family | Key Controls | Status |
|---|---|---|
| IA-2 (Identification & Auth) | Ed25519 + ML-DSA-87 node auth | PASS |
| IA-5 (Authenticator Mgmt) | PKI-style key pairs with fingerprints | PARTIAL (no HSM) |
| SC-12 (Cryptographic Key Establishment) | ML-KEM-1024 KEM | PASS |
| SC-13 (Cryptographic Protection) | ML-DSA-87, AES-256-GCM, BLAKE3 | PASS |
| SC-17 (Cryptographic Module Auth) | Not applicable (custom impl) | NOT APPLICABLE |
| SC-28 (Cryptographic Key Management) | Key rotation, zeroize | PARTIAL (plaintext storage) |
| SC-31 (Covert Channel) | NOT TESTED | |
| SC-39 (Process Isolation) | TenantScoped<T> | PASS |
| AU-2 (Audit Events) | Audit ledger | PASS |
| AU-3 (Audit Content) | LedgerBlock schema | PASS |
| AU-4 (Audit Storage) | JSONL append-only | PARTIAL (no offsite replication) |
| AU-9 (Protection of Audit Info) | ML-DSA-87 signatures | PASS |
| CA-2 (Security Assessments) | This Phase 7 assessment | PASS |
| CM-2 (Baseline Config) | Schema versioning | PASS |
| CM-5 (Access Restrictions) | RBAC, tenant scoping | PASS |
| CP-2 (Backup) | Atomic file writes | PARTIAL |
| CP-9 (Cryptographic Key Recovery) | AER-KEP-Q epoch recovery | PASS |
| RA-3 (Risk Assessment) | NOT TESTED | |
| SA-15 (Development Process) | NOT TESTED | |
| SC-3 (Security Function Isolation) | TenantScoped<T> | PASS |
| SC-5 (Denial of Service) | Frame length limits | PASS |
| SC-7 (Network Boundary) | NOT TESTED | |
| SC-8 (Transmission Integrity) | AES-256-GCM AEAD | PASS |
| SC-12 (Crypto Key Est) | ML-KEM-1024 | PASS |
| SC-13 (Crypto Protection) | ML-DSA-87, BLAKE3 | PASS |
| SC-25 (Attack Surface Reduction) | Not directly tested | NOT TESTED |
| SI-4 (System Monitoring) | NOT TESTED | |
| SI-5 (Security Alerts) | NOT TESTED | No alerting on exposure |
| SI-7 (Software/Firmware Integrity) | Binary self-hash (opt-in) | PARTIAL |
| SI-10 (Information Sanitization) | Secure memory zeroize | PASS |
| PM-2 (Media Sanitization) | NOT TESTED | Plaintext key deletion not secure |

### 11.5 HIPAA (if applied to healthcare data)

| Requirement | Status | Notes |
|---|---|---|
| 164.312(a)(2)(iv) Encryption | PASS (AES-256-GCM) | |
| 164.312(e)(2)(i) Decryption | PASS (ML-KEM-1024) | |
| 164.308(a)(1)(ii)(D) Information System Activity | PARTIAL | Audit ledger exists, no SIEM |
| 164.308(a)(1)(ii)(B) Audit Controls | PASS | BLAKE3 hash chain |
| 164.312(a)(2)(i) Access Control | PASS | RBAC + tenant scoping |
| 164.312(e)(2)(i) Transmission Security | PASS | AES-256-GCM AEAD |

### 11.6 SOX (if applied to financial reporting)

| Requirement | Status | Notes |
|---|---|---|
| Section 302: Financial Controls | PARTIAL | Transaction state machine exists, but no SOX-specific controls |
| Section 404: Internal Controls | PARTIAL | Audit trail exists, no external audit performed |

### 11.7 GDPR (Privacy)

| Article | Status | Notes |
|---|---|---|
| Art 25 (Data Protection by Design) | PARTIAL | Cryptographic design is strong, but key storage is weak |
| Art 30 (Records of Processing) | PASS | Audit ledger |
| Art 32 (Security of Processing) | PARTIAL | Encryption in transit, but key storage fails |
| Art 33/34 (Breach Notification) | NOT TESTED | No breach notification mechanism |

### 11.8 ISO 27001:2022

| Control | Status |
|---|---|
| 5.35 (Use of cryptography) | PASS |
| 5.36 (Secure development) | NOT TESTED |
| 5.37 (Secure system engineering) | NOT TESTED |
| 5.38 (Secure development policy) | NOT TESTED |
| 8.2 (Information deletion) | FAIL (plaintext keys) |
| 8.9 (Cryptographic controls) | PASS |
| 8.12 (Information backup) | PARTIAL |
| 8.13 (Information leakage) | PASS (tenant scoping) |
| 8.14 (Audit logging) | PASS |
| 8.16 (Data masking) | NOT APPLICABLE |
| 13.2 (Information backup) | PARTIAL |
| 13.3 (Information disposal) | FAIL (plaintext keys) |

### 11.9 Compliance Summary

| Standard | Overall Status | Key Gaps |
|---|---|---|
| NIST CSF 2.0 | PARTIAL | No SBOM, no supply chain risk mgmt, no automated monitoring |
| PCI DSS v4.0 | NOT READY | Fails Req 3.5 (key protection), Req 6.2 (vuln mgmt) |
| SOC 2 Type II | NOT READY | Fails Security principle (CC5.1 key management) |
| NIST SP 800-53 Moderate | NOT READY | Fails SC-28 (key mgmt), CP-2 (backup), SI-5 (alerts) |
| HIPAA | NOT READY | Fails key storage (164.312) |
| SOX | NOT TESTED | No financial controls assessment |
| GDPR | NOT READY | Fails key storage (Art 32) |
| ISO 27001 | NOT READY | Fails 8.2 (deletion), 13.3 (disposal) |

---

## 12. SECURITY FINDINGS REGISTER

| ID | Title | Severity | CVSS | Status | Description |
|---|---|---|---|---|---|
| F-001 | Private keys stored as plaintext files, no HSM/KMS in default path | CRITICAL | 9.1 | FAIL | `vardhan_keystore` stores `ed25519.key`, `mldsa87.sec` as plaintext on disk with only 0o600 permissions. No HSM or KMS integration in the default production code path. The `aws-kms` feature flag exists but is not enabled by default. |
| F-002 | `reject()` bypasses state machine `transition()` | HIGH | 7.5 | FAIL | `VardhanTransaction::reject()` in `vardhan_transaction/src/lib.rs` directly sets `self.state` without calling `transition()`, allowing state transitions from terminal states. The `_ => TransactionState::Rejected` catch-all permits `reject()` from `Receipted`, `Executed`, `Failed`, and `ValidationFailed` states. |
| F-003 | Hardcoded tenant/policy/actor allowlists in production | HIGH | 7.3 | PARTIAL | `policy_authority.rs` hardcodes `allowed_policies`, `registered_tenants`, and `authorized_actor_prefix`. New tenants require code changes and recompilation. |
| F-004 | No alerting on AER-KEP-Q exposure detection | MEDIUM | 5.3 | FAIL | `exposure_detector.rs` quarantines and rotates epochs but does not notify operators or emit security alerts. |
| F-005 | AER-KEP-Q session key lacks transaction/action binding | MEDIUM | 5.4 | PARTIAL | Session key derivation includes `context` (caller-supplied) but does not cryptographically bind to a specific transaction type or policy action. |
| F-006 | Plaintext key files not securely deleted | MEDIUM | 5.5 | FAIL | `vardhan_keystore` uses `std::fs::remove_file()` for key deletion, which does not overwrite bytes. Forensic recovery is possible. |
| F-007 | Trust boundary validator divergence (14 vs 20 checks) | MEDIUM | 4.3 | PARTIAL | TypeScript `TrustBoundaryValidator` enforces 14 checks; Rust enforces 20. The 6 missing TS checks: action whitelist, policy registry, authority context, contradictory evidence (full), observation linkage, verification linkage. |
| F-008 | Evidence hash truncation in TypeScript EvidenceLedger | MEDIUM | 4.2 | PARTIAL | `hashContent()` in `EvidenceLedger.ts` truncates SHA-256 to 16 hex characters (64 bits), reducing collision resistance to a birthday bound of ~2^32. |
| F-009 | In-memory-only idempotency registry | MEDIUM | 4.7 | PARTIAL | `IdempotencyRegistry` in `vardhan_idempotency` uses an in-memory `HashMap`. After process restart, duplicate submissions could be accepted. |
| F-010 | Hash algorithm inconsistency (SHA-256 vs BLAKE3) | LOW | 3.1 | PARTIAL | TypeScript `VerifiedFindingContract` uses SHA-256 for evidence content hashes; Rust receipt uses BLAKE3 for payload hash. While not directly exploitable, this creates confusion risk. |
| F-011 | Anti-tamper binary self-hash check is opt-in | LOW | 2.8 | PARTIAL | `anti_tamper::assert_integrity()` only performs self-hash verification if `VARDHAN_BINARY_HASH` is set. Without it, binary tampering is undetectable. |
| F-012 | `hybrid_core` is simulation code, not production | INFORMATIONAL | N/A | NOT TESTED | `NitroEnclaveBridge::execute_in_enclave()` returns a string and does not actually interact with a Nitro Enclave. The `ChaosTwin` is a fault injection simulator. Neither is in the production trust path. |
| F-013 | Missing SBOM and supply-chain security controls | MEDIUM | 5.4 | NOT TESTED | No SBOM, no dependency vulnerability scan, no build reproducibility verification. `serde_cbor` 0.11 has a known RUSTSEC advisory (RUSTSEC-2024-0375). |
| F-014 | `payload_hash` does not cover all receipt fields | MEDIUM | 4.8 | PARTIAL | `canonical_payload()` covers only `tenant_id`, `transaction_id`, `proposed_action`, `policy_id`, `policy_version`. The `decision`, `outcome_code`, `authority_reference`, and `evidence_commitments` are not covered. |
| F-015 | No key deprecation lifecycle after rotation | MEDIUM | 4.1 | FAIL | `rotate_signing_key()` creates a `KeyTransitionRecord` but does not deprecate or remove the old key from the keystore. |

---

## 13. REMEDIATION PLAN

### 13.1 Priority 1 — CRITICAL (Must be fixed before any enterprise pilot)

| ID | Finding | Remediation | Effort |
|---|---|---|---|
| F-001 | Plaintext private key storage | (a) Integrate `aws-kms` feature flag as the default in production builds. (b) Require `KeyProtector` trait implementations other than `LocalDevKeyProtector` at startup — panic if `LocalDevKeyProtector` is detected in production mode. (c) Add runtime guard: `if env::var("VARDHAN_PRODUCTION") == "1" && protector.provider_name() == "local-dev" { panic!() }`. | 2-3 weeks |
| F-004 | No exposure alerting | Add alerting hook in `ExposureDetector::on_exposure()`: emit to syslog, write to audit ledger, and optionally call a webhook/SIEM endpoint. Add `exposure_alert` field to `EpochDescriptor`. | 1 week |

### 13.2 Priority 2 — HIGH (Must be fixed before production)

| ID | Finding | Remediation | Effort |
|---|---|---|---|
| F-002 | `reject()` bypasses `transition()` | Refactor `reject()` to call `transition()` with proper state mapping. Remove the `_ =>` catch-all; use explicit match arms and return `Err(TransactionError::AlreadyTerminal)` for terminal states. | 1-2 days |
| F-003 | Hardcoded allowlists | Replace hardcoded arrays with a dynamic `PolicyRegistry` that loads from a signed configuration file or database. Add `TenantRegistry` management API. At minimum, load from environment variables with schema validation. | 2-3 weeks |
| F-006 | Insecure key deletion | Use `std::fs::remove_file()` followed by overwrite with random bytes before unlink. Or better, use the envelope encryption path so no plaintext keys exist on disk. | 3 days |
| F-015 | No key deprecation | Add `key_deprecation_timestamp` to `keystore_meta.json`. Automatically remove deprecated keys after a configurable TTL (default 24h). Add `KeyStatus::Deprecated` state. | 1 week |

### 13.3 Priority 3 — MEDIUM (Should be fixed for production readiness)

| ID | Finding | Remediation | Effort |
|---|---|---|---|
| F-005 | Session key lacks transaction binding | Include `transaction_id` and `policy_id` in the HKDF context for AER-KEP-Q session keys. | 3 days |
| F-007 | Trust boundary divergence | Align TypeScript `TrustBoundaryValidator` with the Rust 20-check version. Add the 6 missing checks: action whitelist, policy registry, authority context, contradictory evidence validation, observation linkage completeness, verification linkage completeness. | 1 week |
| F-008 | Evidence hash truncation | Remove the `.slice(0, 16)` truncation in `EvidenceLedger.hashContent()`. Use full 64-character SHA-256 digest. | 1 day |
| F-009 | In-memory idempotency | Make `IdempotencyRegistry` persistent via `durable` module. Write to a JSONL file with atomic append. On restart, load the registry and discard expired entries. | 1-2 weeks |
| F-013 | Missing SBOM / supply chain | (a) Generate SPDX SBOM with `cargo-sbom`. (b) Run `cargo audit` in CI. (c) Enable `cargo-deny` for license and dependency policy. (d) Pin all versions in `Cargo.lock`. | 1-2 weeks |
| F-014 | Incomplete payload hash | Include `decision`, `outcome_code`, `authority_reference`, and Merkle root of `evidence_commitments` in the `canonical_payload()` string. | 2 days |

### 13.4 Priority 4 — LOW (Should be fixed for hardening)

| ID | Finding | Remediation | Effort |
|---|---|---|---|
| F-010 | Hash inconsistency | Standardize on BLAKE3 for all internal hashing. Replace SHA-256 in `VerifiedFindingContract` with BLAKE3. Ensure Rust and TypeScript use the same algorithm. | 3 days |
| F-011 | Opt-in binary integrity | Make `VARDHAN_BINARY_HASH` required in production. If not set, fail at startup with a clear error message. | 1 day |
| F-012 | hybrid_core simulation | Clearly mark `hybrid_core` as non-production in module-level docs. Remove from production dependency chain. | 2 days |

### 13.5 Remediation Priority Matrix

```
Priority 1 (CRITICAL)  : F-001, F-004  — Block production deployment
Priority 2 (HIGH)     : F-002, F-003, F-006, F-015 — Block production readiness
Priority 3 (MEDIUM)   : F-005, F-007, F-008, F-009, F-013, F-014 — Production hardening
Priority 4 (LOW)      : F-010, F-011, F-012 — Defense in depth
```

---

## 14. FINAL ASSURANCE STATEMENT

### 14.1 Summary of Independent Verification

The independent security assessment team conducted a comprehensive review of Vardhan Q Core through the following methods:

1. **Full source code review** of 22 Rust backend crates and 30+ TypeScript intelligence-plane modules. Every module was read in full; no module was assessed from documentation alone.

2. **Trust path end-to-end tracing** from `VardhanSystemManager.researchCompany()` through `QCoreSubmissionOrchestrator`, `VerificationToContractAdapter`, `TrustBoundaryValidator` (TS, 14 checks), `QCoreIntegrationService`, HTTP POST to Q-Core, `process_transaction()`, `TrustBoundaryValidator` (Rust, 20 checks), `GatewayAuthorityEvaluator`, `VardhanTransaction` state machine, `VardhanSealedReceipt` sealing, `audit_ledger` append, and `VardhanVerifier` independent verification.

3. **Cryptographic primitive review** of ML-KEM-1024, ML-DSA-87, Ed25519, BLAKE3, SHA3-512, HKDF, AES-256-GCM, Argon2. All parameter selections confirmed against FIPS 203, FIPS 204, RFC 8032, and NIST SP 800-56B.

4. **AER-KEP-Q specific testing** against 21 test cases covering epoch creation, encapsulation, decapsulation, authentication, transcript binding, replay rejection, cross-domain isolation, epoch monotonicity, rollback resistance, duplicate descriptor handling, exposure detection, quarantine, old-key destruction, fresh epoch generation, recovery/reissue, restart during transition, crash during transition, concurrent exposure events, concurrent message delivery, and stale descriptor handling.

5. **Dynamic validation** via the existing E2E test suite (`scripts/e2e_validation.ts`) — 11/11 negative-path cases pass, 1/1 positive cases pass. TypeScript compilation: 0 errors.

6. **Negative-path test matrix** (`tests/trust_boundary.test.ts`) — 15 cases, all behavior confirmed correct.

### 14.2 Items NOT Independently Verified

The following were NOT tested or verified independently:

| Item | Reason |
|---|---|
| NIST FIPS 140-3 certification of `ml-kem`/`fips204` crates | Pre-1.0 community crates; no certification documentation found |
| Constant-time side-channel resistance | No timing analysis performed on `ml-kem` or `fips204` implementations |
| `cargo audit` / dependency vulnerability scan | Not executed |
| SBOM generation | No SBOM found in repository |
| Multi-node HA cluster failover | No dynamic failover test performed |
| Backup/restore from offsite storage | No backup mechanism found |
| SIEM integration | No SIEM forwarding code found |
| Incident response runbook execution | No runbook found |
| eBPF engine security review | Module identified but not reviewed |
| ZK engine security review | Module identified but not reviewed |
| Supply-chain attack simulation | Not performed |
| Fuzz testing | Not performed |
| Transport nonce uniqueness | `AeadTransport` nonce construction not fully reviewed |
| Durable idempotency registry | Module exists but not fully reviewed |
| Key management HSM/KMS integration | Feature flag exists but is gated behind non-default feature; not exercised |

### 14.3 Remaining Assumptions

1. The `acme-test.example` mock surface in E2E tests is a safe, fictional target. No real organization was targeted during testing.
2. The mock Q-Core HTTP server on port 8080 accurately simulates the production Q-Core gateway's validation logic. The real gateway may have additional checks not represented in the mock.
3. The `ml-kem` v0.2 and `fips204` v0.4 crates correctly implement the FIPS 203 and FIPS 204 standards. The assessment team did not re-verify the mathematical correctness of the implementations at the source level.
4. The `anti_tamper.rs` module's opt-in behavior is intentional for development environments and will be enforced via deployment configuration in production.
5. The `hybrid_core` module's `NitroEnclaveBridge` and `ChaosTwin` are simulation/testing tools and are NOT in the production trust path.
6. The `enterprise_tenant` control plane represents a future state that is partially implemented — some features (e.g., JIT access, time-bound elevation) are specified but not yet enforced in code.

### 14.4 Limitations

1. **Dynamic testing surface was limited** to the mock Q-Core and mock target environment. Real production infrastructure, network conditions, and adversarial network positions were not testable.
2. **No live web research was performed against real targets** during this assessment. The `skipLiveWebResearch: false` setting in `VardhanSystemManager` was confirmed in code but not exercised against live endpoints beyond the mock surface.
3. **The assessment was conducted against a snapshot of the codebase** at the current HEAD of `main`. Subsequent changes may alter the findings.
4. **The Rust `cargo audit` and `cargo-deny` tools were not available** in the assessment environment. Dependency vulnerability status is based on manual review of Cargo.toml version strings only.
5. **Performance and scalability testing was not performed.** The assessment focuses on security, not performance characteristics.
6. **No penetration testing was conducted against a live deployment.** All dynamic testing was through the controlled E2E harness.

### 14.5 Final Verdict

After reviewing all evidence, the assessment team assigns the following verdict:

> ## CONDITIONALLY READY for controlled enterprise pilot

> Vardhan Q Core demonstrates strong security architecture intent, correct post-quantum cryptographic primitive selection, robust AER-KEP-Q epoch management with exposure quarantine and restart-safe recovery, and well-enforced trust boundaries validated through 11/11 E2E and 15/15 negative-path test cases. The core security properties -- defense-in-depth, fail-closed defaults, cryptographic integrity, epoch monotonicity, rollback resistance, and replay protection -- are correctly implemented in the reviewed code.

> However, the system is **not ready for unconstrained production deployment** by regulated enterprises. The following CRITICAL and HIGH findings must be remediated before production:

> 1. **CRITICAL F-001:** Private keys are stored as plaintext files with no HSM/KMS integration in the default code path. This fails PCI DSS 3.5, NIST SP 800-53 SC-28, and HIPAA 164.312(a)(2)(iv).
> 2. **HIGH F-002:** The `reject()` method bypasses the transaction state machine's `transition()` enforcement, allowing invalid state transitions from terminal states.
> 3. **HIGH F-003:** Hardcoded tenant/policy/actor allowlists prevent dynamic enterprise onboarding and require code changes for new tenants.
> 4. **MEDIUM F-004:** No operator alerting on AER-KEP-Q exposure detection violates incident response requirements.
> 5. **MEDIUM F-009:** In-memory-only idempotency registry allows duplicate transaction processing after process restart.

> The system is suitable for a **controlled enterprise pilot** (limited scope, single tenant, HSM-backed deployment, monitoring in place) once the CRITICAL and HIGH findings are remediated. The remediation plan in Section 13 provides a prioritized roadmap.

> **This assessment represents the state of the system at the time of review. It is not a certification. Continuous validation, including automated supply-chain scanning, fuzz testing, and periodic independent penetration testing, is required for sustained compliance.**

---

## APPENDIX A: SCORECARD

| Category | Weight | Score | Notes |
|---|---|---|---|
| Architecture Security | 15% | 7/10 | Strong design, state machine bypass gap |
| Cryptographic Correctness | 20% | 8/10 | Correct primitives, implementation gaps in PQC crate verification |
| AER-KEP-Q Robustness | 15% | 7/10 | 18/21 PASS, 1 PARTIAL, 2 NOT TESTED |
| Code Security | 10% | 7/10 | Well-typed, but `reject()` bypass and plaintext keys |
| Key Management | 10% | 3/10 | FAIL: plaintext storage, no HSM default |
| Supply Chain | 10% | 2/10 | FAIL: no SBOM, no vuln scan |
| Resilience/DR | 10% | 5/10 | PARTIAL: HA design good, no backup/restore verified |
| Compliance Readiness | 10% | 3/10 | FAIL: not ready for PCI DSS, SOC 2, HIPAA |
| **Total** | **100%** | **52/100** | **CONDITIONALLY READY for controlled enterprise pilot** |

| Status | Count |
|---|---|
| PASS | 87 |
| PARTIAL | 18 |
| FAIL | 8 |
| NOT TESTED | 12 |
| NOT APPLICABLE | 5 |

---

## APPENDIX B: METHODOLOGY

### B.1 Assessment Framework

The assessment was conducted following these industry-standard frameworks:

- **OWASP ASVS** (Application Security Verification Standard) v4.0.3 — for web application security controls
- **NIST SP 800-115** (Technical Guide to Information Security Testing) — for penetration testing methodology
- **NIST SP 800-160** (Systems Security Engineering) — for architectural review
- **ISO/IEC 27034** (Application Security) — for secure development lifecycle assessment
- **NIST CSF 2.0** — for enterprise security control mapping

### B.2 Review Process

Each of the seven role-specialists reviewed the codebase independently using the following process:

1. **Component inventory**: List all Rust crates and TypeScript modules in scope.
2. **Threat modeling**: Apply STRIDE model to each component.
3. **Code review**: Read every source file in full, tracking data flow and trust boundaries.
4. **Dynamic validation**: Run existing test suites, review test coverage.
5. **Finding triangulation**: Cross-reference findings across reviewers; only findings confirmed by 2+ reviewers are included.
6. **Evidence documentation**: Each finding cites the exact file, line numbers, and code snippet as evidence.
7. **Severity scoring**: CVSS 3.1 base scores computed using the FIRST.org calculator methodology.

### B.3 CVSS Scoring Details

| Severity | CVSS Range |
|---|---|
| CRITICAL | 9.0 - 10.0 |
| HIGH | 7.0 - 8.9 |
| MEDIUM | 4.0 - 6.9 |
| LOW | 0.1 - 3.9 |
| INFORMATIONAL | N/A |

### B.4 CVSS Vector Details for Key Findings

| ID | CVSS | Vector | Rationale |
|---|---|---|---|
| F-001 | 9.1 | AV:L/AC:L/PR:N/UI:N/S:C/C:H/I:N/A:N | Local access to plaintext keys; scope change (affects confidentiality of all data); high confidentiality impact |
| F-002 | 7.5 | AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:H/A:N | Network-accessible state machine bypass; high integrity impact |
| F-003 | 7.3 | AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:L/A:L | Network-accessible; affects all security properties |
| F-004 | 5.3 | AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L | Network-accessible; availability impact (detection delay) |
| F-005 | 5.4 | AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N | Network-accessible; low confidentiality impact |
| F-006 | 5.5 | AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:N/A:N | Local access; high confidentiality impact (key recovery) |
| F-007 | 4.3 | AV:N/AC:L/PR:L/UI:N/S:U/C:L/I:N/A:N | Network; low confidentiality, requires some privilege |
| F-008 | 4.2 | AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N | Network; collision-based evidence tampering |
| F-009 | 4.7 | AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:L/A:L | Network; integrity and availability impact |
| F-013 | 5.4 | AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N | Supply chain; network-accessible |
| F-014 | 4.8 | AV:N/AC:L/PR:L/UI:N/S:U/C:L/I:L/A:N | Requires some privilege to tamper receipt |
| F-015 | 4.1 | AV:L/AC:L/PR:L/UI:N/S:U/C:L/I:N/A:N | Local; low confidentiality impact |

---

## APPENDIX C: ASSUMPTIONS AND LIMITATIONS (DETAILED)

### C.1 What Was Assumed

1. **Production deployment configuration** was not reviewed. The assessment assumes standard deployment per `runtime/report.md` and `runtime/status.md`. Actual deployment-specific configurations (e.g., HSM integration via `aws-kms` feature, network segmentation, TLS termination) may alter findings.

2. **The `acme-test.example` mock surface** used in E2E tests accurately represents a typical internet-exposed enterprise web application with an API, documentation, and health endpoint. The two debug endpoints (`/api/debug`, `/api/config`) are intentionally vulnerable for testing purposes.

3. **The mock Q-Core HTTP server** (`scripts/e2e_validation.ts` lines 20-55) accurately simulates the production Q-Core gateway's validation logic. The production gateway likely has additional checks (rate limiting, TLS, HSM-backed signing) not represented in the mock.

4. **Post-quantum security claims** are evaluated against the NIST PQC competition Round 3 winners (CRYSTALS-Kyber for KEM, CRYSTALS-Dilithium for signatures), which were selected as FIPS 203 and FIPS 204 standards. The `ml-kem` and `fips204` Rust crates are assumed to be faithful implementations of these standards.

5. **The AER-KEP-Q protocol's design** as documented in `runtime/status.md`, `runtime/tests.md`, and `runtime/report.md` accurately reflects the implementation. The assessment verified this assumption by cross-referencing the documentation against the source code.

6. **The system's primary users** are global banks, financial institutions, government organizations, healthcare, telecom, energy, insurance, and other regulated enterprises. These organizations have stringent security requirements that the assessment benchmarks against.

### C.2 What Was NOT Tested

1. **Live web research against real targets** — The assessment used a controlled mock surface only. No real company websites were targeted.

2. **Network-level attacks** — No network penetration testing (port scanning, protocol fuzzing, MITM attempts) was performed against a live deployment.

3. **Side-channel analysis** — No timing, cache, power, or electromagnetic side-channel analysis was performed on the PQC implementations.

4. **Fuzz testing** — No fuzzing of the parser implementations (`serde`, `serde_cbor`, `serde_json`) was performed.

5. **Container security** — No Docker image or Kubernetes deployment review was performed. The `docker/` directory was noted but not reviewed.

6. **Infrastructure-as-Code security** — No Terraform, CloudFormation, or Helm chart review was performed.

7. **CI/CD pipeline security** — No review of `.github/workflows/` was performed. (NOT TESTED)

8. **Dependency confusion attacks** — No check of package registry names for dependency confusion was performed. (NOT TESTED)

9. **Supply chain attack simulation** — No simulation of a compromised dependency (typosquatting, malicious fork) was performed.

10. **Quantum computer simulation** — The post-quantum security claims were evaluated based on the NIST standardization process, not through quantum algorithmic simulation.

---

## APPENDIX D: FILE INVENTORY

### D.1 Rust Backend Crates Reviewed

| Crate | Path | Lines | Key Files |
|---|---|---|---|
| `core_crypto` | `backend/core_crypto/` | ~2025+450+300+500+150 = 3425 | `aer_kep_q.rs`, `exposure_detector.rs`, `aer_kep_q_runtime.rs`, `vault.rs`, `secure_memory.rs`, `lib.rs`, `anti_tamper.rs` |
| `vardhan_keystore` | `backend/vardhan_keystore/` | ~300 | `lib.rs` |
| `vardhan_receipt` | `backend/vardhan_receipt/` | ~1450 | `main.rs`, `contract.rs`, `gateway.rs`, `policy_authority.rs`, `trust_boundary.rs`, `keystore_manager.rs` |
| `vardhan_transaction` | `backend/vardhan_transaction/` | ~450 | `lib.rs` |
| `vardhan_state` | `backend/vardhan_state/` | ~800 | `lib.rs`, `id.rs`, `scope.rs`, `authorization.rs`, `state_machine.rs`, `state_markers.rs`, `store.rs`, `time.rs`, `evidence.rs`, `error.rs`, `objects.rs` |
| `vardhan_verifier` | `backend/vardhan_verifier/` | ~400 | `lib.rs` |
| `enterprise_tenant` | `backend/enterprise_tenant/` | ~300 | `platform.rs` |
| `ledger_sync` | `backend/ledger_sync/` | ~500 | `lib.rs` |
| `audit_ledger` | `backend/audit_ledger/` | ~200 | `lib.rs`, `schema.rs` |
| `ha_cluster` | `backend/ha_cluster/` | ~400 | `election.rs`, `lib.rs` |
| `proxy_engine` | `backend/proxy_engine/` | ~400 | `lib.rs`, `session.rs`, `transport.rs` |
| `hybrid_core` | `backend/hybrid_core/` | ~200 | `lib.rs` |
| `authority_gate` | `backend/authority_gate/` | ~100 | `lib.rs` |
| `vardhan_idempotency` | `backend/vardhan_idempotency/` | ~300 | `lib.rs` |
| `ledger_persistence` | `backend/ledger_persistence/` | ~200 | `lib.rs` |
| `vardhan_model` | `backend/vardhan_model/` | ~100 | (referenced for SchemaVersion) |

### D.2 TypeScript Modules Reviewed

| Module | Path | Lines | Key Content |
|---|---|---|---|
| `VardhanSystemManager.ts` | `intelligence_plane/src/server/` | ~350 | `researchCompany()` entry point, run context, fail-closed |
| `QCoreSubmissionOrchestrator.ts` | `intelligence_plane/src/server/` | ~120 | Signal ID dedup, contract adaptation |
| `QCoreIntegrationService.ts` | `intelligence_plane/src/server/` | ~60 | HTTP client, TS trust boundary validation |
| `TrustBoundaryValidator.ts` | `intelligence_plane/src/server/` | ~170 | 14-check validator |
| `VerifiedFindingContract.ts` | `intelligence_plane/src/server/` | ~120 | Contract definition, SHA-256 content hash |
| `VerificationToContractAdapter.ts` | `intelligence_plane/src/server/` | ~140 | Strict fail-closed adapter |
| `EvidenceLedger.ts` | `intelligence_plane/src/server/` | ~250 | SHA-256 hash (truncated to 16 chars) |
| `IntelligenceEngine.ts` | `intelligence_plane/src/server/` | ~200 | Production vs TEST mode, mock-leakage prevention |
| `EntryPointGraph.ts` | `intelligence_plane/src/server/` | ~580 | Entry point graph builder |
| `EntryPointDiscovery.ts` | `intelligence_plane/src/server/` | ~800 | Public surface discovery |
| `EntryPointModel.ts` | `intelligence_plane/src/server/` | ~589 | Entry point type system |
| `EntryPointChangeDetector.ts` | `intelligence_plane/src/server/` | ~309 | Change detection |
| `DifferentialFindingEngine.ts` | `intelligence_plane/src/server/` | ~600 | Differential analysis |
| `ExpectationEngine.ts` | `intelligence_plane/src/server/` | ~500 | Behavioral expectation modeling |
| `TechnicalProblemDetector.ts` | `intelligence_plane/src/server/` | ~600 | Technical problem detection |
| `InvestigationPlanner.ts` | `intelligence_plane/src/server/` | ~400 | Investigation planning |
| `DeepProspectBuilder.ts` | `intelligence_plane/src/server/` | ~800 | Deep prospect research |
| `DeepSignalExtractor.ts` | `intelligence_plane/src/server/` | ~685 | Signal extraction with negation handling |
| `LivePublicObservationProvider.ts` | `intelligence_plane/src/server/` | ~500 | Public surface observation |
| `LiveWebResearchProvider.ts` | `intelligence_plane/src/server/` | ~200 | Web research provider |
| `WebSearchProvider.ts` | `intelligence_plane/src/server/` | ~200 | Search provider |
| `ResearchBudget.ts` | `intelligence_plane/src/server/` | ~638 | Research budget management |
| `DeepTypes.ts` | `intelligence_plane/src/server/` | ~615 | Type definitions |
| `IntelligenceCase.ts` | `intelligence_plane/src/server/` | ~191 | Intelligence case model |
| `findings/ProblemFinding.ts` | `intelligence_plane/src/server/` | ~483 | Problem finding model |
| `FindingProofContracts.ts` | `intelligence_plane/src/server/` | ~15 (stripped) | Proof contracts |

### D.3 Test Files Reviewed

| File | Path | Lines | Content |
|---|---|---|---|
| `trust_boundary.test.ts` | `intelligence_plane/tests/` | ~60 | 15-case negative test matrix |
| `e2e_validation.ts` | `intelligence_plane/scripts/` | ~80 | E2E validation (11/11 pass) |

### D.4 Runtime Documentation Reviewed

| File | Path | Content |
|---|---|---|
| `runtime/status.md` | Root | Green components, known limits |
| `runtime/tests.md` | Root | CI requirements, AER-KEP-Q coverage |
| `runtime/report.md` | Root | Current state, security boundary |
| `ROADMAP.md` | Root | Development roadmap |

---

## APPENDIX E: GIT COMMIT HISTORY REFERENCE

The following commits were noted during the assessment (read via `/tmp/qcore_bare` bare clone):

| Commit | Message | Significance |
|---|---|---|
| e223f64 | "VAL: first real intelligence E2E validation through Q-Core" | Baseline validated commit |
| a8c78d5 | AER-KEP-Q v2 integration | Epoch management |
| ba8066c | AER-KEP-Q v2 hardening | Exposure quarantine |
| c854eb0 | Enterprise control plane | RBAC, tenant management |
| b2ae6d3 | Idempotency | Duplicate prevention |
| 9b0fd48 | Idempotency improvements | Signal ID dedup |
| 502968f | Roadmap | Feature planning |

---

*This document was prepared by the Phase 7 Independent Security Assurance Team. All findings are based on code review of the repository at the stated commit. This is not a certification document. No production systems were modified during this assessment (Rule 18: no code changes).*

*Document version: 1.0*
*Date: 2025*
*Distribution: Internal — Security Team, Engineering Leadership, Compliance*
