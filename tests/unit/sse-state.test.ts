/**
 * SSE State Management Tests
 *
 * Tests Redis-backed stream state management with event buffering:
 * - Stream state initialization
 * - Event buffering with size/count limits
 * - Buffer trimming (oldest events removed when limits exceeded)
 * - Event retrieval by sequence
 * - Snapshot creation and retrieval
 * - State expiration
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from "vitest";
import {
  initStreamState,
  bufferEvent,
  getBufferedEvents,
  getStreamState,
  markStreamComplete,
  getSnapshot,
  cleanupStreamState,
  type SseEvent,
} from "../../src/utils/sse-state.js";
import { getRedis } from "../../src/platform/redis.js";

// Check if Redis is available for tests
let redisAvailable = false;
beforeAll(async () => {
  const redis = await getRedis();
  redisAvailable = redis !== null;

  if (!redisAvailable) {
    console.log("\n⚠️  Redis not available - SSE state tests will be skipped");
    console.log("   These tests require Redis to be running");
    console.log("   Run 'redis-server' or configure REDIS_URL to enable these tests\n");
  }
});

// TODO-1010: Re-enable SSE state tests without conditional skip once Redis test infra is stable across environments
describe.skipIf(() => !redisAvailable)("SSE State Management", () => {
  const testRequestId = "test-req-123";

  beforeEach(async () => {
    // Clean up any existing state
    await cleanupStreamState(testRequestId);
  });

  afterEach(async () => {
    // Clean up after each test
    await cleanupStreamState(testRequestId);
  });

  describe("initStreamState", () => {
    it("should initialize stream state", async () => {
      await initStreamState(testRequestId);

      const state = await getStreamState(testRequestId);
      expect(state).toBeDefined();
      expect(state?.request_id).toBe(testRequestId);
      expect(state?.status).toBe("drafting");
      expect(state?.last_seq).toBe(0);
      expect(state?.buffer_event_count).toBe(0);
      expect(state?.buffer_size_bytes).toBe(0);
    });

    it("should set initial timestamps", async () => {
      const before = Date.now();
      await initStreamState(testRequestId);
      const after = Date.now();

      const state = await getStreamState(testRequestId);
      expect(state?.started_at).toBeGreaterThanOrEqual(before);
      expect(state?.started_at).toBeLessThanOrEqual(after);
      expect(state?.last_heartbeat_at).toBeGreaterThanOrEqual(before);
      expect(state?.last_heartbeat_at).toBeLessThanOrEqual(after);
    });
  });

  describe("bufferEvent", () => {
    beforeEach(async () => {
      await initStreamState(testRequestId);
    });

    it("should buffer a single event", async () => {
      const event: SseEvent = {
        seq: 1,
        type: "stage",
        data: JSON.stringify({ stage: "DRAFTING" }),
        timestamp: Date.now(),
      };

      await bufferEvent(testRequestId, event);

      const state = await getStreamState(testRequestId);
      expect(state?.last_seq).toBe(1);
      expect(state?.buffer_event_count).toBe(1);
      expect(state?.buffer_size_bytes).toBeGreaterThan(0);
    });

    it("should buffer multiple events", async () => {
      const events: SseEvent[] = [
        { seq: 1, type: "stage", data: JSON.stringify({ stage: "DRAFTING" }), timestamp: Date.now() },
        { seq: 2, type: "resume", data: JSON.stringify({ token: "test-token" }), timestamp: Date.now() },
        { seq: 3, type: "stage", data: JSON.stringify({ stage: "COMPLETE" }), timestamp: Date.now() },
      ];

      for (const event of events) {
        await bufferEvent(testRequestId, event);
      }

      const state = await getStreamState(testRequestId);
      expect(state?.last_seq).toBe(3);
      expect(state?.buffer_event_count).toBe(3);
    });

    it("should retrieve buffered events in order", async () => {
      const events: SseEvent[] = [
        { seq: 1, type: "stage", data: JSON.stringify({ stage: "DRAFTING" }), timestamp: Date.now() },
        { seq: 2, type: "resume", data: JSON.stringify({ token: "test-token" }), timestamp: Date.now() },
        { seq: 3, type: "stage", data: JSON.stringify({ stage: "COMPLETE" }), timestamp: Date.now() },
      ];

      for (const event of events) {
        await bufferEvent(testRequestId, event);
      }

      const retrieved = await getBufferedEvents(testRequestId, 0);
      expect(retrieved.length).toBe(3);
      expect(retrieved[0].seq).toBe(1);
      expect(retrieved[1].seq).toBe(2);
      expect(retrieved[2].seq).toBe(3);
    });

    it("should retrieve events from specific sequence", async () => {
      const events: SseEvent[] = [
        { seq: 1, type: "stage", data: JSON.stringify({ stage: "DRAFTING" }), timestamp: Date.now() },
        { seq: 2, type: "resume", data: JSON.stringify({ token: "test-token" }), timestamp: Date.now() },
        { seq: 3, type: "stage", data: JSON.stringify({ stage: "COMPLETE" }), timestamp: Date.now() },
      ];

      for (const event of events) {
        await bufferEvent(testRequestId, event);
      }

      // Get events after seq 1
      const retrieved = await getBufferedEvents(testRequestId, 1);
      expect(retrieved.length).toBe(2);
      expect(retrieved[0].seq).toBe(2);
      expect(retrieved[1].seq).toBe(3);
    });

    it("should update buffer size as events are added", async () => {
      const event: SseEvent = {
        seq: 1,
        type: "stage",
        data: JSON.stringify({ stage: "DRAFTING", payload: { large: "data" } }),
        timestamp: Date.now(),
      };

      await bufferEvent(testRequestId, event);

      const state = await getStreamState(testRequestId);
      const expectedSize = JSON.stringify(event).length;
      expect(state?.buffer_size_bytes).toBeGreaterThanOrEqual(expectedSize);
    });
  });

  describe("markStreamComplete", () => {
    beforeEach(async () => {
      await initStreamState(testRequestId);
    });

    it("should mark stream as complete and save snapshot", async () => {
      const finalPayload = {
        graph: { nodes: [], edges: [], version: "1" },
        confidence: 0.95,
      };

      await markStreamComplete(testRequestId, finalPayload);

      const state = await getStreamState(testRequestId);
      expect(state?.status).toBe("complete");

      const snapshot = await getSnapshot(testRequestId);
      expect(snapshot).toBeDefined();
      expect(snapshot?.status).toBe("complete");
      expect(snapshot?.final_payload).toEqual(finalPayload);
    });

    it("should set snapshot creation timestamp", async () => {
      const finalPayload = { graph: {}, confidence: 0.95 };

      const before = Date.now();
      await markStreamComplete(testRequestId, finalPayload);
      const after = Date.now();

      const snapshot = await getSnapshot(testRequestId);
      expect(snapshot?.created_at).toBeGreaterThanOrEqual(before);
      expect(snapshot?.created_at).toBeLessThanOrEqual(after);
    });

    it("should support error snapshots", async () => {
      const finalPayload = {
        schema: "error.v1",
        code: "INTERNAL",
        message: "test error",
      };

      await markStreamComplete(testRequestId, finalPayload, "error");

      const state = await getStreamState(testRequestId);
      expect(state?.status).toBe("error");

      const snapshot = await getSnapshot(testRequestId);
      expect(snapshot).toBeDefined();
      expect(snapshot?.status).toBe("error");
      expect(snapshot?.final_payload).toEqual(finalPayload);
    });
  });

  describe("getStreamState", () => {
    it("should return null for non-existent stream", async () => {
      const state = await getStreamState("non-existent-request");
      expect(state).toBeNull();
    });

    it("should return state for existing stream", async () => {
      await initStreamState(testRequestId);

      const state = await getStreamState(testRequestId);
      expect(state).toBeDefined();
      expect(state?.request_id).toBe(testRequestId);
    });
  });

  describe("getSnapshot", () => {
    it("should return null for non-existent snapshot", async () => {
      const snapshot = await getSnapshot("non-existent-request");
      expect(snapshot).toBeNull();
    });

    it("should return snapshot after completion", async () => {
      await initStreamState(testRequestId);
      const finalPayload = { graph: {}, confidence: 0.95 };
      await markStreamComplete(testRequestId, finalPayload);

      const snapshot = await getSnapshot(testRequestId);
      expect(snapshot).toBeDefined();
      expect(snapshot?.request_id).toBe(testRequestId);
      expect(snapshot?.final_payload).toEqual(finalPayload);
    });
  });

  describe("cleanupStreamState", () => {
    it("should remove all stream data", async () => {
      await initStreamState(testRequestId);

      const event: SseEvent = {
        seq: 1,
        type: "stage",
        data: JSON.stringify({ stage: "DRAFTING" }),
        timestamp: Date.now(),
      };
      await bufferEvent(testRequestId, event);

      await markStreamComplete(testRequestId, { graph: {}, confidence: 0.95 });

      // Verify data exists
      expect(await getStreamState(testRequestId)).toBeDefined();
      expect(await getSnapshot(testRequestId)).toBeDefined();

      // Cleanup
      await cleanupStreamState(testRequestId);

      // Verify data is removed
      expect(await getStreamState(testRequestId)).toBeNull();
      // Note: Snapshot may still exist briefly due to TTL, but buffer should be gone
      const retrieved = await getBufferedEvents(testRequestId, 0);
      expect(retrieved.length).toBe(0);
    });
  });

  describe("Buffer trimming", () => {
    beforeEach(async () => {
      await initStreamState(testRequestId);
    });

    it("should handle many events without error", async () => {
      // Add 100 events (well within 256 limit)
      for (let i = 1; i <= 100; i++) {
        const event: SseEvent = {
          seq: i,
          type: "stage",
          data: JSON.stringify({ stage: "DRAFTING", count: i }),
          timestamp: Date.now(),
        };
        await bufferEvent(testRequestId, event);
      }

      const state = await getStreamState(testRequestId);
      expect(state?.last_seq).toBe(100);
      expect(state?.buffer_event_count).toBeLessThanOrEqual(100);

      const retrieved = await getBufferedEvents(testRequestId, 0);
      expect(retrieved.length).toBeGreaterThan(0);
    });

    it("should trim oldest events when approaching limits", async () => {
      // Add 300 events (exceeds 256 limit)
      for (let i = 1; i <= 300; i++) {
        const event: SseEvent = {
          seq: i,
          type: "stage",
          data: JSON.stringify({ stage: "DRAFTING", count: i }),
          timestamp: Date.now(),
        };
        await bufferEvent(testRequestId, event);
      }

      const state = await getStreamState(testRequestId);
      expect(state?.last_seq).toBe(300);
      // Buffer count should not exceed limit significantly
      expect(state?.buffer_event_count).toBeLessThanOrEqual(260); // Allow small overflow

      const retrieved = await getBufferedEvents(testRequestId, 0);
      // Should have trimmed oldest events
      expect(retrieved.length).toBeLessThanOrEqual(256);
      // Latest events should still be present
      const lastEvent = retrieved[retrieved.length - 1];
      expect(lastEvent.seq).toBeGreaterThan(250);
    });

    it("should maintain sidecar metadata for non-critical events and clean it up", async () => {
      const redis = await getRedis();
      if (!redis) return;

      const event: SseEvent = {
        seq: 1,
        type: "stage",
        data: JSON.stringify({ stage: "DRAFTING" }),
        timestamp: Date.now(),
      };

      await bufferEvent(testRequestId, event);

      // Sidecar keys for non-critical priorities should exist
      const lowKey = `sse:meta:${testRequestId}:low`;
      const mediumKey = `sse:meta:${testRequestId}:medium`;
      const highKey = `sse:meta:${testRequestId}:high`;

      const [lowExists, medExists, highExists] = await Promise.all([
        redis.exists(lowKey),
        redis.exists(mediumKey),
        redis.exists(highKey),
      ]);

      expect(lowExists || medExists || highExists).toBe(1);

      // After cleanup, metadata keys should be removed
      await cleanupStreamState(testRequestId);

      const [lowAfter, medAfter, highAfter] = await Promise.all([
        redis.exists(lowKey),
        redis.exists(mediumKey),
        redis.exists(highKey),
      ]);

      expect(lowAfter).toBe(0);
      expect(medAfter).toBe(0);
      expect(highAfter).toBe(0);
    });
  });

  describe("Edge cases", () => {
    it("should handle empty buffer retrieval", async () => {
      await initStreamState(testRequestId);

      const retrieved = await getBufferedEvents(testRequestId, 0);
      expect(retrieved.length).toBe(0);
    });

    it("should handle retrieval from sequence beyond last", async () => {
      await initStreamState(testRequestId);

      const event: SseEvent = {
        seq: 1,
        type: "stage",
        data: JSON.stringify({ stage: "DRAFTING" }),
        timestamp: Date.now(),
      };
      await bufferEvent(testRequestId, event);

      // Request events after seq 10 (but we only have seq 1)
      const retrieved = await getBufferedEvents(testRequestId, 10);
      expect(retrieved.length).toBe(0);
    });

    it("should handle duplicate sequence numbers gracefully", async () => {
      await initStreamState(testRequestId);

      const event1: SseEvent = {
        seq: 1,
        type: "stage",
        data: JSON.stringify({ stage: "DRAFTING" }),
        timestamp: Date.now(),
      };
      const event2: SseEvent = {
        seq: 1, // Duplicate seq
        type: "stage",
        data: JSON.stringify({ stage: "DRAFTING", duplicate: true }),
        timestamp: Date.now(),
      };

      await bufferEvent(testRequestId, event1);
      await bufferEvent(testRequestId, event2);

      // Should still function without error
      const state = await getStreamState(testRequestId);
      expect(state).toBeDefined();
      expect(state?.buffer_event_count).toBeGreaterThan(0);
    });

    it("should handle very large event data", async () => {
      await initStreamState(testRequestId);

      // Create a large event (but within 1.5 MB limit)
      const largeData = { data: "x".repeat(100000) }; // 100 KB

      const event: SseEvent = {
        seq: 1,
        type: "stage",
        data: JSON.stringify(largeData),
        timestamp: Date.now(),
      };

      await bufferEvent(testRequestId, event);

      const state = await getStreamState(testRequestId);
      expect(state?.buffer_size_bytes).toBeGreaterThan(100000);

      const retrieved = await getBufferedEvents(testRequestId, 0);
      expect(retrieved.length).toBe(1);
      expect(JSON.parse(retrieved[0].data)).toEqual(largeData);
    });
  });
});
