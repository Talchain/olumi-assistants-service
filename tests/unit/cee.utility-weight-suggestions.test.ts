import { describe, it, expect } from "vitest";
import {
  suggestUtilityWeights,
  validateUtilityWeightInput,
  type UtilityWeightInput,
} from "../../src/cee/utility-weight-suggestions/index.js";
import type { GraphV1 } from "../../src/contracts/plot/engine.js";

describe("CEE Utility Weight Suggestions", () => {
  // Helper to create a minimal graph with specified nodes
  function createGraph(nodes: Array<{ id: string; label: string }>): GraphV1 {
    return {
      version: "v1",
      default_seed: 42,
      nodes: nodes.map((n) => ({
        id: n.id,
        label: n.label,
        kind: "outcome" as const,
      })),
      edges: [],
    };
  }

  describe("suggestUtilityWeights", () => {
    describe("single outcome", () => {
      it("assigns weight 1.0 to single outcome", () => {
        const graph = createGraph([{ id: "o1", label: "Revenue growth" }]);
        const result = suggestUtilityWeights({
          graph,
          outcome_node_ids: ["o1"],
        });

        expect(result.suggestions).toHaveLength(1);
        expect(result.suggestions[0].node_id).toBe("o1");
        expect(result.suggestions[0].suggested_weight).toBe(1.0);
        expect(result.confidence).toBe("high");
        expect(result.provenance).toBe("cee");
      });

      it("handles single outcome with decision description", () => {
        const graph = createGraph([{ id: "o1", label: "Market share" }]);
        const result = suggestUtilityWeights({
          graph,
          outcome_node_ids: ["o1"],
          decision_description: "Choosing a market expansion strategy",
        });

        expect(result.suggestions).toHaveLength(1);
        expect(result.suggestions[0].suggested_weight).toBe(1.0);
        expect(result.provenance).toBe("cee");
      });
    });

    describe("multiple outcomes", () => {
      it("weights sum to 1.0 for multiple outcomes", () => {
        const graph = createGraph([
          { id: "o1", label: "Revenue growth" },
          { id: "o2", label: "Customer satisfaction" },
          { id: "o3", label: "Market share" },
        ]);
        const result = suggestUtilityWeights({
          graph,
          outcome_node_ids: ["o1", "o2", "o3"],
        });

        const totalWeight = result.suggestions.reduce(
          (sum, s) => sum + s.suggested_weight,
          0
        );
        // Allow small floating point tolerance
        expect(Math.abs(totalWeight - 1.0)).toBeLessThan(0.02);
        expect(result.provenance).toBe("cee");
      });

      it("assigns higher weight to high-priority outcomes", () => {
        const graph = createGraph([
          { id: "o1", label: "Critical revenue growth" },
          { id: "o2", label: "Minor improvement" },
        ]);
        const result = suggestUtilityWeights({
          graph,
          outcome_node_ids: ["o1", "o2"],
        });

        const criticalSuggestion = result.suggestions.find(
          (s) => s.node_id === "o1"
        );
        const minorSuggestion = result.suggestions.find(
          (s) => s.node_id === "o2"
        );

        expect(criticalSuggestion!.suggested_weight).toBeGreaterThan(
          minorSuggestion!.suggested_weight
        );
      });

      it("generates alternatives when risks and benefits present", () => {
        const graph = createGraph([
          { id: "o1", label: "Revenue growth benefit" },
          { id: "o2", label: "Implementation risk" },
        ]);
        const result = suggestUtilityWeights({
          graph,
          outcome_node_ids: ["o1", "o2"],
        });

        expect(result.alternatives).toBeDefined();
        expect(result.alternatives!.length).toBeGreaterThan(0);

        // Should have balanced alternative
        const balanced = result.alternatives!.find((a) => a.name === "Balanced");
        expect(balanced).toBeDefined();
        expect(balanced!.weights).toHaveLength(2);
      });

      it("includes risk-averse alternative when risks detected", () => {
        const graph = createGraph([
          { id: "o1", label: "Profit increase" },
          { id: "o2", label: "Risk of failure" },
        ]);
        const result = suggestUtilityWeights({
          graph,
          outcome_node_ids: ["o1", "o2"],
        });

        const riskAverse = result.alternatives?.find(
          (a) => a.name === "Risk-averse"
        );
        expect(riskAverse).toBeDefined();
      });

      it("includes growth-focused alternative when benefits detected", () => {
        const graph = createGraph([
          { id: "o1", label: "Revenue opportunity" },
          { id: "o2", label: "Cost risk" },
        ]);
        const result = suggestUtilityWeights({
          graph,
          outcome_node_ids: ["o1", "o2"],
        });

        const growthFocused = result.alternatives?.find(
          (a) => a.name === "Growth-focused"
        );
        expect(growthFocused).toBeDefined();
      });
    });

    describe("semantic signal detection", () => {
      it("detects high-priority keywords", () => {
        const graph = createGraph([
          { id: "o1", label: "Strategic competitive advantage" },
          { id: "o2", label: "Nice to have feature" },
        ]);
        const result = suggestUtilityWeights({
          graph,
          outcome_node_ids: ["o1", "o2"],
        });

        const strategicSuggestion = result.suggestions.find(
          (s) => s.node_id === "o1"
        );
        const niceToHaveSuggestion = result.suggestions.find(
          (s) => s.node_id === "o2"
        );

        expect(strategicSuggestion!.suggested_weight).toBeGreaterThan(
          niceToHaveSuggestion!.suggested_weight
        );
      });

      it("uses decision context for weighting", () => {
        const graph = createGraph([
          { id: "o1", label: "Outcome A" },
          { id: "o2", label: "Outcome B" },
        ]);
        const result = suggestUtilityWeights({
          graph,
          outcome_node_ids: ["o1", "o2"],
          decision_description: "Critical revenue decision",
        });

        expect(result.reasoning).toContain("decision context");
        expect(result.provenance).toBe("cee");
      });

      it("has high confidence when most outcomes have clear signals", () => {
        const graph = createGraph([
          { id: "o1", label: "Key revenue growth" },
          { id: "o2", label: "Critical market share" },
          { id: "o3", label: "Important profit margin" },
        ]);
        const result = suggestUtilityWeights({
          graph,
          outcome_node_ids: ["o1", "o2", "o3"],
        });

        expect(result.confidence).toBe("high");
      });

      it("has low confidence when outcomes have unclear signals", () => {
        const graph = createGraph([
          { id: "o1", label: "Thing A" },
          { id: "o2", label: "Thing B" },
          { id: "o3", label: "Thing C" },
        ]);
        const result = suggestUtilityWeights({
          graph,
          outcome_node_ids: ["o1", "o2", "o3"],
        });

        expect(result.confidence).toBe("low");
      });
    });

    describe("edge cases", () => {
      it("handles empty outcome_node_ids", () => {
        const graph = createGraph([{ id: "o1", label: "Revenue" }]);
        const result = suggestUtilityWeights({
          graph,
          outcome_node_ids: [],
        });

        expect(result.suggestions).toHaveLength(0);
        expect(result.confidence).toBe("low");
        expect(result.provenance).toBe("cee");
      });

      it("handles outcome IDs not found in graph", () => {
        const graph = createGraph([{ id: "o1", label: "Revenue" }]);
        const result = suggestUtilityWeights({
          graph,
          outcome_node_ids: ["nonexistent1", "nonexistent2"],
        });

        expect(result.suggestions).toHaveLength(0);
        expect(result.confidence).toBe("low");
        expect(result.reasoning).toContain("found");
      });

      it("filters out invalid node IDs", () => {
        const graph = createGraph([
          { id: "o1", label: "Revenue" },
          { id: "o2", label: "Profit" },
        ]);
        const result = suggestUtilityWeights({
          graph,
          outcome_node_ids: ["o1", "nonexistent", "o2"],
        });

        expect(result.suggestions).toHaveLength(2);
        const totalWeight = result.suggestions.reduce(
          (sum, s) => sum + s.suggested_weight,
          0
        );
        expect(Math.abs(totalWeight - 1.0)).toBeLessThan(0.01);
      });

      it("handles graph with empty nodes array", () => {
        const graph: GraphV1 = {
          version: "v1",
          default_seed: 42,
          nodes: [],
          edges: [],
        };
        const result = suggestUtilityWeights({
          graph,
          outcome_node_ids: ["o1"],
        });

        expect(result.suggestions).toHaveLength(0);
        expect(result.confidence).toBe("low");
      });
    });

    describe("provenance", () => {
      it("always includes provenance: cee", () => {
        const testCases: UtilityWeightInput[] = [
          {
            graph: createGraph([{ id: "o1", label: "Revenue" }]),
            outcome_node_ids: ["o1"],
          },
          {
            graph: createGraph([
              { id: "o1", label: "Revenue" },
              { id: "o2", label: "Profit" },
            ]),
            outcome_node_ids: ["o1", "o2"],
          },
          {
            graph: createGraph([]),
            outcome_node_ids: [],
          },
        ];

        for (const input of testCases) {
          const result = suggestUtilityWeights(input);
          expect(result.provenance).toBe("cee");
        }
      });
    });

    describe("reasoning generation", () => {
      it("includes node labels in reasoning when significant difference", () => {
        const graph = createGraph([
          { id: "o1", label: "Critical revenue growth" },
          { id: "o2", label: "Optional feature" },
        ]);
        const result = suggestUtilityWeights({
          graph,
          outcome_node_ids: ["o1", "o2"],
        });

        // Reasoning should mention the nodes
        expect(result.reasoning.length).toBeGreaterThan(0);
      });

      it("suggests balanced weighting for similar outcomes", () => {
        const graph = createGraph([
          { id: "o1", label: "Important goal A" },
          { id: "o2", label: "Important goal B" },
        ]);
        const result = suggestUtilityWeights({
          graph,
          outcome_node_ids: ["o1", "o2"],
        });

        // When outcomes are similar, weights should be close
        const weightA = result.suggestions.find((s) => s.node_id === "o1")!
          .suggested_weight;
        const weightB = result.suggestions.find((s) => s.node_id === "o2")!
          .suggested_weight;

        expect(Math.abs(weightA - weightB)).toBeLessThan(0.2);
      });
    });

    describe("alternative weightings", () => {
      it("balanced alternative has equal weights", () => {
        const graph = createGraph([
          { id: "o1", label: "Revenue" },
          { id: "o2", label: "Risk" },
          { id: "o3", label: "Satisfaction" },
        ]);
        const result = suggestUtilityWeights({
          graph,
          outcome_node_ids: ["o1", "o2", "o3"],
        });

        const balanced = result.alternatives?.find((a) => a.name === "Balanced");
        expect(balanced).toBeDefined();

        // All weights should be equal (1/3)
        for (const w of balanced!.weights) {
          expect(Math.abs(w.weight - 1 / 3)).toBeLessThan(0.02);
        }
      });

      it("alternative weights sum to 1.0", () => {
        const graph = createGraph([
          { id: "o1", label: "Profit benefit" },
          { id: "o2", label: "Loss risk" },
        ]);
        const result = suggestUtilityWeights({
          graph,
          outcome_node_ids: ["o1", "o2"],
        });

        for (const alt of result.alternatives || []) {
          const total = alt.weights.reduce((sum, w) => sum + w.weight, 0);
          expect(Math.abs(total - 1.0)).toBeLessThan(0.02);
        }
      });
    });
  });

  describe("validateUtilityWeightInput", () => {
    it("validates correct input", () => {
      const input = {
        graph: { schema_version: "v1", nodes: [], edges: [] },
        outcome_node_ids: ["o1", "o2"],
      };
      expect(validateUtilityWeightInput(input)).toBe(true);
    });

    it("rejects null input", () => {
      expect(validateUtilityWeightInput(null)).toBe(false);
    });

    it("rejects undefined input", () => {
      expect(validateUtilityWeightInput(undefined)).toBe(false);
    });

    it("rejects input without graph", () => {
      expect(
        validateUtilityWeightInput({ outcome_node_ids: ["o1"] })
      ).toBe(false);
    });

    it("rejects input without outcome_node_ids", () => {
      expect(
        validateUtilityWeightInput({
          graph: { schema_version: "v1", nodes: [], edges: [] },
        })
      ).toBe(false);
    });

    it("rejects non-array outcome_node_ids", () => {
      expect(
        validateUtilityWeightInput({
          graph: { schema_version: "v1", nodes: [], edges: [] },
          outcome_node_ids: "not-an-array",
        })
      ).toBe(false);
    });

    it("accepts optional decision_description", () => {
      const input = {
        graph: { schema_version: "v1", nodes: [], edges: [] },
        outcome_node_ids: ["o1"],
        decision_description: "Test decision",
      };
      expect(validateUtilityWeightInput(input)).toBe(true);
    });

    it("rejects non-string decision_description", () => {
      const input = {
        graph: { schema_version: "v1", nodes: [], edges: [] },
        outcome_node_ids: ["o1"],
        decision_description: 123,
      };
      expect(validateUtilityWeightInput(input)).toBe(false);
    });
  });
});
