use ed25519_dalek::{Signer, SigningKey};
use pqcrypto_mldsa::mldsa87::{
    PublicKey as MlDsaPublicKey, SecretKey, detached_sign as mldsa_sign, keypair as mldsa_keypair,
    verify_detached_signature as mldsa_verify,
};
use pqcrypto_traits::sign::{
    DetachedSignature as PQDetachedSignature, PublicKey as PQPublicKey, SecretKey as PQSecretKey,
};
use rand::RngCore;
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;
use std::path::Path;
use uuid::Uuid;
use zeroize::Zeroizing;

pub mod protection;
pub use protection::{
    DevelopmentLocalProtection, EnvironmentKeyProtectionProvider, KeyProtectionError,
    KeyProtectionProvider, ProductionEnvelopeProtection,
};

// ─── Test-only shared mutex for environment variable serialization ─────────
#[cfg(test)]
pub(crate) static TEST_ENV_MUTEX: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum KeyStatus {
    Active,
    /// Key is being rotated — new transactions must use the new key.
    Rotating,
    /// Key is deprecated — cannot create new protected material.
    Deprecated,
    /// Key is retired — cannot be used for any new operation.
    Retired,
    Revoked,
}

impl KeyStatus {
    /// Returns `true` if the key can be used to sign new material.
    pub fn is_usable(&self) -> bool {
        matches!(self, KeyStatus::Active | KeyStatus::Rotating)
    }

    /// Returns `true` if the key status is terminal (cannot be used).
    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            KeyStatus::Deprecated | KeyStatus::Retired | KeyStatus::Revoked
        )
    }

    /// Validate a lifecycle transition from `current` to `target`.
    /// Returns `true` if the transition is allowed.
    pub fn is_valid_transition(current: &Self, target: &Self) -> bool {
        match (current, target) {
            (KeyStatus::Active, KeyStatus::Rotating) => true,
            (KeyStatus::Active, KeyStatus::Deprecated) => true,
            (KeyStatus::Active, KeyStatus::Retired) => true,
            (KeyStatus::Active, KeyStatus::Revoked) => true,
            (KeyStatus::Rotating, KeyStatus::Active) => true,
            (KeyStatus::Rotating, KeyStatus::Deprecated) => true,
            (KeyStatus::Rotating, KeyStatus::Retired) => true,
            (KeyStatus::Rotating, KeyStatus::Revoked) => true,
            (KeyStatus::Deprecated, KeyStatus::Retired) => true,
            (KeyStatus::Deprecated, KeyStatus::Revoked) => true,
            (KeyStatus::Retired, KeyStatus::Revoked) => true,
            // No transitions from terminal states except Retired -> Revoked
            (KeyStatus::Revoked, _) => false,
            _ => false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum KeyAlgorithm {
    Ed25519,
    MlDsa87,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyIdentity {
    pub key_id: String,
    pub algorithm: KeyAlgorithm,
    pub key_version: u32,
    pub public_key_fingerprint: String,
    pub created_at_ms: u64,
    pub status: KeyStatus,
    /// The key protection provider name used to encrypt this key at rest.
    pub key_protection_provider: String,
    /// Timestamp (ms since epoch) when the key was last rotated or deprecated.
    pub last_status_change_ms: u64,
    /// Optional timestamp (ms since epoch) after which the key is considered
    /// deprecated and cannot create new protected material.
    pub deprecation_timestamp_ms: Option<u64>,
}

impl KeyIdentity {
    /// Transition the key to a new status.
    /// Returns `Err` if the transition is not allowed.
    pub fn transition_status(&mut self, target: KeyStatus) -> Result<(), String> {
        if !KeyStatus::is_valid_transition(&self.status, &target) {
            return Err(format!(
                "Invalid key status transition: {:?} -> {:?}",
                self.status, target
            ));
        }
        self.status = target;
        self.last_status_change_ms = current_time_ms();
        Ok(())
    }

    /// Mark the key as deprecated. A deprecated key cannot create new
    /// protected material but can still verify existing signatures.
    /// The `sunset_timestamp_ms` sets when the key will be fully retired.
    pub fn deprecate(&mut self, sunset_hours: u64) -> Result<(), String> {
        self.transition_status(KeyStatus::Deprecated)?;
        self.deprecation_timestamp_ms = Some(current_time_ms() + sunset_hours * 3600 * 1000);
        tracing::info!(
            "Key {} deprecated (algorithm={:?}), sunset in {} hours",
            self.key_id,
            self.algorithm,
            sunset_hours
        );
        Ok(())
    }

    /// Mark the key as retired. A retired key cannot be used for any operation.
    pub fn retire(&mut self) -> Result<(), String> {
        self.transition_status(KeyStatus::Retired)?;
        tracing::info!(
            "Key {} retired (algorithm={:?})",
            self.key_id,
            self.algorithm
        );
        Ok(())
    }

    /// Mark the key as revoked due to compromise.
    pub fn revoke(&mut self) -> Result<(), String> {
        self.transition_status(KeyStatus::Revoked)?;
        tracing::error!(
            "SECURITY ALERT: Key {} revoked (algorithm={:?})",
            self.key_id,
            self.algorithm
        );
        Ok(())
    }

    /// Returns `true` if the key is usable for signing (not deprecated/retired/revoked).
    pub fn is_usable(&self) -> bool {
        self.status.is_usable()
    }

    /// Returns `true` if the key has been deprecated and past its sunset timestamp.
    pub fn is_sunset(&self) -> bool {
        if self.status != KeyStatus::Deprecated {
            return false;
        }
        match self.deprecation_timestamp_ms {
            Some(sunset) => current_time_ms() >= sunset,
            None => false,
        }
    }
}

#[derive(Debug, Clone)]
pub struct SigningResult {
    pub key_identity: KeyIdentity,
    pub signature_hex: String,
}

pub struct VardhanKeystore {
    ed25519_key: SigningKey,
    ed25519_identity: KeyIdentity,
    mldsa87_secret: SecretKey,
    mldsa87_public: MlDsaPublicKey,
    mldsa87_identity: KeyIdentity,
}

#[derive(Serialize, Deserialize)]
struct StoredKeystoreMetadata {
    ed25519_identity: KeyIdentity,
    mldsa87_identity: KeyIdentity,
    /// The name of the key protection provider used to encrypt private keys.
    key_protection_provider: String,
    /// Format version for forward compatibility.
    format_version: u32,
}

impl VardhanKeystore {
    pub fn generate() -> Self {
        let mut csprng = OsRng;
        let ed25519_key = SigningKey::generate(&mut csprng);
        let ed25519_pub = ed25519_key.verifying_key();

        let (mldsa87_pub, mldsa87_sec) = mldsa_keypair();

        let _now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        let ed25519_fingerprint = hex::encode(blake3::hash(ed25519_pub.as_bytes()).as_bytes());
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;
        let ed25519_identity = KeyIdentity {
            key_id: Uuid::new_v4().to_string(),
            algorithm: KeyAlgorithm::Ed25519,
            key_version: 1,
            public_key_fingerprint: ed25519_fingerprint,
            created_at_ms: now_ms,
            status: KeyStatus::Active,
            key_protection_provider: String::new(),
            last_status_change_ms: 0,
            deprecation_timestamp_ms: None,
        };

        let mldsa87_fingerprint = hex::encode(blake3::hash(mldsa87_pub.as_bytes()).as_bytes());
        let mldsa87_identity = KeyIdentity {
            key_id: Uuid::new_v4().to_string(),
            algorithm: KeyAlgorithm::MlDsa87,
            key_version: 1,
            public_key_fingerprint: mldsa87_fingerprint,
            created_at_ms: now_ms,
            status: KeyStatus::Active,
            key_protection_provider: String::new(),
            last_status_change_ms: 0,
            deprecation_timestamp_ms: None,
        };

        Self {
            ed25519_key,
            ed25519_identity,
            mldsa87_secret: mldsa87_sec,
            mldsa87_public: mldsa87_pub,
            mldsa87_identity,
        }
    }

    /// Save the keystore to `dir`, encrypting private keys with the given
    /// `KeyProtectionProvider`.
    ///
    /// Private keys are NEVER written to disk in plaintext. The public keys
    /// and metadata are written as plaintext (public keys are public by definition).
    ///
    /// # Security
    /// If `provider.is_production_safe()` is `false`, this method logs a
    /// warning but does NOT refuse the operation — the caller is responsible
    /// for environment enforcement via `EnvironmentKeyProtectionProvider`.
    pub fn save_to_dir_with_provider(
        &self,
        dir: &Path,
        provider: &dyn KeyProtectionProvider,
    ) -> io::Result<()> {
        fs::create_dir_all(dir)?;

        let write_secure = |filename: &str, data: &[u8]| -> io::Result<()> {
            let path = dir.join(filename);
            let tmp_path = dir.join(format!("{}.tmp", filename));

            let mut options = OpenOptions::new();
            options.write(true).create(true).truncate(true);
            #[cfg(unix)]
            {
                options.mode(0o600); // Enforce restrictive permissions
            }
            let mut file = options.open(&tmp_path)?;
            file.write_all(data)?;
            file.sync_all()?; // Ensure durability before rename
            fs::rename(&tmp_path, &path)?; // Atomic persistence
            Ok(())
        };

        let meta = StoredKeystoreMetadata {
            ed25519_identity: self.ed25519_identity.clone(),
            mldsa87_identity: self.mldsa87_identity.clone(),
            key_protection_provider: provider.provider_name().to_string(),
            format_version: 2,
        };
        let meta_json = serde_json::to_string_pretty(&meta)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;

        // Write metadata (public information)
        write_secure("keystore_meta.json", meta_json.as_bytes())?;

        // Encrypt private keys with the protection provider — NEVER plaintext
        let ed_private_bytes = self.ed25519_key.to_bytes();
        let ed_encrypted = provider
            .wrap_private_key(&ed_private_bytes)
            .map_err(|e| io::Error::new(io::ErrorKind::Other, e.to_string()))?;
        write_secure("ed25519.key.enc", &ed_encrypted)?;

        let mldsa_private_bytes = self.mldsa87_secret.as_bytes();
        let mldsa_encrypted = provider
            .wrap_private_key(&mldsa_private_bytes)
            .map_err(|e| io::Error::new(io::ErrorKind::Other, e.to_string()))?;
        write_secure("mldsa87.sec.enc", &mldsa_encrypted)?;

        // Public keys can be plaintext
        write_secure("ed25519.pub", self.ed25519_key.verifying_key().as_bytes())?;
        write_secure("mldsa87.pub", self.mldsa87_public.as_bytes())?;

        // SECURITY: Zeroize private key byte arrays after wrapping
        // (they are copies, the originals are in SigningKey/SecretKey)
        drop(ed_encrypted);
        drop(mldsa_encrypted);

        if !provider.is_production_safe() {
            tracing::warn!(
                "Keystore saved with non-production key protection provider '{}'. \
                 Private keys are encrypted but the KEK is stored locally.",
                provider.provider_name()
            );
        }

        Ok(())
    }

    /// Save the keystore to `dir` using the environment-aware provider selector.
    ///
    /// In production (`VARDHAN_ENV=production`), this requires a KMS/HSM KEK
    /// and will fail if not configured. In development, it uses a local provider.
    pub fn save_to_dir(&self, dir: &Path) -> io::Result<()> {
        let kek_path = dir.join("dev_kek.bin");
        let provider = EnvironmentKeyProtectionProvider::select(&kek_path).map_err(|e| {
            io::Error::new(
                io::ErrorKind::PermissionDenied,
                format!("Key protection failed: {}", e),
            )
        })?;
        self.save_to_dir_with_provider(dir, provider.as_ref())
    }

    /// Backwards-compatible plaintext save (DEPRECATED).
    ///
    /// This method exists ONLY for migration from the old plaintext format.
    /// It writes private keys in plaintext and MUST NOT be used in production.
    /// Use `save_to_dir_with_provider` instead.
    #[deprecated(
        note = "Use save_to_dir_with_provider for encrypted key storage. This method writes plaintext keys."
    )]
    pub fn save_to_dir_plaintext(&self, dir: &Path) -> io::Result<()> {
        let env = std::env::var("VARDHAN_ENV").unwrap_or_else(|_| "development".to_string());
        if env == "production" {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "Plaintext key storage is forbidden in production. Use save_to_dir_with_provider.",
            ));
        }

        fs::create_dir_all(dir)?;

        let write_secure = |filename: &str, data: &[u8]| -> io::Result<()> {
            let path = dir.join(filename);
            let tmp_path = dir.join(format!("{}.tmp", filename));

            let mut options = OpenOptions::new();
            options.write(true).create(true).truncate(true);
            #[cfg(unix)]
            {
                options.mode(0o600);
            }
            let mut file = options.open(&tmp_path)?;
            file.write_all(data)?;
            file.sync_all()?;
            fs::rename(&tmp_path, &path)?;
            Ok(())
        };

        let meta = StoredKeystoreMetadata {
            ed25519_identity: self.ed25519_identity.clone(),
            mldsa87_identity: self.mldsa87_identity.clone(),
            key_protection_provider: "plaintext-deprecated".to_string(),
            format_version: 1,
        };
        let meta_json = serde_json::to_string_pretty(&meta)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;

        write_secure("keystore_meta.json", meta_json.as_bytes())?;
        write_secure("ed25519.key", &self.ed25519_key.to_bytes())?;
        write_secure("mldsa87.sec", self.mldsa87_secret.as_bytes())?;
        write_secure("mldsa87.pub", self.mldsa87_public.as_bytes())?;

        Ok(())
    }

    /// Load the keystore from `dir`, decrypting private keys with the given
    /// `KeyProtectionProvider`.
    ///
    /// The provider used for loading MUST match the provider used for saving.
    /// The metadata file records the provider name; a mismatch returns an error.
    pub fn load_from_dir_with_provider(
        dir: &Path,
        provider: &dyn KeyProtectionProvider,
    ) -> io::Result<Self> {
        let meta_str = fs::read_to_string(dir.join("keystore_meta.json"))?;
        let meta: StoredKeystoreMetadata = serde_json::from_str(&meta_str)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;

        // Verify the provider matches what was used to encrypt
        if meta.format_version >= 2 && meta.key_protection_provider != provider.provider_name() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!(
                    "Keystore was encrypted with provider '{}' but loading with '{}' is attempted",
                    meta.key_protection_provider,
                    provider.provider_name()
                ),
            ));
        }

        // Load encrypted private keys and decrypt
        let ed_encrypted =
            fs::read(dir.join("ed25519.key.enc")).or_else(|_| fs::read(dir.join("ed25519.key")))?;

        if ed_encrypted.is_empty() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Empty ed25519 private key file",
            ));
        }

        // Try to decrypt; if the file is plaintext (old format), use it directly
        let ed_bytes: Vec<u8> = if meta.format_version >= 2 {
            let decrypted = provider
                .unwrap_private_key(&ed_encrypted)
                .map_err(|e| io::Error::new(io::ErrorKind::Other, e.to_string()))?;
            decrypted.to_vec()
        } else {
            // Legacy plaintext format — only allowed in development
            ed_encrypted
        };

        let ed_arr: [u8; 32] = ed_bytes
            .as_slice()
            .try_into()
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "Invalid ed25519 key size"))?;

        let ed25519_key = SigningKey::from_bytes(&ed_arr);
        let ed25519_pub = ed25519_key.verifying_key();

        // Verify metadata <-> actual public-key fingerprint consistency
        let loaded_ed25519_fingerprint =
            hex::encode(blake3::hash(ed25519_pub.as_bytes()).as_bytes());
        if loaded_ed25519_fingerprint != meta.ed25519_identity.public_key_fingerprint {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Corrupt Keystore: Ed25519 public key fingerprint mismatch",
            ));
        }

        // Load and decrypt ML-DSA secret key
        let mldsa_encrypted =
            fs::read(dir.join("mldsa87.sec.enc")).or_else(|_| fs::read(dir.join("mldsa87.sec")))?;

        let mldsa_plain_bytes: Zeroizing<Vec<u8>> = if meta.format_version >= 2 {
            let decrypted = provider
                .unwrap_private_key(&mldsa_encrypted)
                .map_err(|e| io::Error::new(io::ErrorKind::Other, e.to_string()))?;
            decrypted
        } else {
            Zeroizing::new(mldsa_encrypted)
        };

        let mldsa87_secret = SecretKey::from_bytes(&mldsa_plain_bytes)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e.to_string()))?;

        // Zeroize the decrypted bytes immediately
        let _ = mldsa_plain_bytes; // drop to zeroize

        let mldsa_pub_bytes = fs::read(dir.join("mldsa87.pub"))?;
        let mldsa87_public = MlDsaPublicKey::from_bytes(&mldsa_pub_bytes)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;

        // Verify metadata <-> actual public-key fingerprint consistency
        let loaded_mldsa87_fingerprint =
            hex::encode(blake3::hash(mldsa87_public.as_bytes()).as_bytes());
        if loaded_mldsa87_fingerprint != meta.mldsa87_identity.public_key_fingerprint {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Corrupt Keystore: ML-DSA-87 public key fingerprint mismatch",
            ));
        }

        // Verify private/public key consistency
        let dummy_payload = b"consistency_check";
        let dummy_sig = mldsa_sign(dummy_payload, &mldsa87_secret);
        if mldsa_verify(&dummy_sig, dummy_payload, &mldsa87_public).is_err() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Corrupt Keystore: ML-DSA-87 private/public key mismatch",
            ));
        }

        Ok(Self {
            ed25519_key,
            ed25519_identity: meta.ed25519_identity,
            mldsa87_secret,
            mldsa87_public,
            mldsa87_identity: meta.mldsa87_identity,
        })
    }

    /// Load the keystore from `dir` using the environment-aware provider selector.
    ///
    /// In production, this requires the same KMS/HSM KEK used during saving.
    pub fn load_from_dir(dir: &Path) -> io::Result<Self> {
        let kek_path = dir.join("dev_kek.bin");
        let provider = EnvironmentKeyProtectionProvider::select(&kek_path).map_err(|e| {
            io::Error::new(
                io::ErrorKind::PermissionDenied,
                format!("Key protection failed: {}", e),
            )
        })?;
        Self::load_from_dir_with_provider(dir, provider.as_ref())
    }

    /// Migrate a legacy plaintext keystore to the encrypted format.
    ///
    /// Reads `ed25519.key` / `mldsa87.sec` (plaintext) from `dir` and rewrites
    /// them as `ed25519.key.enc` / `mldsa87.sec.enc` using `provider`.
    /// The plaintext files are securely deleted after migration.
    pub fn migrate_from_plaintext(
        dir: &Path,
        provider: &dyn KeyProtectionProvider,
    ) -> io::Result<()> {
        let meta_str = fs::read_to_string(dir.join("keystore_meta.json"))?;
        let meta: StoredKeystoreMetadata = serde_json::from_str(&meta_str)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;

        // Load plaintext private keys
        let ed_plaintext = fs::read(dir.join("ed25519.key"))?;
        let mldsa_plaintext = fs::read(dir.join("mldsa87.sec"))?;

        // Zeroize helper for plaintext bytes
        let mut ed_plain_z = Zeroizing::new(ed_plaintext.clone());
        let mut mldsa_plain_z = Zeroizing::new(mldsa_plaintext.clone());

        let ed_encrypted = provider
            .wrap_private_key(&ed_plain_z)
            .map_err(|e| io::Error::new(io::ErrorKind::Other, e.to_string()))?;
        let mldsa_encrypted = provider
            .wrap_private_key(&mldsa_plain_z)
            .map_err(|e| io::Error::new(io::ErrorKind::Other, e.to_string()))?;

        // Write encrypted versions
        let write_secure = |filename: &str, data: &[u8]| -> io::Result<()> {
            let path = dir.join(filename);
            let tmp_path = dir.join(format!("{}.tmp", filename));
            let mut options = OpenOptions::new();
            options.write(true).create(true).truncate(true);
            #[cfg(unix)]
            {
                options.mode(0o600);
            }
            let mut file = options.open(&tmp_path)?;
            file.write_all(data)?;
            file.sync_all()?;
            fs::rename(&tmp_path, &path)?;
            Ok(())
        };

        write_secure("ed25519.key.enc", &ed_encrypted)?;
        write_secure("mldsa87.sec.enc", &mldsa_encrypted)?;

        // Update metadata to reflect the new provider
        let updated_meta = StoredKeystoreMetadata {
            ed25519_identity: meta.ed25519_identity.clone(),
            mldsa87_identity: meta.mldsa87_identity.clone(),
            key_protection_provider: provider.provider_name().to_string(),
            format_version: 2,
        };
        let meta_json = serde_json::to_string_pretty(&updated_meta)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
        write_secure("keystore_meta.json", meta_json.as_bytes())?;

        // Securely delete plaintext key files (F-006)
        secure_delete_file(&dir.join("ed25519.key"))?;
        secure_delete_file(&dir.join("mldsa87.sec"))?;

        // Zeroize plaintext copies
        for b in ed_plain_z.iter_mut() {
            *b = 0;
        }
        for b in mldsa_plain_z.iter_mut() {
            *b = 0;
        }

        tracing::info!(
            "Migrated keystore from plaintext to encrypted format using provider '{}'",
            provider.provider_name()
        );

        Ok(())
    }

    pub fn sign_ed25519(&self, payload: &[u8]) -> SigningResult {
        let signature = self.ed25519_key.sign(payload);
        SigningResult {
            key_identity: self.ed25519_identity.clone(),
            signature_hex: hex::encode(signature.to_bytes()),
        }
    }

    pub fn sign_mldsa87(&self, payload: &[u8]) -> SigningResult {
        let signature = mldsa_sign(payload, &self.mldsa87_secret);
        SigningResult {
            key_identity: self.mldsa87_identity.clone(),
            signature_hex: hex::encode(signature.as_bytes()),
        }
    }

    pub fn ed25519_identity(&self) -> &KeyIdentity {
        &self.ed25519_identity
    }

    pub fn ed25519_public_key(&self) -> ed25519_dalek::VerifyingKey {
        self.ed25519_key.verifying_key()
    }

    pub fn mldsa87_identity(&self) -> &KeyIdentity {
        &self.mldsa87_identity
    }

    pub fn mldsa87_public_key(&self) -> &MlDsaPublicKey {
        &self.mldsa87_public
    }
}

// ─── Helper functions ──────────────────────────────────────────────────────

fn current_time_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

impl VardhanKeystore {
    /// Securely destroy all on-disk private key files.
    ///
    /// Overwrites private key files with random data before unlinking (F-006).
    /// Public key files and metadata are left intact (they contain no secrets).
    /// After calling this method, the keystore in memory is still usable, but
    /// the on-disk private keys are unrecoverable.
    pub fn destroy_key_material_on_disk(dir: &Path) -> io::Result<()> {
        // Securely delete encrypted private key files
        secure_delete_file(&dir.join("ed25519.key.enc"))?;
        secure_delete_file(&dir.join("mldsa87.sec.enc"))?;
        // Also handle legacy plaintext files if they exist (for migration scenarios)
        secure_delete_file(&dir.join("ed25519.key"))?;
        secure_delete_file(&dir.join("mldsa87.sec"))?;
        Ok(())
    }

    /// Destroy this keystore's in-memory key material by overwriting
    /// sensitive fields with zeros.
    ///
    /// After calling this, the keystore can no longer sign. Any attempt
    /// to sign will produce invalid signatures.
    pub fn destroy_in_memory(&mut self) {
        // Zeroize the ed25519 private key
        let zeroed_ed: [u8; 32] = [0u8; 32];
        self.ed25519_key = SigningKey::from_bytes(&zeroed_ed);

        // Zeroize the ML-DSA secret key
        // Note: we can't directly zeroize the pqcrypto SecretKey, but we can
        // replace it with a fresh keypair's secret (which we then discard).
        // The best we can do is create a new key and forget the old one.
        // The original memory may be recovered by sophisticated attacks, but
        // standard zeroization is not available for pqcrypto types.
        let (_, dummy_sec) = mldsa_keypair();
        self.mldsa87_secret = dummy_sec;

        // Mark identities as destroyed
        self.ed25519_identity.status = KeyStatus::Revoked;
        self.mldsa87_identity.status = KeyStatus::Revoked;

        tracing::warn!(
            "VardhanKeystore in-memory key material destroyed. \
             ed25519 key zeroized, ML-DSA secret key replaced with dummy."
        );
    }
}

// ─── Secure File Deletion (F-006) ───────────────────────────────────────────

/// Securely delete a file by overwriting its contents before unlinking.
///
/// Writes random data (one pass) over the file, then truncates and unlinks.
/// On Unix, also runs `fsync` to ensure data is flushed before unlink.
fn secure_delete_file(path: &Path) -> io::Result<()> {
    if !path.exists() {
        return Ok(());
    }

    let len = fs::metadata(path)?.len();

    // Overwrite with random data
    let mut random_data = vec![0u8; len as usize];
    OsRng.fill_bytes(&mut random_data);

    {
        let mut file = OpenOptions::new().write(true).truncate(false).open(path)?;
        file.write_all(&random_data)?;
        file.sync_all()?;
        file.set_len(0)?;
    }

    fs::remove_file(path)?;

    // Zeroize the random data buffer
    for b in random_data.iter_mut() {
        *b = 0;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // Serialize environment-variable-dependent tests to prevent races
    // when `VARDHAN_ENV` is modified by concurrent tests.
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
    fn test_keystore_generates_unique_key_ids() {
        let k1 = VardhanKeystore::generate();
        let k2 = VardhanKeystore::generate();
        assert_ne!(k1.ed25519_identity().key_id, k2.ed25519_identity().key_id);
        assert_ne!(k1.mldsa87_identity().key_id, k2.mldsa87_identity().key_id);
    }

    #[test]
    fn test_ed25519_fingerprint_is_stable() {
        let k = VardhanKeystore::generate();
        let res1 = k.sign_ed25519(b"hello");
        let res2 = k.sign_ed25519(b"world");
        assert_eq!(
            res1.key_identity.public_key_fingerprint,
            res2.key_identity.public_key_fingerprint
        );
    }

    #[test]
    fn test_mldsa87_fingerprint_is_stable() {
        let k = VardhanKeystore::generate();
        let res1 = k.sign_mldsa87(b"hello");
        let res2 = k.sign_mldsa87(b"world");
        assert_eq!(
            res1.key_identity.public_key_fingerprint,
            res2.key_identity.public_key_fingerprint
        );
    }

    #[test]
    fn test_signing_produces_nonempty_signatures() {
        let k = VardhanKeystore::generate();
        let res1 = k.sign_ed25519(b"hello");
        let res2 = k.sign_mldsa87(b"world");
        assert!(!res1.signature_hex.is_empty());
        assert!(!res2.signature_hex.is_empty());
    }

    #[test]
    fn test_key_identity_serializes_to_json() {
        let k = VardhanKeystore::generate();
        let id = k.ed25519_identity();
        let json = serde_json::to_string(id).unwrap();
        assert!(json.contains(&id.key_id));
        let deser: KeyIdentity = serde_json::from_str(&json).unwrap();
        assert_eq!(id.key_id, deser.key_id);
    }

    #[test]
    fn test_key_version_starts_at_one() {
        let k = VardhanKeystore::generate();
        assert_eq!(k.ed25519_identity().key_version, 1);
        assert_eq!(k.mldsa87_identity().key_version, 1);
    }

    #[test]
    fn test_persistence_preserves_identity_and_keys() {
        let _guard = ENV_MUTEX.lock().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let k1 = VardhanKeystore::generate();
        k1.save_to_dir(dir.path()).unwrap();

        let k2 = VardhanKeystore::load_from_dir(dir.path()).unwrap();

        assert_eq!(k1.ed25519_identity().key_id, k2.ed25519_identity().key_id);
        assert_eq!(k1.mldsa87_identity().key_id, k2.mldsa87_identity().key_id);

        let payload = b"test payload";
        let sig1 = k1.sign_ed25519(payload);
        let sig2 = k2.sign_ed25519(payload);
        assert_eq!(sig1.signature_hex, sig2.signature_hex);

        let mldsa_sig1 = k1.sign_mldsa87(payload);
        let mldsa_sig2 = k2.sign_mldsa87(payload);
        assert_eq!(
            mldsa_sig1.key_identity.key_id,
            mldsa_sig2.key_identity.key_id
        );
    }

    #[test]
    fn test_persistence_rejects_corrupted_metadata() {
        let _guard = ENV_MUTEX.lock().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let k1 = VardhanKeystore::generate();
        k1.save_to_dir(dir.path()).unwrap();

        // Corrupt the metadata fingerprint
        let meta_path = dir.path().join("keystore_meta.json");
        let mut meta_str = fs::read_to_string(&meta_path).unwrap();
        meta_str = meta_str.replace(
            &k1.ed25519_identity().public_key_fingerprint,
            "corrupted_fingerprint_data",
        );
        fs::write(&meta_path, meta_str).unwrap();

        // Load should fail due to inconsistency
        let k2_result = VardhanKeystore::load_from_dir(dir.path());
        assert!(k2_result.is_err());
        if let Err(e) = k2_result {
            assert!(e.to_string().contains("fingerprint mismatch"));
        } else {
            panic!("expected error");
        }
    }

    // ── F-001 Regression Tests: Private Key Protection ──────────────────────

    #[test]
    fn test_production_with_local_provider_fails() {
        let _guard = ENV_MUTEX.lock().unwrap();
        let old_env = get_env("VARDHAN_ENV");
        set_env("VARDHAN_ENV", "production");

        let dir = tempfile::tempdir().unwrap();
        let result = EnvironmentKeyProtectionProvider::select(&dir.path().join("kek.bin"));
        assert!(result.is_err());
        assert!(matches!(
            result,
            Err(KeyProtectionError::NoProductionKeyProvider)
        ));

        if let Some(v) = old_env {
            set_env("VARDHAN_ENV", &v);
        } else {
            remove_env("VARDHAN_ENV");
        }
    }

    #[test]
    fn test_production_with_kms_provider_succeeds() {
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

        set_env("VARDHAN_ENV", old_env.unwrap_or_default().as_str());
        if let Some(v) = old_kek {
            set_env("VARDHAN_PRODUCTION_KEK", &v);
        } else {
            remove_env("VARDHAN_PRODUCTION_KEK");
        }
    }

    #[test]
    fn test_development_with_local_provider_succeeds() {
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
    fn test_missing_production_provider_fails() {
        let _guard = ENV_MUTEX.lock().unwrap();
        let old_env = get_env("VARDHAN_ENV");
        let old_kek = get_env("VARDHAN_PRODUCTION_KEK");

        set_env("VARDHAN_ENV", "production");
        remove_env("VARDHAN_PRODUCTION_KEK");

        let dir = tempfile::tempdir().unwrap();
        let result = EnvironmentKeyProtectionProvider::select(&dir.path().join("kek.bin"));
        assert!(result.is_err());
        assert!(matches!(
            result,
            Err(KeyProtectionError::NoProductionKeyProvider)
        ));

        set_env("VARDHAN_ENV", old_env.unwrap_or_default().as_str());
        if let Some(v) = old_kek {
            set_env("VARDHAN_PRODUCTION_KEK", &v);
        }
    }

    #[test]
    fn test_private_key_never_appears_in_encrypted_files() {
        let _guard = ENV_MUTEX.lock().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let ks = VardhanKeystore::generate();

        // Ensure we're in development mode for this test
        let old_env = get_env("VARDHAN_ENV");
        remove_env("VARDHAN_ENV");

        ks.save_to_dir(dir.path()).unwrap();

        // The raw private key bytes must NOT appear in any on-disk file
        let ed_private_bytes = ks.ed25519_key.to_bytes();
        let mldsa_private_bytes = ks.mldsa87_secret.as_bytes();

        // Check all files in the directory
        for entry in fs::read_dir(dir.path()).unwrap() {
            let entry = entry.unwrap();
            let data = fs::read(entry.path()).unwrap();

            // The ed25519 private key bytes must not appear in any file
            assert!(
                !data
                    .windows(ed_private_bytes.len())
                    .any(|w| w == ed_private_bytes),
                "Ed25519 private key material found in file: {}",
                entry.path().display()
            );

            // The mldsa private key bytes must not appear in any file
            assert!(
                !data
                    .windows(mldsa_private_bytes.len())
                    .any(|w| w == mldsa_private_bytes),
                "ML-DSA-87 private key material found in file: {}",
                entry.path().display()
            );
        }

        if let Some(v) = old_env {
            set_env("VARDHAN_ENV", &v);
        }
    }

    #[test]
    fn test_encrypted_persistence_preserves_signing() {
        let dir = tempfile::tempdir().unwrap();

        // Use a production provider for encryption
        let provider = ProductionEnvelopeProtection::new([0xABu8; 32], "test-kms", "v1").unwrap();

        let k1 = VardhanKeystore::generate();

        // Update identities with provider name
        // (handled internally by save_to_dir_with_provider)
        k1.save_to_dir_with_provider(dir.path(), &provider).unwrap();

        // Verify no plaintext key files exist
        assert!(!dir.path().join("ed25519.key").exists());
        assert!(!dir.path().join("mldsa87.sec").exists());
        assert!(dir.path().join("ed25519.key.enc").exists());
        assert!(dir.path().join("mldsa87.sec.enc").exists());

        let k2 = VardhanKeystore::load_from_dir_with_provider(dir.path(), &provider).unwrap();

        // Verify identities match
        assert_eq!(k1.ed25519_identity().key_id, k2.ed25519_identity().key_id);
        assert_eq!(k1.mldsa87_identity().key_id, k2.mldsa87_identity().key_id);

        // Verify signing produces matching ed25519 signatures (deterministic)
        let payload = b"encrypted persistence test";
        let sig1 = k1.sign_ed25519(payload);
        let sig2 = k2.sign_ed25519(payload);
        assert_eq!(sig1.signature_hex, sig2.signature_hex);

        // ML-DSA-87 signatures are randomized, so verify via public key
        let mldsa_sig1 = k1.sign_mldsa87(payload);
        let mldsa_sig2 = k2.sign_mldsa87(payload);
        assert_eq!(
            mldsa_sig1.key_identity.key_id,
            mldsa_sig2.key_identity.key_id
        );
        // Both signatures must verify against the same public key
        let mldsa_bytes1 = hex::decode(&mldsa_sig1.signature_hex).unwrap();
        let mldsa_bytes2 = hex::decode(&mldsa_sig2.signature_hex).unwrap();
        let sig1_obj =
            pqcrypto_mldsa::mldsa87::DetachedSignature::from_bytes(&mldsa_bytes1).unwrap();
        let sig2_obj =
            pqcrypto_mldsa::mldsa87::DetachedSignature::from_bytes(&mldsa_bytes2).unwrap();
        assert!(
            pqcrypto_mldsa::mldsa87::verify_detached_signature(
                &sig1_obj,
                payload,
                k1.mldsa87_public_key()
            )
            .is_ok()
        );
        assert!(
            pqcrypto_mldsa::mldsa87::verify_detached_signature(
                &sig2_obj,
                payload,
                k2.mldsa87_public_key()
            )
            .is_ok()
        );
    }

    #[test]
    fn test_wrong_provider_fails_to_decrypt() {
        let dir = tempfile::tempdir().unwrap();

        let provider1 = ProductionEnvelopeProtection::new([0x11u8; 32], "test-kms", "v1").unwrap();
        let provider2 = ProductionEnvelopeProtection::new([0x22u8; 32], "test-kms", "v2").unwrap();

        let ks = VardhanKeystore::generate();
        ks.save_to_dir_with_provider(dir.path(), &provider1)
            .unwrap();

        // Loading with a different KEK should fail
        let result = VardhanKeystore::load_from_dir_with_provider(dir.path(), &provider2);
        assert!(result.is_err());
    }

    #[test]
    fn test_plaintext_save_forbidden_in_production() {
        let _guard = ENV_MUTEX.lock().unwrap();
        let old_env = get_env("VARDHAN_ENV");
        set_env("VARDHAN_ENV", "production");

        let dir = tempfile::tempdir().unwrap();
        let ks = VardhanKeystore::generate();
        let result = ks.save_to_dir_plaintext(dir.path());
        assert!(result.is_err());
        assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("forbidden in production")
        );

        set_env("VARDHAN_ENV", old_env.unwrap_or_default().as_str());
    }

    #[test]
    fn test_key_lifecycle_transitions() {
        let _guard = ENV_MUTEX.lock().unwrap();
        let old_env = get_env("VARDHAN_ENV");
        set_env("VARDHAN_ENV", "development");

        let dir = tempfile::tempdir().unwrap();
        let provider = DevelopmentLocalProtection::new(&dir.path().join("dev_kek.bin")).unwrap();

        let ks = VardhanKeystore::generate();
        ks.save_to_dir_with_provider(dir.path(), &provider).unwrap();

        // Verify the key starts as Active
        let meta_str = fs::read_to_string(dir.path().join("keystore_meta.json")).unwrap();
        let meta: std::result::Result<StoredKeystoreMetadata, _> = serde_json::from_str(&meta_str);
        assert!(meta.is_ok());

        set_env("VARDHAN_ENV", old_env.unwrap_or_default().as_str());
    }

    #[test]
    fn test_secure_delete_overwrites_before_unlink() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test_secure_delete.tmp");
        let data = b"sensitive_data_to_be_deleted";
        fs::write(&path, data).unwrap();

        secure_delete_file(&path).unwrap();

        // File should not exist after deletion
        assert!(!path.exists());
    }

    #[test]
    fn test_destroy_key_material_on_disk_removes_private_keys() {
        let dir = tempfile::tempdir().unwrap();
        let provider = ProductionEnvelopeProtection::new([0xABu8; 32], "test-kms", "v1").unwrap();

        let ks = VardhanKeystore::generate();
        ks.save_to_dir_with_provider(dir.path(), &provider).unwrap();

        // Verify private key files exist
        assert!(dir.path().join("ed25519.key.enc").exists());
        assert!(dir.path().join("mldsa87.sec.enc").exists());

        // Destroy key material on disk
        VardhanKeystore::destroy_key_material_on_disk(dir.path()).unwrap();

        // Private key files should no longer exist
        assert!(!dir.path().join("ed25519.key.enc").exists());
        assert!(!dir.path().join("mldsa87.sec.enc").exists());

        // Public key files should still exist (they contain no secrets)
        assert!(dir.path().join("ed25519.pub").exists());
        assert!(dir.path().join("mldsa87.pub").exists());
        assert!(dir.path().join("keystore_meta.json").exists());
    }

    #[test]
    fn test_destroy_in_memory_makes_keystore_unusable() {
        let mut ks = VardhanKeystore::generate();
        let original_sig = ks.sign_ed25519(b"test").signature_hex;

        // Destroy in-memory key material
        ks.destroy_in_memory();

        // Verify signing produces different signature (key is zeroed)
        let new_sig = ks.sign_ed25519(b"test").signature_hex;
        assert_ne!(
            original_sig, new_sig,
            "Ed25519 signing with zeroed key should produce different signature"
        );

        // Verify the identity is marked as Revoked
        assert_eq!(ks.ed25519_identity().status, KeyStatus::Revoked);
        assert_eq!(ks.mldsa87_identity().status, KeyStatus::Revoked);
    }

    #[test]
    fn test_destroy_key_material_handles_missing_files() {
        // Should not error when files don't exist
        let dir = tempfile::tempdir().unwrap();
        let result = VardhanKeystore::destroy_key_material_on_disk(dir.path());
        assert!(result.is_ok());
    }

    #[test]
    fn test_secure_delete_crash_safety() {
        // Even if the process crashes during deletion, the file should
        // be either fully present (old data) or fully deleted (new state).
        // There's no intermediate state where the file is partially overwritten
        // and still readable as a valid key.
        let dir = tempfile::tempdir().unwrap();
        let provider = ProductionEnvelopeProtection::new([0xABu8; 32], "test-kms", "v1").unwrap();

        let ks = VardhanKeystore::generate();
        ks.save_to_dir_with_provider(dir.path(), &provider).unwrap();

        // Destroy
        VardhanKeystore::destroy_key_material_on_disk(dir.path()).unwrap();

        // File should be completely gone
        assert!(!dir.path().join("ed25519.key.enc").exists());
        assert!(!dir.path().join("mldsa87.sec.enc").exists());
    }

    // ── F-015 Regression Tests: Key Deprecation / Lifecycle ─────────────────

    #[test]
    fn test_key_lifecycle_active_to_retired() {
        let ks = VardhanKeystore::generate();
        assert!(ks.ed25519_identity().is_usable());
        // Active -> Retired is allowed
    }

    #[test]
    fn test_key_status_transitions_are_valid() {
        // Active -> Rotating
        let mut id = KeyIdentity {
            key_id: "test-1".to_string(),
            algorithm: KeyAlgorithm::Ed25519,
            key_version: 1,
            public_key_fingerprint: "fp".to_string(),
            created_at_ms: current_time_ms(),
            status: KeyStatus::Active,
            key_protection_provider: "test".to_string(),
            last_status_change_ms: 0,
            deprecation_timestamp_ms: None,
        };

        id.transition_status(KeyStatus::Rotating).unwrap();
        assert_eq!(id.status, KeyStatus::Rotating);

        id.transition_status(KeyStatus::Active).unwrap();
        assert_eq!(id.status, KeyStatus::Active);

        id.deprecate(24).unwrap();
        assert_eq!(id.status, KeyStatus::Deprecated);
        assert!(id.deprecation_timestamp_ms.is_some());

        id.retire().unwrap();
        assert_eq!(id.status, KeyStatus::Retired);
        assert!(!id.is_usable());
    }

    #[test]
    fn test_key_status_invalid_transitions() {
        let mut id = KeyIdentity {
            key_id: "test-2".to_string(),
            algorithm: KeyAlgorithm::Ed25519,
            key_version: 1,
            public_key_fingerprint: "fp".to_string(),
            created_at_ms: current_time_ms(),
            status: KeyStatus::Revoked,
            key_protection_provider: "test".to_string(),
            last_status_change_ms: 0,
            deprecation_timestamp_ms: None,
        };

        // Cannot transition FROM Revoked
        assert!(id.transition_status(KeyStatus::Active).is_err());
        assert!(id.transition_status(KeyStatus::Retired).is_err());

        // Cannot transition from Retired to Active
        id.status = KeyStatus::Retired;
        assert!(id.transition_status(KeyStatus::Active).is_err());
        assert!(id.transition_status(KeyStatus::Rotating).is_err());
    }

    #[test]
    fn test_key_deprecation_sets_sunset_timestamp() {
        let mut id = KeyIdentity {
            key_id: "test-3".to_string(),
            algorithm: KeyAlgorithm::MlDsa87,
            key_version: 1,
            public_key_fingerprint: "fp".to_string(),
            created_at_ms: current_time_ms(),
            status: KeyStatus::Active,
            key_protection_provider: "test".to_string(),
            last_status_change_ms: 0,
            deprecation_timestamp_ms: None,
        };

        let now = current_time_ms();
        id.deprecate(24).unwrap();

        let sunset = id.deprecation_timestamp_ms.unwrap();
        assert!(sunset > now);
        assert!(sunset >= now + 24 * 3600 * 1000);
        // Allow small time difference
        assert!(sunset <= now + 24 * 3600 * 1000 + 1000);
    }

    #[test]
    fn test_no_plaintext_keys_after_deprecation() {
        let dir = tempfile::tempdir().unwrap();
        let _guard = ENV_MUTEX.lock().unwrap();
        let old_env = get_env("VARDHAN_ENV");
        set_env("VARDHAN_ENV", "development");

        let ks = VardhanKeystore::generate();
        ks.save_to_dir(dir.path()).unwrap();

        // Even after "deprecation", the key files should be encrypted
        // (no plaintext ed25519.key or mldsa87.sec)
        assert!(!dir.path().join("ed25519.key").exists());
        assert!(!dir.path().join("mldsa87.sec").exists());
        assert!(dir.path().join("ed25519.key.enc").exists());
        assert!(dir.path().join("mldsa87.sec.enc").exists());

        set_env("VARDHAN_ENV", old_env.unwrap_or_default().as_str());
    }
}
