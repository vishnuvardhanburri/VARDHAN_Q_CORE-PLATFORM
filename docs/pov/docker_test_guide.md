# Docker Test Environment Guide

## Purpose

This local, synthetic financial-services PoV exercises the available VARDHAN Q-CORE control-plane and receipt-engine binaries. It is not an LGT assessment. Use synthetic data only; do not point this environment at LGT or any third-party system.

## Prerequisites

- Docker with enough CPU, memory, and disk for the multi-stage Rust build.
- A shell environment capable of running the repository scripts.
- The exact source commit recorded with each run.

The first benchmark used Docker Desktop on macOS arm64, Rust 1.98, and Python 3.11 in Debian Bookworm. CPU model, RAM and Docker resource limits were not included in the original report, so they must be recorded for the corrected run.

## Quick start

```bash
cd scripts/qcore-pov
./run.sh
```

The runner builds the image, starts the local service, waits for health, runs security tests and benchmarks, saves timestamped logs and raw JSON, then removes the container. The updated runner no longer suppresses security/performance/crypto process failures; it exits non-zero if any test or benchmark process fails.

The updated performance runner uses a minimum of 100 requests and at least 10 measured requests per requested worker by default. Settings can be changed through QCORE_BENCH_MIN_REQUESTS, QCORE_BENCH_REQUESTS_PER_WORKER, QCORE_BENCH_MIN_E2E_REQUESTS, and QCORE_BENCH_WARMUP_REQUESTS. Smaller values can invalidate the intended concurrency test and should not be used for buyer evidence.

## Results

Timestamped artifacts are saved under scripts/qcore-pov/results, including security test JSON, performance JSON, crypto JSON, and logs. Review actual exit codes and counts. A Docker image build or unrelated green CI workflow does not prove that the PoV assertions passed.

The corrected performance results include measured run duration, requests per second, successful requests per second, and maximum concurrent requests observed. Do not infer throughput from nominal concurrency divided by p50 latency.

Each run also writes an environment metadata file and a Docker stats time series (CPU, memory, network I/O, block I/O, and process count) under the results directory. These artifacts accompany the exact timestamped raw JSON and logs.

## Security and operational limitations

- The current configuration is for a local development lab and uses plaintext HTTP.
- Tenant registry behavior is static; API route-to-payload tenant binding must not be assumed without an explicit test.
- File-based idempotency is single-node only.
- The local lab does not establish production TLS/mTLS, KMS/HSM, distributed replay protection, high availability, disaster recovery, independent security assessment, or regulatory compliance.

See the PoV threat model, security results, performance benchmark results, limitations/remediation, and acceptance matrix before interpreting the test output.
