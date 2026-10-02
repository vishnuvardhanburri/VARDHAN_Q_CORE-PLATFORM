use core_crypto::QuantumNodeIdentity;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use thiserror::Error;
use tokio::sync::RwLock;

#[derive(Error, Debug)]
pub enum TenantError {
    #[error("Tenant ID '{0}' not found")]
    TenantNotFound(String),
    #[error("Tenant '{0}' exceeds allocated throughput limit")]
    RateLimitExceeded(String),
    #[error("Failed to initialize cryptographic key vault for tenant")]
    KeyInitializationFailed,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct TenantConfig {
    pub tenant_id: String,
    pub company_name: String,
    pub max_requests_per_sec: u64,
    pub sla_tier: String, // "POC_PILOT", "ENTERPRISE_MASTER"
}

pub struct TenantSession {
    pub config: TenantConfig,
    pub identity: Arc<QuantumNodeIdentity>,
}

pub struct TenantManager {
    tenants: RwLock<HashMap<String, TenantSession>>,
}

impl TenantManager {
    pub fn new() -> Self {
        Self {
            tenants: RwLock::new(HashMap::new()),
        }
    }

    pub async fn register_tenant(&self, config: TenantConfig) -> Result<(), TenantError> {
        let identity = QuantumNodeIdentity::generate_node_identity()
            .map_err(|_| TenantError::KeyInitializationFailed)?;

        let session = TenantSession {
            config: config.clone(),
            identity: Arc::new(identity),
        };

        let mut lock = self.tenants.write().await;
        lock.insert(config.tenant_id.clone(), session);
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
        })
    }
}
