#!/usr/bin/env python3
"""
VARDHAN Q-CORE — Performance Benchmark Suite (PoV)

Measures latency and throughput for the financial-services workflow:
  - Contract sealing (Q-Core validation + cryptographic signing)
  - Receipt verification
  - Replay rejection
  - Login latency
  - Audit retrieval
  - Full E2E workflow
  - Baseline (direct subprocess, no HTTP overhead)

Tokens rotate one-time-use per Phase 8a. Each worker thread gets its own
session and token chain to avoid replay-revocation conflicts.

Usage:
    python3 /usr/local/bin/perf_bench.py
"""
import json
import os
import sys
import time
import subprocess
import statistics
import concurrent.futures
import threading
import urllib.request
import urllib.error

HOST = os.environ.get("QCORE_HOST", "http://localhost:8080")
ADMIN_USER = os.environ.get("ADMIN_USER", "admin")
ADMIN_PASS = os.environ.get("ADMIN_PASS", "P0V-Str0ng-P@ssw0rd-2025!")

# Unique run ID to prevent finding_id collisions across benchmark runs
RUN_ID = f"pov{os.getpid()}"

RECEIPT_BIN = os.environ.get("VARDHAN_RECEIPT_ENGINE_BIN", "/usr/local/bin/vardhan-receipt")

CONCURRENCY_LEVELS = [1, 10, 50, 100]
WARMUP_REQUESTS = 3
TEST_REQUESTS = 50
TEST_E2E_REQUESTS = 20

# Global counter for globally unique finding_ids across all benchmark groups
global_counter = 0
counter_lock = threading.Lock()

def next_finding_id(prefix="find"):
    """Generate a globally unique finding_id for this run."""
    with counter_lock:
        global global_counter
        global_counter += 1
        return f"{prefix}-{RUN_ID}-{global_counter}"

def api_request(method, path, token=None, body=None):
    """Make an API request, returning (status_code, response_json, new_token)."""
    url = f"{HOST}{path}"
    data = json.dumps(body).encode() if body else None
    headers = {}
    if data:
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            resp_body = resp.read().decode()
            new_token = resp.headers.get("Authorization-New-Token")
            if new_token and new_token.startswith("Bearer "):
                new_token = new_token[7:]
            else:
                new_token = token
            try:
                return resp.status, json.loads(resp_body), new_token
            except:
                return resp.status, {}, new_token
    except urllib.error.HTTPError as e:
        resp_body = e.read().decode()
        new_token = e.headers.get("Authorization-New-Token")
        if new_token and new_token.startswith("Bearer "):
            new_token = new_token[7:]
        else:
            new_token = token
        try:
            return e.code, json.loads(resp_body), new_token
        except:
            return e.code, {"error": resp_body}, new_token
    except Exception as e:
        return 0, {"error": str(e)}, token

def build_contract(finding_id, payload_size=1024, actor="svc:vardhan-intelligence:perf-bench"):
    """Build a Q-Core contract with configurable payload size."""
    padding = "x" * max(0, payload_size - 800)
    contract = {
        "contract": {
            "schema_version": "1.1",
            "finding_id": finding_id,
            "intelligence": {"engine_id": "perf-bench", "engine_version": "1.0.0", "run_id": "run-bench-001"},
            "organization": {"organization_id": "org-vardhan-intelligence", "canonical_domain": "perf.vardhan.org"},
            "affected_resource": {"canonical_url": "https://api.vardhan.org", "surface_type": "API_REST", "entry_point_id": "ep-bench-1"},
            "technical_area": "STATIC_ANALYSIS",
            "technical_mechanism": "SQLi",
            "expected_behavior": "safe",
            "observed_behavior": "vulnerable",
            "differential_state": "CONFIRMED_MISMATCH",
            "materiality": "HIGH",
            "evidence_refs": [{"evidence_id": "ev-bench-1", "public_url": "https://ev.bench.org", "temporal_status": "CURRENT", "is_context_artifact": False, "evidence_origin": "scan", "content_hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}],
            "provenance_chain": {"expectation_id": "e1", "observation_ids": ["o1"], "differential_id": "d1", "hypothesis_id": "h1", "verification_contract_id": "v1"},
            "contradictory_evidence_ids": [],
            "uncertainty": [],
            "benign_explanation": padding,
            "authorization_context": {"requires_authorized_assessment": False},
            "decision_candidate": "SEAL_VERIFIED_FINDING",
            "policy_reference": "VARDHAN_CORE_INTELLIGENCE_POLICY_V1",
            "created_at": "2026-10-13T10:00:00Z",
            "evidence_earliest_retrieved_at": "2026-10-13T09:00:00Z",
            "evidence_latest_retrieved_at": "2026-10-13T09:30:00Z"
        },
        "actor_workload_id": actor
    }
    return contract

def create_session(worker_id=None):
    """Create a fresh login session and org. Returns (token, org_id) or (None, None)."""
    s, b, _ = api_request("POST", "/api/v1/auth/login",
                          body={"username": ADMIN_USER, "password": ADMIN_PASS})
    if s != 200:
        return None, None
    token = b.get("token", "")
    name = f"Bench-{int(time.time())}-{worker_id}" if worker_id is not None else f"Bench-{int(time.time())}"
    s2, b2, token = api_request("POST", "/api/v1/organizations", token, {"name": name})
    if s2 not in (200, 201):
        return None, None
    org_id = b2.get("organization", {}).get("id", "")
    return token, org_id

def benchmark_with_sessions(label, func, concurrency, requests, warmup):
    """
    Run a benchmark where each worker thread gets its own login session.
    Each thread processes its share of requests sequentially, with proper
    token rotation within its own session.
    """
    # Create one session per worker thread
    sessions = {}
    for i in range(concurrency):
        token, org_id = create_session(worker_id=i)
        if token is None:
            print(f"  Error: failed to create session for worker {i}")
            return None
        sessions[i] = {"token": token, "org_id": org_id}
    
    latencies = []
    successes = 0
    errors = 0
    results_lock = threading.Lock()
    
    def worker(worker_idx):
        """Each worker processes a batch of requests using its own session."""
        nonlocal successes, errors
        my_results = []
        session = sessions[worker_idx]
        token = session["token"]
        org_id = session["org_id"]
        
        # Distribute requests: worker 0 gets 0, c, 2c, ...; worker 1 gets 1, c+1, ...
        my_indices = list(range(worker_idx, requests, concurrency))
        
        # Warmup (only for first batch)
        if worker_idx == 0:
            for i in range(warmup):
                c = build_contract(finding_id=next_finding_id("warmup"))
                s, b, token = api_request("POST", f"/api/v1/organizations/{org_id}/security/validate", token, c)
                if token:
                    session["token"] = token
            # Relogin after warmup
            token, org_id = create_session(worker_id=worker_idx)
            session["token"] = token
            session["org_id"] = org_id
        
        for idx in my_indices:
            start = time.monotonic()
            try:
                new_token, ok = func(idx, token, org_id)
                elapsed = (time.monotonic() - start) * 1000
                if new_token:
                    token = new_token
                my_results.append((elapsed, ok))
            except Exception:
                elapsed = (time.monotonic() - start) * 1000
                my_results.append((elapsed, False))
        
        with results_lock:
            latencies.extend(r[0] for r in my_results)
            successes += sum(1 for r in my_results if r[1])
            errors += sum(1 for r in my_results if not r[1])
    
    threads = []
    for i in range(concurrency):
        t = threading.Thread(target=worker, args=(i,))
        threads.append(t)
        t.start()
    
    for t in threads:
        t.join()
    
    latencies.sort()
    n = len(latencies)
    
    return {
        "label": label,
        "concurrency": concurrency,
        "requests": requests,
        "warmup": warmup,
        "successes": successes,
        "errors": errors,
        "latency_min_ms": round(min(latencies), 3) if latencies else 0,
        "latency_max_ms": round(max(latencies), 3) if latencies else 0,
        "latency_mean_ms": round(statistics.mean(latencies), 3) if latencies else 0,
        "latency_p50_ms": round(statistics.median(latencies), 3) if latencies else 0,
        "latency_p95_ms": round(latencies[int(n * 0.95)] if n > 1 else latencies[0], 3) if latencies else 0,
        "latency_p99_ms": round(latencies[min(int(n * 0.99), n-1)], 3) if latencies else 0,
    }

def make_contract_request(idx, token, org_id, payload_size=1024):
    """Submit a contract and return (new_token, success_bool)."""
    contract = build_contract(finding_id=next_finding_id("find-perf"), payload_size=payload_size)
    s, b, new_token = api_request("POST", f"/api/v1/organizations/{org_id}/security/validate",
                                token, contract)
    return new_token, b.get("status") == "SEALED"

def make_audit_request(idx, token, org_id):
    """Retrieve audit trail."""
    s, b, new_token = api_request("GET", f"/api/v1/organizations/{org_id}/security/audit", token)
    return new_token, s == 200

def make_e2e_request(idx, token, org_id):
    """Full E2E: submit contract and verify receipt independently."""
    contract = build_contract(finding_id=next_finding_id("find-e2e"))
    s, b, new_token = api_request("POST", f"/api/v1/organizations/{org_id}/security/validate",
                                token, contract)
    if s != 200 or b.get("status") != "SEALED":
        return new_token, False
    
    # Independent verification via vardhan-receipt binary
    env = os.environ.copy()
    env["VARDHAN_ENV"] = "development"
    try:
        proc = subprocess.run(
            [RECEIPT_BIN, "verify", "--receipt-id", f"e2e-verify-{RUN_ID}-{idx}"],
            input=json.dumps(b), capture_output=True, text=True, env=env, timeout=30
        )
        return new_token, "Valid" in proc.stdout
    except:
        return new_token, False

def run_concurrent_raw(label, func, concurrency, requests, warmup):
    """Run a benchmark where func takes no session args (e.g. login, verify)."""
    # Warmup
    for i in range(warmup):
        try:
            func(i)
        except:
            pass
    
    latencies = []
    successes = 0
    errors = 0
    
    def run_one(idx):
        start = time.monotonic()
        try:
            ok = func(idx)
        except:
            ok = False
        elapsed = (time.monotonic() - start) * 1000
        return (elapsed, ok)
    
    with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as executor:
        futures = [executor.submit(run_one, i) for i in range(requests)]
        for f in concurrent.futures.as_completed(futures):
            lat, ok = f.result()
            latencies.append(lat)
            if ok:
                successes += 1
            else:
                errors += 1
    
    latencies.sort()
    n = len(latencies)
    
    return {
        "label": label,
        "concurrency": concurrency,
        "requests": requests,
        "warmup": warmup,
        "successes": successes,
        "errors": errors,
        "latency_min_ms": round(min(latencies), 3) if latencies else 0,
        "latency_max_ms": round(max(latencies), 3) if latencies else 0,
        "latency_mean_ms": round(statistics.mean(latencies), 3) if latencies else 0,
        "latency_p50_ms": round(statistics.median(latencies), 3) if latencies else 0,
        "latency_p95_ms": round(latencies[int(n * 0.95)] if n > 1 else latencies[0], 3) if latencies else 0,
        "latency_p99_ms": round(latencies[min(int(n * 0.99), n-1)], 3) if latencies else 0,
    }

def main():
    print("=" * 70)
    print("  VARDHAN Q-CORE — Performance Benchmark Suite (PoV)")
    print("=" * 70)
    
    all_results = []
    
    # ── P1: Contract Sealing (Protected Path) ─────────────────────
    print("\n--- P1: Contract Sealing (Protected HTTP API Path) ---")
    for payload_name, payload_bytes in [("1KB", 1024), ("10KB", 10240), ("100KB", 102400)]:
        for c in CONCURRENCY_LEVELS:
            print(f"  {payload_name} payload, concurrency={c}...")
            result = benchmark_with_sessions(
                f"contract_seal_{payload_name}_c{c}",
                lambda idx, tok, oid, pb=payload_bytes: make_contract_request(idx, tok, oid, pb),
                c, TEST_REQUESTS, WARMUP_REQUESTS
            )
            if result:
                print(f"    p50={result['latency_p50_ms']}ms, p95={result['latency_p95_ms']}ms, "
                      f"p99={result['latency_p99_ms']}ms, success={result['successes']}/{TEST_REQUESTS}")
                result["payload_size_bytes"] = payload_bytes
                all_results.append(result)
    
    # ── P2: Receipt Verification (Independent) ────────────────────
    print("\n--- P2: Receipt Verification (via vardhan-receipt verify) ---")
    # Generate a single valid receipt for verification benchmarking
    token, org_id = create_session(worker_id=0)
    contract = build_contract(finding_id=next_finding_id("find-perf"))
    s, b, _ = api_request("POST", f"/api/v1/organizations/{org_id}/security/validate", token, contract)
    receipt_json = json.dumps(b)
    
    for c in CONCURRENCY_LEVELS:
        env = os.environ.copy()
        env["VARDHAN_ENV"] = "development"
        
        def verify_one(idx, rj=receipt_json):
            result = subprocess.run(
                [RECEIPT_BIN, "verify", "--receipt-id", f"verify-perf-{RUN_ID}-{idx}"],
                input=rj, capture_output=True, text=True, env=env, timeout=30
            )
            return "Valid" in result.stdout
        
        result = run_concurrent_raw(
            f"receipt_verify_c{c}", verify_one, c, TEST_REQUESTS, WARMUP_REQUESTS
        )
        print(f"    p50={result['latency_p50_ms']}ms, p95={result['latency_p95_ms']}ms, "
              f"p99={result['latency_p99_ms']}ms, success={result['successes']}/{TEST_REQUESTS}")
        all_results.append(result)
    
    # ── P3: Login Latency ─────────────────────────────────────────
    print("\n--- P3: Login Latency ---")
    for c in CONCURRENCY_LEVELS:
        def login_raw(idx):
            s, b, _ = api_request("POST", "/api/v1/auth/login",
                                  body={"username": ADMIN_USER, "password": ADMIN_PASS})
            return s == 200
        
        result = run_concurrent_raw(
            f"login_c{c}", login_raw, c, TEST_REQUESTS, WARMUP_REQUESTS
        )
        print(f"    p50={result['latency_p50_ms']}ms, p95={result['latency_p95_ms']}ms, "
              f"p99={result['latency_p99_ms']}ms, success={result['successes']}/{TEST_REQUESTS}")
        all_results.append(result)
    
    # ── P4: Audit Retrieval ───────────────────────────────────────
    print("\n--- P4: Audit Retrieval ---")
    for c in CONCURRENCY_LEVELS:
        print(f"  concurrency={c}...")
        result = benchmark_with_sessions(
            f"audit_retrieve_c{c}",
            make_audit_request,
            c, TEST_REQUESTS, WARMUP_REQUESTS
        )
        if result:
            print(f"    p50={result['latency_p50_ms']}ms, p95={result['latency_p95_ms']}ms, "
                  f"p99={result['latency_p99_ms']}ms, success={result['successes']}/{TEST_REQUESTS}")
            all_results.append(result)
    
    # ── P5: Full E2E Workflow ────────────────────────────────────
    print("\n--- P5: Full E2E Workflow ---")
    for c in [1, 10, 50]:
        print(f"  concurrency={c}...")
        result = benchmark_with_sessions(
            f"e2e_workflow_c{c}",
            make_e2e_request,
            c, 20, 3
        )
        if result:
            print(f"    p50={result['latency_p50_ms']}ms, p95={result['latency_p95_ms']}ms, "
                  f"p99={result['latency_p99_ms']}ms, success={result['successes']}/20")
            all_results.append(result)
    
    # ── P6: Baseline (Direct Subprocess, No HTTP Overhead) ───────
    print("\n--- P6: Baseline (Direct Subprocess — No HTTP API Overhead) ---")
    env = os.environ.copy()
    env["VARDHAN_ENV"] = "development"
    
    # Warmup
    for i in range(3):
        contract = build_contract(finding_id=next_finding_id("find-baseline-warmup"))
        subprocess.run([RECEIPT_BIN, "validate-canonical"],
                       input=json.dumps(contract).encode(),
                       capture_output=True, env=env, timeout=30)
    
    for c in CONCURRENCY_LEVELS:
        def baseline_one(idx):
            contract = build_contract(finding_id=next_finding_id("find-baseline"))
            start = time.monotonic()
            result = subprocess.run([RECEIPT_BIN, "validate-canonical"],
                                   input=json.dumps(contract).encode(),
                                   capture_output=True, env=env, timeout=30)
            elapsed = (time.monotonic() - start) * 1000
            try:
                body = json.loads(result.stdout.decode())
                return (elapsed, body.get("status") == "SEALED")
            except:
                return (elapsed, False)
        
        latencies = []
        successes = 0
        with concurrent.futures.ThreadPoolExecutor(max_workers=c) as executor:
            futures = [executor.submit(baseline_one, i) for i in range(TEST_REQUESTS)]
            for f in concurrent.futures.as_completed(futures):
                lat, ok = f.result()
                latencies.append(lat)
                if ok:
                    successes += 1
        
        latencies.sort()
        n = len(latencies)
        result = {
            "label": f"baseline_direct_c{c}",
            "concurrency": c,
            "requests": TEST_REQUESTS,
            "successes": successes,
            "errors": TEST_REQUESTS - successes,
            "latency_min_ms": round(min(latencies), 3),
            "latency_max_ms": round(max(latencies), 3),
            "latency_mean_ms": round(statistics.mean(latencies), 3),
            "latency_p50_ms": round(statistics.median(latencies), 3),
            "latency_p95_ms": round(latencies[int(n * 0.95)] if n > 1 else latencies[0], 3),
            "latency_p99_ms": round(latencies[min(int(n * 0.99), n-1)], 3),
        }
        print(f"    p50={result['latency_p50_ms']}ms, p95={result['latency_p95_ms']}ms, "
              f"p99={result['latency_p99_ms']}ms, success={result['successes']}/{TEST_REQUESTS}")
        all_results.append(result)
    
    # ── Summary ───────────────────────────────────────────────────
    print("\n" + "=" * 70)
    print("  Performance Benchmark Summary")
    print("=" * 70)
    
    print(f"\n{'Operation':<40} {'Conc':>5} {'p50 (ms)':>10} {'p95 (ms)':>10} {'p99 (ms)':>10} {'OK':>5}")
    print("-" * 90)
    for r in all_results:
        ok_count = r.get("successes", 0)
        print(f"{r['label']:<40} {r['concurrency']:>5} {r['latency_p50_ms']:>10.3f} {r['latency_p95_ms']:>10.3f} {r['latency_p99_ms']:>10.3f} {ok_count:>5}")
    
    output_file = os.environ.get("PERF_RESULTS_FILE", "/tmp/perf_results.json")
    with open(output_file, "w") as f:
        json.dump(all_results, f, indent=2)
    print(f"\nResults written to {output_file}")

if __name__ == "__main__":
    sys.exit(main())
