#!/bin/bash
export VARDHAN_ADMIN_PASSWORD_FILE="/tmp/vardhan_adv_pw"
echo "secure_bootstrap_password_123" > /tmp/vardhan_adv_pw
export VARDHAN_ADMIN_USERNAME="admin"
export VARDHAN_CONTROL_PLANE_DATA_DIR="/tmp/vardhan_adv_data"
mkdir -p $VARDHAN_CONTROL_PLANE_DATA_DIR

# Kill any existing server
lsof -ti :8080 | xargs kill -9 || true
sleep 1

cargo build --release --bin control_plane_api
(
  export VARDHAN_ADMIN_USERNAME="$VARDHAN_ADMIN_USERNAME"
  export VARDHAN_ADMIN_PASSWORD_FILE="$VARDHAN_ADMIN_PASSWORD_FILE"
  export VARDHAN_CONTROL_PLANE_DATA_DIR="$VARDHAN_CONTROL_PLANE_DATA_DIR"
  ./target/release/control_plane_api > debug_cp.log 2>&1
) &
CP_PID=$!

until curl -s http://localhost:8080/api/v1/platform/health | grep -q "operational"; do
  sleep 1
done

AUTH_BODY=$(curl -s -X POST http://localhost:8080/api/v1/auth/login \
     -H "Content-Type: application/json" \
     -d '{"username":"admin", "password":"secure_bootstrap_password_123"}')
TOKEN=$(echo "$AUTH_BODY" | jq -r .token)
echo "Token: $TOKEN"

# Debugging call_api
tmp_res=$(mktemp)
curl -s -i -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -X POST "http://localhost:8080/api/v1/organizations" \
     -d '{"name":"Debug Corp"}' > "$tmp_res"

echo "--- RAW RESPONSE ---"
cat "$tmp_res"
echo "--- END RAW RESPONSE ---"

BODY=$(awk 'BEGIN {body=0} /^$/ {body=1; next} body {print}' "$tmp_res")
echo "Extracted Body: $BODY"

kill $CP_PID || true
rm "$tmp_res"
