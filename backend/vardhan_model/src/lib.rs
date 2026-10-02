//! # Vardhan Model — Common Enterprise Data Fabric
//!
//! Layer 6: Vardhan Data Fabric
//!
//! This crate provides the canonical data model for the Vardhan Quantum
//! enterprise intelligence platform. It is the **common language** through
//! which every Vardhan subsystem communicates:
//!
//! - **VardhanEvent** — the universal event schema (one schema, not five)
//! - **Enterprise entities** — typed objects for every enterprise principal
//! - **DependencyGraph** — explicit relationships between entities
//! - **Schema versioning** — compatibility rules for evolution
//!
//! This layer is **independent of any LLM** and must function without one.
//!
//! ## Design Principles
//!
//! 1. One canonical event schema — no subsystem-specific variants
//! 2. Deterministic serialization (serde_json, sorted field order)
//! 3. Tenant isolation via `tenant_id` on every event
//! 4. Evidence linkage via `evidence_ref`
//! 5. Schema versioning with compatibility rules
//! 6. Explicit entity relationships (no implicit joins or inferred links)

pub mod entities;
pub mod events;
pub mod graph;
pub mod identity;
pub mod schema;

pub use entities::{
    Action, Application, Asset, BusinessProcess, BusinessUnit, Certificate, Container, Control,
    CryptoAsset, CryptoKey, Decision, Entity, EntityError, EntityId, EntityType, Identity,
    Incident, Node, Organization, Outcome, Policy, Risk, Service, Tenant, Transaction,
};
pub use events::{
    Confidence, EventBuilder, EventId, EventType, EventValidationError, Severity, VardhanEvent,
    EMITTER_AUTH_SERVICE, EMITTER_HA_CLUSTER, EMITTER_PQ_SHIELD, EMITTER_QUANTUM_NODE,
    EMITTER_RAFT_LISTENER, EVENT_ACTIONS, VARDHAN_EVENT_SCHEMA_VERSION,
};
pub use graph::{DependencyGraph, GraphError, Relationship, TraversalResult};
pub use identity::{IdentityError, PrincipalKind, PrincipalRef, PrincipalRegistry};
pub use schema::{SchemaCompatibility, SchemaRegistry, SchemaVersion};
