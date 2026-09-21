# "Compare options" misroute investigation

**Debug bundle:** `olumi-debug-dc267806-20260410.json`
**Date:** 2026-04-11

## Finding

This is an **LLM misroute**, not a system-event collision or stale pending action.

The UI sent the literal message `"Can you update them for me with your best estimates?"` (conversation turn 5). The `cross_surface_events` array is empty and `current_turn_type` is `null` -- no system event collision occurred. The `turn_plan` shows `routing: "llm"` with `selected_tool: "add_option"`, meaning `computeTurnContext` classified this as a standard LLM-routed turn, and the LLM itself chose the tool.

The LLM selected `add_option` to update interventions on the already-existing "Hire Freelance Marketing Specialist" option, when the correct tool was `edit_graph`. The `add_option` handler's own description states: "Do not use for options that already exist -- to update an existing option's effects on factors, use edit_graph instead."

The handler was resilient enough to emit an `update_node` operation (not `add_node`) with `patch_type: "edit"`, so the patch itself was structurally correct. However, the `analysis_ready` payload it computed marked three of four options as `needs_encoding` with empty interventions (because the `add_option` handler builds readiness from the raw `graph_state` where those options lack `data.interventions`), yielding `analysis_ready.status: "needs_encoding"`.

This blocks the "Compare options" view: PLoT computed valid results with win probabilities (freelance at 80.7%, hire at 19.3%), but the UI suppresses the comparison surface because the CEE envelope's `analysis_ready.status` is not `"ready"`.

## Recommended fixes

1. **Prompt fix (primary):** Reinforce in the orchestrator system prompt that when the user asks to update/set intervention values on an existing option, the LLM must select `edit_graph`, not `add_option`.

2. **Defensive fix (recommended):** In `computeStructuralReadiness` (`src/orchestrator/tools/analysis-ready-helper.ts`), when an option node has `interventionKeys` (connected factors) but no `data.interventions`, fall back to reading intercept values from the connected factor nodes to determine if PLoT can compute results. Alternatively, the envelope assembler could reconcile `analysis_ready.status` against the actual PLoT response status -- if PLoT returned `analysis_status: "computed"`, the envelope should not emit `analysis_ready.status: "needs_encoding"`.
