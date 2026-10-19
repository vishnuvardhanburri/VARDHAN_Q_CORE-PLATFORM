use serde::{Deserialize, Serialize};
use uuid::Uuid;

// Import frozen identifiers from the base state crate
use vardhan_state::id::{
    ActionId, AuthorizationId, CompensationId, ConfigId, ConstraintId, DecisionCandidateId,
    DecisionId, EntityId, EventId, EvidenceId, ExecutionId, ModelArtifactId, ObservationId,
    OutcomeId, PolicyId, PredictionErrorId, RelationshipId, ScenarioId, StateSnapshotId,
    StateVersionId, TenantId,
};

// ─── Legacy IDs formalized via FA-13 ─────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct AssuranceResultId(pub Uuid);

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct RiskProfileId(pub Uuid);

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct StateTransitionRecordId(pub Uuid);

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct PolicyEvaluationId(pub Uuid);

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct DecisionMemoryId(pub Uuid);

// ─── ProofMesh Domain Identifiers ────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct VerificationClaimId(pub Uuid);

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ExecutionPlanId(pub Uuid);

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct VerificationRunRecordId(pub Uuid);

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ReplayCapsuleId(pub Uuid);

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct EvidenceQuorumSnapshotId(pub Uuid);

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct VerificationFindingId(pub Uuid);

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct FaultScenarioId(pub Uuid);

// ─── Exhaustive CanonicalObjectRef ───────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum CanonicalObjectRef {
    // ── 26 Frozen Canonical Objects ──
    Tenant(TenantId),
    Entity(EntityId),
    Relationship(RelationshipId),
    Event(EventId),
    StateSnapshot(StateSnapshotId),
    StateVersion(StateVersionId),
    StateTransitionRecord(StateTransitionRecordId), // Upgraded via FA-13
    ConfigurationSnapshot(ConfigId),
    Policy(PolicyId),
    Constraint(ConstraintId),
    DecisionTwin(DecisionId),
    DecisionCandidate(DecisionCandidateId),
    DecisionMemory(DecisionMemoryId),     // Upgraded via FA-13
    PolicyEvaluation(PolicyEvaluationId), // Upgraded via FA-13
    AssuranceResult(AssuranceResultId),   // Upgraded via FA-13
    Authorization(AuthorizationId),
    Action(ActionId),
    Execution(ExecutionId),
    Observation(ObservationId),
    Outcome(OutcomeId),
    Compensation(CompensationId),
    ModelProvenance(ModelArtifactId),
    PredictionError(PredictionErrorId),
    RiskProfile(RiskProfileId), // Upgraded via FA-13
    Scenario(ScenarioId),
    EvidenceRecord(EvidenceId),

    // ── 7 ProofMesh Canonical Objects ──
    VerificationClaim(VerificationClaimId),
    ExecutionPlan(ExecutionPlanId),
    VerificationRunRecord(VerificationRunRecordId),
    ReplayCapsule(ReplayCapsuleId),
    EvidenceQuorumSnapshot(EvidenceQuorumSnapshotId),
    VerificationFinding(VerificationFindingId),
    FaultScenario(FaultScenarioId),
}

use vardhan_state::evidence::{AuthContext, EvidenceCategory, ProvenanceEntry};
use vardhan_state::id::{
    ConfigurationHash, ContentHash, EvidenceLogicalId, SchemaVersion, StateHash,
};

/// Explicit cryptographic envelope binding all semantic fields of evidence.
/// Fixes the subset-binding vulnerability by including schema_version and all metadata.
#[derive(serde::Serialize)]
pub struct ProofMeshEvidenceSigningEnvelopeV1<'a> {
    pub domain_separator: &'static str,
    pub schema_version: &'a SchemaVersion,
    pub tenant_id: &'a TenantId,
    pub logical_id: &'a EvidenceLogicalId,
    pub payload_digest: &'a ContentHash,
    pub evidence_category: &'a EvidenceCategory,
    pub source: &'a str,
    pub config_hash: &'a ConfigurationHash,
    pub state_hash: Option<&'a StateHash>,
    pub timestamp_system_ms: u64,
    pub related_object_refs: &'a [CanonicalObjectRef],
    pub provenance: &'a [ProvenanceEntry],
    pub authorization_context: Option<&'a AuthContext>,
}
