/**
 * Task-to-Model Routing Configuration
 *
 * Defines default model assignments per CEE task and identifies
 * which tasks require quality-tier models (cannot be downgraded).
 */

/**
 * CEE task types that can have model selection applied
 */
export type CeeTask =
  | "clarification"
  | "preflight"
  | "draft_graph"
  | "bias_check"
  | "evidence_helper"
  | "sensitivity_coach"
  | "options"
  | "suggest_options"
  | "explainer"
  | "repair_graph"
  | "critique_graph"
  | "decision_review";

/**
 * Default model assignments per task
 *
 * Model selection by task type:
 * - Fast tier (gpt-5-mini): Simple, speed-sensitive tasks
 * - Quality tier (gpt-4o): Primary drafting - reliable JSON output
 * - Quality tier (claude-sonnet-4): Bias detection - excellent reasoning
 * - Premium tier (gpt-5.2): Advanced reasoning for critique/repair
 */
export const TASK_MODEL_DEFAULTS: Record<CeeTask, string> = {
  // Fast tier - simple generation, low latency
  clarification: "gpt-5-mini",
  preflight: "gpt-5-mini",
  explainer: "gpt-5-mini",
  evidence_helper: "gpt-5-mini",
  sensitivity_coach: "gpt-5-mini",
  // Quality tier - optimized for specific tasks
  draft_graph: "gpt-4o",  // Reverted - gpt-4.1 has JSON mode compatibility issues
  bias_check: "claude-sonnet-4-20250514",  // Excellent reasoning for bias detection
  repair_graph: "claude-sonnet-4-20250514",  // Excellent reasoning for repair
  // Premium tier - advanced reasoning for complex tasks
  options: "gpt-5.2",
  suggest_options: "gpt-5.2",  // Alias for options task
  critique_graph: "gpt-5.2",
  decision_review: "gpt-4o",  // Premium tier - narrative synthesis from ISL results
};

/**
 * Tasks where quality-tier model is REQUIRED
 *
 * These tasks cannot be downgraded to fast tier even if
 * explicitly requested via override. This protects core
 * value delivery from accidental degradation.
 *
 * NOTE: Quality gates removed (2026-01-28) to allow client-specified
 * model selection. Premium models are now protected via:
 * - clientAllowed: false in MODEL_REGISTRY
 * - CLIENT_BLOCKED_MODELS env var
 */
export const QUALITY_REQUIRED_TASKS: CeeTask[] = [
  // Quality gates disabled - all tasks can use any client-allowed model
];

/**
 * Get the default model for a task
 */
export function getDefaultModelForTask(task: CeeTask): string {
  return TASK_MODEL_DEFAULTS[task];
}

/**
 * Check if a task requires quality-tier model
 */
export function isQualityRequired(task: CeeTask): boolean {
  return QUALITY_REQUIRED_TASKS.includes(task);
}

/**
 * Check if a task identifier is a valid CeeTask
 */
export function isValidCeeTask(task: string): task is CeeTask {
  return task in TASK_MODEL_DEFAULTS;
}

/**
 * Tier shortcuts that users can specify in X-CEE-Model-Override header
 */
export const TIER_SHORTCUTS = {
  _default: "Use task default model",
  _fast: "Force fast tier (gpt-5-mini) for eligible tasks",
  _quality: "Force quality tier (gpt-5.2) for all tasks",
} as const;

export type TierShortcut = keyof typeof TIER_SHORTCUTS;

/**
 * Check if override value is a tier shortcut
 */
export function isTierShortcut(value: string): value is TierShortcut {
  return value in TIER_SHORTCUTS;
}
