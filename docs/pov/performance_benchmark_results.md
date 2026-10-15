# Performance Benchmark Results

## Evidence status

**The numbers from the first run are preliminary and must not be presented as validated c100 throughput or buyer acceptance results.** The committed benchmark script in that run submitted only 50 requests to the c100 cases and 20 requests to the E2E c50 case. A workload cannot have 100 simultaneous in-flight requests when only 50 requests exist in that test batch, and the E2E c50 batch could have at most 20 simultaneous requests.

The first report also published throughput values derived from nominal concurrency divided by p50 latency rather than measured as completed requests divided by elapsed wall-clock duration. **Those throughput values are withdrawn.** The corrected script now uses a measured workload sized to at least 10 requests per worker (100 requests minimum by default), excludes session setup and warm-up from the measured window, and records elapsed duration, observed maximum active requests, total throughput, and successful throughput. A fresh run is required to produce authoritative results.

## Environment reported for initial run

| Parameter | Initial report |
|---|---|
| Docker | Docker Desktop on macOS arm64 |
| Runtime | Rust 1.98; Python 3.11 on Debian Bookworm |
| Request sample | 50 per case; 20 for original E2E |
| Warm-up | 3, but session-backed warm-up overlapped measured requests in the initial implementation |
| CPU model / physical cores | Not recorded in the initial report |
| Host RAM / Docker Desktop memory allocation | Not recorded in the initial report |
| Container CPU and memory limits | Not recorded in the initial report |
| Exact corrected-run source SHA and UTC timestamp | Pending rerun |

A report intended for customer evaluation must include the source commit, UTC timestamp, CPU model/core count, RAM, OS, Docker version/resources, container limits, exact commands, run duration, and raw result file hashes.

## First-run per-request readings (historical, provisional)

These are copied from the initial raw JSON. The values are latency samples, not validated sustainable throughput measurements.

### Contract sealing through protected HTTP API — 1 KB payload

| Requested concurrency | Requests measured | p50 | p95 | p99 | Initial interpretation |
|---:|---:|---:|---:|---:|---|
| 1 | 50 | 7.178 ms | 8.117 ms | 10.790 ms | Preliminary single-worker latency |
| 10 | 50 | 16.318 ms | 25.729 ms | 33.062 ms | 50 requests across 10 workers |
| 50 | 50 | 33.845 ms | 48.791 ms | 50.414 ms | One request per requested worker; short load sample |
| 100 | 50 | 36.158 ms | 56.383 ms | 59.753 ms | **Not a c100 validation**; only 50 requests were available |

The initial report also recorded p50 sealing readings of 7.423 ms for the 10 KB payload and 7.339 ms for the 100 KB payload at c1. Those need to be regenerated under the corrected runner before use as final results.

### Receipt verification — first run

| Requested concurrency | Requests measured | p50 | p95 | p99 | Initial interpretation |
|---:|---:|---:|---:|---:|---|
| 1 | 50 | 1.198 ms | 1.554 ms | 1.643 ms | Preliminary single-worker latency |
| 10 | 50 | 5.932 ms | 10.355 ms | 11.454 ms | 50 requests across 10 workers |
| 50 | 50 | 10.540 ms | 19.797 ms | 20.999 ms | Short load sample |
| 100 | 50 | 10.654 ms | 18.706 ms | 22.125 ms | **Not a c100 validation** |

### Login and audit retrieval — first run

| Operation | Requested concurrency | Requests measured | p50 | p95 | p99 |
|---|---:|---:|---:|---:|---:|
| Login | 1 | 50 | 68.716 ms | 69.329 ms | 70.956 ms |
| Login | 10 | 50 | 139.946 ms | 274.668 ms | 299.926 ms |
| Login | 50 | 50 | 482.858 ms | 747.059 ms | 750.531 ms |
| Login | 100 | 50 | 495.809 ms | 777.868 ms | 790.627 ms |
| Audit retrieval | 1 | 50 | 0.264 ms | 0.312 ms | 0.411 ms |
| Audit retrieval | 10 | 50 | 2.936 ms | 8.489 ms | 9.068 ms |
| Audit retrieval | 50 | 50 | 6.923 ms | 10.019 ms | 12.800 ms |
| Audit retrieval | 100 | 50 | 3.443 ms | 8.742 ms | 9.442 ms |

Cases labelled c100 above had at most 50 active requests, not 100. These first-run values do not support a claim of sustainable c100 capacity.

### E2E submit + seal + independent receipt verification — first run

| Requested concurrency | Requests measured | p50 | p95 | p99 | Initial interpretation |
|---:|---:|---:|---:|---:|---|
| 1 | 20 | 8.401 ms | 9.715 ms | 9.715 ms | Session setup and login are outside timed path |
| 10 | 20 | 17.319 ms | 29.292 ms | 29.292 ms | Only two requests per worker on average |
| 50 | 20 | 24.991 ms | 34.453 ms | 34.453 ms | **Not a c50 validation**; at most 20 requests in the batch |

The E2E timer covers submission/sealing and independent receipt verification. Login and session creation happen before the timed operations; do not describe these measurements as a complete user journey including login.

## HTTP-vs-CLI comparison

The initial p50 readings were 7.178 ms for the HTTP sealing path and 6.627 ms for the direct CLI baseline, a numerical difference of 0.551 ms. This is not yet a definitive measurement of HTTP-only overhead because the two paths were measured separately and should be compared under matched input, concurrency, duration, warm-up, and host-resource conditions. The old value of approximately 1.5 ms in other report text was arithmetically inconsistent with these two medians and is withdrawn.

The corrected run must publish matched results and show both absolute and percentage differences. At higher load, the old figures diverged materially (for example, the requested c100 HTTP run reported 36.158 ms p50 while the direct CLI run reported 20.040 ms), which cannot be summarized as a universal 0.6 ms overhead.

## Cryptographic measurement scope

- Ed25519 sign/verify timings were measured directly through a cryptography library in Python.
- The reported ML-DSA-87 “sign” timing measures the full receipt-engine validate-canonical subprocess path. It includes process startup and other command work; it is **not** an isolated ML-DSA-87 primitive benchmark.
- The reported ML-DSA-87 verification timing measures the full receipt verification subprocess path; it is not a primitive-only timing.
- BLAKE3 measurements are direct library microbenchmarks, not end-to-end receipt latency.

Do not compare direct Ed25519 primitive timings to full ML-DSA command timings as though they measure identical work. The updated report should preserve this scope distinction.

## Corrected rerun requirements

The corrected benchmark JSON should include, per case:

- requested and observed concurrency;
- requested and completed measured requests;
- p50, p95, p99, minimum, mean, and maximum latency;
- elapsed wall-clock duration;
- total requests/second and successful requests/second;
- success, failure and warm-up-failure counts;
- payload size, run identifier, source commit and timestamp;
- host and container resource metadata in the linked run metadata file.

The runner must fail if any required measured request fails. Throughput is calculated from completed requests over measured wall-clock duration—not inferred from nominal concurrency and median latency.

## Current conclusion

The first run suggests that single-worker sealing is in the single-digit-millisecond range in that particular local environment. Treat even that as preliminary until a clean corrected run reproduces it. No valid sustainable-throughput or c100 capacity claim is currently available from the initial benchmark set.
