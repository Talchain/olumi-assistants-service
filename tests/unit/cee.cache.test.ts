import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getDraftGraphCache,
  isCachingEnabled,
  resetCache,
  getOrCompute,
  __test_only,
} from "../../src/cee/cache/index.js";
import { cleanBaseUrl } from "../helpers/env-setup.js";

const { ResponseCache, DEFAULT_TTL_MS, MAX_CACHE_SIZE } = __test_only;

describe("CEE Response Cache", () => {
  beforeEach(async () => {
    cleanBaseUrl();
    vi.unstubAllEnvs();
    resetCache();
    const { _resetConfigCache } = await import("../../src/config/index.js");
    _resetConfigCache();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    cleanBaseUrl();
    resetCache();
    const { _resetConfigCache } = await import("../../src/config/index.js");
    _resetConfigCache();
  });

  describe("ResponseCache class", () => {
    it("stores and retrieves values", () => {
      const cache = new ResponseCache<string>();
      cache.set("key1", "value1");
      expect(cache.get("key1")).toBe("value1");
    });

    it("returns undefined for missing keys", () => {
      const cache = new ResponseCache<string>();
      expect(cache.get("missing")).toBeUndefined();
    });

    it("expires entries after TTL", async () => {
      const cache = new ResponseCache<string>(50); // 50ms TTL
      cache.set("key1", "value1");
      expect(cache.get("key1")).toBe("value1");

      await new Promise((r) => setTimeout(r, 60));
      expect(cache.get("key1")).toBeUndefined();
    });

    it("allows custom TTL per entry", async () => {
      const cache = new ResponseCache<string>(1000); // 1s default
      cache.set("short", "value", 50); // 50ms TTL
      cache.set("long", "value", 1000); // 1s TTL

      await new Promise((r) => setTimeout(r, 60));
      expect(cache.get("short")).toBeUndefined();
      expect(cache.get("long")).toBe("value");
    });

    it("evicts oldest entries when at capacity", () => {
      const cache = new ResponseCache<number>(10000, 3); // max 3 entries
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);

      // Wait a tiny bit to ensure different timestamps
      cache.set("d", 4); // Should evict "a"

      expect(cache.get("a")).toBeUndefined();
      expect(cache.get("b")).toBe(2);
      expect(cache.get("c")).toBe(3);
      expect(cache.get("d")).toBe(4);
    });

    it("normalizes cache keys", () => {
      const cache = new ResponseCache<string>();
      const key1 = cache.generateKey("  Hello   World  ");
      const key2 = cache.generateKey("hello world");
      expect(key1).toBe(key2);
    });

    it("includes context in cache key", () => {
      const cache = new ResponseCache<string>();
      const key1 = cache.generateKey("brief", { foo: "bar" });
      const key2 = cache.generateKey("brief", { foo: "baz" });
      const key3 = cache.generateKey("brief");

      expect(key1).not.toBe(key2);
      expect(key1).not.toBe(key3);
    });

    it("tracks cache statistics", () => {
      const cache = new ResponseCache<string>();
      cache.set("key1", "value1");

      cache.get("key1"); // hit
      cache.get("key1"); // hit
      cache.get("missing"); // miss

      const stats = cache.getStats();
      expect(stats.size).toBe(1);
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBeCloseTo(0.667, 2);
    });

    it("has() returns true for existing, non-expired keys", () => {
      const cache = new ResponseCache<string>();
      cache.set("key1", "value1");
      expect(cache.has("key1")).toBe(true);
      expect(cache.has("missing")).toBe(false);
    });

    it("delete() removes a specific key", () => {
      const cache = new ResponseCache<string>();
      cache.set("key1", "value1");
      cache.set("key2", "value2");

      expect(cache.delete("key1")).toBe(true);
      expect(cache.get("key1")).toBeUndefined();
      expect(cache.get("key2")).toBe("value2");
    });

    it("clear() removes all entries", () => {
      const cache = new ResponseCache<string>();
      cache.set("key1", "value1");
      cache.set("key2", "value2");

      cache.clear();
      expect(cache.get("key1")).toBeUndefined();
      expect(cache.get("key2")).toBeUndefined();
      expect(cache.getStats().size).toBe(0);
    });

    it("prune() removes expired entries", async () => {
      const cache = new ResponseCache<string>(50);
      cache.set("key1", "value1");
      cache.set("key2", "value2");

      await new Promise((r) => setTimeout(r, 60));

      const pruned = cache.prune();
      expect(pruned).toBe(2);
      expect(cache.getStats().size).toBe(0);
    });
  });

  describe("isCachingEnabled", () => {
    it("returns false by default", () => {
      expect(isCachingEnabled()).toBe(false);
    });

    it("returns true when CEE_CACHE_RESPONSE_ENABLED is true", async () => {
      process.env.CEE_CACHE_RESPONSE_ENABLED = "true";
      const { _resetConfigCache } = await import("../../src/config/index.js");
      _resetConfigCache();

      expect(isCachingEnabled()).toBe(true);
    });
  });

  describe("getDraftGraphCache", () => {
    it("returns a singleton cache instance", () => {
      const cache1 = getDraftGraphCache();
      const cache2 = getDraftGraphCache();
      expect(cache1).toBe(cache2);
    });

    it("resets cache on resetCache()", () => {
      const cache1 = getDraftGraphCache();
      cache1.set("key", "value");

      resetCache();
      const cache2 = getDraftGraphCache();

      expect(cache2.get("key")).toBeUndefined();
    });
  });

  describe("getOrCompute", () => {
    it("computes value when caching disabled", async () => {
      // Ensure caching is disabled
      delete process.env.CEE_CACHE_RESPONSE_ENABLED;
      const { _resetConfigCache } = await import("../../src/config/index.js");
      _resetConfigCache();
      resetCache();

      let computeCount = 0;
      const compute = async () => {
        computeCount++;
        return { data: "computed" };
      };

      const result1 = await getOrCompute("disabled-test-brief", undefined, compute);
      const result2 = await getOrCompute("disabled-test-brief", undefined, compute);

      expect(result1.cached).toBe(false);
      expect(result2.cached).toBe(false);
      expect(computeCount).toBe(2);
    });

    it("returns cached value when caching enabled", async () => {
      process.env.CEE_CACHE_RESPONSE_ENABLED = "true";
      const { _resetConfigCache } = await import("../../src/config/index.js");
      _resetConfigCache();
      resetCache(); // Ensure fresh cache

      let computeCount = 0;
      const compute = async () => {
        computeCount++;
        return { data: "computed" };
      };

      const result1 = await getOrCompute("cache-test-brief", undefined, compute);
      const result2 = await getOrCompute("cache-test-brief", undefined, compute);

      expect(result1.cached).toBe(false);
      expect(result1.value).toEqual({ data: "computed" });
      expect(result2.cached).toBe(true);
      expect(result2.value).toEqual({ data: "computed" });
      expect(computeCount).toBe(1);
    });

    it("differentiates by context", async () => {
      process.env.CEE_CACHE_RESPONSE_ENABLED = "true";
      const { _resetConfigCache } = await import("../../src/config/index.js");
      _resetConfigCache();
      resetCache(); // Ensure fresh cache

      let computeCount = 0;
      const compute = async () => {
        computeCount++;
        return { count: computeCount };
      };

      const result1 = await getOrCompute("context-test-brief", { ctx: "a" }, compute);
      const result2 = await getOrCompute("context-test-brief", { ctx: "b" }, compute);
      const result3 = await getOrCompute("context-test-brief", { ctx: "a" }, compute);

      expect(computeCount).toBe(2);
      expect(result1.value).toEqual({ count: 1 });
      expect(result2.value).toEqual({ count: 2 });
      expect(result3.value).toEqual({ count: 1 }); // cached
      expect(result3.cached).toBe(true);
    });
  });

  describe("constants", () => {
    it("has sensible defaults", () => {
      expect(DEFAULT_TTL_MS).toBe(5 * 60 * 1000); // 5 minutes
      expect(MAX_CACHE_SIZE).toBe(100);
    });
  });
});
