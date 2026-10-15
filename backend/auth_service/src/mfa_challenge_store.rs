//! Restart-safe, single-use MFA challenge persistence.

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use rand::{distributions::Alphanumeric, Rng};
use serde::{Deserialize, Serialize};

const PREFIX: &[u8] = b"mfa-challenge:";
const TTL_MS: u64 = 300_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredMfaChallenge {
    pub id: String,
    pub username: String,
    pub expires_at_ms: u64,
}

#[derive(Clone)]
pub struct MfaChallengeStore {
    db: Arc<sled::Db>,
}

impl MfaChallengeStore {
    pub fn open(db: Arc<sled::Db>) -> Self {
        Self { db }
    }

    fn key(id: &str) -> Vec<u8> {
        [PREFIX, id.as_bytes()].concat()
    }

    pub fn issue(&self, username: &str) -> Result<StoredMfaChallenge, String> {
        let id: String = rand::thread_rng()
            .sample_iter(&Alphanumeric)
            .take(48)
            .map(char::from)
            .collect();
        let challenge = StoredMfaChallenge {
            id: id.clone(),
            username: username.to_string(),
            expires_at_ms: now_ms().saturating_add(TTL_MS),
        };
        let bytes = serde_json::to_vec(&challenge)
            .map_err(|e| format!("MFA challenge encode failed: {e}"))?;
        self.db
            .insert(Self::key(&id), bytes)
            .map_err(|e| format!("MFA challenge write failed: {e}"))?;
        Ok(challenge)
    }

    /// Atomically consumes a challenge before verification, preventing replay.
    pub fn consume(&self, id: &str) -> Result<Option<StoredMfaChallenge>, String> {
        let value = self
            .db
            .remove(Self::key(id))
            .map_err(|e| format!("MFA challenge consume failed: {e}"))?;
        let Some(value) = value else {
            return Ok(None);
        };
        let challenge: StoredMfaChallenge = serde_json::from_slice(&value)
            .map_err(|e| format!("MFA challenge decode failed: {e}"))?;
        if challenge.expires_at_ms <= now_ms() {
            return Ok(None);
        }
        Ok(Some(challenge))
    }

    pub fn purge_expired(&self) -> Result<usize, String> {
        let now = now_ms();
        let mut removed = 0usize;
        for item in self.db.scan_prefix(PREFIX) {
            let (key, value) = item.map_err(|e| format!("MFA challenge scan failed: {e}"))?;
            if let Ok(challenge) = serde_json::from_slice::<StoredMfaChallenge>(&value) {
                if challenge.expires_at_ms <= now {
                    self.db
                        .remove(key)
                        .map_err(|e| format!("MFA challenge purge failed: {e}"))?;
                    removed += 1;
                }
            }
        }
        Ok(removed)
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
