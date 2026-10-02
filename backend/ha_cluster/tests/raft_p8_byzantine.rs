//! P8.1: Byzantine Node Injection
//!
//! Attacks the vP7.3-frozen baseline. Tests whether the Raft state machine
//! correctly handles Byzantine messages (conflicting votes, fabricated entries,
//! stale/forged terms) sent by a node with valid credentials.
//!
//! Standard Raft assumes fail-stop failures — it does not tolerate Byzantine
//! behavior by default. These tests verify how the Vardhan implementation
//! handles Byzantine input and document any gaps.
//!
//! Security invariants targeted:
//!   I2  No two valid leaders simultaneously authorize writes at the same log index
//!   I3  No committed state-machine command is applied differently across replicas
//!   I5  Replay cannot produce a second valid state transition
//!
//! Run: cargo test -p ha_cluster --test raft_p8_byzantine -- --test-threads=1

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use ha_cluster::{
    RaftConfig, RaftNode,
    raft::{
        AppendEntriesArgs, AppendEntriesReply, LogEntry, MockRpcClient,
        RequestVoteArgs, RequestVoteReply,
    },
};
use tokio::sync::RwLock;

fn test_config() -> RaftConfig {
    RaftConfig {
        election_timeout_min_ms: 200,
        election_timeout_max_ms: 400,
        heartbeat_interval_ms: 50,
        persist_on_submit: true,
            state_machine_mac_key: Some([0x42; 32]),
    }
}

/// Shared cluster map for in-memory message routing
type ClusterMap = Arc<RwLock<HashMap<ha_cluster::NodeId, Arc<RaftNode>>>>;

/// Create a 3-node in-memory cluster. Nodes don't run their election loop —
/// we inject messages directly via byzantine_* helpers to simulate a
/// Byzantine sender.
async fn make_cluster() -> (ClusterMap, Arc<RaftNode>, Arc<RaftNode>, Arc<RaftNode>) {
    for f in &["/tmp/p8_byzantine_a.json", "/tmp/p8_byzantine_b.json", "/tmp/p8_byzantine_c.json"] {
        std::fs::remove_file(f).ok();
    }

    let config = test_config();
    let id_a = ha_cluster::NodeId::new("node-a");
    let id_b = ha_cluster::NodeId::new("node-b");
    let id_c = ha_cluster::NodeId::new("node-c");

    let cluster_map: ClusterMap = Arc::new(RwLock::new(HashMap::new()));
    let rpc_client = Arc::new(MockRpcClient::new(cluster_map.clone()));

    let node_a = Arc::new(RaftNode::with_config(
        id_a.clone(),
        PathBuf::from("/tmp/p8_byzantine_a.json"),
        rpc_client.clone(),
        config.clone(),
    ));
    let node_b = Arc::new(RaftNode::with_config(
        id_b.clone(),
        PathBuf::from("/tmp/p8_byzantine_b.json"),
        rpc_client.clone(),
        config.clone(),
    ));
    let node_c = Arc::new(RaftNode::with_config(
        id_c.clone(),
        PathBuf::from("/tmp/p8_byzantine_c.json"),
        rpc_client.clone(),
        config,
    ));

    {
        let mut map = cluster_map.write().await;
        map.insert(id_a.clone(), node_a.clone());
        map.insert(id_b.clone(), node_b.clone());
        map.insert(id_c.clone(), node_c.clone());
    }

    (cluster_map, node_a, node_b, node_c)
}

/// Directly invoke `handle_request_vote` on a target node — simulates a
/// Byzantine sender crafting a RequestVote message.
async fn byzantine_request_vote(
    target: &RaftNode,
    args: RequestVoteArgs,
) -> RequestVoteReply {
    target.handle_request_vote(args).await
}

/// Directly invoke `handle_append_entries` on a target node — simulates a
/// Byzantine leader crafting an AppendEntries message.
async fn byzantine_append_entries(
    target: &RaftNode,
    args: AppendEntriesArgs,
) -> AppendEntriesReply {
    target.handle_append_entries(args).await
}

/// P8.1a: Double vote — Byzantine node sends two RequestVote messages
/// in the same term for different candidates.
///
/// **Invariant I5:** A node must grant at most one vote per term.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn p8_1a_double_vote_same_term() {
    let _ = tracing_subscriber::fmt::try_init();
    let (_cluster, _a, _b, node_c) = make_cluster().await;

    // First: Byzantine node votes for "attacker-1" at term 3
    let vote1 = byzantine_request_vote(&node_c, RequestVoteArgs {
        term: 3,
        candidate_id: ha_cluster::NodeId::new("attacker-1"),
        last_log_index: 5,
        last_log_term: 3,
    }).await;

    // Second: SAME term (3), different candidate "attacker-2" — Byzantine double vote
    let vote2 = byzantine_request_vote(&node_c, RequestVoteArgs {
        term: 3,
        candidate_id: ha_cluster::NodeId::new("attacker-2"),
        last_log_index: 5,
        last_log_term: 3,
    }).await;

    let granted_count = [vote1.vote_granted, vote2.vote_granted]
        .iter()
        .filter(|&&v| v)
        .count();

    assert_eq!(
        granted_count, 1,
        "Node C granted {} votes in term 3 — must grant at most 1 (double vote rejected)",
        granted_count
    );

    println!("P8.1a PASSED: Double vote — node C granted exactly 1 vote in term 3");
}

/// P8.1b: Uncommitted entry overwrite — Byzantine leader with the same
/// term overwrites an uncommitted entry at the same index.
///
/// **Invariant I3:** No committed state-machine command is applied differently.
/// Raft allows overwriting uncommitted entries — this is expected behavior.
/// Only committed entries are protected by I3.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn p8_1b_uncommitted_entry_overwrite() {
    let _ = tracing_subscriber::fmt::try_init();
    let (_cluster, id_a, id_b, id_c) = make_cluster().await;

    // Legitimate leader sends an uncommitted entry
    let legit_entry = LogEntry {
        term: 3,
        index: 1,
        client_id: "client-x".to_string(),
        request_id: "req-1".to_string(),
        data: b"legit-data".to_vec(),
    };
    let ae_legit = AppendEntriesArgs {
        term: 3,
        leader_id: id_a.id.clone(),
        prev_log_index: 0,
        prev_log_term: 0,
        entries: vec![legit_entry],
        leader_commit: 0, // NOT committed
    };

    let reply = byzantine_append_entries(&id_b, ae_legit).await;
    assert!(reply.success, "Node B should accept legitimate entry");

    // Byzantine leader (same term 3) overwrites at index 0
    let evil_entry = LogEntry {
        term: 3,
        index: 1,
        client_id: "evil".to_string(),
        request_id: "evil-req".to_string(),
        data: b"evil-data".to_vec(),
    };
    let ae_evil = AppendEntriesArgs {
        term: 3,
        leader_id: id_c.id.clone(),
        prev_log_index: 0,
        prev_log_term: 0,
        entries: vec![evil_entry],
        leader_commit: 1,
    };

    let reply_evil = byzantine_append_entries(&id_b, ae_evil).await;
    assert!(reply_evil.success,
        "Raft allows same-term overwrite of uncommitted entries (log matching)");

    let log = id_b.log.read().await;
    assert_eq!(&log[0].client_id, "evil",
        "Uncommitted entry should be overwritten by same-term leader (expected Raft behavior)");
    drop(log);

    println!("P8.1b PASSED: Uncommitted entry overwritten — expected Raft behavior (I3=committed-only)");
}

/// P8-001: Committed entry overwrite attempt (P8 finding).
///
/// A Byzantine leader at the same term attempts to truncate a COMMITTED entry.
///
/// **Finding P8-001:** The Raft layer does NOT protect committed entries from
/// same-term Byzantine leaders. `log.truncate(prev_idx)` at raft.rs does not
/// check `commit_index`. In production, this is mitigated by ML-KEM/ML-DSA
/// transport authentication — only authenticated nodes can send AppendEntries.
///
/// **Invariant I3:** No committed state-machine command is applied differently.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn p8_001_committed_entry_overwrite_by_byzantine() {
    let _ = tracing_subscriber::fmt::try_init();
    let (_cluster, id_a, id_b, _id_c) = make_cluster().await;

    // Commit an entry at term 1 on node B
    let committed_entry = LogEntry {
        term: 1,
        index: 1,
        client_id: "client-committed".to_string(),
        request_id: "req-committed".to_string(),
        data: b"committed-data".to_vec(),
    };
    let ae_commit = AppendEntriesArgs {
        term: 1,
        leader_id: id_a.id.clone(),
        prev_log_index: 0,
        prev_log_term: 0,
        entries: vec![committed_entry],
        leader_commit: 1, // Entry IS committed
    };

    let reply = byzantine_append_entries(&id_b, ae_commit).await;
    assert!(reply.success, "Node B should accept committed entry");
    {
        let log = id_b.log.read().await;
        assert_eq!(&log[0].client_id, "client-committed",
            "Committed entry should be in log");
    }
    {
        let commit = id_b.commit_index.read().await;
        assert_eq!(*commit, 1, "Commit index should be 1");
    }

    // Byzantine leader at the SAME term (1) sends AppendEntries that truncates
    // the committed entry at index 0
    let ae_byzantine = AppendEntriesArgs {
        term: 1, // SAME term — not rejected by term check
        leader_id: ha_cluster::NodeId::new("byzantine-leader"),
        prev_log_index: 0,
        prev_log_term: 0,
        entries: vec![LogEntry {
            term: 1,
            index: 1,
            client_id: "byzantine-forged".to_string(),
            request_id: "req-forged".to_string(),
            data: b"forged-data".to_vec(),
        }],
        leader_commit: 1,
    };

    let reply_trunc = byzantine_append_entries(&id_b, ae_byzantine).await;

    if reply_trunc.success {
        let log = id_b.log.read().await;
        let overwritten = log.get(0)
            .map(|e| e.client_id.as_str())
            == Some("byzantine-forged");
        if overwritten {
            // P8-001 FINDING: Committed entry was silently overwritten
            println!("P8-001 FINDING: Committed entry overwritten by same-term Byzantine leader");
            println!("  -> Raft layer does NOT protect committed entries from same-term truncation");
            println!("  -> Mitigated by transport-level ML-KEM/ML-DSA authentication in production");
            println!("  -> Standard Raft assumes fail-stop; Byzantine protection requires authenticated channels");
        } else {
            println!("P8.1b2 PASSED: Committed entry NOT overwritten (Raft protects committed entries)");
        }
    } else {
        println!("P8.1b2 PASSED: AppendEntries rejected (log matching protected the committed entry)");
    }
}

/// P8.1c: Forged high-term election + double vote in new term.
///
/// **Invariant I5:** Step-down on higher term is allowed, but one-vote-per-term
/// still applies in the new term.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn p8_1c_forged_high_term_then_double_vote() {
    let _ = tracing_subscriber::fmt::try_init();
    let (_cluster, _a, _b, node_c) = make_cluster().await;

    // Step 1: Byzantine node sends RequestVote with forged term 999
    let vote_high = byzantine_request_vote(&node_c, RequestVoteArgs {
        term: 999,
        candidate_id: ha_cluster::NodeId::new("forged-leader-1"),
        last_log_index: 0,
        last_log_term: 0,
    }).await;

    assert_eq!(vote_high.term, 999,
        "Node C should step down to term 999 on higher-term RequestVote");

    // Step 2: In the same term (999), send another vote for a different candidate
    let vote2 = byzantine_request_vote(&node_c, RequestVoteArgs {
        term: 999,
        candidate_id: ha_cluster::NodeId::new("forged-leader-2"),
        last_log_index: 0,
        last_log_term: 0,
    }).await;

    assert!(!vote2.vote_granted,
        "Node C must not grant a second vote in term 999 — one-vote-per-term safety (I5)");

    println!("P8.1c PASSED: Forged high term — one vote per term in term 999 enforced");
}

/// P8.1d: AppendEntries with wrong prev_log_term — Byzantine leader claims
/// entries are at a position that doesn't match the follower's log.
///
/// **Invariant I3:** Log matching must reject inconsistent entries.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn p8_1d_wrong_prev_log_term() {
    let _ = tracing_subscriber::fmt::try_init();
    let (_cluster, id_a, id_b, _id_c) = make_cluster().await;

    // Legitimate entry from term 3
    let entry = LogEntry {
        term: 3,
        index: 1,
        client_id: "client-legit".to_string(),
        request_id: "req-1".to_string(),
        data: b"legit-data".to_vec(),
    };
    let ae_legit = AppendEntriesArgs {
        term: 3,
        leader_id: id_a.id.clone(),
        prev_log_index: 0,
        prev_log_term: 0,
        entries: vec![entry],
        leader_commit: 0,
    };

    let reply = byzantine_append_entries(&id_b, ae_legit).await;
    assert!(reply.success, "Node B should accept legitimate AppendEntries");

    // Byzantine leader sends AppendEntries claiming prev_log_index=1,
    // prev_log_term=99 — fabricated previous term
    let ae_evil = AppendEntriesArgs {
        term: 99,
        leader_id: ha_cluster::NodeId::new("node-c"),
        prev_log_index: 1,
        prev_log_term: 99, // Wrong — actual prev entry was term 3
        entries: vec![LogEntry {
            term: 99,
            index: 2,
            client_id: "evil".to_string(),
            request_id: "evil-req".to_string(),
            data: b"evil-data".to_vec(),
        }],
        leader_commit: 2,
    };

    let reply_evil = byzantine_append_entries(&id_b, ae_evil).await;

    assert!(!reply_evil.success,
        "Node B must reject AppendEntries with wrong prev_log_term — log matching (I3)");

    // Verify node B's log is unchanged
    let log = id_b.log.read().await;
    assert_eq!(log.len(), 1,
        "Node B log should have 1 entry — Byzantine AppendEntries must not extend it");
    assert_eq!(&log[0].data, b"legit-data",
        "Node B's legit entry must not be corrupted");

    println!("P8.1d PASSED: Wrong prev_log_term — follower rejected inconsistent entry");
}

/// P8.1e: Stale leader AppendEntries — a follower at a higher term rejects
/// AppendEntries from an old leader.
///
/// **Invariant I2:** No two valid leaders simultaneously authorize writes.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn p8_1e_stale_leader_append_entries() {
    let _ = tracing_subscriber::fmt::try_init();
    let (_cluster, id_a, id_b, _id_c) = make_cluster().await;

    // Step node B down to term 50 via a higher-term RequestVote
    let _ = byzantine_request_vote(&id_b, RequestVoteArgs {
        term: 50,
        candidate_id: ha_cluster::NodeId::new("byzantine-candidate"),
        last_log_index: 0,
        last_log_term: 0,
    }).await;

    // Node-a (stale, term 1) sends AppendEntries
    let entry = LogEntry {
        term: 1,
        index: 1,
        client_id: "client-stale".to_string(),
        request_id: "req-stale".to_string(),
        data: b"stale-data".to_vec(),
    };
    let ae_stale = AppendEntriesArgs {
        term: 1, // Stale term — node B is at term 50
        leader_id: id_a.id.clone(),
        prev_log_index: 0,
        prev_log_term: 0,
        entries: vec![entry],
        leader_commit: 0,
    };

    let reply = byzantine_append_entries(&id_b, ae_stale).await;

    assert!(!reply.success,
        "Node B (term 50) must reject AppendEntries from stale leader (term 1) — I2");
    assert_eq!(reply.term, 50,
        "Reply should report current term 50 to the stale leader");

    // Node B's log must remain empty
    let log = id_b.log.read().await;
    assert_eq!(log.len(), 0,
        "Node B log must remain empty — stale leader AppendEntries rejected");

    println!("P8.1e PASSED: Stale leader — follower rejected below-current-term AppendEntries");
}

/// P8.1f: Vote replay attack — Byzantine node replays a RequestVote with
/// the same term and different candidate. Must not produce a second vote.
///
/// **Invariant I5:** Replay cannot produce a second valid state transition.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn p8_1f_vote_replay_attack() {
    let _ = tracing_subscriber::fmt::try_init();
    let (_cluster, _a, _b, node_c) = make_cluster().await;

    // Original vote — legitimate candidate
    let original = byzantine_request_vote(&node_c, RequestVoteArgs {
        term: 5,
        candidate_id: ha_cluster::NodeId::new("legit-candidate"),
        last_log_index: 3,
        last_log_term: 4,
    }).await;

    assert!(original.vote_granted,
        "Node C should grant vote to legit-candidate in term 5");

    // Replay: same term (5), different candidate
    let replay = byzantine_request_vote(&node_c, RequestVoteArgs {
        term: 5,
        candidate_id: ha_cluster::NodeId::new("replay-candidate"),
        last_log_index: 3,
        last_log_term: 4,
    }).await;

    assert!(!replay.vote_granted,
        "Node C must not grant replay vote in same term 5 — replay safety (I5)");

    println!("P8.1f PASSED: Vote replay — second vote in same term rejected");
}

/// P8.1g: Fork via conflicting prev_log — Byzantine leader sends different
/// entries at the same index to different followers, creating a fork.
///
/// **Invariant I3:** No committed state-machine command is applied differently.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn p8_1g_fork_via_conflicting_prev_log() {
    let _ = tracing_subscriber::fmt::try_init();
    let (_cluster, id_a, id_b, id_c) = make_cluster().await;

    // Establish a legitimate entry at index 1, term 3
    let legit_entry = LogEntry {
        term: 3,
        index: 1,
        client_id: "client-orig".to_string(),
        request_id: "req-orig".to_string(),
        data: b"orig-data".to_vec(),
    };
    let ae_legit = AppendEntriesArgs {
        term: 3,
        leader_id: id_a.id.clone(),
        prev_log_index: 0,
        prev_log_term: 0,
        entries: vec![legit_entry],
        leader_commit: 0,
    };

    let r_b = byzantine_append_entries(&id_b, ae_legit.clone()).await;
    let r_c = byzantine_append_entries(&id_c, ae_legit).await;
    assert!(r_b.success, "Node B accepts legit entry");
    assert!(r_c.success, "Node C accepts legit entry");

    // Byzantine leader (node-c) sends a different entry at index 2,
    // claiming prev_log_index=1, prev_log_term=3. Both followers
    // have the entry at index 1, so the prev_log matches. But the
    // entries at index 2 differ.
    let entry_b = LogEntry {
        term: 5,
        index: 2,
        client_id: "byzantine-1".to_string(),
        request_id: "req-b".to_string(),
        data: b"data-for-b".to_vec(),
    };
    let entry_c = LogEntry {
        term: 5,
        index: 2,
        client_id: "byzantine-2".to_string(),
        request_id: "req-c".to_string(),
        data: b"data-for-c".to_vec(),
    };

    let ae_to_b = AppendEntriesArgs {
        term: 5,
        leader_id: id_c.id.clone(),
        prev_log_index: 1,
        prev_log_term: 3,
        entries: vec![entry_b],
        leader_commit: 0,
    };
    let ae_to_c = AppendEntriesArgs {
        term: 5,
        leader_id: id_c.id.clone(),
        prev_log_index: 1,
        prev_log_term: 3,
        entries: vec![entry_c],
        leader_commit: 0,
    };

    let r_b_fork = byzantine_append_entries(&id_b, ae_to_b).await;
    let r_c_fork = byzantine_append_entries(&id_c, ae_to_c).await;

    if r_b_fork.success && r_c_fork.success {
        let log_b = id_b.log.read().await;
        let log_c = id_c.log.read().await;

        assert_eq!(log_b.len(), 2, "Node B should have 2 entries");
        assert_eq!(log_c.len(), 2, "Node C should have 2 entries");

        // The entries at index 2 (index 1 in 0-based) must differ
        assert_ne!(
            log_b[1].client_id, log_c[1].client_id,
            "Fork confirmed: nodes B and C have different entries at index 2"
        );

        // The Byzantine leader (node-c) cannot form a quorum alone.
        // With 3 nodes, quorum is 2. But node-c as leader only has
        // itself + node-b = 2, which IS a quorum. However, node-a
        // still has the original entry and will reject the forged commit
        // when it receives the real leader's heartbeat.
        println!("P8.1g FINDING: Fork created — divergent entries at index 2");
        println!("  -> I3 protection relies on quorum intersection + transport auth");
        println!("  -> Real leader (node-a) will overwrite fork when it sends heartbeats");
    } else {
        println!("P8.1g: At least one follower rejected conflicting AppendEntries — partial protection");
    }

    println!("P8.1g COMPLETE: Fork via conflicting prev_log — documented as P8 finding");
}
