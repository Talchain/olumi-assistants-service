# Assistants Service v1.1.0 - Workstream Status

**Status:** ✅ **SHIP-READY**
**Version:** 1.1.0 (grounding + feature flags)
**Tests:** 345/345 passing (100%)
**Date:** 2025-01-06

## Release Readiness

| Check | Status | Notes |
|-------|--------|-------|
| **Tests** | ✅ PASS | 345/345 (100%), added 39 new tests |
| **OpenAPI** | ✅ VALID | Spec validated, types regenerated |
| **Feature Flags** | ✅ SAFE | Grounding defaults OFF (opt-in) |
| **Engine Impact** | ✅ ZERO | No engine repo changes needed |
| **Documentation** | ✅ COMPLETE | PR, changelog, runbook, smoke tests |
| **Rollback Plan** | ✅ READY | Flag-based, <5min revert |

## What's New in v1.1.0

### Document Grounding System
- **PDF** text extraction with page markers
- **CSV** safe summarization (NO row data leakage - privacy guaranteed)
- **TXT/MD** line-numbered extraction
- **Per-file limit:** 5,000 characters
- **Aggregate limit:** 50,000 characters across all files
- **Citations:** Structured provenance with source, quote, location

### Feature Flag System
- `ENABLE_GROUNDING` (default: **false** for safety)
- `ENABLE_CRITIQUE` (default: true)
- `ENABLE_CLARIFIER` (default: true)
- Per-request overrides via `flags` field
- Priority: Request > Environment > Default

### Enhanced Health Endpoint
- `/healthz` now exposes current feature flag states
- Ops can verify flags without env access
- Returns: version, provider, model, limits_source, feature_flags

### New Endpoint
- `POST /assist/explain-diff` - Generate rationales for graph patches

## Deployment Strategy

### Phase 1: Deploy with Grounding OFF (Immediate)
```bash
# No env changes needed - grounding defaults to false
# Monitor for 24h to establish baseline
```

### Phase 2: Enable Grounding (After Verification)
```bash
# In Render dashboard, add:
ENABLE_GROUNDING=true

# Monitor attachment processing, latency, CSV privacy
```

## Safety Mechanisms

1. **Conservative Defaults:** Grounding disabled by default
2. **Character Limits:** 5k/file, 50k aggregate (DoS protection)
3. **CSV Privacy:** Only statistics (count/mean/p50/p90), never row data
4. **Base64 Validation:** Payloads validated before processing
5. **Redacted Logging:** No file content in logs
6. **Feature Flags:** Can disable per-request or globally

## Smoke Tests

**Command:** `bash scripts/smoke-fixtures.sh`

**Grounding OFF (default):**
```bash
bash scripts/smoke-fixtures.sh
# Tests: health, clarifier, critique, draft, SSE, suggest-options, explain-diff
# Attachments: Silently ignored
```

**Grounding ON:**
```bash
ENABLE_GROUNDING=true bash scripts/smoke-fixtures.sh true
# Tests: All above + TXT attachment, per-file limit, CSV privacy
```

## Zero Engine Impact

**Confirmed:**
- ✅ No changes to plot-lite-service repository
- ✅ Grounding is purely assistants-service functionality
- ✅ Engine receives same graph format (nodes/edges)
- ✅ No new engine contracts or dependencies
- ✅ Independent deployment paths maintained

## Links

- **PR Description:** `Docs/engine-handovers/PR-ASSISTANTS-v1.1.0-grounding.md`
- **Changelog:** `CHANGELOG.md` (v1.1.0 section)
- **Operator Runbook:** `Docs/operator-runbook.md` (feature flags matrix)
- **Render Deploy:** `Docs/render-deploy.md` (grounding enable instructions)
- **Smoke Tests:** `scripts/smoke-fixtures.sh`

---

**Next Action:** Push `release/v1.1.0-grounding` → `main`, deploy to Render, monitor with grounding OFF, then enable after 24h verification.
