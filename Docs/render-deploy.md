# Render Deployment Guide - Olumi Assistants Service

**Service:** olumi-assistants-service v1.0.1
**Target:** Render.com (Node 20, Oregon region)

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
