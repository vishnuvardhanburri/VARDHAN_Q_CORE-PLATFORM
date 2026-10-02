//! ha_cluster — P3.4 HA / Multi-Node Gateway Cluster
//!
//! Provides cluster membership, health tracking, heartbeat, drain control,
//! and deterministic leader election for the Vardhan quantum proxy cluster.
//!
//! Design invariant: this crate has NO knowledge of PQ session keys or
//! cryptographic material. It is purely an availability/coordination layer.

macro_rules! info {
    ($($arg:tt)*) => {
        ()
    };
}
macro_rules! warn {
    ($($arg:tt)*) => {
        ()
    };
}
macro_rules! debug {
    ($($arg:tt)*) => {
        ()
    };
}
macro_rules! error {
    ($($arg:tt)*) => {
        ()
    };
}

pub mod drain;
pub mod election;
pub mod heartbeat;
pub mod peer_manager;
pub mod raft;
pub mod raft_listener;
#[cfg(test)]
pub mod raft_test_utils;

pub use audit_ledger::{
    Checkpoint, CheckpointError, CheckpointWriter, CommittedCheckpoint, CHECKPOINT_CLIENT_ID,
    CHECKPOINT_VERSION,
};
pub use peer_manager::RaftPeerManager;
pub use raft::{LedgerApplier, RaftConfig, RaftNode, RaftNodeStatus, RaftRole};
pub use raft_listener::{PeerRegistry, RaftNetworkListener};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    net::SocketAddr,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};
use thiserror::Error;
use tokio::sync::RwLock;

// ── Node identity ────────────────────────────────────────────────────────────

/// Opaque node identifier. Stable across restarts when set via VARDHAN_NODE_ID.
#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct NodeId(pub String);

impl NodeId {
    pub fn new(id: impl Into<String>) -> Self {
        NodeId(id.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for NodeId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

// ── Node health state ────────────────────────────────────────────────────────

/// Health states for a cluster node.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NodeState {
    /// Fully operational; accepting new sessions.
    Healthy,
    /// Operational but degraded (e.g., high error rate). Still accepts sessions.
    Degraded,
    /// Graceful shutdown in progress. Not accepting new sessions; finishing existing ones.
    Draining,
    /// No heartbeat received within the dead threshold; presumed offline.
    Dead,
}

impl std::fmt::Display for NodeState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            NodeState::Healthy => write!(f, "healthy"),
            NodeState::Degraded => write!(f, "degraded"),
            NodeState::Draining => write!(f, "draining"),
            NodeState::Dead => write!(f, "dead"),
        }
    }
}

// ── Cluster node record ──────────────────────────────────────────────────────

/// A snapshot of a single cluster node's observed state.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ClusterNode {
    pub node_id: NodeId,
    /// Address on which this node accepts client traffic.
    pub addr: SocketAddr,
    /// UDP port on which this node accepts heartbeats.
    pub hb_port: u16,
    /// TCP port on which this node accepts Raft RPC traffic.
    /// Defaults to 0 for backward compatibility (peers without raft_port
    /// fall back to addr.port()).
    #[serde(default)]
    pub raft_port: u16,
    pub state: NodeState,
    /// Unix epoch milliseconds of last observed heartbeat.
    pub last_seen_ms: u64,
    /// Current term of this node.
    pub term: u64,
    /// P3.5: Region tag (e.g. "us-east-1"). Empty = region-unaware (P3.4 compat).
    #[serde(default)]
    pub region: String,
}

impl ClusterNode {
    pub fn new(node_id: NodeId, addr: SocketAddr, hb_port: u16) -> Self {
        ClusterNode {
            node_id,
            addr,
            hb_port,
            raft_port: 0,
            state: NodeState::Healthy,
            last_seen_ms: epoch_ms(),
            term: 0,
            region: String::new(),
        }
    }

    /// P3.5: Construct a node with an explicit region tag.
    pub fn with_region(
        node_id: NodeId,
        addr: SocketAddr,
        hb_port: u16,
        region: impl Into<String>,
    ) -> Self {
        ClusterNode {
            region: region.into(),
            term: 0,
            raft_port: 0,
            ..Self::new(node_id, addr, hb_port)
        }
    }
}

// ── Cluster membership ───────────────────────────────────────────────────────

#[derive(Error, Debug)]
pub enum ClusterError {
    #[error("node not found: {0}")]
    NodeNotFound(NodeId),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

/// Thread-safe, shared membership table.
#[derive(Clone, Default)]
pub struct ClusterMembership {
    inner: Arc<RwLock<HashMap<NodeId, ClusterNode>>>,
}

impl ClusterMembership {
    pub fn new() -> Self {
        Self::default()
    }

    /// Register or refresh this node in the table.
    pub async fn register_self(&self, node_id: NodeId, addr: SocketAddr, hb_port: u16) {
        let mut map = self.inner.write().await;
        let entry = map
            .entry(node_id.clone())
            .or_insert_with(|| ClusterNode::new(node_id.clone(), addr, hb_port));
        entry.addr = addr;
        entry.hb_port = hb_port;
        entry.state = NodeState::Healthy;
        entry.last_seen_ms = epoch_ms();
        info!(node_id = %node_id, addr = %addr, hb_port, "Registered self in cluster membership");
    }

    /// P3.5: Register self with an explicit region tag.
    pub async fn register_self_with_region(
        &self,
        node_id: NodeId,
        addr: SocketAddr,
        hb_port: u16,
        region: impl Into<String>,
    ) {
        let region = region.into();
        let mut map = self.inner.write().await;
        let entry = map.entry(node_id.clone()).or_insert_with(|| {
            ClusterNode::with_region(node_id.clone(), addr, hb_port, region.clone())
        });
        entry.addr = addr;
        entry.hb_port = hb_port;
        entry.region = region.clone();
        entry.state = NodeState::Healthy;
        entry.last_seen_ms = epoch_ms();
        info!(node_id = %node_id, addr = %addr, hb_port, region = %region, "Registered self in cluster membership (region-aware)");
    }

    /// P3.8: Set the Raft RPC port for a node, so peers know where to
    /// connect for Raft consensus RPCs.
    pub async fn set_raft_port(&self, node_id: NodeId, port: u16) {
        let mut map = self.inner.write().await;
        if let Some(entry) = map.get_mut(&node_id) {
            entry.raft_port = port;
        }
    }

    /// Record a heartbeat received from a peer.
    pub async fn apply_heartbeat(&self, node: ClusterNode) {
        let mut map = self.inner.write().await;
        let entry = map
            .entry(node.node_id.clone())
            .or_insert_with(|| node.clone());
        // Only advance last_seen if the timestamp is newer.
        if node.last_seen_ms >= entry.last_seen_ms {
            // Trust the peer's self-reported addr/hb_port from the heartbeat
            // frame — this corrects seed-peer entries that may have used the
            // heartbeat port as the addr. The peer tells us where it actually
            // accepts traffic and heartbeats.
            entry.addr = node.addr;
            entry.hb_port = node.hb_port;
            entry.raft_port = node.raft_port;
            entry.last_seen_ms = node.last_seen_ms;
            // Allow Dead → Healthy transition when the heartbeat carries a
            // newer timestamp — this means the peer has genuinely restarted
            // and is sending fresh heartbeats (not a stale/lagged packet).
            // We still do NOT override an explicit Draining state, which is
            // set locally via graceful shutdown and should only be cleared by
            // explicit re-registration (mark_healthy).
            if entry.state != NodeState::Draining {
                entry.state = node.state;
            }
        }
    }

    /// Mark a node as Draining (e.g., on local SIGTERM).
    pub async fn mark_draining(&self, node_id: &NodeId) -> Result<(), ClusterError> {
        let mut map = self.inner.write().await;
        let node = map
            .get_mut(node_id)
            .ok_or_else(|| ClusterError::NodeNotFound(node_id.clone()))?;
        node.state = NodeState::Draining;
        info!(node_id = %node_id, "Node marked Draining");
        Ok(())
    }

    /// Mark a node as Healthy (e.g., after re-join from Draining/Dead).
    pub async fn mark_healthy(&self, node_id: &NodeId) -> Result<(), ClusterError> {
        let mut map = self.inner.write().await;
        let node = map
            .get_mut(node_id)
            .ok_or_else(|| ClusterError::NodeNotFound(node_id.clone()))?;
        node.state = NodeState::Healthy;
        node.last_seen_ms = epoch_ms();
        info!(node_id = %node_id, "Node marked Healthy (rejoined)");
        Ok(())
    }

    /// Sweep nodes that haven't sent a heartbeat within `threshold_ms`.
    /// Skips the `self_node_id` (updates its last_seen_ms instead).
    /// Returns the list of NodeIds that transitioned to Dead.
    pub async fn reap_dead_nodes(&self, threshold_ms: u64, self_node_id: &NodeId) -> Vec<NodeId> {
        let now = epoch_ms();
        let mut map = self.inner.write().await;
        let mut reaped = Vec::new();
        for node in map.values_mut() {
            if &node.node_id == self_node_id {
                node.last_seen_ms = now; // self is never dead
                continue;
            }
            if node.state == NodeState::Healthy || node.state == NodeState::Degraded {
                let age = now.saturating_sub(node.last_seen_ms);
                if age > threshold_ms {
                    warn!(
                        node_id = %node.node_id,
                        age_ms = age,
                        "Node presumed dead (heartbeat timeout)"
                    );
                    node.state = NodeState::Dead;
                    reaped.push(node.node_id.clone());
                }
            }
        }
        reaped
    }

    /// Return all nodes currently in Healthy or Degraded state (i.e., usable).
    pub async fn healthy_peers(&self) -> Vec<ClusterNode> {
        self.inner
            .read()
            .await
            .values()
            .filter(|n| n.state == NodeState::Healthy || n.state == NodeState::Degraded)
            .cloned()
            .collect()
    }

    /// P3.5: Return Healthy/Degraded nodes that belong to the given region.
    /// If `region` is empty, returns peers with any (or no) region tag.
    pub async fn healthy_peers_in_region(&self, region: &str) -> Vec<ClusterNode> {
        if region.is_empty() {
            return self.healthy_peers().await;
        }
        self.inner
            .read()
            .await
            .values()
            .filter(|n| {
                n.region == region
                    && (n.state == NodeState::Healthy || n.state == NodeState::Degraded)
            })
            .cloned()
            .collect()
    }

    /// P3.5: Return all nodes (any state) in the given region.
    pub async fn nodes_in_region(&self, region: &str) -> Vec<ClusterNode> {
        if region.is_empty() {
            return self.all_nodes().await;
        }
        self.inner
            .read()
            .await
            .values()
            .filter(|n| n.region == region)
            .cloned()
            .collect()
    }

    /// Return all known nodes (any state).
    pub async fn all_nodes(&self) -> Vec<ClusterNode> {
        self.inner.read().await.values().cloned().collect()
    }

    /// Snapshot suitable for the /cluster/peers admin endpoint.
    pub async fn peer_snapshot(&self) -> Vec<serde_json::Value> {
        let map = self.inner.read().await;
        map.values()
            .map(|n| {
                serde_json::json!({
                    "node_id": n.node_id.as_str(),
                    "addr": n.addr.to_string(),
                    "state": n.state.to_string(),
                    "last_seen_ms": n.last_seen_ms,
                    "region": n.region.as_str(),
                })
            })
            .collect()
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

pub fn epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

// ── Unit tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::heartbeat::HeartbeatFrame;

    fn node_id(s: &str) -> NodeId {
        NodeId::new(s)
    }

    fn addr(s: &str) -> SocketAddr {
        s.parse().unwrap()
    }

    #[tokio::test]
    async fn test_register_and_heartbeat() {
        let membership = ClusterMembership::new();
        let id = node_id("node-a");
        let a = addr("127.0.0.1:8080");
        membership.register_self(id.clone(), a, 18080).await;

        let nodes = membership.all_nodes().await;
        assert_eq!(nodes.len(), 1);
        assert_eq!(nodes[0].state, NodeState::Healthy);
    }

    #[tokio::test]
    async fn test_reap_dead_nodes() {
        let membership = ClusterMembership::new();
        // Register self — this node is never reaped (skipped by reap_dead_nodes)
        let self_id = node_id("node-a");
        membership
            .register_self(self_id.clone(), addr("127.0.0.1:8080"), 18080)
            .await;

        // Register a peer separately — this node IS subject to reaping
        let peer_id = node_id("node-b");
        membership
            .register_self(peer_id.clone(), addr("127.0.0.1:8081"), 18080)
            .await;

        // Backdate last_seen by injecting a stale heartbeat
        {
            let mut map = membership.inner.write().await;
            if let Some(n) = map.get_mut(&peer_id) {
                n.last_seen_ms = 0; // epoch 0 — definitely stale
            }
        }

        let reaped = membership.reap_dead_nodes(5000, &self_id).await;
        assert_eq!(reaped, vec![peer_id.clone()]);

        let nodes = membership.all_nodes().await;
        let peer = nodes.iter().find(|n| n.node_id == peer_id).unwrap();
        assert_eq!(peer.state, NodeState::Dead);
        // Self must NOT be reaped
        let self_node = nodes.iter().find(|n| n.node_id == self_id).unwrap();
        assert_eq!(self_node.state, NodeState::Healthy);
    }

    #[tokio::test]
    async fn test_mark_draining_and_healthy() {
        let membership = ClusterMembership::new();
        let id = node_id("node-c");
        membership
            .register_self(id.clone(), addr("127.0.0.1:8082"), 18080)
            .await;

        membership.mark_draining(&id).await.unwrap();
        let nodes = membership.all_nodes().await;
        assert_eq!(nodes[0].state, NodeState::Draining);

        membership.mark_healthy(&id).await.unwrap();
        let nodes = membership.all_nodes().await;
        assert_eq!(nodes[0].state, NodeState::Healthy);
    }

    #[tokio::test]
    async fn test_healthy_peers_filters_dead() {
        let membership = ClusterMembership::new();
        membership
            .register_self(node_id("node-alive"), addr("127.0.0.1:9001"), 18080)
            .await;
        membership
            .register_self(node_id("node-dead"), addr("127.0.0.1:9002"), 18080)
            .await;

        // Kill node-dead
        {
            let mut map = membership.inner.write().await;
            if let Some(n) = map.get_mut(&node_id("node-dead")) {
                n.state = NodeState::Dead;
            }
        }

        let healthy = membership.healthy_peers().await;
        assert_eq!(healthy.len(), 1);
        assert_eq!(healthy[0].node_id, node_id("node-alive"));
    }

    #[tokio::test]
    async fn test_apply_heartbeat_updates_peer() {
        let membership = ClusterMembership::new();
        let id = node_id("node-peer");
        let a = addr("127.0.0.2:8080");

        let heartbeat = ClusterNode {
            node_id: id.clone(),
            addr: a,
            hb_port: 18080,
            raft_port: 0,
            state: NodeState::Degraded,
            last_seen_ms: epoch_ms(),
            term: 0,
            region: String::new(),
        };
        membership.apply_heartbeat(heartbeat).await;

        let nodes = membership.all_nodes().await;
        assert_eq!(nodes.len(), 1);
        assert_eq!(nodes[0].state, NodeState::Degraded);
    }

    // ── P3.5 region-aware tests ──────────────────────────────────────────

    #[tokio::test]
    async fn test_region_tagging_and_filtering() {
        let membership = ClusterMembership::new();
        membership
            .register_self_with_region(
                node_id("node-ue1-a"),
                addr("127.0.0.1:8001"),
                18080,
                "us-east-1",
            )
            .await;
        membership
            .register_self_with_region(
                node_id("node-ue1-b"),
                addr("127.0.0.1:8002"),
                18080,
                "us-east-1",
            )
            .await;
        membership
            .register_self_with_region(
                node_id("node-ew1-a"),
                addr("127.0.0.1:8003"),
                18080,
                "eu-west-1",
            )
            .await;

        // All three nodes registered
        let all = membership.all_nodes().await;
        assert_eq!(all.len(), 3);

        // us-east-1 has 2 healthy peers
        let ue1 = membership.healthy_peers_in_region("us-east-1").await;
        assert_eq!(ue1.len(), 2);

        // eu-west-1 has 1 healthy peer
        let ew1 = membership.healthy_peers_in_region("eu-west-1").await;
        assert_eq!(ew1.len(), 1);
        assert_eq!(ew1[0].node_id, node_id("node-ew1-a"));

        // nodes_in_region includes dead nodes
        {
            let mut map = membership.inner.write().await;
            if let Some(n) = map.get_mut(&node_id("node-ue1-b")) {
                n.state = NodeState::Dead;
            }
        }
        let ue1_nodes = membership.nodes_in_region("us-east-1").await;
        assert_eq!(ue1_nodes.len(), 2); // still 2 nodes, one Dead
        let ue1_healthy = membership.healthy_peers_in_region("us-east-1").await;
        assert_eq!(ue1_healthy.len(), 1); // only the healthy one
    }

    #[tokio::test]
    async fn test_heartbeat_propagates_region() {
        let node = ClusterNode {
            node_id: NodeId::new("node-region-peer"),
            addr: "127.0.0.1:9090".parse().unwrap(),
            hb_port: 18080,
            raft_port: 0,
            state: NodeState::Healthy,
            last_seen_ms: epoch_ms(),
            term: 0,
            region: "ap-southeast-2".to_string(),
        };
        let frame = HeartbeatFrame::from_node(&node);
        assert_eq!(frame.region, "ap-southeast-2");

        // Round-trip: region should survive serialization
        let bytes = serde_json::to_vec(&frame).unwrap();
        let parsed: HeartbeatFrame = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(parsed.region, "ap-southeast-2");

        let cluster_node = parsed.into_cluster_node().unwrap();
        assert_eq!(cluster_node.region, "ap-southeast-2");
    }

    #[tokio::test]
    async fn test_peer_snapshot_includes_region() {
        let membership = ClusterMembership::new();
        membership
            .register_self_with_region(
                node_id("node-a"),
                addr("127.0.0.1:8080"),
                18080,
                "us-west-2",
            )
            .await;

        let snap = membership.peer_snapshot().await;
        assert_eq!(snap.len(), 1);
        let region_val = snap[0].get("region").and_then(|v| v.as_str());
        assert_eq!(region_val, Some("us-west-2"));
    }
}
