import { describe, it, expect } from "vitest";
import type { GraphV1, InferenceResultsV1 } from "../../src/contracts/plot/engine.js";
import { buildExplanation } from "../../src/cee/explain/index.js";

function makeGraph(): GraphV1 {
  return {
    version: "1",
    default_seed: 17,
    nodes: [
      { id: "goal", kind: "goal", label: "Increase revenue" },
      { id: "opt_a", kind: "option", label: "Premium pricing" },
      { id: "opt_b", kind: "option", label: "Freemium" },
    ],
    edges: [],
    meta: { roots: ["goal"], leaves: ["opt_a", "opt_b"], suggested_positions: {}, source: "assistant" },
  } as any;
}

describe("CEE explain helper - buildExplanation", () => {
  it("builds ranked top_drivers enriched with node labels", () => {
    const graph = makeGraph();

    const inference: InferenceResultsV1 = {
      summary: "Test summary",
      explain: {
        top_drivers: [
          { node_id: "opt_b", description: "Freemium", contribution: 0.2 },
          { node_id: "opt_a", description: "Premium pricing", contribution: 0.8 },
        ],
      },
      seed: "seed-1",
      response_hash: "hash-1",
    } as any;

    const explanation = buildExplanation(graph, inference);

    expect(explanation.top_drivers).toBeDefined();
    expect(explanation.top_drivers!.length).toBe(2);

    const [first, second] = explanation.top_drivers!;

    expect(first.id).toBe("opt_a");
    expect(first.rank).toBe(1);
    expect(first.label).toBe("Premium pricing");
    expect(typeof first.impact === "number" || first.impact === undefined).toBe(true);

    expect(second.id).toBe("opt_b");
    expect(second.rank).toBe(2);
  });

  it("handles missing explain/top_drivers gracefully", () => {
    const graph = makeGraph();

    const inference: InferenceResultsV1 = {
      summary: "No drivers",
      seed: "seed-2",
      response_hash: "hash-2",
    } as any;

    const explanation = buildExplanation(graph, inference);

    expect(explanation.top_drivers).toBeUndefined();
  });
});
