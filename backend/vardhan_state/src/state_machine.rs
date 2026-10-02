//! # Vardhan State Fabric — State Machine Trait
//!
//! Sourced from `VARDHAN_OBJECT_TRAITS.md` §8.1 (State Machine Trait).

use crate::error::StateMachineError;

/// Enforces state machine transitions at the type level.
/// The type parameter S represents the current state.
///
/// Every object that has a lifecycle implements this trait:
/// - VardhanEvent
/// - Observation
/// - StateTransitionRecord
/// - Tenant, Entity, Relationship
/// - EvidenceRecord
/// - DecisionTwin (later layer)
pub trait StateMachine<S: Clone + Eq + Send + Sync> {
    /// The object's logical identity.
    type ObjectId;
    /// The trigger events that can cause transitions.
    type Event;

    /// Attempt a state transition.
    /// Returns the new state if the transition is valid.
    /// The state machine enforces that only valid transitions from S are possible.
    fn handle_event(&self, event: Self::Event) -> Result<S, StateMachineError>;

    /// Get the current state.
    fn state(&self) -> &S;

    /// Get the object's logical identity.
    fn id(&self) -> Self::ObjectId;
}
