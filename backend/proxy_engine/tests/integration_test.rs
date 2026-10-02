//! Integration tests for `proxy_engine` Sprint 2.
//!
//! Verifies:
//! 1. Two honest nodes complete a loopback TCP post-quantum handshake and
//!    derive identical 32-byte shared secrets **and** matching HKDF session keys.
//! 2. Independent handshakes produce distinct secrets (fresh randomness).
//! 3. A HELLO frame with an invalid signature is rejected by the responder.
//! 4. A KEM_CT frame with a tampered ciphertext is rejected.
//! 5. Three concurrent sessions all succeed with distinct secrets.
//! 6. The HKDF session keys are consistent (both sides derive the same key).

use bytes::{BufMut, BytesMut};
use core_crypto::QuantumNodeIdentity;
use proxy_engine::{run_initiator, ProxyError, QuantumProxyListener};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

// ─────────────────────────────────────────────────────────────────────────────
// Helper
// ─────────────────────────────────────────────────────────────────────────────

async fn bind_listener() -> (QuantumProxyListener, std::net::SocketAddr) {
    let tcp = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = tcp.local_addr().unwrap();
    let identity = QuantumNodeIdentity::generate_node_identity().unwrap();
    let listener = QuantumProxyListener::from_parts(tcp, identity);
    (listener, addr)
}

async fn write_raw_frame(stream: &mut TcpStream, payload: &[u8]) {
    let mut buf = BytesMut::with_capacity(4 + payload.len());
    buf.put_u32(payload.len() as u32);
    buf.put_slice(payload);
    stream.write_all(&buf).await.unwrap();
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 1: honest handshake — secrets AND session keys must match
// ─────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn test_two_honest_nodes_derive_same_secret() {
    let (listener, addr) = bind_listener().await;

    let resp_task = tokio::spawn(async move {
        let (session, _stream) = listener.accept_handshake().await.unwrap();
        (
            session.shared_secret,
            session.session_key.as_slice().to_vec(),
        )
    });

    let init_id = QuantumNodeIdentity::generate_node_identity().unwrap();
    let mut conn = TcpStream::connect(addr).await.unwrap();
    let init_session = run_initiator(&mut conn, &init_id).await.unwrap();

    let (resp_secret, resp_session_key) = resp_task.await.unwrap();

    assert_eq!(
        init_session.shared_secret, resp_secret,
        "Raw shared secrets must match"
    );
    assert_eq!(init_session.shared_secret.len(), 32);
    assert_ne!(
        init_session.shared_secret,
        zeroize::Zeroizing::new(vec![0u8; 32]),
        "Shared secret must not be all zeros"
    );

    assert_eq!(
        init_session.session_key.as_slice(),
        resp_session_key.as_slice(),
        "HKDF session keys must match"
    );
    assert_ne!(init_session.session_key.as_slice(), &[0u8; 32]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 2: independent handshakes → distinct secrets
// ─────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn test_independent_handshakes_produce_distinct_secrets() {
    async fn do_handshake() -> zeroize::Zeroizing<Vec<u8>> {
        let (listener, addr) = bind_listener().await;
        let resp_task = tokio::spawn(async move {
            let (session, _) = listener.accept_handshake().await.unwrap();
            session.shared_secret
        });
        let id = QuantumNodeIdentity::generate_node_identity().unwrap();
        let mut conn = TcpStream::connect(addr).await.unwrap();
        let s = run_initiator(&mut conn, &id).await.unwrap();
        resp_task.await.unwrap();
        s.shared_secret
    }

    let s1 = do_handshake().await;
    let s2 = do_handshake().await;
    assert_ne!(
        s1, s2,
        "Independent handshakes must produce distinct secrets"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 3: invalid HELLO signature → responder rejects
// ─────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn test_invalid_hello_signature_rejected() {
    let (listener, addr) = bind_listener().await;

    let resp_task = tokio::spawn(async move { listener.accept_handshake().await.err() });

    // Build a HELLO where sig was computed over a *different* encap key.
    let signer = QuantumNodeIdentity::generate_node_identity().unwrap();
    let attacker = QuantumNodeIdentity::generate_node_identity().unwrap();

    // Sign attacker's EK with signer's DSA key, but present signer's EK in the frame.
    let attacker_ek = attacker.encap_key_bytes();
    let sig = signer.sign_payload(&attacker_ek).unwrap(); // sig over wrong bytes
    let signer_ek = signer.encap_key_bytes();
    let dsa_pub = signer.dsa_public_key_bytes();

    let mut frame = Vec::new();
    // Version advertisement prefix
    frame.push(proxy_engine::SUPPORTED_VERSIONS.len() as u8);
    for &v in proxy_engine::SUPPORTED_VERSIONS {
        frame.extend_from_slice(&v.to_be_bytes());
    }
    frame.extend_from_slice(&signer_ek); // EK
    frame.extend_from_slice(&sig); // sig over attacker_ek ≠ signer_ek
    frame.extend_from_slice(&dsa_pub);

    let mut conn = TcpStream::connect(addr).await.unwrap();
    write_raw_frame(&mut conn, &frame).await;
    drop(conn);

    let err = resp_task.await.unwrap();
    assert!(err.is_some(), "Responder must return an error");
    assert!(
        matches!(
            err.unwrap(),
            ProxyError::InvalidSignature | ProxyError::Io(_)
        ),
        "Must be InvalidSignature or I/O"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 4: tampered KEM_CT → responder rejects
// ─────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn test_invalid_kem_ct_signature_rejected() {
    let (listener, addr) = bind_listener().await;

    let resp_task = tokio::spawn(async move { listener.accept_handshake().await.err() });

    // 1. Send a valid HELLO
    let attacker = QuantumNodeIdentity::generate_node_identity().unwrap();
    let ek = attacker.encap_key_bytes();
    let sig = attacker.sign_payload(&ek).unwrap();
    let dsa_pub = attacker.dsa_public_key_bytes();

    let mut hello = Vec::new();
    // Version advertisement prefix
    hello.push(proxy_engine::SUPPORTED_VERSIONS.len() as u8);
    for &v in proxy_engine::SUPPORTED_VERSIONS {
        hello.extend_from_slice(&v.to_be_bytes());
    }
    hello.extend_from_slice(&ek);
    hello.extend_from_slice(&sig);
    hello.extend_from_slice(&dsa_pub);

    let mut conn = TcpStream::connect(addr).await.unwrap();
    write_raw_frame(&mut conn, &hello).await;

    // 2. Consume HELLO_ACK
    let ack_len = conn.read_u32().await.unwrap() as usize;
    let mut ack_buf = vec![0u8; ack_len];
    conn.read_exact(&mut ack_buf).await.unwrap();

    // 3. Consume KEM_CT_B
    let kt_len = conn.read_u32().await.unwrap() as usize;
    let mut kt_buf = vec![0u8; kt_len];
    conn.read_exact(&mut kt_buf).await.unwrap();

    // 4. Send a tampered KEM_CT_A: valid ct, valid sig, but flip a ciphertext byte
    let (ct_bytes, _ss) = QuantumNodeIdentity::encapsulate_shared_secret_from_bytes(&ek).unwrap();
    let sig = attacker.sign_payload(&ct_bytes).unwrap();
    let mut kem_frame = ct_bytes.clone();
    kem_frame.extend_from_slice(&sig);
    kem_frame[0] ^= 0xFF; // corrupt before sending

    write_raw_frame(&mut conn, &kem_frame).await;
    drop(conn);

    let err = resp_task.await.unwrap();
    assert!(
        err.is_some(),
        "Responder must return an error for tampered KEM_CT"
    );
    assert!(
        matches!(
            err.unwrap(),
            ProxyError::InvalidSignature | ProxyError::Io(_)
        ),
        "Must be InvalidSignature or I/O"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 5: concurrent multi-node handshakes
// ─────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn test_concurrent_handshakes() {
    let tcp = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = tcp.local_addr().unwrap();
    let server_id = QuantumNodeIdentity::generate_node_identity().unwrap();

    const N: usize = 3;

    let server_task = tokio::spawn(async move {
        let listener = QuantumProxyListener::from_parts(tcp, server_id);
        let mut secrets = Vec::new();
        for _ in 0..N {
            let (session, _) = listener.accept_handshake().await.unwrap();
            secrets.push(session.shared_secret);
        }
        secrets
    });

    let mut client_handles = Vec::new();
    for _ in 0..N {
        let h = tokio::spawn(async move {
            let id = QuantumNodeIdentity::generate_node_identity().unwrap();
            let mut conn = TcpStream::connect(addr).await.unwrap();
            run_initiator(&mut conn, &id).await.unwrap().shared_secret
        });
        client_handles.push(h);
    }

    let mut client_secrets = Vec::new();
    for h in client_handles {
        client_secrets.push(h.await.unwrap());
    }
    let server_secrets = server_task.await.unwrap();

    assert_eq!(client_secrets.len(), N);
    assert_eq!(server_secrets.len(), N);

    for (cs, ss) in client_secrets.iter().zip(server_secrets.iter()) {
        assert_eq!(cs.len(), 32);
        assert_eq!(cs, ss, "Client and server secrets must match");
        assert_ne!(cs, &zeroize::Zeroizing::new(vec![0u8; 32]));
    }

    // All N secrets distinct
    let mut seen = std::collections::HashSet::new();
    for s in &server_secrets {
        assert!(
            seen.insert(s.as_slice().to_vec()),
            "Duplicate secret across sessions"
        );
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 6: HKDF session keys match on both sides
// ─────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn test_session_keys_match_both_sides() {
    let (listener, addr) = bind_listener().await;

    let resp_task = tokio::spawn(async move {
        let (session, _) = listener.accept_handshake().await.unwrap();
        session.session_key.as_slice().to_vec()
    });

    let id = QuantumNodeIdentity::generate_node_identity().unwrap();
    let mut conn = TcpStream::connect(addr).await.unwrap();
    let init_session = run_initiator(&mut conn, &id).await.unwrap();

    let resp_key = resp_task.await.unwrap();

    assert_eq!(
        init_session.session_key.as_slice(),
        resp_key.as_slice(),
        "HKDF session keys must agree on both sides"
    );
    assert_eq!(resp_key.len(), 32);
    assert_ne!(resp_key, vec![0u8; 32]);
}
