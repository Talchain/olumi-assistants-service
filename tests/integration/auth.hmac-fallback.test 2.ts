/**
 * HMAC + API Key Fallback Integration Tests
 *
 * Verifies that when HMAC verification fails and API keys are configured,
 * the auth plugin falls back to API key authentication instead of failing
 * hard with a 403. Also verifies that when no API keys are configured,
 * HMAC failures still return 403 as before.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

const originalEnv = { ...process.env };

describe("HMAC + API Key Fallback", () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    vi.resetModules();

    // Configure both HMAC secret and API keys
    process.env.HMAC_SECRET = "test-hmac-secret";
    process.env.ASSIST_API_KEYS = "fallback-key-1";
    process.env.LLM_PROVIDER = "fixtures";

    const { build } = await import("../../src/server.js");
    server = await build();
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
    process.env = originalEnv;
    vi.resetModules();
  });

  it("falls back to API key when HMAC verification fails but API key is valid", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/assist/draft-graph",
      headers: {
        "Content-Type": "application/json",
        "X-Olumi-Assist-Key": "fallback-key-1",
        // Provide an invalid HMAC signature to trigger fallback
        "X-Olumi-Signature": "invalid-signature",
        "X-Olumi-Timestamp": String(Date.now()),
        "X-Olumi-Nonce": "test-nonce-1",
      },
      body: JSON.stringify({
        brief: "This is a test brief that meets the minimum length requirement for validation",
      }),
    });

    // Request should still succeed via API key auth
    expect(response.statusCode).toBe(200);
  });

  it("returns 401 when HMAC fails and API key is missing", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/assist/draft-graph",
      headers: {
        "Content-Type": "application/json",
        // Invalid HMAC signature with no API key header
        "X-Olumi-Signature": "invalid-signature",
        "X-Olumi-Timestamp": String(Date.now()),
        "X-Olumi-Nonce": "test-nonce-2",
      },
      body: JSON.stringify({
        brief: "This is a test brief that meets the minimum length requirement for validation",
      }),
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body);
    expect(body.schema).toBe("error.v1");
    expect(body.code).toBe("FORBIDDEN");
    expect(body.message).toContain("Missing API key");
  });
});

describe("HMAC-only auth without API keys", () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    vi.resetModules();

    // Configure only HMAC secret (no API keys)
    delete process.env.ASSIST_API_KEY;
    delete process.env.ASSIST_API_KEYS;
    process.env.HMAC_SECRET = "test-hmac-secret-only";
    process.env.LLM_PROVIDER = "fixtures";

    const { build } = await import("../../src/server.js");
    server = await build();
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
    process.env = originalEnv;
    vi.resetModules();
  });

  it("returns 403 with specific HMAC error code when verification fails and no API keys are configured", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/assist/draft-graph",
      headers: {
        "Content-Type": "application/json",
        "X-Olumi-Signature": "invalid-signature",
        "X-Olumi-Timestamp": String(Date.now()),
        "X-Olumi-Nonce": "test-nonce-3",
      },
      body: JSON.stringify({
        brief: "This is a test brief that meets the minimum length requirement for validation",
      }),
    });

    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.body);
    expect(body.schema).toBe("error.v1");
    // For HMAC-only mode, the implementation uses the specific
    // HMAC error (e.g. INVALID_SIGNATURE) as the error code.
    expect(body.code).toBe("INVALID_SIGNATURE");
    expect(body.message).toContain("HMAC signature validation failed");
  });
});
