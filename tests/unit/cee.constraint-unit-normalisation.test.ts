/**
 * Constraint Unit Normalisation Tests (Task A)
 *
 * Verifies that normaliseConstraintUnits() prevents double-encoding
 * when the extractor converts "4%" to value: 0.04 + unit: "%".
 */

import { describe, it, expect } from "vitest";
import {
  normaliseConstraintUnits,
  type ExtractedGoalConstraint,
} from "../../src/cee/compound-goal/index.js";

function makeConstraint(overrides: Partial<ExtractedGoalConstraint> = {}): ExtractedGoalConstraint {
  return {
    targetName: "churn rate",
    targetNodeId: "fac_churn_rate",
    operator: "<=",
    value: 0.04,
    unit: "%",
    label: "churn rate ceiling",
    sourceQuote: "keeping churn under 4%",
    confidence: 0.85,
    provenance: "explicit",
    ...overrides,
  };
}

describe("normaliseConstraintUnits", () => {
  it("relabels fractional percentage (0 < value < 1, unit='%') to unit='fraction'", () => {
    const input = [makeConstraint({ value: 0.04, unit: "%" })];
    const result = normaliseConstraintUnits(input);

    expect(result).toHaveLength(1);
    expect(result[0].unit).toBe("fraction");
    expect(result[0].value).toBe(0.04);
    expect((result[0] as any).provenance_unit_normalised).toBe("percent_to_fraction");
  });

  it("preserves non-percentage constraints unchanged", () => {
    const input = [makeConstraint({ value: 50000, unit: "£" })];
    const result = normaliseConstraintUnits(input);

    expect(result).toHaveLength(1);
    expect(result[0].unit).toBe("£");
    expect(result[0].value).toBe(50000);
    expect((result[0] as any).provenance_unit_normalised).toBeUndefined();
  });

  it("preserves percentage-unit constraints where value >= 1 (already in pp form)", () => {
    // value: 4, unit: "%" means "4 percentage points" — no double encoding
    const input = [makeConstraint({ value: 4, unit: "%" })];
    const result = normaliseConstraintUnits(input);

    expect(result).toHaveLength(1);
    expect(result[0].unit).toBe("%");
    expect(result[0].value).toBe(4);
    expect((result[0] as any).provenance_unit_normalised).toBeUndefined();
  });

  it("preserves percentage-unit constraints where value === 0", () => {
    const input = [makeConstraint({ value: 0, unit: "%" })];
    const result = normaliseConstraintUnits(input);

    expect(result).toHaveLength(1);
    expect(result[0].unit).toBe("%");
    expect(result[0].value).toBe(0);
  });

  it("handles mixed constraints (some normalised, some not)", () => {
    const input = [
      makeConstraint({ value: 0.04, unit: "%" }),   // fractional → normalised
      makeConstraint({ value: 50000, unit: "£" }),   // currency → untouched
      makeConstraint({ value: 0.95, unit: "%" }),    // fractional → normalised
      makeConstraint({ value: 12, unit: "months" }), // non-% → untouched
    ];
    const result = normaliseConstraintUnits(input);

    expect(result).toHaveLength(4);
    expect(result[0].unit).toBe("fraction");
    expect(result[1].unit).toBe("£");
    expect(result[2].unit).toBe("fraction");
    expect(result[3].unit).toBe("months");
  });

  it("returns empty array for empty input", () => {
    expect(normaliseConstraintUnits([])).toEqual([]);
  });

  it("provenance_unit_normalised passes through to toGoalConstraints output", async () => {
    const { toGoalConstraints } = await import("../../src/cee/compound-goal/index.js");
    const input = [makeConstraint({ value: 0.04, unit: "%" })];
    const normalised = normaliseConstraintUnits(input);
    const goalConstraints = toGoalConstraints(normalised);

    expect(goalConstraints).toHaveLength(1);
    expect((goalConstraints[0] as any).provenance_unit_normalised).toBe("percent_to_fraction");
    expect(goalConstraints[0].unit).toBe("fraction");
  });
});
