/**
 * ⭐⭐ A FACTOR THE OPTIONS SET TO DIFFERENT LEVELS IS THE COMPARISON ITSELF —
 * AND THE CONNECTIVITY PRUNE WAS DELETING IT.
 *
 * ── THE WITNESSED DEFECT ───────────────────────────────────────────────────
 * Brief: *"hiring one senior tech lead at £110k, or two mid-level developers at
 * £70k each"*, with a £400k ARR renewal at risk. The drafted model put £110k and
 * £70k in the OPTION LABELS, created factors for leadership / throughput /
 * coordination / release probability, and carried NO COST ANYWHERE: measured
 * from the rendered DOM, the string "cost" appeared nowhere on the page. So the
 * comparison could not see that one option costs £110k and the other £140k.
 *
 * ── WHAT WAS DERIVED, BY EXECUTING THE PROJECTOR (not by reading it) ───────
 * Four record sets were run through `projectRecordsToGraph` at `ae6284b8`:
 *
 *   ARM A  model authors the cost factor AND chains it onward to an outcome
 *          → WORKS. One factor, both options carrying `raw_interventions`
 *            110000 / 140000, provenance `brief_extraction` / `cee_hypothesis`
 *            + `composed_citation` (the ×2 the model did on "£70k each").
 *   ARM B  model never authors a cost factor at all
 *          → cost absent. Nothing downstream can recover it.
 *   ARM C  model authors the cost factor, sets it per option with `sets_to`,
 *          and omits ONLY the onward link
 *          → **the factor and BOTH magnitudes are silently deleted.**
 *   ARM D  ARM C plus one `factor → goal` link
 *          → WORKS, identically to ARM A.
 *
 * **The delta between "the cost is deleted" and "the cost is modelled" is
 * exactly one edge.** That is what this file pins, and ARM C is its subject.
 *
 * ── WHY THE PRUNE WAS RIGHT AND STILL WRONG HERE (trap 21) ────────────────
 * Pass 3b's own derivation is sound for the class it was measured on: on a live
 * draft, 8 of 17 unreachable nodes were *stated figures* — "£3.1m cash",
 * "NRR is 112%" — that the model **correctly declined to connect** because they
 * do not bear on the goal. Forcing those in manufactures a machine-authored
 * causal claim; the prune discloses them instead. Correct.
 *
 * A factor that an option SETS TO A VALUE is not that class. The model did not
 * decline to connect it — it connected it to the options, with magnitudes, and
 * omitted only the onward hop. One predicate was answering two questions:
 *
 *   · "the model never connected this record"        → disclose, do not force.
 *   · "the model made this a comparison dimension
 *      and forgot to chain it"                       → the magnitudes are the
 *                                                      user's own quantities,
 *                                                      and deleting them is the
 *                                                      louder harm.
 *
 * The prune itself ranks the alternatives: FORCE IT IN (machine-authored claim)
 * / DROP IT ("silently lose something the user said — the second worst") /
 * DISCLOSE. For this class dropping is not mitigated by disclosure, because what
 * is lost is not a stray figure but the only quantified comparison between the
 * options. The bridge minted here is `factor → goal`, which is a shape the
 * served instruction explicitly sanctions ("A factor linked straight to the goal
 * has to be bridged for you") and which `fixFactorGoalEdges` already bridges and
 * discloses downstream. It invents no VALUE — every magnitude is the model's.
 *
 * ── ⚠ WHAT THIS FILE DOES *NOT* CLAIM ──────────────────────────────────────
 * It does NOT claim ARM C is what happened on the witnessed build. The DOM
 * evidence ("cost" appears nowhere) is consistent with ARM B and ARM C alike,
 * and no record set was captured. What is established is that ARM C is a live
 * mechanism that destroys stated per-option quantities, and that it is fixed
 * deterministically. ARM B — the model never authoring the factor — is a
 * GENERATION-time gap and is NOT addressed here; see the PR body.
 *
 * ── BINDING (trap 19) ──────────────────────────────────────────────────────
 * Every assertion locates the factor by its EXACT label and then reads that
 * factor's MINTED ID out of each option's intervention map. No assertion is
 * satisfiable by a different node that happens to carry the same number, and
 * the two discriminating controls below prove the rescue is bound to
 * "an option sets this factor to a value" rather than to "keep everything".
 */
import { describe, expect, it } from "vitest";
import { projectRecordsToGraph } from "../projector.js";
import type { DraftRecordSet } from "../grammar.js";

const BRIEF =
  "We are weighing hiring one senior tech lead at £110k, or two mid-level developers at £70k each. " +
  "A £400k ARR renewal is at risk if we cannot ship the integration on time.";

const COST_LABEL = "Annual Staffing Cost";
const SENIOR_QUOTE = "hiring one senior tech lead at £110k";
const MIDS_QUOTE = "two mid-level developers at £70k each";

/**
 * The producer's semantics, restated so the expectations below are derived from
 * them rather than from whatever the code currently emits (trap 13c):
 *
 *   `sets_to` — "the value the target factor takes if that option is chosen, in
 *   the factor's own unit" (`grammar.ts`, `DraftInferenceClaim.sets_to`).
 *   It "becomes an entry in the option node's `OptionData.interventions`
 *   (`schemas/graph.ts:163`), which is what lets the analysis compute a real
 *   number rather than compare bare labels."
 *
 * `raw_interventions` is that value in the factor's OWN unit; `interventions`
 * is the same value after the projector's scale frame. The modelled quantity the
 * user stated is therefore the RAW one, which is what these tests read.
 */
const SENIOR_COST = 110_000;
const MIDS_COST = 140_000;

type Projection = ReturnType<typeof projectRecordsToGraph>;

/** Locate a node by EXACT label. Fails loud on 0 or 2+, so no assertion can drift onto a sibling. */
function idOf(projection: Projection, label: string): string {
  const hits = projection.graph.nodes.filter((n) => n.label === label);
  if (hits.length !== 1) {
    throw new Error(
      `expected exactly one node labelled ${JSON.stringify(label)}, found ${hits.length}: ` +
        JSON.stringify(projection.graph.nodes.map((n) => `${n.kind}:${n.label}`)),
    );
  }
  return hits[0]!.id;
}

function hasNodeLabelled(projection: Projection, label: string): boolean {
  return projection.graph.nodes.some((n) => n.label === label);
}

function rawInterventionsOf(projection: Projection, optionQuoteLabel: string): Record<string, number> {
  const option = projection.graph.nodes.find(
    (n) => n.kind === "option" && n.label.toLowerCase() === optionQuoteLabel.toLowerCase(),
  );
  if (!option) {
    throw new Error(
      `no option node for ${JSON.stringify(optionQuoteLabel)}: ` +
        JSON.stringify(projection.graph.nodes.filter((n) => n.kind === "option").map((n) => n.label)),
    );
  }
  return ((option.data as { raw_interventions?: Record<string, number> } | undefined)?.raw_interventions) ?? {};
}

/** The shared spine: a goal, two options, the two stated money figures, and a non-cost factor
 *  chain so the OPTIONS themselves are never the thing at risk — only the cost factor is. */
function baseStatedItems(): DraftRecordSet["stated_items"] {
  return [
    { kind: "goal", source_quote: "A £400k ARR renewal is at risk", value: 400_000, unit: "£", role: "baseline" },
    { kind: "option", source_quote: SENIOR_QUOTE, is_baseline: false },
    { kind: "option", source_quote: MIDS_QUOTE, is_baseline: false },
    { kind: "figure", source_quote: "£110k", value: 110_000, unit: "£", role: "context" },
    { kind: "figure", source_quote: "£70k each", value: 70_000, unit: "£", role: "context" },
  ];
}

/**
 * ARM C, verbatim: the cost factor is set by BOTH options with the stated
 * magnitudes, and the model omitted only the onward chain. The leadership factor
 * carries the options' route to the goal, so nothing here depends on the options
 * being rescued — the cost factor alone is under test.
 */
function armCRecords(): DraftRecordSet {
  return {
    stated_items: baseStatedItems(),
    claims: [
      { claim_kind: "factor", label: COST_LABEL, basis: [3, 4] },
      { claim_kind: "factor", label: "Technical Leadership" },
      { claim_kind: "outcome", label: "On-Time Release" },
      { claim_kind: "causal_link", label: "senior lead sets staffing cost", from_stated: 1, to_claim: 0, sets_to: SENIOR_COST, effect: "negative", basis: [1, 3] },
      { claim_kind: "causal_link", label: "two mids set staffing cost", from_stated: 2, to_claim: 0, sets_to: MIDS_COST, effect: "negative", basis: [2, 4] },
      { claim_kind: "causal_link", label: "senior lead sets leadership", from_stated: 1, to_claim: 1, sets_to: 0.8, effect: "positive" },
      { claim_kind: "causal_link", label: "two mids set leadership", from_stated: 2, to_claim: 1, sets_to: 0.4, effect: "positive" },
      { claim_kind: "causal_link", label: "leadership drives release", from_claim: 1, to_claim: 2, effect: "positive" },
      { claim_kind: "causal_link", label: "release drives goal", from_claim: 2, to_stated: 0, effect: "positive" },
    ],
  };
}

describe("a factor the options set to different levels survives the connectivity prune", () => {
  it("ARM C — the stated per-option costs reach the graph as one factor with DIFFERING interventions", () => {
    const projection = projectRecordsToGraph(armCRecords(), BRIEF);

    // The factor itself is on the graph, located by identity.
    expect(hasNodeLabelled(projection, COST_LABEL)).toBe(true);
    const costId = idOf(projection, COST_LABEL);

    // ⭐ THE OUTCOME THE LANE IS FOR: the money is a MODELLED QUANTITY keyed on
    // that factor's minted id, on BOTH options, and the two DIFFER. A label
    // change cannot satisfy any line of this.
    const senior = rawInterventionsOf(projection, SENIOR_QUOTE);
    const mids = rawInterventionsOf(projection, MIDS_QUOTE);
    expect(senior[costId]).toBe(SENIOR_COST);
    expect(mids[costId]).toBe(MIDS_COST);
    expect(senior[costId]).not.toBe(mids[costId]);

    // And the comparison is real at the analysis's own read site too.
    const normalised = projection.graph.nodes
      .filter((n) => n.kind === "option")
      .map((n) => (n.data as { interventions?: Record<string, number> } | undefined)?.interventions?.[costId]);
    expect(normalised.every((v) => typeof v === "number")).toBe(true);
    expect(new Set(normalised).size).toBe(2);
  });

  it("ARM C — the rescue is DISCLOSED: the minted bridge is a projector scaffold, never passed off as the model's", () => {
    const projection = projectRecordsToGraph(armCRecords(), BRIEF);
    const costId = idOf(projection, COST_LABEL);
    const goalId = projection.graph.nodes.find((n) => n.kind === "goal")!.id;

    const bridge = projection.graph.edges.find((e) => e.from === costId && e.to === goalId);
    expect(bridge, "a factor->goal bridge must exist for the option-set factor").toBeDefined();
    // Structural, not inferred: the model did not draw this link and the badge
    // must not claim it did.
    expect(bridge!.provenance_source).toBe("structural");
    expect(bridge!.origin).toBe("default");
    // `source: "synthetic"` is what `mapToV3ProvenanceSource` routes to the
    // ai_inferred badge — never to `from_brief` or `user_set`.
    expect(bridge!.provenance?.source).toBe("synthetic");
    const quote = bridge!.provenance?.quote ?? "";
    expect(quote.length).toBeGreaterThan(0);
    expect(quote.length).toBeLessThanOrEqual(100);
    // The consumer's badge router is a lowercased SUBSTRING matcher: any of
    // these tokens in `source`/`quote` would tell the user their own brief
    // authored a link the projector minted.
    for (const forbidden of ["brief", "document", "evidence", "user", "specified", "manual"]) {
      expect(quote.toLowerCase()).not.toContain(forbidden);
      expect((bridge!.provenance?.source ?? "").toLowerCase()).not.toContain(forbidden);
    }
  });

  it("ARM D — the already-working path (model drew the onward link) is unchanged", () => {
    const records = armCRecords();
    records.claims.push({
      claim_kind: "causal_link",
      label: "staffing cost bears on the renewal",
      from_claim: 0,
      to_stated: 0,
      effect: "negative",
    });
    const projection = projectRecordsToGraph(records, BRIEF);
    const costId = idOf(projection, COST_LABEL);
    expect(rawInterventionsOf(projection, SENIOR_QUOTE)[costId]).toBe(SENIOR_COST);
    expect(rawInterventionsOf(projection, MIDS_QUOTE)[costId]).toBe(MIDS_COST);
  });

  // ── THE DISCRIMINATING CONTROLS ────────────────────────────────────────────
  // Without these, the tests above pass equally on "never prune anything", which
  // would reopen the defect Pass 3b was built to close.

  it("CONTROL — a bare stated figure no option sets is STILL dropped, not rescued", () => {
    const records = armCRecords();
    // A figure the model correctly declined to connect. This is the exact class
    // Pass 3b was measured on and must keep dropping.
    records.stated_items.push({
      kind: "figure",
      source_quote: "NRR is 112%",
      value: 112,
      unit: "%",
      role: "context",
    });
    const projection = projectRecordsToGraph(records, BRIEF);
    expect(hasNodeLabelled(projection, "NRR Is 112%")).toBe(false);
    expect(
      projection.dropped.some((d) => d.reason === "unconnected_to_goal"),
      "the untouched class must still reach the disclosure channel",
    ).toBe(true);
    // ...while the option-set factor is rescued in the SAME projection, so the
    // two classes are provably being told apart rather than treated alike.
    expect(hasNodeLabelled(projection, COST_LABEL)).toBe(true);
  });

  it("CONTROL — an option→factor link with NO magnitude is STILL dropped: the rescue is bound to the VALUE", () => {
    const records: DraftRecordSet = {
      stated_items: baseStatedItems(),
      claims: [
        // Same shape as the cost factor — an option points at it — but neither
        // link carries `sets_to`, so nothing quantified is lost by dropping it.
        { claim_kind: "factor", label: "Team Morale" },
        { claim_kind: "factor", label: "Technical Leadership" },
        { claim_kind: "outcome", label: "On-Time Release" },
        { claim_kind: "causal_link", label: "senior lead affects morale", from_stated: 1, to_claim: 0, effect: "positive" },
        { claim_kind: "causal_link", label: "two mids affect morale", from_stated: 2, to_claim: 0, effect: "positive" },
        { claim_kind: "causal_link", label: "senior lead sets leadership", from_stated: 1, to_claim: 1, sets_to: 0.8, effect: "positive" },
        { claim_kind: "causal_link", label: "two mids set leadership", from_stated: 2, to_claim: 1, sets_to: 0.4, effect: "positive" },
        { claim_kind: "causal_link", label: "leadership drives release", from_claim: 1, to_claim: 2, effect: "positive" },
        { claim_kind: "causal_link", label: "release drives goal", from_claim: 2, to_stated: 0, effect: "positive" },
      ],
    };
    const projection = projectRecordsToGraph(records, BRIEF);
    expect(hasNodeLabelled(projection, "Team Morale")).toBe(false);
    // Positive control in the same projection: the magnitude-bearing factor the
    // options DO set is kept, so this control cannot be passing because the
    // rescue is simply inert.
    expect(hasNodeLabelled(projection, "Technical Leadership")).toBe(true);
  });

  it("CONTROL — a factor only ONE option quantifies is STILL dropped: the rescue is bound to the COMPARISON", () => {
    // ⭐ THIS BOUND WAS SET BY THE REPO, NOT BY THIS AUTHOR. The first version of
    // the rescue read "some option sets it to a value", and
    // `option-budget-and-interventions.test.ts`'s *"never names a factor the
    // connectivity prune withdrew"* went RED on it — that fixture has ONE option
    // setting an orphan factor to 77 and pins the orphan as droppable. It is
    // right: one option putting a number on a factor is not a comparison, and
    // keeping it would ask the user to supply the missing side. Pinned here as
    // well as there, so the bound is visible where the rule is explained.
    const records: DraftRecordSet = {
      stated_items: baseStatedItems(),
      claims: [
        // Quantified, unchained — identical to the cost factor in every respect
        // EXCEPT that only one option puts a number on it.
        { claim_kind: "factor", label: "Recruiter Fee" },
        { claim_kind: "factor", label: "Technical Leadership" },
        { claim_kind: "outcome", label: "On-Time Release" },
        { claim_kind: "causal_link", label: "senior lead sets recruiter fee", from_stated: 1, to_claim: 0, sets_to: 18_000, effect: "negative" },
        { claim_kind: "causal_link", label: "senior lead sets leadership", from_stated: 1, to_claim: 1, sets_to: 0.8, effect: "positive" },
        { claim_kind: "causal_link", label: "two mids set leadership", from_stated: 2, to_claim: 1, sets_to: 0.4, effect: "positive" },
        { claim_kind: "causal_link", label: "leadership drives release", from_claim: 1, to_claim: 2, effect: "positive" },
        { claim_kind: "causal_link", label: "release drives goal", from_claim: 2, to_stated: 0, effect: "positive" },
      ],
    };
    const projection = projectRecordsToGraph(records, BRIEF);
    expect(hasNodeLabelled(projection, "Recruiter Fee")).toBe(false);
    // Same-projection positive control, so this cannot be green because the
    // rescue stopped working altogether.
    expect(hasNodeLabelled(projection, "Technical Leadership")).toBe(true);
  });
});
