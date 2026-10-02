use serde::{Deserialize, Serialize};


use crate::id::{
    ActionId, AuthorizationId, ConfigurationHash, DecisionId, EntityId, EvidenceId,
    FaultScenarioId, VerificationClaimId,
};
use crate::time::TimeContext;
use crate::scope::{TenantScoped, Hashable, canonical_json};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProvenanceTrail {
    pub generator_model: String,
    pub generation_timestamp: u64,
    pub context_hash: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ActionType {
    #[serde(rename = "READ")]    Read,
    #[serde(rename = "MODIFY")]  Modify,
    #[serde(rename = "CREATE")]  Create,
    #[serde(rename = "DELETE")]  Delete,
    #[serde(rename = "EXECUTE")] Execute,
    #[serde(rename = "SYSTEMIC_FAULT_INJECTION")] SystemicFaultInjection,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum RiskLevel {
    #[serde(rename = "LOW")]      Low,
    #[serde(rename = "MEDIUM")]   Medium,
    #[serde(rename = "HIGH")]     High,
    #[serde(rename = "CRITICAL")] Critical,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum AuthLevel {
    #[serde(rename = "STANDARD")] Standard,
    #[serde(rename = "ELEVATED")] Elevated,
    #[serde(rename = "SYSTEMIC")] Systemic,
}

pub type Authorization = TenantScoped<AuthorizationInner>;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum AuthorizationInner {
    Business(HistoricalBusinessAuthorization),
    SystemicVerification(ProofMeshSystemicAuthorization),
}

impl Hashable for AuthorizationInner {
    fn canonical_bytes(&self) -> Vec<u8> {
        canonical_json(self)
    }
}

/// Preserves the EXACT frozen fields. No dummy data. No Optional masking.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HistoricalBusinessAuthorization {
    pub auth_id: AuthorizationId,
    pub decision_id: DecisionId,
    pub action_id: ActionId,
    pub policy_eval_ref: EvidenceId,
    pub assurance_ref: EvidenceId,
    pub risk_level: RiskLevel,
    pub auth_level: AuthLevel,
    pub authorized_by: EntityId,
    pub authorized_at: TimeContext,
    pub config_hash: ConfigurationHash,
    pub evidence_refs: Vec<EvidenceId>,
    pub provenance: ProvenanceTrail,
}

/// Dedicated schema for SystemicVerification.
/// Only contains legitimate semantic references.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProofMeshSystemicAuthorization {
    pub auth_id: AuthorizationId,
    pub action_id: ActionId,
    pub action_type: ActionType, // Must be SystemicFaultInjection
    pub verification_claim_ref: VerificationClaimId,
    pub fault_scenario_ref: FaultScenarioId,
    pub policy_eval_ref: EvidenceId,
    pub authorized_by: EntityId,
    pub authorized_at: TimeContext,
    pub config_hash: ConfigurationHash,
    pub evidence_refs: Vec<EvidenceId>,
    pub provenance: ProvenanceTrail,
}

use crate::id::{ContentHash, StateHash, TenantId, PolicyId};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum PolicyStatus {
    #[serde(rename = "PASS")] Pass,
    #[serde(rename = "FAIL")] Fail,
    #[serde(rename = "INDETERMINATE")] Indeterminate,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PolicyEvaluation {
    pub policy_id: PolicyId,
    pub policy_version: String,
    pub policy_hash: ContentHash,
    pub configuration_hash: ConfigurationHash,
    pub state_hash: StateHash,
    pub evaluation_subject: String,
    pub constraints_evaluated: Vec<String>,
    pub matched_rule_ids: Vec<String>,
    pub proof_ref: Option<EvidenceId>,
    pub evidence_ref: Option<EvidenceId>,
    pub tenant_id: TenantId,
    pub status: PolicyStatus,
    pub provenance: ProvenanceTrail,
}
