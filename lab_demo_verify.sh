#!/bin/bash
# ===================================================================
# VARDHAN Q-CORE — Lab Demo Verification Script (CANONICAL HARNESS)
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
# CANONICAL COPY: this file (BASE/lab_demo_verify.sh) is the single
# source of truth. The root copy at /antigravity/lab_demo_verify.sh is
# a FROZEN reference — do not use it, do not edit it.
#
# Usage (from a clean checkout):
#   ./lab_demo_verify.sh
#   bash lab_demo_verify.sh
#
# Prerequisites:
#   Rust release build: cargo build --release -p vardhan_receipt
#
# Environment:
#   RECEIPT_BIN                (default: ${REPO_ROOT}/target/release/vardhan-receipt)
#   VARDHAN_ENV                (default: development)
#   VARDHAN_KEYSTORE_DIR / VARDHAN_IDEMPOTENCY_DIR override the temp dirs
#   VARDHAN_AUTH_CONFIG_PATH   (default: ${VARDHAN_KEYSTORE_DIR}/auth_config.json)
#   VARDHAN_ENFORCE_MODE       (default: sim; real only honoured on Linux + explicit opt-in)
#
# Exit codes:
#   0 — all checks passed
#   1 — one or more checks failed
#   2 — prerequisites missing
#
# Result semantics:
#   [PASS]      — a REAL check passed (receipt crypto path)
#   [FAIL]      — a REAL check failed
#   [SKIP]      — check skipped (with reason)
#   [SIMULATED] — eBPF/XDP traffic-enforcement placeholder on non-Linux;
#                 receipt seal/verify/replay/trust-boundary/authz checks
#                 below are ALWAYS REAL (they do not need XDP).
#
# macOS note: eBPF/XDP enforcement is unavailable on macOS — traffic-
# enforcement runs as SIMULATED; receipt crypto checks remain REAL.
# ===================================================================

set -euo pipefail

# ── OS / capability detection (eBPF/XDP is Linux-only) ──────────────
OS=$(uname -s)
ARCH=$(uname -m)
if [ "${OS}" != "Linux" ]; then
    ENFORCE_MODE="sim"
    echo "NOTICE: eBPF/XDP enforcement unavailable on ${OS}/${ARCH} — traffic-enforcement checks run as SIMULATED, receipt crypto checks remain REAL"
else
    # Real enforcement only on Linux AND with explicit opt-in.
    ENFORCE_MODE="${VARDHAN_ENFORCE_MODE:-sim}"
    if [ "${ENFORCE_MODE}" = "real" ]; then
        echo "NOTICE: ENFORCE_MODE=real on ${OS}/${ARCH} (explicit opt-in) — traffic-enforcement checks run as REAL"
    else
        ENFORCE_MODE="sim"
        echo "NOTICE: ENFORCE_MODE=sim on ${OS}/${ARCH} — traffic-enforcement checks run as SIMULATED, receipt crypto checks remain REAL"
    fi
fi

# ── Resolve repository root (directory containing this script's parent) ─
REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
RECEIPT_BIN="${RECEIPT_BIN:-${REPO_ROOT}/target/release/vardhan-receipt}"

export VARDHAN_ENV="${VARDHAN_ENV:-development}"

# Use isolated temp directories for keystore and idempotency store
TEMP_DB_DIR="$(mktemp -d)"
trap 'rm -rf "${TEMP_DB_DIR:-}"' EXIT INT TERM
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

# ── Structured result counters ──────────────────────────────────────
PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0
SIMULATED_COUNT=0

HAVE_PYTHON3=0
HAVE_JQ=0
if command -v python3 >/dev/null 2>&1; then HAVE_PYTHON3=1; fi
if command -v jq >/dev/null 2>&1; then HAVE_JQ=1; fi

record_pass() {
    echo "[PASS] $1"
    PASS_COUNT=$((PASS_COUNT + 1))
}

record_fail() {
    echo "[FAIL] $1" >&2
    FAIL_COUNT=$((FAIL_COUNT + 1))
}

record_simulated() {
    echo "[SIMULATED] $1"
    SIMULATED_COUNT=$((SIMULATED_COUNT + 1))
}

# ── Prerequisite checks (fail fast, exit 2) ─────────────────────────
check_prerequisites() {
    local missing=0
    if [ ! -f "${RECEIPT_BIN}" ]; then
        echo "ERROR: Receipt binary not found at ${RECEIPT_BIN}" >&2
        echo "Build it first with: cargo build --release -p vardhan_receipt" >&2
        missing=1
    elif [ ! -x "${RECEIPT_BIN}" ]; then
        echo "ERROR: Receipt binary at ${RECEIPT_BIN} is not executable" >&2
        missing=1
    fi
    if [ "${HAVE_PYTHON3}" -eq 0 ]; then
        echo "ERROR: python3 is required but was not found on PATH" >&2
        missing=1
    fi
    if [ "${HAVE_JQ}" -eq 0 ]; then
        echo "WARNING: jq not found on PATH — continuing with grep+python3 assertions only" >&2
    fi
    if [ "${missing}" -ne 0 ]; then
        rm -rf "${TEMP_DB_DIR:-}"
        exit 2
    fi
}

# ── JSON-aware assertion helper ─────────────────────────────────────
# Returns 0 when the needle is found, 1 otherwise. Uses grep as the
# primary signal and python3 as an independent JSON-aware confirmation;
# both must agree when python3 is available. Falls back to grep alone
# with a note when python3 is missing.
json_contains() {
    local file="$1"
    local needle="$2"
    local grep_ok=0
    local py_ok=0
    if grep -q -- "${needle}" "${file}" 2>/dev/null; then grep_ok=1; fi
    if [ "${HAVE_PYTHON3}" -eq 0 ]; then
        echo "[NOTE] python3 unavailable — grep-only assertion for '${needle}'" >&2
        [ "${grep_ok}" -eq 1 ]
        return
    fi
    if python3 - "${file}" "${needle}" 2>/dev/null <<'PYEOF'; then
import sys, json
path = sys.argv[1]
needle = sys.argv[2]
with open(path, encoding="utf-8") as f:
    raw = f.read()
try:
    hay = json.dumps(json.loads(raw))
except Exception:
    hay = raw
sys.exit(0 if needle in hay else 1)
PYEOF
        py_ok=1
    fi
    if [ "${grep_ok}" -eq 1 ] && [ "${py_ok}" -eq 1 ]; then
        return 0
    fi
    return 1
}

# Either-of-two-needles variant (for the DENY / REJECTED authz check).
json_contains_either() {
    json_contains "$1" "$2" || json_contains "$1" "$3"
}

echo "=== VARDHAN Q-CORE CONTROLLED LAB DEMONSTRATION ==="
echo "Environment: ${VARDHAN_ENV}"
echo "Binary: ${RECEIPT_BIN}"
echo "Keystore: ${VARDHAN_KEYSTORE_DIR}"
echo "Idempotency: ${VARDHAN_IDEMPOTENCY_DIR}"
echo "OS/ARCH: ${OS}/${ARCH}  ENFORCE_MODE=${ENFORCE_MODE}"
echo "--------------------------------------------------"

check_prerequisites

# Traffic-enforcement (eBPF/XDP) is out of scope for the receipt binary;
# report its mode honestly without weakening any receipt assertion.
if [ "${ENFORCE_MODE}" = "sim" ]; then
    record_simulated "traffic-enforcement (eBPF/XDP) not executed on ${OS}/${ARCH} — receipt checks below are REAL"
else
    echo "[INFO] traffic-enforcement mode=real on ${OS}/${ARCH} — receipt checks below are REAL"
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
echo "[CHECK 1/5 seal-valid] Submitting Valid Contract (REAL)..."
"${RECEIPT_BIN}" validate-canonical < "${CONTRACT_FILE}" > "${RECEIPT_FILE}" 2>/dev/null
if json_contains "${RECEIPT_FILE}" "SEALED"; then
    record_pass "Receipt generated and sealed (REAL)."
else
    record_fail "Valid contract was not sealed."
    cat "${RECEIPT_FILE}" >&2 || true
    rm -rf "${TEMP_DB_DIR:-}"
    exit 1
fi

# ── Test 2: Idempotency (Replay Protection) ──────────────────────────
echo "[CHECK 2/5 replay-protection] Testing Idempotency / Replay Protection (REAL)..."
"${RECEIPT_BIN}" validate-canonical < "${CONTRACT_FILE}" > "${REPLAY_FILE}" 2>/dev/null
if json_contains "${REPLAY_FILE}" "REJECTED_REPLAY"; then
    record_pass "Replay detected and rejected (REAL)."
else
    record_fail "System allowed duplicate sealing of the same finding!"
    cat "${REPLAY_FILE}" >&2 || true
    rm -rf "${TEMP_DB_DIR:-}"
    exit 1
fi

# ── Test 3: Trust Boundary (Malformed Hash) ─────────────────────────
echo "[CHECK 3/5 trust-boundary] Testing Trust Boundary / Malformed Hash (REAL)..."
# Use a DIFFERENT finding_id to avoid replay detection — testing hash validation
sed 's/find-lab-001/find-lab-003/; s/e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855/deadbeef/' "${CONTRACT_FILE}" > "${MALFORMED_CONTRACT}"
"${RECEIPT_BIN}" validate-canonical < "${MALFORMED_CONTRACT}" > "${MALFORMED_FILE}" 2>/dev/null
if json_contains "${MALFORMED_FILE}" "REJECTED_TRUST_BOUNDARY"; then
    record_pass "Malformed hash rejected (REAL)."
else
    record_fail "Trust Boundary bypassed!"
    cat "${MALFORMED_FILE}" >&2 || true
    rm -rf "${TEMP_DB_DIR:-}"
    exit 1
fi

# ── Test 4: Tampered Signature Rejection ────────────────────────────
echo "[CHECK 4/5 tamper-rejection] Testing Tampered Signature Rejection (REAL)..."
# Use a DIFFERENT finding_id — testing signature verification, not idempotency
sed 's/find-lab-001/find-lab-004/' "${CONTRACT_FILE}" > "${SIGNED_CONTRACT}"
"${RECEIPT_BIN}" validate-canonical < "${SIGNED_CONTRACT}" > "${SIGNED_RECEIPT}" 2>/dev/null
if ! json_contains "${SIGNED_RECEIPT}" "SEALED"; then
    record_fail "Could not generate valid receipt for tampering test."
    cat "${SIGNED_RECEIPT}" >&2 || true
    rm -rf "${TEMP_DB_DIR:-}"
    exit 1
fi
# Tamper with the ed25519_sig and pipe to the independent verifier
# "|| true" prevents set -e from exiting when verify returns non-zero (expected for tampered receipt)
python3 -c "
import sys, json
r = json.load(sys.stdin)
r['signatures']['ed25519_sig'] = '0' * len(r['signatures']['ed25519_sig'])
print(json.dumps(r))
" < "${SIGNED_RECEIPT}" | "${RECEIPT_BIN}" verify --receipt-id "tamper-test" > "${VERIFY_RESULT}" 2>&1 || true
if json_contains "${VERIFY_RESULT}" '"Invalid"'; then
    record_pass "Tampered signature rejected by independent verifier (REAL)."
else
    record_fail "Tampered signature was accepted!"
    cat "${VERIFY_RESULT}" >&2 || true
    rm -rf "${TEMP_DB_DIR:-}"
    exit 1
fi

# ── Test 5: Unauthorized Identity Rejection ────────────────────────
echo "[CHECK 5/5 authz-rejection] Testing Unauthorized Identity Rejection (REAL)..."
# Use a DIFFERENT finding_id — testing authorization boundaries
sed 's/find-lab-001/find-lab-005/; s/svc:vardhan-intelligence:lab-01/unauthorized-hacker/' "${CONTRACT_FILE}" > "${UNAUTHORIZED_CONTRACT}"
"${RECEIPT_BIN}" validate-canonical < "${UNAUTHORIZED_CONTRACT}" > "${UNAUTHORIZED_RESULT}" 2>/dev/null
if json_contains_either "${UNAUTHORIZED_RESULT}" "DENY" "REJECTED"; then
    record_pass "Unauthorized identity rejected (REAL)."
else
    record_fail "Unauthorized identity was accepted!"
    cat "${UNAUTHORIZED_RESULT}" >&2 || true
    rm -rf "${TEMP_DB_DIR:-}"
    exit 1
fi

echo "--------------------------------------------------"
echo "SUMMARY: PASS=${PASS_COUNT} FAIL=${FAIL_COUNT} SKIP=${SKIP_COUNT} SIMULATED=${SIMULATED_COUNT}"
echo "ENFORCE_MODE=${ENFORCE_MODE} (traffic-enforcement=${ENFORCE_MODE}; receipt checks=REAL)"
if [ "${FAIL_COUNT}" -gt 0 ]; then
    echo "FINAL VERDICT: LAB TESTS FAILED"
else
    echo "FINAL VERDICT: ALL LAB TESTS PASSED"
fi
echo "--------------------------------------------------"

# Cleanup (idempotent with the EXIT/INT/TERM trap above)
rm -rf "${TEMP_DB_DIR:-}"
