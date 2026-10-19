//! HashiCorp Vault key protection provider for production key management.
//!
//! This module provides a Vault-backed `KeyProtectionProvider` that encrypts
//! and decrypts private key material using Vault's transit secrets engine.
//!
//! ## Configuration (enable `vault` feature)
//!
//! Set the following environment variables:
//! - `VARDHAN_VAULT_ADDR`: Vault server address (e.g. `https://vault.example.com`)
//! - `VARDHAN_VAULT_TOKEN`: Vault client token (from AppRole or Kubernetes auth)
//! - `VARDHAN_VAULT_KEY_NAME`: (Optional) Vault transit key name (default: `vardhan-v1`)
//!
//! Build with: `cargo build --features vardhan_keystore/vault`
//!
//! ## Production Requirements
//!
//! - Vault 1.15+ with the transit secrets engine enabled
//! - TLS must be configured on the Vault listener (never use HTTP in production)
//! - Token must have `transit:encrypt` and `transit:decrypt` capabilities

#[cfg(feature = "vault")]
use crate::KeyProtectionError;
#[cfg(feature = "vault")]
use crate::KeyProtectionProvider;

#[cfg(feature = "vault")]
const DEFAULT_VAULT_KEY_NAME: &str = "vardhan-v1";

/// Vault-backed key protection provider for production deployments.
#[cfg(feature = "vault")]
pub struct VaultKeyProtectionProvider;

#[cfg(feature = "vault")]
impl VaultKeyProtectionProvider {
    /// Check if Vault configuration is present in the environment.
    pub fn configured() -> bool {
        std::env::var("VARDHAN_VAULT_ADDR")
            .map(|v| !v.is_empty())
            .unwrap_or(false)
    }

    /// Resolve the Vault transit key name from the environment.
    pub fn vault_key_name() -> String {
        std::env::var("VARDHAN_VAULT_KEY_NAME")
            .unwrap_or_else(|_| DEFAULT_VAULT_KEY_NAME.to_string())
    }

    /// Resolve the Vault address from the environment.
    pub fn vault_addr() -> Result<String, KeyProtectionError> {
        std::env::var("VARDHAN_VAULT_ADDR").map_err(|_| {
            KeyProtectionError::ConfigurationError("VARDHAN_VAULT_ADDR is not set".to_string())
        })
    }

    /// Resolve the Vault token from the environment.
    pub fn vault_token() -> Result<String, KeyProtectionError> {
        std::env::var("VARDHAN_VAULT_TOKEN").map_err(|_| {
            KeyProtectionError::ConfigurationError("VARDHAN_VAULT_TOKEN is not set".to_string())
        })
    }
}

#[cfg(feature = "vault")]
impl KeyProtectionProvider for VaultKeyProtectionProvider {
    fn provider_name(&self) -> &'static str {
        "vault-transit"
    }

    /// Vault-backed protection is always production-safe.
    fn is_production_safe(&self) -> bool {
        true
    }

    fn wrap_private_key(&self, plaintext: &[u8]) -> Result<Vec<u8>, KeyProtectionError> {
        let addr = Self::vault_addr()?;
        let token = Self::vault_token()?;
        let key_name = Self::vault_key_name();

        let plaintext_b64 = base64::encode(plaintext);
        let payload = serde_json::json!({ "plaintext": plaintext_b64 });

        let resp = reqwest::blocking::Client::new()
            .post(format!("{addr}/v1/transit/encrypt/{key_name}"))
            .header("X-Vault-Token", &token)
            .json(&payload)
            .send()
            .map_err(|e| KeyProtectionError::NetworkError(e.to_string()))?;

        let status = resp.status();
        let body = resp
            .text()
            .map_err(|e| KeyProtectionError::NetworkError(e.to_string()))?;

        if !status.is_success() {
            return Err(KeyProtectionError::ConfigurationError(format!(
                "Vault transit encrypt failed ({}): {}",
                status, body
            )));
        }

        let json: serde_json::Value = serde_json::from_str(&body).map_err(|e| {
            KeyProtectionError::ConfigurationError(format!("Failed to parse Vault response: {}", e))
        })?;

        let ciphertext = json
            .get("data")
            .and_then(|d| d.get("ciphertext"))
            .and_then(|c| c.as_str())
            .ok_or_else(|| {
                KeyProtectionError::ConfigurationError(
                    "Vault response missing ciphertext".to_string(),
                )
            })?;

        Ok(ciphertext.as_bytes().to_vec())
    }

    fn unwrap_private_key(
        &self,
        ciphertext: &[u8],
    ) -> Result<zeroize::Zeroizing<Vec<u8>>, KeyProtectionError> {
        let addr = Self::vault_addr()?;
        let token = Self::vault_token()?;
        let key_name = Self::vault_key_name();

        let ct = String::from_utf8(ciphertext.to_vec())
            .map_err(|e| KeyProtectionError::ConfigurationError(e.to_string()))?;

        let payload = serde_json::json!({ "ciphertext": ct });

        let resp = reqwest::blocking::Client::new()
            .post(format!("{addr}/v1/transit/decrypt/{key_name}"))
            .header("X-Vault-Token", &token)
            .json(&payload)
            .send()
            .map_err(|e| KeyProtectionError::NetworkError(e.to_string()))?;

        let status = resp.status();
        let body = resp
            .text()
            .map_err(|e| KeyProtectionError::NetworkError(e.to_string()))?;

        if !status.is_success() {
            return Err(KeyProtectionError::ConfigurationError(format!(
                "Vault transit decrypt failed ({}): {}",
                status, body
            )));
        }

        let json: serde_json::Value = serde_json::from_str(&body).map_err(|e| {
            KeyProtectionError::ConfigurationError(format!("Failed to parse Vault response: {}", e))
        })?;

        let plaintext_b64 = json
            .get("data")
            .and_then(|d| d.get("plaintext"))
            .and_then(|p| p.as_str())
            .ok_or_else(|| {
                KeyProtectionError::ConfigurationError(
                    "Vault response missing plaintext".to_string(),
                )
            })?;

        let plaintext = base64::decode(plaintext_b64).map_err(|e| {
            KeyProtectionError::ConfigurationError(format!(
                "Failed to base64-decode Vault plaintext: {}",
                e
            ))
        })?;

        Ok(zeroize::Zeroizing::new(plaintext))
    }
}

#[cfg(all(test, feature = "vault"))]
mod tests {
    use super::*;

    #[test]
    fn test_vault_key_name_default() {
        unsafe { std::env::remove_var("VARDHAN_VAULT_KEY_NAME") };
        assert_eq!(VaultKeyProtectionProvider::vault_key_name(), "vardhan-v1");
    }

    #[test]
    fn test_vault_key_name_custom() {
        unsafe { std::env::set_var("VARDHAN_VAULT_KEY_NAME", "my-custom-key") };
        assert_eq!(
            VaultKeyProtectionProvider::vault_key_name(),
            "my-custom-key"
        );
        unsafe { std::env::remove_var("VARDHAN_VAULT_KEY_NAME") };
    }

    #[test]
    fn test_vault_not_configured() {
        unsafe { std::env::remove_var("VARDHAN_VAULT_ADDR") };
        assert!(!VaultKeyProtectionProvider::configured());
    }

    #[test]
    fn test_vault_configured() {
        unsafe { std::env::set_var("VARDHAN_VAULT_ADDR", "https://vault.example.com") };
        assert!(VaultKeyProtectionProvider::configured());
        unsafe { std::env::remove_var("VARDHAN_VAULT_ADDR") };
    }

    #[test]
    fn test_provider_name() {
        let provider = VaultKeyProtectionProvider;
        assert_eq!(provider.provider_name(), "vault-transit");
    }

    #[test]
    fn test_provider_is_production_safe() {
        let provider = VaultKeyProtectionProvider;
        assert!(provider.is_production_safe());
    }
}
