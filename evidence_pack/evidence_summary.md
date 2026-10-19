# Evidence Summary — VARDHAN Q-Core Prototype

## Purpose

This document summarizes the reproducible evidence demonstrating that the VARDHAN Q-Core
prototype implements a cryptographic authorization-bound execution sealing system with
Ed25519 + ML-DSA-87 dual signatures, replay protection, trust-boundary enforcement, and
adversarial rejection. It distinguishes **prototype-functional evidence** from **production-readiness
evidence**.

> **Status**: Phase 8a (baseline) complete. Phase 8b (production security hardening) implementation
> complete with reproducible tests. See the "Phase 8b Hardening Results" section below.

## What Was Tested

| Test Suite | Scope | Result |
|---|---|---|
| Lab Demo (`lab_demo_verify.sh`) | 5 scenarios: valid seal, replay, malformed hash, tampered signature, unauthorized actor | 5/5 PASS |
| E2E Lifecycle (`e2e_lifecycle_validation.py`) | 33 checks: org lifecycle, auth, tenant isolation, contract sealing, replay, trust boundary, unauthorized actor, spoofed issuer, independent verification, tampered signature rejection, audit, member management, invitations, service restart & state persistence | 33/33 PASS |
| Rust Unit Tests (`cargo test -p vardhan_receipt`) | R1–R6, keystore, boundary tests, idempotency, audit trail, adversarial policy | 68/68 PASS |
| Rust Keystonestore Tests (`cargo test -p vardhan_keystore --features vault`) | Envelope protection, development local protection, Vault provider (vault feature) | 43/43 PASS |
| Rust Regression Tests (`cargo test -p control_plane_api --test org_lifecycle_edge_cases`) | 13 tests: duplicate org, unauthenticated, role-based access, session, tenant isolation, replay protection | 13/13 PASS |
| Rust Tenant Isolation (`cargo test -p control_plane_api --test tenant_isolation_test`) | 6 tests: tenant scoping, viewer privileges, session persistence, invitation lifecycle | 6/6 PASS |

## What Passed

1. **Dual-signature sealing**: A valid Q-Core contract produces a receipt with both an
   Ed25519 signature and an ML-DSA-87 (FIPS 204) signature.
2. **Independent verification**: The `vardhan-receipt verify` binary independently
   verifies both signatures against public keys from the keystore. Verification output
   shows 19 checks passed, 0 failures.
3. **Replay rejection**: Duplicate submission of an already-sealed finding_id returns
   `REJECTED_REPLAY`. Persists across server restart (idempotency flag files survive).
4. **Trust boundary enforcement**: Malformed content hashes are rejected with
   `REJECTED_TRUST_BOUNDARY`.
5. **Unauthorized actor rejection**: Actors whose workload ID does not match the
   authorized prefix are denied with `DENY_ACTOR_NOT_AUTHORIZED`.
6. **Tampered signature rejection**: Modifying an Ed25519 signature in a sealed receipt
   causes independent verification to return `Invalid`.
7. **Tenant isolation**: Unknown tenants are denied with `DENY_TENANT_UNKNOWN`.
8. **State persistence**: Organizations, roles, and idempotency flags survive a full
   server restart (sled `db.flush()` ensures writes persist to disk).

## Phase 8b Hardening Results

| Hardening Area | Implementation | Tests | Status |
|---|---|---|---|
| 1. Distributed Replay Protection | Atomic file creation (`O_CREAT\|O_EXCL`) + `fsync` on parent directory | 13 regression + 31 E2E | ✅ Implemented & tested |
| 2. Secure Transport (TLS) | rustls-based TLS in axum `serve()` via `TlsListener` implementing `Listener` trait. Configurable via `VARDHAN_TLS_CERT_PATH`/`VARDHAN_TLS_KEY_PATH`. Feature-gated behind `tls` feature flag. | TLS feature compiles; default build unaffected | ✅ Implemented (feature-gated) |
| 3. Key Management (Vault) | `VaultKeyProtectionProvider` implementing `KeyProtectionProvider` trait with Vault transit engine encrypt/decrypt. Wired into `EnvironmentKeyProtectionProvider::select()` for production mode. Feature-gated behind `vault` feature flag. | 6 Vault tests (key name, configured, provider name, production safety) + 43 total keystore tests | ✅ Implemented & tested |
| 4. Identity Binding | `IssuerRegistry` with `IssuerEntry` structs. `DENY_ISSUER_UNBOUND` check fires before `DENY_ACTOR_NOT_AUTHORIZED`. Dev config includes `svc:vardhan-intelligence:` → `dev-local`. | 4 adversarial policy tests (T9, T11b, T13, T14) + E2E spoofed issuer test | ✅ Implemented & tested |
| 5. Audit Integrity | `AuditWriter` with BLAKE3 hash chaining + ML-DSA-87 signing + `fsync` per entry. Integrated into `process_transaction()`. | 5 audit trail tests (chain linkage, tamper detection, reopen, forged entry) | ✅ Implemented & tested |
| 6. CI Verification | New `adversarial-security` job in CI workflow: tests issuer binding, audit trail, Vault KMS, TLS compilation, regression, lab demo, E2E | CI workflow updated | ✅ Implemented & tested |

### New Adversarial Tests (Rust, 9 tests)

| Test | Category | What It Tests |
|---|---|---|
| t9_unauthorized_actor_is_denied | Identity binding | Unregistered issuer prefix → `DENY_ISSUER_UNBOUND` |
| t11_empty_tenant_is_denied | Tenant security | Empty tenant_id → `DENY_TENANT_MISSING` |
| t12_spoofed_issuer_prefix_is_denied | Adversarial | Substring match without prefix → `DENY_ISSUER_UNBOUND` |
| t13_sql_injection_in_tenant_id_is_handled | Injection | SQL injection in tenant_id → `DENY_TENANT_UNKNOWN` |
| t14_dot_separator_is_denied | Adversarial | Wrong separator → `DENY_ISSUER_UNBOUND` |
| t14_empty_service_segment_is_denied | Actor validation | Empty service segment → `DENY_ACTOR_NOT_AUTHORIZED` |
| t17_bypass_attempt_via_wrong_version_is_denied | Policy | Policy version "0.0" → no silent upgrade |
| t18_empty_context_is_fully_denied | Default-deny | All-empty context → never ALLOW |
| audit_trail tamper detection | Audit integrity | Modified entry's hash ≠ next entry's prev_hash |

## What Remains Unproven

1. **Independently authenticated execution evidence**: The contract is submitted via a
   local HTTP API. There is no integration with an independently authenticated execution
   source (e.g., a production CI/CD pipeline, a SIEM, or a hardware attestation service).
   The `actor_workload_id` is set client-side and not cryptographically bound to an
   external identity provider.
2. **Production transport security**: TLS is now available behind the `tls` feature flag
   (rustls-based, no OpenSSL dependency), but is **not enabled by default**. Production
   deployments must build with `--features control_plane_api/tls` and set
   `VARDHAN_TLS_CERT_PATH` and `VARDHAN_TLS_KEY_PATH`.
3. **Production HSM/KMS key custody**: Keys are stored in a development keystore
   (`$VARDHAN_KEYSTORE_DIR`) with a development KEK. The Vault transit engine
   provider is wired in behind the `vault` feature flag, but production deployments must
   build with `--features vardhan_keystore/vault` and configure
   `VARDHAN_VAULT_ADDR` and `VARDHAN_VAULT_TOKEN`.
4. **Multi-node replay protection**: Idempotency is file-based (`O_CREAT|O_EXCL` + `fsync`).
   This provides atomic single-process concurrency but not distributed consensus. A
   production cluster would need a shared sled DB, Redis, or a distributed consensus
   service (Raft/etcd) for true multi-node replay protection.
5. **Independent security assessment**: No third-party security audit or penetration
   testing has been performed. The adversarial tests included in Phase 8b are
   developer-authored and not externally validated.
6. **CI status independently confirmed**: The CI workflow has been updated with
   adversarial regression test jobs, but GitHub Actions status has not been
   independently verified as green at this checkpoint.
   clustered deployment, this would need a distributed coordination service.
5. **Independent security assessment**: No third-party security audit or certification
   has been performed.
6. **Audit ledger publication**: The audit ledger (`audit_ledger` module) uses a
   BLAKE3 hash chain with ML-DSA-87 signatures, but publication to an external log
   sink is not configured (`Audit ledger or node identity not configured — logged to
   tracing only`).

## Conclusion

The prototype demonstrates core cryptographic and authorization-bound behaviors in a
controlled lab environment. It is **not** presented as production-ready, certified, or
proven to solve an LGT security gap. The evidence validates specific behaviors under
specific conditions, which we hope to discuss in the context of LGT's PQC migration.
