use serde::{Deserialize, Serialize};
use vardhan_state::id::{ContentHash, EvidenceId, ExecutionId, StateHash};
use crate::identity::{
    EvidenceQuorumSnapshotId, PolicyEvaluationId, VerificationClaimId, VerificationFindingId,
};
use vardhan_state::authorization::ProvenanceTrail;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum FindingStatus {
    Pass,
    Fail,
    Indeterminate,
    Timeout,
    NotApplicable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VerificationFinding {
    pub finding_id: VerificationFindingId,
    pub claim_ref: VerificationClaimId,
    pub quorum_snapshot_ref: EvidenceQuorumSnapshotId,
    pub relevant_evidence: Vec<EvidenceId>,
    pub execution_records: Vec<ExecutionId>,
    pub policy_evaluation: PolicyEvaluationId,
    pub config_hash: ContentHash,
    pub state_hash: StateHash,
    pub status: FindingStatus,
    pub provenance: ProvenanceTrail,
}
