use serde::{Deserialize, Serialize};
use sled::Db;
use thiserror::Error;

const PREFIX: &[u8] = b"qcore:issuer-key:";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum KeyState { Active, Rotating, Deprecated, Retired, Revoked }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReceiptIssuerKey {
    pub organization_id: String,
    pub service_id: String,
    pub ed25519_key_id: String,
    pub ed25519_public_key: Vec<u8>,
    pub ml_dsa_87_key_id: String,
    pub ml_dsa_87_public_key: Vec<u8>,
    pub issuer_key_fingerprint: String,
    pub state: KeyState,
}

#[derive(Debug, Error)]
pub enum KeyRegistryError {
    #[error("issuer key scope mismatch")]
    ScopeMismatch,
    #[error("issuer key not found")]
    NotFound,
    #[error("issuer key is not active")]
    NotActive,
    #[error("issuer key registration conflicts with an existing record")]
    Conflict,
    #[error("invalid issuer key record: {0}")]
    Invalid(String),
    #[error("key registry storage failed: {0}")]
    Storage(#[from] sled::Error),
    #[error("key registry serialization failed: {0}")]
    Serialization(String),
}

#[derive(Clone)]
pub struct ReceiptKeyRegistry { db: std::sync::Arc<Db> }

impl ReceiptKeyRegistry {
    pub fn new(db: std::sync::Arc<Db>) -> Self { Self { db } }

    pub fn register(&self, key: ReceiptIssuerKey) -> Result<(), KeyRegistryError> {
        validate(&key)?;
        let storage_key = storage_key(&key.organization_id, &key.service_id);
        let encoded = serde_json::to_vec(&key).map_err(|e| KeyRegistryError::Serialization(e.to_string()))?;
        if let Some(existing) = self.db.get(&storage_key)? {
            if existing.as_ref() == encoded.as_slice() { return Ok(()); }
            return Err(KeyRegistryError::Conflict);
        }
        self.db.insert(storage_key, encoded)?;
        self.db.flush()?;
        Ok(())
    }

    pub fn resolve_active(&self, organization_id: &str, service_id: &str) -> Result<ReceiptIssuerKey, KeyRegistryError> {
        let Some(bytes) = self.db.get(storage_key(organization_id, service_id))? else { return Err(KeyRegistryError::NotFound); };
        let key: ReceiptIssuerKey = serde_json::from_slice(&bytes).map_err(|e| KeyRegistryError::Serialization(e.to_string()))?;
        if key.state != KeyState::Active { return Err(KeyRegistryError::NotActive); }
        Ok(key)
    }

    pub fn set_state(&self, organization_id: &str, service_id: &str, state: KeyState) -> Result<(), KeyRegistryError> {
        let mut key = self.resolve_any(organization_id, service_id)?;
        key.state = state;
        validate(&key)?;
        self.db.insert(storage_key(organization_id, service_id), serde_json::to_vec(&key).map_err(|e| KeyRegistryError::Serialization(e.to_string()))?)?;
        self.db.flush()?;
        Ok(())
    }

    fn resolve_any(&self, organization_id: &str, service_id: &str) -> Result<ReceiptIssuerKey, KeyRegistryError> {
        let Some(bytes) = self.db.get(storage_key(organization_id, service_id))? else { return Err(KeyRegistryError::NotFound); };
        serde_json::from_slice(&bytes).map_err(|e| KeyRegistryError::Serialization(e.to_string()))
    }
}

fn storage_key(organization_id: &str, service_id: &str) -> Vec<u8> {
    let mut out = PREFIX.to_vec();
    out.extend_from_slice(organization_id.as_bytes());
    out.push(b':');
    out.extend_from_slice(service_id.as_bytes());
    out
}

fn validate(key: &ReceiptIssuerKey) -> Result<(), KeyRegistryError> {
    if key.organization_id.is_empty() || key.service_id.is_empty() || key.ed25519_key_id.is_empty() || key.ml_dsa_87_key_id.is_empty() {
        return Err(KeyRegistryError::Invalid("scope and key identifiers are required".into()));
    }
    if key.ed25519_public_key.len() != 32 { return Err(KeyRegistryError::Invalid("Ed25519 public key must be 32 bytes".into())); }
    if key.ml_dsa_87_public_key.len() != 2592 { return Err(KeyRegistryError::Invalid("ML-DSA-87 public key must be 2592 bytes".into())); }
    let expected = blake3::hash(&key.ed25519_public_key).to_string();
    if expected != key.issuer_key_fingerprint { return Err(KeyRegistryError::Invalid("issuer fingerprint does not match Ed25519 public key".into())); }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn registry() -> ReceiptKeyRegistry { ReceiptKeyRegistry::new(std::sync::Arc::new(sled::Config::new().temporary(true).open().unwrap())) }
    fn key() -> ReceiptIssuerKey {
        let ed = vec![7u8; 32];
        ReceiptIssuerKey { organization_id: "org-a".into(), service_id: "qcore-1".into(), ed25519_key_id: "ed-1".into(), ed25519_public_key: ed.clone(), ml_dsa_87_key_id: "pq-1".into(), ml_dsa_87_public_key: vec![9u8; 2592], issuer_key_fingerprint: blake3::hash(&ed).to_string(), state: KeyState::Active }
    }
    #[test] fn active_key_resolves() { let r = registry(); r.register(key()).unwrap(); assert_eq!(r.resolve_active("org-a", "qcore-1").unwrap().state, KeyState::Active); }
    #[test] fn tenant_isolation_rejects_unknown_scope() { let r = registry(); r.register(key()).unwrap(); assert!(matches!(r.resolve_active("org-b", "qcore-1"), Err(KeyRegistryError::NotFound))); }
    #[test] fn revoked_key_is_not_resolved_as_active() { let r = registry(); r.register(key()).unwrap(); r.set_state("org-a", "qcore-1", KeyState::Revoked).unwrap(); assert!(matches!(r.resolve_active("org-a", "qcore-1"), Err(KeyRegistryError::NotActive))); }
}
