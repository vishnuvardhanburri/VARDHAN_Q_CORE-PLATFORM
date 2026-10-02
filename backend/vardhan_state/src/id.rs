//! # Vardhan State Fabric — Identifier Newtypes
//!
//! **Amendment A1, A2, A3**: Every identifier and hash is a **distinct newtype** —
//! not `String`, not `Vec<u8>`, not `[u8; 32]` alone. This prevents passing an
//! `EntityId` where a `DecisionId` is expected at compile time.
//!
//! Sourced exclusively from:
//! - `VARDHAN_OBJECT_TRAITS.md` §2.1 (Identifier Newtypes)
//! - `VARDHAN_CANONICAL_OBJECT_SPEC.md` §1 (Identity Systems)
//! - `VARDHAN_OBJECT_TRAITS.md` §2.3 (Schema Version → sourced from `vardhan_model`)
//!
//! No implicit conversion between any two identifier types. Conversion is always
//! explicit, always named, and always validated.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ─── Re-export SchemaVersion from vardhan_model (constitutional baseline) ─────
// SchemaVersion is sourced from the existing vardhan_model crate — must not be reinvented.
pub use vardhan_model::SchemaVersion;

// ─── ParseHashError ───────────────────────────────────────────────────────────

/// Error when parsing a hash from a hex string.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ParseHashError {
    #[error("invalid hex string: {0}")]
    InvalidHex(String),
    #[error("wrong length: expected {expected} bytes, got {actual}")]
    WrongLength { expected: usize, actual: usize },
}

// ─── Helper: UUID serde wrapper ───────────────────────────────────────────────
// Uses compact UUID serialization (no hyphens) for canonical JSON determinism.

mod uuid_serde {
    use serde::{Deserialize, Deserializer, Serializer};
    pub fn serialize<S: Serializer>(uuid: &uuid::Uuid, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&uuid.to_string())
    }
    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<uuid::Uuid, D::Error> {
        let s = String::deserialize(d)?;
        s.parse().map_err(serde::de::Error::custom)
    }
}

// ─── UUID-based Logical Identity Newtypes ─────────────────────────────────────
// Each is a distinct type wrapping Uuid. Not String, not raw UUID cast between types.

/// Tenant identifier — root of the tenant-scoped object hierarchy (A2).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct TenantId(#[serde(with = "uuid_serde")] Uuid);

/// Entity identifier — unique within a tenant (A2).
/// NOTE: This is a distinct type from `vardhan_model::EntityId` (which is String-based).
/// The runtime uses Uuid-based strong typing; the enterprise model uses String-based IDs.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct EntityId(#[serde(with = "uuid_serde")] Uuid);

/// Relationship identifier — unique within a tenant (A2).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RelationshipId(#[serde(with = "uuid_serde")] Uuid);

/// Event identifier — logical identity (queryable).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct EventId(#[serde(with = "uuid_serde")] Uuid);

/// Observation identifier — logical identity.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct ObservationId(#[serde(with = "uuid_serde")] Uuid);

/// Evidence logical identifier — Uuid for queryability.
/// NOTE: Distinct from `EvidenceId` (the cryptographic [u8; 32] identity).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct EvidenceLogicalId(#[serde(with = "uuid_serde")] Uuid);

/// State snapshot identifier — logical identity.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct StateSnapshotId(#[serde(with = "uuid_serde")] Uuid);

/// State version identifier — logical identity.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct StateVersionId(#[serde(with = "uuid_serde")] Uuid);

/// Delta identifier — logical identity for StateTransitionRecord.
/// Used in StateVersion.delta_refs.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct DeltaId(#[serde(with = "uuid_serde")] Uuid);

/// Decision identifier.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct DecisionId(#[serde(with = "uuid_serde")] Uuid);

/// Decision candidate identifier (always SPECULATIVE — A6).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct DecisionCandidateId(#[serde(with = "uuid_serde")] Uuid);

/// Action identifier.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct ActionId(#[serde(with = "uuid_serde")] Uuid);

/// Execution identifier.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct ExecutionId(#[serde(with = "uuid_serde")] Uuid);

/// Compensation identifier.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct CompensationId(#[serde(with = "uuid_serde")] Uuid);

/// Authorization identifier.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct AuthorizationId(#[serde(with = "uuid_serde")] Uuid);

/// Policy identifier.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct PolicyId(#[serde(with = "uuid_serde")] Uuid);

/// Constraint identifier.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct ConstraintId(#[serde(with = "uuid_serde")] Uuid);

/// Configuration identifier.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct ConfigId(#[serde(with = "uuid_serde")] Uuid);

/// Model artifact identifier.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct ModelArtifactId(#[serde(with = "uuid_serde")] Uuid);

/// Scenario identifier.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct ScenarioId(#[serde(with = "uuid_serde")] Uuid);

/// Outcome identifier.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct OutcomeId(#[serde(with = "uuid_serde")] Uuid);

/// Prediction error identifier.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct PredictionErrorId(#[serde(with = "uuid_serde")] Uuid);

// ─── Cryptographic Identity Newtypes ([u8; 32]) ──────────────────────────────
// These are [u8; 32] byte arrays. Each is a DISTINCT type despite same representation.
// This prevents passing a ContentHash where an EvidenceId is expected.

/// Evidence cryptographic identity — BLAKE3 of canonical EvidenceRecord bytes.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Hash, Serialize, Deserialize)]
pub struct EvidenceId(pub [u8; 32]);

/// Content hash — BLAKE3 of object's canonical bytes.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Hash, Serialize, Deserialize)]
pub struct ContentHash(pub [u8; 32]);

/// State hash — BLAKE3 of canonical state tree (entities + relationships + computed fields).
/// Distinct from ContentHash (which is over object metadata, not the state tree).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Hash, Serialize, Deserialize)]
pub struct StateHash(pub [u8; 32]);

/// Merkle tree commitment root — [u8; 32] Merkle root of a checkpoint.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Hash, Serialize, Deserialize)]
pub struct CommitmentId(pub [u8; 32]);

/// Model artifact hash — BLAKE3 of serialized model artifact bytes.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Hash, Serialize, Deserialize)]
pub struct ModelArtifactHash(pub [u8; 32]);

/// Policy hash — BLAKE3 of canonical policy definition bytes.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Hash, Serialize, Deserialize)]
pub struct PolicyHash(pub [u8; 32]);

/// Configuration hash — BLAKE3 of canonical configuration bytes (A4).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Hash, Serialize, Deserialize)]
pub struct ConfigurationHash(pub [u8; 32]);

// ─── Consensus / Time Newtypes (u64) ─────────────────────────────────────────

/// Raft election term.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RaftTerm(pub u64);

/// Raft log index — position in the Raft log.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RaftLogIndex(pub u64);

/// Commit index — Raft commit position. This IS Logical Time (A3).
/// Assigned only when a Raft entry is committed. `None` before commit.
#[derive(
    Clone, Copy, Debug, Eq, PartialEq, Hash, PartialOrd, Ord, Default, Serialize, Deserialize,
)]
pub struct CommitIndex(pub u64);

// ─── Execution Idempotency Key ───────────────────────────────────────────────

/// Idempotency key for external execution (A7).
/// Distinct type from all UUID-based identifiers to prevent confusion.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
pub struct ExecutionIdempotencyKey(#[serde(with = "uuid_serde")] Uuid);

// ─── ObjectRef ───────────────────────────────────────────────────────────────

/// Reference to an object by both logical and cryptographic identity.
/// Used in EvidenceRecord.related_object_refs.
#[derive(Clone, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
pub struct ObjectRef {
    pub object_type: String,
    pub logical_id: String,
    pub content_hash: ContentHash,
}

// ─── UUID generation helper ──────────────────────────────────────────────────

/// Generate a new v4 UUID. NOT `now_v7()` — use `new_v4()` per constitutional baseline.
pub fn new_uuid() -> Uuid {
    Uuid::new_v4()
}

// ─── UUID newtype method implementations ─────────────────────────────────────
// All UUID-based newtypes share the same constructor/accessor pattern.

impl TenantId {
    pub fn new_v4() -> Self {
        Self(uuid::Uuid::new_v4())
    }
    pub fn from_uuid(uuid: Uuid) -> Self {
        Self(uuid)
    }
    pub fn as_uuid(&self) -> &Uuid {
        &self.0
    }
    pub fn to_bytes(self) -> [u8; 16] {
        *self.0.as_bytes()
    }
    pub fn from_bytes(bytes: [u8; 16]) -> Self {
        Self(Uuid::from_bytes(bytes))
    }
    pub fn from_hex(s: &str) -> Result<Self, uuid::Error> {
        Uuid::parse_str(s).map(Self)
    }
}
impl std::fmt::Display for TenantId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}
impl From<Uuid> for TenantId {
    fn from(uuid: Uuid) -> Self {
        Self(uuid)
    }
}
impl From<TenantId> for Uuid {
    fn from(id: TenantId) -> Self {
        id.0
    }
}

impl EntityId {
    pub fn new_v4() -> Self {
        Self(uuid::Uuid::new_v4())
    }
    pub fn from_uuid(uuid: Uuid) -> Self {
        Self(uuid)
    }
    pub fn as_uuid(&self) -> &Uuid {
        &self.0
    }
    pub fn to_bytes(self) -> [u8; 16] {
        *self.0.as_bytes()
    }
    pub fn from_bytes(bytes: [u8; 16]) -> Self {
        Self(Uuid::from_bytes(bytes))
    }
    pub fn from_hex(s: &str) -> Result<Self, uuid::Error> {
        Uuid::parse_str(s).map(Self)
    }
}
impl std::fmt::Display for EntityId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}
impl From<Uuid> for EntityId {
    fn from(uuid: Uuid) -> Self {
        Self(uuid)
    }
}
impl From<EntityId> for Uuid {
    fn from(id: EntityId) -> Self {
        id.0
    }
}

impl RelationshipId {
    pub fn new_v4() -> Self {
        Self(uuid::Uuid::new_v4())
    }
    pub fn from_uuid(uuid: Uuid) -> Self {
        Self(uuid)
    }
    pub fn as_uuid(&self) -> &Uuid {
        &self.0
    }
}
impl std::fmt::Display for RelationshipId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}
impl From<Uuid> for RelationshipId {
    fn from(uuid: Uuid) -> Self {
        Self(uuid)
    }
}

impl EventId {
    pub fn new_v4() -> Self {
        Self(uuid::Uuid::new_v4())
    }
    pub fn from_uuid(uuid: Uuid) -> Self {
        Self(uuid)
    }
    pub fn as_uuid(&self) -> &Uuid {
        &self.0
    }
}
impl std::fmt::Display for EventId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}
impl From<Uuid> for EventId {
    fn from(uuid: Uuid) -> Self {
        Self(uuid)
    }
}

impl ObservationId {
    pub fn new_v4() -> Self {
        Self(uuid::Uuid::new_v4())
    }
    pub fn from_uuid(uuid: Uuid) -> Self {
        Self(uuid)
    }
    pub fn as_uuid(&self) -> &Uuid {
        &self.0
    }
}
impl std::fmt::Display for ObservationId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}
impl From<Uuid> for ObservationId {
    fn from(uuid: Uuid) -> Self {
        Self(uuid)
    }
}

impl EvidenceLogicalId {
    pub fn new_v4() -> Self {
        Self(uuid::Uuid::new_v4())
    }
    pub fn from_uuid(uuid: Uuid) -> Self {
        Self(uuid)
    }
    pub fn as_uuid(&self) -> &Uuid {
        &self.0
    }
}
impl std::fmt::Display for EvidenceLogicalId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}
impl From<Uuid> for EvidenceLogicalId {
    fn from(uuid: Uuid) -> Self {
        Self(uuid)
    }
}

impl StateSnapshotId {
    pub fn new_v4() -> Self {
        Self(uuid::Uuid::new_v4())
    }
    pub fn from_uuid(uuid: Uuid) -> Self {
        Self(uuid)
    }
    pub fn as_uuid(&self) -> &Uuid {
        &self.0
    }
}
impl std::fmt::Display for StateSnapshotId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}
impl From<Uuid> for StateSnapshotId {
    fn from(uuid: Uuid) -> Self {
        Self(uuid)
    }
}

impl StateVersionId {
    pub fn new_v4() -> Self {
        Self(uuid::Uuid::new_v4())
    }
    pub fn from_uuid(uuid: Uuid) -> Self {
        Self(uuid)
    }
    pub fn as_uuid(&self) -> &Uuid {
        &self.0
    }
}
impl std::fmt::Display for StateVersionId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}
impl From<Uuid> for StateVersionId {
    fn from(uuid: Uuid) -> Self {
        Self(uuid)
    }
}

impl DeltaId {
    pub fn new_v4() -> Self {
        Self(uuid::Uuid::new_v4())
    }
    pub fn from_uuid(uuid: Uuid) -> Self {
        Self(uuid)
    }
    pub fn as_uuid(&self) -> &Uuid {
        &self.0
    }
}
impl std::fmt::Display for DeltaId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}
impl From<Uuid> for DeltaId {
    fn from(uuid: Uuid) -> Self {
        Self(uuid)
    }
}

impl DecisionId {
    pub fn new_v4() -> Self {
        Self(uuid::Uuid::new_v4())
    }
    pub fn from_uuid(uuid: Uuid) -> Self {
        Self(uuid)
    }
    pub fn as_uuid(&self) -> &Uuid {
        &self.0
    }
}
impl std::fmt::Display for DecisionId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}
impl From<Uuid> for DecisionId {
    fn from(uuid: Uuid) -> Self {
        Self(uuid)
    }
}

impl DecisionCandidateId {
    pub fn new_v4() -> Self {
        Self(uuid::Uuid::new_v4())
    }
    pub fn from_uuid(uuid: Uuid) -> Self {
        Self(uuid)
    }
    pub fn as_uuid(&self) -> &Uuid {
        &self.0
    }
}
impl std::fmt::Display for DecisionCandidateId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}
impl From<Uuid> for DecisionCandidateId {
    fn from(uuid: Uuid) -> Self {
        Self(uuid)
    }
}

impl ActionId {
    pub fn new_v4() -> Self {
        Self(uuid::Uuid::new_v4())
    }
    pub fn from_uuid(uuid: Uuid) -> Self {
        Self(uuid)
    }
    pub fn as_uuid(&self) -> &Uuid {
        &self.0
    }
}
impl std::fmt::Display for ActionId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}
impl From<Uuid> for ActionId {
    fn from(uuid: Uuid) -> Self {
        Self(uuid)
    }
}

impl ExecutionId {
    pub fn new_v4() -> Self {
        Self(uuid::Uuid::new_v4())
    }
    pub fn from_uuid(uuid: Uuid) -> Self {
        Self(uuid)
    }
    pub fn as_uuid(&self) -> &Uuid {
        &self.0
    }
}
impl std::fmt::Display for ExecutionId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}
impl From<Uuid> for ExecutionId {
    fn from(uuid: Uuid) -> Self {
        Self(uuid)
    }
}

impl CompensationId {
    pub fn new_v4() -> Self {
        Self(uuid::Uuid::new_v4())
    }
    pub fn from_uuid(uuid: Uuid) -> Self {
        Self(uuid)
    }
    pub fn as_uuid(&self) -> &Uuid {
        &self.0
    }
}
impl std::fmt::Display for CompensationId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}
impl From<Uuid> for CompensationId {
    fn from(uuid: Uuid) -> Self {
        Self(uuid)
    }
}

impl AuthorizationId {
    pub fn new_v4() -> Self {
        Self(uuid::Uuid::new_v4())
    }
    pub fn from_uuid(uuid: Uuid) -> Self {
        Self(uuid)
    }
    pub fn as_uuid(&self) -> &Uuid {
        &self.0
    }
}
impl std::fmt::Display for AuthorizationId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}
impl From<Uuid> for AuthorizationId {
    fn from(uuid: Uuid) -> Self {
        Self(uuid)
    }
}

impl PolicyId {
    pub fn new_v4() -> Self {
        Self(uuid::Uuid::new_v4())
    }
    pub fn from_uuid(uuid: Uuid) -> Self {
        Self(uuid)
    }
    pub fn as_uuid(&self) -> &Uuid {
        &self.0
    }
}
impl std::fmt::Display for PolicyId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}
impl From<Uuid> for PolicyId {
    fn from(uuid: Uuid) -> Self {
        Self(uuid)
    }
}

impl ConstraintId {
    pub fn new_v4() -> Self {
        Self(uuid::Uuid::new_v4())
    }
    pub fn from_uuid(uuid: Uuid) -> Self {
        Self(uuid)
    }
    pub fn as_uuid(&self) -> &Uuid {
        &self.0
    }
}
impl std::fmt::Display for ConstraintId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}
impl From<Uuid> for ConstraintId {
    fn from(uuid: Uuid) -> Self {
        Self(uuid)
    }
}

impl ConfigId {
    pub fn new_v4() -> Self {
        Self(uuid::Uuid::new_v4())
    }
    pub fn from_uuid(uuid: Uuid) -> Self {
        Self(uuid)
    }
    pub fn as_uuid(&self) -> &Uuid {
        &self.0
    }
}
impl std::fmt::Display for ConfigId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}
impl From<Uuid> for ConfigId {
    fn from(uuid: Uuid) -> Self {
        Self(uuid)
    }
}

impl ModelArtifactId {
    pub fn new_v4() -> Self {
        Self(uuid::Uuid::new_v4())
    }
    pub fn from_uuid(uuid: Uuid) -> Self {
        Self(uuid)
    }
    pub fn as_uuid(&self) -> &Uuid {
        &self.0
    }
}
impl std::fmt::Display for ModelArtifactId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}
impl From<Uuid> for ModelArtifactId {
    fn from(uuid: Uuid) -> Self {
        Self(uuid)
    }
}

impl ScenarioId {
    pub fn new_v4() -> Self {
        Self(uuid::Uuid::new_v4())
    }
    pub fn from_uuid(uuid: Uuid) -> Self {
        Self(uuid)
    }
    pub fn as_uuid(&self) -> &Uuid {
        &self.0
    }
}
impl std::fmt::Display for ScenarioId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}
impl From<Uuid> for ScenarioId {
    fn from(uuid: Uuid) -> Self {
        Self(uuid)
    }
}

impl OutcomeId {
    pub fn new_v4() -> Self {
        Self(uuid::Uuid::new_v4())
    }
    pub fn from_uuid(uuid: Uuid) -> Self {
        Self(uuid)
    }
    pub fn as_uuid(&self) -> &Uuid {
        &self.0
    }
}
impl std::fmt::Display for OutcomeId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}
impl From<Uuid> for OutcomeId {
    fn from(uuid: Uuid) -> Self {
        Self(uuid)
    }
}

impl PredictionErrorId {
    pub fn new_v4() -> Self {
        Self(uuid::Uuid::new_v4())
    }
    pub fn from_uuid(uuid: Uuid) -> Self {
        Self(uuid)
    }
    pub fn as_uuid(&self) -> &Uuid {
        &self.0
    }
}
impl std::fmt::Display for PredictionErrorId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}
impl From<Uuid> for PredictionErrorId {
    fn from(uuid: Uuid) -> Self {
        Self(uuid)
    }
}

impl ExecutionIdempotencyKey {
    pub fn new_v4() -> Self {
        Self(uuid::Uuid::new_v4())
    }
    pub fn from_uuid(uuid: Uuid) -> Self {
        Self(uuid)
    }
    pub fn as_uuid(&self) -> &Uuid {
        &self.0
    }
}
impl std::fmt::Display for ExecutionIdempotencyKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}
impl From<Uuid> for ExecutionIdempotencyKey {
    fn from(uuid: Uuid) -> Self {
        Self(uuid)
    }
}

// ─── [u8; 32] hash newtype method implementations ─────────────────────────────

impl EvidenceId {
    pub const fn new(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }
    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
    pub fn into_bytes(self) -> [u8; 32] {
        self.0
    }
    pub fn from_content(content: &[u8]) -> Self {
        Self(*blake3::hash(content).as_bytes())
    }
    pub fn is_zero(&self) -> bool {
        self.0 == [0u8; 32]
    }
    pub fn from_hex(s: &str) -> Result<Self, ParseHashError> {
        let bytes = hex::decode(s).map_err(|e| ParseHashError::InvalidHex(e.to_string()))?;
        if bytes.len() != 32 {
            return Err(ParseHashError::WrongLength {
                expected: 32,
                actual: bytes.len(),
            });
        }
        let mut arr = [0u8; 32];
        arr.copy_from_slice(&bytes);
        Ok(Self(arr))
    }
    pub fn to_hex(&self) -> String {
        hex::encode(self.0)
    }
}
impl std::fmt::Display for EvidenceId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", hex::encode(self.0))
    }
}
impl From<[u8; 32]> for EvidenceId {
    fn from(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }
}
impl From<EvidenceId> for [u8; 32] {
    fn from(h: EvidenceId) -> Self {
        h.0
    }
}

impl ContentHash {
    pub const fn new(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }
    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
    pub fn into_bytes(self) -> [u8; 32] {
        self.0
    }
    pub fn from_content(content: &[u8]) -> Self {
        Self(*blake3::hash(content).as_bytes())
    }
    pub fn is_zero(&self) -> bool {
        self.0 == [0u8; 32]
    }
    pub fn from_hex(s: &str) -> Result<Self, ParseHashError> {
        let bytes = hex::decode(s).map_err(|e| ParseHashError::InvalidHex(e.to_string()))?;
        if bytes.len() != 32 {
            return Err(ParseHashError::WrongLength {
                expected: 32,
                actual: bytes.len(),
            });
        }
        let mut arr = [0u8; 32];
        arr.copy_from_slice(&bytes);
        Ok(Self(arr))
    }
    pub fn to_hex(&self) -> String {
        hex::encode(self.0)
    }
}
impl std::fmt::Display for ContentHash {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", hex::encode(self.0))
    }
}
impl From<[u8; 32]> for ContentHash {
    fn from(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }
}
impl From<ContentHash> for [u8; 32] {
    fn from(h: ContentHash) -> Self {
        h.0
    }
}

impl StateHash {
    pub const fn new(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }
    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
    pub fn into_bytes(self) -> [u8; 32] {
        self.0
    }
    pub fn from_content(content: &[u8]) -> Self {
        Self(*blake3::hash(content).as_bytes())
    }
    pub fn is_zero(&self) -> bool {
        self.0 == [0u8; 32]
    }
    pub fn from_hex(s: &str) -> Result<Self, ParseHashError> {
        let bytes = hex::decode(s).map_err(|e| ParseHashError::InvalidHex(e.to_string()))?;
        if bytes.len() != 32 {
            return Err(ParseHashError::WrongLength {
                expected: 32,
                actual: bytes.len(),
            });
        }
        let mut arr = [0u8; 32];
        arr.copy_from_slice(&bytes);
        Ok(Self(arr))
    }
    pub fn to_hex(&self) -> String {
        hex::encode(self.0)
    }
}
impl std::fmt::Display for StateHash {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", hex::encode(self.0))
    }
}
impl From<[u8; 32]> for StateHash {
    fn from(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }
}
impl From<StateHash> for [u8; 32] {
    fn from(h: StateHash) -> Self {
        h.0
    }
}

impl CommitmentId {
    pub const fn new(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }
    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
    pub fn into_bytes(self) -> [u8; 32] {
        self.0
    }
    pub fn from_content(content: &[u8]) -> Self {
        Self(*blake3::hash(content).as_bytes())
    }
    pub fn from_hex(s: &str) -> Result<Self, ParseHashError> {
        let bytes = hex::decode(s).map_err(|e| ParseHashError::InvalidHex(e.to_string()))?;
        if bytes.len() != 32 {
            return Err(ParseHashError::WrongLength {
                expected: 32,
                actual: bytes.len(),
            });
        }
        let mut arr = [0u8; 32];
        arr.copy_from_slice(&bytes);
        Ok(Self(arr))
    }
    pub fn to_hex(&self) -> String {
        hex::encode(self.0)
    }
}
impl std::fmt::Display for CommitmentId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", hex::encode(self.0))
    }
}
impl From<[u8; 32]> for CommitmentId {
    fn from(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }
}

impl ModelArtifactHash {
    pub const fn new(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }
    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
    pub fn into_bytes(self) -> [u8; 32] {
        self.0
    }
    pub fn from_content(content: &[u8]) -> Self {
        Self(*blake3::hash(content).as_bytes())
    }
    pub fn from_hex(s: &str) -> Result<Self, ParseHashError> {
        let bytes = hex::decode(s).map_err(|e| ParseHashError::InvalidHex(e.to_string()))?;
        if bytes.len() != 32 {
            return Err(ParseHashError::WrongLength {
                expected: 32,
                actual: bytes.len(),
            });
        }
        let mut arr = [0u8; 32];
        arr.copy_from_slice(&bytes);
        Ok(Self(arr))
    }
    pub fn to_hex(&self) -> String {
        hex::encode(self.0)
    }
}
impl std::fmt::Display for ModelArtifactHash {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", hex::encode(self.0))
    }
}
impl From<[u8; 32]> for ModelArtifactHash {
    fn from(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }
}

impl PolicyHash {
    pub const fn new(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }
    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
    pub fn into_bytes(self) -> [u8; 32] {
        self.0
    }
    pub fn from_content(content: &[u8]) -> Self {
        Self(*blake3::hash(content).as_bytes())
    }
    pub fn from_hex(s: &str) -> Result<Self, ParseHashError> {
        let bytes = hex::decode(s).map_err(|e| ParseHashError::InvalidHex(e.to_string()))?;
        if bytes.len() != 32 {
            return Err(ParseHashError::WrongLength {
                expected: 32,
                actual: bytes.len(),
            });
        }
        let mut arr = [0u8; 32];
        arr.copy_from_slice(&bytes);
        Ok(Self(arr))
    }
    pub fn to_hex(&self) -> String {
        hex::encode(self.0)
    }
}
impl std::fmt::Display for PolicyHash {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", hex::encode(self.0))
    }
}
impl From<[u8; 32]> for PolicyHash {
    fn from(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }
}

impl ConfigurationHash {
    pub const fn new(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }
    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
    pub fn into_bytes(self) -> [u8; 32] {
        self.0
    }
    pub fn from_content(content: &[u8]) -> Self {
        Self(*blake3::hash(content).as_bytes())
    }
    pub fn from_hex(s: &str) -> Result<Self, ParseHashError> {
        let bytes = hex::decode(s).map_err(|e| ParseHashError::InvalidHex(e.to_string()))?;
        if bytes.len() != 32 {
            return Err(ParseHashError::WrongLength {
                expected: 32,
                actual: bytes.len(),
            });
        }
        let mut arr = [0u8; 32];
        arr.copy_from_slice(&bytes);
        Ok(Self(arr))
    }
    pub fn to_hex(&self) -> String {
        hex::encode(self.0)
    }
}
impl std::fmt::Display for ConfigurationHash {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", hex::encode(self.0))
    }
}
impl From<[u8; 32]> for ConfigurationHash {
    fn from(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }
}

// ─── u64 consensus newtype method implementations ─────────────────────────────

impl RaftTerm {
    pub const fn new(value: u64) -> Self {
        Self(value)
    }
    pub const fn get(self) -> u64 {
        self.0
    }
    pub fn increment(&mut self) -> u64 {
        self.0 += 1;
        self.0
    }
}
impl From<u64> for RaftTerm {
    fn from(v: u64) -> Self {
        Self(v)
    }
}
impl From<RaftTerm> for u64 {
    fn from(v: RaftTerm) -> Self {
        v.0
    }
}
impl std::ops::Add<u64> for RaftTerm {
    type Output = Self;
    fn add(self, rhs: u64) -> Self {
        Self(self.0 + rhs)
    }
}
impl std::ops::AddAssign<u64> for RaftTerm {
    fn add_assign(&mut self, rhs: u64) {
        self.0 += rhs;
    }
}
impl PartialEq<u64> for RaftTerm {
    fn eq(&self, other: &u64) -> bool {
        self.0 == *other
    }
}
impl std::fmt::Display for RaftTerm {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl RaftLogIndex {
    pub const fn new(value: u64) -> Self {
        Self(value)
    }
    pub const fn get(self) -> u64 {
        self.0
    }
    pub fn increment(&mut self) -> u64 {
        self.0 += 1;
        self.0
    }
}
impl From<u64> for RaftLogIndex {
    fn from(v: u64) -> Self {
        Self(v)
    }
}
impl From<RaftLogIndex> for u64 {
    fn from(v: RaftLogIndex) -> Self {
        v.0
    }
}
impl std::ops::Add<u64> for RaftLogIndex {
    type Output = Self;
    fn add(self, rhs: u64) -> Self {
        Self(self.0 + rhs)
    }
}
impl std::ops::AddAssign<u64> for RaftLogIndex {
    fn add_assign(&mut self, rhs: u64) {
        self.0 += rhs;
    }
}
impl PartialEq<u64> for RaftLogIndex {
    fn eq(&self, other: &u64) -> bool {
        self.0 == *other
    }
}
impl std::fmt::Display for RaftLogIndex {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl CommitIndex {
    pub const fn new(value: u64) -> Self {
        Self(value)
    }
    pub const fn get(self) -> u64 {
        self.0
    }
    pub fn increment(&mut self) -> u64 {
        self.0 += 1;
        self.0
    }
}
impl From<u64> for CommitIndex {
    fn from(v: u64) -> Self {
        Self(v)
    }
}
impl From<CommitIndex> for u64 {
    fn from(v: CommitIndex) -> Self {
        v.0
    }
}
impl std::ops::Add<u64> for CommitIndex {
    type Output = Self;
    fn add(self, rhs: u64) -> Self {
        Self(self.0 + rhs)
    }
}
impl std::ops::AddAssign<u64> for CommitIndex {
    fn add_assign(&mut self, rhs: u64) {
        self.0 += rhs;
    }
}
impl PartialEq<u64> for CommitIndex {
    fn eq(&self, other: &u64) -> bool {
        self.0 == *other
    }
}
impl std::fmt::Display for CommitIndex {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

// ─── Zero / None constants for hash types ────────────────────────────────────

impl EvidenceId {
    pub const ZERO: Self = Self([0u8; 32]);
}
impl StateHash {
    pub const ZERO: Self = Self([0u8; 32]);
}
impl ContentHash {
    pub const ZERO: Self = Self([0u8; 32]);
}

// ─── SchemaVersion constants ─────────────────────────────────────────────────
// SchemaVersion is sourced from vardhan_model. These constants are defined
// as struct literals per constitutional baseline.
pub const SCHEMA_VERSION_TENANT: SchemaVersion = SchemaVersion {
    major: 1,
    minor: 0,
    patch: 0,
};
pub const SCHEMA_VERSION_ENTITY: SchemaVersion = SchemaVersion {
    major: 1,
    minor: 0,
    patch: 0,
};
pub const SCHEMA_VERSION_RELATIONSHIP: SchemaVersion = SchemaVersion {
    major: 1,
    minor: 0,
    patch: 0,
};
pub const SCHEMA_VERSION_OBSERVATION: SchemaVersion = SchemaVersion {
    major: 1,
    minor: 0,
    patch: 0,
};
pub const SCHEMA_VERSION_STATE_SNAPSHOT: SchemaVersion = SchemaVersion {
    major: 1,
    minor: 0,
    patch: 0,
};
pub const SCHEMA_VERSION_STATE_VERSION: SchemaVersion = SchemaVersion {
    major: 1,
    minor: 0,
    patch: 0,
};

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tenant_id_distinct_from_entity_id() {
        let t = TenantId::new_v4();
        let e = EntityId::new_v4();
        // These are different types — compiler enforces this
        assert_ne!(t.as_uuid(), e.as_uuid());
    }

    #[test]
    fn test_evidence_id_distinct_from_content_hash() {
        let bytes = [1u8; 32];
        let evidence_id = EvidenceId::new(bytes);
        let content_hash = ContentHash::new(bytes);
        // Both wrap [u8; 32] but are distinct types
        assert_eq!(evidence_id.as_bytes(), content_hash.as_bytes());
        // But cannot be passed where the other is expected
    }

    #[test]
    fn test_state_hash_distinct_from_content_hash() {
        let sh = StateHash::new([0xab; 32]);
        let _ch = ContentHash::new([0xab; 32]);
        // Same inner bytes but different types
        assert_ne!(Some(sh.as_bytes()), None::<&[u8; 32]>);
    }

    #[test]
    fn test_commit_index_is_logical_time() {
        let ci = CommitIndex::new(42);
        assert_eq!(ci.get(), 42);
        let mut ci2 = CommitIndex::new(0);
        ci2.increment();
        assert_eq!(ci2.get(), 1);
    }

    #[test]
    fn test_uuid_newtypes_generate_unique() {
        let a = TenantId::new_v4();
        let b = TenantId::new_v4();
        assert_ne!(a, b, "UUIDs must be unique");
    }

    #[test]
    fn test_hash_newtypes_from_content() {
        let hash = ContentHash::from_content(b"hello world");
        let hash2 = ContentHash::from_content(b"hello world");
        assert_eq!(hash, hash2, "same content → same hash");

        let hash3 = ContentHash::from_content(b"hello worlD");
        assert_ne!(hash, hash3, "different content → different hash");
    }

    #[test]
    fn test_hex_roundtrip() {
        let original = StateHash::new([0x42; 32]);
        let hex_str = original.to_hex();
        let parsed = StateHash::from_hex(&hex_str).unwrap();
        assert_eq!(original, parsed);
    }

    #[test]
    fn test_schema_version_reexported() {
        // SchemaVersion comes from vardhan_model — constitutional baseline
        let sv = SchemaVersion::new(1, 0, 0);
        assert_eq!(sv.major, 1);
        assert_eq!(sv.to_string(), "1.0.0");
    }
}

// ─── Legacy IDs formalized via FA-13 ─────────────────────────────────────────

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct AssuranceResultId(#[serde(with = "uuid_serde")] pub Uuid);

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RiskProfileId(#[serde(with = "uuid_serde")] pub Uuid);

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct StateTransitionRecordId(#[serde(with = "uuid_serde")] pub Uuid);

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct PolicyEvaluationId(#[serde(with = "uuid_serde")] pub Uuid);

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct DecisionMemoryId(#[serde(with = "uuid_serde")] pub Uuid);

// ─── ProofMesh Domain Identifiers ────────────────────────────────────────────

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct VerificationClaimId(#[serde(with = "uuid_serde")] pub Uuid);

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct ExecutionPlanId(#[serde(with = "uuid_serde")] pub Uuid);

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct VerificationRunRecordId(#[serde(with = "uuid_serde")] pub Uuid);

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct ReplayCapsuleId(#[serde(with = "uuid_serde")] pub Uuid);

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct EvidenceQuorumSnapshotId(#[serde(with = "uuid_serde")] pub Uuid);

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct VerificationFindingId(#[serde(with = "uuid_serde")] pub Uuid);

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct FaultScenarioId(#[serde(with = "uuid_serde")] pub Uuid);
