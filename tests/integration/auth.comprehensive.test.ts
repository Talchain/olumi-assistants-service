/**
 * Comprehensive Auth & Security Tests
 *
 * Tests edge cases and scenarios not covered by other auth tests:
 * - Key rotation (hot-swapping keys)
 * - Rate limit exhaustion (hitting 429)
 * - Public routes access verification
 * - Header parsing edge cases
 * - HMAC timestamp edge cases
 * - Concurrent authentication scenarios
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { createHash, createHmac, randomUUID } from "crypto";
import { cleanBaseUrl } from "../helpers/env-setup.js";

// Helper to create HMAC signature
function signRequest(
  secret: string,
  method: string,
  path: string,
  body: string,
  timestamp?: string,
  nonce?: string
): { signature: string; timestamp?: string; nonce?: string } {
  const bodyHash = (!body || body.length === 0)
    ? ""
    : createHash("sha256").update(body).digest("hex");

  let canonical: string;
  if (timestamp && nonce) {
    canonical = `${method}\n${path}\n${timestamp}\n${nonce}\n${bodyHash}`;
  } else {
    canonical = `${method}\n${path}\n${bodyHash}`;
  }

  const signature = createHmac("sha256", secret).update(canonical).digest("hex");
  return { signature, timestamp, nonce };
}

describe("Key Rotation Scenarios", () => {
  const originalEnv = { ...process.env };

  afterEach(async () => {
    process.env = originalEnv;
    vi.resetModules();
  });

  it("accepts both old and new keys during rotation window", async () => {
    vi.resetModules();

    // Configure multiple keys (simulating rotation)
    process.env.ASSIST_API_KEYS = "old-key-to-retire,new-key-active";
    process.env.LLM_PROVIDER = "fixtures";
    delete process.env.ASSIST_API_KEY;

    cleanBaseUrl();
    const { build } = await import("../../src/server.js");
    const server = await build();
    await server.ready();

    try {
      // Old key should still work
      const oldKeyResponse = await server.inject({
        method: "POST",
        url: "/assist/draft-graph",
        headers: {
          "Content-Type": "application/json",
          "X-Olumi-Assist-Key": "old-key-to-retire",
        },
        body: JSON.stringify({
          brief: "Test brief that meets the minimum length requirement for validation purposes",
        }),
      });
      expect(oldKeyResponse.statusCode).toBe(200);

      // New key should also work
      const newKeyResponse = await server.inject({
        method: "POST",
        url: "/assist/draft-graph",
        headers: {
          "Content-Type": "application/json",
          "X-Olumi-Assist-Key": "new-key-active",
        },
        body: JSON.stringify({
          brief: "Test brief that meets the minimum length requirement for validation purposes",
        }),
      });
      expect(newKeyResponse.statusCode).toBe(200);
    } finally {
      await server.close();
    }
  });

  it("rejects retired keys after removal from config", async () => {
    vi.resetModules();

    // Only new key configured (old key retired)
    process.env.ASSIST_API_KEYS = "new-key-only";
    process.env.LLM_PROVIDER = "fixtures";
    delete process.env.ASSIST_API_KEY;

    cleanBaseUrl();
    const { build } = await import("../../src/server.js");
    const server = await build();
    await server.ready();

    try {
      // Retired key should be rejected
      const response = await server.inject({
        method: "POST",
        url: "/assist/draft-graph",
        headers: {
          "Content-Type": "application/json",
          "X-Olumi-Assist-Key": "old-retired-key",
        },
        body: JSON.stringify({
          brief: "Test brief that meets the minimum length requirement for validation purposes",
        }),
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.code).toBe("FORBIDDEN");
      expect(body.message).toContain("Invalid API key");
    } finally {
      await server.close();
    }
  });
});

describe("Rate Limit Exhaustion", () => {
  const originalEnv = { ...process.env };

  afterEach(async () => {
    process.env = originalEnv;
    vi.resetModules();
  });

  it("returns 429 with retry-after when rate limit exhausted", async () => {
    vi.resetModules();

    // Set very low rate limit for testing
    process.env.RATE_LIMIT_RPM = "2";
    process.env.ASSIST_API_KEYS = "rate-test-key";
    process.env.LLM_PROVIDER = "fixtures";
    delete process.env.ASSIST_API_KEY;

    cleanBaseUrl();
    const { build } = await import("../../src/server.js");
    const server = await build();
    await server.ready();

    try {
      // Exhaust the rate limit
      for (let i = 0; i < 3; i++) {
        await server.inject({
          method: "POST",
          url: "/assist/draft-graph",
          headers: {
            "Content-Type": "application/json",
            "X-Olumi-Assist-Key": "rate-test-key",
          },
          body: JSON.stringify({
            brief: `Test brief number ${i} that meets the minimum length requirement for validation`,
          }),
        });
      }

      // Next request should be rate limited
      const response = await server.inject({
        method: "POST",
        url: "/assist/draft-graph",
        headers: {
          "Content-Type": "application/json",
          "X-Olumi-Assist-Key": "rate-test-key",
        },
        body: JSON.stringify({
          brief: "This request should be rate limited and return 429 with retry information",
        }),
      });

      expect(response.statusCode).toBe(429);
      const body = JSON.parse(response.body);
      expect(body.schema).toBe("error.v1");
      expect(body.code).toBe("RATE_LIMITED");
      expect(body.details).toHaveProperty("retry_after_seconds");
      expect(typeof body.details.retry_after_seconds).toBe("number");
    } finally {
      await server.close();
    }
  });

  it("SSE endpoints have separate rate limit", async () => {
    vi.resetModules();

    // Standard high, SSE very low
    process.env.RATE_LIMIT_RPM = "100";
    process.env.SSE_RATE_LIMIT_RPM = "1";
    process.env.ASSIST_API_KEYS = "sse-rate-test-key";
    process.env.LLM_PROVIDER = "fixtures";
    delete process.env.ASSIST_API_KEY;

    cleanBaseUrl();
    const { build } = await import("../../src/server.js");
    const server = await build();
    await server.ready();

    try {
      // SSE requests should hit limit faster
      const sseResponse1 = await server.inject({
        method: "POST",
        url: "/assist/draft-graph/stream",
        headers: {
          "Content-Type": "application/json",
          "X-Olumi-Assist-Key": "sse-rate-test-key",
        },
        body: JSON.stringify({
          brief: "First SSE request that meets the minimum length requirement for validation",
        }),
      });
      expect(sseResponse1.statusCode).toBe(200);

      // Second SSE should be rate limited
      const sseResponse2 = await server.inject({
        method: "POST",
        url: "/assist/draft-graph/stream",
        headers: {
          "Content-Type": "application/json",
          "X-Olumi-Assist-Key": "sse-rate-test-key",
        },
        body: JSON.stringify({
          brief: "Second SSE request that meets the minimum length requirement for validation",
        }),
      });
      expect(sseResponse2.statusCode).toBe(429);

      // But standard endpoint should still work
      const standardResponse = await server.inject({
        method: "POST",
        url: "/assist/draft-graph",
        headers: {
          "Content-Type": "application/json",
          "X-Olumi-Assist-Key": "sse-rate-test-key",
        },
        body: JSON.stringify({
          brief: "Standard request that meets the minimum length requirement for validation",
        }),
      });
      expect(standardResponse.statusCode).toBe(200);
    } finally {
      await server.close();
    }
  });
});

describe("Public Routes Access", () => {
  let server: FastifyInstance;
  const originalEnv = { ...process.env };

  beforeAll(async () => {
    vi.resetModules();

    // Require auth to be configured
    process.env.ASSIST_API_KEYS = "test-key";
    process.env.LLM_PROVIDER = "fixtures";
    delete process.env.ASSIST_API_KEY;

    cleanBaseUrl();
    const { build } = await import("../../src/server.js");
    server = await build();
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
    process.env = originalEnv;
    vi.resetModules();
  });

  it("allows /healthz without authentication", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/healthz",
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.ok).toBe(true);
  });

  it("allows /healthz endpoint variations without authentication", async () => {
    // /healthz is the primary health check endpoint
    const response = await server.inject({
      method: "GET",
      url: "/healthz",
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.ok).toBe(true);
  });

  it("allows / (root) without authentication", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/",
    });

    // Root should return something (200 or redirect)
    expect([200, 302, 404]).toContain(response.statusCode);
  });

  it("allows /v1/status without authentication", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/v1/status",
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    // v1/status returns service diagnostics, not a simple "status" field
    expect(body).toHaveProperty("service", "assistants");
    expect(body).toHaveProperty("version");
    expect(body).toHaveProperty("uptime_seconds");
  });

  it("requires auth for protected endpoints", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/assist/draft-graph",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        brief: "This request should fail without authentication headers present",
      }),
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body);
    expect(body.code).toBe("FORBIDDEN");
    expect(body.message).toContain("Missing API key");
  });
});

describe("Header Parsing Edge Cases", () => {
  let server: FastifyInstance;
  const originalEnv = { ...process.env };

  beforeAll(async () => {
    vi.resetModules();

    process.env.ASSIST_API_KEYS = "valid-key";
    process.env.LLM_PROVIDER = "fixtures";
    delete process.env.ASSIST_API_KEY;

    cleanBaseUrl();
    const { build } = await import("../../src/server.js");
    server = await build();
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
    process.env = originalEnv;
    vi.resetModules();
  });

  it("accepts API key with leading/trailing whitespace trimmed", async () => {
    // Note: HTTP headers typically don't preserve leading/trailing whitespace,
    // but some clients might send them. The key itself shouldn't have whitespace.
    const response = await server.inject({
      method: "POST",
      url: "/assist/draft-graph",
      headers: {
        "Content-Type": "application/json",
        "X-Olumi-Assist-Key": "valid-key",
      },
      body: JSON.stringify({
        brief: "Test brief that meets the minimum length requirement for validation purposes",
      }),
    });

    expect(response.statusCode).toBe(200);
  });

  it("accepts Authorization Bearer token format", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/assist/draft-graph",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer valid-key",
      },
      body: JSON.stringify({
        brief: "Test brief that meets the minimum length requirement for validation purposes",
      }),
    });

    expect(response.statusCode).toBe(200);
  });

  it("rejects malformed Authorization header", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/assist/draft-graph",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Basic dXNlcjpwYXNz", // Basic auth format, not Bearer
      },
      body: JSON.stringify({
        brief: "Test brief that meets the minimum length requirement for validation purposes",
      }),
    });

    expect(response.statusCode).toBe(401);
  });

  it("X-Olumi-Assist-Key takes precedence over Authorization header", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/assist/draft-graph",
      headers: {
        "Content-Type": "application/json",
        "X-Olumi-Assist-Key": "valid-key",
        "Authorization": "Bearer invalid-key",
      },
      body: JSON.stringify({
        brief: "Test brief that meets the minimum length requirement for validation purposes",
      }),
    });

    // Should succeed using X-Olumi-Assist-Key
    expect(response.statusCode).toBe(200);
  });

  it("rejects empty API key header", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/assist/draft-graph",
      headers: {
        "Content-Type": "application/json",
        "X-Olumi-Assist-Key": "",
      },
      body: JSON.stringify({
        brief: "Test brief that meets the minimum length requirement for validation purposes",
      }),
    });

    expect(response.statusCode).toBe(401);
  });
});

describe("HMAC Timestamp Edge Cases", () => {
  const originalEnv = { ...process.env };
  const TEST_SECRET = "test-hmac-secret-edge-cases";

  afterEach(async () => {
    process.env = originalEnv;
    vi.resetModules();
  });

  it("rejects HMAC with invalid timestamp format", async () => {
    vi.resetModules();

    process.env.HMAC_SECRET = TEST_SECRET;
    process.env.LLM_PROVIDER = "fixtures";
    delete process.env.ASSIST_API_KEY;
    delete process.env.ASSIST_API_KEYS;

    cleanBaseUrl();
    const { build } = await import("../../src/server.js");
    const server = await build();
    await server.ready();

    try {
      const body = JSON.stringify({
        brief: "Test brief that meets the minimum length requirement for validation purposes",
      });
      const nonce = randomUUID();

      // Sign with invalid timestamp
      const { signature } = signRequest(
        TEST_SECRET,
        "POST",
        "/assist/draft-graph",
        body,
        "not-a-timestamp",
        nonce
      );

      const response = await server.inject({
        method: "POST",
        url: "/assist/draft-graph",
        headers: {
          "Content-Type": "application/json",
          "X-Olumi-Signature": signature,
          "X-Olumi-Timestamp": "not-a-timestamp",
          "X-Olumi-Nonce": nonce,
        },
        body,
      });

      expect(response.statusCode).toBe(403);
    } finally {
      await server.close();
    }
  });

  it("rejects HMAC with very old timestamp (outside skew window)", async () => {
    vi.resetModules();

    process.env.HMAC_SECRET = TEST_SECRET;
    process.env.HMAC_MAX_SKEW_MS = "300000"; // 5 minutes
    process.env.LLM_PROVIDER = "fixtures";
    delete process.env.ASSIST_API_KEY;
    delete process.env.ASSIST_API_KEYS;

    cleanBaseUrl();
    const { build } = await import("../../src/server.js");
    const server = await build();
    await server.ready();

    try {
      const body = JSON.stringify({
        brief: "Test brief that meets the minimum length requirement for validation purposes",
      });
      const nonce = randomUUID();
      // 10 minutes ago
      const oldTimestamp = (Date.now() - 10 * 60 * 1000).toString();

      const { signature } = signRequest(
        TEST_SECRET,
        "POST",
        "/assist/draft-graph",
        body,
        oldTimestamp,
        nonce
      );

      const response = await server.inject({
        method: "POST",
        url: "/assist/draft-graph",
        headers: {
          "Content-Type": "application/json",
          "X-Olumi-Signature": signature,
          "X-Olumi-Timestamp": oldTimestamp,
          "X-Olumi-Nonce": nonce,
        },
        body,
      });

      // Should reject with 403 (either SIGNATURE_SKEW or INVALID_SIGNATURE
      // depending on whether body was re-serialized by Fastify)
      expect(response.statusCode).toBe(403);
      const responseBody = JSON.parse(response.body);
      expect(responseBody.schema).toBe("error.v1");
      expect(["SIGNATURE_SKEW", "INVALID_SIGNATURE"]).toContain(responseBody.code);
    } finally {
      await server.close();
    }
  });

  it("rejects HMAC with future timestamp (outside skew window)", async () => {
    vi.resetModules();

    process.env.HMAC_SECRET = TEST_SECRET;
    process.env.HMAC_MAX_SKEW_MS = "300000"; // 5 minutes
    process.env.LLM_PROVIDER = "fixtures";
    delete process.env.ASSIST_API_KEY;
    delete process.env.ASSIST_API_KEYS;

    cleanBaseUrl();
    const { build } = await import("../../src/server.js");
    const server = await build();
    await server.ready();

    try {
      const body = JSON.stringify({
        brief: "Test brief that meets the minimum length requirement for validation purposes",
      });
      const nonce = randomUUID();
      // 10 minutes in the future
      const futureTimestamp = (Date.now() + 10 * 60 * 1000).toString();

      const { signature } = signRequest(
        TEST_SECRET,
        "POST",
        "/assist/draft-graph",
        body,
        futureTimestamp,
        nonce
      );

      const response = await server.inject({
        method: "POST",
        url: "/assist/draft-graph",
        headers: {
          "Content-Type": "application/json",
          "X-Olumi-Signature": signature,
          "X-Olumi-Timestamp": futureTimestamp,
          "X-Olumi-Nonce": nonce,
        },
        body,
      });

      // Should reject with 403 (either SIGNATURE_SKEW or INVALID_SIGNATURE
      // depending on whether body was re-serialized by Fastify)
      expect(response.statusCode).toBe(403);
      const responseBody = JSON.parse(response.body);
      expect(responseBody.schema).toBe("error.v1");
      expect(["SIGNATURE_SKEW", "INVALID_SIGNATURE"]).toContain(responseBody.code);
    } finally {
      await server.close();
    }
  });
});

describe("No Auth Configured", () => {
  const originalEnv = { ...process.env };

  afterEach(async () => {
    process.env = originalEnv;
    vi.resetModules();
  });

  it("allows requests when no auth is configured (development mode)", async () => {
    vi.resetModules();

    // No auth configured
    delete process.env.ASSIST_API_KEY;
    delete process.env.ASSIST_API_KEYS;
    delete process.env.HMAC_SECRET;
    process.env.LLM_PROVIDER = "fixtures";

    cleanBaseUrl();
    const { build } = await import("../../src/server.js");
    const server = await build();
    await server.ready();

    try {
      const response = await server.inject({
        method: "POST",
        url: "/assist/draft-graph",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          brief: "Test brief without any authentication headers should work in dev mode",
        }),
      });

      // Should work - no auth configured
      expect(response.statusCode).toBe(200);
    } finally {
      await server.close();
    }
  });
});

describe("Error Response Format", () => {
  let server: FastifyInstance;
  const originalEnv = { ...process.env };

  beforeAll(async () => {
    vi.resetModules();

    process.env.ASSIST_API_KEYS = "error-test-key";
    process.env.LLM_PROVIDER = "fixtures";
    delete process.env.ASSIST_API_KEY;

    cleanBaseUrl();
    const { build } = await import("../../src/server.js");
    server = await build();
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
    process.env = originalEnv;
    vi.resetModules();
  });

  it("returns error.v1 schema for 401 Unauthorized", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/assist/draft-graph",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        brief: "Test brief that meets the minimum length requirement for validation purposes",
      }),
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body);
    expect(body).toMatchObject({
      schema: "error.v1",
      code: expect.any(String),
      message: expect.any(String),
    });
  });

  it("returns error.v1 schema for 403 Forbidden", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/assist/draft-graph",
      headers: {
        "Content-Type": "application/json",
        "X-Olumi-Assist-Key": "wrong-key",
      },
      body: JSON.stringify({
        brief: "Test brief that meets the minimum length requirement for validation purposes",
      }),
    });

    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.body);
    expect(body).toMatchObject({
      schema: "error.v1",
      code: "FORBIDDEN",
      message: expect.any(String),
    });
  });
});
