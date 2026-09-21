/**
 * ⭐⭐ THE MODEL'S DECLARED SCALE MUST REACH BOTH CARRIERS, AND THEY MUST AGREE.
 *
 * ── WHAT v10 CLOSES ────────────────────────────────────────────────────────
 * v9 gave the model somewhere to say what a number is MEASURED IN. It had
 * nowhere to say what the number MEANS. Under `unit: "%"`, `4` and `0.04` are
 * both well-formed and mean the same thing.
 *
 * Measured on a live v202 draw (17 Sep, pricing brief; banked at
 * `output/olumi-evidence-20260917-inert-quantities/prompt-v202/`), brief
 * *"churn is currently 4% a month"*:
 *
 *     factor ab78e513  scale_frame 100   baseline raw 0.04 -> level 0.0004
 *                                        intervention raw 5.5 -> level 0.055
 *     display_value: "0.04%"      <-- WHAT THE USER IS SHOWN
 *
 * The user stated 4% and the product renders 0.04%. `deriveFactorScaleFrame`
 * must pick ONE frame per factor and pins it from `Math.max(...)`, so the sub-1
 * member inherits the frame the >1 member earned. Pinned separately in
 * `percent-frame-straddles-one.test.ts`.
 *
 * ── WHY TWO CARRIERS, AND WHY A GUARD ON TOP ───────────────────────────────
 * ⚠ NEITHER CONTRACT DECLARES `declared_scale` AT NODE LEVEL — checked at the
 * bytes, not assumed. In `@talchain/schemas` it sits INSIDE `observed_state`;
 * CEE's own `src/schemas/graph.ts` has ZERO occurrences. The node-level carrier
 * is an untyped CEE-internal extension written by
 * `repair/unreachable-factors.ts:582` as `(node as any).declared_scale`.
 *
 * And the node level is what the ONLY live reader reads:
 * `transforms/schema-v3.ts:660` passes `anyNode.declared_scale` into
 * `synthesiseRangeDisplayValue`. Meanwhile `observed_state` is the PUBLISHED
 * carrier, and `schema-v3.ts` rebuilds factor `observed_state` FIELD BY FIELD —
 * the seam where `sets_to` was silently dropped for a whole release.
 *
 * So both are written, exactly as this projector already does for
 * `value`/`raw_value`, and trap 21 applies: two authorities on one question do
 * not get to drift. This file is the guard that says they cannot.
 *
 * ⚠ WHAT THIS FILE DOES NOT CLAIM:
 *   · It does not claim the DISPLAY is fixed. The reader is gated on
 *     `category === "external"`, which 2 of 9 drafted factors satisfied across
 *     the two banked draws; the `observed_state` display path (7 of 9,
 *     including the churn factor above) has NO declaration read yet.
 *   · It does not claim the churn MAGNITUDE is fixed. The declaration lets the
 *     frame stop guessing; changing the frame is a separate, gated change
 *     against an outside corpus.
 *   · It does not claim the model WILL declare. A grammar field is an
 *     opportunity, not an outcome — the rate is a live-draw measurement and one
 *     draw is not a rate.
 */
import { describe, expect, it } from "vitest";

import type { DraftRecordSet } from "../grammar.js";
import { projectRecordsToGraph } from "../projector.js";

const CHURN = "Monthly churn rate";

/** The live draw's shape: a stated percentage, declared, with an intervention. */
const RECORDS: DraftRecordSet = {
  stated_items: [
    { kind: "goal", source_quote: "keep churn under 6% while raising the price" },
    { kind: "option", source_quote: "raise the Pro plan price to £59" },
  ],
  claims: [
    // The model declares BOTH what the number is measured in and what it means.
    { claim_kind: "factor", label: CHURN, value: 0.04, unit: "%", value_scale: "unit_interval" },
    {
      claim_kind: "causal_link",
      label: "raising the price moves churn",
      from_stated: 1,
      to_claim: 0,
      effect: "positive",
      sets_to: 0.055,
    },
    // ⚠ REQUIRED, AND ITS ABSENCE COST A ROUND: without a path to the goal the
    // projector DROPS the factor with `unconnected_to_goal`, so every assertion
    // below would have read `undefined` on a node that never existed. The
    // precondition assertion in `churnNode` is what surfaced it rather than
    // letting five tests pass vacuously.
    {
      claim_kind: "causal_link",
      label: "churn bears on the goal",
      from_claim: 0,
      to_stated: 0,
      effect: "negative",
    },
  ],
};

/**
 * ⚠ BOUND BY CONSTRUCTION, NOT BY A LABEL STRING (trap 19: an assertion must
 * bind to its object by identity, never by a predicate another object could
 * satisfy). The projector NORMALISES labels — the goal in this fixture comes
 * back title-cased as "Keep Churn Under 6% While Raising the Price" — so a
 * `label ===` match is a guess about a transform, and it silently found nothing
 * on the first run. The fixture declares EXACTLY ONE factor claim, so "the only
 * factor node" is an identity, and the count is asserted so it stays one.
 */
function churnNode(records: DraftRecordSet) {
  const { graph } = projectRecordsToGraph(records);
  const factors = graph.nodes.filter((n) => n.kind === "factor");
  expect(
    factors.length,
    "exactly one factor must be projected, or every assertion below is vacuous",
  ).toBe(1);
  const node = factors[0]!;
  // Secondary, case-insensitive: proves it is the churn factor and not some
  // other factor the projector minted.
  expect(String(node.label).toLowerCase()).toContain("churn");
  return node as typeof node & Record<string, unknown>;
}

describe("declared_scale carriage from claim.value_scale", () => {
  it("reaches the NODE level, which is what schema-v3.ts:660 reads", () => {
    const node = churnNode(RECORDS);
    expect((node as { declared_scale?: unknown }).declared_scale).toBe("unit_interval");
  });

  it("reaches observed_state, which is the PUBLISHED carrier", () => {
    const node = churnNode(RECORDS);
    const os = (node as { observed_state?: Record<string, unknown> }).observed_state;
    expect(os, "observed_state must exist for the published carrier to be readable").toBeDefined();
    expect(os?.declared_scale).toBe("unit_interval");
  });

  it("THE TWO CARRIERS AGREE — trap 21, they do not get to drift", () => {
    const node = churnNode(RECORDS);
    const atNode = (node as { declared_scale?: unknown }).declared_scale;
    const atObserved = (node as { observed_state?: Record<string, unknown> }).observed_state
      ?.declared_scale;
    // Pin the precondition: both must be PRESENT, or "they agree" is satisfied
    // vacuously by two undefineds — a guard agreeing with itself (trap 13b).
    expect(atNode).toBeDefined();
    expect(atObserved).toBeDefined();
    expect(atNode).toBe(atObserved);
  });

  it("ABSENCE STAYS ABSENCE — an undeclared claim stamps nothing", () => {
    // The contract's failure semantics are permissive BY DESIGN: *"A consumer
    // MUST NOT treat absence as `unit_interval`: that is the unsound guess
    // 2.193 exists to retire."* So a v9-shaped claim must leave the field unset
    // on BOTH carriers — not defaulted, not inferred from the magnitude. This is
    // the case that makes the change safe for every graph drafted before v10.
    const undeclared: DraftRecordSet = {
      ...RECORDS,
      claims: [
        { claim_kind: "factor", label: CHURN, value: 0.04, unit: "%" },
        ...RECORDS.claims.slice(1),
      ],
    };
    const node = churnNode(undeclared);
    expect((node as { declared_scale?: unknown }).declared_scale).toBeUndefined();
    const os = (node as { observed_state?: Record<string, unknown> }).observed_state;
    expect(os?.declared_scale).toBeUndefined();
  });

  it("DECLARED WITHOUT A VALUE still stamps — the 21-of-22 case v9 nearly missed", () => {
    // v9's unit carriage sat inside `typeof claim.value === "number"` and was a
    // no-op for 21 of 22 real factor claims. `declared_scale` describes the
    // FACTOR'S SCALE, not one number, so it must survive a claim with no value
    // — and that is precisely the `prior`-path case where the only live reader
    // sits. A regression here would repeat v9's defect one field along.
    const noValue: DraftRecordSet = {
      ...RECORDS,
      claims: [
        { claim_kind: "factor", label: CHURN, unit: "%", value_scale: "unit_interval" },
        ...RECORDS.claims.slice(1),
      ],
    };
    const node = churnNode(noValue);
    expect((node as { declared_scale?: unknown }).declared_scale).toBe("unit_interval");
  });
});
