# PoV Acceptance Criteria — Audit and Current Status

## Status

The original matrix contained **28 rows (AC-01 through AC-28), not 26**. The initial report's “26/26 all pass” summary was incorrect.

The table below distinguishes first-run observations from criteria that the original measurement method did not establish. The corrected harness has been committed on a follow-up branch, but it has **not yet been rerun**. As a result, there is no current all-pass status for the corrected PoV.

Status meanings:

- **Reported / rerun required** — an initial run reported a passing result, but the corrected branch must be run again before relying on it.
- **Invalid measurement** — the method or sample size did not exercise the criterion it claimed to measure.
- **Pending evidence** — no valid reproducible evidence has been collected for the criterion yet.

## Acceptance matrix

| ID | Criterion | First-run observation | Status after audit |
|---|---|---|---|
| AC-01 | Docker image builds | Build reported successful | Reported / rerun required |
| AC-02 | Service starts and health check passes | Health check reported successful | Reported / rerun required |
| AC-03 | Login latency at one worker | p50 68.716 ms in 50 requests | Preliminary; rerun with corrected runner |
| AC-04 | Login latency at 100 concurrent requests | 50 measured requests in the requested c100 run | Invalid measurement: at most 50 requests could be in flight; rerun |
| AC-05 | Contract sealing latency at one worker | p50 7.178 ms in 50 requests | Preliminary; rerun with corrected runner |
| AC-06 | Contract sealing latency at 100 concurrent requests | 50 measured requests in the requested c100 run | Invalid measurement; rerun |
| AC-07 | Independent receipt verification at one worker | p50 1.198 ms in 50 requests | Preliminary; rerun with corrected runner |
| AC-08 | Receipt verification at 100 concurrent requests | 50 measured requests in the requested c100 run | Invalid measurement; rerun |
| AC-09 | Audit retrieval at 100 concurrent requests | 50 measured requests in the requested c100 run | Invalid measurement; rerun |
| AC-10 | End-to-end submit/seal/verify at 50 concurrent requests | 20 measured requests | Invalid measurement for c50; rerun with at least 10 requests per worker |
| AC-11 | Direct CLI baseline at one worker | p50 6.627 ms in 50 requests | Preliminary; matched comparison required |
| AC-12 | Direct CLI baseline at 100 concurrent requests | 50 measured requests in the requested c100 run | Invalid measurement; rerun |
| AC-13 | Valid contract seals with Ed25519 and ML-DSA-87 signature fields | Reported pass | Reported / rerun required |
| AC-14 | Sequential replay is rejected | Reported REJECTED_REPLAY | Reported / rerun required |
| AC-15 | Tampered hash is rejected | Reported rejected | Reported / rerun required |
| AC-16 | Unauthorized actor is rejected | Reported not SEALED | Reported / rerun required |
| AC-17 | Unknown tenant identifier is rejected | Reported not SEALED | Reported / rerun required; route-to-payload tenant binding remains unproven |
| AC-18 | Missing authentication is rejected | HTTP 401 reported | Reported / rerun required |
| AC-19 | Ed25519 signing benchmark | Direct Python cryptography microbenchmark reported | Preliminary; rerun and retain environment metadata |
| AC-20 | Ed25519 verification benchmark | Direct Python cryptography microbenchmark reported | Preliminary; rerun and retain environment metadata |
| AC-21 | ML-DSA-87 signing performance | Full receipt-engine CLI path measured | Criterion is mislabelled as primitive-only signing; relabel as full CLI sealing or add a primitive-only benchmark |
| AC-22 | ML-DSA-87 verification performance | Full receipt-verification CLI path measured | Criterion is mislabelled as primitive-only verification; relabel as full CLI verification or add a primitive-only benchmark |
| AC-23 | BLAKE3 throughput | Direct library measurement reported | Preliminary; rerun and retain environment metadata |
| AC-24 | Receipt verifies after container restart | Reported pass | Pending reproducible restart test in the one-command suite |
| AC-25 | Replay/idempotency state survives restart | Reported pass | Pending reproducible restart test in the one-command suite |
| AC-26 | New contract seals after restart | Reported pass | Pending reproducible restart test in the one-command suite |
| AC-27 | HTTP overhead versus direct CLI baseline | Reported text says ~1.5 ms, while displayed medians (7.178 and 6.627 ms) differ by 0.551 ms | Arithmetic corrected; paired matched rerun required before making an overhead claim |
| AC-28 | Sustained throughput at c100 | Previous documents show inferred values, not measured run throughput | Invalid measurement; corrected runner now records requests/sec over measured wall-clock duration |

## Additional security assertion

The previous S15 concurrency test did not assert the reported response distribution. The corrected test now requires exactly one SEALED response and four REJECTED_REPLAY responses for five concurrent submissions of the same finding ID to the same tenant route, using separate one-time tokens. This produces 22 security assertions in total, assuming the test runs as written; the fresh result is pending.

## Rerun acceptance rule

Do not label this PoV “all pass” until the corrected runner has completed successfully and all applicable criteria have valid evidence. For every result, preserve the source SHA, test timestamp, command, raw JSON/log, host/CPU/RAM information, Docker resource settings, measured request count, observed concurrency, latency percentiles, elapsed duration, throughput and failure count.

No criterion establishes production readiness, regulatory compliance, independent cryptographic assurance or validation against LGT-specific requirements.
