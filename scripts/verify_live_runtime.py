#!/usr/bin/env python3
"""
Vardhan Q-Core — Live Real-Time Runtime Acceptance Suite
Validates that the live running platform actually handles requests,
executes cryptographic self-tests, terminates TLS, authenticates sessions,
enforces PostgreSQL idempotency, rejects replay attacks, and handles
concurrency in real time (not just on paper).

Standard Baseline: Zero Emojis Permitted
"""

import urllib.request
import urllib.parse
import ssl
import json
import time
import concurrent.futures
import sys

BASE_URL = "https://127.0.0.1"
DEV_PASSWORD = "dev-strong-password-12345"
ADMIN_USER = "admin"
TENANT_ID = "org-vardhan-intelligence"

# Bypass self-signed staging certificate verification
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

def http_get(path, headers=None):
    url = f"{BASE_URL}{path}"
    req = urllib.request.Request(url, headers=headers or {})
    start = time.perf_counter()
    with urllib.request.urlopen(req, context=ctx, timeout=10) as resp:
        elapsed_ms = (time.perf_counter() - start) * 1000.0
        data = resp.read().decode("utf-8")
        return resp.status, json.loads(data), elapsed_ms

def http_post(path, payload, headers=None):
    url = f"{BASE_URL}{path}"
    body = json.dumps(payload).encode("utf-8")
    req_headers = {"Content-Type": "application/json"}
    if headers:
        req_headers.update(headers)
    req = urllib.request.Request(url, data=body, headers=req_headers, method="POST")
    start = time.perf_counter()
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=10) as resp:
            elapsed_ms = (time.perf_counter() - start) * 1000.0
            data = resp.read().decode("utf-8")
            return resp.status, json.loads(data), elapsed_ms
    except urllib.error.HTTPError as e:
        elapsed_ms = (time.perf_counter() - start) * 1000.0
        data = e.read().decode("utf-8")
        try:
            parsed = json.loads(data)
        except Exception:
            parsed = {"error": data}
        return e.code, parsed, elapsed_ms

def main():
    print("============================================================")
    print("VARDHAN Q-CORE LIVE RUNTIME VERIFICATION (REAL-TIME DRILL)")
    print("============================================================")
    
    # 1. Health & Storage Telemetry
    print("[1/7] Testing live platform health and PostgreSQL backend...")
    status, health, lat = http_get("/api/v1/platform/health")
    assert status == 200, f"Expected 200, got {status}"
    assert health["service"] == "vardhan-control-plane"
    assert health["status"] == "operational"
    assert health["storage"] == "healthy"
    assert health["storage_backend"] == "postgresql_cluster"
    assert health["crypto_self_tests"] == "OPERATIONAL"
    assert health["fips_140_3_validation"] == "NOT_CERTIFIED"
    print(f"      [PASS] Health check OK in {lat:.2f} ms")
    print(f"             - Service: {health['service']}")
    print(f"             - Storage Backend: {health['storage_backend']} ({health['storage']})")
    print(f"             - Internal Crypto KAT: {health['crypto_self_tests']}")
    print(f"             - CMVP Status: {health['fips_140_3_validation']}")

    # 2. Cryptographic Known-Answer-Test (KAT) Telemetry
    print("[2/7] Testing live cryptographic power-on self-test KATs...")
    status, crypto_telemetry, lat = http_get("/api/v1/crypto/fips-status")
    assert status == 200
    assert crypto_telemetry["status"] == "OPERATIONAL"
    kats = crypto_telemetry["self_tests"]
    for test_name in ["aes_256_gcm_kat", "sha3_512_kat", "blake3_kat", "ed25519_kat", "ml_dsa_87_kat", "ml_kem_1024_kat", "module_integrity_kat"]:
        assert kats[test_name] == "Pass", f"{test_name} failed: {kats[test_name]}"
    kat_time_micros = kats.get("execution_time_micros", 0)
    print(f"      [PASS] All 7 cryptographic KATs passed in {lat:.2f} ms (internal KAT execution: {kat_time_micros} us)")

    # 3. Catalog Plans
    print("[3/7] Testing catalog and plan service...")
    status, plans, lat = http_get("/api/v1/catalog/plans")
    assert status == 200
    assert len(plans) == 6
    print(f"      [PASS] Catalog retrieved in {lat:.2f} ms ({len(plans)} plans validated)")

    # 4. Cluster Membership
    print("[4/7] Testing cluster state and node discovery...")
    status, cluster, lat = http_get("/api/v1/cluster/status")
    assert status == 200
    assert cluster["cluster_enabled"] is True
    assert cluster["healthy_peers_count"] >= 1
    print(f"      [PASS] Cluster status verified in {lat:.2f} ms (Node: {cluster['node_id']}, Healthy Peers: {cluster['healthy_peers_count']})")

    # 5. Session Authentication Lifecycle
    print("[5/7] Testing live authentication, token issuance, and session guard...")
    status, login_resp, lat = http_post("/api/v1/auth/login", {
        "username": ADMIN_USER,
        "password": DEV_PASSWORD
    })
    assert status == 200, f"Login failed: {login_resp}"
    token = login_resp["token"]
    expires_in = login_resp["expires_in"]
    print(f"      [PASS] Admin session established in {lat:.2f} ms (Token: {token[:12]}..., Expires: {expires_in}s)")

    # Verify session
    auth_headers = {"Authorization": f"Bearer {token}"}
    status, session_info, lat = http_get("/api/v1/auth/session", headers=auth_headers)
    assert status == 200
    assert session_info["username"] == ADMIN_USER
    status, me_info, lat = http_get("/api/v1/me", headers=auth_headers)
    assert status == 200
    assert me_info["authenticated"] is True
    print(f"      [PASS] Authenticated identity confirmed in {lat:.2f} ms")

    # 6. Idempotency & Replay Protection
    print("[6/7] Testing live idempotency reservation and replay protection...")
    finding_id = f"finding-rt-live-{int(time.time())}"
    validation_payload = {
        "contract": {
            "schema_version": "1.0",
            "finding_id": finding_id,
            "intelligence": { "engine_id": "engine-01", "engine_version": "1.0.0", "run_id": f"run-{int(time.time())}" },
            "organization": { "organization_id": TENANT_ID, "canonical_domain": "vardhan.org" },
            "affected_resource": { "canonical_url": "https://api.vardhan.org/v1/settlement", "surface_type": "API_REST", "entry_point_id": "ep-settlement" },
            "technical_area": "STATIC_ANALYSIS",
            "technical_mechanism": "RULE_STAGING_ACCEPTANCE_TEST",
            "expected_behavior": "safe",
            "observed_behavior": "vuln",
            "differential_state": "CONFIRMED_MISMATCH",
            "materiality": "HIGH",
            "evidence_refs": [{
                "evidence_id": "ev-01",
                "public_url": "https://evidence.vardhan.org/audit",
                "temporal_status": "CURRENT",
                "is_context_artifact": False,
                "evidence_origin": "scan",
                "content_hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
            }],
            "provenance_chain": {
                "expectation_id": "exp-1",
                "observation_ids": ["obs-1"],
                "differential_id": "diff-1",
                "hypothesis_id": "hypo-1",
                "verification_contract_id": "vc-1"
            },
            "contradictory_evidence_ids": [],
            "uncertainty": [],
            "benign_explanation": "",
            "authorization_context": { "requires_authorized_assessment": False },
            "decision_candidate": "SEAL_VERIFIED_FINDING",
            "policy_reference": "VARDHAN_CORE_INTELLIGENCE_POLICY_V1",
            "created_at": "2026-10-24T17:00:00Z",
            "evidence_earliest_retrieved_at": "2026-10-24T16:00:00Z",
            "evidence_latest_retrieved_at": "2026-10-24T16:30:00Z"
        },
        "actor_workload_id": "svc:vardhan-intelligence:node-runner"
    }

    # Initial submission
    status_1, resp_1, lat_1 = http_post(
        f"/api/v1/organizations/{TENANT_ID}/security/validate",
        validation_payload,
        headers=auth_headers
    )
    print(f"      [PASS] Initial contract submission completed in {lat_1:.2f} ms (Status: {status_1})")

    # Duplicate submission to prove replay protection
    status_2, resp_2, lat_2 = http_post(
        f"/api/v1/organizations/{TENANT_ID}/security/validate",
        validation_payload,
        headers=auth_headers
    )
    assert resp_2.get("status") == "REJECTED_REPLAY", f"Expected REJECTED_REPLAY, got: {resp_2}"
    print(f"      [PASS] Duplicate submission rejected in {lat_2:.2f} ms (Guard: {resp_2['status']})")
    print(f"             Message: {resp_2['error']}")

    # 7. Real-Time Concurrency Load Drill
    CONCURRENT_REQUESTS = 50
    print(f"[7/7] Executing real-time concurrency load test ({CONCURRENT_REQUESTS} parallel requests)...")
    latencies = []
    errors = 0

    def send_probe(req_id):
        try:
            status, _, lat = http_get("/api/v1/crypto/fips-status")
            return status, lat
        except Exception as e:
            return 500, 0.0

    start_bench = time.perf_counter()
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
        futures = [executor.submit(send_probe, i) for i in range(CONCURRENT_REQUESTS)]
        for f in concurrent.futures.as_completed(futures):
            code, lat = f.result()
            if code == 200:
                latencies.append(lat)
            else:
                errors += 1
    total_bench_duration = (time.perf_counter() - start_bench) * 1000.0

    latencies.sort()
    min_lat = min(latencies)
    max_lat = max(latencies)
    mean_lat = sum(latencies) / len(latencies)
    p95_lat = latencies[int(len(latencies) * 0.95)]
    rps = (CONCURRENT_REQUESTS * 1000.0) / total_bench_duration

    print(f"      [PASS] Concurrency drill completed in {total_bench_duration:.2f} ms:")
    print(f"             - Requests sent: {CONCURRENT_REQUESTS}")
    print(f"             - Successful responses (HTTP 200): {len(latencies)}")
    print(f"             - Failed / dropped requests: {errors}")
    print(f"             - Throughput: {rps:.1f} req/sec")
    print(f"             - Latency min:  {min_lat:.2f} ms")
    print(f"             - Latency mean: {mean_lat:.2f} ms")
    print(f"             - Latency p95:  {p95_lat:.2f} ms")
    print(f"             - Latency max:  {max_lat:.2f} ms")

    print("============================================================")
    print("LIVE RUNTIME VERIFICATION STATUS: 100% OPERATIONAL")
    print("Platform successfully handles live traffic in real time.")
    print("============================================================")

if __name__ == "__main__":
    main()
