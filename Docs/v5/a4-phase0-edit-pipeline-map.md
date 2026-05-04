# A4 Phase 0 — Edit Pipeline Map

Branch: `claude/v5-edit-graph-add-risk-template` (from `origin/staging`).

Scope: investigate the v5 edit_graph dispatch path before adding the deterministic `add_risk` template. This document is the artefact required by the brief's Phase 0 hard gate.

## Edit dispatch path (file:line)

| Step | Location | Notes |
|---|---|---|
| Intent regex | [src/orchestrator/route-v2.ts:347](../../src/orchestrator/route-v2.ts) (`EDIT_GRAPH_POSITIVE_REGEX`), [:369](../../src/orchestrator/route-v2.ts) (`EDIT_GRAPH_NEGATIVE_REGEX`) | Positive matches `change\|update\|edit\|modify\|remove\|delete\|add\|adjust\|set\|reduce\|increase\|decrease\|tweak\|raise\|lower`; negative guards meta-questions and figurative uses. |
| Dispatch decision | [src/orchestrator/route-v2.ts:728-806](../../src/orchestrator/route-v2.ts) | `editIntentDetected = positive && !negative`; if true and `graphState` present (or reloadable) → `dispatchEditGraph(...)`. |
| Dispatcher entry | [src/orchestrator-v5/handlers/edit-graph-dispatch.ts:428](../../src/orchestrator-v5/handlers/edit-graph-dispatch.ts) | Builds `ConversationContext` (graph + analysis + framing + messages), gets adapter, calls `handleEditGraph`. |
| Handler core | [src/orchestrator/tools/edit-graph.ts:1250](../../src/orchestrator/tools/edit-graph.ts) (`handleEditGraph`) | Drives LLM call → parse → repair loop → validation → apply → topology check. |
| Repair loop | [src/orchestrator/tools/edit-graph.ts:1510-1542](../../src/orchestrator/tools/edit-graph.ts) | `totalAttempts = maxRetries + 1`. Repair attempts use the focused `repair_edit_graph` system prompt + a context section with errors/original-request/previous-ops. |
| MAX_OPERATIONS | [src/config/index.ts:496](../../src/config/index.ts) (default 15); guarded at [src/orchestrator/tools/edit-graph.ts:1693](../../src/orchestrator/tools/edit-graph.ts) | Rejection code `MAX_OPERATIONS_EXCEEDED` returned via `buildRejectionResult`. |
| Operation Zod schema | [src/orchestrator/patch-validation.ts:115](../../src/orchestrator/patch-validation.ts) (`PatchOperationSchema`) | Discriminated union over `op`. `add_node` value requires `{id, kind, label}`; `add_edge` value requires `{from, to, strength:{mean,std}, exists_probability, effect_direction}`. `.passthrough()` allowed. |
| Patch application | [src/orchestrator/patch-applier.ts](../../src/orchestrator/patch-applier.ts) (`applyPatchOperations`) | Returns the candidate post-edit `GraphV3T` or throws `PatchApplyError`. |
| Topology check | [src/orchestrator/graph-structure-validator.ts:89](../../src/orchestrator/graph-structure-validator.ts) (`validateGraphStructure`) | Codes: `ORPHAN_NODE`, `NO_PATH_TO_GOAL`, `CYCLE_DETECTED`, `NODE_LIMIT_EXCEEDED`, `EDGE_LIMIT_EXCEEDED`, `NO_GOAL`, `NO_DECISION`, `FEWER_THAN_TWO_OPTIONS`, `OPTION_NO_FACTOR_EDGES`. |
| Baseline-violation subtraction | [src/orchestrator/tools/edit-graph.ts:1884-1901](../../src/orchestrator/tools/edit-graph.ts) | Pre-existing violations don't block; only NEW violations introduced by the edit fail validation. |
| Response composition | [src/orchestrator-v5/handlers/edit-graph-dispatch.ts:314](../../src/orchestrator-v5/handlers/edit-graph-dispatch.ts) (`editResultToOlumiResponse`) | On success: `blocks: []`, applied graph reaches UI via `analysis_ready` and persisted `scenarios.graph`. On rejection: synthesized `error` block at `buildBoundaryBlocks`. |
| Suggested-action wire mapping | [src/orchestrator-v5/handlers/edit-graph-dispatch.ts:114-138](../../src/orchestrator-v5/handlers/edit-graph-dispatch.ts) | `BOUNDARY_ACTION_TYPES = {run_analysis, set_factor_value, add_constraint, adjust_edge_strength, explain_result, compare_options, what_would_flip}`. Internal `action_type` values not in this set are dropped; the chip still works as a prompt-replay button via `message`. |
| Commit | [src/orchestrator-v5/handlers/edit-graph-dispatch.ts:563](../../src/orchestrator-v5/handlers/edit-graph-dispatch.ts) (`commitDirectAnswer`) | Writes turn + post-edit graph atomically. |
| Freshness derivation | [src/orchestrator-v5/handlers/edit-graph-dispatch.ts:488-550](../../src/orchestrator-v5/handlers/edit-graph-dispatch.ts) | An accepted substantive edit produces freshness=`stale` because the post-edit graph hash diverges from the prior `run_analysis` fact's hash. |

## Goal-node identification

`GraphV3T.nodes[i].kind === 'goal'` per [src/schemas/cee-v3.ts:89](../../src/schemas/cee-v3.ts). Synchronously available in `dispatchEditGraph` via `context.graph.nodes.find(n => n.kind === 'goal')`. No async lookup needed.

## Pre-flight findings (for Commit 2)

1. **Unconnected risk topology.** A risk node added with only `risk → goal` (negative bridge) FAILS `NO_PATH_TO_GOAL`: the validator (lines 244-256) flags any non-decision/non-goal node that has at least one edge but is not reachable from a decision node via directed paths. **Resolution:** the template must add a `decision → risk` bridge edge in addition to `risk → goal` so the new node sits on a directed path from the decision (decision exposes you to the risk; risk hurts the goal).

2. **Helper exports.** `validatePatchOperations` (re-exported at [edit-graph.ts:57](../../src/orchestrator/tools/edit-graph.ts)), `applyPatchOperations` (imported from `../patch-applier`), `validateGraphStructure` (imported from `../graph-structure-validator`), `normaliseEditOpsForPlot` ([edit-graph.ts:733](../../src/orchestrator/tools/edit-graph.ts)), `enforceStructuralEdgeDefaults` ([edit-graph.ts:832](../../src/orchestrator/tools/edit-graph.ts)) are all already `export`ed. The template can import them directly. **No `export` markers need to be added.**

3. **Recovery chip action_type.** Recovery chips will be emitted with NO `action_type` (omitted). The boundary mapper at [edit-graph-dispatch.ts:135](../../src/orchestrator-v5/handlers/edit-graph-dispatch.ts) drops unrecognised values, but the chip still functions as a prompt-replay button via the `message` field. This matches the existing pattern (no new `action_type` invented).

4. **Response shape.** The successful template path produces an `EditGraphResult` with `wasRejected: false` and `appliedGraph: <GraphV3T>`. `editResultToOlumiResponse` returns `blocks: []` for non-rejected results — applied graphs reach the UI via `analysis_ready` (computed by the dispatcher from `appliedGraph`) and the persisted `scenarios.graph` row. **No `graph_patch` block on success today; the template path matches.**

## D1 routing gap (out of scope, P0 follow-up)

`EDIT_GRAPH_POSITIVE_REGEX` matches `set|increase|decrease|reduce|raise|lower|adjust|tweak`. No D1 pre-intercept exists in `route-v2.ts`. `tryDeterministicValueUpdate` at [src/orchestrator-v5/turn-executor.ts:788](../../src/orchestrator-v5/turn-executor.ts) only runs on the TurnExecutor fallthrough path (i.e. when edit_graph dispatch was *skipped*).

Concrete consequences today:

- `"Set churn to 5%"` matches `set` → routes to **edit_graph** (LLM path) instead of D1 `set_factor_value`.
- `"increase price by 10%"` matches `increase` → **edit_graph**.
- `"reduce churn"` matches `reduce` → **edit_graph**.
- `"Make the link stronger"` (no edit verb) → falls through → D1 `adjust_edge_strength` can intercept (correct).

Per the brief's halt-condition flow, the user opted to proceed with the `add_risk` template only. Routing is not modified in this brief. **A separate P0 brief should add a deterministic value-update pre-intercept in `route-v2.ts` before the edit_graph branch (or extend `EDIT_GRAPH_NEGATIVE_REGEX`).**

## Out of scope

- D1 pre-intercept in `route-v2.ts` (separate P0 follow-up).
- `add_factor` / `add_outcome` / `remove_node` templates (separate briefs after the `add_risk` pattern is proven).
- Repair loop changes (focused error context per failure type, timeout budgeting) — deferred from the original brief.
- Edit_graph v9 prompt edits (Claude-Prompts scope).
- Reducing MAX_OPERATIONS globally (evidence-based decision later).
- UI changes / schema bumps.
