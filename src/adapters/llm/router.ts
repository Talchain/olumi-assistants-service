/**
 * Provider router for multi-provider LLM orchestration.
 *
 * Selects LLM adapter (Anthropic, OpenAI, Fixtures) based on:
 * 1. Task-specific overrides (config/providers.json)
 * 2. Environment variables (LLM_PROVIDER, LLM_MODEL)
 * 3. Hard-coded defaults
 *
 * Precedence: task override → env → default
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { log } from "../../utils/telemetry.js";
import { config } from "../../config/index.js";
import type { LLMAdapter } from "./types.js";
import { AnthropicAdapter } from "./anthropic.js";
import { OpenAIAdapter } from "./openai.js";
import { FailoverAdapter } from "./failover.js";
import { withCaching } from "./caching.js";

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
 * Load provider configuration from file if it exists
 */
function loadConfig(): ProviderConfig | null {
  const configPath = getConfigPath();
  try {
    if (existsSync(configPath)) {
      const content = readFileSync(configPath, 'utf-8');
      const providersCfg = JSON.parse(content) as ProviderConfig;
      log.info({ config_path: configPath }, "Loaded provider configuration");
      return providersCfg;
    }
  } catch (error) {
    log.warn({ error, config_path: configPath }, "Failed to load provider config, using env/defaults");
  }
  return null;
}

// Lazy-load config on first use
let configCache: ProviderConfig | null | undefined;

// Cached wrapper instances (caching, failover) to preserve state across requests
const wrappedAdapters = new Map<string, LLMAdapter>();

function getConfig(): ProviderConfig | null {
  if (configCache === undefined) {
    configCache = loadConfig();
  }
  return configCache;
}

/**
 * Fixtures adapter for testing without API keys.
 * Returns minimal fixture graph for all operations.
 */
class FixturesAdapter implements LLMAdapter {
  readonly name = 'fixtures' as const;
  readonly model = 'fixture-v1';

  async draftGraph(_args: any, _opts: any): Promise<any> {
    // Import fixture dynamically to avoid circular deps
    const { fixtureGraph } = await import("../../utils/fixtures.js");

    return {
      graph: fixtureGraph,
      rationales: [],
      usage: {
        input_tokens: 0,
        output_tokens: 0,
      },
    };
  }

  async suggestOptions(_args: any, _opts: any): Promise<any> {
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

  async repairGraph(args: any, _opts: any): Promise<any> {
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

  async clarifyBrief(args: any, _opts: any): Promise<any> {
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

  async critiqueGraph(_args: any, _opts: any): Promise<any> {
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

  async explainDiff(args: any, _opts: any): Promise<any> {
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
}

// Adapter instances cache
const adapters: Map<string, LLMAdapter> = new Map();

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
 * 1. Failover configuration (LLM_FAILOVER_PROVIDERS) - wraps multiple providers
 * 2. Task-specific override from config file
 * 3. Environment variables (LLM_PROVIDER, LLM_MODEL)
 * 4. Hard-coded defaults
 *
 * @param task - Optional task name for task-specific routing (e.g., "draft_graph", "suggest_options")
 * @returns LLMAdapter instance (may be FailoverAdapter wrapping multiple adapters)
 *
 * @example
 * ```typescript
 * const adapter = getAdapter('draft_graph');
 * const result = await adapter.draftGraph(args, opts);
 * ```
 */
export function getAdapter(task?: string): LLMAdapter {
  // Check for failover configuration first
  const failoverAdapter = createFailoverAdapter(task);
  if (failoverAdapter) {
    // Reuse cached failover wrapper to preserve cache state
    const cacheKey = `failover:${task || "default"}`;
    if (!wrappedAdapters.has(cacheKey)) {
      wrappedAdapters.set(cacheKey, withCaching(failoverAdapter));
    }
    return wrappedAdapters.get(cacheKey)!;
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

  // CEE tiered model selection: override model based on task if configured
  // This allows per-operation model selection (e.g., gpt-4o for draft, gpt-4o-mini for clarification)
  const ceeModel = getModelFromConfig(task);
  if (ceeModel && selectedModel !== ceeModel) {
    log.info(
      { task, previous_model: selectedModel, cee_model: ceeModel, source: 'cee_config' },
      "Using CEE task-specific model"
    );
    selectedModel = ceeModel;
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

// ============================================================================
// Tiered Model Selection Integration
// ============================================================================

import { config as appConfig } from "../../config/index.js";
import {
  selectModel,
  getModelResponseHeaders,
  type ModelSelectionResult,
  type ModelSelectionInput,
} from "../../services/model-selector.js";
import { isValidCeeTask, type CeeTask } from "../../config/model-routing.js";
import { getModelProvider } from "../../config/models.js";

/**
 * Extended adapter result with model selection metadata
 */
export interface AdapterWithSelection {
  adapter: LLMAdapter;
  selection: ModelSelectionResult;
  headers: Record<string, string>;
}

/**
 * Get adapter with intelligent model selection
 *
 * Uses the tiered model selector when enabled, falling back to
 * the legacy getAdapter() when disabled.
 *
 * @param task - CEE task being performed
 * @param override - Optional model override from X-CEE-Model-Override header
 * @param correlationId - Correlation ID for telemetry
 */
export function getAdapterWithSelection(
  task: string,
  override?: string,
  correlationId?: string
): AdapterWithSelection {
  // Check if model selection feature is enabled
  let modelSelectionEnabled = false;
  try {
    modelSelectionEnabled = appConfig.cee.modelSelection.enabled;
  } catch {
    // Config validation failed - use legacy
  }

  // If feature disabled or task is not a CEE task, use legacy adapter
  if (!modelSelectionEnabled || !isValidCeeTask(task)) {
    const adapter = getAdapter(task);
    return {
      adapter,
      selection: {
        modelId: adapter.model,
        provider: adapter.name as "openai" | "anthropic",
        tier: "quality", // Default assumption
        source: "legacy",
        warnings: [],
      },
      headers: {
        "X-CEE-Model-Used": adapter.model,
        "X-CEE-Model-Tier": "quality",
        "X-CEE-Model-Source": "legacy",
      },
    };
  }

  // Use model selector for intelligent selection
  const selectionInput: ModelSelectionInput = {
    task: task as CeeTask,
    override,
    correlationId,
  };

  const selection = selectModel(selectionInput);

  // Get the appropriate adapter for the selected model
  const provider = getModelProvider(selection.modelId);
  let adapter: LLMAdapter;

  if (provider) {
    adapter = getAdapterInstance(provider, selection.modelId);
  } else {
    // Fallback to OpenAI if provider not found
    adapter = getAdapterInstance("openai", selection.modelId);
  }

  // Wrap with caching
  const cacheKey = `selection:${selection.modelId}`;
  if (!wrappedAdapters.has(cacheKey)) {
    wrappedAdapters.set(cacheKey, withCaching(adapter));
  }

  return {
    adapter: wrappedAdapters.get(cacheKey)!,
    selection,
    headers: getModelResponseHeaders(selection),
  };
}

/**
 * Extract model override from request headers
 */
export function extractModelOverride(
  headers: Record<string, string | string[] | undefined>
): string | undefined {
  const override = headers["x-cee-model-override"];
  if (typeof override === "string") {
    return override.trim() || undefined;
  }
  if (Array.isArray(override) && override.length > 0) {
    return override[0].trim() || undefined;
  }
  return undefined;
}
