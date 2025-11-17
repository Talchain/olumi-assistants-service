import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { build } from "../../src/server.js";

/**
 * /v1/limits Integration Tests
 *
 * Verifies quota limits and graph caps are exposed for the authenticated key.
 */

describe("GET /v1/limits", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    // Configure API key and graph caps for deterministic tests
    vi.stubEnv("ASSIST_API_KEYS", "test-key-limits");
    vi.stubEnv("GRAPH_MAX_NODES", "50");
    vi.stubEnv("GRAPH_MAX_EDGES", "200");
    vi.stubEnv("RATE_LIMIT_RPM", "120");
    vi.stubEnv("SSE_RATE_LIMIT_RPM", "20");

    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it("rejects unauthenticated requests", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/limits",
    });

    expect(response.statusCode).toBe(401);
    const body = response.json();
    expect(body.schema).toBe("error.v1");
    expect(body.code).toBe("FORBIDDEN");
  });

  it("returns limits for authenticated key including graph caps", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/limits",
      headers: {
        "X-Olumi-Assist-Key": "test-key-limits",
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();

    expect(body.schema).toBe("limits.v1");
    expect(typeof body.key_id).toBe("string");
    expect(body.key_id.length).toBeGreaterThan(0);

    // Quota fields
    expect(body.rate_limit_rpm).toBe(120);
    expect(body.sse_rate_limit_rpm).toBe(20);
    expect(["redis", "memory"]).toContain(body.quota_backend);

    // Graph caps should reflect configured values
    expect(body.graph_max_nodes).toBe(50);
    expect(body.graph_max_edges).toBe(200);
  });
});
