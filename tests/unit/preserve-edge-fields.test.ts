/**
 * Tests for preserveEdgeFieldsFromOriginal / preserveFieldsFromOriginal
 *
 * Validates that V4 edge fields stripped by the external validation engine
 * are correctly restored from the original graph.
 */

import { describe, it, expect, vi } from "vitest";
import { preserveEdgeFieldsFromOriginal, preserveFieldsFromOriginal } from "../../src/routes/assist.draft-graph.js";
import type { GraphT } from "../../src/schemas/graph.js";

// Mock telemetry to prevent actual logging during tests
vi.mock("../../src/utils/telemetry.js", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  emit: vi.fn(),
  calculateCost: vi.fn(),
  TelemetryEvents: {},
}));

/**
 * Helper to create test graphs without requiring all optional fields.
 */
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

const baseNodes: GraphT["nodes"] = [
  { id: "dec_1", kind: "decision", label: "Decision" },
  { id: "opt_a", kind: "option", label: "Option A" },
  { id: "out_1", kind: "outcome", label: "Outcome" },
  { id: "goal_1", kind: "goal", label: "Goal" },
];

describe("preserveEdgeFieldsFromOriginal", () => {
  it("restores V4 fields stripped by the engine", () => {
    const original = createTestGraph({
      nodes: baseNodes,
      edges: [
        {
          from: "opt_a", to: "out_1",
          strength_mean: 0.45, strength_std: 0.12,
          belief_exists: 0.85, effect_direction: "positive" as const,
        },
        {
          from: "out_1", to: "goal_1",
          strength_mean: -0.6, strength_std: 0.2,
          belief_exists: 0.7, effect_direction: "negative" as const,
        },
      ],
    });

    // Engine returns normalized graph with V4 fields stripped
    const normalized = createTestGraph({
      nodes: baseNodes,
      edges: [
        { from: "opt_a", to: "out_1" } as any,
        { from: "out_1", to: "goal_1" } as any,
      ],
    });

    const result = preserveEdgeFieldsFromOriginal(normalized, original);

    const edge1 = result.edges.find(e => e.from === "opt_a" && e.to === "out_1")!;
    expect(edge1.strength_mean).toBe(0.45);
    expect(edge1.strength_std).toBe(0.12);
    expect(edge1.belief_exists).toBe(0.85);
    expect(edge1.effect_direction).toBe("positive");

    const edge2 = result.edges.find(e => e.from === "out_1" && e.to === "goal_1")!;
    expect(edge2.strength_mean).toBe(-0.6);
    expect(edge2.strength_std).toBe(0.2);
    expect(edge2.belief_exists).toBe(0.7);
    expect(edge2.effect_direction).toBe("negative");
  });

  it("does not overwrite normalized values that already exist", () => {
    const original = createTestGraph({
      nodes: baseNodes,
      edges: [
        {
          from: "opt_a", to: "out_1",
          strength_mean: 0.45, strength_std: 0.12,
          belief_exists: 0.85, effect_direction: "positive" as const,
        },
      ],
    });

    // Engine returns a normalized edge with its own strength_mean
    const normalized = createTestGraph({
      nodes: baseNodes,
      edges: [
        {
          from: "opt_a", to: "out_1",
          strength_mean: 0.3, // Engine set this — should NOT be overwritten
        } as any,
      ],
    });

    const result = preserveEdgeFieldsFromOriginal(normalized, original);
    const edge = result.edges.find(e => e.from === "opt_a" && e.to === "out_1")!;

    // Engine's value preserved
    expect(edge.strength_mean).toBe(0.3);
    // Missing fields restored from original
    expect(edge.strength_std).toBe(0.12);
    expect(edge.belief_exists).toBe(0.85);
    expect(edge.effect_direction).toBe("positive");
  });

  it("does not restore onto engine-added edges (not in original)", () => {
    const original = createTestGraph({
      nodes: baseNodes,
      edges: [
        {
          from: "opt_a", to: "out_1",
          strength_mean: 0.45, strength_std: 0.12,
          belief_exists: 0.85, effect_direction: "positive" as const,
        },
      ],
    });

    // Engine added a new edge not in original
    const normalized = createTestGraph({
      nodes: baseNodes,
      edges: [
        {
          from: "opt_a", to: "out_1",
          strength_mean: 0.45, strength_std: 0.12,
          belief_exists: 0.85, effect_direction: "positive" as const,
        },
        { from: "dec_1", to: "goal_1" } as any, // Engine-added edge
      ],
    });

    const result = preserveEdgeFieldsFromOriginal(normalized, original);
    const engineEdge = result.edges.find(e => e.from === "dec_1" && e.to === "goal_1")!;

    // Engine-added edge should have no V4 fields restored
    expect(engineEdge.strength_mean).toBeUndefined();
    expect(engineEdge.strength_std).toBeUndefined();
    expect(engineEdge.belief_exists).toBeUndefined();
    expect(engineEdge.effect_direction).toBeUndefined();
  });

  it("preserves sign on negative strength_mean", () => {
    const original = createTestGraph({
      nodes: baseNodes,
      edges: [
        {
          from: "opt_a", to: "out_1",
          strength_mean: -0.72, strength_std: 0.15,
          belief_exists: 0.9, effect_direction: "negative" as const,
        },
      ],
    });

    const normalized = createTestGraph({
      nodes: baseNodes,
      edges: [{ from: "opt_a", to: "out_1" } as any],
    });

    const result = preserveEdgeFieldsFromOriginal(normalized, original);
    const edge = result.edges.find(e => e.from === "opt_a")!;
    expect(edge.strength_mean).toBe(-0.72);
    expect(edge.effect_direction).toBe("negative");
  });

  it("does not restore legacy weight/belief fields", () => {
    const original = createTestGraph({
      nodes: baseNodes,
      edges: [
        {
          from: "opt_a", to: "out_1",
          strength_mean: 0.5,
          weight: 0.8,   // Legacy — should NOT be restored
          belief: 0.9,   // Legacy — should NOT be restored
        } as any,
      ],
    });

    const normalized = createTestGraph({
      nodes: baseNodes,
      edges: [{ from: "opt_a", to: "out_1" } as any],
    });

    const result = preserveEdgeFieldsFromOriginal(normalized, original);
    const edge = result.edges.find(e => e.from === "opt_a")! as any;

    // V4 field restored
    expect(edge.strength_mean).toBe(0.5);
    // Legacy fields NOT restored
    expect(edge.weight).toBeUndefined();
    expect(edge.belief).toBeUndefined();
  });

  it("handles empty edge arrays gracefully", () => {
    const original = createTestGraph({ nodes: baseNodes, edges: [] });
    const normalized = createTestGraph({ nodes: baseNodes, edges: [] });

    const result = preserveEdgeFieldsFromOriginal(normalized, original);
    expect(result.edges).toHaveLength(0);
  });
});

describe("preserveFieldsFromOriginal", () => {
  it("restores both node category and edge V4 fields", () => {
    const original = createTestGraph({
      nodes: [
        { id: "opt_a", kind: "option", label: "Option A", category: "controllable" as any },
        { id: "out_1", kind: "outcome", label: "Outcome" },
      ],
      edges: [
        {
          from: "opt_a", to: "out_1",
          strength_mean: 0.6, strength_std: 0.1,
          belief_exists: 0.95, effect_direction: "positive" as const,
        },
      ],
    });

    // Engine strips category from node and V4 fields from edge
    const normalized = createTestGraph({
      nodes: [
        { id: "opt_a", kind: "option", label: "Option A" },
        { id: "out_1", kind: "outcome", label: "Outcome" },
      ],
      edges: [{ from: "opt_a", to: "out_1" } as any],
    });

    const result = preserveFieldsFromOriginal(normalized, original);

    // Category restored on node
    expect(result.nodes.find(n => n.id === "opt_a")!.category).toBe("controllable");

    // V4 fields restored on edge
    const edge = result.edges.find(e => e.from === "opt_a")!;
    expect(edge.strength_mean).toBe(0.6);
    expect(edge.belief_exists).toBe(0.95);
  });
});
