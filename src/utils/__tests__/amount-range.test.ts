/**
 * ⭐⭐ THE HAND-WRITTEN HALF — the only thing that can notice a rule is wrong
 * (ROADMAP 2.1131, CLAUDE.md trap 12d).
 *
 * `amount-pattern-magnitude-coverage.test.ts` proves every amount-reading
 * pattern CONSULTS the alphabet. It cannot prove any of them reads a range
 * CORRECTLY, and it cannot prove the shared-suffix rule is the right rule.
 * Only a corpus can, and a corpus written from the author's head can only see
 * the classes the author imagined (trap 22).
 *
 * ── WHERE THESE CASES COME FROM ────────────────────────────────────────────
 * Group A is VERBATIM from the 3 Sep 2026 manual test — Paul's own brief and
 * the assistant's own sentences, taken out of
 * `artefacts/manual-test-2026-09-03/olumi-debug-f2e2df1b-20260903.json`, not
 * invented here. Group B is ordinary British business prose of the same shape.
 * Group C is the ADVERSARIAL half: every case has an opposite-direction twin,
 * because this one predicate guards two opposite harms — dropping a magnitude
 * (1,000x short) and inventing one (1,000x long) — and a corpus that only
 * tests one direction is a guard watching one door (trap 22b).
 *
 * ── AND THE REFUSED SET IS PINNED EXACTLY ──────────────────────────────────
 * Some range shapes have no single reading and this module refuses them. That
 * gap is recorded here as an exact set, so the suite REDs if it GROWS (a shape
 * that used to work now refuses) or SHRINKS (something started guessing). A
 * gap the suite can see is honest; a gap it cannot see is how four rounds of
 * oscillation happen (trap 22f).
 */

import { describe, expect, it } from "vitest";
import { AMOUNT_DIGITS, AMOUNT_RUN_END } from "../magnitude-alphabet.js";
import {
  RANGE_LOWER_BOUND_ABSENT_GUARD,
  rangePointEstimate,
  resolveAmountPairBothOrNeither,
  resolveAmountRange,
} from "../amount-range.js";
import { extractFactors } from "../../cee/factor-extraction/index.js";
import { parseNumericValue } from "../../cee/extraction/numeric-parser.js";

/* ===========================================================================
 * GROUP A — THE WITNESSED SESSION, VERBATIM.
 * ======================================================================== */

/**
 * Paul's brief clause, as the assistant itself quoted it back on 3 Sep:
 * "your brief mentions £80-120k for the first hire, but the model stored the
 * raw figure as £80 rather than £80,000".
 */
const WITNESSED_CLAUSE = "We're budgeting £80-120k for the first hire.";

describe("the 3 Sep 2026 session, at the bytes that produced it", () => {
  it("£80-120k is EIGHTY THOUSAND to ONE HUNDRED AND TWENTY THOUSAND, in the factor extractor", () => {
    const factors = extractFactors(WITNESSED_CLAUSE);
    const range = factors.find((f) => f.extractionType === "range");
    expect(range, "the brief's range did not extract at all").toBeDefined();
    expect(range!.rangeMin, "the £80 that reached the graph and set the scale").toBe(80_000);
    expect(range!.rangeMax).toBe(120_000);
    expect(range!.unit).toBe("£");
  });

  it("…and NOTHING in that sentence extracts as 80, at any confidence", () => {
    // ⚠ BOUND TO THE HARM, NOT TO THE PATTERN. The magnitude fix alone left
    // this failing: the bare `currency` pattern still read "£80" and stopped
    // at the hyphen, so a correctly-read range travelled beside a point taken
    // from its own first half — and `mergeFactors` picked the short one. That
    // 80 is the number in the debug bundle (`raw_value: 80`, `cap: 100`), so
    // the assertion that matters is about the NUMBER reaching a user, not
    // about which pattern produced it.
    const values = extractFactors(WITNESSED_CLAUSE).map((f) => f.value);
    expect(values, "a 1,000x-short twin of a correctly-read amount").not.toContain(80);
    expect(values).not.toContain(120);
  });

  it("the option path and the factor path agree about the same sentence", () => {
    // The dispatched premise was that these two disagreed because one had a
    // shorter magnitude alphabet. MEASURED at f4c8f50: BOTH dropped the `k`
    // (factor → 80..120, parser → 80). They share one grammar now, so
    // agreement is structural rather than coincidental — and this asserts it
    // on the sentence that broke.
    const factorRange = extractFactors(WITNESSED_CLAUSE).find(
      (f) => f.extractionType === "range",
    );
    const parsed = parseNumericValue(WITNESSED_CLAUSE);
    expect(parsed!.rangeMin).toBe(factorRange!.rangeMin);
    expect(parsed!.rangeMax).toBe(factorRange!.rangeMax);
    expect(parsed!.value).toBe(factorRange!.value);
  });

  it("a range says it is a range, and does not pass as a stated point", () => {
    const parsed = parseNumericValue(WITNESSED_CLAUSE);
    expect(parsed!.isRange).toBe(true);
    expect(parsed!.confidence, "a point taken from a range is the SERVICE's estimate").toBe(
      "medium",
    );
    // The point is derived from the bounds by the ONE shared chooser, so the
    // number a user is told is the number the model runs on.
    expect(parsed!.value).toBe(rangePointEstimate({ min: 80_000, max: 120_000 }));
  });
});

/* ===========================================================================
 * GROUP B — ORDINARY BUSINESS PROSE OF THE SAME SHAPE.
 *
 * [brief, expected min, expected max]. Each states its magnitude ONCE, after
 * the pair, which is how English writes a money range.
 * ======================================================================== */

const ELLIPTICAL: readonly (readonly [string, number, number])[] = [
  ["We're budgeting £80-120k for the first hire.", 80_000, 120_000],
  ["Budget between £2-5m for the platform.", 2_000_000, 5_000_000],
  ["Pricing between £50-70k a year.", 50_000, 70_000],
  ["We expect between 5 and 10 thousand signups.", 5_000, 10_000],
  ["between 2 and 5 million users", 2_000_000, 5_000_000],
  ["Runway of between 12 and 18 months.", 12, 18],
  ["£80-120k", 80_000, 120_000],
  ["£2-5bn", 2_000_000_000, 5_000_000_000],
  ["between 100 and 250 grand", 100_000, 250_000],
];

describe("a magnitude written once after a pair scopes the pair", () => {
  for (const [brief, min, max] of ELLIPTICAL) {
    it(`${JSON.stringify(brief)} → ${min.toLocaleString("en-GB")}..${max.toLocaleString("en-GB")}`, () => {
      const range = extractFactors(brief).find((f) => f.extractionType === "range");
      expect(range, "no range extracted").toBeDefined();
      expect(range!.rangeMin).toBe(min);
      expect(range!.rangeMax).toBe(max);
    });
  }
});

/* ===========================================================================
 * GROUP C — THE OPPOSITE DIRECTION. A magnitude must never be INVENTED.
 * ======================================================================== */

const NO_MAGNITUDE_STATED: readonly (readonly [string, number, number])[] = [
  ["Pricing between £50-70.", 50, 70],
  ["between 20 and 40 customers", 20, 40],
  // The word after the pair BEGINS with a magnitude key and is not one. Each
  // of these is a fabrication waiting to happen — the `\b` in the shared
  // fragment is what stops it, and this is the corpus that would notice if it
  // were removed (#787's defect, in range form).
  ["between 5 and 10 months", 5, 10],
  ["between 20 and 30 basis-point moves", 20, 30],
  ["between 3 and 6 top-line hires", 3, 6],
];

describe("a magnitude is never invented from the word after the range", () => {
  for (const [brief, min, max] of NO_MAGNITUDE_STATED) {
    it(`${JSON.stringify(brief)} stays ${min}..${max}`, () => {
      const range = extractFactors(brief).find((f) => f.extractionType === "range");
      expect(range, "no range extracted").toBeDefined();
      expect(range!.rangeMin).toBe(min);
      expect(range!.rangeMax).toBe(max);
    });
  }
});

/* ===========================================================================
 * THE REFUSED SET, PINNED EXACTLY.
 * ======================================================================== */

describe("shapes with no single reading are refused, and the refused set is exact", () => {
  const AMBIGUOUS: readonly string[] = [
    // Descending bare digits under a trailing magnitude. Distribution gives
    // 500m..2m (absurd); non-distribution gives £500..£2,000,000 (a 4,000x
    // range nobody wrote). Both readings are 1,000x-class errors.
    "£500-2m",
    // Ellipsis reads backwards from the end of a coordinate structure, never
    // forwards, so a magnitude on the LOWER bound alone scopes nothing.
    "£2m-5",
  ];

  for (const text of AMBIGUOUS) {
    it(`${JSON.stringify(text)} publishes NOTHING rather than a guess`, () => {
      // The refusal must reach all the way out of the parser. Its first cut
      // returned `null` from the range branch and then fell through to
      // `parseCurrencyValue`, which handed back **500** at confidence "high" —
      // the exact publication the refusal existed to prevent, arriving one
      // line later.
      expect(parseNumericValue(text)).toBeNull();
      expect(extractFactors(text).filter((f) => f.extractionType === "range")).toEqual([]);
    });
  }

  it("the refusals are NOT a blanket — the resolver still resolves (positive control)", () => {
    // A refuser that refuses everything passes every assertion above while
    // being useless. This is the discrimination the refusal cases cannot make
    // about themselves.
    expect(
      resolveAmountRange({
        minDigits: "80",
        minMagnitude: undefined,
        maxDigits: "120",
        maxMagnitude: "k",
      }),
    ).toEqual({ min: 80_000, max: 120_000, magnitudeDistributed: true });
    expect(
      resolveAmountRange({
        minDigits: "50",
        minMagnitude: undefined,
        maxDigits: "70",
        maxMagnitude: undefined,
      }),
    ).toEqual({ min: 50, max: 70, magnitudeDistributed: false });
  });

  it("refuses a lower-only magnitude and a descending elliptical pair, and nothing else", () => {
    expect(
      resolveAmountRange({
        minDigits: "2",
        minMagnitude: "m",
        maxDigits: "5",
        maxMagnitude: undefined,
      }),
    ).toBeNull();
    expect(
      resolveAmountRange({
        minDigits: "500",
        minMagnitude: undefined,
        maxDigits: "2",
        maxMagnitude: "m",
      }),
    ).toBeNull();
    // …and a DESCENDING pair where both bounds state their own magnitude is
    // the writer's, not an ellipsis artefact, so it is NOT newly refused.
    // Narrowing the accepted set is a separate decision from reading
    // magnitudes correctly.
    expect(
      resolveAmountRange({
        minDigits: "5",
        minMagnitude: "m",
        maxDigits: "2",
        maxMagnitude: "m",
      }),
    ).toEqual({ min: 5_000_000, max: 2_000_000, magnitudeDistributed: false });
  });
});

/* ===========================================================================
 * THE FROM-TO CHANGE — a DIFFERENT question, and its gap is recorded.
 * ======================================================================== */

describe("a from-to change is not a range", () => {
  it("both bounds carrying their own magnitude now extracts at all", () => {
    // At f4c8f50 this returned NOTHING: `changePattern` could not match a
    // magnitude-bearing bound, so a stated change vanished in silence.
    const factors = extractFactors("We will increase from 400k to 900k.");
    const change = factors.find((f) => f.extractionType === "explicit");
    expect(change, "the change did not extract").toBeDefined();
    expect(change!.baseline).toBe(400_000);
    expect(change!.value).toBe(900_000);
  });

  it("a DECREASE descends, and is not refused for descending", () => {
    // The property that makes this a different question from a range.
    const factors = extractFactors("We will decrease from 900k to 400k.");
    const change = factors.find((f) => f.extractionType === "explicit");
    expect(change!.baseline).toBe(900_000);
    expect(change!.value).toBe(400_000);
  });

  it("the elliptical from-to is a KNOWN GAP, refused rather than guessed", () => {
    // Pinned as an exact set, per trap 22f. Reading "from 400 to 900k"
    // correctly needs a direction-aware predicate and a corpus of real from-to
    // sentences; writing that from one head is how the estate got four rounds
    // of oscillation on a different predicate. The refusal is honest; a guess
    // in either direction is 1,000x wrong.
    expect(
      resolveAmountPairBothOrNeither({
        minDigits: "400",
        minMagnitude: undefined,
        maxDigits: "900",
        maxMagnitude: "k",
      }),
    ).toBeNull();
    // Positive control: the both-and-neither cases still resolve, so the
    // refusal above is a discrimination and not a dead function.
    expect(
      resolveAmountPairBothOrNeither({
        minDigits: "10",
        minMagnitude: undefined,
        maxDigits: "20",
        maxMagnitude: undefined,
      }),
    ).toEqual({ min: 10, max: 20, magnitudeDistributed: false });
  });
});

describe("AMOUNT_RUN_END distinguishes a THOUSANDS group from a sentence comma", () => {
  /**
   * ⚠⚠ THE FIRST SPELLING WAS `(?![\\d,])` — "do not stop before a digit OR A
   * COMMA" — and it therefore refused every amount followed by an ordinary
   * sentence comma. The anchor sits inside BOTH decline guards, so no sibling
   * pattern caught what it refused, and the number the user typed simply
   * vanished. Five of the strings below were ALREADY in this repo as fixtures
   * for the compound-goal path: the code's blind spot and the corpus's blind
   * spot were the same one.
   *
   * ⭐ ASSERTED ON THE REGEX DIRECTLY as well as through the extractor. That is
   * how this estate caught the backtracking defect in the first place: a guard
   * proven only through a caller that supplies its missing precondition has not
   * been proven.
   */
  const runEnd = new RegExp(`(?<amount>${AMOUNT_DIGITS})${AMOUNT_RUN_END}`);

  it.each([
    ["£800,000, which is a lot", "800,000"],
    ["£800,000 last year", "800,000"],
    ["£50, and the rest", "50"],
    ["£1,200-2,400", "1,200"],
    ["£49.", "49"],
    ["£1,234,567, roughly", "1,234,567"],
  ])("%s reads the WHOLE run, stopping only where the run ends", (text, expected) => {
    expect(runEnd.exec(text)?.groups?.amount).toBe(expected);
  });

  it("⭐ THE TWIN: it still refuses to stop BETWEEN thousands groups", () => {
    // The job the comma limb actually has, and the reason it cannot simply be
    // deleted. Anchored at the start so the engine cannot slide the match to a
    // later, legal position — this asserts the ANCHOR, not the scan.
    const anchored = new RegExp(`^(?<amount>${AMOUNT_DIGITS})${AMOUNT_RUN_END}`);
    // "800" is followed by ",000" — a thousands group — so stopping there is
    // forbidden and the whole run is taken instead.
    expect(anchored.exec("800,000 spent")?.groups?.amount).toBe("800,000");
    // …and the other two limbs still bite.
    expect(anchored.exec("1.5 million")?.groups?.amount).toBe("1.5");
    expect(new RegExp(`^(?<amount>\\d)${AMOUNT_RUN_END}`).exec("80")).toBeNull();
  });

  /**
   * One case per pattern that carries a decline guard, bound to the pattern by
   * its `matchedText` span rather than by the value alone — a different pattern
   * matching the same number would otherwise satisfy the assertion (trap 19).
   */
  it.each([
    ["PATTERNS.currency", "The budget for this is £50,000, hard.", 50_000, "£50,000"],
    ["PATTERNS.contextualNumber", "budget of £180,000, plus contingency", 180_000, "budget of £180,000"],
    ["PATTERNS.approximateValue", "roughly £250,000, plus VAT", 250_000, "roughly £250,000"],
  ])("%s survives an amount followed by a sentence comma", (_pattern, text, value, span) => {
    const factors = extractFactors(text);
    const hit = factors.find((f) => f.matchedText === span);
    expect(hit, `nothing matched the span ${span} — the figure was dropped`).toBeDefined();
    expect(hit!.value).toBe(value);
  });

  it("the three-vendor brief keeps ALL THREE figures, not just the last", () => {
    // Already a fixture in this repo (`noun-form-real-briefs.json`), and the
    // shape that makes the drop visible: the first two amounts are each
    // followed by a comma, so both vanished and only the third survived.
    const values = extractFactors(
      "Vendor A at £180,000, Vendor B at £240,000, and an in-house build at £200,000.",
    ).map((f) => f.value);
    expect(values.sort((a, b) => a - b)).toEqual([180_000, 200_000, 240_000]);
  });

  it("⭐ and the amounts the guards are FOR are still declined", () => {
    // The opposite-direction twin for the whole change: widening the anchor
    // must not reopen either defect it was written to close.
    const bareTwin = extractFactors("The cost is £80k.").filter((f) => f.value === 80);
    expect(bareTwin, "the 1,000x-short bare twin came back").toEqual([]);
    const rangeHalf = extractFactors("We're budgeting £80-120k for the first hire.");
    expect(rangeHalf.some((f) => f.value === 80), "half a range published as a point").toBe(false);
    expect(rangeHalf.some((f) => f.rangeMin === 80_000 && f.rangeMax === 120_000)).toBe(true);
  });
});

describe("the same rule reaches numeric-parser: a from-to frame is not a range", () => {
  /**
   * ⚠ THIS CLASS SHIPPED, AND THE CORPUS COULD NOT SEE IT. `RANGE_SEPARATOR`
   * admits `\s+to\s+`, and every range pattern in `numeric-parser` makes its
   * `between` prefix optional, so `from X to Y` matched as a range. When the
   * pair DESCENDS — which is what "reduce", "cut" and "lower" mean — the
   * percent resolver refused, `RANGE_REFUSED` stopped the chain, and the
   * caller got NULL. Every from-to fixture in the repo ascended, so the corpus
   * excluded the class outright and certified nothing over it.
   *
   * Both consumers are the option-intervention path
   * (`intervention-extractor.ts` `continue`s on falsy at `:407`, pushes
   * `value: null` at `:329`), so the intervention was dropped or nulled.
   */
  const DESCENDING_CHANGES: ReadonlyArray<readonly [string, number, string]> = [
    ["reduce churn from 10% to 5%", 10, "percent"],
    ["bring churn from 12% to 8%", 12, "percent"],
    ["from 10% to 5%", 10, "percent"],
    ["cut CAC from £600 to £400", 600, "GBP"],
    ["lower CAC from £600k to £400k", 600_000, "GBP"],
    ["cut spend from £2m to £500k", 2_000_000, "GBP"],
  ];

  it.each(DESCENDING_CHANGES)(
    "%s reads the stated FROM figure, not null and not an inverted range",
    (text, expected, unit) => {
      const parsed = parseNumericValue(text);
      expect(parsed, `${text} parsed to nothing`).not.toBeNull();
      expect(parsed!.value).toBe(expected);
      expect(parsed!.unit).toBe(unit);
      // The two shapes this class used to produce, both forbidden.
      expect(parsed!.isRange ?? false, "a change is not a range").toBe(false);
      expect(parsed!.rangeMin).toBeUndefined();
      expect(parsed!.rangeMax).toBeUndefined();
    },
  );

  it("an ASCENDING from-to is treated the same way — the frame decides, not the ordering", () => {
    // ⚠ THE OPPOSITE-DIRECTION TWIN (trap 22b). If the fix had keyed on
    // "descending" rather than on the FRAME, this case would still read as a
    // range and the predicate would carry the same asymmetry as the defect.
    for (const [text, expected] of [
      ["raise price from £49 to £59", 49],
      ["increase revenue from 10% to 12%", 10],
      ["from £80,000 to £100,000", 80_000],
    ] as const) {
      const parsed = parseNumericValue(text);
      expect(parsed!.value, text).toBe(expected);
      expect(parsed!.isRange ?? false, text).toBe(false);
    }
  });

  it("⭐ the refusal binds by POSITION, so a `from` elsewhere in the sentence is not a frame", () => {
    // The discriminating twin for the binding itself. `isFromToChangeFrame`
    // asks whether THIS match's own lower bound is the object of a `from`,
    // never whether the word occurs in the text (trap 19). Without that, a
    // stray "from" would suppress a genuine range.
    const stillARange = parseNumericValue("we moved away from that, and the budget is £5,000-£9,000");
    expect(stillARange!.isRange).toBe(true);
    expect(stillARange!.rangeMin).toBe(5_000);
    expect(stillARange!.rangeMax).toBe(9_000);
  });
});

describe("`and` joins a range ONLY where `between` anchors its lower bound", () => {
  /**
   * ⚠ AN UNANCHORED `and` MANUFACTURED A MIDPOINT NOBODY WROTE. The separator
   * admitted the bare word while `currencyRange`/`percentRange` make their
   * `between` prefix optional, so two independently stated amounts became one
   * range. That is the OVER-READ direction — a fabricated magnitude.
   */
  it.each([
    ["We pay £500 and £700 per month.", [500, 700]],
    ["Costs are £30k and £45k respectively.", [30_000, 45_000]],
    ["we raised £2.5m and £500k in grants", [2_500_000, 500_000]],
  ] as ReadonlyArray<readonly [string, readonly number[]]>)(
    "%s stays TWO points, with no invented midpoint",
    (text, expected) => {
      const values = extractFactors(text).map((f) => f.value);
      expect(values.sort((a, b) => a - b)).toEqual([...expected].sort((a, b) => a - b));
      expect(
        extractFactors(text).some((f) => f.rangeMin !== undefined),
        "a range was manufactured from an ordinary `and`",
      ).toBe(false);
    },
  );

  it("⭐ THE TWIN: with `between` on the lower bound it IS a range — deleting `and` outright was also wrong", () => {
    // The first cut of this fix dropped the word entirely and broke this
    // already-pinned case. One control cannot cover two opposite defects, so
    // both directions are asserted here.
    const parsed = parseNumericValue("between £20,000 and £30,000");
    expect(parsed!.isRange).toBe(true);
    expect(parsed!.rangeMin).toBe(20_000);
    expect(parsed!.rangeMax).toBe(30_000);
    expect(parsed!.value).toBe(25_000);
    expect(parsed!.confidence).toBe("medium");
  });

  it("the anchor must govern THIS lower bound, not merely appear in the sentence", () => {
    // Positional binding again: "between" is present, but it governs a phrase,
    // not the amount. A proximity heuristic would read this as a range.
    const parsed = parseNumericValue("between two options, we pay £500 and £700");
    expect(parsed!.value).toBe(500);
    expect(parsed!.isRange ?? false).toBe(false);
  });
});

/* ===========================================================================
 * THE TWO DECLINE GUARDS — proven to discriminate, not merely to decline.
 * ======================================================================== */

describe("a bare dash range with no currency and no % is a KNOWN GAP", () => {
  it("\"Seats between 5-9.\" extracts no range — recorded, not fixed", () => {
    // PRE-EXISTING at f4c8f50 and deliberately not closed here. `genericRange`
    // is anchored on "between" and takes the WORD separator only; admitting the
    // dash would make it also match "between 5-10%" and emit a UNITLESS 5..10
    // beside `percentRange`'s 0.05..0.10 — one written range arriving as two
    // factors on two different scales. Closing it properly needs a
    // unit-aware precedence rule, which is a separate decision with its own
    // corpus. Pinned so the gap is visible and so closing it REDs here rather
    // than passing unnoticed (trap 22f).
    expect(extractFactors("Seats between 5-9.").filter((f) => f.extractionType === "range"))
      .toEqual([]);
  });
});

describe("the lower-bound guard declines half a range and nothing else", () => {
  it("an ordinary parenthetical dash is untouched", () => {
    // The guard requires a DIGIT after the separator. Without that it would
    // eat every amount followed by an em-dash aside — a silent extraction loss
    // dressed as a fix.
    const factors = extractFactors("The £500 — a lot of money — was spent on tooling.");
    expect(factors.map((f) => f.value)).toContain(500);
  });

  it("declines a match that STARTS at the lower bound, and cannot be backtracked past", () => {
    // ⚠ ANCHORED, AND THE ANCHOR IS THE WHOLE ASSERTION. Unanchored, this
    // regex matches "80-120" — on the **120** — because the engine simply
    // advances the start position, and 120 is not a lower bound. That is
    // correct behaviour and my first version of this test read it as a
    // failure; in the real patterns a currency symbol or a context word pins
    // the start, so only the lower bound is ever attempted.
    //
    // What the anchor DOES catch, and what nothing else did: the greedy digit
    // group backtracking past the lookahead. Without `AMOUNT_RUN_END` this
    // matched "8" of "80-120" and the guard declined nothing at all.
    const re = new RegExp(`^(?<amount>${AMOUNT_DIGITS})${RANGE_LOWER_BOUND_ABSENT_GUARD}`);
    expect(re.exec("80-120"), "the lower bound of a written range").toBeNull();
    expect(re.exec("80–120"), "en dash").toBeNull();
    expect(re.exec("80 - 120"), "spaced hyphen").toBeNull();
    // …and the amounts that are NOT half a range still match, in full.
    expect(re.exec("80 - a note")?.[0]).toBe("80");
    expect(re.exec("80")?.[0]).toBe("80");
    expect(re.exec("80,000")?.[0], "the separator run is not truncated").toBe("80,000");
    expect(re.exec("80,000-120,000"), "a separated range is still half a range").toBeNull();

    // ⚠ AND THE ANCHOR REFUSES RATHER THAN TRUNCATES. With a bare `\\d+` in
    // place of the shared digit grammar, "80,000" matches only "80" — the
    // 1,000x comma loss ROADMAP 2.338 closed, arriving through a guard. The
    // anchor makes that a NO MATCH instead of a short one, which is why it is
    // spelled `(?![\\d,])` rather than `(?!\\d)`.
    const bare = new RegExp(`^(?<amount>\\d+)${RANGE_LOWER_BOUND_ABSENT_GUARD}`);
    expect(bare.exec("80,000"), "refuses rather than publishing a truncated 80").toBeNull();
  });
});

describe("the percent range no longer reads its hyphen as a minus sign", () => {
  it("5-10% is seven and a half percent, not NEGATIVE TEN", () => {
    // MEASURED at f4c8f50: parseNumericValue("churn between 5-10%") returned
    // **-10** at confidence "high" — a stated 5-to-10% churn band arriving as
    // a number pointing the opposite way to the sentence that produced it.
    const parsed = parseNumericValue("churn between 5-10%");
    expect(parsed!.value).toBe(7.5);
    expect(parsed!.rangeMin).toBe(5);
    expect(parsed!.rangeMax).toBe(10);
  });

  it("…and a GENUINE negative percentage still parses (opposite-direction twin)", () => {
    // Losing a range is a gap; inventing a sign is a lie — but refusing every
    // sign is a third defect, and this is the case that would notice it.
    expect(parseNumericValue("-10%")!.value).toBe(-10);
    expect(parseNumericValue("margin moved -10% last quarter")!.value).toBe(-10);
  });

  it("a DATE is not a percentage band, on either path", () => {
    // ⚠ THE MUTANT THAT FOUND THIS. A lookbehind was added to
    // `parsePercentageValue` to stop the sign flip; deleting it left all 138
    // tests green, because `parseRangeValue` claims every hyphen-joined
    // percent shape before that pattern is reached. The guard could not bite,
    // so it was removed — and the enumeration that proved it unreachable
    // turned up the case that IS still wrong:
    //
    //     "revenue 2024-10%"   parser  →  -10        (hyphen read as a minus)
    //                          factor  →  20.24 .. 0.1  (a floor of 2,024%)
    //
    // A year and a month, read as a percentage band, in two different wrong
    // directions on the two paths. Both now refuse, by the rule already
    // written for money ranges: a pair whose digits DESCEND is not a range.
    expect(parseNumericValue("revenue 2024-10%")).toBeNull();
    expect(
      extractFactors("revenue 2024-10%").filter((f) => f.extractionType === "range"),
    ).toEqual([]);
  });

  it("…and an ASCENDING percent range still extracts (positive control)", () => {
    // A refuser that refuses every percent range would pass the case above
    // while destroying the feature. This is the discrimination that case
    // cannot make about itself.
    const range = extractFactors("churn between 5-10%").find(
      (f) => f.extractionType === "range",
    );
    expect(range!.rangeMin).toBeCloseTo(0.05);
    expect(range!.rangeMax).toBeCloseTo(0.1);
  });
});
