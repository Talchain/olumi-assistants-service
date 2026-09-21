/**
 * INVARIANT: Protected node kinds must never be silently removed
 * DISCOVERED: PROTECTED_KINDS mismatch between repair.ts and graphGuards.ts
 *
 * This test ensures that:
 * 1. All PROTECTED_KINDS definitions are identical across the codebase
 * 2. All structurally required kinds are included
 * 3. Protected kinds survive all capping/pruning operations
 */

import { describe, it, expect } from "vitest";
import { simpleRepair } from "../../../src/services/repair.js";
import { pruneIsolatedNodes, enforceGraphCompliance } from "../../../src/utils/graphGuards.js";
import { GRAPH_MAX_NODES } from "../../../src/config/graphCaps.js";
import type { GraphT, NodeT, EdgeT } from "../../../src/schemas/graph.js";

/**
 * The canonical list of protected kinds.
 * These are structurally required for a valid decision graph.
 */
const REQUIRED_PROTECTED_KINDS = ["goal", "decision", "option", "outcome", "risk", "factor"] as const;

describe("CEE Protected Kinds Invariant", () => {
  describe("PROTECTED_KINDS consistency", () => {
    it("simpleRepair protects all required kinds", () => {
      // Create a graph where protected kinds are at the END (worst case for slice)
      // Use "action" kind which is NOT in PROTECTED_KINDS
      const unprotectedNodes: NodeT[] = Array.from({ length: 60 }, (_, i) => ({
        id: `act_${i.toString().padStart(3, "0")}`,
        kind: "action" as const,
        label: `Action ${i}`,
      }));

      const protectedNodes: NodeT[] = REQUIRED_PROTECTED_KINDS.map((kind, _i) => ({
        id: `${kind}_1`,
        kind: kind as any,
        label: `${kind} node`,
      }));

      // Put protected nodes at the end
      const allNodes = [...unprotectedNodes, ...protectedNodes];

      const edges: EdgeT[] = [
        { from: "decision_1", to: "option_1" },
        { from: "option_1", to: "act_000" },
        { from: "act_000", to: "outcome_1" },
        { from: "outcome_1", to: "goal_1" },
      ];

      const graph: GraphT = {
        version: "1",
        default_seed: 42,
        nodes: allNodes,
        edges,
        meta: { source: "test" as const, roots: [], leaves: [], suggested_positions: {} },
      };

      const result = simpleRepair(graph, "test-request");

      // All protected kinds must survive
      for (const kind of REQUIRED_PROTECTED_KINDS) {
        const hasKind = result.nodes.some((n) => n.kind === kind);
        expect(hasKind, `Protected kind "${kind}" must survive simpleRepair`).toBe(true);
      }

      // Total nodes should not exceed GRAPH_MAX_NODES
      expect(result.nodes.length).toBeLessThanOrEqual(GRAPH_MAX_NODES);
    });

    it("pruneIsolatedNodes protects all required kinds", () => {
      // Create isolated nodes of each protected kind
      const nodes: NodeT[] = REQUIRED_PROTECTED_KINDS.map((kind) => ({
        id: `isolated_${kind}`,
        kind: kind as any,
        label: `Isolated ${kind}`,
      }));

      // Add one non-protected isolated node (action is NOT in PROTECTED_KINDS)
      nodes.push({
        id: "isolated_action",
        kind: "action" as const,
        label: "Isolated action",
      });

      // No edges - all nodes are isolated
      const edges: EdgeT[] = [];

      const result = pruneIsolatedNodes(nodes, edges);

      // All protected kinds must survive even when isolated
      for (const kind of REQUIRED_PROTECTED_KINDS) {
        const hasKind = result.some((n) => n.kind === kind);
        expect(hasKind, `Protected kind "${kind}" must survive pruning even when isolated`).toBe(true);
      }

      // Non-protected isolated node should be pruned
      expect(result.some((n) => n.id === "isolated_action")).toBe(false);
    });

    it("enforceGraphCompliance protects all required kinds", () => {
      // Create a graph with protected kinds that might be pruned
      const nodes: NodeT[] = [
        ...REQUIRED_PROTECTED_KINDS.map((kind) => ({
          id: `${kind}_1`,
          kind: kind as any,
          label: `${kind} node`,
        })),
        // Add a factor (protected) and an action (unprotected)
        { id: "factor_1", kind: "factor" as const, label: "Factor 1" },
        { id: "action_1", kind: "action" as const, label: "Action 1" },
      ];

      // Edges that connect some but not all nodes
      const edges: EdgeT[] = [
        { from: "decision_1", to: "option_1" },
        { from: "option_1", to: "factor_1" },
        { from: "factor_1", to: "outcome_1" },
        { from: "outcome_1", to: "goal_1" },
        // risk_1 and action_1 are isolated
      ];

      const graph: GraphT = {
        version: "1",
        default_seed: 42,
        nodes,
        edges,
        meta: { source: "test" as const, roots: [], leaves: [], suggested_positions: {} },
      };

      const result = enforceGraphCompliance(graph);

      // All protected kinds must survive
      for (const kind of REQUIRED_PROTECTED_KINDS) {
        const hasKind = result.nodes.some((n) => n.kind === kind);
        expect(hasKind, `Protected kind "${kind}" must survive enforceGraphCompliance`).toBe(true);
      }

      // Non-protected isolated node (action_1) should be pruned
      expect(result.nodes.some((n) => n.id === "action_1")).toBe(false);
    });
  });

  describe("edge preservation with protected nodes", () => {
    it("dangling edge filter removes edges to capped nodes", () => {
      // This documents expected behavior: when nodes are capped,
      // edges to those nodes become dangling and are removed
      const nodes: NodeT[] = Array.from({ length: 100 }, (_, i) => ({
        id: `node_${i.toString().padStart(3, "0")}`,
        kind: "factor" as const,
        label: `Node ${i}`,
      }));

      // Add edges between consecutive nodes
      const edges: EdgeT[] = Array.from({ length: 99 }, (_, i) => ({
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

      const result = enforceGraphCompliance(graph, { maxNodes: 50 });

      // Nodes beyond 50 should be removed
      expect(result.nodes.length).toBeLessThanOrEqual(50);

      // Edges to removed nodes should also be removed
      const nodeIds = new Set(result.nodes.map((n) => n.id));
      for (const edge of result.edges) {
        expect(nodeIds.has(edge.from), `Edge from ${edge.from} references existing node`).toBe(true);
        expect(nodeIds.has(edge.to), `Edge to ${edge.to} references existing node`).toBe(true);
      }
    });
  });
});
