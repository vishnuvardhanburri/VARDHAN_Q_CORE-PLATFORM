use colored::*;

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
    println!("{}", "eBPF XDP requires Linux kernel — running in network simulation mode on this platform. All traffic permitted in dev mode.".yellow().bold());
    Ok(())
}

#[cfg(target_os = "linux")]
#[tokio::main]
async fn main() -> Result<(), anyhow::Error> {
    use anyhow::Context;
    use aya::maps::HashMap;
    use aya::{
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
    let interface = std::env::var("EBPF_INTERFACE")
        .unwrap_or_else(|_| "eth0".to_string());

    println!("[eBPF] Loading XDP program from {}", path);
    println!("[eBPF] Attaching XDP program to {}", interface);

    let mut bpf = Bpf::load_file(&path)?;
    let program: &mut Xdp = bpf
        .program_mut("vardhan_firewall")
        .context("vardhan_firewall XDP program not found in eBPF object")?
        .try_into()?;
    program.load()?;
    program
        .attach(&interface, XdpFlags::default())
        .context("failed to attach the XDP program with default flags; use a deployment-specific XDP mode if required")?;

    println!("{}", "✓ Ring-0 Kernel Hook Active".green().bold());

    if let Ok(ips) = std::env::var("RAFT_PEER_IPS") {
        let mut allowed_peers: HashMap<_, u32, u32> =
            HashMap::try_from(bpf.map_mut("ALLOWED_PEERS").context("ALLOWED_PEERS map not found")?)?;
        for ip_str in ips.split(',').map(str::trim).filter(|s| !s.is_empty()) {
            if let Ok(ip) = ip_str.parse::<std::net::Ipv4Addr>() {
                let ip_u32 = u32::from(ip);
                allowed_peers.insert(ip_u32, 1, 0)?;
                println!("[eBPF] Allowed Peer IP: {}", ip_str);
            } else {
                eprintln!("[eBPF] Ignoring invalid RAFT_PEER_IPS entry: {}", ip_str);
            }
        }
    }

    tokio::signal::ctrl_c().await?;
    println!("Exiting...");
    Ok(())
}
