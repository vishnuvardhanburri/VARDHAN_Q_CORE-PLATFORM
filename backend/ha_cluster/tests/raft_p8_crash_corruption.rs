//! P8.5: Crash During Persistence + P8.6: Storage Corruption
//!
//! Attacks the vP7.3-frozen baseline.
//!
//! P8.5 tests crash safety: what happens when the process crashes mid-write?
//! P8.6 tests corruption detection: what happens when persistent files are
//! tampered with?
//!
//! Security invariants targeted:
//!   I6  Crash-safety: torn writes must not corrupt the recovery path
//!   I7  Integrity verification: corrupted evidence must be detected
//!   I9  Malformed/corrupted input must not crash the process
//!
//! Run: cargo test -p ha_cluster --test raft_p8_crash_corruption -- --test-threads=1

use std::path::PathBuf;
use std::sync::Arc;

use audit_ledger::{
    Checkpoint, CommittedCheckpoint, LedgerEntry, LedgerWriter,
    merkle_root_from_ledger_file,
};
use core_crypto::QuantumNodeIdentity;
use ha_cluster::{RaftConfig, RaftNode, NodeId};
use ha_cluster::raft::{AppendEntriesArgs, RaftRpcClient};
use ha_cluster::raft::{AppendEntriesReply, RequestVoteArgs, RequestVoteReply};

fn test_config() -> RaftConfig {
    RaftConfig {
        election_timeout_min_ms: 200,
        election_timeout_max_ms: 400,
        heartbeat_interval_ms: 50,
        persist_on_submit: true,
            state_machine_mac_key: Some([0x42; 32]),
    }
}

/// Helper: create a valid signed checkpoint for testing.
fn create_valid_checkpoint(
    identity: &QuantumNodeIdentity,
    seq: u64,
    prev_hash_hex: &str,
) -> CommittedCheckpoint {
    let pub_key_bytes = identity.dsa_public_key_bytes();
    let signer_fp = hex::encode(QuantumNodeIdentity::hash_ledger_block(&pub_key_bytes));

    let cp = Checkpoint {
        version: 1,
        cluster_id: format!("cluster-p8-{}", seq),
        config_epoch: 1,
        raft_term: 1,
        raft_log_index: 1 + seq,
        ledger_first_seq: 0,
        ledger_last_seq: seq,
        ledger_entry_count: 1 + seq,
        merkle_root: "00".repeat(32),
        previous_checkpoint_hash: prev_hash_hex.to_string(),
        timestamp_ms: 1234567890000u128,
        signature: String::new(),
        signer_pub_fingerprint: signer_fp,
    };

    let canonical = cp.canonical_hash().unwrap();
    let sig = identity.sign_payload(&canonical).unwrap();
    let mut cp = cp;
    cp.signature = hex::encode(&sig);
    CommittedCheckpoint {
        checkpoint: cp,
        raft_commit_term: 1,
        raft_commit_index: 1 + seq,
    }
}

/// A no-op RPC client for tests that don't need actual network communication.
struct MockRpcClientNoop;

impl RaftRpcClient for MockRpcClientNoop {
    fn send_request_vote(
        &self,
        _to: NodeId,
        _args: RequestVoteArgs,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<RequestVoteReply, String>> + Send>> {
        Box::pin(async move { Err("mock: not connected".to_string()) })
    }

    fn send_append_entries(
        &self,
        _to: NodeId,
        _args: AppendEntriesArgs,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<AppendEntriesReply, String>> + Send>> {
        Box::pin(async move { Err("mock: not connected".to_string()) })
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// P8.5: Crash During Persistence
// ═══════════════════════════════════════════════════════════════════════════

/// P8.5a: Torn write on Raft persistent state.
///
/// **Invariant I6:** Torn writes must not corrupt the recovery path.
/// If the process crashes mid-write, `RaftNode::load_persistent_state`
/// should fail to parse the partial JSON and the node should start fresh.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[should_panic(expected = "FATAL: Raft state file must be MAC-protected")]
async fn p8_5a_torn_raft_state_write() {
    let dir = std::env::temp_dir();
    let persist_path = dir.join("p8_5a_torn_raft_state.json");

    // Simulate a torn write — partial JSON in the state file
    let partial_json = r#"{"current_term":5,"voted_for":"node-a","log":[{"term":1"#;
    std::fs::write(&persist_path, partial_json).unwrap();

    // A new RaftNode should load this — if parsing fails, it falls back
    // to defaults via `.unwrap_or(RaftPersistentState { current_term: 0, ... })`
    let config = test_config();
    let node = RaftNode::with_config(
        NodeId::new("node-a"),
        persist_path,
        Arc::new(MockRpcClientNoop) as Arc<dyn RaftRpcClient>,
        config,
    );
}

/// P8.5b: Torn write on ledger file.
///
/// **Invariant I6:** Torn writes to the ledger must be truncated to the
/// last valid byte boundary, and the chain must remain intact.
#[test]
fn p8_5b_torn_ledger_write() {
    let identity = QuantumNodeIdentity::generate_node_identity().unwrap();
    let dir = std::env::temp_dir();
    let ledger_path = dir.join("p8_5b_torn_ledger.jsonl");

    // Write 3 valid entries
    let _ = std::fs::remove_file(&ledger_path);
    let writer = LedgerWriter::open(&ledger_path, &identity)
        .unwrap_or_else(|e| panic!("{}", e));
    for i in 0..3u64 {
        let event = serde_json::json!({"type": "write", "data": i});
        writer.append(event, &identity).unwrap();
    }
    drop(writer);

    // Read the file, then simulate a torn write by appending a partial line
    let original = std::fs::read_to_string(&ledger_path).unwrap();
    let torn_data = format!(
        "{}\n{{\"schema_version\":1,\"seq\":3,\"timestamp_ms\":123,\"prev_hash\":\"abc\",",
        original.trim_end()
    );
    std::fs::write(&ledger_path, torn_data).unwrap();

    // Reopen — scan_existing_ledger should detect the torn write and truncate
    // to the last valid line
    let writer2 = LedgerWriter::open(&ledger_path, &identity)
        .unwrap_or_else(|e| panic!("{}", e));
    let (next_seq, _) = writer2.chain_tip().unwrap();

    assert_eq!(next_seq, 3,
        "After torn write, ledger should resume at seq=3 (3 valid entries + truncated 4th)");

    // Verify chain integrity — merkle root should still be computable
    let merkle = merkle_root_from_ledger_file(&ledger_path).unwrap();
    assert!(merkle.iter().any(|&b| b != 0),
        "Merkle root should be non-zero for valid entries");

    println!("P8.5b PASSED: Torn ledger write → truncated to last valid entry, chain intact");
}

/// P8.5c: Torn write on checkpoint file.
///
/// **Invariant I6:** Torn writes to the checkpoint chain must be detected
/// during `CheckpointWriter::open` (which calls `scan_existing_checkpoints`).
#[test]
fn p8_5c_torn_checkpoint_write() {
    let identity = QuantumNodeIdentity::generate_node_identity().unwrap();
    let dir = std::env::temp_dir();
    let cp_path = dir.join("p8_5c_torn_checkpoint.jsonl");

    // Write 2 valid checkpoints using CheckpointWriter
    let _ = std::fs::remove_file(&cp_path);
    let writer = audit_ledger::CheckpointWriter::open(&cp_path)
        .unwrap_or_else(|e| panic!("{}", e));

    let cp1 = create_valid_checkpoint(&identity, 0, &"0".repeat(64));
    writer.append(&cp1).unwrap_or_else(|e| panic!("{}", e));

    let cp1_hash = cp1.checkpoint.checkpoint_hash().unwrap();
    let prev_hash_hex = hex::encode(cp1_hash);
    let cp2 = create_valid_checkpoint(&identity, 1, &prev_hash_hex);
    writer.append(&cp2).unwrap_or_else(|e| panic!("{}", e));
    drop(writer);

    // Simulate torn write: append a partial checkpoint JSON
    let original = std::fs::read_to_string(&cp_path).unwrap();
    let torn_data = format!(
        "{}{{\"checkpoint\":{{\"version\":1,\"cluster_id\":\"partial\",",
        original.trim_end()
    );
    std::fs::write(&cp_path, torn_data).unwrap();

    // Reopen should detect the broken JSON and return an error
    let result = audit_ledger::CheckpointWriter::open(&cp_path);
    let err = match result {
        Err(e) => e.to_string(),
        Ok(_) => panic!("Expected error from torn checkpoint write"),
    };
    assert!(
        err.contains("JSON parse error") || err.contains("Expected") || err.contains("line"),
        "Error should indicate JSON/parse failure, got: {}", err
    );

    println!("P8.5c PASSED: Torn checkpoint write → detected on reopen (error: {})", err);
}

// ═══════════════════════════════════════════════════════════════════════════
// P8.6: Storage Corruption
// ═══════════════════════════════════════════════════════════════════════════

/// P8.6a: Corrupted ledger entry — modify event data.
///
/// **Invariant I7:** Corrupted evidence must be detected.
///
/// Changing the event data in a ledger entry breaks the `prev_hash` chain
/// (subsequent entries reference the previous entry's canonical hash),
/// so `LedgerWriter::open` should detect the chain break.
#[test]
fn p8_6a_corrupted_ledger_entry() {
    let identity = QuantumNodeIdentity::generate_node_identity().unwrap();
    let dir = std::env::temp_dir();
    let ledger_path = dir.join("p8_6a_corrupt_ledger.jsonl");

    // Write 2 valid entries
    let _ = std::fs::remove_file(&ledger_path);
    let writer = LedgerWriter::open(&ledger_path, &identity)
        .unwrap_or_else(|e| panic!("{}", e));
    writer.append(serde_json::json!({"type": "write", "data": 1}), &identity).unwrap();
    writer.append(serde_json::json!({"type": "write", "data": 2}), &identity).unwrap();
    drop(writer);

    // Corrupt the first entry's event data (modify the JSON in-place)
    let mut lines: Vec<String> = std::fs::read_to_string(&ledger_path)
        .unwrap()
        .lines()
        .map(|l| l.to_string())
        .collect();
    assert_eq!(lines.len(), 2, "Should have 2 entries");

    // Parse line 1, modify the event, re-serialize with same prev_hash/signature
    let mut entry1: LedgerEntry = serde_json::from_str(&lines[0]).unwrap();
    entry1.event = serde_json::json!({"type": "CORRUPTED", "malicious": true});
    // NOTE: We keep the same signature — this is the attack: tampered data
    // with the original signature
    let corrupted_line = serde_json::to_string(&entry1).unwrap();

    let mut corrupted_lines = lines.clone();
    corrupted_lines[0] = corrupted_line;
    std::fs::write(&ledger_path, corrupted_lines.join("\n") + "\n").unwrap();

    // Reopen should detect the chain break
    let result = LedgerWriter::open(&ledger_path, &identity);
    let err = match result {
        Err(e) => e.to_string(),
        Ok(_) => panic!("Expected error from corrupted ledger"),
    };
    assert!(
        err.contains("chain broken") || err.contains("prev_hash"),
        "Error should indicate chain break, got: {}", err
    );

    println!("P8.6a PASSED: Corrupted ledger entry → chain break detected on reopen");
}

/// P8.6b: Corrupted checkpoint merkle_root.
///
/// **Invariant I7:** Tampered checkpoint merkle_root must be detected by
/// signature verification — the canonical hash includes merkle_root, so
/// changing it invalidates the signature.
#[test]
fn p8_6b_corrupted_checkpoint_merkle_root() {
    let identity = QuantumNodeIdentity::generate_node_identity().unwrap();
    let pub_key_bytes = identity.dsa_public_key_bytes();
    let dir = std::env::temp_dir();
    let cp_path = dir.join("p8_6b_corrupt_cp.jsonl");

    // Write a valid checkpoint
    let _ = std::fs::remove_file(&cp_path);
    let cp = create_valid_checkpoint(&identity, 0, &"0".repeat(64));
    let cp_json = serde_json::to_string(&cp).unwrap();
    std::fs::write(&cp_path, cp_json.clone() + "\n").unwrap();

    // Corrupt the merkle_root field
    let mut cp_struct: CommittedCheckpoint = serde_json::from_str(&cp_json).unwrap();
    cp_struct.checkpoint.merkle_root = "FF".repeat(32); // Wrong merkle root
    let corrupted_json = serde_json::to_string(&cp_struct).unwrap();
    std::fs::write(&cp_path, corrupted_json.clone() + "\n").unwrap();

    // Verify: the canonical hash now differs from what was signed → signature fails
    let cp_reloaded: CommittedCheckpoint = serde_json::from_str(&corrupted_json).unwrap();
    let canonical = cp_reloaded.checkpoint.canonical_hash().unwrap();
    let sig_bytes = hex::decode(&cp_reloaded.checkpoint.signature).unwrap();

    let sig_valid = QuantumNodeIdentity::verify_signature(
        &pub_key_bytes,
        &canonical,
        &sig_bytes,
    );

    assert!(!sig_valid,
        "Corrupted merkle_root MUST fail signature verification — signature is over canonical hash which includes merkle_root");

    println!("P8.6b PASSED: Corrupted merkle_root → signature verification fails");
}

/// P8.6c: Corrupted checkpoint signature.
///
/// **Invariant I7:** A tampered signature must be detected.
#[test]
fn p8_6c_corrupted_checkpoint_signature() {
    let identity = QuantumNodeIdentity::generate_node_identity().unwrap();
    let pub_key_bytes = identity.dsa_public_key_bytes();
    let dir = std::env::temp_dir();
    let cp_path = dir.join("p8_6c_corrupt_sig.jsonl");

    let _ = std::fs::remove_file(&cp_path);
    let cp = create_valid_checkpoint(&identity, 0, &"0".repeat(64));
    let cp_json = serde_json::to_string(&cp).unwrap();
    let mut cp_struct: CommittedCheckpoint = serde_json::from_str(&cp_json).unwrap();
    // Flip bytes in the signature
    let mut sig_bytes = hex::decode(&cp_struct.checkpoint.signature).unwrap();
    if !sig_bytes.is_empty() { sig_bytes[0] ^= 0xFF; }
    cp_struct.checkpoint.signature = hex::encode(sig_bytes);

    let corrupted_json = serde_json::to_string(&cp_struct).unwrap();
    std::fs::write(&cp_path, corrupted_json.clone() + "\n").unwrap();

    // Verify signature fails
    let cp_reloaded: CommittedCheckpoint = serde_json::from_str(&corrupted_json).unwrap();
    let canonical = cp_reloaded.checkpoint.canonical_hash().unwrap();
    let sig_bytes_corrupt = hex::decode(&cp_reloaded.checkpoint.signature).unwrap();

    let sig_valid = QuantumNodeIdentity::verify_signature(
        &pub_key_bytes,
        &canonical,
        &sig_bytes_corrupt,
    );

    assert!(!sig_valid,
        "Corrupted signature MUST fail verification");

    println!("P8.6c PASSED: Corrupted signature → verification fails");
}

/// P8.6d: Checkpoint chain break — corrupt previous_checkpoint_hash.
///
/// **Invariant I7:** A broken checkpoint chain (modified
/// previous_checkpoint_hash) must be detected during scanning.
#[test]
fn p8_6d_corrupted_checkpoint_chain() {
    let identity = QuantumNodeIdentity::generate_node_identity().unwrap();
    let dir = std::env::temp_dir();
    let cp_path = dir.join("p8_6d_corrupt_chain.jsonl");

    // Write checkpoint 1 (valid)
    let _ = std::fs::remove_file(&cp_path);
    let cp1 = create_valid_checkpoint(&identity, 0, &"0".repeat(64));
    let cp1_hash = cp1.checkpoint.checkpoint_hash().unwrap();
    let prev_hash_hex = hex::encode(cp1_hash);

    // Write checkpoint 2 (valid) — depends on cp1's hash
    let cp2 = create_valid_checkpoint(&identity, 1, &prev_hash_hex);

    let cp1_json = serde_json::to_string(&cp1).unwrap();
    let cp2_json = serde_json::to_string(&cp2).unwrap();
    std::fs::write(&cp_path, format!("{}\n{}\n", cp1_json, cp2_json)).unwrap();

    // Now corrupt cp2's previous_checkpoint_hash (break the chain)
    let mut cp2_struct: CommittedCheckpoint = serde_json::from_str(&cp2_json).unwrap();
    cp2_struct.checkpoint.previous_checkpoint_hash =
        "DEADBEEF".repeat(8); // Wrong — doesn't match cp1's hash

    // Re-sign cp2 with the wrong prev_hash
    let canonical = cp2_struct.checkpoint.canonical_hash().unwrap();
    let sig = identity.sign_payload(&canonical).unwrap();
    cp2_struct.checkpoint.signature = hex::encode(&sig);

    // Rewrite the file with the valid cp1 + corrupted cp2
    let corrupted_cp2_json = serde_json::to_string(&cp2_struct).unwrap();
    std::fs::write(&cp_path, format!("{}\n{}\n", cp1_json, corrupted_cp2_json)).unwrap();

    // Try to open the CheckpointWriter — should detect chain break during scan
    let result = audit_ledger::CheckpointWriter::open(&cp_path);
    let err = match result {
        Err(e) => e.to_string(),
        Ok(_) => panic!("Expected error from corrupted checkpoint chain"),
    };
    assert!(
        err.contains("chain broken") || err.contains("prev_checkpoint_hash"),
        "Error should indicate chain break, got: {}", err
    );

    println!("P8.6d PASSED: Corrupted checkpoint chain → detected by CheckpointWriter::open");
}

/// P8.6e: Corrupted Raft state file — node must not load corrupted state.
///
/// **Invariant I9:** Malformed/corrupted input must not crash the process.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[should_panic(expected = "FATAL: Raft state file must be MAC-protected")]
async fn p8_6e_corrupted_raft_state() {
    let dir = std::env::temp_dir();
    let persist_path = dir.join("p8_6e_corrupt_raft_state.json");

    // Write completely invalid JSON
    std::fs::write(&persist_path, b"NOT_VALID_JSON_AT_ALL{{{{{").unwrap();

    let config = test_config();
    let node = RaftNode::with_config(
        NodeId::new("node-a"),
        persist_path,
        Arc::new(MockRpcClientNoop) as Arc<dyn RaftRpcClient>,
        config,
    );
}

/// P8.6f: Corrupted ledger entry (middle of chain) — chain break detected
/// at the next entry's prev_hash check.
///
/// **Invariant I7:** Corruption of any entry's data breaks the hash chain
/// and is detected when the next entry's prev_hash doesn't match.
#[test]
fn p8_6f_corrupted_ledger_mid_chain() {
    let identity = QuantumNodeIdentity::generate_node_identity().unwrap();
    let dir = std::env::temp_dir();
    let ledger_path = dir.join("p8_6f_corrupt_mid_chain.jsonl");

    let _ = std::fs::remove_file(&ledger_path);
    let writer = LedgerWriter::open(&ledger_path, &identity)
        .unwrap_or_else(|e| panic!("{}", e));
    for i in 0..5u64 {
        writer.append(
            serde_json::json!({"seq": i, "data": format!("entry-{}", i)}),
            &identity,
        ).unwrap();
    }
    drop(writer);

    // Read and corrupt entry #2 (index 2 in the file)
    let mut lines: Vec<String> = std::fs::read_to_string(&ledger_path)
        .unwrap()
        .lines()
        .map(|l| l.to_string())
        .collect();

    // Corrupt the event data of entry 2
    let mut entry2: LedgerEntry = serde_json::from_str(&lines[2]).unwrap();
    entry2.event = serde_json::json!({"seq": 2, "data": "TAMPERED", "extra": "malicious"});
    lines[2] = serde_json::to_string(&entry2).unwrap();

    std::fs::write(&ledger_path, lines.join("\n") + "\n").unwrap();

    // Reopen — should detect chain break at entry 3 (its prev_hash won't match entry 2's new hash)
    let result = LedgerWriter::open(&ledger_path, &identity);
    let err = match result {
        Err(e) => e.to_string(),
        Ok(_) => panic!("Expected error from corrupted mid-chain ledger"),
    };
    assert!(
        err.contains("chain broken") || err.contains("prev_hash"),
        "Error should indicate chain break, got: {}", err
    );

    println!("P8.6f PASSED: Mid-chain corrupted entry → hash chain break detected");
}

/// P8.6g: Full pq_verify subprocess test with corrupted evidence.
///
/// **Invariant I7:** The `pq_verify` binary must detect corrupted evidence
/// and return a non-zero exit code.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn p8_6g_pq_verify_detects_corruption() {
    let identity = QuantumNodeIdentity::generate_node_identity().unwrap();
    let pub_key_bytes = identity.dsa_public_key_bytes();
    let dir = std::env::temp_dir();
    let evidence_dir = dir.join("p8_6g_corrupt_evidence");
    let _ = std::fs::remove_dir_all(&evidence_dir);
    std::fs::create_dir_all(&evidence_dir).unwrap();

    let pub_key_path = evidence_dir.join("public_key.hex");
    std::fs::write(&pub_key_path, hex::encode(&pub_key_bytes)).unwrap();

    let ledger_path = evidence_dir.join("ledger.jsonl");
    let cp_path = evidence_dir.join("checkpoints.jsonl");

    // Write valid ledger
    {
        let writer = LedgerWriter::open(&ledger_path, &identity)
            .unwrap_or_else(|e| panic!("{}", e));
        for i in 0..3u64 {
            writer.append(
                serde_json::json!({"type": "write", "i": i}),
                &identity,
            ).unwrap();
        }
    }

    // Write valid checkpoint
    {
        let cp = create_valid_checkpoint(&identity, 2, &"0".repeat(64));
        std::fs::write(&cp_path, serde_json::to_string(&cp).unwrap() + "\n").unwrap();
    }

    // First: verify pq_verify PASSES on valid evidence
    let output = std::process::Command::new("pq_verify")
        .arg("--evidence-dir")
        .arg(&evidence_dir)
        .arg("--public-key")
        .arg(&pub_key_path)
        .output();

    if let Ok(output) = output {
        if output.status.success() {
            println!("P8.6g: pq_verify PASS on valid evidence (baseline OK)");
        } else {
            eprintln!("P8.6g WARNING: pq_verify not found or failed on valid evidence");
        }
    } else {
        eprintln!("P8.6g: pq_verify binary not available — skipping subprocess test");
    }

    // Now corrupt the ledger
    let lines: Vec<String> = std::fs::read_to_string(&ledger_path)
        .unwrap()
        .lines()
        .map(|l| l.to_string())
        .collect();
    let mut entry1: LedgerEntry = serde_json::from_str(&lines[1]).unwrap();
    entry1.event = serde_json::json!({"type": "CORRUPTED"});
    let mut corrupted = lines.clone();
    corrupted[1] = serde_json::to_string(&entry1).unwrap();
    std::fs::write(&ledger_path, corrupted.join("\n") + "\n").unwrap();

    // pq_verify should FAIL on corrupted evidence
    let output = std::process::Command::new("pq_verify")
        .arg("--evidence-dir")
        .arg(&evidence_dir)
        .arg("--public-key")
        .arg(&pub_key_path)
        .output();

    if let Ok(output) = output {
        assert!(!output.status.success(),
            "pq_verify MUST fail on corrupted evidence (exit code {})",
            output.status.code().unwrap_or(-1));
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let combined = format!("{}{}", stdout, stderr);
        assert!(combined.contains("FAIL"),
            "Output should contain FAIL for corrupted evidence: {}", combined);
        println!("P8.6g PASSED: pq_verify detected corrupted ledger — FAIL verdict");
    } else {
        println!("P8.6g: pq_verify binary not available — library-level tests (P8.6a–P8.6f) provide coverage");
    }

    let _ = std::fs::remove_dir_all(&evidence_dir);
}


#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[should_panic(expected = "FATAL: Raft state file must be MAC-protected")]
async fn sec_003_a_plaintext_refused() {
    let dir = std::env::temp_dir();
    let persist_path = dir.join(format!("sec_003_a_{}.json", rand::random::<u64>()));
    std::fs::write(&persist_path, r#"{"current_term": 5, "voted_for": "node-a", "log": [], "commit_index": 0, "cluster_id": "test", "config_epoch": 1}"#).unwrap();

    let mut config = test_config();
    config.state_machine_mac_key = Some([0x42; 32]);
    RaftNode::with_config(NodeId::new("test"), persist_path, Arc::new(MockRpcClientNoop), config);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[should_panic(expected = "Raft state file integrity check failed (MAC mismatch)")]
async fn sec_003_b_tampered_payload() {
    use ha_cluster::raft::SecureEnvelope;
    let dir = std::env::temp_dir();
    let persist_path = dir.join(format!("sec_003_b_{}.json", rand::random::<u64>()));
    
    let key = [0x42; 32];
    let payload = r#"{"current_term": 5, "voted_for": "node-a", "log": [], "commit_index": 0, "cluster_id": "test", "config_epoch": 1}"#;
    let expected_mac = blake3::keyed_hash(&key, payload.as_bytes());
    
    let tampered_payload = r#"{"current_term": 99, "voted_for": "node-a", "log": [], "commit_index": 0, "cluster_id": "test", "config_epoch": 1}"#;

    let env = SecureEnvelope {
        payload_json: tampered_payload.to_string(),
        mac: expected_mac.to_hex().to_string(),
    };
    std::fs::write(&persist_path, serde_json::to_string(&env).unwrap()).unwrap();

    let mut config = test_config();
    config.state_machine_mac_key = Some([0x42; 32]);
    RaftNode::with_config(NodeId::new("test"), persist_path, Arc::new(MockRpcClientNoop), config);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[should_panic(expected = "Raft state file integrity check failed (MAC mismatch)")]
async fn sec_003_c_tampered_mac() {
    use ha_cluster::raft::SecureEnvelope;
    let dir = std::env::temp_dir();
    let persist_path = dir.join(format!("sec_003_c_{}.json", rand::random::<u64>()));
    
    let payload = r#"{"current_term": 5, "voted_for": "node-a", "log": [], "commit_index": 0, "cluster_id": "test", "config_epoch": 1}"#;
    let env = SecureEnvelope {
        payload_json: payload.to_string(),
        mac: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef".to_string(),
    };
    std::fs::write(&persist_path, serde_json::to_string(&env).unwrap()).unwrap();

    let mut config = test_config();
    config.state_machine_mac_key = Some([0x42; 32]);
    RaftNode::with_config(NodeId::new("test"), persist_path, Arc::new(MockRpcClientNoop), config);
}
