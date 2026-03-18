/**
 * Tests for SSE Streaming helpers (v1.8.0)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  streamDraftGraph,
} from "./sse.js";
import type {
  SseEvent,
} from "./types.js";
import { OlumiAPIError, OlumiNetworkError, OlumiConfigError } from "./errors.js";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

describe("SSE Streaming", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("streamDraftGraph", () => {
    it("should throw config error when no auth provided", async () => {
      await expect(
        (async () => {
          const stream = streamDraftGraph(
            { baseUrl: "https://api.example.com", apiKey: "" },
            { brief: "Test" }
          );
          const iterator = stream[Symbol.asyncIterator]();
          // Consume one event to trigger execution
          await iterator.next();
        })()
      ).rejects.toThrow(OlumiConfigError);
    });

    it("should stream SSE events with API key auth to v1 endpoint", async () => {
      // Mock SSE response (v1 stream — no resume token)
      const sseData = `event: stage
data: {"stage":"DRAFTING"}

event: stage
data: {"stage":"COMPLETE","payload":{"schema":"draft-graph.v1","graph":{"schema":"graph.v1","nodes":[],"edges":[]},"rationales":[]}}

`;

      const mockReader = {
        read: vi
          .fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode(sseData),
          })
          .mockResolvedValueOnce({ done: true, value: undefined }),
        releaseLock: vi.fn(),
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: {
          getReader: () => mockReader,
        },
      });

      const events: SseEvent[] = [];
      const stream = streamDraftGraph(
        { baseUrl: "https://api.example.com", apiKey: "test-key" },
        { brief: "Create a todo app" }
      );

      for await (const event of stream) {
        events.push(event);
      }

      // Verify fetch was called with v1 URL
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/assist/v1/draft-graph/stream",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "X-Olumi-Assist-Key": "test-key",
            "Content-Type": "application/json",
          }),
        })
      );

      // Verify events
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe("stage");
      expect(events[1].type).toBe("stage");
    });

    it("should stream SSE events with HMAC auth", async () => {
      const sseData = `event: stage
data: {"stage":"DRAFTING"}

`;

      const mockReader = {
        read: vi
          .fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode(sseData),
          })
          .mockResolvedValueOnce({ done: true, value: undefined }),
        releaseLock: vi.fn(),
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: {
          getReader: () => mockReader,
        },
      });

      const events: SseEvent[] = [];
      const stream = streamDraftGraph(
        {
          baseUrl: "https://api.example.com",
          apiKey: "",
          hmacSecret: "test-secret-hex-64-chars",
        },
        { brief: "Create a todo app" }
      );

      for await (const event of stream) {
        events.push(event);
      }

      // Verify fetch was called with v1 URL and HMAC headers
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/assist/v1/draft-graph/stream",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "X-Olumi-Signature": expect.any(String),
            "X-Olumi-Timestamp": expect.any(String),
            "X-Olumi-Nonce": expect.any(String),
          }),
        })
      );

      expect(events).toHaveLength(1);
    });

    it("should handle abort signal", async () => {
      const abortController = new AbortController();
      abortController.abort();

      mockFetch.mockRejectedValueOnce(new DOMException("Aborted", "AbortError"));

      await expect(
        (async () => {
          const stream = streamDraftGraph(
            { baseUrl: "https://api.example.com", apiKey: "test-key" },
            { brief: "Test" },
            { signal: abortController.signal }
          );
          const iterator = stream[Symbol.asyncIterator]();
          await iterator.next();
        })()
      ).rejects.toThrow("Request aborted by user");
    });

    it("should handle timeout", async () => {
      mockFetch.mockRejectedValueOnce(new DOMException("Timeout", "AbortError"));

      await expect(
        (async () => {
          const stream = streamDraftGraph(
            { baseUrl: "https://api.example.com", apiKey: "test-key", timeout: 100 },
            { brief: "Test" }
          );
          const iterator = stream[Symbol.asyncIterator]();
          await iterator.next();
        })()
      ).rejects.toThrow(OlumiNetworkError);
    });

    it("should handle API errors", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () =>
          JSON.stringify({
            schema: "error.v1",
            code: "BAD_INPUT",
            message: "Brief is required",
          }),
      });

      await expect(
        (async () => {
          const stream = streamDraftGraph(
            { baseUrl: "https://api.example.com", apiKey: "test-key" },
            { brief: "" }
          );
          const iterator = stream[Symbol.asyncIterator]();
          await iterator.next();
        })()
      ).rejects.toThrow(OlumiAPIError);
    });

    it("should handle heartbeat events", async () => {
      const sseData = `event: stage
data: {"stage":"DRAFTING"}

: heartbeat

event: stage
data: {"stage":"COMPLETE"}

`;

      const mockReader = {
        read: vi
          .fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode(sseData),
          })
          .mockResolvedValueOnce({ done: true, value: undefined }),
        releaseLock: vi.fn(),
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: {
          getReader: () => mockReader,
        },
      });

      const events: SseEvent[] = [];
      const stream = streamDraftGraph(
        { baseUrl: "https://api.example.com", apiKey: "test-key" },
        { brief: "Test" }
      );

      for await (const event of stream) {
        events.push(event);
      }

      expect(events).toHaveLength(3);
      expect(events[1].type).toBe("heartbeat");
    });

    it("should invoke onDegraded callback when X-Olumi-Degraded header is present", async () => {
      const sseData = `event: stage
data: {"stage":"DRAFTING"}

`;

      const mockReader = {
        read: vi
          .fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode(sseData),
          })
          .mockResolvedValueOnce({ done: true, value: undefined }),
        releaseLock: vi.fn(),
      };

      const headers = {
        get: (name: string) => (name === "X-Olumi-Degraded" ? "redis" : null),
      } as any;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers,
        body: {
          getReader: () => mockReader,
        },
      });

      const onDegraded = vi.fn();

      const stream = streamDraftGraph(
        { baseUrl: "https://api.example.com", apiKey: "test-key", onDegraded },
        { brief: "Test" }
      );

      for await (const _event of stream) {
        // Drain events
      }

      expect(onDegraded).toHaveBeenCalledTimes(1);
      expect(onDegraded).toHaveBeenCalledWith("redis");
    });
  });

  describe("streamDraftGraphWithAutoReconnect", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    it("prefers server retry_after_seconds over static backoff", async () => {
      const sseModule = await import("./sse.js");

      // Spy on setTimeout to capture the requested delay
      const setTimeoutSpy = vi.spyOn(global, "setTimeout");

      // Create a RATE_LIMITED error with retry_after_seconds
      const rateLimitedError = new OlumiAPIError(429, {
        schema: "error.v1",
        code: "RATE_LIMITED",
        message: "Rate limited",
        details: { retry_after_seconds: 7 },
        request_id: "req_123",
      } as any);

      let streamCallCount = 0;

      const streamFactory = () => {
        streamCallCount++;

        const iterable: AsyncIterable<SseEvent> = {
          [Symbol.asyncIterator]() {
            let firstNext = true;
            return {
              async next() {
                // First stream: throw retryable error on first next()
                if (streamCallCount === 1 && firstNext) {
                  firstNext = false;
                  throw rateLimitedError;
                }

                // Subsequent calls: end the stream
                return { done: true, value: undefined as any };
              },
              async return() {
                return { done: true, value: undefined as any };
              },
            } as AsyncIterator<SseEvent>;
          },
        };

        return iterable;
      };

      const iterable = sseModule.streamDraftGraphWithAutoReconnect(
        { baseUrl: "https://api.example.com", apiKey: "test-key", streamFactory },
        { brief: "Test" }
      );

      const iterator = iterable[Symbol.asyncIterator]();

      // Trigger the first iteration; this will schedule the backoff timer
      const nextPromise = iterator.next();

      // Allow microtasks (including the async generator error handler) to run
      await Promise.resolve();

      // setTimeout should have been called with the server-provided delay (7s)
      expect(setTimeoutSpy).toHaveBeenCalled();
      const [, delay] = setTimeoutSpy.mock.calls[0];
      expect(delay).toBe(7000);

      // Allow timers to run so the generator can complete cleanly
      await vi.runAllTimersAsync();
      await nextPromise;
    });
  });
});
