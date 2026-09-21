/**
 * ⭐⭐ THE DRAFTER MUST NOT RESTATE THE USER'S OWN PROPOSAL AS A RIVAL OPTION.
 *
 * ── THE WITNESSED DEFECT ───────────────────────────────────────────────────
 * The user's live staging draw (bundle `9077a1e3`, 2026-09-21) on the brief
 * *"should we increase the Pro plan price from £49 to £59 per month with the
 * next Pro feature release?"* produced FOUR options, two of them the same
 * proposal:
 *
 *   "increase the Pro plan price from £49 to £59 …"  STATED  price 59
 *   "Raise Price to £59 with Feature Release"        MODEL   price 59, churn 0.045
 *
 * `findUndevelopedDuplicates` never fired: it groups on the FULL intervention
 * signature (the validator's own `OPTIONS_IDENTICAL` predicate) and the two
 * differ by the churn effect. Both reached the wire.
 *
 * ⚠ THE RECORDS BELOW ARE RECONSTRUCTED, and that is stated rather than implied:
 * the debug bundle carries the projector's OUTPUT, never its input, so the
 * captured graph cannot drive this seam. The SHAPE — a stated price option, an
 * `option_refinement` restating it, and the restatement alone carrying the churn
 * effect — is taken from that capture. The magnitudes are the user's own.
 *
 * ── WHY THE FIX BELONGS HERE AND NOWHERE DOWNSTREAM ────────────────────────
 * Every later gate is correct and DELIBERATE, and each fails closed BECAUSE two
 * options claim one figure: the brief-authority gate withholds attribution with
 * no single owner; `collectSourceBoundInterventionCandidates` will not anchor a
 * figure to a hypothesis ("a hypothesis — even one that happens to repeat the
 * same number — is not evidence that the amount was carried from the brief").
 * On that draw: `in_model_anchored: 0` of 5, `confidence_parameters_user_stated:
 * 0`, and the user told "every estimate this comparison rests on is Olumi's, not
 * yours" about the £49 and £59 he wrote. Relaxing either gate re-opens #1657.
 */

import { describe, expect, it } from "vitest";

import type { DraftRecordSet } from "../grammar.js";
import { projectRecordsToGraph } from "../projector.js";

const PRICE = "Pro plan monthly price";
const CHURN = "monthly churn rate";
const MINE = "increase the Pro plan price from £49 to £59 per month";
const RESTATEMENT = "Raise Price to £59 with Feature Release";

const RECORDS: DraftRecordSet = {
  stated_items: [
    { kind: "goal", source_quote: "reach £20k MRR within 12 months" },
    { kind: "option", source_quote: MINE },
  ],
  claims: [
    { claim_kind: "factor", label: PRICE },
    { claim_kind: "factor", label: CHURN },
    { claim_kind: "option_refinement", label: RESTATEMENT },
    { claim_kind: "causal_link", label: "the stated rise sets the price", from_stated: 1, to_claim: 0, effect: "positive", sets_to: 59 },
    { claim_kind: "causal_link", label: "the restatement sets the price", from_claim: 2, to_claim: 0, effect: "positive", sets_to: 59 },
    { claim_kind: "causal_link", label: "the restatement raises churn", from_claim: 2, to_claim: 1, effect: "negative", sets_to: 0.045 },
    { claim_kind: "causal_link", label: "price bears on the goal", from_claim: 0, to_stated: 0, effect: "positive" },
    { claim_kind: "causal_link", label: "churn bears on the goal", from_claim: 1, to_stated: 0, effect: "negative" },
  ],
};

type Node = { id: string; kind?: string; label?: string; data?: { interventions?: Record<string, number> } };

function project() {
  const { graph } = projectRecordsToGraph(RECORDS) as unknown as { graph: { nodes: Node[] } };
  const idOf = (label: string) => graph.nodes.find((n) => n.label === label)?.id;
  const options = graph.nodes.filter((n) => n.kind === "option");
  const named = (o: Node) =>
    Object.fromEntries(
      Object.entries(o.data?.interventions ?? {}).map(([k, v]) => [
        graph.nodes.find((n) => n.id === k)?.label ?? k,
        v,
      ]),
    );
  return { graph, options, named, idOf };
}

describe("the user's own option must not be restated as a rival", () => {
  it("PRECONDITION — the records really do describe two options for one proposal", () => {
    // Without this the assertions below could pass on records that never posed
    // the problem. Read from the RECORDS, not from the output under test.
    const optionish = RECORDS.claims.filter((c) => c.claim_kind === "option_refinement");
    expect(optionish, "a restatement must be present in the input").toHaveLength(1);
    const setsPrice = RECORDS.claims.filter((c) => "sets_to" in c && c.sets_to === 59);
    expect(setsPrice, "and BOTH options must set the same stated figure").toHaveLength(2);
  });

  it("⛔ no two options may claim the same figure on the same factor", () => {
    const { options, named } = project();
    const byClaim = new Map<string, string[]>();
    for (const o of options) {
      for (const [factor, value] of Object.entries(named(o))) {
        const key = `${factor}=${value}`;
        byClaim.set(key, [...(byClaim.get(key) ?? []), String(o.label)]);
      }
    }
    const contested = [...byClaim.entries()].filter(([, who]) => who.length > 1);
    expect(
      contested,
      `a figure claimed by two options can never be credited to the user: ${JSON.stringify(contested)}`,
    ).toEqual([]);
  });

  it("⭐ the restatement's effects are ABSORBED, never lost with it", () => {
    // The whole reason this is a merge and not a withdrawal: the churn estimate
    // is the user's own proposal's downside, and on his live draw it BREACHED
    // the 4% ceiling he stated. Withdrawing the restatement without absorbing it
    // destroys the only representation of that risk — the documented harm that
    // reverted the obvious fix in `findUndevelopedDuplicates`.
    const { options, named } = project();
    const mine = options.find((o) => o.label === MINE);
    expect(mine, "the user's own option must survive").toBeDefined();
    expect(named(mine!), "it carries BOTH its own figure and the absorbed downside").toEqual({
      [PRICE]: 0.59,
      [CHURN]: 0.045,
    });
  });

  it("CONTRAST — an option that merely shares a factor is NOT absorbed", () => {
    // A different proposal that happens to move the same factor to a DIFFERENT
    // level is not a restatement, and must be left alone. Without this control
    // the rule would collapse every option onto the user's.
    const records: DraftRecordSet = {
      ...RECORDS,
      claims: RECORDS.claims.map((c) =>
        "sets_to" in c && c.sets_to === 59 && "from_claim" in c ? { ...c, sets_to: 54 } : c,
      ),
    };
    const { graph } = projectRecordsToGraph(records) as unknown as { graph: { nodes: Node[] } };
    const labels = graph.nodes.filter((n) => n.kind === "option").map((n) => n.label);
    expect(labels, "a genuinely different price point stays its own option").toContain(RESTATEMENT);
  });
});
