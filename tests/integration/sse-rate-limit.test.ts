import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { attachRequestId, getRequestId } from "../../src/utils/request-id.js";
import { buildErrorV1 } from "../../src/utils/errors.js";

describe("SSE-specific rate limiting", () => {
  let app: FastifyInstance;
  const SSE_RATE_LIMIT_RPM = 5; // Low limit for testing

  beforeAll(async () => {
    app = Fastify({ logger: false });

    // Register global rate limiting
    await app.register(rateLimit, {
      global: true,
      max: 120, // Global limit
      timeWindow: "1 minute",
      errorResponseBuilder: (req, context) => {
        const requestId = getRequestId(req);
        let retryAfter = 60;
        if (context.after && typeof context.after === 'number') {
          const diff = Math.ceil((context.after - Date.now()) / 1000);
          retryAfter = Math.max(1, diff);
        }
        return {
          statusCode: 429,
          schema: "error.v1",
          code: "RATE_LIMITED",
          message: "Too many requests",
          details: { retry_after_seconds: retryAfter },
          request_id: requestId,
        };
      },
    });

    // Add request ID tracking
    app.addHook("onRequest", async (request) => {
      attachRequestId(request);
    });

    // Dedicated SSE streaming endpoint with stricter rate limiting
    app.post("/test/sse-stream", {
      config: {
        rateLimit: {
          max: SSE_RATE_LIMIT_RPM,
          timeWindow: '1 minute'
        }
      }
    }, async (req, reply) => {
      reply.header("content-type", "text/event-stream");
      reply.header("connection", "keep-alive");
      return reply.send("data: test\n\n");
    });

    // Legacy endpoint with SSE via Accept header (uses global 120 RPM - NOT recommended for production)
    app.post("/test/sse-legacy", async (req, reply) => {
      const wantsSse = req.headers.accept?.includes("text/event-stream") ?? false;
      if (wantsSse) {
        reply.header("content-type", "text/event-stream");
        reply.header("connection", "keep-alive");
        return reply.send("data: test\n\n");
      }
      return reply.send({ ok: true });
    });

    // Regular JSON endpoint (uses global 120 RPM)
    app.post("/test/json", async () => {
      return { ok: true };
    });

    await app.listen({ port: 0 });
  });

  afterAll(async () => {
    await app.close();
  });

  describe("dedicated /stream endpoint", () => {
    it("should enforce 20 RPM limit on SSE stream endpoint", async () => {
      // Make requests up to the limit
      for (let i = 0; i < SSE_RATE_LIMIT_RPM; i++) {
        const response = await app.inject({
          method: "POST",
          url: "/test/sse-stream",
          headers: {
            "accept": "text/event-stream",
          },
        });
        expect(response.statusCode).toBe(200);
      }

      // This request should be rate limited
      const rateLimitedResponse = await app.inject({
        method: "POST",
        url: "/test/sse-stream",
        headers: {
          "accept": "text/event-stream",
        },
      });

      expect(rateLimitedResponse.statusCode).toBe(429);

      const body = JSON.parse(rateLimitedResponse.payload);
      expect(body.schema).toBe("error.v1");
      expect(body.code).toBe("RATE_LIMITED");
      expect(body.message).toBe("Too many requests");
      expect(body.details).toBeDefined();
      expect(body.details.retry_after_seconds).toBeGreaterThan(0);
    });

    it("should include rate limit headers on SSE stream responses", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/test/sse-stream",
        headers: {
          "accept": "text/event-stream",
        },
      });

      expect(response.headers["x-ratelimit-limit"]).toBeDefined();
      expect(response.headers["x-ratelimit-remaining"]).toBeDefined();
    });
  });

  describe("legacy SSE via Accept header", () => {
    it("should use global 120 RPM limit (DEPRECATED - use /stream instead)", async () => {
      // Legacy SSE path uses global 120 RPM limit, NOT the stricter 20 RPM
      // This test verifies the legacy behavior exists but is documented as deprecated
      const response = await app.inject({
        method: "POST",
        url: "/test/sse-legacy",
        headers: {
          "accept": "text/event-stream",
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toContain("text/event-stream");

      // Uses global rate limit headers (120 RPM), not SSE-specific (20 RPM)
      expect(response.headers["x-ratelimit-limit"]).toBe("120");
    });

    it("should handle both SSE and JSON on same endpoint", async () => {
      // SSE via Accept header
      const sseResponse = await app.inject({
        method: "POST",
        url: "/test/sse-legacy",
        headers: {
          "accept": "text/event-stream",
        },
      });
      expect(sseResponse.statusCode).toBe(200);

      // JSON (no Accept header)
      const jsonResponse = await app.inject({
        method: "POST",
        url: "/test/sse-legacy",
        payload: {},
        headers: {
          "content-type": "application/json",
        },
      });
      expect(jsonResponse.statusCode).toBe(200);
      expect(jsonResponse.json()).toEqual({ ok: true });
    });
  });

  describe("route-specific vs global limits", () => {
    it("should enforce stricter limits on dedicated /stream endpoint vs legacy path", async () => {
      // This test documents the rate limit difference:
      // - /stream endpoint: 20 RPM (SSE_RATE_LIMIT_RPM)
      // - legacy Accept header: 120 RPM (global)

      // Dedicated stream endpoint should have stricter limit
      const streamResponse = await app.inject({
        method: "POST",
        url: "/test/sse-stream",
        headers: { "accept": "text/event-stream" },
      });
      expect(streamResponse.headers["x-ratelimit-limit"]).toBe(String(SSE_RATE_LIMIT_RPM));

      // Legacy endpoint should use global limit
      const legacyResponse = await app.inject({
        method: "POST",
        url: "/test/sse-legacy",
        headers: { "accept": "text/event-stream" },
      });
      expect(legacyResponse.headers["x-ratelimit-limit"]).toBe("120");
    });
  });
});
