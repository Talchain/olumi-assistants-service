# Prompt Contract Trace & Test Handover

**Date:** 2026-03-26
**Branch:** fix/deterministic-routing-hardening
**Author:** Claude (audit)

---

## Executive Summary

Traced the field contract across edit_graph prompt → CEE normalisation → PLoT validate-patch. Found **5 contract mismatches (M1–M5)**, two of which are P0:

- **M1 [P0 BUG]:** CEE `normaliseEdgeValue()` actively breaks every canonical edge by flattening `strength: { mean, std }` → `strength_mean, strength_std`. PLoT validate-patch rejects these flat fields. Root cause of every edit_graph edge rejection.
- **M5 [P0 BROKEN FLOW]:** Intervention writes via `node.data.interventions` (as taught by the prompt) never reach PLoT's analysis pipeline. `filterOptionNodes()` strips all option nodes before ISL. Interventions only reach analysis from the separate `options[]` request parameter.

Both are currently **silent** because PLoT validate-patch is conditionally invoked (`if (plotClient)` + `ENABLE_VALIDATE_PATCH` flag).

---

## Contract Mismatches

### M1 [P0] — CEE normaliseEdgeValue breaks canonical edge format

**Location:** `src/orchestrator/tools/edit-graph.ts:2289-2305`

```typescript
function normaliseEdgeValue(value: unknown): unknown {
  if (v.strength && typeof v.strength === 'object') {
    const s = v.strength as Record<string, unknown>;
    const { strength, ...rest } = v;
    return {
      ...rest,
      ...(s.mean !== undefined && { strength_mean: s.mean }),   // NON-CANONICAL
      ...(s.std !== undefined && { strength_std: s.std }),       // NON-CANONICAL
    };
  }
  return value;
}
```

**Impact:** Every `add_edge` and `update_edge` operation is broken when PLoT validate-patch is enabled. The prompt teaches the correct format (`strength: { mean, std }`), but CEE's own normalisation layer converts it to the rejected format before sending to PLoT.

**Fix:** Either:
1. **Remove the flattening** — let `strength: { mean, std }` pass through to PLoT as-is (preferred, since PLoT expects this format)
2. **Add re-nesting in `mapOpsForPlot`** — convert `strength_mean`/`strength_std` back to `strength: { mean, std }` before sending to PLoT

Option 1 is simpler but requires checking that downstream CEE code (Zod validation, `applyPatchOperations`) can handle nested strength. Option 2 is defensive but adds another transform layer.

---

### M2 — `data` wrapper on nodes not canonical for validate-patch

**Impact:** Prompts teach `data: { interventions: {} }` on option nodes and `data: { value, ... }` on factor nodes. PLoT `CANONICAL_NODE_FIELDS` does NOT include `data`.

- **draft_graph:** OK — PLoT `/v2/run` normaliser flattens `data` wrapper
- **edit_graph:** REJECTED — `add_node` with `data` field → INVALID_PATCH_FIELD (422)

**Prompt examples affected:**
- edit_graph v6: `<node_shapes>` option template, `<parameters>` intervention creation rule
- draft_graph v187: all option nodes, all controllable/observable factor nodes

**Fix:** For edit_graph, option nodes must not include `data` wrapper. Use `observed_state` for factor values. For option intervention data, see M5 — the entire pattern needs rethinking.

---

### M3 — Field-level update paths produce non-canonical keys

**Impact:** Prompt teaches `/edges/from->to/strength.mean` with scalar value. After CEE `normalisePath()` + scalar wrapping:
- value becomes `{ "strength.mean": -0.6 }`
- `strength.mean` is NOT in `CANONICAL_EDGE_FIELDS` → REJECTED

**Prompt examples affected:** edit_graph v6 Example 1 (value update)

**Fix:** Either PLoT validate-patch needs to understand dotted keys in update values, or CEE needs to restructure `{ "strength.mean": val }` → `{ strength: { mean: val } }` before sending to PLoT.

---

### M4 — Intervention path produces non-canonical value keys

**Impact:** Path `/nodes/opt/data/interventions/fac` → normalisePath extracts field=`data/interventions/fac`, value is an object so NOT scalar-wrapped → sent as-is with keys `value`, `raw_value`, `unit`, `cap` — none canonical.

**Prompt examples affected:** edit_graph v6 Example 2

**Fix:** Moot given M5 — the entire intervention-via-graph-path pattern is broken. Needs architectural resolution.

---

### M5 [P0] — Intervention writes do not reach PLoT analysis

**CONFIRMED** via code audit of PLoT:

1. `filterOptionNodes()` at `plot-lite-service/src/normalisation/option-filter.ts` removes ALL nodes with `kind='option'` or `kind='decision'` before ISL analysis
2. `/v2/run` at line 2404 calls `filterOptionNodes(normalizedGraph)` — option nodes and their `data.interventions` are discarded
3. ISL receives interventions ONLY from the separate `options[]` request parameter (`src/routes/v2/run.ts:3079`)
4. `intervention-normaliser.ts:297-309` reads from `option.interventions` (the separate array), never from node fields

**Impact:** The edit_graph prompt teaches writing interventions to `/nodes/opt_x/data/interventions/fac_y`. This modifies the graph node but the value **never reaches analysis**. Every intervention edit via edit_graph is visually reflected in the graph but has zero effect on Monte Carlo simulation results.

**Fix:** edit_graph intervention updates must also update the separate `options[]` array that is sent with the graph to `/v2/run`. This is an architectural change — the edit_graph flow currently only patches the graph object, not the analysis request.

---

## Working Contracts (confirmed passing)

| Element | Format | Status |
|---------|--------|--------|
| `category` on factor nodes | `controllable` / `observable` / `external` | CANONICAL, passes on all node kinds |
| `prior` on external factors | `{ distribution, range_min, range_max }` | CANONICAL |
| `goal_threshold*` on goal nodes | `goal_threshold`, `goal_threshold_raw`, `goal_threshold_unit`, `goal_threshold_cap` | CANONICAL |
| Edge `exists_probability` | number [0,1] | CANONICAL |
| Edge `effect_direction` | `positive` / `negative` | CANONICAL |
| Edge `edge_type` | `directed` / `bidirected` | CANONICAL |
| Edge path `->` separator | `from->to` | CANONICAL (normalisePath converts `::` → `->` via mapOpsForPlot) |
| Legacy field sanitisation | `belief`, `belief_exists`, `confidence` | Stripped by `sanitiseOperations()` before PLoT call |

---

## Prompt Contract Test Suite

**Location:** `tests/prompt-contract/`

| File | Tests | Purpose |
|------|-------|---------|
| `canonical-fields.ts` | — | PLoT allowlists, forbidden fields, validation helpers, trace tables |
| `extract-prompt-examples.ts` | — | JSON extractor from prompt text |
| `negative-fixtures.test.ts` | 18 | Must-fail tests for every known bad shape |
| `prompt-contract.test.ts` | 23 | Contract validation for edit_graph v6 + draft_graph v187 |

**Run:** `pnpm vitest run tests/prompt-contract/`

**CI result:** 43/43 tests pass (18 negative fixtures + 25 contract tests). All negative fixtures correctly caught. M1 CEE transform correctly flagged as producing non-canonical output.

**Hard-fail behaviour:** Full scans use known-violation snapshots (`EDIT_GRAPH_KNOWN_VIOLATIONS`, `DRAFT_GRAPH_KNOWN_VIOLATIONS`). Any NEW violation not in the snapshot fails CI with example index, field, context, and reason. Stale entries (violations that disappear when a prompt is fixed) also fail, prompting snapshot cleanup.

**Update path validation:** Tests simulate CEE's `normalisePath` + scalar wrapping on `update_node`/`update_edge` operations to validate what PLoT actually receives. This catches M3 (dotted keys like `strength.mean`) and M4 (nested paths like `data/interventions/fac_x`).

**Strength shape enforcement:** Edges with a `strength` field must have nested `{ mean: number, std: number }` — bare numbers or missing sub-fields are flagged.

**Note:** Tests validate the **fallback prompt files** (`edit-graph-v6.ts`, `defaults-v187.ts`), not prompt-store-loaded content. If active staging prompts differ, the tests may not cover what's live.

---

## Prompt Examples That Fail PLoT Validation

### edit_graph v6

| Example | Issue | Field(s) | Severity |
|---------|-------|----------|----------|
| `<node_shapes>` option template | `data: { interventions: {} }` not canonical | `data` | M2 |
| `<parameters>` intervention creation rule | teaches `data.interventions` path | `data` | M2+M4+M5 |
| Example 2 (intervention update) | intervention value keys not canonical | `value`, `raw_value`, `unit`, `cap` | M4 |
| Example 1 (value update) | after normalisePath+wrapping, `strength.mean` key not canonical | `strength.mean` | M3 |
| Example 3 (add_edge) | after normaliseEdgeValue, strength flattened | `strength_mean`, `strength_std` | M1 |
| All edges in all examples | normaliseEdgeValue breaks canonical format | `strength_mean`, `strength_std` | M1 |

### draft_graph v187

| Example | Issue | Field(s) | Severity |
|---------|-------|----------|----------|
| All option nodes (4) | `data: { interventions: {...} }` | `data` | M2 (edit_graph context only) |
| All controllable factors (3) | `data: { value, ... }` | `data` | M2 (edit_graph context only) |
| All observable factors (2) | `data: { value, ... }` | `data` | M2 (edit_graph context only) |

Draft_graph edges: **all pass** (canonical nested strength format).

---

## Recommended Prompt Edits

### Priority 1: Fix M1 in CEE (not prompt)

The prompt is correct — it teaches `strength: { mean, std }`. The bug is in `normaliseEdgeValue()`. Fix the CEE code, not the prompt.

### Priority 2: Rewrite intervention pattern (M5)

The entire `data.interventions` pattern is dead code for analysis. Options:

**a) Remove intervention editing from edit_graph** — simplest. Interventions are set during draft_graph and not editable via edit_graph. Tell users to rebuild the graph.

**b) Route intervention edits to the options[] array** — edit_graph's intervention update must patch both the graph node (for UI display) and the separate options array (for analysis). Requires:
- A new operation type or special handling in the edit_graph pipeline
- Prompt rewrite to teach the correct intervention update mechanism
- CEE code changes to map intervention edits to the options array

**c) Make PLoT read interventions from graph nodes** — change PLoT to extract interventions from `node.data.interventions` instead of requiring a separate options array. Largest change, affects PLoT architecture.

### Priority 3: Decide on `data` wrapper (M2)

Two paths:
- **Add `data` to CANONICAL_NODE_FIELDS in PLoT** — PLoT validate-patch would accept it, normaliser already handles it
- **Remove `data` wrapper from edit_graph prompt examples** — use canonical flat fields (`observed_state` for factor values, `prior` for externals)

### Priority 4: Fix field-level update paths (M3)

Either:
- Teach the prompt to produce full value objects instead of field-level paths (e.g., `{ strength: { mean: -0.6 } }` instead of scalar -0.6 at path `strength.mean`)
- Add CEE logic to restructure dotted keys back to nested objects before PLoT

---

## Test Output Reference

```
 ✓ tests/prompt-contract/negative-fixtures.test.ts (18 tests)
 ✓ tests/prompt-contract/prompt-contract.test.ts (25 tests)

 Test Files  2 passed (2)
       Tests  43 passed (43)
```

**edit_graph v6 known violations (snapshotted, hard-fail on new):**
```
edge:strength.mean:0        — M3: dotted key after normalisePath + scalar wrapping
node:value:1                — M4: intervention object key not canonical
node:raw_value:1            — M4: intervention object key not canonical
node:unit:1                 — M4: intervention object key not canonical
node:cap:1                  — M4: intervention object key not canonical
node:data/interventions/fac_marketing_spend:1 — M4: nested field path not canonical
```
