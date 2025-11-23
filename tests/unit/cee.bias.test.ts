import { describe, it, expect } from "vitest";
import type { GraphV1 } from "../../src/contracts/plot/engine.js";
import { detectBiases, sortBiasFindings } from "../../src/cee/bias/index.js";

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

  it("sortBiasFindings orders by severity then category then id", () => {
    const findings: any[] = [
      { id: "c", category: "framing", severity: "low", node_ids: [] },
      { id: "b", category: "optimisation", severity: "medium", node_ids: [] },
      { id: "a", category: "measurement", severity: "medium", node_ids: [] },
    ];

    const sorted = sortBiasFindings(findings as any);

    expect(sorted.map((f) => f.id)).toEqual([
      "a", // measurement (medium)
      "b", // optimisation (medium)
      "c", // framing (low)
    ]);
  });

  it("sortBiasFindings uses seed as deterministic tie-breaker when severity and category match", () => {
    const findings: any[] = [
      { id: "alpha", category: "measurement", severity: "medium", node_ids: [] },
      { id: "beta", category: "measurement", severity: "medium", node_ids: [] },
      { id: "gamma", category: "measurement", severity: "medium", node_ids: [] },
    ];

    const sorted1 = sortBiasFindings(findings as any, "seed-one");
    const sorted2 = sortBiasFindings(findings as any, "seed-two");

    expect(sorted1.map((f) => f.id)).not.toEqual(sorted2.map((f) => f.id));

    const sorted1Again = sortBiasFindings(findings as any, "seed-one");
    expect(sorted1Again.map((f) => f.id)).toEqual(sorted1.map((f) => f.id));
  });

  it("emits structural confirmation bias when one option has evidence and others do not and structural flag is enabled", () => {
    const originalFlag = process.env.CEE_BIAS_STRUCTURAL_ENABLED;
    process.env.CEE_BIAS_STRUCTURAL_ENABLED = "true";

    try {
      const graph = makeGraph({
        nodes: [
          { id: "g1", kind: "goal" } as any,
          { id: "opt_a", kind: "option" } as any,
          { id: "opt_b", kind: "option" } as any,
          { id: "r1", kind: "risk" } as any,
        ],
        edges: [{ from: "opt_a", to: "r1" } as any],
      });

      const findings = detectBiases(graph, null);
      const confirmation = findings.find((f: any) => f.code === "CONFIRMATION_BIAS");

      expect(confirmation).toBeDefined();
      expect(confirmation!.node_ids).toEqual(expect.arrayContaining(["opt_a", "opt_b"]));
    } finally {
      if (originalFlag === undefined) {
        delete process.env.CEE_BIAS_STRUCTURAL_ENABLED;
      } else {
        process.env.CEE_BIAS_STRUCTURAL_ENABLED = originalFlag;
      }
    }
  });

  it("emits structural sunk cost bias for single option with multiple actions when structural flag is enabled", () => {
    const originalFlag = process.env.CEE_BIAS_STRUCTURAL_ENABLED;
    process.env.CEE_BIAS_STRUCTURAL_ENABLED = "true";

    try {
      const graph = makeGraph({
        nodes: [
          { id: "g1", kind: "goal" } as any,
          { id: "opt1", kind: "option" } as any,
          { id: "a1", kind: "action" } as any,
          { id: "a2", kind: "action" } as any,
          { id: "a3", kind: "action" } as any,
        ],
        edges: [
          { from: "opt1", to: "a1" } as any,
          { from: "opt1", to: "a2" } as any,
          { from: "opt1", to: "a3" } as any,
        ],
      });

      const findings = detectBiases(graph, null);
      const sunkCost = findings.find((f: any) => f.code === "SUNK_COST");

      expect(sunkCost).toBeDefined();
      expect(sunkCost!.node_ids).toEqual(expect.arrayContaining(["opt1", "a1", "a2", "a3"]));
    } finally {
      if (originalFlag === undefined) {
        delete process.env.CEE_BIAS_STRUCTURAL_ENABLED;
      } else {
        process.env.CEE_BIAS_STRUCTURAL_ENABLED = originalFlag;
      }
    }
  });

  it("does not emit structural confirmation or sunk cost biases when structural flag is disabled (default)", () => {
    const originalFlag = process.env.CEE_BIAS_STRUCTURAL_ENABLED;
    delete process.env.CEE_BIAS_STRUCTURAL_ENABLED;

    try {
      const graph = makeGraph({
        nodes: [
          { id: "g1", kind: "goal" } as any,
          { id: "opt_a", kind: "option" } as any,
          { id: "opt_b", kind: "option" } as any,
          { id: "r1", kind: "risk" } as any,
          { id: "opt_single", kind: "option" } as any,
          { id: "a1", kind: "action" } as any,
          { id: "a2", kind: "action" } as any,
          { id: "a3", kind: "action" } as any,
        ],
        edges: [
          { from: "opt_a", to: "r1" } as any,
          { from: "opt_single", to: "a1" } as any,
          { from: "opt_single", to: "a2" } as any,
          { from: "opt_single", to: "a3" } as any,
        ],
      });

      const findings = detectBiases(graph, null);
      const hasStructural = findings.some(
        (f: any) => f.code === "CONFIRMATION_BIAS" || f.code === "SUNK_COST",
      );

      expect(hasStructural).toBe(false);
    } finally {
      if (originalFlag === undefined) {
        delete process.env.CEE_BIAS_STRUCTURAL_ENABLED;
      } else {
        process.env.CEE_BIAS_STRUCTURAL_ENABLED = originalFlag;
      }
    }
  });
});
