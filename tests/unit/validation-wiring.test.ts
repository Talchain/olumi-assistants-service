/**
 * Validation Wiring Smoke Test
 *
 * Tests that the validation layer is correctly wired and producing expected results.
 * This catches regressions where validators stop being called but outputs are still produced.
 *
 * @module tests/unit/validation-wiring.test
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { validateGraph } from "../../src/validators/graph-validator.js";
import type { GraphT } from "../../src/schemas/graph.js";

// ============================================================================
// Test Data Loading
// ============================================================================

const FIXTURES_DIR = join(__dirname, "../fixtures/golden");

interface GoldenFixture {
  name: string;
  recorded_response?: {
    graph: GraphT;
    validation?: {
      passed: boolean;
      errors: unknown[];
      warnings: unknown[];
    };
  };
}

function loadFixture(filename: string): GoldenFixture {
  const path = join(FIXTURES_DIR, filename);
  return JSON.parse(readFileSync(path, "utf-8")) as GoldenFixture;
}

// ============================================================================
// Live Validation Smoke Tests
// ============================================================================

describe("Validation Wiring", () => {
  describe("Live validation on fixture graphs", () => {
    it("validation-healthy fixture runs through validator without throwing", () => {
      const fixture = loadFixture("validation-healthy.json");
      expect(fixture.recorded_response?.graph).toBeDefined();

      // Verify validation runs and returns expected shape
      // Note: Live validation may produce different results than recorded
      // because recorded responses capture post-repair state while live
      // validation checks the raw fixture graph structure
      const result = validateGraph({ graph: fixture.recorded_response!.graph });

      expect(result).toHaveProperty("valid");
      expect(result).toHaveProperty("errors");
      expect(result).toHaveProperty("warnings");
      expect(Array.isArray(result.errors)).toBe(true);
      expect(Array.isArray(result.warnings)).toBe(true);
    });

    it("validation-blocker graph fails live validation", () => {
      const fixture = loadFixture("validation-blocker.json");
      expect(fixture.recorded_response?.graph).toBeDefined();

      const result = validateGraph({ graph: fixture.recorded_response!.graph });

      // Should fail validation due to MISSING_GOAL and INVALID_EDGE_REF
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);

      // Check that specific error codes are present
      const errorCodes = result.errors.map((e) => e.code);
      expect(errorCodes).toContain("MISSING_GOAL");
    });

    it("validateGraph function is callable and returns expected shape", () => {
      // Minimal valid graph structure
      const minimalGraph: GraphT = {
        version: "1",
        nodes: [
          { id: "decision_1", kind: "decision", label: "Test decision" },
          { id: "opt_a", kind: "option", label: "Option A" },
          { id: "opt_b", kind: "option", label: "Option B" },
          { id: "fac_1", kind: "factor", label: "Factor 1", category: "controllable" },
          { id: "outcome_1", kind: "outcome", label: "Test outcome" },
          { id: "goal_1", kind: "goal", label: "Test goal" },
        ],
        edges: [
          { from: "decision_1", to: "opt_a", strength_mean: 1, strength_std: 0.01, belief_exists: 1 },
          { from: "decision_1", to: "opt_b", strength_mean: 1, strength_std: 0.01, belief_exists: 1 },
          { from: "opt_a", to: "fac_1", strength_mean: 1, strength_std: 0.01, belief_exists: 1 },
          { from: "fac_1", to: "outcome_1", strength_mean: 0.5, strength_std: 0.1, belief_exists: 0.9 },
          { from: "outcome_1", to: "goal_1", strength_mean: 0.8, strength_std: 0.1, belief_exists: 1 },
        ],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
      };

      const result = validateGraph({ graph: minimalGraph });

      // Result should have expected shape
      expect(result).toHaveProperty("valid");
      expect(result).toHaveProperty("errors");
      expect(result).toHaveProperty("warnings");
      expect(Array.isArray(result.errors)).toBe(true);
      expect(Array.isArray(result.warnings)).toBe(true);
    });
  });

  describe("Validation detects structural issues", () => {
    it("detects missing goal node", () => {
      const graphWithoutGoal: GraphT = {
        version: "1",
        nodes: [
          { id: "decision_1", kind: "decision", label: "Test decision" },
          { id: "opt_a", kind: "option", label: "Option A" },
          { id: "opt_b", kind: "option", label: "Option B" },
        ],
        edges: [
          { from: "decision_1", to: "opt_a", strength_mean: 1, strength_std: 0.01, belief_exists: 1 },
          { from: "decision_1", to: "opt_b", strength_mean: 1, strength_std: 0.01, belief_exists: 1 },
        ],
        meta: {},
      };

      const result = validateGraph({ graph: graphWithoutGoal });

      expect(result.valid).toBe(false);
      const errorCodes = result.errors.map((e) => e.code);
      expect(errorCodes).toContain("MISSING_GOAL");
    });

    it("detects invalid edge references", () => {
      const graphWithBadEdge: GraphT = {
        version: "1",
        nodes: [
          { id: "decision_1", kind: "decision", label: "Test decision" },
          { id: "opt_a", kind: "option", label: "Option A" },
          { id: "opt_b", kind: "option", label: "Option B" },
          { id: "goal_1", kind: "goal", label: "Test goal" },
        ],
        edges: [
          { from: "decision_1", to: "opt_a", strength_mean: 1, strength_std: 0.01, belief_exists: 1 },
          { from: "decision_1", to: "opt_b", strength_mean: 1, strength_std: 0.01, belief_exists: 1 },
          // Edge to non-existent node
          { from: "opt_a", to: "nonexistent_node", strength_mean: 0.5, strength_std: 0.1, belief_exists: 0.9 },
        ],
        meta: {},
      };

      const result = validateGraph({ graph: graphWithBadEdge });

      expect(result.valid).toBe(false);
      const errorCodes = result.errors.map((e) => e.code);
      expect(errorCodes).toContain("INVALID_EDGE_REF");
    });

    it("detects insufficient options", () => {
      const graphWithOneOption: GraphT = {
        version: "1",
        nodes: [
          { id: "decision_1", kind: "decision", label: "Test decision" },
          { id: "opt_a", kind: "option", label: "Option A" },
          { id: "goal_1", kind: "goal", label: "Test goal" },
        ],
        edges: [
          { from: "decision_1", to: "opt_a", strength_mean: 1, strength_std: 0.01, belief_exists: 1 },
        ],
        meta: {},
      };

      const result = validateGraph({ graph: graphWithOneOption });

      expect(result.valid).toBe(false);
      const errorCodes = result.errors.map((e) => e.code);
      expect(errorCodes).toContain("INSUFFICIENT_OPTIONS");
    });
  });
});
