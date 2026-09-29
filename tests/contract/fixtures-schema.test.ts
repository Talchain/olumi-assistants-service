/**
 * Cross-boundary fixture schema validation.
 *
 * Each fixture in tests/fixtures/cross-service/ MUST parse cleanly through the
 * Zod schema for the endpoint it represents. A failing parse means the fixture
 * has drifted from the deployed contract — fix the fixture, not the schema.
 *
 * This test runs first (alphabetical filename ordering) so downstream
 * behavioural tests can assume their inputs are schema-valid.
 */
import { describe, it, expect } from "vitest";

import { CEEGraphResponseV3 } from "../../src/schemas/cee-v3.js";
import { OlumiResponseSchema } from "@talchain/schemas/boundary";

import draftWithCoaching from "../fixtures/cross-service/draft-graph.success.with-coaching-and-provenance.json";
import draftNoCoaching from "../fixtures/cross-service/draft-graph.success.no-coaching.json";
import draftPartialCoaching from "../fixtures/cross-service/draft-graph.success.partial-coaching.json";
import v5Stale from "../fixtures/cross-service/v5-turn.explain-stale.json";
import v5Failure from "../fixtures/cross-service/v5-turn.failure-with-recovery-chip.json";
import v5Fresh from "../fixtures/cross-service/v5-turn.explain-fresh.json";
import decisionReview from "../fixtures/cross-service/decision-review.normalised.json";

describe("cross-service fixture schema validation", () => {
  const draftFixtures = [
    ["with-coaching-and-provenance", draftWithCoaching],
    ["no-coaching", draftNoCoaching],
    ["partial-coaching", draftPartialCoaching],
  ] as const;

  for (const [name, fixture] of draftFixtures) {
    it(`draft-graph.${name} parses against CEEGraphResponseV3`, () => {
      const result = CEEGraphResponseV3.safeParse(fixture);
      if (!result.success) {
        console.error(
          `Schema rejected draft-graph.${name}:`,
          JSON.stringify(result.error.format(), null, 2),
        );
      }
      expect(result.success).toBe(true);
    });
  }

  const v5Fixtures = [
    ["explain-stale", v5Stale],
    ["failure-with-recovery-chip", v5Failure],
    ["explain-fresh", v5Fresh],
  ] as const;

  for (const [name, fixture] of v5Fixtures) {
    it(`v5-turn.${name} parses against OlumiResponseSchema`, () => {
      const result = OlumiResponseSchema.safeParse(fixture);
      if (!result.success) {
        console.error(
          `Schema rejected v5-turn.${name}:`,
          JSON.stringify(result.error.format(), null, 2),
        );
      }
      expect(result.success).toBe(true);
    });
  }

  it("decision-review.normalised has the documented shape", () => {
    // DecisionReviewInvokeInput is an interface (not a Zod schema), so we assert
    // the documented required fields are present rather than parsing.
    const r = decisionReview as Record<string, unknown>;
    expect(typeof r.brief).toBe("string");
    expect(typeof r.brief_hash).toBe("string");
    expect(r.graph).toBeTypeOf("object");
    expect(r.isl_results).toBeTypeOf("object");
    expect(r.winner).toBeTypeOf("object");
    expect(Array.isArray((r as { flip_threshold_data: unknown[] }).flip_threshold_data)).toBe(true);
    const meta = r._meta as Record<string, unknown>;
    expect(meta.input_shape_version).toBe("v5-normalised");
    expect(typeof meta.flip_threshold_count).toBe("number");
    expect(typeof meta.factor_sensitivity_count).toBe("number");
    expect(typeof meta.fragile_edge_count).toBe("number");

    const isl = r.isl_results as Record<string, unknown>;
    const factorSens = isl.factor_sensitivity as Array<Record<string, unknown>>;
    expect(Array.isArray(factorSens)).toBe(true);
    expect(factorSens[0]).toHaveProperty("factor_id");
    expect(factorSens[0]).toHaveProperty("factor_label");
    expect(factorSens[0]).toHaveProperty("elasticity");

    const fragile = isl.fragile_edges as Array<Record<string, unknown>>;
    expect(fragile[0]).toHaveProperty("from_label");
    expect(fragile[0]).toHaveProperty("to_label");
  });
});
