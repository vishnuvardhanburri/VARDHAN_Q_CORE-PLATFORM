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
echo "Token: $TOKEN"

# Create org and print raw response
curl -s -X POST http://localhost:8080/api/v1/organizations \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $TOKEN" \
     -d '{"name": "Vardhan Intelligence"}'

kill $API_PID
rm admin_pass_debug.txt
