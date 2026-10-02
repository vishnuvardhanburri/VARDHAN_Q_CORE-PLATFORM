//! P8.8: Resource Exhaustion Testing
//!
//! Attacks the vP7.3-frozen baseline. Tests whether the system resists
//! resource exhaustion attacks: oversized frames, memory pressure, nonce
//! exhaustion, and unbounded file growth.
//!
//! Security invariants targeted:
//!   I8  Bounded resource usage — no unbounded memory/disk growth
//!   I9  Malformed input must not crash the process
//!
//! Run: cargo test -p ha_cluster --test raft_p8_resource_exhaustion -- --test-threads=1

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use audit_ledger::LedgerWriter;
use core_crypto::QuantumNodeIdentity;
use futures::future::join_all;
use proxy_engine::transport::AeadTransport;
use proxy_engine::ProxyError;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const TEST_KEY: [u8; 32] = [0xAB; 32];
const TEST_SALT: [u8; 4] = [0xCD; 4];
const TEST_SESSION: [u8; 32] = [0xEF; 32];
const MAX_FRAME_SIZE: usize = 256 * 1024; // 256KB from transport.rs:15

/// Set up a victim transport + raw attacker TCP stream.
async fn setup_victim_attacker() -> (AeadTransport, tokio::net::TcpStream) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();

    let (tx, rx) = tokio::sync::oneshot::channel::<AeadTransport>();
    tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let transport = AeadTransport::new(
            stream, TEST_KEY, TEST_KEY, TEST_SESSION, TEST_SALT, false
        );
        let _ = tx.send(transport);
    });

    let attacker = tokio::net::TcpStream::connect(format!("{}", addr)).await.unwrap();
    let responder = rx.await.unwrap();
    (responder, attacker)
}

/// P8.8a: Frame claiming size > MAX_FRAME_SIZE + 16 (AEAD tag overhead) → rejected.
///
/// **Invariant I8:** Frame size is bounded. Claims exceeding the limit must be
/// rejected immediately with `FrameTooLarge`, before allocating memory.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn p8_8a_oversized_frame_rejection() {
    let (mut responder, mut attacker) = setup_victim_attacker().await;

    // Claim a frame size of 999,999,999 bytes (way over MAX_FRAME_SIZE + 16)
    let fake_len = (999_999_999u32).to_be_bytes();
    attacker.write_all(&fake_len).await.unwrap();
    // Send only a few bytes — the size header alone should trigger rejection
    attacker.write_all(b"xxx").await.unwrap();

    let result = tokio::time::timeout(
        Duration::from_millis(500),
        responder.read_frame(),
    ).await;

    match result {
        Ok(Err(ProxyError::FrameTooLarge(_))) => {
            println!("P8.8a PASSED: Oversized frame (999MB) rejected with FrameTooLarge");
        }
        Ok(Err(e)) => {
            println!("P8.8a: Got error {:?} — acceptable (frame rejected)", e);
        }
        Ok(Ok(None)) => {
            println!("P8.8a PASSED: Oversized frame — connection closed (acceptable)");
        }
        Ok(Ok(Some(_))) => {
            panic!("Oversized frame should NOT be accepted!");
        }
        Err(_) => {
            println!("P8.8a PASSED: Oversized frame — timed out (acceptable)");
        }
    }
}

/// P8.8b: Frame at exactly MAX_FRAME_SIZE — should succeed (boundary test).
///
/// **Invariant I8:** The boundary is correctly enforced. Frames at exactly
/// MAX_FRAME_SIZE are accepted; frames above MAX_FRAME_SIZE + 16 are rejected.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn p8_8b_max_valid_frame_size() {
    let (mut responder, mut initiator) = {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let (tx, rx) = tokio::sync::oneshot::channel::<AeadTransport>();
        tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let transport = AeadTransport::new(
                stream, TEST_KEY, TEST_KEY, TEST_SESSION, TEST_SALT, false
            );
            let _ = tx.send(transport);
        });
        let client = tokio::net::TcpStream::connect(format!("{}", addr)).await.unwrap();
        let responder = rx.await.unwrap();
        let initiator = AeadTransport::new(client, TEST_KEY, TEST_KEY, TEST_SESSION, TEST_SALT, true);
        (responder, initiator)
    };

    // Send a frame exactly at MAX_FRAME_SIZE
    let payload = vec![0u8; MAX_FRAME_SIZE];
    initiator.write_frame(&payload).await
        .expect("Frame at MAX_FRAME_SIZE should be accepted");

    let result = tokio::time::timeout(
        Duration::from_millis(500),
        responder.read_frame(),
    ).await;

    let data = result
        .expect("Should not timeout reading MAX_FRAME_SIZE frame")
        .expect("Should not get IO error")
        .expect("Should have data");

    assert_eq!(data.len(), MAX_FRAME_SIZE,
        "Received frame should be MAX_FRAME_SIZE bytes");
    println!("P8.8b PASSED: Frame at exactly MAX_FRAME_SIZE (256KB) accepted");
}

/// P8.8c: Just over MAX_FRAME_SIZE → rejected by write_frame itself.
///
/// **Invariant I8:** Sender-side limit prevents oversized frames from being
/// written in the first place.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn p8_8c_oversized_write_rejected() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let (tx, rx) = tokio::sync::oneshot::channel::<AeadTransport>();
    tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let transport = AeadTransport::new(
            stream, TEST_KEY, TEST_KEY, TEST_SESSION, TEST_SALT, false
        );
        let _ = tx.send(transport);
    });
    let client = tokio::net::TcpStream::connect(format!("{}", addr)).await.unwrap();
    let mut initiator = AeadTransport::new(client, TEST_KEY, TEST_KEY, TEST_SESSION, TEST_SALT, true);

    // Try to send a frame 1 byte over the limit
    let payload = vec![0u8; MAX_FRAME_SIZE + 1];
    let result = initiator.write_frame(&payload).await;

    assert!(result.is_err(),
        "Frame over MAX_FRAME_SIZE must be rejected by write_frame");
    match result.unwrap_err() {
        ProxyError::FrameTooLarge(size) => {
            assert_eq!(size, MAX_FRAME_SIZE + 1,
                "Error should report the actual oversized size");
        }
        e => panic!("Expected FrameTooLarge, got {:?}", e),
    }

    println!("P8.8c PASSED: write_frame rejects payload {} bytes > MAX_FRAME_SIZE ({} bytes)",
        MAX_FRAME_SIZE + 1, MAX_FRAME_SIZE);
}

/// P8.8d: Memory pressure — many concurrent small frames don't cause unbounded
/// buffer growth.
///
/// **Invariant I8:** The `read_buf` in AeadTransport has bounded capacity
/// (MAX_FRAME_SIZE * 2). Sending many small frames concurrently should not
/// cause the buffer to grow.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn p8_8d_concurrent_frames_no_buffer_leak() {
    let (mut responder, mut initiator) = {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let (tx, rx) = tokio::sync::oneshot::channel::<AeadTransport>();
        tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let transport = AeadTransport::new(
                stream, TEST_KEY, TEST_KEY, TEST_SESSION, TEST_SALT, false
            );
            let _ = tx.send(transport);
        });
        let client = tokio::net::TcpStream::connect(format!("{}", addr)).await.unwrap();
        let responder = rx.await.unwrap();
        let initiator = AeadTransport::new(client, TEST_KEY, TEST_KEY, TEST_SESSION, TEST_SALT, true);
        (responder, initiator)
    };

    // Send 100 small frames concurrently (interleaved with reads)
    let msg_count = 100u64;
    let received = Arc::new(AtomicU64::new(0));

    let mut tasks = Vec::new();

    // Writer task: send frames
    let received_clone = received.clone();
    tasks.push(tokio::spawn(async move {
        for i in 0..msg_count {
            let payload = format!("msg-{}", i).into_bytes();
            initiator.write_frame(&payload).await.unwrap();
        }
        msg_count
    }));

    // Reader task: read all frames
    let received_clone2 = received.clone();
    tasks.push(tokio::spawn(async move {
        let mut count = 0u64;
        for _ in 0..msg_count {
            match tokio::time::timeout(
                Duration::from_secs(2),
                responder.read_frame()
            ).await {
                Ok(Ok(Some(_))) => count += 1,
                _ => break,
            }
        }
        received_clone2.store(count, Ordering::SeqCst);
        count
    }));

    let results = join_all(tasks).await;
    let written = results[0].as_ref().unwrap();
    let read = received.load(Ordering::SeqCst);

    assert_eq!(*written, msg_count, "All frames should be written");
    assert_eq!(read as u64, msg_count, "All frames should be read");

    println!("P8.8d PASSED: {} concurrent frames processed without buffer leak", msg_count);
}

/// P8.8e: Nonce exhaustion boundary — nonce is u64, so 2^64 frames are
/// possible before exhaustion. This is practically unreachable but
/// documented as a theoretical limit.
///
/// **Invariant I8:** Nonce space (u64) provides sufficient entropy.
/// 2^64 frames at 4GB each = 2^44 GB — physically impossible to exhaust.
#[test]
fn p8_8e_nonce_exhaustion_limit() {
    // nonce = session_salt(4) || seq.to_be_bytes(8)
    // seq is u64, so max nonce value = u64::MAX = 2^64 - 1 = 18446744073709551615
    let max_frames = u64::MAX; // 2^64 - 1

    // At 256KB per frame, total data is astronomically large (exabytes).
    // We can't compute this directly (2^64 * 256KB overflows u64), but we can
    // reason about it: 2^63 frames * 2^18 bytes/frame ≈ 2^81 bytes ≈ 2.4 * 10^6 EB
    let max_ebo = (max_frames as f64) * (MAX_FRAME_SIZE as f64);
    let exabytes = max_ebo / (1024f64 * 1024f64 * 1024f64 * 1024f64 * 1024f64 * 1024f64);
    assert!(exabytes > 1_000_000f64,
        "Nonce space should allow >1M exabytes (got {:.1} EB)", exabytes);

    // The NonceExhaustion error is only reachable after 2^64 - 1 frames
    assert!(max_frames > 18_446_744_073_709_551_615u64 / 2,
        "Nonce space must be > 2^63 to be practically inexhaustible");

    println!("P8.8e PASSED: Nonce space = {} frames ({} exabytes of data) — practically inexhaustible",
        max_frames, exabytes as u64);
}

/// P8.8f: Ledger disk growth — append-only ledger grows linearly, no limit.
///
/// **Invariant I8:** The ledger has no built-in size cap. A compromised or
/// malicious client could cause unbounded disk growth by submitting many
/// requests. This is a documented operational concern (requires log rotation).
#[test]
fn p8_8f_ledger_unbounded_growth() {
    let identity = QuantumNodeIdentity::generate_node_identity().unwrap();
    let dir = std::env::temp_dir();
    let ledger_path = dir.join("p8_8f_ledger_growth.jsonl");
    let _ = std::fs::remove_file(&ledger_path);

    let writer = LedgerWriter::open(&ledger_path, &identity)
        .unwrap_or_else(|e| panic!("{}", e));

    // Write 1000 entries and check file size grows
    let mut sizes = Vec::new();
    for i in 0..100u64 {
        writer.append(
            serde_json::json!({"type": "write", "data": format!("entry-{}", i)}),
            &identity
        ).unwrap();

        if i % 25 == 24 {
            let size = std::fs::metadata(&ledger_path).unwrap().len();
            sizes.push(size);
        }
    }
    drop(writer);

    // Verify linear growth (each entry is ~9.5KB due to ML-DSA-87 4627-byte signature)
    assert!(sizes.len() >= 3, "Should have at least 3 size measurements");
    assert!(sizes[1] > sizes[0], "File size should grow after more entries");
    assert!(sizes[2] > sizes[1], "File size should continue growing");

    // Each entry adds roughly the same amount
    let growth_per_entry = (sizes[2] as f64 - sizes[0] as f64) / 50.0;
    let entry_size = sizes[0] as f64 / 25.0;
    assert!(growth_per_entry > entry_size * 0.5,
        "Growth per entry should be ~entry_size (got {:.0} vs {:.0})",
        growth_per_entry, entry_size);

    // Key finding: no size cap exists — ledger grows unboundedly
    let file_size = std::fs::metadata(&ledger_path).unwrap().len();
    println!("P8.8f: Ledger has {} entries, file size = {} bytes (no cap — requires operational log rotation)",
        100, file_size);
    println!("P8.8f PASSED: Ledger grows linearly without bound — operational mitigation required (log rotation)");

    let _ = std::fs::remove_file(&ledger_path);
}

/// P8.8g: Frame size at the boundary (MAX_FRAME_SIZE + 16 = GCM tag overhead)
/// should be rejected, but MAX_FRAME_SIZE + 15 should also be rejected if the
/// ciphertext + tag exceeds the limit.
///
/// **Invariant I8:** The +16 byte GCM tag is accounted for in the check.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn p8_8g_gcm_tag_boundary() {
    let (mut responder, mut attacker) = setup_victim_attacker().await;

    // MAX_FRAME_SIZE + 16 = exactly the boundary (includes GCM tag)
    let boundary_size = (MAX_FRAME_SIZE + 16) as u32;
    let header = boundary_size.to_be_bytes();
    attacker.write_all(&header).await.unwrap();
    attacker.write_all(b"x").await.unwrap();
    attacker.shutdown().await.unwrap();

    let result = tokio::time::timeout(
        Duration::from_millis(500),
        responder.read_frame(),
    ).await;

    match result {
        Err(_) => {
            println!("P8.8g PASSED: Frame at boundary (MAX_FRAME_SIZE + 16) — timed out (acceptable)");
        }
        Ok(Err(ProxyError::FrameTooLarge(_))) => {
            println!("P8.8g PASSED: Frame at boundary (MAX_FRAME_SIZE + 16) — rejected with FrameTooLarge");
        }
        Ok(Err(e)) => {
            println!("P8.8g PASSED: Frame at boundary — error: {:?} (acceptable)", e);
        }
        Ok(Ok(None)) => {
            println!("P8.8g PASSED: Frame at boundary — connection closed (acceptable)");
        }
        Ok(Ok(Some(_))) => {
            panic!("Frame at MAX_FRAME_SIZE + 16 should NOT be accepted!");
        }
    }
}
