# Observability Configuration

**Purpose:** Datadog dashboards and alerts for olumi-assistants-service
**Last Updated:** 2025-11-03
**Related:** M3 milestone, Docs/telemetry-aggregation-strategy.md

---

## Overview

This directory contains Datadog configuration files for monitoring the draft-graph service:

- **Dashboards:** Visual metrics for performance, quality, and cost
- **Alerts:** Automated notifications for SLA breaches and anomalies

All configurations are version-controlled and can be imported into Datadog.

---

## Quick Start

### 1. Set Up Datadog Environment Variables

In Render dashboard (staging + production):

```bash
DD_AGENT_HOST=<your-datadog-agent-host>  # Or use DD_API_KEY for direct API
DD_SERVICE=olumi-assistants-service
DD_ENV=staging  # or production
```

### 2. Import Dashboard

**Via Datadog UI:**
1. Go to [Dashboards](https://app.datadoghq.com/dashboard/lists)
2. Click **"New Dashboard"** → **"Import Dashboard JSON"**
3. Paste contents of `dashboards/draft-service.json`
4. Click **"Import"**

**Via Datadog API:**
```bash
curl -X POST "https://api.datadoghq.com/api/v1/dashboard" \
  -H "DD-API-KEY: ${DD_API_KEY}" \
  -H "DD-APPLICATION-KEY: ${DD_APP_KEY}" \
  -H "Content-Type: application/json" \
  -d @dashboards/draft-service.json
```

### 3. Import Alerts

**For each alert in `alerts/`:**

```bash
curl -X POST "https://api.datadoghq.com/api/v1/monitor" \
  -H "DD-API-KEY: ${DD_API_KEY}" \
  -H "DD-APPLICATION-KEY: ${DD_APP_KEY}" \
  -H "Content-Type: application/json" \
  -d @alerts/p95-latency.json

curl -X POST ... -d @alerts/error-rate.json
curl -X POST ... -d @alerts/cost-spike.json
curl -X POST ... -d @alerts/legacy-provenance.json
```

---

## Dashboard Metrics

### Performance
- **Draft Latency (p50, p95, p99):** Response time distribution with 8s SLA marker
- **Draft Completion Rate:** Requests per second
- **SSE Error Rate:** Streaming failures per second with 5% threshold

### Quality
- **Quality Tier Distribution:** High (≥0.9), Medium (≥0.7), Low (<0.7)
- **Fallback Reason Mix:** Why drafts fell back to simple repair
- **Repair Fallback Rate:** Percentage of repairs that failed
- **Confidence Distribution:** Heat map of draft confidence scores

### Cost
- **Cost per Request (USD):** Average and p95 cost per draft
- **Total Cost (USD/hour):** Estimated hourly Anthropic API spend
- **Prompt Cache Hit Rate:** Percentage of cached vs. fresh prompts

### Deprecation
- **Legacy Provenance Usage (%):** String provenance usage trend with thresholds

### Graph Characteristics
- **Graph Size Distribution:** Node and edge count distributions
- **Confidence Distribution:** Confidence score heat map

---

## Alert Definitions

### 1. P95 Latency > 8s

**Severity:** Critical (P1)
**Threshold:** 8000ms (8 seconds)
**Warning:** 6000ms (6 seconds)
**Window:** Last 5 minutes
**Notifications:** @slack-olumi-alerts @pagerduty-on-call

**Triggers when:** p95 latency exceeds 8 seconds for 5 minutes.

**Actions:**
1. Check Anthropic API latency
2. Review recent deployments
3. Check LLM timeout rate
4. Consider increasing fixture timeout

---

### 2. Error Rate > 5%

**Severity:** High (P2)
**Threshold:** 5%
**Warning:** 2%
**Window:** Last 10 minutes
**Notifications:** @slack-olumi-alerts

**Triggers when:** (SSE errors / total drafts) > 5% for 10 minutes.

**Actions:**
1. Check error logs for patterns
2. Verify Anthropic API status
3. Check engine /v1/validate health
4. Review deployment changes

---

### 3. Cost Spike > Baseline + 20%

**Severity:** Medium (P3)
**Threshold:** 20% above baseline
**Warning:** 10% above baseline
**Window:** Last 1 hour
**Notifications:** @slack-olumi-finance @slack-olumi-alerts

**Triggers when:** Hourly cost deviates >20% from baseline (anomaly detection).

**Actions:**
1. Check traffic volume spike
2. Review token usage (brief complexity)
3. Verify prompt cache hit rate (should be >60%)
4. Check repair fallback rate increase
5. Confirm Anthropic pricing unchanged

---

### 4. Legacy Provenance > 20% for 7 Days

**Severity:** Medium (P3)
**Threshold:** 20%
**Warning:** 10%
**Window:** Last 7 days
**Notifications:** @slack-olumi-product @slack-olumi-alerts

**Triggers when:** Average legacy provenance usage >20% for 7 consecutive days.

**Actions:**
1. Identify high-usage clients in logs
2. Contact clients with migration guidance
3. Verify structured provenance functionality
4. Review deprecation timeline
5. Consider extending migration window

---

## Telemetry Event Reference

All events are defined in `src/utils/telemetry.ts` with frozen names:

```typescript
TelemetryEvents = {
  DraftStarted: "assist.draft.started",
  DraftCompleted: "assist.draft.completed",
  SSEStarted: "assist.draft.sse_started",
  SSECompleted: "assist.draft.sse_completed",
  SSEError: "assist.draft.sse_error",
  FixtureShown: "assist.draft.fixture_shown",
  FixtureReplaced: "assist.draft.fixture_replaced",
  ValidationFailed: "assist.draft.validation_failed",
  RepairAttempted: "assist.draft.repair_attempted",
  RepairStart: "assist.draft.repair_start",
  RepairSuccess: "assist.draft.repair_success",
  RepairPartial: "assist.draft.repair_partial",
  RepairFallback: "assist.draft.repair_fallback",
  LegacyProvenance: "assist.draft.legacy_provenance",
  Stage: "assist.draft.stage",
}
```

**DO NOT** modify event names without:
1. Updating dashboards
2. Updating alerts
3. Updating CI guards
4. Documenting in CHANGELOG

---

## Datadog Metrics Reference

All metrics use the prefix `olumi.assistants.`

| Metric | Type | Tags | Description |
|--------|------|------|-------------|
| `draft.started` | counter | - | Draft requests initiated |
| `draft.latency_ms` | histogram | draft_source, quality_tier, fallback_reason | Draft response time (ms) |
| `draft.graph.nodes` | gauge | - | Number of nodes in generated graph |
| `draft.graph.edges` | gauge | - | Number of edges in generated graph |
| `draft.confidence` | histogram | quality_tier | Draft confidence score (0-1) |
| `draft.cost_usd` | histogram | draft_source | Estimated Anthropic API cost per request |
| `draft.prompt_cache` | counter | hit (true/false) | Prompt cache hits/misses |
| `draft.completed` | counter | quality_tier, draft_source, fallback_reason | Total drafts completed |
| `draft.sse.started` | counter | - | SSE streams initiated |
| `draft.sse.stream_duration_ms` | histogram | - | SSE stream duration (ms) |
| `draft.sse.completed` | counter | fixture_shown | SSE streams completed |
| `draft.sse.errors` | counter | error_code | SSE stream errors |
| `draft.validation.failed` | counter | - | Validation failures |
| `draft.validation.violations` | gauge | - | Number of validation violations |
| `draft.repair.attempted` | counter | - | Repair attempts |
| `draft.repair.success` | counter | - | Successful repairs |
| `draft.repair.partial` | counter | - | Partial repairs (some violations fixed) |
| `draft.repair.fallback` | counter | reason | Repairs that fell back to simple repair |
| `draft.legacy_provenance.occurrences` | counter | - | Legacy provenance detections |
| `draft.legacy_provenance.percentage` | gauge | - | Percentage of edges using legacy format |
| `draft.fixture.shown` | counter | - | Fixture shown to user (2.5s timeout) |
| `draft.fixture.replaced` | counter | - | Fixture replaced with real draft |

---

## Cost Calculation

Costs are calculated per request using Anthropic pricing:

**Claude 3.5 Sonnet (as of 2025-01):**
- Input: $3 per million tokens
- Output: $15 per million tokens

**Formula:**
```typescript
cost_usd = (tokens_in / 1000) * 0.003 + (tokens_out / 1000) * 0.015
```

**Example:**
- Input: 5000 tokens
- Output: 1000 tokens
- Cost: (5000/1000)*0.003 + (1000/1000)*0.015 = $0.015 + $0.015 = **$0.030**

---

## Updating Configurations

### Adding a New Metric

1. Update `src/utils/telemetry.ts` to emit new metric
2. Update dashboard JSON with new widget
3. Update this README with metric reference
4. Create PR with changes

### Adding a New Alert

1. Create alert JSON in `alerts/` directory
2. Document alert in this README
3. Import to Datadog using API or UI
4. Test alert triggers correctly
5. Create PR with changes

### Modifying Event Names (⚠️ BREAKING)

**DO NOT** modify event names in `TelemetryEvents` enum without:
1. Updating all dashboards
2. Updating all alerts
3. Updating CI guards
4. Major version bump
5. Migration guide for consumers

---

## Troubleshooting

### No Metrics in Datadog

**Check:**
1. `DD_AGENT_HOST` or `DD_API_KEY` environment variable set
2. Server logs show "Datadog StatsD client initialized"
3. Network connectivity to Datadog agent/API
4. Datadog service and environment tags match filters

**Test:**
```bash
# Check if service is sending metrics
curl https://olumi-assistants-service-staging.onrender.com/assist/draft-graph \
  -X POST -H "Content-Type: application/json" \
  -d '{"brief":"test"}'

# Check server logs for telemetry events
# Should see: {"event":"assist.draft.completed", ...}
```

### Dashboard Shows No Data

**Check:**
1. Time range is correct (default: Last 4 hours)
2. Environment filter matches deployment (staging/production)
3. Metrics are being emitted (check logs)
4. Metric names match dashboard queries

### Alert Not Firing

**Check:**
1. Alert is enabled in Datadog
2. Metric data exists for evaluation window
3. Threshold values are correct
4. Notification channels configured (@slack, @pagerduty)
5. Alert evaluation delay hasn't suppressed trigger

---

## Next Steps

**After M3 Deployment:**
1. Import dashboard and alerts to Datadog
2. Validate metrics are flowing
3. Test alert triggers (manually breach thresholds)
4. Configure notification channels
5. Set up weekly metric review process

**M4-M5:**
- Monitor golden brief validation rates
- Track functional stability metrics
- Add cost baseline after first week

---

**Prepared by:** Claude Code Agent (M3)
**Last Updated:** 2025-11-02
**Related Docs:**
- [Telemetry Aggregation Strategy](../Docs/telemetry-aggregation-strategy.md)
- [Specification v04](canvas) - Product SSOT
