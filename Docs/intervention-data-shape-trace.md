# Intervention Data Shape Trace

**Date:** 12 April 2026
**Author:** Investigation (Task 5 of composer template brief)
**Status:** Document only. No code changes.

---

## Summary

The intervention data flows through 4 boundary points. At every boundary, `interventions` is `Record<string, number>` (factor ID to numeric value). The `interventionKeys` variable in `graph-readiness.ts` is a local validation artifact, not a pipeline transformation. The values are never stripped from the data path.

---

## Boundary 1: Draft Graph Output

**File:** `src/cee/extraction/intervention-extractor.ts` (OptionForAnalysis schema)
**File:** `src/orchestrator/tools/draft-graph.ts` (lines 463-589, extractAnalysisReady)

After the unified CEE pipeline completes, each option carries:

```typescript
// Canonical shape
{
  option_id: string;
  label: string;
  status: "ready" | "needs_user_mapping" | "needs_encoding";
  interventions: Record<string, number>;          // { "fac_price": 0.75 }
  raw_interventions?: Record<string, unknown>;    // optional, categorical/boolean
  intervention_details?: Record<string, {         // optional, display metadata
    display_value: string;
    normalised_value: number;
    unit?: string;
  }>;
}
```

**Concrete example:**
```json
{
  "option_id": "option_premium_pricing",
  "label": "Premium pricing strategy",
  "status": "ready",
  "interventions": { "fac_price": 0.75, "fac_marketing_spend": 0.6 },
  "raw_interventions": { "fac_price": "75%" },
  "intervention_details": {
    "fac_price": { "display_value": "75% increase", "normalised_value": 0.75, "unit": "percentage" }
  }
}
```

---

## Boundary 2: add-option Handler

**File:** `src/orchestrator/deterministic/actions/add-option.ts`
**Function:** `normaliseInterventions()` (lines 225-245)

Accepts either array or object format, always returns `Record<string, number>`.

**Before (user input via LLM tool call):**
```json
{
  "label": "Fast-track option",
  "interventions": [
    { "factor_id": "fac_timeline", "value": 0.9 },
    { "factor_id": "fac_budget", "value": 0.5 }
  ]
}
```

**After (normalised, stored on option node):**
```json
{
  "id": "option_fast_track",
  "kind": "option",
  "label": "Fast-track option",
  "data": {
    "interventions": { "fac_timeline": 0.9, "fac_budget": 0.5 }
  },
  "interventions": { "fac_timeline": 0.9, "fac_budget": 0.5 }
}
```

Note: `interventions` is stored in two locations on the node (`data.interventions` and top-level `interventions`) for backward compatibility with `mergeInterventionSources`.

**analysis_ready output:**
```json
{
  "options": [{
    "option_id": "option_fast_track",
    "label": "Fast-track option",
    "status": "ready",
    "interventions": { "fac_timeline": 0.9, "fac_budget": 0.5 }
  }],
  "goal_node_id": "goal_success",
  "status": "ready"
}
```

---

## Boundary 3: Graph Readiness Route (interventionKeys)

**File:** `src/routes/assist.v1.graph-readiness.ts`
**Exact line:** 136

```typescript
const interventionEntries = Object.entries(opt.interventions ?? {});
// => [["fac_price", 0.75], ["fac_marketing_spend", 0.6]]

const interventionKeys = interventionEntries.map(([k]) => k);        // line 136
// => ["fac_price", "fac_marketing_spend"]

const missingTargets = interventionKeys.filter((targetId) => !nodeIds.has(targetId));  // line 137
```

**This is intentional.** `interventionKeys` is a local variable used only to check that each intervention's target factor exists as a node in the graph. The numeric values are not needed for this existence check and are not stripped from the data path. The `opt.interventions` object (with values) remains intact and is returned in the readiness assessment response.

**Before (input to validation):**
```json
{ "interventions": { "fac_price": 0.75, "fac_marketing_spend": 0.6 } }
```

**After (interventionKeys local variable):**
```json
["fac_price", "fac_marketing_spend"]
```

**The values are NOT lost.** They remain on `opt.interventions` which flows through to the response.

---

## Boundary 4: PLoT Request

**File:** `src/orchestrator/tools/run-analysis.ts` (lines 140-163, 253-294)
**File:** `src/orchestrator/plot-client.ts` (lines 217-249, validateRunPayload)

```typescript
// normalizeInterventions() flattens nested { value: number } shapes
// into flat Record<string, number>
const plotOptions = inputs.options.map((opt, idx) => ({
  id: opt.id ?? opt.option_id,
  option_id: opt.option_id,
  label: opt.label,
  interventions: normalizeInterventions(opt.interventions, opt.option_id, idx),
}));
```

**Before (from analysis_ready):**
```json
{
  "option_id": "option_premium",
  "interventions": { "fac_price": 0.75, "fac_marketing_spend": 0.6 }
}
```

**After (PLoT request payload):**
```json
{
  "graph": { "..." : "..." },
  "options": [{
    "id": "option_premium",
    "option_id": "option_premium",
    "label": "Premium pricing",
    "interventions": { "fac_price": 0.75, "fac_marketing_spend": 0.6 }
  }],
  "goal_node_id": "goal_revenue"
}
```

PLoT validation (`plot-client.ts:223-249`) enforces that every `options[i].interventions[factorId]` is a finite number. The values are preserved end-to-end.

---

## Conclusion

The `interventionKeys` variable at `src/routes/assist.v1.graph-readiness.ts:136` is a local validation helper. It extracts factor IDs to check graph membership but does not modify the intervention data flowing through the pipeline. The intervention values (`Record<string, number>`) are preserved from draft extraction through to the PLoT request payload at every boundary.

If debug bundles show `interventionKeys` without values, it is because the debug bundle is logging the local validation variable (the keys array) rather than the full `interventions` object. The fix would be to log `opt.interventions` instead of or alongside `interventionKeys` in the diagnostic output.
