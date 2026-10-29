#!/usr/bin/env bash
# Forwarder to demo.py
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec python3 "$DIR/demo.py" "$@"
