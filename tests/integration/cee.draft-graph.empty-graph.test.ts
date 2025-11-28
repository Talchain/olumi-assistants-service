/**
 * CEE v1 Draft Graph Empty Graph Integration Test
 *
 * Verifies that when the underlying draft pipeline produces an empty graph,
 * /assist/v1/draft-graph returns a CEE_GRAPH_INVALID error with reason="empty_graph".
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

// Use fixtures provider for deterministic graphs and zero cost
vi.stubEnv("LLM_PROVIDER", "fixtures");

// Avoid calling real engine validate service
vi.mock("../../src/services/validateClient.js", () => ({
  validateGraph: vi.fn().mockResolvedValue({ ok: true, violations: [], normalized: undefined }),
}));

// Avoid structural warnings interfering with envelope shape
vi.mock("../../src/cee/structure/index.js", () => ({
  detectStructuralWarnings: vi.fn().mockReturnValue({
    warnings: [],
    uncertainNodeIds: [],
  }),
}));

// Force fixtures adapter to return an empty graph
vi.mock("../../src/utils/fixtures.js", () => ({
  fixtureGraph: {
    version: "1",
    default_seed: 17,
    nodes: [],
    edges: [],
    meta: {
      roots: [],
      leaves: [],
      suggested_positions: {},
      source: "fixtures",
    },
  },
}));

import { build } from "../../src/server.js";
import { cleanBaseUrl } from "../helpers/env-setup.js";

describe("POST /assist/v1/draft-graph (CEE v1) - empty graph", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    // Allow multiple API keys so tests can use independent buckets
    vi.stubEnv("ASSIST_API_KEYS", "cee-key-empty-1,cee-key-empty-2");
    vi.stubEnv("CEE_DRAFT_FEATURE_VERSION", "draft-model-test");
    vi.stubEnv("CEE_DRAFT_RATE_LIMIT_RPM", "5");
    vi.stubEnv("CEE_DRAFT_STRUCTURAL_WARNINGS_ENABLED", "false");
    vi.stubEnv("CEE_REFINEMENT_ENABLED", "false");

    cleanBaseUrl();
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  const headers = {
    "X-Olumi-Assist-Key": "cee-key-empty-1",
  } as const;

  it("returns CEE_GRAPH_INVALID error when draft graph is empty", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/draft-graph",
      headers,
      payload: {
        brief: "A sufficiently long decision brief to trigger empty-graph invariant.",
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();

    expect(body.schema).toBe("cee.error.v1");
    expect(body.code).toBe("CEE_GRAPH_INVALID");
    expect(body.retryable).toBe(false);
    expect(body.trace).toBeDefined();
    expect(body.graph).toBeUndefined();
    expect(body.quality).toBeUndefined();

    expect(body.details).toMatchObject({
      reason: "empty_graph",
      node_count: 0,
      edge_count: 0,
    });
  });
});
