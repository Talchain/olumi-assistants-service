#!/usr/bin/env bash
#
# Performance Baseline Runner for v1.0.1
#
# Usage:
#   export ASSISTANTS_URL=https://your-assistants-service.onrender.com
#   ./scripts/run-baseline.sh
#
# Generates:
#   - tests/perf/_reports/baseline-v1.0.1-YYYYMMDD-HHMMSS.json
#   - tests/perf/_reports/baseline-v1.0.1-YYYYMMDD-HHMMSS.md (summary)
#
# Requirements:
#   - artillery installed (pnpm install)
#   - ASSISTANTS_URL env var set
#   - Assistants service must be deployed and healthy

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check required env vars
if [ -z "${ASSISTANTS_URL:-}" ]; then
  echo -e "${RED}❌ ERROR: ASSISTANTS_URL is not set${NC}"
  echo ""
  echo "Usage:"
  echo "  export ASSISTANTS_URL=https://your-assistants-service.onrender.com"
  echo "  $0"
  echo ""
  echo "Examples:"
  echo "  export ASSISTANTS_URL=https://olumi-assistants-staging.onrender.com"
  echo "  export ASSISTANTS_URL=https://olumi-assistants.onrender.com"
  exit 1
fi

echo -e "${GREEN}🚀 Running Performance Baseline for v1.0.1${NC}"
echo "Target: $ASSISTANTS_URL"
echo ""

# Verify service is healthy
echo "Checking service health..."
HEALTH_RESPONSE=$(curl -sf "$ASSISTANTS_URL/healthz" || echo "")
if [ -z "$HEALTH_RESPONSE" ]; then
  echo -e "${RED}❌ ERROR: Service is not responding at $ASSISTANTS_URL/healthz${NC}"
  exit 1
fi

VERSION=$(echo "$HEALTH_RESPONSE" | jq -r '.version // "unknown"')
echo -e "${GREEN}✅ Service is healthy (version: $VERSION)${NC}"
echo ""

# Create reports directory if it doesn't exist
mkdir -p tests/perf/_reports

# Generate timestamp for report filenames
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
REPORT_JSON="tests/perf/_reports/baseline-v1.0.1-$TIMESTAMP.json"
REPORT_MD="tests/perf/_reports/baseline-v1.0.1-$TIMESTAMP.md"

echo "Running artillery performance test..."
echo "This will take a few minutes..."
echo ""

# Run artillery with the target URL
# Note: Adjust the artillery config path if needed
if [ -f "tests/perf/draft-graph-baseline.yml" ]; then
  PERF_TARGET_URL="$ASSISTANTS_URL" pnpm exec artillery run \
    --output "$REPORT_JSON" \
    tests/perf/draft-graph-baseline.yml
elif [ -f "artillery.yml" ]; then
  PERF_TARGET_URL="$ASSISTANTS_URL" pnpm exec artillery run \
    --output "$REPORT_JSON" \
    artillery.yml
else
  echo -e "${YELLOW}⚠️  No artillery config found, creating minimal baseline test...${NC}"

  # Create a simple artillery config on the fly
  cat > /tmp/baseline-$TIMESTAMP.yml <<'EOF'
config:
  target: "{{ $processEnvironment.PERF_TARGET_URL }}"
  phases:
    - duration: 60
      arrivalRate: 5
      name: "Warm-up"
    - duration: 300
      arrivalRate: 10
      name: "Sustained load"
  plugins:
    metrics-by-endpoint:
      stripQueryString: true
scenarios:
  - name: "Draft graph via JSON"
    flow:
      - post:
          url: "/assist/draft-graph"
          json:
            brief: "Should we build or buy our data analytics platform?"
          capture:
            - json: "$.graph.nodes"
              as: "nodes"
            - json: "$.cost_usd"
              as: "cost"
EOF

  PERF_TARGET_URL="$ASSISTANTS_URL" pnpm exec artillery run \
    --output "$REPORT_JSON" \
    /tmp/baseline-$TIMESTAMP.yml
fi

echo ""
echo -e "${GREEN}✅ Performance test complete!${NC}"
echo ""

# Generate markdown summary from JSON report
echo "Generating summary report..."
node -e "
const fs = require('fs');
const report = JSON.parse(fs.readFileSync('$REPORT_JSON', 'utf-8'));

const summary = report.aggregate.summaries || report.aggregate;
const p50 = Math.round(summary['http.response_time'].p50 || summary.latency?.p50 || 0);
const p95 = Math.round(summary['http.response_time'].p95 || summary.latency?.p95 || 0);
const p99 = Math.round(summary['http.response_time'].p99 || summary.latency?.p99 || 0);
const rps = Math.round(summary['http.request_rate'] || summary.rps || 0);
const errors = summary.errors || 0;

const md = \`# Performance Baseline v1.0.1

**Date:** $(date +'%Y-%m-%d %H:%M:%S')
**Target:** $ASSISTANTS_URL
**Duration:** ${summary.duration || 'N/A'}s

## Latency

| Metric | Value |
|--------|-------|
| p50 | \${p50}ms |
| p95 | \${p95}ms |
| p99 | \${p99}ms |

## Throughput

- **Requests/sec:** \${rps}
- **Total requests:** \${summary['http.requests'] || summary.requests || 'N/A'}
- **Errors:** \${errors}

## Acceptance

- ✅ p95 ≤ 8000ms: \${p95 <= 8000 ? 'PASS' : 'FAIL'}
- ✅ Error rate < 1%: \${errors < (summary['http.requests'] * 0.01) ? 'PASS' : 'FAIL'}

## Raw Report

See [\$(basename '$REPORT_JSON')](./$REPORT_JSON)
\`;

fs.writeFileSync('$REPORT_MD', md);
console.log(md);
"

echo ""
echo -e "${GREEN}📊 Reports saved:${NC}"
echo "  - JSON: $REPORT_JSON"
echo "  - Summary: $REPORT_MD"
echo ""
echo -e "${YELLOW}📝 Next steps:${NC}"
echo "  1. Review the summary report: cat $REPORT_MD"
echo "  2. Commit the reports: git add tests/perf/_reports/"
echo "  3. Update README with p95 badge if needed"
echo ""
echo -e "${GREEN}✅ Baseline complete!${NC}"
