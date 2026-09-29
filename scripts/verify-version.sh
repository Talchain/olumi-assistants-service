#!/usr/bin/env bash
#
# Version Verification Script (CI/Local)
#
# Verifies that /healthz endpoint returns the same version as SERVICE_VERSION
#
# Usage:
#   # Local verification (service must be running)
#   ./scripts/verify-version.sh
#
#   # CI usage
#   ./scripts/verify-version.sh http://localhost:3101

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

BASE_URL="${1:-http://localhost:3101}"

echo -e "${YELLOW}🔍 Verifying version consistency...${NC}"
echo "Target: $BASE_URL"
echo ""

# Extract expected version from SERVICE_VERSION
echo "Extracting SERVICE_VERSION from build..."
EXPECTED=$(node -e "import('./dist/src/version.js').then(m => console.log(m.SERVICE_VERSION))" 2>/dev/null || echo "")

if [ -z "$EXPECTED" ]; then
  echo -e "${RED}❌ ERROR: Could not extract SERVICE_VERSION${NC}"
  echo "Make sure you've run 'pnpm build' first"
  exit 1
fi

echo -e "Expected SERVICE_VERSION: ${GREEN}$EXPECTED${NC}"

# Fetch actual version from /healthz
echo "Fetching version from $BASE_URL/healthz..."
HEALTH_RESPONSE=$(curl -sf "$BASE_URL/healthz" 2>/dev/null || echo "")

if [ -z "$HEALTH_RESPONSE" ]; then
  echo -e "${RED}❌ ERROR: Could not reach $BASE_URL/healthz${NC}"
  echo "Make sure the service is running"
  exit 1
fi

ACTUAL=$(echo "$HEALTH_RESPONSE" | jq -r '.version // "unknown"')
echo -e "Actual version from /healthz: ${GREEN}$ACTUAL${NC}"

# Compare versions
echo ""
if [ "$ACTUAL" = "$EXPECTED" ]; then
  echo -e "${GREEN}✅ Version guard PASSED${NC}"
  echo "   /healthz returns correct version: $ACTUAL"
  exit 0
else
  echo -e "${RED}❌ Version guard FAILED${NC}"
  echo "   Expected: $EXPECTED"
  echo "   Actual: $ACTUAL"
  echo ""
  echo "This indicates a mismatch between package.json and the deployed service."
  echo "Possible causes:"
  echo "  - Service not rebuilt after version change"
  echo "  - SERVICE_VERSION env override set incorrectly"
  echo "  - Path resolution issue in src/version.ts"
  exit 1
fi
