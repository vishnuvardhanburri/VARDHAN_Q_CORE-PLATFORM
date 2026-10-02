use core_crypto::QuantumNodeIdentity;
use ha_cluster::{ClusterNode, NodeId};
use ledger_sync::LedgerBlock;
use proxy_engine::{aes_gcm_open, aes_gcm_seal};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::{mpsc, RwLock};
use tracing::{info, warn};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub enum GossipMessage {
    PeerExchange(Vec<SocketAddr>),
    BlockBroadcast(LedgerBlock),
    /// HA: A peer broadcasts its current health state.
    NodeHeartbeat(ClusterNode),
    /// HA: A peer notifies the cluster it is draining.
    NodeDraining(NodeId),
    /// Ledger: Request to the current Authority to append a block.
    AppendRequest {
        session_id: [u8; 32],
        payload: Vec<u8>,
        timestamp_ms: u64,
    },
}

#[derive(Clone, Default)]
pub struct PeerRegistry {
    peers: Arc<RwLock<HashSet<SocketAddr>>>,
}

impl PeerRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn register_peer(&self, addr: SocketAddr) -> bool {
        self.peers.write().await.insert(addr)
    }

    pub async fn get_peers(&self) -> Vec<SocketAddr> {
        self.peers.read().await.iter().copied().collect()
    }
}

pub struct GossipEngine {
    identity: Arc<QuantumNodeIdentity>,
    local_node_id: NodeId,
    registry: PeerRegistry,
    seen_blocks: Arc<RwLock<HashSet<[u8; 32]>>>,
    block_tx: mpsc::Sender<LedgerBlock>,
    /// Optional HA cluster membership table. When set, NodeHeartbeat and
    /// NodeDraining gossip messages update the membership state.
    cluster: Option<Arc<ha_cluster::ClusterMembership>>,
}

impl GossipEngine {
    pub fn new(
        identity: Arc<QuantumNodeIdentity>,
        local_node_id: NodeId,
        registry: PeerRegistry,
        block_tx: mpsc::Sender<LedgerBlock>,
    ) -> Self {
        Self {
            identity,
            local_node_id,
            registry,
            seen_blocks: Arc::new(RwLock::new(HashSet::new())),
            block_tx,
            cluster: None,
        }
    }

    /// Attach a cluster membership table. NodeHeartbeat gossip will update it.
    pub fn with_cluster(mut self, cluster: Arc<ha_cluster::ClusterMembership>) -> Self {
        self.cluster = Some(cluster);
        self
    }

    pub async fn process_incoming_gossip(
        &self,
        session_key: &[u8; 32],
        encrypted_payload: &[u8],
    ) -> Result<(), String> {
        let payload = aes_gcm_open(session_key, encrypted_payload)
            .map_err(|e| format!("Decrypt error: {e}"))?;
        let msg: GossipMessage =
            serde_json::from_slice(&payload).map_err(|e| format!("Serde error: {e}"))?;

        match msg {
            GossipMessage::PeerExchange(addrs) => {
                for addr in addrs {
                    if self.registry.register_peer(addr).await {
                        info!(peer = %addr, "Discovered new peer via gossip");
                    }
                }
            }
            GossipMessage::BlockBroadcast(block) => {
                let mut seen = self.seen_blocks.write().await;
                if seen.insert(block.block_hash) {
                    info!(
                        block_index = block.index,
                        "Gossip block accepted and forwarded to ledger queue"
                    );
                    let _ = self.block_tx.send(block).await;
                }
            }
            GossipMessage::NodeHeartbeat(node) => {
                if let Some(ref cluster) = self.cluster {
                    info!(node_id = %node.node_id, state = %node.state, "Gossip: NodeHeartbeat received");
                    cluster.apply_heartbeat(node).await;
                }
            }
            GossipMessage::NodeDraining(node_id) => {
                if let Some(ref cluster) = self.cluster {
                    warn!(node_id = %node_id, "Gossip: NodeDraining received");
                    let _ = cluster.mark_draining(&node_id).await;
                }
            }
            GossipMessage::AppendRequest {
                session_id,
                payload,
                timestamp_ms,
            } => {
                if let Some(ref cluster) = self.cluster {
                    let nodes = cluster.healthy_peers().await;
                    // Deterministic Authority: Min NodeId for the current maximum term
                    let max_term = nodes.iter().map(|n| n.term).max().unwrap_or(0);
                    let authority = nodes
                        .iter()
                        .filter(|n| n.term == max_term)
                        .min_by_key(|n| &n.node_id);

                    if let Some(leader) = authority {
                        // If I am the leader, I sequence the block
                        if leader.node_id == self.local_node_id {
                            info!(
                                session_id = ?session_id,
                                "I am the authority; sequencing block"
                            );
                            // In a real implementation, we'd fetch the current ledger tip
                            // and append the block. For now, we log the action.
                        } else {
                            info!(
                                authority = %leader.node_id,
                                "Forwarding AppendRequest to authority"
                            );
                        }
                    }
                }
            }
        }
        Ok(())
    }

    pub async fn create_gossip_frame(
        &self,
        session_key: &[u8; 32],
        msg: &GossipMessage,
    ) -> Result<Vec<u8>, String> {
        let serialized = serde_json::to_vec(msg).map_err(|e| e.to_string())?;
        aes_gcm_seal(session_key, &serialized).map_err(|e| e.to_string())
    }

    /// Broadcast a cluster state message to all registered peers.
    ///
    /// `session_key` is the shared gossip key for this cluster (pre-established
    /// out-of-band via the normal PQ handshake or configured statically).
    pub async fn broadcast_state(
        &self,
        session_key: &[u8; 32],
        msg: &GossipMessage,
    ) -> Result<usize, String> {
        let frame = self.create_gossip_frame(session_key, msg).await?;
        let peers = self.registry.get_peers().await;
        let sent = peers.len();
        // In a real deployment this would use a TCP/QUIC connection pool.
        // For now we log the broadcast intent — actual transport is via the
        // heartbeat UDP loop in ha_cluster::heartbeat.
        for peer in &peers {
            info!(peer = %peer, bytes = frame.len(), "Gossip broadcast → peer");
        }
        Ok(sent)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core_crypto::QuantumNodeIdentity;

    #[tokio::test]
    async fn test_gossip_block_deduplication() {
        let identity = Arc::new(QuantumNodeIdentity::generate_node_identity().unwrap());
        let local_id = NodeId::new("node-0");
        let registry = PeerRegistry::new();
        let (tx, mut rx) = mpsc::channel(10);
        let engine = GossipEngine::new(identity.clone(), local_id, registry, tx);

        let dummy_key = [7u8; 32];
        let block = LedgerBlock {
            index: 1,
            timestamp_ms: 1000,
            prev_hash: [0u8; 32],
            session_id: [0u8; 32],
            payload_hash: [0u8; 32],
            block_hash: [42u8; 32],
            dsa_signature: vec![1, 2, 3],
        };

        let frame = engine
            .create_gossip_frame(&dummy_key, &GossipMessage::BlockBroadcast(block))
            .await
            .unwrap();

        // First process: should succeed and send to channel
        engine
            .process_incoming_gossip(&dummy_key, &frame)
            .await
            .unwrap();
        assert!(rx.recv().await.is_some());

        // Duplicate process: deduplicated by seen_blocks hash set
        engine
            .process_incoming_gossip(&dummy_key, &frame)
            .await
            .unwrap();
        assert!(rx.try_recv().is_err());
    }
}
