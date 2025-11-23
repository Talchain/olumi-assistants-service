# Production Grounding Feature Flip Plan

**Version:** v1.1.1
**Feature:** Document Grounding (ENABLE_GROUNDING)
**Current State:** DISABLED (default: false)
**Target State:** ENABLED (ENABLE_GROUNDING=true)

---

## Pre-Flip Verification

### 1. Verify Current State

Check production environment variable:

```bash
# Via Render dashboard:
# 1. Navigate to olumi-assistants-service
# 2. Go to Environment tab
# 3. Verify ENABLE_GROUNDING is NOT set (defaults to false)

# Via healthz endpoint:
curl https://olumi-assistants-service.onrender.com/healthz | jq '.feature_flags.grounding'
# Expected output: false
```

### 2. Verify v1.1.1 Deployment

```bash
curl https://olumi-assistants-service.onrender.com/healthz | jq '.version'
# Expected output: "1.1.1"
```

### 3. Confirm Staging Burn-In Complete

Review [Docs/staging-burnin.md](./staging-burnin.md) checklist:
- [ ] All staging tests passed
- [ ] 24-hour burn-in completed
- [ ] No PII leakage confirmed
- [ ] Performance: p95 < 8000ms
- [ ] Grounding tested with attachments
- [ ] Privacy compliance verified

---

## Flip Procedure

### One-Click Environment Change

**Via Render Dashboard:**

1. Navigate to https://dashboard.render.com/web/olumi-assistants-service
2. Click "Environment" tab
3. Add new environment variable:
   - Key: `ENABLE_GROUNDING`
   - Value: `true`
4. Click "Save Changes"
5. Service will automatically redeploy (~2-3 minutes)

**Expected Behavior:**
- Service restarts with new environment variable
- Health check recovers within 30 seconds
- Feature flag reflected in /healthz response

---

## Post-Flip Verification

### 1. Health Check

```bash
# Verify service is healthy
curl https://olumi-assistants-service.onrender.com/healthz
# Expected: {"ok": true, "version": "1.1.1", "feature_flags": {"grounding": true, ...}}
```

### 2. Smoke Test - Document Grounding

```bash
# Test with text attachment
curl -X POST https://olumi-assistants-service.onrender.com/assist/draft-graph \
  -H "Content-Type: application/json" \
  -d '{
    "brief": "Analyze the attached company policy document",
    "attachments": [
      {"id": "att_0", "kind": "document", "name": "policy.txt"}
    ],
    "attachment_payloads": {
      "att_0": "Q29tcGFueSBQb2xpY3k6IEFsbCBlbXBsb3llZXMgbXVzdCB3b3JrIHJlbW90ZWx5Lg=="
    }
  }' | jq '.'

# Verify response includes:
# - citations array (grounding evidence)
# - rationales with provenance_source
# - no errors
```

### 3. Smoke Test - CSV Grounding

```bash
# Test with CSV attachment
curl -X POST https://olumi-assistants-service.onrender.com/assist/draft-graph \
  -H "Content-Type: application/json" \
  -d '{
    "brief": "Analyze quarterly revenue from the attached CSV",
    "attachments": [
      {"id": "att_0", "kind": "table", "name": "revenue.csv"}
    ],
    "attachment_payloads": {
      "att_0": "cXVhcnRlcixyZXZlbnVlClExLDEwMDAwMApRMiwxNTAwMDo="
    }
  }' | jq '.'

# Verify response includes:
# - csv_stats array with aggregates
# - NO raw CSV row data (privacy)
# - rationales reference statistics
```

### 4. Monitor for 1 Hour

Watch for:
- **Error Rate**: Should remain < 1%
- **Response Time**: p95 < 8000ms
- **PII Leakage**: Check logs for CSV row data (should be redacted)
- **Cost**: Monitor LLM costs (grounding adds tokens)

```bash
# Check recent errors
gh run list --repo Talchain/olumi-assistants-service --limit 5

# Or via Render logs:
# Dashboard → olumi-assistants-service → Logs
# Filter for: level:error
```

---

## Rollback Procedure

**If issues detected:**

### Quick Rollback (2 minutes)

1. **Via Render Dashboard:**
   - Environment tab → Remove `ENABLE_GROUNDING` variable
   - Save Changes → Service redeploys with default (false)

2. **Verify rollback:**
   ```bash
   curl https://olumi-assistants-service.onrender.com/healthz | jq '.feature_flags.grounding'
   # Expected: false
   ```

### Rollback Triggers

Roll back immediately if:
- ❌ Error rate > 5% for 5 minutes
- ❌ p95 latency > 12s consistently
- ❌ PII detected in logs
- ❌ Cost spike > 200% of baseline

---

## Success Criteria

After 1 hour of monitoring, feature flip is successful if:

- ✅ Health check returns `grounding: true`
- ✅ Document attachments return citations
- ✅ CSV attachments return statistics (no raw rows)
- ✅ Error rate < 1%
- ✅ p95 latency < 8000ms
- ✅ No PII in logs
- ✅ Costs within expected range (+20% max)

---

## Checklist

### Pre-Flip
- [ ] v1.1.1 deployed to production
- [ ] Staging burn-in completed (24h)
- [ ] Current state verified: ENABLE_GROUNDING=false
- [ ] Smoke test scripts prepared

### Flip
- [ ] Added ENABLE_GROUNDING=true via Render dashboard
- [ ] Service redeployed successfully
- [ ] Health check confirms grounding=true

### Post-Flip
- [ ] Document grounding smoke test passed
- [ ] CSV grounding smoke test passed
- [ ] 1-hour monitoring completed
- [ ] Error rate < 1%
- [ ] p95 < 8000ms
- [ ] No PII detected in logs

### Sign-Off
- [ ] Engineering Lead approved
- [ ] SRE approved
- [ ] Feature flip documented in CHANGELOG.md

---

## Notes

- **Reversible**: Can be rolled back in < 2 minutes
- **No Database Changes**: Environment variable only
- **Zero Downtime**: Render handles graceful restart
- **Monitoring**: Use Render logs + Datadog dashboards

---

**Prepared By:** Claude Code
**Date:** 2025-01-07
**Status:** READY (pending v1.1.1 deployment and staging burn-in)
