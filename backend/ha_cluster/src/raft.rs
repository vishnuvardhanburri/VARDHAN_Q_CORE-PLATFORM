use audit_ledger::{
    Checkpoint, CheckpointWriter, CommittedCheckpoint, CHECKPOINT_CLIENT_ID, CHECKPOINT_VERSION,
};
use core_crypto::QuantumNodeIdentity;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};

#[path = "raft_original.rs"]
mod original;

pub use original::{
    AppendEntriesArgs, AppendEntriesReply, LogEntry, MockRpcClient, RaftConfig, RaftNode,
    RaftNodeStatus, RaftPersistentState, RaftRole, RaftRpcClient, RaftRpcEnvelope, RaftRpcType,
    RequestVoteArgs, RequestVoteReply, SecureEnvelope,
};

/// Production LedgerApplier facade.
///
/// The Raft implementation remains in `raft_original.rs`; this facade owns the
/// ledger-application path so committed entries are single-flight. This is
/// required because the background applier and explicit recovery/checkpoint
/// callers can legitimately invoke application concurrently.
pub struct LedgerApplier {
    pub raft_node: Arc<RaftNode>,
    pub ledger: Arc<ledger_sync::MerkleLedger>,
    pub identity: Arc<QuantumNodeIdentity>,
    pub checkpoint_writer: Option<Arc<CheckpointWriter>>,
    pub applied_requests: RwLock<HashMap<(String, String), u64>>,
    pub merkle_hashes: RwLock<Vec<[u8; 32]>>,
    pub ledger_prev_hash: RwLock<[u8; 32]>,
    apply_lock: Mutex<()>,
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
            ledger_prev_hash: RwLock::new([0u8; 32]),
            apply_lock: Mutex::new(()),
        }
    }

    pub fn with_checkpoint_writer(mut self, writer: Arc<CheckpointWriter>) -> Self {
        self.checkpoint_writer = Some(writer);
        self
    }

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
        // Exactly one caller may advance last_applied and append to the ledger
        // at a time. Without this guard, background application and an explicit
        // manual/recovery application can both observe the same last_applied
        // value and allocate competing ledger sequence numbers.
        let _apply_guard = self.apply_lock.lock().await;

        loop {
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
            };

            {
                let applied = self.applied_requests.write().await;
                if applied.contains_key(&(client_id.clone(), request_id.clone())) {
                    let mut la = self.raft_node.last_applied.write().await;
                    *la = index;
                    drop(applied);
                    drop(la);
                    tokio::task::yield_now().await;
                    continue;
                }
            }

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

            let timestamp_ms = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64;

            let prev_hash = self.ledger.latest_hash().await;
            let seq = self.ledger.len().await as u64;
            let canonical = {
                let mut hasher = blake3::Hasher::new();
                hasher.update(&seq.to_le_bytes());
                hasher.update(&entry_data);
                *hasher.finalize().as_bytes()
            };

            let identity = self.identity.clone();
            let entry_data_for_block = entry_data.clone();
            let prev_hash_for_block = prev_hash;
            let block = tokio::task::spawn_blocking(move || {
                ledger_sync::LedgerBlock::new(
                    seq,
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

            let pub_key = self.identity.dsa_public_key_bytes().to_vec();
            let block_for_verify = block.clone();
            tokio::task::spawn_blocking(move || block_for_verify.verify(&pub_key))
                .await
                .map_err(|e| format!("spawn_blocking join error (verify): {}", e))?
                .map_err(|e| e.to_string())?;

            self.ledger
                .append_verified_block(block)
                .await
                .map_err(|e| e.to_string())?;

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

            tokio::task::yield_now().await;
        }
        Ok(())
    }

    async fn apply_checkpoint_entry(
        &self,
        entry: &LogEntry,
        raft_log_index: u64,
    ) -> Result<(), String> {
        let cp: Checkpoint = serde_json::from_slice(&entry.data)
            .map_err(|e| format!("Failed to deserialize checkpoint: {e}"))?;

        if cp.signer_pub_fingerprint.is_empty() {
            return Err("Checkpoint signer fingerprint is empty — unsigned checkpoint".to_string());
        }

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

        let committed = CommittedCheckpoint {
            checkpoint: cp.clone(),
            raft_commit_term: entry.term,
            raft_commit_index: raft_log_index,
        };

        if let Some(ref writer) = self.checkpoint_writer {
            writer
                .append(&committed)
                .map_err(|e| format!("Checkpoint persistence failed: {e}"))?;
        }

        Ok(())
    }

    pub async fn generate_and_submit_checkpoint(
        &self,
        min_new_entries: u64,
        force: bool,
    ) -> Result<Option<Checkpoint>, String> {
        if !self.raft_node.is_leader().await {
            return Err("Node is not the leader — cannot generate checkpoint".to_string());
        }

        let ledger_len = self.ledger.len().await as u64;
        if ledger_len == 0 {
            return Ok(None);
        }

        let (first_seq, _prev_cp_hash) = if let Some(ref writer) = self.checkpoint_writer {
            let (next_cp_index, prev_hash) = writer.chain_tip();
            let last_cp = writer.last_checkpoint_ledger_last_seq();
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
        if !force && entry_count < min_new_entries {
            return Ok(None);
        }

        let (cluster_id, config_epoch, raft_term, raft_log_index) =
            self.raft_node.checkpoint_context().await;
        let merkle_root = self.merkle_root_for_range(first_seq, last_seq).await;
        let prev_checkpoint_hash = if let Some(ref writer) = self.checkpoint_writer {
            writer.chain_tip().1
        } else {
            [0u8; 32]
        };

        let timestamp_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis();

        let mut cp = Checkpoint {
            version: CHECKPOINT_VERSION,
            cluster_id,
            config_epoch,
            raft_term,
            raft_log_index,
            ledger_first_seq: first_seq,
            ledger_last_seq: last_seq,
            ledger_entry_count: entry_count,
            merkle_root: hex::encode(merkle_root),
            previous_checkpoint_hash: hex::encode(prev_checkpoint_hash),
            timestamp_ms,
            signature: String::new(),
            signer_pub_fingerprint: String::new(),
        };

        let pub_key = self.identity.dsa_public_key_bytes();
        cp.signer_pub_fingerprint = hex::encode(QuantumNodeIdentity::hash_ledger_block(&pub_key));
        let canonical = cp
            .canonical_hash()
            .map_err(|e| format!("Checkpoint canonical hash failed: {e}"))?;
        let sig_bytes = self
            .identity
            .sign_payload(&canonical)
            .map_err(|e| format!("ML-DSA-87 signing failed: {e}"))?;
        cp.signature = hex::encode(&sig_bytes);

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
            index: 0,
            client_id: CHECKPOINT_CLIENT_ID.to_string(),
            request_id,
            data,
        };
        let _index = self.raft_node.submit_entry(log_entry).await?;
        Ok(Some(cp))
    }
}
