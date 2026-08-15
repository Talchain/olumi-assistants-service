/**
 * Provider router for multi-provider LLM orchestration.
 *
 * Selects LLM adapter (Anthropic, OpenAI, Fixtures) using the canonical
 * precedence documented in `src/config/model-routing.ts`. Provider follows
 * the winning model: a task default is not discarded merely because the
 * lower-precedence global `LLM_PROVIDER` names the other provider.
 */

import { readFileSync, existsSync } from "node:fs";
import { readFile, access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { join } from "node:path";
import { log } from "../../utils/telemetry.js";
import { config, getClientBlockedModels } from "../../config/index.js";
import type {
  LLMAdapter,
  DraftGraphArgs,
  DraftGraphResult,
  SuggestOptionsArgs,
  SuggestOptionsResult,
  ClarifyBriefArgs,
  ClarifyBriefResult,
  CritiqueGraphArgs,
  CritiqueGraphResult,
  ExplainDiffArgs,
  ExplainDiffResult,
  ChatArgs,
  ChatResult,
  CallOpts,
} from "./types.js";
import { AnthropicAdapter } from "./anthropic.js";
import { OpenAIAdapter } from "./openai.js";
import { FailoverAdapter } from "./failover.js";
import { withCaching } from "./caching.js";
import { withUsageTracking } from "./usage-tracking.js";
import { isValidCeeTask, getDefaultModelForTask } from "../../config/model-routing.js";
import {
  resolveModelAssignment,
  type ModelAssignmentAvailability,
  type ResolvedModelAssignment,
} from "../../config/model-assignment.js";
import { FALLBACK_ANTHROPIC_MODEL } from "./model-fallback.js";
import {
  resolveRouterResolution,
  type ProviderConfig,
  type RouterResolutionOutcome,
  type RouterResolutionSource,
} from "./router-resolution.js";

/**
 * Map task names to CEE model config keys — the router's env-override table.
 * Used to look up per-operation model from config.cee.models.* (CEE_MODEL_*)
 * and config.cee.maxTokens.*
 *
 * Exported so the model-map drift tripwire (tests/unit/model-map-drift.test.ts)
 * can DERIVE the set of tasks the router routes an override for, rather than
 * re-listing it — every such task must have a checked-in default in
 * TASK_MODEL_DEFAULTS (or be declared in ROUTER_ENV_ONLY_TASKS below).
 */
export const TASK_TO_CONFIG_KEY: Record<string, keyof typeof config.cee.models> = {
  'draft_graph': 'draft',
  'suggest_options': 'options',
  'repair_graph': 'repair',
  'clarify_brief': 'clarification',
  'critique_graph': 'critique',
  'validate': 'validation',
  'validate_graph': 'validation',
  'decision_review': 'decision_review',
  'orchestrator': 'orchestrator',
  'edit_graph': 'edit_graph',
  'm2_graph_review': 'm2_review', // V6 dual-draft M2 review (CEE_MODEL_M2_REVIEW)
};

const CONFIG_KEY_TO_MODEL_ENV_KEY: Partial<
  Record<keyof typeof config.cee.models, string>
> = {
  draft: 'config.cee.models.draft',
  options: 'CEE_MODEL_OPTIONS',
  repair: 'CEE_MODEL_REPAIR',
  clarification: 'CEE_MODEL_CLARIFICATION',
  critique: 'CEE_MODEL_CRITIQUE',
  validation: 'CEE_MODEL_VALIDATION',
  decision_review: 'CEE_MODEL_DECISION_REVIEW',
  orchestrator: 'CEE_MODEL_ORCHESTRATOR',
  edit_graph: 'CEE_MODEL_EDIT_GRAPH',
  m2_review: 'CEE_MODEL_M2_REVIEW',
};

function getTaskModelSourceKey(
  configKey: keyof typeof config.cee.models | undefined,
): string | undefined {
  if (!configKey) return undefined;
  return CONFIG_KEY_TO_MODEL_ENV_KEY[configKey] ?? `config.cee.models.${configKey}`;
}

/**
 * Router tasks that route a CEE_MODEL_* override (they appear in
 * TASK_TO_CONFIG_KEY) but intentionally carry NO entry in TASK_MODEL_DEFAULTS.
 * These are NOT first-class CeeTasks — isValidCeeTask() is false for them — so
 * the router never applies a code default; with the env var unset they fall
 * through to canonical handling / the global LLM_MODEL.
 *
 *   - 'validate': the ALIAS of 'validate_graph'. ⚠ CORRECTED 2026-07-30 (ROADMAP
 *     2.146): the sibling 'validate_graph' USED to be listed here on the grounds
 *     that "the Pass-2 validation pipeline is inert on staging
 *     (CEE_VALIDATION_PIPELINE_ENABLED=false), so no live call reaches them".
 *     That premise is being retired — 2.146 flips the pipeline on, at which point
 *     an unset CEE_MODEL_VALIDATION would have handed the "independent reviewer"
 *     role to whatever the global LLM_MODEL happens to be. 'validate_graph' now
 *     has a checked-in default (o4-mini) in TASK_MODEL_DEFAULTS.
 *     'validate' stays here because it has NO CALLERS — `getAdapter('validate')`
 *     appears nowhere in src/ (scope: rg "getAdapter\(['\"]validate" over src/,
 *     one hit, and it is 'validate_graph'). Giving a callerless alias a default
 *     would be decoration; declaring it env-only is the honest record.
 *
 * `clarify_brief` is intentionally represented in AI_TASK_LIFECYCLE as the
 * executable route while the historical `clarification` default remains a
 * display/compatibility name. Until that compatibility model row is retired,
 * clarify_brief remains explicit env-or-global fallback rather than silently
 * pretending the display row governs it.
 *
 * This list is the ONE hand-maintained exception to "every router task has a
 * default". The drift tripwire asserts it stays EXACT (disjoint from the
 * defaults map, every entry still present in TASK_TO_CONFIG_KEY) so it fails
 * loud if it drifts — it never silently absorbs a new task.
 */
export const ROUTER_ENV_ONLY_TASKS: readonly string[] = [
  'validate',
  'clarify_brief',
];

/**
 * Get the model for a given task from CEE config.
 * Returns undefined if task is not mapped or config doesn't specify a model.
 * Safely handles config validation failures (e.g., in test environments).
 */
function getModelFromConfig(task?: string): string | undefined {
  if (!task) return undefined;

  const configKey = TASK_TO_CONFIG_KEY[task];
  if (!configKey) return undefined;

  try {
    const model = config.cee.models[configKey];
    return model || undefined;
  } catch {
    // Config validation failed (e.g., invalid BASE_URL in test environment)
    // Fall back to default model selection
    return undefined;
  }
}

/**
 * Get the max tokens for a given task from CEE config.
 * Safely handles config validation failures (e.g., in test environments).
 */
export function getMaxTokensFromConfig(task?: string): number | undefined {
  if (!task) return undefined;

  const configKey = TASK_TO_CONFIG_KEY[task];
  if (!configKey) return undefined;

  try {
    return config.cee.maxTokens[configKey];
  } catch {
    // Config validation failed (e.g., invalid BASE_URL in test environment)
    // Fall back to default token limits
    return undefined;
  }
}

// Default configuration (OpenAI for cost-effectiveness)
const DEFAULT_PROVIDER: 'anthropic' | 'openai' | 'fixtures' = 'openai';
const DEFAULT_MODEL = 'auto'; // Let each adapter choose its default

export const PROVIDER_DEFAULT_MODELS = Object.freeze({
  openai: 'gpt-4o-mini',
  anthropic: FALLBACK_ANTHROPIC_MODEL,
  fixtures: 'fixture-v1',
} as const);

function resolveProviderModel(
  provider: 'anthropic' | 'openai' | 'fixtures',
  model?: string,
) {
  if (!(provider in PROVIDER_DEFAULT_MODELS)) {
    throw new Error(`Unknown provider: ${String(provider)}`);
  }
  const assignment = resolveModelAssignment(
    model ?? PROVIDER_DEFAULT_MODELS[provider],
    { fixtures: provider === 'fixtures' },
  );
  if (provider !== 'fixtures' && assignment.provider !== provider) {
    log.info(
      {
        configured_provider: provider,
        resolved_provider: assignment.provider,
        model: assignment.model,
      },
      'Provider follows validated model assignment',
    );
  }
  return assignment;
}

// Optional config file path (from centralized config or default)
// Deferred to function to avoid triggering config validation at module load time
function getConfigPath(): string {
  return config.llm.providersConfigPath || join(process.cwd(), 'config', 'providers.json');
}

/**
 * Load provider configuration from file if it exists (sync - fallback only)
 */
function loadConfigSync(): ProviderConfig | null {
  const configPath = getConfigPath();
  try {
    if (existsSync(configPath)) {
      const content = readFileSync(configPath, 'utf-8');
      const providersCfg = JSON.parse(content) as ProviderConfig;
      log.info({ config_path: configPath }, "Loaded provider configuration (sync)");
      return providersCfg;
    }
  } catch (error) {
    log.warn({ error, config_path: configPath }, "Failed to load provider config, using env/defaults");
  }
  return null;
}

/**
 * Load provider configuration from file asynchronously (preferred at startup)
 */
async function loadConfigAsync(): Promise<ProviderConfig | null> {
  const configPath = getConfigPath();
  try {
    await access(configPath, fsConstants.R_OK);
    const content = await readFile(configPath, 'utf-8');
    const providersCfg = JSON.parse(content) as ProviderConfig;
    log.info({ config_path: configPath }, "Loaded provider configuration (async)");
    return providersCfg;
  } catch (error) {
    // File doesn't exist or not readable - this is normal
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.warn({ error, config_path: configPath }, "Failed to load provider config, using env/defaults");
    }
  }
  return null;
}

// Lazy-load config on first use
let configCache: ProviderConfig | null | undefined;

/**
 * Simple LRU Map with bounded size and eviction.
 * Uses Map's insertion-order property for LRU tracking.
 */
class LRUMap<K, V> {
  private map = new Map<K, V>();
  private readonly maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.map.delete(key);
      this.map.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    // If key exists, delete it first to update position
    if (this.map.has(key)) {
      this.map.delete(key);
    }
    // Evict oldest entry if at capacity
    if (this.map.size >= this.maxSize) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) {
        this.map.delete(oldestKey);
        log.debug({ evicted_key: oldestKey, cache_size: this.maxSize }, "LRU eviction: adapter cache at capacity");
      }
    }
    this.map.set(key, value);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}

// Maximum number of cached adapters (prevents unbounded memory growth)
const ADAPTER_CACHE_MAX_SIZE = 100;

// Cached wrapper instances (caching, failover) to preserve state across requests
const wrappedAdapters = new LRUMap<string, LLMAdapter>(ADAPTER_CACHE_MAX_SIZE);

function getConfig(): ProviderConfig | null {
  if (configCache === undefined) {
    // Fall back to sync load if cache not warmed at startup
    configCache = loadConfigSync();
  }
  return configCache;
}

/**
 * Warm the provider config cache asynchronously at startup.
 * Call this during server initialization to avoid sync file I/O on first request.
 */
export async function warmProviderConfigCache(): Promise<{ loaded: boolean; path: string }> {
  const configPath = getConfigPath();
  if (configCache === undefined) {
    configCache = await loadConfigAsync();
  }
  return {
    loaded: configCache !== null,
    path: configPath,
  };
}

/**
 * Fixtures adapter for testing without API keys.
 * Returns minimal fixture graph for all operations.
 */
class FixturesAdapter implements LLMAdapter {
  readonly name = 'fixtures' as const;
  readonly model = 'fixture-v1';

  async draftGraph(args: DraftGraphArgs, _opts: CallOpts): Promise<DraftGraphResult> {
    // Import fixture dynamically to avoid circular deps
    const { fixtureGraph } = await import("../../utils/fixtures.js");

    const unsafeCaptureEnabled = Boolean(args.includeDebug === true && args.flags?.unsafe_capture === true);
    const rawNodeKinds = Array.isArray(fixtureGraph?.nodes)
      ? fixtureGraph.nodes
        .map((n) => n?.kind ?? 'unknown')
        .filter(Boolean)
      : [];

    return {
      graph: fixtureGraph,
      rationales: [],
      debug: unsafeCaptureEnabled ? {
        raw_llm_output: { _fixture: true, graph: fixtureGraph },
        raw_llm_output_truncated: false,
      } : undefined,
      meta: {
        model: this.model,
        prompt_version: 'fixture:draft_graph',
        temperature: 0,
        token_usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
        },
        finish_reason: 'fixture',
        provider_latency_ms: 0,
        node_kinds_raw_json: rawNodeKinds,
        ...(unsafeCaptureEnabled ? {
          raw_output_preview: '{"_fixture":true}',
          raw_llm_text: '{"_fixture":true}',
          raw_llm_json: { _fixture: true, graph: fixtureGraph },
        } : {}),
      },
      usage: {
        input_tokens: 0,
        output_tokens: 0,
      },
    };
  }

  async suggestOptions(_args: SuggestOptionsArgs, _opts: CallOpts): Promise<SuggestOptionsResult> {
    return {
      options: [
        {
          id: "opt_a",
          title: "Fixture Option A",
          pros: ["Fast", "Reliable"],
          cons: ["Not real", "Generic"],
          evidence_to_gather: ["User feedback", "Metrics"],
        },
        {
          id: "opt_b",
          title: "Fixture Option B",
          pros: ["Alternative", "Predictable"],
          cons: ["Not tailored", "Static"],
          evidence_to_gather: ["A/B test", "Analytics"],
        },
        {
          id: "opt_c",
          title: "Fixture Option C",
          pros: ["Comprehensive", "Well-tested"],
          cons: ["Placeholder", "Not customized"],
          evidence_to_gather: ["Benchmarks", "Case studies"],
        },
      ],
      usage: {
        input_tokens: 0,
        output_tokens: 0,
      },
    };
  }
  async clarifyBrief(args: ClarifyBriefArgs, _opts: CallOpts): Promise<ClarifyBriefResult> {
    return {
      questions: [
        {
          question: "What is the primary goal of this decision?",
          choices: ["Revenue growth", "Cost reduction", "Risk mitigation", "Strategic positioning"],
          why_we_ask: "Helps prioritize decision criteria",
          impacts_draft: "Shapes the goal node and outcome weights",
        },
      ],
      confidence: 0.7,
      should_continue: false,
      round: args.round,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
      },
    };
  }

  async critiqueGraph(_args: CritiqueGraphArgs, _opts: CallOpts): Promise<CritiqueGraphResult> {
    return {
      issues: [
        {
          level: "OBSERVATION",
          note: "Fixture critique - no actual analysis performed",
        },
      ],
      suggested_fixes: [],
      overall_quality: "fair",
      usage: {
        input_tokens: 0,
        output_tokens: 0,
      },
    };
  }

  async explainDiff(args: ExplainDiffArgs, _opts: CallOpts): Promise<ExplainDiffResult> {
    const rationales: Array<{ target: string; why: string; provenance_source?: string }> = [];

    // Generate rationales for added nodes
    if (args.patch.adds?.nodes) {
      for (const node of args.patch.adds.nodes) {
        const target = node.id || 'unknown_node';
        rationales.push({
          target,
          why: `Added ${node.kind || 'node'} to represent ${node.label || 'a decision element'}`,
          provenance_source: args.brief ? 'user_brief' : undefined,
        });
      }
    }

    // Generate rationales for added edges
    if (args.patch.adds?.edges) {
      for (const edge of args.patch.adds.edges) {
        const target = edge.id || `${edge.from}::${edge.to}`;
        rationales.push({
          target,
          why: `Connected ${edge.from} to ${edge.to} to show the relationship`,
          provenance_source: args.brief ? 'user_brief' : undefined,
        });
      }
    }

    // Sort rationales deterministically by target
    rationales.sort((a, b) => a.target.localeCompare(b.target));

    return {
      rationales,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
      },
    };
  }

  async chat(_args: ChatArgs, _opts: CallOpts): Promise<ChatResult> {
    // M2 Decision Review mock response - matches OUTPUT_SCHEMA from decision_review prompt
    // See src/prompts/defaults.ts lines 1097-1141 for the authoritative schema
    const mockContent = JSON.stringify({
      narrative_summary:
        "Option A leads with a 65% win probability, driven by strong market timing alignment. This is a close call with Option B trailing by 12 points. Evidence gaps in customer adoption rates warrant caution before final commitment.",
      story_headlines: {
        opt_a: "First-mover advantage drives projected success",
        opt_b: "Strong fundamentals but timing uncertainty remains",
      },
      robustness_explanation: {
        summary: "The recommendation shows moderate stability with one key sensitivity",
        primary_risk: "Market timing factor has high elasticity (0.45)",
        stability_factors: ["Strong team alignment", "Clear market demand signals"],
        fragility_factors: ["Timing assumptions", "Competitor response uncertainty"],
      },
      readiness_rationale:
        "This is a close call requiring careful attention to timing assumptions before proceeding.",
      // M2 spec: evidence_enhancements.<factor_id> = { specific_action, rationale, evidence_type, decision_hygiene, effort? }
      evidence_enhancements: {
        node_timing: {
          specific_action: "Commission market timing analysis from independent research firm",
          rationale: "Current timing estimates have high uncertainty that affects the recommendation",
          evidence_type: "market_research",
          decision_hygiene: "Gather disconfirming evidence before committing",
        },
      },
      // M2 spec: scenario_contexts.<edge_id> = { trigger_description, consequence }
      scenario_contexts: {
        edge_timing_revenue: {
          trigger_description: "If market timing shifts unfavorably",
          consequence: "Option B becomes viable due to its defensive positioning",
        },
      },
      // M2 spec: bias_findings[] = { type, source, description, affected_elements, suggested_action, linked_critique_code?, brief_evidence? }
      bias_findings: [
        {
          type: "DOMINANT_FACTOR",
          source: "structural",
          description: "Heavy weight on supporting evidence for Option A",
          affected_elements: ["node_timing"],
          suggested_action: "Seek disconfirming evidence actively",
          linked_critique_code: "DOMINANT_FACTOR",
        },
      ],
      // M2 spec: key_assumptions is array of STRINGS (max 5, mix model + psychological)
      key_assumptions: [
        "Market conditions remain stable through implementation period",
        "Team capacity assumptions are accurate",
        "Competitor response will be within expected range",
      ],
      // M2 spec: decision_quality_prompts[] = { question, principle, applies_because }
      decision_quality_prompts: [
        {
          question: "Have you considered what would make Option B the better choice?",
          principle: "Pre-mortem analysis",
          applies_because: "Close-call decisions benefit from imagining failure scenarios",
        },
      ],
      // M2 spec: pre_mortem = { failure_scenario, warning_signs, mitigation, grounded_in, review_trigger? }
      pre_mortem: {
        failure_scenario: "Six months from now, if this decision fails, it will be because market timing assumptions were overly optimistic",
        warning_signs: ["Declining early adoption metrics", "Competitor announcements"],
        mitigation: "Establish monthly review cadence with kill criteria",
        review_trigger: "Two consecutive months of below-target adoption",
        grounded_in: ["edge_timing_revenue", "node_timing"],
      },
    });

    return {
      content: mockContent,
      model: this.model,
      latencyMs: 0,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
      },
    };
  }
}

// Adapter instances cache (LRU with bounded size)
const adapters = new LRUMap<string, LLMAdapter>(ADAPTER_CACHE_MAX_SIZE);

/**
 * Get or create an adapter instance for the given provider and model.
 */
function getAdapterInstance(provider: 'anthropic' | 'openai' | 'fixtures', model?: string): LLMAdapter {
  const cacheKey = `${provider}:${model || 'default'}`;

  if (adapters.has(cacheKey)) {
    return adapters.get(cacheKey)!;
  }

  let adapter: LLMAdapter;

  switch (provider) {
    case 'anthropic':
      adapter = new AnthropicAdapter(model);
      break;
    case 'openai':
      adapter = new OpenAIAdapter(model);
      break;
    case 'fixtures':
      adapter = new FixturesAdapter();
      break;
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }

  adapters.set(cacheKey, adapter);
  log.info(
    { provider: adapter.name, model: adapter.model, cache_key: cacheKey },
    "Created LLM adapter instance"
  );

  return adapter;
}

function logFailoverAttempt(outcome: RouterResolutionOutcome): void {
  const attempt = outcome.failoverAttempt;
  if (!attempt) return;

  for (const rejection of attempt.rejectedProviders) {
    log.warn(
      {
        provider: rejection.provider,
        task: outcome.task,
        error: rejection.error,
      },
      "Failover provider is invalid or lacks the task capability; skipping",
    );
  }

  if (attempt.requestedProviders.length < 2) {
    log.warn(
      { LLM_FAILOVER_PROVIDERS: attempt.requestedProviders.join(',') },
      "LLM_FAILOVER_PROVIDERS must specify at least 2 providers, ignoring",
    );
  } else if (!attempt.active) {
    log.warn(
      {
        valid_adapters: attempt.acceptedAssignments.length,
        task: outcome.task,
      },
      "Not enough task-capable adapters for failover, disabling",
    );
  }
}

function createFailoverAdapter(
  task: string | undefined,
  assignments: readonly ResolvedModelAssignment[],
): LLMAdapter {
  const adapterList = assignments.map((assignment) =>
    getAdapterInstance(assignment.provider, assignment.model),
  );
  log.info(
    { providers: adapterList.map((adapter) => adapter.name), task },
    "Failover enabled - will try providers in sequence",
  );
  return new FailoverAdapter(adapterList, task || "unknown");
}

/**
 * Get the appropriate LLM adapter for a given task.
 *
 * Selection precedence:
 * 1. Failover configuration (LLM_FAILOVER_PROVIDERS) - outer availability policy
 * 2. Request-time model override (from client API body parameter)
 * 3. CEE_MODEL_* environment variables
 * 4. TASK_MODEL_DEFAULTS code defaults
 * 5. Task-specific/default model from providers config
 * 6. LLM_PROVIDER / LLM_MODEL global env vars
 * 7. Adapter default (gpt-4o-mini)
 *
 * @param task - Optional task name for task-specific routing (e.g., "draft_graph", "suggest_options")
 * @param modelOverride - Optional model override from client request body
 * @returns LLMAdapter instance (may be FailoverAdapter wrapping multiple adapters)
 *
 * @example
 * ```typescript
 * // Default model selection based on task
 * const adapter = getAdapter('draft_graph');
 *
 * // With client-specified model override
 * const adapter = getAdapter('draft_graph', 'gpt-4o');
 * ```
 */
export function getAdapter(task?: string, modelOverride?: string): LLMAdapter {
  return getAdapterWithResolution(task, modelOverride).adapter;
}

/**
 * Resolution source per the brief's precedence enum. See precedence block
 * in src/config/model-routing.ts for the canonical chain.
 *
 * - per_call / store_model_config: discriminated by `origin` argument.
 *   The router cannot tell these apart on its own.
 * - env_var: CEE_MODEL_* via config.cee.models.*
 * - task_default: TASK_MODEL_DEFAULTS fallback
 * - providers_json: providers.json overrides or defaults
 * - llm_model_fallback: LLM_PROVIDER/LLM_MODEL env vars, adapter default,
 *   or failover (failover controls its own model internally).
 */
export type ResolutionSource = RouterResolutionSource;

export interface ModelResolution {
  readonly task?: string;
  readonly resolved_model: string;
  readonly resolution_source: ResolutionSource;
  readonly modelOverride?: string;
  /**
   * Provider that will actually serve the request (anthropic / openai /
   * fixtures). Group 3 follow-up — surfaces on model_resolutions telemetry
   * so operators can confirm the right provider was selected end-to-end,
   * not just the right model string.
   */
  readonly provider?: 'anthropic' | 'openai' | 'fixtures';
  /** Checked-in configuration availability, never a remote API claim. */
  readonly availability?: ModelAssignmentAvailability;
  readonly registry_model_id?: string | null;
}

export interface AdapterWithResolution {
  readonly adapter: LLMAdapter;
  readonly resolution: ModelResolution;
}

/**
 * Resolve the router's exact configured plan without constructing an adapter.
 * Runtime execution and `/admin/models/routing` both consume this boundary.
 */
export function resolveConfiguredRouterPlan(
  task?: string,
  modelOverride?: string,
  origin?: 'per_call' | 'store_model_config',
): RouterResolutionOutcome {
  const taskConfigKey = task ? TASK_TO_CONFIG_KEY[task] : undefined;
  const configuredTaskModel = getModelFromConfig(task);
  const taskDefault =
    task && isValidCeeTask(task) ? getDefaultModelForTask(task) : undefined;

  return resolveRouterResolution({
    task,
    modelOverride,
    origin,
    failoverProviders: config.llm.failoverProviders,
    providersConfig: getConfig(),
    configuredProvider: config.llm.provider || DEFAULT_PROVIDER,
    globalModel: config.llm.model || DEFAULT_MODEL,
    configuredTaskModel,
    configuredTaskModelSourceKey: getTaskModelSourceKey(taskConfigKey),
    taskDefault,
    taskDefaultSourceKey: task ? `TASK_MODEL_DEFAULTS.${task}` : undefined,
    providerDefaultModels: PROVIDER_DEFAULT_MODELS,
    clientBlockedModels: getClientBlockedModels(),
  });
}

/**
 * Get an adapter along with metadata describing which precedence step
 * delivered the model. Prefer this over getAdapter at any site where the
 * caller has request/turn context and can log or record the resolution.
 *
 * `origin` lets the caller annotate the semantic source of `modelOverride`.
 * Pass 'store_model_config' when the override came from prompt-store
 * model_config.{staging,production}; otherwise leave unset or pass
 * 'per_call' (the default for client-body overrides).
 */
export function getAdapterWithResolution(
  task?: string,
  modelOverride?: string,
  origin?: 'per_call' | 'store_model_config',
): AdapterWithResolution {
  const outcome = resolveConfiguredRouterPlan(task, modelOverride, origin);
  if (outcome.kind === 'configuration_error') {
    logFailoverAttempt(outcome);
    throw outcome.error;
  }

  if (outcome.kind === 'failover') {
    if (modelOverride) {
      log.warn(
        { task, model_override: modelOverride, reason: 'failover_configured' },
        "Model override ignored: failover configuration takes precedence",
      );
    }

    const failoverCacheKey = `failover:${task || "default"}`;
    if (!wrappedAdapters.has(failoverCacheKey)) {
      logFailoverAttempt(outcome);
      const failoverAdapter = createFailoverAdapter(task, outcome.assignments);
      wrappedAdapters.set(
        failoverCacheKey,
        withUsageTracking(withCaching(failoverAdapter)),
      );
    }
    const adapter = wrappedAdapters.get(failoverCacheKey)!;
    const primary = outcome.assignments[0]!;
    return {
      adapter,
      resolution: {
        task,
        resolved_model: primary.model,
        resolution_source: outcome.resolutionSource,
        modelOverride,
        provider: primary.provider,
        availability: primary.availability,
        registry_model_id: primary.registryModelId,
      },
    };
  }

  logFailoverAttempt(outcome);
  const assignment = outcome.assignment;
  const cacheKey = `single:${assignment.provider}:${assignment.model}`;
  if (!wrappedAdapters.has(cacheKey)) {
    const adapter = getAdapterInstance(assignment.provider, assignment.model);
    wrappedAdapters.set(cacheKey, withUsageTracking(withCaching(adapter)));
  }
  const adapter = wrappedAdapters.get(cacheKey)!;
  return {
    adapter,
    resolution: {
      task,
      resolved_model: assignment.model,
      resolution_source: outcome.resolutionSource,
      modelOverride,
      provider: assignment.provider,
      availability: assignment.availability,
      registry_model_id: assignment.registryModelId,
    },
  };
}

/**
 * Get adapter for a specific provider (useful for testing).
 */
export function getAdapterForProvider(
  provider: 'anthropic' | 'openai' | 'fixtures',
  model?: string
): LLMAdapter {
  const assignment = resolveProviderModel(provider, model);
  return getAdapterInstance(assignment.provider, assignment.model);
}

/**
 * Reset adapter cache (useful for testing).
 */
export function resetAdapterCache(): void {
  adapters.clear();
  wrappedAdapters.clear();
  configCache = undefined;
}
