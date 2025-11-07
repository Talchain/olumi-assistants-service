import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { attachRequestId, getRequestId } from "../../src/utils/request-id.js";
import { toErrorV1, getStatusCodeForErrorCode } from "../../src/utils/errors.js";

describe("rate limiting integration", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    // Create a test server with rate limiting
    app = Fastify({ logger: false });

    // Register rate limiting (lower limits for faster testing)
    await app.register(rateLimit, {
      global: true,
      max: 5, // 5 requests per minute (for testing)
      timeWindow: "1 minute",
      addHeaders: {
        "x-ratelimit-limit": true,
        "x-ratelimit-remaining": true,
        "x-ratelimit-reset": true,
        "retry-after": true,
      },
      errorResponseBuilder: (req, context) => {
        const requestId = getRequestId(req);
        const retryAfter = Math.ceil((context.after - Date.now()) / 1000);
        return {
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

    // Add error handler
    app.setErrorHandler((error, request, reply) => {
      const errorV1 = toErrorV1(error, request);
      const statusCode = getStatusCodeForErrorCode(errorV1.code);
      return reply.status(statusCode).send(errorV1);
    });

    // Test endpoint
    app.get("/test", async () => {
      return { ok: true };
    });

    await app.listen({ port: 0 }); // Random port
  });

  afterAll(async () => {
    await app.close();
  });

  it("should allow requests within limit", async () => {
    // Make 3 requests (under the limit of 5)
    for (let i = 0; i < 3; i++) {
      const response = await app.inject({
        method: "GET",
        url: "/test",
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["x-ratelimit-remaining"]).toBeDefined();
    }
  });

  it("should return rate limit headers on successful requests", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/test",
    });

    expect(response.headers["x-ratelimit-limit"]).toBeDefined();
    expect(response.headers["x-ratelimit-remaining"]).toBeDefined();
    expect(response.headers["x-ratelimit-reset"]).toBeDefined();
  });

  it("should reject requests after exceeding limit", async () => {
    // Make requests up to the limit (5)
    for (let i = 0; i < 5; i++) {
      await app.inject({
        method: "GET",
        url: "/test",
      });
    }

    // This request should be rate limited
    const response = await app.inject({
      method: "GET",
      url: "/test",
    });

    expect(response.statusCode).toBe(429);

    const body = JSON.parse(response.payload);
    expect(body.schema).toBe("error.v1");
    expect(body.code).toBe("RATE_LIMITED");
    expect(body.message).toBe("Too many requests");
  });

  it("should include retry_after_seconds in rate limit error", async () => {
    // Exhaust rate limit
    for (let i = 0; i < 6; i++) {
      await app.inject({
        method: "GET",
        url: "/test",
      });
    }

    // Get rate limited response
    const response = await app.inject({
      method: "GET",
      url: "/test",
    });

    const body = JSON.parse(response.payload);
    expect(body.details).toHaveProperty("retry_after_seconds");
    expect(typeof body.details.retry_after_seconds).toBe("number");
    expect(body.details.retry_after_seconds).toBeGreaterThan(0);
  });

  it("should include Retry-After header in response", async () => {
    // Exhaust rate limit
    for (let i = 0; i < 6; i++) {
      await app.inject({
        method: "GET",
        url: "/test",
      });
    }

    const response = await app.inject({
      method: "GET",
      url: "/test",
    });

    expect(response.headers["retry-after"]).toBeDefined();
    expect(Number(response.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("should include request_id in rate limit error", async () => {
    // Exhaust rate limit
    for (let i = 0; i < 6; i++) {
      await app.inject({
        method: "GET",
        url: "/test",
      });
    }

    const response = await app.inject({
      method: "GET",
      url: "/test",
      headers: {
        "X-Request-Id": "rate-limit-test-123",
      },
    });

    const body = JSON.parse(response.payload);
    expect(body.request_id).toBeDefined();
  });

  it("should track rate limit per IP", async () => {
    // Create separate apps to simulate different IPs
    const app2 = Fastify({ logger: false });

    await app2.register(rateLimit, {
      global: true,
      max: 2,
      timeWindow: "1 minute",
    });

    app2.get("/test", async () => ({ ok: true }));

    await app2.listen({ port: 0 });

    // First app can still make requests
    const response1 = await app.inject({
      method: "GET",
      url: "/test",
    });

    // Second app has independent rate limit
    const response2 = await app2.inject({
      method: "GET",
      url: "/test",
    });

    expect(response1.statusCode).toBeLessThan(400);
    expect(response2.statusCode).toBe(200);

    await app2.close();
  });

  it("should decrement X-RateLimit-Remaining with each request", async () => {
    // Create a fresh app to test header progression
    const app3 = Fastify({ logger: false });

    await app3.register(rateLimit, {
      global: true,
      max: 3,
      timeWindow: "1 minute",
      addHeaders: {
        "x-ratelimit-limit": true,
        "x-ratelimit-remaining": true,
      },
    });

    app3.get("/test", async () => ({ ok: true }));

    await app3.listen({ port: 0 });

    const response1 = await app3.inject({ method: "GET", url: "/test" });
    const remaining1 = Number(response1.headers["x-ratelimit-remaining"]);

    const response2 = await app3.inject({ method: "GET", url: "/test" });
    const remaining2 = Number(response2.headers["x-ratelimit-remaining"]);

    const response3 = await app3.inject({ method: "GET", url: "/test" });
    const remaining3 = Number(response3.headers["x-ratelimit-remaining"]);

    expect(remaining1).toBeGreaterThan(remaining2);
    expect(remaining2).toBeGreaterThan(remaining3);
    expect(remaining3).toBe(0);

    await app3.close();
  });
});
