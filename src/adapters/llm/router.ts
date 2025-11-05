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
import type { LLMAdapter } from "./types.js";
import { AnthropicAdapter } from "./anthropic.js";
import { OpenAIAdapter } from "./openai.js";

// Default configuration (OpenAI for cost-effectiveness)
const DEFAULT_PROVIDER: 'anthropic' | 'openai' | 'fixtures' = 'openai';
const DEFAULT_MODEL = 'auto'; // Let each adapter choose its default

// Optional config file path
const CONFIG_PATH = process.env.PROVIDERS_CONFIG_PATH || join(process.cwd(), 'config', 'providers.json');

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
  try {
    if (existsSync(CONFIG_PATH)) {
      const content = readFileSync(CONFIG_PATH, 'utf-8');
      const config = JSON.parse(content) as ProviderConfig;
      log.info({ config_path: CONFIG_PATH }, "Loaded provider configuration");
      return config;
    }
  } catch (error) {
    log.warn({ error, config_path: CONFIG_PATH }, "Failed to load provider config, using env/defaults");
  }
  return null;
}

// Lazy-load config on first use
let configCache: ProviderConfig | null | undefined;

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
 * Get the appropriate LLM adapter for a given task.
 *
 * Selection precedence:
 * 1. Task-specific override from config file
 * 2. Environment variables (LLM_PROVIDER, LLM_MODEL)
 * 3. Hard-coded defaults
 *
 * @param task - Optional task name for task-specific routing (e.g., "draft_graph", "suggest_options")
 * @returns LLMAdapter instance
 *
 * @example
 * ```typescript
 * const adapter = getAdapter('draft_graph');
 * const result = await adapter.draftGraph(args, opts);
 * ```
 */
export function getAdapter(task?: string): LLMAdapter {
  const config = getConfig();

  // Read environment variables dynamically (not cached at module load time)
  const envProvider = (process.env.LLM_PROVIDER || DEFAULT_PROVIDER) as 'anthropic' | 'openai' | 'fixtures';
  const envModel = process.env.LLM_MODEL || DEFAULT_MODEL;

  let selectedProvider: 'anthropic' | 'openai' | 'fixtures' = envProvider;
  let selectedModel: string | undefined = envModel === 'auto' ? undefined : envModel;

  // Check for task-specific override in config
  if (config && task && config.overrides?.[task]) {
    const override = config.overrides[task];
    selectedProvider = override.provider;
    if (override.model) {
      selectedModel = override.model;
    }
    log.info(
      { task, provider: selectedProvider, model: selectedModel, source: 'config_override' },
      "Using task-specific provider override"
    );
  }
  // Check for config defaults
  else if (config?.defaults) {
    selectedProvider = config.defaults.provider;
    if (config.defaults.model) {
      selectedModel = config.defaults.model;
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

  return getAdapterInstance(selectedProvider, selectedModel);
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
  configCache = undefined;
}
