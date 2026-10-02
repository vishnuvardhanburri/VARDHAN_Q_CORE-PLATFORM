use core_crypto::QuantumNodeIdentity;
use ha_cluster::{ClusterMembership, NodeId, RaftPeerManager};
use proxy_engine::run_responder;
use std::sync::Arc;
use tokio::net::{TcpListener, TcpStream};
use tokio::time::{timeout, Duration};

async fn setup_peer(identity: Arc<QuantumNodeIdentity>, addr: std::net::SocketAddr) {
    let listener = TcpListener::bind(addr).await.unwrap();
    tokio::spawn(async move {
        loop {
            if let Ok((mut stream, _)) = listener.accept().await {
                let session = run_responder(&mut stream, &identity).await.unwrap();
                // Just keep the connection open to simulate a peer
                let _ = tokio::io::copy(&mut stream, &mut tokio::io::sink()).await;
            }
        }
    });
}

#[tokio::test]
async fn test_authenticated_peer_connection() {
    let identity_a = Arc::new(QuantumNodeIdentity::generate_node_identity().unwrap());
    let identity_b = Arc::new(QuantumNodeIdentity::generate_node_identity().unwrap());

    let addr_b = "127.0.0.1:18081".parse().unwrap();
    setup_peer(identity_b.clone(), addr_b).await;

    let membership = Arc::new(ClusterMembership::new());
    membership
        .register_self(NodeId::new("node-b"), addr_b, 18081)
        .await;

    let manager = Arc::new(RaftPeerManager::new(
        identity_a,
        membership,
        NodeId::new("node-a"),
    ));

    // This should not panic and should establish a connection
    let tx = manager.get_or_spawn_worker(NodeId::new("node-b")).await;
    assert!(
        tx.is_ok(),
        "Should establish authenticated connection to peer"
    );
}

#[tokio::test]
async fn test_rpc_timeout() {
    let identity_a = Arc::new(QuantumNodeIdentity::generate_node_identity().unwrap());
    let identity_b = Arc::new(QuantumNodeIdentity::generate_node_identity().unwrap());

    let addr_b = "127.0.0.1:18082".parse().unwrap();
    let listener = TcpListener::bind(addr_b).await.unwrap();

    tokio::spawn(async move {
        loop {
            if let Ok((_stream, _)) = listener.accept().await {
                // Accept but never respond
                tokio::time::sleep(Duration::from_secs(10)).await;
            }
        }
    });

    let membership = Arc::new(ClusterMembership::new());
    membership
        .register_self(NodeId::new("node-b"), addr_b, 18082)
        .await;

    let manager = Arc::new(RaftPeerManager::new(
        identity_a,
        membership,
        NodeId::new("node-a"),
    ));

    // We need a way to trigger a send_request_vote
    // Since RaftRpcClient is implemented for Arc<RaftPeerManager>
    use ha_cluster::raft::{RaftRpcClient, RequestVoteArgs};
    let args = RequestVoteArgs {
        term: 1,
        candidate_id: NodeId::new("node-a"),
        last_log_index: 0,
        last_log_term: 0,
    };

    let res = manager.send_request_vote(NodeId::new("node-b"), args).await;
    assert!(res.is_err(), "RPC should timeout");
    assert!(
        res.unwrap_err().contains("timeout"),
        "Error should be a timeout"
    );
}
