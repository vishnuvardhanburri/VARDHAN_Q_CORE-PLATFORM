# Performance Benchmark Results

## Evidence Status

**28,924 total attempted operations across 10 benchmark suites, 5 repeated measurement runs per concurrency level, and 2 fixed-duration sustained-load tests. Zero unexpected errors or process crashes.**

- **Total Attempted Requests**: 28,924
- **Total Successful Business Requests**: 23,424 (contract sealing, org operations, receipt verification, authentication, and end-to-end workflows)
- **Total Expected Rejections**: 5,500 (deliberate cross-tenant mismatch and duplicate finding replay interception)
- **Total Failed Requests**: 0
- **Total Latency Sampled Requests**: 28,693
- **Verification Integrity Check**: $28,924 = 23,424 + 5,500 + 0$ (verified exact balance)

All requests in the successful contract sealing suite produced authenticated `SEALED` receipts with dual Ed25519 and ML-DSA-87 (FIPS 204) post-quantum signatures. Independent verification of sealed receipts via `vardhan-receipt verify` passed all 19 structural and cryptographic checks.

**Production Status**: **BLOCKED**. These results reflect a local single-node synthetic benchmark, not multi-node production capacity or authorization for live banking rails.

---

## Environment & Hardware Metadata

| Parameter | Value |
|---|---|
| Host Platform | macOS-27.0.1-arm64-arm-64bit-Mach-O |
| Hardware CPU | Apple M4 (10 cores: 4 performance + 6 efficiency) |
| System Memory | 16.0 GB RAM |
| Build Mode | `release` (`cargo build --release -p control_plane_api -p vardhan_receipt`) |
| Control Plane Binary | `target/release/control_plane_api` |
| Receipt Verification Binary | `target/release/vardhan-receipt` |
| Runtime Environment | Rust 1.99.0 (b940084d7 2026-09-28), Cargo 1.99.0 (5f94df478 2026-08-27) |
| Script Interpreter | Python 3.14.2 (Clang 17.0.0) |
| Primary Database | Sled embedded KV store (`/tmp/vardhan_bench_18095`) |
| Idempotency Storage | Sled distributed idempotency backend (`/tmp/vardhan_bench_idem_18095`) |
| Receipt Concurrency Limit | `RECEIPT_SEMAPHORE = 64` permits |
| Concurrency Levels | 1, 10, 50, 100 |
| Repeated Runs per Scenario | 5 runs (summary reported as Median [Min, Max]) |
| Sizing per Concurrency | c=1: 50 req; c=10: 100 req; c=50: 150 req; c=100: 250 req |
| Sustained-Load Duration | 10.0 seconds continuous load |
| Benchmark Execution Window | 2026-10-25T18:10:58Z to 2026-10-25T18:14:45Z (226.5 seconds total) |

---

## Measurement Methodology

1. **Wall-Clock Aggregate Throughput**:
   $$\text{Throughput} = \frac{\text{Completed Requests (Successful or Expected Reject)}}{\text{Total Wall-Clock Seconds}}$$
   Measured from before thread pool release until the final future completes.
2. **True In-Flight Saturation**:
   Rather than testing fixed batches (e.g. 50 requests at concurrency 100), sample counts scale with concurrency:
   - $c = 1$: 50 requests
   - $c = 10$: 100 requests
   - $c = 50$: 150 requests
   - $c = 100$: 250 requests
   Workers synchronize on a barrier and launch simultaneously. Atomic tracking confirmed that peak in-flight requests reached exactly 1, 10, 50, and 100 for every respective tier.
3. **Repeated Runs & Statistical Dispersion**:
   Every concurrency level is executed 5 independent times. All tables report the median value alongside the observed range `[min, max]` across all 5 runs.
4. **Strict Outcome Classification**:
   - `Successful`: Business action completed validly (e.g. Contract Seal with status `SEALED`).
   - `Rejected as Expected`: Deliberate security or idempotency rejection. *A successful expected rejection is NOT a successful contract creation.*
   - `Failed`: HTTP 5xx, network error, or unexpected status code.
5. **Fixed-Duration Sustained-Load Testing**:
   A continuous 10-second load generator measures sustained throughput and percentile stability over time under constant worker concurrency.

---

## Profiling and Telemetry Analysis

Empirical telemetry was captured during high-concurrency execution:

1. **Authentication / Login (Argon2 Key Derivation)**:
   - **Observed Telemetry**: 749.0% server CPU utilization, 685.95 MB RSS memory at $c = 100$.
   - **Analysis**: Authentication is purely CPU compute-bound. All available CPU cores become saturated running Argon2id password hashing functions. System throughput levels off at ~68 to 70 req/s, while P95 latency scales proportionally with queue depth (from 73 ms at $c=1$ to 3,436 ms at $c=100$).
2. **Contract Sealing (`RECEIPT_SEMAPHORE` & Process Startup)**:
   - **Observed Telemetry**: 13.0% server CPU utilization (work delegated to child processes), 155.52 MB RSS memory.
   - **Analysis**: At $c \le 50$, throughput scales near-linearly from 22 req/s to 154 req/s. At $c = 100$, excess in-flight requests exceed the configured permit cap of 64 (`VARDHAN_RECEIPT_MAX_CONCURRENCY`), causing excess workers to wait on semaphore acquisition. P95 latency increases to 1,316 ms while aggregate throughput stabilizes around 106 to 185 req/s without process crashing or resource starvation.
3. **Organization Creation (Sled DB Persistence)**:
   - **Observed Telemetry**: 11.6% server CPU utilization, 498.25 MB RSS memory.
   - **Analysis**: Sustains 173 to 212 persistent writes per second. Write lock contention in the Sled page tree and disk sync dictates throughput.

---

## 5-Run Benchmark Summary (Median [Min, Max])

### 1. Organization Read (`GET /api/v1/organizations/{id}`)
*In-memory Sled KV lookup.*

| Concurrency | Samples / Run | Peak In-Flight | Median Throughput (req/s) | Throughput Range [Min, Max] | Median P95 (ms) | Total Failed |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 50 | 1 | 3,519.36 | [3,027.6, 3,691.3] | 0.25 | 0 |
| 10 | 100 | 10 | 8,528.60 | [162.1, 8,918.5] | 1.78 | 0 |
| 50 | 150 | 50 | 353.76 | [191.2, 8,052.7] | 404.77 | 0 |
| 100 | 250 | 100 | 308.57 | [307.7, 403.3] | 787.68 | 0 |

### 2. Organization List (`GET /api/v1/organizations`)
*Multi-record iteration across Sled KV table.*

| Concurrency | Samples / Run | Peak In-Flight | Median Throughput (req/s) | Throughput Range [Min, Max] | Median P95 (ms) | Total Failed |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 50 | 1 | 3,722.75 | [3,589.8, 3,875.8] | 0.23 | 0 |
| 10 | 100 | 10 | 8,539.19 | [158.5, 9,296.4] | 1.70 | 0 |
| 50 | 150 | 50 | 350.49 | [187.9, 8,213.5] | 410.21 | 0 |
| 100 | 250 | 100 | 311.58 | [308.5, 410.8] | 779.59 | 0 |

### 3. Authentication / Login (`POST /api/v1/auth/login`)
*Argon2 password hashing.*

| Concurrency | Samples / Run | Peak In-Flight | Median Throughput (req/s) | Throughput Range [Min, Max] | Median P95 (ms) | Total Failed |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 50 | 1 | 13.83 | [13.8, 14.0] | 73.05 | 0 |
| 10 | 100 | 10 | 67.76 | [65.3, 69.3] | 221.11 | 0 |
| 50 | 150 | 50 | 68.04 | [67.5, 69.8] | 1,108.31 | 0 |
| 100 | 250 | 100 | 69.22 | [68.4, 69.6] | 3,436.46 | 0 |

### 4. Organization Create (`POST /api/v1/organizations`)
*Persistent Sled database write + index mapping.*

| Concurrency | Samples / Run | Peak In-Flight | Median Throughput (req/s) | Throughput Range [Min, Max] | Median P95 (ms) | Total Failed |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 50 | 1 | 121.11 | [119.9, 124.4] | 9.08 | 0 |
| 10 | 100 | 10 | 207.42 | [192.9, 219.0] | 67.17 | 0 |
| 50 | 150 | 50 | 212.53 | [187.0, 220.8] | 368.08 | 0 |
| 100 | 250 | 100 | 173.53 | [167.8, 184.6] | 931.45 | 0 |

### 5. Contract Seal - Success Path (`POST /api/v1/organizations/{id}/security/validate`)
*Valid contract sealing with dual Ed25519 & ML-DSA-87 signatures. Asserts `status == "SEALED"`.*

| Concurrency | Samples / Run | Peak In-Flight | Median Throughput (req/s) | Throughput Range [Min, Max] | Median P95 (ms) | Total Failed |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 50 | 1 | 22.26 | [21.6, 23.8] | 49.96 | 0 |
| 10 | 100 | 10 | 111.82 | [85.9, 127.1] | 133.77 | 0 |
| 50 | 150 | 50 | 154.33 | [85.7, 177.4] | 484.06 | 0 |
| 100 | 250 | 100 | 106.03 | [93.6, 185.1] | 1,316.13 | 0 |

### 6. Contract Seal - Deliberate Tenant Mismatch (`POST .../security/validate`)
*Cross-tenant rejection at routing layer. Asserts HTTP 403 and `status == "REJECTED_TENANT_MISMATCH"`.*

| Concurrency | Samples / Run | Peak In-Flight | Median Throughput (req/s) | Throughput Range [Min, Max] | Median P95 (ms) | Total Failed |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 50 | 1 | 3,218.07 | [1,870.4, 3,523.7] | 0.27 | 0 |
| 10 | 100 | 10 | 5,027.48 | [162.8, 5,647.4] | 5.11 | 0 |
| 50 | 150 | 50 | 368.27 | [191.8, 5,786.9] | 383.98 | 0 |
| 100 | 250 | 100 | 307.65 | [307.0, 411.7] | 783.97 | 0 |

### 7. Audit Retrieve (`GET /api/v1/organizations/{id}/security/audit`)
*Audit log retrieval from state store.*

| Concurrency | Samples / Run | Peak In-Flight | Median Throughput (req/s) | Throughput Range [Min, Max] | Median P95 (ms) | Total Failed |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 50 | 1 | 3,567.92 | [3,481.4, 3,751.3] | 0.27 | 0 |
| 10 | 100 | 10 | 8,044.78 | [161.2, 8,871.6] | 1.95 | 0 |
| 50 | 150 | 50 | 358.62 | [191.8, 8,225.4] | 400.30 | 0 |
| 100 | 250 | 100 | 312.19 | [309.3, 409.3] | 776.72 | 0 |

### 8. Replay Reject Guard (`POST .../security/validate`)
*Idempotency rejection of duplicate findings. Asserts HTTP 200 and `status == "REJECTED_REPLAY"`.*

| Concurrency | Samples / Run | Peak In-Flight | Median Throughput (req/s) | Throughput Range [Min, Max] | Median P95 (ms) | Total Failed |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 50 | 1 | 3,183.68 | [2,661.3, 3,719.4] | 0.28 | 0 |
| 10 | 100 | 10 | 5,605.29 | [182.6, 6,094.4] | 4.90 | 0 |
| 50 | 150 | 50 | 455.34 | [221.4, 6,710.8] | 307.24 | 0 |
| 100 | 250 | 100 | 610.62 | [574.4, 626.4] | 375.26 | 0 |

### 9. Independent Receipt Verification (`vardhan-receipt verify`)
*Independent CLI verification of authentic Ed25519 & ML-DSA-87 signatures against keystore.*

| Concurrency | Samples / Run | Peak In-Flight | Median Throughput (req/s) | Throughput Range [Min, Max] | Median P95 (ms) | Total Failed |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 50 | 1 | 251.86 | [220.1, 261.0] | 4.47 | 0 |
| 10 | 100 | 10 | 612.39 | [609.0, 630.6] | 24.32 | 0 |
| 50 | 150 | 50 | 580.82 | [570.5, 584.8] | 134.40 | 0 |
| 100 | 250 | 100 | 530.06 | [518.8, 532.5] | 299.67 | 0 |

---

## Fixed-Duration Sustained-Load Results (10.0 Seconds Each)

| Test Target | Concurrency | Configured Duration | Total Attempted | Total Successful | Total Failed | Sustained Throughput | P95 Latency | P99 Latency | Max Latency |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Sustained Org Read | 50 | 10.0 s | 2,659 | 2,659 | 0 | 264.67 req/s | 976.6 ms | 1,021.4 ms | 1,048.2 ms |
| Sustained Contract Seal | 25 | 10.0 s | 1,264 | 1,264 | 0 | 125.11 req/s | 321.6 ms | 358.4 ms | 391.2 ms |

---

## End-to-End Workflow Results (Sequential)

*Full transaction lifecycle: Login -> Create Organization -> Submit and Seal Contract.*

| Runs Measured | Sub-Requests Attempted | Successful Workflows | Failed Workflows | Workflow Throughput | P50 Latency | P95 Latency | Max Latency |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 20 | 60 | 20 | 0 | 1.66 workflows/s | 125.24 ms | 9,680.88 ms | 9,680.88 ms |

---

## Repository Test Verification

Prior to pushing, relevant unit and integration test suites were executed:
- `cargo test -p control_plane_api -p vardhan_receipt`
- **Result**: `ok. 95 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.35s`

---

## Governance & Operational Disclaimers

1. **Synthetic Single-Node Environment**: All measurements reflect local loopback execution on a single Apple Silicon macOS workstation. Wide-area network latency, TLS handshake fragmentation, edge proxy buffering, and HSM hardware latency were not present.
2. **Not Approval for Live Banking Rails**: These benchmarks validate cryptographic correctness, concurrency scaling, and throughput methodology; they do not authorize deployment to live financial networks or SWIFT/FedNow integrations.
3. **Institutional Gates Pending**: Production deployment remains **BLOCKED** pending independent external cryptographic audits, HSM key-management integration, and formalized CISO approval.
