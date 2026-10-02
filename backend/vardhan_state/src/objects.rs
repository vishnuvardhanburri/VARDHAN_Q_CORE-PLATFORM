//! # Vardhan State Fabric — Core Object Definitions
//!
//! Implements the 8 runtime objects of the Enterprise State Fabric layer:
//! 1. Tenant
//! 2. Entity
//! 3. Relationship
//! 4. VardhanEvent
//! 5. Observation
//! 6. StateSnapshot
//! 7. StateVersion
//! 8. StateTransitionRecord
//!
//! Each object's lifecycle state machine is defined here as an enum,
//! with transition validation enforced at runtime.
//!
//! Sourced from:
//! - `VARDHAN_CANONICAL_OBJECT_SPEC.md` (§4 Tenant, §5 Entity, §6 Relationship,
//!   §7 VardhanEvent, §8 Observation, §9 StateSnapshot, §9 StateVersion,
//!   §11 StateTransitionRecord)
//! - `VARDHAN_STATE_MACHINES.md` §6.1–6.8 (state machine definitions)
//! - `VARDHAN_ARCHITECTURE_CONSTITUTION.md` §A1, §A2, §A3, §9

use crate::error::{StateMachineError, TenantBoundaryError};
use crate::evidence::EvidenceRef;
use crate::id::{
    CommitIndex, ConfigurationHash, ContentHash, DeltaId, EntityId, EventId, ObjectRef,
    ObservationId, RelationshipId, SchemaVersion, StateHash, StateSnapshotId, StateVersionId,
    TenantId, SCHEMA_VERSION_ENTITY, SCHEMA_VERSION_OBSERVATION, SCHEMA_VERSION_RELATIONSHIP,
    SCHEMA_VERSION_STATE_SNAPSHOT, SCHEMA_VERSION_STATE_VERSION, SCHEMA_VERSION_TENANT,
};
use crate::scope::{Hashable, TenantScoped, TenantScopedObject};
use crate::state_markers::{AuthoritativeState, CommittedState, SpeculativeState, StateTier};
use crate::time::TimeContext;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

// ─── Helper: UUID serde wrapper (for canonical serialization) ────────────────

// ═════════════════════════════════════════════════════════════════════════════
// LIFECYCLE STATUS ENUMS
// ═════════════════════════════════════════════════════════════════════════════

/// Tenant lifecycle status.
///
/// Lifecycle: ACTIVE ↔ SUSPEND → DELETED
/// (VARDHAN_STATE_MACHINES.md §6.3, VARDHAN_CANONICAL_OBJECT_SPEC.md §4.2)
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TenantStatus {
    /// Active — tenant can create and modify objects.
    #[default]
    Active,
    /// Suspended — tenant is frozen; no new objects can be created.
    Suspended,
    /// Deleted — tenant is removed from the active state (logical delete).
    Deleted,
    /// Corrupted — tenant state has been corrupted (failure state).
    Corrupted,
    /// IsolationBreach — cross-tenant boundary violation detected (failure state).
    IsolationBreach,
}

impl SpeculativeState for TenantStatus {}
impl CommittedState for TenantStatus {}
impl AuthoritativeState for TenantStatus {}

impl TenantStatus {
    /// Returns true if this is a failure state.
    pub fn is_failure(&self) -> bool {
        matches!(
            self,
            TenantStatus::Corrupted | TenantStatus::IsolationBreach
        )
    }
}

impl StateTier for TenantStatus {
    fn is_speculative(&self) -> bool {
        matches!(self, TenantStatus::Active | TenantStatus::Suspended)
    }

    fn is_committed(&self) -> bool {
        matches!(self, TenantStatus::Active | TenantStatus::Suspended)
    }

    fn is_authoritative(&self) -> bool {
        matches!(self, TenantStatus::Active | TenantStatus::Suspended)
    }

    fn is_failure(&self) -> bool {
        matches!(
            self,
            TenantStatus::Corrupted | TenantStatus::IsolationBreach
        )
    }
}

/// Entity lifecycle status.
///
/// Lifecycle: CREATED → ACTIVE → INACTIVE → ARCHIVED → DELETED
/// (VARDHAN_STATE_MACHINES.md §6.1, VARDHAN_CANONICAL_OBJECT_SPEC.md §5.2)
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EntityStatus {
    /// Created — entity exists but not yet active for use.
    #[default]
    Created,
    /// Active — entity is live and can participate in relationships.
    Active,
    /// Inactive — entity is temporarily disabled.
    Inactive,
    /// Archived — entity is preserved for historical reference only.
    Archived,
    /// Deleted — entity is logically removed.
    Deleted,
    /// Orphaned — entity references a tenant that no longer exists (FailureState).
    Orphaned,
    /// StateStale — entity's state hash is outdated (FailureState).
    StateStale,
}

impl SpeculativeState for EntityStatus {}
impl CommittedState for EntityStatus {}
impl AuthoritativeState for EntityStatus {}

impl StateTier for EntityStatus {
    fn is_speculative(&self) -> bool {
        matches!(
            self,
            EntityStatus::Created
                | EntityStatus::Active
                | EntityStatus::Inactive
                | EntityStatus::Archived
        )
    }
    fn is_committed(&self) -> bool {
        matches!(
            self,
            EntityStatus::Created
                | EntityStatus::Active
                | EntityStatus::Inactive
                | EntityStatus::Archived
        )
    }
    fn is_authoritative(&self) -> bool {
        matches!(
            self,
            EntityStatus::Active
                | EntityStatus::Inactive
                | EntityStatus::Archived
                | EntityStatus::Deleted
        )
    }
    fn is_failure(&self) -> bool {
        matches!(self, EntityStatus::Orphaned | EntityStatus::StateStale)
    }
}

/// Relationship lifecycle status.
///
/// Lifecycle: CREATED → ACTIVE → DEPRECATED → REPLACED → DELETED
/// (VARDHAN_STATE_MACHINES.md §6.2, VARDHAN_CANONICAL_OBJECT_SPEC.md §6.2)
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RelationshipStatus {
    /// Created — relationship exists but not yet active.
    #[default]
    Created,
    /// Active — relationship is live.
    Active,
    /// Deprecated — relationship is marked for eventual replacement.
    Deprecated,
    /// Replaced — relationship has been superseded by a newer version.
    Replaced,
    /// Deleted — relationship is logically removed.
    Deleted,
    /// Dangling — source or target entity no longer exists (FailureState).
    Dangling,
    /// Cycle — circular dependency detected (FailureState).
    Cycle,
}

impl SpeculativeState for RelationshipStatus {}
impl CommittedState for RelationshipStatus {}
impl AuthoritativeState for RelationshipStatus {}

impl StateTier for RelationshipStatus {
    fn is_speculative(&self) -> bool {
        matches!(
            self,
            RelationshipStatus::Created
                | RelationshipStatus::Active
                | RelationshipStatus::Deprecated
                | RelationshipStatus::Replaced
        )
    }
    fn is_committed(&self) -> bool {
        matches!(
            self,
            RelationshipStatus::Created
                | RelationshipStatus::Active
                | RelationshipStatus::Deprecated
                | RelationshipStatus::Replaced
        )
    }
    fn is_authoritative(&self) -> bool {
        matches!(
            self,
            RelationshipStatus::Active
                | RelationshipStatus::Deprecated
                | RelationshipStatus::Replaced
                | RelationshipStatus::Deleted
        )
    }
    fn is_failure(&self) -> bool {
        matches!(
            self,
            RelationshipStatus::Dangling | RelationshipStatus::Cycle
        )
    }
}

/// VardhanEvent lifecycle status.
///
/// Lifecycle: CREATED → G0_VALIDATED → EVIDENCE_PREPARED → RAFT_REPLICATED
///   → RAFT_COMMITTED → EVIDENCE_FINALIZED → EVIDENCED
/// (VARDHAN_STATE_MACHINES.md §6.5, VARDHAN_CANONICAL_OBJECT_SPEC.md §7.2)
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EventStatus {
    /// Created — event received, not yet validated.
    #[default]
    Created,
    /// G0Validated — passed G0 validation (schema, provenance, config_hash).
    G0Validated,
    /// EvidencePrepared — evidence record created and signed.
    EvidencePrepared,
    /// RaftReplicated — event propagated to Raft followers.
    RaftReplicated,
    /// RaftCommitted — event committed by Raft consensus; commit_index assigned.
    RaftCommitted,
    /// EvidenceFinalized — evidence finalized and linked to commit_index.
    EvidenceFinalized,
    /// Evidenced — terminal: committed + evidenced.
    Evidenced,
    /// Rejected — evidence failed validation.
    Rejected,
    /// Indeterminate — state cannot be determined.
    Indeterminate,
}

impl SpeculativeState for EventStatus {}
impl CommittedState for EventStatus {}
impl AuthoritativeState for EventStatus {}

impl StateTier for EventStatus {
    fn is_speculative(&self) -> bool {
        matches!(
            self,
            EventStatus::Created
                | EventStatus::G0Validated
                | EventStatus::EvidencePrepared
                | EventStatus::RaftReplicated
        )
    }
    fn is_committed(&self) -> bool {
        matches!(
            self,
            EventStatus::RaftCommitted | EventStatus::EvidenceFinalized
        )
    }
    fn is_authoritative(&self) -> bool {
        matches!(self, EventStatus::Evidenced)
    }
    fn is_failure(&self) -> bool {
        matches!(self, EventStatus::Rejected | EventStatus::Indeterminate)
    }
}

/// Observation lifecycle status.
///
/// Lifecycle: CREATED → EVIDENCE_PREPARED → RAFT_COMMITTED → OBSERVED_EXTERNAL_STATE
/// (VARDHAN_STATE_MACHINES.md §6.7, VARDHAN_CANONICAL_OBJECT_SPEC.md §8)
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ObservationStatus {
    /// Created — observation received, not yet processed.
    #[default]
    Created,
    /// EvidencePrepared — evidence record created and signed.
    EvidencePrepared,
    /// RaftCommitted — observation committed by Raft; commit_index assigned.
    RaftCommitted,
    /// ObservedExternalState — external state has been observed and confirmed.
    ObservedExternalState,
    /// Unverifiable — observation cannot be verified (FailureState).
    Unverifiable,
    /// Indeterminate — state cannot be determined (FailureState).
    Indeterminate,
}

impl SpeculativeState for ObservationStatus {}
impl CommittedState for ObservationStatus {}
impl AuthoritativeState for ObservationStatus {}

impl StateTier for ObservationStatus {
    fn is_speculative(&self) -> bool {
        matches!(
            self,
            ObservationStatus::Created | ObservationStatus::EvidencePrepared
        )
    }
    fn is_committed(&self) -> bool {
        matches!(self, ObservationStatus::RaftCommitted)
    }
    fn is_authoritative(&self) -> bool {
        matches!(self, ObservationStatus::ObservedExternalState)
    }
    fn is_failure(&self) -> bool {
        matches!(
            self,
            ObservationStatus::Unverifiable | ObservationStatus::Indeterminate
        )
    }
}

/// StateTransitionRecord lifecycle status.
///
/// Full lifecycle:
///   PROPOSED → VALIDATED → EVIDENCE_PREPARED → COMMITTED → APPLIED
///   → EVIDENCED → VARDHAN_COMMITTED_STATE → OBSERVED_EXTERNAL_STATE
///
/// Failure states: REJECTED, ROLLBACK, CORRUPTED, STALE
///
/// (VARDHAN_STATE_MACHINES.md §6.8, VARDHAN_CANONICAL_OBJECT_SPEC.md §11)
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum StateTransitionStatus {
    /// Proposed — delta created, G0 not yet passed. SPECULATIVE.
    #[default]
    Proposed,
    /// Validated — G0 passed. SPECULATIVE.
    Validated,
    /// EvidencePrepared — evidence record created and signed. SPECULATIVE.
    EvidencePrepared,
    /// Committed — Raft committed. SPECULATIVE (applied but not yet authoritative).
    Committed,
    /// Applied — applied to state machine. SPECULATIVE.
    Applied,
    /// Evidenced — evidence finalized and linked to state_hash. COMMITTED.
    Evidenced,
    /// VardhanCommittedState — committed + evidenced + applied. AUTHORITATIVE.
    VardhanCommittedState,
    /// ObservedExternalState — external execution observed and confirmed. AUTHORITATIVE.
    ObservedExternalState,
    /// Rejected — guard failure during validation. FailureState.
    Rejected,
    /// Rollback — evidence finalization or external execution failed. FailureState.
    Rollback,
    /// Corrupted — state hash mismatch detected on read. FailureState.
    Corrupted,
    /// Stale — superseded by a newer transition with higher commit_index. FailureState.
    Stale,
}

impl SpeculativeState for StateTransitionStatus {}
impl CommittedState for StateTransitionStatus {}
impl AuthoritativeState for StateTransitionStatus {}

impl StateTier for StateTransitionStatus {
    fn is_speculative(&self) -> bool {
        matches!(
            self,
            StateTransitionStatus::Proposed
                | StateTransitionStatus::Validated
                | StateTransitionStatus::EvidencePrepared
                | StateTransitionStatus::Committed
                | StateTransitionStatus::Applied
        )
    }
    fn is_committed(&self) -> bool {
        matches!(
            self,
            StateTransitionStatus::Evidenced | StateTransitionStatus::VardhanCommittedState
        )
    }
    fn is_authoritative(&self) -> bool {
        matches!(
            self,
            StateTransitionStatus::VardhanCommittedState
                | StateTransitionStatus::ObservedExternalState
        )
    }
    fn is_failure(&self) -> bool {
        matches!(
            self,
            StateTransitionStatus::Rejected
                | StateTransitionStatus::Rollback
                | StateTransitionStatus::Corrupted
                | StateTransitionStatus::Stale
        )
    }
}

/// Events that trigger StateTransitionRecord transitions.
/// (VARDHAN_STATE_MACHINES.md §6.8.1)
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum StateTransitionEvent {
    /// G0 validation passed.
    Validate,
    /// Evidence record created and signed.
    PrepareEvidence,
    /// Raft replication completed.
    RaftReplicate,
    /// Raft commit; provides the commit_index (Logical Time).
    RaftCommit(CommitIndex),
    /// Apply transition to state machine.
    Apply,
    /// Finalization of evidence record.
    FinalizeEvidence,
    /// Publish state change — makes transition visible to upper layers.
    PublishState,
    /// External execution result observed.
    ObserveOutcome,
}

/// Events that trigger VardhanEvent transitions.
/// (VARDHAN_STATE_MACHINES.md §6.5.1)
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum EventLifecycleEvent {
    /// G0 validation passed.
    Validate,
    /// Evidence record created and signed.
    PrepareEvidence,
    /// Event propagated to Raft followers.
    RaftReplicate,
    /// Event committed by Raft consensus.
    RaftCommit(CommitIndex),
    /// Evidence finalized and linked.
    FinalizeEvidence,
    /// Event fully evidenced — terminal.
    Evident,
}

// ═════════════════════════════════════════════════════════════════════════════
// TENANT
// ═════════════════════════════════════════════════════════════════════════════

/// Tenant — root of the tenant-scoped object hierarchy.
///
/// Fields (VARDHAN_CANONICAL_OBJECT_SPEC.md §4.1):
/// - `tenant_id`: Logical identity.
/// - `TenantScoped`: tenant_id, scope_hash (structural boundary, A2).
/// - `name`, `description`: Metadata.
/// - `status`: Lifecycle state.
/// - `schema_version`, `config_hash`, `created_at`, `provenance`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Tenant {
    pub tenant_id: TenantId,
    pub scope_hash: [u8; 32],
    #[serde(skip)]
    pub status: TenantStatus,
    pub name: String,
    pub description: Option<String>,
    pub schema_version: SchemaVersion,
    pub config_hash: ConfigurationHash,
    pub created_at: TimeContext,
    pub updated_at: Option<TimeContext>,
}

impl Tenant {
    pub fn new(
        tenant_id: TenantId,
        name: impl Into<String>,
        config_hash: ConfigurationHash,
    ) -> Self {
        let tc = TimeContext::new(Utc::now());
        let name_str = name.into();
        let scope_hash = Self::compute_scope_hash(tenant_id, &name_str);
        Self {
            tenant_id,
            scope_hash,
            status: TenantStatus::Active,
            name: name_str,
            description: None,
            schema_version: SCHEMA_VERSION_TENANT,
            config_hash,
            created_at: tc,
            updated_at: None,
        }
    }

    fn compute_scope_hash(tenant_id: TenantId, name: &str) -> [u8; 32] {
        let mut combined = Vec::new();
        combined.extend_from_slice(&tenant_id.to_bytes());
        combined.extend_from_slice(name.as_bytes());
        *blake3::hash(&combined).as_bytes()
    }

    pub fn canonical_bytes(&self) -> Vec<u8> {
        let mut map: BTreeMap<String, serde_json::Value> = BTreeMap::new();
        map.insert(
            "tenant_id".to_string(),
            serde_json::Value::String(self.tenant_id.to_string()),
        );
        map.insert(
            "scope_hash".to_string(),
            serde_json::Value::String(hex::encode(self.scope_hash)),
        );
        map.insert(
            "status".to_string(),
            serde_json::Value::String(format!("{:?}", self.status)),
        );
        map.insert(
            "name".to_string(),
            serde_json::Value::String(self.name.clone()),
        );
        map.insert(
            "description".to_string(),
            self.description
                .clone()
                .map(serde_json::Value::String)
                .unwrap_or(serde_json::Value::Null),
        );
        map.insert(
            "schema_version".to_string(),
            serde_json::Value::String(self.schema_version.to_string()),
        );
        map.insert(
            "config_hash".to_string(),
            serde_json::Value::String(self.config_hash.to_hex()),
        );
        map.insert(
            "created_at".to_string(),
            serde_json::Value::String(self.created_at.event_time.to_rfc3339()),
        );
        map.insert(
            "updated_at".to_string(),
            self.updated_at
                .as_ref()
                .map(|t| serde_json::Value::String(t.event_time.to_rfc3339()))
                .unwrap_or(serde_json::Value::Null),
        );
        serde_json::to_vec(&map).unwrap_or_default()
    }

    /// Verify scope hash integrity.
    pub fn verify_scope_hash(&self) -> bool {
        let expected = Self::compute_scope_hash(self.tenant_id, &self.name);
        self.scope_hash == expected
    }
}

impl Hashable for Tenant {
    fn canonical_bytes(&self) -> Vec<u8> {
        self.canonical_bytes()
    }
    fn content_hash(&self) -> ContentHash {
        ContentHash(*blake3::hash(&self.canonical_bytes()).as_bytes())
    }
}

/// Tenant-scoped view of an EntityId (A2).
#[derive(Clone, Debug, Copy, Eq, PartialEq, Hash, Serialize, Deserialize)]
pub struct ScopedEntityId {
    pub tenant_id: TenantId,
    pub entity_id: EntityId,
}

impl ScopedEntityId {
    pub fn new(tenant_id: TenantId, entity_id: EntityId) -> Self {
        Self {
            tenant_id,
            entity_id,
        }
    }

    /// Validate that the entity belongs to the given tenant.
    /// (T-TENANT-01: cross-tenant entity_id rejection)
    pub fn validate_tenant(&self, expected: TenantId) -> Result<(), TenantBoundaryError> {
        if self.tenant_id != expected {
            Err(TenantBoundaryError::CrossTenant {
                expected,
                actual: self.tenant_id,
            })
        } else {
            Ok(())
        }
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// ENTITY
// ═════════════════════════════════════════════════════════════════════════════

/// Entity — a named, typed, tenant-scoped node in the Vardhan object graph.
///
/// Fields (VARDHAN_CANONICAL_OBJECT_SPEC.md §5.1):
/// - `entity_id`: TenantScoped<EntityId> — exists only within tenant namespace.
/// - `TenantScoped`: tenant_id, scope_hash.
/// - `entity_type`: String type discriminator (e.g., "Organization", "Control").
/// - `name`, `description`: Metadata.
/// - `status`: Lifecycle state.
/// - `schema_version`, `config_hash`, `created_at`, `provenance`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Entity {
    pub entity_id: ScopedEntityId,
    pub scope_hash: [u8; 32],
    #[serde(skip)]
    pub status: EntityStatus,
    pub entity_type: String,
    pub name: String,
    pub description: Option<String>,
    pub schema_version: SchemaVersion,
    pub config_hash: ConfigurationHash,
    pub created_at: TimeContext,
    pub updated_at: Option<TimeContext>,
}

impl Entity {
    pub fn new(
        tenant_id: TenantId,
        entity_id: EntityId,
        entity_type: impl Into<String>,
        name: impl Into<String>,
        config_hash: ConfigurationHash,
    ) -> Self {
        let tc = TimeContext::new(Utc::now());
        let scoped = ScopedEntityId::new(tenant_id, entity_id);
        let entity_type_str = entity_type.into();
        let name_str = name.into();
        let scope_hash = Self::compute_scope_hash(scoped, &entity_type_str, &name_str);
        Self {
            entity_id: scoped,
            scope_hash,
            status: EntityStatus::Created,
            entity_type: entity_type_str,
            name: name_str,
            description: None,
            schema_version: SCHEMA_VERSION_ENTITY,
            config_hash,
            created_at: tc,
            updated_at: None,
        }
    }

    fn compute_scope_hash(scoped_id: ScopedEntityId, entity_type: &str, name: &str) -> [u8; 32] {
        let mut combined = Vec::new();
        combined.extend_from_slice(&scoped_id.tenant_id.to_bytes());
        combined.extend_from_slice(&scoped_id.entity_id.to_bytes());
        combined.extend_from_slice(entity_type.as_bytes());
        combined.extend_from_slice(name.as_bytes());
        *blake3::hash(&combined).as_bytes()
    }

    pub fn canonical_bytes(&self) -> Vec<u8> {
        let mut map: BTreeMap<String, serde_json::Value> = BTreeMap::new();
        map.insert(
            "entity_id".to_string(),
            serde_json::Value::String(self.entity_id.entity_id.to_string()),
        );
        map.insert(
            "tenant_id".to_string(),
            serde_json::Value::String(self.entity_id.tenant_id.to_string()),
        );
        map.insert(
            "scope_hash".to_string(),
            serde_json::Value::String(hex::encode(self.scope_hash)),
        );
        map.insert(
            "status".to_string(),
            serde_json::Value::String(format!("{:?}", self.status)),
        );
        map.insert(
            "entity_type".to_string(),
            serde_json::Value::String(self.entity_type.clone()),
        );
        map.insert(
            "name".to_string(),
            serde_json::Value::String(self.name.clone()),
        );
        map.insert(
            "description".to_string(),
            self.description
                .clone()
                .map(serde_json::Value::String)
                .unwrap_or(serde_json::Value::Null),
        );
        map.insert(
            "schema_version".to_string(),
            serde_json::Value::String(self.schema_version.to_string()),
        );
        map.insert(
            "config_hash".to_string(),
            serde_json::Value::String(self.config_hash.to_hex()),
        );
        map.insert(
            "created_at".to_string(),
            serde_json::Value::String(self.created_at.event_time.to_rfc3339()),
        );
        map.insert(
            "updated_at".to_string(),
            self.updated_at
                .as_ref()
                .map(|t| serde_json::Value::String(t.event_time.to_rfc3339()))
                .unwrap_or(serde_json::Value::Null),
        );
        serde_json::to_vec(&map).unwrap_or_default()
    }

    pub fn verify_scope_hash(&self) -> bool {
        let expected = Self::compute_scope_hash(self.entity_id, &self.entity_type, &self.name);
        self.scope_hash == expected
    }
}

impl Hashable for Entity {
    fn canonical_bytes(&self) -> Vec<u8> {
        self.canonical_bytes()
    }
    fn content_hash(&self) -> ContentHash {
        ContentHash(*blake3::hash(&self.canonical_bytes()).as_bytes())
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// RELATIONSHIP
// ═════════════════════════════════════════════════════════════════════════════

/// Relationship — a typed edge between two entities.
///
/// Fields (VARDHAN_CANONICAL_OBJECT_SPEC.md §6.1):
/// - `relationship_id`: Logical identity.
/// - `TenantScoped`: tenant_id, scope_hash.
/// - `source_entity`: TenantScoped<EntityId> — must share tenant.
/// - `target_entity`: TenantScoped<EntityId> — must share tenant.
/// - `relationship_type`: String type discriminator (e.g., "DEPENDS_ON").
/// - `status`: Lifecycle state.
/// - `schema_version`, `config_hash`, `created_at`, `provenance`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Relationship {
    pub relationship_id: RelationshipId,
    pub scope_hash: [u8; 32],
    #[serde(skip)]
    pub status: RelationshipStatus,
    pub source_entity: ScopedEntityId,
    pub target_entity: ScopedEntityId,
    pub relationship_type: String,
    pub name: String,
    pub description: Option<String>,
    pub schema_version: SchemaVersion,
    pub config_hash: ConfigurationHash,
    pub created_at: TimeContext,
    pub updated_at: Option<TimeContext>,
}

impl Relationship {
    /// Create a new relationship. Both endpoints MUST be in the same tenant.
    /// (T-TENANT-04: cross-tenant relationship rejection)
    pub fn new(
        tenant_id: TenantId,
        relationship_id: RelationshipId,
        source: ScopedEntityId,
        target: ScopedEntityId,
        relationship_type: impl Into<String>,
        name: impl Into<String>,
        config_hash: ConfigurationHash,
    ) -> Result<Self, TenantBoundaryError> {
        // Enforce tenant-boundary: source and target must be in the same tenant
        if source.tenant_id != target.tenant_id {
            return Err(TenantBoundaryError::CrossTenantEndpoint {
                source_tenant: source.tenant_id,
                target_tenant: target.tenant_id,
            });
        }
        if source.tenant_id != tenant_id {
            return Err(TenantBoundaryError::CrossTenant {
                expected: tenant_id,
                actual: source.tenant_id,
            });
        }

        let tc = TimeContext::new(Utc::now());
        let rel_type_str = relationship_type.into();
        let name_str = name.into();
        let scope_hash = Self::compute_scope_hash(
            tenant_id,
            relationship_id,
            &source,
            &target,
            &rel_type_str,
            &name_str,
        );
        Ok(Self {
            relationship_id,
            scope_hash,
            status: RelationshipStatus::Created,
            source_entity: source,
            target_entity: target,
            relationship_type: rel_type_str,
            name: name_str,
            description: None,
            schema_version: SCHEMA_VERSION_RELATIONSHIP,
            config_hash,
            created_at: tc,
            updated_at: None,
        })
    }

    fn compute_scope_hash(
        tenant_id: TenantId,
        rel_id: RelationshipId,
        source: &ScopedEntityId,
        target: &ScopedEntityId,
        relationship_type: &str,
        name: &str,
    ) -> [u8; 32] {
        let mut combined = Vec::new();
        combined.extend_from_slice(&tenant_id.to_bytes());
        combined.extend_from_slice(rel_id.as_uuid().as_bytes());
        combined.extend_from_slice(&source.entity_id.to_bytes());
        combined.extend_from_slice(&target.entity_id.to_bytes());
        combined.extend_from_slice(relationship_type.as_bytes());
        combined.extend_from_slice(name.as_bytes());
        *blake3::hash(&combined).as_bytes()
    }

    pub fn canonical_bytes(&self) -> Vec<u8> {
        let mut map: BTreeMap<String, serde_json::Value> = BTreeMap::new();
        map.insert(
            "relationship_id".to_string(),
            serde_json::Value::String(self.relationship_id.to_string()),
        );
        map.insert(
            "tenant_id".to_string(),
            serde_json::Value::String(self.source_entity.tenant_id.to_string()),
        );
        map.insert(
            "scope_hash".to_string(),
            serde_json::Value::String(hex::encode(self.scope_hash)),
        );
        map.insert(
            "status".to_string(),
            serde_json::Value::String(format!("{:?}", self.status)),
        );
        map.insert(
            "source_entity".to_string(),
            serde_json::Value::String(self.source_entity.entity_id.to_string()),
        );
        map.insert(
            "target_entity".to_string(),
            serde_json::Value::String(self.target_entity.entity_id.to_string()),
        );
        map.insert(
            "relationship_type".to_string(),
            serde_json::Value::String(self.relationship_type.clone()),
        );
        map.insert(
            "name".to_string(),
            serde_json::Value::String(self.name.clone()),
        );
        map.insert(
            "description".to_string(),
            self.description
                .clone()
                .map(serde_json::Value::String)
                .unwrap_or(serde_json::Value::Null),
        );
        map.insert(
            "schema_version".to_string(),
            serde_json::Value::String(self.schema_version.to_string()),
        );
        map.insert(
            "config_hash".to_string(),
            serde_json::Value::String(self.config_hash.to_hex()),
        );
        map.insert(
            "created_at".to_string(),
            serde_json::Value::String(self.created_at.event_time.to_rfc3339()),
        );
        map.insert(
            "updated_at".to_string(),
            self.updated_at
                .as_ref()
                .map(|t| serde_json::Value::String(t.event_time.to_rfc3339()))
                .unwrap_or(serde_json::Value::Null),
        );
        serde_json::to_vec(&map).unwrap_or_default()
    }

    pub fn verify_scope_hash(&self) -> bool {
        let expected = Self::compute_scope_hash(
            self.source_entity.tenant_id,
            self.relationship_id,
            &self.source_entity,
            &self.target_entity,
            &self.relationship_type,
            &self.name,
        );
        self.scope_hash == expected
    }
}

impl Hashable for Relationship {
    fn canonical_bytes(&self) -> Vec<u8> {
        self.canonical_bytes()
    }
    fn content_hash(&self) -> ContentHash {
        ContentHash(*blake3::hash(&self.canonical_bytes()).as_bytes())
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// VARDHAN EVENT
// ═════════════════════════════════════════════════════════════════════════════

/// VardhanEvent — a single event processed by the Vardhan system.
///
/// Fields (VARDHAN_CANONICAL_OBJECT_SPEC.md §7.1):
/// - `event_id`: Logical identity.
/// - `TenantScoped`: tenant_id, scope_hash.
/// - `actor`: EntityId of the actor (optional).
/// - `entity`: EntityId the event pertains to (optional).
/// - `event_type`: String type discriminator.
/// - `time`: TimeContext (A3).
/// - `config_hash`: ConfigurationHash (A4).
/// - `evidence_category`: DECISION | OUTCOME (A5).
/// - `schema_version`, `source`, `payload`, `evidence_ref`, `provenance`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct VardhanEvent {
    pub event_id: EventId,
    pub tenant_id: TenantId,
    pub scope_hash: [u8; 32],
    #[serde(skip)]
    pub status: EventStatus,
    pub actor: Option<ScopedEntityId>,
    pub entity: Option<ScopedEntityId>,
    pub event_type: String,
    #[serde(flatten)]
    pub time: TimeContext,
    pub config_hash: ConfigurationHash,
    pub evidence_category: crate::evidence::EvidenceCategory,
    pub schema_version: SchemaVersion,
    pub source: String,
    #[serde(default)]
    pub payload: serde_json::Value,
    pub evidence_ref: Option<EvidenceRef>,
    pub predecessor_event: Option<EventId>,
    pub payload_digest: ContentHash,
    pub created_at: TimeContext,
    #[serde(default)]
    pub related_event_ids: Vec<EventId>,
    #[serde(default)]
    pub related_object_refs: Vec<ObjectRef>,
}

impl VardhanEvent {
    /// Create a new VardhanEvent in CREATED status.
    /// `logical_time` is None (A3 — pre-commit).
    pub fn new(
        tenant_id: TenantId,
        source: impl Into<String>,
        event_type: impl Into<String>,
        payload: serde_json::Value,
        config_hash: ConfigurationHash,
        evidence_category: crate::evidence::EvidenceCategory,
    ) -> Self {
        let now = Utc::now();
        let tc = TimeContext::new(now);
        let event_id = EventId::new_v4();
        let event_type_str = event_type.into();
        let payload_digest =
            ContentHash::from_content(&serde_json::to_vec(&payload).unwrap_or_default());
        let scope_hash =
            Self::compute_scope_hash(tenant_id, &event_id, &event_type_str, &payload_digest);

        Self {
            event_id,
            tenant_id,
            scope_hash,
            status: EventStatus::Created,
            actor: None,
            entity: None,
            event_type: event_type_str,
            time: tc.clone(),
            config_hash,
            evidence_category,
            schema_version: SchemaVersion::VARDHAN_EVENT,
            source: source.into(),
            // Note: SchemaVersion::VARDHAN_EVENT is from vardhan_model
            payload,
            evidence_ref: None,
            predecessor_event: None,
            payload_digest,
            created_at: tc,
            related_event_ids: Vec::new(),
            related_object_refs: Vec::new(),
        }
    }

    fn compute_scope_hash(
        tenant_id: TenantId,
        event_id: &EventId,
        event_type: &str,
        payload_digest: &ContentHash,
    ) -> [u8; 32] {
        let mut combined = Vec::new();
        combined.extend_from_slice(&tenant_id.to_bytes());
        combined.extend_from_slice(event_id.as_uuid().as_bytes());
        combined.extend_from_slice(event_type.as_bytes());
        combined.extend_from_slice(payload_digest.as_bytes());
        *blake3::hash(&combined).as_bytes()
    }

    /// Verify that the payload digest matches the current payload.
    /// Used for duplicate-event protection (T-IDEM-01).
    pub fn verify_payload_digest(&self) -> bool {
        let computed =
            ContentHash::from_content(&serde_json::to_vec(&self.payload).unwrap_or_default());
        computed == self.payload_digest
    }

    /// Canonical serialization for content hashing and evidence_id computation.
    pub fn canonical_bytes(&self) -> Vec<u8> {
        let mut map: BTreeMap<String, serde_json::Value> = BTreeMap::new();
        map.insert(
            "event_id".to_string(),
            serde_json::Value::String(self.event_id.to_string()),
        );
        map.insert(
            "tenant_id".to_string(),
            serde_json::Value::String(self.tenant_id.to_string()),
        );
        map.insert(
            "scope_hash".to_string(),
            serde_json::Value::String(hex::encode(self.scope_hash)),
        );
        map.insert(
            "status".to_string(),
            serde_json::Value::String(format!("{:?}", self.status)),
        );
        map.insert(
            "event_type".to_string(),
            serde_json::Value::String(self.event_type.clone()),
        );
        map.insert(
            "actor".to_string(),
            self.actor
                .as_ref()
                .map(|a| serde_json::Value::String(a.entity_id.to_string()))
                .unwrap_or(serde_json::Value::Null),
        );
        map.insert(
            "entity".to_string(),
            self.entity
                .as_ref()
                .map(|e| serde_json::Value::String(e.entity_id.to_string()))
                .unwrap_or(serde_json::Value::Null),
        );
        map.insert(
            "time".to_string(),
            serde_json::to_value(self.time.canonical_bytes()).unwrap_or(serde_json::Value::Null),
        );
        map.insert(
            "config_hash".to_string(),
            serde_json::Value::String(self.config_hash.to_hex()),
        );
        map.insert(
            "evidence_category".to_string(),
            serde_json::Value::String(
                match self.evidence_category {
                    crate::evidence::EvidenceCategory::Decision => "DECISION",
                    crate::evidence::EvidenceCategory::Outcome => "OUTCOME",
                    crate::evidence::EvidenceCategory::Assurance => "ASSURANCE",
                    crate::evidence::EvidenceCategory::Verification => "VERIFICATION",
                }
                .to_string(),
            ),
        );
        map.insert(
            "schema_version".to_string(),
            serde_json::Value::String(self.schema_version.to_string()),
        );
        map.insert(
            "source".to_string(),
            serde_json::Value::String(self.source.clone()),
        );
        map.insert("payload".to_string(), self.payload.clone());
        map.insert(
            "payload_digest".to_string(),
            serde_json::Value::String(self.payload_digest.to_hex()),
        );
        map.insert(
            "evidence_ref".to_string(),
            self.evidence_ref
                .as_ref()
                .map(|e| serde_json::Value::String(e.evidence_id.to_hex()))
                .unwrap_or(serde_json::Value::Null),
        );
        map.insert(
            "predecessor_event".to_string(),
            self.predecessor_event
                .map(|id| serde_json::Value::String(id.to_string()))
                .unwrap_or(serde_json::Value::Null),
        );
        map.insert(
            "created_at".to_string(),
            serde_json::Value::String(self.created_at.event_time.to_rfc3339()),
        );

        serde_json::to_vec(&map).unwrap_or_default()
    }

    /// Compute G0-equivalent payload idempotency key.
    /// (T-IDEM-01: duplicate_event_payload_digest_rejected)
    pub fn idempotency_key(&self) -> ContentHash {
        let mut combined = Vec::new();
        combined.extend_from_slice(&self.tenant_id.to_bytes());
        combined.extend_from_slice(self.payload_digest.as_bytes());
        combined.extend_from_slice(self.event_type.as_bytes());
        ContentHash(*blake3::hash(&combined).as_bytes())
    }

    pub fn verify_scope_hash(&self) -> bool {
        let expected = Self::compute_scope_hash(
            self.tenant_id,
            &self.event_id,
            &self.event_type,
            &self.payload_digest,
        );
        self.scope_hash == expected
    }

    /// Assign a commit index (Logical Time, A3). Called only at Raft commit.
    pub fn assign_commit_index(&mut self, index: CommitIndex) {
        self.time.assign_commit_index(index);
    }
}

impl Hashable for VardhanEvent {
    fn canonical_bytes(&self) -> Vec<u8> {
        self.canonical_bytes()
    }
    fn content_hash(&self) -> ContentHash {
        ContentHash(*blake3::hash(&self.canonical_bytes()).as_bytes())
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// OBSERVATION
// ═════════════════════════════════════════════════════════════════════════════

/// Observation — a recorded outcome of an external action.
///
/// Fields (VARDHAN_CANONICAL_OBJECT_SPEC.md §8):
/// - `observation_id`: Logical identity.
/// - `TenantScoped`: tenant_id, scope_hash.
/// - `event_id`: The VardhanEvent this observation pertains to.
/// - `observer`: EntityId of the observer.
/// - `observation_type`: String type discriminator.
/// - `time`: TimeContext (A3).
/// - `config_hash`, `evidence_category`, `schema_version`, `payload`, `evidence_ref`, `provenance`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Observation {
    pub observation_id: ObservationId,
    pub tenant_id: TenantId,
    pub scope_hash: [u8; 32],
    #[serde(skip)]
    pub status: ObservationStatus,
    pub event_id: EventId,
    pub observer: ScopedEntityId,
    pub observation_type: String,
    #[serde(flatten)]
    pub time: TimeContext,
    pub config_hash: ConfigurationHash,
    pub evidence_category: crate::evidence::EvidenceCategory,
    pub schema_version: SchemaVersion,
    pub source: String,
    #[serde(default)]
    pub payload: serde_json::Value,
    pub evidence_ref: Option<EvidenceRef>,
    pub payload_digest: ContentHash,
    pub created_at: TimeContext,
}

impl Observation {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        tenant_id: TenantId,
        event_id: EventId,
        observer: ScopedEntityId,
        observation_type: impl Into<String>,
        source: impl Into<String>,
        payload: serde_json::Value,
        config_hash: ConfigurationHash,
        evidence_category: crate::evidence::EvidenceCategory,
    ) -> Self {
        let now = Utc::now();
        let tc = TimeContext::new(now);
        let observation_id = ObservationId::new_v4();
        let payload_digest =
            ContentHash::from_content(&serde_json::to_vec(&payload).unwrap_or_default());
        let obs_type_str = observation_type.into();
        let scope_hash = Self::compute_scope_hash(
            tenant_id,
            &observation_id,
            &event_id,
            &obs_type_str,
            &payload_digest,
        );

        Self {
            observation_id,
            tenant_id,
            scope_hash,
            status: ObservationStatus::Created,
            event_id,
            observer,
            observation_type: obs_type_str,
            time: tc.clone(),
            config_hash,
            evidence_category,
            schema_version: SCHEMA_VERSION_OBSERVATION,
            source: source.into(),
            payload,
            evidence_ref: None,
            payload_digest,
            created_at: tc,
        }
    }

    fn compute_scope_hash(
        tenant_id: TenantId,
        obs_id: &ObservationId,
        event_id: &EventId,
        obs_type: &str,
        payload_digest: &ContentHash,
    ) -> [u8; 32] {
        let mut combined = Vec::new();
        combined.extend_from_slice(&tenant_id.to_bytes());
        combined.extend_from_slice(obs_id.as_uuid().as_bytes());
        combined.extend_from_slice(event_id.as_uuid().as_bytes());
        combined.extend_from_slice(obs_type.as_bytes());
        combined.extend_from_slice(payload_digest.as_bytes());
        *blake3::hash(&combined).as_bytes()
    }

    pub fn canonical_bytes(&self) -> Vec<u8> {
        let mut map: BTreeMap<String, serde_json::Value> = BTreeMap::new();
        map.insert(
            "observation_id".to_string(),
            serde_json::Value::String(self.observation_id.to_string()),
        );
        map.insert(
            "tenant_id".to_string(),
            serde_json::Value::String(self.tenant_id.to_string()),
        );
        map.insert(
            "scope_hash".to_string(),
            serde_json::Value::String(hex::encode(self.scope_hash)),
        );
        map.insert(
            "status".to_string(),
            serde_json::Value::String(format!("{:?}", self.status)),
        );
        map.insert(
            "event_id".to_string(),
            serde_json::Value::String(self.event_id.to_string()),
        );
        map.insert(
            "observer".to_string(),
            serde_json::Value::String(self.observer.entity_id.to_string()),
        );
        map.insert(
            "observation_type".to_string(),
            serde_json::Value::String(self.observation_type.clone()),
        );
        map.insert(
            "time".to_string(),
            serde_json::to_value(self.time.canonical_bytes()).unwrap_or(serde_json::Value::Null),
        );
        map.insert(
            "config_hash".to_string(),
            serde_json::Value::String(self.config_hash.to_hex()),
        );
        map.insert(
            "evidence_category".to_string(),
            serde_json::Value::String(
                match self.evidence_category {
                    crate::evidence::EvidenceCategory::Decision => "DECISION",
                    crate::evidence::EvidenceCategory::Outcome => "OUTCOME",
                    crate::evidence::EvidenceCategory::Assurance => "ASSURANCE",
                    crate::evidence::EvidenceCategory::Verification => "VERIFICATION",
                }
                .to_string(),
            ),
        );
        map.insert(
            "schema_version".to_string(),
            serde_json::Value::String(self.schema_version.to_string()),
        );
        map.insert(
            "source".to_string(),
            serde_json::Value::String(self.source.clone()),
        );
        map.insert("payload".to_string(), self.payload.clone());
        map.insert(
            "payload_digest".to_string(),
            serde_json::Value::String(self.payload_digest.to_hex()),
        );
        map.insert(
            "evidence_ref".to_string(),
            self.evidence_ref
                .as_ref()
                .map(|e| serde_json::Value::String(e.evidence_id.to_hex()))
                .unwrap_or(serde_json::Value::Null),
        );
        map.insert(
            "created_at".to_string(),
            serde_json::Value::String(self.created_at.event_time.to_rfc3339()),
        );

        serde_json::to_vec(&map).unwrap_or_default()
    }

    pub fn assign_commit_index(&mut self, index: CommitIndex) {
        self.time.assign_commit_index(index);
    }
}

impl Hashable for Observation {
    fn canonical_bytes(&self) -> Vec<u8> {
        self.canonical_bytes()
    }
    fn content_hash(&self) -> ContentHash {
        ContentHash(*blake3::hash(&self.canonical_bytes()).as_bytes())
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// STATE SNAPSHOT
// ═════════════════════════════════════════════════════════════════════════════

/// StateSnapshot — an immutable point-in-time snapshot of the state tree.
///
/// The `state_hash` is computed over the state tree content
/// (entities + relationships + computed fields), NOT over metadata like
/// commit_index or created_at.
///
/// This enables deterministic state comparison across replicas.
///
/// Fields (VARDHAN_CANONICAL_OBJECT_SPEC.md §9):
/// - `snapshot_id`: Logical identity.
/// - `TenantScoped`: tenant_id, scope_hash.
/// - `state_hash`: BLAKE3 of state tree (distinct from ContentHash).
/// - `commit_index`: Logical Time (A3) — the commit_index at which this snapshot was taken.
/// - `parent_commit_index`: The previous commit_index (for chaining).
/// - `entities`: The Entity objects in this snapshot.
/// - `relationships`: The Relationship objects in this snapshot.
/// - `computed_fields`: Derived state (JSON, sorted keys).
/// - `config_hash`, `schema_version`, `created_at`, `provenance`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct StateSnapshot {
    pub snapshot_id: StateSnapshotId,
    pub tenant_id: TenantId,
    pub scope_hash: [u8; 32],
    pub state_hash: StateHash,
    pub commit_index: CommitIndex,
    pub parent_commit_index: Option<CommitIndex>,
    #[serde(default)]
    pub entities: Vec<TenantScoped<Entity>>,
    #[serde(default)]
    pub relationships: Vec<TenantScoped<Relationship>>,
    #[serde(default)]
    pub computed_fields: serde_json::Value,
    pub config_hash: ConfigurationHash,
    pub schema_version: SchemaVersion,
    pub created_at: TimeContext,
}

impl StateSnapshot {
    /// Create a new StateSnapshot at the given commit_index.
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        tenant_id: TenantId,
        snapshot_id: StateSnapshotId,
        commit_index: CommitIndex,
        parent: Option<CommitIndex>,
        entities: Vec<TenantScoped<Entity>>,
        relationships: Vec<TenantScoped<Relationship>>,
        computed_fields: serde_json::Value,
        config_hash: ConfigurationHash,
    ) -> Self {
        let mut tc = TimeContext::new(Utc::now());
        tc.assign_commit_index(commit_index);

        // Compute state_hash over the state tree ONLY (not metadata)
        // T-STATE-01: StateHash is BLAKE3 of state tree, not metadata
        let state_hash = Self::compute_state_hash(&entities, &relationships, &computed_fields);

        let scope_hash =
            Self::compute_scope_hash(tenant_id, &snapshot_id, &state_hash, &commit_index);

        Self {
            snapshot_id,
            tenant_id,
            scope_hash,
            state_hash,
            commit_index,
            parent_commit_index: parent,
            entities,
            relationships,
            computed_fields,
            config_hash,
            schema_version: SCHEMA_VERSION_STATE_SNAPSHOT,
            created_at: tc,
        }
    }

    /// Compute StateHash = BLAKE3 of canonical state tree (entities + relationships + computed_fields).
    /// NOT metadata. This enables deterministic state comparison across replicas.
    pub fn compute_state_hash(
        entities: &[TenantScoped<Entity>],
        relationships: &[TenantScoped<Relationship>],
        computed_fields: &serde_json::Value,
    ) -> StateHash {
        let mut combined = Vec::new();

        // Sort entities by content_hash for deterministic ordering
        let mut sorted_entities: Vec<ContentHash> =
            entities.iter().map(|e| e.inner.content_hash()).collect();
        sorted_entities.sort();

        // Sort relationships by content_hash
        let mut sorted_rels: Vec<ContentHash> = relationships
            .iter()
            .map(|r| r.inner.content_hash())
            .collect();
        sorted_rels.sort();

        // Hash each entity's canonical bytes
        for e in entities {
            combined.extend_from_slice(&e.inner.canonical_bytes());
        }
        for r in relationships {
            combined.extend_from_slice(&r.inner.canonical_bytes());
        }
        combined.extend_from_slice(&serde_json::to_vec(computed_fields).unwrap_or_default());

        StateHash(*blake3::hash(&combined).as_bytes())
    }

    fn compute_scope_hash(
        tenant_id: TenantId,
        snapshot_id: &StateSnapshotId,
        state_hash: &StateHash,
        commit_index: &CommitIndex,
    ) -> [u8; 32] {
        let mut combined = Vec::new();
        combined.extend_from_slice(&tenant_id.to_bytes());
        combined.extend_from_slice(snapshot_id.as_uuid().as_bytes());
        combined.extend_from_slice(state_hash.as_bytes());
        combined.extend_from_slice(&commit_index.get().to_be_bytes());
        *blake3::hash(&combined).as_bytes()
    }

    /// Verify that the state_hash matches the current state tree.
    /// (T-STATE-03: state_hash integrity verification on read)
    pub fn verify_state_hash(&self) -> bool {
        let computed =
            Self::compute_state_hash(&self.entities, &self.relationships, &self.computed_fields);
        computed == self.state_hash
    }

    pub fn canonical_bytes(&self) -> Vec<u8> {
        let mut map: BTreeMap<String, serde_json::Value> = BTreeMap::new();
        map.insert(
            "snapshot_id".to_string(),
            serde_json::Value::String(self.snapshot_id.to_string()),
        );
        map.insert(
            "tenant_id".to_string(),
            serde_json::Value::String(self.tenant_id.to_string()),
        );
        map.insert(
            "scope_hash".to_string(),
            serde_json::Value::String(hex::encode(self.scope_hash)),
        );
        map.insert(
            "state_hash".to_string(),
            serde_json::Value::String(self.state_hash.to_hex()),
        );
        map.insert(
            "commit_index".to_string(),
            serde_json::Value::Number(serde_json::Number::from(self.commit_index.get())),
        );
        map.insert(
            "parent_commit_index".to_string(),
            self.parent_commit_index
                .map(|ci| serde_json::Value::Number(serde_json::Number::from(ci.get())))
                .unwrap_or(serde_json::Value::Null),
        );
        map.insert(
            "config_hash".to_string(),
            serde_json::Value::String(self.config_hash.to_hex()),
        );
        map.insert(
            "schema_version".to_string(),
            serde_json::Value::String(self.schema_version.to_string()),
        );
        map.insert(
            "created_at".to_string(),
            serde_json::Value::String(self.created_at.event_time.to_rfc3339()),
        );

        serde_json::to_vec(&map).unwrap_or_default()
    }
}

impl Hashable for StateSnapshot {
    fn canonical_bytes(&self) -> Vec<u8> {
        self.canonical_bytes()
    }
    fn content_hash(&self) -> ContentHash {
        ContentHash(*blake3::hash(&self.canonical_bytes()).as_bytes())
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// STATE VERSION
// ═════════════════════════════════════════════════════════════════════════════

/// StateVersion — tracks the lineage and deltas of state versions.
///
/// Fields (VARDHAN_CANONICAL_OBJECT_SPEC.md §9):
/// - `version_id`: Logical identity.
/// - `TenantScoped`: tenant_id, scope_hash.
/// - `parent_version`: StateVersionId of the parent version (None for genesis).
/// - `commit_index`: Logical Time (A3).
/// - `state_hash`: The StateHash at this version.
/// - `delta_refs`: List of DeltaIds from the parent version to this version.
/// - `config_hash`, `schema_version`, `created_at`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct StateVersion {
    pub version_id: StateVersionId,
    pub tenant_id: TenantId,
    pub scope_hash: [u8; 32],
    pub parent_version: Option<StateVersionId>,
    pub commit_index: CommitIndex,
    pub state_hash: StateHash,
    #[serde(default)]
    pub delta_refs: Vec<DeltaId>,
    pub config_hash: ConfigurationHash,
    pub schema_version: SchemaVersion,
    pub created_at: TimeContext,
}

impl StateVersion {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        tenant_id: TenantId,
        version_id: StateVersionId,
        parent: Option<StateVersionId>,
        commit_index: CommitIndex,
        state_hash: StateHash,
        delta_refs: Vec<DeltaId>,
        config_hash: ConfigurationHash,
    ) -> Self {
        let mut tc = TimeContext::new(Utc::now());
        tc.assign_commit_index(commit_index);

        let scope_hash =
            Self::compute_scope_hash(tenant_id, &version_id, &commit_index, &state_hash);

        Self {
            version_id,
            tenant_id,
            scope_hash,
            parent_version: parent,
            commit_index,
            state_hash,
            delta_refs,
            config_hash,
            schema_version: SCHEMA_VERSION_STATE_VERSION,
            created_at: tc,
        }
    }

    fn compute_scope_hash(
        tenant_id: TenantId,
        version_id: &StateVersionId,
        commit_index: &CommitIndex,
        state_hash: &StateHash,
    ) -> [u8; 32] {
        let mut combined = Vec::new();
        combined.extend_from_slice(&tenant_id.to_bytes());
        combined.extend_from_slice(version_id.as_uuid().as_bytes());
        combined.extend_from_slice(&commit_index.get().to_be_bytes());
        combined.extend_from_slice(state_hash.as_bytes());
        *blake3::hash(&combined).as_bytes()
    }

    pub fn canonical_bytes(&self) -> Vec<u8> {
        let mut map: BTreeMap<String, serde_json::Value> = BTreeMap::new();
        map.insert(
            "version_id".to_string(),
            serde_json::Value::String(self.version_id.to_string()),
        );
        map.insert(
            "tenant_id".to_string(),
            serde_json::Value::String(self.tenant_id.to_string()),
        );
        map.insert(
            "scope_hash".to_string(),
            serde_json::Value::String(hex::encode(self.scope_hash)),
        );
        map.insert(
            "parent_version".to_string(),
            self.parent_version
                .map(|id| serde_json::Value::String(id.to_string()))
                .unwrap_or(serde_json::Value::Null),
        );
        map.insert(
            "commit_index".to_string(),
            serde_json::Value::Number(serde_json::Number::from(self.commit_index.get())),
        );
        map.insert(
            "state_hash".to_string(),
            serde_json::Value::String(self.state_hash.to_hex()),
        );
        map.insert(
            "delta_refs".to_string(),
            serde_json::Value::Array(
                self.delta_refs
                    .iter()
                    .map(|d| serde_json::Value::String(d.to_string()))
                    .collect(),
            ),
        );
        map.insert(
            "config_hash".to_string(),
            serde_json::Value::String(self.config_hash.to_hex()),
        );
        map.insert(
            "schema_version".to_string(),
            serde_json::Value::String(self.schema_version.to_string()),
        );
        map.insert(
            "created_at".to_string(),
            serde_json::Value::String(self.created_at.event_time.to_rfc3339()),
        );

        serde_json::to_vec(&map).unwrap_or_default()
    }
}

impl Hashable for StateVersion {
    fn canonical_bytes(&self) -> Vec<u8> {
        self.canonical_bytes()
    }
    fn content_hash(&self) -> ContentHash {
        ContentHash(*blake3::hash(&self.canonical_bytes()).as_bytes())
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// STATE TRANSITION RECORD
// ═════════════════════════════════════════════════════════════════════════════

/// StateTransitionRecord — represents a single state delta and its
/// progression through the architecture pipeline.
///
/// This is the bridge between the evidence layer (G0–G4, Raft) and
/// the state layer (Entity, Relationship, StateSnapshot).
///
/// Fields (VARDHAN_CANONICAL_OBJECT_SPEC.md §11):
/// - `delta_id`: Logical identity (DeltaId).
/// - `TenantScoped`: tenant_id, scope_hash.
/// - `previous_state_hash`: StateHash of the state before this transition.
/// - `resulting_state_hash`: StateHash of the state after this transition.
/// - `transition_type`: String describing what changed.
/// - `status`: Lifecycle state (PROPOSED → ... → OBSERVED_EXTERNAL_STATE).
/// - `evidence_ref`: EvidenceId linking to the EvidenceRecord.
/// - `commit_index`: Logical Time — assigned only at COMMITTED state.
/// - `proposer_identity`: EntityId of the proposer.
/// - `config_hash`: ConfigurationHash (A4).
/// - `created_at`, `applied_at`, `finalized_at`: TimeContext timestamps.
/// - `provenance`: ProvenanceTrail.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct StateTransitionRecord {
    pub delta_id: DeltaId,
    pub tenant_id: TenantId,
    pub scope_hash: [u8; 32],
    #[serde(skip)]
    pub status: StateTransitionStatus,
    pub previous_state_hash: StateHash,
    pub resulting_state_hash: StateHash,
    pub transition_type: crate::transition::TransitionType,
    pub evidence_ref: Option<EvidenceRef>,
    pub commit_index: Option<CommitIndex>,
    pub consensus_commit_index: Option<CommitIndex>,
    pub proposer_identity: ScopedEntityId,
    pub config_hash: ConfigurationHash,
    pub created_at: TimeContext,
    pub applied_at: Option<TimeContext>,
    pub finalized_at: Option<TimeContext>,
    #[serde(default)]
    pub related_event_ids: Vec<EventId>,
    #[serde(default)]
    pub related_object_refs: Vec<ObjectRef>,
}

impl StateTransitionRecord {
    /// Create a new StateTransitionRecord in PROPOSED state.
    /// `logical_time` is None (A3 — pre-commit).
    pub fn propose(
        tenant_id: TenantId,
        delta_id: DeltaId,
        previous_state_hash: StateHash,
        resulting_state_hash: StateHash,
        transition_type: crate::transition::TransitionType,
        proposer: ScopedEntityId,
        config_hash: ConfigurationHash,
    ) -> Result<Self, TenantBoundaryError> {
        // Enforce tenant boundary: proposer must be in the same tenant
        proposer.validate_tenant(tenant_id)?;

        let tc = TimeContext::new(Utc::now());
        let transition_type_str = serde_json::to_string(&transition_type).unwrap().trim_matches('"').to_string();
        let scope_hash = Self::compute_scope_hash(
            tenant_id,
            &delta_id,
            &previous_state_hash,
            &resulting_state_hash,
            &transition_type_str,
            &proposer,
        );

        Ok(Self {
            delta_id,
            tenant_id,
            scope_hash,
            status: StateTransitionStatus::Proposed,
            previous_state_hash,
            resulting_state_hash,
            transition_type,
            evidence_ref: None,
            commit_index: None,
            consensus_commit_index: None,
            proposer_identity: proposer,
            config_hash,
            created_at: tc.clone(),
            applied_at: None,
            finalized_at: None,
            related_event_ids: Vec::new(),
            related_object_refs: Vec::new(),
        })
    }

    fn compute_scope_hash(
        tenant_id: TenantId,
        delta_id: &DeltaId,
        prev: &StateHash,
        result: &StateHash,
        transition_type: &str,
        proposer: &ScopedEntityId,
    ) -> [u8; 32] {
        let mut combined = Vec::new();
        combined.extend_from_slice(&tenant_id.to_bytes());
        combined.extend_from_slice(delta_id.as_uuid().as_bytes());
        combined.extend_from_slice(prev.as_bytes());
        combined.extend_from_slice(result.as_bytes());
        combined.extend_from_slice(transition_type.as_bytes());
        combined.extend_from_slice(&proposer.entity_id.to_bytes());
        *blake3::hash(&combined).as_bytes()
    }

    /// Idempotency key for state transitions.
    /// (T-IDEM-02: duplicate_state_transition_record_no_op)
    /// Key = BLAKE3(tenant_id || delta_id)
    pub fn idempotency_key(&self) -> ContentHash {
        let mut combined = Vec::new();
        combined.extend_from_slice(&self.tenant_id.to_bytes());
        combined.extend_from_slice(self.delta_id.as_uuid().as_bytes());
        ContentHash(*blake3::hash(&combined).as_bytes())
    }

    /// State machine transition: apply an event and move to the next state.
    /// Enforces valid transition paths per VARDHAN_STATE_MACHINES.md §6.8.1.
    ///
    /// ```text
    /// PROPOSED → VALIDATED → EVIDENCE_PREPARED → COMMITTED → APPLIED
    ///    → EVIDENCED → VARDHAN_COMMITTED_STATE → OBSERVED_EXTERNAL_STATE
    /// ```
    pub fn transition(&mut self, event: StateTransitionEvent) -> Result<(), StateMachineError> {
        let new_status = match (&self.status, &event) {
            // ── Valid forward transitions (happy path) ──
            (StateTransitionStatus::Proposed, StateTransitionEvent::Validate) => {
                StateTransitionStatus::Validated
            }
            (StateTransitionStatus::Validated, StateTransitionEvent::PrepareEvidence) => {
                StateTransitionStatus::EvidencePrepared
            }
            (StateTransitionStatus::EvidencePrepared, StateTransitionEvent::RaftCommit(index)) => {
                self.commit_index = Some(*index);
                self.consensus_commit_index = Some(*index);
                StateTransitionStatus::Committed
            }
            (StateTransitionStatus::Committed, StateTransitionEvent::Apply) => {
                self.applied_at = Some(TimeContext::new(Utc::now()));
                StateTransitionStatus::Applied
            }
            (StateTransitionStatus::Applied, StateTransitionEvent::FinalizeEvidence) => {
                self.finalized_at = Some(TimeContext::new(Utc::now()));
                StateTransitionStatus::Evidenced
            }
            (StateTransitionStatus::Evidenced, StateTransitionEvent::PublishState) => {
                StateTransitionStatus::VardhanCommittedState
            }
            (
                StateTransitionStatus::VardhanCommittedState,
                StateTransitionEvent::ObserveOutcome,
            ) => StateTransitionStatus::ObservedExternalState,
            // ── Failure transitions ──
            (s, _) if s.is_speculative() && matches!(event, StateTransitionEvent::Validate) => {
                // A speculative state receiving Validate means it was already validated
                // — this is a re-validation attempt, which is a no-op.
                // Return Ok but don't change state.
                return Ok(());
            }
            (s, _)
                if matches!(
                    s,
                    StateTransitionStatus::Committed | StateTransitionStatus::Applied
                ) && matches!(event, StateTransitionEvent::FinalizeEvidence) =>
            {
                // Evidence finalization failure — rollback
                return Err(StateMachineError::TransitionInvalid {
                    from: format!("{:?}", s),
                    to: format!("{:?}", StateTransitionStatus::Rollback),
                    reason: "evidence finalization failed — rollback".to_string(),
                });
            }
            // Already-terminal states
            (s, _) if s.is_failure() => {
                return Err(StateMachineError::AlreadyTerminal {
                    state: format!("{:?}", s),
                });
            }
            (StateTransitionStatus::ObservedExternalState, _) => {
                return Err(StateMachineError::AlreadyTerminal {
                    state: "OBSERVED_EXTERNAL_STATE".to_string(),
                });
            }
            // Invalid transition
            _ => {
                return Err(StateMachineError::TransitionInvalid {
                    from: format!("{:?}", self.status),
                    to: format!("{:?}", event),
                    reason: "transition not allowed in current state".to_string(),
                });
            }
        };

        self.status = new_status;
        Ok(())
    }

    /// Validate that this transition record is fully committed and authoritative.
    /// (T-STATE-05: full lifecycle proposed_to_vardhan_committed_state)
    pub fn is_authoritative(&self) -> bool {
        self.status.is_authoritative()
    }

    /// Validate that this transition record is in a speculative state.
    /// (T-STATE-01: speculative_state_never_authoritative)
    pub fn is_speculative(&self) -> bool {
        self.status.is_speculative()
    }

    pub fn canonical_bytes(&self) -> Vec<u8> {
        let mut map: BTreeMap<String, serde_json::Value> = BTreeMap::new();
        map.insert(
            "delta_id".to_string(),
            serde_json::Value::String(self.delta_id.to_string()),
        );
        map.insert(
            "tenant_id".to_string(),
            serde_json::Value::String(self.tenant_id.to_string()),
        );
        map.insert(
            "scope_hash".to_string(),
            serde_json::Value::String(hex::encode(self.scope_hash)),
        );
        map.insert(
            "status".to_string(),
            serde_json::Value::String(format!("{:?}", self.status)),
        );
        map.insert(
            "previous_state_hash".to_string(),
            serde_json::Value::String(self.previous_state_hash.to_hex()),
        );
        map.insert(
            "resulting_state_hash".to_string(),
            serde_json::Value::String(self.resulting_state_hash.to_hex()),
        );
        map.insert(
            "transition_type".to_string(),
            serde_json::to_value(&self.transition_type).unwrap(),
        );
        map.insert(
            "evidence_ref".to_string(),
            self.evidence_ref
                .as_ref()
                .map(|e| serde_json::Value::String(e.evidence_id.to_hex()))
                .unwrap_or(serde_json::Value::Null),
        );
        map.insert(
            "commit_index".to_string(),
            self.commit_index
                .map(|ci| serde_json::Value::Number(serde_json::Number::from(ci.get())))
                .unwrap_or(serde_json::Value::Null),
        );
        map.insert(
            "consensus_commit_index".to_string(),
            self.consensus_commit_index
                .map(|ci| serde_json::Value::Number(serde_json::Number::from(ci.get())))
                .unwrap_or(serde_json::Value::Null),
        );
        map.insert(
            "proposer_identity".to_string(),
            serde_json::Value::String(self.proposer_identity.entity_id.to_string()),
        );
        map.insert(
            "config_hash".to_string(),
            serde_json::Value::String(self.config_hash.to_hex()),
        );
        map.insert(
            "created_at".to_string(),
            serde_json::Value::String(self.created_at.event_time.to_rfc3339()),
        );
        map.insert(
            "applied_at".to_string(),
            self.applied_at
                .as_ref()
                .map(|t| serde_json::Value::String(t.event_time.to_rfc3339()))
                .unwrap_or(serde_json::Value::Null),
        );
        map.insert(
            "finalized_at".to_string(),
            self.finalized_at
                .as_ref()
                .map(|t| serde_json::Value::String(t.event_time.to_rfc3339()))
                .unwrap_or(serde_json::Value::Null),
        );

        serde_json::to_vec(&map).unwrap_or_default()
    }
}

impl Hashable for StateTransitionRecord {
    fn canonical_bytes(&self) -> Vec<u8> {
        self.canonical_bytes()
    }
    fn content_hash(&self) -> ContentHash {
        ContentHash(*blake3::hash(&self.canonical_bytes()).as_bytes())
    }
}

impl TenantScopedObject for StateTransitionRecord {
    fn tenant_id(&self) -> TenantId {
        self.tenant_id
    }

    fn validate_tenant_scope(self) -> Result<Self, TenantBoundaryError>
    where
        Self: Sized,
    {
        self.proposer_identity.validate_tenant(self.tenant_id)?;
        Ok(self)
    }

    fn into_tenant_scoped(self) -> TenantScoped<Self>
    where
        Self: Hashable,
    {
        TenantScoped::new(self.tenant_id, self)
    }
}
