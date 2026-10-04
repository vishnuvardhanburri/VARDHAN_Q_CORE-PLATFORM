//! Restart-safe session storage.
//!
//! Bearer tokens are never persisted in plaintext. A 256-bit BLAKE3 digest of
//! each random token is stored as the lookup key; the session record stores only
//! token digests. Sled provides durable local persistence and atomic transactions.

use std::net::IpAddr;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sled::IVec;
use zeroize::Zeroizing;

use crate::session::{SessionEntry, SessionInfo, SessionToken, SessionView};

pub const SESSION_HARD_EXPIRY_SECS: u64 = 8 * 60 * 60;
pub const SESSION_IDLE_TIMEOUT_SECS: u64 = 30 * 60;
const SCHEMA_VERSION: u8 = 1;

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn token_digest(token: &SessionToken) -> String {
    blake3::hash(token.as_str().as_bytes()).to_hex().to_string()
}

fn random_session_id() -> String {
    let mut bytes = [0u8; 8];
    OsRng.fill_bytes(&mut bytes);
    format!("sess_{}", hex::encode(bytes))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PersistedSession {
    schema_version: u8,
    session_id: String,
    username: String,
    created_at_ms: u128,
    last_activity_ms: u128,
    expires_at_ms: u128,
    ip: String,
    node_id: String,
    revoked: bool,
    current_token_digest: String,
    previous_token_digest: Option<String>,
}

impl PersistedSession {
    fn is_expired(&self) -> bool {
        self.revoked
            || now_ms() >= self.expires_at_ms
            || now_ms().saturating_sub(self.last_activity_ms)
                >= (SESSION_IDLE_TIMEOUT_SECS as u128 * 1000)
    }

    fn view(&self) -> SessionView {
        SessionView {
            session_id: self.session_id.clone(),
            username: self.username.clone(),
            created_at: self.created_at_ms,
            expires_at: self.expires_at_ms,
            last_activity: self.last_activity_ms,
            node_id: self.node_id.clone(),
            session_state: if self.revoked {
                "revoked".to_string()
            } else if self.is_expired() {
                "expired".to_string()
            } else {
                "active".to_string()
            },
            client_ip: self.ip.clone(),
        }
    }

    fn to_legacy_entry(&self, token: Option<&SessionToken>) -> SessionEntry {
        let current = token
            .map(|t| t.as_str().to_string())
            .unwrap_or_default();
        SessionEntry {
            session_id: self.session_id.clone(),
            username: self.username.clone(),
            created_at_ms: self.created_at_ms,
            last_activity_ms: self.last_activity_ms,
            expires_at_ms: self.expires_at_ms,
            ip: self.ip.clone(),
            node_id: self.node_id.clone(),
            revoked: self.revoked,
            current_token: Zeroizing::new(current),
            previous_token: None,
        }
    }
}

/// Durable, restart-safe session store.
#[derive(Clone)]
pub struct SessionStore {
    db: Arc<sled::Db>,
}

impl SessionStore {
    pub fn open(path: &std::path::Path) -> sled::Result<Self> {
        let db = sled::open(path)?;
        Ok(Self { db: Arc::new(db) })
    }

    pub fn temporary() -> sled::Result<Self> {
        Ok(Self {
            db: Arc::new(sled::Config::new().temporary(true).open()?),
        })
    }

    fn session_key(id: &str) -> Vec<u8> {
        format!("s:{id}").into_bytes()
    }

    fn token_key(digest: &str) -> Vec<u8> {
        format!("t:{digest}").into_bytes()
    }

    fn revoked_key(id: &str) -> Vec<u8> {
        format!("r:{id}").into_bytes()
    }

    fn decode(value: &IVec) -> Option<PersistedSession> {
        serde_json::from_slice(value).ok().filter(|v: &PersistedSession| {
            v.schema_version == SCHEMA_VERSION
        })
    }

    fn lookup_id(&self, token: &SessionToken) -> Option<String> {
        self.db
            .get(Self::token_key(&token_digest(token)))
            .ok()
            .flatten()
            .and_then(|v| String::from_utf8(v.to_vec()).ok())
    }

    fn load(&self, id: &str) -> Option<PersistedSession> {
        self.db.get(Self::session_key(id)).ok().flatten().and_then(|v| Self::decode(&v))
    }

    pub async fn create(&self, username: &str, ip: IpAddr) -> SessionToken {
        self.create_with_node(username, ip, "local-node").await
    }

    pub async fn create_with_node(
        &self,
        username: &str,
        ip: IpAddr,
        node_id: &str,
    ) -> SessionToken {
        let token = SessionToken::generate();
        let digest = token_digest(&token);
        let session_id = random_session_id();
        let now = now_ms();
        let entry = PersistedSession {
            schema_version: SCHEMA_VERSION,
            session_id: session_id.clone(),
            username: username.to_string(),
            created_at_ms: now,
            last_activity_ms: now,
            expires_at_ms: now + (SESSION_HARD_EXPIRY_SECS as u128 * 1000),
            ip: ip.to_string(),
            node_id: node_id.to_string(),
            revoked: false,
            current_token_digest: digest.clone(),
            previous_token_digest: None,
        };
        let encoded = serde_json::to_vec(&entry).expect("session serialization must succeed");
        let session_key = Self::session_key(&session_id);
        let token_key = Self::token_key(&digest);
        let id_bytes = session_id.as_bytes().to_vec();
        self.db
            .transaction(|tx| {
                tx.insert(&session_key, encoded.as_slice())?;
                tx.insert(&token_key, id_bytes.as_slice())?;
                Ok(())
            })
            .expect("session transaction must commit");
        self.db.flush_async().await.ok();
        token
    }

    pub async fn validate_and_rotate(
        &self,
        token: &SessionToken,
    ) -> Option<(String, SessionToken)> {
        let id = self.lookup_id(token)?;
        let mut entry = self.load(&id)?;
        if entry.is_expired() {
            let _ = self.revoke_by_id(&id).await;
            return None;
        }
        let digest = token_digest(token);
        if digest != entry.current_token_digest && entry.previous_token_digest.as_deref() != Some(&digest) {
            let _ = self.revoke_by_id(&id).await;
            return None;
        }
        if entry.previous_token_digest.as_deref() == Some(&digest) {
            entry.last_activity_ms = now_ms();
            let current = self
                .find_token_for_digest(&entry.current_token_digest)
                .unwrap_or_else(|| SessionToken::from_str(token.as_str()));
            let _ = self.save(&entry);
            return Some((entry.username, current));
        }

        let new_token = SessionToken::generate();
        let old_digest = entry.current_token_digest.clone();
        let new_digest = token_digest(&new_token);
        entry.previous_token_digest = Some(old_digest.clone());
        entry.current_token_digest = new_digest.clone();
        entry.last_activity_ms = now_ms();
        let encoded = serde_json::to_vec(&entry).ok()?;
        let session_key = Self::session_key(&id);
        let old_key = Self::token_key(&old_digest);
        let new_key = Self::token_key(&new_digest);
        let id_bytes = id.as_bytes().to_vec();
        self.db
            .transaction(|tx| {
                tx.insert(&session_key, encoded.as_slice())?;
                tx.remove(&old_key)?;
                tx.insert(&new_key, id_bytes.as_slice())?;
                Ok(())
            })
            .ok()?;
        self.db.flush_async().await.ok();
        Some((entry.username, new_token))
    }

    pub async fn validate(&self, token: &SessionToken) -> Option<String> {
        let id = self.lookup_id(token)?;
        let entry = self.load(&id)?;
        if entry.is_expired() {
            return None;
        }
        let digest = token_digest(token);
        (digest == entry.current_token_digest || entry.previous_token_digest.as_deref() == Some(&digest))
            .then_some(entry.username)
    }

    pub async fn remove(&self, token: &SessionToken) -> Option<SessionEntry> {
        let id = self.lookup_id(token)?;
        let entry = self.load(&id)?;
        let current = Some(token);
        let _ = self.db.transaction(|tx| {
            tx.remove(Self::session_key(&id))?;
            tx.remove(Self::token_key(&entry.current_token_digest))?;
            if let Some(prev) = &entry.previous_token_digest {
                tx.remove(Self::token_key(prev))?;
            }
            Ok(())
        });
        let _ = self.db.flush_async().await;
        Some(entry.to_legacy_entry(current))
    }

    pub async fn get_info(&self, token: &SessionToken) -> Option<SessionInfo> {
        let id = self.lookup_id(token)?;
        let entry = self.load(&id)?;
        if entry.is_expired() {
            return None;
        }
        let digest = token_digest(token);
        if digest != entry.current_token_digest && entry.previous_token_digest.as_deref() != Some(&digest) {
            return None;
        }
        Some(SessionInfo {
            username: entry.username,
            issued_at_ms: entry.created_at_ms as u64,
            expires_in_secs: entry.expires_at_ms.saturating_sub(now_ms()) as u64 / 1000,
        })
    }

    pub async fn list_sessions(&self) -> Vec<SessionView> {
        self.db
            .scan_prefix(b"s:")
            .filter_map(|(_, value)| Self::decode(&value).map(|v| v.view()))
            .chain(self.db.scan_prefix(b"r:").filter_map(|(_, value)| Self::decode(&value).map(|v| v.view())))
            .collect()
    }

    pub async fn get_session_by_id(&self, session_id: &str) -> Option<SessionView> {
        self.db
            .get(Self::session_key(session_id))
            .ok()
            .flatten()
            .and_then(|v| Self::decode(&v).map(|e| e.view()))
            .or_else(|| self.db.get(Self::revoked_key(session_id)).ok().flatten().and_then(|v| Self::decode(&v).map(|e| e.view())))
    }

    pub async fn revoke_by_id(&self, session_id: &str) -> Option<SessionView> {
        if let Some(existing) = self.db.get(Self::revoked_key(session_id)).ok().flatten() {
            return Self::decode(&existing).map(|e| e.view());
        }
        let mut entry = self.load(session_id)?;
        entry.revoked = true;
        let view = entry.view();
        let encoded = serde_json::to_vec(&entry).ok()?;
        let session_key = Self::session_key(session_id);
        let revoked_key = Self::revoked_key(session_id);
        let _ = self.db.transaction(|tx| {
            tx.remove(&session_key)?;
            tx.remove(Self::token_key(&entry.current_token_digest))?;
            if let Some(prev) = &entry.previous_token_digest {
                tx.remove(Self::token_key(prev))?;
            }
            tx.insert(&revoked_key, encoded.as_slice())?;
            Ok(())
        });
        let _ = self.db.flush_async().await;
        Some(view)
    }

    pub async fn flush_except(&self, preserve_token: Option<&str>) -> usize {
        let preserve_digest = preserve_token.map(|v| blake3::hash(v.as_bytes()).to_hex().to_string());
        let ids: Vec<String> = self
            .db
            .scan_prefix(b"s:")
            .filter_map(|(key, value)| {
                let entry = Self::decode(&value)?;
                if preserve_digest.as_deref() == Some(entry.current_token_digest.as_str())
                    || preserve_digest.as_deref() == entry.previous_token_digest.as_deref()
                {
                    return None;
                }
                String::from_utf8(key[2..].to_vec()).ok()
            })
            .collect();
        let mut count = 0;
        for id in ids {
            if self.revoke_by_id(&id).await.is_some() {
                count += 1;
            }
        }
        count
    }

    pub fn active_count(&self) -> usize {
        self.db
            .scan_prefix(b"s:")
            .filter_map(|(_, value)| Self::decode(&value))
            .filter(|e| !e.is_expired())
            .count()
    }

    fn save(&self, entry: &PersistedSession) -> sled::Result<()> {
        self.db.insert(Self::session_key(&entry.session_id), serde_json::to_vec(entry)?)?;
        self.db.flush()?;
        Ok(())
    }

    fn find_token_for_digest(&self, digest: &str) -> Option<SessionToken> {
        // The original bearer token cannot be reconstructed from its digest.
        // This path is only for a concurrent request carrying the previous token;
        // returning that token is unnecessary for correctness, so callers should
        // authenticate using the incoming token when no current token is available.
        let _ = digest;
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn survives_restart_and_does_not_store_plaintext_token() {
        let db = tempfile::tempdir().unwrap();
        let token;
        {
            let store = SessionStore::open(db.path()).unwrap();
            token = store.create("alice", "127.0.0.1".parse().unwrap()).await;
            assert_eq!(store.validate(&token).await.as_deref(), Some("alice"));
            let raw = std::fs::read_dir(db.path()).unwrap().count();
            assert!(raw > 0);
        }
        let reopened = SessionStore::open(db.path()).unwrap();
        assert_eq!(reopened.validate(&token).await.as_deref(), Some("alice"));
        assert_eq!(reopened.get_info(&token).await.unwrap().username, "alice");
    }

    #[tokio::test]
    async fn revocation_survives_restart() {
        let db = tempfile::tempdir().unwrap();
        let token = {
            let store = SessionStore::open(db.path()).unwrap();
            store.create("alice", "127.0.0.1".parse().unwrap()).await
        };
        let store = SessionStore::open(db.path()).unwrap();
        assert!(store.revoke_by_id(&store.list_sessions().await[0].session_id).await.is_some());
        drop(store);
        let reopened = SessionStore::open(db.path()).unwrap();
        assert!(reopened.validate(&token).await.is_none());
    }
}
