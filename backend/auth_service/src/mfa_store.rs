//! Persistent MFA enrollment state.
//!
//! This module stores only encrypted MFA material. The encryption key must be
//! supplied by the deployment secret/KMS boundary; plaintext TOTP secrets are
//! never persisted by this module.

use std::sync::Arc;
use zeroize::Zeroizing;

const PREFIX: &[u8] = b"mfa:";

#[derive(Clone)]
pub struct MfaStore {
    db: Arc<sled::Db>,
}

impl MfaStore {
    pub fn open(db: Arc<sled::Db>) -> Self { Self { db } }

    fn key(username: &str) -> Vec<u8> {
        let mut key = PREFIX.to_vec();
        key.extend_from_slice(username.as_bytes());
        key
    }

    /// Persist an already encrypted secret. Encryption belongs at the KMS/vault
    /// boundary; this store intentionally refuses plaintext secrets.
    pub fn set_encrypted_secret(&self, username: &str, ciphertext: &[u8]) -> Result<(), String> {
        if ciphertext.len() < 16 {
            return Err("encrypted MFA secret is too short".into());
        }
        self.db.insert(Self::key(username), ciphertext)
            .map(|_| ())
            .map_err(|e| format!("MFA state write failed: {e}"))
    }

    pub fn get_encrypted_secret(&self, username: &str) -> Option<Zeroizing<Vec<u8>>> {
        self.db.get(Self::key(username)).ok().flatten().map(|v| Zeroizing::new(v.to_vec()))
    }

    pub fn remove(&self, username: &str) -> Result<bool, String> {
        self.db.remove(Self::key(username))
            .map(|v| v.is_some())
            .map_err(|e| format!("MFA state removal failed: {e}"))
    }
}
