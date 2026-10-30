#!/bin/bash
set -euo pipefail

# Ensure script runs from the repository root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

echo "=================================================================="
echo "          VARDHAN Q-CORE: ONE-CLICK DEMO TUNNEL SHARING           "
echo "=================================================================="

# Check if Docker daemon is running; if not, attempt to start it
if ! docker info >/dev/null 2>&1; then
    echo "[*] Docker Desktop is not running. Launching Docker Desktop..."
    open -a Docker
    echo "[*] Waiting for Docker daemon to become responsive..."
    for i in {1..30}; do
        if docker info >/dev/null 2>&1; then
            echo "[*] Docker daemon is ready!"
            break
        fi
        sleep 2
    done
fi

# Ensure services are up
if ! curl -s -f http://127.0.0.1:3000 >/dev/null 2>&1; then
    echo "[*] Starting Q-Core Docker stack..."
    docker compose up -d
    echo "[*] Waiting for UI to become healthy..."
    for i in {1..20}; do
        if curl -s -f http://127.0.0.1:3000 >/dev/null 2>&1; then
            break
        fi
        sleep 2
    done
fi

echo "[✓] Q-Core Frontend & Backend are online (HTTP 200)!"
echo "[*] Launching free Cloudflare secure HTTPS tunnel to port 3000..."
echo ""
echo "------------------------------------------------------------------"
echo ">>> COPY THE 'trycloudflare.com' LINK BELOW AND SEND TO BUYERS <<<"
echo ">>> Press Ctrl+C when your meeting is finished to close tunnel <<<"
echo "------------------------------------------------------------------"
echo ""

cloudflared tunnel --url http://localhost:3000
