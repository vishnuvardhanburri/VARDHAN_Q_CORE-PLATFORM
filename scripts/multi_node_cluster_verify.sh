#!/usr/bin/env bash
# Q-Core Multi-Node Clustered Idempotency Verification Script
# Validates Section 5 of Master Implementation Directive:
# Multi-instance atomic coordination over PostgreSQL.
# Zero emojis across all output.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

NODE1_PORT="18081"
NODE2_PORT="18082"
NODE1_ADDR="127.0.0.1:${NODE1_PORT}"
NODE2_ADDR="127.0.0.1:${NODE2_PORT}"

DATA_DIR1="/tmp/qcore_cluster_verify_node1_$$"
DATA_DIR2="/tmp/qcore_cluster_verify_node2_$$"

NODE1_PID=""
NODE2_PID=""

cleanup() {
    echo "[INFO] Cleaning up test processes and temp directories..."
    if [ -n "${NODE1_PID}" ] && kill -0 "${NODE1_PID}" 2>/dev/null; then
        kill "${NODE1_PID}" 2>/dev/null || true
    fi
    if [ -n "${NODE2_PID}" ] && kill -0 "${NODE2_PID}" 2>/dev/null; then
        kill "${NODE2_PID}" 2>/dev/null || true
    fi
    rm -rf "${DATA_DIR1}" "${DATA_DIR2}" "${PASSWORD_FILE:-}"
    echo "[INFO] Cleanup complete."
}
trap cleanup EXIT INT TERM

echo "======================================================================"
echo "Q-CORE CLUSTER VERIFICATION: MULTI-NODE POSTGRESQL IDEMPOTENCY"
echo "======================================================================"

# 1. Resolve PostgreSQL Database URL
PG_URL="${DATABASE_URL:-${TEST_DATABASE_URL:-postgresql://postgres:qcore_secret@127.0.0.1:5433/qcore_test}}"
echo "[INFO] Target PostgreSQL URL: ${PG_URL}"

PASSWORD_FILE="/tmp/qcore_cluster_admin_pass_$$"
echo "ClusterPassword123!" > "${PASSWORD_FILE}"
chmod 600 "${PASSWORD_FILE}"

export VARDHAN_ADMIN_USERNAME="cluster_admin"
export VARDHAN_ADMIN_PASSWORD_FILE="${PASSWORD_FILE}"

# 2. Build Required Binaries
echo "[INFO] Compiling required binaries (control_plane_api, vardhan-receipt)..."
cd "${WORKSPACE_ROOT}"
cargo build -p vardhan_receipt -p control_plane_api --quiet

RECEIPT_BIN="${WORKSPACE_ROOT}/target/debug/vardhan-receipt"
CONTROL_PLANE_BIN="${WORKSPACE_ROOT}/target/debug/control_plane_api"

if [ ! -f "${RECEIPT_BIN}" ] || [ ! -f "${CONTROL_PLANE_BIN}" ]; then
    echo "[ERROR] Required binaries missing after build." >&2
    exit 1
fi

mkdir -p "${DATA_DIR1}" "${DATA_DIR2}"

# 3. Launch Node 1
echo "[INFO] Starting Node 1 on ${NODE1_ADDR}..."
VARDHAN_CONTROL_PLANE_DATA_DIR="${DATA_DIR1}" \
VARDHAN_CONTROL_PLANE_ADDR="${NODE1_ADDR}" \
VARDHAN_NODE_ID="node-verify-01" \
VARDHAN_RECEIPT_BIN="${RECEIPT_BIN}" \
DATABASE_URL="${PG_URL}" \
"${CONTROL_PLANE_BIN}" > "${DATA_DIR1}/node1.log" 2>&1 &
NODE1_PID=$!

# 4. Launch Node 2
echo "[INFO] Starting Node 2 on ${NODE2_ADDR}..."
VARDHAN_CONTROL_PLANE_DATA_DIR="${DATA_DIR2}" \
VARDHAN_CONTROL_PLANE_ADDR="${NODE2_ADDR}" \
VARDHAN_NODE_ID="node-verify-02" \
VARDHAN_RECEIPT_BIN="${RECEIPT_BIN}" \
DATABASE_URL="${PG_URL}" \
"${CONTROL_PLANE_BIN}" > "${DATA_DIR2}/node2.log" 2>&1 &
NODE2_PID=$!

# 5. Wait for nodes to report healthy
echo "[INFO] Waiting for both nodes to initialize clustered storage..."
READY=0
for i in $(seq 1 30); do
    STATUS1=$(curl -s "http://${NODE1_ADDR}/api/v1/platform/health" | grep -o '"storage":"healthy"' || true)
    STATUS2=$(curl -s "http://${NODE2_ADDR}/api/v1/platform/health" | grep -o '"storage":"healthy"' || true)
    if [ -n "${STATUS1}" ] && [ -n "${STATUS2}" ]; then
        READY=1
        break
    fi
    sleep 0.5
done

if [ "${READY}" -ne 1 ]; then
    echo "[ERROR] Nodes failed to become ready within 15 seconds." >&2
    echo "--- Node 1 Log ---" >&2
    cat "${DATA_DIR1}/node1.log" >&2
    echo "--- Node 2 Log ---" >&2
    cat "${DATA_DIR2}/node2.log" >&2
    exit 1
fi

echo "[INFO] Node 1 and Node 2 healthy and connected to shared PostgreSQL backend."

# 6. Execute Multi-Instance Integration Test Suite
echo "[INFO] Executing multi-instance concurrency acceptance test suite..."
TEST_DATABASE_URL="${PG_URL}" cargo test -p control_plane_api --test multi_instance_concurrency_test -- --nocapture

echo "======================================================================"
echo "[SUCCESS] Multi-instance PostgreSQL idempotency verified successfully."
echo "Zero double-submissions, single-winner CAS invariant proven across nodes."
echo "======================================================================"
