import { describe, it, expect } from "vitest";
import { Graph, Node } from "../src/schemas/graph.js";

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

describe("Node schema - goal threshold fields", () => {
  it("accepts goal node with all goal_threshold fields", () => {
    const goalNode = {
      id: "goal_growth",
      kind: "goal",
      label: "Reach 800 Pro Customers",
      goal_threshold: 0.8,
      goal_threshold_raw: 800,
      goal_threshold_unit: "customers",
      goal_threshold_cap: 1000,
    };

    const parsed = Node.parse(goalNode);
    expect(parsed.goal_threshold).toBe(0.8);
    expect(parsed.goal_threshold_raw).toBe(800);
    expect(parsed.goal_threshold_unit).toBe("customers");
    expect(parsed.goal_threshold_cap).toBe(1000);
  });

  it("accepts goal node without goal_threshold fields", () => {
    const goalNode = {
      id: "goal_qualitative",
      kind: "goal",
      label: "Grow the business sustainably",
    };

    const parsed = Node.parse(goalNode);
    expect(parsed.goal_threshold).toBeUndefined();
    expect(parsed.goal_threshold_raw).toBeUndefined();
    expect(parsed.goal_threshold_unit).toBeUndefined();
    expect(parsed.goal_threshold_cap).toBeUndefined();
  });

  it("preserves goal_threshold fields on factor nodes (permissive schema)", () => {
    // Schema is permissive - fields can appear on any node type for forward compatibility
    const factorNode = {
      id: "fac_target",
      kind: "factor",
      label: "Target Factor",
      goal_threshold: 0.5,
      goal_threshold_raw: 500,
    };

    const parsed = Node.parse(factorNode);
    expect(parsed.goal_threshold).toBe(0.5);
    expect(parsed.goal_threshold_raw).toBe(500);
  });

  it("round-trips graph with goal threshold through schema parse", () => {
    const sample = {
      version: "1",
      default_seed: 17,
      nodes: [
        {
          id: "goal_growth",
          kind: "goal",
          label: "Reach 800 Pro Customers",
          goal_threshold: 0.8,
          goal_threshold_raw: 800,
          goal_threshold_unit: "customers",
          goal_threshold_cap: 1000,
        },
        {
          id: "fac_investment",
          kind: "factor",
          label: "Investment",
          data: { value: 0.65, raw_value: 65000, cap: 100000, unit: "£" },
        },
      ],
      edges: [],
      meta: { roots: ["goal_growth"], leaves: ["goal_growth"], suggested_positions: {}, source: "assistant" }
    };

    const parsed = Graph.parse(sample);
    const goalNode = parsed.nodes.find(n => n.kind === "goal");
    expect(goalNode?.goal_threshold).toBe(0.8);
    expect(goalNode?.goal_threshold_raw).toBe(800);
    expect(goalNode?.goal_threshold_unit).toBe("customers");
    expect(goalNode?.goal_threshold_cap).toBe(1000);
  });
});
