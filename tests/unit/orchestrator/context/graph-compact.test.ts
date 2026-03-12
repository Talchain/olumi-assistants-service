import { describe, it, expect } from "vitest";
import { compactGraph } from "../../../../src/orchestrator/context/graph-compact.js";
import type { GraphV3T } from "../../../../src/orchestrator/types.js";

// ============================================================================
// Fixtures
// ============================================================================

function makeNode(id: string, overrides?: Record<string, unknown>) {
  return {
    id,
    kind: "factor" as const,
    label: `Label ${id}`,
    ...overrides,
  };
}

function makeEdge(from: string, to: string, overrides?: Record<string, unknown>) {
  return {
    from,
    to,
    strength: { mean: 0.5, std: 0.1 },
    exists_probability: 0.9,
    effect_direction: "positive" as const,
    ...overrides,
  };
}

function makeGraph(nodes: unknown[], edges: unknown[]): GraphV3T {
  return { nodes, edges } as unknown as GraphV3T;
}

// ============================================================================
// Tests
// ============================================================================

describe("compactGraph", () => {
  it("returns empty compact graph for empty input", () => {
    const result = compactGraph(makeGraph([], []));
    expect(result).toEqual({
      nodes: [],
      edges: [],
      _node_count: 0,
      _edge_count: 0,
    });
  });

  it("keeps only id, kind, label per node (drops heavy fields)", () => {
    const node = makeNode("node_a", {
      description: "long description",
      body: "should be dropped",
      state_space: { min: 0, max: 1 },
      goal_threshold: 0.8,
    });
    const result = compactGraph(makeGraph([node], []));
    expect(result.nodes).toHaveLength(1);
    const n = result.nodes[0];
    expect(n.id).toBe("node_a");
    expect(n.kind).toBe("factor");
    expect(n.label).toBe("Label node_a");
    expect(n).not.toHaveProperty("description");
    expect(n).not.toHaveProperty("body");
    expect(n).not.toHaveProperty("state_space");
    expect(n).not.toHaveProperty("goal_threshold");
  });

  it("keeps only from, to, strength (mean), exists per edge (drops std, effect_direction, label)", () => {
    const edge = makeEdge("a", "b", { label: "some label" });
    const result = compactGraph(makeGraph([], [edge]));
    expect(result.edges).toHaveLength(1);
    const e = result.edges[0];
    expect(e.from).toBe("a");
    expect(e.to).toBe("b");
    expect(e.strength).toBe(0.5);
    expect(e.exists).toBe(0.9);
    expect(e).not.toHaveProperty("std");
    expect(e).not.toHaveProperty("effect_direction");
    expect(e).not.toHaveProperty("label");
  });

  it("defaults exists_probability to 0.8 when absent", () => {
    const edge = {
      from: "a",
      to: "b",
      strength: { mean: 0.6, std: 0.1 },
      // exists_probability intentionally absent
      effect_direction: "positive" as const,
    };
    const result = compactGraph(makeGraph([], [edge as unknown as GraphV3T['edges'][0]]));
    expect(result.edges[0].exists).toBe(0.8);
  });

  it("extracts observed_state.value, unit into node fields; drops baseline and std", () => {
    const node = makeNode("node_a", {
      observed_state: {
        value: 42,
        baseline: 100,
        unit: "USD",
        source: "brief_extraction",
        std: 5,
      },
    });
    const result = compactGraph(makeGraph([node], []));
    expect(result.nodes[0].value).toBe(42);
    expect(result.nodes[0].unit).toBe("USD");
    // Heavy observed_state fields must not appear at node level
    expect(result.nodes[0]).not.toHaveProperty("baseline");
    expect(result.nodes[0]).not.toHaveProperty("std");
  });

  it("omits value when observed_state is absent", () => {
    const node = makeNode("node_a");
    const result = compactGraph(makeGraph([node], []));
    expect(result.nodes[0]).not.toHaveProperty("value");
  });

  it("includes category when present", () => {
    const node = makeNode("node_a", { category: "controllable" });
    const result = compactGraph(makeGraph([node], []));
    expect(result.nodes[0].category).toBe("controllable");
  });

  it("omits category when absent", () => {
    const node = makeNode("node_a");
    const result = compactGraph(makeGraph([node], []));
    expect(result.nodes[0]).not.toHaveProperty("category");
  });

  it("sorts nodes by id", () => {
    const nodes = [makeNode("node_z"), makeNode("node_a"), makeNode("node_m")];
    const result = compactGraph(makeGraph(nodes, []));
    expect(result.nodes.map((n) => n.id)).toEqual(["node_a", "node_m", "node_z"]);
  });

  it("sorts edges by from then to", () => {
    const edges = [
      makeEdge("b", "c"),
      makeEdge("a", "z"),
      makeEdge("a", "b"),
      makeEdge("b", "a"),
    ];
    const result = compactGraph(makeGraph([], edges));
    const pairs = result.edges.map((e) => `${e.from}→${e.to}`);
    expect(pairs).toEqual(["a→b", "a→z", "b→a", "b→c"]);
  });

  it("populates _node_count and _edge_count correctly", () => {
    const nodes = [makeNode("a"), makeNode("b"), makeNode("c")];
    const edges = [makeEdge("a", "b"), makeEdge("b", "c")];
    const result = compactGraph(makeGraph(nodes, edges));
    expect(result._node_count).toBe(3);
    expect(result._edge_count).toBe(2);
  });

  it("is deterministic — same input produces byte-identical JSON output", () => {
    const nodes = [makeNode("z"), makeNode("a"), makeNode("m")];
    const edges = [makeEdge("z", "a"), makeEdge("a", "m")];
    const graph = makeGraph(nodes, edges);

    const output1 = JSON.stringify(compactGraph(graph));
    const output2 = JSON.stringify(compactGraph(graph));
    expect(output1).toBe(output2);
  });

  it("token size: realistic 10-node graph serialises to < 1500 tokens", () => {
    const nodes = Array.from({ length: 10 }, (_, i) =>
      makeNode(`node_${i.toString().padStart(2, "0")}`, {
        kind: i === 0 ? "goal" : "factor",
        observed_state: { value: i * 10, baseline: 100, unit: "GBP" },
        category: "controllable",
      }),
    );
    const edges = Array.from({ length: 15 }, (_, i) => ({
      from: `node_${(i % 9 + 1).toString().padStart(2, "0")}`,
      to: `node_0${i % 5}`,
      strength: { mean: 0.5 + i * 0.02, std: 0.1 },
      exists_probability: 0.85,
      effect_direction: "positive" as const,
    }));
    const graph = makeGraph(nodes, edges);
    const compact = compactGraph(graph as unknown as GraphV3T);
    const json = JSON.stringify(compact);
    const estimatedTokens = Math.ceil(json.length / 4);
    expect(estimatedTokens).toBeLessThan(1500);
  });
});
