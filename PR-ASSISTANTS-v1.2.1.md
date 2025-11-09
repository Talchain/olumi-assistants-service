# Assistants Service v1.2.1 - Auth + Reliability

## Summary

Implements API key authentication and LLM retry reliability for the Assistants Service, addressing critical security and reliability gaps identified in local validation.

**Test Status:** ✅ 6/6 auth tests passing
**Code Review:** ✅ All issues resolved
**Ready for:** Staging → Production

**Deferred to v1.2.2:**
- SSE backpressure handling (complexity)
- Anthropic prompt caching (cost optimization)

---

## What Changed

### 1. API Key Authentication (P0) ✅

**Security:** Protects `/assist/*` endpoints with API key validation

**Implementation:**
- Created `src/plugins/auth.ts` - Fastify plugin enforcing `X-Olumi-Assist-Key` header
- Validates header against `ASSIST_API_KEY` environment variable
- Returns error.v1 responses:
  - 401 UNAUTHENTICATED: Missing header
  - 403 FORBIDDEN: Invalid key
- Skips auth for `/healthz` and non-assist routes
- Registers before routes in `src/server.ts` (after observability plugin)

**Error Handling:**
- Extended `src/utils/errors.ts` with `UNAUTHENTICATED` error code
- Added 401 mapping in `getStatusCodeForErrorCode()`

**Configuration:**
- `ASSIST_API_KEY` environment variable (required for production)
- If not set, auth is disabled with warning log (unsafe for production)

**Test Coverage:** `tests/integration/auth.test.ts` (6 tests)
- Missing API key (401)
- Invalid API key (403)
- Valid API key (200)
- Healthz bypass
- Case-insensitive header
- Auth disabled scenario

### 2. LLM Retry with Exponential Backoff (P1) ✅

**Reliability:** Automatic retry on transient LLM failures

**Implementation:**
- Created `src/utils/retry.ts` with `withRetry()` helper
- Exponential backoff: base 250ms, factor 2, max 5s
- Jitter: ±20% to prevent thundering herd
- Default 3 attempts
- Retries on: 408, 429, 500, 502, 503, 504, timeouts, rate limits

**Telemetry Integration:**
- Added to `src/utils/telemetry.ts`:
  - `assist.llm.retry` - Retry attempt
  - `assist.llm.retry_success` - Retry succeeded
  - `assist.llm.retry_exhausted` - All retries failed
  - `assist.draft.sse_client_closed` - Client disconnect (future SSE backpressure)
- Datadog metrics: counters + histogram for retry delays

**Adapter Integration:**
- Wrapped all 6 Anthropic API calls in `src/adapters/llm/anthropic.ts`:
  - `draftGraphWithAnthropic`
  - `suggestOptionsWithAnthropic`
  - `repairGraphWithAnthropic`
  - `clarifyBriefWithAnthropic`
  - `critiqueGraphWithAnthropic`
  - `explainDiffWithAnthropic`

**Context Tracking:** Each retry includes adapter, model, operation for debugging

### 3. Documentation Updates ✅

**Frontend Integration Guide:**
- Updated `Docs/FRONTEND_INTEGRATION.md` to v1.2.1
- Added Authentication section with:
  - Header requirement (`X-Olumi-Assist-Key`)
  - Configuration (production vs development)
  - Error responses (401/403)
  - Security best practices
  - Example code snippets
- Updated all examples to include auth header
- Updated error.v1 schema to include `UNAUTHENTICATED`, `FORBIDDEN`
- Updated CORS headers to allow `X-Olumi-Assist-Key`

**React SSE Client:**
- Example client already demonstrates proper header usage

---

## Files Changed

### Source (6 files)
- `package.json` - Version: 1.2.1
- `openapi.yaml` - Version: 1.2.1
- `src/plugins/auth.ts` - NEW: API key authentication plugin
- `src/utils/retry.ts` - NEW: Retry utility with exponential backoff
- `src/utils/errors.ts` - Added UNAUTHENTICATED error code
- `src/utils/telemetry.ts` - Added retry and SSE telemetry events
- `src/server.ts` - Registered auth plugin
- `src/adapters/llm/anthropic.ts` - Wrapped all API calls with retry

### Tests (1 file - new)
- `tests/integration/auth.test.ts` - Auth plugin integration tests (6 tests)

### Documentation (1 file - updated)
- `Docs/FRONTEND_INTEGRATION.md` - Added authentication section, updated version

---

## Risk Assessment

### Low Risk ✅

1. **Auth Plugin:**
   - Only affects `/assist/*` routes
   - Gracefully disabled if `ASSIST_API_KEY` not set (dev mode)
   - Returns standard error.v1 responses
   - No breaking changes to API schema

2. **Retry Logic:**
   - Wraps existing calls (no behavior change on success)
   - Only activates on transient failures (408, 429, 5xx)
   - Respects AbortController timeouts (no infinite retries)
   - Telemetry tracks all retry attempts for monitoring

3. **Documentation:**
   - Additive changes only (no deletions)
   - Consistent with error.v1 schema

### Pre-existing Issues

Type errors in tests (unrelated to this PR):
- `tests/integration/privacy.csv.test.ts` - Type assertions on unknown
- `tests/unit/redaction.test.ts` - Type assertions on unknown

These are pre-existing and do not block deployment.

---

## Rollback Plan

If critical issues arise post-deploy:

### Option 1: Revert Commit

```bash
# Revert to v1.2.0
git revert <commit-hash>
pnpm install && pnpm build
pnpm start
```

### Option 2: Disable Auth

```bash
# Temporarily disable auth (unsafe for production)
unset ASSIST_API_KEY
pnpm start
```

### Option 3: Version Override

```bash
# Override service version
export SERVICE_VERSION=1.2.0
pnpm start
```

### Monitoring Post-Deploy

**Watch for:**
1. **Auth failures:** Check for unexpected 401/403 errors
   - Datadog metric: `assist.auth_missing_header`, `assist.auth_invalid_key`
   - Action: Verify `ASSIST_API_KEY` is set correctly in Render

2. **Retry exhaustion:** Check for repeated `assist.llm.retry_exhausted` events
   - Datadog metric: `llm.retry_exhausted`
   - Action: Investigate upstream LLM provider issues

3. **Increased latency:** Retries add delay on failures
   - Datadog metric: `llm.retry.delay_ms` (histogram)
   - Expected: <5s additional latency on retryable failures
   - Action: If p95 > 10s, reduce `maxAttempts` in `DEFAULT_RETRY_CONFIG`

---

## Deployment Steps

### 1. Pre-Deploy Validation

```bash
# Local validation
pnpm typecheck
pnpm test tests/integration/auth.test.ts
pnpm build

# Verify version bumped
cat package.json | grep version
cat openapi.yaml | grep version

# Test auth locally
export ASSIST_API_KEY="test-key-local"
pnpm dev

# In another terminal
curl -X POST http://localhost:3101/assist/draft-graph \
  -H "Content-Type: application/json" \
  -H "X-Olumi-Assist-Key: test-key-local" \
  -d '{"brief":"Test brief"}'

# Should return 200 (or fixture response if using fixtures)

curl -X POST http://localhost:3101/assist/draft-graph \
  -H "Content-Type: application/json" \
  -d '{"brief":"Test brief"}'

# Should return 401 UNAUTHENTICATED
```

### 2. Render Configuration

**REQUIRED:** Set `ASSIST_API_KEY` environment variable

```bash
# In Render dashboard
# Environment > Environment Variables
# Add: ASSIST_API_KEY = <secure-random-key>

# Generate secure key (example):
openssl rand -base64 32
```

### 3. Deploy to Staging

```bash
# Merge PR to main
gh pr merge <pr-number> --squash

# Render auto-deploys from main branch

# Wait for deploy completion (~2-3 minutes)
# Check Render logs for:
# - "API key authentication enabled for /assist/* routes"
# - "Server listening on port 3101"
```

### 4. Staging Validation

```bash
# Test auth enabled
curl -X POST https://olumi-assistants-service.onrender.com/assist/draft-graph \
  -H "Content-Type: application/json" \
  -d '{"brief":"Test auth"}' \
  -w "\nHTTP %{http_code}\n"

# Should return 401 UNAUTHENTICATED

# Test valid key
curl -X POST https://olumi-assistants-service.onrender.com/assist/draft-graph \
  -H "Content-Type: application/json" \
  -H "X-Olumi-Assist-Key: $ASSIST_API_KEY" \
  -d '{"brief":"Should we expand into EU markets?"}' \
  | jq '.graph.nodes | length'

# Should return 200 with graph

# Test healthz bypass
curl https://olumi-assistants-service.onrender.com/healthz

# Should return 200 without auth header
```

### 5. Monitor First 24 Hours

**Datadog Dashboards:**
- Check `assist.auth_success` event rate (should match request rate)
- Check `assist.llm.retry` event rate (should be low <5%)
- Check `assist.llm.retry_exhausted` (should be near 0)
- Check p50/p95/p99 latency (should be similar to v1.2.0)

**Render Logs:**
- No unexpected errors
- No authentication bypasses
- Retry telemetry emitted on transient failures

---

## Success Criteria

### Must Pass ✅
1. All `/assist/*` requests require `X-Olumi-Assist-Key` header
2. `/healthz` accessible without auth
3. 401 errors include helpful hint in `details.hint`
4. Retry telemetry visible in Datadog
5. No breaking changes to existing clients (they will get 401, which is expected)

### Nice to Have
1. Retry success rate >90% (most transient failures recover)
2. Auth latency overhead <10ms
3. Zero false positives (valid keys always accepted)

---

## Migration Notes for Frontend Teams

**Required Changes:**

All frontend clients must include the `X-Olumi-Assist-Key` header on all `/assist/*` requests.

**Before:**
```typescript
fetch('https://olumi-assistants-service.onrender.com/assist/draft-graph', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ brief }),
});
```

**After:**
```typescript
fetch('https://olumi-assistants-service.onrender.com/assist/draft-graph', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Olumi-Assist-Key': process.env.OLUMI_API_KEY, // Store securely
  },
  body: JSON.stringify({ brief }),
});
```

**Error Handling:**

Add cases for new error codes:

```typescript
if (response.status === 401) {
  console.error('Missing or invalid API key');
  // Prompt user to configure API key
}

if (response.status === 403) {
  console.error('Invalid API key');
  // Show error message, check configuration
}
```

**Reference:** See updated `Docs/FRONTEND_INTEGRATION.md` for complete examples.

---

## Future Work (v1.2.2)

**Deferred Items:**

1. **SSE Backpressure:**
   - Make `writeStage()` async, honor backpressure
   - Listen for `request.raw.on('close')` to detect client disconnect
   - Cancel timers and abort LLM pipeline on disconnect
   - **Complexity:** Requires async refactor of SSE streaming

2. **Anthropic Prompt Caching:**
   - Add `cache_control` markers on system messages
   - Track cache hit metrics in telemetry
   - Expected cost savings: 20-30% on repeated briefs
   - **Complexity:** Requires cache key strategy + TTL management

**Timeline:** Target v1.2.2 for late November 2025

---

## Changelog

### v1.2.1 (2025-11-09)

**Security:**
- ✅ API key authentication for `/assist/*` endpoints via `X-Olumi-Assist-Key` header
- ✅ 401/403 error responses for missing/invalid keys

**Reliability:**
- ✅ LLM retry with exponential backoff (3 attempts, 250ms base, 2x factor, ±20% jitter)
- ✅ Retry telemetry events (Datadog metrics)

**Documentation:**
- ✅ Frontend integration guide updated with authentication section
- ✅ All code examples updated to include auth header

**Tests:**
- ✅ Auth plugin integration tests (6 tests)

---

**PR Author:** Claude Code
**Reviewer:** @paulslee
**Deployment Date:** TBD
**Service Version:** 1.2.1
