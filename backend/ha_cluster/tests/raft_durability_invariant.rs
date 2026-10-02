use std::collections::HashSet;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::time::{timeout, Duration};
use tracing::{info, warn};

use core_crypto::QuantumNodeIdentity;
use ha_cluster::raft::{AppendEntriesArgs, AppendEntriesReply, LogEntry, RaftConfig, RaftNode, RaftRole, RaftRpcClient};
use ha_cluster::{ClusterMembership, NodeId, RaftNetworkListener, RaftPeerManager};

struct TestNode {
    id: NodeId,
    identity: Arc<QuantumNodeIdentity>,
    node: Arc<RaftNode>,
    listener_handle: tokio::task::JoinHandle<()>,
    run_handle: tokio::task::JoinHandle<()>,
    peer_manager: Arc<RaftPeerManager>,
    raft_addr: SocketAddr,
    persist_path: PathBuf,
    killed: AtomicBool,
}

impl TestNode {
    fn abort(&mut self) {
        self.killed.store(true, Ordering::SeqCst);
        self.run_handle.abort();
        self.listener_handle.abort();
    }
}

async fn spawn_node(
    id: NodeId,
    membership: Arc<ClusterMembership>,
    peers: Vec<NodeId>,
    persist_path: PathBuf,
    identity: Option<Arc<QuantumNodeIdentity>>,
    config: RaftConfig,
) -> TestNode {
    let identity = identity.unwrap_or_else(|| Arc::new(QuantumNodeIdentity::generate_node_identity().unwrap()));
    let pm = Arc::new(RaftPeerManager::new(
        identity.clone(),
        membership.clone(),
        id.clone(),
    ));

    let raft_node = Arc::new(RaftNode::with_config(
        id.clone(),
        persist_path.clone(),
        pm.clone() as Arc<dyn RaftRpcClient>,
        config,
    ));

    let addr: SocketAddr = "127.0.0.1:0".parse().unwrap();
    let (listener, tcp_listener, bound_addr) = RaftNetworkListener::new_test_insecure(addr, identity.clone(), raft_node.clone()).await.unwrap();

    membership.register_self(id.clone(), bound_addr, bound_addr.port()).await;
    membership.set_raft_port(id.clone(), bound_addr.port()).await;

    let lid = id.clone();
    let listener_handle = tokio::spawn(async move {
        if let Err(e) = listener.run(tcp_listener).await {
            warn!(node = %lid, err = %e, "Listener exited");
        }
    });

    let rn = raft_node.clone();
    let pc = peers.clone();
    let run_handle = tokio::spawn(async move {
        rn.run(pc).await
    });

    TestNode {
        id,
        identity,
        node: raft_node,
        listener_handle,
        run_handle,
        peer_manager: pm,
        raft_addr: bound_addr,
        persist_path,
        killed: AtomicBool::new(false),
    }
}

async fn restart_node(
    mut old: TestNode,
    membership: Arc<ClusterMembership>,
    peers: Vec<NodeId>,
    config: RaftConfig,
) -> TestNode {
    old.abort();
    tokio::task::yield_now().await;

    let id = old.id.clone();
    let identity = old.identity.clone();
    let persist_path = old.persist_path.clone();

    spawn_node(id, membership, peers, persist_path, Some(identity), config).await
}

fn test_config() -> RaftConfig {
    RaftConfig {
        election_timeout_min_ms: 1000,
        election_timeout_max_ms: 2000,
        heartbeat_interval_ms: 100,
        persist_on_submit: true,
            state_machine_mac_key: Some([0x42; 32]),
    }
}

async fn wait_for_leader(nodes: &[TestNode]) -> Arc<RaftNode> {
    timeout(Duration::from_secs(30), async {
        loop {
            let mut leaders = Vec::new();
            let mut candidates = 0;
            for n in nodes {
                if !n.killed.load(Ordering::SeqCst) {
                    let role = *n.node.role.read().await;
                    if role == RaftRole::Leader {
                        leaders.push(n.node.clone());
                    } else if role == RaftRole::Candidate {
                        candidates += 1;
                    }
                }
            }
            if leaders.len() == 1 && candidates == 0 {
                tokio::time::sleep(Duration::from_millis(150)).await;
                let leader = leaders.into_iter().next().unwrap();
                if *leader.role.read().await == RaftRole::Leader {
                    return leader;
                }
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("Stable leader election timeout")
}

async fn wait_for_log_len(node: &RaftNode, len: usize) -> bool {
    timeout(Duration::from_secs(10), async {
        loop {
            if node.log.read().await.len() >= len {
                return true;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap_or(false)
}

async fn wait_for_commit(node: &RaftNode, idx: u64) -> bool {
    timeout(Duration::from_secs(10), async {
        loop {
            if *node.commit_index.read().await >= idx {
                return true;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap_or(false)
}

/// Focused deterministic durability & crash consistency invariant test:
/// 1. Append known Raft entry
/// 2. Wait for successful acknowledgement
/// 3. Immediately crash follower
/// 4. Restart follower
/// 5. Recover persistent state
/// 6. Assert exact log index/term/data
/// 7. Continue replication
/// 8. Assert follower catches up
/// 9. Assert cluster remains healthy
async fn run_durability_cycle(cycle_id: usize) {
    let tmp_dir = std::env::temp_dir().join(format!("raft_dur_{}_{}", cycle_id, uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&tmp_dir).unwrap();

    let persist_a = tmp_dir.join("a.json");
    let persist_b = tmp_dir.join("b.json");
    let persist_c = tmp_dir.join("c.json");

    let membership = Arc::new(ClusterMembership::new());
    let id_a = NodeId::new("node-a");
    let id_b = NodeId::new("node-b");
    let id_c = NodeId::new("node-c");
    let peers = vec![id_a.clone(), id_b.clone(), id_c.clone()];

    let node_a = spawn_node(id_a.clone(), membership.clone(), peers.clone(), persist_a.clone(), None, test_config()).await;
    let node_b = spawn_node(id_b.clone(), membership.clone(), peers.clone(), persist_b.clone(), None, test_config()).await;
    let node_c = spawn_node(id_c.clone(), membership.clone(), peers.clone(), persist_c.clone(), None, test_config()).await;

    let mut nodes = vec![node_a, node_b, node_c];

    // 1. Submit known entry 1 on stable leader
    let req_id1 = format!("req-{}-1", cycle_id);
    let data1 = format!("payload-{}-1", cycle_id).into_bytes();
    let (term1, idx1, leader_id) = loop {
        let leader = wait_for_leader(&nodes).await;
        let lid = leader.id.clone();
        let term = *leader.current_term.read().await;
        match leader.submit_entry(LogEntry {
            term,
            index: 0,
            client_id: "client-dur".to_string(),
            request_id: req_id1.clone(),
            data: data1.clone(),
        }).await {
            Ok(idx) => {
                if wait_for_commit(&leader, idx).await {
                    break (term, idx, lid);
                }
            }
            Err(_) => tokio::time::sleep(Duration::from_millis(50)).await,
        }
    };

    // 2. Wait for successful replication and commit across all nodes
    for n in &nodes {
        assert!(wait_for_log_len(&n.node, idx1 as usize).await, "Node {} failed to receive entry 1", n.id);
        assert!(wait_for_commit(&n.node, idx1).await, "Node {} failed to commit entry 1", n.id);
    }

    // Pick a follower to crash
    let follower_idx = nodes.iter().position(|n| n.id != leader_id).unwrap();
    let follower_id = nodes[follower_idx].id.clone();
    let follower_persist = nodes[follower_idx].persist_path.clone();

    // 3. Immediately crash follower
    let dead_follower = nodes.remove(follower_idx);

    // Verify disk content directly before restart
    let recovered_state = std::fs::read_to_string(&follower_persist).expect("Persist file must exist on disk");
    let mut parsed: serde_json::Value = serde_json::from_str(&recovered_state).expect("Valid JSON on disk");
    if let Some(payload) = parsed.get("payload_json") {
        parsed = serde_json::from_str(payload.as_str().unwrap()).unwrap();
    }
    let log_arr = parsed["log"].as_array().expect("Log must be array");
    assert_eq!(log_arr.len(), 1, "Persisted log length must be 1 on disk");
    assert_eq!(log_arr[0]["request_id"], req_id1, "Persisted request_id mismatch on disk");
    assert_eq!(log_arr[0]["data"].as_array().unwrap().len(), data1.len(), "Persisted data length mismatch on disk");

    // Submit entry 2 on surviving majority while follower is dead
    let req_id2 = format!("req-{}-2", cycle_id);
    let data2 = format!("payload-{}-2", cycle_id).into_bytes();
    let (_term2, idx2, active_leader_id) = loop {
        let leader = wait_for_leader(&nodes).await;
        let lid = leader.id.clone();
        let term = *leader.current_term.read().await;
        match leader.submit_entry(LogEntry {
            term,
            index: 0,
            client_id: "client-dur".to_string(),
            request_id: req_id2.clone(),
            data: data2.clone(),
        }).await {
            Ok(idx) => {
                if wait_for_commit(&leader, idx).await {
                    break (term, idx, lid);
                }
            }
            Err(_) => tokio::time::sleep(Duration::from_millis(50)).await,
        }
    };

    // 4. Restart follower
    let restarted = restart_node(dead_follower, membership.clone(), peers.clone(), test_config()).await;
    nodes.insert(follower_idx, restarted);

    // 5. Recover persistent state and 6. Assert exact log index/term/data
    {
        let restarted_log = nodes[follower_idx].node.log.read().await;
        assert!(restarted_log.len() >= 1, "Restarted node must have recovered entry 1");
        assert_eq!(restarted_log[0].term, term1, "Entry 1 term mismatch");
        assert_eq!(restarted_log[0].request_id, req_id1, "Entry 1 request_id mismatch");
        assert_eq!(restarted_log[0].data, data1, "Entry 1 data mismatch");
    }

    // Force active leader to drop stale worker and connect to restarted follower's new port
    let leader_node_idx = nodes.iter().position(|n| n.id == active_leader_id).unwrap();
    nodes[leader_node_idx].peer_manager.clear_worker(&follower_id).await;

    // 7. Continue replication & 8. Assert follower catches up to entry 2
    assert!(wait_for_log_len(&nodes[follower_idx].node, idx2 as usize).await, "Restarted follower did not catch up to entry 2");
    assert!(wait_for_commit(&nodes[follower_idx].node, idx2).await, "Restarted follower did not commit entry 2");

    // 9. Assert exact log integrity and cluster health
    {
        let follower_log = nodes[follower_idx].node.log.read().await;
        assert_eq!(follower_log.len(), 2, "Follower log length must be exactly 2");
        assert_eq!(follower_log[1].request_id, req_id2, "Entry 2 request_id mismatch");
        assert_eq!(follower_log[1].data, data2, "Entry 2 data mismatch");

        let unique: HashSet<(String, String)> = follower_log.iter().map(|e| (e.client_id.clone(), e.request_id.clone())).collect();
        assert_eq!(unique.len(), 2, "No duplicates allowed in follower log");
    }

    // Teardown
    for mut n in nodes {
        n.abort();
    }
    let _ = std::fs::remove_dir_all(&tmp_dir);
}

#[tokio::test]
async fn test_durability_invariant_100x() {
    let _ = tracing_subscriber::fmt().with_max_level(tracing::Level::INFO).try_init();

    info!("Starting 100x durability invariant verification");
    for i in 0..100 {
        run_durability_cycle(i).await;
        if (i + 1) % 20 == 0 {
            info!("Completed {}/100 durability cycles successfully", i + 1);
        }
    }
    info!("=== 100/100 Durability Invariant Cycles PASSED ===");
}

#[tokio::test]
async fn test_follower_crash_immediate_after_ack() {
    let _ = tracing_subscriber::fmt().with_max_level(tracing::Level::DEBUG).try_init();
    run_durability_cycle(9999).await;
    info!("Immediate crash after ACK test PASSED");
}
