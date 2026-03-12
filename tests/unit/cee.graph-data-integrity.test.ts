import { describe, it, expect } from "vitest";
import { runGraphDataIntegrityChecks } from "../../src/cee/transforms/graph-data-integrity.js";

/**
 * Tests for graph-data-integrity.ts — Tasks 1 and 2 from debug bundle c47e62a3.
 *
 * Task 1: Factor scale consistency (raw_value/cap vs value)
 * Task 2: Edge field defaults (exists_probability, effect_direction)
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

  describe("option intervention correction", () => {
    it("corrects option intervention matching the wrong baseline after factor scale correction", () => {
      const factorNode = makeNode({
        id: "fac_price",
        observed_state: { value: 0.49, raw_value: 49, cap: 59 },
      });

      // Status quo option has intervention matching the wrong baseline
      const statusQuoOption = {
        id: "opt_status_quo",
        label: "Status Quo",
        interventions: { fac_price: 0.49 }, // matches wrong baseline
      };

      // Different option with a different value — should NOT be corrected
      const increaseOption = {
        id: "opt_increase",
        label: "Increase Price",
        interventions: { fac_price: 0.59 }, // £59/£100 = 0.59, not matching wrong baseline
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

      // Status quo option corrected (matched wrong baseline ≈ 0.49)
      const interventionRepair = result.scale_consistency_repairs.find(
        (r) => r.node_id === "option:opt_status_quo",
      );
      expect(interventionRepair).toBeDefined();
      expect(statusQuoOption.interventions.fac_price).toBeCloseTo(49 / 59, 4);

      // Increase option NOT corrected (0.59 not close to wrong baseline 0.49)
      expect(increaseOption.interventions.fac_price).toBe(0.59);
    });
  });
});

// ---------------------------------------------------------------------------
// Task 2: Edge field defaults
// ---------------------------------------------------------------------------

describe("Task 2: Edge field defaults (exists_probability, effect_direction)", () => {
  describe("exists_probability and effect_direction already present — no change", () => {
    it("preserves edge with exists_probability and effect_direction present", () => {
      const edge = makeEdge({
        exists_probability: 0.9,
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
      expect(edge.exists_probability).toBe(0.9);
      expect(edge.effect_direction).toBe("positive");
    });
  });

  describe("structural edges — default to 1.0 / positive", () => {
    it("defaults structural (decision→option) edge missing exists_probability to 1.0", () => {
      const edge = {
        from: "dec_main",
        to: "opt_increase",
        strength: { mean: 0.5, std: 0.1 },
        effect_direction: "positive" as const,
        // exists_probability missing
      };
      const v3 = makeV3Body({
        nodes: [
          { id: "dec_main", kind: "decision" },
          { id: "opt_increase", kind: "option" },
        ],
        edges: [edge],
      });

      const result = runGraphDataIntegrityChecks(v3);

      const repair = result.edge_field_repairs.find(
        (r) => r.from === "dec_main" && r.field === "exists_probability",
      );
      expect(repair).toBeDefined();
      expect(repair!.after).toBe(1.0);
      expect(repair!.edge_class).toBe("structural");
      expect((edge as any).exists_probability).toBe(1.0);
    });

    it("corrects structural (option→factor) edge with exists_probability < 1.0 to 1.0", () => {
      const edge = {
        from: "opt_increase",
        to: "fac_price",
        strength: { mean: 0.5, std: 0.1 },
        exists_probability: 0.8, // wrong for structural edge
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
      expect(repair!.before).toBe(0.8);
      expect(repair!.after).toBe(1.0);
      expect((edge as any).exists_probability).toBe(1.0);
    });

    it("defaults structural edge missing effect_direction to 'positive'", () => {
      const edge = {
        from: "dec_main",
        to: "opt_increase",
        strength: { mean: 0.5, std: 0.1 },
        exists_probability: 1.0,
        // effect_direction missing
      };
      const v3 = makeV3Body({
        nodes: [
          { id: "dec_main", kind: "decision" },
          { id: "opt_increase", kind: "option" },
        ],
        edges: [edge],
      });

      const result = runGraphDataIntegrityChecks(v3);

      const repair = result.edge_field_repairs.find(
        (r) => r.from === "dec_main" && r.field === "effect_direction",
      );
      expect(repair).toBeDefined();
      expect(repair!.after).toBe("positive");
      expect((edge as any).effect_direction).toBe("positive");
    });
  });

  describe("causal edges — default to 0.8 / sign-inferred direction", () => {
    it("defaults causal edge missing exists_probability to 0.8", () => {
      const edge = {
        from: "fac_price",
        to: "goal_revenue",
        strength: { mean: 0.6, std: 0.1 },
        effect_direction: "positive" as const,
        // exists_probability missing
      };
      const v3 = makeV3Body({
        nodes: [
          { id: "fac_price", kind: "factor" },
          { id: "goal_revenue", kind: "goal" },
        ],
        edges: [edge],
      });

      const result = runGraphDataIntegrityChecks(v3);

      const repair = result.edge_field_repairs.find(
        (r) => r.from === "fac_price" && r.field === "exists_probability",
      );
      expect(repair).toBeDefined();
      expect(repair!.after).toBe(0.8);
      expect(repair!.edge_class).toBe("causal");
      expect((edge as any).exists_probability).toBe(0.8);
    });

    it("defaults causal edge with negative strength.mean to effect_direction:'negative'", () => {
      const edge = {
        from: "fac_cost",
        to: "goal_profit",
        strength: { mean: -0.4, std: 0.1 },
        exists_probability: 0.8,
        // effect_direction missing
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

    it("defaults causal edge with positive strength.mean to effect_direction:'positive'", () => {
      const edge = {
        from: "fac_marketing",
        to: "goal_revenue",
        strength: { mean: 0.7, std: 0.1 },
        exists_probability: 0.8,
        // effect_direction missing
      };
      const v3 = makeV3Body({
        nodes: [
          { id: "fac_marketing", kind: "factor" },
          { id: "goal_revenue", kind: "goal" },
        ],
        edges: [edge],
      });

      const result = runGraphDataIntegrityChecks(v3);

      const repair = result.edge_field_repairs.find(
        (r) => r.from === "fac_marketing" && r.field === "effect_direction",
      );
      expect(repair).toBeDefined();
      expect(repair!.after).toBe("positive");
    });
  });

  describe("repair summary shape", () => {
    it("returns edge_field_repairs with correct shape for structural edge missing both fields", () => {
      const edge = {
        from: "dec_main",
        to: "opt_a",
        strength: { mean: 0.5, std: 0.1 },
        // both exists_probability and effect_direction missing
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
