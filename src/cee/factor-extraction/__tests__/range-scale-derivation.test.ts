/**
 * ⭐⭐ THE SCALE, AND WHY IT IS A SECOND DEFECT (ROADMAP 2.1131).
 *
 * The 3 Sep 2026 session failed twice over, and fixing the magnitude closes
 * only the first half:
 *
 *   1. "£80-120k" extracted as 80..120, so the factor stored `raw_value: 80`;
 *   2. `computeNormalisationCap(80)` returned **100**, and that cap was then
 *      enforced against Paul's own correction —
 *      *"Value £100,000 exceeds the factor's cap of £100. I haven't changed
 *      anything."*
 *
 * ⚠ IT IS TEMPTING TO CALL (2) A SYMPTOM OF (1). It is not, and treating it as
 * one is trap 23 exactly — a fix validated against the metric the symptom
 * named, while the outcome the user experiences is untouched. Two defects live
 * in the scale independently of any magnitude:
 *
 *   · THE CAP CAME FROM THE POINT, NOT THE RANGE. For a range factor
 *     `factor.value` is the MIDPOINT, so even with the magnitude read
 *     correctly "£80k-120k" would be scaled against 100,000 — and the user's
 *     own upper bound, £120,000, would fall OUTSIDE the factor's own stated
 *     range.
 *   · A ROUND NUMBER GOT NO HEADROOM AT ALL. `Math.ceil(log10(100000))` is 5
 *     exactly, so £100,000 received `cap: 100000` and normalised to 1.0 — a
 *     scale that is a wall at the only point on it. Budgets are stated in round
 *     numbers, so this is the common case, not the edge.
 *
 * ⚠ WHAT IS NOT CLOSED, stated so this file is not read as more than it is. An
 * unconfirmed POINT extraction still mints an ENFORCED cap: the 3 Sep factor
 * carried `uncertainty_drivers: ["Extracted from brief — confirm value"]` and
 * was refused against that cap anyway. Making an unconfirmed cap advisory is a
 * change at `evaluate-factor-value-proposal.ts` §6 and its three call sites —
 * a different seam, named and left alone (ROADMAP 2.1132).
 */

import { describe, expect, it } from "vitest";
import type { GraphT } from "../../../schemas/graph.js";
import { enrichGraphWithFactorsAsync } from "../enricher.js";

/** A graph with no factor nodes, so the enricher's CREATE branch runs. */
function emptyGraph(): GraphT {
  return {
    nodes: [
      { id: "goal-1", kind: "outcome", label: "Reach £30k MRR", data: {} },
    ],
    edges: [],
  } as unknown as GraphT;
}

/**
 * ⚠ THE **ASYNC** ENRICHER, DELIBERATELY. `enrichGraphWithFactors` (sync) has
 * ZERO production call sites and does no factor-cap normalisation at all;
 * `enrichGraphWithFactorsAsync` is the one the unified pipeline calls
 * (`cee/unified-pipeline/stages/enrich.ts`: "This is the ONLY call site"), and
 * it is where the cap is minted. A first version of this file drove the sync
 * one, got a factor with no cap at all, and would have asserted nothing about
 * the seam it was written for.
 */
async function factorFor(brief: string, labelFragment: string) {
  const { graph } = await enrichGraphWithFactorsAsync(emptyGraph(), brief);
  const node = graph.nodes.find(
    (n) =>
      n.kind === "factor" &&
      typeof n.label === "string" &&
      n.label.toLowerCase().includes(labelFragment),
  );
  return node?.data as
    | { value?: number; raw_value?: number; cap?: number; unit?: string; rangeMax?: number }
    | undefined;
}

/** The cap the enricher WOULD have minted from the point, before 2.1131. */
function capFromPoint(rawValue: number): number {
  return Math.pow(10, Math.ceil(Math.log10(rawValue)));
}

describe("the 3 Sep journey, end to end through the enricher", () => {
  const WITNESSED = "We're budgeting £80-120k for the first hire.";

  it("the stored raw value is EIGHTY THOUSAND-scale, not eighty", async () => {
    const data = await factorFor(WITNESSED, "budget");
    expect(data, "no budget factor was created").toBeDefined();
    // The midpoint of the range the user actually wrote.
    expect(data!.raw_value).toBe(100_000);
  });

  it("…and the cap admits the user's own upper bound, and then some", async () => {
    const data = await factorFor(WITNESSED, "budget");
    // The failure this closes, in one assertion: at f4c8f50 this was 100.
    expect(data!.cap, "the cap that refused £100,000").toBeGreaterThan(120_000);
    // Bound to the STATED range, not to a number picked here: whatever the
    // ladder returns, the user's own £120,000 must be inside it. Asserting the
    // exact cap would pin the ladder's arithmetic; asserting the property pins
    // the promise.
    expect(data!.cap!).toBeGreaterThanOrEqual(120_000);
  });

  it("the £100,000 Paul typed is INSIDE the scale the brief produced", async () => {
    // The whole journey, as one claim. This is the sentence the product
    // emitted on 3 Sep — "Value £100,000 exceeds the factor's cap of £100" —
    // turned into a test.
    const data = await factorFor(WITNESSED, "budget");
    expect(100_000).toBeLessThanOrEqual(data!.cap!);
  });
});

describe("a cap is derived from the RANGE's ceiling, never from the point", () => {
  /**
   * ⚠⚠ THIS BRIEF IS CHOSEN TO DISCRIMINATE, and choosing it is the whole
   * point of the block. Two independent scale fixes landed in 2.1131 —
   * cap-from-the-range-ceiling, and headroom-on-a-round-number — and on the
   * witnessed brief they happen to produce the SAME cap (1,000,000 either
   * way), so a test written on that brief alone would let EITHER fix carry the
   * other and would stay green if one were reverted. One control cannot cover
   * two defects.
   *
   * "£5-110k" separates them: midpoint 57,500 → a point-derived cap of
   * **100,000**, which EXCLUDES the user's own stated upper bound of 110,000.
   * Only deriving from the ceiling admits it, and the assertion below states
   * that as a comparison against the point-derived number rather than against
   * a constant, so it cannot drift with the ladder.
   */
  it("the range's OWN upper bound is inside its scale, where the point's cap would exclude it", async () => {
    const data = await factorFor("Budget between £5-110k for the hire.", "budget");
    expect(data!.raw_value, "the midpoint").toBe(57_500);
    expect(data!.rangeMax).toBe(110_000);

    // The discrimination, asserted rather than assumed: this brief is one
    // where the two derivations genuinely differ.
    expect(
      data!.rangeMax! > capFromPoint(data!.raw_value!),
      "this brief no longer discriminates the two cap derivations — pick another",
    ).toBe(true);

    expect(data!.cap, "must admit the £110k the user wrote").toBeGreaterThanOrEqual(110_000);
  });

  it("a range's upper bound is inside its own factor's scale", async () => {
    const data = await factorFor("Budget between £2-5m for the platform.", "budget");
    expect(data!.raw_value, "the midpoint").toBe(3_500_000);
    expect(data!.cap, "must cover the £5m the user wrote").toBeGreaterThanOrEqual(5_000_000);
  });

  it("…and the OPPOSITE-DIRECTION TWIN: a stated POINT is not given a range's headroom", async () => {
    // If the cap simply grew for everything, the assertions above would pass
    // while meaning nothing. A point factor keeps the ladder it always had.
    const data = await factorFor("The tooling cost is £45,000.", "cost");
    expect(data!.raw_value).toBe(45_000);
    expect(data!.cap, "one order of magnitude, exactly as before").toBe(100_000);
  });
});

describe("a round number is not pinned to its own ceiling", () => {
  it("£100,000 gets headroom, not a cap equal to itself", async () => {
    const data = await factorFor("The tooling cost is £100,000.", "cost");
    expect(data!.raw_value).toBe(100_000);
    // At f4c8f50: cap 100000, value 1.0, and every later edit upward refused.
    expect(data!.cap, "a cap equal to the value is a wall, not a scale").toBeGreaterThan(100_000);
    expect(data!.value, "normalised strictly inside the scale").toBeLessThan(1);
  });

  it("…and a NON-round number is untouched (opposite-direction twin)", async () => {
    // The change is deliberately the smallest one: only the zero-headroom
    // class moves. Widening the ladder generally would move every normalised
    // value in the estate and change ISL's inputs wholesale.
    const data = await factorFor("The tooling cost is £45,000.", "cost");
    expect(data!.cap).toBe(100_000);
    expect(data!.value).toBe(0.45);
  });
});
