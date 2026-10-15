#!/usr/bin/env python3
"""Debug concurrent token rotation issue"""
import json, urllib.request, urllib.error, time
import concurrent.futures, threading

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
        return e.code, {"error": resp_body[:200]}, token
    except Exception as e:
        return 0, {"error": str(e)}, token

def build_contract(finding_id):
    return {
        "contract": {
            "schema_version": "1.1",
            "finding_id": finding_id,
            "intelligence": {"engine_id": "perf-bench", "engine_version": "1.0.0", "run_id": "run-bench-001"},
            "organization": {"organization_id": "org-vardhan-intelligence", "canonical_domain": "perf.vardhan.org"},
            "affected_resource": {"canonical_url": "https://api.vardhan.org", "surface_type": "API_REST", "entry_point_id": "ep-bench-1"},
            "technical_area": "STATIC_ANALYSIS",
            "technical_mechanism": "SQLi",
            "expected_behavior": "safe", "observed_behavior": "vulnerable",
            "differential_state": "CONFIRMED_MISMATCH", "materiality": "HIGH",
            "evidence_refs": [{"evidence_id": "ev-bench-1", "public_url": "https://ev.bench.org", "temporal_status": "CURRENT", "is_context_artifact": False, "evidence_origin": "scan", "content_hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}],
            "provenance_chain": {"expectation_id": "e1", "observation_ids": ["o1"], "differential_id": "d1", "hypothesis_id": "h1", "verification_contract_id": "v1"},
            "contradictory_evidence_ids": [], "uncertainty": [], "benign_explanation": "",
            "authorization_context": {"requires_authorized_assessment": False},
            "decision_candidate": "SEAL_VERIFIED_FINDING",
            "policy_reference": "VARDHAN_CORE_INTELLIGENCE_POLICY_V1",
            "created_at": "2026-10-13T10:00:00Z",
            "evidence_earliest_retrieved_at": "2026-10-13T09:00:00Z",
            "evidence_latest_retrieved_at": "2026-10-13T09:30:00Z"
        },
        "actor_workload_id": "svc:vardhan-intelligence:perf-bench"
    }

def create_session():
    s, b, _ = api_request("POST", "/api/v1/auth/login", body={"username": ADMIN_USER, "password": ADMIN_PASS})
    if s != 200: return None, None, None
    token = b.get("token", "")
    s2, b2, token = api_request("POST", "/api/v1/organizations", token, {"name": f"Bench-{int(time.time()*1000)}"})
    org_id = b2.get("organization", {}).get("id", "")
    return token, org_id, b2

print("=== Creating 10 sessions ===")
sessions = []
for i in range(10):
    token, org_id, _ = create_session()
    sessions.append((token, org_id))
    print(f"  Session {i}: token={token[:20]}..., org={org_id}")

print("\n=== Running 5 concurrent requests with 5 sessions ===")
errors = []
def worker(worker_id):
    token, org_id = sessions[worker_id]
    contract = build_contract(finding_id=f"find-debug-c10-{worker_id}")
    s, b, new_token = api_request("POST", f"/api/v1/organizations/{org_id}/security/validate", token, contract)
    status = b.get("status", "")
    if status != "SEALED":
        errors.append(f"Worker {worker_id}: http={s}, status={status}, error={b.get('error','')}")
    return worker_id, s, status

with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
    futures = [executor.submit(worker, i) for i in range(10)]
    for f in concurrent.futures.as_completed(futures):
        wid, s, st = f.result()
        print(f"  Worker {wid}: http={s}, status={st}")

if errors:
    print(f"\nERRORS ({len(errors)}):")
    for e in errors:
        print(f"  {e}")
else:
    print("\nAll 10 succeeded!")
