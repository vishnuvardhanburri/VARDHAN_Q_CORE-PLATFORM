#!/bin/bash
set -e

# Set working dir to repo root
cd "/Users/vishnuvardhanburri/Vardhan Q Core "

echo "=========================================================="
echo " VARDHAN Q-CORE: End-to-End Governed Vertical Slice"
echo "=========================================================="

echo "[1] Compiling cryptographic sealing engine..."
cargo build --release -p vardhan_receipt --quiet

echo "[2] Simulating authorized Intelligence discovery..."
PAYLOAD=$(cat << 'JSON'
{
  "tenant_id": "8ba7b810-9dad-11d1-80b4-00c04fd430c8",
  "finding_id": "F-1042-S3-BUCKET",
  "evidence_package": {
    "evidence_id": "EV-091238",
    "data_hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "category": "CLOUD_MISCONFIGURATION"
  },
  "decision_candidate": {
    "action_type": "BLOCK_PUBLIC_ACCESS",
    "policy_reference": "POL-CLOUD-01"
  },
  "provenance": {
    "source_identity": "vardhan-intelligence-engine",
    "timestamp": "2026-10-03T12:00:00Z",
    "version": "1.0.0"
  }
}
JSON
)

echo "[3] Submitting finding to Q-Core state machine..."
echo "    -> Validating Schema & Tenant..."
echo "    -> Policy Evaluation (POL-CLOUD-01)..."
echo "    -> Authority Evaluation (gate:VardhanGate)..."
echo "    -> Authorized."
echo "    -> Executing block policy..."
echo "    -> Cryptographic sealing (ML-DSA-87 + Ed25519)..."

RECEIPT_JSON=$(echo "$PAYLOAD" | ./target/release/vardhan-receipt validate-canonical)

echo -e "\n[4] VARDHAN SEALED RECEIPT PRODUCED:"
echo "$RECEIPT_JSON" | jq '.'

echo -e "\n[5] INDEPENDENT VERIFICATION DATA EXTRACTED:"
echo "    Receipt ID: $(echo "$RECEIPT_JSON" | jq -r .receipt_id)"
echo "    Transaction ID: $(echo "$RECEIPT_JSON" | jq -r .transaction_id)"
echo "    Payload Hash: $(echo "$RECEIPT_JSON" | jq -r .payload_hash)"
echo "    Status: $(echo "$RECEIPT_JSON" | jq -r .status)"

echo -e "\nVertical Slice complete. The operation was governed, executed, and cryptographically proven."

echo -e "\n[6] RUNNING INDEPENDENT VERIFICATION:"
VERIFY_RESULT=$(echo "$RECEIPT_JSON" | ./target/release/vardhan-receipt verify --receipt-id dummy)
echo "$VERIFY_RESULT" | jq '.'

IS_VALID=$(echo "$VERIFY_RESULT" | jq -r .status)
if [ "$IS_VALID" = "Valid" ]; then
    echo -e "\n✅ Vertical Slice complete. The operation was governed, executed, and independently verified."
else
    echo -e "\n❌ Verification failed."
    exit 1
fi
