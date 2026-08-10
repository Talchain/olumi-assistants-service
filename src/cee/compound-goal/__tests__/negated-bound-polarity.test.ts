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
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { extractCompoundGoals, remapConstraintTargets } from "../index.js";

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

/**
 * ── THE ADVERSARIAL CORPUS ────────────────────────────────────────────────
 *
 * ⚠ THESE PHRASINGS ARE NOT MINE, AND THAT IS THE ENTIRE POINT.
 *
 * The first cut of this fix handled the corpus sentence and the negation
 * idioms I happened to think of. An independent reviewer then wrote the list
 * below — from outside this lane — and every one of them still reached the
 * wire as `fac_gross_margin <= 0.78`: the right node, the INVERTED operator,
 * `provenance: "explicit"` at `confidence: 0.85`, the negation stripped from
 * the quote, under a label reading "Keep gross margin at or below 78%".
 *
 * That is CLAUDE.md trap 22 landing on the very fix written while citing it: a
 * corpus drawn from the author's head cannot see the class the author did not
 * imagine, and a mutant kit scores sensitivity, never breadth.
 *
 * The fix is SUPPRESSION, not correction. Where the floor patterns recognise
 * the phrasing they mint a correct `>=`; everywhere else the honest output is
 * no row at all. A missing constraint is a gap; an inverted one is scored by
 * ISL and penalises exactly the options that honour the limit.
 */
describe("D — no negated bound reaches the wire inverted (adversarial corpus)", () => {
  it.each([
    // negation lead outside NEGATION_LEAD
    "Do not let gross margin drop below 78%.",
    "We do not want gross margin to drop below 78%.",
    // fall-verbs outside {drop, fall, slip, dip}
    "without letting gross margin go below 78%",
    "We will not allow gross margin to drop below 78%.",
    "Avoid letting gross margin sink below 78%.",
    // subject shapes that break a bare \w+ capture
    "Do not let the group's blended gross margin drop below 78%.",
    "We must not let gross-margin fall below 78%.",
    // clause-level, semicolon separated
    "Growth is the priority; without dropping gross margin below 78%.",
    // ⚠ THE 2.714 DECIMAL-POINT KILLER, REPRODUCED IN THIS LANE'S OWN CODE.
    // `clauseBefore` cuts on `[.!?;]\s` — the trailing \s is load-bearing, and
    // these two sentences are what prove it. Mutating the cut to a bare
    // `[.!?]` makes it cut inside "£1.5m", which discards the "Do not"/"will
    // not" ahead of it, and BOTH sentences then emit an INVERTED
    // `<= 0.78` (measured: two rows each). That is the exact mechanism that
    // killed ROADMAP 2.714 — a guard its own header called "the most important
    // line here" could not fire, because the window handed to it had been
    // truncated at a decimal point before the magnitude word.
    "Do not let the £1.5m marketing spend push gross margin below 78%.",
    "We will not let the £2.5m programme drag gross margin below 78%.",
    // ⚠⚠ INTERRUPTED CONSTRUCTIONS — the regression set. A first attempt at the
    // over-width fix cut the window at every bare comma, colon and dash, on the
    // stated premise that "once a clause boundary separates them it governs
    // nothing". THAT PREMISE IS FALSE: a parenthetical INTERRUPTS a governing
    // construction, it does not end it. 7 of 10 floors leaked back out as
    // inverted `<=` — the canonical B1 `drop` verb in ordinary board English —
    // and the suite stayed GREEN because every case added that round pointed at
    // the gap direction and none at the inversion direction.
    "Do not, under any circumstances, let gross margin drop below 78%.",
    "Never, ever let gross margin go below 78%.",
    "We must not — and the board is firm on this — let gross margin go below 78%.",
    "Do not (and this is non-negotiable) let gross margin drop below 78%.",
    // A parenthetical that CONTAINS a boundary character. Without the
    // paren-removal step the `;`/`:` inside the brackets cuts the window and
    // the governing "Do not" is lost — both leak an inverted `<=`. These are
    // what make mutant M18 bite; the plain-parenthetical case above does not,
    // because brackets are not themselves boundaries.
    "Do not (this is firm; truly non-negotiable) let gross margin drop below 78%.",
    "Do not (note: the board agreed) let gross margin drop below 78%.",
    "We will not, whatever the pressure, let gross margin fall below 78%.",
  ])("emits no inverted ceiling for: %s", (brief) => {
    for (const c of withValue(constraintsOf(brief), 0.78)) {
      expect(
        c.operator,
        `this sentence states a FLOOR, but a row reached the output as ` +
          `${c.operator} 0.78 (label: ${JSON.stringify(c.label)}). An inverted ` +
          `floor is scored by ISL and penalises the options that honour it.`,
      ).not.toBe("<=");
    }
  });

  /**
   * ⚠⚠ THE SUPPRESSION PREDICATE WAS TOO WIDE, AND THESE ARE THE CASES THAT
   * PROVED IT.
   *
   * A predicate that drops legitimate ceilings has traded one silent failure
   * for another. With the clause window cutting only on `[.!?;]`, a negation
   * ANYWHERE earlier in a long sentence suppressed a perfectly real limit
   * downstream — five measured false positives, every one a hard constraint
   * silently lost:
   *
   * The negation in each of these governs NOTHING: a clause boundary separates
   * it from the bound. Comma, colon and dash are now clause boundaries too.
   */
  it.each([
    ["There is no scope for overruns, so keep churn under 4%.", 0.04],
    ["We cannot afford delays, so keep spend under £1m.", 1_000_000],
    ["We have not agreed the plan, yet spend must stay under £2m.", 2_000_000],
    ["I do not want surprises: keep marketing under £1.5m.", 1_500_000],
    ["No exceptions — keep churn under 4%.", 0.04],
    ["Nothing else matters, but keep churn under 4%.", 0.04],
  ])("an incidental negation across a clause boundary does not suppress: %s", (brief, value) => {
    const rows = withValue(constraintsOf(brief as string), value as number);
    expect(
      rows.length,
      "a legitimate ceiling was suppressed by a negation that does not govern it",
    ).toBeGreaterThan(0);
    for (const c of rows) expect(c.operator).toBe("<=");
  });

  /**
   * ⚠ THE THOUSANDS SEPARATOR, guarding the second door into the 2.714
   * truncation. Adding `,` to the clause terminators WITHOUT the trailing-\s
   * requirement would cut "£1,500,000" at its first comma and hand the guard
   * "500,000" — or worse, "1". This sentence is a FLOOR, so it must emit `>=`
   * at the FULL magnitude; a truncated parse cannot produce 1_500_000.
   */
  it("a thousands-separated magnitude survives the comma clause rule", () => {
    const rows = constraintsOf("We must not let headcount cost drop below £1,500,000.");
    const full = rows.filter((c) => c.value === 1_500_000);
    expect(full.length, "the magnitude was truncated at a thousands separator").toBeGreaterThan(0);
    for (const c of full) expect(c.operator).toBe(">=");
  });

  /**
   * DISCRIMINATING HALF. Suppression must not eat a legitimate ceiling. These
   * carry no negation in the clause and must survive byte-identically.
   */
  it.each([
    { brief: "Keep churn under 4% next year.", value: 0.04 },
    { brief: "Reach 800 customers while keeping churn under 4%.", value: 0.04 },
    { brief: "Keep support cost under £2.9m.", value: 2_900_000 },
    { brief: "Marketing spend is capped at £1.5m.", value: 1_500_000 },
  ])("preserves the genuine ceiling in: $brief", ({ brief, value }) => {
    const rows = withValue(constraintsOf(brief), value);
    expect(rows.length, "a legitimate ceiling was suppressed").toBeGreaterThan(0);
    for (const c of rows) expect(c.operator).toBe("<=");
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

/**
 * ── ⚠ EXTRACTION IS NOT ARRIVAL ────────────────────────────────────────────
 *
 * CLAUDE.md trap 16-INVERSE: a code path can be fully live while the DATA
 * cannot reach it, and only a producer-side derivation or a real capture tells
 * the two apart. Every test above measures the EXTRACTOR. This one measures
 * what survives `remapConstraintTargets` against the node ids of the REAL
 * DEPLOYED B1 GRAPH — because a constraint whose `node_id` matches nothing is
 * dropped, and never reaches PLoT at all.
 *
 * The measured result is uncomfortable and is pinned here precisely so nobody
 * inherits the extractor-scoped number as if it were the wire-scoped one:
 * the real B1 graph has NO gross-margin node, so the headline atom B1-A08 is
 * extracted correctly and then lands NOWHERE.
 *
 * This is still a strict improvement — pristine landed zero — but "3 correct"
 * is a claim about extraction, and only the count below is a claim about the
 * wire.
 */
describe("D — what actually reaches the wire, against the real B1 node set", () => {
  const capture = JSON.parse(
    readFileSync(
      resolve(
        process.cwd(),
        "src/cee/context-integrity/__tests__/fixtures/b1-growth.cold-read.json",
      ),
      "utf8",
    ),
  );
  const graph = capture.graph ?? capture;
  const nodeIds: string[] = graph.nodes.map((n: any) => n.id);
  const nodeLabels = new Map<string, string>(
    graph.nodes.map((n: any) => [n.id, n.label]),
  );
  /**
   * ⚠ THE BRIEF COMES FROM THE CAPTURE, NOT FROM A PATH OUTSIDE THE REPO.
   *
   * The first version of this suite read `B1.txt` from an absolute home-dir
   * path outside the repo. It passed locally and FAILED AT COLLECT in CI — the
   * whole FILE, so every test in it silently stopped existing on the runner.
   * The capture carries the real deployed `brief_text` verbatim, so the
   * external read bought nothing and cost the suite.
   */
  const B1: string = capture.brief_text;

  it("the real graph genuinely has no gross-margin node (the reason A08 cannot land)", () => {
    const marginish = nodeIds.filter((id) => /margin/i.test(id));
    expect(marginish, "a margin node exists — this pin's premise is stale").toEqual([]);
    // and the headcount node is not spelled the way the extractor names it
    expect(nodeIds).toContain("fac_headcount_budget");
    expect(nodeIds).not.toContain("fac_people");
  });

  it("3 extracted -> 1 reaches the wire: extraction count is NOT arrival count", () => {
    const extracted = (extractCompoundGoals(B1) as any).constraints ?? [];
    const result = remapConstraintTargets(extracted, nodeIds, nodeLabels) as any;
    // ⚠ `remapped` is a COUNT, not the array. The surviving rows are
    // `result.constraints` — a shape confusion that silently made an earlier
    // version of this test assert nothing at all.
    const survivors = result.constraints ?? [];

    expect(extracted.length, "extractor-scoped count").toBe(3);
    expect(
      survivors.length,
      "wire-scoped count — if this moves, the PR body's claim must move with it",
    ).toBe(1);
    expect(result.rejected_no_match).toBe(2);

    // The one that lands is the marketing cap, bound by IDENTITY.
    expect(survivors[0].targetNodeId).toBe("fac_marketing_spend");
    expect(survivors[0].operator).toBe("<=");
    expect(survivors[0].value).toBe(1_500_000);

    // Every survivor targets a node that genuinely exists.
    for (const c of survivors) expect(nodeIds).toContain(c.targetNodeId);

    // THE HEADLINE ATOM DOES NOT LAND. B1-A08's margin floor is extracted with
    // the correct polarity and then dropped, because the real graph has no
    // margin node to bind it to. Pinned so the PR's extractor-scoped result is
    // never inherited as a wire-scoped one. Closing this needs the DRAFTER to
    // mint a margin node — a separate lane.
    expect(survivors.map((c: any) => c.targetNodeId)).not.toContain("fac_gross_margin");
  });
});

/**
 * ── ⚠⚠ THE BIDIRECTIONAL OBLIGATION, MADE STRUCTURAL ──────────────────────
 *
 * This suite guards a predicate that can fail in TWO opposite directions:
 *   - too wide  -> a legitimate CEILING is suppressed (a silent gap)
 *   - too narrow -> a genuine FLOOR leaks out INVERTED (a confident lie)
 *
 * Both failures have now happened here, one per review round, and BOTH TIMES
 * `pnpm test:required` was fully green — because the cases added that round all
 * pointed at one door while the other stood open. A corpus that only tests one
 * direction is a guard watching one door.
 *
 * ⚠ RULE FOR EVERY FUTURE CASE ADDED TO THIS FILE: it must arrive WITH ITS
 * OPPOSITE-DIRECTION TWIN, and the twin must be shown to fail before the fix
 * and pass after. The counts below are asserted so a one-sided addition cannot
 * pass unnoticed.
 */
describe("D — the corpus covers BOTH directions, and says so in numbers", () => {
  const FLOORS = [
    "Do not, under any circumstances, let gross margin drop below 78%.",
    "Never, ever let gross margin go below 78%.",
    "We must not — and the board is firm on this — let gross margin go below 78%.",
    "Do not (and this is non-negotiable) let gross margin drop below 78%.",
    "We will not, whatever the pressure, let gross margin fall below 78%.",
    "The goal is to get to £20m ARR by end of FY28 without dropping gross margin below 78%.",
  ];
  const CEILINGS: Array<[string, number]> = [
    ["There is no scope for overruns, so keep churn under 4%.", 0.04],
    ["We cannot afford delays, so keep spend under £1m.", 1_000_000],
    ["We have not agreed the plan, yet spend must stay under £2m.", 2_000_000],
    ["I do not want surprises: keep marketing under £1.5m.", 1_500_000],
    ["No exceptions — keep churn under 4%.", 0.04],
    ["Keep churn under 4% next year.", 0.04],
  ];

  it("NO genuine floor leaks out inverted", () => {
    const leaks = FLOORS.filter((b) =>
      constraintsOf(b).some((c) => c.value === 0.78 && c.operator === "<="),
    );
    expect(leaks, "these floors reached the output as confident ceilings").toEqual([]);
    expect(FLOORS.length, "the floor half of the corpus shrank").toBeGreaterThanOrEqual(6);
  });

  it("NO legitimate ceiling is suppressed", () => {
    const dropped = CEILINGS.filter(([b, v]) => withValue(constraintsOf(b), v).length === 0);
    expect(dropped.map(([b]) => b), "these real limits were silently dropped").toEqual([]);
    expect(CEILINGS.length, "the ceiling half of the corpus shrank").toBeGreaterThanOrEqual(6);
  });
});

/**
 * ── ⚠ DISCLOSED, NOT FIXED: THE RETRACTION CLASS ──────────────────────────
 *
 * A constraint the user STATES AND THEN WITHDRAWS in the same brief is still
 * extracted as live. Pristine had this defect too — but pristine produced an
 * INVERTED row, and head produces a correctly-polarised one, so head is wrong
 * MORE CONVINCINGLY. That is a real cost of this PR and it is recorded here
 * rather than left for someone to discover.
 *
 * It is the same family as the values ROADMAP 2.714 was measured committing
 * after the user had "negated or retracted" them. Closing it needs discourse
 * scope — which clause supersedes which — and guessing that from arbitrary
 * English is exactly what killed 2.714. Rowed, not guessed at.
 *
 * ⚠ THIS TEST PINS THE DEFECT, NOT THE DESIRED BEHAVIOUR. It is a tripwire: if
 * someone fixes the retraction class, this REDs and they delete it. It must
 * never be read as a specification.
 */
describe("D — retraction class (DISCLOSED DEFECT, pinned as a tripwire)", () => {
  it("still extracts a constraint the same sentence retracts", () => {
    const brief =
      "We initially said gross margin must not drop below 78%, but that constraint has since been removed.";
    const rows = constraintsOf(brief).filter((c) => c.value === 0.78);

    // Today: a row survives. When this stops being true the fix has landed.
    expect(
      rows.length,
      "the retraction class appears to be FIXED — delete this tripwire and its docblock",
    ).toBeGreaterThan(0);

    // And at least the polarity is no longer inverted, which is the only part
    // this PR improved.
    for (const c of rows) expect(c.operator).toBe(">=");
  });
});

/**
 * ── ⚠ DISCLOSED, NOT FIXED: THE MIRROR-IMAGE DEFECT ON THE `above` SIDE ────
 *
 * "Marketing must not go above £1.5m" means `<= 1_500_000`. It is extracted as
 * `>=` — the same confidently-inverted class this PR exists to kill, on the
 * LOWER-bound path instead of the upper one.
 *
 * It is PRE-EXISTING: this PR neither introduced it nor made it worse. It is
 * disclosed rather than fixed because the fix is a second, symmetric change on
 * a different code path — the one the 35-test risk-polarity corpus governs —
 * and bolting it on mid-review is exactly the "while we're here" expansion the
 * scope rule prohibits. The smallest enabling change is to extend the same
 * clause-scoped suppression to `above|over` matches; it is rowed for a
 * follow-up with its own RED-first evidence and its own corpus.
 *
 * ⚠ THIS TEST PINS THE DEFECT, NOT THE DESIRED BEHAVIOUR. It is a tripwire: when
 * someone fixes the `above` side, this REDs and they delete it. It must never be
 * read as a specification.
 */
describe("D — `above` side inversion (DISCLOSED PRE-EXISTING DEFECT, tripwire)", () => {
  it("still inverts a negated `above` bound", () => {
    const rows = constraintsOf("Marketing must not go above £1.5m.").filter(
      (c) => c.value === 1_500_000,
    );
    expect(
      rows.length,
      "the `above` side appears to be FIXED — delete this tripwire and its docblock",
    ).toBeGreaterThan(0);
    // Today: `>=`, which is the inverse of what the sentence means.
    expect(rows.some((c) => c.operator === ">=")).toBe(true);
  });
});
