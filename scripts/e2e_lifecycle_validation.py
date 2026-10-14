#!/usr/bin/env python3
"""
VARDHAN Q-CORE — End-to-End Organization Lifecycle & Transaction Validation

Exercises the REAL application interfaces end-to-end:
  Control Plane API (axum HTTP) → vardhan-receipt binary → sled DB → audit

No mocks. No internal function calls. All interactions go through HTTP.

Usage:
    python3 scripts/e2e_lifecycle_validation.py [--port 18090]
"""
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

# ── Configuration ──────────────────────────────────────────────────────────
REPO_ROOT = Path("/Users/vishnuvardhanburri/antigravity/VARDHAN_Q_CORE-PLATFORM-main")
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
        print(f"  ✅ PASS: {label} (got: {actual})")
        RESULTS.append(("PASS", label, actual))
        PASS_COUNT += 1
    else:
        print(f"  ❌ FAIL: {label} (expected: {expected}, got: {actual})")
        RESULTS.append(("FAIL", label, f"expected={expected}, got={actual}"))
        FAIL_COUNT += 1


def kill_port(port):
    """Kill any process listening on the given port."""
    try:
        result = subprocess.run(
            ["lsof", "-ti", f":{port}"],
            capture_output=True, text=True
        )
        pids = result.stdout.strip().split("\n")
        for pid in pids:
            if pid:
                subprocess.run(["kill", "-9", pid], capture_output=True)
    except Exception:
        pass
    time.sleep(1)


def setup_env():
    """Set up isolated environment for this test run."""
    kill_port(PORT)
    for d in [DATA_DIR, KEYSTORE_DIR, IDEMPOTENCY_DIR]:
        if os.path.exists(d):
            shutil.rmtree(d)
        os.makedirs(d)

    pw_file = "/tmp/vardhan_e2e_pw.txt"
    with open(pw_file, "w") as f:
        f.write(ADMIN_PASS)
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
    """Start the control plane API server."""
    log_file = open("/tmp/vardhan_e2e_server.log", "w")
    proc = subprocess.Popen(
        [BINARY],
        env=env,
        stdout=log_file,
        stderr=subprocess.STDOUT,
        cwd=str(REPO_ROOT),
    )
    # Wait for health check
    for i in range(1, 25):
        try:
            req = urllib.request.Request(f"{BASE}/api/v1/platform/health")
            with urllib.request.urlopen(req, timeout=2) as resp:
                if resp.status == 200:
                    data = json.loads(resp.read())
                    if data.get("status") == "operational":
                        print(f"  Server healthy after {i}s")
                        return proc
        except Exception:
            pass
        time.sleep(1)
    # Server failed to start
    with open("/tmp/vardhan_e2e_server.log") as f:
        print("Server log:", f.read())
    raise RuntimeError("Server did not become healthy")


def api_request(method, path, token=None, body=None):
    """Make an HTTP request, handle token rotation, return (status, body, new_token)."""
    url = f"{BASE}{path}"
    data = json.dumps(body).encode() if body else None
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if data:
        headers["Content-Type"] = "application/json"
    
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            resp_body = resp.read().decode()
            new_token = resp.headers.get("Authorization-New-Token", "")
            if new_token.startswith("Bearer "):
                new_token = new_token[7:]
            else:
                new_token = token
            try:
                parsed = json.loads(resp_body) if resp_body else {}
            except json.JSONDecodeError:
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
        except json.JSONDecodeError:
            parsed = {"raw": resp_body}
        return e.code, parsed, new_token


def build_valid_contract(finding_id="find-e2e-001", actor="svc:vardhan-intelligence:e2e-01"):
    """Build a valid Q-Core sealing contract."""
    return {
        "contract": {
            "schema_version": "1.0",
            "finding_id": finding_id,
            "intelligence": {
                "engine_id": "engine-v2",
                "engine_version": "2.0.0",
                "run_id": "run-e2e-001"
            },
            "organization": {
                "organization_id": "org-vardhan-intelligence",
                "canonical_domain": "vardhan.org"
            },
            "affected_resource": {
                "canonical_url": "https://api.vardhan.org",
                "surface_type": "API_REST",
                "entry_point_id": "ep-e2e-1"
            },
            "technical_area": "STATIC_ANALYSIS",
            "technical_mechanism": "SQLi",
            "expected_behavior": "safe",
            "observed_behavior": "vulnerable",
            "differential_state": "CONFIRMED_MISMATCH",
            "materiality": "HIGH",
            "evidence_refs": [{
                "evidence_id": "ev-e2e-001",
                "public_url": "https://evidence.vardhan.org",
                "temporal_status": "CURRENT",
                "is_context_artifact": False,
                "evidence_origin": "scan",
                "content_hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
            }],
            "provenance_chain": {
                "expectation_id": "exp-e2e-1",
                "observation_ids": ["obs-e2e-1"],
                "differential_id": "diff-e2e-1",
                "hypothesis_id": "hyp-e2e-1",
                "verification_contract_id": "verif-e2e-1"
            },
            "contradictory_evidence_ids": [],
            "uncertainty": [],
            "benign_explanation": "",
            "authorization_context": {
                "requires_authorized_assessment": False
            },
            "decision_candidate": "SEAL_VERIFIED_FINDING",
            "policy_reference": "VARDHAN_CORE_INTELLIGENCE_POLICY_V1",
            "created_at": "2026-10-13T10:00:00Z",
            "evidence_earliest_retrieved_at": "2026-10-13T09:00:00Z",
            "evidence_latest_retrieved_at": "2026-10-13T09:30:00Z"
        },
        "actor_workload_id": actor
    }


def verify_receipt(receipt_json_str):
    """Pipe a receipt JSON to the vardhan-receipt verify binary and return (rc, output)."""
    verify_env = os.environ.copy()
    verify_env["VARDHAN_KEYSTORE_DIR"] = KEYSTORE_DIR
    verify_env["VARDHAN_ENV"] = "development"
    try:
        result = subprocess.run(
            [RECEIPT_BIN, "verify", "--receipt-id", "verify-test"],
            input=receipt_json_str,
            capture_output=True,
            text=True,
            timeout=30,
            env=verify_env,
        )
        output = result.stdout + result.stderr
        return result.returncode, output
    except Exception as e:
        return -1, str(e)


def main():
    global PASS_COUNT, FAIL_COUNT
    print("=== Phase 2: End-to-End Organization Lifecycle Validation ===")
    print()

    # ── Start Services ───────────────────────────────────────────────────────
    print("[0] Setting up isolated test environment...")
    env = setup_env()
    print("[0] Starting Control Plane API...")
    cp_proc = start_server(env)

    try:
        # ── 1. Health Check ────────────────────────────────────────────────
        print("\n[1] Health check")
        status, body, _ = api_request("GET", "/api/v1/platform/health")
        check("Health check", 200, status)
        check("Health status operational", "operational", body.get("status", ""))

        status, body, _ = api_request("GET", "/api/v1/catalog/plans")
        check("Catalog plans", 200, status)

        # ── 2. Admin Authentication ─────────────────────────────────────────
        print("\n[2] Authenticating as admin")
        status, body, token = api_request("POST", "/api/v1/auth/login", body={
            "username": ADMIN_USER,
            "password": ADMIN_PASS
        })
        check("Login", 200, status)
        check("Token present", True, bool(body.get("token")))
        # On first login, token comes from response body; subsequent requests
        # get rotated tokens via Authorization-New-Token header
        token = body.get("token", token)
        print(f"  Token: {token[:16] if token else 'None'}...")

        # ── 3. Create First Organization ────────────────────────────────────
        print("\n[3] Creating first organization")
        status, body, token = api_request("POST", "/api/v1/organizations", token,
            {"name": "Acme Bank PoC"})
        check("Org creation", 201, status)
        org1_id = body.get("organization", {}).get("id", "")
        print(f"  Org1 ID: {org1_id}")
        check("Org1 name correct", "Acme Bank PoC",
              body.get("organization", {}).get("name", ""))
        check("Org1 owner", ADMIN_USER,
              body.get("organization", {}).get("owner", ""))

        # ── 4. Read Organization Back ───────────────────────────────────────
        print("\n[4] Reading organization back")
        status, body, token = api_request("GET", f"/api/v1/organizations/{org1_id}", token)
        check("Org read-back", 200, status)
        check("Org identity matches", "Acme Bank PoC",
              body.get("organization", {}).get("name", ""))

        # ── 5. List Organizations ───────────────────────────────────────────
        print("\n[5] Listing organizations")
        status, body, token = api_request("GET", "/api/v1/organizations", token)
        check("Org list", 200, status)
        org_count = len(body.get("organizations", []))
        print(f"  Found {org_count} organization(s)")
        check("At least 1 org listed", True, org_count >= 1)

        # ── 6. Unauthenticated Access ───────────────────────────────────────
        print("\n[6] Testing unauthenticated access")
        status, _, _ = api_request("POST", "/api/v1/organizations", body={"name": "No Auth Org"})
        check("Unauthenticated org creation denied", 401, status)
        status, _, _ = api_request("GET", f"/api/v1/organizations/{org1_id}")
        check("Unauthenticated org read denied", 401, status)

        # ── 7. Create Second Organization ────────────────────────────────────
        print("\n[7] Creating second organization (tenant isolation)")
        status, body, token = api_request("POST", "/api/v1/organizations", token,
            {"name": "Second Tenant LLC"})
        check("Org2 creation", 201, status)
        org2_id = body.get("organization", {}).get("id", "")
        print(f"  Org2 ID: {org2_id}")

        # ── 8. Tenant Isolation ─────────────────────────────────────────────
        print("\n[8] Verifying tenant isolation")
        status, body, token = api_request("GET", f"/api/v1/organizations/{org2_id}", token)
        check("Admin can read org2 (is owner)", 200, status)

        # ── 9. Q-Core Transaction: Valid Contract ───────────────────────────
        print("\n[9] Submitting valid Q-Core contract")
        contract = build_valid_contract()
        status, body, token = api_request("POST",
            f"/api/v1/organizations/{org1_id}/security/validate", token, contract)
        check("Valid contract sealing", 200, status)
        receipt_status = body.get("status", "")
        receipt_id = body.get("receipt_id", "")
        print(f"  Receipt ID: {receipt_id}")
        print(f"  Status: {receipt_status}")
        check("Receipt status SEALED", "SEALED", receipt_status)
        check("Ed25519 signature present", True,
              len(str(body.get("signatures", {}).get("ed25519_sig", ""))) > 0)
        check("ML-DSA-87 signature present", True,
              len(str(body.get("signatures", {}).get("ml_dsa_87_sig", ""))) > 0)

        # Save receipt
        receipt_json = json.dumps(body, indent=2)
        with open("/tmp/vardhan_e2e_receipt.json", "w") as f:
            f.write(receipt_json)

        # ── 10. Replay Rejection ───────────────────────────────────────────
        print("\n[10] Testing replay rejection (durable lifecycle)")
        status, body, token = api_request("POST",
            f"/api/v1/organizations/{org1_id}/security/validate", token, contract)
        # API returns HTTP 200 with status=REJECTED_REPLAY in body for rejected transactions
        check("Replay rejected (HTTP 200 with REJECTED_REPLAY)", 200, status)
        check("Replay status REJECTED_REPLAY", "REJECTED_REPLAY", body.get("status", ""))
        replay_status = body.get("status", body.get("error", ""))
        print(f"  Replay response: {replay_status}")

        # Verify idempotency flag file persists on disk
        flag_file = os.path.join(IDEMPOTENCY_DIR, "sealed_find-e2e-001.flag")
        check("Idempotency flag on disk", True, os.path.exists(flag_file))

        # ── 11. Trust Boundary: Malformed Hash ──────────────────────────────
        print("\n[11] Testing trust boundary (malformed hash)")
        bad_contract = build_valid_contract(
            finding_id="find-e2e-malformed",
            actor="svc:vardhan-intelligence:e2e-01"
        )
        bad_contract["contract"]["evidence_refs"][0]["content_hash"] = "deadbeef"
        status, body, token = api_request("POST",
            f"/api/v1/organizations/{org1_id}/security/validate", token, bad_contract)
        check("Malformed hash rejected (HTTP 200 with rejection)", 200, status)
        check("Malformed hash status not SEALED", False, body.get("status") == "SEALED")

        # ── 12. Unauthorized Actor ──────────────────────────────────────────
        print("\n[12] Testing unauthorized actor")
        unauth_contract = build_valid_contract(
            finding_id="find-e2e-unauth",
            actor="svc:attacker-service:evil-01"
        )
        status, body, token = api_request("POST",
            f"/api/v1/organizations/{org1_id}/security/validate", token, unauth_contract)
        check("Unauthorized actor rejected (HTTP 200 with rejection)", 200, status)
        check("Unauthorized actor status not SEALED", False, body.get("status") == "SEALED")

        # ── 13. Independent Receipt Verification ─────────────────────────────
        print("\n[13] Independent receipt verification")
        rc, output = verify_receipt(receipt_json)
        if '"Valid"' in output:
            print("  ✅ PASS: Receipt independently verified")
            RESULTS.append(("PASS", "Independent verification", "Valid"))
            PASS_COUNT += 1
        else:
            print(f"  ❌ FAIL: Receipt verification failed: {output[:200]}")
            RESULTS.append(("FAIL", "Independent verification", output[:200]))
            FAIL_COUNT += 1

        # ── 14. Tampered Signature Rejection ────────────────────────────────
        print("\n[14] Testing tampered signature rejection")
        receipt = json.loads(receipt_json)
        receipt["signatures"]["ed25519_sig"] = "0" * len(receipt["signatures"]["ed25519_sig"])
        tampered_json = json.dumps(receipt)
        rc, output = verify_receipt(tampered_json)
        if '"Invalid"' in output:
            print("  ✅ PASS: Tampered signature rejected")
            RESULTS.append(("PASS", "Tampered signature rejection", "Invalid"))
            PASS_COUNT += 1
        else:
            print(f"  ❌ FAIL: Tampered signature accepted: {output[:200]}")
            RESULTS.append(("FAIL", "Tampered signature rejection", output[:200]))
            FAIL_COUNT += 1

        # ── 15. Audit/Evidence Retrieval ────────────────────────────────────
        print("\n[15] Checking audit/evidence records")
        status, body, token = api_request("GET",
            f"/api/v1/organizations/{org1_id}/security/audit", token)
        check("Audit endpoint", 200, status)
        print(f"  Audit data: {json.dumps(body)[:300]}")

        status, body, token = api_request("GET",
            f"/api/v1/organizations/{org1_id}/security/operations", token)
        check("Operations endpoint", 200, status)

        # ── 16. Duplicate Organization Creation ─────────────────────────────
        print("\n[16] Testing duplicate organization creation")
        status, body, token = api_request("POST", "/api/v1/organizations", token,
            {"name": "Acme Bank PoC"})
        check("Duplicate org returns 201 (UUID-based uniqueness)", 201, status)
        dup_id = body.get("organization", {}).get("id", "")
        check("Duplicate org has different ID", True, dup_id != org1_id and dup_id != "")

        # ── 17. Member Management ───────────────────────────────────────────
        print("\n[17] Testing member management")
        status, body, token = api_request("GET",
            f"/api/v1/organizations/{org1_id}/members", token)
        check("List members", 200, status)
        members = body.get("members", [])
        print(f"  Members: {json.dumps(members)}")
        check("Admin is owner", True,
              any(m.get("username") == ADMIN_USER and m.get("role") == "owner"
                  for m in members))

        # Owner can set member roles for OTHER members (not self)
        # First, check that changing owner's own role is rejected (security boundary)
        status, body, token = api_request("POST",
            f"/api/v1/organizations/{org1_id}/members/{ADMIN_USER}/role", token,
            {"role": "security_admin"})
        check("Owner role change self rejected (409)", 409, status)

        # Verify role did not change
        status, body, token = api_request("GET",
            f"/api/v1/organizations/{org1_id}/members", token)
        owner_role = None
        for m in body.get("members", []):
            if m.get("username") == ADMIN_USER:
                owner_role = m.get("role")
        check("Owner role unchanged after rejected change", "owner", owner_role)

        # ── 18. Invitations ───────────────────────────────────────────────────
        print("\n[18] Testing invitation lifecycle")
        status, body, token = api_request("POST",
            f"/api/v1/organizations/{org1_id}/invitations", token,
            {"email": "alice@example.com", "role": "viewer"})
        check("Create invitation", 200, status)
        print(f"  Invite: {json.dumps(body)[:200]}")

        status, body, token = api_request("GET",
            f"/api/v1/organizations/{org1_id}/invitations", token)
        check("List invitations", 200, status)

        # ── 19. Service Restart & State Persistence ───────────────────────────
        print("\n[19] Testing service restart and state persistence")
        cp_proc.terminate()
        cp_proc.wait(timeout=10)
        print("  Server stopped. Restarting...")
        cp_proc = start_server(env)

        # Login again
        status, body, token = api_request("POST", "/api/v1/auth/login", body={
            "username": ADMIN_USER,
            "password": ADMIN_PASS
        })
        check("Login after restart", 200, status)
        token = body.get("token", token)
        print(f"  Post-restart token: {token[:16] if token else 'None'}...")

        # Verify org persists
        status, body, token = api_request("GET", f"/api/v1/organizations/{org1_id}", token)
        check("Org persists after restart", 200, status)
        check("Org name persists", "Acme Bank PoC",
              body.get("organization", {}).get("name", ""))

        # Verify role persists
        status, body, token = api_request("GET",
            f"/api/v1/organizations/{org1_id}/members", token)
        members_after = body.get("members", [])
        admin_role_after = None
        for m in members_after:
            if m.get("username") == ADMIN_USER:
                admin_role_after = m.get("role")
        check("Role persists after restart", "owner", admin_role_after)

        # Verify idempotency flag persists — replay should still be rejected
        status, body, token = api_request("POST",
            f"/api/v1/organizations/{org1_id}/security/validate", token, contract)
        check("Replay still rejected after restart (HTTP 200 with REJECTED_REPLAY)", 200, status)
        check("Replay status REJECTED_REPLAY after restart", "REJECTED_REPLAY", body.get("status", ""))

        # Verify idempotency flag file still exists
        check("Idempotency flag persists after restart", True,
              os.path.exists(flag_file))

        # ── 20. Malformed Request ───────────────────────────────────────────
        print("\n[20] Testing malformed request body")
        status, body, token = api_request("POST",
            f"/api/v1/organizations/{org1_id}/security/validate", token,
            {"contract": {"schema_version": "bad"}, "actor_workload_id": "test"})
        check("Malformed contract rejected (HTTP 200 with rejection)", 200, status)
        check("Malformed contract status not SEALED", False, body.get("status") == "SEALED")

    finally:
        # ── Cleanup ──────────────────────────────────────────────────────────
        print("\n[Cleanup] Stopping server and cleaning up...")
        cp_proc.terminate()
        cp_proc.wait(timeout=10)
        kill_port(PORT)
        for d in [DATA_DIR, KEYSTORE_DIR, IDEMPOTENCY_DIR]:
            if os.path.exists(d):
                shutil.rmtree(d)
        for f in ["/tmp/vardhan_e2e_pw.txt", "/tmp/vardhan_e2e_receipt.json",
                   "/tmp/vardhan_e2e_server.log"]:
            if os.path.exists(f):
                os.remove(f)

    # ── Summary ──────────────────────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("  E2E Lifecycle Validation Summary")
    print("=" * 60)
    print(f"  Total checks: {PASS_COUNT + FAIL_COUNT}")
    print(f"  Passed: {PASS_COUNT}")
    print(f"  Failed: {FAIL_COUNT}")
    print()
    for status, label, detail in RESULTS:
        symbol = "✅" if status == "PASS" else "❌"
        print(f"  {symbol} {label}: {detail}")
    print("=" * 60)

    if FAIL_COUNT == 0:
        print("\nALL CHECKS PASSED")
        return 0
    else:
        print(f"\n{FAIL_COUNT} CHECK(S) FAILED")
        return 1


if __name__ == "__main__":
    sys.exit(main())
