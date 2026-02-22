/**
 * Causal Claims Validation Unit Tests (Phase 2B — Task 5)
 *
 * Tests the non-blocking validation logic: malformed claims are dropped,
 * invalid node references are dropped, truncation at 20, absent = omit.
 */

import { describe, it, expect } from "vitest";
import { validateCausalClaims } from "../../src/cee/transforms/causal-claims-validation.js";
import { CAUSAL_CLAIMS_WARNING_CODES } from "../../src/schemas/causal-claims.js";

const GRAPH_NODE_IDS = new Set(["goal_1", "dec_1", "fac_1", "fac_2", "opt_1", "opt_2", "out_1"]);

describe("validateCausalClaims", () => {
  // Test 1: Valid claims parse correctly
  it("passes through all 4 claim types when valid", () => {
    const raw = [
      { type: "direct_effect", from: "fac_1", to: "out_1", stated_strength: "strong" },
      { type: "mediation_only", from: "fac_1", via: "fac_2", to: "out_1" },
      { type: "no_direct_effect", from: "opt_1", to: "goal_1" },
      { type: "unmeasured_confounder", between: ["fac_1", "fac_2"] },
    ];

    const result = validateCausalClaims(raw, GRAPH_NODE_IDS);
    expect(result.claims).toHaveLength(4);
    expect(result.warnings).toHaveLength(0);
    expect(result.claims[0]).toEqual(raw[0]);
    expect(result.claims[1]).toEqual(raw[1]);
    expect(result.claims[2]).toEqual(raw[2]);
    expect(result.claims[3]).toEqual(raw[3]);
  });

  // Test 2: Malformed claim dropped
  it("drops claims with missing required fields and emits DROPPED warning", () => {
    const raw = [
      { type: "direct_effect", from: "fac_1", to: "out_1", stated_strength: "strong" },
      { type: "direct_effect", from: "fac_1" /* missing 'to' and 'stated_strength' */ },
      { type: "mediation_only", from: "fac_1", to: "out_1" /* missing 'via' */ },
    ];

    const result = validateCausalClaims(raw, GRAPH_NODE_IDS);
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0].type).toBe("direct_effect");

    const dropWarning = result.warnings.find((w) => w.code === CAUSAL_CLAIMS_WARNING_CODES.DROPPED);
    expect(dropWarning).toBeDefined();
    expect(dropWarning!.severity).toBe("warn");
    expect((dropWarning!.details as any).count).toBe(2);
    expect((dropWarning!.details as any).first_3_reasons).toHaveLength(2);
  });

  // Test 3: Invalid node reference dropped
  it("drops claims referencing non-existent node IDs", () => {
    const raw = [
      { type: "direct_effect", from: "fac_1", to: "out_1", stated_strength: "strong" },
      { type: "direct_effect", from: "fac_nonexistent", to: "out_1", stated_strength: "weak" },
    ];

    const result = validateCausalClaims(raw, GRAPH_NODE_IDS);
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0].from).toBe("fac_1");

    const refWarning = result.warnings.find((w) => w.code === CAUSAL_CLAIMS_WARNING_CODES.INVALID_REF);
    expect(refWarning).toBeDefined();
    expect((refWarning!.details as any).count).toBe(1);
    expect((refWarning!.details as any).missing_ids).toContain("fac_nonexistent");
  });

  // Test 4: Truncation at 20
  it("truncates to first 20 claims and emits TRUNCATED warning", () => {
    const raw = Array.from({ length: 25 }, (_, i) => ({
      type: "direct_effect" as const,
      from: "fac_1",
      to: "out_1",
      stated_strength: "moderate" as const,
    }));

    const result = validateCausalClaims(raw, GRAPH_NODE_IDS);
    expect(result.claims).toHaveLength(20);

    const truncWarning = result.warnings.find((w) => w.code === CAUSAL_CLAIMS_WARNING_CODES.TRUNCATED);
    expect(truncWarning).toBeDefined();
    expect(truncWarning!.severity).toBe("info");
    expect((truncWarning!.details as any).original_count).toBe(25);
    expect((truncWarning!.details as any).kept).toBe(20);
  });

  // Test 5: Absent claims field
  // (This is handled at the pipeline level — if undefined, validateCausalClaims is not called)
  // But test the non-array case which produces MALFORMED

  // Test 5b: Not an array produces MALFORMED
  it("emits MALFORMED warning when causal_claims is not an array", () => {
    const result = validateCausalClaims("not_an_array", GRAPH_NODE_IDS);
    expect(result.claims).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].code).toBe(CAUSAL_CLAIMS_WARNING_CODES.MALFORMED);
    expect(result.warnings[0].severity).toBe("warn");
  });

  it("emits MALFORMED warning when causal_claims is an object", () => {
    const result = validateCausalClaims({ foo: "bar" }, GRAPH_NODE_IDS);
    expect(result.claims).toHaveLength(0);
    expect(result.warnings[0].code).toBe(CAUSAL_CLAIMS_WARNING_CODES.MALFORMED);
  });

  // Test 6: Empty claims array
  it("passes through empty claims array with no warnings", () => {
    const result = validateCausalClaims([], GRAPH_NODE_IDS);
    expect(result.claims).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  // Test 7: Claims must use canonical IDs
  it("drops claims using non-canonical labels instead of node IDs", () => {
    const raw = [
      { type: "direct_effect", from: "Market Size", to: "Revenue", stated_strength: "strong" },
    ];

    const result = validateCausalClaims(raw, GRAPH_NODE_IDS);
    expect(result.claims).toHaveLength(0);

    const refWarning = result.warnings.find((w) => w.code === CAUSAL_CLAIMS_WARNING_CODES.INVALID_REF);
    expect(refWarning).toBeDefined();
    expect((refWarning!.details as any).missing_ids).toContain("Market Size");
    expect((refWarning!.details as any).missing_ids).toContain("Revenue");
  });

  // Test: unmeasured_confounder with stated_source is preserved
  it("preserves optional stated_source on unmeasured_confounder", () => {
    const raw = [
      {
        type: "unmeasured_confounder",
        between: ["fac_1", "fac_2"],
        stated_source: "industry report",
      },
    ];

    const result = validateCausalClaims(raw, GRAPH_NODE_IDS);
    expect(result.claims).toHaveLength(1);
    expect((result.claims[0] as any).stated_source).toBe("industry report");
  });

  // Test: epsilon floor on outcome_mean_cv is ISL-side, not here,
  // but we test that invalid stated_strength values are dropped
  it("drops claims with invalid stated_strength enum value", () => {
    const raw = [
      { type: "direct_effect", from: "fac_1", to: "out_1", stated_strength: "very_strong" },
    ];

    const result = validateCausalClaims(raw, GRAPH_NODE_IDS);
    expect(result.claims).toHaveLength(0);
    expect(result.warnings.find((w) => w.code === CAUSAL_CLAIMS_WARNING_CODES.DROPPED)).toBeDefined();
  });

  // Test: blank/empty string IDs are rejected early (min(1) constraint)
  it("drops claims with blank or empty string node IDs", () => {
    const raw = [
      { type: "direct_effect", from: "", to: "out_1", stated_strength: "strong" },
      { type: "no_direct_effect", from: "fac_1", to: "" },
      { type: "mediation_only", from: "fac_1", via: "", to: "out_1" },
      { type: "unmeasured_confounder", between: ["fac_1", ""] },
    ];

    const result = validateCausalClaims(raw, GRAPH_NODE_IDS);
    expect(result.claims).toHaveLength(0);
    expect(result.warnings.find((w) => w.code === CAUSAL_CLAIMS_WARNING_CODES.DROPPED)).toBeDefined();
    expect((result.warnings[0].details as any).count).toBe(4);
  });

  // Test: multiple validation stages accumulate warnings correctly
  it("accumulates warnings from multiple validation stages", () => {
    const raw = [
      // Valid
      { type: "direct_effect", from: "fac_1", to: "out_1", stated_strength: "strong" },
      // Malformed (missing 'to')
      { type: "no_direct_effect", from: "fac_1" },
      // Valid but references missing node
      { type: "direct_effect", from: "fac_1", to: "missing_node", stated_strength: "weak" },
    ];

    const result = validateCausalClaims(raw, GRAPH_NODE_IDS);
    expect(result.claims).toHaveLength(1);
    expect(result.warnings).toHaveLength(2); // DROPPED + INVALID_REF
  });
});
