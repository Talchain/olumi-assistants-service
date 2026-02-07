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
 *   Uses this centralized prompt management system via `getSystemPrompt()` for:
 *   - draft_graph: Full prompt management integration
 *   - repair_graph: Full prompt management integration (v6 minimal-diff prompt)
 *   Other operations (suggest_options, clarify_brief) use inline prompts.
 *   This partial integration is intentional:
 *   - OpenAI's API structure differs from Anthropic (user-only vs system+user)
 *   - OpenAI integration is secondary/fallback; Anthropic is primary
 *   - Operations `critiqueGraph` and `explainDiff` are not implemented for OpenAI
 */

import { loadPromptSync, loadPrompt, getDefaultPrompts, type CeeTaskId, type LoadedPrompt } from '../../prompts/index.js';
import { registerAllDefaultPrompts, DECISION_REVIEW_PROMPT_VERSION } from '../../prompts/defaults.js';
import { isPromptManagementEnabled } from '../../prompts/loader.js';
import { log, emit, TelemetryEvents } from '../../utils/telemetry.js';
import { createHash, randomBytes } from 'node:crypto';
import { shouldUseStagingPrompts } from '../../config/index.js';
import { PROMPT_STORE_FETCH_TIMEOUT_MS } from '../../config/timeouts.js';

// Unique identifier for this server instance (helps diagnose multi-instance issues)
const INSTANCE_ID = randomBytes(4).toString('hex');
const INSTANCE_START_TIME = Date.now();

// Flag to track if defaults have been initialized in this module instance
let defaultsInitialized = false;

// Cache warming readiness state - tracks whether prompts were successfully loaded from store
interface CacheWarmingState {
  completed: boolean;
  completedAt: number | null;
  warmedFromStore: number;
  failedCount: number;
  skippedCount: number;
}

const cacheWarmingState: CacheWarmingState = {
  completed: false,
  completedAt: null,
  warmedFromStore: 0,
  failedCount: 0,
  skippedCount: 0,
};

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
  decision_review: 'decision_review',
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
  /** Environment-specific model configuration (if from store and configured) */
  modelConfig?: { staging?: string; production?: string };
}

const promptCache = new Map<CeeTaskId, CacheEntry>();
const CACHE_TTL_MS = 300_000; // 5 minutes - cache is considered "fresh" for this long
const PROACTIVE_REFRESH_THRESHOLD = 0.8; // Trigger background refresh at 80% of TTL (4 min)
const STALE_GRACE_PERIOD_MS = 600_000; // 10 minutes - return stale store prompts rather than defaults
// Note: With proactive refresh at 80% TTL, cache should rarely go stale.
// The grace period is a safety net for when background refresh fails.

// Track in-flight background refreshes to prevent thundering herd
const inflightRefresh = new Map<CeeTaskId, Promise<void>>();

/**
 * Options for getSystemPrompt
 */
export interface GetSystemPromptOptions {
  /** Variables to interpolate into the prompt */
  variables?: Record<string, string | number>;
  /** Force use of hardcoded default prompt (skip store/cache lookup) - ?default=1 URL param */
  forceDefault?: boolean;
}

/**
 * Get the system prompt for an LLM operation.
 *
 * Resolution order:
 * 1. If forceDefault, return hardcoded default directly
 * 2. Check cache (if fresh or stale within grace period)
 * 3. If cache expired, try synchronous store fetch first
 * 4. Fall back to defaults only if store fetch fails
 *
 * @param operation - The LLM operation name (e.g., 'draft_graph')
 * @param options - Optional configuration including variables and forceDefault
 * @returns The prompt content
 * @throws Error if no prompt is registered for the operation
 */
export async function getSystemPrompt(
  operation: string,
  options?: GetSystemPromptOptions,
): Promise<string> {
  const variables = options?.variables;
  const forceDefault = options?.forceDefault ?? false;
  // Ensure default prompts are registered on first access
  ensureDefaultsRegistered();

  const taskId = OPERATION_TO_TASK_ID[operation];
  if (!taskId) {
    throw new Error(`Unknown LLM operation: ${operation}. No prompt mapping defined.`);
  }

  // If forceDefault is true, skip cache and store - return hardcoded default directly
  // Useful for A/B testing store prompts vs defaults
  if (forceDefault) {
    log.info({ taskId, forceDefault: true }, 'Force default prompt requested - skipping cache and store');
    const content = loadPromptSync(taskId, variables ?? {});
    emit(TelemetryEvents.PromptLoadedFromDefault, { taskId, reason: 'force_default' });
    return content;
  }

  const hasVariables = Boolean(variables && Object.keys(variables).length > 0);

  const now = Date.now();
  const cached = hasVariables ? undefined : promptCache.get(taskId);
  const cacheAge = cached ? now - cached.loadedAt : Infinity;

  // Return cached value if still fresh
  if (cached && cacheAge < CACHE_TTL_MS) {
    emit(TelemetryEvents.PromptStoreCacheHit, { taskId });

    // Proactive refresh: trigger background refresh when cache is > 80% through TTL
    // This ensures cache stays fresh without blocking requests
    const proactiveThresholdMs = CACHE_TTL_MS * PROACTIVE_REFRESH_THRESHOLD;
    if (cacheAge > proactiveThresholdMs && !hasVariables) {
      triggerBackgroundRefresh(taskId, variables);
    }

    return cached.content;
  }

  // Stale-while-revalidate: if cache is stale but within grace period, return stale + refresh
  // This prevents returning defaults on cache expiry - only truly expired entries fall through
  if (cached && cacheAge < CACHE_TTL_MS + STALE_GRACE_PERIOD_MS) {
    emit(TelemetryEvents.PromptStoreCacheMiss, {
      taskId,
      reason: 'stale_while_revalidate',
      cacheAge,
    });

    // Trigger background refresh if not already in-flight
    triggerBackgroundRefresh(taskId, variables);

    // Return stale cached value immediately (better than defaults)
    return cached.content;
  }

  // Cache miss or very stale - log the reason with visibility in production logs
  const missReason = cached ? 'expired' : 'not_cached';
  emit(TelemetryEvents.PromptStoreCacheMiss, {
    taskId,
    reason: missReason,
    cacheAge: cached ? cacheAge : undefined,
  });

  // Track whether fallback to defaults is due to a transient failure (timeout/error)
  // vs a permanent condition (no managed prompt exists, prompt management disabled).
  // We should NOT cache defaults on transient failures - let the next request retry.
  let isTransientFailure = false;

  // Cache expired - try synchronous store fetch BEFORE falling back to defaults
  // This ensures store prompts are used when available, even after cache expiry
  // Use a timeout to prevent blocking too long if Supabase is slow (5s max)
  // Note: Increased from 2.5s to 5s to accommodate Supabase free tier cold starts
  const STORE_FETCH_TIMEOUT_MS = PROMPT_STORE_FETCH_TIMEOUT_MS;
  if (isPromptManagementEnabled()) {
    const useStaging = shouldUseStagingPrompts();
    try {
      const fetchPromise = loadPrompt(taskId, { variables: variables ?? {}, useStaging });
      const timeoutPromise = new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), STORE_FETCH_TIMEOUT_MS)
      );
      const loaded = await Promise.race([fetchPromise, timeoutPromise]);

      if (loaded === null) {
        log.warn(
          { taskId, timeoutMs: STORE_FETCH_TIMEOUT_MS, useStaging },
          'Cache expired - store fetch timed out, falling back to defaults (will NOT cache defaults)'
        );
        // Transient failure - don't cache defaults, let next request retry
        isTransientFailure = true;
      } else if (loaded.source === 'store') {
        const promptHash = createHash('sha256').update(loaded.content).digest('hex');

        // Update cache with store prompt
        if (!hasVariables) {
          promptCache.set(taskId, {
            content: loaded.content,
            loadedAt: Date.now(),
            source: loaded.source,
            promptId: loaded.promptId,
            version: loaded.version,
            promptHash,
            isStaging: loaded.isStaging,
            modelConfig: loaded.modelConfig,
          });
        }

        log.info(
          { taskId, promptId: loaded.promptId, version: loaded.version, isStaging: loaded.isStaging, useStaging, instanceId: INSTANCE_ID },
          'Cache expired - loaded from store synchronously'
        );
        emit(TelemetryEvents.PromptLoadedFromStore, { taskId, fromCache: false, reason: 'cache_expired_sync_fetch' });

        return loaded.content;
      } else if (loaded !== null) {
        // Store returned defaults - this is a permanent condition (no managed prompt exists)
        // It's OK to cache defaults in this case
        log.debug({ taskId, useStaging }, 'Cache expired - store returned defaults, using hardcoded default');
      }
    } catch (err) {
      // Store fetch failed - transient failure, don't cache defaults
      log.warn(
        { taskId, error: String(err), useStaging },
        'Cache expired - store fetch failed, falling back to defaults (will NOT cache defaults)'
      );
      isTransientFailure = true;
    }
  }

  // Log at warn level for visibility in production - this should be rare after cache warming
  log.warn(
    { taskId, reason: missReason, cacheAge: cached ? cacheAge : null, cacheTtlMs: CACHE_TTL_MS, staleGraceMs: STALE_GRACE_PERIOD_MS, isTransientFailure },
    isTransientFailure
      ? 'Prompt cache miss - returning defaults WITHOUT caching (transient failure, next request will retry)'
      : 'Prompt cache miss - returning defaults. This indicates cache expiry or cold start.'
  );

  // Load from prompt system (sync path for immediate return)
  try {
    const content = loadPromptSync(taskId, variables ?? {});

    const promptHash = createHash('sha256').update(content).digest('hex');

    // Only cache static prompts (no variables) to avoid cache poisoning
    // IMPORTANT: Do NOT cache defaults on transient failures (timeout/network error)
    // This prevents "poisoning" the cache with defaults when Supabase is temporarily slow.
    // The next request will retry and likely succeed since we just "woke up" Supabase.
    const willCache = !hasVariables && !isTransientFailure;
    if (willCache) {
      promptCache.set(taskId, {
        content,
        loadedAt: now,
        source: 'default',
        promptHash,
      });
    }

    // Emit telemetry with reason and cache status for monitoring
    emit(TelemetryEvents.PromptLoadedFromDefault, {
      taskId,
      reason: isTransientFailure ? 'transient_failure' : missReason,
      cached: willCache,
    });

    // Trigger background refresh from store to update cache for next request
    triggerBackgroundRefresh(taskId, variables);

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

/**
 * Trigger a background refresh of the prompt cache for a task
 * Uses stale-while-revalidate pattern - existing cache serves requests while refresh happens
 */
function triggerBackgroundRefresh(
  taskId: CeeTaskId,
  variables?: Record<string, string | number>,
): void {
  // Skip if already in-flight (prevents thundering herd on cache expiry)
  if (inflightRefresh.has(taskId)) {
    return;
  }

  // Skip if variables are provided (not cached anyway)
  if (variables && Object.keys(variables).length > 0) {
    return;
  }

  const useStaging = shouldUseStagingPrompts();
  const refreshPromise = loadPrompt(taskId, { variables: variables ?? {}, useStaging })
    .then((loaded) => {
      // Log when background refresh returns defaults instead of store data
      if (loaded.source !== 'store') {
        log.warn(
          { taskId, source: loaded.source, useStaging },
          'Background refresh returned defaults instead of store prompt - check Supabase connectivity'
        );
      }
      if (loaded.source === 'store') {
        const refreshedHash = createHash('sha256').update(loaded.content).digest('hex');
        promptCache.set(taskId, {
          content: loaded.content,
          loadedAt: Date.now(),
          source: loaded.source,
          promptId: loaded.promptId,
          version: loaded.version,
          promptHash: refreshedHash,
          isStaging: loaded.isStaging,
          modelConfig: loaded.modelConfig,
        });
        // Log successful refresh with full identifiers for debugging
        log.info(
          { taskId, promptId: loaded.promptId, version: loaded.version, isStaging: loaded.isStaging, useStaging, instanceId: INSTANCE_ID },
          'Background refresh successful - cache updated with store prompt'
        );
        emit(TelemetryEvents.PromptStoreBackgroundRefresh, {
          taskId,
          promptId: loaded.promptId,
          version: loaded.version,
          isStaging: loaded.isStaging,
        });
      }
    })
    .catch((err) => {
      // Log at warn level for visibility - background refresh failures prevent cache warming
      log.warn({ taskId, error: String(err) }, 'Background prompt refresh failed - cache will not be updated');
    })
    .finally(() => {
      inflightRefresh.delete(taskId);
    });
  inflightRefresh.set(taskId, refreshPromise);
}

export function getSystemPromptMeta(operation: string): {
  taskId: CeeTaskId;
  source: 'store' | 'default';
  promptId?: string;
  version?: number;
  prompt_version: string;
  prompt_hash?: string;
  isStaging?: boolean;
  /** Server instance ID (for diagnosing multi-instance cache issues) */
  instance_id?: string;
  /** Cache age in ms at request time */
  cache_age_ms?: number;
  /** Cache status at request time: fresh, stale (serving while revalidating), or expired */
  cache_status?: 'fresh' | 'stale' | 'expired' | 'miss';
  /** Whether staging mode is enabled (from DD_ENV or config) */
  use_staging_mode?: boolean;
  /** Environment-specific model configuration (if from store and configured) */
  modelConfig?: { staging?: string; production?: string };
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
  const cacheAgeMs = cached ? Date.now() - cached.loadedAt : undefined;
  const useStagingMode = shouldUseStagingPrompts();

  // Compute cache status
  let cacheStatus: 'fresh' | 'stale' | 'expired' | 'miss';
  if (!cached) {
    cacheStatus = 'miss';
  } else if (cacheAgeMs! < CACHE_TTL_MS) {
    cacheStatus = 'fresh';
  } else if (cacheAgeMs! < CACHE_TTL_MS + STALE_GRACE_PERIOD_MS) {
    cacheStatus = 'stale';
  } else {
    cacheStatus = 'expired';
  }

  // Format prompt_version to clearly indicate staging/production
  // Include instance ID for multi-instance debugging
  // Examples:
  //   "draft_graph_default@v6 (staging) [inst:a1b2c3d4]" - staging version from store
  //   "draft_graph_default@v8 (production) [inst:a1b2c3d4]" - production version from store
  //   "default:draft_graph" - hardcoded default (generic)
  //   "default:decision_review@v6" - hardcoded default with explicit version
  let promptVersion: string;
  if (source === 'store' && promptId && typeof version === 'number') {
    const envLabel = isStaging ? 'staging' : 'production';
    promptVersion = `${promptId}@v${version} (${envLabel})`;
  } else if (taskId === 'decision_review') {
    // Decision review has explicit version tracking for fallback observability
    promptVersion = `default:${taskId}@${DECISION_REVIEW_PROMPT_VERSION}`;
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
    instance_id: INSTANCE_ID,
    cache_age_ms: cacheAgeMs,
    cache_status: cacheStatus,
    use_staging_mode: useStagingMode,
    modelConfig: cached?.modelConfig,
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
        modelConfig: loaded.modelConfig,
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

  // Update cache warming state for readiness checks
  cacheWarmingState.completed = true;
  cacheWarmingState.completedAt = Date.now();
  cacheWarmingState.warmedFromStore = warmed;
  cacheWarmingState.failedCount = failed;
  cacheWarmingState.skippedCount = skipped;

  log.info(
    { warmed, failed, skipped, usedStaging, total: taskIds.length, useStaging, instanceId: INSTANCE_ID },
    useStaging ? 'Prompt cache warming complete (staging mode)' : 'Prompt cache warming complete (production mode)'
  );

  emit(TelemetryEvents.PromptStoreCacheWarmed, { warmed, failed, skipped, usedStaging });

  return { warmed, failed, skipped, usedStaging };
}

/**
 * Check if cache warming completed successfully
 *
 * Used by server to determine readiness for accepting traffic.
 * Returns true if warming completed and at least some prompts were loaded from store.
 */
export function isCacheWarmingComplete(): boolean {
  return cacheWarmingState.completed;
}

/**
 * Check if cache warming is ready with store prompts
 *
 * More strict check - requires that at least one prompt was loaded from store.
 * Returns false if all prompts fell back to defaults (indicates store connectivity issues).
 */
export function isCacheWarmingHealthy(): boolean {
  return cacheWarmingState.completed && cacheWarmingState.warmedFromStore > 0;
}

/**
 * Get cache warming state for diagnostics
 */
export function getCacheWarmingState(): Readonly<CacheWarmingState> {
  return { ...cacheWarmingState };
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

/**
 * Get diagnostic info about the prompt-loader cache state
 * Used by healthz to diagnose cache issues
 */
export function getPromptLoaderCacheDiagnostics(): {
  instanceId: string;
  instanceUptimeMs: number;
  useStagingMode: boolean;
  cacheSize: number;
  cacheTtlMs: number;
  staleGracePeriodMs: number;
  entries: Array<{
    taskId: string;
    source: 'store' | 'default';
    promptId?: string;
    version?: number;
    isStaging?: boolean;
    ageMs: number;
    status: 'fresh' | 'stale' | 'expired';
  }>;
} {
  const now = Date.now();
  const entries: Array<{
    taskId: string;
    source: 'store' | 'default';
    promptId?: string;
    version?: number;
    isStaging?: boolean;
    ageMs: number;
    status: 'fresh' | 'stale' | 'expired';
  }> = [];

  for (const [taskId, entry] of promptCache.entries()) {
    const ageMs = now - entry.loadedAt;
    let status: 'fresh' | 'stale' | 'expired';
    if (ageMs < CACHE_TTL_MS) {
      status = 'fresh';
    } else if (ageMs < CACHE_TTL_MS + STALE_GRACE_PERIOD_MS) {
      status = 'stale'; // Will serve stale-while-revalidate
    } else {
      status = 'expired'; // Will fall back to defaults
    }

    entries.push({
      taskId,
      source: entry.source ?? 'default',
      promptId: entry.promptId,
      version: entry.version,
      isStaging: entry.isStaging,
      ageMs,
      status,
    });
  }

  return {
    instanceId: INSTANCE_ID,
    instanceUptimeMs: Date.now() - INSTANCE_START_TIME,
    useStagingMode: shouldUseStagingPrompts(),
    cacheSize: promptCache.size,
    cacheTtlMs: CACHE_TTL_MS,
    staleGracePeriodMs: STALE_GRACE_PERIOD_MS,
    entries,
  };
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
