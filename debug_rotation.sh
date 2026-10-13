#!/bin/bash
set -e
export VARDHAN_ADMIN_PASSWORD_FILE="/tmp/vardhan_adv_pw"
echo "secure_bootstrap_password_123" > /tmp/vardhan_adv_pw
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
  ./target/release/control_plane_api > debug_rot.log 2>&1
) &
CP_PID=$!
until curl -s http://localhost:8080/api/v1/platform/health | grep -q "operational"; do sleep 1; done

AUTH_BODY=$(curl -s -X POST http://localhost:8080/api/v1/auth/login \
     -H "Content-Type: application/json" \
     -d '{"username":"admin", "password":"secure_bootstrap_password_123"}')
TOKEN=$(echo "$AUTH_BODY" | jq -r .token)
echo "TOKEN 0: $TOKEN"

RES=$(curl -s -i -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/v1/organizations)
echo "--- RES ---"
echo "$RES"
echo "--- END ---"
NEW_T=$(echo "$RES" | grep -i "authorization-new-token:" | awk '{print $2}' | tr -d '\r' | sed 's/Bearer //')
echo "TOKEN 1: $NEW_T"

kill $CP_PID || true
