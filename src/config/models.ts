/**
 * Model Registry
 *
 * Central registry of supported LLM models with tier classification,
 * cost metrics, and availability status. Used by the model selector
 * to make intelligent routing decisions.
 */

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
  /** Cost per 1K tokens (for monitoring/alerting) */
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
  // OpenAI o3 Reasoning Family (Latest)
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
  "claude-3-5-haiku-20241022": {
    id: "claude-3-5-haiku-20241022",
    provider: "anthropic",
    tier: "fast",
    enabled: true,
    maxTokens: 8192,
    costPer1kTokens: 0.25,
    averageLatencyMs: 500,
    qualityScore: 0.78,
    description: "Claude 3.5 Haiku - fastest Anthropic model",
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
 * Check if a model is a reasoning model (requires reasoning_effort parameter)
 * Uses registry lookup - does NOT use string matching
 */
export function isReasoningModel(modelId: string): boolean {
  return MODEL_REGISTRY[modelId]?.reasoning === true;
}

/**
 * Check if a model supports extended thinking (Anthropic models)
 * Uses registry lookup - does NOT use string matching
 */
export function supportsExtendedThinking(modelId: string): boolean {
  return MODEL_REGISTRY[modelId]?.extendedThinking === true;
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
