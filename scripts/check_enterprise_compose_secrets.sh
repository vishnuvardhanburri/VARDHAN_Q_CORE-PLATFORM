#!/usr/bin/env bash
# ==============================================================================
# Vardhan Q-Core — Enterprise Compose Secret Configuration Guard
#
# Validates that docker-compose.enterprise.yml:
# 1. Fails closed (exit non-zero) when required production secrets are missing.
# 2. Succeeds (exit 0) when valid synthetic test secrets are supplied.
# 3. Contains zero hardcoded predictable default secrets.
#
# Standard Baseline: Production Deployment Gate
# Zero emojis across all output.
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_ENTERPRISE="${REPO_ROOT}/docker-compose.enterprise.yml"

echo "=== Vardhan Q-Core: Enterprise Compose Secret Guard ==="

if [ ! -f "${COMPOSE_ENTERPRISE}" ]; then
    echo "[ERROR] ${COMPOSE_ENTERPRISE} not found." >&2
    exit 1
fi

# Test 1: Verify fail-closed behavior when secrets are missing
echo "[Step 1/3] Testing fail-closed behavior without required secrets..."
FAIL_OUTPUT=$(env -i PATH="${PATH}" docker compose -f "${COMPOSE_ENTERPRISE}" --env-file /dev/null config 2>&1 || true)

if echo "${FAIL_OUTPUT}" | grep -q "required variable POSTGRES_PASSWORD is missing"; then
    echo "[PASS] Successfully blocked deployment: POSTGRES_PASSWORD is required."
else
    echo "[FAIL] Enterprise compose did not fail closed on missing POSTGRES_PASSWORD." >&2
    echo "${FAIL_OUTPUT}" >&2
    exit 1
fi

if echo "${FAIL_OUTPUT}" | grep -q "required variable VARDHAN_ADMIN_PASSWORD is missing"; then
    echo "[PASS] Successfully blocked deployment: VARDHAN_ADMIN_PASSWORD is required."
else
    echo "[FAIL] Enterprise compose did not fail closed on missing VARDHAN_ADMIN_PASSWORD." >&2
    echo "${FAIL_OUTPUT}" >&2
    exit 1
fi

# Test 2: Verify successful validation when synthetic test secrets are supplied
echo "[Step 2/3] Testing validation with synthetic test secrets..."
CONFIG_OUTPUT=$(env -i PATH="${PATH}" \
    POSTGRES_PASSWORD="synthetic_test_db_secret_key_12345" \
    VARDHAN_ADMIN_PASSWORD="synthetic_test_admin_secret_key_12345" \
    docker compose -f "${COMPOSE_ENTERPRISE}" --env-file /dev/null config)

if [ -n "${CONFIG_OUTPUT}" ]; then
    echo "[PASS] Enterprise compose configuration validates with synthetic secrets."
else
    echo "[FAIL] Failed to generate configuration with synthetic secrets." >&2
    exit 1
fi

# Test 3: Verify zero predictable or hardcoded fallback secrets in configuration
echo "[Step 3/3] Scanning interpolated configuration for predictable fallback secrets..."
if echo "${CONFIG_OUTPUT}" | grep -iE "vardhan_prod_secure_secret|default_password|change_me"; then
    echo "[FAIL] Predictable fallback password detected in interpolated configuration!" >&2
    exit 1
else
    echo "[PASS] Zero predictable fallback credentials detected in enterprise configuration."
fi

echo "=== Enterprise Compose Secret Guard: ALL CHECKS PASSED ==="
