import { describe, it, expect } from "vitest";
import type { GraphV1 } from "../../src/contracts/plot/engine.js";
import { detectStructuralWarnings } from "../../src/cee/structure/index.js";

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

describe("detectStructuralWarnings", () => {
  it("returns empty result when graph is undefined", () => {
    const result = detectStructuralWarnings(undefined, undefined);
    expect(result.warnings).toEqual([]);
    expect(result.uncertainNodeIds).toEqual([]);
  });

  it("emits no_outcome_node when graph has no outcome nodes", () => {
    const graph = makeGraph({
      nodes: [
        { id: "g1", kind: "goal" } as any,
        { id: "d1", kind: "decision" } as any,
        { id: "o1", kind: "option" } as any,
      ],
      edges: [],
    });

    const { warnings, uncertainNodeIds } = detectStructuralWarnings(graph, undefined);

    const w = warnings.find((x) => x.id === "no_outcome_node");
    expect(w).toBeDefined();
    expect(w?.severity).toBe("medium");
    expect(Array.isArray(w?.node_ids)).toBe(true);
    expect(w?.edge_ids).toEqual([]);
    expect(uncertainNodeIds.length).toBeGreaterThan(0);
    expect(uncertainNodeIds).toEqual(expect.arrayContaining(["g1", "d1", "o1"]));
  });

  it("emits orphan_node for nodes with no incident edges", () => {
    const graph = makeGraph({
      nodes: [
        { id: "a", kind: "goal" } as any,
        { id: "b", kind: "option" } as any,
        { id: "c", kind: "risk" } as any,
      ],
      edges: [
        { from: "a", to: "b" } as any,
      ],
    });

    const { warnings, uncertainNodeIds } = detectStructuralWarnings(graph, undefined);

    const w = warnings.find((x) => x.id === "orphan_node");
    expect(w).toBeDefined();
    expect(w?.node_ids).toEqual(["c"]);
    expect(w?.edge_ids).toEqual([]);
    expect(uncertainNodeIds).toContain("c");
  });

  it("emits cycle_detected when structural meta reports cycles", () => {
    const graph = makeGraph({
      nodes: [
        { id: "n1", kind: "decision" } as any,
        { id: "n2", kind: "option" } as any,
      ],
      edges: [],
    });

    const { warnings, uncertainNodeIds } = detectStructuralWarnings(graph, {
      had_cycles: true,
      cycle_node_ids: ["n1", "n2"],
    });

    const w = warnings.find((x) => x.id === "cycle_detected");
    expect(w).toBeDefined();
    expect(w?.severity).toBe("high");
    expect(w?.node_ids).toEqual(["n1", "n2"]);
    expect(uncertainNodeIds).toEqual(expect.arrayContaining(["n1", "n2"]));
  });

  it("emits decision_after_outcome for backwards edges from outcome to decision/option/goal", () => {
    const graph = makeGraph({
      nodes: [
        { id: "out1", kind: "outcome" } as any,
        { id: "dec1", kind: "decision" } as any,
        { id: "opt1", kind: "option" } as any,
      ],
      edges: [
        { id: "e1", from: "out1", to: "dec1" } as any,
        { id: "e2", from: "out1", to: "opt1" } as any,
      ],
    });

    const { warnings, uncertainNodeIds } = detectStructuralWarnings(graph, undefined);

    const w = warnings.find((x) => x.id === "decision_after_outcome");
    expect(w).toBeDefined();
    expect(w?.node_ids).toEqual(expect.arrayContaining(["out1", "dec1", "opt1"]));
    expect(w?.edge_ids).toEqual(["e1", "e2"]);
    expect(uncertainNodeIds).toEqual(expect.arrayContaining(["out1", "dec1", "opt1"]));
  });
});
