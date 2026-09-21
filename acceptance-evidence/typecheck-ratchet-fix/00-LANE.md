# Lane: restore the "Typecheck Drift (ratchet)" CI job

**Repo:** `Talchain/olumi-assistants-service` · **Base:** `origin/staging` @ `eb8672d0`
**Branch:** `ci/restore-typecheck-ratchet-470`
**Defect class:** broken alarm — a permanently-red ratchet masks all future real drift.

## The defect

The CI job **"Typecheck Drift (ratchet)"** (`scripts/ci/typecheck-ratchet.sh` vs
`scripts/ci/typecheck-baseline.txt`, `# count=462`, captured at `a8731e60`) had been
RED because the full `tsc --noEmit` reported **486** errors (**+24** over baseline) across
**four test files not in the baseline**. A ratchet that is always red catches no new drift.

Fix = drive the count back to the frozen baseline (462) with the four files clean and
**zero baseline growth** (baseline file untouched). Real type fixes, no `@ts-ignore` / `as any`.

## Per-file diagnosis and fix

| File | Errors | TS code | #470-introduced? | Root cause | Fix |
|---|---|---|---|---|---|
| `src/orchestrator-v5/coaching/__tests__/compare-runs.test.ts` | 14 | TS2353 | **Yes** (`1d93950f`) | Local `OptionSpec.drivers` element type omitted `influence_score`, which every #470 fixture now passes | Widened the driver element type to include `influence_score: number`; threaded the supplied value through `envelope()` (was recomputing `Math.abs(sensitivity)` — behaviour-identical: every fixture sets `influence_score === abs(sensitivity)`) |
| `src/orchestrator-v5/coaching/__tests__/driver-influence-narration.test.ts` | 1 | TS2339 | **Yes** (`1d93950f`, new file) | `FACTOR_SENSITIVITY_341` is `as const`; the least-influential factor genuinely lacks `zero_reason`, so `.map()` destructuring `zero_reason` failed on that union member | Replaced `as const` with an explicit `FactorSensitivity341` interface where `zero_reason?` is optional (the pin-asymmetry is load-bearing, so it must remain absent on that factor) |
| `tests/contract/sensitivity-sign-contract.test.ts` | 5 | TS2353 | **Yes** (`1d93950f`) | `makeAnalysis()` drivers param type omitted `influence_score`, which the #470 fixtures pass | Widened the param element type to include `influence_score: number` |
| `tests/unit/cee.options-identical-graceful-dedup.test.ts` | 4 | TS2322 | **No** — older (`#452` `1584f75d` / `#458` `a030dea8`) | Graph builders annotated `GraphT` (passthrough Zod output from `src/schemas/graph.js`); but `StageContext.graph` is `GraphV1` (`src/contracts/plot/engine.js`). Passthrough output isn't assignable to the strict `GraphV1` when passed as a `makeCtx({ graph })` override | Retyped the three builders + import from `GraphT` → `GraphV1` (the type the pipeline's mutable graph actually is). The existing `as unknown as GraphT` casts became `as unknown as GraphV1` — net-zero, no new casts |

Two of the four are the #470 narration/influence tests (the merge the orchestrator tolerated
as "pre-existing" — it wasn't; #470 raised 462→486). The dedup file is separate, older
drift (#452/#458) that had also been silently red since before #470.

## Before / after (fresh blobless clone, `pnpm install --frozen-lockfile`, `pnpm openapi:generate`)

```
BEFORE: scripts/ci/typecheck-ratchet.sh
  ::error:: New file(s) with TypeScript errors (not in baseline):
    + compare-runs.test.ts + driver-influence-narration.test.ts
    + sensitivity-sign-contract.test.ts + cee.options-identical-graceful-dedup.test.ts
  ::error:: Total typecheck errors increased: baseline=462 current=486 (+24).
  Ratchet FAILED.   (exit != 0)

AFTER: scripts/ci/typecheck-ratchet.sh
  ✅ Typecheck drift within baseline — 136 files / 462 errors (baseline: 137 files / 462 errors).
  Ratchet EXIT CODE: 0
```

Full `tsc --noEmit --pretty false` error count: **486 → 462** (== baseline). Each of the four
target files: **0** errors. No new erroring file introduced anywhere.

> Note: the ratchet's post-run notice flags `integration-precondition-fail-chip.test.ts`
> (a baseline file that no longer errors — an unrelated pre-existing improvement). The ratchet
> tolerates a shrink and passes; the baseline file is left **unchanged** to avoid bundling an
> edit outside this lane's surface.

## Other gates

- `pnpm test:required`: **1072 files / 20490 passed**, 99 skipped, 13 todo — exit 0.
- The four suites directly: **4 files / 52 tests passed**.
- `scripts/check-forbidden-boundary-patterns.sh`: `warnOnInvalid=0`, `as_unknown_as=95`,
  `science_field_default_fallback=17` — all == baseline (exit 0). **Zero new `as any` / `as unknown as`.**
- Staged non-`node_modules` surface only: the four test files + this evidence file. **Staged node_modules count: 0.**

## Baseline decision

`scripts/ci/typecheck-baseline.txt` is **unchanged** (0 growth). Every one of the +24 errors was
cleanly fixable at the real shape, so no fallback baseline bump was needed.
