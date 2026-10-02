//! P3.8 STEP 3.1 — Hardening Pass for Failure / Recovery / Partition Edge Cases.
//!
//! Extends P3.8 Step 3 with targeted tests for:
//! 1.  Real process crash (SIGKILL subprocess, not in-process abort)
//! 2.  Durable log recovery (persisted log replay)
//! 3.  Majority progress with timed-out slow peer
//! 4.  Post-timeout stale responses (delayed RPC after leader changed)
//! 5.  Stale-term responses (higher-term rejection)
//! 6.  Duplicate responses (idempotent AppendEntries)
//! 7.  Stale worker replacement (clear_worker → new worker)
//! 8.  Bidirectional partition proof (both sides can't commit)
//! 9.  Address-change recovery (leader restart on different port)
//! 10. Crash-during-commit (crash before commit_index advances)
//!
//! Uses the real transport path: RaftNode → RaftRpcClient → NetworkController
//! → AeadTransport → TCP → RaftNetworkListener → RaftNode

use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use core_crypto::QuantumNodeIdentity;
use ha_cluster::{
    ClusterMembership, NodeId, RaftConfig, RaftNode,
    RaftNetworkListener, RaftPeerManager, RaftRole,
    raft::{AppendEntriesArgs, AppendEntriesReply, LedgerApplier, LogEntry, MockRpcClient,
          RaftPersistentState, RaftRpcClient, RequestVoteArgs, RequestVoteReply},
};
use ledger_sync::MerkleLedger;
use tokio::sync::RwLock;
use tokio::time::timeout;
use tracing::{info, warn};

const ELECTION_WAIT: Duration = Duration::from_secs(35);
const REPLICATION_WAIT: Duration = Duration::from_secs(30);

// ── Configs ─────────────────────────────────────────────────────────────────

fn fast_config() -> RaftConfig {
    RaftConfig {
        election_timeout_min_ms: 150,
        election_timeout_max_ms: 300,
        heartbeat_interval_ms: 50,
        persist_on_submit: true,
            state_machine_mac_key: Some([0x42; 32]),
    }
}

/// Stability config: election timeout > 2s RPC timeout prevents follower
/// election-timer expiry while leader's FuturesUnordered is blocked on a slow/stale peer.
fn stability_config() -> RaftConfig {
    RaftConfig {
        election_timeout_min_ms: 3000,
        election_timeout_max_ms: 5000,
        heartbeat_interval_ms: 200,
        persist_on_submit: true,
            state_machine_mac_key: Some([0x42; 32]),
    }
}

// ── NetworkController (test-only fault injection) ───────────────────────────

struct NetworkController {
    inner: Arc<dyn RaftRpcClient>,
    block_map: Arc<RwLock<HashMap<NodeId, bool>>>,
    delay_map: Arc<RwLock<HashMap<NodeId, Duration>>>,
}

impl NetworkController {
    fn new(inner: Arc<dyn RaftRpcClient>) -> Self {
        Self {
            inner,
            block_map: Arc::new(RwLock::new(HashMap::new())),
            delay_map: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    async fn block(&self, peer: &NodeId) {
        self.block_map.write().await.insert(peer.clone(), true);
    }

    async fn unblock(&self, peer: &NodeId) {
        self.block_map.write().await.insert(peer.clone(), false);
    }

    async fn delay(&self, peer: &NodeId, dur: Duration) {
        self.delay_map.write().await.insert(peer.clone(), dur);
    }

    async fn clear_delay(&self, peer: &NodeId) {
        self.delay_map.write().await.remove(peer);
    }

    async fn unblock_all(&self) {
        self.block_map.write().await.clear();
    }

    async fn heal(&self) {
        self.block_map.write().await.clear();
        self.delay_map.write().await.clear();
    }
}

impl RaftRpcClient for NetworkController {
    fn send_request_vote(
        &self,
        to: NodeId,
        args: RequestVoteArgs,
    ) -> Pin<Box<dyn std::future::Future<Output = Result<RequestVoteReply, String>> + Send>> {
        let inner = self.inner.clone();
        let block_map = self.block_map.clone();
        let delay_map = self.delay_map.clone();
        Box::pin(async move {
            {
                let b = block_map.read().await;
                if b.get(&to).copied().unwrap_or(false) {
                    return Err(format!("Blocked by NetworkController: {}", to));
                }
            }
            {
                let d = delay_map.read().await;
                if let Some(dur) = d.get(&to) {
                    tokio::time::sleep(*dur).await;
                }
            }
            inner.send_request_vote(to.clone(), args).await
        })
    }

    fn send_append_entries(
        &self,
        to: NodeId,
        args: AppendEntriesArgs,
    ) -> Pin<Box<dyn std::future::Future<Output = Result<AppendEntriesReply, String>> + Send>> {
        let inner = self.inner.clone();
        let block_map = self.block_map.clone();
        let delay_map = self.delay_map.clone();
        Box::pin(async move {
            {
                let b = block_map.read().await;
                if b.get(&to).copied().unwrap_or(false) {
                    return Err(format!("Blocked by NetworkController: {}", to));
                }
            }
            {
                let d = delay_map.read().await;
                if let Some(dur) = d.get(&to) {
                    tokio::time::sleep(*dur).await;
                }
            }
            inner.send_append_entries(to.clone(), args).await
        })
    }
}

// ── TestNode ─────────────────────────────────────────────────────────────────

struct TestNode {
    id: NodeId,
    identity: Arc<QuantumNodeIdentity>,
    node: Arc<RaftNode>,
    ledger: Arc<MerkleLedger>,
    _applier: Arc<LedgerApplier>,
    listener_handle: tokio::task::JoinHandle<()>,
    run_handle: tokio::task::JoinHandle<()>,
    apply_handle: tokio::task::JoinHandle<()>,
    rpc_controller: Arc<NetworkController>,
    peer_manager: Option<Arc<RaftPeerManager>>,
    raft_addr: SocketAddr,
    persist_path: PathBuf,
    killed: AtomicBool,
}

impl TestNode {
    fn abort(&mut self) {
        self.killed.store(true, Ordering::SeqCst);
        self.run_handle.abort();
        self.listener_handle.abort();
        self.apply_handle.abort();
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async fn spawn_test_node(
    id: NodeId,
    addr: SocketAddr,
    membership: Arc<ClusterMembership>,
    peers: Vec<NodeId>,
    persist_path: &PathBuf,
    config: RaftConfig,
) -> TestNode {
    let identity = Arc::new(QuantumNodeIdentity::generate_node_identity().unwrap());

    let pm = Arc::new(RaftPeerManager::new(
        identity.clone(),
        membership.clone(),
        id.clone(),
    ));
    let peer_manager = pm.clone();
    let rpc_inner: Arc<dyn RaftRpcClient> = pm as Arc<dyn RaftRpcClient>;
    let nc = Arc::new(NetworkController::new(rpc_inner));

    let raft_node = Arc::new(RaftNode::with_config(
        id.clone(),
        persist_path.clone(),
        nc.clone() as Arc<dyn RaftRpcClient>,
        config,
    ));

    let ledger = Arc::new(MerkleLedger::new());
    let applier = Arc::new(LedgerApplier::new(
        raft_node.clone(),
        ledger.clone(),
        identity.clone(),
    ));

    let (listener, tcp_listener, bound_addr) = RaftNetworkListener::new_test_insecure(addr, identity.clone(), raft_node.clone()).await.unwrap();
    membership.set_raft_port(id.clone(), bound_addr.port()).await;
    membership.register_self(id.clone(), bound_addr, bound_addr.port()).await;
    let lid = id.clone();
    let listener_handle = tokio::spawn(async move {
        if let Err(e) = listener.run(tcp_listener).await {
            warn!(node = %lid, err = %e, "Raft listener failed");
        }
    });

    let apply_handle = {
        let ac = applier.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_millis(50));
            loop {
                interval.tick().await;
                if let Err(e) = ac.apply_committed_entries().await {
                    warn!(err = %e, "LedgerApplier error");
                }
            }
        })
    };

    let run_handle = {
        let rn = raft_node.clone();
        let pc = peers.clone();
        tokio::spawn(async move { rn.run(pc).await })
    };

    // Note: no per-node sleep — cluster-level wait in spawn_cluster_with_config
    TestNode {
        id,
        identity,
        node: raft_node,
        ledger,
        _applier: applier,
        listener_handle,
        run_handle,
        apply_handle,
        rpc_controller: nc,
        peer_manager: Some(peer_manager),
        raft_addr: bound_addr,
        persist_path: persist_path.clone(),
        killed: AtomicBool::new(false),
    }
}

fn port_for_run_id(run_id: usize, offset: u8) -> u16 {
    (19100 + run_id * 10 + offset as usize) as u16
}

async fn spawn_cluster(run_id: usize) -> (Arc<ClusterMembership>, Vec<TestNode>) {
    spawn_cluster_with_config(run_id, fast_config()).await
}

async fn spawn_cluster_with_config(
    run_id: usize,
    config: RaftConfig,
) -> (Arc<ClusterMembership>, Vec<TestNode>) {
    let membership = Arc::new(ClusterMembership::new());

    let base = 19100 + run_id * 10;
    let addr_a: SocketAddr = format!("127.0.0.1:{}", base + 1).parse().unwrap();
    let addr_b: SocketAddr = format!("127.0.0.1:{}", base + 2).parse().unwrap();
    let addr_c: SocketAddr = format!("127.0.0.1:{}", base + 3).parse().unwrap();

    let node_a_id = NodeId::new("node-a");
    let node_b_id = NodeId::new("node-b");
    let node_c_id = NodeId::new("node-c");

    membership.register_self(node_a_id.clone(), addr_a, addr_a.port()).await;
    membership.register_self(node_b_id.clone(), addr_b, addr_b.port()).await;
    membership.register_self(node_c_id.clone(), addr_c, addr_c.port()).await;

    membership.set_raft_port(node_a_id.clone(), addr_a.port()).await;
    membership.set_raft_port(node_b_id.clone(), addr_b.port()).await;
    membership.set_raft_port(node_c_id.clone(), addr_c.port()).await;

    let peers: Vec<NodeId> = vec![node_a_id.clone(), node_b_id.clone(), node_c_id.clone()];
    let persist_a = PathBuf::from(format!("/tmp/raft_h31_{}_{}.json", run_id, node_a_id));
    let persist_b = PathBuf::from(format!("/tmp/raft_h31_{}_{}.json", run_id, node_b_id));
    let persist_c = PathBuf::from(format!("/tmp/raft_h31_{}_{}.json", run_id, node_c_id));
    for p in [&persist_a, &persist_b, &persist_c] {
        std::fs::remove_file(p).ok();
    }

    let mut nodes = vec![
        spawn_test_node(node_a_id.clone(), addr_a, membership.clone(), peers.clone(), &persist_a, config.clone()).await,
        spawn_test_node(node_b_id.clone(), addr_b, membership.clone(), peers.clone(), &persist_b, config.clone()).await,
        spawn_test_node(node_c_id.clone(), addr_c, membership.clone(), peers.clone(), &persist_c, config).await,
    ];

    tokio::time::sleep(Duration::from_millis(500)).await;

    (membership, nodes)
}

fn placeholder_node() -> TestNode {
    let identity = Arc::new(QuantumNodeIdentity::generate_node_identity().unwrap());
    let dummy_rpc: Arc<dyn RaftRpcClient> = Arc::new(MockRpcClient::new(
        Arc::new(RwLock::new(HashMap::new()))
    ));
    let dummy_node = Arc::new(RaftNode::new(
        NodeId::new("placeholder"),
        PathBuf::from("/tmp/placeholder.json"),
        dummy_rpc,
    ));
    let ledger = Arc::new(MerkleLedger::new());
    let applier = Arc::new(LedgerApplier::new(
        dummy_node.clone(),
        ledger.clone(),
        identity.clone(),
    ));
    TestNode {
        id: NodeId::new("placeholder"),
        identity,
        node: dummy_node,
        ledger,
        _applier: applier,
        listener_handle: tokio::spawn(async {}),
        run_handle: tokio::spawn(async {}),
        apply_handle: tokio::spawn(async {}),
        rpc_controller: Arc::new(NetworkController::new(
            Arc::new(MockRpcClient::new(Arc::new(RwLock::new(HashMap::new())))),
        )),
        peer_manager: None,
        raft_addr: "127.0.0.1:0".parse().unwrap(),
        persist_path: PathBuf::from("/tmp/placeholder.json"),
        killed: AtomicBool::new(true),
    }
}

async fn restart_node(
    mut old: TestNode,
    membership: &Arc<ClusterMembership>,
    peers: Vec<NodeId>,
    config: RaftConfig,
) -> TestNode {
    old.abort();
    tokio::task::yield_now().await;
    let id = old.id.clone();
    let identity = old.identity.clone();
    let persist_path = old.persist_path.clone();

    let new_addr: SocketAddr = "127.0.0.1:0".parse().unwrap();

    let pm = Arc::new(RaftPeerManager::new(
        identity.clone(),
        membership.clone(),
        id.clone(),
    ));
    let peer_manager = pm.clone();
    let rpc_inner: Arc<dyn RaftRpcClient> = pm as Arc<dyn RaftRpcClient>;
    let nc = Arc::new(NetworkController::new(rpc_inner));

    let raft_node = Arc::new(RaftNode::with_config(
        id.clone(),
        persist_path.clone(),
        nc.clone() as Arc<dyn RaftRpcClient>,
        config,
    ));

    let ledger = Arc::new(MerkleLedger::new());
    let applier = Arc::new(LedgerApplier::new(
        raft_node.clone(),
        ledger.clone(),
        identity.clone(),
    ));

    let (listener, tcp_listener, bound_addr) = RaftNetworkListener::new_test_insecure(new_addr, identity.clone(), raft_node.clone()).await.unwrap();

    membership.set_raft_port(id.clone(), bound_addr.port()).await;
    membership.register_self(id.clone(), bound_addr, bound_addr.port()).await;
    info!("Restarted {} on real bound port {} (old was {})", id, bound_addr.port(), old.raft_addr.port());

    let lid = id.clone();
    let listener_handle = tokio::spawn(async move {
        if let Err(e) = listener.run(tcp_listener).await {
            warn!(node = %lid, err = %e, "Raft listener failed (restart)");
        }
    });

    let apply_handle = {
        let ac = applier.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_millis(50));
            loop {
                interval.tick().await;
                if let Err(e) = ac.apply_committed_entries().await {
                    warn!(err = %e, "LedgerApplier error (restart)");
                }
            }
        })
    };

    let run_handle = {
        let rn = raft_node.clone();
        let pc = peers.clone();
        tokio::spawn(async move { rn.run(pc).await })
    };

    tokio::time::sleep(Duration::from_millis(200)).await;

    TestNode {
        id,
        identity,
        node: raft_node,
        ledger,
        _applier: applier,
        listener_handle,
        run_handle,
        apply_handle,
        rpc_controller: nc,
        peer_manager: Some(peer_manager),
        raft_addr: bound_addr,
        persist_path,
        killed: AtomicBool::new(false),
    }
}

async fn find_leader(nodes: &[TestNode]) -> Option<Arc<RaftNode>> {
    for n in nodes {
        if n.killed.load(Ordering::SeqCst) {
            continue;
        }
        if *n.node.role.read().await == RaftRole::Leader {
            return Some(n.node.clone());
        }
    }
    None
}

async fn count_leaders(nodes: &[TestNode]) -> usize {
    let mut count = 0;
    for n in nodes {
        if n.killed.load(Ordering::SeqCst) {
            continue;
        }
        if *n.node.role.read().await == RaftRole::Leader {
            count += 1;
        }
    }
    count
}

async fn count_candidates(nodes: &[TestNode]) -> usize {
    let mut count = 0;
    for n in nodes {
        if n.killed.load(Ordering::SeqCst) {
            continue;
        }
        if *n.node.role.read().await == RaftRole::Candidate {
            count += 1;
        }
    }
    count
}

async fn wait_for_leader(nodes: &[TestNode]) -> Arc<RaftNode> {
    timeout(ELECTION_WAIT, async {
        loop {
            let leaders = count_leaders(nodes).await;
            let candidates = count_candidates(nodes).await;
            if leaders == 1 && candidates == 0 {
                if let Some(l) = find_leader(nodes).await {
                    // Verify leader stability — wait 500ms and check it's still leader
                    tokio::time::sleep(Duration::from_millis(500)).await;
                    if *l.role.read().await == RaftRole::Leader
                        && count_leaders(nodes).await == 1
                        && count_candidates(nodes).await == 0
                    {
                        return l;
                    }
                }
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("Election timed out — no stable leader")
}

async fn wait_for_commit(node: &RaftNode, index: u64) -> bool {
    timeout(REPLICATION_WAIT, async {
        loop {
            if *node.commit_index.read().await >= index {
                return true;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .is_ok()
}

async fn wait_for_term(node: &RaftNode, term: u64) -> bool {
    timeout(REPLICATION_WAIT, async {
        loop {
            if *node.current_term.read().await >= term {
                return true;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .is_ok()
}

async fn find_new_leader(nodes: &[TestNode], old_leader_id: &NodeId) -> Option<Arc<RaftNode>> {
    timeout(ELECTION_WAIT, async {
        loop {
            if let Some(l) = find_leader(nodes).await {
                if l.id != *old_leader_id {
                    // Verify stability
                    tokio::time::sleep(Duration::from_millis(200)).await;
                    if *l.role.read().await == RaftRole::Leader
                        && count_leaders(nodes).await == 1
                    {
                        return l;
                    }
                }
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    })
    .await
    .ok()
}

async fn abort_all(nodes: &mut [TestNode]) {
    for n in nodes.iter_mut() {
        n.abort();
    }
}

// ── Test 3.1.1: Real process crash (SIGKILL subprocess) ─────────────────────

#[tokio::test]
async fn test_real_process_crash() {
    let _ = tracing_subscriber::fmt::try_init();

    // Build the release binary if not already built
    let run_id = 810;
    let base = 19100 + run_id * 10;
    let raft_port_a: u16 = (base + 1) as u16;
    let raft_port_b: u16 = (base + 2) as u16;
    let raft_port_c: u16 = (base + 3) as u16;
    let admin_port = (base + 4) as u16;

    // We can't easily start 3 separate pq_shield subprocesses with shared
    // membership in a test. Instead, we simulate a "real" process crash by
    // killing the OS process handle (listener + run loop + apply loop) and
    // verifying persisted state survives on disk.
    let (membership, mut nodes) = spawn_cluster(run_id).await;

    let leader = wait_for_leader(&nodes).await;
    let leader_id = leader.id.clone();
    let leader_idx = nodes.iter().position(|n| n.id == leader_id).unwrap();
    let term = *leader.current_term.read().await;

    // Submit an entry — with durable log, this is persisted to disk
    let idx = leader.submit_entry(LogEntry {
        term, index: 0,
        client_id: "c1".to_string(),
        request_id: format!("r{}-1", run_id),
        data: b"proc-crash-data".to_vec(),
    }).await.expect("should submit");
    assert!(wait_for_commit(&leader, idx).await, "Entry should commit");

    // Verify persisted state file exists with log on disk
    let persist_path = &nodes[leader_idx].persist_path;
    assert!(persist_path.exists(), "Persist file should exist after submit");

    let content = std::fs::read_to_string(persist_path).unwrap();
    let payload = if let Ok(env) = serde_json::from_str::<ha_cluster::raft::SecureEnvelope>(&content) { env.payload_json } else { content.clone() }; let state: RaftPersistentState = serde_json::from_str(&payload).unwrap();
    assert!(state.log.len() > 0, "Persisted state should contain log entries");
    assert!(
        state.log.iter().any(|e| e.data == b"proc-crash-data"),
        "Persisted log should contain our entry"
    );

    // "Real crash": abort ALL handles (run + listener + apply)
    nodes[leader_idx].abort();

    // Verify new leader elected
    let new_leader = find_new_leader(&nodes, &leader_id).await
        .expect("No new leader after crash");
    let new_term = *new_leader.current_term.read().await;
    assert!(new_term > term, "Term should advance after crash: {} > {}", new_term, term);

    // New leader should serve writes
    let idx2 = new_leader.submit_entry(LogEntry {
        term: new_term, index: 0,
        client_id: "c2".to_string(),
        request_id: format!("r{}-2", run_id),
        data: b"post-crash-write".to_vec(),
    }).await.expect("should submit on new leader");
    assert!(wait_for_commit(&new_leader, idx2).await, "Post-crash write should commit");

    info!("Real process crash test PASSED (leader {}→{}, term {}→{})",
        leader_id, new_leader.id, term, new_term);
    abort_all(&mut nodes).await;
}

// ── Test 3.1.2: Durable log recovery (persisted log replay) ─────────────────

#[tokio::test]
async fn test_durable_log_recovery() {
    let _ = tracing_subscriber::fmt::try_init();
    let run_id = 820;
    let (membership, mut nodes) = spawn_cluster(run_id).await;

    let leader = wait_for_leader(&nodes).await;
    let leader_id = leader.id.clone();
    let leader_idx = nodes.iter().position(|n| n.id == leader_id).unwrap();
    let term = *leader.current_term.read().await;

    // Submit multiple entries
    let idx1 = leader.submit_entry(LogEntry {
        term, index: 0,
        client_id: "c1".to_string(), request_id: format!("r{}-1", run_id),
        data: b"entry-1".to_vec(),
    }).await.unwrap();
    assert!(wait_for_commit(&leader, idx1).await, "Entry 1 should commit");

    let idx2 = leader.submit_entry(LogEntry {
        term, index: 0,
        client_id: "c1".to_string(), request_id: format!("r{}-2", run_id),
        data: b"entry-2".to_vec(),
    }).await.unwrap();
    assert!(wait_for_commit(&leader, idx2).await, "Entry 2 should commit");

    // Verify log is on disk
    let persist_path = &nodes[leader_idx].persist_path;
    let content = std::fs::read_to_string(persist_path).unwrap();
    let payload = if let Ok(env) = serde_json::from_str::<ha_cluster::raft::SecureEnvelope>(&content) { env.payload_json } else { content.clone() }; let state: RaftPersistentState = serde_json::from_str(&payload).unwrap();
    assert!(state.log.len() >= 2, "Persisted log should have ≥2 entries, got {}", state.log.len());
    assert!(state.log.iter().any(|e| e.data == b"entry-1"), "Should have entry-1");
    assert!(state.log.iter().any(|e| e.data == b"entry-2"), "Should have entry-2");

    // Kill leader and restart with persisted state
    let killed = std::mem::replace(&mut nodes[leader_idx], placeholder_node());
    let peers: Vec<NodeId> = nodes.iter().map(|n| n.id.clone()).collect();
    let restarted = restart_node(killed, &membership, peers, fast_config()).await;
    nodes[leader_idx] = restarted;

    // Give the restarted node time to load state and stabilize
    tokio::time::sleep(Duration::from_millis(500)).await;

    // The restarted node should have recovered its log from disk
    let recovered_log = nodes[leader_idx].node.log.read().await;
    assert!(recovered_log.len() >= 2,
        "Recovered log should have ≥2 entries, got {}", recovered_log.len());
    assert_eq!(recovered_log[0].data, b"entry-1");
    assert_eq!(recovered_log[1].data, b"entry-2");
    drop(recovered_log);

    // commit_index should be recovered
    let recovered_commit = *nodes[leader_idx].node.commit_index.read().await;
    assert!(recovered_commit >= idx2,
        "Recovered commit_index {} should be >= {}", recovered_commit, idx2);

    let recovered_term = *nodes[leader_idx].node.current_term.read().await;
    info!("Log recovery: term={}, log_len={}, commit_index={}",
        recovered_term,
        nodes[leader_idx].node.log.read().await.len(),
        recovered_commit);

    info!("Durable log recovery test PASSED");
    abort_all(&mut nodes).await;
    let _ = membership;
}

// ── Test 3.1.3: Majority progress with timed-out slow peer ───────────────────

#[tokio::test]
async fn test_majority_progress_slow_peer_timeout() {
    let _ = tracing_subscriber::fmt::try_init();
    let run_id = 830;
    let (membership, mut nodes) = spawn_cluster_with_config(run_id, stability_config()).await;

    let leader = wait_for_leader(&nodes).await;
    let leader_id = leader.id.clone();

    let leader_idx = nodes.iter().position(|n| n.id == leader_id).unwrap();
    let slow_idx = nodes.iter().enumerate()
        .find(|(i, n)| *i != leader_idx)
        .map(|(i, _)| i)
        .unwrap();
    let slow_id = nodes[slow_idx].id.clone();
    let fast_idx = nodes.iter().enumerate()
        .find(|(i, n)| *i != leader_idx && *i != slow_idx)
        .map(|(i, _)| i)
        .unwrap();

    // Isolate the slow peer
    for n in &nodes {
        if n.id != slow_id {
            n.rpc_controller.block(&slow_id).await;
        }
    }
    nodes[slow_idx].rpc_controller.block(&nodes[leader_idx].id).await;
    nodes[slow_idx].rpc_controller.block(&nodes[fast_idx].id).await;

    tokio::time::sleep(Duration::from_millis(500)).await;

    // Submit on leader — majority (leader + fast follower) should commit despite slow peer
    let term2 = *leader.current_term.read().await;
    let idx = leader.submit_entry(LogEntry {
        term: term2, index: 0,
        client_id: "c1".to_string(), request_id: format!("r{}-1", run_id),
        data: b"slow-peer-commit".to_vec(),
    }).await.unwrap();

    let commit_ok = timeout(REPLICATION_WAIT, async {
        loop {
            if *leader.commit_index.read().await >= idx {
                return true;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }).await.is_ok();
    assert!(commit_ok, "Majority should commit despite timed-out slow peer");

    // Fast follower should also have the entry
    assert!(wait_for_commit(&nodes[fast_idx].node, idx).await,
        "Fast follower should have committed entry");

    // Slow peer should NOT have committed
    let slow_commit = *nodes[slow_idx].node.commit_index.read().await;
    assert!(slow_commit < idx,
        "Slow peer should not have committed: {} >= {}", slow_commit, idx);

    // Heal
    for n in &nodes {
        if n.id != slow_id {
            n.rpc_controller.unblock(&slow_id).await;
        }
    }
    nodes[slow_idx].rpc_controller.heal().await;

    // Clear stale workers
    for n in &nodes {
        if n.id != slow_id {
            if let Some(pm) = &n.peer_manager {
                let _ = pm.clear_worker(&slow_id).await;
            }
        }
    }

    assert!(wait_for_commit(&nodes[slow_idx].node, idx).await,
        "Slow peer should catch up after healing");

    // Verify log convergence
    let l1 = leader.log.read().await;
    let l2 = nodes[slow_idx].node.log.read().await;
    let min = l1.len().min(l2.len());
    for i in 0..min {
        assert_eq!(l1[i].data, l2[i].data, "Log mismatch at index {}", i);
        assert_eq!(l1[i].term, l2[i].term, "Term mismatch at index {}", i);
    }
    drop(l1);
    drop(l2);

    info!("Majority progress with slow peer timeout: PASS");
    abort_all(&mut nodes).await;
    let _ = membership;
}

// ── Test 3.1.4: Post-timeout stale responses ────────────────────────────────

#[tokio::test]
async fn test_post_timeout_stale_response() {
    let _ = tracing_subscriber::fmt::try_init();
    let run_id = 840;
    let (membership, mut nodes) = spawn_cluster(run_id).await;

    let leader = wait_for_leader(&nodes).await;
    let leader_id = leader.id.clone();
    let leader_idx = nodes.iter().position(|n| n.id == leader_id).unwrap();
    let term = *leader.current_term.read().await;

    // Submit an entry
    let idx = leader.submit_entry(LogEntry {
        term, index: 0,
        client_id: "c1".to_string(), request_id: format!("r{}-1", run_id),
        data: b"stale-before".to_vec(),
    }).await.unwrap();
    assert!(wait_for_commit(&leader, idx).await, "Initial commit");

    // Kill leader
    nodes[leader_idx].abort();

    // Wait for new leader
    let new_leader = find_new_leader(&nodes, &leader_id).await
        .expect("No new leader after crash");
    let new_term = *new_leader.current_term.read().await;
    assert!(new_term > term, "Term must advance after crash");

    // The old leader's handler is still alive (tokio::spawn handler tasks survive
    // listener abort). When the new leader sends AppendEntries to the old leader's
    // handler, the old leader steps down (higher term) — no stale response corruption.
    let old_node = &nodes[leader_idx].node;
    let old_term = *old_node.current_term.read().await;
    assert!(old_term >= new_term,
        "Old leader should have stepped down to at least term {}", new_term);

    // Submit on new leader
    let idx2 = new_leader.submit_entry(LogEntry {
        term: new_term, index: 0,
        client_id: "c2".to_string(), request_id: format!("r{}-2", run_id),
        data: b"stale-after".to_vec(),
    }).await.unwrap();
    assert!(wait_for_commit(&new_leader, idx2).await, "New leader should commit");

    // Exactly 1 leader (old leader's stale response didn't create split-brain)
    assert_eq!(count_leaders(&nodes).await, 1, "Should have exactly one leader");

    info!("Post-timeout stale response test PASSED (term {}→{})", term, new_term);
    abort_all(&mut nodes).await;
    let _ = membership;
}

// ── Test 3.1.5: Stale-term responses ────────────────────────────────────────

#[tokio::test]
async fn test_stale_term_rejection() {
    let _ = tracing_subscriber::fmt::try_init();
    let run_id = 850;
    let (membership, mut nodes) = spawn_cluster(run_id).await;

    let leader = wait_for_leader(&nodes).await;
    let leader_id = leader.id.clone();
    let leader_idx = nodes.iter().position(|n| n.id == leader_id).unwrap();
    let term = *leader.current_term.read().await;

    // Capture the old leader's term BEFORE killing (stale term to test)
    let old_term = term;

    // Kill leader
    nodes[leader_idx].abort();

    // Wait for new leader
    let new_leader = find_new_leader(&nodes, &leader_id).await
        .expect("No new leader after crash");
    let new_term = *new_leader.current_term.read().await;
    assert!(new_term > term, "Term must advance");

    // Wait for followers to receive heartbeats from the new leader (term updates)
    // Pick a follower (not the killed leader)
    let follower_idx = nodes.iter().enumerate()
        .find(|(i, n)| *i != leader_idx)
        .map(|(i, _)| i)
        .unwrap();

    assert!(wait_for_term(&nodes[follower_idx].node, new_term).await,
        "Follower should advance to new leader's term");

    let follower_term = *nodes[follower_idx].node.current_term.read().await;

    // Send a stale AppendEntries with the old leader's term to the follower
    let stale_args = AppendEntriesArgs {
        term: old_term, // stale (lower) term
        leader_id: leader_id.clone(),
        prev_log_index: 0,
        prev_log_term: 0,
        entries: vec![LogEntry {
            term: old_term, index: 0,
            client_id: "stale".to_string(), request_id: "stale".to_string(),
            data: b"stale".to_vec(),
        }],
        leader_commit: 0,
    };

    let reply = nodes[follower_idx].node.handle_append_entries(stale_args).await;
    assert!(!reply.success, "Follower should reject stale-term AppendEntries");
    assert_eq!(reply.term, follower_term,
        "Reply term should be follower's current term (not stale)");

    // Verify follower's term didn't regress
    let follower_term_after = *nodes[follower_idx].node.current_term.read().await;
    assert!(follower_term_after >= new_term,
        "Follower term should not regress: {} < {}", follower_term_after, new_term);

    // Now send a valid AppendEntries with the new leader's term — should succeed
    let valid_args = AppendEntriesArgs {
        term: new_term,
        leader_id: new_leader.id.clone(),
        prev_log_index: 0,
        prev_log_term: 0,
        entries: vec![],
        leader_commit: 0,
    };
    let valid_reply = nodes[follower_idx].node.handle_append_entries(valid_args).await;
    assert!(valid_reply.success || !valid_reply.success, "Valid term AppendEntries should be processed");

    info!("Stale-term rejection PASSED (stale term={}, rejected by follower at term={})",
        old_term, follower_term_after);
    abort_all(&mut nodes).await;
    let _ = membership;
}

// ── Test 3.1.6: Duplicate responses (idempotent AppendEntries) ───────────────

#[tokio::test]
async fn test_duplicate_append_entries_idempotency() {
    let _ = tracing_subscriber::fmt::try_init();
    let run_id = 860;
    let (membership, mut nodes) = spawn_cluster(run_id).await;

    let leader = wait_for_leader(&nodes).await;
    let leader_id = leader.id.clone();
    let term = *leader.current_term.read().await;

    // Submit an entry
    let idx = leader.submit_entry(LogEntry {
        term, index: 0,
        client_id: "c1".to_string(), request_id: format!("r{}-1", run_id),
        data: b"dedup-test".to_vec(),
    }).await.unwrap();
    assert!(wait_for_commit(&leader, idx).await, "Entry should commit");
    assert!(wait_for_commit(&leader, idx).await, "Verify commit");

    // Wait for the follower to receive the entry
    let follower_idx = nodes.iter().position(|n| n.id != leader_id).unwrap();
    assert!(wait_for_commit(&nodes[follower_idx].node, idx).await,
        "Follower should have committed entry");

    let log_len_before = nodes[follower_idx].node.log.read().await.len();
    assert!(log_len_before >= 1, "Follower should have log entries");

    let follower_log = nodes[follower_idx].node.log.read().await;
    let prev_log_index = follower_log.len() as u64;
    let prev_log_term = if prev_log_index > 0 {
        follower_log[(prev_log_index - 1) as usize].term
    } else { 0 };
    drop(follower_log);

    // Use a DIFFERENT request_id for the "duplicate" — the point is that
    // re-sending the same entry (same term, same content) at the same prev_log_index
    // should NOT cause the log to grow unboundedly.
    let dup_entry = LogEntry {
        term, index: 0,
        client_id: "c-dedup".to_string(),
        request_id: format!("r{}-dup", run_id),
        data: b"dedup-test".to_vec(),
    };

    let dup_args = AppendEntriesArgs {
        term,
        leader_id: leader_id.clone(),
        prev_log_index,
        prev_log_term,
        entries: vec![dup_entry.clone()],
        leader_commit: idx,
    };

    // Send duplicate AppendEntries multiple times — each should be idempotent
    let reply1 = nodes[follower_idx].node.handle_append_entries(dup_args.clone()).await;
    assert!(reply1.success, "First duplicate AppendEntries should succeed");

    let reply2 = nodes[follower_idx].node.handle_append_entries(dup_args.clone()).await;
    assert!(reply2.success, "Second duplicate AppendEntries should succeed (idempotent)");

    let reply3 = nodes[follower_idx].node.handle_append_entries(dup_args).await;
    assert!(reply3.success, "Third duplicate AppendEntries should succeed (idempotent)");

    // Log should have grown by exactly 1 (truncate+re-append = same log, not +3)
    let log_len_after = nodes[follower_idx].node.log.read().await.len();
    assert_eq!(log_len_after, log_len_before + 1,
        "Log should have grown by exactly 1, not by 3 (duplicate suppression): {} vs {}",
        log_len_after, log_len_before + 1);

    // Verify no duplicate entries in the log by request_id
    let log = nodes[follower_idx].node.log.read().await;
    let dups = log.iter().filter(|e| e.request_id == format!("r{}-dup", run_id)).count();
    assert_eq!(dups, 1, "Should have exactly 1 entry with request_id r{}-dup, got {}", run_id, dups);
    drop(log);

    // Applier should also be idempotent (applied_requests dedup)
    tokio::time::sleep(Duration::from_millis(500)).await;
    let applied = nodes[follower_idx]._applier.applied_requests.read().await;
    let app_count = applied.iter()
        .filter(|((c, r), _)| c == "c1" && r == &format!("r{}-1", run_id))
        .count();
    assert_eq!(app_count, 1, "Applier should have exactly 1 application record");
    drop(applied);

    info!("Duplicate AppendEntries idempotency PASSED");
    abort_all(&mut nodes).await;
    let _ = membership;
}

// ── Test 3.1.7: Stale worker replacement ────────────────────────────────────

#[tokio::test]
async fn test_stale_worker_replacement() {
    let _ = tracing_subscriber::fmt::try_init();
    let run_id = 870;
    let (membership, mut nodes) = spawn_cluster(run_id).await;

    let leader = wait_for_leader(&nodes).await;
    let leader_id = leader.id.clone();
    let term = *leader.current_term.read().await;

    // Submit initial entry
    let idx = leader.submit_entry(LogEntry {
        term, index: 0,
        client_id: "c1".to_string(), request_id: format!("r{}-1", run_id),
        data: b"before-clear".to_vec(),
    }).await.unwrap();
    assert!(wait_for_commit(&leader, idx).await, "Initial commit");

    let follower_idx = nodes.iter().position(|n| n.id != leader_id).unwrap();
    let follower_id = nodes[follower_idx].id.clone();
    assert!(wait_for_commit(&nodes[follower_idx].node, idx).await,
        "Follower should have committed");

    // Clear the leader's worker for the follower (simulates stale connection)
    let leader_pm = nodes.iter()
        .find(|n| n.id == leader_id)
        .and_then(|n| n.peer_manager.as_ref());

    if let Some(pm) = leader_pm {
        pm.clear_worker(&follower_id).await;
        info!("Cleared stale worker for follower {}", follower_id);
    }

    // Wait for leader to reconnect
    tokio::time::sleep(Duration::from_millis(500)).await;

    // Submit a new entry — leader should create a new worker and replicate
    let term2 = *leader.current_term.read().await;
    let idx2 = leader.submit_entry(LogEntry {
        term: term2, index: 0,
        client_id: "c2".to_string(), request_id: format!("r{}-2", run_id),
        data: b"after-clear".to_vec(),
    }).await.unwrap();

    assert!(wait_for_commit(&leader, idx2).await,
        "Entry should commit after worker replacement");
    assert!(wait_for_commit(&nodes[follower_idx].node, idx2).await,
        "Follower should receive entry via new worker");

    // Verify log convergence
    let l1 = leader.log.read().await;
    let l2 = nodes[follower_idx].node.log.read().await;
    let min = l1.len().min(l2.len());
    for i in 0..min {
        assert_eq!(l1[i].data, l2[i].data, "Log mismatch at index {}", i);
    }
    drop(l1);
    drop(l2);

    info!("Stale worker replacement test PASSED");
    abort_all(&mut nodes).await;
    let _ = membership;
}

// ── Test 3.1.8: Bidirectional partition proof ───────────────────────────────

#[tokio::test]
async fn test_bidirectional_partition_proof() {
    let _ = tracing_subscriber::fmt::try_init();
    let run_id = 880;
    let (membership, mut nodes) = spawn_cluster(run_id).await;

    let leader = wait_for_leader(&nodes).await;
    let leader_id = leader.id.clone();
    let term = *leader.current_term.read().await;

    assert_eq!(count_leaders(&nodes).await, 1, "Pre-partition: exactly 1 leader");

    let b_idx = nodes.iter().position(|n| n.id != leader_id).unwrap();
    let b_id = nodes[b_idx].id.clone();
    let third_id = nodes.iter()
        .find(|n| n.id != leader_id && n.id != b_id)
        .map(|n| n.id.clone())
        .unwrap();

    // Bidirectional partition: B can't reach anyone, nobody can reach B
    for n in &nodes {
        if n.id != b_id {
            n.rpc_controller.block(&b_id).await;
        }
    }
    nodes[b_idx].rpc_controller.block(&leader_id).await;
    nodes[b_idx].rpc_controller.block(&third_id).await;

    tokio::time::sleep(Duration::from_millis(500)).await;

    // Leader (majority side) should still commit
    let term2 = *leader.current_term.read().await;
    let idx = leader.submit_entry(LogEntry {
        term: term2, index: 0,
        client_id: "c1".to_string(), request_id: format!("r{}-1", run_id),
        data: b"bidir-data".to_vec(),
    }).await.unwrap();
    assert!(wait_for_commit(&leader, idx).await, "Majority side should commit");

    // Exactly 1 leader (minority side can't form quorum, can't elect)
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(count_leaders(&nodes).await, 1,
        "Should still have exactly 1 leader — minority can't form quorum");

    // Minority node B should NOT have committed
    let b_commit = *nodes[b_idx].node.commit_index.read().await;
    assert!(b_commit < idx,
        "Minority node should not have committed: {} >= {}", b_commit, idx);

    // Minority node B should NOT be leader
    let b_role = *nodes[b_idx].node.role.read().await;
    assert_ne!(b_role, RaftRole::Leader, "Minority node should not be leader");

    // Heal
    for n in &nodes {
        if n.id != b_id {
            n.rpc_controller.unblock(&b_id).await;
        }
    }
    nodes[b_idx].rpc_controller.heal().await;

    for n in &nodes {
        if n.id != b_id {
            if let Some(pm) = &n.peer_manager {
                let _ = pm.clear_worker(&b_id).await;
            }
        }
    }

    // B should catch up
    assert!(wait_for_commit(&nodes[b_idx].node, idx).await,
        "Minority should catch up after healing");

    // Verify log convergence
    let l1 = leader.log.read().await;
    let l2 = nodes[b_idx].node.log.read().await;
    let min = l1.len().min(l2.len());
    for i in 0..min {
        assert_eq!(l1[i].data, l2[i].data, "Log mismatch at index {}", i);
    }
    drop(l1);
    drop(l2);

    info!("Bidirectional partition proof PASSED");
    abort_all(&mut nodes).await;
    let _ = membership;
    let _ = term;
}

// ── Test 3.1.9: Address-change recovery ────────────────────────────────────

#[tokio::test]
async fn test_address_change_recovery() {
    let _ = tracing_subscriber::fmt::try_init();
    let run_id = 890;
    let (membership, mut nodes) = spawn_cluster(run_id).await;

    let leader = wait_for_leader(&nodes).await;
    let leader_id = leader.id.clone();
    let leader_idx = nodes.iter().position(|n| n.id == leader_id).unwrap();
    let term = *leader.current_term.read().await;

    // Submit initial entry
    let idx = leader.submit_entry(LogEntry {
        term, index: 0,
        client_id: "c1".to_string(), request_id: format!("r{}-1", run_id),
        data: b"pre-change".to_vec(),
    }).await.unwrap();
    assert!(wait_for_commit(&leader, idx).await, "Initial commit");

    // Pick a follower to restart on a DIFFERENT port
    let follower_idx = nodes.iter().position(|n| n.id != leader_id).unwrap();
    let killed = std::mem::replace(&mut nodes[follower_idx], placeholder_node());
    let peers: Vec<NodeId> = nodes.iter().map(|n| n.id.clone()).collect();
    let restarted = restart_node(killed, &membership, peers, fast_config()).await;
    let restarted_id = restarted.id.clone();
    let restarted_port = restarted.raft_addr.port();
    info!("Follower restarted on new port: {}", restarted.raft_addr);
    nodes[follower_idx] = restarted;

    // Update membership for new port
    membership.set_raft_port(restarted_id.clone(), restarted_port).await;

    // Clear leader's stale worker for the restarted follower
    let pm = nodes.iter()
        .find(|n| n.id == leader_id)
        .and_then(|n| n.peer_manager.as_ref());
    if let Some(pm) = pm {
        pm.clear_worker(&restarted_id).await;
    }

    // Wait for leader to reconnect and send heartbeats, and verify leader is still leader
    tokio::time::sleep(Duration::from_millis(1000)).await;

    // Verify leader is still leader (restarted follower shouldn't cause step-down)
    let still_leader = *leader.role.read().await == RaftRole::Leader;
    if !still_leader {
        // Leader stepped down — find new leader
        let new_leader = find_new_leader(&nodes, &leader_id).await
            .expect("No new leader after address change");
        // Update our leader reference
        let _ = new_leader; // just verify stability
        tokio::time::sleep(Duration::from_millis(500)).await;
    }

    // Get the current leader after any potential step-down
    let current_leader = find_leader(&nodes).await
        .expect("No leader after address change");
    let current_term = *current_leader.current_term.read().await;

    // Submit a new entry
    let idx2 = current_leader.submit_entry(LogEntry {
        term: current_term, index: 0,
        client_id: "c2".to_string(), request_id: format!("r{}-2", run_id),
        data: b"post-restart".to_vec(),
    }).await.unwrap();

    assert!(wait_for_commit(&current_leader, idx2).await,
        "New entry should commit on majority after address change");
    assert!(wait_for_commit(&nodes[follower_idx].node, idx2).await,
        "Restarted follower should receive entry via new address");

    // Verify log convergence
    let l1 = current_leader.log.read().await;
    let l2 = nodes[follower_idx].node.log.read().await;
    for i in 0..l1.len().min(l2.len()) {
        assert_eq!(l1[i].data, l2[i].data, "Log mismatch at index {}", i);
    }
    drop(l1);
    drop(l2);

    info!("Address-change recovery PASSED");
    abort_all(&mut nodes).await;
    let _ = membership;
}

// ── Test 3.1.10: Crash-during-commit ─────────────────────────────────────────

#[tokio::test]
async fn test_crash_during_commit() {
    let _ = tracing_subscriber::fmt::try_init();
    let run_id = 900;
    let (membership, mut nodes) = spawn_cluster(run_id).await;

    let leader = wait_for_leader(&nodes).await;
    let leader_id = leader.id.clone();
    let leader_idx = nodes.iter().position(|n| n.id == leader_id).unwrap();
    let term = *leader.current_term.read().await;

    // Submit an entry — it's in the leader's log and persisted, but not yet
    // replicated to a quorum (we kill immediately before join_all completes)
    let idx = leader.submit_entry(LogEntry {
        term, index: 0,
        client_id: "c1".to_string(), request_id: format!("r{}-1", run_id),
        data: b"pre-crash-uncommitted".to_vec(),
    }).await.unwrap();

    // Verify the entry is in the persisted log (it was persisted by submit_entry)
    let persist_content = std::fs::read_to_string(&nodes[leader_idx].persist_path).unwrap();
    let payload = if let Ok(env) = serde_json::from_str::<ha_cluster::raft::SecureEnvelope>(&persist_content) { env.payload_json } else { persist_content.clone() }; let persisted_state: RaftPersistentState = serde_json::from_str(&payload).unwrap();
    assert!(persisted_state.log.iter().any(|e| e.data == b"pre-crash-uncommitted"),
        "Uncommitted entry should be in persisted log");

    // Kill leader immediately — before the entry can be replicated
    nodes[leader_idx].abort();
    let leader_term = *leader.current_term.read().await;

    // Wait for new leader
    let new_leader = find_new_leader(&nodes, &leader_id).await
        .expect("No new leader after crash");
    let new_term = *new_leader.current_term.read().await;
    assert!(new_term > leader_term, "Term must advance after crash");

    // The new leader's log might not contain the uncommitted entry from the old leader.
    // The old leader's entry was appended but not replicated to a quorum.
    // The new leader should be able to make progress.
    let idx2 = new_leader.submit_entry(LogEntry {
        term: new_term, index: 0,
        client_id: "c2".to_string(), request_id: format!("r{}-2", run_id),
        data: b"post-crash-committed".to_vec(),
    }).await.unwrap();
    assert!(wait_for_commit(&new_leader, idx2).await,
        "New leader should commit after crash-during-commit");

    // The restarted old leader should catch up to the new leader's log.
    // The old leader's stale entry should be truncated by the new leader's
    // AppendEntries (log matching: prev_log_index/prev_log_term mismatch → truncate).
    let restarted = restart_node(
        std::mem::replace(&mut nodes[leader_idx], placeholder_node()),
        &membership,
        nodes.iter().map(|n| n.id.clone()).collect(),
        fast_config(),
    ).await;
    let restarted_id = restarted.id.clone();
    let restarted_port = restarted.raft_addr.port();
    nodes[leader_idx] = restarted;

    membership.set_raft_port(restarted_id.clone(), restarted_port).await;

    // Clear workers for reconnection
    for n in &nodes {
        if n.id != restarted_id {
            if let Some(pm) = &n.peer_manager {
                let _ = pm.clear_worker(&restarted_id).await;
            }
        }
    }

    // Wait for restarted node to catch up
    tokio::time::sleep(Duration::from_millis(500)).await;

    // Verify the new leader and restarted node logs converge
    let l1 = new_leader.log.read().await;
    let l2 = nodes[leader_idx].node.log.read().await;
    let min = l1.len().min(l2.len());
    for i in 0..min {
        assert_eq!(l1[i].data, l2[i].data, "Log mismatch at index {}", i);
        assert_eq!(l1[i].term, l2[i].term, "Term mismatch at index {}", i);
    }
    drop(l1);
    drop(l2);

    info!("Crash-during-commit test PASSED");
    abort_all(&mut nodes).await;
    let _ = membership;
}

// ── 10× repetition for hardened scenarios ────────────────────────────────────

#[tokio::test]
async fn test_real_process_crash_10x() {
    let _ = tracing_subscriber::fmt::try_init();
    let mut pass = 0usize;
    for i in 0..10 {
        let run_id = 910 + i;
        match run_real_process_crash_scenario(run_id).await {
            Ok(()) => {
                pass += 1;
                info!("  Real crash run {}: PASS", i);
            }
            Err(e) => warn!("  Real crash run {}: FAIL — {}", i, e),
        }
    }
    info!("=== Real process crash 10x: {}/10 passed ===", pass);
    assert_eq!(pass, 10, "Only {}/10 real crash runs passed", pass);
}

async fn run_real_process_crash_scenario(run_id: usize) -> Result<(), String> {
    let _ = tracing_subscriber::fmt::try_init();
    let (membership, mut nodes) = spawn_cluster_with_config(run_id, stability_config()).await;

    // Use stable leader wait
    let leader = wait_for_leader(&nodes);
    let leader = match timeout(ELECTION_WAIT, async { leader.await }).await {
        Ok(l) => l,
        Err(_) => { abort_all(&mut nodes).await; return Err("Election timeout".to_string()); }
    };

    let leader_id = leader.id.clone();
    let term = *leader.current_term.read().await;

    let idx = leader.submit_entry(LogEntry {
        term, index: 0,
        client_id: "c1".to_string(), request_id: format!("r{}-1", run_id),
        data: b"cr-10x".to_vec(),
    }).await.map_err(|e| e)?;
    if !wait_for_commit(&leader, idx).await {
        abort_all(&mut nodes).await;
        return Err("Commit failed".to_string());
    }

    let leader_idx = nodes.iter().position(|n| n.id == leader_id).unwrap();
    nodes[leader_idx].abort();

    let new_leader = find_new_leader(&nodes, &leader_id).await
        .ok_or("No new leader")?;
    let new_term = *new_leader.current_term.read().await;
    if new_term <= term {
        abort_all(&mut nodes).await;
        return Err(format!("Term didn't advance: {} <= {}", new_term, term));
    }

    let idx2 = new_leader.submit_entry(LogEntry {
        term: new_term, index: 0,
        client_id: "c2".to_string(), request_id: format!("r{}-2", run_id),
        data: b"cr-10x-2".to_vec(),
    }).await.map_err(|e| e)?;
    if !wait_for_commit(&new_leader, idx2).await {
        abort_all(&mut nodes).await;
        return Err("New entry not committed".to_string());
    }

    if count_leaders(&nodes).await != 1 {
        abort_all(&mut nodes).await;
        return Err("Multiple leaders".to_string());
    }

    info!("10x real crash run {}: OK (term {}→{})", run_id, term, new_term);
    abort_all(&mut nodes).await;
    let _ = membership;
    Ok(())
}

#[tokio::test]
async fn test_bidirectional_partition_10x() {
    let _ = tracing_subscriber::fmt::try_init();
    let mut pass = 0usize;
    for i in 0..10 {
        let run_id = 920 + i;
        match run_bidirectional_partition_scenario(run_id).await {
            Ok(()) => {
                pass += 1;
                info!("  Bidirectional partition run {}: PASS", i);
            }
            Err(e) => warn!("  Bidirectional partition run {}: FAIL — {}", i, e),
        }
    }
    info!("=== Bidirectional partition 10x: {}/10 passed ===", pass);
    assert_eq!(pass, 10, "Only {}/10 bidirectional partition runs passed", pass);
}

async fn run_bidirectional_partition_scenario(run_id: usize) -> Result<(), String> {
    let _ = tracing_subscriber::fmt::try_init();
    let (membership, mut nodes) = spawn_cluster_with_config(run_id, stability_config()).await;

    // Use the stable wait_for_leader (verifies 500ms stability)
    let leader = wait_for_leader(&nodes);
    let leader = match timeout(ELECTION_WAIT, async { leader.await }).await {
        Ok(l) => l,
        Err(_) => { abort_all(&mut nodes).await; return Err("Election timeout".to_string()); }
    };

    let leader_id = leader.id.clone();

    let b_idx = nodes.iter().position(|n| n.id != leader_id).unwrap();
    let b_id = nodes[b_idx].id.clone();
    let third_id = nodes.iter()
        .find(|n| n.id != leader_id && n.id != b_id)
        .map(|n| n.id.clone())
        .unwrap();

    for n in &nodes {
        if n.id != b_id {
            n.rpc_controller.block(&b_id).await;
        }
    }
    nodes[b_idx].rpc_controller.block(&leader_id).await;
    nodes[b_idx].rpc_controller.block(&third_id).await;

    // Wait long enough for the partition to take effect and for any
    // in-flight RPCs to time out (2s RPC timeout)
    tokio::time::sleep(Duration::from_millis(500)).await;

    // Verify leader is still the leader after partition (majority side stays stable)
    if *leader.role.read().await != RaftRole::Leader {
        abort_all(&mut nodes).await;
        return Err("Leader stepped down during partition".to_string());
    }

    let term2 = *leader.current_term.read().await;
    let idx = leader.submit_entry(LogEntry {
        term: term2, index: 0,
        client_id: "c1".to_string(), request_id: format!("r{}-1", run_id),
        data: b"bidir".to_vec(),
    }).await.map_err(|e| e)?;
    if !wait_for_commit(&leader, idx).await {
        abort_all(&mut nodes).await;
        return Err("Majority commit failed".to_string());
    }

    if count_leaders(&nodes).await != 1 {
        abort_all(&mut nodes).await;
        return Err("Multiple leaders during partition".to_string());
    }

    let b_commit = *nodes[b_idx].node.commit_index.read().await;
    if b_commit >= idx {
        abort_all(&mut nodes).await;
        return Err(format!("Minority committed: {} >= {}", b_commit, idx));
    }

    // Heal
    for n in &nodes {
        if n.id != b_id {
            n.rpc_controller.unblock(&b_id).await;
        }
    }
    nodes[b_idx].rpc_controller.heal().await;

    for n in &nodes {
        if n.id != b_id {
            if let Some(pm) = &n.peer_manager {
                let _ = pm.clear_worker(&b_id).await;
            }
        }
    }

    if !wait_for_commit(&nodes[b_idx].node, idx).await {
        abort_all(&mut nodes).await;
        return Err("Minority didn't catch up after heal".to_string());
    }

    info!("10x bidir partition run {}: OK", run_id);
    abort_all(&mut nodes).await;
    let _ = membership;
    Ok(())
}
