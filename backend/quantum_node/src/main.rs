use anyhow::{Context, Result};
use clap::Parser;
use core_crypto::QuantumNodeIdentity;
use ledger_persistence::DiskLedgerWal;
use ledger_sync::{LedgerBlock, LedgerSyncChannel, MerkleLedger};
use proxy_engine::{run_initiator, QuantumProxyListener};
use quantum_network::{GossipEngine, GossipMessage, PeerRegistry};
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::net::TcpStream;
use tokio::signal;
use tokio::sync::{broadcast, mpsc};
use tracing::{error, info, warn};
use tracing_subscriber::EnvFilter;

#[derive(Parser, Debug)]
#[command(
    name = "quantum_node",
    version = "0.1.0",
    about = "Vardhan Post-Quantum Proxy Node"
)]
struct Cli {
    /// Local TCP address to bind the proxy listener
    #[arg(short, long, default_value = "127.0.0.1:8443")]
    bind: String,

    /// Optional peer TCP addresses to initiate outbound post-quantum session (comma separated)
    #[arg(short, long, value_delimiter = ',')]
    peers: Vec<String>,

    /// Optional path to configuration TOML file
    #[arg(short, long)]
    config: Option<PathBuf>,

    /// Flag to initialize node with a Genesis block
    #[arg(short, long)]
    genesis: bool,

    /// Directory for ledger and identity persistence
    #[arg(short, long, default_value = "./data")]
    data_dir: PathBuf,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let cli = Cli::parse();
    info!("Starting Vardhan Quantum Proxy Node...");

    if !cli.data_dir.exists() {
        std::fs::create_dir_all(&cli.data_dir).context("Failed to create data directory")?;
    }

    let wal_path = cli.data_dir.join("ledger.wal");
    let identity_path = cli.data_dir.join("node_identity.vault");

    // Use a secret provider (Env var)
    let vault_pass = std::env::var("VARDHAN_VAULT_PASS").map_err(|_| {
        if std::env::var("VARDHAN_ENV").ok().as_deref() == Some("production") {
            anyhow::anyhow!("CRITICAL: VARDHAN_VAULT_PASS must be set in production environment")
        } else {
            anyhow::anyhow!("VARDHAN_VAULT_PASS environment variable not set")
        }
    })?;
    let protector = ledger_persistence::HardenedLocalKeyProtector::new(vault_pass.as_bytes());

    let identity = Arc::new(
        QuantumNodeIdentity::load_or_generate(&identity_path, &protector)
            .map_err(|e| anyhow::anyhow!("Identity load/gen failed: {e}"))?,
    );

    let node_pub_key = identity.dsa_public_key_bytes();
    info!("Node PQ identity loaded/generated and securely vaulted.");

    let ledger = MerkleLedger::new();
    let wal = Arc::new(DiskLedgerWal::new(wal_path.to_string_lossy().to_string()));

    let replayed = wal
        .replay_into_ledger(&ledger, &node_pub_key)
        .await
        .context("Failed to replay ledger WAL")?;
    info!("Replayed {} blocks from WAL into Merkle Ledger.", replayed);

    // Channels for gossip and block dissemination
    let (block_tx, mut block_rx) = mpsc::channel::<LedgerBlock>(100);
    let (gossip_tx, _gossip_rx) = broadcast::channel::<LedgerBlock>(100);

    let registry = PeerRegistry::new();
    for peer_str in &cli.peers {
        if let Ok(addr) = peer_str.parse::<SocketAddr>() {
            registry.register_peer(addr).await;
        }
    }

    let local_id = ha_cluster::NodeId::new("node-0");
    let gossip_engine = Arc::new(GossipEngine::new(
        identity.clone(),
        local_id,
        registry.clone(),
        block_tx,
    ));

    if cli.genesis && replayed == 0 {
        let genesis_block = LedgerBlock::new(
            0,
            1,
            [0u8; 32],
            [0u8; 32],
            b"VARDHAN_QUANTUM_GENESIS_BLOCK",
            &identity,
        )
        .map_err(|e| anyhow::anyhow!("Genesis creation failed: {e}"))?;

        ledger
            .append_block(genesis_block.clone(), &node_pub_key)
            .await
            .map_err(|e| anyhow::anyhow!("Genesis append failed: {e}"))?;
        wal.append(&genesis_block)
            .context("Failed to append genesis to WAL")?;

        // Broadcast genesis block
        let _ = gossip_tx.send(genesis_block);
        info!("Genesis block successfully committed and broadcasted.");
    }

    // Process blocks from the Gossip engine queue
    let ledger_clone = ledger.clone();
    let wal_clone = wal.clone();
    let gossip_tx_clone = gossip_tx.clone();
    let npk_clone = node_pub_key.clone();
    tokio::spawn(async move {
        while let Some(block) = block_rx.recv().await {
            if ledger_clone
                .append_block(block.clone(), &npk_clone)
                .await
                .is_ok()
            {
                let _ = wal_clone.append(&block);
                let _ = gossip_tx_clone.send(block); // re-broadcast
            }
        }
    });

    let bind_addr = cli.bind.clone();
    let listener_identity = (*identity).clone();

    // Spawn Ingress Proxy Listener Task
    let engine_clone = gossip_engine.clone();
    let bcast_tx = gossip_tx.clone();
    let listener_handle = tokio::spawn(async move {
        let tcp_listener = match tokio::net::TcpListener::bind(&bind_addr).await {
            Ok(l) => l,
            Err(e) => {
                error!("Failed to bind TCP listener on {bind_addr}: {e}");
                return;
            }
        };
        let listener = QuantumProxyListener::from_parts(tcp_listener, listener_identity);
        info!("Quantum Proxy Listener active on {}", bind_addr);

        loop {
            if let Ok((session, stream)) = listener.accept_handshake().await {
                info!("Established PQ handshake session with peer: {}", "UNKNOWN");
                let mut channel = LedgerSyncChannel::new(stream, &session, true);
                let session_key = session.session_id;
                let mut bcast_rx = bcast_tx.subscribe();
                let engine = engine_clone.clone();

                tokio::spawn(async move {
                    loop {
                        tokio::select! {
                            Ok(Some(block)) = channel.recv_block() => {
                                info!("Received Ledger Block index {} over PQ session", block.index);
                                // For gossip, we just package it and process
                                let frame = engine.create_gossip_frame(&session_key, &GossipMessage::BlockBroadcast(block)).await.unwrap();
                                let _ = engine.process_incoming_gossip(&session_key, &frame).await;
                            }
                            Ok(block) = bcast_rx.recv() => {
                                let _ = channel.send_block(&block).await;
                            }
                            else => break, // Connection closed
                        }
                    }
                });
            }
        }
    });

    // Initiate outbound connections to peers
    for peer_addr in cli.peers {
        let client_id = (*identity).clone();
        let engine_clone = gossip_engine.clone();
        let bcast_tx = gossip_tx.clone();

        tokio::spawn(async move {
            info!("Initiating outbound PQ session to peer: {peer_addr}");
            if let Ok(mut stream) = TcpStream::connect(&peer_addr).await {
                if let Ok(session) = run_initiator(&mut stream, &client_id).await {
                    info!("Outbound PQ session established with {}", "UNKNOWN");
                    let mut channel = LedgerSyncChannel::new(stream, &session, false);
                    let session_key = session.session_id;
                    let mut bcast_rx = bcast_tx.subscribe();

                    loop {
                        tokio::select! {
                            Ok(Some(block)) = channel.recv_block() => {
                                info!("Received Ledger Block index {} over PQ session", block.index);
                                let frame = engine_clone.create_gossip_frame(&session_key, &GossipMessage::BlockBroadcast(block)).await.unwrap();
                                let _ = engine_clone.process_incoming_gossip(&session_key, &frame).await;
                            }
                            Ok(block) = bcast_rx.recv() => {
                                let _ = channel.send_block(&block).await;
                            }
                            else => break,
                        }
                    }
                }
            }
        });
    }

    info!("Node running. Press Ctrl+C to shut down gracefully.");
    signal::ctrl_c()
        .await
        .context("Failed to listen for Ctrl+C signal")?;
    info!("Shutdown signal received. Flushing state and stopping node...");
    listener_handle.abort();
    info!("Vardhan Quantum Proxy Node terminated cleanly.");
    Ok(())
}
