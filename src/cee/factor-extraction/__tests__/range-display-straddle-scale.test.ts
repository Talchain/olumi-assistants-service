/**
 * RANGE DISPLAY — the percent scale decision is made ONCE FOR THE PAIR, and a
 * pair that STRADDLES the scale boundary is declined rather than guessed.
 *
 * ── THE DEFECT ─────────────────────────────────────────────────────────────
 * `formatBound`'s percent branch sniffed the scale PER BOUND
 * (`n >= 0 && n <= 1 ? n * 100 : n`). Two bounds of ONE range, produced by ONE
 * producer on ONE scale, could therefore be rendered under TWO DIFFERENT
 * CONVENTIONS: a prior of `[0.56, 1.68]` rendered "56% to 1.68%" — the first
 * bound multiplied, the second not. `unreachable-factors.ts:549-552` records
 * exactly this, and calls it "replacing a silent omission with a confidently
 * wrong number".
 *
 * That output is wrong under EVERY reading of the field. Under the multiplier
 * convention the pair is 56%–168%; under percentage-points it is 0.56%–1.68%.
 * It is never "56% to 1.68%". A per-bound sniff cannot produce a coherent
 * answer because the two bounds share a scale by construction.
 *
 * ── WHY DECLINE RATHER THAN PICK ───────────────────────────────────────────
 * Which convention a straddling pair is on is NOT derivable here. The draft
 * prompt's SCALE_DISCIPLINE asks the model "can this metric meaningfully
 * exceed 100%?" and the answer survives only implicitly in how it scaled
 * `value`; the shared contract's own ruling (ROADMAP 2.193 / the #766 review)
 * is that no classifier can be built from the value alone. So this follows the
 * precedent THIS FUNCTION ALREADY SHIPS for the sibling case — row 2.1207's
 * currency branch, which declines inside the normalised domain rather than
 * guess. The caller omits `display_value` and the node reads "no value set
 * yet", which is the honest state.
 *
 * Two harms, and they are not symmetric: rendering it is a LIE about a number
 * the user never wrote; declining it is a DEGRADATION that the receipt already
 * discloses.
 *
 * ── MAGNITUDE, NOT SIGN ────────────────────────────────────────────────────
 * The schema admits a negative bound (`z.number()`, unbounded). A predicate
 * written as `<= 1` passes `-0.4` straight through — the sign asymmetry that
 * cost CEE #891 a 100,000x suppression, and which row 2.1207 already fixed on
 * the currency limb. The straddle test is on `|value|`.
 */

import { describe, expect, it } from "vitest";

import { synthesiseRangeDisplayValue } from "../display-value.js";

describe("A — THE OPPOSITE-DIRECTION TWINS: every currently-correct rendering is byte-identical", () => {
  it("normalised percent pair (both within the unit interval) still multiplies", () => {
    expect(synthesiseRangeDisplayValue({ range_min: 0.1, range_max: 0.25 }, "%")).toBe(
      "10% to 25%",
    );
  });

  it("percentage-point pair (both outside the unit interval) is still used as-is", () => {
    expect(synthesiseRangeDisplayValue({ range_min: 25, range_max: 75 }, "%")).toBe("25% to 75%");
  });

  it("currency pair is untouched by the percent limb", () => {
    expect(synthesiseRangeDisplayValue({ range_min: 200_000, range_max: 500_000 }, "£", "cost")).toBe(
      "£200k to £500k",
    );
  });

  it("time pair is untouched", () => {
    expect(synthesiseRangeDisplayValue({ range_min: 3, range_max: 8 }, "months")).toBe(
      "3 to 8 months",
    );
  });

  it("the full normalised domain is still declined (DGAI #342(2) — a domain is not an estimate)", () => {
    expect(synthesiseRangeDisplayValue({ range_min: 0, range_max: 1 })).toBeUndefined();
    expect(synthesiseRangeDisplayValue({ range_min: 0, range_max: 1 }, "%")).toBeUndefined();
    expect(synthesiseRangeDisplayValue({ range_min: 0, range_max: 100 }, "%")).toBeUndefined();
  });

  it("one-bound percent forms still render", () => {
    expect(synthesiseRangeDisplayValue({ range_min: 0.1 }, "%")).toBe("At least 10%");
  });
});

describe("B — THE DEFECT: a straddling percent pair is DECLINED, never rendered under two conventions", () => {
  it("the recorded case renders NOTHING rather than '56% to 1.68%'", () => {
    expect(synthesiseRangeDisplayValue({ range_min: 0.56, range_max: 1.68 }, "%")).toBeUndefined();
  });

  it("a straddling pair from an over-frame ratio factor is declined", () => {
    expect(synthesiseRangeDisplayValue({ range_min: 0.65, range_max: 1.95 }, "%")).toBeUndefined();
  });

  it("the straddle test is on MAGNITUDE, not sign — a negative sub-unit bound still straddles", () => {
    // |-0.4| <= 1 while |1.95| > 1: the pair spans the boundary and the scale
    // is no more knowable than in the positive case.
    expect(synthesiseRangeDisplayValue({ range_min: -0.4, range_max: 1.95 }, "%")).toBeUndefined();
  });

  it("exactly 1 counts as WITHIN the unit interval, so [1, 25] straddles", () => {
    // `1` is the boundary itself and is a legal multiplier (parity). Pairing it
    // with a percentage-point bound is precisely the ambiguity.
    expect(synthesiseRangeDisplayValue({ range_min: 1, range_max: 25 }, "%")).toBeUndefined();
  });
});

describe("C — the decline is SCOPED to the percent limb and to genuine straddles", () => {
  it("a straddling CURRENCY pair keeps its existing row-2.1207 behaviour, not the percent rule", () => {
    // Currency already has its own ratified answer: decline only when the WHOLE
    // pair is inside the normalised domain; a pair reaching outside it renders.
    expect(synthesiseRangeDisplayValue({ range_min: 0.5, range_max: 12 }, "£", "price")).toBe(
      "£0.5 to £12",
    );
  });

  it("a straddling pair on a UNITLESS range is unaffected — no percent convention applies", () => {
    expect(synthesiseRangeDisplayValue({ range_min: 0.5, range_max: 8 })).toBe("0.5 to 8");
  });

  it("a straddling TIME pair is unaffected — authored on the real scale", () => {
    expect(synthesiseRangeDisplayValue({ range_min: 0.5, range_max: 8 }, "months")).toBe(
      "0.5 to 8 months",
    );
  });
});
