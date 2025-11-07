# Staging Burn-In Checklist

**Version**: v1.1.1
**Last Updated**: 2025-01-07

This checklist ensures staging environment readiness before production deployment. Complete all steps in order.

---

## Pre-Deployment Configuration

### 1. Environment Variables
Verify all required environment variables are set in staging:

```bash
# Core Service
✓ LLM_PROVIDER (openai, anthropic, or fixtures)
✓ OPENAI_API_KEY or ANTHROPIC_API_KEY
✓ PORT (default: 3101)

# Security & Rate Limiting
✓ GLOBAL_RATE_LIMIT_RPM (default: 120)
✓ SSE_RATE_LIMIT_RPM (default: 20)
✓ BODY_LIMIT_BYTES (default: 1048576)
✓ COST_MAX_USD (default: 1.0)

# CORS Configuration
✓ ALLOWED_ORIGINS (comma-separated)
  Default: https://olumi.app,https://app.olumi.app,http://localhost:5173,http://localhost:3000

# Feature Flags (v1.1.0+)
✓ ENABLE_DOCUMENT_GROUNDING (default: false)
✓ ENABLE_CSV_GROUNDING (default: false)
✓ ENABLE_CLARIFIER (default: false)
✓ ENABLE_CRITIQUE (default: false)
✓ ENABLE_EXPLAIN_DIFF (default: false)
✓ ENABLE_SUGGEST_OPTIONS (default: false)
✓ ENABLE_EVIDENCE_PACK (default: false)

# Observability (v1.1.1+)
✓ INFO_SAMPLE_RATE (default: 0.1 for 10% sampling)
✓ DATADOG_API_KEY (optional)
✓ DATADOG_HOST (optional)
```

### 2. Deployment Health
After deployment, verify basic connectivity:

```bash
# Health endpoint
curl https://staging.olumi-assistants-service.onrender.com/healthz

# Expected response:
{
  "ok": true,
  "version": "1.1.1",
  "feature_flags": { ... }
}
```

---

## Functional Testing

### 3. Core Endpoints
Test all primary endpoints with realistic inputs:

#### Draft Graph (Non-Streaming)
```bash
curl -X POST https://staging.olumi-assistants-service.onrender.com/assist/draft-graph \
  -H "Content-Type: application/json" \
  -H "X-Request-Id: test-$(uuidgen)" \
  -d '{
    "brief": "Should we migrate to microservices or maintain our monolith?"
  }'

# Verify:
✓ Status 200
✓ Response includes "graph", "rationales"
✓ Response header "X-Request-Id" matches request
✓ Graph has nodes and edges
```

#### Draft Graph (SSE Streaming)
```bash
curl -N -X POST https://staging.olumi-assistants-service.onrender.com/assist/draft-graph/stream \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{
    "brief": "Cloud vs on-premise infrastructure for sensitive data?"
  }'

# Verify:
✓ Status 200
✓ Content-Type: text/event-stream
✓ Receives multiple SSE events (stage, rationale, complete)
✓ Final event contains complete graph
```

### 4. Rate Limiting
Test rate limit enforcement:

```bash
# Send 125 requests rapidly (exceeds 120 RPM limit)
for i in {1..125}; do
  curl -X POST https://staging.olumi-assistants-service.onrender.com/assist/draft-graph \
    -H "Content-Type: application/json" \
    -d '{"brief":"test"}' &
done
wait

# Verify:
✓ Requests 1-120 succeed (200 OK)
✓ Requests 121-125 return 429 Rate Limited
✓ 429 response includes error.v1 schema
✓ 429 response includes Retry-After header
✓ 429 response includes request_id
```

### 5. CORS Validation
Test CORS allowlist enforcement:

```bash
# Allowed origin (should succeed)
curl -H "Origin: https://olumi.app" \
  -H "Access-Control-Request-Method: POST" \
  -X OPTIONS \
  https://staging.olumi-assistants-service.onrender.com/assist/draft-graph

# Verify:
✓ Status 204 No Content
✓ Headers include "Access-Control-Allow-Origin: https://olumi.app"

# Blocked origin (should fail)
curl -H "Origin: https://malicious.com" \
  -H "Access-Control-Request-Method: POST" \
  -X OPTIONS \
  https://staging.olumi-assistants-service.onrender.com/assist/draft-graph

# Verify:
✓ Status 403 Forbidden OR no CORS headers
```

### 6. Error Handling
Test error.v1 schema compliance:

```bash
# Invalid input (missing brief)
curl -X POST https://staging.olumi-assistants-service.onrender.com/assist/draft-graph \
  -H "Content-Type: application/json" \
  -d '{}'

# Verify error.v1 response:
{
  "schema": "error.v1",
  "code": "BAD_INPUT",
  "message": "Validation failed",
  "details": { ... },
  "request_id": "<uuid>"
}

# Body too large (>1MB)
dd if=/dev/zero bs=2M count=1 | \
  curl -X POST https://staging.olumi-assistants-service.onrender.com/assist/draft-graph \
    -H "Content-Type: application/json" \
    --data-binary @-

# Verify:
✓ Status 400 Bad Request
✓ error.v1 with code "BAD_INPUT"
✓ Message mentions "body too large"
```

---

## Observability Validation

### 7. Request ID Propagation
Verify request IDs flow through the system:

```bash
# Send request with custom request ID
REQ_ID=$(uuidgen)
curl -X POST https://staging.olumi-assistants-service.onrender.com/assist/draft-graph \
  -H "Content-Type: application/json" \
  -H "X-Request-Id: $REQ_ID" \
  -d '{"brief":"test"}' -i | grep -i x-request-id

# Verify:
✓ Response header "X-Request-Id" matches sent ID
✓ Response body (if error) includes request_id field

# Send request without ID (auto-generate)
curl -X POST https://staging.olumi-assistants-service.onrender.com/assist/draft-graph \
  -H "Content-Type: application/json" \
  -d '{"brief":"test"}' -i | grep -i x-request-id

# Verify:
✓ Response includes generated UUID v4 request ID
```

### 8. Logging & Sampling
Check log output for correct format and sampling:

```bash
# Check staging logs (Render dashboard or log streaming)
# Look for structured JSON logs with:
✓ "request_id" field in all log entries
✓ "duration_ms" in completion logs
✓ "cost_usd" in completion logs (when LLM used)
✓ ~10% of successful requests logged (sampling rate 0.1)
✓ 100% of error requests logged (4xx/5xx always logged)
```

### 9. Metrics (if Datadog enabled)
Verify StatsD metrics emission:

```bash
# Check Datadog metrics dashboard for:
✓ assist.draft.duration (histogram)
✓ assist.draft.completed (counter with tags: quality_tier, draft_source)
✓ assist.draft.cost_usd (histogram)
✓ Rate metrics average ~120 RPM globally
```

---

## Feature Flag Testing (v1.1.0+)

### 10. Document Grounding
If `ENABLE_DOCUMENT_GROUNDING=true`:

```bash
curl -X POST https://staging.olumi-assistants-service.onrender.com/assist/draft-graph \
  -H "Content-Type: application/json" \
  -d '{
    "brief": "Analyze this document",
    "attachments": [
      {"id": "att_0", "kind": "document", "name": "policy.txt"}
    ],
    "attachment_payloads": {
      "att_0": "VGVzdCBkb2N1bWVudCBjb250ZW50"
    }
  }'

# Verify:
✓ Status 200
✓ Response includes citations with provenance_source
✓ Rationales reference document content
```

### 11. Evidence Pack
If `ENABLE_EVIDENCE_PACK=true`:

```bash
# Generate evidence pack from draft output
pnpm ops:evidence output.json

# Verify:
✓ Privacy notice included
✓ Quotes truncated to ≤100 chars
✓ CSV row data excluded (only statistics)
✓ Document citations included
```

---

## Performance Testing

### 12. Load Test with Fixtures
Run Artillery performance test with fixtures:

```bash
# Set environment to use fixtures
export ASSISTANTS_BASE_URL=https://staging.olumi-assistants-service.onrender.com
export LLM_PROVIDER=fixtures

# Run performance test
pnpm perf:baseline

# Verify:
✓ p50 < 2000ms
✓ p95 < 8000ms
✓ Error rate < 5%
✓ All scenarios pass (baseline, health checks)
```

---

## Security Validation

### 13. PII Redaction
Verify logs never contain sensitive data:

```bash
# Send request with attachment containing PII
curl -X POST https://staging.olumi-assistants-service.onrender.com/assist/draft-graph \
  -H "Content-Type: application/json" \
  -d '{
    "brief": "Analyze customer data",
    "attachments": [{"id": "att_0", "kind": "document", "name": "customers.csv"}],
    "attachment_payloads": {"att_0": "bmFtZSxyZXZlbnVlCkFsaWNlLDEwMDAwCkJvYiwxNTAwMA=="}
  }'

# Check staging logs:
✓ Base64 content replaced with [REDACTED]:<hash>
✓ Customer names (Alice, Bob) NOT in logs
✓ Authorization headers removed from logs
```

### 14. Rate Limit Bypass Prevention
Verify rate limits cannot be bypassed:

```bash
# Attempt to bypass with different User-Agents
for i in {1..130}; do
  curl -X POST https://staging.olumi-assistants-service.onrender.com/assist/draft-graph \
    -H "User-Agent: Bot-$i" \
    -d '{"brief":"test"}' &
done

# Verify:
✓ Rate limit still enforced (429 after 120 requests)
✓ User-Agent variation does not bypass limit
```

---

## Rollback Readiness

### 15. Rollback Plan Verification
Ensure rollback capability is tested:

```bash
# Document previous stable version
PREV_VERSION=$(git describe --tags --abbrev=0)
echo "Previous stable: $PREV_VERSION"

# Verify rollback command works (don't execute in production)
git checkout $PREV_VERSION
pnpm install
pnpm build
pnpm test

# Verify:
✓ Previous version builds successfully
✓ Tests pass on previous version
✓ Rollback time estimate: < 5 minutes
```

---

## Sign-Off Checklist

Before promoting to production, confirm all items:

- [ ] All environment variables configured
- [ ] Health endpoint returns 200 OK
- [ ] Core endpoints (draft, SSE) functional
- [ ] Rate limiting enforced at 120/20 RPM
- [ ] CORS allowlist blocks unauthorized origins
- [ ] Error responses use error.v1 schema
- [ ] Request IDs propagated end-to-end
- [ ] Logging includes request_id, duration_ms, cost_usd
- [ ] Sampling rate ~10% for info logs
- [ ] Feature flags tested (if enabled)
- [ ] Performance: p95 < 8000ms
- [ ] PII redaction verified in logs
- [ ] Rate limit bypass attempts blocked
- [ ] Rollback plan verified

**Burn-in Duration**: Minimum 2 hours of monitoring after all checks pass.

**Approval Required**: Engineering Lead + SRE sign-off before production deployment.

---

**Next Steps**: If all checks pass, proceed to production deployment following [Docs/operator-runbook.md](./operator-runbook.md).
