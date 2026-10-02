use serde::{Deserialize, Serialize};
use vardhan_state::id::{CommitIndex, ContentHash, EvidenceId, StateHash};
use vardhan_state::time::TimeContext;
use crate::identity::{
    ExecutionPlanId, FaultScenarioId, ReplayCapsuleId, VerificationClaimId, VerificationRunRecordId,
};
use crate::execution_plan::ExecutionPool;
use vardhan_state::authorization::ProvenanceTrail;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum RunOutcome {
    Success,
    Failure,
    Error,
    Timeout,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum RunCause {
    AssertionFailed,
    EnvironmentError,
    ResourceExhausted,
    TargetUnreachable,
    CompletedNormally,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum RunConfidence {
    High,
    Medium,
    Low,
    Flaky,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VerificationRunRecord {
    pub run_id: VerificationRunRecordId,
    pub claim_ref: VerificationClaimId,
    pub plan_ref: ExecutionPlanId,
    pub pool: ExecutionPool,
    pub started_at: TimeContext,
    pub ended_at: TimeContext,
    pub config_hash: ContentHash,
    pub state_hash: StateHash,
    pub env_fingerprint: String,
    pub seed: u64,
    pub exit_status: i32,
    pub outcome: RunOutcome,
    pub cause: RunCause,
    pub confidence: RunConfidence,
    pub evidence_ref: Option<EvidenceId>,
    pub replay_capsule_ref: Option<ReplayCapsuleId>,
    pub fault_scenario_ref: Option<FaultScenarioId>,
    pub commit_index: Option<CommitIndex>,
    pub provenance: ProvenanceTrail,
}
