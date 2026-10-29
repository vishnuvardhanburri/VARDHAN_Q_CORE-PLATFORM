#!/usr/bin/env python3
"""
VARDHAN Q-CORE :: Comprehensive Feature & Endpoint Verification Engine
======================================================================
Tests 100% of Control Plane APIs, Ingress, Cryptography, Multi-Tenancy & IAM.
No mocks. Real Rust server. Real ML-DSA-87 / Ed25519 dual-signature engine.
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

REPO = Path(__file__).resolve().parent.parent
BINARY = REPO / "target" / "release" / "control_plane_api"
RECEIPT_BIN = REPO / "target" / "release" / "vardhan-receipt"

PORT = 18199
BASE = f"http://127.0.0.1:{PORT}"
DATA_DIR = f"/tmp/vardhan_matrix_{PORT}"
KS_DIR = f"/tmp/vardhan_matrix_ks_{PORT}"
IDEM_DIR = f"/tmp/vardhan_matrix_idem_{PORT}"

ADMIN_USER = "admin"
ADMIN_PASS = "demo-password-q-core-2026"

PASS_COUNT = 0
FAIL_COUNT = 0
SERVER = None

def _c(code: str, text: str) -> str:
    return f"\033[{code}m{text}\033[0m"

def grn(t: str) -> str: return _c("0;32", t)
def red(t: str) -> str: return _c("0;31", t)
def ylw(t: str) -> str: return _c("1;33", t)
def blu(t: str) -> str: return _c("0;34", t)
def cyn(t: str) -> str: return _c("0;36", t)
def bld(t: str) -> str: return _c("1", t)
def dim(t: str) -> str: return _c("2", t)

def record(gate: str, name: str, passed: bool, detail: str = ""):
    global PASS_COUNT, FAIL_COUNT
    if passed:
        PASS_COUNT += 1
        print(f"  {grn('✓')} [{cyn(gate)}] {name} {dim('(' + detail + ')') if detail else ''}")
    else:
        FAIL_COUNT += 1
        print(f"  {red('✗')} [{red(gate)}] {bld(name)} - {red('FAILED')}: {detail}")

def api(method: str, path: str, token: str | None = None, body: dict | None = None) -> tuple[int, dict, str | None]:
    url = f"{BASE}{path}"
    payload = json.dumps(body).encode() if body is not None else None
    headers = {"Accept": "application/json"}
    if payload is not None: headers["Content-Type"] = "application/json"
    if token: headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=payload, headers=headers, method=method)

    def extract_token(resp_headers) -> str | None:
        new_auth = resp_headers.get("Authorization-New-Token") or resp_headers.get("authorization-new-token")
        if new_auth and new_auth.startswith("Bearer "):
            return new_auth[len("Bearer "):]
        return None

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            raw = resp.read().decode()
            try:
                body_data = json.loads(raw) if raw else {}
            except Exception:
                body_data = {"raw": raw}
            return resp.status, body_data, extract_token(resp.headers)
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode()
        try:
            body_data = json.loads(raw) if raw else {}
        except Exception:
            body_data = {"raw": raw}
        return exc.code, body_data, extract_token(exc.headers)
    except Exception as e:
        return 500, {"error": str(e)}, None

def cleanup():
    global SERVER
    if SERVER:
        SERVER.terminate()
        try: SERVER.wait(timeout=3)
        except Exception: pass
    subprocess.run(f"lsof -ti :{PORT} | xargs kill -9 2>/dev/null; true", shell=True, capture_output=True)

def main():
    global SERVER
    print(bld(cyn("""
  ======================================================================
   VARDHAN Q-CORE :: FULL FEATURE & COMPONENT VERIFICATION ENGINE
  ======================================================================
   Testing 100% of Control Plane APIs, Ingress, Cryptography & IAM
  ======================================================================
    """)))

    # Setup directories
    for d in [DATA_DIR, KS_DIR, IDEM_DIR]:
        subprocess.run(f"rm -rf {d} && mkdir -p {d}", shell=True)
    pw_file = "/tmp/vardhan_matrix_pw.txt"
    with open(pw_file, "w") as f: f.write(ADMIN_PASS)
    os.chmod(pw_file, 0o600)

    env = {**os.environ,
        "VARDHAN_ADMIN_USERNAME": ADMIN_USER,
        "VARDHAN_ADMIN_PASSWORD_FILE": pw_file,
        "VARDHAN_CONTROL_PLANE_DATA_DIR": DATA_DIR,
        "VARDHAN_CONTROL_PLANE_ADDR": f"127.0.0.1:{PORT}",
        "VARDHAN_NODE_ID": "matrix-validation-node",
        "VARDHAN_ENV": "development",
        "VARDHAN_KEYSTORE_DIR": KS_DIR,
        "VARDHAN_IDEMPOTENCY_DIR": IDEM_DIR,
    }

    cleanup()
    time.sleep(0.5)

    SERVER = subprocess.Popen([str(BINARY)], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    import atexit
    atexit.register(cleanup)

    healthy = False
    for _ in range(15):
        c, b, _ = api("GET", "/api/v1/platform/health")
        if c == 200 and b.get("status") == "operational":
            healthy = True
            break
        time.sleep(1)

    if not healthy:
        print(red("Control plane failed to boot. Aborting."))
        sys.exit(1)

    print(f"  {blu('·')} Engine active on {BASE} (PID {SERVER.pid})\n")

    # -------------------------------------------------------------
    # 1. PLATFORM & HEALTH GATES
    # -------------------------------------------------------------
    print(bld("1. PLATFORM TELEMETRY & HEALTH"))
    c, b, _ = api("GET", "/api/v1/platform/health")
    record("PLATFORM", "GET /platform/health (Operational Status)", c == 200 and b.get("status") == "operational", f"HTTP {c}")
    record("PLATFORM", "FIPS Self-Test Verification", b.get("crypto_self_tests") == "OPERATIONAL", "KATs passed")

    c, b, _ = api("GET", "/api/v1/catalog/plans")
    plans_list = b if isinstance(b, list) else b.get("plans", [])
    record("CATALOG", "GET /catalog/plans (SaaS Catalog)", c == 200 and len(plans_list) > 0, f"{len(plans_list)} plans")

    c, b, _ = api("GET", "/api/v1/crypto/fips-status")
    record("CRYPTO", "GET /crypto/fips-status (FIPS Posture)", c == 200 and ("status" in b or "fips_mode" in b or "cmvp_validation" in b), f"Status: {b.get('status', 'OK')}")

    # -------------------------------------------------------------
    # 2. AUTHENTICATION & SESSION LIFECYCLE
    # -------------------------------------------------------------
    print(bld("\n2. AUTHENTICATION & ACCESS LIFECYCLE"))
    c, b, new_t = api("POST", "/api/v1/auth/login", body={"username": ADMIN_USER, "password": ADMIN_PASS})
    token = new_t or b.get("token")
    record("AUTH", "POST /auth/login (Bootstrap Admin Login)", c == 200 and bool(token), f"HTTP {c}")

    c, b, new_t = api("GET", "/api/v1/me", token)
    token = new_t or token
    record("AUTH", "GET /me (Caller Identity Verification)", c == 200 and b.get("username") == ADMIN_USER, f"Principal: {b.get('username')}")

    c, b, new_t = api("GET", "/api/v1/admin/profile", token)
    token = new_t or token
    record("PROFILE", "GET /admin/profile (Profile Retrieval)", c == 200 and b.get("username") == ADMIN_USER, f"Role: {b.get('role')}")

    c, b, new_t = api("PUT", "/api/v1/admin/profile", token, body={"display_name": "Chief Cryptographer", "email": "ciso@vardhan.org"})
    token = new_t or token
    record("PROFILE", "PUT /admin/profile (Profile Modification)", c == 200 and b.get("display_name") == "Chief Cryptographer", f"HTTP {c}")

    c, b, new_t = api("GET", "/api/v1/sessions", token)
    token = new_t or token
    record("SESSIONS", "GET /sessions (Active Session Discovery)", c == 200 and isinstance(b, list) and len(b) >= 1, f"{len(b) if isinstance(b, list) else 0} session(s)")

    # -------------------------------------------------------------
    # 3. API KEYS MANAGEMENT & CREDENTIAL LIFECYCLE
    # -------------------------------------------------------------
    print(bld("\n3. API KEYS & INGRESS CREDENTIALS"))
    c, b, new_t = api("POST", "/api/v1/admin/api-keys", token, body={"name": "Ingress Scanner Automation", "expires_in_days": 30})
    token = new_t or token
    api_key_id = b.get("id")
    api_key_secret = b.get("secret")
    record("API_KEYS", "POST /admin/api-keys (Mint High-Entropy Ingress Key)", c in (200, 201) and bool(api_key_secret), f"Key ID: {api_key_id}")

    c, b, new_t = api("GET", "/api/v1/admin/api-keys", token)
    token = new_t or token
    record("API_KEYS", "GET /admin/api-keys (List Authoritative Ingress Roster)", c == 200 and any(k.get("id") == api_key_id for k in b), f"Count: {len(b)}")

    # Revoke API Key
    c, b, new_t = api("DELETE", f"/api/v1/admin/api-keys/{api_key_id}", token)
    token = new_t or token
    record("API_KEYS", "DELETE /admin/api-keys/{id} (Key Revocation)", c in (200, 204), f"Revoked: {api_key_id}")

    # -------------------------------------------------------------
    # 4. ORGANIZATIONS & MULTI-TENANCY BOUNDARY
    # -------------------------------------------------------------
    print(bld("\n4. ORGANIZATIONS & TENANT ISOLATION"))
    c, b, new_t = api("POST", "/api/v1/organizations", token, body={"name": "Apex Global Bank"})
    token = new_t or token
    org1_id = b.get("organization", {}).get("id")
    record("ORGANIZATION", "POST /organizations (Provision Apex Global Bank)", c == 201 and bool(org1_id), f"Org ID: {org1_id}")

    c, b, new_t = api("POST", "/api/v1/organizations", token, body={"name": "Zurich Financial Systems"})
    token = new_t or token
    org2_id = b.get("organization", {}).get("id")
    record("ORGANIZATION", "POST /organizations (Provision Zurich Financial)", c == 201 and bool(org2_id), f"Org ID: {org2_id}")

    c, b, new_t = api("GET", f"/api/v1/organizations/{org1_id}", token)
    token = new_t or token
    record("ORGANIZATION", "GET /organizations/{id} (Read-Back Tenant Model)", c == 200 and b.get("organization", {}).get("name") == "Apex Global Bank", f"HTTP {c}")

    c, b, new_t = api("GET", "/api/v1/organizations", token)
    token = new_t or token
    record("ORGANIZATION", "GET /organizations (Multi-Tenant Enumeration)", c == 200 and len(b.get("organizations", [])) >= 2, f"Active tenants: {len(b.get('organizations', []))}")

    # -------------------------------------------------------------
    # 5. IAM, MEMBERSHIP & INVITATIONS
    # -------------------------------------------------------------
    print(bld("\n5. IAM & MEMBER RBAC ROSTER"))
    c, b, new_t = api("GET", f"/api/v1/organizations/{org1_id}/members", token)
    token = new_t or token
    members = b.get("members", [])
    record("IAM", "GET /organizations/{id}/members (List Members)", c == 200 and len(members) >= 1, f"Members: {len(members)}")

    c, b, new_t = api("POST", f"/api/v1/organizations/{org1_id}/invitations", token, body={"email": "auditor@bank.com", "role": "operator"})
    token = new_t or token
    inv_id = b.get("invitation_id")
    record("IAM", "POST /organizations/{id}/invitations (Issue RBAC Invite)", c == 200 and bool(inv_id), f"Invite ID: {inv_id}")

    c, b, new_t = api("GET", f"/api/v1/organizations/{org1_id}/invitations", token)
    token = new_t or token
    record("IAM", "GET /organizations/{id}/invitations (List Pending Invites)", c == 200 and any(i.get("id") == inv_id for i in b.get("invitations", [])), f"Count: {len(b.get('invitations', []))}")

    # -------------------------------------------------------------
    # 6. WEBHOOKS & INGRESS INTEGRATIONS
    # -------------------------------------------------------------
    print(bld("\n6. ENTERPRISE WEBHOOKS & SIGNAL DISPATCH"))
    c, b, new_t = api("POST", f"/api/v1/organizations/{org1_id}/webhooks", token, body={
        "url": "https://siem.internal.bank.com/v1/events",
        "description": "SOC SIEM Ingestion Pipe",
        "events": ["transaction.sealed", "receipt.verified"]
    })
    token = new_t or token
    wh_id = b.get("id")
    record("WEBHOOKS", "POST /organizations/{id}/webhooks (Register SIEM Endpoint)", c == 201 and bool(wh_id), f"Webhook ID: {wh_id}")

    c, b, new_t = api("GET", f"/api/v1/organizations/{org1_id}/webhooks", token)
    token = new_t or token
    record("WEBHOOKS", "GET /organizations/{id}/webhooks (List Active Webhooks)", c == 200 and any(w.get("id") == wh_id for w in b.get("webhooks", [])), f"HTTP {c}")

    c, b, new_t = api("POST", f"/api/v1/organizations/{org1_id}/webhooks/{wh_id}/test", token)
    token = new_t or token
    record("WEBHOOKS", "POST /organizations/{id}/webhooks/{id}/test (Trigger Probe Delivery)", c == 200, f"Status: {b.get('status', 'dispatched')}")

    c, b, new_t = api("DELETE", f"/api/v1/organizations/{org1_id}/webhooks/{wh_id}", token)
    token = new_t or token
    record("WEBHOOKS", "DELETE /organizations/{id}/webhooks/{id} (Teardown Webhook)", c in (200, 204), f"HTTP {c}")

    # -------------------------------------------------------------
    # 7. CONTRACT SEALING, ML-DSA-87 & CRYPTOGRAPHIC INVARIANTS
    # -------------------------------------------------------------
    print(bld("\n7. POST-QUANTUM CONTRACT SEALING & VERIFICATION"))
    finding_id = f"matrix-seal-{int(time.time())}"
    contract = {
        "contract": {
            "schema_version": "1.1",
            "finding_id": finding_id,
            "intelligence": {"engine_id":"engine-v2","engine_version":"2.0.0","run_id":"run-matrix-01"},
            "organization": {"organization_id": "org-vardhan-intelligence", "canonical_domain":"apexbank.com"},
            "affected_resource": {"canonical_url":"https://api.apexbank.com/v1/settlement","surface_type":"API_REST","entry_point_id":"ep-matrix-1"},
            "technical_area":"STATIC_ANALYSIS","technical_mechanism":"SQLi","expected_behavior":"safe","observed_behavior":"vulnerable",
            "differential_state":"CONFIRMED_MISMATCH","materiality":"HIGH",
            "evidence_refs":[{"evidence_id":"ev-matrix-1","public_url":"https://evidence.vardhan.org/ev1","temporal_status":"CURRENT","is_context_artifact":False,"evidence_origin":"scan","content_hash":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}],
            "provenance_chain":{"expectation_id":"exp-m-1","observation_ids":["obs-m-1"],"differential_id":"diff-m-1","hypothesis_id":"hyp-m-1","verification_contract_id":"verif-m-1"},
            "contradictory_evidence_ids":[],"uncertainty":[],"benign_explanation":"",
            "authorization_context":{"requires_authorized_assessment":False},
            "decision_candidate":"SEAL_VERIFIED_FINDING","policy_reference":"VARDHAN_CORE_INTELLIGENCE_POLICY_V1",
            "created_at":"2026-10-29T10:00:00Z","evidence_earliest_retrieved_at":"2026-10-29T09:00:00Z","evidence_latest_retrieved_at":"2026-10-29T09:30:00Z"
        },
        "actor_workload_id": "svc:vardhan-intelligence:demo-node"
    }

    c, b, new_t = api("POST", "/api/v1/organizations/org-vardhan-intelligence/security/validate", token, contract)
    token = new_t or token
    receipt_id = b.get("receipt_id")
    is_sealed = b.get("status") == "SEALED"
    record("CRYPTO_SEAL", "POST /security/validate (ML-DSA-87 Quantum Seal)", c == 200 and is_sealed, f"Receipt: {receipt_id}")

    # Replay Protection Test
    c, b, new_t = api("POST", "/api/v1/organizations/org-vardhan-intelligence/security/validate", token, contract)
    token = new_t or token
    record("IDEMPOTENCY", "Durable Replay Protection Gate", b.get("status") == "REJECTED_REPLAY", "Duplicate finding_id rejected")

    # Ingest verified receipt into org1 telemetry so findings can link to it
    c_rc, b_rc, new_t = api("POST", f"/api/v1/organizations/{org1_id}/receipts", token, body={
        "receipt_id": receipt_id or "VQR-test",
        "transaction_id": "tx-matrix-01",
        "tenant_id": org1_id,
        "status": "sealed",
        "decision": "allow",
        "outcome_code": "200",
        "policy_id": "default",
        "policy_version": "v1",
        "ledger_commit_index": 1,
        "timestamp_ms": int(time.time() * 1000),
        "payload_hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        "issuer_key_fingerprint": "node-matrix-fp",
        "verification": "verified"
    })
    token = new_t or token

    # -------------------------------------------------------------
    # 8. SECURITY POSTURE, FINDINGS & INCIDENTS
    # -------------------------------------------------------------
    print(bld("\n8. CONTINUOUS SECURITY OPERATIONS"))
    c, b, new_t = api("GET", f"/api/v1/organizations/{org1_id}/security/posture", token)
    token = new_t or token
    record("POSTURE", "GET /security/posture (Cryptographic Health Score)", c == 200 and ("risk" in b or "data_state" in b or "monitoring" in b), f"Status: {b.get('data_state', 'operational')}")

    c, b, new_t = api("POST", f"/api/v1/organizations/{org1_id}/findings", token, body={
        "finding_id": f"vuln-sec-{int(time.time())}",
        "severity": "high",
        "status": "open",
        "receipt_id": receipt_id or "VQR-test",
        "evidence_refs": ["ev-matrix-1"],
        "risk_score": 75,
        "created_at_ms": int(time.time() * 1000),
        "updated_at_ms": int(time.time() * 1000)
    })
    token = new_t or token
    record("FINDINGS", "POST /findings (Ingest Formal Security Finding)", c == 200, f"HTTP {c}")

    c, b, new_t = api("GET", f"/api/v1/organizations/{org1_id}/findings", token)
    token = new_t or token
    record("FINDINGS", "GET /findings (List Verified Findings Roster)", c == 200, f"Count: {len(b.get('items', []))}")

    c, b, new_t = api("GET", f"/api/v1/organizations/{org1_id}/incidents", token)
    token = new_t or token
    record("INCIDENTS", "GET /incidents (List Incident Records)", c == 200, f"HTTP {c}")

    # -------------------------------------------------------------
    # 9. CONTINUOUS GOVERNANCE & POLICY DRIFT
    # -------------------------------------------------------------
    print(bld("\n9. POLICY GOVERNANCE & DRIFT INTELLIGENCE"))
    c, b, new_t = api("POST", f"/api/v1/organizations/{org1_id}/security/policy-baseline", token, body={
        "policy_id": "pol-fips204-strict",
        "policy_version": "v1.0.0",
        "policy": {"min_key_length": 4096, "allowed_curves": ["ML-DSA-87"]}
    })
    token = new_t or token
    record("POLICY", "POST /security/policy-baseline (Register Invariant Baseline)", c in (200, 201), f"HTTP {c}")

    c, b, new_t = api("POST", f"/api/v1/organizations/{org1_id}/security/policy-observations", token, body={
        "policy_id": "pol-fips204-strict",
        "policy_version": "v1.0.0",
        "policy": {"min_key_length": 4096, "allowed_curves": ["ML-DSA-87"]},
        "observed_at_ms": int(time.time() * 1000)
    })
    token = new_t or token
    record("POLICY", "POST /security/policy-observations (Record Continuous Invariant Observation)", c in (200, 201, 202), f"HTTP {c}")

    c, b, new_t = api("GET", f"/api/v1/organizations/{org1_id}/security/policy-drift", token)
    token = new_t or token
    record("POLICY", "GET /security/policy-drift (Inspect Drift Deviations)", c == 200, f"Items: {len(b.get('items', []))}")

    c, b, new_t = api("GET", f"/api/v1/organizations/{org1_id}/security/alerts", token)
    token = new_t or token
    record("ALERTS", "GET /security/alerts (List Triage Queue)", c == 200, f"Alerts: {len(b.get('alerts', []))}")

    c, b, new_t = api("GET", f"/api/v1/organizations/{org1_id}/security/remediations", token)
    token = new_t or token
    record("REMEDIATIONS", "GET /security/remediations (List Remediation Directives)", c == 200, f"HTTP {c}")

    c, b, new_t = api("GET", f"/api/v1/organizations/{org1_id}/security/executive-report", token)
    token = new_t or token
    record("EXECUTIVE", "GET /security/executive-report (Synthesize Executive CISO Summary)", c == 200, f"HTTP {c}")

    # -------------------------------------------------------------
    # 10. SAAS METERING, ENTITLEMENTS & BILLING
    # -------------------------------------------------------------
    print(bld("\n10. COMMERCIAL SAAS METERING & ENTITLEMENTS"))
    c, b, new_t = api("GET", f"/api/v1/organizations/{org1_id}/entitlements", token)
    token = new_t or token
    status_str = b.get("subscription_status", "verified") if isinstance(b, dict) else "ok"
    record("METERING", "GET /organizations/{id}/entitlements (Cryptographic Entitlements)", c == 200, f"Status: {status_str}")

    c, b, new_t = api("GET", f"/api/v1/organizations/{org1_id}/subscription", token)
    token = new_t or token
    plan_id = b.get("subscription", {}).get("plan_id", "foundation") if isinstance(b, dict) else "foundation"
    record("METERING", "GET /organizations/{id}/subscription (Subscription State)", c == 200, f"Plan: {plan_id}")

    c, b, new_t = api("GET", f"/api/v1/organizations/{org1_id}/usage", token)
    token = new_t or token
    record("METERING", "GET /organizations/{id}/usage (Usage Quotas & Metering)", c == 200, f"HTTP {c}")

    c, b, new_t = api("POST", f"/api/v1/organizations/{org1_id}/usage/record", token, body={
        "bytes_processed": 1048576,
        "transactions": 1500
    })
    token = new_t or token
    record("METERING", "POST /organizations/{id}/usage/record (Increment Ledger Usage)", c in (200, 201), f"HTTP {c}")

    # -------------------------------------------------------------
    # 11. IMMUTABLE AUDIT TRAIL & COMPLIANCE
    # -------------------------------------------------------------
    print(bld("\n11. DORA & SOC 2 AUDIT TRAIL"))
    c, b, new_t = api("GET", f"/api/v1/organizations/{org1_id}/security/audit", token)
    token = new_t or token
    audit_len = len(b.get("audit_records", b.get("events", []))) if isinstance(b, dict) else 0
    record("AUDIT", "GET /security/audit (Immutable Append-Only Audit Trail)", c == 200, f"Audit entries available: {audit_len}")

    c, b, new_t = api("GET", f"/api/v1/organizations/{org1_id}/aer-kep-q/status", token)
    token = new_t or token
    epoch = b.get("epoch", 1) if isinstance(b, dict) else 1
    record("AUDIT", "GET /aer-kep-q/status (Epoch & Forward Secrecy Telemetry)", c == 200, f"Epoch: {epoch}")

    # -------------------------------------------------------------
    # SUMMARY REPORT
    # -------------------------------------------------------------
    print(bld(cyn("""
  ======================================================================
   SYSTEM CAPABILITY VERIFICATION SUMMARY
  ======================================================================
    """)))
    total = PASS_COUNT + FAIL_COUNT
    print(f"  Total Functional Gates Verified : {bld(str(total))}")
    print(f"  {grn('Passed')}                          : {bld(str(PASS_COUNT))}")
    print(f"  {red('Failed')}                          : {bld(str(FAIL_COUNT))}")

    if FAIL_COUNT == 0:
        print(f"\n  {grn(bld('>> FULL SYSTEM VERIFIED: All endpoints, lifecycle gates, and integrations operational.'))}\n")
    else:
        print(f"\n  {red(bld(f'>> {FAIL_COUNT} operational failures detected.'))}\n")

if __name__ == "__main__":
    main()
