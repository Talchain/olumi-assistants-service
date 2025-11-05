# Render Deployment - Quick Start

**Deploy the Olumi Assistants Service to Render in under 10 minutes**

---

## Option A: Single Production Service (Recommended)

Deploy one production service using OpenAI (cost-effective default).

### Prerequisites

1. **Render account** - [Sign up at render.com](https://dashboard.render.com/)
2. **OpenAI API key** - [Get from OpenAI platform](https://platform.openai.com/api-keys)
3. **PLoT Engine deployed** - Already running on Render
4. **GitHub repo** - Push this code to GitHub

### Step 1: Create Render Service (2 minutes)

1. Go to [Render Dashboard](https://dashboard.render.com/)
2. Click **"New +"** → **"Blueprint"**
3. Connect your GitHub repository
4. Select branch: `main` (or your deployment branch)
5. Render detects `render.yaml` → Click **"Apply"**

**Service created:** `olumi-assistants-service`

### Step 2: Set Environment Variables (3 minutes)

Click on your new service → **"Environment"** tab → Add these variables:

| Variable | Value | Where to Get |
|----------|-------|--------------|
| `OPENAI_API_KEY` | `sk-proj-...` | [OpenAI API Keys](https://platform.openai.com/api-keys) |
| `ENGINE_BASE_URL` | `https://plot-engine.onrender.com` | Your PLoT engine URL |
| `ALLOWED_ORIGINS` | `https://app.olumi.ai` | Your frontend URL (comma-separated) |

**Click "Save Changes"** - Render will automatically redeploy.

### Step 3: Verify Deployment (2 minutes)

**Wait for deployment** (3-5 minutes for first build).

**Check health:**
```bash
curl https://olumi-assistants-service.onrender.com/healthz
```

**Expected response:**
```json
{
  "ok": true,
  "service": "assistants",
  "version": "1.0.0",
  "provider": "openai",
  "model": "gpt-4o-mini"
}
```

**Send test request:**
```bash
curl -X POST https://olumi-assistants-service.onrender.com/assist/draft-graph \
  -H "Content-Type: application/json" \
  -d '{"brief":"Should we expand internationally or focus on domestic growth?"}'
```

**Expected:** 200 OK with graph object.

---

## Performance Baseline (Optional - Run Later)

After deployment, measure latency:

```bash
# Set your Render URL
export ASSISTANTS_URL=https://olumi-assistants-service.onrender.com

# Run 5-minute baseline test
pnpm perf:baseline:prod

# Open HTML report
open tests/perf/_reports/latest.html
```

**Expected metrics:**
- **p50:** ~1.5s (OpenAI gpt-4o-mini)
- **p95:** ~3s ✅ (well under 8s gate)
- **p99:** ~4.5s

---

## Switching to Anthropic (If Needed)

To switch from OpenAI to Anthropic Claude:

1. Get Anthropic API key: [console.anthropic.com](https://console.anthropic.com/settings/keys)
2. In Render → Environment → Add:
   - `ANTHROPIC_API_KEY` = `sk-ant-...`
   - Change `LLM_PROVIDER` = `anthropic`
3. Save changes → Service redeploys

**New model:** `claude-3-haiku-20240307` (cost-effective)

---

## Security Configuration (Already Set)

These are pre-configured in `render.yaml`:

- ✅ **CORS**: Only allows `ALLOWED_ORIGINS`
- ✅ **Rate limit**: 120 req/minute per IP
- ✅ **Body limit**: 1 MB max request size
- ✅ **Cost cap**: $1.00 max per request
- ✅ **Redaction**: Enabled for sensitive data

---

## Troubleshooting

### Service won't start

**Check logs** in Render dashboard for errors.

**Common issues:**

1. **Missing OPENAI_API_KEY**
   ```
   ❌ FATAL: LLM_PROVIDER=openai but OPENAI_API_KEY is not set
   ```
   **Fix:** Add `OPENAI_API_KEY` in Environment tab

2. **Missing ENGINE_BASE_URL**
   - Service needs PLoT engine URL
   - Add `ENGINE_BASE_URL` environment variable

### CORS errors in frontend

**Error:** `blocked by CORS policy`

**Fix:** Add your frontend URL to `ALLOWED_ORIGINS`:
```
ALLOWED_ORIGINS=https://app.olumi.ai,https://staging.olumi.ai
```

### 429 Rate limit errors

**Fix:** Increase rate limits in Environment:
```
RATE_LIMIT_MAX=240
RATE_LIMIT_WINDOW_MS=60000
```

### Slow performance (p95 > 8s)

1. Check model:
   ```bash
   curl https://your-service.onrender.com/healthz | jq .model
   ```

2. OpenAI is faster than Anthropic:
   - `gpt-4o-mini`: ~1-3s typical
   - `claude-3-haiku`: ~2-4s typical

3. Upgrade Render plan to **Standard** for more resources

---

## Cost Estimates

### Render Hosting
- **Starter plan:** $7/month
- **Standard plan:** $25/month (better performance)

### OpenAI API (default)
- **gpt-4o-mini:** $0.15 per 1M input tokens, $0.60 per 1M output
- **Typical request:** ~$0.001 (0.1 cents)
- **1000 requests/day:** ~$30/month

### Anthropic API (optional)
- **claude-3-haiku:** $0.25 per 1M input tokens, $1.25 per 1M output
- **Typical request:** ~$0.002 (0.2 cents)
- **1000 requests/day:** ~$60/month (2x OpenAI)

**Recommendation:** Start with OpenAI for cost-effectiveness.

---

## Monitoring (Future)

Datadog integration is disabled by default (`DISABLE_DATADOG=1`).

To enable later:
1. Remove `DISABLE_DATADOG` or set to `0`
2. Add `DD_API_KEY` environment variable
3. Redeploy

---

## Next Steps

1. ✅ Deploy to Render (done!)
2. ⏭️ Integrate with your frontend
3. ⏭️ Run performance baseline
4. ⏭️ Monitor usage and costs
5. ⏭️ Scale to Standard plan if needed

---

## Support

- **Render docs:** [render.com/docs](https://render.com/docs)
- **OpenAI status:** [status.openai.com](https://status.openai.com/)
- **Issues:** Create GitHub issue with deployment logs

---

**Last Updated:** 2025-11-03
**Status:** Production-ready
**Deployment time:** ~10 minutes
