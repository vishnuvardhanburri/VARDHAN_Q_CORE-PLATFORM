//! Per-IP brute-force rate limiting for the login endpoint.
//!
//! ## Policy
//!
//! - Maximum **10 failed** attempts per IP per **15-minute** sliding window
//! - On the 11th attempt: `429 Too Many Requests`
//! - Window resets after 15 minutes of no new failures from that IP
//! - Successful login resets the counter for that IP immediately
//!
//! ## Design
//!
//! In-memory `DashMap` — intentionally not persisted. This means a process
//! restart clears all rate limit state. This is acceptable for a single-node
//! admin panel where an attacker who can restart the process already has
//! greater access than the rate limiter would prevent.
//!
//! SEC-009 NOTE: For a multi-node deployment, replace with a shared Redis/Valkey counter.
//! Currently, an attacker can bypass rate limits by rotating requests across multiple nodes
//! or intentionally crashing the process to reset the counter.

use std::net::IpAddr;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use sled::{Db, Tree};

const MAX_FAILURES: u32 = 10;
const WINDOW: Duration = Duration::from_secs(15 * 60); // 15 minutes

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredBucket {
    failures: u32,
    window_start_secs: u64,
}

#[derive(Debug)]
struct Bucket {
    failures: u32,
    window_start: Instant,
    window_start_epoch: u64,
}

impl Bucket {
    fn new() -> Self {
        let now_epoch = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        Self {
            failures: 0,
            window_start: Instant::now(),
            window_start_epoch: now_epoch,
        }
    }

    fn from_stored(stored: StoredBucket) -> Option<Self> {
        let now_epoch = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        if now_epoch.saturating_sub(stored.window_start_secs) > WINDOW.as_secs() {
            return None;
        }
        let elapsed_secs = now_epoch.saturating_sub(stored.window_start_secs);
        let window_start = Instant::now()
            .checked_sub(Duration::from_secs(elapsed_secs))
            .unwrap_or_else(Instant::now);
        Some(Self {
            failures: stored.failures,
            window_start,
            window_start_epoch: stored.window_start_secs,
        })
    }

    /// True if the window has expired and the bucket should be reset.
    fn is_stale(&self) -> bool {
        self.window_start.elapsed() > WINDOW
    }

    fn to_stored(&self) -> StoredBucket {
        StoredBucket {
            failures: self.failures,
            window_start_secs: self.window_start_epoch,
        }
    }
}

/// Thread-safe per-IP rate limiter with persistent sled storage.
#[derive(Clone)]
pub struct RateLimiter {
    buckets: Arc<DashMap<IpAddr, Bucket>>,
    tree: Option<Tree>,
}

impl RateLimiter {
    pub fn new() -> Self {
        Self {
            buckets: Arc::new(DashMap::new()),
            tree: None,
        }
    }

    pub fn with_db(db: &Db) -> Self {
        let tree = db.open_tree("auth_rate_limits").ok();
        Self {
            buckets: Arc::new(DashMap::new()),
            tree,
        }
    }

    pub fn with_tree(tree: Tree) -> Self {
        Self {
            buckets: Arc::new(DashMap::new()),
            tree: Some(tree),
        }
    }

    /// Returns `true` if this IP is currently rate-limited (should be rejected).
    pub fn is_blocked(&self, ip: IpAddr) -> bool {
        if let Some(bucket) = self.buckets.get(&ip) {
            if bucket.is_stale() {
                return false;
            }
            return bucket.failures >= MAX_FAILURES;
        }

        if let Some(ref tree) = self.tree {
            if let Ok(Some(bytes)) = tree.get(ip.to_string().as_bytes()) {
                if let Ok(stored) = serde_json::from_slice::<StoredBucket>(&bytes) {
                    if let Some(restored) = Bucket::from_stored(stored) {
                        let blocked = restored.failures >= MAX_FAILURES;
                        self.buckets.insert(ip, restored);
                        return blocked;
                    } else {
                        let _ = tree.remove(ip.to_string().as_bytes());
                    }
                }
            }
        }

        false
    }

    /// Record a failed login attempt for `ip`.
    pub fn record_failure(&self, ip: IpAddr) {
        let mut entry = self.buckets.entry(ip).or_insert_with(|| {
            if let Some(ref tree) = self.tree {
                if let Ok(Some(bytes)) = tree.get(ip.to_string().as_bytes()) {
                    if let Ok(stored) = serde_json::from_slice::<StoredBucket>(&bytes) {
                        if let Some(restored) = Bucket::from_stored(stored) {
                            return restored;
                        }
                    }
                }
            }
            Bucket::new()
        });

        if entry.is_stale() {
            // Reset the window
            *entry = Bucket::new();
        }
        entry.failures = entry.failures.saturating_add(1);
        let stored = entry.to_stored();

        if let Some(ref tree) = self.tree {
            if let Ok(bytes) = serde_json::to_vec(&stored) {
                let _ = tree.insert(ip.to_string().as_bytes(), bytes);
                let _ = tree.flush();
            }
        }
    }

    /// Reset the failure counter for `ip` (call on successful login).
    pub fn reset(&self, ip: IpAddr) {
        self.buckets.remove(&ip);
        if let Some(ref tree) = self.tree {
            let _ = tree.remove(ip.to_string().as_bytes());
            let _ = tree.flush();
        }
    }

    /// Current failure count for `ip` (for testing / monitoring).
    pub fn failure_count(&self, ip: IpAddr) -> u32 {
        if let Some(b) = self.buckets.get(&ip) {
            if !b.is_stale() {
                return b.failures;
            }
        }
        if let Some(ref tree) = self.tree {
            if let Ok(Some(bytes)) = tree.get(ip.to_string().as_bytes()) {
                if let Ok(stored) = serde_json::from_slice::<StoredBucket>(&bytes) {
                    if let Some(restored) = Bucket::from_stored(stored) {
                        return restored.failures;
                    }
                }
            }
        }
        0
    }
}

impl Default for RateLimiter {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::Ipv4Addr;

    fn ip(n: u8) -> IpAddr {
        IpAddr::V4(Ipv4Addr::new(10, 0, 0, n))
    }

    #[test]
    fn test_not_blocked_initially() {
        let rl = RateLimiter::new();
        assert!(!rl.is_blocked(ip(1)));
    }

    #[test]
    fn test_blocked_after_max_failures() {
        let rl = RateLimiter::new();
        for _ in 0..MAX_FAILURES {
            rl.record_failure(ip(2));
        }
        assert!(
            rl.is_blocked(ip(2)),
            "should be blocked after {} failures",
            MAX_FAILURES
        );
    }

    #[test]
    fn test_not_blocked_before_max() {
        let rl = RateLimiter::new();
        for _ in 0..(MAX_FAILURES - 1) {
            rl.record_failure(ip(3));
        }
        assert!(!rl.is_blocked(ip(3)));
    }

    #[test]
    fn test_reset_clears_block() {
        let rl = RateLimiter::new();
        for _ in 0..MAX_FAILURES {
            rl.record_failure(ip(4));
        }
        assert!(rl.is_blocked(ip(4)));
        rl.reset(ip(4));
        assert!(!rl.is_blocked(ip(4)));
    }

    #[test]
    fn test_different_ips_independent() {
        let rl = RateLimiter::new();
        for _ in 0..MAX_FAILURES {
            rl.record_failure(ip(5));
        }
        assert!(rl.is_blocked(ip(5)));
        assert!(!rl.is_blocked(ip(6)), "different IP must not be blocked");
    }

    #[test]
    fn test_failure_count_tracked() {
        let rl = RateLimiter::new();
        rl.record_failure(ip(7));
        rl.record_failure(ip(7));
        rl.record_failure(ip(7));
        assert_eq!(rl.failure_count(ip(7)), 3);
    }

    #[test]
    fn test_rate_limiter_persists_across_restart() {
        let temp_dir = tempfile::tempdir().unwrap();
        let db = sled::open(temp_dir.path()).unwrap();

        // Node 1 instance records failures and reaches blocked state
        let rl1 = RateLimiter::with_db(&db);
        for _ in 0..MAX_FAILURES {
            rl1.record_failure(ip(8));
        }
        assert!(rl1.is_blocked(ip(8)));
        assert_eq!(rl1.failure_count(ip(8)), MAX_FAILURES);

        // Simulate process crash / restart by dropping rl1 and opening a new RateLimiter instance
        drop(rl1);

        let rl2 = RateLimiter::with_db(&db);
        // Verified: The block and failure count survive restart
        assert!(
            rl2.is_blocked(ip(8)),
            "Rate limit block MUST survive process restart"
        );
        assert_eq!(rl2.failure_count(ip(8)), MAX_FAILURES);

        // Reset also persists
        rl2.reset(ip(8));
        assert!(!rl2.is_blocked(ip(8)));
    }
}
