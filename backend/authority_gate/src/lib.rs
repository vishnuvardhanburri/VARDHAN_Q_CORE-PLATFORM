use serde::{Deserialize, Serialize};
use tracing::{error, info};
use uuid::Uuid;
use vardhan_state::authorization::{
    ActionType, Authorization, AuthorizationInner, PolicyEvaluation, PolicyStatus,
};
use vardhan_state::id::{ActionId, AuthorizationId, ConfigurationHash, StateHash};
use vardhan_state::scope::CanonicalTenantId;
use vardhan_state::time::now_utc;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ActionStatus {
    Pass,
    Fail,
    Indeterminate,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthorizationEvidence {
    pub authorization_id: AuthorizationId,
    pub final_status: ActionStatus,
    pub assumed_config_hash: ConfigurationHash,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionReceipt {
    pub receipt_id: String,
    pub action_id: ActionId,
    pub timestamp_ms: u64,
    pub authorized_by: String,
}

pub trait AuthorityGate {
    fn validate_and_execute(
        &self,
        action_id: &ActionId,
        evidence: &AuthorizationEvidence,
        current_config_hash: &ConfigurationHash,
    ) -> Result<ExecutionReceipt, String>;
}

pub struct VardhanGate;

impl AuthorityGate for VardhanGate {
    fn validate_and_execute(
        &self,
        action_id: &ActionId,
        evidence: &AuthorizationEvidence,
        current_config_hash: &ConfigurationHash,
    ) -> Result<ExecutionReceipt, String> {
        info!("AuthorityGate evaluating action {:?}", action_id);

        if evidence.final_status != ActionStatus::Pass {
            return Err("Assurance failed".into());
        }
        if &evidence.assumed_config_hash != current_config_hash {
            return Err("Configuration mismatch".into());
        }

        Ok(ExecutionReceipt {
            receipt_id: format!("receipt-{}", Uuid::new_v4()),
            action_id: *action_id,
            timestamp_ms: now_utc().timestamp_millis() as u64,
            authorized_by: "VardhanGate".to_string(),
        })
    }
}

pub trait SystemicAuthorityGate {
    fn authorize_systemic_fault(
        &self,
        tenant_id: CanonicalTenantId,
        authorization: &Authorization,
        policy_eval: &PolicyEvaluation,
        current_config_hash: &ConfigurationHash,
        current_state_hash: &StateHash,
    ) -> Result<ExecutionReceipt, String>;
}

impl SystemicAuthorityGate for VardhanGate {
    fn authorize_systemic_fault(
        &self,
        tenant_id: CanonicalTenantId,
        authorization: &Authorization,
        policy_eval: &PolicyEvaluation,
        current_config_hash: &ConfigurationHash,
        current_state_hash: &StateHash,
    ) -> Result<ExecutionReceipt, String> {
        // 1. Tenant boundary enforcement
        if authorization.tenant_id() != tenant_id.0 {
            return Err("Tenant boundary violation".to_string());
        }
        if policy_eval.tenant_id != tenant_id.0 {
            return Err("Policy tenant violation".to_string());
        }

        let systemic_auth = match authorization.inner() {
            AuthorizationInner::SystemicVerification(s) => s,
            AuthorizationInner::Business(_) => {
                return Err("Business authorization cannot be used for systemic faults".to_string());
            }
        };

        info!(
            "VardhanGate evaluating Systemic Fault Authorization: {:?}",
            systemic_auth.auth_id
        );

        // 2. Action Type validation
        if systemic_auth.action_type != ActionType::SystemicFaultInjection {
            return Err("Invalid action type".to_string());
        }

        // 3. Authorization Context & Idempotency / Claim / Scenario validation
        if systemic_auth.verification_claim_ref.0.is_nil()
            || systemic_auth.fault_scenario_ref.0.is_nil()
        {
            return Err("Missing claim or scenario references".to_string());
        }

        // 4. Policy Evaluation enforcement
        if policy_eval.status != PolicyStatus::Pass {
            return Err(format!(
                "Policy evaluation did not pass (status: {:?})",
                policy_eval.status
            ));
        }

        // 5. Configuration & State alignment
        if &systemic_auth.config_hash != current_config_hash {
            return Err("Authorization Config mismatch".to_string());
        }
        if &policy_eval.configuration_hash != current_config_hash {
            return Err("Policy Config mismatch".to_string());
        }
        if &policy_eval.state_hash != current_state_hash {
            return Err("State hash mismatch (state mutated since evaluation)".to_string());
        }

        // 6. Expiry / Time validation
        let now_dt = now_utc();
        let now = now_dt.timestamp_millis() as u64;
        if let Some(deadline) = systemic_auth.authorized_at.deadline_time {
            if now_dt > deadline {
                return Err("Authorization expired".to_string());
            }
        }

        // 7. Provenance completeness
        if systemic_auth.provenance.generator_model.is_empty() {
            return Err("Authorization lacks provenance generator".to_string());
        }

        // Success
        Ok(ExecutionReceipt {
            receipt_id: format!("sys-receipt-{}", systemic_auth.auth_id),
            action_id: systemic_auth.action_id,
            timestamp_ms: now,
            authorized_by: "VardhanGate-Systemic".to_string(),
        })
    }
}
