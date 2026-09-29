import { describe, it, expect } from "vitest";
import type { GraphV1 } from "../../src/contracts/plot/engine.js";
import { inferArchetype } from "../../src/cee/archetypes/index.js";

function makeGraph(overrides: Partial<GraphV1> = {}): GraphV1 {
  const base: any = {
    version: "1",
    default_seed: 17,
    nodes: [],
    edges: [],
    meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
  };
  return { ...base, ...overrides } as GraphV1;
}

describe("CEE archetypes - inferArchetype", () => {
  it("respects custom non-pricing hint when no detection is available", () => {
    const graph = makeGraph();

    const { archetype } = inferArchetype({
      hint: "my_custom_type",
      brief: "Choose a charting library for a dashboard.",
      graph,
      engineConfidence: 0.8,
    });

    expect(archetype.decision_type).toBe("my_custom_type");
    expect(archetype.match).toBe("generic");
  });

  it("detects pricing_decision with strong pricing hint and signals as exact", () => {
    const graph = makeGraph({
      nodes: [
        { id: "goal_pricing", kind: "goal", label: "Decide pricing strategy" } as any,
        { id: "dec_pricing", kind: "decision", label: "Choose pricing approach" } as any,
        { id: "opt_premium", kind: "option", label: "Premium pricing" } as any,
      ],
    });

    const { archetype } = inferArchetype({
      hint: "pricing_decision",
      brief: "We need to decide pricing for the new SaaS plan.",
      graph,
      engineConfidence: 0.9,
    });

    expect(archetype.decision_type).toBe("pricing_decision");
    expect(archetype.match).toBe("exact");
  });

  it("detects product_decision as exact when brief strongly matches pattern", () => {
    const graph = makeGraph({
      nodes: [{ id: "g1", kind: "goal", label: "Grow product revenue" } as any],
    });

    const { archetype } = inferArchetype({
      hint: "product_decision",
      brief: "Decide product strategy to increase revenue and improve retention.",
      graph,
      engineConfidence: 0.8,
    });

    expect(archetype.decision_type).toBe("product_decision");
    expect(archetype.match).toBe("exact");
  });

  it("infers a non-pricing archetype when no hint and brief matches growth experiment", () => {
    const graph = makeGraph({
      nodes: [{ id: "opt_exp", kind: "option", label: "Run growth experiment" } as any],
    });

    const { archetype } = inferArchetype({
      brief: "Decide whether to kill, pivot, or double down on a growth experiment.",
      graph,
      engineConfidence: 0.7,
    });

    expect(archetype.decision_type).toBe("growth_experiment_decision");
    expect(["fuzzy", "exact"]).toContain(archetype.match);
  });

  it("falls back to generic when no hint and no strong pricing or non-pricing signals", () => {
    const graph = makeGraph({
      nodes: [{ id: "g1", kind: "goal", label: "General decision" } as any],
    });

    const { archetype } = inferArchetype({
      brief: "Think through a general decision.",
      graph,
      engineConfidence: 0.5,
    });

    expect(archetype.decision_type).toBe("generic");
    expect(archetype.match).toBe("generic");
  });

  it("treats known non-pricing hint as generic when detection disagrees", () => {
    const graph = makeGraph({
      nodes: [{ id: "g1", kind: "goal", label: "Long-term strategy bet" } as any],
    });

    const { archetype } = inferArchetype({
      hint: "product_decision",
      brief: "Decide long-term company strategy for the next 5 years.",
      graph,
      engineConfidence: 0.8,
    });

    expect(archetype.decision_type).toBe("product_decision");
    expect(archetype.match).toBe("generic");
  });
});
