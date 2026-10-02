//! ha_cluster::drain — Graceful drain controller
//!
//! On SIGTERM the gateway must:
//!   1. Stop accepting new TCP connections.
//!   2. Broadcast Draining state to peers via heartbeat.
//!   3. Wait for active sessions to complete (bounded by timeout).
//!   4. Exit cleanly.
//!
//! The drain controller is wired in pq_shield/src/main.rs via tokio::select!
//! on the SIGTERM signal.

use crate::{ClusterMembership, NodeId};
use std::sync::{
    atomic::{AtomicU32, Ordering},
    Arc,
};
use tokio::time::{sleep, timeout, Duration};

/// Tracks the count of active sessions on this node.
///
/// Incremented when a session starts, decremented when it ends.
/// DrainController waits for this to reach zero before exiting.
#[derive(Clone, Default)]
pub struct ActiveSessionCounter {
    count: Arc<AtomicU32>,
}

impl ActiveSessionCounter {
    pub fn new() -> Self {
        Self::default()
    }

    /// Call when a new session is established.
    pub fn increment(&self) {
        self.count.fetch_add(1, Ordering::Relaxed);
    }

    /// Call when a session ends (connection closed).
    pub fn decrement(&self) {
        self.count.fetch_sub(1, Ordering::Relaxed);
    }

    /// Current number of active sessions.
    pub fn current(&self) -> u32 {
        self.count.load(Ordering::Relaxed)
    }
}

/// Graceful drain controller.
pub struct DrainController {
    self_node_id: NodeId,
    membership: Arc<ClusterMembership>,
    active_sessions: ActiveSessionCounter,
    /// Maximum time to wait for active sessions to finish before force-exit.
    drain_timeout: Duration,
}

impl DrainController {
    pub fn new(
        self_node_id: NodeId,
        membership: Arc<ClusterMembership>,
        active_sessions: ActiveSessionCounter,
        drain_timeout_secs: u64,
    ) -> Self {
        DrainController {
            self_node_id,
            membership,
            active_sessions,
            drain_timeout: Duration::from_secs(drain_timeout_secs),
        }
    }

    /// Execute the drain sequence. Awaiting this future blocks until drain is
    /// complete or the timeout fires.
    ///
    /// Returns `true` if drain completed cleanly, `false` if timeout fired.
    pub async fn drain(&self) -> bool {
        info!(
            node_id = %self.self_node_id,
            "SIGTERM received — beginning graceful drain"
        );

        // Step 1: mark self as Draining in the membership table
        if let Err(e) = self.membership.mark_draining(&self.self_node_id).await {
            warn!(err = %e, "Could not mark self Draining in membership (node may not be registered)");
        }

        // Step 2: wait for active sessions to finish
        let active = self.active_sessions.clone();
        let wait_result = timeout(self.drain_timeout, async move {
            loop {
                let n = active.current();
                if n == 0 {
                    break;
                }
                info!(
                    active_sessions = n,
                    "Draining — waiting for sessions to finish..."
                );
                sleep(Duration::from_millis(500)).await;
            }
        })
        .await;

        match wait_result {
            Ok(_) => {
                info!(node_id = %self.self_node_id, "Drain complete — all sessions finished cleanly");
                true
            }
            Err(_) => {
                warn!(
                    node_id = %self.self_node_id,
                    active = self.active_sessions.current(),
                    timeout_secs = self.drain_timeout.as_secs(),
                    "Drain timeout — force exiting with active sessions"
                );
                false
            }
        }
    }
}

// ── Unit tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{ClusterMembership, NodeId};

    #[tokio::test]
    async fn test_drain_completes_when_no_sessions() {
        let id = NodeId::new("node-drain-test");
        let membership = Arc::new(ClusterMembership::new());
        membership
            .register_self(id.clone(), "127.0.0.1:8080".parse().unwrap(), 18080)
            .await;

        let counter = ActiveSessionCounter::new();
        let drain = DrainController::new(id.clone(), Arc::clone(&membership), counter, 5);

        let completed = drain.drain().await;
        assert!(
            completed,
            "Drain should complete immediately with 0 sessions"
        );

        let nodes = membership.all_nodes().await;
        assert_eq!(
            nodes.iter().find(|n| n.node_id == id).unwrap().state,
            crate::NodeState::Draining
        );
    }

    #[tokio::test]
    async fn test_drain_waits_for_session_to_finish() {
        let id = NodeId::new("node-wait-test");
        let membership = Arc::new(ClusterMembership::new());
        membership
            .register_self(id.clone(), "127.0.0.1:8081".parse().unwrap(), 18080)
            .await;

        let counter = ActiveSessionCounter::new();
        counter.increment(); // simulate 1 active session

        let counter_clone = counter.clone();
        // Release the session after 200ms
        tokio::spawn(async move {
            sleep(Duration::from_millis(200)).await;
            counter_clone.decrement();
        });

        let drain = DrainController::new(id, Arc::clone(&membership), counter, 5);
        let completed = drain.drain().await;
        assert!(completed, "Drain should complete after session finishes");
    }

    #[tokio::test]
    async fn test_drain_timeout_fires() {
        let id = NodeId::new("node-timeout-test");
        let membership = Arc::new(ClusterMembership::new());
        membership
            .register_self(id.clone(), "127.0.0.1:8082".parse().unwrap(), 18080)
            .await;

        let counter = ActiveSessionCounter::new();
        counter.increment(); // session never finishes

        // Very short timeout (1 s)
        let drain = DrainController::new(id, Arc::clone(&membership), counter, 1);
        let completed = drain.drain().await;
        assert!(!completed, "Drain should time out");
    }

    #[test]
    fn test_active_session_counter() {
        let c = ActiveSessionCounter::new();
        assert_eq!(c.current(), 0);
        c.increment();
        c.increment();
        assert_eq!(c.current(), 2);
        c.decrement();
        assert_eq!(c.current(), 1);
    }
}
