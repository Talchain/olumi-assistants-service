# Intervention authority contract
Date: 8 April 2026
Status: Active (enforced by [envelope.ts:287-373](src/orchestrator/envelope.ts#L287-L373) since 2026-04-08)

## Canonical source

`analysis_ready.options[].interventions` as produced by the action handler is the **single source of truth** for engine readiness. Every other representation of intervention data — on graph nodes, in the canvas store, in adapter intermediates — is a derived view.

The handler is the authoritative producer. The envelope validates the handler's payload but never mutates it. The UI consumes the payload via `setCeeAnalysisReady` and uses it directly when assembling PLoT requests.

## Derived sources (not authoritative)

### `node.data.interventions` — UI display cache

Populated by [`backfillInterventionsOntoOptionNodes`](../../DecisionGuideAI/src/canvas/utils/applyDraftResult.ts#L235) (UI repo). Read by:

- [`OptionNode.tsx`](../../DecisionGuideAI/src/canvas/nodes/OptionNode.tsx) (rendering)
- [`FactorNode.tsx`](../../DecisionGuideAI/src/canvas/nodes/FactorNode.tsx) (hover overlays)
- [`islRequestAdapter.ts`](../../DecisionGuideAI/src/canvas/adapters/islRequestAdapter.ts) (ISL request building)
- [`useScenarioComparison.ts`](../../DecisionGuideAI/src/canvas/hooks/useScenarioComparison.ts) (scenario comparison)
- [`exportBundle.ts`](../../DecisionGuideAI/src/components/debug/utils/exportBundle.ts) (debug bundle export)
- [`adapter.ts:reconcileOptionsWithCanvasNodes`](../../DecisionGuideAI/src/adapters/plot/v2/adapter.ts#L349) (PLoT v2 fallback when analysisReady is empty)

This is **transitional**. The cache exists because these consumers read directly from the canvas store rather than from `ceeAnalysisReady`. Each consumer should migrate to read from `useCanvasStore.getState().ceeAnalysisReady.options[]` and the cache should be retired. See "Removal plan" below.

### `node.interventions` (top-level on `NodeV3`) — pipeline output for canvas rendering

Defined at [`cee-v3.ts:131-134`](src/schemas/cee-v3.ts#L131-L134) as `interventions: z.record(z.string(), z.any()).optional()`. The schema comment explicitly notes: *"Intervention bundle copied from options[] for canvas display (option-kind nodes only). options[] remains the canonical source for analysis; graph nodes carry this for ConnRow rendering."*

Read by [`mergeInterventionSources`](src/orchestrator/tools/analysis-ready-helper.ts#L58-L114) as fallback source 3. Whether the pipeline actually populates this field on a given option node depends on which pipeline phase produced the graph; it is **not guaranteed** and must not be treated as authoritative.

### `node.data/interventions/<fac_id>` — slash-keyed scalar wrapping

A flat-key form of `node.data.interventions` produced by some scalar wrapping paths. Read by `mergeInterventionSources` as source 2, gated behind `CEE_EDIT_INTERVENTION_ROUTING_ENABLED`. Same status as the other node-level forms: derived, not authoritative.

## Allowed transforms

The only transforms permitted to produce or rewrite intervention values are:

| Transform | Location | Input | Output |
|---|---|---|---|
| `extractAnalysisReady` | [draft-graph.ts:460-560](src/orchestrator/tools/draft-graph.ts#L460-L560) | Pipeline `body.analysis_ready` (mixed shapes incl. `{value, unit, source}` objects) | Flat `Record<string, number>` on the patch block's `analysis_ready` |
| `computeStructuralReadiness` | [analysis-ready-helper.ts:130-199](src/orchestrator/tools/analysis-ready-helper.ts#L130-L199) | `GraphV3T` (synthetic post-patch graph from add_option / edit_graph / draft_graph fallback) | `analysis_ready` payload with flat numeric interventions |
| `transformOptionToAnalysisReady` | [src/cee/transforms/analysis-ready.ts:70](src/cee/transforms/analysis-ready.ts#L70) | `OptionV3` from the unified pipeline | `OptionForAnalysisT` (canonical numeric form) |
| `flattenInterventions` | [DecisionGuideAI/src/adapters/plot/v2/adapter.ts:205-224](../../DecisionGuideAI/src/adapters/plot/v2/adapter.ts#L205-L224) | Mixed-shape interventions at the PLoT request boundary | Flat `Record<string, number>` for the V2Option wire format |

**No other code path may produce or overwrite `analysis_ready`.** The previous `recomputeAnalysisReady` at [envelope.ts:283-302](src/orchestrator/envelope.ts) was deleted on 2026-04-08 because it violated this rule by overwriting handler output with a graph-derived recomputation. See [intervention-lifecycle-and-health-audit-2026-04-08.md §6](intervention-lifecycle-and-health-audit-2026-04-08.md) for the full incident analysis.

## Validation (envelope-level)

The envelope at [envelope.ts:287-373](src/orchestrator/envelope.ts#L287-L373) runs `validateAnalysisReadyOnBlocks` on every assembled response:

1. **Missing payload** on `status='proposed'` graph_patch blocks → log warning (`'graph_patch block has no analysis_ready — handler should provide one'`).
2. **Missing or non-array `options` field** on any present payload → log warning, never throw.
3. **Zod schema mismatch** on any present payload → log warning with the first 3 error paths.
4. **Never mutates** `data.analysis_ready`.

This is graceful degradation: malformed payloads pass through unchanged so the UI sees what the handler produced (even if buggy), and operators see the warning in logs to fix the upstream handler.

## Transitional state

UI backfills at [`applyDraftResult.ts:235`](../../DecisionGuideAI/src/canvas/utils/applyDraftResult.ts#L235) (`backfillInterventionsOntoOptionNodes`) and [`applyDraftResult.ts:304`](../../DecisionGuideAI/src/canvas/utils/applyDraftResult.ts#L304) (`backfillGoalThresholdOntoGoalNode`) remain active because the consumers listed under "Derived sources" still read from `node.data.interventions` directly. Removing the backfills today would break:

- Option/factor rendering on the canvas
- ISL request assembly
- Scenario comparison
- The debug bundle export
- The PLoT v2 adapter's fallback when `analysisReady` is incomplete

**Target:** retire the backfills once every consumer migrates to reading `useCanvasStore.getState().ceeAnalysisReady.options[]`. Telemetry added on 2026-04-08 (see `applyDraftResult.ts` and `adapter.ts`) tracks how often the backfill paths fire post-fix; if they trend to zero in production, the backfills can be removed.

## Removal plan (tracked work)

1. **Migrate `OptionNode` and `FactorNode`** to read interventions from `ceeAnalysisReady.options[]` via a hook (`useOptionInterventions(optionId)`). Largest blast radius — these are render-path components.
2. **Migrate `islRequestAdapter`** to take `analysis_ready` as input rather than canvas nodes.
3. **Migrate `useScenarioComparison`** to read from `ceeAnalysisReady` per scenario.
4. **Migrate `exportBundle`** to capture `ceeAnalysisReady` directly rather than the node-level mirror.
5. **Confirm `reconcileOptionsWithCanvasNodes` fallback path is no longer hit** (telemetry should show zero backfills).
6. **Delete `backfillInterventionsOntoOptionNodes` and `backfillGoalThresholdOntoGoalNode`**.

Steps 1-5 are not tracked under this brief; this document records the contract so the removal can be executed cleanly when the team is ready.

## Cross-reference

- Handler matrix: [Docs/graph-patch-handler-matrix.md](graph-patch-handler-matrix.md)
- Original investigation: [Docs/intervention-lifecycle-and-health-audit-2026-04-08.md](intervention-lifecycle-and-health-audit-2026-04-08.md)
- Validator implementation: [src/orchestrator/envelope.ts:287-373](src/orchestrator/envelope.ts#L287-L373)
