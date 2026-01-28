/**
 * Model Availability Service
 *
 * Fetches available models from provider APIs to verify
 * registry models are actually available.
 */

import OpenAI from 'openai';
import { config } from '../config/index.js';
import { MODEL_REGISTRY, type ModelConfig } from '../config/models.js';
import { log } from '../utils/telemetry.js';

/**
 * Model availability result from provider API
 */
export interface ProviderModel {
  id: string;
  provider: 'openai' | 'anthropic';
  owned_by?: string;
  created?: number;
}

/**
 * Model availability check result
 */
export interface ModelAvailabilityResult {
  provider: 'openai' | 'anthropic';
  available_models: ProviderModel[];
  registry_status: {
    model_id: string;
    in_registry: boolean;
    enabled: boolean;
    available_from_provider: boolean;
    status: 'ok' | 'missing_from_provider' | 'not_in_registry' | 'disabled';
  }[];
  fetched_at: string;
  error?: string;
}

/**
 * Cache for provider model lists (15 minute TTL)
 */
const modelCache = new Map<string, { data: ProviderModel[]; expires: number }>();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Fetch available models from OpenAI API
 */
export async function fetchOpenAIModels(): Promise<ProviderModel[]> {
  const cacheKey = 'openai';
  const cached = modelCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    return cached.data;
  }

  const apiKey = config.llm?.openaiApiKey;
  if (!apiKey) {
    log.warn({ event: 'model_availability.openai.no_key' }, 'OpenAI API key not configured');
    return [];
  }

  try {
    const client = new OpenAI({ apiKey });
    const response = await client.models.list();

    const models: ProviderModel[] = [];
    for await (const model of response) {
      // Filter to chat/reasoning models only (gpt-*, o1-*, o3-*)
      // This excludes embedding models (text-embedding-*), audio models (whisper-*),
      // image models (dall-e-*), and other non-chat models.
      // NOTE: If OpenAI introduces new chat model prefixes, add them here.
      if (model.id.startsWith('gpt-') ||
          model.id.startsWith('o1') ||
          model.id.startsWith('o3')) {
        models.push({
          id: model.id,
          provider: 'openai',
          owned_by: model.owned_by,
          created: model.created,
        });
      }
    }

    // Sort by ID
    models.sort((a, b) => a.id.localeCompare(b.id));

    // Cache the result
    modelCache.set(cacheKey, {
      data: models,
      expires: Date.now() + CACHE_TTL_MS,
    });

    log.info({
      event: 'model_availability.openai.fetched',
      count: models.length,
    }, `Fetched ${models.length} OpenAI models`);

    return models;
  } catch (error) {
    log.error({
      event: 'model_availability.openai.error',
      error: error instanceof Error ? error.message : String(error),
    }, 'Failed to fetch OpenAI models');
    return [];
  }
}

/**
 * Get curated Anthropic models list
 *
 * Note: Anthropic doesn't have a public model list API,
 * so we maintain a curated list of known models.
 *
 * IMPORTANT: This list should match MODEL_REGISTRY Anthropic entries.
 * Do not add deprecated models here - they belong in KNOWN_DEPRECATED_MODELS.
 */
export function getAnthropicModels(): ProviderModel[] {
  // Curated list of known Anthropic models (updated 2026-01)
  // This should be updated when Anthropic releases new models
  return [
    // Claude 4.5 Family
    { id: 'claude-opus-4-5-20251101', provider: 'anthropic' },
    { id: 'claude-sonnet-4-5-20250929', provider: 'anthropic' },
    // Claude 4 Family
    { id: 'claude-opus-4-20250514', provider: 'anthropic' },
    { id: 'claude-sonnet-4-20250514', provider: 'anthropic' },
    // Claude 3.5 Family
    { id: 'claude-3-5-haiku-20241022', provider: 'anthropic' },
    // Note: claude-3-5-sonnet-20241022 is deprecated (sunset by Anthropic)
  ];
}

/**
 * Check model availability against registry
 */
export async function checkModelAvailability(
  provider: 'openai' | 'anthropic'
): Promise<ModelAvailabilityResult> {
  const fetchedAt = new Date().toISOString();

  let providerModels: ProviderModel[];
  let error: string | undefined;

  try {
    if (provider === 'openai') {
      providerModels = await fetchOpenAIModels();
    } else {
      providerModels = getAnthropicModels();
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    providerModels = [];
  }

  // Build a set of provider model IDs for quick lookup
  const providerModelIds = new Set(providerModels.map(m => m.id));

  // Get registry models for this provider
  const registryModels = Object.values(MODEL_REGISTRY).filter(
    (m): m is ModelConfig => m.provider === provider
  );

  // Define the status item type explicitly to allow all status values
  type RegistryStatusItem = {
    model_id: string;
    in_registry: boolean;
    enabled: boolean;
    available_from_provider: boolean;
    status: 'ok' | 'missing_from_provider' | 'not_in_registry' | 'disabled';
  };

  // Check registry models against provider availability
  const registryStatus: RegistryStatusItem[] = registryModels.map(model => {
    const availableFromProvider = providerModelIds.has(model.id);
    let status: RegistryStatusItem['status'];

    if (!model.enabled) {
      status = 'disabled';
    } else if (!availableFromProvider) {
      status = 'missing_from_provider';
    } else {
      status = 'ok';
    }

    return {
      model_id: model.id,
      in_registry: true,
      enabled: model.enabled,
      available_from_provider: availableFromProvider,
      status,
    };
  });

  // Also check for provider models not in our registry
  for (const providerModel of providerModels) {
    if (!MODEL_REGISTRY[providerModel.id]) {
      registryStatus.push({
        model_id: providerModel.id,
        in_registry: false,
        enabled: false,
        available_from_provider: true,
        status: 'not_in_registry',
      });
    }
  }

  // Sort by status (issues first), then by model ID
  const statusOrder = { missing_from_provider: 0, not_in_registry: 1, disabled: 2, ok: 3 };
  registryStatus.sort((a, b) => {
    const statusDiff = statusOrder[a.status] - statusOrder[b.status];
    if (statusDiff !== 0) return statusDiff;
    return a.model_id.localeCompare(b.model_id);
  });

  return {
    provider,
    available_models: providerModels,
    registry_status: registryStatus,
    fetched_at: fetchedAt,
    error,
  };
}

/**
 * Track model errors for deprecation detection
 */
export interface ModelErrorRecord {
  model_id: string;
  provider: string;
  error_type: 'not_found' | 'invalid_model' | 'deprecated' | 'rate_limit' | 'other';
  error_message: string;
  timestamp: string;
  request_id?: string;
}

// In-memory error tracking (last 100 errors per model)
const modelErrors = new Map<string, ModelErrorRecord[]>();
const MAX_ERRORS_PER_MODEL = 100;

/**
 * Record a model error for tracking
 */
export function recordModelError(record: ModelErrorRecord): void {
  const key = `${record.provider}:${record.model_id}`;
  const errors = modelErrors.get(key) ?? [];

  errors.push(record);

  // Keep only last N errors
  if (errors.length > MAX_ERRORS_PER_MODEL) {
    errors.shift();
  }

  modelErrors.set(key, errors);

  // Log warning for potential deprecation
  if (record.error_type === 'not_found' || record.error_type === 'invalid_model') {
    log.warn({
      event: 'model_error.potential_deprecation',
      model_id: record.model_id,
      provider: record.provider,
      error_type: record.error_type,
      error_message: record.error_message,
    }, `Model ${record.model_id} may be deprecated: ${record.error_message}`);
  }
}

/**
 * Get recent model errors
 */
export function getModelErrors(provider?: string, modelId?: string): ModelErrorRecord[] {
  if (provider && modelId) {
    return modelErrors.get(`${provider}:${modelId}`) ?? [];
  }

  const allErrors: ModelErrorRecord[] = [];
  for (const errors of modelErrors.values()) {
    allErrors.push(...errors);
  }

  // Filter by provider if specified
  if (provider) {
    return allErrors.filter(e => e.provider === provider);
  }

  return allErrors.sort((a, b) =>
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
}

/**
 * Get model error summary
 */
export function getModelErrorSummary(): {
  total_errors: number;
  by_model: { model_id: string; count: number; last_error: string }[];
  potential_deprecations: string[];
} {
  const byModel: { model_id: string; count: number; last_error: string }[] = [];
  const potentialDeprecations: string[] = [];

  for (const [key, errors] of modelErrors.entries()) {
    const [_provider, modelId] = key.split(':');
    const lastError = errors[errors.length - 1];

    byModel.push({
      model_id: modelId,
      count: errors.length,
      last_error: lastError?.timestamp ?? '',
    });

    // Flag models with recent not_found/invalid_model errors as potential deprecations
    const recentDeprecationErrors = errors.filter(
      e => (e.error_type === 'not_found' || e.error_type === 'invalid_model') &&
           Date.now() - new Date(e.timestamp).getTime() < 24 * 60 * 60 * 1000 // Last 24 hours
    );
    if (recentDeprecationErrors.length > 0) {
      potentialDeprecations.push(modelId);
    }
  }

  return {
    total_errors: byModel.reduce((sum, m) => sum + m.count, 0),
    by_model: byModel.sort((a, b) => b.count - a.count),
    potential_deprecations: potentialDeprecations,
  };
}
