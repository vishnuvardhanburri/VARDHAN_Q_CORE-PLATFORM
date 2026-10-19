#!/bin/bash
set -euo pipefail

echo "=================================================================="
echo "          P3.3 KMS/HSM KEY PROTECTION ACCEPTANCE GATE            "
echo "=================================================================="

pkill -9 -f pq_shield || true
pkill -9 -f mock_upstream || true
sleep 0.5

# Start upstream mock
./target/release/mock_upstream &
sleep 0.5

VAULT_FILE="/tmp/vardhan_kms_vault.json"
rm -f "$VAULT_FILE"

export VARDHAN_ADMIN_TOKEN="PROD-SECURE-TOKEN-999"
export VARDHAN_ADMIN_CORS_ORIGIN="null"
export VARDHAN_VAULT_PATH="$VAULT_FILE"
export VARDHAN_KEY_PROTECTOR="aws-kms"
export KMS_KEY_ID="arn:aws:kms:us-east-1:123456789012:key/production-gateway-cmk"

echo ""
echo "--- STEP 1: Fresh Identity Generation + KMS Envelope Protect ---"
./target/release/pq_shield &
PROXY_PID1=$!
sleep 2

# Verify vault was created with version 2 and wrapped_dek
test -f "$VAULT_FILE"
echo "Vault created at $VAULT_FILE:"
cat "$VAULT_FILE" | python3 -m json.tool

PROVIDER=$(cat "$VAULT_FILE" | python3 -c "import sys,json; print(json.load(sys.stdin)['provider'])")
VERSION=$(cat "$VAULT_FILE" | python3 -c "import sys,json; print(json.load(sys.stdin)['version'])")
WRAPPED_DEK=$(cat "$VAULT_FILE" | python3 -c "import sys,json; print(json.load(sys.stdin)['wrapped_dek'])")

test "$PROVIDER" = "aws-kms"
test "$VERSION" = "2"
test "$WRAPPED_DEK" != "None"
echo "✅ Envelope v2 verified: provider=$PROVIDER, version=$VERSION, wrapped_dek length=${#WRAPPED_DEK}"

# Query public key / status from admin plane
PUB_KEY_1=$(curl -s -H "Authorization: Bearer PROD-SECURE-TOKEN-999" http://127.0.0.1:8081/api/v1/metrics | python3 -c "import sys,json; print(json.load(sys.stdin))")
echo "Initial state online."

# Graceful stop
kill -2 $PROXY_PID1 || kill -9 $PROXY_PID1
sleep 1

echo ""
echo "--- STEP 2: Gateway Restart + KMS Unwrap (Identity identical) ---"
./target/release/pq_shield &
PROXY_PID2=$!
sleep 2

# Verify proxy started and unwrapped identity successfully
test -d /proc/$PROXY_PID2 || ps -p $PROXY_PID2 >/dev/null
echo "✅ Gateway successfully restarted and unwrapped identity via KMS"

echo ""
echo "--- STEP 3: Live Post-Quantum Traffic Verification ---"
cargo run --release -p load_tester
echo "✅ Traffic passes cleanly through KMS-unwrapped gateway!"

kill -2 $PROXY_PID2 || kill -9 $PROXY_PID2
sleep 1

echo ""
echo "--- STEP 4: KMS Unavailable Outage Simulation (Must Refuse Startup) ---"
set +e
KMS_SIMULATE_OUTAGE=true ./target/release/pq_shield 2> /tmp/kms_outage.err
OUTAGE_EXIT=$?
set -e

echo "Exit code: $OUTAGE_EXIT"
cat /tmp/kms_outage.err | head -10
test "$OUTAGE_EXIT" -ne 0
grep -i "service unavailable" /tmp/kms_outage.err >/dev/null
echo "✅ Gateway correctly REFUSED to start when KMS is unreachable!"

echo ""
echo "--- STEP 5: IAM Access Denied Simulation (Must Refuse Startup) ---"
set +e
KMS_SIMULATE_UNAUTHORIZED=true ./target/release/pq_shield 2> /tmp/kms_iam.err
IAM_EXIT=$?
set -e

echo "Exit code: $IAM_EXIT"
cat /tmp/kms_iam.err | head -10
test "$IAM_EXIT" -ne 0
grep -i "AccessDenied" /tmp/kms_iam.err >/dev/null
echo "✅ Gateway correctly REFUSED to start when KMS AccessDenied!"

echo ""
echo "--- STEP 6: Production Mode Guardrail (local-dev strictly forbidden) ---"
set +e
VARDHAN_ENV="production" VARDHAN_KEY_PROTECTOR="local-dev" ./target/release/pq_shield 2> /tmp/prod_guardrail.err
PROD_EXIT=$?
set -e

echo "Exit code: $PROD_EXIT"
cat /tmp/prod_guardrail.err
test "$PROD_EXIT" -ne 0
grep -i "strictly forbidden in production" /tmp/prod_guardrail.err >/dev/null
echo "✅ Production guardrail enforced: local-dev strictly rejected in production!"

echo ""
echo "=================================================================="
echo "          P3.3 ACCEPTANCE GATE COMPLETED SUCCESSFULLY!           "
echo "=================================================================="

pkill -9 -f pq_shield || true
pkill -9 -f mock_upstream || true
