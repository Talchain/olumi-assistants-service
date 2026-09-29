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

/**
 * D — A BOUND OF ZERO IS SCALE-INVARIANT AND MUST NOT VOTE ON THE SCALE.
 *
 * `0 * 100 === 0`. A zero bound renders identically under BOTH conventions, so
 * it carries no evidence about which one the pair is on. Counting it as
 * "within the unit interval" made every `[0, N>1]` percent range a FALSE
 * STRADDLE and silently dropped its `display_value` — `"0% to 25%"` is
 * unambiguous under either reading, and the pre-PR code rendered it correctly.
 *
 * ⭐ THE SHAPE OF THE MISS, because it is the reusable part: this PR traded one
 * harm for its opposite and its own suite applauded 13/13. A mis-scaled number
 * (a LIE) and a silently missing display (a GAP) are two different harms, and
 * they cannot share one window — every case the author added pointed at the
 * lie, so nothing could observe the gap. Same family as CEE #888/#891.
 *
 * Expected strings below are the BYTE-IDENTICAL output measured at the merge
 * base 7401725f, not values chosen here.
 */
describe("D — zero bounds are scale-invariant and do not create a straddle", () => {
  it("[0, 25] renders, exactly as the base did — the canonical false straddle", () => {
    expect(synthesiseRangeDisplayValue({ range_min: 0, range_max: 25 }, "%")).toBe("0% to 25%");
  });

  it("[0, 75] renders — a zero lower bound with a percentage-point upper", () => {
    expect(synthesiseRangeDisplayValue({ range_min: 0, range_max: 75 }, "%")).toBe("0% to 75%");
  });

  it("[25, 0] renders — the zero is the UPPER bound, so order is not the rule", () => {
    expect(synthesiseRangeDisplayValue({ range_min: 25, range_max: 0 }, "%")).toBe("25% to 0%");
  });

  it("[0, 0.25] still multiplies — a zero must not force the outside convention either", () => {
    expect(synthesiseRangeDisplayValue({ range_min: 0, range_max: 0.25 }, "%")).toBe("0% to 25%");
  });

  it("[0, 0] renders — both bounds zero leaves the magnitude set EMPTY (vacuous every())", () => {
    expect(synthesiseRangeDisplayValue({ range_min: 0, range_max: 0 }, "%")).toBe("0% to 0%");
  });

  /**
   * THE OPPOSITE-DIRECTION TWIN of this whole block. Skipping zero bounds must
   * not re-admit a GENUINE straddle — otherwise the gap fix reopens the lie,
   * which is precisely the oscillation this seam has already paid for.
   */
  it("a genuine straddle is STILL declined — the zero-skip did not reopen the lie", () => {
    expect(synthesiseRangeDisplayValue({ range_min: 0.56, range_max: 1.68 }, "%")).toBeUndefined();
    expect(synthesiseRangeDisplayValue({ range_min: 1, range_max: 25 }, "%")).toBeUndefined();
    expect(synthesiseRangeDisplayValue({ range_min: -0.4, range_max: 1.95 }, "%")).toBeUndefined();
  });

  it("the full normalised domain is STILL declined — a domain is not an estimate", () => {
    // [0, 1] and [0, 100] both carry a zero bound, so this pins that the
    // zero-skip did not leak them past the earlier domain rule.
    expect(synthesiseRangeDisplayValue({ range_min: 0, range_max: 1 }, "%")).toBeUndefined();
    expect(synthesiseRangeDisplayValue({ range_min: 0, range_max: 100 }, "%")).toBeUndefined();
  });
});

/**
 * E — THE NEGATIVE LIMB, WHERE IT RENDERS.
 *
 * ⛔ The corpus's only negative case (`[-0.4, 1.95]`) DECLINES, so before this
 * block the negative limb was never tested anywhere it produces a string. Two
 * negative behaviours changed in this PR and were pinned by NOTHING:
 *
 *   [-0.5, -0.2]  base "-0.5% to -0.2%"  ->  head "-50% to -20%"   (100x)
 *   [-1,  -25]    base "-1% to -25%"     ->  head  undefined       (declines)
 *
 * Both are measured, not asserted from reading. The 100x move is the CORRECT
 * direction — `Math.abs` puts both bounds inside the unit interval, so the pair
 * is normalised and multiplies — but a 100x change in a user-visible string
 * with no test is exactly how this repo previously shipped a sign-asymmetric
 * classifier that suppressed a cost factor by 100,000x while self-reporting
 * all-green (CEE #891). Negatives are not an edge case on this seam.
 */
describe("E — negatives, pinned where they RENDER and not only where they decline", () => {
  it("[-0.5, -0.2] multiplies: both magnitudes are sub-unit, so the pair is normalised", () => {
    // 100x change from the base's "-0.5% to -0.2%", which came from the
    // per-bound sniff `n >= 0 && n <= 1` failing on the SIGN and passing the
    // value through unscaled. The new value is right; it is pinned so it can
    // never move again unobserved.
    expect(synthesiseRangeDisplayValue({ range_min: -0.5, range_max: -0.2 }, "%")).toBe(
      "-50% to -20%",
    );
  });

  it("[-25, -5] is used as-is: both magnitudes are outside the unit interval", () => {
    expect(synthesiseRangeDisplayValue({ range_min: -25, range_max: -5 }, "%")).toBe(
      "-25% to -5%",
    );
  });

  it("[-1, -25] STRADDLES by magnitude and is declined — the |1| boundary holds for negatives", () => {
    // |-1| = 1 counts as within, |-25| = 25 is outside. Base rendered
    // "-1% to -25%", a range whose lower bound reads further from zero than its
    // upper. Declining it is the same judgement as the positive [1, 25] twin.
    expect(synthesiseRangeDisplayValue({ range_min: -1, range_max: -25 }, "%")).toBeUndefined();
  });

  it("a negative bound paired with a ZERO still renders — sign and zero-skip compose", () => {
    // The intersection of blocks D and E: a zero contributes no magnitude, so
    // the surviving negative bound alone decides the scale.
    expect(synthesiseRangeDisplayValue({ range_min: -0.2, range_max: 0 }, "%")).toBe("-20% to 0%");
    expect(synthesiseRangeDisplayValue({ range_min: -25, range_max: 0 }, "%")).toBe("-25% to 0%");
  });

  it("one-bound negative percent forms still render", () => {
    expect(synthesiseRangeDisplayValue({ range_min: -0.1 }, "%")).toBe("At least -10%");
  });
});
