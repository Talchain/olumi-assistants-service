/**
 * ⭐⭐⭐ THE VALUE IS RECORDED AND IT STAYS OURS — because attribution cannot be
 * earned from the evidence this record set carries.
 *
 * ⚠⚠ MEASURED ON THE RAW RECORD SETS, before any projection, conversion or
 * debug representation: five banked live captures, 20 stated figures, 33
 * quantity claims, `value` set on ZERO of them, and `sets_to` set on 28 causal
 * links. The model puts a number on a LINK 28 times and on a NODE not once.
 * v10's docblock diagnosed the mirror image in its own words — "THE MODEL WAS
 * NOT FAILING TO COMPLY; IT WAS COMPLYING."
 *
 * ⛔⛔ AND THE ATTRIBUTION HALF I FIRST WROTE WAS REFUTED BY INDEPENDENT REVIEW
 * BEFORE IT SHIPPED. It stamped `extractionType: "explicit"` and borrowed the
 * cited figure's unit whenever `claim.value` EQUALLED a figure in `basis`. The
 * reviewer's exact reproductions, both of which that rule would have passed:
 *
 *   · "Current Subscriber Count" stamped explicit at 49 £/month from a citation
 *     of a £49 PRICE — same number, DIFFERENT SUBJECT;
 *   · a CURRENT level of 59 stamped explicit from a quote PROPOSING 59 — same
 *     number, DIFFERENT ROLE.
 *
 * Numeric equality plus a citation proves neither. Earning `brief_extraction`
 * needs subject, quantity, unit AND the current/proposed/target/limit role all
 * to match, and `basis` carries none of that — it means "built on". This is the
 * TWIN of the fabrication refuted in `claim-carries-its-cited-figure.test.ts`:
 * I closed that hole in VALUE and opened the same hole one level up, in
 * ATTRIBUTION.
 *
 * ⭐ SO THE CONTRACT THIS FILE PINS IS THE NARROW ONE: the number is recorded,
 * `raw_value` preserves it, and NOTHING claims the user authored it. No
 * `extractionType` was believed to mean the safe `ai_inferred` — it does NOT,
 * it resolves to `brief_extraction`/user_stated, so the value now says
 * `inferred` explicitly; no unit is borrowed from a
 * figure whose subject was never established. That deliberately does not lift a
 * user-authorship permission via an inferred value.
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

/** `figures` are extra stated figures; `claim` overrides the first factor claim. */
const records = (claim: Record<string, unknown>, label = "Pro Plan Monthly Price"): DraftRecordSet =>
  ({
    stated_items: [
      { kind: "goal", source_quote: "reaching £20k MRR within 12 months", role: "target" },
      { kind: "figure", source_quote: "the Pro plan is £49 a month today", value: 49, unit: "£/month" },
      { kind: "figure", source_quote: "we are proposing £59 a month", value: 59, unit: "£/month" },
    ],
    claims: [
      { claim_kind: "factor", label, ...claim },
      { claim_kind: "outcome", label: "Monthly Recurring Revenue", basis: [0] },
      { claim_kind: "causal_link", label: "drives MRR", from_claim: 0, to_claim: 1, effect: "positive", strength: 0.6 },
      { claim_kind: "causal_link", label: "MRR drives goal", from_claim: 1, to_stated: 0, effect: "positive", strength: 0.8 },
    ],
  }) as unknown as DraftRecordSet;

describe("P1 — the number is recorded, and it is recorded as OURS", () => {
  it("P1a a factor claim's value reaches the node, original preserved", () => {
    const n = nodeBy(records({ basis: [1], value: 49 }), "Pro Plan Monthly Price");
    expect(n?.observed_state?.raw_value, "an estimate is more useful than an absent number").toBe(49);
    expect(typeof n?.observed_state?.value, "normalised onto [0,1] as every value is").toBe("number");
  });

  it("P1b and NOTHING claims the user authored it", () => {
    const n = nodeBy(records({ basis: [1], value: 49 }), "Pro Plan Monthly Price");
    // ⛔ THIS ASSERTION WAS BACKWARDS AND SO WAS ITS MESSAGE. It read
    // `.toBeUndefined()` on the belief that "no extractionType means the safe
    // ai_inferred". An adversarial review proved the opposite by execution:
    // `transforms/schema-v3.ts:366` resolves an ABSENT extractionType to
    // `brief_extraction`, which `obligation-provenance.ts:145` maps to
    // **user_stated**. So the absence this test protected was a FALSE AUTHORSHIP
    // CLAIM, and on both live v202 draws it flipped the readiness mode from
    // `quantified_provisional` to `comparative_leader` — naming a leader on a
    // number the model invented.
    expect(n?.data?.extractionType, "the model's own value must say so: inferred").toBe("inferred");
    expect(n?.provenance?.provenance_class).toBe("ai_inferred");
  });

  it("P1c no unit is borrowed from a figure whose subject was never established", () => {
    expect(nodeBy(records({ basis: [1], value: 49 }), "Pro Plan Monthly Price")?.data?.unit).toBeUndefined();
  });

  it("P1d a factor with NO value is untouched — the third legitimate state", () => {
    const n = nodeBy(records({ basis: [1] }), "Pro Plan Monthly Price");
    expect(n, "the node still exists").toBeDefined();
    expect(n?.observed_state?.value, "unknown stays unknown; nothing is populated to fill a count").toBeUndefined();
  });
});

describe("P2 — the reviewer's two reproductions, as contrasts", () => {
  it("P2a SAME NUMBER, DIFFERENT SUBJECT: a subscriber count citing a £49 PRICE earns nothing", () => {
    const n = nodeBy(records({ basis: [1], value: 49 }, "Current Subscriber Count"), "Current Subscriber Count");
    expect(n?.observed_state?.raw_value, "the model asserted it, so it is recorded").toBe(49);
    expect(n?.data?.extractionType,
      "but 49 subscribers is not £49 a month — numeric equality proves no subject",
    ).toBe("inferred");
    expect(n?.data?.unit, "and £/month must not be welded to a headcount").toBeUndefined();
  });

  it("P2b SAME NUMBER, DIFFERENT ROLE: a CURRENT level citing a PROPOSED 59 earns nothing", () => {
    const n = nodeBy(records({ basis: [2], value: 59 }), "Pro Plan Monthly Price");
    expect(n?.observed_state?.raw_value).toBe(59);
    expect(n?.data?.extractionType,
      "'we are proposing £59' says what it WOULD be, never what it IS",
    ).toBe("inferred");
  });

  it("P2c MEANINGFUL POSITIVE: even the same subject AND the same number earns nothing today", () => {
    // Stated deliberately rather than left implicit. The record set carries no
    // attested subject relationship, so there is no input on which the stamp
    // could be earned — the capability is absent, not merely unexercised. When
    // an attested relationship exists, THIS is the case that must flip, and a
    // reviewer can find it here rather than inferring it from an absence.
    const n = nodeBy(records({ basis: [1], value: 49 }), "Pro Plan Monthly Price");
    expect(n?.data?.extractionType).toBe("inferred");
  });
});

describe("P3 — the sibling refutation stays refuted", () => {
  it("P3a `basis` alone still puts no number on a node", () => {
    expect(nodeBy(records({ basis: [1] }), "Pro Plan Monthly Price")?.data?.value).toBeUndefined();
  });

  it("P3b and the citation is still recorded as evidence", () => {
    const n = nodeBy(records({ basis: [1] }), "Pro Plan Monthly Price");
    expect(n?.provenance?.basis_figures).toEqual([
      { value: 49, unit: "£/month", source_quote: "the Pro plan is £49 a month today" },
    ]);
  });
});
