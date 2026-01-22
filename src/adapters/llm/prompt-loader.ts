/**
 * LLM Adapter Prompt Loader
 *
 * Provides a synchronous interface for loading prompts in LLM adapters.
 * Uses the centralized prompt management system with fallback to defaults.
 *
 * Supports:
 * - Sync loading from registered defaults (for backward compatibility)
 * - Async loading from prompt store (for managed prompts)
 * - Staging environments for testing new prompts
 * - A/B experiments for comparing prompt variants
 *
 * This module caches loaded prompts to avoid repeated file system access
 * while still allowing dynamic updates when prompts change.
 *
 * ## Provider Prompt Strategy
 *
 * **Anthropic adapter** (`src/adapters/llm/anthropic.ts`):
 *   Uses this centralized prompt management system via `getSystemPrompt()`.
 *   Supports A/B experiments, dynamic updates, and prompt versioning.
 *   Operations: draft_graph, suggest_options, repair_graph, clarify_brief, critique_graph
 *
 * **OpenAI adapter** (`src/adapters/llm/openai.ts`):
 *   Uses this centralized prompt management system for `draft_graph` via `getSystemPrompt()`.
 *   Other operations (suggest_options, repair_graph, clarify_brief) use inline prompts.
 *   This partial integration is intentional:
 *   - OpenAI's API structure differs from Anthropic (user-only vs system+user)
 *   - OpenAI integration is secondary/fallback; Anthropic is primary
 *   - Operations `critiqueGraph` and `explainDiff` are not implemented for OpenAI
 */

import { loadPromptSync, loadPrompt, getDefaultPrompts, type CeeTaskId, type LoadedPrompt } from '../../prompts/index.js';
import { registerAllDefaultPrompts } from '../../prompts/defaults.js';
import { log, emit, TelemetryEvents } from '../../utils/telemetry.js';
import { createHash } from 'node:crypto';
import { shouldUseStagingPrompts } from '../../config/index.js';

// Flag to track if defaults have been initialized in this module instance
let defaultsInitialized = false;

/**
 * Ensure default prompts are registered (called lazily on first access)
 */
function ensureDefaultsRegistered(): void {
  if (defaultsInitialized) return;

  // Check if defaults are already registered (may have been done by server.ts)
  const defaults = getDefaultPrompts();
  if (Object.keys(defaults).length === 0) {
    registerAllDefaultPrompts();
  }
  defaultsInitialized = true;
}

/**
 * Map of LLM operation names to CEE task IDs
 */
const OPERATION_TO_TASK_ID: Record<string, CeeTaskId> = {
  draft_graph: 'draft_graph',
  suggest_options: 'suggest_options',
  repair_graph: 'repair_graph',
  clarify_brief: 'clarify_brief',
  critique_graph: 'critique_graph',
  explainer: 'explainer',
  bias_check: 'bias_check',
  // Note: isl_synthesis is NOT here - it's deterministic (template-based, no LLM calls)
};

/**
 * Cache for loaded prompts with TTL
 * Allows prompt changes to take effect without restart
 */
interface CacheEntry {
  content: string;
  loadedAt: number;
  source?: LoadedPrompt["source"];
  promptId?: string;
  version?: number;
  promptHash?: string;
  /** Whether this is a staging version (for non-production environments) */
  isStaging?: boolean;
}

const promptCache = new Map<CeeTaskId, CacheEntry>();
const CACHE_TTL_MS = 60_000; // 1 minute

// Track in-flight background refreshes to prevent thundering herd
const inflightRefresh = new Map<CeeTaskId, Promise<void>>();

/**
 * Get the system prompt for an LLM operation.
 *
 * Resolution order:
 * 1. Check cache (if not expired)
 * 2. Load from prompt management system (store -> defaults)
 * 3. Cache the result
 *
 * @param operation - The LLM operation name (e.g., 'draft_graph')
 * @param variables - Optional variables to interpolate
 * @returns The prompt content
 * @throws Error if no prompt is registered for the operation
 */
export function getSystemPrompt(
  operation: string,
  variables?: Record<string, string | number>,
): string {
  // Ensure default prompts are registered on first access
  ensureDefaultsRegistered();

  const taskId = OPERATION_TO_TASK_ID[operation];
  if (!taskId) {
    throw new Error(`Unknown LLM operation: ${operation}. No prompt mapping defined.`);
  }

  const hasVariables = Boolean(variables && Object.keys(variables).length > 0);

  const now = Date.now();
  const cached = hasVariables ? undefined : promptCache.get(taskId);

  // Return cached value if still fresh
  if (cached && now - cached.loadedAt < CACHE_TTL_MS) {
    emit(TelemetryEvents.PromptStoreCacheHit, { taskId });
    return cached.content;
  }

  // Cache miss - log the reason
  emit(TelemetryEvents.PromptStoreCacheMiss, {
    taskId,
    reason: cached ? 'expired' : 'not_cached',
  });

  // Load from prompt system (sync path for immediate return)
  try {
    const content = loadPromptSync(taskId, variables ?? {});

    const promptHash = createHash('sha256').update(content).digest('hex');

    // Only cache static prompts (no variables) to avoid cache poisoning
    if (!hasVariables) {
      promptCache.set(taskId, {
        content,
        loadedAt: now,
        source: 'default',
        promptHash,
      });
    }

    // Trigger background refresh from store to update cache for next request
    // Only if not already in-flight (prevents thundering herd on cache expiry)
    // Use staging in non-production environments to maintain consistency
    if (!hasVariables && !inflightRefresh.has(taskId)) {
      const useStaging = shouldUseStagingPrompts();
      const refreshPromise = loadPrompt(taskId, { variables: variables ?? {}, useStaging })
        .then((loaded) => {
          if (loaded.source === 'store' && !hasVariables) {
            const refreshedHash = createHash('sha256').update(loaded.content).digest('hex');
            promptCache.set(taskId, {
              content: loaded.content,
              loadedAt: Date.now(),
              source: loaded.source,
              promptId: loaded.promptId,
              version: loaded.version,
              promptHash: refreshedHash,
              isStaging: loaded.isStaging,
            });
            emit(TelemetryEvents.PromptStoreBackgroundRefresh, {
              taskId,
              promptId: loaded.promptId,
              version: loaded.version,
              isStaging: loaded.isStaging,
            });
          }
        })
        .catch((err) => {
          log.debug({ taskId, error: String(err) }, 'Background prompt refresh failed (non-fatal)');
        })
        .finally(() => {
          inflightRefresh.delete(taskId);
        });
      inflightRefresh.set(taskId, refreshPromise);
    }

    return content;
  } catch (error) {
    // Log but don't crash - this allows graceful degradation
    log.warn(
      { operation, taskId, error: String(error) },
      'Failed to load prompt, operation may fail',
    );
    throw error;
  }
}

export function getSystemPromptMeta(operation: string): {
  taskId: CeeTaskId;
  source: 'store' | 'default';
  promptId?: string;
  version?: number;
  prompt_version: string;
  prompt_hash?: string;
  isStaging?: boolean;
} {
  ensureDefaultsRegistered();

  const taskId = OPERATION_TO_TASK_ID[operation];
  if (!taskId) {
    throw new Error(`Unknown LLM operation: ${operation}. No prompt mapping defined.`);
  }

  const cached = promptCache.get(taskId);
  const source: 'store' | 'default' = cached?.source ?? 'default';
  const promptId = cached?.promptId;
  const version = cached?.version;
  const promptHash = cached?.promptHash;
  const isStaging = cached?.isStaging ?? false;

  // Format prompt_version to clearly indicate staging/production
  // Examples:
  //   "draft_graph_default@v6 (staging)" - staging version from store
  //   "draft_graph_default@v8 (production)" - production version from store
  //   "default:draft_graph" - hardcoded default
  let promptVersion: string;
  if (source === 'store' && promptId && typeof version === 'number') {
    const envLabel = isStaging ? 'staging' : 'production';
    promptVersion = `${promptId}@v${version} (${envLabel})`;
  } else {
    promptVersion = `default:${taskId}`;
  }

  return {
    taskId,
    source,
    promptId,
    version,
    prompt_version: promptVersion,
    prompt_hash: promptHash,
    isStaging,
  };
}

/**
 * Clear the prompt cache (for testing or forced refresh)
 */
export function clearPromptCache(): void {
  promptCache.clear();
  defaultsInitialized = false;
}

/**
 * Warm the prompt cache from the managed prompt store
 *
 * Called at server startup to pre-load all prompts from the store.
 * This ensures the sync `getSystemPrompt()` returns managed prompts
 * instead of falling back to defaults.
 *
 * @returns Statistics about the warming operation
 */
export async function warmPromptCacheFromStore(): Promise<{
  warmed: number;
  failed: number;
  skipped: number;
  usedStaging: number;
}> {
  ensureDefaultsRegistered();

  // In non-production environments, use staging version if available
  // This enables testing new prompts in staging without affecting production
  const useStaging = shouldUseStagingPrompts();

  const taskIds = Object.values(OPERATION_TO_TASK_ID) as CeeTaskId[];
  let warmed = 0;
  let failed = 0;
  let skipped = 0;
  let usedStaging = 0;

  for (const taskId of taskIds) {
    try {
      const loaded = await loadPrompt(taskId, { useStaging });

      const promptHash = createHash('sha256').update(loaded.content).digest('hex');

      promptCache.set(taskId, {
        content: loaded.content,
        loadedAt: Date.now(),
        source: loaded.source,
        promptId: loaded.promptId,
        version: loaded.version,
        promptHash,
        isStaging: loaded.isStaging,
      });

      if (loaded.source === 'store') {
        warmed++;
        // Track if staging version was used
        if (useStaging && loaded.isStaging) {
          usedStaging++;
          log.debug({ taskId, source: loaded.source, promptId: loaded.promptId, version: loaded.version, isStaging: true }, 'Cached STAGING prompt from store');
        } else {
          log.debug({ taskId, source: loaded.source, promptId: loaded.promptId, version: loaded.version, isStaging: false }, 'Cached prompt from store');
        }
      } else {
        skipped++;
        log.debug({ taskId, source: loaded.source }, 'Cached prompt from defaults (no managed prompt)');
      }
    } catch (error) {
      failed++;
      log.warn({ taskId, error: String(error) }, 'Failed to warm cache for task');
    }
  }

  log.info(
    { warmed, failed, skipped, usedStaging, total: taskIds.length, useStaging },
    useStaging ? 'Prompt cache warming complete (staging mode)' : 'Prompt cache warming complete (production mode)'
  );

  emit(TelemetryEvents.PromptStoreCacheWarmed, { warmed, failed, skipped, usedStaging });

  return { warmed, failed, skipped, usedStaging };
}

/**
 * Invalidate cache for a specific task or all tasks
 *
 * Called by admin routes when prompts are updated to ensure
 * the next request loads fresh data from the store.
 *
 * @param taskId - Optional task ID to invalidate; if omitted, invalidates all
 * @param reason - Reason for invalidation (for telemetry)
 */
export function invalidatePromptCache(
  taskId?: CeeTaskId,
  reason: string = 'admin_update',
): void {
  if (taskId) {
    const wasPresent = promptCache.has(taskId);
    promptCache.delete(taskId);
    if (wasPresent) {
      emit(TelemetryEvents.PromptStoreCacheInvalidated, { taskId, reason });
      log.info({ taskId, reason }, 'Prompt cache invalidated for task');
    }
  } else {
    const size = promptCache.size;
    promptCache.clear();
    if (size > 0) {
      emit(TelemetryEvents.PromptStoreCacheInvalidated, { taskId: 'all', reason });
      log.info({ entriesCleared: size, reason }, 'Prompt cache fully invalidated');
    }
  }
}

/**
 * Check if a prompt is available for an operation
 */
export function hasPromptForOperation(operation: string): boolean {
  const taskId = OPERATION_TO_TASK_ID[operation];
  if (!taskId) return false;

  try {
    loadPromptSync(taskId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get all supported operation names
 */
export function getSupportedOperations(): string[] {
  return Object.keys(OPERATION_TO_TASK_ID);
}

// ============================================================================
// Staging and A/B Experiment Support
// ============================================================================

/**
 * Telemetry events for prompt A/B experiments
 */
const ExperimentTelemetryEvents = {
  PromptExperimentAssigned: 'prompt.experiment.assigned',
  PromptStagingUsed: 'prompt.staging.used',
} as const;

/**
 * Context for loading prompts with staging/experiment support
 */
export interface PromptLoadContext {
  /** Request ID for correlation */
  requestId?: string;
  /** API key ID (used for experiment assignment) */
  keyId?: string;
  /** User ID (used for experiment assignment) */
  userId?: string;
  /** Force use of staging version */
  useStaging?: boolean;
  /** Experiment name to participate in (if any) */
  experimentName?: string;
  /** Override: force specific variant */
  forceVariant?: 'control' | 'treatment';
}

/**
 * Result of loading a prompt with experiment metadata
 */
export interface PromptLoadResult extends LoadedPrompt {
  /** If part of experiment, which variant was assigned */
  experimentVariant?: 'control' | 'treatment';
  /** Experiment name (if participating) */
  experimentName?: string;
  /** Whether staging version was used */
  isStaging?: boolean;
}

/**
 * Active experiment configuration
 */
interface ExperimentConfig {
  /** Experiment name */
  name: string;
  /** Task ID this experiment applies to */
  taskId: CeeTaskId;
  /** Percentage of traffic in treatment (0-100) */
  treatmentPercent: number;
  /** Treatment uses staging version */
  treatmentUsesStaging: boolean;
  /** Treatment uses specific version */
  treatmentVersion?: number;
}

/**
 * In-memory experiment registry
 * In production, this could be loaded from config or remote service
 */
const activeExperiments = new Map<CeeTaskId, ExperimentConfig>();

/**
 * Register an A/B experiment for a task
 */
export function registerExperiment(config: ExperimentConfig): void {
  activeExperiments.set(config.taskId, config);
  log.info(
    { experimentName: config.name, taskId: config.taskId, treatmentPercent: config.treatmentPercent },
    'Registered prompt experiment'
  );
}

/**
 * Remove an A/B experiment
 */
export function removeExperiment(taskId: CeeTaskId): void {
  const existing = activeExperiments.get(taskId);
  if (existing) {
    log.info({ experimentName: existing.name, taskId }, 'Removed prompt experiment');
    activeExperiments.delete(taskId);
  }
}

/**
 * Get active experiment for a task (if any)
 */
export function getActiveExperiment(taskId: CeeTaskId): ExperimentConfig | undefined {
  return activeExperiments.get(taskId);
}

/**
 * Compute hash bucket for experiment assignment (0-99)
 * Uses a stable hash based on identifiers for consistent assignment
 */
function computeExperimentBucket(
  experimentName: string,
  identifiers: { requestId?: string; keyId?: string; userId?: string }
): number {
  // Use the first available identifier, preferring userId for stability
  const id = identifiers.userId ?? identifiers.keyId ?? identifiers.requestId ?? 'anonymous';
  const hashInput = `${experimentName}:${id}`;
  const hash = createHash('sha256').update(hashInput).digest('hex');
  // Take first 4 hex chars and convert to number (0-65535), then mod 100
  const num = parseInt(hash.substring(0, 4), 16);
  return num % 100;
}

/**
 * Determine experiment variant based on bucket
 */
function assignVariant(
  experiment: ExperimentConfig,
  context: PromptLoadContext
): 'control' | 'treatment' {
  // Honor forced variant
  if (context.forceVariant) {
    return context.forceVariant;
  }

  const bucket = computeExperimentBucket(experiment.name, {
    requestId: context.requestId,
    keyId: context.keyId,
    userId: context.userId,
  });

  return bucket < experiment.treatmentPercent ? 'treatment' : 'control';
}

/**
 * Load a prompt with staging and A/B experiment support (async)
 *
 * This is the preferred method for routes that can handle async operations.
 * Falls back gracefully to defaults if store is unavailable.
 *
 * @param operation - The LLM operation name
 * @param context - Context for staging/experiment selection
 * @param variables - Variables to interpolate
 * @returns The loaded prompt with experiment metadata
 */
export async function getSystemPromptAsync(
  operation: string,
  context: PromptLoadContext = {},
  variables?: Record<string, string | number>,
): Promise<PromptLoadResult> {
  // Ensure default prompts are registered on first access
  ensureDefaultsRegistered();

  const taskId = OPERATION_TO_TASK_ID[operation];
  if (!taskId) {
    throw new Error(`Unknown LLM operation: ${operation}. No prompt mapping defined.`);
  }

  // Check for active experiment
  const experiment = activeExperiments.get(taskId);
  let useStaging = context.useStaging ?? false;
  let version: number | undefined;
  let experimentVariant: 'control' | 'treatment' | undefined;
  let experimentName: string | undefined;

  if (experiment) {
    // Assign variant
    experimentVariant = assignVariant(experiment, context);
    experimentName = experiment.name;

    if (experimentVariant === 'treatment') {
      // Treatment group uses staging or specific version
      if (experiment.treatmentUsesStaging) {
        useStaging = true;
      }
      if (experiment.treatmentVersion !== undefined) {
        version = experiment.treatmentVersion;
      }
    }

    // Emit experiment assignment telemetry
    emit(ExperimentTelemetryEvents.PromptExperimentAssigned, {
      experimentName: experiment.name,
      taskId,
      variant: experimentVariant,
      requestId: context.requestId,
      keyId: context.keyId,
    });
  }

  // Load prompt with appropriate options
  try {
    const loaded = await loadPrompt(taskId, {
      variables: variables ?? {},
      useStaging,
      version,
      correlationId: context.requestId,
    });

    // Emit staging telemetry if applicable
    if (useStaging) {
      emit(ExperimentTelemetryEvents.PromptStagingUsed, {
        taskId,
        promptId: loaded.promptId,
        version: loaded.version,
        requestId: context.requestId,
      });
    }

    return {
      ...loaded,
      experimentVariant,
      experimentName,
      isStaging: useStaging,
    };
  } catch (error) {
    // Log and fall back to sync defaults
    log.warn(
      { operation, taskId, error: String(error), requestId: context.requestId },
      'Failed to load prompt async, falling back to default'
    );

    const content = loadPromptSync(taskId, variables ?? {});
    return {
      content,
      source: 'default',
      experimentVariant,
      experimentName,
      isStaging: false,
    };
  }
}

/**
 * Get all active experiments (for diagnostics)
 */
export function getActiveExperiments(): Array<{
  name: string;
  taskId: CeeTaskId;
  treatmentPercent: number;
}> {
  return Array.from(activeExperiments.values()).map((e) => ({
    name: e.name,
    taskId: e.taskId,
    treatmentPercent: e.treatmentPercent,
  }));
}
