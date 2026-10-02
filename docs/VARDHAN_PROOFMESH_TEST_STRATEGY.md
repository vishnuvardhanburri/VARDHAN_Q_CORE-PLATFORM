# Vardhan ProofMesh: Test Strategy

## 1. Goal
Maximize development speed through parallelization and intelligent execution while guaranteeing that **speed never reduces mandatory security evidence**. 

## 2. Test Execution Principles
- **Isolation over Serialization**: Do not solve resource conflicts (e.g. port binding) by serializing the entire workspace. Default to concurrent execution using ephemeral ports (`127.0.0.1:0`) and unique temporary directories per process.
- **Process Isolation**: Rely on mature execution systems like `cargo-nextest` to guarantee robust process isolation out-of-the-box.
- **Explicit Concurrency Limits**: Control resource-intensive testing (e.g., Heavy Raft, PQ Crypto) via explicit concurrency bounding, not global serialization.

## 3. Failure Handling & Classification
- A failure is never silently retried into a pure `PASS`.
- `FIRST FAIL` + `RETRY PASS` = `FLAKY` / Infrastructure-dependent.
- All meaningful failures are translated into a Replay Capsule by the Vardhan Replay Engine (VRE).
- **Classification Buckets**: PRODUCT_FAILURE, SECURITY_FAILURE, TEST_FAILURE, FLAKY, RESOURCE_COLLISION, ENVIRONMENT_FAILURE, INFRASTRUCTURE_FAILURE, TIMEOUT, DETERMINISM_FAILURE, UNKNOWN.

## 4. Evidence Quorum (VEQ)
10,000 unit tests passing do not compensate for 1 missing mandatory security test. ProofMesh defines a claim as verified only if the distinct *classes* of mandatory evidence (e.g., real network, PQ auth, AEAD, replay, invariant) are successfully collected.

## 5. Adaptive Escalation
The strategy is dynamic. If a standard integration test experiences abnormal timing, ProofMesh elevates the evidence requirement automatically: it can route the test to Fault Injection, capture the trace, minimize the scenario deterministically, and push deeper verification without human intervention.
