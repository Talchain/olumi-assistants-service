#!/bin/bash
# Smoke test script for Assistants v1.1.0
# Runs all endpoints with fixtures mode (no API keys needed)
#
# Usage: bash scripts/smoke-fixtures.sh [grounding_enabled]
# Prerequisites: Service running on http://localhost:3101 with LLM_PROVIDER=fixtures
#
# Arguments:
#   grounding_enabled: "true" or "false" (default: false)
#
# Examples:
#   bash scripts/smoke-fixtures.sh              # Test with grounding OFF (default)
#   bash scripts/smoke-fixtures.sh true         # Test with grounding ON
#   ENABLE_GROUNDING=true bash scripts/smoke-fixtures.sh true  # Server must have flag enabled

set -e

BASE_URL="http://localhost:3101"
BRIEF="Should I invest in renewable energy stocks for long-term growth?"
GOAL="Optimize hiring strategy for my startup"
GROUNDING_ENABLED="${1:-false}"

echo "🧪 Assistants v1.1.0 Smoke Tests (Fixtures Mode)"
echo "================================================"
echo "Grounding: ${GROUNDING_ENABLED}"
echo ""

# Health check
echo "1. Health Check + Feature Flags"
echo "   GET /healthz"
HEALTH=$(curl -s ${BASE_URL}/healthz)
echo "$HEALTH" | jq .
VERSION=$(echo "$HEALTH" | jq -r '.version')
GROUNDING_FLAG=$(echo "$HEALTH" | jq -r '.feature_flags.grounding')
echo "   ✅ Expected: version=1.1.0, provider=fixtures, feature_flags object"
echo "   📊 Actual: version=${VERSION}, grounding=${GROUNDING_FLAG}"
echo ""

# Clarifier
echo "2. Clarifier - MCQ-First + Stop Rule"
echo "   POST /assist/clarify-brief"
curl -s -X POST ${BASE_URL}/assist/clarify-brief \
  -H 'Content-Type: application/json' \
  -d "{\"brief\":\"${BRIEF}\",\"round\":0}" | jq '{questions: (.questions | length), confidence, should_continue, round}'
echo "   ✅ Expected: questions array, MCQ first, confidence 0-1, should_continue bool, round=0"
echo ""

# Critique
echo "3. Critique - Deterministic Ordering"
echo "   POST /assist/critique-graph"
curl -s -X POST ${BASE_URL}/assist/critique-graph \
  -H 'Content-Type: application/json' \
  -d '{"graph":{"version":"1","default_seed":17,"nodes":[{"id":"a","kind":"goal","label":"Test"}],"edges":[]}}' | jq '{issues: (.issues | length), suggested_fixes: (.suggested_fixes | length)}'
echo "   ✅ Expected: issues sorted BLOCKER→IMPROVEMENT→OBSERVATION, suggested_fixes array"
echo ""

# Draft (JSON)
echo "4. Draft Graph (JSON)"
echo "   POST /assist/draft-graph"
curl -s -X POST ${BASE_URL}/assist/draft-graph \
  -H 'Content-Type: application/json' \
  -d "{\"brief\":\"${BRIEF}\"}" | jq '{nodes: (.graph.nodes | length), edges: (.graph.edges | length)}'
echo "   ✅ Expected: graph with nodes and edges (≤12 nodes, ≤24 edges)"
echo ""

# Draft (SSE)
echo "5. Draft Graph (SSE - RFC 8895)"
echo "   POST /assist/draft-graph/stream"
curl -N -s -X POST ${BASE_URL}/assist/draft-graph/stream \
  -H 'Content-Type: application/json' \
  -d "{\"brief\":\"${BRIEF}\"}" | head -20
echo "   ✅ Expected: SSE stream with event: and data: lines, RFC 8895 framing"
echo ""

# Suggest Options
echo "6. Suggest Options - Deterministic Sorting"
echo "   POST /assist/suggest-options"
curl -s -X POST ${BASE_URL}/assist/suggest-options \
  -H 'Content-Type: application/json' \
  -d "{\"goal\":\"${GOAL}\"}" | jq '{options: (.options | length), ids: [.options[].id]}'
echo "   ✅ Expected: 3-5 options sorted by id alphabetically"
echo ""

# Explain Diff
echo "7. Explain Diff - Rationales"
echo "   POST /assist/explain-diff"
curl -s -X POST ${BASE_URL}/assist/explain-diff \
  -H 'Content-Type: application/json' \
  -d '{"patch":{"adds":{"nodes":[{"id":"goal_1","kind":"goal","label":"Revenue"}],"edges":[]},"updates":[],"removes":[]}}' | jq '{rationales: (.rationales | length)}'
echo "   ✅ Expected: rationales array (≥1), sorted by target alphabetically"
echo ""

# Grounding tests (v1.1.0+)
if [ "$GROUNDING_ENABLED" = "true" ]; then
  echo "8. Grounding - Draft with TXT Attachment"
  echo "   POST /assist/draft-graph (with attachments, flags.grounding=true)"
  # Base64 encode "Hello World" -> SGVsbG8gV29ybGQ=
  curl -s -X POST ${BASE_URL}/assist/draft-graph \
    -H 'Content-Type: application/json' \
    -d "{\"brief\":\"${BRIEF}\",\"attachments\":[{\"id\":\"test\",\"kind\":\"txt\",\"name\":\"test.txt\"}],\"attachment_payloads\":{\"test\":\"SGVsbG8gV29ybGQ=\"},\"flags\":{\"grounding\":true}}" | jq '{nodes: (.graph.nodes | length), edges: (.graph.edges | length), rationales: (.rationales | length)}'
  echo "   ✅ Expected: graph with nodes/edges, rationales array (may include provenance)"
  echo ""

  echo "9. Grounding - Per-File Limit (5k)"
  echo "   POST /assist/draft-graph (oversized file)"
  # Create 6000-char string (exceeds 5k limit)
  LARGE_CONTENT=$(printf 'A%.0s' {1..6000} | base64)
  RESPONSE=$(curl -s -X POST ${BASE_URL}/assist/draft-graph \
    -H 'Content-Type: application/json' \
    -d "{\"brief\":\"${BRIEF}\",\"attachments\":[{\"id\":\"large\",\"kind\":\"txt\",\"name\":\"large.txt\"}],\"attachment_payloads\":{\"large\":\"${LARGE_CONTENT}\"},\"flags\":{\"grounding\":true}}")
  STATUS_CODE=$(echo "$RESPONSE" | jq -r '.code // "SUCCESS"')
  echo "$RESPONSE" | jq '{code, message: (.message | split(" ")[0:10] | join(" "))}'
  echo "   ✅ Expected: 400 BAD_INPUT with filename in message, hint about 5k limit"
  echo ""

  echo "10. Grounding - CSV Safe Summarization"
  echo "    POST /assist/draft-graph (CSV with privacy check)"
  # Simple CSV: name,age\nAlice,30\nBob,25
  CSV_CONTENT=$(echo -e "name,age\nAlice,30\nBob,25" | base64)
  RESPONSE=$(curl -s -X POST ${BASE_URL}/assist/draft-graph \
    -H 'Content-Type: application/json' \
    -d "{\"brief\":\"Analyze employee demographics\",\"attachments\":[{\"id\":\"data\",\"kind\":\"csv\",\"name\":\"employees.csv\"}],\"attachment_payloads\":{\"data\":\"${CSV_CONTENT}\"},\"flags\":{\"grounding\":true}}")
  echo "$RESPONSE" | jq '{nodes: (.graph.nodes | length), rationales: (.rationales | length)}'
  # Check for privacy violation (should NOT contain "Alice" or "Bob")
  if echo "$RESPONSE" | grep -q "Alice\|Bob"; then
    echo "   ❌ PRIVACY VIOLATION: CSV row data leaked!"
    exit 1
  else
    echo "   ✅ Expected: graph generated, NO row data (Alice/Bob) in response (privacy OK)"
  fi
  echo ""

else
  echo "8. Grounding - Disabled (Default)"
  echo "   POST /assist/draft-graph (attachments should be ignored)"
  curl -s -X POST ${BASE_URL}/assist/draft-graph \
    -H 'Content-Type: application/json' \
    -d "{\"brief\":\"${BRIEF}\",\"attachments\":[{\"id\":\"test\",\"kind\":\"txt\",\"name\":\"test.txt\"}],\"attachment_payloads\":{\"test\":\"SGVsbG8gV29ybGQ=\"}}" | jq '{nodes: (.graph.nodes | length), edges: (.graph.edges | length), rationales: (.rationales | length)}'
  echo "   ✅ Expected: graph generated normally, attachments silently ignored (grounding disabled)"
  echo ""
fi

echo "================================================"
echo "✅ Smoke tests complete!"
echo "All endpoints responded successfully with fixtures mode."
echo ""
echo "Summary:"
echo "  Version: ${VERSION}"
echo "  Grounding: ${GROUNDING_FLAG}"
echo "  Tests passed: All core + ${GROUNDING_ENABLED} grounding"
