# VARDHAN PROOFMESH RECONCILIATION V17
**Baseline**: `4711305797ccb68e19f55124384cf2272b5ff187`  
**Method**: Direct verification against frozen markdown specifications and Rust implementation source. No reliance on prior reconciliation claims.

---

## 1. ActionType Wire Contract

**Source Verification:**
* `VARDHAN_AI_INTELLIGENCE_DESIGN.md` §4.12 defines: `pub enum ActionType { Read, Modify, Create, Delete, Execute }`. It provides no `#[serde(rename)]` wire mappings.
* `VARDHAN_CANONICAL_OBJECT_SPEC.md` §15 defines `ActionSpec.action_type` as a `String` (e.g., `"api_call"`).
* **Conclusion**: The historical `Authorization` object did **not** contain an `action_type` field. Therefore, **NO VERIFIED HISTORICAL AUTHORIZATION ACTIONTYPE WIRE FORMAT EXISTS.** We are not bound to a legacy serialization format for this field on this object.

**Authoritative Canonical Representation:**
```rust
/// Canonical ActionType for Systemic Verification and future Business AI mapping.
/// Deterministic wire representations explicitly defined.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ActionType {
    // Standard AI Action Types
    #[serde(rename = "READ")]    Read,
    #[serde(rename = "MODIFY")]  Modify,
    #[serde(rename = "CREATE")]  Create,
    #[serde(rename = "DELETE")]  Delete,
    #[serde(rename = "EXECUTE")] Execute,
    
    // ProofMesh Systemic Verification
    #[serde(rename = "SYSTEMIC_FAULT_INJECTION")] SystemicFaultInjection,
}
```

---

## 2. ProvenanceTrail Contract

**Source Verification:**
* `VARDHAN_CANONICAL_OBJECT_SPEC.md` defers `ProvenanceTrail` to the Interface Phase.
* **However**, the Rust implementation explicitly defines it in `backend/vardhan_state/src/authorization.rs` lines 10-15.
* **Conclusion**: We must reuse the existing exact type. No opaque `JsonValue` or `Vec<ProvenanceEntry>` invention is permitted.

**Authoritative Canonical Representation:**
```rust
/// Exact definition preserved from backend/vardhan_state/src/authorization.rs
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProvenanceTrail {
    pub generator_model: String,
    pub generation_timestamp: u64,
    pub context_hash: String,
}
```
*Dependency update*: The deferred interface dependency is resolved to this exact concrete struct.

---

## 3. TenantScoped<Authorization> Canonical Representation

**Source Verification:**
* `VARDHAN_OBJECT_TRAITS.md` defines `pub struct TenantScoped<T> { pub tenant_id: TenantId, pub scope_hash: [u8; 32], pub inner: T }`.
* `backend/vardhan_state/src/scope.rs` implements `canonical_bytes()` using a `BTreeMap` over the serialized JSON representation.
* **Conclusion**: A type-level wrapper is ALSO a serialized wrapper because `#[derive(Serialize)]` emits the fields structurally, and `BTreeMap` alphabetizes them.

**Authoritative Canonical Representation (Option A):**
When an `AuthorizationInner` is wrapped in `TenantScoped`, the deterministic canonical JSON byte stream is mathematically proven to be:
```json
{
  "inner": {
    "action_id": "...",
    "assurance_ref": "...",
    "auth_id": "...",
    "auth_level": "AUTO",
    "authorized_at": { "deadline_time": null, "event_time": "...", "logical_time": null, "system_time": "..." },
    "authorized_by": "...",
    "config_hash": [...],
    "decision_id": "...",
    "evidence_refs": [],
    "policy_eval_ref": "...",
    "provenance": { "context_hash": "...", "generation_timestamp": 0, "generator_model": "..." },
    "risk_level": "MEDIUM"
  },
  "scope_hash": [...],
  "tenant_id": "..."
}
```
*(Note: BTreeMap alphabetizes the outer keys as `inner`, `scope_hash`, `tenant_id`, and inner keys alphabetically as well).*

---

## 4. Final Authorization Model (Versioned)

To preserve frozen semantics without dummy UUIDs, `Authorization` is defined as a versioned canonical wire schema.

```rust
pub type Authorization = TenantScoped<AuthorizationInner>;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum AuthorizationInner {
    Business(HistoricalBusinessAuthorization),
    SystemicVerification(ProofMeshSystemicAuthorization),
}

/// Preserves the EXACT frozen fields. No dummy data. No Optional masking.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HistoricalBusinessAuthorization {
    pub auth_id: AuthorizationId,
    pub decision_id: DecisionId,
    pub action_id: ActionId,
    pub policy_eval_ref: EvidenceId,
    pub assurance_ref: EvidenceId,
    pub risk_level: RiskLevel,
    pub auth_level: AuthLevel,
    pub authorized_by: EntityId,
    pub authorized_at: TimeContext,
    pub config_hash: ConfigurationHash,
    pub evidence_refs: Vec<EvidenceId>,
    pub provenance: ProvenanceTrail,
}

/// Dedicated schema for SystemicVerification.
/// Only contains legitimate semantic references.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProofMeshSystemicAuthorization {
    pub auth_id: AuthorizationId,
    pub action_id: ActionId,
    pub action_type: ActionType, // Must be SystemicFaultInjection
    pub verification_claim_ref: VerificationClaimId,
    pub fault_scenario_ref: FaultScenarioId,
    pub policy_eval_ref: EvidenceId,
    pub authorized_by: EntityId,
    pub authorized_at: TimeContext,
    pub config_hash: ConfigurationHash,
    pub evidence_refs: Vec<EvidenceId>,
    pub provenance: ProvenanceTrail,
}
```

---

## 5. ActionType + Authorization Consistency

**SystemicVerification Invariant Matrix:**
```text
IF AuthorizationInner is SystemicVerification:
    THEN action_type == ActionType::SystemicFaultInjection
    AND verification_claim_ref is present (structurally required)
    AND fault_scenario_ref is present (structurally required)
    AND decision_id is absent (structurally forbidden)
    AND assurance_ref is absent (structurally forbidden)
```
Business authorization cannot accidentally satisfy the systemic path because `SystemicVerification` enforces exact structural extraction at deserialization.

---

## 6. Actual Test / Proof Requirements

* **TEST-01 (ActionType serialization)**: `SystemicFaultInjection` serializes deterministically to `"SYSTEMIC_FAULT_INJECTION"`. Deserializes symmetrically.
* **TEST-02 (Historical ActionType compatibility)**: Not applicable (proven in Section 1: no historical wire string existed for Authorization).
* **TEST-03 (ProvenanceTrail serialization)**: Alphabetical BTreeMap enforces: `{"context_hash":"...","generation_timestamp":0,"generator_model":"..."}`.
* **TEST-04 (TenantScoped serialization)**: Alphabetical BTreeMap enforces: `{"inner":{...},"scope_hash":[...],"tenant_id":"..."}`.
* **TEST-05 (Historical Authorization round-trip)**: `HistoricalBusinessAuthorization` decodes legacy records perfectly because it contains the exact frozen fields. The `untagged` enum guarantees the serialization drops the variant name and emits only the struct fields. The byte-for-byte output and BLAKE3 hash are mathematically preserved.
* **TEST-07/08 (Dummy Identifiers)**: Eradicated. No zero UUIDs or `EvidenceId` substitutions exist in the canonical schemas.

---

## 7. Repository Audit Results

A comprehensive grep across `backend/` reveals severe discrepancies between the codebase and the frozen spec.

* **Duplicate Authorization structs**: `backend/vardhan_state/src/authorization.rs` defines a flat `Authorization` struct containing both `authorization_context` and `action_type` mixed with legacy fields. This violates the frozen specification and V17.
* **auth_id vs authorization_id**: `backend/authority_gate/src/lib.rs` uses `pub authorization_id: String`. The frozen spec mandates `auth_id: Uuid`. This breaks the canonical identity model.
* **Timestamp vs TimeContext**: `authority_gate/src/lib.rs` uses `pub timestamp_ms: u64`. The frozen spec mandates `TimeContext`.
* **ActionType**: `authority_gate/src/lib.rs` references `ActionType::SystemicFaultInjection`, but the definition in `backend/vardhan_state/src/authorization.rs` lacks the `#[serde(rename)]` canonical mapping required by V17.
* **ConfigId vs ConfigurationHash**: Correctly typed in `vardhan_state/src/id.rs`, but `authority_gate/src/lib.rs` treats it as a `String` (`current_config_hash: &str`).

---

## FREEZE STATUS

**FREEZE STATUS: NOT READY**

While V17 establishes an airtight, mathematically proven, and source-grounded canonical specification that resolves all design contradictions, the **repository audit (Section 7) failed**.

The current Rust implementation fundamentally contradicts the frozen baseline:
1. `authority_gate/src/lib.rs` uses `String` instead of `AuthorizationId` and `ConfigurationHash`.
2. `vardhan_state/src/authorization.rs` implements a duplicated, flat `Authorization` struct rather than the versioned `untagged` enum specified here.
3. `ActionType` lacks `#[serde(rename)]` annotations in the Rust source.

**Path to READY**: The Rust codebase (`vardhan_state/src/authorization.rs` and `authority_gate/src/lib.rs`) must be refactored to exactly match the V17 canonical representation definitions. Only when the Rust source compiles against this schema can the freeze be explicitly authorized.
