import { describe, it, expect } from "vitest";
import {
  detectValueMissingFactors,
  buildGapGuidanceItems,
  buildGapCoachingText,
  GAP_COACHING_FINGERPRINT,
} from "../../../../src/orchestrator/tools/gap-detection.js";
import type { GraphV3T } from "../../../../src/schemas/cee-v3.js";
import { SIGNAL_CODES } from "../../../../src/orchestrator/types/guidance-item.js";

// ============================================================================
// Helpers
// ============================================================================

function makeGraph(
  nodes: Array<Record<string, unknown>>,
  edges: Array<Record<string, unknown>> = [],
): GraphV3T {
  return { nodes, edges } as unknown as GraphV3T;
}

function makeFactorNode(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "fac_churn",
    kind: "factor",
    label: "Customer Churn",
    ...overrides,
  };
}

// ============================================================================
// detectValueMissingFactors
// ============================================================================

describe("detectValueMissingFactors", () => {
  it("returns empty for null graph", () => {
    expect(detectValueMissingFactors(null)).toEqual([]);
  });

  it("returns empty for undefined graph", () => {
    expect(detectValueMissingFactors(undefined)).toEqual([]);
  });

  it("returns empty for graph with no nodes", () => {
    expect(detectValueMissingFactors(makeGraph([]))).toEqual([]);
  });

  it("returns empty when all factors have observed_state", () => {
    const graph = makeGraph([
      makeFactorNode({ observed_state: { value: 0.5 } }),
    ]);
    expect(detectValueMissingFactors(graph)).toEqual([]);
  });

  it("detects root factor without observed_state", () => {
    const graph = makeGraph([
      makeFactorNode({ id: "fac_ext", label: "External Factor" }),
    ]);
    const gaps = detectValueMissingFactors(graph);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].node_id).toBe("fac_ext");
    expect(gaps[0].label).toBe("External Factor");
    expect(gaps[0].kind).toBe("factor");
  });

  it("detects external-category factor without observed_state", () => {
    const graph = makeGraph(
      [makeFactorNode({ id: "fac_ext", label: "Market Growth", category: "external" })],
      // Has incoming edge — would NOT be root, but is external
      [{ from: "fac_other", to: "fac_ext", strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: "positive" }],
    );
    const gaps = detectValueMissingFactors(graph);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].node_id).toBe("fac_ext");
    expect(gaps[0].category).toBe("external");
  });

  it("does NOT detect non-root factor with incoming directed edge", () => {
    const graph = makeGraph(
      [makeFactorNode({ id: "fac_mid", label: "Mid Factor", category: "controllable" })],
      [{ from: "opt_a", to: "fac_mid", strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0, effect_direction: "positive" }],
    );
    expect(detectValueMissingFactors(graph)).toEqual([]);
  });

  it("detects root outcome node without observed_state", () => {
    const graph = makeGraph([
      { id: "out_revenue", kind: "outcome", label: "Revenue" },
    ]);
    const gaps = detectValueMissingFactors(graph);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].kind).toBe("outcome");
  });

  it("detects root risk node without observed_state", () => {
    const graph = makeGraph([
      { id: "risk_reg", kind: "risk", label: "Regulatory Risk" },
    ]);
    const gaps = detectValueMissingFactors(graph);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].kind).toBe("risk");
  });

  it("does NOT detect goal node without observed_state", () => {
    const graph = makeGraph([
      { id: "goal_1", kind: "goal", label: "Maximise Revenue" },
    ]);
    expect(detectValueMissingFactors(graph)).toEqual([]);
  });

  it("does NOT detect option node without observed_state", () => {
    const graph = makeGraph([
      { id: "opt_a", kind: "option", label: "Option A" },
    ]);
    expect(detectValueMissingFactors(graph)).toEqual([]);
  });

  it("does NOT detect decision node without observed_state", () => {
    const graph = makeGraph([
      { id: "dec_1", kind: "decision", label: "Market Entry" },
    ]);
    expect(detectValueMissingFactors(graph)).toEqual([]);
  });

  it("detects factor with only bidirected incoming edge (still root for directed)", () => {
    const graph = makeGraph(
      [makeFactorNode({ id: "fac_bi", label: "Bidirected Factor" })],
      [{ from: "fac_other", to: "fac_bi", edge_type: "bidirected", strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.8, effect_direction: "positive" }],
    );
    const gaps = detectValueMissingFactors(graph);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].node_id).toBe("fac_bi");
  });

  it("does NOT detect factor with well-formed prior (range_min + range_max)", () => {
    const graph = makeGraph([
      makeFactorNode({
        id: "fac_prior",
        label: "Factor With Prior",
        prior: { distribution: "uniform", range_min: 0.0, range_max: 1.0 },
      }),
    ]);
    expect(detectValueMissingFactors(graph)).toEqual([]);
  });

  it("detects factor with incomplete prior (missing range_max)", () => {
    const graph = makeGraph([
      makeFactorNode({
        id: "fac_bad_prior",
        label: "Bad Prior Factor",
        prior: { distribution: "uniform", range_min: 0.0 },
      }),
    ]);
    const gaps = detectValueMissingFactors(graph);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].node_id).toBe("fac_bad_prior");
  });

  it("detects factor with prior but no range fields", () => {
    const graph = makeGraph([
      makeFactorNode({
        id: "fac_empty_prior",
        label: "Empty Prior Factor",
        prior: { distribution: "uniform" },
      }),
    ]);
    const gaps = detectValueMissingFactors(graph);
    expect(gaps).toHaveLength(1);
  });

  it("detects multiple gaps in a realistic graph", () => {
    const graph = makeGraph(
      [
        { id: "dec_1", kind: "decision", label: "Market Entry" },
        { id: "opt_a", kind: "option", label: "Expand" },
        { id: "opt_b", kind: "option", label: "Stay" },
        makeFactorNode({ id: "fac_ctrl", label: "Team Size", category: "controllable" }),
        makeFactorNode({ id: "fac_ext1", label: "Market Growth", category: "external" }),
        makeFactorNode({ id: "fac_ext2", label: "Competitor Response", category: "external" }),
        makeFactorNode({ id: "fac_obs", label: "Current Revenue", category: "observable", observed_state: { value: 0.7 } }),
        { id: "goal_1", kind: "goal", label: "Maximise NRR" },
      ],
      [
        { from: "dec_1", to: "opt_a" },
        { from: "dec_1", to: "opt_b" },
        { from: "opt_a", to: "fac_ctrl" },
        { from: "opt_b", to: "fac_ctrl" },
        { from: "fac_ctrl", to: "goal_1" },
        { from: "fac_ext1", to: "goal_1" },
        { from: "fac_ext2", to: "goal_1" },
        { from: "fac_obs", to: "goal_1" },
      ],
    );
    const gaps = detectValueMissingFactors(graph);
    // fac_ext1 and fac_ext2 are external with no observed_state/prior
    // fac_ctrl has incoming directed edge from options → not detected
    // fac_obs has observed_state → not detected
    expect(gaps).toHaveLength(2);
    expect(gaps.map(g => g.node_id).sort()).toEqual(["fac_ext1", "fac_ext2"]);
  });
});

// ============================================================================
// buildGapGuidanceItems
// ============================================================================

describe("buildGapGuidanceItems", () => {
  it("returns empty for no gaps", () => {
    expect(buildGapGuidanceItems([])).toEqual([]);
  });

  it("returns one factor item + one run-anyway item for single gap", () => {
    const gaps = [{ node_id: "fac_x", label: "Factor X", kind: "factor", category: "external" as string | undefined }];
    const items = buildGapGuidanceItems(gaps);
    expect(items).toHaveLength(2);

    // Factor item
    expect(items[0].signal_code).toBe(SIGNAL_CODES.MISSING_OBSERVED_VALUE);
    expect(items[0].category).toBe("should_fix");
    expect(items[0].priority).toBe(65);
    expect(items[0].target_object?.id).toBe("fac_x");
    expect(items[0].primary_action.type).toBe("navigate");

    // Run anyway item
    expect(items[1].signal_code).toBe(SIGNAL_CODES.MISSING_OBSERVED_VALUE);
    expect(items[1].category).toBe("could_fix");
    expect(items[1].priority).toBe(30);
    expect(items[1].title).toBe("Run analysis with defaults");
    expect(items[1].primary_action.type).toBe("navigate");
  });

  it("caps factor items at 10 plus run-anyway", () => {
    const gaps = Array.from({ length: 15 }, (_, i) => ({
      node_id: `fac_${i}`,
      label: `Factor ${i}`,
      kind: "factor",
      category: "external" as string | undefined,
    }));
    const items = buildGapGuidanceItems(gaps);
    // 10 factor items + 1 run-anyway = 11
    expect(items).toHaveLength(11);
    // Last item is always run-anyway
    expect(items[10].title).toBe("Run analysis with defaults");
  });

  it("includes all signal codes as MISSING_OBSERVED_VALUE", () => {
    const gaps = [
      { node_id: "fac_a", label: "A", kind: "factor", category: undefined },
      { node_id: "fac_b", label: "B", kind: "factor", category: undefined },
    ];
    const items = buildGapGuidanceItems(gaps);
    for (const item of items) {
      expect(item.signal_code).toBe(SIGNAL_CODES.MISSING_OBSERVED_VALUE);
    }
  });
});

// ============================================================================
// buildGapCoachingText
// ============================================================================

describe("buildGapCoachingText", () => {
  it("returns empty string for no gaps", () => {
    expect(buildGapCoachingText([])).toBe("");
  });

  it("uses singular phrasing for one gap", () => {
    const gaps = [{ node_id: "fac_x", label: "Churn Rate", kind: "factor", category: "external" as string | undefined }];
    const text = buildGapCoachingText(gaps);
    expect(text).toContain("**Churn Rate**");
    expect(text).toContain("has no value set");
    expect(text).not.toContain("factors have no values set");
  });

  it("uses plural phrasing for multiple gaps", () => {
    const gaps = [
      { node_id: "fac_a", label: "Factor A", kind: "factor", category: undefined },
      { node_id: "fac_b", label: "Factor B", kind: "factor", category: undefined },
      { node_id: "fac_c", label: "Factor C", kind: "factor", category: undefined },
    ];
    const text = buildGapCoachingText(gaps);
    expect(text).toContain("3 factors have no values set");
    expect(text).toContain("**Factor A**");
    expect(text).toContain("**Factor B**");
    expect(text).toContain("**Factor C**");
  });

  it("always contains the gap coaching fingerprint", () => {
    const gaps = [{ node_id: "fac_x", label: "X", kind: "factor", category: undefined }];
    const text = buildGapCoachingText(gaps);
    expect(text).toContain(GAP_COACHING_FINGERPRINT);
  });

  it("includes brief anchor when label matches brief text", () => {
    const gaps = [{ node_id: "fac_churn", label: "Churn Rate", kind: "factor", category: "external" as string | undefined }];
    const briefText = "Our current churn rate is 3.2% per month and we need to reduce it.";
    const text = buildGapCoachingText(gaps, briefText);
    expect(text).toContain("3.2%");
    expect(text).toContain("brief");
  });

  it("does not include brief anchor when label does not match", () => {
    const gaps = [{ node_id: "fac_x", label: "Competitor Response", kind: "factor", category: undefined }];
    const briefText = "We are considering expanding into the US market with a budget of £500k.";
    const text = buildGapCoachingText(gaps, briefText);
    expect(text).not.toContain("brief");
  });

  it("includes brief anchors per factor in multi-gap mode", () => {
    const gaps = [
      { node_id: "fac_churn", label: "Monthly Churn", kind: "factor", category: "external" as string | undefined },
      { node_id: "fac_cost", label: "Acquisition Cost", kind: "factor", category: "external" as string | undefined },
      { node_id: "fac_growth", label: "Market Growth", kind: "factor", category: undefined },
    ];
    const briefText = "Monthly churn is around 4.5% and customer acquisition cost is £120 per user.";
    const text = buildGapCoachingText(gaps, briefText);
    // Should anchor churn and cost but not growth
    expect(text).toContain("4.5%");
    expect(text).toContain("120");
  });

  it("handles null briefText gracefully", () => {
    const gaps = [{ node_id: "fac_x", label: "X", kind: "factor", category: undefined }];
    const text = buildGapCoachingText(gaps, null);
    expect(text).toContain("**X**");
    expect(text).toContain(GAP_COACHING_FINGERPRINT);
  });
});
