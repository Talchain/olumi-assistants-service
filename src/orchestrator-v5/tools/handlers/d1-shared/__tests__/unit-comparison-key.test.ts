import { describe, it, expect } from "vitest";
import {
  canonicaliseUnitForDisplay,
  unitComparisonKey,
  evaluateFactorValueProposal,
} from "../evaluate-factor-value-proposal.js";

/**
 * TWO QUESTIONS THAT WERE SHARING ONE NAME (`canonicaliseUnit`).
 *
 *   `canonicaliseUnitForDisplay` — "is this a unit DECLARATION at all, and what
 *       exact string do we PERSIST and SHOW?"  Trims. **Keeps case**, because its
 *       output is written to observed_state and interpolated into user-facing copy.
 *   `unitComparisonKey`          — "are these two spellings the SAME UNIT?"
 *       Trims AND case-folds. Never persisted, never displayed.
 *
 * THE LIVE DEFECT THIS CLOSES (measured at 3ab35d34, before this change):
 * a proposal in `'Months'` against a factor stored as `'months'` was refused with
 *     "This factor uses months; the value provided is in Months."
 * — a refusal naming two strings a user reads as IDENTICAL. PLoT's
 * `classifyUnitCompatibility` reconciles the same pair, so the two services also
 * disagreed on the same input.
 *
 * ⚠ EVERY CASE BELOW CARRIES ITS OPPOSITE-DIRECTION TWIN. The two harms here are
 * (a) REFUSING a real edit over a spelling, and (b) ACCEPTING a genuine unit
 * change because the comparison was loosened. They cannot share one window, so
 * each widening case is paired with a case that must still refuse.
 */

const base = { rawInput: 5, inputHasUnit: true, factorExistingRaw: 3 } as const;

describe("unit comparison key vs display form — two questions, two functions", () => {
  it("POSITIVE CONTROL: the evaluator can still emit unit_mismatch at all", () => {
    // An "it now accepts" assertion is vacuous unless the instrument is shown
    // capable of producing the refusal it claims disappeared.
    const r = evaluateFactorValueProposal({ ...base, unit: "£", factorUnit: "%" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unit_mismatch");
  });

  it("unitComparisonKey folds case so spellings of ONE unit agree", () => {
    expect(unitComparisonKey("Months")).toBe(unitComparisonKey("months"));
    expect(unitComparisonKey("  MONTHS ")).toBe(unitComparisonKey("months"));
    expect(unitComparisonKey("GBP")).toBe(unitComparisonKey("gbp"));
  });

  it("OPPOSITE-DIRECTION TWIN: the DISPLAY form keeps the user's own case", () => {
    // This is the twin that stops the defect being "fixed" by lower-casing the
    // user's string — which would rewrite what we persist and show.
    expect(canonicaliseUnitForDisplay("Months")).toBe("Months");
    expect(canonicaliseUnitForDisplay("GBP")).toBe("GBP");
    expect(canonicaliseUnitForDisplay("  £m  ")).toBe("£m");
    // and it still collapses "no unit" to exactly one representation
    expect(canonicaliseUnitForDisplay("")).toBeUndefined();
    expect(canonicaliseUnitForDisplay("   ")).toBeUndefined();
    expect(canonicaliseUnitForDisplay(undefined)).toBeUndefined();
  });

  it("the two functions DISCRIMINATE (they are not the same function twice)", () => {
    // If a later refactor collapsed these back into one, this REDs.
    expect(canonicaliseUnitForDisplay("Months")).not.toBe(unitComparisonKey("Months"));
  });

  it("accepts a case-variant spelling of the SAME unit", () => {
    expect(evaluateFactorValueProposal({ ...base, unit: "Months", factorUnit: "months" }).ok).toBe(true);
    expect(evaluateFactorValueProposal({ ...base, unit: "months", factorUnit: "Months" }).ok).toBe(true);
    expect(evaluateFactorValueProposal({ ...base, unit: "GBP", factorUnit: "gbp" }).ok).toBe(true);
  });

  it("OPPOSITE-DIRECTION TWIN: genuinely different units are STILL refused", () => {
    for (const [unit, factorUnit] of [["£", "%"], ["%", "£"], ["$", "£"]] as const) {
      const r = evaluateFactorValueProposal({ ...base, unit, factorUnit });
      expect(r.ok, `${unit} vs ${factorUnit} must still refuse`).toBe(false);
      if (!r.ok) expect(r.reason).toBe("unit_mismatch");
    }
  });

  it("OPPOSITE-DIRECTION TWIN: same DIMENSION, different MAGNITUDE still refused", () => {
    // Case-folding must not bless a real rescale. 'months' vs 'weeks' is a
    // 4.33x conversion, not a spelling difference — PLoT's constraint-units
    // module refuses this pair for the same reason.
    for (const [unit, factorUnit] of [["Months", "weeks"], ["months", "Weeks"], ["Years", "months"]] as const) {
      const r = evaluateFactorValueProposal({ ...base, unit, factorUnit });
      expect(r.ok, `${unit} vs ${factorUnit} must still refuse`).toBe(false);
      if (!r.ok) expect(r.reason).toBe("unit_mismatch");
    }
  });

  it("the refusal COPY still shows both units in the user's own spelling", () => {
    const r = evaluateFactorValueProposal({ ...base, unit: "GBP", factorUnit: "%" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      // display forms, not comparison keys — the user must see what they typed
      expect(r.specific_issue).toContain("GBP");
      expect(r.specific_issue).not.toContain("gbp");
    }
  });
});
