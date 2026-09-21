# V5 interaction recovery — Wave 5H final report

**Branch:** `claude/p0-v5-interaction-recovery`
**Base:** `staging` (`c8306047`)
**Date:** 2026-05-06
**Wave 5H commits:** `d3938489`, `facd508d`, `72abdc33`, `01af98db`
**Branch ahead of staging:** 21 commits (Wave 0 → Wave 5H)

---

## Wave 5H scope

The Wave 5G review confirmed Wave 5F's direction was strong but flagged
proof- and promise-path risks. Wave 5H closes them in five priorities,
none of which broaden into Wave 5G (A4 add-risk clarification continuity
remains a deferred follow-up).

### Priority 1 — Resolve `apply_proposed_change`

**Resolution:** path B — soften the V4 propose-and-confirm copy to remove
the dangling "I can apply it next" promise.

The `apply_proposed_change` kind is in the closed PendingAction union but
is NOT emitted, persisted, or resumed anywhere today. Wiring it
end-to-end would require the V5 dispatcher to (a) persist the V4
`pendingProposal` to session storage, (b) read it back on the next turn,
and (c) thread it through `handleEditGraph` with
`confirmation_mode: 'apply_pending_proposal'`. The V5 dispatcher
explicitly does not do any of (a)–(c) today (see
[`edit-graph-dispatch.ts:154-173`](../../src/orchestrator-v5/handlers/edit-graph-dispatch.ts)),
so the user-facing copy was making a promise without an executable path.

Commit `d3938489` softens the copy:

| Path | Old assistant text | New assistant text |
|---|---|---|
| V4 `propose_and_confirm` ([edit-graph.ts:216](../../src/orchestrator/tools/edit-graph.ts)) | "Here's the change I'd propose. If you want, I can apply it next." | "I'm not yet certain which factor and value you want changed. Could you describe the change again with the specific factor and the value you'd like?" |

The new copy is honest about uncertainty AND points to an executable
next step (the user's reply goes through the deterministic value-update
pre-route or the LLM router with full context). The
`apply_proposed_change` kind stays in the union as reserved space for
when the deterministic-replay plumbing lands; the
[`pending-action.ts`](../../src/orchestrator-v5/session/pending-action.ts)
type-doc was updated to flag it as reserved-but-not-emitted.

Two test fixtures (`phase1-conversational-state.test.ts`,
`phase5-envelope-assembler.test.ts`) were updated to match the new
production constant so fixture text and source can no longer drift.

### Priority 2 — Honest chip-click parity labelling

The Wave 5F-3 helper test (`route-v2-chip-click-intent.test.ts`)
proved the pure-function contract of `detectChipClickResumeIntent`.
The Wave 5F-2 route-level test (`short-confirm-route-level.test.ts`)
proved `runTurnExecutor` lifecycle when called with the typed flag.
Neither proved the full HTTP boundary through `/orchestrate/v2/turn`.

Commit `72abdc33` adds
[`tests/integration/orchestrate-v2-chip-click-resume.test.ts`](../../tests/integration/orchestrate-v2-chip-click-resume.test.ts).
It mounts `ceeOrchestratorRouteV2` on a Fastify instance and uses
`app.inject` to drive the route exactly as production does. The test
exercises:
1. `chip_click` + `action_type=what_would_flip` with a persisted
   `what_would_flip` PendingAction in `SessionStore` →
   route detects intent → threads typed flag → resumer claims turn →
   safety rerun-analysis-required recovery composes → 200, zero LLM
   calls, recovery copy + executable run_analysis chip on wire.
2. `chip_click` + `action_type=run_analysis` regression cordon: the
   dedicated `dispatchChipClickRunAnalysis` shortcut still claims the
   turn (200 or typed 500 because PLoT is unavailable in the mocked
   environment); zero LLM calls.

The chip-click resume contract now has three layered proofs:

| Layer | Test | Wave |
|---|---|---|
| Pure-function helper | `route-v2-chip-click-intent.test.ts` | 5F-3 |
| Route lifecycle (calls `runTurnExecutor` with typed flag) | `short-confirm-route-level.test.ts` | 5F-2 |
| HTTP boundary (POST `/orchestrate/v2/turn` via `app.inject`) | `orchestrate-v2-chip-click-resume.test.ts` | **5H-3** |

### Priority 3 — Sensitivity vocabulary alignment

**Mismatch found:** the Wave 4 `formatSensitivityDirection` and
`formatEdgeStrengthMagnitude` helpers used their own bucket boundaries
(0.02 / 0.1 / 0.3 / 0.6) and an adverb form ("moderately strengthens
the lead"). The canonical `bandFromMagnitude` helper at
[`format/influence-bands.ts`](../../src/orchestrator-v5/format/influence-bands.ts)
uses thresholds 0.3 / 0.7 / 0.95, near-zero 0.05, and adjective
vocabulary `weak | moderate | strong | very strong`.

For the SAME sensitivity coefficient (e.g. 0.5):
- Sonnet's display-safe context pack saw "moderate positive influence"
  (via `influencePhrase` → `bandFromMagnitude`)
- The deterministic fallback emitted "strongly strengthens the lead"

Commit `facd508d` (with hotfix `01af98db` for a missed test) replaces
both helpers with thin wrappers over `bandFromMagnitude`. The fallback
prose and the prose Sonnet sees in its context pack now read from the
same single source of truth. Sentence templates compose naturally to:
- "Owner time, which has a moderate positive influence."
- "Today it has a strong negative influence."
- "Engineering Capacity has a strong positive influence; Hiring Cost
  has a moderate negative influence."

Threshold + vocabulary table:

| Range | Pre-Wave-5H | Wave 5H (canonical) |
|---|---|---|
| `\|v\| < 0.05` | "slightly" / "has little effect" (with 0.02 boundary) | "has no material influence" |
| `0.05 ≤ \|v\| < 0.3` | "slightly" or "moderately" | weak |
| `0.3 ≤ \|v\| < 0.7` | "moderately" or "strongly" | moderate |
| `0.7 ≤ \|v\| < 0.95` | "very strongly" | strong |
| `\|v\| ≥ 0.95` | "very strongly" | very strong |

Telemetry retains raw values; this change governs USER-FACING prose
only. The no-raw-decimal egress invariant is preserved.

### Priority 4 — Wave 5G stays deferred

Wave 5H did not reveal Wave 5G as tiny. A4 add-risk clarification
continuity remains a deferred follow-up. The final acceptance grid below
labels it as such.

### Priority 5 — Honest proof matrix

See "Proof matrix" section below.

---

## Proof matrix — named brief failures

For each named failure: which proof levels exist on this branch.
Columns are independent (a failure can be HTTP-boundary tested without
being live-staging proven, etc.). A column is checked only when a proof
at exactly that level exists.

Proof level definitions:
- **Implemented**: production code path exists and is wired.
- **Unit tested**: a pure-function or single-module test exercises the
  contract.
- **Route tested**: a test exercises `runTurnExecutor` (or equivalent
  V5 lifecycle entry) with the typed inputs.
- **HTTP-boundary tested**: a test mounts the Fastify route and
  exercises POST `/orchestrate/v2/turn` via `app.inject`.
- **User-visible locally proven**: a test or replay verifies the
  user-facing copy / wire response in the way a user would experience it.
- **Live staging proven**: deployed staging has been hit with the same
  request and observed.
- **Deferred**: an aspect of the failure is acknowledged out of scope.

| # | Failure | Implemented | Unit tested | Route tested | HTTP-boundary tested | User-visible locally proven | Live staging proven | Deferred |
|---|---|---|---|---|---|---|---|---|
| 1 | "yes" after explore-result offer dispatches what_would_flip / run_analysis | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ not run | — |
| 2 | At-limit add-risk no longer spends 16-18s in `edit_graph` | ✅ (preflight) | ✅ | ✅ | ❌ not added | ✅ (preflight blocks LLM call) | ❌ not run | continuity follow-up only (Wave 5G) |
| 3 | Value-update clarification applies the original quantity | ✅ (set_factor_value side) | ✅ | ✅ | ✅ | ✅ | ❌ not run | A4 add-risk side (Wave 5G) |
| 4 | Explanation output has no raw decimals or internal terms | ✅ | ✅ (boundary buckets + denylist) | ✅ | ✅ (chip-click recovery copy passes denylist) | ✅ | ❌ not run | — |

### Per-failure evidence pointers

#### Failure 1 — "yes" after explore-result offer

- Implemented:
  [`turn-executor.ts`](../../src/orchestrator-v5/turn-executor.ts) wires
  the short-confirm pre-route;
  [`commit.ts`](../../src/orchestrator-v5/commit.ts) emits the pending
  action atomically with the chip; the
  [`v5_pending_actions`](../../supabase/migrations/20260505120000_v5_pending_actions.sql)
  migration is applied to staging.
- Unit tested: `deterministic-short-confirm.test.ts` (regex matrix +
  invalidation matrix + freshness precondition).
- Route tested: `short-confirm-route-level.test.ts` (lifecycle proof:
  validate → execute → commit, zero LLM calls, post-handler compose runs).
- HTTP-boundary tested: `orchestrate-v2-chip-click-resume.test.ts`
  (Wave 5H-3) — exercises `/orchestrate/v2/turn` via `app.inject`.
- User-visible locally proven: route-level test asserts the wire
  `assistant_text` matches the canonical post-handler confirmation
  template AND that no internal copy ("no pending action", "internal
  error", "not found in graph") leaks.
- Live staging: not run.
- Deferred: nothing in this row.

#### Failure 2 — Add-risk preflight

- Implemented:
  [`edit-graph-dispatch.ts`](../../src/orchestrator-v5/handlers/edit-graph-dispatch.ts)
  invokes `wouldExceedAddRiskLimits` BEFORE the LLM call.
- Unit tested: `edit-graph-dispatch-preflight.test.ts` covers node and
  edge limit cases + the recovery envelope shape.
- Route tested: `edit-graph-dispatch.test.ts` exercises the
  preflight-skipped-LLM path through the dispatcher.
- HTTP-boundary tested: NOT added in this tranche. Adding it would
  require constructing a 30-edge graph fixture and mounting Fastify;
  marked as Wave 6 follow-up if needed.
- User-visible locally proven: handler-level test asserts the
  wire-shape recovery envelope carries `EDGE_LIMIT_EXCEEDED_PREFLIGHT`
  and chips with executable `action_type` payloads.
- Live staging: not run.
- Deferred: A4 add-risk **clarification continuity** (the second-turn
  resume after a missing-driver clarify). The slow-path failure itself
  is fixed by preflight.

#### Failure 3 — Value-update continuity

- Implemented:
  [`turn-executor.ts`](../../src/orchestrator-v5/turn-executor.ts) wires
  `tryClarificationResume` (Wave 5E + 5F-1 hardening);
  set_factor_value clarification chips emit `set_factor_value`
  PendingActions at the clarify turn.
- Unit tested: `clarification-resume.test.ts` covers fuzzy matching,
  expiry, graph-hash conflict, target-existence filter.
- Route tested: end-to-end runTurnExecutor proofs in
  `short-confirm-route-level.test.ts` and `explain-then-yes-two-turn.test.ts`.
- HTTP-boundary tested: `orchestrate-v2-deterministic-value-update.test.ts`
  exercises POST `/orchestrate/v2/turn` for the deterministic value-
  update path including stale-after-mutation freshness re-derivation.
- User-visible locally proven: assistant_text receipt uses human
  factor label and user units (e.g. `£30,000`) — no raw IDs, no
  normalised model-unit fractions.
- Live staging: not run.
- Deferred: A4 add-risk clarification continuity (`edit_graph_add_risk`
  emit + driver-match pre-route + legacy-dispatch synthesis) is a
  Wave 5G follow-up.

#### Failure 4 — Explanation egress

- Implemented:
  [`explanation-fallback.ts`](../../src/orchestrator-v5/tools/handlers/explanation-fallback.ts)
  bucketed prose (Wave 4 + Wave 5H alignment to canonical
  `bandFromMagnitude`);
  [`validator-explanation.ts`](../../src/orchestrator-v5/routing/validator-explanation.ts)
  two-rule raw-decimal egress guard + extended denylist.
- Unit tested: `explanation-fallback-direction.test.ts` (43 boundary
  cases + non-finite handling + no-raw-decimal invariant);
  `validator-explanation.test.ts` denylist + decimal regex coverage.
- Route tested: `explain-results.test.ts` handler-level dispatch with
  full context-pack assembly.
- HTTP-boundary tested: the chip-click resume HTTP test
  (`orchestrate-v2-chip-click-resume.test.ts`) asserts
  `not.toMatch(/-?\d+\.\d+/)` on the wire `assistant_text`.
- User-visible locally proven:
  `integration-bef4470b.test.ts` asserts the prose contains the
  leading option label, a probability rendered as percentage, the
  factor label, AND bucketed influence prose, AND no raw decimals.
- Live staging: not run.
- Deferred: nothing in this row.

---

## Test and hygiene summary

### Touched-test results (Wave 5H)

```
$ pnpm vitest run --reporter=default tests/unit/orchestrator/pipeline/phase5-envelope-assembler.test.ts tests/unit/orchestrator/pipeline/phase1-conversational-state.test.ts
  Tests   55 passed (55) — Wave 5H-1

$ pnpm vitest run --reporter=default src/orchestrator-v5/tools/handlers/__tests__/explanation-fallback-direction.test.ts src/orchestrator-v5/tools/handlers/__tests__/explanation-fallback.test.ts
  Tests   60 passed (60) — Wave 5H-2

$ pnpm vitest run --reporter=default src/orchestrator-v5/tools/handlers/__tests__/explain-results.test.ts
  Tests   25 passed (25) — Wave 5H-2 regression

$ pnpm vitest run --reporter=default src/orchestrator-v5/tools/handlers/__tests__/integration-bef4470b.test.ts
  Tests    9 passed  (9) — Wave 5H-2 hotfix

$ pnpm vitest run --reporter=default tests/integration/orchestrate-v2-chip-click-resume.test.ts
  Tests    2 passed  (2) — Wave 5H-3 (new HTTP-boundary test)
```

### Full V5 + orchestrator suite

```
$ pnpm vitest run --reporter=default src/orchestrator-v5 src/orchestrator \
    tests/integration/orchestrate-v2-chip-click-resume.test.ts \
    tests/integration/orchestrate-v2-deterministic-value-update.test.ts

  Test Files  1 failed | 131 passed (132)
  Tests       2 failed | 2117 passed | 1 skipped (2120)
```

### Failing tests — staging baseline check

Both failing tests are **pre-existing on `staging`**, not Wave 5H
regressions:

```
src/orchestrator-v5/tools/handlers/__tests__/no-op-helpers.test.ts
  > buildAnalysisAbsentTemplate
    > uses singular "option" wording when option_count === 1
    > uses plural "options" wording when option_count !== 1
```

`git diff --stat staging..HEAD --
src/orchestrator-v5/tools/handlers/__tests__/no-op-helpers.test.ts
src/orchestrator-v5/tools/handlers/no-op-helpers.ts` returns no output
— the source and test are byte-identical to staging. The wording
mismatch (`"options configured"` vs `"options set up"`) is a
pre-existing failure unrelated to any Wave 5 work.

The 1 skipped test is unchanged from staging (a test file gating on a
PLoT environment variable that is unset in the local Vitest sandbox).

### Build typecheck

```
$ pnpm exec tsc -p tsconfig.build.json --noEmit
```

Errors are all pre-existing, all in `src/routes/assist.v1.*.ts` and
`src/services/review/*.ts` — missing `generated/openapi.d.ts` codegen
artefact. None of the Wave 5H touched files (`edit-graph.ts`,
`pending-action.ts`, `explanation-fallback.ts`,
`integration-bef4470b.test.ts`, `orchestrate-v2-chip-click-resume.test.ts`)
have any TS errors.

### Branch diff hygiene

```
$ git status --short -- src tests Docs
(empty after the four Wave 5H commits)
```

Source-only diff guard:
- No `node_modules` staged.
- No `.env` staged.
- No lockfiles staged.
- No prompt files staged (`src/prompts/**`).
- No generated/build artefacts staged.

Branch is 21 commits ahead of staging, all under `claude/p0-v5-interaction-recovery`.

### DB migration / rollback status

[`supabase/migrations/20260505120000_v5_pending_actions.sql`](../../supabase/migrations/20260505120000_v5_pending_actions.sql)
adds:
- `pending_actions JSONB NOT NULL DEFAULT '[]'::jsonb` column on
  `v5_conversation_turns`.
- `append_turn_atomic` overload extended with
  `p_pending_actions JSONB DEFAULT '[]'::jsonb`.

Migration was applied to staging Supabase during Wave 0. The default
keeps existing callers working unchanged. Rollback is `DROP COLUMN IF
EXISTS pending_actions;` plus dropping the new RPC parameter — both
documented in the migration file footer.

### Staging test rows / orphans

Wave 0 verification used the staging Supabase project for the
`readMostRecentPendingActions` integration test. Test rows used UUID
scenario_ids prefixed `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa` to make
cleanup trivial. After the verification run, all test rows were
removed manually via the staging dashboard (confirmed at the time of
Wave 0 close-out).

The HTTP-boundary tests added in Wave 5H-3 mock SessionStore in-process
— they do NOT touch the real staging Supabase.

### Push / merge / deploy status

- No `git push` has been issued for `claude/p0-v5-interaction-recovery`.
- No PR opened.
- No merge to `staging` or `main`.
- No deploy.

All Wave 5H commits are local on this worktree.

---

## Proceeding to Wave 6

Wave 5H closure satisfies the gates the user set:
1. ✅ `apply_proposed_change` resolved (path B — copy softened).
2. ✅ Chip-click parity honestly labelled AND backed by an HTTP-boundary
   test (the small option was viable).
3. ✅ Sensitivity vocabulary checked, alignment found and applied to
   the canonical `bandFromMagnitude` helper.
4. ✅ Proof matrix above is honest — every "✅" reflects a proof at that
   exact level; "❌ not run" is used for live-staging.
5. ✅ No new P0 gaps surfaced during Wave 5H.

Wave 6 next focuses on:
- A representative end-to-end local journey replay across the four
  named failures, captured as a single CEE integration test.
- A manual deployed-staging replay checklist for the user to execute
  directly.
- A final status grid + merge recommendation (already largely
  represented above; Wave 6 will produce the canonical short version).

A4 add-risk clarification continuity stays deferred as Wave 5G — a
genuine follow-up brief, not a blocker for this tranche.
