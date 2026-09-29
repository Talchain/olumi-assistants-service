#!/bin/bash
set -euo pipefail

PROD_URL="https://olumi-assistants-service.onrender.com"
TARGET_VERSION="1.1.1"
MAX_ATTEMPTS=20

echo "⏳ Waiting for v$TARGET_VERSION deployment to $PROD_URL..."
echo ""

for i in $(seq 1 $MAX_ATTEMPTS); do
  VERSION=$(curl -s --max-time 5 "$PROD_URL/healthz" | jq -r '.version' 2>/dev/null || echo "error")

  echo "[$i/$MAX_ATTEMPTS] Current version: $VERSION"

  if [ "$VERSION" = "$TARGET_VERSION" ]; then
    echo ""
    echo "✅ v$TARGET_VERSION is LIVE!"
    echo ""
    curl -s "$PROD_URL/healthz" | jq .
    exit 0
  fi

  if [ $i -lt $MAX_ATTEMPTS ]; then
    sleep 15
  fi
done

echo ""
echo "❌ Timeout waiting for v$TARGET_VERSION deployment"
exit 1
