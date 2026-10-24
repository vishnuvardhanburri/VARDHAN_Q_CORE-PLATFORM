use core_crypto::QuantumNodeIdentity;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use thiserror::Error;
use tokio::sync::RwLock;

mod platform;
pub use platform::*;
mod rbac_scim;
pub use rbac_scim::*;
mod industry_contracts;
pub use industry_contracts::*;

#[derive(Error, Debug)]
pub enum TenantError {
    #[error("Tenant ID '{0}' not found")]
    TenantNotFound(String),
    #[error("Tenant '{0}' exceeds allocated throughput limit")]
    RateLimitExceeded(String),
    #[error("Failed to initialize cryptographic key vault for tenant")]
    KeyInitializationFailed,
    #[error("Tenant '{tenant_id}' has invalid industry configuration: {message}")]
    InvalidIndustry { tenant_id: String, message: String },
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct TenantConfig {
    pub tenant_id: String,
    pub company_name: String,
    pub max_requests_per_sec: u64,
    pub sla_tier: String,
    /// Phase-2 industry selection is mandatory at registration and is bound to
    /// the tenant's authoritative runtime configuration.
    pub industry: String,
}

pub struct TenantSession {
    pub config: TenantConfig,
    pub identity: Arc<QuantumNodeIdentity>,
    pub industry_runtime: IndustryRuntimeBinding,
}

pub struct TenantManager {
    tenants: RwLock<HashMap<String, TenantSession>>,
}

impl Default for TenantManager {
    fn default() -> Self {
        Self::new()
    }
}

impl TenantManager {
    pub fn new() -> Self {
        Self {
            tenants: RwLock::new(HashMap::new()),
        }
    }

    pub async fn register_tenant(&self, config: TenantConfig) -> Result<(), TenantError> {
        let contract = industry_plane_contract(&config.industry)
            .map_err(|error| TenantError::InvalidIndustry {
                tenant_id: config.tenant_id.clone(),
                message: error.to_string(),
            })?
            .ok_or_else(|| TenantError::InvalidIndustry {
                tenant_id: config.tenant_id.clone(),
                message: "unsupported industry".into(),
            })?;
        let identity = QuantumNodeIdentity::generate_node_identity()
            .map_err(|_| TenantError::KeyInitializationFailed)?;
        let industry_runtime = IndustryRuntimeBinding {
            tenant_id: config.tenant_id.clone(),
            industry: contract.industry.clone(),
            required_controls: contract.controls.clone(),
            allowed_policies: contract.policies.clone(),
            allowed_deployment_modes: contract.deployment.modes.clone(),
            requires_hsm_for_private_keys: contract.deployment.requires_hsm_for_private_keys,
            compliance_requirements: contract.compliance.clone(),
        };
        let session = TenantSession {
            config: config.clone(),
            identity: Arc::new(identity),
            industry_runtime,
        };
        self.tenants
            .write()
            .await
            .insert(config.tenant_id.clone(), session);
        Ok(())
    }

    pub async fn get_tenant_session(&self, tenant_id: &str) -> Result<TenantSession, TenantError> {
        let lock = self.tenants.read().await;
        let session = lock
            .get(tenant_id)
            .ok_or_else(|| TenantError::TenantNotFound(tenant_id.to_string()))?;
        Ok(TenantSession {
            config: session.config.clone(),
            identity: session.identity.clone(),
            industry_runtime: session.industry_runtime.clone(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn tenant_manager_registers_and_retrieves_tenant() {
        let manager = TenantManager::new();
        manager
            .register_tenant(TenantConfig {
                tenant_id: "t1".into(),
                company_name: "Test".into(),
                max_requests_per_sec: 100,
                sla_tier: "ENTERPRISE_MASTER".into(),
                industry: "banking".into(),
            })
            .await
            .unwrap();
        let session = manager.get_tenant_session("t1").await.unwrap();
        assert_eq!(session.config.company_name, "Test");
        assert_eq!(session.industry_runtime.industry, "banking");
    }

    #[tokio::test]
    async fn tenant_manager_rejects_unregistered_industry() {
        let manager = TenantManager::new();
        let result = manager
            .register_tenant(TenantConfig {
                tenant_id: "t1".into(),
                company_name: "Test".into(),
                max_requests_per_sec: 100,
                sla_tier: "ENTERPRISE_MASTER".into(),
                industry: "untrusted".into(),
            })
            .await;
        assert!(matches!(result, Err(TenantError::InvalidIndustry { .. })));
    }
}

#[cfg(test)]
mod platform_tests;
