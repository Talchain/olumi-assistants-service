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
  /** Whether this is a reasoning model (requires reasoning_effort parameter) */
  reasoning?: boolean;
}

/**
 * Model Registry
 *
 * Defines all supported models with their characteristics.
 * Models can be enabled/disabled via environment variables.
 *
 * MAINTENANCE NOTE:
 * The costPer1kTokens values should be reviewed quarterly or when providers
 * announce pricing changes. Current prices as of 2024-12:
 * - OpenAI: https://openai.com/pricing
 * - Anthropic: https://www.anthropic.com/pricing
 *
 * When adding new models, ensure costPer1kTokens reflects input token pricing
 * (output pricing is typically higher but we use input for cost estimation).
 */
export const MODEL_REGISTRY: Record<string, ModelConfig> = {
  "gpt-4o-mini": {
    id: "gpt-4o-mini",
    provider: "openai",
    tier: "fast",
    enabled: true,
    maxTokens: 4096,
    costPer1kTokens: 0.15,
    averageLatencyMs: 800,
    qualityScore: 0.75,
    description: "Fast, cost-effective model for simple tasks",
  },
  "gpt-5-mini": {
    id: "gpt-5-mini",
    provider: "openai",
    tier: "fast",
    enabled: true,
    maxTokens: 8192,
    costPer1kTokens: 0.30,
    averageLatencyMs: 600,
    qualityScore: 0.82,
    description: "Fast GPT-5 variant for simple generation tasks",
    reasoning: false,
  },
  "gpt-4o": {
    id: "gpt-4o",
    provider: "openai",
    tier: "quality",
    enabled: true,
    maxTokens: 4096,
    costPer1kTokens: 2.5,
    averageLatencyMs: 2000,
    qualityScore: 0.92,
    description: "High-quality model for complex reasoning",
  },
  "gpt-5.2": {
    id: "gpt-5.2",
    provider: "openai",
    tier: "premium",
    enabled: true,
    maxTokens: 16384,
    costPer1kTokens: 15.0, // Reasoning models are more expensive
    averageLatencyMs: 15000, // Reasoning takes longer
    qualityScore: 0.98,
    description: "OpenAI reasoning model with extended thinking capabilities",
    reasoning: true,
  },
  "claude-sonnet-4-20250514": {
    id: "claude-sonnet-4-20250514",
    provider: "anthropic",
    tier: "premium",
    enabled: false, // Disabled by default, enable via env
    maxTokens: 4096,
    costPer1kTokens: 3.0,
    averageLatencyMs: 2500,
    qualityScore: 0.95,
    description: "Premium Anthropic model for highest quality",
  },
  "claude-3-5-sonnet-20241022": {
    id: "claude-3-5-sonnet-20241022",
    provider: "anthropic",
    tier: "quality",
    enabled: true,
    maxTokens: 4096,
    costPer1kTokens: 3.0,
    averageLatencyMs: 2200,
    qualityScore: 0.93,
    description: "High-quality Anthropic model",
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
