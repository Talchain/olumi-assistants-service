# Evaluator Investigation Report

**Date:** 2026-03-13
**Scope:** Three investigations from model-comparison-report.md follow-up actions

---

## Task 1: Claude Orchestrator Regression (v10 → v11)

### Observation
Claude's orchestrator structural score dropped from 0.982 (prompt v10) to 0.846 (prompt v11). The two failing cases are orch-02 (draft-graph-trigger, 0.629) and orch-06 (research-tool, 0.629).

### Prompt diff findings (v10 → v11)

Five new constraint sections were added in v11:

| New Section | Description | Impact on Claude |
|---|---|---|
| **LOOP PREVENTION** | Cannot repeat same blocker/clarification if user answered within 3 turns | Low — unlikely cause of structural failure |
| **ASSUMPTION VISIBILITY** | Inferred values must be labelled as proposed assumptions | Medium — may cause verbose output that breaks envelope |
| **LABEL FIDELITY** | Must use canonical labels, no silent renaming | Low |
| **PATCH SUMMARY** | Describe patches in plain language, not operation lists | Medium — changes output structure |
| **TOOL AVAILABILITY** | Only invoke tools present in current turn | Low |

Three behavioural changes are the likely regression drivers:

1. **Soft proceed threshold lowered.** v10 required "goal + options + factors stated" before triggering a draft. v11 says factors may be inferred during drafting — goal + options alone suffice. Claude likely still applies the stricter v10-era judgment on orch-02, asking clarifying questions instead of triggering `draft_graph`.

2. **Draft trigger loosened.** v11 adds: "Factors may be inferred during drafting. Prefer soft-proceeding when the user provides goal + options + constraints in a single message." Claude's orch-02 failure (0.629 structural) is consistent with Claude failing to trigger the draft tool when it should.

3. **Example reduction.** v10 had 10 routing examples; v11 reduced to 8 (hiring example removed, research examples merged). Fewer examples may reduce Claude's routing accuracy for edge cases.

### Root cause classification

**Prompt-model interaction issue.** The v11 prompt lowered the draft trigger threshold, but Claude — being more conservative about proceeding without explicit user confirmation — doesn't follow the new softer threshold as reliably as gpt-4.1. This is a known Claude behavioural pattern (preference for asking before acting).

gpt-4.1 scores 1.000 structural on both orch-02 and orch-06, confirming it follows the new routing rules more consistently.

### Recommendations

1. **Add explicit Claude-facing guidance** in the orchestrator prompt for soft-proceed cases — e.g., "When the user provides a goal and two or more options in a single message, proceed to draft_graph without further clarification."
2. **Run variance check** — repeat Claude orchestrator 2 more times to confirm this is a stable pattern, not run variance.
3. **Consider model-specific prompt variants** if the gap persists after prompt tuning.

---

## Task 2: Edit Graph Scorer — Functional Equivalence Fix

### Problem
Cases 01, 02, 03, 05, and 09 fail `operation_types_correct` for ALL models. The scorer requires exact op type matches, but models frequently use functionally equivalent operation sequences:

| Case | Expected | Models Produce | Equivalent? |
|---|---|---|---|
| 03-strengthen-edge | `update_edge` | `remove_edge` + `add_edge` (same path) | Yes |
| 09-update-node-label | `update_node` | `remove_node` + `add_node` (same id) | Yes |
| 05-compound | includes `update_edge` | `remove_edge` + `add_edge` pair | Yes |

Cases 01 (add-factor) and 02 (remove-factor) fail for a different reason — the models include additional operations beyond the minimum expected set (e.g., adding extra edges), but the fixture only lists the primary expected types.

### Fix implemented

Added `deriveEquivalentTypes()` function to `tools/graph-evaluator/src/edit-graph-scorer.ts`:

- **`remove_edge` + `add_edge` on same path** → implies `update_edge`
- **`remove_node` + `add_node` on same id** → implies `update_node`

The function builds the actual op types set, then checks for paired remove+add operations targeting the same entity. If found, it adds the corresponding `update_*` type to the set.

The `operation_types_correct` check now uses `deriveEquivalentTypes(ops)` instead of a raw set of actual op types.

### Tests added

Two new test cases in `tools/graph-evaluator/tests/edit-graph-scorer.test.ts`:
1. `recognises remove_edge + add_edge as functional equivalent of update_edge`
2. `recognises remove_node + add_node as functional equivalent of update_node`

All 9 tests pass (7 existing + 2 new).

### Expected score impact

With the fix, cases 03, 05, and 09 should see `operation_types_correct` flip from ✗ to ✓ for models that use the remove+add pattern, raising scores from 0.800/0.850 to 0.950/1.000 for those cases. Cases 01 and 02 may still fail if models use unexpected additional op types — this needs further investigation with actual model outputs.

---

## Task 3: Draft Graph Brief-02 Universal Failure

### Observation
Brief 02 (multi-option-constrained) fails for ALL three models on draft_graph v175.

### Brief content
UK fintech international expansion decision with:
- 3 country options (Germany, Brazil, Japan) + implied status quo
- Numeric constraints (15% revenue growth, £2M budget, 18 months)
- Sub-decision (hire locally vs relocate staff)
- 35-person team with no international experience

This is the most complex of the 4 briefs by a significant margin.

### Failure modes (different per model)

| Model | Failure | Root Cause |
|---|---|---|
| **gpt-4o** | `CONTROLLABLE_NO_OPTION_EDGE` | Missing structural edges |
| **gpt-4.1** | Timeout | Graph too complex for time limit |
| **claude-sonnet-4-6** | Timeout | Graph too complex for time limit |

### gpt-4o failure analysis

gpt-4o produced a valid graph but omitted `option → fac_local_hire` edges. The model correctly populated the `interventions` map on each option (e.g., `fac_local_hire: 1` for Germany), but didn't emit the corresponding structural edges. The validator at `tools/graph-evaluator/src/validator.ts:282-305` flags this as `CONTROLLABLE_NO_OPTION_EDGE` — a controllable factor exists but has no incoming option edge.

This is a **prompt-validator alignment issue**: the model treats interventions data as sufficient proof of an option→factor relationship, but the validator requires explicit structural edges.

### gpt-4.1 and Claude timeout analysis

Both models timed out generating the graph. Brief-02's complexity (4+ options, numeric constraints, sub-decision) likely produces graphs with 15-20+ nodes and 30+ edges, exceeding the evaluator's default timeout.

### Recommendations

1. **Prompt fix:** Add explicit guidance in draft_graph v175 that every controllable factor must have incoming option→factor edges in the structural edge list, not just in the interventions map.
2. **Timeout increase:** Raise the evaluator timeout for draft_graph runs to accommodate complex briefs (current default appears too short for multi-option scenarios).
3. **Brief simplification (alternative):** Split brief-02 into two simpler briefs — one for multi-country expansion, one for hire-vs-relocate — to test multi-option without the compounding sub-decision.

---

## Summary of Changes Made

| Item | File | Change |
|---|---|---|
| Functional equivalence logic | `tools/graph-evaluator/src/edit-graph-scorer.ts` | Added `deriveEquivalentTypes()` function; updated `operation_types_correct` check |
| Equivalence tests | `tools/graph-evaluator/tests/edit-graph-scorer.test.ts` | Added 2 test cases for remove+add → update equivalence |

## Follow-up Actions

1. **Orchestrator variance check** — run Claude + gpt-4.1 orchestrator evaluations 2 more times each
2. **Re-run edit_graph evaluator** with fixed scorer to measure actual score improvement
3. **Draft_graph v175 prompt patch** — add option→factor edge enforcement for controllable factors
4. **Evaluator timeout config** — make draft_graph timeout configurable, increase default for complex briefs
5. **Claude orchestrator prompt tuning** — test explicit soft-proceed language targeting Claude's conservative routing
