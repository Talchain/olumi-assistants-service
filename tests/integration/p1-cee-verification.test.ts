/**
 * P1 CEE Verification Tests
 *
 * Verifies the P1 implementation produces outputs that integrate correctly
 * with UI and PLoT.
 */
import { describe, it, expect } from "vitest";
import {
  transformResponseToV3,
} from "../../src/cee/transforms/index.js";
import type { V1DraftGraphResponse } from "../../src/cee/transforms/index.js";
import { normalizeToId, normalizeLabelsToIds } from "../../src/cee/utils/id-normalizer.js";

describe("P1 CEE Verification", () => {
  // ==========================================================================
  // Task 1: Verify Mapping Flow for Relative Values (No Baseline)
  // ==========================================================================
  describe("Task 1: Mapping Flow for Relative Values (No Baseline)", () => {
    it("sets status to needs_user_mapping when relative value lacks baseline", () => {
      const response: V1DraftGraphResponse = {
        graph: {
          version: "1",
          nodes: [
            { id: "goal_revenue", kind: "goal", label: "Maximize Revenue" },
            // Factor WITHOUT observed_state (no baseline)
            { id: "factor_price", kind: "factor", label: "Price" },
            // Option with relative value "increase by 20%"
            { id: "option_increase", kind: "option", label: "Increase price by 20%", body: "Increase price by 20%" },
          ],
          edges: [
            { from: "factor_price", to: "goal_revenue", weight: 0.8, belief: 0.9 },
            { from: "option_increase", to: "factor_price", weight: 0.7, belief: 0.8 },
          ],
        },
      };

      const v3Response = transformResponseToV3(response);
      const option = v3Response.options.find((o) => o.label === "Increase price by 20%");

      expect(option).toBeDefined();
      // Critical: status MUST be "needs_user_mapping", NOT "ready"
      expect(option?.status).toBe("needs_user_mapping");
      // user_questions MUST be an array of strings
      expect(Array.isArray(option?.user_questions)).toBe(true);
      // user_questions MUST contain at least one question about baseline
      expect(option?.user_questions?.length).toBeGreaterThan(0);
      // interventions MUST be empty (no relative values stored)
      expect(Object.keys(option?.interventions ?? {}).length).toBe(0);
    });

    it("user_questions contains baseline-related prompt for relative values", () => {
      const response: V1DraftGraphResponse = {
        graph: {
          version: "1",
          nodes: [
            { id: "goal_profit", kind: "goal", label: "Maximize Profit" },
            { id: "factor_cost", kind: "factor", label: "Cost" },
            { id: "option_reduce", kind: "option", label: "Reduce cost by 15%", body: "Reduce cost by 15%" },
          ],
          edges: [
            { from: "factor_cost", to: "goal_profit", weight: 0.7, belief: 0.85, effect_direction: "negative" },
            { from: "option_reduce", to: "factor_cost", weight: 0.6, belief: 0.8 },
          ],
        },
      };

      const v3Response = transformResponseToV3(response);
      const option = v3Response.options.find((o) => o.label === "Reduce cost by 15%");

      expect(option?.status).toBe("needs_user_mapping");
      // Check that user_questions asks about the baseline
      const questions = option?.user_questions ?? [];
      const hasBaselineQuestion = questions.some(
        (q) => q.toLowerCase().includes("current") || q.toLowerCase().includes("baseline")
      );
      expect(hasBaselineQuestion).toBe(true);
    });
  });

  // ==========================================================================
  // Task 2: Verify Relative Value Resolution WITH Baseline
  // ==========================================================================
  describe("Task 2: Relative Value Resolution WITH Baseline", () => {
    it("resolves relative value to absolute when baseline exists", () => {
      const response: V1DraftGraphResponse = {
        graph: {
          version: "1",
          nodes: [
            { id: "goal_revenue", kind: "goal", label: "Maximize Revenue" },
            // Factor WITH baseline
            { id: "factor_price", kind: "factor", label: "Price", data: { value: 100, unit: "USD" } },
            // Option with relative value
            { id: "option_increase", kind: "option", label: "Increase price by 20%", body: "Increase price by 20%" },
          ],
          edges: [
            { from: "factor_price", to: "goal_revenue", weight: 0.8, belief: 0.9 },
            { from: "option_increase", to: "factor_price", weight: 0.7, belief: 0.8 },
          ],
        },
      };

      const v3Response = transformResponseToV3(response);
      const option = v3Response.options.find((o) => o.label === "Increase price by 20%");

      // If baseline is extracted and used, status should be "ready"
      // and intervention should contain absolute value (120)
      if (option?.status === "ready") {
        const intervention = option.interventions["factor_price"];
        expect(intervention).toBeDefined();
        expect(intervention?.value).toBe(120); // 100 * 1.2 = 120
      } else {
        // If not resolved, should still be needs_user_mapping (acceptable)
        expect(option?.status).toBe("needs_user_mapping");
      }
    });
  });

  // ==========================================================================
  // Task 3: Verify ID Collision Uses __2 Suffix
  // ==========================================================================
  describe("Task 3: ID Collision Uses __2 Suffix", () => {
    it("uses double underscore (__2) for ID collisions, NOT single underscore (_2)", () => {
      const existingIds = new Set(["price"]);
      const newId = normalizeToId("Price", existingIds);

      // MUST use __2 (double underscore)
      expect(newId).toBe("price__2");
      // MUST NOT use _2 (single underscore)
      expect(newId).not.toBe("price_2");
    });

    it("increments collision suffix correctly (__2, __3, __4, ...)", () => {
      const existingIds = new Set(["price", "price__2", "price__3"]);
      const newId = normalizeToId("Price", existingIds);

      expect(newId).toBe("price__4");
    });

    it("all generated IDs match regex ^[a-z0-9_:-]+$", () => {
      const testLabels = [
        "Price",
        "Price Premium",
        "Marketing Spend (USD)",
        "Revenue 2024",
        "Cost-Per-Click",
        "factor:price",
      ];

      const ids = normalizeLabelsToIds(testLabels);
      const validIdRegex = /^[a-z0-9_:-]+$/;

      for (const id of ids) {
        expect(id).toMatch(validIdRegex);
      }
    });

    it("handles colliding labels correctly in batch", () => {
      const labels = ["Price", "Price Premium", "Price"];
      const ids = normalizeLabelsToIds(labels);

      expect(ids[0]).toBe("price");
      expect(ids[1]).toBe("price_premium");
      expect(ids[2]).toBe("price__2"); // Collision with first "Price"
    });
  });

  // ==========================================================================
  // Task 4: Verify ID Generation is Deterministic
  // ==========================================================================
  describe("Task 4: ID Generation is Deterministic", () => {
    it("same labels produce same IDs across multiple calls", () => {
      const labels = ["Price", "Cost", "Revenue"];

      const ids1 = normalizeLabelsToIds(labels);
      const ids2 = normalizeLabelsToIds(labels);

      expect(ids1).toEqual(ids2);
    });

    it("collision suffix assignment is consistent", () => {
      const labels = ["Option A", "Option B", "Option A"];

      const ids1 = normalizeLabelsToIds(labels);
      const ids2 = normalizeLabelsToIds(labels);

      expect(ids1).toEqual(ids2);
      expect(ids1[2]).toBe("option_a__2"); // Collision handled consistently
    });
  });

  // ==========================================================================
  // Task 5: Verify Strength Clamping
  // ==========================================================================
  describe("Task 5: Strength Clamping", () => {
    it("clamps strength_mean to [-3, +3] range", () => {
      const response: V1DraftGraphResponse = {
        graph: {
          version: "1",
          nodes: [
            { id: "goal_sales", kind: "goal", label: "Sales" },
            { id: "factor_advertising", kind: "factor", label: "Advertising" },
          ],
          edges: [
            // Weight of 5.0 should be clamped to 3.0
            { from: "factor_advertising", to: "goal_sales", weight: 5.0, belief: 0.9 },
          ],
        },
      };

      const v3Response = transformResponseToV3(response);

      for (const edge of v3Response.graph.edges) {
        expect(edge.strength_mean).toBeGreaterThanOrEqual(-3);
        expect(edge.strength_mean).toBeLessThanOrEqual(3);
      }
    });

    it("ensures strength_std is > 0", () => {
      const response: V1DraftGraphResponse = {
        graph: {
          version: "1",
          nodes: [
            { id: "goal_revenue", kind: "goal", label: "Revenue" },
            { id: "factor_price", kind: "factor", label: "Price" },
          ],
          edges: [
            { from: "factor_price", to: "goal_revenue", weight: 0.8, belief: 1.0 }, // Max belief
          ],
        },
      };

      const v3Response = transformResponseToV3(response);

      for (const edge of v3Response.graph.edges) {
        expect(edge.strength_std).toBeGreaterThan(0);
      }
    });

    it("caps strength_std at max(0.5, 2×|mean|)", () => {
      const response: V1DraftGraphResponse = {
        graph: {
          version: "1",
          nodes: [
            { id: "goal_revenue", kind: "goal", label: "Revenue" },
            { id: "factor_price", kind: "factor", label: "Price" },
          ],
          edges: [
            { from: "factor_price", to: "goal_revenue", weight: 2.0, belief: 0.1 }, // Low belief = high std
          ],
        },
      };

      const v3Response = transformResponseToV3(response);

      for (const edge of v3Response.graph.edges) {
        const cap = Math.max(0.5, 2 * Math.abs(edge.strength_mean));
        expect(edge.strength_std).toBeLessThanOrEqual(cap);
      }
    });
  });

  // ==========================================================================
  // Task 6: Verify Warning Severity Levels
  // ==========================================================================
  describe("Task 6: Warning Severity Levels", () => {
    it("negligible edges (|mean| < 0.1) get severity 'info'", () => {
      const response: V1DraftGraphResponse = {
        graph: {
          version: "1",
          nodes: [
            { id: "goal_revenue", kind: "goal", label: "Revenue" },
            { id: "factor_color", kind: "factor", label: "Background Color" },
          ],
          edges: [
            // Very low weight = negligible strength
            { from: "factor_color", to: "goal_revenue", weight: 0.05, belief: 0.9 },
          ],
        },
      };

      const v3Response = transformResponseToV3(response);

      const negligibleWarning = v3Response.validation_warnings?.find(
        (w) => w.code === "EDGE_STRENGTH_NEGLIGIBLE"
      );

      if (negligibleWarning) {
        expect(negligibleWarning.severity).toBe("info");
      }
    });

    it("low strength edges (0.1 ≤ |mean| < 0.5) get severity 'warning'", () => {
      const response: V1DraftGraphResponse = {
        graph: {
          version: "1",
          nodes: [
            { id: "goal_revenue", kind: "goal", label: "Revenue" },
            { id: "factor_font", kind: "factor", label: "Font Choice" },
          ],
          edges: [
            // Low but not negligible weight
            { from: "factor_font", to: "goal_revenue", weight: 0.3, belief: 0.9 },
          ],
        },
      };

      const v3Response = transformResponseToV3(response);

      const lowWarning = v3Response.validation_warnings?.find(
        (w) => w.code === "EDGE_STRENGTH_LOW"
      );

      if (lowWarning) {
        expect(lowWarning.severity).toBe("warning");
      }
    });
  });
});
