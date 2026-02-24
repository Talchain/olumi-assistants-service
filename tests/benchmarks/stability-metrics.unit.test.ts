/**
 * Unit Tests for Stability Metrics
 *
 * Validates CV computation, epsilon floor behavior, and per-brief metrics.
 */

import { describe, it, expect } from "vitest";
import { computeBriefStabilityMetrics } from "./stability-metrics.js";
import type { MatchResult, MatchedNode, MatchedEdge } from "./matching.js";
import type { EdgeV3T } from "../../src/schemas/cee-v3.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEdge(sm: number, ss: number, be: number): EdgeV3T {
  return {
    from: "f1",
    to: "g1",
    strength: { mean: sm, std: ss },
    exists_probability: be,
    effect_direction: sm >= 0 ? "positive" : "negative",
  } as EdgeV3T;
}

function makeAlwaysPresentEdge(
  key: string,
  instances: Array<[number, EdgeV3T]>,
  totalRuns: number,
): MatchedEdge {
  return {
    key,
    instances: new Map(instances),
    present_in_runs: instances.map(([i]) => i),
    total_runs: totalRuns,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("computeBriefStabilityMetrics", () => {
  it("computes 100% structural stability when all edges always present", () => {
    const matchResult: MatchResult = {
      matched_nodes: [],
      matched_edges: [
        makeAlwaysPresentEdge("f:p→g:r", [
          [0, makeEdge(0.5, 0.1, 0.9)],
          [1, makeEdge(0.6, 0.12, 0.85)],
          [2, makeEdge(0.55, 0.11, 0.88)],
        ], 3),
      ],
      unmatched_nodes_per_run: new Map(),
      intermittent_edges: [],
      total_runs: 3,
      always_present_edges: [
        makeAlwaysPresentEdge("f:p→g:r", [
          [0, makeEdge(0.5, 0.1, 0.9)],
          [1, makeEdge(0.6, 0.12, 0.85)],
          [2, makeEdge(0.55, 0.11, 0.88)],
        ], 3),
      ],
    };

    const metrics = computeBriefStabilityMetrics("test_001", matchResult);
    expect(metrics.structural_stability).toBe(1);
  });

  it("computes reduced structural stability with intermittent edges", () => {
    const alwaysEdge = makeAlwaysPresentEdge("f:p→g:r", [
      [0, makeEdge(0.5, 0.1, 0.9)],
      [1, makeEdge(0.6, 0.12, 0.85)],
    ], 2);

    const intermittentEdge: MatchedEdge = {
      key: "f:d→g:r",
      instances: new Map([[0, makeEdge(0.3, 0.1, 0.7)]]),
      present_in_runs: [0],
      total_runs: 2,
    };

    const matchResult: MatchResult = {
      matched_nodes: [],
      matched_edges: [alwaysEdge, intermittentEdge],
      unmatched_nodes_per_run: new Map(),
      intermittent_edges: [intermittentEdge],
      total_runs: 2,
      always_present_edges: [alwaysEdge],
    };

    const metrics = computeBriefStabilityMetrics("test_002", matchResult);
    expect(metrics.structural_stability).toBe(0.5); // 1/2 edges always present
    expect(metrics.intermittent.length).toBe(1);
    expect(metrics.intermittent[0]!.presence_rate).toBe(0.5);
  });

  it("uses epsilon floor for CV when mean is near zero", () => {
    const matchResult: MatchResult = {
      matched_nodes: [],
      matched_edges: [
        makeAlwaysPresentEdge("f:x→g:r", [
          [0, makeEdge(0.01, 0.1, 0.9)],
          [1, makeEdge(-0.01, 0.12, 0.85)],
          [2, makeEdge(0.02, 0.11, 0.88)],
        ], 3),
      ],
      unmatched_nodes_per_run: new Map(),
      intermittent_edges: [],
      total_runs: 3,
      always_present_edges: [
        makeAlwaysPresentEdge("f:x→g:r", [
          [0, makeEdge(0.01, 0.1, 0.9)],
          [1, makeEdge(-0.01, 0.12, 0.85)],
          [2, makeEdge(0.02, 0.11, 0.88)],
        ], 3),
      ],
    };

    const metrics = computeBriefStabilityMetrics("test_003", matchResult);
    const smStats = metrics.always_present[0]!.strength_mean;

    // Near-zero mean, so epsilon floor should be used
    expect(smStats.near_zero).toBe(true);
    // CV should be finite and reasonable (not exploding)
    expect(Number.isFinite(smStats.cv)).toBe(true);
    expect(smStats.cv).toBeLessThan(10); // With epsilon=0.05, even std=0.5 gives CV=10
  });

  it("detects high-CV edges", () => {
    // Create an edge with very high variance relative to mean
    const matchResult: MatchResult = {
      matched_nodes: [],
      matched_edges: [
        makeAlwaysPresentEdge("f:v→g:r", [
          [0, makeEdge(0.2, 0.1, 0.9)],
          [1, makeEdge(0.8, 0.12, 0.85)],
          [2, makeEdge(-0.3, 0.11, 0.88)],
          [3, makeEdge(0.1, 0.13, 0.82)],
          [4, makeEdge(0.9, 0.09, 0.91)],
        ], 5),
      ],
      unmatched_nodes_per_run: new Map(),
      intermittent_edges: [],
      total_runs: 5,
      always_present_edges: [
        makeAlwaysPresentEdge("f:v→g:r", [
          [0, makeEdge(0.2, 0.1, 0.9)],
          [1, makeEdge(0.8, 0.12, 0.85)],
          [2, makeEdge(-0.3, 0.11, 0.88)],
          [3, makeEdge(0.1, 0.13, 0.82)],
          [4, makeEdge(0.9, 0.09, 0.91)],
        ], 5),
      ],
    };

    const metrics = computeBriefStabilityMetrics("test_004", matchResult);

    // With mean ~0.34 and high std, CV should be > 0.5
    expect(metrics.high_cv_edges.length).toBeGreaterThan(0);
    expect(metrics.high_cv_edges[0]!.parameter).toBe("strength_mean");
  });
});
