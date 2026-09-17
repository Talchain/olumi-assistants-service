/**
 * ⭐⭐⭐ TWO PASSES, TWO CONVENTIONS, ONE FRAME — AND THE DETECTOR IS A RECORDED
 * FACT, NOT AN INFERENCE.
 *
 * Witnessed live, 16 Sep 2026. Factor "Hiring and Onboarding Cost", frame 200000
 * (the user's own budget):
 *     hire a Tech lead                      raw 80000   ->  0.4
 *     two developers                        raw 120000  ->  0.6
 *     Hire One Tech Lead and One Developer  raw 0.85    ->  0.00000425
 *
 * ⭐ ESTABLISHED AT THE BYTES, from the banked capture rather than argued. Pass 1
 * emitted SEVEN option-effect magnitudes and every one is on the unit interval:
 * 0.9, 0.55, 0.8, 0.7, 0.6, 0.5, 0.85. `80000` and `120000` appear NOWHERE in
 * the pass-1 record set; `0.85` does. So pass 1 is internally consistent, and the
 * pounds arrive only from the completion pass. This is not a model error — it is
 * two passes using two conventions, framed together afterwards by pass 3d, which
 * derives ONE frame from whatever magnitudes happen to be present.
 *
 * ⛔⛔ WHY THE DETECTOR IS NOT MAGNITUDE, twice refuted before this file existed:
 *   · "refuse a sub-unit magnitude beside an absolute one" is refuted by
 *     `projector-scale-projection`, which asserts the opposite DELIBERATELY:
 *     £0.50 penny pricing beside £50,000 enterprise pricing is a REAL strategy
 *     and `sets_to` is in the factor's own unit. Magnitude cannot tell penny
 *     pricing from a convention clash.
 *   · the same rule with zero excluded still fails that test, and its first form
 *     also deleted a legitimate £0 status quo (four cases red on
 *     `expected undefined to be +0`).
 *
 * ⭐ SO THE DETECTOR IS THE PASS BOUNDARY, which the pipeline ALREADY RECORDS:
 * `enumerateCompletionAsk` returns `baseClaimIndex` (= the pass-1 claim count),
 * the completion prompt tells the model its first new claim is that index, and
 * `anthropic.ts` already logs it. Claims below it are pass 1; at or above it are
 * completion-authored. Nothing is inferred — this is a fact the pipeline keeps
 * and simply never handed to the projector.
 *
 * ⚠ AND IT REFUSES A NUMBER, NEVER A PROPOSAL. A magnitude authored in pass 1
 * against a population that no longer exists is withheld and DISCLOSED once
 * completion has authored magnitudes on the same factor; the option keeps its
 * identity and its other interventions, and the product's existing
 * `missing_value` blocker then ASKS what that option sets. Completion ran later
 * with the merged graph in view, which is the ordering argument for preferring
 * its magnitudes — not a judgement about which number looks nicer.
 *
 * ⚠ SINGLE-PASS MAGNITUDES ARE UNTOUCHED, which is what keeps penny pricing
 * alive: with no completion-authored magnitude on a factor there is no boundary
 * to span, and C3 pins exactly that.
 */
import { describe, expect, it } from "vitest";

import { projectRecordsToGraph } from "../projector.js";
import type { DraftRecordSet } from "../grammar.js";

type G = ReturnType<typeof projectRecordsToGraph>;
const nodes = (p: G) => (p as unknown as { graph: { nodes: ReadonlyArray<Record<string, any>> } }).graph.nodes;
const dropped = (p: G) => (p as unknown as { dropped: ReadonlyArray<{ reason: string; label: string }> }).dropped;
const iv = (p: G, optLabel: string, facLabel: string) => {
  const fac = nodes(p).find((n) => n.kind === "factor" && n.label === facLabel);
  const opt = nodes(p).find((n) => n.kind === "option" && n.label === optLabel);
  const bag = (opt?.data?.interventions ?? {}) as Record<string, number>;
  return fac === undefined ? undefined : bag[String(fac.id)];
};

/**
 * The witness shape. Claims 0-5 are pass 1 (the hybrid's unit-interval 0.85);
 * claims 6-7 are completion-authored (£80,000 / £120,000). Boundary = 6.
 */
const CROSS_BOUNDARY = (): DraftRecordSet =>
  ({
    stated_items: [
      { kind: "goal", source_quote: "increase productivity while maintaining code quality", role: "target" },
      { kind: "option", source_quote: "hire a Tech lead" },
      { kind: "option", source_quote: "two developers" },
    ],
    claims: [
      /* 0 */ { claim_kind: "factor", label: "Hiring and Onboarding Cost", basis: [] },
      /* 1 */ { claim_kind: "outcome", label: "Delivery Speed to Launch", basis: [] },
      /* 2 */ { claim_kind: "option_refinement", label: "Hire One Tech Lead and One Developer", basis: [1, 2] },
      /* 3 */ { claim_kind: "causal_link", label: "hybrid costs", from_claim: 2, to_claim: 0, effect: "positive", strength: 0.5, sets_to: 0.85 },
      /* 4 */ { claim_kind: "causal_link", label: "cost slows delivery", from_claim: 0, to_claim: 1, effect: "negative", strength: 0.4 },
      /* 5 */ { claim_kind: "causal_link", label: "delivery drives goal", from_claim: 1, to_stated: 0, effect: "positive", strength: 0.8 },
      /* 6 */ { claim_kind: "causal_link", label: "lead costs", from_stated: 1, to_claim: 0, effect: "positive", strength: 0.5, sets_to: 80000 },
      /* 7 */ { claim_kind: "causal_link", label: "devs cost", from_stated: 2, to_claim: 0, effect: "positive", strength: 0.5, sets_to: 120000 },
    ],
  }) as unknown as DraftRecordSet;

const COST = "Hiring and Onboarding Cost";
const HYBRID = "Hire One Tech Lead and One Developer";

describe("B1 — a pass-1 magnitude is withheld once completion authors one on the same factor", () => {
  it("B1a PRECONDITION: with no boundary supplied, the live defect reproduces", () => {
    const p = projectRecordsToGraph(CROSS_BOUNDARY(), undefined);
    expect(iv(p, HYBRID, COST), "the £0.85 priced at effectively zero").toBeCloseTo(0.00000425, 10);
  });

  it("B1b with the boundary, the divergence is REPORTED — and the value is left alone", () => {
    // ⛔ THIS ASSERTION WAS INVERTED, AND THE INVERSION IS THE POINT. It used to
    // require the value be DELETED. Independent review reproduced the cost:
    // put penny pricing ACROSS the boundary (£0.50 in pass 1, £50,000 from
    // completion) and deletion removes a legitimate price — B2d below. Four
    // detector shapes have now been refuted, so the honest remedy is to say the
    // scales did not reconcile, not to guess which side is wrong.
    const p = projectRecordsToGraph(CROSS_BOUNDARY(), undefined, 6);
    const reasons = dropped(p).map((d) => d.reason);
    expect(reasons, "the divergence is named").toContain("option_magnitude_scale_unreconciled");
    expect(iv(p, HYBRID, COST), "and nothing is deleted on a guess").toBeDefined();
  });

  it("B1b2 WHAT THIS DOES NOT FIX, pinned so nobody reads more into it", () => {
    // The live harm survives: £0.85 against an £200,000 frame still normalises
    // to ~4e-06 and can still read as free. Disclosure makes that visible to a
    // consumer instead of silent. Deciding what the product DOES about the
    // ranking has an owner; it is not a guess for the projector to make.
    const p = projectRecordsToGraph(CROSS_BOUNDARY(), undefined, 6);
    expect(iv(p, HYBRID, COST)).toBeCloseTo(0.00000425, 10);
  });

  it("B1c the completion-authored pounds are untouched", () => {
    const p = projectRecordsToGraph(CROSS_BOUNDARY(), undefined, 6);
    expect(iv(p, "hire a Tech lead", COST), "80000 / 200000").toBeCloseTo(0.4, 6);
    expect(iv(p, "two developers", COST), "120000 / 200000").toBeCloseTo(0.6, 6);
  });

  it("B1d THE PROPOSAL SURVIVES — a number is refused, never an alternative", () => {
    const labels = nodes(projectRecordsToGraph(CROSS_BOUNDARY(), undefined, 6))
      .filter((n) => n.kind === "option")
      .map((n) => String(n.label));
    expect(labels, "the widened alternative keeps its place on the graph").toContain(HYBRID);
  });

  it("B1e and it is DISCLOSED, never silent", () => {
    const reasons = dropped(projectRecordsToGraph(CROSS_BOUNDARY(), undefined, 6)).map((d) => d.reason);
    expect(reasons.some((r) => r.includes("scale"))).toBe(true);
  });
});

describe("B2 — single-pass magnitudes are untouched, which is what keeps penny pricing alive", () => {
  const SINGLE_PASS = (): DraftRecordSet => {
    const r = CROSS_BOUNDARY() as any;
    // Drop the two completion-authored links: now nothing spans the boundary.
    return { ...r, claims: r.claims.slice(0, 6) } as DraftRecordSet;
  };

  it("B2a a lone pass-1 magnitude still projects, boundary or not", () => {
    const withB = projectRecordsToGraph(SINGLE_PASS(), undefined, 6);
    expect(iv(withB, HYBRID, COST), "no boundary is spanned, so nothing is withheld").toBeDefined();
  });

  it("B2b supplying the boundary changes NOTHING when no claim crosses it", () => {
    const a = projectRecordsToGraph(SINGLE_PASS(), undefined);
    const b = projectRecordsToGraph(SINGLE_PASS(), undefined, 6);
    expect(iv(b, HYBRID, COST)).toBe(iv(a, HYBRID, COST));
    expect(dropped(b).map((d) => d.reason).some((r) => r.includes("scale"))).toBe(false);
  });

  it("B2d CROSS-PASS PENNY PRICING — the twin my own control never built", () => {
    // ⛔⛔ TRAP 22b, AND IT WAS MINE. B2c below tests penny pricing in the
    // SINGLE-PASS arm only, so it could never observe the deletion direction.
    // Independent review supplied the missing door: the £50,000 arrives from
    // completion and the £0.50 from pass 1, so the conjunction fires on a
    // perfectly legitimate price. Reproduced before accepting it — the £0.50
    // came back `undefined`.
    const penny = {
      stated_items: [
        { kind: "goal", source_quote: "price sustainably" },
        { kind: "option", source_quote: "penny pricing" },
        { kind: "option", source_quote: "enterprise pricing" },
      ],
      claims: [
        /* 0 */ { claim_kind: "factor", label: "Unit Price" },
        /* 1 */ { claim_kind: "causal_link", label: "penny sets low", from_stated: 1, to_claim: 0, effect: "negative", sets_to: 0.5 },
        /* 2 */ { claim_kind: "causal_link", label: "price bears on goal", from_claim: 0, to_stated: 0, effect: "positive" },
        /* 3 */ { claim_kind: "causal_link", label: "enterprise sets high", from_stated: 2, to_claim: 0, effect: "positive", sets_to: 50000 },
      ],
    } as unknown as DraftRecordSet;
    const p = projectRecordsToGraph(penny, undefined, 3);
    expect(iv(p, "penny pricing", "Unit Price"), "a legitimate £0.50 price must not be deleted").toBeDefined();
    expect(iv(p, "enterprise pricing", "Unit Price")).toBeDefined();
  });

  it("B2c PENNY PRICING: £0.50 beside £50,000 from ONE pass is preserved exactly", () => {
    // The case that refuted two earlier magnitude-based attempts. Both
    // magnitudes are pass-1, so no boundary is spanned and the ratio survives.
    const penny = {
      stated_items: [
        { kind: "goal", source_quote: "price sustainably" },
        { kind: "option", source_quote: "penny pricing" },
        { kind: "option", source_quote: "enterprise pricing" },
      ],
      claims: [
        { claim_kind: "factor", label: "Unit Price" },
        { claim_kind: "causal_link", label: "penny sets low", from_stated: 1, to_claim: 0, effect: "negative", sets_to: 0.5 },
        { claim_kind: "causal_link", label: "enterprise sets high", from_stated: 2, to_claim: 0, effect: "positive", sets_to: 50000 },
        { claim_kind: "causal_link", label: "price bears on goal", from_claim: 0, to_stated: 0, effect: "positive" },
      ],
    } as unknown as DraftRecordSet;
    const p = projectRecordsToGraph(penny, undefined, 4);
    expect(iv(p, "enterprise pricing", "Unit Price")).toBe(0.5);
    expect(iv(p, "penny pricing", "Unit Price")).toBe(0.5 / 100000);
  });
});

/**
 * ⭐⭐⭐ B3 — THE TWO DOORS THE MAXIMA FORM COULD NOT WATCH, supplied by
 * independent review in its own words: *"reversed order (native amounts first,
 * normalised completion later) is not detected, and a large earlier sibling
 * masks a small wrong earlier value because the detector compares maxima."*
 *
 * Both are the SAME defect — reducing each side to `Math.max` discards the
 * value being asked about — and both are fixed by comparing the GLOBAL extremes
 * and asking which side each came from. ⚠ The 1000 constant is NOT tuned; review
 * forbade that explicitly and it would not have helped either case (b's maxima
 * ratio is 1e-5 and c's is 1.5 — no threshold reaches them).
 *
 * ⛔ These are trap 22b twins for B1: B1 tests LATER-BIGGER and SMALL-VALUE-IS-
 * THE-MAXIMUM, so it was structurally incapable of observing either of these.
 * Every case here fails on the maxima form and passes on the extremes form.
 */
describe("B3 — order-independence and no masking by a large sibling", () => {
  const COST3 = "Hiring and Onboarding Cost";

  it("B3a REVERSED ORDER: native pounds in pass 1, the normalised value from completion", () => {
    // Maxima form: biggestLater/biggestEarlier = 0.85/120000 ≈ 7e-6. Silent.
    const rec = {
      stated_items: [
        { kind: "goal", source_quote: "increase productivity", role: "target" },
        { kind: "option", source_quote: "hire a Tech lead" },
        { kind: "option", source_quote: "two developers" },
      ],
      claims: [
        /* 0 */ { claim_kind: "factor", label: COST3, basis: [] },
        /* 1 */ { claim_kind: "outcome", label: "Delivery Speed to Launch", basis: [] },
        /* 2 */ { claim_kind: "causal_link", label: "lead costs", from_stated: 1, to_claim: 0, effect: "positive", strength: 0.5, sets_to: 80000 },
        /* 3 */ { claim_kind: "causal_link", label: "devs cost", from_stated: 2, to_claim: 0, effect: "positive", strength: 0.5, sets_to: 120000 },
        /* 4 */ { claim_kind: "causal_link", label: "cost slows delivery", from_claim: 0, to_claim: 1, effect: "negative", strength: 0.4 },
        /* 5 */ { claim_kind: "causal_link", label: "delivery drives goal", from_claim: 1, to_stated: 0, effect: "positive", strength: 0.8 },
        /* 6 */ { claim_kind: "option_refinement", label: "Hire One Tech Lead and One Developer", basis: [1, 2] },
        /* 7 */ { claim_kind: "causal_link", label: "hybrid costs", from_claim: 6, to_claim: 0, effect: "positive", strength: 0.5, sets_to: 0.85 },
      ],
    } as unknown as DraftRecordSet;
    const p = projectRecordsToGraph(rec, undefined, 6);
    expect(
      dropped(p).map((d) => d.reason),
      "the identical clash, arriving the other way round, is still reported",
    ).toContain("option_magnitude_scale_unreconciled");
    expect(iv(p, "Hire One Tech Lead and One Developer", COST3), "and still nothing is deleted").toBeDefined();
  });

  it("B3b MASKING: a large pass-1 sibling hid a small pass-1 value from the maxima comparison", () => {
    // Maxima form: biggestEarlier = 80000 (not 0.85), biggestLater = 120000,
    // ratio 1.5. The 0.85 was discarded by `Math.max` before anything looked at
    // it — the value the whole rule exists to notice.
    const rec = {
      stated_items: [
        { kind: "goal", source_quote: "increase productivity", role: "target" },
        { kind: "option", source_quote: "hire a Tech lead" },
        { kind: "option", source_quote: "two developers" },
      ],
      claims: [
        /* 0 */ { claim_kind: "factor", label: COST3, basis: [] },
        /* 1 */ { claim_kind: "outcome", label: "Delivery Speed to Launch", basis: [] },
        /* 2 */ { claim_kind: "option_refinement", label: "Hire One Tech Lead and One Developer", basis: [1, 2] },
        /* 3 */ { claim_kind: "causal_link", label: "hybrid costs", from_claim: 2, to_claim: 0, effect: "positive", strength: 0.5, sets_to: 0.85 },
        /* 4 */ { claim_kind: "causal_link", label: "lead costs", from_stated: 1, to_claim: 0, effect: "positive", strength: 0.5, sets_to: 80000 },
        /* 5 */ { claim_kind: "causal_link", label: "cost slows delivery", from_claim: 0, to_claim: 1, effect: "negative", strength: 0.4 },
        /* 6 */ { claim_kind: "causal_link", label: "delivery drives goal", from_claim: 1, to_stated: 0, effect: "positive", strength: 0.8 },
        /* 7 */ { claim_kind: "causal_link", label: "devs cost", from_stated: 2, to_claim: 0, effect: "positive", strength: 0.5, sets_to: 120000 },
      ],
    } as unknown as DraftRecordSet;
    const p = projectRecordsToGraph(rec, undefined, 7);
    expect(
      dropped(p).map((d) => d.reason),
      "the 0.85 is the global minimum and it straddles the boundary against 120000",
    ).toContain("option_magnitude_scale_unreconciled");
  });

  it("B3c THE DISCLOSURE NAMES THE WHOLE SET, never only the pass-1 side", () => {
    // ⛔ Review's words: "without silently favouring completion". Disclosing one
    // side asserts the other side is sound, and four refuted shapes say I have
    // no evidence for that. The object of the disclosure is the SET.
    const rows = dropped(projectRecordsToGraph(CROSS_BOUNDARY(), undefined, 6))
      .filter((d) => d.reason === "option_magnitude_scale_unreconciled")
      .map((d) => d.label);
    expect(rows.some((l) => l.includes("Hire One Tech Lead and One Developer")), "the pass-1 value").toBe(true);
    expect(rows.some((l) => l.includes("hire a Tech lead")), "the completion-authored value too").toBe(true);
  });

  it("B3d SINGLE-PASS PENNY PRICING IS STILL UNREACHABLE, at any ratio", () => {
    // The load-bearing negative. Both extremes sit on the same side of the
    // boundary, so the rule cannot fire however far apart they are — this is
    // what makes the change safe rather than merely wider.
    const penny = {
      stated_items: [
        { kind: "goal", source_quote: "price sustainably" },
        { kind: "option", source_quote: "penny pricing" },
        { kind: "option", source_quote: "enterprise pricing" },
      ],
      claims: [
        { claim_kind: "factor", label: "Unit Price" },
        { claim_kind: "causal_link", label: "penny sets low", from_stated: 1, to_claim: 0, effect: "negative", sets_to: 0.5 },
        { claim_kind: "causal_link", label: "enterprise sets high", from_stated: 2, to_claim: 0, effect: "positive", sets_to: 50000 },
        { claim_kind: "causal_link", label: "price bears on goal", from_claim: 0, to_stated: 0, effect: "positive" },
      ],
    } as unknown as DraftRecordSet;
    const p = projectRecordsToGraph(penny, undefined, 4);
    expect(dropped(p).map((d) => d.reason).some((r) => r.includes("scale"))).toBe(false);
    expect(iv(p, "penny pricing", "Unit Price")).toBe(0.5 / 100000);
  });

  it("B3e KNOWN FALSE POSITIVE, pinned rather than hidden: cross-pass penny pricing", () => {
    // ⚠ £0.50 in pass 1 and £50,000 from completion is a LEGITIMATE pair and the
    // rule reports it as unreconciled. I cannot separate it from the live £0.85
    // clash using magnitude and pass origin — that is four refuted shapes, not an
    // opinion, and review's ruling is that "a detector may flag suspicion, not
    // prove a value invalid". So the cost of the false positive is a sentence,
    // never a number: both prices survive untouched. Settling it properly means
    // reconciling the declared unit/frame at the WRITER, which is #1546.
    const penny = {
      stated_items: [
        { kind: "goal", source_quote: "price sustainably" },
        { kind: "option", source_quote: "penny pricing" },
        { kind: "option", source_quote: "enterprise pricing" },
      ],
      claims: [
        { claim_kind: "factor", label: "Unit Price" },
        { claim_kind: "causal_link", label: "penny sets low", from_stated: 1, to_claim: 0, effect: "negative", sets_to: 0.5 },
        { claim_kind: "causal_link", label: "price bears on goal", from_claim: 0, to_stated: 0, effect: "positive" },
        { claim_kind: "causal_link", label: "enterprise sets high", from_stated: 2, to_claim: 0, effect: "positive", sets_to: 50000 },
      ],
    } as unknown as DraftRecordSet;
    const p = projectRecordsToGraph(penny, undefined, 3);
    expect(dropped(p).map((d) => d.reason), "flagged — honestly, and known wrong here").toContain(
      "option_magnitude_scale_unreconciled",
    );
    expect(iv(p, "penny pricing", "Unit Price"), "and it costs a sentence, not a price").toBeDefined();
    expect(iv(p, "enterprise pricing", "Unit Price")).toBeDefined();
  });
});
