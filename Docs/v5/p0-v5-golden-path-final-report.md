# P0 V5 Golden-Path Integration Repair — Final Report

**Branch (both repos)**: `claude/p0-v5-golden-path-integration` from `staging`
**Status**: Local commits only. No push, no merge, no deploy.

This report uses the **five-state language** introduced after the second-round review:

- **Implemented** — code exists in the branch.
- **Tested (unit)** — unit/derivation tests pin the behaviour in isolation.
- **Runtime wired** — consumed by production runtime surfaces (route handlers, render path, bundle assembly), with file paths.
- **End-to-end proven** — has rendered (RTL) or HTTP-boundary evidence that the user-facing behaviour reaches the DOM or the wire.
- **Accepted** — meets the brief's user-facing acceptance criteria across all required surfaces.

Acceptance is the strictest cell. "Runtime wired" alone is NOT acceptance.

The third-round review surfaced four real bugs in the previous round's fixes plus several scoping issues. Each is now addressed and pinned by a regression test. The recurring failure mode (test/wiring change makes the test pass without proving the underlying property) is now blocked by the strict tests added in the third round.

## 1. Phase 0 findings — 13 confirmed root causes

| # | Discovered in | Cause |
|---|---|---|
| 1–8 | Phase 0 | Handler precondition drift, deterministic value-update gap, surface-disagreement on freshness, fabrication masking, debug-bundle global-success, harness gap. |
| 9 | First follow-up | `selected_elements` missing from `V5_EXTENSION_FIELDS` — Wave 2 wire path returned 422 from any real client. |
| 10 | First follow-up | `TurnOutcome.graph_mutated` excluded `set_factor_value`/`add_constraint`/`adjust_edge_strength`. |
| 11 | Second follow-up | `deriveBundlePipelineStatus` read `data.ceeAnalysisReady` (doesn't exist on `DebugData`). |
| 12 | Second follow-up | Analysis-turn detection used `data.services.plot != null` heuristic — misclassified non-analysis turns. |
| 13 | Second follow-up | `data-qualifier-reason` DOM attribute leaked raw reason codes. |
| 14 | Third follow-up | `derivePipelineStatus` fell through to `ui_render_success` when `isAnalysisTurn=true` and `ceeAnalysisReady=null` (the `readyStatus !== undefined && readyStatus !== 'ready'` check evaluated `undefined !== undefined` = false). |
| 15 | Third follow-up | Bundle adapter ignored `cee_downstream_request/response` — orchestrator flows where CEE is nested under PLoT could emit a payload while status reported `no_cee_call_recorded`. |
| 16 | Third follow-up | Stateful test seeded a pre-baked stale fact and sent ONE request — proved nothing about the mutation actually driving staleness. Replaced with a real 3-turn replay. |

## 2. Wave 3 (analysis-state coherence) — separate table per surface

The brief required four UI surfaces to consume a single freshness selector. Honest per-surface accounting:

| Surface | File | Wired | Tested | End-to-end |
|---|---|---|---|---|
| Chat composer / ActionStrip | `src/canvas/conversation/ActionStrip.tsx` via `selectConversationStatus` | ✅ | ✅ 16 selector tests + 3 wire-precedence tests | ✅ ActionStrip RTL 8/8 |
| Results header / Hero (DecisionConfidencePanel + HeroQualifier) | `src/components/results/DecisionConfidencePanel.tsx` calls `useAnalysisFreshnessState()` and passes `freshness`/`freshnessReason` to HeroQualifier | ✅ | ✅ 6 freshness-precedence RTL tests | ✅ stale wins over completeness over dimensions; reason codes redacted from DOM |
| Pre-analysis panel | `src/canvas/components/pre-analysis/*` | ❌ NOT wired (deferred) | n/a | n/a |
| Debug overlay UI surface | `src/canvas/DiagnosticsOverlay.tsx` (the **debug bundle export** uses Wave 5 derivation; the overlay UI does not) | ❌ NOT wired (deferred) | n/a | n/a |

Wave 3 acceptance: **half-met**. Two of four surfaces deliver freshness UX; two are tracked as deferred work in section 9.

## 3. Wave 4 (UI result consumption / completeness) — separate table per surface

| Surface | Wired | Tested | End-to-end |
|---|---|---|---|
| HeroQualifier (within DecisionConfidencePanel) | ✅ via `data.completeness?.reasons` | ✅ 7 RTL tests on isolated component + 5 integrated RTL tests | ✅ partial / failed source fixtures render curated qualifier + recommended option together |
| ResultsBody fallback panels | ❌ NOT wired (no separate panel-level fallback shipped) | n/a | n/a |
| Other panels in the results section | reach DecisionConfidencePanel indirectly via shared `useResultsSectionData` return type | implicit | not asserted |

Wave 4 acceptance: **scoped to HeroQualifier / DecisionConfidencePanel**. Per third-round review, no separate fallback/coaching panel behaviour beyond the hero qualifier is wired or asserted; that scope is honest about what ships.

## 4. Wave-by-wave status (other waves)

### Wave 1 — handler preconditions

| State | Evidence |
|---|---|
| Implemented | `tools/handlers/explain-results.ts`, `what-would-flip.ts`; shared `decideExplanationPrecondition` in `no-op-helpers.ts`; chip-generator parity. |
| Tested (unit) | 121 tests; redaction asserted. |
| Runtime wired | `analysisFreshness` plumbed through `HandlerInvocation`. |
| End-to-end proven | In-process acceptance suite + HTTP-boundary tests across missing/degraded/stale state. |
| Accepted | ✅ |

### Wave 2 — deterministic value updates

| State | Evidence |
|---|---|
| Implemented | Path A (selection narrowing), Path B (deictic), strict factor-only filter, staleness narrative. |
| Tested (unit) | 33 dvu + 11 turn-executor + 4 receipt redaction + 5 extension parse. |
| Runtime wired | `selected_elements` extension parse + strip-list; turn-executor plumbing; receipt staleness narrative. |
| End-to-end proven | 7 HTTP-boundary tests including **real 3-turn replay** (turn 1: synthetic prior at live hash → `freshness=fresh`; turn 2: `set_factor_value` mutation → response carries `freshness=stale` — proving the mutation drives staleness, not test setup). |
| Accepted | ✅ |

### Wave 5 — debug bundle authority

| State | Evidence |
|---|---|
| Implemented | `derivePipelineStatus` pure function; six-state enum; structured `v5_pipeline_status_source`. |
| Tested (unit) | 21 derivation tests (was 18, +3 for missing analysis_ready); 21 bundle-structure tests (was 11, +10 across rounds). |
| Runtime wired | `exportBundle` consumes `deriveBundlePipelineStatusV2` with effective payload normalisation (direct + downstream); `DebugBundle.pipeline` type now declares `v5_pipeline_status` + structured source. |
| End-to-end proven | Bundle tests pin: `analysis_failed` on envelope status `needs_user_input`; `analysis_not_run` on missing analysis_ready; `proxy_or_network_failure` on 5xx (cannot be promoted by wire signal); `derived_from_downstream` capture for orchestrator flows; direct precedence over downstream. |
| Accepted | ✅ |

### Wave 6 — golden-path acceptance gate

| State | Evidence |
|---|---|
| Implemented | In-process acceptance suite + HTTP-boundary integration test + forbidden-terms wordlist. |
| Tested | 10 in-process + 7 HTTP-boundary (including 3-turn replay). |
| Runtime wired | Tests run in CI without staging credentials. |
| End-to-end proven | HTTP-boundary tests caught real regressions during the work: `selected_elements` strip-list gap, `pipeline-status` envelope wiring, downstream-CEE handling, fall-through to `ui_render_success`. Multi-turn test pins stale-after-mutation freshness on the wire. |
| Accepted | ✅ |

### Follow-up corrections

| Item | Round | State |
|---|---|---|
| Shared `decideExplanationPrecondition` helper | 1st | ✅ |
| `TurnOutcome.graph_mutated` derivation | 1st | ✅ |
| HTTP-boundary integration test | 1st | ✅ |
| exportBundle envelope wiring | 2nd | ✅ |
| Analysis-turn signal | 2nd | ✅ |
| Structured source field | 2nd | ✅ |
| DOM attribute redaction | 2nd | ✅ |
| Integrated RTL test | 2nd | ✅ |
| `derivePipelineStatus` `isAnalysisTurn + null` branch | 3rd | ✅ |
| Effective downstream CEE payloads | 3rd | ✅ |
| Real 3-turn replay (mutation drives staleness) | 3rd | ✅ |
| HeroQualifier freshness wiring | 3rd | ✅ |
| `DebugBundle.pipeline` type extension | 3rd | ✅ |
| Negative freshness test rewrite (real `fresh`) | 3rd | ✅ |

## 5. Test totals (post third-round)

- **CEE**: 1906/1906 passing on relevant suites (1898 baseline + 8 boundary including 3-turn replay).
- **UI directly-touched test directories**: 1978/1978 across `src/components/results/__tests__/`, `src/lib/__tests__/`, `src/components/debug/__tests__/`, plus selectors and ActionStrip.
- Pre-existing UI baseline failures in unrelated files remain out of scope (verified by stash baseline check).

## 6. Files changed by repo

### CEE (`olumi-assistants-service`) — 11 commits ahead of `staging`

| Commit | Round / scope |
|---|---|
| `9d3136ac` | Wave 1: handler preconditions |
| `814b9bb8` | Wave 2: deterministic value-update |
| `c2075068` | Wave 6: in-process acceptance gate |
| `3daab627` | Original final report |
| `21beb5aa` | 1st follow-up: graph_mutated + shared decideExplanationPrecondition |
| `1f9b0755` | 1st follow-up: HTTP-boundary integration test |
| `e02fb298` | 1st follow-up: rewritten report (four-state) |
| `f316ec9f` | 2nd follow-up: stateful multi-turn HTTP test |
| `08a608b7` | 2nd follow-up: rewritten report (five-state, per-surface) |
| `1d3c9dbb` | 3rd follow-up: real 3-turn HTTP replay |
| (this commit) | 3rd follow-up: rewritten report (Wave 3/4 split) |

### UI (`DecisionGuideAI`) — 6 commits ahead of `staging`

| Commit | Round / scope |
|---|---|
| `ed31eddc` | Wave 3 selector + hook |
| `7fc0ec24` | Wave 4 selector + curated copy + trace doc |
| `fb45a4aa` | Wave 5 pipeline-status derivation |
| `9507d96a` | 1st follow-up: wire Wave 3-5 helpers into ActionStrip / HeroQualifier / exportBundle |
| `1006076f` | 2nd follow-up: envelope wiring + attribute redaction + integrated RTL |
| `d9ac39ae` | 3rd follow-up: pipeline-status tightening + downstream CEE fallback + Wave 3 freshness wiring + DebugBundle type |

## 7. Behaviour before vs after — concrete examples

| Path | Before | After |
|---|---|---|
| "Update that factor to £30,000" + one factor selected | LLM/clarify, or 422 from any real client (until `selected_elements` strip fix) | 200 + `set_factor_value` + zero LLM + receipt in user units + freshness goes stale + re-run prompt |
| "Why did opt_1 win?" against partial/failed analysis | Confident-looking explanation from degraded data | Dedicated recovery template; concrete next-step chip; no internal terms |
| ActionStrip when CEE says stale | Inconsistent with local edit signal | Wire freshness wins; surface flips to `analysis_stale` immediately |
| Results panel with PLoT-incomplete data | Fabricated zeros rendered as truth | HeroQualifier surfaces curated qualifier (`data-qualifier-source="completeness"`); recommended option still renders alongside; raw codes never in DOM |
| Results panel when CEE freshness=stale | No qualifier from freshness | HeroQualifier surfaces curated stale copy (`data-qualifier-source="freshness"`); takes precedence over completeness |
| Debug bundle on 5xx | Could report `pipeline.status: "success"` | `v5_pipeline_status: "proxy_or_network_failure"`; structured `v5_pipeline_status_source` records `capture`, `missing_inputs[]`, `is_analysis_turn_signal` |
| Debug bundle on 200 + analysis_ready=needs_user_input | Could report `ui_render_success` (envelope ignored) | `analysis_failed` — envelope wins over HTTP success |
| Debug bundle on analysis turn with no analysis_ready | `ui_render_success` (fall-through bug) | `analysis_not_run` |
| Debug bundle on orchestrator flow with downstream CEE | `no_cee_call_recorded` (only direct read) | `derived_from_downstream` capture; verdict reflects downstream envelope |
| Real multi-turn: mutation → next freshness | No HTTP-boundary proof | Turn 1 → `freshness=fresh` (live hash matches prior); turn 2 (mutation) → `freshness=stale` (post-handler re-derivation flips on hash divergence) |

## 8. CEE worktree state

Unchanged from previous report. Two pre-existing classes of dirtiness:

- **Tracked node_modules** (4360 files; ~739 dirty entries from pnpm-install drift). NOT caused by this branch. Fixing requires `git rm --cached -r node_modules` + repo-level decision — needs explicit user authorisation, NOT done.
- **Untracked files** (`.claude/`, ad-hoc Docs, `tools/edit-evaluator/`, etc.). NOT in any commit. NOT modified by this work.

Stash entry preserved: `stash@{0}` carrying the 291-line `data/prompts.json` change. NOT applied.

## 9. Known remaining risks / deferred items

- **Wave 3 pre-analysis panel + DiagnosticsOverlay UI surface** — NOT wired. ActionStrip + HeroQualifier ship; pre-analysis and DiagnosticsOverlay still derive freshness locally. Tracked as deferred.
- **Wave 4 separate fallback/coaching panel** — NOT shipped beyond HeroQualifier. Acceptance scoped to the hero path; broader panel-level fallback deferred.
- **Tracked node_modules corruption** — pre-existing repo hygiene issue. Needs user authorisation.
- **Live `tools/v5-journey-replay/` extension** — single-turn HTTP coverage now exists; 3-turn replay implemented in-process. Live multi-turn against staging needs `CEE_API_KEY`.
- **Browser-level Playwright** — not part of the local Tier-1 gate per CLAUDE.md. The integrated RTL test at `DecisionConfidencePanel.completenessIntegration.spec.tsx` is the highest-level UI test that ships.
- **Categorical factor-state updates** — remain LLM-routed; schema change required.
- **UI-SEM fabrications** — remain as display floors; Wave 4 surfaces partial completeness honestly without removing the floor.

## 10. Whether safe to merge to staging

**Conditional yes**, with explicit caveats:

- All **Accepted** rows have rendered or HTTP-boundary evidence with strict tests covering the precedence properties and absence reasons.
- **Wave 3 acceptance is half-met** (two of four surfaces). The other two are explicitly tracked as deferred — not claimed accepted.
- **Wave 4 acceptance is scoped** to the HeroQualifier / DecisionConfidencePanel path; broader panel fallbacks not shipped.
- **Tracked node_modules corruption** needs deciding by the user before push.

The brief's user-facing acceptance for Waves 1, 2, 5, 6 is fully met. Waves 3 and 4 are met within the scopes enumerated in their per-surface tables and deferrals listed honestly.

## 11. Confirmation

- Local commits only.
- No `git push`. No merge to `main` or `staging`. No deploy.
- No prompt-stash reapply.
- No deletion of user untracked files.
- No modification of `node_modules` tracked or untracked state.
