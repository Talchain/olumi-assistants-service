/**
 * ⭐⭐ THE FRAME PASS 3d DERIVES MUST REACH THE CANONICAL NODE.
 *
 * ── THE DEFECT THIS EXISTS TO CLOSE (measured on a real draft, CEE 5f2e3fd0) ─
 * Pass 3d derives ONE frame per factor from the baseline PLUS every option
 * intervention magnitude, divides all of them by it, and then THROWS THE FRAME
 * AWAY. On a factor the brief states no value for, nothing survives that
 * encodes it: `observed_state` is absent entirely, so the edit seam's
 * `recoverScaleFrame(raw_value / value)` has no pair to read.
 *
 *   brief: support cost — no value stated; options set it to £300,000/£400,000
 *   DRAFT: option levels [0.6, 0.8]   (frame 500,000)   observed_state: absent
 *   user types £600,000 → PERSISTED {value: 600000, raw_value: 600000}
 *   rerun → REFUSED, `baseline_scale_unresolved`   (wire-witnessed 3/3)
 *
 * The product advertises the action ("setting a real value would make this
 * result more trustworthy") and then declines to act on it.
 *
 * ── WHY THE FRAME IS PERSISTED RATHER THAN RE-DERIVED AT THE EDIT ───────────
 * ⚠ Re-deriving from the edited baseline ALONE is strictly worse than the
 * refusal it replaces, and this was measured, not reasoned (PR #1103, blocked
 * on review): `deriveFactorScaleFrame([600000], unit)` returns 1,000,000, so
 * the £600,000 status quo is written at level 0.6 — EQUAL to the £300,000
 * option and BELOW the £400,000 one. The model then believes the current
 * state is cheaper than both alternatives when it is dearer than both, and the
 * analysis recommends the wrong option with no refusal anywhere. 9 of 25
 * framings distorted the within-factor ratio, worst 100x. A visible refusal
 * became a silent wrong answer.
 *
 * The producer's own spec forbids it in four places — `projector.ts` ("one
 * deterministic frame, every magnitude divided by it, ratios preserved
 * exactly"; "within-factor ratios are exact"; edits land "on the SAME frame
 * the draft established … rather than a silent re-framing (which would
 * rescale every sibling intervention)") and `plot-intervention-scale.ts`
 * (the baseline "enters the linear sum" alongside its framed levels).
 *
 * ── WHY THIS TEST IS CARRIAGE-SHAPED, NOT A UNIT TEST ───────────────────────
 * ⭐ A NEW NODE FIELD SHIPS DARK IN THIS ESTATE BY DEFAULT. The draft pipeline
 * rebuilds nodes FIELD BY FIELD: `transforms/schema-v3.ts:250-259` had to name
 * `goal_threshold_frame` explicitly or it was dropped, and `schemas/assist.ts`
 * records that that stamp "nearly shipped dark on the node channel". Downstream
 * of that, CEE's `NodeV3` is a plain `z.object` — "declared fields only —
 * unknown fields stripped" — so an undeclared key is DELETED by
 * `GraphV3.safeParse` with no error anywhere.
 *
 * ⚠ AND IT IS NOT THE SHARED CONTRACT THAT STRIPS. Measured with a positive
 * control (`display_value`, declared on CEE's NodeV3, survives both):
 * `@talchain/schemas`' `NodeV3Schema` is `.passthrough()` and keeps unknown
 * keys; CEE's OWN `src/schemas/cee-v3.ts` `NodeV3` is what deletes them. Two
 * same-named `NodeV3`s — name the twin, or fix the wrong one.
 *
 * So this test walks the WHOLE chain a real draft walks — records → projector
 * → the internal draft-graph `Node` → `transformNodeToV3` → canonical `NodeV3`
 * — and asserts the frame arrives at each hop. A unit test on pass 3d would
 * pass while the field was deleted two hops later.
 *
 * ── EVERY ASSERTION BINDS BY IDENTITY, AND THE PRECONDITION IS PINNED ───────
 * The factor is found by its exact label and the option by its exact label
 * (trap 19: a value predicate another object could satisfy proves nothing).
 * The draft's own framed levels are asserted BEFORE the frame is checked, so a
 * fixture that quietly stopped exercising pass 3d could not make this test
 * agree for the wrong reason (trap 13b).
 */
import { describe, expect, it } from "vitest";
import { projectRecordsToGraph } from "../projector.js";
import { LLMDraftResponse } from "../../../../adapters/llm/shared-schemas.js";
import { transformNodeToV3 } from "../../../transforms/schema-v3.js";
import { NodeV3 } from "../../../../schemas/cee-v3.js";
import type { DraftRecordSet } from "../grammar.js";

/** The factor the brief states NO value for; the options set it to 300k/400k. */
const COST = "Annual support cost";
const IN_HOUSE = "keep support in house";

/** Draft frame for [300000, 400000]: smallest {1,2,5}·10^k strictly above 400000. */
const EXPECTED_FRAME = 500_000;

const RECORDS: DraftRecordSet = {
  stated_items: [
    { kind: "goal", source_quote: "keep customers happy without blowing the budget" },
    { kind: "option", source_quote: "outsource support to a third party" },
    { kind: "option", source_quote: IN_HOUSE },
  ],
  claims: [
    // NO `value` — this is the defect class: nothing to encode a frame in.
    { claim_kind: "factor", label: COST },
    { claim_kind: "factor", label: "Customer satisfaction", value: 0.7 },
    { claim_kind: "causal_link", label: "outsourcing sets support cost", from_stated: 1, to_claim: 0, effect: "negative", sets_to: 300000 },
    { claim_kind: "causal_link", label: "in-house sets support cost", from_stated: 2, to_claim: 0, effect: "positive", sets_to: 400000 },
    { claim_kind: "causal_link", label: "outsourcing moves satisfaction", from_stated: 1, to_claim: 1, effect: "negative", sets_to: 0.6 },
    { claim_kind: "causal_link", label: "in-house moves satisfaction", from_stated: 2, to_claim: 1, effect: "positive", sets_to: 0.8 },
    { claim_kind: "causal_link", label: "support cost bears on the goal", from_claim: 0, to_stated: 0, effect: "negative" },
    { claim_kind: "causal_link", label: "satisfaction bears on the goal", from_claim: 1, to_stated: 0, effect: "positive" },
  ],
};

/** A factor whose brief DOES state a value — pass 3d frames it from the
 *  baseline alone, so the pair encodes the frame and `recoverScaleFrame` can
 *  read it. Used to prove stored and recovered agree (trap 21: two authorities
 *  answering one question must not be allowed to drift). */
const BASELINE_BEARING: DraftRecordSet = {
  stated_items: [
    { kind: "goal", source_quote: "keep customers happy without blowing the budget" },
    { kind: "option", source_quote: "outsource support to a third party" },
    { kind: "option", source_quote: IN_HOUSE },
  ],
  claims: [
    { claim_kind: "factor", label: COST, value: 250000 },
    { claim_kind: "factor", label: "Customer satisfaction", value: 0.7 },
    { claim_kind: "causal_link", label: "outsourcing sets support cost", from_stated: 1, to_claim: 0, effect: "negative", sets_to: 300000 },
    { claim_kind: "causal_link", label: "in-house sets support cost", from_stated: 2, to_claim: 0, effect: "positive", sets_to: 400000 },
    { claim_kind: "causal_link", label: "outsourcing moves satisfaction", from_stated: 1, to_claim: 1, effect: "negative", sets_to: 0.6 },
    { claim_kind: "causal_link", label: "in-house moves satisfaction", from_stated: 2, to_claim: 1, effect: "positive", sets_to: 0.8 },
    { claim_kind: "causal_link", label: "support cost bears on the goal", from_claim: 0, to_stated: 0, effect: "negative" },
    { claim_kind: "causal_link", label: "satisfaction bears on the goal", from_claim: 1, to_stated: 0, effect: "positive" },
  ],
};

function draft(records: DraftRecordSet) {
  const { graph } = projectRecordsToGraph(records);
  const factor = graph.nodes.find((n) => n.label === COST);
  expect(factor, `fixture no longer projects a factor labelled "${COST}"`).toBeDefined();
  const option = graph.nodes.find((n) => n.kind === "option" && n.label === IN_HOUSE);
  expect(option, `fixture no longer projects an option labelled "${IN_HOUSE}"`).toBeDefined();
  return { graph, factor: factor!, option: option! };
}

describe("pass 3d persists the frame it derives", () => {
  it("the draft precondition holds: the option levels ARE framed, and the factor has no pair to recover from", () => {
    // PINNED IN-TEST. Without this, a fixture that stopped triggering pass 3d
    // would make every assertion below agree for the wrong reason.
    const { factor, option } = draft(RECORDS);
    const levels = (option.data as { interventions: Record<string, number> }).interventions;
    expect(levels[factor.id]).toBe(400_000 / EXPECTED_FRAME); // 0.8, not 400000
    expect(factor.observed_state).toBeUndefined(); // nothing encodes the frame
  });

  it("the factor carries `scale_frame` — the frame the option levels were divided by", () => {
    const { factor, option } = draft(RECORDS);
    const level = (option.data as { interventions: Record<string, number> }).interventions[factor.id]!;
    const frame = (factor as unknown as { scale_frame?: number }).scale_frame;
    expect(frame).toBe(EXPECTED_FRAME);
    // ⭐ THE INVARIANT IS THE SPEC, NOT THE ARITHMETIC. Bind the stored frame
    // to the sibling it must keep coherent: recovering the option's own raw
    // magnitude through it must return the magnitude the brief stated.
    expect(level * frame!).toBe(400_000);
  });

  it("a baseline-bearing factor's stored frame EQUALS the frame its own pair encodes", () => {
    // Two authorities on one question (trap 21). They agree by construction
    // today; nothing but this assertion stops them drifting apart.
    const { factor } = draft(BASELINE_BEARING);
    const pair = factor.observed_state as { value: number; raw_value: number };
    const recovered = pair.raw_value / pair.value;
    const stored = (factor as unknown as { scale_frame?: number }).scale_frame;
    expect(stored).toBe(recovered);
  });

  it("a factor pass 3d does NOT frame carries NO `scale_frame` — absence means never framed", () => {
    // The invariant the whole design rests on: the edit seam may treat an
    // absent frame as "this factor was never framed" rather than "the frame
    // was lost". Satisfaction is stated at 0.7 and moved to 0.6/0.8 — every
    // magnitude is already inside the unit interval, so pass 3d needs no frame.
    const { graph } = draft(RECORDS);
    const satisfaction = graph.nodes.find((n) => n.label === "Customer satisfaction")!;
    expect((satisfaction as unknown as { scale_frame?: number }).scale_frame).toBeUndefined();
  });
});

describe("the frame survives every hop to the canonical node", () => {
  it("the internal draft-graph consumer accepts the projection carrying the frame", () => {
    // If `Node` rejects the key the whole draft 400s — the wound `role` took.
    const { graph } = draft(RECORDS);
    const parsed = LLMDraftResponse.safeParse(graph);
    const issues = parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    expect(issues, `consumer rejected the framed projection: ${issues.join(" | ")}`).toEqual([]);
  });

  it("`transformNodeToV3` carries it across the field-by-field rebuild", () => {
    const { factor } = draft(RECORDS);
    const v3 = transformNodeToV3(factor as never);
    // CONTRAST CONTROL: a field known to survive this transform. If the
    // control fails, the probe is blind and the target's absence proves
    // nothing (trap 13e).
    expect(v3.label, "control: label must survive transformNodeToV3").toBe(COST);
    expect((v3 as unknown as { scale_frame?: number }).scale_frame).toBe(EXPECTED_FRAME);
  });

  it("`NodeV3.parse` does not strip it — the canonical state keeps the frame", () => {
    const { factor } = draft(RECORDS);
    const v3 = transformNodeToV3(factor as never);
    const parsed = NodeV3.safeParse(v3);
    expect(parsed.success, JSON.stringify(parsed.success ? {} : parsed.error.issues.slice(0, 3))).toBe(true);
    const out = parsed.data as unknown as Record<string, unknown>;
    // CONTRAST CONTROL first: `label` is declared, so it survives. `data` is
    // NOT declared and is stripped — the pair proves the parse discriminates
    // rather than keeping everything.
    expect(out.label, "control: a declared field must survive the parse").toBe(COST);
    expect(out.data, "control: an undeclared field must be stripped").toBeUndefined();
    expect(out.scale_frame).toBe(EXPECTED_FRAME);
  });
});
