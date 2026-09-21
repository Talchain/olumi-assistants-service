# V5 interaction recovery — Wave 5L final report

**Branch:** `claude/p0-v5-interaction-recovery`
**Base:** `staging` (`c8306047`)
**Date:** 2026-05-06
**Wave 5L commits:** `a38c2593`, `a63f8467`, `04850fe5` (and this report)
**Branch ahead of staging:** 37 commits (Wave 0 → Wave 5L)

This supersedes [`wave-5k-final-report.md`](wave-5k-final-report.md).
Wave 5K review found no new P0; the items it raised were classification
correctness, production-vs-test failure-mode design, and
chip-click ingress coverage. Wave 5L closes them.

---

## What Wave 5L changed

### Reclassify reserved kinds + TS-enforced classification (5L-1)

Two issues with the Wave 5K-2 classification:

1. `apply_proposed_change` and `edit_graph_add_risk` were classified
   as non-mutating. Both are semantically graph-mutating — the
   PendingAction docstring already notes they depend on `graph_hash`.
   Misclassifying as non-mutating means the day they wire up they
   would slip through the non-mutating branch and bypass the
   fail-closed divergence guard.

2. The classification regression only asserted "every kind appears
   in exactly one set". A future refactor that moved
   `set_factor_value` out of `mutating` by mistake would still pass
   the test.

Fix:

- Replace the two-set design (`MUTATING_KINDS`, `NON_MUTATING_KINDS`)
  with a `Record<PendingAction['action']['kind'], 'mutating' |
  'non_mutating'>` table. TypeScript enforces exhaustiveness at
  compile time.
- Reclassify both reserved kinds as `mutating`.
- `MUTATING_KINDS` is now derived from the classification table so
  the resumer's divergence-guard branch reads from a single source
  of truth.

Strengthened regression test:

- "Every kind has the expected safety classification (semantic
  regression)" — pins each kind to its expected value via a `Record<PendingActionKind, ...>`
  EXPECTED table. Moving `set_factor_value` out of `mutating` would
  flip this assertion even though the type still compiles.
- "Every kind in `RESUMABLE_ACTION_TYPES` is also classified" — the
  two sources of truth must stay aligned.
- "`PENDING_ACTION_KIND_SAFETY.mutating` is derived correctly from
  the table" — defends against a future refactor that re-introduces
  a manually-maintained set without updating the derivation.

Net: classification is BOTH compile-time exhaustive AND runtime
semantically pinned.

### Graceful production fallback for invariant violation (5L-2)

The Wave 5K-1 throw on null `reEmitGraphHash` was good for tests but
bad UX in production — a refactor that broke the resumer's gate
ordering would surface a 500 BoundaryError to the user instead of a
curated recovery.

Fix in `turn-executor.ts`: replace the throw with a logged graceful
degradation path. When `freshness?.current_graph_hash` is null at
the `recovery_label_ambiguous` branch:

- `log.error` with structured event `v5.invariant_violation` and
  `invariant: 'recovery_label_ambiguous_requires_live_graph_hash'`
  so the regression is loudly visible in observability.
- Emit `PendingActionSkipped` with reason
  `clarification_recovery_invariant_violation`.
- Degrade to `recovery_graph_changed` recovery (no chips, no
  re-persistence) — user sees calm copy instead of internal failure.

The route-level test cordon (Wave 5K-1) still asserts every
re-persisted pending carries a non-empty graph_hash. That guards the
production-emit case. The graceful fallback now guards the
future-refactor case.

### chip_click ingress variant of SEEDED HTTP test (5L-3)

The Wave 5J-1 SEEDED HTTP test posted Turn 2 as `source: composer`
with the factor label as the message — proving the resumer matches
a typed reply, but not the actual UI chip-click boundary for
recovery chips.

New companion test drives Turn 2 with `source: chip_click`. Same
graph, same seeded pendings, same ambiguous Turn 1 reply. Turn 2
omits the `chip` object (the recovery chips carry no `action_type`,
so a UI click on a label-only chip sends no chip object — the
boundary schema permits `chip: undefined`).

The chip-click ingress dispatches the same `set_factor_value`
mutation as the typed-equivalent reply, with the original quantity
(5) preserved. Both ingress shapes for the recovery path are now
HTTP-tested.

---

## Honest proof matrix — named brief failures

| # | Failure | Implemented | Unit tested | Route tested | HTTP-boundary tested | User-visible locally proven | Live staging proven | Deferred |
|---|---|---|---|---|---|---|---|---|
| 1 | "yes" after explore-result offer dispatches what_would_flip / run_analysis | ✅ | ✅ | ✅ | ✅ recovery + ✅ success branches | ✅ | ❌ not run | — |
| 2 | At-limit add-risk no longer spends 16-18s in `edit_graph` | ✅ (preflight) | ✅ | ✅ | ❌ not added | ✅ (preflight blocks LLM call; recovery is INLINE PROSE, no chips) | ❌ not run | A4 add-risk **clarification continuity** (Wave 5G) |
| 3 | Value-update clarification applies the original quantity | ✅ (set_factor_value side; graph_hash persistence + kind-gated divergence guard + ambiguous-recovery re-persistence + reEmitGraphHash graceful fallback + reserved-kind reclassification) | ✅ | ✅ | ✅ full HTTP proof for normal clarify→reply ; ✅ SEEDED HTTP proof for ambiguous-recovery → typed-equivalent reply ; ✅ SEEDED HTTP proof for ambiguous-recovery → **chip_click ingress** | ✅ | ❌ not run | A4 add-risk side (Wave 5G) |
| 4 | Explanation output has no raw decimals or internal terms | ✅ | ✅ (boundary buckets + denylist) | ✅ | ✅ HTTP deterministic explanation prose checked (chip-click success-path asserts no raw decimals on the wire) ; **generated forbidden-answer downgrade NOT HTTP-tested** | ✅ | ❌ not run | — |

### Per-failure evidence pointers (delta from Wave 5K)

#### Failure 3 — Value-update continuity

The HTTP-boundary cell for failure 3 now lists THREE distinct HTTP
proofs:

| Test | Source / drive | What it proves |
|---|---|---|
| `orchestrate-v2-deterministic-value-update.test.ts` | composer message, real value-update dispatch | Single-turn unambiguous match dispatches `set_factor_value`, no LLM call |
| `orchestrate-v2-clarify-reply-two-turn.test.ts` ("Turn 1 emits clarify chips… Turn 2 typed factor label dispatches…") | composer messages, real value-update dispatch on Turn 0 | Two-turn clarify → typed factor label applies original quantity |
| `orchestrate-v2-clarify-reply-two-turn.test.ts` ("SEEDED two-turn HTTP proof…") | composer message; pendings pre-seeded into mock | Ambiguous-recovery re-persists pendings; typed-equivalent reply applies original quantity |
| `orchestrate-v2-clarify-reply-two-turn.test.ts` ("SEEDED two-turn HTTP proof — chip_click ingress variant…") | **chip_click** message; pendings pre-seeded into mock | Same contract as above, but the apply turn is a real chip-click ingress (not a typed equivalent) |

Plus the kind-gated divergence guard (Wave 5J-2), the
`reEmitGraphHash` graceful fallback (Wave 5L-2), and the reserved-kind
reclassification (Wave 5L-1) close the legacy / missing-hash /
misclassified-kind paths the resumer would otherwise have applied
blindly.

---

## Test and hygiene summary

### Touched-test results (Wave 5L)

```
Wave 5L-1 — reclassify + TS-enforced classification:
  src/orchestrator-v5/routing/__tests__/clarification-resume.test.ts: 24/24 ✓
                                          (was 23/23; +1 net — replaced 2 weaker
                                           tests with 3 stronger ones)

Wave 5L-2 — graceful invariant fallback:
  src/orchestrator-v5/__tests__/clarification-resume-route-level.test.ts: 4/4 ✓
  tests/integration/orchestrate-v2-clarify-reply-two-turn.test.ts: 3/3 ✓ (then 4/4)

Wave 5L-3 — chip_click ingress variant:
  tests/integration/orchestrate-v2-clarify-reply-two-turn.test.ts: 4/4 ✓
                                                  (was 3/3)
```

### Full V5 + orchestrator suite

```
$ pnpm vitest run --reporter=default \
    src/orchestrator-v5 src/orchestrator \
    tests/integration/orchestrate-v2-chip-click-resume.test.ts \
    tests/integration/orchestrate-v2-deterministic-value-update.test.ts \
    tests/integration/orchestrate-v2-clarify-reply-two-turn.test.ts

  Test Files  1 failed | 132 passed (133)
  Tests       2 failed | 2129 passed | 1 skipped (2132)
```

Net change vs Wave 5K close-out: **+2** passing tests.

### Failing tests — staging baseline check

Unchanged — the 2 failures are the pre-existing `no-op-helpers.test.ts`
"options" wording mismatch on staging. The 1 skipped test is unchanged
(PLoT environment variable gate).

### Build typecheck

```
$ pnpm exec tsc -p tsconfig.build.json --noEmit
```

Errors are all pre-existing (`generated/openapi.d.ts` codegen
artefact). None of the Wave 5L touched files have TS errors.

### Branch diff hygiene

```
$ git status --short -- src tests Docs supabase scripts
(clean — Wave 5L commits explicit-path staged; no node_modules,
 env, lockfiles, prompts, or build artefacts)
```

### DB migration / rollback status

Unchanged from Wave 5H close-out. No schema changes.

### Push / merge / deploy status

- No `git push` issued.
- No PR opened.
- No merge to `staging` or `main`.
- No deploy.

All 37 commits are local on this worktree.

---

## Wave 5K review items — disposition

| ChatGPT review item | Disposition |
|---|---|
| P1: `apply_proposed_change` and `edit_graph_add_risk` classified as non-mutating | **Fixed** in Wave 5L-1 — both reclassified to `mutating`, classification table is now `Record<PendingActionKind, ...>` so adding a kind without classifying it is a TypeScript error |
| P1: classification regression doesn't assert expected semantics | **Fixed** in Wave 5L-1 — per-kind EXPECTED table pins each kind to its semantic classification; classification flip fails the test even when the type compiles |
| P1: re-emit invariant throw becomes internal failure in production | **Fixed** in Wave 5L-2 — replaced with logged + telemetried graceful fallback to `recovery_graph_changed`; route-level cordon still asserts every re-persisted pending carries graph_hash |
| P1: "chip-equivalent" reply is not actual chip_click ingress | **Fixed** in Wave 5L-3 — added `source: chip_click` companion test that drives the recovery → apply path through real chip-click ingress |
| Improvements: keep Wave 5K | ✅ |
| Improvements: classification semantics | **Done** in Wave 5L-1 |
| Improvements: A4 add-risk continuity stays deferred | ✅ already labelled |

---

## Proceeding to Wave 6

Wave 5L closes every actionable Wave 5K review item. The remaining
deferral is A4 add-risk **clarification continuity** (Wave 5G), a
genuine follow-up brief.

Wave 6 next:
- A representative end-to-end local journey replay across the four
  named failures, captured as a single CEE integration test.
- A manual deployed-staging replay checklist.
- A final status grid + merge recommendation.

Optional Wave 6 follow-up tests if the unit-level proof is judged
insufficient:
- HTTP-boundary at-limit add-risk (would require a 30-edge fixture).
- HTTP-boundary forbidden-term denylist on generated `explain_results`
  body (would require an LLM mock returning a tool_use with
  forbidden `answer_text`).
- Structured global audit of assistant_text emit paths for em dash
  / brief-rule compliance.

None is required for the matrix above to be honest as written.
