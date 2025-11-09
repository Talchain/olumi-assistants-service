import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import { env } from "node:process";

/**
 * API Key Authentication Tests
 *
 * Tests the auth plugin behavior for different scenarios:
 * - Missing API key header
 * - Invalid API key
 * - Valid API key
 * - Healthz bypass (no auth required)
 */

describe("API Key Authentication", () => {
  let app: FastifyInstance;
  const testApiKey = "test-api-key-12345";
  const originalEnv = { ...env };

  beforeAll(async () => {
    // Set ASSIST_API_KEY for testing
    env.ASSIST_API_KEY = testApiKey;

    // Create minimal Fastify app with auth plugin
    app = Fastify({ logger: false });

    // Import and register plugins
    const authPlugin = await import("../../src/plugins/auth.js");
    const observabilityPlugin = await import("../../src/plugins/observability.js");

    await app.register(observabilityPlugin.default);
    await app.register(authPlugin.default);

    // Add test routes
    app.get("/healthz", async () => ({ ok: true }));
    app.post("/assist/draft-graph", async () => ({ graph: { nodes: [], edges: [] } }));

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    // Restore original env
    env.ASSIST_API_KEY = originalEnv.ASSIST_API_KEY;
  });

  it("allows requests to /healthz without API key", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/healthz",
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.ok).toBe(true);
  });

  it("rejects /assist/* requests with missing API key (401 UNAUTHENTICATED)", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/assist/draft-graph",
      payload: { brief: "test" },
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body);
    expect(body.schema).toBe("error.v1");
    expect(body.code).toBe("UNAUTHENTICATED");
    expect(body.message).toContain("Missing");
    expect(body.message).toContain("X-Olumi-Assist-Key");
    expect(body.details?.hint).toBeDefined();
    expect(body.request_id).toBeDefined();
  });

  it("rejects /assist/* requests with invalid API key (403 FORBIDDEN)", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/assist/draft-graph",
      headers: {
        "X-Olumi-Assist-Key": "wrong-key",
      },
      payload: { brief: "test" },
    });

    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.body);
    expect(body.schema).toBe("error.v1");
    expect(body.code).toBe("FORBIDDEN");
    expect(body.message).toContain("Invalid");
    expect(body.request_id).toBeDefined();
  });

  it("allows /assist/* requests with valid API key (200 OK)", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/assist/draft-graph",
      headers: {
        "X-Olumi-Assist-Key": testApiKey,
      },
      payload: { brief: "test" },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.graph).toBeDefined();
  });

  it("is case-insensitive for header name", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/assist/draft-graph",
      headers: {
        "x-olumi-assist-key": testApiKey, // lowercase
      },
      payload: { brief: "test" },
    });

    expect(response.statusCode).toBe(200);
  });
});

describe("Auth Disabled (no ASSIST_API_KEY)", () => {
  let app: FastifyInstance;
  const originalEnv = { ...env };

  beforeAll(async () => {
    // Unset ASSIST_API_KEY
    delete env.ASSIST_API_KEY;

    // Create app without auth
    app = Fastify({ logger: false });

    const authPlugin = await import("../../src/plugins/auth.js");
    const observabilityPlugin = await import("../../src/plugins/observability.js");

    await app.register(observabilityPlugin.default);
    await app.register(authPlugin.default);

    app.post("/assist/draft-graph", async () => ({ graph: { nodes: [], edges: [] } }));

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    env.ASSIST_API_KEY = originalEnv.ASSIST_API_KEY;
  });

  it("allows requests without API key when ASSIST_API_KEY not set", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/assist/draft-graph",
      payload: { brief: "test" },
    });

    expect(response.statusCode).toBe(200);
  });
});
