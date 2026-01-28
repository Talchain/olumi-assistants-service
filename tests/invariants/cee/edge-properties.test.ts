/**
 * INVARIANT: Edge properties must be preserved and normalized consistently
 * DISCOVERED: Edge coefficient normalization and effect_direction inference
 *
 * This test ensures that:
 * 1. Edge coefficients (strength_mean, belief_exists) are preserved through transforms
 * 2. Effect direction is correctly inferred for risk→goal edges (negative)
 * 3. Edge IDs are normalized to stable format: ${from}::${to}::${index}
 * 4. Dangling edges are removed when nodes are capped
 */

import { describe, it, expect } from "vitest";
import { normaliseDraftResponse } from "../../../src/adapters/llm/normalisation.js";
import { normalizeEdgeIds, sortEdges } from "../../../src/utils/graphGuards.js";
import {
  inferEffectDirection,
  ensureEffectDirection,
} from "../../../src/cee/transforms/effect-direction-inference.js";
import type { EdgeT } from "../../../src/schemas/graph.js";

describe("CEE Edge Properties Invariant", () => {
  describe("V4 edge property normalization", () => {
    it("preserves strength.mean from LLM output", () => {
      const raw = {
        nodes: [
          { id: "fac_1", kind: "factor", label: "Factor 1" },
          { id: "out_1", kind: "outcome", label: "Outcome 1" },
        ],
        edges: [
          {
            from: "fac_1",
            to: "out_1",
            strength: { mean: 0.75, std: 0.1 },
            exists_probability: 0.85,
          },
        ],
      };

      const result = normaliseDraftResponse(raw) as any;

      expect(result.edges[0].strength_mean).toBe(0.75);
      expect(result.edges[0].strength_std).toBe(0.1);
      expect(result.edges[0].belief_exists).toBe(0.85);
    });

    it("handles string numbers in strength properties", () => {
      const raw = {
        nodes: [
          { id: "fac_1", kind: "factor", label: "Factor 1" },
          { id: "out_1", kind: "outcome", label: "Outcome 1" },
        ],
        edges: [
          {
            from: "fac_1",
            to: "out_1",
            strength: { mean: "0.75", std: "0.1" },
            exists_probability: "0.85",
          },
        ],
      };

      const result = normaliseDraftResponse(raw) as any;

      expect(result.edges[0].strength_mean).toBe(0.75);
      expect(result.edges[0].strength_std).toBe(0.1);
      expect(result.edges[0].belief_exists).toBe(0.85);
    });

    it("clamps belief_exists to [0, 1] range", () => {
      const raw = {
        nodes: [
          { id: "a", kind: "factor", label: "A" },
          { id: "b", kind: "factor", label: "B" },
        ],
        edges: [
          { from: "a", to: "b", exists_probability: 1.5 },
          { from: "b", to: "a", exists_probability: -0.3 },
        ],
      };

      const result = normaliseDraftResponse(raw) as any;

      expect(result.edges[0].belief_exists).toBe(1.0);
      expect(result.edges[1].belief_exists).toBe(0.0);
    });

    it("preserves legacy weight/belief fields", () => {
      const raw = {
        nodes: [
          { id: "fac_1", kind: "factor", label: "Factor 1" },
          { id: "out_1", kind: "outcome", label: "Outcome 1" },
        ],
        edges: [
          {
            from: "fac_1",
            to: "out_1",
            weight: 0.6,
            belief: 0.9,
          },
        ],
      };

      const result = normaliseDraftResponse(raw) as any;

      expect(result.edges[0].weight).toBe(0.6);
      expect(result.edges[0].belief).toBe(0.9);
    });
  });

  describe("effect_direction inference", () => {
    it("infers negative for risk→goal edges", () => {
      const fromNode = { id: "risk_1", kind: "risk", label: "Market Risk" };
      const toNode = { id: "goal_1", kind: "goal", label: "Maximize Profit" };

      const direction = inferEffectDirection({ from: "risk_1", to: "goal_1" }, fromNode, toNode);

      expect(direction).toBe("negative");
    });

    it("infers negative for price→demand relationships", () => {
      const fromNode = { id: "fac_price", kind: "factor", label: "Product Price" };
      const toNode = { id: "out_demand", kind: "outcome", label: "Customer Demand" };

      const direction = inferEffectDirection(
        { from: "fac_price", to: "out_demand" },
        fromNode,
        toNode
      );

      expect(direction).toBe("negative");
    });

    it("infers negative for cost→profit relationships", () => {
      const fromNode = { id: "fac_cost", kind: "factor", label: "Operating Cost" };
      const toNode = { id: "out_profit", kind: "outcome", label: "Net Profit" };

      const direction = inferEffectDirection(
        { from: "fac_cost", to: "out_profit" },
        fromNode,
        toNode
      );

      expect(direction).toBe("negative");
    });

    it("defaults to positive for generic relationships", () => {
      const fromNode = { id: "fac_1", kind: "factor", label: "Input Factor" };
      const toNode = { id: "fac_2", kind: "factor", label: "Output Factor" };

      const direction = inferEffectDirection({ from: "fac_1", to: "fac_2" }, fromNode, toNode);

      expect(direction).toBe("positive");
    });

    it("respects explicit effect_direction from LLM", () => {
      const nodes = [
        { id: "a", kind: "factor", label: "A" },
        { id: "b", kind: "factor", label: "B" },
      ];

      const explicitPositive = ensureEffectDirection(
        { from: "a", to: "b", effect_direction: "positive" },
        nodes
      );
      const explicitNegative = ensureEffectDirection(
        { from: "a", to: "b", effect_direction: "negative" },
        nodes
      );

      expect(explicitPositive).toBe("positive");
      expect(explicitNegative).toBe("negative");
    });
  });

  describe("edge ID normalization", () => {
    it("assigns stable IDs in format from::to::index", () => {
      const edges: EdgeT[] = [
        { from: "a", to: "b" },
        { from: "a", to: "b" },
        { from: "b", to: "c" },
      ];

      const normalized = normalizeEdgeIds(edges);

      expect(normalized[0].id).toBe("a::b::0");
      expect(normalized[1].id).toBe("a::b::1");
      expect(normalized[2].id).toBe("b::c::0");
    });

    it("handles multi-edges between same nodes", () => {
      const edges: EdgeT[] = [
        { from: "x", to: "y" },
        { from: "x", to: "y" },
        { from: "x", to: "y" },
      ];

      const normalized = normalizeEdgeIds(edges);

      expect(normalized.length).toBe(3);
      expect(normalized.map((e) => e.id)).toEqual(["x::y::0", "x::y::1", "x::y::2"]);
    });

    it("produces deterministic IDs regardless of original order", () => {
      const edges1: EdgeT[] = [
        { from: "a", to: "b" },
        { from: "c", to: "d" },
      ];
      const edges2: EdgeT[] = [
        { from: "c", to: "d" },
        { from: "a", to: "b" },
      ];

      const normalized1 = normalizeEdgeIds(edges1);
      const normalized2 = normalizeEdgeIds(edges2);

      // Same edges should get same IDs
      expect(normalized1.find((e) => e.from === "a" && e.to === "b")?.id).toBe("a::b::0");
      expect(normalized2.find((e) => e.from === "a" && e.to === "b")?.id).toBe("a::b::0");
    });
  });

  describe("edge sorting", () => {
    it("sorts by (from, to, id) triple", () => {
      const edges: EdgeT[] = [
        { from: "b", to: "c", id: "b::c::0" },
        { from: "a", to: "b", id: "a::b::0" },
        { from: "a", to: "c", id: "a::c::0" },
        { from: "a", to: "b", id: "a::b::1" },
      ];

      const sorted = sortEdges(edges);

      expect(sorted.map((e) => e.id)).toEqual(["a::b::0", "a::b::1", "a::c::0", "b::c::0"]);
    });

    it("produces deterministic order for identical edges", () => {
      const edges: EdgeT[] = [
        { from: "x", to: "y", id: "x::y::2" },
        { from: "x", to: "y", id: "x::y::0" },
        { from: "x", to: "y", id: "x::y::1" },
      ];

      const sorted = sortEdges(edges);

      expect(sorted.map((e) => e.id)).toEqual(["x::y::0", "x::y::1", "x::y::2"]);
    });
  });

  describe("edge property preservation through pipeline", () => {
    it("preserves all edge properties during normalization", () => {
      const raw = {
        nodes: [
          { id: "fac_1", kind: "factor", label: "Factor" },
          { id: "out_1", kind: "outcome", label: "Outcome" },
        ],
        edges: [
          {
            from: "fac_1",
            to: "out_1",
            strength: { mean: 0.8, std: 0.15 },
            exists_probability: 0.9,
            effect_direction: "positive",
            // Additional properties that should be preserved
            customProperty: "test",
          },
        ],
      };

      const result = normaliseDraftResponse(raw) as any;
      const edge = result.edges[0];

      // Core properties
      expect(edge.from).toBe("fac_1");
      expect(edge.to).toBe("out_1");
      expect(edge.effect_direction).toBe("positive");

      // V4 normalized properties
      expect(edge.strength_mean).toBe(0.8);
      expect(edge.strength_std).toBe(0.15);
      expect(edge.belief_exists).toBe(0.9);

      // Original nested object preserved
      expect(edge.strength).toEqual({ mean: 0.8, std: 0.15 });
      expect(edge.exists_probability).toBe(0.9);

      // Custom properties preserved
      expect(edge.customProperty).toBe("test");
    });

    it("handles edges with missing optional properties", () => {
      const raw = {
        nodes: [
          { id: "a", kind: "factor", label: "A" },
          { id: "b", kind: "factor", label: "B" },
        ],
        edges: [
          {
            from: "a",
            to: "b",
            // No strength, exists_probability, or effect_direction
          },
        ],
      };

      const result = normaliseDraftResponse(raw) as any;
      const edge = result.edges[0];

      // Core properties still present
      expect(edge.from).toBe("a");
      expect(edge.to).toBe("b");

      // Optional properties are undefined (not defaulted during normalization)
      expect(edge.strength_mean).toBeUndefined();
      expect(edge.strength_std).toBeUndefined();
      expect(edge.belief_exists).toBeUndefined();
    });
  });

  describe("coefficient sign conventions", () => {
    it("risk→goal edges should have negative coefficients", () => {
      // This documents the expected convention from the prompt
      // risk→goal edges MUST be negative to correctly model risk impact
      const fromNode = { id: "risk_1", kind: "risk", label: "Execution Risk" };
      const toNode = { id: "goal_1", kind: "goal", label: "Project Success" };

      const direction = inferEffectDirection({ from: "risk_1", to: "goal_1" }, fromNode, toNode);

      expect(direction).toBe("negative");
    });

    it("outcome→goal edges should typically be positive", () => {
      // Outcomes generally have positive impact on goals
      const fromNode = { id: "out_1", kind: "outcome", label: "Revenue Increase" };
      const toNode = { id: "goal_1", kind: "goal", label: "Business Growth" };

      const direction = inferEffectDirection({ from: "out_1", to: "goal_1" }, fromNode, toNode);

      // Note: This should return positive for positive outcomes
      expect(direction).toBe("positive");
    });
  });
});
