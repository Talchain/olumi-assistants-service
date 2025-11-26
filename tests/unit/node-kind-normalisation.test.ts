import { describe, it, expect } from "vitest";
import { normaliseNodeKind, normaliseDraftResponse } from "../../src/adapters/llm/normalisation.js";

describe("NodeKind Normalisation", () => {
  describe("normaliseNodeKind", () => {
    it("passes through canonical kinds unchanged", () => {
      expect(normaliseNodeKind("goal")).toBe("goal");
      expect(normaliseNodeKind("decision")).toBe("decision");
      expect(normaliseNodeKind("option")).toBe("option");
      expect(normaliseNodeKind("outcome")).toBe("outcome");
      expect(normaliseNodeKind("risk")).toBe("risk");
      expect(normaliseNodeKind("action")).toBe("action");
    });

    it("normalises case-insensitive input", () => {
      expect(normaliseNodeKind("GOAL")).toBe("goal");
      expect(normaliseNodeKind("Decision")).toBe("decision");
      expect(normaliseNodeKind("OPTION")).toBe("option");
    });

    it("trims whitespace", () => {
      expect(normaliseNodeKind(" goal ")).toBe("goal");
      expect(normaliseNodeKind("  decision  ")).toBe("decision");
    });

    it("maps evidence-like kinds to option", () => {
      expect(normaliseNodeKind("evidence")).toBe("option");
      expect(normaliseNodeKind("factor")).toBe("option");
      expect(normaliseNodeKind("consideration")).toBe("option");
      expect(normaliseNodeKind("alternative")).toBe("option");
      expect(normaliseNodeKind("choice")).toBe("option");
      expect(normaliseNodeKind("input")).toBe("option");
      expect(normaliseNodeKind("criteria")).toBe("option");
      expect(normaliseNodeKind("criterion")).toBe("option");
    });

    it("maps constraint-like kinds to risk", () => {
      expect(normaliseNodeKind("constraint")).toBe("risk");
      expect(normaliseNodeKind("issue")).toBe("risk");
      expect(normaliseNodeKind("threat")).toBe("risk");
      expect(normaliseNodeKind("problem")).toBe("risk");
      expect(normaliseNodeKind("concern")).toBe("risk");
      expect(normaliseNodeKind("challenge")).toBe("risk");
      expect(normaliseNodeKind("blocker")).toBe("risk");
    });

    it("maps benefit-like kinds to outcome", () => {
      expect(normaliseNodeKind("benefit")).toBe("outcome");
      expect(normaliseNodeKind("result")).toBe("outcome");
      expect(normaliseNodeKind("consequence")).toBe("outcome");
      expect(normaliseNodeKind("impact")).toBe("outcome");
      expect(normaliseNodeKind("effect")).toBe("outcome");
      expect(normaliseNodeKind("reward")).toBe("outcome");
    });

    it("maps objective-like kinds to goal", () => {
      expect(normaliseNodeKind("objective")).toBe("goal");
      expect(normaliseNodeKind("target")).toBe("goal");
      expect(normaliseNodeKind("aim")).toBe("goal");
      expect(normaliseNodeKind("purpose")).toBe("goal");
    });

    it("maps step-like kinds to action", () => {
      expect(normaliseNodeKind("step")).toBe("action");
      expect(normaliseNodeKind("task")).toBe("action");
      expect(normaliseNodeKind("activity")).toBe("action");
      expect(normaliseNodeKind("measure")).toBe("action");
    });

    it("maps question-like kinds to decision", () => {
      expect(normaliseNodeKind("question")).toBe("decision");
      expect(normaliseNodeKind("dilemma")).toBe("decision");
    });

    it("defaults unknown kinds to option with logging", () => {
      expect(normaliseNodeKind("unknown_kind")).toBe("option");
      expect(normaliseNodeKind("completely_invalid")).toBe("option");
      expect(normaliseNodeKind("something_else")).toBe("option");
    });
  });

  describe("normaliseDraftResponse", () => {
    it("returns non-object input unchanged", () => {
      expect(normaliseDraftResponse(null)).toBe(null);
      expect(normaliseDraftResponse(undefined)).toBe(undefined);
      expect(normaliseDraftResponse("string")).toBe("string");
      expect(normaliseDraftResponse(123)).toBe(123);
    });

    it("normalises node kinds in response", () => {
      const input = {
        nodes: [
          { id: "n1", kind: "evidence", label: "Test" },
          { id: "n2", kind: "constraint", label: "Test2" },
          { id: "n3", kind: "goal", label: "Test3" },
        ],
        edges: [],
      };

      const result = normaliseDraftResponse(input) as any;

      expect(result.nodes[0].kind).toBe("option");
      expect(result.nodes[1].kind).toBe("risk");
      expect(result.nodes[2].kind).toBe("goal");
    });

    it("coerces string numbers in edges to actual numbers", () => {
      const input = {
        nodes: [{ id: "n1", kind: "goal" }],
        edges: [
          { from: "n1", to: "n2", weight: "0.5", belief: "0.8" },
          { from: "n2", to: "n3", weight: 0.3, belief: 0.9 },
        ],
      };

      const result = normaliseDraftResponse(input) as any;

      expect(result.edges[0].weight).toBe(0.5);
      expect(result.edges[0].belief).toBe(0.8);
      expect(typeof result.edges[0].weight).toBe("number");
      expect(typeof result.edges[0].belief).toBe("number");
      expect(result.edges[1].weight).toBe(0.3);
      expect(result.edges[1].belief).toBe(0.9);
    });

    it("handles responses without edges", () => {
      const input = {
        nodes: [{ id: "n1", kind: "evidence" }],
      };

      const result = normaliseDraftResponse(input) as any;

      expect(result.nodes[0].kind).toBe("option");
    });

    it("handles responses without nodes", () => {
      const input = {
        edges: [{ from: "n1", to: "n2", weight: "0.5" }],
      };

      const result = normaliseDraftResponse(input) as any;

      expect(result.edges[0].weight).toBe(0.5);
    });

    it("preserves other node properties during normalisation", () => {
      const input = {
        nodes: [
          {
            id: "n1",
            kind: "evidence",
            label: "My Label",
            body: "My Body",
            custom: "extra prop",
          },
        ],
        edges: [],
      };

      const result = normaliseDraftResponse(input) as any;

      expect(result.nodes[0].id).toBe("n1");
      expect(result.nodes[0].kind).toBe("option");
      expect(result.nodes[0].label).toBe("My Label");
      expect(result.nodes[0].body).toBe("My Body");
      expect(result.nodes[0].custom).toBe("extra prop");
    });

    it("preserves other edge properties during coercion", () => {
      const input = {
        nodes: [],
        edges: [
          {
            from: "n1",
            to: "n2",
            weight: "0.5",
            provenance: { source: "test", quote: "test quote" },
          },
        ],
      };

      const result = normaliseDraftResponse(input) as any;

      expect(result.edges[0].from).toBe("n1");
      expect(result.edges[0].to).toBe("n2");
      expect(result.edges[0].weight).toBe(0.5);
      expect(result.edges[0].provenance.source).toBe("test");
    });

    it("handles edge case of node without kind", () => {
      const input = {
        nodes: [{ id: "n1", label: "No kind" }],
        edges: [],
      };

      const result = normaliseDraftResponse(input) as any;

      expect(result.nodes[0].id).toBe("n1");
      expect(result.nodes[0].kind).toBeUndefined();
    });

    it("handles mixed canonical and non-canonical kinds", () => {
      const input = {
        nodes: [
          { id: "g1", kind: "goal", label: "Goal" },
          { id: "d1", kind: "decision", label: "Decision" },
          { id: "e1", kind: "evidence", label: "Evidence (non-canonical)" },
          { id: "o1", kind: "outcome", label: "Outcome" },
          { id: "c1", kind: "constraint", label: "Constraint (non-canonical)" },
          { id: "a1", kind: "action", label: "Action" },
          { id: "b1", kind: "benefit", label: "Benefit (non-canonical)" },
        ],
        edges: [],
      };

      const result = normaliseDraftResponse(input) as any;

      expect(result.nodes[0].kind).toBe("goal");
      expect(result.nodes[1].kind).toBe("decision");
      expect(result.nodes[2].kind).toBe("option"); // evidence → option
      expect(result.nodes[3].kind).toBe("outcome");
      expect(result.nodes[4].kind).toBe("risk"); // constraint → risk
      expect(result.nodes[5].kind).toBe("action");
      expect(result.nodes[6].kind).toBe("outcome"); // benefit → outcome
    });
  });
});
