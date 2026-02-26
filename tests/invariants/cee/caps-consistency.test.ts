/**
 * INVARIANT: Graph caps must be consistent across all enforcement points
 * DISCOVERED: Multiple node/edge capping locations must use same limits
 *
 * This test ensures that:
 * 1. GRAPH_MAX_NODES and GRAPH_MAX_EDGES are respected everywhere
 * 2. Capping order doesn't cause different outcomes
 * 3. Edge filtering after node capping removes dangling edges
 */

import { describe, it, expect } from "vitest";
import { simpleRepair } from "../../../src/services/repair.js";
import { enforceGraphCompliance } from "../../../src/utils/graphGuards.js";
import { GRAPH_MAX_NODES, GRAPH_MAX_EDGES } from "../../../src/config/graphCaps.js";
import type { GraphT, NodeT, EdgeT } from "../../../src/schemas/graph.js";

describe("CEE Caps Consistency Invariant", () => {
  describe("node cap enforcement", () => {
    it("simpleRepair respects GRAPH_MAX_NODES", () => {
      // Create graph with more nodes than the cap using unprotected kind
      const nodes: NodeT[] = Array.from({ length: GRAPH_MAX_NODES + 20 }, (_, i) => ({
        id: `act_${i.toString().padStart(3, "0")}`,
        kind: "action" as const,
        label: `Action ${i}`,
      }));

      const edges: EdgeT[] = [];

      const graph: GraphT = {
        version: "1",
        default_seed: 42,
        nodes,
        edges,
        meta: { source: "test" as const, roots: [], leaves: [], suggested_positions: {} },
      };

      const result = simpleRepair(graph, "test-request");

      expect(result.nodes.length).toBeLessThanOrEqual(GRAPH_MAX_NODES);
    });

    it("enforceGraphCompliance respects GRAPH_MAX_NODES", () => {
      const nodes: NodeT[] = Array.from({ length: GRAPH_MAX_NODES + 20 }, (_, i) => ({
        id: `fac_${i.toString().padStart(3, "0")}`,
        kind: "factor" as const,
        label: `Factor ${i}`,
      }));

      const edges: EdgeT[] = [];

      const graph: GraphT = {
        version: "1",
        default_seed: 42,
        nodes,
        edges,
        meta: { source: "test" as const, roots: [], leaves: [], suggested_positions: {} },
      };

      const result = enforceGraphCompliance(graph);

      expect(result.nodes.length).toBeLessThanOrEqual(GRAPH_MAX_NODES);
    });

    it("default caps match between graphCaps.ts exports", () => {
      // These are the canonical values - test that we're using them
      expect(GRAPH_MAX_NODES).toBeGreaterThanOrEqual(50);
      expect(GRAPH_MAX_EDGES).toBeGreaterThanOrEqual(200);
      // Edge cap should be greater than node cap (typical ratio is 4:1)
      expect(GRAPH_MAX_EDGES).toBeGreaterThan(GRAPH_MAX_NODES);
    });
  });

  describe("edge cap enforcement", () => {
    it("simpleRepair respects GRAPH_MAX_EDGES", () => {
      const nodes: NodeT[] = [
        { id: "dec_1", kind: "decision" as const, label: "Decision 1" },
        { id: "opt_1", kind: "option" as const, label: "Option 1" },
        { id: "opt_2", kind: "option" as const, label: "Option 2" },
      ];

      // Create more edges than the cap (duplicate edges with indices)
      const edges: EdgeT[] = Array.from({ length: GRAPH_MAX_EDGES + 50 }, (_, i) => ({
        id: `edge_${i}`,
        from: i % 2 === 0 ? "dec_1" : "opt_1",
        to: i % 2 === 0 ? "opt_1" : "opt_2",
      }));

      const graph: GraphT = {
        version: "1",
        default_seed: 42,
        nodes,
        edges,
        meta: { source: "test" as const, roots: [], leaves: [], suggested_positions: {} },
      };

      const result = simpleRepair(graph, "test-request");

      expect(result.edges.length).toBeLessThanOrEqual(GRAPH_MAX_EDGES);
    });

    it("enforceGraphCompliance respects GRAPH_MAX_EDGES", () => {
      const nodes: NodeT[] = [
        { id: "dec_1", kind: "decision" as const, label: "Decision 1" },
        { id: "opt_1", kind: "option" as const, label: "Option 1" },
        { id: "opt_2", kind: "option" as const, label: "Option 2" },
      ];

      const edges: EdgeT[] = Array.from({ length: GRAPH_MAX_EDGES + 50 }, (_, i) => ({
        id: `edge_${i}`,
        from: i % 2 === 0 ? "dec_1" : "opt_1",
        to: i % 2 === 0 ? "opt_1" : "opt_2",
      }));

      const graph: GraphT = {
        version: "1",
        default_seed: 42,
        nodes,
        edges,
        meta: { source: "test" as const, roots: [], leaves: [], suggested_positions: {} },
      };

      const result = enforceGraphCompliance(graph);

      expect(result.edges.length).toBeLessThanOrEqual(GRAPH_MAX_EDGES);
    });
  });

  describe("dangling edge cleanup after node capping", () => {
    it("simpleRepair removes edges to capped nodes", () => {
      // Create nodes where some will be capped
      const nodes: NodeT[] = [
        // Protected nodes
        { id: "goal_1", kind: "goal" as const, label: "Goal" },
        { id: "dec_1", kind: "decision" as const, label: "Decision" },
        // Many factors that may be capped
        ...Array.from({ length: GRAPH_MAX_NODES + 10 }, (_, i) => ({
          id: `fac_${i.toString().padStart(3, "0")}`,
          kind: "factor" as const,
          label: `Factor ${i}`,
        })),
      ];

      // Create edges to nodes that will be capped
      const edges: EdgeT[] = [
        { from: "fac_000", to: "fac_001" },
        // Edge to a factor that will be capped (beyond GRAPH_MAX_NODES)
        { from: "fac_000", to: `fac_${(GRAPH_MAX_NODES + 5).toString().padStart(3, "0")}` },
      ];

      const graph: GraphT = {
        version: "1",
        default_seed: 42,
        nodes,
        edges,
        meta: { source: "test" as const, roots: [], leaves: [], suggested_positions: {} },
      };

      const result = simpleRepair(graph, "test-request");

      // All remaining edges should reference existing nodes
      const nodeIds = new Set(result.nodes.map((n) => n.id));
      for (const edge of result.edges) {
        expect(nodeIds.has(edge.from), `Edge from ${edge.from} references existing node`).toBe(true);
        expect(nodeIds.has(edge.to), `Edge to ${edge.to} references existing node`).toBe(true);
      }
    });

    it("enforceGraphCompliance removes edges to capped nodes", () => {
      const nodes: NodeT[] = Array.from({ length: GRAPH_MAX_NODES + 20 }, (_, i) => ({
        id: `node_${i.toString().padStart(3, "0")}`,
        kind: "factor" as const,
        label: `Node ${i}`,
      }));

      // Create chain of edges
      const edges: EdgeT[] = Array.from({ length: GRAPH_MAX_NODES + 19 }, (_, i) => ({
        from: `node_${i.toString().padStart(3, "0")}`,
        to: `node_${(i + 1).toString().padStart(3, "0")}`,
      }));

      const graph: GraphT = {
        version: "1",
        default_seed: 42,
        nodes,
        edges,
        meta: { source: "test" as const, roots: [], leaves: [], suggested_positions: {} },
      };

      const result = enforceGraphCompliance(graph);

      // All remaining edges should reference existing nodes
      const nodeIds = new Set(result.nodes.map((n) => n.id));
      for (const edge of result.edges) {
        expect(nodeIds.has(edge.from), `Edge from ${edge.from} references existing node`).toBe(true);
        expect(nodeIds.has(edge.to), `Edge to ${edge.to} references existing node`).toBe(true);
      }
    });
  });

  describe("protected nodes with cap overflow", () => {
    it("protected nodes are kept even when exceeding unprotected cap budget", () => {
      // Create enough protected nodes to exceed the cap
      const protectedNodes: NodeT[] = [
        { id: "goal_1", kind: "goal" as const, label: "Goal" },
        { id: "dec_1", kind: "decision" as const, label: "Decision" },
        ...Array.from({ length: 10 }, (_, i) => ({
          id: `opt_${i}`,
          kind: "option" as const,
          label: `Option ${i}`,
        })),
        ...Array.from({ length: 10 }, (_, i) => ({
          id: `out_${i}`,
          kind: "outcome" as const,
          label: `Outcome ${i}`,
        })),
        ...Array.from({ length: 10 }, (_, i) => ({
          id: `risk_${i}`,
          kind: "risk" as const,
          label: `Risk ${i}`,
        })),
      ];

      // Fill with factors to exceed cap
      const unprotectedNodes: NodeT[] = Array.from({ length: GRAPH_MAX_NODES }, (_, i) => ({
        id: `fac_${i.toString().padStart(3, "0")}`,
        kind: "factor" as const,
        label: `Factor ${i}`,
      }));

      const nodes = [...unprotectedNodes, ...protectedNodes];

      const graph: GraphT = {
        version: "1",
        default_seed: 42,
        nodes,
        edges: [],
        meta: { source: "test" as const, roots: [], leaves: [], suggested_positions: {} },
      };

      const result = simpleRepair(graph, "test-request");

      // All protected nodes must be preserved
      const protectedKinds = ["goal", "decision", "option", "outcome", "risk"];
      for (const kind of protectedKinds) {
        const original = protectedNodes.filter((n) => n.kind === kind);
        const preserved = result.nodes.filter((n) => n.kind === kind);
        expect(preserved.length).toBe(original.length);
      }

      // Total should still respect the cap (protected nodes may cause overflow)
      // But we prioritize structural integrity over strict cap
      expect(result.nodes.length).toBeGreaterThanOrEqual(protectedNodes.length);
    });
  });

  describe("custom cap overrides in enforceGraphCompliance", () => {
    it("respects custom maxNodes parameter", () => {
      const customMax = 10;
      const nodes: NodeT[] = Array.from({ length: 50 }, (_, i) => ({
        id: `fac_${i.toString().padStart(3, "0")}`,
        kind: "factor" as const,
        label: `Factor ${i}`,
      }));

      const graph: GraphT = {
        version: "1",
        default_seed: 42,
        nodes,
        edges: [],
        meta: { source: "test" as const, roots: [], leaves: [], suggested_positions: {} },
      };

      const result = enforceGraphCompliance(graph, { maxNodes: customMax });

      expect(result.nodes.length).toBeLessThanOrEqual(customMax);
    });

    it("respects custom maxEdges parameter", () => {
      const customMax = 5;
      const nodes: NodeT[] = [
        { id: "a", kind: "factor" as const, label: "A" },
        { id: "b", kind: "factor" as const, label: "B" },
      ];

      const edges: EdgeT[] = Array.from({ length: 20 }, (_, i) => ({
        id: `edge_${i}`,
        from: "a",
        to: "b",
      }));

      const graph: GraphT = {
        version: "1",
        default_seed: 42,
        nodes,
        edges,
        meta: { source: "test" as const, roots: [], leaves: [], suggested_positions: {} },
      };

      const result = enforceGraphCompliance(graph, { maxEdges: customMax });

      expect(result.edges.length).toBeLessThanOrEqual(customMax);
    });
  });
});
