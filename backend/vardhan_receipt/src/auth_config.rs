//! # Externalized Tenant/Policy/Actor Configuration (F-003 Remediation)
//!
//! This module provides externalized configuration for tenants, policies, and
//! authorized actor prefixes, loaded from a JSON config file at startup.
//!
//! ## Design
//!
//! Configuration is loaded from the path specified by `VARDHAN_AUTH_CONFIG_PATH`.
//! If not set, the system looks for `auth_config.json` in the keystore directory.
//! If neither exists, the system fails closed in production mode.
//!
//! In development/test mode, a default minimal config is generated if none is found.
//!
//! ## Security
//!
//! - No hardcoded tenant/polity/actor allowlists in production code paths.
//! - All allowlists come from external configuration.
//! - Production without config fails closed — no implicit allow.
//! - Config file should be provisioned via secure deployment pipeline
//!   (not committed to source control).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

/// Externalized authorization configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthConfig {
    /// Registered tenant IDs. Any tenant_id not in this list is DENY.
    pub tenants: Vec<String>,
    /// Registered policies. Each policy maps a policy_id to its version,
    /// governed actions, and authorized actor prefixes.
    pub policies: Vec<PolicyConfig>,
}

/// Configuration entry for a single policy.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyConfig {
    /// The canonical policy ID string (e.g. "VARDHAN_CORE_INTELLIGENCE_POLICY_V1").
    pub policy_id: String,
    /// The only version currently active. Requests with any other version → DENY.
    pub policy_version: String,
    /// The action_type strings this policy governs.
    pub governed_actions: Vec<String>,
    /// The actor_workload_id prefixes that are authorized under this policy.
    /// A prefix match is used: actor must START with one of these values.
    pub authorized_actor_prefixes: Vec<String>,
}

impl AuthConfig {
    /// Load configuration from a file path.
    /// Returns `None` if the file does not exist or cannot be parsed.
    pub fn load_from_file(path: &Path) -> Option<Self> {
        let contents = std::fs::read_to_string(path).ok()?;
        serde_json::from_str(&contents).ok()
    }

    /// Load configuration from `VARDHAN_AUTH_CONFIG_PATH` env var,
    /// or from `auth_config.json` in the given base directory.
    /// Returns `None` if no config is found.
    pub fn load(base_dir: Option<&Path>) -> Option<Self> {
        // 1. Check explicit config path env var
        if let Ok(config_path) = std::env::var("VARDHAN_AUTH_CONFIG_PATH") {
            let path = Path::new(&config_path);
            if path.exists() {
                return Self::load_from_file(path);
            }
        }

        // 2. Check for auth_config.json in base directory
        if let Some(dir) = base_dir {
            let config_path = dir.join("auth_config.json");
            if config_path.exists() {
                return Self::load_from_file(&config_path);
            }
        }

        None
    }

    /// Generate a development-only default config.
    /// This is ONLY called when VARDHAN_ENV is not "production".
    /// In production, the absence of config is a fatal error.
    pub fn default_for_development() -> Self {
        Self {
            tenants: vec![
                "org-vardhan-intelligence".to_string(),
                "org-acme-bank-poc".to_string(),
                "org-test-tenant-valid".to_string(),
            ],
            policies: vec![PolicyConfig {
                policy_id: "VARDHAN_CORE_INTELLIGENCE_POLICY_V1".to_string(),
                policy_version: "1.0".to_string(),
                governed_actions: vec!["SEAL_VERIFIED_FINDING".to_string()],
                authorized_actor_prefixes: vec!["svc:vardhan-intelligence:".to_string()],
            }],
        }
    }

    /// Generate a minimal auth config with no tenants, no policies, no actors.
    /// Used as a fail-closed default when no config is available.
    pub fn empty() -> Self {
        Self {
            tenants: vec![],
            policies: vec![],
        }
    }

    /// Convert to tenant lookup map.
    pub fn tenant_lookup(&self) -> HashMap<String, ()> {
        self.tenants.iter().map(|t| (t.clone(), ())).collect()
    }

    /// Get a policy entry by ID.
    pub fn policy_entry(&self, policy_id: &str) -> Option<&PolicyConfig> {
        self.policies.iter().find(|p| p.policy_id == policy_id)
    }
}

/// Environment-aware config loader that enforces production fail-closed semantics.
pub struct AuthConfigLoader;

impl AuthConfigLoader {
    /// Load the auth configuration.
    ///
    /// In production mode (`VARDHAN_ENV=production`), if no config file is found,
    /// returns `Err` — fails closed.
    ///
    /// In development/test mode, if no config is found, returns a default
    /// development config with a warning.
    pub fn load_required(base_dir: Option<&Path>) -> Result<AuthConfig, String> {
        let env = std::env::var("VARDHAN_ENV").unwrap_or_else(|_| "development".to_string());
        let env_lower = env.to_lowercase();

        if let Some(config) = AuthConfig::load(base_dir) {
            tracing::info!(
                "Loaded auth configuration from external source. \
                 {} tenants, {} policies.",
                config.tenants.len(),
                config.policies.len()
            );
            return Ok(config);
        }

        // No config found
        if env_lower == "production" || env_lower == "prod" {
            tracing::error!(
                "FATAL: No auth configuration found in production environment. \
                 Set VARDHAN_AUTH_CONFIG_PATH or provide auth_config.json \
                 in the keystore directory. Failing closed."
            );
            Err(
                "Production environment requires external auth configuration. \
                 No tenants, policies, or actors are registered. Failing closed."
                    .to_string(),
            )
        } else {
            tracing::warn!(
                "No auth configuration file found (VARDHAN_ENV={}). \
                 Using development default configuration. \
                 This is NOT safe for production.",
                env
            );
            Ok(AuthConfig::default_for_development())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // F-003: Shared mutex to prevent env-var races in auth_config tests
    static AUTH_TEST_MUTEX: std::sync::Mutex<()> = std::sync::Mutex::new(());
    use std::io::Write;

    #[test]
    fn test_load_from_file_valid() {
        let dir = tempfile::tempdir().unwrap();
        let config_path = dir.path().join("auth_config.json");
        let contents = r#"{
            "tenants": ["org-a", "org-b"],
            "policies": [
                {
                    "policy_id": "POLICY_V1",
                    "policy_version": "1.0",
                    "governed_actions": ["ACTION_X"],
                    "authorized_actor_prefixes": ["svc:test:"]
                }
            ]
        }"#;
        std::fs::write(&config_path, contents).unwrap();

        let config = AuthConfig::load_from_file(&config_path).unwrap();
        assert_eq!(config.tenants.len(), 2);
        assert_eq!(config.policies.len(), 1);
        assert_eq!(config.policies[0].policy_id, "POLICY_V1");
    }

    #[test]
    fn test_load_from_file_missing_returns_none() {
        let dir = tempfile::tempdir().unwrap();
        let config_path = dir.path().join("nonexistent.json");
        assert!(AuthConfig::load_from_file(&config_path).is_none());
    }

    #[test]
    fn test_load_from_file_invalid_json_returns_none() {
        let dir = tempfile::tempdir().unwrap();
        let config_path = dir.path().join("auth_config.json");
        std::fs::write(&config_path, "not valid json").unwrap();
        assert!(AuthConfig::load_from_file(&config_path).is_none());
    }

    #[test]
    fn test_load_from_env_var() {
        let _guard = AUTH_TEST_MUTEX.lock().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let config_path = dir.path().join("auth_config.json");
        let contents = r#"{"tenants":["org-x"],"policies":[]}"#;
        std::fs::write(&config_path, contents).unwrap();

        unsafe {
            std::env::set_var("VARDHAN_AUTH_CONFIG_PATH", config_path.to_str().unwrap());
        }

        let config = AuthConfig::load(None).unwrap();
        assert_eq!(config.tenants.len(), 1);

        unsafe {
            std::env::remove_var("VARDHAN_AUTH_CONFIG_PATH");
        }
    }

    #[test]
    fn test_load_from_base_dir() {
        let _guard = AUTH_TEST_MUTEX.lock().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let config_path = dir.path().join("auth_config.json");
        let contents = r#"{"tenants":["org-y"],"policies":[]}"#;
        std::fs::write(&config_path, contents).unwrap();

        let config = AuthConfig::load(Some(dir.path())).unwrap();
        assert_eq!(config.tenants.len(), 1);
        assert_eq!(config.tenants[0], "org-y");
    }

    #[test]
    fn test_production_fails_closed_without_config() {
        let _guard = AUTH_TEST_MUTEX.lock().unwrap();
        let dir = tempfile::tempdir().unwrap();
        // Ensure no config is found
        unsafe {
            std::env::remove_var("VARDHAN_AUTH_CONFIG_PATH");
            std::env::set_var("VARDHAN_ENV", "production");
        }

        // No config in temp dir
        let result = AuthConfigLoader::load_required(Some(dir.path()));
        assert!(result.is_err());

        unsafe {
            std::env::remove_var("VARDHAN_ENV");
        }
    }

    #[test]
    fn test_production_succeeds_with_config() {
        let _guard = AUTH_TEST_MUTEX.lock().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let config_path = dir.path().join("auth_config.json");
        let contents = r#"{"tenants":["org-a"],"policies":[]}"#;
        std::fs::write(&config_path, contents).unwrap();

        unsafe {
            std::env::set_var("VARDHAN_ENV", "production");
        }

        let result = AuthConfigLoader::load_required(Some(dir.path()));
        assert!(result.is_ok());
        assert_eq!(result.unwrap().tenants.len(), 1);

        unsafe {
            std::env::remove_var("VARDHAN_ENV");
        }
    }

    #[test]
    fn test_development_uses_default_without_config() {
        let _guard = AUTH_TEST_MUTEX.lock().unwrap();
        let dir = tempfile::tempdir().unwrap();
        unsafe {
            std::env::remove_var("VARDHAN_AUTH_CONFIG_PATH");
            std::env::set_var("VARDHAN_ENV", "development");
        }

        let result = AuthConfigLoader::load_required(Some(dir.path()));
        assert!(result.is_ok());
        let config = result.unwrap();
        assert!(
            config.tenants.len() >= 1,
            "Development default must have at least one tenant"
        );
        assert!(
            config.policies.len() >= 1,
            "Development default must have at least one policy"
        );

        unsafe {
            std::env::remove_var("VARDHAN_ENV");
        }
    }

    #[test]
    fn test_empty_config_denies_all() {
        let config = AuthConfig::empty();
        assert!(config.tenants.is_empty());
        assert!(config.policies.is_empty());
        assert!(config.tenant_lookup().is_empty());
        assert!(config.policy_entry("ANY").is_none());
    }

    #[test]
    fn test_config_serialization_roundtrip() {
        let original = AuthConfig {
            tenants: vec!["org-a".to_string(), "org-b".to_string()],
            policies: vec![PolicyConfig {
                policy_id: "P1".to_string(),
                policy_version: "1.0".to_string(),
                governed_actions: vec!["ACT".to_string()],
                authorized_actor_prefixes: vec!["svc:a".to_string()],
            }],
        };

        let json = serde_json::to_string(&original).unwrap();
        let deserialized: AuthConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.tenants.len(), 2);
        assert_eq!(deserialized.policies.len(), 1);
        assert_eq!(deserialized.policies[0].policy_id, "P1");
    }
}
