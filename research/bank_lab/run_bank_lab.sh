#!/usr/bin/env bash
# Mission F — bank lab orchestrator (synthetic, local-only).
#
# Builds qcore images, brings up 4 synthetic bank-profile services + vault +
# attacker on the isolated `banklab` bridge network, waits healthy, runs the
# adversarial matrix per profile inside the attacker container, runs the
# collector, prints a summary, and tears down (default ON; --keep to inspect).
# Sanitized logs only: status codes and PASS/FAIL — never tokens or passwords.
set -euo pipefail

LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${LAB_DIR}/../.." && pwd)"
COMPOSE_FILE="${LAB_DIR}/docker-compose.bank-lab.yml"
PROFILES=(hsbc jpmorgan lgt swift)
TEARDOWN=1

for arg in "$@"; do
  case "${arg}" in
    --keep) TEARDOWN=0 ;;
    --teardown) TEARDOWN=1 ;;
    -h|--help)
      echo "Usage: $(basename "$0") [--keep|--teardown]"
      echo "  --keep      leave lab running after the matrix (inspect via docker ps)"
      echo "  --teardown  down -v after the matrix (default)"
      exit 0
      ;;
    *) echo "Unknown arg: ${arg}" >&2; exit 2 ;;
  esac
done

compose() { docker compose -f "${COMPOSE_FILE}" "$@"; }

cleanup() {
  if [[ "${TEARDOWN}" -eq 1 ]]; then
    echo "[banklab] teardown (down -v)..."
    compose down -v >/dev/null 2>&1 || compose down -v
  else
    echo "[banklab] --keep: lab left running. Teardown later with:"
    echo "  docker compose -f ${COMPOSE_FILE} down -v   (see TEARDOWN.md)"
  fi
}
trap cleanup EXIT

echo "[banklab] building images..."
compose build --quiet

echo "[banklab] starting lab..."
compose up -d

echo "[banklab] waiting for qcore profiles to report operational..."
ports=(18081 18082 18083 18084)
for port in "${ports[@]}"; do
  ok=0
  for _ in $(seq 1 60); do
    if curl -sf "http://127.0.0.1:${port}/api/v1/platform/health" 2>/dev/null | grep -q operational; then
      ok=1
      break
    fi
    sleep 5
  done
  if [[ "${ok}" -ne 1 ]]; then
    echo "[banklab] FAIL: qcore on host port ${port} never became healthy" >&2
    compose ps
    exit 1
  fi
  echo "[banklab] healthy: 127.0.0.1:${port}"
done

echo "[banklab] waiting for vault dev..."
for _ in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:18200/v1/sys/health" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
curl -sf "http://127.0.0.1:18200/v1/sys/health" >/dev/null \
  || { echo "[banklab] FAIL: vault dev never became healthy" >&2; exit 1; }
echo "[banklab] healthy: vault dev"

# Coverage pointers the matrix records (G2 restart, G3 mTLS, G4 drill):
# the runner does NOT re-run these cargo suites; it asserts the live
# baseline and records where the deep proof lives. Fail fast if the
# pointer files are missing so coverage claims stay honest.
for f in \
  backend/control_plane_api/tests/g2_durable_idempotency.rs \
  backend/control_plane_api/tests/g3_mtls_handshake.rs ; do
  [[ -f "${REPO_ROOT}/${f}" ]] \
    || { echo "[banklab] FAIL: coverage pointer missing: ${f}" >&2; exit 1; }
done

echo "[banklab] running adversarial matrix per profile..."
overall=0
for profile in "${PROFILES[@]}"; do
  qcore_url="http://qcore-${profile}:8080"
  compose exec -T attacker python3 /work/adversarial_matrix.py \
    --profile "${profile}" --qcore-url "${qcore_url}" || overall=1
done

echo "[banklab] collecting results..."
compose --profile collect run --rm collector || overall=1

if [[ "${overall}" -eq 0 ]]; then
  echo "[banklab] RESULT: ALL PROFILES PASS"
else
  echo "[banklab] RESULT: FAILURES PRESENT (see summary above)" >&2
fi
exit "${overall}"
