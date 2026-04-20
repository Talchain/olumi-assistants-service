# V5 Debug Output — Pre-Implementation Test Baseline

**Brief:** v5-debug-output-v1  
**Date:** 2026-04-20  
**Branch:** claude/v5-debug-output (cut from staging @ 47f1b16b)

---

## Typecheck baseline

```
pnpm exec tsc -p tsconfig.build.json --noEmit
```

**Result:** Clean (exit 0). Two `.npmrc` warnings about `${NPM_PACKAGES_TOKEN}` — pre-existing, unrelated to this brief.

---

## Test suite baseline

```
pnpm exec vitest run
```

**Result:**

| Metric | Count |
|---|---|
| Test files failed | 11 |
| Test files passed | 651 |
| Test files skipped | 30 |
| **Total files** | **692** |
| Tests failed | 38 |
| Tests passed | 11901 |
| Tests skipped | 198 |
| **Total tests** | **12138** |

Duration: ~31s

---

## Known pre-existing failures

These failures exist on staging before any changes in this brief. Gate 7 requires zero new failures — the 38 baseline failures must not increase.

The failing tests are pre-existing on staging. A full enumeration will be appended once `pnpm exec vitest run --reporter=verbose` completes (running in background at baseline capture time).

---

## Gate 7 target

Post-implementation: **11 failed files / 38 failed tests** maximum (no new failures).  
Any new failure must be investigated and resolved before PR.
