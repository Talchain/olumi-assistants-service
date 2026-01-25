/**
 * Request Timing Tests
 *
 * Unit tests for the request timing context utility.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyRequest } from "fastify";
import {
  getOrCreateTiming,
  getTiming,
  recordLlmCall,
  recordDownstreamCall,
  getTimingSummary,
  withLlmTiming,
  withDownstreamTiming,
} from "../../src/utils/request-timing.js";
import { setTestSink, TelemetryEvents } from "../../src/utils/telemetry.js";
import { attachRequestId } from "../../src/utils/request-id.js";

describe("Request Timing Context", () => {
  let emittedEvents: Array<{ event: string; data: Record<string, any> }>;

  beforeEach(() => {
    emittedEvents = [];
    setTestSink((event, data) => {
      emittedEvents.push({ event, data });
    });
  });

  afterEach(() => {
    setTestSink(null);
  });

  /**
   * Helper to create a Fastify app with a test route and run a test
   */
  async function withTestApp(
    routeHandler: (request: FastifyRequest) => Promise<{ ok: boolean }>
  ): Promise<void> {
    const app = Fastify({ logger: false });

    // Register request ID hook
    app.addHook("onRequest", async (request) => {
      attachRequestId(request);
    });

    app.get("/test", routeHandler);
    await app.ready();

    try {
      await app.inject({ method: "GET", url: "/test" });
    } finally {
      await app.close();
    }
  }

  describe("getOrCreateTiming", () => {
    it("should create a new timing context if none exists", async () => {
      await withTestApp(async (request) => {
        const context = getOrCreateTiming(request);
        expect(context).toBeDefined();
        expect(context.llm_calls).toEqual([]);
        expect(context.downstream_calls).toEqual([]);
        return { ok: true };
      });
    });

    it("should return the same context on subsequent calls", async () => {
      await withTestApp(async (request) => {
        const context1 = getOrCreateTiming(request);
        const context2 = getOrCreateTiming(request);
        expect(context1).toBe(context2);
        return { ok: true };
      });
    });
  });

  describe("getTiming", () => {
    it("should return undefined if no context exists", async () => {
      await withTestApp(async (request) => {
        const context = getTiming(request);
        expect(context).toBeUndefined();
        return { ok: true };
      });
    });

    it("should return the context after it is created", async () => {
      await withTestApp(async (request) => {
        expect(getTiming(request)).toBeUndefined();
        getOrCreateTiming(request);
        expect(getTiming(request)).toBeDefined();
        return { ok: true };
      });
    });
  });

  describe("recordLlmCall", () => {
    it("should record an LLM call and emit llm.call event", async () => {
      await withTestApp(async (request) => {
        recordLlmCall(request, "draft_graph", "gpt-4o-mini", "openai", 1500, {
          prompt: 1000,
          completion: 500,
        });
        return { ok: true };
      });

      const llmCallEvent = emittedEvents.find((e) => e.event === TelemetryEvents.LlmCall);
      expect(llmCallEvent).toBeDefined();
      expect(llmCallEvent?.data.step).toBe("draft_graph");
      expect(llmCallEvent?.data.model).toBe("gpt-4o-mini");
      expect(llmCallEvent?.data.provider).toBe("openai");
      expect(llmCallEvent?.data.elapsed_ms).toBe(1500);
      expect(llmCallEvent?.data.tokens_prompt).toBe(1000);
      expect(llmCallEvent?.data.tokens_completion).toBe(500);
    });

    it("should accumulate multiple LLM calls", async () => {
      let capturedContext: any;

      await withTestApp(async (request) => {
        recordLlmCall(request, "extract", "gpt-4o-mini", "openai", 500);
        recordLlmCall(request, "generate", "gpt-4o", "openai", 2000);
        capturedContext = getTiming(request);
        return { ok: true };
      });

      expect(capturedContext?.llm_calls).toHaveLength(2);
    });
  });

  describe("recordDownstreamCall", () => {
    it("should record a downstream call and emit downstream.call event", async () => {
      await withTestApp(async (request) => {
        recordDownstreamCall(request, "isl", 800, "synthesize", 200);
        return { ok: true };
      });

      const downstreamEvent = emittedEvents.find((e) => e.event === TelemetryEvents.DownstreamCall);
      expect(downstreamEvent).toBeDefined();
      expect(downstreamEvent?.data.target).toBe("isl");
      expect(downstreamEvent?.data.operation).toBe("synthesize");
      expect(downstreamEvent?.data.elapsed_ms).toBe(800);
      expect(downstreamEvent?.data.status).toBe(200);
    });

    it("should accumulate multiple downstream calls", async () => {
      let capturedContext: any;

      await withTestApp(async (request) => {
        recordDownstreamCall(request, "isl", 500, "synthesize");
        recordDownstreamCall(request, "vector-db", 200, "query");
        capturedContext = getTiming(request);
        return { ok: true };
      });

      expect(capturedContext?.downstream_calls).toHaveLength(2);
    });
  });

  describe("getTimingSummary", () => {
    it("should return undefined if no calls recorded", async () => {
      let capturedSummary: any;

      await withTestApp(async (request) => {
        capturedSummary = getTimingSummary(request);
        return { ok: true };
      });

      expect(capturedSummary).toBeUndefined();
    });

    it("should return undefined if context exists but no calls made", async () => {
      let capturedSummary: any;

      await withTestApp(async (request) => {
        getOrCreateTiming(request);
        capturedSummary = getTimingSummary(request);
        return { ok: true };
      });

      expect(capturedSummary).toBeUndefined();
    });

    it("should aggregate LLM call timings", async () => {
      let capturedSummary: any;

      await withTestApp(async (request) => {
        recordLlmCall(request, "extract", "gpt-4o-mini", "openai", 500, { prompt: 100, completion: 50 });
        recordLlmCall(request, "generate", "gpt-4o", "openai", 2000, { prompt: 500, completion: 300 });
        capturedSummary = getTimingSummary(request);
        return { ok: true };
      });

      expect(capturedSummary?.llm.total_ms).toBe(2500);
      expect(capturedSummary?.llm.call_count).toBe(2);
      expect(capturedSummary?.llm.calls).toHaveLength(2);
      expect(capturedSummary?.llm.calls[0]).toEqual({ step: "extract", elapsed_ms: 500 });
      expect(capturedSummary?.llm.calls[1]).toEqual({ step: "generate", elapsed_ms: 2000 });

      expect(capturedSummary?.tokens.prompt).toBe(600);
      expect(capturedSummary?.tokens.completion).toBe(350);
      expect(capturedSummary?.tokens.total).toBe(950);
    });

    it("should aggregate downstream call timings", async () => {
      let capturedSummary: any;

      await withTestApp(async (request) => {
        recordDownstreamCall(request, "isl", 800, "synthesize");
        recordDownstreamCall(request, "vector-db", 200, "query");
        capturedSummary = getTimingSummary(request);
        return { ok: true };
      });

      expect(capturedSummary?.downstream.total_ms).toBe(1000);
      expect(capturedSummary?.downstream.call_count).toBe(2);
      expect(capturedSummary?.downstream.calls).toHaveLength(2);
      expect(capturedSummary?.downstream.calls[0]).toEqual({ target: "isl", elapsed_ms: 800 });
      expect(capturedSummary?.downstream.calls[1]).toEqual({ target: "vector-db", elapsed_ms: 200 });
    });

    it("should handle mixed LLM and downstream calls", async () => {
      let capturedSummary: any;

      await withTestApp(async (request) => {
        recordLlmCall(request, "draft", "gpt-4o", "openai", 3000, { prompt: 1000, completion: 800 });
        recordDownstreamCall(request, "isl", 500, "synthesize");
        recordLlmCall(request, "repair", "gpt-4o-mini", "openai", 1000, { prompt: 200, completion: 100 });
        capturedSummary = getTimingSummary(request);
        return { ok: true };
      });

      expect(capturedSummary?.llm.total_ms).toBe(4000);
      expect(capturedSummary?.llm.call_count).toBe(2);
      expect(capturedSummary?.downstream.total_ms).toBe(500);
      expect(capturedSummary?.downstream.call_count).toBe(1);
      expect(capturedSummary?.tokens.total).toBe(2100);
    });
  });

  describe("withLlmTiming", () => {
    it("should record timing for successful LLM calls", async () => {
      let capturedContext: any;

      await withTestApp(async (request) => {
        const result = await withLlmTiming(
          request,
          "test_step",
          "test-model",
          "test-provider",
          async () => {
            await new Promise((r) => setTimeout(r, 50));
            return { data: "result", usage: { input_tokens: 100, output_tokens: 50 } };
          }
        );

        expect(result.data).toBe("result");
        capturedContext = getTiming(request);
        return { ok: true };
      });

      expect(capturedContext?.llm_calls).toHaveLength(1);
      expect(capturedContext?.llm_calls[0].step).toBe("test_step");
      expect(capturedContext?.llm_calls[0].elapsed_ms).toBeGreaterThanOrEqual(50);
      expect(capturedContext?.llm_calls[0].tokens_prompt).toBe(100);
      expect(capturedContext?.llm_calls[0].tokens_completion).toBe(50);
    });

    it("should record timing even on failure", async () => {
      let capturedContext: any;

      await withTestApp(async (request) => {
        try {
          await withLlmTiming(request, "failing_step", "test-model", "test-provider", async () => {
            await new Promise((r) => setTimeout(r, 25));
            throw new Error("LLM call failed");
          });
        } catch {
          // Expected
        }

        capturedContext = getTiming(request);
        return { ok: true };
      });

      expect(capturedContext?.llm_calls).toHaveLength(1);
      expect(capturedContext?.llm_calls[0].step).toBe("failing_step");
      expect(capturedContext?.llm_calls[0].elapsed_ms).toBeGreaterThanOrEqual(20);
      expect(capturedContext?.llm_calls[0].tokens_prompt).toBeUndefined();
    });
  });

  describe("withDownstreamTiming", () => {
    it("should record timing for successful downstream calls", async () => {
      let capturedContext: any;

      await withTestApp(async (request) => {
        const result = await withDownstreamTiming(request, "test-service", "fetch", async () => {
          await new Promise((r) => setTimeout(r, 40));
          return { data: "downstream-result" };
        });

        expect(result.data).toBe("downstream-result");
        capturedContext = getTiming(request);
        return { ok: true };
      });

      expect(capturedContext?.downstream_calls).toHaveLength(1);
      expect(capturedContext?.downstream_calls[0].target).toBe("test-service");
      expect(capturedContext?.downstream_calls[0].operation).toBe("fetch");
      expect(capturedContext?.downstream_calls[0].elapsed_ms).toBeGreaterThanOrEqual(35);
    });

    it("should record timing even on failure", async () => {
      let capturedContext: any;

      await withTestApp(async (request) => {
        try {
          await withDownstreamTiming(request, "failing-service", "call", async () => {
            await new Promise((r) => setTimeout(r, 25));
            throw new Error("Downstream call failed");
          });
        } catch {
          // Expected
        }

        capturedContext = getTiming(request);
        return { ok: true };
      });

      expect(capturedContext?.downstream_calls).toHaveLength(1);
      expect(capturedContext?.downstream_calls[0].target).toBe("failing-service");
      expect(capturedContext?.downstream_calls[0].elapsed_ms).toBeGreaterThanOrEqual(20);
    });
  });
});
