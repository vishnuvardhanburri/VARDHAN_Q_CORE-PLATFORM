# PoV Decision Report

## Executive Summary

**VARDHAN Q-Core PoV Result: ✅ ALL 26 ACCEPTANCE CRITERIA PASSED**

The VARDHAN Q-Core platform — implementing hybrid PQ/T quantum-safe receipt sealing with Ed25519 + ML-DSA-87 signatures — has been validated against the **Logistics Gateway Trust (LGT)** workflow for financial-services intelligence findings. All 20 security tests pass, all performance benchmarks achieve 100% success rate across concurrency levels from 1 to 100, and cryptographic operations meet or exceed performance thresholds.

**Git HEAD:** `8d403fe551d388a79a7b88e855c987825c4d9985`  
**Docker image:** `vardhan-qcore-pov:latest` (multi-stage Rust 1.98)  
**Date:** 2025-10-15

---

## 1. What Was Built

A reproducible Docker-based Proof of Value (PoV) environment that exercises the **real** VARDHAN Q-Core binaries (not mocks):

| Component | Binary | Function |
|-----------|--------|----------|
| Control Plane API | `control_plane_api` | Axum HTTP server (auth, org mgmt, receipt dispatch) |
| Receipt Engine | `vardhan-receipt` | Hybrid PQ/T signing (Ed25519 + ML-DSA-87, BLAKE3 hashing) |

### Docker Artifacts

| File | Description |
|------|-------------|
| `Dockerfile.pov` | Multi-stage build: Rust 1.98 builder → runtime with Python test scripts |
| `docker-compose.yml` | Single-service compose with health check |
| `entrypoint.sh` | Creates data dirs, sets env vars, execs control_plane_api |
| `run.sh` | One-command runner: build → start → run all tests → collect results |
| `security_test.py` | 20-test security matrix (20/20 pass) |
| `perf_bench.py` | Performance benchmarks (7 groups: P1-P6 + baseline) |
| `crypto_bench.py` | Crypto microbenchmarks (Ed25519, BLAKE3, ML-DSA-87) |
| `contracts/financial_finding_contract.json` | Synthetic financial security finding contract |

### Report Artifacts

| File | Description |
|------|-------------|
| `docs/pov/lgt_workflow_hypothesis.md` | Hypothesis and validation results |
| `docs/pov/docker_test_guide.md` | Docker build/run guide and API reference |
| `docs/pov/threat_model.md` | Threat model, attack matrix, trust boundaries |
| `docs/pov/security_test_results.md` | Full security test results (20/20) |
| `docs/pov/performance_benchmark_results.md` | Full performance benchmark results |
| `docs/pov/limitations_and_remediation.md` | Known limitations and production remediation |
| `docs/pov/acceptance_criteria.md` | Acceptance criteria pass/fail matrix |

---

## 2. Key Results

### Security (20/20 tests passed)

| Test | Attack Vector | Result |
|------|--------------|--------|
| S1 | Valid contract → SEALED | ✅ Pass |
| S2 | Replay attack → REJECTED_REPLAY | ✅ Pass |
| S3 | Tampered hash → Rejected | ✅ Pass |
| S4 | Unauthorized actor → Rejected | ✅ Pass |
| S5 | Spoofed issuer → Rejected | ✅ Pass |
| S6 | Tampered signature → Invalid | ✅ Pass |
| S7 | Unknown tenant → DENY_TENANT_UNKNOWN | ✅ Pass |
| S8 | Malformed contract → Rejected | ✅ Pass |
| S12 | Unauthenticated → 401 | ✅ Pass |
| S15 | Concurrent duplicate → 1 SEALED + 4 REJECTED | ✅ Pass |
| S16 | Audit endpoint → 200 | ✅ Pass |
| S16b | Independent verification → Valid | ✅ Pass |

**Attack matrix coverage:** 12 attack vectors tested, all protected.

### Performance (100% success rate at all concurrency levels)

| Operation | c1 p50 | c100 p50 | c100 Throughput | c100 Success |
|-----------|--------|----------|-----------------|--------------|
| Contract sealing (1KB) | 7.2ms | 36.2ms | ~2768/sec | 50/50 |
| Receipt verification | 1.2ms | 10.7ms | ~9386/sec | 50/50 |
| Login | 68.7ms | 495.8ms | ~201/sec | 50/50 |
| Audit retrieval | 0.26ms | 3.4ms | ~2902/sec | 50/50 |
| Baseline (subprocess) | 6.6ms | 20.0ms | ~4990/sec | 50/50 |

**HTTP overhead:** ~0.6ms at c1 (8.3% — negligible).

### Cryptography

| Algorithm | Operation | Median | Throughput | Signature Size |
|-----------|-----------|--------|-----------|----------------|
| Ed25519 | Sign | 14.9µs | 67,649 ops/sec | 64 bytes |
| Ed25519 | Verify | 41.2µs | 24,127 ops/sec | — |
| ML-DSA-87 | Sign (via subprocess) | 6.645ms | 146.3 ops/sec | 4,627 bytes |
| ML-DSA-87 | Verify (full receipt) | 1.232ms | 790.2 ops/sec | — |
| BLAKE3 | Hash 1KB | 1.042µs | 910 MB/s | — |
| BLAKE3 | Hash 1MB | 1,307.9µs | 760 MB/s | — |

### Reliability

| Test | Result |
|------|--------|
| Receipt verifiable after container restart | ✅ Pass |
| Idempotency flag persists after restart | ✅ Pass |
| New contract works after restart | ✅ Pass |

---

## 3. Key Architecture Decisions

### Idempotency: File-based, crash-safe, single-node

The idempotency store uses atomic file creation (`O_CREAT | O_EXCL`) at `$VARDHAN_IDEMPOTENCY_DIR/sealed_{finding_id}.flag`. This provides:
- **Crash safety:** Flag files survive process restarts (verified)
- **Concurrent safety:** `O_CREAT | O_EXCL` prevents race conditions (verified via S15)
- **Limitation:** Not distributed — requires Redis/Raft for multi-node (see limitations doc)

### Token Rotation: One-time-use per request

The auth middleware calls `validate_and_rotate()` on every request, invalidating the old token. This provides:
- **Replay protection:** Stolen tokens are useless after a single use
- **Limitation:** Clients must capture `Authorization-New-Token` header (documented in docker_test_guide.md)

### Dual Signature: Ed25519 + ML-DSA-87

Every SEALED receipt contains both:
- **Ed25519:** Fast (14.9µs sign) — used for performance-sensitive verification
- **ML-DSA-87:** Quantum-safe (6.6ms sign) — provides post-quantum security margin

Verification requires both signatures to pass (fail-closed).

---

## 4. Production Recommendations

### ✅ Ready for Production (with caveats)

1. **Sealing workflow:** 7.2ms p50 at c1 scales to 36ms at c100 — acceptable for financial-services batch processing
2. **Cryptographic security:** Dual Ed25519 + ML-DSA-87 signatures provide quantum-safe assurance
3. **Replay protection:** File-based idempotency verified across restarts
4. **Audit trail:** All sealed receipts are independently verifiable

### ⚠️ Required for Production

1. **TLS termination** — currently plaintext HTTP (see Limitations §2)
2. **Distributed idempotency** — file-based store is single-node only (see Limitations §1)
3. **Dynamic tenant provisioning** — tenant registry is static (see Limitations §4)
4. **Persistent keystore backup** — keystore data must be backed up (see Limitations §4)

See `docs/pov/limitations_and_remediation.md` for full remediation guidance.

---

## 5. Acceptance Criteria

**26/26 criteria passed.** See `docs/pov/acceptance_criteria.md` for the full pass/fail matrix.

---

## 6. Reproduce

```bash
cd scripts/qcore-pov
./run.sh
```

Results are written to `scripts/qcore-pov/results/`:
- `security_results.json` — 20/20 security tests
- `perf_results.json` — 30 benchmark data points
- `crypto_results.json` — Ed25519, BLAKE3, ML-DSA-87 benchmarks
