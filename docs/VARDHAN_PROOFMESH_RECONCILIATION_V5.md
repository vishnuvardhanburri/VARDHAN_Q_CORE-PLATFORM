# VARDHAN PROOFMESH RECONCILIATION — PASS 5
## Specification Delta Analysis V5 — Final Pre-Freeze Closure

**Document type**: Delta analysis. READ-ONLY against frozen specifications.
**Supersedes**: V4 (`VARDHAN_PROOFMESH_RECONCILIATION_V4.md`)
**Frozen spec references**: All seven frozen pillars at their current HEAD.
**Verification Target SHA**: 4711305797ccb68e19f55124384cf2272b5ff187
**Phase**: 5 — ProofMesh Specification Reconciliation
**Rule**: No frozen specification is modified until this document is reviewed, all contradictions closed, and freeze explicitly authorized.

---

## 1. EvidenceStore Structural Validation (Amendment FA-9)

V4 asserted that `EvidenceStore::append()` performs structural validation, but this invariant was missing from the frozen trait contract.

**Amendment FA-9: `EvidenceStore` Append Invariants**
Target: `VARDHAN_OBJECT_TRAITS` §7.1

The `EvidenceStore::append()` contract is explicitly amended to require the following structural checks before returning `Ok(EvidenceId)`:
1. **Schema Compliance**: The payload strictly matches the schema version.
2. **Tenant Boundary**: `TenantScoped<T>` bounds map consistently.
3. **Config Freshness**: `config_hash` matches the current effective configuration.
4. **Signature Validity**: The ML-DSA-87 signature is cryptographically valid over the canonical bytes.

This explicitly codifies these invariants natively in the ledger ingestion path, eliminating the need to repurpose the `AssuranceEngine::g0_check()` for verification evidence.

---

## 2. RunRecord / Evidence Commit Ordering

V4 proposed an unsafe ordering that could allow an authoritative `VerificationRunRecord` to point to an uncommitted `EvidenceRecord`.

**Resolution**: The commit sequence is formally defined as:
```text
VerificationEvidenceProducer
        ↓
EvidenceStore.append()
        ↓
EvidenceStore.commit_batch()
        ↓
EvidenceRecord = RAFT_COMMITTED
        ↓
VerificationRunRecord references committed EvidenceId
        ↓
StateStore.apply(StateTransitionRecord)
        ↓
VerificationRunRecord = RAFT_COMMITTED
```

**Invariant Enforced**: Authoritative state (`VerificationRunRecord` in L04) MUST reference already-committed evidence (in L03). An orphaned evidence record after a crash is acceptable; authoritative state pointing to uncommitted evidence is a violation of state-tier semantics.

---

## 3. Quorum Membership Determinism

V4's `sort_by(EvidenceId)` guaranteed serialization determinism, but left membership determinism vulnerable to local node observation prefixes.

**Resolution**:
An explicit canonical observation boundary is added to `EvidenceQuorumSnapshot`:
```rust
pub struct EvidenceQuorumSnapshot {
    pub as_of_commit_index: CommitIndex,  // Canonical observation boundary
    pub quorum_entries: Vec<QuorumEntry>, // dedup + EvidenceId sort
    // ...
}
```

**Membership Invariant**:
Eligible evidence is defined strictly as:
* VERIFICATION `EvidenceRecord`
* For the target `VerificationClaim`
* With `commit_index <= as_of_commit_index`
* Satisfying policy scope/config

The snapshot membership is derived deterministically from this canonical committed prefix. Sorting provides serialization determinism; the `as_of_commit_index` provides membership determinism across all distributed nodes.

---

## 4. PolicyEvaluation Schema Migration (FA-7 Refinement)

Replacing `candidate_hash` with an `EvaluationSubject` enum changes the canonical bytes and invalidates existing signatures if not properly versioned.

**Resolution**:
The FA-7 amendment explicitly requires a `schema_version` increment and formal migration mapping:

```rust
pub struct PolicyEvaluation_vNext {
    pub subject_ref: EvaluationSubject, // Replaces candidate_hash
    pub input_state_hash: StateHash,
    pub schema_version: SchemaVersion,  // Incremented (e.g., 2.0.0)
    // ...
}
```

**Canonical Mapping for Legacy Data**:
```text
legacy candidate_hash
        →
EvaluationSubject::DecisionCandidate(candidate_hash)
```
This preserves the canonical evolution of the object. Hashes and signatures for `v1.0.0` objects remain intact, and `vNext` securely accommodates Plan Approval, Quorum Evaluation, and Claim Certification.

---

## 5. Systemic A7 Invariants (FA-8 Refinement)

V4 informally described the A7 verification trace as "cryptographically equivalent." FA-8 is refined to provide exact, check-by-check structural invariants turning the verification path into a formally defined A7 variant.

**A7 Validation Matrix**:

| A7 Check | Business Path | Verification Path |
| :--- | :--- | :--- |
| **authorization validity** | `Authorization` | `Authorization` |
| **policy validity** | `PolicyEvaluation` | `PolicyEvaluation` |
| **state/config freshness** | `DecisionTwin` / state | `VerificationClaim` / state |
| **assurance prerequisite** | G0-G4 Assurance | Verification Plan Policy Approval |
| **target binding** | Action / `DecisionTwin` | `FaultScenario` / `VerificationClaim` |
| **execution idempotency** | `ExecutionIdempotencyKey` | `ExecutionIdempotencyKey` |
| **tenant boundary** | `TenantScoped` | `TenantScoped` |

This matrix explicitly defines the prerequisites the `VardhanAuthorityGate` must enforce when evaluating an `Authorization` with `action_type = SYSTEMIC_FAULT_INJECTION`.

---

## 6. Complete Amendment & Dependency Matrix (The Freeze Set)

V4 omitted the broader architectural dependencies. The complete and authoritative freeze set encompasses the FA amendments AND the corresponding component updates.

### Core Spec Amendments (FA-1 through FA-9)
| ID | Target Specification | Change |
| :--- | :--- | :--- |
| **FA-1** | `VARDHAN_ARCHITECTURE_CONSTITUTION` & `TRAITS` | Reserved `TenantId::PLATFORM`/`GLOBAL` constants; INVARIANT-PM-001. |
| **FA-2** | `VARDHAN_CANONICAL_OBJECT_SPEC` & `TRAITS` | `EvidenceCategory::VERIFICATION` enum variant. |
| **FA-3** | `VARDHAN_CANONICAL_OBJECT_SPEC` | `EvidencePayload` sum type + cross-field validation invariant. |
| **FA-4** | `VARDHAN_CANONICAL_OBJECT_SPEC` & `TRAITS` | `PolicyType::EVIDENCE_POLICY` + `PolicyContextKind` variants. |
| **FA-5** | `VARDHAN_CANONICAL_OBJECT_SPEC` | `ActionType::SYSTEMIC_FAULT_INJECTION`. |
| **FA-6** | `VARDHAN_OBJECT_TRAITS` | `EvidenceStore::verification_tree()` Merkle integration. |
| **FA-7** | `VARDHAN_CANONICAL_OBJECT_SPEC` | `PolicyEvaluation` vNext with `EvaluationSubject` and migration mapping. |
| **FA-8** | `VARDHAN_OBJECT_TRAITS` | `VardhanAuthorityGate` (A7) verification path invariants matrix. |
| **FA-9** | `VARDHAN_OBJECT_TRAITS` | `EvidenceStore::append()` structural invariants. |

### Subsystem Dependencies
| Target Specification | Update Required |
| :--- | :--- |
| `VARDHAN_CANONICAL_OBJECT_SPEC` | Define the 7 new ProofMesh canonical objects (Claim, Plan, RunRecord, Capsule, QuorumSnapshot, Finding, Scenario). |
| `VARDHAN_STATE_MACHINES` | 2 new state machines: `VerificationClaim` and `ExecutionPlan` dataflows. |
| `VARDHAN_TEST_CONTRACTS` | 9 new T-PM-* dataflow and invariant test contracts. |
| `VARDHAN_OBJECT_TRAITS` | 3 new traits: `VerificationEvidenceProducer`, `EvidenceSigner`, `ReplayEngine`. |
| `VARDHAN_AI_INTELLIGENCE_DESIGN` | Register `VerificationScheduler` as an Intelligence Plane component. |
| `VARDHAN_SYSTEM_MAP` | ProofMesh component placement alongside Control Plane. |

All items in this document are ready for final architectural authorization. No further reconciliation iterations are required.
