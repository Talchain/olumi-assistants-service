/**
 * EVERY OPTION→FACTOR EFFECT VALUE CARRIES A PROVENANCE STAMP.
 *
 * ── THE INVARIANT, WRITTEN AGAINST THE SPEC AND NOT AGAINST THE SYMPTOM ─────
 * CLAUDE.md's standing invariant admits exactly three states for a quantity:
 *
 *   explicit user fact → PRESERVE IT
 *   defensible Olumi estimate → the estimate, WITH its provenance
 *   genuinely unknown → UNKNOWN / needs input
 *
 * A number on the graph that carries NO provenance is none of the three. It is
 * the second state wearing the first state's clothes, and it is the estate's
 * class-1 defect ("absence represented as value") in the one place it does the
 * most damage: `OptionData.interventions` is what the analysis compares the
 * options on, so an unstamped estimate becomes a recommendation the product
 * cannot attribute.
 *
 * ⚠ THIS TEST IS NOT ABOUT `sets_to` BEING PRESENT. Whether the model emits a
 * value is the instruction's business. This pins the OTHER half of that change:
 * whatever value does arrive is stamped. The two ship together on purpose —
 * asking the model for more estimates while leaving them unattributable would
 * trade a refusal the user can see for a fabrication they cannot.
 *
 * ── WHY THE FOURTH CASE EXISTS ─────────────────────────────────────────────
 * `cee/transforms/analysis-ready.ts:831-835` raises a NON-WAIVABLE
 * `ambiguous_value` blocker on any intervention whose reasoning matches
 * `/^Direct causal value (?:bound by edge|has unresolved stated-item binding)/`
 * while its binding is unresolved. A stamp that reused that prefix would swap a
 * hard `MISSING_OPTION_VALUE` refusal for a hard `AMBIGUOUS_OPTION_VALUE` one —
 * the symptom metric would move and the user would still be blocked (CLAUDE.md
 * trap 23). The predicate is derived HERE from the consumer's own bytes rather
 * than restated, so the pin cannot drift into agreeing with itself.
 *
 * ⭐ ASSERTIONS BIND BY IDENTITY — the minted id of a node located by its EXACT
 * label — never by a value predicate another node could satisfy (trap 19).
 */
import { describe, expect, it } from "vitest";
import { projectRecordsToGraph } from "../projector.js";
import type { DraftRecordSet } from "../grammar.js";

/**
 * The consumer's ACTUAL predicate, copied from
 * `cee/transforms/analysis-ready.ts:833`. Any receipt matching this and left
 * unresolved becomes a non-waivable `ambiguous_value` refusal.
 */
const AMBIGUOUS_VALUE_TRIGGER =
  /^Direct causal value (?:bound by edge|has unresolved stated-item binding)/;

interface ProjectedGraph {
  nodes: Array<{ id: string; kind?: string; label?: string; data?: Record<string, unknown> }>;
}

/** Locate a node by EXACT label; fails loud on 0 or 2+ so nothing is ambiguous. */
function idOf(graph: ProjectedGraph, label: string): string {
  const hits = graph.nodes.filter((n) => n.label === label);
  expect(hits, `expected exactly one node labelled "${label}"`).toHaveLength(1);
  return hits[0]!.id;
}

function optionData(graph: ProjectedGraph, optionId: string): Record<string, unknown> {
  const node = graph.nodes.find((n) => n.id === optionId);
  expect(node, `option ${optionId} is on the graph`).toBeDefined();
  return (node!.data ?? {}) as Record<string, unknown>;
}

const interventionsOf = (graph: ProjectedGraph, optionId: string) =>
  optionData(graph, optionId).interventions as Record<string, number> | undefined;

const detailsOf = (graph: ProjectedGraph, optionId: string) =>
  optionData(graph, optionId).intervention_details as
    | Record<string, { source: string; reasoning?: string; raw_value?: number }>
    | undefined;

/**
 * One brief, two options, one shared controllable factor.
 *
 * `stated_items[3]` is a figure the user really did give, and the CHALLENGER's
 * link cites it — that is the `brief_extraction` arm. The BASELINE's link cites
 * nothing, which is the arm the model produces whenever the brief does not hand
 * it a per-option number: the case that must be stamped as ours.
 */
const BRIEF =
  "We want to raise sales productivity. We could replace the CRM, which the vendor quotes at 240000 a year, or keep what we have.";

const RECORDS: DraftRecordSet = {
  stated_items: [
    { kind: "goal", source_quote: "raise sales productivity" },
    { kind: "option", source_quote: "replace the CRM" },
    { kind: "option", source_quote: "keep what we have", is_baseline: true },
    { kind: "figure", source_quote: "the vendor quotes at 240000 a year", value: 240000 },
  ],
  claims: [
    { claim_kind: "factor", label: "CRM annual licence cost" },
    { claim_kind: "outcome", label: "sales productivity gain" },
    {
      claim_kind: "causal_link",
      label: "the new CRM costs the quoted licence fee",
      from_stated: 1,
      to_claim: 0,
      effect: "negative",
      basis: [3],
      sets_to: 240000,
    },
    {
      // NO `basis`, and a value the brief never states: the estimate arm.
      claim_kind: "causal_link",
      label: "staying put holds the licence cost where it is",
      from_stated: 2,
      to_claim: 0,
      effect: "positive",
      sets_to: 90000,
    },
    { claim_kind: "causal_link", label: "licence cost bears on productivity", from_claim: 0, to_claim: 1, effect: "negative" },
    { claim_kind: "causal_link", label: "productivity reaches the goal", from_claim: 1, to_stated: 0, effect: "positive" },
  ],
};

describe("an option→factor effect value is never projected without a provenance stamp", () => {
  const { graph } = projectRecordsToGraph(RECORDS, BRIEF) as { graph: ProjectedGraph };
  const challengerId = idOf(graph, "replace the CRM");
  const baselineId = idOf(graph, "keep what we have");
  const factorId = idOf(graph, "CRM annual licence cost");

  it("⭐ PRECONDITION — both options really do carry an intervention on the named factor", () => {
    // Without this the invariant below would pass vacuously on an empty map,
    // which is exactly the "guard agreeing with itself" shape (trap 13b).
    expect(Object.keys(interventionsOf(graph, challengerId) ?? {})).toContain(factorId);
    expect(Object.keys(interventionsOf(graph, baselineId) ?? {})).toContain(factorId);
  });

  it("⭐⭐ THE INVARIANT — every intervention key on every option has a provenance entry", () => {
    for (const node of graph.nodes) {
      if (node.kind !== "option") continue;
      const interventions = interventionsOf(graph, node.id) ?? {};
      const details = detailsOf(graph, node.id) ?? {};
      for (const key of Object.keys(interventions)) {
        expect(
          details[key],
          `option "${node.label}" carries a value for factor ${key} with no provenance entry`,
        ).toBeDefined();
        expect(details[key]!.source).toBeTruthy();
      }
    }
  });

  it("the UNCITED estimate is stamped as Olumi's, never as the user's", () => {
    const detail = (detailsOf(graph, baselineId) ?? {})[factorId];
    expect(detail, "the baseline's estimate carries a provenance entry").toBeDefined();
    expect(detail!.source).toBe("cee_hypothesis");
    expect(detail!.raw_value).toBe(90000);
  });

  it("⭐ THE OPPOSITE-DIRECTION TWIN — a cited, brief-verified figure still earns brief authority", () => {
    // The estimate stamp must not be bought by demoting the user's own number.
    // If this ever goes red alongside the case above, the fix swallowed the
    // distinction instead of adding to it.
    const detail = (detailsOf(graph, challengerId) ?? {})[factorId];
    expect(detail, "the challenger's stated figure carries a provenance entry").toBeDefined();
    expect(detail!.source).toBe("brief_extraction");
    expect(detail!.raw_value).toBe(240000);
  });

  it("the estimate's receipt does NOT trip the consumer's ambiguous_value refusal", () => {
    // Derived from `cee/transforms/analysis-ready.ts:833`, not restated from
    // memory. A receipt that matched would trade one hard block for another.
    const detail = (detailsOf(graph, baselineId) ?? {})[factorId];
    expect(AMBIGUOUS_VALUE_TRIGGER.test(detail?.reasoning ?? "")).toBe(false);
    // And the positive control: the predicate can still say YES, so a `false`
    // above is a discrimination rather than a dead regex.
    expect(
      AMBIGUOUS_VALUE_TRIGGER.test("Direct causal value bound by edge e1 to stated_items[3]: x"),
    ).toBe(true);
  });
});

/* ===========================================================================
 * THE SAME INVARIANT, ON THE MERGE PATH.
 *
 * ⚠ WHY THIS BLOCK EXISTS: the invariant above is CORRECT AS STATED and its
 * corpus contained ZERO `option_refinement` records — measured, with a control
 * (`from_stated` and `from_claim` both present, so the probe could see). A guard
 * that is right over a corpus sharing the code's blind spot cannot observe the
 * code's defect. Extending the corpus is the half that stops this recurring;
 * the reach fix alone would leave the next merge-path gap equally invisible.
 *
 * THE PATH. `projectOnce` merges ONE refinement into its stated parent when the
 * refinement names exactly one stated option and does not conflict — "one
 * alternative under two names". The refinement's own option→factor links then
 * land on the merged parent. But `bindDirectStatedMagnitude` opens with
 * `if (claim.from_stated === undefined … ) return undefined`, and a refinement's
 * link carries `from_claim`, so the stamp function correctly declines and
 * NOTHING ELSE PICKED IT UP: the magnitude reached `interventions` with no
 * `intervention_details` entry.
 *
 * That is the same class-1 defect the direct-stated arm above was written to
 * close — an estimate of OURS wearing a user fact's clothes — surviving on the
 * path the corpus never walked.
 *
 * FIXTURE SHAPE is the captured production one: a stated option carrying the
 * price, one refinement contributing a SECOND factor the parent does not touch.
 * ========================================================================= */

const MERGE_BRIEF =
  "Given our goal of reaching 20000 MRR within 12 months, should we increase the Pro plan price from 49 to 59 per month with the next Pro feature release?";

const MERGE_RECORDS: DraftRecordSet = {
  stated_items: [
    { kind: "option", source_quote: "increase the Pro plan price from 49 to 59 per month" },
    { kind: "goal", source_quote: "reaching 20000 MRR within 12 months", role: "target" },
  ],
  claims: [
    { claim_kind: "factor", label: "Pro plan price", basis: [0], category: "controllable" },
    { claim_kind: "factor", label: "Perceived value", basis: [0], category: "controllable" },
    // The refinement: the SAME proposal under the model's own name.
    { claim_kind: "option_refinement", label: "Raise Price with Feature Release", basis: [0] },
    // The PARENT's own link — the direct-stated arm, which already stamps.
    {
      claim_kind: "causal_link",
      label: "the option sets the plan price",
      from_stated: 0,
      to_claim: 0,
      effect: "positive",
      sets_to: 0.59,
    },
    // The REFINEMENT's link, on a factor the parent never touches. `from_claim`,
    // so the direct-stated binder declines it.
    {
      claim_kind: "causal_link",
      label: "the feature release also moves perceived value",
      from_claim: 2,
      to_claim: 1,
      effect: "positive",
      sets_to: 0.8,
    },
    { claim_kind: "causal_link", label: "price bears on the goal", from_claim: 0, to_stated: 1, effect: "positive" },
    { claim_kind: "causal_link", label: "perceived value bears on the goal", from_claim: 1, to_stated: 1, effect: "positive" },
  ],
};

describe("the provenance invariant holds on the MERGE path", () => {
  const { graph } = projectRecordsToGraph(MERGE_RECORDS, MERGE_BRIEF) as { graph: ProjectedGraph };
  const mergedId = idOf(graph, "increase the Pro plan price from 49 to 59 per month");
  const priceId = idOf(graph, "Pro plan price");
  const valueId = idOf(graph, "Perceived value");

  it("⭐ PRECONDITION — the refinement MERGED: one option, not two", () => {
    // If this ever reds, the fixture stopped exercising the merge and every
    // assertion below would pass for the wrong reason.
    expect(graph.nodes.filter((n) => n.kind === "option")).toHaveLength(1);
  });

  it("⭐ PRECONDITION — the merged option carries BOTH magnitudes", () => {
    // The parent's own factor AND the one only the refinement touches. Without
    // this the invariant could pass on a map that never received the merge.
    const keys = Object.keys(interventionsOf(graph, mergedId) ?? {});
    expect(keys).toContain(priceId);
    expect(keys).toContain(valueId);
  });

  it("⛔ THE HARM — every intervention on the merged option has a provenance entry", () => {
    const interventions = interventionsOf(graph, mergedId) ?? {};
    const details = detailsOf(graph, mergedId) ?? {};
    for (const key of Object.keys(interventions)) {
      expect(
        details[key],
        `the merged option carries a value for factor ${key} with no provenance entry`,
      ).toBeDefined();
      expect(details[key]!.source).toBeTruthy();
    }
  });

  it("⭐ the refinement's magnitude is stamped as OURS, never as the user's", () => {
    // The number is model-authored: the brief states no per-factor figure for
    // perceived value. Claiming the user's authorship would be the mirror
    // defect of omitting our own, and strictly worse.
    const detail = (detailsOf(graph, mergedId) ?? {})[valueId];
    expect(detail, "the refinement-contributed magnitude carries a receipt").toBeDefined();
    expect(detail!.source).toBe("cee_hypothesis");
    expect(detail!.raw_value).toBe(0.8);
  });

  it("⭐ CONTROL — the direct-stated arm is unchanged by the merge", () => {
    // The parent's own link already stamped before this change. If it moves,
    // the repair reached further than it should have.
    const detail = (detailsOf(graph, mergedId) ?? {})[priceId];
    expect(detail).toBeDefined();
    expect(detail!.raw_value).toBe(0.59);
  });

  it("⭐ the receipt does NOT trip the consumer's ambiguous_value refusal", () => {
    // Same reasoning as the fourth case above, derived from the consumer's own
    // bytes: reusing that prefix would swap a visible refusal for a blocked user.
    const detail = (detailsOf(graph, mergedId) ?? {})[valueId];
    expect(AMBIGUOUS_VALUE_TRIGGER.test(detail?.reasoning ?? "")).toBe(false);
  });
});
