/**
 * MODEL COMPILER PART 2 — THE PRODUCT MUST NOT INVENT QUANTITIES.
 *
 * ── THE RULING THIS SUITE PINS ─────────────────────────────────────────────
 * "Factors without a defensible value, evidence-backed range or explicit
 * defensible prior remain VISIBLY PRESENT but are NOT given invented
 * quantitative values simply so analysis can consume them. … Do not disguise
 * ignorance as a 0–1 distribution."
 *
 * ── THE LAUNDERING PATH, DERIVED AT THE PRODUCER ───────────────────────────
 * Three sites default an absent factor value to `0.5`:
 *   `adapters/llm/normalisation.ts:~990`                    (Stage-1, controllable)
 *   `…/repair/deterministic-sweep.ts` fixControllableMissingData
 *   `…/repair/deterministic-sweep.ts` fixObservableMissingData
 *
 * `handleUnreachableFactors` then reclassifies an option-unreachable factor to
 * `external`, reads that `0.5` as a BASELINE, and asks
 * `synthesisePriorFromBaseline` for a prior:
 *
 *     margin = max(0.1, 0.5 * 0.5) = 0.25   →   uniform(0.25, 0.75)
 *
 * That is the defect. `U(0.25, 0.75)` asserts the value is not below 0.25 and
 * not above 0.75 — two claims with no grounds — so a placeholder acquires the
 * appearance of a measurement. It does not merely default; it dresses the
 * default up as evidence.
 *
 * ── WHERE THE ORACLE COMES FROM (trap 13c: a mutant kit scores sensitivity, ──
 *    never correctness, so the expectations must be derived, not preferred)
 * EXTERNAL: the `0.25 / 0.75` figures are not this author's arithmetic. They
 * appear as a REAL captured pair in `cee/provenance/__tests__/fixtures/
 * trace-captures.ts` on two independent briefs —
 *   `fac_localisation_cost`   (B1) prior uniform{0.25, 0.75}, ai_inferred/inferred
 *   `fac_change_saturation`   (B2) prior uniform{0.25, 0.75}, ai_inferred/inferred
 * — i.e. the laundered shape is present in committed captures of the deployed
 * system, on `inferred` provenance, exactly as the arithmetic above predicts.
 * MINE: the structured expectations, each derived from
 * `synthesisePriorFromBaseline`'s own docstring and from the tier vocabulary
 * declared in `cee/provenance/factor-value-provenance.ts`.
 *
 * ⚠ SCOPE, STATED SO IT CANNOT BE OVER-READ. These are PRODUCER assertions.
 * The brief's warning is honoured: both unit-interval factors in the cold-read
 * corpus carry `display_value: null`, so the `Range: 0 to 1` RENDER is not
 * reproducible from fixtures and a fixture-only assertion here would be a guard
 * agreeing with itself. Nothing below claims anything about what the UI paints.
 */

import { describe, it, expect } from "vitest";
import { handleUnreachableFactors } from "../unreachable-factors.js";
import { fixObservableMissingData } from "../deterministic-sweep.js";
import { ensureControllableFactorBaselines } from "../../../../../adapters/llm/normalisation.js";
import {
  FACTOR_VALUE_TIER_FIELD,
  classifyFactorValueTier,
} from "../../../../provenance/factor-value-provenance.js";
import {
  classifyValueSource,
  obligationFor,
} from "../../../../graph-readiness/obligation-provenance.js";
import type { GraphT } from "../../../../../schemas/graph.js";
import type { EdgeFormat } from "../../../utils/edge-format.js";

/**
 * An option-UNREACHABLE factor — no inbound `option→factor` edge — which is the
 * precondition `handleUnreachableFactors` acts on. The factor's `data` is
 * supplied verbatim by the caller so each test states its own provenance.
 */
function unreachableFactorGraph(data: Record<string, unknown>): GraphT {
  return {
    nodes: [
      { id: "goal_x", kind: "goal", label: "Goal" },
      { id: "dec_x", kind: "decision", label: "Decision" },
      { id: "opt_x", kind: "option", label: "Option" },
      { id: "fac_x", kind: "factor", label: "Subcontractor Cost", category: "observable", data },
    ],
    edges: [
      { from: "dec_x", to: "opt_x", edge_type: "structural" },
      { from: "opt_x", to: "goal_x", edge_type: "causal" },
    ],
  } as unknown as GraphT;
}

/**
 * The edge format these graphs are written in. A GENUINE `EdgeFormat` member
 * (`"V1_FLAT" | "LEGACY" | "NONE"`), typed rather than cast: the neighbouring
 * suite passes `"edge_type" as any`, and an `as any` here would silence the
 * very typecheck that caught this.
 */
const EDGE_FORMAT: EdgeFormat = "LEGACY";

function factorNode(graph: GraphT): any {
  return (graph as any).nodes.find((n: any) => n.id === "fac_x");
}

/**
 * The margin rule TRANSCRIBED from `synthesisePriorFromBaseline`'s docstring:
 *   "margin = max(0.1, value * 0.5) — at least ±0.1 spread, or ±50% of the
 *    baseline for larger values", unit-interval clamped to [0,1], ratio scale
 *   (value > 1) unclamped above.
 *
 * ⚠ WHY THIS IS COMPUTED AND NOT WRITTEN AS LITERALS. An earlier draft of this
 * suite hard-coded `0.5599999999999999` / `0.63` from the author's own mental
 * arithmetic and both were wrong in the last IEEE bit. The fix is NOT to paste
 * back whatever the code printed — that makes the test agree with the
 * implementation by construction and it would pass against a broken one. It is
 * to state the DECLARED RULE and let the same rule be evaluated independently
 * here, so the assertion still fails if the implementation stops obeying it.
 */
function declaredNarrowedPrior(value: number): { range_min: number; range_max: number } {
  const margin = Math.max(0.1, value * 0.5);
  return value > 1
    ? { range_min: Math.max(0, value - margin), range_max: value + margin }
    : { range_min: Math.max(0, value - margin), range_max: Math.min(1, value + margin) };
}

// ───────────────────────────────────────────────────────────────────────────
// A — THE LAUNDERING IS STOPPED, and its opposite-direction twin
// ───────────────────────────────────────────────────────────────────────────

describe("A — a system-defaulted baseline must not be narrowed into a prior that reads as an estimate", () => {
  it("does NOT convert a stamped fallback default of 0.5 into uniform(0.25, 0.75)", () => {
    const graph = unreachableFactorGraph({
      value: 0.5,
      extractionType: "inferred",
      [FACTOR_VALUE_TIER_FIELD]: "fallback_default",
    });

    const result = handleUnreachableFactors(graph, EDGE_FORMAT);
    const prior = factorNode(graph).prior;

    // The laundered shape, named explicitly so this test states what it forbids.
    expect(prior).not.toEqual({ distribution: "uniform", range_min: 0.25, range_max: 0.75 });
    // Ignorance is expressed as the range that asserts nothing.
    expect(prior).toEqual({ distribution: "uniform", range_min: 0.0, range_max: 1.0 });

    // …and it is MARKED, so no downstream surface has to guess.
    const repair = result.repairs.find((r) => r.path.includes("fac_x"));
    expect(repair?.prior_is_unquantified).toBe(true);
  });

  it("TWIN — a genuinely stated baseline of 0.5 still narrows to uniform(0.25, 0.75), untouched", () => {
    // Same magnitude, different provenance. This is the case that proves the
    // discriminator is provenance and NOT the magic number 0.5 (trap 19): if the
    // fix keyed on `value === 0.5` this test and the one above could not both pass.
    const graph = unreachableFactorGraph({ value: 0.5, extractionType: "explicit" });

    const result = handleUnreachableFactors(graph, EDGE_FORMAT);

    expect(factorNode(graph).prior).toEqual({
      distribution: "uniform",
      range_min: 0.25,
      range_max: 0.75,
    });
    const repair = result.repairs.find((r) => r.path.includes("fac_x"));
    expect(repair?.prior_is_unquantified).not.toBe(true);
  });

  it("TWIN — an inferred-WITH-EVIDENCE value is a defensible baseline and still narrows", () => {
    // `inferred` + a value that is not the default ⇒ tier `inferred_with_evidence`
    // (factor-value-provenance.ts). The model reasoned to 0.42; that is not ignorance.
    const graph = unreachableFactorGraph({ value: 0.42, extractionType: "inferred" });

    handleUnreachableFactors(graph, EDGE_FORMAT);

    // margin = max(0.1, 0.42 * 0.5) = 0.21 ⇒ narrowed, NOT the ignorance range.
    expect(factorNode(graph).prior).toEqual({
      distribution: "uniform",
      ...declaredNarrowedPrior(0.42),
    });
    // Stated separately so the intent survives a formula refactor: this is a
    // narrowing, i.e. strictly inside [0,1].
    expect(factorNode(graph).prior.range_min).toBeGreaterThan(0);
    expect(factorNode(graph).prior.range_max).toBeLessThan(1);
  });

  it("TWIN — a ratio-scale stated value keeps its unclamped narrowed prior (the NRR regression)", () => {
    // Pins the 2026-08-10 fix: "our NRR is 112%" → 1.12, margin 0.56, no upper clamp.
    // A quantities fix must not re-break the case that made stated figures survive.
    const graph = unreachableFactorGraph({ value: 1.12, extractionType: "explicit" });

    handleUnreachableFactors(graph, EDGE_FORMAT);

    const prior = factorNode(graph).prior;
    expect(prior.range_max).toBeGreaterThan(1);
    expect(prior).toEqual({
      distribution: "uniform",
      ...declaredNarrowedPrior(1.12),
    });
    // The containment invariant this case exists to protect.
    expect(prior.range_min).toBeLessThanOrEqual(1.12);
    expect(prior.range_max).toBeGreaterThanOrEqual(1.12);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// B — MARKING, NOT FILTERING (quality bar Q5: mark, never suppress)
// ───────────────────────────────────────────────────────────────────────────

describe("B — an unquantified factor stays visibly present", () => {
  it("keeps the factor node in the graph rather than deleting or omitting it", () => {
    const graph = unreachableFactorGraph({
      value: 0.5,
      extractionType: "inferred",
      [FACTOR_VALUE_TIER_FIELD]: "fallback_default",
    });

    handleUnreachableFactors(graph, EDGE_FORMAT);

    // Bound by IDENTITY, never by a value predicate another node could satisfy.
    const node = factorNode(graph);
    expect(node).toBeDefined();
    expect(node.id).toBe("fac_x");
    expect(node.label).toBe("Subcontractor Cost");
    // It must still carry a prior: dropping it would leave any constraint on
    // this node evaluating trivially at intercept=0, which is suppression by
    // another route.
    expect(node.prior).toBeDefined();
  });

  it("promotes the tier mark onto the node so it survives the data strip", () => {
    const graph = unreachableFactorGraph({
      value: 0.5,
      extractionType: "inferred",
      [FACTOR_VALUE_TIER_FIELD]: "fallback_default",
    });

    handleUnreachableFactors(graph, EDGE_FORMAT);

    const node = factorNode(graph);
    // `data.value` is deleted by this repair, so the honest fact about where the
    // number came from must outlive `data` or the mark dies at the very step
    // that laundered it.
    expect(node[FACTOR_VALUE_TIER_FIELD]).toBe("fallback_default");
    expect(classifyFactorValueTier(node)).toBe("fallback_default");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// C — THE FULL CHAIN, stamper → launderer, through the real producers
// ───────────────────────────────────────────────────────────────────────────

describe("C — end to end: an unvalued factor never acquires uniform(0.25, 0.75)", () => {
  it("stamps at the defaulting site and declines to narrow at the reclassifying site", () => {
    // Start from the genuine precondition: a factor with NO value at all.
    const graph = unreachableFactorGraph({});
    delete (factorNode(graph) as any).data;

    // 1. The real defaulting producer runs.
    const sweepRepairs = fixObservableMissingData(graph, [
      { code: "OBSERVABLE_MISSING_DATA", path: "nodes[fac_x]" } as any,
    ]);
    expect(sweepRepairs.length).toBeGreaterThan(0);
    expect(factorNode(graph).data.value).toBe(0.5);
    expect(factorNode(graph).data[FACTOR_VALUE_TIER_FIELD]).toBe("fallback_default");

    // 2. The real reclassifying producer runs.
    handleUnreachableFactors(graph, EDGE_FORMAT);

    // 3. The invented number never becomes a range that reads as evidence.
    expect(factorNode(graph).prior).toEqual({
      distribution: "uniform",
      range_min: 0.0,
      range_max: 1.0,
    });
  });
});

describe("C2 — which stampers can actually FEED the launderer", () => {
  it("Stage-1 `ensureControllableFactorBaselines` is STRUCTURALLY DISJOINT from the launderer", () => {
    // ⭐ A FINDING, NOT A GAP — and it corrects this lane's own PR body, which
    // named three stampers feeding the launderer. Only two can.
    //
    // `ensureControllableFactorBaselines` derives its target set STRUCTURALLY,
    // from `option→factor` edges (`normalisation.ts:938-950`). That is the exact
    // predicate `handleUnreachableFactors` uses to EXCLUDE a node: it reclassifies
    // only factors with no path from an option, and its reachable set is a
    // superset of the direct option→factor targets (it additionally walks
    // factor→factor chains). So every node Stage-1 touches is, by construction,
    // a node the launderer will not touch.
    //
    // The `explicit`-without-value hole therefore reaches the launderer via
    // `fixControllableMissingData` (which gates on `category`, a LABEL, and
    // preserves an LLM `extractionType`) — not via Stage 1. The direct cases
    // above cover that class; this test pins WHY the Stage-1 route cannot be
    // written as an end-to-end one, so a later lane does not read its absence
    // as an oversight and "fix" it with a fabricated fixture.
    const optionConnected: any = {
      nodes: [
        { id: "goal_x", kind: "goal", label: "Goal" },
        { id: "dec_x", kind: "decision", label: "Decision" },
        { id: "opt_x", kind: "option", label: "Option" },
        { id: "fac_x", kind: "factor", label: "Cost", data: { extractionType: "explicit" } },
      ],
      edges: [
        { from: "dec_x", to: "opt_x", edge_type: "structural" },
        { from: "opt_x", to: "fac_x", edge_type: "causal" },
        { from: "fac_x", to: "goal_x", edge_type: "causal" },
      ],
    };

    // Stage 1 DOES fire here — the node has an option edge.
    const { defaultedFactors } = ensureControllableFactorBaselines(optionConnected);
    expect(defaultedFactors).toContain("fac_x");

    // …and the launderer does NOT reclassify it, precisely because of that edge.
    const result = handleUnreachableFactors(optionConnected as GraphT, EDGE_FORMAT);
    expect(result.reclassified).not.toContain("fac_x");
    expect((optionConnected.nodes.find((n: any) => n.id === "fac_x") as any).prior)
      .toBeUndefined();
  });

  it("CONTRAST — remove the option edge and Stage 1 stops firing, so it cannot hand over", () => {
    // The discrimination that makes the claim above non-vacuous: the same node
    // with no option edge is exactly the launderer's target, and Stage 1 skips it.
    const unreachable: any = {
      nodes: [
        { id: "goal_x", kind: "goal", label: "Goal" },
        { id: "dec_x", kind: "decision", label: "Decision" },
        { id: "opt_x", kind: "option", label: "Option" },
        { id: "fac_x", kind: "factor", label: "Cost", data: { extractionType: "explicit" } },
      ],
      edges: [
        { from: "dec_x", to: "opt_x", edge_type: "structural" },
        { from: "opt_x", to: "goal_x", edge_type: "causal" },
      ],
    };

    const { defaultedFactors } = ensureControllableFactorBaselines(unreachable);
    expect(defaultedFactors).not.toContain("fac_x");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// D — THE GAP IS AN ELICITATION ASK, NEVER A BLOCKING ERROR
//
// ⚠ TWO QUESTIONS, NAMED APART ON PURPOSE (CLAUDE.md trap 21 — two authorities
// under similar names is how one PR closes a harm and its neighbour reopens it):
//
//   `value_tier`          — "is this NUMBER information?"   (this lane)
//   `StructureProvenance` — "WHO supplied this structure?"  (#1014's authority)
//
// They are not the same axis and neither is derived from the other. This block
// asserts they AGREE on the fabricated case, so no surface can read one as the
// other, and it pins the founder's "never a blocking error" clause for exactly
// the class of factor the laundering fix now produces.
// ───────────────────────────────────────────────────────────────────────────

describe("D — an unquantified factor is OFFERED, never DEMANDED", () => {
  it("classifies a system-defaulted value as an OFFER, so the gap cannot block", () => {
    const graph = unreachableFactorGraph({
      value: 0.5,
      extractionType: "inferred",
      [FACTOR_VALUE_TIER_FIELD]: "fallback_default",
    });
    const node = factorNode(graph);

    // This lane's axis says the number is not information …
    expect(classifyFactorValueTier(node)).toBe("fallback_default");
    // … and #1014's authority says the gap may only be OFFERED.
    expect(obligationFor(classifyValueSource(node.data.extractionType))).toBe("offered");
  });

  it("TWIN — a genuinely user-stated value still DEMANDS, so the offer path is not vacuous", () => {
    const graph = unreachableFactorGraph({ value: 0.5, extractionType: "explicit" });
    const node = factorNode(graph);

    expect(classifyFactorValueTier(node)).toBe("explicit");
    expect(obligationFor(classifyValueSource(node.data.extractionType))).toBe("required");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// E — THE PREDICATE'S BREADTH, pinned in BOTH directions
//
// The first version of `factorValueIsFabricated` was fail-closed and therefore
// TOO WIDE: it treated any value whose provenance was merely UNSTAMPED as an
// invention, and refused to narrow a real `{ value: 0.6 }`. The shared contract
// forbids exactly that read — "a consumer MUST NOT read absence as any
// particular class" — so absence is neutral, not fabricated. These cases pin the
// corrected breadth so it cannot silently widen again (trap 22b: a gap and a lie
// are different harms and cannot share one window).
// ───────────────────────────────────────────────────────────────────────────

describe("E — an unlabelled but real value is NOT treated as an invention", () => {
  it.each([0.04, 0.5, 0.6, 0.9])(
    "narrows an unstamped, unlabelled value of %s instead of asserting ignorance",
    (value) => {
      const graph = unreachableFactorGraph({ value });

      handleUnreachableFactors(graph, EDGE_FORMAT);

      expect(factorNode(graph).prior).toEqual({
        distribution: "uniform",
        ...declaredNarrowedPrior(value),
      });
      // The ignorance range must NOT have been substituted for real information.
      expect(factorNode(graph).prior).not.toEqual({
        distribution: "uniform",
        range_min: 0,
        range_max: 1,
      });
    },
  );

  it("A1 — a USER-STATED 0.5 labelled `inferred` is NOT destroyed", () => {
    // ⚠ THIS TEST IS THE INVERSE OF THE ONE IT REPLACES, and the replacement is
    // the point. The earlier version asserted that an unstamped 0.5 was "still
    // caught" by a legacy magnitude signature. The adversarial review measured
    // what that cost: "about half our customers" — the most commonly stated
    // probability in business English — was widened to meaningless, while 0.51
    // survived. The discriminator WAS the magic number for anything labelled
    // `inferred` or `range`, i.e. trap 19 alive inside the fix written for it.
    // The magnitude limb is deleted; only a positive stamp collapses now.
    const graph = unreachableFactorGraph({ value: 0.5, extractionType: "inferred" });

    handleUnreachableFactors(graph, EDGE_FORMAT);

    expect(factorNode(graph).prior).toEqual({
      distribution: "uniform",
      ...declaredNarrowedPrior(0.5),
    });
    expect(factorNode(graph).prior).not.toEqual({
      distribution: "uniform", range_min: 0, range_max: 1,
    });
  });

  it("A1 — the same for `range`, the other non-brief-backed label", () => {
    const graph = unreachableFactorGraph({ value: 0.5, extractionType: "range" });

    handleUnreachableFactors(graph, EDGE_FORMAT);

    expect(factorNode(graph).prior).toEqual({
      distribution: "uniform",
      ...declaredNarrowedPrior(0.5),
    });
  });

  it("A1 TWIN — a STAMPED 0.5 still collapses, so the fix is not simply disabled", () => {
    const graph = unreachableFactorGraph({
      value: 0.5,
      extractionType: "inferred",
      [FACTOR_VALUE_TIER_FIELD]: "fallback_default",
    });

    handleUnreachableFactors(graph, EDGE_FORMAT);

    expect(factorNode(graph).prior).toEqual({
      distribution: "uniform", range_min: 0, range_max: 1,
    });
  });

  it("A STAMPED value labelled `explicit` with no real value IS caught", () => {
    // ⭐ THE CANONICAL CASE THIS MODULE WAS WRITTEN FOR, and round 2 let it
    // through. `normalisation.ts:987` preserves an LLM-supplied `extractionType`
    // (`existingType ?? 'inferred'`), and `fixControllableMissingData` only
    // defaults it when undefined. So a factor the model labelled `explicit`
    // while supplying NO VALUE gets a stamped invented 0.5 AND keeps the
    // brief-backed label — and round 2's short-circuit let the label beat the
    // stamp, laundering exactly as before.
    //
    // THREE nodes in the committed cold-read corpus are in this class, including
    // `fac_nrr` — the node `factor-value-provenance.ts`'s own header cites as the
    // deployed 2026-08-08 defect. `classifyFactorValueTier` says an `explicit`
    // label with no value cannot be honoured; the short-circuit honoured it,
    // because a defaulting site upstream had already erased the "no value"
    // condition that disqualified it. Trap 21, inside the fix.
    const graph = unreachableFactorGraph({
      value: 0.5,
      extractionType: "explicit",
      [FACTOR_VALUE_TIER_FIELD]: "fallback_default",
    });

    handleUnreachableFactors(graph, EDGE_FORMAT);

    expect(factorNode(graph).prior).toEqual({
      distribution: "uniform", range_min: 0, range_max: 1,
    });
    expect(factorNode(graph).prior).not.toEqual({
      distribution: "uniform", range_min: 0.25, range_max: 0.75,
    });
  });

  it("…and the same for `observed`, the other brief-backed label", () => {
    const graph = unreachableFactorGraph({
      value: 0.5,
      extractionType: "observed",
      [FACTOR_VALUE_TIER_FIELD]: "fallback_default",
    });

    handleUnreachableFactors(graph, EDGE_FORMAT);

    expect(factorNode(graph).prior).toEqual({
      distribution: "uniform", range_min: 0, range_max: 1,
    });
  });

  it("TWIN — containment ALONE protects a real brief-backed value, with no label rule", () => {
    // The round-3 deletion's whole justification. The brief-backed short-circuit
    // was added to stop `{1.12, explicit, stamped}` collapsing to a prior that
    // does not contain 1.12 — and it did stop it, but so does the structural
    // containment guard, which was added in the same change and is the half that
    // needed no rule about labels.
    //
    // This test is what makes the deletion safe: it asserts the SAME protection
    // survives with the label rule gone. Containment is structural — `[0,1]`
    // contains every value in `[0,1]` by definition — so unlike a tuned
    // discriminator it cannot quietly stop discriminating.
    const graph = unreachableFactorGraph({
      value: 1.12,
      extractionType: "explicit",
      [FACTOR_VALUE_TIER_FIELD]: "fallback_default",
    });

    handleUnreachableFactors(graph, EDGE_FORMAT);

    const prior = factorNode(graph).prior;
    expect(prior.range_min).toBeLessThanOrEqual(1.12);
    expect(prior.range_max).toBeGreaterThanOrEqual(1.12);
    expect(prior).toEqual({ distribution: "uniform", ...declaredNarrowedPrior(1.12) });
  });

  it("B1 — the collapse itself enforces containment for an out-of-range baseline", () => {
    // Defence in depth: the stampers only write 0.5, so a stamped node should
    // always be inside [0,1] — but "should" is how invariants die.
    const graph = unreachableFactorGraph({
      value: 1.4,
      extractionType: "inferred",
      [FACTOR_VALUE_TIER_FIELD]: "fallback_default",
    });

    handleUnreachableFactors(graph, EDGE_FORMAT);

    const prior = factorNode(graph).prior;
    expect(prior.range_max).toBeGreaterThanOrEqual(1.4);
    expect(prior).not.toEqual({ distribution: "uniform", range_min: 0, range_max: 1 });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// F — THE CHANGE IS DISCLOSED TO THE USER, NOT ONLY LOGGED
//
// Standing rule (coordinator, 2026-08-18): a projection that RE-EXPRESSES the
// model without losing a causal claim is Class A and acceptable; one that DROPS
// a factor, edge, risk or uncertainty is Class B and must never be built. If
// anything changes what the analysis sees, it must be disclosed to the user —
// never a bare log line.
//
// This fix is Class A and then some: it drops nothing (the factor and its prior
// both survive) and it WIDENS declared uncertainty rather than narrowing it.
// But it does change what the analysis sees, so the disclosure obligation
// applies, and this block pins it instead of trusting the log.
//
// THE ONE HOP, verified at the bytes: `UNREACHABLE_FACTOR_RECLASSIFIED` is in
// `REPAIR_CODE_TO_ADJUSTMENT` (`stages/boundary.ts:44`), so these repairs become
// user-reviewable `analysis_ready.model_adjustments` rows, and `boundary.ts:168`
// populates each row's `reason` from `r.action` — the exact string asserted here.
// ───────────────────────────────────────────────────────────────────────────

describe("F — the user is told, in the repair record that reaches them", () => {
  it("states the cause in the action string that becomes model_adjustments.reason", () => {
    const graph = unreachableFactorGraph({
      value: 0.5,
      extractionType: "inferred",
      [FACTOR_VALUE_TIER_FIELD]: "fallback_default",
    });

    const result = handleUnreachableFactors(graph, EDGE_FORMAT);
    const repair = result.repairs.find((r) => r.path.includes("fac_x"));

    // Bound by identity to the disclosing repair, and to its CODE — because the
    // code is what decides whether this reaches the user at all.
    expect(repair?.code).toBe("UNREACHABLE_FACTOR_RECLASSIFIED");
    // ⚠ C1 — THIS STRING IS PRINTED TO THE USER VERBATIM, so it is asserted as
    // plain English and asserted NEGATIVELY against the three kinds of internal
    // language an earlier draft leaked: bracket notation, the word
    // "unquantified", and the defaulted number itself.
    expect(repair?.action).toContain("no estimate for it yet");
    expect(repair?.action).toContain("left fully open");
    expect(repair?.action).not.toMatch(/\[|\]/);
    expect(repair?.action).not.toMatch(/unquantified/i);
    expect(repair?.action).not.toContain("0.5");
  });

  it("TWIN — a genuine baseline's disclosure does NOT claim ignorance", () => {
    const graph = unreachableFactorGraph({ value: 0.42, extractionType: "inferred" });

    const result = handleUnreachableFactors(graph, EDGE_FORMAT);
    const repair = result.repairs.find((r) => r.path.includes("fac_x"));

    expect(repair?.action).not.toContain("no estimate for it yet");
    // The genuine path keeps the notation form the deployed UI sanitiser strips.
    expect(repair?.action).toContain("synthesised prior");
  });
});
