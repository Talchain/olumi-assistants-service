/**
 * Deterministic Cycle Breaking Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fixCyclesDeterministic } from "../../src/cee/unified-pipeline/stages/repair/deterministic-sweep.js";
import type { GraphT } from "../../src/schemas/graph.js";

function createTestGraph(partial: {
  nodes: GraphT["nodes"];
  edges: GraphT["edges"];
}): GraphT {
  return {
    version: "1",
    default_seed: 42,
    nodes: partial.nodes,
    edges: partial.edges,
    meta: { roots: [], leaves: [], suggested_positions: {}, source: "test" as const },
  };
}

vi.mock("../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe("fixCyclesDeterministic", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("breaks a simple cycle by removing weakest edge", () => {
    const graph = createTestGraph({
      nodes: [
        { id: "fac_a", kind: "factor", label: "A" },
        { id: "fac_b", kind: "factor", label: "B" },
        { id: "fac_c", kind: "factor", label: "C" },
      ],
      edges: [
        { from: "fac_a", to: "fac_b", strength_mean: 0.5, strength_std: 0.1, belief_exists: 0.9, effect_direction: "positive" },
        { from: "fac_b", to: "fac_c", strength_mean: 0.5, strength_std: 0.1, belief_exists: 0.3, effect_direction: "positive" },
        { from: "fac_c", to: "fac_a", strength_mean: 0.5, strength_std: 0.1, belief_exists: 0.7, effect_direction: "positive" },
      ],
    });
    const repairs = fixCyclesDeterministic(graph);
    expect(repairs).toHaveLength(1);
    expect(repairs[0].code).toBe("CYCLE_DETECTED");
    expect(repairs[0].path).toContain("fac_b→fac_c");
    expect(graph.edges).toHaveLength(2);
  });

  it("returns no repairs for DAG", () => {
    const graph = createTestGraph({
      nodes: [
        { id: "fac_a", kind: "factor", label: "A" },
        { id: "fac_b", kind: "factor", label: "B" },
      ],
      edges: [
        { from: "fac_a", to: "fac_b", strength_mean: 0.5, strength_std: 0.1, belief_exists: 0.9, effect_direction: "positive" },
      ],
    });
    const repairs = fixCyclesDeterministic(graph);
    expect(repairs).toHaveLength(0);
  });

  it("does not remove structural edges (decision→option)", () => {
    const graph = createTestGraph({
      nodes: [
        { id: "dec_1", kind: "decision", label: "D" },
        { id: "opt_a", kind: "option", label: "A" },
        { id: "fac_1", kind: "factor", label: "F" },
      ],
      edges: [
        { from: "dec_1", to: "opt_a", strength_mean: 1.0, strength_std: 0.01, belief_exists: 1.0, effect_direction: "positive" },
        { from: "opt_a", to: "fac_1", strength_mean: 1.0, strength_std: 0.01, belief_exists: 1.0, effect_direction: "positive" },
        { from: "fac_1", to: "dec_1", strength_mean: 0.3, strength_std: 0.1, belief_exists: 0.5, effect_direction: "positive" },
      ],
    });
    const repairs = fixCyclesDeterministic(graph);
    expect(repairs).toHaveLength(1);
    expect(repairs[0].path).toContain("fac_1→dec_1");
    expect(graph.edges).toHaveLength(2);
    expect(graph.edges.some((e) => e.from === "dec_1" && e.to === "opt_a")).toBe(true);
    expect(graph.edges.some((e) => e.from === "opt_a" && e.to === "fac_1")).toBe(true);
  });

  it("excludes bidirected edges from cycle detection", () => {
    const graph = createTestGraph({
      nodes: [
        { id: "fac_a", kind: "factor", label: "A" },
        { id: "fac_b", kind: "factor", label: "B" },
      ],
      edges: [
        { from: "fac_a", to: "fac_b", strength_mean: 0.5, strength_std: 0.1, belief_exists: 0.9, effect_direction: "positive" },
        { from: "fac_b", to: "fac_a", strength_mean: 0.3, strength_std: 0.1, belief_exists: 0.7, effect_direction: "positive", edge_type: "bidirected" as any },
      ],
    });
    const repairs = fixCyclesDeterministic(graph);
    expect(repairs).toHaveLength(0);
    expect(graph.edges).toHaveLength(2);
  });

  it("breaks multiple cycles iteratively", () => {
    const graph = createTestGraph({
      nodes: [
        { id: "fac_a", kind: "factor", label: "A" },
        { id: "fac_b", kind: "factor", label: "B" },
        { id: "fac_c", kind: "factor", label: "C" },
        { id: "fac_d", kind: "factor", label: "D" },
      ],
      edges: [
        { from: "fac_a", to: "fac_b", strength_mean: 0.5, strength_std: 0.1, belief_exists: 0.9, effect_direction: "positive" },
        { from: "fac_b", to: "fac_a", strength_mean: 0.5, strength_std: 0.1, belief_exists: 0.2, effect_direction: "positive" },
        { from: "fac_c", to: "fac_d", strength_mean: 0.5, strength_std: 0.1, belief_exists: 0.8, effect_direction: "positive" },
        { from: "fac_d", to: "fac_c", strength_mean: 0.5, strength_std: 0.1, belief_exists: 0.4, effect_direction: "positive" },
      ],
    });
    const repairs = fixCyclesDeterministic(graph);
    expect(repairs).toHaveLength(2);
    expect(graph.edges).toHaveLength(2);
  });

  it("uses highest index as tie-breaker when belief_exists is equal", () => {
    const graph = createTestGraph({
      nodes: [
        { id: "fac_a", kind: "factor", label: "A" },
        { id: "fac_b", kind: "factor", label: "B" },
        { id: "fac_c", kind: "factor", label: "C" },
      ],
      edges: [
        { from: "fac_a", to: "fac_b", strength_mean: 0.5, strength_std: 0.1, belief_exists: 0.5, effect_direction: "positive" },
        { from: "fac_b", to: "fac_c", strength_mean: 0.5, strength_std: 0.1, belief_exists: 0.5, effect_direction: "positive" },
        { from: "fac_c", to: "fac_a", strength_mean: 0.5, strength_std: 0.1, belief_exists: 0.5, effect_direction: "positive" },
      ],
    });
    const repairs = fixCyclesDeterministic(graph);
    expect(repairs).toHaveLength(1);
    expect(repairs[0].path).toContain("fac_c→fac_a");
  });
});
