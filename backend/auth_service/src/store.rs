//! Persistent credential storage backed by `sled` embedded key-value store.
//!
//! ## Schema
//!
//! Key:   `b"cred:" || username_bytes`  
//! Value: Argon2id PHC string (UTF-8)
//!
//! ## Bootstrap
//!
//! On first startup with an empty store, reads `VARDHAN_ADMIN_USERNAME` and
//! `VARDHAN_ADMIN_PASSWORD` env vars, hashes the password with Argon2id, and
//! persists only the PHC hash. Refuses to start if neither env vars nor
//! existing credentials are present.
//!
//! ## Security
//!
//! - No plaintext passwords are ever written to the database
//! - The password env var value is dropped (zeroed from stack) immediately
//!   after hashing
//! - PHC format is self-describing — parameter migration works without schema changes

use std::path::Path;
use std::sync::Arc;

const CRED_PREFIX: &[u8] = b"cred:";

/// Thread-safe handle to the credential store.
#[derive(Clone)]
pub struct CredentialStore {
    pub(crate) db: Arc<sled::Db>,
}

impl CredentialStore {
    /// Open the store at `path`, creating it if it does not exist.
    pub fn open(path: &Path) -> Result<Self, String> {
        let db = sled::open(path)
            .map_err(|e| format!("Failed to open credential store at {}: {e}", path.display()))?;
        Ok(Self { db: Arc::new(db) })
    }

    /// Open the store and bootstrap from env vars if no users exist.
    ///
    /// # Fatal (returns `Err`)
    ///
    /// - Store cannot be opened
    /// - No users exist and bootstrap credentials cannot be securely loaded
    /// - Password is shorter than 12 characters
    /// - Argon2id hashing fails (should never happen with valid params)
    pub fn open_or_bootstrap(path: &Path) -> Result<Self, String> {
        let store = Self::open(path)?;

        if store.user_count() == 0 {
            tracing::info!("Credential store is empty — bootstrapping from secure sources");

            let username = crate::secrets::SecretReader::read_bootstrap_username()
                .map_err(|e| format!("FATAL: {e}"))?;

            let password = crate::secrets::SecretReader::read_bootstrap_password()
                .map_err(|e| format!("FATAL: {e}"))?;

            if password.len() < 12 {
                return Err("FATAL: Bootstrap password must be at least 12 characters.".to_string());
            }

            // Hash password — this is the only place a plaintext password exists in Rust memory
            let phc = crate::credentials::hash_password(&password)
                .map_err(|e| format!("FATAL: Bootstrap password hashing failed: {e}"))?;

            // password is a Zeroizing<String>, so it will be wiped on drop.
            drop(password);

            store.set_phc_sync(&username, &phc)?;

            tracing::warn!(
                username = %username,
                "Bootstrap credential stored. IMPORTANT: Remove bootstrap secrets from your environment or filesystem and restart."
            );
        }

        Ok(store)
    }

    // ── Internal KV helpers ───────────────────────────────────────────────────

    fn key(username: &str) -> Vec<u8> {
        let mut k = CRED_PREFIX.to_vec();
        k.extend_from_slice(username.as_bytes());
        k
    }

    /// Synchronous PHC write — used during bootstrap before async runtime matters.
    pub fn set_phc_sync(&self, username: &str, phc: &str) -> Result<(), String> {
        self.db
            .insert(Self::key(username), phc.as_bytes())
            .map(|_| ())
            .map_err(|e| format!("Credential write failed: {e}"))
    }

    /// Synchronous PHC read.
    pub fn get_phc_sync(&self, username: &str) -> Option<String> {
        self.db
            .get(Self::key(username))
            .ok()
            .flatten()
            .and_then(|v| String::from_utf8(v.to_vec()).ok())
    }

    // ── Public async API ──────────────────────────────────────────────────────

    /// Retrieve the stored PHC hash for `username`, or `None` if not found.
    pub async fn get_phc(&self, username: &str) -> Option<String> {
        self.db
            .get(Self::key(username))
            .ok()
            .flatten()
            .and_then(|v| String::from_utf8(v.to_vec()).ok())
    }

    /// Store or update the PHC hash for `username`.
    pub async fn set_phc(&self, username: &str, phc: &str) -> Result<(), String> {
        self.db
            .insert(Self::key(username), phc.as_bytes())
            .map(|_| ())
            .map_err(|e| format!("Credential write failed: {e}"))
    }

    /// Remove a user. Returns `true` if the user existed.
    pub async fn remove_user(&self, username: &str) -> Result<bool, String> {
        self.db
            .remove(Self::key(username))
            .map(|old| old.is_some())
            .map_err(|e| format!("Credential remove failed: {e}"))
    }

    /// Count all stored users.
    pub fn user_count(&self) -> usize {
        self.db
            .scan_prefix(CRED_PREFIX)
            .filter_map(|r| r.ok())
            .count()
    }

    /// List all stored usernames.
    pub async fn list_usernames(&self) -> Vec<String> {
        self.db
            .scan_prefix(CRED_PREFIX)
            .filter_map(|r| r.ok())
            .filter_map(|(k, _)| {
                let bytes = k.to_vec();
                let suffix = bytes.get(CRED_PREFIX.len()..)?;
                String::from_utf8(suffix.to_vec()).ok()
            })
            .collect()
    }
}

// ── Credential verification (delegates to credentials module) ─────────────────

impl CredentialStore {
    /// Verify `username` + `password` with constant-time Argon2id comparison.
    ///
    /// Always runs Argon2 — even when the username does not exist — to prevent
    /// timing-based username enumeration.
    pub async fn verify(&self, username: &str, password: &str) -> bool {
        let phc = self.get_phc(username).await;
        let hash_to_check = match &phc {
            Some(h) => h.as_str(),
            None => crate::credentials::sentinel_hash(),
        };
        let verified = crate::credentials::verify_password(password, hash_to_check);
        // If username didn't exist, always return false even if sentinel matched
        verified && phc.is_some()
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

    #[tokio::test]
    async fn test_store_and_retrieve() {
        let s = temp_store();
        s.set_phc("alice", "$argon2id$placeholder").await.unwrap();
        assert_eq!(
            s.get_phc("alice").await.as_deref(),
            Some("$argon2id$placeholder")
        );
    }

    #[tokio::test]
    async fn test_unknown_user_returns_none() {
        let s = temp_store();
        assert!(s.get_phc("ghost").await.is_none());
    }

    #[tokio::test]
    async fn test_user_count() {
        let s = temp_store();
        assert_eq!(s.user_count(), 0);
        s.set_phc("alice", "hash1").await.unwrap();
        s.set_phc("bob", "hash2").await.unwrap();
        assert_eq!(s.user_count(), 2);
    }

    #[tokio::test]
    async fn test_remove_user() {
        let s = temp_store();
        s.set_phc("alice", "hash").await.unwrap();
        assert!(s.remove_user("alice").await.unwrap());
        assert_eq!(s.user_count(), 0);
        assert!(!s.remove_user("alice").await.unwrap()); // already gone
    }

    #[tokio::test]
    async fn test_list_usernames() {
        let s = temp_store();
        s.set_phc("zara", "h1").await.unwrap();
        s.set_phc("alice", "h2").await.unwrap();
        let mut names = s.list_usernames().await;
        names.sort();
        assert_eq!(names, vec!["alice", "zara"]);
    }

    #[tokio::test]
    async fn test_verify_correct_password() {
        let s = temp_store();
        let phc = crate::credentials::hash_password("hunter2_secure").unwrap();
        s.set_phc("bob", &phc).await.unwrap();
        assert!(s.verify("bob", "hunter2_secure").await);
    }

    #[tokio::test]
    async fn test_verify_wrong_password() {
        let s = temp_store();
        let phc = crate::credentials::hash_password("real_password_12").unwrap();
        s.set_phc("carol", &phc).await.unwrap();
        assert!(!s.verify("carol", "wrong_password").await);
    }

    #[tokio::test]
    async fn test_verify_unknown_user_returns_false() {
        // Must still run Argon2 — verified by the sentinel path
        let s = temp_store();
        assert!(!s.verify("nobody", "any_password").await);
    }
}
