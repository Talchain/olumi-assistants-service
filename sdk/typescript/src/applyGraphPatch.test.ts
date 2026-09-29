import { describe, it, expect } from "vitest";
import type { GraphV1, GraphPatchV1 } from "./graphTypes.js";
import { applyGraphPatch } from "./applyGraphPatch.js";

function makeGraph(overrides: Partial<GraphV1> = {}): GraphV1 {
  const base: GraphV1 = {
    version: "1",
    default_seed: 1,
    nodes: [],
    edges: [],
    meta: {},
  } as any;
  return { ...base, ...overrides };
}

describe("applyGraphPatch", () => {
  it("returns the base graph unchanged when patch is null or undefined", () => {
    const base = makeGraph({
      nodes: [{ id: "n1", kind: "goal", label: "Goal" } as any],
      edges: [],
    });

    const resultNull = applyGraphPatch(base, null);
    const resultUndef = applyGraphPatch(base, undefined as unknown as GraphPatchV1);

    expect(resultNull).toEqual(base);
    expect(resultUndef).toEqual(base);
  });

  it("does not mutate the base graph", () => {
    const base = makeGraph({
      nodes: [{ id: "n1", kind: "goal", label: "Goal" } as any],
      edges: [],
    });

    const patch: GraphPatchV1 = {
      adds: {
        nodes: [{ id: "n2", kind: "option", label: "New" } as any],
      },
    } as any;

    const copy = JSON.parse(JSON.stringify(base)) as GraphV1;
    const result = applyGraphPatch(base, patch);

    expect(base).toEqual(copy);
    expect(result).not.toBe(base);
    expect(result.nodes.length).toBe(2);
  });

  it("adds new nodes and edges from the patch", () => {
    const base = makeGraph({
      nodes: [{ id: "n1", kind: "goal", label: "Goal" } as any],
      edges: [],
    });

    const patch: GraphPatchV1 = {
      adds: {
        nodes: [{ id: "n2", kind: "option", label: "Option" } as any],
        edges: [{ from: "n1", to: "n2" } as any],
      },
    } as any;

    const result = applyGraphPatch(base, patch);

    expect(result.nodes.map((n: any) => n.id).sort()).toEqual(["n1", "n2"].sort());
    expect(result.edges).toHaveLength(1);
    expect((result.edges[0] as any).from).toBe("n1");
    expect((result.edges[0] as any).to).toBe("n2");
  });

  it("replaces existing nodes when adds contain the same id", () => {
    const base = makeGraph({
      nodes: [{ id: "n1", kind: "goal", label: "Old" } as any],
      edges: [],
    });

    const patch: GraphPatchV1 = {
      adds: {
        nodes: [{ id: "n1", kind: "goal", label: "New" } as any],
      },
    } as any;

    const result = applyGraphPatch(base, patch);

    expect(result.nodes).toHaveLength(1);
    expect((result.nodes[0] as any).label).toBe("New");
  });

  it("applies shallow updates to nodes and edges by id", () => {
    const base = makeGraph({
      nodes: [
        { id: "n1", kind: "goal", label: "Goal" } as any,
        { id: "n2", kind: "option", label: "Option" } as any,
      ],
      edges: [{ id: "e1", from: "n1", to: "n2" } as any],
    });

    const patch: GraphPatchV1 = {
      updates: [
        { id: "n2", label: "Updated Option" },
        { id: "e1", weight: 0.5 },
      ],
    } as any;

    const result = applyGraphPatch(base, patch);

    const node2 = result.nodes.find((n: any) => n.id === "n2") as any;
    const edge1 = result.edges.find((e: any) => e.id === "e1") as any;

    expect(node2.label).toBe("Updated Option");
    expect(edge1.weight).toBe(0.5);
    expect(edge1.from).toBe("n1");
    expect(edge1.to).toBe("n2");
  });

  it("removes nodes (and incident edges) by node_id / id", () => {
    const base = makeGraph({
      nodes: [
        { id: "n1", kind: "goal", label: "Goal" } as any,
        { id: "n2", kind: "option", label: "Option" } as any,
      ],
      edges: [
        { from: "n1", to: "n2" } as any,
        { from: "n2", to: "n1" } as any,
      ],
    });

    const patch: GraphPatchV1 = {
      removes: [{ node_id: "n2" }],
    } as any;

    const result = applyGraphPatch(base, patch);

    expect(result.nodes.map((n: any) => n.id)).toEqual(["n1"]);
    expect(result.edges).toHaveLength(0);
  });

  it("removes edges by edge_id / id", () => {
    const base = makeGraph({
      nodes: [
        { id: "n1", kind: "goal", label: "Goal" } as any,
        { id: "n2", kind: "option", label: "Option" } as any,
      ],
      edges: [
        { id: "e1", from: "n1", to: "n2" } as any,
        { id: "e2", from: "n2", to: "n1" } as any,
      ],
    });

    const patch: GraphPatchV1 = {
      removes: [{ edge_id: "e1" }],
    } as any;

    const result = applyGraphPatch(base, patch);

    expect(result.edges.map((e: any) => e.id)).toEqual(["e2"]);
  });

  it("removes edges by from/to when ids are not provided", () => {
    const base = makeGraph({
      nodes: [
        { id: "n1", kind: "goal", label: "Goal" } as any,
        { id: "n2", kind: "option", label: "Option" } as any,
      ],
      edges: [
        { from: "n1", to: "n2" } as any,
        { from: "n2", to: "n1" } as any,
      ],
    });

    const patch: GraphPatchV1 = {
      removes: [{ from: "n1", to: "n2" }],
    } as any;

    const result = applyGraphPatch(base, patch);

    expect(result.edges).toHaveLength(1);
    expect((result.edges[0] as any).from).toBe("n2");
    expect((result.edges[0] as any).to).toBe("n1");
  });
});
