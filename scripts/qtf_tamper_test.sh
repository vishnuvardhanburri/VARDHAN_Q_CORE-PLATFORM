#!/bin/bash
set -e

# Set working dir to repo root
cd "/Users/vishnuvardhanburri/antigravity/VARDHAN_Q_CORE-PLATFORM-main"

echo "=========================================================="
echo " VARDHAN Q-CORE: Security Regression - Tamper Test"
echo "=========================================================="

# Setup Auth and Org
AUTH_RES=$(curl -sv -X POST http://localhost:8080/api/v1/auth/login -H "Content-Type: application/json" -d '{"username":"admin", "password":"password"}')
TOKEN=$(echo "$AUTH_RES" | jq -r .token)
ORG_ID=$(curl -sv -H "Authorization: Bearer $TOKEN" -X POST http://localhost:8080/api/v1/organizations -d '{"name":"Tamper Test Corp"}' | jq -r .organization.id)

PASSPORT_ID="PASS-TAMPER-001"
PASSPORT_PAYLOAD="{\"passport_id\": \"$PASSPORT_ID\", \"migration_id\": \"MIG-TAMPER-001\", \"asset_id\": \"MIG-TAMPER-001\", \"blueprint_hash\": \"original_hash\", \"blueprint_version\": \"1.0.0\", \"lifecycle_state\": \"DISCOVERED\", \"timestamp_chain\": []}"

curl -sv -H "Authorization: Bearer $TOKEN" -X POST "http://localhost:8080/api/v1/organizations/$ORG_ID/passports" -d "$PASSPORT_PAYLOAD" > /dev/null

# 1. Valid Transitions to AUTHORIZED
curl -sv -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -X PATCH "http://localhost:8080/api/v1/organizations/$ORG_ID/passports/$PASSPORT_ID" -d "{\"state\": \"ASSESSED\", \"evidence\": \"VQR-VALID-1\"}" > /dev/null
curl -sv -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -X PATCH "http://localhost:8080/api/v1/organizations/$ORG_ID/passports/$PASSPORT_ID" -d "{\"state\": \"BLUEPRINT_PROPOSED\", \"evidence\": \"VQR-VALID-2\"}" > /dev/null
curl -sv -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -X PATCH "http://localhost:8080/api/v1/organizations/$ORG_ID/passports/$PASSPORT_ID" -d "{\"state\": \"AUTHORIZED\", \"evidence\": \"VQR-VALID-3\"}" > /dev/null

# 2. Transition to EXECUTED
EXEC_EVIDENCE="{\"pre_migration_hash\":\"h1\",\"post_migration_hash\":\"h2\",\"execution_log_ref\":\"log1\"}"
curl -sv -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -X PATCH "http://localhost:8080/api/v1/organizations/$ORG_ID/passports/$PASSPORT_ID" -d "{\"state\": \"EXECUTED\", \"evidence\": $EXEC_EVIDENCE}" > /dev/null

# 3. TAMPER TEST: Attempt to reach INDEPENDENTLY_VERIFIED with a MALFORMED receipt
echo "[!] Attempting transition with malformed receipt..."
RESP=$(curl -sv -i -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -X PATCH "http://localhost:8080/api/v1/organizations/$ORG_ID/passports/$PASSPORT_ID" -d "{\"state\": \"INDEPENDENTLY_VERIFIED\", \"evidence\": \"NOT-A-VQR-RECEIPT\"}")

if echo "$RESP" | grep -q "400 Bad Request"; then
    echo "✅ SUCCESS: Tampered receipt was rejected."
else
    echo "❌ FAILURE: Tampered receipt was accepted!"
    echo "$RESP"
    exit 1
fi

# 4. VALID Transition to INDEPENDENTLY_VERIFIED
echo "[!] Attempting transition with valid receipt format..."
RESP=$(curl -sv -i -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -X PATCH "http://localhost:8080/api/v1/organizations/$ORG_ID/passports/$PASSPORT_ID" -d "{\"state\": \"INDEPENDENTLY_VERIFIED\", \"evidence\": \"VQR-VALID-FINAL\"}")

if echo "$RESP" | grep -q "200 OK"; then
    echo "✅ SUCCESS: Valid receipt allowed transition."
else
    echo "❌ FAILURE: Valid receipt was rejected."
    echo "$RESP"
    exit 1
fi
