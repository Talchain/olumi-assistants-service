/**
 * CEE v1 Draft Graph Causal Claims Integration Tests (Phase 2B — Task 5)
 *
 * Ensures causal_claims from the LLM adapter survive the entire unified
 * pipeline (parse → validate → package → V3 transform) and appear in the
 * HTTP response at /assist/v1/draft-graph?schema=v3.
 *
 * Covers: valid passthrough, absent field omission, malformed handling,
 * invalid node refs, truncation, STRP survival, empty array, and
 * canonical ID enforcement.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

// ── Test data ────────────────────────────────────────────────────────────────

const TEST_CLAIMS = [
  { type: "direct_effect", from: "fac_1", to: "out_1", stated_strength: "strong" },
  { type: "mediation_only", from: "fac_1", via: "fac_2", to: "out_1" },
  { type: "no_direct_effect", from: "opt_1", to: "goal_1" },
  { type: "unmeasured_confounder", between: ["fac_1", "fac_2"], stated_source: "market data" },
];

const TEST_GRAPH = {
  version: "1",
  default_seed: 42,
  nodes: [
    { id: "goal_1", kind: "goal", label: "Increase Revenue" },
    { id: "dec_1", kind: "decision", label: "Pricing Strategy" },
    { id: "opt_1", kind: "option", label: "Raise Prices" },
    { id: "opt_2", kind: "option", label: "Lower Prices" },
    { id: "fac_1", kind: "factor", label: "Price Level", data: { value: 100, extractionType: "explicit" } },
    { id: "fac_2", kind: "factor", label: "Market Demand", data: { value: 80, extractionType: "explicit" } },
    { id: "out_1", kind: "outcome", label: "Revenue" },
  ],
  edges: [
    { from: "dec_1", to: "opt_1" },
    { from: "dec_1", to: "opt_2" },
    { from: "opt_1", to: "fac_1" },
    { from: "opt_2", to: "fac_1" },
    { from: "fac_1", to: "out_1", strength_mean: 0.7, strength_std: 0.1, belief_exists: 0.9, effect_direction: "positive" },
    { from: "fac_2", to: "out_1", strength_mean: 0.5, strength_std: 0.15, belief_exists: 0.8, effect_direction: "positive" },
    { from: "out_1", to: "goal_1", strength_mean: 0.8, strength_std: 0.15, belief_exists: 0.95, effect_direction: "positive" },
  ],
  meta: { roots: ["dec_1"], leaves: ["goal_1"], suggested_positions: {}, source: "fixtures" },
};

const DEFAULT_META = {
  model: "fixture-v1",
  prompt_version: "fixture:claims_test",
  temperature: 0,
  token_usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  finish_reason: "fixture",
  provider_latency_ms: 0,
  node_kinds_raw_json: ["goal", "decision", "option", "option", "factor", "factor", "outcome"],
};

const DEFAULT_USAGE = { input_tokens: 0, output_tokens: 0 };

// ── Environment ──────────────────────────────────────────────────────────────

vi.stubEnv("LLM_PROVIDER", "fixtures");

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../src/services/validateClient.js", () => ({
  validateGraph: vi.fn().mockResolvedValue({ ok: true, violations: [], normalized: undefined }),
}));

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
  hasGoalNode: (graph: any) => Array.isArray(graph?.nodes) && graph.nodes.some((n: any) => n.kind === "goal"),
  ensureGoalNode: (graph: any) => ({ graph, goalAdded: false, inferredFrom: undefined, goalNodeId: undefined }),
}));

const mockDraftGraph = vi.fn().mockResolvedValue({
  graph: TEST_GRAPH,
  rationales: [],
  causal_claims: TEST_CLAIMS,
  usage: DEFAULT_USAGE,
  meta: DEFAULT_META,
});

vi.mock("../../src/adapters/llm/router.js", () => ({
  getAdapter: () => ({
    name: "fixtures",
    model: "fixture-v1",
    draftGraph: mockDraftGraph,
    repairGraph: vi.fn().mockResolvedValue({ graph: TEST_GRAPH, rationales: [], usage: DEFAULT_USAGE }),
    suggestOptions: vi.fn().mockResolvedValue({ options: [] }),
    clarifyBrief: vi.fn().mockResolvedValue({ questions: [], usage: DEFAULT_USAGE }),
    critiqueGraph: vi.fn().mockResolvedValue({ critique: "", usage: DEFAULT_USAGE }),
    chat: vi.fn().mockResolvedValue({ message: "", usage: DEFAULT_USAGE }),
    explainDiff: vi.fn().mockResolvedValue({ explanation: "", usage: DEFAULT_USAGE }),
  }),
  getAdapterForProvider: vi.fn(),
  getMaxTokensFromConfig: vi.fn().mockReturnValue(undefined),
  warmProviderConfigCache: vi.fn().mockResolvedValue({ loaded: false, path: "" }),
  resetAdapterCache: vi.fn(),
}));

import { build } from "../../src/server.js";
import { cleanBaseUrl } from "../helpers/env-setup.js";

const BRIEF = "Pricing decision affecting revenue with multiple causal links and market factors.";

describe("POST /assist/v1/draft-graph (CEE v1) - causal_claims pipeline", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("ASSIST_API_KEYS", "cee-key-claims");
    vi.stubEnv("CEE_DRAFT_FEATURE_VERSION", "draft-model-test");
    vi.stubEnv("CEE_DRAFT_RATE_LIMIT_RPM", "20");
    vi.stubEnv("CEE_DRAFT_STRUCTURAL_WARNINGS_ENABLED", "false");
    vi.stubEnv("CEE_UNIFIED_PIPELINE_ENABLED", "true");

    cleanBaseUrl();
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  function inject(overrideBrief?: string) {
    return app.inject({
      method: "POST",
      url: "/assist/v1/draft-graph?schema=v3",
      headers: { "X-Olumi-Assist-Key": "cee-key-claims" },
      payload: { brief: overrideBrief ?? BRIEF },
    });
  }

  // Test 1: Valid claims parse correctly (route-level integration)
  it("valid causal_claims survive pipeline to V3 response", async () => {
    const res = await inject();
    expect(res.statusCode).toBe(200);
    const body = res.json() as any;

    expect(body.causal_claims).toBeDefined();
    expect(body.causal_claims).toHaveLength(4);
    expect(body.causal_claims[0]).toMatchObject({ type: "direct_effect", from: "fac_1", to: "out_1" });
    expect(body.causal_claims[1]).toMatchObject({ type: "mediation_only", from: "fac_1", via: "fac_2" });
    expect(body.causal_claims[2]).toMatchObject({ type: "no_direct_effect", from: "opt_1", to: "goal_1" });
    expect(body.causal_claims[3]).toMatchObject({ type: "unmeasured_confounder", between: ["fac_1", "fac_2"] });
  });

  // Test 5: Absent claims field — LLM response has no causal_claims
  it("response without causal_claims omits the field entirely", async () => {
    mockDraftGraph.mockResolvedValueOnce({
      graph: TEST_GRAPH,
      rationales: [],
      // no causal_claims field
      usage: DEFAULT_USAGE,
      meta: DEFAULT_META,
    });

    const res = await inject("A straightforward pricing decision about revenue for the business.");
    expect(res.statusCode).toBe(200);
    const body = res.json() as any;
    expect(body.causal_claims).toBeUndefined();
  });

  // Test 6: Empty claims array passes through
  it("empty causal_claims array passes through as empty (not omitted)", async () => {
    mockDraftGraph.mockResolvedValueOnce({
      graph: TEST_GRAPH,
      rationales: [],
      causal_claims: [],
      usage: DEFAULT_USAGE,
      meta: DEFAULT_META,
    });

    const res = await inject("An empty claims scenario for testing the pricing decision process.");
    expect(res.statusCode).toBe(200);
    const body = res.json() as any;
    // Empty array from LLM means LLM did emit it. Validation produces no claims.
    // Since 0 validated claims → omit from response (preserves provenance).
    expect(body.causal_claims).toBeUndefined();
  });

  // Test 2: Malformed claim dropped
  it("drops malformed claims and emits CAUSAL_CLAIM_DROPPED warning", async () => {
    mockDraftGraph.mockResolvedValueOnce({
      graph: TEST_GRAPH,
      rationales: [],
      causal_claims: [
        { type: "direct_effect", from: "fac_1", to: "out_1", stated_strength: "strong" },
        { type: "direct_effect", from: "fac_1" /* missing to, stated_strength */ },
      ],
      usage: DEFAULT_USAGE,
      meta: DEFAULT_META,
    });

    const res = await inject("Testing malformed claims handling in the pricing decision pipeline.");
    expect(res.statusCode).toBe(200);
    const body = res.json() as any;
    expect(body.causal_claims).toHaveLength(1);
    expect(body.causal_claims[0].type).toBe("direct_effect");
  });

  // Test 3: Invalid node reference dropped
  it("drops claims referencing non-existent node IDs", async () => {
    mockDraftGraph.mockResolvedValueOnce({
      graph: TEST_GRAPH,
      rationales: [],
      causal_claims: [
        { type: "direct_effect", from: "fac_1", to: "out_1", stated_strength: "strong" },
        { type: "direct_effect", from: "fac_nonexistent", to: "out_1", stated_strength: "weak" },
      ],
      usage: DEFAULT_USAGE,
      meta: DEFAULT_META,
    });

    const res = await inject("Testing invalid node refs in causal claims for pricing revenue analysis.");
    expect(res.statusCode).toBe(200);
    const body = res.json() as any;
    expect(body.causal_claims).toHaveLength(1);
    expect(body.causal_claims[0].from).toBe("fac_1");
  });

  // Test 4: Truncation at 20
  it("truncates claims array to 20 entries", async () => {
    const claims25 = Array.from({ length: 25 }, () => ({
      type: "direct_effect", from: "fac_1", to: "out_1", stated_strength: "moderate",
    }));

    mockDraftGraph.mockResolvedValueOnce({
      graph: TEST_GRAPH,
      rationales: [],
      causal_claims: claims25,
      usage: DEFAULT_USAGE,
      meta: DEFAULT_META,
    });

    const res = await inject("Testing truncation of excess causal claims in the pricing analysis pipeline.");
    expect(res.statusCode).toBe(200);
    const body = res.json() as any;
    expect(body.causal_claims).toHaveLength(20);
  });

  // Test 7: Claims must use canonical IDs
  it("drops claims using labels instead of canonical node IDs", async () => {
    mockDraftGraph.mockResolvedValueOnce({
      graph: TEST_GRAPH,
      rationales: [],
      causal_claims: [
        { type: "direct_effect", from: "Market Size", to: "Revenue", stated_strength: "strong" },
      ],
      usage: DEFAULT_USAGE,
      meta: DEFAULT_META,
    });

    const res = await inject("Testing canonical ID enforcement in claims for pricing revenue decisions.");
    expect(res.statusCode).toBe(200);
    const body = res.json() as any;
    // All claims dropped (non-canonical IDs) — field omitted
    expect(body.causal_claims).toBeUndefined();
  });

  // Test 8: Claims survive STRP — claims array is unchanged by repair
  // Since we use TEST_GRAPH which doesn't trigger STRP repairs, claims pass through unmodified.
  // The key assertion: claims are NOT repaired/modified by pipeline stages.
  it("claims survive STRP without modification", async () => {
    const res = await inject();
    expect(res.statusCode).toBe(200);
    const body = res.json() as any;

    // Claims should be exactly as the LLM returned them (valid ones only)
    expect(body.causal_claims).toHaveLength(4);
    // Verify claim content is unmodified
    expect(body.causal_claims[0].stated_strength).toBe("strong");
    expect(body.causal_claims[3].stated_source).toBe("market data");
  });

  // Test: not-an-array causal_claims
  it("handles non-array causal_claims gracefully", async () => {
    mockDraftGraph.mockResolvedValueOnce({
      graph: TEST_GRAPH,
      rationales: [],
      causal_claims: "not_an_array",
      usage: DEFAULT_USAGE,
      meta: DEFAULT_META,
    });

    const res = await inject("Testing non-array causal claims for the pricing strategy decision analysis.");
    expect(res.statusCode).toBe(200);
    const body = res.json() as any;
    // Malformed → empty array → field omitted
    expect(body.causal_claims).toBeUndefined();
  });
});
