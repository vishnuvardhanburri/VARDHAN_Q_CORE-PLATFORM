// VARDHAN Q-CORE — SOVEREIGN NODE eBPF DEFENSE (XDP)
// Kernel-level packet filtering for Linux deployments.
// Production policy: critical peer ports are allowlisted; SYN floods are rate limited.

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
// ABI is shared with the Rust loader: IPv4 key, u32 allow value.
struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 1024);
    __type(key, __u32);
    __type(value, __u32);
} ALLOWED_PEERS SEC(".maps");

// BPF Map: Tarpit / blocked source addresses
struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 10000);
    __type(key, __u32);
    __type(value, __u64);
} tarpit_ips SEC(".maps");

struct rate_limit_state {
    __u64 last_reset_ts;
    __u32 count;
};

struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 100000);
    __type(key, __u32);
    __type(value, struct rate_limit_state);
} syn_rate_limit SEC(".maps");

SEC("xdp")
int vardhan_firewall(struct xdp_md *ctx) {
    void *data_end = (void *)(long)ctx->data_end;
    void *data = (void *)(long)ctx->data;

    struct ethhdr *eth = data;
    if ((void *)(eth + 1) > data_end) return XDP_PASS;
    if (eth->h_proto != __constant_htons(ETH_P_IP)) return XDP_PASS;

    struct iphdr *ip = (void *)(eth + 1);
    if ((void *)(ip + 1) > data_end) return XDP_PASS;
    __u32 src_ip = ip->saddr;

    __u64 *banned = bpf_map_lookup_elem(&tarpit_ips, &src_ip);
    if (banned) return XDP_DROP;

    if (ip->protocol != IPPROTO_TCP) return XDP_PASS;

    // Validate the variable-length IPv4 header before locating TCP.
    __u32 ip_header_len = (__u32)ip->ihl * 4;
    if (ip_header_len < sizeof(*ip)) return XDP_PASS;
    if ((void *)ip + ip_header_len > data_end) return XDP_PASS;

    struct tcphdr *tcp = (void *)ip + ip_header_len;
    if ((void *)(tcp + 1) > data_end) return XDP_PASS;

    __u16 dst_port = __constant_ntohs(tcp->dest);

    if (dst_port == VARDHAN_RAFT_PORT || dst_port == VARDHAN_SYNC_PORT) {
        __u32 *is_allowed = bpf_map_lookup_elem(&ALLOWED_PEERS, &src_ip);
        if (!is_allowed || *is_allowed != 1) {
            __u64 now = bpf_ktime_get_ns();
            bpf_map_update_elem(&tarpit_ips, &src_ip, &now, BPF_ANY);
            return XDP_DROP;
        }
    }

    if (tcp->syn && !tcp->ack) {
        __u64 now = bpf_ktime_get_ns();
        struct rate_limit_state *state = bpf_map_lookup_elem(&syn_rate_limit, &src_ip);

        if (state) {
            if (now - state->last_reset_ts > 1000000000ULL) {
                state->count = 1;
                state->last_reset_ts = now;
            } else {
                state->count++;
                if (state->count > MAX_SYN_PER_SEC) {
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
