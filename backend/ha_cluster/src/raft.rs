use crate::{ClusterNode, NodeId};
use audit_ledger::{
    Checkpoint, CheckpointWriter, CommittedCheckpoint, CHECKPOINT_CLIENT_ID, CHECKPOINT_VERSION,
};
use core_crypto::QuantumNodeIdentity;
use futures::future::join_all;
use futures::stream::{FuturesUnordered, StreamExt};
use rand::Rng;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::OpenOptions;
use std::future::Future;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::Arc;
use tokio::sync::RwLock;
use tokio::time::{sleep, Duration, Instant};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LogEntry {
    pub term: u64,
    pub index: u64,
    pub client_id: String,
    pub request_id: String,
    pub data: Vec<u8>, // The serialized LedgerBlock payload or CheckpointCommit
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct RaftPersistentState {
    pub current_term: u64,
    pub voted_for: Option<NodeId>,
    #[serde(default)]
    pub log: Vec<LogEntry>,
    #[serde(default)]
    pub commit_index: u64,
    /// Stable cluster UUID, generated once at bootstrap and persisted.
    /// Identical across all nodes in the cluster. Not derived from peer list.
    #[serde(default)]
    pub cluster_id: String,
    /// Explicit Raft configuration epoch. Incremented only on membership
    /// changes, never on ordinary elections. Initialized to 1 on first
    /// bootstrap.
    #[serde(default = "default_config_epoch")]
    pub config_epoch: u64,
}

/// SEC-002: Integrity envelope for Raft persistent state
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SecureEnvelope {
    pub payload_json: String,
    pub mac: String,
}

fn default_config_epoch() -> u64 {
    1
}

/// Sentinel client_id used for checkpoint-commit Raft log entries.

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RequestVoteArgs {
    pub term: u64,
    pub candidate_id: NodeId,
    pub last_log_index: u64,
    pub last_log_term: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RequestVoteReply {
    pub term: u64,
    pub vote_granted: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AppendEntriesArgs {
    pub term: u64,
    pub leader_id: NodeId,
    pub prev_log_index: u64,
    pub prev_log_term: u64,
    pub entries: Vec<LogEntry>,
    pub leader_commit: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AppendEntriesReply {
    pub term: u64,
    pub success: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub enum RaftRpcType {
    RequestVote,
    AppendEntries,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RaftRpcEnvelope {
    pub version: u16,
    pub rpc_type: RaftRpcType,
    pub sender_id: NodeId,
    pub receiver_id: NodeId,
    pub request_id: String,
    pub payload: Vec<u8>,
}

#[derive(PartialEq, Eq, Clone, Copy, Debug)]
pub enum RaftRole {
    Follower,
    Candidate,
    Leader,
}

const ELECTION_TIMEOUT_MIN: u64 = 150;
const ELECTION_TIMEOUT_MAX: u64 = 300;
const HEARTBEAT_INTERVAL_MS: u64 = 100;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RaftNodeStatus {
    pub node_id: String,
    pub role: String,
    pub current_term: u64,
    pub commit_index: u64,
    pub last_applied: u64,
    pub last_log_index: u64,
    pub last_log_term: u64,
    pub leader_id: Option<String>,
    pub configured_peer_count: usize,
    pub match_index: HashMap<String, u64>,
    pub next_index: HashMap<String, u64>,
    pub timestamp_ms: u64,
    pub cluster_id: String,
    pub config_epoch: u64,
}

/// Raft timing configuration.
///
/// Invariant (verified at creation): heartbeat_interval must be < election_timeout_min
/// so that a healthy leader's heartbeats always reset the election timer before
/// any follower times out.
#[derive(Clone, Debug)]
pub struct RaftConfig {
    pub election_timeout_min_ms: u64,
    pub election_timeout_max_ms: u64,
    pub heartbeat_interval_ms: u64,
    /// If true, log entries are persisted to disk on submit_entry and
    /// handle_append_entries. Needed for crash-recovery tests.
    /// Default false avoids file I/O contention in timing-sensitive tests.
    pub persist_on_submit: bool,
    /// SEC-002: Key used to HMAC the persistent state. If None, state is written without HMAC (legacy/test).
    pub state_machine_mac_key: Option<[u8; 32]>,
}

impl Default for RaftConfig {
    fn default() -> Self {
        Self {
            election_timeout_min_ms: ELECTION_TIMEOUT_MIN,
            election_timeout_max_ms: ELECTION_TIMEOUT_MAX,
            heartbeat_interval_ms: HEARTBEAT_INTERVAL_MS,
            persist_on_submit: true, // SEC-013: Default to true for safety
            state_machine_mac_key: None,
        }
    }
}

impl RaftConfig {
    /// Verify the Raft timing invariant: heartbeat must arrive faster than
    /// the minimum election timeout, otherwise a healthy leader could be
    /// deposed by followers who time out before receiving a heartbeat.
    pub fn validate(&self) -> Result<(), String> {
        if self.heartbeat_interval_ms >= self.election_timeout_min_ms {
            return Err(format!(
                "invariant violated: heartbeat_interval_ms ({}) must be < \
                 election_timeout_min_ms ({})",
                self.heartbeat_interval_ms, self.election_timeout_min_ms
            ));
        }
        if self.election_timeout_min_ms > self.election_timeout_max_ms {
            return Err(format!(
                "invariant violated: election_timeout_min_ms ({}) must be <= \
                 election_timeout_max_ms ({})",
                self.election_timeout_min_ms, self.election_timeout_max_ms
            ));
        }
        Ok(())
    }
}

/// Interface for sending Raft RPCs.
/// Decouples the consensus logic from the network transport.
pub trait RaftRpcClient: Send + Sync {
    fn send_request_vote(
        &self,
        to: NodeId,
        args: RequestVoteArgs,
    ) -> Pin<Box<dyn Future<Output = Result<RequestVoteReply, String>> + Send>>;
    fn send_append_entries(
        &self,
        to: NodeId,
        args: AppendEntriesArgs,
    ) -> Pin<Box<dyn Future<Output = Result<AppendEntriesReply, String>> + Send>>;
}

impl<T: RaftRpcClient + ?Sized> RaftRpcClient for Arc<T> {
    fn send_request_vote(
        &self,
        to: NodeId,
        args: RequestVoteArgs,
    ) -> Pin<Box<dyn Future<Output = Result<RequestVoteReply, String>> + Send>> {
        self.as_ref().send_request_vote(to, args)
    }

    fn send_append_entries(
        &self,
        to: NodeId,
        args: AppendEntriesArgs,
    ) -> Pin<Box<dyn Future<Output = Result<AppendEntriesReply, String>> + Send>> {
        self.as_ref().send_append_entries(to, args)
    }
}

pub struct RaftNode {
    pub id: NodeId,
    pub role: RwLock<RaftRole>,
    pub current_term: Arc<RwLock<u64>>,
    pub voted_for: Arc<RwLock<Option<NodeId>>>,
    pub log: Arc<RwLock<Vec<LogEntry>>>,
    pub commit_index: Arc<RwLock<u64>>,
    pub last_applied: Arc<RwLock<u64>>,
    pub last_heartbeat: Arc<RwLock<Instant>>,
    /// Persistent randomized election deadline. Generated once when entering
    /// Follower/Candidate state; reset by heartbeats or state transitions.
    /// Not regenerated on every run() tick (unlike a per-tick random draw).
    pub election_timeout: Arc<RwLock<Duration>>,
    pub persistence_path: PathBuf,
    pub rpc_client: Arc<dyn RaftRpcClient>,
    pub next_index: Arc<RwLock<HashMap<NodeId, u64>>>,
    pub match_index: Arc<RwLock<HashMap<NodeId, u64>>>,
    pub config: RaftConfig,
    /// Stable cluster UUID generated once at bootstrap, persisted, and
    /// identical across all nodes in the cluster. Not derived from the peer list.
    pub cluster_id: Arc<RwLock<String>>,
    /// Explicit configuration epoch. Incremented only on membership changes.
    /// Initialized to 1 on first bootstrap. Persisted across restarts.
    pub config_epoch: Arc<RwLock<u64>>,
}

impl RaftNode {
    pub fn new(id: NodeId, persistence_path: PathBuf, rpc_client: Arc<dyn RaftRpcClient>) -> Self {
        Self::with_config(id, persistence_path, rpc_client, RaftConfig::default())
    }

    pub fn with_config(
        id: NodeId,
        persistence_path: PathBuf,
        rpc_client: Arc<dyn RaftRpcClient>,
        config: RaftConfig,
    ) -> Self {
        config
            .validate()
            .expect("invalid RaftConfig: timing invariant violated");
        let state =
            Self::load_persistent_state(&persistence_path, config.state_machine_mac_key.as_ref())
                .unwrap_or(RaftPersistentState {
                    current_term: 0,
                    voted_for: None,
                    log: Vec::new(),
                    commit_index: 0,
                    cluster_id: String::new(),
                    config_epoch: 1,
                });

        // Bootstrap cluster_id: use env var if provided, or persisted value.
        // If neither exists (first bootstrap), generate a new UUID.
        // The cluster_id must be identical across all nodes — operators should
        // set VARDHAN_CLUSTER_ID consistently. If not set and no persisted state,
        // a per-node UUID is generated (operator should configure after bootstrap).
        let cluster_id = if let Ok(env_id) = std::env::var("VARDHAN_CLUSTER_ID") {
            env_id
        } else if !state.cluster_id.is_empty() {
            state.cluster_id.clone()
        } else {
            // First bootstrap — generate a stable UUID for this node.
            // In a multi-node cluster, operators should set VARDHAN_CLUSTER_ID
            // on all nodes to ensure identity consistency.
            uuid::Uuid::new_v4().to_string()
        };

        // config_epoch: use persisted value, or 1 if not yet persisted.
        let config_epoch = if state.config_epoch > 0 {
            state.config_epoch
        } else {
            1
        };

        let election_timeout = {
            let mut rng = rand::thread_rng();
            Duration::from_millis(
                rng.gen_range(config.election_timeout_min_ms..config.election_timeout_max_ms),
            )
        };

        let persisted_commit = state.commit_index;

        Self {
            id,
            role: RwLock::new(RaftRole::Follower),
            current_term: Arc::new(RwLock::new(state.current_term)),
            voted_for: Arc::new(RwLock::new(state.voted_for)),
            log: Arc::new(RwLock::new(state.log)),
            commit_index: Arc::new(RwLock::new(persisted_commit)),
            last_applied: Arc::new(RwLock::new(persisted_commit)),
            last_heartbeat: Arc::new(RwLock::new(Instant::now())),
            election_timeout: Arc::new(RwLock::new(election_timeout)),
            next_index: Arc::new(RwLock::new(HashMap::new())),
            match_index: Arc::new(RwLock::new(HashMap::new())),
            persistence_path,
            rpc_client,
            config,
            cluster_id: Arc::new(RwLock::new(cluster_id)),
            config_epoch: Arc::new(RwLock::new(config_epoch)),
            // Mark that the log was pre-loaded from disk so the leader
            // initialises next_index correctly for the recovered log.
        }
    }

    fn load_persistent_state(
        path: &PathBuf,
        mac_key: Option<&[u8; 32]>,
    ) -> Option<RaftPersistentState> {
        let mut file = match OpenOptions::new().read(true).open(path) {
            Ok(f) => f,
            Err(e) => {
                if e.kind() != std::io::ErrorKind::NotFound {
                    tracing::warn!(path = %path.display(), err = %e, "Failed to open persistent Raft state file");
                }
                return None;
            }
        };
        let mut buf = Vec::new();
        if let Err(e) = file.read_to_end(&mut buf) {
            tracing::warn!(path = %path.display(), err = %e, "Failed to read persistent Raft state file");
            return None;
        }

        // SEC-002: Try to parse as SecureEnvelope first
        if let Ok(env) = serde_json::from_slice::<SecureEnvelope>(&buf) {
            if let Some(key) = mac_key {
                let expected_mac = blake3::keyed_hash(key, env.payload_json.as_bytes());
                if expected_mac.to_hex().as_str() != env.mac {
                    tracing::error!(path = %path.display(), "SEC-002 VIOLATION: Raft state file MAC mismatch! Tampering detected.");
                    // Fail closed - do not load
                    panic!("FATAL: Raft state file integrity check failed (MAC mismatch). Node refusing to start.");
                }
            }

            match serde_json::from_str::<RaftPersistentState>(&env.payload_json) {
                Ok(state) => {
                    tracing::info!(
                        path = %path.display(),
                        term = state.current_term,
                        commit_index = state.commit_index,
                        log_len = state.log.len(),
                        "Loaded MAC-protected persistent Raft state from disk"
                    );
                    return Some(state);
                }
                Err(e) => {
                    tracing::error!(path = %path.display(), err = %e, "Failed to parse inner state from SecureEnvelope");
                    return None;
                }
            }
        }

        // Fallback for legacy plaintext state
        if mac_key.is_some() {
            tracing::error!(path = %path.display(), "SEC-002 VIOLATION: Expected SecureEnvelope but found plaintext Raft state.");
            panic!("FATAL: Raft state file must be MAC-protected when state_machine_mac_key is configured. Node refusing to start.");
        }

        match serde_json::from_slice::<RaftPersistentState>(&buf) {
            Ok(state) => {
                tracing::info!(
                    path = %path.display(),
                    term = state.current_term,
                    commit_index = state.commit_index,
                    log_len = state.log.len(),
                    "Loaded legacy unencrypted persistent Raft state from disk"
                );
                Some(state)
            }
            Err(e) => {
                tracing::warn!(path = %path.display(), err = %e, "Failed to parse persistent Raft state JSON");
                None
            }
        }
    }

    pub async fn persist_state(&self) -> std::io::Result<()> {
        let term = *self.current_term.read().await;
        let voted_for = self.voted_for.read().await.clone();
        let log_clone = self.log.read().await.clone();
        let commit_index = *self.commit_index.read().await;
        let cluster_id = self.cluster_id.read().await.clone();
        let config_epoch = *self.config_epoch.read().await;
        self.persist_state_with(
            term,
            voted_for,
            log_clone,
            commit_index,
            cluster_id,
            config_epoch,
        )
        .await
    }

    /// Persist Raft state with explicit values. Used when the caller already
    /// holds write locks and must avoid re-entrant lock acquisition.
    ///
    /// Durability contract:
    /// 1. Serialize state to canonical JSON bytes.
    /// 2. Write to unique temporary file in the same directory.
    /// 3. Explicit flush + sync_all (fsync) on temporary file descriptor.
    /// 4. Atomic rename temporary file over target persistent state file.
    /// 5. Explicit sync_all (fsync) on parent directory to ensure directory entry durability.
    async fn persist_state_with(
        &self,
        term: u64,
        voted_for: Option<NodeId>,
        log: Vec<LogEntry>,
        commit_index: u64,
        cluster_id: String,
        config_epoch: u64,
    ) -> std::io::Result<()> {
        let log_len = log.len();
        let last_log_index = log.last().map(|e| e.index).unwrap_or(0);
        let last_log_term = log.last().map(|e| e.term).unwrap_or(0);
        let start_time = std::time::Instant::now();

        let state = RaftPersistentState {
            current_term: term,
            voted_for,
            log,
            commit_index,
            cluster_id,
            config_epoch,
        };

        let bytes = if let Some(key) = &self.config.state_machine_mac_key {
            let payload_json = serde_json::to_string_pretty(&state)
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
            let mac = blake3::keyed_hash(key, payload_json.as_bytes());
            let env = SecureEnvelope {
                payload_json,
                mac: mac.to_hex().to_string(),
            };
            serde_json::to_vec_pretty(&env)
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?
        } else {
            serde_json::to_vec_pretty(&state)
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?
        };

        let tmp_path = self
            .persistence_path
            .with_extension(format!("tmp.{}", uuid::Uuid::new_v4()));

        // 1. Write and sync temporary file
        {
            use tokio::io::AsyncWriteExt;
            let mut file = tokio::fs::OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(true)
                .open(&tmp_path)
                .await?;
            file.write_all(&bytes).await?;
            file.flush().await?;
            // Ensure data & inode metadata are durably committed to storage
            file.sync_all().await?;
        }

        // 2. Atomic rename over destination
        tokio::fs::rename(&tmp_path, &self.persistence_path).await?;

        // 3. Fsync parent directory to ensure directory entry creation is durable
        if let Some(parent) = self.persistence_path.parent() {
            if let Ok(dir) = tokio::fs::File::open(parent).await {
                let _ = dir.sync_all().await;
            }
        }

        let elapsed = start_time.elapsed();
        tracing::info!(
            node_id = %self.id,
            term = term,
            commit_index = commit_index,
            log_len = log_len,
            last_log_index = last_log_index,
            last_log_term = last_log_term,
            path = %self.persistence_path.display(),
            elapsed_us = elapsed.as_micros(),
            "Durable Raft state synchronization complete (write+flush+sync+rename+dir_sync)"
        );

        Ok(())
    }

    pub async fn update_term(&self, new_term: u64) {
        {
            let mut term = self.current_term.write().await;
            *term = new_term;
            let mut voted = self.voted_for.write().await;
            *voted = None;
        }
        // Persist after releasing write locks (persist_state reads them).
        let _ = self.persist_state().await;
    }

    /// P3.8 STEP 2: Submit a log entry as leader. Returns index of the appended entry.
    pub async fn submit_entry(&self, entry: LogEntry) -> Result<u64, String> {
        {
            let role = *self.role.read().await;
            if role != RaftRole::Leader {
                return Err("Node is not the leader".to_string());
            }
        }
        let mut log = self.log.write().await;
        let index = (log.len() as u64) + 1;
        log.push(entry);
        // Persist for crash recovery when persist_on_submit is enabled.
        // This is safe to .await because submit_entry is called from test
        // code / admin API, NOT from the heartbeat run loop.
        // The await ensures the persist file is written before the test
        // reads it, and prevents the advance_commit_index persist from
        // being overwritten by a late submit_entry persist.
        if self.config.persist_on_submit {
            let term = *self.current_term.read().await;
            let voted_for = self.voted_for.read().await.clone();
            let log_clone = log.clone();
            let commit_idx = *self.commit_index.read().await;
            let cluster_id = self.cluster_id.read().await.clone();
            let config_epoch = *self.config_epoch.read().await;
            drop(log);
            let _ = self
                .persist_state_with(
                    term,
                    voted_for,
                    log_clone,
                    commit_idx,
                    cluster_id,
                    config_epoch,
                )
                .await;
        } else {
            drop(log);
        }
        Ok(index)
    }

    /// P3.8 STEP 2: Initialize leader state (next_index, match_index) after winning election.
    pub async fn init_leader_state(&self, peers: &[NodeId]) {
        let log_len = {
            let log = self.log.read().await;
            log.len() as u64
        };
        let mut next_idx = self.next_index.write().await;
        let mut match_idx = self.match_index.write().await;
        for peer in peers {
            if peer != &self.id {
                next_idx.insert(peer.clone(), log_len + 1);
                match_idx.insert(peer.clone(), 0);
            }
        }
    }

    /// P7.1: Lightweight leadership check for write-path fencing.
    /// Returns true if this node currently believes it is the Leader.
    pub async fn is_leader(&self) -> bool {
        let role = *self.role.read().await;
        let term = *self.current_term.read().await;
        role == RaftRole::Leader && term > 0
    }

    /// P7.1: Current Raft role snapshot (for redirect responses).
    pub async fn role_snapshot(&self) -> RaftRole {
        *self.role.read().await
    }

    /// Read-only snapshot of Raft node state for the admin API.
    /// Acquires read locks on all fields and returns a consistent snapshot.
    /// Does NOT expose private keys, KMS secrets, or cryptographic material.
    pub async fn raft_status(&self, peers: &[NodeId]) -> RaftNodeStatus {
        let role = *self.role.read().await;
        let current_term = *self.current_term.read().await;
        let commit_index = *self.commit_index.read().await;
        let last_applied = *self.last_applied.read().await;
        let log = self.log.read().await;
        let last_log_index = log.len() as u64;
        let last_log_term = if last_log_index > 0 {
            log[(last_log_index - 1) as usize].term
        } else {
            0
        };
        let match_index = self.match_index.read().await.clone();
        let next_index = self.next_index.read().await.clone();
        let cluster_id = self.cluster_id.read().await.clone();
        let config_epoch = *self.config_epoch.read().await;

        drop(log);

        let leader_id = if role == RaftRole::Leader {
            Some(self.id.as_str().to_string())
        } else {
            None
        };

        let match_index_str: HashMap<String, u64> = match_index
            .iter()
            .map(|(k, v)| (k.as_str().to_string(), *v))
            .collect();
        let next_index_str: HashMap<String, u64> = next_index
            .iter()
            .map(|(k, v)| (k.as_str().to_string(), *v))
            .collect();

        RaftNodeStatus {
            node_id: self.id.as_str().to_string(),
            role: match role {
                RaftRole::Follower => "Follower",
                RaftRole::Candidate => "Candidate",
                RaftRole::Leader => "Leader",
            }
            .to_string(),
            current_term,
            commit_index,
            last_applied,
            last_log_index,
            last_log_term,
            leader_id,
            configured_peer_count: peers.len(),
            match_index: match_index_str,
            next_index: next_index_str,
            timestamp_ms: crate::epoch_ms(),
            cluster_id,
            config_epoch,
        }
    }

    /// P7.3: Snapshot of Raft state needed for checkpoint generation.
    /// Returns cluster_id, config_epoch, current_term, and the current log length
    /// (which becomes raft_log_index in the checkpoint).
    pub async fn checkpoint_context(&self) -> (String, u64, u64, u64) {
        let cluster_id = self.cluster_id.read().await.clone();
        let config_epoch = *self.config_epoch.read().await;
        let current_term = *self.current_term.read().await;
        let log = self.log.read().await;
        let log_index = log.len() as u64;
        drop(log);
        (cluster_id, config_epoch, current_term, log_index)
    }

    /// P7.3: Increment config_epoch (for membership changes only).
    /// Ordinary elections do NOT call this.
    pub async fn increment_config_epoch(&self) -> u64 {
        let mut epoch = self.config_epoch.write().await;
        *epoch += 1;
        *epoch
    }

    pub async fn handle_request_vote(&self, args: RequestVoteArgs) -> RequestVoteReply {
        let reply_term;
        let mut vote_granted = false;
        let mut stepped_down = false;
        let mut vote_changed = false;

        {
            let mut term = self.current_term.write().await;
            let mut voted_for = self.voted_for.write().await;

            if args.term > *term {
                *term = args.term;
                *voted_for = None;
                stepped_down = true;
            }

            reply_term = *term;
            if args.term == *term
                && (voted_for.is_none() || voted_for.as_ref() == Some(&args.candidate_id))
            {
                let log = self.log.read().await;
                let last_idx = log.len() as u64;
                let last_term = log.last().map(|e| e.term).unwrap_or(0);

                if args.last_log_term > last_term
                    || (args.last_log_term == last_term && args.last_log_index >= last_idx)
                {
                    vote_granted = true;
                    *voted_for = Some(args.candidate_id.clone());
                    vote_changed = true;
                }
            }
            // term + voted_for write locks released here
        }

        // Raft: if RPC term > currentTerm, convert to follower (step down).
        if stepped_down {
            let mut role_lock = self.role.write().await;
            if *role_lock != RaftRole::Follower {
                *role_lock = RaftRole::Follower;
            }
        }

        // Persist after releasing write locks (persist_state reads them).
        // Call whenever term or voted_for changed — not just on step-down.
        if stepped_down || vote_changed {
            let _ = self.persist_state().await;
        }
        // Reset election timer (heartbeat-like behavior on valid vote)
        self.reset_election_timer().await;

        RequestVoteReply {
            term: reply_term,
            vote_granted,
        }
    }

    pub async fn handle_append_entries(&self, args: AppendEntriesArgs) -> AppendEntriesReply {
        let mut reply_term;
        let mut stepped_down = false;
        {
            let mut term = self.current_term.write().await;
            reply_term = *term;

            if args.term < *term {
                return AppendEntriesReply {
                    term: reply_term,
                    success: false,
                };
            }

            if args.term > *term {
                *term = args.term;
                reply_term = args.term; // Report updated term to leader
                let mut voted = self.voted_for.write().await;
                *voted = None;
                stepped_down = true;
            }
            // persist_state must run after write locks are released
        }

        // Reset heartbeat timer on valid AppendEntries
        self.reset_election_timer().await;

        // Raft: if AppendEntries term > currentTerm, convert to follower (step down).
        if stepped_down {
            let mut role_lock = self.role.write().await;
            if *role_lock != RaftRole::Follower {
                *role_lock = RaftRole::Follower;
            }
            let _ = self.persist_state().await;
        }

        let mut log = self.log.write().await;

        if args.prev_log_index > 0 {
            if args.prev_log_index as usize > log.len()
                || (log.len() > 0
                    && log[(args.prev_log_index - 1) as usize].term != args.prev_log_term)
            {
                return AppendEntriesReply {
                    term: reply_term,
                    success: false,
                };
            }
        }

        let needs_persist;
        if !args.entries.is_empty() {
            // Raft log matching: entries must be inserted starting at prev_log_index
            // (which is the count of entries the follower already has that are confirmed).
            let prev_idx = args.prev_log_index as usize;

            // Truncate any conflicting entries from prev_idx onwards.
            // The leader is the authority on log contents; any entries beyond
            // prev_idx that the leader doesn't know about are from a discarded
            // leader and must be removed.
            log.truncate(prev_idx);

            // Append the new entries.
            log.extend(args.entries.clone());
            needs_persist = true;
        } else {
            needs_persist = false;
        }

        // Capture values needed for persistence, then release log write lock.
        let commit_idx_val = std::cmp::min(args.leader_commit, log.len() as u64);
        let log_len_after = log.len();
        let term_for_persist = *self.current_term.read().await;
        let voted_for_for_persist = self.voted_for.read().await.clone();
        let log_clone = log.clone();
        drop(log);

        if needs_persist {
            if let Err(e) = self
                .persist_state_with(
                    term_for_persist,
                    voted_for_for_persist,
                    log_clone,
                    commit_idx_val,
                    self.cluster_id.read().await.clone(),
                    *self.config_epoch.read().await,
                )
                .await
            {
                tracing::error!(
                    node_id = %self.id,
                    err = %e,
                    "Failed to durably persist AppendEntries log mutation, rejecting RPC"
                );
                return AppendEntriesReply {
                    term: reply_term,
                    success: false,
                };
            }
        }

        let mut commit_idx = self.commit_index.write().await;
        *commit_idx = commit_idx_val;

        AppendEntriesReply {
            term: reply_term,
            success: true,
        }
    }

    pub async fn start_election(&self, peers: &[NodeId]) -> Result<bool, String> {
        info!(node_id = %self.id, "DEBUG_START_ELECTION_ENTERED");

        // Phase 1: Atomically bump term, record self-vote, and persist.
        // Locks MUST be released before calling persist_state() — persist_state
        // reads the same locks, and tokio::RwLock is NOT reentrant.
        let cur_term;
        {
            info!(node_id = %self.id, "DEBUG_BEFORE_TERM_WRITE");
            let mut term = self.current_term.write().await;
            *term += 1;
            cur_term = *term;
            info!(node_id = %self.id, "DEBUG_AFTER_TERM_WRITE term={}", cur_term);

            info!(node_id = %self.id, "DEBUG_BEFORE_VOTED_FOR_WRITE");
            let mut voted = self.voted_for.write().await;
            *voted = Some(self.id.clone());
            info!(node_id = %self.id, "DEBUG_AFTER_VOTED_FOR_WRITE");

            info!(node_id = %self.id, "DEBUG_BEFORE_ROLE_WRITE");
            let mut role_lock = self.role.write().await;
            *role_lock = RaftRole::Candidate;
            info!(node_id = %self.id, "DEBUG_AFTER_ROLE_WRITE");
        } // ← all write locks (term, voted_for, role) released HERE

        // Phase 2: Persist now that all locks are released.
        let _ = self.persist_state().await;

        info!(
            node_id = %self.id,
            term = cur_term,
            "ELECTION_START"
        );

        let last_idx;
        let last_term;
        {
            let log = self.log.read().await;
            last_idx = log.len() as u64;
            last_term = log.last().map(|e| e.term).unwrap_or(0);
        }

        let args = RequestVoteArgs {
            term: cur_term,
            candidate_id: self.id.clone(),
            last_log_index: last_idx,
            last_log_term: last_term,
        };

        info!(candidate_id = %self.id, "DEBUG_BEFORE_REQUEST_VOTE_LOOP");

        // Dispatch all RequestVote RPCs concurrently via FuturesUnordered.
        // As soon as a majority is reached, short-circuit immediately without
        // blocking on slow or crashed peers. (Raft §5.2)
        let mut rpc_futures: FuturesUnordered<_> = peers
            .iter()
            .map(|peer| {
                let client = self.rpc_client.clone();
                let peer_id = peer.clone();
                let rpc_args = args.clone();
                info!(
                    candidate_id = %self.id,
                    term = rpc_args.term,
                    target_id = %peer_id,
                    last_log_index = last_idx,
                    last_log_term = last_term,
                    "REQUEST_VOTE_SENT"
                );
                let fut = Box::pin(async move {
                    let reply = client.send_request_vote(peer_id.clone(), rpc_args).await;
                    (peer_id, reply)
                });
                fut as Pin<
                    Box<dyn Future<Output = (NodeId, Result<RequestVoteReply, String>)> + Send>,
                >
            })
            .collect();

        let mut votes = 1; // self
        let mut should_step_down = false;
        let mut max_reply_term = cur_term;
        let needed_votes = (peers.len() + 1) / 2 + 1;

        while let Some((peer, result)) = rpc_futures.next().await {
            if let Ok(reply) = result {
                info!(
                    candidate_id = %self.id,
                    voter_id = %peer,
                    term = reply.term,
                    vote_granted = reply.vote_granted,
                    "REQUEST_VOTE_RESPONSE_RECEIVED"
                );
                if reply.term > cur_term {
                    should_step_down = true;
                    if reply.term > max_reply_term {
                        max_reply_term = reply.term;
                    }
                    break;
                }
                // Only count votes if not seeing a higher term
                if reply.vote_granted && !should_step_down {
                    votes += 1;
                    if votes >= needed_votes {
                        info!(
                            candidate_id = %self.id,
                            votes = votes,
                            needed = needed_votes,
                            "Quorum achieved early; short-circuiting RequestVote RPCs"
                        );
                        break;
                    }
                }
            } else {
                info!(
                    candidate_id = %self.id,
                    voter_id = %peer,
                    "REQUEST_VOTE_RESPONSE_FAILED"
                );
            }
        }

        info!(
            candidate_id = %self.id,
            term = args.term,
            votes = votes,
            "VOTE_COUNT"
        );

        // Higher-term reply: step down, do not become Leader.
        if should_step_down {
            self.update_term(max_reply_term).await;
            let mut role_lock = self.role.write().await;
            *role_lock = RaftRole::Follower;
            self.reset_election_timer().await;
            info!(node_id = %self.id, "Stepped down to Follower (higher-term vote reply)");
            return Ok(false);
        }

        if votes >= (peers.len() + 1) / 2 + 1 {
            // SAFETY: Re-check term and role atomically under write locks
            // before transitioning to Leader. Between the async join_all()
            // and here, a concurrent handle_request_vote or handle_append_entries
            // may have updated current_term (e.g., the other candidate's higher
            // term) or changed our role. If state changed, abort the transition
            // to prevent split-brain.
            {
                let mut term_guard = self.current_term.write().await;
                let mut role_guard = self.role.write().await;
                if *term_guard != cur_term || *role_guard != RaftRole::Candidate {
                    drop(term_guard);
                    drop(role_guard);
                    info!(node_id = %self.id, cur_term = cur_term, "Aborting Leader transition - state changed during async RPC");
                    return Ok(false);
                }
                *role_guard = RaftRole::Leader;
                drop(term_guard);
                drop(role_guard);
            }
            self.init_leader_state(peers).await;
            info!(node_id = %self.id, term = cur_term, "LEADER_TRANSITION");
            Ok(true)
        } else {
            Ok(false)
        }
    }

    pub async fn advance_commit_index(&self, match_indices: &HashMap<NodeId, u64>) -> bool {
        let mut commit_idx = self.commit_index.write().await;
        let term = *self.current_term.read().await;
        let log = self.log.read().await;

        let mut possible_commits: Vec<u64> = match_indices.values().cloned().collect();
        possible_commits.push(log.len() as u64);
        possible_commits.sort_by(|a, b| b.cmp(a));

        let quorum = (match_indices.len() + 1) / 2 + 1;
        if let Some(&n) = possible_commits.get(quorum - 1) {
            if n > *commit_idx && n > 0 && log[(n - 1) as usize].term == term {
                if self.config.persist_on_submit {
                    let voted_for = self.voted_for.read().await.clone();
                    let log_clone = log.clone();
                    let cluster_id = self.cluster_id.read().await.clone();
                    let config_epoch = *self.config_epoch.read().await;
                    let _ = self
                        .persist_state_with(term, voted_for, log_clone, n, cluster_id, config_epoch)
                        .await;
                }
                *commit_idx = n;
                drop(commit_idx);
                drop(log);
                return true;
            }
        }
        false
    }

    /// Generate a fresh randomized election timeout based on config.
    fn random_election_timeout(&self) -> Duration {
        let cfg = &self.config;
        let millis =
            rand::thread_rng().gen_range(cfg.election_timeout_min_ms..cfg.election_timeout_max_ms);
        Duration::from_millis(millis)
    }

    /// Reset the election deadline to a new random value.
    /// Called on state transitions (Follower/Candidate) and resets last_heartbeat.
    pub async fn reset_election_timer(&self) {
        let new_timeout = self.random_election_timeout();
        {
            let mut et = self.election_timeout.write().await;
            *et = new_timeout;
        }
        *self.last_heartbeat.write().await = Instant::now();
    }

    /// Check whether the election deadline has elapsed.
    async fn election_timer_expired(&self) -> bool {
        let last_hb = *self.last_heartbeat.read().await;
        let timeout = *self.election_timeout.read().await;
        last_hb.elapsed() >= timeout
    }

    pub async fn run(&self, peers: Vec<NodeId>) {
        info!(node_id = %self.id, "Raft run loop starting");
        let heartbeat = self.config.heartbeat_interval_ms;
        let mut ticker = tokio::time::interval(Duration::from_millis(heartbeat));
        loop {
            ticker.tick().await;
            let role = *self.role.read().await;
            match role {
                RaftRole::Follower | RaftRole::Candidate => {
                    if self.election_timer_expired().await {
                        info!(node_id = %self.id, "Election timeout reached, starting election");

                        // Transition to Candidate
                        {
                            let mut role_lock = self.role.write().await;
                            *role_lock = RaftRole::Candidate;
                        }
                        // Reset election timer for the new term
                        self.reset_election_timer().await;

                        // Start election
                        let peer_ids: Vec<NodeId> =
                            peers.iter().filter(|&p| p != &self.id).cloned().collect();

                        info!(node_id = %self.id, "DEBUG_BEFORE_START_ELECTION_CALL");
                        if let Ok(true) = self.start_election(&peer_ids).await {
                            // Role transition (Candidate -> Leader) is done
                            // atomically inside start_election under write locks
                            // with a re-check of current_term and role. This
                            // prevents split-brain if a higher-term RPC arrived
                            // during the async vote-counting phase.
                            info!(node_id = %self.id, "Won election, now Leader");
                        } else {
                            info!(node_id = %self.id, "DEBUG_AFTER_START_ELECTION_CALL won=false");
                            info!(node_id = %self.id, "Failed to win election, returning to follower");
                            let mut role_lock = self.role.write().await;
                            *role_lock = RaftRole::Follower;
                            // Reset election timer for the new follower term state
                            self.reset_election_timer().await;
                        }
                    }
                }
                RaftRole::Leader => {
                    // Initialize leader state on first transition to Leader.
                    let needs_init = {
                        let ni = self.next_index.read().await;
                        ni.len() < peers.len().saturating_sub(1) && peers.len() > 1
                    };
                    if needs_init {
                        let peer_ids: Vec<NodeId> =
                            peers.iter().filter(|&p| p != &self.id).cloned().collect();
                        self.init_leader_state(&peer_ids).await;
                        info!(node_id = %self.id, "Leader state initialized (next_index/match_index)");
                    }

                    // Phase 1: Build AppendEntries args for each peer from the
                    // leader's log, using per-peer next_index.
                    let cur_term = *self.current_term.read().await;
                    let commit_idx = *self.commit_index.read().await;
                    let peer_ids: Vec<NodeId> =
                        peers.iter().filter(|&p| p != &self.id).cloned().collect();

                    type AppendReplyFut = Pin<
                        Box<
                            dyn std::future::Future<
                                    Output = (NodeId, Result<AppendEntriesReply, String>, u64, u64),
                                > + Send,
                        >,
                    >;
                    let mut append_futures: Vec<AppendReplyFut> = Vec::new();
                    {
                        let log = self.log.read().await;
                        let next_indices = self.next_index.read().await;

                        for peer in &peer_ids {
                            let next_idx = next_indices.get(peer).copied().unwrap_or(1);
                            let prev_log_index = next_idx.saturating_sub(1);
                            let prev_log_term =
                                if prev_log_index > 0 && (prev_log_index as usize) <= log.len() {
                                    log[(prev_log_index - 1) as usize].term
                                } else {
                                    0
                                };
                            let entries: Vec<LogEntry> = if (next_idx as usize) <= log.len() {
                                log[((next_idx - 1) as usize)..].to_vec()
                            } else {
                                vec![]
                            };
                            let entries_len = entries.len() as u64;

                            let args = AppendEntriesArgs {
                                term: cur_term,
                                leader_id: self.id.clone(),
                                prev_log_index,
                                prev_log_term,
                                entries,
                                leader_commit: commit_idx,
                            };

                            let client = self.rpc_client.clone();
                            let peer_id = peer.clone();
                            append_futures.push(Box::pin(async move {
                                let reply = client.send_append_entries(peer_id.clone(), args).await;
                                (peer_id, reply, prev_log_index, entries_len)
                            }));
                        }
                    } // log + next_index read locks released

                    // Phase 2: Send all AppendEntries concurrently via FuturesUnordered.
                    // This ensures a slow/dead peer's 2s RPC timeout cannot block
                    // the entire heartbeat cycle — fast peers are processed immediately.
                    // (P3.8 Step 3.1 hardening)
                    let mut should_step_down = false;
                    let mut max_reply_term = cur_term;

                    let mut fut_stream =
                        append_futures.into_iter().collect::<FuturesUnordered<_>>();

                    while let Some((peer, result, prev_log_index, entries_len)) =
                        fut_stream.next().await
                    {
                        // Once we detect a higher-term reply, stop processing
                        // further replies to prevent stale replies from
                        // mutating leader state (match_index/next_index).
                        if should_step_down {
                            warn!(
                                node_id = %self.id,
                                peer = %peer,
                                "Skipping stale AppendEntries reply after step-down"
                            );
                            continue;
                        }
                        match result {
                            Ok(reply) => {
                                if reply.term > cur_term {
                                    should_step_down = true;
                                    if reply.term > max_reply_term {
                                        max_reply_term = reply.term;
                                    }
                                    warn!(
                                        node_id = %self.id,
                                        peer = %peer,
                                        reply_term = reply.term,
                                        current_term = cur_term,
                                        "Leader stepping down: higher-term AppendEntries reply"
                                    );
                                    // Don't process this reply's success/failure —
                                    // we're stepping down, leader state is invalid.
                                    continue;
                                }
                                if reply.success {
                                    // matchIndex[n] = max(matchIndex[n], prevLogIndex + len(entries))
                                    let new_match = prev_log_index + entries_len;
                                    let mut match_map = self.match_index.write().await;
                                    let cur_match = match_map.get(&peer).copied().unwrap_or(0);
                                    if new_match > cur_match {
                                        match_map.insert(peer.clone(), new_match);
                                    }
                                    drop(match_map);
                                    // nextIndex[n] = matchIndex[n] + 1
                                    let mut next_map = self.next_index.write().await;
                                    let new_next = new_match + 1;
                                    let cur_next = next_map.get(&peer).copied().unwrap_or(1);
                                    if new_next > cur_next {
                                        next_map.insert(peer.clone(), new_next);
                                    }
                                } else {
                                    // Failed append: decrement nextIndex and retry on next tick
                                    let mut next_map = self.next_index.write().await;
                                    let cur_next = next_map.get(&peer).copied().unwrap_or(1);
                                    if cur_next > 1 {
                                        next_map.insert(peer.clone(), cur_next - 1);
                                    }
                                    warn!(
                                        node_id = %self.id,
                                        peer = %peer,
                                        prev_log_index = prev_log_index,
                                        "AppendEntries rejected by follower, backtracking nextIndex"
                                    );
                                }
                            }
                            Err(e) => {
                                warn!(
                                    node_id = %self.id,
                                    peer = %peer,
                                    err = %e,
                                    "AppendEntries RPC failed, will retry next tick"
                                );
                            }
                        }
                    }

                    // Step down if any reply carried a higher term.
                    if should_step_down {
                        self.update_term(max_reply_term).await;
                        let mut role_lock = self.role.write().await;
                        *role_lock = RaftRole::Follower;
                        self.reset_election_timer().await;
                        info!(
                            node_id = %self.id,
                            step_down_term = max_reply_term,
                            "Stepped down to Follower (higher-term AppendEntries reply)"
                        );
                        // Do NOT advance commit_index or process further — leader state is invalid.
                        continue;
                    }

                    // Phase 3: Advance commit index based on match_index quorum.
                    {
                        let match_clone: HashMap<NodeId, u64> =
                            self.match_index.read().await.clone();
                        let advanced = self.advance_commit_index(&match_clone).await;
                        if advanced && self.config.persist_on_submit {
                            let _ = self.persist_state().await;
                        }
                    }
                }
            }
        }
    }
}

pub struct LedgerApplier {
    pub raft_node: Arc<RaftNode>,
    pub ledger: Arc<ledger_sync::MerkleLedger>,
    pub identity: Arc<QuantumNodeIdentity>,
    pub checkpoint_writer: Option<Arc<CheckpointWriter>>,
    pub applied_requests: RwLock<HashMap<(String, String), u64>>,
    /// Canonical hashes (LedgerEntry-style) of every regular ledger entry applied,
    /// used for Merkle root computation that pq_verify can independently reconstruct.
    pub merkle_hashes: RwLock<Vec<[u8; 32]>>,
    /// Next ledger sequence number (for canonical hash computation).
    pub ledger_seq: RwLock<u64>,
    /// Previous canonical hash (for chain linkage in canonical hash computation).
    pub ledger_prev_hash: RwLock<[u8; 32]>,
}

impl LedgerApplier {
    pub fn new(
        raft_node: Arc<RaftNode>,
        ledger: Arc<ledger_sync::MerkleLedger>,
        identity: Arc<QuantumNodeIdentity>,
    ) -> Self {
        Self {
            raft_node,
            ledger,
            identity,
            checkpoint_writer: None,
            applied_requests: RwLock::new(HashMap::new()),
            merkle_hashes: RwLock::new(Vec::new()),
            ledger_seq: RwLock::new(0),
            ledger_prev_hash: RwLock::new([0u8; 32]),
        }
    }

    /// Set the checkpoint writer (for persisting committed checkpoints).
    pub fn with_checkpoint_writer(mut self, writer: Arc<CheckpointWriter>) -> Self {
        self.checkpoint_writer = Some(writer);
        self
    }

    /// Compute the Merkle root over a range of ledger entries' canonical hashes.
    /// `start_seq` is 0-based, `end_seq` is inclusive.
    pub async fn merkle_root_for_range(&self, start_seq: u64, end_seq: u64) -> [u8; 32] {
        let hashes = self.merkle_hashes.read().await;
        let start = start_seq as usize;
        let end = (end_seq as usize).min(hashes.len().saturating_sub(1));
        if start > end || hashes.is_empty() {
            return [0u8; 32];
        }
        let range_hashes: Vec<Vec<u8>> = hashes[start..=end].iter().map(|h| h.to_vec()).collect();
        audit_ledger::merkle_root_from_hashes(&range_hashes)
    }

    pub async fn apply_committed_entries(&self) -> Result<(), String> {
        loop {
            // Phase 1: Read what needs to be applied and clone entry data.
            // Acquire last_applied as READ lock so the run loop can still
            // update commit_index. We claim the entry by advancing last_applied
            // AFTER processing, not before.
            let (index, client_id, request_id, entry_term, entry_data) = {
                let commit_index = *self.raft_node.commit_index.read().await;
                let last_applied = *self.raft_node.last_applied.read().await;

                if last_applied >= commit_index {
                    break;
                }
                let idx = last_applied + 1;

                let log = self.raft_node.log.read().await;
                if idx as usize > log.len() {
                    break;
                }
                let entry = &log[(idx - 1) as usize];
                (
                    idx,
                    entry.client_id.clone(),
                    entry.request_id.clone(),
                    entry.term,
                    entry.data.clone(),
                )
            }; // all locks released here

            // Idempotency check
            {
                let mut applied = self.applied_requests.write().await;
                if applied.contains_key(&(client_id.clone(), request_id.clone())) {
                    let mut la = self.raft_node.last_applied.write().await;
                    *la = index;
                    drop(applied);
                    drop(la);
                    tokio::task::yield_now().await;
                    continue;
                }
            }

            // P7.3: Handle checkpoint-commit entries (no heavy crypto needed here)
            if client_id == CHECKPOINT_CLIENT_ID {
                let entry = LogEntry {
                    term: entry_term,
                    index: 0,
                    client_id: client_id.clone(),
                    request_id: request_id.clone(),
                    data: entry_data,
                };
                self.apply_checkpoint_entry(&entry, index).await?;
                {
                    let mut applied2 = self.applied_requests.write().await;
                    applied2.insert((client_id, request_id), index);
                    let mut la = self.raft_node.last_applied.write().await;
                    *la = index;
                }
                tokio::task::yield_now().await;
                continue;
            }

            // Regular ledger entry — offload ML-DSA-87 signing + verification
            // to blocking threads so the single-threaded async runtime stays
            // responsive for the Raft run loop (heartbeats, AppendEntries).
            let timestamp_ms = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64;

            let prev_hash = self.ledger.latest_hash().await;
            let seq = {
                let mut s = self.ledger_seq.write().await;
                let v = *s;
                *s += 1;
                v
            };
            let event_json = match serde_json::from_slice::<serde_json::Value>(&entry_data) {
                Ok(v) => serde_json::to_string(&v).unwrap_or_default(),
                Err(_) => String::from_utf8_lossy(&entry_data).to_string(),
            };
            // Use deterministic hash for Merkle tree: BLAKE3(seq || entry_data)
            // This must be identical across all nodes so that the Merkle root
            // in the checkpoint is consistent for apply_checkpoint_entry on
            // followers. The LedgerBlock (with timestamp/signature) is the
            // audit-chain commitment; the Merkle hash is the consensus commitment.
            let canonical = {
                let mut hasher = blake3::Hasher::new();
                hasher.update(&seq.to_le_bytes());
                hasher.update(&entry_data);
                *hasher.finalize().as_bytes()
            };

            // ML-DSA-87 signing in blocking thread
            let identity = self.identity.clone();
            let entry_data_for_block = entry_data.clone();
            let prev_hash_for_block = prev_hash;
            let block = tokio::task::spawn_blocking(move || {
                ledger_sync::LedgerBlock::new(
                    seq, // Use ledger_seq (regular-entry count), not raft_log_index-1
                    timestamp_ms,
                    prev_hash_for_block,
                    [0u8; 32],
                    &entry_data_for_block,
                    &identity,
                )
            })
            .await
            .map_err(|e| format!("spawn_blocking join error (block new): {}", e))?
            .map_err(|e| e.to_string())?;

            // ML-DSA-87 verification in blocking thread
            let pub_key = self.identity.dsa_public_key_bytes().to_vec();
            let block_for_verify = block.clone();
            tokio::task::spawn_blocking(move || block_for_verify.verify(&pub_key))
                .await
                .map_err(|e| format!("spawn_blocking join error (verify): {}", e))?
                .map_err(|e| e.to_string())?;

            // Push to ledger (fast — just lock + push, already verified)
            self.ledger
                .append_verified_block(block)
                .await
                .map_err(|e| e.to_string())?;

            // Update merkle_hashes chain
            {
                let mut hashes = self.merkle_hashes.write().await;
                hashes.push(canonical);
            }
            {
                let mut ph = self.ledger_prev_hash.write().await;
                *ph = canonical;
            }

            {
                let mut applied2 = self.applied_requests.write().await;
                applied2.insert((client_id, request_id), index);
                let mut la = self.raft_node.last_applied.write().await;
                *la = index;
            }

            // Yield to let the Raft run loop process RPCs
            tokio::task::yield_now().await;
        }
        Ok(())
    }

    /// Apply a committed checkpoint entry: persist it to checkpoints.jsonl.
    async fn apply_checkpoint_entry(
        &self,
        entry: &LogEntry,
        raft_log_index: u64,
    ) -> Result<(), String> {
        let cp: Checkpoint = serde_json::from_slice(&entry.data)
            .map_err(|e| format!("Failed to deserialize checkpoint: {e}"))?;

        // P7.2: Re-check leadership — the node that generated this checkpoint
        // may have stepped down. But the checkpoint is Raft-committed, so we
        // accept it regardless of current role (it was committed by the leader).
        // We DON'T need to re-check leadership here — the checkpoint is already
        // committed by Raft quorum. What we verify is structural integrity.

        // P7.3: Signature was verified by the leader during checkpoint generation.
        // Full signature + chain verification is the responsibility of pq_verify.
        // Here we only check that the signer fingerprint is present (structural).
        if cp.signer_pub_fingerprint.is_empty() {
            return Err("Checkpoint signer fingerprint is empty — unsigned checkpoint".to_string());
        }

        // Verify Merkle root matches our local ledger state
        let local_merkle = self
            .merkle_root_for_range(cp.ledger_first_seq, cp.ledger_last_seq)
            .await;
        let stored_merkle =
            hex::decode(&cp.merkle_root).map_err(|e| format!("Invalid merkle_root hex: {e}"))?;
        if local_merkle.as_slice() != stored_merkle.as_slice() {
            return Err(format!(
                "Checkpoint Merkle root mismatch: local={:x?}, checkpoint={:x?}",
                local_merkle, stored_merkle
            ));
        }

        // Verify ledger range is consistent: the local ledger must contain at
        // least up to ledger_last_seq, and entry_count must match (last - first + 1).
        let local_len = self.ledger.len().await as u64;
        let expected_count = cp
            .ledger_last_seq
            .saturating_sub(cp.ledger_first_seq)
            .saturating_add(1);
        if local_len < cp.ledger_last_seq + 1 {
            return Err(format!(
                "Checkpoint ledger range out of bounds: local_len={}, checkpoint_last_seq={}",
                local_len, cp.ledger_last_seq
            ));
        }
        if cp.ledger_entry_count != expected_count {
            return Err(format!(
                "Checkpoint ledger entry_count mismatch: expected={}, got={}",
                expected_count, cp.ledger_entry_count
            ));
        }

        // Build CommittedCheckpoint with Raft commit metadata
        let committed = CommittedCheckpoint {
            checkpoint: cp.clone(),
            raft_commit_term: entry.term.clone(),
            raft_commit_index: raft_log_index,
        };

        // Persist to checkpoints file
        if let Some(ref writer) = self.checkpoint_writer {
            writer
                .append(&committed)
                .map_err(|e| format!("Checkpoint persistence failed: {e}"))?;
        }

        Ok(())
    }

    /// P7.3: Generate and submit a checkpoint as a Raft log entry.
    ///
    /// Only the leader may call this. The checkpoint is signed before submission
    /// and becomes authoritative only after Raft quorum commit.
    ///
    /// ## Dual-trigger logic
    /// - `force`: if true, generate regardless of entry count (time-based trigger)
    /// - `min_new_entries`: if > 0, only generate if ledger has at least this many
    ///   entries since the last checkpoint (entry-count trigger)
    pub async fn generate_and_submit_checkpoint(
        &self,
        min_new_entries: u64,
        force: bool,
    ) -> Result<Option<Checkpoint>, String> {
        // P7.2: Re-check leadership after any setup work
        if !self.raft_node.is_leader().await {
            return Err("Node is not the leader — cannot generate checkpoint".to_string());
        }

        let ledger_len = self.ledger.len().await as u64;

        if ledger_len == 0 {
            return Ok(None);
        }

        // Determine the ledger range for this checkpoint.
        // If a previous checkpoint exists, start after it; otherwise start from 0.
        let (first_seq, _prev_cp_hash) = if let Some(ref writer) = self.checkpoint_writer {
            let (next_cp_index, prev_hash) = writer.chain_tip();
            let last_cp = writer.last_checkpoint_ledger_last_seq();
            // First checkpoint: start from seq 0 (covers entire ledger)
            if next_cp_index == 0 {
                (0, prev_hash)
            } else if last_cp < ledger_len.saturating_sub(1) {
                (last_cp + 1, prev_hash)
            } else {
                (0, prev_hash)
            }
        } else {
            (0, [0u8; 32])
        };

        let last_seq = ledger_len.saturating_sub(1);
        let entry_count = last_seq.saturating_sub(first_seq).saturating_add(1);

        // Entry-count trigger: only generate if we have enough new entries since last checkpoint
        if !force {
            let new_entries = entry_count;
            if new_entries < min_new_entries {
                return Ok(None);
            }
        }

        // Gather checkpoint context from Raft
        let (cluster_id, config_epoch, raft_term, raft_log_index) =
            self.raft_node.checkpoint_context().await;

        // Compute Merkle root over the exact ledger range using LedgerEntry-style
        // canonical hashes (so pq_verify can independently reconstruct it from JSONL)
        let merkle_root = self.merkle_root_for_range(first_seq, last_seq).await;

        // Get previous checkpoint hash
        let prev_checkpoint_hash = if let Some(ref writer) = self.checkpoint_writer {
            writer.chain_tip().1
        } else {
            [0u8; 32]
        };

        let prev_checkpoint_hash_hex = hex::encode(prev_checkpoint_hash);
        let merkle_root_hex = hex::encode(merkle_root);
        let timestamp_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis();

        // Build the checkpoint (signature generated here, before Raft submission)
        let mut cp = Checkpoint {
            version: CHECKPOINT_VERSION,
            cluster_id,
            config_epoch,
            raft_term,
            raft_log_index,
            ledger_first_seq: first_seq,
            ledger_last_seq: last_seq,
            ledger_entry_count: entry_count,
            merkle_root: merkle_root_hex,
            previous_checkpoint_hash: prev_checkpoint_hash_hex,
            timestamp_ms,
            signature: String::new(),
            signer_pub_fingerprint: String::new(),
        };

        // Sign the canonical hash with ML-DSA-87
        // P8-004: signer_pub_fingerprint must be set BEFORE computing the
        // canonical hash, since it is now included in canonical_bytes().
        let pub_key = self.identity.dsa_public_key_bytes();
        let signer_fp = hex::encode(QuantumNodeIdentity::hash_ledger_block(&pub_key));
        cp.signer_pub_fingerprint = signer_fp;

        let canonical = cp
            .canonical_hash()
            .map_err(|e| format!("Checkpoint canonical hash failed: {e}"))?;
        let sig_bytes = self
            .identity
            .sign_payload(&canonical)
            .map_err(|e| format!("ML-DSA-87 signing failed: {e}"))?;

        cp.signature = hex::encode(&sig_bytes);

        // Serialize and submit as Raft log entry
        let data =
            serde_json::to_vec(&cp).map_err(|e| format!("Checkpoint serialization failed: {e}"))?;

        let request_id = format!(
            "checkpoint-{}",
            cp.checkpoint_hash()
                .map_err(|e| format!("Checkpoint hash computation failed: {e}"))
                .map(|h| hex::encode(h))
                .unwrap_or_else(|_| "unknown".to_string())
        );

        let log_entry = LogEntry {
            term: raft_term,
            index: 0, // Will be assigned by submit_entry
            client_id: CHECKPOINT_CLIENT_ID.to_string(),
            request_id,
            data,
        };

        let _index = self.raft_node.submit_entry(log_entry).await?;

        Ok(Some(cp))
    }

    async fn get_prev_hash(&self, _log: &[LogEntry], _index: u64) -> [u8; 32] {
        self.ledger.latest_hash().await
    }
}

/// Mock implementation of RaftRpcClient for unit tests.
pub struct MockRpcClient {
    pub cluster: Arc<RwLock<HashMap<NodeId, Arc<RaftNode>>>>,
}

impl MockRpcClient {
    pub fn new(cluster: Arc<RwLock<HashMap<NodeId, Arc<RaftNode>>>>) -> Self {
        Self { cluster }
    }
}

impl RaftRpcClient for MockRpcClient {
    fn send_request_vote(
        &self,
        to: NodeId,
        args: RequestVoteArgs,
    ) -> Pin<Box<dyn Future<Output = Result<RequestVoteReply, String>> + Send>> {
        let cluster = self.cluster.clone();
        Box::pin(async move {
            let cluster = cluster.read().await;
            let node = cluster
                .get(&to)
                .ok_or_else(|| "Node not found".to_string())?;
            Ok(node.handle_request_vote(args).await)
        })
    }

    fn send_append_entries(
        &self,
        to: NodeId,
        args: AppendEntriesArgs,
    ) -> Pin<Box<dyn Future<Output = Result<AppendEntriesReply, String>> + Send>> {
        let cluster = self.cluster.clone();
        Box::pin(async move {
            let cluster = cluster.read().await;
            let node = cluster
                .get(&to)
                .ok_or_else(|| "Node not found".to_string())?;
            Ok(node.handle_append_entries(args).await)
        })
    }
}
