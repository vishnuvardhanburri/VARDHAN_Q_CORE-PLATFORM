# VARDHAN PROOFMESH RECONCILIATION — PASS 4
## Specification Delta Analysis V4 — Closing Final Blockers

**Document type**: Delta analysis. READ-ONLY against frozen specifications.
**Supersedes**: V3 (`VARDHAN_PROOFMESH_RECONCILIATION_V3.md`)
**Frozen spec references**: All seven frozen pillars at their current HEAD.
**Verification Target SHA**: 4711305797ccb68e19f55124384cf2272b5ff187
**Phase**: 5 — ProofMesh Specification Reconciliation
**Rule**: No frozen specification is modified until this document is reviewed, all contradictions closed, and freeze explicitly authorized.

---

## 0. V3 Corrections & Terminology Log

The following structural corrections from the V3 review are explicitly applied:

1. **Authority Clarification**: The `PolicyEngine` is the single *policy-evaluation mechanism*. The `VardhanAuthorityGate` (A7) remains the *sole execution authority*. V3 incorrectly conflated policy evaluation with authority.
2. **Canonical Policy Ratios**: `max_common_mode_ratio` is changed from floating-point `f64` to a deterministic rational struct: `struct Ratio { pub numerator: u32, pub denominator: u32 }`.
3. **Cross-Field Invariant (EvidencePayload)**: An explicit invariant is added forbidding `evidence_category = VERIFICATION` with `payload = Json(...)`, and forbidding any other category from using `VerificationEvidencePayload`.
4. **Replay Determinism Completeness**: `random_seed` and exact determinism constraints are explicitly seated in the `VerificationRunRecord.test_spec` (see §7).
5. **Canonical Quorum Ordering**: `EvidenceQuorumSnapshot` entries are strictly deduplicated and sorted by `EvidenceId` (see §4).

---

## 1. Architectural Rule: Canonical State vs. Evidence Store

V3 conflated the canonical objects with the `VERIFICATION` Merkle tree. This is corrected via the following explicit architectural rule:

**RULE 0.1a: ProofMesh canonical objects are persisted through the canonical state/persistence mechanism (`StateStore`, L04). The `VERIFICATION` Merkle tree in the `EvidenceStore` (L03) contains ONLY `EvidenceRecord` instances whose `evidence_category` is `VERIFICATION`. Canonical objects and evidence artifacts are distinct.**

**Storage Mapping**:
*   **Canonical State Store (L04)**: `VerificationClaim`, `ExecutionPlan`, `VerificationRunRecord`, `EvidenceQuorumSnapshot`, `VerificationFinding`, `FaultScenario`. These are replicated state objects managed via Raft.
*   **EvidenceStore (L03)**: `EvidenceRecord` (with `category = VERIFICATION`). This forms the cryptographic `VERIFICATION` Merkle tree.

**ClaimRegistry clarification**:
The `ClaimRegistry` is not a persistence authority. It is an application-level semantic wrapper over the `StateStore`. `VerificationClaim` objects are authoritative because they are `StateStore`-committed canonical objects, not because they live in a registry.

---

## 2. Atomicity Model: RunRecord & EvidenceRecord

Because `VerificationRunRecord` (StateStore) and `EvidenceRecord` (EvidenceStore) are persisted in separate systems, atomicity and crash-safety must be formally defined.

**The Commit Sequence**:
1. `EvidenceStore::append(EvidenceRecord)` is called. This validates the record and returns an `EvidenceId`. It is safely idempotent.
2. `VerificationRunRecord` (containing the `EvidenceId`) is constructed.
3. `StateStore::apply(VerificationRunRecord_Transition)` is invoked. This commits the run record via Raft.
4. `EvidenceStore::commit_batch([EvidenceId])` is invoked to formally anchor the evidence to the Raft `commit_index`.

**Crash Safety Invariant**:
If a crash occurs between step 1 and step 3, an unreferenced `EvidenceRecord` exists in the local ledger but is never Raft-committed and never referenced by a canonical `VerificationRunRecord`. It is safely orphaned. A `VerificationRunRecord` is never committed without its corresponding `EvidenceRecord` already written. There is no distributed transaction required; write-ahead ordering ensures integrity.

---

## 3. Structural Validation (Resolving G0 Misattribution)

V3 incorrectly stated that ProofMesh reuses G0 for evidence validation. The frozen `AssuranceEngine::g0_check()` specifically takes a `DecisionCandidate` as input.

**Resolution**:
ProofMesh does NOT invoke `AssuranceEngine::g0_check()`. Instead, the `EvidenceStore::append()` contract is clarified to inherently enforce foundational structural validation for ALL evidence categories, including `VERIFICATION`:
1. Schema compliance
2. Tenant scope binding (`TenantScoped<T>`)
3. `config_hash` freshness
4. ML-DSA-87 signature verification

These are foundational ledger-entry requirements in Vardhan, not exclusive properties of the G0 AI assurance gate. ProofMesh relies purely on `EvidenceStore` structural integrity, completely decoupling from the AI Assurance layer.

---

## 4. Distributed Quorum Determinism

V3's `QuorumAccumulator` depended on local arrival order, breaking distributed consensus determinism.

**Resolution**:
1. `QuorumAccumulator` reads exclusively from the committed `EvidenceStore` state (via `EvidenceStore::wait_for_commit` or similar Raft-aware observers), never from a local uncommitted arrival queue.
2. **Canonical Ordering**: Inside an `EvidenceQuorumSnapshot`, the `quorum_entries: Vec<QuorumEntry>` MUST be deduplicated by `EvidenceId` and strictly sorted by `EvidenceId`.
3. The `content_hash` of the `EvidenceQuorumSnapshot` is therefore mathematically deterministic across all nodes regardless of network propagation jitter.

---

## 5. PolicyEvaluation Schema Amendment

V3 reused `PolicyEngine` but failed to amend the `PolicyEvaluation` object schema to hold verification subjects canonically. The frozen `PolicyEvaluation` expects `candidate_hash` and `input_state_hash` geared towards `DecisionCandidate`.

**Amendment FA-7: `PolicyEvaluation` Schema Generalization**
Target: `VARDHAN_CANONICAL_OBJECT_SPEC` §12.3

```rust
// Replace candidate_hash with a typed enum for the evaluated subject:
pub enum EvaluationSubject {
    DecisionCandidate(ContentHash),           // existing
    ExecutionPlan(ContentHash),               // new (Plan Approval)
    EvidenceQuorumSnapshot(ContentHash),      // new (Quorum Eval)
    VerificationFinding(ContentHash),         // new (Claim Certification)
}

// Updated PolicyEvaluation field:
// ├── subject_ref : EvaluationSubject
```
This allows the existing `PolicyEvaluation` object to canonically represent verification-plane evaluations without corrupting the decision-plane semantics.

---

## 6. A7 Systemic Fault Compatibility

V3 claimed reuse of the `VardhanAuthorityGate` (A7) for `SYSTEMIC_FAULT_INJECTION` but ignored that A7 structurally requires tracing back to a `DecisionTwin` and a finalized assurance context.

**Resolution (Amendment FA-8): A7 Verification Context**
The `VardhanAuthorityGate` contract is amended to support two distinct authorization traces:
1. **Business Execution (Existing)**: `Authorization` → `DecisionTwin` → `AssuranceResult` → `PolicyEvaluation`.
2. **Verification Execution (New)**: `Authorization` (with `action_type = SYSTEMIC_FAULT_INJECTION`) → `FaultScenario` → `VerificationClaim` → `PolicyEvaluation` (Plan Approval).

The A7 validation rules are formally amended to accept path 2 as cryptographically equivalent to path 1. No second gate is created.

---

## 7. Replay Determinism Contract

The exact physical locations of determinism parameters are formally defined within the canonical state:

```rust
pub struct TestSpec {
    pub binary_hash: ContentHash,
    pub args: Vec<String>,
    pub env_hash: ContentHash,
    pub random_seed: u64,                  // explicit PRNG seed
    pub executor_identity: ContentHash,    // binary hash of the executor harness
    pub temporal_controls: TemporalConfig, // mocked clocks, timeout bounds
}
```

This `TestSpec` lives inside `VerificationRunRecord`. A `ReplayCapsule` references this `TestSpec` by hash and explicitly mandates that the `StateSnapshotId` (the exact Raft state at execution time) matches.

---

## 8. Final Status & Updated Freeze Set

All 7 blockers are now resolved.

### Status

| Issue | Status |
|---|---|
| Taxonomy & Terminology | ✅ CLOSED |
| Tenant boundary (Reserved IDs) | ✅ CLOSED |
| Typed evidence payload & Invariant | ✅ CLOSED |
| PolicyEngine duplication avoided | ✅ CLOSED |
| Signing-key boundary (`EvidenceSigner`) | ✅ CLOSED |
| Quorum mutability & Determinism | ✅ CLOSED (Canonical sort, Raft ordered) |
| Canonical object vs Evidence Store | ✅ CLOSED (Strict L04/L03 separation) |
| Atomic persistence | ✅ CLOSED (Write-ahead ordering) |
| ClaimRegistry authority | ✅ CLOSED (L04 StateStore owns authoritative state) |
| G0 reuse | ✅ CLOSED (Store structural validation, not G0) |
| PolicyEvaluation schema | ✅ CLOSED (FA-7: `EvaluationSubject`) |
| Systemic A7 compatibility | ✅ CLOSED (FA-8: Verification trace rules) |

### Freeze Set (Amendments FA-1 through FA-8)

1. **FA-1**: Reserved `TenantId` constants for PLATFORM/GLOBAL.
2. **FA-2**: `EvidenceCategory::VERIFICATION` enum variant.
3. **FA-3**: `EvidencePayload` sum type and cross-field validation invariant.
4. **FA-4**: `PolicyType::EVIDENCE_POLICY` and `PolicyContextKind` variants.
5. **FA-5**: `ActionType::SYSTEMIC_FAULT_INJECTION`.
6. **FA-6**: `EvidenceStore::verification_tree()` Merkle integration.
7. **FA-7**: `PolicyEvaluation::EvaluationSubject` schema generalization.
8. **FA-8**: `VardhanAuthorityGate` systemic-verification trace validation rules.

*This concludes the delta-only audit for ProofMesh Phase 5.*
