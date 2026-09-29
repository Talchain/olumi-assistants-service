# V5 readiness diagnostic — why analysis cannot run

**Authored:** 2026-04-26
**Repos read (read-only):**
- olumi-assistants-service @ `33c2a872419a4fd1d29ccc74644acbe647485c03` (branch `claude/v5-pre-pilot-hardening`, based on `staging` @ `4d7e6c3f`)
- DecisionGuideAI @ `0ac40a52314b54e3b31f838a3c27dab3f8175b3a` (branch `ui/analysis-tab-ia-reframe`)
- plot-lite-service @ `26dab6217ba2ce2a2dbc37ff2d67b5c5781e2aa3` (branch `staging`)

**Bundles inspected (working tree only, gitignored under `.tmp/diagnostic/`, never committed):**
- `olumi-debug-73c6088a-20260426.json` — hiring decision, scenario `3baa8cbe-…`, environment `development`, client_build `dev1234`
- `olumi-debug-d90cfe97-20260426.json` — marketing decision, scenario `69a119e9-…`, environment `development`, client_build `dev1234`

> **Bundle provenance caveat.** Both bundles report `meta.environment: "development"` and `client_build: "dev1234"`, *not* staging. Server-side build identifiers in `builds.cee/plot/isl` are all `null`. The diagnostic stands regardless — every code path traced below is identical between staging and main — but the report should not be cited as proving anything specific about the staging deployment.

---

## Executive summary

This is a **compound failure** with three independent contributors. Final classification: **compound failure** (per the classification ladder Paul specified at hand-off).

1. **Class A (CEE):** the orchestrator wire only carries `analysis_ready` on **`draft_graph` turns**. Every other turn dispatch path — `edit_graph`, recoverable-validator (`ENTITY_KIND_MISMATCH` / `ENTITY_RESOLUTION_AMBIGUOUS` / etc.), `tool_call execute`, `clarify`, `coach`, `converse` — assembles a response without an `analysis_ready` field, even though TurnExecutor *computes* one for chip-gating purposes. Once the user takes any non-draft action, the wire stops delivering readiness updates.
2. **Class B (UI ingestion):** `ceeAnalysisReady` is written to the canvas store **only** by `applyDraftResult` (`hasAnalysisReady(draftData)` gate). Subsequent edits and any recoverable-validator response leave the store value untouched; certain canvas mutations explicitly call `invalidateAnalysisReady()` and clear it to `null`. There is no recompute-and-resend mechanism on follow-up turns. Result: in both bundles `analysis_ready === null` at export time.
3. **Class C (UI legacy fallback — P0 trace):** when `ceeAnalysisReady` is null, `validateOptions()` falls back to canvas-node inspection. Two independent defects in that fallback:
   - **C1.** It selects `n.type === 'option' || n.type === 'decision'` as the option set, so the **decision node is treated as an option** and its label gets pushed into the `OPTIONS_NEED_MAPPING.affectedIds` list. This is the trace Paul asked me to chase — yes, the decision-node label appears in the blocker because the fallback selector includes `decision`.
   - **C2.** `normaliseOptionFromLegacyNode()` reads `node.data.interventions[k]` and only handles `typeof value === 'number'`. The actual graph stores interventions as `InterventionV3` objects (`{ value: number, source, target_match, … }`) at `node.interventions`, not `node.data.interventions`. The fallback therefore extracts **zero interventions** from option nodes that are in fact fully-populated, mis-classifies them as `needs_user_mapping`, and reinforces the blocker.

The "PLoT was never called" symptom is a **consequence** of (A+B+C), not a separate bug: the UI's `Run analysis` chip is gated on a `ready` readiness state, and the legacy fallback never produces one.

The `ENTITY_KIND_MISMATCH` and `ENTITY_RESOLUTION_AMBIGUOUS` validator rejections in the brief are a **separate** concern — they originate from Sonnet proposing tool calls against the wrong entity kinds. The composed user-facing responses are working as designed (`composeRecoverableValidationResponse`), but they don't ship `analysis_ready`, which feeds back into Class A.

**Recommended fix direction (locality):** **UI-only**, surgical. Drop `decision` from the legacy `optionNodes` filter at [usePreRunValidation.ts:357-358](../../../DecisionGuideAI/src/canvas/hooks/usePreRunValidation.ts#L357-L358); teach the legacy normaliser at [options.ts:221-238](../../../DecisionGuideAI/src/types/options.ts#L221-L238) to read top-level `node.interventions` and unwrap `InterventionV3.value`. Class A is an architectural fix (ship `analysis_ready` on every turn — TurnExecutor already computes `analysisReadyForTurn`, just doesn't pass it to the compose layer), worth doing but more invasive. The UI-only fix alone should resolve the user-visible symptom for both bundles.

---

## Phase 1 — traces

### 1.1 Where "Options need configuration: map option effects to factors" originates

**UI string source (wire-driven path).** `BLOCKER_DISPLAY['OPTIONS_NEED_MAPPING']` at [blockerEnrichment.ts:118-124](../../../DecisionGuideAI/src/canvas/components/pre-analysis/blockerEnrichment.ts#L118-L124):

```
OPTIONS_NEED_MAPPING: {
  title: 'Options need configuration',
  description: "Some options don't have clear effects on the model's factors.",
  severity: 'warning',
  supportsRetry: true,
  suggestedActions: ['Map option effects to factors'],
}
```

**Producer (UI-side).** Two producers both emit `code: 'OPTIONS_NEED_MAPPING'`:
- [usePreRunValidation.ts:307](../../../DecisionGuideAI/src/canvas/hooks/usePreRunValidation.ts#L307) — wire-driven path: when `ceeAnalysisReady.options[]` contains entries with `status: 'needs_user_mapping'` (excluding empty baselines).
- [usePreRunValidation.ts:404](../../../DecisionGuideAI/src/canvas/hooks/usePreRunValidation.ts#L404) and [usePreRunValidation.ts:416](../../../DecisionGuideAI/src/canvas/hooks/usePreRunValidation.ts#L416) — legacy fallback path: same code, computed locally from canvas nodes.

**Render site.** [BlockersSection.tsx:83](../../../DecisionGuideAI/src/canvas/components/pre-analysis/BlockersSection.tsx#L83) (`BlockerTitle`, lines 62-109).

**For the present bundles, the legacy fallback path fires** — `ceeAnalysisReady` is null in both bundles, so the wire-driven branch (lines 293-350) is skipped and execution falls through to lines 352-447.

### 1.2 Why `analysis_ready` is null on the wire

**CEE producer.** `buildAnalysisReadyPayload()` in [src/cee/transforms/analysis-ready.ts:377](src/cee/transforms/analysis-ready.ts#L377) — primary, runs in the unified pipeline. Structural fallback `computeStructuralReadiness()` in [src/orchestrator/tools/analysis-ready-helper.ts:145-239](src/orchestrator/tools/analysis-ready-helper.ts#L145-L239) — used by handlers that build a synthetic graph post-mutation, returns `undefined` when `graph.nodes.find((n) => n.kind === 'goal')` finds nothing (line 148).

**Wire-emission sites in V5 dispatch.** Only one:
- [draft-graph-dispatch.ts:149](src/orchestrator-v5/handlers/draft-graph-dispatch.ts#L149) — conditionally spreads `analysis_ready` into the response when `graphPersisted && result.analysisReady`.

**Sites that do *not* emit `analysis_ready` on the wire:**
- [edit-graph-dispatch.ts:218](src/orchestrator-v5/handlers/edit-graph-dispatch.ts#L218) — `editResultToOlumiResponse(editResult, payload)` builds a response without an `analysis_ready` field. Confirmed by `grep -n "analysis_ready\|analysisReady" src/orchestrator-v5/handlers/edit-graph-dispatch.ts` returning zero matches.
- TurnExecutor compose paths at [turn-executor.ts:947-1063](src/orchestrator-v5/turn-executor.ts#L947-L1063) — `composeToolCallResponse`, `composeClarifyResponse`, `composeDirectAnswerResponse` are all called *without* an `analysis_ready` argument. The local `analysisReadyForTurn` (computed at lines 368-378) is passed only to `generateChips()` (lines 952, 990, 1025, 1055), which uses it to gate the chip suggestion set; it never reaches the response envelope.
- [validation-failure-responses.ts:380-428](src/orchestrator-v5/compose/validation-failure-responses.ts#L380-L428) — `wrapResponse()` returns an `OlumiResponse` with `assistant_text`, `blocks`, `suggested_actions`, `insights`, `stage_indicator` — no `analysis_ready` field.

**TurnExecutor request-side telemetry.** [turn-executor.ts:419](src/orchestrator-v5/turn-executor.ts#L419) sets `analysisStateSource: 'absent'` whenever the UI did not send `options.analysisState` on the request — this is **a different field** (the prior PLoT analysis snapshot the UI echoes back), unrelated to the `analysis_ready` envelope CEE sends to UI. The Render-log signal cited in the brief refers to this field.

### 1.3 PLoT `/v2/run` preconditions — was PLoT actually called?

**No.** Both bundles show `payloads.plot_request === null` and `payloads.plot_response === null`. The bundle gates pane reads `run: fail` because the gate code interprets "no PLoT call" as a run-stage failure for display purposes (the gate message reads `" [corrected: pipeline succeeded]"`, indicating the pipeline-success classifier overrode an earlier failure judgement). Treat the gate panel as "analysis never attempted", not as a PLoT rejection.

For completeness, the documented PLoT preconditions (used in the precondition table in §3) — none of which were actually evaluated, since no request was made:

- **400** (Fastify schema): `graph` object required; `options` array required, `minItems: 2`, each with `id`/`label`/`interventions`; `goal_node_id` non-empty; no unknown top-level keys ([plot-lite-service src/routes/v2/run.ts:2455-2479](../../../plot-lite-service/src/routes/v2/run.ts#L2455-L2479)).
- **422** (preflight, [src/validation/preflight-v2.ts](../../../plot-lite-service/src/validation/preflight-v2.ts)): `MISSING_GOAL_NODE`, `GOAL_NODE_NOT_IN_GRAPH`, `NO_OPTIONS`, `EMPTY_INTERVENTIONS` (per option), `INVALID_INTERVENTION_TARGET`, `INVALID_INTERVENTION_VALUE`, `GRAPH_CYCLE_DETECTED`, `IDENTICAL_OPTIONS`, `NO_PATH_TO_GOAL`. There is no `/v2/precheck` endpoint; validation-without-execution requires a real POST.

### 1.4 UI legacy fallback — what produced the visible blocker

[usePreRunValidation.ts:283-447](../../../DecisionGuideAI/src/canvas/hooks/usePreRunValidation.ts#L283-L447). When `ceeAnalysisReady?.options?.length` is falsy (line 293), the function falls through to the legacy block:

```
// line 357-358
const optionNodes = nodes.filter(
  (n) => n.type === 'option' || n.type === 'decision'
)
```

For both bundles, `optionNodes` therefore contains 4 entries: 1 decision (`dec_hiring` / `dec_marketing`) + 3 options. The 3 option nodes' interventions are stored at `node.interventions` (top-level), not `node.data.interventions` — confirmed by `jq` extraction from `bundle.full_graph.options`:

```
opt_status_quo.interventions.fac_role_type    = { value: 0,    source: "brief_extraction", target_match: {…} }
opt_status_quo.interventions.fac_headcount    = { value: 0,    unit: "FTE", … }
opt_tech_lead.interventions.fac_role_type     = { value: 1,    … }
opt_tech_lead.interventions.fac_headcount     = { value: 0.2,  … }
opt_two_devs.interventions.fac_role_type      = { value: 0,    … }
opt_two_devs.interventions.fac_headcount      = { value: 0.4,  … }
```

`normaliseOptionFromLegacyNode()` at [options.ts:213-273](../../../DecisionGuideAI/src/types/options.ts#L213-L273) reads `node.data.interventions` (line 221) and only accepts `typeof value === 'number'` (line 223). It cannot find or unwrap the `InterventionV3` payload above. `hasValidInterventions` stays false → `status: 'needs_user_mapping'` (line 257). All 4 nodes return `'needs_user_mapping'`.

`needsMappingOptions` filter at [usePreRunValidation.ts:381-386](../../../DecisionGuideAI/src/canvas/hooks/usePreRunValidation.ts#L381-L386) excludes empty baselines via `detectBaseline(o.label).isBaseline`. For bundle 1, only `opt_status_quo` ("Make No New Hire (Status Quo)") matches the baseline keyword set; the decision and the two non-status-quo options remain. So `needsMappingOptions = [dec_hiring, opt_tech_lead, opt_two_devs]` (3 entries).

Edge check at lines 388-395: `optionIds` includes the decision id; for the decision node, every outgoing edge typically targets an option (decision→option), and `!optionIds.has(e.target)` filters those out. The decision contributes **no** qualifying edge, so `allOptionsHaveEdges` is false, and the blocker fires at line 403-411 with `affectedIds` including `dec_hiring`. The decision label propagates into the rendered blocker.

### 1.5 Decision-node label appearance in the blocker (P0)

Confirmed root cause: [usePreRunValidation.ts:357-358](../../../DecisionGuideAI/src/canvas/hooks/usePreRunValidation.ts#L357-L358) selects decision nodes alongside option nodes in the legacy fallback, and `normaliseOptionFromLegacyNode` returns them with `status: 'needs_user_mapping'`. The decision's id is then included in `OPTIONS_NEED_MAPPING.affectedIds`. `BlockerTitle` at [BlockersSection.tsx:62-109](../../../DecisionGuideAI/src/canvas/components/pre-analysis/BlockersSection.tsx#L62-L109) maps those ids to labels and renders them.

This is a **fallback-only** defect. The wire-driven path at lines 293-350 reads `ceeAnalysisReady.options[]` directly and never sees the decision node. The two paths diverge precisely on whether the decision node is in scope.

### 1.6 Validator rejections — what tool call did Sonnet actually propose?

The bundles capture the **user-facing CEE response** but not the LLM tool-call payload (`cee_observability`, `cee_trace`, `llm_calls` are all `null` in both bundles). I therefore cannot read Sonnet's exact arguments. What I *can* confirm by reverse-mapping the assistant text to the composer templates:

**Bundle 1, turn id `7ae136c6`**, user message `"Let's add an option of starting with a contract tech leader, while we look for the other two hires."`:
- CEE response `assistant_text: "I need more detail. Which option do you mean?"`
- Matches [validation-failure-responses.ts:142](src/orchestrator-v5/compose/validation-failure-responses.ts#L142) — `composeEntityResolutionAmbiguous` template `ambiguous_no_candidates`, with `kind = 'option'` and `candidates` empty.
- Implication: Sonnet emitted a tool call with `entity_kind: 'option'` and a target identifier the validator could not resolve to a unique candidate (and `details.candidates` arrived empty). I cannot recover the exact identifier from this bundle.

**Bundle 2, turn id `0e9c4123`**, user message `"Proceed."`:
- CEE response `assistant_text: "Marketing Approach for Product Feature Launch is a node, not a option."`
- Matches [validation-failure-responses.ts:172-179](src/orchestrator-v5/compose/validation-failure-responses.ts#L172-L179) — `composeEntityKindMismatch` template `kind_mismatch_structural`, with `proposed_kind = 'node'`, `accepted_kinds[0] = 'option'`, `proposed_label = 'Marketing Approach for Product Feature Launch'`.
- Implication: Sonnet proposed a tool call against the decision node `dec_marketing` (label `"Marketing Approach for Product Feature Launch"`) with `entity_kind: 'node'` while the handler required `entity_kind: 'option'`.

**Should `run_analysis` require a target entity for generic analysis requests?** Almost certainly not. `run_analysis` operates on the whole scenario, not a single entity. The dispatcher should accept the bare verb without an entity and let the dispatcher resolve "the scenario's options". To answer this conclusively I need the actual handler validation registry (look for `run_analysis` in `HANDLER_VALIDATION_REGISTRY` at `src/orchestrator-v5/routing/validation-registry.ts` if that's the path) — out of scope here, but flagged for the fix-design phase.

**To get exact tool-call args next time:** add an LLM-call capture to the debug bundle exporter, or pull Sonnet's request from Render logs via `request_id: 73c6088a-…` / `0e9c4123-…`. Render is the only authoritative source we have for these two turns.

### 1.7 Goal-node representation across layers — confirming "goals not missing"

The user instruction "do not conclude goals missing until you've checked every representation" — checked, and goals are **not** missing.

| Layer | Where the goal lives | Bundle 1 evidence | Bundle 2 evidence |
|---|---|---|---|
| Canvas store (UI) | `nodes[]` with `type: 'goal'` | `display_state.canvas_node_types.goal: 1` | `display_state.canvas_node_types.goal: 1` |
| Bundle export `full_graph` | inside `factors[]` (despite the misleading key name — it actually contains all non-option nodes), with `kind: 'goal'` | `full_graph.factors[5] = { id: 'goal_productivity', label: 'Increase Engineering Productivity', kind: 'goal' }` | (analogous) |
| Canonical `GraphV3T` (CEE/PLoT input shape) | `nodes[]` with `kind: 'goal'` per [src/schemas/cee-v3.ts:402-408](src/schemas/cee-v3.ts#L402-L408) | not directly captured in bundle | not directly captured in bundle |
| Pipeline reported counts | `pipeline.connectivity.goal_count` and `pipeline.node_extraction.validated.goal` | `1` | `1` |

The bundle's `full_graph` projection is a UI-side debug export that splits nodes into a literal `factors[]` (which mixes decision/factor/goal/outcome/risk) and `options[]`. The canonical V3 shape used by both `computeStructuralReadiness` (via `graph.nodes.find((n) => n.kind === 'goal')`) and PLoT `/v2/run` validation is a unified `nodes[]` array. There is no representation mismatch causing the problem; the goal is present everywhere.

---

## Phase 2 — root-cause analysis (three-class structure per Paul's brief)

### Class A — CEE did not emit `analysis_ready` for these turns

**Confirmed.** Both bundle turns are `stage: 'analyse'`, `turn_class: 'frame'`. Neither was `draft_graph`. The wire emission of `analysis_ready` is conditioned on the dispatch being `draft_graph` — see [draft-graph-dispatch.ts:127-149](src/orchestrator-v5/handlers/draft-graph-dispatch.ts#L127-L149). On `edit_graph` and TurnExecutor-routed turns (tool_call / clarify / coach / converse), `analysis_ready` is computed for chip-gating but discarded before response assembly.

This is by design, per the comment at [draft-graph-dispatch.ts:127-129](src/orchestrator-v5/handlers/draft-graph-dispatch.ts#L127-L129) ("so the UI pre-analysis panel can populate without a separate /graph-readiness call"). The design assumes that downstream turns will not change readiness in ways the UI can't infer locally — which is precisely the assumption the legacy fallback violates.

### Class B — UI cleared or failed to persist `analysis_ready`

**Confirmed (with gap — I cannot prove which sub-cause without prior-turn evidence).** The store only writes `ceeAnalysisReady` from `applyDraftResult` at [applyDraftResult.ts:171-176](../../../DecisionGuideAI/src/canvas/utils/applyDraftResult.ts#L171-L176). Sources of `null` at export time:
- The initial `draft_graph` response did include `analysis_ready` and was stored, but a subsequent canvas mutation triggered `invalidateAnalysisReady()` ([store.ts:887-905](../../../DecisionGuideAI/src/canvas/store.ts#L887-L905)) — calls at lines 1418, 1734, 1752 fire on critical-node deletion or critical-edge deletion.
- The UI was reloaded between the draft and the export, and the store's `ceeAnalysisReady` was not rehydrated (would need to check the persistence config — out of scope here).
- The original `draft_graph` response shipped `analysis_ready: undefined` because `result.analysisReady` was null (would happen if `buildAnalysisReadyPayload` returned undefined upstream — possible but not observed in this bundle since the original draft is not captured).

The bundle's `user_actions` array has 3-4 chat-message entries but no canvas-edit entries, suggesting the UI did **not** trigger `invalidateAnalysisReady()` during this session via deletions. That makes the "page reload + no rehydration" or "original draft never shipped one" sub-causes more likely. Confirming requires a debug bundle that captures the prior `draft_graph` response.

### Class C — UI fallback readiness computed blockers incorrectly

**Confirmed.** Two independent defects, already detailed in §1.4 / §1.5:

- **C1.** [usePreRunValidation.ts:357-358](../../../DecisionGuideAI/src/canvas/hooks/usePreRunValidation.ts#L357-L358) — `optionNodes = nodes.filter((n) => n.type === 'option' || n.type === 'decision')`. The decision node is included in the option set.
- **C2.** [options.ts:221-238](../../../DecisionGuideAI/src/types/options.ts#L221-L238) — legacy normaliser reads `node.data.interventions` and accepts only flat numbers; cannot extract from top-level `node.interventions: Record<string, InterventionV3>`.

C2 is the more dangerous defect because it makes the legacy fallback report **all** options as `needs_user_mapping` even when the underlying graph is fully populated — i.e. the fallback gives the user a false negative every time it runs.

C1 makes the blocker text reference the decision node, which is the user-visible artefact Paul highlighted.

### Other contributors

- **Validator rejections (ENTITY_KIND_MISMATCH / ENTITY_RESOLUTION_AMBIGUOUS)** are a separate class — they originate from Sonnet proposing tool calls Grayson the validator rejects. Their composed responses are correct (recoverable, 200, no error block, with chips). They do not directly cause the `analysis_ready` symptom; they're noise in the same bundles. Worth tracking down why `"Proceed."` resolves to a tool call against a decision node with `entity_kind: 'node'` — but separately.
- **Bundle-export key naming (`full_graph.factors[]` containing non-factor kinds)** is misleading and contributed to a false trail in the brief's working hypothesis. Worth filing a UI-side bundle-exporter cleanup, but not load-bearing for the analysis bug.

---

## Phase 2b — readiness-contract comparison table

| Consumer | File | Goal accessor | Options accessor | Intervention accessor |
|---|---|---|---|---|
| `buildAnalysisReadyPayload` (CEE primary) | [src/cee/transforms/analysis-ready.ts](src/cee/transforms/analysis-ready.ts) | `goalNodeId: string` parameter (caller supplies; extracted from `graph.nodes` upstream) | `options: OptionV3T[]` parameter | `option.interventions: Record<factor_id, InterventionV3>` per [src/schemas/cee-v3.ts:315-335](src/schemas/cee-v3.ts#L315-L335) — reads `.value`, not `.raw_value` |
| `computeStructuralReadiness` (CEE fallback) | [src/orchestrator/tools/analysis-ready-helper.ts:148-170](src/orchestrator/tools/analysis-ready-helper.ts#L148-L170) | `graph.nodes.find((n) => n.kind === 'goal')` | `graph.nodes.filter((n) => n.kind === 'option')` | `mergeInterventionSources(node)` reads three locations in priority order: `node.data.interventions`, slash-keyed `node["data/interventions/<facId>"]`, then `node.interventions` (top-level fallback) — accepts both flat numbers and `{value: number, …}` |
| `usePreRunValidation` wire path (UI primary) | [usePreRunValidation.ts:293-350](../../../DecisionGuideAI/src/canvas/hooks/usePreRunValidation.ts#L293-L350) | `ceeAnalysisReady.goal_node_id` | `ceeAnalysisReady.options[]` | `option.interventions` from `ceeAnalysisReady` payload (per CEE contract, already a `Record<factor_id, number>` after `analysisReadyPayload` projection) |
| `usePreRunValidation` legacy fallback (UI secondary) | [usePreRunValidation.ts:352-447](../../../DecisionGuideAI/src/canvas/hooks/usePreRunValidation.ts#L352-L447) + [options.ts:221-238](../../../DecisionGuideAI/src/types/options.ts#L221-L238) | not checked — fallback path doesn't validate goal presence; relies on `setOutcomeNode` having been called on canvas | **`nodes.filter((n) => n.type === 'option' \|\| n.type === 'decision')`** — includes decision (DEFECT C1) | `node.data.interventions` only, `typeof value === 'number'` only — **misses top-level `node.interventions` and misses `InterventionV3` object shape** (DEFECT C2) |
| PLoT `/v2/run` request schema | [plot-lite-service src/routes/v2/run.ts:826-870](../../../plot-lite-service/src/routes/v2/run.ts#L826-L870) | `body.goal_node_id: string, minLength: 1` | `body.options[]: minItems: 2`, each with `id` + `label` + `interventions` | `option.interventions: Record<node_id, InterventionValueV3>` where `InterventionValueV3 = { value: number, source }` — flat-number form auto-normalised |
| PLoT `/v2/run` preflight | [plot-lite-service src/validation/preflight-v2.ts:120-481](../../../plot-lite-service/src/validation/preflight-v2.ts#L120-L481) | `MISSING_GOAL_NODE` (line 120), `GOAL_NODE_NOT_IN_GRAPH` (131) | `NO_OPTIONS` (149), `IDENTICAL_OPTIONS` (450) | `EMPTY_INTERVENTIONS` (188), `INVALID_INTERVENTION_TARGET` (202), `INVALID_INTERVENTION_VALUE` (218), `NO_PATH_TO_GOAL` (481) |

**Mismatches across the table:**
- The CEE primary computes from a typed `OptionV3T[]` slice (no traversal). The CEE fallback traverses `graph.nodes` and is intervention-shape-tolerant. The UI wire path matches the CEE primary's contract. The UI legacy fallback diverges from all three: it traverses the canvas-side React-Flow `nodes[]` (`node.type`, `node.data.*`) instead of the V3 shape (`node.kind`, `node.interventions`), and it includes decision nodes.
- This is consistent with the legacy fallback originating from a pre-V3 era when canvas data lived under `node.data.*` and decisions were treated as a special kind of option. The fix is to either (a) migrate the fallback to the V3 shape, or (b) delete the fallback now that wire-driven readiness is the contract — the comment at line 354-356 explicitly says "Remove this fallback once all paths reliably provide analysis_ready."

---

## Phase 3 — precondition table per bundle

| Precondition | Required value | Bundle 1 (hiring `73c6088a`) | Bundle 2 (marketing `d90cfe97`) | Pass / Fail |
|---|---|---|---|---|
| `≥1` goal node in graph | 1+ | 1 (`goal_productivity`, kind `goal`) | 1 (kind `goal`) | both pass |
| `≥2` non-baseline options | 2+ | 2 (`opt_tech_lead`, `opt_two_devs`; `opt_status_quo` is baseline) | 2 (`opt_ai_tool`, `opt_hire_manager`; `opt_status_quo` is baseline) | both pass |
| Each option has `≥1` intervention | yes | 3/3 options have 2 interventions each (`fac_role_type`, `fac_headcount`) | 3/3 options have intervention data per `display_state.rendered_options` value displays | both pass |
| Intervention `target_match.node_id` valid factor id | yes | `fac_role_type`, `fac_headcount` both present in `factors[]` (kind `factor`) with `match_type: exact_id, confidence: high` | analogous (4 factors present, exact_id matches) | both pass |
| Intervention `value` numeric | yes | yes (0, 0.2, 0.4, 1) | yes per `display_state.rendered_factors[].value_displayed` | both pass |
| Edges connecting options→factors exist | yes | `bundle.full_graph.edges`: 22 edges | 24 edges | both pass (specific source→target audit not done — edges sample shows expected option→factor patterns) |
| Intervention has path to goal (PLoT `NO_PATH_TO_GOAL`) | yes | not evaluated — PLoT never called | not evaluated — PLoT never called | unknown (preflight never ran) |
| Graph is acyclic (PLoT `GRAPH_CYCLE_DETECTED`) | yes | not evaluated | not evaluated | unknown (preflight never ran) |
| `analysis_ready` emitted by CEE on this turn | per draft_graph design | no — turn was `frame`, dispatch went via recoverable validator → no `analysis_ready` field | no — turn was `frame`, same path | both fail |
| `analysis_ready` present in UI store at export time | yes | no — `analysis_ready: null` | no — `analysis_ready: null` | both fail |
| UI readiness check (wire-driven path) passes | required | not run — `ceeAnalysisReady` null, falls through | not run | both bypass |
| UI readiness check (legacy fallback) passes | required for `Run analysis` chip | no — decision node lands in `needsMappingOptions`, blocker fires | no — same | both fail |
| PLoT `/v2/run` would accept this graph (hypothetical) | per §1.3 schema + preflight | likely yes — if `analysis_ready.goal_node_id` set to `goal_productivity`, options mapped, interventions normalised. Cycle/path checks not pre-confirmed but bundle has no obvious cycles. | likely yes (analogous) | both probably-pass-if-called (but never called) |

**Net:** the underlying graphs in both bundles are PLoT-ready in shape. They never reach PLoT because the UI gating (legacy fallback → blocker → chip not enabled) blocks the request.

---

## Recommended fix direction

**Locality:** UI-only is sufficient to resolve the user-visible symptom for both bundles. CEE is reachable but more invasive.

**Recommended (UI-only, surgical):**

1. **Drop `decision` from the legacy `optionNodes` filter** at [usePreRunValidation.ts:357-358](../../../DecisionGuideAI/src/canvas/hooks/usePreRunValidation.ts#L357-L358):
   ```diff
   - const optionNodes = nodes.filter((n) => n.type === 'option' || n.type === 'decision')
   + const optionNodes = nodes.filter((n) => n.type === 'option')
   ```
   Removes the decision-node-as-option misclassification entirely (defect C1).

2. **Teach the legacy normaliser the V3 intervention shape** at [options.ts:213-273](../../../DecisionGuideAI/src/types/options.ts#L213-L273):
   - Read both `node.interventions` (top-level) and `node.data.interventions` (legacy).
   - Unwrap `{ value: number, … }` objects in addition to flat numbers — mirror the precedence order in [analysis-ready-helper.ts:76-129](src/orchestrator/tools/analysis-ready-helper.ts#L76-L129) (`mergeInterventionSources`).

3. (Optional, but worth considering) **Delete the legacy fallback entirely** if every CEE-reachable path now ships `analysis_ready` reliably. The TODO at [usePreRunValidation.ts:354-356](../../../DecisionGuideAI/src/canvas/hooks/usePreRunValidation.ts#L354-L356) says exactly this. Class A makes deletion premature today, but if Class A is also fixed, deletion becomes safe.

**Architectural (CEE, larger):**

4. **Ship `analysis_ready` on every turn that has a graph.** TurnExecutor already computes `analysisReadyForTurn` at lines 368-378 for chip-gating. Pass it into the compose layer (`composeToolCallResponse` / `composeClarifyResponse` / `composeDirectAnswerResponse` / `composeRecoverableValidationResponse`) and wire it into the response envelope for any turn where `graphStateForTurn` is present. This eliminates Class A and reduces the load on UI store invalidation timing.

The minimal fix is **(1)+(2)**. They're 10-line changes confined to two files in the UI repo. **(4)** is the right architectural fix but is not strictly required to unblock the user.

---

## Unknown unknowns surfaced during tracing

1. **Why does Sonnet emit a tool call against the decision node when the user says "Proceed."?** The `composeEntityKindMismatch` template_id was `kind_mismatch_structural` — meaning the validator rejected with `proposed_kind: 'node'` and `accepted_kinds[0]: 'option'`. Without the LLM-call payload (`cee_observability` was null in the bundle) I can't see the proposed handler or the proposed argument shape. Likely `run_analysis` or `inspect_node` with the decision as target — but speculation. Render logs by `request_id 0e9c4123` would resolve this.

2. **Whether `run_analysis` should require any target entity at all.** For the generic "Proceed → run the analysis" case, the validator should accept `run_analysis` without an entity argument. If the routing prompt is asking Sonnet to always supply a target entity, that's a prompt issue. If the validator is rejecting the absent entity, that's a registry issue. Either way — the recoverable response is correct, but the underlying intent is being lost.

3. **Why both bundles show `environment: development` and `client_build: dev1234`** when the brief described them as "staging". Possible causes: bundles captured in dev session before staging deployment; bundle exporter mis-labels staging as development in some build path; mistake in the brief. Worth resolving before assigning the fix to a deploy.

4. **Bundle exporter completeness gap.** `cee_observability`, `cee_trace`, `llm_calls`, `request_id_chain.cee_trace_id`, `builds.{cee,plot,isl}` are all `null` in both bundles. The bundle is supposed to carry these (per the README), so something in the dev build is dropping them. Independent UI-side bug worth filing — until it's fixed, Render logs are the only source for LLM-call introspection.

5. **Does the legacy fallback ever actually save the user when CEE fails?** The fallback's intervention extraction is broken (defect C2), so even when the underlying graph is valid, the fallback reports `needs_user_mapping`. There may be no scenario in which the fallback produces a useful result today. If true, deletion is the right answer (recommendation 3).

6. **Whether `setCeeAnalysisReady(null)` on persistence load is the actual loss path** for the two bundle scenarios. The store is configured (per the file header) to clear `ceeAnalysisReady` on critical-node delete. The bundle's `user_actions` shows no delete actions, but the store may also clear on undo/redo, on session reload, or on an explicit "new draft" action. A bundle that captures the *first* draft's response would settle whether `setCeeAnalysisReady` was called and whether subsequent state lost it.

---

**Diagnostic complete. No code changes. No commits.**
