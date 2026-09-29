/**
 * Model Registry
 *
 * Central registry of supported LLM models with tier classification,
 * cost metrics, and availability status. Used by the model selector
 * to make intelligent routing decisions.
 */

import { EXPLICIT_MODEL_ALIASES } from './model-aliases.js';

export type ModelProvider = "openai" | "anthropic";
export type ModelTier = "fast" | "quality" | "premium";

export interface ModelConfig {
  /** Model identifier (e.g., "gpt-4o-mini") */
  id: string;
  /** Provider (openai or anthropic) */
  provider: ModelProvider;
  /** Tier classification for routing decisions */
  tier: ModelTier;
  /** Whether this model is currently enabled */
  enabled: boolean;
  /** Maximum tokens for responses */
  maxTokens: number;
  /**
   * ⚠ DISCLOSED CORRECTION (2026-07-31) — **THIS FIELD IS MIS-NAMED AND
   * INCOMPLETE. Do not use it for a cost figure without fixing it first.**
   *
   * The name says per-1K tokens; every value in MODEL_REGISTRY is in fact the
   * provider's per-MILLION INPUT price (e.g. `gpt-4o-mini: 0.15` is $0.15 per
   * 1M input tokens, not per 1K — a 1000× error if read literally; `gpt-4o:
   * 2.5` = $2.50/1M; `gpt-4.1-2025-04-14: 2.0` = $2.00/1M). There is also NO
   * output price anywhere in the registry, and output is the more expensive
   * side, so even a corrected unit could not produce a true call cost.
   *
   * Left in place rather than renamed because the blast radius is provably
   * ZERO: the field has NO READERS. Scope of that absence claim — `rg -a -n
   * 'costPer1kTokens'` over `src/` and `tools/` at staging tip 23922368
   * returns 3 hits: this declaration and two lines of the MAINTENANCE NOTE
   * below, plus the literal values inside MODEL_REGISTRY itself. Nothing
   * computes with it, logs it, or bills on it (CLAUDE.md trap 10 — a
   * write-only field cannot poison anything downstream).
   *
   * The honest repair is a rename to `inputCostPerMillionTokens` plus an
   * `outputCostPerMillionTokens` sibling, re-derived from live provider
   * pricing. ROWED, not done here: it touches every registry entry and would
   * bury three unrelated fixes in a 40-row diff.
   */
  costPer1kTokens: number;
  /** Expected average latency in milliseconds */
  averageLatencyMs: number;
  /** Quality score 0-1 (for fallback prioritization) */
  qualityScore: number;
  /** Human-readable description */
  description: string;
  /** Whether this is a reasoning model (requires reasoning_effort parameter for OpenAI) */
  reasoning?: boolean;
  /** Whether this model supports extended thinking (Anthropic models) */
  extendedThinking?: boolean;
  /**
   * Whether this model REJECTS non-default sampling params (temperature/top_p/top_k)
   * with an HTTP 400. True for Sonnet 5, Opus 4.7/4.8, Fable 5. Callers must OMIT
   * temperature entirely for these models (see chatWithToolsAnthropic).
   */
  rejectsSamplingParams?: boolean;
}

/**
 * Model Registry
 *
 * Defines all supported models with their characteristics.
 * Models can be enabled/disabled via environment variables.
 *
 * MAINTENANCE NOTE:
 * The costPer1kTokens values should be reviewed quarterly or when providers
 * announce pricing changes. Current prices as of 2025-01:
 * - OpenAI: https://openai.com/pricing
 * - Anthropic: https://www.anthropic.com/pricing
 *
 * When adding new models, ensure costPer1kTokens reflects input token pricing
 * (output pricing is typically higher but we use input for cost estimation).
 *
 * REASONING EFFORT (OpenAI):
 * Models with reasoning: true support the reasoning_effort parameter:
 * - 'low': Faster, less thorough reasoning
 * - 'medium': Balanced (default)
 * - 'high': Most thorough, higher latency and cost
 *
 * EXTENDED THINKING (Anthropic):
 * Models with extendedThinking: true support the budget_tokens parameter
 * for controlling thinking depth.
 */
export const MODEL_REGISTRY: Record<string, ModelConfig> = {
  // ============================================================
  // OpenAI GPT-4 Family (Standard Models)
  // ============================================================
  "gpt-4o-mini": {
    id: "gpt-4o-mini",
    provider: "openai",
    tier: "fast",
    enabled: true,
    maxTokens: 16384,
    costPer1kTokens: 0.15,
    averageLatencyMs: 800,
    qualityScore: 0.75,
    description: "GPT-4o Mini - fast, cost-effective for simple tasks",
  },
  "gpt-4o": {
    id: "gpt-4o",
    provider: "openai",
    tier: "quality",
    enabled: true,
    maxTokens: 16384,
    costPer1kTokens: 2.5,
    averageLatencyMs: 2000,
    qualityScore: 0.92,
    description: "GPT-4o - high-quality multimodal model",
  },
  "gpt-4-turbo": {
    id: "gpt-4-turbo",
    provider: "openai",
    tier: "quality",
    enabled: true,
    maxTokens: 4096,
    costPer1kTokens: 10.0,
    averageLatencyMs: 3000,
    qualityScore: 0.90,
    description: "GPT-4 Turbo - legacy high-quality model",
  },

  // ============================================================
  // OpenAI GPT-4.1 Family (Released April 2025)
  // Excels at coding, instruction following, 1M context window
  // Model IDs use date suffix: gpt-4.1-2025-04-14
  // ============================================================
  "gpt-4.1-2025-04-14": {
    id: "gpt-4.1-2025-04-14",
    provider: "openai",
    tier: "quality",
    enabled: true,
    maxTokens: 32768,
    costPer1kTokens: 2.0,
    averageLatencyMs: 1500,
    qualityScore: 0.94,
    description: "GPT-4.1 - optimized for coding and instruction following, 1M context",
  },
  "gpt-4.1-mini-2025-04-14": {
    id: "gpt-4.1-mini-2025-04-14",
    provider: "openai",
    tier: "fast",
    enabled: true,
    maxTokens: 16384,
    costPer1kTokens: 0.4,
    averageLatencyMs: 600,
    qualityScore: 0.85,
    description: "GPT-4.1 Mini - fast, beats GPT-4o in many benchmarks",
  },
  "gpt-4.1-nano-2025-04-14": {
    id: "gpt-4.1-nano-2025-04-14",
    provider: "openai",
    tier: "fast",
    enabled: true,
    maxTokens: 8192,
    costPer1kTokens: 0.1,
    averageLatencyMs: 300,
    qualityScore: 0.78,
    description: "GPT-4.1 Nano - ultra-fast, lowest cost",
  },

  // ============================================================
  // OpenAI GPT-5 Family
  // ============================================================
  "gpt-5-mini": {
    id: "gpt-5-mini",
    provider: "openai",
    tier: "fast",
    enabled: true,
    maxTokens: 8192,
    costPer1kTokens: 0.30,
    averageLatencyMs: 600,
    qualityScore: 0.82,
    description: "GPT-5 Mini - fast generation, no reasoning",
    reasoning: false,
    rejectsSamplingParams: true,
  },
  "gpt-5.2": {
    id: "gpt-5.2",
    provider: "openai",
    tier: "premium",
    enabled: true,
    maxTokens: 100000,
    costPer1kTokens: 15.0,
    averageLatencyMs: 15000,
    qualityScore: 0.98,
    description: "GPT-5.2 - reasoning model with extended thinking",
    reasoning: true,
  },

  // ============================================================
  // OpenAI o1 Reasoning Family
  // ============================================================
  "o1": {
    id: "o1",
    provider: "openai",
    tier: "premium",
    enabled: true,
    maxTokens: 100000,
    costPer1kTokens: 15.0,
    averageLatencyMs: 20000,
    qualityScore: 0.97,
    description: "o1 - advanced reasoning model",
    reasoning: true,
  },
  "o1-mini": {
    id: "o1-mini",
    provider: "openai",
    tier: "quality",
    enabled: true,
    maxTokens: 65536,
    costPer1kTokens: 3.0,
    averageLatencyMs: 8000,
    qualityScore: 0.88,
    description: "o1 Mini - faster reasoning at lower cost",
    reasoning: true,
  },
  "o1-preview": {
    id: "o1-preview",
    provider: "openai",
    tier: "premium",
    enabled: true,
    maxTokens: 32768,
    costPer1kTokens: 15.0,
    averageLatencyMs: 25000,
    qualityScore: 0.96,
    description: "o1 Preview - preview reasoning model",
    reasoning: true,
  },

  // ============================================================
  // OpenAI o4 Reasoning Family
  // ============================================================
  "o4-mini": {
    id: "o4-mini",
    provider: "openai",
    tier: "quality",
    enabled: true,
    maxTokens: 65536,
    costPer1kTokens: 1.10,
    averageLatencyMs: 75000,
    qualityScore: 0.93,
    description: "o4 Mini - reasoning model, zero structural invalids on draft graph",
    reasoning: true,
  },

  // ============================================================
  // OpenAI o3 Reasoning Family
  // ============================================================
  "o3": {
    id: "o3",
    provider: "openai",
    tier: "premium",
    enabled: true,
    maxTokens: 100000,
    costPer1kTokens: 20.0,
    averageLatencyMs: 30000,
    qualityScore: 0.99,
    description: "o3 - most advanced reasoning model",
    reasoning: true,
  },
  "o3-mini": {
    id: "o3-mini",
    provider: "openai",
    tier: "quality",
    enabled: true,
    maxTokens: 65536,
    costPer1kTokens: 4.0,
    averageLatencyMs: 10000,
    qualityScore: 0.92,
    description: "o3 Mini - efficient advanced reasoning",
    reasoning: true,
  },

  // ============================================================
  // Anthropic Claude 3.5 Family
  // ============================================================
  // RETIRED by Anthropic 2026-02-19 (API returns 404 not_found). Entry kept
  // for historical cost tracking per repo convention; disabled so nothing
  // resolves to it. Replacement: claude-haiku-4-5 (below).
  "claude-3-5-haiku-20241022": {
    id: "claude-3-5-haiku-20241022",
    provider: "anthropic",
    tier: "fast",
    enabled: false,
    maxTokens: 8192,
    costPer1kTokens: 0.25,
    averageLatencyMs: 500,
    qualityScore: 0.78,
    description: "Claude 3.5 Haiku - RETIRED 2026-02-19; use claude-haiku-4-5",
  },
  // Haiku 4.5 — the current fast tier (B1 decomposition sub-calls + the S4
  // rolling summariser default after the 2026-07-13 retired-id fix).
  "claude-haiku-4-5": {
    id: "claude-haiku-4-5",
    provider: "anthropic",
    tier: "fast",
    enabled: true,
    maxTokens: 8192,
    costPer1kTokens: 1.0,
    averageLatencyMs: 450,
    qualityScore: 0.85,
    description: "Claude Haiku 4.5 - fastest current Anthropic model",
  },

  // ============================================================
  // Anthropic Claude 4 Family
  // ============================================================
  "claude-sonnet-4-20250514": {
    id: "claude-sonnet-4-20250514",
    provider: "anthropic",
    tier: "quality",
    enabled: true,
    maxTokens: 8192,
    costPer1kTokens: 3.0,
    averageLatencyMs: 2500,
    qualityScore: 0.95,
    description: "Claude Sonnet 4 - high-quality balanced model",
    extendedThinking: true,
  },
  "claude-sonnet-5": {
    id: "claude-sonnet-5",
    provider: "anthropic",
    tier: "quality",
    enabled: true,
    maxTokens: 8192,
    costPer1kTokens: 3.0,
    averageLatencyMs: 2000,
    qualityScore: 0.97,
    description:
      "Claude Sonnet 5 - balanced model; adaptive thinking on by default; rejects non-default sampling params; ~+30% tokenizer vs 4.6",
    extendedThinking: true,
    rejectsSamplingParams: true,
  },
  "claude-sonnet-4-6": {
    id: "claude-sonnet-4-6",
    provider: "anthropic",
    tier: "quality",
    enabled: true,
    maxTokens: 8192,
    costPer1kTokens: 3.0,
    averageLatencyMs: 2000,
    qualityScore: 0.96,
    description: "Claude Sonnet 4.6 - latest balanced model, no extended thinking",
    extendedThinking: false,
  },
  "claude-sonnet-4-5-20250929": {
    id: "claude-sonnet-4-5-20250929",
    provider: "anthropic",
    tier: "quality",
    enabled: true,
    maxTokens: 16384,
    costPer1kTokens: 3.0,
    averageLatencyMs: 2000,
    qualityScore: 0.96,
    description: "Claude Sonnet 4.5 - improved balanced model with extended thinking",
    extendedThinking: true,
  },
  "claude-opus-4-6": {
    id: "claude-opus-4-6",
    provider: "anthropic",
    tier: "premium",
    enabled: true,
    maxTokens: 32768,
    costPer1kTokens: 15.0,
    averageLatencyMs: 20000,
    qualityScore: 0.99,
    description: "Claude Opus 4.6 - latest premium model with extended thinking",
    extendedThinking: true,
  },
  "claude-opus-4-20250514": {
    id: "claude-opus-4-20250514",
    provider: "anthropic",
    tier: "premium",
    enabled: true,
    maxTokens: 16384,
    costPer1kTokens: 15.0,
    averageLatencyMs: 20000,
    qualityScore: 0.98,
    description: "Claude Opus 4 - premium reasoning model",
    extendedThinking: true,
  },
  "claude-opus-4-5-20251101": {
    id: "claude-opus-4-5-20251101",
    provider: "anthropic",
    tier: "premium",
    enabled: true,
    maxTokens: 32768,
    costPer1kTokens: 15.0,
    averageLatencyMs: 25000,
    qualityScore: 0.99,
    description: "Claude Opus 4.5 - highest quality with extended thinking",
    extendedThinking: true,
  },
  // Judgement tier (MODEL-ROUTING-POLICY 2.0). Registered 2026-07-24 (1.185(a)
  // rec-2, delta D1): this id is the m2_graph_review default (model-routing.ts)
  // but was ABSENT from the registry — a trap-12 absent-default that would 400
  // if the (dark) dual-draft path ever activated, and the reason the extended
  // boot drift guard flagged m2_graph_review. Registering it here closes the
  // gap; live paths are unaffected (dual-draft is inert by default).
  "claude-opus-4-8": {
    id: "claude-opus-4-8",
    provider: "anthropic",
    tier: "premium",
    enabled: true,
    maxTokens: 32768,
    costPer1kTokens: 15.0,
    averageLatencyMs: 20000,
    qualityScore: 0.99,
    description:
      "Claude Opus 4.8 - premium judgement-tier model; adaptive thinking; rejects non-default sampling params",
    extendedThinking: true,
    rejectsSamplingParams: true,
  },

  // ============================================================
  // Test Model (Disabled)
  // ============================================================
  // Test-only disabled model - used for testing disabled model validation
  // DO NOT enable in production
  "test-disabled-model": {
    id: "test-disabled-model",
    provider: "openai",
    tier: "fast",
    enabled: false,
    maxTokens: 4096,
    costPer1kTokens: 0.01,
    averageLatencyMs: 1000,
    qualityScore: 0.5,
    description: "Test model for validation tests - always disabled",
  },
};

/**
 * Get configuration for a specific model
 */
export function getModelConfig(modelId: string): ModelConfig | undefined {
  return MODEL_REGISTRY[modelId];
}

/**
 * Check if a model is enabled
 */
export function isModelEnabled(modelId: string): boolean {
  return MODEL_REGISTRY[modelId]?.enabled ?? false;
}

/**
 * Boot fail-loud registry check for ONE default model assignment (Lane F,
 * 2026-07-23; extended to all call sites 2026-07-24, ROADMAP 1.185(a) rec-2 /
 * MODEL-ROUTING-POLICY D10; DRAFTING-COMPONENT-DESIGN Q4 "derive-don't-mirror").
 *
 * `label` names the call site (e.g. "task_default:orchestrator",
 * "rolling_summary_default") so a boot ERROR points at the exact drifted locus.
 * Returns fail-loud error strings — empty ONLY when `modelId` is an enabled
 * registry id or an explicit alias to one. The check reads the shared alias and
 * registry authorities, so it cannot silently agree with a stale heuristic.
 * Used batched at startup via
 * validateModelsRegistered so an unregistered/disabled model id ANYWHERE (a
 * checked-in default OR a router-bypass default) surfaces at boot rather than as
 * a 400/500 at the first request that touches that path.
 */
export function validateModelRegistered(
  label: string,
  modelId: string | null | undefined,
  kind: ModelRegistryCheckKind = 'checked_in_default',
): string[] {
  const errors: string[] = [];
  if (!modelId) {
    errors.push(
      `The resolved default model for "${label}" is empty — no model is configured and no code default resolved. ` +
      `That call site would fail at request time. Set the ${label} model (PMS prompt config / CEE_MODEL_* / TASK_MODEL_DEFAULTS).`,
    );
    return errors;
  }
  const aliasTarget = EXPLICIT_MODEL_ALIASES[
    modelId as keyof typeof EXPLICIT_MODEL_ALIASES
  ];
  const registryId = aliasTarget ?? modelId;
  if (!isKnownModel(registryId)) {
    if (kind === 'inert_inventory') {
      errors.push(
        `The inert inventory model "${modelId}" for "${label}" is neither an enabled registry id nor an explicit alias. ` +
        'This value has no serving authority; remove/fix the inventory value before attaching it to a live shared resolver.',
      );
      return errors;
    }
    errors.push(
      `The ${kind === 'operator_override' ? 'configured' : 'resolved default'} model ` +
        `"${modelId}" for "${label}" is neither an enabled registry id nor an explicit alias. ` +
        'Runtime resolution will reject it before an adapter call.',
    );
  } else if (!isModelEnabled(registryId)) {
    if (kind === 'inert_inventory') {
      errors.push(
        `The inert inventory model "${modelId}" for "${label}" resolves to registry row "${registryId}", which is DISABLED. ` +
        'This value has no serving authority; do not promote it into a live resolver.',
      );
      return errors;
    }
    errors.push(
      `The ${kind === 'operator_override' ? 'configured' : 'resolved default'} model ` +
        `"${modelId}" for "${label}" resolves to registry row "${registryId}", which is DISABLED. ` +
        `Runtime resolution will reject it before an adapter call.`,
    );
  }
  return errors;
}

/**
 * Boot fail-loud registry drift guard for a BATCH of default model assignments.
 * The server derives the batch from the real sources (see
 * {@link buildModelRegistryCheckBatch}) so a bad/retired/disabled id trips the
 * guard at boot instead of drifting silently (the estate's dominant defect
 * class, CLAUDE.md trap-12). Returns the concatenated fail-loud errors
 * (empty = clean).
 */
export function validateModelsRegistered(
  entries: ReadonlyArray<ModelRegistryCheckEntry>,
): string[] {
  return entries.flatMap((entry) =>
    validateModelRegistered(entry.label, entry.modelId, entry.kind),
  );
}

/**
 * What KIND of configuration produced this model id. It selects the failure
 * copy, so diagnostics still identify whether source or deployment config
 * needs correction:
 *   - `checked_in_default`  a value in this repo — drift/typo in our own source
 *   - `operator_override`   a live `CEE_MODEL_*` env value
 *   - `inert_inventory`     parsed/audited legacy inventory with no serving consumer
 */
export type ModelRegistryCheckKind =
  | 'checked_in_default'
  | 'operator_override'
  | 'inert_inventory';

/** One labelled model id awaiting the boot registry check. */
export interface ModelRegistryCheckEntry {
  readonly label: string;
  readonly modelId: string | null | undefined;
  /** Defaults to `checked_in_default` when omitted. */
  readonly kind?: ModelRegistryCheckKind;
}

/**
 * Assemble the boot registry drift guard's batch — DERIVED, never hand-listed.
 *
 * ─────────────────────────────────────────────────────────────────
 * Why this exists (assessment-models-prompts.md §1.5, 2026-07-31)
 * ─────────────────────────────────────────────────────────────────
 * The guard used to check `draft_graph` EFFECTIVE + every CHECKED-IN
 * `TASK_MODEL_DEFAULTS` value. But env overrides WIN over checked-in defaults
 * (router precedence step 3 > step 4, `adapters/llm/router.ts`), so the model
 * ids that actually SERVE were exactly the ones the guard never saw. Three live
 * tasks were running on the bare, UNREGISTERED alias `gpt-4.1`
 * (`CEE_MODEL_DECISION_REVIEW` / `_REPAIR` / `_EXTRACTION`) — a floating alias
 * OpenAI can repoint at any time — and nothing in the estate said so out loud.
 *
 * Coverage argument, stated exactly rather than implied: the EFFECTIVE model
 * for a task is `env ?? checked-in default`. This batch carries EVERY env value
 * AND EVERY checked-in default, so it is a SUPERSET of the effective set. It
 * cannot miss an effective id — including for `extraction`, whose dedicated
 * adapter default is supplied alongside the router defaults by
 * `buildBootModelRegistryBatch`.
 *
 * DERIVE-DON'T-MIRROR (CLAUDE.md trap 12), at BOTH levels: each env record is
 * walked as a RECORD (so a `CEE_MODEL_*` key added to the config schema
 * tomorrow is validated with no edit here), and the records themselves are
 * passed as a MAP (so a whole new env tier is one line at the seam, not a
 * rewrite here).
 *
 * Historical `CEE_MODEL_TASK_*` values are no longer passed to this serving
 * batch: their selector has no importers. `buildBootModelRegistryBatch` audits
 * them separately as `inert_inventory`, while the shared runtime/admin routing
 * projection is the only source allowed to make serving claims.
 *
 * Unset / empty / whitespace env values are SKIPPED, not reported: an unset
 * `CEE_MODEL_*` is the normal posture (the task lands on its checked-in
 * default, which is validated separately). Reporting it would make the guard
 * cry wolf, and an alarm everyone learns to ignore is a broken alarm
 * (CLAUDE.md trap 7).
 *
 * @param envModelRecords label-prefix → record of operator-supplied ids, e.g.
 *   `{ env_model: config.cee.models, env_task_model: …taskModels }`. The prefix
 *   becomes the error label so an operator can tell WHICH env var to fix.
 */
export function buildModelRegistryCheckBatch(
  taskDefaults: Readonly<Record<string, string>>,
  envModelRecords: Readonly<Record<string, Readonly<Record<string, string | undefined>> | undefined>>,
  extra: ReadonlyArray<ModelRegistryCheckEntry> = [],
): ModelRegistryCheckEntry[] {
  return [
    // Every checked-in task default (the mirrors most likely to drift).
    ...Object.entries(taskDefaults).map(([task, modelId]) => ({
      label: `task_default:${task}`,
      modelId,
      kind: 'checked_in_default' as const,
    })),
    // Every operator-supplied value in every env tier — the EFFECTIVE ids.
    ...Object.entries(envModelRecords).flatMap(([prefix, record]) =>
      Object.entries(record ?? {})
        .filter(
          (pair): pair is [string, string] =>
            typeof pair[1] === 'string' && pair[1].trim().length > 0,
        )
        .map(([key, modelId]) => ({
          label: `${prefix}:${key}`,
          modelId,
          kind: 'operator_override' as const,
        })),
    ),
    // Router-bypass defaults the caller resolves itself.
    ...extra,
  ];
}

/**
 * Back-compat wrapper (Lane F). The draft path passes the EFFECTIVE resolved
 * draft model (env override applied over the checked-in default); delegating to
 * the generalised core keeps ONE validation mechanism, not two copies.
 */
export function validateDraftModelRegistered(modelId: string | null | undefined): string[] {
  return validateModelRegistered("draft_graph", modelId);
}

/**
 * Get all enabled models
 */
export function getEnabledModels(): ModelConfig[] {
  return Object.values(MODEL_REGISTRY).filter((m) => m.enabled);
}

/**
 * Get enabled models by tier
 */
export function getEnabledModelsByTier(tier: ModelTier): ModelConfig[] {
  return Object.values(MODEL_REGISTRY).filter(
    (m) => m.enabled && m.tier === tier
  );
}

/**
 * Get the best available model for a given tier
 * Returns the enabled model with the highest quality score in that tier
 */
export function getBestModelForTier(tier: ModelTier): ModelConfig | undefined {
  const models = getEnabledModelsByTier(tier);
  if (models.length === 0) return undefined;
  return models.reduce((best, current) =>
    current.qualityScore > best.qualityScore ? current : best
  );
}

/**
 * Validate that a model ID exists in the registry
 */
export function isKnownModel(modelId: string): boolean {
  return modelId in MODEL_REGISTRY;
}

/**
 * Get provider for a model
 */
export function getModelProvider(modelId: string): ModelProvider | undefined {
  return MODEL_REGISTRY[modelId]?.provider;
}

/**
 * Known reasoning model prefixes for pattern-based fallback.
 * Used when model ID is not in registry (e.g., dated variants like "o1-2025-01").
 */
const REASONING_MODEL_PATTERNS = [
  /^o1(-|$)/,       // o1, o1-mini, o1-preview, o1-2025-01, etc.
  /^o3(-|$)/,       // o3, o3-mini, etc.
  /^o4(-|$)/,       // o4, o4-mini, etc.
  /^gpt-5\.2(-|$)/, // gpt-5.2, gpt-5.2-preview, etc.
];

/**
 * Check if a model is a reasoning model (requires reasoning_effort parameter)
 * First tries registry lookup, then falls back to pattern matching for unregistered variants.
 */
export function isReasoningModel(modelId: string): boolean {
  // First: exact registry lookup
  const registryEntry = MODEL_REGISTRY[modelId];
  if (registryEntry !== undefined) {
    return registryEntry.reasoning === true;
  }

  // Fallback: pattern matching for unregistered model variants
  return REASONING_MODEL_PATTERNS.some(pattern => pattern.test(modelId));
}

/**
 * Check if a model supports extended thinking (Anthropic models)
 * Uses registry lookup - does NOT use string matching
 */
export function supportsExtendedThinking(modelId: string): boolean {
  return MODEL_REGISTRY[modelId]?.extendedThinking === true;
}

/**
 * Whether a model rejects non-default sampling params (temperature/top_p/top_k)
 * with an HTTP 400. Callers must OMIT temperature entirely for these models.
 * Registry lookup first, then a pattern fallback for unregistered dated variants
 * of the affected families (Sonnet 5, Opus 4.7/4.8, Fable 5).
 */
export function rejectsSamplingParams(modelId: string): boolean {
  const entry = MODEL_REGISTRY[modelId];
  if (entry !== undefined) return entry.rejectsSamplingParams === true;
  return /claude-(sonnet-5|opus-4-7|opus-4-8|fable-5)/.test(modelId);
}

/**
 * The temperature to send on an Anthropic request for `modelId`, or `undefined`
 * to OMIT it entirely.
 *
 * SINGLE SOURCE for the omit-sampling-param consequence (FINAL-SWEEP, 2026-07-24;
 * Codex quality F2). The `rejectsSamplingParams(model) ? undefined : (thinking ? 1
 * : requested)` ternary was hand-copied at FIVE Anthropic call sites (draft, chat,
 * stream chat, stream-with-tools, the admin harness), and a new site kept
 * forgetting it — the admin harness was the 5th catch, a request that 400s without
 * the gate. Folding the consequence here means a call site physically cannot omit
 * the gate. Rules (in order): a model that rejects sampling params gets no
 * temperature; extended thinking requires temperature=1; otherwise the caller's
 * requested value (default 0, deterministic).
 */
export function anthropicTemperatureFor(
  modelId: string,
  opts: { requested?: number | null; thinking: boolean },
): number | undefined {
  if (rejectsSamplingParams(modelId)) return undefined;
  if (opts.thinking) return 1;
  return opts.requested ?? 0;
}

/**
 * Check if a model is allowed for client API requests.
 *
 * Returns false if:
 * - Model doesn't exist in registry
 * - Model is not enabled
 * - Model is in the blockedModels list (typically from CLIENT_BLOCKED_MODELS env var)
 *
 * @param modelId - The model ID to check
 * @param blockedModels - Optional list of blocked model IDs (from CLIENT_BLOCKED_MODELS)
 */
export function isModelClientAllowed(modelId: string, blockedModels?: string[]): boolean {
  const aliasTarget = EXPLICIT_MODEL_ALIASES[
    modelId as keyof typeof EXPLICIT_MODEL_ALIASES
  ];
  const registryId = aliasTarget ?? modelId;
  const config = MODEL_REGISTRY[registryId];
  if (!config) return false;
  if (!config.enabled) return false;
  if (
    blockedModels &&
    (blockedModels.includes(modelId) || blockedModels.includes(registryId))
  ) return false;
  return true;
}

/**
 * Get the reason why a model is not allowed for client use.
 * Returns undefined if the model is allowed.
 */
export function getModelBlockReason(modelId: string, blockedModels?: string[]): string | undefined {
  const aliasTarget = EXPLICIT_MODEL_ALIASES[
    modelId as keyof typeof EXPLICIT_MODEL_ALIASES
  ];
  const registryId = aliasTarget ?? modelId;
  const config = MODEL_REGISTRY[registryId];
  if (!config) return `Unknown model '${modelId}'`;
  if (!config.enabled) return `Model '${modelId}' is currently disabled`;
  if (
    blockedModels &&
    (blockedModels.includes(modelId) || blockedModels.includes(registryId))
  ) return `Model '${modelId}' is blocked for client use`;
  return undefined;
}

/**
 * Get list of models allowed for client API requests.
 * Returns all enabled models (runtime blocking via CLIENT_BLOCKED_MODELS
 * is checked in route handlers).
 */
export function getClientAllowedModels(): ModelConfig[] {
  return Object.values(MODEL_REGISTRY).filter(m => m.enabled);
}

/**
 * Model Validation Results
 */
export interface ModelValidationResult {
  modelId: string;
  provider: ModelProvider;
  enabled: boolean;
  tier: ModelTier;
  warnings: string[];
}

export interface ModelValidationSummary {
  timestamp: string;
  totalModels: number;
  enabledModels: number;
  modelsByProvider: Record<string, number>;
  models: ModelValidationResult[];
  warnings: string[];
}

/**
 * Known deprecated model patterns.
 * Add models here that have been sunset by providers.
 * This list is checked at startup to warn about deprecated models.
 */
const KNOWN_DEPRECATED_MODELS: Record<string, string> = {
  "claude-3-5-haiku-20241022": "Retired by Anthropic 2026-02-19 (404 not_found) - use claude-haiku-4-5",
  "claude-3-5-sonnet-20241022": "Sunset by Anthropic - use claude-sonnet-4-20250514",
  "claude-3-opus-20240229": "Sunset by Anthropic - use claude-opus-4-5-20251101",
  "claude-3-sonnet-20240229": "Sunset by Anthropic - use claude-sonnet-4-20250514",
  "gpt-4-turbo-preview": "Replaced by gpt-4o",
  "gpt-4-0125-preview": "Replaced by gpt-4o",
};

/**
 * Check if a model ID matches a deprecated pattern.
 * This helps catch models that may have been sunset by providers.
 */
function checkModelDeprecation(modelId: string): string | null {
  // Check explicit deprecation list
  if (modelId in KNOWN_DEPRECATED_MODELS) {
    return KNOWN_DEPRECATED_MODELS[modelId];
  }

  // Check for old date patterns in Anthropic models (pre-2025)
  const anthropicDateMatch = modelId.match(/claude-.*-(\d{4})(\d{2})(\d{2})$/);
  if (anthropicDateMatch) {
    const year = parseInt(anthropicDateMatch[1], 10);
    if (year < 2025) {
      return `Model date ${anthropicDateMatch[1]}-${anthropicDateMatch[2]}-${anthropicDateMatch[3]} may be deprecated - verify with Anthropic`;
    }
  }

  return null;
}

/**
 * Validate all models in the registry at startup.
 * Returns validation results and warnings for logging.
 *
 * Call this at server startup to:
 * 1. Log all configured models for visibility
 * 2. Warn about potentially deprecated models
 * 3. Detect configuration issues early
 */
export function validateModelsAtStartup(): ModelValidationSummary {
  const models = Object.values(MODEL_REGISTRY);
  const enabledModels = models.filter(m => m.enabled);
  const warnings: string[] = [];

  // Count models by provider
  const modelsByProvider: Record<string, number> = {};
  for (const model of enabledModels) {
    modelsByProvider[model.provider] = (modelsByProvider[model.provider] || 0) + 1;
  }

  // Validate each model
  const validationResults: ModelValidationResult[] = models.map(model => {
    const modelWarnings: string[] = [];

    // Check for deprecation
    const deprecationWarning = checkModelDeprecation(model.id);
    if (deprecationWarning) {
      modelWarnings.push(deprecationWarning);
      warnings.push(`Model ${model.id}: ${deprecationWarning}`);
    }

    // Check for missing required fields
    if (!model.description) {
      modelWarnings.push("Missing description");
    }

    // Warn if model is disabled but still in registry
    if (!model.enabled) {
      modelWarnings.push("Model is disabled");
    }

    return {
      modelId: model.id,
      provider: model.provider,
      enabled: model.enabled,
      tier: model.tier,
      warnings: modelWarnings,
    };
  });

  // Check for missing provider coverage
  if (!modelsByProvider["openai"]) {
    warnings.push("No OpenAI models enabled - OpenAI requests will fail");
  }
  if (!modelsByProvider["anthropic"]) {
    warnings.push("No Anthropic models enabled - Anthropic requests will fail");
  }

  // Check for missing tier coverage
  const enabledTiers = new Set(enabledModels.map(m => m.tier));
  const allTiers: ModelTier[] = ["fast", "quality", "premium"];
  for (const tier of allTiers) {
    if (!enabledTiers.has(tier)) {
      warnings.push(`No models enabled for tier: ${tier}`);
    }
  }

  return {
    timestamp: new Date().toISOString(),
    totalModels: models.length,
    enabledModels: enabledModels.length,
    modelsByProvider,
    models: validationResults,
    warnings,
  };
}

/**
 * Get a summary of enabled models for logging.
 * Returns a compact representation suitable for startup logs.
 */
export function getEnabledModelsSummary(): {
  openai: string[];
  anthropic: string[];
  byTier: Record<ModelTier, string[]>;
} {
  const enabled = getEnabledModels();

  return {
    openai: enabled.filter(m => m.provider === "openai").map(m => m.id),
    anthropic: enabled.filter(m => m.provider === "anthropic").map(m => m.id),
    byTier: {
      fast: enabled.filter(m => m.tier === "fast").map(m => m.id),
      quality: enabled.filter(m => m.tier === "quality").map(m => m.id),
      premium: enabled.filter(m => m.tier === "premium").map(m => m.id),
    },
  };
}
