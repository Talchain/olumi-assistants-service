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
  | "explainer"
  | "repair_graph"
  | "critique_graph";

/**
 * Default model assignments per task
 *
 * Fast tier (gpt-4o-mini): Simple, speed-sensitive tasks
 * Quality tier (gpt-4o): Complex reasoning, quality-critical tasks
 */
export const TASK_MODEL_DEFAULTS: Record<CeeTask, string> = {
  clarification: "gpt-4o-mini",
  preflight: "gpt-4o-mini",
  draft_graph: "gpt-4o",
  bias_check: "gpt-4o",
  evidence_helper: "gpt-4o-mini",
  sensitivity_coach: "gpt-4o",
  options: "gpt-4o",
  explainer: "gpt-4o-mini",
  repair_graph: "gpt-4o",
  critique_graph: "gpt-4o",
};

/**
 * Tasks where quality-tier model is REQUIRED
 *
 * These tasks cannot be downgraded to fast tier even if
 * explicitly requested via override. This protects core
 * value delivery from accidental degradation.
 */
export const QUALITY_REQUIRED_TASKS: CeeTask[] = [
  "draft_graph",
  "bias_check",
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
  _fast: "Force fast tier (gpt-4o-mini) for eligible tasks",
  _quality: "Force quality tier (gpt-4o) for all tasks",
} as const;

export type TierShortcut = keyof typeof TIER_SHORTCUTS;

/**
 * Check if override value is a tier shortcut
 */
export function isTierShortcut(value: string): value is TierShortcut {
  return value in TIER_SHORTCUTS;
}
