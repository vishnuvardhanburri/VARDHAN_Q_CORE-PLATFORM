use serde::{Deserialize, Serialize};
use vardhan_state::id::{ContentHash, EvidenceId, StateHash};
use crate::identity::{ExecutionPlanId, ReplayCapsuleId, VerificationRunRecordId};
use vardhan_state::authorization::ProvenanceTrail;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ReplayResultClassification {
    ExactMatch,
    DeterminismFailure,
    InfrastructureFailure,
    Timeout,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReplayCapsule {
    pub capsule_id: ReplayCapsuleId,
    pub original_run_ref: VerificationRunRecordId,
    pub seed: u64,
    pub env_fingerprint: String,
    pub config_hash: ContentHash,
    pub state_hash: StateHash,
    pub execution_plan_ref: ExecutionPlanId,
    pub required_artifacts: Vec<String>,
    pub evidence_refs: Vec<EvidenceId>,
    pub provenance: ProvenanceTrail,
}
