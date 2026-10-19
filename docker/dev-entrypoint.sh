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

# Bootstrap admin password file.
# The auth service reads from VARDHAN_ADMIN_PASSWORD_FILE (preferred).
# If only VARDHAN_ADMIN_PASSWORD is provided, convert it to a file.
# If neither is set, create a default dev password file.
if [ -n "${VARDHAN_ADMIN_PASSWORD:-}" ]; then
    TEMP_PW_FILE=$(mktemp /tmp/admin_pw_XXXXXX)
    echo -n "$VARDHAN_ADMIN_PASSWORD" > "$TEMP_PW_FILE"
    chmod 600 "$TEMP_PW_FILE"
    export VARDHAN_ADMIN_PASSWORD_FILE="$TEMP_PW_FILE"
    unset VARDHAN_ADMIN_PASSWORD
elif [ -z "${VARDHAN_ADMIN_PASSWORD_FILE:-}" ]; then
    if [ "$VARDHAN_ENV" = "production" ] || [ "$VARDHAN_ENV" = "staging" ]; then
        echo "FATAL: VARDHAN_ADMIN_PASSWORD_FILE or VARDHAN_ADMIN_PASSWORD must be explicitly configured in $VARDHAN_ENV." >&2
        exit 1
    fi
    TEMP_PW_FILE=$(mktemp /tmp/admin_pw_XXXXXX)
    DEV_RANDOM_PW=$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')
    echo -n "$DEV_RANDOM_PW" > "$TEMP_PW_FILE"
    chmod 600 "$TEMP_PW_FILE"
    export VARDHAN_ADMIN_PASSWORD_FILE="$TEMP_PW_FILE"
    if [ -d "/var/lib/vardhan/auth_config" ]; then
        echo -n "$DEV_RANDOM_PW" > "/var/lib/vardhan/auth_config/.generated_admin_password"
        chmod 600 "/var/lib/vardhan/auth_config/.generated_admin_password"
    fi
    echo "[Vardhan Entrypoint] Auto-generated dynamic random development admin credential." >&2
fi

# Exec the CMD (control_plane_api by default)
exec "$@"
