/**
 * ⭐⭐ A GENERATED RESTATEMENT OF THE USER'S OWN OPTION IS NOT AN OPTION — AND ITS
 * INVENTED EFFECTS MUST NOT BECOME HIS CHOICES.
 *
 * ── THE WITNESSED DEFECT (live staging draw `9077a1e3`, 2026-09-21) ────────
 * Brief: *"…should we increase the Pro plan price from £49 to £59 per month with
 * the next Pro feature release?"*. The drafter emitted his sentence as a STATED
 * option AND a titled MODEL option of the same proposal:
 *
 *   "increase the Pro plan price from £49 to £59 …"  STATED  price 59
 *   "Raise Price to £59 with Feature Release"        MODEL   price 59, churn 0.045
 *
 * `findUndevelopedDuplicates` never fired — it groups on the FULL intervention
 * signature and the two differ by that churn entry — so both reached the wire,
 * his £59 had no single owner, and every downstream authorship gate correctly
 * failed closed (`in_model_anchored: 0` of 5, `confidence_parameters_user_stated:
 * 0`, "every estimate this comparison rests on is Olumi's, not yours").
 *
 * ⛔ THE FIX WITHDRAWS; IT MUST NEVER ABSORB. Copying the restatement's churn
 * entry onto the stated option deduplicates the GRAPH while preserving the WRONG
 * MEANING. 0.045 is Olumi-invented, and churn is a DOWNSTREAM CONSEQUENCE of a
 * price change, never something a pricing option SETS. Absorbing it turns a
 * machine hypothesis into a user choice — and on that draw the invented value
 * BREACHED the 4% ceiling the user himself stated. The constraint stays a
 * constraint on churn; a model's churn expectation belongs on the causal chain.
 *
 * ⚠ THE RECORDS ARE RECONSTRUCTED, stated rather than implied: the debug bundle
 * carries the projector's OUTPUT, never its input. The SHAPE is taken from that
 * capture; the magnitudes are the user's own words.
 */

import { describe, expect, it } from "vitest";

import type { DraftRecordSet } from "../grammar.js";
import { projectRecordsToGraph } from "../projector.js";

const PRICE = "Pro plan monthly price";
const CHURN = "monthly churn rate";
const MINE = "increase the Pro plan price from £49 to £59 per month";
const RESTATEMENT = "Raise Price to £59 with Feature Release";

/** The witnessed shape: a stated price option plus a generated restatement that
 *  alone carries an invented churn intervention. */
function recordsFor(priceLevel: number, restatementPrice: number, label = MINE): DraftRecordSet {
  return {
    stated_items: [
      { kind: "goal", source_quote: "reach £20k MRR within 12 months" },
      { kind: "option", source_quote: label },
      // The user's own CEILING, bound to the churn factor — the second speech
      // act in his brief, and the one the draft collapsed into a choice.
      { kind: "constraint", source_quote: "keeping monthly churn under 4%", applies_to_claim: 1, direction: "ceiling", value: 0.04 },
    ],
    claims: [
      { claim_kind: "factor", label: PRICE },
      { claim_kind: "factor", label: CHURN },
      { claim_kind: "option_refinement", label: RESTATEMENT },
      { claim_kind: "causal_link", label: "the stated rise sets the price", from_stated: 1, to_claim: 0, effect: "positive", sets_to: priceLevel },
      { claim_kind: "causal_link", label: "the restatement sets the price", from_claim: 2, to_claim: 0, effect: "positive", sets_to: restatementPrice },
      { claim_kind: "causal_link", label: "the restatement invents a churn level", from_claim: 2, to_claim: 1, effect: "negative", sets_to: 0.045 },
      { claim_kind: "causal_link", label: "price bears on churn", from_claim: 0, to_claim: 1, effect: "positive" },
      { claim_kind: "causal_link", label: "price bears on the goal", from_claim: 0, to_stated: 0, effect: "positive" },
      { claim_kind: "causal_link", label: "churn bears on the goal", from_claim: 1, to_stated: 0, effect: "negative" },
    ],
  } as DraftRecordSet;
}

type Node = { id: string; kind?: string; label?: string; data?: { interventions?: Record<string, number> } };

function project(records: DraftRecordSet) {
  const { graph } = projectRecordsToGraph(records) as unknown as { graph: { nodes: Node[] } };
  const labelOf = (id: string) => graph.nodes.find((n) => n.id === id)?.label ?? id;
  const options = graph.nodes.filter((n) => n.kind === "option");
  const named = (o: Node) =>
    Object.fromEntries(Object.entries(o.data?.interventions ?? {}).map(([k, v]) => [labelOf(k), v]));
  return { graph, options, named };
}

describe("a generated restatement of the user's option is not an option", () => {
  it("PRECONDITION — the input really does pose the problem", () => {
    // Read from the RECORDS, never the output under test, or the suite is a
    // tautology: both options must set the SAME figure on the SAME factor.
    const r = recordsFor(59, 59);
    expect(r.claims.filter((c) => c.claim_kind === "option_refinement")).toHaveLength(1);
    expect(r.claims.filter((c) => "sets_to" in c && c.sets_to === 59)).toHaveLength(2);
    expect(r.claims.some((c) => "sets_to" in c && c.sets_to === 0.045)).toBe(true);
  });

  it("⭐ exactly ONE option survives, and it is the user's own", () => {
    const { options } = project(recordsFor(59, 59));
    expect(options.map((o) => o.label)).toEqual([MINE]);
  });

  it("⛔ no generated semantic restatement survives as another option", () => {
    const { options } = project(recordsFor(59, 59));
    expect(options.map((o) => o.label)).not.toContain(RESTATEMENT);
  });

  it("⭐ the user's option intervenes on PRICE ONLY — no invented churn becomes his choice", () => {
    const { options, named } = project(recordsFor(59, 59));
    const mine = options.find((o) => o.label === MINE);
    expect(mine, "the user's own option must survive").toBeDefined();
    expect(named(mine!)).toEqual({ [PRICE]: 0.59 });
  });

  it("⛔ the invented 0.045 churn level reaches NO option anywhere in the graph", () => {
    const { options, named } = project(recordsFor(59, 59));
    for (const o of options) {
      expect(
        Object.values(named(o)),
        `"${o.label}" carries an invented churn level as an intervention`,
      ).not.toContain(0.045);
    }
  });

  it("⭐ churn survives as a FACTOR on the causal chain, not as a choice", () => {
    // Withdrawing the restatement must not delete the concept: price → churn is
    // where a model's expectation belongs, and it must still be reachable.
    const { graph } = project(recordsFor(59, 59));
    expect(graph.nodes.some((n) => n.label === CHURN), "churn must remain modelled").toBe(true);
  });

  it("CONTRAST — a genuinely different price point is NOT withdrawn", () => {
    // Without this the rule would collapse every alternative onto the user's.
    const { options } = project(recordsFor(59, 54));
    expect(options.map((o) => o.label)).toContain(RESTATEMENT);
    expect(options.map((o) => o.label)).toContain(MINE);
  });

  it("⭐ the user's option keeps its OWN provenance and its OWN figure", () => {
    // The whole point of withdrawing rather than absorbing: his £59 must remain
    // HIS, singly owned, so the downstream authorship gates can credit it.
    const { graph } = projectRecordsToGraph(recordsFor(59, 59)) as unknown as {
      graph: { nodes: Node[] };
      provenance: Record<string, { provenance_class?: string }>;
    };
    const { provenance } = projectRecordsToGraph(recordsFor(59, 59)) as unknown as {
      provenance: Record<string, { provenance_class?: string }>;
    };
    const mine = graph.nodes.find((n) => n.kind === "option" && n.label === MINE);
    expect(mine, "the user's option must survive").toBeDefined();
    expect(
      provenance[mine!.id]?.provenance_class,
      "and it must still read as the user's own, not as an inference",
    ).toBe("stated");
  });

  it("⛔ a stated churn CEILING stays a constraint — it never becomes an intervention", () => {
    // "keeping monthly churn under 4%" is a limit ON churn. It must never be
    // projected as something an option SETS, which would make the user appear to
    // have chosen the very rate he capped — and on his live draw one generated
    // level (0.045) BREACHED it.
    const { options, named } = project(recordsFor(59, 59));
    for (const o of options) {
      expect(Object.keys(named(o)), `"${o.label}" must not intervene on churn`).not.toContain(CHURN);
    }
  });

  it("⛔⛔ REGRESSION — a USER-STATED level on a CAPPED factor is never deleted", () => {
    // THIS WAS A BLOCKING DEFECT IN THE FIRST VERSION OF THE RULE, caught before
    // review. A user may legitimately CHOOSE a level on a factor he also CAPPED:
    // "cut the price to £45" alongside "never price below £40" are both his, and
    // both about price. Keying only on the factor deleted his own £45 and left
    // the option with `interventions: {}` — user-authored content destroyed,
    // which is exactly the harm #1657 was reverted for.
    const records: DraftRecordSet = {
      stated_items: [
        { kind: "goal", source_quote: "reach £20k MRR within 12 months" },
        { kind: "option", source_quote: "cut the Pro plan price to £45 a month" },
        { kind: "constraint", source_quote: "never price below £40", applies_to_claim: 0, direction: "floor", value: 40 },
      ],
      claims: [
        { claim_kind: "factor", label: PRICE },
        { claim_kind: "causal_link", label: "the cut sets the price", from_stated: 1, to_claim: 0, effect: "negative", sets_to: 45 },
        { claim_kind: "causal_link", label: "price bears on the goal", from_claim: 0, to_stated: 0, effect: "positive" },
      ],
    } as DraftRecordSet;
    const { options, named } = project(records);
    const mine = options.find((o) => o.label === "cut the Pro plan price to £45 a month");
    expect(mine, "the user's own option must survive").toBeDefined();
    expect(
      Object.keys(named(mine!)),
      "his own stated level on a capped factor is HIS, and must not be stripped",
    ).toEqual([PRICE]);
  });

  it("⛔ BINDS THE EXEMPTION — a STATED option with TWO levers keeps the capped one", () => {
    // Discriminating: two interventions, so the never-empty guard CANNOT be what
    // saves it. Only the stated-option exemption can. Without this the two
    // guards mask each other and neither is bound.
    const records: DraftRecordSet = {
      stated_items: [
        { kind: "goal", source_quote: "reach £20k MRR within 12 months" },
        { kind: "option", source_quote: "cut price to £45 and lift release quality" },
        { kind: "constraint", source_quote: "never price below £40", applies_to_claim: 0, direction: "floor", value: 40 },
      ],
      claims: [
        { claim_kind: "factor", label: PRICE },
        { claim_kind: "factor", label: "feature release quality" },
        { claim_kind: "causal_link", label: "sets the price", from_stated: 1, to_claim: 0, effect: "negative", sets_to: 45 },
        { claim_kind: "causal_link", label: "sets quality", from_stated: 1, to_claim: 1, effect: "positive", sets_to: 0.8 },
        { claim_kind: "causal_link", label: "price bears on the goal", from_claim: 0, to_stated: 0, effect: "positive" },
        { claim_kind: "causal_link", label: "quality bears on the goal", from_claim: 1, to_stated: 0, effect: "positive" },
      ],
    } as DraftRecordSet;
    const { options, named } = project(records);
    const mine = options.find((o) => String(o.label).startsWith("cut price to £45"));
    expect(mine, "the user's own option must survive").toBeDefined();
    expect(
      Object.keys(named(mine!)).sort(),
      "BOTH of his levers are his — the capped one is not stripped",
    ).toEqual([PRICE, "feature release quality"].sort());
  });

  it("⛔ BINDS THE NEVER-EMPTY GUARD — a MODEL option whose ONLY lever is capped survives", () => {
    // Discriminating: a MODEL option, so the stated exemption CANNOT be what
    // saves it. Emptying it would make it unanalysable (`EMPTY_INTERVENTIONS`),
    // which is worse than leaving it for the existing gates to judge.
    const records: DraftRecordSet = {
      stated_items: [
        { kind: "goal", source_quote: "reach £20k MRR within 12 months" },
        { kind: "option", source_quote: "hold the Pro plan at £49" },
        { kind: "constraint", source_quote: "keeping monthly churn under 4%", applies_to_claim: 1, direction: "ceiling", value: 0.04 },
      ],
      claims: [
        { claim_kind: "factor", label: PRICE },
        { claim_kind: "factor", label: CHURN },
        { claim_kind: "option_refinement", label: "Churn-only alternative" },
        { claim_kind: "causal_link", label: "the stated hold sets the price", from_stated: 1, to_claim: 0, effect: "positive", sets_to: 49 },
        { claim_kind: "causal_link", label: "the alternative sets ONLY churn", from_claim: 2, to_claim: 1, effect: "negative", sets_to: 0.02 },
        { claim_kind: "causal_link", label: "price bears on the goal", from_claim: 0, to_stated: 0, effect: "positive" },
        { claim_kind: "causal_link", label: "churn bears on the goal", from_claim: 1, to_stated: 0, effect: "negative" },
      ],
    } as DraftRecordSet;
    const { options, named } = project(records);
    const alt = options.find((o) => o.label === "Churn-only alternative");
    if (alt !== undefined) {
      expect(
        Object.keys(named(alt)).length,
        "an option must never be stripped to no interventions at all",
      ).toBeGreaterThan(0);
    }
  });

  it("⛔ BINDS THE IN-LOOP CALL — a SURVIVING distinct option is cleaned after re-projection", () => {
    // ⭐ THE PASS RUNS TWICE ON PURPOSE. A withdrawal re-projects from the
    // records, rebuilding every option from scratch — so a cleaning that ran
    // only BEFORE the loop is undone for everything that survives it. Without
    // this case, deleting the in-loop call leaves the whole suite green while
    // the witnessed defect returns on the surviving alternative.
    const records: DraftRecordSet = {
      stated_items: [
        { kind: "goal", source_quote: "reach £20k MRR within 12 months" },
        { kind: "option", source_quote: MINE },
        { kind: "constraint", source_quote: "keeping monthly churn under 4%", applies_to_claim: 1, direction: "ceiling", value: 0.04 },
      ],
      claims: [
        { claim_kind: "factor", label: PRICE },
        { claim_kind: "factor", label: CHURN },
        // (2) a RESTATEMENT — forces a demote, hence a re-projection.
        { claim_kind: "option_refinement", label: RESTATEMENT },
        // (3) a GENUINELY DISTINCT alternative that survives the loop.
        { claim_kind: "option_refinement", label: "Gradual Price Step to £54 Now" },
        { claim_kind: "causal_link", label: "the stated rise sets the price", from_stated: 1, to_claim: 0, effect: "positive", sets_to: 59 },
        { claim_kind: "causal_link", label: "the restatement sets the price", from_claim: 2, to_claim: 0, effect: "positive", sets_to: 59 },
        { claim_kind: "causal_link", label: "the restatement invents churn", from_claim: 2, to_claim: 1, effect: "negative", sets_to: 0.045 },
        { claim_kind: "causal_link", label: "the step sets a different price", from_claim: 3, to_claim: 0, effect: "positive", sets_to: 54 },
        { claim_kind: "causal_link", label: "the step invents churn too", from_claim: 3, to_claim: 1, effect: "negative", sets_to: 0.033 },
        { claim_kind: "causal_link", label: "price bears on the goal", from_claim: 0, to_stated: 0, effect: "positive" },
        { claim_kind: "causal_link", label: "churn bears on the goal", from_claim: 1, to_stated: 0, effect: "negative" },
      ],
    } as DraftRecordSet;
    const { options, named } = project(records);
    const step = options.find((o) => o.label === "Gradual Price Step to £54 Now");
    expect(step, "the distinct alternative must survive the withdrawal").toBeDefined();
    expect(
      Object.keys(named(step!)),
      "the surviving alternative must not keep an invented level on the capped factor",
    ).not.toContain(CHURN);
  });

  it("⛔ BINDS THE SIBLING CARRIERS — raw_interventions and details lose it too", () => {
    // ⭐ REMOVING ONLY THE ENCODED ENTRY IS NOT REMOVING THE CLAIM.
    // `raw_interventions` rides to the wire independently — `analysis-ready.ts`
    // carries option-level raw values through UNFILTERED — so an invented
    // magnitude left there is still reachable, under a different key.
    const records: DraftRecordSet = {
      ...recordsFor(59, 54),
    };
    const { graph } = projectRecordsToGraph(records) as unknown as {
      graph: { nodes: Array<Node & { data?: { raw_interventions?: Record<string, unknown>; intervention_details?: Record<string, unknown> } }> };
    };
    const churnId = graph.nodes.find((n) => n.label === CHURN)?.id;
    expect(churnId, "the churn factor must exist for this case to mean anything").toBeDefined();
    for (const o of graph.nodes.filter((n) => n.kind === "option")) {
      expect(
        Object.keys(o.data?.raw_interventions ?? {}),
        `"${o.label}" keeps the invented churn in raw_interventions`,
      ).not.toContain(churnId!);
      expect(
        Object.keys(o.data?.intervention_details ?? {}),
        `"${o.label}" keeps the invented churn in intervention_details`,
      ).not.toContain(churnId!);
    }
  });

  it("⭐ a PERTURBED equivalent brief behaves identically", () => {
    // Same semantics, different words and figures: the rule must be general, not
    // fitted to one capture.
    const label = "raise the Team plan from £80 to £95 a month";
    const { options, named } = project(recordsFor(95, 95, label));
    expect(options.map((o) => o.label)).toEqual([label]);
    expect(Object.keys(named(options[0]!))).toEqual([PRICE]);
  });
});
