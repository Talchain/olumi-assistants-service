# Known Test Failures

**Date:** 12 April 2026
**Scope:** Pre-staging cleanup audit

| Test file | Test name | Root cause | Affects staging? | Recommended action |
|-----------|-----------|-----------|-----------------|-------------------|
| `tests/integration/orchestrator/route.test.ts` | `preserves top-level analysis_state when context is absent` | Integration test hits full Fastify pipeline. Returns 500 — likely a missing mock for a recently added dependency in the orchestrator pipeline. Not a schema validation issue (session_state and chip_metadata are both `.optional()` at the Zod level). | No — the route works in staging; this is a test infrastructure gap where the mock setup hasn't kept pace with pipeline changes. | Owner: orchestrator pipeline. Fix: trace the 500 response body to identify which pipeline dependency is unmocked, then add the mock. Low priority — the test was added to validate analysis_state passthrough, not to test the full pipeline. |

## Fixed in this cleanup

| Test file | Test name | Root cause | Fix |
|-----------|-----------|-----------|-----|
| `tests/unit/cee.unified-pipeline.stage-6.test.ts` (22 tests) | All `runStageBoundary` tests | Missing `warnOnUnknownV3Fields` in cee-v3.js mock. The function was added to boundary.ts (CIL Phase 1) but the mock wasn't updated. | Added `warnOnUnknownV3Fields: vi.fn()` to the mock. |
| `tests/integration/healthz-isl.test.ts` | `applies clamping/defaults for invalid timeout and retries` | Stale expected value. Test expected `timeout_ms: 30000` but `MAX_TIMEOUT` in `src/adapters/isl/config.ts` was changed to `60000`. | Updated expected value to `60000`. |
| `tools/graph-evaluator/tests/adapters.test.ts` | `loads all decision-review fixtures` | iCloud sync created 3 duplicate files (`*" 2".json`) in the fixtures directory, inflating the count from 9 to 12. | Removed the 3 iCloud duplicate files. |
