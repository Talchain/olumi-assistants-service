/**
 * F2 (Codex, 2026-08-13) — A USER-STATED VALUE MUST NOT BE LABELLED "INFERRED".
 *
 * THE DEFECT, reproduced at pristine before this suite existed. PR #873 made the
 * provenance claim earned rather than assumed, and passed `observed_state.cap`
 * so the comparison would ask about the MAGNITUDE a lever level denotes. That
 * was right for capped factors and silently wrong for capless FRAMED ones — the
 * shape the records projector writes for every magnitude-scaled baseline
 * (`{value: raw/frame, raw_value: raw}`, projector.ts:1667; the frame is
 * deliberately not persisted). With no cap, `denormalisedMagnitude` returns null
 * and `?? value` fell back to comparing the NORMALISED LEVEL against the brief's
 * RAW magnitudes.
 *
 * Measured at pristine on the brief this suite uses:
 *   isAmountStatedInBrief(0.8, undefined, brief, undefined) === false
 *   isAmountStatedInBrief(80,  undefined, brief, undefined) === true
 * So the user's own "80" was stamped `cee_hypothesis` / `low` / "this amount is
 * not stated in the brief" — and the UI renders that as "inferred" plus a
 * warning. The product told the user their own number was invented.
 *
 * ── WHAT THESE INVARIANTS ARE WRITTEN AGAINST (CLAUDE.md trap 13d) ──────────
 * The SPEC, not the failure mode: **a provenance claim must be TRUE of the
 * brief text.** That has two failure directions and they are NOT symmetric, so
 * every case below carries its opposite-direction twin:
 *   · claiming "stated" for a value the user never wrote — a fabrication;
 *   · claiming "not stated in the brief" about a number the user typed — a
 *     false claim about the user's own words (the one that shipped).
 * A two-state boolean cannot express the third honest answer, which is why the
 * zero-baseline cases assert an ADMISSION rather than either claim.
 *
 * BINDING IS BY IDENTITY (trap 19): every assertion names THE option and THE
 * factor, never "some intervention with value 0.8".
 */

import { describe, it, expect } from "vitest";

import { extractOptionsFromNodes } from "../../extraction/intervention-extractor.js";
import {
  classifyAmountAgainstBrief,
  isAmountStatedInBrief,
  magnitudeUnderScale,
  resolveMagnitudeScale,
} from "../stated-amounts.js";
import type { NodeV3T, EdgeV3T } from "../../../schemas/cee-v3.js";

/**
 * The brief from the live F2 reproduction. Three plain magnitudes, no currency:
 * 80 and 50 are the user's proposals, 40 is the status quo.
 */
const HEADCOUNT_BRIEF =
  "Plan A sets the support headcount to 80. Plan B sets the support headcount to 50. Support headcount is currently 40.";

/** The framed, capless pair the records projector writes: 40 at frame 100. */
const FRAMED_OBSERVED_STATE = { value: 0.4, raw_value: 40, unit: undefined };

function factorNode(id: string, label: string, observedState: unknown): NodeV3T {
  const node: Record<string, unknown> = { id, kind: "factor", label };
  if (observedState !== null) node.observed_state = observedState;
  return node as unknown as NodeV3T;
}

function extract(
  observedState: unknown,
  interventions: Record<string, number>,
  brief = HEADCOUNT_BRIEF,
) {
  const factors = [factorNode("fac_support_headcount", "Support headcount", observedState)];
  const optionInputs = Object.entries(interventions).map(([optionId, level]) => ({
    id: optionId,
    label: optionId === "opt_plan_a" ? "Plan A" : "Plan B",
    v4Interventions: { fac_support_headcount: level },
  }));
  return extractOptionsFromNodes(optionInputs, factors, [] as EdgeV3T[], "goal", [], brief);
}

function interventionOf(
  options: ReturnType<typeof extract>,
  optionId: string,
  factorId = "fac_support_headcount",
) {
  const option = options.find((o) => o.id === optionId);
  if (!option) throw new Error(`fixture precondition failed: option ${optionId} absent`);
  const intervention = option.interventions?.[factorId];
  if (!intervention) {
    throw new Error(`fixture precondition failed: intervention ${optionId}→${factorId} absent`);
  }
  return intervention;
}

describe("F2 — a capless FRAMED factor's stated amount is recognised as stated", () => {
  it("stamps opt_plan_a→fac_support_headcount brief_extraction/high (level 0.8 × recovered frame 100 = the stated 80)", () => {
    // PRECONDITIONS PINNED IN-TEST (trap 13b, third face). A green result here
    // must be the fix's doing, not the fixture's:
    //   (a) the pair really is framed, and the frame really is 100;
    expect(resolveMagnitudeScale(FRAMED_OBSERVED_STATE)).toEqual({ kind: "frame", frame: 100 });
    //   (b) the brief really states 80;
    expect(HEADCOUNT_BRIEF).toContain("80");
    //   (c) and the NORMALISED level is NOT itself locatable in the brief, so
    //       the pre-fix comparison cannot be what turns this green.
    expect(isAmountStatedInBrief(0.8, undefined, HEADCOUNT_BRIEF)).toBe(false);

    const intervention = interventionOf(extract(FRAMED_OBSERVED_STATE, { opt_plan_a: 0.8 }), "opt_plan_a");

    expect(intervention.source).toBe("brief_extraction");
    expect(intervention.value_confidence).toBe("high");
    expect(intervention.reasoning).not.toContain("not stated in the brief");
    // The VALUE is never rewritten — only the label it had not earned.
    expect(intervention.value).toBe(0.8);
  });

  it("stamps the SECOND option's own stated amount too (level 0.5 × 100 = the stated 50)", () => {
    const intervention = interventionOf(extract(FRAMED_OBSERVED_STATE, { opt_plan_b: 0.5 }), "opt_plan_b");
    expect(intervention.source).toBe("brief_extraction");
    expect(intervention.value_confidence).toBe("high");
    expect(intervention.value).toBe(0.5);
  });

  it("OPPOSITE-DIRECTION TWIN: a level whose magnitude the brief never states is still DISOWNED", () => {
    // 0.77 × 100 = 77, which appears nowhere in the brief. The fix must not
    // become a blanket amnesty — a model-chosen level keeps its honest label.
    expect(isAmountStatedInBrief(77, undefined, HEADCOUNT_BRIEF)).toBe(false);

    const intervention = interventionOf(extract(FRAMED_OBSERVED_STATE, { opt_plan_a: 0.77 }), "opt_plan_a");

    expect(intervention.source).toBe("cee_hypothesis");
    expect(intervention.value_confidence).toBe("low");
    // Here the claim IS true of the brief, so it is made plainly.
    expect(intervention.reasoning).toContain("not stated in the brief");
  });
});

describe("F2 — the honesty boundary: where the record settles no scale, the product ADMITS it", () => {
  // `recoverScaleFrame` refuses zero pairs BY DESIGN (scale-frame.ts:47) and
  // that refusal is correct — frame persistence is a separately-owned question.
  // The consequence is that a zero-baseline factor makes the provenance test
  // UNDECIDABLE, and the product must not resolve an undecidable question by
  // asserting the more damaging of the two possible falsehoods.
  const ZERO_BASELINE = { value: 0, raw_value: 0 };

  it("does NOT claim a zero-baseline factor's amount is absent from the brief", () => {
    expect(resolveMagnitudeScale(ZERO_BASELINE)).toEqual({ kind: "unknown" });

    const intervention = interventionOf(extract(ZERO_BASELINE, { opt_plan_a: 0.8 }), "opt_plan_a");

    // THE LOAD-BEARING ASSERTION: the product may not tell the user their own
    // words are missing when it cannot read the scale to check.
    expect(intervention.reasoning).not.toContain("not stated in the brief");
    expect(intervention.reasoning).toContain("could not be checked against the brief");
    // Confidence stays low and the claim stays withdrawn — only the SENTENCE
    // changes, and only from a falsehood to an admission.
    expect(intervention.source).toBe("cee_hypothesis");
    expect(intervention.value_confidence).toBe("low");
  });

  it("does the same when the factor records no observed_state at all", () => {
    const intervention = interventionOf(extract(null, { opt_plan_a: 0.8 }), "opt_plan_a");
    expect(intervention.reasoning).not.toContain("not stated in the brief");
    expect(intervention.value_confidence).toBe("low");
  });

  it("STILL claims 'stated' under an unknown scale when the level itself IS in the brief", () => {
    // A MATCH is decisive whatever the denominator: if the number appears in
    // the user's text, the user wrote it. Only a NON-match needs a known scale.
    const intervention = interventionOf(extract(ZERO_BASELINE, { opt_plan_a: 80 }), "opt_plan_a");
    expect(intervention.source).toBe("brief_extraction");
    expect(intervention.value_confidence).toBe("high");
  });
});

describe("F2 — the other three scale conventions keep today's behaviour byte-identical", () => {
  it("CAPPED factor: unchanged (this is the #873 path and must not move)", () => {
    const capped = { value: 0.8, raw_value: 80, unit: undefined, cap: 100 };
    expect(resolveMagnitudeScale(capped)).toEqual({ kind: "cap", cap: 100 });

    const intervention = interventionOf(extract(capped, { opt_plan_a: 0.8 }), "opt_plan_a");
    expect(intervention.source).toBe("brief_extraction");
    expect(intervention.value_confidence).toBe("high");
  });

  it("UNFRAMED factor {x, x}: the level IS the magnitude, and a genuine absence is still named", () => {
    // ⚠ THIS IS WHY THE VERDICT IS FOUR-WAY AND NOT "frame recovered / not".
    // `recoverScaleFrame` returns undefined for BOTH {40,40} and {0,0}, but
    // only the second is undecidable. Collapsing them would withdraw the
    // honest disowning from every plain count in the estate.
    const unframed = { value: 40, raw_value: 40 };
    expect(resolveMagnitudeScale(unframed)).toEqual({ kind: "identity" });

    const stated = interventionOf(extract(unframed, { opt_plan_a: 80 }), "opt_plan_a");
    expect(stated.source).toBe("brief_extraction");

    const absent = interventionOf(extract(unframed, { opt_plan_a: 77 }), "opt_plan_a");
    expect(absent.source).toBe("cee_hypothesis");
    expect(absent.reasoning).toContain("not stated in the brief");
  });
});

describe("F2 — the scale/verdict primitives themselves", () => {
  it("resolveMagnitudeScale covers the producers' whole pair domain", () => {
    expect(resolveMagnitudeScale({ value: 0.4, raw_value: 40 })).toEqual({ kind: "frame", frame: 100 });
    expect(resolveMagnitudeScale({ value: 0.5, raw_value: 50, cap: 100 })).toEqual({ kind: "cap", cap: 100 });
    expect(resolveMagnitudeScale({ value: 40, raw_value: 40 })).toEqual({ kind: "identity" });
    expect(resolveMagnitudeScale({ value: 0, raw_value: 0 })).toEqual({ kind: "unknown" });
    expect(resolveMagnitudeScale({ value: 0.4 })).toEqual({ kind: "unknown" });
    expect(resolveMagnitudeScale(undefined)).toEqual({ kind: "unknown" });
    // A non-positive cap is off-contract and must not be trusted as a divisor.
    expect(resolveMagnitudeScale({ value: 0.4, raw_value: 40, cap: 0 })).toEqual({ kind: "frame", frame: 100 });
  });

  it("magnitudeUnderScale de-normalises under each convention, and refuses under none", () => {
    expect(magnitudeUnderScale(0.8, undefined, { kind: "frame", frame: 100 })).toBe(80);
    expect(magnitudeUnderScale(0.8, undefined, { kind: "cap", cap: 100 })).toBe(80);
    expect(magnitudeUnderScale(0.8, undefined, { kind: "identity" })).toBe(0.8);
    expect(magnitudeUnderScale(0.8, undefined, { kind: "unknown" })).toBeNull();
  });

  it("classifyAmountAgainstBrief is three-state, and a non-match only decides under a known scale", () => {
    const frame = { kind: "frame", frame: 100 } as const;
    expect(classifyAmountAgainstBrief(0.8, undefined, HEADCOUNT_BRIEF, frame)).toBe("stated");
    expect(classifyAmountAgainstBrief(0.77, undefined, HEADCOUNT_BRIEF, frame)).toBe("not_stated");
    expect(classifyAmountAgainstBrief(0.8, undefined, HEADCOUNT_BRIEF, { kind: "unknown" })).toBe("undecidable");
    // …and a match under an unknown scale is still decisive.
    expect(classifyAmountAgainstBrief(80, undefined, HEADCOUNT_BRIEF, { kind: "unknown" })).toBe("stated");
  });
});
