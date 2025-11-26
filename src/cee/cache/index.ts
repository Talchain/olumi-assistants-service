/**
 * Response Caching Layer for CEE Draft Graph
 *
 * Provides in-memory caching for draft-graph responses to reduce
 * redundant LLM calls for identical or similar briefs.
 */

import { config } from "../../config/index.js";

// ============================================================================
// Types
// ============================================================================

export interface CacheEntry<T> {
  value: T;
  timestamp: number;
  expiresAt: number;
  hits: number;
}

export interface CacheStats {
  size: number;
  hits: number;
  misses: number;
  evictions: number;
  hitRate: number;
}

// ============================================================================
// Cache Implementation
// ============================================================================

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 100; // Maximum entries to prevent memory bloat

class ResponseCache<T> {
  private cache: Map<string, CacheEntry<T>> = new Map();
  private stats = { hits: 0, misses: 0, evictions: 0 };

  constructor(
    private readonly ttlMs: number = DEFAULT_TTL_MS,
    private readonly maxSize: number = MAX_CACHE_SIZE
  ) {}

  /**
   * Normalize a brief for cache key generation
   * Removes extra whitespace, lowercases, and trims
   */
  private normalizeKey(brief: string): string {
    return brief
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * Generate a cache key from brief and optional context
   */
  generateKey(brief: string, context?: Record<string, unknown>): string {
    const normalized = this.normalizeKey(brief);
    if (context && Object.keys(context).length > 0) {
      const contextHash = JSON.stringify(context);
      return `${normalized}::${contextHash}`;
    }
    return normalized;
  }

  /**
   * Get a value from cache if it exists and hasn't expired
   */
  get(key: string): T | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      return undefined;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.stats.misses++;
      this.stats.evictions++;
      return undefined;
    }

    entry.hits++;
    this.stats.hits++;
    return entry.value;
  }

  /**
   * Store a value in the cache
   */
  set(key: string, value: T, ttlMs?: number): void {
    // Evict oldest entries if at capacity
    if (this.cache.size >= this.maxSize) {
      this.evictOldest();
    }

    const now = Date.now();
    this.cache.set(key, {
      value,
      timestamp: now,
      expiresAt: now + (ttlMs ?? this.ttlMs),
      hits: 0,
    });
  }

  /**
   * Check if a key exists and is not expired
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.stats.evictions++;
      return false;
    }
    return true;
  }

  /**
   * Remove a specific key from cache
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * Clear all entries from cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const totalRequests = this.stats.hits + this.stats.misses;
    return {
      size: this.cache.size,
      hits: this.stats.hits,
      misses: this.stats.misses,
      evictions: this.stats.evictions,
      hitRate: totalRequests > 0 ? this.stats.hits / totalRequests : 0,
    };
  }

  /**
   * Evict oldest entries when cache is full
   */
  private evictOldest(): void {
    let oldestKey: string | undefined;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.stats.evictions++;
    }
  }

  /**
   * Remove all expired entries
   */
  prune(): number {
    const now = Date.now();
    let pruned = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        pruned++;
        this.stats.evictions++;
      }
    }

    return pruned;
  }
}

// ============================================================================
// Singleton Instance for Draft Graph Responses
// ============================================================================

let draftGraphCache: ResponseCache<unknown> | null = null;

/**
 * Get the draft graph response cache instance
 */
export function getDraftGraphCache(): ResponseCache<unknown> {
  if (!draftGraphCache) {
    const ttlMs = config.cee.cacheResponseTtlMs ?? DEFAULT_TTL_MS;
    const maxSize = config.cee.cacheResponseMaxSize ?? MAX_CACHE_SIZE;
    draftGraphCache = new ResponseCache(ttlMs, maxSize);
  }
  return draftGraphCache;
}

/**
 * Check if response caching is enabled
 */
export function isCachingEnabled(): boolean {
  return config.cee.cacheResponseEnabled ?? false;
}

/**
 * Reset the cache (for testing or config changes)
 */
export function resetCache(): void {
  if (draftGraphCache) {
    draftGraphCache.clear();
  }
  draftGraphCache = null;
}

/**
 * Get or compute a cached response
 */
export async function getOrCompute<T>(
  brief: string,
  context: Record<string, unknown> | undefined,
  compute: () => Promise<T>
): Promise<{ value: T; cached: boolean }> {
  if (!isCachingEnabled()) {
    return { value: await compute(), cached: false };
  }

  const cache = getDraftGraphCache();
  const key = cache.generateKey(brief, context);

  const cached = cache.get(key) as T | undefined;
  if (cached !== undefined) {
    return { value: cached, cached: true };
  }

  const value = await compute();
  cache.set(key, value);
  return { value, cached: false };
}

// Export for testing
export const __test_only = {
  ResponseCache,
  DEFAULT_TTL_MS,
  MAX_CACHE_SIZE,
};
