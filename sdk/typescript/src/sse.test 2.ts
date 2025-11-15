/**
 * Tests for SSE Resume functionality (v1.8.0)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  streamDraftGraph,
  resumeDraftGraph,
  extractResumeTokenFromEvent,
} from "./sse.js";
import type {
  SseEvent,
  SseStageEvent,
  SseResumeEvent,
  SseCompleteEvent,
} from "./types.js";
import { OlumiAPIError, OlumiNetworkError, OlumiConfigError } from "./errors.js";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

describe("SSE Resume", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("extractResumeTokenFromEvent", () => {
    it("should extract token from resume event", () => {
      const event: SseResumeEvent = {
        type: "resume",
        data: {
          token: "eyJyZXF1ZXN0X2lkIjoiYWJjMTIzIiwic3RlcCI6IkRSQUZUSU5HIiwic2VxIjoxfQ.signature",
        },
      };

      const token = extractResumeTokenFromEvent(event);
      expect(token).toBe("eyJyZXF1ZXN0X2lkIjoiYWJjMTIzIiwic3RlcCI6IkRSQUZUSU5HIiwic2VxIjoxfQ.signature");
    });

    it("should return null for non-resume events", () => {
      const stageEvent: SseStageEvent = {
        type: "stage",
        data: {
          stage: "DRAFTING",
        },
      };

      expect(extractResumeTokenFromEvent(stageEvent)).toBeNull();
    });

    it("should return null for heartbeat events", () => {
      const heartbeatEvent: SseEvent = {
        type: "heartbeat",
        data: null,
      };

      expect(extractResumeTokenFromEvent(heartbeatEvent)).toBeNull();
    });
  });

  describe("streamDraftGraph", () => {
    it("should throw config error when no auth provided", async () => {
      await expect(
        (async () => {
          const stream = streamDraftGraph(
            { baseUrl: "https://api.example.com", apiKey: "" },
            { brief: "Test" }
          );
          // Consume one event to trigger execution
          await stream.next();
        })()
      ).rejects.toThrow(OlumiConfigError);
    });

    it("should stream SSE events with API key auth", async () => {
      // Mock SSE response
      const sseData = `event: stage
data: {"stage":"DRAFTING"}

event: resume
data: {"token":"test-token-123"}

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

      // Verify fetch was called with correct params
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/assist/draft-graph/stream",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "X-Olumi-Assist-Key": "test-key",
            "Content-Type": "application/json",
          }),
        })
      );

      // Verify events
      expect(events).toHaveLength(3);
      expect(events[0].type).toBe("stage");
      expect(events[1].type).toBe("resume");
      expect(events[2].type).toBe("stage");

      // Verify resume token extraction
      const token = extractResumeTokenFromEvent(events[1]);
      expect(token).toBe("test-token-123");
    });

    it("should stream SSE events with HMAC auth", async () => {
      const sseData = `event: stage
data: {"stage":"DRAFTING"}

event: resume
data: {"token":"test-token-456"}

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

      // Verify fetch was called with HMAC headers
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/assist/draft-graph/stream",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "X-Olumi-Signature": expect.any(String),
            "X-Olumi-Timestamp": expect.any(String),
            "X-Olumi-Nonce": expect.any(String),
          }),
        })
      );

      expect(events).toHaveLength(2);
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
          await stream.next();
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
          await stream.next();
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
          await stream.next();
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

  describe("resumeDraftGraph", () => {
    it("should resume with valid token", async () => {
      const sseData = `event: stage
data: {"stage":"DRAFTING","payload":{"schema":"draft-graph.v1","graph":{"schema":"graph.v1","nodes":[],"edges":[]},"rationales":[]}}

event: stage
data: {"stage":"COMPLETE","payload":{"schema":"draft-graph.v1","graph":{"schema":"graph.v1","nodes":[],"edges":[]},"rationales":[]}}

: heartbeat

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

      const result = await resumeDraftGraph(
        { baseUrl: "https://api.example.com", apiKey: "test-key" },
        { token: "test-resume-token" }
      );

      // Verify fetch was called with resume token header
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/assist/draft-graph/resume",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "X-Resume-Token": "test-resume-token",
            "X-Olumi-Assist-Key": "test-key",
          }),
        })
      );

      // Verify result
      expect(result.events).toHaveLength(3);
      expect(result.replayedCount).toBe(2); // Excludes heartbeat
      expect(result.completed).toBe(false); // No complete event
    });

    it("should detect completed stream", async () => {
      const sseData = `event: complete
data: {"schema":"draft-graph.v1","graph":{"schema":"graph.v1","nodes":[],"edges":[]},"rationales":[]}

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

      const result = await resumeDraftGraph(
        { baseUrl: "https://api.example.com", apiKey: "test-key" },
        { token: "test-token" }
      );

      expect(result.completed).toBe(true);
      expect(result.events[0].type).toBe("complete");
    });

    it("should handle 426 error for expired state", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 426,
        text: async () =>
          JSON.stringify({
            schema: "error.v1",
            code: "INTERNAL",
            message: "Stream state expired",
            details: { upgrade: "resume=unsupported" },
          }),
      });

      try {
        await resumeDraftGraph(
          { baseUrl: "https://api.example.com", apiKey: "test-key" },
          { token: "expired-token" }
        );
        // Should not reach here
        expect.fail("Expected resumeDraftGraph to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(OlumiAPIError);
        expect((error as OlumiAPIError).statusCode).toBe(426);
      }
    });

    it("should handle 401 error for invalid token", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () =>
          JSON.stringify({
            schema: "error.v1",
            code: "BAD_INPUT",
            message: "Invalid resume token: INVALID_SIGNATURE",
          }),
      });

      await expect(
        resumeDraftGraph(
          { baseUrl: "https://api.example.com", apiKey: "test-key" },
          { token: "invalid-token" }
        )
      ).rejects.toThrow(OlumiAPIError);
    });

    it("should use HMAC auth when secret provided", async () => {
      const sseData = `event: complete
data: {}

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

      await resumeDraftGraph(
        {
          baseUrl: "https://api.example.com",
          apiKey: "",
          hmacSecret: "test-secret",
        },
        { token: "test-token" }
      );

      // Verify HMAC headers
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/assist/draft-graph/resume",
        expect.objectContaining({
          headers: expect.objectContaining({
            "X-Olumi-Signature": expect.any(String),
            "X-Olumi-Timestamp": expect.any(String),
            "X-Olumi-Nonce": expect.any(String),
          }),
        })
      );
    });

    it("should handle network errors", async () => {
      mockFetch.mockRejectedValueOnce(new TypeError("Network error"));

      await expect(
        resumeDraftGraph(
          { baseUrl: "https://api.example.com", apiKey: "test-key" },
          { token: "test-token" }
        )
      ).rejects.toThrow(OlumiNetworkError);
    });

    it("should count only non-heartbeat events in replay count", async () => {
      const sseData = `event: stage
data: {"stage":"DRAFTING"}

: heartbeat

event: stage
data: {"stage":"COMPLETE"}

: heartbeat

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

      const result = await resumeDraftGraph(
        { baseUrl: "https://api.example.com", apiKey: "test-key" },
        { token: "test-token" }
      );

      expect(result.events).toHaveLength(4); // 2 stage + 2 heartbeat
      expect(result.replayedCount).toBe(2); // Only stage events
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
