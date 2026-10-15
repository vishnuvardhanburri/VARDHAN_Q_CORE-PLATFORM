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
echo "  VARDHAN Q-CORE — Synthetic Financial-Services PoV"
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

# Record host/container configuration so latency and throughput can be interpreted.
ENVIRONMENT_FILE="${RESULTS_DIR}/environment_${TIMESTAMP}.txt"
STATS_FILE="${RESULTS_DIR}/docker_stats_${TIMESTAMP}.csv"
{
    echo "Captured UTC: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    echo "Source Git HEAD: $(git -C "$REPO_ROOT" rev-parse HEAD 2>&1 || echo unknown)"
    echo "Working tree status:"
    git -C "$REPO_ROOT" status --short 2>&1 || true
    echo "PoV scripts checksums:"
    sha256sum "$POV_DIR/run.sh" "$POV_DIR/security_test.py" "$POV_DIR/perf_bench.py" "$POV_DIR/crypto_bench.py" 2>&1 || shasum -a 256 "$POV_DIR/run.sh" "$POV_DIR/security_test.py" "$POV_DIR/perf_bench.py" "$POV_DIR/crypto_bench.py" 2>&1 || true
    echo "--- Docker image ---"
    docker image inspect --format='ID={{.Id}} OS={{.Os}} Architecture={{.Architecture}}' vardhan-qcore-pov:latest 2>&1 || true
    echo "--- Host OS ---"
    uname -a
    echo "Docker version: $(docker --version 2>&1 || true)"
    echo "--- Docker daemon resources ---"
    docker info --format='ServerOS={{.OSType}} ServerArch={{.Architecture}} CPUs={{.NCPU}} MemoryBytes={{.MemTotal}}' 2>&1 || true
    echo "--- Container resource limits ---"
    docker inspect --format='Image={{.Config.Image}} MemoryLimitBytes={{.HostConfig.Memory}} NanoCPUs={{.HostConfig.NanoCpus}} CpuQuota={{.HostConfig.CpuQuota}} CpuPeriod={{.HostConfig.CpuPeriod}}' qcore-pov 2>&1 || true
    echo "--- Host CPU and memory ---"
    if command -v sysctl >/dev/null 2>&1; then
        echo "CPU model: $(sysctl -n machdep.cpu.brand_string 2>/dev/null || echo unknown)"
        echo "CPU count: $(sysctl -n hw.ncpu 2>/dev/null || echo unknown)"
        echo "RAM bytes: $(sysctl -n hw.memsize 2>/dev/null || echo unknown)"
    elif [ -r /proc/cpuinfo ]; then
        grep -m1 'model name' /proc/cpuinfo || true
        echo "CPU count: $(getconf _NPROCESSORS_ONLN 2>/dev/null || echo unknown)"
        grep '^MemTotal:' /proc/meminfo || true
    fi
} > "$ENVIRONMENT_FILE" 2>&1
echo "Environment metadata: $ENVIRONMENT_FILE"

echo "timestamp_utc,cpu_percent,memory_usage,memory_percent,network_io,block_io,pids" > "$STATS_FILE"
(
    while [ "$(docker inspect -f '{{.State.Running}}' qcore-pov 2>/dev/null || echo false)" = "true" ]; do
        TS=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
        METRICS=$(docker stats --no-stream --format '{{.CPUPerc}},{{.MemUsage}},{{.MemPerc}},{{.NetIO}},{{.BlockIO}},{{.PIDs}}' qcore-pov 2>/dev/null || true)
        if [ -n "$METRICS" ]; then
            printf '%s,%s\n' "$TS" "$METRICS" >> "$STATS_FILE"
        fi
        sleep 1
    done
) &
STATS_PID=$!

if docker exec qcore-pov bash -c 'python3 /usr/local/bin/security_test.py' 2>&1 | tee "${RESULTS_DIR}/security_test_${TIMESTAMP}.log"; then
    echo "✅ Security test process exited successfully"
else
    echo "❌ Security test process failed"
    TEST_FAILURES=$((TEST_FAILURES + 1))
fi
if docker cp qcore-pov:/tmp/security_results.json "${RESULTS_DIR}/security_results_${TIMESTAMP}.json" 2>/dev/null && [ -s "${RESULTS_DIR}/security_results_${TIMESTAMP}.json" ]; then
    echo "✅ Security results artifact saved"
else
    echo "❌ Security results artifact missing"
    echo '{"error": "no security results"}' > "${RESULTS_DIR}/security_results_${TIMESTAMP}.json"
    TEST_FAILURES=$((TEST_FAILURES + 1))
fi

# ── Step 4: Run performance benchmarks ──────────────────────────
echo ""
echo "[4/7] Running performance benchmarks..."
if docker exec qcore-pov bash -c 'python3 /usr/local/bin/perf_bench.py' 2>&1 | tee "${RESULTS_DIR}/perf_${TIMESTAMP}.log"; then
    echo "✅ Performance benchmark process exited successfully"
else
    echo "❌ Performance benchmark process failed"
    TEST_FAILURES=$((TEST_FAILURES + 1))
fi
if docker cp qcore-pov:/tmp/perf_results.json "${RESULTS_DIR}/perf_results_${TIMESTAMP}.json" 2>/dev/null && [ -s "${RESULTS_DIR}/perf_results_${TIMESTAMP}.json" ]; then
    echo "✅ Performance results artifact saved"
else
    echo "❌ Performance results artifact missing"
    TEST_FAILURES=$((TEST_FAILURES + 1))
fi

# ── Step 5: Run crypto benchmarks ───────────────────────────────
echo ""
echo "[5/7] Running crypto benchmarks..."
if docker exec qcore-pov bash -c 'python3 /usr/local/bin/crypto_bench.py' 2>&1 | tee "${RESULTS_DIR}/crypto_${TIMESTAMP}.log"; then
    echo "✅ Cryptographic benchmark process exited successfully"
else
    echo "❌ Cryptographic benchmark process failed"
    TEST_FAILURES=$((TEST_FAILURES + 1))
fi
if docker cp qcore-pov:/tmp/crypto_results.json "${RESULTS_DIR}/crypto_results_${TIMESTAMP}.json" 2>/dev/null && [ -s "${RESULTS_DIR}/crypto_results_${TIMESTAMP}.json" ]; then
    echo "✅ Cryptographic results artifact saved"
else
    echo "❌ Cryptographic results artifact missing"
    TEST_FAILURES=$((TEST_FAILURES + 1))
fi

# ── Step 6: Collect logs ────────────────────────────────────────
echo ""
echo "[6/7] Collecting container logs and state..."
docker logs qcore-pov > "${RESULTS_DIR}/container_${TIMESTAMP}.log" 2>&1 || true

# Stop resource sampling after all test suites have finished.
kill "$STATS_PID" 2>/dev/null || true
wait "$STATS_PID" 2>/dev/null || true
echo "Docker stats time series: $STATS_FILE"

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
