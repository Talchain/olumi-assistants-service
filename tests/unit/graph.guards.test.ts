/**
 * Graph Guards Unit Tests
 *
 * Tests for Spec v04 compliance enforcement
 */

import { describe, it, expect } from "vitest";
import {
  normalizeEdgeIds,
  sortNodes,
  sortEdges,
  detectCycles,
  isDAG,
  breakCycles,
  findIsolatedNodes,
  pruneIsolatedNodes,
  calculateMeta,
  enforceGraphCompliance,
} from "../../src/utils/graphGuards.js";
import type { NodeT, EdgeT, GraphT } from "../../src/schemas/graph.js";

describe("Graph Guards", () => {
  describe("normalizeEdgeIds", () => {
    it("assigns stable IDs to edges", () => {
      const edges: EdgeT[] = [
        { from: "a", to: "b" },
        { from: "a", to: "b" },
        { from: "b", to: "c" },
      ];

      const normalized = normalizeEdgeIds(edges);

      expect(normalized[0].id).toBe("a::b::0");
      expect(normalized[1].id).toBe("a::b::1");
      expect(normalized[2].id).toBe("b::c::0");
    });

    it("preserves edge data", () => {
      const edges: EdgeT[] = [
        { from: "a", to: "b", weight: 0.5, belief: 0.8 },
      ];

      const normalized = normalizeEdgeIds(edges);

      expect(normalized[0].weight).toBe(0.5);
      expect(normalized[0].belief).toBe(0.8);
      expect(normalized[0].id).toBe("a::b::0");
    });
  });

  describe("sortNodes", () => {
    it("sorts nodes by id ascending", () => {
      const nodes: NodeT[] = [
        { id: "z", kind: "goal" },
        { id: "a", kind: "decision" },
        { id: "m", kind: "option" },
      ];

      const sorted = sortNodes(nodes);

      expect(sorted.map(n => n.id)).toEqual(["a", "m", "z"]);
    });

    it("is stable (doesn't modify original)", () => {
      const nodes: NodeT[] = [
        { id: "z", kind: "goal" },
        { id: "a", kind: "decision" },
      ];

      const original = nodes.map(n => n.id);
      sortNodes(nodes);

      expect(nodes.map(n => n.id)).toEqual(original);
    });
  });

  describe("sortEdges", () => {
    it("sorts edges by (from, to, id) triple", () => {
      const edges: EdgeT[] = [
        { id: "z::y::0", from: "z", to: "y" },
        { id: "a::b::1", from: "a", to: "b" },
        { id: "a::b::0", from: "a", to: "b" },
        { id: "a::c::0", from: "a", to: "c" },
      ];

      const sorted = sortEdges(edges);

      expect(sorted.map(e => e.id)).toEqual([
        "a::b::0",
        "a::b::1",
        "a::c::0",
        "z::y::0",
      ]);
    });
  });

  describe("detectCycles", () => {
    it("detects simple cycle", () => {
      const nodes: NodeT[] = [
        { id: "a", kind: "goal" },
        { id: "b", kind: "decision" },
        { id: "c", kind: "option" },
      ];

      const edges: EdgeT[] = [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
        { from: "c", to: "a" }, // Cycle back to a
      ];

      const cycles = detectCycles(nodes, edges);

      expect(cycles.length).toBeGreaterThan(0);
      expect(cycles[0]).toContain("a");
      expect(cycles[0]).toContain("b");
      expect(cycles[0]).toContain("c");
    });

    it("returns empty array for DAG", () => {
      const nodes: NodeT[] = [
        { id: "a", kind: "goal" },
        { id: "b", kind: "decision" },
        { id: "c", kind: "option" },
      ];

      const edges: EdgeT[] = [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
      ];

      const cycles = detectCycles(nodes, edges);

      expect(cycles).toEqual([]);
    });

    it("detects self-loop", () => {
      const nodes: NodeT[] = [{ id: "a", kind: "goal" }];
      const edges: EdgeT[] = [{ from: "a", to: "a" }];

      const cycles = detectCycles(nodes, edges);

      expect(cycles.length).toBeGreaterThan(0);
    });
  });

  describe("isDAG", () => {
    it("returns true for acyclic graph", () => {
      const nodes: NodeT[] = [
        { id: "a", kind: "goal" },
        { id: "b", kind: "decision" },
      ];
      const edges: EdgeT[] = [{ from: "a", to: "b" }];

      expect(isDAG(nodes, edges)).toBe(true);
    });

    it("returns false for cyclic graph", () => {
      const nodes: NodeT[] = [
        { id: "a", kind: "goal" },
        { id: "b", kind: "decision" },
      ];
      const edges: EdgeT[] = [
        { from: "a", to: "b" },
        { from: "b", to: "a" },
      ];

      expect(isDAG(nodes, edges)).toBe(false);
    });
  });

  describe("breakCycles", () => {
    it("removes edges to break cycles", () => {
      const nodes: NodeT[] = [
        { id: "a", kind: "goal" },
        { id: "b", kind: "decision" },
        { id: "c", kind: "option" },
      ];

      const edges: EdgeT[] = [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
        { from: "c", to: "a" }, // Creates cycle
      ];

      const fixed = breakCycles(nodes, edges);

      expect(isDAG(nodes, fixed)).toBe(true);
      expect(fixed.length).toBeLessThan(edges.length);
    });

    it("preserves DAG unchanged", () => {
      const nodes: NodeT[] = [
        { id: "a", kind: "goal" },
        { id: "b", kind: "decision" },
      ];

      const edges: EdgeT[] = [{ from: "a", to: "b" }];

      const result = breakCycles(nodes, edges);

      expect(result).toEqual(edges);
    });

    it("removes only specific edge ID when multiple edges exist between same nodes", () => {
      const nodes: NodeT[] = [
        { id: "a", kind: "goal" },
        { id: "b", kind: "decision" },
      ];

      // Multiple edges between a and b, forming a cycle
      const edges: EdgeT[] = [
        { id: "a::b::0", from: "a", to: "b" },
        { id: "a::b::1", from: "a", to: "b" },
        { id: "b::a::0", from: "b", to: "a" }, // Creates cycle
      ];

      const fixed = breakCycles(nodes, edges);

      // Should be a DAG now
      expect(isDAG(nodes, fixed)).toBe(true);

      // Should have removed exactly 1 edge (the specific b::a::0 edge)
      expect(fixed.length).toBe(2);

      // Should still have both a::b edges
      expect(fixed.find(e => e.id === "a::b::0")).toBeDefined();
      expect(fixed.find(e => e.id === "a::b::1")).toBeDefined();

      // Should have removed the b::a::0 edge
      expect(fixed.find(e => e.id === "b::a::0")).toBeUndefined();
    });
  });

  describe("findIsolatedNodes", () => {
    it("finds nodes with no connections", () => {
      const nodes: NodeT[] = [
        { id: "a", kind: "goal" },
        { id: "b", kind: "decision" },
        { id: "c", kind: "option" },
      ];

      const edges: EdgeT[] = [{ from: "a", to: "b" }];

      const isolated = findIsolatedNodes(nodes, edges);

      expect(isolated).toEqual(["c"]);
    });

    it("returns empty array when all nodes connected", () => {
      const nodes: NodeT[] = [
        { id: "a", kind: "goal" },
        { id: "b", kind: "decision" },
      ];

      const edges: EdgeT[] = [{ from: "a", to: "b" }];

      const isolated = findIsolatedNodes(nodes, edges);

      expect(isolated).toEqual([]);
    });
  });

  describe("pruneIsolatedNodes", () => {
    it("removes isolated nodes", () => {
      const nodes: NodeT[] = [
        { id: "a", kind: "goal" },
        { id: "b", kind: "decision" },
        { id: "isolated", kind: "option" },
      ];

      const edges: EdgeT[] = [{ from: "a", to: "b" }];

      const pruned = pruneIsolatedNodes(nodes, edges);

      expect(pruned).toHaveLength(2);
      expect(pruned.find(n => n.id === "isolated")).toBeUndefined();
    });
  });

  describe("calculateMeta", () => {
    it("identifies roots (no incoming edges)", () => {
      const nodes: NodeT[] = [
        { id: "goal", kind: "goal" },
        { id: "dec", kind: "decision" },
      ];

      const edges: EdgeT[] = [{ from: "goal", to: "dec" }];

      const meta = calculateMeta(nodes, edges);

      expect(meta.roots).toEqual(["goal"]);
    });

    it("identifies leaves (no outgoing edges)", () => {
      const nodes: NodeT[] = [
        { id: "goal", kind: "goal" },
        { id: "outcome", kind: "outcome" },
      ];

      const edges: EdgeT[] = [{ from: "goal", to: "outcome" }];

      const meta = calculateMeta(nodes, edges);

      expect(meta.leaves).toEqual(["outcome"]);
    });

    it("generates suggested positions", () => {
      const nodes: NodeT[] = [
        { id: "a", kind: "goal" },
        { id: "b", kind: "decision" },
      ];

      const edges: EdgeT[] = [{ from: "a", to: "b" }];

      const meta = calculateMeta(nodes, edges);

      expect(meta.suggested_positions).toHaveProperty("a");
      expect(meta.suggested_positions).toHaveProperty("b");
      expect(meta.suggested_positions.a).toHaveProperty("x");
      expect(meta.suggested_positions.a).toHaveProperty("y");
    });
  });

  describe("enforceGraphCompliance", () => {
    it("applies all guards in correct order", () => {
      const graph: GraphT = {
        version: "1",
        default_seed: 42,
        nodes: [
          { id: "z", kind: "goal" },
          { id: "a", kind: "decision" },
          { id: "isolated", kind: "option" },
        ],
        edges: [
          { from: "z", to: "a" },
          { from: "a", to: "z" }, // Cycle
        ],
        meta: {
          source: "assistant" as const,
          roots: [],
          leaves: [],
          suggested_positions: {},
        },
      };

      const compliant = enforceGraphCompliance(graph);

      // Should be sorted
      expect(compliant.nodes[0].id).toBe("a");
      expect(compliant.nodes[1].id).toBe("z");

      // Isolated node pruned
      expect(compliant.nodes.find(n => n.id === "isolated")).toBeUndefined();

      // Cycle broken (DAG)
      expect(isDAG(compliant.nodes, compliant.edges)).toBe(true);

      // Edge IDs normalized
      compliant.edges.forEach(e => {
        expect(e.id).toMatch(/^[^:]+::[^:]+::\d+$/);
      });

      // Meta fields present
      expect(compliant.meta.roots).toBeDefined();
      expect(compliant.meta.leaves).toBeDefined();
      expect(compliant.meta.suggested_positions).toBeDefined();
    });

    it("caps node count", () => {
      const nodes: NodeT[] = Array.from({ length: 20 }, (_, i) => ({
        id: `node_${i}`,
        kind: "option" as const,
      }));

      const graph: GraphT = {
        version: "1",
        default_seed: 42,
        nodes,
        edges: [],
        meta: {
          source: "assistant" as const,
          roots: [],
          leaves: [],
          suggested_positions: {},
        },
      };

      const compliant = enforceGraphCompliance(graph, { maxNodes: 5 });

      expect(compliant.nodes.length).toBeLessThanOrEqual(5);
    });

    it("caps edge count", () => {
      const nodes: NodeT[] = [
        { id: "a", kind: "goal" },
        { id: "b", kind: "decision" },
      ];

      const edges: EdgeT[] = Array.from({ length: 30 }, (_, _i) => ({
        from: "a",
        to: "b",
      }));

      const graph: GraphT = {
        version: "1",
        default_seed: 42,
        nodes,
        edges,
        meta: {
          source: "assistant" as const,
          roots: [],
          leaves: [],
          suggested_positions: {},
        },
      };

      const compliant = enforceGraphCompliance(graph, { maxEdges: 10 });

      expect(compliant.edges.length).toBeLessThanOrEqual(10);
    });

    it("preserves node and edge data", () => {
      const graph: GraphT = {
        version: "1",
        default_seed: 42,
        nodes: [
          { id: "a", kind: "goal", label: "Test Goal" },
        ],
        edges: [
          {
            from: "a",
            to: "a", // Self-loop (will be removed)
            weight: 0.5,
          },
        ],
        meta: {
          source: "assistant" as const,
          roots: [],
          leaves: [],
          suggested_positions: {},
        },
      };

      const compliant = enforceGraphCompliance(graph);

      expect(compliant.nodes[0].label).toBe("Test Goal");
    });
  });
});
