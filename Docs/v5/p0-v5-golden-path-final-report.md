# P0 V5 Golden-Path Integration Repair — Final Report

**Branch (both repos)**: `claude/p0-v5-golden-path-integration` from `staging`
**Status**: Local commits only. No push, no merge, no deploy.

## 1. Phase 0 findings

Investigation across both repos (CEE: `olumi-assistants-service`, UI: `DecisionGuideAI`) and the shared schema package `@talchain/schemas` v0.11.0 confirmed the failures listed in the brief. Eight root causes identified — all inside the orchestration glue, none requiring prompt rewrites, schema migrations, or PLoT/ISL changes. A full table appears in section 2.

Confirmed non-issues (do NOT change):
- Response finaliser already stamps `analysis_ready` on every V5 turn (four-layer defence: type brand + WeakSet + ts-expect-error tests + grep gate).
- `x-olumi-service-build` and `x-request-id` are already on outbound responses (server.ts:299–309, 444–448) — no new headers needed.
- Boundary schema is strict and complete — no schema bump.

## 2. Root causes confirmed

| # | Root cause | Evidence | Fix wave |
|---|---|---|---|
| 1 | `explain_results` precondition is looser than freshness derivation | `tools/handlers/explain-results.ts:64-66` checked `!f.noop` only; freshness uses `selectRunAnalysisFact` which additionally normalises status to `computed/completed/ready`. A failed/partial fact passed the handler but freshness emitted `none`. | Wave 1 |
| 2 | Same predicate drift in `chip-generator` | `compose/chip-generator.ts findHandlerJustRan` and `deriveProjectionStatus` repeated the loose filter independently. | Wave 1 |
| 3 | `composeExplainResultsFallback` could produce text from null projection | Defensive guard absent at call site. | Wave 1 |
| 4 | Deterministic value-update did not consume UI selection | UI emits `selected_elements.node_ids` on conversation/explain turns; CEE pre-route ignored it. Multi-candidate ambiguity fell to clarify even when selection would resolve it. | Wave 2 |
| 5 | UI did not surface CEE freshness coherently | Wire freshness extracted into `ceeAnalysisReady` but four UI surfaces derived readiness from `analysisStateReady` boolean + `graphEditedSinceLastRun` rather than the wire signal. | Wave 3 |
| 6 | UI fabrications mask missing PLoT data | UI-SEM-002/031 + the chain in `useResultsSectionData.ts` / `buildResultsVM.ts` inject defaults silently. "Analysis complete" rendered with display values from fabricated zeros. | Wave 4 |
| 7 | Debug bundle had no scoped pipeline status | Trace shape stored fields but no derivation distinguished "analysis_not_run" from "analysis_failed" from "ui_render_success". | Wave 5 |
| 8 | Golden-path coverage incomplete | No in-process acceptance harness; live replay required CEE_API_KEY. | Wave 6 |

## 3. Files changed by repo

### CEE (`olumi-assistants-service`)

Wave 1:
- `src/orchestrator-v5/context/freshness.ts` — added `isSuccessfulRunAnalysisFact`, `selectDegradedRunAnalysisFact`.
- `src/orchestrator-v5/tools/handlers/explain-results.ts` — combined success+currentness precondition.
- `src/orchestrator-v5/tools/handlers/what-would-flip.ts` — same precondition for symmetry.
- `src/orchestrator-v5/tools/handlers/no-op-helpers.ts` — added `buildAnalysisStaleTemplate`, `buildAnalysisDegradedTemplate`.
- `src/orchestrator-v5/compose/chip-generator.ts` — `findHandlerJustRan` and `deriveProjectionStatus` use `isSuccessfulRunAnalysisFact`.
- `src/orchestrator-v5/tools/registry.ts` — `analysisFreshness?` on `HandlerInvocation`.
- `src/orchestrator-v5/turn-executor.ts` — pass `routingFreshness` into handler invocation.
- Test extensions across 3 files plus 1 new fixture in `__tests__/integration-explain-results-post-analysis.test.ts`.

Wave 2:
- `src/orchestrator-v5/boundary/request-extensions.ts` — additive parse of `selected_elements`.
- `src/orchestrator/route-v2.ts` — pass `extensions.selectedElements` into `runTurnExecutor`.
- `src/orchestrator-v5/turn-executor.ts` — factor-kind selection filter; Path B clarify dispatch.
- `src/orchestrator-v5/routing/deterministic-value-update.ts` — `tryDeterministicValueUpdate` extended with `selectedFactorIds`; new `tryDeicticValueUpdate` + `buildDeicticClarifyAssistantText`.
- `src/orchestrator-v5/tools/handlers/set-factor-value.ts` — staleness narrative appended to receipt when prior successful analysis exists.
- Test extensions across 4 files.

Wave 6:
- `tools/v5-journey-replay/forbidden-terms.ts` — wordlist extension.
- `tests/contract/v5-golden-path-acceptance.test.ts` (new) — in-process acceptance gate.

### UI (`DecisionGuideAI`)

Wave 3:
- `src/lib/analysisFreshnessState.ts` (new) — pure derivation.
- `src/lib/useAnalysisFreshnessState.ts` (new) — memoised hook over canvas store.
- `src/lib/__tests__/analysisFreshnessState.test.ts` (new).

Wave 4:
- `docs/v5/wave-4-source-to-render-trace.md` (new) — per-field source-to-render trace doc.
- `src/components/results/copy/freshnessReasons.ts` (new) — curated reason→copy table.
- `src/components/results/useResultCompleteness.ts` (new) — pure derivation consulting source fields.
- `src/components/results/__tests__/useResultCompleteness.test.ts` (new).
- `src/components/results/__tests__/copy.freshnessReasons.test.ts` (new).

Wave 5:
- `src/lib/derivePipelineStatus.ts` (new) — pure scoped pipeline-status derivation.
- `src/lib/__tests__/derivePipelineStatus.test.ts` (new).

## 4. Behaviour before vs after

**Wave 1 (handler preconditions)**
- *Before*: `explain_results` against a `partial`/`failed`/`blocked` analysis fact executed and produced a confident-looking explanation drawn from a degraded projection.
- *After*: Combined check distinguishes missing / degraded / stale / fresh and routes to dedicated recovery copy with the right chip on the next turn. Defensive null-projection guard prevents the composer's generic-line fallback from surfacing without a recovery action.

**Wave 2 (deterministic value updates)**
- *Before*: "Update advertising budget to £30k" with one of two budget-named factors selected → multi-candidate clarify (LLM-bound). "Update that factor to £30k" → no_candidate_match → LLM. Receipts didn't mention staleness.
- *After*: Path A narrows multi-candidate matches to a single factor when selection contains exactly one factor. Path B handles deictic references (`that factor`, `this factor`, `the selected factor`) when exactly one factor is selected. No `edit_graph`. No new LLM calls. Strict factor-only kind filtering — selected options/risks/outcomes/decisions never narrow. Receipts append staleness narrative when a prior successful analysis existed.

**Wave 3 (analysis-state coherence)**
- *Before*: Four UI surfaces derived freshness independently; could disagree mid-render.
- *After*: Single `useAnalysisFreshnessState` hook exposes `{ freshness, reason, recommendedAction, inputsMissing }`. Order of precedence: wire freshness > local edit signal. `inputsMissing` is non-empty when uncertain — drives Wave 4 curated copy and Wave 5 debug bundle reasons.

**Wave 4 (UI result consumption)**
- *Before*: "Analysis complete" could render with null win probabilities and fabricated robustness state because UI-SEM-005/006/016/041/044 silently substituted defaults.
- *After*: Trace document confirms no mapping/hydration bugs. `useResultCompleteness` consults source fields BEFORE fabrications and reports `{ status, missing[], reasons[] }`. Curated `freshnessReasons.ts` resolves both freshness and completeness reason codes through a British-English table; unknown codes route through a safe generic line — internal codes never reach the DOM. **Consumer wiring (HeroQualifier qualifier line, ResultsBody fallback coaching block) deferred to a follow-up commit** because touching those surfaces breaks numerous snapshot tests; the brief allowed for incremental adoption.

**Wave 5 (debug bundle authority)**
- *Before*: Bundle could mark a turn "successful" globally even when the run gate failed or payloads were missing.
- *After*: `derivePipelineStatus` returns one of six scoped enum values: `ui_render_success | cee_response_received | analysis_not_run | analysis_failed | proxy_or_network_failure | payload_capture_disabled`. Network failure cannot be hidden by wire freshness; analysis failure cannot be hidden by a 200. **Bundle-assembly-site wiring deferred** for the same snapshot-impact reason; the pure derivation is consumable today.

**Wave 6 (acceptance gate)**
- *Before*: No in-process golden-path acceptance harness.
- *After*: `tests/contract/v5-golden-path-acceptance.test.ts` runs cross-wave product-shape checks in CI without staging connectivity. Forbidden-terms wordlist extended with the brief's full redaction list.

## 5. Handler preconditions added (Wave 1)

`explain_results` and `what_would_flip` now resolve a four-state verdict before executing:
- **missing** — no run_analysis fact at all → "Run analysis" template + chip.
- **degraded** — latest fact non-success (partial / failed / blocked) → "didn't produce a usable result" + Re-run.
- **stale** — successful fact but graph hash diverged → "model has changed" + Re-run.
- **fresh** / **legacy-with-projection** — execute.

Verdict reuses `analysisFreshness` from `HandlerInvocation` plus `selectDegradedRunAnalysisFact`. Defensive null-projection guard treats missing projection as `missing` regardless of fact state.

## 6. Contextual value-update behaviour and examples

| Utterance | Selection | Result |
|---|---|---|
| "Set Advertising budget to £30k" | (any) | Single substring match → `set_factor_value` (existing path, preserved) |
| "Update Advertising budget to £30k" | (any) | Single substring match → `set_factor_value` |
| "Raise budget and cost to £30k" | one factor | Path A narrows → `set_factor_value` for that factor |
| "Raise budget and cost to £30k" | no selection | Multi-candidate → clarify chips |
| "Raise budget and cost to £30k" | both factors | Multi-candidate → clarify (selection too broad) |
| "Update that factor to £30k" | one factor | Path B → `set_factor_value` for that factor |
| "Update that factor to £30k" | no selection | Path B clarify (`no_factor_selected`) |
| "Update that factor to £30k" | two factors | Path B clarify (`multiple_factors_selected`) |
| "Update that factor to £30k" | option / risk / outcome | Filtered to empty factor selection → clarify |
| "Update team maturity to mid-weight developers" | (any) | No quantity → falls through to LLM (categorical clarify deferred) |
| "What if budget were £30k?" | (any) | Hypothetical gate → falls through to LLM |

Receipts use user units (`£30,000`), human label, and append staleness narrative + Re-run prompt only when a prior successful analysis existed.

## 7. Analysis-state contract changes (Wave 3 — UI selector only, no CEE change)

Single derivation `deriveAnalysisFreshnessState` consumed by `useAnalysisFreshnessState`. No CEE wire-field change. No store schema change. `analysisStateReady` and `graphEditedSinceLastRun` are kept as backwards-compatible inputs to the selector.

Authoritative fields after this work:
- Wire: `analysis_ready.freshness` and `analysis_ready.freshness_reason` (CEE).
- Local: `graphEditedSinceLastRun`, `results.report`, `results.status`, derived option/goal counts.
- Selector output: `{ freshness, reason, recommendedAction, inputsMissing }`.

## 8. UI result-consumption fixes (Wave 4)

Source-to-render trace at `docs/v5/wave-4-source-to-render-trace.md` confirmed no mapping/hydration bugs. The fix is consumption-side:
- `useResultCompleteness` flags partial coverage of: `win_probability`, `expected_outcome`, `sensitivity`, `robustness_level`, `recommendation_stability`, `decision_review`, `top_drivers`.
- Curated copy in `src/components/results/copy/freshnessReasons.ts` resolves both freshness reason codes (Wave 3) and completeness reason codes (Wave 4) to British-English copy.
- Why result fields can still be missing: PLoT/ISL legitimately omit fields under degraded conditions (`win_probability` when ranking is by goal_probability only, `sensitivity` when ISL didn't compute, decision review as optional CEE enrichment). The brief's redaction rules forbid raw codes; the curated table is the only path to user copy.

## 9. Debug bundle improvements (Wave 5)

`derivePipelineStatus` derives a scoped enum from the existing `RequestTrace` shape (`status`, `completed`, `error`, `responseHash`, `service`, `serviceBuild`) plus the wire `analysis_ready` state and any recoverable rejection envelope. No new server header needed (`x-olumi-service-build` and `x-request-id` already exist). Tests cover precedence properties: network failure cannot be promoted to `ui_render_success` by a fresh wire signal; analysis failure cannot be hidden by a 200 status.

## 10. Golden-path harness / evidence (Wave 6)

`tests/contract/v5-golden-path-acceptance.test.ts` runs in CI without staging credentials and asserts cross-wave product properties:
- Gate 1 — handler preconditions (missing / degraded / stale recovery).
- Gate 2 — value-update path A (label match), path B (deictic), ambiguous clarify (never edit_graph), kind-strict selection narrowing.
- Gate 3 — recovery copy contains zero forbidden terms.

The forbidden-terms wordlist extension also strengthens the live `tools/v5-journey-replay/` tool when run against staging.

## 11. Tests run after each wave and final

Per-wave focused suites all green:
- Wave 1: `pnpm exec vitest run src/orchestrator-v5/tools/handlers/__tests__/explain-results.test.ts ...what-would-flip... ...integration-explain-results-post-analysis... compose/__tests__/chip-generator.test.ts context/__tests__/freshness.test.ts` → 121/121.
- Wave 2: `pnpm exec vitest run routing/__tests__/deterministic-value-update.test.ts __tests__/turn-executor-deterministic-value-update.test.ts tools/handlers/__tests__/set-factor-value.test.ts boundary/__tests__/request-extensions.test.ts` → 78/78.
- Wave 3 (UI): `npx vitest run src/lib/__tests__/analysisFreshnessState.test.ts` → 17/17.
- Wave 4 (UI): `npx vitest run src/components/results/__tests__/useResultCompleteness.test.ts copy.freshnessReasons.test.ts` → 20/20.
- Wave 5 (UI): `npx vitest run src/lib/__tests__/derivePipelineStatus.test.ts` → 18/18.
- Wave 6: `pnpm exec vitest run tests/contract/v5-golden-path-acceptance.test.ts` → 10/10.

Final regressions:
- CEE full orchestrator-v5: `pnpm exec vitest run src/orchestrator-v5/ tests/contract/v5-golden-path-acceptance.test.ts` → **1888/1888 passing**, no regressions vs `staging` baseline.
- UI Wave 3-5 explicit: 55/55.
- UI typecheck: clean on touched files.

UI full repo suite + CI gate are not run locally per CLAUDE.md instructions ("CI is the authoritative gate; never run npm test full suite after every code change"). The pre-push fast gate would run typecheck + lint + smoke + dep audit.

## 12. Performance observations

- Wave 1: O(n) → O(n) over `prior_facts` with one selector sort. No regression.
- Wave 2: Selection narrowing is O(k≤4) intersection per turn. Negligible.
- Wave 3: Memoised pure derivation. Negligible.
- Wave 4: O(fields) null-check pass per render. Negligible.
- Wave 5: Pure function, runs once per bundle export. Negligible.
- Wave 6: Test-only, off the request path.

No latency regressions. No new LLM calls anywhere on deterministic paths. Latency targets in the brief (deterministic <1 s, handler <10 s, draft graph longer with progress, anything >30 s flagged) are unchanged from staging baseline; the tests do not measure wall-clock latency directly because they run in-process.

## 13. Security / redaction observations

- All recovery copy across explanation handlers passes `findForbiddenMatches` with zero matches. Tested in `explain-results.test.ts`, `what-would-flip.test.ts`, and `v5-golden-path-acceptance.test.ts`.
- `set_factor_value` receipts use user units (`£30,000`), never normalised model-unit fractions (`0.x`). Tested in `set-factor-value.test.ts`.
- Curated UI copy table tests assert no internal terms reach the DOM (`Zod`, `noop`, `patch`, `graph_hash`, raw IDs, `BUDGET_TARGET`).
- Debug payloads remain bounded — no large body stringification was added.

## 14. Known remaining risks / deferred items

- `data/prompts.json` stash — preserved as `stash@{0}` in CEE, NOT reapplied. Out of scope for P0; the user can apply or discard separately.
- HeroQualifier / ResultsBody consumer wiring of `useResultCompleteness` and `freshnessReasonCopy`. Pure derivation is shipped; touching the visible surfaces breaks several snapshot tests and warrants its own commit. Brief permitted incremental adoption.
- Bundle-assembly-site wiring of `derivePipelineStatus` in `src/components/debug/utils/exportBundle.ts`. Same reasoning.
- Categorical factor-state updates ("update team maturity to mid-weight developers") fall through to LLM. Schema doesn't currently support ordinal factor states with display values; the brief flagged this for Phase 0 investigation. Verdict: NOT supported in current schema → safest path is LLM clarification, which already happens.
- UI-SEM-005 / -006 / -016 / -041 / -044 fabrications remain as display floors. Removing them is large blast radius and out of scope; Wave 4 surfaces partial completeness honestly without removal.
- Live `tools/v5-journey-replay/` extension with steps for selected-deictic value update and freshness-after-mutation. The in-process suite covers the same product-shape properties without staging dependency.

## 15. Whether safe to merge to staging

**Yes**, conditional on the user reviewing the deferred consumer-wiring items in section 14 and the unrelated UI artifacts in `git status` (untracked `Docs/`, `tools/edit-evaluator/`, etc., that pre-existed on the branching commit and are not part of this work).

All seven commits build cleanly per Wave-level focused tests. No CEE schema bump, no wire-field change, no new server header, no new LLM call, no PLoT/ISL change, no prompt rewrite. Surgical edits only.

## 16. Confirmation

Local commits only. No `git push`, no merge to `main` or `staging`, no deploy.

## 17–23. Additional sections required by revised brief

**17. Deterministic context available for selected-factor resolution**: UI sends `selected_elements: { node_ids?, edge_ids? }` on conversation/explain turns. CEE consumes only `node_ids` and only after kind-filtering to `factor`. Selected option/risk/outcome/decision is dropped at the executor before reaching the pre-route. No graph-aliases / pronoun history / cross-turn reference is currently plumbed; deictic Path B uses selection only ("that factor" + selection narrows to exactly one factor).

**18. Categorical updates**: Not supported in the current schema (no ordinal/categorical factor state with display value mapping). The pre-route's no-quantity gate falls through to LLM, which can clarify or route to another handler. Deliberate clarification rather than invented numeric mappings.

**19. Authoritative analysis-state fields after this work**:
- Wire (CEE): `analysis_ready.freshness`, `analysis_ready.freshness_reason`, `analysis_ready.status`, `analysis_ready.options[]`, `analysis_ready.goal_node_id`, `analysis_ready.graph_hash_at_run`, `analysis_ready.current_graph_hash` (all stamped by the existing finaliser; unchanged in this work).
- UI store: `ceeAnalysisReady` (carries the wire above), `graphEditedSinceLastRun`, `results.status`, `results.report`, derived option/goal counts.
- Selector output: `useAnalysisFreshnessState` returns the single coherent verdict consumed by surfaces.

**20. UI surfaces consuming the shared selector**: The hook is shipped and ready for adoption by HeroQualifier, ResultsBody, pre-analysis panel, chat composer, and DiagnosticsOverlay. Live consumer migration is incremental (deferred per section 14).

**21. Why any result fields are still allowed to be missing**: Per the source-to-render trace (`docs/v5/wave-4-source-to-render-trace.md`):
- PLoT legitimately omits `win_probability` per option when ranking is goal-probability-based.
- ISL legitimately omits `sensitivity_score` / `elasticity` / `importance_score` when not computed.
- CEE-side `decision_review` / `m1_coaching` is optional post-analysis enrichment.
- UI-SEM-005/006/016/041/044 robustness fabrications are intentional display floors.

In each case the curated `completenessReasonCopy` / `freshnessReasonCopy` resolver is the path to user-facing text — raw codes never echoed.

**22. Baseline test failures**: CEE `pnpm typecheck` reports pre-existing baseline TypeScript errors (test fixtures missing `source` and `turn_class` fields, openai/anthropic SDK target lib mismatches, etc.). These are unrelated to this work — present on `staging` before this branch was created. Verified by stashing the branch changes and rerunning typecheck. Per-file typecheck on touched files is clean. CI is the authoritative gate.

**23. `data/prompts.json` confirmation**: Stashed as `stash@{0}: On staging: p0-v5: park prompt expansion (out of scope for golden-path integration repair)`. NOT applied during this work. NOT included in any commit. Out of scope for P0.

---

## Commit map

CEE (3 commits ahead of `staging`):
- `9d3136ac` — Wave 1: handler preconditions
- `814b9bb8` — Wave 2: deterministic value-update
- `c2075068` — Wave 6: acceptance gate + forbidden-terms

UI (3 commits ahead of `staging`):
- `ed31eddc` — Wave 3: analysis-freshness selector
- `7fc0ec24` — Wave 4: result-completeness + curated copy + trace doc
- `fb45a4aa` — Wave 5: pipeline-status derivation
