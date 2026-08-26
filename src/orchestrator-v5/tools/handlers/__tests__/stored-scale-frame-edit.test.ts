/**
 * ⭐⭐ A USER WHO SETS A REAL VALUE GETS AN ANSWER, AND IT IS THE RIGHT ONE.
 *
 * ── THE DEFECT (wire-witnessed 3/3 on staging) ──────────────────────────────
 * Olumi tells the user "setting a real value or range would make this result
 * more trustworthy"; the user sets it; the canonical edit SUCCEEDS; the rerun
 * REFUSES with `baseline_scale_unresolved`. The product advertises an action
 * that terminates in refusal.
 *
 * Cause: pass 3d derives one frame per factor from the baseline PLUS every
 * option intervention magnitude and divides all of them by it — but a factor
 * the brief states no value for gets no `observed_state`, so the frame's only
 * surviving trace (`raw_value / value`) does not exist. Both baseline writers
 * fell back to a RAW write, and the analysis seam's baseline gate correctly
 * refused a raw magnitude sitting beside its own framed levels.
 *
 * ── ⚠ WHY THE OBVIOUS FIX IS WORSE THAN THE DEFECT ─────────────────────────
 * Deriving a frame from the EDITED BASELINE ALONE (PR #1103, blocked on
 * review) turns a visible refusal into a silent wrong answer:
 *
 *   DRAFTED option levels [0.6, 0.8]        (draft frame 500,000)
 *   user types £600,000 → deriveFactorScaleFrame([600000]) = 1,000,000
 *   PERSISTED {value: 0.6, raw_value: 600000}
 *   option "keep support in house"  raw £400,000  level 0.8
 *      TRUE ratio 1.50x   WIRE ratio 0.75x   → understated 2.00x
 *
 * The £600,000 status quo is written EQUAL to the £300,000 option and BELOW
 * the £400,000 one; the analysis then recommends the wrong option, with no
 * refusal anywhere. 9 of 25 framings distorted the ratio, worst 100x.
 *
 * ── THE ORACLE IS THE SPEC, NOT THE ARITHMETIC (trap 13d) ──────────────────
 * ⭐ The invariant below is `baseline.value / option.level ===
 * baseline.raw_value / option.raw` — RATIOS PRESERVED, which is what the
 * producer's own spec promises in four places and what the analysis actually
 * consumes (the baseline enters PLoT's linear sum alongside its framed levels).
 *
 * It is deliberately NOT "the framed level is inside [0,1]". #1103's guard
 * re-ran the scale gate on the framed pair, but the gate SKIPS `[0,1]` and
 * every ladder frame exceeds its own magnitude, so the framed level is always
 * in `(0,1]` — 138,927 magnitudes measured, ZERO outside. That guard tested
 * unit-interval membership and called it coherence: a postcondition that
 * cannot fail.
 *
 * ── AND THE OPTION LEVELS COME FROM A REAL DRAFT ───────────────────────────
 * ⭐ Every option level here is produced by `projectRecordsToGraph`, never
 * hand-authored. #1103's suite could not see its own defect because its
 * fixtures wrote option levels as `{value: 0.6}` = `600000/1e6` — PRE-FRAMED
 * on the very answer the code under test derives, so coherence held by
 * construction no matter what the code did. A fixture you wrote yourself is
 * not evidence about the wire.
 */
import { describe, expect, it } from "vitest";
import { projectRecordsToGraph } from "../../../../cee/draft/records/projector.js";
import { normaliseFactorValue } from "../d1-shared/normalise-factor-value.js";
import { resolveScaleFrame } from "../d1-shared/scale-frame.js";
import {
  reconcileObservedValuePair,
  findAmbiguousScaleValueOps,
} from "../../../../orchestrator/canonicalise-value-ops.js";
import {
  buildFactorScaleMap,
  decideAnalysisScaleBlock,
  findScaleIncoherentBaselineFactorIds,
  projectRequestInterventionsToWireScale,
} from "../../plot-intervention-scale.js";
import {
  ALLOWED_NODE_FIELD_ROOTS,
  checkFieldSafety,
} from "../../../graph-management/field-safety.js";
import { FIELD_NOT_ALLOWED } from "../../../graph-management/reason-codes.js";
import type { DraftRecordSet } from "../../../../cee/draft/records/grammar.js";

const COST = "Annual support cost";
const IN_HOUSE = "keep support in house";
const OUTSOURCE = "outsource support to a third party";
/** The magnitudes the brief states, verbatim. Every expectation derives from these. */
const IN_HOUSE_RAW = 400_000;
const OUTSOURCE_RAW = 300_000;
const USER_SETS = 600_000;

function records(costValue?: number): DraftRecordSet {
  return {
    stated_items: [
      { kind: "goal", source_quote: "keep customers happy without blowing the budget" },
      { kind: "option", source_quote: OUTSOURCE },
      { kind: "option", source_quote: IN_HOUSE },
    ],
    claims: [
      costValue === undefined
        ? { claim_kind: "factor", label: COST }
        : { claim_kind: "factor", label: COST, value: costValue },
      { claim_kind: "factor", label: "Customer satisfaction", value: 0.7 },
      { claim_kind: "causal_link", label: "outsourcing sets support cost", from_stated: 1, to_claim: 0, effect: "negative", sets_to: OUTSOURCE_RAW },
      { claim_kind: "causal_link", label: "in-house sets support cost", from_stated: 2, to_claim: 0, effect: "positive", sets_to: IN_HOUSE_RAW },
      { claim_kind: "causal_link", label: "outsourcing moves satisfaction", from_stated: 1, to_claim: 1, effect: "negative", sets_to: 0.6 },
      { claim_kind: "causal_link", label: "in-house moves satisfaction", from_stated: 2, to_claim: 1, effect: "positive", sets_to: 0.8 },
      { claim_kind: "causal_link", label: "support cost bears on the goal", from_claim: 0, to_stated: 0, effect: "negative" },
      { claim_kind: "causal_link", label: "satisfaction bears on the goal", from_claim: 1, to_stated: 0, effect: "positive" },
    ],
  };
}

/**
 * ⭐ THE RATIO ORACLE, AND WHY IT IS A TOLERANCE RATHER THAN `toBe`.
 *
 * "Ratios preserved exactly" is a claim about the ARITHMETIC, not about IEEE754
 * — `1.2 / 0.8` is `1.4999999999999998`, and pinning `toBe(1.5)` would fail a
 * correct implementation for a reason that has nothing to do with scale.
 *
 * ⚠ The tolerance is chosen to DISCRIMINATE, not to be safe (trap 22d — a guard
 * too slack to fail is the defect one level up). `1e-12` relative is ~4 orders
 * of magnitude tighter than the smallest distortion this suite exists to catch:
 * #1103's own worst case was 100x and its measured case 2x. `expectRatio` is
 * proved to bite on that exact value in the test below, so the tolerance is
 * demonstrated rather than asserted.
 */
function expectRatio(actual: number, expected: number): void {
  expect(Number.isFinite(actual)).toBe(true);
  expect(Math.abs(actual - expected) / Math.abs(expected)).toBeLessThan(1e-12);
}

/** A real draft, with every object bound BY IDENTITY (label), never by value. */
function realDraft(costValue?: number) {
  const { graph } = projectRecordsToGraph(records(costValue));
  const factor = graph.nodes.find((n) => n.label === COST);
  const option = graph.nodes.find((n) => n.kind === "option" && n.label === IN_HOUSE);
  expect(factor, `fixture no longer projects a factor labelled "${COST}"`).toBeDefined();
  expect(option, `fixture no longer projects an option labelled "${IN_HOUSE}"`).toBeDefined();
  const level = (option!.data as { interventions: Record<string, number> }).interventions[factor!.id];
  // ⭐ PRECONDITION PINNED IN-TEST (trap 13b). If the draft ever stopped
  // FRAMING this option — level === the raw magnitude — every ratio assertion
  // below would hold trivially and this suite would agree for the wrong reason.
  expect(level, "the draft must FRAME the option magnitude, or these tests are vacuous")
    .not.toBe(IN_HOUSE_RAW);
  expect(level).toBeGreaterThan(0);
  return { graph, factor: factor!, option: option!, level: level! };
}

/** The graph the analysis seam would see after the edit lands. */
function rerunVerdict(graph: { nodes: unknown[] }) {
  const perOption = (graph.nodes as { kind: string; data?: { interventions?: Record<string, number> } }[])
    .filter((n) => n.kind === "option")
    .map((o) => o.data?.interventions ?? {});
  const projection = projectRequestInterventionsToWireScale(perOption, buildFactorScaleMap(graph.nodes));
  return decideAnalysisScaleBlock(
    projection,
    findScaleIncoherentBaselineFactorIds(graph.nodes, perOption),
  );
}

describe("writer 1 — set_factor_value on a factor the brief gave no value", () => {
  it("⭐ preserves the within-factor ratio exactly against a REAL drafted option level", () => {
    const { factor, level } = realDraft();
    expect(factor.observed_state, "precondition: this factor has no pair to recover from")
      .toBeUndefined();

    const written = normaliseFactorValue({
      rawInput: USER_SETS,
      inputHasUnit: false,
      factorScaleFrame: (factor as unknown as { scale_frame?: number }).scale_frame!,
    });

    // THE SPEC: the wire ratio equals the ratio of the magnitudes the user and
    // the brief actually stated. Not "is a level", not "is inside [0,1]".
    expectRatio(written.value / level, written.raw_value / IN_HOUSE_RAW);
    expectRatio(written.value / level, USER_SETS / IN_HOUSE_RAW);

    // ⭐ THE ORACLE IS PROVED TO BITE, on the exact value #1103 would have
    // written. Without this the tolerance above is an unmeasured assumption.
    const NINETEEN_ELEVEN_THREE = USER_SETS / 1_000_000; // frame from the edit alone
    expect(() => expectRatio(NINETEEN_ELEVEN_THREE / level, USER_SETS / IN_HOUSE_RAW)).toThrow();
    // And the direction the user would read off the screen: £600,000 is DEARER
    // than the £400,000 option, so its level must be HIGHER. #1103 shipped 0.6
    // against 0.8 here — the status quo scored cheaper than both alternatives.
    expect(written.value).toBeGreaterThan(level);
    // The user's own magnitude is kept verbatim for display.
    expect(written.raw_value).toBe(USER_SETS);
  });

  it("the edit the product invited now ANALYSES instead of refusing", () => {
    const { graph, factor } = realDraft();
    expect(rerunVerdict(graph as never), "precondition: nothing is blocked before the edit")
      .toEqual({ blocked: false });

    const written = normaliseFactorValue({
      rawInput: USER_SETS,
      inputHasUnit: false,
      factorScaleFrame: (factor as unknown as { scale_frame?: number }).scale_frame!,
    });
    factor.observed_state = { ...factor.observed_state, ...written };

    expect(rerunVerdict(graph as never)).toEqual({ blocked: false });
  });

  it("a factor with NO frame keeps today's raw write, and the gate keeps refusing it honestly", () => {
    // ⚠ THE CLASS WE DELIBERATELY DO NOT CLOSE, PINNED SO IT CANNOT DRIFT SHUT
    // BY ACCIDENT. No baseline AND no option acting on it ⇒ pass 3d has no
    // magnitude to frame from and truthfully derives none. The edit seam cannot
    // tell that apart from a legitimately unframed factor (a count, a ratio, an
    // unbounded scale), so it does NOT guess — it writes raw, exactly as today,
    // and the analysis seam asks the user. Measured at pristine: this case
    // refused before this change and refuses after it.
    const noSiblings: DraftRecordSet = {
      stated_items: [
        { kind: "goal", source_quote: "keep customers happy without blowing the budget" },
        { kind: "option", source_quote: OUTSOURCE },
        { kind: "option", source_quote: IN_HOUSE },
      ],
      claims: [
        { claim_kind: "factor", label: COST },
        { claim_kind: "factor", label: "Customer satisfaction", value: 0.7 },
        { claim_kind: "causal_link", label: "outsourcing moves satisfaction", from_stated: 1, to_claim: 1, effect: "negative", sets_to: 0.6 },
        { claim_kind: "causal_link", label: "in-house moves satisfaction", from_stated: 2, to_claim: 1, effect: "positive", sets_to: 0.8 },
        { claim_kind: "causal_link", label: "support cost bears on the goal", from_claim: 0, to_stated: 0, effect: "negative" },
        { claim_kind: "causal_link", label: "satisfaction bears on the goal", from_claim: 1, to_stated: 0, effect: "positive" },
      ],
    };
    const { graph } = projectRecordsToGraph(noSiblings);
    const factor = graph.nodes.find((n) => n.label === COST)!;
    expect((factor as unknown as { scale_frame?: number }).scale_frame).toBeUndefined();

    const written = normaliseFactorValue({ rawInput: USER_SETS, inputHasUnit: false });
    expect(written).toEqual({ raw_value: USER_SETS, value: USER_SETS });

    factor.observed_state = { ...factor.observed_state, ...written };
    const verdict = rerunVerdict(graph as never);
    expect(verdict.blocked).toBe(true);
    expect(verdict.blocked === true && verdict.reason_code).toBe("baseline_scale_unresolved");
  });
});

describe("writer 2 — edit_graph reaches the SAME frame as writer 1", () => {
  /** The payload shape the canonicaliser hands reconcile. */
  const op = (nodeObserved: Record<string, unknown> | undefined, newValue: number, id: string) => ({
    op: "update_node" as const,
    path: id,
    value: { observed_state: { ...(nodeObserved ?? {}), value: newValue } },
  });

  it("⭐ two writers, one frame — the SAME user intent lands identically through both", () => {
    // Trap 21's whole point: `frameEditedBaselineForAnalysis` has one call site,
    // and patching only that one leaves `set_factor_value` framed while
    // `edit_graph` writes raw-and-refused. Two authorities, one question.
    const a = realDraft();
    const b = realDraft();
    const viaD1 = normaliseFactorValue({
      rawInput: USER_SETS,
      inputHasUnit: false,
      factorScaleFrame: (a.factor as unknown as { scale_frame?: number }).scale_frame!,
    });
    const [out] = reconcileObservedValuePair(
      [op(b.factor.observed_state as Record<string, unknown>, USER_SETS, b.factor.id) as never],
      b.graph,
    );
    const viaEditGraph = (out as { value: { observed_state: Record<string, unknown> } })
      .value.observed_state;

    expect(viaEditGraph.value).toBe(viaD1.value);
    expect(viaEditGraph.raw_value).toBe(viaD1.raw_value);
    // …and it is the RIGHT answer, not merely the same one. Two writers can
    // agree on a wrong number; this binds the pair to the drafted sibling.
    expectRatio((viaEditGraph.value as number) / b.level, USER_SETS / IN_HOUSE_RAW);
  });

  it("the ambiguity prescreen and the backstop agree on membership", () => {
    // One predicate or the user is asked a question the backstop then refuses
    // to act on. A bare sub-1 value on a framed factor is the ambiguous class.
    const { graph, factor } = realDraft();
    const ops = [op(factor.observed_state as Record<string, unknown>, 0.42, factor.id) as never];
    expect(findAmbiguousScaleValueOps(ops, graph).map((a) => a.path)).toEqual([factor.id]);
    expect(() => reconcileObservedValuePair(ops, graph)).toThrow(/ambiguous/i);
  });
});

describe("resolveScaleFrame — the spec of the one owner", () => {
  it("prefers the stored frame, falls back to the pair, and refuses everything else", () => {
    // Stored wins where the pair cannot speak (no pair at all).
    expect(resolveScaleFrame({ storedFrame: 500_000 })).toBe(500_000);
    // Pair still works with no stored frame — a graph drafted before the field.
    expect(resolveScaleFrame({ value: 0.5, raw_value: 50_000 })).toBe(100_000);
    // Stored takes precedence when both are present AND THEY COHERE.
    //
    // ⚠ CHANGED, AND THE CHANGE IS DISCLOSED RATHER THAN ABSORBED. This
    // assertion previously read `{storedFrame: 500_000, value: 0.5,
    // raw_value: 50_000}` → `500_000` — a pair encoding 100_000 sitting beside
    // a stored 500_000. The CONTRADICTION was this fixture's DISCRIMINATOR: it
    // was chosen so the returned number tells you which source was consulted.
    // It was never a ruling that a CONTRADICTED stored frame should be trusted
    // — this module's header justifies stored-precedence by a different case
    // entirely ("Stored wins for the case where they CANNOT agree: the factor
    // with no pair"), and `records/projector.ts` writes the two carriers to
    // agree by construction.
    //
    // `resolveScaleFrame` now validates the stored frame against the pair, so
    // an incoherent fixture no longer discriminates — it is refused (pinned
    // immediately below). Precedence is therefore pinned on a COHERENT pair,
    // where the stored frame is returned as the authority, plus the no-pair
    // case above, which is the case precedence exists for.
    expect(resolveScaleFrame({ storedFrame: 100_000, value: 0.5, raw_value: 50_000 })).toBe(100_000);
    // A stored frame the factor's own pair CONTRADICTS is refused, not trusted
    // and not silently replaced by the pair-recovered frame (re-deriving from
    // the baseline alone ignores the sibling interventions the real frame was
    // derived with). It degrades to unframed and the baseline gate refuses.
    expect(resolveScaleFrame({ storedFrame: 500_000, value: 0.5, raw_value: 50_000 })).toBeUndefined();
    // A stored value outside the producers' domain is REFUSED, not repaired —
    // it degrades to the pair, or to unframed. Held to the same domain
    // `recoverScaleFrame` proves, so the two paths cannot hand callers
    // different classes of answer.
    expect(resolveScaleFrame({ storedFrame: 1 })).toBeUndefined();
    expect(resolveScaleFrame({ storedFrame: 0 })).toBeUndefined();
    expect(resolveScaleFrame({ storedFrame: -500_000 })).toBeUndefined();
    expect(resolveScaleFrame({ storedFrame: Number.POSITIVE_INFINITY })).toBeUndefined();
    expect(resolveScaleFrame({ storedFrame: Number.NaN, value: 0.5, raw_value: 50_000 })).toBe(100_000);
    expect(resolveScaleFrame({ storedFrame: "500000" })).toBeUndefined();
    // Nothing at all.
    expect(resolveScaleFrame({})).toBeUndefined();
    // The unframed pair stays unframed (raw === value).
    expect(resolveScaleFrame({ value: 74_000, raw_value: 74_000 })).toBeUndefined();
  });
});

/**
 * ⭐ NO MODEL AUTHORS THE FRAME — PROVED, NOT ASSUMED.
 *
 * `scale_frame` is CEE-minted: it is derived deterministically from the
 * magnitudes the user and the model STATED, and a model that could rewrite it
 * could rescale the whole analysis without changing a single number on screen.
 * Declaring it on `NodeV3` makes it a *declared* field, and the canonicaliser
 * passes declared fields through untouched — so the refusal has to come from
 * `field-safety.ts`, which is deny-by-default over a table this repo does not
 * own (`aiEditableFieldRoots('node')`, shipped in `@talchain/schemas`).
 *
 * ⚠ "Deny-by-default already covers it" is exactly the guarantee-theatre claim
 * this estate has shipped before — an inherited assumption about a gate nobody
 * ran. The contrast control is what makes this evidence: `observed_state` is a
 * granted root and MUST be admitted by the same call in the same run. If the
 * control ever stops being admitted, the probe is blind and the refusal below
 * proves nothing.
 */
describe("`scale_frame` is CEE-minted and not AI-editable", () => {
  const envelope = (field: string) =>
    ({
      envelope_version: 1,
      candidate_id: "00000000-0000-0000-0000-000000000001",
      kind: "update_node_field",
      base_graph_hash: "h",
      payload: { node_id: "fac_cost", field, from: 500000, to: 1 },
      provenance: { source: "edit_graph_llm", evidence_pointer: "p" },
      identity: { scenario_id: "s", turn_id: "t" },
    }) as never;

  it("the safety gate REFUSES an `update_node_field` naming it, while admitting a granted root", () => {
    // CONTRAST CONTROL FIRST — a granted root, same call, same run.
    expect(checkFieldSafety(envelope("observed_state/value")).ok, "control: a granted root must be admitted").toBe(true);
    // THE TARGET.
    const refused = checkFieldSafety(envelope("scale_frame"));
    expect(refused.ok).toBe(false);
    expect(refused.ok === false && refused.code).toBe(FIELD_NOT_ALLOWED);
    // …and the sub-path spellings a producer might reach it by.
    expect(checkFieldSafety(envelope("scale_frame/value")).ok).toBe(false);
  });

  it("its sibling `goal_threshold_frame` has the same posture — one rule, not a special case", () => {
    // The precedent is asserted rather than described: if a later table change
    // granted either of them, this REDs and names which.
    expect(ALLOWED_NODE_FIELD_ROOTS.has("scale_frame")).toBe(false);
    expect(ALLOWED_NODE_FIELD_ROOTS.has("goal_threshold_frame")).toBe(false);
    expect(ALLOWED_NODE_FIELD_ROOTS.has("observed_state"), "control").toBe(true);
  });
});

/**
 * ⭐⭐ PERCENTAGES ABOVE 100 — the founder's named class, and the class this
 * suite originally had ZERO cases for.
 *
 * ⚠ THE GAP WAS REAL AND MEASURED: both specs added by this PR contained not a
 * single `%` character. Every fixture was £/cost-shaped, so the evidence the
 * change rested on excluded exactly the quantities the founder called out —
 * "NRR, growth and ROI may be >100%. Incorrect scale derivation can introduce
 * 2× to 100× errors." Checking what a corpus EXCLUDES rather than what it
 * covers is what surfaced this.
 *
 * ── THE DEFECT THESE PIN ────────────────────────────────────────────────────
 * `deriveFactorScaleFrame` pins 100 only when `isPercentScaledUnit(unit) &&
 * max <= 100`. ABOVE 100 it falls through to the {1,2,5}·10^k ladder, so NRR
 * [95,115] frames at 200 and ROI [50,300] frames at 500. The frame branch in
 * `reconcileObservedValuePair` is gated `unit !== '%'`, so such a factor never
 * reaches it and falls to `resolveExistingRawValue`'s hard-coded `value * 100`.
 *
 * Without the guard these tests exercise, a stored `scale_frame` acted as a KEY
 * unlocking a path that then IGNORED the frame that unlocked it:
 *   NRR  frame 200 → raw_value 50  (truth 100) — 2× wrong, analysis ADMITTED
 *   ROI  frame 500 → raw_value 50  (truth 250) — 5× wrong, analysis ADMITTED
 * where the base build REFUSED both outright. A loud refusal became a silent
 * error, which is the wrong trade at any frequency.
 */
describe("percent factors above 100 are refused, not silently rescaled", () => {
  const pctGraph = (frame: number, value: number, unit = '%') => ({
    nodes: [
      {
        id: 'nrr',
        kind: 'factor',
        label: 'Net Revenue Retention',
        observed_state: { value, unit },
        scale_frame: frame,
      },
    ],
    edges: [],
  });
  const pctOp = (newValue: number, unit = '%') => ({
    op: 'update_node' as const,
    path: 'nrr',
    // No `raw_value` — the shape a factor with no stated baseline produces, and
    // the one the stored-frame exception exists to admit.
    value: { observed_state: { unit, value: newValue } },
  });

  it('NRR on a frame of 200 is NOT admitted by the stored frame — base behaviour restored', () => {
    // Precondition pinned: this is the >100 class, so pass 3d's percent pin
    // (max <= 100) did NOT apply and the ladder produced 200.
    const graph = pctGraph(200, 0.475);
    const ops = [pctOp(110) as never];
    const [out] = reconcileObservedValuePair(ops, graph);
    // Returned BY REFERENCE, untouched: the canonicaliser declines, and the
    // analysis seam's baseline gate then refuses honestly, exactly as at base.
    expect(out).toBe(ops[0]);
  });

  it('ROI on a frame of 500 is NOT admitted either', () => {
    const graph = pctGraph(500, 0.1);
    const ops = [pctOp(300) as never];
    expect(reconcileObservedValuePair(ops, graph)[0]).toBe(ops[0]);
  });

  it('⭐ CONTRAST CONTROL — a normal percentage on frame 100 IS still admitted', () => {
    // Without this the two refusals above would be satisfied by a guard that
    // refused EVERY percent factor, which would be a regression wearing the
    // fix's face. 3–5% churn frames at exactly 100, so it is the honest case.
    const graph = pctGraph(100, 0.03);
    const ops = [pctOp(4) as never];
    const out = reconcileObservedValuePair(ops, graph)[0];
    expect(out).not.toBe(ops[0]);
  });

  it('a NON-percent factor with a ladder frame is unaffected by the percent guard', () => {
    // The guard must key on the percent unit, not on "frame !== 100" alone —
    // otherwise every £ factor the fix exists for would be refused too.
    const graph = pctGraph(500_000, 0.5, '£');
    const ops = [pctOp(600_000, '£') as never];
    const out = reconcileObservedValuePair(ops, graph)[0] as {
      value: { observed_state: Record<string, unknown> };
    };
    expect(out).not.toBe(ops[0]);
    expect(out.value.observed_state.value).toBe(600_000 / 500_000);
    expect(out.value.observed_state.raw_value).toBe(600_000);
  });
});

/**
 * ⭐⭐ THE TWIN UNIT PREDICATES, MEASURED — and the direction is the OPPOSITE
 * of the obvious reading.
 *
 * `isPercentScaledUnit` (`projector.ts`) matches `%` · `percent` · `per cent` ·
 * `pct`; this seam's consumers test `unit === '%'` EXACTLY. Same business fact,
 * two predicates. The instinct is "unify them" — but unify them WHICH WAY?
 *
 * Measured at this head, NRR on a stored frame of 200, user states 115
 * (truth: level 115/200 = 0.575, raw 115):
 *
 *   unit "%"        → REFUSED by the percent gate (base behaviour, honest)
 *   unit "% NRR"    → {value: 0.575, raw_value: 115}   ✓ CORRECT
 *   unit "percent"  → {value: 0.575, raw_value: 115}   ✓ CORRECT
 *   unit "pct"      → {value: 0.575, raw_value: 115}   ✓ CORRECT
 *
 * ⚠ SO THE NARROW PREDICATE IS THE HARMFUL ONE. The broad spellings fall
 * through to the frame branch and get the RIGHT answer from the stored frame;
 * only the exact `'%'` spelling is diverted to `resolveExistingRawValue`'s
 * `value * 100` fallback, which cannot know the frame is 200 and produced the
 * 2× error the merge gate now refuses.
 *
 * Two consequences worth stating, because a future lane will reach for this:
 *  1. A "unification" toward the NARROW predicate — making `'% NRR'` behave
 *     like `'%'` — would convert three currently-correct cases into the same
 *     silent error. That is the trap, and these tests exist to REDden it.
 *  2. The safe unification is toward the BROAD predicate, which is the same
 *     family as the principled fix deliberately NOT taken on this PR (percent
 *     units always framing at 100). Rowed, with this measurement attached.
 */
describe('percent spellings other than "%" already resolve on the stored frame', () => {
  const framedGraph = (unit: string) => ({
    nodes: [
      { id: 'nrr', kind: 'factor', label: 'NRR', observed_state: { value: 0.475, unit }, scale_frame: 200 },
    ],
    edges: [],
  });
  const statesRaw = (unit: string) => ({
    op: 'update_node' as const,
    path: 'nrr',
    value: { observed_state: { unit, value: 115 } },
  });

  it.each(['% NRR', 'percent', 'pct'])(
    'unit %o resolves on the frame the draft established, not on a hard-coded 100',
    (unit) => {
      const ops = [statesRaw(unit) as never];
      const out = reconcileObservedValuePair(ops, framedGraph(unit))[0] as {
        value: { observed_state: Record<string, unknown> };
      };
      expect(out).not.toBe(ops[0]);
      // THE SPEC: the level is the stated magnitude over the STORED frame.
      expect(out.value.observed_state.value).toBe(115 / 200);
      expect(out.value.observed_state.raw_value).toBe(115);
    },
  );

  it('⚠ DISCRIMINATING TWIN — the exact "%" spelling is REFUSED, not silently rescaled', () => {
    // The divergence itself, pinned. If a later change makes these four agree,
    // this pair says which way it went: all-correct, or all-refused. What it
    // must never become is all-silently-wrong.
    const ops = [statesRaw('%') as never];
    expect(reconcileObservedValuePair(ops, framedGraph('%'))[0]).toBe(ops[0]);
  });
});
