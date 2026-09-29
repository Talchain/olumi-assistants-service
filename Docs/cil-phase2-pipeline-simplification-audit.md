# CIL Phase 2 — Pipeline Simplification Audit

**Author:** Claude Code (CEE workstream)
**Date:** 2026-02-11
**Brief:** B — Pipeline Simplification Audit
**Status:** Draft for review — no stages removed or merged
**Prerequisite:** Brief A checkpoints must be live before acting on recommendations

---

## Executive Summary

CEE has **two separate pipeline paths** that share utility functions but are orchestrated independently:

| Path | File | Entry Point | When Used |
|------|------|-------------|-----------|
| **Pipeline A** (CEE validation pipeline) | `src/cee/validation/pipeline.ts` | `finaliseCeeDraftResponse()` | CEE draft-graph endpoint (primary) |
| **Pipeline B** (Route-level pipeline) | `src/routes/assist.draft-graph.ts` | `runDraftGraphPipeline()` | Legacy/direct draft-graph route |

Both paths share the same utility functions (`simpleRepair`, `stabiliseGraph`, `preserveFieldsFromOriginal`, `validateAndFixGraph`) but call them in different orders and with different repetition patterns.

**Key findings:**
- `simpleRepair` is called up to **4 times** in Pipeline B's worst-case path
- `stabiliseGraph` → `enforceGraphCompliance` is called up to **6 times** in Pipeline B
- `preserveEdgeFieldsFromOriginal` is a **compensating stage** — it exists to undo damage caused by the external PLoT validation engine stripping V4 edge fields
- `PROTECTED_KINDS` is defined in **3 places** with an inconsistency: `graphGuards.ts` is missing "factor"
- The estimated achievable stage count is **7–8** (down from 13), gated on fixing the PLoT engine

---

## Pipeline A: CEE Validation Pipeline (13 stages)

### Stage-by-Stage Classification

---

### Stage 1: `llm_draft`
**File:** [pipeline.ts:1034-1078](src/cee/validation/pipeline.ts#L1034-L1078)
**Classification:** Correctness
**Invariant enforced:** LLM produces a parseable graph structure. Schema validation retry handles transient LLM failures (malformed JSON, upstream non-JSON errors).
**Dependencies:** None (entry point)
**Recommendation:** **Keep**
**Evidence:** Without this stage, there is no graph. The schema retry (max 2 attempts with backoff) handles observed LLM output variability where ~2-5% of calls return invalid JSON.

---

### Stage 2: `coefficient_normalisation`
**File:** [pipeline.ts:905-937](src/cee/validation/pipeline.ts#L905-L937) (function), [pipeline.ts:1540-1593](src/cee/validation/pipeline.ts#L1540-L1593) (call site)
**Classification:** Robustness
**Invariant enforced:** Risk→goal and risk→outcome edges must have negative `strength_mean`. LLMs generate positive coefficients for risks ~15-20% of the time, which would produce incorrect inference results (risks appearing as benefits).
**Dependencies:** Runs after `llm_draft`, before any structural validation
**Recommendation:** **Keep** — this is a known, persistent LLM failure mode
**Evidence:** Pipeline trace shows `corrections_count > 0` in production. The LLM prompt explicitly requests negative coefficients for risks but compliance is inconsistent.

---

### Stage 3: `factor_enrichment`
**File:** [pipeline.ts:1595-1617](src/cee/validation/pipeline.ts#L1595-L1617)
**Classification:** Correctness
**Invariant enforced:** Factor nodes carry quantitative data (value, baseline, unit) required for Monte Carlo sensitivity analysis in ISL. Without enrichment, factors are label-only and the analysis engine produces empty sensitivity charts.
**Dependencies:** Runs after coefficient normalisation. Depends on LLM-first extraction service.
**Recommendation:** **Keep**
**Evidence:** Factor enrichment adds/enhances factor `data` fields that ISL consumes. Removing it breaks the ISL sensitivity analysis feature entirely.

---

### Stage 4: `node_validation`
**File:** [pipeline.ts:1619-1644](src/cee/validation/pipeline.ts#L1619-L1644)
**Classification:** Correctness
**Invariant enforced:** Single goal (merges duplicates), outcome beliefs filled to defaults, decision branches normalised. These are hard requirements of the graph schema — ISL rejects multi-goal graphs and requires belief fields.
**Dependencies:** Runs after factor enrichment. Uses `validateAndFixGraph()` from `src/cee/structure/index.ts`.
**Recommendation:** **Keep**
**Evidence:** `fixes.singleGoalApplied` fires in production when LLMs generate 2+ goal nodes. `outcomeBeliefsFilled > 0` fires when LLM omits belief fields.

---

### Stage 5: `connectivity_check`
**File:** [pipeline.ts:1863-2037](src/cee/validation/pipeline.ts#L1863-L2037)
**Classification:** Correctness
**Invariant enforced:** decision→option→…→goal path exists. A graph without this path is structurally invalid — the inference engine cannot compute option utilities without connectivity from decisions through options to the goal.
**Dependencies:** Runs after node validation (needs single goal guaranteed). Triggers goal_repair and edge_repair conditionally.
**Recommendation:** **Keep** — but it could potentially be merged with goal_repair and edge_repair into a single "ensure_connectivity" stage
**Evidence:** `connectivity_failed` in pipeline trace shows this catches disconnected graphs ~5-10% of the time after LLM draft.

---

### Stage 6: `goal_repair` (conditional)
**File:** [pipeline.ts:2040-2057](src/cee/validation/pipeline.ts#L2040-L2057)
**Classification:** Robustness
**Invariant enforced:** Goal node must exist. Infers from brief text or context.goals if LLM failed to produce one.
**Dependencies:** Triggered by connectivity_check finding missing goal. Uses `ensureGoalNode()` from `src/cee/structure/index.ts`.
**Recommendation:** **Merge with connectivity_check** into a single `ensure_connectivity` stage
**Evidence:** `goal_source: "inferred"` and `goal_source: "placeholder"` appear in production traces.

---

### Stage 7: `edge_repair` (conditional)
**File:** [pipeline.ts:2059-2074](src/cee/validation/pipeline.ts#L2059-L2074)
**Classification:** Robustness
**Invariant enforced:** Outcomes and risks must have edges to the goal. LLMs generate the goal node but forget to wire outcomes/risks to it ~3-8% of the time.
**Dependencies:** Triggered by connectivity_check finding unreachable goal. Uses `wireOutcomesToGoal()` from `src/cee/structure/index.ts`.
**Recommendation:** **Merge with connectivity_check** into a single `ensure_connectivity` stage
**Evidence:** `edges_added > 0` in `edge_repair` pipeline stage details appears in production.

---

### Stage 8: `structural_warnings`
**File:** [pipeline.ts:2652-2738](src/cee/validation/pipeline.ts#L2652-L2738)
**Classification:** Correctness (read-only detection, no mutation)
**Invariant enforced:** None (observability only). Detects quality issues: uniform strengths, strength clustering, missing baseline, goal-no-value.
**Dependencies:** Runs after all graph mutations are complete. Read-only — does not modify graph.
**Recommendation:** **Keep** — this is pure observability/quality scoring, not a graph mutation stage
**Evidence:** Populates `draft_warnings` in the response, consumed by the frontend to show quality indicators.

---

### Stage 9: `clarifier` (optional)
**File:** [pipeline.ts:2594-2639](src/cee/validation/pipeline.ts#L2594-L2639)
**Classification:** Correctness
**Invariant enforced:** Multi-turn clarification refinement. Re-normalises graph if clarification is applied.
**Dependencies:** Depends on clarifier being enabled. Graph mutations re-apply normalisation.
**Recommendation:** **Keep** — optional stage, only runs when feature flag is on
**Evidence:** Controlled by `clarifierEnabled()` feature flag.

---

### Stage 10: `response_caps`
**File:** [pipeline.ts:2645](src/cee/validation/pipeline.ts#L2645), function at [pipeline.ts:417-444](src/cee/validation/pipeline.ts#L417-L444)
**Classification:** Correctness
**Invariant enforced:** Response size limits — caps bias_findings, options, evidence, sensitivity to configured maximums. Without this, responses can exceed API gateway payload limits.
**Dependencies:** Runs after all graph mutations. Caps payload-level arrays.
**Recommendation:** **Keep**
**Evidence:** `anyTruncated` flag is set in production responses when graphs are large.

---

### Stage 11: `quality_computation`
**File:** [pipeline.ts:2587-2592](src/cee/validation/pipeline.ts#L2587-L2592)
**Classification:** Correctness (read-only)
**Invariant enforced:** Quality scores must be present in response. ISL and frontend consume `quality.overall` for display and routing decisions.
**Dependencies:** Runs after all mutations. Read-only computation.
**Recommendation:** **Keep**
**Evidence:** `quality` field is required by the response schema.

---

### Stage 12: `archetype_inference` (optional)
**File:** [pipeline.ts:2561-2585](src/cee/validation/pipeline.ts#L2561-L2585)
**Classification:** Correctness (read-only)
**Invariant enforced:** Decision type classification. Frontend uses archetype for UI personalisation.
**Dependencies:** Depends on `archetypesEnabled()` feature flag.
**Recommendation:** **Keep** — optional stage
**Evidence:** Populates `archetype.decision_type` consumed by frontend.

---

### Stage 13: `final_validation`
**File:** [pipeline.ts:2846-2868](src/cee/validation/pipeline.ts#L2846-L2868)
**Classification:** Correctness
**Invariant enforced:** The complete CEE response conforms to the Zod schema (`CEEDraftGraphResponseV1Schema`). This is the contract enforcement point — ensures nothing upstream produced a structurally invalid response.
**Dependencies:** Final stage. Reads entire response.
**Recommendation:** **Keep** — this is the boundary contract guard
**Evidence:** `verificationPipeline.verify()` rejects responses that don't conform to the output schema.

---

## Pipeline B: Route-Level Pipeline (assist.draft-graph.ts)

Pipeline B has significant stage repetition. Here is the **full stage inventory** in execution order:

| # | Stage | Function | File:Line | Classification |
|---|-------|----------|-----------|----------------|
| B1 | Pre-orchestrator repair | `simpleRepair()` | [assist.draft-graph.ts:1085](src/routes/assist.draft-graph.ts#L1085) | Robustness |
| B2 | Orchestrator validation (optional) | `validateAndRepairGraph()` | [assist.draft-graph.ts:1141](src/routes/assist.draft-graph.ts#L1141) | Correctness |
| B3 | Factor enrichment | `enrichGraphWithFactorsAsync()` | [assist.draft-graph.ts:1211](src/routes/assist.draft-graph.ts#L1211) | Correctness |
| B4 | First stabilisation | `stabiliseGraph(ensureDagAndPrune())` | [assist.draft-graph.ts:1241](src/routes/assist.draft-graph.ts#L1241) | Compensating |
| B5 | Post-enrichment repair | `simpleRepair()` | [assist.draft-graph.ts:1261](src/routes/assist.draft-graph.ts#L1261) | Compensating |
| B6 | Second stabilisation | `stabiliseGraph(ensureDagAndPrune())` | [assist.draft-graph.ts:1262](src/routes/assist.draft-graph.ts#L1262) | Compensating |
| B7 | External engine validation | `validateGraph()` (PLoT engine) | [assist.draft-graph.ts:1271](src/routes/assist.draft-graph.ts#L1271) | Correctness |
| B8 | Edge field restoration | `preserveFieldsFromOriginal()` | [assist.draft-graph.ts:1375](src/routes/assist.draft-graph.ts#L1375) | **Compensating** |
| B9 | Post-validation stabilisation | `stabiliseGraph(ensureDagAndPrune())` | [assist.draft-graph.ts:1376](src/routes/assist.draft-graph.ts#L1376) | Compensating |
| B10 | Stable edge IDs | `enforceStableEdgeIds()` | [assist.draft-graph.ts:1380](src/routes/assist.draft-graph.ts#L1380) | Correctness |
| B11 | Structure validation | `validateAndFixGraph()` | [assist.draft-graph.ts:1384](src/routes/assist.draft-graph.ts#L1384) | Correctness |

**On validation failure**, the worst case adds additional calls:
- Up to 3 more `simpleRepair()` calls (lines 1285, 1343, 1356)
- Up to 3 more `stabiliseGraph(ensureDagAndPrune())` calls
- Up to 3 more `validateGraph()` calls to external engine
- Up to 3 more `preserveFieldsFromOriginal()` calls

---

## Specific Questions Answered

### 1. simpleRepair: Is pruneUnreachable dead code?

**No, but it's close to dead code.**

With `PROTECTED_KINDS_FOR_PRUNING` = `{goal, decision, option, outcome, risk, factor}` — which covers all 6 CIL node kinds — `pruneUnreachable` can only prune nodes of kinds **not** in this set. In the current CIL schema, valid node kinds are exactly these 6, so:

- **For well-formed graphs:** `pruneUnreachable` will never prune anything. Every node has a protected kind.
- **For malformed LLM output:** If the LLM generates a node with an unrecognised kind (e.g., `kind: "note"`, `kind: "assumption"`), `pruneUnreachable` would correctly remove it if unreachable.

**Node-count cap trimming** (`GRAPH_MAX_NODES = 50`): The cap respects protected kinds — it always keeps all protected nodes and only trims unprotected nodes. Since all valid node kinds are protected, the cap is effectively `max(50, total_valid_nodes)` — it can never reduce below the count of valid structural nodes.

**Recommendation:** `pruneUnreachable` is **robustness** code for malformed LLM output. Keep but document that it's a guard against non-standard node kinds. Consider whether the Zod schema at Stage 1 already rejects non-standard kinds (if it does, this is dead code; currently the `Node` schema uses a string enum for `kind` that would reject non-standard kinds at parse time).

**Follow-up investigation needed:** Check if `Graph.safeParse()` rejects nodes with kinds outside `{goal, decision, option, outcome, risk, factor}`. If it does, `pruneUnreachable` is truly dead code.

---

### 2. preserveEdgeFieldsFromOriginal: Still needed?

**Yes, as long as the external PLoT engine strips V4 fields.**

The function exists because:
1. `normaliseDraftResponse()` correctly sets V4 fields (strength_mean, strength_std, belief_exists, effect_direction) from LLM output
2. The external PLoT engine at `/v1/validate` strips these fields from its normalised response
3. `preserveEdgeFieldsFromOriginal()` restores them from the pre-validation graph

**This is a textbook compensating stage.** The root cause is the PLoT engine not preserving V4 fields.

**If Brief 0's normalisation fix ensures fields survive AND the PLoT engine is updated to preserve V4 fields:**
- This function becomes unnecessary
- It should be removed once both conditions are confirmed

**If only Brief 0 is fixed but the PLoT engine still strips fields:**
- This function is still required after every `validateGraph()` call to the PLoT engine

**Recommendation:** **Candidate for removal** once the PLoT engine is updated. Until then, keep it but rename to clearly indicate it's compensating: `restoreEdgeFieldsStrippedByEngine()`.

---

### 3. Graph.safeParse at Stage 6: Strength stripping

**Context clarification:** There is no "Stage 6" Graph.safeParse in Pipeline A. In Pipeline B, Graph.safeParse runs inside the orchestrator's `validateAndRepairGraph()` at [graph-orchestrator.ts:256](src/cee/graph-orchestrator.ts#L256).

**Does Graph.safeParse strip the nested strength object?**

Looking at the Zod Edge schema at [graph.ts:208-254](src/schemas/graph.ts#L208-L254):

```typescript
const EdgeInput = z.object({
  strength_mean: z.number().optional(),
  strength_std: z.number().positive().optional(),
  belief_exists: z.number().min(0).max(1).optional(),
  // ... no "strength" nested object defined
});
```

**Yes, `Graph.safeParse()` will strip the nested `strength` object** because Zod's default behaviour strips unrecognised keys. The schema defines `strength_mean` (flat) but not `strength` (nested). So if the LLM outputs:

```json
{ "strength": { "mean": 0.7, "std": 0.15 }, "exists_probability": 0.9 }
```

The `strength` and `exists_probability` fields are stripped by Zod.

**However**, `normaliseDraftResponse()` runs BEFORE `Graph.safeParse()` and converts nested→flat:
- `strength.mean` → `strength_mean`
- `strength.std` → `strength_std`
- `exists_probability` → `belief_exists`

**So in practice:** If normalisation runs first (which it does), fields survive. The Zod schema acts as a **contract enforcement point** — it ensures only canonical flat fields survive, which is correct behaviour.

**Recommendation:** **Keep as-is.** This is correctness enforcement, not a problem. The normalisation→safeParse ordering is correct: normalise first, then enforce the schema.

---

### 4. ensureDagAndPrune: Redundant with validation engine?

**Partially redundant, but serves a different purpose.**

`ensureDagAndPrune()` → `stabiliseGraph()` → `enforceGraphCompliance()` performs:
1. **Node cap** (max 50) — Stage 19
2. **Edge cap** (max 200) — Stage 20
3. **Dangling edge filter** — Stage 21
4. **Cycle breaking** (DFS-based) — Stage 22
5. **Isolated node pruning** (protected kinds exempted) — Stage 23
6. **Edge ID normalisation** — Stage 24
7. **Deterministic sorting** — nodes by id, edges by (from, to, id)
8. **Metadata calculation** — roots, leaves, suggested_positions — Stage 25

The **graph validator** (`validateGraph()` in graph-validator.ts) also checks for cycles (Tier 2), but it **reports** cycles as errors rather than **fixing** them. The validator is read-only; `enforceGraphCompliance` is the write-side equivalent.

**The overlap:** Cycle detection exists in both places. But they serve different roles:
- Validator: "Is this graph a DAG?" → error if not
- enforceGraphCompliance: "Make this graph a DAG" → fix it

**The redundancy problem in Pipeline B:** `stabiliseGraph(ensureDagAndPrune(...))` is called **up to 6 times** in a single request. This is because it's used as a "safety net" after every mutation. Most of these calls are no-ops (no cycles to break, no nodes to prune) but they still iterate over all nodes and edges each time.

**Recommendation:**
- **Keep one call** after all graph mutations are complete (before external validation)
- **Keep one call** after external validation returns (in case the engine modifies the graph)
- **Remove the 4+ intermediate calls** — they exist because stages don't trust each other
- This requires Pipeline B refactoring to establish a clear mutation→validate→stabilise pattern

---

### 5. normaliseStructuralEdges: Could it fold into normalisation?

**Yes, with caveats.**

`normaliseStructuralEdges()` runs at [graph-orchestrator.ts:318](src/cee/graph-orchestrator.ts#L318), AFTER Zod parse but BEFORE graph validation. It coerces option→factor edges to canonical values (`mean=1.0, std=0.01, prob=1.0, direction="positive"`).

Currently `normaliseDraftResponse()` handles V4 field extraction (nested→flat) but does **not** enforce canonical values for structural edges. These are separate concerns:
- `normaliseDraftResponse()`: Format normalisation (field names, types)
- `normaliseStructuralEdges()`: Value normalisation (canonical values for structural wiring)

**Folding option:** Add canonical structural edge enforcement to `normaliseDraftResponse()`. This would:
- Eliminate one pipeline stage
- Require `normaliseDraftResponse()` to know about node kinds (currently it only processes edges without node context)

**Complication:** `normaliseDraftResponse()` operates on raw `unknown` input before Zod parsing — it doesn't have typed node kind information. `normaliseStructuralEdges()` relies on a node kind lookup map, which requires parsed nodes.

**Recommendation:** **Keep separate but reorder** — `normaliseStructuralEdges()` must run after Zod parse (needs node types), so it can't fold into the pre-parse `normaliseDraftResponse()`. However, it could fold into `normaliseGraph()` (which runs post-validation in the orchestrator). The cleanest option is to keep it as a named step within the orchestrator's validate loop (which is its current position).

---

## Cross-Cutting Issues

### PROTECTED_KINDS Inconsistency

Three definitions exist:

| Location | Kinds Included | Missing |
|----------|---------------|---------|
| [repair.ts:318](src/services/repair.ts#L318) `PROTECTED_KINDS` | goal, decision, option, outcome, risk, **factor** | — |
| [repair.ts:227](src/services/repair.ts#L227) `PROTECTED_KINDS_FOR_PRUNING` | goal, decision, option, outcome, risk, **factor** | — |
| [graphGuards.ts:222](src/utils/graphGuards.ts#L222) `PROTECTED_KINDS` | goal, decision, option, outcome, risk | **factor** |

`graphGuards.ts` is missing "factor". This means `enforceGraphCompliance()` → `pruneIsolatedNodes()` **will prune isolated factor nodes**, while `simpleRepair()` → `pruneUnreachable()` **will not**.

**Impact:** If a factor node has no edges (isolated), Pipeline B's `stabiliseGraph()` will prune it, but `simpleRepair()` would preserve it. This is an inconsistency that could cause factors to disappear depending on which path runs last.

**Recommendation:** Add "factor" to `graphGuards.ts` PROTECTED_KINDS to match `repair.ts`. Factors carry Monte Carlo priors and should never be silently pruned.

### Duplicate Pipeline Problem

Having two separate pipeline paths (Pipeline A in `pipeline.ts` and Pipeline B in `assist.draft-graph.ts`) creates maintenance risk:
- Bug fixes must be applied to both
- Stage ordering differences cause different behaviour for the same graph
- Testing surface doubles

**Recommendation:** Converge to a single pipeline. Pipeline A (validation/pipeline.ts) appears to be the intended primary path. Pipeline B should be migrated to use Pipeline A's orchestration.

---

## Recommended Simplified Pipeline

### Target: 8 stages (down from 13 in Pipeline A, 11+ in Pipeline B)

| # | Stage Name | Classification | Invariant | Current Stages Merged |
|---|-----------|----------------|-----------|----------------------|
| 1 | `llm_draft` | Correctness | Valid graph structure from LLM | Stage 1 |
| 2 | `normalise` | Robustness | Risk coefficients negative; structural edges canonical | Stages 2 + normaliseStructuralEdges |
| 3 | `factor_enrichment` | Correctness | Factor nodes carry quantitative data | Stage 3 |
| 4 | `ensure_connectivity` | Correctness + Robustness | Single goal, decision→option→goal path, outcomes/risks wired | Stages 4 + 5 + 6 + 7 |
| 5 | `stabilise` | Correctness | DAG enforced, caps applied, deterministic output | ensureDagAndPrune (single call) |
| 6 | `detect_warnings` | Correctness (read-only) | Quality warnings, archetype, quality score | Stages 8 + 11 + 12 |
| 7 | `apply_caps` | Correctness | Response within size limits | Stage 10 |
| 8 | `final_validation` | Correctness | Response conforms to output schema | Stage 13 |

**Stages removed/absorbed:**

| Current Stage | Action | Justification |
|--------------|--------|---------------|
| `coefficient_normalisation` (2) | **Merge** → `normalise` | Same concern as structural edge normalisation |
| `connectivity_check` (5) | **Merge** → `ensure_connectivity` | Check + repair should be atomic |
| `goal_repair` (6) | **Merge** → `ensure_connectivity` | Part of connectivity guarantee |
| `edge_repair` (7) | **Merge** → `ensure_connectivity` | Part of connectivity guarantee |
| `clarifier` (9) | **Keep as optional hook** | Feature-flagged, doesn't need its own stage classification |
| Multiple `simpleRepair` calls (Pipeline B) | **Eliminate** all but one | Compensating for other stages' mutations |
| Multiple `stabiliseGraph` calls (Pipeline B) | **Reduce** to one pre-validation + one post-validation | Currently called 6x redundantly |
| `preserveFieldsFromOriginal` (Pipeline B) | **Remove** once PLoT engine preserves V4 fields | Compensating stage |

### Stages to remove/merge with justification:

1. **Remove `preserveFieldsFromOriginal`** (4 call sites in Pipeline B) — compensating for PLoT engine stripping V4 fields. Fix the PLoT engine instead.
2. **Merge `connectivity_check` + `goal_repair` + `edge_repair`** → `ensure_connectivity` — these are one logical operation (ensure the graph is connected) split across 3 stages for historical reasons.
3. **Merge `coefficient_normalisation`** into a unified `normalise` stage — risk coefficient correction and structural edge canonicalisation are both "normalise LLM output" concerns.
4. **Merge `structural_warnings` + `quality_computation` + `archetype_inference`** → `detect_warnings` — all three are read-only analysis that produces response metadata.
5. **Eliminate redundant `simpleRepair` + `stabiliseGraph` calls** in Pipeline B — currently called defensively after every mutation. One pre-validation and one post-validation call is sufficient.
6. **Fix PROTECTED_KINDS inconsistency** — add "factor" to `graphGuards.ts`.
7. **Converge Pipeline A and Pipeline B** into a single orchestration path.

### Required tests for each remaining stage's invariant:

| Stage | Required Test |
|-------|--------------|
| `llm_draft` | Given malformed JSON → retries and produces valid graph OR returns typed error |
| `normalise` | Given positive risk→goal coefficient → corrected to negative; given non-canonical option→factor edge → corrected to canonical values |
| `factor_enrichment` | Given graph with label-only factors → factors have value/baseline/unit after enrichment |
| `ensure_connectivity` | Given graph with missing goal → goal inferred; given disconnected outcomes → wired to goal; given 2+ goals → merged to single goal |
| `stabilise` | Given graph with cycle → cycle broken; given 60 nodes → capped to 50 (with protected kinds preserved); given isolated non-structural node → pruned |
| `detect_warnings` | Given uniform strengths → warning emitted; given missing baseline → warning emitted; quality scores computed |
| `apply_caps` | Given 20 bias_findings → capped to configured max |
| `final_validation` | Given response missing required field → rejected; given valid response → passes |

---

## Pre-Conditions for Acting on This Audit

1. **Brief A checkpoints must be live** — changes need verification data
2. **PLoT engine V4 field preservation** must be confirmed before removing `preserveFieldsFromOriginal`
3. **PROTECTED_KINDS inconsistency** should be fixed first (low-risk, high-value)
4. **Pipeline convergence** (A/B → single path) is a prerequisite for most simplifications
5. **Each merge/removal** should be verified against checkpoint data showing the stage's effect (or lack thereof)

---

## Appendix: Function Call Graph

```
Pipeline A (pipeline.ts):
  finaliseCeeDraftResponse()
    ├── runCeeDraftPipeline()              → llm_draft
    ├── normaliseRiskCoefficients()        → coefficient_normalisation
    ├── enrichGraphWithFactorsAsync()      → factor_enrichment
    ├── validateAndFixGraph()              → node_validation
    ├── validateMinimumStructure()         → connectivity_check
    ├── ensureGoalNode()                   → goal_repair
    ├── wireOutcomesToGoal()               → edge_repair
    ├── detectStructuralWarnings()         → structural_warnings
    ├── integrateClarifier()               → clarifier
    ├── applyResponseCaps()                → response_caps
    ├── computeQuality()                   → quality_computation
    ├── inferArchetype()                   → archetype_inference
    └── verificationPipeline.verify()      → final_validation

Pipeline B (assist.draft-graph.ts):
  runDraftGraphPipeline()
    ├── simpleRepair()                     → pre-orchestrator repair
    ├── validateAndRepairGraph()           → orchestrator validation (opt)
    │     ├── Graph.safeParse()            → Zod parse
    │     ├── normaliseStructuralEdges()   → structural edge canon.
    │     ├── validateGraph()              → deterministic validation
    │     ├── normaliseGraph()             → value normalisation
    │     └── validateGraphPostNorm()      → post-norm validation
    ├── enrichGraphWithFactorsAsync()      → factor enrichment
    ├── stabiliseGraph(ensureDagAndPrune())→ first stabilisation
    ├── simpleRepair()                     → post-enrichment repair
    ├── stabiliseGraph(ensureDagAndPrune())→ second stabilisation
    ├── validateGraph() [PLoT engine]      → external validation
    ├── preserveFieldsFromOriginal()       → edge field restoration
    ├── stabiliseGraph(ensureDagAndPrune())→ post-validation stab.
    ├── enforceStableEdgeIds()             → stable edge IDs
    └── validateAndFixGraph()              → structure validation
```
