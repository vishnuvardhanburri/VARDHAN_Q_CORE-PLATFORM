#!/bin/bash
set -e

# Ensure data directories exist
mkdir -p "$VARDHAN_CONTROL_PLANE_DATA_DIR" "$VARDHAN_KEYSTORE_DIR" "$VARDHAN_IDEMPOTENCY_DIR"

# Pre-initialize keystore if needed so the signing keys are ready before API starts
RECEIPT_EXEC="${VARDHAN_RECEIPT_BIN:-${VARDHAN_RECEIPT_ENGINE_BIN:-/usr/local/bin/vardhan-receipt}}"
if [ -n "${VARDHAN_KEYSTORE_DIR:-}" ] && [ ! -f "$VARDHAN_KEYSTORE_DIR/keystore_meta.json" ] && [ -x "$RECEIPT_EXEC" ]; then
    "$RECEIPT_EXEC" validate-canonical < /dev/null >/dev/null 2>&1 || true
fi

# If admin password file exists, use it; otherwise bootstrap from env
if [ -f "/run/secrets/admin_password" ]; then
    export VARDHAN_ADMIN_PASSWORD_FILE=/run/secrets/admin_password
fi

# If no admin password source is available, create a temp one for lab use
if [ ! -f "/run/secrets/admin_password" ] && [ -z "$VARDHAN_ADMIN_PASSWORD_FILE" ]; then
    TEMP_PW_FILE=$(mktemp /tmp/admin_pw_XXXXXX)
    echo "P0V-Str0ng-P@ssw0rd-2025!" > "$TEMP_PW_FILE"
    chmod 600 "$TEMP_PW_FILE"
    export VARDHAN_ADMIN_PASSWORD_FILE="$TEMP_PW_FILE"
fi

# Start the control plane API
exec control_plane_api
