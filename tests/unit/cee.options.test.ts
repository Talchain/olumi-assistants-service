import { describe, it, expect } from "vitest";
import type { GraphV1 } from "../../src/contracts/plot/engine.js";
import { generateOptions } from "../../src/cee/options/index.js";

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

describe("CEE options helper - generateOptions", () => {
  it("suggests expand_scope and change_channel when there are no options", () => {
    const graph = makeGraph({
      nodes: [{ id: "g1", kind: "goal" } as any],
    });

    const options = generateOptions(graph, null);
    const ids = options.map((o) => o.id);

    expect(ids).toContain("expand_scope_add_options");
    expect(ids).toContain("change_channel_explore_paths");
  });

  it("suggests expand_scope_add_comparators when there is a single option", () => {
    const graph = makeGraph({
      nodes: [
        { id: "g1", kind: "goal" } as any,
        { id: "opt1", kind: "option" } as any,
      ],
    });

    const options = generateOptions(graph, null);
    const ids = options.map((o) => o.id);

    expect(ids).toContain("expand_scope_add_comparators");
  });

  it("suggests reduce_scope_focus_core when there are multiple options", () => {
    const graph = makeGraph({
      nodes: [
        { id: "g1", kind: "goal" } as any,
        { id: "opt1", kind: "option" } as any,
        { id: "opt2", kind: "option" } as any,
      ],
    });

    const options = generateOptions(graph, null);
    const ids = options.map((o) => o.id);

    expect(ids).toContain("reduce_scope_focus_core");
  });

  it("adds pricing-specific timing and channel suggestions when archetype is pricing_decision", () => {
    const graph = makeGraph({
      nodes: [
        { id: "g1", kind: "goal" } as any,
        { id: "opt1", kind: "option" } as any,
      ],
    });

    const archetype = { decision_type: "pricing_decision" } as any;

    const options = generateOptions(graph, archetype);
    const ids = options.map((o) => o.id);

    expect(ids).toContain("adjust_timing_price_rollout");
    expect(ids).toContain("change_channel_price_segment");
  });
});
