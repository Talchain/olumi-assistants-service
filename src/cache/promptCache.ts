import { env } from "node:process";
import { log, emit, TelemetryEvents } from "../utils/telemetry.js";
import type { DraftGraphOutput } from "../schemas/assist.js";
import type { CacheKeyShape } from "./cacheKey.js";

/**
 * Cache entry with TTL and metadata
 */
interface CacheEntry {
  /** Cached draft-graph response payload */
  payload: ReturnType<typeof DraftGraphOutput.parse>;

  /** Timestamp when entry was created (ms since epoch) */
  createdAt: number;

  /** Cache key shape for debugging */
  keyShape: CacheKeyShape;

  /** Provider and model used for this draft */
  provider: string;
  model: string;

  /** Cost saved by cache hit */
  costUsd: number;
}

/**
 * LRU cache with TTL for draft-graph responses.
 *
 * Features:
 * - LRU eviction policy (configurable max size)
 * - TTL expiry (configurable, default 15 minutes)
 * - Thread-safe get/put operations
 * - Telemetry hooks for hit/miss/put/evict events
 */
export class PromptCache {
  private cache: Map<string, CacheEntry>;
  private readonly maxSize: number;
  private readonly ttlMs: number;

  /**
   * Create new prompt cache.
   *
   * @param maxSize Maximum number of entries (default: 1000)
   * @param ttlMs Time-to-live in milliseconds (default: 15 minutes)
   */
  constructor(
    maxSize = Number(env.CACHE_MAX_SIZE) || 1000,
    ttlMs = Number(env.CACHE_TTL_MS) || 15 * 60 * 1000 // 15 minutes default
  ) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;

    log.info(
      { max_size: maxSize, ttl_ms: ttlMs, ttl_minutes: Math.round(ttlMs / 60000) },
      "Prompt cache initialized"
    );
  }

  /**
   * Get cached entry by key.
   * Returns undefined if not found or expired.
   *
   * Emits telemetry:
   * - assist.cache.hit (if found and not expired)
   * - assist.cache.miss (if not found or expired)
   */
  get(cacheKey: string, correlationId: string): CacheEntry["payload"] | undefined {
    const entry = this.cache.get(cacheKey);

    // Cache miss - not found
    if (!entry) {
      emit(TelemetryEvents.CacheHit, {
        hit: false,
        reason: "not_found",
        cache_key: cacheKey.substring(0, 12),
        correlation_id: correlationId,
      });
      return undefined;
    }

    // Check TTL expiry
    const now = Date.now();
    const ageMs = now - entry.createdAt;
    const isExpired = ageMs > this.ttlMs;

    if (isExpired) {
      // Expired - remove and return miss
      this.cache.delete(cacheKey);
      emit(TelemetryEvents.CacheHit, {
        hit: false,
        reason: "expired",
        cache_key: cacheKey.substring(0, 12),
        age_ms: ageMs,
        ttl_ms: this.ttlMs,
        correlation_id: correlationId,
      });
      return undefined;
    }

    // Cache hit - move to end (LRU)
    this.cache.delete(cacheKey);
    this.cache.set(cacheKey, entry);

    emit(TelemetryEvents.CacheHit, {
      hit: true,
      cache_key: cacheKey.substring(0, 12),
      age_ms: ageMs,
      provider: entry.provider,
      model: entry.model,
      cost_usd_saved: entry.costUsd,
      key_shape: entry.keyShape,
      correlation_id: correlationId,
    });

    return entry.payload;
  }

  /**
   * Store entry in cache.
   * Evicts LRU entry if cache is full.
   *
   * Emits telemetry:
   * - assist.cache.put (always)
   * - assist.cache.evict (if eviction occurred)
   */
  put(
    cacheKey: string,
    payload: CacheEntry["payload"],
    keyShape: CacheKeyShape,
    provider: string,
    model: string,
    costUsd: number,
    correlationId: string
  ): void {
    // Check if we need to evict (LRU = first entry in Map)
    let evicted = false;
    if (this.cache.size >= this.maxSize && !this.cache.has(cacheKey)) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        const evictedEntry = this.cache.get(firstKey);
        this.cache.delete(firstKey);
        evicted = true;

        emit(TelemetryEvents.CacheEvict, {
          cache_key: firstKey.substring(0, 12),
          reason: "lru",
          age_ms: evictedEntry ? Date.now() - evictedEntry.createdAt : undefined,
          correlation_id: correlationId,
        });
      }
    }

    // Add new entry (or update existing)
    const entry: CacheEntry = {
      payload,
      createdAt: Date.now(),
      keyShape,
      provider,
      model,
      costUsd,
    };

    // Remove if exists (to add at end for LRU)
    if (this.cache.has(cacheKey)) {
      this.cache.delete(cacheKey);
    }

    this.cache.set(cacheKey, entry);

    emit(TelemetryEvents.CachePut, {
      cache_key: cacheKey.substring(0, 12),
      cache_size: this.cache.size,
      evicted,
      provider,
      model,
      cost_usd: costUsd,
      key_shape: keyShape,
      correlation_id: correlationId,
    });
  }

  /**
   * Clear all cache entries.
   * Used for testing and manual cache invalidation.
   */
  clear(): void {
    const size = this.cache.size;
    this.cache.clear();
    log.info({ entries_cleared: size }, "Prompt cache cleared");
  }

  /**
   * Get current cache statistics.
   */
  getStats(): { size: number; maxSize: number; ttlMs: number } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      ttlMs: this.ttlMs,
    };
  }
}

/**
 * Global prompt cache instance (singleton).
 * Initialized on first import.
 */
export const promptCache = new PromptCache();
