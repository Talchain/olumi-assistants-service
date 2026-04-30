/**
 * Task-to-Model Routing Configuration
 *
 * Defines default model assignments per CEE task and identifies
 * which tasks require quality-tier models (cannot be downgraded).
 *
 * ─────────────────────────────────────────────────────────────────
 * Precedence
 * ─────────────────────────────────────────────────────────────────
 * The runtime model for a task is resolved via the following chain,
 * highest priority first:
 *
 *   1. per_call              explicit modelOverride parameter passed to
 *                            getAdapter(task, modelOverride). Clients can
 *                            supply via request body.
 *                            Source: src/adapters/llm/router.ts:688-719
 *
 *   2. store_model_config    prompt-store modelConfig.{staging,production}
 *                            resolved upstream in parse.ts and passed to
 *                            getAdapter as modelOverride. The router sees
 *                            this as modelOverride; the origin flag in
 *                            getAdapterWithResolution distinguishes it
 *                            from per_call.
 *                            Source: src/cee/unified-pipeline/stages/parse.ts:92-109
 *
 *   3. env_var               CEE_MODEL_* env vars via config.cee.models.*
 *                            Source: src/adapters/llm/router.ts:725-731
 *
 *   4. task_default          TASK_MODEL_DEFAULTS (this file) via
 *                            getDefaultModelForTask.
 *                            Source: src/adapters/llm/router.ts:732-750
 *
 *   5. providers_json        providers.json task-override or config_default.
 *                            Source: src/adapters/llm/router.ts:658-679
 *
 *   6. llm_model_fallback    LLM_PROVIDER / LLM_MODEL env or adapter default.
 *                            Source: src/adapters/llm/router.ts:650-656, 681-686
 *
 * The final resolution is observable per-LLM-call via debug-level log
 * "model.resolution" in callers that use getAdapterWithResolution, and
 * per-turn via GET /admin/v1/turn-debug/:turn_id (model_resolutions[]).
 *
 * Startup values are advisory only. Per-request logs are the source of
 * truth for store overrides applied after boot. See
 * src/config/model-resolution-logger.ts.
 * ─────────────────────────────────────────────────────────────────
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
  | "decision_review"
  // Display-only entry for the v5 routing prompt. The v5 routing call site
  // (src/orchestrator-v5/routing/route-with-tool-use.ts) controls its own
  // model/temperature/tools selection independently. `getSystemPrompt('routing')`
  // is used for prompt text only — its `modelConfig` return value MUST NOT be
  // applied to the routing Anthropic call. This entry exists so the admin UI
  // can list `routing` alongside the other PMS-managed prompts.
  | "routing";

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
  // Display-only — see comment on the `routing` member of CeeTask above.
  // The v5 routing call site does NOT consume this value.
  routing: "claude-sonnet-4-20250514",
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
