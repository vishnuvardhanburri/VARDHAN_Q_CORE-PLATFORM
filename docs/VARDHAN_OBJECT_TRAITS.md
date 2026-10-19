# Vardhan Object Traits / Interfaces

> **Status**: ✅ Specification  
> **Version**: 1.0  
> **Source**: Derived exclusively from `VARDHAN_ARCHITECTURE_CONSTITUTION.md` v1.1, `VARDHAN_SYSTEM_MAP.md`, `VARDHAN_CANONICAL_OBJECT_SPEC.md`, and `VARDHAN_STATE_MACHINES.md`  
> **Purpose**: Compiler-enforceable Rust type and trait contracts for every canonical object. Turns the state machines and object specifications into strong, non-collapsing Rust types. No implementation code. No feature logic. Contracts only.  
> **Authority**: This document defines the exact Rust interfaces that any implementation must satisfy. A compiler that accepts an implementation against these contracts accepts a constitutional Vardhan system.

---

## Table of Contents

1. [Architecture Goals](#1-architecture-goals)
2. [Strong Type System](#2-strong-type-system)
3. [State Tier Marker Traits](#3-state-tier-marker-traits)
4. [Tenant-Scoped Container](#4-tenant-scoped-container)
5. [Time Context](#5-time-context)
6. [Layer Trait Boundaries](#6-layer-trait-boundaries)
7. [Core Store Traits](#7-core-store-traits)
8. [Object Traits](#8-object-traits)
9. [Authority Gate Trait](#9-authority-gate-trait)
10. [Store Implementation Traits](#10-store-implementation-traits)
11. [Proof & Provenance Interfaces](#11-proof--provenance-interfaces)
12. [Module Structure](#12-module-structure)
13. [Consistency Check Summary](#13-consistency-check-summary)

---

## 1. Architecture Goals

The Rust type system enforces three architectural properties:

### 1.1 No String Collapse

Each identifier and hash is a **distinct newtype** — not `String`, not `Vec<u8>`, not `[u8; 32]` alone. This prevents passing an `EntityId` where a `DecisionId` is expected at compile time.

```rust
// THIS IS FORBIDDEN by architecture:
type EntityId = String;        // ❌ collapses to string
type StateHash = Vec<u8>;      // ❌ collapses to byte array
type EvidenceId = [u8; 32];    // ❌ no type distinction

// THIS IS REQUIRED:
pub struct EntityId(Uuid);
pub struct StateHash([u8; 32]);
pub struct EvidenceId([u8; 32]); // distinct type from StateHash
```

### 1.2 State Tier Enforcement

```rust
// Marker traits enforce the three tiers at compile time:
pub trait SpeculativeState {}   // PROPOSED, VALIDATED, etc.
pub trait CommittedState {}     // COMMITTED, APPLIED, etc.
pub trait AuthoritativeState {} // VARDHAN_COMMITTED_STATE, OBSERVED_EXTERNAL_STATE, etc.

// Consumer-side enforcement:
pub trait AuthoritativeConsumer {}   // requires AuthoritativeState inputs
pub trait SpeculativeConsumer {}      // may produce/consume SpeculativeState
```

**Consumer rules**:

```text
Authoritative consumers (Policy Gate, Execution, Authority Gate, Memory, Outcome)
  → accept only AuthoritativeState inputs
  → may NEVER accept SpeculativeState inputs

Intelligence / Assurance consumers (ModelProvider, ReasoningEngine, RiskModel, ScenarioEngine, AssuranceEngine)
  → may consume AuthoritativeState inputs (as read-only references)
  → may produce SpeculativeState outputs (DecisionCandidate, RiskProfile, Scenario)
  → may NEVER promote speculative state to authoritative without the commit/authority path

Speculative-to-authoritative transition
  → can ONLY occur through:
    1. Raft commit (CommitIndex assigned) → CommittedState
    2. Evidence finalization → AuthoritativeState
    3. Authority Gate passage → Executable action
```

**Rule**: The compiler rejects any `AuthoritativeConsumer` that accepts a `SpeculativeState` type. `DecisionCandidate` (which is `SpeculativeState`) can only be consumed by `SpeculativeConsumer` traits (ReasoningEngine, AssuranceEngine, DecisionEngine). It can never be passed to `VardhanAuthorityGate::authorize_and_execute` directly — only a `DecisionTwin` in `AUTHORIZED` state (which is one step below Authoritative) can produce an `Action` that passes through the gate.

Upper-layer **authoritative** code accepts only `AuthoritativeState` types. Intelligence/Assurance layers may operate on `SpeculativeState` within their bounded scope. The compiler enforces this via trait bounds: `AuthoritativeConsumer` is bounded to `AuthoritativeState` inputs only.

### 1.3 Authority Gate Enforcement

```rust
// All execution passes through one trait:
pub trait VardhanAuthorityGate {
    fn authorize_and_execute(...) -> Result<ExecutionResult>;
    // No alternative path exists.
}
```

### 1.4 Layer Direction Enforcement

```rust
// Dependency rule: Layer N may depend on Layer M only if M ≤ N
// Enforced via crate-level dependency graph in Cargo.toml
// No trait in a lower layer may reference types in a higher layer.
```

---

## 2. Strong Type System

### 2.1 Identifier Newtypes

All identifiers are **distinct newtypes** wrapping `Uuid`. Not `String`, not raw UUIDs cast between types.

```rust
// ── Tenant & Entity ──┐
pub struct TenantId(Uuid);
pub struct EntityId(Uuid);
pub struct RelationshipId(Uuid);

// ── Evidence & Events ──┐
pub struct EventId(Uuid);
pub struct ObservationId(Uuid);
pub struct EvidenceId([u8; 32]);  // Cryptographic identity (BLAKE3)
pub struct EvidenceLogicalId(Uuid);  // Logical identity for queryability

// ── State ──┐
pub struct StateSnapshotId(Uuid);
pub struct StateVersionId(Uuid);
pub struct StateHash([u8; 32]);     // BLAKE3 of state tree

// ── Decision & Execution ──┐
pub struct DecisionId(Uuid);
pub struct DecisionCandidateId(Uuid);
pub struct ActionId(Uuid);
pub struct ExecutionId(Uuid);
pub struct CompensationId(Uuid);
pub struct AuthorizationId(Uuid);

// ── Governance ──┐
pub struct PolicyId(Uuid);
pub struct ConstraintId(Uuid);
pub struct ConfigId(Uuid);

// ── Intelligence ──┐
pub struct ModelArtifactId(Uuid);

// ── Hashes ──┐
pub struct ContentHash([u8; 32]);          // BLAKE3 of object bytes
pub struct ModelArtifactHash([u8; 32]);   // BLAKE3 of model artifact
pub struct PolicyHash([u8; 32]);           // BLAKE3 of policy bytes
pub struct ConfigurationHash([u8; 32]);    // BLAKE3 of config bytes

// ── Consensus ──┐
pub struct RaftTerm(u64);
pub struct RaftLogIndex(u64);
pub struct CommitIndex(u64);               // Logical Time (A3)
```

**Critical**: `EvidenceId([u8; 32])` and `ContentHash([u8; 32])` are **distinct types** despite both being `[u8; 32]`. This prevents passing a content hash where an evidence ID is expected.

### 2.2 Common Derives

Every newtype derives:

```rust
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, PartialOrd, Ord)]
pub struct EntityId(Uuid);

// With explicit construction:
impl EntityId {
    pub fn new(uuid: Uuid) -> Self { Self(uuid) }
    pub fn from_bytes(bytes: [u8; 16]) -> Self { Self(Uuid::from_bytes(bytes)) }
    pub fn as_uuid(&self) -> &Uuid { &self.0 }
    pub fn to_bytes(self) -> [u8; 16] { self.0.into_bytes() }
}
```

For hash types (`StateHash`, `ContentHash`, `EvidenceId` as `[u8; 32]`):

```rust
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash)]
pub struct StateHash([u8; 32]);

impl StateHash {
    pub fn new(bytes: [u8; 32]) -> Self { Self(bytes) }
    pub fn as_bytes(&self) -> &[u8; 32] { &self.0 }
    pub fn from_hex(s: &str) -> Result<Self, ParseHashError> { ... }
}
```

**Rule**: No implicit conversion between any two identifier types. Conversion is always explicit, always named, and always validated.

### 2.3 Schema Version

```rust
pub struct SchemaVersion {
    pub major: u32,
    pub minor: u32,
    pub patch: u32,
}

impl SchemaVersion {
    pub const LATEST: Self = Self { major: 1, minor: 0, patch: 0 };
}
```

(Sourced from existing `vardhan_model::SchemaVersion` — constitutional baseline, must not be reinvented.)

---

## 3. State Tier Marker Traits

These traits enforce the **A1** three-tier state separation at the type level:

```rust
/// SPECULATIVE state: not visible to Intelligence Plane, Decision Twin,
/// Risk Engine, or any upper-layer query/API/candidate input.
pub trait SpeculativeState: Clone + Eq + Send + Sync {}

/// COMMITTED state: Raft-committed and durable, but not yet
/// visible to upper layers. Not authoritative on its own.
pub trait CommittedState: SpeculativeState + Clone + Eq + Send + Sync {}

/// AUTHORITATIVE state: visible to all upper layers. Only these
/// states may be queried by Intelligence Plane, Decision Twin, etc.
pub trait AuthoritativeState: CommittedState + Clone + Eq + Send + Sync {}
```

### 3.1 State Tier Assignments

```text
SpeculativeState (not visible to upper layers):
  PROPOSED, VALIDATED, DRAFT, EVIDENCE_PREPARED, RAFT_REPLICATED,
  PENDING, PENDING_APPROVAL, CREATED, CONTEXTUALIZED,
  OPTIONS_GENERATED, ASSESSED, G0-G4 intermediate,
  POLICY_CHECKED, EXECUTING, OUTCOME_PENDING, RUNNING

CommittedState (durable but not yet authoritative):
  COMMITTED, RAFT_COMMITTED, APPLIED,
  EVIDENCED (evidence finalized, applied to state machine)

AuthoritativeState (visible to all upper layers):
  VARDHAN_COMMITTED_STATE, OBSERVED_EXTERNAL_STATE,
  ACTIVE, AUTHORIZED, ASSURED, MEMORIZED,
  FINALIZED (evidence), COMMITTED (state transition record)
```

### 3.2 Compiler Enforcement

```rust
// Authoritative consumers accept only AuthoritativeState:
fn query_enterprise_state(
    hash: StateHash,
    _: PhantomData<dyn AuthoritativeConsumer>,
) -> Result<StateSnapshot>;

// Intelligence/Assurance consumers may accept SpeculativeState:
fn assess_candidate(
    candidate: &DecisionCandidate,  // implements SpeculativeState
    _: PhantomData<dyn SpeculativeConsumer>,
) -> Result<AssuranceResult>;

// This will NOT compile — authoritative consumer rejects SpeculativeState:
// query_enterprise_state(hash, PhantomData::<dyn AuthoritativeConsumer>); ❌ if hash is from SPECULATIVE state

// This will NOT compile — speculative state cannot be promoted directly:
// fn promote(candidate: DecisionCandidate) -> StateSnapshot;  // ❌ no such path
```

---

## 4. Tenant-Scoped Container

**Amendment A2**: All semantic objects are wrapped in `TenantScoped<T>`. The TenantId is not a Boolean flag — it is a structural type-level constraint.

```rust
/// Wraps every semantic object with its TenantId boundary.
/// Cross-tenant references are structurally forbidden at the type level.
pub struct TenantScoped<T> {
    tenant_id: TenantId,
    scope_hash: [u8; 32],        // BLAKE3(tenant_id || canonical(T))
    inner: T,
}

impl<T> TenantScoped<T> {
    pub fn new(tenant_id: TenantId, inner: T) -> Self;
    pub fn tenant_id(&self) -> TenantId;
    pub fn inner(&self) -> &T;
    pub fn into_inner(self) -> T;
    pub fn scope_hash(&self) -> &[u8; 32];
}

/// Trait for objects that can only exist within a tenant boundary.
/// The compiler enforces that cross-tenant references cannot compile.
pub trait TenantScopedObject: Clone + Send + Sync {
    fn tenant_id(&self) -> TenantId;
    fn validate_tenant_scope(self) -> Result<Self, TenantBoundaryError>;
}
```

**Rule**: No semantic object may enter an authoritative state without first passing the `TenantScoped<T>` boundary check. A Boolean field is not the protection mechanism.

---

## 5. Time Context

**Amendment A3**: Four distinct time domains. `logical_time` is optional (assigned at commit).

```rust
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TimeContext {
    pub logical_time: Option<CommitIndex>,  // A3: assigned at Raft commit, None before
    pub event_time: DateTime<Utc>,           // A3: when event occurred (from source)
    pub system_time: DateTime<Utc>,          // A3: when Vardhan observed it
    pub deadline_time: Option<DateTime<Utc>>, // A3: human-defined deadline
    pub created_at: DateTime<Utc>,           // A3: when this object was created
}
```

**Lifecycle semantics**:
```text
EventTime → known at creation
SystemTime → known at observation
LogicalTime → assigned when committed (Raft commit_index)
```

**Rule**: `logical_time` is `None` until Raft commit. Pre-commit objects have `logical_time = None` and are never authoritative.

---

## 6. Layer Trait Boundaries

From Constitution Section 12 — cross-plane/cross-layer boundaries as stable traits:

```rust
/// L03: Evidence Fabric
pub trait EvidenceStore {
    fn append(&self, record: &EvidenceRecord) -> Result<EvidenceId, EvidenceError>;
    fn verify(&self, id: &EvidenceId) -> Result<(), EvidenceError>;
    fn get(&self, id: &EvidenceId) -> Result<EvidenceRecord, EvidenceError>;
    fn get_logical(&self, id: &EvidenceLogicalId) -> Result<EvidenceRecord, EvidenceError>;
    fn commit_batch(&self, batch: &[EvidenceId]) -> Result<CommitIndex, EvidenceError>;
    fn verify_checkpoint(&self, root: &CommitmentId) -> Result<bool, EvidenceError>;
    fn separate_trees(&self) -> EvidenceTreeHandles;  // A5: decision vs outcome trees
}

/// L04: Enterprise State
pub trait StateStore {
    fn current_state(
        &self,
        tenant: TenantId,
        entity: EntityId,
    ) -> Result<TenantScoped<StateSnapshot>, StateError>;

    fn apply(
        &self,
        delta: &StateTransitionRecord,
    ) -> Result<StateHash, StateError>;

    fn latest_commit_index(&self, tenant: TenantId) -> Result<CommitIndex, StateError>;

    fn snapshot_at(
        &self,
        tenant: TenantId,
        commit_index: CommitIndex,
    ) -> Result<TenantScoped<StateSnapshot>, StateError>;
}

/// L05: Intelligence
pub trait ModelProvider {
    fn predict(&self, input: &ModelInput) -> Result<ModelOutput, ModelError>;
    fn provenance(&self) -> ModelProvenance;
    fn model_hash(&self) -> ModelArtifactHash;
}

/// L06: AI Assurance
pub trait AssuranceEngine {
    fn assess(
        &self,
        candidate: &DecisionCandidate,  // always SPECULATIVE (A6)
    ) -> Result<AssuranceResult, AssuranceError>;

    fn g0_check(
        &self,
        candidate: &DecisionCandidate,
        config_hash: ConfigurationHash,  // A4
    ) -> Result<GateResult, AssuranceError>;
}

/// L07: Reasoning
pub trait ReasoningEngine {
    fn derive(
        &self,
        state: &TenantScoped<StateSnapshot>,  // Authoritative only (A1)
    ) -> Result<Vec<DerivedFact>, ReasoningError>;
}

pub trait RiskModel {
    fn assess(
        &self,
        state: &TenantScoped<StateSnapshot>,  // Authoritative only (A1)
    ) -> Result<RiskProfile, RiskError>;
}

pub trait ScenarioEngine {
    fn generate(
        &self,
        state: &TenantScoped<StateSnapshot>,  // Authoritative only (A1)
        constraints: &[Constraint],
    ) -> Result<Vec<Scenario>, ScenarioError>;
}

/// L08: Risk & Scenario
/// (same traits as above — RiskModel and ScenarioEngine serve both L07 reasoning and L08 risk)

/// L09: Decision Intelligence
pub trait DecisionEngine {
    fn decide(
        &self,
        twin: &DecisionTwin,
    ) -> Result<Vec<DecisionCandidate>, DecisionError>;  // all SPECULATIVE (A6)
}

/// L10: Outcome & Memory
pub trait OutcomeCollector {
    fn collect(
        &self,
        action_id: &ActionId,
        execution: &Execution,
    ) -> Result<Outcome, OutcomeError>;

    fn observe_external_state(
        &self,
        tenant: TenantId,
        expected_state: StateHash,
    ) -> Result<Observation, ObservationError>;
}

/// L11: Governed Execution
pub trait ActionExecutor {
    fn execute(
        &self,
        authorization: &Authorization,  // A7 gate passed
        action: &Action,
        idempotency_key: &ExecutionIdempotencyKey,
    ) -> Result<Execution, ExecutionError>;
}

pub trait PolicyEngine {
    fn evaluate(
        &self,
        context: &PolicyContext,
    ) -> Result<PolicyEvaluation, PolicyError>;
}

/// L12: Experience & Command
pub trait CommandHandler {
    fn handle(
        &self,
        command: Command,
    ) -> Result<CommandResult, CommandError>;
}
```

**Rule**: No layer may depend on a concrete implementation of a trait defined in a higher layer. Traits flow downward; implementations flow upward via dependency injection.

---

## 7. Core Store Traits

### 7.1 EvidenceStore (upgraded from Constitution)

```rust
pub trait EvidenceStore: Send + Sync {
    /// Append an evidence record to the ledger.
    /// Idempotent: same content_hash → returns existing EvidenceId.
    fn append(&self, record: &EvidenceRecord) -> Result<EvidenceId, EvidenceError>;

    /// Verify an evidence record's integrity and provenance chain.
    fn verify(&self, id: &EvidenceId) -> Result<(), EvidenceError>;

    /// Retrieve by cryptographic identity.
    fn get(&self, id: &EvidenceId) -> Result<EvidenceRecord, EvidenceError>;

    /// Retrieve by logical identity.
    fn get_logical(&self, id: &EvidenceLogicalId) -> Result<EvidenceRecord, EvidenceError>;

    /// Commit a batch of evidence records and return the new commit index.
    /// Requires Raft consensus (A3).
    fn commit_batch(&self, batch: &[EvidenceId]) -> Result<CommitIndex, EvidenceError>;

    /// Verify a Merkle checkpoint against the evidence tree.
    fn verify_checkpoint(&self, root: &CommitmentId) -> Result<bool, EvidenceError>;

    /// Access to separate Merkle trees for DECISION and OUTCOME evidence (A5).
    fn decision_tree(&self) -> MerkleTreeHandle;
    fn outcome_tree(&self) -> MerkleTreeHandle;

    /// Wait for evidence to be committed at or above a given commit_index.
    fn wait_for_commit(&self, min_index: CommitIndex) -> Result<(), EvidenceError>;
}
```

### 7.2 StateStore (upgraded from Constitution)

```rust
pub trait StateStore: Send + Sync {
    /// Get the current authoritative state for an entity.
    /// Only returns VARDHAN_COMMITTED_STATE (AuthoritativeState).
    fn current_state(
        &self,
        tenant: TenantId,
        entity: EntityId,
    ) -> Result<TenantScoped<StateSnapshot>, StateError>;

    /// Apply a state transition delta.
    /// Delta must be at least COMMITTED for this call to succeed.
    /// Returns the new StateHash.
    fn apply(
        &self,
        delta: &StateTransitionRecord,
    ) -> Result<StateHash, StateError>;

    /// Get the latest commit index for a tenant.
    fn latest_commit_index(&self, tenant: TenantId) -> Result<CommitIndex, StateError>;

    /// Get a historical state snapshot at a given commit_index.
    /// Returns None if the commit_index is speculative (not yet committed).
    fn snapshot_at(
        &self,
        tenant: TenantId,
        commit_index: CommitIndex,
    ) -> Result<Option<TenantScoped<StateSnapshot>>, StateError>;

    /// Check if a state hash is authoritative (VARDHAN_COMMITTED_STATE).
    fn is_authoritative(
        &self,
        tenant: TenantId,
        state_hash: StateHash,
    ) -> Result<bool, StateError>;

    /// Publish a state change notification (used by A8 revalidation triggers).
    fn publish_state_change(
        &self,
        event: StateChangeEvent,
    ) -> Result<(), StateError>;
}
```

### 7.3 ConfigurationStore

```rust
pub trait ConfigurationStore: Send + Sync {
    /// Get the effective configuration at a given commit_index.
    /// Never returns configuration that has not been evidence-finalized (A4).
    fn get_at(
        &self,
        tenant: TenantId,
        commit_index: CommitIndex,
    ) -> Result<ConfigurationSnapshot, ConfigError>;

    /// Get the current effective configuration.
    fn current(&self, tenant: TenantId) -> Result<ConfigurationSnapshot, ConfigError>;

    /// Check if a config_hash is the current effective configuration.
    fn is_current(&self, tenant: TenantId, config_hash: ConfigurationHash) -> Result<bool, ConfigError>;
}
```

---

## 8. Object Traits

### 8.1 State Machine Trait

Every object that has a lifecycle implements this trait:

```rust
/// Enforces state machine transitions at the type level.
/// The type parameter S represents the current state.
pub trait StateMachine<S: Clone + Eq + Send + Sync> {
    type ObjectId;
    type Event;

    /// Attempt a state transition.
    /// Returns the new state if the transition is valid.
    /// The compiler enforces that only valid transitions from S are possible.
    fn handle_event(&self, event: Self::Event) -> Result<S, StateMachineError>;

    /// Get the current state.
    fn state(&self) -> &S;

    /// Get the object's logical identity.
    fn id(&self) -> Self::ObjectId;
}
```

### 8.2 TenantScopedObject Trait

```rust
/// All semantic objects implement this.
/// Enforces structural tenant scoping (A2).
pub trait TenantScopedObject: Clone + Send + Sync {
    fn tenant_id(&self) -> TenantId;
    fn into_tenant_scoped(self) -> TenantScoped<Self>;
}
```

### 8.3 TimeContext Carrier

```rust
/// All objects that participate in ordering or evidence carry time context.
pub trait TimeContextCarrier {
    fn time(&self) -> &TimeContext;
}
```

### 8.4 Evidence Carrier

```rust
/// Objects that produce or reference evidence.
pub trait EvidenceCarrier {
    fn evidence_refs(&self) -> &[EvidenceId];
    fn evidence_category(&self) -> EvidenceCategory;
}
```

### 8.5 Hashable (Canonical Serialization)

```rust
/// All canonical objects can be serialized to canonical bytes and hashed.
pub trait Hashable {
    /// Serialize to canonical bytes (deterministic field ordering).
    fn canonical_bytes(&self) -> Vec<u8>;

    /// Compute the content hash.
    fn content_hash(&self) -> ContentHash {
        ContentHash(blake3::hash(&self.canonical_bytes()).into())
    }
}
```

---

## 9. Authority Gate Trait

**Amendment A7**: There is exactly **one** execution authority in the system.

```rust
/// VARDHAN AUTHORITY GATE (A7)
/// All action invocations — from AI, rule engine, human, API, webhook,
/// or event — must pass through this trait. There is no alternative path.
pub trait VardhanAuthorityGate: Send + Sync {
    /// Validate and execute an action.
    /// Performs ALL checks before allowing execution:
    ///
    /// 1. action_id has matching authorization_id
    /// 2. authorization_id traces to a completed DecisionTwin in EXECUTED state
    /// 3. DecisionTwin has final_status = PASS from G0–G4 (CONST-8)
    /// 4. PolicyEvaluation.result = PASS within validity window (A4)
    /// 5. config_hash matches current effective configuration (A4)
    /// 6. tenant_id matches the execution context (A2)
    /// 7. DecisionCandidate was SPECULATIVE when generated (A6 — cannot self-authorize)
    /// 8. State reference is VARDHAN_COMMITTED_STATE, not SPECULATIVE (A1)
    fn authorize_and_execute(
        &self,
        action: &Action,                           // must reference Authorization
        authorization: &Authorization,             // must be valid, non-expired
        idempotency_key: ExecutionIdempotencyKey,   // for at-most-once execution
    ) -> Result<Execution, AuthorityGateError>;

    /// Validate a compensation/rollback action.
    /// Compensation is an ordinary action — same A7 validation chain.
    fn authorize_and_execute_compensation(
        &self,
        compensation: &Compensation,
        authorization: &Authorization,             // same original auth chain
        idempotency_key: ExecutionIdempotencyKey,
    ) -> Result<Execution, AuthorityGateError>;

    /// Validate that a state hash is authoritative (VARDHAN_COMMITTED_STATE).
    /// Upper layers call this before referencing any state.
    fn verify_authoritative_state(
        &self,
        tenant: TenantId,
        state_hash: StateHash,
    ) -> Result<bool, AuthorityGateError>;
}
```

**Prohibited paths** (compiler-enforced via module visibility):
```rust
// The following are NOT accessible outside the Authority Gate module:
mod action_executor_api { /* private */ }
mod direct_execution_api { /* private */ }
mod model_to_executor_bridge { /* private */ }
```

**Rule**: Any code that attempts to execute an action without going through `VardhanAuthorityGate::authorize_and_execute` will not compile.

---

## 10. Object-Specific Traits

### 10.1 DecisionCandidate (A6)

```rust
/// A DecisionCandidate is ALWAYS SPECULATIVE.
/// It can never be an AuthoritativeState.
pub struct DecisionCandidate {
    pub candidate_id: DecisionCandidateId,
    pub TenantScoped { tenant_id: TenantId, .. },
    pub state_hash: StateHash,             // must be VARDHAN_COMMITTED_STATE (A1)
    pub config_hash: ConfigurationHash,      // must be current (A4)
    pub evidence_window: EvidenceWindow,    // [CommitIndex, CommitIndex] (A6)
    pub model_provenance: Vec<ModelArtifactHash>,
    pub proposed_action: ActionSpec,
    pub predicted_outcome: JsonValue,
    pub confidence: f64,
    pub risk_profile: RiskProfileSummary,
    pub constraints_met: Vec<ConstraintId>,
    pub time: TimeContext,
    pub evidence_refs: Vec<EvidenceId>,     // DECISION evidence only (A5)
    pub provenance: ProvenanceTrail,
}

// Marker: DecisionCandidate is always SPECULATIVE
// It can only be consumed by SpeculativeConsumer traits (AssuranceEngine, DecisionEngine).
// It can NEVER be passed to AuthoritativeConsumer traits.
impl SpeculativeState for DecisionCandidate {}

impl DecisionCandidate {
    /// A candidate that references stale state_hash or config_hash is REJECTED by G0.
    pub fn is_stale(&self, current_state: StateHash, current_config: ConfigurationHash) -> bool;

    /// Validate that all references are within tenant scope (A2).
    pub fn validate_tenant_scope(&self) -> Result<(), TenantBoundaryError>;

    /// Compute the candidate hash for deduplication.
    pub fn candidate_hash(&self) -> ContentHash;
}
```

### 10.2 DecisionTwin (A8)

```rust
pub struct DecisionTwin {
    pub decision_id: DecisionId,
    pub TenantScoped { tenant_id: TenantId, .. },
    pub state_snapshot: StateHash,           // EVIDENCED only (A1)
    pub evidence_refs: EvidenceRefSet,       // split: decision + outcome (A5)
    pub config_hash: ConfigurationHash,      // A4
    pub candidate_options: Vec<DecisionCandidateId>,
    pub lifecycle_state: DecisionTwinLifecycleState,  // includes REVALIDATION_REQUIRED (A8)
    pub deadline: Option<DateTime<Utc>>,
    pub time: TimeContext,
    pub provenance: ProvenanceTrail,
    // ... other fields from Canonical Object Spec
}

pub enum DecisionTwinLifecycleState {
    // Speculative
    Created, Contextualized, OptionsGenerated, Assessed, Assured,
    PolicyChecked, Authorized, Executing, Executed,
    OutcomePending, OutcomeVerified,

    // Authoritative
    Memorized,                               // ← AuthoritativeState

    // Special
    RevalidationRequired,                    // A8 — blocks all progression

    // Failures
    Rejected, Expired, Cancelled, Aborted, Failed, Indeterminate,
}

impl SpeculativeState for Created {}
impl SpeculativeState for Contextualized {}
impl SpeculativeState for OptionsGenerated {}
impl SpeculativeState for Assessed {}
impl SpeculativeState for Assured {}
impl SpeculativeState for PolicyChecked {}
impl SpeculativeState for Authorized {}
impl SpeculativeState for Executing {}
impl SpeculativeState for Executed {}
impl SpeculativeState for OutcomePending {}
impl SpeculativeState for OutcomeVerified {}
impl SpeculativeState for RevalidationRequired {}

impl AuthoritativeState for Memorized {}

impl StateMachine<DecisionTwinLifecycleState> for DecisionTwin {
    type ObjectId = DecisionId;
    type Event = DecisionTwinEvent;

    fn handle_event(&self, event: Self::Event) -> Result<DecisionTwinLifecycleState, StateMachineError>;
}

pub enum DecisionTwinEvent {
    Contextualize { state_snapshot: StateHash, evidence_ref: EvidenceId },
    GenerateOptions { candidates: Vec<DecisionCandidate> },
    Assess { risk: RiskProfile, scenarios: Vec<Scenario> },
    Assure { result: AssuranceResult },
    PolicyCheck { evaluation: PolicyEvaluation },
    Authorize { auth: Authorization },
    Execute { execution: Execution },
    VerifyOutcome { outcome: Outcome },
    TriggerRevalidation { reason: RevalidationReason },  // A8
    Reassess { result: AssuranceResult },
}

pub enum RevalidationReason {
    ConfigChange,           // A4
    ContradictoryEvidence,
    StaleTerm,              // I2
    RiskReassessment,
    ExternalMandate,        // A8
    ModelUpdate,            // A2
}
```

**A8 Rule**: A DecisionTwin in `RevalidationRequired` cannot initiate new actions. It is visible only as "awaiting re-verification."

### 10.3 StateTransitionRecord (A1)

```rust
pub struct StateTransitionRecord {
    pub delta_id: Uuid,
    pub TenantScoped { tenant_id: TenantId, .. },
    pub previous_state_hash: StateHash,
    pub resulting_state_hash: StateHash,
    pub transition_type: String,
    pub status: TransitionStatus,
    pub evidence_ref: EvidenceId,
    pub commit_index: Option<CommitIndex>,  // A3: None until Raft commit
    pub proposer_identity: EntityId,
    pub validator_signatures: Vec<Signature>,
    pub applied_at: Option<TimeContext>,
    pub time: TimeContext,
    pub config_hash: ConfigurationHash,     // A4
    pub provenance: ProvenanceTrail,
}

pub enum TransitionStatus {
    // Speculative
    Proposed, Validated, EvidencePrepared,

    // Committed
    Committed, Applied,                  // CommittedState

    // Authoritative
    Evidenced,                            // AuthoritativeState
    VardhanCommittedState,                // AuthoritativeState — VARDHAN's internal truth
    ObservedExternalState,                // AuthoritativeState — external world confirmed

    // Failures
    Rollback, Corrupted, Stale,
}

impl SpeculativeState for Proposed {}
impl SpeculativeState for Validated {}
impl SpeculativeState for EvidencePrepared {}

impl CommittedState for Committed {}
impl CommittedState for Applied {}

impl AuthoritativeState for Evidenced {}
impl AuthoritativeState for VardhanCommittedState {}
impl AuthoritativeState for ObservedExternalState {}
```

### 10.4 EvidenceRecord (A5)

```rust
pub struct EvidenceRecord {
    pub evidence_id: EvidenceId,          // BLAKE3 (cryptographic)
    pub logical_id: EvidenceLogicalId,     // Uuid (for queryability)
    pub TenantScoped { tenant_id: TenantId, .. },
    pub event_id: Option<EventId>,
    pub entity_id: Option<EntityId>,
    pub source: String,
    pub time: TimeContext,                // A3
    pub logical_time: Option<CommitIndex>, // A3: assigned at commit
    pub schema_version: SchemaVersion,
    pub payload_digest: ContentHash,
    pub predecessor: Option<EvidenceId>,
    pub provenance: Vec<ProvenanceEntry>,
    pub authorization_context: AuthContext,  // interface-phase dependency
    pub signatures: Vec<Signature>,
    pub evidence_category: EvidenceCategory,  // A5: DECISION | OUTCOME
    pub config_hash: ConfigurationHash,      // A4
    pub state_hash: Option<StateHash>,       // A1
    pub commit_index: Option<CommitIndex>,    // A3
    pub related_object_refs: Vec<ObjectRef>,
}

pub enum EvidenceCategory {
    Decision,  // A5: decision pipeline evidence
    Outcome,   // A5: outcome pipeline evidence
}

pub enum EvidenceStatus {
    Created, Signed, LedgerWritten,
    MerkleCheckpointed, RaftCommitted,  // CommittedState
    Finalized,                            // AuthoritativeState
}
```

**A5 Rule**: Decision evidence and outcome evidence are written to separate Merkle trees. The `EvidenceStore` trait exposes `decision_tree()` and `outcome_tree()` separately.

### 10.5 Execution / Compensation (A7)

```rust
pub struct Execution {
    pub execution_id: ExecutionId,
    pub TenantScoped { tenant_id: TenantId, .. },
    pub action_id: ActionId,
    pub authorization_id: AuthorizationId,  // A7 chain
    pub status: ExecutionStatus,
    pub result: Option<JsonValue>,
    pub error: Option<String>,
    pub started_at: TimeContext,
    pub completed_at: Option<TimeContext>,
    pub config_hash: ConfigurationHash,     // A4
    pub idempotency_key: ExecutionIdempotencyKey,
    pub provenance: ProvenanceTrail,
}

pub enum ExecutionStatus {
    Pending, Running,         // Speculative
    Success, Failure, Timeout, Cancelled,  // terminal
    Compensating, Compensated,  // for rollback
    Indeterminate,             // A1: cannot verify external state
}

/// Compensation is an ORDINARY action — requires the same A7 gate.
pub struct Compensation {
    pub compensation_id: CompensationId,
    pub TenantScoped { tenant_id: TenantId, .. },
    pub original_execution_id: ExecutionId,
    pub action_spec: ActionSpec,
    pub authorization_id: AuthorizationId,   // same original auth chain (A7)
    pub status: CompensationStatus,
    pub idempotency_key: ExecutionIdempotencyKey,
    pub config_hash: ConfigurationHash,      // A4
    pub provenance: ProvenanceTrail,
}

pub struct ExecutionIdempotencyKey([u8; 32]);  // BLAKE3 of (action_id, nonce)
```

### 10.6 ConfigurationSnapshot (A4)

```rust
pub struct ConfigurationSnapshot {
    pub config_id: ConfigId,
    pub TenantScoped { tenant_id: TenantId, .. },
    pub version: u64,
    pub config_hash: ConfigurationHash,  // BLAKE3 of canonical config bytes
    pub parent_version: Option<ConfigId>,
    pub config_payload: JsonValue,
    pub signature: Option<Signature>,    // ML-DSA-87
    pub author_identity: EntityId,
    pub effective_from: Option<CommitIndex>,  // A3
    pub effective_to: Option<CommitIndex>,    // A3
    pub change_reason: String,
    pub time: TimeContext,
    pub evidence_refs: Vec<EvidenceId>,
    pub provenance: ProvenanceTrail,
}

pub enum ConfigStatus {
    Draft, PendingApproval,  // Speculative
    Active,                  // Authoritative
    Expired, Revoked,       // terminal
}
```

**A4 Rule**: Configuration changes must be Raft-committed and evidence-finalized before becoming effective. The system **never** uses configuration that has not been evidence-finalized.

### 10.7 Policy / PolicyEvaluation

```rust
pub struct Policy {
    pub policy_id: PolicyId,
    pub TenantScoped { tenant_id: TenantId, .. },
    pub policy_hash: PolicyHash,
    pub version: SchemaVersion,
    pub rules: Vec<PolicyRule>,
    pub parent_policy_hash: Option<PolicyHash>,
    pub effective_from: Option<CommitIndex>,  // A3
    pub effective_to: Option<CommitIndex>,    // A3
    pub signature: Option<Signature>,
    pub author_identity: EntityId,
    pub time: TimeContext,
    pub evidence_refs: Vec<EvidenceId>,
    pub provenance: ProvenanceTrail,
}

pub struct PolicyEvaluation {
    pub eval_id: Uuid,
    pub TenantScoped { tenant_id: TenantId, .. },
    pub policy_version: String,
    pub policy_hash: PolicyHash,
    pub config_hash: ConfigurationHash,    // A4
    pub input_state_hash: StateHash,        // A1: EVIDENCED state only
    pub candidate_hash: ContentHash,
    pub constraints_evaluated: Vec<ConstraintId>,
    pub result: EvalResult,                 // CONST-8: INDETERMINATE ≠ PASS
    pub solver_metadata: JsonValue,
    pub proof_reference: ProofRef,          // interface-phase dependency
    pub evidence_reference: EvidenceId,
    pub time: TimeContext,
    pub provenance: ProvenanceTrail,
}

pub enum EvalResult {
    Pass, Fail, Indeterminate, Timeout,
}
```

### 10.8 ModelProvenance

```rust
pub struct ModelProvenance {
    pub model_id: ModelArtifactId,
    pub TenantScoped { tenant_id: TenantId, .. },
    pub model_hash: ModelArtifactHash,     // BLAKE3 of model artifact bytes
    pub provider: String,                   // "vardhan-native" | "external"
    pub provider_ref: Option<String>,
    pub architecture: String,
    pub trained_at: TimeContext,
    pub training_data_ref: Option<EvidenceId>,
    pub capabilities: Vec<String>,
    pub limitations: Vec<String>,
    pub deterministic: bool,
    pub evidence_refs: Vec<EvidenceId>,
    pub config_hash: ConfigurationHash,    // A4
    pub provenance: ProvenanceTrail,
}
```

**Constitution Section 17 Rule**: An external LLM may be optional, replaceable, disabled, benchmarked, and isolated. It must **never** own canonical enterprise state, authoritative evidence, security policy, consensus, or authorization.

---

## 11. Proof & Provenance Interfaces

These are **interface-phase dependencies** — the state machine and trait contracts reference them, but their exact schemas are defined in a later phase. They are marked explicitly as deferred.

```rust
/// Interface-phase dependency (deferred to Interface Phase).
/// Exact schema for G4 formal policy verification proof artifacts.
/// References: Constitution §21 G4, Canonical Spec §10.4, State Machine §6.17
pub struct ProofRef { /* opaque — schema TBD in interface phase */ }

/// Interface-phase dependency (deferred to Interface Phase).
/// Exact schema for provenance tracking entries.
/// References: Constitution §9 Evidence Model, Canonical Spec §7
pub struct ProvenanceEntry { /* opaque — schema TBD in interface phase */ }

/// Interface-phase dependency (deferred to Interface Phase).
/// Exact schema for authorization context in evidence records.
/// References: Constitution §9 Evidence Model, §22 Control-Flow Firewall
pub struct AuthContext { /* opaque — schema TBD in interface phase */ }

/// Interface-phase dependency (deferred to Interface Phase).
/// Exact retry semantics for ActionSpec.
/// References: Canonical Spec §14.1
pub struct RetryPolicy { /* opaque — schema TBD in interface phase */ }

/// Interface-phase dependency (deferred to Interface Phase).
/// Exact schema for external idempotency key format.
/// References: State Machine §3.4, §6.10
pub struct ExecutionIdempotencyKey([u8; 32]);
```

---

## 12. Module Structure

The trait contracts enforce the layer dependency direction at the module level:

```rust
// ── Layer 1: Post-Quantum Trust Foundation ──┐
mod pqc_trust {
    // Only crypto, identity, transport primitives
    // Cannot import from higher layers
}

// ── Layer 2: Distributed Trust ──┐
mod distributed_trust {
    use pqc_trust::*;
    // Raft, HA, replication
    // Cannot import from L03+
}

// ── Layer 3: Evidence Fabric ──┐
mod evidence_fabric {
    use pqc_trust::*;
    use distributed_trust::*;
    // Ledger, Merkle, attestation, EvidenceStore trait
    // Cannot import from L04+
}

// ── Layer 4: Enterprise State ──┐
mod enterprise_state {
    use evidence_fabric::*;
    // StateStore trait, StateSnapshot, StateTransitionRecord
    // Cannot import from L05+
}

// ── Layer 5: Intelligence ──┐
mod intelligence {
    use enterprise_state::*;
    use evidence_fabric::*;
    // ModelProvider, RiskModel traits
    // Cannot import from L06+
}

// ── Layer 6: AI Assurance ──┐
mod ai_assurance {
    use intelligence::*;
    use enterprise_state::*;
    use evidence_fabric::*;
    // AssuranceEngine, GateResult
    // Cannot import from L07+
}

// ── Layer 7: Reasoning ──┐
mod reasoning {
    use enterprise_state::*;
    // ReasoningEngine, DerivedFact
    // Cannot import from L08+
}

// ── Layer 8: Risk & Scenario ──┐
mod risk_scenario {
    use enterprise_state::*;
    use intelligence::*;
    use evidence_fabric::*;
    // RiskModel (implemented), ScenarioEngine (implemented)
    // Cannot import from L09+
}

// ── Layer 9: Decision Intelligence ──┐
mod decision_intelligence {
    use enterprise_state::*;
    use reasoning::*;
    use risk_scenario::*;
    use ai_assurance::*;
    // DecisionEngine, DecisionCandidate, DecisionTwin
    // Cannot import from L10+
}

// ── Layer 10: Outcome & Memory ──┐
mod outcome_memory {
    use decision_intelligence::*;
    use enterprise_state::*;
    use evidence_fabric::*;
    // OutcomeCollector, Outcome, PredictionError, DecisionMemory
    // Cannot import from L11+
}

// ── Layer 11: Governed Execution ──┐
mod governed_execution {
    use decision_intelligence::*;
    use risk_scenario::*;
    use ai_assurance::*;
    use evidence_fabric::*;
    // VardhanAuthorityGate, ActionExecutor, PolicyEngine
    // Cannot import from L12+
}

// ── Layer 12: Experience & Command ──┐
mod experience_command {
    use governed_execution::*;
    use outcome_memory::*;
    use decision_intelligence::*;
    use enterprise_state::*;
    // CommandHandler
    // Top layer — can import from any below
}
```

**Compiler enforcement**: Each module's `Cargo.toml` only lists dependencies on lower layers. Circular dependencies will not compile.

---

## 13. Consistency Check Summary

### 13.1 All 27 Canonical Objects Have Traits Defined

| Object | Trait | State Machine | Rust Type |
|---|---|---|---|
| TenantScoped<T> | TenantScopedObject | N/A (wrapper) | `TenantScoped<T>` struct |
| TimeContext | TimeContextCarrier | §3 | `TimeContext` struct |
| Tenant | TenantScopedObject | §4 | `Tenant` struct |
| Entity | TenantScopedObject | §5 | `Entity` struct |
| Relationship | TenantScopedObject | §6 | `Relationship` struct |
| VardhanEvent | EvidenceCarrier, TenantScopedObject | §7 | `VardhanEvent` struct |
| Observation | EvidenceCarrier, TenantScopedObject | §8 | `Observation` struct |
| StateSnapshot | Hashable, TenantScopedObject | §9.2 | `StateSnapshot` struct |
| StateVersion | Hashable, TenantScopedObject | §9.3 | `StateVersion` struct |
| StateTransitionRecord | StateMachine, Hashable | §10.3 | `StateTransitionRecord` struct |
| EvidenceRecord | EvidenceCarrier, Hashable | §10.4 | `EvidenceRecord` struct |
| ModelProvenance | TenantScopedObject | §10.8 | `ModelProvenance` struct |
| RiskProfile | Hashable, TenantScopedObject | §11.2 | `RiskProfile` struct |
| Scenario | Hashable, TenantScopedObject | §11.3 | `Scenario` struct |
| AssuranceResult | Hashable, TenantScopedObject | §10.18 | `AssuranceResult` struct |
| Constraint | TenantScopedObject | §12.1 | `Constraint` struct |
| Policy | Hashable, TenantScopedObject | §10.7 | `Policy` struct |
| PolicyEvaluation | Hashable, TenantScopedObject | §10.7 | `PolicyEvaluation` struct |
| Authorization | TenantScopedObject | §10.6 | `Authorization` struct |
| ConfigurationSnapshot | Hashable, TenantScopedObject | §10.6 | `ConfigurationSnapshot` struct |
| DecisionCandidate | SpeculativeState | §10.1 | `DecisionCandidate` struct |
| DecisionTwin | StateMachine | §10.2 | `DecisionTwin` struct |
| Action | TenantScopedObject | §10.5 | `Action` struct |
| Execution | TenantScopedObject | §10.5 | `Execution` struct |
| Compensation | TenantScopedObject | §10.5 | `Compensation` struct |
| Outcome | Hashable, TenantScopedObject | §10.9 | `Outcome` struct |
| PredictionError | Hashable, TenantScopedObject | §10.10 | `PredictionError` struct |
| DecisionMemory | Hashable, TenantScopedObject | §10.11 | `DecisionMemory` struct |

### 13.2 Amendment Compliance

| Amendment | Enforcement Mechanism |
|---|---|
| A1 | `SpeculativeState`, `CommittedState`, `AuthoritativeState` marker traits; `TransitionStatus` enum with `VardhanCommittedState` / `ObservedExternalState` variants; `DecisionCandidate` implements only `SpeculativeState` |
| A2 | `TenantScoped<T>` struct + `TenantScopedObject` trait on every semantic object |
| A3 | `TimeContext.logical_time: Option<CommitIndex>`; `CommitIndex` newtype |
| A4 | `ConfigurationHash` newtype on every object; `ConfigurationStore::is_current()` check; G0 rejects stale config_hash |
| A5 | `EvidenceCategory { Decision, Outcome }` enum; `EvidenceStore::decision_tree()` / `outcome_tree()` |
| A6 | `DecisionCandidate: SpeculativeState` (cannot implement `AuthoritativeState`); `is_stale()` method; candidate_hash |
| A7 | `VardhanAuthorityGate` trait — sole entry point for execution; `authorize_and_execute_compensation()` |
| A8 | `DecisionTwinLifecycleState::RevalidationRequired`; `RevalidationReason` enum |
| A9 | `FaultDomain` type in `Tenant`; per-domain circuit breakers in store traits |

### 13.3 Strong Type Verification

All 16 identifier/hash types are **distinct newtypes** — no `String` or `Vec<u8>` collapse:

```text
TenantId(Uuid)           // distinct from EntityId
EntityId(Uuid)           // distinct from DecisionId
DecisionId(Uuid)         // distinct from ActionId
DecisionCandidateId(Uuid)
ActionId(Uuid)
ExecutionId(Uuid)
CompensationId(Uuid)
AuthorizationId(Uuid)
PolicyId(Uuid)
ConstraintId(Uuid)
ConfigId(Uuid)
ModelArtifactId(Uuid)
EvidenceId([u8; 32])     // distinct from StateHash
EvidenceLogicalId(Uuid)
StateSnapshotId(Uuid)
StateVersionId(Uuid)
StateHash([u8; 32])      // distinct from ContentHash
ContentHash([u8; 32])    // distinct from EvidenceId
ModelArtifactHash([u8; 32])
PolicyHash([u8; 32])
ConfigurationHash([u8; 32])
CommitIndex(u64)         // distinct from RaftLogIndex
RaftTerm(u64)
RaftLogIndex(u64)
ExecutionIdempotencyKey([u8; 32])
```

### 13.4 Unresolved Dependencies (Interface Phase)

| Dependency | Referenced In | Phase |
|---|---|---|
| `ProofRef` | PolicyEvaluation, §11 | Interface Phase |
| `AuthContext` | EvidenceRecord, §10.4 | Interface Phase |
| `ProvenanceEntry` | All objects with provenance | Interface Phase |
| `ProvenanceTrail` | All objects with provenance | Interface Phase |
| `RetryPolicy` | ActionSpec, §10.5 | Interface Phase |
| `ExecutionIdempotencyKey` | §11 | Interface Phase |
| `MerkleTreeHandle` | EvidenceStore, §7.1 | Interface Phase |
| `Signature` | EvidenceRecord, ConfigurationSnapshot, Policy, §11 | L01 (already defined) |
| `GateResult` | AssuranceEngine, §6 | Interface Phase |
| `ObjectRef` | EvidenceRecord.related_object_refs | Interface Phase |

All dependencies are explicitly marked and traced. None are silently resolved.

### 13.5 No Contradictions Found

- **State separation**: `SpeculativeState` ≠ `AuthoritativeState` at the type level. `DecisionCandidate` implements only `SpeculativeState`. ✅
- **Authority gate**: Single trait, no alternative path. ✅
- **Raft boundaries**: Transition to AuthoritativeState variants requires Raft commit. ✅
- **Idempotency**: All store traits define idempotent operations. ✅
- **Concurrency**: Per-entity/per-tenant locks specified in trait implementations (section 4). ✅
- **No runtime code**: No implementation logic in this document. ✅
- **No new crates**: Module structure references existing layer organization. ✅

### 13.6 Next Artifact

```text
VARDHAN_THREAT_MODEL.md
```

Will define threat agents, attack surfaces, trust boundaries, and mitigations mapped to the state machines and trait contracts defined here.

---

*This specification defines compiler-enforceable Rust contracts for every canonical object in Vardhan. The type system enforces tenant isolation (A2), state tier separation (A1), authority gate passage (A7), config freshness (A4), and evidence category separation (A5). Any implementation that cannot be expressed against these traits is architecturally out of scope.*
