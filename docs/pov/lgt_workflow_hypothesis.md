# Prospective LGT Account — Synthetic Financial-Services Workflow Hypothesis

## Status and scope

**This is an internal lab hypothesis, not an assessment of LGT.** No direct evidence is available here that LGT has this problem, uses this workflow, has a relevant project or budget, or wants to evaluate VARDHAN Q-CORE.

The test scenario is synthetic. It does not use LGT data, endpoints, credentials, architecture, requirements, or incidents. The earlier phrase “Logistics Gateway Trust” was an invented expansion and is withdrawn; it should not be used to describe LGT.

## Problem hypothesis to validate with a buyer

Some financial-services teams may need stronger, independently verifiable evidence that a high-consequence event or finding:

- was issued by an authorized workload;
- belongs to an expected tenant and policy context;
- has not been modified or replayed;
- produces a receipt that can be verified outside the service that created it; and
- leaves evidence that can be retrieved for audit or incident review.

Whether this is a material problem for any specific organization—and whether Q-CORE addresses it better than the existing stack—must be established through buyer discovery.

## Lab workflow

The synthetic workflow submits a financial-services-style finding contract to the local Q-CORE control-plane API, exercises validation and receipt sealing, checks selected invalid/replay submissions, and invokes receipt verification independently.

The intended lab stack includes the real available Rust control-plane and receipt-engine binaries. The test container is a single-node development environment. The reported configuration uses plaintext local HTTP, a static tenant registry, and file-based idempotency state. These limitations are material.

Synthetic example hostnames use reserved .invalid names and must never be replaced with LGT endpoints or real customer data for this test.

## Initial run — observations, not final acceptance

The first report recorded the following results, which remain **provisional until the corrected harness is rerun**:

- Contract sealing: reported p50 7.178 ms at one worker, with the initial 50-request sample.
- Receipt verification: reported p50 1.198 ms at one worker.
- The first report compared 7.178 ms through the HTTP API with 6.627 ms for a direct CLI baseline, a difference of approximately 0.551 ms. Those were separate measurements, not a fully controlled paired experiment, so this is not yet a definitive causal HTTP-overhead estimate.
- The initial “c100” suites used only 50 measured requests; they could not exercise 100 simultaneous in-flight requests. The initial E2E “c50” suite used only 20 requests. Those labels do not validate the named concurrency levels.
- Earlier throughput values were inferred from nominal concurrency and median latency, not computed from total measured run duration. Those throughput claims are withdrawn pending rerun.
- The initial security script reported 20 passing assertions, but its concurrent-duplicate check only verified that five responses existed; it did not assert the stated one-sealed/four-rejected outcome. The script has now been changed to assert these outcomes explicitly. The updated 22-assertion run is pending.
- The initial report metadata listed 2025-10-15, while other embedded data has later timestamps. The execution date and tested source revision should be confirmed from a fresh timestamped run before the evidence pack is shared externally.

See the performance benchmark results, security test results, and acceptance criteria for audit qualifications.

## What the lab does not establish

These tests do not establish that:

- LGT has the hypothesized problem or has confirmed the workflow;
- the platform is production-ready or suitable for a regulated deployment;
- the platform complies with SOX, PCI DSS, DORA, or any other specific legal or regulatory obligation;
- tenant isolation is complete across API routes, payloads, keys, audit records, and dynamically provisioned organizations;
- replay protection is distributed across multiple nodes;
- transport, key management, backup/recovery, HA/DR, rate limiting, or operational monitoring are production-secure;
- cryptography or the full architecture has been independently reviewed; or
- the implementation has independently proven ROI.

Relevant legal, regulatory and control frameworks must be mapped to the actual buyer entity, service and jurisdiction by qualified owners. The presence of cryptographic receipts alone is not a compliance claim.

## Next decision gate

1. Run the corrected security and performance harness from a clean checkout.
2. Capture the exact source SHA, test timestamp, host/CPU/RAM, OS, Docker resource limits, raw results, measured duration, throughput and observed concurrency.
3. Investigate every failed assertion or benchmark group; do not waive failures simply to reach a pass.
4. Present the results as a local lab demonstration with explicit limits.
5. Ask a relevant buyer whether a specific workflow and control gap actually exists before preparing a paid discovery proposal.
