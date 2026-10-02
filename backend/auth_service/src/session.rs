//! In-process thread-safe session store with safe metadata enumeration and revocation.
//!
//! Sessions are held in a `DashMap` keyed by opaque session tokens.
//! Safe session identifiers (`session_id`) are separate 16-hex random strings
//! so that session listing and management never leak the secret session token.
//!
//! ## Expiry model
//! - Hard expiry: `SESSION_HARD_EXPIRY_SECS` (8 hours) after issuance
//! - Sliding window: `SESSION_IDLE_TIMEOUT_SECS` (30 minutes) after last activity
//! - Whichever comes first wins

use std::net::IpAddr;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use dashmap::DashMap;
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

pub use crate::authorization::{AuthenticatedUser, Permission, Role};

/// Hard session lifetime: 8 hours.
pub const SESSION_HARD_EXPIRY_SECS: u64 = 8 * 60 * 60;
/// Inactivity timeout: 30 minutes.
pub const SESSION_IDLE_TIMEOUT_SECS: u64 = 30 * 60;

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

/// Opaque session token: 32 random bytes as lowercase hex (64 characters).
/// This secret is sent in the Authorization header and MUST NEVER be exposed in metadata APIs.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Zeroize, ZeroizeOnDrop)]
pub struct SessionToken(String);

impl SessionToken {
    /// Generate a new cryptographically random session token.
    pub fn generate() -> Self {
        let mut bytes = [0u8; 32];
        OsRng.fill_bytes(&mut bytes);
        Self(hex::encode(bytes))
    }

    pub fn from_str(s: &str) -> Self {
        Self(s.to_string())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Internal session entry.
#[derive(Debug, Clone)]
pub struct SessionEntry {
    /// Safe public identifier (e.g. sess_0123456789abcdef) — safe to expose in APIs.
    pub session_id: String,
    pub username: String,
    pub created_at_ms: u128,
    pub last_activity_ms: u128,
    pub expires_at_ms: u128,
    pub ip: String,
    pub node_id: String,
    pub revoked: bool,
    /// The current valid secret token.
    pub current_token: Zeroizing<String>,
    /// The immediately preceding token, kept for race condition handling.
    pub previous_token: Option<Zeroizing<String>>,
}

impl SessionEntry {
    pub fn is_expired(&self) -> bool {
        if self.revoked {
            return true;
        }
        let now = now_ms();
        let hard_expired = now >= self.expires_at_ms;
        let idle_expired =
            now.saturating_sub(self.last_activity_ms) >= (SESSION_IDLE_TIMEOUT_SECS as u128 * 1000);
        hard_expired || idle_expired
    }

    pub fn state_str(&self) -> &'static str {
        if self.revoked {
            "revoked"
        } else if self.is_expired() {
            "expired"
        } else {
            "active"
        }
    }

    pub fn to_view(&self) -> SessionView {
        SessionView {
            session_id: self.session_id.clone(),
            username: self.username.clone(),
            created_at: self.created_at_ms,
            expires_at: self.expires_at_ms,
            last_activity: self.last_activity_ms,
            node_id: self.node_id.clone(),
            session_state: self.state_str().to_string(),
            client_ip: self.ip.clone(),
        }
    }
}

/// Safe public session metadata returned by `GET /api/v1/sessions`.
/// Strictly contains no tokens, hashes, or passwords.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SessionView {
    pub session_id: String,
    pub username: String,
    pub created_at: u128,
    pub expires_at: u128,
    pub last_activity: u128,
    pub node_id: String,
    pub session_state: String,
    pub client_ip: String,
}

/// Non-sensitive session info returned by `GET /api/v1/auth/session`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub username: String,
    pub issued_at_ms: u64,
    pub expires_in_secs: u64,
}

/// Thread-safe in-memory session store.
#[derive(Clone)]
pub struct SessionStore {
    /// Maps safe `session_id -> SessionEntry`
    inner: Arc<DashMap<String, SessionEntry>>,
    /// Maps secret `token_str -> session_id` for fast lookup
    token_to_id: Arc<DashMap<String, String>>,
    /// Retains recently revoked sessions for idempotent revocation, status check, and audit
    revoked: Arc<DashMap<String, SessionView>>,
}

impl Default for SessionStore {
    fn default() -> Self {
        Self::new()
    }
}

impl SessionStore {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(DashMap::new()),
            token_to_id: Arc::new(DashMap::new()),
            revoked: Arc::new(DashMap::new()),
        }
    }

    /// Create a new session for `username` from `ip`.
    /// Generates both a secret `SessionToken` and a safe `session_id`.
    pub async fn create(&self, username: &str, ip: IpAddr) -> SessionToken {
        self.create_with_node(username, ip, "local-node").await
    }

    /// Create a new session with explicit `node_id`.
    pub async fn create_with_node(
        &self,
        username: &str,
        ip: IpAddr,
        node_id: &str,
    ) -> SessionToken {
        let token = SessionToken::generate();
        let mut id_bytes = [0u8; 8];
        OsRng.fill_bytes(&mut id_bytes);
        let session_id = format!("sess_{}", hex::encode(id_bytes));

        let now = now_ms();
        let entry = SessionEntry {
            session_id: session_id.clone(),
            username: username.to_string(),
            created_at_ms: now,
            last_activity_ms: now,
            expires_at_ms: now + (SESSION_HARD_EXPIRY_SECS as u128 * 1000),
            ip: ip.to_string(),
            node_id: node_id.to_string(),
            revoked: false,
            current_token: Zeroizing::new(token.as_str().to_string()),
            previous_token: None,
        };

        self.inner.insert(session_id.clone(), entry);
        self.token_to_id
            .insert(token.as_str().to_string(), session_id);
        token
    }

    /// Validate a token and rotate it to prevent theft.
    ///
    /// Returns `Some((username, new_token))` if valid, `None` if missing, expired, or revoked.
    /// If a stolen token is detected (token not current or previous), the session is revoked.
    pub async fn validate_and_rotate(
        &self,
        token: &SessionToken,
    ) -> Option<(String, SessionToken)> {
        let token_str = token.as_str();

        let session_id = self.token_to_id.get(token_str)?.clone();
        let mut entry = self.inner.get_mut(&session_id)?;

        if entry.is_expired() {
            drop(entry);
            self.inner.remove(&session_id);
            self.token_to_id.remove(token_str);
            return None;
        }

        // --- Token Rotation Logic ---
        if token_str == entry.current_token.as_str() {
            // Normal path: rotate current to previous
            let new_token = SessionToken::generate();
            let new_token_str = new_token.as_str().to_string();

            entry.previous_token = Some(entry.current_token.clone());
            entry.current_token = Zeroizing::new(new_token_str.clone());
            entry.last_activity_ms = now_ms();

            let username = entry.username.clone();
            drop(entry);
            self.token_to_id.remove(token_str);
            self.token_to_id.insert(new_token_str, session_id);

            Some((username, new_token))
        } else if entry.previous_token.as_ref().map(|s| s.as_str()) == Some(token_str) {
            // Race condition path: token is the previous one.
            // Still valid, but must return the current one.
            let current_token_str = entry.current_token.as_str().to_string();
            entry.last_activity_ms = now_ms();

            let current_token = SessionToken::from_str(&current_token_str);
            Some((entry.username.clone(), current_token))
        } else {
            // STOLEN TOKEN DETECTED: Token is neither current nor previous.
            // Fail-closed: Revoke the entire session immediately.
            entry.revoked = true;
            let session_id_clone = session_id.clone();
            let username = entry.username.clone();
            drop(entry);

            self.revoke_by_id(&session_id_clone).await;
            self.token_to_id.remove(token_str);

            tracing::warn!(
                username = %username,
                session_id = %session_id_clone,
                "Session theft detected: token mismatch. Revoking session."
            );
            None
        }
    }

    /// Validate a token without rotation (e.g. for simple checks).
    pub async fn validate(&self, token: &SessionToken) -> Option<String> {
        let token_str = token.as_str();
        let session_id = self.token_to_id.get(token_str)?.clone();
        let entry = self.inner.get(&session_id)?;

        if entry.is_expired() {
            return None;
        }
        Some(entry.username.clone())
    }

    /// Remove a session (logout).
    pub async fn remove(&self, token: &SessionToken) -> Option<SessionEntry> {
        let token_str = token.as_str();
        if let Some((_, session_id)) = self.token_to_id.remove(token_str) {
            if let Some((_, entry)) = self.inner.remove(&session_id) {
                return Some(entry);
            }
        }
        None
    }

    /// Return non-sensitive session metadata for the info endpoint.
    pub async fn get_info(&self, token: &SessionToken) -> Option<SessionInfo> {
        let token_str = token.as_str();
        let session_id = self.token_to_id.get(token_str)?.clone();
        let entry = self.inner.get(&session_id)?;

        if entry.is_expired() {
            return None;
        }
        let now = now_ms();
        let remaining_ms = entry.expires_at_ms.saturating_sub(now);
        Some(SessionInfo {
            username: entry.username.clone(),
            issued_at_ms: entry.created_at_ms as u64,
            expires_in_secs: (remaining_ms / 1000) as u64,
        })
    }

    /// List all sessions as safe public views (never revealing tokens).
    pub async fn list_sessions(&self) -> Vec<SessionView> {
        let mut list: Vec<SessionView> = self.inner.iter().map(|e| e.value().to_view()).collect();
        for r in self.revoked.iter() {
            list.push(r.value().clone());
        }
        // Sort newest first
        list.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        list
    }

    /// Get safe view of a specific session by `session_id`.
    pub async fn get_session_by_id(&self, session_id: &str) -> Option<SessionView> {
        if let Some(view) = self.revoked.get(session_id) {
            return Some(view.clone());
        }
        if let Some(entry) = self.inner.get(session_id) {
            return Some(entry.to_view());
        }
        None
    }

    /// Revoke a session by safe `session_id`.
    ///
    /// Idempotent: revoking an already revoked session succeeds and returns the view.
    /// Returns `Some(SessionView)` if found, `None` if not found.
    pub async fn revoke_by_id(&self, session_id: &str) -> Option<SessionView> {
        if let Some(view) = self.revoked.get(session_id) {
            return Some(view.clone());
        }

        if let Some((_, mut entry)) = self.inner.remove(session_id) {
            entry.revoked = true;
            let view = entry.to_view();
            self.revoked.insert(session_id.to_string(), view.clone());

            // Also remove all associated tokens from the lookup map
            self.token_to_id.remove(entry.current_token.as_str());
            if let Some(prev) = &entry.previous_token {
                self.token_to_id.remove(prev.as_str());
            }

            Some(view)
        } else {
            None
        }
    }

    /// Revoke all active sessions EXCEPT the caller's session (to prevent operator lockout).
    /// Returns the number of sessions revoked.
    pub async fn flush_except(&self, preserve_token: Option<&str>) -> usize {
        let mut count = 0;
        let keys_to_revoke: Vec<(String, String)> = self
            .inner
            .iter()
            .filter(|e| {
                if let Some(p) = preserve_token {
                    e.value().current_token.as_str() != p
                        && e.value().previous_token.as_ref().map(|s| s.as_str()) != Some(p)
                } else {
                    true
                }
            })
            .map(|e| (e.key().clone(), e.value().session_id.clone()))
            .collect();

        for (session_id, _) in keys_to_revoke {
            if let Some((_, mut entry)) = self.inner.remove(&session_id) {
                entry.revoked = true;
                self.revoked.insert(session_id, entry.to_view());

                // Clean up tokens
                self.token_to_id.remove(entry.current_token.as_str());
                if let Some(prev) = &entry.previous_token {
                    self.token_to_id.remove(prev.as_str());
                }
                count += 1;
            }
        }

        count
    }

    /// Return the number of currently active (non-expired, non-revoked) sessions.
    pub fn active_count(&self) -> usize {
        self.inner.iter().filter(|e| !e.is_expired()).count()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::Ipv4Addr;

    fn ip() -> IpAddr {
        IpAddr::V4(Ipv4Addr::LOCALHOST)
    }

    #[tokio::test]
    async fn test_create_and_validate() {
        let store = SessionStore::new();
        let token = store.create("alice", ip()).await;
        let user = store.validate(&token).await;
        assert_eq!(user.as_deref(), Some("alice"));
    }

    #[tokio::test]
    async fn test_invalid_token_rejected() {
        let store = SessionStore::new();
        let fake = SessionToken::from_str("0".repeat(64).as_str());
        assert!(store.validate(&fake).await.is_none());
    }

    #[tokio::test]
    async fn test_logout_invalidates_session() {
        let store = SessionStore::new();
        let token = store.create("bob", ip()).await;
        assert!(store.validate(&token).await.is_some());
        store.remove(&token).await;
        assert!(store.validate(&token).await.is_none());
    }

    #[tokio::test]
    async fn test_token_has_64_hex_chars() {
        let t = SessionToken::generate();
        assert_eq!(t.as_str().len(), 64);
        assert!(t.as_str().chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[tokio::test]
    async fn test_two_tokens_are_unique() {
        let t1 = SessionToken::generate();
        let t2 = SessionToken::generate();
        assert_ne!(t1, t2);
    }

    #[tokio::test]
    async fn test_active_count() {
        let store = SessionStore::new();
        assert_eq!(store.active_count(), 0);
        let _t1 = store.create("alice", ip()).await;
        let _t2 = store.create("bob", ip()).await;
        assert_eq!(store.active_count(), 2);
    }

    #[tokio::test]
    async fn test_list_and_revoke_by_id() {
        let store = SessionStore::new();
        let t1 = store.create("alice", ip()).await;
        let t2 = store.create("bob", ip()).await;

        let sessions = store.list_sessions().await;
        assert_eq!(sessions.len(), 2);
        let alice_sess = sessions.iter().find(|s| s.username == "alice").unwrap();
        assert_eq!(alice_sess.session_state, "active");
        assert!(alice_sess.session_id.starts_with("sess_"));

        // Revoke alice's session by safe session_id
        let revoked = store.revoke_by_id(&alice_sess.session_id).await;
        assert!(revoked.is_some());
        assert_eq!(revoked.unwrap().session_state, "revoked");

        // Alice token is now rejected
        assert!(store.validate(&t1).await.is_none());
        // Bob token remains valid
        assert!(store.validate(&t2).await.is_some());
    }

    #[tokio::test]
    async fn test_flush_except_preserves_caller() {
        let store = SessionStore::new();
        let admin_token = store.create("admin", ip()).await;
        let user1_token = store.create("user1", ip()).await;
        let user2_token = store.create("user2", ip()).await;

        assert_eq!(store.active_count(), 3);

        // Flush all except admin
        let flushed = store.flush_except(Some(admin_token.as_str())).await;
        assert_eq!(flushed, 2);

        // Admin session is preserved
        assert_eq!(store.validate(&admin_token).await.as_deref(), Some("admin"));
        // User sessions are gone
        assert!(store.validate(&user1_token).await.is_none());
        assert!(store.validate(&user2_token).await.is_none());
    }
}
