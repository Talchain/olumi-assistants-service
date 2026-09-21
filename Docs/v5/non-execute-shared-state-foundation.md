# Non-execute Shared State Foundation and Diagnostic

Lane scope: give **non-execute** turns the same deterministic, graph-authority-consistent
canonical-analysis-state foundation that execute turns received in PR #292, and expose it as a
**redacted diagnostic only**. This lane does **not** change user-visible behaviour, does **not** wire
any state into the prompt/PMS/chips/UI, and leaves the LLM consuming nothing new.

Base: `origin/staging` `8968a601` (PR #292). Branch: `claude/behavioural-activation-nonexecute`.

## What "non-execute" means here

A non-execute turn dispatches **no** mutation/run handler — clarify, converse / direct-answer,
deterministic coaching guards (stale-rerun, no-analysis, post-analysis-advice, fresh-followup,
run-comparison, state-query), recovery paths, and the explanation handlers (`explain_results`,
`what_would_flip`, `explain_from_structure`). Every such exit in `runTurnExecutor` returns via the
single `finalizeRun()` chokepoint, and finalises **before** the post-dispatch execute assembly that
sets `canonicalStateForRun` (`turn-executor.ts`, the `selectCanonicalAnalysisState({ handlerFacts:
handlerFactsForCommit, … })` site).

## State coverage — before vs after

| Exit family | Through `turn-executor`? | `result.canonicalState` before | After this lane |
|---|---|---|---|
| Mutation / run_analysis **execute** (post-dispatch) | yes | **FULL** (post-mutation graph authority) | unchanged |
| Deterministic coaching guards (stale-rerun, no-analysis, post-analysis-advice, fresh-followup, run-comparison, state-query) | yes (finalise before the execute assembly) | absent → route-v2 partial freshness-only fallback | **FULL** |
| Clarify / converse / proposal-dismissal / short-confirm + clarification-resume recovery | yes | absent → route fallback | **FULL** |
| Validation recovery / handler recovery / unsupported-action | yes | absent → route fallback | **FULL** |
| Explanation handlers (`explain_results`, `what_would_flip`, `explain_from_structure`) | yes | absent → route fallback | **FULL** |
| Route-only dispatch never entering `turn-executor` (chip-click deterministic dispatch, system-event, edit-graph recovery, frame-no-brief, no-live-proposal) | **no** | route fallback or none | **out of scope** — route's `canonicalStateFromFreshness` fallback unchanged |

Before this lane the route (`route-v2.ts`, the `contextSummaryEnabled` block) composed non-execute
`_context_summary` from `canonicalStateFromFreshness(ctx.freshness, { readiness: ctx.analysisReady })`.
That **mixed graph authorities**: `ctx.freshness` is derived from the persisted/canonical graph (H3
logic) while `ctx.analysisReady` is the **request-graph**-derived readiness — under client lag they
disagree. It also had no degraded-fact detection.

## The fix — `finalizeRun()` fallback assembly

`finalizeRun()` is the single chokepoint dominating every exit. When `canonicalStateForRun` is still
undefined there (i.e. a non-execute exit) and routing freshness has been derived, it assembles the
full canonical state from the **same** persisted/canonical graph authority the freshness hash used:

```ts
if (canonicalStateForRun === undefined && freshness !== null) {
  canonicalStateForRun = selectCanonicalAnalysisState({
    handlerFacts: [],                       // non-execute produced no current-turn facts
    priorFacts: context.prior_facts,
    readiness: deriveCanonicalReadiness(    // persisted authority, shared with the execute path
      canonicalReadinessGraphForRun, graphStateForTurn, analysisReadyForTurn),
    currentGraphHash: currentAnalysisGraphHashForTurn,
  });
}
```

`deriveCanonicalReadiness` is extracted from the execute path so both reason over one authority. The
route now prefers `ctx.canonicalState` for non-execute turns; the `canonicalStateFromFreshness`
fallback is reserved for the route-only dispatch paths above.

This is **read-only / diagnostic**: `analysisReadyForTurn` (wire/chips), dispatch and prose are
untouched. It is exposed solely via the existing flag-gated context-summary diagnostic.

## Coaching state pack (foundation for later, diagnostic-only now)

`summariseCoachingStatePack(state)` projects the canonical state to a redacted, **hash-free** pack
(`analysis_present`, `freshness`, `readiness_status`, `rerun_required`, `usable_for_prose`,
`usable_for_chips`, `blocked`, `actionable_blocker_count` — closed enums / booleans / counts only; no
hashes, indices, raw values, units, text, graph content or scientific claims). It surfaces as the
`coaching_state_pack` sub-block of `_context_summary`, **double-gated** by `contextSummaryEnabled` AND
the new default-off `coachingStatePackEnabled`. Named `coaching_state_pack` to stay disjoint from the
unrelated coaching-lifecycle `coaching_state` feature.

## Flag-state semantics (precise — NOT "nothing changes")

- **Both flags off (default):** wire body / user-visible behaviour is **byte-identical** to base.
  (`canonicalState` is assembled internally on non-execute turns, but it only ever feeds the
  default-off context-summary diagnostic, which itself is off.)
- **`contextSummaryEnabled` on, `coachingStatePackEnabled` off:** `_context_summary` is attached as
  today; for non-execute turns its `analysis_state` is now the **full** graph-authority-consistent
  verdict instead of the partial freshness-only fallback. No `coaching_state_pack`.
- **Both on:** `_context_summary` additionally carries the redacted `coaching_state_pack` for
  non-execute turns where state can be assembled.
- The LLM consumes none of this. It is diagnostic-only, never product behaviour.

## Codex-review correctness claims

1. **`handlerFacts: []` + `priorFacts` is honest.** A non-execute turn dispatched no handler, so it
   produced no current-turn analysis fact; `selectCanonicalAnalysisState` unifies
   `[...[], ...priorFacts] = priorFacts`, so the verdict reflects pre-existing persisted analysis
   without inventing a current-turn fact. Proven in
   `tests/contract/canonical-analysis-state.test.ts` ("non-execute assembly shape" describe),
   including `handlerFacts:[]+priorFacts:[f] === handlerFacts:[f]+priorFacts:[]`.
2. **`freshness !== null` distinguishes "no state yet" from "state unknown".** `freshness` is null
   ONLY before the routing-freshness derivation runs (the same point `currentAnalysisGraphHashForTurn`
   is computed), so an early exit (e.g. the graph-drift hard-fail) stays honestly absent. Once
   derived, `freshness` is non-null even when its verdict is `unknown` (e.g.
   `current_graph_hash_unavailable`), so "state unknown" still assembles an honest unknown verdict.
   No path fabricates freshness/readiness — both come from `deriveAnalysisFreshness` /
   `deriveCanonicalReadiness` over the real fact chain + hash.

## Deferred — true behavioural activation (separate, approved step)

Wiring the coaching pack into the LLM is **out of scope** and intentionally not built. The only LLM
injection point, `buildUserMessage` (`route-with-tool-use.ts`), **deliberately strips**
`ContextPack.analysis_state` under the documented **behaviour-10 leak contract** ("opaque graph-hash
digests … must never reach prose"). The next decision is **not** "wire coaching"; it is *"what
deterministic state may the LLM receive, and does that amend the leak boundary?"* — a design ruling
that must be taken explicitly. `coachingStatePackEnabled` is the reserved seam for that step.

## Also deferred — true chip/freshness convergence

Chips and the staleness prefix already read the same freshness primitives
(`deriveAnalysisFreshness` / `FreshnessDerivation`), and `chip-generator-canonical-convergence.test.ts`
already proves the chip floor can converge on the canonical verdict. This lane only **verifies**
non-divergence (the coaching pack mirrors the canonical predicates chips read); it changes no chip
behaviour. Making chips literally read `canonicalState.usableForChips` is a separate lane.
