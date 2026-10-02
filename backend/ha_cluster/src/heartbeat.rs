//! ha_cluster::heartbeat — UDP heartbeat loop
//!
//! Sends a lightweight JSON heartbeat frame to every known peer once per second.
//! Also drives dead-node reaping after each tick.
//!
//! The heartbeat carries ONLY availability metadata (node_id, addr, state,
//! epoch_ms). No session keys, no PQ material.

use crate::{epoch_ms, ClusterMembership, ClusterNode, NodeId, NodeState};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::UdpSocket;
use tokio::sync::watch;
use tokio::time::{interval, Duration};

/// Wire format of a UDP heartbeat datagram.
#[derive(Serialize, Deserialize, Debug)]
pub struct HeartbeatFrame {
    pub node_id: String,
    pub addr: String,
    pub hb_port: u16,
    pub state: NodeState,
    pub epoch_ms: u64,
    /// P3.5: Region tag propagated from ClusterNode. Defaults to ""
    /// for backward compatibility with P3.4 heartbeat frames.
    #[serde(default)]
    pub region: String,
    /// P3.8: TCP port for Raft RPC. Defaults to 0 if not set (backward compat).
    #[serde(default)]
    pub raft_port: u16,
}

impl HeartbeatFrame {
    pub(crate) fn from_node(node: &ClusterNode) -> Self {
        HeartbeatFrame {
            node_id: node.node_id.0.clone(),
            addr: node.addr.to_string(),
            hb_port: node.hb_port,
            state: node.state,
            epoch_ms: epoch_ms(),
            region: node.region.clone(),
            raft_port: node.raft_port,
        }
    }

    pub(crate) fn into_cluster_node(self) -> Option<ClusterNode> {
        let addr: SocketAddr = self.addr.parse().ok()?;
        Some(ClusterNode {
            term: 0,
            node_id: NodeId::new(self.node_id),
            addr,
            hb_port: self.hb_port,
            raft_port: self.raft_port,
            state: self.state,
            last_seen_ms: self.epoch_ms,
            region: self.region,
        })
    }
}

/// Spawns the heartbeat task and returns a handle to the receive loop.
///
/// Call `stop()` or drop `HeartbeatHandle` to terminate.
pub struct HeartbeatHandle {
    shutdown_tx: watch::Sender<bool>,
}

impl HeartbeatHandle {
    /// Signal the heartbeat loop to stop.
    pub fn stop(&self) {
        let _ = self.shutdown_tx.send(true);
    }
}

impl Drop for HeartbeatHandle {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Configuration for the heartbeat engine.
pub struct HeartbeatConfig {
    /// The local node's ID.
    pub self_node_id: NodeId,
    /// The local node's listen address.
    pub self_addr: SocketAddr,
    /// UDP port on which to listen for incoming heartbeats.
    pub heartbeat_port: u16,
    /// Interval between outbound heartbeat ticks (default: 1 s).
    pub tick_interval_ms: u64,
    /// Dead-node reap threshold in ms (default: 5000).
    pub dead_threshold_ms: u64,
}

impl HeartbeatConfig {
    pub fn new(self_node_id: NodeId, self_addr: SocketAddr, heartbeat_port: u16) -> Self {
        HeartbeatConfig {
            self_node_id,
            self_addr,
            heartbeat_port,
            tick_interval_ms: 1_000,
            dead_threshold_ms: 5_000,
        }
    }
}

/// Start the heartbeat engine: sender + receiver tasks.
///
/// Returns a [`HeartbeatHandle`] that shuts both tasks down when dropped.
pub async fn start_heartbeat(
    config: HeartbeatConfig,
    membership: Arc<ClusterMembership>,
) -> Result<HeartbeatHandle, std::io::Error> {
    let (shutdown_tx, shutdown_rx) = watch::channel(false);

    let bind_addr: SocketAddr = format!("0.0.0.0:{}", config.heartbeat_port)
        .parse()
        .unwrap();
    let socket = Arc::new(UdpSocket::bind(bind_addr).await?);
    info!(
        addr = %bind_addr,
        "Heartbeat UDP socket bound"
    );

    // ── Receive task ─────────────────────────────────────────────────────────
    {
        let socket = Arc::clone(&socket);
        let membership = Arc::clone(&membership);
        let mut rx = shutdown_rx.clone();
        tokio::spawn(async move {
            let mut buf = [0u8; 4096];
            loop {
                tokio::select! {
                    result = socket.recv_from(&mut buf) => {
                        match result {
                            Ok((n, peer)) => {
                                if let Ok(frame) = serde_json::from_slice::<HeartbeatFrame>(&buf[..n]) {
                                    debug!(from = %peer, node_id = %frame.node_id, state = ?frame.state, "Heartbeat received");
                                    if let Some(node) = frame.into_cluster_node() {
                                        membership.apply_heartbeat(node).await;
                                    }
                                }
                            }
                            Err(e) => warn!(err = %e, "Heartbeat recv error"),
                        }
                    }
                    _ = rx.changed() => {
                        if *rx.borrow() { break; }
                    }
                }
            }
            info!("Heartbeat receive task stopped");
        });
    }

    // ── Send task ────────────────────────────────────────────────────────────
    {
        let socket = Arc::clone(&socket);
        let membership = Arc::clone(&membership);
        let self_node_id = config.self_node_id.clone();
        let self_addr = config.self_addr;
        let tick_ms = config.tick_interval_ms;
        let dead_threshold_ms = config.dead_threshold_ms;
        let mut rx = shutdown_rx;
        tokio::spawn(async move {
            let mut ticker = interval(Duration::from_millis(tick_ms));
            loop {
                tokio::select! {
                    _ = ticker.tick() => {
                        // Build frame for self
                        let self_node = {
                            let nodes = membership.all_nodes().await;
                            nodes.into_iter().find(|n| n.node_id == self_node_id)
                        };
                        if let Some(self_node) = self_node {
                            let frame = HeartbeatFrame::from_node(&self_node);
                            if let Ok(bytes) = serde_json::to_vec(&frame) {
                                // Heartbeats must reach ALL healthy peers to keep
                                // the membership table fresh. Region preference
                                // applies to traffic routing, not to the heartbeat
                                // mesh itself — otherwise cross-region peers would
                                // be starved and reaped as Dead.
                                let peers = membership.healthy_peers().await;
                                for peer in peers {
                                    if peer.node_id == self_node_id { continue; }
                                    // If the peer's reported addr uses the
                                    // unspecified IP (0.0.0.0), we can't send
                                    // UDP to it directly. Fall back to localhost.
                                    let ip = if peer.addr.ip()
                                        == std::net::IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED)
                                    {
                                        std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST)
                                    } else {
                                        peer.addr.ip()
                                    };
                                    let hb_addr = SocketAddr::new(ip, peer.hb_port);
                                    let _ = socket.send_to(&bytes, hb_addr).await;
                                    debug!(target = %hb_addr, "Heartbeat sent");
                                }
                            }
                        }

                        // Reap dead nodes
                        let reaped = membership.reap_dead_nodes(dead_threshold_ms, &self_node_id).await;
                        for id in reaped {
                            warn!(node_id = %id, "Node reaped as Dead after heartbeat timeout");
                        }
                    }
                    _ = rx.changed() => {
                        if *rx.borrow() { break; }
                    }
                }
            }
            info!("Heartbeat send task stopped");
        });
    }

    Ok(HeartbeatHandle { shutdown_tx })
}

// ── Unit tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{ClusterMembership, ClusterNode, NodeId, NodeState};

    #[test]
    fn test_heartbeat_frame_roundtrip() {
        let node = ClusterNode {
            node_id: NodeId::new("node-test"),
            addr: "127.0.0.1:8080".parse().unwrap(),
            hb_port: 18080,
            raft_port: 0,
            state: NodeState::Healthy,
            last_seen_ms: 12345678,
            term: 0,
            region: String::new(),
        };
        let frame = HeartbeatFrame::from_node(&node);
        let json = serde_json::to_vec(&frame).unwrap();
        let parsed: HeartbeatFrame = serde_json::from_slice(&json).unwrap();
        assert_eq!(parsed.node_id, "node-test");
        assert!(matches!(parsed.state, NodeState::Healthy));
    }

    #[tokio::test]
    async fn test_heartbeat_udp_loopback() {
        // Use ephemeral ports
        let socket = std::net::UdpSocket::bind("127.0.0.1:0").unwrap();
        let port = socket.local_addr().unwrap().port();
        drop(socket);
        let self_id = NodeId::new("test-node-hb");
        let self_addr: SocketAddr = "127.0.0.1:8080".parse().unwrap();

        let membership = Arc::new(ClusterMembership::new());
        membership
            .register_self(self_id.clone(), self_addr, port)
            .await;

        let config = HeartbeatConfig::new(self_id.clone(), self_addr, port);
        let _handle = start_heartbeat(config, Arc::clone(&membership))
            .await
            .expect("bind should succeed");

        // Send a fake peer heartbeat to the socket
        let sender = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let peer_frame = HeartbeatFrame {
            node_id: "peer-node".to_string(),
            addr: "127.0.0.1:9090".to_string(),
            hb_port: 18080,
            state: NodeState::Healthy,
            epoch_ms: epoch_ms(),
            region: "eu-central-1".to_string(),
            raft_port: 0,
        };
        let bytes = serde_json::to_vec(&peer_frame).unwrap();
        sender
            .send_to(&bytes, format!("127.0.0.1:{}", port))
            .await
            .unwrap();

        // Give the receive task time to process
        tokio::time::sleep(Duration::from_millis(100)).await;

        let peers = membership.healthy_peers().await;
        // Should now include test-node-hb (self) and peer-node
        let ids: Vec<_> = peers
            .iter()
            .map(|n| n.node_id.as_str().to_string())
            .collect();
        assert!(
            ids.contains(&"peer-node".to_string()),
            "peer-node should be discovered: {:?}",
            ids
        );
    }
}
