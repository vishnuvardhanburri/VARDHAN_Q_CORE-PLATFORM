//! Integration tests for `ledger_sync`.
//!
//! These tests run the full stack end-to-end:
//!
//! 1. Post-quantum handshake (`proxy_engine`)
//! 2. Merkle chain operations (`MerkleLedger`)
//! 3. Encrypted block synchronization over loopback TCP (`LedgerSyncChannel`)
//!
//! Verified scenarios:
//! - Honest two-node ledger sync: blocks traverse the encrypted channel intact.
//! - Chain integrity after multi-block sync.
//! - Rejection of blocks with wrong `prev_hash`.
//! - Rejection of blocks with invalid DSA signatures.
//! - Bidirectional sync: both nodes append to their own ledger.
//! - Multi-block pipeline: sender pushes N blocks, receiver collects all.

use core_crypto::QuantumNodeIdentity;
use ledger_sync::{LedgerBlock, LedgerSyncChannel, MerkleLedger};
use proxy_engine::{run_initiator, run_responder};
use tokio::net::{TcpListener, TcpStream};

// ─────────────────────────────────────────────────────────────────────────────
// Helper: bind a listener on OS-chosen port
// ─────────────────────────────────────────────────────────────────────────────

async fn bind() -> (TcpListener, std::net::SocketAddr) {
    let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let a = l.local_addr().unwrap();
    (l, a)
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 1: basic ledger build & chain integrity (unit-style, no network)
// ─────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn test_ledger_append_and_chain_integrity() {
    let node = QuantumNodeIdentity::generate_node_identity().unwrap();
    let pub_key = node.dsa_public_key_bytes();
    let ledger = MerkleLedger::new();

    let b0 = LedgerBlock::new(0, 1000, [0u8; 32], [1u8; 32], b"TX_0_PAYLOAD", &node).unwrap();
    ledger.append_block(b0.clone(), &pub_key).await.unwrap();

    let b1 = LedgerBlock::new(1, 1001, b0.block_hash, [1u8; 32], b"TX_1_PAYLOAD", &node).unwrap();
    ledger.append_block(b1, &pub_key).await.unwrap();

    assert_eq!(ledger.len().await, 2);
    assert!(ledger.verify_chain_integrity(&pub_key).await.is_ok());
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 2: tampered prev_hash rejected
// ─────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn test_ledger_rejects_tampered_prev_hash() {
    let node = QuantumNodeIdentity::generate_node_identity().unwrap();
    let pub_key = node.dsa_public_key_bytes();
    let ledger = MerkleLedger::new();

    let b0 = LedgerBlock::new(0, 1000, [0u8; 32], [1u8; 32], b"TX_0", &node).unwrap();
    ledger.append_block(b0, &pub_key).await.unwrap();

    // prev_hash deliberately wrong
    let tampered = LedgerBlock::new(1, 1001, [0xFF; 32], [1u8; 32], b"TX_1", &node).unwrap();
    assert!(ledger.append_block(tampered, &pub_key).await.is_err());
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 3: encrypted single-block sync over post-quantum session
// ─────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn test_encrypted_ledger_sync_over_quantum_session() {
    let (listener, addr) = bind().await;

    let server_id = QuantumNodeIdentity::generate_node_identity().unwrap();
    let client_id = QuantumNodeIdentity::generate_node_identity().unwrap();
    let client_pub_key = client_id.dsa_public_key_bytes();

    let block_to_send = LedgerBlock::new(
        0,
        5000,
        [0u8; 32],
        [9u8; 32],
        b"QUANTUM_STATE_SYNC",
        &client_id,
    )
    .unwrap();
    let block_clone = block_to_send.clone();

    // Server: handshake then receive one block
    let server_handle = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let session = run_responder(&mut stream, &server_id).await.unwrap();
        let mut channel = LedgerSyncChannel::new(stream, &session, true);
        channel.recv_block().await.unwrap().unwrap()
    });

    // Client: handshake then send one block
    let mut client_stream = TcpStream::connect(addr).await.unwrap();
    let client_session = run_initiator(&mut client_stream, &client_id).await.unwrap();
    let mut client_channel = LedgerSyncChannel::new(client_stream, &client_session, false);
    client_channel.send_block(&block_to_send).await.unwrap();

    let received = server_handle.await.unwrap();
    assert_eq!(
        received, block_clone,
        "Received block must equal sent block"
    );
    assert!(
        received.verify(&client_pub_key).is_ok(),
        "Received block must pass signature verification"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 4: server appends received blocks into its own ledger
// ─────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn test_server_appends_received_blocks_to_ledger() {
    let (listener, addr) = bind().await;

    let server_id = QuantumNodeIdentity::generate_node_identity().unwrap();
    let client_id = QuantumNodeIdentity::generate_node_identity().unwrap();
    let client_pub_key_for_server = client_id.dsa_public_key_bytes();
    let client_pub_key_for_check = client_id.dsa_public_key_bytes();

    // Build a 3-block chain client-side
    let b0 = LedgerBlock::new(0, 100, [0u8; 32], [7u8; 32], b"STATE_A", &client_id).unwrap();
    let b1 = LedgerBlock::new(1, 101, b0.block_hash, [7u8; 32], b"STATE_B", &client_id).unwrap();
    let b2 = LedgerBlock::new(2, 102, b1.block_hash, [7u8; 32], b"STATE_C", &client_id).unwrap();
    let blocks = vec![b0, b1, b2];

    let server_ledger = MerkleLedger::new();
    let server_ledger_clone = server_ledger.clone();

    let server_handle = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let session = run_responder(&mut stream, &server_id).await.unwrap();
        let mut channel = LedgerSyncChannel::new(stream, &session, true);

        // Receive 3 blocks and append each to ledger
        for _ in 0..3usize {
            let block = channel.recv_block().await.unwrap().unwrap();
            server_ledger_clone
                .append_block(block, &client_pub_key_for_server)
                .await
                .unwrap();
        }
    });

    let mut conn = TcpStream::connect(addr).await.unwrap();
    let session = run_initiator(&mut conn, &client_id).await.unwrap();
    let mut channel = LedgerSyncChannel::new(conn, &session, false);

    for b in &blocks {
        channel.send_block(b).await.unwrap();
    }

    server_handle.await.unwrap();

    assert_eq!(server_ledger.len().await, 3);
    assert!(
        server_ledger
            .verify_chain_integrity(&client_pub_key_for_check)
            .await
            .is_ok(),
        "Server ledger must be intact after sync"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 5: block with invalid signature is rejected by append
// ─────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn test_received_block_with_wrong_signature_rejected() {
    let node_a = QuantumNodeIdentity::generate_node_identity().unwrap();
    let node_b = QuantumNodeIdentity::generate_node_identity().unwrap();
    let pub_key_b = node_b.dsa_public_key_bytes();
    let ledger = MerkleLedger::new();

    // Block signed by `node_a` but we verify with `pub_key_b`
    let block = LedgerBlock::new(0, 1, [0u8; 32], [0u8; 32], b"data", &node_a).unwrap();
    let err = ledger.append_block(block, &pub_key_b).await;
    assert!(
        err.is_err(),
        "Block with wrong signature must not be appended"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 6: bidirectional sync — client and server each send a block
// ─────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn test_bidirectional_ledger_sync() {
    let (listener, addr) = bind().await;

    let server_id = QuantumNodeIdentity::generate_node_identity().unwrap();
    let client_id = QuantumNodeIdentity::generate_node_identity().unwrap();

    let server_block =
        LedgerBlock::new(0, 200, [0u8; 32], [0xAA; 32], b"SERVER_TX", &server_id).unwrap();
    let client_block =
        LedgerBlock::new(0, 201, [0u8; 32], [0xBB; 32], b"CLIENT_TX", &client_id).unwrap();

    let server_block_clone = server_block.clone();
    let client_pub_for_server = client_id.dsa_public_key_bytes();
    let server_pub_for_client = server_id.dsa_public_key_bytes();
    let client_block_clone = client_block.clone();

    let server_handle = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let session = run_responder(&mut stream, &server_id).await.unwrap();
        let mut ch = LedgerSyncChannel::new(stream, &session, true);
        // Server sends its block
        ch.send_block(&server_block_clone).await.unwrap();
        // Server receives client's block
        let recv = ch.recv_block().await.unwrap().unwrap();
        (recv, client_pub_for_server)
    });

    let mut conn = TcpStream::connect(addr).await.unwrap();
    let session = run_initiator(&mut conn, &client_id).await.unwrap();
    let mut ch = LedgerSyncChannel::new(conn, &session, false);

    // Client receives server block, then sends its own
    let recv_server_block = ch.recv_block().await.unwrap().unwrap();
    ch.send_block(&client_block).await.unwrap();

    let (recv_client_block, client_pub) = server_handle.await.unwrap();

    // Validate cross-verified blocks
    assert_eq!(recv_server_block, server_block);
    assert!(recv_server_block.verify(&server_pub_for_client).is_ok());

    assert_eq!(recv_client_block, client_block_clone);
    assert!(recv_client_block.verify(&client_pub).is_ok());
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 7: multi-block pipeline (N=5 blocks sent, all received in order)
// ─────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn test_multi_block_pipeline() {
    const N: usize = 5;
    let (listener, addr) = bind().await;

    let server_id = QuantumNodeIdentity::generate_node_identity().unwrap();
    let client_id = QuantumNodeIdentity::generate_node_identity().unwrap();
    let client_pub_key = client_id.dsa_public_key_bytes();

    // Build N-block chain
    let mut blocks = Vec::with_capacity(N);
    let mut prev = [0u8; 32];
    for i in 0..N {
        let payload = format!("TX_{i}");
        let b = LedgerBlock::new(
            i as u64,
            i as u64 * 100,
            prev,
            [3u8; 32],
            payload.as_bytes(),
            &client_id,
        )
        .unwrap();
        prev = b.block_hash;
        blocks.push(b);
    }
    let blocks_clone = blocks.clone();

    let server_handle = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let session = run_responder(&mut stream, &server_id).await.unwrap();
        let mut ch = LedgerSyncChannel::new(stream, &session, true);
        let server_ledger = MerkleLedger::new();
        for _ in 0..N {
            let b = ch.recv_block().await.unwrap().unwrap();
            server_ledger
                .append_block(b, &client_pub_key)
                .await
                .unwrap();
        }
        server_ledger
    });

    let mut conn = TcpStream::connect(addr).await.unwrap();
    let session = run_initiator(&mut conn, &client_id).await.unwrap();
    let mut ch = LedgerSyncChannel::new(conn, &session, false);
    for b in &blocks {
        ch.send_block(b).await.unwrap();
    }

    let server_ledger = server_handle.await.unwrap();

    assert_eq!(server_ledger.len().await, N);
    let client_pub_final = client_id.dsa_public_key_bytes();
    assert!(server_ledger
        .verify_chain_integrity(&client_pub_final)
        .await
        .is_ok());

    // Verify each block individually
    for (i, expected) in blocks_clone.iter().enumerate() {
        let actual = server_ledger.get_block(i).await.unwrap();
        assert_eq!(actual, *expected, "Block {i} mismatch after sync");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 8: Merkle root changes as chain grows
// ─────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn test_merkle_root_evolves_on_append() {
    let node = QuantumNodeIdentity::generate_node_identity().unwrap();
    let pub_key = node.dsa_public_key_bytes();
    let ledger = MerkleLedger::new();

    assert_eq!(ledger.merkle_root().await, [0u8; 32]);

    let mut prev = [0u8; 32];
    let mut roots = Vec::new();
    for i in 0..4u64 {
        let b = LedgerBlock::new(i, i * 10, prev, [0u8; 32], &[i as u8; 8], &node).unwrap();
        prev = b.block_hash;
        ledger.append_block(b, &pub_key).await.unwrap();
        roots.push(ledger.merkle_root().await);
    }

    // Every root must be distinct as the chain grows
    let mut seen = std::collections::HashSet::new();
    for r in &roots {
        assert!(seen.insert(r), "Duplicate Merkle root detected");
    }
}
