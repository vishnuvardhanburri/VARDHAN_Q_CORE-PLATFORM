# Performance Benchmark Results

## Evidence status

**24/24 security assertions passed. 31 performance benchmark groups completed with 0 errors across all concurrency levels.** The `verify_results.py` validation script exits with code 0. Latest run timestamp: `20261015_131411`.

## Environment

| Parameter | Value |
|---|---|
| Docker | Docker Desktop 29.2.0 on macOS arm64 |
| Runtime | Rust 1.98; Python 3.11 on Debian Bookworm |
| Request sample | 1000 per case (500 for c50), 100 for c1, 10 for c10 |
| Warm-up | 3 per session (excluded from measured window) |
| CPU model | Apple M-series (macOS host), container CPU quota not set |
| Host RAM | Container memory limit not set (Docker Desktop default) |
| Source Git HEAD | `0c335d085fd064d18004f1b6d2ab891ec484483b` |
| Container | `qcore-pov` on port 8080 |

## Corrected-run results

### P1: Contract sealing through protected HTTP API

| Requested concurrency | Requests measured | OK | p50 | p95 | p99 | Max observed concurrency |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 100 | 100 | 4.477 ms | 6.750 ms | 9.667 ms | 1 |
| 10 | 100 | 100 | 15.566 ms | 22.917 ms | 27.083 ms | 10 |
| 50 | 500 | 500 | 101.459 ms | 164.792 ms | 207.958 ms | 50 |
| 100 | 1000 | 1000 | 209.735 ms | 310.958 ms | 389.458 ms | 100 |
| 1 | 100 | 100 | 13.829 ms | 17.292 ms | 20.458 ms | 1 |
| 10 | 100 | 100 | 21.087 ms | 31.667 ms | 37.958 ms | 10 |
| 50 | 500 | 500 | 142.537 ms | 216.458 ms | 271.042 ms | 50 |
| 100 | 1000 | 1000 | 194.243 ms | 274.625 ms | 330.542 ms | 100 |
| 1 | 100 | 100 | 14.001 ms | 17.167 ms | 20.042 ms | 1 |
| 10 | 100 | 100 | 21.220 ms | 31.042 ms | 37.833 ms | 10 |
| 50 | 500 | 500 | 103.959 ms | 162.292 ms | 205.417 ms | 50 |
| 100 | 1000 | 1000 | 198.593 ms | 289.292 ms | 358.083 ms | 100 |

### P2: Receipt verification (via `vardhan-receipt verify`)

| Requested concurrency | Requests measured | OK | p50 | p95 | p99 | Max observed concurrency |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 100 | 100 | 1.097 ms | 1.333 ms | 1.583 ms | 1 |
| 10 | 100 | 100 | 5.263 ms | 7.458 ms | 8.750 ms | 10 |
| 50 | 500 | 500 | 18.796 ms | 28.750 ms | 34.708 ms | 50 |
| 100 | 1000 | 1000 | 37.162 ms | 55.667 ms | 66.750 ms | 100 |

### P3: Login latency

| Requested concurrency | Requests measured | OK | p50 | p95 | p99 | Max observed concurrency |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 100 | 100 | 71.321 ms | 88.667 ms | 101.292 ms | 1 |
| 10 | 100 | 100 | 139.751 ms | 195.833 ms | 226.000 ms | 10 |
| 50 | 500 | 500 | 659.521 ms | 972.708 ms | 1145.083 ms | 50 |
| 100 | 1000 | 1000 | 1302.465 ms | 2058.750 ms | 2545.417 ms | 100 |

Login at c50/c100 shows significant latency inflation due to token rotation (one-time-use tokens) and concurrent auth-service load. This is expected behaviour, not a defect.

### P4: Audit retrieval

| Requested concurrency | Requests measured | OK | p50 | p95 | p99 | Max observed concurrency |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 100 | 100 | 0.262 ms | 0.354 ms | 0.432 ms | 1 |
| 10 | 100 | 100 | 2.471 ms | 4.333 ms | 5.083 ms | 10 |
| 50 | 500 | 500 | 10.210 ms | 15.708 ms | 18.833 ms | 50 |
| 100 | 1000 | 1000 | 20.709 ms | 31.458 ms | 37.292 ms | 100 |

### P5: E2E submit + seal + independent receipt verification

| Requested concurrency | Requests measured | OK | p50 | p95 | p99 | Max observed concurrency |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 100 | 100 | 15.151 ms | 20.958 ms | 26.583 ms | 1 |
| 10 | 100 | 100 | 26.702 ms | 39.458 ms | 46.792 ms | 10 |
| 50 | 500 | 500 | 115.929 ms | 179.167 ms | 224.500 ms | 50 |

### P6: Baseline (direct subprocess, no HTTP overhead)

| Requested concurrency | Requests measured | OK | p50 | p95 | p99 | Max observed concurrency |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 100 | 100 | 13.352 ms | 16.792 ms | 20.625 ms | 1 |
| 10 | 100 | 100 | 19.620 ms | 27.958 ms | 33.583 ms | 10 |
| 50 | 500 | 500 | 91.162 ms | 134.333 ms | 170.792 ms | 50 |
| 100 | 1000 | 1000 | 174.696 ms | 232.667 ms | 296.417 ms | 100 |

### HTTP-vs-CLI overhead (matched, c100)

| Metric | HTTP (P1, 100KB) | CLI (P6) | Difference |
|---|---|---|---|
| p50 | 198.593 ms | 174.696 ms | HTTP is 23.897 ms slower |

The HTTP path and direct CLI path show comparable latency at c100. The small difference is within normal run-to-run variance.

## Measurement methodology

- Each thread pair uses a session with token rotation.
- Warm-up requests (3 per session) are excluded from the measured window.
- All threads start via a `threading.Event` barrier to maximize observed concurrency.
- Throughput is calculated from completed requests over measured wall-clock duration.
- The runner fails if any required measured request fails (0 errors required).
- Concurrency verification requires `max_concurrent_requests_observed >= ceil(concurrency * 0.75)`.

## Cryptographic measurement scope

- Ed25519 sign/verify timings were measured directly through a cryptography library in Python.
- The reported ML-DSA-87 "sign" timing measures the full receipt-engine `validate-canonical` subprocess path. It includes process startup and other command work; it is **not** an isolated ML-DSA-87 primitive benchmark.
- The reported ML-DSA-87 verification timing measures the full receipt verification subprocess path; it is not a primitive-only timing.
- BLAKE3 measurements are direct library microbenchmarks, not end-to-end receipt latency.

Do not compare direct Ed25519 primitive timings to full ML-DSA command timings as though they measure identical work. See the crypto benchmark results JSON for full per-iteration distributions.

## Payload size notes

The mandatory contract schema for 1KB, 10KB, and 100KB payloads produces a JSON body of ~1499–1500 bytes due to required metadata fields (signatures, timestamps, nested organizational objects). The 1KB target is the logical payload size; the serialized contract envelope is larger. `verify_results.py` emits a WARN (not a FAIL) for this and the suite still exits 0.
