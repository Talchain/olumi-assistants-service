import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  storeSession,
  retrieveSession,
  appendTurn,
  deleteSession,
  clearMemoryCache,
  getMemoryCacheSize,
} from "../../src/services/session-cache.js";
import type { TurnT } from "../../src/schemas/working-set.js";

// Mock Redis to test memory fallback behavior
vi.mock("../../src/platform/redis.js", () => ({
  getRedis: vi.fn(() => Promise.resolve(null)),
  isRedisAvailable: vi.fn(() => false),
}));

describe("Session Cache Service", () => {
  beforeEach(() => {
    clearMemoryCache();
  });

  afterEach(() => {
    clearMemoryCache();
  });

  describe("storeSession and retrieveSession", () => {
    it("stores and retrieves session data from memory cache", async () => {
      const scenarioId = "test-scenario-1";
      const sessionData = {
        scenario_id: scenarioId,
        turns_recent: [] as TurnT[],
        decision_state_summary: "Initial state",
        last_intent: "explain" as const,
      };

      await storeSession(scenarioId, sessionData);

      const result = await retrieveSession(scenarioId);

      expect(result.session).not.toBeNull();
      expect(result.source).toBe("memory");
      expect(result.degraded).toBe(true); // Redis unavailable
      expect(result.session?.scenario_id).toBe(scenarioId);
      expect(result.session?.decision_state_summary).toBe("Initial state");
      expect(result.session?.last_intent).toBe("explain");
    });

    it("returns null for non-existent session", async () => {
      const result = await retrieveSession("non-existent-id");

      expect(result.session).toBeNull();
      expect(result.source).toBe("none");
    });

    it("trims turns to max of 5", async () => {
      const scenarioId = "test-scenario-2";
      const turns: TurnT[] = Array.from({ length: 10 }, (_, i) => ({
        role: "user" as const,
        content: `Turn ${i + 1}`,
      }));

      await storeSession(scenarioId, {
        scenario_id: scenarioId,
        turns_recent: turns,
        decision_state_summary: "",
      });

      const result = await retrieveSession(scenarioId);

      expect(result.session?.turns_recent).toHaveLength(5);
      // Should keep the last 5 turns
      expect(result.session?.turns_recent[0].content).toBe("Turn 6");
      expect(result.session?.turns_recent[4].content).toBe("Turn 10");
    });

    it("adds updated_at timestamp", async () => {
      const scenarioId = "test-scenario-3";

      await storeSession(scenarioId, {
        scenario_id: scenarioId,
        turns_recent: [],
        decision_state_summary: "",
      });

      const result = await retrieveSession(scenarioId);

      expect(result.session?.updated_at).toBeDefined();
      // Timestamp should be valid ISO 8601
      expect(new Date(result.session!.updated_at).toISOString()).toBe(
        result.session!.updated_at
      );
    });
  });

  describe("appendTurn", () => {
    it("appends a turn to existing session", async () => {
      const scenarioId = "test-scenario-4";

      // Store initial session
      await storeSession(scenarioId, {
        scenario_id: scenarioId,
        turns_recent: [{ role: "user", content: "Hello" }],
        decision_state_summary: "Initial",
      });

      // Append a new turn
      const newTurn: TurnT = {
        role: "assistant",
        content: "Hi there!",
      };
      await appendTurn(scenarioId, newTurn, "Updated state", "clarify");

      const result = await retrieveSession(scenarioId);

      expect(result.session?.turns_recent).toHaveLength(2);
      expect(result.session?.turns_recent[0].content).toBe("Hello");
      expect(result.session?.turns_recent[1].content).toBe("Hi there!");
      expect(result.session?.decision_state_summary).toBe("Updated state");
      expect(result.session?.last_intent).toBe("clarify");
    });

    it("creates new session if none exists", async () => {
      const scenarioId = "test-scenario-5";

      const newTurn: TurnT = {
        role: "user",
        content: "New conversation",
      };
      await appendTurn(scenarioId, newTurn);

      const result = await retrieveSession(scenarioId);

      expect(result.session?.turns_recent).toHaveLength(1);
      expect(result.session?.turns_recent[0].content).toBe("New conversation");
    });

    it("preserves existing decision_state_summary if not provided", async () => {
      const scenarioId = "test-scenario-6";

      await storeSession(scenarioId, {
        scenario_id: scenarioId,
        turns_recent: [],
        decision_state_summary: "Original state",
      });

      await appendTurn(scenarioId, { role: "user", content: "Test" });

      const result = await retrieveSession(scenarioId);

      expect(result.session?.decision_state_summary).toBe("Original state");
    });
  });

  describe("deleteSession", () => {
    it("removes session from memory cache", async () => {
      const scenarioId = "test-scenario-7";

      await storeSession(scenarioId, {
        scenario_id: scenarioId,
        turns_recent: [],
        decision_state_summary: "",
      });

      // Verify it exists
      let result = await retrieveSession(scenarioId);
      expect(result.session).not.toBeNull();

      // Delete it
      await deleteSession(scenarioId);

      // Verify it's gone
      result = await retrieveSession(scenarioId);
      expect(result.session).toBeNull();
    });
  });

  describe("memory cache management", () => {
    it("tracks cache size correctly", async () => {
      expect(getMemoryCacheSize()).toBe(0);

      await storeSession("scenario-a", {
        scenario_id: "scenario-a",
        turns_recent: [],
        decision_state_summary: "",
      });

      expect(getMemoryCacheSize()).toBe(1);

      await storeSession("scenario-b", {
        scenario_id: "scenario-b",
        turns_recent: [],
        decision_state_summary: "",
      });

      expect(getMemoryCacheSize()).toBe(2);

      clearMemoryCache();
      expect(getMemoryCacheSize()).toBe(0);
    });
  });

  describe("graceful degradation", () => {
    it("reports degraded mode when Redis is unavailable", async () => {
      const result = await retrieveSession("any-scenario");

      // With our mock, Redis is always unavailable
      expect(result.degraded).toBe(true);
    });

    it("continues working without Redis", async () => {
      const scenarioId = "degraded-test";

      // Should not throw, should use memory fallback
      await expect(
        storeSession(scenarioId, {
          scenario_id: scenarioId,
          turns_recent: [],
          decision_state_summary: "",
        })
      ).resolves.not.toThrow();

      const result = await retrieveSession(scenarioId);
      expect(result.session).not.toBeNull();
      expect(result.source).toBe("memory");
    });
  });
});
