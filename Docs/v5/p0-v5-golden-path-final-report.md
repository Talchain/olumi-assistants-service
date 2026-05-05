# P0 V5 Golden-Path Integration Repair — Final Report

**Branch (both repos)**: `claude/p0-v5-golden-path-integration` from `staging`
**Status**: Local commits only. No push, no merge, no deploy.

This report uses a **five-state language** for every wave to distinguish what's actually delivered. The previous round's four-state language (Implemented / Tested / Wired / Accepted) was correctly criticised for letting "Accepted" slip when only one consumer was wired or only a happy-path test was added. The split is now stricter:

- **Implemented** — code exists in the branch.
- **Tested (unit)** — unit/derivation tests pin the behaviour in isolation.
- **Runtime wired** — consumed by production runtime surfaces (route handlers, render path, bundle assembly). One or more consumers, identified by file path.
- **End-to-end proven** — has rendered (RTL) or HTTP-boundary evidence that the user-facing behaviour reaches the DOM or the wire.
- **Accepted** — meets the brief's user-facing acceptance criteria. Only when "End-to-end proven" applies to all required surfaces.

A wave is "delivered UX" only at **Accepted**. "Runtime wired" alone does NOT mean delivered.

## 1. Phase 0 findings

Eight original root causes plus four follow-up corrections discovered during review:

| # | Discovered in | Cause |
|---|---|---|
| 1–8 | Phase 0 | Handler precondition drift, deterministic value-update gap, surface-disagreement on freshness, fabrication masking, debug-bundle global-success, harness gap. |
| 9 | First follow-up | `selected_elements` missing from `V5_EXTENSION_FIELDS` — Wave 2 wire path returned 422 from any real client. |
| 10 | First follow-up | `TurnOutcome.graph_mutated` excluded `set_factor_value`/`add_constraint`/`adjust_edge_strength`. |
| 11 | Second follow-up | `deriveBundlePipelineStatus` read `data.ceeAnalysisReady` (doesn't exist on `DebugData`) — failing envelope analysis_ready could fall through to `ui_render_success`. |
| 12 | Second follow-up | Analysis-turn detection used `data.services.plot != null` heuristic — misclassified non-analysis turns that touched PLoT. |
| 13 | Second follow-up | `data-qualifier-reason` DOM attribute leaked raw reason codes — strict redaction rule covers attributes too. |

## 2. Wave-by-wave status

### Wave 1 — handler preconditions

| State | Evidence |
|---|---|
| Implemented | `tools/handlers/explain-results.ts`, `what-would-flip.ts`, shared `decideExplanationPrecondition` in `no-op-helpers.ts`, chip-generator parity via `isSuccessfulRunAnalysisFact`. |
| Tested (unit) | 121 tests across explain-results / what-would-flip / chip-generator / freshness / shared helper. Redaction tests assert no internal terms in recovery copy. |
| Runtime wired | `analysisFreshness` plumbed through `HandlerInvocation`; `routingFreshness` passed at handler-invocation site (`turn-executor.ts`). |
| End-to-end proven | In-process acceptance suite (`tests/contract/v5-golden-path-acceptance.test.ts`) exercises real handlers across missing/degraded/stale state. |
| Accepted | ✅ |

### Wave 2 — deterministic value updates

| State | Evidence |
|---|---|
| Implemented | `routing/deterministic-value-update.ts` (Path A + Path B), strict factor-only filter, staleness narrative on receipts. |
| Tested (unit) | 33 dvu unit tests, 11 turn-executor wire-level tests, 4 receipt redaction tests, 5 request-extension parse tests. |
| Runtime wired | `selected_elements` extension parse; `route-v2-preflight` strip-list updated (caught by HTTP-boundary test); `turn-executor` plumbing; receipt staleness narrative gated on prior successful analysis. |
| End-to-end proven | `tests/integration/orchestrate-v2-deterministic-value-update.test.ts`: 5 tests including stateful multi-turn stale-after-mutation freshness. Confirms 200 + `set_factor_value` graph_patch + zero LLM calls + receipt in user units; freshness goes stale on subsequent turn after mutation. |
| Accepted | ✅ |

### Wave 3 — analysis-state coherence

| State | Evidence |
|---|---|
| Implemented | `src/lib/analysisFreshnessState.ts` pure derivation; `useAnalysisFreshnessState` memoised hook. |
| Tested (unit) | 17 selector tests + 3 wire-precedence tests on the consumer selector (`selectors.test.ts`). |
| Runtime wired | **One consumer wired**: `selectConversationStatus` (used by `ActionStrip`) reads `wireFreshness` and gives it precedence over `graphEditedSinceLastRun`. Files: `src/canvas/conversation/selectors.ts`, `src/canvas/conversation/ActionStrip.tsx`. |
| End-to-end proven | Selector-level wire-precedence asserted; ActionStrip 8/8 RTL tests pass with the wiring. |
| Accepted | ⚠️ **Partially accepted**: chat surface (ActionStrip) is delivered; pre-analysis panel and DiagnosticsOverlay are NOT wired in this branch and are tracked as **deferred**. The original brief required all four surfaces; only one ship in this branch. **Do not interpret this row as full Wave 3 acceptance.** |

### Wave 4 — UI result consumption

| State | Evidence |
|---|---|
| Implemented | `useResultCompleteness` pure derivation; curated `freshnessReasons.ts`; source-to-render trace doc at `docs/v5/wave-4-source-to-render-trace.md` confirming no mapping/hydration bugs. |
| Tested (unit) | 20 derivation + curated-copy tests; 20 RTL tests for HeroQualifier in isolation including 5 RTL component tests on the wired surface; redaction asserts no internal codes reach the DOM (text or attributes). |
| Runtime wired | `useResultsSectionData` returns `completeness` on its result type. `DecisionConfidencePanel` passes `data.completeness?.reasons` to `HeroQualifier`. `HeroQualifier` accepts `completenessReasons` and renders curated copy with precedence over the dimension-threshold qualifier. Files: `src/components/results/{useResultsSectionData,DecisionConfidencePanel,HeroQualifier}.tsx`, `src/components/results/copy/freshnessReasons.ts`. |
| End-to-end proven | **Integrated RTL test** at `src/components/results/__tests__/DecisionConfidencePanel.completenessIntegration.spec.tsx` mounts `DecisionConfidencePanel` with realistic full / partial (win_probability missing) / partial (sensitivity missing) / partial (decision review unavailable) fixture data. Asserts: curated qualifier copy renders, recommended option still renders alongside, no internal terms in DOM (text or attributes). 5/5 passing. |
| Accepted | ✅ for `DecisionConfidencePanel` consumer surface. **Other ResultsBody panels remain unverified** (use the same hook return so should propagate, but no rendered evidence ships). |

### Wave 5 — debug bundle authority

| State | Evidence |
|---|---|
| Implemented | `derivePipelineStatus` pure function; scoped enum (six values); recoverable-envelope category mapping. |
| Tested (unit) | 18 derivation tests; 17 bundle-structure tests (was 11; +6 envelope/turn-signal). |
| Runtime wired | `exportBundle` consumes `deriveBundlePipelineStatusV2` with the EXTRACTED `envelopeAnalysisReady` (corrected from the original wiring which read a non-existent field). Bundle output includes `pipeline.v5_pipeline_status` and structured `pipeline.v5_pipeline_status_source` (`{capture, is_analysis_turn, is_analysis_turn_signal, envelope_analysis_ready_status, envelope_freshness, envelope_freshness_reason, missing_inputs[]}`); legacy `pipeline.status` preserved. Analysis-turn detection now derives from the envelope, not from PLoT presence. |
| End-to-end proven | Bundle-structure tests pin: 200 + analysis_ready=ready → `ui_render_success`; 5xx → `proxy_or_network_failure` (cannot be promoted by wire signal); analysis_ready.status=needs_user_input on 200 → `analysis_failed` (envelope wins over HTTP success); analysis_inputs in request → `analysis_inputs_present` signal; PLoT-only-no-analysis_ready → `no_analysis_signal` (heuristic dropped); missing_inputs list surfaces specific absent fields. |
| Accepted | ✅ |

### Wave 6 — golden-path acceptance gate

| State | Evidence |
|---|---|
| Implemented | In-process acceptance suite + HTTP-boundary integration test + forbidden-terms wordlist. |
| Tested (unit) | 10 in-process + 5 HTTP-boundary cases (3 single-turn, 2 stateful multi-turn). |
| Runtime wired | Tests run in CI without staging credentials. |
| End-to-end proven | HTTP-boundary tests caught two real regressions during this work: (i) `selected_elements` missing from extension-strip; (ii) the value-update path returning 422 from any real client. Stateful test pins stale-after-mutation freshness on the wire. |
| Accepted | ✅ |

### Follow-up corrections

All accepted: shared `decideExplanationPrecondition` helper; `TurnOutcome.graph_mutated` derivation; exportBundle envelope wiring; analysis-turn signal; structured source field; DOM attribute redaction; integrated RTL test.

## 3. Test totals (post second-round follow-up)

- **CEE**: 1901 baseline + 5 multi-turn HTTP boundary = 1906/1906 passing on relevant suites.
- **UI directly-touched test files**:
  - selectors: 16/16
  - ActionStrip: 8/8
  - HeroQualifier: 20/20
  - useResultCompleteness + copy: 20/20
  - useResultsSectionData + buildResultsVM: 169/169
  - debug full suite: 328/328 (includes 17 exportBundle.structure tests, was 11)
  - DecisionConfidencePanel.completenessIntegration: 5/5 (new integrated RTL)
  - analysisFreshnessState: 17/17
  - derivePipelineStatus: 18/18
- UI broader smoke shows ~91 pre-existing baseline failures in unrelated files (verified by stash baseline check). Out of scope.

## 4. Files changed by repo

### CEE (`olumi-assistants-service`) — 9 commits ahead of `staging`

| Commit | Wave / scope |
|---|---|
| `9d3136ac` | Wave 1: handler preconditions |
| `814b9bb8` | Wave 2: deterministic value-update |
| `c2075068` | Wave 6: in-process acceptance gate |
| `3daab627` | Original final report |
| `21beb5aa` | Follow-up: graph_mutated + shared decideExplanationPrecondition |
| `1f9b0755` | Follow-up: HTTP-boundary integration test |
| `e02fb298` | Follow-up: rewritten final report (four-state) |
| `f316ec9f` | Second follow-up: stateful multi-turn HTTP test |
| (this commit) | Second follow-up: rewritten report (five-state) |

### UI (`DecisionGuideAI`) — 5 commits ahead of `staging`

| Commit | Wave / scope |
|---|---|
| `ed31eddc` | Wave 3 selector + hook |
| `7fc0ec24` | Wave 4 selector + curated copy + trace doc |
| `fb45a4aa` | Wave 5 pipeline-status derivation |
| `9507d96a` | First follow-up: wire Wave 3-5 helpers into ActionStrip / HeroQualifier / exportBundle |
| `1006076f` | Second follow-up: envelope wiring + attribute redaction + integrated RTL |

## 5. Per-surface wiring status (P0.1 enumeration)

The original Wave 3 brief required four surfaces. Honest per-surface status:

| Surface | File | Wired | Tested | End-to-end |
|---|---|---|---|---|
| Chat composer / ActionStrip | `src/canvas/conversation/ActionStrip.tsx` | ✅ via `selectConversationStatus` | ✅ | ✅ |
| Results header / Hero | `src/components/results/DecisionConfidencePanel.tsx` + `HeroQualifier` | ✅ for completeness reasons (Wave 4) | ✅ unit + integrated RTL | ✅ |
| Pre-analysis panel | `src/canvas/components/pre-analysis/*` | ❌ NOT wired | n/a | n/a |
| Debug overlay / DiagnosticsOverlay | `src/canvas/DiagnosticsOverlay.tsx` | ❌ NOT wired (debug BUNDLE export is wired via Wave 5; the overlay UI surface is separate) | n/a | n/a |

**Gap**: pre-analysis panel and DiagnosticsOverlay are not yet consuming `useAnalysisFreshnessState`. They remain on legacy local-only derivation. This is a known unfinished item, not a claimed acceptance.

## 6. Behaviour before vs after — concrete examples

| Path | Before | After |
|---|---|---|
| "Update that factor to £30,000" + one factor selected | LLM/clarify (or 422 from any real client until the strip-list fix) | 200 + `set_factor_value` mutation + zero LLM calls + receipt in user units + prior analysis stale + re-run prompt |
| "Why did opt_1 win?" against partial/failed analysis | Confident-looking explanation drawn from degraded data | Dedicated recovery template per state with concrete next-step chip; no internal terms |
| ActionStrip status when CEE says stale | Inconsistent with local edit signal mid-render | Wire freshness wins; surface flips to `analysis_stale` immediately |
| Results panel with PLoT-incomplete data | Fabricated zeros rendered as truth | HeroQualifier surfaces curated qualifier line via `data-qualifier-source="completeness"`; recommended option still renders alongside; raw codes never in DOM (text or attributes) |
| Debug bundle on 5xx | Could report `pipeline.status: "success"` based on stale state | `v5_pipeline_status: "proxy_or_network_failure"`; structured `v5_pipeline_status_source` records `capture`, `missing_inputs[]`, `is_analysis_turn_signal` |
| Debug bundle on 200 + analysis_ready.status="needs_user_input" | Could report `ui_render_success` (envelope ignored) | `analysis_failed` — envelope wins over HTTP success |
| Debug bundle on PLoT-touched non-analysis turn | Misclassified as analysis turn | `is_analysis_turn_signal: "no_analysis_signal"` |

## 7. Performance, security, redaction observations

Unchanged from the previous report. No new LLM calls. No latency regressions. Recovery copy across explanation handlers passes the forbidden-terms scan with zero matches. Receipts use user units; redaction tests pin no internal terms in DOM text OR attributes.

## 8. CEE worktree state — strict accounting

The worktree contains TWO classes of dirtiness:

### 8a. Tracked-file modifications (4360 files tracked under `node_modules/`)

`git status -s` shows ~740 modifications/deletions inside `node_modules/`. Investigation:

- `.gitignore` does include `node_modules`, but the directory was committed historically — gitignore only stops new files, it doesn't untrack existing ones.
- `git ls-files node_modules | wc -l` → **4360 tracked files**.
- The local modifications/deletions are the natural drift between the historical committed snapshots and the result of `pnpm install` — i.e. dependency-file churn, not source code.

This is a **pre-existing repo hygiene issue**, NOT caused by this branch. It IS a real handoff hazard because a careless `git add -A` would commit thousands of dependency-churn diffs. Fixing it requires `git rm --cached -r node_modules` + a force-push of staging — a major repo-level operation that must not be done without explicit user authorisation. **NOT addressed in this branch.**

### 8b. Untracked files (none authored by this work)

Untracked files include `.claude/` session state, `Docs/Remove Netlify Edge.md`, `tools/edit-evaluator/`, `tools/graph-evaluator/fixtures/...`, `tools/v5-journey-replay/state-trust-verify.ts`, etc. None of these are committed in any commit on this branch. They have not been modified or deleted.

### 8c. Stash entry preserved

`stash@{0}: On staging: p0-v5: park prompt expansion (out of scope for golden-path integration repair)`. NOT applied during this work. NOT in any commit. The 291-line `data/prompts.json` change remains stashed.

## 9. Known remaining risks / deferred items

- **Wave 3 pre-analysis panel + DiagnosticsOverlay** wiring is NOT shipped. Acceptance for Wave 3 is partial (chat + post-analysis surfaces only). Tracked above in section 5.
- **Tracked node_modules corruption** (~4360 files; section 8a). Not a code bug; a repo-hygiene issue requiring explicit user authorisation to fix.
- **Live `tools/v5-journey-replay/` extension** with selected-deictic step coverage — single-turn HTTP coverage now exists, but the live multi-turn replay against staging needs `CEE_API_KEY`.
- **Browser-level E2E** (Playwright) is not part of the local Tier-1 gate per CLAUDE.md; CI is authoritative. The integrated RTL test at `DecisionConfidencePanel.completenessIntegration.spec.tsx` is the highest-level test that ships.
- **UI broader baseline failures** (~91) in unrelated files — pre-existing, documented as out of scope.
- **Categorical factor-state updates** remain LLM-routed (no quantity → no_quantity gate). Schema change required.
- **UI-SEM-005/006/016/041/044 fabrications** remain as display floors. Wave 4 surfaces partial completeness honestly without removing the floor.

## 10. Whether safe to merge to staging

**Conditional yes**, with explicit caveats:

- All "Accepted" wave rows have rendered or HTTP-boundary evidence.
- Tracked node_modules corruption (section 8a) needs deciding by the user before push — a careless commit-all could introduce thousands of dependency-churn diffs.
- Wave 3 acceptance is partial (chat + post-analysis only); pre-analysis and DiagnosticsOverlay surfaces tracked as deferred.

The brief's user-facing acceptance criteria for Waves 1, 2, 4, 5, 6 are met with rendered/wire evidence. Wave 3 is half-met with concrete enumeration of which half ships.

## 11. Confirmation

- Local commits only.
- No `git push`. No merge to `main` or `staging`. No deploy.
- No prompt-stash reapply.
- No deletion of user untracked files.
- No modification of `node_modules` tracked or untracked state.
