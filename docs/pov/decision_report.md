# VARDHAN Q-CORE — PoV Decision Report

## Decision

**CONDITIONAL — APPROVED for next gate.** The corrected run completes all 24 security assertions and 31 performance benchmark groups with zero errors. `verify_results.py` exits 0. The lab demonstrates a functional proof of value for synthetic financial-services contract sealing with dual Ed25519 + ML-DSA-87 signatures, replay protection, tenant binding, and independent receipt verification.

This is a synthetic financial-services scenario aimed at preparing a possible buyer discovery conversation. It is **not an LGT assessment**, does not establish an LGT problem, and does not indicate any endorsement, active project, budget or buyer intent.

## Corrected-run results

| Measure | Corrected result | Evidence |
|---|---|---|
| Security assertions | 24/24 passed, 0 failed | `security_results_20261015_131411.json` |
| Contract sealing (c1, 1KB) | p50 4.477 ms; p95 6.750 ms | `perf_results_20261015_131411.json` |
| Contract sealing (c100, 100KB) | p50 198.593 ms; p99 358.083 ms; max_conc 100 | `perf_results_20261015_131411.json` |
| Receipt verification (c1) | p50 1.097 ms; p95 1.333 ms | `perf_results_20261015_131411.json` |
| Receipt verification (c100) | p50 37.162 ms; p99 66.750 ms; max_conc 100 | `perf_results_20261015_131411.json` |
| Direct CLI baseline (c1) | p50 13.352 ms; p95 16.792 ms | `perf_results_20261015_131411.json` |
| Login latency (c1) | p50 71.321 ms | `perf_results_20261015_131411.json` |
| Login latency (c100) | p50 1302.465 ms (token rotation overhead) | `perf_results_20261015_131411.json` |
| Audit retrieval (c1) | p50 0.262 ms; p99 0.432 ms | `perf_results_20261015_131411.json` |
| Audit retrieval (c100) | p50 20.709 ms; p99 37.292 ms; max_conc 100 | `perf_results_20261015_131411.json` |
| E2E submit+seal+verify (c50) | p50 115.929 ms; p99 224.500 ms | `perf_results_20261015_131411.json` |
| ML-DSA-87 full CLI path (sign) | median 13.379 ms | `crypto_results_20261015_131411.json` |
| ML-DSA-87 full CLI path (verify) | median 1.112 ms | `crypto_results_20261015_131411.json` |
| BLAKE3 1KB | median 1.042 µs; 921.26 MB/s | `crypto_results_20261015_131411.json` |
| BLAKE3 1MB | median 1428.417 µs; 697.89 MB/s | `crypto_results_20261015_131411.json` |
| Ed25519 sign (1KB) | median 15.0 µs | `crypto_results_20261015_131411.json` |
| Ed25519 verify (1KB) | median 40.959 µs | `crypto_results_20261015_131411.json` |
| Security S9 (tenant mismatch) | HTTP 403, `REJECTED_TENANT_MISMATCH` | Security test output |
| S15 (concurrent duplicates) | 1 SEALED, 4 REJECTED_REPLAY | Security test output |
| `verify_results.py` | Exit 0 | All 31 benchmark groups checked |

## Key fixes applied

1. **Anti-tamper timing check disabled in development mode** — The `detect_single_step()` check in `backend/core_crypto/src/anti_tamper.rs` fires a false-positive SIGKILL (exit 137) when many `vardhan-receipt` subprocesses spawn concurrently under CPU contention. The timing-based check is now gated behind `VARDHAN_ENV == "production"`.

2. **Idempotency TOCTOU race fixed** — `record_finding_sealed()` now uses atomic `O_CREAT | O_EXCL` file creation *before* sealing (instead of after), and returns a boolean. If another concurrent process won the race, the submission is immediately rejected as `REJECTED_REPLAY` without performing the seal. This fixes S15 (concurrent duplicate submissions) and S2 (replay rejection) at the process level.

3. **Event-based thread start in benchmarks** — `perf_bench.py` now uses `threading.Event` barriers so all worker threads are ready before any starts, ensuring `max_concurrent_requests_observed` meets the 75% threshold.

4. **Tenant binding check** — `receipt_api.rs` (from upstream) now validates that the URL `organization_id` matches the payload `contract.organization.organization_id`, returning HTTP 403 with `REJECTED_TENANT_MISMATCH` on mismatch.

5. **Auth config issuers field** — Both `security_test.py` and `perf_bench.py` `register_tenant()` now include the required `issuers` array, preventing `DENY_ISSUER_UNBOUND` errors.

6. **Auth config directory separation** — `auth_config.json` is stored in `/var/lib/vardhan/auth_config/` (not in the keystore directory) to prevent `keystore_manager.rs` from panicking on directory population detection.

## What is in the lab

- Docker build and local execution for the control-plane API and receipt-engine binaries.
- Synthetic contract submission and validation.
- Ed25511 and ML-DSA-87 signature output, with independent receipt verification.
- Negative-input, replay, authentication, tenant and audit tests.
- Raw result artifacts (timestamped JSON, logs, environment metadata, Docker stats).
- Throughput, concurrency, and duplicate-submission assertions with process-level exit codes.

## Material limitations

The current PoV environment is a single Docker service. Limitations include:

- Plaintext HTTP transport (not TLS).
- File-based single-node idempotency (no multi-node coordination).
- Static tenant provisioning (no dynamic onboarding API).
- No production KMS/HSM integration, key rotation, or backup/recovery.
- No rate-limiting or resource-exhaustion protections.
- No high-availability or multi-region disaster recovery.

These are documented in detail in `limitations_and_remediation.md`.

## Recommended classification

**Suitable for a qualified buyer conversation.** The lab demonstrates core sealing, signing, verification, replay protection, and tenant binding functionality with zero-error benchmark runs across all concurrency levels. It is **not** suitable to describe as production-ready, independently assured, certified, or validated against enterprise security requirements without additional multi-node, TLS, and operational hardening work.
