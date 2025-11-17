# Runbook: SSE Buffer Pressure

## Symptom

- Buffer trim rate > 0.5%
- Memory usage climbing
- Resume failures with incomplete state
- Telemetry shows `SseBufferTrimmed` events

## Quick Diagnosis

```bash
# Check latest perf results
cat perf-sse-live-results.json | jq '{
  buffer_trim_rate: .summary.buffer_trim_rate,
  buffer_trims: .summary.buffer_trims,
  streams: .summary.streams_started
}'

# Check for trimming in logs
heroku logs --tail | grep "buffer_trimmed"
```

## Immediate Mitigation

### 1. Increase Buffer Limits (if safe)

```bash
# Render dashboard environment variables
SSE_BUFFER_MAX_EVENTS=512      # Was 256
SSE_BUFFER_MAX_SIZE_MB=3.0     # Was 1.5
```

**⚠️ Warning**: Monitor memory usage after increase. Each MB = 1MB RAM per active stream.

### 2. Enable Payload Trimming (v1.10+)

```bash
# Already enabled by default in v1.10
SSE_BUFFER_TRIM_PAYLOADS=true  # Default: true
```

Verify trimming is working:
```bash
# Check logs for trimming savings
heroku logs | grep "Applied payload trimming"
```

### 3. Enable Compression (v1.10+)

```bash
SSE_BUFFER_COMPRESS=true  # Default: false
```

**Trade-offs**:
- ✅ **Savings**: ~40% memory reduction per buffered event
- ✅ **When to enable**: Buffer trim rate > 0.3% consistently
- ❌ **Cost**: +10-15% CPU usage during streaming
- ❌ **Latency**: +5-10ms per resume operation (decompression)

**Monitoring after enabling**:
```bash
# Watch CPU usage
heroku ps:scale web=1 | grep cpu

# Verify compression savings in logs
heroku logs --tail | grep "Applied event compression"

# Check resume latency impact
# p95 should stay < 12s despite decompression
```

**When NOT to enable**:
- CPU already > 80%
- Resume latency approaching 12s SLO
- Buffer trim rate < 0.3% (trimming not a problem yet)

## Root Cause Analysis

### High Event Volume

**Check**:
- Are streams generating > 256 events?
- Are events larger than expected?

**Fix**:
- Review LLM provider settings (reduce verbosity)
- Implement event sampling for trace/debug events

### Slow Clients

**Check**:
- Are clients disconnecting frequently?
- Network latency issues?

**Fix**:
- Improve client retry logic
- Reduce heartbeat frequency if network constrained

### Memory Leak

**Check**:
```bash
# Monitor memory over time
watch -n 60 'heroku ps:scale web=1 | grep memory'
```

**Fix**:
- Verify buffer cleanup on stream completion
- Check for orphaned Redis keys:
  ```bash
  redis-cli --scan --pattern 'sse:buffer:*' | wc -l
  # Should match active stream count
  ```

## Long-term Solutions

1. **Implement event sampling**: Keep only critical events (stage transitions, errors)
2. **Reduce event size**: Minimize payload fields
3. **Shorten TTL**: Reduce SSE_STATE_TTL_SEC if clients resume quickly
4. **Archive to S3**: Move completed snapshots to object storage

## Escalation

Buffer trim rate > 1%:
- Page on-call
- Consider temporary service degradation announcement
- Evaluate emergency capacity increase
