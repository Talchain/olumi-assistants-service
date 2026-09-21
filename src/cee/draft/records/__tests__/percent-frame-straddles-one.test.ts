/**
 * ⛔⛔⛔ READ THIS FIRST: THIS FILE MUST NOT BE "UPDATED TO MATCH" A CHANGE.
 * It pins a KNOWN GAP. A RED here means a frame decision has been taken, and
 * that decision has to be taken deliberately, with a frame table and its own
 * independent seat — not absorbed by re-pointing these numbers. Hoisted to the
 * top on an independent reviewer's note, because it is the one line a future
 * lane most needs before it starts editing.
 *
 * ⛔⛔ ONE FRAME PER FACTOR, OVER A SET THAT MIXES THE TWO PERCENT CONVENTIONS.
 *
 * MEASURED ON A LIVE DRAFT, 2026-09-17, `draft_graph@v202`
 * (`7aa241f467fe2199…`), banked at
 * `output/olumi-evidence-20260917-inert-quantities/prompt-v202/` as
 * `live-witness-v202-draw2-pricing-2026-09-17.json` +
 * `TWO-DRAW-COMPARISON.md`. Brief: *"churn is currently 4% a month"*.
 *
 *     factor ab78e513 "Monthly Churn Rate"   scale_frame = 100
 *       baseline      observed_state.raw_value = 0.04   -> value 0.0004
 *       intervention  interventions.ab78e513   = 5.5    -> value 0.055
 *
 * Both numbers mean what the seam's own doctrine says they mean
 * (`unit-scale-class.ts:148`, which is the authority here and is quoted rather
 * than paraphrased): *"The producer's convention is MAGNITUDE-DEPENDENT. CEE's
 * extractor emits '4%' as `{ value: 0.04, unit: '%' }` — a FRACTION under a '%'
 * label — while a '%' value `>= 1` IS percentage points."* So `0.04` is 4% and
 * `5.5` is 5.5% — a real-world move of x1.375.
 *
 * ⚠ THE GUARD IS CORRECT AND IS ASKED THE WRONG QUESTION.
 * `unitPinnedScaleFrame` reads the magnitude — `if (!(magnitude > 1)) return
 * undefined;` — and would decline to pin 100 for `0.04` CONSIDERED ALONE. But
 * `deriveFactorScaleFrame` derives ONE frame per factor and consults that guard
 * with `Math.max(...magnitudes)` ONLY:
 *
 *     const max = Math.max(...magnitudes);
 *     if (max <= 1) return undefined;
 *     const pinned = unitPinnedScaleFrame(unit, max);   // <- the MAX, only
 *
 * so a sub-1 member silently inherits the frame earned by a >1 member. The
 * guard cannot see a straddle because it is never shown one. CLAUDE.md trap 13d
 * — check what the corpus EXCLUDES: the existing percent corpus is
 * `[0.2, 0.9]` (all sub-1) and `[20, 40, 60]` (all above), i.e. every case is
 * single-convention and NO STRADDLING SET EXISTS ANYWHERE IN THE SUITE.
 *
 * ⚠ THE EXTENSIVE PRIOR ANALYSIS OF THIS SEAM DOES NOT REACH THIS CASE.
 * `orchestrator/canonicalise-value-ops.ts:960-1035` works the UPPER boundary
 * (NRR 115%, ROI 300%) and records its corpus as *"50 percent-unit nodes, zero
 * above 100, observed top of range 98"*. This is the LOWER boundary and needs a
 * MIXED set, so neither that analysis nor that corpus reaches it. ⛔ And the
 * "principled fix" rowed there — *"make `deriveFactorScaleFrame` return 100 for
 * percent units ALWAYS"* — would make THIS case WORSE: it pins 100 for `0.04`
 * unconditionally and hard-codes the 100x understatement.
 *
 * ⭐⭐ WHAT THIS FILE IS, AND IS NOT.
 * It is a KNOWN-GAP PIN in the sense of CLAUDE.md trap 22f: it asserts EXACTLY
 * the current behaviour on EXACTLY the measured set, so the suite stays green
 * for the right reason and REDS the moment anything moves — in either
 * direction. It is NOT an endorsement of that behaviour, and it must NOT be
 * "updated to match" by a later change: a RED here means a frame decision has
 * been taken, and it has to be taken deliberately with a frame table.
 *
 * ⛔ DO NOT FIX THIS BY ADDING A BARE `unit === '%'` BRANCH. That door is rowed
 * shut with its reasons at `unit-scale-class.ts:148`. The two candidate fixes
 * (normalise the convention at the extractor, or refuse to pin one frame over a
 * straddling set) are both product decisions on a predicate with a burn
 * history, and per traps 22c/22d they need a corpus from outside the author's
 * head and an independent seat WHATEVER the diff size.
 */
import { describe, expect, it } from "vitest";

import { deriveFactorScaleFrame } from "../projector.js";

/** The live draw's two magnitudes for factor `ab78e513`, verbatim. */
const CHURN_BASELINE_RAW = 0.04; // the brief's "4% a month", fraction convention
const CHURN_INTERVENTION_RAW = 5.5; // 5.5%, percentage-point convention
/** What those two numbers mean in the world, per the quoted convention. */
const CHURN_BASELINE_PERCENT = 4;
const CHURN_INTERVENTION_PERCENT = 5.5;

describe("percent frame over a set that straddles 1 (KNOWN GAP, measured live)", () => {
  it("pins 100 from the max alone, so the sub-1 member is understated 100x", () => {
    const frame = deriveFactorScaleFrame([CHURN_BASELINE_RAW, CHURN_INTERVENTION_RAW], "%");

    // Pinned from `max = 5.5`, which IS above 1 and IS percent-classed.
    expect(frame).toBe(100);

    const baselineLevel = CHURN_BASELINE_RAW / (frame as number);
    const interventionLevel = CHURN_INTERVENTION_RAW / (frame as number);

    // Exactly the levels the live payload carries.
    expect(baselineLevel).toBeCloseTo(0.0004, 12);
    expect(interventionLevel).toBeCloseTo(0.055, 12);

    // ⭐ THE DEFECT, STATED WITHOUT PREJUDGING THE FIX. Baseline and
    // intervention are levels on ONE axis by construction, so their ratio must
    // be the real-world ratio. It is 100x it. Any correct fix drives this to 1
    // and REDS this assertion — which is the point of the file.
    const trueRatio = CHURN_INTERVENTION_PERCENT / CHURN_BASELINE_PERCENT; // 1.375
    const levelRatio = interventionLevel / baselineLevel; // 137.5
    expect(levelRatio / trueRatio).toBeCloseTo(100, 6);
  });

  it("CONTRAST CONTROL: a single-convention percent set carries the true ratio", () => {
    // Same factor shape, same unit, no straddle — this is what correct looks
    // like, and it proves the assertion above discriminates rather than always
    // reading 100.
    const frame = deriveFactorScaleFrame([4, 5.5], "%");
    expect(frame).toBe(100);

    const baselineLevel = 4 / (frame as number);
    const interventionLevel = 5.5 / (frame as number);
    const trueRatio = CHURN_INTERVENTION_PERCENT / CHURN_BASELINE_PERCENT;
    const levelRatio = interventionLevel / baselineLevel;
    expect(levelRatio / trueRatio).toBeCloseTo(1, 12);
  });

  it("CONTRAST CONTROL: the non-percent factor in the same live draw is unaffected", () => {
    // `Pro Plan Monthly Price`, raws {49, 54, 59}, frame 100, level 0.49 —
    // one convention throughout, and the 100x does not appear.
    //
    // ⚠ TWO DIFFERENT LIMBS, AND THE EARLIER WORDING HERE READ AS A
    // CONTRADICTION (independent reviewer's note): it said "a currency unit pins
    // no frame" and then asserted 100. Both are true and they are about
    // different limbs. `classifyUnitScaleClass("£")` is `unknown`, so
    // `unitPinnedScaleFrame` returns undefined — NO PINNED frame. The 100 comes
    // from the fall-through, `nextNiceNumberAbove(59)`, i.e. the LADDER. That is
    // exactly the contrast that matters: the defect is specific to the PINNED
    // percent limb, and the laddered answer is unaffected by it.
    expect(deriveFactorScaleFrame([49, 54, 59], "£")).toBe(100);
    const levelRatio = 59 / 100 / (49 / 100);
    expect(levelRatio).toBeCloseTo(59 / 49, 12);
  });

  it("pins the corpus gap itself: every existing percent case is single-convention", () => {
    // The two sets the suite already carries. Neither straddles 1, which is
    // precisely why the defect above was invisible. If a straddling case is
    // ever added elsewhere, these stay true and this file stays the authority
    // on what a straddle does.
    expect(deriveFactorScaleFrame([0.2, 0.9], "%")).toBeUndefined(); // all sub-1: no frame
    expect(deriveFactorScaleFrame([20, 40, 60], "%")).toBe(100); // all above: frame 100

    // And the boundary itself, stated because `unitPinnedScaleFrame` is
    // `> 1` STRICTLY and the projector writes no frame at exactly 1.
    expect(deriveFactorScaleFrame([1], "%")).toBeUndefined();
    expect(deriveFactorScaleFrame([0.04, 1], "%")).toBeUndefined();
  });
});
