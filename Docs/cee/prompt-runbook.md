# CEE Prompt Management Runbook

Operational procedures for managing the CEE prompt management system.

## Quick Reference

| Action | Command/Procedure |
|--------|-------------------|
| Check prompt store health | `GET /healthz` → check `prompts.healthy` |
| View active experiments | `GET /diagnostics` → `prompts.active_experiments` |
| Disable prompt management | Set `PROMPTS_ENABLED=false`, restart |
| Force fallback to defaults | Delete store file, restart |
| Emergency rollback | See [Emergency Rollback](#emergency-rollback) |

## Failure Modes

### 1. Store Initialization Failure

**Symptoms:**
- Service logs `prompt store initialization failed`
- `/healthz` shows `prompts.healthy: false`
- CEE routes return 503 with `store_unavailable`

**Diagnosis:**
```bash
# Check logs for initialization errors
grep "prompt.*init\|store.*failed" /var/log/assistants.log

# Verify file permissions
ls -la data/prompts.json

# Check disk space
df -h /data
```

**Recovery:**
1. Check file permissions on store path
2. Verify parent directory exists
3. Check for corrupt JSON:
   ```bash
   cat data/prompts.json | jq .  # Should parse without errors
   ```
4. If corrupt, backup and delete:
   ```bash
   mv data/prompts.json data/prompts.json.bak
   # Service will reinitialize with empty store
   ```
5. Restart service

### 2. Braintrust Unavailable

**Symptoms:**
- Telemetry shows `braintrust_unavailable` events
- A/B experiments not recording analytics
- Service continues working (graceful degradation)

**Diagnosis:**
```bash
# Check Braintrust connectivity
curl -H "Authorization: Bearer $BRAINTRUST_API_KEY" \
  https://api.braintrustdata.com/v1/projects

# Check logs
grep "braintrust\|bt_" /var/log/assistants.log
```

**Recovery:**
1. Verify `BRAINTRUST_API_KEY` is set and valid
2. Check Braintrust status page
3. If persistent, service will continue with local-only operation

### 3. Hash Mismatch Detected

**Symptoms:**
- Logs show `prompt hash mismatch`
- Telemetry: `prompt.hash_mismatch` events
- Prompt content may have been tampered with

**Diagnosis:**
```bash
# Check for hash mismatch events
grep "hash_mismatch" /var/log/assistants.log

# Inspect affected prompt
curl -H "X-Admin-Key: $ADMIN_KEY" \
  https://api.example.com/admin/prompts/{prompt_id}
```

**Recovery:**
1. **Investigate the source** - was this an unauthorized change?
2. If legitimate edit was made outside the system:
   ```bash
   # Re-save prompt through admin API to update hash
   curl -X PATCH \
     -H "X-Admin-Key: $ADMIN_KEY" \
     -H "Content-Type: application/json" \
     -d '{"status": "production"}' \
     https://api.example.com/admin/prompts/{prompt_id}
   ```
3. If tampered, restore from backup

### 4. ISL Endpoints Unavailable

**Symptoms:**
- Decision Review returns `islAvailable: false`
- Telemetry: `cee.decision_review.isl_fallback` events
- Reviews lack ISL-powered fields

**Diagnosis:**
```bash
# Check ISL health
curl https://isl-service.example.com/health

# Check circuit breaker status
curl -H "X-API-Key: $API_KEY" \
  https://api.example.com/diagnostics | jq '.isl.circuit_breaker'
```

**Recovery:**
1. Check ISL service status
2. Wait for circuit breaker to reset (90 seconds by default)
3. Decision Review will continue with basic analysis

## Emergency Procedures

### Emergency Rollback

When a bad prompt causes production issues:

```bash
# 1. Identify the problematic prompt
curl -H "X-Admin-Key: $ADMIN_KEY" \
  https://api.example.com/admin/prompts | jq '.[] | select(.status=="production")'

# 2. Rollback to previous version
curl -X POST \
  -H "X-Admin-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "targetVersion": 1,
    "rolledBackBy": "oncall@example.com",
    "reason": "Production issue - reverting to stable version"
  }' \
  https://api.example.com/admin/prompts/{prompt_id}/rollback

# 3. Verify rollback
curl -H "X-Admin-Key: $ADMIN_KEY" \
  https://api.example.com/admin/prompts/{prompt_id} | jq '.activeVersion'
```

### Disable Prompt Management Quickly

To immediately fall back to hardcoded defaults:

```bash
# Option 1: Environment variable (requires restart)
export PROMPTS_ENABLED=false
systemctl restart assistants

# Option 2: Delete store file (doesn't require restart)
mv data/prompts.json data/prompts.json.disabled
# Service will detect missing file and use defaults
```

### Force Fallback to Defaults

To ensure all requests use default prompts:

```bash
# Delete all production prompts (they'll be archived)
for id in $(curl -H "X-Admin-Key: $ADMIN_KEY" \
  https://api.example.com/admin/prompts | \
  jq -r '.[] | select(.status=="production") | .id'); do
  curl -X PATCH \
    -H "X-Admin-Key: $ADMIN_KEY" \
    -H "Content-Type: application/json" \
    -d '{"status": "archived"}' \
    https://api.example.com/admin/prompts/$id
done
```

### Disable Enhanced Review Features

To disable ISL-powered decision review enhancements:

```bash
# Set environment variable
export CEE_CAUSAL_VALIDATION_ENABLED=false
systemctl restart assistants
```

## Monitoring & Alerting

### Key Metrics to Monitor

| Metric | Description | Alert Threshold |
|--------|-------------|-----------------|
| `prompt.store.error` | Store operation failures | > 0/min |
| `prompt.loader.error` | Prompt load failures | > 1% of requests |
| `prompt.hash_mismatch` | Content integrity failures | > 0 |
| `cee.decision_review.isl_fallback` | ISL unavailable | > 10% of reviews |

### Suggested Alerts

```yaml
# Datadog monitor example
- name: Prompt Store Errors
  type: metric alert
  query: sum:olumi.assistants.prompt.store.error{*}.as_count() > 0
  message: "Prompt store experiencing errors"

- name: High Default Fallback Rate
  type: metric alert
  query: |
    (sum:olumi.assistants.prompt.loader.source{source:default}.as_count() /
     sum:olumi.assistants.prompt.loader.source{*}.as_count()) > 0.5
  message: "Over 50% of prompts loading from defaults"

- name: ISL Fallback Rate
  type: metric alert
  query: |
    (sum:olumi.assistants.cee.decision_review.isl_fallback{*}.as_count() /
     sum:olumi.assistants.cee.decision_review.succeeded{*}.as_count()) > 0.1
  message: "ISL unavailable for >10% of decision reviews"
```

## Maintenance Procedures

### Backup Prompt Store

```bash
# Create timestamped backup
cp data/prompts.json data/backups/prompts-$(date +%Y%m%d-%H%M%S).json

# Automated daily backup (cron)
0 3 * * * cp /data/prompts.json /backups/prompts-$(date +\%Y\%m\%d).json
```

### Restore from Backup

```bash
# Stop service
systemctl stop assistants

# Restore backup
cp data/backups/prompts-YYYYMMDD.json data/prompts.json

# Start service
systemctl start assistants
```

### Clean Up Old Versions

Archived prompts with many versions can be cleaned:

```bash
# This is a manual process - archive old prompts through admin API
# Consider implementing a cleanup job if needed
```

## Troubleshooting Guide

### "No default prompt registered for task"

**Cause:** Prompt loader accessed before defaults registered

**Solution:**
1. Check `registerAllDefaultPrompts()` is called in `server.ts`
2. Ensure it's called before routes are registered

### "Prompt store initialization timed out"

**Cause:** File system I/O slow or blocked

**Solution:**
1. Check disk health
2. Verify no file locks on store file
3. Increase initialization timeout if needed

### Experiment not showing in diagnostics

**Cause:** Experiment registration happens at runtime

**Solution:**
1. Check if experiment registration code is being executed
2. Verify task ID matches a valid CEE task
3. Experiments are in-memory; restart clears them

### A/B assignments not consistent

**Cause:** Different identifiers being used

**Solution:**
1. Always pass consistent `userId` or `keyId`
2. Same identifier always gets same variant
3. Without identifier, assignment is random per request

## Contact

- **Oncall**: #assistants-oncall
- **Prompt Management Owner**: Platform Team
- **Documentation**: https://docs.example.com/cee/prompts
