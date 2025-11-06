# PR: Assistants Service v1.1.0 - Document Grounding & Feature Flags

## Summary
Release v1.1.0 adds **document grounding** capabilities (PDF, CSV, TXT, MD) with privacy-first processing, aggregate size limits, and a comprehensive feature flag system for safe production rollout.

**Key Achievement:** Zero engine repository impact - grounding is purely assistants-service functionality.

## Version
- **Previous:** v1.0.1 (clarifier + critique with SSE parity)
- **Current:** v1.1.0 (adds grounding + feature flags)
- **Tests:** 345/345 passing (100%)
- **OpenAPI:** Valid, types regenerated

## Features Shipped

### 1. Document Grounding System
**Files:**
- `src/grounding/index.ts` - Core text extraction (PDF/CSV/TXT/MD)
- `src/grounding/process-attachments.ts` - Attachment orchestration with limits
- `src/schemas/assist.ts` - Schema support for `attachments` + `attachment_payloads`

**Capabilities:**
- **PDF:** Text extraction with page markers `[PAGE N]`
- **TXT/MD:** Line-numbered extraction `N: content`
- **CSV:** Safe summarization (count/mean/p50/p90 only - NO row data leakage)
- **Citations:** Structured provenance with source, quote (≤100 chars), location

**Limits:**
- Per-file: 5,000 characters maximum
- Aggregate: 50,000 characters maximum across all files
- Over-limit returns 400 BAD_INPUT with actionable hints

**Privacy:**
- All logs marked `redacted: true` (no file content logged)
- CSV processing never exposes row data or headers
- Base64 payloads validated and sanitized before processing

### 2. Feature Flag System
**File:** `src/utils/feature-flags.ts`

**Flags:**
- `ENABLE_GROUNDING` - Document grounding (default: **false** for safety)
- `ENABLE_CRITIQUE` - Graph critique endpoint (default: true)
- `ENABLE_CLARIFIER` - Clarifying questions (default: true)

**Priority:**
1. Per-request flag (via `flags` field in request body)
2. Environment variable
3. Default value

**Example:**
```bash
# Opt-in via environment
ENABLE_GROUNDING=true pnpm start

# Or per-request
curl -X POST /assist/draft-graph \
  -d '{"brief": "...", "flags": {"grounding": true}}'
```

### 3. Health Endpoint Enhancement
**File:** `src/server.ts`

`GET /healthz` now includes:
```json
{
  "ok": true,
  "service": "assistants",
  "version": "1.1.0",
  "provider": "anthropic",
  "model": "claude-3-5-sonnet-20241022",
  "limits_source": "engine",
  "feature_flags": {
    "grounding": false,
    "critique": true,
    "clarifier": true
  }
}
```

**Use Case:** Ops can verify feature flag states without needing env access.

### 4. New Endpoint: Explain Diff
**File:** `src/routes/assist.explain-diff.ts`

`POST /assist/explain-diff` generates rationales for graph patch changes.

**Input:**
```json
{
  "patch": {
    "adds": { "nodes": [...], "edges": [...] },
    "updates": [...],
    "removes": [...]
  },
  "brief": "Optional context",
  "graph_summary": { "node_count": 8, "edge_count": 10 }
}
```

**Output:**
```json
{
  "rationales": [
    {
      "target": "edge_1",
      "why": "Market analysis shows 15% annual growth",
      "provenance_source": "document"
    }
  ]
}
```

## Route Changes

### Draft Graph (`/assist/draft-graph`)
**New Fields:**
- `attachments` - Array of `{ id, kind: "pdf"|"csv"|"txt"|"md", name }`
- `attachment_payloads` - Record<string, base64-encoded content>
- `flags` - Per-request feature flag overrides

**Behavior:**
- If `ENABLE_GROUNDING=false` (default), attachments are silently ignored
- If enabled, processes attachments and includes provenance in rationales
- Emits `grounding` telemetry stats when files processed

### Critique Graph (`/assist/critique-graph`)
**New Field:**
- `flags` - Per-request feature flag overrides

**Behavior:**
- Can now receive document context via `attachments` + `attachment_payloads`
- Critique becomes document-aware when grounding enabled

## Schema Changes

### OpenAPI Updates
**File:** `openapi.yaml`

**Added:**
- `/assist/suggest-options` endpoint documentation
- `/assist/explain-diff` endpoint documentation
- Enhanced `/healthz` schema with `feature_flags` field
- Detailed `attachments` and `attachment_payloads` documentation
- Feature flags behavior and priority order

**Validation:** ✅ `swagger-cli validate` passes

## Test Coverage

### New Tests
- `tests/unit/feature-flags.test.ts` - 14 tests for flag system
- `tests/integration/grounding.attachments.test.ts` - 18 tests for attachment processing
- `tests/integration/healthz.test.ts` - 7 tests for health endpoint
- `tests/unit/grounding.pdf.test.ts` - PDF extraction
- `tests/unit/grounding.csv.test.ts` - CSV summarization + privacy
- `tests/unit/grounding.txtmd.test.ts` - Text/Markdown extraction
- `tests/unit/grounding.citations.test.ts` - Citation helpers

**Total:** 345 tests passing (was 306 in v1.0.1, added 39 new tests)

### Critical Test Cases
- ✅ CSV privacy: No row data in output
- ✅ Per-file limits: 6k chars rejected with filename
- ✅ Aggregate limits: 52k chars rejected with clear message
- ✅ Invalid base64: Rejected before processing
- ✅ Feature flags: Env > Default, Request > Env > Default
- ✅ Health endpoint: Exposes all flags correctly

## Risks & Mitigation

### HIGH RISKS (Mitigated)
| Risk | Mitigation | Status |
|------|------------|--------|
| **CSV data leakage** | Only return safe statistics, 18 tests verify privacy | ✅ SAFE |
| **Large file DoS** | 5k/file, 50k aggregate limits enforced | ✅ SAFE |
| **Breaking changes** | Grounding defaults OFF, backwards compatible | ✅ SAFE |

### MEDIUM RISKS (Monitored)
| Risk | Mitigation | Monitoring |
|------|------------|------------|
| **Latency increase** | Limits keep processing fast | p95 < 15s target |
| **LLM cost increase** | More input tokens with documents | Track cost/request |
| **Base64 encoding errors** | Validation before processing | Error rate < 1% |

### LOW RISKS (Accepted)
| Risk | Impact | Acceptance |
|------|--------|------------|
| **Feature flag confusion** | Users may not know how to enable | Document clearly |
| **Empty attachments** | Silently skipped | Acceptable UX |

## Rollback Plan

### Immediate Rollback (< 5 minutes)
```bash
# Option 1: Disable grounding via env (recommended)
# In Render dashboard, set:
ENABLE_GROUNDING=false

# Option 2: Revert to v1.0.1
git checkout release/v1.0.1-ops
# Re-deploy via Render dashboard
```

### Partial Rollback
```bash
# Disable only for specific requests
curl -X POST /assist/draft-graph \
  -d '{"brief": "...", "flags": {"grounding": false}}'
```

## Deployment Checklist

### Pre-Deployment
- [x] All tests passing (345/345)
- [x] OpenAPI spec validated
- [x] TypeScript types regenerated
- [x] Feature flags default to conservative values
- [x] Documentation complete
- [x] Smoke tests written

### Deployment Steps
1. **Create PR:** `release/v1.1.0-grounding` → `main`
2. **Review:** Ensure all checks pass (tests, lint, typecheck)
3. **Merge:** Squash and merge to `main`
4. **Deploy:** Render auto-deploys from `main`
5. **Verify:** Run smoke tests against production
6. **Monitor:** Watch error rates, latency, feature flag states

### Post-Deployment
- [ ] Health check shows `version: "1.1.0"`
- [ ] Feature flags correct in `/healthz` response
- [ ] Smoke tests pass with grounding OFF (default)
- [ ] Smoke tests pass with grounding ON (`ENABLE_GROUNDING=true`)
- [ ] No increase in error rates
- [ ] Latency within targets (p95 < 15s with attachments)

### Enable Grounding (After Verification)
```bash
# In Render dashboard, add environment variable:
ENABLE_GROUNDING=true

# Restart service
# Monitor for 1 hour before announcing to users
```

## Smoke Tests

See `scripts/smoke-fixtures.sh` for full test suite.

**Quick Checks:**
```bash
# Health check
curl https://your-service.onrender.com/healthz | jq '.feature_flags'

# Draft without attachments (should work regardless of flag)
curl -X POST https://your-service.onrender.com/assist/draft-graph \
  -H 'Content-Type: application/json' \
  -d '{"brief": "Should we expand to international markets or focus on domestic growth?"}'

# Draft with attachments (only works if ENABLE_GROUNDING=true)
curl -X POST https://your-service.onrender.com/assist/draft-graph \
  -H 'Content-Type: application/json' \
  -d '{
    "brief": "Analyze the attached document and create a decision framework",
    "attachments": [{"id":"test","kind":"txt","name":"test.txt"}],
    "attachment_payloads": {"test":"SGVsbG8gV29ybGQ="}
  }'
```

## Environment Variables

### Required
| Variable | Value | Notes |
|----------|-------|-------|
| `NODE_ENV` | `production` | Production mode |
| `LLM_PROVIDER` | `anthropic` or `openai` | LLM backend |
| `ANTHROPIC_API_KEY` | `sk-ant-...` | If using Anthropic |
| `OPENAI_API_KEY` | `sk-...` | If using OpenAI |

### Optional (with defaults)
| Variable | Default | Notes |
|----------|---------|-------|
| `ENABLE_GROUNDING` | `false` | **Conservative default for safety** |
| `ENABLE_CRITIQUE` | `true` | Critique endpoint enabled |
| `ENABLE_CLARIFIER` | `true` | Clarifying questions enabled |
| `ENGINE_BASE_URL` | (none) | PLoT engine URL for limits |
| `PORT` | `3101` | Service port |
| `ALLOWED_ORIGINS` | `*` | CORS origins |

## Breaking Changes
**None.** This release is fully backwards compatible:
- Grounding defaults OFF (opt-in)
- Existing endpoints unchanged
- No schema changes that affect existing clients
- Feature flags additive only

## Dependencies
**No new external services required.**
- Grounding is self-contained within assistants service
- No engine changes needed
- No database or storage required (in-memory processing)

## Acceptance Criteria

### Functional
- [x] Draft graph accepts attachments when grounding enabled
- [x] Draft graph ignores attachments when grounding disabled
- [x] Critique graph accepts attachments when grounding enabled
- [x] Explain-diff endpoint generates rationales
- [x] Health endpoint exposes feature flags
- [x] Feature flags respect priority order

### Non-Functional
- [x] All tests pass (345/345)
- [x] OpenAPI spec valid
- [x] No CSV row data leakage
- [x] Per-file and aggregate limits enforced
- [x] Error messages include filename context
- [x] Logs redacted (no file content)

### Operational
- [x] Rollback plan documented
- [x] Smoke tests complete
- [x] Monitoring strategy defined
- [x] Environment variables documented

## Related Documentation
- `Docs/operator-runbook.md` - Updated with feature flags matrix
- `Docs/render-deploy.md` - Updated with grounding enable instructions
- `openapi.yaml` - Updated with new endpoints and schemas
- `CHANGELOG.md` - v1.1.0 entry added

## Workstream Impact
- **Assistants Service:** ✅ Ship-ready (this PR)
- **PLoT Engine:** ✅ No impact (zero engine changes)
- **UI/Frontend:** ⏳ Awaiting assistants v1.1.0 deploy to build grounding UI

## Metrics to Monitor
- **Error Rates:** Attachment processing failures
- **Latency:** p95 with/without attachments
- **Usage:** % of requests using grounding
- **Cost:** LLM tokens per request (expect 10-20% increase with attachments)
- **Privacy:** CSV row data leaks (must remain 0%)

## Post-Launch Tasks
1. Monitor metrics for 24 hours with grounding OFF (default)
2. Enable grounding in production (`ENABLE_GROUNDING=true`)
3. Monitor for another 24 hours
4. Collect user feedback on provenance quality
5. Consider raising character limits if usage is safe
6. Plan v1.2: Add DOCX/XLSX support

---

**Ready to Ship:** ✅ All tests passing, documentation complete, rollback plan ready.

**Recommendation:** Deploy to production with `ENABLE_GROUNDING=false`, monitor for 24h, then enable grounding and monitor for another 24h before announcing feature.
