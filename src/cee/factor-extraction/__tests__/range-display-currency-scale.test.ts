/**
 * ⭐⭐ ROW 2.1207 — A NORMALISED 0–1 PRIOR BOUND MAY NOT WEAR A CURRENCY SIGN.
 *
 * ── THE DEFECT, AT THE BANKED BYTES ────────────────────────────────────────
 * `closing-witness-20260814/driver/captures-run/captures/P3/committed-graph.json`,
 * node `19d5a529`, against a brief stating **£120,000**:
 *
 *   { "label": "Annual Support Cost", "category": "external",
 *     "prior": { "distribution": "uniform", "range_min": 0.21, "range_max": 0.63 },
 *     "factor_type": "price",
 *     "uncertainty_drivers": ["Extracted from brief — confirm value"],
 *     "display_value": "£0.2 to £0.6" }
 *
 * A normalised 0–1 value wearing a pound sign, six orders of magnitude out, on a
 * node that also claims the number came from the brief.
 *
 * ── THE EXPECTATION COMES FROM THE PRODUCER, NOT FROM MY READING (trap 13c) ─
 * `synthesiseRangeDisplayValue`'s own `%` branch declares the scale:
 *
 *   // range_min/range_max are normalised (0–1) values; multiply by 100 for display.
 *
 * So the module already knows prior bounds are normalised — and compensates on
 * the percent branch while doing nothing on the currency branch. One function,
 * two scaled units, one of them scaled. The sibling guard above it asserts the
 * opposite as fact — *"Real-world units (currency, time, counts) are untouched —
 * a 0..1 range there is a genuine quantity"* — and the capture refutes exactly
 * that sentence.
 *
 * ── THE INVARIANT IS WRITTEN AGAINST THE SPEC, NOT THE FAILURE (trap 13d) ───
 * NOT "0.21 must not render as £0.2". The spec claim is:
 *
 *   **a currency-prefixed display string asserts a currency-scaled quantity, so
 *   bounds inside the normalised domain [0,1] with no raw-scale evidence may not
 *   carry a currency prefix.**
 *
 * Written that way it covers the sign-symmetric and one-sided forms the
 * witnessed case never showed, which is the class the corpus would otherwise
 * exclude.
 *
 * ── THE TWO OPPOSITE HARMS, NAMED AND BOTH TESTED (trap 22b) ───────────────
 *  - suppressing too little → a LIE about a number the user never wrote;
 *  - suppressing too much   → a genuine currency range loses its display, a
 *    DEGRADATION.
 * Every case below has its opposite-direction twin: real currency magnitudes,
 * real time units and real counts must be untouched.
 */
import { describe, expect, it } from "vitest";

import { synthesiseRangeDisplayValue } from "../display-value.js";

describe("row 2.1207 — currency display requires a currency-scaled bound", () => {
  // ⭐ THE WITNESSED CASE, transcribed from the capture.
  it("the banked P3 prior (0.21–0.63, £) does not render as currency", () => {
    const out = synthesiseRangeDisplayValue(
      { distribution: "uniform", range_min: 0.21, range_max: 0.63 },
      "£",
      "price",
    );
    expect(out ?? "").not.toMatch(/[£$€¥₹]/);
  });

  // The honest state is the one this function already ships for the sibling
  // case (DGAI #342(2)): omit the value rather than render internals.
  it("…and omits the value entirely rather than printing a meaningless number", () => {
    expect(
      synthesiseRangeDisplayValue(
        { distribution: "uniform", range_min: 0.21, range_max: 0.63 },
        "£",
        "price",
      ),
    ).toBeUndefined();
  });

  // ── CLASS COVERAGE. None of these appeared in the witnessed draw; all are
  // admitted by the same input space, and a corpus that omits them cannot
  // certify the code over them (trap 13d(c)).
  it.each([
    ["GBP", { range_min: 0.2, range_max: 0.6 }],
    ["$", { range_min: 0.05, range_max: 0.95 }],
    ["USD", { range_min: 0.5, range_max: 0.5 }],
    ["€", { range_min: 0.1, range_max: 0.9 }],
    ["EUR", { range_min: 0, range_max: 0.4 }],
    ["¥", { range_min: 0.33, range_max: 0.67 }],
    ["₹", { range_min: 0.01, range_max: 0.99 }],
  ])("normalised bounds under unit %s never render a currency sign", (unit, prior) => {
    const out = synthesiseRangeDisplayValue(prior, unit, "price");
    if (out !== undefined) expect(out).not.toMatch(/[£$€¥₹]/);
  });

  it.each([
    ["one-sided max", { range_max: 0.63 }],
    ["one-sided min", { range_min: 0.21 }],
  ])("the %s form is covered too — no currency sign on a normalised bound", (_name, prior) => {
    const out = synthesiseRangeDisplayValue(prior, "£", "price");
    if (out !== undefined) expect(out).not.toMatch(/[£$€¥₹]/);
  });

  // A negative bound is admitted by the schema (`range_min: z.number()`), and a
  // predicate written only for the `> 1` direction would let it through — the
  // sign-asymmetry that cost CEE #891 a 100,000x suppression.
  it("a negative bound inside the normalised magnitude domain is not currency-rendered", () => {
    const out = synthesiseRangeDisplayValue({ range_min: -0.4, range_max: 0.4 }, "£", "cost");
    if (out !== undefined) expect(out).not.toMatch(/[£$€¥₹]/);
  });
});

describe("row 2.1207 — OPPOSITE-DIRECTION TWINS: genuine quantities are untouched", () => {
  // If any of these RED, the fix over-suppressed and traded a lie for a
  // degradation.
  it("a real currency range still renders with its prefix", () => {
    const out = synthesiseRangeDisplayValue({ range_min: 200000, range_max: 500000 }, "£", "cost");
    expect(out).toBe("£200k to £500k");
  });

  it("a real one-sided currency bound still renders with its prefix", () => {
    expect(synthesiseRangeDisplayValue({ range_max: 500000 }, "£", "cost")).toBe("Up to £500k");
    expect(synthesiseRangeDisplayValue({ range_min: 200000 }, "£", "cost")).toBe(
      "At least £200k",
    );
  });

  it("a currency range straddling the domain edge is a genuine quantity and renders", () => {
    const out = synthesiseRangeDisplayValue({ range_min: 0.5, range_max: 12 }, "£", "price");
    expect(out).toMatch(/£/);
  });

  /**
   * ⭐⭐ THIS CASE EXISTS BECAUSE A MUTANT SURVIVED, AND THE SURVIVOR WAS THE
   * FINDING.
   *
   * The kit mutated the predicate from `Math.abs(x) <= 1` to `x <= 1` — the
   * sign-asymmetric form — and **all 48 tests stayed green**. The corpus's only
   * negative case was `{-0.4, 0.4}`, which BOTH predicates classify as
   * normalised, so it could not tell them apart: it proved the guard bites the
   * original defect and said nothing about its shape.
   *
   * The two forms diverge on a LARGE negative bound — an ordinary deficit range
   * a brief can state ("we are running a -£500k deficit"), which the schema
   * admits (`z.number()`, unbounded). `Math.abs` reads it as the genuine
   * currency quantity it is and renders; the asymmetric form reads `-500000 <= 1`
   * as "normalised" and silently suppresses a real value.
   *
   * A survivor is a claim in either direction and has to be DEMONSTRATED, never
   * asserted (trap 13c). This is the demonstration, and it is a class the
   * witnessed capture never contained (trap 13d(c) — check what the corpus
   * EXCLUDES).
   */
  it("DISCRIMINATOR — a large NEGATIVE currency bound is a genuine quantity and renders", () => {
    const out = synthesiseRangeDisplayValue({ range_min: -500000, range_max: 0.5 }, "£", "cost");
    expect(out).toMatch(/£/);
  });

  it("percentages are untouched — the branch that already scaled correctly", () => {
    expect(synthesiseRangeDisplayValue({ range_min: 0.1, range_max: 0.25 }, "%")).toBe(
      "10% to 25%",
    );
  });

  it("time units are untouched", () => {
    expect(synthesiseRangeDisplayValue({ range_min: 3, range_max: 8 }, "months")).toBe(
      "3 to 8 months",
    );
  });

  it("the full-domain guard still omits a defaulted unitless prior", () => {
    expect(synthesiseRangeDisplayValue({ range_min: 0, range_max: 1 })).toBeUndefined();
  });

  it("a unitless non-domain range still renders", () => {
    expect(synthesiseRangeDisplayValue({ range_min: 3, range_max: 8 })).toBe("3 to 8");
  });

  it("no bounds at all still falls back to the distribution string", () => {
    expect(synthesiseRangeDisplayValue({ distribution: "uniform" }, "£")).toBe(
      "Estimated (uncertain)",
    );
  });
});
