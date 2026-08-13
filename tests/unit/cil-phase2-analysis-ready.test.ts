/**
 * CIL Phase 2: Analysis-Ready Robustness Tests
 *
 * Task 2A: data.value fallback in buildAnalysisReadyPayload
 * Task 2B: blockers[] scaffolding for qualitative briefs
 * Task 2C: model_adjustments[] mapping from STRP/repair mutations
 * Task 2D: Post-Enrich invariant (observability — tested via schema)
 */

import { describe, it, expect } from "vitest";
import {
  buildAnalysisReadyPayload,
  mapMutationsToAdjustments,
  validateAnalysisReadyPayload,
} from "../../src/cee/transforms/analysis-ready.js";
import {
  AnalysisReadyPayload,
  AnalysisBlocker,
  ModelAdjustment,
} from "../../src/schemas/analysis-ready.js";
import type { OptionV3T, GraphV3T, NodeV3T } from "../../src/schemas/cee-v3.js";

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Create a minimal V3 option for testing.
 */
function createV3Option(
  id: string,
  label: string,
  interventions: Record<string, { value: number; factorId: string }>,
  status: "ready" | "needs_user_mapping" = "ready"
): OptionV3T {
  const v3Interventions: OptionV3T["interventions"] = {};
  for (const [key, { value, factorId }] of Object.entries(interventions)) {
    v3Interventions[key] = {
      value,
      source: "brief_extraction",
      target_match: {
        node_id: factorId,
        match_type: "exact_id",
        confidence: "high",
      },
    };
  }

  return {
    id,
    label,
    status,
    interventions: v3Interventions,
  };
}

/**
 * Create a V3 graph with typed nodes (including category and observed_state).
 */
function createV3Graph(
  nodes: Array<{
    id: string;
    kind: string;
    label: string;
    category?: "controllable" | "observable" | "external";
    observed_state?: { value: number; unit?: string };
    data?: { value: number }; // V1 passthrough field
  }>,
  edges: Array<{ from: string; to: string }>
): GraphV3T {
  return {
    nodes: nodes.map((n) => {
      const node: any = {
        id: n.id,
        kind: n.kind as NodeV3T["kind"],
        label: n.label,
      };
      if (n.category) node.category = n.category;
      if (n.observed_state) node.observed_state = n.observed_state;
      // V1 data field preserved via .passthrough()
      if (n.data) node.data = n.data;
      return node as NodeV3T;
    }),
    edges: edges.map((e) => ({
      from: e.from,
      to: e.to,
      strength: { mean: 0.5, std: 0.2 },
      exists_probability: 0.8,
      effect_direction: "positive" as const,
    })),
  };
}

// ============================================================================
// Task 2A: data.value fallback
// ============================================================================

describe("Task 2A: Factor value fallback in analysis_ready", () => {
  it("declines to fill from observed_state.value, and reports the level it declined", () => {
    const graph = createV3Graph(
      [
        { id: "goal_1", kind: "goal", label: "Goal" },
        { id: "dec_1", kind: "decision", label: "Decision" },
        { id: "opt_1", kind: "option", label: "Option A" },
        {
          id: "fac_price", kind: "factor", label: "Price",
          category: "controllable",
          observed_state: { value: 59, unit: "GBP" },
        },
      ],
      [
        { from: "dec_1", to: "opt_1" },
        { from: "opt_1", to: "fac_price" },
        { from: "fac_price", to: "goal_1" },
      ]
    );

    // Option has NO interventions — empty
    const option = createV3Option("opt_1", "Option A", {}, "needs_user_mapping");

    const payload = buildAnalysisReadyPayload([option], "goal_1", graph);

    // ⚠ CONTRACT REVERSED DELIBERATELY. 59 is the factor's CURRENT level — what
    // holds if nobody acts. Writing it as this option's intervention asserts
    // "Option A sets price to 59", which nobody said.
    expect(payload.options[0].interventions).not.toHaveProperty("fac_price");

    // The refusal carries the level forward as CONTEXT rather than as an answer,
    // so the user is better off than before, not merely blocked.
    const blocker = payload.blockers?.find(
      (b) => b.option_id === "opt_1" && b.factor_id === "fac_price",
    );
    expect(blocker).toBeDefined();
    expect(blocker!.message).toContain("59");
  });

  it("declines to fill from the data.value passthrough when observed_state is absent", () => {
    const graph = createV3Graph(
      [
        { id: "goal_1", kind: "goal", label: "Goal" },
        { id: "dec_1", kind: "decision", label: "Decision" },
        { id: "opt_1", kind: "option", label: "Option A" },
        {
          id: "fac_price", kind: "factor", label: "Price",
          category: "controllable",
          data: { value: 42 }, // V1 passthrough field, no observed_state
        },
      ],
      [
        { from: "dec_1", to: "opt_1" },
        { from: "opt_1", to: "fac_price" },
        { from: "fac_price", to: "goal_1" },
      ]
    );

    const option = createV3Option("opt_1", "Option A", {}, "needs_user_mapping");

    const payload = buildAnalysisReadyPayload([option], "goal_1", graph);

    expect(payload.options[0].interventions).not.toHaveProperty("fac_price");
    const blocker = payload.blockers?.find(
      (b) => b.option_id === "opt_1" && b.factor_id === "fac_price",
    );
    expect(blocker).toBeDefined();
    expect(blocker!.message).toContain("42");
  });

  it("when both carriers exist, the DECLINED level is the one it would have used", () => {
    const graph = createV3Graph(
      [
        { id: "goal_1", kind: "goal", label: "Goal" },
        { id: "opt_1", kind: "option", label: "Option A" },
        {
          id: "fac_price", kind: "factor", label: "Price",
          category: "controllable",
          observed_state: { value: 100 },
          data: { value: 50 }, // Should be ignored
        },
      ],
      [
        { from: "opt_1", to: "fac_price" },
        { from: "fac_price", to: "goal_1" },
      ]
    );

    const option = createV3Option("opt_1", "Option A", {}, "needs_user_mapping");

    const payload = buildAnalysisReadyPayload([option], "goal_1", graph);

    // Precedence still matters, but it now decides WHICH LEVEL WE REPORT rather
    // than which value we invent: observed_state (100) outranks data.value (50).
    expect(payload.options[0].interventions).not.toHaveProperty("fac_price");
    const blocker = payload.blockers?.find(
      (b) => b.option_id === "opt_1" && b.factor_id === "fac_price",
    );
    expect(blocker).toBeDefined();
    expect(blocker!.message).toContain("100");
    expect(blocker!.message).not.toContain("50");
  });

  it("does NOT overwrite existing interventions via fallback", () => {
    const graph = createV3Graph(
      [
        { id: "goal_1", kind: "goal", label: "Goal" },
        { id: "opt_1", kind: "option", label: "Option A" },
        {
          id: "fac_price", kind: "factor", label: "Price",
          category: "controllable",
          observed_state: { value: 999 },
        },
      ],
      [
        { from: "opt_1", to: "fac_price" },
        { from: "fac_price", to: "goal_1" },
      ]
    );

    // Option already has intervention for fac_price
    const option = createV3Option("opt_1", "Option A", {
      fac_price: { value: 59, factorId: "fac_price" },
    });

    const payload = buildAnalysisReadyPayload([option], "goal_1", graph);

    // Should keep the original intervention value, NOT the observed_state.value
    expect(payload.options[0].interventions["fac_price"]).toBe(59);
  });

  it("skips fallback for non-controllable factors", () => {
    const graph = createV3Graph(
      [
        { id: "goal_1", kind: "goal", label: "Goal" },
        { id: "opt_1", kind: "option", label: "Option A" },
        {
          id: "fac_ext", kind: "factor", label: "Market Demand",
          category: "external",
          observed_state: { value: 1000 },
        },
      ],
      [
        { from: "opt_1", to: "fac_ext" },
        { from: "fac_ext", to: "goal_1" },
      ]
    );

    const option = createV3Option("opt_1", "Option A", {}, "needs_user_mapping");

    const payload = buildAnalysisReadyPayload([option], "goal_1", graph);

    // Should NOT fill because the factor is external, not controllable
    expect(payload.options[0].interventions).not.toHaveProperty("fac_ext");
  });

  it("declines to substitute a factor's current level for an option's lever, and says why", () => {
    const graph = createV3Graph(
      [
        { id: "goal_1", kind: "goal", label: "Goal" },
        { id: "opt_1", kind: "option", label: "Option A" },
        {
          id: "fac_price", kind: "factor", label: "Price",
          category: "controllable",
          observed_state: { value: 59 },
        },
      ],
      [
        { from: "opt_1", to: "fac_price" },
        { from: "fac_price", to: "goal_1" },
      ]
    );

    // ⚠ CONTRACT REVERSED DELIBERATELY. This case previously asserted that the
    // fallback FILLED `fac_price := 59` from `observed_state.value` and promoted
    // the option to "ready".
    //
    // 59 is the factor's CURRENT level — what happens if nobody acts. Writing it
    // as this option's intervention asserts "Option A sets price to 59", which
    // nobody said. Two measured consequences: every option lacking a stated
    // magnitude received the SAME number, so the analysis compared strategies
    // that were numerically identical; and public `options[]` showed `{}` while
    // this copy showed a value, so the set SHOWN and the set ANALYSED were
    // different objects with different contents.
    const option = createV3Option("opt_1", "Option A", {});

    const payload = buildAnalysisReadyPayload([option], "goal_1", graph);

    // No invention: the option is left exactly as empty as it truly is.
    expect(payload.options[0].interventions["fac_price"]).toBeUndefined();
    expect(Object.keys(payload.options[0].interventions).length).toBe(0);
    expect(payload.options[0].status).toBe("needs_user_mapping");

    // The refusal is honest about WHY, and useful: it names the factor, reports
    // the current level as context, and asks the question we could not answer.
    const blocker = payload.blockers?.find(
      (b) => b.option_id === "opt_1" && b.factor_id === "fac_price",
    );
    expect(blocker).toBeDefined();
    expect(blocker!.blocker_type).toBe("missing_value");
    expect(blocker!.message).toContain("59");
    expect(blocker!.suggested_action).toBe("add_value");
  });
});

// ============================================================================
// Task 2B: blockers[] scaffolding
// ============================================================================

describe("Task 2B: Blockers scaffolding for qualitative briefs", () => {
  it("emits blocker when controllable factor has no value", () => {
    const graph = createV3Graph(
      [
        { id: "goal_1", kind: "goal", label: "Goal" },
        { id: "opt_1", kind: "option", label: "Option A" },
        {
          id: "fac_price", kind: "factor", label: "Price",
          category: "controllable",
          // No observed_state, no data — qualitative brief scenario
        },
      ],
      [
        { from: "opt_1", to: "fac_price" },
        { from: "fac_price", to: "goal_1" },
      ]
    );

    const option = createV3Option("opt_1", "Option A", {}, "needs_user_mapping");

    const payload = buildAnalysisReadyPayload([option], "goal_1", graph);

    expect(payload.blockers).toBeDefined();
    expect(payload.blockers!.length).toBe(1);
    expect(payload.blockers![0]).toMatchObject({
      option_id: "opt_1",
      option_label: "Option A",
      factor_id: "fac_price",
      factor_label: "Price",
      blocker_type: "missing_value",
      suggested_action: "add_value",
    });
    expect(payload.blockers![0].message).toContain("Price");
  });

  it("sets payload status to needs_user_input when blockers exist", () => {
    const graph = createV3Graph(
      [
        { id: "goal_1", kind: "goal", label: "Goal" },
        { id: "opt_1", kind: "option", label: "Option A" },
        {
          id: "fac_no_value", kind: "factor", label: "Demand",
          category: "controllable",
        },
      ],
      [
        { from: "opt_1", to: "fac_no_value" },
        { from: "fac_no_value", to: "goal_1" },
      ]
    );

    const option = createV3Option("opt_1", "Option A", {}, "needs_user_mapping");

    const payload = buildAnalysisReadyPayload([option], "goal_1", graph);

    expect(payload.status).toBe("needs_user_input");
  });

  it("a factor HAVING a current value does not excuse an option that never stated one", () => {
    const graph = createV3Graph(
      [
        { id: "goal_1", kind: "goal", label: "Goal" },
        { id: "opt_1", kind: "option", label: "Option A" },
        {
          id: "fac_price", kind: "factor", label: "Price",
          category: "controllable",
          observed_state: { value: 59 },
        },
      ],
      [
        { from: "opt_1", to: "fac_price" },
        { from: "fac_price", to: "goal_1" },
      ]
    );

    const option = createV3Option("opt_1", "Option A", {}, "needs_user_mapping");

    const payload = buildAnalysisReadyPayload([option], "goal_1", graph);

    // ⚠ PREMISE REVERSED DELIBERATELY. This case previously read "all
    // controllable factors have values ⇒ no blockers" — but the value in
    // question belongs to the FACTOR, not to the option. `fac_price` knowing it
    // is currently 59 says nothing about what Option A does to it, and the
    // option→factor edge is the model's own assertion that Option A DOES move
    // it. So the gap is real and is now reported rather than back-filled.
    const blocker = payload.blockers?.find(
      (b) => b.option_id === "opt_1" && b.factor_id === "fac_price",
    );
    expect(blocker).toBeDefined();
    expect(payload.status).toBe("needs_user_input");
  });

  it("blocker validates against AnalysisBlocker schema", () => {
    const graph = createV3Graph(
      [
        { id: "goal_1", kind: "goal", label: "Goal" },
        { id: "opt_1", kind: "option", label: "Option A" },
        {
          id: "fac_x", kind: "factor", label: "Unknown Factor",
          category: "controllable",
        },
      ],
      [
        { from: "opt_1", to: "fac_x" },
        { from: "fac_x", to: "goal_1" },
      ]
    );

    const option = createV3Option("opt_1", "Option A", {}, "needs_user_mapping");

    const payload = buildAnalysisReadyPayload([option], "goal_1", graph);

    // Each blocker should pass Zod validation
    for (const blocker of payload.blockers ?? []) {
      const result = AnalysisBlocker.safeParse(blocker);
      expect(result.success).toBe(true);
    }
  });

  it("emits multiple blockers for multiple missing factors", () => {
    const graph = createV3Graph(
      [
        { id: "goal_1", kind: "goal", label: "Goal" },
        { id: "opt_1", kind: "option", label: "Option A" },
        { id: "fac_a", kind: "factor", label: "Factor A", category: "controllable" },
        { id: "fac_b", kind: "factor", label: "Factor B", category: "controllable" },
      ],
      [
        { from: "opt_1", to: "fac_a" },
        { from: "opt_1", to: "fac_b" },
        { from: "fac_a", to: "goal_1" },
        { from: "fac_b", to: "goal_1" },
      ]
    );

    const option = createV3Option("opt_1", "Option A", {}, "needs_user_mapping");

    const payload = buildAnalysisReadyPayload([option], "goal_1", graph);

    expect(payload.blockers).toBeDefined();
    expect(payload.blockers!.length).toBe(2);
    const factorIds = payload.blockers!.map((b) => b.factor_id);
    expect(factorIds).toContain("fac_a");
    expect(factorIds).toContain("fac_b");
  });

  it("payload with blockers validates against AnalysisReadyPayload schema", () => {
    const graph = createV3Graph(
      [
        { id: "goal_1", kind: "goal", label: "Goal" },
        { id: "opt_1", kind: "option", label: "Option A" },
        { id: "fac_x", kind: "factor", label: "Missing Factor", category: "controllable" },
      ],
      [
        { from: "opt_1", to: "fac_x" },
        { from: "fac_x", to: "goal_1" },
      ]
    );

    const option = createV3Option("opt_1", "Option A", {}, "needs_user_mapping");

    const payload = buildAnalysisReadyPayload([option], "goal_1", graph);

    const result = AnalysisReadyPayload.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe("needs_user_input");
      expect(result.data.blockers).toBeDefined();
    }
  });
});

// ============================================================================
// Task 2C: model_adjustments[] mapping
// ============================================================================

describe("Task 2C: model_adjustments mapping", () => {
  it("maps CATEGORY_OVERRIDE to category_reclassified", () => {
    const adjustments = mapMutationsToAdjustments([{
      code: "CATEGORY_OVERRIDE",
      node_id: "fac_1",
      field: "category",
      before: "external",
      after: "controllable",
      reason: "Has incoming edge from option node",
    }]);

    expect(adjustments).toHaveLength(1);
    expect(adjustments[0]).toMatchObject({
      code: "category_reclassified",
      node_id: "fac_1",
      field: "category",
      before: "external",
      after: "controllable",
    });
  });

  it("maps SIGN_CORRECTED to risk_coefficient_corrected", () => {
    const adjustments = mapMutationsToAdjustments([{
      code: "SIGN_CORRECTED",
      edge_id: "fac_1→goal_1",
      field: "strength_mean",
      before: 0.5,
      after: -0.5,
      reason: "Risk edge should have negative strength",
    }]);

    expect(adjustments).toHaveLength(1);
    expect(adjustments[0].code).toBe("risk_coefficient_corrected");
    expect(adjustments[0].edge_id).toBe("fac_1→goal_1");
  });

  it("maps CONTROLLABLE_DATA_FILLED to data_filled", () => {
    const adjustments = mapMutationsToAdjustments([{
      code: "CONTROLLABLE_DATA_FILLED",
      node_id: "fac_price",
      field: "data.value",
      before: undefined,
      after: 59,
      reason: "Filled from intervention value",
    }]);

    expect(adjustments).toHaveLength(1);
    expect(adjustments[0].code).toBe("data_filled");
  });

  it("maps ENUM_VALUE_CORRECTED to enum_corrected", () => {
    const adjustments = mapMutationsToAdjustments([{
      code: "ENUM_VALUE_CORRECTED",
      node_id: "fac_1",
      field: "category",
      before: "controlled",
      after: "controllable",
      reason: "Normalised to valid enum value",
    }]);

    expect(adjustments).toHaveLength(1);
    expect(adjustments[0].code).toBe("enum_corrected");
  });

  it("maps graph correction edge_added to connectivity_repaired", () => {
    const adjustments = mapMutationsToAdjustments([], [{
      type: "edge_added",
      target: { edge_id: "out_1->goal_1" },
      before: undefined,
      after: { from: "out_1", to: "goal_1" },
      reason: "Wired outcome to goal (missing edge)",
    }]);

    expect(adjustments).toHaveLength(1);
    expect(adjustments[0].code).toBe("connectivity_repaired");
    expect(adjustments[0].edge_id).toBe("out_1->goal_1");
  });

  it("ignores unmapped STRP codes", () => {
    const adjustments = mapMutationsToAdjustments([{
      code: "CONSTRAINT_REMAPPED",
      node_id: "cons_1",
      field: "node_id",
      before: "old_id",
      after: "new_id",
      reason: "Remapped to valid node",
    }]);

    expect(adjustments).toHaveLength(0);
  });

  it("ignores unmapped correction types", () => {
    const adjustments = mapMutationsToAdjustments([], [{
      type: "node_modified",
      target: { node_id: "fac_1" },
      reason: "Modified node kind",
    }]);

    expect(adjustments).toHaveLength(0);
  });

  it("returns empty array for empty inputs", () => {
    expect(mapMutationsToAdjustments()).toEqual([]);
    expect(mapMutationsToAdjustments([], [])).toEqual([]);
    expect(mapMutationsToAdjustments(undefined, undefined)).toEqual([]);
  });

  it("combines STRP mutations and corrections", () => {
    const adjustments = mapMutationsToAdjustments(
      [{
        code: "CATEGORY_OVERRIDE",
        node_id: "fac_1",
        field: "category",
        before: "external",
        after: "controllable",
        reason: "Override",
      }],
      [{
        type: "edge_added",
        target: { edge_id: "out_1->goal_1" },
        reason: "Wired to goal",
      }]
    );

    expect(adjustments).toHaveLength(2);
    expect(adjustments[0].code).toBe("category_reclassified");
    expect(adjustments[1].code).toBe("connectivity_repaired");
  });

  it("all adjustment codes validate against ModelAdjustmentCode", () => {
    const adjustments = mapMutationsToAdjustments(
      [
        { code: "CATEGORY_OVERRIDE", node_id: "n1", field: "category", before: "a", after: "b", reason: "r1" },
        { code: "SIGN_CORRECTED", edge_id: "e1", field: "strength_mean", before: 1, after: -1, reason: "r2" },
        { code: "CONTROLLABLE_DATA_FILLED", node_id: "n2", field: "data.value", before: undefined, after: 5, reason: "r3" },
        { code: "ENUM_VALUE_CORRECTED", node_id: "n3", field: "category", before: "x", after: "y", reason: "r4" },
      ],
      [
        { type: "edge_added", target: { edge_id: "e2" }, reason: "r5" },
      ]
    );

    for (const adj of adjustments) {
      const result = ModelAdjustment.safeParse(adj);
      expect(result.success).toBe(true);
    }
  });
});

// ============================================================================
// Task 2D: Schema validation for new fields
// ============================================================================

describe("Task 2D: Analysis-ready schema supports new Phase 2 fields", () => {
  it("AnalysisReadyPayload accepts needs_user_input status", () => {
    const result = AnalysisReadyPayload.safeParse({
      options: [],
      goal_node_id: "goal_1",
      status: "needs_user_input",
      blockers: [{
        factor_id: "fac_1",
        factor_label: "Price",
        blocker_type: "missing_value",
        message: "Needs a value",
        suggested_action: "add_value",
      }],
    });

    expect(result.success).toBe(true);
  });

  it("AnalysisReadyPayload accepts model_adjustments", () => {
    const result = AnalysisReadyPayload.safeParse({
      options: [],
      goal_node_id: "goal_1",
      status: "ready",
      model_adjustments: [{
        code: "category_reclassified",
        node_id: "fac_1",
        field: "category",
        before: "external",
        after: "controllable",
        reason: "Has option edge",
      }],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.model_adjustments).toHaveLength(1);
    }
  });

  it("AnalysisReadyPayload rejects invalid blocker_type", () => {
    const result = AnalysisReadyPayload.safeParse({
      options: [],
      goal_node_id: "goal_1",
      status: "needs_user_input",
      blockers: [{
        factor_id: "fac_1",
        factor_label: "Price",
        blocker_type: "invalid_type",
        message: "Needs a value",
        suggested_action: "add_value",
      }],
    });

    expect(result.success).toBe(false);
  });

  it("AnalysisReadyPayload rejects invalid model_adjustment code", () => {
    const result = AnalysisReadyPayload.safeParse({
      options: [],
      goal_node_id: "goal_1",
      status: "ready",
      model_adjustments: [{
        code: "invalid_code",
        field: "category",
        reason: "Test",
      }],
    });

    expect(result.success).toBe(false);
  });
});

// ============================================================================
// Validation: needs_user_input → blockers consistency
// ============================================================================

describe("Validation: needs_user_input requires blockers", () => {
  it("flags needs_user_input without blockers", () => {
    const graph = createV3Graph(
      [
        { id: "goal_1", kind: "goal", label: "Goal" },
        { id: "fac_1", kind: "factor", label: "Factor" },
      ],
      [{ from: "fac_1", to: "goal_1" }]
    );

    // Manually construct a payload with needs_user_input but no blockers
    const payload = {
      options: [{ id: "opt_1", label: "Option A", status: "needs_user_mapping" as const, interventions: {} }],
      goal_node_id: "goal_1",
      status: "needs_user_input" as const,
      // blockers intentionally omitted
    };

    const result = validateAnalysisReadyPayload(payload, graph);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "NEEDS_USER_INPUT_WITHOUT_BLOCKERS")).toBe(true);
  });

  it("passes when needs_user_input has blockers", () => {
    const graph = createV3Graph(
      [
        { id: "goal_1", kind: "goal", label: "Goal" },
        { id: "fac_1", kind: "factor", label: "Factor" },
      ],
      [{ from: "fac_1", to: "goal_1" }]
    );

    const payload = {
      options: [{ id: "opt_1", label: "Option A", status: "needs_user_mapping" as const, interventions: {} }],
      goal_node_id: "goal_1",
      status: "needs_user_input" as const,
      blockers: [{
        factor_id: "fac_1",
        factor_label: "Factor",
        blocker_type: "missing_value" as const,
        message: "Needs value",
        suggested_action: "add_value" as const,
      }],
    };

    const result = validateAnalysisReadyPayload(payload, graph);

    // Should not have the NEEDS_USER_INPUT_WITHOUT_BLOCKERS error
    expect(result.errors.some((e) => e.code === "NEEDS_USER_INPUT_WITHOUT_BLOCKERS")).toBe(false);
  });
});

// ============================================================================
// Goal threshold passthrough
// ============================================================================

describe("Goal threshold fields in analysis_ready", () => {
  /**
   * ⚠ THIS TEST WAS DELIBERATELY REVERSED — ROADMAP 2.315(a), and the reversal
   * is the point of the change, not a side effect. Read before "restoring" it.
   *
   * Commit b4cfbfd4 (19 Feb 2026, "remove display metadata fields from
   * analysis_ready payload") removed exactly these three fields, on two stated
   * premises:
   *
   *   1. "only goal_threshold (normalised 0-1) is needed by PLoT"
   *   2. "Display metadata stays on the goal node in the graph response for
   *      UI consumption"
   *
   * PREMISE 1 STILL HOLDS and is undisturbed: `analysis_ready` never reaches
   * the PLoT client (`src/orchestrator/plot-client.ts` contains zero
   * occurrences of `analysis_ready` or `goal_threshold`; the /v2/run request is
   * built from the graph, options and goal_node_id). Adding fields here cannot
   * change what ISL is asked.
   *
   * PREMISE 2 IS FALSE, and a user-visible defect is the proof. On the analyse
   * path the UI sends a turn and CEE reloads its OWN persisted graph — the UI
   * does not reliably hold the enriched goal node, so "the UI reads it from the
   * graph" does not hold when it matters. The observable consequence: a goal
   * target of £800,000 rendered on Inspector v2 as "Success means reaching
   * >= 0.8 count" — the normalised value with a placeholder unit, because the
   * raw value, unit and cap never left CEE. The UI's own store sync
   * (canvas/store.ts:3997-4012 at UI tip cb957c8c) reads all three FROM THIS
   * PAYLOAD, raw-first.
   *
   * So the trio is carried again — verbatim from the goal node's attested mint,
   * never re-derived. See tests/unit/analysis-ready-goal-threshold-raw-trio.test.ts
   * for the full four-hop guard and the carry-vs-recompute mutants.
   */
  it("carries goal_threshold AND the display trio on analysis_ready; goal node keeps all four", () => {
    const graph = createV3Graph(
      [
        { id: "goal_mid_market", kind: "goal", label: "Mid-market expansion" },
        { id: "dec_1", kind: "decision", label: "Decision" },
        { id: "opt_1", kind: "option", label: "Option A" },
        { id: "fac_1", kind: "factor", label: "Factor", category: "controllable" },
      ],
      [
        { from: "dec_1", to: "opt_1" },
        { from: "opt_1", to: "fac_1" },
        { from: "fac_1", to: "goal_mid_market" },
      ]
    );

    // Add all four threshold fields to goal node (preserved via .passthrough())
    const goalNode = graph.nodes.find((n) => n.id === "goal_mid_market")!;
    (goalNode as any).goal_threshold = 0.2;
    (goalNode as any).goal_threshold_raw = 200;
    (goalNode as any).goal_threshold_unit = "customers";
    (goalNode as any).goal_threshold_cap = 1000;

    const option = createV3Option("opt_1", "Option A", {
      fac_1: { value: 10, factorId: "fac_1" },
    });

    const payload = buildAnalysisReadyPayload([option], "goal_mid_market", graph);

    // analysis_ready: the normalised threshold PLoT needs, AND the display
    // trio the UI cannot otherwise obtain. Carried verbatim from the node.
    expect(payload.goal_threshold).toBe(0.2);
    expect(payload).toHaveProperty("goal_threshold_raw", 200);
    expect(payload).toHaveProperty("goal_threshold_unit", "customers");
    expect(payload).toHaveProperty("goal_threshold_cap", 1000);

    // Goal node in the graph is unchanged — still carries all four fields.
    // The payload now MIRRORS them; it does not move or consume them.
    const gn = graph.nodes.find((n) => n.id === "goal_mid_market")!;
    expect((gn as any).goal_threshold).toBe(0.2);
    expect((gn as any).goal_threshold_raw).toBe(200);
    expect((gn as any).goal_threshold_unit).toBe("customers");
    expect((gn as any).goal_threshold_cap).toBe(1000);
  });

  it("leaves goal_threshold undefined when goal node has none", () => {
    const graph = createV3Graph(
      [
        { id: "goal_1", kind: "goal", label: "Revenue growth" },
        { id: "dec_1", kind: "decision", label: "Decision" },
        { id: "opt_1", kind: "option", label: "Option A" },
        { id: "fac_1", kind: "factor", label: "Factor", category: "controllable" },
      ],
      [
        { from: "dec_1", to: "opt_1" },
        { from: "opt_1", to: "fac_1" },
        { from: "fac_1", to: "goal_1" },
      ]
    );

    const option = createV3Option("opt_1", "Option A", {
      fac_1: { value: 10, factorId: "fac_1" },
    });

    const payload = buildAnalysisReadyPayload([option], "goal_1", graph);

    expect(payload.goal_threshold).toBeUndefined();
    expect(payload).not.toHaveProperty("goal_threshold_raw");
    expect(payload).not.toHaveProperty("goal_threshold_unit");
    expect(payload).not.toHaveProperty("goal_threshold_cap");
  });
});
