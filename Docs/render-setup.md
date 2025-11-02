# Render Deployment Setup

**Purpose:** Deploy olumi-assistants-service to Render (staging + production)
**Time:** ~15 minutes
**Prerequisites:** Render account with PLoT engine already deployed

---

## Quick Start

1. **Push `feat/fastify-5-upgrade` branch to GitHub**
   ```bash
   git push origin feat/fastify-5-upgrade
   ```

2. **Create Render services from `render.yaml`**
   - Go to [Render Dashboard](https://dashboard.render.com/)
   - Click **"New +"** → **"Blueprint"**
   - Connect your GitHub repo: `olumi-assistants-service`
   - Select branch: `feat/fastify-5-upgrade`
   - Render will detect `render.yaml` and create 2 services:
     - `olumi-assistants-service-staging`
     - `olumi-assistants-service-prod`

3. **Set environment variables** (see below)

4. **Deploy staging** → Run Artillery baseline → Validate p95 ≤ 8s

---

## Environment Variables

### Required for Both Staging & Production

| Variable | Where to Get | Example | Notes |
|----------|--------------|---------|-------|
| `ANTHROPIC_API_KEY` | [Anthropic Console](https://console.anthropic.com/) | `sk-ant-api03-...` | **Required** - Service won't start without this |
| `ENGINE_BASE_URL` | Render dashboard | `https://plot-engine-staging.onrender.com` | URL of your PLoT engine deployment |
| `ALLOWED_ORIGINS` | Your frontend URLs | Staging: `*` (permissive)<br>Prod: `https://app.olumi.ai` | Comma-separated origins for CORS |

### Optional (Datadog Telemetry)

| Variable | Where to Get | Example | Notes |
|----------|--------------|---------|-------|
| `DD_AGENT_HOST` | Datadog dashboard | `datadog-agent.onrender.com` | Only if using Datadog agent |
| `DD_API_KEY` | [Datadog API Keys](https://app.datadoghq.com/organization-settings/api-keys) | `1234567890abcdef...` | For direct API submission |

### Auto-Set by render.yaml

These are configured automatically:
- `NODE_ENV`: staging / production
- `PORT`: 3101
- `BODY_LIMIT_BYTES`: 1048576 (1 MB)
- `DD_SERVICE`: olumi-assistants-service-staging / olumi-assistants-service
- `DD_ENV`: staging / production

---

## Step-by-Step Setup

### 1. Create Staging Service

**In Render Dashboard:**

1. Click **"New +"** → **"Blueprint"**
2. Connect GitHub repo: `olumi-assistants-service`
3. Select branch: `feat/fastify-5-upgrade`
4. Render detects `render.yaml` → Shows 2 services
5. Click **"Apply"**

**Wait for build** (3-5 minutes):
- Render runs: `pnpm install && pnpm build`
- Then starts: `pnpm start`

**Expected error on first deploy:**
```
Error: ANTHROPIC_API_KEY environment variable is required but not set
```

This is normal - we'll fix it next.

---

### 2. Set Staging Environment Variables

**In staging service dashboard:**

1. Click `olumi-assistants-service-staging` → **"Environment"** tab
2. Add these variables:

   | Key | Value | How to Get |
   |-----|-------|------------|
   | `ANTHROPIC_API_KEY` | `sk-ant-api03-...` | Copy from [Anthropic Console](https://console.anthropic.com/settings/keys) |
   | `ENGINE_BASE_URL` | `https://plot-engine-staging.onrender.com` | From your PLoT engine staging service URL |
   | `ALLOWED_ORIGINS` | `*` | Permissive for testing (restrict in prod) |

3. Click **"Save Changes"**

Render will automatically redeploy with new environment variables.

---

### 3. Verify Staging Deployment

**Check service health:**

1. **In Render dashboard**, staging service should show **"Live"** status
2. **Check logs** for startup message:
   ```json
   {"level":30,"msg":"Server listening at http://0.0.0.0:3101"}
   ```

3. **Test endpoint** (copy staging URL from Render):
   ```bash
   curl -X POST https://olumi-assistants-service-staging.onrender.com/assist/draft-graph \
     -H "Content-Type: application/json" \
     -d '{"brief":"Should we hire or contract?"}'
   ```

   Expected response (200 OK):
   ```json
   {
     "graph": { "nodes": [...], "edges": [...] },
     "confidence": 0.85,
     "rationales": [...]
   }
   ```

---

### 4. Run Artillery Baseline (M2 Performance Validation)

**On your local machine:**

```bash
# Update Artillery config to point to staging
sed -i '' 's|http://localhost:3101|https://olumi-assistants-service-staging.onrender.com|' tests/perf/baseline.yml

# Run 5-minute baseline test
artillery run tests/perf/baseline.yml --output tests/perf/baseline-results.json

# Generate HTML report
artillery report tests/perf/baseline-results.json --output tests/perf/baseline-report.html

# Open report
open tests/perf/baseline-report.html
```

**Validate metrics:**
- ✅ **p95 latency ≤ 8s** (requirement)
- ✅ Error rate = 0%
- ✅ Throughput ≥ 1 req/sec

**Update performance report:**
```bash
# Edit Docs/baseline-performance-report.md with actual results
# Commit updated report
git add tests/perf/ Docs/baseline-performance-report.md
git commit -m "docs: add staging performance baseline results (M2)"
```

---

### 5. Set Up Production Service

**Only after staging validation passes:**

1. In Render dashboard, click `olumi-assistants-service-prod`
2. Add environment variables (same as staging, but production values):

   | Key | Value |
   |-----|-------|
   | `ANTHROPIC_API_KEY` | Same production key |
   | `ENGINE_BASE_URL` | `https://plot-engine.onrender.com` (prod) |
   | `ALLOWED_ORIGINS` | `https://app.olumi.ai,https://www.olumi.ai` |

3. **Do NOT auto-deploy yet** - wait for M3-M5 completion

---

## Troubleshooting

### Service Won't Start

**Error:** `ANTHROPIC_API_KEY environment variable is required`

**Fix:**
1. Go to service → Environment tab
2. Add `ANTHROPIC_API_KEY` with value from Anthropic Console
3. Save → Render will redeploy

---

### 500 Errors on All Requests

**Check logs for:**
```
Error: ENGINE_BASE_URL environment variable is required
```

**Fix:**
1. Add `ENGINE_BASE_URL` environment variable
2. Point to your PLoT engine URL (e.g., `https://plot-engine-staging.onrender.com`)

---

### CORS Errors in Frontend

**Error in browser console:**
```
Access to fetch at '...' from origin '...' has been blocked by CORS policy
```

**Fix:**
1. Add your frontend origin to `ALLOWED_ORIGINS`
2. Example: `ALLOWED_ORIGINS=https://app.olumi.ai,https://localhost:3000`
3. Save → Render will redeploy

---

### Artillery Test Timing Out

**Possible causes:**
1. **Cold start:** First request after deploy may take 10-15s
   - Solution: Run a warm-up request before Artillery test
   ```bash
   curl https://olumi-assistants-service-staging.onrender.com/assist/draft-graph \
     -X POST -H "Content-Type: application/json" \
     -d '{"brief":"test"}'
   ```

2. **Rate limiting:** Artillery default is 1 req/sec, within limits
   - Check logs for `RATE_LIMITED` errors

3. **Anthropic API slow:** LLM calls can take 2-8s
   - This is expected; p95 should still be ≤8s

---

## Service Configuration Summary

### Staging
- **URL:** `https://olumi-assistants-service-staging.onrender.com`
- **Plan:** Starter ($7/month)
- **Region:** Oregon
- **Auto-deploy:** Yes (on push to `feat/fastify-5-upgrade`)
- **Purpose:** Artillery testing, M2-M5 validation

### Production
- **URL:** `https://olumi-assistants-service.onrender.com` (or custom domain)
- **Plan:** Standard ($25/month for better performance)
- **Region:** Oregon
- **Auto-deploy:** No (manual promotion from staging)
- **Purpose:** Live traffic after ship gates pass

---

## Next Steps After Staging Deployment

1. ✅ Run Artillery baseline → Validate p95 ≤ 8s
2. ✅ Update `Docs/baseline-performance-report.md` with results
3. ✅ Close PERF-001 if performance acceptable
4. → Proceed to M3: Datadog telemetry implementation
5. → M4: Fix 3 skipped tests with fixtures
6. → M5: Add 4 golden briefs + stability checks
7. → Final ship gate validation
8. → Promote to production

---

## Datadog Integration (M3)

After M2 performance validation, wire Datadog telemetry:

**Option 1: Datadog Agent (Recommended)**
1. Deploy Datadog agent as separate Render service
2. Set `DD_AGENT_HOST` to agent URL
3. Service sends StatsD metrics to agent

**Option 2: Direct API (Simpler)**
1. Set `DD_API_KEY` environment variable
2. Service sends metrics directly to Datadog API
3. No agent needed

See `Docs/telemetry-aggregation-strategy.md` for implementation details.

---

## Cost Estimates

### Render Hosting
- **Staging (Starter):** $7/month
- **Production (Standard):** $25/month
- **Total:** $32/month

### Anthropic API (based on usage)
- **Baseline test (300 calls):** ~$0.30
- **Production (1000 calls/day):** ~$30-60/month
  - Depends on brief complexity and caching effectiveness

### Datadog (optional)
- **Free tier:** 5 hosts, 1-day retention
- **Pro tier:** $15/host/month if you need more

---

**Last Updated:** 2025-11-02
**Next Review:** After M2 baseline validation
