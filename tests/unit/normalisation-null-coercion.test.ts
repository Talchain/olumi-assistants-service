/**
 * Null coercion tests for normaliseDraftResponse.
 *
 * Anthropic required-nullable fields produce `null` when the LLM can't
 * fill them. The normaliser must coerce null → undefined so downstream
 * code (deterministic sweep, Zod validation) treats them as absent.
 */

import { describe, it, expect, vi } from "vitest";
import { normaliseDraftResponse } from "../../src/adapters/llm/normalisation.js";
import { DraftGraphOutput } from "../../src/schemas/assist.js";

// Suppress noisy logs
vi.mock("../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  TelemetryEvents: {},
}));

describe("normaliseDraftResponse — null coercion", () => {
  describe("node-level nullable fields", () => {
    it("coerces null category to undefined", () => {
      const raw = {
        nodes: [{ id: "fac_1", kind: "factor", label: "F", category: null }],
        edges: [],
      };
      const result = normaliseDraftResponse(raw) as any;
      expect(result.nodes[0].category).toBeUndefined();
    });

    it("coerces null data to undefined", () => {
      const raw = {
        nodes: [{ id: "fac_1", kind: "factor", label: "F", data: null }],
        edges: [],
      };
      const result = normaliseDraftResponse(raw) as any;
      expect(result.nodes[0].data).toBeUndefined();
    });

    it("coerces null prior to undefined", () => {
      const raw = {
        nodes: [{ id: "fac_1", kind: "factor", label: "F", prior: null }],
        edges: [],
      };
      const result = normaliseDraftResponse(raw) as any;
      expect(result.nodes[0].prior).toBeUndefined();
    });

    it("coerces null goal_threshold fields to undefined", () => {
      const raw = {
        nodes: [{
          id: "goal_1", kind: "goal", label: "G",
          goal_threshold: null,
          goal_threshold_raw: null,
          goal_threshold_unit: null,
        }],
        edges: [],
      };
      const result = normaliseDraftResponse(raw) as any;
      expect(result.nodes[0].goal_threshold).toBeUndefined();
      expect(result.nodes[0].goal_threshold_raw).toBeUndefined();
      expect(result.nodes[0].goal_threshold_unit).toBeUndefined();
    });
  });

  describe("data sub-field nullable fields", () => {
    it("coerces null data sub-fields to undefined", () => {
      const raw = {
        nodes: [{
          id: "fac_1", kind: "factor", label: "F",
          data: {
            value: 0.5,
            extractionType: null,
            factor_type: null,
            uncertainty_drivers: null,
            interventions: null,
            raw_value: null,
            unit: null,
            cap: null,
          },
        }],
        edges: [],
      };
      const result = normaliseDraftResponse(raw) as any;
      const d = result.nodes[0].data;
      expect(d.value).toBe(0.5); // non-null preserved
      expect(d.extractionType).toBeUndefined();
      expect(d.factor_type).toBeUndefined();
      expect(d.uncertainty_drivers).toBeUndefined();
      expect(d.interventions).toBeUndefined();
      expect(d.raw_value).toBeUndefined();
      expect(d.unit).toBeUndefined();
      expect(d.cap).toBeUndefined();
    });
  });

  describe("prior sub-field nullable fields", () => {
    it("coerces null prior sub-fields to undefined", () => {
      const raw = {
        nodes: [{
          id: "fac_ext", kind: "factor", label: "F",
          prior: { distribution: null, range_min: null, range_max: null },
        }],
        edges: [],
      };
      const result = normaliseDraftResponse(raw) as any;
      const p = result.nodes[0].prior;
      expect(p.distribution).toBeUndefined();
      expect(p.range_min).toBeUndefined();
      expect(p.range_max).toBeUndefined();
    });
  });

  describe("edge nullable fields", () => {
    it("coerces null exists_probability and effect_direction to undefined", () => {
      const raw = {
        nodes: [],
        edges: [{
          from: "a", to: "b",
          strength: { mean: 0.5, std: 0.1 },
          exists_probability: null,
          effect_direction: null,
        }],
      };
      const result = normaliseDraftResponse(raw) as any;
      const e = result.edges[0];
      // null coerced to undefined — strength extraction skips undefined
      expect(e.exists_probability).toBeUndefined();
      expect(e.effect_direction).toBeUndefined();
      // V4 strength extraction should still work
      expect(e.strength_mean).toBe(0.5);
    });
  });

  describe("data.value string coercion", () => {
    it("coerces string data.value to number and preserves data object", () => {
      const raw = {
        nodes: [{
          id: "fac_1", kind: "factor", label: "F",
          data: { value: "0.6", factor_type: "cost", extractionType: "explicit" },
        }],
        edges: [],
      };
      const result = normaliseDraftResponse(raw) as any;
      expect(result.nodes[0].data).toBeDefined();
      expect(result.nodes[0].data.value).toBe(0.6);
      expect(result.nodes[0].data.factor_type).toBe("cost");
      expect(result.nodes[0].data.extractionType).toBe("explicit");
    });

    it("coerces string data.raw_value and data.cap to number", () => {
      const raw = {
        nodes: [{
          id: "fac_1", kind: "factor", label: "F",
          data: { value: 0.5, raw_value: "180000", cap: "300000" },
        }],
        edges: [],
      };
      const result = normaliseDraftResponse(raw) as any;
      expect(result.nodes[0].data.raw_value).toBe(180000);
      expect(result.nodes[0].data.cap).toBe(300000);
    });

    it("does not strip data with NaN string value but preserves factor metadata", () => {
      const raw = {
        nodes: [{
          id: "fac_1", kind: "factor", label: "F",
          data: { value: "not_a_number", factor_type: "cost", extractionType: "explicit" },
        }],
        edges: [],
      };
      const result = normaliseDraftResponse(raw) as any;
      // factor_type/extractionType should prevent stripping
      expect(result.nodes[0].data).toBeDefined();
      expect(result.nodes[0].data.factor_type).toBe("cost");
    });
  });

  describe("data preservation with null value but factor metadata", () => {
    it("preserves data object when value is null but factor_type present", () => {
      const raw = {
        nodes: [{
          id: "fac_1", kind: "factor", label: "F",
          data: {
            value: null,
            factor_type: "cost",
            extractionType: "explicit",
            uncertainty_drivers: ["Market volatility"],
          },
        }],
        edges: [],
      };
      const result = normaliseDraftResponse(raw) as any;
      // data should NOT be stripped — factor metadata preserved
      expect(result.nodes[0].data).toBeDefined();
      expect(result.nodes[0].data.factor_type).toBe("cost");
      expect(result.nodes[0].data.extractionType).toBe("explicit");
      expect(result.nodes[0].data.uncertainty_drivers).toEqual(["Market volatility"]);
      // value should be coerced null → undefined
      expect(result.nodes[0].data.value).toBeUndefined();
    });

    it("still strips truly empty data objects", () => {
      const raw = {
        nodes: [{
          id: "fac_1", kind: "factor", label: "F",
          data: { value: null, extractionType: null, factor_type: null },
        }],
        edges: [],
      };
      const result = normaliseDraftResponse(raw) as any;
      // All fields became undefined — no union key and no factor metadata
      expect(result.nodes[0].data).toBeUndefined();
    });
  });

  describe("Zod DraftGraphOutput parse with nullable fields", () => {
    it("graph with mix of populated and null factor data passes DraftGraphOutput", () => {
      // Simulates Anthropic output after null coercion by normaliser
      const normalised = normaliseDraftResponse({
        nodes: [
          { id: "dec_1", kind: "decision", label: "D" },
          { id: "opt_1", kind: "option", label: "O", data: { interventions: [{ factor_id: "fac_1", value: 0.5 }], value: null, extractionType: null, factor_type: null, uncertainty_drivers: null } },
          {
            id: "fac_1", kind: "factor", label: "F",
            category: "controllable",
            data: { value: 0.5, extractionType: "inferred", factor_type: null, uncertainty_drivers: null, interventions: null, raw_value: null, unit: null, cap: null },
          },
          { id: "fac_ext", kind: "factor", label: "Ext", category: "external", data: null, prior: { distribution: "uniform", range_min: 0.1, range_max: 0.9 } },
          { id: "out_1", kind: "outcome", label: "Out", category: null, data: null, prior: null },
          { id: "goal_1", kind: "goal", label: "G", goal_threshold: 0.8, goal_threshold_raw: 800, goal_threshold_unit: "customers", category: null, data: null, prior: null },
        ],
        edges: [
          { from: "dec_1", to: "opt_1", strength: { mean: 1, std: 0.01 }, exists_probability: 1.0, effect_direction: "positive" },
          { from: "opt_1", to: "fac_1", strength: { mean: 0.8, std: 0.1 }, exists_probability: 0.9, effect_direction: "positive" },
          { from: "fac_1", to: "out_1", strength: { mean: 0.7, std: 0.15 }, exists_probability: 0.8, effect_direction: "positive" },
          { from: "fac_ext", to: "out_1", strength: { mean: 0.3, std: 0.2 }, exists_probability: null, effect_direction: null },
          { from: "out_1", to: "goal_1", strength: { mean: 0.9, std: 0.05 }, exists_probability: 1.0, effect_direction: "positive" },
        ],
      }) as any;

      // Build a DraftGraphOutput-compatible shape
      const output = {
        graph: {
          nodes: normalised.nodes,
          edges: normalised.edges,
        },
      };

      const result = DraftGraphOutput.safeParse(output);
      if (!result.success) {
        const first = result.error.issues[0];
        throw new Error(
          `DraftGraphOutput parse failed: path=${first?.path?.join(".")}, message=${first?.message}`,
        );
      }
      expect(result.success).toBe(true);
    });
  });

  describe("goal_constraints nullable fields", () => {
    it("coerces null constraint_id, operator, value, label to undefined", () => {
      const raw = {
        nodes: [],
        edges: [],
        goal_constraints: [
          { node_id: "fac_1", constraint_id: null, operator: null, value: null, label: null },
        ],
      };
      const result = normaliseDraftResponse(raw) as any;
      const gc = result.goal_constraints[0];
      expect(gc.node_id).toBe("fac_1");
      expect(gc.constraint_id).toBeUndefined();
      expect(gc.operator).toBeUndefined();
      expect(gc.value).toBeUndefined();
      expect(gc.label).toBeUndefined();
    });

    it("drops goal_constraint items without node_id", () => {
      const raw = {
        nodes: [],
        edges: [],
        goal_constraints: [
          { node_id: "fac_1", operator: ">=" },
          { constraint_id: "gc_2", operator: "<=", value: 100 }, // missing node_id
        ],
      };
      const result = normaliseDraftResponse(raw) as any;
      expect(result.goal_constraints).toHaveLength(1);
      expect(result.goal_constraints[0].node_id).toBe("fac_1");
    });
  });

  describe("coaching nullable fields", () => {
    it("coerces null label and detail to undefined on strengthen_items", () => {
      const raw = {
        nodes: [],
        edges: [],
        coaching: {
          summary: "Test coaching",
          strengthen_items: [
            { id: "si_1", label: null, detail: null },
            { id: "si_2", label: "Add data", detail: null },
          ],
        },
      };
      const result = normaliseDraftResponse(raw) as any;
      const items = result.coaching.strengthen_items;
      expect(items[0].label).toBeUndefined();
      expect(items[0].detail).toBeUndefined();
      expect(items[1].label).toBe("Add data");
      expect(items[1].detail).toBeUndefined();
    });
  });
});
