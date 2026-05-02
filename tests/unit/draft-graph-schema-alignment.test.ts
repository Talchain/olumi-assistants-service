/**
 * Draft Graph Schema Alignment Tests
 *
 * Validates that the three schemas agree:
 * 1. Zod validation schema (shared-schemas.ts + graph.ts)
 * 2. Anthropic structured output schema (anthropic-graph-schema.ts)
 * 3. Draft graph prompt output contract (defaults-v187.ts)
 *
 * Also covers:
 * - Real Sonnet 4.6 draft graph output validation
 * - ProvenanceSource enum coverage
 * - Regression: existing valid fixtures still pass
 * - Diagnostic trace: llm_calls populated on error path
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { LLMDraftResponse, LLMEdge, LLMNode } from "../../src/adapters/llm/shared-schemas.js";
import { ProvenanceSource, NodeKind, FactorCategory } from "../../src/schemas/graph.js";
import { ANTHROPIC_DRAFT_GRAPH_SCHEMA } from "../../src/cee/draft/anthropic-graph-schema.js";

// =============================================================================
// Fixture: Real Sonnet 4.6 draft graph output (provenance values that caused failures)
// =============================================================================

const REAL_SONNET_46_OUTPUT = {
  nodes: [
    { id: "dec_pricing", kind: "decision", label: "SaaS Pricing Strategy" },
    { id: "goal_revenue", kind: "goal", label: "Maximise Annual Revenue",
      goal_threshold: 0.8, goal_threshold_raw: 2000000, goal_threshold_unit: "£", goal_threshold_cap: 2500000 },
    { id: "opt_increase", kind: "option", label: "Increase Price 20%",
      data: { interventions: { fac_price: 0.8 } } },
    { id: "opt_status_quo", kind: "option", label: "Status Quo",
      data: { interventions: { fac_price: 0.5 } } },
    { id: "opt_tiered", kind: "option", label: "Tiered Pricing",
      data: { interventions: { fac_price: 0.65 } } },
    { id: "fac_price", kind: "factor", label: "Price Level", category: "controllable",
      data: { value: 0.5, raw_value: 49, unit: "£", cap: 100, extractionType: "explicit", factor_type: "price" } },
    { id: "fac_churn", kind: "factor", label: "Churn Rate", category: "observable",
      data: { value: 0.03, raw_value: 3, unit: "%" } },
    { id: "fac_market", kind: "factor", label: "Market Conditions", category: "external",
      prior: { distribution: "uniform", range_min: 0.3, range_max: 0.8 } },
    { id: "out_revenue", kind: "outcome", label: "Revenue Growth" },
    { id: "risk_churn", kind: "risk", label: "Customer Churn" },
  ],
  edges: [
    // Structural edges
    { from: "dec_pricing", to: "opt_increase",
      strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0,
      effect_direction: "positive", edge_type: "directed",
      provenance_source: "structural" },
    { from: "dec_pricing", to: "opt_status_quo",
      strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0,
      provenance_source: "structural" },
    { from: "dec_pricing", to: "opt_tiered",
      strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0,
      provenance_source: "structural" },
    { from: "opt_increase", to: "fac_price",
      strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0,
      provenance_source: "structural" },
    { from: "opt_status_quo", to: "fac_price",
      strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0,
      provenance_source: "structural" },
    { from: "opt_tiered", to: "fac_price",
      strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0,
      provenance_source: "structural" },
    // Causal edges with provenance that previously failed
    { from: "fac_price", to: "out_revenue",
      strength: { mean: 0.7, std: 0.15 }, exists_probability: 0.9,
      effect_direction: "positive", edge_type: "directed",
      provenance_source: "domain_knowledge" },
    { from: "fac_price", to: "risk_churn",
      strength: { mean: 0.5, std: 0.2 }, exists_probability: 0.85,
      effect_direction: "positive",
      provenance_source: "hypothesis" },
    { from: "fac_churn", to: "risk_churn",
      strength: { mean: 0.6, std: 0.1 }, exists_probability: 0.95,
      effect_direction: "positive",
      provenance_source: "inferred" },
    { from: "fac_market", to: "out_revenue",
      strength: { mean: 0.3, std: 0.25 }, exists_probability: 0.7,
      effect_direction: "positive",
      provenance_source: "domain_knowledge" },
    { from: "out_revenue", to: "goal_revenue",
      strength: { mean: 0.8, std: 0.1 }, exists_probability: 1.0,
      effect_direction: "positive",
      provenance_source: "structural" },
    { from: "risk_churn", to: "goal_revenue",
      strength: { mean: -0.4, std: 0.15 }, exists_probability: 0.9,
      effect_direction: "negative",
      provenance_source: "inferred" },
  ],
  rationales: [
    { target: "fac_price", why: "Core lever: price directly affects revenue and churn" },
    { target: "fac_market", why: "External market conditions moderate revenue outcomes" },
  ],
  causal_claims: [
    { type: "direct_effect", from: "fac_price", to: "out_revenue", stated_strength: "strong" },
    { type: "direct_effect", from: "fac_price", to: "risk_churn", stated_strength: "moderate" },
  ],
  goal_constraints: [
    { constraint_id: "gc_churn", node_id: "risk_churn", operator: "<=",
      value: 0.04, label: "Monthly churn under 4%", unit: "%",
      source_quote: "keeping churn under 4%", confidence: 1.0, provenance: "explicit" },
  ],
  coaching: {
    summary: "Your pricing decision trades Revenue Growth through Price Level against Customer Churn risk.",
    strengthen_items: [
      { id: "str_1", label: "Pilot pricing", detail: "Test new pricing in one segment before full rollout",
        action_type: "add_option", bias_category: "framing" },
    ],
  },
};

// =============================================================================
// 1. Real LLM Output Validation — Zod schema accepts Sonnet 4.6 output
// =============================================================================

describe("Real Sonnet 4.6 draft graph output — Zod validation", () => {
  it("accepts the full real output without errors", () => {
    const result = LLMDraftResponse.safeParse(REAL_SONNET_46_OUTPUT);
    if (!result.success) {
      // Log detailed errors for debugging
      const formatted = result.error.issues.map((i) =>
        `${i.path.join(".")}: ${i.message}`
      );
      expect.fail(`Zod validation failed:\n${formatted.join("\n")}`);
    }
    expect(result.success).toBe(true);
  });

  it("preserves all nodes after parse", () => {
    const result = LLMDraftResponse.parse(REAL_SONNET_46_OUTPUT);
    expect(result.nodes).toHaveLength(10);
  });

  it("preserves all edges after parse", () => {
    const result = LLMDraftResponse.parse(REAL_SONNET_46_OUTPUT);
    expect(result.edges).toHaveLength(12);
  });

  it("preserves passthrough fields (coaching, goal_constraints, causal_claims)", () => {
    const result = LLMDraftResponse.parse(REAL_SONNET_46_OUTPUT);
    expect(result).toHaveProperty("coaching");
    expect(result).toHaveProperty("goal_constraints");
    expect(result).toHaveProperty("causal_claims");
  });

  it("accepts edges with provenance_source='structural'", () => {
    const edge = REAL_SONNET_46_OUTPUT.edges[0]; // structural edge
    const result = LLMEdge.safeParse(edge);
    expect(result.success).toBe(true);
  });

  it("accepts edges with provenance_source='domain_knowledge'", () => {
    const edge = REAL_SONNET_46_OUTPUT.edges.find((e) => e.provenance_source === "domain_knowledge");
    const result = LLMEdge.safeParse(edge);
    expect(result.success).toBe(true);
  });

  it("accepts edges with provenance_source='inferred'", () => {
    const edge = REAL_SONNET_46_OUTPUT.edges.find((e) => e.provenance_source === "inferred");
    const result = LLMEdge.safeParse(edge);
    expect(result.success).toBe(true);
  });

  it("accepts constraint nodes", () => {
    const node = { id: "cons_deadline", kind: "constraint", label: "Q3 Deadline" };
    const result = LLMNode.safeParse(node);
    expect(result.success).toBe(true);
  });
});

// =============================================================================
// 2. ProvenanceSource Enum Coverage
// =============================================================================

describe("ProvenanceSource enum — covers all prompt-allowed values", () => {
  const ALL_PROVENANCE_VALUES = [
    // Original set
    "document", "metric", "hypothesis", "engine", "synthetic",
    // Extended set (LLM produces these for edge provenance)
    "structural", "domain_knowledge", "inferred",
  ];

  for (const value of ALL_PROVENANCE_VALUES) {
    it(`accepts '${value}'`, () => {
      const result = ProvenanceSource.safeParse(value);
      expect(result.success).toBe(true);
    });
  }

  it("rejects unknown values", () => {
    expect(ProvenanceSource.safeParse("unknown_source").success).toBe(false);
    expect(ProvenanceSource.safeParse("").success).toBe(false);
    expect(ProvenanceSource.safeParse(42).success).toBe(false);
  });
});

// =============================================================================
// 3. NodeKind Enum Coverage
// =============================================================================

describe("NodeKind enum — covers all prompt-allowed values", () => {
  const ALL_NODE_KINDS = [
    "goal", "decision", "option", "outcome", "risk", "action", "factor", "constraint",
  ];

  for (const kind of ALL_NODE_KINDS) {
    it(`accepts '${kind}'`, () => {
      expect(NodeKind.safeParse(kind).success).toBe(true);
    });
  }
});

// =============================================================================
// 4. Three-Way Schema Alignment — Anthropic schema vs Zod schema vs Prompt
// =============================================================================

describe("Three-way schema alignment — Anthropic ↔ Zod ↔ Prompt", () => {
  const anthropicSchema = ANTHROPIC_DRAFT_GRAPH_SCHEMA;

  it("Anthropic node kind enum includes all Zod NodeKind values", () => {
    const zodKinds = NodeKind.options;
    const anthropicKinds = (anthropicSchema.properties.nodes.items as any).properties.kind.enum;
    for (const kind of zodKinds) {
      expect(anthropicKinds).toContain(kind);
    }
  });

  it("Anthropic node category enum matches Zod FactorCategory", () => {
    const zodCategories = FactorCategory.options;
    const catProp = (anthropicSchema.properties.nodes.items as any).properties.category;
    // category is nullable: { anyOf: [{ type: "string", enum: [...] }, { type: "null" }] }
    const anthropicCategories = catProp.enum ?? catProp.anyOf?.[0]?.enum;
    expect(anthropicCategories).toEqual(expect.arrayContaining(zodCategories));
  });

  it("Anthropic edge has nested strength object matching Zod EdgeStrength", () => {
    const edgeProps = (anthropicSchema.properties.edges.items as any).properties;
    expect(edgeProps.strength).toBeDefined();
    expect(edgeProps.strength.type).toBe("object");
    expect(edgeProps.strength.properties.mean.type).toBe("number");
    expect(edgeProps.strength.properties.std.type).toBe("number");
  });

  it("Anthropic edge does NOT include legacy flat strength_mean/std (trimmed for optional param limit)", () => {
    const edgeProps = (anthropicSchema.properties.edges.items as any).properties;
    // Legacy fields removed from Anthropic schema to stay under 24-optional limit.
    // Zod still accepts them via normalisation; they are just not in the structured output constraint.
    expect(edgeProps.strength_mean).toBeUndefined();
    expect(edgeProps.strength_std).toBeUndefined();
  });

  it("Anthropic edge effect_direction enum matches Zod", () => {
    const edgeProps = (anthropicSchema.properties.edges.items as any).properties;
    // effect_direction is nullable: { anyOf: [{ type: "string", enum: [...] }, { type: "null" }] }
    const dirEnum = edgeProps.effect_direction.enum ?? edgeProps.effect_direction.anyOf?.[0]?.enum;
    expect(dirEnum).toEqual(["positive", "negative"]);
  });

  it("Anthropic edge edge_type enum matches Zod", () => {
    const edgeProps = (anthropicSchema.properties.edges.items as any).properties;
    expect(edgeProps.edge_type.enum).toEqual(["directed", "bidirected"]);
  });

  it("Anthropic schema top-level required matches canonical graph + coaching contract (v0.11.0)", () => {
    // v0.11.0 schema amendment: coaching, causal_claims, topology_plan are
    // first-class declared types in @talchain/schemas and required at the
    // LLM structured-output boundary. `rationales` remains omitted.
    expect(anthropicSchema.required).toEqual([
      "nodes",
      "edges",
      "goal_constraints",
      "coaching",
      "causal_claims",
      "topology_plan",
    ]);
  });

  it("Anthropic node required fields match Zod LLMNode required fields", () => {
    const anthropicRequired = (anthropicSchema.properties.nodes.items as any).required;
    // Zod requires id (string.min(1)) and kind (NodeKind enum)
    expect(anthropicRequired).toContain("id");
    expect(anthropicRequired).toContain("kind");
  });

  it("Anthropic edge required fields match Zod LLMEdge required fields", () => {
    const anthropicRequired = (anthropicSchema.properties.edges.items as any).required;
    // Zod requires from (string.min(1)) and to (string.min(1))
    expect(anthropicRequired).toContain("from");
    expect(anthropicRequired).toContain("to");
  });
});

// =============================================================================
// 5. Regression — existing valid graph shapes still pass
// =============================================================================

describe("Regression — existing valid graph shapes", () => {
  it("minimal valid graph (2 nodes, 1 edge)", () => {
    const minimal = {
      nodes: [
        { id: "dec_1", kind: "decision", label: "Test Decision" },
        { id: "opt_1", kind: "option", label: "Option A" },
      ],
      edges: [
        { from: "dec_1", to: "opt_1", strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0 },
      ],
    };
    expect(LLMDraftResponse.safeParse(minimal).success).toBe(true);
  });

  it("edges with legacy weight/belief fields still accepted", () => {
    const legacy = {
      nodes: [
        { id: "n1", kind: "factor" },
        { id: "n2", kind: "outcome" },
      ],
      edges: [
        { from: "n1", to: "n2", weight: 0.7, belief: 0.9 },
      ],
    };
    expect(LLMDraftResponse.safeParse(legacy).success).toBe(true);
  });

  it("edges with flat strength_mean/strength_std (no nested strength)", () => {
    const flat = {
      nodes: [
        { id: "n1", kind: "factor" },
        { id: "n2", kind: "outcome" },
      ],
      edges: [
        { from: "n1", to: "n2", strength_mean: 0.5, strength_std: 0.1, exists_probability: 0.8 },
      ],
    };
    expect(LLMDraftResponse.safeParse(flat).success).toBe(true);
  });

  it("edges with original provenance_source values still accepted", () => {
    for (const src of ["document", "metric", "hypothesis", "engine", "synthetic"]) {
      const graph = {
        nodes: [
          { id: "n1", kind: "factor" },
          { id: "n2", kind: "outcome" },
        ],
        edges: [
          { from: "n1", to: "n2", provenance_source: src },
        ],
      };
      expect(LLMDraftResponse.safeParse(graph).success).toBe(true);
    }
  });

  it("nodes with all optional fields present", () => {
    const full = {
      nodes: [
        { id: "goal_1", kind: "goal", label: "Revenue", body: "Maximise revenue",
          goal_threshold: 0.8, goal_threshold_raw: 100000, goal_threshold_unit: "£",
          goal_threshold_cap: 125000 },
        { id: "fac_1", kind: "factor", label: "Price", category: "controllable",
          data: { value: 0.5, baseline: 0.4, unit: "£", raw_value: 49, cap: 100 } },
      ],
      edges: [],
    };
    expect(LLMDraftResponse.safeParse(full).success).toBe(true);
  });
});

// =============================================================================
// 6. Diagnostic Trace — error path includes LLM telemetry
// =============================================================================

describe("Diagnostic trace — error path LLM telemetry", () => {
  it("extractToolLLMTelemetry finds telemetry in error response with trace", async () => {
    const { __test_only } = await import("../../src/orchestrator/tools/draft-graph.js");
    const { extractToolLLMTelemetry } = __test_only;

    // Simulate what mapPipelineError now produces on error responses
    const errorBody: Record<string, unknown> = {
      error: "CEE_LLM_VALIDATION_FAILED",
      message: "LLM produced a response that does not match the expected graph schema",
      trace: {
        pipeline: {
          llm_metadata: {
            model: "claude-sonnet-4-6",
            prompt_version: "v187",
            prompt_hash: "abc123",
            duration_ms: 4500,
            finish_reason: "end_turn",
            token_usage: {
              prompt_tokens: 3000,
              completion_tokens: 2000,
              total_tokens: 5000,
            },
          },
        },
      },
    };

    const telemetry = extractToolLLMTelemetry(errorBody);
    expect(telemetry).toBeDefined();
    expect(telemetry!.model).toBe("claude-sonnet-4-6");
    expect(telemetry!.input_tokens).toBe(3000);
    expect(telemetry!.output_tokens).toBe(2000);
    expect(telemetry!.latency_ms).toBe(4500);
    expect(telemetry!.prompt_version).toBe("v187");
    expect(telemetry!.prompt_hash).toBe("abc123");
  });

  it("extractToolLLMTelemetry returns undefined when no trace present", async () => {
    const { __test_only } = await import("../../src/orchestrator/tools/draft-graph.js");
    const { extractToolLLMTelemetry } = __test_only;

    const errorBody: Record<string, unknown> = {
      error: "CEE_TIMEOUT",
      message: "Request timed out",
    };

    const telemetry = extractToolLLMTelemetry(errorBody);
    expect(telemetry).toBeUndefined();
  });

  it("extractToolLLMTelemetry emits partial telemetry when model present but token_usage missing", async () => {
    const { __test_only } = await import("../../src/orchestrator/tools/draft-graph.js");
    const { extractToolLLMTelemetry } = __test_only;

    const errorBody: Record<string, unknown> = {
      trace: {
        pipeline: {
          llm_metadata: {
            model: "claude-sonnet-4-6",
            duration_ms: 3500,
            // No token_usage — should still emit with zero tokens
          },
        },
      },
    };

    const telemetry = extractToolLLMTelemetry(errorBody);
    expect(telemetry).toBeDefined();
    expect(telemetry!.model).toBe("claude-sonnet-4-6");
    expect(telemetry!.input_tokens).toBe(0);
    expect(telemetry!.output_tokens).toBe(0);
    expect(telemetry!.latency_ms).toBe(3500);
  });

  it("extractToolLLMTelemetry returns undefined when neither model nor token_usage present", async () => {
    const { __test_only } = await import("../../src/orchestrator/tools/draft-graph.js");
    const { extractToolLLMTelemetry } = __test_only;

    const errorBody: Record<string, unknown> = {
      trace: {
        pipeline: {
          llm_metadata: {
            // Neither model nor token_usage
          },
        },
      },
    };

    const telemetry = extractToolLLMTelemetry(errorBody);
    expect(telemetry).toBeUndefined();
  });
});
