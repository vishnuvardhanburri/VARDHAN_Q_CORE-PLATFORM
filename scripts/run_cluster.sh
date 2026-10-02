#!/bin/bash
# Clean up existing nodes
pkill -f "pq_shield" || true

# Start Mock Upstream
export VARDHAN_UPSTREAM_PORT=9090
/sessions/vigilant-sweet-fermat/mnt/vardhan-quantum-proxy/target/release/mock_upstream &
sleep 2

# Shared Config
export VARDHAN_ADMIN_TOKEN="admin-secret-123"
export VARDHAN_UPSTREAM="127.0.0.1:9090"
export VARDHAN_CLUSTER_PEERS="127.0.0.1:18090,127.0.0.1:18091,127.0.0.1:18092"

# Node A
export VARDHAN_PORT=8080
export VARDHAN_NODE_ID=node-a
export VARDHAN_RAFT_PORT=18090
/sessions/vigilant-sweet-fermat/mnt/vardhan-quantum-proxy/target/release/pq_shield &
sleep 1

# Node B
export VARDHAN_PORT=8081
export VARDHAN_NODE_ID=node-b
export VARDHAN_RAFT_PORT=18091
/sessions/vigilant-sweet-fermat/mnt/vardhan-quantum-proxy/target/release/pq_shield &
sleep 1

# Node C
export VARDHAN_PORT=8082
export VARDHAN_NODE_ID=node-c
export VARDHAN_RAFT_PORT=18092
/sessions/vigilant-sweet-fermat/mnt/vardhan-quantum-proxy/target/release/pq_shield &
sleep 5

echo "[*] Cluster started. Checking Raft status..."
curl -H "Authorization: Bearer admin-secret-123" http://localhost:8080/api/v1/raft/status
