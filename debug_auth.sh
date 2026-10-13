#!/bin/bash
export VARDHAN_ADMIN_PASSWORD_FILE="/tmp/vardhan_debug_pw"
echo "bootstrap_password_secure_123" > $VARDHAN_ADMIN_PASSWORD_FILE
chmod 600 $VARDHAN_ADMIN_PASSWORD_FILE
export VARDHAN_ADMIN_USERNAME="admin"
export VARDHAN_CONTROL_PLANE_DATA_DIR="/tmp/vardhan_debug_data"
mkdir -p $VARDHAN_CONTROL_PLANE_DATA_DIR

cargo build --release --bin control_plane_api
./target/release/control_plane_api > debug_cp.log 2>&1 &
CP_PID=$!

until curl -s http://localhost:8080/api/v1/platform/health | grep -q "operational"; do
  sleep 1
done

echo "--- Login Request ---"
curl -v -X POST http://localhost:8080/api/v1/auth/login \
     -H "Content-Type: application/json" \
     -d '{"username":"admin", "password":"password"}'

kill $CP_PID
