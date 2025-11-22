# Operator Runbook - Olumi Assistants Service v1.3.0

**Service:** olumi-assistants-service
**Version:** 1.3.0
**Endpoints:** `/assist/clarify-brief`, `/assist/critique-graph`, `/assist/draft-graph` (JSON + SSE), `/assist/suggest-options`, `/assist/explain-diff`, `/assist/evidence-pack`

**New in v1.1.0:** Document grounding, feature flags, enhanced health endpoint
**New in v1.1.1:** Request ID tracking, structured errors, redaction, rate limiting, observability, evidence packs
**New in v1.3.0:** Per-key auth & quotas, Spec v04 graph guards, legacy SSE migration flag, CI coverage gates

---

## Quick Reference

| Endpoint | Method | Timeout | Max Body | Purpose |
|----------|--------|---------|----------|---------|
| `/healthz` | GET | 1s | - | Health check |
| `/assist/clarify-brief` | POST | 15s | 1 MB | Generate clarifying questions |
| `/assist/critique-graph` | POST | 15s | 1 MB | Identify graph issues |
| `/assist/draft-graph` | POST | 15s | 1 MB | Draft initial graph (JSON) |
| `/assist/draft-graph/stream` | POST | 120s | 1 MB | Draft initial graph (SSE) |
| `/assist/suggest-options` | POST | 15s | 1 MB | Generate 3-5 strategic options |
| `/assist/explain-diff` | POST | 15s | 1 MB | Explain patch rationales |
| `/assist/evidence-pack` | POST | 15s | 1 MB | Generate redacted evidence pack (flag-gated) |

---

## Authentication & Rate Limiting (v1.3.0+)

### Overview
Per-key authentication with token bucket rate limiting. If no API keys are configured, authentication is disabled (development mode).

### Configuration

#### Single API Key (Backwards Compatible)
```bash
# Single key for all clients
export ASSIST_API_KEY="your-secret-key-here"
```

#### Multiple API Keys (v1.3.0+)
```bash
# Comma-separated keys for multiple clients
export ASSIST_API_KEYS="client-1-key,client-2-key,client-3-key"
```

**Note:** `ASSIST_API_KEYS` takes precedence over `ASSIST_API_KEY` if both are set.

### Using API Keys

#### Via Custom Header
```bash
curl -X POST https://YOUR-SERVICE-URL/assist/draft-graph \
  -H 'X-Olumi-Assist-Key: your-secret-key-here' \
  -H 'Content-Type: application/json' \
  -d '{"brief": "..."}'
```

#### Via Authorization Header
```bash
curl -X POST https://YOUR-SERVICE-URL/assist/draft-graph \
  -H 'Authorization: Bearer your-secret-key-here' \
  -H 'Content-Type: application/json' \
  -d '{"brief": "..."}'
```

### Rate Limits (Per API Key)

| Endpoint Type | Limit | Window | Reasoning |
|---------------|-------|--------|-----------|
| General endpoints | 120 requests | 60 seconds | Standard throughput |
| SSE endpoints | 20 requests | 60 seconds | Long-lived connections |

**Public Routes (No Auth Required):**
- `GET /healthz`

### Rate Limit Errors

When rate limited, you'll receive a `429` response:
```json
{
  "schema": "error.v1",
  "code": "RATE_LIMITED",
  "message": "Rate limit exceeded for this API key",
  "details": {
    "retry_after_seconds": 42
  }
}
```

### Auth Telemetry Events
- `assist.auth.success` - Valid API key used
- `assist.auth.failed` - Invalid or missing API key
- `assist.auth.rate_limited` - Rate limit exceeded

**Note:** All telemetry uses hashed key IDs (SHA-256 prefix), never raw keys.

---

## Legacy SSE Migration (v1.3.0+)

### Overview
The legacy SSE path (`POST /assist/draft-graph` with `Accept: text/event-stream`) is deprecated. Use the dedicated endpoint instead.

### Configuration

```bash
# Default: Legacy SSE disabled (recommended)
# (No env var needed)

# Enable legacy SSE for backwards compatibility
export ENABLE_LEGACY_SSE=true
```

### Recommended Migration

**Old (Legacy):**
```bash
curl -X POST https://YOUR-SERVICE-URL/assist/draft-graph \
  -H 'Accept: text/event-stream' \
  -H 'Content-Type: application/json' \
  -d '{"brief": "..."}'
```

**New (Recommended):**
```bash
curl -X POST https://YOUR-SERVICE-URL/assist/draft-graph/stream \
  -H 'Content-Type: application/json' \
  -d '{"brief": "..."}'
```

### Legacy SSE Disabled (Default)

When `ENABLE_LEGACY_SSE` is false or unset, legacy SSE requests return `426 Upgrade Required`:

```json
{
  "schema": "error.v1",
  "code": "BAD_INPUT",
  "message": "Legacy SSE path disabled. Use POST /assist/draft-graph/stream instead.",
  "details": {
    "recommended_endpoint": "/assist/draft-graph/stream",
    "migration_guide": "..."
  }
}
```

### Checking Legacy SSE Status
```bash
# If legacy SSE is enabled, deprecation warnings appear in telemetry
# If disabled, you'll get 426 responses
curl -X POST https://YOUR-SERVICE-URL/assist/draft-graph \
  -H 'Accept: text/event-stream' \
  -H 'Content-Type: application/json' \
  -d '{"brief": "test"}'
```

---

## Feature Flags (v1.1.0+)

### Overview
Feature flags control optional capabilities with priority: **Per-Request > Environment > Default**

### Flags Matrix

| Flag | Env Var | Default | Purpose | Risk Level |
|------|---------|---------|---------|------------|
| `grounding` | `ENABLE_GROUNDING` | **false** | Document attachment processing | MEDIUM |
| `critique` | `ENABLE_CRITIQUE` | true | Graph critique endpoint | LOW |
| `clarifier` | `ENABLE_CLARIFIER` | true | Clarifying questions in drafts | LOW |
| `evidence_pack` | `ENABLE_EVIDENCE_PACK` | **false** | Evidence pack download route | LOW |

### Checking Current Flags
```bash
curl -s https://YOUR-SERVICE-URL/healthz | jq '.feature_flags'
```

**Expected Output:**
```json
{
  "grounding": false,
  "critique": true,
  "clarifier": true
}
```

### Enabling Grounding (Production)
**⚠️ IMPORTANT:** Grounding defaults to OFF for safety. Enable explicitly:

```bash
# In Render dashboard, add environment variable:
ENABLE_GROUNDING=true

# Restart service and verify:
curl -s https://YOUR-SERVICE-URL/healthz | jq '.feature_flags.grounding'
# Should return: true
```

### Per-Request Override
Flags can be overridden per-request via `flags` field:

```bash
# Enable grounding for this request only
curl -X POST https://YOUR-SERVICE-URL/assist/draft-graph \
  -H 'Content-Type: application/json' \
  -d '{
    "brief": "...",
    "flags": {"grounding": true}
  }'

# Disable grounding for this request (even if env enabled)
curl -X POST https://YOUR-SERVICE-URL/assist/draft-graph \
  -H 'Content-Type: application/json' \
  -d '{
    "brief": "...",
    "flags": {"grounding": false}
  }'
```

### Troubleshooting Flags

| Issue | Cause | Solution |
|-------|-------|----------|
| Attachments ignored | `ENABLE_GROUNDING=false` (default) | Set `ENABLE_GROUNDING=true` in env |
| Grounding always on | Env var set to `true` | Remove env var or set to `false` |
| Per-request flag ignored | Typo in request body | Verify `flags` field spelling |

---

## Health Check

### Command
```bash
curl -s https://YOUR-SERVICE-URL/healthz | jq .
```

### Expected Response (Good)
```json
{
  "ok": true,
  "service": "assistants",
  "version": "1.1.0",
  "provider": "fixtures",
  "model": "fixture-v1",
  "limits_source": "config",
  "feature_flags": {
    "grounding": false,
    "critique": true,
    "clarifier": true
  }
}
```

### Troubleshooting
- **No response:** Service is down, check Render logs
- **status: "degraded":** LLM provider timeout or error
- **Wrong version:** Deployment failed, check build logs

---

## Clarifier - Generate Questions

### Purpose
Given a user brief, generate 2-5 clarifying questions with:
- MCQ questions appear first (deterministic ordering)
- Stop when confidence ≥ 0.8
- Max 3 rounds (round 0, 1, 2)

### Command (Round 0)
```bash
curl -s -X POST https://YOUR-SERVICE-URL/assist/clarify-brief \
  -H 'Content-Type: application/json' \
  -d '{
    "brief": "Should I invest in renewable energy stocks for long-term growth?",
    "round": 0
  }' | jq .
```

### Expected Response (Good)
```json
{
  "questions": [
    {
      "question": "What is your investment timeline?",
      "why_we_ask": "Understanding your time horizon helps...",
      "impacts_draft": "A longer timeline allows...",
      "choices": ["1-2 years", "3-5 years", "5-10 years", "10+ years"]
    }
  ],
  "confidence": 0.3,
  "should_continue": true,
  "round": 0
}
```

### Command (Round 1 with Previous Answers)
```bash
curl -s -X POST https://YOUR-SERVICE-URL/assist/clarify-brief \
  -H 'Content-Type: application/json' \
  -d '{
    "brief": "Should I invest in renewable energy stocks?",
    "round": 1,
    "previous_answers": [
      {"question": "What is your investment timeline?", "answer": "5-10 years"}
    ]
  }' | jq .
```

### Expected Behavior
- **MCQ-first:** Questions with `choices` appear before open-ended
- **Stop rule:** If `confidence >= 0.8`, then `should_continue = false`
- **Round limit:** Rejects `round > 2` with 400 BAD_INPUT

### Error Cases

**400 BAD_INPUT - Provider Not Supported**
```json
{
  "schema": "error.v1",
  "code": "BAD_INPUT",
  "message": "not_supported",
  "details": {
    "hint": "Use LLM_PROVIDER=anthropic or fixtures"
  }
}
```
**Action:** Check `LLM_PROVIDER` env var, ensure it's `anthropic` or `fixtures`

**400 BAD_INPUT - Brief Too Short**
```json
{
  "schema": "error.v1",
  "code": "BAD_INPUT",
  "message": "String must contain at least 30 character(s)"
}
```
**Action:** Brief must be ≥30 chars

**400 BAD_INPUT - Round Out of Range**
```json
{
  "schema": "error.v1",
  "code": "BAD_INPUT",
  "message": "Number must be less than or equal to 2"
}
```
**Action:** Use `round` in range [0, 2]

---

## Critique - Identify Graph Issues

### Purpose
Analyze a PLoT graph and return issues sorted by severity:
1. BLOCKER (critical structural issues)
2. IMPROVEMENT (optimization suggestions)
3. OBSERVATION (minor notes)

### Command
```bash
curl -s -X POST https://YOUR-SERVICE-URL/assist/critique-graph \
  -H 'Content-Type: application/json' \
  -d '{
    "graph": {
      "version": "1",
      "default_seed": 42,
      "nodes": [
        {"id": "goal_1", "kind": "goal", "label": "Increase revenue"},
        {"id": "dec_1", "kind": "decision", "label": "Pricing strategy"}
      ],
      "edges": [
        {"from": "goal_1", "to": "dec_1"}
      ]
    }
  }' | jq .
```

### Expected Response (Good)
```json
{
  "issues": [
    {
      "level": "BLOCKER",
      "note": "Decision 'dec_1' has no outgoing edges (no options)"
    },
    {
      "level": "IMPROVEMENT",
      "note": "Consider adding more specific metrics to goal"
    }
  ],
  "suggested_fixes": [
    "Add at least 2 options as children of decision nodes"
  ],
  "overall_quality": "fair"
}
```

### Expected Behavior
- **Deterministic ordering:** BLOCKER → IMPROVEMENT → OBSERVATION → alphabetical by note
- **Non-mutating:** Response never includes modified graph
- **Focus areas:** Optional `focus_areas` filter: `["structure", "completeness", "feasibility", "provenance"]`

### Error Cases

**400 BAD_INPUT - Provider Not Supported**
```json
{
  "schema": "error.v1",
  "code": "BAD_INPUT",
  "message": "not_supported",
  "details": {
    "hint": "Use LLM_PROVIDER=anthropic or fixtures"
  }
}
```
**Action:** Check `LLM_PROVIDER` env var

**400 BAD_INPUT - Missing Graph**
```json
{
  "schema": "error.v1",
  "code": "BAD_INPUT",
  "message": "Required"
}
```
**Action:** Ensure `graph` field is present

---

## Draft Graph (JSON)

### Command
```bash
curl -s -X POST https://YOUR-SERVICE-URL/assist/draft-graph \
  -H 'Content-Type: application/json' \
  -d '{
    "brief": "Should I hire employees or use contractors for my startup?"
  }' | jq .
```

### Expected Response (Good)
```json
{
  "graph": {
    "version": "1",
    "default_seed": 42,
    "nodes": [
      {"id": "goal_1", "kind": "goal", "label": "Optimize hiring strategy"},
      {"id": "dec_1", "kind": "decision", "label": "Employment model"}
    ],
    "edges": [{"from": "goal_1", "to": "dec_1"}]
  }
}
```

---

## Draft Graph (SSE Stream)

### Command
```bash
curl -N -X POST https://YOUR-SERVICE-URL/assist/draft-graph/stream \
  -H 'Content-Type: application/json' \
  -d '{
    "brief": "Should I hire employees or use contractors?"
  }'
```

### Expected Response (Good - RFC 8895 SSE)
```
event: chunk
data: {"node": {"id": "goal_1", "kind": "goal", "label": "Optimize hiring"}}

event: chunk
data: {"edge": {"from": "goal_1", "to": "dec_1"}}

event: done
data: {}

```

### Expected Behavior
- **RFC 8895 framing:** Multi-line data with blank line terminators
- **Timeout:** 120s max (SSE_MAX_MS)
- **Parity:** Same validation guards as JSON endpoint

---

## Suggest Options - Strategic Alternatives

### Purpose
Given a goal, generate 3-5 distinct strategic options with:
- **Deterministic ordering:** Options sorted by `id` alphabetically
- **Structured output:** Each option has title, pros, cons, evidence_to_gather
- **Avoid duplicates:** Optional `existing_options` to prevent repeats

### Command
```bash
curl -s -X POST https://YOUR-SERVICE-URL/assist/suggest-options \
  -H 'Content-Type: application/json' \
  -d '{
    "goal": "Optimize hiring strategy for my startup"
  }' | jq .
```

### Expected Response (Good)
```json
{
  "options": [
    {
      "id": "opt_a",
      "title": "Full-time employees",
      "pros": ["Long-term commitment", "Team cohesion"],
      "cons": ["Higher fixed costs", "Slower to scale"],
      "evidence_to_gather": ["Average salary benchmarks", "Turnover rates"]
    },
    {
      "id": "opt_b",
      "title": "Contract workers",
      "pros": ["Flexibility", "Lower overhead"],
      "cons": ["Less loyalty", "Coordination overhead"],
      "evidence_to_gather": ["Contractor availability", "Hourly rates"]
    },
    {
      "id": "opt_c",
      "title": "Hybrid approach",
      "pros": ["Balanced risk", "Adaptable"],
      "cons": ["Complex management", "Mixed incentives"],
      "evidence_to_gather": ["Industry best practices", "Case studies"]
    }
  ]
}
```

### Expected Behavior
- **Count:** Returns 3-5 options
- **Deterministic sorting:** Options sorted by `id` alphabetically
- **Required fields:** Each option has `id`, `title`, `pros`, `cons`, `evidence_to_gather`

### Error Cases

**400 BAD_INPUT - Goal Too Short**
```json
{
  "schema": "error.v1",
  "code": "BAD_INPUT",
  "message": "String must contain at least 30 character(s)"
}
```
**Action:** Ensure `goal` is at least 30 characters

**400 BAD_INPUT - Missing Goal**
```json
{
  "schema": "error.v1",
  "code": "BAD_INPUT",
  "message": "Required"
}
```
**Action:** Ensure `goal` field is present

---

## Explain Diff - Patch Rationales

### Purpose
Given a graph patch (adds/updates/removes), explain why each change was made:
- **Rationales:** One per changed element (node/edge)
- **Concise:** Each `why` is ≤280 characters
- **Deterministic ordering:** Sorted by `target` alphabetically

### Command
```bash
curl -s -X POST https://YOUR-SERVICE-URL/assist/explain-diff \
  -H 'Content-Type: application/json' \
  -d '{
    "patch": {
      "adds": {
        "nodes": [
          {"id": "goal_1", "kind": "goal", "label": "Increase revenue"}
        ],
        "edges": []
      },
      "updates": [],
      "removes": []
    }
  }' | jq .
```

### Expected Response (Good)
```json
{
  "rationales": [
    {
      "target": "goal_1",
      "why": "Added goal to represent the primary objective of increasing revenue",
      "provenance_source": "user_brief"
    }
  ]
}
```

### Expected Behavior
- **Count:** At least 1 rationale per change
- **Deterministic sorting:** Sorted by `target` alphabetically
- **Concise:** Each `why` is ≤280 characters
- **Optional provenance:** `provenance_source` indicates where the change came from

### Error Cases

**400 BAD_INPUT - Empty Patch**
```json
{
  "schema": "error.v1",
  "code": "BAD_INPUT",
  "message": "patch has no changes to explain"
}
```
**Action:** Ensure patch has at least one add, update, or remove

**400 BAD_INPUT - Missing Patch**
```json
{
  "schema": "error.v1",
  "code": "BAD_INPUT",
  "message": "Required"
}
```
**Action:** Ensure `patch` field is present

---

## v1.1.1 Ops Hardening

### Request ID Tracking

Every request receives a unique request ID for end-to-end tracing:

**Request Header:**
```bash
curl -H "X-Request-Id: my-custom-id" https://YOUR-SERVICE-URL/assist/draft-graph
```

**Response Header:**
```
X-Request-Id: my-custom-id
```

**Auto-generation:** If no `X-Request-Id` is provided, a UUID v4 is generated automatically.

**Use Cases:**
- Correlate client requests with server logs
- Debug specific request failures
- Track request lifecycle across systems

**Example Log Query:**
```
request_id:"my-custom-id"
```

### Rate Limiting (v1.1.1)

**Global Limit:** 60 requests per minute per IP
**SSE Limit:** 10 requests per minute per IP

**Configuration:**
```bash
# Environment variables
GLOBAL_RATE_LIMIT_RPM=60  # Default
SSE_RATE_LIMIT_RPM=10     # Default
```

**Rate Limit Response:**
```json
{
  "schema": "error.v1",
  "code": "RATE_LIMITED",
  "message": "Too many requests",
  "details": {
    "retry_after_seconds": 45
  },
  "request_id": "abc-123"
}
```

**Response Headers:**
```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1704758400
Retry-After: 45
```

**Monitoring:**
- Watch for `rate_limit_hit` events in logs
- Track `X-RateLimit-Remaining` header in responses
- Alert if consistent rate limiting indicates abuse or need for limit increase

### Structured Error Responses (v1.1.1)

All errors use the `error.v1` schema with consistent structure:

**Error Codes:**
- `BAD_INPUT`: Invalid request (400)
- `RATE_LIMITED`: Too many requests (429)
- `NOT_FOUND`: Endpoint not found (404)
- `FORBIDDEN`: Not authorized (403)
- `INTERNAL`: Server error (500)

**Example Error:**
```json
{
  "schema": "error.v1",
  "code": "BAD_INPUT",
  "message": "Validation failed",
  "details": {
    "field": "brief",
    "reason": "String must contain at least 30 character(s)"
  },
  "request_id": "req_abc123"
}
```

**Privacy Guarantee:** Errors never include:
- Stack traces
- Internal file paths
- Environment variables
- PII or sensitive data

### Redaction & Privacy (v1.1.1)

**Automatic Redaction:** All logs automatically strip sensitive data via the observability plugin.

**What's Redacted:**
- Base64 attachment content → `[REDACTED]:hash_prefix`
- CSV row data → Only statistics kept
- Long quotes → Truncated to 100 characters
- Auth headers → `authorization`, `x-api-key`, `cookie`

**Verification:**
```bash
# Check logs for redaction markers
grep "\\[REDACTED\\]" /path/to/logs

# Test CSV privacy (with grounding enabled)
curl -X POST https://YOUR-SERVICE-URL/assist/draft-graph \
  -H 'Content-Type: application/json' \
  -d '{
    "brief": "Analyze sales data",
    "attachments": [
      {
        "filename": "sales.csv",
        "mime_type": "text/csv",
        "content": "bmFtZSxyZXZlbnVlCkFsaWNlLDEwMDAwCkJvYiwxNTAwMA=="
      }
    ],
    "flags": {"grounding": true}
  }' | jq .

# Verify response contains NO "Alice" or "Bob" (row data)
# Should only contain aggregated statistics
```

**See Also:** [Privacy and Data Handling Documentation](./privacy-and-data-handling.md)

### Observability (v1.1.1)

**Structured Logging:** All requests logged with context via observability plugin

**Sampling:** Info-level logs sampled at 10% (configurable via `INFO_SAMPLE_RATE`)
- Errors (4xx, 5xx): Always logged (no sampling)
- Success (2xx, 3xx): Sampled to reduce noise

**Log Format:**
```json
{
  "request_id": "abc-123",
  "method": "POST",
  "url": "/assist/draft-graph",
  "status": 200,
  "duration_ms": 3245,
  "user_agent": "curl/7.68.0",
  "redacted": true
}
```

**Configuration:**
```bash
# Adjust sampling rate
INFO_SAMPLE_RATE=0.1  # 10% (default)
INFO_SAMPLE_RATE=1.0  # 100% (verbose, only for debugging)

# Enable stack traces in logs (dev only)
LOG_STACK=1
```

### Evidence Pack Route (v1.1.1)

**Purpose:** Generate downloadable provenance pack with redacted citations and statistics

**Feature Flag:** `ENABLE_EVIDENCE_PACK=true` (default: false)

**Endpoint:** `POST /assist/evidence-pack`

**Request:**
```json
{
  "rationales": [...],
  "citations": [...],
  "csv_stats": [...]
}
```

**Response:**
```json
{
  "schema": "evidence_pack.v1",
  "generated_at": "2025-01-07T12:00:00Z",
  "service_version": "1.1.1",
  "document_citations": [
    {
      "source": "requirements.pdf",
      "location": "page 3",
      "quote": "Scalability is a top priority...",
      "provenance_source": "doc_0"
    }
  ],
  "csv_statistics": [
    {
      "filename": "sales.csv",
      "row_count": 1000,
      "column_count": 5,
      "statistics": {
        "revenue": {"count": 1000, "mean": 45000, "p95": 92000}
      }
    }
  ],
  "rationales_with_provenance": [...],
  "privacy_notice": "This evidence pack contains only..."
}
```

**Privacy:** Never includes raw file contents, CSV rows, or PII

### Burn-In Checklist (v1.1.1)

Before promoting to production, verify all ops hardening features:

**1. Health Check**
```bash
curl -s https://YOUR-SERVICE-URL/healthz | jq .
# ✓ version: "1.1.1"
# ✓ feature_flags present
# ✓ provider and model shown
```

**2. Request ID Tracking**
```bash
curl -i -H "X-Request-Id: test-123" https://YOUR-SERVICE-URL/healthz
# ✓ Response header: X-Request-Id: test-123
```

**3. Rate Limiting**
```bash
for i in {1..70}; do curl -s https://YOUR-SERVICE-URL/healthz > /dev/null; done
# ✓ Should receive 429 RATE_LIMITED after 60 requests
# ✓ Response includes Retry-After header
```

**4. Structured Errors**
```bash
curl -X POST https://YOUR-SERVICE-URL/assist/draft-graph \
  -H 'Content-Type: application/json' \
  -d '{"brief": "too short"}' | jq .
# ✓ Response has schema: "error.v1"
# ✓ Response has code: "BAD_INPUT"
# ✓ Response has request_id
# ✓ No stack trace exposed
```

**5. Redaction Verification**
```bash
# Upload CSV with PII
curl -X POST https://YOUR-SERVICE-URL/assist/draft-graph \
  -H 'Content-Type: application/json' \
  -d '{
    "brief": "Analyze sales",
    "attachments": [{
      "filename": "data.csv",
      "mime_type": "text/csv",
      "content": "bmFtZSxyZXZlbnVlCkFsaWNlLDEwMDAwCkJvYiwxNTAwMA=="
    }],
    "flags": {"grounding": true}
  }' | jq . | grep -i "alice"
# ✓ Should return NO matches (PII redacted)
```

**6. CORS Allowlist**
```bash
curl -H "Origin: https://evil.com" https://YOUR-SERVICE-URL/healthz -i
# ✓ No Access-Control-Allow-Origin header (blocked)

curl -H "Origin: https://olumi.app" https://YOUR-SERVICE-URL/healthz -i
# ✓ Access-Control-Allow-Origin: https://olumi.app (allowed)
```

**7. Evidence Pack (if enabled)**
```bash
# Set ENABLE_EVIDENCE_PACK=true first
curl -X POST https://YOUR-SERVICE-URL/assist/evidence-pack \
  -H 'Content-Type: application/json' \
  -d '{"citations": [], "rationales": []}' | jq .
# ✓ Response has schema: "evidence_pack.v1"
# ✓ Response includes privacy_notice
```

**8. Observability Logs**
```bash
# Check Render logs for structured format
# ✓ Logs include request_id
# ✓ Logs include duration_ms
# ✓ Logs show redacted: true
# ✓ No base64 content in logs
```

**9. Performance (Artillery)**
```bash
cd tests/perf
artillery run draft.yml
# ✓ p95 ≤ 8000ms
# ✓ Error rate ≤ 5%
```

**10. Engine Validation (if engine available)**
```bash
ENGINE_BASE_URL=http://engine-url tsx scripts/validate-with-engine.ts
# ✓ Success rate ≥ 90%
# ✓ Report generated in Docs/engine-handovers/
```

---

## Rollback Procedures

### Quick Rollback (Render Dashboard)
1. Go to [Render Dashboard](https://dashboard.render.com/)
2. Select `olumi-assistants-service`
3. **Events** tab → Find last good deployment
4. Click **"Redeploy"**

### Git Revert (If Merged to Main)
```bash
cd /path/to/olumi-assistants-service
git checkout main
git pull
git revert <merge-commit-sha>
git push origin main
```

Render will auto-deploy the reverted commit.

### Emergency Pause
```bash
# In Render Dashboard
Settings → Auto-Deploy → OFF
```

---

## Monitoring & Alerts

### Key Metrics to Monitor
- **Health check failures:** More than 2 consecutive failures
- **Response time p95:** Target <8s for draft, <5s for clarify/critique
- **Error rate:** >5% 5xx responses
- **Cost per call:** Target <$0.01 per draft, <$0.003 per clarify/critique

### Log Queries (Render Dashboard)

**Find 5xx errors:**
```
"statusCode":5
```

**Find capability errors:**
```
"not_supported"
```

**Find high-cost calls:**
```
"cost_usd" AND NOT "0.00"
```

---

## Common Issues & Solutions

### Issue: All Requests Return 400 BAD_INPUT with "not_supported"
**Cause:** LLM_PROVIDER is not `anthropic` or `fixtures`
**Solution:** Update env var `LLM_PROVIDER=fixtures` (safe default) or `LLM_PROVIDER=anthropic`

### Issue: Service Returns 503 Temporarily Unavailable
**Cause:** Cold start (Render free/starter tier)
**Solution:** Wait 10-20s for service to warm up, then retry

### Issue: High Costs
**Cause:** Using Anthropic without proper limits
**Solution:** Check `COST_MAX_USD=1.00` is set, monitor logs for `cost_usd` telemetry

### Issue: Slow Response Times (>10s)
**Cause:** LLM provider latency
**Solution:** Check provider status, consider increasing `ASSISTANTS_TIMEOUT_MS` or switching to fixtures for testing

---

## Contact & Escalation

- **Service logs:** Render Dashboard → olumi-assistants-service → Logs
- **Health status:** `GET /healthz`
- **Emergency:** Suspend service via Render Dashboard

---

**Last Updated:** 2025-01-07
**Version:** 1.1.1
