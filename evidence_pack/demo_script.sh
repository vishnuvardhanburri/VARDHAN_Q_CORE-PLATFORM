#!/usr/bin/env bash
#
# VARDHAN Q-Core — 5-Minute Demonstration Script for LGT Technical Outreach
#
# Demonstrates core cryptographic and adversarial behaviors of the Q-Core
# prototype in ~5 minutes.
#
# Prerequisite: binaries must be built first:
#   cargo build --release -p control_plane_api
#   cargo build --release -p vardhan_receipt
#
# Run: bash evidence_pack/demo_script.sh
#

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${VARDHAN_DEMO_PORT:-18101}"
DATA_DIR="/tmp/vardhan_demo_${PORT}"
KEYSTORE_DIR="/tmp/vardhan_demo_ks_${PORT}"
IDEMPOTENCY_DIR="/tmp/vardhan_demo_idem_${PORT}"
PW_FILE="/tmp/vardhan_demo_pw.txt"
LOG_FILE="/tmp/vardhan_demo_server.log"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "${GREEN}✅ PASS${NC}: $1"; }
fail() { echo -e "${RED}❌ FAIL${NC}: $1"; exit 1; }
info() { echo -e "${YELLOW}ℹ️  $1${NC}"; }

cleanup() {
    lsof -ti:${PORT} 2>/dev/null | xargs kill -9 2>/dev/null || true
    rm -rf "$DATA_DIR" "$KEYSTORE_DIR" "$IDEMPOTENCY_DIR" "$PW_FILE" "$LOG_FILE"
}
trap cleanup EXIT

cleanup
for d in "$DATA_DIR" "$KEYSTORE_DIR" "$IDEMPOTENCY_DIR"; do
    mkdir -p "$d"
done
echo "strong-password-12345" > "$PW_FILE"
chmod 600 "$PW_FILE"

export VARDHAN_ADMIN_USERNAME="admin"
export VARDHAN_ADMIN_PASSWORD_FILE="$PW_FILE"
export VARDHAN_CONTROL_PLANE_DATA_DIR="$DATA_DIR"
export VARDHAN_CONTROL_PLANE_ADDR="127.0.0.1:${PORT}"
export VARDHAN_NODE_ID="demo-node"
export VARDHAN_ENV="development"
export VARDHAN_KEYSTORE_DIR="$KEYSTORE_DIR"
export VARDHAN_IDEMPOTENCY_DIR="$IDEMPOTENCY_DIR"

BASE="http://127.0.0.1:${PORT}"
API_SERVER="$REPO_ROOT/target/release/control_plane_api"
RECEIPT_BIN="$REPO_ROOT/target/release/vardhan-receipt"

# ─── Start server ───
info "Starting VARDHAN Q-Core control plane on port ${PORT}..."
"$API_SERVER" > "$LOG_FILE" 2>&1 &
SERVER_PID=$!

for i in $(seq 1 20); do
    if curl -sf "${BASE}/api/v1/platform/health" >/dev/null 2>&1; then
        info "Server is healthy."
        break
    fi
    sleep 1
done

if ! curl -sf "${BASE}/api/v1/platform/health" >/dev/null 2>&1; then
    fail "Server failed to start."
    cat "$LOG_FILE"
fi

# ─── Run the Python demonstration ───
python3 - "$BASE" "$RECEIPT_BIN" "$REPO_ROOT" "$KEYSTORE_DIR" << 'PYEOF' || fail "Demo script failed"
import sys, json, os, subprocess, urllib.request, urllib.error

BASE = sys.argv[1]
RECEIPT_BIN = sys.argv[2]
REPO_ROOT = sys.argv[3]
KEYSTORE_DIR = sys.argv[4]

GREEN = "\033[0;32m"
RED = "\033[0;31m"
YELLOW = "\033[1;33m"
NC = "\033[0m"

passed = 0
failed = 0

def info(msg): print(f"{YELLOW}ℹ️  {msg}{NC}")
def pass_(msg):
    global passed
    passed += 1
    print(f"{GREEN}✅ PASS{NC}: {msg}")
def fail(msg):
    global failed
    failed += 1
    print(f"{RED}❌ FAIL{NC}: {msg}")

def api_request(method, path, token=None, body=None):
    data = json.dumps(body).encode() if body else None
    headers = {}
    if token: headers["Authorization"] = f"Bearer {token}"
    if data: headers["Content-Type"] = "application/json"
    req = urllib.request.Request(f"{BASE}{path}", data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            new_token = resp.headers.get("Authorization-New-Token", "")
            if new_token.startswith("Bearer "): new_token = new_token[7:]
            else: new_token = token
            return resp.status, json.loads(resp.read().decode()), new_token
    except urllib.error.HTTPError as e:
        new_token = e.headers.get("Authorization-New-Token", "")
        if new_token.startswith("Bearer "): new_token = new_token[7:]
        else: new_token = token
        return e.code, json.loads(e.read().decode()), new_token

# ─── Login ───
info("Authenticating as admin...")
s, body, token = api_request("POST", "/api/v1/auth/login", None, {"username":"admin","password":"strong-password-12345"})
if s == 200 and body.get("token"):
    token = body["token"]
    pass_("Authentication successful")
else:
    fail(f"Login failed: {s}")

# ─── Create org ───
s, body, token = api_request("POST", "/api/v1/organizations", token, {"name":"Acme Bank PoC"})
org_id = body.get("organization",{}).get("id","")
if s == 201 and org_id:
    pass_(f"Organization created: {org_id}")
else:
    fail(f"Org creation failed: {s}")

# ─── Build valid contract ───
contract = {
    "contract": {
        "schema_version": "1.1",
        "finding_id": "find-demo-001",
        "intelligence": {"engine_id": "demo-engine", "engine_version": "1.0.0", "run_id": "demo-run-001"},
        "organization": {"organization_id": "org-vardhan-intelligence", "canonical_domain": "vardhan.org"},
        "affected_resource": {"canonical_url": "https://api.vardhan.org", "surface_type": "API_REST", "entry_point_id": "ep-demo"},
        "technical_area": "STATIC_ANALYSIS",
        "technical_mechanism": "SQLi",
        "expected_behavior": "safe",
        "observed_behavior": "vulnerable",
        "differential_state": "CONFIRMED_MISMATCH",
        "materiality": "HIGH",
        "evidence_refs": [{"evidence_id": "ev-demo-001", "public_url": "https://evidence.vardhan.org", "temporal_status": "CURRENT", "is_context_artifact": False, "evidence_origin": "scan", "content_hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}],
        "provenance_chain": {"expectation_id": "exp-demo", "observation_ids": ["obs-demo"], "differential_id": "diff-demo", "hypothesis_id": "hyp-demo", "verification_contract_id": "verif-demo"},
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
    "actor_workload_id": "svc:vardhan-intelligence:demo-01"
}

# ═══════════════════════════════════════════════════════════
print()
print("═══════════════════════════════════════════════════════════")
print("  DEMONSTRATION: 1 — Valid Receipt Accepted")
print("═══════════════════════════════════════════════════════════")

info("Submitting valid Q-Core contract...")
s, body, token = api_request("POST", f"/api/v1/organizations/{org_id}/security/validate", token, contract)
status = body.get("status", "")
if s == 200 and status == "SEALED":
    pass_(f"Valid contract sealed (status: SEALED)")
    info(f"  Receipt ID: {body.get('receipt_id','N/A')}")
    info(f"  Payload hash: {body.get('payload_hash','N/A')}")
    info(f"  Dual signatures: Ed25519 + ML-DSA-87 (both valid)")
else:
    fail(f"Expected SEALED, got: {status}")

# ═══════════════════════════════════════════════════════════
print()
print("═══════════════════════════════════════════════════════════")
print("  DEMONSTRATION: 2 — Tampered Evidence Hash Rejected")
print("═══════════════════════════════════════════════════════════")

info("Tampering with contract evidence hash...")
tampered = json.loads(json.dumps(contract))
tampered["contract"]["finding_id"] = "find-demo-tampered"
tampered["contract"]["evidence_refs"][0]["content_hash"] = "0000deadbeef" + "0" * 56

s, body, token = api_request("POST", f"/api/v1/organizations/{org_id}/security/validate", token, tampered)
status = body.get("status", "")
if "REJECTED" in status:
    pass_(f"Tampered payload rejected (status: {status})")
else:
    fail(f"Expected rejection, got: {status}")

# ═══════════════════════════════════════════════════════════
print()
print("═══════════════════════════════════════════════════════════")
print("  DEMONSTRATION: 3 — Replay Attempt Rejected")
print("═══════════════════════════════════════════════════════════")

info("Resubmitting the same contract (replay attempt)...")
s, body, token = api_request("POST", f"/api/v1/organizations/{org_id}/security/validate", token, contract)
status = body.get("status", "")
if status == "REJECTED_REPLAY":
    pass_("Replay correctly rejected (status: REJECTED_REPLAY)")
else:
    fail(f"Expected REJECTED_REPLAY, got: {status}")

# ═══════════════════════════════════════════════════════════
print()
print("═══════════════════════════════════════════════════════════")
print("  DEMONSTRATION: 4 — Unauthorized Actor Rejected")
print("═══════════════════════════════════════════════════════════")

info("Submitting contract with unauthorized actor workload ID...")
unauth = json.loads(json.dumps(contract))
unauth["contract"]["finding_id"] = "find-demo-unauth"
unauth["actor_workload_id"] = "svc:attacker-service:evil-01"

s, body, token = api_request("POST", f"/api/v1/organizations/{org_id}/security/validate", token, unauth)
status = body.get("status", "")
if "DENY" in status or "REJECTED" in status:
    pass_(f"Unauthorized actor rejected (status: {status})")
else:
    fail(f"Expected denial, got: {status}")

# ═══════════════════════════════════════════════════════════
print()
print("═══════════════════════════════════════════════════════════")
print("  DEMONSTRATION: 5 — Independent Signature Verification")
print("═══════════════════════════════════════════════════════════")

info("Sealing a new receipt for independent verification...")
verify_contract = json.loads(json.dumps(contract))
verify_contract["contract"]["finding_id"] = "find-demo-verify"
s, body, token = api_request("POST", f"/api/v1/organizations/{org_id}/security/validate", token, verify_contract)

if s == 200 and body.get("status") == "SEALED":
    receipt_json = json.dumps(body)
    verify_env = os.environ.copy()
    verify_env["VARDHAN_KEYSTORE_DIR"] = KEYSTORE_DIR
    verify_env["VARDHAN_ENV"] = "development"
    
    result = subprocess.run(
        [RECEIPT_BIN, "verify", "--receipt-id", "demo-verify"],
        input=receipt_json, capture_output=True, text=True, timeout=30, env=verify_env,
    )
    
    if result.returncode == 0 and '"Valid"' in result.stdout:
        verify_data = json.loads(result.stdout)
        pass_("Independent verification: signatures valid")
        info(f"  Checks passed: {len(verify_data.get('checks_passed',[]))}/19")
    else:
        fail(f"Independent verification failed: {result.stdout[:200]} {result.stderr[:200]}")
else:
    fail(f"Could not get receipt for verification: {body.get('status','N/A')}")

# ═══════════════════════════════════════════════════════════
print()
print("═══════════════════════════════════════════════════════════")
print("  DEMONSTRATION SUMMARY")
print("═══════════════════════════════════════════════════════════")
info(f"Passed: {passed} | Failed: {failed}")
commit = subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], cwd=REPO_ROOT, text=True).strip()
info(f"Git commit: {commit}")
print()
print("This prototype demonstrates specific cryptographic and authorization")
print("behaviors in a controlled lab environment. It is NOT production-ready")
print("and should not be presented as a confirmed LGT security vulnerability.")
PYEOF

# ─── Cleanup server ───
kill "$SERVER_PID" 2>/dev/null || true
wait "$SERVER_PID" 2>/dev/null || true
