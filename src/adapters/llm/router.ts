/**
 * Provider router for multi-provider LLM orchestration.
 *
 * Selects LLM adapter (Anthropic, OpenAI, Fixtures) based on:
 * 1. LLM_FAILOVER_PROVIDERS → FailoverAdapter (if configured)
 * 2. providers.json overrides → task-specific provider
 * 3. CEE_MODEL_* env vars → explicit operator override (e.g., CEE_MODEL_DRAFT)
 * 4. TASK_MODEL_DEFAULTS → code defaults (e.g., draft_graph → gpt-5.2)
 * 5. LLM_PROVIDER / LLM_MODEL → global defaults
 * 6. Adapter default → gpt-4o-mini
 *
 * Precedence: failover → providers.json → CEE_MODEL_* → TASK_MODEL_DEFAULTS → env → default
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
  RepairGraphArgs,
  RepairGraphResult,
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
import { isValidCeeTask, getDefaultModelForTask } from "../../config/model-routing.js";
import { getModelProvider, isModelClientAllowed, getModelBlockReason } from "../../config/models.js";

/**
 * Map task names to CEE model config keys.
 * Used to look up per-operation model from config.cee.models.*
 */
const TASK_TO_CONFIG_KEY: Record<string, keyof typeof config.cee.models> = {
  'draft_graph': 'draft',
  'suggest_options': 'options',
  'repair_graph': 'repair',
  'clarify_brief': 'clarification',
  'critique_graph': 'critique',
  'validate': 'validation',
};

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

// Optional config file path (from centralized config or default)
// Deferred to function to avoid triggering config validation at module load time
function getConfigPath(): string {
  return config.llm.providersConfigPath || join(process.cwd(), 'config', 'providers.json');
}

/**
 * Provider configuration schema
 */
interface ProviderConfig {
  defaults?: {
    provider: 'anthropic' | 'openai' | 'fixtures';
    model?: string;
  };
  overrides?: Record<string, {
    provider: 'anthropic' | 'openai' | 'fixtures';
    model?: string;
  }>;
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

  async repairGraph(args: RepairGraphArgs, _opts: CallOpts): Promise<RepairGraphResult> {
    // For fixtures, just return the input graph unchanged
    return {
      graph: args.graph,
      rationales: [{ target: "graph", why: "Fixture repair - no actual changes" }],
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
        option_a: "First-mover advantage drives projected success",
        option_b: "Strong fundamentals but timing uncertainty remains",
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
        factor_timing: {
          specific_action: "Commission market timing analysis from independent research firm",
          rationale: "Current timing estimates have high uncertainty that affects the recommendation",
          evidence_type: "market_research",
          decision_hygiene: "Gather disconfirming evidence before committing",
        },
      },
      // M2 spec: scenario_contexts.<edge_id> = { trigger_description, consequence }
      scenario_contexts: {
        e3: {
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
          affected_elements: ["factor_timing"],
          suggested_action: "Seek disconfirming evidence actively",
          linked_critique_code: "OVER_RELIANCE",
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
        grounded_in: ["e3", "factor_timing"],
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

/**
 * Create a failover-enabled adapter from environment configuration
 *
 * Reads LLM_FAILOVER_PROVIDERS env var (comma-separated list, e.g., "anthropic,openai,fixtures")
 * Returns FailoverAdapter that tries providers in sequence, or null if not configured
 */
function createFailoverAdapter(task?: string): LLMAdapter | null {
  const failoverProviders = config.llm.failoverProviders;

  if (!failoverProviders || failoverProviders.length === 0) {
    return null;
  }

  // failoverProviders is already parsed as array by config
  const providerNames = failoverProviders;

  if (providerNames.length < 2) {
    log.warn(
      { LLM_FAILOVER_PROVIDERS: providerNames.join(',') },
      "LLM_FAILOVER_PROVIDERS must specify at least 2 providers, ignoring"
    );
    return null;
  }

  // Create adapter for each provider
  const adapterList: LLMAdapter[] = [];
  for (const providerName of providerNames) {
    try {
      const provider = providerName as 'anthropic' | 'openai' | 'fixtures';
      const adapter = getAdapterInstance(provider);
      adapterList.push(adapter);
    } catch (error) {
      log.warn(
        { provider: providerName, error },
        "Failed to create adapter for failover provider, skipping"
      );
    }
  }

  if (adapterList.length < 2) {
    log.warn(
      { valid_adapters: adapterList.length },
      "Not enough valid adapters for failover, disabling"
    );
    return null;
  }

  log.info(
    { providers: adapterList.map(a => a.name), task },
    "Failover enabled - will try providers in sequence"
  );

  return new FailoverAdapter(adapterList, task || "unknown");
}

/**
 * Get the appropriate LLM adapter for a given task.
 *
 * Selection precedence:
 * 1. Request-time model override (from client API body parameter) - highest priority
 * 2. Failover configuration (LLM_FAILOVER_PROVIDERS) - wraps multiple providers
 * 3. Task-specific override from config file
 * 4. CEE_MODEL_* environment variables
 * 5. TASK_MODEL_DEFAULTS code defaults
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
  // Check for cached failover adapter first (before creating new objects)
  const failoverCacheKey = `failover:${task || "default"}`;
  if (wrappedAdapters.has(failoverCacheKey)) {
    // Model override is not supported with failover configuration
    if (modelOverride) {
      log.warn(
        { task, model_override: modelOverride, reason: 'failover_configured' },
        "Model override ignored: failover configuration takes precedence"
      );
    }
    return wrappedAdapters.get(failoverCacheKey)!;
  }

  // Check for failover configuration (only if not cached)
  const failoverAdapter = createFailoverAdapter(task);
  if (failoverAdapter) {
    // Model override is not supported with failover configuration
    // (failover involves multiple providers with pre-configured models)
    if (modelOverride) {
      log.warn(
        { task, model_override: modelOverride, reason: 'failover_configured' },
        "Model override ignored: failover configuration takes precedence"
      );
    }
    // Cache the wrapped failover adapter
    wrappedAdapters.set(failoverCacheKey, withCaching(failoverAdapter));
    return wrappedAdapters.get(failoverCacheKey)!;
  }
  const providersConfig = getConfig();

  // Read from centralized config (handles environment variables)
  const envProvider = config.llm.provider || DEFAULT_PROVIDER;
  const envModel = config.llm.model || DEFAULT_MODEL;

  let selectedProvider: 'anthropic' | 'openai' | 'fixtures' = envProvider;
  let selectedModel: string | undefined = envModel === 'auto' ? undefined : envModel;

  // Check for task-specific override in config file (providers.json)
  if (providersConfig && task && providersConfig.overrides?.[task]) {
    const override = providersConfig.overrides[task];
    selectedProvider = override.provider;
    if (override.model) {
      selectedModel = override.model;
    }
    log.info(
      { task, provider: selectedProvider, model: selectedModel, source: 'config_override' },
      "Using task-specific provider override"
    );
  }
  // Check for config file defaults
  else if (providersConfig?.defaults) {
    selectedProvider = providersConfig.defaults.provider;
    if (providersConfig.defaults.model) {
      selectedModel = providersConfig.defaults.model;
    }
    log.info(
      { provider: selectedProvider, model: selectedModel, source: 'config_default' },
      "Using provider from config defaults"
    );
  }
  // Use environment variables (already set above)
  else {
    log.info(
      { provider: selectedProvider, model: selectedModel, source: 'environment' },
      "Using provider from environment"
    );
  }

  // Request-time model override takes highest priority (after failover)
  // This is used when client specifies model in request body
  if (modelOverride) {
    // Validate model override against blocklist
    // Note: Route handlers should also validate before calling getAdapter, but this
    // provides a defensive fallback if an invalid model slips through
    const blockedModels = getClientBlockedModels();
    if (!isModelClientAllowed(modelOverride, blockedModels)) {
      const reason = getModelBlockReason(modelOverride, blockedModels);
      log.warn(
        { task, model_override: modelOverride, reason, source: 'request_body' },
        "Model override rejected - falling back to default model selection"
      );
      // Fall through to default model selection instead of using invalid override
    } else {
      // Determine the correct provider for the model
      // This ensures we don't create an OpenAI adapter with an Anthropic model (or vice versa)
      const modelProvider = getModelProvider(modelOverride);
      if (modelProvider && modelProvider !== selectedProvider) {
        log.info(
          { task, model_override: modelOverride, previous_provider: selectedProvider, new_provider: modelProvider, source: 'request_body' },
          "Switching provider to match model override"
        );
        selectedProvider = modelProvider;
      }
      log.info(
        { task, model_override: modelOverride, previous_model: selectedModel, provider: selectedProvider, source: 'request_body' },
        "Using request-time model override from client"
      );
      selectedModel = modelOverride;
    }
  }

  // If no valid model override, use CEE tiered model selection
  if (!modelOverride || selectedModel !== modelOverride) {
    // CEE tiered model selection: override model based on task if configured
    // Priority: CEE_MODEL_* env var > TASK_MODEL_DEFAULTS > LLM_MODEL
    const ceeModel = getModelFromConfig(task);
    if (ceeModel && selectedModel !== ceeModel) {
      log.info(
        { task, previous_model: selectedModel, cee_model: ceeModel, source: 'cee_env_override' },
        "Using CEE task-specific model from environment"
      );
      selectedModel = ceeModel;
    } else if (!ceeModel && task && isValidCeeTask(task)) {
      // No env override - use TASK_MODEL_DEFAULTS
      const taskDefault = getDefaultModelForTask(task);
      const taskDefaultProvider = getModelProvider(taskDefault);
      // Only use task default if its provider matches configured provider
      // This ensures LLM_PROVIDER=anthropic doesn't try to use OpenAI models
      if (taskDefault && selectedModel !== taskDefault &&
          (selectedProvider === 'fixtures' || !taskDefaultProvider || taskDefaultProvider === selectedProvider)) {
        log.info(
          { task, previous_model: selectedModel, task_default: taskDefault, source: 'task_default' },
          "Using task default model from TASK_MODEL_DEFAULTS"
        );
        selectedModel = taskDefault;
      } else if (taskDefault && taskDefaultProvider !== selectedProvider) {
        log.info(
          { task, task_default: taskDefault, task_default_provider: taskDefaultProvider, configured_provider: selectedProvider, source: 'provider_mismatch' },
          "Skipping task default - provider mismatch with LLM_PROVIDER"
        );
      }
    }

    // After any model selection (CEE env or task default), ensure provider matches model
    // This prevents "model does not exist" errors from using wrong provider for model
    // Skip for fixtures provider (testing) - fixtures handles any model name
    if (selectedModel && selectedProvider !== 'fixtures') {
      const modelProvider = getModelProvider(selectedModel);
      if (modelProvider && modelProvider !== selectedProvider) {
        log.info(
          { task, model: selectedModel, previous_provider: selectedProvider, new_provider: modelProvider, source: 'provider_switch' },
          "Switching provider to match selected model"
        );
        selectedProvider = modelProvider;
      }
    }
  }

  // Reuse cached wrapper to preserve cache state across requests
  const cacheKey = `single:${selectedProvider}:${selectedModel || "default"}`;
  if (!wrappedAdapters.has(cacheKey)) {
    const adapter = getAdapterInstance(selectedProvider, selectedModel);
    wrappedAdapters.set(cacheKey, withCaching(adapter));
  }
  return wrappedAdapters.get(cacheKey)!;
}

/**
 * Get adapter for a specific provider (useful for testing).
 */
export function getAdapterForProvider(
  provider: 'anthropic' | 'openai' | 'fixtures',
  model?: string
): LLMAdapter {
  return getAdapterInstance(provider, model);
}

/**
 * Reset adapter cache (useful for testing).
 */
export function resetAdapterCache(): void {
  adapters.clear();
  wrappedAdapters.clear();
  configCache = undefined;
}

