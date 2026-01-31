/**
 * Public Prompt Routes
 *
 * Provides endpoints for frontend prompt management operations
 * that don't require admin authentication.
 *
 * Routes:
 * - POST /v1/prompts/warm - Warm prompt cache from Supabase store
 * - GET  /v1/prompts/status - Get prompt cache status
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  warmPromptCacheFromStore,
  getPromptLoaderCacheDiagnostics,
  getCacheWarmingState,
  isCacheWarmingHealthy,
  getSystemPromptMeta,
} from '../adapters/llm/prompt-loader.js';
import { isPromptStoreHealthy } from '../prompts/index.js';
import { shouldUseStagingPrompts } from '../config/index.js';
import { log, emit } from '../utils/telemetry.js';

/**
 * Telemetry events for prompt warming
 */
const PromptWarmingEvents = {
  WarmRequested: 'prompt.warm.requested',
  WarmCompleted: 'prompt.warm.completed',
  WarmFailed: 'prompt.warm.failed',
  StatusChecked: 'prompt.status.checked',
} as const;

export async function publicPromptRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /v1/prompts/warm - Warm prompt cache from Supabase store
   *
   * This endpoint allows the frontend to proactively warm the prompt cache
   * before the user submits their first decision brief. This ensures that:
   * 1. Prompts are loaded from Supabase (not hardcoded defaults)
   * 2. The first draft-graph request doesn't have cold-start latency
   * 3. Frontend can verify which prompts loaded successfully
   *
   * Call this endpoint when:
   * - Frontend app initializes
   * - User logs in
   * - After extended idle period (> 5 minutes)
   *
   * Response includes detailed status for each CEE task showing whether
   * the prompt came from the Supabase store or fell back to defaults.
   */
  app.post('/v1/prompts/warm', async (request: FastifyRequest, reply: FastifyReply) => {
    const startTime = Date.now();

    emit(PromptWarmingEvents.WarmRequested, {
      client_ip: request.ip,
      user_agent: request.headers['user-agent'],
    });

    // Check if store is healthy
    const storeHealthy = isPromptStoreHealthy();
    if (!storeHealthy) {
      log.warn('Prompt warming requested but store is not healthy');
      emit(PromptWarmingEvents.WarmFailed, {
        reason: 'store_not_healthy',
        duration_ms: Date.now() - startTime,
      });

      return reply.status(503).send({
        success: false,
        error: 'store_not_healthy',
        message: 'Prompt store is not available. Using hardcoded defaults.',
        store_healthy: false,
      });
    }

    try {
      // Warm all prompts from store
      const result = await warmPromptCacheFromStore();
      const durationMs = Date.now() - startTime;

      // Get detailed cache status
      const cacheStatus = getPromptLoaderCacheDiagnostics();
      const usingStaging = shouldUseStagingPrompts();

      emit(PromptWarmingEvents.WarmCompleted, {
        warmed_from_store: result.warmed,
        fell_back_to_defaults: result.skipped,
        failed: result.failed,
        used_staging: result.usedStaging,
        duration_ms: durationMs,
      });

      log.info({
        warmed: result.warmed,
        skipped: result.skipped,
        failed: result.failed,
        usedStaging: result.usedStaging,
        duration_ms: durationMs,
      }, 'Prompt cache warmed via API request');

      // Build per-task status
      const taskStatus = cacheStatus.entries.map(entry => ({
        task_id: entry.taskId,
        source: entry.source,
        prompt_id: entry.promptId,
        version: entry.version,
        is_staging: entry.isStaging,
        age_ms: entry.ageMs,
        status: entry.status,
      }));

      return reply.status(200).send({
        success: true,
        summary: {
          total_tasks: result.warmed + result.skipped + result.failed,
          loaded_from_store: result.warmed,
          fell_back_to_defaults: result.skipped,
          failed: result.failed,
          used_staging_versions: result.usedStaging,
        },
        environment: {
          using_staging_prompts: usingStaging,
          store_healthy: storeHealthy,
        },
        tasks: taskStatus,
        duration_ms: durationMs,
      });
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      emit(PromptWarmingEvents.WarmFailed, {
        reason: 'exception',
        error: errorMessage,
        duration_ms: durationMs,
      });

      log.error({ error: errorMessage }, 'Prompt warming failed');

      return reply.status(500).send({
        success: false,
        error: 'warm_failed',
        message: errorMessage,
        duration_ms: durationMs,
      });
    }
  });

  /**
   * GET /v1/prompts/status - Get prompt cache status
   *
   * Returns the current state of the prompt cache without triggering a refresh.
   * Use this to check if prompts are loaded and from what source.
   *
   * Response includes:
   * - Cache warming state (completed, counts)
   * - Per-task prompt status (source, version, age)
   * - Whether staging prompts are enabled
   */
  app.get('/v1/prompts/status', async (request: FastifyRequest, reply: FastifyReply) => {
    emit(PromptWarmingEvents.StatusChecked, {
      client_ip: request.ip,
    });

    const warmingState = getCacheWarmingState();
    const cacheStatus = getPromptLoaderCacheDiagnostics();
    const storeHealthy = isPromptStoreHealthy();
    const usingStaging = shouldUseStagingPrompts();
    const cacheHealthy = isCacheWarmingHealthy();

    // Build per-task status with model config info
    const taskStatus = cacheStatus.entries.map(entry => {
      const meta = getSystemPromptMeta(entry.taskId);
      return {
        task_id: entry.taskId,
        source: entry.source,
        prompt_id: entry.promptId,
        version: entry.version,
        is_staging: entry.isStaging,
        age_ms: entry.ageMs,
        status: entry.status,
        model_config: meta.modelConfig,
      };
    });

    return reply.status(200).send({
      cache_warming: {
        completed: warmingState.completed,
        completed_at: warmingState.completedAt,
        warmed_from_store: warmingState.warmedFromStore,
        failed_count: warmingState.failedCount,
        skipped_count: warmingState.skippedCount,
        healthy: cacheHealthy,
      },
      environment: {
        using_staging_prompts: usingStaging,
        store_healthy: storeHealthy,
      },
      cache: {
        size: cacheStatus.cacheSize,
        tasks: taskStatus,
      },
    });
  });
}
