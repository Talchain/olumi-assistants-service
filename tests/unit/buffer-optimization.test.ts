/**
 * Unit tests for Buffer Optimization (v1.10.0)
 *
 * Tests payload trimming, compression, and priority-based trimming
 */

import { describe, it, expect } from "vitest";
import {
  trimEventPayload,
  compressEvent,
  decompressEvent,
  calculateSavings,
  getEventPriority,
  sortEventsByPriority,
  EventPriority,
} from "../../src/utils/buffer-optimization.js";

describe("Buffer Optimization", () => {
  describe("trimEventPayload", () => {
    it("should preserve COMPLETE events unchanged", () => {
      const payload = JSON.stringify({
        stage: "COMPLETE",
        correlation_id: "test-123",
        payload: {
          graph: { nodes: [{ id: "1" }], edges: [] },
          explanation: "Long explanation text...",
        },
      });

      const trimmed = trimEventPayload(payload);
      expect(trimmed).toBe(payload);
    });

    it("should preserve ERROR events unchanged", () => {
      const payload = JSON.stringify({
        stage: "ERROR",
        correlation_id: "test-123",
        payload: {
          error: "Something went wrong",
          details: "Detailed error message",
        },
      });

      const trimmed = trimEventPayload(payload);
      expect(trimmed).toBe(payload);
    });

    it("should preserve graph-carrying events unchanged for lossless resume", () => {
      const payload = JSON.stringify({
        stage: "DRAFTING",
        correlation_id: "test-123",
        payload: {
          graph: {
            nodes: [
              { id: "1", label: "Node 1" },
              { id: "2", label: "Node 2" },
            ],
            edges: [{ from: "1", to: "2" }],
          },
        },
      });

      const trimmed = trimEventPayload(payload);
      expect(trimmed).toBe(payload);
    });

    it("should preserve essential telemetry fields", () => {
      const payload = JSON.stringify({
        stage: "PROCESSING",
        correlation_id: "test-123",
        payload: {
          telemetry: {
            duration_ms: 123,
            tokens: 456,
            buffer_trimmed: true,
            verbose_logs: ["log1", "log2", "log3"],
          },
        },
      });

      const trimmed = trimEventPayload(payload);
      const parsed = JSON.parse(trimmed);

      expect(parsed.payload.telemetry).toEqual({
        duration_ms: 123,
        tokens: 456,
        buffer_trimmed: true,
      });
      expect(parsed.payload.telemetry.verbose_logs).toBeUndefined();
    });

    it("should handle malformed JSON gracefully", () => {
      const invalid = "{ invalid json";
      const trimmed = trimEventPayload(invalid);
      expect(trimmed).toBe(invalid);
    });
  });

  describe("compressEvent/decompressEvent", () => {
    it("should compress and decompress event data", () => {
      const original = JSON.stringify({
        stage: "PROCESSING",
        payload: {
          graph: {
            nodes: Array(100).fill({ id: "test", label: "Test node" }),
          },
        },
      });

      const compressed = compressEvent(original);
      const decompressed = decompressEvent(compressed);

      expect(decompressed).toBe(original);
    });

    it("should reduce size with compression for large payloads", () => {
      const large = JSON.stringify({
        data: "Lorem ipsum ".repeat(1000),
      });

      const compressed = compressEvent(large);
      const originalSize = Buffer.byteLength(large, "utf-8");

      // Compression should reduce size
      if (process.env.SSE_BUFFER_COMPRESS === "true") {
        expect(compressed.length).toBeLessThan(originalSize);
      } else {
        expect(compressed.length).toBe(originalSize);
      }
    });

    it("should handle decompression of uncompressed data", () => {
      const text = "plain text";
      const buffer = Buffer.from(text, "utf-8");

      const result = decompressEvent(buffer);
      expect(result).toBe(text);
    });

    it("should handle string input to decompressEvent", () => {
      const text = "test string";
      const result = decompressEvent(text);
      expect(result).toBe(text);
    });
  });

  describe("calculateSavings", () => {
    it("should calculate size savings correctly", () => {
      const original = "Hello world!";
      const optimized = Buffer.from("Hi!");

      const savings = calculateSavings(original, optimized);

      expect(savings.original_size).toBe(Buffer.byteLength(original, "utf-8"));
      expect(savings.optimized_size).toBe(3);
      expect(savings.savings_bytes).toBeGreaterThan(0);
      expect(savings.savings_percent).toBeGreaterThan(0);
    });

    it("should handle zero savings", () => {
      const text = "test";
      const buffer = Buffer.from(text, "utf-8");

      const savings = calculateSavings(text, buffer);

      expect(savings.savings_bytes).toBe(0);
      expect(savings.savings_percent).toBe(0);
    });
  });

  describe("getEventPriority", () => {
    it("should assign CRITICAL priority to COMPLETE events", () => {
      const event = {
        type: "stage",
        data: JSON.stringify({ stage: "COMPLETE" }),
      };

      expect(getEventPriority(event)).toBe(EventPriority.CRITICAL);
    });

    it("should assign CRITICAL priority to ERROR events", () => {
      const event = {
        type: "stage",
        data: JSON.stringify({ stage: "ERROR" }),
      };

      expect(getEventPriority(event)).toBe(EventPriority.CRITICAL);
    });

    it("should assign CRITICAL priority to resume events", () => {
      const event = {
        type: "resume",
        data: JSON.stringify({ token: "test-token" }),
      };

      expect(getEventPriority(event)).toBe(EventPriority.CRITICAL);
    });

    it("should assign LOW priority to heartbeat events", () => {
      const event = {
        type: "heartbeat",
        data: JSON.stringify({}),
      };

      expect(getEventPriority(event)).toBe(EventPriority.LOW);
    });

    it("should assign LOW priority to trace events", () => {
      const event = {
        type: "trace",
        data: JSON.stringify({ message: "debug trace" }),
      };

      expect(getEventPriority(event)).toBe(EventPriority.LOW);
    });

    it("should assign HIGH priority to stage events with graph", () => {
      const event = {
        type: "stage",
        data: JSON.stringify({
          stage: "DRAFTING",
          payload: { graph: { nodes: [], edges: [] } },
        }),
      };

      expect(getEventPriority(event)).toBe(EventPriority.HIGH);
    });

    it("should assign MEDIUM priority to stage events without graph", () => {
      const event = {
        type: "stage",
        data: JSON.stringify({
          stage: "PROCESSING",
          payload: { status: "working" },
        }),
      };

      expect(getEventPriority(event)).toBe(EventPriority.MEDIUM);
    });

    it("should handle malformed event data gracefully", () => {
      const event = {
        type: "unknown",
        data: "{ invalid json",
      };

      expect(getEventPriority(event)).toBe(EventPriority.MEDIUM);
    });
  });

  describe("sortEventsByPriority", () => {
    it("should sort events by priority (lowest first)", () => {
      const events = [
        { seq: 1, type: "stage", data: JSON.stringify({ stage: "COMPLETE" }) },
        { seq: 2, type: "heartbeat", data: JSON.stringify({}) },
        { seq: 3, type: "stage", data: JSON.stringify({ stage: "DRAFTING", payload: { graph: {} } }) },
        { seq: 4, type: "trace", data: JSON.stringify({}) },
      ];

      const sorted = sortEventsByPriority(events);

      // Order should be: trace (LOW), heartbeat (LOW), stage with graph (HIGH), COMPLETE (CRITICAL)
      expect(sorted[0].priority).toBe(EventPriority.LOW);
      expect(sorted[1].priority).toBe(EventPriority.LOW);
      expect(sorted[2].priority).toBe(EventPriority.HIGH);
      expect(sorted[3].priority).toBe(EventPriority.CRITICAL);
    });

    it("should sort by sequence within same priority", () => {
      const events = [
        { seq: 3, type: "heartbeat", data: JSON.stringify({}) },
        { seq: 1, type: "heartbeat", data: JSON.stringify({}) },
        { seq: 2, type: "heartbeat", data: JSON.stringify({}) },
      ];

      const sorted = sortEventsByPriority(events);

      // All have same priority (LOW), should be ordered by seq
      expect(sorted[0].seq).toBe(1);
      expect(sorted[1].seq).toBe(2);
      expect(sorted[2].seq).toBe(3);
    });

    it("should never trim CRITICAL events first", () => {
      const events = [
        { seq: 1, type: "heartbeat", data: JSON.stringify({}) },
        { seq: 2, type: "stage", data: JSON.stringify({ stage: "COMPLETE" }) },
        { seq: 3, type: "stage", data: JSON.stringify({ stage: "ERROR" }) },
      ];

      const sorted = sortEventsByPriority(events);

      // Heartbeat should be first (to trim), CRITICAL events last
      expect(sorted[0].type).toBe("heartbeat");
      expect(sorted[1].priority).toBe(EventPriority.CRITICAL);
      expect(sorted[2].priority).toBe(EventPriority.CRITICAL);
    });
  });
});
