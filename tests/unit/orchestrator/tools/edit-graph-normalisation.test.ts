import { describe, it, expect, vi } from "vitest";

// ============================================================================
// Mocks — must be declared before imports
// ============================================================================

vi.mock("../../../../src/adapters/llm/prompt-loader.js", () => ({
  getSystemPrompt: vi.fn().mockResolvedValue("You are editing a graph."),
}));

vi.mock("../../../../src/config/index.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../../src/config/index.js")>();
  return {
    ...original,
    config: new Proxy(original.config, {
      get(target, prop) {
        if (prop === "cee") {
          return new Proxy(Reflect.get(target, prop) as object, {
            get(ceeTarget, ceeProp) {
              if (ceeProp === "editNormalisationEnabled") return true;
              return Reflect.get(ceeTarget, ceeProp);
            },
          });
        }
        return Reflect.get(target, prop);
      },
    }),
  };
});

import {
  normaliseEditOpsForPlot,
  mapOpsForPlot,
  nestEdgeStrengthForPlot,
} from "../../../../src/orchestrator/tools/edit-graph.js";
import type { PatchOperation } from "../../../../src/orchestrator/types.js";

// ============================================================================
// normaliseEditOpsForPlot — Node normalisation
// ============================================================================

describe("normaliseEditOpsForPlot", () => {
  describe("node normalisation (add_node)", () => {
    it("unwraps data.prior for external factor → value.prior", () => {
      const ops: PatchOperation[] = [
        {
          op: "add_node",
          path: "ext_1",
          value: {
            id: "ext_1",
            kind: "factor",
            label: "Interest Rate",
            data: { prior: { distribution: "normal", range_min: 0, range_max: 1 } },
          },
        },
      ];

      const result = normaliseEditOpsForPlot(ops);
      const v = result[0].value as Record<string, unknown>;
      expect(v.prior).toEqual({ distribution: "normal", range_min: 0, range_max: 1 });
      expect(v.data).toBeUndefined();
    });

    it("does NOT unwrap data when category is present (canonical shape)", () => {
      const ops: PatchOperation[] = [
        {
          op: "add_node",
          path: "fac_1",
          value: {
            id: "fac_1",
            kind: "factor",
            label: "Price",
            category: "controllable",
            data: { value: 100, unit: "USD" },
          },
        },
      ];

      const result = normaliseEditOpsForPlot(ops);
      const v = result[0].value as Record<string, unknown>;
      // Unchanged — category present means canonical shape
      expect(v.category).toBe("controllable");
      expect(v.data).toEqual({ value: 100, unit: "USD" });
    });

    it("renames observed_state → data on node", () => {
      const ops: PatchOperation[] = [
        {
          op: "add_node",
          path: "fac_1",
          value: {
            id: "fac_1",
            kind: "factor",
            label: "Price",
            observed_state: { value: 50, unit: "USD" },
          },
        },
      ];

      const result = normaliseEditOpsForPlot(ops);
      const v = result[0].value as Record<string, unknown>;
      expect(v.data).toEqual({ value: 50, unit: "USD" });
      expect(v).not.toHaveProperty("observed_state");
    });

    it("hoists top-level node fields out of data wrapper for controllable", () => {
      const ops: PatchOperation[] = [
        {
          op: "add_node",
          path: "fac_1",
          value: {
            id: "fac_1",
            kind: "factor",
            label: "Price",
            data: { category: "controllable", value: 100, unit: "USD" },
          },
        },
      ];

      const result = normaliseEditOpsForPlot(ops);
      const v = result[0].value as Record<string, unknown>;
      expect(v.category).toBe("controllable");
      // data should retain the factor sub-fields
      expect(v.data).toEqual({ value: 100, unit: "USD" });
    });

    it("hoists category+kind from data wrapper, drops data if empty after hoist", () => {
      const ops: PatchOperation[] = [
        {
          op: "add_node",
          path: "fac_1",
          value: {
            id: "fac_1",
            label: "Price",
            data: { kind: "factor", category: "observable" },
          },
        },
      ];

      const result = normaliseEditOpsForPlot(ops);
      const v = result[0].value as Record<string, unknown>;
      expect(v.kind).toBe("factor");
      expect(v.category).toBe("observable");
      // data should be removed since it's empty after hoisting
      expect(v.data).toBeUndefined();
    });

    it("does not rename observed_state if data already exists", () => {
      const ops: PatchOperation[] = [
        {
          op: "add_node",
          path: "fac_1",
          value: {
            id: "fac_1",
            kind: "factor",
            label: "Price",
            data: { value: 100 },
            observed_state: { value: 50 },
          },
        },
      ];

      const result = normaliseEditOpsForPlot(ops);
      const v = result[0].value as Record<string, unknown>;
      expect(v.data).toEqual({ value: 100 });
      expect(v).toHaveProperty("observed_state");
    });
  });

  describe("edge normalisation (add_edge / update_edge)", () => {
    it("renames belief_exists → exists_probability", () => {
      const ops: PatchOperation[] = [
        {
          op: "add_edge",
          path: "fac_1->goal_1",
          value: {
            from: "fac_1",
            to: "goal_1",
            strength_mean: 0.6,
            strength_std: 0.1,
            belief_exists: 0.85,
            effect_direction: "positive",
          },
        },
      ];

      const result = normaliseEditOpsForPlot(ops);
      const v = result[0].value as Record<string, unknown>;
      expect(v.exists_probability).toBe(0.85);
      expect(v).not.toHaveProperty("belief_exists");
    });

    it("does not overwrite exists_probability if already present", () => {
      const ops: PatchOperation[] = [
        {
          op: "add_edge",
          path: "fac_1->goal_1",
          value: {
            from: "fac_1",
            to: "goal_1",
            strength_mean: 0.6,
            strength_std: 0.1,
            belief_exists: 0.5,
            exists_probability: 0.9,
            effect_direction: "positive",
          },
        },
      ];

      const result = normaliseEditOpsForPlot(ops);
      const v = result[0].value as Record<string, unknown>;
      expect(v.exists_probability).toBe(0.9);
      expect(v).toHaveProperty("belief_exists"); // not removed since exists_probability present
    });

    it("renames belief_exists on update_edge too", () => {
      const ops: PatchOperation[] = [
        {
          op: "update_edge",
          path: "fac_1->goal_1",
          value: { belief_exists: 0.7 },
        },
      ];

      const result = normaliseEditOpsForPlot(ops);
      const v = result[0].value as Record<string, unknown>;
      expect(v.exists_probability).toBe(0.7);
      expect(v).not.toHaveProperty("belief_exists");
    });
  });

  describe("already canonical — no changes", () => {
    it("leaves canonical add_edge unchanged", () => {
      const ops: PatchOperation[] = [
        {
          op: "add_edge",
          path: "fac_1->goal_1",
          value: {
            from: "fac_1",
            to: "goal_1",
            strength_mean: 0.6,
            strength_std: 0.1,
            exists_probability: 0.9,
            effect_direction: "positive",
          },
        },
      ];

      const result = normaliseEditOpsForPlot(ops);
      expect(result[0]).toEqual(ops[0]);
    });

    it("leaves canonical add_node unchanged", () => {
      const ops: PatchOperation[] = [
        {
          op: "add_node",
          path: "fac_1",
          value: {
            id: "fac_1",
            kind: "factor",
            label: "Price",
            category: "controllable",
            data: { value: 100 },
          },
        },
      ];

      const result = normaliseEditOpsForPlot(ops);
      expect(result[0]).toEqual(ops[0]);
    });

    it("leaves remove_node / remove_edge untouched", () => {
      const ops: PatchOperation[] = [
        { op: "remove_node", path: "fac_1" },
        { op: "remove_edge", path: "fac_1->goal_1" },
      ];

      const result = normaliseEditOpsForPlot(ops);
      expect(result).toEqual(ops);
    });
  });

  describe("mixed operations — partial normalisation", () => {
    it("normalises only non-canonical ops in a mixed batch", () => {
      const ops: PatchOperation[] = [
        // Canonical — no change
        {
          op: "add_edge",
          path: "fac_1->goal_1",
          value: {
            from: "fac_1",
            to: "goal_1",
            strength_mean: 0.6,
            strength_std: 0.1,
            exists_probability: 0.9,
            effect_direction: "positive",
          },
        },
        // Non-canonical — belief_exists needs rename
        {
          op: "add_edge",
          path: "fac_2->goal_1",
          value: {
            from: "fac_2",
            to: "goal_1",
            strength_mean: 0.4,
            strength_std: 0.2,
            belief_exists: 0.7,
            effect_direction: "negative",
          },
        },
        // Non-canonical node — observed_state rename
        {
          op: "add_node",
          path: "fac_3",
          value: {
            id: "fac_3",
            kind: "factor",
            label: "Headcount",
            observed_state: { value: 10 },
          },
        },
      ];

      const result = normaliseEditOpsForPlot(ops);

      // First op unchanged
      expect(result[0]).toEqual(ops[0]);

      // Second op: belief_exists → exists_probability
      const edge2 = result[1].value as Record<string, unknown>;
      expect(edge2.exists_probability).toBe(0.7);
      expect(edge2).not.toHaveProperty("belief_exists");

      // Third op: observed_state → data
      const node3 = result[2].value as Record<string, unknown>;
      expect(node3.data).toEqual({ value: 10 });
      expect(node3).not.toHaveProperty("observed_state");
    });
  });
});

// ============================================================================
// nestEdgeStrengthForPlot — PLoT edge format
// ============================================================================

describe("nestEdgeStrengthForPlot", () => {
  it("nests flat strength_mean/strength_std into strength: { mean, std }", () => {
    const result = nestEdgeStrengthForPlot({
      from: "a",
      to: "b",
      strength_mean: 0.6,
      strength_std: 0.1,
      exists_probability: 0.9,
      effect_direction: "positive",
    }) as Record<string, unknown>;

    expect(result.strength).toEqual({ mean: 0.6, std: 0.1 });
    expect(result).not.toHaveProperty("strength_mean");
    expect(result).not.toHaveProperty("strength_std");
    expect(result.exists_probability).toBe(0.9);
  });

  it("leaves already-nested strength alone (no flat fields)", () => {
    const input = {
      from: "a",
      to: "b",
      strength: { mean: 0.5, std: 0.2 },
      exists_probability: 0.8,
    };

    const result = nestEdgeStrengthForPlot(input);
    expect(result).toEqual(input);
  });

  it("drops flat strength fields when nested strength already exists", () => {
    const result = nestEdgeStrengthForPlot({
      from: "a",
      to: "b",
      strength: { mean: 0.5, std: 0.2 },
      strength_mean: 0.9,
      strength_std: 0.3,
      exists_probability: 0.8,
    }) as Record<string, unknown>;

    // Nested wins — flat fields dropped
    expect(result.strength).toEqual({ mean: 0.5, std: 0.2 });
    expect(result).not.toHaveProperty("strength_mean");
    expect(result).not.toHaveProperty("strength_std");
    expect(result.exists_probability).toBe(0.8);
  });

  it("handles only strength_mean (partial flat)", () => {
    const result = nestEdgeStrengthForPlot({
      from: "a",
      to: "b",
      strength_mean: 0.7,
    }) as Record<string, unknown>;

    expect(result.strength).toEqual({ mean: 0.7 });
    expect(result).not.toHaveProperty("strength_mean");
  });

  it("returns non-object values unchanged", () => {
    expect(nestEdgeStrengthForPlot(null)).toBeNull();
    expect(nestEdgeStrengthForPlot(undefined)).toBeUndefined();
    expect(nestEdgeStrengthForPlot(42)).toBe(42);
  });

  it("returns edge without strength fields unchanged", () => {
    const input = { from: "a", to: "b", exists_probability: 0.9 };
    expect(nestEdgeStrengthForPlot(input)).toEqual(input);
  });
});

// ============================================================================
// mapOpsForPlot — integration: strength re-nesting in PLoT mapping
// ============================================================================

describe("mapOpsForPlot — strength nesting", () => {
  it("re-nests flat strength on add_edge for PLoT", () => {
    const ops: PatchOperation[] = [
      {
        op: "add_edge",
        path: "fac_1::goal_1",
        value: {
          from: "fac_1",
          to: "goal_1",
          strength_mean: 0.6,
          strength_std: 0.1,
          exists_probability: 0.9,
          effect_direction: "positive",
        },
      },
    ];

    const mapped = mapOpsForPlot(ops);
    const v = mapped[0].value as Record<string, unknown>;
    expect(v.strength).toEqual({ mean: 0.6, std: 0.1 });
    expect(v).not.toHaveProperty("strength_mean");
    expect(v).not.toHaveProperty("strength_std");
    // Also verify path conversion
    expect(mapped[0].path).toBe("fac_1->goal_1");
  });

  it("does not nest strength on node ops", () => {
    const ops: PatchOperation[] = [
      {
        op: "add_node",
        path: "fac_1",
        value: { id: "fac_1", kind: "factor", label: "Price", strength_mean: 0.5 },
      },
    ];

    const mapped = mapOpsForPlot(ops);
    const v = mapped[0].value as Record<string, unknown>;
    // Node ops should not have strength nesting applied
    expect(v.strength_mean).toBe(0.5);
  });
});
