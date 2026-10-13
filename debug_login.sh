#!/bin/bash
export VARDHAN_ADMIN_PASSWORD_FILE="/tmp/vardhan_log_pw"
echo "secure_bootstrap_password_123" > /tmp/vardhan_log_pw
export VARDHAN_ADMIN_USERNAME="admin"
export VARDHAN_CONTROL_PLANE_DATA_DIR="/tmp/vardhan_log_data"
mkdir -p $VARDHAN_CONTROL_PLANE_DATA_DIR

lsof -ti :8080 | xargs kill -9 2>/dev/null || true
sleep 1

cargo build --release --bin control_plane_api
(
  export VARDHAN_ADMIN_USERNAME="$VARDHAN_ADMIN_USERNAME"
  export VARDHAN_ADMIN_PASSWORD_FILE="$VARDHAN_ADMIN_PASSWORD_FILE"
  export VARDHAN_CONTROL_PLANE_DATA_DIR="$VARDHAN_CONTROL_PLANE_DATA_DIR"
  ./target/release/control_plane_api > log_cp.log 2>&1
) &
CP_PID=$!

until curl -s http://localhost:8080/api/v1/platform/health | grep -q "operational"; do sleep 1; done

echo "--- LOGIN ---"
curl -i -X POST http://localhost:8080/api/v1/auth/login \
     -H "Content-Type: application/json" \
     -d '{"username":"admin", "password":"secure_bootstrap_password_123"}'
echo "--- END LOGIN ---"

T=$(curl -s -X POST http://localhost:8080/api/v1/auth/login \
     -H "Content-Type: application/json" \
     -d '{"username":"admin", "password":"secure_bootstrap_password_123"}' | jq -r .token)
echo "Token: $T"

echo "--- PROTECTED CALL ---"
curl -i -H "Authorization: Bearer $T" http://localhost:8080/api/v1/organizations
echo "--- END PROTECTED CALL ---"

kill $CP_PID || true
