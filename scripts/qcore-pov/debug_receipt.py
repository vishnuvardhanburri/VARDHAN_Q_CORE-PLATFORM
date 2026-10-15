#!/usr/bin/env python3
import json, urllib.request, urllib.error, os, copy

HOST = "http://localhost:8080"

def api_request(method, path, token=None, body=None):
    url = f"{HOST}{path}"
    data = json.dumps(body).encode() if body else None
    headers = {}
    if data:
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            resp_body = resp.read().decode()
            new_token = resp.headers.get("Authorization-New-Token")
            if new_token and new_token.startswith("Bearer "):
                new_token = new_token[7:]
            else:
                new_token = token
            return resp.status, json.loads(resp_body), new_token
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

# Login - extract token from body
s, b, token = api_request("POST", "/api/v1/auth/login", body={"username": "admin", "password": "P0V-Str0ng-P@ssw0rd-2025!"})
print(f"Login: {s}, body={b}")
# Extract token from body
body_token = b.get("token", "")
if body_token:
    token = body_token
print(f"Token: {token[:20]}...")

# Create org
s, b, token = api_request("POST", "/api/v1/organizations", token, {"name": "Debug"})
org_id = b.get("organization", {}).get("id", "")
print(f"Org: {s}, id={org_id}")
if s != 201:
    print(f"Org error: {b}")

# Submit contract
contract = json.load(open("/app/contracts/financial_finding_contract.json"))
contract["contract"]["finding_id"] = "find-debug-001"
s, b, token = api_request("POST", f"/api/v1/organizations/{org_id}/security/validate", token, contract)
print(f"Contract: http_status={s}, status_field={b.get('status', '')}")
print(f"Top-level keys: {list(b.keys())}")

# Inspect structure
for k, v in b.items():
    if k == "receipts" and isinstance(v, dict):
        print(f"receipts: dict with keys {list(v.keys())}")
        if "signatures" in v:
            print(f"  receipts.signatures: {list(v['signatures'].keys()) if isinstance(v['signatures'], dict) else type(v['signatures'])}")
    elif k == "signatures" and isinstance(v, dict):
        print(f"signatures: {list(v.keys())}")
    elif isinstance(v, str) and len(v) < 100:
        print(f"{k}: {v}")
    elif isinstance(v, str):
        print(f"{k}: (len={len(v)})")

# Tampered hash test
tampered = copy.deepcopy(contract)
tampered["contract"]["finding_id"] = "find-debug-tamper"
tampered["contract"]["evidence_refs"][0]["content_hash"] = "deadbeef" * 8
s, b, token = api_request("POST", f"/api/v1/organizations/{org_id}/security/validate", token, tampered)
print(f"\nTampered: http_status={s}, status_field={b.get('status', '')}")
for k, v in b.items():
    if isinstance(v, str) and len(v) < 200:
        print(f"  {k}: {v}")
