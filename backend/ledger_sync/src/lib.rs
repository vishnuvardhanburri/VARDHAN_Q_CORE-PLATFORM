//! # ledger_sync — Sprint 3
//!
//! An append-only, tamper-proof BLAKE3 Merkle audit chain with an encrypted
//! peer-sync layer that runs on top of completed [`ProxySession`] connections.
//!
//! ## Architecture
//!
//! ```text
//! ┌──────────────────────────────────────────────────────────┐
//! │                    MerkleLedger                          │
//! │   Chain: [ Block₀ ] ← [ Block₁ ] ← [ Block₂ ] ← …     │
//! │   Each block: BLAKE3(index ‖ ts ‖ prev_hash ‖           │
//! │               session_id ‖ payload_hash)                 │
//! │   + ML-DSA-87 signature over block_hash                  │
//! └──────────────┬───────────────────────────────────────────┘
//!                │  serialize (serde_json)
//! ┌──────────────▼───────────────────────────────────────────┐
//! │               LedgerSyncChannel                          │
//! │   AES-256-GCM encrypt via AeadTransport                    │
//! │   → TCP Stream                                           │
//! └──────────────────────────────────────────────────────────┘
//! ```
//!
//! ## Security Properties
//! - **Tamper-detection**: each block commits to its predecessor's hash.
//! - **Origin authentication**: every block carries an ML-DSA-87 signature.
//! - **Confidentiality**: blocks in transit are AES-256-GCM encrypted using
//!   the HKDF-derived session key from the completed post-quantum handshake.
//! - **Replay resistance**: AEAD tag and deterministic nonces prevent replayed frames.

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use blake3::Hasher;
use core_crypto::QuantumNodeIdentity;
use futures_util::{SinkExt, StreamExt};
use proxy_engine::{AeadTransport, ProxyError, SessionContext};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::net::TcpStream;
use tokio::sync::RwLock;
use tracing::{debug, info, warn};

// ─────────────────────────────────────────────────────────────────────────────
// Error type
// ─────────────────────────────────────────────────────────────────────────────

/// All errors that can arise in the ledger or sync layer.
#[derive(Error, Debug)]
pub enum LedgerError {
    #[error("Proxy engine error: {0}")]
    Proxy(#[from] ProxyError),

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("Invalid block hash at index {0}")]
    InvalidBlockHash(u64),

    #[error("Chain break: previous hash mismatch at index {0}")]
    ChainBroken(u64),

    #[error("Block signature verification failed at index {0}")]
    InvalidSignature(u64),

    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Ledger sync channel closed unexpectedly")]
    ChannelClosed,
}

// ─────────────────────────────────────────────────────────────────────────────
// LedgerBlock
// ─────────────────────────────────────────────────────────────────────────────

/// A single immutable entry in the BLAKE3 Merkle audit chain.
///
/// ## Block Hash Input
/// ```text
/// BLAKE3( index_be64 ‖ timestamp_ms_be64 ‖ prev_hash ‖ session_id ‖ payload_hash )
/// ```
///
/// The `dsa_signature` is an ML-DSA-87 signature over `block_hash` produced
/// by the originating node's private key. Verification requires the
/// corresponding DSA public key.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LedgerBlock {
    /// Sequential 0-based index in the chain.
    pub index: u64,
    /// UNIX epoch milliseconds at block creation.
    pub timestamp_ms: u64,
    /// `block_hash` of the previous block (all-zeros for the genesis block).
    pub prev_hash: [u8; 32],
    /// 32-byte session identifier derived from the associated `ProxySession`.
    pub session_id: [u8; 32],
    /// BLAKE3 hash of the raw payload bytes.
    pub payload_hash: [u8; 32],
    /// BLAKE3 hash committing to all structural fields above.
    pub block_hash: [u8; 32],
    /// ML-DSA-87 signature over `block_hash`.
    pub dsa_signature: Vec<u8>,
}

impl LedgerBlock {
    /// Compute the canonical binary representation (CBR) of the block structural fields.
    ///
    /// Format: index (u64 BE) || timestamp_ms (u64 BE) || prev_hash (32 B) || session_id (32 B) || payload_hash (32 B)
    /// Total size: 8 + 8 + 32 + 32 + 32 = 112 bytes.
    pub fn to_canonical_bytes(&self) -> [u8; 112] {
        let mut bytes = [0u8; 112];
        bytes[0..8].copy_from_slice(&self.index.to_be_bytes());
        bytes[8..16].copy_from_slice(&self.timestamp_ms.to_be_bytes());
        bytes[16..48].copy_from_slice(&self.prev_hash);
        bytes[48..80].copy_from_slice(&self.session_id);
        bytes[80..112].copy_from_slice(&self.payload_hash);
        bytes
    }
    // ── Construction ─────────────────────────────────────────────────────────

    /// Compute the canonical BLAKE3 block hash from its structural fields.
    pub fn compute_hash(
        index: u64,
        timestamp_ms: u64,
        prev_hash: &[u8; 32],
        session_id: &[u8; 32],
        payload_hash: &[u8; 32],
    ) -> [u8; 32] {
        let mut bytes = [0u8; 112];
        bytes[0..8].copy_from_slice(&index.to_be_bytes());
        bytes[8..16].copy_from_slice(&timestamp_ms.to_be_bytes());
        bytes[16..48].copy_from_slice(prev_hash);
        bytes[48..80].copy_from_slice(session_id);
        bytes[80..112].copy_from_slice(payload_hash);
        *blake3::hash(&bytes).as_bytes()
    }

    /// Create and sign a new ledger block.
    ///
    /// - `index`:        position in the chain (must equal current chain length)
    /// - `timestamp_ms`: caller-supplied UNIX ms timestamp
    /// - `prev_hash`:    `block_hash` of the predecessor (or `[0u8; 32]` for genesis)
    /// - `session_id`:   32-byte identifier for the originating `ProxySession`
    /// - `payload`:      arbitrary application data (hashed, not stored in full)
    /// - `identity`:     the originating node (signs the block hash)
    pub fn new(
        index: u64,
        timestamp_ms: u64,
        prev_hash: [u8; 32],
        session_id: [u8; 32],
        payload: &[u8],
        identity: &QuantumNodeIdentity,
    ) -> Result<Self, LedgerError> {
        let payload_hash = *blake3::hash(payload).as_bytes();
        let block_hash =
            Self::compute_hash(index, timestamp_ms, &prev_hash, &session_id, &payload_hash);
        let dsa_signature = identity
            .sign_payload(&block_hash)
            .map_err(|e| ProxyError::Crypto(e.to_string()))?;

        debug!(index, "LedgerBlock created");
        Ok(Self {
            index,
            timestamp_ms,
            prev_hash,
            session_id,
            payload_hash,
            block_hash,
            dsa_signature,
        })
    }

    /// Convenience constructor that uses the current wall-clock time.
    pub fn new_now(
        index: u64,
        prev_hash: [u8; 32],
        session_id: [u8; 32],
        payload: &[u8],
        identity: &QuantumNodeIdentity,
    ) -> Result<Self, LedgerError> {
        let timestamp_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        Self::new(
            index,
            timestamp_ms,
            prev_hash,
            session_id,
            payload,
            identity,
        )
    }

    // ── Verification ─────────────────────────────────────────────────────────

    /// Verify the structural integrity and ML-DSA-87 signature of this block.
    ///
    /// Returns `Ok(())` if:
    /// 1. `block_hash` matches the recomputed BLAKE3 hash.
    /// 2. `dsa_signature` is a valid ML-DSA-87 signature over `block_hash`
    ///    under `dsa_pub_key`.
    pub fn verify(&self, dsa_pub_key: &[u8]) -> Result<(), LedgerError> {
        // 1. Recompute and compare block hash
        let computed = Self::compute_hash(
            self.index,
            self.timestamp_ms,
            &self.prev_hash,
            &self.session_id,
            &self.payload_hash,
        );
        if computed != self.block_hash {
            warn!(index = self.index, "Block hash mismatch");
            return Err(LedgerError::InvalidBlockHash(self.index));
        }

        // 2. Verify ML-DSA-87 signature
        if !QuantumNodeIdentity::verify_signature(
            dsa_pub_key,
            &self.block_hash,
            &self.dsa_signature,
        ) {
            warn!(index = self.index, "Block signature invalid");
            return Err(LedgerError::InvalidSignature(self.index));
        }

        Ok(())
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MerkleLedger
// ─────────────────────────────────────────────────────────────────────────────

/// Thread-safe, append-only BLAKE3 Merkle audit chain.
///
/// Internally protected by a `tokio::sync::RwLock` so multiple readers can
/// inspect the chain concurrently while writes are exclusive.
///
/// Invariants maintained on every `append_block`:
/// - `block.index == chain.len()` (no gaps, no duplicates)
/// - `block.prev_hash == chain.last().block_hash` (chain continuity)
/// - `block.verify(dsa_pub_key)` passes (hash + signature)
#[derive(Clone)]
pub struct MerkleLedger {
    chain: Arc<RwLock<Vec<LedgerBlock>>>,
}

impl Default for MerkleLedger {
    fn default() -> Self {
        Self::new()
    }
}

impl MerkleLedger {
    /// Create an empty ledger.
    pub fn new() -> Self {
        Self {
            chain: Arc::new(RwLock::new(Vec::new())),
        }
    }

    /// Returns the `block_hash` of the most recent block, or `[0u8; 32]` if
    /// the chain is empty (genesis predecessor).
    pub async fn latest_hash(&self) -> [u8; 32] {
        self.chain
            .read()
            .await
            .last()
            .map(|b| b.block_hash)
            .unwrap_or([0u8; 32])
    }

    /// Returns the number of blocks in the chain.
    pub async fn len(&self) -> usize {
        self.chain.read().await.len()
    }

    /// Returns `true` if the chain has no blocks.
    pub async fn is_empty(&self) -> bool {
        self.chain.read().await.is_empty()
    }

    /// Returns a snapshot clone of the block at `index`, or `None`.
    pub async fn get_block(&self, index: usize) -> Option<LedgerBlock> {
        self.chain.read().await.get(index).cloned()
    }

    /// Append a pre-verified block to the chain.
    ///
    /// Enforces only invariants 1 and 2 (sequential index, chain continuity).
    /// Signature verification is assumed to have already been performed by the
    /// caller (e.g., in a `spawn_blocking` task) to avoid blocking the
    /// single-threaded async runtime with CPU-bound ML-DSA verification.
    pub async fn append_verified_block(&self, block: LedgerBlock) -> Result<(), LedgerError> {
        let mut write = self.chain.write().await;

        let expected_index = write.len() as u64;
        if block.index != expected_index {
            return Err(LedgerError::InvalidBlockHash(block.index));
        }

        let expected_prev = write.last().map(|b| b.block_hash).unwrap_or([0u8; 32]);
        if block.prev_hash != expected_prev {
            return Err(LedgerError::ChainBroken(block.index));
        }

        write.push(block);
        Ok(())
    }

    /// Append a verified block to the chain.
    ///
    /// Enforces all three chain invariants before inserting. Returns an
    /// error if any invariant is violated — the chain is **not** modified.
    pub async fn append_block(
        &self,
        block: LedgerBlock,
        dsa_pub_key: &[u8],
    ) -> Result<(), LedgerError> {
        let mut write = self.chain.write().await;

        // Invariant 1: sequential index
        let expected_index = write.len() as u64;
        if block.index != expected_index {
            return Err(LedgerError::InvalidBlockHash(block.index));
        }

        // Invariant 2: chain continuity
        let expected_prev = write.last().map(|b| b.block_hash).unwrap_or([0u8; 32]);
        if block.prev_hash != expected_prev {
            return Err(LedgerError::ChainBroken(block.index));
        }

        // Invariant 3: hash + signature validity
        block.verify(dsa_pub_key)?;

        info!(index = block.index, "Appending verified block to ledger");
        write.push(block);
        Ok(())
    }

    /// Verify the complete chain from genesis to tip.
    ///
    /// Checks:
    /// - Every block's index is sequential.
    /// - Every `prev_hash` links to the actual predecessor `block_hash`.
    /// - Every block's hash and signature are valid under `dsa_pub_key`.
    pub async fn verify_chain_integrity(&self, dsa_pub_key: &[u8]) -> Result<(), LedgerError> {
        let read = self.chain.read().await;
        let mut prev_hash = [0u8; 32];

        for (idx, block) in read.iter().enumerate() {
            if block.index != idx as u64 {
                return Err(LedgerError::InvalidBlockHash(block.index));
            }
            if block.prev_hash != prev_hash {
                return Err(LedgerError::ChainBroken(block.index));
            }
            block.verify(dsa_pub_key)?;
            prev_hash = block.block_hash;
        }

        info!(chain_len = read.len(), "Chain integrity verified");
        Ok(())
    }

    /// Compute the Merkle root of the current chain.
    ///
    /// Pairs adjacent block hashes and hashes them together, recursively,
    /// until a single 32-byte root remains. An empty chain returns
    /// `[0u8; 32]`. A single-block chain returns that block's hash.
    pub async fn merkle_root(&self) -> [u8; 32] {
        let read = self.chain.read().await;
        if read.is_empty() {
            return [0u8; 32];
        }

        let mut layer: Vec<[u8; 32]> = read.iter().map(|b| b.block_hash).collect();

        while layer.len() > 1 {
            let mut next = Vec::with_capacity((layer.len() + 1) / 2);
            let mut chunks = layer.chunks_exact(2);
            for pair in chunks.by_ref() {
                let mut hasher = Hasher::new();
                hasher.update(&pair[0]);
                hasher.update(&pair[1]);
                next.push(*hasher.finalize().as_bytes());
            }
            // Carry the odd element up unchanged (standard Bitcoin-style Merkle)
            if let Some(remainder) = chunks.remainder().first() {
                next.push(*remainder);
            }
            layer = next;
        }

        layer[0]
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// LedgerSyncChannel
// ─────────────────────────────────────────────────────────────────────────────

/// Encrypted ledger-block synchronization channel.
///
/// Wraps an authenticated [`AeadTransport`] providing encrypted communication
/// between peers.
pub struct LedgerSyncChannel {
    transport: AeadTransport,
}

impl LedgerSyncChannel {
    /// Construct from a live \`TcpStream\` and the session key produced by a
    /// completed \`ProxySession\`.
    pub fn new(stream: TcpStream, ctx: &SessionContext, is_responder: bool) -> Self {
        let (tx_key, rx_key) = if is_responder {
            (
                ctx.server_to_client_key.clone(),
                ctx.client_to_server_key.clone(),
            )
        } else {
            (
                ctx.client_to_server_key.clone(),
                ctx.server_to_client_key.clone(),
            )
        };
        Self {
            transport: AeadTransport::new(
                stream,
                *tx_key,
                *rx_key,
                ctx.session_id,
                ctx.session_salt,
                !is_responder,
            ),
        }
    }

    /// Serialize and encrypt \`block\`, then send it as a single framed message.
    pub async fn send_block(&mut self, block: &LedgerBlock) -> Result<(), LedgerError> {
        let json = serde_json::to_vec(block)?;
        self.transport.write_frame(&json).await?;
        Ok(())
    }

    /// Receive one encrypted frame, decrypt it, and deserialize the block.
    ///
    /// Returns \`Ok(None)\` when the remote peer closed the connection cleanly.
    pub async fn recv_block(&mut self) -> Result<Option<LedgerBlock>, LedgerError> {
        match self.transport.read_frame().await {
            Ok(Some(data)) => {
                let block: LedgerBlock = serde_json::from_slice(&data)?;
                Ok(Some(block))
            }
            Ok(None) => Ok(None),
            Err(e) => Err(LedgerError::Proxy(e)),
        }
    }

    /// Close the channel.
    pub async fn close(&mut self) -> Result<(), LedgerError> {
        // Drop transport to close stream
        // In a real implementation, we might call shutdown on the inner stream.
        // For now, we just let the transport be dropped.
        Ok(())
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: current timestamp in milliseconds
// ─────────────────────────────────────────────────────────────────────────────

/// Returns the current UNIX timestamp in milliseconds.
pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

// ─────────────────────────────────────────────────────────────────────────────
// Unit tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── LedgerBlock ──────────────────────────────────────────────────────────

    /// Genesis block round-trip: create → verify.
    #[test]
    fn test_genesis_block_create_and_verify() {
        let node = QuantumNodeIdentity::generate_node_identity().unwrap();
        let pub_key = node.dsa_public_key_bytes();

        let block = LedgerBlock::new(0, 1000, [0u8; 32], [1u8; 32], b"genesis", &node).unwrap();

        assert_eq!(block.index, 0);
        assert_eq!(block.prev_hash, [0u8; 32]);
        assert!(block.verify(&pub_key).is_ok());
    }

    /// \`compute_hash\` must be deterministic.
    #[test]
    fn test_block_hash_deterministic() {
        let h1 = LedgerBlock::compute_hash(0, 1000, &[0u8; 32], &[1u8; 32], &[2u8; 32]);
        let h2 = LedgerBlock::compute_hash(0, 1000, &[0u8; 32], &[1u8; 32], &[2u8; 32]);
        assert_eq!(h1, h2);
        assert_ne!(h1, [0u8; 32]);
    }

    /// Different payloads must produce different hashes.
    #[test]
    fn test_block_hash_payload_sensitivity() {
        let h1 = LedgerBlock::compute_hash(0, 1000, &[0u8; 32], &[1u8; 32], &[0u8; 32]);
        let h2 = LedgerBlock::compute_hash(0, 1000, &[0u8; 32], &[1u8; 32], &[0xFF; 32]);
        assert_ne!(h1, h2);
    }

    /// Tampered \`block_hash\` field must fail structural verification.
    #[test]
    fn test_tampered_block_hash_detected() {
        let node = QuantumNodeIdentity::generate_node_identity().unwrap();
        let pub_key = node.dsa_public_key_bytes();
        let mut block = LedgerBlock::new(0, 1000, [0u8; 32], [1u8; 32], b"payload", &node).unwrap();
        block.block_hash[0] ^= 0xFF; // corrupt the hash
        assert!(matches!(
            block.verify(&pub_key),
            Err(LedgerError::InvalidBlockHash(0))
        ));
    }

    /// Tampered payload must cause signature verification failure
    /// (payload_hash will mismatch → block_hash mismatch).
    #[test]
    fn test_tampered_payload_hash_detected() {
        let node = QuantumNodeIdentity::generate_node_identity().unwrap();
        let pub_key = node.dsa_public_key_bytes();
        let mut block = LedgerBlock::new(0, 1000, [0u8; 32], [1u8; 32], b"payload", &node).unwrap();
        block.payload_hash[0] ^= 0xFF; // corrupt payload_hash → block_hash will mismatch
        assert!(block.verify(&pub_key).is_err());
    }

    /// Wrong DSA public key must fail signature verification.
    #[test]
    fn test_wrong_dsa_key_fails_verification() {
        let signer = QuantumNodeIdentity::generate_node_identity().unwrap();
        let impostor = QuantumNodeIdentity::generate_node_identity().unwrap();
        let block = LedgerBlock::new(0, 1000, [0u8; 32], [1u8; 32], b"payload", &signer).unwrap();
        let impostor_pub = impostor.dsa_public_key_bytes();
        assert!(matches!(
            block.verify(&impostor_pub),
            Err(LedgerError::InvalidSignature(0))
        ));
    }

    // ── MerkleLedger ─────────────────────────────────────────────────────────

    /// Two-block chain: append, len, integrity check.
    #[tokio::test]
    async fn test_ledger_append_and_chain_integrity() {
        let node = QuantumNodeIdentity::generate_node_identity().unwrap();
        let pub_key = node.dsa_public_key_bytes();
        let ledger = MerkleLedger::new();

        let block_0 =
            LedgerBlock::new(0, 1000, [0u8; 32], [1u8; 32], b"TX_0_PAYLOAD", &node).unwrap();
        ledger
            .append_block(block_0.clone(), &pub_key)
            .await
            .unwrap();

        let block_1 = LedgerBlock::new(
            1,
            1001,
            block_0.block_hash,
            [1u8; 32],
            b"TX_1_PAYLOAD",
            &node,
        )
        .unwrap();
        ledger.append_block(block_1, &pub_key).await.unwrap();

        assert_eq!(ledger.len().await, 2);
        assert!(ledger.verify_chain_integrity(&pub_key).await.is_ok());
    }

    /// Tampered \`prev_hash\` must be rejected with \`ChainBroken\`.
    #[tokio::test]
    async fn test_ledger_rejects_tampered_prev_hash() {
        let node = QuantumNodeIdentity::generate_node_identity().unwrap();
        let pub_key = node.dsa_public_key_bytes();
        let ledger = MerkleLedger::new();

        let block_0 = LedgerBlock::new(0, 1000, [0u8; 32], [1u8; 32], b"TX_0", &node).unwrap();
        ledger.append_block(block_0, &pub_key).await.unwrap();

        // Wrong prev_hash: [0xFF; 32] instead of block_0.block_hash
        let tampered = LedgerBlock::new(1, 1001, [0xFF; 32], [1u8; 32], b"TX_1", &node).unwrap();
        let err = ledger.append_block(tampered, &pub_key).await;
        assert!(
            matches!(err, Err(LedgerError::ChainBroken(1))),
            "Expected ChainBroken, got {err:?}"
        );
    }

    /// Duplicate index must be rejected.
    #[tokio::test]
    async fn test_ledger_rejects_duplicate_index() {
        let node = QuantumNodeIdentity::generate_node_identity().unwrap();
        let pub_key = node.dsa_public_key_bytes();
        let ledger = MerkleLedger::new();

        let block_0 = LedgerBlock::new(0, 1000, [0u8; 32], [1u8; 32], b"TX_0", &node).unwrap();
        ledger
            .append_block(block_0.clone(), &pub_key)
            .await
            .unwrap();

        // Re-append block at index 0
        let err = ledger.append_block(block_0, &pub_key).await;
        assert!(matches!(err, Err(LedgerError::InvalidBlockHash(0))));
    }

    /// A block signed by the wrong key must be rejected.
    #[tokio::test]
    async fn test_ledger_rejects_invalid_signature() {
        let signer = QuantumNodeIdentity::generate_node_identity().unwrap();
        let verifier = QuantumNodeIdentity::generate_node_identity().unwrap();
        let verifier_pub = verifier.dsa_public_key_bytes();
        let ledger = MerkleLedger::new();

        // Block signed by `signer` but appended with `verifier_pub` → sig check fails
        let block = LedgerBlock::new(0, 1000, [0u8; 32], [1u8; 32], b"TX", &signer).unwrap();
        let err = ledger.append_block(block, &verifier_pub).await;
        assert!(matches!(err, Err(LedgerError::InvalidSignature(0))));
    }

    /// \`is_empty\` on a fresh ledger, non-empty after append.
    #[tokio::test]
    async fn test_ledger_is_empty() {
        let membership = MerkleLedger::new();
        assert!(membership.is_empty().await);
        let node = QuantumNodeIdentity::generate_node_identity().unwrap();
        let pub_key = node.dsa_public_key_bytes();
        let b = LedgerBlock::new(0, 0, [0u8; 32], [0u8; 32], b"x", &node).unwrap();
        membership.append_block(b, &pub_key).await.unwrap();
        assert!(!membership.is_empty().await);
    }

    /// Merkle root must be non-trivial for a two-block chain.
    #[tokio::test]
    async fn test_merkle_root_two_blocks() {
        let node = QuantumNodeIdentity::generate_node_identity().unwrap();
        let pub_key = node.dsa_public_key_bytes();
        let ledger = MerkleLedger::new();
        assert_eq!(ledger.merkle_root().await, [0u8; 32]); // empty

        let b0 = LedgerBlock::new(0, 1, [0u8; 32], [0u8; 32], b"a", &node).unwrap();
        ledger.append_block(b0.clone(), &pub_key).await.unwrap();
        let root_single = ledger.merkle_root().await;
        assert_eq!(root_single, b0.block_hash); // single-block root == block hash

        let b1 = LedgerBlock::new(1, 2, b0.block_hash, [0u8; 32], b"b", &node).unwrap();
        ledger.append_block(b1, &pub_key).await.unwrap();
        let root_two = ledger.merkle_root().await;
        assert_ne!(root_two, [0u8; 32]);
        assert_ne!(root_two, root_single, "Root must change when chain grows");
    }

    /// \`get_block\` returns the correct block.
    #[tokio::test]
    async fn test_get_block() {
        let node = QuantumNodeIdentity::generate_node_identity().unwrap();
        let pub_key = node.dsa_public_key_bytes();
        let ledger = MerkleLedger::new();

        let b0 = LedgerBlock::new(0, 1, [0u8; 32], [0u8; 32], b"data", &node).unwrap();
        ledger.append_block(b0.clone(), &pub_key).await.unwrap();

        let retrieved = ledger.get_block(0).await.unwrap();
        assert_eq!(retrieved, b0);
        assert!(ledger.get_block(1).await.is_none());
    }
}
