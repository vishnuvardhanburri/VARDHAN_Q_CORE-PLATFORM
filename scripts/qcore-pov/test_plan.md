# PoV Validation Plan — Synthetic Financial-Services Workflow

## Status

The initial Docker run reported passing security and performance results, but a review found invalid concurrency sample sizes, throughput inferred from p50 rather than measured wall-clock time, suppressed runner exit codes, and a concurrent-duplicate assertion that did not check the outcome distribution. A follow-up branch corrects these issues and adds route-to-payload tenant binding. **The corrected Docker suite has not yet been rerun; all corrected outcomes remain pending.**

This is a synthetic financial-services test case. LGT is only a prospective account hypothesis: there is no verified LGT requirement, use case, internal weakness, project, budget or buyer intent. The prior expansion “Logistics Gateway Trust” was invented and is withdrawn.

## Components in the local test

| Component | Role | Boundary |
|---|---|---|
| `control_plane_api` | Local Axum API for authentication and receipt validation | Local HTTP only; no TLS/mTLS claim |
| `vardhan-receipt` | Validates/seals input and verifies receipt evidence | Spawned as a child process for each request |
| Policy / tenant registry | Checks configured actors, policy and tenant | Static development allowlist; dynamic organization creation does not automatically provision this registry |
| Replay/idempotency store | Prevents repeated sealing | Local filesystem state; single-node only |
| Python security/performance/crypto scripts | Exercises assertions and records metrics | Result counts and process exit statuses must be preserved |

## Core workflow

1. Authenticate to the local API and obtain a token.
2. Submit a synthetic contract whose URL tenant matches the contract's organization ID.
3. Validate policy/tenant/actor and seal a receipt through the real receipt-engine binary.
4. Verify receipt evidence independently.
5. Submit invalid hash, unauthorized actor, unknown tenant and malformed inputs.
6. Replay a sealed finding and submit simultaneous duplicates.
7. Deliberately mismatch the URL tenant and payload tenant; require HTTP 403 and `REJECTED_TENANT_MISMATCH`.
8. Retrieve audit evidence and run persistence checks where explicitly automated.

The test uses the pre-registered synthetic tenant. Organization creation is exercised separately, but dynamic provisioning into the policy tenant registry is not claimed as validated.

## Security acceptance tests

The current follow-up harness is expected to record 24 explicit assertions covering setup, valid sealing, sequential replay, hash tampering, unauthorized actor, spoofed actor, tampered receipt signature, unknown tenant, malformed contract, route/payload mismatch, unauthenticated request, concurrent duplicate behavior, audit endpoint access and independent verification.

For five simultaneous submissions using one finding ID and the same tenant route, the corrected test requires exactly one SEALED response and four REJECTED_REPLAY responses. A response count alone is insufficient.

A fresh run must show all 24 assertions passed, zero failed, the exact source SHA, and raw JSON/log evidence. These are expected criteria, not a claim of current success.

## Performance protocol

- Concurrency levels: 1, 10, 50, 100.
- Default sample size: at least 100 measured requests and at least 10 requests per worker; E2E follows the same requirement.
- Session setup and warm-up must finish before the measured interval begins.
- Latency: min, mean, p50, p95, p99, max.
- Throughput: completed requests / measured wall-clock seconds and successful requests / measured wall-clock seconds.
- Observed concurrency: maximum simultaneously active client calls.
- Reliability: successful, failed, missing and warm-up request counts.
- Payload sizing: report actual serialized request-body bytes and whether the requested target was achieved; a mandatory schema can exceed the nominal 1 KB target.
- Resources: record Git HEAD, script checksums, Docker image identity, host OS/CPU/RAM, Docker resource limits and a timestamped Docker CPU/memory/network/block-I/O/PID sample series.
- Baseline: compare equivalent inputs/work under matched concurrency and measurement intervals. Difference between separate p50 readings is not definitive HTTP overhead.

All measurements are lab-specific. Sustained throughput should only be claimed after a long-enough load test with explicit success/latency criteria. The default suite is a repeatable benchmark, not a production capacity certification.

## Cryptographic benchmark interpretation

Ed25519 timings from the Python cryptography library are primitive-level microbenchmarks. ML-DSA-87 timings produced by invoking `vardhan-receipt validate-canonical` and `vardhan-receipt verify` are full subprocess/receipt workflow timings, not isolated ML-DSA primitive timings. The report must keep these measurement scopes separate.

## Not validated by this plan alone

- Production TLS/mTLS or public-network security.
- Dynamic tenant registration and complete route/payload/audit/key tenant isolation.
- Distributed replay rejection across multiple nodes.
- Production key management through KMS/HSM.
- Backup/restore, HA/DR, rate limiting, long-duration endurance and recovery.
- Independent penetration testing, cryptographic review or formal regulatory compliance.
- Any LGT-specific problem, requirement, solution fit, ROI or readiness.

## Decision gate

Treat the current evidence as **CONDITIONAL — further lab validation only** until the corrected Docker run completes and raw results are reviewed. The production release gate remains separate. Even a clean run is evidence for a narrow local workflow only; the buyer must validate the actual problem and acceptance criteria before this becomes a customer PoV.
