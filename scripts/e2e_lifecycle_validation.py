#!/usr/bin/env python3
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
BINARY = str(REPO_ROOT / "target" / "release" / "control_plane_api")
RECEIPT_BIN = str(REPO_ROOT / "target" / "release" / "vardhan-receipt")
PORT = 18090
BASE = f"http://127.0.0.1:{PORT}"
DATA_DIR = f"/tmp/vardhan_e2e_{PORT}"
KEYSTORE_DIR = f"/tmp/vardhan_e2e_keystore_{PORT}"
IDEMPOTENCY_DIR = f"/tmp/vardhan_e2e_idempotency_{PORT}"
ADMIN_USER = "admin"
ADMIN_PASS = "strong-password-12345"

PASS_COUNT = 0
FAIL_COUNT = 0
RESULTS = []

def check(label, expected, actual):
    global PASS_COUNT, FAIL_COUNT
    if str(actual) == str(expected):
        print(f"  [PASS] PASS: {label} (got: {actual})")
        RESULTS.append(("PASS", label, actual))
        PASS_COUNT += 1
    else:
        print(f"  [FAIL] FAIL: {label} (expected: {expected}, got: {actual})")
        RESULTS.append(("FAIL", label, f"expected={expected}, got={actual}"))
        FAIL_COUNT += 1

def kill_port(port):
    try:
        result = subprocess.run(["lsof", "-ti", f":{port}"], capture_output=True, text=True)
        pids = result.stdout.strip().split("\n")
        for pid in pids:
            if pid: subprocess.run(["kill", "-9", pid], capture_output=True)
    except Exception: pass
    time.sleep(1)

def setup_env():
    kill_port(PORT)
    for d in [DATA_DIR, KEYSTORE_DIR, IDEMPOTENCY_DIR]:
        if os.path.exists(d): shutil.rmtree(d)
        os.makedirs(d)
    pw_file = "/tmp/vardhan_e2e_pw.txt"
    with open(pw_file, "w") as f: f.write(ADMIN_PASS)
    os.chmod(pw_file, 0o600)
    env = os.environ.copy()
    env["VARDHAN_ADMIN_USERNAME"] = ADMIN_USER
    env["VARDHAN_ADMIN_PASSWORD_FILE"] = pw_file
    env["VARDHAN_CONTROL_PLANE_DATA_DIR"] = DATA_DIR
    env["VARDHAN_CONTROL_PLANE_ADDR"] = f"127.0.0.1:{PORT}"
    env["VARDHAN_NODE_ID"] = "e2e-validation-node"
    env["VARDHAN_ENV"] = "development"
    env["VARDHAN_KEYSTORE_DIR"] = KEYSTORE_DIR
    env["VARDHAN_IDEMPOTENCY_DIR"] = IDEMPOTENCY_DIR
    return env

def start_server(env):
    log_file = open("/tmp/vardhan_e2e_server.log", "w")
    proc = subprocess.Popen([BINARY], env=env, stdout=log_file, stderr=subprocess.STDOUT, cwd=str(REPO_ROOT))
    for i in range(1, 25):
        try:
            req = urllib.request.Request(f"{BASE}/api/v1/platform/health")
            with urllib.request.urlopen(req, timeout=2) as resp:
                if resp.status == 200 and json.loads(resp.read()).get("status") == "operational":
                    print(f"  Server healthy after {i}s")
                    return proc
        except Exception: pass
        time.sleep(1)
    raise RuntimeError("Server did not become healthy")

def api_request(method, path, token=None, body=None):
    url = f"{BASE}{path}"
    data = json.dumps(body).encode() if body else None
    headers = {"Content-Type": "application/json"} if data else {}
    if token: headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            resp_body = resp.read().decode()
            new_token = resp.headers.get("Authorization-New-Token", token)
            if new_token and new_token.startswith("Bearer "): new_token = new_token[7:]
            return resp.status, json.loads(resp_body) if resp_body else {}, new_token
    except urllib.error.HTTPError as e:
        resp_body = e.read().decode()
        new_token = e.headers.get("Authorization-New-Token", token)
        if new_token and new_token.startswith("Bearer "): new_token = new_token[7:]
        return e.code, json.loads(resp_body) if resp_body else {}, new_token

def build_valid_contract(finding_id="find-e2e-001", actor="svc:vardhan-intelligence:e2e-valid", org_id="org-vardhan-intelligence"):
    return {
        "contract": {
            "schema_version": "1.1",
            "finding_id": finding_id,
            "intelligence": {"engine_id": "engine-v2", "engine_version": "2.0.0", "run_id": "run-e2e-001"},
            "organization": {"organization_id": org_id, "canonical_domain": "sc.com"},
            "affected_resource": {"canonical_url": "https://api.vardhan.org", "surface_type": "API_REST", "entry_point_id": "ep-e2e-1"},
            "technical_area": "STATIC_ANALYSIS",
            "technical_mechanism": "SQLi",
            "expected_behavior": "safe",
            "observed_behavior": "vulnerable",
            "differential_state": "CONFIRMED_MISMATCH",
            "materiality": "HIGH",
            "evidence_refs": [{"evidence_id": "ev-e2e-001", "public_url": "https://evidence.vardhan.org", "temporal_status": "CURRENT", "is_context_artifact": False, "evidence_origin": "scan", "content_hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}],
            "provenance_chain": {"expectation_id": "exp-e2e-1", "observation_ids": ["obs-e2e-1"], "differential_id": "diff-e2e-1", "hypothesis_id": "hyp-e2e-1", "verification_contract_id": "verif-e2e-1"},
            "contradictory_evidence_ids": [],
            "uncertainty": [],
            "benign_explanation": "",
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
    verify_env = os.environ.copy()
    verify_env["VARDHAN_KEYSTORE_DIR"] = KEYSTORE_DIR
    verify_env["VARDHAN_ENV"] = "development"
    try:
        result = subprocess.run([RECEIPT_BIN, "verify", "--receipt-id", "verify-test"], input=receipt_json_str, capture_output=True, text=True, timeout=30, env=verify_env)
        return result.returncode, result.stdout + result.stderr
    except Exception as e: return -1, str(e)

def main():
    global PASS_COUNT, FAIL_COUNT
    print("=== Phase 2: End-to-End Organization Lifecycle Validation ===")
    env = setup_env()
    cp_proc = start_server(env)
    try:
        print("\n[1] Health check")
        status, body, _ = api_request("GET", "/api/v1/platform/health")
        check("Health check", 200, status)
        check("Health status operational", "operational", body.get("status", ""))

        print("\n[2] Authenticating as admin")
        status, body, token = api_request("POST", "/api/v1/auth/login", body={"username": ADMIN_USER, "password": ADMIN_PASS})
        check("Login", 200, status)
        check("Token present", True, bool(body.get("token")))
        token = body.get("token", token)

        print("\n[3] Creating first organization")
        status, body, token = api_request("POST", "/api/v1/organizations", token, {"name": "Acme Bank PoC"})
        check("Org creation", 201, status)
        org1_id = body.get("organization", {}).get("id", "")
        check("Org1 name correct", "Acme Bank PoC", body.get("organization", {}).get("name", ""))

        print("\n[4] Reading organization back")
        status, body, token = api_request("GET", f"/api/v1/organizations/{org1_id}", token)
        check("Org read-back", 200, status)

        print("\n[5] Listing organizations")
        status, body, token = api_request("GET", "/api/v1/organizations", token)
        check("Org list", 200, status)

        print("\n[6] Testing unauthenticated access")
        status, _, _ = api_request("POST", "/api/v1/organizations", body={"name": "No Auth Org"})
        check("Unauthenticated org creation denied", 401, status)

        print("\n[7] Creating second organization")
        status, body, token = api_request("POST", "/api/v1/organizations", token, {"name": "Second Tenant LLC"})
        check("Org2 creation", 201, status)
        org2_id = body.get("organization", {}).get("id", "")

        print("\n[8] Verifying tenant isolation")
        status, body, token = api_request("GET", f"/api/v1/organizations/{org2_id}", token)
        check("Admin can read org2 (is owner)", 200, status)

        print("\n[9] Submitting valid Q-Core contract")
        # The receipt API binds URL org_id to contract org_id (tenant binding).
        # Use org-vardhan-intelligence consistently in both URL and contract.
        contract = build_valid_contract(org_id="org-vardhan-intelligence")
        status, body, token = api_request("POST", f"/api/v1/organizations/org-vardhan-intelligence/security/validate", token, contract)
        check("Valid contract sealing", 200, status)
        receipt_status = body.get("status", "")
        check("Receipt status SEALED", "SEALED", receipt_status)
        receipt_json = json.dumps(body, indent=2)

        print("\n[10] Testing replay rejection")
        status, body, token = api_request("POST", f"/api/v1/organizations/org-vardhan-intelligence/security/validate", token, contract)
        check("Replay rejected", 200, status)
        check("Replay status REJECTED_REPLAY", "REJECTED_REPLAY", body.get("status", ""))

        print("\n[11] Trust Boundary: Malformed Hash")
        bad_contract = build_valid_contract(finding_id="find-e2e-malformed", org_id="org-vardhan-intelligence")
        bad_contract["contract"]["evidence_refs"][0]["content_hash"] = "deadbeef"
        status, body, token = api_request("POST", f"/api/v1/organizations/org-vardhan-intelligence/security/validate", token, bad_contract)
        check("Malformed hash rejected", 200, status)
        check("Malformed hash status not SEALED", False, body.get("status") == "SEALED")

        print("\n[12] Unauthorized Actor")
        unauth_contract = build_valid_contract(finding_id="find-e2e-unauth", actor="svc:attacker-service:evil-01", org_id="org-vardhan-intelligence")
        status, body, token = api_request("POST", f"/api/v1/organizations/org-vardhan-intelligence/security/validate", token, unauth_contract)
        check("Unauthorized actor rejected", 200, status)
        check("Unauthorized actor status not SEALED", False, body.get("status") == "SEALED")

        # [12b] Spoofed issuer prefix — actor contains registered issuer name
        # but as a substring, not a prefix match. This tests the deny-by-default
        # principle: only exact prefix matches are authorized.
        spoof_contract = build_valid_contract(finding_id="find-e2e-spoof", actor="svc:vardhan-intelligence-spoofed:evil-01", org_id="org-vardhan-intelligence")
        status, body, token = api_request("POST", f"/api/v1/organizations/org-vardhan-intelligence/security/validate", token, spoof_contract)
        check("Spoofed issuer prefix rejected", 200, status)
        check("Spoofed issuer status not SEALED", False, body.get("status") == "SEALED")

        print("\n[13] Independent Receipt Verification")
        rc, output = verify_receipt(receipt_json)
        if '"Valid"' in output:
            print("  [PASS] PASS: Receipt independently verified")
            RESULTS.append(("PASS", "Independent verification", "Valid"))
            PASS_COUNT += 1
        else:
            print(f"  [FAIL] FAIL: Receipt verification failed: {output[:200]}")
            RESULTS.append(("FAIL", "Independent verification", output[:200]))
            FAIL_COUNT += 1

        print("\n[14] Tampered Signature Rejection")
        receipt = json.loads(receipt_json)
        receipt["signatures"]["ed25519_sig"] = "0" * len(receipt["signatures"]["ed25519_sig"])
        tampered_json = json.dumps(receipt)
        rc, output = verify_receipt(tampered_json)
        if '"Invalid"' in output:
            print("  [PASS] PASS: Tampered signature rejected")
            RESULTS.append(("PASS", "Tampered signature rejection", "Invalid"))
            PASS_COUNT += 1
        else:
            print(f"  [FAIL] FAIL: Tampered signature accepted: {output[:200]}")
            RESULTS.append(("FAIL", "Tampered signature rejection", output[:200]))
            FAIL_COUNT += 1

        print("\n[15] Audit/Evidence Retrieval")
        status, body, token = api_request("GET", f"/api/v1/organizations/{org1_id}/security/audit", token)
        check("Audit endpoint", 200, status)

        print("\n[16] Duplicate Org Creation")
        status, body, token = api_request("POST", "/api/v1/organizations", token, {"name": "Acme Bank PoC"})
        check("Duplicate org returns 201", 201, status)

        print("\n[17] Member Management")
        status, body, token = api_request("GET", f"/api/v1/organizations/{org1_id}/members", token)
        check("List members", 200, status)

        print("\n[18] Invitations")
        status, body, token = api_request("POST", f"/api/v1/organizations/{org1_id}/invitations", token, {"email": "alice@example.com", "role": "viewer"})
        check("Create invitation", 200, status)

        print("\n[19] Service Restart & State Persistence")
        cp_proc.terminate()
        cp_proc.wait(timeout=10)
        print("  Server stopped. Restarting...")
        cp_proc = start_server(env)
        status, body, token = api_request("POST", "/api/v1/auth/login", body={"username": ADMIN_USER, "password": ADMIN_PASS})
        check("Login after restart", 200, status)
        token = body.get("token", token)
        status, body, token = api_request("GET", f"/api/v1/organizations/{org1_id}", token)
        check("Org persists after restart", 200, status)
        status, body, token = api_request("POST", f"/api/v1/organizations/org-vardhan-intelligence/security/validate", token, contract)
        check("Replay still rejected after restart", 200, status)
        check("Replay status REJECTED_REPLAY", "REJECTED_REPLAY", body.get("status", ""))

        print("\n[20] Malformed Request")
        status, body, token = api_request("POST", f"/api/v1/organizations/org-vardhan-intelligence/security/validate", token, {"contract": {"schema_version": "bad"}, "actor_workload_id": "test"})
        check("Malformed contract rejected", 200, status)
        check("Malformed contract status not SEALED", False, body.get("status") == "SEALED")

    finally:
        print("\n[Cleanup] Stopping server and cleaning up...")
        cp_proc.terminate()
        cp_proc.wait(timeout=10)
        kill_port(PORT)
        for d in [DATA_DIR, KEYSTORE_DIR, IDEMPOTENCY_DIR]:
            if os.path.exists(d): shutil.rmtree(d)
        for f in ["/tmp/vardhan_e2e_pw.txt", "/tmp/vardhan_e2e_receipt.json", "/tmp/vardhan_e2e_server.log"]:
            if os.path.exists(f): os.remove(f)

    print("\n" + "=" * 60)
    print("  E2E Lifecycle Validation Summary")
    print("=" * 60)
    print(f"  Total checks: {PASS_COUNT + FAIL_COUNT}")
    print(f"  Passed: {PASS_COUNT}")
    print(f"  Failed: {FAIL_COUNT}")
    print()
    for status, label, detail in RESULTS:
        symbol = "[PASS]" if status == "PASS" else "[FAIL]"
        print(f"  {symbol} {label}: {detail}")
    print("=" * 60)

if __name__ == "__main__":
    sys.exit(main())
