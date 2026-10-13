#!/usr/bin/env bash
set -e

echo "=================================================================="
echo " VARDHAN TECHNOLOGIES :: PHASE 1 CISO SPLIT-SCREEN DEMO RUNNER"
echo "=================================================================="

# Build workspace in release mode
echo "[1/4] Compiling workspace binaries..."
cargo build --release --workspace

# Background trigger for quantum_tui and pq_shield
echo "[2/4] Initializing Zero-Touch Ingress Interceptor on Port 8080..."
# Spin up background benchmark/interceptor
cargo bench -p pq_shield --bench ingress_throughput &
SHIELD_PID=$!

sleep 2

echo "[3/4] Transmitting Unprotected Plaintext Payload via CURL..."
curl -s -X POST http://127.0.0.1:8080/v1/settlement \
     -H "Content-Type: application/json" \
     -d '{"account_clearing_id":"VGI-CH-8801","transfer_val":"1500000_GBP"}' || true

echo ""
echo "[4/4] Demo Execution Complete. Launching CCC Dashboard..."
echo "To present to enterprise CISOs, run:"
echo "   cargo run --release -p quantum_tui"

kill $SHIELD_PID 2>/dev/null || true
