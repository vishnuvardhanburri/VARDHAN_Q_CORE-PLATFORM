#!/bin/bash
set -e

export VARDHAN_ADMIN_PASSWORD_FILE="/tmp/vardhan_simple_pw"
echo "secure_bootstrap_password_123" > /tmp/vardhan_simple_pw
export VARDHAN_ADMIN_USERNAME="admin"
export VARDHAN_CONTROL_PLANE_DATA_DIR="/tmp/vardhan_simple_data"
mkdir -p $VARDHAN_CONTROL_PLANE_DATA_DIR

lsof -ti :8080 | xargs kill -9 2>/dev/null || true
sleep 1

cargo build --release --bin control_plane_api
(
  export VARDHAN_ADMIN_USERNAME="$VARDHAN_ADMIN_USERNAME"
  export VARDHAN_ADMIN_PASSWORD_FILE="$VARDHAN_ADMIN_PASSWORD_FILE"
  export VARDHAN_CONTROL_PLANE_DATA_DIR="$VARDHAN_CONTROL_PLANE_DATA_DIR"
  ./target/release/control_plane_api > simple_cp.log 2>&1
) &
CP_PID=$!

until curl -s http://localhost:8080/api/v1/platform/health | grep -q "operational"; do sleep 1; done

# 1. Login
AUTH_BODY=$(curl -s -X POST http://localhost:8080/api/v1/auth/login \
     -H "Content-Type: application/json" \
     -d '{"username":"admin", "password":"secure_bootstrap_password_123"}')
TOKEN=$(echo "$AUTH_BODY" | jq -r .token)
echo "T0: $TOKEN"

# 2. Create Org (T0 -> T1)
RES=$(curl -s -i -H "Authorization: Bearer $TOKEN" -X POST http://localhost:8080/api/v1/organizations -H "Content-Type: application/json" -d '{"name":"Simple Corp"}')
T1=$(echo "$RES" | grep -i "authorization-new-token:" | awk '{print $2}' | tr -d '\r' | sed 's/Bearer //')
echo "T1: $T1"

# 3. Check Health (T1 -> T2)
RES=$(curl -s -i -H "Authorization: Bearer $T1" -X GET http://localhost:8080/api/v1/platform/health)
T2=$(echo "$RES" | grep -i "authorization-new-token:" | awk '{print $2}' | tr -d '\r' | sed 's/Bearer //')
echo "T2: $T2"

kill $CP_PID || true
