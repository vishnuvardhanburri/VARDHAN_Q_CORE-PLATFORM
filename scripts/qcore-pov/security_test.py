#!/usr/bin/env python3
"""
VARDHAN Q-CORE — Security Test Matrix (PoV)

Runs the security attack matrix test suite against the Q-Core control plane.
Handles token rotation (Authorization-New-Token header) per Phase 8a spec.
"""
import json
import os
import sys
import time
import subprocess
import urllib.request
import urllib.error
import concurrent.futures

HOST = os.environ.get("QCORE_HOST", "http://localhost:8080")
ADMIN_USER = "admin"
ADMIN_PASS = "P0V-Str0ng-P@ssw0rd-2025!"

PASS_COUNT = 0
FAIL_COUNT = 0
RESULTS = []

RECEIPT_BIN = os.environ.get("VARDHAN_RECEIPT_ENGINE_BIN", "vardhan-receipt")

def check(label, expected, actual):
    global PASS_COUNT, FAIL_COUNT
    passed = str(actual) == str(expected)
    status = "PASS" if passed else "FAIL"
    if passed:
        PASS_COUNT += 1
        symbol = "✅"
    else:
        FAIL_COUNT += 1
        symbol = "❌"
    detail = f"expected={expected}, got={actual}"
    RESULTS.append({"status": status, "test": label, "detail": detail})
    print(f"  {symbol} {status}: {label} ({detail})")

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
        with urllib.request.urlopen(req, timeout=15) as resp:
            resp_body = resp.read().decode()
            new_token = token
            # Check for rotated token
            auth_header = resp.headers.get("Authorization-New-Token", "")
            if auth_header.startswith("Bearer "):
                new_token = auth_header[7:]
            try:
                body_json = json.loads(resp_body) if resp_body else {}
            except:
                body_json = {}
            return resp.status, body_json, new_token
    except urllib.error.HTTPError as e:
        resp_body = e.read().decode()
        new_token = token
        auth_header = e.headers.get("Authorization-New-Token", "")
        if auth_header.startswith("Bearer "):
            new_token = auth_header[7:]
        try:
            body_json = json.loads(resp_body) if resp_body else {}
        except:
            body_json = {}
        return e.code, body_json, new_token
    except Exception as e:
        return 0, {"error": str(e)}, token

def build_contract(finding_id="find-pov-001", actor="svc:vardhan-intelligence:financial-pov", 
                   org_id="org-vardhan-intelligence", hash_override=None):
    """Build a standard Q-Core contract for testing."""
    base_hash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    contract = {
        "contract": {
            "schema_version": "1.1",
            "finding_id": finding_id,
            "intelligence": {
                "engine_id": "financial-anti-fraud-v2",
                "engine_version": "2.0.0",
                "run_id": "run-pov-001"
            },
            "organization": {
                "organization_id": org_id,
                "canonical_domain": "synthetic-bank.invalid"
            },
            "affected_resource": {
                "canonical_url": "https://api.synthetic-bank.invalid/security",
                "surface_type": "API_REST",
                "entry_point_id": "ep-financial-01"
            },
            "technical_area": "STATIC_ANALYSIS",
            "technical_mechanism": "SQLi",
            "expected_behavior": "safe",
            "observed_behavior": "vulnerable",
            "differential_state": "CONFIRMED_MISMATCH",
            "materiality": "HIGH",
            "evidence_refs": [{
                "evidence_id": "ev-pov-001",
                "public_url": "https://evidence.synthetic-bank.invalid",
                "temporal_status": "CURRENT",
                "is_context_artifact": False,
                "evidence_origin": "scan",
                "content_hash": hash_override if hash_override else base_hash
            }],
            "provenance_chain": {
                "expectation_id": "exp-pov-1",
                "observation_ids": ["obs-pov-1"],
                "differential_id": "diff-pov-1",
                "hypothesis_id": "hyp-pov-1",
                "verification_contract_id": "verif-pov-1"
            },
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
    return contract

def verify_receipt(receipt_json_str, receipt_id="verify-pov"):
    """Run vardhan-receipt verify independently."""
    env = os.environ.copy()
    env["VARDHAN_ENV"] = "development"
    try:
        result = subprocess.run(
            [RECEIPT_BIN, "verify", "--receipt-id", receipt_id],
            input=receipt_json_str, capture_output=True, text=True, env=env, timeout=30
        )
        output = result.stdout + result.stderr
        return result.returncode, output
    except Exception as e:
        return -1, str(e)

def main():
    global PASS_COUNT, FAIL_COUNT
    
    print("=" * 60)
    print("  VARDHAN Q-CORE — Security Test Matrix (PoV)")
    print("=" * 60)
    
    # ── Setup: Login ──────────────────────────────────────────────
    print("\n[Setup] Logging in as admin...")
    status, body, _ = api_request("POST", "/api/v1/auth/login", body={"username": ADMIN_USER, "password": ADMIN_PASS})
    check("Login succeeds", 200, status)
    check("Token present", True, bool(body.get("token", "")))
    token = body.get("token", "")
    
    # ── Create organization ──────────────────────────────────────
    print("\n[Setup] Creating organization...")
    status, body, token = api_request("POST", "/api/v1/organizations", token, 
                                      {"name": "Synthetic Financial Services PoV Tenant"})
    check("Org creation", 201, status)
    org_id = body.get("organization", {}).get("id", "")
    check("Org ID present", True, bool(org_id))
    
    # ── Security Tests ───────────────────────────────────────────
    
    # S1: Valid contract sealing
    print("\n--- S1: Valid Contract Sealing ---")
    contract = build_contract(finding_id="find-pov-s1")
    status, body, token = api_request("POST", f"/api/v1/organizations/{org_id}/security/validate", 
                                      token, contract)
    check("S1: Valid contract returns 200", 200, status)
    check("S1: Status is SEALED", "SEALED", body.get("status", ""))
    sigs = body.get("signatures", {})
    check("S1: Ed25519 signature present", True, bool(sigs.get("ed25519_sig", "")))
    check("S1: ML-DSA-87 signature present", True, bool(sigs.get("ml_dsa_87_sig", "")))
    receipt_json = json.dumps(body)
    
    # S2: Replay rejection
    print("\n--- S2: Replay Rejection ---")
    status, body, token = api_request("POST", f"/api/v1/organizations/{org_id}/security/validate", 
                                      token, contract)
    check("S2: Replay returns 200", 200, status)
    check("S2: Status is REJECTED_REPLAY", "REJECTED_REPLAY", body.get("status", ""))
    
    # S3: Tampered payload hash
    print("\n--- S3: Tampered Payload Hash ---")
    tampered = build_contract(finding_id="find-pov-s3", hash_override="deadbeef")
    status, body, token = api_request("POST", f"/api/v1/organizations/{org_id}/security/validate", 
                                      token, tampered)
    check("S3: Tampered hash not SEALED", True, body.get("status", "") != "SEALED")
    
    # S4: Unauthorized actor
    print("\n--- S4: Unauthorized Actor ---")
    unauth = build_contract(finding_id="find-pov-s4", actor="svc:attacker-service:evil-01")
    status, body, token = api_request("POST", f"/api/v1/organizations/{org_id}/security/validate", 
                                      token, unauth)
    check("S4: Unauthorized actor not SEALED", True, body.get("status", "") != "SEALED")
    
    # S5: Spoofed issuer prefix
    print("\n--- S5: Spoofed Issuer Prefix ---")
    spoof = build_contract(finding_id="find-pov-s5", actor="svc:vardhan-intelligence-spoofed:evil-01")
    status, body, token = api_request("POST", f"/api/v1/organizations/{org_id}/security/validate", 
                                      token, spoof)
    check("S5: Spoofed prefix not SEALED", True, body.get("status", "") != "SEALED")
    
    # S6: Tampered receipt signature
    print("\n--- S6: Tampered Receipt Signature ---")
    receipt = json.loads(receipt_json)
    if "signatures" in receipt:
        if "ed25519_sig" in receipt.get("signatures", {}):
            receipt["signatures"]["ed25519_sig"] = "0" * len(receipt["signatures"].get("ed25519_sig", ""))
    tampered_receipt = json.dumps(receipt)
    rc, output = verify_receipt(tampered_receipt, "verify-pov-s6")
    check("S6: Tampered sig verification returns Invalid", True, "Invalid" in output)
    
    # S7: Unknown tenant
    print("\n--- S7: Unknown Tenant ---")
    unknown_tenant = build_contract(finding_id="find-pov-s7", org_id="org-unknown-attacker")
    status, body, token = api_request("POST", f"/api/v1/organizations/{org_id}/security/validate", 
                                      token, unknown_tenant)
    check("S7: Unknown tenant not SEALED", True, body.get("status", "") != "SEALED")
    
    # S8: Malformed contract
    print("\n--- S8: Malformed Contract ---")
    status, body, token = api_request("POST", f"/api/v1/organizations/{org_id}/security/validate", 
                                      token, {"contract": {"schema_version": "bad"}, "actor_workload_id": "test"})
    check("S8: Malformed contract not SEALED", True, body.get("status", "") != "SEALED")
    
    # S12: Unauthenticated API access
    print("\n--- S12: Unauthenticated API Access ---")
    status, body, _ = api_request("POST", "/api/v1/organizations", body={"name": "No Auth Org"})
    check("S12: Unauthenticated denied (401)", 401, status)
    
    # S15: Concurrent duplicate submissions
    print("\n--- S15: Concurrent Duplicate Submissions ---")
    concurrent_contract = build_contract(finding_id="find-pov-s15")
    results = []

    def submit_concurrent(idx):
        # Give each request an independent one-time token, but submit the same
        # finding_id to the same tenant/path to test the atomic replay boundary.
        login_status, login_body, _ = api_request(
            "POST", "/api/v1/auth/login",
            body={"username": ADMIN_USER, "password": ADMIN_PASS}
        )
        if login_status != 200:
            return (login_status, "LOGIN_FAILED")
        request_token = login_body.get("token", "")
        status, body, _ = api_request(
            "POST",
            f"/api/v1/organizations/{org_id}/security/validate",
            request_token,
            concurrent_contract,
        )
        return (status, body.get("status", "ERROR"))

    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
        futures = [executor.submit(submit_concurrent, i) for i in range(5)]
        results = [future.result() for future in concurrent.futures.as_completed(futures)]

    sealed_count = sum(1 for status, result in results if status == 200 and result == "SEALED")
    replay_count = sum(1 for status, result in results if status == 200 and result == "REJECTED_REPLAY")
    print(f"  Concurrent results: {sealed_count} sealed, {replay_count} replay-rejected")
    check("S15: Exactly one concurrent submission seals", 1, sealed_count)
    check("S15: Remaining concurrent submissions rejected as replay", 4, replay_count)
    check("S15: All responses are expected", True, all(
        status == 200 and result in ("SEALED", "REJECTED_REPLAY")
        for status, result in results
    ))
    
    # S16: Audit trail retrieval
    print("\n--- S16: Audit Trail Retrieval ---")
    status, body, token = api_request("GET", f"/api/v1/organizations/{org_id}/security/audit", token)
    check("S16: Audit endpoint accessible (200)", 200, status)
    
    # S16b: Independent receipt verification (valid)
    print("\n--- S16b: Independent Receipt Verification ---")
    rc, output = verify_receipt(receipt_json, "verify-pov-valid")
    check("S16b: Valid receipt verifies", True, "Valid" in output)
    
    # ─── Summary ──────────────────────────────────────────────────
    print("\n" + "=" * 60)
    print(f"  Security Test Summary")
    print(f"  Passed: {PASS_COUNT}  Failed: {FAIL_COUNT}  Total: {PASS_COUNT + FAIL_COUNT}")
    print("=" * 60)
    
    summary = {
        "tests": RESULTS,
        "passed": PASS_COUNT,
        "failed": FAIL_COUNT,
        "total": PASS_COUNT + FAIL_COUNT,
    }
    
    output_file = os.environ.get("SECURITY_RESULTS_FILE", "/tmp/security_results.json")
    with open(output_file, "w") as f:
        json.dump(summary, f, indent=2)
    print(f"\nResults written to {output_file}")
    
    return 0 if FAIL_COUNT == 0 else 1

if __name__ == "__main__":
    sys.exit(main())
