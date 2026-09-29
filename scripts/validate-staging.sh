#!/bin/bash
set -euo pipefail

# Staging Validation Script for v1.1.1
# Usage: ./scripts/validate-staging.sh <STAGING_URL>

STAGING_URL="${1:-}"
if [ -z "$STAGING_URL" ]; then
  echo "❌ Error: STAGING_URL required"
  echo "Usage: $0 <STAGING_URL>"
  echo "Example: $0 https://olumi-assistants-staging.onrender.com"
  exit 1
fi

# Remove trailing slash
STAGING_URL="${STAGING_URL%/}"

echo "🔍 Validating staging environment: $STAGING_URL"
echo "================================================"
echo ""

# Test 1: Health Check
echo "1️⃣  Testing /healthz endpoint..."
HEALTH_RESPONSE=$(curl -s "$STAGING_URL/healthz")
echo "$HEALTH_RESPONSE" | jq .

VERSION=$(echo "$HEALTH_RESPONSE" | jq -r '.version')
if [ "$VERSION" != "1.1.1" ]; then
  echo "❌ FAIL: Expected version 1.1.1, got $VERSION"
  exit 1
fi
echo "✅ PASS: Version 1.1.1 confirmed"
echo ""

# Test 2: Basic Draft (No Attachments)
echo "2️⃣  Testing basic draft endpoint..."
DRAFT_RESPONSE=$(curl -s -X POST "$STAGING_URL/assist/draft-graph" \
  -H "Content-Type: application/json" \
  -H "X-Request-Id: test-$(uuidgen)" \
  -d '{"brief":"Should we expand into the EU in 2025? Consider internal capability and market timing."}')

NODE_COUNT=$(echo "$DRAFT_RESPONSE" | jq '.graph.nodes | length')
REQ_ID=$(echo "$DRAFT_RESPONSE" | jq -r '.request_id')

if [ "$NODE_COUNT" -gt 0 ] && [ "$REQ_ID" != "null" ]; then
  echo "✅ PASS: Draft returned $NODE_COUNT nodes, request_id: $REQ_ID"
else
  echo "❌ FAIL: Draft response invalid"
  echo "$DRAFT_RESPONSE" | jq .
  exit 1
fi
echo ""

# Test 3: SSE Streaming
echo "3️⃣  Testing SSE streaming endpoint..."
SSE_RESPONSE=$(curl -N -s -X POST "$STAGING_URL/assist/draft-graph/stream" \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"brief":"This brief is at least thirty characters long for SSE testing."}' | head -20)

if echo "$SSE_RESPONSE" | grep -q "event: stage"; then
  echo "✅ PASS: SSE events received"
else
  echo "❌ FAIL: No SSE events received"
  echo "$SSE_RESPONSE"
  exit 1
fi
echo ""

# Test 4: Grounding with TXT Attachment
echo "4️⃣  Testing document grounding..."
TXT_BASE64=$(echo "Hello World Test Document" | base64)
GROUNDING_RESPONSE=$(curl -s -X POST "$STAGING_URL/assist/draft-graph" \
  -H "Content-Type: application/json" \
  -d "{\"brief\":\"Analyze this document\",\"attachments\":[{\"id\":\"att_0\",\"kind\":\"document\",\"name\":\"test.txt\"}],\"attachment_payloads\":{\"att_0\":\"$TXT_BASE64\"}}")

GROUNDING_NODES=$(echo "$GROUNDING_RESPONSE" | jq '.graph.nodes | length')
if [ "$GROUNDING_NODES" -gt 0 ]; then
  echo "✅ PASS: Grounding works, returned $GROUNDING_NODES nodes"
else
  echo "❌ FAIL: Grounding failed"
  echo "$GROUNDING_RESPONSE" | jq .
  exit 1
fi
echo ""

# Test 5: CSV Privacy (No Row Leakage)
echo "5️⃣  Testing CSV privacy..."
CSV_CONTENT="name,revenue\nAlice,10000\nBob,15000"
CSV_BASE64=$(echo -n "$CSV_CONTENT" | base64)
CSV_RESPONSE=$(curl -s -X POST "$STAGING_URL/assist/draft-graph" \
  -H "Content-Type: application/json" \
  -d "{\"brief\":\"Analyze this data\",\"attachments\":[{\"id\":\"att_0\",\"kind\":\"document\",\"name\":\"data.csv\"}],\"attachment_payloads\":{\"att_0\":\"$CSV_BASE64\"}}")

if echo "$CSV_RESPONSE" | grep -qE "Alice|Bob"; then
  echo "❌ FAIL: CSV row data leaked in response!"
  echo "$CSV_RESPONSE" | jq .
  exit 1
else
  echo "✅ PASS: No CSV row leakage detected"
fi
echo ""

# Test 6: Rate Limiting Headers
echo "6️⃣  Testing rate limiting headers..."
RATE_LIMIT_RESPONSE=$(curl -s -i -X POST "$STAGING_URL/assist/draft-graph" \
  -H "Content-Type: application/json" \
  -d '{"brief":"test"}')

if echo "$RATE_LIMIT_RESPONSE" | grep -qi "x-ratelimit-limit"; then
  GLOBAL_LIMIT=$(echo "$RATE_LIMIT_RESPONSE" | grep -i "x-ratelimit-limit" | awk '{print $2}' | tr -d '\r')
  echo "✅ PASS: Global rate limit: $GLOBAL_LIMIT RPM"
else
  echo "⚠️  WARNING: Rate limit headers not found"
fi

SSE_RATE_LIMIT_RESPONSE=$(curl -s -i -X POST "$STAGING_URL/assist/draft-graph/stream" \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"brief":"test brief for rate limit check that is long enough"}')

if echo "$SSE_RATE_LIMIT_RESPONSE" | grep -qi "x-ratelimit-limit"; then
  SSE_LIMIT=$(echo "$SSE_RATE_LIMIT_RESPONSE" | grep -i "x-ratelimit-limit" | awk '{print $2}' | tr -d '\r')
  echo "✅ PASS: SSE rate limit: $SSE_LIMIT RPM"
else
  echo "⚠️  WARNING: SSE rate limit headers not found"
fi
echo ""

# Test 7: Error Handling (error.v1 Schema)
echo "7️⃣  Testing error.v1 schema..."
ERROR_RESPONSE=$(curl -s -X POST "$STAGING_URL/assist/draft-graph" \
  -H "Content-Type: application/json" \
  -d '{}')

ERROR_SCHEMA=$(echo "$ERROR_RESPONSE" | jq -r '.schema')
ERROR_CODE=$(echo "$ERROR_RESPONSE" | jq -r '.code')

if [ "$ERROR_SCHEMA" = "error.v1" ] && [ "$ERROR_CODE" = "BAD_INPUT" ]; then
  echo "✅ PASS: error.v1 schema confirmed"
else
  echo "❌ FAIL: Invalid error response"
  echo "$ERROR_RESPONSE" | jq .
  exit 1
fi
echo ""

# Test 8: CORS Validation
echo "8️⃣  Testing CORS (preflight)..."
CORS_RESPONSE=$(curl -s -i -X OPTIONS "$STAGING_URL/assist/draft-graph" \
  -H "Origin: https://olumi.app" \
  -H "Access-Control-Request-Method: POST")

if echo "$CORS_RESPONSE" | grep -qi "access-control-allow-origin"; then
  echo "✅ PASS: CORS headers present for allowed origin"
else
  echo "❌ FAIL: CORS not configured correctly"
  echo "$CORS_RESPONSE"
  exit 1
fi
echo ""

echo "================================================"
echo "✅ ALL STAGING VALIDATION TESTS PASSED!"
echo ""
echo "Next steps:"
echo "1. Run Artillery performance tests: PERF_TARGET_URL=$STAGING_URL pnpm perf:baseline"
echo "2. Verify observability (logs, request IDs)"
echo "3. Document results and update PR #2"
