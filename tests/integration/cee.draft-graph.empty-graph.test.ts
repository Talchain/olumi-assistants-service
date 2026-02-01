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
  detectUniformStrengths: () => ({
    detected: false,
    totalEdges: 0,
    defaultStrengthCount: 0,
    defaultStrengthPercentage: 0,
  }),
  detectStrengthClustering: () => ({
    detected: false,
    coefficientOfVariation: 0,
    edgeCount: 0,
  }),
  detectSameLeverOptions: () => ({
    detected: false,
    maxOverlapPercentage: 0,
    overlappingOptionPairs: [],
  }),
  detectMissingBaseline: () => ({
    detected: false,
    hasBaseline: false,
  }),
  detectGoalNoBaselineValue: () => ({
    detected: false,
    goalHasValue: false,
  }),
  checkGoalConnectivity: () => ({
    status: "full",
    disconnectedOptions: [],
    weakPaths: [],
  }),
  computeModelQualityFactors: () => ({
    estimate_confidence: 0.5,
    strength_variation: 0,
    range_confidence_coverage: 0,
    has_baseline_option: false,
  }),
  normaliseDecisionBranchBeliefs: (graph: unknown) => graph,
  validateAndFixGraph: (graph: unknown) => ({
    graph,
    valid: true,
    fixes: {
      singleGoalApplied: false,
      outcomeBeliefsFilled: 0,
      decisionBranchesNormalized: false,
    },
    warnings: [],
  }),
  fixNonCanonicalStructuralEdges: (graph: unknown) => ({
    graph,
    fixedEdgeCount: 0,
    fixedEdgeIds: [],
    repairs: [],
  }),
  // Goal inference utilities
  hasGoalNode: (graph: any) => {
    if (!graph || !Array.isArray(graph.nodes)) return false;
    return graph.nodes.some((n: any) => n.kind === "goal");
  },
  ensureGoalNode: (graph: any) => ({
    graph,
    goalAdded: false,
    inferredFrom: undefined,
    goalNodeId: undefined,
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

  it("includes pipeline trace in error response for debugging", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/draft-graph",
      headers: { "X-Olumi-Assist-Key": "cee-key-empty-2" },
      payload: {
        brief: "A sufficiently long decision brief to test pipeline trace in error response.",
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();

    // Verify error response structure
    expect(body.schema).toBe("cee.error.v1");
    expect(body.code).toBe("CEE_GRAPH_INVALID");

    // Verify pipeline trace is included in error response
    expect(body.trace).toBeDefined();
    expect(body.trace.pipeline).toBeDefined();
    expect(body.trace.pipeline.status).toBe("failed");
    expect(typeof body.trace.pipeline.total_duration_ms).toBe("number");
    expect(Array.isArray(body.trace.pipeline.stages)).toBe(true);

    // Verify at least one stage is present (llm_draft)
    expect(body.trace.pipeline.stages.length).toBeGreaterThan(0);
    const llmDraftStage = body.trace.pipeline.stages.find(
      (s: any) => s.name === "llm_draft"
    );
    expect(llmDraftStage).toBeDefined();
    // In error cases, the stage may have status "failed" or "success" depending on where the error occurred
    expect(["success", "failed"]).toContain(llmDraftStage.status);
    expect(typeof llmDraftStage.duration_ms).toBe("number");
  });
});
