#!/usr/bin/env bash
#
# Datadog Dashboard & Monitor Import Script
#
# Usage:
#   export DD_API_KEY=your_api_key
#   export DD_APP_KEY=your_app_key
#   export DD_SITE=datadoghq.com  # or datadoghq.eu
#   ./observability/import-datadog.sh
#
# Creates:
#   - Cost Tracking Dashboard
#   - Provider Performance Dashboard
#   - Latency Monitor (p95 ≤ 8s)
#   - Error Rate Monitor
#   - Cost Spike Monitor
#   - Fixtures-in-Production Monitor
#
# Requirements:
#   - DD_API_KEY env var
#   - DD_APP_KEY env var
#   - curl and jq installed

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Check required env vars
if [ -z "${DD_API_KEY:-}" ] || [ -z "${DD_APP_KEY:-}" ]; then
  echo -e "${RED}❌ ERROR: Datadog credentials not set${NC}"
  echo ""
  echo "Required environment variables:"
  echo "  - DD_API_KEY: Your Datadog API key"
  echo "  - DD_APP_KEY: Your Datadog Application key"
  echo "  - DD_SITE: (optional) Datadog site, defaults to datadoghq.com"
  echo ""
  echo "Get your keys from:"
  echo "  https://app.datadoghq.com/organization-settings/api-keys"
  echo ""
  echo "Usage:"
  echo "  export DD_API_KEY=your_api_key"
  echo "  export DD_APP_KEY=your_app_key"
  echo "  $0"
  exit 1
fi

DD_SITE="${DD_SITE:-datadoghq.com}"
DD_API="https://api.$DD_SITE/api/v1"

echo -e "${GREEN}🚀 Importing Datadog Dashboards & Monitors${NC}"
echo "Site: $DD_SITE"
echo ""

# Helper function to call Datadog API
dd_api() {
  local method=$1
  local endpoint=$2
  local data=${3:-}

  local url="$DD_API$endpoint"

  if [ -n "$data" ]; then
    curl -sf -X "$method" "$url" \
      -H "DD-API-KEY: $DD_API_KEY" \
      -H "DD-APPLICATION-KEY: $DD_APP_KEY" \
      -H "Content-Type: application/json" \
      -d "$data"
  else
    curl -sf -X "$method" "$url" \
      -H "DD-API-KEY: $DD_API_KEY" \
      -H "DD-APPLICATION-KEY: $DD_APP_KEY"
  fi
}

echo -e "${BLUE}📊 Creating Cost Tracking Dashboard...${NC}"

COST_DASHBOARD=$(cat <<'EOF'
{
  "title": "Olumi Assistants - Cost Tracking",
  "description": "Tracks LLM API costs per request, provider, and model",
  "widgets": [
    {
      "definition": {
        "title": "Cost per Request (p50/p95/p99)",
        "type": "timeseries",
        "requests": [
          {
            "q": "avg:olumi.assistants.draft.cost_usd{*} by {draft_source}",
            "display_type": "line"
          }
        ]
      }
    },
    {
      "definition": {
        "title": "Total Cost (24h)",
        "type": "query_value",
        "requests": [
          {
            "q": "sum:olumi.assistants.draft.cost_usd{*}.rollup(sum, 86400)",
            "aggregator": "sum"
          }
        ]
      }
    },
    {
      "definition": {
        "title": "Cost by Provider",
        "type": "toplist",
        "requests": [
          {
            "q": "top(avg:olumi.assistants.draft.cost_usd{*} by {draft_source}, 10, 'mean', 'desc')"
          }
        ]
      }
    },
    {
      "definition": {
        "title": "Prompt Cache Hit Rate",
        "type": "timeseries",
        "requests": [
          {
            "q": "sum:olumi.assistants.draft.prompt_cache{hit:true}.as_count() / sum:olumi.assistants.draft.prompt_cache{*}.as_count() * 100",
            "display_type": "line"
          }
        ]
      }
    }
  ],
  "layout_type": "ordered"
}
EOF
)

COST_DASHBOARD_RESULT=$(dd_api POST "/dashboards" "$COST_DASHBOARD" || echo "")
if [ -n "$COST_DASHBOARD_RESULT" ]; then
  COST_DASHBOARD_ID=$(echo "$COST_DASHBOARD_RESULT" | jq -r '.id')
  echo -e "${GREEN}✅ Cost Tracking Dashboard created: $COST_DASHBOARD_ID${NC}"
  echo "   View: https://app.$DD_SITE/dashboard/$COST_DASHBOARD_ID"
else
  echo -e "${RED}❌ Failed to create Cost Tracking Dashboard${NC}"
fi

echo ""
echo -e "${BLUE}📊 Creating Provider Performance Dashboard...${NC}"

PROVIDER_DASHBOARD=$(cat <<'EOF'
{
  "title": "Olumi Assistants - Provider Performance",
  "description": "Compares latency, cost, and quality across LLM providers",
  "widgets": [
    {
      "definition": {
        "title": "Latency by Provider (p95)",
        "type": "timeseries",
        "requests": [
          {
            "q": "p95:olumi.assistants.draft.latency_ms{*} by {draft_source}",
            "display_type": "line"
          }
        ]
      }
    },
    {
      "definition": {
        "title": "Quality Tier Distribution",
        "type": "pie",
        "requests": [
          {
            "q": "sum:olumi.assistants.draft.completed{*} by {quality_tier}.as_count()"
          }
        ]
      }
    },
    {
      "definition": {
        "title": "Repair Fallback Rate",
        "type": "timeseries",
        "requests": [
          {
            "q": "sum:olumi.assistants.draft.repair.fallback{*}.as_count() / sum:olumi.assistants.draft.repair.attempted{*}.as_count() * 100",
            "display_type": "line"
          }
        ]
      }
    }
  ],
  "layout_type": "ordered"
}
EOF
)

PROVIDER_DASHBOARD_RESULT=$(dd_api POST "/dashboards" "$PROVIDER_DASHBOARD" || echo "")
if [ -n "$PROVIDER_DASHBOARD_RESULT" ]; then
  PROVIDER_DASHBOARD_ID=$(echo "$PROVIDER_DASHBOARD_RESULT" | jq -r '.id')
  echo -e "${GREEN}✅ Provider Performance Dashboard created: $PROVIDER_DASHBOARD_ID${NC}"
  echo "   View: https://app.$DD_SITE/dashboard/$PROVIDER_DASHBOARD_ID"
else
  echo -e "${RED}❌ Failed to create Provider Performance Dashboard${NC}"
fi

echo ""
echo -e "${BLUE}🔔 Creating Monitors...${NC}"

# Monitor 1: p95 Latency
P95_MONITOR=$(cat <<'EOF'
{
  "name": "Olumi Assistants - High Latency (p95 > 8s)",
  "type": "metric alert",
  "query": "percentile(last_5m):p95:olumi.assistants.draft.latency_ms{*} > 8000",
  "message": "⚠️ Draft latency p95 exceeded 8s threshold\n\nCurrent: {{value}}ms\nThreshold: 8000ms\n\nCheck:\n- Provider performance\n- LLM API status\n- Cost guard configuration\n\n@slack-ops",
  "tags": ["service:olumi-assistants", "env:production"],
  "options": {
    "thresholds": {
      "critical": 8000,
      "warning": 6000
    },
    "notify_no_data": false,
    "notify_audit": false
  }
}
EOF
)

P95_RESULT=$(dd_api POST "/monitor" "$P95_MONITOR" || echo "")
if [ -n "$P95_RESULT" ]; then
  echo -e "${GREEN}✅ p95 Latency Monitor created${NC}"
else
  echo -e "${YELLOW}⚠️  p95 Monitor may already exist or failed${NC}"
fi

# Monitor 2: Error Rate
ERROR_MONITOR=$(cat <<'EOF'
{
  "name": "Olumi Assistants - High Error Rate (> 1%)",
  "type": "metric alert",
  "query": "sum(last_5m):sum:olumi.assistants.draft.sse.errors{*}.as_count() / sum:olumi.assistants.draft.sse.started{*}.as_count() * 100 > 1",
  "message": "⚠️ Error rate exceeded 1% threshold\n\nCheck:\n- Recent deployments\n- LLM API status\n- Guard violations\n\n@slack-ops",
  "tags": ["service:olumi-assistants", "env:production"],
  "options": {
    "thresholds": {
      "critical": 1,
      "warning": 0.5
    }
  }
}
EOF
)

ERROR_RESULT=$(dd_api POST "/monitor" "$ERROR_MONITOR" || echo "")
if [ -n "$ERROR_RESULT" ]; then
  echo -e "${GREEN}✅ Error Rate Monitor created${NC}"
else
  echo -e "${YELLOW}⚠️  Error Monitor may already exist or failed${NC}"
fi

# Monitor 3: Cost Spike
COST_MONITOR=$(cat <<'EOF'
{
  "name": "Olumi Assistants - Cost Spike (> $10/hour)",
  "type": "metric alert",
  "query": "sum(last_1h):sum:olumi.assistants.draft.cost_usd{*}.rollup(sum) > 10",
  "message": "⚠️ Hourly cost exceeded $10\n\nCurrent: ${{value}}\nThreshold: $10/hour\n\nCheck:\n- Unusual traffic\n- Cost guard configuration\n- Provider pricing changes\n\n@slack-ops",
  "tags": ["service:olumi-assistants", "env:production"],
  "options": {
    "thresholds": {
      "critical": 10,
      "warning": 7
    }
  }
}
EOF
)

COST_RESULT=$(dd_api POST "/monitor" "$COST_MONITOR" || echo "")
if [ -n "$COST_RESULT" ]; then
  echo -e "${GREEN}✅ Cost Spike Monitor created${NC}"
else
  echo -e "${YELLOW}⚠️  Cost Monitor may already exist or failed${NC}"
fi

# Monitor 4: Fixtures in Production
FIXTURES_MONITOR=$(cat <<'EOF'
{
  "name": "Olumi Assistants - Fixtures Provider in Production",
  "type": "metric alert",
  "query": "sum(last_5m):sum:olumi.assistants.draft.completed{draft_source:fixtures}.as_count() > 10",
  "message": "🚨 CRITICAL: Fixtures provider detected in production!\n\nThe service is using mock fixtures instead of real LLM calls.\n\nImmediate action required:\n- Check LLM_PROVIDER env var\n- Verify API keys are set\n- Review recent config changes\n\n@slack-ops @pagerduty",
  "tags": ["service:olumi-assistants", "env:production", "severity:critical"],
  "options": {
    "thresholds": {
      "critical": 10
    },
    "notify_no_data": false
  }
}
EOF
)

FIXTURES_RESULT=$(dd_api POST "/monitor" "$FIXTURES_MONITOR" || echo "")
if [ -n "$FIXTURES_RESULT" ]; then
  echo -e "${GREEN}✅ Fixtures-in-Production Monitor created${NC}"
else
  echo -e "${YELLOW}⚠️  Fixtures Monitor may already exist or failed${NC}"
fi

echo ""
echo -e "${GREEN}✅ Datadog import complete!${NC}"
echo ""
echo -e "${BLUE}📊 Dashboards:${NC}"
echo "  - Cost Tracking: https://app.$DD_SITE/dashboard/$COST_DASHBOARD_ID"
echo "  - Provider Performance: https://app.$DD_SITE/dashboard/$PROVIDER_DASHBOARD_ID"
echo ""
echo -e "${BLUE}🔔 Monitors:${NC}"
echo "  - p95 Latency (> 8s)"
echo "  - Error Rate (> 1%)"
echo "  - Cost Spike (> \$10/hour)"
echo "  - Fixtures in Production"
echo ""
echo -e "${YELLOW}📝 Next steps:${NC}"
echo "  1. Configure Slack/PagerDuty integration in Datadog"
echo "  2. Adjust thresholds based on baseline metrics"
echo "  3. Add custom tags for environment (staging/production)"
echo ""
