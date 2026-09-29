# Graph patch handler matrix
Date: 8 April 2026
Author: Companion to Docs/intervention-lifecycle-and-health-audit-2026-04-08.md and the 2026-04-08 envelope fix.

This is a complete inventory of every action handler that returns `ActionResult.operations` (and therefore causes [response-assembler.ts:91-105](src/orchestrator/deterministic/response-assembler.ts#L91-L105) or [pipeline-v4.ts:664-682](src/orchestrator/deterministic/pipeline-v4.ts#L664-L682) to emit a `graph_patch` block), plus the two LLM tool handlers in `src/orchestrator/tools/` that emit graph_patch blocks directly via `createGraphPatchBlock`.

After [envelope.ts:283-302](src/orchestrator/envelope.ts#L283-L302) was changed on 2026-04-08 to validate (not recompute) `analysis_ready`, **the action handler is the authoritative producer**. Any handler that emits a graph_patch block on `status='proposed'` without `analysis_ready` will be flagged by the envelope validator as a warning.

## Matrix

| Handler | Produces graph_patch? | Produces analysis_ready? | Readiness source | Creates/modifies options? | Notes |
|---|---|---|---|---|---|
| **add_option** ([actions/add-option.ts:151-237](src/orchestrator/deterministic/actions/add-option.ts#L151-L237)) | Yes (via response-assembler) | Yes | `computeStructuralReadiness` against synthetic post-patch graph; mirrors interventions onto both `node.data.interventions` and top-level `node.interventions` (lines 156-201) | **Yes** — creates new option node + intervention edges | Validates against `AnalysisReadyPayload` Zod schema (line 217); parse failure is non-fatal, payload still emitted. |
| **add_factor** ([actions/add-factor.ts:104-148](src/orchestrator/deterministic/actions/add-factor.ts#L104-L148)) | Yes | **No** | n/a | No (creates a factor node + edges to goal; no option mutation) | **Validator gap** — emits graph_patch with no analysis_ready. The prior turn's analysis_ready remains structurally valid because no option's interventions are touched, so the validator's missing-payload warning here is benign. The "redirect to update existing factor" branch (lines 60-99) also emits operations without analysis_ready — same reasoning. |
| **set_factor_value** ([actions/set-factor-value.ts:78-94](src/orchestrator/deterministic/actions/set-factor-value.ts#L78-L94)) | Yes | **No** | n/a | No (updates `observed_state.value` only) | **Validator gap (benign)** — `observed_state` lives on the factor node and is independent of `analysis_ready.options[].interventions`. Prior payload remains structurally valid. |
| **adjust_edge_strength** ([actions/adjust-edge-strength.ts:92-105](src/orchestrator/deterministic/actions/adjust-edge-strength.ts#L92-L105)) | Yes | **No** | n/a | No (updates edge `strength.mean`) | **Validator gap (benign)** — edge strength is independent of intervention values. Prior payload remains valid. |
| **set_goal_target** ([actions/set-goal-target.ts:50-65](src/orchestrator/deterministic/actions/set-goal-target.ts#L50-L65)) | Yes | **No** | n/a | No (updates `goal_threshold/unit/cap`) | **Validator gap (benign)** — goal threshold is separate from option interventions. Prior payload remains valid. |
| **add_constraint** ([actions/add-constraint.ts:87-100](src/orchestrator/deterministic/actions/add-constraint.ts#L87-L100)) | Yes | **No** | n/a | No (appends to `goal_constraints[]` on goal node) | **Validator gap (benign)** — constraints are separate from option interventions. Prior payload remains valid. |
| **remove_factor** ([actions/remove-factor.ts:88-203](src/orchestrator/deterministic/actions/remove-factor.ts#L88-L203)) | Yes | **Yes** (since 2026-04-08) | `computeStructuralReadiness` against a synthetic post-removal graph that prunes the removed factor from option intervention maps (all 3 storage locations) and drops the connected edges | **Indirectly: yes** — if any option's interventions referenced this factor, the recomputed `analysis_ready` no longer references the deleted node | Mirrors `add_option`'s synthetic-graph pattern. Validates against `AnalysisReadyPayload` Zod schema; parse failure is non-fatal. See "Fixed gap" section below. |
| **draft_graph** ([tools/draft-graph.ts:148-166](src/orchestrator/tools/draft-graph.ts#L148-L166)) | Yes (created directly via `createGraphPatchBlock`) | Yes | `extractAnalysisReady(body)` if pipeline emitted one, else `computeStructuralReadiness(graphOutput)` ([draft-graph.ts:160-163](src/orchestrator/tools/draft-graph.ts#L160-L163)) | **Yes** — drafts the entire graph including all options + interventions | Validates against `AnalysisReadyPayload` Zod schema in `extractAnalysisReady` ([draft-graph.ts:545](src/orchestrator/tools/draft-graph.ts#L545)); returns `undefined` (omitted from block) on parse failure rather than emitting malformed. |
| **edit_graph (main path)** ([tools/edit-graph.ts:2201-2226](src/orchestrator/tools/edit-graph.ts#L2201-L2226)) | Yes | Yes | `computeStructuralReadiness(appliedGraph ?? candidateGraph)` ([edit-graph.ts:2202-2203](src/orchestrator/tools/edit-graph.ts#L2202-L2203)) | **Yes** — LLM-driven structural edits can add/remove/modify options | Computes from post-PLoT applied_graph when available, falls back to the candidate graph. |
| **edit_graph (constraint shortcut)** ([tools/edit-graph.ts:1380-1410](src/orchestrator/tools/edit-graph.ts#L1380-L1410)) | Yes (created directly via `createGraphPatchBlock`) | **No** | n/a | No (constraint-only update on goal node) | **Validator gap (benign)** — same reasoning as `add_constraint`. |
| **edit_graph (rejection path)** ([tools/edit-graph.ts:2335-2365](src/orchestrator/tools/edit-graph.ts#L2335-L2365)) | Yes (status: `'rejected'`) | **No** | n/a | n/a | Not flagged by validator — the new validator at [envelope.ts:304-311](src/orchestrator/envelope.ts#L304-L311) only warns on missing payload when `status === 'proposed'`. |

## Validator behaviour summary

The post-2026-04-08 validator at [envelope.ts:287-373](src/orchestrator/envelope.ts#L287-L373):

1. **Skips** non-graph_patch blocks entirely.
2. **Warns on missing analysis_ready** only when `status === 'proposed'` (not for accepted/rejected/dismissed, which never carry one by design).
3. **Validates payload shape** whenever `analysis_ready` is present, regardless of status — guards with `Array.isArray` so it never throws.
4. **Never mutates** `data.analysis_ready`.

Of the 11 handler paths above, 7 will trigger the missing-payload warning on every invocation (`add_factor`, `set_factor_value`, `adjust_edge_strength`, `set_goal_target`, `add_constraint`, edit_graph constraint shortcut, and add_factor's "redirect" branch). All 7 are **benign** — the patch doesn't touch option interventions and the prior payload remains structurally valid. `remove_factor` was previously the eighth (a real bug); fixed on 2026-04-08.

## Fixed gap (2026-04-08): stale `analysis_ready` after `remove_factor`

**Original problem.** `remove_factor` used to remove a factor node and its connected edges without producing a fresh `analysis_ready`. If the factor being removed was the target of any option's intervention (i.e. `analysis_ready.options[i].interventions[fac_id]` existed), then after the patch was applied:

- The UI store still had the prior `ceeAnalysisReady` payload referencing the removed factor.
- The next `run_analysis` call assembled a PLoT request that included an intervention targeting a now-non-existent node.
- PLoT rejected with `INVALID_INTERVENTION_TARGET` ([plot-lite-service/src/validation/preflight-v2.ts:204](../plot-lite-service/src/validation/preflight-v2.ts#L204)).

**Fix shipped on 2026-04-08.** `remove-factor.ts` now mirrors `add-option`'s synthetic-graph pattern:

1. Builds a read-only synthetic graph from `ctx.graph` with the removed factor node filtered out.
2. Filters connected edges directly by endpoint against `ctx.graph.edges` (decoupled from the `entities.edges`-based operation enumeration so any drift between the two cannot leave dangling edges in the synthetic graph).
3. Walks every option node and prunes the removed factor key from all three intervention storage locations (`node.data.interventions`, `node["data/interventions/<fac_id>"]`, and top-level `node.interventions`) so `mergeInterventionSources` cannot re-emit the stale key.
4. Calls `computeStructuralReadiness(syntheticGraph)` and validates the result against `AnalysisReadyPayload` Zod schema (parse failure non-fatal — emits anyway so the envelope validator surfaces a structured warning).
5. Returns the fresh payload alongside the patch operations.

Pinned by 7 unit tests in `tests/unit/orchestrator/deterministic/actions/remove-factor.test.ts`:
- Removed factor is absent from every option's recomputed interventions.
- `goal_node_id` is preserved.
- Per-option status reflects remaining interventions (`'ready'` if any remain).
- Option whose only intervention targeted the removed factor gracefully degrades to `'needs_user_mapping'` (empty interventions, no connected factors after edge removal).
- `ctx.graph` is NOT mutated (read-only synthetic graph contract).
- Slash-keyed intervention storage (source 2) is also pruned.
- The handler still emits `remove_node` and `remove_edge` patch operations alongside `analysis_ready`.

## Other downstream effects worth knowing

`add_factor` creates a factor an option might later reference, but the prior `analysis_ready` doesn't yet reference it — so no staleness. `set_factor_value` and `adjust_edge_strength` change quantitative properties that PLoT reads from the graph at run time, not from `analysis_ready`. `set_goal_target` and `add_constraint` are similar.

The gap is specifically: **handlers that remove or rename graph elements that the prior `analysis_ready` references**. Within the current handler set, only `remove_factor` falls into this category. (Hypothetical future handlers like `rename_factor` or `remove_option` would too.)

## Cross-reference

- The canonical contract: [Docs/intervention-authority-contract.md](intervention-authority-contract.md)
- The original investigation: [Docs/intervention-lifecycle-and-health-audit-2026-04-08.md](intervention-lifecycle-and-health-audit-2026-04-08.md)
- The validator implementation: [src/orchestrator/envelope.ts:287-373](src/orchestrator/envelope.ts#L287-L373)
