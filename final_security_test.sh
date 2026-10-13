#!/bin/bash
set -e

# 1. Setup Secure Bootstrap Credentials
export VARDHAN_ADMIN_PASSWORD_FILE="/tmp/vardhan_final_verify_pw_fix"
echo "secure_bootstrap_password_123" > $VARDHAN_ADMIN_PASSWORD_FILE
chmod 600 $VARDHAN_ADMIN_PASSWORD_FILE

export VARDHAN_ADMIN_USERNAME="admin"
export VARDHAN_CONTROL_PLANE_DATA_DIR="/tmp/vardhan_final_verify_data_fix"
mkdir -p $VARDHAN_CONTROL_PLANE_DATA_DIR

# 2. Build and Start Server
cargo build --release --bin control_plane_api

(
  export VARDHAN_ADMIN_USERNAME="$VARDHAN_ADMIN_USERNAME"
  export VARDHAN_ADMIN_PASSWORD_FILE="$VARDHAN_ADMIN_PASSWORD_FILE"
  export VARDHAN_CONTROL_PLANE_DATA_DIR="$VARDHAN_CONTROL_PLANE_DATA_DIR"
  ./target/release/control_plane_api > control_plane.log 2>&1
) &
CP_PID=$!

# 3. Wait for Health
MAX_RETRIES=30
COUNT=0
until curl -s http://localhost:8080/api/v1/platform/health | grep -q "operational"; do
  COUNT=$((COUNT+1))
  if [ $COUNT -ge $MAX_RETRIES ]; then
    echo "Timeout. Logs:"
    tail -n 20 control_plane.log
    kill $CP_PID || true
    exit 1
  fi
  sleep 2
done
echo "Server is operational."

# 4. Login
echo "Attempting login..."
AUTH_BODY=$(curl -s -X POST http://localhost:8080/api/v1/auth/login \
     -H "Content-Type: application/json" \
     -d '{"username":"admin", "password":"secure_bootstrap_password_123"}')
TOKEN=$(echo "$AUTH_BODY" | jq -r .token)

if [ "$TOKEN" == "null" ] || [ -z "$TOKEN" ]; then
  echo "Login failed. Body: $AUTH_BODY"
  kill $CP_PID || true
  exit 1
fi
echo "Login successful."

update_token() {
  local res="$1"
  local new_t=$(echo "$res" | grep -i "authorization-new-token:" | head -n 1 | awk '{print $2}' | tr -d '\r' | sed 's/Bearer //')
  if [ -n "$new_t" ]; then
    TOKEN="$new_t"
  fi
}

# 5. Create Org
echo "Creating organization..."
ORG_RES_FULL=$(curl -s -i -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -X POST http://localhost:8080/api/v1/organizations \
     -d '{"name":"Security Test Corp"}')

update_token "$ORG_RES_FULL"
ORG_BODY=$(echo "$ORG_RES_FULL" | sed '1,/^\r\?$/d')
ORG_ID=$(echo "$ORG_BODY" | jq -r .organization.id)

if [ "$ORG_ID" == "null" ] || [ -z "$ORG_ID" ]; then
  echo "Failed to create org. Body: $ORG_BODY"
  kill $CP_PID || true
  exit 1
fi
echo "Org created: $ORG_ID"

# 6. Passport Lifecycle
PASSPORT_ID="PASS-SEC-001"
ASSET_ID="MIG-SEC-001"
PASSPORT_PAYLOAD="{\"passport_id\": \"$PASSPORT_ID\", \"migration_id\": \"MIG-SEC-001\", \"asset_id\": \"$ASSET_ID\", \"blueprint_hash\": \"hash1\", \"blueprint_version\": \"1.0\", \"lifecycle_state\": \"DISCOVERED\", \"timestamp_chain\": []}"

echo "Creating passport..."
RES_FULL=$(curl -s -i -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -X POST "http://localhost:8080/api/v1/organizations/$ORG_ID/passports" \
     -d "$PASSPORT_PAYLOAD")
update_token "$RES_FULL"

echo "Advancing lifecycle states..."
for state in "ASSESSED" "BLUEPRINT_PROPOSED" "AUTHORIZED" "EXECUTED"; do
  evidence="VQR-$(echo $state | cut -c1-3)"
  if [ "$state" == "EXECUTED" ]; then evidence="{\"pre\":\"h1\",\"post\":\"h2\"}"; fi
  
  RES=$(curl -s -i -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
       -X PATCH "http://localhost:8080/api/v1/organizations/$ORG_ID/passports/$PASSPORT_ID" \
       -d "{\"state\": \"$state\", \"evidence\": \"$evidence\"}")
  update_token "$RES"
done

# 7. Generate a Genuine Cryptographic Receipt
echo "[!] Generating genuine signed receipt..."
# The generator needs the path to the Sled DB
DB_PATH="$VARDHAN_CONTROL_PLANE_DATA_DIR/control_plane.db"
GEN_OUT=$(./target/release/receipt_generator "$DB_PATH" "$ORG_ID" "$ASSET_ID")
VALID_RECEIPT_ID=$(echo "$GEN_OUT" | grep "RECEIPT_ID=" | cut -d= -f2)

if [ -z "$VALID_RECEIPT_ID" ]; then
  echo "❌ FAILURE: Failed to generate valid receipt!"
  echo "$GEN_OUT"
  kill $CP_PID || true
  exit 1
fi
echo "Generated Valid Receipt: $VALID_RECEIPT_ID"

# 8. NEGATIVE TEST: Tamper Rejection
echo "[!] Testing Tamper Rejection (Expect 400)..."
RESP=$(curl -s -i -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -X PATCH "http://localhost:8080/api/v1/organizations/$ORG_ID/passports/$PASSPORT_ID" \
     -d "{\"state\": \"INDEPENDENTLY_VERIFIED\", \"evidence\": \"MALICIOUS-RECEIPT\"}")

if echo "$RESP" | grep -q "400 Bad Request"; then
    echo "✅ SUCCESS: Tampered receipt rejected."
else
    echo "❌ FAILURE: Tampered receipt accepted or wrong error!"
    echo "$RESP"
    kill $CP_PID || true
    exit 1
fi

# 9. POSITIVE TEST: Genuine Receipt Acceptance
echo "[!] Testing Genuine Receipt Acceptance (Expect 200)..."
RESP=$(curl -s -i -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -X PATCH "http://localhost:8080/api/v1/organizations/$ORG_ID/passports/$PASSPORT_ID" \
     -d "{\"state\": \"INDEPENDENTLY_VERIFIED\", \"evidence\": \"$VALID_RECEIPT_ID\"}")

if echo "$RESP" | grep -q "200 OK"; then
    echo "✅ SUCCESS: Genuine receipt accepted."
else
    echo "❌ FAILURE: Genuine receipt rejected!"
    echo "$RESP"
    kill $CP_PID || true
    exit 1
fi

kill $CP_PID || true
echo "All security checks passed!"
