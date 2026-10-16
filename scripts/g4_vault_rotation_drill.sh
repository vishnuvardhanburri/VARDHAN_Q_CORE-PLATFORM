#!/usr/bin/env bash
#
# G4 Vault/KMS binding + rotation drill.
#
# Spins up a REAL HashiCorp Vault dev-mode server (genuine transit engine,
# NOT a mock), enables transit, creates key `vardhan-v1`, then runs the
# `vault_rotation_drill` integration test (wrap-v1 -> sign/verify -> rotate
# -> rewrap-v2 -> load+verify -> bad-token-Err -> recovery).
#
# PRODUCTION CAVEAT: the dev-mode HTTP listener below is DRILL-ONLY.
# Production requires a TLS listener + autounseal/HSM + a prod Vault cluster
# (owner-provisioned). Never use `vault server -dev` with production data.
#
# Secrets hygiene: the root token is generated via openssl rand, held in a
# shell variable, exported only to child processes, and NEVER echoed/printed.
# set -x stays OFF; all CLI output is filtered for secret leakage.

set -euo pipefail
# NOTE: set -x is intentionally OFF so token values can never be traced.

VAULT_BIN="${VAULT_BIN:-/tmp/vault}"
VAULT_ADDR_DRILL="http://127.0.0.1:18200"
KEY_NAME="${VARDHAN_VAULT_KEY_NAME:-vardhan-v1}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VAULT_LOG="/tmp/g4-vault-drill.log"
VAULT_PID=""

cleanup() {
  if [[ -n "${VAULT_PID}" ]] && kill -0 "${VAULT_PID}" 2>/dev/null; then
    kill "${VAULT_PID}" 2>/dev/null || true
    wait "${VAULT_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT

die() { echo "G4 DRILL FAIL: $1" >&2; exit 1; }

[[ -x "${VAULT_BIN}" ]] || die "vault binary not executable at ${VAULT_BIN}"
command -v openssl >/dev/null 2>&1 || die "openssl required for token generation"
command -v cargo >/dev/null 2>&1 || die "cargo required to run drill test"

# Generate the dev root token (never echoed).
# shellcheck disable=SC2034
VAULT_DEV_TOKEN="$(openssl rand -hex 16)"

# Start the REAL Vault dev server in background (drill-only HTTP listener).
"${VAULT_BIN}" server -dev \
  -dev-root-token-id="${VAULT_DEV_TOKEN}" \
  -dev-listen-address=127.0.0.1:18200 \
  >"${VAULT_LOG}" 2>&1 &
VAULT_PID="$!"

# Wait for readiness via `vault status` (token passed via env, never printed).
READY=0
for _ in $(seq 1 50); do
  if VAULT_ADDR="${VAULT_ADDR_DRILL}" VAULT_TOKEN="${VAULT_DEV_TOKEN}" \
    "${VAULT_BIN}" status >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 0.2
done
[[ "${READY}" == "1" ]] || die "vault dev server did not become ready (see ${VAULT_LOG})"
echo "G4 vault dev server ready (transit engine: genuine, not a mock)"

# Enable transit + create the drill key (output redirected; values never printed).
export VAULT_ADDR="${VAULT_ADDR_DRILL}"
export VAULT_TOKEN="${VAULT_DEV_TOKEN}"
"${VAULT_BIN}" secrets enable transit >/dev/null 2>&1 \
  || die "failed to enable transit engine"
"${VAULT_BIN}" write -f "transit/keys/${KEY_NAME}" >/dev/null 2>&1 \
  || die "failed to create transit key ${KEY_NAME}"
echo "G4 transit key ready: ${KEY_NAME}"

# Build + run the drill test. Only the key name is exported; addrs/tokens
# flow via env and the test prints key names + lengths only.
export VARDHAN_VAULT_ADDR="${VAULT_ADDR_DRILL}"
export VARDHAN_VAULT_TOKEN="${VAULT_DEV_TOKEN}"
export VARDHAN_VAULT_KEY_NAME="${KEY_NAME}"
cd "${REPO_ROOT}"
if cargo test -p vardhan_keystore --features vault --test vault_rotation_drill -- --nocapture; then
  echo "G4 DRILL PASS: key=${KEY_NAME} (wrap-v1 / rotate / rewrap-v2 / load+verify / bad-token-Err / recovery)"
else
  die "drill test failed"
fi
