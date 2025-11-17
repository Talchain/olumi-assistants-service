/**
 * LRU + TTL Cache Tests
 *
 * Verifies LRU eviction, TTL expiration, and O(1) operations for the cache module.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LruTtlCache } from "../../src/utils/cache.js";

describe("LruTtlCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("should create cache with valid capacity and TTL", () => {
    const cache = new LruTtlCache<string, number>(10, 1000);
    expect(cache.stats()).toEqual({
      size: 0,
      capacity: 10,
      ttlMs: 1000,
    });
  });

  it("should throw error for invalid capacity", () => {
    expect(() => new LruTtlCache<string, number>(0, 1000)).toThrow("capacity must be > 0");
    expect(() => new LruTtlCache<string, number>(-1, 1000)).toThrow("capacity must be > 0");
  });

  it("should throw error for invalid TTL", () => {
    expect(() => new LruTtlCache<string, number>(10, 0)).toThrow("TTL must be > 0");
    expect(() => new LruTtlCache<string, number>(10, -1)).toThrow("TTL must be > 0");
  });

  it("should set and get values", () => {
    const cache = new LruTtlCache<string, number>(10, 60000);
    cache.set("key1", 42);
    expect(cache.get("key1")).toBe(42);
  });

  it("should return undefined for missing keys", () => {
    const cache = new LruTtlCache<string, number>(10, 60000);
    expect(cache.get("nonexistent")).toBeUndefined();
  });

  it("should update existing keys (move to end)", () => {
    const cache = new LruTtlCache<string, number>(10, 60000);
    cache.set("key1", 1);
    cache.set("key2", 2);
    cache.set("key1", 10); // Update - should move to end

    expect(cache.get("key1")).toBe(10);
    expect(cache.size).toBe(2);
  });

  it("should expire entries after TTL", () => {
    const cache = new LruTtlCache<string, string>(10, 1000); // 1 second TTL
    cache.set("key1", "value1");

    // Immediately accessible
    expect(cache.get("key1")).toBe("value1");

    // Advance time by 500ms (within TTL)
    vi.advanceTimersByTime(500);
    expect(cache.get("key1")).toBe("value1");

    // Advance time by another 600ms (total 1100ms > TTL)
    vi.advanceTimersByTime(600);
    expect(cache.get("key1")).toBeUndefined();
  });

  it("should call eviction callback on TTL expiration", () => {
    const evicted: Array<{ key: string; value: string; reason: string }> = [];
    const callback = vi.fn((key, value, reason) => {
      evicted.push({ key, value, reason });
    });

    const cache = new LruTtlCache<string, string>(10, 1000, callback);
    cache.set("key1", "value1");

    // Expire entry
    vi.advanceTimersByTime(1100);
    cache.get("key1"); // Triggers expiration check

    expect(callback).toHaveBeenCalledWith("key1", "value1", "ttl");
    expect(evicted).toEqual([{ key: "key1", value: "value1", reason: "ttl" }]);
  });

  it("should evict LRU entry when at capacity", () => {
    const cache = new LruTtlCache<string, number>(3, 60000); // Capacity 3
    cache.set("key1", 1);
    cache.set("key2", 2);
    cache.set("key3", 3);

    expect(cache.size).toBe(3);

    // Add 4th entry - should evict key1 (LRU)
    cache.set("key4", 4);

    expect(cache.size).toBe(3);
    expect(cache.get("key1")).toBeUndefined(); // Evicted
    expect(cache.get("key2")).toBe(2);
    expect(cache.get("key3")).toBe(3);
    expect(cache.get("key4")).toBe(4);
  });

  it("should call eviction callback on LRU eviction", () => {
    const callback = vi.fn();
    const cache = new LruTtlCache<string, number>(2, 60000, callback);

    cache.set("key1", 1);
    cache.set("key2", 2);
    cache.set("key3", 3); // Evicts key1

    expect(callback).toHaveBeenCalledWith("key1", 1, "lru");
  });

  it("should update LRU order on get", () => {
    const cache = new LruTtlCache<string, number>(3, 60000);
    cache.set("key1", 1);
    cache.set("key2", 2);
    cache.set("key3", 3);

    // Access key1 - moves it to end (most recently used)
    cache.get("key1");

    // Add key4 - should evict key2 (now LRU)
    cache.set("key4", 4);

    expect(cache.get("key2")).toBeUndefined(); // Evicted
    expect(cache.get("key1")).toBe(1); // Preserved (accessed recently)
    expect(cache.get("key3")).toBe(3);
    expect(cache.get("key4")).toBe(4);
  });

  it("should support has() method", () => {
    const cache = new LruTtlCache<string, number>(10, 60000);
    cache.set("key1", 42);

    expect(cache.has("key1")).toBe(true);
    expect(cache.has("nonexistent")).toBe(false);
  });

  it("should support delete() method", () => {
    const cache = new LruTtlCache<string, number>(10, 60000);
    cache.set("key1", 42);

    expect(cache.delete("key1")).toBe(true);
    expect(cache.get("key1")).toBeUndefined();
    expect(cache.delete("key1")).toBe(false); // Already deleted
  });

  it("should support clear() method", () => {
    const cache = new LruTtlCache<string, number>(10, 60000);
    cache.set("key1", 1);
    cache.set("key2", 2);
    cache.set("key3", 3);

    expect(cache.size).toBe(3);

    cache.clear();

    expect(cache.size).toBe(0);
    expect(cache.get("key1")).toBeUndefined();
    expect(cache.get("key2")).toBeUndefined();
    expect(cache.get("key3")).toBeUndefined();
  });

  it("should cleanup expired entries", () => {
    const callback = vi.fn();
    const cache = new LruTtlCache<string, number>(10, 1000, callback);

    cache.set("key1", 1);
    cache.set("key2", 2);
    cache.set("key3", 3);

    // Expire some entries
    vi.advanceTimersByTime(1100);

    const cleaned = cache.cleanup();

    expect(cleaned).toBe(3); // All 3 expired
    expect(cache.size).toBe(0);
    expect(callback).toHaveBeenCalledTimes(3);
  });

  it("should handle mixed TTLs during cleanup", () => {
    const cache = new LruTtlCache<string, number>(10, 1000);

    cache.set("key1", 1);
    vi.advanceTimersByTime(600); // key1 at 600ms

    cache.set("key2", 2); // key2 at 600ms (will expire at 1600ms)
    vi.advanceTimersByTime(500); // Now at 1100ms - key1 should be expired

    const cleaned = cache.cleanup();

    expect(cleaned).toBe(1); // Only key1 expired
    expect(cache.get("key1")).toBeUndefined();
    expect(cache.get("key2")).toBe(2); // Still valid
  });

  it("should handle capacity of 1", () => {
    const cache = new LruTtlCache<string, number>(1, 60000);

    cache.set("key1", 1);
    expect(cache.get("key1")).toBe(1);

    cache.set("key2", 2);
    expect(cache.get("key1")).toBeUndefined(); // Evicted
    expect(cache.get("key2")).toBe(2);
  });

  it("should handle large capacity", () => {
    const cache = new LruTtlCache<string, number>(1000, 60000);

    for (let i = 0; i < 1000; i++) {
      cache.set(`key${i}`, i);
    }

    expect(cache.size).toBe(1000);

    // All accessible
    for (let i = 0; i < 1000; i++) {
      expect(cache.get(`key${i}`)).toBe(i);
    }

    // Adding 1001st entry evicts first
    cache.set("key1000", 1000);
    expect(cache.get("key0")).toBeUndefined();
    expect(cache.get("key1000")).toBe(1000);
    expect(cache.size).toBe(1000);
  });

  it("should handle complex value types", () => {
    interface CacheValue {
      name: string;
      count: number;
    }

    const cache = new LruTtlCache<string, CacheValue>(10, 60000);
    const value: CacheValue = { name: "test", count: 42 };

    cache.set("key1", value);

    const retrieved = cache.get("key1");
    expect(retrieved).toEqual(value);
    expect(retrieved?.name).toBe("test");
    expect(retrieved?.count).toBe(42);
  });

  it("should maintain insertion order for LRU", () => {
    const evicted: string[] = [];
    const callback = vi.fn((key) => evicted.push(key));
    const cache = new LruTtlCache<string, number>(3, 60000, callback);

    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);

    // Should evict in insertion order when full
    cache.set("d", 4); // Evicts a
    cache.set("e", 5); // Evicts b
    cache.set("f", 6); // Evicts c

    expect(evicted).toEqual(["a", "b", "c"]);
  });
});
