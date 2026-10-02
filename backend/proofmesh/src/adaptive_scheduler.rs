use serde::{Deserialize, Serialize};
use vardhan_state::id::{ContentHash, StateHash};
use crate::identity::VerificationClaimId;
use crate::execution_plan::ExecutionPool;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ScheduleReason {
    Normal,
    Anomaly,
    FaultInjection,
    Trace,
    Replay,
    Minimization,
    Regression,
    DeepVerification,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SchedulingDecision {
    pub claim_id: VerificationClaimId,
    pub scheduler_policy_version: String,
    pub config_hash: ContentHash,
    pub state_hash: StateHash,
    pub previous_evidence_summary: String,
    pub selected_pool: ExecutionPool,
    pub reason: ScheduleReason,
    pub priority: u32,
    pub timeout_ms: u64,
    pub resource_budget_bytes: u64,
    pub seed: Option<u64>,
}
