/**
 * CEE v1 Draft Graph — Route-level coaching + provenance integration test.
 *
 * Required by brief P0 #4: prove the live HTTP route at /assist/v1/draft-graph
 * returns the full coaching payload (summary, strengthen_items, widening_log,
 * bias_signals) and per-node/edge provenance display fields, AND that they
 * survive the Stage 6 V3 boundary parse.
 *
 * Naming decision: the brief used the field name `draft_coaching`. We reuse
 * the V3 schema's existing `coaching` field — same shape, no schema-root
 * extension. UI consumes `body.coaching`. See plan file for rationale.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

// ── Test data ────────────────────────────────────────────────────────────────

const TEST_GRAPH = {
  version: "1",
  default_seed: 42,
  nodes: [
    { id: "goal_1", kind: "goal", label: "Increase revenue" },
    { id: "dec_1", kind: "decision", label: "Pricing strategy" },
    // Status quo signalled via label (matchesStatusQuoLabel) rather than
    // data.is_status_quo, since the V1 NodeData union rejects bare flag-only data.
    { id: "opt_1", kind: "option", label: "Continue as-is" },
    { id: "opt_2", kind: "option", label: "Lower prices" },
    {
      id: "fac_price",
      kind: "factor",
      label: "Price level",
      data: { value: 100, extractionType: "explicit" },
    },
    {
      id: "fac_competition",
      kind: "factor",
      label: "Competitive intensity",
      data: { value: 50, extractionType: "inferred" },
    },
    { id: "out_1", kind: "outcome", label: "Revenue growth" },
  ],
  edges: [
    { from: "dec_1", to: "opt_1" },
    { from: "dec_1", to: "opt_2" },
    { from: "opt_1", to: "fac_price" },
    { from: "opt_2", to: "fac_price" },
    {
      from: "fac_price",
      to: "out_1",
      strength_mean: 0.7, strength_std: 0.1, belief_exists: 0.9, effect_direction: "positive",
      // V1 enum value; V3 transform maps "document" → "brief_extraction".
      provenance_source: "document",
    },
    {
      from: "fac_competition",
      to: "out_1",
      strength_mean: -0.3, strength_std: 0.2, belief_exists: 0.7, effect_direction: "negative",
      // V1 enum; V3 transform maps "hypothesis" → "cee_hypothesis".
      provenance_source: "hypothesis",
    },
    {
      from: "out_1",
      to: "goal_1",
      strength_mean: 0.8, strength_std: 0.15, belief_exists: 0.95, effect_direction: "positive",
    },
  ],
  meta: { roots: ["dec_1"], leaves: ["goal_1"], suggested_positions: {}, source: "assistant" },
};

const TEST_COACHING = {
  summary: "Solid scaffold; broaden the competitor scope.",
  strengthen_items: [
    {
      id: "s_churn",
      label: "Add a churn driver",
      detail: "Missing churn elasticity from the model.",
      action_type: "add_node",
    },
  ],
  // v0.11.0 schema amendment: widening_log is the canonical OBJECT shape.
  widening_log: {
    elements_added: ["fac_competition"],
    elements_considered_but_excluded: ["considered alternative competitors"],
    brief_completeness: "partial",
  },
  bias_signals: [
    { type: "anchoring", detail: "Pinned to last quarter's price.", target: "fac_price" },
  ],
};

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
  detectMissingBaseline: () => ({ detected: false, hasBaseline: true }),
  detectGoalNoBaselineValue: () => ({ detected: false, goalHasValue: false }),
  detectZeroExternalFactors: () => ({ detected: false, factorCount: 0, externalCount: 0 }),
  checkGoalConnectivity: () => ({ status: "full", disconnectedOptions: [], weakPaths: [] }),
  computeModelQualityFactors: () => ({ estimate_confidence: 0.5, strength_variation: 0, range_confidence_coverage: 0, has_baseline_option: true }),
  detectOptionSimilarity: () => ({ detected: false, critiques: [], warnings: [], validationIssues: [] }),
  detectMissingCounterfactual: () => ({ detected: false, hasCounterfactual: false }),
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
  coaching: TEST_COACHING,
  usage: { input_tokens: 0, output_tokens: 0 },
  meta: {
    model: "fixture-v1",
    prompt_version: "fixture:coaching_provenance_test",
    temperature: 0,
    token_usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    finish_reason: "fixture",
    provider_latency_ms: 0,
    node_kinds_raw_json: ["goal", "decision", "option", "option", "factor", "factor", "outcome"],
  },
});

const mockRepairGraph = vi.fn().mockResolvedValue({
  graph: TEST_GRAPH,
  rationales: [],
  usage: { input_tokens: 0, output_tokens: 0 },
});

const fixturesAdapter = {
  name: "fixtures",
  model: "fixture-v1",
  draftGraph: mockDraftGraph,
  repairGraph: mockRepairGraph,
  suggestOptions: vi.fn().mockResolvedValue({ options: [] }),
  clarifyBrief: vi.fn().mockResolvedValue({ questions: [], usage: { input_tokens: 0, output_tokens: 0 } }),
  critiqueGraph: vi.fn().mockResolvedValue({ critique: "", usage: { input_tokens: 0, output_tokens: 0 } }),
  chat: vi.fn().mockResolvedValue({ message: "", usage: { input_tokens: 0, output_tokens: 0 } }),
  explainDiff: vi.fn().mockResolvedValue({ explanation: "", usage: { input_tokens: 0, output_tokens: 0 } }),
};

vi.mock("../../src/adapters/llm/router.js", () => ({
  getAdapter: () => fixturesAdapter,
  getAdapterWithResolution: (task?: string) => ({
    adapter: fixturesAdapter,
    resolution: { task, resolved_model: "fixture-v1", resolution_source: "task_default" as const },
  }),
  resolveConfiguredRouterPlan: (task?: string) => ({
    kind: "single" as const,
    task,
    assignment: {
      model: "fixture-v1",
      provider: "fixtures" as const,
      declaredProvider: null,
      registryModelId: null,
      availability: "fixture_only" as const,
      config: null,
    },
    resolutionSource: "llm_model_fallback" as const,
    sourceKey: "PROVIDER_DEFAULT_MODELS.fixtures",
  }),
  getAdapterForProvider: vi.fn(),
  getMaxTokensFromConfig: vi.fn().mockReturnValue(undefined),
  warmProviderConfigCache: vi.fn().mockResolvedValue({ loaded: false, path: "" }),
  resetAdapterCache: vi.fn(),
}));

import { build } from "../../src/server.js";
import { cleanBaseUrl } from "../helpers/env-setup.js";

// ── Tests ────────────────────────────────────────────────────────────────────

describe("POST /assist/v1/draft-graph — coaching + provenance survival end-to-end", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("ASSIST_API_KEYS", "cee-key-cov-prov");
    vi.stubEnv("CEE_DRAFT_FEATURE_VERSION", "draft-model-test");
    vi.stubEnv("CEE_DRAFT_RATE_LIMIT_RPM", "10");
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

  it("returns full coaching payload (summary, strengthen_items, widening_log, bias_signals)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/draft-graph?schema=v3",
      headers: { "X-Olumi-Assist-Key": "cee-key-cov-prov" },
      payload: {
        brief: "Pricing decision with revenue and competitor pressure across multiple options.",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as any;

    // All four coaching fields the brief required (under `coaching`, not
    // `draft_coaching` — see file header for the naming decision).
    expect(body.coaching).toBeDefined();
    expect(body.coaching.summary).toBe(TEST_COACHING.summary);

    expect(Array.isArray(body.coaching.strengthen_items)).toBe(true);
    expect(body.coaching.strengthen_items.find((i: any) => i.id === "s_churn")).toBeDefined();

    expect(body.coaching.widening_log).toEqual({
      elements_added: ["fac_competition"],
      elements_considered_but_excluded: ["considered alternative competitors"],
      brief_completeness: "partial",
    });

    expect(body.coaching.bias_signals).toEqual([
      { type: "anchoring", detail: "Pinned to last quarter's price.", target: "fac_price" },
    ]);
  });

  it("each node carries provenance in the UI display vocabulary", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/draft-graph?schema=v3",
      headers: { "X-Olumi-Assist-Key": "cee-key-cov-prov" },
      payload: { brief: "Decision under uncertainty with multiple options and a goal." },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as any;
    expect(Array.isArray(body.nodes)).toBe(true);

    const allowed = new Set(["from_brief", "ai_inferred", "user_set"]);
    for (const node of body.nodes) {
      expect(allowed.has(node.provenance)).toBe(true);
    }

    // Spot-check the mapping: explicit extractionType → from_brief
    const priceNode = body.nodes.find((n: any) => n.id === "fac_price");
    expect(priceNode?.provenance).toBe("from_brief");

    // inferred extractionType → ai_inferred
    const competitionNode = body.nodes.find((n: any) => n.id === "fac_competition");
    expect(competitionNode?.provenance).toBe("ai_inferred");
  });

  it("each edge carries provenance_display in the UI display vocabulary", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/draft-graph?schema=v3",
      headers: { "X-Olumi-Assist-Key": "cee-key-cov-prov" },
      payload: { brief: "Decision with causal edges of varied provenance for testing." },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as any;
    expect(Array.isArray(body.edges)).toBe(true);

    const allowed = new Set(["from_brief", "ai_inferred", "user_set"]);
    for (const edge of body.edges) {
      expect(allowed.has(edge.provenance_display)).toBe(true);
    }

    // Spot-check the mapping: brief_extraction → from_brief
    const briefEdge = body.edges.find((e: any) => e.from === "fac_price" && e.to === "out_1");
    expect(briefEdge?.provenance_display).toBe("from_brief");

    // hypothesis (mapped to cee_hypothesis) → ai_inferred
    const hypEdge = body.edges.find((e: any) => e.from === "fac_competition" && e.to === "out_1");
    expect(hypEdge?.provenance_display).toBe("ai_inferred");

    // structural provenance.source must be left untouched as a sibling
    expect(briefEdge?.provenance?.source).toBe("brief_extraction");
  });

  it("Stage 6 V3 boundary preserves widening_log + bias_signals (not stripped by passthrough alone)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/draft-graph?schema=v3",
      headers: { "X-Olumi-Assist-Key": "cee-key-cov-prov" },
      payload: { brief: "Decision exercise to verify Stage 6 boundary preserves coaching subfields." },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as any;

    // The brief's correction explicitly required this assertion: the V3
    // schema's coaching.passthrough() lets unknown subfields through, but
    // we verify them as DECLARED fields rather than relying on passthrough.
    expect("widening_log" in body.coaching).toBe(true);
    expect("bias_signals" in body.coaching).toBe(true);
    expect(body.coaching.widening_log).toEqual(TEST_COACHING.widening_log);
    expect(body.coaching.bias_signals).toEqual(TEST_COACHING.bias_signals);
  });

  it("sanitises leaked entity IDs in coaching strings end-to-end on the live route", async () => {
    // Combined route-level sanitisation + survival test: leaked IDs in the
    // LLM coaching block must be scrubbed before reaching the HTTP body.
    // - `fac_price` matches a node id in the graph → replaced with the
    //   node label ("Price level")
    // - `fac_unknown_id` matches no node → falls back to the prefix-aware
    //   generic ("the relevant factor")
    mockDraftGraph.mockResolvedValueOnce({
      graph: TEST_GRAPH,
      rationales: [],
      coaching: {
        summary: "Consider widening fac_price and adding fac_unknown_id to the model.",
        strengthen_items: [
          {
            id: "s_leak",
            label: "Refine fac_price",
            detail: "fac_price needs more context; fac_unknown_id is missing entirely.",
            action_type: "refine",
          },
        ],
      },
      usage: { input_tokens: 0, output_tokens: 0 },
      meta: {
        model: "fixture-v1",
        prompt_version: "fixture:sanitise_route_test",
        temperature: 0,
        token_usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        finish_reason: "fixture",
        provider_latency_ms: 0,
        node_kinds_raw_json: ["goal", "decision", "option", "option", "factor", "factor", "outcome"],
      },
    });

    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/draft-graph?schema=v3",
      headers: { "X-Olumi-Assist-Key": "cee-key-cov-prov" },
      payload: { brief: "Decision under pricing uncertainty with revenue and competitor pressure." },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as any;

    // No raw entity IDs may reach the wire on any user-facing coaching string.
    const summary = body.coaching.summary as string;
    const item = body.coaching.strengthen_items.find((i: any) => i.id === "s_leak");

    expect(summary).not.toContain("fac_price");
    expect(summary).not.toContain("fac_unknown_id");
    expect(item.label).not.toContain("fac_price");
    expect(item.detail).not.toContain("fac_price");
    expect(item.detail).not.toContain("fac_unknown_id");

    // Label-resolution path: a leaked ID with a matching graph node is
    // replaced with the node's actual label.
    expect(summary).toContain("Price level");
    expect(item.label).toContain("Price level");

    // Generic-fallback path: an unknown ID is replaced with the prefix-aware
    // generic, NOT silently re-emitted as itself.
    expect(summary).toContain("the relevant factor");
  });
});
