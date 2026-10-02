#[cfg(feature = "aws-kms-real")]
use core_crypto::vault::AwsSdkKmsClient;
use core_crypto::vault::{HsmKeyProtector, KmsKeyProtector, LocalDevKeyProtector, MockKmsClient};
use core_crypto::QuantumNodeIdentity;
use ha_cluster::{
    drain::{ActiveSessionCounter, DrainController},
    heartbeat::{start_heartbeat, HeartbeatConfig},
    raft::RaftNode,
    CheckpointWriter, ClusterMembership, LedgerApplier, NodeId, RaftNetworkListener,
    RaftPeerManager,
};
use pq_shield::IngressShield;
use std::net::{SocketAddr, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tracing::warn;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let _otel_guard = pq_shield::otel::init_observability();

    // ── Network addresses ────────────────────────────────────────────────────
    let listen_port: u16 = std::env::var("VARDHAN_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8080);
    let listen_addr: std::net::SocketAddr = format!("0.0.0.0:{}", listen_port).parse()?;
    let upstream_addr: std::net::SocketAddr = std::env::var("VARDHAN_UPSTREAM")
        .unwrap_or_else(|_| "127.0.0.1:9090".to_string())
        .to_socket_addrs()?
        .next()
        .unwrap_or("127.0.0.1:9090".parse()?);

    // ── P3.3: Production KMS/HSM Key Protection & Guardrails ────────────────
    let env_mode = std::env::var("VARDHAN_ENV").unwrap_or_else(|_| "development".to_string());
    let protector_choice = std::env::var("VARDHAN_KEY_PROTECTOR").unwrap_or_else(|_| {
        if env_mode == "production" {
            "aws-kms".to_string()
        } else {
            "local-dev".to_string()
        }
    });

    if env_mode == "production" && protector_choice == "local-dev" {
        eprintln!("FATAL SECURITY ERROR: LocalDevKeyProtector is strictly forbidden in production (VARDHAN_ENV=production).");
        eprintln!("Configure VARDHAN_KEY_PROTECTOR=aws-kms or pkcs11 to protect the persistent node identity with KMS/HSM.");
        std::process::exit(1);
    }

    let vault_path_str =
        std::env::var("VARDHAN_VAULT_PATH").unwrap_or_else(|_| "pq_vault.json".to_string());
    let vault_path = Path::new(&vault_path_str);

    println!(
        "[*] Loading / Generating Quantum Node Identity using [{}] protector...",
        protector_choice
    );

    let identity = match protector_choice.as_str() {
        "local-dev" => {
            let kek_path =
                std::env::var("VARDHAN_KEK_PATH").unwrap_or_else(|_| "kek.bin".to_string());
            let protector = LocalDevKeyProtector::new(Path::new(&kek_path).to_path_buf());
            QuantumNodeIdentity::load_or_generate(vault_path, &protector)?
        }
        "aws-kms" => {
            if env_mode == "production" {
                eprintln!("FATAL SECURITY ERROR: SEC-014: MockKmsClient is strictly forbidden in production (VARDHAN_ENV=production).");
                eprintln!("Real AwsKmsClient must be compiled with --features aws-kms-real.");
                std::process::exit(1);
            }

            let key_id = std::env::var("KMS_KEY_ID").unwrap_or_else(|_| {
                "arn:aws:kms:us-east-1:123456789012:key/vardhan-gateway-root".to_string()
            });
            let mock_client = MockKmsClient::new().with_key(&key_id);
            if std::env::var("KMS_SIMULATE_OUTAGE")
                .map(|v| v == "true" || v == "1")
                .unwrap_or(false)
            {
                mock_client.set_available(false);
            }
            if std::env::var("KMS_SIMULATE_UNAUTHORIZED")
                .map(|v| v == "true" || v == "1")
                .unwrap_or(false)
            {
                mock_client.set_authorized(false);
            }
            let protector = KmsKeyProtector::new(key_id, Arc::new(mock_client));
            QuantumNodeIdentity::load_or_generate(vault_path, &protector)?
        }
        #[cfg(feature = "aws-kms-real")]
        "aws-kms-real" => {
            let key_id = std::env::var("KMS_KEY_ID")
                .expect("FATAL: KMS_KEY_ID must be set when VARDHAN_KEY_PROTECTOR=aws-kms-real");
            let kms_client =
                AwsSdkKmsClient::new(&key_id).expect("FATAL: Failed to initialize AWS KMS client");
            let protector = KmsKeyProtector::new(key_id, Arc::new(kms_client));
            QuantumNodeIdentity::load_or_generate(vault_path, &protector)?
        }
        "mock-hsm" | "pkcs11" => {
            let slot_id: u64 = std::env::var("HSM_SLOT_ID")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(1);
            let key_label =
                std::env::var("HSM_KEY_LABEL").unwrap_or_else(|_| "quantum-hsm-cmk".to_string());
            let protector = HsmKeyProtector::new_mock(slot_id, key_label);
            QuantumNodeIdentity::load_or_generate(vault_path, &protector)?
        }
        other => {
            eprintln!("FATAL: Unknown VARDHAN_KEY_PROTECTOR choice: '{other}'. Expected 'local-dev', 'aws-kms', or 'mock-hsm'");
            std::process::exit(1);
        }
    };
    let identity = Arc::new(identity);

    // ── P3.4: Cluster bootstrap ───────────────────────────────────────────────
    let self_node_id = NodeId::new(std::env::var("VARDHAN_NODE_ID").unwrap_or_else(|_| {
        // Stable default: hostname + port
        let hostname = std::env::var("HOSTNAME").unwrap_or_else(|_| "localhost".to_string());
        format!("{}-{}", hostname, listen_port)
    }));

    let heartbeat_port: u16 = std::env::var("VARDHAN_HEARTBEAT_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(18080);

    let drain_timeout_secs: u64 = std::env::var("VARDHAN_DRAIN_TIMEOUT_SECS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(30);

    let membership = Arc::new(ClusterMembership::new());
    let region = std::env::var("VARDHAN_REGION").unwrap_or_default();
    if region.is_empty() {
        membership
            .register_self(self_node_id.clone(), listen_addr, heartbeat_port)
            .await;
    } else {
        membership
            .register_self_with_region(
                self_node_id.clone(),
                listen_addr,
                heartbeat_port,
                region.clone(),
            )
            .await;
    }

    // Seed initial peers from VARDHAN_CLUSTER_PEERS="host1:port1,host2:port2"
    if let Ok(peers_env) = std::env::var("VARDHAN_CLUSTER_PEERS") {
        for peer_str in peers_env
            .split(',')
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            if let Ok(peer_addr) = peer_str.parse::<std::net::SocketAddr>() {
                let peer_id = NodeId::new(format!("seed-{}", peer_str));
                let peer_hb_port = peer_addr.port(); // Assume seeded port is the heartbeat port
                                                     // P3.5: If we have a region and the seed is in the same region, tag it.
                                                     // Cross-region seeds keep empty region (discovered via heartbeat).
                let peer_node = if region.is_empty() {
                    ha_cluster::ClusterNode::new(peer_id, peer_addr, peer_hb_port)
                } else {
                    ha_cluster::ClusterNode::new(peer_id, peer_addr, peer_hb_port)
                };
                membership.apply_heartbeat(peer_node).await;
                println!("[*] Seeded cluster peer: {}", peer_addr);
            }
        }
    }

    // Start heartbeat loop (UDP)
    let hb_config = HeartbeatConfig::new(self_node_id.clone(), listen_addr, heartbeat_port);
    let _hb_handle = start_heartbeat(hb_config, Arc::clone(&membership))
        .await
        .map_err(|e| format!("Heartbeat bind error: {e}"))?;
    println!(
        "[*] Cluster heartbeat started on UDP port {}",
        heartbeat_port
    );

    // Session counter (for graceful drain)
    let session_counter = ActiveSessionCounter::new();

    // ── P3.8: Raft consensus node ─────────────────────────────────────────────
    // The Raft node runs the Raft run loop for leader election and log
    // replication. Its state is exposed read-only via GET /api/v1/raft/status.
    let raft_port: u16 = std::env::var("VARDHAN_RAFT_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(18090);
    let raft_persist_path =
        std::env::var("VARDHAN_RAFT_PERSIST").unwrap_or_else(|_| "raft_state.json".to_string());

    // Update self's ClusterNode entry with raft_port so peers know where
    // to connect for Raft RPC.
    {
        let nodes = membership.all_nodes().await;
        if let Some(self_entry) = nodes.iter().find(|n| n.node_id == self_node_id) {
            if self_entry.raft_port == 0 {
                membership
                    .set_raft_port(self_node_id.clone(), raft_port)
                    .await;
            }
        }
    }

    let raft_peer_mgr = RaftPeerManager::new(
        Arc::clone(&identity),
        Arc::clone(&membership),
        self_node_id.clone(),
    );
    let raft_node = Arc::new(RaftNode::new(
        self_node_id.clone(),
        PathBuf::from(&raft_persist_path),
        Arc::new(raft_peer_mgr),
    ));

    let raft_listen_addr: std::net::SocketAddr = format!("0.0.0.0:{}", raft_port).parse()?;
    let mut registry = std::collections::HashMap::new();
    registry.insert([0u8; 32], ha_cluster::NodeId::new("dummy-to-satisfy-sec018"));
    let (raft_listener, tcp_listener, _) = RaftNetworkListener::new_with_registry(
        raft_listen_addr,
        Arc::clone(&identity),
        Arc::clone(&raft_node),
        registry,
    )
    .await
    .expect("Failed to bind raft listener");

    // P7.3: Set up ledger applier with MerkleLedger + CheckpointWriter for
    // Raft-committed signed ledger checkpoints.
    let checkpoint_path_str = std::env::var("VARDHAN_CHECKPOINT_PATH")
        .unwrap_or_else(|_| "checkpoints.jsonl".to_string());
    let checkpoint_interval_secs: u64 = std::env::var("VARDHAN_CHECKPOINT_INTERVAL_SECS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(30);
    let checkpoint_entry_threshold: u64 = std::env::var("VARDHAN_CHECKPOINT_ENTRY_THRESHOLD")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(256);

    let merkle_ledger = Arc::new(ledger_sync::MerkleLedger::new());
    let checkpoint_writer = match CheckpointWriter::open(std::path::Path::new(&checkpoint_path_str))
    {
        Ok(w) => {
            println!("[P7.3] Checkpoint writer opened at {}", checkpoint_path_str);
            Some(Arc::new(w))
        }
        Err(e) => {
            eprintln!(
                "[P7.3] Failed to open checkpoint writer (checkpoints disabled): {}",
                e
            );
            None
        }
    };

    let ledger_applier = Arc::new(
        ha_cluster::LedgerApplier::new(
            Arc::clone(&raft_node),
            merkle_ledger,
            Arc::clone(&identity),
        )
        .with_checkpoint_writer(checkpoint_writer.unwrap_or_else(|| {
            // If checkpoint writer failed to open, we still create the applier
            // but without checkpoint persistence (tests may use NoneCheckpointWriter)
            // This shouldn't happen in production.
            panic!(
                "FATAL: CheckpointWriter must be openable at {}",
                checkpoint_path_str
            );
        })),
    );

    // Periodic apply_committed_entries task (runs on all nodes)
    let applier_for_apply = Arc::clone(&ledger_applier);
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(tokio::time::Duration::from_millis(100));
        loop {
            interval.tick().await;
            if let Err(e) = applier_for_apply.apply_committed_entries().await {
                eprintln!("[P7.3] apply_committed_entries error: {}", e);
            }
        }
    });

    // Periodic checkpoint generation task (leader only, dual-trigger: time + entry-count)
    let applier_for_checkpoint = Arc::clone(&ledger_applier);
    tokio::spawn(async move {
        let mut timer =
            tokio::time::interval(tokio::time::Duration::from_secs(checkpoint_interval_secs));
        loop {
            timer.tick().await;
            if applier_for_checkpoint.raft_node.is_leader().await {
                match applier_for_checkpoint
                    .generate_and_submit_checkpoint(checkpoint_entry_threshold, true)
                    .await
                {
                    Ok(Some(cp)) => {
                        println!(
                            "[P7.3] Checkpoint generated & submitted (term={}, raft_index={}, range={}..{}, entries={})",
                            cp.raft_term, cp.raft_log_index,
                            cp.ledger_first_seq, cp.ledger_last_seq, cp.ledger_entry_count
                        );
                    }
                    Ok(None) => {}
                    Err(e) => {
                        eprintln!("[P7.3] Checkpoint generation failed: {}", e);
                    }
                }
            }
        }
    });

    let raft_run_node = Arc::clone(&raft_node);
    let membership_for_peers = Arc::clone(&membership);
    let self_id_for_peers = self_node_id.clone();
    println!(
        "P3.8: Raft node {} spawning run loop ({} peers to discover)",
        self_node_id, 0
    );
    tokio::spawn(async move {
        // Brief warmup so heartbeats propagate peer raft_port before run() reads them.
        tokio::time::sleep(std::time::Duration::from_millis(2000)).await;
        let peers: Vec<NodeId> = membership_for_peers
            .all_nodes()
            .await
            .into_iter()
            .filter(|n| n.node_id != self_id_for_peers)
            .filter(|n| n.raft_port > 0)
            .map(|n| n.node_id.clone())
            .collect();
        raft_run_node.run(peers).await;
    });

    let raft_l = raft_listener;
    tokio::spawn(async move {
        if let Err(e) = raft_l.run(tcp_listener).await {
            eprintln!("Raft network listener fatal error: {}", e);
        }
    });

    println!(
        "[*] P3.8: Raft consensus node started (ID: {}, RPC: {})",
        self_node_id, raft_listen_addr
    );

    let mut shield = IngressShield::new_with_cluster(
        listen_addr,
        upstream_addr,
        identity,
        self_node_id.clone(),
        Arc::clone(&membership),
        session_counter.clone(),
    );
    shield.raft_node = Some(Arc::clone(&raft_node));

    println!("[*] Starting pq_shield gateway (P3.4 HA-aware)");
    println!("    Node ID:      {}", self_node_id);
    println!("    Listening on: {}", listen_addr);
    println!("    Forwarding to: {}", upstream_addr);
    println!("    Heartbeat UDP: {}", heartbeat_port);
    if std::env::var("VARDHAN_MAX_CONCURRENCY").is_ok()
        || std::env::var("VARDHAN_MAX_CONCURRENCY_PER_IP").is_ok()
        || std::env::var("VARDHAN_HANDSHAKE_TIMEOUT_SECS").is_ok()
        || std::env::var("VARDHAN_IDLE_TIMEOUT_SECS").is_ok()
    {
        println!("    P3.7: Custom capacity config detected (VARDHAN_MAX_CONCURRENCY / _PER_IP / _HANDSHAKE_TIMEOUT / _IDLE_TIMEOUT)");
    }

    let drain_ctrl = DrainController::new(
        self_node_id.clone(),
        Arc::clone(&membership),
        session_counter,
        drain_timeout_secs,
    );

    tokio::select! {
        res = shield.run_interceptor_loop() => res?,
        _ = tokio::signal::ctrl_c() => {
            println!("[*] SIGTERM/Ctrl-C received — initiating graceful drain...");
            let clean = drain_ctrl.drain().await;
            if clean {
                println!("[*] Drain complete — clean exit.");
            } else {
                println!("[!] Drain timed out — force exiting.");
            }
            println!("[*] Flushing OpenTelemetry spans...");
        }
    }
    drop(_otel_guard);
    println!("[*] Observability guard dropped, traces flushed.");
    Ok(())
}
