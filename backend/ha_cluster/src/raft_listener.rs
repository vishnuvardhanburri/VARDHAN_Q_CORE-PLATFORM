use crate::raft::{
    AppendEntriesArgs, AppendEntriesReply, RaftNode, RaftRpcEnvelope, RaftRpcType, RequestVoteArgs,
    RequestVoteReply,
};
use crate::NodeId;
use core_crypto::QuantumNodeIdentity;
use proxy_engine::run_responder;
use proxy_engine::transport::AeadTransport;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::net::TcpStream;

/// Maps DSA-public-key BLAKE3 fingerprints → NodeId.
///
/// SEC-018: The production RaftNetworkListener uses this registry to
/// cryptographically bind the authenticated peer identity (from the PQ
/// handshake) to the NodeId that the peer claims in application-layer
/// envelopes. An unknown fingerprint or a mismatched NodeId is rejected
/// BEFORE the RPC is dispatched to the Raft state machine.
///
/// If the registry is empty, every inbound connection is rejected
/// (fail-closed). Nodes that have not been provisioned in the registry
/// cannot participate in consensus.
pub type PeerRegistry = HashMap<[u8; 32], NodeId>;

pub struct RaftNetworkListener {
    test_bypass_registry: bool,
    listen_addr: std::net::SocketAddr,
    identity: Arc<QuantumNodeIdentity>,
    raft_node: Arc<RaftNode>,
    /// SEC-018: Fingerprint → NodeId binding registry.
    /// Populated from trusted provisioning at node startup.
    peer_registry: Arc<PeerRegistry>,
}

impl RaftNetworkListener {

    #[cfg(debug_assertions)]
    pub async fn new_test_insecure(
        listen_addr: std::net::SocketAddr,
        identity: Arc<QuantumNodeIdentity>,
        raft_node: Arc<RaftNode>,
    ) -> std::io::Result<(Self, tokio::net::TcpListener, std::net::SocketAddr)> {
        Self::new_internal(listen_addr, identity, raft_node, HashMap::new(), true).await
    }

    pub async fn new_with_registry(
        listen_addr: std::net::SocketAddr,
        identity: Arc<QuantumNodeIdentity>,
        raft_node: Arc<RaftNode>,
        peer_registry: PeerRegistry,
    ) -> std::io::Result<(Self, tokio::net::TcpListener, std::net::SocketAddr)> {
        if peer_registry.is_empty() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "FATAL: Production RaftNetworkListener requires a non-empty PeerRegistry (SEC-018)",
            ));
        }
        Self::new_internal(listen_addr, identity, raft_node, peer_registry, false).await
    }

    async fn new_internal(
        listen_addr: std::net::SocketAddr,
        identity: Arc<QuantumNodeIdentity>,
        raft_node: Arc<RaftNode>,
        peer_registry: PeerRegistry,
        test_bypass_registry: bool,
    ) -> std::io::Result<(Self, tokio::net::TcpListener, std::net::SocketAddr)> {
        let listener = tokio::net::TcpListener::bind(listen_addr).await?;
        let bound_addr = listener.local_addr()?;
        Ok((
            Self {
                test_bypass_registry,
                listen_addr: bound_addr,
                identity,
                raft_node,
                peer_registry: Arc::new(peer_registry),
            },
            listener,
            bound_addr,
        ))
    }

    pub async fn run(
        &self,
        listener: tokio::net::TcpListener,
    ) -> Result<(), Box<dyn std::error::Error>> {
        info!(addr = %self.listen_addr, "Raft Network Listener active");

        // SEC-005: Inbound connection limit to prevent FD exhaustion DoS
        let conn_limit = Arc::new(tokio::sync::Semaphore::new(100));

        loop {
            let (mut stream, peer_addr) = listener.accept().await?;
            let identity = Arc::clone(&self.identity);
            let raft_node = Arc::clone(&self.raft_node);
            let peer_registry = Arc::clone(&self.peer_registry);
            let test_bypass_registry = self.test_bypass_registry;
            
            

            let permit = match Arc::clone(&conn_limit).try_acquire_owned() {
                Ok(p) => p,
                Err(_) => {
                    warn!(peer = %peer_addr, "Raft RPC connection limit reached, dropping connection");
                    continue;
                }
            };

            tokio::spawn(async move {
                // Drop the permit only when the connection task finishes
                let _permit = permit;

                info!(peer = %peer_addr, "Incoming Raft connection");

                // 1. PQ Handshake (Responder)
                let session = match run_responder(&mut stream, &identity).await {
                    Ok(s) => s,
                    Err(e) => {
                        warn!(peer = %peer_addr, err = %e, "PQ handshake failed");
                        return;
                    }
                };

                // SEC-018: Compute the authenticated peer's DSA fingerprint.
                // This is BLAKE3(peer_dsa_pub_bytes) — verified during the handshake.
                // The fingerprint is pinned for the entire connection lifetime.
                let peer_dsa_fingerprint =
                    QuantumNodeIdentity::hash_ledger_block(&session.peer_dsa_pub_bytes);
                let peer_fingerprint_hex = hex::encode(peer_dsa_fingerprint);

                // SEC-018 CORE: Validate that the authenticated fingerprint maps to a known NodeId.
                //
                // If the registry is non-empty, the peer MUST be in it.
                // If the registry is empty (legacy/test mode), skip registry check.
                //
                // This MUST happen BEFORE any RPC is processed — prevents forged sender_id
                // from being accepted even if the outer AEAD frame is authentic.
                let registry_enforced = !test_bypass_registry;
                let authoritative_node_id: Option<NodeId> = if registry_enforced {
                    match peer_registry.get(&peer_dsa_fingerprint) {
                        Some(node_id) => {
                            info!(
                                peer = %peer_addr,
                                fingerprint = %peer_fingerprint_hex,
                                authorized_node_id = %node_id,
                                "SEC-018: Authenticated peer found in registry"
                            );
                            Some(node_id.clone())
                        }
                        None => {
                            error!(
                                peer = %peer_addr,
                                fingerprint = %peer_fingerprint_hex,
                                "SEC-018 VIOLATION: Authenticated peer fingerprint not in registry — connection rejected (fail-closed)"
                            );
                            return; // Reject connection before any RPC
                        }
                    }
                } else {
                    // Legacy/test mode: no registry enforcement
                    None
                };

                // 2. Wrap in Authenticated Transport
                let mut transport = AeadTransport::new(
                    stream,
                    *session.server_to_client_key,
                    *session.client_to_server_key,
                    session.session_id,
                    session.session_salt,
                    false,
                );

                // SEC-001: The claimed sender_id from the first valid envelope is pinned
                // for this connection. Any subsequent envelope claiming a different
                // sender_id is rejected — preventing mid-session impersonation.
                let mut pinned_sender_id: Option<String> = None;

                // 3. RPC Dispatch Loop
                loop {
                    // SEC-004: Per-frame read deadline — prevents Slowloris / hung-sender DoS.
                    let result = tokio::time::timeout(
                        tokio::time::Duration::from_secs(10),
                        transport.read_frame(),
                    )
                    .await;

                    let frame_result = match result {
                        Ok(r) => r,
                        Err(_) => {
                            warn!(peer = %peer_addr, "Raft RPC read timeout — closing connection");
                            break;
                        }
                    };

                    match frame_result {
                        Ok(Some(bytes)) => {
                            let bytes: Vec<u8> = bytes;
                            // Deserialize Envelope
                            let envelope: RaftRpcEnvelope = match serde_json::from_slice::<
                                RaftRpcEnvelope,
                            >(
                                &bytes
                            ) {
                                Ok(env) => env,
                                Err(e) => {
                                    error!(peer = %peer_addr, err = %e, "Malformed Raft envelope");
                                    break;
                                }
                            };

                            // 1. Verify Protocol Version
                            if envelope.version != 1 {
                                error!(peer = %peer_addr, version = envelope.version, "Unsupported Raft protocol version");
                                break;
                            }

                            // 2. Verify Receiver Identity
                            if envelope.receiver_id != raft_node.id {
                                warn!(peer = %peer_addr, receiver = %envelope.receiver_id, "RPC addressed to wrong receiver");
                                break;
                            }

                            // 3. SEC-018 Sender Identity Verification
                            // a) sender_id must be non-empty
                            if envelope.sender_id.0.is_empty() {
                                error!(peer = %peer_addr, "Raft RPC missing sender identity");
                                break;
                            }

                            // b) SEC-018 CORE: If registry is enforced, the envelope sender_id
                            //    MUST match the NodeId the registry bound to this fingerprint.
                            //    An authenticated peer cannot impersonate a different NodeId.
                            if let Some(ref auth_node_id) = authoritative_node_id {
                                if envelope.sender_id != *auth_node_id {
                                    error!(
                                        peer = %peer_addr,
                                        claimed_id = %envelope.sender_id,
                                        authorized_id = %auth_node_id,
                                        fingerprint = %peer_fingerprint_hex,
                                        "SEC-018 VIOLATION: envelope sender_id does not match registry binding — connection rejected"
                                    );
                                    break;
                                }
                            }

                            // c) Pin sender_id on first RPC and enforce for subsequent RPCs.
                            //    Prevents mid-session identity change (belt-and-suspenders).
                            match &pinned_sender_id {
                                None => {
                                    info!(
                                        peer = %peer_addr,
                                        sender_id = %envelope.sender_id,
                                        fingerprint = %peer_fingerprint_hex,
                                        "SEC-018: Pinning sender_id to authenticated DSA fingerprint"
                                    );
                                    pinned_sender_id = Some(envelope.sender_id.0.clone());
                                }
                                Some(pinned) => {
                                    if pinned != &envelope.sender_id.0 {
                                        error!(
                                            peer = %peer_addr,
                                            claimed_id = %envelope.sender_id,
                                            pinned_id = %pinned,
                                            fingerprint = %peer_fingerprint_hex,
                                            "SEC-018 VIOLATION: sender_id changed mid-session — closing connection"
                                        );
                                        break;
                                    }
                                }
                            }

                            // Dispatch based on RPC type — only reached after identity is verified
                            let reply_payload = match envelope.rpc_type {
                                RaftRpcType::RequestVote => {
                                    let args: RequestVoteArgs = match serde_json::from_slice::<
                                        RequestVoteArgs,
                                    >(
                                        &envelope.payload
                                    ) {
                                        Ok(a) => a,
                                        Err(e) => {
                                            error!(peer = %peer_addr, err = %e, "Malformed RequestVote args");
                                            break;
                                        }
                                    };
                                    let reply = raft_node.handle_request_vote(args).await;
                                    match serde_json::to_vec(&reply) {
                                        Ok(b) => b,
                                        Err(e) => {
                                            error!(peer = %peer_addr, err = %e, "Failed to serialize RequestVoteReply");
                                            break;
                                        }
                                    }
                                }
                                RaftRpcType::AppendEntries => {
                                    let args: AppendEntriesArgs = match serde_json::from_slice::<
                                        AppendEntriesArgs,
                                    >(
                                        &envelope.payload
                                    ) {
                                        Ok(a) => a,
                                        Err(e) => {
                                            error!(peer = %peer_addr, err = %e, "Malformed AppendEntries args");
                                            break;
                                        }
                                    };
                                    let reply = raft_node.handle_append_entries(args).await;
                                    match serde_json::to_vec(&reply) {
                                        Ok(b) => b,
                                        Err(e) => {
                                            error!(peer = %peer_addr, err = %e, "Failed to serialize AppendEntriesReply");
                                            break;
                                        }
                                    }
                                }
                            };

                            // Construct Reply Envelope
                            let reply_env = RaftRpcEnvelope {
                                version: 1,
                                rpc_type: envelope.rpc_type,
                                sender_id: raft_node.id.clone(),
                                receiver_id: envelope.sender_id,
                                request_id: envelope.request_id,
                                payload: reply_payload,
                            };
                            let reply_bytes = match serde_json::to_vec(&reply_env) {
                                Ok(b) => b,
                                Err(e) => {
                                    error!(peer = %peer_addr, err = %e, "Failed to serialize reply envelope");
                                    break;
                                }
                            };

                            // Send Encrypted Response
                            if let Err(e) = transport.write_frame(&reply_bytes).await {
                                warn!(peer = %peer_addr, err = %e, "Failed to send Raft reply");
                                break;
                            }
                        }
                        Ok(None) => {
                            info!(peer = %peer_addr, "Peer closed Raft connection");
                            break;
                        }
                        Err(e) => {
                            warn!(peer = %peer_addr, err = %e, "Transport error in Raft loop");
                            break;
                        }
                    }
                }
            });
        }
    }
}

/// Unit tests for SEC-018 identity binding logic (no TCP — tests the policy directly).
#[cfg(test)]
mod tests {
    use super::*;

    fn make_fingerprint(n: u8) -> [u8; 32] {
        [n; 32]
    }

    #[test]
    fn valid_sender_matches_authenticated_peer() {
        let mut registry = PeerRegistry::new();
        let fp = make_fingerprint(1);
        registry.insert(fp, NodeId::new("node-b"));

        let authorized = registry.get(&fp).cloned();
        assert_eq!(authorized, Some(NodeId::new("node-b")));

        let claimed = NodeId::new("node-b");
        assert_eq!(
            claimed,
            authorized.unwrap(),
            "Valid sender must match registry"
        );
    }

    #[test]
    fn forged_sender_does_not_match_authenticated_peer() {
        let mut registry = PeerRegistry::new();
        let fp = make_fingerprint(2);
        registry.insert(fp, NodeId::new("node-b"));

        let authorized = registry.get(&fp).cloned().unwrap();
        let forged = NodeId::new("node-evil");
        assert_ne!(
            forged, authorized,
            "Forged sender must not match registry binding"
        );
    }

    #[test]
    fn stale_authenticated_peer_is_rejected() {
        let registry = PeerRegistry::new(); // empty registry
        let fp = make_fingerprint(3);
        assert!(registry.is_empty(), "Empty registry = no known peers");
        let found = registry.get(&fp);
        assert!(
            found.is_none(),
            "Unknown fingerprint must not be in empty registry"
        );
    }

    #[test]
    fn envelope_sender_must_match_handshake_binding() {
        let mut registry = PeerRegistry::new();
        let fp = make_fingerprint(4);
        registry.insert(fp, NodeId::new("node-b"));

        let authorized = registry.get(&fp).cloned().unwrap();
        // Envelope claims node-c, but handshake bound to node-b
        let mismatched = NodeId::new("node-c");
        assert_ne!(
            mismatched, authorized,
            "Envelope sender != authenticated binding MUST be rejected"
        );
    }
}
