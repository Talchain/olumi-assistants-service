/**
 * V3 Transform Conformance Tests
 *
 * Validates that transformResponseToV3 output conforms to the CEEGraphResponseV3 schema
 * and that post-pipeline graphs pass DraftGraphOutput.parse().
 *
 * Prevents the class of 400 failures where repair/sweep mutations produce
 * output the downstream Zod schemas reject.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { DraftGraphOutput } from "../../src/schemas/assist.js";
import { CEEGraphResponseV3 } from "../../src/schemas/cee-v3.js";
import { transformResponseToV3 } from "../../src/cee/transforms/schema-v3.js";
import type { V1DraftGraphResponse } from "../../src/cee/transforms/schema-v2.js";

// Suppress noisy logs during tests
vi.mock("../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  calculateCost: vi.fn(() => 0),
  TelemetryEvents: {},
}));

vi.mock("../../src/config/index.js", () => ({
  config: {
    cee: {
      debugCategoryTrace: false,
      debugLoggingEnabled: false,
    },
  },
  isProduction: () => false,
}));

// =============================================================================
// Fixtures
// =============================================================================

function makeSimpleV1Response(): V1DraftGraphResponse {
  return {
    graph: {
      version: "1",
      default_seed: 42,
      nodes: [
        { id: "decision_1", kind: "decision", label: "Hire or Build?" },
        { id: "opt_hire", kind: "option", label: "Hire externally", data: { interventions: { fac_cost: 80000, fac_time: 3 } } },
        { id: "opt_build", kind: "option", label: "Build internally", data: { interventions: { fac_cost: 40000, fac_time: 12 } } },
        { id: "fac_cost", kind: "factor", label: "Cost", category: "controllable", data: { value: 60000, extractionType: "inferred", factor_type: "cost", uncertainty_drivers: ["Budget variance"] } },
        { id: "fac_time", kind: "factor", label: "Time to Deliver", category: "controllable", data: { value: 6, extractionType: "inferred", factor_type: "time", uncertainty_drivers: ["Scope changes"] } },
        { id: "fac_quality", kind: "factor", label: "Team Quality", category: "observable", data: { value: 0.7, extractionType: "observed" } },
        { id: "fac_market", kind: "factor", label: "Market Conditions", category: "external" },
        { id: "out_success", kind: "outcome", label: "Project Success" },
        { id: "goal_1", kind: "goal", label: "Maximize project success" },
      ],
      edges: [
        { from: "decision_1", to: "opt_hire", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" as const },
        { from: "decision_1", to: "opt_build", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" as const },
        { from: "opt_hire", to: "fac_cost", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" as const },
        { from: "opt_hire", to: "fac_time", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" as const },
        { from: "opt_build", to: "fac_cost", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" as const },
        { from: "opt_build", to: "fac_time", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" as const },
        { from: "fac_cost", to: "out_success", strength_mean: -0.6, strength_std: 0.15, belief_exists: 0.9, effect_direction: "negative" as const },
        { from: "fac_time", to: "out_success", strength_mean: -0.4, strength_std: 0.2, belief_exists: 0.8, effect_direction: "negative" as const },
        { from: "fac_quality", to: "out_success", strength_mean: 0.7, strength_std: 0.1, belief_exists: 0.85, effect_direction: "positive" as const },
        { from: "fac_market", to: "out_success", strength_mean: 0.3, strength_std: 0.25, belief_exists: 0.6, effect_direction: "positive" as const },
        { from: "out_success", to: "goal_1", strength_mean: 0.9, strength_std: 0.05, belief_exists: 1, effect_direction: "positive" as const },
      ],
      meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
    },
    quality: { overall: 7, structure: 8, coverage: 7, causality: 7 },
    trace: {
      request_id: "test-simple-001",
      correlation_id: "test-simple-001",
      engine: { provider: "openai", model: "gpt-4.1", version: "1.0.0" },
      goal_handling: {
        goal_source: "llm_generated" as const,
        retry_attempted: false,
      },
    },
  };
}

function makeComplexV1Response(): V1DraftGraphResponse {
  return {
    graph: {
      version: "1",
      default_seed: 42,
      nodes: [
        { id: "decision_1", kind: "decision", label: "Expand into mid-market?" },
        { id: "opt_expand", kind: "option", label: "Expand to mid-market", data: { interventions: { fac_price: 149, fac_features: 0.8, fac_marketing: 50000 } } },
        { id: "opt_upmarket", kind: "option", label: "Go upmarket", data: { interventions: { fac_price: 299, fac_features: 0.9, fac_marketing: 30000 } } },
        { id: "opt_status_quo", kind: "option", label: "Stay in current segment", data: { interventions: { fac_price: 99, fac_features: 0.6, fac_marketing: 20000 } } },
        { id: "opt_pivot", kind: "option", label: "Pivot to enterprise", data: { interventions: { fac_price: 499, fac_features: 0.95, fac_marketing: 80000 } } },
        { id: "fac_price", kind: "factor", label: "Pricing", category: "controllable", data: { value: 99, extractionType: "explicit", factor_type: "price", uncertainty_drivers: ["Competitor response"] } },
        { id: "fac_features", kind: "factor", label: "Feature Completeness", category: "controllable", data: { value: 0.6, extractionType: "inferred", factor_type: "quality", uncertainty_drivers: ["Dev capacity"] } },
        { id: "fac_marketing", kind: "factor", label: "Marketing Budget", category: "controllable", data: { value: 20000, extractionType: "explicit", factor_type: "cost", uncertainty_drivers: ["ROI uncertainty"] } },
        // Unreachable factors (would be reclassified to external by sweep)
        { id: "fac_churn", kind: "factor", label: "Monthly Churn", category: "external" },
        { id: "fac_tam", kind: "factor", label: "TAM", category: "external" },
        // Observable factor
        { id: "fac_nps", kind: "factor", label: "NPS Score", category: "observable", data: { value: 42, extractionType: "observed" } },
        { id: "out_revenue", kind: "outcome", label: "Revenue Growth" },
        { id: "out_retention", kind: "outcome", label: "Customer Retention" },
        { id: "goal_1", kind: "goal", label: "Maximize sustainable growth" },
      ],
      edges: [
        { from: "decision_1", to: "opt_expand", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" as const },
        { from: "decision_1", to: "opt_upmarket", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" as const },
        { from: "decision_1", to: "opt_status_quo", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" as const },
        { from: "decision_1", to: "opt_pivot", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" as const },
        { from: "opt_expand", to: "fac_price", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" as const },
        { from: "opt_expand", to: "fac_features", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" as const },
        { from: "opt_expand", to: "fac_marketing", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" as const },
        { from: "opt_upmarket", to: "fac_price", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" as const },
        { from: "opt_status_quo", to: "fac_price", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" as const },
        { from: "opt_pivot", to: "fac_price", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" as const },
        { from: "fac_price", to: "out_revenue", strength_mean: 0.8, strength_std: 0.1, belief_exists: 0.9, effect_direction: "positive" as const },
        { from: "fac_features", to: "out_retention", strength_mean: 0.6, strength_std: 0.15, belief_exists: 0.85, effect_direction: "positive" as const },
        { from: "fac_marketing", to: "out_revenue", strength_mean: 0.5, strength_std: 0.2, belief_exists: 0.7, effect_direction: "positive" as const },
        { from: "fac_churn", to: "out_retention", strength_mean: -0.7, strength_std: 0.1, belief_exists: 0.9, effect_direction: "negative" as const },
        { from: "fac_tam", to: "out_revenue", strength_mean: 0.4, strength_std: 0.2, belief_exists: 0.6, effect_direction: "positive" as const },
        { from: "fac_nps", to: "out_retention", strength_mean: 0.5, strength_std: 0.15, belief_exists: 0.8, effect_direction: "positive" as const },
        { from: "out_revenue", to: "goal_1", strength_mean: 0.8, strength_std: 0.1, belief_exists: 0.95, effect_direction: "positive" as const },
        { from: "out_retention", to: "goal_1", strength_mean: 0.7, strength_std: 0.1, belief_exists: 0.9, effect_direction: "positive" as const },
      ],
      meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
    },
    quality: { overall: 8, structure: 8, coverage: 8, causality: 8 },
    trace: {
      request_id: "test-complex-001",
      correlation_id: "test-complex-001",
      engine: { provider: "openai", model: "gpt-4.1", version: "1.0.0" },
      goal_handling: {
        goal_source: "llm_generated" as const,
        retry_attempted: false,
      },
      repair_summary: {
        deterministic_repairs_count: 3,
        deterministic_repairs: [
          { code: "UNREACHABLE_FACTOR_RECLASSIFIED", path: "nodes[fac_churn].category", action: "Reclassified to external" },
          { code: "UNREACHABLE_FACTOR_RECLASSIFIED", path: "nodes[fac_tam].category", action: "Reclassified to external" },
          { code: "STATUS_QUO_WIRED", path: "nodes[opt_status_quo]", action: "Wired to factors" },
        ],
        unreachable_factors: { reclassified: ["fac_churn", "fac_tam"], marked_droppable: [] },
        status_quo: { fixed: true, marked_droppable: false },
        llm_repair_called: false,
        llm_repair_brief_included: false,
        edge_format_detected: "V1_FLAT",
        graph_delta: { nodes_before: 14, nodes_after: 14, edges_before: 18, edges_after: 20 },
      },
      strp: {
        mutation_count: 1,
        rules_triggered: ["rule_3_edge_direction"],
        mutations: [
          { rule: "rule_3_edge_direction", field: "effect_direction", from_value: "positive", to_value: "negative", edge_from: "fac_churn", edge_to: "out_retention" },
        ],
      },
    },
  };
}

function makeMinimalV1Response(): V1DraftGraphResponse {
  return {
    graph: {
      version: "1",
      default_seed: 42,
      nodes: [
        { id: "decision_1", kind: "decision", label: "Developer or Designer?" },
        { id: "opt_dev", kind: "option", label: "Hire developer" },
        { id: "opt_des", kind: "option", label: "Hire designer" },
        { id: "fac_velocity", kind: "factor", label: "Dev Velocity", category: "controllable", data: { value: 0.5 } },
        { id: "fac_ux", kind: "factor", label: "UX Quality", category: "controllable", data: { value: 0.5 } },
        { id: "out_product", kind: "outcome", label: "Product Quality" },
        { id: "goal_1", kind: "goal", label: "Ship best product" },
      ],
      edges: [
        { from: "decision_1", to: "opt_dev", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" as const },
        { from: "decision_1", to: "opt_des", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" as const },
        { from: "opt_dev", to: "fac_velocity", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" as const },
        { from: "opt_des", to: "fac_ux", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" as const },
        { from: "fac_velocity", to: "out_product", strength_mean: 0.6, strength_std: 0.15, belief_exists: 0.8, effect_direction: "positive" as const },
        { from: "fac_ux", to: "out_product", strength_mean: 0.7, strength_std: 0.1, belief_exists: 0.85, effect_direction: "positive" as const },
        { from: "out_product", to: "goal_1", strength_mean: 0.9, strength_std: 0.05, belief_exists: 1, effect_direction: "positive" as const },
      ],
      meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
    },
    trace: {
      request_id: "test-minimal-001",
      engine: { provider: "openai", model: "gpt-4.1" },
    },
  };
}

// =============================================================================
// Task 3: V3 Transform Conformance Tests
// =============================================================================

describe("V3 transform conformance — CEEGraphResponseV3 schema", () => {
  it("simple fixture passes CEEGraphResponseV3 schema", () => {
    const v1 = makeSimpleV1Response();
    const v3 = transformResponseToV3(v1, { requestId: "test-simple-001" });

    const result = CEEGraphResponseV3.safeParse(v3);
    if (!result.success) {
      const first = result.error.issues[0];
      throw new Error(
        `CEEGraphResponseV3 validation failed: path=${first?.path?.join(".")}, message=${first?.message}`,
      );
    }
    expect(result.success).toBe(true);
  });

  it("complex fixture (repair_summary, model_adjustments, external factors) passes schema", () => {
    const v1 = makeComplexV1Response();
    const v3 = transformResponseToV3(v1, { requestId: "test-complex-001" });

    const result = CEEGraphResponseV3.safeParse(v3);
    if (!result.success) {
      const first = result.error.issues[0];
      throw new Error(
        `CEEGraphResponseV3 validation failed: path=${first?.path?.join(".")}, message=${first?.message}`,
      );
    }
    expect(result.success).toBe(true);

    // Verify repair_summary is in trace
    expect((v3 as any).trace?.repair_summary).toBeDefined();
    expect((v3 as any).trace?.repair_summary?.deterministic_repairs_count).toBe(3);
  });

  it("minimal fixture passes CEEGraphResponseV3 schema", () => {
    const v1 = makeMinimalV1Response();
    const v3 = transformResponseToV3(v1, { requestId: "test-minimal-001" });

    const result = CEEGraphResponseV3.safeParse(v3);
    if (!result.success) {
      const first = result.error.issues[0];
      throw new Error(
        `CEEGraphResponseV3 validation failed: path=${first?.path?.join(".")}, message=${first?.message}`,
      );
    }
    expect(result.success).toBe(true);
  });

  it("V3 schema preserves unknown additive fields via passthrough", () => {
    const v1 = makeMinimalV1Response();
    const v3 = transformResponseToV3(v1, { requestId: "test-passthrough-001" });

    // Add an unknown additive field
    (v3 as any).future_field = "should_be_preserved";

    const result = CEEGraphResponseV3.safeParse(v3);
    expect(result.success).toBe(true);
    // passthrough should preserve the field
    if (result.success) {
      expect((result.data as any).future_field).toBe("should_be_preserved");
    }
  });
});

// =============================================================================
// Task 3: DraftGraphOutput conformance for post-repair graphs
// =============================================================================

describe("DraftGraphOutput conformance — post-repair graph shapes", () => {
  it("graph with external factor (no data) passes DraftGraphOutput", () => {
    const input = {
      graph: {
        version: "1",
        default_seed: 42,
        nodes: [
          { id: "decision_1", kind: "decision", label: "Test" },
          { id: "opt_a", kind: "option", label: "A" },
          { id: "fac_ext", kind: "factor", label: "External Factor", category: "external" },
          // No data field — external factors legitimately have no data
          { id: "out_1", kind: "outcome", label: "Outcome" },
          { id: "goal_1", kind: "goal", label: "Goal" },
        ],
        edges: [
          { from: "decision_1", to: "opt_a", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
          { from: "opt_a", to: "fac_ext", strength_mean: 0.5, strength_std: 0.1, belief_exists: 0.8, effect_direction: "positive" },
          { from: "fac_ext", to: "out_1", strength_mean: 0.3, strength_std: 0.2, belief_exists: 0.6, effect_direction: "positive" },
          { from: "out_1", to: "goal_1", strength_mean: 0.8, strength_std: 0.1, belief_exists: 0.9, effect_direction: "positive" },
        ],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
      },
    };

    const result = DraftGraphOutput.safeParse(input);
    if (!result.success) {
      const first = result.error.issues[0];
      throw new Error(
        `DraftGraphOutput failed: path=${first?.path?.join(".")}, message=${first?.message}, code=${first?.code}`,
      );
    }
    expect(result.success).toBe(true);
  });

  it("graph with controllable factor (data.value present) passes DraftGraphOutput", () => {
    const input = {
      graph: {
        version: "1",
        default_seed: 42,
        nodes: [
          { id: "decision_1", kind: "decision", label: "Test" },
          { id: "opt_a", kind: "option", label: "A", data: { interventions: { fac_cost: 100 } } },
          { id: "fac_cost", kind: "factor", label: "Cost", category: "controllable", data: { value: 50, extractionType: "inferred", factor_type: "cost" } },
          { id: "out_1", kind: "outcome", label: "Outcome" },
          { id: "goal_1", kind: "goal", label: "Goal" },
        ],
        edges: [
          { from: "decision_1", to: "opt_a", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
          { from: "opt_a", to: "fac_cost", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
          { from: "fac_cost", to: "out_1", strength_mean: -0.6, strength_std: 0.15, belief_exists: 0.9, effect_direction: "negative" },
          { from: "out_1", to: "goal_1", strength_mean: 0.9, strength_std: 0.05, belief_exists: 1, effect_direction: "positive" },
        ],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
      },
    };

    const result = DraftGraphOutput.safeParse(input);
    if (!result.success) {
      const first = result.error.issues[0];
      throw new Error(
        `DraftGraphOutput failed: path=${first?.path?.join(".")}, message=${first?.message}`,
      );
    }
    expect(result.success).toBe(true);
  });

  it("graph with data={extractionType:'inferred'} (no value) FAILS DraftGraphOutput", () => {
    // This is the exact shape that caused the 400 before the fix.
    // After the fix, the sweep removes data entirely instead of leaving this partial.
    const input = {
      graph: {
        version: "1",
        default_seed: 42,
        nodes: [
          { id: "decision_1", kind: "decision", label: "Test" },
          { id: "opt_a", kind: "option", label: "A" },
          // This data object can't satisfy any NodeData union branch
          { id: "fac_broken", kind: "factor", label: "Broken", category: "external", data: { extractionType: "inferred" } },
          { id: "out_1", kind: "outcome", label: "Outcome" },
          { id: "goal_1", kind: "goal", label: "Goal" },
        ],
        edges: [
          { from: "decision_1", to: "opt_a", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
          { from: "opt_a", to: "fac_broken", strength_mean: 0.5, strength_std: 0.1, belief_exists: 0.8, effect_direction: "positive" },
          { from: "fac_broken", to: "out_1", strength_mean: 0.3, strength_std: 0.2, belief_exists: 0.6, effect_direction: "positive" },
          { from: "out_1", to: "goal_1", strength_mean: 0.8, strength_std: 0.1, belief_exists: 0.9, effect_direction: "positive" },
        ],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
      },
    };

    // This SHOULD fail — data={extractionType:"inferred"} matches no NodeData branch
    const result = DraftGraphOutput.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("graph with constraint node passes DraftGraphOutput", () => {
    const input = {
      graph: {
        version: "1",
        default_seed: 42,
        nodes: [
          { id: "decision_1", kind: "decision", label: "Test" },
          { id: "opt_a", kind: "option", label: "A" },
          { id: "fac_1", kind: "factor", label: "Factor", category: "controllable", data: { value: 0.5 } },
          { id: "constraint_fac_1_max", kind: "constraint", label: "Max Factor",
            data: { operator: "<=" },
            observed_state: { value: 100, metadata: { operator: "<=" } },
          },
          { id: "out_1", kind: "outcome", label: "Outcome" },
          { id: "goal_1", kind: "goal", label: "Goal" },
        ],
        edges: [
          { from: "decision_1", to: "opt_a", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
          { from: "opt_a", to: "fac_1", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
          { from: "fac_1", to: "out_1", strength_mean: 0.5, strength_std: 0.1, belief_exists: 0.8, effect_direction: "positive" },
          { from: "out_1", to: "goal_1", strength_mean: 0.9, strength_std: 0.05, belief_exists: 1, effect_direction: "positive" },
          { from: "constraint_fac_1_max", to: "fac_1", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
        ],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
      },
    };

    const result = DraftGraphOutput.safeParse(input);
    if (!result.success) {
      const first = result.error.issues[0];
      throw new Error(
        `DraftGraphOutput failed: path=${first?.path?.join(".")}, message=${first?.message}`,
      );
    }
    expect(result.success).toBe(true);
  });
});

// =============================================================================
// Task 4: Pipeline-to-schema integration test
// =============================================================================

describe("Pipeline-to-schema integration — full boundary path", () => {
  it("realistic post-pipeline V1 response → transformResponseToV3 → CEEGraphResponseV3 passes", () => {
    const v1 = makeComplexV1Response();
    const v3 = transformResponseToV3(v1, {
      requestId: "test-pipeline-001",
      brief: "Should we expand into the mid-market segment?",
    });

    // Simulate boundary stage: add model_adjustments + blockers
    if (v3.analysis_ready) {
      v3.analysis_ready.model_adjustments = [
        { code: "connectivity_repaired" as any, field: "effect_direction", reason: "Corrected edge direction" },
        { code: "category_reclassified" as any, field: "nodes[fac_churn].category", reason: "Reclassified to external" },
      ];
    }

    const result = CEEGraphResponseV3.safeParse(v3);
    if (!result.success) {
      const first = result.error.issues[0];
      throw new Error(
        `Pipeline-to-schema failed: path=${first?.path?.join(".")}, message=${first?.message}`,
      );
    }
    expect(result.success).toBe(true);

    // Verify key fields survive the transform
    expect(v3.schema_version).toBe("3.0");
    expect(v3.nodes.length).toBeGreaterThan(0);
    expect(v3.edges.length).toBeGreaterThan(0);
    expect(v3.options.length).toBeGreaterThan(0);
    expect(v3.analysis_ready).toBeDefined();
    expect(v3.analysis_ready.status).toBeDefined();
  });

  it("V1 response with goal_constraints → V3 preserves them", () => {
    const v1 = makeSimpleV1Response();
    (v1 as any).goal_constraints = [
      {
        constraint_id: "gc_budget_cap",
        node_id: "fac_cost",
        operator: "<=",
        value: 100000,
        label: "Budget cap",
        confidence: 0.9,
        provenance: "explicit",
      },
    ];

    const v3 = transformResponseToV3(v1, { requestId: "test-constraints-001" });

    const result = CEEGraphResponseV3.safeParse(v3);
    if (!result.success) {
      const first = result.error.issues[0];
      throw new Error(
        `goal_constraints test failed: path=${first?.path?.join(".")}, message=${first?.message}, code=${first?.code}, expected=${(first as any)?.expected}, received=${(first as any)?.received}`,
      );
    }
    expect(result.success).toBe(true);
    expect(v3.goal_constraints).toBeDefined();
    expect(v3.goal_constraints).toHaveLength(1);
    expect(v3.goal_constraints![0].node_id).toBe("fac_cost");
  });
});

// =============================================================================
// Task 3: goal_threshold + goal_constraints passthrough verification
// =============================================================================

describe("goal_threshold fields — serialisation passthrough", () => {
  it("goal_threshold fields survive DraftGraphOutput.parse()", () => {
    const input = {
      graph: {
        version: "1",
        default_seed: 42,
        nodes: [
          { id: "decision_1", kind: "decision", label: "Test" },
          { id: "opt_a", kind: "option", label: "A" },
          { id: "fac_1", kind: "factor", label: "Factor", category: "controllable", data: { value: 0.5 } },
          { id: "out_1", kind: "outcome", label: "Outcome" },
          {
            id: "goal_1", kind: "goal", label: "Grow to 800 customers",
            goal_threshold: 0.8,
            goal_threshold_raw: 800,
            goal_threshold_unit: "customers",
            goal_threshold_cap: 1000,
          },
        ],
        edges: [
          { from: "decision_1", to: "opt_a", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
          { from: "opt_a", to: "fac_1", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
          { from: "fac_1", to: "out_1", strength_mean: 0.6, strength_std: 0.15, belief_exists: 0.8, effect_direction: "positive" },
          { from: "out_1", to: "goal_1", strength_mean: 0.9, strength_std: 0.05, belief_exists: 1, effect_direction: "positive" },
        ],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
      },
    };

    const result = DraftGraphOutput.safeParse(input);
    if (!result.success) {
      const first = result.error.issues[0];
      throw new Error(
        `DraftGraphOutput failed: path=${first?.path?.join(".")}, message=${first?.message}`,
      );
    }
    expect(result.success).toBe(true);

    // Verify goal_threshold fields survived Zod parse
    const goalNode = (result.data as any).graph.nodes.find((n: any) => n.id === "goal_1");
    expect(goalNode.goal_threshold).toBe(0.8);
    expect(goalNode.goal_threshold_raw).toBe(800);
    expect(goalNode.goal_threshold_unit).toBe("customers");
    expect(goalNode.goal_threshold_cap).toBe(1000);
  });

  it("goal_threshold fields survive V1→V3 transform", () => {
    const v1 = makeSimpleV1Response();
    // Add goal_threshold fields to the goal node
    const goalNode = v1.graph.nodes.find((n: any) => n.kind === "goal")!;
    (goalNode as any).goal_threshold = 0.8;
    (goalNode as any).goal_threshold_raw = 800;
    (goalNode as any).goal_threshold_unit = "customers";
    (goalNode as any).goal_threshold_cap = 1000;

    const v3 = transformResponseToV3(v1, { requestId: "test-threshold-001" });

    // Verify fields survive V3 transform
    const v3GoalNode = v3.nodes.find((n) => n.kind === "goal")!;
    expect(v3GoalNode.goal_threshold).toBe(0.8);
    expect(v3GoalNode.goal_threshold_raw).toBe(800);
    expect(v3GoalNode.goal_threshold_unit).toBe("customers");
    expect(v3GoalNode.goal_threshold_cap).toBe(1000);

    // Verify V3 response still passes schema
    const result = CEEGraphResponseV3.safeParse(v3);
    if (!result.success) {
      const first = result.error.issues[0];
      throw new Error(
        `CEEGraphResponseV3 validation failed: path=${first?.path?.join(".")}, message=${first?.message}`,
      );
    }
    expect(result.success).toBe(true);

    // Verify fields survived schema validation
    const parsedGoal = (result.data as any).nodes.find((n: any) => n.kind === "goal");
    expect(parsedGoal.goal_threshold).toBe(0.8);
    expect(parsedGoal.goal_threshold_raw).toBe(800);
    expect(parsedGoal.goal_threshold_unit).toBe("customers");
    expect(parsedGoal.goal_threshold_cap).toBe(1000);
  });
});

describe("goal_constraints — serialisation passthrough", () => {
  it("goal_constraints survive DraftGraphOutput.parse()", () => {
    const input = {
      graph: {
        version: "1",
        default_seed: 42,
        nodes: [
          { id: "decision_1", kind: "decision", label: "Test" },
          { id: "opt_a", kind: "option", label: "A" },
          { id: "fac_cost", kind: "factor", label: "Cost", category: "controllable", data: { value: 50 } },
          { id: "out_1", kind: "outcome", label: "Outcome" },
          { id: "goal_1", kind: "goal", label: "Goal" },
        ],
        edges: [
          { from: "decision_1", to: "opt_a", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
          { from: "opt_a", to: "fac_cost", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
          { from: "fac_cost", to: "out_1", strength_mean: -0.6, strength_std: 0.15, belief_exists: 0.9, effect_direction: "negative" },
          { from: "out_1", to: "goal_1", strength_mean: 0.9, strength_std: 0.05, belief_exists: 1, effect_direction: "positive" },
        ],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
      },
      goal_constraints: [
        {
          constraint_id: "gc_budget_cap",
          node_id: "fac_cost",
          operator: "<=",
          value: 100000,
          label: "Budget cap",
          confidence: 0.9,
          provenance: "explicit",
        },
      ],
    };

    const result = DraftGraphOutput.safeParse(input);
    if (!result.success) {
      const first = result.error.issues[0];
      throw new Error(
        `DraftGraphOutput failed: path=${first?.path?.join(".")}, message=${first?.message}`,
      );
    }
    expect(result.success).toBe(true);

    // Verify goal_constraints survived Zod parse
    const gc = (result.data as any).goal_constraints;
    expect(gc).toHaveLength(1);
    expect(gc[0].node_id).toBe("fac_cost");
    expect(gc[0].operator).toBe("<=");
    expect(gc[0].value).toBe(100000);
  });

  it("goal_constraints survive full V1→V3→CEEGraphResponseV3 round-trip", () => {
    const v1 = makeSimpleV1Response();
    (v1 as any).goal_constraints = [
      {
        constraint_id: "gc_churn_cap",
        node_id: "fac_cost",
        operator: "<=",
        value: 0.05,
        label: "Churn cap",
        confidence: 0.85,
        provenance: "explicit",
      },
      {
        constraint_id: "gc_revenue_floor",
        node_id: "out_success",
        operator: ">=",
        value: 1000000,
        label: "Revenue floor",
        confidence: 0.9,
        provenance: "explicit",
      },
    ];

    const v3 = transformResponseToV3(v1, { requestId: "test-gc-roundtrip-001" });

    // V3 transform must carry goal_constraints
    expect(v3.goal_constraints).toHaveLength(2);
    expect(v3.goal_constraints![0].node_id).toBe("fac_cost");
    expect(v3.goal_constraints![1].node_id).toBe("out_success");

    // Schema validation must pass and preserve them
    const result = CEEGraphResponseV3.safeParse(v3);
    if (!result.success) {
      const first = result.error.issues[0];
      throw new Error(
        `CEEGraphResponseV3 validation failed: path=${first?.path?.join(".")}, message=${first?.message}`,
      );
    }
    expect(result.success).toBe(true);
    expect((result.data as any).goal_constraints).toHaveLength(2);
  });
});

// =============================================================================
// Phase 1 stripping prevention — passthrough + edge origin tests
// =============================================================================

describe("Graph schema passthrough — internal pipeline boundary", () => {
  it("Graph.parse() preserves unknown top-level fields via passthrough", async () => {
    const { Graph } = await vi.importActual<typeof import("../../src/schemas/graph.js")>(
      "../../src/schemas/graph.js"
    );

    const input = {
      version: "1",
      default_seed: 42,
      nodes: [
        { id: "goal_1", kind: "goal", label: "Goal" },
      ],
      edges: [],
      meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
      // Unknown field added by a future pipeline stage
      _custom_field: "preserved",
    };

    const result = (Graph as any).safeParse(input);
    expect(result.success).toBe(true);
    expect(result.data._custom_field).toBe("preserved");
  });

  it("Node schema preserves unknown fields via passthrough (existing behaviour)", async () => {
    const { Node } = await vi.importActual<typeof import("../../src/schemas/graph.js")>(
      "../../src/schemas/graph.js"
    );

    const input = {
      id: "test_node",
      kind: "factor",
      label: "Test Factor",
      _enrichment_score: 0.95,
    };

    const result = (Node as any).safeParse(input);
    expect(result.success).toBe(true);
    expect(result.data._enrichment_score).toBe(0.95);
  });
});

describe("GoalConstraintSchema passthrough — preserves additive metadata", () => {
  it("GoalConstraintSchema preserves known optional fields after parse", async () => {
    const { GoalConstraintSchema } = await vi.importActual<typeof import("../../src/schemas/assist.js")>(
      "../../src/schemas/assist.js"
    );

    const input = {
      constraint_id: "gc_test",
      node_id: "fac_cost",
      operator: "<=",
      value: 100000,
      source_quote: "Budget must not exceed £100k",
      confidence: 0.9,
      provenance: "explicit",
      deadline_metadata: {
        deadline_date: "2025-12-31",
        reference_date: "2025-01-01",
        assumed_reference_date: false,
      },
    };

    const result = (GoalConstraintSchema as any).safeParse(input);
    expect(result.success).toBe(true);
    expect(result.data.source_quote).toBe("Budget must not exceed £100k");
    expect(result.data.confidence).toBe(0.9);
    expect(result.data.provenance).toBe("explicit");
    expect(result.data.deadline_metadata.deadline_date).toBe("2025-12-31");
  });

  it("GoalConstraintSchema preserves unknown additive fields via passthrough", async () => {
    const { GoalConstraintSchema } = await vi.importActual<typeof import("../../src/schemas/assist.js")>(
      "../../src/schemas/assist.js"
    );

    const input = {
      constraint_id: "gc_test",
      node_id: "fac_cost",
      operator: "<=",
      value: 100000,
      // Future additive field — should survive parse
      _priority: "high",
    };

    const result = (GoalConstraintSchema as any).safeParse(input);
    expect(result.success).toBe(true);
    expect(result.data._priority).toBe("high");
  });
});

describe("V3 edge origin — transformEdgeToV3 output", () => {
  it("edges with explicit origin preserve it in V3 output", () => {
    const v1 = makeSimpleV1Response();
    // Set origin on first edge
    (v1.graph.edges[0] as any).origin = "user";

    const v3 = transformResponseToV3(v1, { requestId: "test-origin-001" });

    // First edge should have origin 'user'
    const firstEdge = v3.edges[0];
    expect((firstEdge as any).origin).toBe("user");
  });

  it("edges without origin default to 'ai' in V3 output", () => {
    const v1 = makeSimpleV1Response();
    // Ensure no origin is set
    for (const edge of v1.graph.edges) {
      delete (edge as any).origin;
    }

    const v3 = transformResponseToV3(v1, { requestId: "test-origin-default-001" });

    // All edges should default to origin 'ai'
    for (const edge of v3.edges) {
      expect((edge as any).origin).toBe("ai");
    }
  });

  it("edge origin survives CEEGraphResponseV3 schema validation", () => {
    const v1 = makeSimpleV1Response();
    (v1.graph.edges[0] as any).origin = "repair";

    const v3 = transformResponseToV3(v1, { requestId: "test-origin-schema-001" });

    const result = CEEGraphResponseV3.safeParse(v3);
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data.edges[0] as any).origin).toBe("repair");
    }
  });
});

// =============================================================================
// Structural parse logging test
// =============================================================================

describe("Structural parse — diagnostic logging", () => {
  it("logs first_issue_path and first_issue_message on Zod parse failure", async () => {
    const { runStructuralParse } = await import(
      "../../src/cee/unified-pipeline/stages/repair/structural-parse.js"
    );
    const { log } = await import("../../src/utils/telemetry.js");

    const ctx: any = {
      graph: {
        version: "1",
        default_seed: 42,
        nodes: [
          { id: "goal_1", kind: "goal", label: "Goal" },
          // Node with partial data that fails NodeData union
          { id: "fac_bad", kind: "factor", label: "Bad", data: { extractionType: "inferred" } },
        ],
        edges: [],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
      },
      rationales: [],
      confidence: 0.7,
      goalConstraints: undefined,
      requestId: "test-diag-001",
    };

    // Un-mock DraftGraphOutput.parse for this test — use the real schema
    const { DraftGraphOutput: RealSchema } = await vi.importActual<
      typeof import("../../src/schemas/assist.js")
    >("../../src/schemas/assist.js");

    // Temporarily replace the mock with the real parse
    const originalParse = DraftGraphOutput.parse;
    (DraftGraphOutput as any).parse = RealSchema.parse.bind(RealSchema);

    try {
      runStructuralParse(ctx);
    } finally {
      (DraftGraphOutput as any).parse = originalParse;
    }

    // Should have set earlyReturn with 400
    expect(ctx.earlyReturn).toBeDefined();
    expect(ctx.earlyReturn.statusCode).toBe(400);

    // Verify diagnostic fields are logged (first_issues array with up to 3 entries)
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "cee.structural_parse.failed",
        first_issues: expect.arrayContaining([
          expect.objectContaining({
            path: expect.any(String),
            message: expect.any(String),
            code: expect.any(String),
          }),
        ]),
      }),
      expect.any(String),
    );
  });
});
