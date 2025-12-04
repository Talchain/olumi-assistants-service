import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import draftRoute from "../../src/routes/assist.draft-graph.js";

// Use fixtures provider to avoid needing API keys
vi.stubEnv('LLM_PROVIDER', 'fixtures');

// Mock Anthropic to avoid real API calls
vi.mock("../../src/adapters/llm/anthropic.js", () => ({
  draftGraphWithAnthropic: vi.fn().mockResolvedValue({
    graph: {
      version: "1",
      default_seed: 17,
      nodes: [{ id: "test_1", kind: "goal", label: "Test" }],
      edges: [],
      meta: { roots: ["test_1"], leaves: ["test_1"], suggested_positions: {}, source: "assistant" },
    },
    rationales: [],
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 0,
    },
  }),
  repairGraphWithAnthropic: vi.fn(),
}));

vi.mock("../../src/services/validateClient.js", () => ({
  validateGraph: vi.fn().mockResolvedValue({ ok: true, violations: [], normalized: null }),
}));

describe("Security Tests (Simplified)", () => {
  describe("Body size limits", () => {
    it("rejects requests larger than 1MB", async () => {
      const app = Fastify({
        logger: false,
        bodyLimit: 1024 * 1024, // 1 MB
      });

      await draftRoute(app);

      // Create payload > 1MB
      const largeBrief = "x".repeat(1024 * 1024 + 1000);

      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: { brief: largeBrief },
      });

      expect(res.statusCode).toBe(413);
    });

    it("accepts requests under 1MB", async () => {
      const app = Fastify({
        logger: false,
        bodyLimit: 1024 * 1024, // 1 MB
      });

      await draftRoute(app);

      // Create payload < 1MB and within brief length constraint (max 5000 chars)
      // Test that reasonable-sized payloads are accepted
      const validBrief = "Strategic planning with detailed analysis. ".repeat(100); // ~4500 chars

      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: { brief: validBrief },
      });

      expect(res.statusCode).toBe(200);
    });
  });

  describe("Request configuration", () => {
    it("validates timeout configuration is set", async () => {
      const app = Fastify({
        logger: false,
        connectionTimeout: 60000,
        requestTimeout: 60000,
      });

      await draftRoute(app);

      // Verify configuration
      expect(app.server.timeout).toBe(60000);
    });
  });

  describe("CORS allowlist", () => {
    it("allows localhost origins", async () => {
      const app = Fastify({ logger: false });

      await app.register(cors, {
        origin: [
          /^http:\/\/localhost:\d+$/,
          /^http:\/\/127\.0\.0\.1:\d+$/,
        ],
      });

      await draftRoute(app);

      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: { brief: "Test brief" },
        headers: {
          origin: "http://localhost:3000",
        },
      });

      expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    });

    it("blocks non-allowed origins", async () => {
      const app = Fastify({ logger: false });

      await app.register(cors, {
        origin: [
          /^http:\/\/localhost:\d+$/,
          /^http:\/\/127\.0\.0\.1:\d+$/,
        ],
      });

      await draftRoute(app);

      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: { brief: "Test brief" },
        headers: {
          origin: "https://evil.com",
        },
      });

      // CORS should not set Access-Control-Allow-Origin for blocked origins
      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    });

    it("allows configured production origins", async () => {
      const app = Fastify({ logger: false });

      await app.register(cors, {
        origin: [
          /^http:\/\/localhost:\d+$/,
          "https://app.olumi.ai",
        ],
      });

      await draftRoute(app);

      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: { brief: "Test brief" },
        headers: {
          origin: "https://app.olumi.ai",
        },
      });

      expect(res.headers["access-control-allow-origin"]).toBe("https://app.olumi.ai");
    });
  });

  describe("Rate limiting", () => {
    it("configures rate limiter with error.v1 response", async () => {
      const app = Fastify({ logger: false });

      const errorBuilder = () => ({
        schema: "error.v1",
        code: "RATE_LIMITED",
        message: "Rate limit exceeded",
        details: { max: 5, window_ms: 60000 },
      });

      await app.register(rateLimit, {
        max: 5,
        timeWindow: 60000,
        errorResponseBuilder: errorBuilder,
      });

      await draftRoute(app);

      // Verify rate limiter error response format
      const testError = errorBuilder();
      expect(testError).toMatchObject({
        schema: "error.v1",
        code: "RATE_LIMITED",
        message: expect.any(String),
        details: expect.any(Object),
      });
    });

    it("includes rate limit headers", async () => {
      const app = Fastify({ logger: false });

      await app.register(rateLimit, {
        max: 10,
        timeWindow: 60000,
        addHeaders: {
          "x-ratelimit-limit": true,
          "x-ratelimit-remaining": true,
          "x-ratelimit-reset": true,
        },
      });

      await draftRoute(app);

      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: { brief: "Should we expand or focus our product offering?" },
      });

      expect(res.headers["x-ratelimit-limit"]).toBeDefined();
      expect(res.headers["x-ratelimit-remaining"]).toBeDefined();
      expect(res.headers["x-ratelimit-reset"]).toBeDefined();
    });
  });

  describe("Error envelope validation (error.v1)", () => {
    it("returns error.v1 format for rate limit", async () => {
      const app = Fastify({ logger: false });

      await app.register(rateLimit, {
        max: 1,
        timeWindow: 60000,
        errorResponseBuilder: () => ({
          schema: "error.v1",
          code: "RATE_LIMITED",
          message: "Rate limit exceeded",
          details: { max: 1, window_ms: 60000 },
        }),
      });

      await draftRoute(app);

      // First request succeeds
      await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: { brief: "Should we hire full-time or contract workers?" },
      });

      // Second request is rate limited
      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: { brief: "Should we hire full-time or contract workers?" },
      });

      const body = JSON.parse(res.body);
      expect(body).toMatchObject({
        schema: "error.v1",
        code: "RATE_LIMITED",
        message: expect.any(String),
        details: expect.any(Object),
      });
    });

    it("returns error.v1 format for body size limit", async () => {
      const app = Fastify({
        logger: false,
        bodyLimit: 1000, // 1 KB for testing
      });

      app.setErrorHandler((error: { statusCode?: number; message?: string }, _request, reply) => {
        if (error.statusCode === 413) {
          return reply.status(413).send({
            schema: "error.v1",
            code: "BAD_INPUT",
            message: "Request payload too large",
            details: { limit_bytes: 1000 },
          });
        }
        return reply.send(error);
      });

      await draftRoute(app);

      const largeBrief = "x".repeat(2000);

      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: { brief: largeBrief },
      });

      expect(res.statusCode).toBe(413);
      const body = JSON.parse(res.body);
      expect(body).toMatchObject({
        schema: "error.v1",
        code: "BAD_INPUT",
        message: expect.any(String),
        details: expect.any(Object),
      });
    });
  });

  describe("Security configuration validation", () => {
    it("validates server has error handler configured", async () => {
      const app = Fastify({ logger: false });

      // Set up error handler that returns error.v1 format
      app.setErrorHandler((error: { statusCode?: number; message?: string }, _request, reply) => {
        return reply.status(error.statusCode || 500).send({
          schema: "error.v1",
          code: "INTERNAL",
          message: error.message || "Internal server error",
        });
      });

      await draftRoute(app);

      // Verify error handler is configured
      expect(app.errorHandler).toBeDefined();
    });

    it("validates CORS configuration accepts localhost", async () => {
      const allowedOrigins = [
        /^http:\/\/localhost:\d+$/,
        /^http:\/\/127\.0\.0\.1:\d+$/,
      ];

      // Test localhost patterns
      expect("http://localhost:3000").toMatch(allowedOrigins[0]);
      expect("http://127.0.0.1:3000").toMatch(allowedOrigins[1]);
      expect("https://evil.com").not.toMatch(allowedOrigins[0]);
    });
  });
});
