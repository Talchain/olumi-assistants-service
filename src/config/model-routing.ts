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
 *   2. store_model_config    prompt-store modelConfig.{staging,production},
 *                            read BY THE CALL SITE and handed to
 *                            getAdapterWithResolution as modelOverride with
 *                            origin='store_model_config'. The router sees only
 *                            a modelOverride; the origin flag preserves the
 *                            distinction from per_call.
 *
 *                            ⚠ RANK 2 IS NOT GLOBAL — it applies ONLY at the
 *                            call sites that actually read the pin, which are
 *                            enumerated in STORE_MODEL_CONFIG_LIVE_CALL_SITES
 *                            below. The router NEVER consults the prompt store
 *                            itself: its override branch is entered only when
 *                            the caller supplied a modelOverride argument
 *                            (getAdapterWithResolution in
 *                            src/adapters/llm/router.ts). So on every OTHER
 *                            task a modelConfig pin is INERT — stored, served
 *                            by the admin prompts API, and never reaching the
 *                            router. It is not a weak override; it is no
 *                            override at all.
 *
 *                            MEASURED LIVE, 2026-08-08: the 'orchestrator'
 *                            task carried a staging modelConfig pin while
 *                            staging served the CEE_MODEL_ORCHESTRATOR value
 *                            (rank 3) — Render log 2026-08-08T19:54:41.257Z,
 *                            "Using CEE task-specific model from environment",
 *                            task=orchestrator. The pin was dead because
 *                            resolveRoutingAdapter()
 *                            (src/orchestrator-v5/routing/route-with-tool-use.ts)
 *                            passes no modelOverride.
 *
 *                            The list below is not a hand-maintained mirror:
 *                            src/config/__tests__/store-model-config-call-sites.test.ts
 *                            DERIVES the readers from src/ and REDs on any
 *                            divergence in either direction.
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
 * THE REACH OF PRECEDENCE RANK 2 (store_model_config) — the single
 * declaration, referenced by the precedence block above and enforced against
 * the source by src/config/__tests__/store-model-config-call-sites.test.ts.
 *
 * These are the LIVE TASK PATHS that read a prompt-store modelConfig pin and
 * pass it to the router. A pin on any task NOT served by one of these sites is
 * INERT (see rank 2 above).
 *
 * Each entry is a repo-relative path that both (a) reads the environment key
 * off a prompt's modelConfig and (b) names its task with a literal
 * getSystemPromptMeta('<task>') call — the second condition is what makes it a
 * task path rather than a generic harness.
 */
export const STORE_MODEL_CONFIG_LIVE_CALL_SITES: readonly string[] = [
  "src/cee/unified-pipeline/stages/parse.ts", // draft_graph
  "src/routes/assist.critique-graph.ts", // critique_graph
  "src/routes/assist.suggest-options.ts", // suggest_options
];

/**
 * Readers of a prompt's modelConfig that are NOT live task paths.
 *
 * The admin testing harness runs an OPERATOR-CHOSEN prompt record and reads
 * whatever modelConfig that record carries. It names no task, serves no user
 * turn, and therefore says nothing about which tasks honour rank 2 — it is
 * listed separately so the derivation guard can tell "a new task path started
 * consuming pins" (a precedence change) apart from "the harness moved".
 */
export const STORE_MODEL_CONFIG_NON_TASK_READERS: readonly string[] = [
  "src/routes/admin.testing.ts", // operator test-run endpoint, not a task path
];

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
  // Pass 2 of the two-pass validation pipeline — the INDEPENDENT REVIEWER that
  // re-estimates every causal edge's parameters without seeing Pass 1's values
  // (src/cee/validation-pipeline/). Added as a first-class task by ROADMAP 2.146:
  // it was previously declared env-only in ROUTER_ENV_ONLY_TASKS, which meant an
  // unset CEE_MODEL_VALIDATION fell through to the GLOBAL LLM_MODEL — i.e. the
  // reviewer's identity became an accident, and if it resolved to the drafting
  // family the "independent adversarial review" claim quietly weakened to
  // "same-model blind re-estimate". Note this is the ONE routed name that needs a
  // default: the router also maps the alias 'validate' → the same config key, but
  // `getAdapter('validate')` has zero callers (scope: rg over src/), so that alias
  // stays declared env-only rather than being given a default it can never use.
  | "validate_graph"
  // V6 dual-draft M2 graph review. Model must be EXPLICITLY set via
  // CEE_MODEL_M2_REVIEW at activation (the dual-draft model-resolution gate
  // stays inert otherwise); this union entry exists so startup/admin model
  // listings and isValidCeeTask cover the task.
  | "m2_graph_review"
  // Display-only entry for the v5 routing prompt. The v5 routing call site
  // (src/orchestrator-v5/routing/route-with-tool-use.ts) controls its own
  // model/temperature/tools selection independently. `getSystemPrompt('routing')`
  // is used for prompt text only — its `modelConfig` return value MUST NOT be
  // applied to the routing Anthropic call. This entry exists so the admin UI
  // can list `routing` alongside the other PMS-managed prompts.
  | "routing";

/**
 * Default model assignments per task — THE authoritative checked-in map.
 *
 * ─────────────────────────────────────────────────────────────────
 * Source of truth
 * ─────────────────────────────────────────────────────────────────
 * These values are reconciled to the models that actually SERVE on
 * staging (cee-staging, Render srv-d4slpaili9vc73eiq4og). Render's
 * `CEE_MODEL_*` env vars are OVERRIDE-ONLY: when one is set it wins over
 * the default here (router precedence step 3 > step 4); when one is
 * dropped, the task lands on THIS map. Keeping the two in sync is what
 * makes a dropped env var safe rather than a silent model regression.
 *
 * Runtime truth is the PER-REQUEST log ("model.resolution" /
 * GET /admin/v1/turn-debug/:turn_id) — that reflects prompt-store
 * model_config overrides applied per turn, which are invisible here and
 * at startup. This map + the startup "model.task_resolved" log are
 * advisory; the per-request log is authoritative for any given call.
 *
 * Last reconciled to live staging env: 2026-08-08 (derived via Render API,
 * service srv-d4slpaili9vc73eiq4og).
 *   Live CEE_MODEL_* on Render (override-only):
 *     CEE_MODEL_DRAFT        = claude-sonnet-5
 *     CEE_MODEL_DRAFT_GRAPH  = claude-sonnet-5  (→ draft_graph)
 *     CEE_MODEL_EDIT         = claude-sonnet-5
 *     CEE_MODEL_EDIT_GRAPH   = claude-sonnet-5
 *     CEE_MODEL_ORCHESTRATOR = claude-sonnet-5
 *     CEE_MODEL_REPAIR       = gpt-4.1  (registered pin: gpt-4.1-2025-04-14)
 *     CEE_MODEL_DECISION_REVIEW = gpt-4.1  (registered pin: gpt-4.1-2025-04-14)
 *     CEE_MODEL_EXTRACTION   = gpt-4.1  (no CeeTask row — env-only)
 *   Not set on Render → these tasks serve the default below directly.
 *
 * ⚠ PROMPT-STORE OVERRIDE DISCOVERY (2026-08-08): env vars are NOT the top of
 * the chain. The PMS prompt `draft_graph_default` carried
 * modelConfig.staging = claude-sonnet-4-6, which outranks env (precedence
 * step 2 > step 3, applied in unified-pipeline stages/parse.ts), so staging
 * kept serving sonnet-4-6 through two redeploys AFTER the env vars were
 * flipped to claude-sonnet-5. Fixed 2026-08-08 via PATCH
 * /admin/prompts/draft_graph_default {modelConfig.staging: claude-sonnet-5}
 * + POST /admin/prompts/reload; verified by the per-request "draft complete"
 * log (model=claude-sonnet-5). When a model change does not take, check the
 * prompt store's modelConfig BEFORE suspecting the env or this map.
 *
 * ⚠ Provider-mismatch caveat: when LLM_PROVIDER is unset/openai (as on
 * staging), the router SKIPS an anthropic-provider task default rather
 * than switching providers (router.ts task_default branch). So if an
 * anthropic-model env var (draft/edit/orchestrator) is dropped, the task
 * falls through to the GLOBAL model, not the anthropic default listed
 * here. The startup WARN in model-resolution-logger.ts surfaces exactly
 * that "running on checked-in default" condition so the drop is visible.
 *
 * Model selection by task type:
 * - Fast tier (gpt-4.1): Simple, speed-sensitive tasks (gpt-5-mini deprecated - empty response issues)
 * - Quality tier (claude-sonnet): Drafting / editing / orchestration (live on staging)
 * - Quality tier (claude-sonnet-4): Bias detection - excellent reasoning
 * - Premium tier (gpt-5.2): Advanced reasoning for options/critique
 */
export const TASK_MODEL_DEFAULTS: Record<CeeTask, string> = {
  // Fast tier - simple generation, low latency
  // Note: gpt-5-mini deprecated (2026-02-06) - returns empty responses on large prompts
  clarification: "gpt-4.1-2025-04-14",
  preflight: "gpt-4.1-2025-04-14",
  explainer: "gpt-4.1-2025-04-14",
  evidence_helper: "gpt-4.1-2025-04-14",
  sensitivity_coach: "gpt-4.1-2025-04-14",
  // Quality tier - reconciled to live staging CEE_MODEL_* (2026-08-08)
  draft_graph: "claude-sonnet-5",  // live CEE_MODEL_DRAFT_GRAPH (was claude-sonnet-4-6)
  edit_graph: "claude-sonnet-5",  // live CEE_MODEL_EDIT_GRAPH (was claude-sonnet-4-6)
  bias_check: "claude-sonnet-4-20250514",  // Excellent reasoning for bias detection
  orchestrator: "claude-sonnet-5",  // live CEE_MODEL_ORCHESTRATOR (was gpt-4o)
  repair_graph: "gpt-4.1-2025-04-14",  // registered pin of live CEE_MODEL_REPAIR=gpt-4.1
  // Premium tier - advanced reasoning for complex tasks
  options: "gpt-5.2",
  suggest_options: "gpt-5.2",  // Alias for options task
  critique_graph: "gpt-5.2",
  decision_review: "gpt-4.1-2025-04-14",  // registered pin of live CEE_MODEL_DECISION_REVIEW=gpt-4.1
  // Validation Pass 2 — CROSS-PROVIDER ON PURPOSE (ROADMAP 2.146). Pass 1 (the
  // drafter) is `draft_graph` above = claude-sonnet-5 (anthropic); this is
  // o4-mini (openai, registered at config/models.ts:216 — provider openai, tier
  // quality, enabled). Independence is the ONLY reason this task exists, so the
  // default must not be able to collide with the drafting family. Reconciles with
  // the intended model named in the pipeline's own header comments and in
  // router.ts's env-only note. Overridable by CEE_MODEL_VALIDATION exactly like
  // every other row here (router precedence step 3 > step 4).
  //
  // ⚠ Provider-mismatch caveat above applies IN OUR FAVOUR here: staging runs
  // LLM_PROVIDER unset/openai, and this default is an openai model, so the
  // router's task_default branch APPLIES it rather than skipping it. (An
  // anthropic reviewer default would have been silently skipped on staging and
  // fallen through to the global model — the exact failure this row closes.)
  validate_graph: "o4-mini",
  // V6 dual-draft M2 review — display default only (D3 recommendation).
  // NEVER governs a live call: the dual-draft gate requires the explicit
  // CEE_MODEL_M2_REVIEW env override to match the resolved model.
  m2_graph_review: "claude-opus-4-8",
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
