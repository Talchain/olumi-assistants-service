# Runbook: SSE Resume Failures

## Symptom

- Resume success rate < 98% (alerts from Datadog monitor)
- 401/404/410 errors on `/assist/draft-graph/resume`
- Users reporting "Resume failed" errors

## Quick Diagnosis

```bash
# Check recent resume failures
gh api repos/:owner/:repo/actions/workflows/perf-gate.yml/runs \
  --jq '.workflow_runs[0].html_url'

# Download latest perf results
gh run download <run-id> -n perf-sse-live-results

# Check resume success rate
cat perf-sse-live-results.json | jq '.summary.resume_success_rate'
```

## Common Causes

### 1. Token Expiration (410 Gone)

**Cause**: Resume tokens expire after 15 minutes (SSE_SNAPSHOT_TTL_SEC)

**Fix**:
- Increase TTL if clients need longer resume windows:
  ```bash
  # In Render dashboard
  SSE_SNAPSHOT_TTL_SEC=1800  # 30 minutes
  ```
- Verify client retry logic respects 410 and starts new stream

### 2. HMAC Secret Mismatch (401 Unauthorized)

**Cause**: Resume token signed with old secret after rotation

**Fix**:
1. Check if recent secret rotation occurred:
   ```bash
   # Verify current secrets
   echo $SSE_RESUME_SECRET | cut -c1-10
   echo $HMAC_SECRET | cut -c1-10
   ```

2. Rollback or wait for token TTL to expire (15 min)

3. Use gradual rotation script:
   ```bash
   node scripts/rotate-hmac.mjs --gradual
   ```

### 3. Redis Unavailability (404 Not Found)

**Cause**: Redis down, state not found

**Fix**:
1. Check Redis health:
   ```bash
   # From Render shell
   redis-cli ping
   ```

2. Check Redis connection metrics in Datadog

3. Verify graceful degradation:
   - Streaming should continue without resume
   - Check telemetry for "Redis unavailable" warnings

### 4. Buffer Trim Race Condition

**Cause**: Events trimmed before resume, offset mismatch

**Fix**:
1. Check buffer trim rate:
   ```bash
   cat perf-sse-live-results.json | jq '.summary.buffer_trim_rate'
   ```

2. If > 0.5%, increase buffer limits:
   ```bash
   SSE_BUFFER_MAX_EVENTS=512      # Was 256
   SSE_BUFFER_MAX_SIZE_MB=3.0     # Was 1.5
   ```

## Escalation

If resume success rate stays < 98% after fixes:

1. Check Datadog dashboard for anomalies
2. Review recent deploys for regressions
3. Page on-call engineer
4. Consider temporary fallback to snapshot-only resume

## Prevention

- Monitor resume success rate continuously
- Alert on < 98% success rate
- Test secret rotation in staging first
- Maintain buffer capacity headroom (< 80% full)
