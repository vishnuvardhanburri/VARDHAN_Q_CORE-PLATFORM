use serde::{Deserialize, Serialize};
use crate::identity::FaultScenarioId;
use vardhan_state::authorization::ProvenanceTrail;
use vardhan_state::id::EvidenceId;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum FaultMode {
    NetworkPartition,
    ProcessCrash,
    LatencyInjection,
    StateCorruption,
    ByzantineBehavior,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FaultScenario {
    pub scenario_id: FaultScenarioId,
    pub scope: String,
    pub target: String,
    pub mode: FaultMode,
    pub activation_condition: String,
    pub duration_ms: u64,
    pub rollback_condition: String,
    pub policy_ref: String,
    pub authorization_ref: String,
    pub expected_evidence: Vec<String>,
    pub provenance: ProvenanceTrail,
}
