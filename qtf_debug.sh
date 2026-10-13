#!/bin/bash
set -e

DATA_DIR="./control_plane_data_debug"
export VARDHAN_CONTROL_PLANE_DATA_DIR=$DATA_DIR
export VARDHAN_ADMIN_USERNAME="admin"
echo "strong-password-12345" > admin_pass_debug.txt
export VARDHAN_ADMIN_PASSWORD_FILE="./admin_pass_debug.txt"
export VARDHAN_NODE_ID="control-plane-debug"
mkdir -p $DATA_DIR

./target/release/control_plane_api & 
API_PID=$!
sleep 15

LOGIN_RESPONSE=$(curl -s -X POST http://localhost:8080/api/v1/auth/login \
     -H "Content-Type: application/json" \
     -d '{"username": "admin", "password": "strong-password-12345"}')
TOKEN=$(echo $LOGIN_RESPONSE | grep -o '"token":"[^"]*' | cut -d'"' -f4)
echo "Initial Token: $TOKEN"

echo -e "\n--- Creating Org ---"
RESP1=$(curl -s -i -X POST http://localhost:8080/api/v1/organizations \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $TOKEN" \
     -d '{"name": "Vardhan Intelligence"}')
echo "$RESP1"

# CORRECT token extraction
NEW_TOKEN=$(echo "$RESP1" | grep "authorization-new-token:" | cut -d' ' -f3 | tr -d '\r\n' | sed 's/Bearer //')
echo "New Token: $NEW_TOKEN"

# 2. Create Passport
echo -e "\n--- Creating Passport ---"
curl -s -i -X POST http://localhost:8080/api/v1/organizations/some-id/passports \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $NEW_TOKEN" \
     -d '{"passport_id": "P1", "migration_id": "M1", "asset_id": "A1", "blueprint_hash": "h", "blueprint_version": "1", "lifecycle_state": "DISCOVERED", "timestamp_chain": []}'

kill $API_PID
rm admin_pass_debug.txt
