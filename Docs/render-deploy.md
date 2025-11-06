# Render Deployment Guide - Olumi Assistants Service

**Service:** olumi-assistants-service v1.1.0
**Target:** Render.com (Node 20, Oregon region)

**New in v1.1.0:** Document grounding (opt-in via `ENABLE_GROUNDING=true`)

---

## Prerequisites

- Render.com account with billing enabled
- Repository access to `olumi-assistants-service`
- Anthropic API key (optional, can use fixtures mode)

---

## 2-Click Deployment Steps

### Step 1: Create New Web Service

1. Log in to [Render Dashboard](https://dashboard.render.com/)
2. Click **"New +"** → **"Web Service"**
3. Connect to repository: `olumi-assistants-service`
4. Configure service:

| Field | Value |
|-------|-------|
| **Name** | `olumi-assistants-service` |
| **Region** | Oregon (us-west-2) |
| **Branch** | `main` |
| **Runtime** | Node |
| **Build Command** | `pnpm install && pnpm build` |
| **Start Command** | `node dist/src/server.js` |
| **Plan** | Starter ($7/month) |

5. Expand **Advanced** settings:
   - **Health Check Path:** `/healthz`
   - **Auto-Deploy:** Yes

### Step 2: Configure Environment Variables

Add these environment variables in the Render dashboard:

```bash
NODE_ENV=production
LLM_PROVIDER=fixtures
COST_MAX_USD=1.00
ASSISTANTS_TIMEOUT_MS=15000
ASSISTANTS_MAX_RETRIES=1
SSE_MAX_MS=120000
PORT=3101
CORS_ALLOWED_ORIGINS=*
RATE_LIMIT_MAX=120
RATE_LIMIT_WINDOW_MS=60000
BODY_LIMIT_BYTES=1048576
```

**Optional (if using Anthropic):**
```bash
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
```

**Optional (if using OpenAI):**
```bash
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
```

6. Click **"Create Web Service"**

---

## Post-Deployment Verification

Once deployed, Render will provide a service URL like:
```
https://olumi-assistants-service.onrender.com
```

### Health Check
```bash
curl -s https://olumi-assistants-service.onrender.com/healthz | jq .
```

Expected response:
```json
{
  "status": "ok",
  "version": "1.0.1",
  "provider": "fixtures"
}
```

### Smoke Test: Clarifier
```bash
curl -s -X POST https://olumi-assistants-service.onrender.com/assist/clarify-brief \
  -H 'Content-Type: application/json' \
  -d '{"brief":"Should I hire employees or use contractors?","round":0}' | jq .
```

Expected: 200 OK with `questions` array

### Smoke Test: Critique
```bash
curl -s -X POST https://olumi-assistants-service.onrender.com/assist/critique-graph \
  -H 'Content-Type: application/json' \
  -d '{"graph":{"version":"1","default_seed":17,"nodes":[{"id":"a","kind":"goal","label":"Test"}],"edges":[]}}' | jq .
```

Expected: 200 OK with `issues` array

---

## Enabling Document Grounding (v1.1.0+)

### Overview
Document grounding is **disabled by default** for production safety. Enable explicitly after verifying baseline performance.

### Step 1: Deploy with Grounding OFF (Default)
Deploy v1.1.0 with default settings (grounding disabled):
```bash
# No action needed - ENABLE_GROUNDING defaults to false
```

Verify grounding is OFF:
```bash
curl -s https://YOUR-SERVICE-URL/healthz | jq '.feature_flags.grounding'
# Should return: false
```

Monitor for 24 hours:
- Check error rates (should be same as v1.0.1)
- Check p95 latency (should be same as v1.0.1)
- Verify all endpoints functional

### Step 2: Enable Grounding
After baseline verification, enable grounding:

1. **Add Environment Variable:**
   - Dashboard → Service → Environment
   - Click **"Add Environment Variable"**
   - Name: `ENABLE_GROUNDING`
   - Value: `true`
   - Click **"Save Changes"**

2. **Restart Service:**
   - Dashboard → Service → Manual Deploy → Redeploy
   - Or wait for auto-restart (happens automatically)

3. **Verify Grounding Enabled:**
```bash
curl -s https://YOUR-SERVICE-URL/healthz | jq '.feature_flags.grounding'
# Should return: true
```

### Step 3: Test with Attachments
```bash
# Test with small text file
curl -s -X POST https://YOUR-SERVICE-URL/assist/draft-graph \
  -H 'Content-Type: application/json' \
  -d '{
    "brief": "Analyze the attached document and create a decision framework",
    "attachments": [{"id":"test","kind":"txt","name":"test.txt"}],
    "attachment_payloads": {"test":"SGVsbG8gV29ybGQ="}
  }' | jq .
```

**Expected Response:**
- 200 OK
- `rationales` array with provenance
- Some rationales have `provenance_source: "document"`
- Response time < 15s (p95 target)

### Step 4: Monitor Grounding Usage
After enabling, monitor:
- **Attachment Processing Errors:** Should be < 1%
- **Latency:** p95 should stay < 15s with attachments
- **CSV Privacy:** Zero row data leaks (critical - automated tests verify)
- **Cost:** Expect 10-20% increase in LLM tokens

### Troubleshooting Grounding

| Issue | Cause | Solution |
|-------|-------|----------|
| Attachments ignored | `ENABLE_GROUNDING=false` | Set `ENABLE_GROUNDING=true` in env |
| 400 "file too large" | File > 5k chars or total > 50k | Reduce file size or split files |
| 400 "invalid base64" | Malformed payload | Check base64 encoding |
| Slow responses | Large PDF processing | Monitor p95, may need to lower limits |

### Disabling Grounding (Rollback)
If issues occur:
1. Dashboard → Service → Environment
2. Set `ENABLE_GROUNDING=false` (or remove variable)
3. Redeploy
4. Verify: `curl -s .../healthz | jq '.feature_flags.grounding'` returns `false`

---

## Rollback Plan

If issues occur:

1. **Pause Auto-Deploy:**
   - Dashboard → Service → Settings → Auto-Deploy → OFF

2. **Revert to Previous Deployment:**
   - Dashboard → Service → Events → Find last good deployment → "Redeploy"

3. **Emergency Shutdown:**
   - Dashboard → Service → Settings → Suspend Service

---

## Monitoring

- **Logs:** Dashboard → Service → Logs (real-time)
- **Metrics:** Dashboard → Service → Metrics (CPU, memory, response time)
- **Health:** Auto-checked every 30s at `/healthz`

---

## Cost Estimates

- **Compute:** $7/month (Starter plan)
- **LLM API calls:**
  - Fixtures mode: $0
  - Anthropic (Claude): ~$0.003 per clarify/critique call
  - Target: <$50/month with 1,000-2,000 calls

---

## Support

- **Render docs:** https://render.com/docs
- **Service health:** Check `/healthz` endpoint
- **Logs:** Available in Render dashboard
