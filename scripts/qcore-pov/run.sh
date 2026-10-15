#!/bin/bash
set -euo pipefail

# ===================================================================
# VARDHAN Q-CORE — One-Command PoV Runner
# ===================================================================
# Usage: ./scripts/qcore-pov/run.sh
#
# This script:
#   1. Builds the Docker image
#   2. Starts the control plane in a container
#   3. Waits for health check
#   4. Runs security tests
#   5. Runs performance benchmarks
#   6. Runs crypto benchmarks
#   7. Saves all results to scripts/qcore-pov/results/
#   8. Cleans up the container
# ===================================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
POV_DIR="${SCRIPT_DIR}"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
RESULTS_DIR="${POV_DIR}/results"
mkdir -p "$RESULTS_DIR"

echo "============================================================"
echo "  VARDHAN Q-CORE — LGT Financial-Services PoV"
echo "  Started: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "============================================================"

# ── Step 1: Build Docker image ────────────────────────────────────
echo ""
echo "[1/7] Building Docker image (multi-stage Rust build)..."
docker build -f "${POV_DIR}/docker/Dockerfile.pov" \
    -t vardhan-qcore-pov:latest \
    "${REPO_ROOT}" 2>&1 | tail -10
echo "✅ Docker image built"

# ── Step 2: Start control plane container ────────────────────────
echo ""
echo "[2/7] Starting control plane container..."
docker rm -f qcore-pov 2>/dev/null || true
docker run -d \
    --name qcore-pov \
    -p 8080:8080 \
    -e VARDHAN_ENV=development \
    -e VARDHAN_CONTROL_PLANE_ADDR=0.0.0.0:8080 \
    -e VARDHAN_CONTROL_PLANE_DATA_DIR=/var/lib/vardhan/control-plane \
    -e VARDHAN_KEYSTORE_DIR=/var/lib/vardhan/keystore \
    -e VARDHAN_IDEMPOTENCY_DIR=/var/lib/vardhan/idempotency \
    -e VARDHAN_NODE_ID=pov-validation-node \
    -e VARDHAN_ADMIN_USERNAME=admin \
    -e QCORE_HOST=http://localhost:8080 \
    -v "${RESULTS_DIR}:/app/results" \
    -v "${POV_DIR}/secrets:/run/secrets:ro" \
    vardhan-qcore-pov:latest

# Wait for health
echo "Waiting for health check..."
HEALTHY=false
for i in $(seq 1 45); do
    if curl -sf http://localhost:8080/api/v1/platform/health 2>/dev/null | grep -q "operational"; then
        echo "✅ Control plane healthy (after ${i}s)"
        HEALTHY=true
        break
    fi
    sleep 1
done

if [ "$HEALTHY" != "true" ]; then
    echo "❌ Control plane failed to start"
    echo "--- Container logs ---"
    docker logs qcore-pov 2>&1 | tail -40
    docker rm -f qcore-pov 2>/dev/null || true
    exit 1
fi

# ── Step 3: Run security tests ────────────────────────────────────
echo ""
echo "[3/7] Running security test matrix..."
TIMESTAMP=$(date -u +%Y%m%d_%H%M%S)
TEST_FAILURES=0
if docker exec qcore-pov bash -c 'python3 /usr/local/bin/security_test.py' 2>&1 | tee "${RESULTS_DIR}/security_test_${TIMESTAMP}.log"; then
    echo "✅ Security test process exited successfully"
else
    echo "❌ Security test process failed"
    TEST_FAILURES=$((TEST_FAILURES + 1))
fi
docker cp qcore-pov:/tmp/security_results.json "${RESULTS_DIR}/security_results_${TIMESTAMP}.json" 2>/dev/null || echo '{"error": "no security results"}' > "${RESULTS_DIR}/security_results_${TIMESTAMP}.json"

# ── Step 4: Run performance benchmarks ──────────────────────────
echo ""
echo "[4/7] Running performance benchmarks..."
if docker exec qcore-pov bash -c 'python3 /usr/local/bin/perf_bench.py' 2>&1 | tee "${RESULTS_DIR}/perf_${TIMESTAMP}.log"; then
    echo "✅ Performance benchmark process exited successfully"
else
    echo "❌ Performance benchmark process failed"
    TEST_FAILURES=$((TEST_FAILURES + 1))
fi
docker cp qcore-pov:/tmp/perf_results.json "${RESULTS_DIR}/perf_results_${TIMESTAMP}.json" 2>/dev/null || true

# ── Step 5: Run crypto benchmarks ───────────────────────────────
echo ""
echo "[5/7] Running crypto benchmarks..."
if docker exec qcore-pov bash -c 'python3 /usr/local/bin/crypto_bench.py' 2>&1 | tee "${RESULTS_DIR}/crypto_${TIMESTAMP}.log"; then
    echo "✅ Cryptographic benchmark process exited successfully"
else
    echo "❌ Cryptographic benchmark process failed"
    TEST_FAILURES=$((TEST_FAILURES + 1))
fi
docker cp qcore-pov:/tmp/crypto_results.json "${RESULTS_DIR}/crypto_results_${TIMESTAMP}.json" 2>/dev/null || true

# ── Step 6: Collect logs ────────────────────────────────────────
echo ""
echo "[6/7] Collecting container logs and state..."
docker logs qcore-pov > "${RESULTS_DIR}/container_${TIMESTAMP}.log" 2>&1 || true

# ── Step 7: Cleanup ─────────────────────────────────────────────
echo ""
echo "[7/7] Stopping and removing container..."
docker stop qcore-pov 2>/dev/null || true
docker rm qcore-pov 2>/dev/null || true

echo ""
echo "============================================================"
echo "  PoV Complete"
echo "  Results directory: ${RESULTS_DIR}/"
echo "  Ended: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "============================================================"

if [ "$TEST_FAILURES" -gt 0 ]; then
    echo "❌ PoV run finished with $TEST_FAILURES failed test/benchmark process(es)"
    exit 1
fi

echo "✅ All PoV test/benchmark processes exited successfully"
