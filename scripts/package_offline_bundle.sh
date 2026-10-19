#!/usr/bin/env bash
# ===================================================================
# VARDHAN Q-CORE — Air-Gapped Enterprise Package Builder
# ===================================================================
# Compiles and packages all production assets, systemd units, configuration
# templates, and preflight tools into a standalone, air-gapped distribution
# archive for customer server installation.
#
# Usage:
#   ./scripts/package_offline_bundle.sh [VERSION]
# ===================================================================
set -euo pipefail

VERSION="${1:-2026.1-enterprise}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST_DIR="$REPO_ROOT/dist"
BUNDLE_NAME="vardhan-qcore-$VERSION"
STAGE_DIR="$DIST_DIR/$BUNDLE_NAME"

echo "==================================================================="
echo " Packaging Vardhan Q-Core Air-Gapped Distribution: $BUNDLE_NAME"
echo "==================================================================="

mkdir -p "$STAGE_DIR"
mkdir -p "$STAGE_DIR/bin"
mkdir -p "$STAGE_DIR/config"
mkdir -p "$STAGE_DIR/systemd"
mkdir -p "$STAGE_DIR/helm"
mkdir -p "$STAGE_DIR/scripts"

# 1. Compile Release Binaries
echo "[1/5] Building release binaries (control_plane_api, vardhan-receipt, vardhan_verifier)..."
cargo build --release -p control_plane_api -p vardhan_receipt -p vardhan_verifier

cp "$REPO_ROOT/target/release/control_plane_api" "$STAGE_DIR/bin/"
cp "$REPO_ROOT/target/release/vardhan-receipt" "$STAGE_DIR/bin/"
cp "$REPO_ROOT/target/release/vardhan_verifier" "$STAGE_DIR/bin/"
chmod 755 "$STAGE_DIR/bin/"*

# 2. Stage Systemd & Orchestration
echo "[2/5] Staging systemd units and compose templates..."
cp -r "$REPO_ROOT/deploy/systemd/"* "$STAGE_DIR/systemd/"
cp "$REPO_ROOT/docker-compose.enterprise.yml" "$STAGE_DIR/docker-compose.yml"
cp "$REPO_ROOT/docker/Dockerfile.prod" "$STAGE_DIR/Dockerfile"
cp -r "$REPO_ROOT/docker/proxy" "$STAGE_DIR/"

# 3. Stage Helm Chart
echo "[3/5] Staging Helm chart..."
cp -r "$REPO_ROOT/deploy/helm/q-core" "$STAGE_DIR/helm/"

# 4. Stage Configuration & Diagnostics
echo "[4/5] Staging configuration and pre-flight scripts..."
cp "$REPO_ROOT/.env.example" "$STAGE_DIR/config/qcore.env.template"
cp "$REPO_ROOT/scripts/server_preflight.sh" "$STAGE_DIR/scripts/server_preflight.sh"
chmod 755 "$STAGE_DIR/scripts/server_preflight.sh"

# Create installer script
cat << 'INSTALLER' > "$STAGE_DIR/install.sh"
#!/usr/bin/env bash
set -euo pipefail

echo "==================================================================="
echo " Vardhan Q-Core Enterprise Server Installer"
echo "==================================================================="

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Run preflight diagnostics
echo "Running pre-flight system diagnostics..."
"$SCRIPT_DIR/scripts/server_preflight.sh"

# Create vardhan user and directories
if [ "$(id -u)" -eq 0 ]; then
    echo "Configuring system user and permissions..."
    groupadd -g 10001 vardhan 2>/dev/null || true
    useradd -u 10001 -g vardhan -m -d /var/lib/vardhan -s /sbin/nologin vardhan 2>/dev/null || true
    mkdir -p /var/lib/vardhan/control-plane \
             /var/lib/vardhan/keystore \
             /var/lib/vardhan/idempotency \
             /var/lib/vardhan/auth_config \
             /etc/vardhan
    chown -R vardhan:vardhan /var/lib/vardhan /etc/vardhan
    chmod 750 /var/lib/vardhan

    # Install binaries
    cp "$SCRIPT_DIR/bin/"* /usr/local/bin/
    chmod 755 /usr/local/bin/control_plane_api /usr/local/bin/vardhan-receipt /usr/local/bin/vardhan_verifier

    # Install systemd unit
    cp "$SCRIPT_DIR/systemd/vardhan-control-plane.service" /etc/systemd/system/
    systemctl daemon-reload
    echo "Installed binaries to /usr/local/bin and systemd unit to /etc/systemd/system/."
    echo "To configure environment: cp $SCRIPT_DIR/config/qcore.env.template /etc/vardhan/qcore.env"
    echo "To start service: systemctl start vardhan-control-plane"
else
    echo "Notice: Non-root user detected. Running local verification mode."
    echo "Binaries available in: $SCRIPT_DIR/bin"
fi

echo "Installation complete."
INSTALLER
chmod 755 "$STAGE_DIR/install.sh"

# 5. Create Archive
echo "[5/5] Creating compressed tarball..."
tar -czf "$DIST_DIR/$BUNDLE_NAME.tar.gz" -C "$DIST_DIR" "$BUNDLE_NAME"
echo "Created distribution archive: $DIST_DIR/$BUNDLE_NAME.tar.gz"
echo "Sha256: $(shasum -a 256 "$DIST_DIR/$BUNDLE_NAME.tar.gz" | awk '{print $1}')"
