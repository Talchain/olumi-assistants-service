/**
 * Per-Key Quotas Integration Tests
 *
 * Tests quota enforcement at the API level with auth plugin
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { resetAllQuotas } from "../../src/utils/per-key-quotas.js";

describe("Per-Key Quotas Integration", () => {
  let server: FastifyInstance;
  const originalEnv = { ...process.env };

  beforeAll(async () => {
    // Clear module cache
    vi.resetModules();

    // Set test environment
    process.env.LLM_PROVIDER = "fixtures";
    process.env.ASSIST_API_KEYS = "test-key-A,test-key-B,test-key-C,test-key-D";

    // Set very low quotas for testing
    process.env.QUOTA_BURST = "3"; // 3 requests in 10 seconds
    process.env.QUOTA_HOURLY = "5"; // 5 requests per hour

    // Dynamic import after env is set
    const { build } = await import("../../src/server.js");
    server = await build();
    await server.ready();

    // Reset quotas before tests
    resetAllQuotas();
  });

  afterAll(async () => {
    await server.close();
    // Restore env
    process.env = originalEnv;
    vi.resetModules();
  });

  it("should allow requests within burst limit", async () => {
    // First 3 requests should succeed (burst = 3)
    for (let i = 0; i < 3; i++) {
      const response = await server.inject({
        method: "POST",
        url: "/assist/draft-graph",
        headers: {
          "X-Olumi-Assist-Key": "test-key-A",
        },
        payload: {
          brief: "This is a test brief that meets the minimum length requirement",
        },
      });

      expect(response.statusCode).toBe(200);
    }
  });

  it("should block requests exceeding burst limit", async () => {
    // Use test-key-B for this test
    // First 3 requests should succeed
    for (let i = 0; i < 3; i++) {
      await server.inject({
        method: "POST",
        url: "/assist/draft-graph",
        headers: {
          "X-Olumi-Assist-Key": "test-key-B",
        },
        payload: {
          brief: "This is a test brief that meets the minimum length requirement",
        },
      });
    }

    // 4th request should be blocked (burst exceeded)
    const response = await server.inject({
      method: "POST",
      url: "/assist/draft-graph",
      headers: {
        "X-Olumi-Assist-Key": "test-key-B",
      },
      payload: {
        brief: "This is a test brief that meets the minimum length requirement",
      },
    });

    expect(response.statusCode).toBe(429);
    const body = JSON.parse(response.body);
    expect(body.schema).toBe("error.v1");
    expect(body.code).toBe("QUOTA_EXCEEDED");
    expect(body.message).toContain("burst_limit_exceeded");
    expect(body.details.retry_after_seconds).toBeGreaterThan(0);
  });

  it("should enforce quotas per-key independently", async () => {
    // Use test-key-C (fresh) and test-key-B (exhausted from previous test)

    // test-key-B should still be blocked from previous test
    const response1 = await server.inject({
      method: "POST",
      url: "/assist/draft-graph",
      headers: {
        "X-Olumi-Assist-Key": "test-key-B",
      },
      payload: {
        brief: "This is a test brief that meets the minimum length requirement",
      },
    });
    expect(response1.statusCode).toBe(429);

    // test-key-C should succeed (fresh key, no quota used)
    const response2 = await server.inject({
      method: "POST",
      url: "/assist/draft-graph",
      headers: {
        "X-Olumi-Assist-Key": "test-key-C",
      },
      payload: {
        brief: "This is a test brief that meets the minimum length requirement",
        },
      });
    expect(response2.statusCode).toBe(200);
  });

  it("should return proper error details for quota exceeded", async () => {
    // Use test-key-D for this test
    // Exhaust burst limit
    for (let i = 0; i < 3; i++) {
      await server.inject({
        method: "POST",
        url: "/assist/draft-graph",
        headers: {
          "X-Olumi-Assist-Key": "test-key-D",
        },
        payload: {
          brief: "This is a test brief that meets the minimum length requirement",
        },
      });
    }

    // Next request should return quota error
    const response = await server.inject({
      method: "POST",
      url: "/assist/draft-graph",
      headers: {
        "X-Olumi-Assist-Key": "test-key-D",
      },
      payload: {
        brief: "This is a test brief that meets the minimum length requirement",
      },
    });

    expect(response.statusCode).toBe(429);
    const body = JSON.parse(response.body);

    expect(body.schema).toBe("error.v1");
    expect(body.code).toBe("QUOTA_EXCEEDED");
    expect(body.message).toContain("burst_limit_exceeded");
    expect(body.details).toBeDefined();
    expect(body.details.retry_after_seconds).toBeGreaterThan(0);
    expect(body.details.reason).toBe("burst_limit_exceeded");
    expect(body.request_id).toBeDefined();
  });
});
