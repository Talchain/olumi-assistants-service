# Staging Service Setup Instructions

## Step 1: Create Render Staging Service

Go to [Render Dashboard](https://dashboard.render.com/) and create a new Web Service:

### Basic Configuration
- **Name**: `olumi-assistants-staging`
- **Repository**: `Talchain/olumi-assistants-service`
- **Branch**: `release/v1.1.1-ops`
- **Auto-Deploy**: ✅ Enabled
- **Runtime**: Node (default Node 22)
- **Region**: Oregon (or nearest)
- **Instance Type**: Starter (512MB)

### Build & Start Commands
- **Build Command**: `pnpm install --frozen-lockfile && pnpm build`
- **Start Command**: `node dist/src/server.js`

### Health Check
- **Health Check Path**: `/healthz`

### Environment Variables

Set the following environment variables in the Render dashboard:

```bash
NODE_ENV=production
LLM_PROVIDER=fixtures
ENABLE_DOCUMENT_GROUNDING=true
ENABLE_CSV_GROUNDING=true
ENABLE_CRITIQUE=true
ENABLE_CLARIFIER=true
ENABLE_EVIDENCE_PACK=true
GLOBAL_RATE_LIMIT_RPM=120
SSE_RATE_LIMIT_RPM=20
BODY_LIMIT_BYTES=1048576
COST_MAX_USD=1.00
ALLOWED_ORIGINS=https://olumi.app,https://app.olumi.app,http://localhost:5173,http://localhost:3000
INFO_SAMPLE_RATE=1.0
PORT=3101
```

**Note**: No API keys needed since we're using `fixtures` provider.

## Step 2: Wait for Deployment

After creating the service:
1. Wait for initial deployment to complete (~3-5 minutes)
2. Render will provide a URL like: `https://olumi-assistants-staging.onrender.com`
3. Check the logs for "Server started" message

## Step 3: Verify Basic Health

Test the staging endpoint:

```bash
curl -s https://YOUR-STAGING-URL.onrender.com/healthz | jq .
```

**Expected Response:**
```json
{
  "ok": true,
  "service": "assistants",
  "version": "1.1.1",
  "provider": "fixtures",
  "model": "fixture-v1",
  "limits_source": "config",
  "feature_flags": {
    "grounding": true,
    "critique": true,
    "clarifier": true
  }
}
```

---

## Alternative: Using render.yaml Blueprint

You can also use the provided `render-staging.yaml` file:

1. In Render Dashboard, go to "Blueprint" → "New Blueprint Instance"
2. Select the `olumi-assistants-service` repository
3. Choose the `render-staging.yaml` file
4. Render will create the service automatically

---

## After Setup

Once the staging service is live, provide the staging URL to continue with:
- Smoke tests
- Performance validation
- Privacy/observability verification
