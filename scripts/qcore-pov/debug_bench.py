#!/usr/bin/env python3
"""Debug the actual perf_bench worker pattern"""
import json, urllib.request, urllib.error, time
import threading, concurrent.futures

HOST = "http://localhost:8080"
ADMIN_USER = "admin"
ADMIN_PASS = "P0V-Str0ng-P@ssw0rd-2025!"

def api_request(method, path, token=None, body=None):
    url = f"{HOST}{path}"
    data = json.dumps(body).encode() if body else None
    headers = {}
    if data: headers["Content-Type"] = "application/json"
    if token: headers["Authorization"] = f"Bearer {token}"
    
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            resp_body = resp.read().decode()
            new_token = resp.headers.get("Authorization-New-Token")
            if new_token and new_token.startswith("Bearer "): new_token = new_token[7:]
            else: new_token = token
            try: return resp.status, json.loads(resp_body), new_token
            except: return resp.status, {}, new_token
    except urllib.error.HTTPError as e:
        resp_body = e.read().decode()
        return e.code, {"error": resp_body[:300]}, token
    except Exception as e:
        return 0, {"error": str(e)}, token

def build_contract(finding_id, payload_size=1024):
    padding = "x" * max(0, payload_size - 800)
    return {
        "contract": {
            "schema_version": "1.1", "finding_id": finding_id,
            "intelligence": {"engine_id": "perf-bench", "engine_version": "1.0.0", "run_id": "run-bench-001"},
            "organization": {"organization_id": "org-vardhan-intelligence", "canonical_domain": "perf.vardhan.org"},
            "affected_resource": {"canonical_url": "https://api.vardhan.org", "surface_type": "API_REST", "entry_point_id": "ep-bench-1"},
            "technical_area": "STATIC_ANALYSIS", "technical_mechanism": "SQLi",
            "expected_behavior": "safe", "observed_behavior": "vulnerable",
            "differential_state": "CONFIRMED_MISMATCH", "materiality": "HIGH",
            "evidence_refs": [{"evidence_id": "ev-bench-1", "public_url": "https://ev.bench.org", "temporal_status": "CURRENT", "is_context_artifact": False, "evidence_origin": "scan", "content_hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}],
            "provenance_chain": {"expectation_id": "e1", "observation_ids": ["o1"], "differential_id": "d1", "hypothesis_id": "h1", "verification_contract_id": "v1"},
            "contradictory_evidence_ids": [], "uncertainty": [], "benign_explanation": padding,
            "authorization_context": {"requires_authorized_assessment": False},
            "decision_candidate": "SEAL_VERIFIED_FINDING",
            "policy_reference": "VARDHAN_CORE_INTELLIGENCE_POLICY_V1",
            "created_at": "2026-10-13T10:00:00Z",
            "evidence_earliest_retrieved_at": "2026-10-13T09:00:00Z",
            "evidence_latest_retrieved_at": "2026-10-13T09:30:00Z"
        },
        "actor_workload_id": "svc:vardhan-intelligence:perf-bench"
    }

def create_session(worker_id=None):
    s, b, _ = api_request("POST", "/api/v1/auth/login", body={"username": ADMIN_USER, "password": ADMIN_PASS})
    if s != 200: return None, None
    token = b.get("token", "")
    name = f"Bench-{int(time.time())}-{worker_id}" if worker_id is not None else f"Bench-{int(time.time())}"
    s2, b2, token = api_request("POST", "/api/v1/organizations", token, {"name": name})
    org_id = b2.get("organization", {}).get("id", "")
    return token, org_id

# Simulate benchmark_with_sessions exactly
CONCURRENCY = 10
REQUESTS = 10  # fewer for debugging
WARMUP = 3

sessions = {}
for i in range(CONCURRENCY):
    token, org_id = create_session(worker_id=i)
    if token is None:
        print(f"  Error: failed to create session for worker {i}")
        exit(1)
    sessions[i] = {"token": token, "org_id": org_id}

print(f"Created {CONCURRENCY} sessions")

latencies = []
successes = 0
errors = 0
results_lock = threading.Lock()

def worker(worker_idx):
    global successes, errors
    my_results = []
    session = sessions[worker_idx]
    token = session["token"]
    org_id = session["org_id"]
    
    my_indices = list(range(worker_idx, REQUESTS, CONCURRENCY))
    
    # Warmup (only for first batch)
    if worker_idx == 0:
        for i in range(WARMUP):
            c = build_contract(finding_id=f"warmup-{i}")
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
            contract = build_contract(finding_id=f"find-perf-{idx}", payload_size=1024)
            s, b, new_token = api_request("POST", f"/api/v1/organizations/{org_id}/security/validate",
                                        token, contract)
            elapsed = (time.monotonic() - start) * 1000
            if new_token:
                token = new_token
            ok = b.get("status") == "SEALED"
            if not ok:
                print(f"  Worker {worker_idx} idx {idx}: FAIL http={s} status={b.get('status','')} error={b.get('error','')[:100]}")
            my_results.append((elapsed, ok))
        except Exception as e:
            elapsed = (time.monotonic() - start) * 1000
            print(f"  Worker {worker_idx} idx {idx}: EXCEPTION {e}")
            my_results.append((elapsed, False))
    
    with results_lock:
        latencies.extend(r[0] for r in my_results)
        successes += sum(1 for r in my_results if r[1])
        errors += sum(1 for r in my_results if not r[1])

threads = []
for i in range(CONCURRENCY):
    t = threading.Thread(target=worker, args=(i,))
    threads.append(t)
    t.start()

for t in threads:
    t.join()

print(f"\nResults: {successes} successes, {errors} errors out of {REQUESTS}")
print(f"Latencies: min={min(latencies):.3f}ms, p50={sorted(latencies)[len(latencies)//2]:.3f}ms" if latencies else "No latencies")
