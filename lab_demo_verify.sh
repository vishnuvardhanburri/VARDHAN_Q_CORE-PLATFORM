#!/bin/bash
# ===================================================================
# VARDHAN Q-CORE — Lab Demo Verification Script
# ===================================================================
# A tracked, portable, repository-relative verification script that
# validates the core security properties of the receipt engine:
#
#   1. A valid, authorized finding can be sealed.
#   2. Replaying a sealed finding is rejected (REJECTED_REPLAY).
#   3. A malformed or invalid contract/hash is rejected.
#   4. A tampered signature fails independent verification.
#   5. An unauthorized identity is rejected.
#
# Usage:
#   bash lab_demo_verify.sh
#
# Environment:
#   VARDHAN_ENV      (default: development)
#   VARDHAN_KEYSTORE_DIR / VARDHAN_IDEMPOTENCY_DIR override the temp dirs
#
# Exit codes:
#   0 — all 5 tests passed
#   1 — one or more tests failed
# ===================================================================

set -euo pipefail

# ── Resolve repository root (directory containing this script's parent) ─
REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
RECEIPT_BIN="${RECEIPT_BIN:-${REPO_ROOT}/target/release/vardhan-receipt}"

export VARDHAN_ENV="${VARDHAN_ENV:-development}"

# Use isolated temp directories for keystore and idempotency store
TEMP_DB_DIR="$(mktemp -d)"
export VARDHAN_KEYSTORE_DIR="${VARDHAN_KEYSTORE_DIR:-${TEMP_DB_DIR}/keys}"
export VARDHAN_IDEMPOTENCY_DIR="${VARDHAN_IDEMPOTENCY_DIR:-${TEMP_DB_DIR}/idempotency}"
export VARDHAN_AUTH_CONFIG_PATH="${VARDHAN_AUTH_CONFIG_PATH:-${VARDHAN_KEYSTORE_DIR}/auth_config.json}"

# Create required directories
mkdir -p "${VARDHAN_KEYSTORE_DIR}" "${VARDHAN_IDEMPOTENCY_DIR}"

# Clean any persisted idempotency state from prior runs
rm -rf "${VARDHAN_IDEMPOTENCY_DIR}"/*
mkdir -p "${VARDHAN_IDEMPOTENCY_DIR}"

# Clean any persisted keystore from prior runs
rm -rf "${VARDHAN_KEYSTORE_DIR}"/*

echo "=== VARDHAN Q-CORE CONTROLLED LAB DEMONSTRATION ==="
echo "Environment: ${VARDHAN_ENV}"
echo "Binary: ${RECEIPT_BIN}"
echo "Keystore: ${VARDHAN_KEYSTORE_DIR}"
echo "Idempotency: ${VARDHAN_IDEMPOTENCY_DIR}"
echo "--------------------------------------------------"

# Verify the binary exists
if [ ! -f "${RECEIPT_BIN}" ]; then
    echo "ERROR: Receipt binary not found at ${RECEIPT_BIN}"
    echo "Build it first with: cargo build --release -p vardhan_receipt"
    rm -rf "${TEMP_DB_DIR}"
    exit 1
fi

# Create a valid contract for testing
CONTRACT_FILE="${TEMP_DB_DIR}/valid_contract.json"
RECEIPT_FILE="${TEMP_DB_DIR}/receipt.json"
REPLAY_FILE="${TEMP_DB_DIR}/replay.json"
MALFORMED_FILE="${TEMP_DB_DIR}/malformed.json"
MALFORMED_CONTRACT="${TEMP_DB_DIR}/malformed_contract.json"
SIGNED_CONTRACT="${TEMP_DB_DIR}/signed_contract.json"
SIGNED_RECEIPT="${TEMP_DB_DIR}/signed_receipt.json"
VERIFY_RESULT="${TEMP_DB_DIR}/verify_result.json"
UNAUTHORIZED_CONTRACT="${TEMP_DB_DIR}/unauthorized_contract.json"
UNAUTHORIZED_RESULT="${TEMP_DB_DIR}/unauthorized.json"

cat << 'CONTRACT' > "${CONTRACT_FILE}"
{
    "contract": {
        "schema_version": "1.0",
        "finding_id": "find-lab-001",
        "intelligence": {
            "engine_id": "engine-lab-01",
            "engine_version": "1.0.0",
            "run_id": "run-lab-001"
        },
        "organization": {
            "organization_id": "org-vardhan-intelligence",
            "canonical_domain": "lab.vardhan.org"
        },
        "affected_resource": {
            "canonical_url": "https://api.lab.org",
            "surface_type": "API_REST",
            "entry_point_id": "ep-lab-1"
        },
        "technical_area": "STATIC_ANALYSIS",
        "technical_mechanism": "SQLi",
        "expected_behavior": "safe",
        "observed_behavior": "vulnerable",
        "differential_state": "CONFIRMED_MISMATCH",
        "materiality": "HIGH",
        "evidence_refs": [{
            "evidence_id": "ev-lab-001",
            "public_url": "https://evidence.lab.org",
            "temporal_status": "CURRENT",
            "is_context_artifact": false,
            "evidence_origin": "scan",
            "content_hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        }],
        "provenance_chain": {
            "expectation_id": "exp-lab-1",
            "observation_ids": ["obs-lab-1"],
            "differential_id": "diff-lab-1",
            "hypothesis_id": "hyp-lab-1",
            "verification_contract_id": "verif-lab-1"
        },
        "contradictory_evidence_ids": [],
        "uncertainty": [],
        "benign_explanation": "",
        "authorization_context": {
            "requires_authorized_assessment": false
        },
        "decision_candidate": "SEAL_VERIFIED_FINDING",
        "policy_reference": "VARDHAN_CORE_INTELLIGENCE_POLICY_V1",
        "created_at": "2026-10-13T10:00:00Z",
        "evidence_earliest_retrieved_at": "2026-10-13T09:00:00Z",
        "evidence_latest_retrieved_at": "2026-10-13T09:30:00Z"
    },
    "actor_workload_id": "svc:vardhan-intelligence:lab-01"
}
CONTRACT

# ── Test 1: Valid Contract Sealing ──────────────────────────────────
echo "[Test 1] Submitting Valid Contract..."
cat "${CONTRACT_FILE}" | "${RECEIPT_BIN}" validate-canonical > "${RECEIPT_FILE}" 2>/dev/null
if grep -q "SEALED" "${RECEIPT_FILE}"; then
    echo "SUCCESS: Receipt generated and sealed."
else
    echo "FAILURE: Valid contract was not sealed."
    cat "${RECEIPT_FILE}" >&2 || true
    rm -rf "${TEMP_DB_DIR}"
    exit 1
fi

# ── Test 2: Idempotency (Replay Protection) ──────────────────────────
echo "[Test 2] Testing Idempotency (Replay Protection)..."
cat "${CONTRACT_FILE}" | "${RECEIPT_BIN}" validate-canonical > "${REPLAY_FILE}" 2>/dev/null
if grep -q "REJECTED_REPLAY" "${REPLAY_FILE}"; then
    echo "SUCCESS: Replay detected and rejected."
else
    echo "FAILURE: System allowed duplicate sealing of the same finding!"
    cat "${REPLAY_FILE}" >&2 || true
    rm -rf "${TEMP_DB_DIR}"
    exit 1
fi

# ── Test 3: Trust Boundary (Malformed Hash) ─────────────────────────
echo "[Test 3] Testing Trust Boundary (Malformed Hash)..."
# Use a DIFFERENT finding_id to avoid replay detection — testing hash validation
sed 's/find-lab-001/find-lab-003/; s/e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855/deadbeef/' "${CONTRACT_FILE}" > "${MALFORMED_CONTRACT}"
cat "${MALFORMED_CONTRACT}" | "${RECEIPT_BIN}" validate-canonical > "${MALFORMED_FILE}" 2>/dev/null
if grep -q "REJECTED_TRUST_BOUNDARY" "${MALFORMED_FILE}"; then
    echo "SUCCESS: Malformed hash rejected."
else
    echo "FAILURE: Trust Boundary bypassed!"
    cat "${MALFORMED_FILE}" >&2 || true
    rm -rf "${TEMP_DB_DIR}"
    exit 1
fi

# ── Test 4: Tampered Signature Rejection ────────────────────────────
echo "[Test 4] Testing Tampered Signature Rejection..."
# Use a DIFFERENT finding_id — testing signature verification, not idempotency
sed 's/find-lab-001/find-lab-004/' "${CONTRACT_FILE}" > "${SIGNED_CONTRACT}"
cat "${SIGNED_CONTRACT}" | "${RECEIPT_BIN}" validate-canonical > "${SIGNED_RECEIPT}" 2>/dev/null
if ! grep -q "SEALED" "${SIGNED_RECEIPT}"; then
    echo "FAILURE: Could not generate valid receipt for tampering test."
    cat "${SIGNED_RECEIPT}" >&2 || true
    rm -rf "${TEMP_DB_DIR}"
    exit 1
fi
# Tamper with the ed25519_sig and pipe to the independent verifier
# "|| true" prevents set -e from exiting when verify returns non-zero (expected for tampered receipt)
cat "${SIGNED_RECEIPT}" | python3 -c "
import sys, json
r = json.load(sys.stdin)
r['signatures']['ed25519_sig'] = '0' * len(r['signatures']['ed25519_sig'])
print(json.dumps(r))
" | "${RECEIPT_BIN}" verify --receipt-id "tamper-test" > "${VERIFY_RESULT}" 2>&1 || true
if grep -q '"Invalid"' "${VERIFY_RESULT}"; then
    echo "SUCCESS: Tampered signature rejected by independent verifier."
else
    echo "FAILURE: Tampered signature was accepted!"
    cat "${VERIFY_RESULT}" >&2 || true
    rm -rf "${TEMP_DB_DIR}"
    exit 1
fi

# ── Test 5: Unauthorized Identity Rejection ────────────────────────
echo "[Test 5] Testing Unauthorized Identity Rejection..."
# Use a DIFFERENT finding_id — testing authorization boundaries
sed 's/find-lab-001/find-lab-005/; s/svc:vardhan-intelligence:lab-01/unauthorized-hacker/' "${CONTRACT_FILE}" > "${UNAUTHORIZED_CONTRACT}"
cat "${UNAUTHORIZED_CONTRACT}" | "${RECEIPT_BIN}" validate-canonical > "${UNAUTHORIZED_RESULT}" 2>/dev/null
if grep -q "DENY" "${UNAUTHORIZED_RESULT}" || grep -q "REJECTED" "${UNAUTHORIZED_RESULT}"; then
    echo "SUCCESS: Unauthorized identity rejected."
else
    echo "FAILURE: Unauthorized identity was accepted!"
    cat "${UNAUTHORIZED_RESULT}" >&2 || true
    rm -rf "${TEMP_DB_DIR}"
    exit 1
fi

echo "--------------------------------------------------"
echo "FINAL VERDICT: ALL LAB TESTS PASSED"
echo "--------------------------------------------------"

# Cleanup
rm -rf "${TEMP_DB_DIR}"
