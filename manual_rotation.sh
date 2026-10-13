#!/bin/bash
set -e

export VARDHAN_ADMIN_PASSWORD_FILE="/tmp/vardhan_man_pw"
echo "secure_bootstrap_password_123" > /tmp/vardhan_man_pw
export VARDHAN_ADMIN_USERNAME="admin"
export VARDHAN_CONTROL_PLANE_DATA_DIR="/tmp/vardhan_man_data"
mkdir -p $VARDHAN_CONTROL_PLANE_DATA_DIR

lsof -ti :8080 | xargs kill -9 2>/dev/null || true
sleep 1

cargo build --release --bin control_plane_api
(
  export VARDHAN_ADMIN_USERNAME="$VARDHAN_ADMIN_USERNAME"
  export VARDHAN_ADMIN_PASSWORD_FILE="$VARDHAN_ADMIN_PASSWORD_FILE"
  export VARDHAN_CONTROL_PLANE_DATA_DIR="$VARDHAN_CONTROL_PLANE_DATA_DIR"
  ./target/release/control_plane_api > man_cp.log 2>&1
) &
CP_PID=$!

until curl -s http://localhost:8080/api/v1/platform/health | grep -q "operational"; do sleep 1; done

# 1. Login
AUTH_BODY=$(curl -s -X POST http://localhost:8080/api/v1/auth/login \
     -H "Content-Type: application/json" \
     -d '{"username":"admin", "password":"secure_bootstrap_password_123"}')
T0=$(echo "$AUTH_BODY" | jq -r .token)
echo "T0: $T0"

# 2. Create Org
RES1=$(curl -s -i -H "Authorization: Bearer $T0" -X POST http://localhost:8080/api/v1/organizations -H "Content-Type: application/json" -d '{"name":"Manual Corp"}')
T1=$(echo "$RES1" | grep -i "authorization-new-token:" | sed -E 's/.*Bearer ([a-f0-9]+).*/\1/' | tr -d '\r')
echo "T1: $T1"

# 3. Health Check
RES2=$(curl -s -i -H "Authorization: Bearer $T1" -X GET http://localhost:8080/api/v1/platform/health)
T2=$(echo "$RES2" | grep -i "authorization-new-token:" | sed -E 's/.*Bearer ([a-f0-9]+).*/\1/' | tr -d '\r')
echo "T2: $T2"

kill $CP_PID || true
