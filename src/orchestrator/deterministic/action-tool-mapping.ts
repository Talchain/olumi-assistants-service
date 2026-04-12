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
 */

const ACTION_TO_TOOL: Record<string, string> = {
  explain_result: 'explain_result',
  compare_options: 'compare_options',
  what_would_flip: 'what_would_flip',
  run_analysis: 'run_analysis',
  set_factor_value: 'set_factor_value',
  add_factor: 'add_factor',
  add_option: 'add_option',
  add_constraint: 'add_constraint',
  adjust_edge_strength: 'adjust_edge_strength',
  generate_brief: 'generate_artefact',
  research_topic: 'research_topic',
  run_premortem: 'run_premortem',
  challenge_assumption: 'challenge_assumption',
};

/**
 * Map a chip's action_type to the pipeline tool name it requires.
 * Returns `null` for virtual/non-tool actions (always pass availability).
 */
export function chipActionToTool(actionType: string): string | null {
  return ACTION_TO_TOOL[actionType] ?? null;
}
