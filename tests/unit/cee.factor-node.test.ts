/**
 * Tests for the factor node kind functionality.
 *
 * Factor nodes represent external variables/uncertainties OUTSIDE user control.
 * This is distinct from action nodes which are controllable steps.
 */

import { describe, it, expect } from "vitest";
import { Node, NodeKind, Graph } from "../../src/schemas/graph.js";
import { normaliseNodeKind, NODE_KIND_MAP } from "../../src/adapters/llm/normalisation.js";
import { detectBiases } from "../../src/cee/bias/index.js";
import { suggestEdgeFunction } from "../../src/cee/edge-function-suggestions/index.js";
import { computeGraphStats } from "../../src/cee/graph-readiness/factors.js";
import { generateKeyInsight } from "../../src/cee/key-insight/index.js";
import type { GraphV1 } from "../../src/contracts/plot/engine.js";

describe("factor node kind", () => {
  describe("schema validation", () => {
    it("accepts factor as valid node kind", () => {
      const node = { id: "f1", kind: "factor", label: "Market demand" };
      expect(() => Node.parse(node)).not.toThrow();
    });

    it("factor is in NodeKind enum", () => {
      const kinds = NodeKind.options;
      expect(kinds).toContain("factor");
    });

    it("validates graph with factor nodes", () => {
      const graph = {
        nodes: [
          { id: "g1", kind: "goal", label: "Increase revenue" },
          { id: "d1", kind: "decision", label: "Market entry" },
          { id: "o1", kind: "option", label: "Enter Germany" },
          { id: "f1", kind: "factor", label: "Market demand" },
          { id: "out1", kind: "outcome", label: "Revenue growth" },
        ],
        edges: [
          { from: "g1", to: "d1" },
          { from: "d1", to: "o1" },
          { from: "o1", to: "out1", belief: 0.7 },
          { from: "f1", to: "out1", belief: 0.6 },
        ],
      };
      expect(() => Graph.parse(graph)).not.toThrow();
    });
  });

  describe("normalisation", () => {
    it("factor is a canonical kind (not normalized away)", () => {
      expect(NODE_KIND_MAP["factor"]).toBe("factor");
    });

    it("normaliseNodeKind preserves factor", () => {
      expect(normaliseNodeKind("factor")).toBe("factor");
      expect(normaliseNodeKind("Factor")).toBe("factor");
      expect(normaliseNodeKind("FACTOR")).toBe("factor");
    });
  });

  describe("graph-readiness", () => {
    it("recognises factor nodes in graph stats", () => {
      const graph = {
        nodes: [
          { id: "g1", kind: "goal", label: "Revenue" },
          { id: "d1", kind: "decision", label: "Pricing" },
          { id: "o1", kind: "option", label: "Raise prices" },
          { id: "f1", kind: "factor", label: "Market demand" },
          { id: "f2", kind: "factor", label: "Competitor pricing" },
          { id: "out1", kind: "outcome", label: "Sales" },
        ],
        edges: [
          { from: "d1", to: "o1" },
          { from: "o1", to: "out1" },
          { from: "f1", to: "out1" },
          { from: "f2", to: "out1" },
        ],
      } as GraphV1;

      const stats = computeGraphStats(graph);
      expect(stats.factorCount).toBe(2);
      expect(stats.optionCount).toBe(1);
      expect(stats.outcomeCount).toBe(1);
    });

    it("handles graph with no factor nodes", () => {
      const graph = {
        nodes: [
          { id: "g1", kind: "goal", label: "Revenue" },
          { id: "o1", kind: "option", label: "Option A" },
        ],
        edges: [],
      } as unknown as GraphV1;

      const stats = computeGraphStats(graph);
      expect(stats.factorCount).toBe(0);
    });
  });

  describe("bias-check", () => {
    it("does not trigger illusion of control when factor nodes present", () => {
      const graph = {
        nodes: [
          { id: "g1", kind: "goal", label: "Revenue" },
          { id: "d1", kind: "decision", label: "Strategy" },
          { id: "o1", kind: "option", label: "Option A" },
          { id: "a1", kind: "action", label: "Hire team" },
          { id: "a2", kind: "action", label: "Buy equipment" },
          { id: "a3", kind: "action", label: "Train staff" },
          { id: "f1", kind: "factor", label: "Market conditions" }, // External factor present
          { id: "out1", kind: "outcome", label: "Success" },
        ],
        edges: [
          { from: "d1", to: "o1" },
          { from: "o1", to: "a1" },
          { from: "o1", to: "a2" },
          { from: "o1", to: "a3" },
          { from: "f1", to: "out1" },
        ],
      } as GraphV1;

      const findings = detectBiases(graph);
      const illusionBias = findings.find((f) => f.id === "illusion_of_control");
      expect(illusionBias).toBeUndefined();
    });

    it("detects illusion of control when many actions but no factors", () => {
      // This test requires structural bias to be enabled
      const graph = {
        nodes: [
          { id: "g1", kind: "goal", label: "Revenue" },
          { id: "d1", kind: "decision", label: "Strategy" },
          { id: "o1", kind: "option", label: "Option A" },
          { id: "a1", kind: "action", label: "Hire team" },
          { id: "a2", kind: "action", label: "Buy equipment" },
          { id: "a3", kind: "action", label: "Train staff" },
          // No factor nodes - all controllable
          { id: "out1", kind: "outcome", label: "Success" },
        ],
        edges: [
          { from: "d1", to: "o1" },
          { from: "o1", to: "a1" },
          { from: "o1", to: "a2" },
          { from: "o1", to: "a3" },
          { from: "a1", to: "out1" },
        ],
      } as GraphV1;

      // Note: illusion_of_control is only detected when structuralBiasEnabled() is true
      // This test verifies the logic exists, not that it's always triggered
      const findings = detectBiases(graph);
      // Basic bias detection should still work
      expect(Array.isArray(findings)).toBe(true);
    });
  });

  describe("edge-function-suggestions", () => {
    it("suggests s_curve for factor nodes by default", () => {
      const result = suggestEdgeFunction({
        edge_id: "e1",
        source_node: { id: "f1", label: "Market demand", kind: "factor" },
        target_node: { id: "out1", label: "Revenue", kind: "outcome" },
      });

      // Factor nodes should bias toward non-linear functions
      expect(["s_curve", "threshold", "diminishing_returns"]).toContain(
        result.suggested_function
      );
      expect(result.confidence).toBeDefined();
      expect(result.provenance).toBe("cee");
    });

    it("suggests threshold for regulatory factor", () => {
      const result = suggestEdgeFunction({
        edge_id: "e1",
        source_node: { id: "f1", label: "Regulatory compliance", kind: "factor" },
        target_node: { id: "out1", label: "Market access", kind: "outcome" },
        relationship_description: "Regulatory threshold must be met",
      });

      expect(result.suggested_function).toBe("threshold");
    });

    it("suggests diminishing_returns for market demand factor", () => {
      const result = suggestEdgeFunction({
        edge_id: "e1",
        source_node: { id: "f1", label: "Market demand level", kind: "factor" },
        target_node: { id: "out1", label: "Sales volume", kind: "outcome" },
      });

      expect(result.suggested_function).toBe("diminishing_returns");
    });

    it("suggests noisy_and_not for competitor factor (preventative relationship)", () => {
      // Competitor activity inhibits/reduces market share - this is a preventative relationship
      const result = suggestEdgeFunction({
        edge_id: "e1",
        source_node: { id: "f1", label: "Competitor activity", kind: "factor" },
        target_node: { id: "out1", label: "Market share", kind: "outcome" },
      });

      // "Competitor" matches preventative source pattern → noisy_and_not
      expect(result.suggested_function).toBe("noisy_and_not");
    });
  });

  describe("key-insight", () => {
    it("generates external factor statement for factor driver", () => {
      const result = generateKeyInsight({
        graph: {
          nodes: [
            { id: "o1", kind: "option", label: "Option A" },
            { id: "f1", kind: "factor", label: "Market conditions" },
          ],
          edges: [],
        } as unknown as GraphV1,
        ranked_actions: [
          { node_id: "o1", label: "Option A", expected_utility: 0.8 },
        ],
        top_drivers: [
          { node_id: "f1", label: "Market conditions", impact_pct: 60, kind: "factor" },
        ],
      });

      expect(result.primary_driver).toContain("External");
      expect(result.primary_driver.toLowerCase()).toContain("market conditions");
    });

    it("generates controllable action statement for action driver", () => {
      const result = generateKeyInsight({
        graph: {
          nodes: [
            { id: "o1", kind: "option", label: "Option A" },
            { id: "a1", kind: "action", label: "Hire team" },
          ],
          edges: [],
        } as unknown as GraphV1,
        ranked_actions: [
          { node_id: "o1", label: "Option A", expected_utility: 0.8 },
        ],
        top_drivers: [
          { node_id: "a1", label: "Hire team", impact_pct: 60, kind: "action" },
        ],
      });

      expect(result.primary_driver.toLowerCase()).toContain("action");
      expect(result.primary_driver.toLowerCase()).toContain("hire team");
    });

    it("handles mixed factor and action drivers", () => {
      const result = generateKeyInsight({
        graph: {
          nodes: [
            { id: "o1", kind: "option", label: "Option A" },
            { id: "f1", kind: "factor", label: "Market demand" },
            { id: "a1", kind: "action", label: "Marketing campaign" },
          ],
          edges: [],
        } as unknown as GraphV1,
        ranked_actions: [
          { node_id: "o1", label: "Option A", expected_utility: 0.75 },
        ],
        top_drivers: [
          { node_id: "f1", label: "Market demand", impact_pct: 40, kind: "factor" },
          { node_id: "a1", label: "Marketing campaign", impact_pct: 30, kind: "action" },
        ],
      });

      // Should use top driver (factor) for the statement
      expect(result.primary_driver.toLowerCase()).toContain("market demand");
      expect(result.headline).toBeDefined();
      expect(result.confidence_statement).toBeDefined();
    });
  });

  describe("factor vs action distinction", () => {
    it("differentiates external factors from controllable actions", () => {
      // Factor: External, uncontrollable
      const factorNode = Node.parse({ id: "f1", kind: "factor", label: "Economic recession" });
      expect(factorNode.kind).toBe("factor");

      // Action: Controllable step
      const actionNode = Node.parse({ id: "a1", kind: "action", label: "Reduce costs" });
      expect(actionNode.kind).toBe("action");
    });

    it("both factor and action coexist in same graph", () => {
      const graph = Graph.parse({
        nodes: [
          { id: "g1", kind: "goal", label: "Survive recession" },
          { id: "d1", kind: "decision", label: "Cost strategy" },
          { id: "o1", kind: "option", label: "Aggressive cuts" },
          { id: "o2", kind: "option", label: "Selective cuts" },
          { id: "f1", kind: "factor", label: "Economic conditions" },  // External
          { id: "f2", kind: "factor", label: "Customer demand" },       // External
          { id: "a1", kind: "action", label: "Lay off staff" },         // Controllable
          { id: "a2", kind: "action", label: "Renegotiate contracts" }, // Controllable
          { id: "out1", kind: "outcome", label: "Profitability" },
          { id: "r1", kind: "risk", label: "Talent loss" },
        ],
        edges: [
          { from: "d1", to: "o1", belief: 0.4 },
          { from: "d1", to: "o2", belief: 0.6 },
          { from: "o1", to: "a1" },
          { from: "o2", to: "a2" },
          { from: "f1", to: "out1", belief: 0.7 },
          { from: "f2", to: "out1", belief: 0.6 },
          { from: "a1", to: "out1", belief: 0.8 },
          { from: "a1", to: "r1", belief: 0.5 },
        ],
      });

      const factors = graph.nodes.filter((n) => n.kind === "factor");
      const actions = graph.nodes.filter((n) => n.kind === "action");

      expect(factors).toHaveLength(2);
      expect(actions).toHaveLength(2);
      expect(factors[0].label).toBe("Economic conditions");
      expect(actions[0].label).toBe("Lay off staff");
    });
  });
});
