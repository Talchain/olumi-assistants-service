# Orchestrator eval-pack — FOUNDATION (2026-07-08)

Builds `tools/orchestrator-eval/`: the durable regression gate so no future
orchestrator prompt ships untested. This is the **#1 recommendation of both
prompt workstreams** and the D2-ruled location for the eval estate.

Base: `origin/staging` c49f5cc06. Branch: `claude-eval/orchestrator-eval-foundation`.
Scope: FOUNDATION slice only — a first PR, not the whole eval system.

## Why (the standing rule this enables)

Two prompt workstreams both landed on: **no orchestrator prompt → staging
without an A/B run.** There was no durable gate to make that rule real — prompt
changes were verified ad hoc and the win%-vs-goal-fit conflation shipped (and
had to be fixed) twice. This foundation is the smallest honest thing that makes
the rule enforceable: a chassis that runs a candidate through the real assembly
and scores it with the runtime's own guards, plus one worked fixture proving the
gate catches that exact drift.

## What the foundation does

1. **Real assembly path.** `src/assemble.ts` runs a fixture's raw
   `ContextPackAnalysis` through the PRODUCTION display formatter
   `formatAnalysisForContext` (`src/orchestrator-v5/format/…`) — the exact stage
   the goal-fit fix lives in. It is the runtime formatter itself, not a
   re-specified copy, so the eval cannot drift from what the prompt is grounded
   on.
2. **Scoring with PRODUCTION guards (never re-specified).** `src/guards.ts`
   re-exports `findForbiddenMatches` (composes the runtime's
   `FORBIDDEN_USER_FACING_PHRASES`) and `containsMutationLanguage`. The scorer
   uses these directly. Contrast: the older `tools/graph-evaluator`
   orchestrator-scorer carries its OWN `BANNED_TERMS` array — the drift failure
   mode this foundation deliberately avoids.
3. **One worked fixture — the win%-vs-target-fit conflation.**
   `fixtures/goal-fit-conflation.json` reproduces staging scenario **90385279**:
   leading option **89% win** / **29% target-fit**. Ships `good` + `good_terse`
   (should PASS) and `regression` + `regression_subtle` (should FAIL). The
   detector (`src/goal-fit-conflation.ts`) is grounded in the actual assembled
   numbers, not a keyword list.
4. **Deterministic, offline chassis.** `pnpm eval:orchestrator` runs every
   fixture and exits non-zero if any verdict disagrees with the fixture's
   `expected` map. No paid LLM call in the default path.

## Claim precision (house doctrine)

- The foundation exercises the **analysis-projection assembly**
  (`formatAnalysisForContext`) — NOT yet the full context-pack → system-prompt
  compose. That is the load-bearing, goal-fit-relevant stage; fuller compose is
  deferred.
- `win_probability` ("beats the alternatives") is distinct from `target_fit`
  ("meets your target"). The assembly-fidelity test binds to the production
  `TARGET_FIT_DEFINITION` constant, so a regression at the source fails the gate.

## Deliberately deferred (co-owned with the prompt workstream / "Brief I")

- Full fixture set + R-sets across every orchestrator turn class.
- Full prompt compose fidelity (context-pack assembler → system-prompt).
- Paid LLM judge (deterministic scorer is the floor; judge is additive) — seam
  typed in `src/judge-seam.ts`, off by default.
- **CI gate wiring** — NOT wired as a blocking gate yet. Follow-up, once the
  fixture set is real: gate so no orchestrator prompt reaches staging without a
  green `pnpm eval:orchestrator`.
- **No prompt CONTENT changes** — prompts are Brief I's; this lane touches none.

## Gates run (all green, in a fresh worktree off c49f5cc06)

- `pnpm typecheck:src` — clean.
- `bash scripts/ci/typecheck-ratchet.sh` — 462 errors == baseline (exit 0). No
  src/tests touched; the one-file set difference is pre-existing drift between
  the base commit and the baseline-capture commit, not introduced here.
- `bash scripts/check-forbidden-boundary-patterns.sh` — all patterns ==
  baseline (exit 0). The new tool lives under `tools/` (outside the src-only
  ratchet scope).
- `pnpm eval:orchestrator:test` — 13/13 vitest tests pass.
- `tsc -p` over the tool (transient config, not committed): 0 type errors in the
  tool's own files.

## Files

- `tools/orchestrator-eval/**` (new) — chassis, guards, fixture, tests, README.
- `package.json` — added `eval:orchestrator` + `eval:orchestrator:test` scripts.
- `node_modules` NOT staged (git-tracked here; hydrated via
  `pnpm install --frozen-lockfile` for the run only).

## Respected constraints

Frozen telemetry registry (untouched). No prompt content changes. node_modules
staged explicitly (never `git add -A`). Draft PR, never merged.
