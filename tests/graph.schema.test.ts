import { describe, it, expect } from "vitest";
import { Graph, Node, NodeData } from "../src/schemas/graph.js";

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

  it("preserves category on factor nodes through Graph.parse", () => {
    const sample = {
      version: "1",
      default_seed: 17,
      nodes: [
        {
          id: "fac_cost",
          kind: "factor",
          label: "Cost",
          category: "controllable",
          data: { value: 0.5, unit: "£" },
        },
        {
          id: "fac_demand",
          kind: "factor",
          label: "Demand",
          category: "external",
          data: { value: 0.3 },
        },
      ],
      edges: [],
      meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" }
    };

    const parsed = Graph.parse(sample);
    expect(parsed.nodes[0].category).toBe("controllable");
    expect(parsed.nodes[1].category).toBe("external");
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

describe("NodeData union ordering", () => {
  it("parses option node data with interventions as OptionData (not FactorData)", () => {
    const optionData = { interventions: { fac_cost: 0.5, fac_time: 1.0 } };
    const parsed = NodeData.parse(optionData);
    expect(parsed).toHaveProperty("interventions");
    expect((parsed as any).interventions).toEqual({ fac_cost: 0.5, fac_time: 1.0 });
  });

  it("preserves interventions when option data also has extra fields", () => {
    // LLM may output value alongside interventions — OptionData.passthrough() keeps both
    const optionData = { interventions: { fac_cost: 1.0 }, value: 1.0 };
    const parsed = NodeData.parse(optionData);
    expect((parsed as any).interventions).toEqual({ fac_cost: 1.0 });
  });

  it("parses factor node data as FactorData when no interventions present", () => {
    const factorData = { value: 0.65, raw_value: 65000, cap: 100000, unit: "£" };
    const parsed = NodeData.parse(factorData);
    expect(parsed).toHaveProperty("value", 0.65);
    expect(parsed).toHaveProperty("raw_value", 65000);
    expect(parsed).not.toHaveProperty("interventions");
  });

  it("parses constraint node data as ConstraintNodeData", () => {
    const constraintData = { operator: ">=" };
    const parsed = NodeData.parse(constraintData);
    expect(parsed).toHaveProperty("operator", ">=");
  });

  it("round-trips option node with interventions through full Graph.parse", () => {
    const sample = {
      version: "1",
      default_seed: 17,
      nodes: [
        {
          id: "goal_1",
          kind: "goal",
          label: "Test Goal",
        },
        {
          id: "opt_hire",
          kind: "option",
          label: "Hire PA",
          data: { interventions: { fac_pa_cost: 1.0, fac_productivity: 0.8 } },
        },
        {
          id: "fac_pa_cost",
          kind: "factor",
          label: "PA Cost",
          category: "controllable",
          data: { value: 0.5, unit: "£" },
        },
        {
          id: "fac_productivity",
          kind: "factor",
          label: "Productivity",
          category: "observable",
          data: { value: 0.3 },
        },
      ],
      edges: [],
      meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" }
    };

    const parsed = Graph.parse(sample);

    // Option node interventions preserved
    const optNode = parsed.nodes.find(n => n.id === "opt_hire");
    expect(optNode?.data).toHaveProperty("interventions");
    expect((optNode?.data as any).interventions).toEqual({
      fac_pa_cost: 1.0,
      fac_productivity: 0.8,
    });

    // Factor category preserved
    expect(parsed.nodes.find(n => n.id === "fac_pa_cost")?.category).toBe("controllable");
    expect(parsed.nodes.find(n => n.id === "fac_productivity")?.category).toBe("observable");
  });
});
