/**
 * Cross-boundary contract tests: UI → CEE.
 *
 * Every golden fixture represents a real payload shape the UI sends.
 * If a fixture fails validation the schema must be fixed — not the fixture.
 */
import { describe, it, expect } from "vitest";
import { TurnRequestSchema, AnalysisStateSchema } from "../../src/orchestrator/route-schemas.js";

import conversationFixture from "../fixtures/golden/ui-turn-conversation.json";
import generateModelFixture from "../fixtures/golden/ui-turn-generate-model.json";
import postAnalysisFixture from "../fixtures/golden/ui-turn-post-analysis.json";
import withGraphFixture from "../fixtures/golden/ui-turn-with-graph.json";
import editRequestFixture from "../fixtures/golden/ui-turn-edit-request.json";
import analysisStateFixture from "../fixtures/golden/ui-analysis-state-real.json";

describe("UI → CEE contract validation", () => {
  const fixtures = [
    ["conversation turn", conversationFixture],
    ["generate_model turn", generateModelFixture],
    ["post-analysis turn", postAnalysisFixture],
    ["turn with graph", withGraphFixture],
    ["edit request turn", editRequestFixture],
  ] as const;

  for (const [name, fixture] of fixtures) {
    it(`accepts real UI payload: ${name}`, () => {
      const result = TurnRequestSchema.safeParse(fixture);
      if (!result.success) {
        console.error(
          `Schema rejected ${name}:`,
          JSON.stringify(result.error.format(), null, 2),
        );
      }
      expect(result.success).toBe(true);
    });

    it(`preserves critical fields after parse: ${name}`, () => {
      const result = TurnRequestSchema.parse(fixture);
      expect(result.scenario_id).toBeTruthy();
      expect(result.client_turn_id).toBeTruthy();
      expect(result.message).toBeTruthy();
    });
  }

  it("post-analysis fixture has analysis_state with option_comparison", () => {
    const result = TurnRequestSchema.parse(postAnalysisFixture);
    expect(result.analysis_state).toBeDefined();
    expect(
      (result.analysis_state as Record<string, unknown>).option_comparison,
    ).toBeDefined();
    expect(
      (
        (result.analysis_state as Record<string, unknown>)
          .option_comparison as unknown[]
      ).length,
    ).toBeGreaterThan(0);
  });

  it("generate_model fixture has generate_model flag", () => {
    const result = TurnRequestSchema.parse(generateModelFixture);
    expect(
      result.generate_model === true || result.explicit_generate === true,
    ).toBe(true);
  });

  it("graph fixture has non-empty graph_state", () => {
    const result = TurnRequestSchema.parse(withGraphFixture);
    expect(result.graph_state?.nodes?.length).toBeGreaterThan(0);
  });

  it("validates real analysis_state fixture (PLoT v2 shape with all fields)", () => {
    const result = AnalysisStateSchema.safeParse(analysisStateFixture);
    if (!result.success) {
      console.error(
        "Schema rejected analysis_state fixture:",
        JSON.stringify(result.error.format(), null, 2),
      );
    }
    expect(result.success).toBe(true);
  });

  it("preserves passthrough fields on analysis_state (robustness, factor_sensitivity, etc.)", () => {
    const result = AnalysisStateSchema.parse(analysisStateFixture);
    expect((result as Record<string, unknown>).robustness).toBeDefined();
    expect(
      (result as Record<string, unknown>).factor_sensitivity,
    ).toBeDefined();
  });

  // ── Boundary regression guards ────────────────────────────────────────
  // These lock the specific invariant that caused the original regression:
  // analysis_state must be an object at the top level, never an array.

  describe("analysis_state boundary behavior", () => {
    it("rejects top-level array (the original regression shape)", () => {
      const result = AnalysisStateSchema.safeParse([
        { option_id: "opt_1", option_label: "A", win_probability: 0.65 },
      ]);
      expect(result.success).toBe(false);
    });

    it("accepts top-level object with option_comparison", () => {
      const result = AnalysisStateSchema.safeParse({
        option_comparison: [
          { option_id: "opt_1", option_label: "A", win_probability: 0.65 },
        ],
      });
      expect(result.success).toBe(true);
    });

    it("accepts analysis_state without meta (meta is optional)", () => {
      const result = AnalysisStateSchema.safeParse({
        analysis_status: "complete",
        option_comparison: [{ option_id: "opt_1" }],
      });
      expect(result.success).toBe(true);
    });

    it("rejects meta present but missing response_hash", () => {
      const result = AnalysisStateSchema.safeParse({
        meta: { seed_used: 42 },
        option_comparison: [{ option_id: "opt_1" }],
      });
      expect(result.success).toBe(false);
    });

    it("accepts results as object (UI variant where results wraps option_comparison)", () => {
      const result = AnalysisStateSchema.safeParse({
        meta: { response_hash: "rh-1" },
        results: { option_comparison: [{ option_id: "opt_1" }] },
      });
      expect(result.success).toBe(true);
    });

    it("accepts results as array (legacy PLoT shape)", () => {
      const result = AnalysisStateSchema.safeParse({
        meta: { response_hash: "rh-1" },
        results: [{ option_id: "opt_1" }],
      });
      expect(result.success).toBe(true);
    });

    it("rejects string value for analysis_state", () => {
      const result = AnalysisStateSchema.safeParse("complete");
      expect(result.success).toBe(false);
    });

    it("rejects number value for analysis_state", () => {
      const result = AnalysisStateSchema.safeParse(42);
      expect(result.success).toBe(false);
    });

    it("accepts null (nullable — UI sends null when no analysis)", () => {
      const result = AnalysisStateSchema.safeParse(null);
      expect(result.success).toBe(true);
    });

    it("TurnRequestSchema rejects analysis_state when it is a top-level array", () => {
      const result = TurnRequestSchema.safeParse({
        message: "test",
        scenario_id: "scn-1",
        client_turn_id: "ct-1",
        analysis_state: [{ option_id: "opt_1" }],
      });
      expect(result.success).toBe(false);
    });
  });
});
