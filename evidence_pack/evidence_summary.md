# Evidence Summary — VARDHAN Q-Core Prototype

## Purpose

This document summarizes the reproducible evidence demonstrating that the VARDHAN Q-Core
prototype implements a cryptographic authorization-bound execution sealing system with
Ed25519 + ML-DSA-87 dual signatures, replay protection, trust-boundary enforcement, and
adversarial rejection. It distinguishes **prototype-functional evidence** from **production-readiness
evidence**.

## What Was Tested

| Test Suite | Scope | Result |
|---|---|---|
| Lab Demo (`lab_demo_verify.sh`) | 5 scenarios: valid seal, replay, malformed hash, tampered signature, unauthorized actor | 5/5 PASS |
| E2E Lifecycle (`e2e_lifecycle_validation.py`) | 31 checks: org lifecycle, auth, tenant isolation, contract sealing, replay, trust boundary, unauthorized actor, independent verification, tampered signature rejection, audit, member management, invitations, service restart & state persistence | 31/31 PASS |
| Rust Unit Tests (`cargo test -p vardhan_receipt`) | R1–R6, keystore, boundary tests, idempotency | 59/59 PASS |
| Rust Regression Tests (`cargo test -p control_plane_api --test org_lifecycle_edge_cases`) | 13 tests: duplicate org, unauthenticated, role-based access, session, tenant isolation | 13/13 PASS |
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

## What Remains Unproven

1. **Independently authenticated execution evidence**: The contract is submitted via a
   local HTTP API. There is no integration with an independently authenticated execution
   source (e.g., a production CI/CD pipeline, a SIEM, or a hardware attestation service).
   The `actor_workload_id` is set client-side and not cryptographically bound to an
   external identity provider.
2. **Production transport security**: The API runs over plain HTTP in development mode.
   TLS is not configured. Production must set `VARDHAN_QCORE_SERVICE_SECRET`.
3. **Production HSM/KMS key custody**: Keys are stored in a development keystore
   (`$VARDHAN_KEYSTORE_DIR`) with a development KEK. No certified HSM/KMS provider is
   wired up. Production requires `VARDHAN_PRODUCTION_KEK` and `VARDHAN_KMS_PROVIDER`.
4. **Multi-node replay protection**: Idempotency is file-based (single-process). In a
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
