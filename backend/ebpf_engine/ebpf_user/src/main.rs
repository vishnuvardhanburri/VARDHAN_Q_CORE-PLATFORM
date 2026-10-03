use anyhow::Context;
use colored::*;
use tokio::signal;

#[cfg(not(target_os = "linux"))]
#[tokio::main]
async fn main() -> Result<(), anyhow::Error> {
    println!(
        "\n{}",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            .cyan()
            .bold()
    );
    println!(
        "{}",
        "  VARDHAN Q-CORE NODE — KERNEL SHIELD (eBPF XDP)"
            .white()
            .bold()
    );
    println!(
        "{}",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            .cyan()
            .bold()
    );
    println!("{}", "eBPF XDP requires Linux kernel — running in network simulation mode on macOS. All traffic permitted in dev mode.".yellow().bold());
    Ok(())
}

#[cfg(target_os = "linux")]
#[tokio::main]
async fn main() -> Result<(), anyhow::Error> {
    use aya::maps::HashMap;
    use aya::{
        include_bytes_aligned,
        programs::{Xdp, XdpFlags},
        Bpf,
    };
    use std::convert::TryInto;

    println!(
        "\n{}",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            .cyan()
            .bold()
    );
    println!(
        "{}",
        "  VARDHAN Q-CORE NODE — KERNEL SHIELD (eBPF XDP)"
            .white()
            .bold()
    );
    println!(
        "{}",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            .cyan()
            .bold()
    );

    let path = std::env::var("EBPF_OBJECT_PATH")
        .unwrap_or_else(|_| "/etc/vardhan/vardhan_firewall.o".to_string());
    println!("[eBPF] Loading XDP program from {}", path);

    // In production, we'd read from `path`. For CI, we can load a dummy or the real bytes.
    let mut bpf = Bpf::load_file(&path)?;
    let program: &mut Xdp = bpf.program_mut("vardhan_firewall").unwrap().try_into()?;
    program.load()?;
    program.attach("eth0", XdpFlags::default())
        .context("failed to attach the XDP program with default flags - try changing XdpFlags::default() to XdpFlags::SKB_MODE")?;

    println!("{}", "✓ Ring-0 Kernel Hook Active".green().bold());

    // Allow listed IPs
    if let Ok(ips) = std::env::var("RAFT_PEER_IPS") {
        let mut allowed_peers: HashMap<_, u32, u32> =
            HashMap::try_from(bpf.map_mut("ALLOWED_PEERS").unwrap())?;
        for ip_str in ips.split(',') {
            if let Ok(ip) = ip_str.parse::<std::net::Ipv4Addr>() {
                let ip_u32 = u32::from(ip);
                allowed_peers.insert(ip_u32, 1, 0)?;
                println!("[eBPF] Allowed Peer IP: {}", ip_str);
            }
        }
    }

    signal::ctrl_c().await?;
    println!("Exiting...");
    Ok(())
}
