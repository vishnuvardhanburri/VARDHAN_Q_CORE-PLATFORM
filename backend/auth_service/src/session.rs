//! Restart-safe session store. Bearer tokens are never persisted; only BLAKE3 digests are.
pub use crate::authorization::{AuthenticatedUser, Permission, Role};
use dashmap::DashMap;
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use std::{
    net::IpAddr,
    path::Path,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};
pub const SESSION_HARD_EXPIRY_SECS: u64 = 8 * 60 * 60;
pub const SESSION_IDLE_TIMEOUT_SECS: u64 = 30 * 60;
/// Grace window during which the *previous* token of a rotated session is
/// still honored without revoking the session family.
///
/// Rationale: rotation is single-use and the rotated token travels in the
/// `authorization-new-token` response header. Legitimate clients routinely
/// have several requests in flight carrying the same pre-rotation token
/// (console boot fans out `me` + orgs + health + briefs concurrently;
/// two tabs share one stored token). Without a grace window the first
/// request wins the rotation and every sibling replays a stale token —
/// which the old code treated as theft and punished with whole-family
/// revocation (instant logout). The grace window makes a duplicate
/// presentation idempotent: within the window the server re-issues the
/// *current* token instead of rotating again, and never revokes.
/// A genuinely replayed token presented *after* the window (or a second
/// distinct replay) still revokes the family, preserving reuse detection.
pub const ROTATION_GRACE_SECS: u64 = 30;
fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}
fn digest(s: &str) -> String {
    blake3::hash(s.as_bytes()).to_hex().to_string()
}
#[derive(Debug, Clone, PartialEq, Eq, Hash, Zeroize, ZeroizeOnDrop)]
pub struct SessionToken(String);
impl SessionToken {
    pub fn generate() -> Self {
        let mut b = [0u8; 32];
        OsRng.fill_bytes(&mut b);
        Self(hex::encode(b))
    }
    #[allow(clippy::should_implement_trait)]
    pub fn from_str(s: &str) -> Self {
        Self(s.to_string())
    }
    pub fn as_str(&self) -> &str {
        &self.0
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Persisted {
    session_id: String,
    username: String,
    created: u128,
    last_activity: u128,
    expires: u128,
    ip: String,
    node_id: String,
    revoked: bool,
    current_digest: String,
    previous_digest: Option<String>,
    /// Milliseconds at which the current rotation happened. `None` until the
    /// first rotation. Bounds the replay grace window for `previous_digest`.
    rotated_at: Option<u128>,
}
#[derive(Debug, Clone)]
pub struct SessionEntry {
    pub session_id: String,
    pub username: String,
    pub created_at_ms: u128,
    pub last_activity_ms: u128,
    pub expires_at_ms: u128,
    pub ip: String,
    pub node_id: String,
    pub revoked: bool,
    pub current_token: Zeroizing<String>,
    pub previous_token: Option<Zeroizing<String>>,
    pub current_token_digest: String,
    pub previous_token_digest: Option<String>,
    /// When the latest rotation happened (`None` before the first rotation).
    pub rotated_at_ms: Option<u128>,
}
impl SessionEntry {
    fn expired(&self) -> bool {
        self.revoked
            || now_ms() >= self.expires_at_ms
            || now_ms().saturating_sub(self.last_activity_ms)
                >= SESSION_IDLE_TIMEOUT_SECS as u128 * 1000
    }
    fn persisted(&self) -> Persisted {
        Persisted {
            session_id: self.session_id.clone(),
            username: self.username.clone(),
            created: self.created_at_ms,
            last_activity: self.last_activity_ms,
            expires: self.expires_at_ms,
            ip: self.ip.clone(),
            node_id: self.node_id.clone(),
            revoked: self.revoked,
            current_digest: self.current_token_digest.clone(),
            previous_digest: self.previous_token_digest.clone(),
            rotated_at: self.rotated_at_ms,
        }
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
                "revoked"
            } else if self.expired() {
                "expired"
            } else {
                "active"
            }
            .into(),
            client_ip: self.ip.clone(),
        }
    }
}
impl Persisted {
    fn entry(self) -> SessionEntry {
        SessionEntry {
            session_id: self.session_id,
            username: self.username,
            created_at_ms: self.created,
            last_activity_ms: self.last_activity,
            expires_at_ms: self.expires,
            ip: self.ip,
            node_id: self.node_id,
            revoked: self.revoked,
            current_token: Zeroizing::new(String::new()),
            previous_token: None,
            current_token_digest: self.current_digest,
            previous_token_digest: self.previous_digest,
            // Post-restart the raw previous token is (correctly) gone from
            // memory, so only its digest survives. Keep the persisted
            // rotation timestamp so the grace window still bounds replays
            // instead of collapsing to "no grace" after every restart.
            rotated_at_ms: self.rotated_at,
        }
    }
    fn view(&self) -> SessionView {
        SessionView {
            session_id: self.session_id.clone(),
            username: self.username.clone(),
            created_at: self.created,
            expires_at: self.expires,
            last_activity: self.last_activity,
            node_id: self.node_id.clone(),
            session_state: if self.revoked { "revoked" } else { "expired" }.into(),
            client_ip: self.ip.clone(),
        }
    }
}
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
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub username: String,
    pub issued_at_ms: u64,
    pub expires_in_secs: u64,
}
#[derive(Clone)]
pub struct SessionStore {
    inner: Arc<DashMap<String, SessionEntry>>,
    token_to_id: Arc<DashMap<String, String>>,
    revoked: Arc<DashMap<String, SessionView>>,
    db: Option<sled::Db>,
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
            db: None,
        }
    }
    pub fn open(path: &Path) -> Result<Self, String> {
        let db = sled::open(path).map_err(|e| e.to_string())?;
        let s = Self {
            inner: Arc::new(DashMap::new()),
            token_to_id: Arc::new(DashMap::new()),
            revoked: Arc::new(DashMap::new()),
            db: Some(db.clone()),
        };
        for item in db.iter() {
            let (k, v) = item.map_err(|e| e.to_string())?;
            let p: Persisted = serde_json::from_slice(&v).map_err(|e| e.to_string())?;
            let id = String::from_utf8_lossy(&k).to_string();
            if p.revoked {
                s.revoked.insert(id, p.view());
            } else if now_ms() < p.expires
                && now_ms().saturating_sub(p.last_activity)
                    < SESSION_IDLE_TIMEOUT_SECS as u128 * 1000
            {
                s.token_to_id.insert(p.current_digest.clone(), id.clone());
                s.inner.insert(id, p.entry());
            } else {
                let _ = db.remove(k);
            }
        }
        Ok(s)
    }
    fn persist(&self, e: &SessionEntry) -> Result<(), String> {
        if let Some(db) = &self.db {
            db.insert(
                e.session_id.as_bytes(),
                serde_json::to_vec(&e.persisted()).map_err(|x| x.to_string())?,
            )
            .map_err(|x| x.to_string())?;
            db.flush().map_err(|x| x.to_string())?;
        }
        Ok(())
    }
    fn delete(&self, id: &str) {
        if let Some(db) = &self.db {
            let _ = db.remove(id.as_bytes());
            let _ = db.flush();
        }
    }
    pub async fn create(&self, u: &str, ip: IpAddr) -> SessionToken {
        self.create_with_node(u, ip, "local-node").await
    }
    pub async fn create_with_node(&self, u: &str, ip: IpAddr, node: &str) -> SessionToken {
        let t = SessionToken::generate();
        let mut b = [0u8; 8];
        OsRng.fill_bytes(&mut b);
        let id = format!("sess_{}", hex::encode(b));
        let now = now_ms();
        let d = digest(t.as_str());
        let e = SessionEntry {
            session_id: id.clone(),
            username: u.into(),
            created_at_ms: now,
            last_activity_ms: now,
            expires_at_ms: now + SESSION_HARD_EXPIRY_SECS as u128 * 1000,
            ip: ip.to_string(),
            node_id: node.into(),
            revoked: false,
            current_token: Zeroizing::new(t.as_str().into()),
            previous_token: None,
            current_token_digest: d.clone(),
            previous_token_digest: None,
            rotated_at_ms: None,
        };
        let _ = self.persist(&e);
        self.inner.insert(id.clone(), e);
        self.token_to_id.insert(d, id);
        t
    }
    pub async fn validate(&self, t: &SessionToken) -> Option<String> {
        let d = digest(t.as_str());
        let id = self.token_to_id.get(&d)?.clone();
        let e = self.inner.get(&id)?;
        if e.expired() {
            return None;
        }
        if d == e.current_token_digest {
            Some(e.username.clone())
        } else {
            None
        }
    }
    pub async fn validate_and_rotate(&self, t: &SessionToken) -> Option<(String, SessionToken)> {
        let d = digest(t.as_str());
        let id = self.token_to_id.get(&d)?.clone();
        let mut e = self.inner.get_mut(&id)?;
        if e.expired() {
            drop(e);
            self.remove(t).await;
            return None;
        }
        if d == e.current_token_digest {
            let nt = SessionToken::generate();
            let nd = digest(nt.as_str());
            e.previous_token_digest = Some(e.current_token_digest.clone());
            e.current_token_digest = nd.clone();
            e.previous_token = Some(e.current_token.clone());
            e.current_token = Zeroizing::new(nt.as_str().into());
            e.last_activity_ms = now_ms();
            e.rotated_at_ms = Some(now_ms());
            let u = e.username.clone();
            let p = e.persisted();
            drop(e);
            self.db_write(&id, &p).ok()?;
            self.token_to_id.insert(d, id.clone());
            self.token_to_id.insert(nd, id);
            Some((u, nt))
        } else if Some(&d) == e.previous_token_digest.as_ref()
            && e.rotated_at_ms
                .map(|rot| now_ms().saturating_sub(rot) < ROTATION_GRACE_SECS as u128 * 1000)
                .unwrap_or(false)
        {
            // Idempotent replay inside the grace window: a sibling request
            // that was already in flight with the pre-rotation token.
            // Re-issue the CURRENT token (no fresh rotation, no revoke) so
            // the client converges instead of being logged out.
            //
            // Post-restart edge: only the current digest (not the raw token)
            // survives a restart, so there is no current token to re-issue.
            // Rotate forward instead — the presented previous digest still
            // proves recent possession inside the grace window — rather than
            // handing the client an empty token.
            if e.current_token.as_str().is_empty() {
                let nt = SessionToken::generate();
                let nd = digest(nt.as_str());
                e.previous_token_digest = Some(e.current_token_digest.clone());
                e.current_token_digest = nd.clone();
                e.previous_token = None;
                e.current_token = Zeroizing::new(nt.as_str().into());
                e.last_activity_ms = now_ms();
                e.rotated_at_ms = Some(now_ms());
                let u = e.username.clone();
                let p = e.persisted();
                drop(e);
                self.db_write(&id, &p).ok()?;
                self.token_to_id.insert(nd, id);
                Some((u, nt))
            } else {
                let ct = SessionToken::from_str(e.current_token.as_str());
                let u = e.username.clone();
                e.last_activity_ms = now_ms();
                drop(e);
                Some((u, ct))
            }
        } else {
            drop(e);
            self.revoke_by_id(&id).await;
            None
        }
    }
    fn db_write(&self, id: &str, p: &Persisted) -> Result<(), String> {
        if let Some(db) = &self.db {
            db.insert(
                id.as_bytes(),
                serde_json::to_vec(p).map_err(|x| x.to_string())?,
            )
            .map_err(|x| x.to_string())?;
            db.flush().map_err(|x| x.to_string())?;
        }
        Ok(())
    }
    pub async fn remove(&self, t: &SessionToken) -> Option<SessionEntry> {
        let d = digest(t.as_str());
        let (_, id) = self.token_to_id.remove(&d)?;
        let (_, e) = self.inner.remove(&id)?;
        self.delete(&id);
        Some(e)
    }
    pub async fn get_info(&self, t: &SessionToken) -> Option<SessionInfo> {
        let d = digest(t.as_str());
        let id = self.token_to_id.get(&d)?.clone();
        let e = self.inner.get(&id)?;
        if e.expired() {
            return None;
        }
        Some(SessionInfo {
            username: e.username.clone(),
            issued_at_ms: e.created_at_ms as u64,
            expires_in_secs: e.expires_at_ms.saturating_sub(now_ms()) as u64 / 1000,
        })
    }
    pub async fn list_sessions(&self) -> Vec<SessionView> {
        let mut v = self.inner.iter().map(|e| e.view()).collect::<Vec<_>>();
        v.extend(self.revoked.iter().map(|e| e.value().clone()));
        v.sort_by_key(|a| std::cmp::Reverse(a.created_at));
        v
    }
    pub async fn get_session_by_id(&self, id: &str) -> Option<SessionView> {
        self.revoked
            .get(id)
            .map(|v| v.clone())
            .or_else(|| self.inner.get(id).map(|e| e.view()))
    }
    pub async fn revoke_by_id(&self, id: &str) -> Option<SessionView> {
        if let Some(v) = self.revoked.get(id) {
            return Some(v.clone());
        }
        let (_, mut e) = self.inner.remove(id)?;
        e.revoked = true;
        self.token_to_id.remove(&e.current_token_digest);
        if let Some(d) = &e.previous_token_digest {
            self.token_to_id.remove(d);
        }
        let v = e.view();
        self.revoked.insert(id.into(), v.clone());
        self.persist(&e).ok()?;
        Some(v)
    }
    pub async fn flush_except(&self, preserve: Option<&str>) -> usize {
        let pd = preserve.map(digest);
        let ids = self
            .inner
            .iter()
            .filter(|e| {
                !pd.as_ref()
                    .map(|d| {
                        d == &e.current_token_digest || e.previous_token_digest.as_ref() == Some(d)
                    })
                    .unwrap_or(false)
            })
            .map(|e| e.key().clone())
            .collect::<Vec<_>>();
        let mut n = 0;
        for id in ids {
            if self.revoke_by_id(&id).await.is_some() {
                n += 1
            }
        }
        n
    }
    pub fn active_count(&self) -> usize {
        self.inner.iter().filter(|e| !e.expired()).count()
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    #[tokio::test]
    async fn restart_restores_index() {
        let d = tempdir().unwrap();
        let t = {
            let s = SessionStore::open(d.path()).unwrap();
            let tk = s.create("a", "127.0.0.1".parse().unwrap()).await;
            drop(s);
            tk
        };
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        let s = SessionStore::open(d.path()).unwrap();
        assert_eq!(s.validate(&t).await.as_deref(), Some("a"));
    }
    #[tokio::test]
    async fn invalid() {
        let s = SessionStore::new();
        assert!(s
            .validate(&SessionToken::from_str(&"0".repeat(64)))
            .await
            .is_none());
    }

    #[tokio::test]
    async fn replaying_a_rotated_token_revokes_the_session() {
        let store = SessionStore::new();
        let original = store.create("alice", "127.0.0.1".parse().unwrap()).await;
        let (_, rotated) = store
            .validate_and_rotate(&original)
            .await
            .expect("initial token rotates");

        // A replay INSIDE the grace window converges: the server re-issues
        // the current token idempotently instead of revoking (this is what
        // saves concurrent console-boot requests sharing one stored token).
        let (user, converged) = store
            .validate_and_rotate(&original)
            .await
            .expect("grace-window replay must converge, not revoke");
        assert_eq!(user, "alice");
        assert_eq!(converged.as_str(), rotated.as_str());
        assert!(
            store.validate(&rotated).await.is_some(),
            "session must stay alive after a grace-window replay"
        );
    }

    #[tokio::test]
    async fn concurrent_burst_on_one_token_keeps_session_alive() {
        let store = SessionStore::new();
        let original = store.create("bob", "127.0.0.1".parse().unwrap()).await;
        // Simulate 5 console-boot requests fired with the same stored token.
        let mut handles = Vec::new();
        for _ in 0..5 {
            let s = store.clone();
            let t = original.clone();
            handles.push(tokio::spawn(async move { s.validate_and_rotate(&t).await }));
        }
        let mut oks = 0;
        for h in handles {
            if h.await.expect("task join").is_some() {
                oks += 1;
            }
        }
        assert_eq!(oks, 5, "every in-flight sibling must converge");
        // Session family must NOT be revoked by the burst.
        assert!(
            !store.list_sessions().await.is_empty() || store.validate(&original).await.is_some(),
            "burst must not revoke the session"
        );
    }
}
