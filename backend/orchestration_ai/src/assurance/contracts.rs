use super::types::*;
use serde::{Deserialize, Serialize};
use vardhan_state::authorization::ProvenanceTrail;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SecurityIntent {
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ExecutionConstraint {
    pub constraint_type: String,
    pub strict: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EffectDescriptor {
    pub expected_outcome: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SecurityIR {
    pub schema_version: u16,
    pub tenant_scope: TenantId,
    pub assumed_system_state_hash: StateHash,

    // Intent & Action
    pub intent: SecurityIntent,
    pub target_component: ComponentId,
    pub action_primitive: ActionId,
    pub parameters: PrimitiveParameters,

    // Guardrails
    pub constraints: Vec<ExecutionConstraint>,
    pub expected_effect: EffectDescriptor,
    pub reversibility: ReversibilityModel,
    pub blast_radius: BlastRadiusDescriptor,

    // Traceability
    pub provenance: ProvenanceTrail,
    pub integrity_signature: Signature,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AssuranceStatus {
    Pass,
    Fail,
    Reject,
    Indeterminate,
    Timeout,
    NotApplicable,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GateResults {
    pub g0_status: AssuranceStatus,
    pub g1_status: AssuranceStatus,
    pub g2_status: AssuranceStatus,
    pub g3_status: AssuranceStatus,
    pub g4_status: AssuranceStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AssuranceResult {
    pub assurance_result_id: String,
    pub candidate_id: String,
    pub final_status: AssuranceStatus,
    pub gates: GateResults,
    pub proof_ref: Option<String>,
    pub policy_evaluation_id: Option<String>,
    pub provenance: ProvenanceTrail,
}
