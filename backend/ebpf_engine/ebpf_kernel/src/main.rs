#![no_std]
#![no_main]

use aya_ebpf::{
    bindings::xdp_action,
    macros::{map, xdp},
    maps::XskMap,
    programs::XdpContext,
};

// AF_XDP Map: This is the zero-copy portal between the NIC and our Rust Userspace
#[map]
static AF_XDP_MAP: XskMap = XskMap::with_max_entries(64, 0);

#[xdp]
pub fn pq_shield_xdp(ctx: XdpContext) -> u32 {
    match try_pq_shield_xdp(ctx) {
        Ok(ret) => ret,
        Err(_) => xdp_action::XDP_ABORTED,
    }
}

#[inline(always)]
fn try_pq_shield_xdp(ctx: XdpContext) -> Result<u32, ()> {
    // In a full implementation, we parse Ethernet/IP/TCP headers here
    // to identify our target High-Frequency Trading (HFT) traffic.
    let is_hft_traffic = true; 

    if is_hft_traffic {
        // Redirect the packet directly to the AF_XDP userspace socket
        // completely bypassing the Linux Kernel Network Stack (TCP/IP)
        let queue_id = ctx.rx_queue_index();
        
        // Safety: We are redirecting the packet to the socket map based on the Rx queue.
        return Ok(unsafe { AF_XDP_MAP.redirect(queue_id, 0) }.unwrap_or(xdp_action::XDP_PASS));
    }

    Ok(xdp_action::XDP_PASS)
}

#[panic_handler]
fn panic(_info: &core::panic::PanicInfo) -> ! {
    unsafe { core::hint::unreachable_unchecked() }
}
