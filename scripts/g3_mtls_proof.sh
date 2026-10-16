#!/usr/bin/env bash
# G3 mTLS handshake proof: trusted-client accept + rogue-CA reject + no-cert reject.
#
# Evidence recorded: command invoked, config (env + feature flags), exit code,
# and the exact PASS lines from the integration test.
#
# Usage: scripts/g3_mtls_proof.sh [--keep-certs]
#   Certs are generated at TEST RUNTIME in /tmp (never checked in); the
#   --keep-certs flag only preserves the cargo-test temp dirs for inspection.
set -u
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "=== G3 mTLS proof ==="
echo "config: feature=tls, VARDHAN_TLS_CLIENT_CA_PATH=<runtime /tmp test CA>"
echo "command: cargo test -p control_plane_api --features tls --test g3_mtls_handshake -- --nocapture"

set -o pipefail
cargo test -p control_plane_api --features tls --test g3_mtls_handshake -- --nocapture 2>&1 | tee /tmp/g3_mtls_proof.log
RC=${PIPESTATUS[0]}

echo "---"
echo "exit code: $RC"
echo "evidence lines:"
grep -E "G3-MTLS (TRUSTED-200|ROGUE-REJECTED|NOCERT-REJECTED) PASS|test result:" /tmp/g3_mtls_proof.log || true
echo "log: /tmp/g3_mtls_proof.log"

if [ "$RC" -ne 0 ]; then
  echo "G3-MTLS PROOF: FAIL"
  exit "$RC"
fi
echo "G3-MTLS PROOF: PASS (accept + 2x reject recorded above)"
