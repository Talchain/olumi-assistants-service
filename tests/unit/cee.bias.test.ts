import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { GraphV1 } from "../../src/contracts/plot/engine.js";
import { detectBiases, sortBiasFindings, filterByConfidence } from "../../src/cee/bias/index.js";
import { cleanBaseUrl } from "../helpers/env-setup.js";

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
  beforeEach(async () => {
    cleanBaseUrl();
    vi.unstubAllEnvs();
    const { _resetConfigCache } = await import("../../src/config/index.js");
    _resetConfigCache();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    cleanBaseUrl();
    const { _resetConfigCache } = await import("../../src/config/index.js");
    _resetConfigCache();
  });

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

  it("emits availability bias when recent evidence dominates and structural flag is enabled", () => {
    const originalFlag = process.env.CEE_BIAS_STRUCTURAL_ENABLED;
    process.env.CEE_BIAS_STRUCTURAL_ENABLED = "true";

    try {
      const graph = makeGraph({
        nodes: [
          { id: "r1", kind: "risk", label: "Recent incident last week" } as any,
          { id: "r2", kind: "risk", label: "Latest outage this month" } as any,
          { id: "o1", kind: "outcome", label: "Today\'s customer feedback" } as any,
          { id: "o2", kind: "outcome", label: "Historical baseline 2019-2020" } as any,
        ],
      });

      const findings = detectBiases(graph, null);
      const availability = findings.find((f: any) => f.code === "AVAILABILITY_BIAS");

      expect(availability).toBeDefined();
      expect(availability!.node_ids).toEqual(expect.arrayContaining(["r1", "r2", "o1"]));
    } finally {
      if (originalFlag === undefined) {
        delete process.env.CEE_BIAS_STRUCTURAL_ENABLED;
      } else {
        process.env.CEE_BIAS_STRUCTURAL_ENABLED = originalFlag;
      }
    }
  });

  it("emits status quo bias when change options carry disproportionate risks and structural flag is enabled", () => {
    const originalFlag = process.env.CEE_BIAS_STRUCTURAL_ENABLED;
    process.env.CEE_BIAS_STRUCTURAL_ENABLED = "true";

    try {
      const graph = makeGraph({
        nodes: [
          { id: "opt_keep", kind: "option", label: "Keep current system" } as any,
          { id: "opt_change", kind: "option", label: "Migrate to new platform" } as any,
          { id: "r1", kind: "risk", label: "Operational interruption" } as any,
          { id: "r2", kind: "risk", label: "Migration overrun" } as any,
          { id: "r3", kind: "risk", label: "Integration failure" } as any,
        ],
        edges: [
          { from: "opt_keep", to: "r1" } as any,
          { from: "opt_change", to: "r2" } as any,
          { from: "opt_change", to: "r3" } as any,
        ],
      });

      const findings = detectBiases(graph, null);
      const statusQuo = findings.find((f: any) => f.code === "STATUS_QUO_BIAS");

      expect(statusQuo).toBeDefined();
      expect(statusQuo!.node_ids).toEqual(
        expect.arrayContaining(["opt_keep", "opt_change"]),
      );
    } finally {
      if (originalFlag === undefined) {
        delete process.env.CEE_BIAS_STRUCTURAL_ENABLED;
      } else {
        process.env.CEE_BIAS_STRUCTURAL_ENABLED = originalFlag;
      }
    }
  });

  it("emits optimism bias when options connect only to outcomes and not to risks and structural flag is enabled", () => {
    const originalFlag = process.env.CEE_BIAS_STRUCTURAL_ENABLED;
    process.env.CEE_BIAS_STRUCTURAL_ENABLED = "true";

    try {
      const graph = makeGraph({
        nodes: [
          { id: "opt1", kind: "option", label: "Launch premium tier" } as any,
          { id: "opt2", kind: "option", label: "Launch basic tier" } as any,
          { id: "o1", kind: "outcome", label: "Increase revenue" } as any,
          { id: "o2", kind: "outcome", label: "Grow user base" } as any,
        ],
        edges: [
          { from: "opt1", to: "o1" } as any,
          { from: "opt2", to: "o2" } as any,
        ],
      });

      const findings = detectBiases(graph, null);
      const optimism = findings.find((f: any) => f.code === "OPTIMISM_BIAS");

      expect(optimism).toBeDefined();
      expect(optimism!.node_ids).toEqual(
        expect.arrayContaining(["opt1", "opt2", "o1", "o2"]),
      );
    } finally {
      if (originalFlag === undefined) {
        delete process.env.CEE_BIAS_STRUCTURAL_ENABLED;
      } else {
        process.env.CEE_BIAS_STRUCTURAL_ENABLED = originalFlag;
      }
    }
  });

  it("emits overconfidence bias when beliefs are high and tightly clustered and structural flag is enabled", () => {
    const originalFlag = process.env.CEE_BIAS_STRUCTURAL_ENABLED;
    process.env.CEE_BIAS_STRUCTURAL_ENABLED = "true";

    try {
      const graph = makeGraph({
        nodes: [
          { id: "opt1", kind: "option" } as any,
          { id: "opt2", kind: "option" } as any,
          { id: "o1", kind: "outcome" } as any,
          { id: "o2", kind: "outcome" } as any,
          { id: "r1", kind: "risk" } as any,
        ],
        edges: [
          { from: "opt1", to: "o1", belief: 0.9 } as any,
          { from: "opt1", to: "r1", belief: 0.93 } as any,
          { from: "opt2", to: "o2", belief: 0.95 } as any,
        ],
      });

      const findings = detectBiases(graph, null);
      const overconfidence = findings.find((f: any) => f.code === "OVERCONFIDENCE");

      expect(overconfidence).toBeDefined();
      expect(overconfidence!.node_ids).toEqual(
        expect.arrayContaining(["opt1", "opt2", "o1", "o2", "r1"]),
      );
    } finally {
      if (originalFlag === undefined) {
        delete process.env.CEE_BIAS_STRUCTURAL_ENABLED;
      } else {
        process.env.CEE_BIAS_STRUCTURAL_ENABLED = originalFlag;
      }
    }
  });

  it("emits authority bias when an authority-labelled node is highly connected and structural flag is enabled", () => {
    const originalFlag = process.env.CEE_BIAS_STRUCTURAL_ENABLED;
    process.env.CEE_BIAS_STRUCTURAL_ENABLED = "true";

    try {
      const graph = makeGraph({
        nodes: [
          { id: "n_ceo", kind: "decision", label: "CEO approval" } as any,
          { id: "opt1", kind: "option" } as any,
          { id: "opt2", kind: "option" } as any,
          { id: "opt3", kind: "option" } as any,
        ],
        edges: [
          { from: "n_ceo", to: "opt1" } as any,
          { from: "n_ceo", to: "opt2" } as any,
          { from: "n_ceo", to: "opt3" } as any,
        ],
      });

      const findings = detectBiases(graph, null);
      const authority = findings.find((f: any) => f.code === "AUTHORITY_BIAS");

      expect(authority).toBeDefined();
      expect(authority!.node_ids).toEqual(
        expect.arrayContaining(["n_ceo", "opt1", "opt2", "opt3"]),
      );
    } finally {
      if (originalFlag === undefined) {
        delete process.env.CEE_BIAS_STRUCTURAL_ENABLED;
      } else {
        process.env.CEE_BIAS_STRUCTURAL_ENABLED = originalFlag;
      }
    }
  });

  it("emits framing effect bias when outcomes share a percentage but mix gain and loss framing and structural flag is enabled", () => {
    const originalFlag = process.env.CEE_BIAS_STRUCTURAL_ENABLED;
    process.env.CEE_BIAS_STRUCTURAL_ENABLED = "true";

    try {
      const graph = makeGraph({
        nodes: [
          { id: "g1", kind: "goal", label: "Treatment decision" } as any,
          { id: "o_gain", kind: "outcome", label: "70% chance to survive" } as any,
          { id: "o_loss", kind: "outcome", label: "70% risk of death" } as any,
        ],
      });

      const findings = detectBiases(graph, null);
      const framing = findings.find((f: any) => f.code === "FRAMING_EFFECT");

      expect(framing).toBeDefined();
      expect(framing!.node_ids).toEqual(
        expect.arrayContaining(["g1", "o_gain", "o_loss"]),
      );
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

describe("filterByConfidence", () => {
  it("filters out findings below threshold", () => {
    const findings: any[] = [
      { id: "low", category: "selection", severity: "low", node_ids: [], confidence: 0.2 },
      { id: "high", category: "measurement", severity: "high", node_ids: [], confidence: 0.8 },
    ];

    const filtered = filterByConfidence(findings, 0.5);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe("high");
  });

  it("keeps findings at exactly threshold", () => {
    const findings: any[] = [
      { id: "exact", category: "selection", severity: "medium", node_ids: [], confidence: 0.3 },
    ];

    const filtered = filterByConfidence(findings, 0.3);
    expect(filtered).toHaveLength(1);
  });

  it("keeps findings without confidence score", () => {
    const findings: any[] = [
      { id: "no_conf", category: "selection", severity: "medium", node_ids: [] },
      { id: "with_conf", category: "measurement", severity: "low", node_ids: [], confidence: 0.1 },
    ];

    const filtered = filterByConfidence(findings, 0.5);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe("no_conf");
  });

  it("uses config threshold when none provided", () => {
    // Default config threshold is 0.3
    const findings: any[] = [
      { id: "low", category: "selection", severity: "low", node_ids: [], confidence: 0.2 },
      { id: "high", category: "measurement", severity: "high", node_ids: [], confidence: 0.5 },
    ];

    const filtered = filterByConfidence(findings);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe("high");
  });

  it("returns empty array when all findings are below threshold", () => {
    const findings: any[] = [
      { id: "a", category: "selection", severity: "low", node_ids: [], confidence: 0.1 },
      { id: "b", category: "measurement", severity: "low", node_ids: [], confidence: 0.2 },
    ];

    const filtered = filterByConfidence(findings, 0.5);
    expect(filtered).toHaveLength(0);
  });

  it("returns all findings when threshold is 0", () => {
    const findings: any[] = [
      { id: "a", category: "selection", severity: "low", node_ids: [], confidence: 0.1 },
      { id: "b", category: "measurement", severity: "low", node_ids: [], confidence: 0.01 },
    ];

    const filtered = filterByConfidence(findings, 0);
    expect(filtered).toHaveLength(2);
  });
});
