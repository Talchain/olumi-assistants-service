/**
 * Risk Coefficient Normalisation Tests
 *
 * Tests for the normaliseRiskCoefficients function that ensures
 * risk→goal and risk→outcome edges have negative strength_mean values.
 */

import { describe, it, expect } from "vitest";
import { normaliseRiskCoefficients } from "../../src/cee/validation/pipeline.js";

describe("normaliseRiskCoefficients", () => {
  it("corrects positive risk→goal coefficients to negative", () => {
    const nodes = [
      { id: "risk_1", kind: "risk" },
      { id: "goal_1", kind: "goal" },
    ];
    const edges = [
      { from: "risk_1", to: "goal_1", strength_mean: 0.5 },
    ];

    const result = normaliseRiskCoefficients(nodes, edges);

    expect(result.corrections).toHaveLength(1);
    expect(result.corrections[0]).toEqual({
      source: "risk_1",
      target: "goal_1",
      original: 0.5,
      corrected: -0.5,
    });
    expect(result.edges[0].strength_mean).toBe(-0.5);
  });

  it("corrects positive risk→outcome coefficients to negative", () => {
    const nodes = [
      { id: "risk_1", kind: "risk" },
      { id: "out_1", kind: "outcome" },
    ];
    const edges = [
      { from: "risk_1", to: "out_1", strength_mean: 0.7 },
    ];

    const result = normaliseRiskCoefficients(nodes, edges);

    expect(result.corrections).toHaveLength(1);
    expect(result.corrections[0]).toEqual({
      source: "risk_1",
      target: "out_1",
      original: 0.7,
      corrected: -0.7,
    });
    expect(result.edges[0].strength_mean).toBe(-0.7);
  });

  it("preserves already-negative risk coefficients", () => {
    const nodes = [
      { id: "risk_1", kind: "risk" },
      { id: "goal_1", kind: "goal" },
    ];
    const edges = [
      { from: "risk_1", to: "goal_1", strength_mean: -0.5 },
    ];

    const result = normaliseRiskCoefficients(nodes, edges);

    expect(result.corrections).toHaveLength(0);
    expect(result.edges[0].strength_mean).toBe(-0.5);
  });

  it("does NOT modify non-risk→goal/outcome edges", () => {
    const nodes = [
      { id: "factor_1", kind: "factor" },
      { id: "out_1", kind: "outcome" },
      { id: "goal_1", kind: "goal" },
    ];
    const edges = [
      // Factor→outcome with positive coefficient (should NOT be corrected)
      { from: "factor_1", to: "out_1", strength_mean: 0.6 },
      // Outcome→goal with positive coefficient (should NOT be corrected)
      { from: "out_1", to: "goal_1", strength_mean: 0.8 },
    ];

    const result = normaliseRiskCoefficients(nodes, edges);

    expect(result.corrections).toHaveLength(0);
    expect(result.edges[0].strength_mean).toBe(0.6);
    expect(result.edges[1].strength_mean).toBe(0.8);
  });

  it("handles nested strength.mean format (LLM output)", () => {
    const nodes = [
      { id: "risk_1", kind: "risk" },
      { id: "goal_1", kind: "goal" },
    ];
    const edges = [
      { from: "risk_1", to: "goal_1", strength: { mean: 0.5 } },
    ];

    const result = normaliseRiskCoefficients(nodes, edges);

    expect(result.corrections).toHaveLength(1);
    expect(result.corrections[0].original).toBe(0.5);
    expect(result.corrections[0].corrected).toBe(-0.5);
    // Should add strength_mean to the edge
    expect(result.edges[0].strength_mean).toBe(-0.5);
  });

  it("handles mixed graph with multiple risk edges", () => {
    const nodes = [
      { id: "decision_1", kind: "decision" },
      { id: "option_1", kind: "option" },
      { id: "risk_1", kind: "risk" },
      { id: "risk_2", kind: "risk" },
      { id: "out_1", kind: "outcome" },
      { id: "goal_1", kind: "goal" },
    ];
    const edges = [
      { from: "decision_1", to: "option_1", strength_mean: 0.9 },
      { from: "option_1", to: "risk_1", strength_mean: 0.4 },
      { from: "option_1", to: "out_1", strength_mean: 0.6 },
      // These should be corrected:
      { from: "risk_1", to: "goal_1", strength_mean: 0.5 },
      { from: "risk_2", to: "out_1", strength_mean: 0.3 },
      // This is already negative:
      { from: "out_1", to: "goal_1", strength_mean: 0.7 },
    ];

    const result = normaliseRiskCoefficients(nodes, edges);

    expect(result.corrections).toHaveLength(2);
    expect(result.corrections.map(c => c.source)).toContain("risk_1");
    expect(result.corrections.map(c => c.source)).toContain("risk_2");

    // Verify the corrected edges
    const risk1ToGoal = result.edges.find(e => e.from === "risk_1" && e.to === "goal_1");
    const risk2ToOut = result.edges.find(e => e.from === "risk_2" && e.to === "out_1");
    expect(risk1ToGoal?.strength_mean).toBe(-0.5);
    expect(risk2ToOut?.strength_mean).toBe(-0.3);

    // Verify non-risk edges are unchanged
    const decToOpt = result.edges.find(e => e.from === "decision_1");
    const outToGoal = result.edges.find(e => e.from === "out_1");
    expect(decToOpt?.strength_mean).toBe(0.9);
    expect(outToGoal?.strength_mean).toBe(0.7);
  });

  it("defaults to 0.5 when strength_mean is undefined", () => {
    const nodes = [
      { id: "risk_1", kind: "risk" },
      { id: "goal_1", kind: "goal" },
    ];
    const edges = [
      { from: "risk_1", to: "goal_1" }, // No strength_mean
    ];

    const result = normaliseRiskCoefficients(nodes, edges);

    expect(result.corrections).toHaveLength(1);
    expect(result.corrections[0].original).toBe(0.5);
    expect(result.corrections[0].corrected).toBe(-0.5);
    expect(result.edges[0].strength_mean).toBe(-0.5);
  });

  it("handles case-insensitive node kinds", () => {
    const nodes = [
      { id: "risk_1", kind: "Risk" }, // Capital R
      { id: "goal_1", kind: "GOAL" }, // All caps
    ];
    const edges = [
      { from: "risk_1", to: "goal_1", strength_mean: 0.5 },
    ];

    const result = normaliseRiskCoefficients(nodes, edges);

    expect(result.corrections).toHaveLength(1);
    expect(result.edges[0].strength_mean).toBe(-0.5);
  });

  it("returns empty corrections for empty graph", () => {
    const result = normaliseRiskCoefficients([], []);

    expect(result.corrections).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
  });
});
