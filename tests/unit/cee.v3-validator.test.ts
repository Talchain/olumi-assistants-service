import { describe, it, expect } from "vitest";

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
    it("detects simple cycle and returns GRAPH_CONTAINS_CYCLE error", () => {
      const response = makeV3Response({
        nodes: [
          { id: "goal_1", kind: "goal", label: "Goal" },
          { id: "factorA", kind: "factor", label: "A" },
          { id: "factorB", kind: "factor", label: "B" },
          { id: "factorC", kind: "factor", label: "C" },
          { id: "outcome_1", kind: "outcome", label: "Outcome" },
        ],
        edges: [
          {
            from: "factorA",
            to: "factorB",
            strength_mean: 0.5,
            strength_std: 0.1,
            belief_exists: 0.9,
            effect_direction: "positive",
          },
          {
            from: "factorB",
            to: "factorC",
            strength_mean: 0.5,
            strength_std: 0.1,
            belief_exists: 0.9,
            effect_direction: "positive",
          },
          {
            from: "factorC",
            to: "factorA",
            strength_mean: 0.5,
            strength_std: 0.1,
            belief_exists: 0.9,
            effect_direction: "positive",
          }, // Creates cycle: A → B → C → A
          {
            from: "factorC",
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
      expect(result.errors.some((e) => e.code === "GRAPH_CONTAINS_CYCLE")).toBe(
        true
      );
      const cycleError = result.errors.find(
        (e) => e.code === "GRAPH_CONTAINS_CYCLE"
      );
      expect(cycleError?.message).toMatch(/cycle detected/i);
    });

    it("allows valid DAG without cycles", () => {
      const response = makeV3Response({});

      const result = validateV3Response(response);

      // Should not have cycle-related errors
      expect(
        result.errors.some((e) => e.code === "GRAPH_CONTAINS_CYCLE")
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
          { id: "factorA", kind: "factor", label: "A" },
          { id: "outcome_1", kind: "outcome", label: "Outcome" },
        ],
        edges: [
          {
            from: "factorA",
            to: "factorA",
            strength_mean: 0.5,
            strength_std: 0.1,
            belief_exists: 0.9,
            effect_direction: "positive",
          }, // Self-loop
          {
            from: "factorA",
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
      expect(selfLoopError?.affected_node_id).toBe("factorA");
      expect(selfLoopError?.message).toMatch(/self-loop/i);
    });
  });

  describe("Bidirectional Edge Detection", () => {
    it("detects bidirectional edges and returns BIDIRECTIONAL_EDGE error", () => {
      const response = makeV3Response({
        nodes: [
          { id: "goal_1", kind: "goal", label: "Goal" },
          { id: "factorA", kind: "factor", label: "A" },
          { id: "factorB", kind: "factor", label: "B" },
          { id: "outcome_1", kind: "outcome", label: "Outcome" },
        ],
        edges: [
          {
            from: "factorA",
            to: "factorB",
            strength_mean: 0.5,
            strength_std: 0.1,
            belief_exists: 0.9,
            effect_direction: "positive",
          },
          {
            from: "factorB",
            to: "factorA",
            strength_mean: 0.3,
            strength_std: 0.1,
            belief_exists: 0.8,
            effect_direction: "positive",
          }, // Bidirectional: A ↔ B
          {
            from: "factorB",
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
          { id: "factorA", kind: "factor", label: "A" },
          { id: "factorB", kind: "factor", label: "B" },
          { id: "outcome_1", kind: "outcome", label: "Outcome" },
        ],
        edges: [
          {
            from: "factorA",
            to: "factorB",
            strength_mean: 0.5,
            strength_std: 0.1,
            belief_exists: 0.9,
            effect_direction: "positive",
          },
          {
            from: "factorB",
            to: "factorA",
            strength_mean: 0.3,
            strength_std: 0.1,
            belief_exists: 0.8,
            effect_direction: "positive",
          },
          {
            from: "factorB",
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

  describe("Topology Validation (Always Error)", () => {
    it("INVALID_EDGE_TYPE is always an error", () => {
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

      // INVALID_EDGE_TYPE is always an error per spec
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === "INVALID_EDGE_TYPE")).toBe(
        true
      );
      expect(
        result.warningsOnly.some((w) => w.code === "INVALID_EDGE_TYPE")
      ).toBe(false);
    });

    it("STRENGTH_OUT_OF_RANGE is always an error", () => {
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

      // STRENGTH_OUT_OF_RANGE is always an error per spec
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.code === "STRENGTH_OUT_OF_RANGE")
      ).toBe(true);
      expect(
        result.warningsOnly.some((w) => w.code === "STRENGTH_OUT_OF_RANGE")
      ).toBe(false);
    });
  });

  describe("Intervention-Edge Consistency (V4 Rules 11-12)", () => {
    it("detects INTERVENTION_NO_EDGE when intervention has no corresponding edge", () => {
      const response = makeV3Response({
        nodes: [
          { id: "goal_1", kind: "goal", label: "Goal" },
          { id: "decision_1", kind: "decision", label: "Decision" },
          { id: "option_1", kind: "option", label: "Option A" },
          { id: "factor_1", kind: "factor", label: "Factor 1" },
          { id: "factor_2", kind: "factor", label: "Factor 2" },
          { id: "outcome_1", kind: "outcome", label: "Outcome" },
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
          // Only edge to factor_1, NO edge to factor_2
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
            strength_mean: 0.5,
            strength_std: 0.1,
            belief_exists: 0.9,
            effect_direction: "positive",
          },
          {
            from: "factor_2",
            to: "outcome_1",
            strength_mean: 0.3,
            strength_std: 0.1,
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
                value: 0.8,
                source: "brief_extraction",
                target_match: {
                  node_id: "factor_1",
                  match_type: "exact_id",
                  confidence: "high",
                },
              },
              // Intervention for factor_2 but NO edge!
              factor_2: {
                value: 0.2,
                source: "brief_extraction",
                target_match: {
                  node_id: "factor_2",
                  match_type: "exact_id",
                  confidence: "high",
                },
              },
            },
          },
        ],
      });

      const result = validateV3Response(response);

      expect(
        result.warningsOnly.some((w) => w.code === "INTERVENTION_NO_EDGE")
      ).toBe(true);
      const warning = result.warningsOnly.find(
        (w) => w.code === "INTERVENTION_NO_EDGE"
      );
      expect(warning?.affected_node_id).toBe("factor_2");
      expect(warning?.affected_option_id).toBe("option_1");
      expect(warning?.message).toContain("no option→factor edge");
    });

    it("passes when interventions exactly match edges", () => {
      // Default makeV3Response has matching edge/intervention
      const response = makeV3Response({});

      const result = validateV3Response(response);

      expect(
        result.warningsOnly.filter((w) => w.code === "INTERVENTION_NO_EDGE")
      ).toHaveLength(0);
    });

    it("detects multiple interventions without edges for same option", () => {
      const response = makeV3Response({
        nodes: [
          { id: "goal_1", kind: "goal", label: "Goal" },
          { id: "decision_1", kind: "decision", label: "Decision" },
          { id: "option_1", kind: "option", label: "Option A" },
          { id: "factor_1", kind: "factor", label: "Factor 1" },
          { id: "factor_2", kind: "factor", label: "Factor 2" },
          { id: "factor_3", kind: "factor", label: "Factor 3" },
          { id: "outcome_1", kind: "outcome", label: "Outcome" },
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
          // Only edge to factor_1
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
            strength_mean: 0.5,
            strength_std: 0.1,
            belief_exists: 0.9,
            effect_direction: "positive",
          },
          {
            from: "factor_2",
            to: "outcome_1",
            strength_mean: 0.3,
            strength_std: 0.1,
            belief_exists: 0.9,
            effect_direction: "positive",
          },
          {
            from: "factor_3",
            to: "outcome_1",
            strength_mean: 0.3,
            strength_std: 0.1,
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
                value: 0.8,
                source: "brief_extraction",
                target_match: {
                  node_id: "factor_1",
                  match_type: "exact_id",
                  confidence: "high",
                },
              },
              // Interventions for factor_2 and factor_3 but NO edges!
              factor_2: {
                value: 0.2,
                source: "brief_extraction",
                target_match: {
                  node_id: "factor_2",
                  match_type: "exact_id",
                  confidence: "high",
                },
              },
              factor_3: {
                value: 0.2,
                source: "brief_extraction",
                target_match: {
                  node_id: "factor_3",
                  match_type: "exact_id",
                  confidence: "high",
                },
              },
            },
          },
        ],
      });

      const result = validateV3Response(response);

      const warnings = result.warningsOnly.filter(
        (w) => w.code === "INTERVENTION_NO_EDGE"
      );
      expect(warnings).toHaveLength(2);
      expect(warnings.map((w) => w.affected_node_id).sort()).toEqual([
        "factor_2",
        "factor_3",
      ]);
    });

    it("detects EDGE_NO_INTERVENTION when edge has no corresponding intervention", () => {
      const response = makeV3Response({
        nodes: [
          { id: "goal_1", kind: "goal", label: "Goal" },
          { id: "decision_1", kind: "decision", label: "Decision" },
          { id: "option_1", kind: "option", label: "Option A" },
          { id: "factor_1", kind: "factor", label: "Factor 1" },
          { id: "factor_2", kind: "factor", label: "Factor 2" },
          { id: "outcome_1", kind: "outcome", label: "Outcome" },
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
          // Edges to both factor_1 AND factor_2
          {
            from: "option_1",
            to: "factor_1",
            strength_mean: 1.0,
            strength_std: 0.1,
            belief_exists: 1.0,
            effect_direction: "positive",
          },
          {
            from: "option_1",
            to: "factor_2",
            strength_mean: 1.0,
            strength_std: 0.1,
            belief_exists: 1.0,
            effect_direction: "positive",
          },
          {
            from: "factor_1",
            to: "outcome_1",
            strength_mean: 0.5,
            strength_std: 0.1,
            belief_exists: 0.9,
            effect_direction: "positive",
          },
          {
            from: "factor_2",
            to: "outcome_1",
            strength_mean: 0.3,
            strength_std: 0.1,
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
              // Only intervention for factor_1, but edge exists to factor_2 too!
              factor_1: {
                value: 0.8,
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
      });

      const result = validateV3Response(response);

      expect(
        result.warningsOnly.some((w) => w.code === "EDGE_NO_INTERVENTION")
      ).toBe(true);
      const warning = result.warningsOnly.find(
        (w) => w.code === "EDGE_NO_INTERVENTION"
      );
      expect(warning?.affected_node_id).toBe("factor_2");
      expect(warning?.affected_option_id).toBe("option_1");
      expect(warning?.message).toContain("no corresponding intervention");
    });

    it("detects INTERVENTION_KEY_MISMATCH when key differs from target_match.node_id", () => {
      const response = makeV3Response({
        nodes: [
          { id: "goal_1", kind: "goal", label: "Goal" },
          { id: "decision_1", kind: "decision", label: "Decision" },
          { id: "option_1", kind: "option", label: "Option A" },
          { id: "factor_1", kind: "factor", label: "Factor 1" },
          { id: "factor_2", kind: "factor", label: "Factor 2" },
          { id: "outcome_1", kind: "outcome", label: "Outcome" },
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
            from: "option_1",
            to: "factor_2",
            strength_mean: 1.0,
            strength_std: 0.1,
            belief_exists: 1.0,
            effect_direction: "positive",
          },
          {
            from: "factor_1",
            to: "outcome_1",
            strength_mean: 0.5,
            strength_std: 0.1,
            belief_exists: 0.9,
            effect_direction: "positive",
          },
          {
            from: "factor_2",
            to: "outcome_1",
            strength_mean: 0.3,
            strength_std: 0.1,
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
              // Key is "factor_1" but target_match.node_id is "factor_2" - MISMATCH!
              factor_1: {
                value: 0.8,
                source: "brief_extraction",
                target_match: {
                  node_id: "factor_2", // Mismatch: key says factor_1
                  match_type: "exact_id",
                  confidence: "high",
                },
              },
              factor_2: {
                value: 0.5,
                source: "brief_extraction",
                target_match: {
                  node_id: "factor_2",
                  match_type: "exact_id",
                  confidence: "high",
                },
              },
            },
          },
        ],
      });

      const result = validateV3Response(response);

      expect(
        result.warningsOnly.some((w) => w.code === "INTERVENTION_KEY_MISMATCH")
      ).toBe(true);
      const warning = result.warningsOnly.find(
        (w) => w.code === "INTERVENTION_KEY_MISMATCH"
      );
      expect(warning?.message).toContain("factor_1");
      expect(warning?.message).toContain("factor_2");
    });
  });

  describe("Null/Undefined Interventions Regression", () => {
    it("handles options with undefined interventions without throwing", () => {
      const response = makeV3Response({
        options: [
          {
            id: "option_1",
            label: "Option A",
            status: "needs_user_mapping",
            interventions: undefined as any, // Simulate missing interventions
          },
        ],
      });

      // Should not throw "interventions is not iterable"
      expect(() => validateV3Response(response)).not.toThrow();

      const result = validateV3Response(response);
      // Validation should complete (may have warnings but no crash)
      expect(result).toBeDefined();
      expect(Array.isArray(result.errors)).toBe(true);
      expect(Array.isArray(result.warningsOnly)).toBe(true);
    });

    it("handles options with null interventions without throwing", () => {
      const response = makeV3Response({
        options: [
          {
            id: "option_1",
            label: "Option A",
            status: "needs_user_mapping",
            interventions: null as any, // Simulate null interventions
          },
        ],
      });

      // Should not throw "interventions is not iterable"
      expect(() => validateV3Response(response)).not.toThrow();

      const result = validateV3Response(response);
      expect(result).toBeDefined();
    });

    it("treats missing interventions as empty (no crash on ready status)", () => {
      const response = makeV3Response({
        options: [
          {
            id: "option_1",
            label: "Option A",
            status: "ready", // ready status with no interventions
            interventions: undefined as any,
          },
        ],
      });

      // Key assertion: validation completes without crash (regression test)
      // Before fix: "interventions is not iterable" TypeError
      const result = validateV3Response(response);
      expect(result).toBeDefined();
      expect(result.valid).toBeDefined();
      expect(Array.isArray(result.errors)).toBe(true);
      expect(Array.isArray(result.warningsOnly)).toBe(true);
    });
  });
});
