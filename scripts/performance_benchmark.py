#!/usr/bin/env python3
"""
VARDHAN Q-CORE -- Performance Benchmark (Phase 4 & 5)

Measures throughput and latency for each operation type:
  A. Organization Read (GET /api/v1/organizations/{id})
  B. Organization List (GET /api/v1/organizations)
  C. Authentication / Login (POST /api/v1/auth/login)
  D. Organization Create (POST /api/v1/organizations)
  E. Contract Seal - Success Path (POST /api/v1/organizations/{id}/security/validate)
  F. Contract Seal - Tenant Mismatch Rejection (deliberate mismatch, expected HTTP 403)
  G. Audit / Evidence Retrieve (GET /api/v1/organizations/{id}/security/audit)
  H. Replay Rejection Guard (resubmission of already-sealed finding, expected REJECTED_REPLAY)
  I. Independent Receipt Verification (binary execution of vardhan-receipt verify)
  J. End-to-End Workflow (Login -> Create Org -> Seal Contract)

Runs each benchmark at concurrency levels: 1, 5, 10, 25, 50, 100.

Throughput Methodology:
  throughput = completed_successful_requests / total_wall_clock_seconds
  (not the reciprocal of average request latency)

DISCLAIMER:
  Local synthetic benchmark. Single node. macOS arm64.
  Not a production-capacity measurement.
  Not approval for live banking rails.

Usage:
    python3 scripts/performance_benchmark.py
"""
import json
import os
import platform
import shutil
import subprocess
import sys
import time
import statistics
import urllib.request
import urllib.error
import concurrent.futures
from pathlib import Path
from datetime import datetime, timezone

REPO_ROOT = Path(__file__).resolve().parent.parent
BINARY = str(REPO_ROOT / "target" / "release" / "control_plane_api")
RECEIPT_BIN = str(REPO_ROOT / "target" / "release" / "vardhan-receipt")
PORT = 18095

BASE = f"http://127.0.0.1:{PORT}"
DATA_DIR = f"/tmp/vardhan_bench_{PORT}"
KEYSTORE_DIR = f"/tmp/vardhan_bench_ks_{PORT}"
IDEMPOTENCY_DIR = f"/tmp/vardhan_bench_idem_{PORT}"
AUTH_CONFIG_FILE = f"/tmp/vardhan_bench_auth_config_{PORT}.json"
ADMIN_USER = "admin"
ADMIN_PASS = "strong-password-12345"

CONCURRENCY_LEVELS = [1, 5, 10, 25, 50, 100]
WARMUP_REQUESTS = 3
TEST_REQUESTS = 50  # per concurrency level


# ---------------------------------------------------------------------------
# Environment recording
# ---------------------------------------------------------------------------

def record_environment():
    """Collect host environment details for the benchmark report header."""
    rust_version = "unknown"
    try:
        r = subprocess.run(
            ["rustc", "--version"],
            capture_output=True, text=True, timeout=10
        )
        rust_version = r.stdout.strip() if r.returncode == 0 else "unavailable"
    except Exception:
        rust_version = "unavailable"

    cargo_version = "unknown"
    try:
        r = subprocess.run(
            ["cargo", "--version"],
            capture_output=True, text=True, timeout=10
        )
        cargo_version = r.stdout.strip() if r.returncode == 0 else "unavailable"
    except Exception:
        cargo_version = "unavailable"

    env = {
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "hostname": platform.node(),
        "os": platform.platform(),
        "machine": platform.machine(),
        "processor": platform.processor(),
        "python": sys.version.split("\n")[0].strip(),
        "rustc": rust_version,
        "cargo": cargo_version,
        "control_plane_binary": BINARY,
        "receipt_binary": RECEIPT_BIN,
        "concurrency_levels": CONCURRENCY_LEVELS,
        "test_requests_per_level": TEST_REQUESTS,
        "warmup_requests": WARMUP_REQUESTS,
        "note": (
            "Local synthetic benchmark. Single node. Not a production-capacity "
            "measurement. Not approval for live banking rails."
        ),
    }
    return env


# ---------------------------------------------------------------------------
# Process helpers & Environment Setup
# ---------------------------------------------------------------------------

def kill_port(port):
    try:
        result = subprocess.run(["lsof", "-ti", f":{port}"], capture_output=True, text=True)
        for pid in result.stdout.strip().split("\n"):
            if pid:
                subprocess.run(["kill", "-9", pid], capture_output=True)
    except Exception:
        pass
    time.sleep(1)


def write_auth_config(tenants):
    """Write auth_config.json registering the benchmark tenants and policies."""
    config = {
        "tenants": list(set(tenants)),
        "policies": [{
            "policy_id": "VARDHAN_CORE_INTELLIGENCE_POLICY_V1",
            "policy_version": "1.0",
            "governed_actions": ["SEAL_VERIFIED_FINDING"],
            "authorized_actor_prefixes": ["svc:vardhan-intelligence:"]
        }],
        "issuers": [{
            "workload_prefix": "svc:vardhan-intelligence:",
            "issuer": "dev-local",
            "jwks_url": None,
            "active": True
        }]
    }
    with open(AUTH_CONFIG_FILE, "w") as f:
        json.dump(config, f, indent=2)


def setup_env():
    kill_port(PORT)
    for d in [DATA_DIR, KEYSTORE_DIR, IDEMPOTENCY_DIR]:
        if os.path.exists(d):
            shutil.rmtree(d)
        os.makedirs(d)

    # Initial auth config with standard tenants
    write_auth_config([
        "org-vardhan-intelligence",
        "org-acme-bank-poc",
        "org-test-tenant-valid"
    ])

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
    env["VARDHAN_AUTH_CONFIG_PATH"] = AUTH_CONFIG_FILE
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
    for _ in range(25):
        try:
            req = urllib.request.Request(f"{BASE}/api/v1/platform/health")
            with urllib.request.urlopen(req, timeout=2) as resp:
                if resp.status == 200:
                    return proc
        except Exception:
            pass
        time.sleep(1)
    raise RuntimeError("Server did not start within 25 seconds")


# ---------------------------------------------------------------------------
# HTTP helper & Auth Refresh
# ---------------------------------------------------------------------------

def api_request(method, path, token=None, body=None):
    """Make an HTTP request and return (status, parsed_body, rotated_token)."""
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
            except Exception:
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
        except Exception:
            parsed = {"raw": resp_body}
        return e.code, parsed, new_token


def obtain_fresh_token():
    """Login to obtain a fresh session token."""
    s, b, token = api_request(
        "POST", "/api/v1/auth/login", None,
        {"username": ADMIN_USER, "password": ADMIN_PASS},
    )
    if s != 200 or not b.get("token"):
        raise RuntimeError(f"Failed to obtain session token: HTTP {s} {b}")
    return b.get("token")


# ---------------------------------------------------------------------------
# Contract builder
# ---------------------------------------------------------------------------

def build_valid_contract(finding_id, actor="svc:vardhan-intelligence:bench-01", org_id=None):
    """
    Build a contract payload conforming to the Q-Core schema.
    """
    embedded_org_id = org_id if org_id else "org-vardhan-intelligence"
    return {
        "contract": {
            "schema_version": "1.0",
            "finding_id": finding_id,
            "intelligence": {
                "engine_id": "engine-bench",
                "engine_version": "1.0.0",
                "run_id": "run-bench-01",
            },
            "organization": {
                "organization_id": embedded_org_id,
                "canonical_domain": "vardhan.org",
            },
            "affected_resource": {
                "canonical_url": "https://api.vardhan.org",
                "surface_type": "API_REST",
                "entry_point_id": "ep-bench",
            },
            "technical_area": "STATIC_ANALYSIS",
            "technical_mechanism": "SQLi",
            "expected_behavior": "safe",
            "observed_behavior": "vulnerable",
            "differential_state": "CONFIRMED_MISMATCH",
            "materiality": "HIGH",
            "evidence_refs": [
                {
                    "evidence_id": "ev-bench-001",
                    "public_url": "https://evidence.vardhan.org",
                    "temporal_status": "CURRENT",
                    "is_context_artifact": False,
                    "evidence_origin": "scan",
                    "content_hash": (
                        "e3b0c44298fc1c149afbf4c8996fb924"
                        "27ae41e4649b934ca495991b7852b855"
                    ),
                }
            ],
            "provenance_chain": {
                "expectation_id": "exp",
                "observation_ids": ["obs"],
                "differential_id": "diff",
                "hypothesis_id": "hyp",
                "verification_contract_id": "verif",
            },
            "contradictory_evidence_ids": [],
            "uncertainty": [],
            "benign_explanation": "",
            "authorization_context": {"requires_authorized_assessment": False},
            "decision_candidate": "SEAL_VERIFIED_FINDING",
            "policy_reference": "VARDHAN_CORE_INTELLIGENCE_POLICY_V1",
            "created_at": "2026-10-13T10:00:00Z",
            "evidence_earliest_retrieved_at": "2026-10-13T09:00:00Z",
            "evidence_latest_retrieved_at": "2026-10-13T09:30:00Z",
        },
        "actor_workload_id": actor,
    }


# ---------------------------------------------------------------------------
# Receipt verification helper
# ---------------------------------------------------------------------------

def verify_receipt(receipt_json_str):
    """Independent verification using the vardhan-receipt binary."""
    verify_env = os.environ.copy()
    verify_env["VARDHAN_KEYSTORE_DIR"] = KEYSTORE_DIR
    verify_env["VARDHAN_ENV"] = "development"
    verify_env["VARDHAN_AUTH_CONFIG_PATH"] = AUTH_CONFIG_FILE
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


# ---------------------------------------------------------------------------
# Core benchmark runner
# ---------------------------------------------------------------------------

def run_benchmark(name, concurrency, request_fn, token, org_id,
                  expected_statuses=None, validator_fn=None):
    """
    Run *request_fn* concurrently and collect wall-clock throughput.
    """
    if expected_statuses is None:
        expected_statuses = {200, 201}

    latencies = []
    errors = 0
    unexpected_statuses = {}

    def work(_):
        try:
            t_start = time.perf_counter()
            status, body, _ = request_fn(token, org_id)
            elapsed_ms = (time.perf_counter() - t_start) * 1000
            return elapsed_ms, status, body
        except Exception:
            return None, None, None

    wall_start = time.perf_counter()
    with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as executor:
        futures = [executor.submit(work, i) for i in range(TEST_REQUESTS)]
        for fut in concurrent.futures.as_completed(futures):
            elapsed_ms, status, body = fut.result()
            if elapsed_ms is None or status is None:
                errors += 1
            elif status in expected_statuses:
                if validator_fn and not validator_fn(status, body):
                    errors += 1
                else:
                    latencies.append(elapsed_ms)
            else:
                errors += 1
                unexpected_statuses[status] = unexpected_statuses.get(status, 0) + 1
    wall_elapsed_s = time.perf_counter() - wall_start

    success = len(latencies)

    if not latencies:
        return {
            "name": name,
            "concurrency": concurrency,
            "total": TEST_REQUESTS,
            "success": 0,
            "errors": errors,
            "unexpected_statuses": unexpected_statuses,
            "throughput_req_per_s": 0.0,
            "wall_clock_s": round(wall_elapsed_s, 3),
            "latency_avg_ms": 0.0,
            "latency_p50_ms": 0.0,
            "latency_p95_ms": 0.0,
            "latency_p99_ms": 0.0,
            "latency_min_ms": 0.0,
            "latency_max_ms": 0.0,
        }

    latencies.sort()
    throughput = success / wall_elapsed_s if wall_elapsed_s > 0 else 0.0

    return {
        "name": name,
        "concurrency": concurrency,
        "total": TEST_REQUESTS,
        "success": success,
        "errors": errors,
        "unexpected_statuses": unexpected_statuses,
        "throughput_req_per_s": round(throughput, 2),
        "wall_clock_s": round(wall_elapsed_s, 3),
        "latency_avg_ms": round(statistics.mean(latencies), 3),
        "latency_p50_ms": round(latencies[len(latencies) // 2], 3),
        "latency_p95_ms": round(latencies[int(len(latencies) * 0.95)], 3),
        "latency_p99_ms": round(
            latencies[min(int(len(latencies) * 0.99), len(latencies) - 1)], 3
        ),
        "latency_min_ms": round(min(latencies), 3),
        "latency_max_ms": round(max(latencies), 3),
    }


# ---------------------------------------------------------------------------
# Individual benchmark functions
# ---------------------------------------------------------------------------

def bench_login(token, org_id):
    """Benchmark: Authentication (login)."""
    req = urllib.request.Request(
        f"{BASE}/api/v1/auth/login",
        data=json.dumps({"username": ADMIN_USER, "password": ADMIN_PASS}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = json.loads(resp.read().decode())
            return resp.status, body, body.get("token")
    except urllib.error.HTTPError as e:
        return e.code, {}, None


def bench_org_create(token, org_id):
    """Benchmark: Organization creation (write)."""
    return api_request(
        "POST", "/api/v1/organizations", token,
        {"name": f"Bench-{int(time.time() * 1000000)}"},
    )


def bench_org_read(token, org_id):
    """Benchmark: Organization read."""
    return api_request("GET", f"/api/v1/organizations/{org_id}", token)


def bench_org_list(token, org_id):
    """Benchmark: Organization list."""
    return api_request("GET", "/api/v1/organizations", token)


def bench_contract_seal(token, org_id):
    """
    Benchmark: Q-Core contract sealing (success path).
    Each request uses a unique finding ID so it seals a fresh contract.
    """
    finding_id = f"find-seal-{int(time.time() * 1000000000)}"
    contract = build_valid_contract(finding_id, org_id=org_id)
    return api_request(
        "POST",
        f"/api/v1/organizations/{org_id}/security/validate",
        token,
        contract,
    )


def bench_contract_seal_mismatch(token, org_id):
    """
    Benchmark: Contract seal -- intentional tenant-mismatch rejection path.
    Uses a mismatched organization ID. Server returns HTTP 403.
    """
    contract = build_valid_contract(
        f"find-mismatch-{int(time.time() * 1000000000)}",
        org_id="org-deliberate-mismatch-fixture",
    )
    return api_request(
        "POST",
        f"/api/v1/organizations/{org_id}/security/validate",
        token,
        contract,
    )


def bench_receipt_verify(receipt_json_str):
    """
    Benchmark: Independent receipt verification (binary-level).
    Verifies authentic dual Ed25519 and ML-DSA-87 signatures.
    """
    def do_verify(token, org_id):
        rc, _output = verify_receipt(receipt_json_str)
        status = 200 if rc == 0 else 422
        return status, {}, None
    return do_verify


def bench_audit(token, org_id):
    """Benchmark: Audit/evidence retrieval."""
    return api_request(
        "GET", f"/api/v1/organizations/{org_id}/security/audit", token
    )


def bench_replay_reject(token, org_id, finding_id):
    """
    Benchmark: Replay rejection (idempotency guard).
    Submits an already-sealed finding. Server returns HTTP 200 with REJECTED_REPLAY.
    """
    contract = build_valid_contract(finding_id, org_id=org_id)
    return api_request(
        "POST",
        f"/api/v1/organizations/{org_id}/security/validate",
        token,
        contract,
    )


def bench_e2e_single(reference_org):
    """
    Single E2E workflow: login -> create org -> seal contract.
    """
    t_start = time.perf_counter()
    s1, b1, t1 = api_request(
        "POST", "/api/v1/auth/login", None,
        {"username": ADMIN_USER, "password": ADMIN_PASS},
    )
    t1 = b1.get("token", t1)

    s2, b2, t2 = api_request(
        "POST", "/api/v1/organizations", t1,
        {"name": f"E2E-{int(time.time() * 1000000)}"},
    )
    e2e_org = b2.get("organization", {}).get("id", reference_org)

    contract = build_valid_contract(
        f"find-e2e-{int(time.time() * 1000000000)}",
        org_id=reference_org,
    )
    s3, b3, _ = api_request(
        "POST",
        f"/api/v1/organizations/{reference_org}/security/validate",
        t2,
        contract,
    )
    elapsed_ms = (time.perf_counter() - t_start) * 1000
    return elapsed_ms, s3, b3


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print("=" * 80)
    print("  VARDHAN Q-CORE -- Performance Benchmark")
    print("  DISCLAIMER: Local synthetic benchmark. Single node. macOS arm64.")
    print("  Not a production-capacity measurement.")
    print("  Not approval for live banking rails.")
    print("=" * 80)

    env_info = record_environment()
    print("\n-- Environment --")
    for k, v in env_info.items():
        if k not in ("concurrency_levels", "note"):
            print(f"  {k}: {v}")
    print(f"  concurrency_levels: {env_info['concurrency_levels']}")
    print(f"  note: {env_info['note']}")
    print()

    env = setup_env()
    proc = start_server(env)
    print(f"Server started on port {PORT}")

    # Initial login
    token = obtain_fresh_token()
    print(f"Initial login: OK")

    # Create reference organization
    s, b, token = api_request(
        "POST", "/api/v1/organizations", token,
        {"name": "Benchmark Reference Org"},
    )
    org_id = b["organization"]["id"]
    print(f"Reference Org created: {org_id}")

    # Register the created org in auth_config.json so vardhan-receipt validates it
    write_auth_config([
        "org-vardhan-intelligence",
        "org-acme-bank-poc",
        "org-test-tenant-valid",
        org_id,
    ])
    print(f"Auth config updated with tenant {org_id}")

    # Seed one contract to verify sealing and enable replay-rejection bench
    seed_finding = f"find-bench-seed-{int(time.time()*1000)}"
    seed_contract = build_valid_contract(seed_finding, org_id=org_id)
    s, seed_receipt, token = api_request(
        "POST",
        f"/api/v1/organizations/{org_id}/security/validate",
        token,
        seed_contract,
    )
    seed_status = seed_receipt.get("status")
    print(f"Seed contract seal status: {seed_status} (HTTP {s})")
    if seed_status != "SEALED":
        print(f"WARNING: Seed contract was not sealed: {seed_receipt}")

    # Prepare sealed receipt for independent verification test
    receipt_json_str = json.dumps(seed_receipt)
    rc_check, out_check = verify_receipt(receipt_json_str)
    print(f"Initial receipt verification check: rc={rc_check}")

    # Warmup
    for _ in range(WARMUP_REQUESTS):
        api_request("GET", "/api/v1/platform/health")

    # ------------------------------------------------------------------
    # Benchmark suites
    # ------------------------------------------------------------------
    benchmarks = [
        (
            "A. Org Read",
            bench_org_read,
            {200},
            None,
            None,
        ),
        (
            "B. Org List",
            bench_org_list,
            {200},
            None,
            None,
        ),
        (
            "C. Login",
            bench_login,
            {200},
            None,
            None,
        ),
        (
            "D. Org Create",
            bench_org_create,
            {200, 201},
            None,
            None,
        ),
        (
            "E. Contract Seal (success)",
            bench_contract_seal,
            {200, 201},
            lambda s, b: b.get("status") == "SEALED",
            "Contract payload matches route org. Asserts status == SEALED.",
        ),
        (
            "F. Contract Seal (mismatch)",
            bench_contract_seal_mismatch,
            {403},
            lambda s, b: b.get("status") == "REJECTED_TENANT_MISMATCH",
            "Deliberate tenant mismatch. Asserts HTTP 403 / REJECTED_TENANT_MISMATCH.",
        ),
        (
            "G. Audit Retrieve",
            bench_audit,
            {200},
            None,
            None,
        ),
        (
            "H. Replay Reject",
            lambda t, o: bench_replay_reject(t, o, seed_finding),
            {200},
            lambda s, b: b.get("status") == "REJECTED_REPLAY",
            "Resubmits already-sealed finding. Asserts status == REJECTED_REPLAY.",
        ),
        (
            "I. Receipt Verify",
            bench_receipt_verify(receipt_json_str),
            {200},
            None,
            "Independent execution of vardhan-receipt verify. Full cryptographic verification.",
        ),
    ]

    all_results = []

    for bench_name, bench_fn, exp_statuses, validator, bench_note in benchmarks:
        print(f"\n--- {bench_name} ---")
        if bench_note:
            print(f"    NOTE: {bench_note}")
        for cl in CONCURRENCY_LEVELS:
            # Refresh token before each concurrency level to satisfy single-use session rotation
            active_token = obtain_fresh_token()

            result = run_benchmark(
                bench_name, cl, bench_fn, active_token, org_id,
                expected_statuses=exp_statuses,
                validator_fn=validator,
            )
            all_results.append(result)
            unexpected_info = ""
            if result["unexpected_statuses"]:
                unexpected_info = f"  unexpected={result['unexpected_statuses']}"
            print(
                f"  c={cl:>3}: {result['success']}/{result['total']} ok, "
                f"{result['throughput_req_per_s']} req/s (wall {result['wall_clock_s']}s), "
                f"avg={result['latency_avg_ms']}ms, "
                f"p95={result['latency_p95_ms']}ms, "
                f"max={result['latency_max_ms']}ms, "
                f"err={result['errors']}{unexpected_info}"
            )
            time.sleep(0.2)

    # ------------------------------------------------------------------
    # E2E workflow benchmark (sequential)
    # ------------------------------------------------------------------
    print("\n--- J. E2E Workflow (sequential) ---")
    print("    NOTE: Full flow (Login -> Create Org -> Seal Contract).")
    E2E_RUNS = 20
    e2e_latencies = []
    e2e_errors = 0
    wall_e2e_start = time.perf_counter()
    for _ in range(E2E_RUNS):
        elapsed_ms, final_status, final_body = bench_e2e_single(org_id)
        if final_status in (200, 201) and final_body.get("status") == "SEALED":
            e2e_latencies.append(elapsed_ms)
        else:
            e2e_errors += 1
    wall_e2e_s = time.perf_counter() - wall_e2e_start

    e2e_success = len(e2e_latencies)
    if e2e_latencies:
        e2e_latencies.sort()
        e2e_tp = e2e_success / wall_e2e_s if wall_e2e_s > 0 else 0.0
        e2e_avg = statistics.mean(e2e_latencies)
        e2e_p50 = e2e_latencies[len(e2e_latencies) // 2]
        e2e_p95 = e2e_latencies[int(len(e2e_latencies) * 0.95)]
        e2e_p99 = e2e_latencies[min(int(len(e2e_latencies) * 0.99), e2e_success - 1)]
        e2e_min = min(e2e_latencies)
        e2e_max = max(e2e_latencies)
    else:
        e2e_tp = e2e_avg = e2e_p50 = e2e_p95 = e2e_p99 = e2e_min = e2e_max = 0.0

    print(
        f"  runs={E2E_RUNS}, success={e2e_success}, errors={e2e_errors}, "
        f"wall={round(wall_e2e_s, 3)}s, throughput={round(e2e_tp, 2)} req/s"
    )
    print(
        f"  avg={round(e2e_avg, 3)}ms, p50={round(e2e_p50, 3)}ms, "
        f"p95={round(e2e_p95, 3)}ms, max={round(e2e_max, 3)}ms"
    )

    e2e_result = {
        "name": "J. E2E Workflow",
        "concurrency": 1,
        "total": E2E_RUNS,
        "success": e2e_success,
        "errors": e2e_errors,
        "unexpected_statuses": {},
        "throughput_req_per_s": round(e2e_tp, 2),
        "wall_clock_s": round(wall_e2e_s, 3),
        "latency_avg_ms": round(e2e_avg, 3),
        "latency_p50_ms": round(e2e_p50, 3),
        "latency_p95_ms": round(e2e_p95, 3),
        "latency_p99_ms": round(e2e_p99, 3),
        "latency_min_ms": round(e2e_min, 3),
        "latency_max_ms": round(e2e_max, 3),
    }
    all_results.append(e2e_result)

    # ------------------------------------------------------------------
    # Summary table
    # ------------------------------------------------------------------
    print("\n" + "=" * 100)
    print("  Performance Benchmark Results")
    print("  Throughput = completed_success_requests / total_wall_clock_seconds")
    print("=" * 100)
    header = (
        f"{'Operation':<36} {'c':>4} {'ok/total':>9} {'req/s':>8} "
        f"{'wall_s':>8} {'avg_ms':>9} {'p95_ms':>9} {'max_ms':>9} {'err':>5}"
    )
    print(header)
    print("-" * 100)
    for r in all_results:
        print(
            f"{r['name']:<36} {r['concurrency']:>4} "
            f"{r['success']:>4}/{r['total']:<4} "
            f"{r['throughput_req_per_s']:>8.2f} "
            f"{r['wall_clock_s']:>8.3f} "
            f"{r['latency_avg_ms']:>9.3f} "
            f"{r['latency_p95_ms']:>9.3f} "
            f"{r['latency_max_ms']:>9.3f} "
            f"{r['errors']:>5}"
        )
    print("=" * 100)

    # ------------------------------------------------------------------
    # Write JSON results
    # ------------------------------------------------------------------
    output_file = "/tmp/vardhan_bench_results.json"
    payload = {"environment": env_info, "results": all_results}
    with open(output_file, "w") as fh:
        json.dump(payload, fh, indent=2)
    print(f"\nResults written to {output_file}")

    # ------------------------------------------------------------------
    # Cleanup
    # ------------------------------------------------------------------
    proc.terminate()
    proc.wait(timeout=10)
    kill_port(PORT)
    for d in [DATA_DIR, KEYSTORE_DIR, IDEMPOTENCY_DIR]:
        if os.path.exists(d):
            shutil.rmtree(d)
    for fp in ["/tmp/vardhan_bench_pw.txt", "/tmp/vardhan_bench_server.log", AUTH_CONFIG_FILE]:
        if os.path.exists(fp):
            os.remove(fp)

    print("\nBenchmark complete.")


if __name__ == "__main__":
    sys.exit(main())
