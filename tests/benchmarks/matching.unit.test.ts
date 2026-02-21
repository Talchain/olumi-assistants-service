/**
 * Unit Tests for Node & Edge Matching Layer
 *
 * Validates matching logic with synthetic graph data.
 * These run as part of the benchmark suite, not the standard test suite.
 */

import { describe, it, expect } from "vitest";
import { normaliseLabel, matchNodes, matchEdges, matchRuns } from "./matching.js";
import type { NodeV3T, EdgeV3T } from "../../src/schemas/cee-v3.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function node(id: string, kind: string, label: string): NodeV3T {
  return { id, kind, label } as NodeV3T;
}

function edge(from: string, to: string, sm: number, ss: number, be: number): EdgeV3T {
  return {
    from,
    to,
    strength_mean: sm,
    strength_std: ss,
    belief_exists: be,
    effect_direction: sm >= 0 ? "positive" : "negative",
  } as EdgeV3T;
}

// ---------------------------------------------------------------------------
// normaliseLabel
// ---------------------------------------------------------------------------

describe("normaliseLabel", () => {
  it("lowercases and trims", () => {
    expect(normaliseLabel("  Revenue Growth ")).toBe("revenue_growth");
  });

  it("replaces spaces and hyphens with underscores", () => {
    expect(normaliseLabel("market-share increase")).toBe("market_share_increase");
  });

  it("collapses multiple underscores", () => {
    expect(normaliseLabel("cost   of   goods")).toBe("cost_of_goods");
  });
});

// ---------------------------------------------------------------------------
// matchNodes
// ---------------------------------------------------------------------------

describe("matchNodes", () => {
  it("matches identical node sets", () => {
    const run1 = {
      nodes: [node("g1", "goal", "Revenue"), node("f1", "factor", "Price")],
      edges: [edge("f1", "g1", 0.5, 0.1, 0.9)],
    };
    const run2 = {
      nodes: [node("g1", "goal", "Revenue"), node("f1", "factor", "Price")],
      edges: [edge("f1", "g1", 0.6, 0.12, 0.85)],
    };

    const { matched, unmatched } = matchNodes([run1, run2]);

    // Both nodes should be matched
    expect(matched.length).toBe(2);
    for (const mn of matched) {
      expect(mn.instances.size).toBe(2);
    }
    expect(unmatched.get(0)!.length).toBe(0);
    expect(unmatched.get(1)!.length).toBe(0);
  });

  it("matches nodes with different IDs but same kind+label", () => {
    const run1 = {
      nodes: [node("goal_1", "goal", "Revenue Growth"), node("factor_abc", "factor", "Market Share")],
      edges: [edge("factor_abc", "goal_1", 0.5, 0.1, 0.9)],
    };
    const run2 = {
      nodes: [node("g_rev", "goal", "Revenue Growth"), node("f_ms", "factor", "Market Share")],
      edges: [edge("f_ms", "g_rev", 0.6, 0.12, 0.85)],
    };

    const { matched } = matchNodes([run1, run2]);

    // Should still match by kind+label
    const goalMatch = matched.find((m) => m.key === "goal:revenue_growth");
    expect(goalMatch).toBeDefined();
    expect(goalMatch!.instances.size).toBe(2);
  });

  it("reports unmatched nodes when a node appears in only one run", () => {
    const run1 = {
      nodes: [node("g1", "goal", "Revenue"), node("f1", "factor", "Price"), node("r1", "risk", "Churn")],
      edges: [edge("f1", "g1", 0.5, 0.1, 0.9)],
    };
    const run2 = {
      nodes: [node("g1", "goal", "Revenue"), node("f1", "factor", "Price")],
      edges: [edge("f1", "g1", 0.6, 0.12, 0.85)],
    };

    const { unmatched } = matchNodes([run1, run2]);

    // run1 has "Churn" which run2 doesn't — but it still gets a MatchedNode entry
    // with only 1 instance, and it should appear in unmatched for run1
    // Actually: "Churn" appears only in run1, so run2 is the missing one
    // The unmatched list tracks nodes whose key is unique to one run
    expect(unmatched.get(0)!.some((n) => n.label === "Churn")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// matchEdges
// ---------------------------------------------------------------------------

describe("matchEdges", () => {
  it("matches edges by matched node keys", () => {
    const run1 = {
      nodes: [node("g1", "goal", "Revenue"), node("f1", "factor", "Price")],
      edges: [edge("f1", "g1", 0.5, 0.1, 0.9)],
    };
    const run2 = {
      nodes: [node("goal_a", "goal", "Revenue"), node("fac_b", "factor", "Price")],
      edges: [edge("fac_b", "goal_a", 0.7, 0.15, 0.88)],
    };

    const { matched: matchedNodes } = matchNodes([run1, run2]);
    const { alwaysPresent, intermittent } = matchEdges([run1, run2], matchedNodes);

    expect(alwaysPresent.length).toBe(1);
    expect(intermittent.length).toBe(0);
    expect(alwaysPresent[0]!.instances.size).toBe(2);
  });

  it("detects intermittent edges", () => {
    const run1 = {
      nodes: [node("g1", "goal", "Rev"), node("f1", "factor", "Price"), node("f2", "factor", "Demand")],
      edges: [edge("f1", "g1", 0.5, 0.1, 0.9), edge("f2", "g1", 0.3, 0.1, 0.7)],
    };
    const run2 = {
      nodes: [node("g1", "goal", "Rev"), node("f1", "factor", "Price"), node("f2", "factor", "Demand")],
      edges: [edge("f1", "g1", 0.6, 0.12, 0.85)], // f2→g1 is missing
    };

    const { matched: matchedNodes } = matchNodes([run1, run2]);
    const { alwaysPresent, intermittent } = matchEdges([run1, run2], matchedNodes);

    expect(alwaysPresent.length).toBe(1); // f1→g1
    expect(intermittent.length).toBe(1); // f2→g1 only in run1
    expect(intermittent[0]!.present_in_runs).toEqual([0]);
  });
});

// ---------------------------------------------------------------------------
// matchRuns (integration)
// ---------------------------------------------------------------------------

describe("matchRuns", () => {
  it("produces a complete MatchResult", () => {
    const runs = [
      {
        nodes: [node("g", "goal", "Rev"), node("f", "factor", "Price")],
        edges: [edge("f", "g", 0.5, 0.1, 0.9)],
      },
      {
        nodes: [node("g", "goal", "Rev"), node("f", "factor", "Price")],
        edges: [edge("f", "g", 0.6, 0.12, 0.88)],
      },
      {
        nodes: [node("g", "goal", "Rev"), node("f", "factor", "Price")],
        edges: [edge("f", "g", 0.55, 0.11, 0.87)],
      },
    ];

    const result = matchRuns(runs);

    expect(result.matched_nodes.length).toBe(2);
    expect(result.matched_edges.length).toBe(1);
    expect(result.always_present_edges.length).toBe(1);
    expect(result.intermittent_edges.length).toBe(0);
    expect(result.total_runs).toBe(3);
  });
});
