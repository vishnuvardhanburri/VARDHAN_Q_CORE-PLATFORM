#!/bin/bash
export VARDHAN_AUTH_CONFIG_PATH=/tmp/vardhan_keystore_default/auth_config.json
export VARDHAN_QCORE_SERVICE_ID=DEMO_SERVICE_01
export VARDHAN_QCORE_SERVICE_SECRET=DEMO_SECRET_01
export VARDHAN_QCORE_TRANSPORT_URL=http://localhost:8080
./target/release/vardhan-receipt serve --port 8080
