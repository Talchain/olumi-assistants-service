import { describe, it, expect } from "vitest";
import { transformEdgeToV3, transformGraphToV3, type TransformDefaultRecord } from "../../src/cee/transforms/schema-v3.js";
import { detectStrengthDefaults } from "../../src/cee/validation/integrity-sentinel.js";
import {
  DEFAULT_STRENGTH_MEAN,
  DEFAULT_STRENGTH_STD,
  NAN_FIX_SIGNATURE_STD,
} from "../../src/cee/constants.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEdge(overrides: Record<string, unknown> = {}) {
  return {
    from: "factor_a",
    to: "goal",
    ...overrides,
  };
}

function makeNodes() {
  return [
    { id: "factor_a", kind: "factor", label: "A" },
    { id: "goal", kind: "goal", label: "Goal" },
  ];
}

// ---------------------------------------------------------------------------
// Task 5: transform_defaults trace shape
// ---------------------------------------------------------------------------

describe("Wave 1 — Task 5: transformEdgeToV3 default tracking", () => {
  it("records strength_mean default when both strength_mean and weight are missing", () => {
    const { edge, defaults } = transformEdgeToV3(
      makeEdge() as any,
      0,
      makeNodes() as any[],
    );
    const meanDefault = defaults.find((d) => d.field === "strength_mean");
    expect(meanDefault).toBeDefined();
    expect(meanDefault!.default_value).toBe(DEFAULT_STRENGTH_MEAN);
    expect(meanDefault!.reason).toBe("no LLM value");
    expect(edge.strength.mean).toBe(DEFAULT_STRENGTH_MEAN);
  });

  it("does NOT record strength_mean default when strength_mean is present", () => {
    const { defaults } = transformEdgeToV3(
      makeEdge({ strength_mean: 0.7 }) as any,
      0,
      makeNodes() as any[],
    );
    const meanDefault = defaults.find((d) => d.field === "strength_mean");
    expect(meanDefault).toBeUndefined();
  });

  it("records exists_probability default for causal edge", () => {
    const { defaults } = transformEdgeToV3(
      makeEdge() as any,
      0,
      makeNodes() as any[],
    );
    const existsDefault = defaults.find((d) => d.field === "exists_probability");
    expect(existsDefault).toBeDefined();
    expect(existsDefault!.default_value).toBe(0.8);
    expect(existsDefault!.reason).toBe("causal edge default");
  });

  it("records strength_std default when strength_std is missing", () => {
    const { defaults } = transformEdgeToV3(
      makeEdge() as any,
      0,
      makeNodes() as any[],
    );
    const stdDefault = defaults.find((d) => d.field === "strength_std");
    expect(stdDefault).toBeDefined();
    expect(stdDefault!.reason).toBe("derived from mean/belief");
  });

  it("returns empty defaults array when all fields are present", () => {
    const { defaults } = transformEdgeToV3(
      makeEdge({
        strength_mean: 0.7,
        strength_std: 0.2,
        belief_exists: 0.9,
      }) as any,
      0,
      makeNodes() as any[],
    );
    expect(defaults).toHaveLength(0);
  });

  it("edge_id format is from->to", () => {
    const { defaults } = transformEdgeToV3(
      makeEdge() as any,
      0,
      makeNodes() as any[],
    );
    for (const d of defaults) {
      expect(d.edge_id).toBe("factor_a->goal");
    }
  });
});

// ---------------------------------------------------------------------------
// Task 2 + P1-1: NaN-fix detector + source classification
// ---------------------------------------------------------------------------

describe("Wave 1 — Task 2: NaN-fix detector widened + source classification", () => {
  // STRENGTH_DEFAULT_MIN_EDGES = 3, so we need at least 3 causal edges
  function makeV3Edge(from: string, to: string, mean: number, std: number) {
    return {
      from,
      to,
      strength: { mean, std },
      exists_probability: 0.8,
      effect_direction: "positive",
    };
  }

  const baseNodes = [
    { id: "factor_a", kind: "factor" },
    { id: "factor_b", kind: "factor" },
    { id: "factor_c", kind: "factor" },
    { id: "goal", kind: "goal" },
  ];

  it("detects V3 transform default signature (mean=0.5, std=0.125)", () => {
    const edges = [
      makeV3Edge("factor_a", "goal", 0.5, DEFAULT_STRENGTH_STD),
      makeV3Edge("factor_b", "goal", 0.5, DEFAULT_STRENGTH_STD),
      makeV3Edge("factor_c", "goal", 0.5, DEFAULT_STRENGTH_STD),
    ];
    const result = detectStrengthDefaults(baseNodes, edges);
    expect(result.detected).toBe(true);
    expect(result.defaulted_count).toBe(3);
    expect(result.defaulted_by_source.v3_transform).toBe(3);
    expect(result.defaulted_by_source.nan_fix).toBe(0);
  });

  it("detects NaN-fix default signature (mean=0.5, std=0.1)", () => {
    const edges = [
      makeV3Edge("factor_a", "goal", 0.5, NAN_FIX_SIGNATURE_STD),
      makeV3Edge("factor_b", "goal", 0.5, NAN_FIX_SIGNATURE_STD),
      makeV3Edge("factor_c", "goal", 0.5, NAN_FIX_SIGNATURE_STD),
    ];
    const result = detectStrengthDefaults(baseNodes, edges);
    expect(result.detected).toBe(true);
    expect(result.defaulted_count).toBe(3);
    expect(result.defaulted_by_source.nan_fix).toBe(3);
    expect(result.defaulted_by_source.v3_transform).toBe(0);
  });

  it("classifies mixed defaults correctly", () => {
    const edges = [
      makeV3Edge("factor_a", "goal", 0.5, DEFAULT_STRENGTH_STD),   // V3 transform
      makeV3Edge("factor_b", "goal", 0.5, NAN_FIX_SIGNATURE_STD),  // NaN-fix
      makeV3Edge("factor_c", "goal", 0.5, DEFAULT_STRENGTH_STD),   // V3 transform
    ];
    const result = detectStrengthDefaults(baseNodes, edges);
    expect(result.defaulted_count).toBe(3);
    expect(result.defaulted_by_source.v3_transform).toBe(2);
    expect(result.defaulted_by_source.nan_fix).toBe(1);
  });

  it("does NOT flag non-default edges (mean=0.5 but std=0.2)", () => {
    const edges = [
      makeV3Edge("factor_a", "goal", 0.5, 0.2),
      makeV3Edge("factor_b", "goal", 0.5, 0.2),
      makeV3Edge("factor_c", "goal", 0.5, 0.2),
    ];
    const result = detectStrengthDefaults(baseNodes, edges);
    expect(result.defaulted_count).toBe(0);
    expect(result.defaulted_by_source.v3_transform).toBe(0);
    expect(result.defaulted_by_source.nan_fix).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// P1-2: NAN_FIX_SIGNATURE_STD is a centralized constant
// ---------------------------------------------------------------------------

describe("Wave 1 — P1-2: NAN_FIX_SIGNATURE_STD centralized constant", () => {
  it("is exported from cee/constants and equals 0.1", () => {
    expect(NAN_FIX_SIGNATURE_STD).toBe(0.1);
  });

  it("differs from DEFAULT_STRENGTH_STD (the V3 transform default)", () => {
    expect(NAN_FIX_SIGNATURE_STD).not.toBe(DEFAULT_STRENGTH_STD);
  });
});

// ---------------------------------------------------------------------------
// Task 7: constraint → risk mapping
// ---------------------------------------------------------------------------

describe("Wave 1 — Task 7: constraint kind maps to risk", () => {
  it("maps kind='constraint' to kind='risk' in V3 transform", () => {
    const v1Graph = {
      nodes: [
        { id: "decision_1", kind: "decision", label: "Decision" },
        { id: "constraint_1", kind: "constraint", label: "Budget limit" },
        { id: "goal_1", kind: "goal", label: "Goal" },
      ],
      edges: [
        { from: "constraint_1", to: "goal_1", strength_mean: 0.6, strength_std: 0.15, belief_exists: 0.9 },
      ],
    };
    const { graph } = transformGraphToV3(v1Graph as any);
    const constraintNode = graph.nodes.find((n) => n.id === "constraint_1");
    expect(constraintNode).toBeDefined();
    expect(constraintNode!.kind).toBe("risk");
  });

  it("does NOT map kind='constraint' to kind='factor'", () => {
    const v1Graph = {
      nodes: [
        { id: "c1", kind: "constraint", label: "Constraint" },
        { id: "g1", kind: "goal", label: "Goal" },
      ],
      edges: [],
    };
    const { graph } = transformGraphToV3(v1Graph as any);
    const node = graph.nodes.find((n) => n.id === "c1");
    expect(node!.kind).not.toBe("factor");
  });
});
