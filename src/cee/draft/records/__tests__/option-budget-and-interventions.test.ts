/**
 * TWO PROJECTOR OBLIGATIONS ADDED FOR INSTRUCTION v3, PINNED SEPARATELY.
 *
 *   1. THE OPTION BUDGET. The projector mints an option per stated option AND per
 *      `option_refinement` claim, so the minted count can exceed the validator's
 *      `MAX_OPTIONS` while the user named only two or three things. Measured on the
 *      banked corpus: minted options ran 3..7 against a bound of 6.
 *   2. INTERVENTIONS. `sets_to` on an option→factor link becomes an entry in
 *      `OptionData.interventions`, which is the only thing that lets the analysis
 *      compute a number rather than compare bare labels.
 *
 * ⭐ EVERY ASSERTION BINDS BY IDENTITY — the minted id of a factor located by its
 * exact label — never by a value predicate another node could satisfy. A test that
 * finds "the factor whose value is 60" passes on whichever node happens to match,
 * and this estate has shipped that defect.
 */
import { describe, expect, it } from "vitest";
import { projectRecordsToGraph } from "../projector.js";
import { MAX_OPTIONS } from "../../../../validators/graph-validator.types.js";
import type { DraftRecordSet } from "../grammar.js";

/** Locate a node by its EXACT label and return its minted id. Fails loud if absent. */
function idOf(graph: { nodes: Array<{ id: string; label: string }> }, label: string): string {
  const hits = graph.nodes.filter((n) => n.label === label);
  // A label that resolves to 0 or 2+ nodes makes every downstream assertion
  // ambiguous, so it is an error here rather than a silent first-match.
  expect(hits, `expected exactly one node labelled "${label}"`).toHaveLength(1);
  return hits[0]!.id;
}

const interventionsOf = (
  graph: { nodes: Array<{ id: string; data?: Record<string, unknown> }> },
  optionId: string,
): Record<string, number> | undefined =>
  graph.nodes.find((n) => n.id === optionId)?.data?.interventions as Record<string, number> | undefined;

describe("interventions are the model's stated magnitudes, and nothing else", () => {
  const RECORDS: DraftRecordSet = {
    stated_items: [
      { kind: "goal", source_quote: "raise sales productivity" },
      { kind: "option", source_quote: "replace the CRM" },
      { kind: "option", source_quote: "keep what we have" },
    ],
    claims: [
      { claim_kind: "factor", label: "licence cost" },
      { claim_kind: "factor", label: "rep hours saved" },
      { claim_kind: "causal_link", label: "the new CRM costs more", from_ref: "s1", to_ref: "c0", effect: "negative", sets_to: 240000 },
      { claim_kind: "causal_link", label: "the new CRM saves hours", from_ref: "s1", to_ref: "c1", effect: "positive", sets_to: 12 },
      // Deliberately NO sets_to: the status quo's magnitude was not stated.
      { claim_kind: "causal_link", label: "the status quo holds cost flat", from_ref: "s2", to_ref: "c0", effect: "positive" },
      { claim_kind: "causal_link", label: "cost bears on the goal", from_ref: "c0", to_ref: "s0", effect: "negative" },
      { claim_kind: "causal_link", label: "hours saved bear on the goal", from_ref: "c1", to_ref: "s0", effect: "positive" },
    ],
  };

  it("keys each stated magnitude by the minted id of the factor it names", () => {
    const { graph } = projectRecordsToGraph(RECORDS);
    const newCrm = idOf(graph, "replace the CRM");
    const cost = idOf(graph, "licence cost");
    const hours = idOf(graph, "rep hours saved");

    expect(interventionsOf(graph, newCrm)).toEqual({ [cost]: 240000, [hours]: 12 });
  });

  it("gives an option with no stated magnitude NO interventions key at all", () => {
    // Not an empty object: `{}` is a sentinel the sweep strips, and it would claim
    // we looked and found nothing — which is not what happened. The absence is the
    // honest report that the model stated no magnitude for this option.
    const { graph } = projectRecordsToGraph(RECORDS);
    const statusQuo = idOf(graph, "keep what we have");
    const node = graph.nodes.find((n) => n.id === statusQuo)!;
    expect(interventionsOf(graph, statusQuo)).toBeUndefined();
    expect(node.data === undefined || !("interventions" in (node.data as object))).toBe(true);
  });

  it("invents no magnitude — every entry traces to a sets_to the model emitted", () => {
    const { graph } = projectRecordsToGraph(RECORDS);
    const stated = new Set(
      RECORDS.claims.filter((c) => typeof c.sets_to === "number").map((c) => c.sets_to!),
    );
    const emitted = graph.nodes.flatMap((n) =>
      Object.values((n.data?.interventions ?? {}) as Record<string, number>),
    );
    expect(emitted.length).toBeGreaterThan(0); // positive control: the check can see a presence
    for (const v of emitted) expect(stated).toContain(v);
  });

  it("ignores sets_to on a link that is not option→factor", () => {
    // `sets_to` means "the level this OPTION puts this FACTOR at". On a factor→goal
    // link it means nothing, and honouring it would put an intervention on a node
    // that cannot carry one.
    const { graph } = projectRecordsToGraph({
      stated_items: [
        { kind: "goal", source_quote: "raise sales productivity" },
        { kind: "option", source_quote: "replace the CRM" },
        { kind: "option", source_quote: "keep what we have" },
      ],
      claims: [
        { claim_kind: "factor", label: "licence cost" },
        { claim_kind: "factor", label: "renewal risk" },
        { claim_kind: "causal_link", label: "the new CRM moves cost", from_ref: "s1", to_ref: "c0", effect: "negative" },
        { claim_kind: "causal_link", label: "the status quo moves cost", from_ref: "s2", to_ref: "c0", effect: "positive" },
        // FACTOR→FACTOR carrying a magnitude. This is the case that discriminates
        // the source check: the target IS a factor, so a projector that only
        // checked the TARGET kind would happily mint an intervention here — on a
        // factor node, which cannot carry one. A mutant proved an earlier version
        // of this test blind, because its only fixture was factor→GOAL, which the
        // target check rejects on its own.
        { claim_kind: "causal_link", label: "cost drives renewal risk", from_ref: "c0", to_ref: "c1", effect: "negative", sets_to: 888 },
        { claim_kind: "causal_link", label: "cost bears on the goal", from_ref: "c0", to_ref: "s0", effect: "negative", sets_to: 999 },
        { claim_kind: "causal_link", label: "renewal risk bears on the goal", from_ref: "c1", to_ref: "s0", effect: "negative" },
      ],
    });
    for (const n of graph.nodes) {
      const values = Object.values((n.data?.interventions ?? {}) as Record<string, number>);
      expect(values).not.toContain(999); // factor→goal
      expect(values).not.toContain(888); // factor→factor
    }
    // Nothing but options carries interventions at all.
    for (const n of graph.nodes.filter((x) => x.kind !== "option")) {
      expect(n.data === undefined || !("interventions" in (n.data as object))).toBe(true);
    }
  });

  it("ignores sets_to on an option link whose TARGET is not a factor", () => {
    // The mirror of the previous case, and the one a mutant proved was missing:
    // `interventions` is keyed by FACTOR id. An option→goal link carrying a
    // magnitude would mint an entry keyed by the goal — a target that cannot hold
    // an intervention, and a dangling ref to the analysis. The model can plausibly
    // emit this shape, so the guard is load-bearing rather than defensive.
    const { graph } = projectRecordsToGraph({
      stated_items: [
        { kind: "goal", source_quote: "raise sales productivity" },
        { kind: "option", source_quote: "replace the CRM" },
        { kind: "option", source_quote: "keep what we have" },
      ],
      claims: [
        { claim_kind: "factor", label: "rep hours saved" },
        { claim_kind: "causal_link", label: "the new CRM saves hours", from_ref: "s1", to_ref: "c0", effect: "positive", sets_to: 12 },
        { claim_kind: "causal_link", label: "the new CRM lifts the goal directly", from_ref: "s1", to_ref: "s0", effect: "positive", sets_to: 555 },
        { claim_kind: "causal_link", label: "the status quo holds hours flat", from_ref: "s2", to_ref: "c0", effect: "negative" },
        { claim_kind: "causal_link", label: "hours bear on the goal", from_ref: "c0", to_ref: "s0", effect: "positive" },
      ],
    });
    const goalId = idOf(graph, "raise sales productivity");
    const newCrm = idOf(graph, "replace the CRM");
    const built = interventionsOf(graph, newCrm) ?? {};
    expect(Object.keys(built)).not.toContain(goalId);
    expect(Object.values(built)).not.toContain(555);
    // The legitimate magnitude on the same option survives — so this is not
    // passing because interventions were dropped wholesale.
    expect(built).toEqual({ [idOf(graph, "rep hours saved")]: 12 });
  });

  it("never names a factor the connectivity prune withdrew", () => {
    // A dangling `interventions` key is INVALID_INTERVENTION_REF downstream. The
    // orphan factor here reaches no goal, so it is disclosed and must not survive
    // as an intervention target.
    const { graph, dropped } = projectRecordsToGraph({
      stated_items: [
        { kind: "goal", source_quote: "raise sales productivity" },
        { kind: "option", source_quote: "replace the CRM" },
        { kind: "option", source_quote: "keep what we have" },
      ],
      claims: [
        { claim_kind: "factor", label: "rep hours saved" },
        { claim_kind: "factor", label: "an orphan nobody connected" },
        { claim_kind: "causal_link", label: "the new CRM saves hours", from_ref: "s1", to_ref: "c0", effect: "positive", sets_to: 12 },
        { claim_kind: "causal_link", label: "the new CRM touches the orphan", from_ref: "s1", to_ref: "c1", effect: "positive", sets_to: 77 },
        { claim_kind: "causal_link", label: "the status quo holds hours flat", from_ref: "s2", to_ref: "c0", effect: "negative" },
        { claim_kind: "causal_link", label: "hours bear on the goal", from_ref: "c0", to_ref: "s0", effect: "positive" },
      ],
    });
    expect(dropped.map((d) => d.label)).toContain("an orphan nobody connected");
    const liveIds = new Set(graph.nodes.map((n) => n.id));
    for (const n of graph.nodes) {
      for (const factorId of Object.keys((n.data?.interventions ?? {}) as Record<string, number>)) {
        expect(liveIds.has(factorId)).toBe(true);
      }
    }
    // And the surviving magnitude is still there — so the assertion above is not
    // passing merely because interventions were emptied wholesale.
    const newCrm = idOf(graph, "replace the CRM");
    expect(interventionsOf(graph, newCrm)).toEqual({ [idOf(graph, "rep hours saved")]: 12 });
  });
});

describe("the option budget is the validator's own, and overflow is disclosed", () => {
  /** Three stated options + five refinements = 8 minted, against a bound of 6. */
  const OVER_BUDGET: DraftRecordSet = {
    stated_items: [
      { kind: "goal", source_quote: "raise sales productivity" },
      { kind: "option", source_quote: "replace the CRM" },
      { kind: "option", source_quote: "keep what we have" },
      { kind: "option", source_quote: "buy the add-on" },
    ],
    claims: [
      { claim_kind: "factor", label: "rep hours saved" },
      { claim_kind: "option_refinement", label: "replace the CRM, phased" },
      { claim_kind: "option_refinement", label: "replace the CRM, big bang" },
      { claim_kind: "option_refinement", label: "keep it but retrain" },
      { claim_kind: "option_refinement", label: "keep it but re-licence" },
      { claim_kind: "option_refinement", label: "buy the add-on and retrain" },
      { claim_kind: "causal_link", label: "the new CRM saves hours", from_ref: "s1", to_ref: "c0", effect: "positive" },
      { claim_kind: "causal_link", label: "hours bear on the goal", from_ref: "c0", to_ref: "s0", effect: "positive" },
    ],
  };

  it("holds the minted option set at MAX_OPTIONS", () => {
    const { graph } = projectRecordsToGraph(OVER_BUDGET);
    expect(graph.nodes.filter((n) => n.kind === "option")).toHaveLength(MAX_OPTIONS);
  });

  it("discloses every surrendered refinement by label, and never silently truncates", () => {
    const { dropped } = projectRecordsToGraph(OVER_BUDGET);
    const budgetDrops = dropped.filter((d) => d.reason === "option_budget_exceeded");
    // 3 stated + 5 refinements = 8 minted; 8 − 6 = 2 surrendered.
    expect(budgetDrops).toHaveLength(2);
    // Surrendered in REVERSE emission order, so the outcome is deterministic.
    expect(budgetDrops.map((d) => d.label)).toEqual([
      "buy the add-on and retrain",
      "keep it but re-licence",
    ]);
  });

  it("never surrenders an option the USER stated", () => {
    // Dropping a user's own option narrows their choice set, which is the one
    // thing a decision tool may not do. Eight stated options exceed the bound;
    // all eight must survive and the rejection must be allowed to fire visibly.
    const { graph, dropped } = projectRecordsToGraph({
      stated_items: [
        { kind: "goal", source_quote: "raise sales productivity" },
        ...Array.from({ length: 8 }, (_, i) => ({
          kind: "option" as const,
          source_quote: `stated option ${i}`,
        })),
      ],
      claims: [],
    });
    expect(graph.nodes.filter((n) => n.kind === "option")).toHaveLength(8);
    expect(dropped.filter((d) => d.reason === "option_budget_exceeded")).toHaveLength(0);
  });

  it("bites at exactly one over the bound, not merely far over it", () => {
    // BOUNDARY. A mutant that loosened the trigger to `> MAX_OPTIONS + 1` survived
    // the 8-option fixture above, because 8 exceeds both bounds and the surrender
    // count is computed separately. Only a set at exactly MAX_OPTIONS + 1 tells the
    // two apart — a guard tested solely in the middle of its range is untested at
    // its edge, which is where off-by-one lives.
    const { graph, dropped } = projectRecordsToGraph({
      stated_items: [
        { kind: "goal", source_quote: "raise sales productivity" },
        { kind: "option", source_quote: "replace the CRM" },
        { kind: "option", source_quote: "keep what we have" },
      ],
      claims: [
        { claim_kind: "factor", label: "rep hours saved" },
        ...Array.from({ length: 5 }, (_, i) => ({
          claim_kind: "option_refinement" as const,
          label: `refinement ${i}`,
        })),
        { claim_kind: "causal_link" as const, label: "the new CRM saves hours", from_ref: "s1", to_ref: "c0", effect: "positive" as const },
        { claim_kind: "causal_link" as const, label: "hours bear on the goal", from_ref: "c0", to_ref: "s0", effect: "positive" as const },
      ],
    });
    // 2 stated + 5 refinements = 7 minted, exactly one over MAX_OPTIONS.
    expect(graph.nodes.filter((n) => n.kind === "option")).toHaveLength(MAX_OPTIONS);
    expect(dropped.filter((d) => d.reason === "option_budget_exceeded")).toHaveLength(1);
  });

  it("leaves a within-budget set completely untouched", () => {
    // The positive control's twin: a guard that fires on everything is not a guard.
    const { graph, dropped } = projectRecordsToGraph({
      stated_items: [
        { kind: "goal", source_quote: "raise sales productivity" },
        { kind: "option", source_quote: "replace the CRM" },
        { kind: "option", source_quote: "keep what we have" },
      ],
      claims: [
        { claim_kind: "factor", label: "rep hours saved" },
        { claim_kind: "causal_link", label: "the new CRM saves hours", from_ref: "s1", to_ref: "c0", effect: "positive" },
        { claim_kind: "causal_link", label: "the status quo holds hours flat", from_ref: "s2", to_ref: "c0", effect: "negative" },
        { claim_kind: "causal_link", label: "hours bear on the goal", from_ref: "c0", to_ref: "s0", effect: "positive" },
      ],
    });
    expect(graph.nodes.filter((n) => n.kind === "option")).toHaveLength(2);
    expect(dropped.filter((d) => d.reason === "option_budget_exceeded")).toHaveLength(0);
  });
});
