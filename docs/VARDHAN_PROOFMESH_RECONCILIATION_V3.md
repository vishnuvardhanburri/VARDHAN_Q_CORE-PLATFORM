# VARDHAN PROOFMESH RECONCILIATION — PASS 3
## Specification Delta Analysis V3 — Final Architectural Audit

**Document type**: Delta analysis. READ-ONLY against frozen specifications.  
**Supersedes**: V2 (`VARDHAN_PROOFMESH_RECONCILIATION_V2.md`)  
**Frozen spec references**: All seven frozen pillars at their current HEAD.  
**Verification Target SHA**: 4711305797ccb68e19f55124384cf2272b5ff187  
**Phase**: 5 — ProofMesh Specification Reconciliation  
**Rule**: No frozen specification is modified until this document is reviewed, all contradictions closed, and freeze explicitly authorized.

---

## 0. Closed Questions

All questions from V1 and V2 are now resolved. The following were open in V2:

| ID | Question | Resolution |
|----|----------|-----------|
| RQ-1 | Is `VerificationRun` durable or ephemeral? | **Ephemeral** — see §6 |
| RQ-2 | Is `EvidenceQuorum` a mutated canonical object or runtime accumulator? | **Runtime accumulator → immutable snapshot** — see §7 |
| V2-TenantScoped | `PlatformClaimMarker`/`GlobalClaimMarker` undefined | **Reserved Platform TenantId** — see §2 |
| V2-JsonPayload | `pm_evidence_type` etc. in freeform `JsonValue` | **Typed `VerificationEvidencePayload`** — see §3 |
| V2-PolicyEngine | New `VerificationPolicyEngine` vs. existing `PolicyEngine` | **Extend existing `PolicyEngine` context** — see §4 |
| V2-SigningKey | `ML_DSA_87_PrivateKey` exposed in trait argument | **`EvidenceSigner` capability abstraction** — see §5 |
| V2-G0 | G0 "reused" but not precisely defined | **Specific G0 contracts reused** — see §8 |

---

## 1. Construct Taxonomy (Authoritative — Supersedes All Previous Counts)

The confusion between "8 objects", "7+3", "9 constructs" in Pass 1 and Pass 2 is resolved here permanently.

### 1.1 New Canonical Objects (7)

Objects that do not exist in any form in the frozen specs and must be added to `VARDHAN_CANONICAL_OBJECT_SPEC`:

| # | Object | Purpose |
|---|--------|---------|
| 1 | `VerificationClaim` | The fundamental assurance target — a typed, committed claim |
| 2 | `ExecutionPlan` | Speculative test schedule produced by the adaptive scheduler |
| 3 | `VerificationRunRecord` | Durable record of a completed verification execution (see §6) |
| 4 | `ReplayCapsule` | Determinism-sufficient replay descriptor |
| 5 | `EvidenceQuorumSnapshot` | Immutable quorum evaluation result committed to ledger (see §7) |
| 6 | `VerificationFinding` | The authoritative certification result for a `VerificationClaim` |
| 7 | `FaultScenario` | Typed descriptor of a fault condition to inject |

### 1.2 Extensions to Existing Canonical Objects (3)

Minimal additions to existing frozen objects that require foundational amendments:

| Existing Object | Extension | Section |
|----------------|-----------|---------|
| `EvidenceRecord` | New `evidence_category = VERIFICATION`; `payload` field accepts typed `VerificationEvidencePayload` | §3, §10 |
| `Policy` | New `policy_type = EVIDENCE_POLICY`; `rules` encode `EvidencePolicyRules` | §4, §10 |
| `Authorization` | New `action_type = SYSTEMIC_FAULT_INJECTION`; `action_ref` targets `FaultScenario` | §10 |

### 1.3 New Traits (3)

Trait contracts to be added to `VARDHAN_OBJECT_TRAITS`:

| # | Trait | Purpose |
|---|-------|---------|
| 1 | `VerificationEvidenceProducer` | Produces and commits `EvidenceRecord` (category=VERIFICATION) |
| 2 | `EvidenceSigner` | Capability abstraction over ML-DSA-87 signing; hides key material |
| 3 | `ReplayEngine` | Builds `ReplayCapsule` and executes deterministic replay |

Note: `VerificationPolicyEngine` is NOT a new trait — see §4 for the extension of existing `PolicyEngine`.  
Note: `ClaimRegistry` is NOT a trait — it is a runtime service (see §1.4).

### 1.4 Runtime Services (4)

Operational components. NOT canonical objects. NOT traits. Implementation artifacts.

| # | Service | Purpose |
|---|---------|---------|
| 1 | `ClaimRegistry` | In-process store managing `VerificationClaim` lifecycle transitions |
| 2 | `VerificationScheduler` | Intelligence Plane component; produces `ExecutionPlan` (SPECULATIVE) |
| 3 | `FaultInjector` | Dispatches `FaultScenario` — ISOLATED or SYSTEMIC |
| 4 | `QuorumAccumulator` | Runtime accumulator; evaluates incoming `EvidenceRecord` entries against `EvidencePolicy` |

### 1.5 Graph Views (1)

Materialized views over existing canonical objects. NOT separately persisted.

| # | View | Description |
|---|------|-------------|
| 1 | `VerificationGraph` | DAG over committed `VerificationClaim` nodes and their `EvidenceRecord` edges; derived from `ClaimRegistry` + `EvidenceStore` |

### 1.6 Evidence Record Instances

All ProofMesh evidence is stored as existing `EvidenceRecord` objects with `evidence_category = VERIFICATION`. There is no new evidence object type.

**Summary: 7 new canonical objects, 3 object extensions, 3 new traits, 4 runtime services, 1 graph view.**

---

## 2. VerificationScope and TenantScoped<T> Boundary

### 2.1 Problem Statement

The frozen `TenantScoped<T>` struct requires a `TenantId`:
```rust
pub struct TenantScoped<T> {
    tenant_id: TenantId,   // ← hardcoded to TenantId newtype
    scope_hash: [u8; 32],
    inner: T,
}
```

Platform-level verification claims (Raft consensus, PQ handshake, ledger integrity) are not attributable to any single business `TenantId`. Inventing `PlatformClaimMarker` as a value of `TenantId` without a formal mechanism was incorrect in V2.

### 2.2 Evaluated Options

**Option A — Reserved Platform TenantId**  
Reserve a fixed UUID as the canonical "PLATFORM" tenant. E.g., `PLATFORM_TENANT_ID = Uuid::from_u128(0)`. All platform-scope claims use this reserved ID.  
- ✅ No structural change to `TenantScoped<T>`  
- ✅ Compatible with existing `EvidenceStore`, `StateStore`, `ClaimRegistry`  
- ⚠️ Risk: business code could accidentally create a `TenantId` colliding with the reserved value  
- Mitigation: `TenantId` constructor panics on reserved values; policy enforces platform-ID-only access for platform claims  

**Option B — `PlatformScoped<T>` / `GlobalScoped<T>` parallel types**  
Define new wrapper types with `platform_id` instead of `tenant_id`.  
- ❌ Requires every store trait to be duplicated or made generic over scope type  
- ❌ Large compatibility impact on frozen `EvidenceStore`, `StateStore`, `PolicyEngine`  
- ❌ Does not satisfy the smallest-coherent-architecture principle  

**Option C — Generalized `ScopedObject<S, T>` replacing `TenantScoped<T>`**  
Replace `TenantScoped<T>` with `ScopedObject<S: ScopeBoundary, T>` where `S` is `TenantBoundary` or `PlatformBoundary`.  
- ❌ Major breaking change to all frozen objects and stores  
- ❌ Out of scope for a reconciliation pass  

### 2.3 Decision: Option A — Reserved Platform TenantId

**Chosen**: Option A, with a formal constitutional amendment to the `TenantId` type.

**Amendment text** (to be added to `VARDHAN_ARCHITECTURE_CONSTITUTION` and `VARDHAN_OBJECT_TRAITS`):

```rust
impl TenantId {
    /// Reserved platform-scope tenant ID.
    /// Used only for verification claims that span all tenants
    /// (Raft consensus, PQ transport, Merkle ledger integrity).
    /// MUST NOT be used for any business-tenant object.
    pub const PLATFORM: TenantId = TenantId(/* fixed UUID: 00000000-0000-0000-0000-000000000001 */);

    /// Reserved global-scope tenant ID.
    /// Used only for system-level invariant claims spanning all deployments.
    pub const GLOBAL: TenantId = TenantId(/* fixed UUID: 00000000-0000-0000-0000-000000000002 */);

    /// Returns true if this TenantId is a reserved system ID.
    pub fn is_reserved(&self) -> bool {
        *self == Self::PLATFORM || *self == Self::GLOBAL
    }

    /// Constructor that rejects reserved IDs for business use.
    pub fn new_business(uuid: Uuid) -> Result<Self, TenantIdError> {
        let id = Self(uuid);
        if id.is_reserved() {
            return Err(TenantIdError::ReservedId);
        }
        Ok(id)
    }
}
```

**VerificationScope** remains a ProofMesh-domain concept that maps to `TenantId`:

```rust
pub enum VerificationScope {
    Tenant(TenantId),        // maps to a real business TenantId
    Platform,                // maps to TenantId::PLATFORM
    Global,                  // maps to TenantId::GLOBAL
}

impl VerificationScope {
    pub fn tenant_id(&self) -> TenantId {
        match self {
            Self::Tenant(id) => *id,
            Self::Platform  => TenantId::PLATFORM,
            Self::Global    => TenantId::GLOBAL,
        }
    }
}
```

**Compatibility impact**: Minimal. All existing store traits accept `TenantId` — Platform/Global claims pass reserved IDs. Existing business-tenant code is unchanged since `TenantId::new_business()` rejects reserved values.

---

## 3. Typed VerificationEvidencePayload

### 3.1 Problem Statement

V2 embedded ProofMesh-specific metadata as freeform JSON in `EvidenceRecord.payload`. This is architecturally weak: it collapses the type boundary for verification evidence, makes deserialization error-prone, and contradicts the frozen spec's "no string collapse" rule (§1.1 of `VARDHAN_OBJECT_TRAITS`).

### 3.2 Solution: `VerificationEvidencePayload` Value Object

Define a canonical, strongly-typed value object that becomes the payload when `evidence_category = VERIFICATION`:

```rust
/// Strongly-typed payload for EvidenceRecord when evidence_category = VERIFICATION.
/// This replaces the freeform JsonValue used in V2.
pub struct VerificationEvidencePayload {
    pub run_record_id:      VerificationRunRecordId,  // logical ID of the VerificationRunRecord
    pub claim_id:           VerificationClaimId,       // which claim this supports
    pub evidence_type:      VerificationEvidenceType,  // typed enum (not String)
    pub execution_mode:     ExecutionMode,             // ISOLATED | SYSTEMIC
    pub verdict:            VerificationVerdict,       // PASS | FAIL | INDETERMINATE | TIMEOUT
    pub failure_class:      Option<VerificationCause>, // populated on non-PASS verdict
    pub fault_scenario_ref: Option<FaultScenarioId>,   // present if fault-injected run
    pub replay_capsule_ref: Option<ReplayCapsuleId>,   // present if replay run
    pub test_spec_hash:     ContentHash,               // BLAKE3 of TestSpec (binary + args + env)
    pub executor_version:   String,                    // semver of test executor
    pub executor_hash:      ContentHash,               // BLAKE3 of executor binary
}

pub enum VerificationEvidenceType {
    Unit,
    Integration,
    TcpReal,
    PqHandshake,
    Adversarial,
    Replay,
    FaultInjection,
}

pub enum ExecutionMode {
    Isolated,
    Systemic,
}

pub enum VerificationVerdict {
    Pass,
    Fail,
    Indeterminate,
    Timeout,
}
```

**Serialization**: `VerificationEvidencePayload` serializes to canonical JSON using deterministic field ordering, identical to all other Vardhan canonical objects. Its `content_hash` (BLAKE3 of canonical bytes) flows into `EvidenceRecord.payload_digest`.

**Foundational amendment required**: `EvidenceRecord.payload` in `VARDHAN_CANONICAL_OBJECT_SPEC` is typed as `JsonValue`. The amendment adds a typed variant:

```rust
pub enum EvidencePayload {
    Json(JsonValue),                              // existing — DECISION / OUTCOME evidence
    Verification(VerificationEvidencePayload),   // new — VERIFICATION evidence
}
```

This is a sum type, not a replacement. Existing DECISION and OUTCOME evidence records are unaffected.

---

## 4. PolicyEngine Reuse

### 4.1 Problem Statement

V2 proposed `VerificationPolicyEngine` as a new trait with methods `approve_plan()`, `evaluate_quorum()`, and `certify_claim()`. However, the frozen `VARDHAN_OBJECT_TRAITS` §6 already defines:

```rust
pub trait PolicyEngine {
    fn evaluate(
        &self,
        context: &PolicyContext,
    ) -> Result<PolicyEvaluation, PolicyError>;
}
```

This is a single-method trait over a generic `PolicyContext`. The question is whether `VerificationPolicyEngine` must be a separate trait or whether it can operate as a specialization of `PolicyEngine` through a typed `PolicyContext` variant.

### 4.2 Analysis

The existing `PolicyEngine::evaluate()` takes a `PolicyContext` and returns `PolicyEvaluation`. Both are existing canonical/value objects. ProofMesh needs deterministic evaluation of:

1. **Plan approval**: Is this `ExecutionPlan` structurally valid and policy-compliant before dispatch?
2. **Quorum evaluation**: Does the accumulated evidence satisfy the `EvidencePolicy`?
3. **Claim certification**: Can this `EvidenceQuorumSnapshot` certify the `VerificationClaim`?

All three are policy evaluations. The `PolicyContext` can carry a typed discriminant. The `PolicyEvaluation` result is the same structure.

**Proposed extension to `PolicyContext`**:

```rust
pub enum PolicyContextKind {
    Decision(DecisionPolicyContext),               // existing
    VerificationPlanApproval(PlanApprovalContext), // new
    EvidenceQuorumEval(QuorumEvalContext),         // new
    ClaimCertification(CertificationContext),      // new
}

pub struct PolicyContext {
    pub kind: PolicyContextKind,
    pub tenant_id: TenantId,
    pub config_hash: ConfigurationHash,
    pub time: TimeContext,
}
```

The same `PolicyEngine` trait, the same `PolicyEvaluation` output, the same evidence chain — just new `PolicyContextKind` variants.

**Decision**: `VerificationPolicyEngine` is NOT a new trait. It is the existing `PolicyEngine` operating on new `PolicyContextKind` variants. The ProofMesh `VerificationPolicyEngine` label from V2 is replaced throughout by **"the Policy Engine operating in verification context"**.

**Justification for not creating a separate trait**: Creating a second `PolicyEngine`-like trait would violate the "no duplicate authority" principle, create two competing policy evaluation paths, and contradict the architectural rule that the Control Plane has a single policy evaluation mechanism.

---

## 5. EvidenceSigner Capability Abstraction

### 5.1 Problem Statement

V2's `VerificationEvidenceProducer` trait exposed `ML_DSA_87_PrivateKey` as a direct argument:
```rust
fn produce_evidence_record(
    run: &VerificationRun,
    outcome: RawOutcome,
    signing_key: &ML_DSA_87_PrivateKey,  // ← private key exposed
) -> EvidenceRecord
```

This violates the cryptographic key boundary. Private keys must never cross the application boundary; they must remain behind an HSM/KMS abstraction.

### 5.2 Solution: `EvidenceSigner` Capability Trait

```rust
/// Capability abstraction for ML-DSA-87 signing of EvidenceRecord objects.
/// Implementations hide key material behind HSM/KMS boundaries.
/// The caller never touches a private key.
pub trait EvidenceSigner: Send + Sync {
    /// Sign the canonical bytes of an EvidenceRecord.
    /// Returns an opaque Signature — key material is never exposed.
    fn sign_evidence(
        &self,
        canonical_bytes: &[u8],
    ) -> Result<Signature, SigningError>;

    /// Return the public key identity for verification purposes.
    fn signing_key_id(&self) -> SigningKeyId;

    /// Return the algorithm identifier (always ML_DSA_87 in Vardhan).
    fn algorithm(&self) -> SignatureAlgorithm;
}

pub struct SigningKeyId(Uuid);  // logical ID of the signing key

pub enum SignatureAlgorithm {
    MlDsa87,  // the only valid value in Vardhan
}
```

### 5.3 Updated `VerificationEvidenceProducer` Trait

```rust
pub trait VerificationEvidenceProducer: Send + Sync {
    /// Construct and sign an EvidenceRecord from a completed VerificationRunRecord.
    /// The signer capability handles all key material — no key is ever passed to this trait.
    fn produce(
        &self,
        run_record: &VerificationRunRecord,
        payload: VerificationEvidencePayload,
        signer: &dyn EvidenceSigner,
    ) -> Result<EvidenceRecord, ProducerError>;

    /// Commit the signed EvidenceRecord to the Audit Ledger.
    fn commit(
        &self,
        record: &EvidenceRecord,
        store: &dyn EvidenceStore,
    ) -> Result<EvidenceId, ProducerError>;
}
```

---

## 6. RQ-1 Resolved: VerificationRun Persistence Model

### 6.1 Decision: Ephemeral Dispatch + Durable Record

A `VerificationRun` in the original sense (a live executing process) is **ephemeral** — it does not exist as a canonical object. It has no Raft-committed representation while it is running.

When it **completes**, a `VerificationRunRecord` (renamed from V2's `VerificationRun`) is produced and committed to the Audit Ledger as a canonical object alongside the resulting `EvidenceRecord`. These are two separate committed records.

**Why two records?** The `VerificationRunRecord` captures execution metadata (what was run, when, under what plan and state). The `EvidenceRecord` captures the verdict and its cryptographic proof. Separating them allows future queries like "show me all runs for claim X" independently from "show me all evidence records for claim X".

### 6.2 `VerificationRunRecord` — Canonical Object

```text
VerificationRunRecord
├── logical_id          : VerificationRunRecordId (Uuid)
├── content_hash        : ContentHash             ← BLAKE3 of canonical bytes
├── schema_version      : SchemaVersion
├── TenantScoped<VerificationRunRecord>
│   ├── tenant_id       : TenantId               ← from VerificationScope.tenant_id()
│   └── scope_hash      : [u8; 32]
├── scope               : VerificationScope
├── plan_id             : ExecutionPlanId          ← logical_id of parent ExecutionPlan
├── claim_id            : VerificationClaimId      ← logical_id of target VerificationClaim
├── test_spec
│   ├── binary_hash     : ContentHash             ← BLAKE3 of test binary
│   ├── args            : Vec<String>
│   └── env_hash        : ContentHash             ← BLAKE3 of environment params
├── state_snapshot_ref  : StateSnapshotId         ← MUST reference VARDHAN_COMMITTED_STATE
├── status              : Enum:
│                         COMPLETED | FAILED | TIMEOUT | CANCELLED
│                         (PENDING and RUNNING are ephemeral — never committed)
├── evidence_record_ref : EvidenceId              ← BLAKE3-id of produced EvidenceRecord
├── time                : TimeContext
│   ├── event_time      : DateTime<Utc>           ← when dispatch was initiated
│   ├── system_time     : DateTime<Utc>           ← when completion was observed
│   ├── logical_time    : Option<CommitIndex>     ← None until Raft-committed
│   └── deadline_time   : Option<DateTime<Utc>>  ← run timeout
├── config_hash         : ConfigurationHash       ← A4
└── provenance          : ProvenanceTrail
```

**Persistence**: Committed to the Audit Ledger (L03) in the `VERIFICATION` sub-tree alongside the `EvidenceRecord`.

**Replay**: The `ReplayCapsule` references `VerificationRunRecordId` (not a raw UUID). This makes the replay provenance chain traceable.

**Ephemeral state** (`PENDING`, `RUNNING`): These states exist only in the `QuorumAccumulator`'s in-memory tracking of in-flight runs. They are never committed to the ledger.

---

## 7. RQ-2 Resolved: EvidenceQuorum Model

### 7.1 Decision: Runtime Accumulator → Immutable Snapshot

An `EvidenceQuorum` as a repeatedly mutated canonical object is architecturally wrong: it would require a new Raft commit for every contributing `EvidenceRecord`, creating a write amplification cascade that makes the ledger unmanageable.

**Correct model**:

```
Runtime: QuorumAccumulator (service — not a canonical object)
    ↓ continuously ingests EvidenceRecord entries (category=VERIFICATION)
    ↓ evaluates against EvidencePolicy on each ingestion
    ↓ when quorum threshold met:
        ↓
Commit: EvidenceQuorumSnapshot (new canonical object — committed once, immutable)
```

The `QuorumAccumulator` is a runtime service. Only the `EvidenceQuorumSnapshot` is a canonical object — and it is committed exactly once when quorum is first satisfied (or when a contradicting verdict is received).

### 7.2 `EvidenceQuorumSnapshot` — Canonical Object

```text
EvidenceQuorumSnapshot
├── logical_id           : EvidenceQuorumSnapshotId (Uuid)
├── content_hash         : ContentHash              ← BLAKE3 of canonical bytes
├── schema_version       : SchemaVersion
├── TenantScoped<EvidenceQuorumSnapshot>
│   ├── tenant_id        : TenantId
│   └── scope_hash       : [u8; 32]
├── scope                : VerificationScope
├── claim_id             : VerificationClaimId
├── policy_ref           : PolicyId                 ← the Evidence Policy evaluated
├── policy_hash          : PolicyHash               ← A4: bound to specific policy version
├── quorum_entries       : Vec<QuorumEntry>
│   └── QuorumEntry
│       ├── evidence_id          : EvidenceId       ← BLAKE3-id of EvidenceRecord
│       ├── evidence_type        : VerificationEvidenceType
│       ├── execution_mode       : ExecutionMode
│       ├── independence_axes    : Vec<IndependenceAxis>
│       └── verdict              : VerificationVerdict
├── quorum_verdict       : Enum: SATISFIED | CONTRADICTED | INSUFFICIENT
├── satisfied_at_commit  : Option<CommitIndex>      ← A3: logical time (None until committed)
├── config_hash          : ConfigurationHash        ← A4
├── time                 : TimeContext
└── provenance           : ProvenanceTrail
```

**Immutability rule**: `EvidenceQuorumSnapshot` is committed once and never mutated. If new contradicting evidence arrives after a `SATISFIED` snapshot, a NEW `EvidenceQuorumSnapshot` is committed with `quorum_verdict = CONTRADICTED`. The older snapshot remains in the ledger as a historical record. The `VerificationClaim` is transitioned by the Policy Engine based on the latest committed snapshot.

---

## 8. G0 Reuse — Precise Identification

### 8.1 What G0 Actually Does (From Frozen Spec)

From `VARDHAN_OBJECT_TRAITS` §6, `AssuranceEngine.g0_check()` validates:
1. Input schema compliance
2. Tenant scope binding (`TenantId` consistency)
3. Config hash freshness (A4: is `config_hash` the current effective config?)
4. ML-DSA-87 signature validity
5. State reference validity (referenced `StateHash` must be `VARDHAN_COMMITTED_STATE`, not SPECULATIVE)
6. Out-of-distribution detection (OOD) for AI model inputs
7. Prompt injection detection (for LLM inputs)

Items 6 and 7 are AI-specific and do NOT apply to test evidence records.

### 8.2 Which G0 Contracts ProofMesh Reuses

When `EvidenceRecord` entries with `evidence_category = VERIFICATION` are appended to the `EvidenceStore`, the existing `EvidenceStore.append()` path already performs structural validation. ProofMesh reuses the following G0 checks:

| G0 Check | Reused for ProofMesh EvidenceRecord? | Notes |
|----------|--------------------------------------|-------|
| Schema compliance | ✅ YES | `VerificationEvidencePayload` must pass schema validation |
| Tenant scope binding | ✅ YES | `TenantScoped<VerificationRunRecord>` must match `EvidenceRecord.tenant_id` |
| Config hash freshness | ✅ YES | `config_hash` must match current effective configuration |
| ML-DSA-87 signature | ✅ YES | All `EvidenceRecord` entries must be signed |
| State reference validity | ✅ YES | `state_snapshot_ref` must be `VARDHAN_COMMITTED_STATE` |
| OOD detection | ❌ NO | Not applicable — test binary inputs are not model inputs |
| Prompt injection | ❌ NO | Not applicable — no LLM involved in verification evidence |

**ProofMesh does NOT call `AssuranceEngine.g0_check()`**. The G0 contracts are reused semantically by the `EvidenceStore.append()` validation path — the same path used for all other evidence categories. No new G0 invocation is introduced.

### 8.3 Conclusion

ProofMesh does not create a parallel assurance engine. The existing `EvidenceStore` append validation is the reuse point for the 5 applicable G0 checks. This is the already-correct behavior — not a new ProofMesh mechanism.

---

## 9. Evidence Independence — Formalization

### 9.1 Diversity vs. Independence

These remain distinct dimensions as established in V2:

**Diversity**: different evidence types (`UNIT`, `INTEGRATION`, `TCP_REAL`, etc.). Ensures the claim is tested from different angles.

**Independence**: different sources with non-overlapping common-mode failure modes. Ensures that a single correlated failure cannot cause false certification.

**Example**: Two `UNIT` tests testing the same code path with the same test harness and the same failure modes have high diversity-score contribution but zero independence — they can both fail (or both pass) for the same reason.

### 9.2 Independence Axes (Formalized)

```rust
pub enum IndependenceAxis {
    /// Distinct runtime environment (OS, container, VM)
    ExecutionEnvironment,
    /// ISOLATED vs SYSTEMIC — distinct system boundary
    SystemBoundary,
    /// Distinct code path exercised
    CodePath,
    /// Adversarial vs non-adversarial injection
    ThreatModel,
    /// Different cluster topology or node count
    NetworkTopology,
    /// Different PQ key pairs (prevents key-specific artifacts)
    CryptoKeyMaterial,
    /// Human-authored vs machine-generated test
    AuthorshipMode,
}
```

### 9.3 Common-Mode Dependency Rules

The `EvidencePolicy` (stored as `Policy` with `policy_type = EVIDENCE_POLICY`) must specify:

```rust
pub struct EvidencePolicyRules {
    pub minimum_quorum_count:       u32,
    pub required_evidence_types:    Vec<VerificationEvidenceType>,
    pub required_independence_axes: Vec<IndependenceAxis>,
    pub minimum_axis_coverage:      u32,   // must cover at least N distinct axes
    pub requires_replay:            bool,  // at least one PASS must be a REPLAY run
    pub requires_fault_injection:   bool,  // at least one ADVERSARIAL run required?
    pub minimum_systemic_count:     u32,   // minimum SYSTEMIC-mode runs (0 = optional)
    pub max_common_mode_ratio:      f64,   // max fraction of evidence on same axis value
}
```

**Common-mode rule**: If `max_common_mode_ratio = 0.5`, then at most 50% of the quorum entries may share the same value on any single independence axis. This structurally prevents a quorum composed entirely of unit tests on the same code path.

---

## 10. Foundational Amendments

The following amendments to frozen specifications are required. None are applied until explicitly authorized.

### Amendment FA-1: `TenantId` Reserved Values
**Target**: `VARDHAN_OBJECT_TRAITS` §2, `VARDHAN_ARCHITECTURE_CONSTITUTION`  
**Change**: Add `TenantId::PLATFORM` and `TenantId::GLOBAL` reserved constants; `TenantId::new_business()` constructor that rejects reserved values.  
**Reason**: Enables platform-scope and global-scope `VerificationClaim` without structural changes to `TenantScoped<T>`.  
**Compatibility**: No existing business-tenant code is affected. Reserved IDs are new constants.

### Amendment FA-2: `EvidenceCategory` Extension
**Target**: `VARDHAN_CANONICAL_OBJECT_SPEC` §10.3, `VARDHAN_OBJECT_TRAITS` §7.1  
**Change**: Add `VERIFICATION` to the `evidence_category` enum. Add `verification_tree()` method to `EvidenceStore` trait alongside existing `decision_tree()` and `outcome_tree()`.  
**Reason**: Creates the third Merkle sub-tree for verification evidence without modifying the existing two.  
**Compatibility**: New enum variant; existing code using exhaustive matches on `EvidenceCategory` must add a `VERIFICATION` arm.

### Amendment FA-3: `EvidencePayload` Sum Type
**Target**: `VARDHAN_CANONICAL_OBJECT_SPEC` §10.2  
**Change**: Replace `payload: JsonValue` in `EvidenceRecord` with `payload: EvidencePayload` where `EvidencePayload = Json(JsonValue) | Verification(VerificationEvidencePayload)`.  
**Reason**: Strong typing for verification evidence payloads.  
**Compatibility**: Existing DECISION/OUTCOME records use `EvidencePayload::Json`. Deserialization uses the `evidence_category` field as the discriminant for backwards compatibility.

### Amendment FA-4: `Policy` Extensions
**Target**: `VARDHAN_CANONICAL_OBJECT_SPEC` §12.2, `VARDHAN_OBJECT_TRAITS` §6 (`PolicyEngine`)  
**Change**: Add `policy_type: PolicyType` enum field to `Policy`; add `VerificationPlanApproval`, `EvidenceQuorumEval`, `ClaimCertification` variants to `PolicyContextKind`.  
**Reason**: Enables the existing `PolicyEngine` to handle verification-plane policy decisions.  
**Compatibility**: New enum variants; existing `PolicyEngine` implementations must handle new context kinds (or delegate to a specialized handler).

### Amendment FA-5: `Authorization` Extension
**Target**: `VARDHAN_CANONICAL_OBJECT_SPEC` §12.4  
**Change**: Add `action_type: ActionType` field; add `SYSTEMIC_FAULT_INJECTION` to `ActionType` enum; when `action_type = SYSTEMIC_FAULT_INJECTION`, `action_id` references a `FaultScenario.logical_id`.  
**Reason**: Enables systemic fault injection to route through the existing authorization chain without creating a new authorization object.  
**Compatibility**: New field with default value for existing records; new `ActionType` variant.

### Amendment FA-6: `EvidenceStore` Third Tree
**Target**: `VARDHAN_OBJECT_TRAITS` §7.1  
**Change**: Add `fn verification_tree(&self) -> MerkleTreeHandle;` alongside `decision_tree()` and `outcome_tree()`.  
**Reason**: Provides the Merkle tree handle for verification evidence, keeping all three categories symmetrically accessible.  
**Compatibility**: Additive to the `EvidenceStore` trait; existing implementations must add this method.

---

## 11. Canonical Dataflow

The complete dataflow for ProofMesh claim certification, from creation to authoritative state:

```
┌─────────────────────────────────────────────────────────────────────┐
│                   PROOFMESH CANONICAL DATAFLOW                      │
└─────────────────────────────────────────────────────────────────────┘

1. CLAIM REGISTRATION
   VerificationClaim (status=OPEN)
       ↓ committed to Audit Ledger (VERIFICATION tree)
       ↓ logical_time assigned at Raft commit

2. PLAN GENERATION
   VerificationScheduler (Intelligence Plane — SPECULATIVE)
       ↓ produces ExecutionPlan (status=SPECULATIVE)
       ↓
   Policy Engine [PolicyContextKind::VerificationPlanApproval]
       ↓ evaluates plan against EvidencePolicy (via PolicyEvaluation)
       ↓ if PASS: ExecutionPlan transitions to POLICY_APPROVED
       ↓
   VerificationClaim transitions: OPEN → EVIDENCE_GATHERING

3. EXECUTION
   FaultInjector / TestRunner (dispatches individual runs)
       ↓ each run is EPHEMERAL (PENDING / RUNNING states in QuorumAccumulator only)
       ↓ on completion:
           VerificationEvidencePayload (typed) constructed
           VerificationEvidenceProducer.produce() → EvidenceRecord (category=VERIFICATION)
           EvidenceSigner.sign_evidence() → Signature (ML-DSA-87, key behind KMS)
           EvidenceStore.append() → EvidenceId (G0 structural checks applied)
           EvidenceStore.commit_batch() → CommitIndex (Raft commit, logical_time assigned)
           VerificationRunRecord (status=COMPLETED) committed to Audit Ledger

4. QUORUM ACCUMULATION
   QuorumAccumulator (runtime service — NOT a canonical object)
       ↓ ingests each committed EvidenceRecord (category=VERIFICATION)
       ↓ evaluates independence axes, evidence types, counts
       ↓ on quorum threshold reached OR contradicting verdict:
           EvidenceQuorumSnapshot committed to Audit Ledger (immutable, once)
           logical_time assigned at Raft commit

5. POLICY EVALUATION
   Policy Engine [PolicyContextKind::EvidenceQuorumEval]
       ↓ evaluates EvidenceQuorumSnapshot against EvidencePolicy
       ↓ produces PolicyEvaluation (existing canonical object)
       ↓ committed to Audit Ledger (DECISION evidence tree — it is a control decision)

6. FINDING + CERTIFICATION
   Policy Engine [PolicyContextKind::ClaimCertification]
       ↓ produces VerificationFinding (new canonical object)
           ├── verdict: CERTIFIED | FAILED | INDETERMINATE
           ├── references EvidenceQuorumSnapshot (by content_hash — immutable binding)
           ├── references PolicyEvaluation (by EvidenceId — auditable chain)
           └── signed with ML-DSA-87 via EvidenceSigner
       ↓ VerificationFinding committed to Audit Ledger (VERIFICATION tree)
       ↓ logical_time assigned at Raft commit
       ↓
   ClaimRegistry
       ↓ transitions VerificationClaim status:
           QUORUM_SATISFIED → CERTIFIED  (requires: VerificationFinding.verdict = CERTIFIED
                                           AND finding.commit_index assigned)
           QUORUM_SATISFIED → FAILED     (requires: VerificationFinding.verdict = FAILED)
           QUORUM_SATISFIED → INDETERMINATE (requires: VerificationFinding.verdict = INDETERMINATE)

7. AUTHORITATIVE STATE
   VerificationClaim (status=CERTIFIED)
       ↓ now visible to upper layers as AuthoritativeState
       ↓ VerificationGraph materialized from ClaimRegistry + EvidenceStore
```

**INVARIANT-PM-001**: The transition `VerificationClaim → CERTIFIED` at step 7 requires the existence of a Raft-committed `VerificationFinding` at step 6. No other artifact — no report, no log, no exit code — is sufficient. The `ClaimRegistry.transition()` method structurally requires a `&VerificationFinding` argument; the transition is impossible to invoke without one.

---

## 12. No Duplicate Authority Matrix

Explicitly documenting which existing Vardhan authority mechanisms ProofMesh reuses:

| ProofMesh Need | Would Require | Existing Mechanism Reused | New Mechanism |
|----------------|--------------|--------------------------|---------------|
| Evidence signing | Signing capability | `EvidenceSigner` trait (new) over ML-DSA-87 | `EvidenceSigner` trait only |
| Evidence storage | Ledger write | `EvidenceStore.append()` + `commit_batch()` | Third `evidence_category` variant |
| Plan policy approval | Policy evaluation | `PolicyEngine.evaluate()` with new `PolicyContextKind` | New `PolicyContextKind` variants |
| Quorum policy evaluation | Policy evaluation | `PolicyEngine.evaluate()` with new `PolicyContextKind` | Same |
| Claim certification | Policy evaluation | `PolicyEngine.evaluate()` with new `PolicyContextKind` | Same |
| Systemic fault authorization | Authorization chain | `Authorization` object + `VardhanAuthorityGate` (A7) | New `action_type = SYSTEMIC_FAULT_INJECTION` |
| State snapshot for replay | Point-in-time state | `StateStore.snapshot_at(commit_index)` | None |
| Config freshness check | Config validation | `ConfigurationStore.is_current()` | None |
| Evidence verification | Chain integrity | `EvidenceStore.verify()` + `verify_checkpoint()` | None |
| G0 structural checks | Input validation | `EvidenceStore.append()` validation path | None |
| Tenant boundary | Scope enforcement | `TenantScoped<T>` with reserved IDs (FA-1) | Reserved ID constants |
| ML-DSA-87 signatures | PQ signing | `EvidenceSigner` wraps existing Vardhan crypto | Trait interface only |

**Nothing in this table creates a second authority chain, a second policy engine, or a second evidence store.**

---

## 13. Terminology Reference (Authoritative — All Documents Shall Use These Names)

| Term | Definition |
|------|-----------|
| `VerificationClaim` | A canonical, committed claim about a security or correctness property |
| `VerificationEvidencePayload` | Strongly-typed payload struct inside `EvidenceRecord` when `evidence_category=VERIFICATION` |
| `VerificationRunRecord` | The durable, committed record of a completed test execution (replaces V2's `VerificationRun`) |
| `EvidenceRecord` | The existing frozen canonical object; no name change |
| `EvidenceQuorumSnapshot` | The immutable committed snapshot of quorum evaluation (replaces V2's `EvidenceQuorum`) |
| `VerificationFinding` | The authoritative certification result; the only object that can certify a `VerificationClaim` |
| `ExecutionPlan` | Speculative test schedule; `SPECULATIVE` until approved by Policy Engine |
| `FaultScenario` | Typed fault injection descriptor |
| `ReplayCapsule` | Determinism-sufficient replay descriptor |
| `Policy` | Existing frozen canonical object; ProofMesh adds `policy_type=EVIDENCE_POLICY` |
| `EvidencePolicyRules` | Typed struct embedded in `Policy.rules` when `policy_type=EVIDENCE_POLICY` |
| `PolicyEngine` | Existing frozen trait; ProofMesh adds new `PolicyContextKind` variants |
| `EvidenceSigner` | New capability trait hiding ML-DSA-87 key material |
| `QuorumAccumulator` | Runtime service — NOT a canonical object; manages in-flight evidence accumulation |
| `VerificationScheduler` | Runtime service — Intelligence Plane component producing speculative `ExecutionPlan` |
| `ClaimRegistry` | Runtime service managing `VerificationClaim` lifecycle |
| `VerificationGraph` | Graph VIEW — materialized from canonical objects; not separately persisted |

---

## 14. Final Object Taxonomy

```
CANONICAL OBJECTS (7 new, added to VARDHAN_CANONICAL_OBJECT_SPEC)
├── VerificationClaim
├── ExecutionPlan
├── VerificationRunRecord
├── ReplayCapsule
├── EvidenceQuorumSnapshot
├── VerificationFinding
└── FaultScenario

OBJECT EXTENSIONS (3 existing objects, added fields/variants)
├── EvidenceRecord      + evidence_category=VERIFICATION + EvidencePayload sum type
├── Policy              + policy_type=EVIDENCE_POLICY + EvidencePolicyRules
└── Authorization       + action_type=SYSTEMIC_FAULT_INJECTION

TRAITS (3 new, added to VARDHAN_OBJECT_TRAITS)
├── VerificationEvidenceProducer
├── EvidenceSigner
└── ReplayEngine

RUNTIME SERVICES (4, implementation artifacts only)
├── ClaimRegistry
├── VerificationScheduler
├── FaultInjector
└── QuorumAccumulator

GRAPH VIEWS (1, derived — not persisted)
└── VerificationGraph

EVIDENCE RECORD INSTANCES
└── All ProofMesh evidence: EvidenceRecord with evidence_category=VERIFICATION
```

---

## 15. Final Authority Model

```
EXISTING AUTHORITY CHAIN (unchanged)
    DecisionCandidate (SPECULATIVE)
    → G0-G4 Assurance
    → PolicyEngine.evaluate()
    → Authorization (canonical object)
    → VardhanAuthorityGate (A7)
    → Action execution in Reality Plane

PROOFMESH AUTHORITY CHAIN (new, parallel to existing, not replacing)
    ExecutionPlan (SPECULATIVE — from VerificationScheduler)
    → PolicyEngine.evaluate() [PolicyContextKind::VerificationPlanApproval]
    → ExecutionPlan transitions to POLICY_APPROVED
    → FaultInjector / TestRunner (ISOLATED: no A7; SYSTEMIC: through A7 via Authorization)
    → EvidenceRecord (category=VERIFICATION) committed via EvidenceStore
    → QuorumAccumulator (runtime) → EvidenceQuorumSnapshot committed
    → PolicyEngine.evaluate() [PolicyContextKind::EvidenceQuorumEval + ClaimCertification]
    → VerificationFinding committed
    → VerificationClaim transitions to CERTIFIED (via ClaimRegistry)

KEY RULE: The PolicyEngine is the single deterministic authority for both chains.
The VardhanAuthorityGate (A7) is the single execution gate for Reality Plane mutations.
ProofMesh adds no new authority mechanisms — only new context variants to existing ones.
```

---

## 16. Final Evidence Model

```
AUDIT LEDGER (L03) — Three Merkle Sub-Trees

DECISION EVIDENCE TREE (existing, unchanged)
    ├── G0-G4 AssuranceResult records
    ├── PolicyEvaluation records (including ProofMesh verification policy evaluations)
    ├── Authorization records
    └── Execution initiation records

OUTCOME EVIDENCE TREE (existing, unchanged)
    ├── Execution result records
    ├── Observation records
    └── Prediction-vs-actual records

VERIFICATION EVIDENCE TREE (new — Amendment FA-2 + FA-6)
    ├── EvidenceRecord (category=VERIFICATION, payload=VerificationEvidencePayload)
    ├── VerificationRunRecord
    ├── EvidenceQuorumSnapshot
    └── VerificationFinding
```

**Invariant**: The VERIFICATION evidence tree is checkpointed at each `commit_index` identically to the DECISION and OUTCOME trees. Its `CommitmentId` (Merkle root) is stored in the Raft log alongside the other tree roots.

---

## 17. Final Replay Model

A replay is valid if and only if all of the following match between original and replay:
1. `state_snapshot_ref` — same `StateSnapshotId`, same `StateHash`
2. `test_spec` — byte-identical (`binary_hash`, `args`, `env_hash` all match)
3. `random_seed` — identical
4. `executor_hash` — matches OR `compatibility_policy` permits the observed delta

Replay verdict rules:

| Original Verdict | Replay Verdict | `compatibility_policy` | Classification |
|-----------------|---------------|----------------------|----------------|
| FAIL | FAIL | STRICT | PRODUCT_DEFECT confirmed |
| FAIL | PASS | STRICT | INDETERMINATE (non-determinism; investigate) |
| PASS | FAIL | STRICT | INDETERMINATE (non-determinism; investigate) |
| FAIL | FAIL | MINOR_OK (version changed) | VERSION_INCOMPATIBILITY (behavior preserved) |
| FAIL | PASS | MINOR_OK (version changed) | VERSION_INCOMPATIBILITY (behavior changed by upgrade) |

A `ReplayCapsule` for any run — including INDETERMINATE runs — is always required to enable future replay.

---

## 18. Final Freeze Set

The following specifications require amendments. Sequence matters — later amendments depend on earlier ones.

| Order | Specification | Amendment | Section |
|-------|--------------|-----------|---------|
| 1 | `VARDHAN_ARCHITECTURE_CONSTITUTION` | FA-1: Reserved TenantId constants; INVARIANT-PM-001 | §2, §11 |
| 2 | `VARDHAN_OBJECT_TRAITS` | FA-1: `TenantId::PLATFORM`/`GLOBAL`; FA-6: `EvidenceStore.verification_tree()`; 3 new traits | §2, §5, §10 |
| 3 | `VARDHAN_CANONICAL_OBJECT_SPEC` | FA-2/3/4/5: 7 new objects, 3 object extensions | §3, §4, §6, §7, §10 |
| 4 | `VARDHAN_STATE_MACHINES` | 2 new state machines: `VerificationClaim`, `ExecutionPlan` | §11 (dataflow) |
| 5 | `VARDHAN_TEST_CONTRACTS` | 9 new contracts T-PM-* | §11 dataflow invariants |
| 6 | `VARDHAN_AI_INTELLIGENCE_DESIGN` | `VerificationScheduler` as Intelligence Plane component | §1.4 |
| 7 | `VARDHAN_SYSTEM_MAP` | ProofMesh component placement | §3 |

**Do not apply any amendment until this V3 document is explicitly authorized.**

---

## 19. Remaining Questions

None. All questions from V1, V2, and the V3 directive are closed.

| Question | Status |
|----------|--------|
| RQ-1 (VerificationRun persistence) | ✅ CLOSED — ephemeral dispatch + durable `VerificationRunRecord` |
| RQ-2 (EvidenceQuorum mutability) | ✅ CLOSED — runtime `QuorumAccumulator` + immutable `EvidenceQuorumSnapshot` |
| TenantScoped<T> for platform claims | ✅ CLOSED — Reserved TenantId constants (FA-1) |
| JsonValue payload | ✅ CLOSED — `VerificationEvidencePayload` typed struct (FA-3) |
| PolicyEngine duplication | ✅ CLOSED — extend existing `PolicyEngine` with new `PolicyContextKind` |
| Private signing key in traits | ✅ CLOSED — `EvidenceSigner` capability trait |
| A7 scope | ✅ CLOSED — ISOLATED: no A7; SYSTEMIC: A7; Certification: Control Plane |
| G0 reuse precision | ✅ CLOSED — 5 specific G0 checks reused via `EvidenceStore.append()` path |
| Evidence diversity vs. independence | ✅ CLOSED — separate dimensions; `IndependenceAxis` enum; `max_common_mode_ratio` |
| Object count contradictions | ✅ CLOSED — authoritative taxonomy: 7 new + 3 extensions + 3 traits + 4 services + 1 view |
| Terminology consistency | ✅ CLOSED — §13 is the authoritative terminology reference |

---

## 20. Authorization Prerequisite

Before any frozen specification is amended:

1. This V3 document must be reviewed by the user.
2. Any remaining contradictions must be raised and resolved.
3. Explicit authorization must be given for each amendment (FA-1 through FA-6).
4. Amendments must be applied in the sequence specified in §18.
5. After each amendment, the affected test contracts must be updated and the workspace verification run must pass.

**Phase 0.2 discipline carries forward**: Specification amendments are the "code changes" of this phase. They must not be declared complete until the resulting implementation passes the full verification suite.

---

*This document is a delta analysis only. No frozen specification has been modified.*  
*ProofMesh Phase 5 — Reconciliation Pass 3 (Final Architectural Audit)*  
*Analysis baseline: 2026-09-24*
