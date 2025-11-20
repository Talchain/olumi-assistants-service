import { describe, it, expect } from "vitest";
import type { GraphV1 } from "../../src/contracts/plot/engine.js";
import { detectBiases } from "../../src/cee/bias/index.js";

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

describe("CEE bias helper - detectBiases", () => {
  it("emits selection bias when there are zero or one options", () => {
    const graphZero = makeGraph({ nodes: [{ id: "g1", kind: "goal" } as any] });
    const zeroFindings = detectBiases(graphZero, null);
    const selectionZero = zeroFindings.find((f) => f.id === "selection_low_option_count");
    expect(selectionZero).toBeDefined();
    expect(selectionZero!.category).toBe("selection");
    expect(selectionZero!.severity).toBe("high");

    const graphOne = makeGraph({
      nodes: [
        { id: "g1", kind: "goal" } as any,
        { id: "opt1", kind: "option" } as any,
      ],
    });
    const oneFindings = detectBiases(graphOne, null);
    const selectionOne = oneFindings.find((f) => f.id === "selection_low_option_count");
    expect(selectionOne).toBeDefined();
    expect(selectionOne!.severity).toBe("medium");
  });

  it("emits measurement bias when risks or outcomes are missing", () => {
    const graph = makeGraph({
      nodes: [
        { id: "g1", kind: "goal" } as any,
        { id: "opt1", kind: "option" } as any,
      ],
    });

    const findings = detectBiases(graph, null);
    const measurement = findings.find((f) => f.id === "measurement_missing_risks_or_outcomes");
    expect(measurement).toBeDefined();
    expect(measurement!.category).toBe("measurement");
  });

  it("emits optimisation bias for pricing_decision with multiple options and no risks", () => {
    const graph = makeGraph({
      nodes: [
        { id: "g1", kind: "goal" } as any,
        { id: "opt1", kind: "option" } as any,
        { id: "opt2", kind: "option" } as any,
      ],
    });

    const archetype = { decision_type: "pricing_decision" } as any;

    const findings = detectBiases(graph, archetype);
    const optimisation = findings.find((f) => f.id === "optimisation_pricing_no_risks");
    expect(optimisation).toBeDefined();
    expect(optimisation!.category).toBe("optimisation");
  });

  it("emits framing bias for single goal with multiple options and no risks", () => {
    const graph = makeGraph({
      nodes: [
        { id: "g1", kind: "goal" } as any,
        { id: "opt1", kind: "option" } as any,
        { id: "opt2", kind: "option" } as any,
      ],
    });

    const findings = detectBiases(graph, null);
    const framing = findings.find((f) => f.id === "framing_single_goal_no_risks");
    expect(framing).toBeDefined();
    expect(framing!.category).toBe("framing");
  });
});
