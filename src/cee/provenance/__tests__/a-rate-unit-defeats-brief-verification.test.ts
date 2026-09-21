/**
 * ⛔⛔ KNOWN-WRONG, PINNED: A COMPOUND-RATE UNIT DEFEATS BRIEF VERIFICATION.
 *
 * THIS FILE ASSERTS TODAY'S BEHAVIOUR, NOT THE DESIRED BEHAVIOUR. Every
 * expectation below that reads `false` is a DEFECT held in place so it cannot
 * change unnoticed. On the day it is fixed, this file REDs — and that RED is
 * the instruction to invert the expectations, not to weaken them.
 *
 * ── WHAT IT COSTS, MEASURED ON A REAL USER DRAW ──────────────────────────────
 * Staging bundle `9077a1e3` (21 Sep 2026). The user's brief:
 *
 *   "...increase the Pro plan price from £49 to £59 per month, while keeping
 *    monthly churn under 4%."
 *
 * His own option reached the wire carrying
 *   `{ value: 0.59, raw_value: 59, unit: "£/month", source: "cee_hypothesis",
 *      value_confidence: "low",
 *      reasoning: "...no stated figure is cited for this option→factor effect" }`
 *
 * — i.e. the product told him the number HE TYPED was Olumi's estimate. That is
 * the visible half of `in_model_anchored: 0 of 5` and of the sentence "every
 * estimate this comparison rests on is Olumi's, not yours."
 *
 * ── WHY, AND WHY IT IS NOT A PRICING-WORDING ARTEFACT ────────────────────────
 * `isAmountStatedInBrief` is the single authority behind
 * `bindStatedItemToBrief`, which decides `brief_extraction` vs `cee_hypothesis`.
 * It verifies the SYMBOL form (`£59`) and the CODE form (`GBP`), but a
 * COMPOUND RATE unit — `£/month`, `£/mo`, and by construction `£/year`,
 * `$/user`, `£/seat` — is not a currency token it recognises, so it declines.
 *
 * A compound rate is not an edge case. It is the ordinary unit of every
 * subscription price, salary, run-rate, burn rate and unit-economics figure —
 * i.e. of most numbers an enterprise brief contains. The drafter is doing the
 * RIGHT thing by labelling a monthly price `£/month`; the predicate then
 * punishes it for being precise.
 *
 * ⚠ AND IT INVERTS ON THE PRESENCE OF A UNIT, which is the part most likely to
 * mislead the next reader: for `GBP 55,000` the amount verifies when NO unit is
 * supplied and FAILS when the correct one is. So "supply the unit" is not a
 * workaround; supplying a unit can move the answer in either direction.
 *
 * ⛔ DO NOT FIX THIS BY STRIPPING THE UNIT AT THE CALL SITE. That makes today's
 * graph look right and silently widens what counts as "the user stated this" for
 * every caller — `brief-binding.ts` deliberately scopes the magnitude test to
 * the QUOTE for exactly this reason (its B1 fix). The unit is evidence; the
 * defect is that the predicate cannot read a rate.
 */
import { describe, expect, it } from "vitest";

import { bindStatedItemToBrief } from "../brief-binding.js";
import { isAmountStatedInBrief } from "../stated-amounts.js";

/** The user's own words, from staging bundle `9077a1e3`. */
const BRIEF =
  "We're considering whether to increase the Pro plan price from £49 to £59 per month, while keeping monthly churn under 4%.";
const QUOTE = "increase the Pro plan price from £49 to £59 per month";

describe("a compound-rate unit defeats brief verification (KNOWN-WRONG, pinned)", () => {
  it("POSITIVE CONTROL — the predicate does see the user's number, so the probe is not blind", () => {
    // Without this the file below would be indistinguishable from a predicate
    // that returns false for everything.
    expect(isAmountStatedInBrief(59, "£", BRIEF), "£59 is verbatim in the brief").toBe(true);
    expect(isAmountStatedInBrief(49, "£", BRIEF), "so is £49").toBe(true);
    expect(isAmountStatedInBrief(4, "%", BRIEF), "and the 4% ceiling").toBe(true);
  });

  it("⛔ THE DEFECT — the same number, with the unit the drafter actually emits, is refused", () => {
    // `unit: "£/month"` is what reached the wire on the real draw.
    expect(isAmountStatedInBrief(59, "£/month", BRIEF)).toBe(false);
    expect(isAmountStatedInBrief(59, "£/mo", BRIEF)).toBe(false);

    // DISCRIMINATING PAIR: identical value, identical text, ONLY the unit
    // differs — so nothing but the unit can explain the flip.
    expect(isAmountStatedInBrief(59, "£", BRIEF)).toBe(true);
  });

  it("⛔ THE CONSEQUENCE — the stated-item verdict the product badges on says `unverified`", () => {
    // This is the exact call the projector makes, and the reason £59 is badged
    // as Olumi's. `bindingEarnsBriefClaim` admits only "verified".
    expect(bindStatedItemToBrief({ quote: QUOTE, value: 59, unit: "£/month", brief: BRIEF })).toBe(
      "unverified",
    );
    // Same quote, same brief, same number — the unit alone decides authorship.
    expect(bindStatedItemToBrief({ quote: QUOTE, value: 59, unit: "£", brief: BRIEF })).toBe(
      "verified",
    );
  });

  it("⛔ IT INVERTS — for a code-form amount, supplying the correct unit makes it WORSE", () => {
    const CODE = "The Berlin option costs GBP 55,000 in year one.";
    expect(isAmountStatedInBrief(55_000, undefined, CODE), "no unit: verifies").toBe(true);
    expect(isAmountStatedInBrief(55_000, "GBP", CODE), "correct unit: refused").toBe(false);
    expect(isAmountStatedInBrief(55_000, "£", CODE), "symbol for the same currency: refused").toBe(
      false,
    );
  });

  it("⛔ AND A BARE NUMBER WITH NO UNIT IS REFUSED where the symbol form succeeds", () => {
    // Recorded because it rules OUT "just omit the unit everywhere" as a remedy:
    // the answer moves in both directions depending on how the brief is written.
    expect(isAmountStatedInBrief(59, undefined, BRIEF)).toBe(false);
    expect(isAmountStatedInBrief(59, "", BRIEF)).toBe(false);
  });
});
