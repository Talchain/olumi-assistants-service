# Service Level Objectives (SLOs)

**Version**: v1.4.0
**Last Updated**: 2025-01-08
**Status**: Approved

This document defines the Service Level Objectives (SLOs) for the Olumi Assistants Service. These targets guide operational decisions, incident response, and capacity planning.

---

## Table of Contents

1. [Overview](#overview)
2. [Latency SLOs](#latency-slos)
3. [Error Rate SLOs](#error-rate-slos)
4. [Availability SLOs](#availability-slos)
5. [Throughput Targets](#throughput-targets)
6. [Per-Endpoint Targets](#per-endpoint-targets)
7. [Monitoring & Alerting](#monitoring--alerting)
8. [Error Budget](#error-budget)
9. [Review Process](#review-process)

---

## Overview

### Purpose

SLOs define measurable targets for service reliability. They help:
- Set customer expectations
- Guide engineering priorities
- Define when to "push new features" vs "focus on reliability"
- Provide clear incident severity criteria

### Measurement Period

All SLOs are measured over:
- **Rolling 7-day window** for alerting
- **Rolling 28-day window** for error budget tracking
- **Monthly** for reporting and review

### SLI Definitions

| SLI (Indicator) | Definition |
|-----------------|------------|
| **Latency** | Time from request received to response sent (server-side) |
| **Error Rate** | Percentage of requests returning 5xx status codes |
| **Availability** | Percentage of time `/healthz` returns 200 OK |
| **Throughput** | Requests per minute handled without degradation |

---

## Latency SLOs

### Overall Service Latency

| Percentile | Target | Alert Threshold | Critical Threshold |
|------------|--------|-----------------|-------------------|
| P50 | < 2,000ms | > 3,000ms | > 5,000ms |
| P95 | < 8,000ms | > 10,000ms | > 15,000ms |
| P99 | < 15,000ms | > 20,000ms | > 30,000ms |

### Latency by Endpoint Class

#### Fast Endpoints (< 500ms P95)
- `/healthz` - Health check
- `/v1/status` - Service diagnostics
- `/v1/limits` - Rate limit status

#### Standard Endpoints (< 8s P95)
- `/assist/draft-graph` - Non-streaming draft generation
- `/assist/clarify-brief` - Brief clarification
- `/assist/critique-graph` - Graph critique

#### Streaming Endpoints (< 15s TTFB)
- `/assist/draft-graph/stream` - SSE streaming
- Time-to-first-byte (TTFB): < 2,000ms P95

### Latency Dependencies

LLM provider latency significantly impacts overall latency:

| Provider | Expected P95 | Timeout |
|----------|--------------|---------|
| OpenAI | 5-10s | 30s |
| Anthropic | 3-8s | 30s |
| Fixtures | < 10ms | 1s |

---

## Error Rate SLOs

### Overall Error Rate

| Metric | Target | Warning | Critical |
|--------|--------|---------|----------|
| 5xx Rate | < 0.5% | > 1% | > 5% |
| Total Error Rate (4xx + 5xx) | < 5% | > 10% | > 20% |

### Error Categories

#### Expected Errors (Not counted in SLO)
- 400 Bad Request (client validation)
- 401 Unauthorized (missing auth)
- 403 Forbidden (invalid auth)
- 404 Not Found
- 429 Rate Limited

#### Counted Errors (Impact SLO)
- 500 Internal Server Error
- 502 Bad Gateway (upstream failure)
- 503 Service Unavailable
- 504 Gateway Timeout

### Per-Error Code Targets

| Error Code | Monthly Budget | Description |
|------------|----------------|-------------|
| 500 | < 0.1% | Internal errors |
| 502 | < 0.2% | LLM provider failures |
| 503 | < 0.1% | Service overload |
| 504 | < 0.2% | Upstream timeouts |

---

## Availability SLOs

### Availability Targets

| Tier | Target | Monthly Downtime Budget | Description |
|------|--------|------------------------|-------------|
| **Standard** | 99.5% | ~3.6 hours | Current target |
| **Enhanced** | 99.9% | ~43 minutes | Future goal |

### Availability Measurement

**Probe Method**: `/healthz` endpoint check every 30 seconds

**Success Criteria**:
- HTTP 200 response
- Response body contains `{ "ok": true }`
- Response time < 5 seconds

**Downtime Definition**:
- 3 consecutive probe failures = downtime starts
- 2 consecutive successes = downtime ends

### Scheduled Maintenance

- **Excluded from SLO**: Announced maintenance windows
- **Required notice**: 48 hours for planned maintenance
- **Max duration**: 2 hours per window
- **Max frequency**: 2 per month

---

## Throughput Targets

### Rate Limits (Per API Key)

| Endpoint Type | Default Limit | SSE Limit |
|---------------|---------------|-----------|
| Standard | 120 req/min | N/A |
| SSE Streaming | N/A | 20 req/min |

### Global Capacity Targets

| Metric | Target | Alert Threshold |
|--------|--------|-----------------|
| Peak RPS | 50 req/s | > 40 req/s (80% capacity) |
| Concurrent SSE connections | 100 | > 80 |
| Queue depth | 0 (no queueing) | > 10 |

### Capacity Planning

**Scaling triggers**:
- Sustained CPU > 70% for 10 minutes
- Sustained memory > 80% for 10 minutes
- Request queue forming (> 5 queued requests)
- P95 latency > 10s for 5 minutes

---

## Per-Endpoint Targets

### `/assist/draft-graph`

| Metric | Target | Warning | Critical |
|--------|--------|---------|----------|
| P50 Latency | < 2s | > 3s | > 5s |
| P95 Latency | < 8s | > 10s | > 15s |
| Error Rate | < 1% | > 2% | > 5% |
| Success Rate | > 95% | < 93% | < 90% |

### `/assist/draft-graph/stream`

| Metric | Target | Warning | Critical |
|--------|--------|---------|----------|
| TTFB P95 | < 2s | > 3s | > 5s |
| Full Response P95 | < 15s | > 20s | > 30s |
| Stream Completion | > 95% | < 93% | < 90% |
| Early Disconnect | < 5% | > 10% | > 20% |

### `/healthz`

| Metric | Target | Warning | Critical |
|--------|--------|---------|----------|
| P99 Latency | < 100ms | > 200ms | > 500ms |
| Success Rate | 100% | < 99.9% | < 99.5% |

### `/v1/status`

| Metric | Target | Warning | Critical |
|--------|--------|---------|----------|
| P95 Latency | < 500ms | > 1s | > 2s |
| Success Rate | > 99.9% | < 99.5% | < 99% |

---

## Monitoring & Alerting

### Alert Severity Levels

| Severity | Response Time | Notification | On-Call Required |
|----------|---------------|--------------|------------------|
| **Critical** | < 15 minutes | PagerDuty | Yes |
| **Warning** | < 1 hour | Slack | No |
| **Info** | Next business day | Email | No |

### Critical Alerts

```yaml
alerts:
  - name: High Error Rate
    condition: error_rate_5xx > 5%
    duration: 5 minutes
    severity: critical
    action: Page on-call, initiate incident

  - name: Service Down
    condition: healthz_failures >= 3
    duration: 2 minutes
    severity: critical
    action: Page on-call, initiate incident

  - name: P95 Latency Critical
    condition: p95_latency > 15000ms
    duration: 10 minutes
    severity: critical
    action: Page on-call, investigate

  - name: LLM Provider Down
    condition: upstream_error_rate > 50%
    duration: 5 minutes
    severity: critical
    action: Consider failover, page on-call
```

### Warning Alerts

```yaml
alerts:
  - name: Elevated Error Rate
    condition: error_rate_5xx > 1%
    duration: 10 minutes
    severity: warning
    action: Slack notification

  - name: High Latency
    condition: p95_latency > 10000ms
    duration: 15 minutes
    severity: warning
    action: Slack notification

  - name: Error Budget Burn
    condition: error_budget_remaining < 50%
    duration: 1 hour
    severity: warning
    action: Review recent changes, consider rollback

  - name: Capacity Warning
    condition: cpu_usage > 70% OR memory_usage > 80%
    duration: 10 minutes
    severity: warning
    action: Consider scaling
```

### Dashboard Metrics

**Primary Dashboard**:
- Request rate (RPM)
- P50/P95/P99 latency
- Error rate (5xx)
- Availability percentage
- Error budget remaining

**Detailed Dashboard**:
- Latency by endpoint
- Error rate by error code
- LLM provider latency and errors
- Cost per request
- Cache hit rate

---

## Error Budget

### Error Budget Policy

**Monthly Error Budget** (99.5% availability target):
- 43.2 minutes of downtime allowed
- 0.5% of requests can fail with 5xx

### Error Budget Consumption

| Remaining Budget | Action |
|-----------------|--------|
| > 75% | Normal operations, ship features |
| 50-75% | Caution, prioritize reliability |
| 25-50% | Focus on reliability, limit deployments |
| < 25% | Freeze changes, fix reliability issues |
| Exhausted | Emergency only, all hands on reliability |

### Budget Reset

- Error budgets reset on the 1st of each month
- Unused budget does not roll over
- Incidents during maintenance windows don't consume budget

---

## Review Process

### Monthly SLO Review

**Participants**: Engineering lead, SRE, Product owner

**Review Items**:
1. SLO achievement vs targets
2. Error budget consumption
3. Incident count and severity
4. Capacity utilization
5. Cost efficiency

**Outputs**:
- SLO achievement report
- Recommendations for target adjustments
- Action items for reliability improvements

### Quarterly Target Review

**Purpose**: Adjust SLO targets based on:
- Customer feedback
- Business requirements
- Technical capabilities
- Cost considerations

**Process**:
1. Review 3 months of SLO data
2. Gather customer satisfaction feedback
3. Propose target changes
4. Stakeholder approval
5. Update documentation and alerting

---

## Appendix: Datadog Queries

### Availability

```
avg:healthz.success_rate{service:assistants} by {1d}.as_count() * 100
```

### P95 Latency

```
avg:request.duration{service:assistants}.p95
```

### Error Rate

```
(sum:request.count{service:assistants,status:5xx} / sum:request.count{service:assistants}) * 100
```

### Error Budget Remaining

```
(0.5 - avg:error_rate_5xx{service:assistants}.over('7d')) / 0.5 * 100
```

---

## Revision History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| v1.4.0 | 2025-01-08 | Initial SLO documentation | Claude |
| | | Added per-endpoint targets | |
| | | Added error budget policy | |
