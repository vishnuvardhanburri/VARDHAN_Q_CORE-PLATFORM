use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use thiserror::Error;

const EXPECTED_INDUSTRIES: [&str; 7] = [
    "banking",
    "healthcare",
    "government",
    "telecom",
    "energy",
    "insurance",
    "education",
];

const REQUIRED_QCORE_SERVICES: [&str; 8] = [
    "trust_boundary",
    "authority_policy",
    "transaction_state",
    "signed_receipt",
    "audit_ledger",
    "independent_verification",
    "pq_crypto",
    "aer_kep_q",
];

#[derive(Debug, Clone, Error, PartialEq, Eq)]
pub enum IndustryContractError {
    #[error("invalid industry contract JSON for {industry}: {message}")]
    InvalidJson { industry: String, message: String },
    #[error("industry contract validation failed for {industry}: {message}")]
    InvalidContract { industry: String, message: String },
    #[error("tenant {tenant_id} is not bound to an industry contract")]
    TenantNotBound { tenant_id: String },
    #[error("tenant {tenant_id} is already bound to industry {industry}")]
    TenantAlreadyBound { tenant_id: String, industry: String },
}

#[derive(Debug, Clone, Deserialize)]
pub struct IndustryRiskProfile {
    pub factors: Vec<String>,
    pub weights: HashMap<String, u8>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct IndustryDeploymentProfile {
    pub modes: Vec<String>,
    pub requires_hsm_for_private_keys: bool,
    pub telemetry: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct IndustryPlaneContract {
    pub schema_version: u32,
    pub industry: String,
    pub name: String,
    pub compliance: Vec<String>,
    pub assets: Vec<String>,
    pub threats: Vec<String>,
    pub risk: IndustryRiskProfile,
    pub policies: Vec<String>,
    pub workflows: Vec<String>,
    pub controls: Vec<String>,
    pub integrations: Vec<String>,
    pub deployment: IndustryDeploymentProfile,
    pub qcore_services: Vec<String>,
}

impl IndustryPlaneContract {
    pub fn validate(&self) -> Result<(), IndustryContractError> {
        let industry = self.industry.clone();
        if self.schema_version != 1 {
            return Err(IndustryContractError::InvalidContract {
                industry,
                message: format!("unsupported schema_version {}", self.schema_version),
            });
        }
        if !EXPECTED_INDUSTRIES.contains(&self.industry.as_str()) {
            return Err(IndustryContractError::InvalidContract {
                industry: self.industry.clone(),
                message: "industry is outside the supported Phase 2 set".into(),
            });
        }
        for (name, values) in [
            ("compliance", &self.compliance),
            ("assets", &self.assets),
            ("threats", &self.threats),
            ("factors", &self.risk.factors),
            ("policies", &self.policies),
            ("workflows", &self.workflows),
            ("controls", &self.controls),
            ("integrations", &self.integrations),
            ("deployment.modes", &self.deployment.modes),
            ("qcore_services", &self.qcore_services),
        ] {
            if values.is_empty() || values.iter().any(|v| v.trim().is_empty()) {
                return Err(IndustryContractError::InvalidContract {
                    industry: self.industry.clone(),
                    message: format!("{name} must contain non-empty values"),
                });
            }
        }
        let factors: HashSet<&str> = self.risk.factors.iter().map(String::as_str).collect();
        if factors.len() != self.risk.factors.len()
            || self.risk.weights.len() != factors.len()
            || !self
                .risk
                .weights
                .keys()
                .all(|k| factors.contains(k.as_str()))
            || self.risk.weights.values().any(|weight| *weight == 0)
        {
            return Err(IndustryContractError::InvalidContract {
                industry: self.industry.clone(),
                message: "risk factors and weights must be a one-to-one, positive mapping".into(),
            });
        }
        if !self.deployment.requires_hsm_for_private_keys {
            return Err(IndustryContractError::InvalidContract {
                industry: self.industry.clone(),
                message: "private-key deployment must require HSM protection".into(),
            });
        }
        if self.deployment.telemetry != "tenant_bound_qcore" {
            return Err(IndustryContractError::InvalidContract {
                industry: self.industry.clone(),
                message: "telemetry must be tenant_bound_qcore".into(),
            });
        }
        let services: HashSet<&str> = self.qcore_services.iter().map(String::as_str).collect();
        if !REQUIRED_QCORE_SERVICES
            .iter()
            .all(|required| services.contains(required))
        {
            return Err(IndustryContractError::InvalidContract {
                industry: self.industry.clone(),
                message: "qcore_services is missing a required trust-plane service".into(),
            });
        }
        Ok(())
    }
}

fn load_contract(
    industry: &'static str,
    source: &'static str,
) -> Result<IndustryPlaneContract, IndustryContractError> {
    let contract: IndustryPlaneContract =
        serde_json::from_str(source).map_err(|error| IndustryContractError::InvalidJson {
            industry: industry.into(),
            message: error.to_string(),
        })?;
    contract.validate()?;
    Ok(contract)
}

static REGISTRY: OnceLock<Result<Vec<IndustryPlaneContract>, IndustryContractError>> =
    OnceLock::new();

pub fn industry_plane_contracts() -> Result<&'static [IndustryPlaneContract], IndustryContractError>
{
    REGISTRY
        .get_or_init(|| {
            let sources = [
                (
                    "banking",
                    include_str!("../../../industries/banking/plane.json"),
                ),
                (
                    "healthcare",
                    include_str!("../../../industries/healthcare/plane.json"),
                ),
                (
                    "government",
                    include_str!("../../../industries/government/plane.json"),
                ),
                (
                    "telecom",
                    include_str!("../../../industries/telecom/plane.json"),
                ),
                (
                    "energy",
                    include_str!("../../../industries/energy/plane.json"),
                ),
                (
                    "insurance",
                    include_str!("../../../industries/insurance/plane.json"),
                ),
                (
                    "education",
                    include_str!("../../../industries/education/plane.json"),
                ),
            ];
            let mut contracts = Vec::with_capacity(sources.len());
            for (industry, source) in sources {
                let contract = load_contract(industry, source)?;
                if contract.industry != industry {
                    return Err(IndustryContractError::InvalidContract {
                        industry: industry.into(),
                        message: format!("contract identity is {}", contract.industry),
                    });
                }
                contracts.push(contract);
            }
            let identities: HashSet<&str> = contracts.iter().map(|c| c.industry.as_str()).collect();
            if identities.len() != EXPECTED_INDUSTRIES.len() {
                return Err(IndustryContractError::InvalidContract {
                    industry: "registry".into(),
                    message: "industry identities are not unique".into(),
                });
            }
            Ok(contracts)
        })
        .as_ref()
        .map(Vec::as_slice)
        .map_err(Clone::clone)
}

pub fn industry_plane_contract(
    industry: &str,
) -> Result<Option<&'static IndustryPlaneContract>, IndustryContractError> {
    Ok(industry_plane_contracts()?
        .iter()
        .find(|contract| contract.industry == industry))
}

/// The runtime representation of an industry plane.  This is deliberately derived
/// from the validated JSON contract rather than duplicating industry policy in
/// handlers, so a plane cannot become documentation that disagrees with runtime.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct IndustryRuntimeBinding {
    pub tenant_id: String,
    pub industry: String,
    pub required_controls: Vec<String>,
    pub allowed_policies: Vec<String>,
    pub allowed_deployment_modes: Vec<String>,
    pub requires_hsm_for_private_keys: bool,
    pub compliance_requirements: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct IndustryDecisionRequest {
    pub tenant_id: String,
    pub policy: String,
    pub deployment_mode: String,
    pub hsm_backed_private_keys: bool,
    /// The tenant identity carried by the telemetry/evidence pipeline.
    pub telemetry_tenant_id: String,
    pub active_controls: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct IndustryDecisionEvidence {
    pub tenant_id: String,
    pub industry: String,
    pub policy: String,
    pub allowed: bool,
    pub reasons: Vec<String>,
    pub compliance_requirements: Vec<String>,
    pub risk_weight_total: u32,
    pub recorded_at_unix_secs: u64,
}

/// Authoritative runtime policy evaluator for Phase 2 planes.  Bindings are
/// tenant-specific and every decision produces an in-memory evidence record that
/// callers can persist through the audit ledger.
#[derive(Default)]
pub struct IndustryRuntime {
    bindings: Mutex<HashMap<String, IndustryRuntimeBinding>>,
    evidence: Mutex<Vec<IndustryDecisionEvidence>>,
}

impl IndustryRuntime {
    pub fn bind_tenant(
        &self,
        tenant_id: impl Into<String>,
        industry: &str,
    ) -> Result<IndustryRuntimeBinding, IndustryContractError> {
        let tenant_id = tenant_id.into();
        let contract = industry_plane_contract(industry)?.ok_or_else(|| {
            IndustryContractError::InvalidContract {
                industry: industry.into(),
                message: "no registered industry contract".into(),
            }
        })?;
        let binding = IndustryRuntimeBinding {
            tenant_id: tenant_id.clone(),
            industry: contract.industry.clone(),
            required_controls: contract.controls.clone(),
            allowed_policies: contract.policies.clone(),
            allowed_deployment_modes: contract.deployment.modes.clone(),
            requires_hsm_for_private_keys: contract.deployment.requires_hsm_for_private_keys,
            compliance_requirements: contract.compliance.clone(),
        };
        let mut bindings = self
            .bindings
            .lock()
            .expect("industry bindings mutex poisoned");
        if let Some(existing) = bindings.get(&tenant_id) {
            return Err(IndustryContractError::TenantAlreadyBound {
                tenant_id,
                industry: existing.industry.clone(),
            });
        }
        bindings.insert(binding.tenant_id.clone(), binding.clone());
        Ok(binding)
    }

    pub fn evaluate(
        &self,
        request: &IndustryDecisionRequest,
    ) -> Result<IndustryDecisionEvidence, IndustryContractError> {
        let binding = self
            .bindings
            .lock()
            .expect("industry bindings mutex poisoned")
            .get(&request.tenant_id)
            .cloned()
            .ok_or_else(|| IndustryContractError::TenantNotBound {
                tenant_id: request.tenant_id.clone(),
            })?;
        let contract =
            industry_plane_contract(&binding.industry)?.expect("bound contract remains registered");
        let active: HashSet<&str> = request.active_controls.iter().map(String::as_str).collect();
        let mut reasons = Vec::new();
        if request.telemetry_tenant_id != request.tenant_id {
            reasons.push("telemetry tenant binding does not match decision tenant".into());
        }
        if !binding
            .allowed_policies
            .iter()
            .any(|policy| policy == &request.policy)
        {
            reasons.push(format!(
                "policy {} is not authorized for {}",
                request.policy, binding.industry
            ));
        }
        if !binding
            .allowed_deployment_modes
            .iter()
            .any(|mode| mode == &request.deployment_mode)
        {
            reasons.push(format!(
                "deployment mode {} is not authorized",
                request.deployment_mode
            ));
        }
        if binding.requires_hsm_for_private_keys && !request.hsm_backed_private_keys {
            reasons.push("HSM-backed private keys are required".into());
        }
        let missing_controls: Vec<_> = binding
            .required_controls
            .iter()
            .filter(|control| !active.contains(control.as_str()))
            .cloned()
            .collect();
        if !missing_controls.is_empty() {
            reasons.push(format!(
                "missing required controls: {}",
                missing_controls.join(",")
            ));
        }
        let evidence = IndustryDecisionEvidence {
            tenant_id: request.tenant_id.clone(),
            industry: binding.industry,
            policy: request.policy.clone(),
            allowed: reasons.is_empty(),
            reasons,
            compliance_requirements: binding.compliance_requirements,
            risk_weight_total: contract
                .risk
                .weights
                .values()
                .map(|weight| u32::from(*weight))
                .sum(),
            recorded_at_unix_secs: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
        };
        self.evidence
            .lock()
            .expect("industry evidence mutex poisoned")
            .push(evidence.clone());
        Ok(evidence)
    }

    pub fn evidence_for_tenant(&self, tenant_id: &str) -> Vec<IndustryDecisionEvidence> {
        self.evidence
            .lock()
            .expect("industry evidence mutex poisoned")
            .iter()
            .filter(|evidence| evidence.tenant_id == tenant_id)
            .cloned()
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_phase_two_industry_contracts_are_runtime_loaded_and_validated() {
        let contracts = industry_plane_contracts().expect("industry contracts must load");
        assert_eq!(contracts.len(), EXPECTED_INDUSTRIES.len());
        for industry in EXPECTED_INDUSTRIES {
            let contract = industry_plane_contract(industry)
                .unwrap()
                .expect("contract must exist");
            assert_eq!(contract.industry, industry);
            assert_eq!(contract.schema_version, 1);
            assert!(contract.qcore_services.contains(&"signed_receipt".into()));
        }
    }

    #[test]
    fn registry_rejects_missing_required_qcore_service() {
        let mut contract: IndustryPlaneContract =
            serde_json::from_str(include_str!("../../../industries/banking/plane.json")).unwrap();
        contract
            .qcore_services
            .retain(|service| service != "signed_receipt");
        let error = contract.validate().unwrap_err();
        assert!(error.to_string().contains("qcore_services"));
    }

    #[test]
    fn registry_rejects_unweighted_risk_factor() {
        let mut contract: IndustryPlaneContract =
            serde_json::from_str(include_str!("../../../industries/banking/plane.json")).unwrap();
        contract.risk.weights.remove("recovery_cost");
        let error = contract.validate().unwrap_err();
        assert!(error.to_string().contains("risk factors and weights"));
    }

    #[test]
    fn every_industry_contract_drives_a_tenant_bound_runtime_decision() {
        let runtime = IndustryRuntime::default();
        for industry in EXPECTED_INDUSTRIES {
            let tenant_id = format!("{industry}-tenant");
            let binding = runtime.bind_tenant(&tenant_id, industry).unwrap();
            let allowed = runtime
                .evaluate(&IndustryDecisionRequest {
                    tenant_id: tenant_id.clone(),
                    policy: binding.allowed_policies[0].clone(),
                    deployment_mode: binding.allowed_deployment_modes[0].clone(),
                    hsm_backed_private_keys: true,
                    telemetry_tenant_id: tenant_id.clone(),
                    active_controls: binding.required_controls.clone(),
                })
                .unwrap();
            assert!(
                allowed.allowed,
                "{industry} should allow a compliant decision"
            );
            assert_eq!(allowed.industry, industry);
            assert!(!allowed.compliance_requirements.is_empty());
            assert!(allowed.risk_weight_total > 0);

            let denied = runtime
                .evaluate(&IndustryDecisionRequest {
                    tenant_id: tenant_id.clone(),
                    policy: binding.allowed_policies[0].clone(),
                    deployment_mode: binding.allowed_deployment_modes[0].clone(),
                    hsm_backed_private_keys: true,
                    telemetry_tenant_id: tenant_id.clone(),
                    active_controls: binding.required_controls[1..].to_vec(),
                })
                .unwrap();
            assert!(
                !denied.allowed,
                "{industry} must deny when its own required control is absent"
            );
            assert!(denied
                .reasons
                .iter()
                .any(|reason| reason.contains(&binding.required_controls[0])));
        }
    }

    #[test]
    fn industry_runtime_fails_closed_for_tenant_policy_hsm_and_telemetry_violations() {
        let runtime = IndustryRuntime::default();
        let binding = runtime.bind_tenant("bank-a", "banking").unwrap();
        let decision = runtime
            .evaluate(&IndustryDecisionRequest {
                tenant_id: "bank-a".into(),
                policy: "not-a-banking-policy".into(),
                deployment_mode: "not-a-deployment-mode".into(),
                hsm_backed_private_keys: false,
                telemetry_tenant_id: "bank-b".into(),
                active_controls: vec![],
            })
            .unwrap();
        assert!(!decision.allowed);
        assert!(decision
            .reasons
            .iter()
            .any(|reason| reason.contains("telemetry tenant")));
        assert!(decision
            .reasons
            .iter()
            .any(|reason| reason.contains("not authorized")));
        assert!(decision.reasons.iter().any(|reason| reason.contains("HSM")));
        assert!(decision
            .reasons
            .iter()
            .any(|reason| reason.contains(&binding.required_controls[0])));
        assert_eq!(runtime.evidence_for_tenant("bank-a").len(), 1);
        assert!(matches!(
            runtime.evaluate(&IndustryDecisionRequest {
                tenant_id: "unbound".into(),
                policy: "payment_integrity".into(),
                deployment_mode: "managed".into(),
                hsm_backed_private_keys: true,
                telemetry_tenant_id: "unbound".into(),
                active_controls: vec![],
            }),
            Err(IndustryContractError::TenantNotBound { .. })
        ));
    }
}
