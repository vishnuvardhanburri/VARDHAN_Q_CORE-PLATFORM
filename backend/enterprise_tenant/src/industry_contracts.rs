use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;
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

#[derive(Debug, Error, PartialEq, Eq)]
pub enum IndustryContractError {
    #[error("invalid industry contract JSON for {industry}: {message}")]
    InvalidJson { industry: String, message: String },
    #[error("industry contract validation failed for {industry}: {message}")]
    InvalidContract { industry: String, message: String },
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
        if factors.len() != self.risk.factors.len() || self.risk.weights.len() != factors.len()
            || !self.risk.weights.keys().all(|k| factors.contains(k.as_str()))
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
        if !REQUIRED_QCORE_SERVICES.iter().all(|required| services.contains(required)) {
            return Err(IndustryContractError::InvalidContract {
                industry: self.industry.clone(),
                message: "qcore_services is missing a required trust-plane service".into(),
            });
        }
        Ok(())
    }
}

fn load_contract(industry: &'static str, source: &'static str) -> Result<IndustryPlaneContract, IndustryContractError> {
    let contract: IndustryPlaneContract = serde_json::from_str(source).map_err(|error| IndustryContractError::InvalidJson {
        industry: industry.into(),
        message: error.to_string(),
    })?;
    contract.validate()?;
    Ok(contract)
}

static REGISTRY: OnceLock<Result<Vec<IndustryPlaneContract>, IndustryContractError>> = OnceLock::new();

pub fn industry_plane_contracts() -> Result<&'static [IndustryPlaneContract], IndustryContractError> {
    REGISTRY
        .get_or_init(|| {
            let sources = [
                ("banking", include_str!("../../../industries/banking/plane.json")),
                ("healthcare", include_str!("../../../industries/healthcare/plane.json")),
                ("government", include_str!("../../../industries/government/plane.json")),
                ("telecom", include_str!("../../../industries/telecom/plane.json")),
                ("energy", include_str!("../../../industries/energy/plane.json")),
                ("insurance", include_str!("../../../industries/insurance/plane.json")),
                ("education", include_str!("../../../industries/education/plane.json")),
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

pub fn industry_plane_contract(industry: &str) -> Result<Option<&'static IndustryPlaneContract>, IndustryContractError> {
    Ok(industry_plane_contracts()?.iter().find(|contract| contract.industry == industry))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_phase_two_industry_contracts_are_runtime_loaded_and_validated() {
        let contracts = industry_plane_contracts().expect("industry contracts must load");
        assert_eq!(contracts.len(), EXPECTED_INDUSTRIES.len());
        for industry in EXPECTED_INDUSTRIES {
            let contract = industry_plane_contract(industry).unwrap().expect("contract must exist");
            assert_eq!(contract.industry, industry);
            assert_eq!(contract.schema_version, 1);
            assert!(contract.qcore_services.contains(&"signed_receipt".into()));
        }
    }

    #[test]
    fn registry_rejects_missing_required_qcore_service() {
        let mut contract: IndustryPlaneContract = serde_json::from_str(include_str!("../../../industries/banking/plane.json")).unwrap();
        contract.qcore_services.retain(|service| service != "signed_receipt");
        let error = contract.validate().unwrap_err();
        assert!(error.to_string().contains("qcore_services"));
    }

    #[test]
    fn registry_rejects_unweighted_risk_factor() {
        let mut contract: IndustryPlaneContract = serde_json::from_str(include_str!("../../../industries/banking/plane.json")).unwrap();
        contract.risk.weights.remove("recovery_cost");
        let error = contract.validate().unwrap_err();
        assert!(error.to_string().contains("risk factors and weights"));
    }
}
