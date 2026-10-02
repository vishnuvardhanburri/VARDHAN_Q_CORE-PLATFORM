//! Production API key management with high entropy, BLAKE3 hashing, and sled persistence.
//!
//! Plaintext secrets are generated with `OsRng` and shown ONLY ONCE at creation.
//! Only the BLAKE3 hash is persisted in the database.

use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};
use thiserror::Error;

use crate::store::CredentialStore;

const API_KEY_PREFIX: &[u8] = b"apikey:";
const API_KEY_HASH_PREFIX: &[u8] = b"apikey_hash:";

#[derive(Error, Debug)]
pub enum ApiKeyError {
    #[error("API key not found")]
    NotFound,
    #[error("Invalid key name: {0}")]
    InvalidName(String),
    #[error("API key is already revoked")]
    AlreadyRevoked,
    #[error("Database error: {0}")]
    DbError(String),
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

/// Internal database record for an API key.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiKeyRecord {
    pub id: String,
    pub name: String,
    pub key_hash: String,
    pub created_at_ms: u128,
    pub expires_at_ms: Option<u128>,
    pub revoked: bool,
    pub last_used_at_ms: Option<u128>,
    pub created_by: String,
}

impl ApiKeyRecord {
    pub fn is_active(&self) -> bool {
        if self.revoked {
            return false;
        }
        if let Some(exp) = self.expires_at_ms {
            if now_ms() >= exp {
                return false;
            }
        }
        true
    }

    pub fn to_view(&self) -> ApiKeyView {
        ApiKeyView {
            id: self.id.clone(),
            name: self.name.clone(),
            created_at: self.created_at_ms,
            expires_at: self.expires_at_ms,
            revoked: self.revoked,
            last_used_at: self.last_used_at_ms,
            created_by: self.created_by.clone(),
        }
    }
}

/// Safe public view of an API key — NEVER exposes the secret or hash.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApiKeyView {
    pub id: String,
    pub name: String,
    pub created_at: u128,
    pub expires_at: Option<u128>,
    pub revoked: bool,
    pub last_used_at: Option<u128>,
    pub created_by: String,
}

/// Returned ONLY once upon successful creation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateApiKeyResponse {
    pub id: String,
    pub name: String,
    pub created_at: u128,
    pub expires_at: Option<u128>,
    pub secret: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateApiKeyRequest {
    pub name: String,
    pub expires_in_days: Option<u32>,
}

impl CredentialStore {
    fn apikey_key(id: &str) -> Vec<u8> {
        let mut k = API_KEY_PREFIX.to_vec();
        k.extend_from_slice(id.as_bytes());
        k
    }

    fn apikey_hash_key(hash: &str) -> Vec<u8> {
        let mut k = API_KEY_HASH_PREFIX.to_vec();
        k.extend_from_slice(hash.as_bytes());
        k
    }

    /// Create a new API key with a 256-bit random secret.
    /// Plaintext secret is returned ONLY in this response and never persisted.
    pub fn create_api_key(
        &self,
        name: &str,
        expires_in_days: Option<u32>,
        created_by: &str,
    ) -> Result<CreateApiKeyResponse, ApiKeyError> {
        let trimmed_name = name.trim();
        if trimmed_name.is_empty() || trimmed_name.len() > 64 {
            return Err(ApiKeyError::InvalidName(
                "Name must be between 1 and 64 characters".to_string(),
            ));
        }

        // Generate high entropy ID and secret
        let mut id_bytes = [0u8; 8];
        OsRng.fill_bytes(&mut id_bytes);
        let id = format!("ak_{}", hex::encode(id_bytes));

        let mut secret_bytes = [0u8; 32];
        OsRng.fill_bytes(&mut secret_bytes);
        let secret = format!("vq_live_{}", hex::encode(secret_bytes));

        // Compute BLAKE3 hash of the secret string
        let key_hash = hex::encode(blake3::hash(secret.as_bytes()).as_bytes());

        let now = now_ms();
        let expires_at_ms = expires_in_days.map(|days| now + (days as u128 * 86_400_000));

        let record = ApiKeyRecord {
            id: id.clone(),
            name: trimmed_name.to_string(),
            key_hash: key_hash.clone(),
            created_at_ms: now,
            expires_at_ms,
            revoked: false,
            last_used_at_ms: None,
            created_by: created_by.to_string(),
        };

        let val = serde_json::to_vec(&record).map_err(|e| ApiKeyError::DbError(e.to_string()))?;

        // Write both record and hash index atomically
        let id_bytes = id.as_bytes();
        let hash_bytes = key_hash.as_bytes();
        let record_key = Self::apikey_key(&id);
        let hash_key = Self::apikey_hash_key(&key_hash);

        self.db
            .transaction(|tx_db| {
                tx_db.insert(&*record_key, val.clone())?;
                tx_db.insert(&*hash_key, id_bytes)?;
                Ok::<(), sled::transaction::ConflictableTransactionError>(())
            })
            .map_err(|e| ApiKeyError::DbError(format!("Transaction failed: {e}")))?;

        self.db
            .flush()
            .map_err(|e| ApiKeyError::DbError(e.to_string()))?;

        Ok(CreateApiKeyResponse {
            id,
            name: trimmed_name.to_string(),
            created_at: now,
            expires_at: expires_at_ms,
            secret,
        })
    }

    /// List all API keys as safe views.
    pub fn list_api_keys(&self) -> Result<Vec<ApiKeyView>, ApiKeyError> {
        let mut list = Vec::new();
        for item in self.db.scan_prefix(API_KEY_PREFIX) {
            let (_, val) = item.map_err(|e| ApiKeyError::DbError(e.to_string()))?;
            if let Ok(record) = serde_json::from_slice::<ApiKeyRecord>(&val) {
                list.push(record.to_view());
            }
        }
        list.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        Ok(list)
    }

    /// Revoke an API key by ID.
    pub fn revoke_api_key(&self, id: &str) -> Result<ApiKeyView, ApiKeyError> {
        let key = Self::apikey_key(id);
        let raw = self
            .db
            .get(&key)
            .map_err(|e| ApiKeyError::DbError(e.to_string()))?
            .ok_or(ApiKeyError::NotFound)?;

        let mut record: ApiKeyRecord =
            serde_json::from_slice(&raw).map_err(|e| ApiKeyError::DbError(e.to_string()))?;

        record.revoked = true;
        let view = record.to_view();

        let val = serde_json::to_vec(&record).map_err(|e| ApiKeyError::DbError(e.to_string()))?;

        // Update record and remove from hash index atomically
        let key_clone = key.clone();
        let hash_key = Self::apikey_hash_key(&record.key_hash);
        let val_clone = val.clone();

        self.db
            .transaction(|tx_db| {
                tx_db.insert(&*key_clone, val_clone.clone())?;
                tx_db.remove(&*hash_key)?;
                Ok::<(), sled::transaction::ConflictableTransactionError>(())
            })
            .map_err(|e| ApiKeyError::DbError(format!("Revocation transaction failed: {e}")))?;

        self.db
            .flush()
            .map_err(|e| ApiKeyError::DbError(e.to_string()))?;

        Ok(view)
    }

    /// Verify an incoming API key secret.
    /// Updates `last_used_at` if valid and returns safe `ApiKeyView`.
    pub fn verify_api_key(&self, secret: &str) -> Result<Option<ApiKeyView>, ApiKeyError> {
        let key_hash = hex::encode(blake3::hash(secret.as_bytes()).as_bytes());
        let hash_key = Self::apikey_hash_key(&key_hash);

        let id_bytes = match self
            .db
            .get(&hash_key)
            .map_err(|e| ApiKeyError::DbError(e.to_string()))?
        {
            Some(bytes) => bytes,
            None => return Ok(None),
        };

        let id = String::from_utf8(id_bytes.to_vec())
            .map_err(|e| ApiKeyError::DbError(e.to_string()))?;
        let key = Self::apikey_key(&id);

        let raw = match self
            .db
            .get(&key)
            .map_err(|e| ApiKeyError::DbError(e.to_string()))?
        {
            Some(r) => r,
            None => return Ok(None),
        };

        let mut record: ApiKeyRecord =
            serde_json::from_slice(&raw).map_err(|e| ApiKeyError::DbError(e.to_string()))?;

        if !record.is_active() {
            return Ok(None);
        }

        // Update last_used_at
        record.last_used_at_ms = Some(now_ms());
        let view = record.to_view();
        if let Ok(val) = serde_json::to_vec(&record) {
            let _ = self.db.insert(key, val);
            let _ = self.db.flush();
        }

        Ok(Some(view))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn temp_store() -> CredentialStore {
        let dir = tempdir().unwrap();
        CredentialStore::open(dir.path()).unwrap()
    }

    #[test]
    fn test_api_key_lifecycle() {
        let store = temp_store();

        // 1. Create API key
        let res = store
            .create_api_key("CI Runner", Some(30), "admin")
            .unwrap();
        assert!(res.id.starts_with("ak_"));
        assert!(res.secret.starts_with("vq_live_"));
        assert_eq!(res.name, "CI Runner");

        // 2. List API keys — secret is NOT in the view
        let keys = store.list_api_keys().unwrap();
        assert_eq!(keys.len(), 1);
        assert_eq!(keys[0].id, res.id);
        assert_eq!(keys[0].name, "CI Runner");
        assert!(!keys[0].revoked);

        // 3. Verify valid key
        let verified = store.verify_api_key(&res.secret).unwrap();
        assert!(verified.is_some());
        assert_eq!(verified.unwrap().id, res.id);

        // 4. Verify invalid key returns None
        let invalid = store.verify_api_key("vq_live_fake_token_12345").unwrap();
        assert!(invalid.is_none());

        // 5. Revoke key
        let revoked = store.revoke_api_key(&res.id).unwrap();
        assert!(revoked.revoked);

        // 6. Verification now fails for revoked key
        let recheck = store.verify_api_key(&res.secret).unwrap();
        assert!(recheck.is_none());
    }

    #[test]
    fn test_invalid_name_rejected() {
        let store = temp_store();
        assert!(store.create_api_key("", None, "admin").is_err());
        assert!(store.create_api_key("   ", None, "admin").is_err());
    }
}
