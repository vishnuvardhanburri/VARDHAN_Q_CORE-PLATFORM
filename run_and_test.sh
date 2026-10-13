#!/bin/bash
export VARDHAN_ADMIN_USERNAME="admin"
export VARDHAN_ADMIN_PASSWORD="password"
export VARDHAN_CONTROL_PLANE_DATA_DIR="/tmp/vardhan_data_final_test"
export VARDHAN_BOOTSTRAP_PASSWORD="bootstrap_password"
mkdir -p /tmp/vardhan_data_final_test

cargo run --release --bin control_plane_api & 
CP_PID=$!

until curl -s http://localhost:8080/api/v1/platform/health | grep -q "operational"; do
  echo "Waiting for control plane to start..."
  sleep 2
done

echo "Server is finally up!"
./scripts/qtf_tamper_test.sh
kill $CP_PID
