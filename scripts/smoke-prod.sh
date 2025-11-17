#!/usr/bin/env bash
set -euo pipefail

# Smoke tests for production Assistants service v1.11.0
#
# Requires:
#   BASE_PROD  - base URL, e.g. https://olumi-assistants-service.onrender.com
#   KEY_PROD   - API key with access to production
#
# This script prints a redaction-safe summary only (no secrets or full bodies).
HAVE_JQ=1
if ! command -v jq >/dev/null 2>&1; then
  HAVE_JQ=0
  echo "WARN: jq not found; printing raw JSON instead of filtered fields." >&2
fi

: "${BASE_PROD:?Set BASE_PROD to the production base URL (e.g. https://example.com)}"
: "${KEY_PROD:?Set KEY_PROD to a production API key (Bearer token)}"

TMP_DIR="${TMPDIR:-./.tmp}"
mkdir -p "$TMP_DIR"

echo "=== [1] Health & Version ==="
HEALTH_JSON=$(curl -fsS -H "Authorization: Bearer $KEY_PROD" "$BASE_PROD/health")
if [[ "$HAVE_JQ" -eq 1 ]]; then
  echo "$HEALTH_JSON" | jq '{version, perf}'
else
  echo "$HEALTH_JSON"
fi
VERSION=$(echo "$HEALTH_JSON" | jq -r '.version // ""')
if [[ "$VERSION" == v1.11.0* ]]; then
  echo "OK: version $VERSION"
else
  echo "WARN: unexpected version: $VERSION (expected v1.11.0*)"
fi

echo
echo "=== [2] Limits (50/200/96 KiB) ==="
LIMITS_JSON=$(curl -fsS -H "Authorization: Bearer $KEY_PROD" "$BASE_PROD/v1/limits")
if [[ "$HAVE_JQ" -eq 1 ]]; then
  echo "$LIMITS_JSON" | jq '{max_nodes, max_edges, graph_max_nodes, graph_max_edges, quota_backend, standard_quota, sse_quota}'
else
  echo "$LIMITS_JSON"
fi
MAX_NODES=$(echo "$LIMITS_JSON" | jq -r '.max_nodes // 0')
MAX_EDGES=$(echo "$LIMITS_JSON" | jq -r '.max_edges // 0')
BACKEND=$(echo "$LIMITS_JSON" | jq -r '.quota_backend // ""')
if [[ "$MAX_NODES" -eq 50 && "$MAX_EDGES" -eq 200 && "$BACKEND" != "" ]]; then
  echo "OK: limits=${MAX_NODES}/${MAX_EDGES}, backend=$BACKEND"
else
  echo "WARN: unexpected limits or backend (see JSON above)"
fi

echo
echo "=== [3] JSON Draft Diagnostics ==="
JSON_RESP=$(curl -fsS -X POST "$BASE_PROD/assist/draft-graph" \
  -H "Authorization: Bearer $KEY_PROD" \
  -H "Content-Type: application/json" \
  -d '{"brief":"A sufficiently long decision brief to exercise the full pipeline end-to-end."}')
if [[ "$HAVE_JQ" -eq 1 ]]; then
  echo "$JSON_RESP" | jq '{schema, diagnostics}'
else
  echo "$JSON_RESP"
fi

echo
echo "=== [4] SSE Stream COMPLETE Diagnostics ==="
SSE_HEADERS="$TMP_DIR/sse-stream-headers.txt"
SSE_BODY="$TMP_DIR/sse-stream-body.log"

curl -fsS -D "$SSE_HEADERS" -N -X POST "$BASE_PROD/assist/draft-graph/stream" \
  -H "Authorization: Bearer $KEY_PROD" \
  -H "Accept: text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"brief":"A sufficiently long decision brief to exercise streaming."}' \
  > "$SSE_BODY"

echo "--- Status + headers ---"
cat "$SSE_HEADERS"

echo "-- X-Request-Id header --"
grep -i 'X-Request-Id' "$SSE_HEADERS" || echo "(not found)"

echo
echo "-- FINAL COMPLETE event (raw) --"
# Print the last stage COMPLETE event block (if present)
awk 'BEGIN{RS="\n\n"} /event: stage/ && /"stage":"COMPLETE"/ {last=$0} END{if (last) print last; else print "(COMPLETE event not found)"}' "$SSE_BODY"

# Extract resume token from first resume event
RESUME_DATA=$(awk 'BEGIN{RS="\n\n"} /event: resume/ {print; exit}' "$SSE_BODY" | awk '/^data: / {sub(/^data: /, ""); print; exit}')
RESUME_TOKEN=""
if [[ -n "$RESUME_DATA" ]]; then
  RESUME_TOKEN=$(printf '%s
' "$RESUME_DATA" | jq -r '.token // ""' || true)
fi

if [[ -z "$RESUME_TOKEN" ]]; then
  echo
  echo "WARN: No resume token found in SSE stream; skipping resume smoke."
else
  echo "$RESUME_TOKEN" > "$TMP_DIR/resume.token"
  echo
  echo "=== [5] Resume Snapshot Diagnostics ==="
  RESUME_BODY="$TMP_DIR/sse-resume-body.log"
  curl -fsS -N -X POST "$BASE_PROD/assist/draft-graph/resume" \
    -H "Authorization: Bearer $KEY_PROD" \
    -H "Accept: text/event-stream" \
    -H "Content-Type: application/json" \
    -d "{\"token\":\"$RESUME_TOKEN\"}" \
    > "$RESUME_BODY"

  echo "-- COMPLETE resume event (raw) --"
  awk 'BEGIN{RS="\n\n"} /event: complete/ {print; exit}' "$RESUME_BODY" || echo "(resume COMPLETE event not found)"

  echo
  echo "(Operator: check that diagnostics.resumes >= 1 and recovered_events >= 0 in the COMPLETE payload.)"
fi

echo
echo "Done. Inspect outputs above and the logs under $TMP_DIR for details."
