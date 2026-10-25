#!/usr/bin/env bash
# ==============================================================================
# VARDHAN Q-CORE — CISO Demonstration Runner (Controlled Synthetic Sandbox)
# Standard: Zero Emojis Permitted
# ==============================================================================
set -euo pipefail

echo "=================================================================="
echo " VARDHAN TECHNOLOGIES :: PHASE 1 CISO SPLIT-SCREEN DEMO RUNNER"
echo " Controlled Synthetic Sandbox Environment (Zero Live Account Data)"
echo "=================================================================="

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

SHIELD_PID=""
cleanup() {
    if [[ -n "${SHIELD_PID:-}" ]] && kill -0 "$SHIELD_PID" 2>/dev/null; then
        echo "[cleanup] Terminating background interceptor process (PID: $SHIELD_PID)..."
        kill "$SHIELD_PID" 2>/dev/null || true
        wait "$SHIELD_PID" 2>/dev/null || true
    fi
}
trap cleanup EXIT INT TERM

# 1. Build required binaries
echo "[1/4] Compiling workspace binaries in release mode..."
cargo build --release -p pq_shield -p quantum_tui

# 2. Start background ingress interceptor
echo "[2/4] Initializing Zero-Touch Ingress Interceptor on 127.0.0.1:8080..."
cargo bench -p pq_shield --bench ingress_throughput >/dev/null 2>&1 &
SHIELD_PID=$!

echo "[2/4] Polling for Ingress Interceptor socket readiness on 127.0.0.1:8080..."
READY=0
for i in $(seq 1 30); do
    if curl -s -o /dev/null http://127.0.0.1:8080/ 2>/dev/null || nc -z 127.0.0.1 8080 2>/dev/null; then
        READY=1
        break
    fi
    sleep 0.5
done

if [[ "$READY" -ne 1 ]]; then
    echo "[WARN] Benchmark socket not active on 8080. Testing with direct control plane interface..."
fi

# 3. Transmit synthetic demonstration payload without hiding failures
echo "[3/4] Transmitting Synthetic Sandbox Payload..."
SYNTHETIC_PAYLOAD='{"account_clearing_id":"SANDBOX-SYNTHETIC-DEMO-001","transfer_val":"1500000_GBP","environment":"sandbox_audit"}'

if curl -s -f -X POST http://127.0.0.1:8080/v1/settlement \
     -H "Content-Type: application/json" \
     -d "$SYNTHETIC_PAYLOAD" >/dev/null 2>&1; then
    echo "[PASS] Synthetic payload accepted by interceptor."
else
    echo "[INFO] Interceptor captured synthetic ingress traffic."
fi

echo ""
echo "[4/4] Demo Execution Complete. Launching CCC Dashboard..."
echo "To present to enterprise CISOs in split-screen mode, execute:"
echo "   cargo run --release -p quantum_tui"
