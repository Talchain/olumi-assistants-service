/**
 * Prompt Caching Adapter - Dual-mode Cache (Redis + LRU fallback) for LLM Responses
 *
 * Wraps any LLMAdapter to cache responses and avoid redundant API calls.
 *
 * Features:
 * - Dual-mode storage: Redis (production) or LRU (fallback/dev)
 * - TTL-based expiration for stale entries
 * - Per-operation caching (draft_graph, suggest_options, etc.)
 * - Telemetry for hits/misses/evictions
 * - Environment-driven configuration:
 *   - PROMPT_CACHE_ENABLED: Enable/disable caching (default: false)
 *   - REDIS_PROMPT_CACHE_ENABLED: Use Redis backend (default: false, requires REDIS_URL)
 *   - PROMPT_CACHE_MAX_SIZE: Max LRU entries (default: 100, only for memory mode)
 *   - PROMPT_CACHE_TTL_MS: Entry TTL in milliseconds (default: 3600000 = 1 hour)
 *
 * Redis key pattern: pc:{operation}:{hash16}
 * Note: Streaming responses are NOT cached (bypasses cache)
 */

import { LruTtlCache } from "../../utils/cache.js";
import { emit, TelemetryEvents, log } from "../../utils/telemetry.js";
import { fastHash } from "../../utils/hash.js";
import { getRedis } from "../../platform/redis.js";
import type {
  LLMAdapter,
  DraftGraphArgs,
  DraftGraphResult,
  SuggestOptionsArgs,
  SuggestOptionsResult,
  ExplainDiffArgs,
  ExplainDiffResult,
  RepairGraphArgs,
  RepairGraphResult,
  ClarifyBriefArgs,
  ClarifyBriefResult,
  CritiqueGraphArgs,
  CritiqueGraphResult,
  CallOpts,
  DraftStreamEvent,
} from "./types.js";

// Cache configuration helpers (read dynamically for testability)
function getCacheEnabled(): boolean {
  return process.env.PROMPT_CACHE_ENABLED === "true";
}

function getRedisCacheEnabled(): boolean {
  return process.env.REDIS_PROMPT_CACHE_ENABLED === "true";
}

function getCacheMaxSize(): number {
  return Number(process.env.PROMPT_CACHE_MAX_SIZE) || 100;
}

function getCacheTtlMs(): number {
  return Number(process.env.PROMPT_CACHE_TTL_MS) || 3600000; // 1 hour default
}

/**
 * Caching adapter that wraps an LLM adapter with dual-mode cache (Redis + LRU fallback)
 */
export class CachingAdapter implements LLMAdapter {
  readonly name: string;
  readonly model: string;
  private readonly cache: LruTtlCache<string, any>;
  private readonly enabled: boolean;
  private readonly redisEnabled: boolean;

  constructor(private readonly adapter: LLMAdapter) {
    // Preserve original adapter name to avoid breaking downstream routing
    this.name = adapter.name;
    this.model = adapter.model;
    this.enabled = getCacheEnabled();
    this.redisEnabled = getRedisCacheEnabled();

    // Create LRU cache as fallback (always initialized, used when Redis unavailable)
    this.cache = new LruTtlCache(
      getCacheMaxSize(),
      getCacheTtlMs(),
      (key, value, reason) => {
        emit(TelemetryEvents.PromptCacheEviction, {
          key_hash: fastHash(key, 8),
          reason,
          provider: adapter.name,
          backend: "memory",
        });

        log.debug(
          { key_hash: fastHash(key, 8), reason, cache_size: this.cache.size },
          "Prompt cache eviction (memory)"
        );
      }
    );

    log.info(
      {
        provider: adapter.name,
        enabled: this.enabled,
        redis_enabled: this.redisEnabled,
        max_size: getCacheMaxSize(),
        ttl_ms: getCacheTtlMs(),
      },
      "Prompt caching adapter initialized"
    );
  }

  /**
   * Generate cache key from operation and args
   * Uses canonical JSON to ensure stable keys regardless of property order
   *
   * Key pattern: pc:{operation}:{hash16}
   * (Redis keyPrefix will prepend namespace, e.g., "olumi:pc:draft_graph:a3f5c7d1...")
   */
  private getCacheKey(operation: string, args: any): string {
    // Create deterministic key from operation + args + model
    // Use sorted replacer to ensure consistent cache keys even with different property order
    const sortedReplacer = (_key: string, value: any) => {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return Object.keys(value)
          .sort()
          .reduce((sorted: any, key) => {
            sorted[key] = value[key];
            return sorted;
          }, {});
      }
      return value;
    };

    const keyData = JSON.stringify({ operation, args, model: this.model }, sortedReplacer);
    const hash = fastHash(keyData, 16);

    // Redis key pattern: pc:{operation}:{hash16}
    return `pc:${operation}:${hash}`;
  }

  /**
   * Execute operation with caching (dual-mode: Redis + LRU fallback)
   */
  private async withCache<T>(
    operation: string,
    args: any,
    opts: CallOpts,
    fn: () => Promise<T>
  ): Promise<T> {
    // Check bypass flag first (before checking enabled)
    if (opts.bypassCache) {
      // Don't emit telemetry for explicit bypass (low signal)
      return fn();
    }

    // Skip cache if disabled (don't emit telemetry to avoid noise)
    if (!this.enabled) {
      return fn();
    }

    const cacheKey = this.getCacheKey(operation, args);

    // Try Redis first if enabled
    if (this.redisEnabled) {
      const redis = await getRedis();

      if (redis) {
        try {
          // Try Redis get
          const redisValue = await redis.get(cacheKey);

          if (redisValue) {
            // Redis hit
            emit(TelemetryEvents.PromptCacheHit, {
              operation,
              provider: this.adapter.name,
              backend: "redis",
            });

            // Deep clone to prevent mutation leakage
            return JSON.parse(redisValue);
          }

          // Redis miss - call underlying adapter
          emit(TelemetryEvents.PromptCacheMiss, {
            operation,
            provider: this.adapter.name,
            backend: "redis",
          });

          const result = await fn();

          // Store in Redis with TTL (deep clone to prevent mutations)
          const ttlSeconds = Math.max(1, Math.floor(getCacheTtlMs() / 1000));
          await redis.set(
            cacheKey,
            JSON.stringify(result),
            "EX",
            ttlSeconds
          );

          log.debug(
            { operation, key_hash: fastHash(cacheKey, 8), ttl_seconds: ttlSeconds },
            "Prompt cache stored in Redis"
          );

          return result;
        } catch (error) {
          // Redis error - fall through to LRU cache
          log.warn(
            { error, operation, key_hash: fastHash(cacheKey, 8) },
            "Redis cache error, falling back to memory"
          );
        }
      }
    }

    // Fallback to LRU cache (either Redis disabled or Redis unavailable/error)
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) {
      // LRU hit
      emit(TelemetryEvents.PromptCacheHit, {
        operation,
        provider: this.adapter.name,
        backend: "memory",
      });

      // Deep clone to prevent mutation leakage
      return JSON.parse(JSON.stringify(cached));
    }

    // LRU miss - call underlying adapter
    emit(TelemetryEvents.PromptCacheMiss, {
      operation,
      provider: this.adapter.name,
      backend: "memory",
    });

    const result = await fn();

    // Store in LRU cache (deep clone to prevent mutations from affecting cache)
    this.cache.set(cacheKey, JSON.parse(JSON.stringify(result)));

    return result;
  }

  async draftGraph(args: DraftGraphArgs, opts: CallOpts): Promise<DraftGraphResult> {
    return this.withCache("draft_graph", args, opts, () => this.adapter.draftGraph(args, opts));
  }

  async suggestOptions(
    args: SuggestOptionsArgs,
    opts: CallOpts
  ): Promise<SuggestOptionsResult> {
    return this.withCache("suggest_options", args, opts, () =>
      this.adapter.suggestOptions(args, opts)
    );
  }

  async repairGraph(args: RepairGraphArgs, opts: CallOpts): Promise<RepairGraphResult> {
    return this.withCache("repair_graph", args, opts, () => this.adapter.repairGraph(args, opts));
  }

  async clarifyBrief(args: ClarifyBriefArgs, opts: CallOpts): Promise<ClarifyBriefResult> {
    return this.withCache("clarify_brief", args, opts, () =>
      this.adapter.clarifyBrief(args, opts)
    );
  }

  async critiqueGraph(args: CritiqueGraphArgs, opts: CallOpts): Promise<CritiqueGraphResult> {
    return this.withCache("critique_graph", args, opts, () =>
      this.adapter.critiqueGraph(args, opts)
    );
  }

  async explainDiff(args: ExplainDiffArgs, opts: CallOpts): Promise<ExplainDiffResult> {
    return this.withCache("explain_diff", args, opts, () => this.adapter.explainDiff(args, opts));
  }

  /**
   * Stream support - delegates to underlying adapter (NOT cached)
   * Streaming responses cannot be cached due to their progressive nature
   */
  async *streamDraftGraph(
    args: DraftGraphArgs,
    opts: CallOpts
  ): AsyncIterable<DraftStreamEvent> {
    if (!this.adapter.streamDraftGraph) {
      throw new Error(`Adapter ${this.adapter.name} does not support streaming`);
    }

    // Always bypass cache for streaming
    yield* this.adapter.streamDraftGraph(args, opts);
  }

  /**
   * Get cache statistics
   */
  stats(): {
    size: number;
    capacity: number;
    ttlMs: number;
    enabled: boolean;
    backend: "redis" | "memory";
  } {
    return {
      ...this.cache.stats(),
      enabled: this.enabled,
      backend: this.redisEnabled ? "redis" : "memory",
    };
  }

  /**
   * Clear cache (for testing/debugging)
   * Clears both Redis and LRU cache
   */
  async clearCache(): Promise<void> {
    // Clear LRU cache
    this.cache.clear();

    // Clear Redis cache if enabled
    if (this.redisEnabled) {
      const redis = await getRedis();
      if (redis) {
        try {
          // Scan for all prompt cache keys and delete
          let cursor = "0";
          let totalDeleted = 0;

          do {
            const [newCursor, keys] = await redis.scan(
              cursor,
              "MATCH",
              "pc:*",
              "COUNT",
              100
            );
            cursor = newCursor;

            if (keys.length > 0) {
              await redis.del(...keys);
              totalDeleted += keys.length;
            }
          } while (cursor !== "0");

          log.info(
            { provider: this.adapter.name, deleted: totalDeleted },
            "Prompt cache cleared (Redis)"
          );
        } catch (error) {
          log.error({ error }, "Failed to clear Redis prompt cache");
        }
      }
    }

    log.info({ provider: this.adapter.name }, "Prompt cache cleared");
  }
}

/**
 * Wrap an adapter with caching if enabled
 * Returns the original adapter if caching is disabled
 */
export function withCaching(adapter: LLMAdapter): LLMAdapter {
  if (!getCacheEnabled()) {
    return adapter;
  }
  return new CachingAdapter(adapter);
}
