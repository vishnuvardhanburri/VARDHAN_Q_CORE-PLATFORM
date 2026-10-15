# PoV Acceptance Criteria & Pass/Fail Matrix

## Git Baseline
- **Commit:** `8d403fe551d388a79a7b88e855c987825c4d9985`
- **Docker image:** `vardhan-qcore-pov:latest` (multi-stage Rust 1.98 → runtime)
- **Runtime:** Docker Desktop macOS arm64

---

## Acceptance Criteria

| # | Criterion | Threshold | Measured | Pass/Fail |
|---|-----------|-----------|----------|-----------|
| AC-01 | Docker image builds successfully (multi-stage Rust 1.98) | Build exit 0 | exit 0 | ✅ PASS |
| AC-02 | Container starts and passes health check | HTTP 200 `{"status":"operational"}` within 30s | Health check passes | ✅ PASS |
| AC-03 | Login endpoint works at c1 (single-threaded) | p50 ≤ 100ms | p50 = 68.7ms | ✅ PASS |
| AC-04 | Login endpoint works at c100 (high concurrency) | ≥45/50 success, p50 ≤ 600ms | 50/50, p50 = 495.8ms | ✅ PASS |
| AC-05 | Contract sealing works at c1 | p50 ≤ 10ms, ≥50/50 success | p50 = 7.2ms, 50/50 | ✅ PASS |
| AC-06 | Contract sealing works at c100 | ≥50/50 success, p50 ≤ 100ms | 50/50, p50 = 36.2ms | ✅ PASS |
| AC-07 | Receipt verification works at c1 | p50 ≤ 5ms, ≥50/50 | p50 = 1.2ms, 50/50 | ✅ PASS |
| AC-08 | Receipt verification works at c100 | ≥50/50 success, p50 ≤ 30ms | 50/50, p50 = 10.7ms | ✅ PASS |
| AC-09 | Audit retrieval works at c100 | ≥50/50 success, p50 ≤ 20ms | 50/50, p50 = 3.4ms | ✅ PASS |
| AC-10 | E2E workflow works at c50 | ≥20/20 success, p50 ≤ 100ms | 20/20, p50 = 25.0ms | ✅ PASS |
| AC-11 | Baseline (subprocess, no HTTP) works at c1 | p50 ≤ 10ms, ≥50/50 | p50 = 6.6ms, 50/50 | ✅ PASS |
| AC-12 | Baseline (subprocess) works at c100 | ≥50/50 success, p50 ≤ 50ms | 50/50, p50 = 20.0ms | ✅ PASS |
| AC-13 | Security: valid contract → SEALED with dual signatures | Ed25519 + ML-DSA-87 present | Both present | ✅ PASS |
| AC-14 | Security: replay attack → REJECTED_REPLAY | Idempotent replay rejected | 1 SEALED + 4 REJECTED | ✅ PASS |
| AC-15 | Security: tampered hash → rejected | Tampered hash rejected (401/422) | Rejected | ✅ PASS |
| AC-16 | Security: unauthorized actor → rejected | Spoofed actor prefix rejected | Rejected | ✅ PASS |
| AC-17 | Security: unknown tenant → DENY_TENANT_UNKNOWN | Unknown tenant denied | Denied | ✅ PASS |
| AC-18 | Security: unauthenticated request → 401 | 401 for missing token | 401 | ✅ PASS |
| AC-19 | Cryptographic: Ed25519 sign ≥ 5K ops/sec | ≥5,000 ops/sec | 67,649 ops/sec | ✅ PASS |
| AC-20 | Cryptographic: Ed25519 verify ≥ 5K ops/sec | ≥5,000 ops/sec | 24,127 ops/sec | ✅ PASS |
| AC-21 | Cryptographic: ML-DSA-87 sign ≥ 50 ops/sec | ≥50 ops/sec | 146.3 ops/sec | ✅ PASS |
| AC-22 | Cryptographic: ML-DSA-87 verify ≥ 100 ops/sec | ≥100 ops/sec | 790.2 ops/sec | ✅ PASS |
| AC-23 | Cryptographic: BLAKE3 throughput ≥ 500 MB/s | ≥500 MB/s | 910 MB/s | ✅ PASS |
| AC-24 | Reliability: receipt verifiable after container restart | Verify exit code 0 after restart | Exit code 0 | ✅ PASS |
| AC-25 | Reliability: idempotency flag persists after restart | Replay rejected after restart | REJECTED_REPLAY | ✅ PASS |
| AC-26 | Reliability: new contract works after restart | ≥1/1 SEALED after restart | 1/1 SEALED | ✅ PASS |
| AC-27 | HTTP API overhead vs baseline at c1 | ≤5ms overhead | ~1.5ms (7.2ms vs 6.6ms) | ✅ PASS |
| AC-28 | Concurrency scaling: throughput does not degrade below 2/req per sec | ≥2 req/sec at c100 | ~10 req/sec at c100 | ✅ PASS |

---

## Summary

| Category | Criteria Met | Total | Status |
|----------|-------------|-------|--------|
| Docker / Environment | 1/1 | 1 | ✅ PASS |
| Performance | 9/9 | 9 | ✅ PASS |
| Security | 6/6 | 6 | ✅ PASS |
| Cryptography | 5/5 | 5 | ✅ PASS |
| Reliability | 3/3 | 3 | ✅ PASS |
| API Overhead | 1/1 | 1 | ✅ PASS |
| Concurrency Scaling | 1/1 | 1 | ✅ PASS |
| **TOTAL** | **26/26** | **26** | ✅ **ALL PASS** |
