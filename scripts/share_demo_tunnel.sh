#!/bin/bash
set -euo pipefail

echo "=================================================================="
echo "          VARDHAN Q-CORE: ONE-CLICK DEMO TUNNEL SHARING           "
echo "=================================================================="

# Check if Docker stack or demo.py is running
if ! curl -s -f http://127.0.0.1:3000 >/dev/null 2>&1; then
    echo "[!] Frontend UI on http://localhost:3000 is not reachable."
    echo "[*] Starting Docker stack first..."
    docker compose up -d
    echo "[*] Waiting for services to become healthy..."
    sleep 5
fi

echo "[*] Q-Core Frontend & Backend are online."
echo "[*] Launching free Cloudflare secure HTTPS tunnel to port 3000..."
echo ""
echo "------------------------------------------------------------------"
echo ">>> COPY THE 'trycloudflare.com' LINK BELOW AND SEND TO BUYERS <<<"
echo ">>> Press Ctrl+C when your meeting is finished to close tunnel <<<"
echo "------------------------------------------------------------------"
echo ""

cloudflared tunnel --url http://localhost:3000
