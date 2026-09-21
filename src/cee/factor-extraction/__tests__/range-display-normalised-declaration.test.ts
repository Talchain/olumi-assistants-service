/**
 * A PRODUCER'S `unit_interval` DECLARATION IS A FACT ABOUT THE NUMBER, NOT
 * ABOUT THE UNIT TOKEN — SO IT MUST BE HONOURED FOR EVERY UNIT, NOT ONLY '%'.
 *
 * ── THE WITNESS ────────────────────────────────────────────────────────────
 * Deployed CEE staging `d536aae`, 21 Sep 2026, guest session, scenario
 * `914266c1`, beat 1 FRESH. Raw capture:
 * `output/journey-witness-20260921/beat1-brief.json`.
 *
 * The brief said, verbatim: *"Our net revenue retention is currently 104%."*
 * The stored factor `13d88bbb` shipped:
 *
 *     { kind: "factor", label: "Net Revenue Retention", category: "external",
 *       scale_frame: 2,
 *       prior: { distribution: "uniform", range_min: 0.26, range_max: 0.78 },
 *       display_value: "0.26 to 0.78 ratio" }
 *
 * and, one field away on the same response,
 * `analysis_ready.model_adjustments[…].before = 1.04` — the magnitude the
 * bounds were derived from.
 *
 * ── WHY THE NUMBERS ARE WHAT THEY ARE (reproduced by execution at this HEAD) ─
 *   1. the drafter emits `value: 1.04, unit: "ratio"` — the encoding the live
 *      draft prompt mandates ("NRR 110% -> 1.10", `defaults-v187.ts:299`);
 *   2. pass 3d frames it — `deriveFactorScaleFrame([1.04], "ratio") === 2`,
 *      the {1,2,5}x10^k ladder, because "ratio" is not a percent-class unit —
 *      and writes `{ value: 0.52, raw_value: 1.04, scale_frame: 2 }`
 *      (`draft/records/projector.ts:4286-4315`);
 *   3. the factor has no inbound option->factor edge, so
 *      `handleUnreachableFactors` deletes `data.value`, stamps
 *      `declared_scale: "unit_interval"`, promotes `unit: "ratio"` to the node,
 *      and synthesises `margin = max(0.1, 0.52*0.5) = 0.26` -> `[0.26, 0.78]`;
 *   4. THIS FUNCTION then renders those normalised bounds beside the user's
 *      unit word.
 *
 * Step 4 is the only step this suite is about. Steps 1-3 are pinned elsewhere
 * and are deliberately NOT relitigated here.
 *
 * ── WHY THE FIX KEYS ON THE DECLARATION, NOT ON A UNIT LIST ────────────────
 * This function already declines exactly this shape for two unit families,
 * each after a measured capture: currency (`display-value.ts`, row 2.1207,
 * "£0.2 to £0.6" against a stated £120,000) and time (19 Sep 2026,
 * "0.45 to 1 months" against a stated 18 months). Its own comment names the
 * reason a THIRD enumeration is the wrong move:
 *
 *   *"A blanket 'every real-world unit' predicate would need a hand-maintained
 *   exclusion list for the units that GENUINELY live in [0,1] — `scale`,
 *   `index`, `probability` — which is the mirror this estate keeps paying for."*
 *
 * Keying on `declared_scale` has no such list, and the reason is a property of
 * the producer rather than a preference: `declaredScaleOf`
 * (`repair/unreachable-factors.ts:318-382`) returns `unit_interval` ONLY on
 * NORMALISATION EVIDENCE — a cap, or a `raw_value` that differs from `value`.
 * A genuine sub-unit quantity has neither, so it is never declared and this
 * limb can never fire on it. That is asserted below against the real producer,
 * not argued (see "the exclusion list is unnecessary" block).
 *
 * ── WHERE THE ORACLE COMES FROM (trap 13c) ─────────────────────────────────
 * EXTERNAL: the `"0.26 to 0.78 ratio"` / `1.04` / `scale_frame: 2` figures are
 * read off the banked deployed capture named above, not authored here. The
 * contract's definition of `unit_interval` — *"a proportion or a cap-normalised
 * magnitude"* — is quoted by `display-value.ts` itself.
 * MINE: the expectation that the honest answer is to DECLINE. It is taken from
 * this function's own two ratified precedents, which state the trade in terms:
 * *"rendering it -> a LIE about a number the user never wrote; declining it ->
 * a DEGRADATION the receipt already discloses."*
 *
 * ── WHAT THIS SUITE DOES NOT CLAIM ─────────────────────────────────────────
 * Nothing about the UI. Nothing about whether widening a stated point estimate
 * into a +/-50% prior is right — that is a RULING (`239d7809`) and is out of
 * scope. This suite is about one string.
 */

import { describe, it, expect } from "vitest";
import { synthesiseRangeDisplayValue } from "../display-value.js";
import { handleUnreachableFactors } from "../../unified-pipeline/stages/repair/unreachable-factors.js";
import type { GraphT } from "../../../schemas/graph.js";

/** The witnessed prior, verbatim from the capture. */
const WITNESSED_PRIOR = {
  distribution: "uniform",
  range_min: 0.26,
  range_max: 0.78,
} as const;

/**
 * A factor with no inbound `option->factor` edge — the precondition
 * `handleUnreachableFactors` acts on — whose `data` the caller supplies, so
 * each test states its own producer-side facts.
 */
function unreachableFactor(data: Record<string, unknown>): GraphT {
  return {
    nodes: [
      { id: "goal_x", kind: "goal", label: "Goal" },
      { id: "dec_x", kind: "decision", label: "Decision" },
      { id: "opt_x", kind: "option", label: "Option" },
      { id: "out_x", kind: "outcome", label: "ARR Growth" },
      {
        id: "fac_nrr",
        kind: "factor",
        label: "Net Revenue Retention",
        category: "observable",
        data,
      },
    ],
    edges: [
      { from: "dec_x", to: "opt_x", edge_type: "structural" },
      { from: "opt_x", to: "goal_x", edge_type: "causal" },
      { from: "fac_nrr", to: "out_x", edge_type: "causal" },
      { from: "out_x", to: "goal_x", edge_type: "causal" },
    ],
  } as unknown as GraphT;
}

function factorNode(graph: GraphT, id: string): Record<string, unknown> {
  return (graph as unknown as { nodes: Record<string, unknown>[] }).nodes.find(
    (n) => n.id === id,
  ) as Record<string, unknown>;
}

describe("a declared unit_interval prior is not rendered beside a user-scale unit", () => {
  it("THE WITNESS: the deployed NRR pair renders nothing instead of '0.26 to 0.78 ratio'", () => {
    expect(
      synthesiseRangeDisplayValue(WITNESSED_PRIOR, "ratio", undefined, "unit_interval"),
    ).toBeUndefined();
  });

  /**
   * The producer half, PINNED IN-TEST rather than assumed (trap 13b: a guard
   * whose discrimination depends on a fixture nothing pins is a guard agreeing
   * with itself). If `handleUnreachableFactors` ever stops stamping
   * `unit_interval` on this shape, or stops promoting the unit, the test above
   * is testing a pair the product no longer produces — and this REDs.
   */
  it("the producer really does stamp unit_interval and promote the unit on the witnessed shape", () => {
    const graph = unreachableFactor({
      value: 0.52,
      raw_value: 1.04,
      unit: "ratio",
      extractionType: "inferred",
    });
    handleUnreachableFactors(graph, "edge_type" as never);
    const node = factorNode(graph, "fac_nrr");

    expect(node.declared_scale).toBe("unit_interval");
    expect(node.unit).toBe("ratio");
    expect(node.prior).toEqual(WITNESSED_PRIOR);
    // And the display of THAT node's own pair is the string the user read.
    expect(
      synthesiseRangeDisplayValue(
        node.prior as typeof WITNESSED_PRIOR,
        node.unit as string,
        undefined,
        node.declared_scale as string,
      ),
    ).toBeUndefined();
  });

  /**
   * ⭐ DISCRIMINATING PAIR (trap 19) — the limb must bind to the DECLARATION,
   * never to the unit token. Loosening it for every "ratio" unit would pass
   * the witness above and fail this.
   *
   * ⚠ ABSENCE MUST NOT DEFAULT. The contract's failure semantics are explicit
   * that a consumer may not read an absent `declared_scale` as `unit_interval`.
   * An undeclared pair therefore keeps today's behaviour exactly.
   */
  it("NEGATIVE HALF: the same bounds and the same unit, UNDECLARED, still render", () => {
    expect(
      synthesiseRangeDisplayValue(WITNESSED_PRIOR, "ratio", undefined, undefined),
    ).toBe("0.26 to 0.78 ratio");
  });

  it("NEGATIVE HALF: a raw_count declaration still renders — those bounds ARE on the unit's scale", () => {
    expect(
      synthesiseRangeDisplayValue(WITNESSED_PRIOR, "ratio", undefined, "raw_count"),
    ).toBe("0.26 to 0.78 ratio");
  });

  /**
   * The '%' branch is the one place the declaration was ALREADY read, and it
   * de-normalises rather than declining. That behaviour is ratified and must
   * not move: declining a decided pair is the gap-harm this function's own
   * comment names.
   */
  it("NEGATIVE HALF: a '%' unit keeps its declared x100 de-normalisation", () => {
    expect(
      synthesiseRangeDisplayValue(WITNESSED_PRIOR, "%", undefined, "unit_interval"),
    ).toBe("26% to 78%");
  });

  /**
   * ⚠ MAGNITUDE, NOT SIGN, AND ONLY INSIDE THE NORMALISED DOMAIN — the same
   * bound the currency and time limbs already use. A real-scale range is
   * evidence about its own scale and renders exactly as before, whatever a
   * stale declaration says.
   */
  /**
   * ⚠ MAGNITUDE, NOT SIGN — and this case exists because a mutant PROVED the
   * earlier suite could not see it. Replacing `Math.abs(rangeMin!) <= 1` with
   * `rangeMin! <= 1` SURVIVED all six preceding tests: every bound in them is
   * non-negative, so the asymmetry was invisible. A corpus with the same
   * asymmetry as the code is a guard agreeing with itself (trap 13d), and this
   * is the exact shape that cost CEE #891 a 100,000x suppression.
   *
   * A bound of -5 is OUTSIDE the normalised magnitude domain, so it is
   * real-scale evidence and must render whatever a stale declaration says. The
   * unsigned predicate would read it as "within the domain" and silently
   * suppress a real range — a GAP traded for the LIE this limb closes, which is
   * the trade trap 22b exists to forbid.
   */
  it("NEGATIVE HALF: a bound below -1 is out of domain by MAGNITUDE and still renders", () => {
    expect(
      synthesiseRangeDisplayValue(
        { distribution: "uniform", range_min: -5, range_max: 0.8 },
        "ratio",
        undefined,
        "unit_interval",
      ),
    ).toBe("-5 to 0.8 ratio");
  });

  it("NEGATIVE HALF: a real-scale range outside the normalised domain still renders", () => {
    expect(
      synthesiseRangeDisplayValue(
        { distribution: "uniform", range_min: 3, range_max: 18 },
        "months",
        undefined,
        "unit_interval",
      ),
    ).toBe("3 to 18 months");
  });

  /**
   * ⭐⭐ THE EXCLUSION LIST IS UNNECESSARY, AND THIS DEMONSTRATES IT RATHER THAN
   * ASSERTING IT.
   *
   * `display-value.ts` declined to add a counts limb because a blanket
   * real-world-unit predicate would need a hand-maintained list of the units
   * that genuinely live in [0,1] ("scale", "index", "probability"). Keying on
   * the declaration needs no such list: a genuine sub-unit quantity carries
   * `raw_value === value` and no cap, which is exactly the shape
   * `declaredScaleOf` refuses to declare. Driven through the REAL producer.
   */
  it("a genuine sub-unit quantity is never DECLARED, so this limb cannot reach it", () => {
    const graph = unreachableFactor({
      value: 0.4,
      raw_value: 0.4, // un-normalised: raw === value, and no cap
      unit: "probability",
      extractionType: "inferred",
    });
    handleUnreachableFactors(graph, "edge_type" as never);
    const node = factorNode(graph, "fac_nrr");

    expect(node.declared_scale).toBeUndefined();
    expect(
      synthesiseRangeDisplayValue(
        node.prior as typeof WITNESSED_PRIOR,
        "probability",
        undefined,
        node.declared_scale as string | undefined,
      ),
    ).toBe("0.2 to 0.6 probability");
  });
});

/**
 * ⛔⛔ THE ROWED TERRITORY THIS LIMB STAYS OUT OF.
 *
 * `range-display-declared-scale.test.ts` PINS the answer for a divergent
 * percent spelling — *"a declared scale does NOT rescue a divergent spelling:
 * the gap is in the PREDICATE, not the scale"* — and sizes the real repair
 * beside it (three gates here, two on the point-estimate path, plus a
 * qualifier decision). That lane recorded the size and declined to do it
 * inline. This limb must therefore leave every percent-class spelling exactly
 * where it found it: sweeping them into a DECLINE would look like progress and
 * would silently move a pin written to hand the next lane that size.
 *
 * Pinned here as well as there, because the coupling is invisible from this
 * file otherwise — a later widening of this predicate REDs in two places.
 */
describe("percent-class spellings are left in their rowed state", () => {
  const PERCENT_CLASS_SPELLINGS = ["percent", "per cent", "pct", "percentage", "% NRR"] as const;

  it("a declared unit_interval does not make a percent-class spelling decline", () => {
    const declined = PERCENT_CLASS_SPELLINGS.filter(
      (u) =>
        synthesiseRangeDisplayValue(
          { distribution: "uniform", range_min: 0.2, range_max: 0.8 },
          u,
          undefined,
          "unit_interval",
        ) === undefined,
    );
    expect(declined).toEqual([]);
  });

  /**
   * CONTRAST CONTROL — without it the assertion above could pass because the
   * limb is inert for every unit, and it would still read green (trap 13b).
   */
  it("CONTRAST CONTROL: the same bounds on a non-percent unit DO decline", () => {
    expect(
      synthesiseRangeDisplayValue(
        { distribution: "uniform", range_min: 0.2, range_max: 0.8 },
        "ratio",
        undefined,
        "unit_interval",
      ),
    ).toBeUndefined();
  });
});
