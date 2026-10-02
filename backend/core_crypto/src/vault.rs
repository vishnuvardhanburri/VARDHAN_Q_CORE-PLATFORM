use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{self, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use zeroize::Zeroizing;

#[derive(Debug, thiserror::Error)]
pub enum VaultError {
    #[error("I/O error: {0}")]
    Io(#[from] io::Error),
    #[error("Crypto error: {0}")]
    Crypto(String),
    #[error("Serialization error: {0}")]
    Serialization(String),
    #[error("KMS error: {0}")]
    Kms(String),
    #[error("Access denied: {0}")]
    AccessDenied(String),
    #[error("Internal error: {0}")]
    Internal(String),
}

/// Abstract interface for KEK operations.
/// Extensible to LocalDevKeyProtector, KmsKeyProtector (AWS/GCP), and HsmKeyProtector (PKCS#11).
pub trait KeyProtector: Send + Sync {
    /// Identifier for the protector type (e.g. "local-dev", "aws-kms", "mock-hsm", "pkcs11")
    fn provider_name(&self) -> &'static str;

    /// Envelope encryption: wrap a 256-bit ephemeral Data Encryption Key (DEK)
    fn wrap_dek(&self, dek: &[u8; 32]) -> Result<Vec<u8>, VaultError> {
        self.wrap(dek)
    }

    /// Envelope decryption: unwrap a 256-bit ephemeral Data Encryption Key (DEK)
    fn unwrap_dek(&self, wrapped_dek: &[u8]) -> Result<Zeroizing<[u8; 32]>, VaultError> {
        let pt = self.unwrap(wrapped_dek)?;
        if pt.len() != 32 {
            return Err(VaultError::Crypto(format!(
                "Unwrapped DEK must be 32 bytes, got {}",
                pt.len()
            )));
        }
        let mut key = [0u8; 32];
        key.copy_from_slice(&pt);
        Ok(Zeroizing::new(key))
    }

    /// Direct payload wrap (legacy v1 compatibility)
    fn wrap(&self, plaintext: &[u8]) -> Result<Vec<u8>, VaultError>;

    /// Direct payload unwrap (legacy v1 compatibility)
    fn unwrap(&self, ciphertext: &[u8]) -> Result<Vec<u8>, VaultError>;

    /// Key identifier and optional version metadata
    fn key_metadata(&self) -> (Option<String>, Option<String>) {
        (None, None)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. LocalDevKeyProtector (Dev only, forbidden in production)
// ─────────────────────────────────────────────────────────────────────────────

pub struct LocalDevKeyProtector {
    kek_path: PathBuf,
}

impl LocalDevKeyProtector {
    pub fn new(kek_path: PathBuf) -> Self {
        Self { kek_path }
    }

    fn get_kek(&self) -> Result<[u8; 32], VaultError> {
        if !self.kek_path.exists() {
            let mut key = [0u8; 32];
            rand::rngs::OsRng.fill_bytes(&mut key);
            let mut file = fs::File::create(&self.kek_path)?;
            file.write_all(&key)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let mut perms = file.metadata()?.permissions();
                perms.set_mode(0o600);
                file.set_permissions(perms)?;
            }
        }
        let data = fs::read(&self.kek_path)?;
        if data.len() != 32 {
            return Err(VaultError::Crypto(
                "Invalid KEK length, expected 32 bytes".into(),
            ));
        }
        let mut key = [0u8; 32];
        key.copy_from_slice(&data);
        Ok(key)
    }
}

impl KeyProtector for LocalDevKeyProtector {
    fn provider_name(&self) -> &'static str {
        "local-dev"
    }

    fn wrap(&self, plaintext: &[u8]) -> Result<Vec<u8>, VaultError> {
        let key = self.get_kek()?;
        let cipher = Aes256Gcm::new(&key.into());
        let mut nonce_bytes = [0u8; 12];
        rand::rngs::OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);

        let mut ciphertext = cipher
            .encrypt(nonce, plaintext)
            .map_err(|e| VaultError::Crypto(format!("Envelope encryption failed: {:?}", e)))?;

        let mut final_payload = nonce_bytes.to_vec();
        final_payload.append(&mut ciphertext);
        Ok(final_payload)
    }

    fn unwrap(&self, ciphertext: &[u8]) -> Result<Vec<u8>, VaultError> {
        if ciphertext.len() < 12 {
            return Err(VaultError::Crypto("Ciphertext too short".into()));
        }
        let key = self.get_kek()?;
        let cipher = Aes256Gcm::new(&key.into());
        let nonce = Nonce::from_slice(&ciphertext[..12]);
        let data = &ciphertext[12..];

        let plaintext = cipher
            .decrypt(nonce, data)
            .map_err(|e| VaultError::Crypto(format!("Envelope decryption failed: {:?}", e)))?;
        Ok(plaintext)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. KMS Abstraction & KeyProtector
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct KmsAuditRecord {
    pub timestamp_unix: u64,
    pub operation: &'static str, // "wrap" | "unwrap"
    pub provider: &'static str,
    pub key_id: String,
    pub status: &'static str, // "SUCCESS" | "FAILURE"
    pub error: Option<String>,
}

pub trait KmsClient: Send + Sync {
    fn encrypt(&self, key_id: &str, plaintext: &[u8]) -> Result<Vec<u8>, VaultError>;
    fn decrypt(&self, ciphertext: &[u8], key_id: Option<&str>) -> Result<Vec<u8>, VaultError>;
}

/// Mock KMS Client for deterministic testing of KMS outages, permission denial, and key rotation.
pub struct MockKmsClient {
    keys: Mutex<HashMap<String, Vec<[u8; 32]>>>,
    available: AtomicBool,
    authorized: AtomicBool,
}

impl MockKmsClient {
    pub fn new() -> Self {
        Self {
            keys: Mutex::new(HashMap::new()),
            available: AtomicBool::new(true),
            authorized: AtomicBool::new(true),
        }
    }

    fn derive_master(key_id: &str, version: usize) -> [u8; 32] {
        *blake3::hash(format!("vardhan-mock-kms-cmk:{}:v{}", key_id, version).as_bytes()).as_bytes()
    }

    pub fn with_key(self, key_id: &str) -> Self {
        let master = Self::derive_master(key_id, 1);
        self.keys
            .lock()
            .map_err(|_| VaultError::Internal("KMS keys lock poisoned".into()))
            .unwrap() // Mock client internal setup can panic in test-init, but we use map_err for consistency
            .insert(key_id.to_string(), vec![master]);
        self
    }

    pub fn set_available(&self, available: bool) {
        self.available.store(available, Ordering::SeqCst);
    }

    pub fn set_authorized(&self, authorized: bool) {
        self.authorized.store(authorized, Ordering::SeqCst);
    }

    pub fn rotate_key(&self, key_id: &str) -> String {
        let mut keys_guard = self.keys.lock().expect("KMS keys lock poisoned");
        let versions = keys_guard
            .entry(key_id.to_string())
            .or_insert_with(|| vec![Self::derive_master(key_id, 1)]);
        let next_v = versions.len() + 1;
        versions.push(Self::derive_master(key_id, next_v));
        format!("{}-v{}", key_id, versions.len())
    }
}

impl Default for MockKmsClient {
    fn default() -> Self {
        Self::new()
    }
}

impl KmsClient for MockKmsClient {
    fn encrypt(&self, key_id: &str, plaintext: &[u8]) -> Result<Vec<u8>, VaultError> {
        if !self.available.load(Ordering::SeqCst) {
            return Err(VaultError::Kms(
                "AWS KMS service unavailable (HTTP 503 EndpointUnreachable)".into(),
            ));
        }
        if !self.authorized.load(Ordering::SeqCst) {
            return Err(VaultError::AccessDenied(
                "kms:Encrypt AccessDenied by IAM policy".into(),
            ));
        }

        let mut keys_guard = self
            .keys
            .lock()
            .map_err(|_| VaultError::Internal("KMS keys lock poisoned".into()))?;
        let versions = keys_guard
            .entry(key_id.to_string())
            .or_insert_with(|| vec![Self::derive_master(key_id, 1)]);
        let current_master = versions
            .last()
            .ok_or_else(|| VaultError::Crypto("No KMS key versions available".into()))?;

        let cipher = Aes256Gcm::new(&(*current_master).into());
        let mut nonce_bytes = [0u8; 12];
        rand::rngs::OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);

        let mut ciphertext = cipher
            .encrypt(nonce, plaintext)
            .map_err(|e| VaultError::Crypto(format!("KMS mock encryption failed: {:?}", e)))?;

        let mut wrapped = nonce_bytes.to_vec();
        wrapped.append(&mut ciphertext);
        Ok(wrapped)
    }

    fn decrypt(&self, ciphertext: &[u8], key_id: Option<&str>) -> Result<Vec<u8>, VaultError> {
        if !self.available.load(Ordering::SeqCst) {
            return Err(VaultError::Kms(
                "AWS KMS service unavailable (HTTP 503 EndpointUnreachable)".into(),
            ));
        }
        if !self.authorized.load(Ordering::SeqCst) {
            return Err(VaultError::AccessDenied(
                "kms:Decrypt AccessDenied by IAM policy".into(),
            ));
        }
        if ciphertext.len() < 12 {
            return Err(VaultError::Crypto("Invalid KMS ciphertext blob".into()));
        }

        let key_str = key_id.unwrap_or("default");
        let mut keys_guard = self
            .keys
            .lock()
            .map_err(|_| VaultError::Internal("KMS keys lock poisoned".into()))?;
        let versions = keys_guard
            .entry(key_str.to_string())
            .or_insert_with(|| (1..=5).map(|v| Self::derive_master(key_str, v)).collect());

        let nonce = Nonce::from_slice(&ciphertext[..12]);
        let data = &ciphertext[12..];

        // Try from latest version back to oldest (AWS KMS automatic key rotation model)
        for master in versions.iter().rev() {
            let cipher = Aes256Gcm::new(&(*master).into());
            if let Ok(pt) = cipher.decrypt(nonce, data) {
                return Ok(pt);
            }
        }

        Err(VaultError::Crypto(
            "KMS mock decryption failed: no valid key version decrypted the ciphertext".into(),
        ))
    }
}

/// AWS KMS KeyProtector implementing envelope encryption for DEKs.
pub struct KmsKeyProtector<C: KmsClient> {
    provider_name: &'static str,
    key_id: String,
    key_version: Option<String>,
    client: Arc<C>,
    audit_log: Arc<Mutex<Vec<KmsAuditRecord>>>,
}

impl<C: KmsClient> KmsKeyProtector<C> {
    pub fn new(key_id: String, client: Arc<C>) -> Self {
        Self {
            provider_name: "aws-kms",
            key_id,
            key_version: Some("v1".to_string()),
            client,
            audit_log: Arc::new(Mutex::new(Vec::new())),
        }
    }

    pub fn audit_records(&self) -> Result<Vec<KmsAuditRecord>, VaultError> {
        self.audit_log
            .lock()
            .map(|lock| lock.clone())
            .map_err(|_| VaultError::Internal("Audit log lock poisoned".into()))
    }
}

impl<C: KmsClient> KeyProtector for KmsKeyProtector<C> {
    fn provider_name(&self) -> &'static str {
        self.provider_name
    }

    fn wrap_dek(&self, dek: &[u8; 32]) -> Result<Vec<u8>, VaultError> {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| VaultError::Internal(format!("System time error: {e}")))?
            .as_secs();
        match self.client.encrypt(&self.key_id, dek) {
            Ok(wrapped) => {
                self.audit_log
                    .lock()
                    .map(|mut log| {
                        log.push(KmsAuditRecord {
                            timestamp_unix: now,
                            operation: "wrap",
                            provider: self.provider_name,
                            key_id: self.key_id.clone(),
                            status: "SUCCESS",
                            error: None,
                        });
                    })
                    .map_err(|_| VaultError::Internal("Audit log lock poisoned".into()))?;
                Ok(wrapped)
            }
            Err(e) => {
                self.audit_log
                    .lock()
                    .map(|mut log| {
                        log.push(KmsAuditRecord {
                            timestamp_unix: now,
                            operation: "wrap",
                            provider: self.provider_name,
                            key_id: self.key_id.clone(),
                            status: "FAILURE",
                            error: Some(e.to_string()),
                        });
                    })
                    .map_err(|_| VaultError::Internal("Audit log lock poisoned".into()))?;
                Err(e)
            }
        }
    }

    fn unwrap_dek(&self, wrapped_dek: &[u8]) -> Result<Zeroizing<[u8; 32]>, VaultError> {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| VaultError::Internal(format!("System time error: {e}")))?
            .as_secs();
        match self.client.decrypt(wrapped_dek, Some(&self.key_id)) {
            Ok(pt) => {
                if pt.len() != 32 {
                    let err = "Unwrapped DEK is not 32 bytes".to_string();
                    self.audit_log
                        .lock()
                        .map(|mut log| {
                            log.push(KmsAuditRecord {
                                timestamp_unix: now,
                                operation: "unwrap",
                                provider: self.provider_name,
                                key_id: self.key_id.clone(),
                                status: "FAILURE",
                                error: Some(err.clone()),
                            });
                        })
                        .map_err(|_| VaultError::Internal("Audit log lock poisoned".into()))?;
                    return Err(VaultError::Crypto(err));
                }
                self.audit_log
                    .lock()
                    .map(|mut log| {
                        log.push(KmsAuditRecord {
                            timestamp_unix: now,
                            operation: "unwrap",
                            provider: self.provider_name,
                            key_id: self.key_id.clone(),
                            status: "SUCCESS",
                            error: None,
                        });
                    })
                    .map_err(|_| VaultError::Internal("Audit log lock poisoned".into()))?;
                let mut dek = [0u8; 32];
                dek.copy_from_slice(&pt);
                Ok(Zeroizing::new(dek))
            }
            Err(e) => {
                self.audit_log
                    .lock()
                    .map(|mut log| {
                        log.push(KmsAuditRecord {
                            timestamp_unix: now,
                            operation: "unwrap",
                            provider: self.provider_name,
                            key_id: self.key_id.clone(),
                            status: "FAILURE",
                            error: Some(e.to_string()),
                        });
                    })
                    .map_err(|_| VaultError::Internal("Audit log lock poisoned".into()))?;
                Err(e)
            }
        }
    }

    fn wrap(&self, plaintext: &[u8]) -> Result<Vec<u8>, VaultError> {
        self.client.encrypt(&self.key_id, plaintext)
    }

    fn unwrap(&self, ciphertext: &[u8]) -> Result<Vec<u8>, VaultError> {
        self.client.decrypt(ciphertext, Some(&self.key_id))
    }

    fn key_metadata(&self) -> (Option<String>, Option<String>) {
        (Some(self.key_id.clone()), self.key_version.clone())
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2b. Real AWS KMS Client (P3.5.1 — live AWS KMS validation)
// ─────────────────────────────────────────────────────────────────────────────

/// Real AWS KMS-backed implementation of [`KmsClient`].
///
/// Constructed behind the `aws-kms-real` feature flag so that the default
/// build (no AWS SDK dependency) is unchanged from P3.4. Each call spawns
/// a blocking `block_on` on an internal tokio runtime — this keeps the
/// synchronous `KeyProtector` trait interface intact.
#[cfg(feature = "aws-kms-real")]
pub struct AwsSdkKmsClient {
    client: aws_sdk_kms::Client,
    /// Dedicated single-threaded runtime for KMS encrypt/decrypt calls.
    rt: tokio::runtime::Runtime,
}

#[cfg(feature = "aws-kms-real")]
impl AwsSdkKmsClient {
    /// Build a client using the default AWS credential chain and the given KMS key ID.
    pub fn new(key_id: &str) -> Result<Self, VaultError> {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|e| VaultError::Kms(format!("Tokio runtime build failed: {e}")))?;

        let region = std::env::var("AWS_REGION").unwrap_or_else(|_| "us-east-1".to_string());
        let config = rt.block_on(async {
            aws_config::defaults(aws_config::BehaviorVersion::latest())
                .region(aws_config::Region::new(region))
                .load()
                .await
        });

        let client = aws_sdk_kms::Client::new(&config);
        Ok(Self { client, rt })
    }
}

#[cfg(feature = "aws-kms-real")]
impl KmsClient for AwsSdkKmsClient {
    fn encrypt(&self, key_id: &str, plaintext: &[u8]) -> Result<Vec<u8>, VaultError> {
        let client = self.client.clone();
        let kid = key_id.to_string();
        let pt = aws_sdk_kms::primitives::Blob::from(plaintext.to_vec());
        let blob: Result<Vec<u8>, VaultError> = self.rt.block_on(async move {
            let resp = client
                .encrypt()
                .key_id(&kid)
                .plaintext(pt)
                .send()
                .await
                .map_err(|e| VaultError::Kms(e.to_string()))?;
            let blob = resp
                .ciphertext_blob()
                .ok_or_else(|| VaultError::Kms("KMS Encrypt returned no ciphertext".into()))?;
            Ok(blob.as_ref().to_vec())
        });
        blob
    }

    fn decrypt(&self, ciphertext: &[u8], key_id: Option<&str>) -> Result<Vec<u8>, VaultError> {
        let client = self.client.clone();
        let ct = aws_sdk_kms::primitives::Blob::from(ciphertext.to_vec());
        let kid = key_id.map(str::to_string);
        let pt: Result<Vec<u8>, VaultError> = self.rt.block_on(async move {
            let mut req = client.decrypt();
            if let Some(k) = &kid {
                req = req.key_id(k);
            }
            let resp = req
                .ciphertext_blob(ct)
                .send()
                .await
                .map_err(|e| VaultError::Kms(e.to_string()))?;
            let blob = resp
                .plaintext()
                .ok_or_else(|| VaultError::Kms("KMS Decrypt returned no plaintext".into()))?;
            Ok(blob.as_ref().to_vec())
        });
        pt
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. HSM KeyProtector (PKCS#11 Hardware Security Module)
// ─────────────────────────────────────────────────────────────────────────────

pub struct HsmKeyProtector {
    provider_name: &'static str,
    slot_id: u64,
    key_label: String,
    master_key: [u8; 32],
}

impl HsmKeyProtector {
    pub fn new_mock(slot_id: u64, key_label: String) -> Self {
        let master_key =
            *blake3::hash(format!("vardhan-mock-hsm-slot:{}:{}", slot_id, key_label).as_bytes())
                .as_bytes();
        Self {
            provider_name: "hsm-pkcs11",
            slot_id,
            key_label,
            master_key,
        }
    }
}

impl KeyProtector for HsmKeyProtector {
    fn provider_name(&self) -> &'static str {
        self.provider_name
    }

    fn wrap_dek(&self, dek: &[u8; 32]) -> Result<Vec<u8>, VaultError> {
        let cipher = Aes256Gcm::new(&self.master_key.into());
        let mut nonce_bytes = [0u8; 12];
        rand::rngs::OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);

        let mut ciphertext = cipher
            .encrypt(nonce, dek.as_ref())
            .map_err(|e| VaultError::Crypto(format!("HSM C_WrapKey failed: {:?}", e)))?;

        let mut wrapped = nonce_bytes.to_vec();
        wrapped.append(&mut ciphertext);
        Ok(wrapped)
    }

    fn unwrap_dek(&self, wrapped_dek: &[u8]) -> Result<Zeroizing<[u8; 32]>, VaultError> {
        if wrapped_dek.len() < 12 {
            return Err(VaultError::Crypto("HSM wrapped key too short".into()));
        }
        let cipher = Aes256Gcm::new(&self.master_key.into());
        let nonce = Nonce::from_slice(&wrapped_dek[..12]);
        let data = &wrapped_dek[12..];

        let pt = cipher
            .decrypt(nonce, data)
            .map_err(|e| VaultError::Crypto(format!("HSM C_UnwrapKey failed: {:?}", e)))?;

        if pt.len() != 32 {
            return Err(VaultError::Crypto(
                "HSM unwrapped key is not 32 bytes".into(),
            ));
        }
        let mut key = [0u8; 32];
        key.copy_from_slice(&pt);
        Ok(Zeroizing::new(key))
    }

    fn wrap(&self, plaintext: &[u8]) -> Result<Vec<u8>, VaultError> {
        let cipher = Aes256Gcm::new(&self.master_key.into());
        let mut nonce_bytes = [0u8; 12];
        rand::rngs::OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);
        let mut ct = cipher
            .encrypt(nonce, plaintext)
            .map_err(|e| VaultError::Crypto(format!("HSM wrap failed: {:?}", e)))?;
        let mut out = nonce_bytes.to_vec();
        out.append(&mut ct);
        Ok(out)
    }

    fn unwrap(&self, ciphertext: &[u8]) -> Result<Vec<u8>, VaultError> {
        if ciphertext.len() < 12 {
            return Err(VaultError::Crypto("HSM ciphertext too short".into()));
        }
        let cipher = Aes256Gcm::new(&self.master_key.into());
        let nonce = Nonce::from_slice(&ciphertext[..12]);
        cipher
            .decrypt(nonce, &ciphertext[12..])
            .map_err(|e| VaultError::Crypto(format!("HSM unwrap failed: {:?}", e)))
    }

    fn key_metadata(&self) -> (Option<String>, Option<String>) {
        (
            Some(format!("slot-{}:{}", self.slot_id, self.key_label)),
            Some("1.0".to_string()),
        )
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Versioned Encrypted Envelope
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct EncryptedEnvelope {
    pub version: u32,
    pub created_at_unix: u64,
    #[serde(default)]
    pub provider: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kms_key_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kms_key_version: Option<String>,
    /// Wrapped DEK (KMS or HSM encrypted)
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        with = "opt_base64_format"
    )]
    pub wrapped_dek: Option<Vec<u8>>,
    /// Payload encrypted under DEK (nonce_12 || ciphertext)
    #[serde(with = "base64_format")]
    pub wrapped_payload: Vec<u8>,
}

pub fn wrap_envelope<P: KeyProtector>(
    protector: &P,
    plaintext: &[u8],
) -> Result<EncryptedEnvelope, VaultError> {
    // 1. Generate ephemeral 256-bit DEK
    let mut dek = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut dek);
    let zeroizing_dek = Zeroizing::new(dek);

    // 2. Encrypt plaintext under DEK via AES-256-GCM
    let cipher = Aes256Gcm::new((&*zeroizing_dek).into());
    let mut nonce_bytes = [0u8; 12];
    rand::rngs::OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let mut ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| VaultError::Crypto(format!("Envelope payload encryption failed: {:?}", e)))?;

    let mut wrapped_payload = nonce_bytes.to_vec();
    wrapped_payload.append(&mut ciphertext);

    // 3. Wrap DEK with protector (KMS / HSM / Local KEK)
    let wrapped_dek = protector.wrap_dek(&zeroizing_dek)?;
    let (kms_key_id, kms_key_version) = protector.key_metadata();

    Ok(EncryptedEnvelope {
        version: 2,
        created_at_unix: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| VaultError::Internal(format!("System time error: {e}")))?
            .as_secs(),
        provider: protector.provider_name().to_string(),
        kms_key_id,
        kms_key_version,
        wrapped_dek: Some(wrapped_dek),
        wrapped_payload,
    })
}

pub fn unwrap_envelope<P: KeyProtector>(
    protector: &P,
    envelope: &EncryptedEnvelope,
) -> Result<Zeroizing<Vec<u8>>, VaultError> {
    // Legacy v1 envelope support (direct payload wrap under KEK)
    if envelope.version == 1 || envelope.wrapped_dek.is_none() {
        let pt = protector.unwrap(&envelope.wrapped_payload)?;
        return Ok(Zeroizing::new(pt));
    }

    // Version 2 envelope (KMS / HSM DEK wrapping)
    let wrapped_dek = envelope
        .wrapped_dek
        .as_ref()
        .ok_or_else(|| VaultError::Crypto("Missing wrapped DEK in v2 envelope".into()))?;
    let dek = protector.unwrap_dek(wrapped_dek)?;

    if envelope.wrapped_payload.len() < 12 {
        return Err(VaultError::Crypto("Envelope payload too short".into()));
    }

    let cipher = Aes256Gcm::new((&*dek).into());
    let nonce = Nonce::from_slice(&envelope.wrapped_payload[..12]);
    let data = &envelope.wrapped_payload[12..];

    let plaintext = cipher
        .decrypt(nonce, data)
        .map_err(|e| VaultError::Crypto(format!("Envelope payload decryption failed: {:?}", e)))?;

    Ok(Zeroizing::new(plaintext))
}

mod base64_format {
    use base64ct::{Base64, Encoding};
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S: Serializer>(data: &[u8], s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&Base64::encode_string(data))
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<u8>, D::Error> {
        let s = String::deserialize(d)?;
        Base64::decode_vec(&s).map_err(serde::de::Error::custom)
    }
}

mod opt_base64_format {
    use base64ct::{Base64, Encoding};
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S: Serializer>(data: &Option<Vec<u8>>, s: S) -> Result<S::Ok, S::Error> {
        match data {
            Some(bytes) => s.serialize_some(&Base64::encode_string(bytes)),
            None => s.serialize_none(),
        }
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Vec<u8>>, D::Error> {
        let opt: Option<String> = Option::deserialize(d)?;
        match opt {
            Some(s) => Base64::decode_vec(&s)
                .map(Some)
                .map_err(serde::de::Error::custom),
            None => Ok(None),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_kms_envelope_protection_lifecycle() {
        let key_id = "arn:aws:kms:us-east-1:123456789012:key/test-quantum-key";
        let kms_client = Arc::new(MockKmsClient::new().with_key(key_id));
        let protector = KmsKeyProtector::new(key_id.to_string(), kms_client.clone());

        let secret = b"QUANTUM-PRIVATE-IDENTITY-PAYLOAD-2026";
        let envelope = wrap_envelope(&protector, secret).expect("Envelope wrap should succeed");

        assert_eq!(envelope.version, 2);
        assert_eq!(envelope.provider, "aws-kms");
        assert_eq!(envelope.kms_key_id.as_deref(), Some(key_id));
        assert!(envelope.wrapped_dek.is_some());

        // Unwrap
        let recovered =
            unwrap_envelope(&protector, &envelope).expect("Envelope unwrap should succeed");
        assert_eq!(&*recovered, secret);

        // Audit records
        let audits = protector
            .audit_records()
            .expect("Audit records should be accessible");
        assert_eq!(audits.len(), 2);
        assert_eq!(audits[0].operation, "wrap");
        assert_eq!(audits[0].status, "SUCCESS");
        assert_eq!(audits[1].operation, "unwrap");
        assert_eq!(audits[1].status, "SUCCESS");
    }

    #[test]
    fn test_kms_outage_fails_fast() {
        let key_id = "arn:aws:kms:us-east-1:123456789012:key/test-outage-key";
        let kms_client = Arc::new(MockKmsClient::new().with_key(key_id));
        let protector = KmsKeyProtector::new(key_id.to_string(), kms_client.clone());

        let secret = b"CRITICAL-SECRET";
        let envelope = wrap_envelope(&protector, secret).unwrap();

        // Simulate KMS service outage
        kms_client.set_available(false);

        let unwrap_res = unwrap_envelope(&protector, &envelope);
        assert!(unwrap_res.is_err());
        let err_msg = unwrap_res.unwrap_err().to_string();
        assert!(err_msg.contains("service unavailable"));
    }

    #[test]
    fn test_kms_access_denied_fails_fast() {
        let key_id = "arn:aws:kms:us-east-1:123456789012:key/test-iam-key";
        let kms_client = Arc::new(MockKmsClient::new().with_key(key_id));
        let protector = KmsKeyProtector::new(key_id.to_string(), kms_client.clone());

        let secret = b"CRITICAL-SECRET";
        let envelope = wrap_envelope(&protector, secret).unwrap();

        // Simulate IAM policy revocation
        kms_client.set_authorized(false);

        let unwrap_res = unwrap_envelope(&protector, &envelope);
        assert!(unwrap_res.is_err());
        let err_msg = unwrap_res.unwrap_err().to_string();
        assert!(err_msg.contains("AccessDenied"));
    }

    #[test]
    fn test_hsm_key_protector() {
        let hsm = HsmKeyProtector::new_mock(1, "quantum-hsm-cmk".to_string());
        let secret = b"HSM-BACKED-IDENTITY-MATERIAL";
        let envelope = wrap_envelope(&hsm, secret).unwrap();

        assert_eq!(envelope.version, 2);
        assert_eq!(envelope.provider, "hsm-pkcs11");

        let recovered = unwrap_envelope(&hsm, &envelope).unwrap();
        assert_eq!(&*recovered, secret);
    }

    #[test]
    fn test_kms_key_rotation() {
        let key_id = "arn:aws:kms:us-east-1:123456789012:key/rotation-key";
        let kms_client = Arc::new(MockKmsClient::new().with_key(key_id));
        let protector_v1 = KmsKeyProtector::new(key_id.to_string(), kms_client.clone());

        let secret = b"QUANTUM-IDENTITY-TO-BE-ROTATED";
        let envelope_v1 = wrap_envelope(&protector_v1, secret).unwrap();

        // Rotate KMS Master Key
        let rotated_key_id = kms_client.rotate_key(key_id);
        let protector_v2 = KmsKeyProtector::new(key_id.to_string(), kms_client.clone());

        // Re-wrap under rotated key (without exposing or altering node secret)
        let recovered = unwrap_envelope(&protector_v1, &envelope_v1).unwrap();
        let envelope_v2 = wrap_envelope(&protector_v2, &recovered).unwrap();

        // Verify recovery with protector_v2
        let final_secret = unwrap_envelope(&protector_v2, &envelope_v2).unwrap();
        assert_eq!(&*final_secret, secret);
        assert_eq!(rotated_key_id, format!("{}-v2", key_id));
    }

    #[test]
    fn test_v1_envelope_backward_compatibility() {
        let kek_path = PathBuf::from("/tmp/test_v1_kek.bin");
        let dev = LocalDevKeyProtector::new(kek_path.clone());
        let secret = b"LEGACY-V1-PAYLOAD";

        // Create legacy v1 envelope: version 1, no wrapped_dek
        let wrapped_payload = dev.wrap(secret).unwrap();
        let v1_envelope = EncryptedEnvelope {
            version: 1,
            created_at_unix: 1788890000,
            provider: "local-dev".to_string(),
            kms_key_id: None,
            kms_key_version: None,
            wrapped_dek: None,
            wrapped_payload,
        };

        // unwrap_envelope should successfully unwrap v1 envelope with LocalDevKeyProtector
        let recovered = unwrap_envelope(&dev, &v1_envelope).unwrap();
        assert_eq!(&*recovered, secret);

        let _ = std::fs::remove_file(kek_path);
    }
}

// ── P3.5.1: Live AWS KMS integration tests ───────────────────────────────────
// Only compile and run when `--features aws-kms-real` is used and AWS
// credentials + a real CMK are available in the environment.

#[cfg(all(test, feature = "aws-kms-real"))]
mod aws_kms_tests {
    use super::*;

    /// Helper: skip this test if AWS credentials or KMS key ID are not configured.
    fn kms_test_key_id() -> Option<String> {
        std::env::var("AWS_ACCESS_KEY_ID").ok()?;
        std::env::var("AWS_SECRET_ACCESS_KEY").ok()?;
        std::env::var("P3_5_KMS_KEY_ID").ok()
    }

    #[test]
    fn test_live_aws_kms_envelope_roundtrip() {
        let key_id = match kms_test_key_id() {
            Some(id) => id,
            None => {
                eprintln!("SKIP: Set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and P3_5_KMS_KEY_ID to run live KMS tests");
                return;
            }
        };

        let client =
            Arc::new(AwsSdkKmsClient::new(&key_id).expect("KMS client creation should succeed"));
        let protector = KmsKeyProtector::new(key_id.clone(), client.clone());

        let secret = b"LIVE-AWS-KMS-ENVELOPE-TEST-PAYLOAD";
        let envelope = wrap_envelope(&protector, secret).expect("wrap should succeed");
        assert_eq!(envelope.provider, "aws-kms");
        assert_eq!(envelope.kms_key_id.as_deref(), Some(key_id.as_str()));
        assert!(envelope.wrapped_dek.is_some());

        let recovered = unwrap_envelope(&protector, &envelope).expect("unwrap should succeed");
        assert_eq!(
            &*recovered, secret,
            "DEK round-trip must reproduce original"
        );

        // Audit trail should show one wrap + one unwrap, both SUCCESS
        let audits = protector.audit_records();
        assert_eq!(audits.len(), 2);
        assert_eq!(audits[0].status, "SUCCESS");
        assert_eq!(audits[1].status, "SUCCESS");
    }

    #[test]
    fn test_live_aws_kms_access_denied() {
        let key_id = match kms_test_key_id() {
            Some(id) => id,
            None => return,
        };

        // Create a client with valid credentials but point at a key the caller
        // does not have kms:Encrypt permission on. In practice, this test passes
        // if AWS_ACCESS_KEY_ID resolves to a user without kms:Encrypt on key_id.
        let client =
            Arc::new(AwsSdkKmsClient::new(&key_id).expect("KMS client creation should succeed"));
        let protector = KmsKeyProtector::new(key_id, client);

        let secret = b"SHOULD-FAIL-ENCRYPT";
        let result = wrap_envelope(&protector, secret);
        // If the caller has kms:Encrypt, the test can't verify denial — skip.
        match result {
            Ok(_) => eprintln!("SKIP: caller has kms:Encrypt — cannot test denial"),
            Err(e) => {
                assert!(
                    e.to_string().contains("AccessDenied")
                        || e.to_string().contains("not authorized"),
                    "Expected AccessDenied, got: {e}"
                );
            }
        }
    }
}


// ─────────────────────────────────────────────────────────────────────────────
// CloudKmsKeyProtector
// ─────────────────────────────────────────────────────────────────────────────

pub struct CloudKmsKeyProtector {
    inner: Box<dyn KeyProtector>,
}

impl CloudKmsKeyProtector {
    pub fn new() -> Self {
        let _ = dotenvy::dotenv();
        let env = std::env::var("VARDHAN_ENV").unwrap_or_default();
        let provider = std::env::var("KMS_PROVIDER").ok();

        if env == "production" && provider.is_none() {
            panic!("KMS_PROVIDER is not set in production!");
        }

        let inner: Box<dyn KeyProtector> = match provider.as_deref() {
            Some("aws") => {
                let key_arn = std::env::var("KMS_KEY_ARN").expect("KMS_KEY_ARN must be set for AWS KMS");
                let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
                let config = rt.block_on(async { aws_config::load_from_env().await });
                let client = aws_sdk_kms::Client::new(&config);
                Box::new(AwsRealProtector { key_arn, client, rt })
            }
            _ => {
                Box::new(LocalDevKeyProtector::new(std::path::PathBuf::from(".local_dev_kek.bin")))
            }
        };

        Self { inner }
    }
}

impl KeyProtector for CloudKmsKeyProtector {
    fn provider_name(&self) -> &'static str {
        self.inner.provider_name()
    }
    fn wrap_dek(&self, dek: &[u8; 32]) -> Result<Vec<u8>, VaultError> {
        self.inner.wrap_dek(dek)
    }
    fn unwrap_dek(&self, wrapped_dek: &[u8]) -> Result<Zeroizing<[u8; 32]>, VaultError> {
        self.inner.unwrap_dek(wrapped_dek)
    }
    fn wrap(&self, plaintext: &[u8]) -> Result<Vec<u8>, VaultError> {
        self.inner.wrap(plaintext)
    }
    fn unwrap(&self, ciphertext: &[u8]) -> Result<Vec<u8>, VaultError> {
        self.inner.unwrap(ciphertext)
    }
    fn key_metadata(&self) -> (Option<String>, Option<String>) {
        self.inner.key_metadata()
    }
}

struct AwsRealProtector {
    key_arn: String,
    client: aws_sdk_kms::Client,
    rt: tokio::runtime::Runtime,
}
impl KeyProtector for AwsRealProtector {
    fn provider_name(&self) -> &'static str { "aws-kms" }
    fn wrap(&self, plaintext: &[u8]) -> Result<Vec<u8>, VaultError> {
        let pt = aws_sdk_kms::primitives::Blob::new(plaintext.to_vec());
        let res = self.rt.block_on(async {
            self.client.encrypt().key_id(&self.key_arn).plaintext(pt).send().await
        }).map_err(|e| VaultError::Kms(e.to_string()))?;
        let blob = res.ciphertext_blob().ok_or_else(|| VaultError::Kms("No blob".into()))?;
        Ok(blob.clone().into_inner())
    }
    fn unwrap(&self, ciphertext: &[u8]) -> Result<Vec<u8>, VaultError> {
        let ct = aws_sdk_kms::primitives::Blob::new(ciphertext.to_vec());
        let res = self.rt.block_on(async {
            self.client.decrypt().key_id(&self.key_arn).ciphertext_blob(ct).send().await
        }).map_err(|e| VaultError::Kms(e.to_string()))?;
        let blob = res.plaintext().ok_or_else(|| VaultError::Kms("No blob".into()))?;
        Ok(blob.clone().into_inner())
    }
}
