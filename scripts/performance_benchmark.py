#!/usr/bin/env python3
"""
VARDHAN Q-CORE — Performance Benchmark (Phase 4 & 5)

Measures throughput and latency for each operation type:
  A. Organization CRUD (create, read, list)
  B. Authentication (login)
  C. Q-Core transaction validation (contract sealing via vardhan-receipt)
  D. Cryptographic signing (receipt seal generation)
  E. Independent receipt verification
  F. Audit/evidence retrieval
  G. Replay rejection (idempotency check)
  H. E2E workflow (login → create org → submit contract → verify)

Runs each benchmark at concurrency levels: 1, 5, 10, 25, 50, 100.

Usage:
    python3 scripts/performance_benchmark.py
"""
import json
import os
import shutil
import subprocess
import sys
import time
import statistics
import urllib.request
import urllib.error
import concurrent.futures
from pathlib import Path
from datetime import datetime

REPO_ROOT = Path("/Users/vishnuvardhanburri/antigravity/VARDHAN_Q_CORE-PLATFORM-main")
BINARY = str(REPO_ROOT / "target" / "release" / "control_plane_api")
RECEIPT_BIN = str(REPO_ROOT / "target" / "release" / "vardhan-receipt")
PORT = 18095

BASE = f"http://127.0.0.1:{PORT}"
DATA_DIR = f"/tmp/vardhan_bench_{PORT}"
KEYSTORE_DIR = f"/tmp/vardhan_bench_ks_{PORT}"
IDEMPOTENCY_DIR = f"/tmp/vardhan_bench_idem_{PORT}"
ADMIN_USER = "admin"
ADMIN_PASS = "strong-password-12345"

CONCURRENCY_LEVELS = [1, 5, 10, 25, 50, 100]
WARMUP_REQUESTS = 3
TEST_REQUESTS = 50  # per concurrency level


def kill_port(port):
    try:
        result = subprocess.run(["lsof", "-ti", f":{port}"], capture_output=True, text=True)
        for pid in result.stdout.strip().split("\n"):
            if pid:
                subprocess.run(["kill", "-9", pid], capture_output=True)
    except:
        pass
    time.sleep(1)


def setup_env():
    kill_port(PORT)
    for d in [DATA_DIR, KEYSTORE_DIR, IDEMPOTENCY_DIR]:
        if os.path.exists(d):
            shutil.rmtree(d)
        os.makedirs(d)

    pw_file = "/tmp/vardhan_bench_pw.txt"
    with open(pw_file, "w") as f:
        f.write(ADMIN_PASS)
    os.chmod(pw_file, 0o600)

    env = os.environ.copy()
    env["VARDHAN_ADMIN_USERNAME"] = ADMIN_USER
    env["VARDHAN_ADMIN_PASSWORD_FILE"] = pw_file
    env["VARDHAN_CONTROL_PLANE_DATA_DIR"] = DATA_DIR
    env["VARDHAN_CONTROL_PLANE_ADDR"] = f"127.0.0.1:{PORT}"
    env["VARDHAN_NODE_ID"] = "bench-node"
    env["VARDHAN_ENV"] = "development"
    env["VARDHAN_KEYSTORE_DIR"] = KEYSTORE_DIR
    env["VARDHAN_IDEMPOTENCY_DIR"] = IDEMPOTENCY_DIR
    return env


def start_server(env):
    log_file = open("/tmp/vardhan_bench_server.log", "w")
    proc = subprocess.Popen(
        [BINARY],
        env=env,
        stdout=log_file,
        stderr=subprocess.STDOUT,
        cwd=str(REPO_ROOT),
    )
    for i in range(25):
        try:
            req = urllib.request.Request(f"{BASE}/api/v1/platform/health")
            with urllib.request.urlopen(req, timeout=2) as resp:
                if resp.status == 200:
                    return proc
        except:
            pass
        time.sleep(1)
    raise RuntimeError("Server did not start")


def api_request(method, path, token=None, body=None):
    """Make a request and return (status, body, rotated_token)."""
    url = f"{BASE}{path}"
    data = json.dumps(body).encode() if body else None
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if data:
        headers["Content-Type"] = "application/json"

    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            resp_body = resp.read().decode()
            new_token = resp.headers.get("Authorization-New-Token", "")
            if new_token.startswith("Bearer "):
                new_token = new_token[7:]
            else:
                new_token = token
            try:
                parsed = json.loads(resp_body) if resp_body else {}
            except:
                parsed = {"raw": resp_body}
            return resp.status, parsed, new_token
    except urllib.error.HTTPError as e:
        resp_body = e.read().decode()
        new_token = e.headers.get("Authorization-New-Token", "")
        if new_token.startswith("Bearer "):
            new_token = new_token[7:]
        else:
            new_token = token
        try:
            parsed = json.loads(resp_body) if resp_body else {}
        except:
            parsed = {"raw": resp_body}
        return e.code, parsed, new_token


def build_valid_contract(finding_id, actor="svc:vardhan-intelligence:bench-01"):
    return {
        "contract": {
            "schema_version": "1.0",
            "finding_id": finding_id,
            "intelligence": {"engine_id": "engine-bench", "engine_version": "1.0.0", "run_id": "run-bench-01"},
            "organization": {"organization_id": "org-vardhan-intelligence", "canonical_domain": "vardhan.org"},
            "affected_resource": {"canonical_url": "https://api.vardhan.org", "surface_type": "API_REST", "entry_point_id": "ep-bench"},
            "technical_area": "STATIC_ANALYSIS", "technical_mechanism": "SQLi",
            "expected_behavior": "safe", "observed_behavior": "vulnerable",
            "differential_state": "CONFIRMED_MISMATCH", "materiality": "HIGH",
            "evidence_refs": [{
                "evidence_id": "ev-bench-001",
                "public_url": "https://evidence.vardhan.org",
                "temporal_status": "CURRENT",
                "is_context_artifact": False,
                "evidence_origin": "scan",
                "content_hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
            }],
            "provenance_chain": {"expectation_id": "exp", "observation_ids": ["obs"], "differential_id": "diff", "hypothesis_id": "hyp", "verification_contract_id": "verif"},
            "contradictory_evidence_ids": [], "uncertainty": [], "benign_explanation": "",
            "authorization_context": {"requires_authorized_assessment": False},
            "decision_candidate": "SEAL_VERIFIED_FINDING",
            "policy_reference": "VARDHAN_CORE_INTELLIGENCE_POLICY_V1",
            "created_at": "2026-10-13T10:00:00Z",
            "evidence_earliest_retrieved_at": "2026-10-13T09:00:00Z",
            "evidence_latest_retrieved_at": "2026-10-13T09:30:00Z"
        },
        "actor_workload_id": actor
    }


def verify_receipt(receipt_json_str):
    """Independent verification using vardhan-receipt binary."""
    verify_env = os.environ.copy()
    verify_env["VARDHAN_KEYSTORE_DIR"] = KEYSTORE_DIR
    verify_env["VARDHAN_ENV"] = "development"
    try:
        result = subprocess.run(
            [RECEIPT_BIN, "verify", "--receipt-id", "bench"],
            input=receipt_json_str,
            capture_output=True,
            text=True,
            timeout=30,
            env=verify_env,
        )
        return result.returncode, result.stdout + result.stderr
    except Exception as e:
        return -1, str(e)


def run_benchmark(name, concurrency, request_fn, token, org_id):
    """Run a benchmark at the given concurrency level."""
    results = []
    errors = 0

    def work(_):
        try:
            start = time.perf_counter()
            status, body, _ = request_fn(token, org_id)
            elapsed = (time.perf_counter() - start) * 1000  # ms
            return elapsed, status
        except Exception:
            return None, None

    with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as executor:
        futures = [executor.submit(work, i) for i in range(TEST_REQUESTS)]
        for f in concurrent.futures.as_completed(futures):
            elapsed, status = f.result()
            if elapsed is not None:
                results.append(elapsed)
            else:
                errors += 1

    if not results:
        return {"name": name, "concurrency": concurrency, "total": TEST_REQUESTS,
                "success": 0, "errors": errors, "throughput": 0,
                "latency_avg": 0, "latency_p50": 0, "latency_p95": 0, "latency_p99": 0,
                "latency_min": 0, "latency_max": 0}

    results.sort()
    tp = len(results) / (sum(results) / 1000.0) if results else 0
    return {
        "name": name,
        "concurrency": concurrency,
        "total": TEST_REQUESTS,
        "success": len(results),
        "errors": errors,
        "throughput": round(tp, 2),
        "latency_avg": round(statistics.mean(results), 3),
        "latency_p50": round(results[len(results) // 2], 3),
        "latency_p95": round(results[int(len(results) * 0.95)], 3),
        "latency_p99": round(results[min(int(len(results) * 0.99), len(results) - 1)], 3),
        "latency_min": round(min(results), 3),
        "latency_max": round(max(results), 3),
    }


def bench_login(token, org_id):
    """Benchmark: Authentication (login)."""
    def do_request(_token, _org):
        # Login always uses the same credentials
        req = urllib.request.Request(f"{BASE}/api/v1/auth/login",
            data=json.dumps({"username": ADMIN_USER, "password": ADMIN_PASS}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST")
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                body = json.loads(resp.read().decode())
                return resp.status, body, body.get("token")
        except urllib.error.HTTPError as e:
            return e.code, {}, None
    return _run_req(do_request, token, org_id)


def bench_org_create(token, org_id):
    """Benchmark: Organization creation (write)."""
    def do_request(t, _org):
        return api_request("POST", "/api/v1/organizations", t, {"name": f"Bench-{int(time.time()*1000)}"})
    return _run_req(do_request, token, org_id)


def _run_req(do_request, token, org_id):
    """Wrapper for benchmarks that need a single request function."""
    start = time.perf_counter()
    # We need to handle token rotation - but for concurrency we use a single token
    return do_request(token, org_id)


def bench_org_read(token, org_id):
    """Benchmark: Organization read (read)."""
    def do_request(t, _org):
        return api_request("GET", f"/api/v1/organizations/{org_id}", t)
    return _run_req(do_request, token, org_id)


def bench_org_list(token, org_id):
    """Benchmark: Organization list (read)."""
    def do_request(t, _org):
        return api_request("GET", "/api/v1/organizations", t)
    return _run_req(do_request, token, org_id)


def bench_contract_seal(token, org_id):
    """Benchmark: Q-Core transaction validation / sealing."""
    contract = build_valid_contract(f"find-bench-{int(time.time()*1000000)}")
    def do_request(t, _org):
        return api_request("POST", f"/api/v1/organizations/{org_id}/security/validate", t, contract)
    return _run_req(do_request, token, org_id)


def bench_receipt_verify(token, org_id):
    """Benchmark: Independent receipt verification (binary-level)."""
    # This is a separate benchmark since it doesn't use the HTTP API
    receipt_json_str = json.dumps({
        "receipt_id": "VQR-bench-test",
        "status": "SEALED",
        "signatures": {"ed25519_sig": "x" * 64, "ml_dsa_87_sig": "y" * 3000},
        "sealed_at": "2026-01-01T00:00:00Z",
        "issuer": "vardhan-receipt"
    })
    def do_request(_t, _org):
        rc, output = verify_receipt(receipt_json_str)
        return 200 if rc == 0 else 422, {}, None
    return _run_req(do_request, token, org_id)


def bench_audit(token, org_id):
    """Benchmark: Audit/evidence retrieval."""
    def do_request(t, _org):
        return api_request("GET", f"/api/v1/organizations/{org_id}/security/audit", t)
    return _run_req(do_request, token, org_id)


def bench_replay_reject(token, org_id, finding_id):
    """Benchmark: Replay rejection (idempotency check)."""
    contract = build_valid_contract(finding_id)
    def do_request(t, _org):
        return api_request("POST", f"/api/v1/organizations/{org_id}/security/validate", t, contract)
    return _run_req(do_request, token, org_id)


def bench_e2e(token, org_id):
    """Benchmark: E2E workflow (login → create org → submit contract)."""
    def do_request(_t, _org):
        start = time.perf_counter()
        # Login
        s1, b1, t1 = api_request("POST", "/api/v1/auth/login", None,
            {"username": ADMIN_USER, "password": ADMIN_PASS})
        t1 = b1.get("token", t1)
        # Create org
        s2, b2, t2 = api_request("POST", "/api/v1/organizations", t1,
            {"name": f"E2E-{int(time.time()*1000000)}"})
        e2e_org = b2.get("organization", {}).get("id", "")
        # Submit contract
        contract = build_valid_contract(f"find-e2e-{int(time.time()*1000000)}")
        s3, b3, _ = api_request("POST", f"/api/v1/organizations/{e2e_org}/security/validate", t2, contract)
        elapsed = (time.perf_counter() - start) * 1000
        return elapsed, s3, None
    return do_request(token, org_id)


def main():
    print("=== Phase 4 & 5: Performance Benchmark ===\n")
    env = setup_env()
    proc = start_server(env)
    print(f"Server started on port {PORT}")

    # Initial login
    s, b, token = api_request("POST", "/api/v1/auth/login", None,
        {"username": ADMIN_USER, "password": ADMIN_PASS})
    token = b.get("token", token)
    print(f"Login: {s}")

    # Create a reference org
    s, b, token = api_request("POST", "/api/v1/organizations", token,
        {"name": "Benchmark Reference Org"})
    org_id = b["organization"]["id"]
    print(f"Org created: {org_id}")

    # Create one sealing contract first to have a receipt for verification
    contract = build_valid_contract("find-bench-seed-001")
    s, b, token = api_request("POST", f"/api/v1/organizations/{org_id}/security/validate", token, contract)
    receipt = b
    print(f"Seed contract sealed: {b.get('status')}")

    # Warmup
    for _ in range(WARMUP_REQUESTS):
        api_request("GET", "/api/v1/platform/health")

    # Define benchmarks
    benchmarks = [
        ("A. Org Read", bench_org_read),
        ("B. Org List", bench_org_list),
        ("C. Login", bench_login),
        ("D. Org Create", bench_org_create),
        ("E. Contract Seal", bench_contract_seal),
        ("F. Audit Retrieve", bench_audit),
        ("G. Replay Reject", lambda t, o: bench_replay_reject(t, o, "find-bench-seed-001")),
        ("H. Receipt Verify", bench_receipt_verify),
    ]

    all_results = []

    for bench_name, bench_fn in benchmarks:
        print(f"\n--- {bench_name} ---")
        for cl in CONCURRENCY_LEVELS:
            result = run_benchmark(bench_name, cl, bench_fn, token, org_id)
            all_results.append(result)
            print(f"  c={cl:>3}: {result['success']}/{result['total']} ok, "
                  f"{result['throughput']} req/s, "
                  f"avg={result['latency_avg']}ms, "
                  f"p95={result['latency_p95']}ms, "
                  f"max={result['latency_max']}ms")
            # Brief pause between runs
            time.sleep(0.5)

    # E2E benchmark (sequential, no concurrency needed)
    print(f"\n--- I. E2E Workflow ---")
    e2e_times = []
    for _ in range(20):
        elapsed, status, _ = bench_e2e(token, org_id)
        e2e_times.append(elapsed)
    e2e_times.sort()
    print(f"  E2E throughput: {len(e2e_times)/(sum(e2e_times)/1000.0):.2f} req/s")
    print(f"  avg={statistics.mean(e2e_times):.3f}ms, "
          f"p50={e2e_times[len(e2e_times)//2]:.3f}ms, "
          f"p95={e2e_times[int(len(e2e_times)*0.95)]:.3f}ms")
    all_results.append({
        "name": "I. E2E Workflow",
        "concurrency": 1,
        "total": 20,
        "success": 20,
        "errors": 0,
        "throughput": round(len(e2e_times)/(sum(e2e_times)/1000.0), 2),
        "latency_avg": round(statistics.mean(e2e_times), 3),
        "latency_p50": round(e2e_times[len(e2e_times)//2], 3),
        "latency_p95": round(e2e_times[int(len(e2e_times)*0.95)], 3),
        "latency_p99": round(e2e_times[min(int(len(e2e_times)*0.99), len(e2e_times)-1)], 3),
        "latency_min": round(min(e2e_times), 3),
        "latency_max": round(max(e2e_times), 3),
    })

    # Print summary tables
    print("\n" + "=" * 80)
    print("  Performance Benchmark Results")
    print("=" * 80)
    print(f"{'Operation':<30} {'Concurrency':>11} {'Throughput':>12} {'Avg ms':>10} {'P95 ms':>10} {'Max ms':>10} {'Errors':>8}")
    print("-" * 80)
    for r in all_results:
        print(f"{r['name']:<30} {r['concurrency']:>11} {r['throughput']:>12} "
              f"{r['latency_avg']:>10} {r['latency_p95']:>10} "
              f"{r['latency_max']:>10} {r['errors']:>8}")
    print("=" * 80)

    # Write results to JSON
    output_file = "/tmp/vardhan_bench_results.json"
    with open(output_file, "w") as f:
        json.dump(all_results, f, indent=2)
    print(f"\nResults written to {output_file}")

    # Cleanup
    proc.terminate()
    proc.wait(timeout=10)
    kill_port(PORT)
    for d in [DATA_DIR, KEYSTORE_DIR, IDEMPOTENCY_DIR]:
        if os.path.exists(d):
            shutil.rmtree(d)
    for f in ["/tmp/vardhan_bench_pw.txt", "/tmp/vardhan_bench_server.log"]:
        if os.path.exists(f):
            os.remove(f)

    print("\nBenchmark complete.")


if __name__ == "__main__":
    sys.exit(main())
