#!/bin/bash
set -e

# Setup
export VARDHAN_ADMIN_PASSWORD_FILE="/tmp/vardhan_rot_pw"
echo "secure_bootstrap_password_123" > /tmp/vardhan_rot_pw
export VARDHAN_ADMIN_USERNAME="admin"
export VARDHAN_CONTROL_PLANE_DATA_DIR="/tmp/vardhan_rot_data"
mkdir -p $VARDHAN_CONTROL_PLANE_DATA_DIR

lsof -ti :8080 | xargs kill -9 2>/dev/null || true
sleep 1

cargo build --release --bin control_plane_api
(
  export VARDHAN_ADMIN_USERNAME="$VARDHAN_ADMIN_USERNAME"
  export VARDHAN_ADMIN_PASSWORD_FILE="$VARDHAN_ADMIN_PASSWORD_FILE"
  export VARDHAN_CONTROL_PLANE_DATA_DIR="$VARDHAN_CONTROL_PLANE_DATA_DIR"
  ./target/release/control_plane_api > rot_cp.log 2>&1
) &
CP_PID=$!

until curl -s http://localhost:8080/api/v1/platform/health | grep -q "operational"; do
  sleep 1
done

# 1. Login
AUTH_BODY=$(curl -s -X POST http://localhost:8080/api/v1/auth/login \
     -H "Content-Type: application/json" \
     -d '{"username":"admin", "password":"secure_bootstrap_password_123"}')
TOKEN=$(echo "$AUTH_BODY" | jq -r .token)
echo "Initial Token: $TOKEN"

# 2. Call 1
RES1=$(curl -s -i -H "Authorization: Bearer $TOKEN" -X GET http://localhost:8080/api/v1/platform/health)
NEW_TOKEN=$(echo "$RES1" | grep -i "authorization-new-token:" | awk '{print $2}' | tr -d '\r' | sed 's/Bearer //')
echo "New Token 1: $NEW_TOKEN"

# 3. Call 2 (using New Token 1)
RES2=$(curl -s -i -H "Authorization: Bearer $NEW_TOKEN" -X GET http://localhost:8080/api/v1/platform/health)
if echo "$RES2" | grep -q "200 OK"; then
  echo "✅ Rotation Success"
else
  echo "❌ Rotation Fail"
  echo "$RES2"
fi

kill $CP_PID || true
