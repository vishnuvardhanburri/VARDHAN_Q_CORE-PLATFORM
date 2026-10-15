#!/bin/bash
# ===================================================================
# VARDHAN Q-CORE — Performance Benchmark Suite (runs inside Docker)
# ===================================================================
set -euo pipefail

HOST="http://localhost:8080"
RESULTS_FILE="${1:-/tmp/perf_results.json}"
ADMIN_USER="admin"
ADMIN_PASS="P0V-Str0ng-P@sspw0rd-2025!"

echo "=== Performance Benchmark ==="

# Login
RESP=$(curl -sf -X POST "${HOST}/api/v1/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"${ADMIN_USER}\",\"password\":\"${ADMIN_PASS}}" 2>/dev/null)
TOKEN=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null || echo "")

# Create org
RESP=$(curl -sf -X POST "${HOST}/api/v1/organizations" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${TOKEN}" \
    -d '{"name":"Perf Test Tenant"}' 2>/dev/null)
ORG_ID=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('organization',{}).get('id',''))" 2>/dev/null || echo "")

# Build contracts of different sizes
CONTRACT_1KB=$(python3 -c "
import json
contract = {
    'contract': {
        'schema_version': '1.1',
        'finding_id': 'find-perf-{seq}',
        'intelligence': {'engine_id': 'e', 'engine_version': '1', 'run_id': 'r'},
        'organization': {'organization_id': 'org-vardhan-intelligence', 'canonical_domain': 'perf.vardhan.org'},
        'affected_resource': {'canonical_url': 'https://api.vardhan.org', 'surface_type': 'API_REST', 'entry_point_id': 'ep'},
        'technical_area': 'STATIC_ANALYSIS',
        'technical_mechanism': 'SQLi',
        'expected_behavior': 'safe',
        'observed_behavior': 'vuln',
        'differential_state': 'CONFIRMED_MISMATCH',
        'materiality': 'HIGH',
        'evidence_refs': [{'evidence_id': 'ev', 'public_url': 'https://e', 'temporal_status': 'CURRENT', 'is_context_artifact': False, 'evidence_origin': 'scan', 'content_hash': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'}],
        'provenance_chain': {'expectation_id': 'e1', 'observation_ids': ['o1'], 'differential_id': 'd1', 'hypothesis_id': 'h1', 'verification_contract_id': 'v1'},
        'contradictory_evidence_ids': [],
        'uncertainty': [],
        'benign_explanation': '',
        'authorization_context': {'requires_authorized_assessment': False},
        'decision_candidate': 'SEAL_VERIFIED_FINDING',
        'policy_reference': 'VARDHAN_CORE_INTELLIGENCE_POLICY_V1',
        'created_at': '2026-10-13T10:00:00Z',
        'evidence_earliest_retrieved_at': '2026-10-13T09:00:00Z',
        'evidence_latest_retrieved_at': '2026-10-13T09:30:00Z'
    },
    'actor_workload_id': 'svc:vardhan-intelligence:perf-{seq}'
}
# Pad to ~1KB
padding = 'x' * 500
contract['contract']['benign_explanation'] = padding
print(json.dumps(contract))
")

CONTRACT_10KB=$(echo "$CONTRACT_1KB" | python3 -c "
import sys, json
c = json.load(sys.stdin)
c['contract']['finding_id'] = f"find-perf-10k-{{seq}}"
c['contract']['benign_explanation'] = 'x' * 5000
print(json.dumps(c))
")

CONTRACT_100KB=$(echo "$CONTRACT_1KB" | python3 -c "
import sys, json
c = json.load(sys.stdin)
c['contract']['finding_id'] = f"find-perf-100k-{{seq}}"
c['contract']['benign_explanation'] = 'x' * 50000
print(json.dumps(c))
")

# Benchmark function using Python for timing
run_bench() {
    local label="$1" concurrency="$2" payload="$3" find_prefix="$4"
    python3 -c "
import json, time, statistics, concurrent.futures, urllib.request, sys

TOKEN = '$TOKEN'
HOST = '$HOST'
ORG_ID = '$ORG_ID'
CONTRACT_TEMPLATE = '''$5'''
CONCURRENCY = int('$concurrency')
WARMUP = 3
TEST_REQUESTS = 50

def make_request(seq):
    contract = json.loads(CONTRACT_TEMPLATE)
    contract['contract']['finding_id'] = f'find-perf-{seq}'
    contract['actor_workload_id'] = f'svc:vardhan-intelligence:perf-{seq}'
    
    req = urllib.request.Request(
        f'{HOST}/api/v1/organizations/{ORG_ID}/security/validate',
        data=json.dumps(contract).encode(),
        headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {TOKEN}'},
        method='POST'
    )
    start = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = json.loads(resp.read().decode())
            elapsed = (time.monotonic() - start) * 1000
            return (elapsed, body.get('status', 'UNKNOWN'))
    except Exception as e:
        elapsed = (time.monotonic() - start) * 1000
        return (elapsed, f'ERROR: {str(e)[:100]}')

# Warmup
for i in range(WARMUP):
    make_request(f'warmup-{i}')

# Actual test
latencies = []
statuses = []
with concurrent.futures.ThreadPoolExecutor(max_workers=CONCURRENCY) as executor:
    futures = [executor.submit(make_request, f'req-{i}') for i in range(TEST_REQUESTS)]
    for f in concurrent.futures.as_completed(futures):
        lat, status = f.result()
        latencies.append(lat)
        statuses.append(status)

success = sum(1 for s in statuses if s == 'SEALED')
replay = sum(1 for s in statuses if s == 'REJECTED_REPLAY')

result = {
    'label': '$label',
    'concurrency': CONCURRENCY,
    'payload_size_bytes': len(json.dumps(json.loads(CONTRACT_TEMPLATE))),
    'requests': TEST_REQUESTS,
    'success': success,
    'replay': replay,
    'errors': TEST_REQUESTS - success - replay,
    'latency_min_ms': round(min(latencies), 3),
    'latency_max_ms': round(max(latencies), 3),
    'latency_mean_ms': round(statistics.mean(latencies), 3),
    'latency_p50_ms': round(statistics.median(latencies), 3),
    'latency_p95_ms': round(latencies[int(len(latencies)*0.95)] if len(latencies) > 1 else latencies[0], 3),
    'latency_p99_ms': round(latencies[min(int(len(latencies)*0.99), len(latencies)-1)], 3),
}
print(json.dumps(result))
" 5 "$CONTRACT_1KB" "$CONTRACT_10KB" "$CONTRACT_100KB" 2>/dev/null || echo '{"error": "benchmark failed"}' | python3 -m json.tool 2>/dev/null || echo '{"error": "benchmark failed"}'
}

# Run benchmark matrix
echo "Running performance benchmarks..."
RESULTS="["
FIRST=1

for size_name in "1KB" "10KB" "100KB"; do
    for concurrency in 1 10 50 100; do
        if [ "$FIRST" = "1" ]; then FIRST=0; else RESULTS+=","; fi
        if [ "$size_name" = "1KB" ]; then CONTRACT="$CONTRACT_1KB"; fi
        if [ "$size_name" = "10KB" ]; then CONTRACT="$CONTRACT_10KB"; else CONTRACT="$CONTRACT_100KB"; fi
        if [ "$size_name" = "100KB" ]; then CONTRACT="$CONTRACT_100KB"; fi
        echo "  Benchmarking ${size_name} payload, concurrency=${concurrency}..."
        RESULT=$(run_bench "contract_seal" "$concurrency" "$size_name" "perf" "$CONTRACT")
        echo "  Result: $RESULT"
        RESULTS+="$RESULT"
    done
done

# Baseline: direct subprocess call (no HTTP API overhead)
echo "  Measuring baseline (direct subprocess call)..."
BASELINE_RESULT=$(python3 -c "
import json, time, statistics, subprocess, os

RECEIPT_BIN = '/usr/local/bin/vardhan-receipt'
ENVS = os.environ.copy()
ENVS['VARDHAN_ENV'] = 'development'

contract = {
    'contract': {
        'schema_version': '1.1',
        'finding_id': 'find-baseline',
        'intelligence': {'engine_id': 'e', 'engine_version': '1', 'run_id': 'r'},
        'organization': {'organization_id': 'org-vardhan-intelligence', 'canonical_domain': 'perf.vardhan.org'},
        'affected_resource': {'canonical_url': 'https://api.vardhan.org', 'surface_type': 'API_REST', 'entry_point_id': 'ep'},
        'technical_area': 'STATIC_ANALYSIS',
        'technical_mechanism': 'SQLi',
        'expected_behavior': 'safe', 'observed_behavior': 'vuln',
        'differential_state': 'CONFIRMED_MISMATCH', 'materiality': 'HIGH',
        'evidence_refs': [{'evidence_id': 'ev', 'public_url': 'https://e', 'temporal_status': 'CURRENT', 'is_context_artifact': False, 'evidence_origin': 'scan', 'content_hash': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'}],
        'provenance_chain': {'expectation_id': 'e1', 'observation_ids': ['o1'], 'differential_id': 'd1', 'hypothesis_id': 'h1', 'verification_contract_id': 'v1'},
        'contradictory_evidence_ids': [], 'uncertainty': [], 'benign_explanation': '',
        'authorization_context': {'requires_authorized_assessment': False},
        'decision_candidate': 'SEAL_VERIFIED_FINDING',
        'policy_reference': 'VARDHAN_CORE_INTELLIGENCE_POLICY_V1',
        'created_at': '2026-10-13T10:00:00Z',
        'evidence_earliest_retrieved_at': '2026-10-13T09:00:00Z',
        'evidence_latest_retrieved_at': '2026-10-13T09:30:00Z'
    },
    'actor_workload_id': 'svc:vardhan-intelligence:baseline'
}

payload = json.dumps(contract)
WARMUP = 3
TEST_REQUESTS = 50

def run_once():
    start = time.monotonic()
    proc = subprocess.run([RECEIPT_BIN, 'validate-canonical'], input=payload.encode(), capture_output=True, text=True, env=ENVS, timeout=30)
    elapsed = (time.monotonic() - start) * 1000
    return elapsed

for i in range(WARMUP):
    run_once()

latencies = [run_once() for _ in range(TEST_REQUESTS)]
result = {
    'label': 'baseline_direct',
    'requests': TEST_REQUESTS,
    'latency_min_ms': round(min(latencies), 3),
    'latency_max_ms': round(max(latencies), 3),
    'latency_mean_ms': round(statistics.mean(latencies), 3),
    'latency_p50_ms': round(statistics.median(latencies), 3),
    'latency_p95_ms': round(latencies[int(len(latencies)*0.95)] if len(latencies) > 1 else latencies[0], 3),
    'latency_p99_ms': round(latencies[min(int(len(latencies)*0.99), len(latencies)-1)], 3),
}
print(json.dumps(result))
" 2>/dev/null || echo '{"error": "baseline failed"}')
echo "  Baseline result: $BASELINE_RESULT"
RESULTS+=",$BASELINE_RESULT"

RESULTS+="]"
echo "$RESULTS" | python3 -m json.tool > "$RESULTS_FILE" 2>/dev/null || echo "$RESULTS" > "$RESULTS_FILE"
echo ""
echo "Performance results written to $RESULTS_FILE"
cat "$RESULTS_FILE" | python3 -m json.tool 2>/dev/null | head -60
