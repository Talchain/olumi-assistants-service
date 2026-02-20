/**
 * Legacy Route Handler: Constraint-Drop Blocker Tests
 *
 * Verifies that STRP CONSTRAINT_DROPPED mutations in the V1 response
 * are surfaced as analysis_ready.blockers in the V3 transform path.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

// Use fixtures provider
vi.stubEnv("LLM_PROVIDER", "fixtures");

// Mock the pipeline to return a controlled V1 response with STRP constraint drops
vi.mock("../../src/cee/validation/pipeline.js", async (importOriginal) => {
  const mod = await importOriginal() as Record<string, unknown>;
  return {
    ...mod,
    finaliseCeeDraftResponse: vi.fn(),
  };
});

// Mock structure functions (avoid real computation)
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

// Avoid real engine validate
vi.mock("../../src/services/validateClient.js", () => ({
  validateGraph: vi.fn().mockResolvedValue({ ok: true, violations: [], normalized: undefined }),
}));

import { build } from "../../src/server.js";
import { _resetConfigCache } from "../../src/config/index.js";
import { cleanBaseUrl } from "../helpers/env-setup.js";
import { finaliseCeeDraftResponse } from "../../src/cee/validation/pipeline.js";

const API_KEY = "constraint-blocker-test-key";

// V1 response body that includes STRP constraint drops
const v1ResponseWithConstraintDrops = {
  graph: {
    nodes: [
      { id: "goal_1", kind: "goal", label: "Main Goal" },
      { id: "opt_1", kind: "option", label: "Option A" },
      { id: "opt_2", kind: "option", label: "Option B" },
      { id: "fac_1", kind: "factor", label: "Factor One", category: "controllable", data: { value: 42 } },
    ],
    edges: [
      { from: "opt_1", to: "fac_1", strength_mean: 0.5, strength_std: 0.1 },
      { from: "opt_2", to: "fac_1", strength_mean: 0.3, strength_std: 0.1 },
      { from: "fac_1", to: "goal_1", strength_mean: 0.7, strength_std: 0.2 },
    ],
    version: "1.2",
  },
  trace: {
    request_id: "test-req",
    strp: {
      mutation_count: 2,
      rules_triggered: ["constraint_target"],
      mutations: [
        {
          rule: "constraint_target",
          code: "CONSTRAINT_DROPPED",
          constraint_id: "c_max_churn",
          field: "node_id",
          before: "fac_monthly_churn",
          after: null,
          reason: 'Constraint with node_id "fac_monthly_churn" dropped — no matching node found',
          severity: "info",
        },
        {
          rule: "constraint_target",
          code: "CONSTRAINT_DROPPED",
          constraint_id: "c_min_revenue",
          field: "node_id",
          before: "fac_revenue_growth",
          after: null,
          reason: 'Constraint with node_id "fac_revenue_growth" dropped — no matching node found',
          severity: "info",
        },
      ],
    },
  },
  quality: { score: 0.75, level: "good" },
  confidence: 0.85,
  seed: "42",
};

describe("Legacy V3 route: constraint-drop blockers", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    _resetConfigCache();
    vi.stubEnv("LLM_PROVIDER", "fixtures");
    vi.stubEnv("ASSIST_API_KEYS", API_KEY);
    vi.stubEnv("CEE_UNIFIED_PIPELINE_ENABLED", "false");
    cleanBaseUrl();
    app = await build();
    await app.ready();

    // Mock the pipeline to return our controlled V1 response
    (finaliseCeeDraftResponse as any).mockResolvedValue({
      statusCode: 200,
      body: structuredClone(v1ResponseWithConstraintDrops),
    });
  });

  afterAll(async () => {
    await app.close();
  });

  const headers = { "X-Olumi-Assist-Key": API_KEY } as const;

  it("injects CONSTRAINT_DROPPED mutations as analysis_ready.blockers in V3 response", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/draft-graph?schema=v3",
      headers,
      payload: { brief: "A test brief for constraint blocker integration test" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    // analysis_ready should exist and contain constraint-drop blockers
    expect(body.analysis_ready).toBeDefined();
    const blockers = body.analysis_ready?.blockers ?? [];
    const constraintBlockers = blockers.filter((b: any) => b.blocker_type === "constraint_dropped");

    expect(constraintBlockers).toHaveLength(2);
    expect(constraintBlockers[0]).toEqual(expect.objectContaining({
      factor_id: "fac_monthly_churn",
      factor_label: "fac_monthly_churn",
      blocker_type: "constraint_dropped",
      suggested_action: "review_constraint",
    }));
    expect(constraintBlockers[1]).toEqual(expect.objectContaining({
      factor_id: "fac_revenue_growth",
      factor_label: "fac_revenue_growth",
      blocker_type: "constraint_dropped",
      suggested_action: "review_constraint",
    }));
  });

  it("does not change analysis_ready.status when constraint-drop blockers are added", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/draft-graph?schema=v3",
      headers,
      payload: { brief: "A test brief for constraint blocker status test" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    // Status should reflect the graph state (ready/needs_user_mapping), NOT the constraint drops
    expect(body.analysis_ready?.status).toBeDefined();
    // Status was computed BEFORE constraint drops were injected, so it shouldn't be "needs_user_input"
    // due to constraint drops alone
    expect(["ready", "needs_user_mapping", "needs_encoding"]).toContain(body.analysis_ready.status);
  });

  it("preserves existing blockers alongside constraint-drop blockers", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/draft-graph?schema=v3",
      headers,
      payload: { brief: "A test brief for preserving existing blockers" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    // If buildAnalysisReadyPayload produced existing blockers, they should be preserved
    const blockers = body.analysis_ready?.blockers ?? [];
    const constraintBlockers = blockers.filter((b: any) => b.blocker_type === "constraint_dropped");
    const otherBlockers = blockers.filter((b: any) => b.blocker_type !== "constraint_dropped");

    // Constraint blockers always present (from our mock)
    expect(constraintBlockers).toHaveLength(2);
    // Other blockers may or may not exist depending on graph state — just verify they're not replaced
    expect(blockers.length).toBeGreaterThanOrEqual(constraintBlockers.length);
    // If there were existing blockers, they come first (before constraint drops)
    if (otherBlockers.length > 0) {
      const firstConstraintIdx = blockers.findIndex((b: any) => b.blocker_type === "constraint_dropped");
      const lastOtherIdx = blockers.length - 1 - [...blockers].reverse().findIndex((b: any) => b.blocker_type !== "constraint_dropped");
      // Existing blockers should appear before constraint-drop blockers
      expect(lastOtherIdx).toBeLessThan(firstConstraintIdx);
    }
  });

  it("does not inject constraint-drop blockers for V1 schema requests", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/draft-graph?schema=v1",
      headers,
      payload: { brief: "A test brief for V1 no-blocker test" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    // V1 responses don't have analysis_ready
    expect(body.analysis_ready).toBeUndefined();
    // But trace.strp.mutations should still contain the drops
    expect(body.trace?.strp?.mutations).toBeDefined();
    expect(body.trace.strp.mutations.some((m: any) => m.code === "CONSTRAINT_DROPPED")).toBe(true);
  });
});
