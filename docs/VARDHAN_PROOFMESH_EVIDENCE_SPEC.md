# Vardhan ProofMesh: Evidence Specification

## 1. Concept
In ProofMesh, the final output of verification is an Evidence Object. Evidence must be **content-addressed** using cryptographic hashing, structured as a Merkle/DAG relationship.

## 2. Canonical EvidenceObject Schema
At a minimum, every generated piece of evidence must contain:

```json
{
  "verification_id": "uuid",
  "claim_id": "string",
  "source_commit": "sha256",
  "artifact_digest": "sha256",
  "test_digest": "sha256",
  "environment_digest": "sha256",
  "execution_plan_digest": "sha256",
  "scheduler_version": "string",
  "executor_version": "string",
  "policy_version": "string",
  "seed": "u64",
  "trace_digest": "sha256",
  "result": "enum(PASS, FAIL, INCONCLUSIVE)",
  "classification": "enum(SECURITY_FAILURE, FLAKY, ...)",
  "timestamps": {
    "started_at": "iso8601",
    "completed_at": "iso8601"
  },
  "parent_evidence": ["sha256"],
  "replay_reference": "uuid",
  "signature": "crypto_signature"
}
```

## 3. Evidence Diversity
Claims are only resolved when the aggregate graph of Evidence Objects satisfies the overarching policy (e.g., must contain one `LOCAL` integration evidence + one `DISTRIBUTED` network evidence). 

## 4. Preservation
Verification Memory mandates that evidence of failures (and flaky tests) is never deleted or overwritten by a subsequent successful retry. The original failure evidence is retained alongside the replay reference for historical analysis by L1 Enterprise Intelligence.
