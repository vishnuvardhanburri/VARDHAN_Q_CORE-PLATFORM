use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::store::CredentialStore;

#[derive(Error, Debug)]
pub enum SettingsError {
    #[error("Validation error: {0}")]
    ValidationError(String),
    #[error("Cryptographic identity is immutable and cannot be modified via API")]
    ImmutableFieldModified,
    #[error("Database error: {0}")]
    DbError(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct UserSettings {
    pub theme: String,
    pub refresh_interval_secs: u32,
    pub alert_notifications: bool,
}

impl Default for UserSettings {
    fn default() -> Self {
        Self {
            theme: "cyber_midnight".to_string(),
            refresh_interval_secs: 5,
            alert_notifications: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct SystemOperationalSettings {
    pub log_level: String,
    pub max_connections: u32,
    pub request_timeout_secs: u32,
}

impl Default for SystemOperationalSettings {
    fn default() -> Self {
        Self {
            log_level: "info".to_string(),
            max_connections: 10_000,
            request_timeout_secs: 30,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct SecurityPolicySettings {
    pub require_pqc_handshake: bool,
    pub min_password_length: u32,
    pub session_idle_timeout_secs: u32,
    pub session_hard_timeout_secs: u32,
    pub max_failed_logins: u32,
}

impl Default for SecurityPolicySettings {
    fn default() -> Self {
        Self {
            require_pqc_handshake: true,
            min_password_length: 12,
            session_idle_timeout_secs: 1800,  // 30 min
            session_hard_timeout_secs: 28800, // 8 hours
            max_failed_logins: 10,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct ClusterSettings {
    pub region: String,
    pub heartbeat_interval_ms: u32,
    pub drain_timeout_secs: u32,
}

impl Default for ClusterSettings {
    fn default() -> Self {
        Self {
            region: "us-east-1".to_string(),
            heartbeat_interval_ms: 500,
            drain_timeout_secs: 30,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CryptoIdentitySettings {
    pub node_id: String,
    pub signer_pub_fingerprint: String,
    pub kem_algorithm: String,
    pub dsa_algorithm: String,
    pub immutable: bool,
}

impl CryptoIdentitySettings {
    pub fn new(node_id: &str, fingerprint: &str) -> Self {
        Self {
            node_id: node_id.to_string(),
            signer_pub_fingerprint: fingerprint.to_string(),
            kem_algorithm: "ML-KEM-1024".to_string(),
            dsa_algorithm: "ML-DSA-87".to_string(),
            immutable: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SettingsConfig {
    pub user_settings: UserSettings,
    pub system_settings: SystemOperationalSettings,
    pub security_policies: SecurityPolicySettings,
    pub cluster_configuration: ClusterSettings,
    pub cryptographic_identity: CryptoIdentitySettings,
}

#[derive(Debug, Deserialize)]
pub struct UpdateSettingsRequest {
    pub user_settings: Option<UserSettings>,
    pub system_settings: Option<SystemOperationalSettings>,
    pub security_policies: Option<SecurityPolicySettings>,
    pub cluster_configuration: Option<ClusterSettings>,
    pub cryptographic_identity: Option<serde_json::Value>,
}

const SETTINGS_KEY: &[u8] = b"settings:v1";

impl CredentialStore {
    pub fn get_settings(
        &self,
        node_id: &str,
        signer_fingerprint: &str,
    ) -> Result<SettingsConfig, SettingsError> {
        let raw = self
            .db
            .get(SETTINGS_KEY)
            .map_err(|e| SettingsError::DbError(e.to_string()))?;

        let mut config: SettingsConfig = match raw {
            Some(ivec) => {
                serde_json::from_slice(&ivec).map_err(|e| SettingsError::DbError(e.to_string()))?
            }
            None => {
                let default_cfg = SettingsConfig {
                    user_settings: UserSettings::default(),
                    system_settings: SystemOperationalSettings::default(),
                    security_policies: SecurityPolicySettings::default(),
                    cluster_configuration: ClusterSettings::default(),
                    cryptographic_identity: CryptoIdentitySettings::new(
                        node_id,
                        signer_fingerprint,
                    ),
                };
                let _ = self.save_settings(&default_cfg);
                return Ok(default_cfg);
            }
        };

        // Always ensure cryptographic identity is fresh and authoritative from runtime
        config.cryptographic_identity = CryptoIdentitySettings::new(node_id, signer_fingerprint);
        Ok(config)
    }

    pub fn save_settings(&self, config: &SettingsConfig) -> Result<(), SettingsError> {
        let val = serde_json::to_vec(config).map_err(|e| SettingsError::DbError(e.to_string()))?;
        self.db
            .insert(SETTINGS_KEY, val)
            .map_err(|e| SettingsError::DbError(e.to_string()))?;
        self.db
            .flush()
            .map_err(|e| SettingsError::DbError(e.to_string()))?;
        Ok(())
    }

    pub fn update_settings(
        &self,
        update: UpdateSettingsRequest,
        node_id: &str,
        signer_fingerprint: &str,
    ) -> Result<SettingsConfig, SettingsError> {
        // Priority 3 Guardrail: Do not allow arbitrary modification of immutable cryptographic identity
        if let Some(ref crypto_update) = update.cryptographic_identity {
            if let Some(obj) = crypto_update.as_object() {
                if obj.contains_key("node_id")
                    || obj.contains_key("signer_pub_fingerprint")
                    || obj.contains_key("kem_algorithm")
                    || obj.contains_key("dsa_algorithm")
                {
                    return Err(SettingsError::ImmutableFieldModified);
                }
            }
        }

        let mut current = self.get_settings(node_id, signer_fingerprint)?;

        if let Some(user) = update.user_settings {
            if user.refresh_interval_secs == 0 || user.refresh_interval_secs > 3600 {
                return Err(SettingsError::ValidationError(
                    "Refresh interval must be between 1 and 3600 seconds".to_string(),
                ));
            }
            current.user_settings = user;
        }

        if let Some(sys) = update.system_settings {
            let valid_levels = ["trace", "debug", "info", "warn", "error"];
            if !valid_levels.contains(&sys.log_level.to_lowercase().as_str()) {
                return Err(SettingsError::ValidationError(
                    "Invalid log_level. Must be one of trace, debug, info, warn, error".to_string(),
                ));
            }
            if sys.max_connections == 0 {
                return Err(SettingsError::ValidationError(
                    "max_connections must be greater than 0".to_string(),
                ));
            }
            current.system_settings = sys;
        }

        if let Some(sec) = update.security_policies {
            if sec.min_password_length < 12 {
                return Err(SettingsError::ValidationError(
                    "min_password_length must be at least 12".to_string(),
                ));
            }
            if sec.session_idle_timeout_secs < 60 {
                return Err(SettingsError::ValidationError(
                    "session_idle_timeout_secs must be at least 60".to_string(),
                ));
            }
            current.security_policies = sec;
        }

        if let Some(clust) = update.cluster_configuration {
            if clust.heartbeat_interval_ms < 50 {
                return Err(SettingsError::ValidationError(
                    "heartbeat_interval_ms must be at least 50".to_string(),
                ));
            }
            current.cluster_configuration = clust;
        }

        // Re-enforce cryptographic identity invariants
        current.cryptographic_identity = CryptoIdentitySettings::new(node_id, signer_fingerprint);

        self.save_settings(&current)?;
        Ok(current)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_settings_persistence_and_immutability() {
        let dir = tempdir().unwrap();
        let store = CredentialStore::open(dir.path()).unwrap();

        // 1. Initial settings
        let settings = store
            .get_settings("node-test-1", "fingerprint-abc")
            .unwrap();
        assert_eq!(settings.user_settings.theme, "cyber_midnight");
        assert_eq!(settings.cryptographic_identity.node_id, "node-test-1");
        assert_eq!(settings.cryptographic_identity.kem_algorithm, "ML-KEM-1024");
        assert!(settings.cryptographic_identity.immutable);

        // 2. Update valid fields
        let update = UpdateSettingsRequest {
            user_settings: Some(UserSettings {
                theme: "dark_emerald".to_string(),
                refresh_interval_secs: 10,
                alert_notifications: false,
            }),
            system_settings: None,
            security_policies: None,
            cluster_configuration: None,
            cryptographic_identity: None,
        };
        let updated = store
            .update_settings(update, "node-test-1", "fingerprint-abc")
            .unwrap();
        assert_eq!(updated.user_settings.theme, "dark_emerald");
        assert_eq!(updated.user_settings.refresh_interval_secs, 10);

        // 3. Attempt to mutate cryptographic identity MUST be rejected
        let bad_update = UpdateSettingsRequest {
            user_settings: None,
            system_settings: None,
            security_policies: None,
            cluster_configuration: None,
            cryptographic_identity: Some(serde_json::json!({
                "node_id": "hacked-node-id",
                "kem_algorithm": "RSA-1024"
            })),
        };
        let err = store
            .update_settings(bad_update, "node-test-1", "fingerprint-abc")
            .unwrap_err();
        assert!(matches!(err, SettingsError::ImmutableFieldModified));
    }
}
