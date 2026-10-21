//! KMS and HSM Provider Abstractions for Production Key Management.
//!
//! This module decouples high-level cryptographic key lifecycle operations
//! (creation, rotation, revocation, envelope wrapping) from cloud-specific
//! and hardware-specific APIs (AWS KMS, Google Cloud KMS, HashiCorp Vault Transit, PKCS#11 HSM).

pub mod aws;
pub mod gcp;
pub mod pkcs11;
pub mod vault_transit;

pub use aws::{AwsKmsEmulator, AwsKmsProvider};
pub use gcp::{GcpCloudKmsProvider, GcpKmsEmulator};
pub use pkcs11::{Pkcs11HardwareMode, Pkcs11HsmProvider, Pkcs11SoftHsmEmulator};
pub use vault_transit::{VaultTransitEmulator, VaultTransitProvider};

use crate::{KeyProtectionError, KeyProtectionProvider, KeyStatus};
use aes_gcm::{
    Aes256Gcm, Nonce,
    aead::{Aead, KeyInit},
};
use rand::RngCore;
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use zeroize::Zeroizing;

/// Key metadata reported by KMS / HSM providers.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct KmsKeyMetadata {
    pub key_id: String,
    pub key_version: String,
    pub status: KeyStatus,
    pub created_at_ms: u64,
    pub provider: String,
    pub algorithm: String,
}

/// Structured audit record emitted for every KMS / HSM operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KmsAuditRecord {
    pub timestamp_unix: u64,
    pub operation: String,
    pub provider: String,
    pub key_id: String,
    pub status: String,
    pub error: Option<String>,
}

/// Abstract provider interface for Key Management Services and Hardware Security Modules.
pub trait KmsProvider: Send + Sync {
    /// Human-readable provider name (e.g. "aws-kms", "gcp-kms", "vault-transit", "hsm-pkcs11").
    fn provider_name(&self) -> &'static str;

    /// Returns true if this provider meets production bank-grade compliance.
    fn is_production_safe(&self) -> bool;

    /// Wrap a 256-bit Data Encryption Key (DEK) under the KMS/HSM master key.
    fn encrypt_dek(
        &self,
        key_id: &str,
        plaintext_dek: &[u8; 32],
    ) -> Result<Vec<u8>, KeyProtectionError>;

    /// Unwrap a 256-bit Data Encryption Key (DEK) under the KMS/HSM master key.
    fn decrypt_dek(
        &self,
        key_id: &str,
        ciphertext_dek: &[u8],
    ) -> Result<Zeroizing<[u8; 32]>, KeyProtectionError>;

    /// Rotate the master key to a new active key version.
    fn rotate_key(&self, key_id: &str) -> Result<KmsKeyMetadata, KeyProtectionError>;

    /// Revoke the master key, preventing further encryption or decryption.
    fn revoke_key(&self, key_id: &str, reason: &str) -> Result<(), KeyProtectionError>;

    /// Retrieve key metadata from the provider.
    fn get_key_metadata(&self, key_id: &str) -> Result<KmsKeyMetadata, KeyProtectionError>;

    /// Retrieve recorded audit records for compliance verification.
    fn audit_records(&self) -> Result<Vec<KmsAuditRecord>, KeyProtectionError>;
}

/// Serialized envelope format for KMS-protected private key material.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KmsProtectedEnvelope {
    pub version: u32,
    pub provider: String,
    pub key_id: String,
    pub key_version: String,
    pub created_at_unix: u64,
    pub wrapped_dek_hex: String,
    pub wrapped_payload_hex: String,
}

/// Adapter converting any `KmsProvider` into a `KeyProtectionProvider`.
///
/// Implements envelope encryption:
/// 1. Generates ephemeral 256-bit Data Encryption Key (DEK).
/// 2. Encrypts private key bytes under DEK using AES-256-GCM.
/// 3. Wraps DEK using `KmsProvider::encrypt_dek`.
/// 4. Packages wrapped DEK and encrypted payload into a versioned envelope.
/// 5. Zeroizes ephemeral DEK immediately.
pub struct KmsKeyProtectionProvider {
    provider: Arc<dyn KmsProvider>,
    key_id: String,
    provider_name: &'static str,
}

impl KmsKeyProtectionProvider {
    pub fn new(provider: Arc<dyn KmsProvider>, key_id: String) -> Self {
        let name = provider.provider_name();
        Self {
            provider,
            key_id,
            provider_name: name,
        }
    }

    pub fn key_id(&self) -> &str {
        &self.key_id
    }

    pub fn kms_provider(&self) -> &Arc<dyn KmsProvider> {
        &self.provider
    }
}

impl KeyProtectionProvider for KmsKeyProtectionProvider {
    fn provider_name(&self) -> &'static str {
        self.provider_name
    }

    fn is_production_safe(&self) -> bool {
        self.provider.is_production_safe()
    }

    fn wrap_private_key(&self, plaintext: &[u8]) -> Result<Vec<u8>, KeyProtectionError> {
        let meta = self.provider.get_key_metadata(&self.key_id)?;
        if meta.status == KeyStatus::Revoked {
            return Err(KeyProtectionError::Crypto(format!(
                "Cannot wrap key: KMS key {} is REVOKED",
                self.key_id
            )));
        }

        // 1. Generate ephemeral 256-bit DEK
        let mut dek = [0u8; 32];
        OsRng.fill_bytes(&mut dek);
        let zeroizing_dek = Zeroizing::new(dek);

        // 2. Encrypt plaintext under DEK using AES-256-GCM
        let cipher = Aes256Gcm::new((&*zeroizing_dek).into());
        let mut nonce_bytes = [0u8; 12];
        OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);

        let ciphertext = cipher.encrypt(nonce, plaintext).map_err(|e| {
            KeyProtectionError::Crypto(format!("Envelope encryption failed: {:?}", e))
        })?;

        let mut wrapped_payload = Vec::with_capacity(12 + ciphertext.len());
        wrapped_payload.extend_from_slice(&nonce_bytes);
        wrapped_payload.extend_from_slice(&ciphertext);

        // 3. Wrap DEK with KMS provider
        let wrapped_dek = self.provider.encrypt_dek(&self.key_id, &zeroizing_dek)?;

        // 4. Assemble envelope
        let envelope = KmsProtectedEnvelope {
            version: 2,
            provider: self.provider_name.to_string(),
            key_id: self.key_id.clone(),
            key_version: meta.key_version,
            created_at_unix: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0),
            wrapped_dek_hex: hex::encode(wrapped_dek),
            wrapped_payload_hex: hex::encode(wrapped_payload),
        };

        let json = serde_json::to_vec(&envelope)
            .map_err(|e| KeyProtectionError::Serialization(e.to_string()))?;
        Ok(json)
    }

    fn unwrap_private_key(
        &self,
        ciphertext: &[u8],
    ) -> Result<Zeroizing<Vec<u8>>, KeyProtectionError> {
        let envelope: KmsProtectedEnvelope =
            serde_json::from_slice(ciphertext).map_err(|_| KeyProtectionError::DecryptionFailed)?;

        let wrapped_dek = hex::decode(&envelope.wrapped_dek_hex)
            .map_err(|_| KeyProtectionError::DecryptionFailed)?;
        let wrapped_payload = hex::decode(&envelope.wrapped_payload_hex)
            .map_err(|_| KeyProtectionError::DecryptionFailed)?;

        if wrapped_payload.len() < 12 {
            return Err(KeyProtectionError::DecryptionFailed);
        }

        // 1. Unwrap DEK using KMS provider
        let dek = self.provider.decrypt_dek(&envelope.key_id, &wrapped_dek)?;

        // 2. Decrypt payload under DEK using AES-256-GCM
        let cipher = Aes256Gcm::new((&*dek).into());
        let nonce = Nonce::from_slice(&wrapped_payload[..12]);
        let data = &wrapped_payload[12..];

        let plaintext = cipher
            .decrypt(nonce, data)
            .map_err(|_| KeyProtectionError::DecryptionFailed)?;

        Ok(Zeroizing::new(plaintext))
    }
}
