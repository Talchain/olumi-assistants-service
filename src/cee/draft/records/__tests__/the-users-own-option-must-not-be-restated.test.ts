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

  it("⭐ a PERTURBED equivalent brief behaves identically", () => {
    // Same semantics, different words and figures: the rule must be general, not
    // fitted to one capture.
    const label = "raise the Team plan from £80 to £95 a month";
    const { options, named } = project(recordsFor(95, 95, label));
    expect(options.map((o) => o.label)).toEqual([label]);
    expect(Object.keys(named(options[0]!))).toEqual([PRICE]);
  });
});
