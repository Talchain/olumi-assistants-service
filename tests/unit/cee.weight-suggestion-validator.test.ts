import { describe, it, expect } from "vitest";

import type { GraphV1 } from "../../src/contracts/plot/engine.js";
import { WeightSuggestionValidator } from "../../src/cee/verification/validators/weight-suggestion-validator.js";

function makeGraph(partial: Partial<GraphV1>): GraphV1 {
  return {
    version: "1",
    default_seed: 17,
    nodes: [],
    edges: [],
    meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
    ...(partial as any),
  } as GraphV1;
}

describe("WeightSuggestionValidator", () => {
  it("skips when payload has no graph", async () => {
    const validator = new WeightSuggestionValidator();

    const result = await validator.validate({} as any);

    expect(result.valid).toBe(true);
    expect(result.stage).toBe("weight_suggestions");
    expect(result.skipped).toBe(true);
  });

  it("returns no suggestions for well-differentiated beliefs", async () => {
    const graph = makeGraph({
      nodes: [
        { id: "goal_1", kind: "goal", label: "Goal" } as any,
        { id: "dec_1", kind: "decision", label: "Decision" } as any,
        { id: "opt_1", kind: "option", label: "Option A" } as any,
        { id: "opt_2", kind: "option", label: "Option B" } as any,
      ],
      edges: [
        { from: "goal_1", to: "dec_1" } as any,
        { from: "dec_1", to: "opt_1", belief: 0.3 } as any,
        { from: "dec_1", to: "opt_2", belief: 0.7 } as any,
      ],
    });

    const validator = new WeightSuggestionValidator();
    const result = await validator.validate({ graph } as any);

    expect(result.valid).toBe(true);
    expect(result.stage).toBe("weight_suggestions");
    expect((result as any).suggestions).toEqual([]);
  });

  it("detects uniform distribution in decision branches", async () => {
    const graph = makeGraph({
      nodes: [
        { id: "goal_1", kind: "goal", label: "Goal" } as any,
        { id: "dec_1", kind: "decision", label: "Should we expand?" } as any,
        { id: "opt_1", kind: "option", label: "Yes" } as any,
        { id: "opt_2", kind: "option", label: "No" } as any,
        { id: "opt_3", kind: "option", label: "Maybe" } as any,
      ],
      edges: [
        { from: "goal_1", to: "dec_1" } as any,
        { from: "dec_1", to: "opt_1", belief: 0.33 } as any,
        { from: "dec_1", to: "opt_2", belief: 0.33 } as any,
        { from: "dec_1", to: "opt_3", belief: 0.33 } as any,
      ],
    });

    const validator = new WeightSuggestionValidator();
    const result = await validator.validate({ graph } as any);

    expect(result.valid).toBe(true);
    const suggestions = (result as any).suggestions;
    expect(suggestions).toBeDefined();
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.every((s: any) => s.reason === "uniform_distribution")).toBe(true);
  });

  it("detects near-zero beliefs", async () => {
    const graph = makeGraph({
      nodes: [
        { id: "opt_1", kind: "option", label: "Option A" } as any,
        { id: "out_1", kind: "outcome", label: "Outcome" } as any,
      ],
      edges: [{ from: "opt_1", to: "out_1", belief: 0.01 } as any],
    });

    const validator = new WeightSuggestionValidator();
    const result = await validator.validate({ graph } as any);

    expect(result.valid).toBe(true);
    const suggestions = (result as any).suggestions;
    expect(suggestions).toBeDefined();
    expect(suggestions.length).toBe(1);
    expect(suggestions[0].reason).toBe("near_zero");
  });

  it("detects near-one beliefs", async () => {
    const graph = makeGraph({
      nodes: [
        { id: "opt_1", kind: "option", label: "Option A" } as any,
        { id: "out_1", kind: "outcome", label: "Outcome" } as any,
      ],
      edges: [{ from: "opt_1", to: "out_1", belief: 0.99 } as any],
    });

    const validator = new WeightSuggestionValidator();
    const result = await validator.validate({ graph } as any);

    expect(result.valid).toBe(true);
    const suggestions = (result as any).suggestions;
    expect(suggestions).toBeDefined();
    expect(suggestions.length).toBe(1);
    expect(suggestions[0].reason).toBe("near_one");
  });

  it("limits suggestions to 10", async () => {
    const nodes: any[] = [{ id: "dec_1", kind: "decision", label: "Decision" }];
    const edges: any[] = [];

    // Create 15 options all with uniform beliefs
    for (let i = 0; i < 15; i++) {
      nodes.push({ id: `opt_${i}`, kind: "option", label: `Option ${i}` });
      edges.push({ from: "dec_1", to: `opt_${i}`, belief: 0.066 });
    }

    const graph = makeGraph({ nodes, edges });

    const validator = new WeightSuggestionValidator();
    const result = await validator.validate({ graph } as any);

    expect(result.valid).toBe(true);
    const suggestions = (result as any).suggestions;
    expect(suggestions).toBeDefined();
    expect(suggestions.length).toBeLessThanOrEqual(10);
    expect((result.details as any).total_suggestions).toBeGreaterThan(10);
  });

  // Weight detection tests
  describe("weight detection", () => {
    it("detects uniform weights on option→outcome edges", async () => {
      const graph = makeGraph({
        nodes: [
          { id: "opt_1", kind: "option", label: "Option A" } as any,
          { id: "out_1", kind: "outcome", label: "Outcome 1" } as any,
          { id: "out_2", kind: "outcome", label: "Outcome 2" } as any,
          { id: "out_3", kind: "outcome", label: "Outcome 3" } as any,
        ],
        edges: [
          { from: "opt_1", to: "out_1", weight: 1.0, belief: 0.5 } as any,
          { from: "opt_1", to: "out_2", weight: 1.0, belief: 0.6 } as any,
          { from: "opt_1", to: "out_3", weight: 1.0, belief: 0.7 } as any,
        ],
      });

      const validator = new WeightSuggestionValidator();
      const result = await validator.validate({ graph } as any);

      expect(result.valid).toBe(true);
      const suggestions = (result as any).suggestions;
      expect(suggestions).toBeDefined();
      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions.some((s: any) => s.reason === "uniform_weights")).toBe(true);
      expect(suggestions[0].current_weight).toBe(1.0);
    });

    it("detects weight below threshold (< 0.3)", async () => {
      const graph = makeGraph({
        nodes: [
          { id: "opt_1", kind: "option", label: "Option A" } as any,
          { id: "out_1", kind: "outcome", label: "Outcome" } as any,
        ],
        edges: [{ from: "opt_1", to: "out_1", weight: 0.1, belief: 0.5 } as any],
      });

      const validator = new WeightSuggestionValidator();
      const result = await validator.validate({ graph } as any);

      expect(result.valid).toBe(true);
      const suggestions = (result as any).suggestions;
      expect(suggestions).toBeDefined();
      expect(suggestions.length).toBe(1);
      expect(suggestions[0].reason).toBe("weight_too_low");
      expect(suggestions[0].current_weight).toBe(0.1);
    });

    it("detects weight above threshold (> 1.5)", async () => {
      const graph = makeGraph({
        nodes: [
          { id: "opt_1", kind: "option", label: "Option A" } as any,
          { id: "out_1", kind: "outcome", label: "Outcome" } as any,
        ],
        edges: [{ from: "opt_1", to: "out_1", weight: 2.0, belief: 0.5 } as any],
      });

      const validator = new WeightSuggestionValidator();
      const result = await validator.validate({ graph } as any);

      expect(result.valid).toBe(true);
      const suggestions = (result as any).suggestions;
      expect(suggestions).toBeDefined();
      expect(suggestions.length).toBe(1);
      expect(suggestions[0].reason).toBe("weight_too_high");
      expect(suggestions[0].current_weight).toBe(2.0);
    });

    it("does not flag weights within valid range", async () => {
      const graph = makeGraph({
        nodes: [
          { id: "opt_1", kind: "option", label: "Option A" } as any,
          { id: "out_1", kind: "outcome", label: "Outcome 1" } as any,
          { id: "out_2", kind: "outcome", label: "Outcome 2" } as any,
        ],
        edges: [
          { from: "opt_1", to: "out_1", weight: 0.5, belief: 0.6 } as any,
          { from: "opt_1", to: "out_2", weight: 1.2, belief: 0.7 } as any,
        ],
      });

      const validator = new WeightSuggestionValidator();
      const result = await validator.validate({ graph } as any);

      expect(result.valid).toBe(true);
      const suggestions = (result as any).suggestions;
      // No weight issues, no belief issues
      expect(suggestions.length).toBe(0);
    });

    it("prioritizes weight extremes before belief extremes", async () => {
      const graph = makeGraph({
        nodes: [
          { id: "opt_1", kind: "option", label: "Option A" } as any,
          { id: "out_1", kind: "outcome", label: "Outcome 1" } as any,
          { id: "out_2", kind: "outcome", label: "Outcome 2" } as any,
        ],
        edges: [
          { from: "opt_1", to: "out_1", weight: 0.1, belief: 0.5 } as any, // weight too low
          { from: "opt_1", to: "out_2", weight: 1.0, belief: 0.01 } as any, // near zero belief
        ],
      });

      const validator = new WeightSuggestionValidator();
      const result = await validator.validate({ graph } as any);

      expect(result.valid).toBe(true);
      const suggestions = (result as any).suggestions;
      expect(suggestions.length).toBe(2);
      // Weight issues should come before belief issues
      expect(suggestions[0].reason).toBe("weight_too_low");
      expect(suggestions[1].reason).toBe("near_zero");
    });

    it("includes weight issues in details", async () => {
      const graph = makeGraph({
        nodes: [
          { id: "opt_1", kind: "option", label: "Option A" } as any,
          { id: "out_1", kind: "outcome", label: "Outcome 1" } as any,
          { id: "out_2", kind: "outcome", label: "Outcome 2" } as any,
        ],
        edges: [
          { from: "opt_1", to: "out_1", weight: 0.1, belief: 0.5 } as any,
          { from: "opt_1", to: "out_2", weight: 2.0, belief: 0.5 } as any,
        ],
      });

      const validator = new WeightSuggestionValidator();
      const result = await validator.validate({ graph } as any);

      expect(result.valid).toBe(true);
      const details = result.details as any;
      expect(details.weight_too_low_edges).toBe(1);
      expect(details.weight_too_high_edges).toBe(1);
    });
  });
});
