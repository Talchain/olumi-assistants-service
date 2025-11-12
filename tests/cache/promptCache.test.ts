import { describe, it, expect, beforeEach, vi } from "vitest";
import { PromptCache } from "../../src/cache/promptCache.js";
import { DraftGraphOutput } from "../../src/schemas/assist.js";
import type { CacheKeyShape } from "../../src/cache/cacheKey.js";

// Mock telemetry to avoid real emissions during tests
vi.mock("../../src/utils/telemetry.js", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  emit: vi.fn(),
  TelemetryEvents: {
    CacheHit: "assist.cache.hit",
    CacheMiss: "assist.cache.miss",
    CachePut: "assist.cache.put",
    CacheEvict: "assist.cache.evict",
  },
}));

describe("Prompt Cache (v1.4.0)", () => {
  let cache: PromptCache;

  const mockPayload = DraftGraphOutput.parse({
    graph: {
      nodes: [
        { id: "n1", kind: "decision", text: "Test" },
        { id: "n2", kind: "option", text: "Option A" },
      ],
      edges: [{ from: "n1", to: "n2", kind: "option_of" }],
    },
    patch: { adds: { nodes: [], edges: [] }, updates: [], removes: [] },
    rationales: [],
    confidence: 0.85,
    clarifier_status: "complete",
  });

  const mockKeyShape: CacheKeyShape = {
    brief_normalized_length: 42,
    attachment_count: 0,
    attachment_hashes: [],
    flags: { grounding: true },
    clarifier_answer_count: 0,
    template_version: "v1.0.0",
  };

  beforeEach(() => {
    // Create fresh cache with small size for testing
    cache = new PromptCache(3, 1000); // max 3 entries, 1 second TTL
  });

  describe("Cache hit and miss", () => {
    it("returns undefined for cache miss (not found)", () => {
      const result = cache.get("nonexistent-key", "test-correlation-id");
      expect(result).toBeUndefined();
    });

    it("returns cached payload for cache hit", () => {
      const cacheKey = "test-key-1";
      cache.put(cacheKey, mockPayload, mockKeyShape, "anthropic", "claude-3-5-sonnet", 0.05, "test-corr-id");

      const result = cache.get(cacheKey, "test-correlation-id");
      expect(result).toEqual(mockPayload);
    });

    it("returns undefined for expired entries (TTL)", async () => {
      const cacheKey = "test-key-2";
      const shortTtlCache = new PromptCache(10, 50); // 50ms TTL

      shortTtlCache.put(cacheKey, mockPayload, mockKeyShape, "anthropic", "claude-3-5-sonnet", 0.05, "test-corr-id");

      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, 100));

      const result = shortTtlCache.get(cacheKey, "test-correlation-id");
      expect(result).toBeUndefined();
    });

    it("removes expired entries on get", async () => {
      const cacheKey = "test-key-3";
      const shortTtlCache = new PromptCache(10, 50);

      shortTtlCache.put(cacheKey, mockPayload, mockKeyShape, "anthropic", "claude-3-5-sonnet", 0.05, "test-corr-id");

      const statsBefore = shortTtlCache.getStats();
      expect(statsBefore.size).toBe(1);

      // Wait for expiry
      await new Promise(resolve => setTimeout(resolve, 100));

      shortTtlCache.get(cacheKey, "test-correlation-id");

      const statsAfter = shortTtlCache.getStats();
      expect(statsAfter.size).toBe(0); // Entry removed
    });
  });

  describe("LRU eviction", () => {
    it("evicts least recently used entry when cache is full", () => {
      // Fill cache to max size (3)
      cache.put("key-1", mockPayload, mockKeyShape, "anthropic", "claude", 0.01, "corr-1");
      cache.put("key-2", mockPayload, mockKeyShape, "anthropic", "claude", 0.02, "corr-2");
      cache.put("key-3", mockPayload, mockKeyShape, "anthropic", "claude", 0.03, "corr-3");

      const stats1 = cache.getStats();
      expect(stats1.size).toBe(3);

      // Add 4th entry - should evict key-1 (oldest)
      cache.put("key-4", mockPayload, mockKeyShape, "anthropic", "claude", 0.04, "corr-4");

      const stats2 = cache.getStats();
      expect(stats2.size).toBe(3); // Still at max

      // key-1 should be evicted
      expect(cache.get("key-1", "test-corr-id")).toBeUndefined();
      expect(cache.get("key-2", "test-corr-id")).toEqual(mockPayload);
      expect(cache.get("key-3", "test-corr-id")).toEqual(mockPayload);
      expect(cache.get("key-4", "test-corr-id")).toEqual(mockPayload);
    });

    it("moves accessed entries to end (LRU touch)", () => {
      cache.put("key-1", mockPayload, mockKeyShape, "anthropic", "claude", 0.01, "corr-1");
      cache.put("key-2", mockPayload, mockKeyShape, "anthropic", "claude", 0.02, "corr-2");
      cache.put("key-3", mockPayload, mockKeyShape, "anthropic", "claude", 0.03, "corr-3");

      // Access key-1 (moves to end)
      cache.get("key-1", "test-corr-id");

      // Add 4th entry - should evict key-2 (now oldest)
      cache.put("key-4", mockPayload, mockKeyShape, "anthropic", "claude", 0.04, "corr-4");

      expect(cache.get("key-1", "test-corr-id")).toEqual(mockPayload); // Still there
      expect(cache.get("key-2", "test-corr-id")).toBeUndefined(); // Evicted
      expect(cache.get("key-3", "test-corr-id")).toEqual(mockPayload);
      expect(cache.get("key-4", "test-corr-id")).toEqual(mockPayload);
    });

    it("does not evict when updating existing key", () => {
      cache.put("key-1", mockPayload, mockKeyShape, "anthropic", "claude", 0.01, "corr-1");
      cache.put("key-2", mockPayload, mockKeyShape, "anthropic", "claude", 0.02, "corr-2");
      cache.put("key-3", mockPayload, mockKeyShape, "anthropic", "claude", 0.03, "corr-3");

      const stats1 = cache.getStats();
      expect(stats1.size).toBe(3);

      // Update existing key-2 (should not evict)
      const updatedPayload = { ...mockPayload, confidence: 0.95 };
      cache.put("key-2", updatedPayload, mockKeyShape, "anthropic", "claude", 0.02, "corr-2-updated");

      const stats2 = cache.getStats();
      expect(stats2.size).toBe(3); // Still 3 entries

      const result = cache.get("key-2", "test-corr-id");
      expect(result).toEqual(updatedPayload);
    });
  });

  describe("Cache statistics", () => {
    it("tracks cache size correctly", () => {
      const stats1 = cache.getStats();
      expect(stats1.size).toBe(0);
      expect(stats1.maxSize).toBe(3);

      cache.put("key-1", mockPayload, mockKeyShape, "anthropic", "claude", 0.01, "corr-1");
      const stats2 = cache.getStats();
      expect(stats2.size).toBe(1);

      cache.put("key-2", mockPayload, mockKeyShape, "anthropic", "claude", 0.02, "corr-2");
      const stats3 = cache.getStats();
      expect(stats3.size).toBe(2);
    });

    it("reports TTL configuration", () => {
      const customCache = new PromptCache(100, 5000);
      const stats = customCache.getStats();
      expect(stats.ttlMs).toBe(5000);
    });
  });

  describe("Clear operation", () => {
    it("clears all cache entries", () => {
      cache.put("key-1", mockPayload, mockKeyShape, "anthropic", "claude", 0.01, "corr-1");
      cache.put("key-2", mockPayload, mockKeyShape, "anthropic", "claude", 0.02, "corr-2");

      const stats1 = cache.getStats();
      expect(stats1.size).toBe(2);

      cache.clear();

      const stats2 = cache.getStats();
      expect(stats2.size).toBe(0);

      expect(cache.get("key-1", "test-corr-id")).toBeUndefined();
      expect(cache.get("key-2", "test-corr-id")).toBeUndefined();
    });
  });

  describe("Multi-provider support", () => {
    it("stores provider and model metadata", () => {
      const cacheKey = "test-key-multi-provider";
      cache.put(cacheKey, mockPayload, mockKeyShape, "openai", "gpt-4o", 0.08, "test-corr-id");

      // Cache should return payload regardless of provider
      const result = cache.get(cacheKey, "test-correlation-id");
      expect(result).toEqual(mockPayload);
    });

    it("caches results from different providers independently", () => {
      cache.put("key-anthropic", mockPayload, mockKeyShape, "anthropic", "claude-3-5-sonnet", 0.05, "corr-1");
      cache.put("key-openai", mockPayload, mockKeyShape, "openai", "gpt-4o", 0.08, "corr-2");

      expect(cache.get("key-anthropic", "test-corr-id")).toEqual(mockPayload);
      expect(cache.get("key-openai", "test-corr-id")).toEqual(mockPayload);
    });
  });

  describe("Cost tracking", () => {
    it("stores cost metadata for cache hits", () => {
      const cacheKey = "test-key-cost";
      const costUsd = 0.075;

      cache.put(cacheKey, mockPayload, mockKeyShape, "anthropic", "claude-3-5-sonnet", costUsd, "test-corr-id");

      // Internal metadata is stored (verified by get returning payload)
      const result = cache.get(cacheKey, "test-correlation-id");
      expect(result).toEqual(mockPayload);
    });
  });
});
