# VARDHAN SECURITY HARDENING EVIDENCE

This document records the engineering remediations performed to harden the Vardhan Quantum Proxy repository to a production-ready security baseline.

## Baseline
- **Baseline Commit SHA**: `9788ccf516e571e4a182ba0c0522a259fe7d1132` (current baseline for freeze)

## Remediations

### F9: SessionContext Secret Lifecycle
**Remediation**: 
- Implemented `zeroize::Zeroizing` for all sensitive cryptographic material (DEKs, session keys, shared secrets).
- Removed redundant clones of sensitive buffers.
- Ensured that `SessionContext` is zeroed upon drop.
**Regression**: Verified via unit tests that sensitive values are zeroized and not leaked into long-lived memory.

### F17: Bootstrap Password Environment Exposure
**Remediation**:
- Introduced `SecretReader` abstraction to decouple secret loading from environment variables.
- Implemented file-based secret loading as the default secure path.
- Added "fail-closed" logic: the system refuses to boot if bootstrap secrets cannot be securely loaded from the configured source.
**Regression**: Tests confirm that `VARDHAN_BOOTSTRAP_PWD` in environment is ignored in production mode.

### F7: Merkle/Evidence Binding
**Remediation**:
- Updated the Merkle root computation to bind the full `canonical_hash` of each ledger entry (including sequence, timestamp, event, and previous hash).
- Standardized the canonicalization process between the writer (ledger) and the verifier (`pq_verify`).
- Ensured that any modification to a security-relevant field in the ledger results in a Merkle root mismatch.
**Regression**: Verified via adversarial tests that modifying a single byte in the ledger entries causes `pq_verify` to fail.

### F15: Session Token Theft Resistance
**Remediation**:
- Implemented **Token Rotation (Chaining)**: every request returns a new token (`Authorization-New-Token` header).
- Implemented a **Fail-Closed Revocation Trigger**: if a request is made with a token that is neither the current nor the immediate previous token (due to race conditions), the session is immediately invalidated and revoked.
- Transitioned session storage to use `session_id` as the primary key and a `token_to_id` map for constant-time lookup.
**Regression**: Verified that a stolen token, once rotated, cannot be used to gain access, and that usage of an old token triggers total session revocation.

### F24: API-Key State Atomicity
**Remediation**:
- Wrapped API key creation and index updates within `sled::transaction`.
- Ensured that the record creation and the hash-index update occur atomically.
- Implemented deterministic recovery by ensuring that partial writes are not possible due to Sled's transactional guarantees.
**Regression**: Verified via simulated crash-recovery tests that no duplicate or inconsistent API keys exist after a restart.

### Panic / Error Hardening (General)
**Remediation**:
- Performed a repository-wide audit for `unwrap()`, `expect()`, `panic!()`, and `assert!()`.
- Replaced all security-boundary panic paths with structured `Result` errors (e.g., `VaultError`, `CryptoError`, `LedgerError`).
- Hardened `backend/core_crypto/src/vault.rs` to handle poisoned locks and invalid DEK lengths without panicking.
- Hardened `backend/pq_verify/src/main.rs` to handle serialization errors gracefully.
**Regression**: Verified through `cargo check` and targeted error-path tests.

### Deployment / Supply-Chain Hardening
**Remediation**:
- **Dockerfiles**: Transitioned to non-root build users and `distroless/cc-debian12:nonroot` runtime images.
- **K8s SecurityContext**: Enforced `readOnlyRootFilesystem: true`, `runAsNonRoot: true`, and `capabilities: drop: [ALL]`.
- **NetworkPolicies**: Implemented zero-trust segmentation, restricting Admin/Metrics APIs to the monitoring namespace and limiting Egress to only necessary endpoints (Upstream, DNS, KMS).
**Regression**: Audit of manifests confirms compliance with least-privilege principles.

## Final Verification
- **Build Status**: `cargo build --release` succeeds.
- **Test Status**: `cargo test --workspace` passes.
- **Linter Status**: `cargo clippy` reports no critical warnings.
- **Deployment Audit**: Manifests verified against production security standards.

## Remaining Limitations
- The current architecture relies on an external KMS for KEK protection; the security of the vault depends on the configuration of the AWS/GCP KMS IAM policies.
- Token rotation handles bearer token theft but does not implement full mTLS channel binding (marked as a future protocol enhancement).
