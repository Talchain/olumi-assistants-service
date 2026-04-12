/**
 * Action–Tool Mapping
 *
 * Single source of truth for the mapping between chip action_type values
 * and pipeline tool names. Consumed by:
 * - chip-engine.ts (filtering chips against available tools)
 * - pipeline-v4.ts (telemetry)
 * - tests (contract assertions)
 *
 * Chips whose action_type does NOT appear in this map are "virtual" —
 * they trigger a conversation prompt, not a tool invocation (e.g.
 * interpret, calibrate, decide). Virtual chips always pass the
 * availability filter.
 *
 * The map is typed against ActionName to prevent phantom keys.
 * An exhaustiveness test in chip-tool-contract.test.ts verifies that
 * every ActionName used by the chip engine has an entry here.
 */

import type { ActionName } from "./actions/types.js";

/**
 * Maps chip action_type (ActionName) to the pipeline tool name the chip
 * requires. Not every ActionName has an entry — only those that appear
 * as chip action_types. Tools like `remove_factor`, `set_goal_target`,
 * and `draft_graph` are never chip action_types and are omitted.
 */
const ACTION_TO_TOOL: Partial<Record<ActionName, string>> = {
  explain_result: 'explain_result',
  compare_options: 'compare_options',
  what_would_flip: 'what_would_flip',
  run_analysis: 'run_analysis',
  set_factor_value: 'set_factor_value',
  add_factor: 'add_factor',
  add_option: 'add_option',
  add_constraint: 'add_constraint',
  adjust_edge_strength: 'adjust_edge_strength',
  generate_artefact: 'generate_artefact',
  run_premortem: 'run_premortem',
  challenge_assumption: 'challenge_assumption',
};

/**
 * Map a chip's action_type to the pipeline tool name it requires.
 * Returns `null` for virtual/non-tool actions (always pass availability).
 */
export function chipActionToTool(actionType: string): string | null {
  return (ACTION_TO_TOOL as Record<string, string>)[actionType] ?? null;
}

/**
 * Exposed for exhaustiveness testing — returns the set of action_types
 * that have explicit tool mappings.
 */
export function getMappedActionTypes(): ReadonlySet<string> {
  return new Set(Object.keys(ACTION_TO_TOOL));
}
