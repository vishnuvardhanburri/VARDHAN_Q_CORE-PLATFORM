#!/bin/bash
set -e

DATA_DIR="./control_plane_data_passport_demo"
ADMIN_PASS="strong-password-12345"
ADMIN_PASS_FILE="./admin_pass_demo.txt"
ORG_ID=""
ASSET_ID="MIG-RSA-001"
PASSPORT_ID="PASS-$(date +%s)"

export VARDHAN_CONTROL_PLANE_DATA_DIR=$DATA_DIR
export VARDHAN_ADMIN_USERNAME="admin"
echo $ADMIN_PASS > $ADMIN_PASS_FILE
export VARDHAN_ADMIN_PASSWORD_FILE=$ADMIN_PASS_FILE
export VARDHAN_NODE_ID="control-plane-demo"
mkdir -p $DATA_DIR

./target/release/control_plane_api & 
API_PID=$!
sleep 15

LOGIN_RESPONSE=$(curl -s -X POST http://localhost:8080/api/v1/auth/login \
     -H "Content-Type: application/json" \
     -d "{\"username\": \"admin\", \"password\": \"$ADMIN_PASS\"}")
TOKEN=$(echo $LOGIN_RESPONSE | grep -o '"token":"[^"]*' | cut -d'"' -f4)
echo "Initial Token: $TOKEN"

# Helper to make request and update token
do_request() {
  local method=$1
  local path=$2
  local data=$3
  
  local resp_file=$(mktemp)
  curl -s -i -X $method "http://localhost:8080$path" \
       -H "Content-Type: application/json" \
       -H "Authorization: Bearer $TOKEN" \
       -d "$data" > "$resp_file"
  
  local resp=$(cat "$resp_file")
  rm "$resp_file"

  # Extract new token if present
  local nt=$(echo "$resp" | grep "authorization-new-token:" | awk '{print $2}' | tr -d '\r\n' | sed 's/Bearer //')
  if [ ! -z "$nt" ]; then
    TOKEN=$nt
  fi
  
  echo "$resp" | sed '1,/^\r\?$/d'
}

# 0. Create Organization
echo -e "\n--- [Step 0] Creating Organization ---"
ORG_RESP=$(do_request "POST" "/api/v1/organizations" '{"name": "Vardhan Intelligence"}')
ORG_ID=$(echo "$ORG_RESP" | grep -o '"id":"[^"]*' | cut -d'"' -f4)
echo "Org ID: $ORG_ID"

if [ -z "$ORG_ID" ]; then
  echo "Failed to create organization"
  kill $API_PID
  exit 1
fi

# 1. Create Passport (DISCOVERED)
echo -e "\n--- [Step 1] Creating Passport (DISCOVERED) ---"
DATA='{
  "passport_id": "'$PASSPORT_ID'",
  "migration_id": "MIG-001",
  "asset_id": "'$ASSET_ID'",
  "blueprint_hash": "abcdef123456",
  "blueprint_version": "1.0.0",
  "authorization_receipt_id": null,
  "execution_evidence": null,
  "verification_status": null,
  "lifecycle_state": "DISCOVERED",
  "timestamp_chain": []
}'
echo "Result: $(do_request "POST" "/api/v1/organizations/$ORG_ID/passports" "$DATA")"

# 2. Transition to ASSESSED
echo -e "\n--- [Step 2] Transition to ASSESSED ---"
echo "Result: $(do_request "PATCH" "/api/v1/organizations/$ORG_ID/passports/$PASSPORT_ID" '{"state": "ASSESSED", "evidence": {}}')"

# 3. Transition to BLUEPRINT_PROPOSED
echo -e "\n--- [Step 3] Transition to BLUEPRINT_PROPOSED ---"
echo "Result: $(do_request "PATCH" "/api/v1/organizations/$ORG_ID/passports/$PASSPORT_ID" '{"state": "BLUEPRINT_PROPOSED", "evidence": {}}')"

# 4. Transition to AUTHORIZED (Linked to Receipt)
echo -e "\n--- [Step 4] Transition to AUTHORIZED (Linked to Receipt) ---"
echo "Result: $(do_request "PATCH" "/api/v1/organizations/$ORG_ID/passports/$PASSPORT_ID" '{"state": "AUTHORIZED", "evidence": "VQR-12345-mock-receipt"}')"

# 5. Transition to TESTED
echo -e "\n--- [Step 5] Transition to TESTED ---"
echo "Result: $(do_request "PATCH" "/api/v1/organizations/$ORG_ID/passports/$PASSPORT_ID" '{"state": "TESTED", "evidence": {}}')"

# 6. Transition to EXECUTED
echo -e "\n--- [Step 6] Transition to EXECUTED (Adding Evidence) ---"
DATA_EXEC='{
  "state": "EXECUTED", 
  "evidence": {
    "pre_migration_hash": "hash-old-cfg",
    "post_migration_hash": "hash-new-cfg",
    "execution_log_ref": "log-ref-001"
  }
}'
echo "Result: $(do_request "PATCH" "/api/v1/organizations/$ORG_ID/passports/$PASSPORT_ID" "$DATA_EXEC")"

# 7. Transition to INDEPENDENTLY_VERIFIED
echo -e "\n--- [Step 7] Transition to INDEPENDENTLY_VERIFIED ---"
echo "Result: $(do_request "PATCH" "/api/v1/organizations/$ORG_ID/passports/$PASSPORT_ID" '{"state": "INDEPENDENTLY_VERIFIED", "evidence": {}}')"

# 8. INVALID Transition Test (Jump from DISCOVERED to EXECUTED)
echo -e "\n--- [Step 8] Testing Invalid Lifecycle Transition (DISCOVERED -> EXECUTED) ---"
PASSPORT_FAIL="PASS-FAIL-001"
DATA_FAIL='{
  "passport_id": "'$PASSPORT_FAIL'",
  "migration_id": "MIG-FAIL",
  "asset_id": "'$ASSET_ID'",
  "blueprint_hash": "fail-hash",
  "blueprint_version": "1.0.0",
  "authorization_receipt_id": null,
  "execution_evidence": null,
  "verification_status": null,
  "lifecycle_state": "DISCOVERED",
  "timestamp_chain": []
}'
echo "Passport Created: $(do_request "POST" "/api/v1/organizations/$ORG_ID/passports" "$DATA_FAIL")"
echo "Invalid transition result: $(do_request "PATCH" "/api/v1/organizations/$ORG_ID/passports/$PASSPORT_FAIL" '{"state": "EXECUTED", "evidence": {}}')"

kill $API_PID
rm admin_pass_demo.txt
