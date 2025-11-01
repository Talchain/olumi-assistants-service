import { describe, it, expect } from "vitest";
import { Graph } from "../src/schemas/graph.js";

describe("Graph schema", () => {
  it("accepts a small graph within caps", () => {
    const sample = {
      version: "1",
      default_seed: 17,
      nodes: [{ id: "goal_1", kind: "goal" }],
      edges: [],
      meta: { roots: ["goal_1"], leaves: ["goal_1"], suggested_positions: {}, source: "assistant" }
    };

    const parsed = Graph.parse(sample);
    expect(parsed.nodes[0].id).toBe("goal_1");
    expect(parsed.meta.source).toBe("assistant");
  });
});
