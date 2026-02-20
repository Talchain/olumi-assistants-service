/**
 * CEE v1 Draft Graph Coaching Passthrough Integration Test
 *
 * Ensures the coaching field from the LLM adapter survives the entire unified
 * pipeline (parse → context → package → V3 transform) and appears in the
 * HTTP response at /assist/v1/draft-graph?schema=v3.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

// ── Test data ────────────────────────────────────────────────────────────────

const TEST_COACHING = {
  summary: "Consider strengthening causal links between pricing factors",
  strengthen_items: [
    {
      id: "s1",
      label: "Price-Revenue Link",
      detail: "Add supporting market data to strengthen the causal connection",
      action_type: "evidence_needed",
    },
    {
      id: "s2",
      label: "Demand Elasticity",
      detail: "Consider adding demand sensitivity as a separate factor",
      action_type: "structural_improvement",
      bias_category: "anchoring_bias",
    },
  ],
};

const TEST_GRAPH = {
  version: "1",
  default_seed: 42,
  nodes: [
    { id: "goal_1", kind: "goal", label: "Increase Revenue" },
    { id: "dec_1", kind: "decision", label: "Pricing Strategy" },
    { id: "opt_1", kind: "option", label: "Raise Prices" },
    { id: "opt_2", kind: "option", label: "Lower Prices" },
    { id: "fac_1", kind: "factor", label: "Price Level", data: { value: 100, extractionType: "explicit" } },
    { id: "out_1", kind: "outcome", label: "Revenue" },
  ],
  edges: [
    { from: "dec_1", to: "opt_1" },
    { from: "dec_1", to: "opt_2" },
    { from: "opt_1", to: "fac_1" },
    { from: "opt_2", to: "fac_1" },
    {
      from: "fac_1",
      to: "out_1",
      strength_mean: 0.7,
      strength_std: 0.1,
      belief_exists: 0.9,
      effect_direction: "positive",
    },
    {
      from: "out_1",
      to: "goal_1",
      strength_mean: 0.8,
      strength_std: 0.15,
      belief_exists: 0.95,
      effect_direction: "positive",
    },
  ],
  meta: {
    roots: ["dec_1"],
    leaves: ["goal_1"],
    suggested_positions: {},
    source: "fixtures",
  },
};

// ── Environment ──────────────────────────────────────────────────────────────

vi.stubEnv("LLM_PROVIDER", "fixtures");

// ── Mocks ────────────────────────────────────────────────────────────────────

// Mock validateClient to avoid calling real engine
vi.mock("../../src/services/validateClient.js", () => ({
  validateGraph: vi.fn().mockResolvedValue({ ok: true, violations: [], normalized: undefined }),
}));

// Mock structure module to avoid warnings/repairs interfering
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

// Shared mock draftGraph so tests can override per-call via mockResolvedValueOnce
const mockDraftGraph = vi.fn().mockResolvedValue({
  graph: TEST_GRAPH,
  rationales: [],
  coaching: TEST_COACHING,
  usage: { input_tokens: 0, output_tokens: 0 },
  meta: {
    model: "fixture-v1",
    prompt_version: "fixture:coaching_test",
    temperature: 0,
    token_usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    finish_reason: "fixture",
    provider_latency_ms: 0,
    node_kinds_raw_json: ["goal", "decision", "option", "option", "factor", "outcome"],
  },
});

const mockRepairGraph = vi.fn().mockResolvedValue({
  graph: TEST_GRAPH,
  rationales: [],
  usage: { input_tokens: 0, output_tokens: 0 },
});

// Override full router module — provides all exports needed by server build
vi.mock("../../src/adapters/llm/router.js", () => ({
  getAdapter: () => ({
    name: "fixtures",
    model: "fixture-v1",
    draftGraph: mockDraftGraph,
    repairGraph: mockRepairGraph,
    suggestOptions: vi.fn().mockResolvedValue({ options: [] }),
    clarifyBrief: vi.fn().mockResolvedValue({ questions: [], usage: { input_tokens: 0, output_tokens: 0 } }),
    critiqueGraph: vi.fn().mockResolvedValue({ critique: "", usage: { input_tokens: 0, output_tokens: 0 } }),
    chat: vi.fn().mockResolvedValue({ message: "", usage: { input_tokens: 0, output_tokens: 0 } }),
    explainDiff: vi.fn().mockResolvedValue({ explanation: "", usage: { input_tokens: 0, output_tokens: 0 } }),
  }),
  getAdapterForProvider: vi.fn(),
  getMaxTokensFromConfig: vi.fn().mockReturnValue(undefined),
  warmProviderConfigCache: vi.fn().mockResolvedValue({ loaded: false, path: "" }),
  resetAdapterCache: vi.fn(),
}));

import { build } from "../../src/server.js";
import { cleanBaseUrl } from "../helpers/env-setup.js";

describe("POST /assist/v1/draft-graph (CEE v1) - coaching passthrough", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("ASSIST_API_KEYS", "cee-key-coaching");
    vi.stubEnv("CEE_DRAFT_FEATURE_VERSION", "draft-model-test");
    vi.stubEnv("CEE_DRAFT_RATE_LIMIT_RPM", "5");
    vi.stubEnv("CEE_DRAFT_STRUCTURAL_WARNINGS_ENABLED", "false");
    // Coaching passthrough is wired through the unified pipeline
    vi.stubEnv("CEE_UNIFIED_PIPELINE_ENABLED", "true");

    cleanBaseUrl();
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it("coaching field survives pipeline to V3 HTTP response", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/draft-graph?schema=v3",
      headers: { "X-Olumi-Assist-Key": "cee-key-coaching" },
      payload: {
        brief: "Pricing decision affecting revenue with multiple causal links and strategic factors.",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as any;

    // coaching must be present at the top level of the V3 response
    expect(body.coaching).toBeDefined();
    expect(body.coaching.summary).toBe(TEST_COACHING.summary);
    expect(body.coaching.strengthen_items).toHaveLength(2);

    // Verify individual strengthen_items survive intact
    const items = body.coaching.strengthen_items;
    expect(items[0]).toMatchObject({
      id: "s1",
      label: "Price-Revenue Link",
      action_type: "evidence_needed",
    });
    expect(items[1]).toMatchObject({
      id: "s2",
      label: "Demand Elasticity",
      action_type: "structural_improvement",
      bias_category: "anchoring_bias",
    });
  });

  it("response without coaching omits the field cleanly", async () => {
    // Override the shared mock to return no coaching for this single call
    mockDraftGraph.mockResolvedValueOnce({
      graph: TEST_GRAPH,
      rationales: [],
      // no coaching field
      usage: { input_tokens: 0, output_tokens: 0 },
      meta: {
        model: "fixture-v1",
        prompt_version: "fixture:no_coaching",
        temperature: 0,
        token_usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        finish_reason: "fixture",
        provider_latency_ms: 0,
        node_kinds_raw_json: ["goal", "decision", "option", "option", "factor", "outcome"],
      },
    });

    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/draft-graph?schema=v3",
      headers: { "X-Olumi-Assist-Key": "cee-key-coaching" },
      payload: {
        brief: "A straightforward pricing decision about revenue strategy for the business.",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as any;

    // coaching should be absent when adapter doesn't include it
    expect(body.coaching).toBeUndefined();
  });
});
