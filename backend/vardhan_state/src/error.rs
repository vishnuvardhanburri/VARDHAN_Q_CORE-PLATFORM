//! # Vardhan State Fabric — Typed Errors
//!
//! All errors in this crate use typed error enums — no `Box<dyn Error>`,
//! no stringly-typed errors. Every error carries structured context.
//!
//! Sourced from `VARDHAN_OBJECT_TRAITS.md` §12 (Error Types),
//! `VARDHAN_STATE_MACHINES.md` §1.4 (Error Handling).

use crate::id::{CommitIndex, ContentHash, TenantId};

// ─── TenantBoundaryError ─────────────────────────────────────────────────────

/// Cross-tenant boundary violation.
///
/// **Amendment A2**: The compiler prevents cross-tenant references via structural
/// typing (TenantScoped<T>). This error is raised at runtime when deserialized
/// data or external inputs attempt cross-tenant access.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum TenantBoundaryError {
    #[error("cross-tenant access: expected tenant {expected}, actual {actual}")]
    CrossTenant {
        expected: TenantId,
        actual: TenantId,
    },
    #[error(
        "cross-tenant endpoint: source tenant {source_tenant} != target tenant {target_tenant}"
    )]
    CrossTenantEndpoint {
        source_tenant: TenantId,
        target_tenant: TenantId,
    },
    #[error("tenant boundary violation: object belongs to tenant {actual}, context is {expected}")]
    BoundaryViolation {
        expected: TenantId,
        actual: TenantId,
    },
}

// ─── StateMachineError ───────────────────────────────────────────────────────

/// Errors from the finite state machine — invalid transitions, guard failures.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum StateMachineError {
    #[error("invalid transition: {from} → {to} ({reason})")]
    TransitionInvalid {
        from: String,
        to: String,
        reason: String,
    },
    #[error("guard failure on transition to {target}: {reason}")]
    GuardFailure { target: String, reason: String },
    #[error("already in terminal state {state}")]
    AlreadyTerminal { state: String },
    #[error("stale transition: record commit_index {record_index} < current commit_index {current_index}")]
    StaleTransition {
        record_index: CommitIndex,
        current_index: CommitIndex,
    },
}

// ─── ObjectError ─────────────────────────────────────────────────────────────

/// Errors specific to object lifecycle operations.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ObjectError {
    #[error("invalid lifecycle transition: {from:?} → {to:?} (reason: {reason})")]
    InvalidStateTransition {
        from: String,
        to: String,
        reason: String,
    },
    #[error("duplicate event detected: payload_digest {digest} already processed")]
    DuplicateEvent { digest: ContentHash },
    #[error("stale state detected: record at commit_index {record_index} is older than current {current_index}")]
    StaleState {
        record_index: CommitIndex,
        current_index: CommitIndex,
    },
    #[error("scope hash verification failed: expected {expected}, computed {computed}")]
    ScopeHashMismatch { expected: String, computed: String },
    #[error("content hash mismatch: expected {expected}, computed {computed}")]
    ContentHashMismatch { expected: String, computed: String },
    #[error("evidence reference not yet finalized")]
    EvidenceNotFinalized,
    #[error("object is not in an authoritative state (speculative)")]
    NotAuthoritative,
    #[error("object is not in a committed state")]
    NotCommitted,
    #[error("configuration hash is stale: {reason}")]
    StaleConfigHash { reason: String },
    #[error("provenance verification failed: {reason}")]
    ProvenanceFailure { reason: String },
    #[error("state hash mismatch on read: expected {expected}, computed {computed}")]
    StateHashMismatch { expected: String, computed: String },
}

// ─── StoreError ──────────────────────────────────────────────────────────────

/// Errors from state store and evidence store operations.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum StoreError {
    #[error("object not found: {object_type} {id}")]
    NotFound { object_type: String, id: String },
    #[error("tenant boundary violation: {0}")]
    TenantBoundary(#[from] TenantBoundaryError),
    #[error("state machine error: {0}")]
    StateMachine(#[from] StateMachineError),
    #[error("duplicate key: {key}")]
    DuplicateKey { key: String },
    #[error("evidence not finalized: {id}")]
    EvidenceNotFinalized { id: String },
    #[error("invalid state: {reason}")]
    InvalidState { reason: String },
    #[error("stale state: {reason}")]
    StaleState { reason: String },
    #[error("internal error: {reason}")]
    Internal { reason: String },
}

// ─── Convenience conversions ──────────────────────────────────────────────────

impl From<ObjectError> for StateMachineError {
    fn from(e: ObjectError) -> Self {
        StateMachineError::GuardFailure {
            target: "unknown".to_string(),
            reason: format!("{}", e),
        }
    }
}

impl From<TenantBoundaryError> for ObjectError {
    fn from(e: TenantBoundaryError) -> Self {
        ObjectError::InvalidStateTransition {
            from: "any".to_string(),
            to: "any".to_string(),
            reason: format!("{}", e),
        }
    }
}
