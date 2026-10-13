//! # audit_ledger
//!
//! Durable, append-only, independently verifiable audit ledger.
//!
//! ## Entry schema (v1)
//!
//! Each entry is a JSON Lines record with fields:
//! - `schema_version`: always 1
//! - `seq`: monotonically increasing u64, starts at 0
//! - `timestamp_ms`: Unix epoch ms
//! - `prev_hash`: hex(BLAKE3(canonical bytes of entry[seq-1])); [0u8;32] for genesis
//! - `event`: the QuantumEvent JSON object
//! - `signature`: hex(ML-DSA-87 sig over canonical bytes)
//! - `signer_pub_fingerprint`: hex(BLAKE3(ML-DSA-87 pub key bytes))
//!
//! ## Canonical bytes (for signing and chain hashing)
//!
//! ```text
//! BLAKE3(
//!   seq as u64 little-endian       [8 bytes]
//!   || timestamp_ms as u64 le      [8 bytes]
//!   || event_json as UTF-8         [variable]
//!   || prev_hash_bytes             [32 bytes]
//! )
//! ```
//! This specification is also emitted in `schema.json` so any language can reproduce it.

pub mod schema;
use core_crypto::QuantumNodeIdentity;
use serde::{Deserialize, Serialize};
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::Path;
use std::sync::Mutex;

#[derive(Debug, thiserror::Error)]
pub enum LedgerError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Serialization error: {0}")]
    Serialization(String),
    #[error("Cryptographic error: {0}")]
    Crypto(String),
    #[error("Lock poisoned")]
    PoisonedLock,
    #[error("System time error: {0}")]
    TimeError(String),
    #[error("Ledger chain broken: {0}")]
    ChainBroken(String),
    #[error("Internal error: {0}")]
    Internal(String),
}

impl From<serde_json::Error> for LedgerError {
    fn from(e: serde_json::Error) -> Self {
        LedgerError::Serialization(e.to_string())
    }
}

impl From<hex::FromHexError> for LedgerError {
    fn from(e: hex::FromHexError) -> Self {
        LedgerError::Crypto(e.to_string())
    }
}

impl From<Box<dyn std::error::Error>> for LedgerError {
    fn from(e: Box<dyn std::error::Error>) -> Self {
        LedgerError::Internal(e.to_string())
    }
}

/// A single entry in the durable audit ledger.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LedgerEntry {
    pub schema_version: u32,
    pub seq: u64,
    pub timestamp_ms: u128,
    /// hex(BLAKE3(canonical bytes of previous entry)); all-zeros hex for genesis (seq=0)
    pub prev_hash: String,
    /// The auditable event payload
    pub event: serde_json::Value,
    /// hex(ML-DSA-87 signature over canonical_hash bytes)
    pub signature: String,
    /// hex(BLAKE3(ML-DSA-87 public key bytes)) — identifies the signing key
    pub signer_pub_fingerprint: String,
}

impl LedgerEntry {
    /// Compute the canonical 32-byte hash of this entry.
    /// This is the value that becomes `prev_hash` of the next entry.
    pub fn canonical_hash(&self) -> Result<[u8; 32], LedgerError> {
        let event_json = serde_json::to_string(&self.event)?;
        let prev_hash_bytes = hex::decode(&self.prev_hash)?;

        Ok(canonical_hash(
            self.seq,
            self.timestamp_ms,
            &event_json,
            &prev_hash_bytes,
        ))
    }
}

/// Compute the canonical BLAKE3 hash used for signing and chain linking.
///
/// Input: `seq_le64 || timestamp_ms_le64 || event_json_utf8 || prev_hash_bytes32`
pub fn canonical_hash(
    seq: u64,
    timestamp_ms: u128,
    event_json: &str,
    prev_hash_bytes: &[u8],
) -> [u8; 32] {
    let mut hasher = blake3::Hasher::new();
    hasher.update(&seq.to_le_bytes());
    hasher.update(&(timestamp_ms as u64).to_le_bytes()); // lower 64 bits, matches verifier
    hasher.update(event_json.as_bytes());
    hasher.update(prev_hash_bytes);
    *hasher.finalize().as_bytes()
}

/// Append-only, crash-safe ledger writer.
///
/// Each call to `append` writes one JSON Line to the ledger file and fsyncs.
pub struct LedgerWriter {
    inner: Mutex<LedgerWriterInner>,
}

struct LedgerWriterInner {
    writer: BufWriter<File>,
    next_seq: u64,
    prev_hash: [u8; 32],
    signer_pub_fingerprint: String,
}

impl LedgerWriter {
    /// Open (or create) a ledger file at `path`.
    ///
    /// If the file already exists, scans to find the last entry's seq and hash
    /// so the chain continues correctly across restarts.
    ///
    /// For the first (genesis) segment, use this method. For continuation
    /// segments, use `open_with_start`.
    pub fn open(
        path: &Path,
        identity: &QuantumNodeIdentity,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        Self::open_with_start(path, identity, [0u8; 32], 0)
    }

    /// Open (or create) a ledger segment file with a non-genesis starting point.
    ///
    /// `initial_prev_hash` is the hash of the last entry in the previous
    /// segment (or `[0u8; 32]` for the first segment). `expected_start_seq`
    /// is the global sequence number of the first entry in this segment.
    ///
    /// Used by `SegmentedLedgerWriter` to resume segments that continue
    /// the chain from a previous segment.
    pub fn open_with_start(
        path: &Path,
        identity: &QuantumNodeIdentity,
        initial_prev_hash: [u8; 32],
        expected_start_seq: u64,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        let pub_key_bytes = identity.dsa_public_key_bytes();
        let signer_pub_fingerprint =
            hex::encode(QuantumNodeIdentity::hash_ledger_block(&pub_key_bytes));

        let (next_seq, prev_hash) = if path.exists() {
            scan_ledger_segment(path, initial_prev_hash, expected_start_seq)?
        } else {
            (expected_start_seq, initial_prev_hash)
        };

        let file = OpenOptions::new().create(true).append(true).open(path)?;

        Ok(Self {
            inner: Mutex::new(LedgerWriterInner {
                writer: BufWriter::new(file),
                next_seq,
                prev_hash,
                signer_pub_fingerprint,
            }),
        })
    }

    /// Append a `QuantumEvent` JSON value to the ledger.
    ///
    /// Signs the canonical hash with the gateway ML-DSA-87 private key,
    /// writes one JSON Line, and calls fsync before returning.
    ///
    /// Returns the completed `LedgerEntry` so callers can use it immediately.
    pub fn append(
        &self,
        event: serde_json::Value,
        identity: &QuantumNodeIdentity,
    ) -> Result<LedgerEntry, Box<dyn std::error::Error>> {
        let mut inner = self.inner.lock().map_err(|_| LedgerError::PoisonedLock)?;

        let seq = inner.next_seq;
        let timestamp_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| LedgerError::TimeError(e.to_string()))?
            .as_millis();
        let prev_hash_hex = hex::encode(inner.prev_hash);
        let event_json = serde_json::to_string(&event)?;
        let prev_hash_bytes = hex::decode(&prev_hash_hex)?;

        // Compute canonical hash over {seq, timestamp_ms, event_json, prev_hash}
        let canonical = canonical_hash(seq, timestamp_ms, &event_json, &prev_hash_bytes);

        // Sign the canonical hash with ML-DSA-87
        let signature_bytes = identity.sign_payload(&canonical)?;
        let signature_hex = hex::encode(&signature_bytes);

        let entry = LedgerEntry {
            schema_version: 1,
            seq,
            timestamp_ms,
            prev_hash: prev_hash_hex,
            event,
            signature: signature_hex,
            signer_pub_fingerprint: inner.signer_pub_fingerprint.clone(),
        };

        // Serialize and write one JSON line
        let line = serde_json::to_string(&entry)?;
        inner.writer.write_all(line.as_bytes())?;
        inner.writer.write_all(b"\n")?;
        inner.writer.flush()?;
        // fsync — crash-safe persistence guarantee
        inner.writer.get_ref().sync_data()?;

        // Advance chain state
        let entry_hash = entry.canonical_hash()?;
        inner.prev_hash = entry_hash;
        inner.next_seq += 1;

        Ok(entry)
    }

    /// Returns the current chain tip: (next_seq, BLAKE3 of last entry).
    pub fn chain_tip(&self) -> Result<(u64, [u8; 32]), LedgerError> {
        let inner = self.inner.lock().map_err(|_| LedgerError::PoisonedLock)?;
        Ok((inner.next_seq, inner.prev_hash))
    }

    /// Set the starting sequence number for this writer.
    ///
    /// Used by `SegmentedLedgerWriter` to maintain global sequence continuity
    /// across segment boundaries. When a new segment is created, the writer
    /// must start at the global sequence offset, not 0.
    ///
    /// Also accepts the expected `prev_hash` so the new segment starts with
    /// the correct chain linkage from the end of the previous segment.
    pub fn set_sequence_start(
        &self,
        next_seq: u64,
        prev_hash: [u8; 32],
    ) -> Result<(), LedgerError> {
        let mut inner = self.inner.lock().map_err(|_| LedgerError::PoisonedLock)?;
        inner.next_seq = next_seq;
        inner.prev_hash = prev_hash;
        Ok(())
    }
}

/// Compute the Merkle root over all entries in a `ledger.jsonl` file.
///
/// Each entry's hash is `BLAKE3(seq_le64 || entry_data)` — a deterministic
/// function of the sequence number and raw entry data, identical to the
/// hash used by `LedgerApplier` in `apply_committed_entries`.
pub fn merkle_root_from_ledger_file(path: &Path) -> Result<[u8; 32], Box<dyn std::error::Error>> {
    let file = std::fs::File::open(path)?;
    let reader = BufReader::new(file);
    let mut hashes: Vec<Vec<u8>> = Vec::new();
    for line_res in reader.lines() {
        let line = line_res?;
        if line.trim().is_empty() {
            continue;
        }
        let entry: LedgerEntry = serde_json::from_str(&line)?;

        // FIX: Use the full canonical hash as the Merkle leaf.
        // This binds seq, timestamp, event, and prev_hash into the Merkle root.
        hashes.push(entry.canonical_hash()?.to_vec());
    }
    Ok(merkle_root_from_hashes(&hashes))
}

/// Backward-compatible wrapper for `scan_ledger_segment` with
/// genesis (all-zero) initial prev_hash and seq=0.
#[allow(dead_code)]
fn scan_existing_ledger(path: &Path) -> Result<(u64, [u8; 32]), Box<dyn std::error::Error>> {
    scan_ledger_segment(path, [0u8; 32], 0)
}

/// Scan a ledger segment with a custom starting prev_hash and sequence.
///
/// Used by `SegmentedLedgerWriter` to verify segments that continue
/// the chain from a previous segment. The `initial_prev_hash` is the
/// hash of the last entry in the previous segment (or `[0u8;32]` for
/// the first segment). The `expected_start_seq` is the global sequence
/// number of the first entry in this segment.
pub fn scan_ledger_segment(
    path: &Path,
    initial_prev_hash: [u8; 32],
    expected_start_seq: u64,
) -> Result<(u64, [u8; 32]), Box<dyn std::error::Error>> {
    let file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(path)?;
    let mut reader = BufReader::new(&file);

    let mut prev_hash = initial_prev_hash;
    let mut last_seq: Option<u64> = None;
    let mut valid_bytes = 0u64;
    let mut line = String::new();
    let mut line_no = 0;

    loop {
        line.clear();
        let bytes_read = match reader.read_line(&mut line) {
            Ok(0) => break, // EOF
            Ok(n) => n,
            Err(e) => return Err(format!("IO error reading ledger: {e}").into()),
        };
        line_no += 1;

        if line.trim().is_empty() {
            valid_bytes += bytes_read as u64;
            continue;
        }

        let entry: LedgerEntry = match serde_json::from_str(&line) {
            Ok(e) => e,
            Err(e) => {
                // If we fail to parse, assume it's a torn write at the end of the file due to a crash.
                // We truncate the file to the last known valid byte boundary.
                eprintln!("WARN: Torn write detected at line {line_no} ({e}). Truncating ledger to {valid_bytes} bytes.");
                file.set_len(valid_bytes)?;
                break;
            }
        };

        // Verify chain linkage
        let expected_prev = hex::encode(prev_hash);
        if entry.prev_hash != expected_prev {
            return Err(format!(
                "Ledger chain broken at seq={}: expected prev_hash={expected_prev}, got={}",
                entry.seq, entry.prev_hash
            )
            .into());
        }

        // Verify sequence: first entry must match expected_start_seq,
        // subsequent entries must be monotonically increasing
        match last_seq {
            None if entry.seq != expected_start_seq => {
                return Err(format!(
                    "Ledger does not start at seq={}, got seq={}",
                    expected_start_seq, entry.seq
                )
                .into());
            }
            Some(s) if entry.seq <= s => {
                return Err(format!(
                    "Duplicated or reordered sequence: expected seq={}, got seq={}",
                    s + 1,
                    entry.seq
                )
                .into());
            }
            Some(s) if entry.seq != s + 1 => {
                return Err(format!(
                    "Sequence gap (missing entry): expected seq={}, got seq={}",
                    s + 1,
                    entry.seq
                )
                .into());
            }
            _ => {}
        }

        prev_hash = entry.canonical_hash()?;
        last_seq = Some(entry.seq);
        valid_bytes += bytes_read as u64;
    }

    match last_seq {
        None => Ok((expected_start_seq, initial_prev_hash)), // Empty file — start fresh
        Some(s) => Ok((s + 1, prev_hash)),                   // Resume after last entry
    }
}

/// Compute a Bitcoin-style Merkle root from a list of 32-byte hashes.
///
/// Pairs adjacent hashes and hashes them together (BLAKE3), recursively,
/// until a single 32-byte root remains. An empty list returns `[0u8; 32]`.
/// A single hash is doubled (hashed with itself).
///
/// This is the same algorithm used by `MerkleLedger::merkle_root()` but
/// operates on raw hashes, making it usable by `pq_verify` to independently
/// reconstruct the Merkle root from a `ledger.jsonl` file.
pub fn merkle_root_from_hashes(hashes: &[Vec<u8>]) -> [u8; 32] {
    if hashes.is_empty() {
        return [0u8; 32];
    }
    if hashes.len() == 1 {
        let mut h = blake3::Hasher::new();
        h.update(&hashes[0]);
        h.update(&hashes[0]);
        return *h.finalize().as_bytes();
    }

    let mut layer: Vec<Vec<u8>> = hashes.to_vec();
    while layer.len() > 1 {
        let mut next = Vec::with_capacity((layer.len() + 1) / 2);
        let mut i = 0;
        while i < layer.len() {
            if i + 1 < layer.len() {
                let mut h = blake3::Hasher::new();
                h.update(&layer[i]);
                h.update(&layer[i + 1]);
                next.push(h.finalize().as_bytes().to_vec());
            } else {
                // Odd element — carry up unchanged (Bitcoin-style)
                next.push(layer[i].clone());
            }
            i += 2;
        }
        layer = next;
    }
    let mut result = [0u8; 32];
    if !layer.is_empty() {
        result.copy_from_slice(&layer[0]);
    }
    result
}

// ─────────────────────────────────────────────────────────────────────────────
// P7.3: Raft-committed signed ledger checkpoints
// ─────────────────────────────────────────────────────────────────────────────

/// Checkpoint schema version.
pub const CHECKPOINT_VERSION: u32 = 1u32;

/// Sentinel client_id for checkpoint-commit Raft log entries.
/// When `apply_committed_entries` encounters a LogEntry with this client_id,
/// it processes it as a committed checkpoint rather than a regular LedgerBlock.
pub const CHECKPOINT_CLIENT_ID: &str = "SYSTEM::CHECKPOINT";

/// A cryptographically signed checkpoint binding a ledger Merkle-root range
/// to a specific Raft term and committed log index.
///
/// The checkpoint is generated by the Raft leader, signed with ML-DSA-87,
/// submitted as a Raft log entry, and becomes **authoritative only after
/// quorum commit**.
///
/// ## Canonical bytes (for signing)
///
/// ```text
/// cluster_id_utf8_len (u32 BE)
/// || cluster_id_utf8
/// || config_epoch     (u64 BE)
/// || raft_term          (u64 BE)
/// || raft_log_index     (u64 BE)
/// || ledger_first_seq   (u64 BE)
/// || ledger_last_seq    (u64 BE)
/// || ledger_entry_count (u64 BE)
/// || merkle_root        (32 B)
/// || prev_checkpoint_hash (32 B)
/// || timestamp_ms        (u64 BE)
/// || version            (u32 BE)
/// ```
///
/// `canonical_hash = BLAKE3(canonical_bytes)` is what gets signed.
/// `checkpoint_hash = BLAKE3(canonical_bytes || signature_bytes)` creates an
/// immutable chain linkage between checkpoints.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Checkpoint {
    /// Schema version (always 1 for initial implementation).
    pub version: u32,
    /// Stable cluster UUID generated once at bootstrap, identical across all nodes.
    pub cluster_id: String,
    /// Explicit Raft configuration epoch (incremented on membership changes).
    pub config_epoch: u64,
    /// Raft term at which this checkpoint was generated.
    pub raft_term: u64,
    /// Raft committed log index at which this checkpoint was committed.
    /// (Set by the Raft apply phase, not at generation time.)
    pub raft_log_index: u64,
    /// First ledger sequence covered by this checkpoint.
    pub ledger_first_seq: u64,
    /// Last ledger sequence covered by this checkpoint (inclusive).
    pub ledger_last_seq: u64,
    /// Number of ledger entries covered.
    pub ledger_entry_count: u64,
    /// BLAKE3 Merkle root of all covered ledger entries.
    pub merkle_root: String,
    /// BLAKE3 hash of the previous checkpoint (for chain linkage).
    pub previous_checkpoint_hash: String,
    /// Unix epoch milliseconds when the checkpoint was generated.
    pub timestamp_ms: u128,
    /// hex(ML-DSA-87 signature over canonical_hash bytes)
    pub signature: String,
    /// hex(BLAKE3(ML-DSA-87 public key bytes)) — identifies the signing key
    pub signer_pub_fingerprint: String,
}

/// A checkpoint that has been committed by the Raft state machine.
/// Differs from `Checkpoint` in that `raft_log_index` is set after commit,
/// and `raft_commit_term` records the term at which the entry was committed.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommittedCheckpoint {
    /// The signed checkpoint (signature generated before Raft submission).
    pub checkpoint: Checkpoint,
    /// The Raft term in which this checkpoint entry was committed.
    /// (May differ from `checkpoint.raft_term` if the leader changed mid-submission.)
    pub raft_commit_term: u64,
    /// The Raft log index at which this checkpoint was committed.
    pub raft_commit_index: u64,
}

impl Checkpoint {
    /// Canonical binary representation for signing and hashing.
    ///
    /// Format: cluster_id_len(u32 BE) || cluster_id_utf8 ||
    ///         config_epoch(u64 BE) || raft_term(u64 BE) ||
    ///         raft_log_index(u64 BE) || ledger_first_seq(u64 BE) ||
    ///         ledger_last_seq(u64 BE) || ledger_entry_count(u64 BE) ||
    ///         merkle_root(32 B) || prev_checkpoint_hash(32 B) ||
    ///         timestamp_ms(u64 BE) || version(u32 BE)
    pub fn canonical_bytes(&self) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
        let merkle_root_bytes = hex::decode(&self.merkle_root)?;
        let prev_hash_bytes = hex::decode(&self.previous_checkpoint_hash)?;
        if merkle_root_bytes.len() != 32 {
            return Err(format!(
                "merkle_root must be 32 bytes (hex), got {} bytes",
                merkle_root_bytes.len()
            )
            .into());
        }
        if prev_hash_bytes.len() != 32 {
            return Err(format!(
                "previous_checkpoint_hash must be 32 bytes (hex), got {} bytes",
                prev_hash_bytes.len()
            )
            .into());
        }

        let cluster_id_bytes = self.cluster_id.as_bytes();
        let mut buf = Vec::with_capacity(8 + cluster_id_bytes.len() + 64 + 64 + 32);
        buf.extend_from_slice(&(cluster_id_bytes.len() as u32).to_be_bytes());
        buf.extend_from_slice(cluster_id_bytes);
        buf.extend_from_slice(&self.config_epoch.to_be_bytes());
        buf.extend_from_slice(&self.raft_term.to_be_bytes());
        buf.extend_from_slice(&self.raft_log_index.to_be_bytes());
        buf.extend_from_slice(&self.ledger_first_seq.to_be_bytes());
        buf.extend_from_slice(&self.ledger_last_seq.to_be_bytes());
        buf.extend_from_slice(&self.ledger_entry_count.to_be_bytes());
        buf.extend_from_slice(&merkle_root_bytes);
        buf.extend_from_slice(&prev_hash_bytes);
        // P8-004 fix: signer_pub_fingerprint is now part of the signed
        // canonical bytes, cryptographically binding the claimed identity
        // to the checkpoint content.
        buf.extend_from_slice(self.signer_pub_fingerprint.as_bytes());
        buf.extend_from_slice(&(self.timestamp_ms as u64).to_be_bytes());
        buf.extend_from_slice(&self.version.to_be_bytes());
        Ok(buf)
    }

    /// BLAKE3 hash of canonical bytes — the value that gets ML-DSA-87 signed.
    pub fn canonical_hash(&self) -> Result<[u8; 32], Box<dyn std::error::Error>> {
        let bytes = self.canonical_bytes()?;
        let mut hasher = blake3::Hasher::new();
        hasher.update(&bytes);
        Ok(*hasher.finalize().as_bytes())
    }

    /// Full checkpoint hash for chain linkage:
    /// `BLAKE3(canonical_bytes || signature_bytes)`.
    ///
    /// This binds both the content AND the signature, so any tampering
    /// with the signature or content changes the hash, breaking chain linkage.
    pub fn checkpoint_hash(&self) -> Result<[u8; 32], Box<dyn std::error::Error>> {
        let canonical = self.canonical_hash()?;
        let sig_bytes = hex::decode(&self.signature)?;
        let mut hasher = blake3::Hasher::new();
        hasher.update(&canonical);
        hasher.update(&sig_bytes);
        Ok(*hasher.finalize().as_bytes())
    }

    /// Verify the ML-DSA-87 signature and structural integrity.
    ///
    /// Returns the canonical hash on success.
    pub fn verify_signature(&self, dsa_pub_key: &[u8]) -> Result<[u8; 32], CheckpointError> {
        let canonical = self.canonical_hash().map_err(CheckpointError::from)?;
        let sig_bytes = hex::decode(&self.signature).map_err(|e| {
            CheckpointError::VerificationFailed(format!("Invalid signature hex: {e}"))
        })?;
        if !QuantumNodeIdentity::verify_signature(dsa_pub_key, &canonical, &sig_bytes) {
            return Err(CheckpointError::VerificationFailed(
                "ML-DSA-87 signature verification failed".to_string(),
            ));
        }
        // Verify signer fingerprint matches the public key
        let expected_fp = hex::encode(QuantumNodeIdentity::hash_ledger_block(dsa_pub_key));
        if self.signer_pub_fingerprint != expected_fp {
            return Err(CheckpointError::VerificationFailed(format!(
                "Signer fingerprint mismatch: entry has {}, expected {}",
                self.signer_pub_fingerprint, expected_fp
            )));
        }
        Ok(canonical)
    }

    /// Compute the expected signer fingerprint from a known public key.
    pub fn expected_signer_fingerprint(dsa_pub_key: &[u8]) -> String {
        hex::encode(QuantumNodeIdentity::hash_ledger_block(dsa_pub_key))
    }
}

/// Error type for checkpoint operations.
#[derive(Debug)]
pub enum CheckpointError {
    Serialization(String),
    VerificationFailed(String),
}

impl From<Box<dyn std::error::Error>> for CheckpointError {
    fn from(e: Box<dyn std::error::Error>) -> Self {
        CheckpointError::VerificationFailed(e.to_string())
    }
}

impl std::fmt::Display for CheckpointError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CheckpointError::Serialization(e) => write!(f, "Serialization error: {e}"),
            CheckpointError::VerificationFailed(e) => write!(f, "Verification failed: {e}"),
        }
    }
}

impl std::error::Error for CheckpointError {}

/// Append-only, crash-safe checkpoint writer.
///
/// Each call to `append` writes one JSON Line to the checkpoints file and fsyncs.
/// The checkpoint chain is linked via `previous_checkpoint_hash`.
pub struct CheckpointWriter {
    inner: Mutex<CheckpointWriterInner>,
}

struct CheckpointWriterInner {
    writer: BufWriter<File>,
    next_checkpoint_index: u64,
    prev_checkpoint_hash: [u8; 32],
    last_ledger_last_seq: u64,
}

impl CheckpointWriter {
    /// Open (or create) a checkpoints file at `path`.
    /// If the file exists, scans to find the last checkpoint's hash.
    pub fn open(path: &Path) -> Result<Self, Box<dyn std::error::Error>> {
        let (next_idx, prev_hash, last_ledger_last_seq) = if path.exists() {
            scan_existing_checkpoints(path)?
        } else {
            (0, [0u8; 32], 0)
        };

        let file = OpenOptions::new().create(true).append(true).open(path)?;
        Ok(Self {
            inner: Mutex::new(CheckpointWriterInner {
                writer: BufWriter::new(file),
                next_checkpoint_index: next_idx,
                prev_checkpoint_hash: prev_hash,
                last_ledger_last_seq,
            }),
        })
    }

    /// Append a committed checkpoint to the file and fsync.
    /// Returns the `previous_checkpoint_hash` that was used (should match
    /// what the caller set in the checkpoint).
    pub fn append(&self, cp: &CommittedCheckpoint) -> Result<(), Box<dyn std::error::Error>> {
        let mut inner = self.inner.lock().unwrap();

        // Verify chain linkage
        let expected_prev = hex::encode(inner.prev_checkpoint_hash);
        if cp.checkpoint.previous_checkpoint_hash != expected_prev {
            return Err(format!(
                "Checkpoint chain break: expected previous_checkpoint_hash={}, got={}",
                expected_prev, cp.checkpoint.previous_checkpoint_hash
            )
            .into());
        }

        let line = serde_json::to_string(cp)?;
        inner.writer.write_all(line.as_bytes())?;
        inner.writer.write_all(b"\n")?;
        inner.writer.flush()?;
        inner.writer.get_ref().sync_data()?;

        // Advance chain state
        let hash = cp.checkpoint.checkpoint_hash()?;
        inner.prev_checkpoint_hash = hash;
        inner.next_checkpoint_index += 1;
        inner.last_ledger_last_seq = cp.checkpoint.ledger_last_seq;
        Ok(())
    }

    /// Returns the current chain tip: (next_index, last_checkpoint_hash).
    pub fn chain_tip(&self) -> (u64, [u8; 32]) {
        let inner = self.inner.lock().unwrap();
        (inner.next_checkpoint_index, inner.prev_checkpoint_hash)
    }

    /// Returns the `ledger_last_seq` of the most recently appended checkpoint.
    /// Used to determine where the next checkpoint's ledger range should start.
    /// Returns 0 if no checkpoint has been appended yet.
    pub fn last_checkpoint_ledger_last_seq(&self) -> u64 {
        let inner = self.inner.lock().unwrap();
        inner.last_ledger_last_seq
    }
}

/// Scan existing checkpoints file to resume the chain.
fn scan_existing_checkpoints(
    path: &Path,
) -> Result<(u64, [u8; 32], u64), Box<dyn std::error::Error>> {
    let file = std::fs::OpenOptions::new().read(true).open(path)?;
    let reader = BufReader::new(&file);

    let mut prev_hash = [0u8; 32];
    let mut next_idx = 0u64;
    let mut last_ledger_last_seq = 0u64;

    for line_res in reader.lines() {
        let line = line_res?;
        if line.trim().is_empty() {
            continue;
        }
        let cp: CommittedCheckpoint = serde_json::from_str(&line)?;
        // Verify hash linkage
        let expected_prev = hex::encode(prev_hash);
        if cp.checkpoint.previous_checkpoint_hash != expected_prev {
            return Err(format!(
                "Checkpoint chain broken: expected prev={}, got={}",
                expected_prev, cp.checkpoint.previous_checkpoint_hash
            )
            .into());
        }
        prev_hash = cp.checkpoint.checkpoint_hash()?;
        next_idx += 1;
        last_ledger_last_seq = cp.checkpoint.ledger_last_seq;
    }

    Ok((next_idx, prev_hash, last_ledger_last_seq))
}

// ─────────────────────────────────────────────────────────────────────────────
// P8.12: Ledger Segment Rotation & Evidence Retention
// ─────────────────────────────────────────────────────────────────────────────

/// Default maximum entries per segment file before rotation.
pub const DEFAULT_SEGMENT_MAX_ENTRIES: u64 = 10_000;

/// Default maximum bytes per segment file before rotation.
pub const DEFAULT_SEGMENT_MAX_BYTES: u64 = 10 * 1024 * 1024; // 10 MB

/// Metadata for a single ledger segment file.
///
/// Each segment is an immutable JSONL file bounded by `max_entries` or
/// `max_bytes`. The `prev_segment_hash` field chains segments together
/// using the canonical hash of the last entry in the previous segment.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct SegmentRecord {
    /// Zero-based segment index (segment_0.jsonl, segment_1.jsonl, ...)
    pub segment_index: u64,
    /// File name relative to the ledger directory
    pub file_name: String,
    /// Sequence number of the first entry in this segment
    pub first_seq: u64,
    /// Sequence number of the last entry in this segment (exclusive)
    pub last_seq: u64,
    /// BLAKE3 hash of the last entry's canonical bytes (chain linkage)
    pub last_entry_hash: String,
    /// BLAKE3 hash of the previous segment's last entry (cross-segment chain)
    pub prev_segment_hash: String,
    /// Merkle root over all entries in this segment
    pub merkle_root: String,
    /// Epoch timestamp when the segment was sealed (0 if not yet sealed)
    pub sealed_at_unix: u64,
    /// Whether this segment has been sealed (fsync'd + metadata recorded)
    pub sealed: bool,
    /// Whether this segment has been archived to cold storage
    pub archived: bool,
    /// Whether this segment has been authorized for deletion
    /// (only valid if `archived` is true)
    pub deleted: bool,
    /// Byte size of the segment file when sealed
    pub file_size_bytes: u64,
}

/// Manifest tracking all ledger segments.
///
/// Stored as `ledger_manifest.json` alongside the segment files.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct SegmentManifest {
    pub segments: Vec<SegmentRecord>,
    /// Maximum entries per segment before rotation
    pub segment_max_entries: u64,
    /// Maximum bytes per segment before rotation
    pub segment_max_bytes: u64,
    /// Cluster ID for identity binding
    pub cluster_id: String,
}

impl SegmentManifest {
    pub fn new(cluster_id: &str, max_entries: u64, max_bytes: u64) -> Self {
        Self {
            segments: Vec::new(),
            segment_max_entries: max_entries,
            segment_max_bytes: max_bytes,
            cluster_id: cluster_id.to_string(),
        }
    }

    /// The total number of entries across all non-deleted segments.
    /// For sealed segments, uses the recorded last_seq. For unsealed (active)
    /// segments, this returns the recorded start (0 entries if empty).
    pub fn total_entries(&self) -> u64 {
        self.segments
            .iter()
            .filter(|s| !s.deleted)
            .map(|s| s.last_seq.saturating_sub(s.first_seq))
            .sum()
    }

    /// The active segment is the last segment in the manifest that is not deleted.
    /// It may be sealed (fully rotated) or unsealed (currently being written to).
    pub fn active_segment(&self) -> Option<&SegmentRecord> {
        self.segments.iter().rev().find(|s| !s.deleted)
    }

    /// Find a segment by index.
    pub fn segment(&self, idx: u64) -> Option<&SegmentRecord> {
        self.segments
            .iter()
            .find(|s| s.segment_index == idx && !s.deleted)
    }

    /// Returns true if the active segment has reached its size limit.
    pub fn should_rotate(&self, current_entry_count: u64, current_bytes: u64) -> bool {
        let Some(active) = self.active_segment() else {
            return false;
        };
        let entries_in_segment = current_entry_count - active.first_seq;
        entries_in_segment >= self.segment_max_entries || current_bytes >= self.segment_max_bytes
    }
}

/// Error type for ledger segment operations.
#[derive(Debug, thiserror::Error)]
pub enum SegmentError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Serialization error: {0}")]
    Serialization(String),
    #[error("Ledger chain broken: {0}")]
    ChainBroken(String),
    #[error("Segment not found: {0}")]
    SegmentNotFound(u64),
    #[error("Disk full: cannot append to ledger")]
    DiskFull,
    #[error("Rotation policy violation: {0}")]
    PolicyViolation(String),
    #[error(
        "Segment not yet sealed — retention deletion requires a checkpoint covering this segment"
    )]
    NotSealed,
}

/// Segmented ledger writer with rotation and retention governance.
///
/// Wraps `LedgerWriter` and automatically rotates to a new segment file
/// when the active segment reaches `max_entries` or `max_bytes`.
///
/// The invariant enforced is:
/// **Resource limits must not silently invalidate previously committed evidence.**
///
/// Segments are sealed (fsync'd) before becoming inactive, and the manifest
/// is written atomically (write-to-temp + rename) so crash recovery always
/// produces a consistent state.
pub struct SegmentedLedgerWriter {
    inner: Mutex<SegmentedLedgerInner>,
}

struct SegmentedLedgerInner {
    /// Ledger directory path
    ledger_dir: PathBuf,
    /// Current manifest
    manifest: SegmentManifest,
    /// Current active LedgerWriter (writes to the active segment file)
    active_writer: Option<LedgerWriter>,
    /// Path to the active segment file
    active_segment_path: Option<PathBuf>,
    /// Running byte count of the active segment
    active_bytes: u64,
    /// Current total entry count (across all segments)
    total_entries: u64,
    /// First seq of the current active segment
    active_segment_first_seq: u64,
    /// Max entries in active segment before rotation
    active_segment_entry_count: u64,
}

impl SegmentedLedgerWriter {
    /// Create a new segmented ledger at `ledger_dir`.
    ///
    /// If a manifest already exists, resumes from it. Otherwise creates a new
    /// ledger with segment_0.
    pub fn new(
        ledger_dir: &Path,
        identity: &QuantumNodeIdentity,
        cluster_id: &str,
    ) -> Result<Self, SegmentError> {
        Self::with_limits(
            ledger_dir,
            identity,
            cluster_id,
            DEFAULT_SEGMENT_MAX_ENTRIES,
            DEFAULT_SEGMENT_MAX_BYTES,
        )
    }

    /// Create a segmented ledger with custom rotation limits.
    ///
    /// If a manifest already exists, resumes from it. The last segment in
    /// the manifest is the active (unsealed) segment. If the manifest is
    /// empty or doesn't exist, creates a new segment_0.
    pub fn with_limits(
        ledger_dir: &Path,
        identity: &QuantumNodeIdentity,
        cluster_id: &str,
        max_entries: u64,
        max_bytes: u64,
    ) -> Result<Self, SegmentError> {
        std::fs::create_dir_all(ledger_dir)?;

        // SEC-019: Enforce 0o700 permissions on ledger directory for security
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(ledger_dir, std::fs::Permissions::from_mode(0o700))?;
        }

        let manifest_path = ledger_dir.join("ledger_manifest.json");
        let mut manifest = if manifest_path.exists() {
            let content = std::fs::read_to_string(&manifest_path)
                .map_err(|e| SegmentError::Serialization(e.to_string()))?;
            serde_json::from_str::<SegmentManifest>(&content)
                .map_err(|e| SegmentError::Serialization(e.to_string()))?
        } else {
            SegmentManifest::new(cluster_id, max_entries, max_bytes)
        };

        // Ensure the manifest has the correct limits
        manifest.segment_max_entries = max_entries;
        manifest.segment_max_bytes = max_bytes;

        // If the manifest has no segments, create the first one
        if manifest.segments.is_empty() {
            let seg_path = ledger_dir.join("segment_0.jsonl");
            let _ = LedgerWriter::open(&seg_path, identity)
                .map_err(|e| SegmentError::Serialization(e.to_string()))?;
            manifest.segments.push(SegmentRecord {
                segment_index: 0,
                file_name: "segment_0.jsonl".to_string(),
                first_seq: 0,
                last_seq: 0,
                last_entry_hash: String::new(),
                prev_segment_hash: String::new(),
                merkle_root: String::new(),
                sealed_at_unix: 0,
                sealed: false,
                archived: false,
                deleted: false,
                file_size_bytes: 0,
            });
            let tmp_path = ledger_dir.join("ledger_manifest.json.tmp");
            let content = serde_json::to_string_pretty(&manifest)
                .map_err(|e| SegmentError::Serialization(e.to_string()))?;
            std::fs::write(&tmp_path, content)?;
            std::fs::rename(&tmp_path, &manifest_path)?;
        }

        // Open the active (last) segment
        let active_seg = manifest
            .active_segment()
            .ok_or(SegmentError::PolicyViolation(
                "No active segment in manifest".into(),
            ))?;
        let seg_path = ledger_dir.join(&active_seg.file_name);

        let (
            writer,
            total_entries,
            active_bytes,
            active_segment_first_seq,
            active_segment_entry_count,
        ) = if active_seg.sealed {
            // The active segment is already sealed — we need a new segment
            let new_index = manifest.segments.len() as u64;
            let new_file_name = format!("segment_{}.jsonl", new_index);
            let new_path = ledger_dir.join(&new_file_name);

            // Each segment starts with internal genesis (prev_hash = [0u8;32]).
            // Cross-segment linkage is tracked via manifest's prev_segment_hash.
            let start_seq = manifest.segments.last().map(|s| s.last_seq).unwrap_or(0);
            let prev_seg_hash: [u8; 32] = manifest
                .segments
                .last()
                .and_then(|s| hex::decode(&s.last_entry_hash).ok())
                .and_then(|v| v.as_slice().try_into().ok())
                .unwrap_or([0u8; 32]);
            let writer =
                LedgerWriter::open_with_start(&new_path, identity, prev_seg_hash, start_seq)
                    .map_err(|e| SegmentError::Serialization(e.to_string()))?;

            // Determine prev_segment_hash from last sealed segment
            let prev_seg_hash = manifest
                .segments
                .last()
                .map(|s| s.last_entry_hash.clone())
                .unwrap_or_default();

            manifest.segments.push(SegmentRecord {
                segment_index: new_index,
                file_name: new_file_name.clone(),
                first_seq: start_seq,
                last_seq: start_seq,
                last_entry_hash: String::new(),
                prev_segment_hash: prev_seg_hash,
                merkle_root: String::new(),
                sealed_at_unix: 0,
                sealed: false,
                archived: false,
                deleted: false,
                file_size_bytes: 0,
            });

            // Persist the manifest with the new segment
            let tmp_path = ledger_dir.join("ledger_manifest.json.tmp");
            let content = serde_json::to_string_pretty(&manifest)
                .map_err(|e| SegmentError::Serialization(e.to_string()))?;
            std::fs::write(&tmp_path, content)?;
            std::fs::rename(&tmp_path, &manifest_path)?;

            let total = start_seq;
            (writer, total, 0, total, 0)
        } else {
            // Unsealed active segment — resume from it
            // Determine the initial prev_hash and expected start seq
            // from the previous sealed segment in the manifest
            let prev_seg_hash: [u8; 32] = manifest
                .segments
                .iter()
                .rev()
                .skip(1)
                .find(|s| s.sealed && !s.deleted)
                .and_then(|s| hex::decode(&s.last_entry_hash).ok())
                .and_then(|v| v.as_slice().try_into().ok())
                .unwrap_or([0u8; 32]);

            let writer = LedgerWriter::open_with_start(
                &seg_path,
                identity,
                prev_seg_hash,
                active_seg.first_seq,
            )
            .map_err(|e| SegmentError::Serialization(e.to_string()))?;
            let (next_seq, _last_hash) = writer
                .chain_tip()
                .map_err(|e| SegmentError::Serialization(e.to_string()))?;
            let bytes = std::fs::metadata(&seg_path).map(|m| m.len()).unwrap_or(0);
            let first_seq = active_seg.first_seq;
            let entry_count = next_seq.saturating_sub(first_seq);
            (writer, next_seq, bytes, first_seq, entry_count)
        };

        let _ = cluster_id;

        Ok(Self {
            inner: Mutex::new(SegmentedLedgerInner {
                ledger_dir: ledger_dir.to_path_buf(),
                manifest,
                active_writer: Some(writer),
                active_segment_path: Some(seg_path),
                active_bytes,
                total_entries,
                active_segment_first_seq,
                active_segment_entry_count,
            }),
        })
    }

    /// Append an event to the active segment, rotating if necessary.
    ///
    /// Crash-safety: the segment is fsync'd before rotation. If a crash
    /// occurs during rotation, recovery resumes from the last consistent
    /// manifest state.
    pub fn append(
        &self,
        event: serde_json::Value,
        identity: &QuantumNodeIdentity,
    ) -> Result<LedgerEntry, SegmentError> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| SegmentError::PolicyViolation("Ledger lock poisoned".into()))?;

        // Check if we need to seal + rotate BEFORE appending (entry count or byte limit)
        if inner.active_segment_entry_count >= inner.manifest.segment_max_entries
            || inner.active_bytes >= inner.manifest.segment_max_bytes
        {
            // Only seal if the current segment has entries
            if inner.active_segment_entry_count > 0 {
                self.seal_segment(&mut inner)?;
            }
            self.rotate_segment(&mut inner, identity)?;
        }

        let writer = inner
            .active_writer
            .as_ref()
            .ok_or(SegmentError::PolicyViolation("No active writer".into()))?;

        let entry = writer
            .append(event, identity)
            .map_err(|e| SegmentError::Serialization(e.to_string()))?;

        // Compute the hash of this entry for chain linkage tracking
        let entry_hash = entry.canonical_hash();

        // Track bytes written
        let line_json = serde_json::to_string(&entry)
            .map_err(|e| SegmentError::Serialization(e.to_string()))?;
        inner.active_bytes += line_json.len() as u64 + 1; // +1 for newline
        inner.total_entries = entry.seq + 1;
        inner.active_segment_entry_count += 1;

        // Update the manifest record for the active segment so it reflects
        // the latest state (for crash recovery and verification)
        let total = inner.total_entries;
        let bytes = inner.active_bytes;
        if let Some(seg) = inner.manifest.segments.last_mut() {
            seg.last_seq = total;
            seg.last_entry_hash =
                hex::encode(entry_hash.map_err(|e| SegmentError::Serialization(e.to_string()))?);
            seg.file_size_bytes = bytes;
        }

        // Persist manifest so crash recovery can find the active segment
        self.write_manifest(&mut inner)?;

        Ok(entry)
    }

    /// Seal the current segment: fsync, compute merkle root, update manifest record.
    /// Does NOT rotate — the active segment is still available for writes
    /// until `rotate_segment` is called.
    fn seal_segment(&self, inner: &mut SegmentedLedgerInner) -> Result<(), SegmentError> {
        let writer = inner
            .active_writer
            .as_ref()
            .ok_or(SegmentError::PolicyViolation(
                "No active writer to seal".into(),
            ))?;

        let (next_seq, last_hash) = writer
            .chain_tip()
            .map_err(|e| SegmentError::Serialization(e.to_string()))?;
        let seg_path = inner
            .active_segment_path
            .as_ref()
            .ok_or(SegmentError::PolicyViolation(
                "No active segment path".into(),
            ))?;

        // fsync the segment before sealing (crash-safety)
        let file = OpenOptions::new().write(true).open(seg_path)?;
        file.sync_data()?;

        // Compute merkle root for this segment
        let merkle = merkle_root_from_ledger_file(seg_path)
            .map_err(|e| SegmentError::Serialization(e.to_string()))?;

        let file_size = std::fs::metadata(seg_path).map(|m| m.len()).unwrap_or(0);

        // Update the active segment record in the manifest with sealed metadata
        if let Some(seg) = inner.manifest.segments.last_mut() {
            seg.last_seq = next_seq;
            seg.last_entry_hash = hex::encode(last_hash);
            seg.merkle_root = hex::encode(merkle);
            seg.sealed_at_unix = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_err(|e| SegmentError::Serialization(format!("Time error: {e}")))?
                .as_secs();
            seg.sealed = true;
            seg.file_size_bytes = file_size;
        }

        self.write_manifest(inner)?;
        Ok(())
    }

    /// Rotate to a new segment file: create the new segment, add to manifest
    /// as unsealed, and open the LedgerWriter for it.
    fn rotate_segment(
        &self,
        inner: &mut SegmentedLedgerInner,
        identity: &QuantumNodeIdentity,
    ) -> Result<(), SegmentError> {
        let new_index = inner.manifest.segments.len() as u64;
        let new_file_name = format!("segment_{}.jsonl", new_index);
        let new_path = inner.ledger_dir.join(&new_file_name);

        // Start the new segment — carry over the global sequence offset and
        // the previous segment's last entry hash as initial prev_hash, so
        // the chain is continuous across segment boundaries.
        let start_seq = inner.total_entries;
        let prev_seg_hash: [u8; 32] = inner
            .manifest
            .segments
            .last()
            .and_then(|s| hex::decode(&s.last_entry_hash).ok())
            .and_then(|v| v.as_slice().try_into().ok())
            .unwrap_or([0u8; 32]);
        let writer = LedgerWriter::open_with_start(&new_path, identity, prev_seg_hash, start_seq)
            .map_err(|e| SegmentError::Serialization(e.to_string()))?;

        // Determine prev_segment_hash from last sealed segment (manifest linkage)
        let prev_seg_hash = inner
            .manifest
            .segments
            .last()
            .map(|s| s.last_entry_hash.clone())
            .unwrap_or_default();

        inner.manifest.segments.push(SegmentRecord {
            segment_index: new_index,
            file_name: new_file_name,
            first_seq: inner.total_entries,
            last_seq: inner.total_entries,
            last_entry_hash: String::new(),
            prev_segment_hash: prev_seg_hash,
            merkle_root: String::new(),
            sealed_at_unix: 0,
            sealed: false,
            archived: false,
            deleted: false,
            file_size_bytes: 0,
        });

        inner.active_writer = Some(writer);
        inner.active_segment_path = Some(new_path);
        inner.active_bytes = 0;
        inner.active_segment_first_seq = inner.total_entries;
        inner.active_segment_entry_count = 0;

        Ok(())
    }

    /// Write the manifest atomically (write-to-temp + rename).
    fn write_manifest(&self, inner: &mut SegmentedLedgerInner) -> Result<(), SegmentError> {
        let manifest_path = inner.ledger_dir.join("ledger_manifest.json");
        let tmp_path = inner.ledger_dir.join("ledger_manifest.json.tmp");

        let content = serde_json::to_string_pretty(&inner.manifest)
            .map_err(|e| SegmentError::Serialization(e.to_string()))?;

        std::fs::write(&tmp_path, content)?;
        std::fs::rename(&tmp_path, &manifest_path)?;

        Ok(())
    }

    /// Returns the current chain tip: (total_entries, last_entry_hash, segment_index).
    pub fn chain_tip(&self) -> (u64, [u8; 32], u64) {
        let inner = self
            .inner
            .lock()
            .map_err(|_| SegmentError::PolicyViolation("Ledger lock poisoned".into()))
            .unwrap();
        let seg_idx = if inner.manifest.segments.is_empty() {
            0
        } else {
            inner
                .manifest
                .segments
                .last()
                .map(|s| s.segment_index + 1)
                .unwrap_or(0)
        };
        let last_hash = if let Some(writer) = &inner.active_writer {
            let (_, h) = writer.chain_tip().unwrap_or((0, [0u8; 32]));
            h
        } else {
            [0u8; 32]
        };
        (inner.total_entries, last_hash, seg_idx)
    }

    /// Returns the manifest.
    pub fn manifest(&self) -> SegmentManifest {
        let inner = self.inner.lock().unwrap();
        inner.manifest.clone()
    }

    /// Archive a sealed segment (mark for eventual retention-based deletion).
    ///
    /// Only segments that have been covered by a checkpoint can be archived.
    /// The `checkpoint_covering_seq` must be >= the segment's `last_seq`.
    pub fn archive_segment(
        &self,
        segment_index: u64,
        checkpoint_covering_seq: u64,
    ) -> Result<(), SegmentError> {
        let mut inner = self.inner.lock().unwrap();
        let seg_idx = inner
            .manifest
            .segments
            .iter()
            .position(|s| s.segment_index == segment_index)
            .ok_or(SegmentError::SegmentNotFound(segment_index))?;

        {
            let seg = &inner.manifest.segments[seg_idx];
            if seg.archived {
                return Err(SegmentError::PolicyViolation(
                    "Segment already archived".into(),
                ));
            }

            // Only archive segments fully covered by a checkpoint
            if seg.last_seq > checkpoint_covering_seq {
                return Err(SegmentError::PolicyViolation(format!(
                    "Cannot archive segment {}: last_seq ({}) > checkpoint covering seq ({})",
                    segment_index, seg.last_seq, checkpoint_covering_seq
                )));
            }
        }

        inner.manifest.segments[seg_idx].archived = true;
        self.write_manifest(&mut inner)?;
        Ok(())
    }

    /// Authorize deletion of an archived segment.
    ///
    /// A segment can only be deleted if:
    /// 1. It has been archived
    /// 2. A checkpoint covering its range exists (evidence preserved)
    /// 3. An explicit retention policy authorization is provided
    ///
    /// This prevents silent loss of evidence.
    pub fn authorize_deletion(
        &self,
        segment_index: u64,
        authorization: &RetentionAuthorization,
    ) -> Result<(), SegmentError> {
        let mut inner = self.inner.lock().unwrap();

        // Find and validate the segment
        let seg_idx = inner
            .manifest
            .segments
            .iter()
            .position(|s| s.segment_index == segment_index)
            .ok_or(SegmentError::SegmentNotFound(segment_index))?;

        let seg = &inner.manifest.segments[seg_idx];
        if !seg.archived {
            return Err(SegmentError::PolicyViolation(
                "Segment must be archived before deletion".into(),
            ));
        }
        let file_name = seg.file_name.clone();

        if !authorization.approve() {
            return Err(SegmentError::PolicyViolation(
                "Retention deletion not authorized".into(),
            ));
        }

        let seg_path = inner.ledger_dir.join(&file_name);
        let _ = std::fs::remove_file(&seg_path);
        inner.manifest.segments[seg_idx].deleted = true;
        self.write_manifest(&mut inner)?;
        Ok(())
    }

    /// Verify the entire segmented ledger: chain integrity, segment linkage,
    /// and multi-segment evidence reconstruction.
    pub fn verify_all_segments(&self, ledger_dir: &Path) -> Result<(), SegmentError> {
        let inner = self.inner.lock().unwrap();
        let mut prev_seg_last_hash: Option<[u8; 32]> = None;

        for seg in &inner.manifest.segments {
            if seg.deleted {
                continue;
            }

            let seg_path = ledger_dir.join(&seg.file_name);
            if !seg_path.exists() {
                return Err(SegmentError::Io(std::io::Error::new(
                    std::io::ErrorKind::NotFound,
                    format!("Segment file not found: {}", seg.file_name),
                )));
            }

            // Scan the segment to verify chain integrity and get the real tip
            // For continuation segments, use the prev_segment_hash as initial_prev_hash
            let (initial_prev, expected_start_seq) = if seg.segment_index == 0 {
                ([0u8; 32], 0u64)
            } else {
                let prev_hash_bytes = hex::decode(&seg.prev_segment_hash)
                    .ok()
                    .and_then(|v| v.as_slice().try_into().ok())
                    .unwrap_or([0u8; 32]);
                (prev_hash_bytes, seg.first_seq)
            };
            let (scan_next_seq, scan_last_hash) =
                scan_ledger_segment(&seg_path, initial_prev, expected_start_seq)
                    .map_err(|e| SegmentError::Serialization(e.to_string()))?;

            // For sealed segments, verify the recorded metadata matches the scan
            if seg.sealed {
                if scan_next_seq != seg.last_seq {
                    return Err(SegmentError::ChainBroken(format!(
                        "Segment {} seq mismatch: manifest={}, scan={}",
                        seg.file_name, seg.last_seq, scan_next_seq
                    )));
                }

                // Verify the recorded last_entry_hash matches
                let expected_hash = hex::decode(&seg.last_entry_hash)
                    .map_err(|e| SegmentError::Serialization(e.to_string()))?;
                let expected_hash_arr: [u8; 32] = expected_hash
                    .as_slice()
                    .try_into()
                    .map_err(|_| SegmentError::Serialization("Invalid hash length".into()))?;
                if scan_last_hash != expected_hash_arr {
                    return Err(SegmentError::ChainBroken(format!(
                        "Segment {} hash mismatch: manifest={}, scan={}",
                        seg.file_name,
                        seg.last_entry_hash,
                        hex::encode(scan_last_hash)
                    )));
                }
            }

            // Verify cross-segment chain linkage (for all segments after the first)
            if seg.segment_index > 0 {
                if let Some(prev_hash_bytes) = &prev_seg_last_hash {
                    let prev_hash_hex = hex::encode(prev_hash_bytes);
                    if !seg.prev_segment_hash.is_empty() && seg.prev_segment_hash != prev_hash_hex {
                        return Err(SegmentError::ChainBroken(format!(
                            "Segment {} cross-segment chain broken: expected prev={}, got={}",
                            seg.file_name, prev_hash_hex, seg.prev_segment_hash
                        )));
                    }
                }
            }

            prev_seg_last_hash = Some(scan_last_hash);
        }

        Ok(())
    }

    /// Returns the total number of segments.
    pub fn segment_count(&self) -> usize {
        let inner = self.inner.lock().unwrap();
        inner.manifest.segments.len()
    }

    /// Returns the number of non-deleted segments.
    pub fn active_segment_count(&self) -> usize {
        let inner = self.inner.lock().unwrap();
        inner
            .manifest
            .segments
            .iter()
            .filter(|s| !s.deleted)
            .count()
    }
}

/// Authorization token for retention-based segment deletion.
///
/// In production, this would require an approved audit log entry or
/// an administrator's signed approval. The `approve()` method checks
/// the authorization is valid and not expired.
pub struct RetentionAuthorization {
    /// The admin/user authorizing the deletion
    pub authorized_by: String,
    /// Unix timestamp of authorization expiration
    pub expires_at_unix: u64,
    /// Reason for deletion (audit trail)
    pub reason: String,
    /// Digital signature over the above fields by an authorized admin key
    pub signature: Vec<u8>,
}

impl RetentionAuthorization {
    /// Check if this authorization is valid (not expired and has required fields).
    pub fn approve(&self) -> bool {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        !self.authorized_by.is_empty() && now < self.expires_at_unix && !self.signature.is_empty()
    }
}

use std::path::PathBuf;
use std::time::SystemTime;
use std::time::UNIX_EPOCH;

/// Multi-segment scanner: scan a directory of segment files and reconstruct
/// the full ledger chain, verifying chain linkage and monotonic sequence.
///
/// This is the P8.12 equivalent of `scan_existing_ledger` for segmented
/// ledgers. It validates cross-segment chain linkage.
pub fn scan_segmented_ledger(ledger_dir: &Path) -> Result<u64, SegmentError> {
    let manifest_path = ledger_dir.join("ledger_manifest.json");
    if !manifest_path.exists() {
        return Ok(0);
    }

    let content = std::fs::read_to_string(&manifest_path)
        .map_err(|e| SegmentError::Serialization(e.to_string()))?;
    let manifest = serde_json::from_str::<SegmentManifest>(&content)
        .map_err(|e| SegmentError::Serialization(e.to_string()))?;

    let mut prev_seg_last_hash: Option<[u8; 32]> = None;
    let mut total_entries = 0u64;

    for seg in &manifest.segments {
        if seg.deleted {
            continue;
        }

        let seg_path = ledger_dir.join(&seg.file_name);
        if !seg_path.exists() {
            return Err(SegmentError::Io(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                format!("Segment file not found: {}", seg.file_name),
            )));
        }

        let (initial_prev, expected_start_seq) = if seg.segment_index == 0 {
            ([0u8; 32], 0u64)
        } else {
            let prev_hash_bytes = hex::decode(&seg.prev_segment_hash)
                .ok()
                .and_then(|v| v.as_slice().try_into().ok())
                .unwrap_or([0u8; 32]);
            (prev_hash_bytes, seg.first_seq)
        };
        let (next_seq, last_hash) =
            scan_ledger_segment(&seg_path, initial_prev, expected_start_seq)
                .map_err(|e| SegmentError::Serialization(e.to_string()))?;
        total_entries += next_seq.saturating_sub(seg.first_seq);

        // Verify cross-segment chain
        if seg.segment_index > 0 {
            if let Some(prev_bytes) = &prev_seg_last_hash {
                let prev_hash_hex = hex::encode(prev_bytes);
                if !seg.prev_segment_hash.is_empty() && seg.prev_segment_hash != prev_hash_hex {
                    return Err(SegmentError::ChainBroken(format!(
                        "Segment {} cross-segment chain broken",
                        seg.file_name
                    )));
                }
            }
        }

        prev_seg_last_hash = Some(last_hash);
    }

    Ok(total_entries)
}

/// Compute the Merkle root across ALL non-deleted segments in a ledger directory.
///
/// This aggregates per-segment merkle roots into a single root, enabling
/// `pq_verify` to verify evidence integrity across multiple segments.
pub fn merkle_root_across_segments(ledger_dir: &Path) -> Result<[u8; 32], SegmentError> {
    let manifest_path = ledger_dir.join("ledger_manifest.json");
    if !manifest_path.exists() {
        // Fall back to single-file ledger
        let ledger_path = ledger_dir.join("ledger.jsonl");
        if ledger_path.exists() {
            return merkle_root_from_ledger_file(&ledger_path)
                .map_err(|e| SegmentError::Serialization(e.to_string()));
        }
        return Ok([0u8; 32]);
    }

    let content = std::fs::read_to_string(&manifest_path)
        .map_err(|e| SegmentError::Serialization(e.to_string()))?;
    let manifest = serde_json::from_str::<SegmentManifest>(&content)
        .map_err(|e| SegmentError::Serialization(e.to_string()))?;

    let mut segment_roots: Vec<Vec<u8>> = Vec::new();
    for seg in &manifest.segments {
        if seg.deleted {
            continue;
        }
        let seg_path = ledger_dir.join(&seg.file_name);

        // Recompute the merkle root from the actual file content (not the
        // manifest's recorded value), so tampering is detectable.
        let seg_root = if seg_path.exists() {
            merkle_root_from_ledger_file(&seg_path)
                .map_err(|e| SegmentError::Serialization(e.to_string()))?
        } else {
            [0u8; 32]
        };
        segment_roots.push(seg_root.to_vec());
    }

    Ok(merkle_root_from_hashes(&segment_roots))
}

#[cfg(test)]
mod tests {
    use super::*;
    use core_crypto::QuantumNodeIdentity;
    use std::path::PathBuf;

    fn tmp_ledger_path() -> PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!("test_ledger_{}.jsonl", fastrand::u64(..)));
        p
    }

    #[test]
    fn test_write_and_chain_integrity() {
        let identity = QuantumNodeIdentity::generate_node_identity().unwrap();
        let path = tmp_ledger_path();
        let writer = LedgerWriter::open(&path, &identity).unwrap();

        for i in 0..10u64 {
            let event = serde_json::json!({"type": "Test", "i": i});
            let entry = writer.append(event, &identity).unwrap();
            assert_eq!(entry.seq, i);
        }

        let (next_seq, _) = writer.chain_tip().unwrap();
        assert_eq!(next_seq, 10);

        // Reopen — should resume from seq=10 with chain intact
        let writer2 = LedgerWriter::open(&path, &identity).unwrap();
        let (resumed_seq, _) = writer2.chain_tip().unwrap();
        assert_eq!(resumed_seq, 10);

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_torn_write_recovery() {
        let identity = QuantumNodeIdentity::generate_node_identity().unwrap();
        let path = tmp_ledger_path();
        {
            let writer = LedgerWriter::open(&path, &identity).unwrap();
            writer
                .append(serde_json::json!({"i": 0}), &identity)
                .unwrap();
            writer
                .append(serde_json::json!({"i": 1}), &identity)
                .unwrap();
        }

        // Simulate a torn write by appending partial JSON
        use std::io::Write;
        let mut file = std::fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .unwrap();
        file.write_all(b"{\"schema_version\": 1, \"seq\": 2")
            .unwrap();
        file.flush().unwrap();

        // Scan should detect the torn write, truncate it, and resume at seq=2
        let (next_seq, _) = scan_existing_ledger(&path).expect("Torn write recovery failed");
        assert_eq!(next_seq, 2);

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_tampered_ledger_refused() {
        let identity = QuantumNodeIdentity::generate_node_identity().unwrap();
        let path = tmp_ledger_path();
        {
            let writer = LedgerWriter::open(&path, &identity).unwrap();
            for i in 0..5u64 {
                writer
                    .append(serde_json::json!({"i": i}), &identity)
                    .unwrap();
            }
        }

        // Corrupt the first byte of line 2 (seq=1)
        let content = std::fs::read_to_string(&path).unwrap();
        let mut lines: Vec<&str> = content.lines().collect();
        let mut bad = lines[1].to_string();
        // Flip a char in the prev_hash field
        let tampered = bad.replacen("\"seq\":1", "\"seq\":999", 1);
        lines[1] = Box::leak(tampered.into_boxed_str());
        std::fs::write(&path, lines.join("\n")).unwrap();

        let result = scan_existing_ledger(&path);
        assert!(result.is_err(), "Tampered ledger must be rejected on open");

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_missing_and_duplicate_seq_refused() {
        let identity = QuantumNodeIdentity::generate_node_identity().unwrap();
        let path = tmp_ledger_path();
        {
            let writer = LedgerWriter::open(&path, &identity).unwrap();
            writer
                .append(serde_json::json!({"i": 0}), &identity)
                .unwrap();
            writer
                .append(serde_json::json!({"i": 1}), &identity)
                .unwrap();
            writer
                .append(serde_json::json!({"i": 2}), &identity)
                .unwrap();
        }

        // Delete seq=1 to test missing entry gap
        let content = std::fs::read_to_string(&path).unwrap();
        let lines: Vec<&str> = content.lines().collect();
        std::fs::write(&path, format!("{}\n{}\n", lines[0], lines[2])).unwrap();
        let result_missing = scan_existing_ledger(&path);
        assert!(result_missing
            .unwrap_err()
            .to_string()
            .contains("chain broken"));

        // Duplicate seq=1 to test duplicated seq
        std::fs::write(&path, format!("{}\n{}\n{}\n", lines[0], lines[1], lines[1])).unwrap();
        let result_duplicate = scan_existing_ledger(&path);
        assert!(result_duplicate
            .unwrap_err()
            .to_string()
            .contains("chain broken"));

        // Reordered seq=1 and seq=2
        std::fs::write(&path, format!("{}\n{}\n{}\n", lines[0], lines[2], lines[1])).unwrap();
        let result_reordered = scan_existing_ledger(&path);
        assert!(result_reordered
            .unwrap_err()
            .to_string()
            .contains("chain broken"));

        let _ = std::fs::remove_file(&path);
    }
}
