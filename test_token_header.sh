#!/bin/bash
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

AUTH_BODY=$(curl -s -X POST http://localhost:8080/api/v1/auth/login \
     -H "Content-Type: application/json" \
     -d '{"username":"admin", "password":"secure_bootstrap_password_123"}')
TOKEN=$(echo "$AUTH_BODY" | jq -r .token)
echo "Login Token: $TOKEN"

echo "Checking for rotation header..."
curl -s -i -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/v1/platform/health | grep -i "authorization-new-token" || echo "NO HEADER"

kill $CP_PID || true
