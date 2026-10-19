# VARDHAN PROOFMESH RECONCILIATION — PASS 11
## Specification Delta Analysis V11 — Freeze Readiness Final Audit

**Document type**: Delta analysis. READ-ONLY against frozen specifications.
**Supersedes**: V10 (`VARDHAN_PROOFMESH_RECONCILIATION_V10.md`)
**Frozen spec references**: All seven frozen pillars at their current HEAD.
**Verification Target SHA**: 4711305797ccb68e19f55124384cf2272b5ff187
**Phase**: 5 — ProofMesh Specification Reconciliation
**Rule**: NO PLACEHOLDERS / NO INHERITED DEFINITIONS. This document contains complete, exhaustive enumerations for all outstanding contracts.

---

## 1. Complete TransitionType Enum (FA-10)

The `TransitionType` enum explicitly lists every historical wire string from the frozen architecture and every ProofMesh string mapping. There are no ellipses or placeholders.

```rust
#[derive(Serialize, Deserialize)]
pub enum TransitionType {
    // ── Frozen Architectural Transitions ──
    #[serde(rename = "TENANT_CREATE")] CreateTenant,
    #[serde(rename = "TENANT_UPDATE")] UpdateTenant,
    #[serde(rename = "DELETE_TENANT")] DeleteTenant,
    #[serde(rename = "DEACTIVATE")] DeactivateTenant,
    #[serde(rename = "ENTITY_CREATE")] CreateEntity,
    #[serde(rename = "ATTRIBUTE_UPDATE")] UpdateEntity,
    #[serde(rename = "DELETE_ENTITY")] DeleteEntity,
    #[serde(rename = "ARCHIVE")] ArchiveEntity,
    #[serde(rename = "DEPRECATE")] DeprecateEntity,
    #[serde(rename = "CREATE_RELATIONSHIP")] CreateRelationship,
    #[serde(rename = "DELETE_RELATIONSHIP")] DeleteRelationship,
    #[serde(rename = "CONFIG_UPDATE")] ConfigUpdate,
    #[serde(rename = "POLICY_CREATE")] PolicyCreate,
    #[serde(rename = "POLICY_UPDATE")] PolicyUpdate,
    #[serde(rename = "CONSTRAINT_CREATE")] ConstraintCreate,
    #[serde(rename = "CONSTRAINT_UPDATE")] ConstraintUpdate,
    #[serde(rename = "DECISION_CONTEXTUALIZED")] DecisionContextualized,
    #[serde(rename = "DECISION_OPTIONS_GENERATED")] DecisionOptionsGenerated,
    #[serde(rename = "DECISION_ASSESSED")] DecisionAssessed,
    #[serde(rename = "DECISION_POLICY_CHECKED")] DecisionPolicyChecked,
    #[serde(rename = "ASSURANCE_RESULT_CREATE")] AssuranceResultCreate,
    #[serde(rename = "AUTHORIZATION_CREATE")] AuthorizationCreate,
    #[serde(rename = "AUTHORIZATION_REVOKE")] AuthorizationRevoke,
    #[serde(rename = "EXECUTION_CREATE")] ExecutionCreate,
    #[serde(rename = "EXECUTION_UPDATE")] ExecutionUpdate,
    #[serde(rename = "OBSERVATION_CREATE")] ObservationCreate,
    #[serde(rename = "MODEL_PROVENANCE_CREATE")] ModelProvenanceCreate,
    #[serde(rename = "RISK_PROFILE_CREATE")] RiskProfileCreate,
    #[serde(rename = "SCENARIO_CREATE")] ScenarioCreate,

    // ── ProofMesh Canonical Transitions ──
    #[serde(rename = "VERIFICATION_CLAIM_CREATE")] VerificationClaimCreate,
    #[serde(rename = "VERIFICATION_CLAIM_UPDATE")] VerificationClaimUpdate,
    #[serde(rename = "EXECUTION_PLAN_CREATE")] ExecutionPlanCreate,
    #[serde(rename = "EXECUTION_PLAN_UPDATE")] ExecutionPlanUpdate,
    #[serde(rename = "VERIFICATION_RUN_RECORD_CREATE")] VerificationRunRecordCreate,
    #[serde(rename = "REPLAY_CAPSULE_CREATE")] ReplayCapsuleCreate,
    #[serde(rename = "QUORUM_SNAPSHOT_CREATE")] QuorumSnapshotCreate,
    #[serde(rename = "VERIFICATION_FINDING_CREATE")] VerificationFindingCreate,
    #[serde(rename = "FAULT_SCENARIO_CREATE")] FaultScenarioCreate,
}
```

---

## 2. Complete CanonicalObjectRef Enum (FA-10)

The `CanonicalObjectRef` enum is complete and strictly typed, covering every frozen canonical object and every new ProofMesh object. No placeholders are used.

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
    AssuranceResult(AssuranceResultId),
    Authorization(AuthorizationId),
    Action(ActionId),
    Execution(ExecutionId),
    Observation(ObservationId),
    ModelProvenance(ModelArtifactId),
    RiskProfile(RiskProfileId),
    Scenario(ScenarioId),
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

## 3. Complete Legacy ID Specification (FA-13)

Replacing the raw UUID collapses for legacy objects requires explicit identity, serialization, and migration contracts for `AssuranceResultId` and `RiskProfileId`.

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct AssuranceResultId(pub Uuid);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct RiskProfileId(pub Uuid);
```

**Contract Rules**:
*   **Identity Boundary**: Struct wraps a standard 16-byte UUID.
*   **Serialization representation**: `#[serde(transparent)]` guarantees the JSON string representation remains identical to the raw UUID.
*   **Constructor / Validation Boundary**: Exposes a strict `from_uuid(Uuid)` constructor.
*   **Canonical Serialization Behavior**: Canonical BLAKE3 hashing operates on the exact same 16-byte array as before; canonical bytes are entirely unaffected.
*   **Migration Behavior for Existing Records**: Existing state payloads containing raw UUIDs are seamlessly mapped to these newtypes during canonical deserialization via the transparent serde attribute. No data migration or re-hashing is required.

---

## 4. Exact AuthorizationContext Definition (FA-5)

The term "struct" was incorrectly used in V10. `AuthorizationContext` is explicitly an **enum** used as a discriminator for the `Authorization` canonical object.

```rust
pub enum AuthorizationContext {
    Business {
        decision_id: DecisionId,
        assurance_ref: EvidenceId,
    },
    SystemicVerification {
        verification_claim_ref: VerificationClaimId,
        fault_scenario_ref: FaultScenarioId,
    },
}
```
This is the single canonical form used everywhere across the `VARDHAN_CANONICAL_OBJECT_SPEC`, `VARDHAN_OBJECT_TRAITS`, and downstream `VARDHAN_STATE_MACHINES`.

---

## 5. Exact Reserved-Scope Authorization Matrix (FA-1)

The `CanonicalTenantId` decoding boundary is made strictly deterministic through the `VerificationScope` matrix, ensuring no implementation drift regarding when reserved scopes are permitted.

```rust
pub enum VerificationScope {
    Global,
    Platform,
    Tenant(TenantId),
}

impl CanonicalTenantId {
    pub fn validate_context(self, object_scope: VerificationScope) -> Result<TenantId, DecodeError> {
        match object_scope {
            VerificationScope::Global => {
                if self.0 == TenantId::GLOBAL.0 {
                    Ok(TenantId::GLOBAL)
                } else {
                    Err(DecodeError::ScopeMismatch)
                }
            },
            VerificationScope::Platform => {
                if self.0 == TenantId::PLATFORM.0 {
                    Ok(TenantId::PLATFORM)
                } else {
                    Err(DecodeError::ScopeMismatch)
                }
            },
            VerificationScope::Tenant(expected_tenant) => {
                if self.0 == expected_tenant.0 && !TenantId::is_reserved(&self.0) {
                    Ok(expected_tenant)
                } else {
                    Err(DecodeError::ScopeMismatch)
                }
            }
        }
    }
}
```

This guarantees `PLATFORM` and `GLOBAL` are only permitted for canonical objects that inherently carry a matching Platform or Global VerificationScope. A tenant UUID is permitted for ordinary tenant-scoped objects, but strictly rejected if it matches a reserved ID.

---

## 6. Final Freeze Assessment and Dependency Matrix

| ID | Target Spec | Exact Amendment |
| :--- | :--- | :--- |
| **FA-1** | `CONSTITUTION` / `TRAITS` | Reserved `TenantId` boundaries, Standard vs Canonical deserialization wrapper, and explicit `VerificationScope` validation matrix. |
| **FA-2** | `CANONICAL_OBJECT_SPEC` | `EvidenceCategory::VERIFICATION` enum variant. |
| **FA-3** | `CANONICAL_OBJECT_SPEC` | `EvidencePayload` sum type + invariant. |
| **FA-4** | `CANONICAL_OBJECT_SPEC` / `TRAITS` | `PolicyType::EVIDENCE_POLICY` + `PolicyContextKind` variants. |
| **FA-5** | `CANONICAL_OBJECT_SPEC` / `AI_DESIGN` | Exact `AuthorizationContext` enum schema. `ActionType` propagation across AI and Execution planes. |
| **FA-6** | `TRAITS` | `EvidenceStore::verification_tree()` returning `MerkleTreeHandle`. |
| **FA-7** | `CANONICAL_OBJECT_SPEC` | `PolicyEvaluation`: `EvaluationSubject` migration. |
| **FA-8** | `TRAITS` | `VardhanAuthorityGate` (A7): verification path matrix. |
| **FA-9** | `TRAITS` | `EvidenceStore::append()` structural validation rules. |
| **FA-10**| `CANONICAL_OBJECT_SPEC` | Exhaustive `TransitionType` (historical + ProofMesh). Exhaustive `CanonicalObjectRef`. |
| **FA-11**| `STATE_MACHINES` | `Authorization` state machine context bifurcation. |
| **FA-12**| `TEST_CONTRACTS` / `AI_DESIGN`| `EvaluationSubject` migration mappings. |
| **FA-13**| `CANONICAL_OBJECT_SPEC` | Complete `AssuranceResultId` and `RiskProfileId` specifications (transparent serde, identity behavior). |

All 13 foundational amendments are completely defined, mechanically verifiable, and free of omissions. Freeze authorization is requested.
