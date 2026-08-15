/**
 * Prompt Loader
 *
 * Provides a clean interface for loading prompts with fallback to
 * hardcoded defaults when the prompt management system is disabled
 * or prompts are not found.
 */

import { createHash } from 'node:crypto';
import { type CeeTaskId, interpolatePrompt } from './schema.js';
import { getPromptStore, isDbBackedStoreHealthy } from './store.js';
import { log, emit, TelemetryEvents } from '../utils/telemetry.js';
import { config, shouldUseStagingPrompts } from '../config/index.js';
import {
  isTrackedKey,
  mapSource,
  pmsResolveTaskId,
  resolvePublicVersion,
  type TrackedKey,
} from './tracked.js';
import type { FallbackReason } from './resolution-policy.js';
import { getRegisteredDefaultPrompt } from './default-registry.js';

export { getDefaultPrompts, registerDefaultPrompt } from './default-registry.js';

/** Source of a `loadPrompt()` call. Lets dashboards filter probe noise. */
export type PromptResolveTrigger =
  | 'runtime'
  | 'healthz'
  | 'status'
  | 'reload'
  | 'startup'
  | 'background_refresh';

function shortSha256(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/**
 * Telemetry events for prompt loading
 */
const LoaderTelemetryEvents = {
  PromptLoadedFromStore: 'prompt.loader.store',
  PromptLoadedFromDefault: 'prompt.loader.default',
  PromptLoadError: 'prompt.loader.error',
} as const;

/**
 * Options for loading a prompt
 */
export interface LoadPromptOptions {
  /** Variables to interpolate into the prompt */
  variables?: Record<string, string | number>;
  /** Force use of default prompt (bypass store) */
  forceDefault?: boolean;
  /**
   * Use the PMS `staging_version` pointer instead of `active_version`.
   *
   * DERIVED, NOT DEFAULTED-TO-FALSE. When omitted this resolves from
   * `shouldUseStagingPrompts()` — i.e. the deployment's own prompt
   * environment — so a caller that forgets to pass it cannot silently
   * serve/report the PRODUCTION pointer on a staging deployment. Pass an
   * explicit boolean only to override that (e.g. A/B experiment variants).
   */
  useStaging?: boolean;
  /** Specific version to load */
  version?: number;
  /** Correlation ID for telemetry */
  correlationId?: string;
  /**
   * Origin of this resolution call. Defaults to 'runtime'. Healthz/status
   * probes pass 'healthz' / 'status' so dashboards can filter probe noise.
   * Admin reload passes 'reload'; the routing snapshot build passes 'startup'.
   */
  trigger?: PromptResolveTrigger;
  /**
   * Marks whether the caller served this resolution from a cache layer.
   * The adapter-level cache passes 'hit' on cache hit; underlying store
   * misses pass 'miss'. Used in `v5.prompt_resolved` so dashboards can
   * separate cold loads from cache-served loads. Optional.
   */
  cache?: 'hit' | 'miss';
}

/**
 * Result of loading a prompt
 */
export interface LoadedPrompt {
  /** The prompt content (with variables interpolated) */
  content: string;
  /** Where the prompt came from */
  source: 'store' | 'default';
  /** Prompt ID (if from store) */
  promptId?: string;
  /** Version number (if from store) */
  version?: number;
  /** Whether this is a staging version (true if useStaging was requested and staging version was used) */
  isStaging?: boolean;
  /** Environment-specific model configuration (if from store and configured) */
  modelConfig?: { staging?: string; production?: string };
  /**
   * When `source === 'default'`, why the fallback happened. Additive diagnostic
   * (PR1) so a critical-key fallback can be told apart from a genuine missing
   * PMS row. Undefined / 'none' when resolved from store. Load-bearing for PR2's
   * last-known-good vs fail-closed decision.
   */
  fallbackReason?: FallbackReason;
}

/**
 * Check if prompt management is enabled
 * Returns true if:
 * - config.prompts.enabled is explicitly true, OR
 * - A database-backed store (Supabase/Postgres) is healthy
 *
 * File store does NOT auto-enable - requires explicit PROMPTS_ENABLED=true
 */
export function isPromptManagementEnabled(): boolean {
  try {
    // Feature flag in config - explicit enablement
    if (config.prompts?.enabled === true) {
      return true;
    }
    // Auto-enable only for database-backed stores (not file store)
    const dbHealthy = isDbBackedStoreHealthy();
    return dbHealthy;
  } catch {
    return false;
  }
}

/**
 * Load a prompt for a CEE task
 *
 * Resolution order:
 * 1. If forceDefault, use hardcoded default
 * 2. If prompt management disabled, use hardcoded default
 * 3. Try to load from prompt store
 * 4. Fall back to hardcoded default
 *
 * @param taskId - The CEE task to load prompt for
 * @param options - Loading options
 * @returns The loaded prompt content and metadata
 */
export async function loadPrompt(
  taskId: CeeTaskId,
  options: LoadPromptOptions = {}
): Promise<LoadedPrompt> {
  const {
    variables = {},
    forceDefault = false,
    // DERIVE, DON'T MIRROR. This used to default to `false`, which silently
    // meant "serve the PRODUCTION pointer" for every caller that omitted it.
    // On a staging deployment that produced a per-task divergence: the
    // routing snapshot (which passes useStaging explicitly, see
    // src/orchestrator-v5/routing/prompt-loader.ts) honoured its
    // `staging_version` pin while the readiness probe
    // (src/prompts/readiness.ts) reported `active_version` for every other
    // tracked key — so /admin/prompts/status, /admin/prompts/reload and
    // /healthz all MISREPORTED which prompt version was live.
    useStaging = shouldUseStagingPrompts(),
    version,
    correlationId,
    trigger = 'runtime',
    cache,
  } = options;

  // Check if we should use defaults
  if (forceDefault || !isPromptManagementEnabled()) {
    return loadDefaultPrompt(
      taskId,
      variables,
      correlationId,
      trigger,
      cache,
      forceDefault ? 'none' : 'pms_disabled',
    );
  }

  try {
    // Try to load from store. PMS lookup is alias-aware: a logical key
    // (e.g. `routing`) may resolve a DIFFERENT operator-managed PMS task
    // (e.g. `orchestrator`) via PMS_TASK_ALIAS. The DEFAULT fallback below
    // still uses the original `taskId`, so a PMS miss serves the logical
    // key's own guard-safe default (routing → v40), not the aliased task's.
    const pmsTaskId = pmsResolveTaskId(taskId);
    const store = getPromptStore();
    const compiled = await store.getCompiled(pmsTaskId, variables, {
      version,
      useStaging,
    });

    if (compiled) {
      // Check if staging version was used by comparing against prompt's activeVersion
      // If useStaging was requested and version differs from activeVersion, it's staging
      let isStaging = false;
      if (useStaging) {
        try {
          const prompt = await store.get(compiled.promptId);
          if (prompt && prompt.stagingVersion && compiled.version === prompt.stagingVersion) {
            isStaging = true;
          }
        } catch {
          // Ignore errors checking staging status
        }
      }

      emit(LoaderTelemetryEvents.PromptLoadedFromStore, {
        taskId,
        promptId: compiled.promptId,
        version: compiled.version,
        isStaging,
        correlationId,
      });

      if (isTrackedKey(taskId)) {
        emit(TelemetryEvents.V5PromptResolved, {
          key: taskId,
          source: mapSource('store'),
          version: resolvePublicVersion(
            taskId as TrackedKey,
            'store',
            compiled.version,
          ),
          content_hash: shortSha256(compiled.content),
          trigger,
          ...(cache ? { cache } : {}),
          correlationId,
        });
      }

      log.debug(
        { taskId, promptId: compiled.promptId, version: compiled.version, isStaging },
        isStaging ? 'Staging prompt loaded from store' : 'Prompt loaded from store'
      );

      return {
        content: compiled.content,
        source: 'store',
        promptId: compiled.promptId,
        version: compiled.version,
        isStaging,
        modelConfig: compiled.modelConfig,
      };
    }

    // No managed prompt found, fall back to default
    log.debug({ taskId }, 'No managed prompt found, using default');
    return loadDefaultPrompt(taskId, variables, correlationId, trigger, cache, 'not_found');
  } catch (error) {
    // Error loading from store, fall back to default
    log.warn(
      { taskId, error, correlationId },
      'Error loading prompt from store, falling back to default'
    );

    emit(LoaderTelemetryEvents.PromptLoadError, {
      taskId,
      error: String(error),
      correlationId,
    });

    return loadDefaultPrompt(taskId, variables, correlationId, trigger, cache, 'fetch_error');
  }
}

/**
 * Load the default (hardcoded) prompt for a task
 */
function loadDefaultPrompt(
  taskId: CeeTaskId,
  variables: Record<string, string | number>,
  correlationId?: string,
  trigger: PromptResolveTrigger = 'runtime',
  cache?: 'hit' | 'miss',
  reason: FallbackReason = 'none'
): LoadedPrompt {
  const defaultContent = getRegisteredDefaultPrompt(taskId);

  if (!defaultContent) {
    throw new Error(`No default prompt registered for task: ${taskId}`);
  }

  // Interpolate variables into default prompt
  const content = interpolatePrompt(defaultContent, variables);

  emit(LoaderTelemetryEvents.PromptLoadedFromDefault, {
    taskId,
    correlationId,
  });

  if (isTrackedKey(taskId)) {
    emit(TelemetryEvents.V5PromptResolved, {
      key: taskId,
      source: mapSource('default'),
      version: resolvePublicVersion(taskId as TrackedKey, 'default', undefined),
      content_hash: shortSha256(content),
      trigger,
      ...(cache ? { cache } : {}),
      correlationId,
    });
  }

  return {
    content,
    source: 'default',
    fallbackReason: reason,
  };
}

/**
 * Synchronous version for backward compatibility
 * Only uses default prompts (no store access)
 */
export function loadPromptSync(
  taskId: CeeTaskId,
  variables: Record<string, string | number> = {}
): string {
  const defaultContent = getRegisteredDefaultPrompt(taskId);

  if (!defaultContent) {
    throw new Error(`No default prompt registered for task: ${taskId}`);
  }

  return interpolatePrompt(defaultContent, variables);
}

/**
 * Check if a task has a managed prompt available
 */
export async function hasManagedPrompt(taskId: CeeTaskId): Promise<boolean> {
  if (!isPromptManagementEnabled()) {
    return false;
  }

  try {
    const store = getPromptStore();
    const result = await store.getActivePromptForTask(taskId);
    return result !== null;
  } catch {
    return false;
  }
}
