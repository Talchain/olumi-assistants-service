/**
 * A TIME HORIZON IS NOT A FLOOR ON THE GOAL.
 *
 * ── THE MEASURED DEFECT ────────────────────────────────────────────────────
 * Brief, verbatim (and byte-identical to a wire capture dated 15-19 March 2026,
 * CEE `0c0c33e`, prompt `draft_graph_default@v183`):
 *
 *     "I need to decide: hire one senior developer at £120k or two junior
 *      developers at £45k each. Budget is £150k, goal is to maximise
 *      engineering output over 12 months."
 *
 * Run against the extractor at `46ed50b3` it produced, among its rows:
 *
 *   { targetNodeId: "fac_maximise_engineering_output", operator: ">=",
 *     value: 12, unit: "", confidence: 0.85, provenance: "explicit",
 *     sourceQuote: "maximise engineering output over 12" }
 *   { targetNodeId: "fac_unspecified", operator: ">=",
 *     value: 12, unit: "months", confidence: 0.6, provenance: "explicit",
 *     sourceQuote: " over 12 months" }
 *
 * The user stated a DURATION. The product recorded a THRESHOLD ON THE GOAL and
 * stamped it `explicit` — a claim about what the user said. It is not a missing
 * unit; it is a category error wearing a provenance stamp, which is what makes
 * it a trust defect rather than a rough edge.
 *
 * The same shape sits in an EXISTING golden fixture,
 * `tests/fixtures/golden/multi-option.json`: "minimising total cost of
 * ownership over 3 years" -> `fac_cost_of_ownership >= 3`, unit "". That
 * fixture carries no currency at all, so it isolates the durative reading of
 * `over` from the threshold reading.
 *
 * ── THE ORACLE: WHAT `over` IS DOING GRAMMATICALLY ─────────────────────────
 * `over` is two prepositions wearing one spelling.
 *
 *   COMPARATIVE — "revenue over £2m". The complement measures the SUBJECT, and
 *                 `over` means "more than". A genuine bound.
 *   DURATIVE    — "output over 12 months". The complement is a SPAN OF TIME,
 *                 and `over` means "across". Not a bound on anything.
 *
 * `above` is NOT ambiguous: English has no durative `above`. "keep average
 * tenure above 12 months" is a threshold and stays one. That asymmetry is a
 * fact about the language, not a tuning constant, and it is the first conjunct
 * of the screen.
 *
 * ── WHY SUPPRESS RATHER THAN RE-UNIT ──────────────────────────────────────
 * Capturing the unit would make the row read `>= 12 months` and let a
 * DOWNSTREAM temporal filter drop it. That relocates the defect instead of
 * closing it: CEE's own `goal_constraints[]` — and the constraints panel the
 * user reads — would still carry an explicit floor the user never stated.
 * This file's standing doctrine applies unchanged: "A missing constraint is a
 * gap. An inverted one is ... a lie", and ROADMAP 2.653 drops mis-directed rows
 * rather than repairing them. A row whose DIMENSION is wrong is at least as
 * false as one whose OPERATOR is wrong.
 *
 * ── TWO QUESTIONS, TWO PREDICATES (CLAUDE.md trap 21) ─────────────────────
 * Q1 "should this row exist at all?"  -> the durative screen (suppression).
 * Q2 "if it exists, what unit does it carry?" -> the simple `X above Y` form
 *    now captures its unit word, exactly as its subject-optional sibling
 *    already did. These are NOT one heuristic patching another; they answer
 *    different questions and both are needed for the rows that survive.
 */

import { describe, it, expect } from "vitest";
import {
  extractCompoundGoals,
  parseValue,
  WORD_UNITS,
  WORD_UNIT_ALT,
  TIME_UNIT_ALT,
  type ExtractedGoalConstraint,
} from "../extractor.js";

/** The March 2026 wire-capture brief, verbatim. */
const MARCH_BRIEF =
  "I need to decide: hire one senior developer at £120k or two junior developers at £45k each. " +
  "Budget is £150k, goal is to maximise engineering output over 12 months.";

/** Verbatim from `tests/fixtures/golden/multi-option.json`. */
const MULTI_OPTION_BRIEF =
  "We need to choose a cloud provider: AWS, GCP, Azure, or on-premise. " +
  "Our goal is minimising total cost of ownership over 3 years.";

const lowerBounds = (brief: string): ExtractedGoalConstraint[] =>
  extractCompoundGoals(brief).constraints.filter((c) => c.operator === ">=");

const describeRow = (c: ExtractedGoalConstraint) =>
  `${c.operator}${c.value} unit=${JSON.stringify(c.unit)} target=${c.targetNodeId} ` +
  `conf=${c.confidence} prov=${c.provenance} quote=${JSON.stringify(c.sourceQuote)}`;

describe("a durative `over` is not a lower bound", () => {
  it("mints NO lower bound from the March 2026 capture brief", () => {
    const rows = lowerBounds(MARCH_BRIEF);
    expect(rows.map(describeRow)).toEqual([]);
  });

  it("does not stamp a fabricated floor on the goal factor", () => {
    const rows = lowerBounds(MARCH_BRIEF);
    // Bind by IDENTITY, not by a value predicate another row could satisfy.
    expect(rows.find((c) => c.targetNodeId === "fac_maximise_engineering_output")).toBeUndefined();
    expect(rows.find((c) => c.targetNodeId === "fac_unspecified")).toBeUndefined();
  });

  it("keeps the REAL constraint in the same brief (the £150k budget)", () => {
    const all = extractCompoundGoals(MARCH_BRIEF).constraints;
    const budget = all.find((c) => c.targetNodeId === "fac_budget");
    expect(budget).toBeDefined();
    expect(budget!.operator).toBe("<=");
    expect(budget!.value).toBe(150000);
  });

  it("mints NO lower bound from the multi-option golden fixture brief", () => {
    expect(lowerBounds(MULTI_OPTION_BRIEF).map(describeRow)).toEqual([]);
  });

  it.each([
    ["bare durative, months", "maximise engineering output over 12 months"],
    ["bare durative, years", "minimising total cost of ownership over 3 years"],
    ["bare durative, weeks", "grow the team over 6 weeks"],
    ["bare durative, days", "we will roll this out over 90 days"],
    ["bare durative, hours", "spread the training over 8 hours"],
  ])("suppresses both rows: %s", (_name, brief) => {
    expect(lowerBounds(brief).map(describeRow)).toEqual([]);
  });
});

describe("opposite-direction twins — genuine bounds must still mint", () => {
  it.each([
    // name,                          brief,                          target,        value,  unit
    ["currency threshold with `over`", "revenue over £2m",            "fac_revenue", 2000000, "£"],
    ["currency threshold, verb lead",  "grow revenue over £2m this year", "fac_grow_revenue", 2000000, "£"],
    ["percent floor with `above`",     "keep margin above 78%",       "fac_keep_margin", 0.78, "%"],
    // `above` has no durative reading in English — a temporal unit does not
    // make it one. This is the twin of every suppressed case above.
    ["temporal floor with `above`",    "keep average tenure above 12 months", "fac_keep_average_tenure", 12, "months"],
    // `percent` is the one non-temporal member of the word-unit alphabet, and
    // this twin is what makes that classification load-bearing: widen the
    // durative complement class to the WHOLE alphabet and this floor vanishes.
    ["percent floor with `over`",      "keep margin over 5 percent",   "fac_keep_margin", 0.05, "%"],
    // The screen is bounded to the match's OWN `over`. Without that bound the
    // durative `over` at the end of this sentence would suppress the
    // comparative one at the front — a false negative with no red anywhere.
    ["comparative `over` followed later by a durative one",
                                       "grow revenue over £2m over 12 months", "fac_grow_revenue", 2000000, "£"],
  ])("%s", (_name, brief, target, value, unit) => {
    const rows = lowerBounds(brief);
    const row = rows.find((c) => c.targetNodeId === target);
    expect(row, `rows were: ${rows.map(describeRow).join(" | ") || "(none)"}`).toBeDefined();
    expect(row!.value).toBe(value);
    expect(row!.unit).toBe(unit);
  });

  it.each([
    ["explicit at-least form", "maintain at least £500k cash", "fac_cash", 500000],
    ["no-less-than form",      "no less than 20 engineers",    "fac_engineers", 20],
  ])("%s is untouched by the screen", (_name, brief, target, value) => {
    const row = lowerBounds(brief).find((c) => c.targetNodeId === target);
    expect(row).toBeDefined();
    expect(row!.value).toBe(value);
  });

  it("a comparative-verb form keeps its bound even with a temporal complement", () => {
    // "must be over 12 months" carries an explicit comparative verb, so its
    // `over` is unambiguously comparative and the screen does not reach it.
    const rows = lowerBounds("delivery must be over 12 months");
    expect(rows.length, `rows were: ${rows.map(describeRow).join(" | ") || "(none)"}`).toBeGreaterThan(0);
    expect(rows.every((c) => c.value === 12)).toBe(true);
  });
});

describe("one sentence must not yield two rows that disagree about the unit", () => {
  const CORPUS = [
    MARCH_BRIEF,
    MULTI_OPTION_BRIEF,
    "maximise engineering output over 12 months",
    "revenue over £2m",
    "grow revenue over £2m this year",
    "keep margin above 78%",
    "keep average tenure above 12 months",
    "maintain at least £500k cash",
    "no less than 20 engineers",
    "grow the team over 6 weeks",
    "margin above 78 percent",
    "keep margin over 5 percent",
    "grow revenue over £2m over 12 months",
  ];

  it("collects the corpus (a shrunk corpus voids every number below)", () => {
    expect(CORPUS).toHaveLength(13);
  });

  it.each(CORPUS.map((b, i) => [i, b] as const))(
    "case %i agrees on unit across rows: %s",
    (_i, brief) => {
      const rows = lowerBounds(brief);
      const byOperand = new Map<string, Set<string>>();
      for (const c of rows) {
        const key = `${c.operator}|${c.value}`;
        if (!byOperand.has(key)) byOperand.set(key, new Set());
        byOperand.get(key)!.add(c.unit);
      }
      const disagreements = [...byOperand.entries()]
        .filter(([, units]) => units.size > 1)
        .map(([k, units]) => `${k} -> {${[...units].map((u) => JSON.stringify(u)).join(", ")}}`);
      expect(disagreements, `rows were: ${rows.map(describeRow).join(" | ") || "(none)"}`).toEqual([]);
    },
  );
});

/**
 * ⭐ THE RESIDUE — RECORDED, NOT CLOSED.
 *
 * The screen can only see a complement the WORD-UNIT ALPHABET spells, and that
 * alphabet does not carry `quarters`. "over 3 quarters" therefore still mints a
 * floor of 3 — the same category error, out of the screen's reach.
 *
 * It is NOT closed here. Adding a member to the alphabet widens `_VAL` and
 * `parseValue`, which feed the reduction patterns, the upper bounds and the
 * noun path — every one of them pinned by corpora this lane must not disturb.
 * Widening it is a separate, measurable change with its own regression surface,
 * not a "while we're here" edit.
 *
 * So it is PINNED as an exact known gap instead: RED if it silently closes, RED
 * if it silently spreads. A gap recorded in the suite is honest; a gap invisible
 * to it is how four rounds happen (CLAUDE.md trap 22f).
 */
describe("known gap — complements outside the word-unit alphabet", () => {
  it("still mints a floor from `over 3 quarters` (alphabet has no `quarters`)", () => {
    const rows = lowerBounds("spread the rollout over 3 quarters");
    expect(rows.map((c) => c.value)).toEqual([3, 3]);
    // ...and the two rows still AGREE about the unit, which is the property
    // this lane owns. The gap is recognition, not disagreement.
    expect(new Set(rows.map((c) => c.unit))).toEqual(new Set([""]));
  });

  it("is a gap in RECOGNITION only — the screen still holds for spelled units", () => {
    // Contrast control in the same test: the adjacent spelled unit is suppressed,
    // so the assertion above is about the alphabet and not about a dead screen.
    expect(lowerBounds("spread the rollout over 3 years")).toEqual([]);
  });
});

describe("word-unit alphabet — derived, and every member classified", () => {
  it("is the exact alphabet, in declaration order", () => {
    expect(WORD_UNIT_ALT).toBe("hours?|months?|days?|weeks?|years?|percent");
  });

  it("derives the temporal subset from the same list", () => {
    expect(TIME_UNIT_ALT).toBe("hours?|months?|days?|weeks?|years?");
  });

  it("classifies every member — a new unit cannot be added unclassified", () => {
    // `temporal` is a required field on the tuple, so an unclassified member is
    // a type error; this asserts the RUNTIME shape too, and that the two
    // derived alternations partition the list with nothing lost.
    expect(WORD_UNITS.every((u) => typeof u.temporal === "boolean")).toBe(true);
    expect(WORD_UNITS.filter((u) => u.temporal).length + WORD_UNITS.filter((u) => !u.temporal).length)
      .toBe(WORD_UNITS.length);
    expect(WORD_UNITS.length).toBe(6);
  });

  it("the parser reads every spelling the patterns can capture", () => {
    // The drift pair this list abolished: a pattern alphabet and a parser
    // alphabet that must agree. Derived, so it cannot silently diverge — but
    // derivation proves AGREEMENT, never completeness (CLAUDE.md trap 12d),
    // which is what the corpus above is for.
    for (const u of WORD_UNITS) {
      const spelling = u.alt.replace(/\?$/, "");
      const { value, unit } = parseValue(`12 ${spelling}`);
      expect(unit, `parseValue lost the unit for "12 ${spelling}"`).not.toBe("");
      expect(value, `parseValue lost the value for "12 ${spelling}"`).toBeGreaterThan(0);
    }
  });
});
