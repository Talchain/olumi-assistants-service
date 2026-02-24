/**
 * CEE v1 Draft Graph Coefficient Variation Integration Test
 *
 * Ensures varied coefficients survive the draft pipeline when provided.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

// Use fixtures provider for deterministic graphs and zero cost
vi.stubEnv("LLM_PROVIDER", "fixtures");

// Avoid calling real engine validate service
vi.mock("../../src/services/validateClient.js", () => ({
  validateGraph: vi.fn().mockResolvedValue({ ok: true, violations: [], normalized: undefined }),
}));

// Avoid structural warnings or automatic fixes interfering with coefficients
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
  detectZeroExternalFactors: () => ({
    detected: false,
    factorCount: 0,
    externalCount: 0,
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

// Force fixtures adapter to return a graph with varied coefficients
vi.mock("../../src/utils/fixtures.js", () => ({
  fixtureGraph: {
    version: "1",
    default_seed: 17,
    nodes: [
      { id: "goal_mrr", kind: "goal", label: "Increase MRR" },
      { id: "dec_pricing", kind: "decision", label: "Pricing strategy" },
      { id: "opt_increase", kind: "option", label: "Increase price" },
      { id: "opt_maintain", kind: "option", label: "Maintain price" },
      { id: "fac_price", kind: "factor", label: "Price", data: { value: 100, extractionType: "explicit" } },
      { id: "fac_demand", kind: "factor", label: "Demand" },
      { id: "out_revenue", kind: "outcome", label: "Revenue" },
      { id: "risk_churn", kind: "risk", label: "Churn" },
    ],
    edges: [
      { from: "dec_pricing", to: "opt_increase" },
      { from: "dec_pricing", to: "opt_maintain" },
      { from: "opt_increase", to: "fac_price" },
      { from: "opt_maintain", to: "fac_price" },
      // Connect fac_demand to option so it's reachable from decision
      // (prevents pruning as unreachable node)
      { from: "opt_increase", to: "fac_demand" },
      {
        from: "fac_price",
        to: "out_revenue",
        strength_mean: 0.7,
        strength_std: 0.15,
        belief_exists: 0.9,
        effect_direction: "positive",
      },
      {
        from: "fac_price",
        to: "risk_churn",
        strength_mean: 0.4,
        strength_std: 0.2,
        belief_exists: 0.85,
        effect_direction: "positive",
      },
      {
        from: "fac_demand",
        to: "out_revenue",
        strength_mean: 0.8,
        strength_std: 0.25,
        belief_exists: 0.95,
        effect_direction: "positive",
      },
      {
        from: "out_revenue",
        to: "goal_mrr",
        strength_mean: 0.6,
        strength_std: 0.1,
        belief_exists: 0.9,
        effect_direction: "positive",
      },
      {
        from: "risk_churn",
        to: "goal_mrr",
        strength_mean: -0.5,
        strength_std: 0.2,
        belief_exists: 0.8,
        effect_direction: "negative",
      },
    ],
    meta: {
      roots: ["dec_pricing"],
      leaves: ["goal_mrr"],
      suggested_positions: {},
      source: "fixtures",
    },
  },
}));

import { build } from "../../src/server.js";
import { cleanBaseUrl } from "../helpers/env-setup.js";

describe("POST /assist/v1/draft-graph (CEE v1) - coefficient variation", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("ASSIST_API_KEYS", "cee-key-coeff");
    vi.stubEnv("CEE_DRAFT_FEATURE_VERSION", "draft-model-test");
    vi.stubEnv("CEE_DRAFT_RATE_LIMIT_RPM", "5");
    vi.stubEnv("CEE_DRAFT_STRUCTURAL_WARNINGS_ENABLED", "false");

    cleanBaseUrl();
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it("preserves varied coefficients across causal edges", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/draft-graph?schema=v3",
      headers: { "X-Olumi-Assist-Key": "cee-key-coeff" },
      payload: {
        brief: "Pricing decision affecting revenue through demand, churn, and brand perception with multiple causal links.",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as any;

    const nodes = body.nodes as any[];
    const edges = body.edges as any[];
    const kindById = new Map(nodes.map((node) => [node.id, node.kind]));

    const causalEdges = edges.filter((edge) => {
      const fromKind = kindById.get(edge.from);
      const toKind = kindById.get(edge.to);
      return !(
        (fromKind === "decision" && toKind === "option") ||
        (fromKind === "option" && toKind === "factor")
      );
    });

    expect(causalEdges.length).toBeGreaterThanOrEqual(5);

    const strengthMeans = new Set(causalEdges.map((edge) => edge.strength.mean.toFixed(2)));
    const strengthStds = new Set(causalEdges.map((edge) => edge.strength.std.toFixed(2)));
    const beliefExists = new Set(causalEdges.map((edge) => edge.exists_probability.toFixed(2)));

    expect(strengthMeans.size).toBeGreaterThanOrEqual(3);
    expect(strengthStds.size).toBeGreaterThanOrEqual(2);
    expect(beliefExists.size).toBeGreaterThanOrEqual(2);

    const riskToGoal = causalEdges.find(
      (edge) => kindById.get(edge.from) === "risk" && kindById.get(edge.to) === "goal"
    );
    expect(riskToGoal).toBeDefined();
    expect(riskToGoal.strength.mean).toBeLessThan(0);
  });
});
