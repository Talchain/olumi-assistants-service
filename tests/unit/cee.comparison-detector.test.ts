import { describe, it, expect } from "vitest";

import type { GraphV1 } from "../../src/contracts/plot/engine.js";
import { ComparisonDetector } from "../../src/cee/verification/validators/comparison-detector.js";

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

describe("ComparisonDetector", () => {
  it("skips when payload has no graph", async () => {
    const detector = new ComparisonDetector();

    const result = await detector.validate({} as any);

    expect(result.valid).toBe(true);
    expect(result.stage).toBe("comparison_detection");
    expect(result.skipped).toBe(true);
    expect((result as any).comparison_suggested).toBe(false);
  });

  it("returns false for simple linear graph", async () => {
    const graph = makeGraph({
      nodes: [
        { id: "goal_1", kind: "goal", label: "Goal" } as any,
        { id: "opt_1", kind: "option", label: "Single Option" } as any,
        { id: "out_1", kind: "outcome", label: "Outcome" } as any,
      ],
      edges: [
        { from: "goal_1", to: "opt_1" } as any,
        { from: "opt_1", to: "out_1" } as any,
      ],
    });

    const detector = new ComparisonDetector();
    const result = await detector.validate({ graph } as any);

    expect(result.valid).toBe(true);
    expect((result as any).comparison_suggested).toBe(false);
  });

  it("suggests comparison when multiple options from decision + shared outcomes", async () => {
    const graph = makeGraph({
      nodes: [
        { id: "goal_1", kind: "goal", label: "Goal" } as any,
        { id: "dec_1", kind: "decision", label: "Which option?" } as any,
        { id: "opt_1", kind: "option", label: "Option A" } as any,
        { id: "opt_2", kind: "option", label: "Option B" } as any,
        { id: "out_1", kind: "outcome", label: "Revenue increase" } as any,
      ],
      edges: [
        { from: "goal_1", to: "dec_1" } as any,
        { from: "dec_1", to: "opt_1" } as any,
        { from: "dec_1", to: "opt_2" } as any,
        { from: "opt_1", to: "out_1" } as any,
        { from: "opt_2", to: "out_1" } as any,
      ],
    });

    const detector = new ComparisonDetector();
    const result = await detector.validate({ graph } as any);

    expect(result.valid).toBe(true);
    expect((result as any).comparison_suggested).toBe(true);
    expect((result.details as any).has_multiple_options_from_decision).toBe(true);
    expect((result.details as any).has_shared_outcomes).toBe(true);
  });

  it("suggests comparison when keywords + multiple options", async () => {
    const graph = makeGraph({
      nodes: [
        { id: "goal_1", kind: "goal", label: "Compare pricing options" } as any,
        { id: "dec_1", kind: "decision", label: "Premium vs Basic" } as any,
        { id: "opt_1", kind: "option", label: "Premium tier" } as any,
        { id: "opt_2", kind: "option", label: "Basic tier" } as any,
      ],
      edges: [
        { from: "goal_1", to: "dec_1" } as any,
        { from: "dec_1", to: "opt_1" } as any,
        { from: "dec_1", to: "opt_2" } as any,
      ],
    });

    const detector = new ComparisonDetector();
    const result = await detector.validate({ graph } as any);

    expect(result.valid).toBe(true);
    expect((result as any).comparison_suggested).toBe(true);
    expect((result.details as any).has_comparison_keywords).toBe(true);
    expect((result.details as any).has_multiple_options_from_decision).toBe(true);
  });

  it("does not suggest comparison with only one signal", async () => {
    // Only keyword, but no structural signals
    const graph = makeGraph({
      nodes: [
        { id: "goal_1", kind: "goal", label: "Compare options" } as any,
        { id: "opt_1", kind: "option", label: "Only option" } as any,
      ],
      edges: [{ from: "goal_1", to: "opt_1" } as any],
    });

    const detector = new ComparisonDetector();
    const result = await detector.validate({ graph } as any);

    expect(result.valid).toBe(true);
    expect((result as any).comparison_suggested).toBe(false);
    expect((result.details as any).signals_detected).toBe(1);
  });

  it("detects trade-off keyword variations", async () => {
    // Note: "or", "option", "either" were intentionally removed to reduce noise
    const variations = ["trade-off", "tradeoff", "alternative", "versus", "weigh"];

    for (const keyword of variations) {
      const graph = makeGraph({
        nodes: [
          { id: "goal_1", kind: "goal", label: `Consider ${keyword}` } as any,
          { id: "dec_1", kind: "decision", label: "Choose" } as any,
          { id: "opt_1", kind: "option", label: "A" } as any,
          { id: "opt_2", kind: "option", label: "B" } as any,
        ],
        edges: [
          { from: "goal_1", to: "dec_1" } as any,
          { from: "dec_1", to: "opt_1" } as any,
          { from: "dec_1", to: "opt_2" } as any,
        ],
      });

      const detector = new ComparisonDetector();
      const result = await detector.validate({ graph } as any);

      expect((result.details as any).has_comparison_keywords).toBe(true);
    }
  });
});
