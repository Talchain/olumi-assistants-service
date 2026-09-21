/**
 * A PRODUCER'S `unit_interval` DECLARATION IS A FACT ABOUT THE NUMBER, NOT
 * ABOUT THE UNIT TOKEN — BUT THE WORD ALONE DOES NOT SAY *WHICH* PRODUCER SAID
 * IT, AND THE THREE PRODUCERS DO NOT AGREE ON WHAT IT MEANS.
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
 *   1. the drafter emits `value: 1.04, unit: "ratio"`. ⚠ THE VALUE ENCODING IS
 *      MANDATED; THE UNIT TOKEN IS NOT, AND AN EARLIER VERSION OF THIS BLOCK
 *      SAID IT WAS. `src/prompts/defaults-v187.ts:346` and `:453` read
 *      *"NRR 110% -> value: 1.10, raw_value: 110, **unit: \"%\"**"*. So the
 *      witness's `"ratio"` is a DEPARTURE from the instruction, not compliance
 *      with it. (The previously cited `:299` is *"Produce 2-6 options total."*
 *      — a stale pointer inherited from `unreachable-factors.ts:183`. And
 *      `defaults-v187.ts` is NOT the served text: the served draft prompt is
 *      PMS-delivered `draft_graph_default@v202`, so every statement here about
 *      v187 is a statement about THAT FILE AT THIS TIP.);
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
 * ── THE CLAIM THIS SUITE USED TO MAKE WAS FALSE, AND IT DELETED A CORRECT
 *    DISPLAY. WITHDRAWN TEXT, KEPT VERBATIM SO IT IS NOT RE-DERIVED ──────────
 *
 *   ~~Keying on `declared_scale` has no such list … `declaredScaleOf`
 *   (`repair/unreachable-factors.ts:318-382`) returns `unit_interval` ONLY on
 *   NORMALISATION EVIDENCE — a cap, or a `raw_value` that differs from
 *   `value`. A genuine sub-unit quantity has neither, so it is never declared
 *   and this limb can never fire on it. That is asserted below against the
 *   real producer, not argued.~~
 *
 * The statement about `declaredScaleOf` is true. The statement about the LIMB
 * was false, and the demonstration that "proved" it drove ONE OF THREE writers
 * — the one whose semantics agree with the claim — from a hand-built node the
 * refuting writer never touched. A self-authored fixture confirms the author's
 * model of the producer rather than testing it, and a title asserting a
 * universal over a domain the fixture cannot sample is a guard agreeing with
 * itself (traps 13b / 13d / 16-inverse).
 *
 * MEASURED through `projectRecordsToGraph` -> `handleUnreachableFactors` ->
 * `transformNodeToV3` on `{value: 0.4, unit: "share", value_scale:
 * "unit_interval"}`: `"0.2 to 0.6 share"` at the merge-base, ABSENT at the
 * first version of this limb. Identically for `proportion`, `fraction`,
 * `rate`, `ratio`, `index`. And the harm COMPOUNDS — repair has already
 * deleted `data.value`, so the factor then carries no value and no range.
 *
 * ── THE THREE WRITERS, EACH DRIVEN BY EXECUTION BELOW ───────────────────────
 *   W1 `draft/records/projector.ts:3402` — `node.declared_scale =
 *      claim.value_scale`, THE MODEL'S OWN WORD. The served, UNGATED
 *      instruction (`draft/records/instruction.ts:291`, pushed unconditionally
 *      at `adapters/llm/anthropic.ts:525`) defines the member to the model as
 *      *"`unit_interval` for a **share** or a bounded percentage written as a
 *      decimal"*. Nothing is normalised. The bounds ARE on the unit's scale.
 *   W2 `draft/records/projector.ts:4317` — pass 3d's legitimising overwrite.
 *      Normalisation-backed, and it runs ONLY inside `if (frame !== undefined)`
 *      — i.e. only when the magnitudes EXCEEDED 1, which is precisely NOT the
 *      sub-unit case.
 *   W3 `repair/unreachable-factors.ts` — `declaredScaleOf`, which ABSTAINS on
 *      a genuine sub-unit quantity rather than CLEARING W1's declaration. That
 *      abstention is why W1's word survives all the way to the display.
 *
 * ── THE FIX: ASK THE EVIDENCE, NOT THE WORD ────────────────────────────────
 * `synthesiseRangeDisplayValue` now takes `boundsAreNormalised`, derived by
 * `transforms/schema-v3.ts` from the node's own producer-side facts:
 * `declared_scale_basis === "normalisation"` (stamped by W3 at the one moment
 * the evidence is still complete), `scale_frame` (W2), a `cap`, or a
 * `raw_value` that DIFFERS from the stored value. Absence FAILS OPEN to
 * pre-2.1208 behaviour, so the predicate can only ever under-suppress: a gap
 * is a degradation, the render is a LIE, and trap 22b forbids them sharing one
 * window.
 *
 * ── WHERE THE ORACLE COMES FROM (trap 13c) ─────────────────────────────────
 * EXTERNAL: the `"0.26 to 0.78 ratio"` / `1.04` / `scale_frame: 2` figures are
 * read off the banked deployed capture named above, not authored here. The
 * contract's definition of `unit_interval` — *"a proportion or a cap-normalised
 * magnitude"* — is quoted by `display-value.ts` itself. The *"a share"*
 * sentence is read off `instruction.ts` at this tip.
 * MINE: the expectation that the honest answer is to DECLINE a normalised
 * pair. It is taken from this function's own two ratified precedents:
 * *"rendering it -> a LIE about a number the user never wrote; declining it ->
 * a DEGRADATION the receipt already discloses."*
 *
 * ── WHAT THIS SUITE DOES NOT CLAIM ─────────────────────────────────────────
 * Nothing about the UI. Nothing about whether widening a stated point estimate
 * into a +/-50% prior is right — that is a RULING (`239d7809`) and is out of
 * scope. Nothing about the RATE at which the model declares `unit_interval`
 * with a non-percent unit: no banked artefact in this estate contains a
 * model-emitted draft-record `value_scale`, so the harm is proven REACHABLE BY
 * CONSTRUCTION and is deliberately not priced. This suite is about one string.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { synthesiseRangeDisplayValue } from "../display-value.js";
import { handleUnreachableFactors } from "../../unified-pipeline/stages/repair/unreachable-factors.js";
import { projectRecordsToGraph } from "../../draft/records/projector.js";
import { transformNodeToV3 } from "../../transforms/schema-v3.js";
import type { DraftRecordSet } from "../../draft/records/grammar.js";
import type { GraphT } from "../../../schemas/graph.js";

/** The witnessed prior, verbatim from the capture. */
const WITNESSED_PRIOR = {
  distribution: "uniform",
  range_min: 0.26,
  range_max: 0.78,
} as const;

/** Normalisation evidence present — the witnessed NRR node's state. */
const NORMALISED = true;
/** No normalisation evidence — a genuine model-declared share. */
const NOT_NORMALISED = false;

/**
 * A factor with no inbound `option->factor` edge — the precondition
 * `handleUnreachableFactors` acts on — whose `data` the caller supplies, so
 * each test states its own producer-side facts.
 *
 * ⚠ SCOPED: this drives W3 AND the V3 transform, and NOTHING ELSE. It starts
 * from a node object the projector never touched, so it says nothing whatever
 * about W1 or W2. `realChain` below is what exercises those.
 */
function unreachableFactor(
  data: Record<string, unknown>,
  nodeLevel: Record<string, unknown> = {},
): GraphT {
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
        ...nodeLevel,
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

/**
 * ⭐⭐ THE REAL CHAIN, ALL THREE WRITERS IN ORDER — draft projection, repair,
 * V3 transform. This is the instrument the previous version of this suite did
 * not have, and its absence is the entire reason a correct display was deleted.
 *
 * It also pins the WIRING by identity: `boundsAreNormalised` is derived inside
 * `transforms/schema-v3.ts`, so a caller that stops passing it makes every
 * DECLINE below render, and REDs here rather than shipping silently.
 */
function realChain(claim: Record<string, unknown>) {
  const records = {
    stated_items: [
      { kind: "goal", source_quote: "grow enterprise revenue next year" },
      { kind: "option", source_quote: "hire two enterprise account executives" },
    ],
    claims: [
      claim,
      {
        claim_kind: "causal_link",
        label: "bears on the goal",
        from_claim: 0,
        to_stated: 0,
        effect: "positive",
      },
    ],
  } as unknown as DraftRecordSet;

  const { graph } = projectRecordsToGraph(records);
  const factors = (graph as unknown as { nodes: Record<string, unknown>[] }).nodes.filter(
    (n) => n.kind === "factor",
  );
  // Pin the precondition (trap 13b): exactly one factor, or every assertion
  // below is about a node this fixture did not mean.
  expect(
    factors.length,
    "exactly one factor must be projected, or every assertion below is vacuous",
  ).toBe(1);
  const afterProjection = { ...factors[0] } as Record<string, unknown>;

  handleUnreachableFactors(graph as never, "edge_type" as never);
  const afterRepair = factorNode(graph as unknown as GraphT, String(afterProjection.id));
  const wire = transformNodeToV3(afterRepair as never, new Set()) as unknown as Record<
    string,
    unknown
  >;
  return { afterProjection, afterRepair, wire };
}

// ---------------------------------------------------------------------------
// The limb must not delete a CORRECT display (the adversarial review's Blocker 1)
// ---------------------------------------------------------------------------

describe("W1 — the MODEL's own `unit_interval` is a share, and its display must survive", () => {
  const SUB_UNIT_SPELLINGS = ["share", "proportion", "fraction", "rate", "ratio", "index"] as const;

  it.each(SUB_UNIT_SPELLINGS)(
    "a model-declared sub-unit quantity in '%s' still renders its band",
    (unit) => {
      const { afterProjection, afterRepair, wire } = realChain({
        claim_kind: "factor",
        label: "Enterprise share of ARR",
        value: 0.4,
        unit,
        value_scale: "unit_interval",
      });

      // PIN THE PRECONDITIONS, or this passes for the wrong reason: W1 must
      // really have declared, and no normalisation evidence may exist anywhere.
      expect(
        afterProjection.declared_scale,
        "W1 must stamp the model's word, or this is not the case under test",
      ).toBe("unit_interval");
      expect(afterRepair.declared_scale).toBe("unit_interval");
      expect(afterRepair.scale_frame, "W2 must NOT have framed a sub-unit value").toBeUndefined();
      expect(afterRepair.cap).toBeUndefined();
      expect(afterRepair.raw_value).toBeUndefined();
      expect(
        afterRepair.declared_scale_basis,
        "W3 must have ABSTAINED — it stamps no normalisation basis here",
      ).toBeUndefined();

      expect(wire.display_value).toBe(`0.2 to 0.6 ${unit}`);
    },
  );

  it("the quantity the OLD demonstration used IS declared once the projector runs", () => {
    // The old test's own fixture data — value 0.4, unit "probability" — put
    // through the writer it never invoked. Its title said this is "never
    // DECLARED". It is.
    const { afterProjection, wire } = realChain({
      claim_kind: "factor",
      label: "Probability of renewal",
      value: 0.4,
      unit: "probability",
      value_scale: "unit_interval",
    });
    expect(afterProjection.declared_scale).toBe("unit_interval");
    expect(wire.display_value).toBe("0.2 to 0.6 probability");
  });

  /**
   * ⚠ PRESENCE OF `raw_value` IS NOT EVIDENCE — IT MUST DIFFER, and after
   * repair there may be nothing left to compare it against. A model that emits
   * `{value: 0.4, raw_value: 0.4}` has normalised NOTHING (`declaredScaleOf`
   * agrees and abstains), so no basis is stamped and the band must still
   * render. A derivation keyed on `raw_value !== undefined` alone would
   * re-open the whole defect on this shape.
   */
  it("a declared share whose raw_value EQUALS its value still renders — presence is not evidence", () => {
    const graph = unreachableFactor(
      { value: 0.4, raw_value: 0.4, unit: "share", extractionType: "inferred" },
      { declared_scale: "unit_interval" },
    );
    handleUnreachableFactors(graph, "edge_type" as never);
    const node = factorNode(graph, "fac_nrr");
    expect(node.declared_scale, "W1's word survives — W3 abstains, it does not clear").toBe(
      "unit_interval",
    );
    expect(node.declared_scale_basis).toBeUndefined();
    expect(node.raw_value, "the precondition: raw_value IS present at node level").toBe(0.4);
    expect(node.observed_state, "and nothing survives to compare it against").toBeUndefined();

    const wire = transformNodeToV3(node as never, new Set()) as unknown as Record<string, unknown>;
    expect(wire.display_value).toBe("0.2 to 0.6 share");
  });

  it("a model declaration with NO normalisation evidence renders at the formatter too", () => {
    expect(
      synthesiseRangeDisplayValue(
        { distribution: "uniform", range_min: 0.2, range_max: 0.6 },
        "share",
        undefined,
        "unit_interval",
        NOT_NORMALISED,
      ),
    ).toBe("0.2 to 0.6 share");
  });

  /**
   * ⭐ DISCRIMINATING PAIR (trap 19) for the new conjunct: the SAME bounds, the
   * SAME unit, the SAME declaration — the only difference is the evidence.
   * Neither half alone shows the limb binds to the evidence; the pair does.
   */
  it("DISCRIMINATING TWIN: the identical pair WITH normalisation evidence declines", () => {
    expect(
      synthesiseRangeDisplayValue(
        { distribution: "uniform", range_min: 0.2, range_max: 0.6 },
        "share",
        undefined,
        "unit_interval",
        NORMALISED,
      ),
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The defect the PR exists to close — still closed
// ---------------------------------------------------------------------------

describe("a NORMALISED unit_interval prior is not rendered beside a user-scale unit", () => {
  it("THE WITNESS: the deployed NRR pair renders nothing instead of '0.26 to 0.78 ratio'", () => {
    expect(
      synthesiseRangeDisplayValue(WITNESSED_PRIOR, "ratio", undefined, "unit_interval", NORMALISED),
    ).toBeUndefined();
  });

  /**
   * W2 THROUGH THE REAL CHAIN. `value_scale: "raw_count"` is supplied so pass
   * 3d's legitimising overwrite (which only fires when a declaration already
   * exists) is genuinely exercised rather than assumed.
   */
  it("W2: pass 3d's overwrite reaches the display, and the display declines", () => {
    const { afterProjection, afterRepair, wire } = realChain({
      claim_kind: "factor",
      label: "Net Revenue Retention",
      value: 1.04,
      unit: "ratio",
      value_scale: "raw_count",
    });
    expect(
      afterProjection.declared_scale,
      "W2 must have OVERWRITTEN the model's raw_count, or this is not the case under test",
    ).toBe("unit_interval");
    expect(afterProjection.scale_frame, "the frame is the normalisation evidence").toBe(2);
    expect(afterRepair.prior).toEqual(WITNESSED_PRIOR);
    expect(wire.display_value).toBeUndefined();
  });

  it("W3: declaredScaleOf's own declaration reaches the display, and the display declines", () => {
    const { afterProjection, afterRepair, wire } = realChain({
      claim_kind: "factor",
      label: "Net Revenue Retention",
      value: 1.04,
      unit: "ratio",
    });
    expect(
      afterProjection.declared_scale,
      "the model declared NOTHING here — W3 is the writer under test",
    ).toBeUndefined();
    expect(afterRepair.declared_scale).toBe("unit_interval");
    expect(afterRepair.unit).toBe("ratio");
    expect(afterRepair.prior).toEqual(WITNESSED_PRIOR);
    expect(wire.display_value).toBeUndefined();
  });

  /**
   * ⭐⭐ THE SHAPE THAT DEFEATED THE FIRST DERIVATION, pinned so it cannot come
   * back. W3 declares on `raw_value !== value`, then `data` — and with it the
   * value — is deleted in the same function, so a consumer re-deriving the
   * evidence downstream holds `raw_value` and nothing to compare it against.
   * Measured: before `declared_scale_basis` existed this rendered
   * `"0.26 to 0.78 ratio"` again. The basis is stamped where the evidence is
   * still complete, and this is the test that says so.
   */
  it("W3 with NO surviving observed_state still declines — the BASIS carries it", () => {
    const graph = unreachableFactor({
      value: 0.52,
      raw_value: 1.04,
      unit: "ratio",
      extractionType: "inferred",
    });
    handleUnreachableFactors(graph, "edge_type" as never);
    const node = factorNode(graph, "fac_nrr");

    expect(
      node.observed_state,
      "the precondition: nothing survives to compare raw_value against",
    ).toBeUndefined();
    expect(node.data).toBeUndefined();
    expect(node.scale_frame, "and no frame either — the basis is the ONLY carrier").toBeUndefined();
    expect(node.declared_scale).toBe("unit_interval");
    expect(node.declared_scale_basis).toBe("normalisation");

    const wire = transformNodeToV3(node as never, new Set()) as unknown as Record<string, unknown>;
    expect(wire.display_value).toBeUndefined();
  });

  it("W3 declares on a CAP with the same basis, and that pair declines too", () => {
    const graph = unreachableFactor({
      value: 0.8,
      cap: 25000,
      raw_value: 20000,
      unit: "ratio",
      extractionType: "inferred",
    });
    handleUnreachableFactors(graph, "edge_type" as never);
    const node = factorNode(graph, "fac_nrr");
    expect(node.declared_scale).toBe("unit_interval");
    expect(node.declared_scale_basis).toBe("normalisation");
    const wire = transformNodeToV3(node as never, new Set()) as unknown as Record<string, unknown>;
    expect(wire.display_value).toBeUndefined();
  });

  /**
   * ⭐ `scale_frame` ALONE MUST STILL SUPPRESS — a CONSUMER-level pin, and its
   * scope is stated rather than implied.
   *
   * WHAT THIS PINS: that `transforms/schema-v3.ts` honours `scale_frame` as
   * normalisation evidence in its own right. Dropping that disjunct is
   * demonstrably NON-EQUIVALENT — measured on this exact node,
   * `undefined` pristine vs `"0.26 to 0.78 share"` mutated.
   *
   * ⚠ WHAT IT DOES NOT CLAIM: that the live draft chain produces a
   * `scale_frame`-only external factor. I probed for one and did NOT find it —
   * pass 3d writes `raw_value` whenever a baseline exists, and framing without
   * a baseline needs an option intervention, which is the very edge that makes
   * the factor REACHABLE and so stops it ever being reclassified as external.
   * The disjunct is kept as defence-in-depth for a real population the basis
   * cannot cover: graphs STORED BEFORE `declared_scale_basis` existed, which
   * carry `scale_frame` and no basis. It is a hand-built node on purpose, and
   * this comment is the honest label on it.
   */
  it("scale_frame alone is normalisation evidence at the consumer", () => {
    const node = {
      id: "fac_x",
      kind: "factor",
      label: "Enterprise share of ARR",
      category: "external",
      unit: "share",
      declared_scale: "unit_interval",
      scale_frame: 2,
      prior: WITNESSED_PRIOR,
      extractionType: "inferred",
    };
    const wire = transformNodeToV3(node as never, new Set()) as unknown as Record<string, unknown>;
    expect(wire.display_value).toBeUndefined();

    // CONTRAST CONTROL: the identical node WITHOUT the frame renders, so the
    // assertion above is the frame's doing and not the fixture failing to
    // reach the display path at all (trap 13b).
    const unframed = { ...node, scale_frame: undefined };
    const unframedWire = transformNodeToV3(unframed as never, new Set()) as unknown as Record<
      string,
      unknown
    >;
    expect(unframedWire.display_value).toBe("0.26 to 0.78 share");
  });

  /**
   * ⚠ THE BASIS IS NOT A SYNONYM FOR THE SCALE. `declaredScaleOf` also returns
   * `unit_interval` for a '%' unit inside [0,1] — and NOTHING was divided
   * there: "3% churn" arrives as 0.03 by the prompt's own encoding. Stamping
   * that as normalisation would be a manufactured attestation, so it is
   * `unit_convention` and no basis reaches the node.
   */
  it("a '%' declaration is UNIT CONVENTION, not normalisation — no basis is stamped", () => {
    const graph = unreachableFactor({
      value: 0.03,
      raw_value: 0.03,
      unit: "%",
      extractionType: "inferred",
    });
    handleUnreachableFactors(graph, "edge_type" as never);
    const node = factorNode(graph, "fac_nrr");
    expect(node.declared_scale).toBe("unit_interval");
    expect(node.declared_scale_basis).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Every conjunct of the predicate, pinned by its own case
// ---------------------------------------------------------------------------

describe("every conjunct of the limb is pinned by its own case", () => {
  /**
   * ⚠ ABSENCE MUST NOT DEFAULT. The contract's failure semantics are explicit
   * that a consumer may not read an absent `declared_scale` as `unit_interval`.
   */
  it("NEGATIVE HALF: the same bounds and the same unit, UNDECLARED, still render", () => {
    expect(
      synthesiseRangeDisplayValue(WITNESSED_PRIOR, "ratio", undefined, undefined, NORMALISED),
    ).toBe("0.26 to 0.78 ratio");
  });

  it("NEGATIVE HALF: a raw_count declaration still renders — those bounds ARE on the unit's scale", () => {
    expect(
      synthesiseRangeDisplayValue(WITNESSED_PRIOR, "ratio", undefined, "raw_count", NORMALISED),
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
      synthesiseRangeDisplayValue(WITNESSED_PRIOR, "%", undefined, "unit_interval", NORMALISED),
    ).toBe("26% to 78%");
  });

  /**
   * ⚠ MAGNITUDE, NOT SIGN — this case exists because a mutant PROVED the
   * earlier suite could not see it. Replacing `Math.abs(rangeMin!) <= 1` with
   * `rangeMin! <= 1` SURVIVED every preceding test: every bound in them was
   * non-negative, so the asymmetry was invisible. A corpus with the same
   * asymmetry as the code is a guard agreeing with itself (trap 13d), and this
   * is the exact shape that cost CEE #891 a 100,000x suppression.
   */
  it("NEGATIVE HALF: a bound below -1 is out of domain by MAGNITUDE and still renders", () => {
    expect(
      synthesiseRangeDisplayValue(
        { distribution: "uniform", range_min: -5, range_max: 0.8 },
        "ratio",
        undefined,
        "unit_interval",
        NORMALISED,
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
        NORMALISED,
      ),
    ).toBe("3 to 18 months");
  });

  /**
   * ⭐ SURVIVING MUTANT A, CLOSED. Dropping `unit !== undefined &&
   * unit.length > 0` survived the first kit: nothing pinned a unit-absent
   * declared pair. The shape is LIVE — the projector's own comment records a
   * real v202 draw, `Team Churn Rate {uniform, 0.02, 0.22}`, unit absent.
   *
   * It must RENDER, and the reason is the harm's definition rather than
   * defensiveness: the defect is normalised bounds WEARING THE USER'S OWN UNIT
   * WORD. With no unit word there is no false claim to make, so suppressing
   * there would be a pure degradation.
   */
  it("MUTANT A: a declared, normalised pair with NO unit still renders — no unit word to lie with", () => {
    expect(
      synthesiseRangeDisplayValue(
        WITNESSED_PRIOR,
        undefined,
        undefined,
        "unit_interval",
        NORMALISED,
      ),
    ).toBe("0.26 to 0.78");
  });

  it("MUTANT A: an EMPTY unit string is the same case and renders the same way", () => {
    expect(
      synthesiseRangeDisplayValue(WITNESSED_PRIOR, "", undefined, "unit_interval", NORMALISED),
    ).toBe("0.26 to 0.78");
  });

  /**
   * ⭐ SURVIVING MUTANT B, CLOSED. Dropping `(!hasMax || Math.abs(rangeMax!) <=
   * 1)` survived the first kit. A STRADDLING pair has a real-scale upper bound
   * — it is evidence about its own scale and must render whatever a stale
   * declaration says. Straddles are the exact class this estate has already
   * been burned by ("56% to 1.68%", "100% to 25%").
   */
  it.each([
    [{ distribution: "uniform", range_min: 0.5, range_max: 8 }, "0.5 to 8 ratio"],
    [{ distribution: "uniform", range_min: 0.26, range_max: 25 }, "0.26 to 25 ratio"],
  ])("MUTANT B: a straddling pair %j keeps its real-scale render", (prior, expected) => {
    expect(
      synthesiseRangeDisplayValue(
        prior as typeof WITNESSED_PRIOR,
        "ratio",
        undefined,
        "unit_interval",
        NORMALISED,
      ),
    ).toBe(expected);
  });

  /**
   * MUTANT B's opposite-direction twin, so closing the straddle gap cannot be
   * achieved by making the limb inert (trap 22b: every corpus case gets its
   * opposite-direction twin).
   */
  it("CONTRAST CONTROL: the same unit, both bounds INSIDE the domain, still declines", () => {
    expect(
      synthesiseRangeDisplayValue(
        { distribution: "uniform", range_min: 0.5, range_max: 0.8 },
        "ratio",
        undefined,
        "unit_interval",
        NORMALISED,
      ),
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Completeness: the writer census, DERIVED from the tree
// ---------------------------------------------------------------------------

/**
 * ⭐⭐ THE DEFECT THAT LET THE FIRST VERSION THROUGH WAS NOT A WRONG ASSERTION
 * — IT WAS A COMPLETE-SOUNDING ONE DRIVEN THROUGH ONE OF THREE PRODUCERS. A
 * corpus cannot certify a claim over writers it never invokes (trap 13d(c)),
 * and nothing in the suite noticed the other two existed.
 *
 * So the writer set is DERIVED from the tree rather than remembered, and this
 * REDs if a FOURTH writer appears — at which point the cases above are no
 * longer a complete demonstration and somebody must decide what the new writer
 * means by `unit_interval`.
 *
 * ⚠ ASSIGNMENT SITES ONLY. The object-literal companions
 * (`projector.ts:3405`'s `observed_state` spread and `schema-v3.ts`'s forward
 * of the node's existing value) are not independent writers — they carry a
 * value one of these lines already decided.
 */
describe("the writer census is derived, and REDs on a fourth writer", () => {
  const SRC = new URL("../../../../src", import.meta.url).pathname;

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === "__tests__" || entry === "node_modules") continue;
        walk(full, out);
      } else if (entry.endsWith(".ts")) {
        out.push(full);
      }
    }
    return out;
  }

  it("exactly the two producer files these tests drive, with their exact site counts", () => {
    const files = walk(SRC);
    expect(
      files.length,
      "the walk must find source files, or this census is vacuous",
    ).toBeGreaterThan(100);

    const byFile = new Map<string, number>();
    for (const f of files) {
      // `readFileSync` is byte-safe. `projector.ts` carries a deliberate NUL
      // sentinel that makes plain `grep` report ZERO matches inside it
      // (trap 17), so a shell-based census here would read a false absence.
      const text = readFileSync(f, "utf8");
      for (const line of text.split("\n")) {
        if (/\.declared_scale\s*=[^=]/.test(line)) {
          const rel = f.slice(SRC.length + 1);
          byFile.set(rel, (byFile.get(rel) ?? 0) + 1);
        }
      }
    }

    // POSITIVE CONTROL: the probe must be able to SEE a writer at all, or a
    // broken walk reads as "no writers anywhere" and agrees with everything.
    expect(byFile.size, "zero files means the probe stopped discriminating").toBeGreaterThan(0);

    expect(Object.fromEntries([...byFile].sort())).toEqual({
      "cee/draft/records/projector.ts": 3,
      "cee/unified-pipeline/stages/repair/unreachable-factors.ts": 1,
    });
  });
});

// ---------------------------------------------------------------------------
// The rowed territory this limb stays out of — and the residue, stated
// ---------------------------------------------------------------------------

/**
 * ⛔⛔ THE ROWED TERRITORY THIS LIMB STAYS OUT OF.
 *
 * `range-display-declared-scale.test.ts` PINS the answer for a divergent
 * percent spelling — *"a declared scale does NOT rescue a divergent spelling:
 * the gap is in the PREDICATE, not the scale"* — and sizes the real repair
 * beside it (three gates here, two on the point-estimate path, plus a
 * qualifier decision). That lane recorded the size and declined to do it
 * inline. This limb must therefore leave every percent-class spelling exactly
 * where it found it.
 *
 * ⚠⚠ AND THE RESIDUE IS MEASURED HERE RATHER THAN LEFT AS A SCOPE NOTE,
 * because "deliberately excluded to avoid moving a rowed pin" reads as
 * tidiness and this is not tidiness: SEVEN OF EIGHT PERCENT SPELLINGS STILL
 * RENDER THE IDENTICAL WRONG STRING, INCLUDING `"% NRR"` — the witness's own
 * metric name one keystroke away. The cause is a twin-predicate mismatch: this
 * limb excludes on `isPercentScaledUnit` (prefix-matching, wide) while the
 * de-normalisation branch gates on `unit === "%"` (exact, narrow), and
 * everything in the gap is excluded from the fix AND gets no compensation.
 */
describe("percent-class spellings are left in their rowed state, and the residue is measured", () => {
  const PERCENT_CLASS_SPELLINGS = [
    "% NRR",
    "percent",
    "per cent",
    "pct",
    "percentage",
    "percentage points",
    "pct NRR",
  ] as const;

  it("a declared unit_interval does not make a percent-class spelling decline", () => {
    const declined = PERCENT_CLASS_SPELLINGS.filter(
      (u) =>
        synthesiseRangeDisplayValue(
          { distribution: "uniform", range_min: 0.2, range_max: 0.8 },
          u,
          undefined,
          "unit_interval",
          NORMALISED,
        ) === undefined,
    );
    expect(declined).toEqual([]);
  });

  /**
   * ⭐ THE RESIDUE, PINNED AS AN EXACT SET (trap 22f's honest-gap discipline):
   * the suite stays green for the RIGHT reason and REDs if the set grows OR
   * shrinks. Seven spellings render normalised bounds beside a percent word;
   * `"%"` alone is compensated.
   */
  it("EXACTLY these seven spellings still render the defect, and '%' alone is compensated", () => {
    const rendered = Object.fromEntries(
      PERCENT_CLASS_SPELLINGS.map((u) => [
        u,
        synthesiseRangeDisplayValue(WITNESSED_PRIOR, u, undefined, "unit_interval", NORMALISED),
      ]),
    );
    expect(rendered).toEqual({
      "% NRR": "0.26 to 0.78 % NRR",
      percent: "0.26 to 0.78 percent",
      "per cent": "0.26 to 0.78 per cent",
      pct: "0.26 to 0.78 pct",
      percentage: "0.26 to 0.78 percentage",
      "percentage points": "0.26 to 0.78 percentage points",
      "pct NRR": "0.26 to 0.78 pct NRR",
    });
    expect(
      synthesiseRangeDisplayValue(WITNESSED_PRIOR, "%", undefined, "unit_interval", NORMALISED),
    ).toBe("26% to 78%");
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
        NORMALISED,
      ),
    ).toBeUndefined();
  });
});
