/**
 * Forbidden Edge Removal Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fixRemainingForbiddenEdges } from "../../src/cee/unified-pipeline/stages/repair/deterministic-sweep.js";
import type { GraphT } from "../../src/schemas/graph.js";

function createTestGraph(partial: { nodes: GraphT["nodes"]; edges: GraphT["edges"] }): GraphT {
  return { version: "1", default_seed: 42, nodes: partial.nodes, edges: partial.edges, meta: { roots: [], leaves: [], suggested_positions: {}, source: "test" as const } };
}

vi.mock("../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe("fixRemainingForbiddenEdges", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("removes decision→outcome edge", () => {
    const graph = createTestGraph({
      nodes: [{ id: "dec_1", kind: "decision", label: "D" }, { id: "out_1", kind: "outcome", label: "O" }, { id: "goal_1", kind: "goal", label: "G" }],
      edges: [
        { from: "dec_1", to: "out_1", strength_mean: 0.5, strength_std: 0.1, belief_exists: 0.8, effect_direction: "positive" },
        { from: "out_1", to: "goal_1", strength_mean: 0.7, strength_std: 0.1, belief_exists: 0.9, effect_direction: "positive" },
      ],
    });
    const result = fixRemainingForbiddenEdges(graph, "test");
    expect(result.removedCount).toBe(1);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0].from).toBe("out_1");
  });

  it("removes decision→risk edge", () => {
    const graph = createTestGraph({
      nodes: [{ id: "dec_1", kind: "decision", label: "D" }, { id: "risk_1", kind: "risk", label: "R" }],
      edges: [{ from: "dec_1", to: "risk_1", strength_mean: -0.3, strength_std: 0.1, belief_exists: 0.7, effect_direction: "negative" }],
    });
    expect(fixRemainingForbiddenEdges(graph, "test").removedCount).toBe(1);
    expect(graph.edges).toHaveLength(0);
  });

  it("removes decision→factor edge", () => {
    const graph = createTestGraph({
      nodes: [{ id: "dec_1", kind: "decision", label: "D" }, { id: "fac_1", kind: "factor", label: "F" }],
      edges: [{ from: "dec_1", to: "fac_1", strength_mean: 0.5, strength_std: 0.1, belief_exists: 0.8, effect_direction: "positive" }],
    });
    expect(fixRemainingForbiddenEdges(graph, "test").removedCount).toBe(1);
  });

  it("removes outcome→outcome edge", () => {
    const graph = createTestGraph({
      nodes: [{ id: "out_1", kind: "outcome", label: "O1" }, { id: "out_2", kind: "outcome", label: "O2" }],
      edges: [{ from: "out_1", to: "out_2", strength_mean: 0.5, strength_std: 0.1, belief_exists: 0.8, effect_direction: "positive" }],
    });
    expect(fixRemainingForbiddenEdges(graph, "test").removedCount).toBe(1);
  });

  it("removes risk→risk edge", () => {
    const graph = createTestGraph({
      nodes: [{ id: "risk_1", kind: "risk", label: "R1" }, { id: "risk_2", kind: "risk", label: "R2" }],
      edges: [{ from: "risk_1", to: "risk_2", strength_mean: 0.3, strength_std: 0.1, belief_exists: 0.7, effect_direction: "positive" }],
    });
    expect(fixRemainingForbiddenEdges(graph, "test").removedCount).toBe(1);
  });

  it("preserves valid edges alongside forbidden ones", () => {
    const graph = createTestGraph({
      nodes: [
        { id: "dec_1", kind: "decision", label: "D" }, { id: "opt_a", kind: "option", label: "A" },
        { id: "fac_1", kind: "factor", label: "F" }, { id: "out_1", kind: "outcome", label: "O1" },
        { id: "out_2", kind: "outcome", label: "O2" }, { id: "goal_1", kind: "goal", label: "G" },
      ],
      edges: [
        { from: "dec_1", to: "opt_a", strength_mean: 1.0, strength_std: 0.01, belief_exists: 1.0, effect_direction: "positive" },
        { from: "opt_a", to: "fac_1", strength_mean: 1.0, strength_std: 0.01, belief_exists: 1.0, effect_direction: "positive" },
        { from: "fac_1", to: "out_1", strength_mean: 0.7, strength_std: 0.1, belief_exists: 0.9, effect_direction: "positive" },
        { from: "out_1", to: "goal_1", strength_mean: 0.5, strength_std: 0.1, belief_exists: 0.9, effect_direction: "positive" },
        { from: "out_1", to: "out_2", strength_mean: 0.3, strength_std: 0.1, belief_exists: 0.5, effect_direction: "positive" },
        { from: "dec_1", to: "out_2", strength_mean: 0.4, strength_std: 0.1, belief_exists: 0.6, effect_direction: "positive" },
      ],
    });
    const result = fixRemainingForbiddenEdges(graph, "test");
    expect(result.removedCount).toBe(2);
    expect(graph.edges).toHaveLength(4);
  });

  it("logs reachability warning when removal disconnects target", async () => {
    const { log } = await import("../../src/utils/telemetry.js");
    const graph = createTestGraph({
      nodes: [{ id: "dec_1", kind: "decision", label: "D" }, { id: "out_1", kind: "outcome", label: "O" }],
      edges: [{ from: "dec_1", to: "out_1", strength_mean: 0.5, strength_std: 0.1, belief_exists: 0.8, effect_direction: "positive" }],
    });
    fixRemainingForbiddenEdges(graph, "test");
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "cee.deterministic_sweep.forbidden_edge_disconnected_target", target_id: "out_1" }),
      expect.any(String),
    );
  });

  it("returns no repairs when all edges are valid", () => {
    const graph = createTestGraph({
      nodes: [
        { id: "dec_1", kind: "decision", label: "D" }, { id: "opt_a", kind: "option", label: "A" },
        { id: "fac_1", kind: "factor", label: "F" }, { id: "out_1", kind: "outcome", label: "O" },
        { id: "goal_1", kind: "goal", label: "G" },
      ],
      edges: [
        { from: "dec_1", to: "opt_a", strength_mean: 1.0, strength_std: 0.01, belief_exists: 1.0, effect_direction: "positive" },
        { from: "opt_a", to: "fac_1", strength_mean: 1.0, strength_std: 0.01, belief_exists: 1.0, effect_direction: "positive" },
        { from: "fac_1", to: "out_1", strength_mean: 0.7, strength_std: 0.1, belief_exists: 0.9, effect_direction: "positive" },
        { from: "out_1", to: "goal_1", strength_mean: 0.5, strength_std: 0.1, belief_exists: 0.9, effect_direction: "positive" },
      ],
    });
    expect(fixRemainingForbiddenEdges(graph, "test").removedCount).toBe(0);
  });
});
