# VARDHAN PROOFMESH RECONCILIATION — PASS 9
## Specification Delta Analysis V9 — Final Type & Serialization Closure

**Document type**: Delta analysis. READ-ONLY against frozen specifications.
**Supersedes**: V8 (`VARDHAN_PROOFMESH_RECONCILIATION_V8.md`)
**Frozen spec references**: All seven frozen pillars at their current HEAD.
**Verification Target SHA**: 4711305797ccb68e19f55124384cf2272b5ff187
**Phase**: 5 — ProofMesh Specification Reconciliation
**Rule**: No frozen specification is modified until this document is reviewed, all contradictions closed, and freeze explicitly authorized.

---

## 1. ActionType Reference Correction (FA-11)

V8 incorrectly referenced `ActionId.action_type` in the state-machine guard, conflating the UUID identifier with the `Authorization` canonical object field that V7 introduced.

**Resolution**
Target: `VARDHAN_STATE_MACHINES` (Authorization Lifecycle)

The Systemic Verification Path Creation Guard is explicitly corrected to validate against the `Authorization` object's properties:

```text
create_verification_authorization(VerificationClaimId, FaultScenarioId, ActionId, PolicyEvalRef)
    Require (RUNTIME VALIDATION INVARIANT):
        - authorization.authorization_context == SystemicVerification
        - authorization.action_type == SystemicFaultInjection
        - VerificationClaim in EVIDENCE_GATHERING state
        - FaultScenario.execution_mode == SYSTEMIC
        - PolicyEvaluation (Plan Approval) PASS
```
*(No property of `ActionId` itself is checked for action types; the type belongs strictly to the `Authorization` object.)*

---

## 2. Exhaustive TransitionType Enum (FA-10)

V8 contained ellipses (`// ...`) which render a Rust enum contract mathematically incomplete. 

**Resolution**
Target: `VARDHAN_CANONICAL_OBJECT_SPEC` & `VARDHAN_OBJECT_TRAITS`

The `TransitionType` enum is made strictly exhaustive. It explicitly covers every frozen canonical transition across the entire Vardhan architecture, plus the 9 ProofMesh variants. No ellipses or catch-all variants are permitted.

```rust
pub enum TransitionType {
    // ── Tenant Lifecycle ──
    CreateTenant,
    UpdateTenant,
    DeleteTenant,
    DeactivateTenant,
    // ── Entity Lifecycle ──
    CreateEntity,
    UpdateEntity,
    DeleteEntity,
    DeactivateEntity,
    ArchiveEntity,
    DeprecateEntity,
    // ── Relationships ──
    CreateRelationship,
    DeleteRelationship,
    // ── Governance & Configuration ──
    ConfigUpdate,
    PolicyCreate,
    PolicyUpdate,
    ConstraintCreate,
    ConstraintUpdate,
    // ── Decision & Assurance ──
    DecisionContextualized,
    DecisionOptionsGenerated,
    DecisionAssessed,
    DecisionPolicyChecked,
    AssuranceResultCreate,
    AuthorizationCreate,
    AuthorizationRevoke,
    ExecutionCreate,
    ExecutionUpdate,
    ObservationCreate,
    // ── Intelligence ──
    ModelProvenanceCreate,
    RiskProfileCreate,
    ScenarioCreate,
    
    // ── ProofMesh Canonical Transitions ──
    VerificationClaimCreate,
    VerificationClaimUpdate,
    ExecutionPlanCreate,
    ExecutionPlanUpdate,
    VerificationRunRecordCreate,
    ReplayCapsuleCreate,
    QuorumSnapshotCreate,
    VerificationFindingCreate,
    FaultScenarioCreate,
}
```

---

## 3. Exhaustive CanonicalObjectRef Enum (FA-10)

V8 similarly contained an ellipsis for canonical object references. 

**Resolution**
Target: `VARDHAN_CANONICAL_OBJECT_SPEC` & `VARDHAN_OBJECT_TRAITS`

The `CanonicalObjectRef` enum is made strictly exhaustive, encompassing exactly the frozen canonical object set and the new ProofMesh set.

```rust
pub enum CanonicalObjectRef {
    // ── Frozen Canonical Objects ──
    Tenant(TenantId),
    Entity(EntityId),
    Relationship(RelationshipId),
    ConfigurationSnapshot(ConfigId),
    Policy(PolicyId),
    Constraint(ConstraintId),
    DecisionTwin(DecisionId),
    DecisionCandidate(DecisionCandidateId),
    AssuranceResult(Uuid),
    Authorization(AuthorizationId),
    Action(ActionId),
    Execution(ExecutionId),
    Observation(ObservationId),
    ModelProvenance(ModelArtifactId),
    RiskProfile(Uuid),
    Scenario(Uuid),
    EvidenceRecord(EvidenceId),
    
    // ── ProofMesh Canonical Objects ──
    VerificationClaim(VerificationClaimId),
    ExecutionPlan(ExecutionPlanId),
    VerificationRunRecord(VerificationRunRecordId),
    ReplayCapsule(ReplayCapsuleId),
    EvidenceQuorumSnapshot(EvidenceQuorumSnapshotId),
    VerificationFinding(VerificationFindingId),
    FaultScenario(FaultScenarioId),
}
```

---

## 4. Context-Sensitive TenantId Deserialization (FA-1)

V8 unconditionally rejected `TenantId::PLATFORM` and `GLOBAL` during deserialization. This introduced a round-trip failure for valid, platform-scoped canonical objects residing in the `StateStore`.

**Resolution**
Target: `VARDHAN_OBJECT_TRAITS`

The `TenantId` serialization boundary is bifurcated into two distinct, context-sensitive validation domains:

1. **External / Business Context (`deserialize_business`)**: 
   Applied to all external API inputs, webhook payloads, and unauthenticated boundary decoding.
   *Invariant*: Reserved IDs (`PLATFORM`, `GLOBAL`) are strictly **REJECTED**.

2. **Internal / Canonical State Context (`deserialize_canonical`)**:
   Applied exclusively when decoding authenticated, cryptographically signed canonical objects from the Raft `StateStore` (L04) or `EvidenceStore` (L03).
   *Invariant*: Reserved IDs (`PLATFORM`, `GLOBAL`) are **PERMITTED** only for object types that are authorized to be platform/global scoped (e.g., `VerificationClaim`).

By establishing an internal authenticated deserialization path, valid platform objects can successfully round-trip to/from the ledger, while the external security boundary remains impenetrable to reserved ID spoofing.

---

## 5. Precise Invariant Terminology

V8 conflated compiler-enforced constraints with runtime and state-machine logic. The specification vocabulary is formally corrected:

### A. TYPE-LEVEL INVARIANTS (Enforced by the Rust Compiler)
* `TransitionType` and `CanonicalObjectRef` exhaustiveness (no invalid types can be passed).
* `TenantScoped<T>` structural containment (objects must have a scope hash).
* ActionType presence on the `Authorization` object.
* `EvaluationSubject` enum shape.

### B. RUNTIME VALIDATION INVARIANTS (Enforced by Trait Implementations)
* ML-DSA-87 signature validity (enforced by `EvidenceStore::append()`).
* Configuration freshness / context applicability (enforced by `EvidenceStore::append()`).
* Policy PASS status (enforced by `VardhanAuthorityGate`).
* Context-sensitive `TenantId` deserialization.
* A7 Authorization path validation (Business vs Verification trace).

### C. CONSENSUS / STATE-MACHINE INVARIANTS (Enforced by Raft & State Transitions)
* Raft `commit_index` finalization (time assignment).
* Run/Evidence ordering (RunRecord points to a committed `EvidenceId`).
* `VerificationClaim` status transitions (EVIDENCE_GATHERING → CERTIFIED).
* Quorum snapshot boundary membership (`as_of_commit_index`).

The term "mechanically verifiable by the Rust compiler" strictly applies only to Category A. Categories B and C require test contracts and distributed state mechanics to enforce.

---

## 6. Final Status & Freeze Decision

This V9 document corrects the final 5 type and serialization scope errors. The complete freeze set (FA-1 through FA-12) is now mechanically sound, exhaustively enumerated, and free of contradictions.

| Area | Status |
| :--- | :--- |
| Taxonomy, Separation, Quorum, Payload | ✅ CLOSED (V5) |
| Signer, Config Semantics, A7 Base | ✅ CLOSED (V6) |
| FA-11: Correct Authorization Guard (`authorization.action_type`) | ✅ CLOSED (V9) |
| FA-10: Exhaustive `TransitionType` | ✅ CLOSED (V9) |
| FA-10: Exhaustive `CanonicalObjectRef` | ✅ CLOSED (V9) |
| FA-1: Context-Sensitive `TenantId` Deserialization | ✅ CLOSED (V9) |
| Precise Invariant Terminology | ✅ CLOSED (V9) |

The FA-1 through FA-12 amendment set is fully formed and awaits final freeze authorization.
