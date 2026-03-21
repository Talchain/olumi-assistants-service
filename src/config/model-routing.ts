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
  | "edit_graph"
  | "bias_check"
  | "evidence_helper"
  | "sensitivity_coach"
  | "options"
  | "suggest_options"
  | "explainer"
  | "orchestrator"
  | "repair_graph"
  | "critique_graph"
  | "decision_review";

/**
 * Default model assignments per task
 *
 * Default models are OpenAI. Anthropic models (claude-sonnet-4-6) require
 * explicit CEE_MODEL_* env var overrides:
 *   CEE_MODEL_ORCHESTRATOR=claude-sonnet-4-6
 *   CEE_MODEL_DRAFT=claude-sonnet-4-6
 *   CEE_MODEL_EDIT_GRAPH=claude-sonnet-4-6
 * repair_graph and decision_review remain on gpt-4.1.
 *
 * Model selection by task type:
 * - Fast tier (gpt-4.1): Simple, speed-sensitive tasks (gpt-5-mini deprecated - empty response issues)
 * - Quality tier (gpt-4o): Primary drafting - reliable JSON output
 * - Quality tier (claude-sonnet-4): Bias detection - excellent reasoning
 * - Premium tier (gpt-5.2): Advanced reasoning for critique/repair
 */
export const TASK_MODEL_DEFAULTS: Record<CeeTask, string> = {
  // Fast tier - simple generation, low latency
  // Note: gpt-5-mini deprecated (2026-02-06) - returns empty responses on large prompts
  clarification: "gpt-4.1-2025-04-14",
  preflight: "gpt-4.1-2025-04-14",
  explainer: "gpt-4.1-2025-04-14",
  evidence_helper: "gpt-4.1-2025-04-14",
  sensitivity_coach: "gpt-4.1-2025-04-14",
  // Quality tier - optimized for specific tasks
  // Override for Anthropic benchmarking: set CEE_MODEL_DRAFT=claude-sonnet-4-6
  draft_graph: "gpt-4.1-2025-04-14",  // Reverted to gpt-4.1 (2026-03-18)
  edit_graph: "gpt-4o",  // Quality tier - graph editing (override via CEE_MODEL_EDIT_GRAPH)
  bias_check: "claude-sonnet-4-20250514",  // Excellent reasoning for bias detection
  orchestrator: "gpt-4o",  // Orchestrator Phase 3 + tool-calling (override via CEE_MODEL_ORCHESTRATOR)
  repair_graph: "gpt-4.1-2025-04-14",  // Reverted to gpt-4.1 (2026-03-18)
  // Premium tier - advanced reasoning for complex tasks
  options: "gpt-5.2",
  suggest_options: "gpt-5.2",  // Alias for options task
  critique_graph: "gpt-5.2",
  decision_review: "gpt-4.1-2025-04-14",  // Fast tier - narrative synthesis from ISL results
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
  _fast: "Force fast tier (gpt-4.1) for eligible tasks",
  _quality: "Force quality tier (gpt-5.2) for all tasks",
} as const;

export type TierShortcut = keyof typeof TIER_SHORTCUTS;

/**
 * Check if override value is a tier shortcut
 */
export function isTierShortcut(value: string): value is TierShortcut {
  return value in TIER_SHORTCUTS;
}
