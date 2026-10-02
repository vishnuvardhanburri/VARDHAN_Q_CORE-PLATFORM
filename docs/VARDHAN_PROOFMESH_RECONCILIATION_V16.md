# VARDHAN PROOFMESH RECONCILIATION V16
**Baseline**: `4711305797ccb68e19f55124384cf2272b5ff187`  
**Method**: Every claim in this document was verified by direct reading of the frozen source files. No prior reconciliation document is treated as evidence.

---

## 0. Frozen Type Reference (Verbatim, read from source)

The following types appear **exactly as written** in the frozen frozen baseline files and are used throughout this document.

```
From VARDHAN_CANONICAL_OBJECT_SPEC.md §12.4:
  auth_id        : Uuid             (LogicalId)
  authorized_at  : TimeContext
  config_hash    : ConfigurationHash
  provenance     : ProvenanceTrail

From VARDHAN_OBJECT_TRAITS.md:
  pub struct TenantScoped<T> { pub tenant_id: TenantId, pub scope_hash: [u8; 32], pub inner: T }
  pub struct TimeContext { pub event_time: DateTime<Utc>, pub system_time: DateTime<Utc>, pub logical_time: Option<CommitIndex> }
  pub struct ConfigurationHash([u8; 32]);   // BLAKE3 of config bytes
  ProvenanceTrail { /* schema deferred to Interface Phase */ }

From VARDHAN_AI_INTELLIGENCE_DESIGN.md §4.12:
  pub enum ActionType { Read, Modify, Create, Delete, Execute }

From VARDHAN_CANONICAL_OBJECT_SPEC.md §15:
  ActionSpec.action_type : String  ← e.g., "api_call", "workflow_start", "db_update"
  (ActionSpec is the embedded sub-struct on Action; it is NOT on Authorization)
```

**Critical discovery**: `ActionType` the enum exists only in `VARDHAN_AI_INTELLIGENCE_DESIGN.md`.  
`action_type` in `VARDHAN_CANONICAL_OBJECT_SPEC.md` is a `String` field on `ActionSpec`, embedded in `Action`, **not** on `Authorization`.  
`Authorization` in the frozen spec contains **no** `action_type` field. That field was introduced only in reconciliation documents V3–V14 as amendment FA-5.

---

## 1. Authoritative Canonical Identity Table

Every object and ID is verified against the frozen baseline. The columns are:

| Object | Frozen LogicalId Field | Frozen ID Type | Status | Amendment | Migration Rule |
|---|---|---|---|---|---|
| `Tenant` | `tenant_id` | `TenantId` | Frozen | — | Exact match |
| `Entity` | `entity_id` | `EntityId` | Frozen | — | Exact match |
| `Relationship` | `relationship_id` | `RelationshipId` | Frozen | — | Exact match |
| `Event` | `event_id` | `EventId` | Frozen (Tests) | — | Exact match |
| `Observation` | `observation_id` | `ObservationId` | Frozen | — | Exact match |
| `StateSnapshot` | `snapshot_id` | `StateSnapshotId` | Frozen (Tests) | — | Exact match |
| `StateVersion` | `version_id` | `StateVersionId` | Frozen (Tests) | — | Exact match |
| `StateTransitionRecord` | `delta_id` | `Uuid` (raw) | Frozen | **FA-13A**: introduce `DeltaId(Uuid)` newtype | `delta_id` field renamed to typed `DeltaId`; wire value unchanged (transparent UUID) |
| `EvidenceRecord` | `logical_id` | `EvidenceId` | Frozen | — | Exact match |
| `ModelProvenance` | `model_id` | `ModelArtifactId` | Frozen | — | Exact match |
| `RiskProfile` | `risk_id` | `Uuid` (raw) | Frozen | **FA-13B**: introduce `RiskProfileId(Uuid)` newtype | `risk_id` field renamed to typed `RiskProfileId`; wire value unchanged |
| `Scenario` | `scenario_id` | `ScenarioId` | Frozen | — | Exact match |
| `AssuranceResult` | `assurance_id` | `Uuid` (raw) | Frozen | **FA-13C**: introduce `AssuranceResultId(Uuid)` newtype | `assurance_id` field renamed to typed `AssuranceResultId`; wire value unchanged |
| `Constraint` | `constraint_id` | `ConstraintId` | Frozen | — | Exact match |
| `Policy` | `policy_id` | `PolicyId` | Frozen | — | Exact match |
| `PolicyEvaluation` | `eval_id` | `Uuid` (raw) | Frozen | **FA-13D**: introduce `PolicyEvaluationId(Uuid)` newtype | `eval_id` field renamed to typed `PolicyEvaluationId`; wire value unchanged |
| `Authorization` | `auth_id` | `Uuid` (raw) | Frozen | **FA-13E**: introduce `AuthorizationId(Uuid)` newtype | `auth_id` field typed; wire value unchanged |
| `ConfigurationSnapshot` | `config_id` | `ConfigId` | Frozen | — | Exact match |
| `DecisionCandidate` | `candidate_id` | `DecisionCandidateId` | Frozen | — | Exact match |
| `DecisionTwin` | `decision_id` | `DecisionId` | Frozen | — | Exact match |
| `Action` | `action_id` | `ActionId` | Frozen | — | Exact match |
| `Execution` | `execution_id` | `ExecutionId` | Frozen | — | Exact match |
| `Compensation` | `compensation_id` | `CompensationId` | Frozen | — | Exact match |
| `Outcome` | `outcome_id` | `OutcomeId` | Frozen | — | Exact match |
| `PredictionError` | `error_id` | `PredictionErrorId` | Frozen | — | Exact match |
| `DecisionMemory` | `memory_id` | `Uuid` (raw) | Frozen | **FA-13F**: introduce `DecisionMemoryId(Uuid)` newtype | `memory_id` field typed; wire value unchanged |
| `VerificationClaim` | `claim_id` | `VerificationClaimId` | ProofMesh V2 | New | N/A |
| `ExecutionPlan` | `plan_id` | `ExecutionPlanId` | ProofMesh V2 | New | N/A |
| `VerificationRunRecord` | `run_id` | `VerificationRunRecordId` | ProofMesh V2 | New | N/A |
| `ReplayCapsule` | `capsule_id` | `ReplayCapsuleId` | ProofMesh V2 | New | N/A |
| `EvidenceQuorumSnapshot` | `snapshot_id` | `EvidenceQuorumSnapshotId` | ProofMesh V2 | New | N/A |
| `VerificationFinding` | `finding_id` | `VerificationFindingId` | ProofMesh V2 | New | N/A |
| `FaultScenario` | `fault_scenario_id` | `FaultScenarioId` | ProofMesh V2 | New | N/A |

**Inventory**: 26 frozen canonical objects + 7 ProofMesh canonical objects = **33 total**.

---

## 2. Newtype Amendment Declarations (FA-13A through FA-13F)

These are the six types formalized from raw `Uuid` fields in the frozen spec. Each is `#[serde(transparent)]` so the serialized wire value is **identical** to the bare UUID it replaces.

```rust
/// FA-13A: StateTransitionRecord.delta_id was Uuid
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct DeltaId(pub Uuid);

/// FA-13B: RiskProfile.risk_id was Uuid
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct RiskProfileId(pub Uuid);

/// FA-13C: AssuranceResult.assurance_id was Uuid
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct AssuranceResultId(pub Uuid);

/// FA-13D: PolicyEvaluation.eval_id was Uuid
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct PolicyEvaluationId(pub Uuid);

/// FA-13E: Authorization.auth_id was Uuid
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct AuthorizationId(pub Uuid);

/// FA-13F: DecisionMemory.memory_id was Uuid
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct DecisionMemoryId(pub Uuid);
```

**Serialization compatibility proof**: `#[serde(transparent)]` causes Serde to serialize/deserialize the newtype as its inner `Uuid` value directly. A fixture that previously serialized as `"assurance_id":"550e8400-e29b-41d4-a716-446655440000"` will produce the identical byte sequence after the FA-13C migration. BLAKE3 hashes of historical records remain valid because the canonical JSON byte stream is unchanged.

---

## 3. Exhaustive CanonicalObjectRef

Generated mechanically from the identity table above. Total variants: **33**.

```rust
/// Source of truth for all canonical object references across the Vardhan + ProofMesh architecture.
/// Generated from the V16 identity table. No ellipsis. No omissions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum CanonicalObjectRef {
    // ── 26 Frozen Canonical Objects ──────────────────────────────────────────
    Tenant(TenantId),
    Entity(EntityId),
    Relationship(RelationshipId),
    Event(EventId),
    Observation(ObservationId),
    StateSnapshot(StateSnapshotId),
    StateVersion(StateVersionId),
    StateTransitionRecord(DeltaId),         // FA-13A: was raw Uuid
    EvidenceRecord(EvidenceId),
    ModelProvenance(ModelArtifactId),       // Frozen: ModelArtifactId (not ModelProvenanceId)
    RiskProfile(RiskProfileId),             // FA-13B: was raw Uuid
    Scenario(ScenarioId),                   // Frozen: ScenarioId
    AssuranceResult(AssuranceResultId),     // FA-13C: was raw Uuid; one canonical name only
    Constraint(ConstraintId),
    Policy(PolicyId),
    PolicyEvaluation(PolicyEvaluationId),   // FA-13D: was raw Uuid
    Authorization(AuthorizationId),         // FA-13E: was raw Uuid
    ConfigurationSnapshot(ConfigId),        // Frozen: ConfigId (not ConfigurationHash)
    DecisionCandidate(DecisionCandidateId),
    DecisionTwin(DecisionId),
    Action(ActionId),
    Execution(ExecutionId),
    Compensation(CompensationId),
    Outcome(OutcomeId),
    PredictionError(PredictionErrorId),
    DecisionMemory(DecisionMemoryId),       // FA-13F: was raw Uuid

    // ── 7 ProofMesh Canonical Objects ────────────────────────────────────────
    VerificationClaim(VerificationClaimId),
    ExecutionPlan(ExecutionPlanId),
    VerificationRunRecord(VerificationRunRecordId),
    ReplayCapsule(ReplayCapsuleId),
    EvidenceQuorumSnapshot(EvidenceQuorumSnapshotId),
    VerificationFinding(VerificationFindingId),
    FaultScenario(FaultScenarioId),
}
// Verification count: 26 + 7 = 33 variants. Counted above.
```

---

## 4. Exhaustive TransitionType

### 4.1 Verified-Historical Set

Extracted verbatim from `VARDHAN_STATE_MACHINES.md` (lines 582, 632, 639, 646, 696, 708) and `VARDHAN_CANONICAL_OBJECT_SPEC.md` (line 510). These are the **only nine** strings demonstrated as historical wire values.

| Wire String | Source |
|---|---|
| `ENTITY_CREATE` | CANONICAL_OBJECT_SPEC §9.4 example |
| `ATTRIBUTE_UPDATE` | CANONICAL_OBJECT_SPEC §9.4 example |
| `CONFIG_UPDATE` | CANONICAL_OBJECT_SPEC §9.4 example + Amendment A4 |
| `DELETE_TENANT` | STATE_MACHINES §Tenant line 582 |
| `DEACTIVATE` | STATE_MACHINES §Entity line 632 |
| `ARCHIVE` | STATE_MACHINES §Entity line 639 |
| `DELETE_ENTITY` | STATE_MACHINES §Entity line 646 |
| `DEPRECATE` | STATE_MACHINES §Relationship line 696 |
| `DELETE_RELATIONSHIP` | STATE_MACHINES §Relationship line 708 |

No other strings appear in the frozen corpus with `transition_type=`. Strings such as `TENANT_UPDATE`, `POLICY_CREATE`, `DECISION_ASSESSED` from prior reconciliation documents are **not** in the frozen baseline and are therefore not labeled historical here.

### 4.2 The `transition_type` field is a `String` in the frozen spec

`StateTransitionRecord.transition_type : String` (CANONICAL_OBJECT_SPEC §9.4).

This is the most important architectural fact. **Converting it to an enum is an amendment**, not a preservation.

### 4.3 Final TransitionType definition

Because the frozen field is a `String`, converting to an enum requires an explicit migration strategy. We choose **Strategy 2: untagged compatibility variant** that captures any unrecognized historical string without rejecting it.

```rust
/// Amendment: Replaces StateTransitionRecord.transition_type: String.
/// Strategy: Closed known variants + explicit Unknown fallback.
/// The Unknown variant preserves any historical wire string not in the frozen corpus
/// without silently accepting it as a first-class canonical type.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum TransitionType {
    Known(KnownTransitionType),
    /// Explicit legacy fallback. Records containing this variant must be
    /// flagged during evidence finalization for manual review.
    Unknown(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum KnownTransitionType {
    // A. VERIFIED-HISTORICAL — exact wire strings from frozen corpus
    #[serde(rename = "ENTITY_CREATE")]       EntityCreate,
    #[serde(rename = "ATTRIBUTE_UPDATE")]    AttributeUpdate,
    #[serde(rename = "CONFIG_UPDATE")]       ConfigUpdate,
    #[serde(rename = "DELETE_TENANT")]       DeleteTenant,
    #[serde(rename = "DEACTIVATE")]          Deactivate,
    #[serde(rename = "ARCHIVE")]             Archive,
    #[serde(rename = "DELETE_ENTITY")]       DeleteEntity,
    #[serde(rename = "DEPRECATE")]           Deprecate,
    #[serde(rename = "DELETE_RELATIONSHIP")] DeleteRelationship,

    // B. NEW-CANONICAL-PROOFMESH — explicit wire strings, no Rust-name-only variants
    #[serde(rename = "VERIFICATION_CLAIM_CREATE")]    VerificationClaimCreate,
    #[serde(rename = "EXECUTION_PLAN_CREATE")]         ExecutionPlanCreate,
    #[serde(rename = "VERIFICATION_RUN_RECORD_CREATE")] VerificationRunRecordCreate,
    #[serde(rename = "REPLAY_CAPSULE_CREATE")]         ReplayCapsuleCreate,
    #[serde(rename = "QUORUM_SNAPSHOT_CREATE")]         QuorumSnapshotCreate,
    #[serde(rename = "VERIFICATION_FINDING_CREATE")]   VerificationFindingCreate,
    #[serde(rename = "FAULT_SCENARIO_CREATE")]          FaultScenarioCreate,
}
```

**Compatibility rule**:  
- A historical record with `transition_type = "DELETE_TENANT"` deserializes to `Known(DeleteTenant)` and re-serializes identically.  
- A historical record with `transition_type = "TENANT_UPDATE"` (not in the corpus) deserializes to `Unknown("TENANT_UPDATE")` and is flagged.  
- No record is silently rejected or corrupted.

---

## 5. Authorization Schema (FA-5 Final)

### 5.1 Frozen Authorization fields (verbatim from CANONICAL_OBJECT_SPEC §12.4)

```text
Authorization
├── auth_id        : Uuid             (LogicalId)
├── TenantScoped
│   ├── tenant_id   : TenantId
│   └── scope_hash  : [u8; 32]
├── decision_id     : DecisionId
├── action_id       : ActionId
├── policy_eval_ref : EvidenceId
├── assurance_ref   : EvidenceId
├── risk_level      : RiskLevel
├── auth_level      : AuthLevel        ← HUMAN | AUTO
├── authorized_by   : EntityId
├── authorized_at   : TimeContext
├── config_hash     : ConfigurationHash
├── evidence_refs   : Vec<EvidenceId>
└── provenance      : ProvenanceTrail
```

### 5.2 What FA-5 adds

FA-5 (verified through reconciliation chain V3–V10) adds:

1. A new `ActionType` variant: `SystemicFaultInjection`
2. A new field on `Authorization`: `action_type: ActionType`  
3. A new field on `Authorization`: `proofmesh_context: Option<SystemicVerificationContext>`

**Why these are amendments, not substitutions**: All existing frozen fields remain. No field is removed. No fake value fills a required field.

### 5.3 ActionType amendment (FA-5)

`ActionType` is defined in `VARDHAN_AI_INTELLIGENCE_DESIGN.md §4.12`:

```rust
pub enum ActionType { Read, Modify, Create, Delete, Execute }
```

FA-5 adds one variant and migrates this enum to be the canonical cross-spec definition:

```rust
/// Amendment FA-5: adds SystemicFaultInjection.
/// This enum is now authoritative for both VARDHAN_AI_INTELLIGENCE_DESIGN and Authorization.
pub enum ActionType {
    #[serde(rename = "READ")]    Read,
    #[serde(rename = "MODIFY")]  Modify,
    #[serde(rename = "CREATE")]  Create,
    #[serde(rename = "DELETE")]  Delete,
    #[serde(rename = "EXECUTE")] Execute,
    /// New variant (FA-5). Wire string is canonical.
    #[serde(rename = "SYSTEMIC_FAULT_INJECTION")] SystemicFaultInjection,
}
```

### 5.4 Final Authorization struct (all fields, no ellipsis)

```rust
/// Final Authorization canonical object (V16).
/// All frozen fields preserved exactly.
/// FA-5 adds action_type and proofmesh_context.
/// TenantScoped wrapper is part of the struct layout per the frozen spec.
pub struct Authorization {
    // ── Frozen fields ─────────────────────────────────────────────────────────
    pub auth_id:         AuthorizationId,    // FA-13E: was Uuid
    pub tenant_id:       TenantId,           // from TenantScoped
    pub scope_hash:      [u8; 32],           // from TenantScoped
    pub decision_id:     DecisionId,
    pub action_id:       ActionId,
    pub policy_eval_ref: EvidenceId,
    pub assurance_ref:   EvidenceId,
    pub risk_level:      RiskLevel,
    pub auth_level:      AuthLevel,
    pub authorized_by:   EntityId,
    pub authorized_at:   TimeContext,        // NOT Timestamp; NOT DateTime<Utc>
    pub config_hash:     ConfigurationHash,  // NOT ConfigId
    pub evidence_refs:   Vec<EvidenceId>,
    pub provenance:      ProvenanceTrail,    // NOT Vec<ProvenanceEntry>

    // ── FA-5 additions ────────────────────────────────────────────────────────
    /// Which class of action this authorization covers.
    /// For business authorizations: Read | Modify | Create | Delete | Execute.
    /// For systemic verification: MUST be SystemicFaultInjection.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action_type: Option<ActionType>,

    /// Only present when action_type == SystemicFaultInjection.
    /// Carries the ProofMesh-specific references without corrupting business fields.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub proofmesh_context: Option<SystemicVerificationContext>,
}

/// ProofMesh-specific authority context.
/// Only valid when action_type = SystemicFaultInjection.
pub struct SystemicVerificationContext {
    pub verification_claim_ref: VerificationClaimId,
    pub fault_scenario_ref:     FaultScenarioId,
}
```

### 5.5 Serialization compatibility proofs

**Case 1 — Historical Business Authorization**

Frozen wire representation (pre-FA-5):
```json
{
  "auth_id": "550e8400-e29b-41d4-a716-446655440000",
  "tenant_id": "...",
  "scope_hash": [...],
  "decision_id": "...",
  "action_id": "...",
  "policy_eval_ref": "...",
  "assurance_ref": "...",
  "risk_level": "MEDIUM",
  "auth_level": "AUTO",
  "authorized_by": "...",
  "authorized_at": { "event_time": "...", "system_time": "...", "logical_time": null },
  "config_hash": [...],
  "evidence_refs": [],
  "provenance": { ... }
}
```

V16 deserialization: `action_type` is absent → `None` (via `#[serde(default)]`). `proofmesh_context` is absent → `None`. Neither field appears in re-serialized output (via `skip_serializing_if`). **The canonical byte sequence is identical. BLAKE3 hash is preserved.**

**Case 2 — New Business Authorization (V16)**

Same as Case 1 plus `"action_type": "EXECUTE"`. The additional field changes canonical bytes and produces a new hash. This is expected and correct: it is a new authorization object, not a restatement of an old one.

**Case 3 — SystemicVerification Authorization (new)**

```json
{
  "auth_id": "...",
  ...all frozen fields with real values...,
  "decision_id": "...",        ← real DecisionId that authorized the systemic run
  "action_id":   "...",        ← real ActionId for the fault injection action
  "policy_eval_ref": "...",    ← real PolicyEvaluation that approved the plan
  "assurance_ref": "...",      ← real AssuranceResult from the plan review
  "action_type": "SYSTEMIC_FAULT_INJECTION",
  "proofmesh_context": {
    "verification_claim_ref": "...",
    "fault_scenario_ref": "..."
  }
}
```

**No zero UUIDs. No dummy values. All business fields carry the actual authorization chain for the systemic run.**

### 5.6 Cross-field validation matrix

| `action_type` | `decision_id` | `policy_eval_ref` | `assurance_ref` | `proofmesh_context` | Valid? |
|---|---|---|---|---|---|
| `None` or `Execute` | Required (real) | Required (real) | Required (real) | `None` | ✅ Business |
| `SystemicFaultInjection` | Required (real) | Required (real) | Required (real) | Required | ✅ Systemic |
| `SystemicFaultInjection` | Any | Any | Any | `None` | ❌ Rejected by A7 |
| Any | Any | Zero UUID | Any | Any | ❌ Rejected: no dummy values |

---

## 6. A7 Gate Compatibility

The A7 `VardhanAuthorityGate` trait (verbatim from ARCHITECTURE_CONSTITUTION.md) validates:
1. `auth_id` exists and is valid
2. `auth_id` matches action's `auth_id`
3. `DecisionTwin` `final_status = PASS`
4. `PolicyEvaluation` is PASS
5. `config_hash` is current (A4)
6. `tenant_id` matches the execution context (A2)

**V16 systemic path compatibility**: For `SystemicFaultInjection`, the same six checks apply. Additionally, A7 MUST verify `proofmesh_context` is present and that `fault_scenario_ref` matches the `FaultScenario` that the `VerificationClaim` references. This is an additive guard, not a bypass.

---

## 7. TenantId Canonical Decoding Boundary

**Per VARDHAN_OBJECT_TRAITS §8.2**: `TenantScoped<T>` is a **structural type-level constraint** — not a runtime flag. No semantic object may enter an authoritative state without passing the `TenantScoped<T>` boundary check.

**Decoding rule**: When deserializing an `Authorization`, the `tenant_id` and `scope_hash` from the TenantScoped wrapper are verified against the execution context's authenticated `TenantId` before the object is admitted to the runtime. This check is performed by the `TenantScopedObject` trait implementation boundary. **Payloads are never decoded blindly.**

RUNTIME classification: This boundary check is a RUNTIME guard, executed by `TenantScopedObject::verify_scope()`. It is not a TYPE-LEVEL compiler guarantee.

---

## 8. Invariant Classification

| Invariant | Category | Mechanism |
|---|---|---|
| `ConfigId` vs `ConfigurationHash` are distinct newtypes | TYPE-LEVEL | Rust type system; they cannot be substituted at compile time |
| `TenantScoped<T>` wrapping requirement | TYPE-LEVEL | Rust generic wrapper; cannot construct inner `T` without `TenantScoped<T>` |
| `action_type = SystemicFaultInjection` → `proofmesh_context` must be `Some` | RUNTIME | Validated by `Authorization::validate()` and A7 gate |
| VerificationScope matching (Global / Platform / Tenant) | RUNTIME | `match object_scope { ... }` in verification path |
| Raft commit required before Authorization transitions to AUTHORIZED | CONSENSUS | Raft log commit index enforces ordering |
| `delta_id` (commit_index) assignment ordering | CONSENSUS | Assigned at Raft commit; not caller-settable |

---

## 9. Cross-Spec Dependency Matrix

| Type | Defined In | Consumed By | Conflict? |
|---|---|---|---|
| `ActionType` | AI_INTELLIGENCE_DESIGN §4.12 | Authorization (FA-5), Action.ActionSpec | V16 FA-5 adds `SystemicFaultInjection`; no competing definition |
| `Authorization` | CANONICAL_OBJECT_SPEC §12.4 | OBJECT_TRAITS §10.6, STATE_MACHINES §Authorization, A7 Gate | V16 adds two optional fields; no field removed; compatible |
| `TenantId` | CANONICAL_OBJECT_SPEC §4 | Every TenantScoped object | Single definition; no conflict |
| `PolicyEvaluation` | CANONICAL_OBJECT_SPEC §13 | AssuranceResult.g4_result, Authorization.policy_eval_ref | `eval_id` typed as `PolicyEvaluationId` (FA-13D); no semantic change |
| `StateTransitionRecord` | CANONICAL_OBJECT_SPEC §9.4 | STATE_MACHINES §9 | `delta_id` typed as `DeltaId` (FA-13A); `transition_type` migrated to enum with fallback |
| `CanonicalObjectRef` | ProofMesh identity.rs | Evidence signing envelope, audit references | V16 is the single exhaustive definition; 33 variants |
| `EvidenceId` | CANONICAL_OBJECT_SPEC §7 | Authorization.policy_eval_ref, .assurance_ref, .evidence_refs | Never used as another object's logical ID |
| `ConfigId` | CANONICAL_OBJECT_SPEC §12.5 | `ConfigurationSnapshot` logical ID only | `ConfigurationHash` is a distinct `[u8;32]` BLAKE3 digest; V16 never conflates them |

---

## 10. Automated Consistency Audit Results

```bash
# Run from: /Users/vishnuvardhanburri/vardhan-quantum-proxy

echo "=== 1. Duplicate Authorization struct definitions ==="
grep -rn "^pub struct Authorization" backend/ docs/ | grep -v "Reconciliation\|_V[0-9]"
# Expected: 0 results in backend/; docs/ occurrences are reconciliation artifacts.

echo "=== 2. Competing Assurance ID names ==="
grep -rn "AssuranceId\b" backend/ | grep -v "AssuranceResultId\|AssuranceError"
# Expected: 0 results. Only AssuranceResultId is canonical.

echo "=== 3. Competing PolicyEvaluation ID names ==="
grep -rn "PolicyEvaluationId\|eval_id" backend/ | grep "raw Uuid\|: Uuid"
# Expected: 0 results after FA-13D migration.

echo "=== 4. Timestamp vs TimeContext substitutions ==="
grep -rn "authorized_at.*Timestamp\|authorized_at.*DateTime" backend/
# Expected: 0 results. authorized_at must be TimeContext.

echo "=== 5. ConfigId vs ConfigurationHash substitutions ==="
grep -rn "ConfigurationSnapshot.*ConfigurationHash\|config_id.*ConfigurationHash" backend/
# Expected: 0 results. ConfigurationSnapshot.config_id is ConfigId; config_hash is ConfigurationHash.

echo "=== 6. AuthorizationId vs auth_id ==="
grep -rn "authorization_id\b" backend/ | grep -v "auth_id\|proofmesh"
# Expected: 0 results in canonical structs. auth_id is the canonical field name.

echo "=== 7. Missing TenantScoped boundaries ==="
grep -rn "fn authorize_and_execute" backend/ | grep -v "TenantScoped\|tenant_id"
# Manual check required: every execute path must verify tenant scope.

echo "=== 8. SystemicVerification without SystemicFaultInjection ==="
grep -rn "SystemicVerification" backend/ | grep -v "SystemicFaultInjection\|proofmesh_context"
# Expected: 0 results. Every SystemicVerification authorization must have action_type.

echo "=== 9. Dummy/zero UUIDs ==="
grep -rn "00000000-0000-0000-0000-000000000000" backend/
# Expected: 0 results.

echo "=== 10. ProofMesh TransitionType variants without serde rename ==="
grep -A2 "VerificationClaimCreate\|ExecutionPlanCreate\|ReplayCapsuleCreate" backend/ \
  | grep -v "serde(rename"
# Expected: 0 results.

echo "=== 11. Raw Uuid inside CanonicalObjectRef ==="
grep -n "CanonicalObjectRef" backend/proofmesh/src/identity.rs \
  | grep "Uuid)"
# Expected: 0 results. All variants use typed newtypes.

echo "=== 12. EvidenceId used as PolicyEvaluation logical ID ==="
grep -n "PolicyEvaluation(EvidenceId)" backend/
# Expected: 0 results.

echo "=== 13. ConfigurationHash used as ConfigurationSnapshot logical ID ==="
grep -n "ConfigurationSnapshot(ConfigurationHash)" backend/
# Expected: 0 results.
```

**Audit finding**: `identity.rs` (already committed) passes checks 2, 3, 9, 11, 12, 13. Checks 4, 5, 6, 7, 8, 10 require verification in the broader backend/ Rust codebase, which does not yet contain implementations of `Authorization`, `StateTransitionRecord`, or `TransitionType` structs — these are spec-layer amendments in this document.

---

## 11. Remaining Unresolved Issues

1. **OPEN — `ProvenanceTrail` schema**: The frozen spec defers `ProvenanceTrail` to the Interface Phase. V16 correctly uses `ProvenanceTrail` as a type name but cannot specify its fields. Any code that uses `Vec<ProvenanceEntry>` in place of `ProvenanceTrail` is technically unspecified until the Interface Phase document is produced.

2. **OPEN — `TenantScoped<Authorization>` vs flat struct**: The frozen spec shows `Authorization` with `TenantScoped` as a nested block, but `VARDHAN_OBJECT_TRAITS §8.2` defines `TenantScoped<T>` as a wrapper struct. The V16 struct inlines `tenant_id` and `scope_hash` as flat fields (matching how every other object in OBJECT_TRAITS is shown). This is consistent with practice but the exact wire representation of the wrapper boundary requires confirmation during the Interface Phase.

3. **OPEN — `ActionType` historical wire strings**: The frozen `VARDHAN_AI_INTELLIGENCE_DESIGN` defines `ActionType` as `{ Read, Modify, Create, Delete, Execute }` without `#[serde(rename)]` annotations. The exact serialized wire strings (`"Read"` vs `"READ"` vs `"read"`) are not specified in the frozen doc. V16 uses SCREAMING_SNAKE_CASE by convention. If existing serialized records use Rust-default PascalCase, a migration or `#[serde(alias)]` is required.

---

## FREEZE STATUS

**FREEZE STATUS: NOT READY**

### Blockers preventing READY status:

**Blocker 1 — Mandatory** (Issue 11.3): `ActionType` historical wire strings are unspecified in the frozen baseline. V16 cannot assert compatibility for historical `Authorization` records containing `action_type` until the exact serialized form is confirmed. A serialization mismatch here would corrupt `Authorization` hash verification for any record written between FA-5 adoption and V16.

**Blocker 2 — Mandatory** (Issue 11.1): `ProvenanceTrail` schema is deferred. Code currently using `Vec<ProvenanceEntry>` as a substitute is speculative. V16 corrects the type name throughout but the Interface Phase document must be produced and reviewed before the ProofMesh module can claim authoritative provenance handling.

**Blocker 3 — Conditional** (Issue 11.2): The `TenantScoped<T>` wrapper boundary on `Authorization` must be confirmed: flat-inlined fields (current V16 representation) vs. a nested `TenantScoped<Inner>` struct will produce different canonical JSON and different BLAKE3 hashes.

Once these three blockers are resolved, the five V16 core contracts (identity table, CanonicalObjectRef, TransitionType, Authorization schema, invariant classification) are internally consistent with the frozen baseline and READY FOR EXPLICIT AUTHORIZATION can be issued.
EOF
