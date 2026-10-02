//! ha_cluster::election — Deterministic leader election
//!
//! Used only for metadata coordination (e.g., ledger compaction scheduling).
//! NOT used for session routing — the cluster is active-active.
//!
//! Algorithm: the Healthy node with the lexicographically smallest node_id
//! is the leader. This is deterministic and requires no consensus protocol.
//! All nodes independently compute the same leader given the same membership view.

use crate::{ClusterMembership, NodeId};
use std::sync::Arc;

/// Compute the current leader node_id from the cluster membership.
///
/// Returns `None` if there are no healthy nodes.
pub async fn compute_leader(membership: &ClusterMembership) -> Option<NodeId> {
    let healthy = membership.healthy_peers().await;
    healthy
        .into_iter()
        .map(|n| n.node_id)
        .min_by(|a, b| a.0.cmp(&b.0))
}

/// P3.5: Compute the leader within a specific region.
/// Falls back to the global leader if no healthy nodes exist in the region.
pub async fn compute_leader_in_region(
    membership: &ClusterMembership,
    region: &str,
) -> Option<NodeId> {
    let healthy = membership.healthy_peers_in_region(region).await;
    if !healthy.is_empty() {
        healthy
            .into_iter()
            .map(|n| n.node_id)
            .min_by(|a, b| a.0.cmp(&b.0))
    } else {
        // Cross-region fallback — active-active, so any healthy node can lead
        compute_leader(membership).await
    }
}

/// Returns true if `self_id` is the current leader.
pub async fn is_leader(membership: &ClusterMembership, self_id: &NodeId) -> bool {
    match compute_leader(membership).await {
        Some(leader_id) => &leader_id == self_id,
        None => false,
    }
}

/// Logs leadership status. Useful for periodic leader announcement.
pub async fn announce_leadership(membership: Arc<ClusterMembership>, self_id: &NodeId) {
    if is_leader(&membership, self_id).await {
        info!(node_id = %self_id, "This node is the cluster leader");
    }
}

// ── Unit tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ClusterMembership;

    #[tokio::test]
    async fn test_leader_is_lexicographically_smallest() {
        let m = ClusterMembership::new();
        m.register_self(
            NodeId::new("node-c"),
            "127.0.0.1:8003".parse().unwrap(),
            18080,
        )
        .await;
        m.register_self(
            NodeId::new("node-a"),
            "127.0.0.1:8001".parse().unwrap(),
            18080,
        )
        .await;
        m.register_self(
            NodeId::new("node-b"),
            "127.0.0.1:8002".parse().unwrap(),
            18080,
        )
        .await;

        let leader = compute_leader(&m).await.expect("should have leader");
        assert_eq!(leader, NodeId::new("node-a"));
    }

    #[tokio::test]
    async fn test_no_leader_when_no_healthy_nodes() {
        let m = ClusterMembership::new();
        // Register a dead node
        m.register_self(
            NodeId::new("node-x"),
            "127.0.0.1:9999".parse().unwrap(),
            18080,
        )
        .await;
        {
            let mut map = m.inner.write().await;
            if let Some(n) = map.get_mut(&NodeId::new("node-x")) {
                n.state = crate::NodeState::Dead;
            }
        }

        let leader = compute_leader(&m).await;
        assert!(leader.is_none(), "Dead nodes should not be elected leader");
    }

    #[tokio::test]
    async fn test_is_leader_returns_correct_bool() {
        let m = ClusterMembership::new();
        let id_a = NodeId::new("node-a-leader");
        let id_b = NodeId::new("node-b-follower");
        m.register_self(id_a.clone(), "127.0.0.1:8010".parse().unwrap(), 18080)
            .await;
        m.register_self(id_b.clone(), "127.0.0.1:8011".parse().unwrap(), 18080)
            .await;

        assert!(is_leader(&m, &id_a).await);
        assert!(!is_leader(&m, &id_b).await);
    }

    #[tokio::test]
    async fn test_compute_leader_in_region() {
        let m = ClusterMembership::new();
        // Register across two regions
        m.register_self_with_region(
            NodeId::new("node-a-ue1"),
            "127.0.0.1:8001".parse().unwrap(),
            18080,
            "us-east-1",
        )
        .await;
        m.register_self_with_region(
            NodeId::new("node-b-ue1"),
            "127.0.0.1:8002".parse().unwrap(),
            18080,
            "us-east-1",
        )
        .await;
        m.register_self_with_region(
            NodeId::new("node-c-ew1"),
            "127.0.0.1:8003".parse().unwrap(),
            18080,
            "eu-west-1",
        )
        .await;

        // Leader in us-east-1 should be "node-a-ue1" (lex smallest in region)
        let leader_ue1 = compute_leader_in_region(&m, "us-east-1").await.unwrap();
        assert_eq!(leader_ue1, NodeId::new("node-a-ue1"));

        // Leader in eu-west-1 should be "node-c-ew1"
        let leader_ew1 = compute_leader_in_region(&m, "eu-west-1").await.unwrap();
        assert_eq!(leader_ew1, NodeId::new("node-c-ew1"));

        // If all us-east-1 nodes die, fallback to global leader
        {
            let mut map = m.inner.write().await;
            for id in [&NodeId::new("node-a-ue1"), &NodeId::new("node-b-ue1")] {
                if let Some(n) = map.get_mut(id) {
                    n.state = crate::NodeState::Dead;
                }
            }
        }
        let leader_ue1_after = compute_leader_in_region(&m, "us-east-1").await;
        assert_eq!(leader_ue1_after.unwrap(), NodeId::new("node-c-ew1"));
    }
}
