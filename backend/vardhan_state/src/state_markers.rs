//! # Vardhan State Fabric — State Tier Marker Traits (A1)
//!
//! **Amendment A1**: The five lifecycle states must be interpreted through a
//! three-tier visibility model:
//!
//! ```text
//! SPECULATIVE STATE (not visible to Intelligence or Decision layers)
//!    ├── PROPOSED    (delta created, not yet G0-validated)
//!    ├── VALIDATED   (G0 passed, not yet Raft-committed)
//!    ├── EVIDENCE_PREPARED (evidence written, not yet consensus-committed)
//!    ├── COMMITTED   (Raft committed, not yet applied)
//!    └── APPLIED     (applied to state machine, evidence not yet finalized)
//!
//! AUTHORITATIVE STATE (visible to Intelligence and Decision layers)
//!    └── EVIDENCED   (Raft-committed AND evidence finalized AND applied)
//! ```
//!
//! Sourced from:
//! - `VARDHAN_ARCHITECTURE_CONSTITUTION.md` §A1 (Authoritative vs. Speculative State)
//! - `VARDHAN_OBJECT_TRAITS.md` §3 (State Tier Marker Traits)

use std::marker::PhantomData;

/// SPECULATIVE state: not visible to Intelligence Plane, Decision Twin,
/// Risk Engine, or any upper-layer query/API/candidate input.
///
/// Pre-commit objects have `logical_time = None` (A3) and are never
/// authoritative.
pub trait SpeculativeState: Clone + Eq + Send + Sync {}

/// COMMITTED state: Raft-committed and durable, but not yet
/// visible to upper layers. Not authoritative on its own.
///
/// Extends SpeculativeState — an object that was once speculative
/// and is now committed.
pub trait CommittedState: SpeculativeState + Clone + Eq + Send + Sync {}

/// AUTHORITATIVE state: visible to all upper layers. Only these
/// states may be queried by Intelligence Plane, Decision Twin, etc.
///
/// Extends CommittedState — an object that was once committed
/// and is now authoritative.
pub trait AuthoritativeState: CommittedState + Clone + Eq + Send + Sync {}

// ─── Consumer-side enforcement ──────────────────────────────────────────────

/// Authoritative consumers (Policy Gate, Execution, Authority Gate, Memory, Outcome)
/// accept only AuthoritativeState inputs.
/// They may NEVER accept SpeculativeState inputs.
pub trait AuthoritativeConsumer {}

/// Intelligence / Assurance consumers (ModelProvider, ReasoningEngine,
/// RiskModel, ScenarioEngine, AssuranceEngine) may consume AuthoritativeState
/// inputs (as read-only references) and may produce SpeculativeState outputs.
///
/// They may NEVER promote speculative state to authoritative without the
/// commit/authority path.
pub trait SpeculativeConsumer {}

// ─── State tier query helpers ────────────────────────────────────────────────

/// Query whether a state is speculative, committed, or authoritative.
/// Each state enum that has a lifecycle implements this.
pub trait StateTier {
    /// Returns true if this state is SPECULATIVE (not visible to upper layers).
    fn is_speculative(&self) -> bool;

    /// Returns true if this state is COMMITTED (durable but not yet authoritative).
    fn is_committed(&self) -> bool;

    /// Returns true if this state is AUTHORITATIVE (visible to all upper layers).
    fn is_authoritative(&self) -> bool;

    /// Returns true if this state is a failure/terminal state.
    fn is_failure(&self) -> bool;
}

// ─── Compile-time phantom marker for consumer enforcement ────────────────────

/// Phantom data type used to mark functions that require AuthoritativeState.
/// Usage:
/// ```ignore
/// fn query_enterprise_state(
///     hash: StateHash,
///     _: PhantomData<dyn AuthoritativeConsumer>,
/// ) -> Result<StateSnapshot>;
/// ```
pub struct RequiresAuthoritative(PhantomData<()>);

/// Phantom data type used to mark functions that may accept SpeculativeState.
pub struct AcceptsSpeculative(PhantomData<()>);
