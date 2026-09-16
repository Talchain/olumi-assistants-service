/**
 * ⭐⭐⭐ THE ASK AND THE HONESTY HALF, SHIPPED TOGETHER — v10's rule, applied to
 * the mirror image of v10's own defect.
 *
 * ⚠⚠ MEASURED ON THE RAW RECORD SETS, before any projection, conversion or
 * debug representation — which is the boundary the retraction of the earlier
 * `full_graph` framing required:
 *
 *   5 banked live captures
 *   20 stated figures · 33 quantity claims · `value` set on ZERO of them
 *   28 causal links setting `sets_to`
 *
 * The model puts a number on a LINK 28 times and on a NODE not once. It says how
 * much an option MOVES a factor and never what the factor IS. v10's docblock
 * explains the shape, about its own mirror image: v9 told the model to withhold
 * `sets_to` where the brief gave no number, the model complied, and 20 of 23
 * journeys raised `MISSING_OPTION_VALUE` — "THE MODEL WAS NOT FAILING TO COMPLY;
 * IT WAS COMPLYING." The three legitimate states are user fact / OUR estimate
 * with its provenance / genuinely unknown, and `value` on a claim had never been
 * given the middle one.
 *
 * ⛔ WHICH IS WHY THE ASK CANNOT SHIP ALONE. A claim `value` carried NO
 * provenance at all. Once the model starts supplying one there are exactly two
 * bad outcomes: our estimate is shown as the user's fact, or it is shown as
 * nobody's and fails to count where a user-stated parameter is what unlocks a
 * comparison.
 *
 * ⭐ EARNED THE SAME WAY `bindDirectStatedMagnitude` earns it for a `sets_to`:
 * `extractionType: "explicit"` ONLY when the number the model asserted equals a
 * figure it CITED. Anything else sets nothing and falls to the safe
 * `ai_inferred`.
 *
 * ⚠ AND THE DIVISION THAT MAKES IT SAFE. The MODEL supplies the number; `basis`
 * decides only ATTRIBUTION. Reading a magnitude OUT of `basis` is the
 * fabrication refuted in `claim-carries-its-cited-figure.test.ts` — it put
 * "Current Subscriber Count = £20,000" on a graph, because `basis` means built
 * on, not equal to. P2 below asserts that refutation still holds.
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

const records = (priceClaim: Record<string, unknown>): DraftRecordSet =>
  ({
    stated_items: [
      { kind: "goal", source_quote: "reaching £20k MRR within 12 months", role: "target" },
      { kind: "figure", source_quote: "£49", value: 49, unit: "£/month" },
    ],
    claims: [
      { claim_kind: "factor", label: "Pro Plan Monthly Price", ...priceClaim },
      { claim_kind: "outcome", label: "Monthly Recurring Revenue", basis: [0] },
      { claim_kind: "causal_link", label: "price drives MRR", from_claim: 0, to_claim: 1, effect: "positive", strength: 0.6 },
      { claim_kind: "causal_link", label: "MRR drives goal", from_claim: 1, to_stated: 0, effect: "positive", strength: 0.8 },
    ],
  }) as unknown as DraftRecordSet;

describe("P1 — a value the user stated is attributed to them; ours is not", () => {
  it("P1a the model's number MATCHING a cited figure earns `explicit`", () => {
    const n = nodeBy(records({ basis: [1], value: 49 }), "Pro Plan Monthly Price");
    expect(n?.data?.extractionType, "the user gave this number for this quantity").toBe("explicit");
    expect(n?.data?.unit, "and the cited figure's unit travels with it").toBe("£/month");
    expect(n?.observed_state?.raw_value, "the original is preserved beside the normalised one").toBe(49);
  });

  it("P1b OUR estimate — no cited figure at all — is recorded and NOT attributed to them", () => {
    const n = nodeBy(records({ basis: [], value: 52 }), "Pro Plan Monthly Price");
    expect(n?.observed_state?.raw_value, "an estimate is more useful than an absent number").toBe(52);
    expect(n?.data?.extractionType, "but it is ours, and falls to the safe ai_inferred").toBeUndefined();
  });

  it("P1c citing a figure and asserting a DIFFERENT number is still ours", () => {
    // The decisive case: `basis` is present, so a rule keyed on citation alone
    // would stamp this. The stamp is keyed on the NUMBER matching.
    const n = nodeBy(records({ basis: [1], value: 52 }), "Pro Plan Monthly Price");
    expect(n?.observed_state?.raw_value).toBe(52);
    expect(n?.data?.extractionType, "they said 49; 52 is our number whoever we built it on").toBeUndefined();
    expect(n?.data?.unit, "and no unit is borrowed from a figure we did not match").toBeUndefined();
  });

  it("P1d a factor with NO value is untouched — the third legitimate state", () => {
    const n = nodeBy(records({ basis: [1] }), "Pro Plan Monthly Price");
    expect(n, "the node still exists").toBeDefined();
    expect(n?.observed_state?.value).toBeUndefined();
    expect(n?.data?.extractionType).toBeUndefined();
  });
});

describe("P2 — the fabrication refuted earlier today stays refuted", () => {
  it("P2a `basis` alone still puts no number on a node", () => {
    // `claim-carries-its-cited-figure.test.ts` pins why: a subscriber count
    // inferred FROM a revenue figure legitimately cites it and is not equal to
    // it. The model supplies the number; basis decides only attribution.
    const n = nodeBy(records({ basis: [1] }), "Pro Plan Monthly Price");
    expect(n?.data?.value, "citing is not asserting").toBeUndefined();
  });

  it("P2b and the citation is still recorded as evidence", () => {
    const n = nodeBy(records({ basis: [1] }), "Pro Plan Monthly Price");
    expect(n?.provenance?.basis_figures).toEqual([
      { value: 49, unit: "£/month", source_quote: "£49" },
    ]);
  });
});
