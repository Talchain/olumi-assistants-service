/** Fixed inputs retained for specs of surviving modules after the executor helpers were deleted. */
export const GRAPH_MUTATING_HANDLER_IDS: ReadonlySet<string> = new Set([
  'set_factor_value', 'add_constraint', 'adjust_edge_strength',
]);
export const CONFIGURE_OPTION_EXAMPLE_VALUE = '60%';
export const QUALITATIVE_VALUE_KNOWN_DROPPED: readonly string[] = [
  "Set the X option's effect on Y to high",
  "Set the X option's effect on Y to about a third",
  "Set the X option's effect on Y to roughly half",
  "Set the X option's effect on Y to low",
];
export const RERUN_ACTION = {
  id: 'chip_action_rerun_analysis', label: 'Re-run analysis',
  message: 'Re-run the analysis.', action_type: 'run_analysis' as const,
};
