# Diagnostics Runbook

Operational guide for using the service diagnostics endpoints.

## Available Endpoints

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `GET /healthz` | None | Liveness check |
| `GET /v1/status` | None | Runtime diagnostics |
| `GET /diagnostics` | Key ID allowlist | CEE internal state |

## When to Use Diagnostics

### `/healthz` - Health Checks
- Load balancer health probes
- Kubernetes liveness/readiness
- Quick "is it running?" checks

```bash
curl https://your-service/healthz
# Returns: { "status": "ok", "version": "1.11.1", "provider": "anthropic" }
```

### `/v1/status` - Performance Analysis
- Investigate slow requests
- Monitor cache effectiveness
- Capacity planning

```bash
curl https://your-service/v1/status
```

**Key metrics to watch:**
- `llm.cache_stats.hit_rate` - Target >80%
- `performance.p99_ms` - Target <8000ms
- `performance.slow_request_rate` - Target <5%
- `storage.share_packs.count` - Monitor for growth

### `/diagnostics` - CEE Debug (Internal Only)

**Security:** Requires `CEE_DIAGNOSTICS_KEY_IDS` environment variable.

```bash
# Enable for specific API keys
CEE_DIAGNOSTICS_KEY_IDS=key1,key2

# Access with authorized key
curl -H "X-Olumi-Assist-Key: key1" https://your-service/diagnostics
```

**Exposed information:**
- Active A/B experiments
- Prompt store health
- ISL circuit breaker status
- Feature flag states

## Enabling Diagnostics Keys

1. Identify trusted operator API keys
2. Add to `CEE_DIAGNOSTICS_KEY_IDS` (comma-separated)
3. Redeploy service
4. Verify access with authorized key

```bash
# Test unauthorized access (should fail)
curl https://your-service/diagnostics
# 403 Forbidden

# Test authorized access
curl -H "X-Olumi-Assist-Key: $OPERATOR_KEY" https://your-service/diagnostics
# 200 with diagnostics
```

## Key Rotation

When rotating diagnostics keys:

1. Add new key ID to `CEE_DIAGNOSTICS_KEY_IDS`
2. Deploy
3. Verify new key works
4. Remove old key from list
5. Deploy again

**Impact:** Diagnostics access only - no production traffic impact.

## Troubleshooting

### High Cache Miss Rate
```
cache_stats.hit_rate < 50%
```
**Causes:**
- Cache recently cleared/restarted
- High variety in request patterns
- Cache TTL too short

**Actions:**
1. Check `PROMPT_CACHE_TTL_MS` (default: 1 hour)
2. Review request patterns in logs
3. Consider increasing `PROMPT_CACHE_MAX_SIZE`

### High P99 Latency
```
performance.p99_ms > 10000
```
**Causes:**
- LLM provider latency spike
- Large/complex briefs
- ISL service degradation

**Actions:**
1. Check ISL circuit breaker status in `/diagnostics`
2. Review LLM provider status pages
3. Check for retry loops in telemetry

### Storage Growth
```
storage.share_packs.count > 10000
```
**Causes:**
- Share feature heavily used
- TTL not enforced (Redis mode)

**Actions:**
1. Review `SHARE_PACK_TTL_SECONDS`
2. Check Redis memory usage
3. Consider manual cleanup

## Monitoring Integration

### Datadog
```yaml
# Add to dd-agent config
- service: olumi-assistants
  url: https://your-service/v1/status
  http_check_interval: 60
  alert_threshold: 3
```

### Prometheus (via metrics export)
```
# Custom metrics emitted via telemetry
olumi_request_duration_seconds{route="/assist/draft-graph"}
olumi_cache_hit_ratio{backend="memory"}
olumi_sse_buffer_events{stream_id="..."}
```

## Related Runbooks

- [Redis Incidents](./redis-incidents.md)
- [Buffer Pressure](./buffer-pressure.md)
- [CEE/LLM Outage](./cee-llm-outage-or-spike.md)
