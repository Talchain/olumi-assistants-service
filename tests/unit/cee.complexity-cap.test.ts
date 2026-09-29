/**
 * Complexity cap — proportional edge pruning
 *
 * Tests applyComplexityCap() directly without running the full sweep.
 * Verifies:
 *   - 2-option graph with 20 edges is pruned to ≤15
 *   - Only weak (strength_mean < 0.1) non-structural edges are pruned
 *   - Structural edges (decision→option, option→factor/outcome/risk) are preserved
 *   - Graph already within cap is not touched
 */

import { describe, it, expect } from "vitest";
import { applyComplexityCap } from "../../src/cee/unified-pipeline/stages/repair/deterministic-sweep.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeEdge(id: string, from: string, to: string, strength_mean: number) {
  return { id, from, to, strength_mean, strength_std: 0.05, belief_exists: 0.9, effect_direction: "positive" as const };
}

/**
 * Build a 2-option graph with 20 edges.
 *
 * Structural (exempt from pruning):
 *   dec→opt_a, dec→opt_b (2)
 *   opt_a→fac_cost, opt_a→fac_time (2)
 *   opt_b→fac_cost, opt_b→fac_time (2)
 * Non-structural strong (strength_mean ≥ 0.1):
 *   fac_cost→out_a 0.7, fac_time→out_a 0.6, out_a→goal 0.8, fac_risk→goal 0.5 (4)
 * Non-structural weak (strength_mean < 0.1 — candidates for pruning):
 *   10 edges with strength_mean = 0.05
 *
 * Total: 6 structural + 4 strong + 10 weak = 20 edges
 * After pruning to cap 15: removes 5 weak edges → 15 edges remaining
 */
function makeDenseGraph() {
  const nodes = [
    { id: "dec", kind: "decision", label: "Decision" },
    { id: "opt_a", kind: "option", label: "Option A" },
    { id: "opt_b", kind: "option", label: "Option B" },
    { id: "fac_cost", kind: "factor", label: "Cost", category: "controllable" },
    { id: "fac_time", kind: "factor", label: "Time", category: "controllable" },
    { id: "fac_risk", kind: "factor", label: "Risk", category: "observable" },
    { id: "out_a", kind: "outcome", label: "Revenue" },
    { id: "goal", kind: "goal", label: "Maximise Revenue" },
    // Extra observable factors for weak edges
    ...Array.from({ length: 10 }, (_, i) => ({ id: `obs_${i}`, kind: "factor", label: `Obs ${i}`, category: "observable" })),
  ];

  const edges = [
    // Structural (6)
    makeEdge("e_dec_a", "dec", "opt_a", 1),
    makeEdge("e_dec_b", "dec", "opt_b", 1),
    makeEdge("e_a_cost", "opt_a", "fac_cost", 1),
    makeEdge("e_a_time", "opt_a", "fac_time", 1),
    makeEdge("e_b_cost", "opt_b", "fac_cost", 1),
    makeEdge("e_b_time", "opt_b", "fac_time", 1),
    // Non-structural strong (4)
    makeEdge("e_cost_out", "fac_cost", "out_a", 0.7),
    makeEdge("e_time_out", "fac_time", "out_a", 0.6),
    makeEdge("e_out_goal", "out_a", "goal", 0.8),
    makeEdge("e_risk_goal", "fac_risk", "goal", 0.5),
    // Non-structural weak (10)
    ...Array.from({ length: 10 }, (_, i) =>
      makeEdge(`e_weak_${i}`, `obs_${i}`, "out_a", 0.05)
    ),
  ];

  return { version: "1", default_seed: 42, nodes, edges };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("applyComplexityCap", () => {
  it("prunes a 2-option graph with 20 edges to ≤15 edges", () => {
    const graph = makeDenseGraph() as any;
    expect(graph.edges.length).toBe(20);

    const { repairs, prunedCount } = applyComplexityCap(graph);

    expect(graph.edges.length).toBeLessThanOrEqual(15);
    expect(prunedCount).toBe(5);
    expect(repairs.length).toBe(5);
    expect(repairs.every((r) => r.code === "COMPLEXITY_CAP_PRUNE")).toBe(true);
  });

  it("preserves all structural edges (decision→option, option→factor)", () => {
    const graph = makeDenseGraph() as any;
    applyComplexityCap(graph);

    const remainingIds = new Set(graph.edges.map((e: any) => e.id));
    // All 6 structural edges must survive
    expect(remainingIds.has("e_dec_a")).toBe(true);
    expect(remainingIds.has("e_dec_b")).toBe(true);
    expect(remainingIds.has("e_a_cost")).toBe(true);
    expect(remainingIds.has("e_a_time")).toBe(true);
    expect(remainingIds.has("e_b_cost")).toBe(true);
    expect(remainingIds.has("e_b_time")).toBe(true);
  });

  it("preserves strong non-structural edges (strength_mean ≥ 0.1)", () => {
    const graph = makeDenseGraph() as any;
    applyComplexityCap(graph);

    const remainingIds = new Set(graph.edges.map((e: any) => e.id));
    expect(remainingIds.has("e_cost_out")).toBe(true);
    expect(remainingIds.has("e_time_out")).toBe(true);
    expect(remainingIds.has("e_out_goal")).toBe(true);
    expect(remainingIds.has("e_risk_goal")).toBe(true);
  });

  it("does not prune a graph already within cap", () => {
    const graph = makeDenseGraph() as any;
    // Remove all weak edges first
    graph.edges = graph.edges.filter((e: any) => e.strength_mean >= 0.1);
    expect(graph.edges.length).toBe(10);

    const { prunedCount, repairs } = applyComplexityCap(graph);

    expect(prunedCount).toBe(0);
    expect(repairs.length).toBe(0);
    expect(graph.edges.length).toBe(10);
  });

  it("does not prune more edges than necessary to reach cap", () => {
    const graph = makeDenseGraph() as any;
    applyComplexityCap(graph);
    // Exactly 15 after pruning 5 from 20
    expect(graph.edges.length).toBe(15);
  });

  it("returns prunedCount=0 for graph with no option nodes", () => {
    const graph = {
      version: "1",
      nodes: [{ id: "goal", kind: "goal", label: "Goal" }],
      edges: [],
    } as any;
    const { prunedCount } = applyComplexityCap(graph);
    expect(prunedCount).toBe(0);
  });
});
