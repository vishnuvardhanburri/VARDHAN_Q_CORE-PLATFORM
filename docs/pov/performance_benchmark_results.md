# Performance Benchmark Results

## Evidence Status

**50/50 successful requests per scenario across all concurrency levels (c = 1, 5, 10, 25, 50, 100). Zero reported errors across 10 benchmark suites (520 total measured operations).**

All requests in the successful contract sealing suite produced authenticated `SEALED` receipts with dual Ed25519 and ML-DSA-87 (FIPS 204) post-quantum signatures. Independent verification of sealed receipts via `vardhan-receipt verify` passed all 19 structural and cryptographic checks. Deliberate tenant mismatch requests were rejected with HTTP 403 (`REJECTED_TENANT_MISMATCH`). Replay submissions were rejected by the distributed idempotency guard with HTTP 200 (`REJECTED_REPLAY`).

**Production Status**: **BLOCKED**. These results reflect a local single-node synthetic benchmark, not multi-node production capacity or authorization for live banking rails.

---

## Environment

| Parameter | Value |
|---|---|
| Host Platform | macOS-27.0.1-arm64-arm-64bit-Mach-O |
| Architecture | arm64 (Apple Silicon) |
| Runtime Environment | Rust 1.99.0 (b940084d7 2026-09-28), Cargo 1.99.0 (5f94df478 2026-08-27) |
| Script Interpreter | Python 3.14.2 (Clang 17.0.0) |
| Control Plane Binary | `target/release/control_plane_api` |
| Receipt Verification Binary | `target/release/vardhan-receipt` |
| Concurrency Levels | 1, 5, 10, 25, 50, 100 |
| Requests per Level | 50 (total 300 per suite; 20 for E2E workflow) |
| Warm-up | 3 requests prior to measurement |
| Timestamp (UTC) | `2026-10-25T17:59:57Z` |

---

## Measurement Methodology

1. **Aggregate Throughput**: Calculated strictly as:
   $$\text{Throughput} = \frac{\text{Completed Successful Requests}}{\text{Total Wall-Clock Seconds}}$$
   Wall-clock duration is measured from immediately before thread execution begins until all concurrent futures complete. This avoids reciprocal-of-average-latency artifacts under concurrency.
2. **Session Rotation & Token Handling**: Authentication enforces single-session token rotation with a 30-second grace window (`ROTATION_GRACE_SECS = 30`). Tokens are refreshed per concurrency suite to model concurrent authorized clients without tripping stale-token revocation.
3. **Outcome Discrimination**: Status code alone is insufficient. Each test validates the explicit payload status:
   - Contract Seal (Success): HTTP 200/201 and payload status `SEALED`.
   - Contract Seal (Mismatch): HTTP 403 and payload status `REJECTED_TENANT_MISMATCH`.
   - Replay Rejection: HTTP 200 and payload status `REJECTED_REPLAY`.
   - Receipt Verification: Exit code 0 from `vardhan-receipt verify` with `status: "Valid"`.
4. **Cryptographic Realism**: The receipt verification benchmark exercises the actual `vardhan-receipt` CLI on a live dual-signed receipt with Ed25519 and ML-DSA-87 signatures.

---

## Benchmark Suite Results

### 1. Organization Read (`GET /api/v1/organizations/{id}`)

| Concurrency | Success / Total | Throughput (req/s) | Wall Clock (s) | Avg (ms) | P50 (ms) | P95 (ms) | Max (ms) | Errors |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 50 / 50 | 2,988.40 | 0.017 | 0.291 | 0.191 | 0.244 | 4.891 | 0 |
| 5 | 50 / 50 | 9,082.58 | 0.006 | 0.507 | 0.407 | 0.653 | 4.429 | 0 |
| 10 | 50 / 50 | 8,702.65 | 0.006 | 0.986 | 0.956 | 1.312 | 3.458 | 0 |
| 25 | 50 / 50 | 6,401.43 | 0.008 | 2.933 | 3.087 | 4.940 | 5.736 | 0 |
| 50 | 50 / 50 | 8,444.10 | 0.006 | 1.358 | 1.259 | 2.135 | 5.111 | 0 |
| 100 | 50 / 50 | 8,284.95 | 0.006 | 1.515 | 1.360 | 2.766 | 5.069 | 0 |

### 2. Organization List (`GET /api/v1/organizations`)

| Concurrency | Success / Total | Throughput (req/s) | Wall Clock (s) | Avg (ms) | P50 (ms) | P95 (ms) | Max (ms) | Errors |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 50 / 50 | 3,535.64 | 0.014 | 0.277 | 0.183 | 0.242 | 4.763 | 0 |
| 5 | 50 / 50 | 9,512.49 | 0.005 | 0.488 | 0.380 | 0.659 | 4.665 | 0 |
| 10 | 50 / 50 | 5,280.20 | 0.009 | 1.742 | 1.050 | 5.166 | 5.262 | 0 |
| 25 | 50 / 50 | 7,117.14 | 0.007 | 2.634 | 2.632 | 4.567 | 4.913 | 0 |
| 50 | 50 / 50 | 6,548.90 | 0.008 | 4.453 | 4.449 | 5.993 | 6.685 | 0 |
| 100 | 50 / 50 | 8,189.78 | 0.006 | 1.631 | 1.519 | 2.729 | 4.685 | 0 |

### 3. Authentication / Login (`POST /api/v1/auth/login`)

| Concurrency | Success / Total | Throughput (req/s) | Wall Clock (s) | Avg (ms) | P50 (ms) | P95 (ms) | Max (ms) | Errors |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 50 / 50 | 13.49 | 3.706 | 74.098 | 70.249 | 98.059 | 151.169 | 0 |
| 5 | 50 / 50 | 48.53 | 1.030 | 99.209 | 97.351 | 112.016 | 177.940 | 0 |
| 10 | 50 / 50 | 64.56 | 0.774 | 146.957 | 139.544 | 225.428 | 229.186 | 0 |
| 25 | 50 / 50 | 63.14 | 0.792 | 331.215 | 321.432 | 511.701 | 643.033 | 0 |
| 50 | 50 / 50 | 56.82 | 0.880 | 500.870 | 496.112 | 855.277 | 875.012 | 0 |
| 100 | 50 / 50 | 57.60 | 0.868 | 541.574 | 542.891 | 857.636 | 864.998 | 0 |

*Note: Login executes deliberate Argon2 password hashing. Under high concurrency (c = 25 to 100), latency increases due to CPU contention on the password hashing workers. System throughput tops out around 57 to 65 req/s across all available cores.*

### 4. Organization Create (`POST /api/v1/organizations`)

| Concurrency | Success / Total | Throughput (req/s) | Wall Clock (s) | Avg (ms) | P50 (ms) | P95 (ms) | Max (ms) | Errors |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 50 / 50 | 120.37 | 0.415 | 8.283 | 8.351 | 10.058 | 10.766 | 0 |
| 5 | 50 / 50 | 206.43 | 0.242 | 23.553 | 24.112 | 32.198 | 36.890 | 0 |
| 10 | 50 / 50 | 189.78 | 0.263 | 49.411 | 48.910 | 71.543 | 74.848 | 0 |
| 25 | 50 / 50 | 194.92 | 0.257 | 104.479 | 102.341 | 151.798 | 174.780 | 0 |
| 50 | 50 / 50 | 221.42 | 0.226 | 120.679 | 119.540 | 217.595 | 222.582 | 0 |
| 100 | 50 / 50 | 182.25 | 0.274 | 148.771 | 145.220 | 265.140 | 269.590 | 0 |

### 5. Contract Seal - Success Path (`POST /api/v1/organizations/{id}/security/validate`)

*Validation requirement: Contract payload organization matches URL route tenant. Resulting receipt status must equal `SEALED` with dual Ed25519 and ML-DSA-87 signatures committed to idempotency storage.*

| Concurrency | Success / Total | Throughput (req/s) | Wall Clock (s) | Avg (ms) | P50 (ms) | P95 (ms) | Max (ms) | Errors |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 50 / 50 | 30.11 | 1.661 | 33.202 | 32.114 | 47.916 | 70.231 | 0 |
| 5 | 50 / 50 | 67.13 | 0.745 | 72.766 | 71.450 | 110.552 | 129.331 | 0 |
| 10 | 50 / 50 | 99.14 | 0.504 | 95.742 | 92.110 | 146.451 | 153.906 | 0 |
| 25 | 50 / 50 | 136.89 | 0.365 | 134.645 | 131.200 | 192.912 | 224.411 | 0 |
| 50 | 50 / 50 | 135.48 | 0.369 | 225.994 | 221.840 | 305.540 | 337.671 | 0 |
| 100 | 50 / 50 | 98.45 | 0.508 | 356.436 | 349.500 | 491.081 | 505.109 | 0 |

*Peak sealing capacity reaches 136.9 req/s at concurrency 25. Under maximum concurrency (c = 100), P95 latency is 491.1 ms.*

### 6. Contract Seal - Deliberate Tenant Mismatch (`POST .../security/validate`)

*Validation requirement: Deliberate cross-tenant payload submission. The server must reject the attempt before cryptographic signing with HTTP 403 and status `REJECTED_TENANT_MISMATCH`.*

| Concurrency | Success / Total | Throughput (req/s) | Wall Clock (s) | Avg (ms) | P50 (ms) | P95 (ms) | Max (ms) | Errors |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 50 / 50 | 2,971.68 | 0.017 | 0.329 | 0.280 | 0.369 | 4.066 | 0 |
| 5 | 50 / 50 | 4,895.04 | 0.010 | 0.972 | 0.810 | 4.088 | 4.181 | 0 |
| 10 | 50 / 50 | 5,231.04 | 0.010 | 1.674 | 1.540 | 4.030 | 4.446 | 0 |
| 25 | 50 / 50 | 5,659.98 | 0.009 | 3.317 | 3.120 | 5.336 | 5.929 | 0 |
| 50 | 50 / 50 | 5,813.87 | 0.009 | 3.851 | 3.710 | 6.470 | 6.905 | 0 |
| 100 | 50 / 50 | 5,265.14 | 0.009 | 3.188 | 3.050 | 5.466 | 5.647 | 0 |

*Rejection path avoids the cryptographic signing subprocess, maintaining >5,000 req/s throughput and single-digit millisecond latency across all concurrency levels.*

### 7. Audit / Evidence Retrieval (`GET /api/v1/organizations/{id}/security/audit`)

| Concurrency | Success / Total | Throughput (req/s) | Wall Clock (s) | Avg (ms) | P50 (ms) | P95 (ms) | Max (ms) | Errors |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 50 / 50 | 3,750.55 | 0.013 | 0.260 | 0.178 | 0.263 | 3.776 | 0 |
| 5 | 50 / 50 | 8,546.22 | 0.006 | 0.541 | 0.410 | 0.772 | 4.672 | 0 |
| 10 | 50 / 50 | 5,615.45 | 0.009 | 1.588 | 1.450 | 4.109 | 4.803 | 0 |
| 25 | 50 / 50 | 5,288.84 | 0.009 | 3.705 | 3.650 | 5.761 | 6.027 | 0 |
| 50 | 50 / 50 | 5,780.99 | 0.009 | 2.953 | 2.890 | 4.774 | 4.879 | 0 |
| 100 | 50 / 50 | 6,488.59 | 0.008 | 1.896 | 1.810 | 3.234 | 4.616 | 0 |

### 8. Replay Rejection Guard (`POST .../security/validate`)

*Validation requirement: Submits duplicate findings that were previously sealed. The idempotency guard intercepts the request and responds with HTTP 200 and status `REJECTED_REPLAY`.*

| Concurrency | Success / Total | Throughput (req/s) | Wall Clock (s) | Avg (ms) | P50 (ms) | P95 (ms) | Max (ms) | Errors |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 50 / 50 | 3,394.67 | 0.015 | 0.287 | 0.210 | 0.303 | 3.885 | 0 |
| 5 | 50 / 50 | 4,974.81 | 0.010 | 0.967 | 0.890 | 4.014 | 4.444 | 0 |
| 10 | 50 / 50 | 5,744.76 | 0.009 | 1.554 | 1.420 | 3.189 | 3.363 | 0 |
| 25 | 50 / 50 | 5,691.95 | 0.009 | 3.324 | 3.200 | 5.401 | 6.071 | 0 |
| 50 | 50 / 50 | 5,866.22 | 0.009 | 3.733 | 3.610 | 6.014 | 6.444 | 0 |
| 100 | 50 / 50 | 5,787.40 | 0.009 | 4.198 | 4.090 | 6.486 | 7.020 | 0 |

### 9. Independent Receipt Verification (`vardhan-receipt verify`)

*Validation requirement: Executes `vardhan-receipt verify` as a separate child process for every request, verifying live Ed25519 and ML-DSA-87 signatures against the keystore.*

| Concurrency | Success / Total | Throughput (req/s) | Wall Clock (s) | Avg (ms) | P50 (ms) | P95 (ms) | Max (ms) | Errors |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 50 / 50 | 258.74 | 0.193 | 3.837 | 3.750 | 4.275 | 5.210 | 0 |
| 5 | 50 / 50 | 664.60 | 0.075 | 7.144 | 6.950 | 9.776 | 10.694 | 0 |
| 10 | 50 / 50 | 639.78 | 0.078 | 14.098 | 13.800 | 24.545 | 31.717 | 0 |
| 25 | 50 / 50 | 639.92 | 0.078 | 27.389 | 26.500 | 43.262 | 55.691 | 0 |
| 50 | 50 / 50 | 620.58 | 0.081 | 27.185 | 26.100 | 42.311 | 46.640 | 0 |
| 100 | 50 / 50 | 626.10 | 0.080 | 27.933 | 27.100 | 47.257 | 49.876 | 0 |

*Peak verification throughput sustains ~620 to 665 receipts verified per second, with P95 verification latency below 48 ms even under 100 concurrent verify executions.*

### 10. End-to-End Workflow (Sequential)

*Flow: Login -> Create Organization -> Submit and Seal Contract.*

| Runs | Success / Total | Throughput (req/s) | Wall Clock (s) | Avg (ms) | P50 (ms) | P95 (ms) | Max (ms) | Errors |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 20 | 20 / 20 | 7.82 | 2.556 | 127.789 | 125.430 | 148.855 | 148.855 | 0 |

*Sequential E2E latency averages 127.8 ms per full lifecycle, with login password hashing accounting for approximately 58% of the total round-trip time.*

---

## Comparison Summary

| Operation Category | Dominant Workload | Peak Measured Throughput | P95 Latency at Peak Throughput |
|---|---|---:|---:|
| Read / Query (`Org Read`, `Org List`, `Audit`) | In-memory sled / RocksDB read | 8,500 – 9,500 req/s | < 1.0 ms |
| Guard Interception (`Tenant Mismatch`, `Replay`) | In-memory map check, early return | 5,600 – 5,800 req/s | 5.4 – 6.5 ms |
| Standalone Receipt Verification | CLI subprocess + Ed25519 + ML-DSA-87 verify | ~665 req/s | 9.8 ms |
| Data Creation (`Org Create`) | Sled DB persistent write + membership mapping | ~221 req/s | 217.6 ms |
| Full Contract Sealing (PQC) | Nitro Enclave baseline + ML-DSA-87 sign + Ed25519 sign + commit | ~137 req/s | 192.9 ms |
| User Authentication (`Login`) | Argon2 password hashing (CPU cost parameterized) | ~65 req/s | 225.4 ms |

---

## Governance and Operational Disclaimers

1. **Synthetic Workload Disclaimer**: All tests were executed on a single host (`vishnus-MacBook.local`, macOS arm64). Network round-trip delays, TLS packet fragmentation, gateway proxies, and geographic distribution were not factors in these measurements.
2. **Not Approval for Live Rails**: These benchmarks demonstrate cryptographic consistency, correct throughput calculation, and error-free execution of the local control plane. They do not constitute approval for live financial networks or SWIFT/FedNow integrations.
3. **Institutional Gates Pending**: Production deployment remains **BLOCKED** pending independent external cryptographic audits, HSM integration, and formalized CISO approval.
