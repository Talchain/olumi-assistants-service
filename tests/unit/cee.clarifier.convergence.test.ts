import { describe, it, expect } from "vitest";
import type { GraphV1 } from "../../src/contracts/plot/engine.js";
import { detectConvergence, type ConvergenceInput } from "../../src/cee/clarifier/convergence.js";

function makeGraph(nodeCount: number = 5): GraphV1 {
  const nodes = Array.from({ length: nodeCount }, (_, i) => ({
    id: `node_${i}`,
    kind: i === 0 ? "goal" : i === 1 ? "decision" : "option",
    label: `Node ${i}`,
  }));

  const edges = nodes.slice(1).map((n, i) => ({
    from: nodes[i].id,
    to: n.id,
  }));

  return {
    version: "1",
    default_seed: 17,
    nodes: nodes as any,
    edges: edges as any,
    meta: { roots: ["node_0"], leaves: [`node_${nodeCount - 1}`], suggested_positions: {}, source: "assistant" },
  } as any;
}

describe("CEE clarifier convergence detection", () => {
  describe("quality threshold rule", () => {
    it("should stop when quality >= threshold", () => {
      const input: ConvergenceInput = {
        currentGraph: makeGraph(),
        previousGraph: null,
        qualityScore: 8.5,
        roundCount: 1,
        maxRounds: 5,
      };

      const result = detectConvergence(input);

      expect(result.should_continue).toBe(false);
      expect(result.status).toBe("complete");
      expect(result.reason).toBe("quality_threshold");
      expect(result.confidence).toBeGreaterThan(0.8);
    });

    it("should continue when quality < threshold", () => {
      const input: ConvergenceInput = {
        currentGraph: makeGraph(),
        previousGraph: null,
        qualityScore: 5.0,
        roundCount: 1,
        maxRounds: 5,
      };

      const result = detectConvergence(input);

      expect(result.should_continue).toBe(true);
      expect(result.reason).toBe("continue");
    });

    it("should use custom quality threshold", () => {
      const input: ConvergenceInput = {
        currentGraph: makeGraph(),
        previousGraph: null,
        qualityScore: 6.0,
        roundCount: 1,
        maxRounds: 5,
      };

      const result = detectConvergence(input, { qualityComplete: 6.0 });

      expect(result.should_continue).toBe(false);
      expect(result.reason).toBe("quality_threshold");
    });
  });

  describe("max rounds rule", () => {
    it("should stop when max rounds reached", () => {
      const input: ConvergenceInput = {
        currentGraph: makeGraph(),
        previousGraph: null,
        qualityScore: 5.0,
        roundCount: 5,
        maxRounds: 5,
      };

      const result = detectConvergence(input);

      expect(result.should_continue).toBe(false);
      expect(result.status).toBe("max_rounds");
      expect(result.reason).toBe("max_rounds");
    });

    it("should continue when under max rounds", () => {
      const input: ConvergenceInput = {
        currentGraph: makeGraph(),
        previousGraph: null,
        qualityScore: 5.0,
        roundCount: 3,
        maxRounds: 5,
      };

      const result = detectConvergence(input);

      expect(result.should_continue).toBe(true);
    });
  });

  describe("stability rule", () => {
    it("should stop when graph is stable (few changes)", () => {
      const graph = makeGraph(5);
      const input: ConvergenceInput = {
        currentGraph: graph,
        previousGraph: graph, // Same graph = 0 changes
        qualityScore: 5.0,
        roundCount: 2,
        maxRounds: 5,
      };

      const result = detectConvergence(input);

      expect(result.should_continue).toBe(false);
      expect(result.status).toBe("complete");
      expect(result.reason).toBe("stability");
    });

    it("should continue when graph has many changes", () => {
      const currentGraph = makeGraph(8); // Larger graph
      const previousGraph = makeGraph(3); // Smaller graph
      const input: ConvergenceInput = {
        currentGraph,
        previousGraph,
        qualityScore: 5.0,
        roundCount: 2,
        maxRounds: 5,
      };

      const result = detectConvergence(input);

      expect(result.should_continue).toBe(true);
    });
  });

  describe("diminishing returns rule", () => {
    it("should stop when improvement is minimal after min rounds", () => {
      const input: ConvergenceInput = {
        currentGraph: makeGraph(),
        previousGraph: makeGraph(3), // Different graph
        qualityScore: 5.2,
        previousQualityScore: 5.0,
        roundCount: 3,
        maxRounds: 5,
      };

      const result = detectConvergence(input);

      expect(result.should_continue).toBe(false);
      expect(result.status).toBe("complete");
      expect(result.reason).toBe("diminishing_returns");
    });

    it("should continue when improvement is significant", () => {
      const input: ConvergenceInput = {
        currentGraph: makeGraph(),
        previousGraph: makeGraph(3),
        qualityScore: 6.0,
        previousQualityScore: 5.0,
        roundCount: 3,
        maxRounds: 5,
      };

      const result = detectConvergence(input);

      expect(result.should_continue).toBe(true);
    });

    it("should not apply diminishing returns before min rounds", () => {
      const input: ConvergenceInput = {
        currentGraph: makeGraph(),
        previousGraph: makeGraph(3),
        qualityScore: 5.1,
        previousQualityScore: 5.0,
        roundCount: 1,
        maxRounds: 5,
      };

      const result = detectConvergence(input);

      expect(result.should_continue).toBe(true);
    });
  });

  describe("confidence scoring", () => {
    it("should return higher confidence for higher quality", () => {
      const lowQuality: ConvergenceInput = {
        currentGraph: makeGraph(),
        previousGraph: null,
        qualityScore: 3.0,
        roundCount: 5,
        maxRounds: 5,
      };

      const highQuality: ConvergenceInput = {
        currentGraph: makeGraph(),
        previousGraph: null,
        qualityScore: 9.0,
        roundCount: 1,
        maxRounds: 5,
      };

      const lowResult = detectConvergence(lowQuality);
      const highResult = detectConvergence(highQuality);

      expect(highResult.confidence).toBeGreaterThan(lowResult.confidence);
    });
  });
});
