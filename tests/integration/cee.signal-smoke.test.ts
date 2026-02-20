/**
 * Golden Brief Signal Smoke Test
 *
 * Safeguard against the pre-aborted signal regression (commit 8e7fdbc).
 * Sends a real HTTP POST through the route, confirms:
 *   1. The unified pipeline receives a non-aborted signal
 *   2. Response is 200 (not 504 CEE_TIMEOUT)
 *   3. Response completes in a reasonable time (not 1ms instant failure)
 *   4. Response contains a valid graph structure
 *
 * This test uses the fixtures adapter (no real LLM calls) so it runs
 * in CI on every push.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

// Use fixtures provider for deterministic graphs
vi.stubEnv("LLM_PROVIDER", "fixtures");

// Avoid calling real engine validate service
vi.mock("../../src/services/validateClient.js", () => ({
  validateGraph: vi.fn().mockResolvedValue({ ok: true, violations: [], normalized: undefined }),
}));

// Mock structure functions (avoid real computation — we're testing signal flow, not graph quality)
vi.mock("../../src/cee/structure/index.js", () => ({
  detectStructuralWarnings: vi.fn().mockReturnValue({ warnings: [], uncertainNodeIds: [] }),
  detectUniformStrengths: () => ({ detected: false, totalEdges: 0, defaultStrengthCount: 0, defaultStrengthPercentage: 0 }),
  detectStrengthClustering: () => ({ detected: false, coefficientOfVariation: 0, edgeCount: 0 }),
  detectSameLeverOptions: () => ({ detected: false, maxOverlapPercentage: 0, overlappingOptionPairs: [] }),
  detectMissingBaseline: () => ({ detected: false, hasBaseline: false }),
  detectGoalNoBaselineValue: () => ({ detected: false, goalHasValue: false }),
  detectZeroExternalFactors: () => ({ detected: false, factorCount: 0, externalCount: 0 }),
  checkGoalConnectivity: () => ({ status: "full", disconnectedOptions: [], weakPaths: [] }),
  computeModelQualityFactors: () => ({ estimate_confidence: 0.5, strength_variation: 0, range_confidence_coverage: 0, has_baseline_option: false }),
  normaliseDecisionBranchBeliefs: (graph: unknown) => graph,
  validateAndFixGraph: (graph: unknown) => ({
    graph, valid: true,
    fixes: { singleGoalApplied: false, outcomeBeliefsFilled: 0, decisionBranchesNormalized: false },
    warnings: [],
  }),
  fixNonCanonicalStructuralEdges: (graph: unknown) => ({ graph, fixedEdgeCount: 0, fixedEdgeIds: [], repairs: [] }),
  hasGoalNode: (graph: any) => graph?.nodes?.some((n: any) => n.kind === "goal") ?? false,
  ensureGoalNode: (graph: any) => ({ graph, goalAdded: false, inferredFrom: undefined, goalNodeId: undefined }),
}));

import { build } from "../../src/server.js";
import { _resetConfigCache } from "../../src/config/index.js";
import { cleanBaseUrl } from "../helpers/env-setup.js";

const API_KEY = "signal-smoke-test-key";

describe("Golden brief signal smoke test", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    _resetConfigCache();
    vi.stubEnv("LLM_PROVIDER", "fixtures");
    vi.stubEnv("ASSIST_API_KEYS", API_KEY);
    vi.stubEnv("CEE_UNIFIED_PIPELINE_ENABLED", "true");
    cleanBaseUrl();
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const headers = { "X-Olumi-Assist-Key": API_KEY } as const;

  it("unified pipeline POST returns 200 (signal is NOT pre-aborted)", async () => {
    const startMs = Date.now();

    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/draft-graph?schema=v3",
      headers,
      payload: { brief: "Should I hire a contractor or a full-time employee for my startup?" },
    });

    const elapsedMs = Date.now() - startMs;

    // Must NOT be a timeout (the pre-aborted signal bug caused 504)
    expect(res.statusCode).not.toBe(504);
    // Must be a successful response
    expect(res.statusCode).toBe(200);

    const body = res.json();

    // Must contain a graph with nodes and edges
    expect(body.nodes).toBeDefined();
    expect(Array.isArray(body.nodes)).toBe(true);
    expect(body.nodes.length).toBeGreaterThan(0);
    expect(body.edges).toBeDefined();
    expect(Array.isArray(body.edges)).toBe(true);

    // Must NOT have error body indicating pre-aborted signal
    expect(body.error).toBeUndefined();

    // Sanity: fixture response shouldn't take more than 5s
    // (the pre-aborted signal bug caused 1ms failures)
    expect(elapsedMs).toBeLessThan(5000);
  });

  it("unified pipeline POST sets correct response headers", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/draft-graph?schema=v3",
      headers,
      payload: { brief: "Should I buy or lease a company car?" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["x-cee-api-version"]).toBe("v3");
    expect(res.headers["x-cee-request-id"]).toBeDefined();
  });

  it("unified pipeline POST with V1 schema also returns 200", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/draft-graph?schema=v1",
      headers,
      payload: { brief: "Should I switch to a remote-first work policy?" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    // V1 response has graph wrapper
    expect(body.graph).toBeDefined();
    expect(Array.isArray(body.graph.nodes)).toBe(true);
    expect(Array.isArray(body.graph.edges)).toBe(true);
  });

  it("legacy pipeline POST also returns 200 (control group)", async () => {
    // Reset config to disable unified pipeline
    _resetConfigCache();
    vi.stubEnv("CEE_UNIFIED_PIPELINE_ENABLED", "false");
    const legacyApp = await build();
    await legacyApp.ready();

    try {
      const res = await legacyApp.inject({
        method: "POST",
        url: "/assist/v1/draft-graph?schema=v3",
        headers,
        payload: { brief: "Should I invest in marketing or product development?" },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.nodes).toBeDefined();
      expect(body.error).toBeUndefined();
    } finally {
      await legacyApp.close();
      // Restore unified pipeline for other tests
      _resetConfigCache();
      vi.stubEnv("CEE_UNIFIED_PIPELINE_ENABLED", "true");
    }
  });
});
