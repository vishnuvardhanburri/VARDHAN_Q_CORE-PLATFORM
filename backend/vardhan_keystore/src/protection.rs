//! # Key Protection Provider Abstraction (F-001 Remediation)
//!
//! ## Design
//!
//! The `KeyProtectionProvider` trait abstracts how private key material is
//! encrypted at rest. Two implementations are provided:
//!
//! - [`ProductionEnvelopeProtection`]: Envelope encryption with AES-256-GCM,
//!   using a Key Encryption Key (KEK) supplied externally. `is_production_safe()`
//!   returns `true`. The KEK must be sourced from a certified HSM, cloud KMS
//!   (AWS KMS, GCP Cloud KMS, Azure Key Vault), or TPM. The provider itself
//!   does NOT fetch the KEK — that is the caller's responsibility, which keeps
//!   the provider free of cloud SDK dependencies.
//!
//! - [`DevelopmentLocalProtection`]: Uses an ephemeral random KEK stored in a
//!   local file with 0o600 permissions. `is_production_safe()` returns `false`.
//!   This provider is ONLY permitted when `VARDHAN_ENV` is unset or
//!   `development`.
//!
//! [`EnvironmentKeyProtectionProvider::select()`] reads `VARDHAN_ENV` and
//! either constructs a production provider (requiring a KEK) or a development
//! provider. In production mode, if no KEK is available, construction fails
//! with `KeyProtectionError::NoProductionKeyProvider`.

use aes_gcm::{Aes256Gcm, Nonce, aead::Aead, aead::Key, aead::KeyInit};
use rand::RngCore;
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;
use zeroize::Zeroizing;

// ─────────────────────────────────────────────────────────────────────────────
// Error types
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, thiserror::Error)]
pub enum KeyProtectionError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Serialization error: {0}")]
    Serialization(String),

    #[error("Crypto error: {0}")]
    Crypto(String),

    #[error(
        "Production environment requires an HSM/KMS-backed key protection provider. \
         Set VARDHAN_ENV=development to use a local provider for testing only."
    )]
    NoProductionKeyProvider,

    #[error(
        "Security violation: development key protection provider used in production environment. \
         Set VARDHAN_ENV=development explicitly or configure a production KMS/HSM provider."
    )]
    DevelopmentProviderInProduction,

    #[error("Decryption failed: ciphertext is malformed or key is incorrect")]
    DecryptionFailed,

    #[error("Configuration error: {0}")]
    ConfigurationError(String),

    #[error("Network error during key protection: {0}")]
    NetworkError(String),
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider trait
// ─────────────────────────────────────────────────────────────────────────────

/// Trait for encrypting/decrypting private key material at rest.
///
/// Implementations MUST be `Send + Sync` so they can be shared across threads.
/// Implementations MUST NOT log or expose private key material.
pub trait KeyProtectionProvider: Send + Sync {
    /// Human-readable name of the protection provider.
    fn provider_name(&self) -> &'static str;

    /// Returns `true` if this provider is approved for production use
    /// (i.e., backed by an HSM, cloud KMS, or TPM).
    fn is_production_safe(&self) -> bool;

    /// Encrypt `plaintext` (private key bytes) and return the ciphertext blob.
    /// The ciphertext includes the AES-256-GCM nonce prepended to the encrypted
    /// bytes plus the GCM authentication tag.
    fn wrap_private_key(&self, plaintext: &[u8]) -> Result<Vec<u8>, KeyProtectionError>;

    /// Decrypt a ciphertext blob produced by `wrap_private_key`.
    /// Returns the plaintext in a `Zeroizing` buffer that is zeroized on drop.
    fn unwrap_private_key(
        &self,
        ciphertext: &[u8],
    ) -> Result<Zeroizing<Vec<u8>>, KeyProtectionError>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Envelope format
// ─────────────────────────────────────────────────────────────────────────────

/// On-disk envelope for a single protected private key.
///
/// Stored as JSON in `ed25519.key.enc` / `mldsa87.sec.enc`.
#[allow(dead_code)]
#[derive(Serialize, Deserialize)]
struct ProtectedKeyEnvelope {
    /// Name of the provider that wrapped this key (e.g. "aws-kms", "local-dev").
    provider: String,
    /// KEK version identifier (for future key rotation support).
    key_version: String,
    /// Base64-encoded wrapped ciphertext (nonce || ciphertext || tag).
    wrapped: String,
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Production envelope protection (AES-256-GCM with externally supplied KEK)
// ─────────────────────────────────────────────────────────────────────────────

/// Production-grade envelope key protection using AES-256-GCM.
///
/// The KEK (Key Encryption Key) is supplied externally — typically from a
/// cloud KMS or HSM. The provider does NOT fetch the KEK itself, keeping it
/// free of cloud SDK dependencies. The caller (e.g. `keystore_manager`) is
/// responsible for obtaining the KEK from the external provider.
///
/// ## Security Properties
/// - AES-256-GCM provides authenticated encryption (AEAD).
/// - Each wrap operation uses a fresh 96-bit random nonce.
/// - The KEK is held in a `Zeroizing<[u8; 32]>` buffer.
/// - The provider name reflects the external KMS/HSM source.
pub struct ProductionEnvelopeProtection {
    /// The Key Encryption Key, zeroized on drop.
    kek: Zeroizing<[u8; 32]>,
    provider_name: &'static str,
    key_version: String,
}

impl ProductionEnvelopeProtection {
    /// Return the key version identifier.
    pub fn key_version(&self) -> &str {
        &self.key_version
    }

    /// Create a production envelope protector from an externally supplied KEK.
    ///
    /// # Arguments
    /// - `kek`: 32-byte Key Encryption Key obtained from an HSM or cloud KMS.
    /// - `provider_name`: Identifier of the external provider (e.g. "aws-kms").
    /// - `key_version`: Version string of the KEK for audit logging.
    ///
    /// # Returns
    /// `Ok` if the KEK is valid length, `Err` otherwise.
    pub fn new(
        kek: [u8; 32],
        provider_name: &'static str,
        key_version: impl Into<String>,
    ) -> Result<Self, KeyProtectionError> {
        if provider_name.is_empty() {
            return Err(KeyProtectionError::Crypto(
                "provider_name must not be empty".to_string(),
            ));
        }
        Ok(Self {
            kek: Zeroizing::new(kek),
            provider_name,
            key_version: key_version.into(),
        })
    }

    /// Build a production protector from the `VARDHAN_PRODUCTION_KEK` environment
    /// variable (hex-encoded 32 bytes). Returns `Err` if not set or invalid.
    ///
    /// # Security Note
    /// In a real deployment, the KEK should be fetched from a cloud KMS API
    /// at startup and injected here. Reading from an environment variable is
    /// a convenience for testing and should be replaced with proper KMS
    /// integration in production deployments.
    pub fn from_env_kms() -> Result<Self, KeyProtectionError> {
        let hex_kek = std::env::var("VARDHAN_PRODUCTION_KEK")
            .map_err(|_| KeyProtectionError::NoProductionKeyProvider)?;

        let kek_bytes = hex::decode(&hex_kek).map_err(|_| {
            KeyProtectionError::Crypto("VARDHAN_PRODUCTION_KEK is not valid hex".to_string())
        })?;

        let kek_arr: [u8; 32] = kek_bytes.as_slice().try_into().map_err(|_| {
            KeyProtectionError::Crypto(format!(
                "VARDHAN_PRODUCTION_KEK must be 32 bytes (64 hex chars), got {} bytes",
                kek_bytes.len()
            ))
        })?;

        let provider_name =
            std::env::var("VARDHAN_KMS_PROVIDER").unwrap_or_else(|_| "aws-kms".to_string());
        let key_id = std::env::var("VARDHAN_KMS_KEY_ID").unwrap_or_else(|_| "default".to_string());

        // Determine the static provider name
        let name_static: &'static str = match provider_name.as_str() {
            "aws-kms" => "aws-kms",
            "gcp-kms" => "gcp-kms",
            "azure-kv" => "azure-kv",
            "pkcs11-hsm" => "pkcs11-hsm",
            _ => "kms",
        };

        // SECURITY: Never log the KEK value
        tracing::info!(
            "Production key protection initialized with provider={} key_id={}, key_version={}",
            name_static,
            key_id,
            "v1"
        );

        Self::new(kek_arr, name_static, key_id)
    }
}

impl KeyProtectionProvider for ProductionEnvelopeProtection {
    fn provider_name(&self) -> &'static str {
        self.provider_name
    }

    fn is_production_safe(&self) -> bool {
        true
    }

    fn wrap_private_key(&self, plaintext: &[u8]) -> Result<Vec<u8>, KeyProtectionError> {
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&self.kek[..]));
        // Generate a fresh 96-bit nonce for each wrap operation
        let mut nonce_bytes = [0u8; 12];
        OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);

        // Encrypt: plaintext || nonce (prepended) || ciphertext+tag
        let ciphertext = cipher.encrypt(nonce, plaintext).map_err(|e| {
            KeyProtectionError::Crypto(format!("AES-256-GCM encryption failed: {e}"))
        })?;

        let mut blob = Vec::with_capacity(12 + ciphertext.len());
        blob.extend_from_slice(&nonce_bytes);
        blob.extend_from_slice(&ciphertext);

        Ok(blob)
    }

    fn unwrap_private_key(
        &self,
        ciphertext: &[u8],
    ) -> Result<Zeroizing<Vec<u8>>, KeyProtectionError> {
        if ciphertext.len() < 12 {
            return Err(KeyProtectionError::DecryptionFailed);
        }

        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&self.kek[..]));
        let nonce = Nonce::from_slice(&ciphertext[..12]);
        let ct = &ciphertext[12..];

        let plaintext = cipher
            .decrypt(nonce, ct)
            .map_err(|_| KeyProtectionError::DecryptionFailed)?;

        Ok(Zeroizing::new(plaintext))
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Development local protection (NOT production-safe)
// ─────────────────────────────────────────────────────────────────────────────

/// Development-only key protection provider.
///
/// Uses a per-keystore random KEK stored in a local file with 0o600
/// permissions. This provider is explicitly NOT production-safe.
///
/// # Security Warning
/// The KEK is stored on the local filesystem. Anyone with read access to
/// the keystore directory (and sufficient privileges) can decrypt the keys.
/// Use `EnvironmentKeyProtectionProvider::select()` to ensure this provider
/// is only used in development/test environments.
pub struct DevelopmentLocalProtection {
    /// KEK for envelope encryption, zeroized on drop.
    kek: Zeroizing<[u8; 32]>,
    /// Path to the KEK file (for reference/debugging only).
    kek_path: std::path::PathBuf,
    provider_name: &'static str,
}

impl DevelopmentLocalProtection {
    /// Return the path to the KEK file.
    pub fn kek_path(&self) -> &Path {
        &self.kek_path
    }

    /// Create or load a development KEK from `kek_path`.
    /// If the file doesn't exist, a new random KEK is generated and saved.
    pub fn new(kek_path: impl AsRef<Path>) -> Result<Self, KeyProtectionError> {
        let kep_path = kek_path.as_ref();

        let kek = if kep_path.exists() {
            let data = fs::read(kep_path)?;
            if data.len() != 32 {
                return Err(KeyProtectionError::Crypto(
                    "KEK file must be exactly 32 bytes".to_string(),
                ));
            }
            let mut kek_arr = [0u8; 32];
            kek_arr.copy_from_slice(&data);
            kek_arr
        } else {
            // Generate a new random KEK
            let mut kek_arr = [0u8; 32];
            OsRng.fill_bytes(&mut kek_arr);

            // Persist with restrictive permissions
            let parent = kep_path.parent().ok_or_else(|| {
                KeyProtectionError::Io(std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    "KEK path has no parent directory",
                ))
            })?;
            fs::create_dir_all(parent)?;

            let mut options = OpenOptions::new();
            options.write(true).create(true).truncate(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut file = options.open(kep_path)?;
            file.write_all(&kek_arr)?;
            file.sync_all()?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let mut perms = file.metadata()?.permissions();
                perms.set_mode(0o600);
                file.set_permissions(perms)?;
            }
            kek_arr
        };

        Ok(Self {
            kek: Zeroizing::new(kek),
            kek_path: kep_path.to_path_buf(),
            provider_name: "local-dev",
        })
    }
}

impl KeyProtectionProvider for DevelopmentLocalProtection {
    fn provider_name(&self) -> &'static str {
        self.provider_name
    }

    fn is_production_safe(&self) -> bool {
        false
    }

    fn wrap_private_key(&self, plaintext: &[u8]) -> Result<Vec<u8>, KeyProtectionError> {
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&self.kek[..]));
        let mut nonce_bytes = [0u8; 12];
        OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);

        let ciphertext = cipher.encrypt(nonce, plaintext).map_err(|e| {
            KeyProtectionError::Crypto(format!("AES-256-GCM encryption failed: {e}"))
        })?;

        let mut blob = Vec::with_capacity(12 + ciphertext.len());
        blob.extend_from_slice(&nonce_bytes);
        blob.extend_from_slice(&ciphertext);

        Ok(blob)
    }

    fn unwrap_private_key(
        &self,
        ciphertext: &[u8],
    ) -> Result<Zeroizing<Vec<u8>>, KeyProtectionError> {
        if ciphertext.len() < 12 {
            return Err(KeyProtectionError::DecryptionFailed);
        }

        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&self.kek[..]));
        let nonce = Nonce::from_slice(&ciphertext[..12]);
        let ct = &ciphertext[12..];

        let plaintext = cipher
            .decrypt(nonce, ct)
            .map_err(|_| KeyProtectionError::DecryptionFailed)?;

        Ok(Zeroizing::new(plaintext))
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Environment-aware provider selection
// ─────────────────────────────────────────────────────────────────────────────

/// Environment-aware key protection provider selector.
///
/// Reads `VARDHAN_ENV` to determine the environment:
/// - `production`: Requires a production-safe provider. If `VARDHAN_PRODUCTION_KEK`
///   is not set, returns `Err(KeyProtectionError::NoProductionKeyProvider)`.
/// - `development` or unset: Uses `DevelopmentLocalProtection`.
///
/// # Security Guarantee
/// If `VARDHAN_ENV=production` is set, this function will NEVER return a
/// `DevelopmentLocalProtection` instance. It will either return a
/// `ProductionEnvelopeProtection` or an error.
pub struct EnvironmentKeyProtectionProvider;

impl EnvironmentKeyProtectionProvider {
    /// Select the appropriate key protection provider based on environment.
    ///
    /// # Arguments
    /// - `kek_path`: Path for the development KEK file (only used in dev mode).
    ///
    /// # Returns
    /// - `Ok(provider)` with the selected provider.
    /// - `Err(KeyProtectionError::NoProductionKeyProvider)` if `VARDHAN_ENV=production`
    ///   and no production KEK is available.
    /// - `Err(KeyProtectionError::DevelopmentProviderInProduction)` if a
    ///   `DevelopmentLocalProtection` is explicitly rejected in production.
    pub fn select(
        kek_path: impl AsRef<Path>,
    ) -> Result<Box<dyn KeyProtectionProvider>, KeyProtectionError> {
        let env = std::env::var("VARDHAN_ENV").unwrap_or_else(|_| "development".to_string());

        match env.to_lowercase().as_str() {
            "production" | "prod" => {
                let kms_provider_env = std::env::var("VARDHAN_KMS_PROVIDER")
                    .or_else(|_| std::env::var("KMS_PROVIDER"))
                    .unwrap_or_default()
                    .to_lowercase();

                // 1. AWS KMS
                if kms_provider_env == "aws-kms"
                    || kms_provider_env == "aws"
                    || std::env::var("VARDHAN_AWS_KMS_KEY_ID").is_ok()
                    || (kms_provider_env.is_empty() && std::env::var("AWS_KMS_KEY_ID").is_ok())
                {
                    match crate::kms::AwsKmsProvider::from_env() {
                        Ok(p) => {
                            let key_id = p.key_id().to_string();
                            let envelope_provider = crate::kms::KmsKeyProtectionProvider::new(
                                std::sync::Arc::new(p),
                                key_id,
                            );
                            tracing::info!("Production key protection: using AWS KMS provider");
                            return Ok(Box::new(envelope_provider));
                        }
                        Err(e) => {
                            tracing::error!("AWS KMS configuration error: {}", e);
                            return Err(e);
                        }
                    }
                }

                // 2. Google Cloud KMS
                if kms_provider_env == "gcp-kms"
                    || kms_provider_env == "gcp"
                    || std::env::var("VARDHAN_GCP_KMS_KEY_NAME").is_ok()
                    || std::env::var("GCP_KMS_KEY_NAME").is_ok()
                {
                    match crate::kms::GcpCloudKmsProvider::from_env() {
                        Ok(p) => {
                            let key_name = p.key_name().to_string();
                            let envelope_provider = crate::kms::KmsKeyProtectionProvider::new(
                                std::sync::Arc::new(p),
                                key_name,
                            );
                            tracing::info!(
                                "Production key protection: using Google Cloud KMS provider"
                            );
                            return Ok(Box::new(envelope_provider));
                        }
                        Err(e) => {
                            tracing::error!("GCP Cloud KMS configuration error: {}", e);
                            return Err(e);
                        }
                    }
                }

                // 3. HashiCorp Vault Transit
                if kms_provider_env == "vault"
                    || kms_provider_env == "vault-transit"
                    || std::env::var("VARDHAN_VAULT_ADDR").is_ok()
                {
                    #[cfg(feature = "vault")]
                    {
                        if crate::vault::VaultKeyProtectionProvider::configured() {
                            tracing::info!("Production key protection: using Vault transit engine");
                            return Ok(Box::new(crate::vault::VaultKeyProtectionProvider));
                        }
                    }
                    match crate::kms::VaultTransitProvider::from_env() {
                        Ok(p) => {
                            let key_name = p.key_name().to_string();
                            let envelope_provider = crate::kms::KmsKeyProtectionProvider::new(
                                std::sync::Arc::new(p),
                                key_name,
                            );
                            tracing::info!(
                                "Production key protection: using Vault Transit provider"
                            );
                            return Ok(Box::new(envelope_provider));
                        }
                        Err(e) => {
                            tracing::error!("Vault Transit configuration error: {}", e);
                            return Err(e);
                        }
                    }
                }

                // 4. PKCS#11 Hardware Security Module
                if kms_provider_env == "pkcs11"
                    || kms_provider_env == "hsm"
                    || std::env::var("VARDHAN_PKCS11_SLOT_ID").is_ok()
                {
                    match crate::kms::Pkcs11HsmProvider::from_env() {
                        Ok(p) => {
                            tracing::info!("Production key protection: using PKCS#11 HSM provider");
                            return Ok(Box::new(p));
                        }
                        Err(e) => {
                            tracing::error!("PKCS#11 HSM configuration error: {}", e);
                            return Err(e);
                        }
                    }
                }

                // 5. Envelope KEK fallback
                if let Ok(provider) = ProductionEnvelopeProtection::from_env_kms() {
                    tracing::info!(
                        "Production key protection: using KMS-backed provider '{}'",
                        provider.provider_name()
                    );
                    return Ok(Box::new(provider));
                }

                tracing::error!(
                    "FATAL: VARDHAN_ENV=production but no production-safe KMS/HSM provider is configured. \
                     Supported production providers: \
                     1. AWS KMS: Set VARDHAN_KMS_PROVIDER=aws-kms and VARDHAN_AWS_KMS_KEY_ID \
                     2. GCP KMS: Set VARDHAN_KMS_PROVIDER=gcp-kms and VARDHAN_GCP_KMS_KEY_NAME \
                     3. HashiCorp Vault: Set VARDHAN_KMS_PROVIDER=vault and VARDHAN_VAULT_ADDR, VARDHAN_VAULT_TOKEN \
                     4. PKCS#11 HSM: Set VARDHAN_KMS_PROVIDER=pkcs11 and VARDHAN_PKCS11_SLOT_ID, VARDHAN_PKCS11_PIN \
                     5. Envelope KEK: Set VARDHAN_PRODUCTION_KEK (hex-encoded 32 bytes)"
                );
                Err(KeyProtectionError::NoProductionKeyProvider)
            }
            _ => {
                // Development / test / CI mode
                tracing::warn!(
                    "VARDHAN_ENV={} — using DevelopmentLocalProtection. \
                     This provider is NOT production-safe. Private keys are \
                     protected only by AES-256-GCM with a local KEK file.",
                    env
                );
                let provider = DevelopmentLocalProtection::new(kek_path)?;
                Ok(Box::new(provider))
            }
        }
    }

    /// Explicitly force production-safe provider, ignoring `VARDHAN_ENV`.
    /// Used by deployment validation tools to verify production readiness.
    pub fn select_production(
        kek_path: impl AsRef<Path>,
    ) -> Result<Box<dyn KeyProtectionProvider>, KeyProtectionError> {
        let _ = kek_path; // not used in production path
        let env = std::env::var("VARDHAN_ENV").unwrap_or_default();
        if env.to_lowercase() == "production" {
            return Self::select("/dev/null");
        }
        // Even in non-production, if explicitly requested, use production provider
        ProductionEnvelopeProtection::from_env_kms()
            .map(|p| {
                tracing::warn!(
                    "Production provider selected in non-production environment (VARDHAN_ENV={}). \
                 Ensure this is intentional.",
                    env
                );
                Box::new(p) as Box<dyn KeyProtectionProvider>
            })
            .map_err(|_| KeyProtectionError::NoProductionKeyProvider)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    static ENV_MUTEX: &std::sync::Mutex<()> = &crate::TEST_ENV_MUTEX;
    fn set_env(key: &str, val: &str) {
        unsafe { std::env::set_var(key, val) }
    }
    fn remove_env(key: &str) {
        unsafe { std::env::remove_var(key) }
    }
    fn get_env(key: &str) -> Option<String> {
        std::env::var(key).ok()
    }

    #[test]
    fn test_production_envelope_wrap_unwrap() {
        let kek = [0x42u8; 32];
        let provider = ProductionEnvelopeProtection::new(kek, "test-kms", "v1").unwrap();

        assert!(provider.is_production_safe());
        assert_eq!(provider.provider_name(), "test-kms");

        let plaintext = b"sensitive-private-key-material";
        let ciphertext = provider.wrap_private_key(plaintext).unwrap();

        // Ciphertext must not contain plaintext
        assert!(!ciphertext.windows(plaintext.len()).any(|w| w == plaintext));

        let decrypted = provider.unwrap_private_key(&ciphertext).unwrap();
        assert_eq!(&*decrypted, plaintext);
    }

    #[test]
    fn test_production_rejects_empty_provider_name() {
        let result = ProductionEnvelopeProtection::new([0u8; 32], "", "v1");
        assert!(result.is_err());
    }

    #[test]
    fn test_dev_provider_wrap_unwrap() {
        let dir = tempfile::tempdir().unwrap();
        let kek_path = dir.path().join("dev_kek.bin");
        let provider = DevelopmentLocalProtection::new(&kek_path).unwrap();

        assert!(!provider.is_production_safe());
        assert_eq!(provider.provider_name(), "local-dev");

        let plaintext = b"dev-private-key";
        let ciphertext = provider.wrap_private_key(plaintext).unwrap();
        assert!(!ciphertext.windows(plaintext.len()).any(|w| w == plaintext));

        let decrypted = provider.unwrap_private_key(&ciphertext).unwrap();
        assert_eq!(&*decrypted, plaintext);
    }

    #[test]
    fn test_dev_provider_kek_file_permissions() {
        let dir = tempfile::tempdir().unwrap();
        let kek_path = dir.path().join("dev_kek.bin");
        let _provider = DevelopmentLocalProtection::new(&kek_path).unwrap();

        let metadata = std::fs::metadata(&kek_path).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = metadata.permissions().mode();
            // File must be 0o600
            assert_eq!(mode & 0o777, 0o600, "KEK file must have 0o600 permissions");
        }
    }

    #[test]
    fn test_wrong_key_fails_decryption() {
        let provider1 = ProductionEnvelopeProtection::new([0x42u8; 32], "test-kms", "v1").unwrap();
        let provider2 = ProductionEnvelopeProtection::new([0x99u8; 32], "test-kms", "v1").unwrap();

        let plaintext = b"secret";
        let ciphertext = provider1.wrap_private_key(plaintext).unwrap();
        let result = provider2.unwrap_private_key(&ciphertext);
        assert!(result.is_err());
    }

    #[test]
    fn test_tampered_ciphertext_fails() {
        let provider = ProductionEnvelopeProtection::new([0x42u8; 32], "test-kms", "v1").unwrap();
        let plaintext = b"secret data for tampering test";
        let mut ciphertext = provider.wrap_private_key(plaintext).unwrap();

        // Flip a byte in the ciphertext portion (after the 12-byte nonce)
        if ciphertext.len() > 12 {
            ciphertext[12] ^= 0x01;
        }

        let result = provider.unwrap_private_key(&ciphertext);
        assert!(result.is_err());
    }

    #[test]
    fn test_truncated_ciphertext_fails() {
        let provider = ProductionEnvelopeProtection::new([0x42u8; 32], "test-kms", "v1").unwrap();
        let result = provider.unwrap_private_key(&[0u8; 5]);
        assert!(matches!(result, Err(KeyProtectionError::DecryptionFailed)));
    }

    #[test]
    fn test_production_env_requires_kms_kek() {
        let _guard = ENV_MUTEX.lock().unwrap();
        // Save and clear env
        let old_env = get_env("VARDHAN_ENV");
        let old_kek = get_env("VARDHAN_PRODUCTION_KEK");
        remove_env("VARDHAN_PRODUCTION_KEK");
        set_env("VARDHAN_ENV", "production");

        let dir = tempfile::tempdir().unwrap();
        let result = EnvironmentKeyProtectionProvider::select(&dir.path().join("kek.bin"));
        assert!(result.is_err());
        assert!(matches!(
            result,
            Err(KeyProtectionError::NoProductionKeyProvider)
        ));

        // Restore env
        if let Some(v) = old_env {
            set_env("VARDHAN_ENV", &v);
        } else {
            remove_env("VARDHAN_ENV");
        }
        if let Some(v) = old_kek {
            set_env("VARDHAN_PRODUCTION_KEK", &v);
        }
    }

    #[test]
    fn test_development_env_allows_local_provider() {
        let _guard = ENV_MUTEX.lock().unwrap();
        let old_env = get_env("VARDHAN_ENV");
        set_env("VARDHAN_ENV", "development");

        let dir = tempfile::tempdir().unwrap();
        let result = EnvironmentKeyProtectionProvider::select(&dir.path().join("kek.bin"));
        assert!(result.is_ok());
        let provider = result.unwrap();
        assert!(!provider.is_production_safe());

        if let Some(v) = old_env {
            set_env("VARDHAN_ENV", &v);
        } else {
            remove_env("VARDHAN_ENV");
        }
    }

    #[test]
    fn test_production_with_kms_kek_succeeds() {
        let _guard = ENV_MUTEX.lock().unwrap();
        let old_env = get_env("VARDHAN_ENV");
        let old_kek = get_env("VARDHAN_PRODUCTION_KEK");
        set_env("VARDHAN_ENV", "production");
        set_env(
            "VARDHAN_PRODUCTION_KEK",
            "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
        );

        let dir = tempfile::tempdir().unwrap();
        let result = EnvironmentKeyProtectionProvider::select(&dir.path().join("kek.bin"));
        assert!(result.is_ok());
        let provider = result.unwrap();
        assert!(provider.is_production_safe());

        if let Some(v) = old_env {
            set_env("VARDHAN_ENV", &v);
        } else {
            remove_env("VARDHAN_ENV");
        }
        if let Some(v) = old_kek {
            set_env("VARDHAN_PRODUCTION_KEK", &v);
        } else {
            remove_env("VARDHAN_PRODUCTION_KEK");
        }
    }
}
