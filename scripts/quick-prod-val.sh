#!/bin/bash
set -euo pipefail

PROD_URL="https://olumi-assistants-service.onrender.com"

echo "🔍 Production Validation - v1.1.1"
echo "=================================="
echo ""

# Test CSV Privacy
echo "1️⃣  CSV Privacy Test:"
CSV_B64="bmFtZSxyZXZlbnVlCkFsaWNlLDEwMDAwCkJvYiwxNTAwMA=="
RESPONSE=$(curl -s -X POST "$PROD_URL/assist/draft-graph" \
  -H "Content-Type: application/json" \
  -d "{\"brief\":\"Analyze this data\",\"attachments\":[{\"id\":\"att_0\",\"kind\":\"document\",\"name\":\"data.csv\"}],\"attachment_payloads\":{\"att_0\":\"$CSV_B64\"}}")

if echo "$RESPONSE" | grep -qE "Alice|Bob"; then
  echo "❌ FAIL: CSV data leaked!"
else
  echo "✅ PASS: No CSV row data in response"
fi
echo ""

# Test Rate Limiting Headers
echo "2️⃣  Rate Limiting Headers:"
HEADERS=$(curl -s -i -X POST "$PROD_URL/assist/draft-graph" \
  -H "Content-Type: application/json" \
  -d '{"brief":"test"}' 2>&1 | grep -i "x-ratelimit")

if [ -n "$HEADERS" ]; then
  echo "✅ PASS: Rate limit headers present"
  echo "$HEADERS"
else
  echo "⚠️  WARNING: No rate limit headers found"
fi
echo ""

# Test CORS
echo "3️⃣  CORS Test (allowed origin):"
CORS_HEADERS=$(curl -s -i -X OPTIONS "$PROD_URL/assist/draft-graph" \
  -H "Origin: https://olumi.app" \
  -H "Access-Control-Request-Method: POST" 2>&1 | grep -i "access-control")

if [ -n "$CORS_HEADERS" ]; then
  echo "✅ PASS: CORS headers present for allowed origin"
  echo "$CORS_HEADERS"
else
  echo "❌ FAIL: CORS not configured"
fi
echo ""

# Test TXT Grounding
echo "4️⃣  TXT Grounding Test:"
TXT_B64=$(echo "Test document content" | base64)
GROUNDING_RESPONSE=$(curl -s -X POST "$PROD_URL/assist/draft-graph" \
  -H "Content-Type: application/json" \
  -d "{\"brief\":\"Analyze this\",\"attachments\":[{\"id\":\"att_0\",\"kind\":\"document\",\"name\":\"test.txt\"}],\"attachment_payloads\":{\"att_0\":\"$TXT_B64\"}}")

NODE_COUNT=$(echo "$GROUNDING_RESPONSE" | jq '.graph.nodes | length')
echo "Nodes returned: $NODE_COUNT"
if [ "$NODE_COUNT" -gt 0 ]; then
  echo "✅ PASS: Grounding works"
else
  echo "⚠️  Grounding returned 0 nodes (fixtures behavior)"
fi
echo ""

echo "=================================="
echo "✅ Core validation complete!"
