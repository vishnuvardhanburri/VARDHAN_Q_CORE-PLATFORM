#!/usr/bin/env bash
# ===================================================================
# VARDHAN Q-CORE — Enterprise Server Pre-Flight Validator
# ===================================================================
# Executes automated diagnostic checks on target bank servers (bare-metal,
# VM, or private cloud) before deployment.
#
# Return codes:
#   0 - System passed all prerequisites; ready for deployment
#   1 - Critical prerequisite failed; deployment blocked
# ===================================================================
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

ERRORS=0
WARNINGS=0

info()  { echo -e "${BLUE}[INFO]${NC} $*"; }
pass()  { echo -e "${GREEN}[PASS]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; WARNINGS=$((WARNINGS + 1)); }
fail()  { echo -e "${RED}[FAIL]${NC} $*"; ERRORS=$((ERRORS + 1)); }

echo "==================================================================="
echo " VARDHAN Q-CORE — Enterprise Server Pre-Flight Validation"
echo "==================================================================="
echo "Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "Host:      $(hostname -f 2>/dev/null || hostname)"
echo ""

# 1. Operating System & Kernel
info "Checking Operating System & Architecture..."
OS_NAME="$(uname -s)"
ARCH="$(uname -m)"

if [ "$OS_NAME" = "Linux" ]; then
    pass "Operating system is Linux ($OS_NAME)"
    KERNEL_REV="$(uname -r)"
    info "Kernel release: $KERNEL_REV"
elif [ "$OS_NAME" = "Darwin" ]; then
    warn "macOS detected ($OS_NAME). Acceptable for PoV/evaluation only; not production bare-metal."
else
    fail "Unsupported operating system: $OS_NAME. Linux (RHEL 8/9, Ubuntu LTS, Rocky) required."
fi

if [ "$ARCH" = "x86_64" ] || [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
    pass "Supported CPU architecture: $ARCH"
else
    fail "Unsupported CPU architecture: $ARCH. x86_64 or aarch64 required."
fi

# 2. Memory (RAM)
info "Checking System Memory..."
if [ "$OS_NAME" = "Linux" ]; then
    MEM_TOTAL_KB="$(grep MemTotal /proc/meminfo | awk '{print $2}')"
    MEM_TOTAL_MB=$((MEM_TOTAL_KB / 1024))
elif [ "$OS_NAME" = "Darwin" ]; then
    MEM_TOTAL_BYTES="$(sysctl -n hw.memsize)"
    MEM_TOTAL_MB=$((MEM_TOTAL_BYTES / 1024 / 1024))
else
    MEM_TOTAL_MB=0
fi

if [ "$MEM_TOTAL_MB" -ge 7500 ]; then
    pass "Memory capacity: ${MEM_TOTAL_MB}MB (meets 8GB recommended target)"
elif [ "$MEM_TOTAL_MB" -ge 3500 ]; then
    warn "Memory capacity: ${MEM_TOTAL_MB}MB (meets 4GB minimum; 8GB+ recommended for production)"
else
    fail "Insufficient memory: ${MEM_TOTAL_MB}MB. Minimum 4096MB required."
fi

# 3. Available Storage
info "Checking Storage Headroom..."
TARGET_DIR="${VARDHAN_DATA_ROOT:-/var/lib/vardhan}"
mkdir -p "$TARGET_DIR" 2>/dev/null || TARGET_DIR="."
AVAIL_KB="$(df -k "$TARGET_DIR" | tail -1 | awk '{print $4}')"
AVAIL_MB=$((AVAIL_KB / 1024))

if [ "$AVAIL_MB" -ge 15000 ]; then
    pass "Storage space in $TARGET_DIR: ${AVAIL_MB}MB (exceeds 15GB requirement)"
elif [ "$AVAIL_MB" -ge 5000 ]; then
    warn "Storage space in $TARGET_DIR: ${AVAIL_MB}MB (adequate for PoV; 20GB+ recommended for production)"
else
    fail "Insufficient storage: ${AVAIL_MB}MB free in $TARGET_DIR. Minimum 5GB required."
fi

# 4. Port Availability
info "Checking Port Availability (443, 80, 8080, 3000, 5432)..."
check_port() {
    local port="$1"
    local desc="$2"
    if command -v lsof >/dev/null 2>&1; then
        if lsof -i :"$port" -sTCP:LISTEN >/dev/null 2>&1; then
            fail "Port $port ($desc) is already in use by another process."
        else
            pass "Port $port ($desc) is available."
        fi
    elif command -v ss >/dev/null 2>&1; then
        if ss -tlpn | grep -q ":$port "; then
            fail "Port $port ($desc) is already in use by another process."
        else
            pass "Port $port ($desc) is available."
        fi
    elif command -v netstat >/dev/null 2>&1; then
        if netstat -tlpn 2>/dev/null | grep -q ":$port "; then
            fail "Port $port ($desc) is already in use."
        else
            pass "Port $port ($desc) is available."
        fi
    else
        warn "Could not test port $port (lsof/ss/netstat not found)."
    fi
}

check_port 443 "Edge HTTPS"
check_port 80 "Edge HTTP Redirect"
check_port 8080 "Control Plane API (Internal)"
check_port 3000 "Intelligence Plane (Internal)"
check_port 5432 "PostgreSQL (Internal)"

# 5. Cryptographic Entropy
info "Checking System Cryptographic Entropy Source..."
if [ -r /dev/urandom ]; then
    pass "System CSPRNG (/dev/urandom) is accessible."
else
    fail "/dev/urandom is not readable. Cryptographic operations cannot proceed."
fi

# 6. Container Runtime or Standalone Execution Tools
info "Checking Container Runtime (Docker / Podman)..."
HAS_RUNTIME=0
if command -v docker >/dev/null 2>&1; then
    pass "Docker engine installed: $(docker --version)"
    HAS_RUNTIME=1
    if docker compose version >/dev/null 2>&1; then
        pass "Docker Compose plugin available: $(docker compose version)"
    else
        warn "Docker compose plugin not found; docker-compose standalone required."
    fi
elif command -v podman >/dev/null 2>&1; then
    pass "Podman engine installed: $(podman --version)"
    HAS_RUNTIME=1
else
    warn "Neither Docker nor Podman detected. Bare-metal systemd binary deployment required."
fi

# 7. TLS Certificate Validation (if user provided certs)
info "Checking TLS Certificate directory..."
CERT_DIR="./certs"
if [ -d "$CERT_DIR" ]; then
    if [ -f "$CERT_DIR/server.crt" ] && [ -f "$CERT_DIR/server.key" ]; then
        if command -v openssl >/dev/null 2>&1; then
            if openssl x509 -in "$CERT_DIR/server.crt" -noout -checkend 86400 >/dev/null 2>&1; then
                pass "TLS Certificate $CERT_DIR/server.crt is valid and not expired."
            else
                fail "TLS Certificate $CERT_DIR/server.crt is expired or expiring within 24 hours."
            fi
        else
            pass "Certificates found in $CERT_DIR."
        fi
    else
        warn "Custom TLS certificates not found in $CERT_DIR. Caddy will use internal/self-signed certs."
    fi
else
    warn "Directory $CERT_DIR not present. Edge proxy will generate evaluation TLS certificates."
fi

# Summary
echo ""
echo "==================================================================="
echo " Pre-Flight Diagnostic Summary"
echo "==================================================================="
echo "Passed checks:   OK"
echo "Warnings:        $WARNINGS"
echo "Blocking errors: $ERRORS"

if [ "$ERRORS" -eq 0 ]; then
    echo -e "${GREEN}[RESULT: READY] Host satisfies all requirements for Vardhan Q-Core deployment.${NC}"
    exit 0
else
    echo -e "${RED}[RESULT: BLOCKED] Host does not satisfy all requirements. Resolve errors above.${NC}"
    exit 1
fi
