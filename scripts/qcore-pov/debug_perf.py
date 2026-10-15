import json, urllib.request, urllib.error

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
        with urllib.request.urlopen(req, timeout=15) as resp:
            resp_body = resp.read().decode()
            new_token = resp.headers.get("Authorization-New-Token")
            if new_token and new_token.startswith("Bearer "): new_token = new_token[7:]
            else: new_token = token
            return resp.status, json.loads(resp_body), new_token
    except urllib.error.HTTPError as e:
        resp_body = e.read().decode()
        return e.code, {"error": resp_body[:200]}, token
    except Exception as e:
        return 0, {"error": str(e)}, token

# Login
s, b, _ = api_request("POST", "/api/v1/auth/login", body={"username": ADMIN_USER, "password": ADMIN_PASS})
token = b.get("token", "")
print(f"Login: {s}, token={token[:20]}...")

# Create org
s, b, token = api_request("POST", "/api/v1/organizations", token, {"name": "Debug Perf"})
org_id = b.get("organization", {}).get("id", "")
print(f"Org: {s}, id={org_id}")

# Submit contract
contract = {
    "contract": {
        "schema_version": "1.1",
        "finding_id": "find-perf-debug-001",
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
s, b, new_token = api_request("POST", f"/api/v1/organizations/{org_id}/security/validate", token, contract)
print(f"Contract: http={s}, status={b.get('status')}, error={b.get('error','')}")
print(f"Keys: {list(b.keys())[:10]}")
