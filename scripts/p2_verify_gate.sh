#!/bin/bash
set -euo pipefail

echo "=== Building ==="
cargo build --release -p pq_shield -p mock_upstream -p pq_verify -p load_tester >/dev/null 2>&1

echo "=== Cleaning up old state ==="
pkill -9 -f pq_shield || true
pkill -9 -f mock_upstream || true
rm -f /tmp/vardhan_audit_test.jsonl
rm -rf /tmp/vardhan_exports

echo "=== Starting Upstream ==="
./target/release/mock_upstream &
sleep 0.5

echo "=== Starting Proxy (1st run) ==="
export VARDHAN_ADMIN_TOKEN="PROD-SECURE-TOKEN-999"
export VARDHAN_ADMIN_CORS_ORIGIN="null"
export VARDHAN_LEDGER_PATH="/tmp/vardhan_audit_test.jsonl"
export VARDHAN_EXPORT_PATH="/tmp/vardhan_exports"
./target/release/pq_shield &
PROXY_PID=$!
sleep 2

echo "=== Generating Traffic (WRITE -> FSYNC) ==="
cargo run --release -p load_tester >/dev/null 2>&1
sleep 1

echo "=== Simulating Torn Write & Crash ==="
echo -n '{"schema_version": 1, "seq": 99999, "event_id": "torn' >> /tmp/vardhan_audit_test.jsonl
kill -9 $PROXY_PID

echo "=== Restarting Proxy (RECOVER) ==="
./target/release/pq_shield &
PROXY_PID2=$!
sleep 2

echo "=== Generating Traffic (POST-RECOVER) ==="
cargo run --release -p load_tester >/dev/null 2>&1
sleep 1

echo "=== EXPORT EVIDENCE ==="
EXPORT_RESULT=$(curl -s -H "Authorization: Bearer PROD-SECURE-TOKEN-999" http://127.0.0.1:8081/api/v1/ledger/export)
EXPORT_DIR=$(echo "$EXPORT_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['export_dir'])")
echo "Exported to: $EXPORT_DIR"
ls -la "$EXPORT_DIR"

echo "=== OFFLINE VERIFY ==="
VERIFY_RESULT=$(./target/release/pq_verify --evidence-dir "$EXPORT_DIR")
echo "$VERIFY_RESULT" | python3 -m json.tool

echo "=== GENERATE AUDIT REPORT ==="
MANIFEST_CAT=$(cat "$EXPORT_DIR/manifest.json")
TIP_HASH=$(echo "$MANIFEST_CAT" | python3 -c "import sys,json; print(json.load(sys.stdin)['tip_hash'])")
ENTRY_COUNT=$(echo "$MANIFEST_CAT" | python3 -c "import sys,json; print(json.load(sys.stdin)['entry_count'])")
FINGERPRINT=$(echo "$MANIFEST_CAT" | python3 -c "import sys,json; print(json.load(sys.stdin)['signer_pub_fingerprint'])")
TIMESTAMP=$(echo "$MANIFEST_CAT" | python3 -c "import sys,json; print(json.load(sys.stdin)['export_timestamp_ms'])")
VERIFIER_VER=$(echo "$MANIFEST_CAT" | python3 -c "import sys,json; print(json.load(sys.stdin)['verifier_version'])")
VERDICT=$(echo "$VERIFY_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['verdict'])")

cat <<REPORT > "$EXPORT_DIR/AUDIT_REPORT.md"
# Vardhan Quantum Proxy — Cryptographic Audit Report

**Verification Result**: $VERDICT

## Cryptographic Bindings
* **Evidence Bundle ID (Timestamp)**: $TIMESTAMP
* **Ledger Root Hash (Tip)**: $TIP_HASH
* **Entry Count**: $ENTRY_COUNT
* **Public-Key Fingerprint**: $FINGERPRINT
* **Verifier Version**: $VERIFIER_VER

*This report was generated from independently verified offline evidence.*
REPORT
cat "$EXPORT_DIR/AUDIT_REPORT.md"

echo "=== TAMPER MUST FAIL ==="
TAMPERED_DIR="${EXPORT_DIR}_tampered"
cp -r "$EXPORT_DIR" "$TAMPERED_DIR"
sed -i '' '10s/HandshakeCompleted/HandshakeC0rrupted/' "$TAMPERED_DIR/ledger.jsonl"

set +e
TAMPER_RESULT=$(./target/release/pq_verify --evidence-dir "$TAMPERED_DIR")
TAMPER_EXIT=$?
set -e

echo "$TAMPER_RESULT" | python3 -m json.tool

test "$TAMPER_EXIT" -ne 0
echo "$TAMPER_RESULT" | grep '"verdict": "FAIL"' >/dev/null
echo "Tampering detected successfully!"

echo "=== P2 Verification Gate Completed Successfully ==="
pkill -9 -f pq_shield || true
pkill -9 -f mock_upstream || true
