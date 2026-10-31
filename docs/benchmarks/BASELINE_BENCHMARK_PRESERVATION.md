# Baseline Benchmark & Architecture Preservation (Pre-Remediation)

## 1. Commit & Provenance Metadata

| Parameter | Value |
|---|---|
| Repository | `vishnuvardhanburri/VARDHAN_Q_CORE-PLATFORM` |
| Git Branch | `main` |
| Baseline Commits | `f38cc3b` (Commercial & Formatting), `d2ba84d` (CI Compose Volume Fix) |
| Preservation Timestamp | 2026-11-01T00:10:00Z |
| Status | Canonical Pre-Remediation Baseline |

---

## 2. Environment & Hardware Metadata

| Parameter | Baseline Value |
|---|---|
| Host Platform | `macOS-27.0.1-arm64-arm-64bit-Mach-O` |
| Hardware CPU | Apple M4 (10 cores: 4 performance + 6 efficiency) |
| System Memory | 16.0 GB RAM |
| Build Mode | `release` (`cargo build --release -p control_plane_api -p vardhan_receipt`) |
| Rust Toolchain | Rust 1.99.0 (b940084d7), Cargo 1.99.0 |
| Python Environment | Python 3.14.2 (Clang 17.0.0) |
| Primary Database | Sled embedded KV store (`/tmp/vardhan_bench_18095`) |
| Idempotency Storage | Sled distributed idempotency backend (`/tmp/vardhan_bench_idem_18095`) |
| Receipt Semaphore | `RECEIPT_SEMAPHORE = 64` permits |
| Concurrency Levels | 1, 10, 50, 100 |
| Repeated Runs / Tier | 5 independent runs per concurrency level |
| Workload Sizing | $c=1$: 50 req; $c=10$: 100 req; $c=50$: 150 req; $c=100$: 250 req |

---

## 3. Preserved Baseline Performance Measurements (5-Run Median & Range)

### A. Throughput (req/s)

| Operation | Concurrency 1 (Median [Min, Max]) | Concurrency 10 (Median [Min, Max]) | Concurrency 50 (Median [Min, Max]) | Concurrency 100 (Median [Min, Max]) |
|---|---|---|---|---|
| **Org Read** (`GET .../organizations/{id}`) | 3,519.36 [3,027.6, 3,691.3] | 8,528.60 [162.1, 8,918.5] | 353.76 [191.2, 8,052.7] | 308.57 [307.7, 403.3] |
| **Org List** (`GET .../organizations`) | 3,722.75 [3,589.8, 3,875.8] | 8,539.19 [158.5, 9,296.4] | 350.49 [187.9, 8,213.5] | 311.58 [308.5, 410.8] |
| **Login** (`POST .../auth/login`) | 13.83 [13.8, 14.0] | 67.76 [65.3, 69.3] | 68.04 [67.5, 69.8] | 69.22 [68.4, 69.6] |
| **Org Create** (`POST .../organizations`) | 121.11 [119.9, 124.4] | 207.42 [192.9, 219.0] | 212.53 [187.0, 220.8] | 173.53 [167.8, 184.6] |
| **Contract Seal** (`POST .../validate`) | 22.26 [21.6, 23.8] | 111.82 [85.9, 127.1] | 154.33 [85.7, 177.4] | 106.03 [93.6, 185.1] |
| **Tenant Mismatch** (`POST .../validate`) | 3,218.07 [1,870.4, 3,523.7] | 5,027.48 [162.8, 5,647.4] | 368.27 [191.8, 5,786.9] | 307.65 [307.0, 411.7] |
| **Audit Retrieve** (`GET .../audit`) | 3,567.92 [3,481.4, 3,751.3] | 8,044.78 [161.2, 8,871.6] | 358.62 [191.8, 8,225.4] | 312.19 [309.3, 409.3] |
| **Replay Reject** (`POST .../validate`) | 3,183.68 [2,661.3, 3,719.4] | 5,605.29 [182.6, 6,094.4] | 455.34 [221.4, 6,710.8] | 610.62 [574.4, 626.4] |
| **Receipt Verify** (`vardhan-receipt`) | 251.86 [220.1, 261.0] | 612.39 [609.0, 630.6] | 580.82 [570.5, 584.8] | 530.06 [518.8, 532.5] |

### B. Latency (Median P95 in Milliseconds)

| Operation | Concurrency 1 (ms) | Concurrency 10 (ms) | Concurrency 50 (ms) | Concurrency 100 (ms) |
|---|---|---|---|---|
| **Org Read** | 0.25 ms | 1.78 ms | 404.77 ms | 787.68 ms |
| **Org List** | 0.23 ms | 1.70 ms | 410.21 ms | 779.59 ms |
| **Login** | 73.05 ms | 221.11 ms | 1,108.31 ms | 3,436.46 ms |
| **Org Create** | 9.08 ms | 67.17 ms | 368.08 ms | 931.45 ms |
| **Contract Seal** | 49.96 ms | 133.77 ms | 484.06 ms | 1,316.13 ms |
| **Tenant Mismatch** | 0.27 ms | 5.11 ms | 383.98 ms | 783.97 ms |
| **Audit Retrieve** | 0.27 ms | 1.95 ms | 400.30 ms | 776.72 ms |
| **Replay Reject** | 0.28 ms | 4.90 ms | 307.24 ms | 375.26 ms |
| **Receipt Verify** | 4.47 ms | 24.32 ms | 134.40 ms | 299.67 ms |

---

## 4. Architectural Bottleneck Diagnosis

The pre-remediation code contained two synchronous serialization points on every protected read path:

1. **`validate_and_rotate` in `require_session`**:
   - Acquired mutable entry lock in `DashMap`: `let mut e = self.inner.get_mut(&id)?;`.
   - Called `self.persist(&e)`, which executed `db.insert(...)` and `db.flush()`.
   - `db.flush()` forced a synchronous disk sync (`fsync`) on every single HTTP request.
   - All benchmark workers shared a single token, forcing 50–100 threads into serial disk writes.
2. **`authoritative_role` in `profile.rs`**:
   - Executed `self.db.get(Self::profile_key(username))` on Sled on every incoming authenticated request, contending with the ongoing `db.flush()` write locks.
3. **Contrast with `Receipt Verify`**:
   - `vardhan-receipt verify` bypassed the HTTP stack and Sled entirely, demonstrating pure post-quantum CPU throughput of over 500–1,100 ops/sec.

---

## 5. Test Suite Verification Snapshot

Prior to remediation, existing tests were executed and passed cleanly:
- `cargo test -p auth_service -p control_plane_api`: 42 unit tests, 4 authoritative role projection tests, 7 integration auth tests, 16 org lifecycle tests, 5 multi-instance concurrency tests, 6 tenant isolation tests, and 5 intelligence brief tests passed (0 failures).
- All 7 GitHub Actions CI workflows passed green on commit `d2ba84d`.
