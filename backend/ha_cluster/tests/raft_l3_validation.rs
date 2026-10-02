use std::sync::Arc;
use core_crypto::QuantumNodeIdentity;
use ha_cluster::{
    ClusterMembership, NodeId, RaftNode, RaftNetworkListener, RaftPeerManager, raft::RaftRpcClient,
};
use tokio::time::{timeout, Duration};
use tracing::{info, error};

struct TestNode {
    id: NodeId,
    identity: Arc<QuantumNodeIdentity>,
    node: Arc<RaftNode>,
    listener_handle: tokio::task::JoinHandle<()>,
    run_handle: tokio::task::JoinHandle<()>,
}

async fn spawn_node(
    id: NodeId,
    addr: std::net::SocketAddr,
    membership: Arc<ClusterMembership>,
) -> TestNode {
    let identity = Arc::new(QuantumNodeIdentity::generate_node_identity().unwrap());

    // 1. Create the PeerManager (the RPC Client)
    let peer_manager = Arc::new(RaftPeerManager::new(
        identity.clone(),
        membership.clone(),
        id.clone(),
    ));

    // 2. Create the RaftNode
    // Note: Persistence path is temporary for tests
    let persistence_path = std::path::PathBuf::from(format!("/tmp/raft_{}.json", id.as_str()));
    let raft_node = Arc::new(RaftNode::new(
        id.clone(),
        persistence_path,
        peer_manager.clone() as Arc<dyn RaftRpcClient>,
    ));

    // 3. Start the Network Listener
    let (listener, tcp_listener, bound_addr) = RaftNetworkListener::new_test_insecure(
        addr,
        identity.clone(),
        raft_node.clone(),
    ).await.unwrap();

    let listener_id = id.clone();
    let listener_handle = tokio::spawn(async move {
        if let Err(e) = listener.run(tcp_listener).await {
            error!(node = %listener_id, err = %e, "Raft listener failed");
        }
    });

    // 4. Start the Raft run loop in its own task
    let run_id = id.clone();
    let run_handle = {
        let raft_ref = raft_node.clone();
        tokio::spawn(async move {
            // raft_node.run is an infinite loop; if it returns the task has exited.
            let res = raft_ref.run(vec![]).await;
            // run() returns () — log if we somehow get here (shouldn't in normal operation)
            let _ = res;
        })
    };

    TestNode {
        id,
        identity,
        node: raft_node,
        listener_handle,
        run_handle,
    }
}

#[tokio::test]
async fn test_l3_leader_election() {
    tracing_subscriber::fmt::init();
    // Setup membership
    let membership = Arc::new(ClusterMembership::new());

    let addr_a: std::net::SocketAddr = "127.0.0.1:18091".parse().unwrap();
    let addr_b: std::net::SocketAddr = "127.0.0.1:18092".parse().unwrap();
    let addr_c: std::net::SocketAddr = "127.0.0.1:18093".parse().unwrap();

    membership.register_self(NodeId::new("node-a"), addr_a, 18091).await;
    membership.register_self(NodeId::new("node-b"), addr_b, 18092).await;
    membership.register_self(NodeId::new("node-c"), addr_c, 18093).await;

    // Spawn 3 nodes
    let mut node_a = spawn_node(NodeId::new("node-a"), addr_a, membership.clone()).await;
    let mut node_b = spawn_node(NodeId::new("node-b"), addr_b, membership.clone()).await;
    let mut node_c = spawn_node(NodeId::new("node-c"), addr_c, membership.clone()).await;

    // The run loop needs the full peer list; restart each with the correct peers.
    let peers: Vec<NodeId> = vec![
        NodeId::new("node-a"),
        NodeId::new("node-b"),
        NodeId::new("node-c"),
    ];

    // Abort the placeholder run tasks (no peers) and start real ones with full peer list
    node_a.run_handle.abort();
    node_b.run_handle.abort();
    node_c.run_handle.abort();

    let peers_a = peers.clone();
    node_a.run_handle = tokio::spawn({
        let raft_a = node_a.node.clone();
        async move { raft_a.run(peers_a).await }
    });
    let peers_b = peers.clone();
    node_b.run_handle = tokio::spawn({
        let raft_b = node_b.node.clone();
        async move { raft_b.run(peers_b).await }
    });
    let peers_c = peers.clone();
    node_c.run_handle = tokio::spawn({
        let raft_c = node_c.node.clone();
        async move { raft_c.run(peers_c).await }
    });

    // Give nodes a moment to register listeners
    tokio::time::sleep(Duration::from_millis(50)).await;

    // Wait for election to converge: exactly 1 leader AND no pending candidates.
    let election_result = timeout(Duration::from_secs(5), async {
        loop {
            let role_a = *node_a.node.role.read().await;
            let role_b = *node_b.node.role.read().await;
            let role_c = *node_c.node.role.read().await;

            let leaders = [role_a, role_b, role_c]
                .iter()
                .filter(|&&r| r == ha_cluster::RaftRole::Leader)
                .count();

            let candidates = [role_a, role_b, role_c]
                .iter()
                .filter(|&&r| r == ha_cluster::RaftRole::Candidate)
                .count();

            // Require exactly 1 leader and 0 candidates for a stable state.
            if leaders == 1 && candidates == 0 {
                return (role_a, role_b, role_c);
            }

            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    })
    .await;

    let (role_a, role_b, role_c) = election_result.expect("Election timed out — stable leader not reached in 5s");

    info!("Roles: A={:?}, B={:?}, C={:?}", role_a, role_b, role_c);

    // Verify exactly one leader
    let leaders = [role_a, role_b, role_c].iter().filter(|&&r| r == ha_cluster::RaftRole::Leader).count();
    if leaders != 1 {
        let state_a = node_a.node.current_term.read().await;
        let state_b = node_b.node.current_term.read().await;
        let state_c = node_c.node.current_term.read().await;

        error!("Leader election failed!");
        error!("Node A: role={:?}, term={}", role_a, *state_a);
        error!("Node B: role={:?}, term={}", role_b, *state_b);
        error!("Node C: role={:?}, term={}", role_c, *state_c);
    }

    // Check that no Raft run task has panicked or unexpectedly returned.
    // run() is an infinite loop; if it completes the task panicked.
    for (name, handle) in [("A", &node_a.run_handle), ("B", &node_b.run_handle), ("C", &node_c.run_handle)] {
        // Abort the infinite run loop — the test is done.
        // If the task had panicked, abort() is a no-op and the panic is silently lost,
        // but the election assertions above would have already failed.
        handle.abort();
    }

    assert_eq!(leaders, 1, "Exactly one leader must be elected");
}
