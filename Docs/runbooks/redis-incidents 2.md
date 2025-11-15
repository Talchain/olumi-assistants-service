# Runbook: Redis Incidents

## Symptom

- SSE resume returning 503/500 errors
- Logs showing "Redis unavailable"
- Healthz check degraded
- Rate limiting not working

## Quick Check

```bash
# Test Redis connectivity
redis-cli ping
# Expected: PONG

# Check Redis memory
redis-cli INFO memory | grep used_memory_human

# Check connection count
redis-cli CLIENT LIST | wc -l
```

## Incident Response

### Scenario 1: Redis Completely Down

**Impact**:
- ✅ Core functionality works (streaming without resume)
- ❌ Resume functionality disabled
- ❌ Rate limiting disabled (graceful degradation)

**Immediate Actions**:
1. Verify service is still accepting requests:
   ```bash
   curl -i https://olumi-assistants-service.onrender.com/healthz
   # Should return 200 (degraded but functional)
   ```

2. Check Redis provider status:
   - Render Redis addon status
   - Upstash dashboard

3. Restart Redis if self-hosted:
   ```bash
   sudo systemctl restart redis
   ```

**Communication**:
- Post incident status: "SSE resume temporarily unavailable, streaming functional"
- ETA: Based on provider status

### Scenario 2: Redis High Latency

**Symptoms**:
- Slow response times
- Timeout errors
- Connection pool exhausted

**Actions**:
1. Check slow queries:
   ```bash
   redis-cli SLOWLOG GET 10
   ```

2. Identify hot keys:
   ```bash
   redis-cli --hotkeys
   ```

3. Check connection pool:
   ```bash
   # In app logs
   grep "Redis pool" logs/production.log
   ```

4. Temporary relief:
   ```bash
   # Increase pool size
   REDIS_POOL_MAX=20  # Was 10
   ```

### Scenario 3: Redis Memory Full

**Symptoms**:
- OOM errors
- Eviction warnings
- Write failures

**Actions**:
1. Check memory usage:
   ```bash
   redis-cli INFO memory
   ```

2. Emergency cleanup:
   ```bash
   # Delete expired keys manually
   redis-cli --scan --pattern 'sse:state:*' \
     | xargs -L 1 redis-cli TTL \
     | awk '$1 < 0 {print $2}' \
     | xargs redis-cli DEL
   ```

3. Reduce TTLs temporarily:
   ```bash
   SSE_STATE_TTL_SEC=600    # Was 900 (15min -> 10min)
   SSE_SNAPSHOT_TTL_SEC=600
   ```

4. Scale up Redis (Render dashboard)

## Graceful Degradation Verification

Service should continue operating without Redis:

```bash
# Test streaming without Redis
curl -X POST https://olumi-assistants-service.onrender.com/assist/draft-graph/stream \
  -H "Content-Type: application/json" \
  -H "X-Olumi-Assist-Key: $ASSIST_API_KEY" \
  -d '{"brief":"test"}' \
  | head -20

# Should see events even with Redis down
```

## Prevention

1. **Monitor Redis metrics**:
   - Memory usage
   - Connection count
   - Latency (p95 < 10ms)
   - Eviction rate

2. **Set up alerts**:
   - Memory > 80%
   - Connections > 80% of max
   - Latency > 50ms

3. **Regular maintenance**:
   - Review slow queries weekly
   - Clean up orphaned keys
   - Test failover procedure quarterly

## Escalation

- Redis down > 30 min: Page on-call + notify engineering lead
- Data loss suspected: Engage data team immediately
- Repeated incidents: Schedule post-mortem
