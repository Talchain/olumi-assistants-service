/**
 * Canonical Prompt Tasks Registry
 *
 * Single source of truth for all CEE prompt task identifiers.
 * Used by:
 * - Admin UI dropdowns
 * - Prompt schema validation
 * - Model routing configuration
 * - Drift prevention tests
 *
 * To add a new task:
 * 1. Add it to PROMPT_TASKS array
 * 2. Register default prompt in src/prompts/defaults.ts
 * 3. Add model routing in src/config/model-routing.ts
 */

/**
 * All available CEE prompt task identifiers.
 * Order matches approximate frequency of use.
 */
export const PROMPT_TASKS = [
  'draft_graph',
  'suggest_options',
  'repair_graph',
  'clarify_brief',
  'critique_graph',
  'bias_check',
  'evidence_helper',
  'sensitivity_coach',
  'explainer',
  'preflight',
  'enrich_factors',
  'decision_review',
] as const;

export type PromptTask = typeof PROMPT_TASKS[number];

/**
 * Task display labels for UI (optional human-friendly names)
 */
export const PROMPT_TASK_LABELS: Record<PromptTask, string> = {
  draft_graph: 'Draft Graph',
  suggest_options: 'Suggest Options',
  repair_graph: 'Repair Graph',
  clarify_brief: 'Clarify Brief',
  critique_graph: 'Critique Graph',
  bias_check: 'Bias Check',
  evidence_helper: 'Evidence Helper',
  sensitivity_coach: 'Sensitivity Coach',
  explainer: 'Explainer',
  preflight: 'Preflight',
  enrich_factors: 'Enrich Factors',
  decision_review: 'Decision Review',
};

/**
 * Validate that a string is a valid prompt task
 */
export function isValidPromptTask(value: string): value is PromptTask {
  return (PROMPT_TASKS as readonly string[]).includes(value);
}
