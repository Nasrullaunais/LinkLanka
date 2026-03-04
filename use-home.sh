#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cp "$SCRIPT_DIR/.env.home"              "$SCRIPT_DIR/.env"
cp "$SCRIPT_DIR/apps/mobile/.env.home"  "$SCRIPT_DIR/apps/mobile/.env"

echo "✅ Switched to HOME environment"
echo "   API URL: http://192.168.8.107:3000"
