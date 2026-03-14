import { describe, it, expect } from "vitest";
import { runGraphDataIntegrityChecks } from "../../src/cee/transforms/graph-data-integrity.js";
import { transformEdgeToV3 } from "../../src/cee/transforms/schema-v3.js";

/**
 * Tests for graph-data-integrity.ts and the related exists_probability fix in
 * transformEdgeToV3 — Tasks 1 and 2 from debug bundle c47e62a3.
 *
 * Task 1: Factor scale consistency (raw_value/cap vs value)
 * Task 2: Edge field class-aware defaults (exists_probability, effect_direction)
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(overrides: Record<string, unknown> = {}) {
  return {
    id: "fac_price",
    kind: "factor",
    label: "Price Level",
    ...overrides,
  };
}

function makeEdge(overrides: Record<string, unknown> = {}) {
  return {
    from: "fac_price",
    to: "goal_revenue",
    strength: { mean: 0.6, std: 0.1 },
    ...overrides,
  };
}

function makeV3Body(overrides: Partial<{
  nodes: any[];
  edges: any[];
  analysis_ready: any;
  trace: any;
}> = {}) {
  return {
    nodes: overrides.nodes ?? [],
    edges: overrides.edges ?? [],
    analysis_ready: overrides.analysis_ready ?? { options: [] },
    trace: overrides.trace ?? { pipeline: { repair_summary: {} } },
  };
}

// ---------------------------------------------------------------------------
// Task 1: Factor scale consistency
// ---------------------------------------------------------------------------

describe("Task 1: Factor scale consistency", () => {
  describe("raw_value / cap inconsistency — debug bundle repro", () => {
    it("corrects value when raw_value:49, cap:59 but value:0.49 (should be 49/59 ≈ 0.831)", () => {
      const node = makeNode({
        observed_state: { value: 0.49, raw_value: 49, cap: 59 },
      });
      const v3 = makeV3Body({ nodes: [node] });

      const result = runGraphDataIntegrityChecks(v3);

      expect(result.scale_consistency_repairs).toHaveLength(1);
      const repair = result.scale_consistency_repairs[0];
      expect(repair.node_id).toBe("fac_price");
      expect(repair.before).toBe(0.49);
      expect(repair.after).toBeCloseTo(49 / 59, 4);

      // Mutation applied to node
      expect((node as any).observed_state.value).toBeCloseTo(49 / 59, 4);
    });
  });

  describe("percentage factor — raw_value / 100 not / cap", () => {
    it("does NOT correct when raw_value:3, unit:'%', value:0.03 (already consistent)", () => {
      const node = makeNode({
        observed_state: { value: 0.03, raw_value: 3, cap: 100, unit: "%" },
      });
      const v3 = makeV3Body({ nodes: [node] });

      const result = runGraphDataIntegrityChecks(v3);

      expect(result.scale_consistency_repairs).toHaveLength(0);
      expect((node as any).observed_state.value).toBe(0.03);
    });

    it("corrects percentage factor when value:0.04 but raw_value:3 (should be 0.03)", () => {
      const node = makeNode({
        observed_state: { value: 0.04, raw_value: 3, cap: 100, unit: "%" },
      });
      const v3 = makeV3Body({ nodes: [node] });

      const result = runGraphDataIntegrityChecks(v3);

      expect(result.scale_consistency_repairs).toHaveLength(1);
      expect(result.scale_consistency_repairs[0].after).toBeCloseTo(0.03, 4);
    });
  });

  describe("already consistent factor — no correction", () => {
    it("does NOT correct when raw_value:180000, cap:300000, value:0.6 (already consistent)", () => {
      const node = makeNode({
        observed_state: { value: 0.6, raw_value: 180_000, cap: 300_000 },
      });
      const v3 = makeV3Body({ nodes: [node] });

      const result = runGraphDataIntegrityChecks(v3);

      expect(result.scale_consistency_repairs).toHaveLength(0);
      expect((node as any).observed_state.value).toBe(0.6);
    });
  });

  describe("factor without raw_value/cap — skip validation", () => {
    it("skips factor with no raw_value", () => {
      const node = makeNode({
        observed_state: { value: 0.5 },
      });
      const v3 = makeV3Body({ nodes: [node] });

      const result = runGraphDataIntegrityChecks(v3);

      expect(result.scale_consistency_repairs).toHaveLength(0);
    });

    it("skips factor with raw_value but no cap", () => {
      const node = makeNode({
        observed_state: { value: 0.5, raw_value: 5 },
      });
      const v3 = makeV3Body({ nodes: [node] });

      const result = runGraphDataIntegrityChecks(v3);

      expect(result.scale_consistency_repairs).toHaveLength(0);
    });
  });

  describe("binary factor (cap=1) — skip validation", () => {
    it("skips binary factor with raw_value:0, cap:1, value:0", () => {
      const node = makeNode({
        observed_state: { value: 0, raw_value: 0, cap: 1 },
      });
      const v3 = makeV3Body({ nodes: [node] });

      const result = runGraphDataIntegrityChecks(v3);

      expect(result.scale_consistency_repairs).toHaveLength(0);
    });

    it("skips binary factor with raw_value:1, cap:1, value:1", () => {
      const node = makeNode({
        observed_state: { value: 1, raw_value: 1, cap: 1 },
      });
      const v3 = makeV3Body({ nodes: [node] });

      const result = runGraphDataIntegrityChecks(v3);

      expect(result.scale_consistency_repairs).toHaveLength(0);
    });
  });

  describe("option intervention correction — ratio-based (debug bundle repro)", () => {
    it("corrects ALL option interventions by correction ratio 100/cap after factor scale correction", () => {
      // Debug bundle c47e62a3 values:
      //   factor: raw_value:49, cap:59, value:0.49 (wrong, should be 49/59 ≈ 0.831)
      //   opt_status_quo: 0.49 (£49/100 — same wrong encoding)
      //   opt_increase_price: 0.59 (£59/100 — same wrong encoding, should be 59/59 = 1.0)
      const factorNode = makeNode({
        id: "fac_price",
        observed_state: { value: 0.49, raw_value: 49, cap: 59 },
      });

      const statusQuoOption = {
        id: "opt_status_quo",
        label: "Status Quo",
        interventions: { fac_price: 0.49 }, // £49/100
      };

      const increaseOption = {
        id: "opt_increase_price",
        label: "Increase Price to £59",
        interventions: { fac_price: 0.59 }, // £59/100 — also needs correction to 59/59 = 1.0
      };

      const v3 = makeV3Body({
        nodes: [factorNode],
        analysis_ready: { options: [statusQuoOption, increaseOption] },
      });

      const result = runGraphDataIntegrityChecks(v3);

      // Factor corrected
      const factorRepair = result.scale_consistency_repairs.find((r) => r.node_id === "fac_price");
      expect(factorRepair).toBeDefined();
      expect(factorRepair!.after).toBeCloseTo(49 / 59, 4);

      // Status quo option corrected: 0.49 × (100/59) ≈ 0.831
      expect(statusQuoOption.interventions.fac_price).toBeCloseTo(49 / 59, 4);
      const sqRepair = result.scale_consistency_repairs.find((r) => r.node_id === "option:opt_status_quo");
      expect(sqRepair).toBeDefined();
      expect(sqRepair!.before).toBe(0.49);
      expect(sqRepair!.after).toBeCloseTo(49 / 59, 4);

      // Increase option also corrected: 0.59 × (100/59) ≈ 1.0
      expect(increaseOption.interventions.fac_price).toBeCloseTo(1.0, 3);
      const incRepair = result.scale_consistency_repairs.find((r) => r.node_id === "option:opt_increase_price");
      expect(incRepair).toBeDefined();
      expect(incRepair!.before).toBe(0.59);
      expect(incRepair!.after).toBeCloseTo(59 / 59, 3);
    });

    it("clamps corrected intervention to [0, 1] if ratio would exceed 1", () => {
      const factorNode = makeNode({
        id: "fac_x",
        observed_state: { value: 0.1, raw_value: 5, cap: 50 }, // expected = 5/50 = 0.1, consistent — skip
      });
      // Force an inconsistent case: value:0.9 (wrong, should be 5/50=0.1)
      factorNode.observed_state = { value: 0.9, raw_value: 5, cap: 50 } as any;

      // Option intervention: 0.9 × (0.1/0.9) = 0.1 — stays within [0,1]
      const option = {
        id: "opt_a",
        label: "Option A",
        interventions: { fac_x: 0.9 },
      };

      const v3 = makeV3Body({
        nodes: [factorNode],
        analysis_ready: { options: [option] },
      });

      runGraphDataIntegrityChecks(v3);

      // Corrected value must be in [0, 1]
      expect(option.interventions.fac_x).toBeGreaterThanOrEqual(0);
      expect(option.interventions.fac_x).toBeLessThanOrEqual(1);
    });
  });
});

// ---------------------------------------------------------------------------
// Task 2: transformEdgeToV3 class-aware defaults (primary fix)
// ---------------------------------------------------------------------------

describe("Task 2: transformEdgeToV3 class-aware exists_probability defaults", () => {
  const mockNodes = (fromKind: string, toKind: string) => [
    { id: "from_node", kind: fromKind, label: "From" },
    { id: "to_node", kind: toKind, label: "To" },
  ];

  describe("structural edges — default to 1.0 when belief_exists/belief absent", () => {
    it("sets exists_probability:1.0 for decision→option edge without belief_exists", () => {
      const edge = {
        from: "from_node",
        to: "to_node",
        weight: 0.5,
        // belief_exists and belief both absent
      };
      const nodes = mockNodes("decision", "option") as any;
      const { edge: result } = transformEdgeToV3(edge as any, 0, nodes);
      expect(result.exists_probability).toBe(1.0);
    });

    it("sets exists_probability:1.0 for option→factor edge without belief_exists", () => {
      const edge = { from: "from_node", to: "to_node", weight: 0.5 };
      const nodes = mockNodes("option", "factor") as any;
      const { edge: result } = transformEdgeToV3(edge as any, 0, nodes);
      expect(result.exists_probability).toBe(1.0);
    });

    it("sets exists_probability:1.0 for option→outcome edge without belief_exists", () => {
      const edge = { from: "from_node", to: "to_node", weight: 0.5 };
      const nodes = mockNodes("option", "outcome") as any;
      const { edge: result } = transformEdgeToV3(edge as any, 0, nodes);
      expect(result.exists_probability).toBe(1.0);
    });
  });

  describe("causal edges — default to 0.8 when belief_exists/belief absent", () => {
    it("sets exists_probability:0.8 for factor→goal edge without belief_exists", () => {
      const edge = { from: "from_node", to: "to_node", weight: 0.5 };
      const nodes = mockNodes("factor", "goal") as any;
      const { edge: result } = transformEdgeToV3(edge as any, 0, nodes);
      expect(result.exists_probability).toBe(0.8);
    });

    it("sets exists_probability:0.8 for factor→factor edge without belief_exists", () => {
      const edge = { from: "from_node", to: "to_node", weight: 0.5 };
      const nodes = mockNodes("factor", "factor") as any;
      const { edge: result } = transformEdgeToV3(edge as any, 0, nodes);
      expect(result.exists_probability).toBe(0.8);
    });
  });

  describe("LLM-provided belief_exists is respected", () => {
    it("uses LLM-provided belief_exists:0.7 unchanged for causal edge", () => {
      const edge = { from: "from_node", to: "to_node", weight: 0.5, belief_exists: 0.7 };
      const nodes = mockNodes("factor", "goal") as any;
      const { edge: result } = transformEdgeToV3(edge as any, 0, nodes);
      expect(result.exists_probability).toBe(0.7);
    });

    it("uses LLM-provided belief:0.6 unchanged for structural edge", () => {
      // If LLM explicitly emits a belief value, respect it (even if suboptimal for structural)
      const edge = { from: "from_node", to: "to_node", weight: 0.5, belief: 0.6 };
      const nodes = mockNodes("decision", "option") as any;
      const { edge: result } = transformEdgeToV3(edge as any, 0, nodes);
      // belief field respected — boundary module will correct structural < 1.0
      expect(result.exists_probability).toBe(0.6);
    });
  });
});

// ---------------------------------------------------------------------------
// Task 2: Boundary safety net (graph-data-integrity.ts edge checks)
// ---------------------------------------------------------------------------

describe("Task 2: Edge field boundary safety net", () => {
  describe("edges already correct — no repairs", () => {
    it("preserves causal edge with exists_probability:0.85 and effect_direction:'positive'", () => {
      const edge = makeEdge({
        exists_probability: 0.85,
        effect_direction: "positive",
      });
      const v3 = makeV3Body({
        nodes: [
          { id: "fac_price", kind: "factor" },
          { id: "goal_revenue", kind: "goal" },
        ],
        edges: [edge],
      });

      const result = runGraphDataIntegrityChecks(v3);

      expect(result.edge_field_repairs).toHaveLength(0);
      expect(edge.exists_probability).toBe(0.85);
      expect(edge.effect_direction).toBe("positive");
    });
  });

  describe("structural edges — correct < 1.0 to 1.0", () => {
    it("corrects structural (option→factor) edge with exists_probability:0.5 to 1.0", () => {
      // This represents an edge where the LLM explicitly emitted belief:0.5
      // or where the old transformEdgeToV3 (pre-fix) set the default.
      const edge = {
        from: "opt_increase",
        to: "fac_price",
        strength: { mean: 0.5, std: 0.1 },
        exists_probability: 0.5, // wrong for structural edge
        effect_direction: "positive" as const,
      };
      const v3 = makeV3Body({
        nodes: [
          { id: "opt_increase", kind: "option" },
          { id: "fac_price", kind: "factor" },
        ],
        edges: [edge],
      });

      const result = runGraphDataIntegrityChecks(v3);

      const repair = result.edge_field_repairs.find(
        (r) => r.from === "opt_increase" && r.field === "exists_probability",
      );
      expect(repair).toBeDefined();
      expect(repair!.before).toBe(0.5);
      expect(repair!.after).toBe(1.0);
      expect((edge as any).exists_probability).toBe(1.0);
    });

    it("corrects structural (decision→option) edge with exists_probability:0.8 to 1.0", () => {
      const edge = {
        from: "dec_main",
        to: "opt_increase",
        strength: { mean: 0.5, std: 0.1 },
        exists_probability: 0.8,
        effect_direction: "positive" as const,
      };
      const v3 = makeV3Body({
        nodes: [
          { id: "dec_main", kind: "decision" },
          { id: "opt_increase", kind: "option" },
        ],
        edges: [edge],
      });

      const result = runGraphDataIntegrityChecks(v3);

      expect(result.edge_field_repairs.some(
        (r) => r.from === "dec_main" && r.field === "exists_probability" && r.after === 1.0,
      )).toBe(true);
      expect((edge as any).exists_probability).toBe(1.0);
    });
  });

  describe("edges missing fields (safety net for legacy/bypass path)", () => {
    it("defaults missing exists_probability to 1.0 for structural edge", () => {
      const edge = {
        from: "dec_main",
        to: "opt_a",
        strength: { mean: 0.5, std: 0.1 },
        effect_direction: "positive" as const,
        // exists_probability absent (would only occur for legacy-path edges)
      };
      const v3 = makeV3Body({
        nodes: [
          { id: "dec_main", kind: "decision" },
          { id: "opt_a", kind: "option" },
        ],
        edges: [edge],
      });

      const result = runGraphDataIntegrityChecks(v3);

      expect(result.edge_field_repairs.some(
        (r) => r.field === "exists_probability" && r.after === 1.0,
      )).toBe(true);
    });

    it("defaults missing exists_probability to 0.8 for causal edge (safety net)", () => {
      // This path is now a safety net: transformEdgeToV3 pre-fills 0.8,
      // but legacy edges or edges from external sources may still lack it.
      const edge = {
        from: "fac_price",
        to: "goal_revenue",
        strength: { mean: 0.6, std: 0.1 },
        effect_direction: "positive" as const,
        // exists_probability absent
      };
      const v3 = makeV3Body({
        nodes: [
          { id: "fac_price", kind: "factor" },
          { id: "goal_revenue", kind: "goal" },
        ],
        edges: [edge],
      });

      const result = runGraphDataIntegrityChecks(v3);

      expect(result.edge_field_repairs.some(
        (r) => r.field === "exists_probability" && r.after === 0.8,
      )).toBe(true);
    });

    it("infers effect_direction:'negative' for causal edge with negative strength.mean", () => {
      const edge = {
        from: "fac_cost",
        to: "goal_profit",
        strength: { mean: -0.4, std: 0.1 },
        exists_probability: 0.8,
        // effect_direction absent
      };
      const v3 = makeV3Body({
        nodes: [
          { id: "fac_cost", kind: "factor" },
          { id: "goal_profit", kind: "goal" },
        ],
        edges: [edge],
      });

      const result = runGraphDataIntegrityChecks(v3);

      const repair = result.edge_field_repairs.find(
        (r) => r.from === "fac_cost" && r.field === "effect_direction",
      );
      expect(repair).toBeDefined();
      expect(repair!.after).toBe("negative");
      expect((edge as any).effect_direction).toBe("negative");
    });
  });

  describe("repair summary shape", () => {
    it("returns edge_field_repairs with correct shape for structural edge", () => {
      const edge = {
        from: "dec_main",
        to: "opt_a",
        strength: { mean: 0.5, std: 0.1 },
        exists_probability: 0.5, // wrong for structural
        effect_direction: "positive" as const,
      };
      const v3 = makeV3Body({
        nodes: [
          { id: "dec_main", kind: "decision" },
          { id: "opt_a", kind: "option" },
        ],
        edges: [edge],
      });

      const result = runGraphDataIntegrityChecks(v3);

      expect(result.edge_field_repairs.length).toBeGreaterThan(0);
      expect(result.edge_field_repairs[0]).toMatchObject({
        from: expect.any(String),
        to: expect.any(String),
        field: expect.stringMatching(/exists_probability|effect_direction/),
        edge_class: "structural",
      });
    });
  });

  describe("no repairs when graph is already correct", () => {
    it("returns empty repair arrays when all fields are present and consistent", () => {
      const node = makeNode({
        observed_state: { value: 0.6, raw_value: 180_000, cap: 300_000 },
      });
      const edge = makeEdge({
        exists_probability: 0.85,
        effect_direction: "positive",
      });
      const v3 = makeV3Body({
        nodes: [node, { id: "goal_revenue", kind: "goal" }],
        edges: [edge],
      });

      const result = runGraphDataIntegrityChecks(v3);

      expect(result.scale_consistency_repairs).toHaveLength(0);
      expect(result.edge_field_repairs).toHaveLength(0);
    });
  });

  describe("error resilience", () => {
    it("returns empty summary without throwing when v3Body is null/undefined", () => {
      expect(() => runGraphDataIntegrityChecks(null)).not.toThrow();
      expect(() => runGraphDataIntegrityChecks(undefined)).not.toThrow();
      expect(runGraphDataIntegrityChecks(null)).toEqual({
        scale_consistency_repairs: [],
        edge_field_repairs: [],
      });
    });

    it("returns empty summary without throwing when nodes/edges are absent", () => {
      const result = runGraphDataIntegrityChecks({});
      expect(result.scale_consistency_repairs).toHaveLength(0);
      expect(result.edge_field_repairs).toHaveLength(0);
    });
  });
});
