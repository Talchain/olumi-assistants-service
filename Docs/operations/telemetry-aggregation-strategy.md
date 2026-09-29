# Telemetry Aggregation Strategy

**Status:** Proposed
**Priority:** P1 (Required before enforcing structured provenance)
**Related:** W3-Finding 4, assist.draft.legacy_provenance event
**Created:** 2025-11-02

---

## Problem

The `assist.draft.legacy_provenance` telemetry event emits per-call metrics with 10% log sampling, but there's no downstream aggregation plan. Without aggregation and analysis:
- **Deprecation timeline is guesswork** - can't determine safe enforcement date
- **Volume trends are invisible** - can't track reduction over time
- **Client migration is untrackable** - can't identify which clients need migration support

**Current State:**
- ✅ Event emitted: `assist.draft.legacy_provenance`
- ✅ Metrics included: `legacy_count`, `total_edges`, `legacy_percentage`
- ✅ Log sampling: 10% to reduce noise
- ❌ **No aggregation pipeline**
- ❌ **No alerting thresholds**
- ❌ **No enforcement timeline**

---

## Proposed Solutions

### Option 1: Datadog Metrics (Recommended)

**Setup:**
```typescript
// src/utils/telemetry.ts
import { dogstatsd } from './datadog-client'; // Hypothetical client

export function emit(event: string, data: Record<string, any>) {
  log.info({ event, ...data });

  // Send metrics to Datadog
  if (event === 'assist.draft.legacy_provenance') {
    dogstatsd.increment('olumi.draft.legacy_provenance.occurrences', 1);
    dogstatsd.gauge('olumi.draft.legacy_provenance.percentage', data.legacy_percentage);
    dogstatsd.gauge('olumi.draft.legacy_provenance.count', data.legacy_count);
  }
}
```

**Dashboard Metrics:**
1. **Legacy Provenance Rate** - Percentage of drafts with legacy format
2. **Legacy Edge Count** - Total legacy edges per draft
3. **Weekly Trend** - Rate change week-over-week
4. **Client Breakdown** - Which API keys use legacy format most (if tracked)

**Alerting Thresholds:**
- **Warning:** Legacy rate > 20% for 7 days (migration not progressing)
- **Critical:** Legacy rate > 50% (indicates regression)
- **Success:** Legacy rate < 5% for 30 days (ready to enforce)

**Pros:**
- Real-time dashboards
- Built-in alerting
- Easy to correlate with other metrics (latency, errors)
- Standard tool in observability stack

**Cons:**
- Requires Datadog agent/client
- Additional infrastructure dependency

---

### Option 2: BigQuery/SQL Analytics

**Setup:**
```typescript
// Stream logs to BigQuery via Cloud Logging or similar
// Query example:
SELECT
  DATE(timestamp) as date,
  COUNT(*) as total_drafts,
  SUM(legacy_count) as total_legacy_edges,
  AVG(legacy_percentage) as avg_legacy_percentage,
  APPROX_QUANTILES(legacy_percentage, 100)[OFFSET(50)] as median_legacy_percentage,
  APPROX_QUANTILES(legacy_percentage, 100)[OFFSET(95)] as p95_legacy_percentage
FROM `olumi_logs.draft_telemetry`
WHERE event = 'assist.draft.legacy_provenance'
  AND timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
GROUP BY date
ORDER BY date DESC
```

**Analysis Queries:**
1. **Weekly Trend:**
   ```sql
   SELECT
     EXTRACT(WEEK FROM timestamp) as week,
     AVG(legacy_percentage) as avg_legacy_pct
   FROM `olumi_logs.draft_telemetry`
   WHERE event = 'assist.draft.legacy_provenance'
   GROUP BY week
   ORDER BY week DESC
   LIMIT 12;
   ```

2. **Client Migration Status** (if API key is logged):
   ```sql
   SELECT
     api_key_prefix,
     COUNT(*) as draft_count,
     AVG(legacy_percentage) as avg_legacy_pct
   FROM `olumi_logs.draft_telemetry`
   WHERE event = 'assist.draft.legacy_provenance'
   GROUP BY api_key_prefix
   HAVING draft_count > 10
   ORDER BY avg_legacy_pct DESC;
   ```

**Pros:**
- Flexible SQL analysis
- Historical trend analysis
- No additional client dependencies
- Can correlate with other log data

**Cons:**
- Manual query execution
- No built-in alerting (requires separate setup)
- Slower than real-time metrics

---

### Option 3: Custom Prometheus Metrics

**Setup:**
```typescript
// src/utils/metrics.ts
import client from 'prom-client';

const legacyProvenanceCounter = new client.Counter({
  name: 'olumi_draft_legacy_provenance_total',
  help: 'Total drafts with legacy string provenance',
});

const legacyProvenanceGauge = new client.Gauge({
  name: 'olumi_draft_legacy_provenance_percentage',
  help: 'Percentage of edges using legacy provenance format',
});

export function emit(event: string, data: Record<string, any>) {
  log.info({ event, ...data });

  if (event === 'assist.draft.legacy_provenance') {
    legacyProvenanceCounter.inc();
    legacyProvenanceGauge.set(data.legacy_percentage);
  }
}
```

**Grafana Dashboard:**
- Legacy provenance rate (7-day rolling average)
- Legacy edge count distribution
- Alerts on Prometheus alert manager

**Pros:**
- Self-hosted observability
- Strong Grafana integration
- Fine-grained control

**Cons:**
- Requires Prometheus/Grafana infrastructure
- More operational overhead

---

## Recommended Approach

**Short-Term (Week 1-2):**
Use **Option 2 (BigQuery)** if logs are already being collected:
1. Set up weekly SQL query to track deprecation trends
2. Create spreadsheet with weekly snapshots
3. Share with stakeholders monthly

**Medium-Term (Month 1-2):**
Migrate to **Option 1 (Datadog)** for production:
1. Instrument `emit()` function to send metrics
2. Create deprecation dashboard with 4 key metrics
3. Set up alerting thresholds (Warning: >20%, Critical: >50%)
4. Define enforcement milestone: <5% for 30 consecutive days

**Long-Term (Month 3+):**
1. Track client-specific migration status
2. Proactive outreach to clients with high legacy usage
3. Announce sunset date once <5% threshold sustained
4. Remove legacy provenance support code

---

## Enforcement Timeline

Based on aggregated metrics, define enforcement milestones:

| Milestone | Threshold | Action |
|-----------|-----------|--------|
| **Migration Alert** | >20% legacy for 7 days | Email high-usage clients |
| **Sunset Warning** | <10% legacy for 14 days | Announce 90-day sunset |
| **Final Notice** | <5% legacy for 30 days | Announce 30-day final notice |
| **Enforcement** | <2% legacy for 60 days | Remove string provenance support |

**Example Timeline:**
- Week 1-4: Monitor baseline (likely 80-90% legacy)
- Week 5-12: Client migration support (target: <50%)
- Week 13-20: Deprecation warnings (target: <20%)
- Week 21-30: Sunset announcements (target: <5%)
- Week 31+: Enforcement (reject legacy format)

---

## Alerting Rules

**Datadog Monitor Examples:**

1. **Stalled Migration:**
   ```
   avg(last_7d):avg:olumi.draft.legacy_provenance.percentage{*} > 20
   ```
   **Alert:** Migration not progressing, investigate client blockers

2. **Regression:**
   ```
   avg(last_1d):avg:olumi.draft.legacy_provenance.percentage{*} >
   avg(last_7d):avg:olumi.draft.legacy_provenance.percentage{*} by 10
   ```
   **Alert:** Legacy usage increased, possible code regression

3. **Ready for Sunset:**
   ```
   avg(last_30d):avg:olumi.draft.legacy_provenance.percentage{*} < 5
   ```
   **Alert:** Sustained low usage, ready to announce sunset

---

## Implementation Checklist

**Phase 1: Setup (1 week)**
- [ ] Choose aggregation solution (Datadog, BigQuery, or Prometheus)
- [ ] Instrument emit() function to send metrics
- [ ] Verify metrics are being collected correctly
- [ ] Create baseline report (current legacy usage %)

**Phase 2: Monitoring (2-4 weeks)**
- [ ] Create dashboard with 4 key metrics
- [ ] Set up weekly automated reports
- [ ] Identify high-legacy-usage clients
- [ ] Document migration support process

**Phase 3: Alerting (1 week)**
- [ ] Configure threshold alerts (>20%, >50%)
- [ ] Set up Slack/email notifications
- [ ] Define on-call escalation for critical alerts

**Phase 4: Enforcement Planning (ongoing)**
- [ ] Define enforcement timeline based on metrics
- [ ] Communicate sunset plan to clients
- [ ] Remove legacy support code after timeline
- [ ] Monitor for errors after enforcement

---

## Success Criteria

- [ ] Weekly deprecation metrics visible in dashboard
- [ ] Alerting fires when migration stalls (>20% for 7 days)
- [ ] Enforcement timeline defined based on actual usage trends
- [ ] All clients migrated before sunset date
- [ ] Legacy provenance code removed without production incidents

---

## Related Documentation

- **Telemetry Events:** src/routes/assist.draft-graph.ts:178-200
- **OpenAPI Spec:** openapi.yaml (deprecation headers)
- **Migration Guide:** https://docs.olumi.ai/provenance-migration (TODO)
- **W3-Finding 4:** This document addresses the aggregation strategy gap

---

## Notes

- Current implementation emits metrics but has no downstream consumer
- 10% log sampling reduces noise, full metrics still emitted
- Enforcement should only happen after sustained low usage (<5% for 30+ days)
- Client communication is critical - some may have valid reasons for delay
