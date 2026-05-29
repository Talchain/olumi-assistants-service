# V5 Handler-Coverage Map

**Status:** read-only static audit · **Date:** 2026-05-29 · **Baseline:** `origin/staging` @ `d59be1a8`
(HEAD == staging, 0/0 divergence) · **Scope:** `olumi-assistants-service` (+ read-only `DecisionGuideAI` route grep)

This map exists to gate the next workstream — **V5 coaching-context enrichment** (richer `ContextPack`
fields / the "v41.8" routing-prompt iteration). It answers: which real V5 turn types run the
orchestrator prompt vs. bypass it; where user-facing copy is produced; which context-assembly surfaces
feed that copy; and which of six known coaching-field drop-points still exist.

> **No production code was changed.** Optional `DecisionGuideAI` access was read-only grep only.

---

## 1. Executive summary

**The V5 turn loop is a deterministic-gate-first pipeline with exactly one ContextPack consumer.**

- **~15 deterministic gates** run in the ORIENT step and short-circuit the turn **before** the
  orchestrator LLM is ever called. The orchestrator routing prompt (`routeWithToolUse`) runs **only as
  the fall-through** when every gate declines (`turn-executor.ts:3401-3424`, `source-verified`).
- The orchestrator routing prompt (`Prompts/v40.txt`) is the **only** reader of the `ContextPack`
  (`route-with-tool-use.ts:742-768`, `source-verified`). It does double duty: it **picks the tool**
  *and* **writes the explanation `answer_text`** for `explain_results` / `what_would_flip` /
  `explain_from_structure`.
- The richest user-facing analysis prose — the **`decision_review`** review/coaching/evidence blocks —
  is produced by a **separate** Sonnet call (`invokeDecisionReview`) that assembles its **own** context
  from **raw PLoT enrichment + the scenario brief, not the ContextPack**
  (`decision-review-enricher.ts:45-64`, `cee/decision-review/invoke.ts:140-256`, `source-verified`).
- Of **14** identified copy-producing context-assembly surfaces, **only 2 are LLM** (the routing
  prompt; the `decision_review` enricher) and **only 1 reads the ContextPack** (the routing prompt).
  The other 12 are deterministic templates / thin-projection readers / spliced raw-enrichment strings.

**Where v41.8 / ContextPack enrichment would actually matter:** *only* the fall-through routing-prompt
turns — i.e. tool-selection quality and the explanation `answer_text` on free-text turns that escape
every gate. It would **not** change: gated turns (deterministic copy), `decision_review` prose (enricher
reads raw enrichment), post-analysis advice copy (deterministic from thin projections), or the analysis
headline / chips (deterministic from raw enrichment). **Generic ContextPack enrichment is therefore
low-leverage.** The leverage is at the deterministic copy-owning surfaces and the enricher's input
adapter.

**Drop-point tally (of the six known):** 0 fully fixed · 4 partially fixed · 1 fixed-for-blocks /
residual-for-free-text · `triggered_plays` + `top_fragile_assumption` **still true** (V4-only, absent
from `src/orchestrator-v5/`). Detail in §9.

**Quick-win safety verdict:** wiring `widening_log` into post-draft copy and consuming
`strengthen_items[1..n]` are **safe V5-only changes — no V4 edit required** (both fields already cross
the V4→V5 boundary on `DraftGraphResult`). Detail in §8.

---

## 2. Evidence-tagging legend

| Tag | Meaning |
|---|---|
| `source-verified: file:line` | Observed directly in source at that location. |
| `test-verified: file (name)` | Behaviour asserted by a named test. |
| `runtime-verified` | Backed by existing staging/runtime evidence. *(Not used in this map — no fresh trace was run; see §10.)* |
| `inferred` | Logical deduction from code, not directly proven at a single line. |
| `unknown-needs-runtime-proof` | Cannot be proven from source alone; needs a runtime trace. |

Classification labels (used consistently): `prompt-run` · `deterministic-gate` · `handler-owned` ·
`composer-owned` · `LLM-fallback` · `V4-owned` · `V5-owned` · `hybrid` · `unknown-needs-runtime-proof`.

> Evidence discipline: `inferred` is never promoted to `source-verified`; every runtime-dependent claim
> is carried into §10 rather than asserted.

---

## 3. Coverage matrix — canonical 12-step journey

Steps as a user actually walks them. "Prompt?" = does the **orchestrator routing prompt** run.

| # | Journey step | Entry route | Gate / classifier | Prompt? | Handler | Owner | Copy source |
|---|---|---|---|---|---|---|---|
| 1 | First messy brief | `/orchestrate/v2/turn` | none (no graph → router picks `draft_graph`) | **yes** | `draft-graph-dispatch` | hybrid | handler-owned (post-draft narrative) |
| 2 | Draft graph returned | (same turn) | — | — | `handleDraftGraph` (V4) | V4-owned | — (structural) |
| 3 | Post-draft coaching | (same turn) | — | — | `post-draft-narrative` | V5-owned | handler-owned + `LLM-fallback` (CEE `coachingSummary` if it passes gate) |
| 4 | Run analysis (chip) | `/orchestrate/v2/turn` (`action_type:run_analysis`,`source:chip`) | chip-click deterministic bypass | **no** | `run-analysis` | V5-owned (PLoT transport) | handler-owned (headline) + enricher LLM |
| 5 | Run analysis (free text) | same | router picks `run_analysis` | **yes** | `run-analysis` | V5-owned | handler-owned + enricher LLM |
| 6 | Explain results | same | advice-gate (`explain_results_free_text`) **or** chip bypass **or** router | gate/chip **no**; router **yes** | `explain-results` | V5-owned | gate=composer-owned; router=`LLM-fallback`+deterministic fallback |
| 7 | What would flip | same | advice-gate (`what_would_flip_free_text`) / chip / router | gate/chip **no**; router **yes** | `what-would-flip` | V5-owned | same pattern as step 6 |
| 8 | Post-analysis advice | same | `post-analysis-advice-gate` (9 classes) | **no** | (gate emits direct answer) | V5-owned | composer-owned (deterministic) |
| 9 | decision_review enrichment | piggybacks on run_analysis fact | — (enricher in handler) | **no** (separate LLM) | `decision-review-enricher` | V5-owned | `LLM-fallback` → `phase3-blocks` composer-owned |
| 10 | Edit graph (free text) | same (route-v2 edit dispatch) | vague-edit / label / simplify pre-gates, else router→`edit_graph` | pre-gate **no**; else **yes** | `edit-graph-dispatch` | hybrid | handler-owned + V4 copy |
| 11 | Add risk / factor / value | same | `deterministic-value-update` / add-risk intent | **no** (when deterministic) | `set-factor-value` / `add-constraint` | V5-owned | handler-owned (deterministic) |
| 12 | Stale analysis / rerun | same | `stale-rerun-guard` | **no** | (gate emits direct answer) | V5-owned | composer-owned (deterministic) |

Evidence: see §4–§8 per-row tags. The "no fall-through to V4" UI contract is `source-verified` in
DGAI (`src/canvas/conversation/useConversation.ts:2635`, `src/v5/v5Adapter.ts:15-35`; *local checkout —
production parity `unknown-needs-runtime-proof`, see §10*).

---

## 4. Turn-type map

Two tables keyed by path (routing/ownership, then context/facts/chips/tests/risks) to answer all 12
audit questions without one unreadable mega-table.

### 4a. Routing, prompt-usage, handler, ownership, copy

| Path | Route entry | Gate / classifier | Prompt? | LLM that produces copy | Handler | Owner | Copy owner |
|---|---|---|---|---|---|---|---|
| First messy brief / `draft_graph` | `/orchestrate/v2/turn` → `route-v2` → `runTurnExecutor` | router (no deterministic gate for first brief) | `prompt-run` | none for copy (narrative deterministic; CEE summary optional) | `draft-graph-dispatch` → V4 `handleDraftGraph` | `hybrid` | `handler-owned` (`post-draft-narrative`) |
| Generate / regenerate model | same | same as draft (re-issues `draft_graph`) | `prompt-run` | none | `draft-graph-dispatch` | `hybrid` | `handler-owned` |
| Post-draft coaching | same turn as draft | — | n/a | CEE `coachingSummary` (upstream, if gate-accepted) | `post-draft-narrative` | `V5-owned` | `handler-owned` + `LLM-fallback` |
| `run_analysis` (chip) | `action_type:run_analysis`,`source:chip` | chip-click deterministic bypass (`chip-click-dispatch.ts:143-146`) | `deterministic-gate` | enricher (decision_review) | `run-analysis` | `V5-owned` (PLoT transport) | `handler-owned` (headline) |
| `run_analysis` (free text) | `/orchestrate/v2/turn` | router → `run_analysis` tool | `prompt-run` | enricher | `run-analysis` | `V5-owned` | `handler-owned` |
| `explain_results` | same | `advice-gate(explain_results_free_text)` / chip / router | gate/chip `deterministic-gate`; else `prompt-run` | router writes `answer_text`; else deterministic fallback | `explain-results` | `V5-owned` | gate `composer-owned`; router `LLM-fallback` |
| `what_would_flip` | same | `advice-gate(what_would_flip_free_text)` / chip / router | same | same | `what-would-flip` | `V5-owned` | same |
| `explain_from_structure` | same | router (no advice-gate class) | `prompt-run` | router `answer_text`; else deterministic fallback | `explain-from-structure` | `V5-owned` | `LLM-fallback`/deterministic |
| Post-analysis advice | same | `post-analysis-advice-gate` (9 classes) | `deterministic-gate` | none (deterministic) | gate emits direct answer | `V5-owned` | `composer-owned` |
| `decision_review` enrichment | piggybacks run_analysis fact | — | `deterministic-gate` for turn; separate LLM for enrichment | `invokeDecisionReview` (own context) | `decision-review-enricher` | `V5-owned` | `LLM-fallback` → `phase3-blocks` `composer-owned` |
| Chip clicks (general) | `action_type` + `source:chip` | `chip-click-dispatch` whitelist | `deterministic-gate` | depends on action | `chip-click-dispatch` | `V5-owned` | `handler-owned`/`composer-owned` |
| Short confirm / "yes do that" | same | `tryShortConfirmResume` (`turn-executor.ts:1094`) | `deterministic-gate` | none | resolves pending action / recovery | `V5-owned` | `composer-owned` |
| `proposal_continuation` Stage 1 | same | `resolveProposalResume` pre-LLM intercept in `edit-graph-dispatch` | `deterministic-gate` | none | `edit-graph-dispatch` (early-emit) | `V5-owned` | `handler-owned` (3 chips) |
| `proposal_continuation` Stage 2 | same | same intercept (`ADD_AS_FACTOR_PATTERNS`) | `deterministic-gate` | none | `edit-graph-dispatch` | `V5-owned` | `handler-owned` (label chips) |
| `edit_graph` free text | route-v2 edit dispatch | `chip-simplify` / `post-analysis-label` / `vague-edit` pre-gates, else router | pre-gate `deterministic-gate`; else `prompt-run` | none (V4 copy / no-op recovery) | `edit-graph-dispatch` → V4 `handleEditGraph` | `hybrid` | `handler-owned` + V4 |
| Add risk | route-v2 / executor | `classifyAddRiskIntent` (`edit-graph-dispatch:1026-1133`) | `deterministic-gate` | none | `add-constraint` (after confirm) | `V5-owned` | `handler-owned` |
| Add factor / value update | executor | `tryDeterministicValueUpdate` (`turn-executor.ts:2338`) | `deterministic-gate` | none | `set-factor-value` | `V5-owned` | `handler-owned` |
| Stale analysis / rerun | executor | `tryStaleRerunGuard` (`turn-executor.ts:3004`) | `deterministic-gate` | none | gate emits direct answer | `V5-owned` | `composer-owned` |
| System events | `route-v2` (kind `system_event`) | pre-handled before `runTurnExecutor` (`turn-executor.ts:369-377`) | `deterministic-gate` | none | system-event path | `V5-owned` | `composer-owned` |
| Error & recovery | any | failure cause → recoverable vs fatal | n/a | none | `failure-response` / `recoverable-handler-response` | `V5-owned` | `composer-owned` |
| No-op recovery | post-handler | `decideNoOpRecovery` (`edit-graph-dispatch:350-553`); explanation precondition (`no-op-helpers`) | `deterministic-gate` (post) | none | dispatch handlers | `V5-owned` | `handler-owned`/`composer-owned` |
| Fallback / unknown route | executor | router returns `text_only` (`converse`) | `prompt-run` | router text | `routeWithToolUse` text path | `V5-owned` | `LLM-fallback` |

All gate line numbers `source-verified` (`turn-executor.ts` grep confirmed: 1094, 1721, 1926, 1999,
2338, 2898, 3004, 3077, 3242, 3327, 3401, 3424). Chip whitelist `source-verified:
chip-click-dispatch.ts:143-146`.

### 4b. Context fields, persisted facts, chips, telemetry, tests, gaps

| Path | Context/ContextPack fields | Facts read/written | Chips generated (where) | Telemetry | Tests | Gaps / risks |
|---|---|---|---|---|---|---|
| First brief / `draft_graph` | none consumed by handler (router uses ContextPack incl. `coaching`) | **writes** `scenarios.graph`+`brief_text`; `handler_facts:[]` (no `draft_graph` variant) `source-verified:draft-graph-dispatch.ts:38-40,397` | post-draft chips `buildPostDraftChips` (`:264-307`) | draft narration count guard (telemetry-only) | `handlers/__tests__/*draft*` | `coaching.summary` only survives if gate-accepted; `widening_log` dropped same-turn (§9-1,3) |
| Post-draft coaching | uses `coachingSummary`/`strengthenItems`/`coachingBiasSignals` (V4 result) | reads V4 `DraftGraphResult` | — | `assumption_source`, gate reject reason | `coaching/__tests__/post-draft-narrative.test.ts` | only `strengthenItems[0]`; no `widening_log` (§9-2,3) |
| `run_analysis` | `graph_hash_at_run` from raw graph | **writes** `run_analysis` fact (`leading_option_id`,`win_probabilities`,`enrichment`,`summary`) | post-analysis chips via `post-analysis-wrapper` from `review_cards` | `RunAnalysis*` events | `tools/handlers/__tests__/run-analysis*` | enricher fires only if `brief` present (`decision-review-enricher.ts:7`) |
| `explain_results` / `what_would_flip` | `analysisProjection` (thin) + `rawRobustness` (WWF); router answer_text uses ContextPack | **writes** `explain_results`/`what_would_flip` fact (`noop:true`,`answer_source`) | — | `answer_source`, `fallback_reason` | `tools/handlers/__tests__/explain*`, `what-would-flip*` | thin projection on gate/fallback path; ContextPack only on router path |
| `explain_from_structure` | `structureProjection` (graph only) | **writes** `explain_from_structure` fact | run-analysis nudge chip | `answer_source` | `tools/handlers/__tests__/explain-from-structure*` | no analysis fields by design |
| Post-analysis advice | `AdviceGateAnalysis` (thin: top_drivers, fragile_edges label-pairs, win-prob, robustness, margin) + optional `decisionReview` | reads prior `run_analysis` fact + readiness | executable `explain_results`/`what_would_flip` chips (`:197-203`) | `V5PostAnalysisAdviceGate` | `routing/__tests__/post-analysis-advice-gate.test.ts` | `evidence_gap` splices `decision_review.evidence_enhancements`/`key_assumptions` |
| `decision_review` enrichment | **own**: `<BRIEF>`+`<ISL_RESULTS>`+`<DETERMINISTIC_COACHING>` from raw enrichment; **not ContextPack** | reads run_analysis enrichment; rewrites fact `enrichment.decision_review` | (blocks, not chips) | `v5.decision_review.{invoked,skipped,failed}` | `coaching/__tests__/decision-review-enricher*`, `compose/__tests__/phase3-blocks.test.ts` | skips `no_brief`; free-text reach `unknown-needs-runtime-proof` (§9-5) |
| Short confirm | pending actions snapshot | reads pending actions; resolves to handler or recovery | recovery chips on expiry | `PendingAction*` | `routing/__tests__/deterministic-short-confirm.test.ts` | — |
| Proposal Stage 1/2 | `proposed_concept` from prior assistant text | reads pending `apply_proposed_change` | 3 carry-forward chips / label chips | proposal lifecycle | `routing/__tests__/proposed-change-synthesis.test.ts`, `handlers/__tests__/*proposal*` | — |
| `edit_graph` free text | V4 patch planner context (not ContextPack) | **writes** `edit_graph` fact + `scenarios.graph` + pending actions | recovery / clarify chips | mutation-language guard (`:4617`) | `handlers/__tests__/*edit*` | V4-owned planner (§8) |
| Add risk / value / edge | `graphForTurn ?? persistedGraph` | **writes** `set_factor_value`/`add_constraint`/`adjust_edge_strength` fact + `mutated_graph` | post-mutation chips | `V5DeterministicValueUpdate` | `tools/handlers/__tests__/{set-factor-value,add-constraint,adjust-edge-strength}*` | — |
| Stale / rerun | `freshness` verdict + readiness | reads run_analysis fact graph-hash | `run_analysis` (rerun) chip | `V5StaleRerunGuard` | `routing/__tests__` (integration) | — |
| System events | `system_event` slot | per event | per event | system-event telemetry | `system-events/*` | scope-limited |
| Error / recovery | failure cause | none | recovery chip (`recovery-chips.ts:53-80`) | failure telemetry | `compose/__tests__/recovery-chips.test.ts` | — |
| Fallback / unknown | ContextPack (router) | none | conversational chips (`chip-generator` floor) | routing log | `routing/__tests__/route-with-tool-use.test.ts` | thin copy from router text |

---

## 5. Prompt-usage map

### The ORIENT gate ladder (order is load-bearing)

`route-v2.ts` pre-gates (before `runTurnExecutor`), then 10 in-executor pre-routes, then the LLM:

1. **route-v2 edit-dispatch pre-gates** (`deterministic-gate`, each emits copy or suppresses edit path):
   `chip-simplify-intercept` (`route-v2.ts:1151`) · `post-analysis-label-intercept` (`:1190`) ·
   `vague-edit-guard` (`:1213`) · `analytical-question-guard` (`:1240`, classify-only suppressor).
   *(`source-verified` per Explore agent A; route-v2 line cites `inferred` from agent — not personally
   re-opened; tagged accordingly.)*
2. **in-executor pre-routes** (each guards on `routingResult === undefined`; `source-verified` grep):
   `tryShortConfirmResume` `:1094` → proposal ordinal/label `:1721` → `tryProposalDismissal` `:1926` →
   `tryClarificationResume` `:1999` → `tryDeterministicValueUpdate`/deictic `:2338` →
   `tryStateQueryGuard` `:2898` → `tryStaleRerunGuard` `:3004` → `tryPostAnalysisAdviceGate` `:3077` →
   `tryFreshAnalysisFollowupGuard` `:3242` → `tryNoAnalysisGuard` `:3327`.
3. **`routeWithToolUse`** (`prompt-run`) — runs only if still `undefined` at `:3401`, invoked at `:3424`
   (`source-verified`).
4. **post-compose** `containsMutationLanguage` (`:4617`) — detection-only telemetry, never blocks
   (`source-verified` per agent; `inferred` exact line).

### Classification

| Surface | Class | Runs orchestrator prompt? |
|---|---|---|
| All gates in steps 1–2 above | `deterministic-gate` | **No** (each can pre-empt the LLM) |
| Chip-click whitelist dispatch (`run_analysis`/`explain_results`/`what_would_flip`) | `deterministic-gate` | **No** (`chip-click-dispatch.ts:143-146`, `source-verified`) |
| `routeWithToolUse` (`Prompts/v40.txt`, Sonnet `tool_choice:auto`) | `prompt-run` | **Yes** — picks tool + writes explanation `answer_text` (`route-with-tool-use.ts:742-768`, `source-verified`) |
| `invokeDecisionReview` (`decision_review` prompt) | LLM, **not** ContextPack | separate Sonnet call (`cee/decision-review/invoke.ts:193-211`, `source-verified`) |

**Prompt file:** `Prompts/v40.txt`, loaded at module init (`prompt-loader.ts`), `ROUTING_PROMPT_VERSION
= 'v40'`; PMS snapshot with file fallback (`source-verified` per agent; `inferred` exact lines). The
archived `Docs/v5/olumi-v5-routing-prompt-v6.txt` is **not** the runtime file (`inferred`).

---

## 6. Copy-owner map

| Module | Produces | Class |
|---|---|---|
| `coaching/post-draft-narrative.ts` | post-draft `assistant_text` | `handler-owned` gating `LLM-fallback` (CEE `coachingSummary` verbatim only if `gateFullResponse` accepts; `source-verified:263-277`) |
| `coaching/analysis-result-headline.ts` | run_analysis headline | `handler-owned` deterministic, from **raw enrichment** (`:138-201`, `source-verified`) |
| `coaching/decision-review-enricher.ts` + `cee/decision-review/invoke.ts` | `decision_review` payload | `LLM-fallback` (separate Sonnet; own context; `:140-256`, `source-verified`) |
| `compose/phase3-blocks.ts` | review/coaching/evidence blocks | `composer-owned` over `LLM-fallback` content (`:286-340`, `source-verified`) |
| `routing/post-analysis-advice-gate.ts` (7 composers) | post-analysis advice prose | `composer-owned` deterministic (`:1083-1486`, `source-verified`) |
| `tools/handlers/explanation-fallback.ts` | explain / WWF / structure fallback prose | `composer-owned` deterministic (`:91,192,335`, `source-verified`) |
| explanation handlers (`explain-results`/`what-would-flip`/`explain-from-structure`) | pass-through of router `answer_text` | `LLM-fallback` (produced upstream by router; `source-verified` handler files) |
| `tools/handlers/no-op-helpers.ts` | precondition templates | `handler-owned` deterministic |
| `coaching/post-analysis-wrapper.ts` | post-analysis chips | `handler-owned` deterministic + spliced `suggested_evidence` (`:165-451`, `source-verified`) |
| `compose/chip-generator.ts` | stage-aware chips | `composer-owned` deterministic (`:192-340`, `source-verified` per agent) |
| `compose/recovery-chips.ts` | recovery chips + preface | `composer-owned` deterministic (`:53-80`, `source-verified`) |
| `compose/recoverable-handler-response.ts`, `handler-failure-responses.ts`, `validation-failure-responses.ts`, `unsupported-action-response.ts`, `edit-clarify-response.ts` | error/recovery/clarify copy | `composer-owned` deterministic |
| `handlers/edit-graph-dispatch.ts` (`decideNoOpRecovery`) + V4 `handleEditGraph` | edit copy | `handler-owned` + V4 (`hybrid`) |
| `handlers/edit-rejection-text.ts` | edit rejection copy | `handler-owned` deterministic |
| `routing/fresh-analysis-followup-guard.ts` | recap constant | `composer-owned` deterministic |

---

## 7. Context-consumption map

### 7a. ContextPack inventory (the routing prompt's sole input)

`ContextPackSchema` is top-level `.passthrough()`, with **strict** nested `analysis`/`graph`; coaching
is opaque passthrough (`context-pack-schema.ts:185-214`, `source-verified`).

| Field | Assembly source | Reaches LLM? |
|---|---|---|
| `graph` (raw) | ingress / compact passthrough | **No** — stripped, replaced by `display_graph` (`route-with-tool-use.ts:751-760`) |
| `display_graph` | `formatGraphForContext` (strengths → phrases) | **Yes** (under `graph` key) |
| `analysis` (raw) | `projectAnalysis` | **No** — stripped, replaced by `display_analysis` |
| `display_analysis` | `formatAnalysisForContext` (floats → decision language) | **Yes** (under `analysis` key) |
| `analysis.top_drivers` | assembler, **capped 3**, `{factor_label, sensitivity_value}` only (`context-pack-assembler.ts:544-551`) | thin |
| `analysis.fragile_edges` | assembler, `{from_label, to_label}` only (`:573-576`) | thin |
| `analysis.staleness_reason` | **dropped** (`void stalenessReason`, `:560-565`) | no |
| `coaching.draft_coaching` | JSONL sidecar via `coaching-cache-reader` | **Yes** — opaque (`summary`/`strengthen_items`/`widening_log`/`bias_signals`) |
| `coaching.decision_review` | prior run_analysis fact enrichment | **Yes** — opaque |
| `coaching.last_coaching_signal` | sidecar | **Yes** — opaque |
| `recent_changes` | `projectRecentChanges` (cap 3) | yes |
| `conversation` | `projectConversation` (cap 5) | yes |
| `parsed_quantities` | CQE `runExtraction` | yes |
| `compound_*`, `system_event` | detectors / input | yes |

`source-verified` for all assembler/schema cites above (personally read). The LLM **does** receive the
full opaque `coaching` slot but a **thinned** `analysis` projection.

### 7b. Handler-internal context-assembly surfaces — **14 identified**

These are the copy-producing context sources **other than** the ContextPack. A later completeness
contract must cover all 14, not just the ContextPack.

| # | Surface | Own ctx / ContextPack | LLM? | Direct analysis fields | Evidence |
|---|---|---|---|---|---|
| 1 | `explain_results` handler (answer_text passthrough) | own (`invocation.explanation`) | LLM (routing-produced) | via `analysisProjection` | `explain-results.ts:121-138` (`source-verified` agent) |
| 2 | `composeExplainResultsFallback` | own (`AnalysisProjectionSummary`) | deterministic | `top_drivers`,`robustness_band`,`margin_pp` | `explanation-fallback.ts:91-153` (`source-verified`) |
| 3 | `what_would_flip` handler (answer_text passthrough) | own (`invocation.explanation`+`rawRobustness`) | LLM (routing-produced) | projection + raw robustness | `what-would-flip.ts:102-109`; `turn-executor.ts:3111` (`source-verified` agent) |
| 4 | `composeWhatWouldFlipFallback` | own (projection + rawRobustness) | deterministic | `top_drivers`,`robustness`,`margin_pp` | `explanation-fallback.ts:192-303` (`source-verified`) |
| 5 | `explain_from_structure` handler (answer_text passthrough) | own (`structureProjection`) | LLM (routing-produced) | none (graph only) | `explain-from-structure.ts:67-73` (`source-verified` agent) |
| 6 | `composeExplainFromStructureFallback` | own (`StructureProjectionSummary`) | deterministic | none | `explanation-fallback.ts:335-434` (`source-verified`) |
| 7 | `no-op-helpers` precondition templates | own (option count + readiness) | deterministic | none | `no-op-helpers.ts:64-201` (`source-verified` agent) |
| 8 | `staleness-prefix` `applyStalenessPrefix` | own | deterministic | none — **inactive on V5 path** | `staleness-prefix.ts:72-85`; `inferred` from `explain-results.ts:129-136` |
| 9 | **`decision-review-enricher` `invokeDecisionReview`** | **own — raw enrichment + brief, NOT ContextPack** | **LLM (separate)** | **deepest raw consumer** (factor_sensitivity, fragile_edges, robustness, m1_coaching) | `decision-review-enricher.ts:45-64`; `invoke.ts:140-256` (`source-verified`) |
| 10 | `post-analysis-advice-gate` 7 composers | own (`AdviceGateAnalysis` + optional decisionReview/rawRobustness) | deterministic | top_drivers, fragile_edges, win-prob, robustness, margin; `evidence_gap` splices decision_review | `post-analysis-advice-gate.ts:1083-1486` (`source-verified`) |
| 11 | `analysis-result-headline` | own (raw enrichment) | deterministic | factor_sensitivity, fragile_edges, robustness, results | `analysis-result-headline.ts:138-263` (`source-verified`) |
| 12 | `post-analysis-wrapper` chips | own (`enrichment.review_cards`) | deterministic | review_cards | `post-analysis-wrapper.ts:165-451` (`source-verified` agent) |
| 13 | `fresh-analysis-followup-guard` recap | own (constant) | deterministic | none | `fresh-analysis-followup-guard.ts:172-277` (`source-verified` agent) |
| 14 | `handler-failure-responses` | own (failure cause) | deterministic | none | `handler-failure-responses.ts:60-325` (`source-verified` agent) |

**Count: 14. LLM surfaces: 2 (#1/3/5 share the routing call; #9 separate). ContextPack readers: 1
(the routing prompt).** No shared explanation-prompt builder exists — explanation `answer_text` is
centralised in the routing call by design.

---

## 8. V4/V5 ownership map

### 8a. Per-handler ownership

| Handler | Class | Delegation evidence |
|---|---|---|
| `draft-graph-dispatch` | `hybrid` | imports + calls V4 `handleDraftGraph` (`:53`, `:317`, `source-verified`) |
| `edit-graph-dispatch` | `hybrid` | imports + calls V4 `handleEditGraph` (`:24`; call ~`:964`, `source-verified` agent) + V4 `computeStructuralReadiness` (`:51`) |
| `run-analysis` | `V5-owned` | only V4 import is `PLoTClient`/`PLoTError` **types**; client injected; no V4 analysis logic (`:50-51`, `source-verified` agent) |
| `set-factor-value` | `V5-owned` | one CEE util `synthesiseDisplayValue` (`:37`); mutation logic in `d1-shared/` |
| `add-constraint`, `adjust-edge-strength` | `V5-owned` | `d1-shared` + schemas only |
| explanation handlers, `chip-click-dispatch` | `V5-owned` | no `../../orchestrator/` imports (`inferred` from absence) |
| `post-draft-narrative`, `phase3-blocks`, advice gate, all `compose/*` | `V5-owned` | paths under `src/orchestrator-v5/` |

Tool registry: V5 registers 7 LLM-visible handlers; **no gate-only concept in V5**. The V4 registry
has `GATE_ONLY_TOOL_NAMES = {'run_exercise'}` (`registry.ts:169-170`, `source-verified`) — invisible to
the LLM; not part of the V5 turn loop.

### 8b. Pinned boundary — draft → post-draft coaching

| Question | Answer | Evidence |
|---|---|---|
| Where V4 ends / V5 begins | V4 ends at `handleDraftGraph(...)` return (`draft-graph-dispatch.ts:317`); all downstream is V5 | `source-verified:317`, import `:53` |
| `post-draft-narrative.ts` V5-owned? | **Yes** | path + import `:67` (`source-verified`) |
| `strengthen_items` crosses before copy? | **Yes** at `:165` into `buildPostDraftNarrative`; **only `[0]` consumed** | `source-verified:165`; `post-draft-narrative.ts:533` (agent) |
| `widening_log` crosses before copy? | On `DraftGraphResult.coachingWideningLog` (crosses as field) but **not read** in dispatch → **never reaches same-turn copy**; **is** written to JSONL sidecar → next-turn `ContextPack.coaching.draft_coaching` | `draft-graph.ts:77,397`; `dispatch.ts:162-168` (absent); `parallel-generate.ts:204-211`; `coaching-cache-reader.ts:43-46` (`source-verified` agent) |
| `bias_signals` crosses before copy? | **Yes** at `:167`, used in assumption picker | `source-verified:167`; `post-draft-narrative.ts:492-506` (agent) |
| draft_graph fact persisted? | **No** — `handler_facts:[]`; no `draft_graph` HandlerFact variant | `source-verified:38-40,397` |

**Verdict — quick-win safety:** Wiring `widening_log` + consuming `strengthen_items[1..n]` are **safe
V5-only changes; no V4 edit required.** Both already cross the boundary on `DraftGraphResult`.
`strengthen_items[1..n]` touches only `post-draft-narrative.ts`; `widening_log` needs a one-line add at
`dispatch.ts:162-168` plus interface/logic in `post-draft-narrative.ts` — both under
`src/orchestrator-v5/`. *(Note: sidecar writer `appendDraftCoaching` is V5-owned but invoked from V4
callers — a cross-boundary invocation, not a blocker.)*

---

## 9. Known coaching-field drop-point reconciliation

| # | Drop-point | Verdict | Evidence |
|---|---|---|---|
| 1 | `coaching.summary` dropped at ActionResult / draft_graph boundary | **PARTIALLY FIXED** | Verbatim only if `gateFullResponse` accepts (`post-draft-narrative.ts:263-277`, `source-verified`); else discarded. Not in structured facts (`draft-graph-dispatch.ts:38-40,397`, `source-verified`); only JSONL sidecar. |
| 2 | `strengthen_items[]` degraded by string-only filter | **PARTIALLY FIXED** | Full `{id,label,detail,action_type,bias_category}` crosses boundary (`draft-graph.ts:654-675` → `dispatch.ts:165`); **only `items[0]` consumed** (`post-draft-narrative.ts:533`). Old `.label`-only path now telemetry-only. (`source-verified` agent) |
| 3 | `widening_log` + `bias_signals[]` stripped by schema/whitelist | **PARTIALLY FIXED** | Both survive into next-turn `ContextPack.coaching.draft_coaching` (opaque passthrough; `sanitise-enrichment` allowlist does not apply to the coaching slot). `bias_signals` reaches the same-turn assumption bullet (`:308-312`); **`widening_log` is absent from `BuildPostDraftNarrativeInput` (`:223-229`, `source-verified`) → never reaches same-turn copy.** |
| 4 | Per-node/edge/option provenance flattened to counts | **PARTIALLY FIXED (graph) / STILL TRUE (analysis)** | Compact graph node/edge entries pass through opaque (provenance survives). But `analysis.top_drivers` → `{factor_label, sensitivity_value}` and `fragile_edges` → label pairs in the ContextPack analysis projection (`context-pack-assembler.ts:540-577`; schema `:79-108`, `source-verified`). Confidence / attribution_stability / EVPI / switch_probability dropped from that projection. |
| 5 | `decision_review` doesn't reliably reach post-analysis coaching/composer | **FIXED for blocks / RESIDUAL for free-text prose** | `phase3-blocks.ts:286-340` emits narrative/pre_mortem/flip_threshold/bias/robustness/evidence_priority/assumption/scenario_context cards (`source-verified`); advice-gate `evidence_gap` splices `evidence_enhancements`/`key_assumptions` (`post-analysis-advice-gate.ts:1186-1299`, `source-verified`). **Residual:** a fall-through free-text post-analysis turn sees `coaching.decision_review` as raw opaque JSON with no deterministic composer; whether the routing prompt instructs Sonnet to use it is **`unknown-needs-runtime-proof`**. Also `decision_review` only exists when a `brief` was present (`decision-review-enricher.ts:7`, `source-verified`). |
| 6 | `top_drivers` / `fragile_paths` / `triggered_plays` / `bias_signals` / `evidence_priority`(VoI) / `top_fragile_assumption` | **MIXED** | `top_drivers` **FIXED** (advice gate `:955`+ fallback `:128-129`, `source-verified`). `fragile_edges` **PARTIAL** (label pairs + flip-threshold cards; switch-prob not in ContextPack analysis). `bias_signals` **PARTIAL** (one draft signal → bullet; `bias` cards via blocks). `evidence_priority`/VoI **PARTIAL** (EvidenceBlocks, droppable by confidence gate `phase3-blocks.ts:499-505`, `source-verified` agent). **`triggered_plays` + `top_fragile_assumption` STILL TRUE — V4-only (`orchestrator/deterministic/coaching-context-builder.ts`); zero occurrences in `src/orchestrator-v5/`** (`source-verified` grep, agent). |

---

## 10. Gaps that block coaching-context work + future staging-trace checklist

### 10a. Static gaps that constrain the next workstream

1. **ContextPack reaches only the fall-through routing prompt.** Enriching it does nothing for the
   gated/handler/enricher copy surfaces (§5, §7). Any enrichment must name a consumer.
2. **`decision_review` (richest analysis prose) bypasses the ContextPack** — built by the enricher from
   raw enrichment (§7b#9). Improving it means changing the enricher input adapter / decision_review
   prompt, not the ContextPack.
3. **Post-analysis copy is deterministic from thin projections** (`AdviceGateAnalysis`,
   `AnalysisProjectionSummary`). Richer fields require either un-thinning a projection *with* a consumer
   or extending the deterministic composers.
4. **`widening_log` never reaches same-turn copy**; **`strengthen_items[1..n]` ignored** — but both are
   V5-only quick wins (§8b).
5. **`triggered_plays` / `top_fragile_assumption` are absent from V5** — net-new plumbing.
6. **No `draft_graph` structured fact** — `coaching.summary` and draft coaching carry only via the
   fire-and-forget JSONL sidecar.

### 10b. Future staging-trace checklist (prepare, do NOT run here)

A separate read-only runtime instrument after this static map lands. Each is carried as
`unknown-needs-runtime-proof`:

- **Prompt bypass rate** — fraction of real turns hitting a deterministic gate vs. falling through to
  `routeWithToolUse`, across the canonical decision corpus. Bounds how much ContextPack enrichment can
  ever matter. `unknown-needs-runtime-proof`.
- **decision_review free-text behaviour** — does a fall-through free-text post-analysis turn get Sonnet
  to use `coaching.decision_review` in `answer_text`? (§9-5 residual.) `unknown-needs-runtime-proof`.
- **Fall-through post-analysis usage** — how often free-text post-analysis turns reach the router vs.
  being caught by the advice gate. `unknown-needs-runtime-proof`.
- **DGAI production parity** — confirm the deployed UI build hits `/orchestrate/v2/turn` and which
  `/assist/v1/*` are live (local checkout is one of several variants). `unknown-needs-runtime-proof`.
- **Static-vs-runtime gating divergence** — routes where freshness derivation / CQE extraction / gate
  ordering may behave differently at runtime than static reading suggests. `unknown-needs-runtime-proof`.
- **Copy-source rates** — `gateFullResponse` accept-rate for CEE `coaching.summary`; explanation
  `answer_text_valid` rate vs. deterministic-fallback firing rate. `unknown-needs-runtime-proof`.

---

## 11. Recommendations — ranked implementation sequence

Ranked by (1) user-visible lift, (2) implementation risk, (3) V4/V5 ownership safety, (4) whether a
current copy-owning surface can consume the field. **A sequence, not a backlog.**

### Tranche A — quick wins, V5-owned, surgical (do first)

| Order | Fix | Lift | Risk | Ownership safety | Consumer exists? |
|---|---|---|---|---|---|
| A1 | Wire `widening_log` into post-draft copy | med | low (1-line `dispatch.ts:162-168` + `post-draft-narrative.ts` interface/logic) | **SAFE, V5-only** — already crosses boundary | **Yes** — `post-draft-narrative.ts` |
| A2 | Consume `strengthen_items[1..n]` (not just `[0]`) | med | low (`pickStrengthenAssumption` only; full array already passed) | **SAFE, V5-only** | **Yes** — `post-draft-narrative.ts` |
| A3 | Surface more existing `bias_signals` | low-med | low (V5 narrative) | **SAFE, V5-only** — crosses at `dispatch.ts:167` | **Yes** — assumption picker |
| A4 | Surface more existing `decision_review` fields (`pre_mortem`/`flip_thresholds`/`key_assumptions`) in deterministic post-analysis copy; wire the deferred draft-sourced coaching kinds in `phase3-blocks` | med-high | low-med (deterministic composers; fields already on the run_analysis fact via enricher) | **SAFE, V5-owned** (`post-analysis-advice-gate.ts`, `phase3-blocks.ts`) — `phase3-blocks.ts:342-349` flags the draft-sourced kinds as a separate workstream | **Yes** — already read `decision_review` |

### Tranche B — net-new V5 plumbing, later & conditional

| Order | Item | Why deferred | Gating condition |
|---|---|---|---|
| B1 | Relax/repair EvidenceBlock confidence gate for evidence_priority/VoI | needs reliable `factor_sensitivity[].confidence` | confirm confidence populated at runtime before relaxing (`phase3-blocks.ts:499-505`) |
| B2 | Richer fragile-path objects (switch_probability) to user copy | ContextPack `analysis.fragile_edges` is label-pairs only; un-thinning the assembler projection is dead weight without a consumer | only if a prompt-run/block consumer will use it (enricher path already has raw `fragile_edges`) |
| B3 | `triggered_plays` | V4-only; needs net-new producer + carrier (fact/ContextPack) + consumer | product decision it's wanted in V5 |
| B4 | `top_fragile_assumption` | V4-only; same net-new plumbing | product decision it's wanted in V5 |
| B5 | Persist `coaching.summary` / draft coaching in a structured `draft_graph` fact | no `draft_graph` HandlerFact variant; needs schema + commit change | only if a consumer needs structured (non-sidecar) carriage |

**Sequencing rationale.** ContextPack enrichment / v41.8 alone is **low-leverage** — it reaches only the
fall-through routing prompt. A1–A4 deliver user-visible lift on surfaces that already own copy and
already have the fields on the V5 side, so there is no boundary risk. Tranche B is net-new plumbing whose
payoff is conditional on a proven consumer; do not start it speculatively. **Before any v41.8 / generic
ContextPack work, run the §10b prompt-bypass-rate trace** — it is the single measurement that tells us
whether enriching the routing prompt is worth it at all.

---

## Appendix — method & evidence integrity

- Built from 5 read-only Explore sweeps (routing/gates/telemetry · handlers/tools/ownership ·
  coaching/compose/context/drop-points · handler-internal context sites · V4/V5 boundary), with the
  load-bearing claims **re-read personally** (`buildUserMessage`, ContextPack schema + assembler,
  `post-draft-narrative` input, the ORIENT gate ladder, `phase3-blocks` decision_review path,
  `chip-click` whitelist, `GATE_ONLY_TOOL_NAMES`, advice-gate composers, the enricher's own-context
  assembly, the analysis headline, the commit path).
- A handful of cited line numbers come from Explore sweeps and are tagged `source-verified` (the source
  was read by the sub-agent); where a claim is a deduction it is tagged `inferred`; runtime-dependent
  claims are never asserted — they live in §10b as `unknown-needs-runtime-proof`.
- `inferred` is never promoted to `source-verified`.
