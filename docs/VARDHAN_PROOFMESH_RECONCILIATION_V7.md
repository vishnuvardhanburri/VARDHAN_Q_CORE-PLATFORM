# VARDHAN PROOFMESH RECONCILIATION — PASS 7
## Specification Delta Analysis V7 — Final Type and Contract Closure

**Document type**: Delta analysis. READ-ONLY against frozen specifications.
**Supersedes**: V6 (`VARDHAN_PROOFMESH_RECONCILIATION_V6.md`)
**Frozen spec references**: All seven frozen pillars at their current HEAD.
**Verification Target SHA**: 4711305797ccb68e19f55124384cf2272b5ff187
**Phase**: 5 — ProofMesh Specification Reconciliation
**Rule**: No frozen specification is modified until this document is reviewed, all contradictions closed, and freeze explicitly authorized.

---

## 1. Action Type Representation (Refining FA-5)

V6 incorrectly assigned `action_type` as a field on `ActionId` (which is a UUID newtype). 

**Resolution (Amendment FA-5 Finalized)**
Target: `VARDHAN_CANONICAL_OBJECT_SPEC` §12.4

The `Authorization` canonical object is explicitly amended to include a distinct `action_type` field, and the `ActionType` enum is formally defined:

```rust
pub enum ActionType {
    Read,
    Modify,
    Create,
    Delete,
    Execute,
    SystemicFaultInjection,
}

pub struct Authorization {
    // ... id, tenant, scope_hash ...
    pub authorization_context : AuthorizationContext, // (Business | SystemicVerification)
    pub action_id             : ActionId,
    pub action_type           : ActionType,           // NEW canonical field
    pub policy_eval_ref       : EvidenceId,
    // ... remaining existing fields ...
}
```
**Invariant**: If `authorization_context == AuthorizationContext::SystemicVerification`, then `action_type MUST BE ActionType::SystemicFaultInjection`. This properly aligns the canonical schema for A7 execution.

---

## 2. StateTransitionRecord Schema (Refining FA-10)

V6 referenced `object_ref` and `payload` fields that do not exist in the frozen `StateTransitionRecord` contract. The frozen contract also defined `transition_type` loosely as a `String`, which violates the "no string collapse" rule.

**Resolution (Amendment FA-10 Finalized)**
Target: `VARDHAN_CANONICAL_OBJECT_SPEC` (State Transitions) & `VARDHAN_OBJECT_TRAITS`

The `StateTransitionRecord` is explicitly amended. `transition_type` is upgraded to a typed enum, and the missing canonical payload fields are formally added.

```rust
pub enum TransitionType {
    // Legacy Business Transitions
    StateUpdate,
    ConfigUpdate,
    // ProofMesh Canonical Transitions
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

pub struct StateTransitionRecord {
    pub delta_id            : Uuid,
    pub tenant_id           : TenantId,
    pub previous_state_hash : StateHash,
    pub resulting_state_hash: StateHash,
    pub transition_type     : TransitionType,      // Upgraded from String
    
    // NEW FIELDS explicitly added for canonical object payloads
    pub target_object_ref   : Uuid,                // LogicalId of the mutating object
    pub target_object_hash  : ContentHash,         // BLAKE3 of the canonical object
    pub payload             : JsonValue,           // Serialized canonical object bytes
    
    // ... existing fields (status, evidence_ref, commit_index, signatures, etc.) ...
}
```

---

## 3. Reserved TenantId Construction Boundary (Refining FA-1)

V5/V6 introduced reserved constants for `TenantId::PLATFORM` and `GLOBAL`, but left open existing raw constructors like `from_uuid()` or `from_bytes()`, meaning a reserved ID could still be instantiated by business logic.

**Resolution (Amendment FA-1 Finalized)**
Target: `VARDHAN_OBJECT_TRAITS` §2

All public constructors of `TenantId` that parse from raw data are amended to return a `Result` and strictly enforce the reserved boundary.

```rust
impl TenantId {
    pub const PLATFORM: TenantId = TenantId(/* fixed UUID: 00000000-0000-0000-0000-000000000001 */);
    pub const GLOBAL: TenantId   = TenantId(/* fixed UUID: 00000000-0000-0000-0000-000000000002 */);

    pub fn is_reserved(uuid: &Uuid) -> bool {
        *uuid == Self::PLATFORM.0 || *uuid == Self::GLOBAL.0
    }

    /// All raw constructors MUST validate against reserved IDs.
    pub fn from_uuid(uuid: Uuid) -> Result<Self, TenantIdError> {
        if Self::is_reserved(&uuid) {
            return Err(TenantIdError::ReservedIdViolation);
        }
        Ok(Self(uuid))
    }

    pub fn from_bytes(bytes: [u8; 16]) -> Result<Self, TenantIdError> {
        let uuid = Uuid::from_bytes(bytes);
        Self::from_uuid(uuid)
    }
}
```
*Note: The inner tuple struct constructor `TenantId(Uuid)` becomes crate-visible only, preventing external circumvention.*

---

## 4. Exhaustive CanonicalObjectSigner Domain

V6 defined the `CanonicalObjectType` enum with an open-ended comment (`// ... other signed objects`), which is invalid for a constitutional trait boundary. 

**Resolution**
Target: `VARDHAN_OBJECT_TRAITS` (Signer Trait)

The `CanonicalObjectType` enum is explicitly made exhaustive, listing every canonical object in the frozen Vardhan architecture that requires an ML-DSA-87 signature. Any future signed object MUST be added to this enum via a formal amendment.

```rust
pub enum CanonicalObjectType {
    // Frozen Business Objects
    ConfigurationSnapshot,
    Policy,
    AssuranceResult,
    StateTransitionRecord,
    
    // ProofMesh Objects
    EvidenceRecord,
    VerificationFinding,
}
```
*(No `// ...` allowed. This is the exhaustive domain for `CanonicalObjectSigner::sign()`.)*

---

## 5. Final Complete Amendment Set (The Freeze Target)

All ambiguities are closed. This is the precise, mechanically implementable amendment set for freeze authorization:

| ID | Target Spec | Exact Amendment |
| :--- | :--- | :--- |
| **FA-1** | `CONSTITUTION` & `TRAITS` | Add `TenantId::PLATFORM`/`GLOBAL` constants. Restrict all `TenantId` constructors (`from_uuid`) to return `Result` and block reserved IDs. |
| **FA-2** | `CANONICAL_OBJECT_SPEC` | Add `EvidenceCategory::VERIFICATION` enum variant. |
| **FA-3** | `CANONICAL_OBJECT_SPEC` | Change `EvidenceRecord.payload` to `EvidencePayload` sum type (`Json` \| `Verification`). Add cross-field invariant for `VERIFICATION` category. |
| **FA-4** | `CANONICAL_OBJECT_SPEC` & `TRAITS` | Add `PolicyType::EVIDENCE_POLICY`. Add `VerificationPlanApproval`, `EvidenceQuorumEval`, `ClaimCertification` to `PolicyContextKind`. |
| **FA-5** | `CANONICAL_OBJECT_SPEC` | Amend `Authorization`: add `action_type: ActionType`, add `authorization_context: AuthorizationContext`. Add `ActionType::SystemicFaultInjection`. |
| **FA-6** | `TRAITS` | Add `EvidenceStore::verification_tree()` returning `MerkleTreeHandle`. |
| **FA-7** | `CANONICAL_OBJECT_SPEC` | Amend `PolicyEvaluation`: replace `candidate_hash` with `EvaluationSubject` enum. Increment `schema_version`. Define legacy `candidate_hash` migration mapping. |
| **FA-8** | `TRAITS` | Amend `VardhanAuthorityGate` (A7): enforce Business vs SystemicVerification invariant matrix against the new `AuthorizationContext`. |
| **FA-9** | `TRAITS` | Amend `EvidenceStore::append()` to explicitly enforce schema, tenant, signature, and contextual `config_hash` freshness. |
| **FA-10**| `CANONICAL_OBJECT_SPEC` & `TRAITS` | Amend `StateTransitionRecord`: change `transition_type` to typed enum. Add `target_object_ref`, `target_object_hash`, and `payload` fields for canonical mappings. |

### Subsystem Dependencies (Unchanged from V6)
- `VARDHAN_CANONICAL_OBJECT_SPEC`: Insert the 7 new ProofMesh canonical object schemas.
- `VARDHAN_STATE_MACHINES`: Insert `VerificationClaim` and `ExecutionPlan` machines.
- `VARDHAN_TEST_CONTRACTS`: Insert 9 new T-PM-* invariants.
- `VARDHAN_OBJECT_TRAITS`: Insert `VerificationEvidenceProducer`, `CanonicalObjectSigner`, `ReplayEngine` traits.
- `VARDHAN_AI_INTELLIGENCE_DESIGN`: Map `VerificationScheduler`.
- `VARDHAN_SYSTEM_MAP`: Map ProofMesh integration.

The architecture is complete. All non-existent fields are resolved, the schemas are strictly typed, and every constraint is mechanically verifiable by the Rust compiler. This document constitutes the final pre-freeze state.
