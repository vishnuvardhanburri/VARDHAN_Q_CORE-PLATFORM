//! # Vardhan State Fabric (Layer 04)
//!
//! The Enterprise State Fabric is the authoritative runtime layer that
//! manages tenant-scoped object lifecycles, state transitions, and evidence
//! finalization through the Raft consensus pipeline.
//!
//! ## Architecture Rule (A1, A2, A3, A4, A5)
//!
//! ```text
//! SPECULATIVE          (PROPOSED, VALIDATED, EVIDENCE_PREPARED, COMMITTED, APPLIED)
//!    ↓
//! VARDHAN_COMMITTED_STATE  (EVIDENCED — Raft committed AND evidence finalized AND applied)
//!    ↓
//! external execution/observation where applicable
//!    ↓
//! OBSERVED_EXTERNAL_STATE  (terminal authoritative)
//! ```
//!
//! - `logical_time` is `None` before Raft commit (A3)
//! - `commit_index` assigned only at consensus commit
//! - `VARDHAN_COMMITTED_STATE` is distinct from `OBSERVED_EXTERNAL_STATE` (A1)
//! - All objects are `TenantScoped<T>` (A2)
//! - `ConfigurationHash` required where contractually specified (A4)
//! - DECISION and OUTCOME evidence trees are separate (A5)
//!
//! ## Objects Implemented
//!
//! 1. [`Tenant`] — lifecycle: ACTIVE ↔ SUSPENDED → DELETED
//! 2. [`Entity`] — lifecycle: CREATED → ACTIVE → INACTIVE → ARCHIVED → DELETED
//! 3. [`Relationship`] — lifecycle: CREATED → ACTIVE → DEPRECATED → REPLACED → DELETED
//! 4. [`VardhanEvent`] — lifecycle: CREATED → G0_VALIDATED → EVIDENCE_PREPARED → RAFT_REPLICATED → RAFT_COMMITTED → EVIDENCE_FINALIZED → EVIDENCED
//! 5. [`Observation`] — lifecycle: CREATED → EVIDENCE_PREPARED → RAFT_COMMITTED → OBSERVED_EXTERNAL_STATE
//! 6. [`StateSnapshot`] — immutable point-in-time state tree snapshot
//! 7. [`StateVersion`] — version lineage with parent_version and delta_refs
//! 8. [`StateTransitionRecord`] — lifecycle: PROPOSED → ... → OBSERVED_EXTERNAL_STATE
//!
//! ## Dependencies
//! - `vardhan_model` — constitutional baseline (SchemaVersion)
//! - `ha_cluster` — Raft consensus infrastructure (not bypassed)
//!
//! Sourced from all 7 specification documents.

#![cfg_attr(not(test), deny(warnings))]

pub mod error;
pub mod evidence;
pub mod id;
pub mod objects;
pub mod scope;
pub mod state_machine;
pub mod state_markers;
pub mod store;
pub mod time;

// ─── Re-exports ──────────────────────────────────────────────────────────────

// ID types (34 newtypes)
pub use id::{
    new_uuid,
    ActionId,
    AuthorizationId,
    CommitIndex,
    CommitmentId,
    CompensationId,
    ConfigId,
    ConfigurationHash,
    ConstraintId,
    ContentHash,
    DecisionCandidateId,
    DecisionId,
    DeltaId,
    EntityId,
    EventId,
    // Hash types
    EvidenceId,
    EvidenceLogicalId,
    ExecutionId,
    ExecutionIdempotencyKey,
    ModelArtifactHash,
    ModelArtifactId,
    ObjectRef,
    ObservationId,
    OutcomeId,
    ParseHashError,
    PolicyHash,
    PolicyId,
    PredictionErrorId,
    RaftLogIndex,
    // Consensus types
    RaftTerm,
    RelationshipId,
    ScenarioId,
    // Supporting types
    SchemaVersion,
    StateHash,
    StateSnapshotId,
    StateVersionId,
    TenantId,
    SCHEMA_VERSION_ENTITY,
    SCHEMA_VERSION_OBSERVATION,
    SCHEMA_VERSION_RELATIONSHIP,
    SCHEMA_VERSION_STATE_SNAPSHOT,
    SCHEMA_VERSION_STATE_VERSION,
    // Schema version constants
    SCHEMA_VERSION_TENANT,
};

// Time context
pub use time::{now_utc, TimeContext};

// State tier markers
pub use state_markers::{
    AcceptsSpeculative, AuthoritativeConsumer, AuthoritativeState, CommittedState,
    RequiresAuthoritative, SpeculativeConsumer, SpeculativeState, StateTier,
};

// Tenant-scoped container and hashing
pub use scope::{canonical_json, Hashable, TenantScoped, TenantScopedObject};

// Errors
pub use error::{ObjectError, StateMachineError, StoreError, TenantBoundaryError};

// State machine trait
pub use state_machine::StateMachine;

// Evidence
pub use evidence::{
    evidence_id_serde, AuthContext, EvidenceCategory, EvidenceRecord, EvidenceRef, EvidenceStatus,
    MerkleTreeHandle, ProvenanceEntry, Signature,
};

// Core objects
pub use objects::{
    Entity,
    EntityStatus,
    EventLifecycleEvent,
    EventStatus,
    Observation,
    ObservationStatus,
    Relationship,
    RelationshipStatus,
    ScopedEntityId,
    StateSnapshot,
    // Lifecycle events
    StateTransitionEvent,
    StateTransitionRecord,
    StateTransitionStatus,
    StateVersion,
    // Objects
    Tenant,
    // Status enums
    TenantStatus,
    VardhanEvent,
};

// Stores
pub use store::{EvidenceStore, MemoryEvidenceStore, MemoryStateStore, StateStore};
pub mod authorization;
pub mod transition;
