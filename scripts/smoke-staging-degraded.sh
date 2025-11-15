#!/usr/bin/env bash
set -euo pipefail

# Staging degraded-mode smoke for v1.11.0
#
# Requires:
#   BASE_STAGING - staging base URL, e.g. https://olumi-assistants-service-staging.onrender.com
#   KEY_PROD     - API key (staging uses same keyspace)

: "${BASE_STAGING:?Set BASE_STAGING to the staging base URL (e.g. https://staging.example.com)}"
: "${KEY_PROD:?Set KEY_PROD to an API key (Bearer token)}"

TMP_DIR="${TMPDIR:-./.tmp}"
mkdir -p "$TMP_DIR"

echo "=== Staging Degraded-Mode Check ==="
RESP_FILE="$TMP_DIR/staging-degraded-headers.txt"

# Only capture status line + headers (no body)
curl -s -D "$RESP_FILE" -o /dev/null -X POST "$BASE_STAGING/assist/draft-graph/stream" \
  -H "Authorization: Bearer $KEY_PROD" \
  -H "Accept: text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"brief":"A sufficiently long decision brief to exercise degraded mode."}'

echo
echo "--- Status + headers ---"
cat "$RESP_FILE"

echo
if grep -qi 'X-Olumi-Degraded: redis' "$RESP_FILE"; then
  echo "OK: X-Olumi-Degraded: redis header observed on staging stream."
else
  echo "WARN: DEGRADED NOT OBSERVED (no X-Olumi-Degraded: redis header)."
fi

echo
echo "(Operator: ensure Redis is intentionally unavailable on staging when running this, then restore REDIS_URL and redeploy.)"
