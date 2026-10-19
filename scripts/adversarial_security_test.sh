#!/bin/bash
set -e

export VARDHAN_ADMIN_PASSWORD_FILE="/tmp/vardhan_adv_pw"
echo "secure_bootstrap_password_123" > /tmp/vardhan_adv_pw
chmod 600 /tmp/vardhan_adv_pw
export VARDHAN_ADMIN_USERNAME="admin"
export VARDHAN_CONTROL_PLANE_DATA_DIR="/tmp/vardhan_adv_data"
mkdir -p $VARDHAN_CONTROL_PLANE_DATA_DIR

lsof -ti :8080 | xargs kill -9 2>/dev/null || true
sleep 1

cargo build --release --bin control_plane_api
(
  export VARDHAN_ADMIN_USERNAME="$VARDHAN_ADMIN_USERNAME"
  export VARDHAN_ADMIN_PASSWORD_FILE="$VARDHAN_ADMIN_PASSWORD_FILE"
  export VARDHAN_CONTROL_PLANE_DATA_DIR="$VARDHAN_CONTROL_PLANE_DATA_DIR"
  ./target/release/control_plane_api > adv_cp.log 2>&1
) &
CP_PID=$!

until curl -s http://localhost:8080/api/v1/platform/health | grep -q "operational"; do
  sleep 1
done
echo "Server is operational."

# Login
AUTH_BODY=$(curl -s -X POST http://localhost:8080/api/v1/auth/login \
     -H "Content-Type: application/json" \
     -d '{"username":"admin", "password":"secure_bootstrap_password_123"}')
TOKEN=$(echo "$AUTH_BODY" | jq -r .token)
echo "Login Token: $TOKEN"

# Setup Org
RES=$(curl -s -i -H "Authorization: Bearer $TOKEN" -X POST http://localhost:8080/api/v1/organizations -H "Content-Type: application/json" -d '{"name":"Adversarial Corp"}')
TOKEN=$(echo "$RES" | grep -i "authorization-new-token:" | sed -E 's/.*Bearer ([a-f0-9]+).*/\1/' | tr -d '\r')
ORG_ID=$(echo "$RES" | sed '1,/^\r*$/d' | jq -r .organization.id)
echo "Org ID: $ORG_ID"

# Create Passport
PASSPORT_ID="PASS-ADV-001"
ASSET_ID="ASSET-ADV-001"
PAYLOAD="{\"passport_id\": \"$PASSPORT_ID\", \"migration_id\": \"MIG-ADV-001\", \"asset_id\": \"$ASSET_ID\", \"blueprint_hash\": \"hash1\", \"blueprint_version\": \"1.0\", \"lifecycle_state\": \"DISCOVERED\", \"timestamp_chain\": []}"
RES=$(curl -s -i -H "Authorization: Bearer $TOKEN" -X POST "http://localhost:8080/api/v1/organizations/$ORG_ID/passports" -H "Content-Type: application/json" -d "$PAYLOAD")
TOKEN=$(echo "$RES" | grep -i "authorization-new-token:" | sed -E 's/.*Bearer ([a-f0-9]+).*/\1/' | tr -d '\r')

# Advance states
for state in "ASSESSED" "BLUEPRINT_PROPOSED" "AUTHORIZED" "EXECUTED"; do
  evidence="VQR-$(echo $state | cut -c1-3)"
  if [ "$state" == "EXECUTED" ]; then evidence="{\"pre\":\"h1\",\"post\":\"h2\"}"; fi
  RES=$(curl -s -i -H "Authorization: Bearer $TOKEN" -X PATCH "http://localhost:8080/api/v1/organizations/$ORG_ID/passports/$PASSPORT_ID" -H "Content-Type: application/json" -d "{\"state\": \"$state\", \"evidence\": \"$evidence\"}")
  TOKEN=$(echo "$RES" | grep -i "authorization-new-token:" | sed -E 's/.*Bearer ([a-f0-9]+).*/\1/' | tr -d '\r')
done

DB_PATH="$VARDHAN_CONTROL_PLANE_DATA_DIR/control_plane.db"

# Test 1: Genuine Receipt
echo "[Test 1] Genuine Receipt..."
GEN_OUT=$(./target/release/receipt_generator "$DB_PATH" "$ORG_ID" "$ASSET_ID" "genuine")
VALID_ID=$(echo "$GEN_OUT" | grep "RECEIPT_ID=" | cut -d= -f2)
RES=$(curl -s -i -H "Authorization: Bearer $TOKEN" -X PATCH "http://localhost:8080/api/v1/organizations/$ORG_ID/passports/$PASSPORT_ID" -H "Content-Type: application/json" -d "{\"state\": \"INDEPENDENTLY_VERIFIED\", \"evidence\": \"$VALID_ID\"}")
TOKEN=$(echo "$RES" | grep -i "authorization-new-token:" | sed -E 's/.*Bearer ([a-f0-9]+).*/\1/' | tr -d '\r')
if echo "$RES" | grep -q "INDEPENDENTLY_VERIFIED"; then 
    echo "✅ PASS"
else 
    echo "❌ FAIL: $(echo "$RES" | sed '1,/^\r*$/d')"; kill $CP_PID || true; exit 1
fi

# Helper for negative tests: Now includes AUTHORIZED state to set the receipt ID
setup_negative_passport() {
    local pid=$1
    local aid=$2
    local rid=$3
    local payload="{\"passport_id\": \"$pid\", \"migration_id\": \"MIG-$pid\", \"asset_id\": \"$aid\", \"blueprint_hash\": \"h1\", \"blueprint_version\": \"1.0\", \"lifecycle_state\": \"DISCOVERED\", \"timestamp_chain\": []}"
    
    # Create
    RES=$(curl -s -i -H "Authorization: Bearer $TOKEN" -X POST "http://localhost:8080/api/v1/organizations/$ORG_ID/passports" -H "Content-Type: application/json" -d "$payload")
    TOKEN=$(echo "$RES" | grep -i "authorization-new-token:" | sed -E 's/.*Bearer ([a-f0-9]+).*/\1/' | tr -d '\r')
    
    # Fast-forward to EXECUTED
    for state in "ASSESSED" "BLUEPRINT_PROPOSED" "AUTHORIZED" "EXECUTED"; do
       ev="VQR-X"
       if [ "$state" == "AUTHORIZED" ]; then ev="$rid"; fi
       if [ "$state" == "EXECUTED" ]; then ev="{\"pre\":\"h1\",\"post\":\"h2\"}"; fi
       RES=$(curl -s -i -H "Authorization: Bearer $TOKEN" -X PATCH "http://localhost:8080/api/v1/organizations/$ORG_ID/passports/$pid" -H "Content-Type: application/json" -d "{\"state\": \"$state\", \"evidence\": \"$ev\"}")
       TOKEN=$(echo "$RES" | grep -i "authorization-new-token:" | sed -E 's/.*Bearer ([a-f0-9]+).*/\1/' | tr -d '\r')
    done
}

echo "[Test 2] Modified Payload..."
P2="PASS-ADV-002"; A2="ASSET-ADV-002"
GEN_OUT=$(./target/release/receipt_generator "$DB_PATH" "$ORG_ID" "$A2" "modified_payload")
MOD_ID=$(echo "$GEN_OUT" | grep "RECEIPT_ID=" | cut -d= -f2)
setup_negative_passport "$P2" "$A2" "$MOD_ID"
RES=$(curl -s -i -H "Authorization: Bearer $TOKEN" -X PATCH "http://localhost:8080/api/v1/organizations/$ORG_ID/passports/$P2" -H "Content-Type: application/json" -d "{\"state\": \"INDEPENDENTLY_VERIFIED\", \"evidence\": \"$MOD_ID\"}")
TOKEN=$(echo "$RES" | grep -i "authorization-new-token:" | sed -E 's/.*Bearer ([a-f0-9]+).*/\1/' | tr -d '\r')
if echo "$RES" | grep -q "error"; then echo "✅ PASS"; else echo "❌ FAIL: $(echo "$RES" | sed '1,/^\r*$/d')"; kill $CP_PID || true; exit 1; fi

echo "[Test 3] Invalid Ed25519..."
P3="PASS-ADV-003"; A3="ASSET-ADV-003"
GEN_OUT=$(./target/release/receipt_generator "$DB_PATH" "$ORG_ID" "$A3" "bad_ed_sig")
BAD_ED_ID=$(echo "$GEN_OUT" | grep "RECEIPT_ID=" | cut -d= -f2)
setup_negative_passport "$P3" "$A3" "$BAD_ED_ID"
RES=$(curl -s -i -H "Authorization: Bearer $TOKEN" -X PATCH "http://localhost:8080/api/v1/organizations/$ORG_ID/passports/$P3" -H "Content-Type: application/json" -d "{\"state\": \"INDEPENDENTLY_VERIFIED\", \"evidence\": \"$BAD_ED_ID\"}")
TOKEN=$(echo "$RES" | grep -i "authorization-new-token:" | sed -E 's/.*Bearer ([a-f0-9]+).*/\1/' | tr -d '\r')
if echo "$RES" | grep -q "error"; then echo "✅ PASS"; else echo "❌ FAIL: $(echo "$RES" | sed '1,/^\r*$/d')"; kill $CP_PID || true; exit 1; fi

echo "[Test 4] Invalid ML-DSA-87..."
P4="PASS-ADV-004"; A4="ASSET-ADV-004"
GEN_OUT=$(./target/release/receipt_generator "$DB_PATH" "$ORG_ID" "$A4" "bad_pq_sig")
BAD_PQ_ID=$(echo "$GEN_OUT" | grep "RECEIPT_ID=" | cut -d= -f2)
setup_negative_passport "$P4" "$A4" "$BAD_PQ_ID"
RES=$(curl -s -i -H "Authorization: Bearer $TOKEN" -X PATCH "http://localhost:8080/api/v1/organizations/$ORG_ID/passports/$P4" -H "Content-Type: application/json" -d "{\"state\": \"INDEPENDENTLY_VERIFIED\", \"evidence\": \"$BAD_PQ_ID\"}")
TOKEN=$(echo "$RES" | grep -i "authorization-new-token:" | sed -E 's/.*Bearer ([a-f0-9]+).*/\1/' | tr -d '\r')
if echo "$RES" | grep -q "error"; then echo "✅ PASS"; else echo "❌ FAIL: $(echo "$RES" | sed '1,/^\r*$/d')"; kill $CP_PID || true; exit 1; fi

echo "[Test 5] Wrong Trusted Key..."
P5="PASS-ADV-005"; A5="ASSET-ADV-005"
GEN_OUT=$(./target/release/receipt_generator "$DB_PATH" "$ORG_ID" "$A5" "wrong_key")
WRONG_K_ID=$(echo "$GEN_OUT" | grep "RECEIPT_ID=" | cut -d= -f2)
setup_negative_passport "$P5" "$A5" "$WRONG_K_ID"
RES=$(curl -s -i -H "Authorization: Bearer $TOKEN" -X PATCH "http://localhost:8080/api/v1/organizations/$ORG_ID/passports/$P5" -H "Content-Type: application/json" -d "{\"state\": \"INDEPENDENTLY_VERIFIED\", \"evidence\": \"$WRONG_K_ID\"}")
TOKEN=$(echo "$RES" | grep -i "authorization-new-token:" | sed -E 's/.*Bearer ([a-f0-9]+).*/\1/' | tr -d '\r')
if echo "$RES" | grep -q "error"; then echo "✅ PASS"; else echo "❌ FAIL: $(echo "$RES" | sed '1,/^\r*$/d')"; kill $CP_PID || true; exit 1; fi

echo "[Test 6] Subject Substitution..."
P6="PASS-ADV-006"; A6="ASSET-ADV-006"
GEN_OUT=$(./target/release/receipt_generator "$DB_PATH" "$ORG_ID" "ASSET-OTHER" "genuine")
SUB_ID=$(echo "$GEN_OUT" | grep "RECEIPT_ID=" | cut -d= -f2)
setup_negative_passport "$P6" "$A6" "$SUB_ID"
RES=$(curl -s -i -H "Authorization: Bearer $TOKEN" -X PATCH "http://localhost:8080/api/v1/organizations/$ORG_ID/passports/$P6" -H "Content-Type: application/json" -d "{\"state\": \"INDEPENDENTLY_VERIFIED\", \"evidence\": \"$SUB_ID\"}")
TOKEN=$(echo "$RES" | grep -i "authorization-new-token:" | sed -E 's/.*Bearer ([a-f0-9]+).*/\1/' | tr -d '\r')
if echo "$RES" | grep -q "error"; then echo "✅ PASS"; else echo "❌ FAIL: $(echo "$RES" | sed '1,/^\r*$/d')"; kill $CP_PID || true; exit 1; fi

echo "[Test 7] Cross-Tenant Substitution..."
ORG_RES_OTHER=$(curl -s -i -H "Authorization: Bearer $TOKEN" -X POST http://localhost:8080/api/v1/organizations -H "Content-Type: application/json" -d '{"name":"Other Corp"}')
TOKEN=$(echo "$ORG_RES_OTHER" | grep -i "authorization-new-token:" | sed -E 's/.*Bearer ([a-f0-9]+).*/\1/' | tr -d '\r')
ORG_ID_OTHER=$(echo "$ORG_RES_OTHER" | sed '1,/^\r*$/d' | jq -r .organization.id)

P7="PASS-ADV-007"; A7="ASSET-ADV-007"
GEN_OUT=$(./target/release/receipt_generator "$DB_PATH" "$ORG_ID_OTHER" "$A7" "genuine")
X_TENANT_ID=$(echo "$GEN_OUT" | grep "RECEIPT_ID=" | cut -d= -f2)
setup_negative_passport "$P7" "$A7" "$X_TENANT_ID"
RES=$(curl -s -i -H "Authorization: Bearer $TOKEN" -X PATCH "http://localhost:8080/api/v1/organizations/$ORG_ID/passports/$P7" -H "Content-Type: application/json" -d "{\"state\": \"INDEPENDENTLY_VERIFIED\", \"evidence\": \"$X_TENANT_ID\"}")
TOKEN=$(echo "$RES" | grep -i "authorization-new-token:" | sed -E 's/.*Bearer ([a-f0-9]+).*/\1/' | tr -d '\r')
if echo "$RES" | grep -q "error"; then echo "✅ PASS"; else echo "❌ FAIL: $(echo "$RES" | sed '1,/^\r*$/d')"; kill $CP_PID || true; exit 1; fi

echo "[Test 8] Trust-service failure..."
P8="PASS-ADV-008"; A8="ASSET-ADV-008"
FAKE_ORG_ID="00000000-0000-0000-0000-000000000000"
GEN_OUT=$(./target/release/receipt_generator "$DB_PATH" "$FAKE_ORG_ID" "$A8" "genuine")
FAKE_ID=$(echo "$GEN_OUT" | grep "RECEIPT_ID=" | cut -d= -f2)
setup_negative_passport "$P8" "$A8" "$FAKE_ID"
RES=$(curl -s -i -H "Authorization: Bearer $TOKEN" -X PATCH "http://localhost:8080/api/v1/organizations/$ORG_ID/passports/$P8" -H "Content-Type: application/json" -d "{\"state\": \"INDEPENDENTLY_VERIFIED\", \"evidence\": \"$FAKE_ID\"}")
TOKEN=$(echo "$RES" | grep -i "authorization-new-token:" | sed -E 's/.*Bearer ([a-f0-9]+).*/\1/' | tr -d '\r')
if echo "$RES" | grep -q "error"; then echo "✅ PASS"; else echo "❌ FAIL: $(echo "$RES" | sed '1,/^\r*$/d')"; kill $CP_PID || true; exit 1; fi

echo "[Test 9] Replay Protection..."
P9="PASS-ADV-009"; A9="ASSET-ADV-009"
GEN_OUT=$(./target/release/receipt_generator "$DB_PATH" "$ORG_ID" "$A9" "genuine")
R9_ID=$(echo "$GEN_OUT" | grep "RECEIPT_ID=" | cut -d= -f2)
setup_negative_passport "$P9" "$A9" "$R9_ID"
RES=$(curl -s -i -H "Authorization: Bearer $TOKEN" -X PATCH "http://localhost:8080/api/v1/organizations/$ORG_ID/passports/$P9" -H "Content-Type: application/json" -d "{\"state\": \"INDEPENDENTLY_VERIFIED\", \"evidence\": \"$R9_ID\"}")
TOKEN=$(echo "$RES" | grep -i "authorization-new-token:" | sed -E 's/.*Bearer ([a-f0-9]+).*/\1/' | tr -d '\r')
if echo "$RES" | grep -q "INDEPENDENTLY_VERIFIED"; then 
    echo "First attempt: OK"
else 
    echo "❌ FAIL: First attempt failed: $(echo "$RES" | sed '1,/^\r*$/d')"; kill $CP_PID || true; exit 1
fi
RES=$(curl -s -i -H "Authorization: Bearer $TOKEN" -X PATCH "http://localhost:8080/api/v1/organizations/$ORG_ID/passports/$P9" -H "Content-Type: application/json" -d "{\"state\": \"INDEPENDENTLY_VERIFIED\", \"evidence\": \"$R9_ID\"}")
TOKEN=$(echo "$RES" | grep -i "authorization-new-token:" | sed -E 's/.*Bearer ([a-f0-9]+).*/\1/' | tr -d '\r')
if echo "$RES" | grep -q "error"; then echo "✅ PASS (Replay rejected)"; else echo "❌ FAIL: Replay accepted: $(echo "$RES" | sed '1,/^\r*$/d')"; kill $CP_PID || true; exit 1; fi

echo "[Test 10] Lifecycle Integrity..."
P_BYPASS="PASS-BYPASS-001"
PASSPORT_BYPASS_PAYLOAD="{\"passport_id\": \"$P_BYPASS\", \"migration_id\": \"MIG-BYPASS\", \"asset_id\": \"ASSET-BYPASS\", \"blueprint_hash\": \"h1\", \"blueprint_version\": \"1.0\", \"lifecycle_state\": \"DISCOVERED\", \"timestamp_chain\": []}"
RES=$(curl -s -i -H "Authorization: Bearer $TOKEN" -X POST "http://localhost:8080/api/v1/organizations/$ORG_ID/passports" -H "Content-Type: application/json" -d "$PASSPORT_BYPASS_PAYLOAD")
TOKEN=$(echo "$RES" | grep -i "authorization-new-token:" | sed -E 's/.*Bearer ([a-f0-9]+).*/\1/' | tr -d '\r')
RES=$(curl -s -i -H "Authorization: Bearer $TOKEN" -X PATCH "http://localhost:8080/api/v1/organizations/$ORG_ID/passports/$P_BYPASS" -H "Content-Type: application/json" -d "{\"state\": \"INDEPENDENTLY_VERIFIED\", \"evidence\": \"$VALID_ID\"}")
TOKEN=$(echo "$RES" | grep -i "authorization-new-token:" | sed -E 's/.*Bearer ([a-f0-9]+).*/\1/' | tr -d '\r')
if echo "$RES" | grep -q "error"; then echo "✅ PASS"; else echo "❌ FAIL: $(echo "$RES" | sed '1,/^\r*$/d')"; kill $CP_PID || true; exit 1; fi

kill $CP_PID || true
echo "ALL ADVERSARIAL SECURITY CHECKS PASSED!"
