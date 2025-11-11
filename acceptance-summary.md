# v1.3.1 Production Verification — Acceptance Summary

## Release Information
- **Tag**: v1.3.1
- **Release**: https://github.com/Talchain/olumi-assistants-service/releases/tag/v1.3.1
- **Commit**: 66838f8 (feat(v04): Production-Grade Resilience)
- **Deployed**: https://olumi-assistants-service.onrender.com

## Verification Results

### Production Deployment ✅
```json
{
  "ok": true,
  "version": "1.3.1",
  "feature_flags": {
    "grounding": true,
    "critique": true,
    "clarifier": true
  }
}
```

### Performance Gate ✅ PASS
**Run**: https://github.com/Talchain/olumi-assistants-service/actions/runs/19273385983

| Metric | p95 (ms) | Threshold | Status |
|---|---|---|---|
| **/healthz (gating)** | **407.5** | < 8000 | ✅ PASS |
| /assist/draft-graph (observe) | 179.5 | - | ℹ️ INFO |
| Overall | 450.4 | - | - |

### Smoke Tests ⚠️ PARTIAL
**Run**: https://github.com/Talchain/olumi-assistants-service/actions/runs/19273383002

| Check | Result | Evidence |
|---|---|---|
| A1 | ✅ PASS | /healthz 200, version 1.3.1 |
| A2 | ✅ PASS | 401/403 unauth for /assist/draft-graph |
| A3 | ⚠️ DEGRADED | 500 upstream timeout |
| A4 | ⏸️ SKIPPED | A3 prerequisite failed |
| A5 | ⏸️ SKIPPED | A3 prerequisite failed |

**Known Issue**: Original smoke test had hardcoded version check for "1.3.0". Fix committed to allow "1.3.x" pattern. A3 experiencing intermittent 500 errors suggesting upstream timeout issues under load.

## Artifacts
- `artifacts/healthz.json` - Production healthz response
- `artifacts/nightly/smoke.log` - Smoke test workflow logs
- `artifacts/nightly/local-smoke-results.txt` - Local smoke test with version fix
- `artifacts/perf/perf-results.json` - Performance gate results
- `artifacts/summary.json` - Structured summary

## Workflow URLs
- **Nightly Smoke**: https://github.com/Talchain/olumi-assistants-service/actions/runs/19273383002
- **Performance Gate**: https://github.com/Talchain/olumi-assistants-service/actions/runs/19273385983

## What's in v1.3.1

### Added
- **Undici Timeout Configuration** (v04 Resilience)
  - Connect timeout: 3s (fail fast on connection issues)
  - Headers timeout: 65s (align with 65s deadline)
  - Body timeout: 60s (budget for LLM response streaming)
  - Applied to OpenAI adapter via global dispatcher

- **SSE Heartbeats** (v04 Resilience)
  - SSE comment lines (`: heartbeat\n\n`) every 10s
  - Prevents proxy idle timeouts on long-running LLM calls
  - Applied to `/assist/draft-graph/stream` endpoint

- **Nightly Smoke Retry Logic** (v04 Resilience)
  - Retry A3/A4 tests once on 408/504/500 errors (upstream timeout)
  - 2s backoff between retries
  - 75s total timeout for smoke tests

- **Production Performance Gate**
  - Lightweight Artillery config (15s, 1 req/s)
  - Gates on /healthz p95 < 8000ms
  - Non-blocking /assist/draft-graph observation
  - Always produces perf-results.json artifact
  - Runs against production Render deployment

### Fixed
- **Legacy SSE Auth Bypass**
  - Auth plugin now skips legacy SSE deprecation path
  - Allows 426 Upgrade Required response with migration guide
  - Fixes regression where auth returned 401 before route could return 426

## Next Steps

### Immediate Actions
1. **Monitor Production**: Watch for A3 timeout patterns in production logs
2. **Smoke Test Fix PR**: Create PR for qa-smoke.mjs version check fix
3. **Investigation**: Review LLM adapter timeout handling for 500 errors

### v1.3.2 Planning Issues
Following tasks from v04 spec to be implemented in v1.3.2:
- [ ] Prompt cache (LRU+TTL) - [Issue TBD]
- [ ] Archetype classification - [Issue TBD]
- [ ] Deterministic layout - [Issue TBD]
- [ ] Shadow canary - [Issue TBD]
- [ ] Patch lint - [Issue TBD]

Reference: [Olumi — Draft My Model Specification V04](https://chat.openai.com/c/6905eb563e088191a581ed4d697e440d)

## Rollback Note
If issues arise, revert the merge commit:
```bash
git revert 66838f8 -m 1
git push origin main
```

Or follow the detailed rollback procedure in `Docs/RELEASE_ROLLBACK.md`.

## Acceptance Lines

✅ **ACCEPT TAG**: v1.3.1 exists on main in https://github.com/Talchain/olumi-assistants-service/tags

✅ **ACCEPT RELEASE**: GitHub Release v1.3.1 published at https://github.com/Talchain/olumi-assistants-service/releases/tag/v1.3.1

✅ **ACCEPT DEPLOY**: /healthz shows "ok":true and "version":"1.3.1" at https://olumi-assistants-service.onrender.com/healthz

⚠️ **ACCEPT SMOKE**: A1-A2 PASS, A3-A5 degraded in https://github.com/Talchain/olumi-assistants-service/actions/runs/19273383002

✅ **ACCEPT PERF**: /healthz p95 407.5ms < 8000ms PASS in https://github.com/Talchain/olumi-assistants-service/actions/runs/19273385983

✅ **ACCEPT ARTEFACTS**: artifacts/healthz.json, artifacts/nightly/*, artifacts/perf/perf-results.json, artifacts/summary.json

✅ **ACCEPT ANNOUNCE**: Acceptance summary appended to the v1.3.1 Release notes (Discussions not enabled for repo)

---

*Generated: 2025-11-11*
*Release Engineer: Claude Code*
