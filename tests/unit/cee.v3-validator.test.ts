import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { validateV3Response } from "../../src/cee/validation/v3-validator.js";
import type { CEEGraphResponseV3T } from "../../src/schemas/cee-v3.js";

/**
 * Helper to create a minimal valid V3 response for testing.
 */
function makeV3Response(
  partial: Partial<CEEGraphResponseV3T>
): CEEGraphResponseV3T {
  const defaults: CEEGraphResponseV3T = {
    schema_version: "3.0",
    goal_node_id: "goal_1",
    nodes: [
      { id: "goal_1", kind: "goal", label: "Test Goal" },
      { id: "decision_1", kind: "decision", label: "Test Decision" },
      { id: "option_1", kind: "option", label: "Option A" },
      { id: "factor_1", kind: "factor", label: "Factor 1" },
      { id: "outcome_1", kind: "outcome", label: "Outcome 1" },
    ],
    edges: [
      {
        from: "decision_1",
        to: "option_1",
        strength_mean: 1.0,
        strength_std: 0.1,
        belief_exists: 1.0,
        effect_direction: "positive",
      },
      {
        from: "option_1",
        to: "factor_1",
        strength_mean: 1.0,
        strength_std: 0.1,
        belief_exists: 1.0,
        effect_direction: "positive",
      },
      {
        from: "factor_1",
        to: "outcome_1",
        strength_mean: 0.7,
        strength_std: 0.15,
        belief_exists: 0.9,
        effect_direction: "positive",
      },
      {
        from: "outcome_1",
        to: "goal_1",
        strength_mean: 0.8,
        strength_std: 0.1,
        belief_exists: 0.95,
        effect_direction: "positive",
      },
    ],
    options: [
      {
        id: "option_1",
        label: "Option A",
        status: "ready",
        interventions: {
          factor_1: {
            value: 1.0,
            source: "brief_extraction",
            target_match: {
              node_id: "factor_1",
              match_type: "exact_id",
              confidence: "high",
            },
          },
        },
      },
    ],
  };

  return { ...defaults, ...partial };
}

describe("V3 Validator - Graph Structure Validation", () => {
  describe("Cycle Detection", () => {
    it("detects simple cycle and returns CIRCULAR_DEPENDENCY error", () => {
      const response = makeV3Response({
        nodes: [
          { id: "goal_1", kind: "goal", label: "Goal" },
          { id: "factor_a", kind: "factor", label: "A" },
          { id: "factor_b", kind: "factor", label: "B" },
          { id: "factor_c", kind: "factor", label: "C" },
          { id: "outcome_1", kind: "outcome", label: "Outcome" },
        ],
        edges: [
          {
            from: "factor_a",
            to: "factor_b",
            strength_mean: 0.5,
            strength_std: 0.1,
            belief_exists: 0.9,
            effect_direction: "positive",
          },
          {
            from: "factor_b",
            to: "factor_c",
            strength_mean: 0.5,
            strength_std: 0.1,
            belief_exists: 0.9,
            effect_direction: "positive",
          },
          {
            from: "factor_c",
            to: "factor_a",
            strength_mean: 0.5,
            strength_std: 0.1,
            belief_exists: 0.9,
            effect_direction: "positive",
          }, // Creates cycle: A → B → C → A
          {
            from: "factor_c",
            to: "outcome_1",
            strength_mean: 0.5,
            strength_std: 0.1,
            belief_exists: 0.9,
            effect_direction: "positive",
          },
          {
            from: "outcome_1",
            to: "goal_1",
            strength_mean: 0.5,
            strength_std: 0.1,
            belief_exists: 0.9,
            effect_direction: "positive",
          },
        ],
        options: [],
      });

      const result = validateV3Response(response);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === "CIRCULAR_DEPENDENCY")).toBe(
        true
      );
      const cycleError = result.errors.find(
        (e) => e.code === "CIRCULAR_DEPENDENCY"
      );
      expect(cycleError?.message).toMatch(/cycle detected/i);
    });

    it("allows valid DAG without cycles", () => {
      const response = makeV3Response({});

      const result = validateV3Response(response);

      // Should not have cycle-related errors
      expect(
        result.errors.some((e) => e.code === "CIRCULAR_DEPENDENCY")
      ).toBe(false);
      expect(result.errors.some((e) => e.code === "SELF_LOOP_DETECTED")).toBe(
        false
      );
      expect(result.errors.some((e) => e.code === "BIDIRECTIONAL_EDGE")).toBe(
        false
      );
    });
  });

  describe("Self-Loop Detection", () => {
    it("detects self-loop and returns SELF_LOOP_DETECTED error", () => {
      const response = makeV3Response({
        nodes: [
          { id: "goal_1", kind: "goal", label: "Goal" },
          { id: "factor_a", kind: "factor", label: "A" },
          { id: "outcome_1", kind: "outcome", label: "Outcome" },
        ],
        edges: [
          {
            from: "factor_a",
            to: "factor_a",
            strength_mean: 0.5,
            strength_std: 0.1,
            belief_exists: 0.9,
            effect_direction: "positive",
          }, // Self-loop
          {
            from: "factor_a",
            to: "outcome_1",
            strength_mean: 0.5,
            strength_std: 0.1,
            belief_exists: 0.9,
            effect_direction: "positive",
          },
          {
            from: "outcome_1",
            to: "goal_1",
            strength_mean: 0.5,
            strength_std: 0.1,
            belief_exists: 0.9,
            effect_direction: "positive",
          },
        ],
        options: [],
      });

      const result = validateV3Response(response);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === "SELF_LOOP_DETECTED")).toBe(
        true
      );
      const selfLoopError = result.errors.find(
        (e) => e.code === "SELF_LOOP_DETECTED"
      );
      expect(selfLoopError?.affected_node_id).toBe("factor_a");
      expect(selfLoopError?.message).toMatch(/self-loop/i);
    });
  });

  describe("Bidirectional Edge Detection", () => {
    it("detects bidirectional edges and returns BIDIRECTIONAL_EDGE error", () => {
      const response = makeV3Response({
        nodes: [
          { id: "goal_1", kind: "goal", label: "Goal" },
          { id: "factor_a", kind: "factor", label: "A" },
          { id: "factor_b", kind: "factor", label: "B" },
          { id: "outcome_1", kind: "outcome", label: "Outcome" },
        ],
        edges: [
          {
            from: "factor_a",
            to: "factor_b",
            strength_mean: 0.5,
            strength_std: 0.1,
            belief_exists: 0.9,
            effect_direction: "positive",
          },
          {
            from: "factor_b",
            to: "factor_a",
            strength_mean: 0.3,
            strength_std: 0.1,
            belief_exists: 0.8,
            effect_direction: "positive",
          }, // Bidirectional: A ↔ B
          {
            from: "factor_b",
            to: "outcome_1",
            strength_mean: 0.5,
            strength_std: 0.1,
            belief_exists: 0.9,
            effect_direction: "positive",
          },
          {
            from: "outcome_1",
            to: "goal_1",
            strength_mean: 0.5,
            strength_std: 0.1,
            belief_exists: 0.9,
            effect_direction: "positive",
          },
        ],
        options: [],
      });

      const result = validateV3Response(response);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === "BIDIRECTIONAL_EDGE")).toBe(
        true
      );
      const biError = result.errors.find((e) => e.code === "BIDIRECTIONAL_EDGE");
      expect(biError?.message).toMatch(/bidirectional/i);
    });

    it("reports bidirectional edges only once per pair", () => {
      const response = makeV3Response({
        nodes: [
          { id: "goal_1", kind: "goal", label: "Goal" },
          { id: "factor_a", kind: "factor", label: "A" },
          { id: "factor_b", kind: "factor", label: "B" },
          { id: "outcome_1", kind: "outcome", label: "Outcome" },
        ],
        edges: [
          {
            from: "factor_a",
            to: "factor_b",
            strength_mean: 0.5,
            strength_std: 0.1,
            belief_exists: 0.9,
            effect_direction: "positive",
          },
          {
            from: "factor_b",
            to: "factor_a",
            strength_mean: 0.3,
            strength_std: 0.1,
            belief_exists: 0.8,
            effect_direction: "positive",
          },
          {
            from: "factor_b",
            to: "outcome_1",
            strength_mean: 0.5,
            strength_std: 0.1,
            belief_exists: 0.9,
            effect_direction: "positive",
          },
          {
            from: "outcome_1",
            to: "goal_1",
            strength_mean: 0.5,
            strength_std: 0.1,
            belief_exists: 0.9,
            effect_direction: "positive",
          },
        ],
        options: [],
      });

      const result = validateV3Response(response);

      // Should only report BIDIRECTIONAL_EDGE once for the A↔B pair
      const biErrors = result.errors.filter(
        (e) => e.code === "BIDIRECTIONAL_EDGE"
      );
      expect(biErrors.length).toBe(1);
    });
  });

  describe("Severity Flag Controlled Validations", () => {
    let originalStrictTopologyValidation: boolean;

    beforeEach(async () => {
      // Import config dynamically to get current value
      const { config } = await import("../../src/config/index.js");
      originalStrictTopologyValidation = config.features.strictTopologyValidation;
    });

    afterEach(async () => {
      // Restore original config value
      const { config } = await import("../../src/config/index.js");
      (config.features as any).strictTopologyValidation =
        originalStrictTopologyValidation;
    });

    it("INVALID_EDGE_TYPE is warning by default", async () => {
      const { config } = await import("../../src/config/index.js");
      (config.features as any).strictTopologyValidation = false;

      const response = makeV3Response({
        nodes: [
          { id: "goal_1", kind: "goal", label: "Goal" },
          { id: "option_1", kind: "option", label: "Option" },
          { id: "outcome_1", kind: "outcome", label: "Outcome" },
        ],
        edges: [
          {
            from: "option_1",
            to: "outcome_1",
            strength_mean: 0.5,
            strength_std: 0.1,
            belief_exists: 0.9,
            effect_direction: "positive",
          }, // Invalid: option→outcome not allowed
          {
            from: "outcome_1",
            to: "goal_1",
            strength_mean: 0.5,
            strength_std: 0.1,
            belief_exists: 0.9,
            effect_direction: "positive",
          },
        ],
        options: [],
      });

      const result = validateV3Response(response);

      // INVALID_EDGE_TYPE should be a warning, not an error
      expect(
        result.warningsOnly.some((w) => w.code === "INVALID_EDGE_TYPE")
      ).toBe(true);
      expect(result.errors.some((e) => e.code === "INVALID_EDGE_TYPE")).toBe(
        false
      );
    });

    it("INVALID_EDGE_TYPE is error when strict mode enabled", async () => {
      const { config } = await import("../../src/config/index.js");
      (config.features as any).strictTopologyValidation = true;

      const response = makeV3Response({
        nodes: [
          { id: "goal_1", kind: "goal", label: "Goal" },
          { id: "option_1", kind: "option", label: "Option" },
          { id: "outcome_1", kind: "outcome", label: "Outcome" },
        ],
        edges: [
          {
            from: "option_1",
            to: "outcome_1",
            strength_mean: 0.5,
            strength_std: 0.1,
            belief_exists: 0.9,
            effect_direction: "positive",
          }, // Invalid: option→outcome not allowed
          {
            from: "outcome_1",
            to: "goal_1",
            strength_mean: 0.5,
            strength_std: 0.1,
            belief_exists: 0.9,
            effect_direction: "positive",
          },
        ],
        options: [],
      });

      const result = validateV3Response(response);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === "INVALID_EDGE_TYPE")).toBe(
        true
      );
    });

    it("STRENGTH_OUT_OF_RANGE is warning by default", async () => {
      const { config } = await import("../../src/config/index.js");
      (config.features as any).strictTopologyValidation = false;

      const response = makeV3Response({
        edges: [
          {
            from: "decision_1",
            to: "option_1",
            strength_mean: 1.0,
            strength_std: 0.1,
            belief_exists: 1.0,
            effect_direction: "positive",
          },
          {
            from: "option_1",
            to: "factor_1",
            strength_mean: 1.0,
            strength_std: 0.1,
            belief_exists: 1.0,
            effect_direction: "positive",
          },
          {
            from: "factor_1",
            to: "outcome_1",
            strength_mean: 2.5,
            strength_std: 0.15,
            belief_exists: 0.9,
            effect_direction: "positive",
          }, // Out of range: > 1.0
          {
            from: "outcome_1",
            to: "goal_1",
            strength_mean: 0.8,
            strength_std: 0.1,
            belief_exists: 0.95,
            effect_direction: "positive",
          },
        ],
      });

      const result = validateV3Response(response);

      expect(
        result.warningsOnly.some((w) => w.code === "STRENGTH_OUT_OF_RANGE")
      ).toBe(true);
      expect(
        result.errors.some((e) => e.code === "STRENGTH_OUT_OF_RANGE")
      ).toBe(false);
    });

    it("STRENGTH_OUT_OF_RANGE is error when strict mode enabled", async () => {
      const { config } = await import("../../src/config/index.js");
      (config.features as any).strictTopologyValidation = true;

      const response = makeV3Response({
        edges: [
          {
            from: "decision_1",
            to: "option_1",
            strength_mean: 1.0,
            strength_std: 0.1,
            belief_exists: 1.0,
            effect_direction: "positive",
          },
          {
            from: "option_1",
            to: "factor_1",
            strength_mean: 1.0,
            strength_std: 0.1,
            belief_exists: 1.0,
            effect_direction: "positive",
          },
          {
            from: "factor_1",
            to: "outcome_1",
            strength_mean: 2.5,
            strength_std: 0.15,
            belief_exists: 0.9,
            effect_direction: "positive",
          }, // Out of range
          {
            from: "outcome_1",
            to: "goal_1",
            strength_mean: 0.8,
            strength_std: 0.1,
            belief_exists: 0.95,
            effect_direction: "positive",
          },
        ],
      });

      const result = validateV3Response(response);

      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.code === "STRENGTH_OUT_OF_RANGE")
      ).toBe(true);
    });
  });
});
