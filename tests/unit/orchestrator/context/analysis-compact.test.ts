import { describe, it, expect } from "vitest";
import { compactAnalysis } from "../../../../src/orchestrator/context/analysis-compact.js";
import type { V2RunResponseEnvelope } from "../../../../src/orchestrator/types.js";

// ============================================================================
// Fixtures
// ============================================================================

function makeOption(overrides?: Record<string, unknown>) {
  return {
    option_id: "opt_a",
    option_label: "Option A",
    win_probability: 0.6,
    outcome_mean: 0.55,
    ...overrides,
  };
}

function makeResponse(overrides?: Partial<V2RunResponseEnvelope>): V2RunResponseEnvelope {
  return {
    meta: { seed_used: 42, n_samples: 1000, response_hash: "abc123" },
    results: [makeOption()],
    ...overrides,
  } as V2RunResponseEnvelope;
}

// ============================================================================
// Tests
// ============================================================================

describe("compactAnalysis", () => {
  it("returns null for null input", () => {
    expect(compactAnalysis(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(compactAnalysis(undefined)).toBeNull();
  });

  it("returns null when analysis_status is 'blocked'", () => {
    const response = makeResponse({ analysis_status: "blocked" } as Record<string, unknown>);
    expect(compactAnalysis(response)).toBeNull();
  });

  it("returns null when analysis_status is 'failed'", () => {
    const response = makeResponse({ analysis_status: "failed" } as Record<string, unknown>);
    expect(compactAnalysis(response)).toBeNull();
  });

  it("extracts winner as highest win_probability option", () => {
    const response = makeResponse({
      results: [
        makeOption({ option_id: "opt_a", option_label: "Option A", win_probability: 0.3 }),
        makeOption({ option_id: "opt_b", option_label: "Option B", win_probability: 0.7 }),
      ],
    });
    const summary = compactAnalysis(response);
    expect(summary).not.toBeNull();
    expect(summary!.winner.option_id).toBe("opt_b");
    expect(summary!.winner.option_label).toBe("Option B");
    expect(summary!.winner.win_probability).toBe(0.7);
  });

  it("tiebreaks winner by option_id lexicographic when win_probability tied", () => {
    const response = makeResponse({
      results: [
        makeOption({ option_id: "opt_z", option_label: "Option Z", win_probability: 0.5 }),
        makeOption({ option_id: "opt_a", option_label: "Option A", win_probability: 0.5 }),
        makeOption({ option_id: "opt_m", option_label: "Option M", win_probability: 0.5 }),
      ],
    });
    const summary = compactAnalysis(response);
    expect(summary!.winner.option_id).toBe("opt_a");
  });

  it("sorts options by win_probability descending in summary", () => {
    const response = makeResponse({
      results: [
        makeOption({ option_id: "opt_a", win_probability: 0.2 }),
        makeOption({ option_id: "opt_b", win_probability: 0.7 }),
        makeOption({ option_id: "opt_c", win_probability: 0.5 }),
      ],
    });
    const summary = compactAnalysis(response);
    const probs = summary!.options.map((o) => o.win_probability);
    expect(probs).toEqual([0.7, 0.5, 0.2]);
  });

  it("extracts top 5 drivers from factor_sensitivity across all options", () => {
    const results = [
      {
        ...makeOption({ option_id: "opt_a" }),
        factor_sensitivity: [
          { node_id: "factor_1", label: "Factor 1", sensitivity: 0.8 },
          { node_id: "factor_2", label: "Factor 2", sensitivity: -0.6 },
          { node_id: "factor_3", label: "Factor 3", sensitivity: 0.4 },
          { node_id: "factor_4", label: "Factor 4", sensitivity: -0.3 },
          { node_id: "factor_5", label: "Factor 5", sensitivity: 0.2 },
          { node_id: "factor_6", label: "Factor 6", sensitivity: 0.1 },
        ],
      },
    ];
    const response = makeResponse({ results });
    const summary = compactAnalysis(response);
    expect(summary!.top_drivers).toHaveLength(5);
    // Sorted by absolute sensitivity descending
    expect(summary!.top_drivers[0].factor_id).toBe("factor_1");
    expect(summary!.top_drivers[0].sensitivity).toBe(0.8);
    expect(summary!.top_drivers[1].factor_id).toBe("factor_2");
    expect(summary!.top_drivers[1].direction).toBe("negative");
  });

  it("deduplicates drivers across options (max absolute sensitivity wins)", () => {
    const results = [
      {
        ...makeOption({ option_id: "opt_a" }),
        factor_sensitivity: [
          { node_id: "factor_1", label: "Factor 1", sensitivity: 0.3 },
        ],
      },
      {
        ...makeOption({ option_id: "opt_b" }),
        factor_sensitivity: [
          { node_id: "factor_1", label: "Factor 1", sensitivity: 0.8 },
        ],
      },
    ];
    const response = makeResponse({ results });
    const summary = compactAnalysis(response);
    const drivers = summary!.top_drivers.filter((d) => d.factor_id === "factor_1");
    expect(drivers).toHaveLength(1);
    expect(drivers[0].sensitivity).toBe(0.8);
  });

  it("derives robustness_level from robustness_synthesis.overall_assessment", () => {
    const response = makeResponse({
      robustness_synthesis: { overall_assessment: "high" },
    } as Record<string, unknown>);
    const summary = compactAnalysis(response);
    expect(summary!.robustness_level).toBe("high");
  });

  it("falls back to robustness.overall_robustness on first option", () => {
    const results = [
      {
        ...makeOption(),
        robustness: { overall_robustness: "moderate" },
      },
    ];
    const response = makeResponse({ results });
    const summary = compactAnalysis(response);
    expect(summary!.robustness_level).toBe("moderate");
  });

  it("falls back to robustness.level at top level", () => {
    const response = makeResponse({
      robustness: { level: "low" },
    });
    const summary = compactAnalysis(response);
    expect(summary!.robustness_level).toBe("low");
  });

  it("returns 'unknown' robustness_level when nothing available", () => {
    const response = makeResponse();
    const summary = compactAnalysis(response);
    expect(summary!.robustness_level).toBe("unknown");
  });

  it("counts fragile edges deduplicated by edge_id", () => {
    const results = [
      {
        ...makeOption({ option_id: "opt_a" }),
        robustness: {
          fragile_edges: [
            { edge_id: "edge_1" },
            { edge_id: "edge_2" },
          ],
        },
      },
      {
        ...makeOption({ option_id: "opt_b" }),
        robustness: {
          fragile_edges: [
            { edge_id: "edge_1" },  // duplicate
            { edge_id: "edge_3" },
          ],
        },
      },
    ];
    const response = makeResponse({ results });
    const summary = compactAnalysis(response);
    expect(summary!.fragile_edge_count).toBe(3); // edge_1, edge_2, edge_3 (deduplicated)
  });

  it("detects constraint_tensions when joint < individual × 0.7", () => {
    const results = [
      {
        ...makeOption(),
        probability_of_joint_goal: 0.3,
        constraint_probabilities: [
          { constraint_id: "c1", probability: 0.9 },
          { constraint_id: "c2", probability: 0.8 },
        ],
      },
    ];
    // joint (0.3) < min(0.9, 0.8) × 0.7 = 0.56 → tension
    const response = makeResponse({ results });
    const summary = compactAnalysis(response);
    expect(summary!.constraint_tensions).toBeDefined();
    expect(summary!.constraint_tensions).toContain("c1");
    expect(summary!.constraint_tensions).toContain("c2");
  });

  it("returns no constraint_tensions when ratio is above threshold", () => {
    const results = [
      {
        ...makeOption(),
        probability_of_joint_goal: 0.75,
        constraint_probabilities: [
          { constraint_id: "c1", probability: 0.9 },
        ],
      },
    ];
    // joint (0.75) < min(0.9) × 0.7 = 0.63? No — 0.75 > 0.63
    const response = makeResponse({ results });
    const summary = compactAnalysis(response);
    expect(summary!.constraint_tensions).toBeUndefined();
  });

  it("is deterministic — same input → identical output", () => {
    const response = makeResponse({
      results: [
        makeOption({ option_id: "opt_a", win_probability: 0.6 }),
        makeOption({ option_id: "opt_b", win_probability: 0.4 }),
      ],
    });
    const s1 = JSON.stringify(compactAnalysis(response));
    const s2 = JSON.stringify(compactAnalysis(response));
    expect(s1).toBe(s2);
  });

  it("uses graph node labels when provided", () => {
    const results = [
      {
        ...makeOption(),
        factor_sensitivity: [
          { node_id: "n1", sensitivity: 0.9 },
        ],
      },
    ];
    const response = makeResponse({ results });
    const graphLabels = new Map([["n1", "Revenue Growth"]]);
    const summary = compactAnalysis(response, graphLabels);
    expect(summary!.top_drivers[0].factor_label).toBe("Revenue Growth");
  });
});
