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
use std::time::{Duration, Instant};

use dashmap::DashMap;

const MAX_FAILURES: u32 = 10;
const WINDOW: Duration = Duration::from_secs(15 * 60); // 15 minutes

#[derive(Debug)]
struct Bucket {
    failures: u32,
    window_start: Instant,
}

impl Bucket {
    fn new() -> Self {
        Self {
            failures: 0,
            window_start: Instant::now(),
        }
    }

    /// True if the window has expired and the bucket should be reset.
    fn is_stale(&self) -> bool {
        self.window_start.elapsed() > WINDOW
    }
}

/// Thread-safe per-IP rate limiter.
#[derive(Clone)]
pub struct RateLimiter {
    buckets: Arc<DashMap<IpAddr, Bucket>>,
}

impl RateLimiter {
    pub fn new() -> Self {
        Self {
            buckets: Arc::new(DashMap::new()),
        }
    }

    /// Returns `true` if this IP is currently rate-limited (should be rejected).
    pub fn is_blocked(&self, ip: IpAddr) -> bool {
        if let Some(bucket) = self.buckets.get(&ip) {
            if bucket.is_stale() {
                // Window has expired — not blocked
                return false;
            }
            bucket.failures >= MAX_FAILURES
        } else {
            false
        }
    }

    /// Record a failed login attempt for `ip`.
    pub fn record_failure(&self, ip: IpAddr) {
        let mut entry = self.buckets.entry(ip).or_insert_with(Bucket::new);
        if entry.is_stale() {
            // Reset the window
            *entry = Bucket::new();
        }
        entry.failures = entry.failures.saturating_add(1);
    }

    /// Reset the failure counter for `ip` (call on successful login).
    pub fn reset(&self, ip: IpAddr) {
        self.buckets.remove(&ip);
    }

    /// Current failure count for `ip` (for testing / monitoring).
    pub fn failure_count(&self, ip: IpAddr) -> u32 {
        self.buckets
            .get(&ip)
            .filter(|b| !b.is_stale())
            .map(|b| b.failures)
            .unwrap_or(0)
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
}
