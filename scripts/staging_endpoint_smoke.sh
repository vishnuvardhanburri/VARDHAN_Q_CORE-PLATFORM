#!/usr/bin/env bash
set -Eeuo pipefail

# Read-only smoke test for a deployed Q-Core staging URL.
# Usage: QCORE_BASE_URL=https://staging.example.com bash scripts/staging_endpoint_smoke.sh
: "${QCORE_BASE_URL:?Set QCORE_BASE_URL to the approved HTTPS staging hostname}"

python3 - "$QCORE_BASE_URL" <<'PY'
import sys
from urllib.parse import urlparse
u = urlparse(sys.argv[1])
if u.scheme != "https" or not u.hostname or u.username or u.password:
    raise SystemExit("FAIL: QCORE_BASE_URL must be an https URL without embedded credentials")
if u.path not in ("", "/") or u.query or u.fragment:
    raise SystemExit("FAIL: QCORE_BASE_URL must contain only scheme and hostname")
PY

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "[1/3] HTTPS endpoint with strict certificate/hostname validation"
status="$(curl --silent --show-error --fail --proto '=https' --tlsv1.2 \
  --output "$tmp/health.json" --write-out '%{http_code}' \
  --connect-timeout 5 --max-time 20 "$QCORE_BASE_URL/api/v1/platform/health")"
[[ "$status" == "200" ]] || { echo "FAIL: health returned HTTP $status" >&2; exit 1; }
python3 - "$tmp/health.json" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as f:
    data = json.load(f)
if not isinstance(data, dict):
    raise SystemExit("FAIL: health endpoint did not return a JSON object")
# Do not conflate internal crypto self-tests with formal FIPS module validation.
if data.get("fips_140_3_validation") == "VALIDATED" and not data.get("fips_140_3_certificate"):
    raise SystemExit("FAIL: health response claims FIPS validation without a certificate identifier")
print("Health JSON parsed. crypto_self_tests =", data.get("crypto_self_tests", "field-not-present"))
print("FIPS validation =", data.get("fips_140_3_validation", "field-not-present"))
PY

echo "[2/3] HTTP must redirect to HTTPS"
redirect="$(curl --silent --show-error --output /dev/null --write-out '%{http_code} %{redirect_url}' \
  --connect-timeout 5 --max-time 15 "${QCORE_BASE_URL/https:\/\//http://}")"
code="${redirect%% *}"
target="${redirect#* }"
[[ "$code" == "301" || "$code" == "308" ]] || { echo "FAIL: HTTP did not redirect (got $redirect)" >&2; exit 1; }
[[ "$target" == https://* ]] || { echo "FAIL: redirect target is not HTTPS ($target)" >&2; exit 1; }

echo "[3/3] Response headers and evidence summary"
curl --silent --show-error --fail --proto '=https' --tlsv1.2 --head \
  --connect-timeout 5 --max-time 15 "$QCORE_BASE_URL/" > "$tmp/headers.txt"
printf 'PASS: HTTPS health and HTTP redirect verified for %s\n' "$QCORE_BASE_URL"
echo "NOTE: This smoke test does not prove multi-node routing, PostgreSQL persistence, receipt verification, replay rejection, HSM use, or formal certification."
