# Flag-OFF behavioural-identity proof — quarantined dual-model production branch

- **Branch:** `claude/v6-dual-model-production-system`
- **Base:** `origin/staging` @ `f2998df02` (#329)
- **Tip at proof time:** `99b3b8ff2` (the last code-bearing commit; this document
  is the only subsequent change and is docs-only)
- **Environment:** fresh git worktree, full `pnpm install`, `pnpm openapi:generate`;
  all commands run from the worktree cwd.

## 1. The proof: dispatch flag-OFF byte-identity + phase-4 compat, re-run at tip

The MVP's behavioural-identity contract is pinned by two live suites:
`dispatch-flag-off.test.ts` (flag OFF ⇒ the enricher module is never imported and
the committed graph is the M1 graph byte-identical; flag ON no-op/merge paths) and
`phase4-dispatch-compat.test.ts` (merged-graph atomicity, hash-from-merged,
call-based `llm_calls_used` accounting, backstop). Neither file — nor ANY file
they execute — is modified by this branch (see §3).

**Baseline (base `f2998df02`, before any branch changes):**

```
✓ src/cee/dual-draft/__tests__/dispatch-flag-off.test.ts (7 tests) 9ms
✓ src/cee/dual-draft/__tests__/phase4-dispatch-compat.test.ts (13 tests) 11ms
Test Files  2 passed (2)
Tests       20 passed (20)
```

**Re-run at branch tip:**

```
✓ src/cee/dual-draft/__tests__/dispatch-flag-off.test.ts (7 tests) 9ms
✓ src/cee/dual-draft/__tests__/phase4-dispatch-compat.test.ts (13 tests) 10ms
Test Files  2 passed (2)
Tests       20 passed (20)
```

Command: `pnpm vitest run src/cee/dual-draft/__tests__/dispatch-flag-off.test.ts
src/cee/dual-draft/__tests__/phase4-dispatch-compat.test.ts`

**Verdict: GREEN — identical results at base and tip (20/20).**

## 2. Gates at tip

| Gate | Result |
|---|---|
| `pnpm typecheck` + `pnpm typecheck:src` (build scope, the pre-push gate) | clean |
| Full-scope `tsc --noEmit` (advisory drift ratchet) | **0 errors in any branch-added file**; inherited baseline unchanged |
| `pnpm test:required` (the required CI gate) | **902 files / 18,210 tests passed**, 0 failed (all ~230 branch-added tests included) |
| eslint over every changed `.ts` on the branch | clean |
| Full `pnpm test` (advisory; includes creds-dependent `tests/integration/**` + the enumerated baseline-red files) | failing-set IDENTICAL to base — §4 |

## 3. Structural proof of quarantine (audits over `git diff origin/staging...HEAD`)

1. **Activation-path intersection = ∅.** Changed files ∩
   {`draft-graph-dispatch.ts`, `src/cee/dual-draft/**`, `src/config/**`,
   `src/prompts/**`, `src/adapters/**`, `src/schemas/**`,
   `vitest.required.config.ts`} is empty. The only non-source touch is ONE
   `package.json` script line (`activation:v6:staging` — metadata, executed by no
   runtime path). Flag-OFF identity therefore holds **by construction** as well as
   by test: the flag-OFF turn executes only unchanged files, and the flag gate
   lazy-imports the (also unchanged) enricher.
2. **Nothing live imports the new namespace.** `grep -rl "cee/dual-model" src/`
   matches only files under `src/cee/dual-model/` itself.
3. **No env var set, no flag flipped.** The diff contains no `process.env`
   assignment and no `CEE_V6_DUAL_DRAFT_ENABLED`/`CEE_MODEL_M2_REVIEW` value-setting
   — the names appear only as string constants inside the (never-run) activation
   smoke tooling and docs.
4. **Migration unapplied.** `migrations/006_create_cee_m2_artifacts.sql` is a
   committed file only; no database was touched.

## 4. Advisory full-suite delta vs base

Acceptance = zero NEW reds vs base (the inherited advisory reds are a known
baseline: creds-dependent `tests/integration/**` + the red files enumerated in
`vitest.required.config.ts`).

Both suites were run to completion in this worktree family (tip) and a fresh
detached worktree at the base SHA (base), same machine, sequentially:

- Base `f2998df02`: **62 failing files** (268-failing-test class)
- Tip: **62 failing files**
- **Set difference: EMPTY in both directions** — `comm -13` (new at tip) and
  `comm -23` (gone at tip) over the sorted failing-file lists both print
  nothing. The advisory failing set is byte-identical to base.

## 5. What was deliberately executed from the new tooling

`tools/v6-dual-draft-activation/index.ts` was invoked exactly twice during the
build, both access-free by construction: `--help` (usage text) and default
plan mode (renders the check plan; the plan-mode IO throws on every accessor —
pinned by the never-live tripwire test). Fixtures and live modes were **never**
invoked. No LLM call is possible from any mode of the tool (no check touches an
adapter; the model check stops at router resolution).
