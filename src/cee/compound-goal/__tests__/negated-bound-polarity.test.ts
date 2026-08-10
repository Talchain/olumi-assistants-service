/**
 * PR1 / Component 6 (D) — A HARD CONSTRAINT MUST NOT BE EXTRACTED INVERTED.
 *
 * ── THE MEASURED DEFECT ────────────────────────────────────────────────────
 * Brief B1 of the frozen corpus says, verbatim:
 *
 *     "The goal is to get to £20m ARR by end of FY28 WITHOUT DROPPING gross
 *      margin BELOW 78%."
 *
 * That is a FLOOR: gross margin >= 78%. Run against the deployed extractor on
 * 2026-08-10 it produced, as B1's ONLY two constraints:
 *
 *   { targetName: "dropping gross margin", operator: "<=", value: 0.78,
 *     label: "Keep dropping gross margin at or below 78%",
 *     sourceQuote: "dropping gross margin below 78%",
 *     confidence: 0.85, provenance: "explicit" }
 *   { targetName: "unspecified", operator: "<=", value: 0.78,
 *     label: "At or below 78%", confidence: 0.6, provenance: "explicit" }
 *
 * The operator is the EXACT INVERSE of the user's constraint, stamped
 * `explicit` at 0.85 confidence, with the negation ("without") stripped out of
 * the quote that is shown back to the user as evidence. An inverted margin
 * floor does not merely fail to protect the margin — once enforced it
 * penalises precisely the options that DO protect it.
 *
 * This is the mechanism behind the frontier comparison's most commercially
 * dangerous finding: in 2 of 3 briefs the pragmatic middle option ranks
 * near-zero. A confident, quantified model pointing away from the sensible
 * option is the worst failure mode this product has.
 *
 * ── ORACLE ─────────────────────────────────────────────────────────────────
 * Every input below is VERBATIM from the frozen corpus at
 * `olumi-docs/PHASE0-EVIDENCE-2026-07-28/context-integrity-trace-2026-08-08/briefs/`,
 * authored by a different lane, or a minimal negation-idiom variant of one.
 * The expected OPERATOR is derived from what the sentence means in English, not
 * from what the current implementation happens to emit.
 */

import { describe, it, expect } from "vitest";
import { extractCompoundGoals } from "../index.js";

const B1_MARGIN =
  "The goal is to get to £20m ARR by end of FY28 without dropping gross margin below 78%.";

function constraintsOf(brief: string) {
  const r = extractCompoundGoals(brief) as any;
  return (r?.constraints ?? []) as ReadonlyArray<any>;
}

/**
 * Bind by the QUANTITY the constraint is about, never by array position or by
 * "the first constraint" — another row could satisfy a positional predicate
 * (CLAUDE.md trap 19).
 */
function withValue(cs: ReadonlyArray<any>, value: number) {
  return cs.filter((c) => c.value === value);
}

describe("D — a negated bound keeps the user's polarity", () => {
  it("B1 verbatim: 'without dropping gross margin below 78%' is a FLOOR, not a ceiling", () => {
    const rows = withValue(constraintsOf(B1_MARGIN), 0.78);
    expect(rows.length, "no constraint carried the stated 78% at all").toBeGreaterThan(0);

    for (const c of rows) {
      expect(
        c.operator,
        `"without dropping X below 78%" means margin >= 78%, but this row says ` +
          `margin ${c.operator} 0.78 (label: ${JSON.stringify(c.label)}). An inverted ` +
          `floor penalises exactly the options that protect the margin.`,
      ).toBe(">=");
    }
  });

  it("the source quote keeps the negation that determines the polarity", () => {
    const rows = withValue(constraintsOf(B1_MARGIN), 0.78);
    const quoted = rows.filter((c) => typeof c.sourceQuote === "string" && c.sourceQuote.length > 0);
    expect(quoted.length).toBeGreaterThan(0);
    for (const c of quoted) {
      expect(
        c.sourceQuote.toLowerCase(),
        `the quote shown back to the user as evidence is ${JSON.stringify(c.sourceQuote)}, ` +
          `which has had the word that reverses its meaning removed`,
      ).toContain("without");
    }
  });

  it("the label does not read as its own inverse", () => {
    for (const c of withValue(constraintsOf(B1_MARGIN), 0.78)) {
      expect(
        String(c.label).toLowerCase(),
        `label ${JSON.stringify(c.label)} describes the opposite of the constraint`,
      ).not.toMatch(/at or below/);
      expect(String(c.label).toLowerCase()).not.toMatch(/\bdropping\b/);
    }
  });

  /**
   * DISCRIMINATING PAIR (trap 19). The negation fix must not flip a genuine
   * ceiling. "keep churn under 4%" is a real upper bound and must stay `<=`;
   * this is the case the repo's own prompt uses as its canonical example.
   */
  it("leaves a genuine ceiling as a ceiling (the negative half of the pair)", () => {
    for (const c of withValue(constraintsOf("Keep churn under 4% next year."), 0.04)) {
      expect(c.operator, "a plain ceiling must not be flipped by the negation fix").toBe("<=");
    }
  });

  /**
   * The same idiom in the forms a stressed executive actually writes. These are
   * negation variants, not new semantics — each still means a FLOOR.
   */
  it.each([
    "We must not let gross margin fall below 78%.",
    "Gross margin cannot drop below 78%.",
    "without letting gross margin fall below 78%",
  ])("negation idiom: %s", (brief) => {
    const rows = withValue(constraintsOf(brief), 0.78);
    expect(rows.length, "the stated 78% was not carried at all").toBeGreaterThan(0);
    for (const c of rows) expect(c.operator).toBe(">=");
  });
});

describe("D — a bare subject-less bound does not duplicate a specific one", () => {
  /**
   * The second B1 row — `targetName: "unspecified"`, `fac_unspecified` — comes
   * from the subject-optional fallback pattern firing on the SAME "below 78%"
   * the specific pattern already claimed. It targets a node that does not
   * exist, and it doubles the weight of whatever polarity the first row chose.
   */
  it("emits no 'unspecified' row for a quantity a named row already carries", () => {
    const cs = constraintsOf(B1_MARGIN);
    const unspecified = cs.filter(
      (c) => c.targetName === "unspecified" || c.targetNodeId === "fac_unspecified",
    );
    const named = cs.filter(
      (c) => c.targetName !== "unspecified" && c.value === 0.78,
    );
    if (named.length > 0) {
      expect(
        unspecified.map((c) => ({ value: c.value, operator: c.operator })),
        "a subject-less duplicate of an already-named constraint targets a " +
          "node that does not exist and double-counts the limit",
      ).toEqual([]);
    }
  });
});

describe("D — the corpus's hard limits reach the enforceable carrier", () => {
  /**
   * These are the B1 constraint atoms (A19, A20) that the frontier comparison
   * found rendered as "Constraints: No limits on record" while their numbers
   * survived elsewhere as inert `data.cap` normalisation denominators.
   *
   * A cap is a denominator; only `goal_constraints[]` is scored by PLoT. The
   * distinction is the whole reason the partnership option — the only one that
   * FITS these limits — ranked below 1%.
   */
  it.each([
    {
      name: "B1-A19 hire cap",
      brief: "Constraint: we cannot hire more than 8 people total next year, HR freeze from the board.",
      value: 8,
      operator: "<=",
    },
    {
      name: "B1-A20 marketing cap",
      // 1_500_000, not 1.5: `parseValue` resolves the magnitude suffix against
      // the shared alphabet, so the row carries the real magnitude with unit
      // "£". Expectation derived from the producer, not from the loss-map's
      // shorthand `raw 0.3 "£m"` note (trap 13c — a mutant kit validates
      // sensitivity, never whether the expectation is right).
      brief: "Constraint: marketing spend is capped at £1.5m.",
      value: 1_500_000,
      operator: "<=",
    },
  ])("$name lands as an enforceable constraint", ({ brief, value, operator }) => {
    const rows = withValue(constraintsOf(brief), value);
    expect(
      rows.length,
      `the stated limit ${value} produced no goal_constraints row — it can only ` +
        `survive as an inert cap, which PLoT does not score`,
    ).toBeGreaterThan(0);
    expect(rows[0].operator).toBe(operator);
  });
});
