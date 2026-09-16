/**
 * ⭐⭐⭐ NOT ONE NUMBER THE PERSON STATED REACHES THE INITIAL MODEL — AND THE
 * OBVIOUS PROJECTOR FIX FABRICATES. THIS FILE PINS THE REFUTATION.
 *
 * Measured across the five banked live pass-1 record sets:
 *
 *   20 stated `figure` items           ->  0 reach the final graph
 *   57 final graph nodes               ->  0 carry any value
 *   13 claims cite a figure in `basis` ->  0 of their nodes carry a value
 *
 * Corroborated on a real user session the same day: all 12 factors and 5 options
 * had `observed_state: null`, including the node the product itself called "the
 * strongest influence on the outcome", about which it told the user "it
 * currently carries no measured value".
 *
 * ⛔ WHY A STATED FIGURE CANNOT RESCUE ITSELF. `STATED_KIND_TO_NODE_KIND` maps
 * `figure -> factor`, so "£49" becomes a factor node of its own — a structural
 * DUPLICATE of the claim that measures the same quantity. The model rightly
 * declines to wire a duplicate to the goal, the connectivity pass prunes it, and
 * the number dies with it.
 *
 * ⛔⛔ THE FIX THAT LOOKS OBVIOUS, AND WHY IT IS A FABRICATION. `basisFigures` is
 * already computed beside the node build: it dereferences `basis` into the cited
 * stated items and copies out their value and unit. Reading that variable when
 * the claim states no value of its own is a four-line change, and it works —
 * it moves the banked population from 0 of 57 nodes carrying a value to 2.
 *
 * ⛔ BOTH OF THOSE TWO ARE WRONG, and one is plainly visible to a user:
 *
 *     "Current Subscriber Count = 20000£"      (the figure is the £20k MRR GOAL)
 *     "Price-Driven Churn Sensitivity = 4%"    (the figure is the churn LIMIT)
 *
 * The served instruction defines the field as "the array positions of the
 * stated_items your claim builds on". BUILDS ON is evidence, not equality. A
 * count inferred FROM a revenue figure legitimately cites it and is not equal to
 * it. Nothing in `basis` distinguishes "this is my magnitude" from "this is what
 * I reasoned from", so a projector reading it as the former asserts a number the
 * user never attached to that quantity — on a node whose provenance would then
 * say the model measured it.
 *
 * ⭐ WHERE THE FIX BELONGS INSTEAD, and every piece of it already exists:
 *   · `grammar.ts` already declares `value: { type: "number" }` on the claims item;
 *   · `seam.ts` already carries it;
 *   · `projector.ts` already writes it to `data.value` and `observed_state.value`,
 *     normalising onto [0,1] and preserving the original in `raw_value`
 *     (probed: 51 -> 0.51/raw 51, 49 -> 0.98/raw 49, 200 -> 0.4/raw 200; values
 *     already inside [0,1] pass through untouched).
 * The ONLY missing link is the instruction, where the backticked `value` appears
 * exactly ONCE in 27KB and markdown lazy continuation binds that sentence inside
 * the `figure` bullet of `stated_items` — so the claims half is never told a
 * magnitude may go on a claim. The MODEL knows which quantity a number describes.
 * `basis` does not, and cannot be made to.
 */
import { describe, expect, it } from "vitest";

import { projectDraftRecords } from "../seam.js";
import type { DraftRecordSet } from "../grammar.js";

function project(r: DraftRecordSet) {
  const out = projectDraftRecords(r, undefined);
  if (!out.ok) throw new Error(`projection failed: ${out.reason}`);
  return out.projection;
}
const nodeBy = (r: DraftRecordSet, label: string) =>
  (project(r) as unknown as { graph: { nodes: ReadonlyArray<Record<string, any>> } }).graph.nodes.find(
    (n) => n.label === label,
  );

/**
 * THE MISATTRIBUTION CASE, transcribed from `priceonly`: the model cites the
 * £20k MRR goal figure as the basis for a SUBSCRIBER COUNT. Legitimate evidence;
 * catastrophic as a magnitude.
 */
const CITES_BUT_IS_NOT = (): DraftRecordSet =>
  ({
    stated_items: [
      { kind: "goal", source_quote: "reaching £20k MRR within 12 months", role: "target" },
      { kind: "figure", source_quote: "£20k MRR", value: 20000, unit: "£" },
    ],
    claims: [
      { claim_kind: "factor", label: "Current Subscriber Count", basis: [0, 1] },
      { claim_kind: "outcome", label: "Monthly Recurring Revenue", basis: [0] },
      { claim_kind: "causal_link", label: "subscribers drive MRR", from_claim: 0, to_claim: 1, effect: "positive", strength: 0.7 },
      { claim_kind: "causal_link", label: "MRR drives goal", from_claim: 1, to_stated: 0, effect: "positive", strength: 0.8 },
    ],
  }) as unknown as DraftRecordSet;

/** The model stating its own magnitude — the carrier that IS legitimate. */
const STATES_ITS_OWN = (): DraftRecordSet =>
  ({
    stated_items: [
      { kind: "goal", source_quote: "reaching £20k MRR within 12 months", role: "target" },
      { kind: "figure", source_quote: "£49", value: 49, unit: "£/month" },
    ],
    claims: [
      { claim_kind: "factor", label: "Pro Plan Monthly Price", basis: [1], value: 49 },
      { claim_kind: "outcome", label: "Monthly Recurring Revenue", basis: [0] },
      { claim_kind: "causal_link", label: "price drives MRR", from_claim: 0, to_claim: 1, effect: "positive", strength: 0.6 },
      { claim_kind: "causal_link", label: "MRR drives goal", from_claim: 1, to_stated: 0, effect: "positive", strength: 0.8 },
    ],
  }) as unknown as DraftRecordSet;

describe("V1 — `basis` must never be read as a magnitude", () => {
  it("V1a a claim that CITES £20,000 must not become worth £20,000", () => {
    const n = nodeBy(CITES_BUT_IS_NOT(), "Current Subscriber Count");
    expect(n, "precondition: the factor is on the graph").toBeDefined();
    expect(
      n?.observed_state?.value,
      "a subscriber count inferred FROM a revenue figure is not equal to it",
    ).toBeUndefined();
    expect(n?.data?.value).toBeUndefined();
  });

  it("V1b but the citation IS recorded, so nothing is lost — it is held as evidence", () => {
    const n = nodeBy(CITES_BUT_IS_NOT(), "Current Subscriber Count");
    expect(n?.provenance?.basis_figures, "the number is kept where it means 'built on'").toEqual([
      { value: 20000, unit: "£", source_quote: "£20k MRR" },
    ]);
  });
});

describe("V2 — the carrier that IS legitimate already works end to end", () => {
  it("V2a a claim stating its OWN magnitude reaches the node, original preserved", () => {
    const n = nodeBy(STATES_ITS_OWN(), "Pro Plan Monthly Price");
    expect(n?.observed_state?.raw_value, "the user's number, preserved beside the normalised one").toBe(49);
    expect(typeof n?.observed_state?.value, "normalised onto [0,1] as every value is").toBe("number");
  });

  it("V2b PRECONDITION for the whole finding: the figure's own node does not survive", () => {
    const nodes = (project(STATES_ITS_OWN()) as unknown as { graph: { nodes: ReadonlyArray<Record<string, any>> } })
      .graph.nodes;
    expect(nodes.some((n) => n.label === "£49"), "so the claim is the only carrier available").toBe(false);
  });

  it("V2c and the model is currently never asked for it — 0 of 57 banked nodes carry a value", () => {
    // The instruction's only `value` sentence is bound to the `figure` bullet of
    // `stated_items` by markdown lazy continuation; the claims section never
    // mentions the field. This asserts the machinery is ready for the answer.
    const n = nodeBy(STATES_ITS_OWN(), "Pro Plan Monthly Price");
    expect(n?.data?.value, "grammar, seam and projector are all wired — only the ask is missing").toBeDefined();
  });
});
