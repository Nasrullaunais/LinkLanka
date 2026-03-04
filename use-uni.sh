#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Detect the outbound IP — whichever interface routes to the internet.
# When connected via mobile hotspot, this reliably picks the hotspot interface IP.
DETECTED_IP=$(ip route get 1.1.1.1 | awk 'NR==1 { for(i=1;i<=NF;i++) if ($i=="src") { print $(i+1); exit } }')

if [ -z "$DETECTED_IP" ]; then
  echo "❌ Could not detect IP address. Make sure your laptop is connected to your phone hotspot."
  exit 1
fi

API_URL="http://$DETECTED_IP:3000"

# Write root .env: all secrets + auto-detected BASE_URL
{
  cat "$SCRIPT_DIR/.env.secrets"
  echo ""
  echo "# ── Auto-detected (university hotspot) ──────────────────────────────────────"
  echo "BASE_URL=$API_URL"
} > "$SCRIPT_DIR/.env"

# Write mobile .env
echo "EXPO_PUBLIC_API_URL=$API_URL" > "$SCRIPT_DIR/apps/mobile/.env"

echo "✅ Switched to UNIVERSITY environment"
echo "   Detected IP : $DETECTED_IP"
echo "   API URL     : $API_URL"
