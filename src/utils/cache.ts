/**
 * Generic LRU + TTL Cache
 *
 * Features:
 * - LRU eviction when capacity is reached
 * - TTL-based expiration for stale entries
 * - O(1) get/set operations
 * - Automatic cleanup of expired entries
 *
 * Usage:
 * ```typescript
 * const cache = new LruTtlCache<string, Response>(100, 3600000); // 100 entries, 1 hour TTL
 * cache.set('key', value);
 * const result = cache.get('key'); // Returns value or undefined if expired/missing
 * ```
 */

interface CacheEntry<V> {
  value: V;
  expiresAt: number;
}

export class LruTtlCache<K, V> {
  private readonly capacity: number;
  private readonly ttlMs: number;
  private cache: Map<K, CacheEntry<V>>;
  private evictionCallback?: (key: K, value: V, reason: 'lru' | 'ttl') => void;

  /**
   * Create a new LRU + TTL cache
   *
   * @param capacity - Maximum number of entries (LRU eviction when full)
   * @param ttlMs - Time to live in milliseconds (entries expire after this duration)
   * @param evictionCallback - Optional callback when entries are evicted
   */
  constructor(
    capacity: number,
    ttlMs: number,
    evictionCallback?: (key: K, value: V, reason: 'lru' | 'ttl') => void
  ) {
    if (capacity <= 0) {
      throw new Error('Cache capacity must be > 0');
    }
    if (ttlMs <= 0) {
      throw new Error('Cache TTL must be > 0');
    }

    this.capacity = capacity;
    this.ttlMs = ttlMs;
    this.cache = new Map();
    this.evictionCallback = evictionCallback;
  }

  /**
   * Get value from cache (returns undefined if missing or expired)
   */
  get(key: K): V | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      return undefined;
    }

    // Check TTL expiration
    if (Date.now() > entry.expiresAt) {
      // Expired - remove and notify
      this.cache.delete(key);
      this.evictionCallback?.(key, entry.value, 'ttl');
      return undefined;
    }

    // Move to end (most recently used) by deleting and re-inserting
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.value;
  }

  /**
   * Set value in cache (evicts LRU entry if at capacity)
   */
  set(key: K, value: V): void {
    // Remove existing entry if present (to update position)
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // Evict LRU entry if at capacity
    if (this.cache.size >= this.capacity) {
      const lruKeyIter = this.cache.keys().next();
      if (!lruKeyIter.done && lruKeyIter.value !== undefined) {
        const lruKey = lruKeyIter.value;
        const lruEntry = this.cache.get(lruKey);
        this.cache.delete(lruKey);

        if (lruEntry) {
          this.evictionCallback?.(lruKey, lruEntry.value, 'lru');
        }
      }
    }

    // Add new entry (at end = most recently used)
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  /**
   * Check if key exists and is not expired
   */
  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  /**
   * Remove entry from cache
   */
  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  /**
   * Clear all entries from cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get current cache size (includes expired entries until accessed)
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Get cache statistics
   */
  stats(): { size: number; capacity: number; ttlMs: number } {
    return {
      size: this.cache.size,
      capacity: this.capacity,
      ttlMs: this.ttlMs,
    };
  }

  /**
   * Clean up expired entries (optional periodic maintenance)
   */
  cleanup(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        this.evictionCallback?.(key, entry.value, 'ttl');
        cleaned++;
      }
    }

    return cleaned;
  }
}
