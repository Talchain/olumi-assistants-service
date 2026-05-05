# P0 V5 Golden-Path Integration Repair — Final Report

**Branch (both repos)**: `claude/p0-v5-golden-path-integration` from `staging`
**Status**: Local commits only. No push, no merge, no deploy.

This report uses a **four-state language** for every wave to distinguish what's actually delivered:

- **Implemented** — code exists in the branch.
- **Tested** — has unit tests pinning the behaviour.
- **Wired** — consumed by production runtime surfaces (route handlers, render path, bundle assembly).
- **Accepted** — meets the brief's user-facing acceptance criteria with rendered/HTTP-boundary evidence.

A wave is "delivered UX" only when it reaches **Accepted**. Earlier states ship infrastructure; they are not the same as a user-visible change.

## 1. Phase 0 findings

Investigation across both repos (CEE: `olumi-assistants-service`, UI: `DecisionGuideAI`) and the shared schema package `@talchain/schemas` v0.11.0 confirmed the failures listed in the brief. Eight root causes identified — all inside the orchestration glue, none requiring prompt rewrites, schema migrations, or PLoT/ISL changes. Plus one further regression discovered during the follow-up: `selected_elements` was missing from `V5_EXTENSION_FIELDS`, so the entire Wave 2 wire path returned 422 from any real client until that was fixed.

Confirmed non-issues (do NOT change):
- Response finaliser already stamps `analysis_ready` on every V5 turn (four-layer defence).
- `x-olumi-service-build` and `x-request-id` are already on outbound responses.
- Boundary schema is strict and complete — no schema bump.

## 2. Root causes confirmed

| # | Root cause | Fix wave | State |
|---|---|---|---|
| 1 | `explain_results` precondition looser than freshness derivation | Wave 1 | Accepted |
| 2 | Same predicate drift in chip-generator | Wave 1 | Accepted |
| 3 | `composeExplainResultsFallback` could produce text from null projection | Wave 1 | Accepted |
| 4 | Deterministic value-update did not consume UI selection | Wave 2 | Accepted |
| 4a | `selected_elements` missing from extension-strip allowlist (route 422'd) | Wave 2 follow-up | Accepted |
| 5 | UI did not surface CEE freshness coherently | Wave 3 | Accepted |
| 6 | UI fabrications mask missing PLoT data | Wave 4 | Accepted |
| 7 | Debug bundle had no scoped pipeline status | Wave 5 | Accepted |
| 8 | Golden-path coverage incomplete | Wave 6 + HTTP-boundary follow-up | Accepted |
| 9 | `TurnOutcome.graph_mutated` excluded `set_factor_value`/`add_constraint`/`adjust_edge_strength` | Follow-up | Accepted |

## 3. Wave-by-wave status

### Wave 1 — handler preconditions
- **Implemented**: combined success+currentness check on `explain_results` and `what_would_flip`; defensive null-projection guard; chip-generator predicate parity via `isSuccessfulRunAnalysisFact`; degraded/stale templates in `no-op-helpers.ts`.
- **Tested**: 121 tests across explain-results / what-would-flip / chip-generator / freshness; redaction tests assert no internal terms in recovery copy.
- **Wired**: `analysisFreshness` plumbed through `HandlerInvocation`; `routingFreshness` passed at handler-invocation site; `decideExplanationPrecondition` shared by both handlers (extracted in follow-up).
- **Accepted**: handlers refuse on missing/degraded/stale state with concrete recovery copy; verified by in-process acceptance suite + HTTP boundary tests.

### Wave 2 — deterministic value updates
- **Implemented**: Path A (selection narrowing for ambiguous label matches), Path B (deictic reference + selection), strict factor-only kind filter, staleness narrative on receipts.
- **Tested**: 33 dvu unit tests, 11 turn-executor wire-level tests, 4 receipt redaction tests, 5 request-extension parse tests, 3 HTTP-boundary integration tests.
- **Wired**: `selected_elements` extension parse; `route-v2-preflight` strip-list updated; `turn-executor` plumbing; receipt staleness narrative gated on prior successful analysis.
- **Accepted**: HTTP boundary test confirms "Update that factor to £30,000" with one selected factor → 200 with `set_factor_value` graph_patch, zero LLM calls, no `edit_graph` leak, receipt in user units. Same message with no/wrong selection → clarify, no mutation.

### Wave 3 — analysis-state coherence
- **Implemented**: `src/lib/analysisFreshnessState.ts` pure derivation with `useAnalysisFreshnessState` memoised hook.
- **Tested**: 17 selector tests + 3 wire-precedence tests on the consumer selector.
- **Wired**: `selectConversationStatus` (used by ActionStrip) accepts `wireFreshness` and gives it precedence over `graphEditedSinceLastRun`. ActionStrip threads `ceeAnalysisReady?.freshness` into the input bag.
- **Accepted**: when CEE returns `freshness=stale` on a complete result, ActionStrip status flips to `analysis_stale` regardless of the local edit signal; when CEE returns `freshness=fresh`, the surface shows `analysis_ready` even if the local signal lags.

### Wave 4 — UI result consumption
- **Implemented**: `useResultCompleteness` pure derivation + curated `freshnessReasons.ts` (freshness + completeness reason→copy table) + source-to-render trace doc at `docs/v5/wave-4-source-to-render-trace.md` confirming no mapping/hydration bugs.
- **Tested**: 20 derivation + curated-copy tests; 5 RTL tests for the wired surface; redaction asserts no internal codes reach the DOM.
- **Wired**: `useResultsSectionData` returns `completeness: ResultCompleteness` on its result type; `DecisionConfidencePanel` passes `data.completeness?.reasons` to `HeroQualifier`; `HeroQualifier` accepts `completenessReasons` and renders curated copy with precedence over the dimension-threshold qualifier.
- **Accepted**: HeroQualifier surfaces curated qualifier copy when source data is incomplete (e.g. all options lack `win_probability`, sensitivity values absent, decision review missing). Unknown reason codes route through a safe generic fallback; raw codes never reach the DOM. Existing dimension-threshold path preserved.

### Wave 5 — debug bundle authority
- **Implemented**: `derivePipelineStatus` pure function + scoped enum (six values) + recoverable-envelope category mapping.
- **Tested**: 18 derivation tests; 5 bundle-structure tests pinning enum values, absence-reason source, legacy-field preservation.
- **Wired**: `exportBundle` adapter `deriveBundlePipelineStatus` synthesises a RequestTrace shape from existing bundle data; bundle output now includes `pipeline.v5_pipeline_status` (the scoped enum) and `pipeline.v5_pipeline_status_source` (`derived_from_trace` / `cee_response_not_captured` / `no_cee_call_recorded`); legacy `pipeline.status` preserved for backwards compatibility.
- **Accepted**: bundle reports `proxy_or_network_failure` on 5xx (CANNOT be promoted to `ui_render_success` by a fresh wire signal — pinned by precedence test); explicit absence reasons distinguish "CEE never called" from "CEE called, response not captured" from "CEE called, response captured".

### Wave 6 — golden-path acceptance gate
- **Implemented**: in-process acceptance test (`tests/contract/v5-golden-path-acceptance.test.ts`); HTTP-boundary integration test (`tests/integration/orchestrate-v2-deterministic-value-update.test.ts`); forbidden-terms wordlist extension covering the brief's full redaction list.
- **Tested**: 10 in-process + 3 HTTP-boundary cases; the HTTP-boundary test caught a real regression (`selected_elements` extension-strip gap) that the in-process test couldn't reach.
- **Wired**: tests run in CI without staging credentials; the acceptance test asserts cross-wave product properties (handler preconditions, deterministic routing, no internal-term leakage).
- **Accepted**: the brief's hard acceptance gates are enforced as test failures: handler runs without prerequisites, value updates routed through `edit_graph` when they should be deterministic, internal-term leaks in user copy.

### Follow-up: shared `decideExplanationPrecondition` helper
- **Implemented + Tested + Wired + Accepted**: extracted to `no-op-helpers.ts`; both `explain_results` and `what_would_flip` consume the shared helper; 6 dedicated tests pin the predicate so future drift can't reintroduce.

### Follow-up: `TurnOutcome.graph_mutated` derivation
- **Implemented + Tested + Wired + Accepted**: flag now derives from `handlerOutcome.mutated_graph` presence, not a hand-maintained handler-id allowlist. `set_factor_value`, `add_constraint`, `adjust_edge_strength` now correctly report `graph_mutated=true`. End-to-end pinning in `turn-executor-deterministic-value-update.test.ts`.

## 4. Test totals after follow-up

- CEE orchestrator-v5 + contract + integration: **1901/1901 passing**.
- UI directly-touched test files all green: selectors (16), ActionStrip (8), HeroQualifier (19), useResultCompleteness + copy (20), useResultsSectionData + buildResultsVM (169), debug full suite (328), analysisFreshnessState (17), derivePipelineStatus (18). Totals: 615 passing across the wired surfaces.
- UI broader smoke run shows ~91 pre-existing baseline failures in unrelated files (verified by stash baseline check). These are out of scope.

## 5. Files changed by repo

### CEE (`olumi-assistants-service`) — 7 commits ahead of `staging`

| Commit | What |
|---|---|
| `9d3136ac` | Wave 1: handler preconditions |
| `814b9bb8` | Wave 2: deterministic value-update |
| `c2075068` | Wave 6: in-process acceptance gate + forbidden-terms |
| `3daab627` | Original final report |
| `21beb5aa` | Follow-up: graph_mutated fix + shared decideExplanationPrecondition |
| `1f9b0755` | Follow-up: HTTP-boundary integration test (caught the `selected_elements` strip-list regression) |
| (this commit) | Updated final report |

### UI (`DecisionGuideAI`) — 4 commits ahead of `staging`

| Commit | What |
|---|---|
| `ed31eddc` | Wave 3: analysis-freshness selector + hook |
| `7fc0ec24` | Wave 4: result-completeness selector + curated copy + trace doc |
| `fb45a4aa` | Wave 5: pipeline-status derivation |
| `9507d96a` | Follow-up: wire Wave 3-5 helpers into ActionStrip / HeroQualifier / DecisionConfidencePanel / useResultsSectionData / exportBundle |

## 6. Behaviour before vs after — summary

The waves now deliver real UX changes (Accepted state). Concrete examples:

- "Update that factor to £30,000" with one factor selected → previously fell through to LLM/clarify (or 422'd before this branch). Now: 200 with `set_factor_value` mutation, no LLM call, receipt in user units, prior analysis marked stale and re-run prompted.
- "Why did opt_1 win?" against a partial/failed analysis → previously produced a confident-looking explanation drawn from degraded data. Now: dedicated recovery template per state with a concrete next-step chip; no internal terms in copy.
- ActionStrip post-analysis status when CEE says stale but local edit signal hasn't fired yet → previously inconsistent across surfaces. Now: wire freshness wins; surface shows `analysis_stale` immediately.
- Results panel rendering with PLoT-incomplete data → previously rendered fabricated zeros silently. Now: HeroQualifier surfaces a curated qualifier line ("Likelihood scores aren't available, so we're comparing options by expected outcome.") explicitly, with the data-attribute trace `data-qualifier-source="completeness"`.
- Debug bundle on a 5xx turn → previously could report `pipeline.status: "success"` based on stale state. Now: `v5_pipeline_status` enum is `proxy_or_network_failure`, with `v5_pipeline_status_source` distinguishing capture state. Network failure cannot be promoted to success by any wire-level signal.

## 7. Performance observations

No new LLM calls on deterministic paths. No new network calls. Wave 5 derivation is O(1). Wave 4 completeness derivation is O(fields) per render, memoised. No latency regressions introduced.

## 8. Security / redaction observations

- All recovery copy across explanation handlers passes the forbidden-terms scan with zero matches.
- `set_factor_value` receipts use user units (`£30,000`), never normalised model-unit fractions (`0.x`). HTTP-boundary test asserts this on the wire response.
- Curated UI copy table tests assert no internal terms reach the DOM (`Zod`, `noop`, `patch`, `graph_hash`, raw IDs, `BUDGET_TARGET`, etc.).
- Debug payloads remain bounded — no large body stringification added.

## 9. CEE worktree state — full disclosure

The branch retains untracked files that pre-existed branching (none authored by this work). They are NOT committed and are NOT in the diff against `staging`. Listing for handoff transparency:

- `.claude/` (local Claude Code session state)
- `Docs/Remove Netlify Edge From Long-Running V5 Turn Path.md` (unrelated working doc)
- `tests/fixtures/cross-service/v5-turn.explain-fresh.staging.json` (fixture)
- `tools/edit-evaluator/` (separate evaluator subproject)
- `tools/graph-evaluator/fixtures/decision-review/06-flip-thresholds.json`, `07-full-new-fields.json`, `08-sparse-input.json`
- `tools/graph-evaluator/fixtures/repair-graph/`, `validate-graph/`, `zone2/`
- `tools/graph-evaluator/prompts/draft_graph_v193a.txt`
- `tools/graph-evaluator/src/repair-graph-scorer.ts`, `validate-graph-scorer.ts`
- `tools/v5-journey-replay/state-trust-verify.ts`

Stash entry preserved: `stash@{0}: On staging: p0-v5: park prompt expansion (out of scope for golden-path integration repair)`. The 291-line `data/prompts.json` change is NOT applied during this work and is NOT in any commit.

These are user files. They have NOT been modified or deleted. Recommend the user reviews / commits / stashes them as appropriate before push.

## 10. Known remaining risks / deferred items

- Live `tools/v5-journey-replay/` extension with new step coverage (selected-deictic value update, freshness-after-mutation). The HTTP-boundary integration test now covers the same single-turn properties without needing CEE_API_KEY. A multi-turn live replay covering the full 9-step journey is still useful and would land in a follow-up requiring staging credentials.
- UI broader smoke shows ~91 pre-existing baseline failures unrelated to this work. Documented as out of scope; CI is the authoritative gate.
- Categorical factor-state updates remain LLM-routed (no quantity → no_quantity gate). Schema doesn't support ordinal factor states with display values; addressing this would need a schema change.
- UI-SEM-005 / -006 / -016 / -041 / -044 robustness fabrications remain as display floors. Wave 4's completeness layer surfaces these states honestly without removing the floor; full removal is large blast radius and out of scope.

## 11. Whether safe to merge to staging

**Yes for the wired-and-accepted scope.** The branch now reaches the brief's user-facing acceptance criteria across all six waves plus the two follow-up corrections. Cross-wave acceptance is enforced by:

- 1901 CEE tests passing including the HTTP-boundary acceptance suite.
- 615 UI tests passing on directly-touched surfaces, with rendered behaviour pinned by RTL tests for HeroQualifier and consumer-selector tests for ActionStrip.

Pre-merge cleanup recommended (NOT done in this branch — these are user-owned decisions):
- Review the untracked files in section 9.
- Decide whether to apply / discard the `data/prompts.json` stash.
- Run the local Tier 3 full pre-push gate or rely on CI (per CLAUDE.md, CI is authoritative).

## 12. Confirmation

Local commits only. No `git push`. No merge to `main` or `staging`. No deploy. No prompt-stash reapply. No deletion of user untracked files.
