// VARDHAN QUANTUM — SOVEREIGN NODE eBPF DEFENSE (XDP)
// This module runs in the Linux kernel. It drops packets before they hit the OS.
// Features: Zero-Trust Peer Filtering, Autonomous Tarpitting, SYN Flood Rate Limiting.

#include <linux/bpf.h>
#include <linux/if_ether.h>
#include <linux/ip.h>
#include <linux/tcp.h>
#include <linux/in.h>
#include <bpf/bpf_helpers.h>

#define VARDHAN_RAFT_PORT 50051
#define VARDHAN_SYNC_PORT 50052
#define MAX_SYN_PER_SEC 100

// BPF Map: Allowed Sovereign Peers
struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 1024);
    __type(key, __u32);   // IP Address
    __type(value, __u8);  // 1 = Allowed
} allowed_peers SEC(".maps");

// BPF Map: Tarpit (Infinite delay for attackers)
struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 10000);
    __type(key, __u32);   // IP Address
    __type(value, __u64); // Timestamp of ban
} tarpit_ips SEC(".maps");

// BPF Map: SYN Flood Rate Limiter State
struct rate_limit_state {
    __u64 last_reset_ts;
    __u32 count;
};

struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 100000);
    __type(key, __u32);   // IP Address
    __type(value, struct rate_limit_state);
} syn_rate_limit SEC(".maps");

SEC("xdp")
int vardhan_sovereign_filter(struct xdp_md *ctx) {
    void *data_end = (void *)(long)ctx->data_end;
    void *data = (void *)(long)ctx->data;

    // 1. Parse Ethernet
    struct ethhdr *eth = data;
    if ((void *)(eth + 1) > data_end) return XDP_PASS;
    if (eth->h_proto != __constant_htons(ETH_P_IP)) return XDP_PASS;

    // 2. Parse IP
    struct iphdr *ip = (void *)(eth + 1);
    if ((void *)(ip + 1) > data_end) return XDP_PASS;
    __u32 src_ip = ip->saddr;

    // 3. Check Tarpit first (drop instantly if banned)
    __u64 *banned = bpf_map_lookup_elem(&tarpit_ips, &src_ip);
    if (banned) return XDP_DROP; // Silent drop - attacker hangs forever

    if (ip->protocol != IPPROTO_TCP) return XDP_PASS;

    // 4. Parse TCP
    struct tcphdr *tcp = (void *)ip + (ip->ihl * 4);
    if ((void *)(tcp + 1) > data_end) return XDP_PASS;

    __u16 dst_port = __constant_ntohs(tcp->dest);

    // 5. Zero-Trust Enforcement on Critical Ports
    if (dst_port == VARDHAN_RAFT_PORT || dst_port == VARDHAN_SYNC_PORT) {
        __u8 *is_allowed = bpf_map_lookup_elem(&allowed_peers, &src_ip);
        if (!is_allowed) {
            __u64 now = bpf_ktime_get_ns();
            bpf_map_update_elem(&tarpit_ips, &src_ip, &now, BPF_ANY);
            return XDP_DROP;
        }
    }

    // 6. SYN Flood Protection (Autonomous Defense)
    if (tcp->syn && !tcp->ack) {
        __u64 now = bpf_ktime_get_ns();
        struct rate_limit_state *state = bpf_map_lookup_elem(&syn_rate_limit, &src_ip);
        
        if (state) {
            // Reset bucket every 1 second (1,000,000,000 ns)
            if (now - state->last_reset_ts > 1000000000ULL) {
                state->count = 1;
                state->last_reset_ts = now;
            } else {
                state->count++;
                if (state->count > MAX_SYN_PER_SEC) {
                    // Attack detected. Throw them in the Tarpit.
                    bpf_map_update_elem(&tarpit_ips, &src_ip, &now, BPF_ANY);
                    return XDP_DROP;
                }
            }
        } else {
            struct rate_limit_state new_state = { .last_reset_ts = now, .count = 1 };
            bpf_map_update_elem(&syn_rate_limit, &src_ip, &new_state, BPF_ANY);
        }
    }

    return XDP_PASS;
}

char _license[] SEC("license") = "GPL";
