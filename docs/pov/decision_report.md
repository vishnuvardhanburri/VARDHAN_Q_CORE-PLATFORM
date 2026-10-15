# VARDHAN Q-CORE — PoV Decision Report

## Decision

**CONDITIONAL — the initial Docker lab is a useful prototype demonstration, but the current results are not yet decision-grade for a buyer or a production claim.**

The initial run reported successful sealing, dual-signature receipt output, selected tampering/replay rejection, independent verification, and restart behavior. However, an audit of the committed test scripts found benchmark-methodology and assertion gaps that require a corrected rerun before the results can be used as formal proof-of-value evidence.

This is a synthetic financial-services scenario aimed at preparing a possible LGT discovery conversation. It is **not an LGT assessment**, does not establish an LGT problem, and does not indicate any endorsement, active project, budget or buyer intent.

## Initial reported observations

| Measure | First-run result | Evidence status |
|---|---:|---|
| Contract sealing, one worker | p50 7.178 ms; p95 8.117 ms | Preliminary per-request latency; repeat with corrected runner |
| Receipt verification, one worker | p50 1.198 ms; p95 1.554 ms | Preliminary per-request latency; repeat with corrected runner |
| Direct CLI baseline, one worker | p50 6.627 ms | Preliminary; paired comparison required |
| Difference between separate c1 medians | 0.551 ms | Arithmetic difference only, not definitive causal HTTP overhead |
| ML-DSA-87 timing | ~6.6 ms for full receipt CLI path | Not an isolated primitive-only measurement; includes subprocess and full validation/sealing work |
| Original security assertions | 20 reported passed | Concurrent duplicate assertion was insufficient; corrected assertions need a fresh run |
| Original requested c100 tests | 50 measured requests | Cannot validate 100 simultaneous in-flight requests |
| Original E2E requested c50 test | 20 measured requests | Cannot validate 50 simultaneous in-flight requests |
| Original throughput claims | Withdrawn | They were not measured from wall-clock run duration |

The corrected benchmark script now uses at least 100 measured requests and at least 10 requests per requested worker by default, performs session setup and warm-up outside the measured window, and writes measured wall-clock throughput plus observed concurrent-request counts. The concurrent replay test now asserts exactly one seal and four replay rejections. These changes have **not yet produced a new measurement set**.

## What is in the lab

- Docker build and local execution for the control-plane API and receipt-engine binaries.
- Synthetic contract submission and validation.
- Ed25519 and ML-DSA-87 signature output, with independent receipt verification.
- Selected negative-input, replay, authentication, tenant and audit tests.
- Raw result artifacts from the original run.
- A corrected follow-up test harness for throughput, concurrency and duplicate-submission assertions.

## Material limitations

The current PoV environment is a single Docker service. Documented limitations include plaintext HTTP, file-based single-node idempotency, static tenant provisioning, no demonstrated multi-node replay coordination, and incomplete production key-management, backup/recovery, rate-limiting and operational controls. Tenant isolation across route identity and payload identity must be tested explicitly before making a broad claim.

See limitations and remediation for details.

## Required evidence before the next gate

1. Run the corrected suite on a clean checkout and save timestamped logs and JSON.
2. Verify the measured request count, observed concurrency, wall-clock throughput, latency percentiles, failures, CPU/memory and host/Docker configuration.
3. Run and assert the restart-persistence scenarios in a reproducible test path, not only as manually reported checks.
4. Ensure all tests return a failing process status when assertions or benchmark groups fail.
5. Reconcile the acceptance matrix; it lists 28 criteria, not 26.
6. Review failures and limitations; do not weaken thresholds or suppress errors to obtain a pass.
7. Keep the external claim limited to what the lab actually demonstrates.

## Recommended classification

**Suitable for further lab validation after the corrected rerun. Not yet suitable to describe as production-ready, independently assured, certified, or validated against LGT requirements.**

A qualified buyer conversation must independently confirm the problem, impact, sponsor, environment access, acceptance criteria and procurement path before this lab can become a paid PoV proposal.
