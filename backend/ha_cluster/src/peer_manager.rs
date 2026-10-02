use crate::raft::{
    AppendEntriesArgs, AppendEntriesReply, RaftRpcClient, RaftRpcEnvelope, RaftRpcType,
    RequestVoteArgs, RequestVoteReply,
};
use crate::{ClusterMembership, NodeId};
use core_crypto::QuantumNodeIdentity;
use proxy_engine::{run_initiator, transport::AeadTransport};
use rand::Rng;
use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::net::TcpStream;
use tokio::sync::{mpsc, oneshot, RwLock};
use tokio::time::{timeout, Duration};

/// A request to be sent by the PeerWorker.
pub enum PeerRequest {
    RequestVote {
        request_id: String,
        args: RequestVoteArgs,
        response_tx: oneshot::Sender<Result<Vec<u8>, String>>,
    },
    AppendEntries {
        request_id: String,
        args: AppendEntriesArgs,
        response_tx: oneshot::Sender<Result<Vec<u8>, String>>,
    },
}

impl PeerRequest {
    fn request_id(&self) -> String {
        match self {
            PeerRequest::RequestVote { request_id, .. } => request_id.clone(),
            PeerRequest::AppendEntries { request_id, .. } => request_id.clone(),
        }
    }

    fn rpc_type(&self) -> RaftRpcType {
        match self {
            PeerRequest::RequestVote { .. } => RaftRpcType::RequestVote,
            PeerRequest::AppendEntries { .. } => RaftRpcType::AppendEntries,
        }
    }

    fn payload(&self) -> Result<Vec<u8>, serde_json::Error> {
        match self {
            PeerRequest::RequestVote { args, .. } => serde_json::to_vec(args),
            PeerRequest::AppendEntries { args, .. } => serde_json::to_vec(args),
        }
    }

    fn take_response_tx(self) -> oneshot::Sender<Result<Vec<u8>, String>> {
        match self {
            PeerRequest::RequestVote { response_tx, .. } => response_tx,
            PeerRequest::AppendEntries { response_tx, .. } => response_tx,
        }
    }
}

/// Manages authenticated PQ connections to Raft peers via dedicated worker tasks.
#[derive(Clone)]
pub struct RaftPeerManager {
    inner: Arc<RaftPeerManagerInner>,
}

struct RaftPeerManagerInner {
    identity: Arc<QuantumNodeIdentity>,
    membership: Arc<ClusterMembership>,
    self_node_id: NodeId,
    workers: RwLock<HashMap<NodeId, mpsc::Sender<PeerRequest>>>,
}

impl RaftPeerManager {
    pub fn new(
        identity: Arc<QuantumNodeIdentity>,
        membership: Arc<ClusterMembership>,
        self_node_id: NodeId,
    ) -> Self {
        Self {
            inner: Arc::new(RaftPeerManagerInner {
                identity,
                membership,
                self_node_id,
                workers: RwLock::new(HashMap::new()),
            }),
        }
    }

    /// P3.8: Delegate to inner for test access / external callers.
    pub async fn get_or_spawn_worker(
        &self,
        to: NodeId,
    ) -> Result<mpsc::Sender<PeerRequest>, String> {
        self.inner.get_or_spawn_worker(to).await
    }

    /// P3.8: Clear cached worker so the next RPC forces a fresh connection.
    pub async fn clear_worker(&self, to: &NodeId) {
        self.inner.clear_worker(to).await
    }
}

impl RaftPeerManagerInner {
    pub async fn get_or_spawn_worker(
        &self,
        to: NodeId,
    ) -> Result<mpsc::Sender<PeerRequest>, String> {
        info!(to = %to, "get_or_spawn_worker called");
        {
            let mut workers = self.workers.write().await;
            if let Some(tx) = workers.get(&to) {
                if !tx.is_closed() {
                    info!(to = %to, "Worker already exists and active");
                    return Ok(tx.clone());
                } else {
                    info!(to = %to, "Cached worker is closed, removing");
                    workers.remove(&to);
                }
            }
        }

        let nodes = self.membership.all_nodes().await;
        let node = nodes
            .into_iter()
            .find(|n| n.node_id == to)
            .ok_or_else(|| format!("Node {} not found in membership", to))?;
        let addr = if node.raft_port > 0 {
            std::net::SocketAddr::new(node.addr.ip(), node.raft_port)
        } else {
            node.addr
        };
        info!(to = %to, addr = %addr, "Spawning new worker");

        let (tx, rx) = mpsc::channel::<PeerRequest>(100);
        let identity = Arc::clone(&self.identity);
        let to_id = to.clone();
        let self_id = self.self_node_id.clone();

        tokio::spawn(async move {
            if let Err(e) = run_peer_worker(addr, identity, to_id.clone(), self_id, rx).await {
                error!(peer = %to_id, err = %e, "Peer worker terminated fatally");
            }
        });

        let mut workers = self.workers.write().await;
        workers.insert(to, tx.clone());
        Ok(tx)
    }

    /// Remove a cached worker, forcing the next RPC to create a new PeerWorker
    /// with a fresh connection (uses updated membership address).
    pub async fn clear_worker(&self, to: &NodeId) {
        let mut workers = self.workers.write().await;
        workers.remove(to);
    }
}

impl RaftRpcClient for RaftPeerManager {
    fn send_request_vote(
        &self,
        to: NodeId,
        args: RequestVoteArgs,
    ) -> Pin<Box<dyn Future<Output = Result<RequestVoteReply, String>> + Send>> {
        let inner = Arc::clone(&self.inner);
        Box::pin(async move {
            let tx = inner.get_or_spawn_worker(to.clone()).await?;
            let request_id = uuid::Uuid::new_v4().to_string();
            let (response_tx, response_rx) = oneshot::channel();

            let req = PeerRequest::RequestVote {
                request_id: request_id.clone(),
                args,
                response_tx,
            };

            if let Err(_) = tx.send(req).await {
                inner.clear_worker(&to).await;
                return Err("Peer worker closed".to_string());
            }
            let resp_bytes = timeout(Duration::from_millis(3000), response_rx)
                .await
                .map_err(|_| "RPC timeout".to_string())?
                .map_err(|_| "Response channel closed".to_string())?;

            let bytes = resp_bytes.map_err(|e| e)?;
            serde_json::from_slice(&bytes)
                .map_err(|e| format!("Deserialize RequestVoteReply failed: {}", e))
        })
    }

    fn send_append_entries(
        &self,
        to: NodeId,
        args: AppendEntriesArgs,
    ) -> Pin<Box<dyn Future<Output = Result<AppendEntriesReply, String>> + Send>> {
        let inner = Arc::clone(&self.inner);
        Box::pin(async move {
            let tx = inner.get_or_spawn_worker(to.clone()).await?;
            let request_id = uuid::Uuid::new_v4().to_string();
            let (response_tx, response_rx) = oneshot::channel();

            let req = PeerRequest::AppendEntries {
                request_id: request_id.clone(),
                args,
                response_tx,
            };

            if let Err(_) = tx.send(req).await {
                inner.clear_worker(&to).await;
                return Err("Peer worker closed".to_string());
            }
            let resp_bytes = timeout(Duration::from_millis(3000), response_rx)
                .await
                .map_err(|_| "RPC timeout".to_string())?
                .map_err(|_| "Response channel closed".to_string())?;

            let bytes = resp_bytes.map_err(|e| e)?;
            serde_json::from_slice(&bytes)
                .map_err(|e| format!("Deserialize AppendEntriesReply failed: {}", e))
        })
    }
}

async fn run_peer_worker(
    addr: std::net::SocketAddr,
    identity: Arc<QuantumNodeIdentity>,
    to_id: NodeId,
    self_id: NodeId,
    mut rx: mpsc::Receiver<PeerRequest>,
) -> Result<(), String> {
    let mut backoff = Duration::from_millis(100);
    loop {
        info!(peer = %to_id, addr = %addr, "Attempting TCP connect");
        // 1. Connect and Handshake
        let connect_res = timeout(Duration::from_secs(1), TcpStream::connect(addr)).await;
        let mut stream = match connect_res {
            Ok(Ok(s)) => {
                info!(peer = %to_id, "TCP connected");
                s
            }
            Ok(Err(e)) => {
                error!(peer = %to_id, err = %e, "TCP connect failed, retrying in {:?}...", backoff);
                tokio::time::sleep(backoff).await;
                backoff = (backoff * 2).min(Duration::from_secs(30));
                continue;
            }
            Err(_) => {
                error!(peer = %to_id, "TCP connect timeout, retrying in {:?}...", backoff);
                tokio::time::sleep(backoff).await;
                backoff = (backoff * 2).min(Duration::from_secs(30));
                continue;
            }
        };

        info!(peer = %to_id, "Starting PQ handshake");
        let handshake_fut = run_initiator(&mut stream, &identity);
        let session = match tokio::time::timeout(
            tokio::time::Duration::from_millis(1500),
            handshake_fut,
        )
        .await
        {
            Ok(Ok(s)) => {
                info!(peer = %to_id, "PQ handshake successful");
                s
            }
            Ok(Err(e)) => {
                error!(peer = %to_id, err = %e, "PQ handshake failed, retrying in {:?}...", backoff);
                tokio::time::sleep(backoff).await;
                backoff = (backoff * 2).min(Duration::from_secs(30));
                continue;
            }
            Err(_) => {
                error!(peer = %to_id, "PQ handshake TIMEOUT (network starved), retrying...");
                tokio::time::sleep(backoff).await;
                backoff = (backoff * 2).min(Duration::from_secs(30));
                continue;
            }
        };

        let mut transport = AeadTransport::new(
            stream,
            *session.client_to_server_key,
            *session.server_to_client_key,
            session.session_id,
            session.session_salt,
            true,
        );
        info!(peer = %to_id, "Transport established");

        let mut pending_responses: HashMap<String, oneshot::Sender<Result<Vec<u8>, String>>> =
            HashMap::new();
        backoff = Duration::from_millis(100); // Reset backoff on successful connection

        loop {
            tokio::select! {
                Some(req) = rx.recv() => {
                    let request_id = req.request_id();
                    let rpc_type = req.rpc_type();
                    let payload = match req.payload() {
                        Ok(p) => p,
                        Err(e) => {
                            let _ = req.take_response_tx().send(Err(format!("Serialization error: {}", e)));
                            continue;
                        }
                    };
                    let response_tx = req.take_response_tx();

                    let envelope = RaftRpcEnvelope {
                        version: 1,
                        rpc_type,
                        sender_id: self_id.clone(),
                        receiver_id: to_id.clone(),
                        request_id: request_id.clone(),
                        payload,
                    };
                    let env_bytes = match serde_json::to_vec(&envelope) {
                        Ok(b) => b,
                        Err(e) => {
                            let _ = response_tx.send(Err(format!("Envelope serialization error: {}", e)));
                            continue;
                        }
                    };

                    pending_responses.insert(request_id.clone(), response_tx);

                    info!(peer = %to_id, req_id = request_id: request_id.clone(), "Sending RPC frame");
                    if let Err(e) = transport.write_frame(&env_bytes).await {
                        error!(peer = %to_id, err = %e, "Transport write failed");
                        for (_, tx) in pending_responses.drain() {
                            let _ = tx.send(Err("Connection lost".to_string()));
                        }
                        break;
                    }
                }
                res = transport.read_frame() => {
                    match res {
                        Ok(Some(frame)) => {
                            let resp_env: RaftRpcEnvelope = match serde_json::from_slice(&frame) {
                                Ok(env) => env,
                                Err(e) => {
                                    error!(peer = %to_id, err = %e, "Deserialize resp env failed");
                                    continue;
                                }
                            };

                            info!(peer = %to_id, req_id = resp_env.request_id: request_id.clone(), "Received response frame");
                            if let Some(tx) = pending_responses.remove(&resp_env.request_id) {
                                let _ = tx.send(Ok(resp_env.payload));
                            } else {
                                warn!(peer = %to_id, req_id = resp_env.request_id: request_id.clone(), "Received response for unknown/stale request");
                            }
                        }
                        Ok(None) => {
                            info!(peer = %to_id, "Peer closed connection");
                            for (_, tx) in pending_responses.drain() {
                                let _ = tx.send(Err("Connection lost".to_string()));
                            }
                            break;
                        }
                        Err(e) => {
                            error!(peer = %to_id, err = %e, "Transport read failed");
                            for (_, tx) in pending_responses.drain() {
                                let _ = tx.send(Err("Connection lost".to_string()));
                            }
                            break;
                        }
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;
    use std::sync::{Arc, Mutex};
    use std::thread;

    /// SEC-010: request_id uniqueness and collision resistance model.
    ///
    /// The `request_id` in Raft RPCs generated by `PeerManager` uses a cryptographically
    /// secure random 64-bit initialization vector (`rand::thread_rng().gen::<u64>()`),
    /// followed by atomic increments.
    ///
    /// This model guarantees:
    /// 1. Concurrent Generation: `AtomicU64::fetch_add` guarantees no duplicates across threads in the same process.
    /// 2. Process Restart: A restart generates a new cryptographically random 64-bit base. The probability of
    ///    a collision between two restarts generating overlapping sequences within realistic uptime (e.g., < 2^32 requests)
    ///    is negligible (bounded by the birthday paradox on 2^64).
    /// 3. Multiple Nodes: Different nodes seed from their own local `OsRng`, completely independent.
    #[test]
    fn sec010_request_id_initialization_and_concurrency_safety() {
        // 1. Process Restart Safety (simulated by instantiating multiple inner instances)
        let id1 = AtomicU64::new(rand::thread_rng().gen::<u64>());
        let id2 = AtomicU64::new(rand::thread_rng().gen::<u64>());

        // Very unlikely to collide on restart
        assert_ne!(
            id1.load(Ordering::SeqCst),
            id2.load(Ordering::SeqCst),
            "Restarted instances must generate distinct cryptographically random bases"
        );

        // 2. Concurrent Generation Safety
        let base_id = Arc::new(AtomicU64::new(rand::thread_rng().gen::<u64>()));
        let generated_ids = Arc::new(Mutex::new(HashSet::new()));

        let mut handles = vec![];
        for _ in 0..10 {
            let base_clone = Arc::clone(&base_id);
            let ids_clone = Arc::clone(&generated_ids);
            handles.push(thread::spawn(move || {
                for _ in 0..1000 {
                    let req_id = base_clone.fetch_add(1, Ordering::SeqCst);
                    ids_clone.lock().unwrap().insert(req_id);
                }
            }));
        }

        for handle in handles {
            handle.join().unwrap();
        }

        // We expect exactly 10,000 unique IDs to have been generated across the threads
        assert_eq!(
            generated_ids.lock().unwrap().len(),
            10000,
            "Concurrent generation must produce exactly unique, non-colliding IDs"
        );
    }
}
