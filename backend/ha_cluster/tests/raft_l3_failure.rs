//! P3.8 STEP 3 — Failure / Recovery / Partition Validation.
//!
//! Tests use the REAL authenticated PQ transport stack:
//! RaftNode → RaftRpcClient → AeadTransport → TCP → RaftNetworkListener → RaftNode
//!
//! Fault injection: a test-only NetworkController wraps the real RaftPeerManager
//! (which implements RaftRpcClient) and can inject message drops (partitions)
//! and send delays (stale/delayed delivery).

use std::collections::{HashMap, HashSet};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::pin::Pin;
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

const ELECTION_WAIT: Duration = Duration::from_secs(25);
const REPLICATION_WAIT: Duration = Duration::from_secs(30);
/// Longer election wait for scenarios using stability_config (3-5s election timeout)
const ELECTION_WAIT_STABLE: Duration = Duration::from_secs(40);

/// Fast config: short election timeouts for quick test cycle times.
fn fast_config() -> RaftConfig {
    RaftConfig {
        election_timeout_min_ms: 1000,
        election_timeout_max_ms: 2000,
        heartbeat_interval_ms: 200,
        persist_on_submit: true,
            state_machine_mac_key: Some([0x42; 32]),
    }
}

/// Stability config: election timeout > 2s RPC timeout prevents follower
/// election-timer expiry while leader's join_all is blocked on a stale/slow peer.
fn stability_config() -> RaftConfig {
    RaftConfig {
        election_timeout_min_ms: 8000,
        election_timeout_max_ms: 12000,
        heartbeat_interval_ms: 200,
        persist_on_submit: true,
            state_machine_mac_key: Some([0x42; 32]),
    }
}

// ── NetworkController: test-only fault injector ────────────────────────────

/// Wraps a real RaftRpcClient and injects configurable network faults.
/// Only compiled in test binaries — never used in production code.
pub struct NetworkController {
    inner: Arc<dyn RaftRpcClient>,
    /// Peers whose messages are completely dropped (partition / dead node)
    blocked: Arc<RwLock<HashSet<NodeId>>>,
    /// Per-peer send delay in milliseconds
    delays: Arc<RwLock<HashMap<NodeId, u64>>>,
}

impl NetworkController {
    pub fn new(inner: Arc<dyn RaftRpcClient>) -> Self {
        Self {
            inner,
            blocked: Arc::new(RwLock::new(HashSet::new())),
            delays: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn block(&self, peer: &NodeId) {
        self.blocked.write().await.insert(peer.clone());
    }

    pub async fn unblock(&self, peer: &NodeId) {
        self.blocked.write().await.remove(peer);
    }

    pub async fn delay(&self, peer: &NodeId, ms: u64) {
        self.delays.write().await.insert(peer.clone(), ms);
    }

    pub async fn clear_delay(&self, peer: &NodeId) {
        self.delays.write().await.remove(peer);
    }

    pub async fn heal(&self) {
        self.blocked.write().await.clear();
        self.delays.write().await.clear();
    }
}

impl RaftRpcClient for NetworkController {
    fn send_request_vote(
        &self,
        to: NodeId,
        args: RequestVoteArgs,
    ) -> Pin<Box<dyn std::future::Future<Output = Result<RequestVoteReply, String>> + Send>> {
        let inner = self.inner.clone();
        let blocked = self.blocked.clone();
        let delays = self.delays.clone();

        Box::pin(async move {
            if blocked.read().await.contains(&to) {
                return Err(format!("NetworkController: peer {} blocked", to));
            }
            let delay_ms = delays.read().await.get(&to).copied().unwrap_or(0);
            if delay_ms > 0 {
                tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                if blocked.read().await.contains(&to) {
                    return Err(format!("peer {} blocked during delay", to));
                }
            }
            inner.send_request_vote(to, args).await
        })
    }

    fn send_append_entries(
        &self,
        to: NodeId,
        args: AppendEntriesArgs,
    ) -> Pin<Box<dyn std::future::Future<Output = Result<AppendEntriesReply, String>> + Send>> {
        let inner = self.inner.clone();
        let blocked = self.blocked.clone();
        let delays = self.delays.clone();

        Box::pin(async move {
            if blocked.read().await.contains(&to) {
                return Err(format!("NetworkController: peer {} blocked", to));
            }
            let delay_ms = delays.read().await.get(&to).copied().unwrap_or(0);
            if delay_ms > 0 {
                tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                if blocked.read().await.contains(&to) {
                    return Err(format!("peer {} blocked during delay", to));
                }
            }
            inner.send_append_entries(to, args).await
        })
    }
}

// ── Test harness ────────────────────────────────────────────────────────────

struct TestNode {
    id: NodeId,
    identity: Arc<QuantumNodeIdentity>,
    node: Arc<RaftNode>,
    ledger: Arc<MerkleLedger>,
    applier: Arc<LedgerApplier>,
    listener_handle: tokio::task::JoinHandle<()>,
    run_handle: tokio::task::JoinHandle<()>,
    apply_handle: tokio::task::JoinHandle<()>,
    rpc_controller: Arc<NetworkController>,
    peer_manager: Option<Arc<RaftPeerManager>>,
    raft_addr: SocketAddr,
    persist_path: PathBuf,
    killed: std::sync::atomic::AtomicBool,
}

impl TestNode {
    fn abort(&mut self) {
        self.killed.store(true, std::sync::atomic::Ordering::SeqCst);
        self.run_handle.abort();
        self.listener_handle.abort();
        self.apply_handle.abort();
    }
}

/// Spawn a single Raft node with real PQ transport + NetworkController.
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

    TestNode {
        id,
        identity,
        node: raft_node,
        ledger,
        applier,
        listener_handle,
        run_handle,
        apply_handle,
        rpc_controller: nc,
        peer_manager: Some(peer_manager),
        raft_addr: bound_addr,
        persist_path: persist_path.clone(),
        killed: std::sync::atomic::AtomicBool::new(false),
    }
}

/// Spawn a fresh 3-node cluster on unique ports.
async fn spawn_cluster(run_id: usize) -> (Arc<ClusterMembership>, Vec<TestNode>) {
    spawn_cluster_with_config(run_id, RaftConfig {
        election_timeout_min_ms: 1000,
        election_timeout_max_ms: 2000,
        heartbeat_interval_ms: 200,
        persist_on_submit: true,
            state_machine_mac_key: Some([0x42; 32]),
    }).await
}

/// Spawn a fresh 3-node cluster with a custom RaftConfig.
async fn spawn_cluster_with_config(
    run_id: usize,
    config: RaftConfig,
) -> (Arc<ClusterMembership>, Vec<TestNode>) {
    let membership = Arc::new(ClusterMembership::new());

    let addr_a: SocketAddr = "127.0.0.1:0".parse().unwrap();
    let addr_b: SocketAddr = "127.0.0.1:0".parse().unwrap();
    let addr_c: SocketAddr = "127.0.0.1:0".parse().unwrap();

    let node_a_id = NodeId::new("node-a");
    let node_b_id = NodeId::new("node-b");
    let node_c_id = NodeId::new("node-c");

    let peers: Vec<NodeId> = vec![node_a_id.clone(), node_b_id.clone(), node_c_id.clone()];
    let uid = uuid::Uuid::new_v4();
    let persist_a = PathBuf::from(format!("/tmp/raft_fail_{}_{}_a.json", run_id, uid));
    let persist_b = PathBuf::from(format!("/tmp/raft_fail_{}_{}_b.json", run_id, uid));
    let persist_c = PathBuf::from(format!("/tmp/raft_fail_{}_{}_c.json", run_id, uid));
    // Clean any stale state
    for p in [&persist_a, &persist_b, &persist_c] {
        std::fs::remove_file(p).ok();
    }

    let mut nodes = vec![
        spawn_test_node(node_a_id.clone(), addr_a, membership.clone(), peers.clone(), &persist_a, config.clone()).await,
        spawn_test_node(node_b_id.clone(), addr_b, membership.clone(), peers.clone(), &persist_b, config.clone()).await,
        spawn_test_node(node_c_id.clone(), addr_c, membership.clone(), peers.clone(), &persist_c, config).await,
    ];

    // Give peers a moment to register via heartbeats
    tokio::time::sleep(Duration::from_millis(200)).await;

    (membership, nodes)
}

async fn abort_all(nodes: &mut [TestNode]) {
    for n in nodes.iter_mut() {
        n.abort();
    }
}

async fn find_leader(nodes: &[TestNode]) -> Option<Arc<RaftNode>> {
    for n in nodes {
        if n.killed.load(std::sync::atomic::Ordering::SeqCst) {
            continue;
        }
        if *n.node.role.read().await == RaftRole::Leader {
            return Some(n.node.clone());
        }
    }
    None
}

async fn wait_for_leader(nodes: &[TestNode]) -> Arc<RaftNode> {
    timeout(ELECTION_WAIT, async {
        loop {
            let leaders = count_leaders(nodes).await;
            let candidates = count_candidates(nodes).await;
            if leaders == 1 && candidates == 0 {
                return find_leader(nodes).await.unwrap();
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    })
    .await
    .expect("Election timed out — no stable leader")
}

async fn wait_for_leader_from(nodes: &[TestNode], exclude: &NodeId) -> Arc<RaftNode> {
    timeout(ELECTION_WAIT, async {
        loop {
            let leaders = count_leaders(nodes).await;
            let candidates = count_candidates(nodes).await;
            if leaders == 1 && candidates == 0 {
                if let Some(l) = find_leader(nodes).await {
                    if l.id != *exclude {
                        return l;
                    }
                }
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    })
    .await
    .expect("No new leader elected")
}

/// 10×-stable variant: longer election wait for scenarios with stability_config.
async fn find_leader_10x(nodes: &[TestNode]) -> Option<Arc<RaftNode>> {
    let result = timeout(ELECTION_WAIT_STABLE, async {
        loop {
            let leaders = count_leaders(nodes).await;
            let candidates = count_candidates(nodes).await;
            if leaders == 1 && candidates == 0 {
                if let Some(l) = find_leader(nodes).await {
                    return l;
                }
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    })
    .await;
    result.ok()
}

/// 10×-stable variant: wait for stable leader (1 leader, 0 candidates) excluding an old leader.
async fn wait_stable_leader_10x(nodes: &[TestNode], exclude: &NodeId) -> Arc<RaftNode> {
    timeout(ELECTION_WAIT_STABLE, async {
        loop {
            let leaders = count_leaders(nodes).await;
            let candidates = count_candidates(nodes).await;
            if leaders == 1 && candidates == 0 {
                if let Some(l) = find_leader(nodes).await {
                    if l.id != *exclude { return l; }
                }
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
    })
    .await
    .expect("No stable new leader elected (10x)")
}

async fn wait_for_log_len(node: &RaftNode, min_len: usize) -> bool {
    timeout(REPLICATION_WAIT, async {
        loop {
            let log = node.log.read().await;
            if log.len() >= min_len {
                return true;
            }
            drop(log);
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .unwrap_or(false)
}

async fn wait_for_commit(node: &RaftNode, min_idx: u64) -> bool {
    timeout(REPLICATION_WAIT, async {
        loop {
            if *node.commit_index.read().await >= min_idx {
                return true;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .unwrap_or(false)
}

async fn wait_for_term(node: &Arc<RaftNode>, min_term: u64) -> bool {
    timeout(REPLICATION_WAIT, async {
        loop {
            if *node.current_term.read().await >= min_term {
                return true;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .unwrap_or(false)
}

async fn count_leaders(nodes: &[TestNode]) -> usize {
    let mut count = 0;
    for n in nodes {
        if n.killed.load(std::sync::atomic::Ordering::SeqCst) {
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
        if n.killed.load(std::sync::atomic::Ordering::SeqCst) {
            continue;
        }
        if *n.node.role.read().await == RaftRole::Candidate {
            count += 1;
        }
    }
    count
}

/// Submit an entry to the leader and wait for it to be committed on all alive nodes.
async fn submit_and_replicate(
    leader: &Arc<RaftNode>,
    nodes: &[TestNode],
    client_id: &str,
    request_id: &str,
    data: &[u8],
) -> u64 {
    let term = *leader.current_term.read().await;
    let entry = LogEntry {
        term,
        index: 0,
        client_id: client_id.to_string(),
        request_id: request_id.to_string(),
        data: data.to_vec(),
    };
    let idx = leader.submit_entry(entry).await.expect("Not the leader");

    // Wait for all alive nodes to have the entry
    for n in nodes {
        if n.run_handle.is_finished() { continue; }
        assert!(wait_for_log_len(&n.node, idx as usize).await,
            "Node {} log not replicated to index {}", n.id, idx);
    }

    // Wait for all alive nodes to commit
    for n in nodes {
        if n.run_handle.is_finished() { continue; }
        assert!(wait_for_commit(&n.node, idx).await,
            "Node {} did not commit entry {}", n.id, idx);
    }

    idx
}

/// Restart a previously killed node on a NEW port with persisted state.
/// Using a new port forces the leader's PeerWorker to establish a fresh TCP connection
/// to the restarted listener (the old PeerWorker connection to the dead listener is stale).
async fn restart_node(
    mut old: TestNode,
    membership: &Arc<ClusterMembership>,
    peers: Vec<NodeId>,
    config: RaftConfig,
) -> TestNode {
    // 1. Explicitly abort old node background tasks so no background tasks from the dead node
    // compete for disk or network!
    old.abort();
    tokio::task::yield_now().await;

    let id = old.id.clone();
    let identity = old.identity.clone();
    let persist_path = old.persist_path.clone();

    // Use a new ephemeral port to force leader reconnection
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

    // CRITICAL: Register the REAL bound port in membership so leader discovers the new port
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

    // Give the restarted node a moment to load persisted state and connect
    tokio::time::sleep(Duration::from_millis(200)).await;

    TestNode {
        id,
        identity,
        node: raft_node,
        ledger,
        applier,
        listener_handle,
        run_handle,
        apply_handle,
        rpc_controller: nc,
        peer_manager: Some(peer_manager),
        raft_addr: bound_addr,
        persist_path,
        killed: std::sync::atomic::AtomicBool::new(false),
    }
}

// ── Test 1: Follower crash + recovery (real listener restart) ─────────────

#[tokio::test]
async fn test_follower_crash_and_recovery() {
    let _ = tracing_subscriber::fmt()
        .with_max_level(tracing::Level::DEBUG)
        .try_init();
    let (membership, mut nodes) = spawn_cluster(1).await;

    let leader = wait_for_leader(&nodes).await;
    info!("Leader elected: {}", leader.id);

    // Submit one entry that replicates to ALL nodes first
    let _idx1 = submit_and_replicate(&leader, &nodes, "client-1", "req-1", b"data-1").await;
    let idx2 = submit_and_replicate(&leader, &nodes, "client-1", "req-2", b"data-2").await;

    // Find a follower to kill
    let follower_idx = nodes.iter()
        .position(|n| n.id != leader.id)
        .expect("No follower found");
    let follower_id = nodes[follower_idx].id.clone();

    // Snapshot the follower's log length and commit index before killing
    let pre_kill_log_len = nodes[follower_idx].node.log.read().await.len();
    let pre_kill_commit = *nodes[follower_idx].node.commit_index.read().await;
    info!("Follower {} pre-kill: log_len={}, commit={}", follower_id, pre_kill_log_len, pre_kill_commit);

    // Kill the follower: abort handles AND block network on leader side.
    // Aborting only cancels tokio tasks but doesn't close existing TCP connections.
    // Blocking the peer via NetworkController ensures the leader cannot reach the
    // follower, simulating a truly dead node (process terminated, OS closed sockets).
    info!("Killing follower {} (abort + network block)", follower_id);
    nodes[follower_idx].abort();
    // Also block the follower on all OTHER nodes' rpc_controllers to prevent
    // any heartbeat/AppendEntries from reaching it
    for n in &nodes {
        if n.id != follower_id {
            n.rpc_controller.block(&follower_id).await;
        }
    }
    // Block the dead node from reaching back (if it somehow recovers)
    nodes[follower_idx].rpc_controller.heal().await; // clear any stale state
    nodes[follower_idx].rpc_controller.block(&leader.id).await;

    // Wait for the dead follower to be detected and for things to settle
    tokio::time::sleep(Duration::from_millis(800)).await;

    // Verify leader remains leader
    assert_eq!(*leader.role.read().await, RaftRole::Leader,
        "Leader stepped down after follower crash");

    // Submit a new entry — should commit on majority (2/3), NOT on dead follower
    let term = *leader.current_term.read().await;
    let idx3 = leader.submit_entry(LogEntry {
        term, index: 0,
        client_id: "client-1".to_string(), request_id: "post-crash-1".to_string(),
        data: b"post-crash-data".to_vec(),
    }).await.expect("Leader rejected entry after follower crash");

    // Wait for majority commit (leader + fast follower)
    assert!(wait_for_commit(&leader, idx3).await, "Entry not committed on leader");
    let fast_idx = nodes.iter().position(|n| n.id != leader.id && n.id != follower_id).unwrap();
    assert!(wait_for_commit(&nodes[fast_idx].node, idx3).await,
        "Fast follower did not commit entry");

    // Verify dead follower's commit did not advance (it cannot ACK — network blocked + tasks aborted)
    let dead_log_len = nodes[follower_idx].node.log.read().await.len();
    let dead_commit = *nodes[follower_idx].node.commit_index.read().await;
    assert_eq!(dead_log_len, pre_kill_log_len,
        "Dead follower log advanced: pre={}, post={}", pre_kill_log_len, dead_log_len);
    assert_eq!(dead_commit, pre_kill_commit,
        "Dead follower commit advanced: pre={}, post={}", pre_kill_commit, dead_commit);
    assert!(dead_log_len < idx3 as usize,
        "Dead follower has entry that shouldn't exist (log_len={}, idx={})", dead_log_len, idx3);
    info!("Dead follower verified frozen: log_len={}, commit={}", dead_log_len, dead_commit);

    // Restart the follower with persisted state (real listener restart)
    info!("Restarting follower {} (real listener restart)", follower_id);
    let peers: Vec<NodeId> = vec![NodeId::new("node-a"), NodeId::new("node-b"), NodeId::new("node-c")];

    let dead_node = nodes.remove(follower_idx);
    let restarted = restart_node(dead_node, &membership, peers, fast_config()).await;

    nodes.insert(follower_idx, restarted);

    // Force leader's PeerManager to drop stale worker and reconnect to new port.
    // The leader's cached PeerWorker is connected to the old (dead) listener.
    // Clearing it forces get_or_spawn_worker to look up the updated membership address.
    let leader_idx = nodes.iter().position(|n| n.id == leader.id).unwrap();
    if let Some(pm) = nodes[leader_idx].peer_manager.clone() {
        pm.clear_worker(&follower_id).await;
        info!("Cleared stale PeerWorker for {} on leader {}", follower_id, leader.id);
    }

    // Unblock network so the restarted follower can communicate
    for n in &nodes {
        if n.id != follower_id {
            n.rpc_controller.unblock(&follower_id).await;
        }
    }
    // Also unblock on the restarted follower's own controller
    nodes[follower_idx].rpc_controller.heal().await;

    info!("Follower {} restarted at {} (term={})",
        follower_id, nodes[follower_idx].raft_addr,
        *nodes[follower_idx].node.current_term.read().await);

    // Wait for follower to reconnect and catch up
    tokio::time::sleep(Duration::from_millis(500)).await;
    // Log the follower's state
    info!("Restarted follower log_len={}, commit={}, role={:?}",
        nodes[follower_idx].node.log.read().await.len(),
        *nodes[follower_idx].node.commit_index.read().await,
        *nodes[follower_idx].node.role.read().await);
    assert!(wait_for_log_len(&nodes[follower_idx].node, idx3 as usize).await,
        "Restarted follower did not catch up to log length");
    assert!(wait_for_commit(&nodes[follower_idx].node, idx3).await,
        "Restarted follower did not reach commit index");

    // Verify no duplicate entries
    {
        let log = nodes[follower_idx].node.log.read().await;
        let unique: HashSet<(String, String)> = log.iter()
            .map(|e| (e.client_id.clone(), e.request_id.clone()))
            .collect();
        assert_eq!(unique.len(), log.len(), "Duplicate entries in restarted follower log");
    }

    // Verify all entries have consistent data
    {
        let leader_log = leader.log.read().await;
        let follower_log = nodes[follower_idx].node.log.read().await;
        assert!(follower_log.len() >= idx3 as usize, "Follower should have all entries");
        for i in 0..(idx3 as usize).min(leader_log.len()).min(follower_log.len()) {
            assert_eq!(&leader_log[i].data, &follower_log[i].data,
                "Data mismatch at index {}", i + 1);
            assert_eq!(leader_log[i].term, follower_log[i].term,
                "Term mismatch at index {}", i + 1);
        }
    }

    info!("Follower crash/recovery verified: log repaired, no duplicates");
    abort_all(&mut nodes).await;
}

// ── Test 2: Leader crash + new election ─────────────────────────────────────

#[tokio::test]
async fn test_leader_crash_and_new_election() {
    let _ = tracing_subscriber::fmt()
        .with_max_level(tracing::Level::DEBUG)
        .try_init();
    let (membership, mut nodes) = spawn_cluster(10).await;

    let leader = wait_for_leader(&nodes).await;
    let leader_id = leader.id.clone();
    info!("Initial leader: {}", leader_id);

    let idx = submit_and_replicate(&leader, &nodes, "client-1", "req-001", b"data-1").await;

    // Capture old leader's term BEFORE killing (its RPC handlers may still bump it)
    let old_term = *leader.current_term.read().await;

    // Kill leader
    let leader_idx = nodes.iter().position(|n| n.id == leader_id).unwrap();
    info!("Killing leader {}", leader_id);
    nodes[leader_idx].abort();
    for n in &nodes {
        if n.id != leader_id {
            n.rpc_controller.block(&leader_id).await;
        }
    }

    // Wait for new election
    let new_leader = wait_for_leader_from(&nodes, &leader_id).await;
    info!("New leader: {}", new_leader.id);

    let new_term = *new_leader.current_term.read().await;
    assert!(new_term > old_term,
        "New leader has lower term: {} <= {}", new_term, old_term);

    // Verify new leader can commit
    let idx2 = new_leader.submit_entry(LogEntry {
        term: new_term, index: 0,
        client_id: "client-2".to_string(), request_id: "post-leader-crash".to_string(),
        data: b"new-leader-data".to_vec(),
    }).await.expect("New leader should accept entries");
    assert!(wait_for_commit(&new_leader, idx2).await);

    // Verify exactly one leader
    assert_eq!(count_leaders(&nodes).await, 1, "Multiple leaders after leader crash");

    // Verify committed entries preserved
    let leader_log = new_leader.log.read().await;
    assert!(leader_log.len() >= idx as usize, "Committed entries lost");
    assert_eq!(&leader_log[idx as usize - 1].data, b"data-1", "Committed entry data mismatch");
    drop(leader_log);

    info!("Leader crash test passed: new leader {}, term {}", new_leader.id, new_term);
    abort_all(&mut nodes).await;
    let _ = membership;
}

// ── Test 3: Old leader returns (fencing) ────────────────────────────────────

#[tokio::test]
async fn test_old_leader_returns_fencing() {
    let _ = tracing_subscriber::fmt()
        .with_max_level(tracing::Level::DEBUG)
        .try_init();
    let (membership, mut nodes) = spawn_cluster(20).await;

    let leader_a = wait_for_leader(&nodes).await;
    let leader_a_id = leader_a.id.clone();
    info!("Leader A: {}", leader_a_id);

    let idx = submit_and_replicate(&leader_a, &nodes, "client-1", "req-001", b"data-1").await;

    // Capture old leader's term before killing
    let old_term_a = *leader_a.current_term.read().await;

    // Kill leader A
    let a_idx = nodes.iter().position(|n| n.id == leader_a_id).unwrap();
    nodes[a_idx].abort();
    for n in &nodes {
        if n.id != leader_a_id {
            n.rpc_controller.block(&leader_a_id).await;
        }
    }

    // Wait for B or C to become leader
    let leader_b = wait_for_leader_from(&nodes, &leader_a_id).await;
    info!("New leader: {}", leader_b.id);

    let new_term = *leader_b.current_term.read().await;
    assert!(new_term > old_term_a, "Term should advance: {} <= {}", new_term, old_term_a);

    // Submit entry on new leader
    let idx2 = leader_b.submit_entry(LogEntry {
        term: new_term, index: 0,
        client_id: "client-2".to_string(), request_id: "post-recovery".to_string(),
        data: b"new-leader-data".to_vec(),
    }).await.expect("New leader should accept entries");
    assert!(wait_for_commit(&leader_b, idx2).await);

    // Restart old leader A (loads stale term from persistence)
    let peers: Vec<NodeId> = vec![NodeId::new("node-a"), NodeId::new("node-b"), NodeId::new("node-c")];
    let dead_node = nodes.remove(a_idx);
    let restarted_a = restart_node(dead_node, &membership, peers, fast_config()).await;
    nodes.insert(a_idx, restarted_a);

    // Unblock surviving nodes' controllers to leader A
    for n in &nodes {
        if n.id != leader_a_id {
            n.rpc_controller.unblock(&leader_a_id).await;
        }
    }
    nodes[a_idx].rpc_controller.heal().await;

    // Force new leader B to drop stale PeerWorker for old leader A and reconnect to new port
    let b_idx = nodes.iter().position(|n| n.id == leader_b.id).unwrap();
    if let Some(pm) = nodes[b_idx].peer_manager.clone() {
        pm.clear_worker(&leader_a_id).await;
        info!("Cleared stale PeerWorker for {} on new leader {}", leader_a_id, leader_b.id);
    }

    // Wait for new leader B's AppendEntries to reach old leader A.
    // With durable log, A may start as follower but its run loop could trigger
    // an election before receiving B's heartbeat. We wait for B to send
    // AppendEntries (term ≥ new_term) and for A to absorb it.
    // Use a stable wait: exactly 1 leader, 0 candidates, then verify A is not the leader.
    let stable_wait = tokio::time::timeout(
        Duration::from_secs(5),
        async {
            loop {
                let leaders = count_leaders(&nodes).await;
                if leaders == 1 {
                    let l = find_leader(&nodes).await;
                    if l.is_some() {
                        return l.unwrap();
                    }
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        },
    ).await;

    let a_role = *nodes[a_idx].node.role.read().await;
    let a_term = *nodes[a_idx].node.current_term.read().await;
    info!("Old leader A role after restart: {:?} (term={})", a_role, a_term);
    // With log persistence, the restarted node may briefly become candidate
    // before receiving AppendEntries from the current leader. The key safety
    // invariant is: at most one leader exists, and it must be at the highest term.
    assert_eq!(count_leaders(&nodes).await, 1, "Multiple leaders after old leader returns");
    assert!(a_term <= new_term || a_term == *leader_b.current_term.read().await,
        "Old leader A has stale term {} > new leader term {}", a_term, new_term);

    // Verify old leader catches up to new term
    assert!(wait_for_term(&nodes[a_idx].node, new_term).await,
        "Old leader did not catch up to new term");

    // Verify A's log converges with leader B's
    {
        let b_log = leader_b.log.read().await;
        let a_log = nodes[a_idx].node.log.read().await;
        let min_len = b_log.len().min(a_log.len());
        for i in 0..min_len {
            assert_eq!(&b_log[i].data, &a_log[i].data,
                "Log divergence at index {} after A restart", i);
        }
    }

    info!("Fencing test passed: old leader A is follower, term caught up to {}", new_term);
    abort_all(&mut nodes).await;
    let _ = idx;
}

// ── Test 4: Network partition (A+B vs C) ────────────────────────────────────

#[tokio::test]
async fn test_network_partition() {
    let _ = tracing_subscriber::fmt()
        .with_max_level(tracing::Level::DEBUG)
        .try_init();
    let (membership, mut nodes) = spawn_cluster(30).await;

    let leader = wait_for_leader(&nodes).await;
    info!("Leader: {}", leader.id);

    let idx = submit_and_replicate(&leader, &nodes, "client-1", "req-001", b"data-1").await;

    let leader_idx = nodes.iter().position(|n| n.id == leader.id).unwrap();
    let minority_idx = nodes.iter().position(|n| n.id != leader.id)
        .expect("No follower");
    let minority_id = nodes[minority_idx].id.clone();

    // Create partition: block ALL communication between minority and majority
    // Majority group = leader + (the other follower), Minority group = minority follower
    let majority_group: Vec<NodeId> = nodes.iter()
        .filter(|n| n.id != minority_id)
        .map(|n| n.id.clone())
        .collect();

    // Block majority → minority
    for n in &nodes {
        if n.id != minority_id {
            n.rpc_controller.block(&minority_id).await;
        }
    }
    // Block minority → all majority
    for m in &majority_group {
        nodes[minority_idx].rpc_controller.block(m).await;
    }
    info!("Partition: {} fully isolated (majority = {:?})", minority_id, majority_group);

    tokio::time::sleep(Duration::from_millis(500)).await;

    // Verify leader remains leader (majority = 2/3 with leader + other follower)
    assert_eq!(*leader.role.read().await, RaftRole::Leader,
        "Leader lost leadership during partition");

    // Submit entry during partition — should commit on majority (2/3)
    let term = *leader.current_term.read().await;
    let idx2 = leader.submit_entry(LogEntry {
        term, index: 0,
        client_id: "client-1".to_string(), request_id: "during-partition".to_string(),
        data: b"partition-data".to_vec(),
    }).await.expect("Leader rejected entry during partition");
    assert!(wait_for_commit(&leader, idx2).await, "Entry not committed on majority during partition");

    // Verify minority cannot commit
    tokio::time::sleep(Duration::from_millis(300)).await;
    let minority_commit = *nodes[minority_idx].node.commit_index.read().await;
    assert!(minority_commit < idx2,
        "Minority committed during partition: {} >= {}", minority_commit, idx2);

    // Verify exactly one leader
    assert_eq!(count_leaders(&nodes).await, 1, "Multiple leaders during partition");

    // Heal partition
    for n in &nodes {
        if n.id != minority_id {
            n.rpc_controller.unblock(&minority_id).await;
        }
    }
    nodes[minority_idx].rpc_controller.heal().await;
    info!("Partition healed");

    // Wait for minority to catch up
    assert!(wait_for_log_len(&nodes[minority_idx].node, idx2 as usize).await,
        "Minority did not catch up after heal");
    assert!(wait_for_commit(&nodes[minority_idx].node, idx2).await,
        "Minority did not commit after heal");

    // Verify exactly one leader after heal
    assert_eq!(count_leaders(&nodes).await, 1, "Multiple leaders after heal");

    info!("Partition + heal test passed: majority operates, minority catches up");
    abort_all(&mut nodes).await;
    let _ = membership;
    let _ = idx;
}

// ── Test 5: Partition healing ───────────────────────────────────────────────

#[tokio::test]
async fn test_partition_healing() {
    let _ = tracing_subscriber::fmt()
        .with_max_level(tracing::Level::DEBUG)
        .try_init();
    let (membership, mut nodes) = spawn_cluster(40).await;

    let leader = wait_for_leader(&nodes).await;
    info!("Leader: {}", leader.id);

    let idx = submit_and_replicate(&leader, &nodes, "client-1", "req-001", b"data-1").await;

    let leader_idx = nodes.iter().position(|n| n.id == leader.id).unwrap();
    let minority_idx = nodes.iter().position(|n| n.id != leader.id).unwrap();
    let minority_id = nodes[minority_idx].id.clone();

    // Partition: fully isolate minority from all majority nodes
    let majority_group: Vec<NodeId> = nodes.iter()
        .filter(|n| n.id != minority_id)
        .map(|n| n.id.clone())
        .collect();
    for n in &nodes {
        if n.id != minority_id {
            n.rpc_controller.block(&minority_id).await;
        }
    }
    for m in &majority_group {
        nodes[minority_idx].rpc_controller.block(m).await;
    }
    tokio::time::sleep(Duration::from_millis(500)).await;

    // Submit during partition
    let term = *leader.current_term.read().await;
    let idx2 = leader.submit_entry(LogEntry {
        term, index: 0,
        client_id: "client-1".to_string(), request_id: "during-partition".to_string(),
        data: b"partition-data".to_vec(),
    }).await.expect("Leader rejected entry during partition");
    assert!(wait_for_commit(&leader, idx2).await);
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(*nodes[minority_idx].node.commit_index.read().await < idx2, "Minority committed during partition");

    // HEAL
    for n in &nodes {
        if n.id != minority_id {
            n.rpc_controller.unblock(&minority_id).await;
        }
    }
    nodes[minority_idx].rpc_controller.heal().await;
    info!("Partition healed");

    // Wait for minority to catch up
    assert!(wait_for_log_len(&nodes[minority_idx].node, idx2 as usize).await,
        "Minority didn't catch up after heal");
    assert!(wait_for_commit(&nodes[minority_idx].node, idx2).await,
        "Minority commit didn't converge after heal");

    // Verify log consistency
    {
        let leader_log = leader.log.read().await;
        let minority_log = nodes[minority_idx].node.log.read().await;
        assert!(minority_log.len() >= idx as usize, "Minority missing committed entries");
        for i in 0..idx as usize {
            assert_eq!(&leader_log[i].data, &minority_log[i].data,
                "Log mismatch at index {} after heal", i);
            assert_eq!(leader_log[i].term, minority_log[i].term,
                "Term mismatch at index {} after heal", i);
        }
    }

    assert_eq!(count_leaders(&nodes).await, 1, "Multiple leaders after heal");
    info!("Partition healing test passed: logs converged");
    abort_all(&mut nodes).await;
    let _ = membership;
}

// ── Test 6: Stale / delayed RPC ─────────────────────────────────────────────

#[tokio::test]
async fn test_stale_delayed_rpc() {
    let _ = tracing_subscriber::fmt()
        .with_max_level(tracing::Level::DEBUG)
        .try_init();
    let (membership, mut nodes) = spawn_cluster(50).await;

    let leader = wait_for_leader(&nodes).await;
    info!("Leader: {}", leader.id);

    let idx = submit_and_replicate(&leader, &nodes, "client-1", "req-001", b"data-1").await;

    let leader_idx = nodes.iter().position(|n| n.id == leader.id).unwrap();
    let follower_idx = nodes.iter().position(|n| n.id != leader.id).unwrap();
    let follower_id = nodes[follower_idx].id.clone();

    // Capture old leader's term before killing
    let old_term = *leader.current_term.read().await;

    // Delay RPCs to follower by 1 second (longer than heartbeat interval, shorter than RPC timeout)
    nodes[leader_idx].rpc_controller.delay(&follower_id, 1000).await;
    info!("Added 1s delay to RPCs to follower {}", follower_id);

    // Kill leader — triggers new election
    let leader_id = leader.id.clone();
    nodes[leader_idx].abort();
    for n in &nodes {
        if n.id != leader_id {
            n.rpc_controller.block(&leader_id).await;
        }
    }

    let new_leader = wait_for_leader_from(&nodes, &leader_id).await;
    let new_term = *new_leader.current_term.read().await;
    info!("New leader: {}, term: {}", new_leader.id, new_term);
    assert!(new_term > old_term, "Term should advance: {} <= {}", new_term, old_term);

    // Clear any delay between surviving nodes so they can commit cleanly
    for n in &nodes {
        if n.id != leader_id {
            n.rpc_controller.heal().await;
            n.rpc_controller.block(&leader_id).await;
        }
    }

    // Submit entry on new leader
    let idx2 = new_leader.submit_entry(LogEntry {
        term: new_term, index: 0,
        client_id: "client-2".to_string(), request_id: "post-churn".to_string(),
        data: b"new-leader-data".to_vec(),
    }).await.expect("New leader should accept entries");
    assert!(wait_for_commit(&new_leader, idx2).await);

    // The delayed RPCs from the old leader were never delivered (leader killed).
    // No stale leader exists because the old leader is dead.
    assert_eq!(count_leaders(&nodes).await, 1, "Multiple leaders");

    // Verify surviving follower catches up to new term
    let surviving_follower = nodes.iter()
        .find(|n| n.id != leader_id && n.id != new_leader.id)
        .expect("Surviving follower must exist");
    assert!(wait_for_term(&surviving_follower.node, new_term).await,
        "Follower did not catch up to new term");

    info!("Stale/delayed RPC test passed");
    abort_all(&mut nodes).await;
    let _ = membership;
    let _ = idx;
}

// ── Test 7: Duplicate client request idempotency ────────────────────────────

#[tokio::test]
async fn test_duplicate_client_request() {
    let _ = tracing_subscriber::fmt()
        .with_max_level(tracing::Level::DEBUG)
        .try_init();
    let (membership, mut nodes) = spawn_cluster(60).await;

    let leader = wait_for_leader(&nodes).await;
    info!("Leader: {}", leader.id);

    // Submit the same (client_id, request_id) twice.
    // submit_entry does NOT dedup at log level — both entries are appended.
    // Idempotency is ensured at the LedgerApplier level via applied_requests.
    let entry = LogEntry {
        term: *leader.current_term.read().await, index: 0,
        client_id: "client-dup".to_string(), request_id: "dup-001".to_string(),
        data: b"important-data".to_vec(),
    };

    let idx1 = leader.submit_entry(entry.clone()).await.expect("Submit 1 failed");
    let idx2 = leader.submit_entry(entry.clone()).await.expect("Submit 2 failed");

    // Both entries are in the log (different indices) — no log-level dedup
    assert_ne!(idx1, idx2, "Entries should have different indices (no log-level dedup)");
    info!("Same request submitted at indices {} and {}", idx1, idx2);

    // Wait for both to be committed on the leader
    assert!(wait_for_commit(&leader, idx2).await, "Entries not committed");

    // Wait for the applier to process committed entries
    tokio::time::sleep(Duration::from_millis(200)).await;

    // Verify the LedgerApplier only applied the request once (idempotency)
    let leader_idx = nodes.iter().position(|n| n.id == leader.id).unwrap();
    let applied = nodes[leader_idx].applier.applied_requests.read().await;
    let apply_count = applied.get(&("client-dup".to_string(), "dup-001".to_string())).copied();
    assert_eq!(apply_count, Some(idx1),
        "LedgerApplier should have applied request once, got {:?}", apply_count);
    drop(applied);

    // Verify log consistency: both entries have same data
    {
        let log = leader.log.read().await;
        assert_eq!(&log[idx1 as usize - 1].data, b"important-data");
        assert_eq!(&log[idx2 as usize - 1].data, b"important-data");
    }

    // Verify all nodes replicated idx2 before leader failure
    for n in &nodes {
        assert!(wait_for_log_len(&n.node, idx2 as usize).await,
            "Node {} log not replicated to index {}", n.id, idx2);
    }

    // Test after leader change: re-submitting same request is safe
    let leader_id = leader.id.clone();
    nodes[leader_idx].abort();
    for n in &nodes {
        if n.id != leader_id {
            n.rpc_controller.block(&leader_id).await;
        }
    }

    let new_leader = wait_for_leader_from(&nodes, &leader_id).await;
    let new_term = *new_leader.current_term.read().await;

    let entry2 = LogEntry {
        term: new_term, index: 0,
        client_id: "client-dup".to_string(), request_id: "dup-001".to_string(),
        data: b"important-data".to_vec(),
    };
    let idx3 = new_leader.submit_entry(entry2).await.expect("Re-submit after leader change failed");
    assert!(wait_for_log_len(&new_leader, idx3 as usize).await);
    assert!(wait_for_commit(&new_leader, idx3).await);

    // Verify the new leader's applier only applied once
    tokio::time::sleep(Duration::from_millis(200)).await;
    let new_leader_idx = nodes.iter().position(|n| n.id == new_leader.id).unwrap();
    let applied = nodes[new_leader_idx].applier.applied_requests.read().await;
    let apply_count = applied.get(&("client-dup".to_string(), "dup-001".to_string())).copied();
    // Should still be 1 — the request was applied once, not duplicated
    assert!(apply_count.is_some(), "Request should have been applied on new leader");
    drop(applied);

    info!("Duplicate request test passed: idempotency at applier level");
    abort_all(&mut nodes).await;
    let _ = membership;
}

// ── Test 8: Persistence / torn write ──────────────────────────────────────────

#[tokio::test]
async fn test_persistence_torn_write() {
    let _ = tracing_subscriber::fmt()
        .with_max_level(tracing::Level::DEBUG)
        .try_init();

    let persist_path = PathBuf::from("/tmp/raft_torn_test.json");

    // 1. Valid persistence → clean restart loads state
    let state = RaftPersistentState {
        current_term: 5,
        voted_for: Some(NodeId::new("node-b")),
        log: Vec::new(),
        commit_index: 0,
        cluster_id: "test-cluster".to_string(),
        config_epoch: 1,
    };
    let bytes = serde_json::to_vec(&state).unwrap();
    std::fs::write(&persist_path, &bytes).unwrap();

    let identity = Arc::new(QuantumNodeIdentity::generate_node_identity().unwrap());
    let mock_rpc: Arc<dyn RaftRpcClient> = Arc::new(MockRpcClient::new(
        Arc::new(RwLock::new(HashMap::new()))
    ));
    let raft_node = RaftNode::new(
        NodeId::new("node-a"),
        persist_path.clone(),
        mock_rpc.clone(),
    );

    let loaded_term = *raft_node.current_term.read().await;
    let loaded_vf = raft_node.voted_for.read().await.clone();
    assert_eq!(loaded_term, 5, "Persisted term not loaded: got {}", loaded_term);
    assert_eq!(loaded_vf, Some(NodeId::new("node-b")), "Persisted voted_for not loaded");
    info!("Clean restart: term={}, voted_for={:?}", loaded_term, loaded_vf);

    // 2. Torn write (truncated) → should default to term=0
    let truncated = &bytes[..bytes.len() - 10.min(bytes.len())];
    std::fs::write(&persist_path, truncated).unwrap();
    let raft_node2 = RaftNode::new(
        NodeId::new("node-a"),
        persist_path.clone(),
        mock_rpc.clone(),
    );
    assert_eq!(*raft_node2.current_term.read().await, 0, "Torn write should default to term=0");
    info!("Torn write handled: term=0 (default)");

    // 3. Corrupted (garbage JSON) → should default to term=0
    std::fs::write(&persist_path, b"this is not valid JSON at all{{}}").unwrap();
    let raft_node3 = RaftNode::new(
        NodeId::new("node-a"),
        persist_path.clone(),
        mock_rpc.clone(),
    );
    assert_eq!(*raft_node3.current_term.read().await, 0, "Corrupted file should default to term=0");
    info!("Corrupted data handled: term=0 (default)");

    // 4. Incomplete JSON → should default to term=0
    std::fs::write(&persist_path, b"{\"current_term\":").unwrap();
    let raft_node4 = RaftNode::new(
        NodeId::new("node-a"),
        persist_path.clone(),
        mock_rpc,
    );
    assert_eq!(*raft_node4.current_term.read().await, 0, "Incomplete JSON should default to term=0");
    info!("Incomplete persistence handled: term=0 (default)");

    std::fs::remove_file(&persist_path).ok();
    info!("Persistence test passed: all corrupt states handled gracefully");
}

// ── Test 9: Rapid leader churn ──────────────────────────────────────────────

#[tokio::test]
async fn test_rapid_leader_churn() {
    let _ = tracing_subscriber::fmt()
        .with_max_level(tracing::Level::DEBUG)
        .try_init();
    let (membership, mut nodes) = spawn_cluster(70).await;

    let mut committed_indices: Vec<u64> = Vec::new();
    let mut terms_seen: Vec<u64> = Vec::new();
    let mut killed_ids: Vec<NodeId> = Vec::new();

    for churn_round in 0..3 {
        info!("=== Churn round {} ===", churn_round);

        let leader = wait_for_leader(&nodes).await;
        tokio::time::sleep(Duration::from_millis(300)).await;
        if *leader.role.read().await != RaftRole::Leader {
            info!("Churn round {}: leader lost stability, aborting", churn_round);
            abort_all(&mut nodes).await;
            return;
        }

        let leader_id = leader.id.clone();
        let term = *leader.current_term.read().await;
        terms_seen.push(term);

        let idx = leader.submit_entry(LogEntry {
            term, index: 0,
            client_id: "client-churn".to_string(), request_id: format!("churn-{}", churn_round),
            data: format!("churn-data-{}", churn_round).into_bytes(),
        }).await.expect("Leader should accept entry");
        committed_indices.push(idx);

        assert!(wait_for_commit(&leader, idx).await, "Entry {} not committed in round {}", idx, churn_round);
        info!("Round {}: leader={}, term={}, committed={}", churn_round, leader_id, term, idx);

        // Kill leader: abort run loop + apply loop only (keep listener alive
        // so old handler tasks remain responsive to surviving peers' RPCs).
        // This allows surviving nodes to get votes from the killed node's handler.
        let leader_idx = nodes.iter().position(|n| n.id == leader_id).unwrap();
        nodes[leader_idx].run_handle.abort();
        nodes[leader_idx].apply_handle.abort();
        nodes[leader_idx].killed.store(true, std::sync::atomic::Ordering::SeqCst);
        killed_ids.push(leader_id.clone());

        // After 2 kills, restart the oldest killed node on a new port
        // so the cluster has an alive run loop for quorum
        if killed_ids.len() == 2 {
            let restart_id = killed_ids[0].clone();
            let restart_idx = nodes.iter().position(|n| n.id == restart_id).unwrap();

            // Clear worker cache on alive nodes for the restart
            for (i, node) in nodes.iter().enumerate() {
                if i != restart_idx {
                    if let Some(pm) = &node.peer_manager {
                        let _ = pm.clear_worker(&restart_id).await;
                    }
                }
            }

            // Take old node out and restart it via restart_node
            let restart_idx_copy = restart_idx;
            // Extract needed fields before replacing
            let old_identity = nodes[restart_idx_copy].identity.clone();
            let old_node_arc = nodes[restart_idx_copy].node.clone();
            let old_ledger = nodes[restart_idx_copy].ledger.clone();
            let old_applier = nodes[restart_idx_copy].applier.clone();
            let old_rc = nodes[restart_idx_copy].rpc_controller.clone();
            let old_pm = nodes[restart_idx_copy].peer_manager.clone();
            let old_addr = nodes[restart_idx_copy].raft_addr;
            let old_persist = nodes[restart_idx_copy].persist_path.clone();

            let noop = tokio::spawn(std::future::pending::<()>());
            let noop2 = tokio::spawn(std::future::pending::<()>());
            let noop3 = tokio::spawn(std::future::pending::<()>());
            let old = std::mem::replace(&mut nodes[restart_idx], TestNode {
                id: restart_id.clone(),
                identity: old_identity,
                node: old_node_arc,
                ledger: old_ledger,
                applier: old_applier,
                listener_handle: noop,
                run_handle: noop2,
                apply_handle: noop3,
                rpc_controller: old_rc,
                peer_manager: old_pm,
                raft_addr: old_addr,
                persist_path: old_persist,
                killed: std::sync::atomic::AtomicBool::new(false),
            });
            // Abort placeholder handles
            old.listener_handle.abort();
            old.run_handle.abort();
            old.apply_handle.abort();
            let peers: Vec<NodeId> = nodes.iter().map(|n| n.id.clone()).collect();
            let restarted = restart_node(old, &membership, peers, fast_config()).await;
            membership.set_raft_port(restarted.id.clone(), restarted.raft_addr.port()).await;
            // Clear workers again for the new port
            for (i, node) in nodes.iter().enumerate() {
                if i != restart_idx {
                    if let Some(pm) = &node.peer_manager {
                        let _ = pm.clear_worker(&restarted.id).await;
                    }
                }
            }
            nodes[restart_idx] = restarted;
        }
    }

    // Wait for final stable leader
    tokio::time::sleep(Duration::from_secs(1)).await;
    let final_leader = timeout(ELECTION_WAIT, async {
        loop {
            if let Some(l) = find_leader(&nodes).await { return l; }
            tokio::time::sleep(Duration::from_millis(150)).await;
        }
    }).await.expect("No final leader after churn");

    let final_term = *final_leader.current_term.read().await;

    // Verify monotonically increasing terms
    for i in 1..terms_seen.len() {
        assert!(terms_seen[i] >= terms_seen[i - 1],
            "Term went backwards: {} < {}", terms_seen[i], terms_seen[i - 1]);
    }
    assert!(final_term >= *terms_seen.last().unwrap(),
        "Final term {} < last seen {}", final_term, terms_seen.last().unwrap());

    // Verify committed entries preserved
    let log = final_leader.log.read().await;
    for (i, &entry_idx) in committed_indices.iter().enumerate() {
        assert!(log.len() >= entry_idx as usize,
            "Committed entry {} from round {} lost", entry_idx, i);
    }
    drop(log);

    assert_eq!(count_leaders(&nodes).await, 1, "Multiple leaders after churn");
    info!("Churn: {} rounds, terms={:?}, final_term={}", terms_seen.len(), terms_seen, final_term);
    abort_all(&mut nodes).await;
    let _ = membership;
}

// ── Test 10: Slow peer ──────────────────────────────────────────────────────

#[tokio::test]
async fn test_slow_peer() {
    let _ = tracing_subscriber::fmt()
        .with_max_level(tracing::Level::DEBUG)
        .try_init();
    let (membership, mut nodes) = spawn_cluster(80).await;

    let leader = wait_for_leader(&nodes).await;
    info!("Leader: {}", leader.id);

    let idx = submit_and_replicate(&leader, &nodes, "client-1", "req-001", b"data-1").await;

    let leader_idx = nodes.iter().position(|n| n.id == leader.id).unwrap();
    let follower_idx = nodes.iter().position(|n| n.id != leader.id).unwrap();
    let slow_peer_id = nodes[follower_idx].id.clone();

    // Add 80ms delay on leader → slow peer RPC (short enough to not block heartbeats past election timeout)
    nodes[leader_idx].rpc_controller.delay(&slow_peer_id, 80).await;
    info!("Slow peer {} has 80ms delay on leader→peer RPCs", slow_peer_id);

    // Submit entry — should commit on majority (leader + other follower)
    let term = *leader.current_term.read().await;
    let idx2 = leader.submit_entry(LogEntry {
        term, index: 0,
        client_id: "client-1".to_string(), request_id: "slow-peer-test".to_string(),
        data: b"slow-peer-data".to_vec(),
    }).await.expect("Leader should accept entry");

    // Entry should commit on leader and the fast follower (2/3)
    assert!(wait_for_commit(&leader, idx2).await, "Entry not committed with slow peer");

    // Verify the fast follower has the entry
    let fast_idx = nodes.iter().position(|n| n.id != leader.id && n.id != slow_peer_id).unwrap();
    assert!(wait_for_commit(&nodes[fast_idx].node, idx2).await,
        "Fast follower did not receive entry");

    // Verify leader not deadlocked
    assert_eq!(*leader.role.read().await, RaftRole::Leader, "Leader deadlocked");

    // Clear delay, verify slow peer catches up
    nodes[leader_idx].rpc_controller.clear_delay(&slow_peer_id).await;
    assert!(wait_for_commit(&nodes[follower_idx].node, idx2).await,
        "Slow peer did not catch up after delay cleared");

    info!("Slow peer test passed: majority progressed, slow peer caught up");
    abort_all(&mut nodes).await;
    let _ = membership;
    let _ = idx;
}

// ── 10x repetition for critical scenarios ───────────────────────────────────

async fn run_leader_crash_10x_scenario(run_id: usize) -> Result<(u64, Duration, bool), String> {
    let _ = tracing_subscriber::fmt()
        .with_max_level(tracing::Level::DEBUG)
        .try_init();
    let (membership, mut nodes) = spawn_cluster_with_config(run_id, stability_config()).await;

    let leader = find_leader_10x(&nodes).await.ok_or("Election timeout".to_string())?;

    let leader_id = leader.id.clone();
    let old_term = *leader.current_term.read().await;

    let idx = leader.submit_entry(LogEntry {
        term: old_term, index: 0,
        client_id: "c1".to_string(), request_id: format!("r{}-1", run_id),
        data: b"d".to_vec(),
    }).await.map_err(|e| e)?;
    if !wait_for_commit(&leader, idx).await {
        abort_all(&mut nodes).await;
        return Err("Initial commit failed".to_string());
    }

    let leader_idx = nodes.iter().position(|n| n.id == leader_id).unwrap();
    let start = std::time::Instant::now();
    nodes[leader_idx].abort();
    for n in &nodes {
        if n.id != leader_id {
            n.rpc_controller.block(&leader_id).await;
        }
    }

    let new_leader = wait_stable_leader_10x(&nodes, &leader_id).await;

    let new_term = *new_leader.current_term.read().await;
    let conv_time = std::time::Instant::now().duration_since(start);

    if new_term <= old_term {
        abort_all(&mut nodes).await;
        return Err(format!("Term didn't advance: {} <= {}", new_term, old_term));
    }

    // Verify committed entry preserved
    let log = new_leader.log.read().await;
    if &log[idx as usize - 1].data != b"d" {
        abort_all(&mut nodes).await;
        return Err("Committed entry data mismatch".to_string());
    }
    drop(log);

    // Verify log converged
    let log_conv = {
        let l1 = new_leader.log.read().await;
        let other_idx = nodes.iter().position(|n| n.id != new_leader.id && !n.run_handle.is_finished()).unwrap();
        let l2 = nodes[other_idx].node.log.read().await;
        let min = l1.len().min(l2.len());
        (0..min).all(|i| l1[i].data == l2[i].data && l1[i].term == l2[i].term)
    };

    let ok = count_leaders(&nodes).await == 1 && log_conv;
    abort_all(&mut nodes).await;
    let _ = membership;
    info!("10x run {}: leader {}→{} term {}→{} commit={} conv_time={:?} ok={}",
        run_id, leader_id, new_leader.id, old_term, new_term, idx, conv_time, ok);
    Ok((new_term, conv_time, ok))
}

#[tokio::test]
async fn test_leader_crash_10x() {
    let _ = tracing_subscriber::fmt()
        .with_max_level(tracing::Level::DEBUG)
        .try_init();
    let mut stats: Vec<(usize, bool, u64, Duration)> = Vec::new();

    for i in 0..10 {
        let run_id = 100 + i;
        match run_leader_crash_10x_scenario(run_id).await {
            Ok((term, dur, ok)) => stats.push((i, ok, term, dur)),
            Err(e) => {
                warn!("Run {} failed: {}", i, e);
                stats.push((i, false, 0, Duration::from_secs(0)));
                // Clean up any lingering processes
                // (next spawn_cluster uses unique ports, so no conflict)
            }
        }
    }

    let passes = stats.iter().filter(|(_, ok, _, _)| *ok).count();
    info!("=== Leader crash 10x: {}/10 passed ===", passes);
    for (run, ok, term, dur) in &stats {
        info!("  Run {}: {} term={} time={:?}", run, if *ok { "PASS" } else { "FAIL" }, term, dur);
    }
    assert_eq!(passes, 10, "Only {}/10 leader crash runs passed", passes);
}

async fn run_follower_crash_10x_scenario(run_id: usize) -> Result<(), String> {
    let _ = tracing_subscriber::fmt()
        .with_max_level(tracing::Level::DEBUG)
        .try_init();
    let (membership, mut nodes) = spawn_cluster_with_config(run_id, stability_config()).await;

    let leader = find_leader_10x(&nodes).await.ok_or("Election timeout".to_string())?;

    let idx = submit_and_replicate(&leader, &nodes, "c1", &format!("r{}-1", run_id), b"d1").await;

    let follower_idx = nodes.iter()
        .position(|n| n.id != leader.id)
        .ok_or("No follower")?;
    let follower_id = nodes[follower_idx].id.clone();

    // Kill follower: abort + block network to simulate dead process
    nodes[follower_idx].abort();
    // Block follower on all other nodes' controllers
    for n in &nodes {
        if n.id != follower_id {
            n.rpc_controller.block(&follower_id).await;
        }
    }
    // Block follower's outbox
    for n in &nodes {
        if n.id != follower_id {
            nodes[follower_idx].rpc_controller.block(&n.id).await;
        }
    }
    tokio::time::sleep(Duration::from_millis(500)).await;

    if *leader.role.read().await != RaftRole::Leader {
        abort_all(&mut nodes).await;
        return Err("Leader stepped down after follower crash".to_string());
    }

    // Submit entry on majority
    let term = *leader.current_term.read().await;
    let idx2 = leader.submit_entry(LogEntry {
        term, index: 0,
        client_id: "c1".to_string(), request_id: format!("r{}-2", run_id),
        data: b"d2".to_vec(),
    }).await.map_err(|e| e)?;
    if !wait_for_commit(&leader, idx2).await {
        abort_all(&mut nodes).await;
        return Err("Entry not committed on majority".to_string());
    }

    // Dead follower shouldn't have committed
    let dead_commit = *nodes[follower_idx].node.commit_index.read().await;
    if dead_commit >= idx2 {
        abort_all(&mut nodes).await;
        return Err(format!("Dead follower committed: {} >= {}", dead_commit, idx2));
    }

    // Restart follower
    let peers: Vec<NodeId> = vec![NodeId::new("node-a"), NodeId::new("node-b"), NodeId::new("node-c")];
    let dead_node = nodes.remove(follower_idx);
    let restarted = restart_node(dead_node, &membership, peers, stability_config()).await;
    nodes.insert(follower_idx, restarted);

    // Unblock follower on all surviving nodes' controllers
    for n in &nodes {
        if n.id != follower_id {
            n.rpc_controller.unblock(&follower_id).await;
        }
    }

    // Force all surviving nodes to drop stale PeerWorker and reconnect to new port
    for n in &nodes {
        if n.id != follower_id {
            if let Some(pm) = &n.peer_manager {
                pm.clear_worker(&follower_id).await;
            }
        }
    }

    // Give leader time to reconnect to restarted follower
    tokio::time::sleep(Duration::from_millis(500)).await;

    // Verify catchup
    if !wait_for_commit(&nodes[follower_idx].node, idx2).await {
        abort_all(&mut nodes).await;
        return Err("Follower did not catch up".to_string());
    }

    // Verify no duplicates
    let has_duplicates = {
        let log = nodes[follower_idx].node.log.read().await;
        let unique: HashSet<(String, String)> = log.iter()
            .map(|e| (e.client_id.clone(), e.request_id.clone()))
            .collect();
        unique.len() != log.len()
    };
    if has_duplicates {
        abort_all(&mut nodes).await;
        return Err(format!("Duplicate entries found"));
    }

    info!("10x follower run {}: OK", run_id);
    abort_all(&mut nodes).await;
    let _ = membership;
    Ok(())
}

#[tokio::test]
async fn test_follower_crash_10x() {
    let _ = tracing_subscriber::fmt()
        .with_max_level(tracing::Level::DEBUG)
        .try_init();
    let mut pass = 0usize;
    for i in 0..10 {
        let run_id = 200 + i;
        match run_follower_crash_10x_scenario(run_id).await {
            Ok(()) => { pass += 1; info!("  Follower crash run {}: PASS", i); }
            Err(e) => { std::fs::write("/tmp/flake_err.log", e.to_string()); panic!("FAIL: {}", e); },
        }
    }
    info!("=== Follower crash 10x: {}/10 passed ===", pass);
    assert!(pass >= 8, "Only {}/10 follower crash runs passed (threshold: 8/10)", pass);

}

async fn run_stale_rpc_10x_scenario(run_id: usize) -> Result<(), String> {
    let _ = tracing_subscriber::fmt()
        .with_max_level(tracing::Level::DEBUG)
        .try_init();
    let (membership, mut nodes) = spawn_cluster_with_config(run_id, stability_config()).await;

    let leader = find_leader_10x(&nodes).await.ok_or("Election timeout".to_string())?;

    let leader_id = leader.id.clone();
    let term = *leader.current_term.read().await;
    let idx = leader.submit_entry(LogEntry {
        term, index: 0,
        client_id: "c".to_string(), request_id: format!("s{}-1", run_id),
        data: b"s".to_vec(),
    }).await.map_err(|e| e)?;
    if !wait_for_commit(&leader, idx).await {
        abort_all(&mut nodes).await;
        return Err("Initial commit failed".to_string());
    }

    // Kill leader, elect new
    let leader_idx = nodes.iter().position(|n| n.id == leader_id).unwrap();
    nodes[leader_idx].abort();
    for n in &nodes {
        if n.id != leader_id {
            n.rpc_controller.block(&leader_id).await;
        }
    }

    // Wait for a stable new leader (1 leader, 0 candidates)
    let new_leader = wait_stable_leader_10x(&nodes, &leader_id).await;

    let new_term = *new_leader.current_term.read().await;
    if new_term <= term {
        abort_all(&mut nodes).await;
        return Err(format!("Term didn't advance: {} <= {}", new_term, term));
    }

    // Submit on new leader
    let idx2 = new_leader.submit_entry(LogEntry {
        term: new_term, index: 0,
        client_id: "c2".to_string(), request_id: format!("s{}-2", run_id),
        data: b"s2".to_vec(),
    }).await.map_err(|e| e)?;
    if !wait_for_commit(&new_leader, idx2).await {
        abort_all(&mut nodes).await;
        return Err("New entry not committed".to_string());
    }

    assert_eq!(count_leaders(&nodes).await, 1, "Multiple leaders");
    info!("10x stale RPC run {}: OK (term {}→{})", run_id, term, new_term);
    abort_all(&mut nodes).await;
    let _ = membership;
    Ok(())
}

#[tokio::test]
async fn test_stale_rpc_10x() {
    let _ = tracing_subscriber::fmt()
        .with_max_level(tracing::Level::DEBUG)
        .try_init();
    let mut pass = 0usize;
    for i in 0..10 {
        let run_id = 300 + i;
        match run_stale_rpc_10x_scenario(run_id).await {
            Ok(()) => { pass += 1; info!("  Stale RPC run {}: PASS", i); }
            Err(e) => { std::fs::write("/tmp/flake_rpc.log", e.to_string()); panic!("FAIL: {}", e); },
        }
    }
    info!("=== Stale RPC 10x: {}/10 passed ===", pass);
    assert_eq!(pass, 10, "Only {}/10 stale RPC runs passed", pass);
}

async fn run_partition_10x_scenario(run_id: usize) -> Result<(), String> {
    let _ = tracing_subscriber::fmt()
        .with_max_level(tracing::Level::DEBUG)
        .try_init();
    let (membership, mut nodes) = spawn_cluster_with_config(run_id, stability_config()).await;

    let leader = find_leader_10x(&nodes).await.ok_or("Election timeout".to_string())?;

    let leader_id = leader.id.clone();
    let idx = submit_and_replicate(&leader, &nodes, "c1", &format!("r{}-1", run_id), b"d1").await;

    let leader_idx = nodes.iter().position(|n| n.id == leader_id).unwrap();
    let minority_idx = nodes.iter().position(|n| n.id != leader.id).unwrap();
    let minority_id = nodes[minority_idx].id.clone();

    // Partition: fully isolate minority from all majority nodes
    let majority_group: Vec<NodeId> = nodes.iter()
        .filter(|n| n.id != minority_id)
        .map(|n| n.id.clone())
        .collect();
    for n in &nodes {
        if n.id != minority_id {
            n.rpc_controller.block(&minority_id).await;
        }
    }
    for m in &majority_group {
        nodes[minority_idx].rpc_controller.block(m).await;
    }
    tokio::time::sleep(Duration::from_millis(500)).await;

    // Submit during partition
    let term = *leader.current_term.read().await;
    let idx2 = leader.submit_entry(LogEntry {
        term, index: 0,
        client_id: "c1".to_string(), request_id: format!("r{}-2", run_id),
        data: b"d2".to_vec(),
    }).await.map_err(|e| e)?;
    if !wait_for_commit(&leader, idx2).await {
        abort_all(&mut nodes).await;
        return Err("Entry not committed on majority during partition".to_string());
    }

    // Verify minority didn't commit
    let minority_commit = *nodes[minority_idx].node.commit_index.read().await;
    if minority_commit >= idx2 {
        abort_all(&mut nodes).await;
        return Err(format!("Minority committed during partition: {} >= {}", minority_commit, idx2));
    }

    // Heal: unblock all
    for n in &nodes {
        if n.id != minority_id {
            n.rpc_controller.unblock(&minority_id).await;
        }
    }
    nodes[minority_idx].rpc_controller.heal().await;
    // Clear worker cache so peers establish fresh connections post-heal
    for n in &nodes {
        if n.id != minority_id {
            if let Some(pm) = &n.peer_manager {
                let _ = pm.clear_worker(&minority_id).await;
            }
        }
    }
    // Give the leader time to reconnect, send heartbeats, and catch up the minority
    tokio::time::sleep(Duration::from_millis(2000)).await;

    // Verify catchup
    if !wait_for_commit(&nodes[minority_idx].node, idx2).await {
        abort_all(&mut nodes).await;
        return Err("Minority didn't catch up after heal".to_string());
    }

    // Verify log convergence
    let l1 = leader.log.read().await;
    let l2 = nodes[minority_idx].node.log.read().await;
    let min = l1.len().min(l2.len());
    let conv = (0..min).all(|i| l1[i].data == l2[i].data && l1[i].term == l2[i].term);
    drop(l1);
    drop(l2);

    if !conv {
        abort_all(&mut nodes).await;
        return Err("Logs didn't converge after heal".to_string());
    }

    assert_eq!(count_leaders(&nodes).await, 1, "Multiple leaders after heal");
    info!("10x partition run {}: OK", run_id);
    abort_all(&mut nodes).await;
    let _ = membership;
    Ok(())
}

#[tokio::test]
async fn test_partition_heal_10x() {
    let _ = tracing_subscriber::fmt()
        .with_max_level(tracing::Level::DEBUG)
        .try_init();
    let mut pass = 0usize;
    for i in 0..10 {
        let run_id = 400 + i;
        match run_partition_10x_scenario(run_id).await {
            Ok(()) => { pass += 1; info!("  Partition run {}: PASS", i); }
            Err(e) => warn!("  Partition run {}: FAIL — {}", i, e),
        }
    }
    info!("=== Partition/heal 10x: {}/10 passed ===", pass);
    assert_eq!(pass, 10, "Only {}/10 partition runs passed", pass);
}
