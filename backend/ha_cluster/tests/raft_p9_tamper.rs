use ha_cluster::{RaftConfig, RaftNode, NodeId};
use ha_cluster::raft::{LogEntry, RaftRpcClient, AppendEntriesArgs, AppendEntriesReply, RequestVoteArgs, RequestVoteReply};
use std::sync::Arc;
use std::pin::Pin;
use std::future::Future;

struct DummyRpc;
impl RaftRpcClient for DummyRpc {
    fn send_request_vote(&self, _to: NodeId, _args: RequestVoteArgs) -> Pin<Box<dyn Future<Output = Result<RequestVoteReply, String>> + Send>> {
        Box::pin(async { Err("dummy".to_string()) })
    }
    fn send_append_entries(&self, _to: NodeId, _args: AppendEntriesArgs) -> Pin<Box<dyn Future<Output = Result<AppendEntriesReply, String>> + Send>> {
        Box::pin(async { Err("dummy".to_string()) })
    }
}

fn setup_test_env() -> (NodeId, std::path::PathBuf, Arc<dyn RaftRpcClient>, RaftConfig) {
    let mac_key = Some([0x42; 32]);
    let config = RaftConfig {
        persist_on_submit: true,
        state_machine_mac_key: mac_key,
        ..RaftConfig::default()
    };
    
    let db_path = std::env::temp_dir().join(format!("raft_p9_test_{}", rand::random::<u64>()));
    let _ = std::fs::remove_dir_all(&db_path);
    std::fs::create_dir_all(&db_path).unwrap();

    let node_id = NodeId::new("node-tamper-1");
    let mock_rpc: Arc<dyn RaftRpcClient> = Arc::new(DummyRpc);
    (node_id, db_path, mock_rpc, config)
}

#[tokio::test]
async fn test_p9_a_valid_envelope_loads() {
    let (node_id, db_path, mock_rpc, config) = setup_test_env();
    let persist_path = db_path.join("raft_state.json");
    let node = RaftNode::with_config(node_id.clone(), persist_path.clone(), mock_rpc.clone(), config.clone());
    node.update_term(42).await;
    
    // Attempt to load valid state
    let node2 = RaftNode::with_config(node_id, persist_path, mock_rpc, config);
    assert_eq!(*node2.current_term.read().await, 42);
}

#[tokio::test]
#[should_panic(expected = "FATAL: Raft state file integrity check failed (MAC mismatch)")]
async fn test_p9_b_payload_tampering_rejection() {
    let (node_id, db_path, mock_rpc, config) = setup_test_env();
    let persist_path = db_path.join("raft_state.json");
    let node = RaftNode::with_config(node_id.clone(), persist_path.clone(), mock_rpc.clone(), config.clone());
    node.update_term(42).await;
    
    // Tamper with payload string safely
    let data = std::fs::read_to_string(&persist_path).unwrap();
    let mut env: serde_json::Value = serde_json::from_str(&data).unwrap();
    if let Some(payload) = env.get_mut("payload_json") {
        let mut s = payload.as_str().unwrap().to_string();
        s = s.replace("42", "99");
        *payload = serde_json::Value::String(s);
    }
    std::fs::write(&persist_path, serde_json::to_string(&env).unwrap()).unwrap();
    
    let _node2 = RaftNode::with_config(node_id, persist_path, mock_rpc, config);
}

#[tokio::test]
#[should_panic(expected = "FATAL: Raft state file integrity check failed (MAC mismatch)")]
async fn test_p9_c_mac_tampering_rejection() {
    let (node_id, db_path, mock_rpc, config) = setup_test_env();
    let persist_path = db_path.join("raft_state.json");
    let node = RaftNode::with_config(node_id.clone(), persist_path.clone(), mock_rpc.clone(), config.clone());
    node.update_term(42).await;
    
    // Tamper with the MAC
    let mut data = std::fs::read(&persist_path).unwrap();
    let pos = data.iter().position(|&b| b == b'm').unwrap_or(data.len() / 2);
    data[pos + 7] ^= 0x01; // flip a hex char
    std::fs::write(&persist_path, data).unwrap();
    
    let _node2 = RaftNode::with_config(node_id, persist_path, mock_rpc, config);
}

#[tokio::test]
#[should_panic(expected = "FATAL: Raft state file must be MAC-protected when state_machine_mac_key is configured")]
async fn test_p9_d_missing_mac_rejection() {
    let (node_id, db_path, mock_rpc, config) = setup_test_env();
    let persist_path = db_path.join("raft_state.json");
    let node = RaftNode::with_config(node_id.clone(), persist_path.clone(), mock_rpc.clone(), config.clone());
    node.update_term(42).await;
    
    // Replace envelope with legacy state
    let state = r#"{
        "current_term": 42,
        "voted_for": null,
        "log": [],
        "commit_index": 0,
        "cluster_id": "",
        "config_epoch": 1
    }"#;
    std::fs::write(&persist_path, state).unwrap();
    
    let _node2 = RaftNode::with_config(node_id, persist_path, mock_rpc, config);
}
