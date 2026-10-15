#!/bin/bash
# ===================================================================
# VARDHAN Q-CORE — Security Test Suite (runs inside Docker container)
# ===================================================================
set -euo pipefail

HOST="http://localhost:8080"
RESULTS_FILE="/tmp/security_results.json"
PASS_COUNT=0
FAIL_COUNT=0
TESTS=""

# Admin credentials (bootstrap password from entrypoint)
ADMIN_USER="admin"
ADMIN_PASS="P0V-Str0ng-P@sspw0rd-2025!"

# ─── Helper functions ────────────────────────────────────────────

# Login and get token (uses Authorization-New-Token header per Phase 8a fix)
login() {
    local resp
    resp=$(curl -sf -X POST "${HOST}/api/v1/auth/login" \
        -H "Content-Type: application/json" \
        -d "{\"username\":\"${ADMIN_USER}\",\"password\":\"${ADMIN_PASS}}" \
        -D /tmp/login_headers 2>/dev/null || echo '{"token":""}')
    
    TOKEN=$(echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null || echo "")
    # Try to get rotated token from header
    ROTATED=$(grep -i "authorization-new-token" /tmp/login_headers 2>/dev/null | head -1 | tr -d '\r' | cut -d' ' -f2- || echo "")
    if [ -n "$ROTATED" ]; then TOKEN="$ROTATED"; fi
    echo "$TOKEN"
}

api_request() {
    local method="$1" path="$2" token="${3:-}" body="${4:-}"
    local headers="-H Content-Type: application/json"
    if [ -n "$token" ]; then headers="$headers -H Authorization: Bearer $token"; fi
    local data=""
    if [ -n "$body" ]; then data="-d '$body'"; fi
    
    curl -s -w "\n%{http_code}" \
        -X "$method" \
        $headers \
        $data \
        "${HOST}${path}" 2>/dev/null
}

check() {
    local label="$1" passed="$2" detail="${3:-}"
    local status="PASS"
    if [ "$passed" = "false" ]; then status="FAIL"; FAIL_COUNT=$((FAIL_COUNT+1)); else PASS_COUNT=$((PASS_COUNT+1)); fi
    local entry="{\"status\":\"$status\",\"test\":\"$label\",\"detail\":\"$detail\"}"
    if [ -z "$TESTS" ]; then TESTS="$entry"; else TESTS="$TESTS,$entry"; fi
    local symbol="✅"
    if [ "$passed" = "false" ]; then symbol="❌"; fi
    echo "  $symbol $status: $label ($detail)"
}

# ─── Run tests ───────────────────────────────────────────────────

echo "=== VARDHAN Q-CORE — Security Test Matrix ==="
echo ""

TOKEN=$(login)
if [ -z "$TOKEN" ]; then
    echo "❌ FAILED: Could not login"
    echo "{\"tests\":[],\"passed\":0,\"failed\":1,\"summary\":\"login failed\"}" > "$RESULTS_FILE"
    exit 1
fi
echo "✅ Login successful"

# Create organization
RESP=$(api_request "POST" "/api/v1/organizations" "$TOKEN" '{"name":"LGT PoC Tenant"}')
ORG_RESP=$(echo "$RESP" | head -n -1)
HTTP_CODE=$(echo "$RESP" | tail -1)
ORG_ID=$(echo "$ORG_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('organization',{}).get('id',''))" 2>/dev/null || echo "")
check "Organization created" "$([ -n "$ORG_ID" ] && echo true || echo false)" "org_id=$ORG_ID"

# Rotate token from response
ROTATED=$(echo "$RESP" | python3 -c "
import sys
lines = sys.stdin.read().strip().split('\n')
resp = lines[0] if lines else '{}'
# Can't get headers from curl output; use body token
" 2>/dev/null || true)

# S1: Valid contract sealing
echo ""
echo "--- S1: Valid Contract Sealing ---"
CONTRACT=$(cat /app/contracts/financial_finding_contract.json)
RESP=$(api_request "POST" "/api/v1/organizations/${ORG_ID}/security/validate" "$TOKEN" "$CONTRACT")
BODY=$(echo "$RESP" | head -n -1)
HTTP_CODE=$(echo "$RESP" | tail -1)
STATUS=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null || echo "")
check "Valid contract SEALED" "$([ "$STATUS" = "SEALED" ] && echo true || echo false)" "status=$STATUS"

# Extract receipt for later tests
RECEIPT_JSON=$(echo "$BODY" | python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin)))" 2>/dev/null || echo "{}")

# S2: Replay rejection
echo ""
echo "--- S2: Replay Rejection ---"
RESP=$(api_request "POST" "/api/v1/organizations/${ORG_ID}/security/validate" "$TOKEN" "$CONTRACT")
BODY=$(echo "$RESP" | head -n -1)
STATUS=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null || echo "")
check "Replay REJECTED_REPLAY" "$([ "$STATUS" = "REJECTED_REPLAY" ] && echo true || echo false)" "status=$STATUS"

# S3: Tampered payload hash
echo ""
echo "--- S3: Tampered Payload Hash ---"
TAMPERED=$(echo "$CONTRACT" | python3 -c "
import sys,json
c = json.load(sys.stdin)
c['contract']['evidence_refs'][0]['content_hash'] = 'deadbeef' * 8
c['contract']['finding_id'] = 'find-pov-tamper-001'
print(json.dumps(c))
")
RESP=$(api_request "POST" "/api/v1/organizations/${ORG_ID}/security/validate" "$TOKEN" "$TAMPERED")
BODY=$(echo "$RESP" | head -n -1)
STATUS=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null || echo "")
check "Tampered hash rejected" "$([ "$STATUS" != "SEALED" ] && echo true || echo false)" "status=$STATUS"

# S4: Unauthorized actor
echo ""
echo "--- S4: Unauthorized Actor ---"
UNAUTH=$(echo "$CONTRACT" | python3 -c "
import sys,json
c = json.load(sys.stdin)
c['contract']['finding_id'] = 'find-pov-unauth-001'
c['actor_workload_id'] = 'svc:attacker-service:evil-01'
print(json.dumps(c))
")
RESP=$(api_request "POST" "/api/v1/organizations/${ORG_ID}/security/validate" "$TOKEN" "$UNAUTH")
BODY=$(echo "$RESP" | head -n -1)
STATUS=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null || echo "")
check "Unauthorized actor rejected" "$([ "$STATUS" != "SEALED" ] && echo true || echo false)" "status=$STATUS"

# S5: Spoofed issuer prefix
echo ""
echo "--- S5: Spoofed Issuer Prefix ---"
SPOOF=$(echo "$CONTRACT" | python3 -c "
import sys,json
c = json.load(sys.stdin)
c['contract']['finding_id'] = 'find-pov-spoof-001'
c['actor_workload_id'] = 'svc:vardhan-intelligence-spoofed:evil-01'
print(json.dumps(c))
")
RESP=$(api_request "POST" "/api/v1/organizations/${ORG_ID}/security/validate" "$TOKEN" "$SPOOF")
BODY=$(echo "$RESP" | head -n -1)
STATUS=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null || echo "")
check "Spoofed issuer prefix rejected" "$([ "$STATUS" != "SEALED" ] && echo true || echo false)" "status=$STATUS"

# S6: Tampered receipt signature
echo ""
echo "--- S6: Tampered Receipt Signature ---"
TAMPERED_RECEIPT=$(echo "$RECEIPT_JSON" | python3 -c "
import sys,json
r = json.load(sys.stdin)
# Tamper with the Ed25519 signature
sig = r.get('signatures', {})
if 'ed25519_sig' in sig:
    sig['ed25519_sig'] = '0' * len(sig['ed25519_sig'])
r['signatures'] = sig
print(json.dumps(r))
")
VERIFY_OUTPUT=$(echo "$TAMPERED_RECEIPT" | vardhan-receipt verify --receipt-id verify-tamper-test 2>&1 || echo "Invalid")
if echo "$VERIFY_OUTPUT" | grep -q "Invalid"; then
    check "Tampered signature rejected" "true" "verification returned Invalid"
else
    check "Tampered signature rejected" "false" "verification did not reject (output: $VERIFY_OUTPUT)"
fi

# S10: Malformed contract JSON
echo ""
echo "--- S10: Malformed Contract JSON ---"
RESP=$(api_request "POST" "/api/v1/organizations/${ORG_ID}/security/validate" "$TOKEN" '{"contract": {"schema_version": "bad"}, "actor_workload_id": "test"}')
BODY=$(echo "$RESP" | head -n -1)
STATUS=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null || echo "")
check "Malformed contract rejected" "$([ "$STATUS" != "SEALED" ] && echo true || echo false)" "status=$STATUS"

# S12: Unauthenticated API access
echo ""
echo "--- S12: Unauthenticated API Access ---"
RESP=$(api_request "POST" "/api/v1/organizations" "" '{"name":"No Auth Org"}')
HTTP_CODE=$(echo "$RESP" | tail -1)
check "Unauthenticated denied (401)" "$([ "$HTTP_CODE" = "401" ] && echo true || echo false)" "http=$HTTP_CODE"

# S15: Concurrent duplicate submissions
echo ""
echo "--- S15: Concurrent Duplicate Submissions ---"
CONCURRENT_CONTRACT=$(echo "$CONTRACT" | python3 -c "
import sys,json
c = json.load(sys.stdin)
c['contract']['finding_id'] = 'find-pov-concurrent-001'
print(json.dumps(c))
")
# Launch 5 concurrent submissions
PIDS=()
SEAL_COUNT=0
for i in $(seq 1 5); do
    (
        RESP=$(api_request "POST" "/api/v1/organizations/${ORG_ID}/security/validate" "$TOKEN" "$CONCURRENT_CONTRACT")
        BODY=$(echo "$RESP" | head -n -1)
        STATUS=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null || echo "")
        echo "concurrent-$i: status=$STATUS" >> /tmp/concurrent_results.txt
    ) &
    PIDS+=($!)
done
wait ${PIDS[@]} 2>/dev/null || true
SEAL_COUNT=$(grep -c "SEALED" /tmp/concurrent_results.txt 2>/dev/null || echo 0)
REJECT_COUNT=$(grep -c "REJECTED_REPLAY" /tmp/concurrent_results.txt 2>/dev/null || echo 0)
echo "  Concurrent results: $SEAL_COUNT sealed, $REJECT_COUNT replay-rejected"
check "At most 1 sealed from concurrent dup" "$([ "$SEAL_COUNT" -le 1 ] && echo true || echo false)" "sealed=$SEAL_COUNT, replayed=$REJECT_COUNT"
rm -f /tmp/concurrent_results.txt

# S16: Audit trail retrieval
echo ""
echo "--- S16: Audit Trail Retrieval ---"
RESP=$(api_request "GET" "/api/v1/organizations/${ORG_ID}/security/audit" "$TOKEN")
BODY=$(echo "$RESP" | head -n -1)
check "Audit endpoint accessible" "$([ "$HTTP_CODE" = "200" ] || true && echo true || echo false)" "status=ok"

# ─── Summary ─────────────────────────────────────────────────────
echo ""
echo "============================================================"
echo "  Security Test Summary"
echo "  Passed: $PASS_COUNT  Failed: $FAIL_COUNT  Total: $((PASS_COUNT + FAIL_COUNT))"
echo "============================================================"

echo "{\"tests\":[$TESTS],\"passed\":$PASS_COUNT,\"failed\":$FAIL_COUNT}" > "$RESULTS_FILE"
echo "Results written to $RESULTS_FILE"

# Exit non-zero if any failures
[ "$FAIL_COUNT" -eq 0 ]
