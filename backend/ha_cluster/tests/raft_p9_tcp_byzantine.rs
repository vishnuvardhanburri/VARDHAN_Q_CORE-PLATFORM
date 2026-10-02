//! SEC-018: Real TCP + PQ + AEAD Byzantine Identity Test
//!
//! Verifies that the Raft listener cryptographically binds the handshake
//! identity to the application-layer sender_id. A peer that authenticates
//! with DSA key X CANNOT claim to be NodeId Y — even though the outer AEAD
//! frame is encrypted and integrity-protected.

use core_crypto::QuantumNodeIdentity;
use ha_cluster::raft::{
    AppendEntriesArgs, AppendEntriesReply, RaftRpcClient, RaftRpcEnvelope, RaftRpcType,
    RequestVoteArgs, RequestVoteReply,
};
use ha_cluster::raft_listener::{PeerRegistry, RaftNetworkListener};
use ha_cluster::{NodeId, RaftConfig, RaftNode};
use proxy_engine::{run_initiator, run_responder, AeadTransport};
use std::collections::HashMap;
use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::Arc;
use tokio::net::TcpStream;
use tokio::time::{timeout, Duration};

struct DummyRpc;
impl RaftRpcClient for DummyRpc {
    fn send_request_vote(
        &self,
        _to: NodeId,
        _args: RequestVoteArgs,
    ) -> Pin<Box<dyn Future<Output = Result<RequestVoteReply, String>> + Send>> {
        Box::pin(async { Err("dummy".to_string()) })
    }
    fn send_append_entries(
        &self,
        _to: NodeId,
        _args: AppendEntriesArgs,
    ) -> Pin<Box<dyn Future<Output = Result<AppendEntriesReply, String>> + Send>> {
        Box::pin(async { Err("dummy".to_string()) })
    }
}

async fn setup_test_listener() -> (
    Arc<RaftNode>,
    Arc<QuantumNodeIdentity>,
    NodeId,
    u16,
    PeerRegistry,
) {
    let identity_server = Arc::new(QuantumNodeIdentity::generate_node_identity().unwrap());
    let db_path = std::env::temp_dir().join(format!("raft_tcp_byz_{}", rand::random::<u64>()));
    let _ = std::fs::remove_dir_all(&db_path);
    std::fs::create_dir_all(&db_path).unwrap();

    let mut config = RaftConfig::default();
    config.persist_on_submit = true;
    config.state_machine_mac_key = Some([0x42; 32]);
    let persist_path = db_path.join("server.json");

    let server_id = NodeId::new("server-node");
    let node_server = Arc::new(RaftNode::with_config(
        server_id.clone(),
        persist_path,
        Arc::new(DummyRpc),
        config,
    ));

    // Force server to be a follower in term 5 so it can accept valid requests
    *node_server.current_term.write().await = 5;

    let identity_client_valid = Arc::new(QuantumNodeIdentity::generate_node_identity().unwrap());
    let valid_client_id = NodeId::new("valid-client-node");

    let mut registry = PeerRegistry::new();
    let fp = QuantumNodeIdentity::hash_ledger_block(&identity_client_valid.dsa_public_key_bytes());
    registry.insert(fp, valid_client_id.clone());

    let (listener, tcp_listener, bound_addr) = RaftNetworkListener::new_with_registry(
        "127.0.0.1:0".parse().unwrap(),
        identity_server.clone(),
        node_server.clone(),
        registry.clone(),
    )
    .await
    .unwrap();

    // Start the listener task
    tokio::spawn(async move {
        listener.run(tcp_listener).await.unwrap();
    });

    (
        node_server,
        identity_client_valid,
        valid_client_id,
        bound_addr.port(),
        registry,
    )
}

async fn send_envelope(
    port: u16,
    client_identity: &QuantumNodeIdentity,
    envelope: RaftRpcEnvelope,
) -> Result<Vec<u8>, String> {
    let mut stream = TcpStream::connect(("127.0.0.1", port))
        .await
        .map_err(|e| e.to_string())?;

    let session = run_initiator(&mut stream, client_identity)
        .await
        .map_err(|e| e.to_string())?;

    let mut transport = AeadTransport::new(
        stream,
        *session.client_to_server_key,
        *session.server_to_client_key,
        session.session_id,
        session.session_salt,
        true,
    );

    let env_bytes = serde_json::to_vec(&envelope).unwrap();
    transport
        .write_frame(&env_bytes)
        .await
        .map_err(|e| e.to_string())?;

    match timeout(Duration::from_millis(100), transport.read_frame()).await {
        Ok(Ok(Some(reply_bytes))) => Ok(reply_bytes),
        Ok(Ok(None)) => Err("EOF".into()),
        Ok(Err(e)) => Err(e.to_string()),
        Err(_) => Err("Timeout waiting for reply (likely dropped)".to_string()),
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn sec018_valid_authenticated_sender_accepted() {
    let (node, valid_identity, valid_id, port, _) = setup_test_listener().await;

    let envelope = RaftRpcEnvelope {
        sender_id: valid_id.clone(), receiver_id: NodeId::new("server-node"), version: 1,
        request_id: "1".to_string(),
        rpc_type: RaftRpcType::RequestVote,
        payload: serde_json::to_vec(&RequestVoteArgs {
            term: 6,
            candidate_id: valid_id.clone(),
            last_log_index: 0,
            last_log_term: 0,
        })
        .unwrap(),
    };

    let reply_bytes = send_envelope(port, &valid_identity, envelope).await.expect("Should receive reply");
    let reply_env: RaftRpcEnvelope = serde_json::from_slice(&reply_bytes).unwrap();
    let reply: RequestVoteReply = serde_json::from_slice(&reply_env.payload).unwrap();
    
    assert!(reply.vote_granted, "Legitimate vote should be granted");
    assert_eq!(*node.current_term.read().await, 6, "Node term should update to 6");
}

#[tokio::test(flavor = "multi_thread")]
async fn sec018_forged_sender_id_rejected() {
    let (node, valid_identity, _valid_id, port, _) = setup_test_listener().await;

    let forged_id = NodeId::new("some-other-node");
    
    let envelope = RaftRpcEnvelope {
        sender_id: forged_id.clone(), receiver_id: NodeId::new("server-node"), version: 1,
        request_id: "2".to_string(),
        rpc_type: RaftRpcType::RequestVote,
        payload: serde_json::to_vec(&RequestVoteArgs {
            term: 99,
            candidate_id: forged_id.clone(),
            last_log_index: 0,
            last_log_term: 0,
        })
        .unwrap(),
    };

    let res = send_envelope(port, &valid_identity, envelope).await;
    // Should be dropped/timeout because the listener rejects the mismatched sender_id
    assert!(res.is_err(), "Expected connection drop/timeout for forged sender");
    
    // Crucially: prove the Raft state was NOT mutated
    assert_eq!(*node.current_term.read().await, 5, "State must NOT mutate on forged identity");
}

#[tokio::test(flavor = "multi_thread")]
async fn sec018_stale_unknown_peer_rejected() {
    let (node, _valid_identity, valid_id, port, _) = setup_test_listener().await;

    // Attacker generates their own valid quantum identity, but it's not in the registry
    let attacker_identity = Arc::new(QuantumNodeIdentity::generate_node_identity().unwrap());

    let envelope = RaftRpcEnvelope {
        sender_id: valid_id.clone(), receiver_id: NodeId::new("server-node"), version: 1, // Attacker tries to claim the valid ID
        request_id: "3".to_string(),
        rpc_type: RaftRpcType::RequestVote,
        payload: serde_json::to_vec(&RequestVoteArgs {
            term: 99,
            candidate_id: valid_id.clone(),
            last_log_index: 0,
            last_log_term: 0,
        })
        .unwrap(),
    };

    let res = send_envelope(port, &attacker_identity, envelope).await;
    assert!(res.is_err(), "Expected connection drop/timeout for unknown peer fingerprint");
    
    // Prove the Raft state was NOT mutated
    assert_eq!(*node.current_term.read().await, 5, "State must NOT mutate from unregistered peer");
}

#[tokio::test(flavor = "multi_thread")]
async fn sec018_envelope_sender_mismatch_rejected() {
    let (node, valid_identity, valid_id, port, _) = setup_test_listener().await;

    let other_id = NodeId::new("some-other-id");

    // The client is valid and registered, BUT puts a different NodeId in the envelope
    let envelope = RaftRpcEnvelope {
        sender_id: other_id.clone(), receiver_id: NodeId::new("server-node"), version: 1,
        request_id: "4".to_string(),
        rpc_type: RaftRpcType::AppendEntries,
        payload: serde_json::to_vec(&AppendEntriesArgs {
            term: 99,
            leader_id: other_id.clone(),
            prev_log_index: 0,
            prev_log_term: 0,
            entries: vec![],
            leader_commit: 0,
        })
        .unwrap(),
    };

    let res = send_envelope(port, &valid_identity, envelope).await;
    assert!(res.is_err(), "Expected connection drop/timeout for mismatched envelope sender");
    
    // Prove the Raft state was NOT mutated
    assert_eq!(*node.current_term.read().await, 5, "State must NOT mutate on mismatch");
}
