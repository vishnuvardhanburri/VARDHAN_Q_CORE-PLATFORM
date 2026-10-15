#!/bin/bash
set -e

# Development entrypoint: bootstrap dev auth config and admin password,
# then start the control-plane API.
#
# In production, auth config and admin credentials are injected from
# the deployment secret boundary, not created here.

export VARDHAN_ENV="${VARDHAN_ENV:-development}"
export VARDHAN_KEYSTORE_DIR="${VARDHAN_KEYSTORE_DIR:-/var/lib/vardhan/keystore}"
export VARDHAN_IDEMPOTENCY_DIR="${VARDHAN_IDEMPOTENCY_DIR:-/var/lib/vardhan/idempotency}"
export VARDHAN_AUTH_CONFIG_PATH="${VARDHAN_AUTH_CONFIG_PATH:-/var/lib/vardhan/auth_config/auth_config.json}"

mkdir -p "$VARDHAN_KEYSTORE_DIR" "$VARDHAN_IDEMPOTENCY_DIR" "$(dirname "$VARDHAN_AUTH_CONFIG_PATH")"

# If no auth config exists, create a minimal dev one.
if [ ! -f "$VARDHAN_AUTH_CONFIG_PATH" ]; then
    cat > "$VARDHAN_AUTH_CONFIG_PATH" << 'CFG'
{
    "tenants": {
        "org-vardhan-intelligence": {
            "issuers": ["svc:vardhan-intelligence"],
            "role_claims": {
                "svc:vardhan-intelligence": ["q_core", "audit"]
            }
        }
    }
}
CFG
    chmod 600 "$VARDHAN_AUTH_CONFIG_PATH"
fi

# If no admin password is configured, bootstrap a dev one.
if [ -z "${VARDHAN_ADMIN_PASSWORD_FILE:-}" ] && [ -z "${VARDHAN_ADMIN_PASSWORD:-}" ]; then
    TEMP_PW_FILE=$(mktemp /tmp/admin_pw_XXXXXX)
    echo "dev-strong-password-12345" > "$TEMP_PW_FILE"
    chmod 600 "$TEMP_PW_FILE"
    export VARDHAN_ADMIN_PASSWORD_FILE="$TEMP_PW_FILE"
fi

# Exec the CMD (control_plane_api by default)
exec "$@"
