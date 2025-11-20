import { describe, it, expect } from "vitest";
import type { GraphV1 } from "../../src/contracts/plot/engine.js";
import { buildSensitivitySuggestions } from "../../src/cee/sensitivity/index.js";

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

describe("CEE sensitivity coach - buildSensitivitySuggestions", () => {
  it("returns empty list when no top_drivers are present", () => {
    const graph = makeGraph();
    const inference: any = {
      summary: "s",
      seed: "seed",
      response_hash: "hash",
      explain: {
        top_drivers: [],
      },
    };

    const suggestions = buildSensitivitySuggestions(graph, inference);
    expect(suggestions).toEqual([]);
  });

  it("sorts by absolute contribution desc then node_id asc and assigns ranks", () => {
    const graph = makeGraph();
    const inference: any = {
      summary: "s",
      seed: "seed",
      response_hash: "hash",
      explain: {
        top_drivers: [
          { node_id: "b", contribution: -0.2 },
          { node_id: "a", contribution: 0.2 },
          { node_id: "c", contribution: 0.5 },
        ],
      },
    };

    const suggestions = buildSensitivitySuggestions(graph, inference) as any[];

    expect(suggestions.map((s) => s.driver_id)).toEqual(["c", "a", "b"]);
    expect(suggestions.map((s) => s.rank)).toEqual([1, 2, 3]);
  });

  it("derives direction from contribution sign where available", () => {
    const graph = makeGraph();
    const inference: any = {
      summary: "s",
      seed: "seed",
      response_hash: "hash",
      explain: {
        top_drivers: [
          { node_id: "up", contribution: 0.3 },
          { node_id: "down", contribution: -0.1 },
          { node_id: "neutral" },
        ],
      },
    };

    const suggestions = buildSensitivitySuggestions(graph, inference) as any[];
    const byId = new Map(suggestions.map((s) => [s.driver_id, s]));

    expect(byId.get("up")?.direction).toBe("increase");
    expect(byId.get("down")?.direction).toBe("decrease");
    expect(byId.get("neutral")?.direction).toBeUndefined();
  });
});
