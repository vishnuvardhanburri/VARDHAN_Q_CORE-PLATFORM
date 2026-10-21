use crate::{KeyAlgorithm, KeyIdentity, KeyStatus, current_time_ms};
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;
use std::path::Path;

/// Historical key descriptor retained for independent receipt verification.
///
/// When signing keys are rotated, their public key material is preserved here.
/// Historical receipts sealed by previous key versions remain verifiable as
/// long as the historical key has not been marked `Revoked`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HistoricalKeyEntry {
    pub key_id: String,
    pub algorithm: KeyAlgorithm,
    pub key_version: u32,
    pub public_key_fingerprint: String,
    pub public_key_hex: String,
    pub created_at_ms: u64,
    pub retired_at_ms: Option<u64>,
    pub status: KeyStatus,
    pub revocation_reason: Option<String>,
}

/// Registry of historical public keys for verifying older receipts.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct HistoricalKeyRegistry {
    pub format_version: u32,
    pub keys: Vec<HistoricalKeyEntry>,
}

impl HistoricalKeyRegistry {
    pub fn new() -> Self {
        Self {
            format_version: 1,
            keys: Vec::new(),
        }
    }

    /// Add a historical key to the registry.
    pub fn add_key(&mut self, entry: HistoricalKeyEntry) {
        if !self
            .keys
            .iter()
            .any(|k| k.public_key_fingerprint == entry.public_key_fingerprint)
        {
            self.keys.push(entry);
        }
    }

    /// Archive active key identities into the historical registry.
    pub fn archive_active_keys(
        &mut self,
        ed_identity: &KeyIdentity,
        ed_pub_bytes: &[u8],
        ml_identity: &KeyIdentity,
        ml_pub_bytes: &[u8],
    ) {
        let now_ms = current_time_ms();

        let ed_entry = HistoricalKeyEntry {
            key_id: ed_identity.key_id.clone(),
            algorithm: KeyAlgorithm::Ed25519,
            key_version: ed_identity.key_version,
            public_key_fingerprint: ed_identity.public_key_fingerprint.clone(),
            public_key_hex: hex::encode(ed_pub_bytes),
            created_at_ms: ed_identity.created_at_ms,
            retired_at_ms: Some(now_ms),
            status: KeyStatus::Retired,
            revocation_reason: None,
        };
        self.add_key(ed_entry);

        let ml_entry = HistoricalKeyEntry {
            key_id: ml_identity.key_id.clone(),
            algorithm: KeyAlgorithm::MlDsa87,
            key_version: ml_identity.key_version,
            public_key_fingerprint: ml_identity.public_key_fingerprint.clone(),
            public_key_hex: hex::encode(ml_pub_bytes),
            created_at_ms: ml_identity.created_at_ms,
            retired_at_ms: Some(now_ms),
            status: KeyStatus::Retired,
            revocation_reason: None,
        };
        self.add_key(ml_entry);
    }

    /// Lookup historical key entry by public key fingerprint.
    pub fn lookup_by_fingerprint(&self, fingerprint: &str) -> Option<&HistoricalKeyEntry> {
        self.keys
            .iter()
            .find(|k| k.public_key_fingerprint == fingerprint)
    }

    /// Lookup historical key entry by key ID.
    pub fn lookup_by_key_id(&self, key_id: &str) -> Option<&HistoricalKeyEntry> {
        self.keys.iter().find(|k| k.key_id == key_id)
    }

    /// Check if a key has been revoked.
    pub fn is_revoked(&self, fingerprint: &str) -> bool {
        self.lookup_by_fingerprint(fingerprint)
            .map(|k| k.status == KeyStatus::Revoked)
            .unwrap_or(false)
    }

    /// Revoke a key by fingerprint with an audit reason.
    pub fn revoke_by_fingerprint(&mut self, fingerprint: &str, reason: &str) -> Result<(), String> {
        if let Some(key) = self
            .keys
            .iter_mut()
            .find(|k| k.public_key_fingerprint == fingerprint)
        {
            key.status = KeyStatus::Revoked;
            key.revocation_reason = Some(reason.to_string());
            tracing::warn!(
                "Historical key {} (fingerprint={}) marked REVOKED: {}",
                key.key_id,
                fingerprint,
                reason
            );
            Ok(())
        } else {
            Err(format!(
                "Key with fingerprint {} not found in registry",
                fingerprint
            ))
        }
    }

    /// Persist the historical key registry to disk.
    pub fn save_to_dir(&self, dir: &Path) -> io::Result<()> {
        let path = dir.join("historical_keys.json");
        let tmp_path = dir.join("historical_keys.json.tmp");

        let json = serde_json::to_string_pretty(self)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;

        let mut options = OpenOptions::new();
        options.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            options.mode(0o644);
        }
        let mut file = options.open(&tmp_path)?;
        file.write_all(json.as_bytes())?;
        file.sync_all()?;
        fs::rename(&tmp_path, &path)?;
        Ok(())
    }

    /// Load the historical key registry from disk.
    pub fn load_from_dir(dir: &Path) -> io::Result<Self> {
        let path = dir.join("historical_keys.json");
        if !path.exists() {
            return Ok(Self::new());
        }
        let content = fs::read_to_string(&path)?;
        let registry: Self = serde_json::from_str(&content)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
        Ok(registry)
    }
}
