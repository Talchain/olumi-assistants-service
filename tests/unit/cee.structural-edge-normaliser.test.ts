/**
 * Structural Edge Normaliser Tests
 *
 * Tests for normalising option→factor edges to canonical values.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { normaliseStructuralEdges } from "../../src/cee/structural-edge-normaliser.js";
import { CANONICAL_EDGE } from "../../src/validators/graph-validator.types.js";
import type { GraphT } from "../../src/schemas/graph.js";

// Mock the log module to prevent actual logging during tests
vi.mock("../../src/utils/telemetry.js", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("normaliseStructuralEdges", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("option→factor edge normalisation", () => {
    it("normalises drifted values to canonical values", () => {
      const graph: GraphT = {
        version: "1",
        default_seed: 42,
        nodes: [
          { id: "goal_1", kind: "goal", label: "Test Goal" },
          { id: "opt_a", kind: "option", label: "Option A" },
          { id: "fac_1", kind: "factor", label: "Factor 1" },
        ],
        edges: [
          {
            from: "opt_a",
            to: "fac_1",
            strength_mean: 0.95, // Drifted from 1.0
            strength_std: 0.1, // Drifted from 0.01
            belief_exists: 0.9, // Drifted from 1.0
            effect_direction: "positive",
            edge_type: "directed",
          },
        ],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "test" },
      };

      const result = normaliseStructuralEdges(graph);

      expect(result.normalisedCount).toBe(1);
      expect(result.graph.edges[0].strength_mean).toBe(CANONICAL_EDGE.mean);
      expect(result.graph.edges[0].strength_std).toBe(CANONICAL_EDGE.std);
      expect(result.graph.edges[0].belief_exists).toBe(CANONICAL_EDGE.prob);
      expect(result.graph.edges[0].effect_direction).toBe(CANONICAL_EDGE.direction);
    });

    it("leaves already canonical option→factor edge unchanged", () => {
      const graph: GraphT = {
        version: "1",
        default_seed: 42,
        nodes: [
          { id: "goal_1", kind: "goal", label: "Test Goal" },
          { id: "opt_a", kind: "option", label: "Option A" },
          { id: "fac_1", kind: "factor", label: "Factor 1" },
        ],
        edges: [
          {
            from: "opt_a",
            to: "fac_1",
            strength_mean: 1.0,
            strength_std: 0.01,
            belief_exists: 1.0,
            effect_direction: "positive",
            edge_type: "directed",
          },
        ],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "test" },
      };

      const result = normaliseStructuralEdges(graph);

      expect(result.normalisedCount).toBe(0);
      expect(result.normalisedEdges).toHaveLength(0);
      // Values unchanged
      expect(result.graph.edges[0].strength_mean).toBe(1.0);
      expect(result.graph.edges[0].strength_std).toBe(0.01);
    });

    it("sets direction to positive when missing", () => {
      const graph: GraphT = {
        version: "1",
        default_seed: 42,
        nodes: [
          { id: "goal_1", kind: "goal", label: "Test Goal" },
          { id: "opt_a", kind: "option", label: "Option A" },
          { id: "fac_1", kind: "factor", label: "Factor 1" },
        ],
        edges: [
          {
            from: "opt_a",
            to: "fac_1",
            strength_mean: 1.0,
            strength_std: 0.01,
            belief_exists: 1.0,
            edge_type: "directed",
            // effect_direction missing
          },
        ],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "test" },
      };

      const result = normaliseStructuralEdges(graph);

      expect(result.normalisedCount).toBe(1);
      expect(result.graph.edges[0].effect_direction).toBe("positive");
    });
  });

  describe("non-structural edges are untouched", () => {
    it("does not modify factor→factor edges", () => {
      const graph: GraphT = {
        version: "1",
        default_seed: 42,
        nodes: [
          { id: "goal_1", kind: "goal", label: "Test Goal" },
          { id: "fac_1", kind: "factor", label: "Factor 1" },
          { id: "fac_2", kind: "factor", label: "Factor 2" },
        ],
        edges: [
          {
            from: "fac_1",
            to: "fac_2",
            strength_mean: 0.7, // Non-canonical - should stay as-is
            strength_std: 0.15,
            belief_exists: 0.85,
            effect_direction: "negative",
            edge_type: "directed",
          },
        ],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "test" },
      };

      const result = normaliseStructuralEdges(graph);

      expect(result.normalisedCount).toBe(0);
      // Values unchanged - factor→factor is a causal edge
      expect(result.graph.edges[0].strength_mean).toBe(0.7);
      expect(result.graph.edges[0].strength_std).toBe(0.15);
      expect(result.graph.edges[0].belief_exists).toBe(0.85);
      expect(result.graph.edges[0].effect_direction).toBe("negative");
    });

    it("does not modify factor→goal edges", () => {
      const graph: GraphT = {
        version: "1",
        default_seed: 42,
        nodes: [
          { id: "goal_1", kind: "goal", label: "Test Goal" },
          { id: "fac_1", kind: "factor", label: "Factor 1" },
        ],
        edges: [
          {
            from: "fac_1",
            to: "goal_1",
            strength_mean: 0.6,
            strength_std: 0.2,
            belief_exists: 0.75,
            effect_direction: "positive",
            edge_type: "directed",
          },
        ],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "test" },
      };

      const result = normaliseStructuralEdges(graph);

      expect(result.normalisedCount).toBe(0);
      expect(result.graph.edges[0].strength_mean).toBe(0.6);
    });

    it("does not modify option→goal edges", () => {
      const graph: GraphT = {
        version: "1",
        default_seed: 42,
        nodes: [
          { id: "goal_1", kind: "goal", label: "Test Goal" },
          { id: "opt_a", kind: "option", label: "Option A" },
        ],
        edges: [
          {
            from: "opt_a",
            to: "goal_1",
            strength_mean: 0.8,
            strength_std: 0.1,
            belief_exists: 0.9,
            effect_direction: "positive",
            edge_type: "directed",
          },
        ],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "test" },
      };

      const result = normaliseStructuralEdges(graph);

      expect(result.normalisedCount).toBe(0);
      expect(result.graph.edges[0].strength_mean).toBe(0.8);
    });

    it("does not modify decision→option edges", () => {
      const graph: GraphT = {
        version: "1",
        default_seed: 42,
        nodes: [
          { id: "dec_1", kind: "decision", label: "Test Decision" },
          { id: "opt_a", kind: "option", label: "Option A" },
        ],
        edges: [
          {
            from: "dec_1",
            to: "opt_a",
            strength_mean: 0.5,
            strength_std: 0.05,
            belief_exists: 0.8,
            effect_direction: "positive",
            edge_type: "directed",
          },
        ],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "test" },
      };

      const result = normaliseStructuralEdges(graph);

      expect(result.normalisedCount).toBe(0);
      expect(result.graph.edges[0].strength_mean).toBe(0.5);
    });
  });

  describe("mixed edge types", () => {
    it("only normalises option→factor edges in a mixed graph", () => {
      const graph: GraphT = {
        version: "1",
        default_seed: 42,
        nodes: [
          { id: "goal_1", kind: "goal", label: "Test Goal" },
          { id: "opt_a", kind: "option", label: "Option A" },
          { id: "opt_b", kind: "option", label: "Option B" },
          { id: "fac_1", kind: "factor", label: "Factor 1" },
          { id: "fac_2", kind: "factor", label: "Factor 2" },
        ],
        edges: [
          // Structural edge 1 - should be normalised
          {
            from: "opt_a",
            to: "fac_1",
            strength_mean: 0.95,
            strength_std: 0.08,
            belief_exists: 0.92,
            effect_direction: "positive",
            edge_type: "directed",
          },
          // Causal edge - should NOT be normalised
          {
            from: "fac_1",
            to: "goal_1",
            strength_mean: 0.7,
            strength_std: 0.15,
            belief_exists: 0.85,
            effect_direction: "positive",
            edge_type: "directed",
          },
          // Structural edge 2 - should be normalised
          {
            from: "opt_b",
            to: "fac_2",
            strength_mean: 0.88,
            strength_std: 0.12,
            belief_exists: 0.95,
            effect_direction: "positive",
            edge_type: "directed",
          },
          // Another causal edge - should NOT be normalised
          {
            from: "fac_2",
            to: "goal_1",
            strength_mean: 0.5,
            strength_std: 0.2,
            belief_exists: 0.7,
            effect_direction: "negative",
            edge_type: "directed",
          },
        ],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "test" },
      };

      const result = normaliseStructuralEdges(graph);

      // Only 2 structural edges normalised
      expect(result.normalisedCount).toBe(2);
      expect(result.normalisedEdges).toHaveLength(2);

      // Edge 0: opt_a→fac_1 (normalised)
      expect(result.graph.edges[0].strength_mean).toBe(CANONICAL_EDGE.mean);
      expect(result.graph.edges[0].strength_std).toBe(CANONICAL_EDGE.std);

      // Edge 1: fac_1→goal_1 (unchanged)
      expect(result.graph.edges[1].strength_mean).toBe(0.7);
      expect(result.graph.edges[1].strength_std).toBe(0.15);

      // Edge 2: opt_b→fac_2 (normalised)
      expect(result.graph.edges[2].strength_mean).toBe(CANONICAL_EDGE.mean);
      expect(result.graph.edges[2].strength_std).toBe(CANONICAL_EDGE.std);

      // Edge 3: fac_2→goal_1 (unchanged)
      expect(result.graph.edges[3].strength_mean).toBe(0.5);
      expect(result.graph.edges[3].effect_direction).toBe("negative");
    });
  });

  describe("observability metadata", () => {
    it("records original and canonical values in normalisedEdges", () => {
      const graph: GraphT = {
        version: "1",
        default_seed: 42,
        nodes: [
          { id: "goal_1", kind: "goal", label: "Test Goal" },
          { id: "opt_a", kind: "option", label: "Option A" },
          { id: "fac_1", kind: "factor", label: "Factor 1" },
        ],
        edges: [
          {
            from: "opt_a",
            to: "fac_1",
            strength_mean: 0.95,
            strength_std: 0.1,
            belief_exists: 0.9,
            effect_direction: "negative", // Wrong direction
            edge_type: "directed",
          },
        ],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "test" },
      };

      const result = normaliseStructuralEdges(graph);

      expect(result.normalisedEdges).toHaveLength(1);
      const record = result.normalisedEdges[0];

      expect(record.from).toBe("opt_a");
      expect(record.to).toBe("fac_1");
      expect(record.original.mean).toBe(0.95);
      expect(record.original.std).toBe(0.1);
      expect(record.original.prob).toBe(0.9);
      expect(record.original.direction).toBe("negative");
      expect(record.canonical.mean).toBe(1);
      expect(record.canonical.std).toBe(0.01);
      expect(record.canonical.prob).toBe(1);
      expect(record.canonical.direction).toBe("positive");
    });

    it("includes edge id in the record when present", () => {
      const graph: GraphT = {
        version: "1",
        default_seed: 42,
        nodes: [
          { id: "goal_1", kind: "goal", label: "Test Goal" },
          { id: "opt_a", kind: "option", label: "Option A" },
          { id: "fac_1", kind: "factor", label: "Factor 1" },
        ],
        edges: [
          {
            id: "edge_opt_a_fac_1",
            from: "opt_a",
            to: "fac_1",
            strength_mean: 0.9,
            strength_std: 0.05,
            belief_exists: 0.95,
            effect_direction: "positive",
            edge_type: "directed",
          } as any,
        ],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "test" },
      };

      const result = normaliseStructuralEdges(graph);

      expect(result.normalisedEdges[0].edgeId).toBe("edge_opt_a_fac_1");
    });

    it("generates edge id from from→to when id not present", () => {
      const graph: GraphT = {
        version: "1",
        default_seed: 42,
        nodes: [
          { id: "goal_1", kind: "goal", label: "Test Goal" },
          { id: "opt_a", kind: "option", label: "Option A" },
          { id: "fac_1", kind: "factor", label: "Factor 1" },
        ],
        edges: [
          {
            from: "opt_a",
            to: "fac_1",
            strength_mean: 0.9,
            strength_std: 0.05,
            belief_exists: 0.95,
            effect_direction: "positive",
            edge_type: "directed",
          },
        ],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "test" },
      };

      const result = normaliseStructuralEdges(graph);

      expect(result.normalisedEdges[0].edgeId).toBe("opt_a->fac_1");
    });
  });

  describe("edge cases", () => {
    it("handles empty edges array", () => {
      const graph: GraphT = {
        version: "1",
        default_seed: 42,
        nodes: [{ id: "goal_1", kind: "goal", label: "Test Goal" }],
        edges: [],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "test" },
      };

      const result = normaliseStructuralEdges(graph);

      expect(result.normalisedCount).toBe(0);
      expect(result.graph.edges).toHaveLength(0);
    });

    it("handles edges with missing nodes gracefully", () => {
      const graph: GraphT = {
        version: "1",
        default_seed: 42,
        nodes: [{ id: "goal_1", kind: "goal", label: "Test Goal" }],
        edges: [
          {
            from: "unknown_node",
            to: "also_unknown",
            strength_mean: 0.5,
            strength_std: 0.1,
            belief_exists: 0.8,
            effect_direction: "positive",
            edge_type: "directed",
          },
        ],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "test" },
      };

      const result = normaliseStructuralEdges(graph);

      // Edge is not normalised because we can't determine node kinds
      expect(result.normalisedCount).toBe(0);
      expect(result.graph.edges[0].strength_mean).toBe(0.5);
    });

    it("handles legacy weight field instead of strength_mean", () => {
      const graph: GraphT = {
        version: "1",
        default_seed: 42,
        nodes: [
          { id: "goal_1", kind: "goal", label: "Test Goal" },
          { id: "opt_a", kind: "option", label: "Option A" },
          { id: "fac_1", kind: "factor", label: "Factor 1" },
        ],
        edges: [
          {
            from: "opt_a",
            to: "fac_1",
            weight: 0.9, // Legacy field
            strength_std: 0.05,
            belief_exists: 0.95,
            effect_direction: "positive",
            edge_type: "directed",
          } as any,
        ],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "test" },
      };

      const result = normaliseStructuralEdges(graph);

      expect(result.normalisedCount).toBe(1);
      expect(result.normalisedEdges[0].original.mean).toBe(0.9);
    });

    it("handles legacy belief field instead of belief_exists", () => {
      const graph: GraphT = {
        version: "1",
        default_seed: 42,
        nodes: [
          { id: "goal_1", kind: "goal", label: "Test Goal" },
          { id: "opt_a", kind: "option", label: "Option A" },
          { id: "fac_1", kind: "factor", label: "Factor 1" },
        ],
        edges: [
          {
            from: "opt_a",
            to: "fac_1",
            strength_mean: 0.9,
            strength_std: 0.05,
            belief: 0.85, // Legacy field
            effect_direction: "positive",
            edge_type: "directed",
          } as any,
        ],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "test" },
      };

      const result = normaliseStructuralEdges(graph);

      expect(result.normalisedCount).toBe(1);
      expect(result.normalisedEdges[0].original.prob).toBe(0.85);
    });
  });
});
