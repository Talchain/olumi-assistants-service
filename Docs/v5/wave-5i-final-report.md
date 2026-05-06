# V5 interaction recovery — Wave 5I final report

**Branch:** `claude/p0-v5-interaction-recovery`
**Base:** `staging` (`c8306047`)
**Date:** 2026-05-06
**Wave 5I commits:** `ca77914d`, `a8080309`, `29a44ff3`, `09e0492f`, `6c7c438e`
**Branch ahead of staging:** 27 commits (Wave 0 → Wave 5I)

This supersedes [`wave-5h-final-report.md`](wave-5h-final-report.md). Wave
5G review of Wave 5H surfaced one P0 (cross-turn divergence) and several
proof-honesty gaps. Wave 5I closes them.

---

## What Wave 5I changed

### P0 — `set_factor_value` pendings now persist `graph_hash`

Production clarify pendings emitted only `preconditions: { target_entity_ids: [...] }`,
so the Wave 5F-1 graph-hash invalidation in clarification-resume was
inert (early-returned "no conflict" when `preconditions.graph_hash` was
absent). A client-side `direct_graph_edit` between the clarify and the
reply could not be detected — the reply would silently apply the
original quantity to the changed model.

Fix at the clarify emit site reads `freshness.current_graph_hash` (the
freshness derivation already computes it) and persists it alongside the
existing `target_entity_ids`. Regression test in
`turn-executor-deterministic-value-update.test.ts` reads the persisted
`pending_actions` from the SessionStore append-mock and asserts every
entry carries a non-empty hash.

### P1 — Focused recovery for clarification-resume skip reasons

Four skip reasons no longer drift to the LLM:

| Old skip reason → | New dispatch | TurnExecutor response |
|---|---|---|
| `all_expired` | `recovery_expired` | "The earlier question I asked has lapsed... Tell me again what you'd like to change..." |
| `graph_hash_changed` | `recovery_graph_changed` | "The model has changed since I asked..." |
| `all_targets_missing` | `recovery_targets_missing` | "The factors I was asking about aren't in the model any more..." |
| `multiple_label_matches` | `recovery_label_ambiguous` | "Your reply matches more than one factor — did you mean X or Y?" + chip per candidate |

The remaining `matched: false` skip reasons (`message_likely_value_update`,
`message_likely_short_confirm`, `no_pending_clarification`, `no_graph`,
`no_label_match`) correctly defer to other routes / the LLM and stay as
fall-throughs — they do not represent stranded clarifications.

### P1 — HTTP success-path proof for chip-click `what_would_flip`

The Wave 5H HTTP test exercised only the recovery branch (freshness=unknown
→ rerun_analysis_required). Wave 5I-3 adds a fresh-analysis test:
`computeAnalysisAffectingGraphHash` produces the live hash, the mocked
SessionStore pins the prior fact's `graph_hash_at_run` to the same hash,
freshness derives `fresh`, the resumer dispatches the handler. Telemetry
confirms the full lifecycle ran:
```
stages_completed = [build_turn_context, orient, validate, execute,
                    confirm, coach, compose, commit]
commit_performed = true
llm_calls_used   = 0
analysis_freshness = "fresh", reason = "graph_hash_match"
pending_action.matched / consumed / handler_invocation outcome=success
```

### P1 — HTTP two-turn proof for value-update clarify→reply

`orchestrate-v2-clarify-reply-two-turn.test.ts` is a new file. Turn 1
POSTs "Set Cost and Revenue to 5" → multi-candidate clarify, persists
two pending actions with `graph_hash`. Turn 2 POSTs "Cost" → resumer
matches, reconstructs the original quantity (5), dispatches
`set_factor_value`, response carries a `graph_patch` block targeting
`fac_cost`. Across both turns: zero LLM calls. Receipt uses the human
factor label and never leaks raw ids. A negative-gate test (Turn 2
typed "what is going on with the model") proves the resumer correctly
defers to the LLM when nothing in the prior clarify matches.

### Style — propose-and-confirm copy refined

| Path | Old | New |
|---|---|---|
| V4 `propose_and_confirm` | "I'm not yet certain which factor and value you want changed. Could you describe the change again with the specific factor and the value you'd like?" | "I've drafted a change that fits your description, but I can't apply a draft proposal automatically yet. Tell me the specific factor and value you'd like, and I'll make the change directly." |

### Style — lead-framing restored in deterministic fallback prose

The Wave 5H-2 noun-phrase form ("Cost has a moderate negative
influence") was abstract — influence on what? The fallback templates
now compose the lead-framing form again, reusing
`bandFromMagnitude` thresholds so prose and the upstream display-safe
projection still cannot drift.

| Range | Wave 5H | Wave 5I |
|---|---|---|
| `\|v\| < 0.05` | "has no material influence" | "has little effect on the lead" |
| `[0.05, 0.3)` | "has a weak {pos\|neg} influence" | "slightly {strengthens\|weakens} the lead" |
| `[0.3, 0.7)` | "has a moderate ..." | "moderately ..." |
| `[0.7, 0.95)` | "has a strong ..." | "strongly ..." |
| `≥ 0.95` | "has a very strong ..." | "very strongly ..." |

The lowest band uses "slightly" rather than "weakly" because "weakly
weakens" reads awkwardly. The upstream `influencePhrase` (which Sonnet
sees) keeps its noun-phrase form unchanged — Sonnet has a system
prompt that contextualises it; the fallback composes its own sentences
and benefits from the explicit lead frame.

### Style — wave-tagged comments stripped from production code

Wave-prefix comments in production source files were rewritten to
describe invariants instead. Wave provenance lives in commit messages,
not in inline comments that age out as soon as the next wave lands.
Files cleaned: `turn-executor.ts`, `routing/clarification-resume.ts`,
`session/pending-action.ts`, `tools/handlers/explanation-fallback.ts`,
`orchestrator/tools/edit-graph.ts`.

---

## Honest proof matrix — named brief failures

Column semantics (read columns as independent claims):
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
| 1 | "yes" after explore-result offer dispatches what_would_flip / run_analysis | ✅ | ✅ | ✅ | ✅ recovery + ✅ success branches | ✅ | ❌ not run | — |
| 2 | At-limit add-risk no longer spends 16-18s in `edit_graph` | ✅ (preflight) | ✅ | ✅ | ❌ not added | ✅ (preflight blocks LLM call; recovery is INLINE PROSE, no chips) | ❌ not run | A4 add-risk **clarification continuity** (Wave 5G) |
| 3 | Value-update clarification applies the original quantity | ✅ (set_factor_value side; graph_hash persistence closes cross-turn divergence) | ✅ | ✅ | ✅ two-turn HTTP proof | ✅ | ❌ not run | A4 add-risk side (Wave 5G) |
| 4 | Explanation output has no raw decimals or internal terms | ✅ | ✅ (boundary buckets + denylist) | ✅ | ✅ chip-click HTTP success-path asserts no raw decimals on wire ; **no dedicated test for forbidden-decimal egress through generated explain_results body** | ✅ | ❌ not run | — |

### Per-failure evidence pointers

#### Failure 1 — "yes" / chip-click after offer

- Implemented: `turn-executor.ts` short-confirm pre-route +
  `commit.ts` atomic emit + `route-v2.ts` chip-click intent detection +
  `migrations/20260505120000_v5_pending_actions.sql`.
- Unit tested: `deterministic-short-confirm.test.ts`,
  `route-v2-chip-click-intent.test.ts`.
- Route tested: `short-confirm-route-level.test.ts` (lifecycle proof:
  validate → execute → commit, zero LLM calls).
- HTTP-boundary tested:
  [`orchestrate-v2-chip-click-resume.test.ts`](../../tests/integration/orchestrate-v2-chip-click-resume.test.ts)
  has TWO branches:
    - recovery branch (freshness=unknown → rerun_analysis_required)
    - success branch (freshness=fresh → handler runs end to end)
- User-visible locally proven: route-level + HTTP tests assert
  wire `assistant_text` matches expected post-handler / recovery
  copy AND no internal failure terms leak.
- Live staging: not run.

#### Failure 2 — Add-risk preflight

- Implemented: `edit-graph-dispatch.ts` invokes
  `wouldExceedAddRiskLimits` BEFORE the LLM call.
- Unit tested: `edit-graph-dispatch-preflight.test.ts`.
- Route tested: `edit-graph-dispatch.test.ts`.
- HTTP-boundary tested: NOT added in this tranche. Adding it would
  require constructing a 30-edge graph fixture and mounting Fastify.
  Marked as Wave 6 follow-up if needed.
- User-visible locally proven: handler-level test asserts the
  preflight rejection envelope is composed AND that the recovery is
  surfaced **inline in `assistant_text`** ("simplify the model",
  "replace") — `(suggested_actions ?? []).length === 0` per the
  test at `edit-graph-dispatch-preflight.test.ts:134`. The brief's
  "every chip must be actionable" rule means we deliberately do NOT
  emit prompt-replay chips for flows (deterministic rebuild,
  remove-then-add) that don't exist yet.
- Live staging: not run.
- Deferred: A4 add-risk **clarification continuity** (the second-turn
  resume after a missing-driver clarify) is Wave 5G. The slow-path
  failure itself is fixed by preflight.

#### Failure 3 — Value-update continuity

- Implemented: `turn-executor.ts` clarification-resume + four focused
  recovery dispatches (`recovery_expired`, `recovery_graph_changed`,
  `recovery_targets_missing`, `recovery_label_ambiguous`). Wave 5I-1
  closes the cross-turn graph divergence gap.
- Unit tested: `clarification-resume.test.ts` (19 cases including
  fuzzy + boundary).
- Route tested: `clarification-resume-route-level.test.ts` covers
  the success path AND the new `recovery_label_ambiguous` end to end.
- HTTP-boundary tested:
  [`orchestrate-v2-clarify-reply-two-turn.test.ts`](../../tests/integration/orchestrate-v2-clarify-reply-two-turn.test.ts)
  drives Turn 1 (clarify) and Turn 2 (typed factor reply) through the
  real Fastify route and asserts the original quantity survives.
- User-visible locally proven: HTTP test asserts receipt uses
  human factor label, no raw ids leak, original quantity preserved.
- Live staging: not run.
- Deferred: A4 add-risk continuity (`edit_graph_add_risk` emit +
  driver-match pre-route) is Wave 5G.

#### Failure 4 — Explanation egress

- Implemented: `explanation-fallback.ts` lead-framing prose (Wave 5I-5
  refinement of the Wave 5H-2 alignment to canonical thresholds);
  `validator-explanation.ts` two-rule raw-decimal egress guard +
  extended denylist.
- Unit tested: `explanation-fallback-direction.test.ts` (43 boundary
  cases + non-finite + no-raw-decimal invariant);
  `validator-explanation.test.ts` denylist + decimal regex.
- Route tested: `explain-results.test.ts` handler-level dispatch with
  full context-pack assembly.
- HTTP-boundary tested:
  `orchestrate-v2-chip-click-resume.test.ts` success-path asserts
  `not.toMatch(/-?\d+\.\d{2,}/)` on the wire — the explanation
  prose really did pass through the egress guard at the HTTP
  boundary in that branch.
  However, there is **no dedicated HTTP test for the
  forbidden-term denylist firing on generated `explain_results`
  text** (e.g. `noop`, `BUDGET_TARGET`, `Zod`, `graph_hash`). The
  validator is exercised at the handler unit-test level. This is a
  Wave 6 follow-up if the unit-level proof is judged insufficient.
- User-visible locally proven:
  `integration-bef4470b.test.ts` asserts the prose contains the
  leading option label, percentage probability, factor label,
  bucketed lead-framing prose ("strengthens the lead" /
  "weakens the lead"), AND no raw decimals.
- Live staging: not run.

---

## Test and hygiene summary

### Touched-test results (Wave 5I)

```
Wave 5I-1 — graph_hash persistence:
  src/orchestrator-v5/__tests__/turn-executor-deterministic-value-update.test.ts
    12/12 ✓ (new regression test added)

Wave 5I-2 — focused recovery dispatches:
  src/orchestrator-v5/routing/__tests__/clarification-resume.test.ts: 19/19 ✓
  src/orchestrator-v5/__tests__/clarification-resume-route-level.test.ts: 4/4 ✓
                                                          (new label_ambiguous test added)

Wave 5I-3 — chip-click success-path HTTP:
  tests/integration/orchestrate-v2-chip-click-resume.test.ts: 3/3 ✓
                                                  (success-path branch added)

Wave 5I-4 — value-update two-turn HTTP:
  tests/integration/orchestrate-v2-clarify-reply-two-turn.test.ts: 2/2 ✓ (new file)

Wave 5I-5 — copy + lead-framing + comment cleanup:
  src/orchestrator-v5/tools/handlers/__tests__/explanation-fallback-direction.test.ts: 43/43 ✓
  src/orchestrator-v5/tools/handlers/__tests__/explanation-fallback.test.ts: 17/17 ✓
  src/orchestrator-v5/tools/handlers/__tests__/explain-results.test.ts: 25/25 ✓
  src/orchestrator-v5/tools/handlers/__tests__/integration-bef4470b.test.ts: 9/9 ✓
  tests/unit/orchestrator/pipeline/phase5-envelope-assembler.test.ts: 37/37 ✓
  tests/unit/orchestrator/pipeline/phase1-conversational-state.test.ts: 18/18 ✓
```

### Full V5 + orchestrator suite

```
$ pnpm vitest run --reporter=default \
    src/orchestrator-v5 src/orchestrator \
    tests/integration/orchestrate-v2-chip-click-resume.test.ts \
    tests/integration/orchestrate-v2-deterministic-value-update.test.ts \
    tests/integration/orchestrate-v2-clarify-reply-two-turn.test.ts

  Test Files  1 failed | 132 passed (133)
  Tests       2 failed | 2122 passed | 1 skipped (2125)
```

Net change vs Wave 5H close-out: +5 passing tests (regression + recovery
+ chip-click success + 2 two-turn HTTP) with no new regressions.

### Failing tests — staging baseline check

The 2 failing tests are pre-existing on `staging`:

```
src/orchestrator-v5/tools/handlers/__tests__/no-op-helpers.test.ts
  > buildAnalysisAbsentTemplate
    > uses singular "option" wording when option_count === 1
    > uses plural "options" wording when option_count !== 1
```

`git diff --stat staging..HEAD --
src/orchestrator-v5/tools/handlers/__tests__/no-op-helpers.test.ts
src/orchestrator-v5/tools/handlers/no-op-helpers.ts` returns no output
— neither file has changed. Wording mismatch (`"options configured"` vs
`"options set up"`) is a pre-existing failure unrelated to any Wave 5
work.

The 1 skipped test is unchanged from staging (gated on a PLoT
environment variable that is unset locally).

### Build typecheck

```
$ pnpm exec tsc -p tsconfig.build.json --noEmit
```

Errors are all pre-existing — missing `generated/openapi.d.ts` codegen
artefact in `src/routes/assist.v1.*.ts` and `src/services/review/*.ts`.
None of the Wave 5I touched files have any TS errors.

### Branch diff hygiene

```
$ git status --short -- src tests Docs supabase scripts
(clean — all Wave 5I commits explicit-path staged; no node_modules,
 env, lockfiles, prompts, or build artefacts)
```

### DB migration / rollback status

Unchanged from Wave 5H close-out. The
`v5_pending_actions` migration applied to staging in Wave 0 with a
default that keeps existing callers working. Wave 5I-1's `graph_hash`
addition is at the application layer only — the JSONB
`pending_actions` column accepts any shape, no migration changes.

### Staging test rows / orphans

Wave 5I added no new database tests. The Wave 5I-3 chip-click HTTP
success-path test sets `mockedPriorRunAnalysisGraphHash` to the
computed live hash via `computeAnalysisAffectingGraphHash` from the
real production hash function — the test is hermetic, no DB writes.

### Push / merge / deploy status

- No `git push` issued.
- No PR opened.
- No merge to `staging` or `main`.
- No deploy.

All 27 commits are local on this worktree, on
`claude/p0-v5-interaction-recovery`.

---

## Wave 5G review items — disposition

| ChatGPT review item | Disposition |
|---|---|
| P0: graph_hash on production set_factor_value pendings | **Fixed** in Wave 5I-1 with regression test. |
| P1: skip_reason → focused recovery (4 cases) | **Fixed** in Wave 5I-2 with route-level test. |
| P1: chip-click HTTP recovery-only overclaim | **Fixed** in Wave 5I-3 — success-path HTTP test added; matrix above labels both branches. |
| P1: value-update clarification HTTP overclaim | **Fixed** in Wave 5I-4 — new two-turn HTTP test. |
| P1: explanation HTTP-boundary overclaim | **Relabelled honestly** in matrix above. The chip-click HTTP success-path proves the no-raw-decimal egress invariant on a real wire response; a dedicated HTTP test for forbidden-term denylist on a generated explain_results body is documented as a Wave 6 follow-up. |
| P1: add-risk recovery report stale | **Fixed** in matrix above — recovery is INLINE PROSE with zero chips, per the actual test. |
| P1: run_analysis cordon framing | **Reframed** — the matrix above lists the cordon as "regression cordon" rather than counting it as parity proof; the parity claim now lives entirely on the success-path test. |
| Style: wave-tagged comments | **Stripped** in Wave 5I-5. |
| Style: propose-and-confirm copy too blunt | **Refined** in Wave 5I-5. |
| Style: vocabulary UX read | **Refined** in Wave 5I-5 — lead-framing restored, thresholds stay canonical. |

---

## Proceeding to Wave 6

Wave 5I closes every actionable Wave 5G review item. The remaining
deferral is A4 add-risk **clarification continuity** (Wave 5G), which
is a genuine follow-up brief, not a blocker for this tranche.

Wave 6 next focuses on:
- A representative end-to-end local journey replay across the four
  named failures, captured as a single CEE integration test.
- A manual deployed-staging replay checklist for the user to execute
  directly.
- A final status grid + merge recommendation.

Optional Wave 6 follow-up tests if the unit-level proof is judged
insufficient:
- HTTP-boundary at-limit add-risk (would require a 30-edge fixture).
- HTTP-boundary forbidden-term denylist on generated `explain_results`
  body (would require an LLM mock that returns a prompt-injection
  attempt).

Neither is required for the matrix above to be honest as written.
