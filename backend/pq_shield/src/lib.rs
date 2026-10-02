pub mod admin;
pub mod compliance;
pub mod otel;
pub mod prometheus_metrics;
pub mod telemetry;

use dashmap::DashMap;
use std::net::{IpAddr, SocketAddr};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Semaphore;
use tracing::{info, warn};

use crate::admin::{run_admin_server, AdminState};
use crate::prometheus_metrics::PrometheusMetrics;
use crate::telemetry::{InternalMsg, TelemetryEngine};
use audit_ledger::LedgerWriter;
use core_crypto::QuantumNodeIdentity;
use ha_cluster::{
    drain::ActiveSessionCounter, ClusterMembership, NodeId, NodeState, RaftNode, RaftRole,
};
use proxy_engine::run_responder;
use proxy_engine::transport::AeadTransport;

const MAX_GLOBAL_CONCURRENCY: usize = 10_000;
const MAX_CONCURRENT_PER_IP: u32 = 1_000;
const HANDSHAKE_TIMEOUT_SECS: u64 = 5;
const IDLE_TIMEOUT_SECS: u64 = 30;

/// P3.7: Configurable concurrency limits (env-overridable, defaults preserve P3.4 behavior)
fn get_max_global_concurrency() -> usize {
    std::env::var("VARDHAN_MAX_CONCURRENCY")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(MAX_GLOBAL_CONCURRENCY)
}
fn get_max_concurrency_per_ip() -> u32 {
    std::env::var("VARDHAN_MAX_CONCURRENCY_PER_IP")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(MAX_CONCURRENT_PER_IP)
}
fn get_handshake_timeout() -> u64 {
    std::env::var("VARDHAN_HANDSHAKE_TIMEOUT_SECS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(HANDSHAKE_TIMEOUT_SECS)
}
fn get_idle_timeout() -> u64 {
    std::env::var("VARDHAN_IDLE_TIMEOUT_SECS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(IDLE_TIMEOUT_SECS)
}

/// P7.1: Convert RaftRole to a display string for HTTP headers / redirects.
fn role_as_str(role: RaftRole) -> &'static str {
    match role {
        RaftRole::Leader => "Leader",
        RaftRole::Follower => "Follower",
        RaftRole::Candidate => "Candidate",
    }
}

pub struct IngressShield {
    pub listen_addr: SocketAddr,
    pub upstream_addr: SocketAddr,
    pub identity: Arc<QuantumNodeIdentity>,
    pub global_limit: Arc<Semaphore>,
    pub ip_limits: Arc<DashMap<IpAddr, u32>>,
    /// P3.7: Per-IP concurrency limit (env-overridable, default 1_000)
    pub max_concurrent_per_ip: u32,
    /// P3.7: Handshake timeout in seconds (env-overridable, default 5)
    pub handshake_timeout_secs: u64,
    /// P3.7: Idle session timeout in seconds (env-overridable, default 30)
    pub idle_timeout_secs: u64,
    pub telemetry: Arc<TelemetryEngine>,
    pub prometheus: Arc<PrometheusMetrics>,
    pub ledger_path: Option<PathBuf>,
    /// P3.4: HA cluster membership. When present, the accept loop refuses new
    /// connections if the local node is Draining or Dead.
    pub cluster: Option<Arc<ClusterMembership>>,
    /// P3.4: Active session counter for graceful drain coordination.
    pub session_counter: Option<ActiveSessionCounter>,
    /// P3.4: This node's stable cluster identity (when HA is configured).
    pub self_node_id: Option<NodeId>,
    /// P3.8: Raft consensus node for read-only status queries (when HA is
    /// configured with VARDHAN_NODE_ID and a persistence path).
    pub raft_node: Option<Arc<RaftNode>>,
    pub ledger_writer: Option<Arc<LedgerWriter>>,
}

impl IngressShield {
    fn init_internals(
        listen_addr: SocketAddr,
        upstream_addr: SocketAddr,
        identity: Arc<QuantumNodeIdentity>,
    ) -> (Self, Option<PathBuf>) {
        // P2: Initialize durable ledger if VARDHAN_LEDGER_PATH is set.
        let ledger_path = std::env::var("VARDHAN_LEDGER_PATH").ok().map(PathBuf::from);

        let (ledger, ledger_path_stored) = if let Some(ref path) = ledger_path {
            match LedgerWriter::open(path, &identity) {
                Ok(lw) => {
                    info!(path = %path.display(), "P2: Durable audit ledger opened");
                    (Some(Arc::new(lw)), Some(path.clone()))
                }
                Err(e) => {
                    // Ledger chain broken or IO error — refuse to start
                    panic!("FATAL: Cannot open audit ledger at {}: {e}", path.display());
                }
            }
        } else {
            info!("P2: VARDHAN_LEDGER_PATH not set — running without durable ledger (events broadcast only)");
            (None, None)
        };

        let prometheus = Arc::new(
            PrometheusMetrics::new().expect("FATAL: Failed to initialize Prometheus registry"),
        );
        let telemetry = Arc::new(TelemetryEngine::new(
            ledger.clone(),
            Some(identity.clone()),
            prometheus.clone(),
        ));

        let global_concurrency = get_max_global_concurrency();
        let per_ip_limit = get_max_concurrency_per_ip();
        let handshake_timeout = get_handshake_timeout();
        let idle_timeout = get_idle_timeout();
        let raft_node: Option<Arc<RaftNode>> = None;

        let shield = Self {
            listen_addr,
            upstream_addr,
            identity,
            global_limit: Arc::new(Semaphore::new(global_concurrency)),
            ip_limits: Arc::new(DashMap::new()),
            max_concurrent_per_ip: per_ip_limit,
            handshake_timeout_secs: handshake_timeout,
            idle_timeout_secs: idle_timeout,
            telemetry,
            prometheus,
            ledger_path: ledger_path_stored.clone(),
            cluster: None,
            session_counter: None,
            self_node_id: None,
            raft_node,
            ledger_writer: ledger,
        };
        (shield, ledger_path_stored)
    }

    pub fn new(
        listen_addr: SocketAddr,
        upstream_addr: SocketAddr,
        identity: Arc<QuantumNodeIdentity>,
    ) -> Self {
        let (shield, _) = Self::init_internals(listen_addr, upstream_addr, identity);
        shield
    }

    /// P3.4: Create an HA-aware shield with cluster membership and session counter.
    pub fn new_with_cluster(
        listen_addr: SocketAddr,
        upstream_addr: SocketAddr,
        identity: Arc<QuantumNodeIdentity>,
        self_node_id: NodeId,
        cluster: Arc<ClusterMembership>,
        session_counter: ActiveSessionCounter,
    ) -> Self {
        let (mut shield, _) = Self::init_internals(listen_addr, upstream_addr, identity);
        shield.cluster = Some(cluster);
        shield.session_counter = Some(session_counter);
        shield.self_node_id = Some(self_node_id);
        shield
    }

    pub async fn run_interceptor_loop(&self) -> Result<(), Box<dyn std::error::Error>> {
        let listener = TcpListener::bind(self.listen_addr).await?;
        info!(addr = %self.listen_addr, upstream = %self.upstream_addr, "pq_shield Quantum Reverse Proxy Active");

        // Boot admin plane
        let admin_token = std::env::var("VARDHAN_ADMIN_TOKEN")
            .expect("FATAL: VARDHAN_ADMIN_TOKEN must be strictly provided in environment.");

        let auth_db_path = std::env::var("VARDHAN_AUTH_DB_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("data/auth_db"));
        if let Some(parent) = auth_db_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        let cred_store =
            match auth_service::store::CredentialStore::open_or_bootstrap(&auth_db_path) {
                Ok(store) => Arc::new(store),
                Err(e) => {
                    tracing::warn!("Auth credential store bootstrap notice: {e}");
                    Arc::new(
                        auth_service::store::CredentialStore::open(&auth_db_path)
                            .expect("failed to open auth store"),
                    )
                }
            };

        let auth_state = auth_service::AuthState {
            credentials: cred_store,
            sessions: Arc::new(auth_service::session::SessionStore::new()),
            rate_limiter: Arc::new(auth_service::rate_limit::RateLimiter::new()),
            ledger: self.ledger_writer.clone(),
            identity: Some(Arc::clone(&self.identity)),
            node_id: self.self_node_id.as_ref().map(|n| n.0.clone()),
            admin_token: Some(admin_token.clone()),
        };

        let admin_state = AdminState {
            metrics: self.telemetry.snapshot.clone(),
            event_tx: self.telemetry.event_broadcast.clone(),
            history: self.telemetry.history.clone(),
            history_wrapped: self.telemetry.history_wrapped.clone(),
            admin_token,
            identity: Arc::clone(&self.identity),
            ledger_path: self.ledger_path.clone(),
            prometheus: self.prometheus.clone(),
            cluster: self.cluster.clone(),
            self_node_id: self.self_node_id.clone(),
            raft_node: self.raft_node.clone(),
            auth_state,
            execution_validator: None,
        };
        tokio::spawn(async move {
            run_admin_server(admin_state).await;
        });

        loop {
            let (mut client_stream, peer_addr) = listener.accept().await?;
            let _ = client_stream.set_nodelay(true);
            let ip = peer_addr.ip();

            // P3.4: Refuse new connections when this node is Draining or Dead.
            if let Some(ref cluster) = self.cluster {
                let self_state = if let Some(ref self_id) = self.self_node_id {
                    // Prefer stable node_id lookup
                    cluster
                        .all_nodes()
                        .await
                        .iter()
                        .find(|n| &n.node_id == self_id)
                        .map(|n| n.state)
                } else {
                    // Fallback: match by listen address
                    cluster
                        .all_nodes()
                        .await
                        .iter()
                        .find(|n| n.addr == self.listen_addr)
                        .map(|n| n.state)
                };
                if matches!(
                    self_state,
                    Some(NodeState::Draining) | Some(NodeState::Dead)
                ) {
                    warn!(peer = %peer_addr, "Node is Draining — rejecting new connection");
                    let _ = client_stream.shutdown().await;
                    continue;
                }
            }

            // P7.1: Write-path fencing — only the Raft Leader may proxy
            // authoritative client writes. A follower or candidate MUST
            // reject the connection rather than silently proxying upstream.
            if let Some(ref raft_node) = self.raft_node {
                if !raft_node.is_leader().await {
                    let role = raft_node.role_snapshot().await;
                    let role_str = role_as_str(role);
                    // Find the current known leader for a redirect hint.
                    let known_leader = if let Some(ref cluster) = self.cluster {
                        let nodes = cluster.all_nodes().await;
                        if let Some(ref self_id) = self.self_node_id {
                            nodes
                                .iter()
                                .find(|n| n.node_id != *self_id)
                                .map(|n| n.node_id.as_str().to_string())
                        } else {
                            nodes
                                .iter()
                                .find(|n| n.state == NodeState::Healthy)
                                .map(|n| n.node_id.as_str().to_string())
                        }
                    } else {
                        None
                    };

                    warn!(
                        peer = %peer_addr,
                        role = ?role,
                        "P7.1: Write-path fence — non-leader rejecting client connection"
                    );
                    let leader_json = match &known_leader {
                        Some(l) => format!("\"{}\"", l),
                        None => "null".to_string(),
                    };
                    let body = format!(
                        "{{\"error\":\"not_leader\",\"role\":\"{}\",\"leader_id\":{}}}\n",
                        role_str, leader_json
                    );
                    let _ = client_stream
                        .write_all(
                            format!(
                                "HTTP/1.1 503 Service Unavailable\r\n\
                         X-Raft-Not-Leader: {}\r\n\
                         X-Raft-Leader-Id: {}\r\n\
                         Content-Type: application/json\r\n\
                         Content-Length: {}\r\n\
                         Connection: close\r\n\
                         \r\n\
                         {}",
                                role_str,
                                known_leader.as_deref().unwrap_or("unknown"),
                                body.len(),
                                body
                            )
                            .as_bytes(),
                        )
                        .await;
                    let _ = client_stream.shutdown().await;
                    continue;
                }
            }

            let permit = match self.global_limit.clone().try_acquire_owned() {
                Ok(p) => p,
                Err(_) => {
                    warn!("Global concurrency limit reached. Rejecting {}", peer_addr);
                    continue;
                }
            };

            {
                let mut count = self.ip_limits.entry(ip).or_insert(0);
                if *count >= self.max_concurrent_per_ip {
                    warn!("Per-IP concurrency limit reached for {}. Rejecting.", ip);
                    continue;
                }
                *count += 1;
            }

            let upstream_addr = self.upstream_addr;
            let identity = Arc::clone(&self.identity);
            let ip_limits = Arc::clone(&self.ip_limits);
            let tx = self.telemetry.tx.clone();
            let session_counter = self.session_counter.clone();
            let handshake_timeout = self.handshake_timeout_secs;
            let idle_timeout = self.idle_timeout_secs;
            // P7.2: Re-check leadership after handshake to close the
            // check→step-down→write race window.
            let raft_replica = self.raft_node.clone();
            let cluster_for_leader_hint = self.cluster.clone();
            let self_node_id_clone = self.self_node_id.clone();

            tokio::spawn(async move {
                // P3.4: Track active session for drain coordination.
                if let Some(ref sc) = session_counter {
                    sc.increment();
                }
                struct SessionGuard {
                    sc: Option<ActiveSessionCounter>,
                }
                impl Drop for SessionGuard {
                    fn drop(&mut self) {
                        if let Some(ref sc) = self.sc {
                            sc.decrement();
                        }
                    }
                }
                let _session_guard = SessionGuard {
                    sc: session_counter,
                };

                struct IpGuard {
                    ip: IpAddr,
                    map: Arc<DashMap<IpAddr, u32>>,
                }
                impl Drop for IpGuard {
                    fn drop(&mut self) {
                        if let Some(mut count) = self.map.get_mut(&self.ip) {
                            if *count > 0 {
                                *count -= 1;
                            }
                        }
                    }
                }
                let _ip_guard = IpGuard { ip, map: ip_limits };
                let _global_guard = permit;

                let (session, sid) = {
                    let handshake_span = tracing::info_span!(
                        "session.handshake",
                        peer.addr = %peer_addr,
                        session.id = tracing::field::Empty,
                        pq.kem = "ML-KEM-1024",
                        pq.sig = "ML-DSA-87"
                    );
                    let _guard = handshake_span.enter();
                    let handshake_start = Instant::now();
                    let handshake_future = run_responder(&mut client_stream, &identity);
                    match tokio::time::timeout(
                        Duration::from_secs(handshake_timeout),
                        handshake_future,
                    )
                    .await
                    {
                        Ok(Ok(s)) => {
                            let sid = hex::encode(&s.session_id[..8]);
                            handshake_span.record("session.id", &sid);
                            let handshake_us = handshake_start.elapsed().as_micros() as u64;
                            let _ = tx.try_send(InternalMsg::HandshakeCompleted(
                                sid.clone(),
                                handshake_us,
                            ));
                            (s, sid)
                        }
                        Ok(Err(_e)) => {
                            let _ = tx.try_send(InternalMsg::FrameRejected);
                            return;
                        }
                        Err(_) => {
                            return;
                        }
                    }
                };

                // P7.2: Leadership re-check after PQ handshake.
                // The initial is_leader() check at accept time is necessary but
                // not sufficient — between that check and the handshake completion,
                // the node may have received a higher-term AppendEntries and stepped
                // down. Re-validate leadership before forwarding to upstream.
                if let Some(ref raft) = raft_replica {
                    if !raft.is_leader().await {
                        let role = raft.role_snapshot().await;
                        warn!(
                            session.id = %sid,
                            role = ?role,
                            peer = %peer_addr,
                            "P7.2: Leadership lost after handshake — rejecting forwarded request"
                        );
                        let leader_hint = if let Some(ref cluster) = cluster_for_leader_hint {
                            let nodes = cluster.all_nodes().await;
                            let self_id = self_node_id_clone.as_ref().map(|n| n.clone());
                            nodes
                                .iter()
                                .find(|n| Some(&n.node_id) != self_id.as_ref())
                                .map(|n| n.node_id.as_str().to_string())
                        } else {
                            None
                        };
                        let body = format!(
                            "{{\"error\":\"not_leader_post_handshake\",\"role\":\"{}\",\"leader_id\":{:?}}}\n",
                            role_as_str(role), leader_hint
                        );
                        let leader_json = match &leader_hint {
                            Some(l) => format!("\"{}\"", l),
                            None => "null".to_string(),
                        };
                        let _ = client_stream
                            .write_all(
                                format!(
                                    "HTTP/1.1 503 Service Unavailable\r\n\
                             X-Raft-Not-Leader: {}\r\n\
                             X-Raft-Leader-Id: {}\r\n\
                             Content-Type: application/json\r\n\
                             Content-Length: {}\r\n\
                             Connection: close\r\n\
                             \r\n\
                             {}",
                                    role_as_str(role),
                                    leader_hint.as_deref().unwrap_or("unknown"),
                                    body.len(),
                                    body
                                )
                                .as_bytes(),
                            )
                            .await;
                        let _ = client_stream.shutdown().await;
                        let _ = tx.try_send(InternalMsg::FrameRejected);
                        return;
                    }
                }

                let upstream_future = TcpStream::connect(upstream_addr);
                let mut upstream_stream =
                    match tokio::time::timeout(Duration::from_secs(5), upstream_future).await {
                        Ok(Ok(s)) => {
                            let _ = tx.try_send(InternalMsg::UpstreamConnected(hex::encode(
                                &session.session_id[..8],
                            )));
                            s
                        }
                        _ => {
                            let _ = tx.try_send(InternalMsg::UpstreamFailed(hex::encode(
                                &session.session_id[..8],
                            )));
                            return;
                        }
                    };
                let _ = upstream_stream.set_nodelay(true);

                let mut transport = AeadTransport::new(
                    client_stream,
                    *session.server_to_client_key,
                    *session.client_to_server_key,
                    session.session_id,
                    session.session_salt,
                    false,
                );

                let mut upstream_buf = [0u8; 65536];

                loop {
                    tokio::select! {
                        frame_result = tokio::time::timeout(Duration::from_secs(idle_timeout), transport.read_frame()) => {
                            match frame_result {
                                Ok(Ok(Some(plaintext))) => {
                                    let req_start = Instant::now();
                                    let forward_span = tracing::info_span!("proxy.forward", session.id = %sid, bytes = plaintext.len());
                                    let write_result = {
                                        let _f_guard = forward_span.enter();
                                        upstream_stream.write_all(&plaintext).await
                                    };
                                    if write_result.is_err() {
                                        let _ = tx.try_send(InternalMsg::UpstreamFailed(sid.clone()));
                                        break;
                                    }
                                    let _ = tx.try_send(InternalMsg::LatencySample(req_start.elapsed().as_micros() as u64));
                                    let _ = tx.try_send(InternalMsg::RequestCompleted);
                                    use rand::RngCore;
                                    use rand::Rng;
                                    if rand::thread_rng().gen_range(0..50) == 0 {
                                        let mut sample = vec![0u8; 12];
                                        rand::thread_rng().fill_bytes(&mut sample);
                                        let _ = tx.try_send(InternalMsg::NonceEntropySample(sample));
                                    }
                                }
                                Ok(Ok(None)) => break,
                                Ok(Err(_)) => {
                                    let _ = tx.try_send(InternalMsg::FrameRejected);
                                    break;
                                }
                                Err(_) => break,
                            }
                        }

                        n_result = tokio::time::timeout(Duration::from_secs(idle_timeout), upstream_stream.read(&mut upstream_buf)) => {
                            match n_result {
                                Ok(Ok(0)) => break,
                                Ok(Ok(n)) => {
                                    if transport.write_frame(&upstream_buf[..n]).await.is_err() { break; }
                                }
                                Ok(Err(_)) => break,
                                Err(_) => break,
                            }
                        }
                    }
                }
                let _ = tx.try_send(InternalMsg::SessionClosed(sid));
            });
        }
    }
}
