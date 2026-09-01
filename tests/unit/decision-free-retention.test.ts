import { describe, expect, it } from "vitest";
import { retainedDecisionFreeFactorIds } from "../../src/validators/decision-free-retention.js";

type RetentionGraph = Parameters<typeof retainedDecisionFreeFactorIds>[0];
type RetentionNode = RetentionGraph["nodes"][number];

function graph(factor: Partial<RetentionNode> = {}): RetentionGraph {
  return {
    nodes: [
      { id: "goal", kind: "goal" },
      { id: "outcome", kind: "outcome" },
      { id: "hypothesis", kind: "factor", ...factor },
    ],
    edges: [{ from: "outcome", to: "goal" }],
  };
}

describe("decision-free numberless retention boundaries", () => {
  it("retains an unresolved factor without mutating its graph", () => {
    const input = graph();
    const before = structuredClone(input);
    expect([...retainedDecisionFreeFactorIds(input)]).toEqual(["hypothesis"]);
    expect(input).toStrictEqual(before);
  });

  it("does not classify the same factor as unresolved once an authored link connects it", () => {
    const input = graph();
    expect([...retainedDecisionFreeFactorIds(input)]).toEqual(["hypothesis"]);
    const connected = { ...input, edges: [...input.edges, { from: "hypothesis", to: "outcome" }] };
    expect([...retainedDecisionFreeFactorIds(connected)]).toEqual([]);
  });

  it.each(["decision", "option"])("does not exempt the adjacent %s-present shape", (kind) => {
    const input = graph();
    expect([...retainedDecisionFreeFactorIds({
      ...input, nodes: [...input.nodes, { id: "action-shape", kind }],
    })]).toEqual([]);
  });

  it.each(["goal", "outcome"])("does not admit a model missing its %s", (kind) => {
    const input = graph();
    expect([...retainedDecisionFreeFactorIds({
      ...input, nodes: input.nodes.filter((node) => node.kind !== kind), edges: [],
    })]).toEqual([]);
  });

  it("requires an already connected terminal, not a bidirected trust annotation", () => {
    const input = graph();
    expect([...retainedDecisionFreeFactorIds({ ...input, edges: [] })]).toEqual([]);
    expect([...retainedDecisionFreeFactorIds({
      ...input, edges: [{ from: "outcome", to: "goal", edge_type: "bidirected" }],
    })]).toEqual([]);
    expect([...retainedDecisionFreeFactorIds({
      ...input, nodes: [...input.nodes, { id: "orphan-risk", kind: "risk" }],
    })]).toEqual([]);
  });

  it("accepts the existing connected risk counterpart", () => {
    const input = graph();
    expect([...retainedDecisionFreeFactorIds({
      ...input, nodes: input.nodes.map((node) => node.id === "outcome" ? { ...node, kind: "risk" } : node),
    })]).toEqual(["hypothesis"]);
  });

  it.each([0, 0.5])("keeps genuine %s outside the numberless exemption in every existing level carrier", (value) => {
    const carriers: Partial<RetentionNode>[] = [
      { data: { value } }, { data: { raw_value: value } },
      { observed_state: { value } }, { observed_state: { raw_value: value } },
      { value }, { raw_value: value },
    ];
    for (const carrier of carriers) expect([...retainedDecisionFreeFactorIds(graph(carrier))]).toEqual([]);
  });

  it("does not alter or reinterpret existing known or explicitly unknown distributions", () => {
    for (const prior of [
      { distribution: "uniform", range_min: 0.4, range_max: 0.8 },
      { distribution: "uniform", range_min: 0, range_max: 1, prior_is_unquantified: true },
    ]) {
      const input = graph({ prior });
      const before = structuredClone(input);
      expect([...retainedDecisionFreeFactorIds(input)]).toEqual([]);
      expect(input).toStrictEqual(before);
    }
  });

  it("does not broaden the exception to constraints", () => {
    expect(retainedDecisionFreeFactorIds(graph({ kind: "constraint" })).size).toBe(0);
  });
});
