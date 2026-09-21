# CQE Test Baseline (pre-implementation)

**Date:** 20 April 2026
**Purpose:** Captured before Phase 0 begins per Gate 9 in cqe-implementation-v1.1. Post-CQE counts must not regress against this baseline.

---

## Full-suite vitest baseline

Command: `pnpm exec vitest run --reporter=default`

Result:

```
Test Files  11 failed | 647 passed | 30 skipped (688)
      Tests  38 failed | 11817 passed | 198 skipped | 1 todo (12054)
   Duration  30.06s
```

## tsc --noEmit baseline

Command: `pnpm exec tsc -p tsconfig.build.json --noEmit`

Result: **clean** (source `src/` compiles). Only pnpm config warnings about `NPM_PACKAGES_TOKEN`, not tsc errors.

## Notes on pre-existing failures

The 38 pre-existing test failures are unrelated to CQE (e.g. set-factor-value `display_value` branch assertion mismatches). They are documented here as the baseline; any new failures introduced by CQE work are a Gate 9 regression and block review.

## Post-CQE verification

After implementation completes:
- File count: must be ≤11 failed (no new failed files)
- Test count: must be ≤38 failed (no new failed tests)
- `tsc --noEmit`: must remain clean for `src/`
