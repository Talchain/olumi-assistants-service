/**
 * PAIR COHERENCE — a stored `scale_frame` is validated against the factor's own
 * `{value, raw_value}` pair before it is trusted.
 *
 * ── WHY THIS SPEC EXISTS (the premise it was written to refute) ─────────────
 * The domain brief that commissioned this work asserted the invariant
 * `0 <= value <= 1`. That is REFUTED at the bytes by this module's own
 * siblings: `normalise-factor-value.ts` writes an honest level > 1 for an
 * over-frame edit ("the truth about the frame"), and `scale-frame.ts` records
 * that an EARLIER `value <= 1` precondition WAS the defect — it refused the
 * very pair the writer had just written. So this spec pins the OPPOSITE:
 * a level above 1 must keep passing.
 *
 * What IS wrong under every reading is a pair that does not cohere with the
 * frame stored beside it. `resolveScaleFrame` previously trusted a stored
 * frame WITHOUT ever comparing it to the pair — its header assumed the two
 * "agree by construction", an assumption pinned only at the projector, for
 * freshly-drafted fixtures (`cee/draft/records/__tests__/scale-frame-carriage
 * .test.ts`). Nothing checked a graph that had been through edits.
 *
 * ⚠ THE TWO CARRIERS ANSWER DIFFERENT QUESTIONS AND ARE NOT TWINS TO MERGE.
 * `scale_frame` answers "what is the DIVISOR?" (a number, CEE-local).
 * `observed_state.declared_scale` answers "what CLASS of scale is this?"
 * (`unit_interval | ratio | raw_count`, shared contract). Two names for two
 * questions is CORRECT; collapsing them would be the twins defect.
 */

import { describe, expect, it } from "vitest";

import {
  PAIR_COHERENCE_RELATIVE_EPSILON,
  checkPairCoherence,
  recoverScaleFrame,
  resolveScaleFrame,
} from "../scale-frame.js";

// The two records quoted in the domain brief, reproduced exactly.
const BRIEF_ORDINARY = { storedFrame: 100_000, value: 0.74, raw_value: 74_000 };
const BRIEF_OVER_FRAME = { storedFrame: 50_000, value: 1.3, raw_value: 65_000 };

describe("A — the OPPOSITE-DIRECTION TWIN: a level above 1 is honest and must still pass", () => {
  it("the brief's `value: 1.3` record COHERES (65000 / 50000 === 1.3)", () => {
    expect(checkPairCoherence(BRIEF_OVER_FRAME)).toBe("coheres");
  });

  it("`resolveScaleFrame` still returns the stored frame for the `1.3` record", () => {
    expect(resolveScaleFrame(BRIEF_OVER_FRAME)).toBe(50_000);
  });

  it("the brief's ordinary `value: 0.74` record coheres and resolves unchanged", () => {
    expect(checkPairCoherence(BRIEF_ORDINARY)).toBe("coheres");
    expect(resolveScaleFrame(BRIEF_ORDINARY)).toBe(100_000);
  });

  it("an extreme honest over-frame level (5x the frame) coheres — no upper bound anywhere", () => {
    expect(checkPairCoherence({ storedFrame: 100_000, value: 5, raw_value: 500_000 })).toBe(
      "coheres",
    );
    expect(resolveScaleFrame({ storedFrame: 100_000, value: 5, raw_value: 500_000 })).toBe(100_000);
  });
});

describe("B — the corruption class: a stored frame the pair contradicts", () => {
  it("a raw magnitude written into `value` beside a stored frame is INCOHERENT", () => {
    // The documented raw-write fallback landing on a factor that still carries
    // the draft's frame: value === raw_value, but frame says value should be 1.3.
    expect(checkPairCoherence({ storedFrame: 50_000, value: 65_000, raw_value: 65_000 })).toBe(
      "incoherent",
    );
  });

  it("`resolveScaleFrame` REFUSES a contradicted stored frame (returns undefined)", () => {
    // Deliberately NOT the pair-recovered frame: re-deriving a frame from the
    // baseline alone ignores the sibling interventions it was derived WITH
    // (measured: 9 of 25 framings distorted, worst 100x). We stop guessing;
    // the analysis seam's baseline gate keeps refusing, honestly and visibly.
    expect(resolveScaleFrame({ storedFrame: 50_000, value: 65_000, raw_value: 65_000 })).toBe(
      undefined,
    );
  });

  it("a frame that has drifted from the pair it was written with is INCOHERENT", () => {
    // Pair encodes 100000; a later writer stamped 50000 beside it.
    expect(checkPairCoherence({ storedFrame: 50_000, value: 0.74, raw_value: 74_000 })).toBe(
      "incoherent",
    );
  });
});

describe("C — NOT_CHECKABLE is a third answer, and it protects the case the stored frame exists FOR", () => {
  it("a factor with NO pair is not checkable — the stored frame still wins", () => {
    // This is the whole reason `scale_frame` was persisted: a factor the brief
    // stated no value for has no pair to recover from. It must be untouched.
    expect(checkPairCoherence({ storedFrame: 100_000 })).toBe("not_checkable");
    expect(resolveScaleFrame({ storedFrame: 100_000 })).toBe(100_000);
  });

  it("a pair with only `raw_value` is not checkable and the stored frame still wins", () => {
    expect(checkPairCoherence({ storedFrame: 100_000, raw_value: 74_000 })).toBe("not_checkable");
    expect(resolveScaleFrame({ storedFrame: 100_000, raw_value: 74_000 })).toBe(100_000);
  });

  it("a stored frame outside the accepted domain (<= 1) is not checkable, and falls to the pair", () => {
    // `resolveScaleFrame` already refused such a frame; coherence must not
    // claim to have judged it.
    expect(checkPairCoherence({ storedFrame: 0.5, value: 0.74, raw_value: 74_000 })).toBe(
      "not_checkable",
    );
    expect(resolveScaleFrame({ storedFrame: 0.5, value: 0.74, raw_value: 74_000 })).toBe(
      recoverScaleFrame({ value: 0.74, raw_value: 74_000 }),
    );
  });

  it("a non-finite member is not checkable, never `coheres`", () => {
    expect(checkPairCoherence({ storedFrame: 100_000, value: Number.NaN, raw_value: 74_000 })).toBe(
      "not_checkable",
    );
    expect(
      checkPairCoherence({ storedFrame: 100_000, value: 0.74, raw_value: Number.POSITIVE_INFINITY }),
    ).toBe("not_checkable");
  });
});

describe("D — the tolerance BITES, and its twin does not", () => {
  it("a discrepancy just INSIDE the epsilon coheres (float round-trip must not be refused)", () => {
    const expected = 74_000 / 100_000;
    const justInside = expected * (1 + PAIR_COHERENCE_RELATIVE_EPSILON / 2);
    expect(checkPairCoherence({ storedFrame: 100_000, value: justInside, raw_value: 74_000 })).toBe(
      "coheres",
    );
  });

  it("a discrepancy just OUTSIDE the epsilon is incoherent — the guard is not slack", () => {
    const expected = 74_000 / 100_000;
    const justOutside = expected * (1 + PAIR_COHERENCE_RELATIVE_EPSILON * 100);
    expect(
      checkPairCoherence({ storedFrame: 100_000, value: justOutside, raw_value: 74_000 }),
    ).toBe("incoherent");
  });

  it("the epsilon is tight enough to be meaningful (a spec, not an optimisation)", () => {
    expect(PAIR_COHERENCE_RELATIVE_EPSILON).toBeGreaterThan(0);
    expect(PAIR_COHERENCE_RELATIVE_EPSILON).toBeLessThanOrEqual(1e-6);
  });
});

describe("E — sign symmetry, because the estate has shipped an asymmetric guard before", () => {
  it("a coherent NEGATIVE pair is judged on the arithmetic, not on its sign", () => {
    // -74000 / 100000 === -0.74. Whether a negative magnitude is MEANINGFUL is
    // a different question, owned elsewhere; coherence answers only whether the
    // three numbers agree. It must not silently classify by sign.
    expect(checkPairCoherence({ storedFrame: 100_000, value: -0.74, raw_value: -74_000 })).toBe(
      "coheres",
    );
  });

  it("an INCOHERENT negative pair is still caught", () => {
    expect(checkPairCoherence({ storedFrame: 100_000, value: 0.74, raw_value: -74_000 })).toBe(
      "incoherent",
    );
  });
});
