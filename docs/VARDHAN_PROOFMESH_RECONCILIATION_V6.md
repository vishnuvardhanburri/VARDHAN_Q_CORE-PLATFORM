# VARDHAN PROOFMESH RECONCILIATION — PASS 6
## Specification Delta Analysis V6 — Final Contract Closure

**Document type**: Delta analysis. READ-ONLY against frozen specifications.
**Supersedes**: V5 (`VARDHAN_PROOFMESH_RECONCILIATION_V5.md`)
**Frozen spec references**: All seven frozen pillars at their current HEAD.
**Verification Target SHA**: 4711305797ccb68e19f55124384cf2272b5ff187
**Phase**: 5 — ProofMesh Specification Reconciliation
**Rule**: No frozen specification is modified until this document is reviewed, all contradictions closed, and freeze explicitly authorized.

---

## 1. Authorization Schema for A7 Verification (Expanding FA-5/FA-8)

V5's matrix defined the validation rules for the verification path, but failed to amend the underlying `Authorization` canonical object schema, which hardcoded business-path fields (`decision_id`, `assurance_ref`).

**Resolution (Amendment FA-5 Expanded)**
Target: `VARDHAN_CANONICAL_OBJECT_SPEC` §12.4

The `Authorization` schema is amended to support a polymorphic authorization context while maintaining cryptographic canonicality:

```rust
// The amended Authorization canonical object
pub struct Authorization {
    // ... standard header (id, tenant, scope_hash) ...
    pub authorization_context : AuthorizationContext, // Replaces flat decision_id/assurance_ref
    pub action_id             : ActionId,
    pub policy_eval_ref       : EvidenceId,
    // ... remaining existing fields ...
}

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

**Explicit Invariants (Enforced by `VardhanAuthorityGate` in FA-8)**:
1. **Business Path**: Requires `AuthorizationContext::Business`. `decision_id` and `assurance_ref` are strictly required.
2. **Verification Path**: Requires `AuthorizationContext::SystemicVerification`. `verification_claim_ref` and `fault_scenario_ref` are strictly required. `action_id.action_type` MUST be `SYSTEMIC_FAULT_INJECTION`. `assurance_ref` is structurally omitted because assurance is provided by the Verification Plan Policy Evaluation, not G0-G4.

This preserves one `Authorization` object and one A7 gate without schema contradictions.

---

## 2. Signer Capability Scope

V5 defined an `EvidenceSigner` trait, but ProofMesh requires signing both `EvidenceRecord` (L03) and `VerificationFinding` (a canonical state object in L04). The capability scope was too narrow.

**Resolution**
The trait is generalized to accurately reflect its cryptographic role across Vardhan without creating a second crypto execution path.

**Amendment: `CanonicalObjectSigner` Trait**
Target: `VARDHAN_OBJECT_TRAITS`

```rust
pub trait CanonicalObjectSigner: Send + Sync {
    /// Sign the canonical bytes of any ML-DSA-87 capable object.
    /// Hides KMS/HSM key material from the application layer.
    fn sign(
        &self,
        object_type: CanonicalObjectType,
        canonical_bytes: &[u8],
    ) -> Result<Signature, SigningError>;

    fn signing_key_id(&self) -> SigningKeyId;
    
    fn algorithm(&self) -> SignatureAlgorithm; // Always SignatureAlgorithm::MlDsa87
}

pub enum CanonicalObjectType {
    EvidenceRecord,
    VerificationFinding,
    ConfigurationSnapshot, // Accommodates existing config signing
    // ... other signed objects
}
```

---

## 3. Configuration Applicability Semantics (Refining FA-9)

V5 mandated that `EvidenceStore::append()` check `config_hash` against the *current* configuration. This broke historical verification: delayed but valid evidence could be permanently rejected if the global config changed during the run.

**Resolution (Refined FA-9 Invariant)**
Target: `VARDHAN_OBJECT_TRAITS` §7.1

The `EvidenceStore::append()` config freshness rule is amended to:
> `EvidenceRecord.config_hash` MUST resolve to the effective, evidence-finalized configuration applicable to the evidence's evaluation context (e.g., the `config_hash` bound to the `VerificationClaim` and `VerificationRunRecord` at dispatch time). It MUST NOT simply enforce `config_hash == currently_active_config_hash`.

This ensures that evidence generated under config `A` can still be appended if the system transitions to config `B`, provided config `A` was valid at the time the run initiated.

---

## 4. StateStore ↔ ProofMesh Object Mapping

V5 left the canonical representation of ProofMesh objects ambiguous. The frozen `StateStore` only accepts `StateTransitionRecord`.

**Resolution (Amendment FA-10: ProofMesh State Transitions)**
Target: `VARDHAN_CANONICAL_OBJECT_SPEC` (State Transitions) & `VARDHAN_OBJECT_TRAITS` §7.2

To formally bridge ProofMesh canonical objects into the L04 `StateStore`, the `StateTransitionRecord.transition_type` enum is extended:

```rust
pub enum TransitionType {
    // ... existing business transitions ...
    VerificationClaimCreate,
    VerificationClaimUpdate,
    ExecutionPlanCreate,
    ExecutionPlanUpdate,
    VerificationRunRecordCreate,
    QuorumSnapshotCreate,
    VerificationFindingCreate,
    FaultScenarioCreate,
    ReplayCapsuleCreate,
}
```

**Mapping Contract**:
When `StateStore::apply(delta)` is invoked for ProofMesh objects:
1. `delta.transition_type` MUST be one of the above.
2. `delta.object_ref` MUST be the UUID (`logical_id`) of the ProofMesh object.
3. `delta.object_content_hash` MUST be the BLAKE3 `ContentHash` of the object.
4. `delta.payload` MUST contain the canonical JSON serialization of the object.

This eliminates implementation ambiguity. All ProofMesh canonical objects mutate the state tree identically to business objects, utilizing the exact same Raft replication and snapshot boundaries.

---

## 5. Final Freeze Set and Dependency Matrix

This matrix is now completely authoritative. Ambiguities between FA-2 (category) and FA-6 (interface) are explicitly decoupled.

### Core Contract Amendments (FA-1 through FA-10)

| ID | Target Specification | Exact Scope |
| :--- | :--- | :--- |
| **FA-1** | `VARDHAN_ARCHITECTURE_CONSTITUTION` | Reserved `TenantId::PLATFORM`/`GLOBAL` constants; INVARIANT-PM-001. |
| **FA-2** | `VARDHAN_CANONICAL_OBJECT_SPEC` | `EvidenceCategory::VERIFICATION` enum variant ONLY. |
| **FA-3** | `VARDHAN_CANONICAL_OBJECT_SPEC` | `EvidencePayload` sum type + cross-field validation invariant. |
| **FA-4** | `VARDHAN_CANONICAL_OBJECT_SPEC` | `PolicyType::EVIDENCE_POLICY` + `PolicyContextKind` variants. |
| **FA-5** | `VARDHAN_CANONICAL_OBJECT_SPEC` | `Authorization` schema: `AuthorizationContext` enum replacing flat fields. |
| **FA-6** | `VARDHAN_OBJECT_TRAITS` | `EvidenceStore::verification_tree()` interface extension. |
| **FA-7** | `VARDHAN_CANONICAL_OBJECT_SPEC` | `PolicyEvaluation` vNext with `EvaluationSubject` and schema_version migration. |
| **FA-8** | `VARDHAN_OBJECT_TRAITS` | `VardhanAuthorityGate` (A7) verification path invariant matrix. |
| **FA-9** | `VARDHAN_OBJECT_TRAITS` | `EvidenceStore::append()` structural invariants (w/ contextual config freshness). |
| **FA-10** | `VARDHAN_CANONICAL_OBJECT_SPEC` | `StateTransitionRecord` mapping types for the 7 new ProofMesh canonical objects. |

### Subsystem Dependencies

| Target Specification | Update Required |
| :--- | :--- |
| `VARDHAN_CANONICAL_OBJECT_SPEC` | Definitions for Claim, Plan, RunRecord, Capsule, QuorumSnapshot, Finding, Scenario. |
| `VARDHAN_STATE_MACHINES` | State machines for `VerificationClaim` and `ExecutionPlan`. |
| `VARDHAN_TEST_CONTRACTS` | 9 new T-PM-* dataflow and invariant test contracts. |
| `VARDHAN_OBJECT_TRAITS` | `VerificationEvidenceProducer`, `CanonicalObjectSigner`, `ReplayEngine` traits. |
| `VARDHAN_AI_INTELLIGENCE_DESIGN` | Register `VerificationScheduler` as Intelligence Plane component. |
| `VARDHAN_SYSTEM_MAP` | ProofMesh component placement diagram. |

### Final Closure Status

| Area | Status |
| :--- | :--- |
| Taxonomy, Tenant Scope, Terminology | ✅ CLOSED (V5) |
| Typed Verification Payload | ✅ CLOSED (V5) |
| Quorum Immutability & Determinism | ✅ CLOSED (V5) |
| Canonical State vs Evidence Separation | ✅ CLOSED (V5) |
| Run/Evidence Commit Ordering | ✅ CLOSED (V5) |
| Authorization Schema for A7 | ✅ CLOSED (V6: FA-5 Expanded) |
| Signer Capability Scope | ✅ CLOSED (V6: `CanonicalObjectSigner`) |
| Config Applicability Semantics | ✅ CLOSED (V6: Contextual evaluation) |
| StateStore ↔ ProofMesh Mapping | ✅ CLOSED (V6: FA-10 Transition Types) |

All conceptual and contract-level gaps have been formally closed. The architecture is ready for freeze authorization.
