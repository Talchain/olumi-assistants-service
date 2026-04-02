/**
 * Tests for the diagnostic_checks utility.
 *
 * Verifies that computeDiagnosticChecks produces correct boolean results
 * for each check given known V3 response bodies and pipeline traces.
 */

import { describe, it, expect } from "vitest";
import { computeDiagnosticChecks } from "../../src/cee/observability/diagnostic-checks.js";
import type { DiagnosticChecks } from "../../src/cee/observability/diagnostic-checks.js";

// ============================================================================
// Fixtures
// ============================================================================

/** Build a V3 body with known data at correct paths. */
function makePopulatedV3Body(): Record<string, unknown> {
  return {
    nodes: [
      { id: "dec_1", kind: "decision", label: "Pricing" },
      { id: "opt_a", kind: "option", label: "Option A" },
      { id: "opt_b", kind: "option", label: "Option B" },
      { id: "fac_price", kind: "factor", label: "Price Level", category: "controllable", intercept: 0.69, observed_state: { value: 0.69 } },
      { id: "fac_churn", kind: "factor", label: "Churn Rate", category: "observable", intercept: 0.12 },
      { id: "fac_ext", kind: "factor", label: "Market Size", category: "external" },
      { id: "goal_1", kind: "goal", label: "Maximize Revenue" },
    ],
    edges: [
      { from: "dec_1", to: "opt_a", edge_type: "structural", exists_probability: 1.0, effect_direction: "positive" },
      { from: "dec_1", to: "opt_b", edge_type: "structural", exists_probability: 1.0, effect_direction: "positive" },
      { from: "fac_price", to: "goal_1", exists_probability: 0.92, effect_direction: "positive" },
      { from: "fac_churn", to: "goal_1", exists_probability: 0.78, effect_direction: "negative" },
      { from: "fac_ext", to: "goal_1", exists_probability: 0.65, effect_direction: "positive" },
    ],
    options: [
      { id: "opt_a", label: "Option A", is_baseline: true, interventions: [] },
      { id: "opt_b", label: "Option B", is_baseline: false, interventions: [] },
    ],
  };
}

/** Build a pipeline trace with populated fields. */
function makePopulatedTrace(): Record<string, unknown> {
  return {
    llm_raw: { text: "raw llm output here", node_count: 7 },
    cee_provenance: { pipelinePath: "unified", model: "claude-sonnet-4-6" },
    status: "success",
  };
}

/** Build a V3 body with missing/empty data. */
function makeEmptyV3Body(): Record<string, unknown> {
  return {
    nodes: [],
    edges: [],
    options: [],
  };
}

/** Build a pipeline trace with missing fields. */
function makeEmptyTrace(): Record<string, unknown> {
  return {
    status: "success",
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("computeDiagnosticChecks", () => {
  describe("with populated data", () => {
    let checks: DiagnosticChecks;

    it("returns correct checks for fully populated bundle", () => {
      checks = computeDiagnosticChecks(makePopulatedV3Body(), makePopulatedTrace());

      expect(checks.llm_raw_available).toBe(true);
      expect(checks.cee_trace_present).toBe(true);
      expect(checks.confidence_differentiated).toBe(true);
      expect(checks.confidence_unique_values).toEqual([0.65, 0.78, 0.92]);
      expect(checks.intercept_populated).toBe(true);
      expect(checks.is_baseline_present).toBe(true);
    });
  });

  describe("with missing data", () => {
    it("returns false for all checks when data is absent", () => {
      const checks = computeDiagnosticChecks(makeEmptyV3Body(), makeEmptyTrace());

      expect(checks.llm_raw_available).toBe(false);
      expect(checks.cee_trace_present).toBe(false);
      expect(checks.confidence_differentiated).toBe(false);
      expect(checks.confidence_unique_values).toEqual([]);
      expect(checks.intercept_populated).toBe(false);
      expect(checks.is_baseline_present).toBe(false);
    });
  });

  describe("llm_raw_available", () => {
    it("returns true when pipeline trace has llm_raw", () => {
      const checks = computeDiagnosticChecks(makeEmptyV3Body(), { llm_raw: { text: "data" } });
      expect(checks.llm_raw_available).toBe(true);
    });

    it("returns false when llm_raw is null", () => {
      const checks = computeDiagnosticChecks(makeEmptyV3Body(), { llm_raw: null });
      expect(checks.llm_raw_available).toBe(false);
    });
  });

  describe("cee_trace_present", () => {
    it("returns true when cee_provenance exists", () => {
      const checks = computeDiagnosticChecks(makeEmptyV3Body(), { cee_provenance: { model: "test" } });
      expect(checks.cee_trace_present).toBe(true);
    });

    it("returns false when cee_provenance is absent", () => {
      const checks = computeDiagnosticChecks(makeEmptyV3Body(), {});
      expect(checks.cee_trace_present).toBe(false);
    });
  });

  describe("confidence_differentiated", () => {
    it("returns false when only structural edges exist (all 1.0)", () => {
      const v3 = {
        edges: [
          { from: "a", to: "b", edge_type: "structural", exists_probability: 1.0 },
          { from: "a", to: "c", edge_type: "structural", exists_probability: 1.0 },
        ],
      };
      const checks = computeDiagnosticChecks(v3, makeEmptyTrace());
      expect(checks.confidence_differentiated).toBe(false);
      expect(checks.confidence_unique_values).toEqual([]);
    });

    it("returns false when all causal edges have the same probability", () => {
      const v3 = {
        edges: [
          { from: "a", to: "b", exists_probability: 0.8 },
          { from: "c", to: "d", exists_probability: 0.8 },
        ],
      };
      const checks = computeDiagnosticChecks(v3, makeEmptyTrace());
      expect(checks.confidence_differentiated).toBe(false);
      expect(checks.confidence_unique_values).toEqual([0.8]);
    });

    it("returns true with 2+ distinct non-1.0 values", () => {
      const v3 = {
        edges: [
          { from: "a", to: "b", exists_probability: 0.85 },
          { from: "c", to: "d", exists_probability: 0.65 },
          { from: "e", to: "f", exists_probability: 1.0 }, // causal 1.0 excluded
        ],
      };
      const checks = computeDiagnosticChecks(v3, makeEmptyTrace());
      expect(checks.confidence_differentiated).toBe(true);
      expect(checks.confidence_unique_values).toEqual([0.65, 0.85]);
    });

    it("handles graph.edges path (nested under graph)", () => {
      const v3 = {
        graph: {
          edges: [
            { from: "a", to: "b", exists_probability: 0.7 },
            { from: "c", to: "d", exists_probability: 0.9 },
          ],
        },
      };
      const checks = computeDiagnosticChecks(v3, makeEmptyTrace());
      expect(checks.confidence_differentiated).toBe(true);
    });
  });

  describe("intercept_populated", () => {
    it("returns true when a non-external factor has intercept", () => {
      const v3 = {
        nodes: [
          { id: "f1", kind: "factor", category: "controllable", intercept: 0.5 },
        ],
      };
      const checks = computeDiagnosticChecks(v3, makeEmptyTrace());
      expect(checks.intercept_populated).toBe(true);
    });

    it("returns false when only external factors have intercept", () => {
      const v3 = {
        nodes: [
          { id: "f1", kind: "factor", category: "external", intercept: 0.5 },
          { id: "f2", kind: "factor", category: "controllable" },
        ],
      };
      const checks = computeDiagnosticChecks(v3, makeEmptyTrace());
      expect(checks.intercept_populated).toBe(false);
    });

    it("returns false when no factors have intercept", () => {
      const v3 = {
        nodes: [
          { id: "f1", kind: "factor", category: "observable" },
        ],
      };
      const checks = computeDiagnosticChecks(v3, makeEmptyTrace());
      expect(checks.intercept_populated).toBe(false);
    });

    it("detects intercept inside observed_state", () => {
      const v3 = {
        nodes: [
          { id: "f1", kind: "factor", category: "observable", observed_state: { value: 0.3, intercept: 0.3 } },
        ],
      };
      const checks = computeDiagnosticChecks(v3, makeEmptyTrace());
      expect(checks.intercept_populated).toBe(true);
    });

    it("ignores non-factor nodes", () => {
      const v3 = {
        nodes: [
          { id: "o1", kind: "option", intercept: 0.5 },
          { id: "g1", kind: "goal", intercept: 0.8 },
        ],
      };
      const checks = computeDiagnosticChecks(v3, makeEmptyTrace());
      expect(checks.intercept_populated).toBe(false);
    });
  });

  describe("is_baseline_present", () => {
    it("returns true when one option has is_baseline: true", () => {
      const v3 = {
        options: [
          { id: "o1", is_baseline: true },
          { id: "o2", is_baseline: false },
        ],
      };
      const checks = computeDiagnosticChecks(v3, makeEmptyTrace());
      expect(checks.is_baseline_present).toBe(true);
    });

    it("returns false when all options have is_baseline: false", () => {
      const v3 = {
        options: [
          { id: "o1", is_baseline: false },
          { id: "o2", is_baseline: false },
        ],
      };
      const checks = computeDiagnosticChecks(v3, makeEmptyTrace());
      expect(checks.is_baseline_present).toBe(false);
    });

    it("returns false when options array is absent", () => {
      const checks = computeDiagnosticChecks({}, makeEmptyTrace());
      expect(checks.is_baseline_present).toBe(false);
    });

    it("returns false when is_baseline is undefined on all options", () => {
      const v3 = {
        options: [
          { id: "o1" },
          { id: "o2" },
        ],
      };
      const checks = computeDiagnosticChecks(v3, makeEmptyTrace());
      expect(checks.is_baseline_present).toBe(false);
    });
  });
});
