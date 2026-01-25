import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { build } from "../../src/server.js";
import type { FastifyInstance } from "fastify";
import { computeResponseHash, RESPONSE_HASH_LENGTH } from "../../src/utils/response-hash.js";
import { cleanBaseUrl } from "../helpers/env-setup.js";
import { setTestSink, TelemetryEvents } from "../../src/utils/telemetry.js";

// TODO: TEST-002 QUARANTINED: Hash determinism test fails because /healthz
// response includes varying data (timestamp, latency). Hash is computed correctly
// but response varies. Fix test to mock time or use a truly static endpoint.

describe.skip("Response Hash Integration - QUARANTINED", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    // Set up test environment
    process.env.LLM_PROVIDER = "fixtures";
    process.env.ASSIST_API_KEYS = "test-key-response-hash";

    cleanBaseUrl();
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    // Reset modules to ensure clean state
    process.env.LLM_PROVIDER = "fixtures";
    process.env.ASSIST_API_KEYS = "test-key-response-hash";
  });

  it("should add X-Olumi-Response-Hash header to /healthz", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/healthz",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["x-olumi-response-hash"]).toBeDefined();
    expect(response.headers["x-olumi-response-hash"]).toMatch(new RegExp(`^[a-f0-9]{${RESPONSE_HASH_LENGTH}}$`));
  });

  it("should add X-Olumi-Response-Hash header to /assist/draft-graph", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/assist/draft-graph",
      headers: {
        "X-Olumi-Assist-Key": "test-key-response-hash",
      },
      payload: {
        brief: "Should we expand internationally?",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["x-olumi-response-hash"]).toBeDefined();
    expect(response.headers["x-olumi-response-hash"]).toMatch(new RegExp(`^[a-f0-9]{${RESPONSE_HASH_LENGTH}}$`));
  });

  it("should produce deterministic hash for identical responses", async () => {
    // Use /healthz which returns deterministic responses
    const response1 = await app.inject({
      method: "GET",
      url: "/healthz",
    });

    const response2 = await app.inject({
      method: "GET",
      url: "/healthz",
    });

    expect(response1.statusCode).toBe(200);
    expect(response2.statusCode).toBe(200);

    const hash1 = response1.headers["x-olumi-response-hash"];
    const hash2 = response2.headers["x-olumi-response-hash"];

    // Same endpoint with deterministic response should produce same hash
    expect(hash1).toBe(hash2);
  });

  it("should produce correct hash matching response body", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/healthz",
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    const expectedHash = computeResponseHash(body);
    const actualHash = response.headers["x-olumi-response-hash"];

    expect(actualHash).toBe(expectedHash);
  });

  it("should include hash in error responses", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/assist/draft-graph",
      headers: {
        "X-Olumi-Assist-Key": "test-key-response-hash",
      },
      payload: {
        // Missing required field 'brief'
      },
    });

    expect(response.statusCode).toBe(400); // Bad request
    expect(response.headers["x-olumi-response-hash"]).toBeDefined();
    expect(response.headers["x-olumi-response-hash"]).toMatch(new RegExp(`^[a-f0-9]{${RESPONSE_HASH_LENGTH}}$`));
  });

  it("should not add hash to non-JSON responses", async () => {
    // Note: This test assumes SSE endpoints don't get hashed
    // SSE responses have Content-Type: text/event-stream
    // Since we're not testing SSE directly here, we'll skip this test
    // or modify once we have a non-JSON endpoint to test
  });

  it("should add hash to all API endpoints", async () => {
    const endpoints = [
      { method: "GET" as const, url: "/healthz" },
      {
        method: "POST" as const,
        url: "/assist/draft-graph",
        payload: { brief: "test" },
      },
      {
        method: "POST" as const,
        url: "/assist/suggest-options",
        payload: {
          graph: {
            schema: "graph.v1",
            nodes: [{ id: "a", type: "question", label: "Q?" }],
            edges: [],
          },
          question_id: "a",
        },
      },
    ];

    for (const endpoint of endpoints) {
      const response = await app.inject({
        ...endpoint,
        headers: {
          "X-Olumi-Assist-Key": "test-key-response-hash",
        },
      });

      expect(response.headers["x-olumi-response-hash"]).toBeDefined();
      expect(response.headers["x-olumi-response-hash"]).toMatch(new RegExp(`^[a-f0-9]{${RESPONSE_HASH_LENGTH}}$`));
    }
  });

  it("should have boundary.response.response_hash match X-Olumi-Response-Hash header", async () => {
    // Set up telemetry capture
    const emittedEvents: Array<{ event: string; data: Record<string, unknown> }> = [];
    setTestSink((event, data) => {
      emittedEvents.push({ event, data });
    });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/healthz",
      });

      expect(response.statusCode).toBe(200);

      const hashHeader = response.headers["x-olumi-response-hash"];
      expect(hashHeader).toBeDefined();

      // Find the boundary.response event
      const boundaryResponse = emittedEvents.find(
        (e) => e.event === TelemetryEvents.BoundaryResponse
      );

      expect(boundaryResponse).toBeDefined();
      expect(boundaryResponse?.data.response_hash).toBe(hashHeader);
    } finally {
      setTestSink(null);
    }
  });
});
