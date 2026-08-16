import {
  ModelAssignmentError,
  type ResolvedModelAssignment,
} from './model-assignment.js';

/**
 * Task-to-Model Routing Configuration
 *
 * Defines default model assignments per CEE task and identifies
 * which tasks require quality-tier models (cannot be downgraded).
 *
 * ─────────────────────────────────────────────────────────────────
 * Precedence
 * ─────────────────────────────────────────────────────────────────
 * An explicitly configured `LLM_FAILOVER_PROVIDERS` wrapper is an outer
 * availability policy: it is resolved before this single-provider chain and
 * does not accept per-call/store overrides. With no failover wrapper (the
 * shipped staging posture), the runtime model for a task is resolved via the
 * following chain, highest priority first:
 *
 *   1. per_call              explicit modelOverride parameter passed to
 *                            getAdapter(task, modelOverride). Clients can
 *                            supply via request body.
 *                            Source: src/adapters/llm/router-resolution.ts
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
 *                            Source: src/adapters/llm/router-resolution.ts
 *
 *   4. task_default          TASK_MODEL_DEFAULTS (this file) via
 *                            getDefaultModelForTask.
 *                            Source: src/adapters/llm/router-resolution.ts
 *
 *   5. providers_json        providers.json task-override or config_default.
 *                            Source: src/adapters/llm/router-resolution.ts
 *
 *   6. llm_model_fallback    LLM_PROVIDER / LLM_MODEL env or adapter default.
 *                            Source: src/adapters/llm/router-resolution.ts
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
  // Display-only compatibility name. The executable standalone route calls
  // getAdapter('clarify_brief'); this row does not serve that call by itself.
  | "clarification"
  | "preflight"
  | "draft_graph"
  | "edit_graph"
  | "bias_check"
  | "evidence_helper"
  | "sensitivity_coach"
  | "options"
  | "suggest_options"
  // Display-only compatibility name. The executable route is explain_diff.
  | "explainer"
  | "orchestrator"
  // Inert compatibility/PMS-readiness slot. LLMAdapter.repairGraph and every
  // executable caller were removed; do not report this as a live AI call.
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
 *     CEE_MODEL_EXTRACTION   = gpt-4.1  (dedicated-adapter default below)
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
 * Provider follows the winning model. Since the task default outranks the
 * global LLM_PROVIDER / LLM_MODEL fallback, a cross-provider task default
 * switches adapters through MODEL_REGISTRY instead of being discarded. This
 * makes an env-pin removal land on this map, as the precedence contract says.
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
  // Provider is derived from this winning model, so this remains cross-provider
  // from the Anthropic drafter even if the global provider changes.
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
 * Live model assignments that do not use the main adapter router.
 *
 * These remain separate from `TASK_MODEL_DEFAULTS` because their call sites
 * use dedicated adapters, but they are still load-bearing model authority and
 * must have a checked-in landing point when a deployment env pin disappears.
 */
export const AUXILIARY_MODEL_DEFAULTS = {
  // `src/adapters/llm/extraction.ts` serves factor enrichment on the
  // POST /assist/v1/review path. Reconciled to staging CEE_MODEL_EXTRACTION.
  extraction: "gpt-4.1-2025-04-14",
} as const;

export type AuxiliaryModelTask = keyof typeof AUXILIARY_MODEL_DEFAULTS;

export type AiTaskLifecycleId =
  | CeeTask
  | AuxiliaryModelTask
  | 'clarify_brief'
  | 'explain_diff'
  | 'rolling_summary'
  | 'decision_review_decompose';

export type AiTaskExecutionState =
  | 'live_router'
  | 'standalone_route'
  | 'dedicated_adapter'
  | 'feature_gated'
  | 'deterministic_or_external'
  | 'display_only'
  | 'inert_compatibility';

export interface AiTaskLifecycle {
  /** True only when the task is available without a default-off feature gate. */
  readonly executable: boolean;
  readonly state: AiTaskExecutionState;
  /** Executable task that supersedes a compatibility/display name. */
  readonly executableTask?: AiTaskLifecycleId;
  readonly gate?: string;
  readonly note: string;
}

export type AiTaskRuntimeAvailability =
  | 'available'
  | 'feature_gated_default_off'
  | 'not_executable';

/**
 * Keep static capability separate from default runtime availability. A
 * feature-gated row can have a real, tested call path without being live by
 * default; display/compatibility rows have no call path at all.
 */
export function getAiTaskRuntimeAvailability(
  task: AiTaskLifecycleId,
): AiTaskRuntimeAvailability {
  const lifecycle = AI_TASK_LIFECYCLE[task];
  if (lifecycle.state === 'feature_gated') {
    return 'feature_gated_default_off';
  }
  if (!lifecycle.executable) return 'not_executable';
  return 'available';
}

/** Static code capability, independent of default-off activation state. */
export function hasAiTaskExecutablePath(task: AiTaskLifecycleId): boolean {
  const lifecycle = AI_TASK_LIFECYCLE[task];
  return lifecycle.executable || lifecycle.state === 'feature_gated';
}

/**
 * Truthful task lifecycle authority. This is deliberately separate from the
 * historical model-default table: a row can remain visible to PMS/readiness
 * without being misreported as an executable LLM capability.
 */
export const AI_TASK_LIFECYCLE: Readonly<
  Record<AiTaskLifecycleId, AiTaskLifecycle>
> = {
  clarification: {
    executable: false,
    state: 'display_only',
    executableTask: 'clarify_brief',
    note: 'Compatibility/display name; the standalone route calls clarify_brief.',
  },
  clarify_brief: {
    executable: true,
    state: 'standalone_route',
    note: 'POST /assist/clarify-brief calls getAdapter(clarify_brief).',
  },
  preflight: {
    executable: false,
    state: 'deterministic_or_external',
    note: 'Brief readiness/preflight is deterministic; this model row is decorative.',
  },
  draft_graph: {
    executable: true,
    state: 'live_router',
    note: 'Unified draft pipeline resolves draft_graph through the router.',
  },
  edit_graph: {
    executable: true,
    state: 'live_router',
    note: 'V5 edit dispatch resolves edit_graph through the router.',
  },
  bias_check: {
    executable: false,
    state: 'deterministic_or_external',
    note: 'Bias routes call deterministic detectBiases; the PMS prompt has no caller.',
  },
  evidence_helper: {
    executable: false,
    state: 'deterministic_or_external',
    note: 'Capability is supplied by the analysis/ISL path, not this model default.',
  },
  sensitivity_coach: {
    executable: false,
    state: 'deterministic_or_external',
    note: 'Capability is supplied by the analysis/ISL path, not this model default.',
  },
  options: {
    executable: false,
    state: 'display_only',
    executableTask: 'suggest_options',
    note: 'Compatibility name; the executable route calls suggest_options.',
  },
  suggest_options: {
    executable: true,
    state: 'standalone_route',
    note: 'POST /assist/suggest-options resolves suggest_options through the router.',
  },
  explainer: {
    executable: false,
    state: 'display_only',
    executableTask: 'explain_diff',
    note: 'Compatibility/display name; the executable route calls explain_diff.',
  },
  explain_diff: {
    executable: true,
    state: 'standalone_route',
    note: 'POST /assist/explain-diff calls getAdapter(explain_diff).',
  },
  orchestrator: {
    executable: true,
    state: 'live_router',
    note: 'V5 routing resolves the executable model with task id orchestrator.',
  },
  routing: {
    executable: false,
    state: 'display_only',
    executableTask: 'orchestrator',
    note: 'PMS prompt/display name; its modelConfig/default is not consumed by the call.',
  },
  repair_graph: {
    executable: false,
    state: 'inert_compatibility',
    note: 'Preserved for external PMS readiness; no LLM adapter capability or caller exists.',
  },
  critique_graph: {
    executable: true,
    state: 'standalone_route',
    note: 'POST /assist/critique-graph resolves critique_graph through the router.',
  },
  decision_review: {
    executable: true,
    state: 'standalone_route',
    note: 'Decision-review invoke path resolves decision_review through the router.',
  },
  validate_graph: {
    executable: true,
    state: 'live_router',
    note: 'Pass-2 validation is enabled by default and resolves validate_graph.',
  },
  m2_graph_review: {
    executable: false,
    state: 'feature_gated',
    gate: 'CEE_V6_DUAL_DRAFT_ENABLED + provisioned prompt + explicit CEE_MODEL_M2_REVIEW',
    note: 'Code path exists but remains inert unless every activation gate passes.',
  },
  extraction: {
    executable: true,
    state: 'dedicated_adapter',
    note: 'Factor extraction uses the dedicated extraction adapter/model authority.',
  },
  rolling_summary: {
    executable: true,
    state: 'dedicated_adapter',
    note:
      'The post-commit rolling-summary maintainer calls the shared Anthropic chat boundary with its code-constant four-slot prompt.',
  },
  decision_review_decompose: {
    executable: false,
    state: 'feature_gated',
    gate: 'CEE_DECISION_REVIEW_DECOMPOSE',
    note:
      'When its explicit experiment gate is enabled, decision review fans out four provider-specific code-constant Anthropic calls.',
  },
};

export type RuntimeAiTaskId =
  | 'draft_graph'
  | 'edit_graph'
  | 'suggest_options'
  | 'critique_graph'
  | 'decision_review'
  | 'validate_graph'
  | 'orchestrator'
  | 'clarify_brief'
  | 'explain_diff'
  | 'extraction'
  | 'rolling_summary'
  | 'decision_review_decompose'
  | 'm2_graph_review';

export interface RuntimeAiTaskAuthority {
  /** Static production code path; current availability lives in lifecycle. */
  readonly hasExecutablePath: boolean;
  readonly modelAuthority:
    | 'router_task_chain'
    | 'router_env_or_global_fallback'
    | 'router_global_fallback'
    | 'dedicated_extraction_chain'
    | 'dedicated_anthropic_chain';
  readonly checkedInModel: string | null;
  readonly promptAuthority:
    | 'pms_or_checked_in_default'
    | 'provider_specific_pms_or_inline_constant'
    | 'routing_snapshot_or_checked_in_default'
    | 'code_constant'
    | 'provider_specific_code_constant'
    | 'caller_supplied';
  readonly promptTask: string | null;
  readonly promptIdentity:
    | 'runtime_source_version_hash'
    | 'provider_specific_runtime_or_code_hash'
    | 'code_hash'
    | 'caller_owned';
  readonly structuredContract: string;
  readonly fallback: string;
  readonly promotionGate: 'decision_review_hash_bound_eval' | 'none_no_real_pack';
}

/**
 * The bounded runtime map: only actual LLM call tasks plus the separately
 * gated M2 path. Exact prompt bytes/version/hash remain runtime facts exposed
 * by prompt metadata; this map pins which authority must supply them.
 */
export const RUNTIME_AI_TASK_AUTHORITY = {
  draft_graph: {
    hasExecutablePath: true,
    modelAuthority: 'router_task_chain',
    checkedInModel: TASK_MODEL_DEFAULTS.draft_graph,
    promptAuthority: 'pms_or_checked_in_default',
    promptTask: 'draft_graph',
    promptIdentity: 'runtime_source_version_hash',
    structuredContract: 'DraftGraphResult + graph-schema validation/normalisation',
    fallback: 'checked-in draft_graph prompt and registered task model',
    promotionGate: 'none_no_real_pack',
  },
  edit_graph: {
    hasExecutablePath: true,
    modelAuthority: 'router_task_chain',
    checkedInModel: TASK_MODEL_DEFAULTS.edit_graph,
    promptAuthority: 'pms_or_checked_in_default',
    promptTask: 'edit_graph',
    promptIdentity: 'runtime_source_version_hash',
    structuredContract: 'Anthropic edit tool schema + deterministic patch validation',
    fallback: 'checked-in edit_graph prompt and registered task model',
    promotionGate: 'none_no_real_pack',
  },
  suggest_options: {
    hasExecutablePath: true,
    modelAuthority: 'router_task_chain',
    checkedInModel: TASK_MODEL_DEFAULTS.suggest_options,
    promptAuthority: 'pms_or_checked_in_default',
    promptTask: 'suggest_options',
    promptIdentity: 'runtime_source_version_hash',
    structuredContract: 'SuggestOptionsOutput schema',
    fallback:
      'Anthropic and OpenAI serve the exact PMS/default suggest_options snapshot; fixtures remain deterministic',
    promotionGate: 'none_no_real_pack',
  },
  critique_graph: {
    hasExecutablePath: true,
    modelAuthority: 'router_task_chain',
    checkedInModel: TASK_MODEL_DEFAULTS.critique_graph,
    promptAuthority: 'pms_or_checked_in_default',
    promptTask: 'critique_graph',
    promptIdentity: 'runtime_source_version_hash',
    structuredContract: 'CritiqueGraphResult schema',
    fallback: 'Anthropic serves PMS/default bytes; the checked-in OpenAI model lacks this adapter capability',
    promotionGate: 'none_no_real_pack',
  },
  decision_review: {
    hasExecutablePath: true,
    modelAuthority: 'router_task_chain',
    checkedInModel: TASK_MODEL_DEFAULTS.decision_review,
    promptAuthority: 'pms_or_checked_in_default',
    promptTask: 'decision_review',
    promptIdentity: 'runtime_source_version_hash',
    structuredContract: 'decision-review output schema + deterministic readback validation',
    fallback: 'checked-in decision_review prompt and registered task model',
    promotionGate: 'decision_review_hash_bound_eval',
  },
  validate_graph: {
    hasExecutablePath: true,
    modelAuthority: 'router_task_chain',
    checkedInModel: TASK_MODEL_DEFAULTS.validate_graph,
    promptAuthority: 'pms_or_checked_in_default',
    promptTask: 'validate_graph',
    promptIdentity: 'runtime_source_version_hash',
    structuredContract: 'json_object response + Pass2Response parser/schema',
    fallback: 'checked-in validate_graph prompt and independent registered model',
    promotionGate: 'none_no_real_pack',
  },
  orchestrator: {
    hasExecutablePath: true,
    modelAuthority: 'router_task_chain',
    checkedInModel: TASK_MODEL_DEFAULTS.orchestrator,
    promptAuthority: 'routing_snapshot_or_checked_in_default',
    promptTask: 'routing',
    promptIdentity: 'runtime_source_version_hash',
    structuredContract: 'Olumi action tool schema + routing validator',
    fallback: 'checked-in routing prompt snapshot and registered orchestrator model',
    promotionGate: 'none_no_real_pack',
  },
  clarify_brief: {
    hasExecutablePath: true,
    modelAuthority: 'router_env_or_global_fallback',
    checkedInModel: null,
    promptAuthority: 'provider_specific_pms_or_inline_constant',
    promptTask: 'clarify_brief',
    promptIdentity: 'provider_specific_runtime_or_code_hash',
    structuredContract: 'ClarifyBriefResult schema',
    fallback: 'OpenAI serves its inline prompt; Anthropic serves PMS/default clarify_brief bytes',
    promotionGate: 'none_no_real_pack',
  },
  explain_diff: {
    hasExecutablePath: true,
    modelAuthority: 'router_global_fallback',
    checkedInModel: null,
    promptAuthority: 'code_constant',
    promptTask: null,
    promptIdentity: 'code_hash',
    structuredContract: 'ExplainDiffResult rationales parser',
    fallback: 'code-constant prompt; global model must resolve to Anthropic capability',
    promotionGate: 'none_no_real_pack',
  },
  extraction: {
    hasExecutablePath: true,
    modelAuthority: 'dedicated_extraction_chain',
    checkedInModel: AUXILIARY_MODEL_DEFAULTS.extraction,
    promptAuthority: 'caller_supplied',
    promptTask: null,
    promptIdentity: 'caller_owned',
    structuredContract: 'JSON extraction parser + caller schema',
    fallback: 'dedicated registered extraction model; no drafting/global-model inheritance',
    promotionGate: 'none_no_real_pack',
  },
  rolling_summary: {
    hasExecutablePath: true,
    modelAuthority: 'dedicated_anthropic_chain',
    checkedInModel: 'claude-haiku-4-5',
    promptAuthority: 'code_constant',
    promptTask: null,
    promptIdentity: 'code_hash',
    structuredContract:
      'exact DECISION FRAME / CONSTRAINTS & PREFERENCES / RESOLVED / OPEN slots + deterministic parser and retention gates',
    fallback:
      'CEE_MODEL_SUMMARY then DEFAULT_SUMMARY_MODEL; invalid or non-Anthropic assignments fail before the shared network boundary',
    promotionGate: 'none_no_real_pack',
  },
  decision_review_decompose: {
    hasExecutablePath: true,
    modelAuthority: 'dedicated_anthropic_chain',
    checkedInModel: 'claude-haiku-4-5',
    promptAuthority: 'provider_specific_code_constant',
    promptTask: null,
    promptIdentity: 'code_hash',
    structuredContract:
      'four JSON fragment schemas + deterministic composer and composed-consistency check',
    fallback:
      'CEE_MODEL_DECISION_REVIEW_HAIKU then DEFAULT_DECOMPOSE_MODEL; failed/inconsistent fan-out falls back to the governed monolith',
    promotionGate: 'none_no_real_pack',
  },
  m2_graph_review: {
    hasExecutablePath: true,
    modelAuthority: 'router_task_chain',
    checkedInModel: TASK_MODEL_DEFAULTS.m2_graph_review,
    promptAuthority: 'pms_or_checked_in_default',
    promptTask: 'm2_graph_review',
    promptIdentity: 'runtime_source_version_hash',
    structuredContract: 'M2 outputSchema + deterministic review parser',
    fallback: 'inert unless feature, prompt, explicit model and budget gates all pass',
    promotionGate: 'none_no_real_pack',
  },
} as const satisfies Readonly<
  Record<RuntimeAiTaskId, RuntimeAiTaskAuthority>
>;

export type ExecutableRuntimeTask = {
  [Task in RuntimeAiTaskId]:
    (typeof RUNTIME_AI_TASK_AUTHORITY)[Task]['hasExecutablePath'] extends true
      ? Task
      : never;
}[RuntimeAiTaskId];

/**
 * Reporting and governance consumers derive the complete executable-path set
 * from runtime authority. Compatibility/display rows may still be reported,
 * but they cannot displace or hide an actual adapter path.
 */
export const EXECUTABLE_RUNTIME_TASKS = Object.freeze(
  (Object.keys(RUNTIME_AI_TASK_AUTHORITY) as RuntimeAiTaskId[]).filter(
    (task): task is ExecutableRuntimeTask =>
      RUNTIME_AI_TASK_AUTHORITY[task].hasExecutablePath,
  ),
);

/**
 * Explicit adapter-capability exceptions for routed tasks.
 *
 * Most LLMAdapter operations are implemented by every real provider. These
 * two are deliberately different: OpenAI exposes compatibility stubs that
 * throw before making a call, while Anthropic and the deterministic Fixtures
 * adapter implement the operation. Keeping the exception beside runtime task
 * authority lets both router execution and admin reporting consume one fact.
 */
export const ROUTER_TASK_PROVIDER_CAPABILITIES = Object.freeze({
  critique_graph: Object.freeze(['anthropic', 'fixtures'] as const),
  explain_diff: Object.freeze(['anthropic', 'fixtures'] as const),
} as const satisfies Partial<
  Record<
    ExecutableRuntimeTask,
    readonly ResolvedModelAssignment['provider'][]
  >
>);

export type RouterTaskWithProviderConstraint =
  keyof typeof ROUTER_TASK_PROVIDER_CAPABILITIES;

/**
 * Fail closed before adapter construction when a task's resolved provider has
 * no executable implementation. Fixtures remain a first-class test provider
 * only for tasks whose FixturesAdapter limb genuinely exists.
 */
export function requireTaskModelAssignmentCapability(
  task: string | undefined,
  assignment: ResolvedModelAssignment,
): ResolvedModelAssignment {
  if (!(task && task in ROUTER_TASK_PROVIDER_CAPABILITIES)) {
    return assignment;
  }

  const supportedProviders = ROUTER_TASK_PROVIDER_CAPABILITIES[
    task as RouterTaskWithProviderConstraint
  ] as readonly ResolvedModelAssignment['provider'][];
  if (supportedProviders.includes(assignment.provider)) {
    return assignment;
  }

  throw new ModelAssignmentError(
    'MODEL_PROVIDER_MISMATCH',
    assignment.model,
    `Model '${assignment.model}' resolves to provider '${assignment.provider}', ` +
      `which does not implement task '${task}'. Supported providers: ` +
      `${supportedProviders.join(', ')}.`,
  );
}

export type ExecutableDedicatedRuntimeTask = {
  [Task in RuntimeAiTaskId]:
    (typeof RUNTIME_AI_TASK_AUTHORITY)[Task]['hasExecutablePath'] extends true
      ? (typeof RUNTIME_AI_TASK_AUTHORITY)[Task]['modelAuthority'] extends `dedicated_${string}`
        ? Task
        : never
      : never;
}[RuntimeAiTaskId];

/**
 * Admin/reporting consumers derive this set from runtime authority instead of
 * maintaining a second list that can silently omit a newly executable
 * dedicated chain.
 */
export const EXECUTABLE_DEDICATED_RUNTIME_TASKS = Object.freeze(
  (Object.keys(RUNTIME_AI_TASK_AUTHORITY) as RuntimeAiTaskId[]).filter(
    (task): task is ExecutableDedicatedRuntimeTask => {
      const authority = RUNTIME_AI_TASK_AUTHORITY[task];
      return (
        authority.hasExecutablePath &&
        authority.modelAuthority.startsWith('dedicated_')
      );
    },
  ),
);

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
