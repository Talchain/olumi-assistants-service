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
    // ⚠⚠ THIS PIN MOVED, AND THE REASON IS A MEASUREMENT, NOT A PREFERENCE.
    // It asserted `{min: 5_000_000, max: 2_000_000}` on the stated grounds that
    // "the extractors already tolerated it". That ground is false for a
    // magnitude-bearing pair:
    //
    //   "We will cut spend from £2m to £500k this year."
    //     f4c8f501  {value 2_000_000, extractionType "explicit", conf 0.85}
    //     479c7c97  {value 1_250_000, extractionType "range",
    //                rangeMin 2_000_000, rangeMax 500_000}
    //
    // Base emitted no range there at all — it could not read a magnitude on
    // either bound of a `to`-joined pair — so the tolerance was CREATED by
    // reading them, not inherited. What it created was a midpoint of
    // £1,250,000 standing in for the writer's own stated £2m. Refusing
    // restores the base output on that set exactly.
    //
    // ⚠ TWO NAMED MEASUREMENT BASES HAVE NOW BEEN WRONG IN THIS COMMENT, so it
    // no longer names one. It first said the figures were driven through
    // `enrichGraphWithFactors` — the `@deprecated` SYNC twin, zero src call
    // sites outside its own module, minting no cap (the review meta-finding).
    // The correction then said they were "re-derived through the async entry",
    // which is equally unpinnable: nothing in this repo drives either enricher
    // on this string, and `FactorDataT` and `ExtractedFactor` BOTH carry
    // `extractionType` and `confidence`, so the figures cannot say which
    // function produced them. The historical pair above is kept as a dated
    // record of two commits and is claimed as nothing more.
    //
    // WHAT ACTUALLY PINS THE BEHAVIOUR, at two levels: the
    // `resolveAmountRange(…) → null` assertion immediately below, and — on the
    // path a user reaches — "⭐ the refusal reaches the USER-REACHABLE path: a
    // stated figure is no longer replaced by a midpoint", where `extractFactors`
    // on this exact sentence must yield exactly [500_000, 2_000_000] and no
    // 1_250_000. Both go red if the refusal is removed.
    expect(
      resolveAmountRange({
        minDigits: "5",
        minMagnitude: "m",
        maxDigits: "2",
        maxMagnitude: "m",
      }),
    ).toBeNull();
    // …and the ASCENDING twin, so the refusal keys on the ORDERING and not on
    // the presence of two magnitudes. Without this, refusing every
    // both-magnitude pair would pass the case above and destroy the feature.
    expect(
      resolveAmountRange({
        minDigits: "2",
        minMagnitude: "m",
        maxDigits: "5",
        maxMagnitude: "m",
      }),
    ).toEqual({ min: 2_000_000, max: 5_000_000, magnitudeDistributed: false });
    // …and the INHERITED tolerance is untouched: neither bound carries a
    // magnitude, base and head are identical on it, and narrowing it is not
    // this change's to take. The opposite-direction twin for the refusal.
    expect(
      resolveAmountRange({
        minDigits: "600",
        minMagnitude: undefined,
        maxDigits: "400",
        maxMagnitude: undefined,
      }),
    ).toEqual({ min: 600, max: 400, magnitudeDistributed: false });
  });

  it("⭐ the refusal reaches the USER-REACHABLE path: a stated figure is no longer replaced by a midpoint", () => {
    // The whole point of the pin above, asserted where it is felt rather than
    // only at the resolver. At `479c7c97` this brief yielded a single factor
    // whose value was 1_250_000 with rangeMin 2_000_000 > rangeMax 500_000.
    const factors = extractFactors("We will cut spend from £2m to £500k this year.");
    expect(
      factors.some((f) => f.value === 1_250_000),
      "a midpoint the writer never wrote came back",
    ).toBe(false);
    expect(
      factors.some(
        (f) => f.rangeMin !== undefined && f.rangeMax !== undefined && f.rangeMin > f.rangeMax,
      ),
      "an inverted range came back",
    ).toBe(false);
    // Both stated figures survive, which is what the base did.
    const values = factors.map((f) => f.value).sort((a, b) => a - b);
    expect(values).toEqual([500_000, 2_000_000]);
  });

  it("⭐ TWIN: the headline range fix is untouched by the refusal", () => {
    // A refusal that swallowed ascending ranges would pass every assertion
    // above while deleting the reason this PR exists.
    const range = extractFactors("We're budgeting £80-120k for the first hire.").find(
      (f) => f.extractionType === "range",
    );
    expect(range!.value).toBe(100_000);
    expect(range!.rangeMin).toBe(80_000);
    expect(range!.rangeMax).toBe(120_000);
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
   * ⚠⚠ THE REACHABILITY SENTENCE THAT USED TO STAND HERE WAS UNSUPPORTED, and
   * the corrected version is at `numeric-parser.ts`'s `isFromToChangeFrame`.
   * It read: *"Both consumers are the option-intervention path
   * (`intervention-extractor.ts` `continue`s on falsy at `:407`, pushes
   * `value: null` at `:329`), so the intervention was dropped or nulled."*
   * The call sites are named right; what they PASS was never measured. Driving
   * the five real `INTERVENTION_PATTERNS` and the `:407` fallback scan shows
   * only ever SINGLE TOKENS — "£600", "£400", "reduce churn from 10%" — so no
   * from-to span reaches `parseNumericValue` from a user at all, and the
   * assertions in this block are DURABLE CORRECTNESS, not a live defect.
   *
   * ⚠⚠⚠ THAT IS A FACT ABOUT ONE FUNCTION AND NOT ABOUT THE CLASS. The other
   * extractor, `extractFactors`, IS reached from `enricher.ts:393/858/982`, has
   * no from-to frame guard of any kind, and claims a from-to span as a range
   * exactly as this one did. `KNOWN_ADJACENCY_GAP` below pins what it does.
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
    // regex matches "80-120k" — on the **120k** — because the engine simply
    // advances the start position, and 120k is not a lower bound. That is
    // correct behaviour and my first version of this test read it as a
    // failure; in the real patterns a currency symbol or a context word pins
    // the start, so only the lower bound is ever attempted.
    //
    // What the anchor DOES catch, and what nothing else did: the greedy digit
    // group backtracking past the lookahead. Without `AMOUNT_RUN_END` this
    // matched "8" of "80-120k" and the guard declined nothing at all.
    const re = new RegExp(`^(?<amount>${AMOUNT_DIGITS})${RANGE_LOWER_BOUND_ABSENT_GUARD}`);
    expect(re.exec("80-120k"), "the lower bound of a magnitude-scoped range").toBeNull();
    expect(re.exec("80–120k"), "en dash").toBeNull();
    expect(re.exec("80 - 120k"), "spaced hyphen").toBeNull();
    // ⚠⚠ THE THREE CASES ABOVE CARRIED NO `k` UNTIL REVIEW N1, and their
    // magnitude-free spellings are now ADMITTED. That is the narrowing, pinned
    // where it is visible: the guard declines an amount only where reading it
    // as a point would DROP A MAGNITUDE that the range reading carries. The
    // measurement that forced it — a stated £50,000 replaced by £25k on the
    // reachable enricher path — and the opposite-direction twins are in the
    // block headed "the point-suppression declines only where a MAGNITUDE is
    // at stake".
    expect(re.exec("80-120")?.[0], "no magnitude is at stake").toBe("80");
    // …and the amounts that are NOT half a range still match, in full.
    expect(re.exec("80 - a note")?.[0]).toBe("80");
    expect(re.exec("80")?.[0]).toBe("80");
    expect(re.exec("80,000")?.[0], "the separator run is not truncated").toBe("80,000");
    expect(re.exec("80,000-120,000k"), "a separated range is still half a range").toBeNull();

    // ⚠⚠ AND THE ANCHOR REFUSES RATHER THAN TRUNCATES — BUT THE SENTENCE THAT
    // STOOD HERE NAMED THE **DEFECTIVE** SPELLING AS THE DESIGN REASON (review
    // N2). It read: *"which is why it is spelled `(?![\\d,])` rather than
    // `(?!\\d)`."* `(?![\\d,])` was ROUND 1's P1 BLOCKER, not the design: it
    // forbids stopping before ANY comma, so an ordinary SENTENCE comma refused
    // the amount outright and "The budget is £50,000, but that is not fixed."
    // extracted NOTHING. `AMOUNT_RUN_END` is `(?!\\d)(?!,\\d{3})(?!\\.\\d)` —
    // it forbids stopping before another THOUSANDS GROUP, which is the actual
    // failure, and leaves a sentence comma alone. Two other copies of this
    // sentence were corrected to call `(?![\\d,])` "the first spelling"; this
    // third gave it as current, and the assertion below passes under EITHER
    // spelling, so nothing REDded.
    const bare = new RegExp(`^(?<amount>\\d+)${RANGE_LOWER_BOUND_ABSENT_GUARD}`);
    expect(bare.exec("80,000"), "refuses rather than publishing a truncated 80").toBeNull();

    // ⭐ THE ASSERTION THAT ACTUALLY DISCRIMINATES, so the defective spelling
    // cannot be "restored" under a green suite. A sentence comma must NOT
    // refuse the amount: under `(?![\\d,])` every one of these is `null`;
    // under `AMOUNT_RUN_END` every one matches in full. Proven by mutant M-N2,
    // which restores `(?![\\d,])` in `AMOUNT_RUN_END` and REDs exactly here.
    for (const [text, expected] of [
      ["50,000, but that is not fixed", "50,000"],
      ["180,000, plus contingency", "180,000"],
      ["50, and the rest went on tooling", "50"],
    ] as const) {
      expect(re.exec(text)?.[0], `sentence comma: ${text}`).toBe(expected);
    }
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

/**
 * ⭐⭐⭐ THE RECORDED GAP — an adjacency-bound frame, disclosed rather than
 * re-litigated (ROADMAP 2.1131, CLAUDE.md traps 22f and 12d).
 *
 * `isFromToChangeFrame` asks `/\bfrom\s+$/i` of the text before the match, so
 * `from` must sit IMMEDIATELY before the figure. One ordinary adverb defeats
 * it. The reviewer who found this RAN THE NEXT ROUND BEFORE ASKING FOR ONE:
 * admitting a single intervening word fixes three spellings, still misses
 * "from an estimated £600 to £400", and newly SUPPRESSES a genuine range
 * ("the deal moved away from budget £5,000-£9,000" → the lower bound alone).
 * One probe, two fixes bought with one lie. Four consecutive rounds on this
 * predicate have each closed one direction and opened the other, and that is
 * the signal to stop writing rules and start recording behaviour.
 *
 * ── WHAT THIS SET IS, AND WHAT IT IS NOT ───────────────────────────────────
 * It is a **SAMPLED FLOOR**, never the class. The class is open — adverbs,
 * hedges and appositives compose without limit — and an exact-set claim over
 * an open class reads green precisely as the class grows (this wave's dominant
 * defect). These are spellings that were MEASURED, one per behaviour, so that
 * the behaviour is visible in the suite rather than discovered by a user.
 *
 * ── BOTH DIRECTIONS, BECAUSE THEY CANNOT SHARE A THRESHOLD ─────────────────
 * A GAP (a stated figure vanishes) and a LIE (a figure appears that nobody
 * wrote) are opposite harms, and a single window traded one for the other four
 * times. They are pinned separately, each with its opposite-direction twin:
 *   · the ADJACENT spellings must keep working  (a widening that suppresses
 *     them REDs — the set "grew")
 *   · the listed gap members must keep failing EXACTLY as recorded  (a fix
 *     REDs them — the set "shrank", which is the good direction and should
 *     still be a deliberate, reviewed edit rather than a silent one)
 *   · the positional case must never be suppressed  (trap 19: the frame binds
 *     by POSITION, not by the occurrence of the word)
 *
 * ── SEVERITY, MEASURED, NOT ASSUMED ────────────────────────────────────────
 * On `parseNumericValue` this class is NOT user-reachable: both call sites in
 * `intervention-extractor.ts` hand over single tokens only (manifest and drive
 * recorded at `numeric-parser.ts`). On `extractFactors` — which `enricher.ts`
 * DOES call — there is no frame guard at all, so the factor path behaves the
 * same for the adjacent and the adverbial spelling alike. Each assertion below
 * says which path it is about.
 */
describe("KNOWN_ADJACENCY_GAP — a sampled floor, pinned in both directions", () => {
  /**
   * Direction 1 — THE GAP. A stated figure vanishes: `parseNumericValue`
   * returns `null` where the base at `f4c8f501` returned the from-side figure
   * at `high`. Percent pairs and magnitude-bearing money pairs land here,
   * because their resolvers refuse a descending pair and the refusal stops the
   * chain. Not user-reachable through this function; recorded as durable
   * correctness.
   */
  const GAP_YIELDS_NOTHING: readonly string[] = [
    "reduce churn from about 10% to 5%",
    "reduce churn from around 10% to 5%",
    "reduce churn from roughly 10% to 5%",
    "reduce churn from an estimated 10% to 5%",
    "cut spend from nearly £2m to £500k",
  ];

  it.each(GAP_YIELDS_NOTHING)(
    "GAP (sampled): %s yields nothing from parseNumericValue",
    (text) => {
      expect(
        parseNumericValue(text),
        "this member left the recorded gap set. That is the GOOD direction — " +
          "but it must be a reviewed edit to this floor, not a silent drift.",
      ).toBeNull();
    },
  );

  /**
   * Direction 2 — THE LIE, and it is the worse one. A midpoint nobody wrote,
   * on a pair whose bounds are recorded in the order the writer stated them,
   * so `rangeMin > rangeMax` where the change descends. Money pairs with NO
   * magnitude on either bound land here: the ordering refusal above does not
   * govern them, because that tolerance is INHERITED from the base rather than
   * created by this change (base and head are identical on it — see
   * `resolveAmountRange`).
   */
  const LIE_FABRICATES_A_MIDPOINT: ReadonlyArray<
    readonly [string, number, number, number]
  > = [
    // text, midpoint, rangeMin, rangeMax
    ["cut CAC from about £600 to £400", 500, 600, 400],
    ["cut CAC from around £600 to £400", 500, 600, 400],
    ["lower price from just £49 to £39", 44, 49, 39],
    // Ascending twins: still a midpoint nobody wrote, merely well-ordered —
    // the third behaviour in this class, and the one a two-way split misses.
    ["raise price from about £49 to £59", 54, 49, 59],
  ];

  it.each(LIE_FABRICATES_A_MIDPOINT)(
    "LIE (sampled): %s publishes %d, a midpoint nobody wrote",
    (text, midpoint, min, max) => {
      const parsed = parseNumericValue(text);
      expect(parsed, `${text} left the recorded gap set`).not.toBeNull();
      expect(parsed!.value).toBe(midpoint);
      expect(parsed!.isRange).toBe(true);
      expect(parsed!.rangeMin).toBe(min);
      expect(parsed!.rangeMax).toBe(max);
      // Recorded at "medium", never "high": the point is the service's choice.
      expect(parsed!.confidence).toBe("medium");
    },
  );

  it("⭐ TWIN: the ADJACENT spellings still work — a widening that suppressed them would RED here", () => {
    // The set must not GROW. Every one of these is the round-2 fix, and the
    // obvious next string rule (admit one intervening word) leaves them alone
    // while breaking the positional case below — which is why it was declined.
    for (const [text, expected] of [
      ["reduce churn from 10% to 5%", 10],
      ["cut CAC from £600 to £400", 600],
      ["cut spend from £2m to £500k", 2_000_000],
      ["raise price from £49 to £59", 49],
    ] as const) {
      const parsed = parseNumericValue(text);
      expect(parsed, text).not.toBeNull();
      expect(parsed!.value, text).toBe(expected);
      expect(parsed!.confidence, text).toBe("high");
      expect(parsed!.isRange ?? false, text).toBe(false);
    }
  });

  it("⭐ TWIN: a genuine range near a stray `from` is NOT suppressed", () => {
    // The precise case the declined widening would have broken: the frame must
    // bind by POSITION. Without this, "one intervening word" turns a stated
    // £5,000–£9,000 range into a bare £5,000.
    const parsed = parseNumericValue(
      "we moved away from that, and the budget is £5,000-£9,000",
    );
    expect(parsed!.isRange).toBe(true);
    expect(parsed!.rangeMin).toBe(5_000);
    expect(parsed!.rangeMax).toBe(9_000);
  });

  it("the FACTOR path has no frame guard at all, and the adverb makes no difference to it", () => {
    // The reachable path, recorded so nobody infers from `parseNumericValue`'s
    // manifest that the class is closed. `extractFactors` treats the adjacent
    // and the adverbial spelling identically, because `isFromToChangeFrame`
    // lives in `numeric-parser` and governs nothing here.
    const adjacent = extractFactors("cut CAC from £600 to £400").find(
      (f) => f.extractionType === "range",
    );
    const adverbial = extractFactors("cut CAC from about £600 to £400").find(
      (f) => f.extractionType === "range",
    );
    for (const [name, f] of [["adjacent", adjacent], ["adverbial", adverbial]] as const) {
      expect(f, `${name}: no range factor at all`).toBeDefined();
      expect(f!.value, name).toBe(500);
      expect(f!.rangeMin, name).toBe(600);
      expect(f!.rangeMax, name).toBe(400);
    }
  });
});

/* ===========================================================================
 * ⭐⭐⭐ THE POINT-SUPPRESSION GUARDS **TWO OPPOSITE HARMS**, AND ITS FIRST
 * SPELLING WAS TUNED FOR ONE OF THEM (ROADMAP 2.1131, review N1).
 *
 * `RANGE_LOWER_BOUND_ABSENT_GUARD` shipped PURELY SYNTACTIC: any amount
 * followed by dash-then-digit was declined by every point pattern, whatever
 * the pair turned out to mean. Its own docstring gives the reason it exists,
 * and the reason is narrower than the rule: *"an amount that is the FIRST HALF
 * of a written range belongs to the range patterns, WHICH READ THE MAGNITUDE
 * THAT SCOPES BOTH BOUNDS."* A magnitude is what the point reading loses. Where
 * the pair carries no magnitude at all, the point reading loses nothing — and
 * where the pair is not a range, declining destroys the only honest reading in
 * the sentence.
 *
 * MEASURED through `enrichGraphWithFactorsAsync` — the entry the unified
 * pipeline calls (`cee/unified-pipeline/stages/enrich.ts`, "the ONLY call
 * site") — at base `f4c8f501` and at `6e982fc3`:
 *
 *   "The budget is £50,000 - 3 months of runway."
 *     f4c8f501  raw_value 50000,    extractionType "explicit", conf 0.90, "£50k"
 *     6e982fc3  raw_value 25001.5,  extractionType "range",    conf 0.80, "£25k"
 *               rangeMin 50000 > rangeMax 3
 *
 * A stated £50,000 replaced by a midpoint of a "range" between a budget and a
 * number of months. The descending pair is the INHERITED tolerance this module
 * deliberately keeps — base emits the same 25001.5 range factor — so what the
 * guard changed is not the fabrication but the fact that **nothing honest was
 * left to beat it in `mergeFactors`.**
 *
 * ⚠ THE FIX IS THE GUARD'S OWN JUSTIFICATION, NOT A WIDER STRING RULE. The
 * lookahead now requires a MAGNITUDE on the upper bound — the exact condition
 * under which reading this amount as a point drops information the range
 * reading carries. It is derived from the one alphabet
 * (`MAGNITUDE_SUFFIX_ANON_REQUIRED`), so it cannot drift from what a magnitude
 * is, and it introduces no length constant, no ordering arithmetic and no
 * tuned cliff — the four-round oscillation this estate has already paid for
 * (trap 22f).
 *
 * ⚠ WHAT IT DELIBERATELY DOES **NOT** DO, because a guard that answers two
 * questions is the defect one level up (trap 21): it does not decide whether
 * the pair is a range. `resolveAmountRange` owns that. This guard answers only
 * "would reading this amount as a point lose a magnitude?"
 * ======================================================================== */

describe("the point-suppression declines only where a MAGNITUDE is at stake", () => {
  it("N1: a stated figure before a dash-and-digit that is NOT a magnitude survives", () => {
    const factors = extractFactors("The budget is £50,000 - 3 months of runway.");
    const point = factors.find((f) => f.extractionType === "explicit");
    expect(point, "the stated £50,000 was suppressed by the range guard").toBeDefined();
    expect(point!.value).toBe(50_000);
    expect(point!.unit).toBe("£");
    expect(point!.confidence).toBe(0.9);
  });

  it("N1: …and the same shape at two other scales, so the close is not one string", () => {
    for (const [text, expected] of [
      ["The cost is £250 - 2 people were needed.", 250],
      ["Budget of £600 - 2 vendors quoted.", 600],
    ] as const) {
      const point = extractFactors(text).find((f) => f.extractionType === "explicit");
      expect(point, `${text}: the stated figure was suppressed`).toBeDefined();
      expect(point!.value, text).toBe(expected);
    }
  });

  it("⭐ TWIN: the headline £80-120k suppression is UNTOUCHED — no bare £80 comes back", () => {
    // The opposite-direction twin, and the reason a widening cannot be shipped
    // without it. A guard relaxed one notch too far republishes the 1,000x-short
    // 80 that set the 3 Sep factor's scale and refused Paul's £100,000.
    const factors = extractFactors("We're budgeting £80-120k for the first hire.");
    expect(
      factors.some((f) => f.value === 80),
      "the 1,000x-short bare lower bound came back",
    ).toBe(false);
    const range = factors.find((f) => f.extractionType === "range");
    expect(range!.value).toBe(100_000);
    expect(range!.rangeMin).toBe(80_000);
    expect(range!.rangeMax).toBe(120_000);
  });

  it("⭐ TWIN: an AMBIGUOUS elliptical pair still publishes nothing at all", () => {
    // "£500-2m" has no single reading and `resolveAmountRange` refuses it. The
    // guard must keep declining the £500 too, or the refusal is undone from the
    // other side and a possibly-1,000x-short point ships alone.
    expect(extractFactors("Budget £500-2m for the platform.")).toEqual([]);
  });

  it("the guard's REGEX, asserted directly, on both sides of the new condition", () => {
    // Proven on the constant itself and not only through a pattern that happens
    // to carry the anchor already — the omission that let this guard ship
    // unable to decline anything at all (see `AMOUNT_RUN_END`).
    const re = new RegExp(`^(?<amount>${AMOUNT_DIGITS})${RANGE_LOWER_BOUND_ABSENT_GUARD}`);
    // DECLINES: a magnitude on the upper bound, in every separator spelling.
    expect(re.exec("80-120k"), "the lower bound of a magnitude-scoped range").toBeNull();
    expect(re.exec("80–120k"), "en dash").toBeNull();
    expect(re.exec("80 — 120k"), "em dash").toBeNull();
    expect(re.exec("80 - 120 million"), "spaced, spelled-out magnitude").toBeNull();
    expect(re.exec("500-2m"), "the ambiguous descending elliptical pair").toBeNull();
    expect(re.exec("80,000-120,000k"), "separators on both bounds").toBeNull();
    // ADMITS: no magnitude on the upper bound, so nothing is lost by reading
    // this amount as a point.
    expect(re.exec("50,000 - 3 months of runway")?.[0], "N1").toBe("50,000");
    expect(re.exec("250 - 2 people")?.[0]).toBe("250");
    expect(re.exec("80-120")?.[0], "a bare pair scopes no magnitude").toBe("80");
    // …and the amounts that are not half of anything are still untouched.
    expect(re.exec("80 - a note")?.[0]).toBe("80");
    expect(re.exec("80")?.[0]).toBe("80");
    expect(re.exec("80,000")?.[0], "the separator run is not truncated").toBe("80,000");
  });
});

/* ===========================================================================
 * ⭐⭐⭐ KNOWN_DASH_JOINED_DESCENDING — WHAT N1's CLOSE DOES **NOT** REACH,
 * recorded as an exact two-directional floor rather than left invisible
 * (ROADMAP 2.1131, review N1 + meta-finding; CLAUDE.md traps 22f and 12d).
 *
 * The guard change above restores the honest POINT on a dash-joined pair whose
 * upper bound carries no magnitude. It does not touch the RANGE that pair also
 * produces, and on `parseNumericValue` there is no point to restore, because
 * that function's range grammar claims the string before any point pattern is
 * reached.
 *
 * ── WHY IT IS NOT CLOSED HERE, stated so nobody reads this as an oversight ──
 * Closing it means refusing a DESCENDING pair where NEITHER bound carries a
 * magnitude. That refusal is not scoped to the dash: it also deletes the
 * `from X to Y` members recorded in `LIE_FABRICATES_A_MIDPOINT` above, which
 * base and head agree on and which this PR deliberately declined to narrow.
 * One refusal, two populations, only one of them this change's — so refusing
 * would be the "while we're here" widening the scope rule forbids, and the
 * reviewer's own bounding says the shape occurs ZERO times in 614 real strings
 * harvested from this repo's fixtures. Recorded, not fixed.
 *
 * ── AND ONE HALF OF IT IS **NOT** INHERITED, which the PR's own prose missed ─
 * `resolveAmountRange`'s comment said the neither-magnitude tolerance is
 * inherited because "base and head are identical on it". Measured on BOTH
 * paths rather than on the resolver alone:
 *
 *   "The budget is £50,000 - 3 months of runway."
 *     FACTOR path   base range 25001.5 [50000..3]   head IDENTICAL   inherited
 *     PARSER path   base 50000, "high", no range
 *                   head 25001.5, "medium", rangeMin 50000 > rangeMax 3   NEW
 *
 * `parseNumericValue` had NO dash range grammar at base, so this shape could
 * not reach the branch — exactly the argument this PR already accepted for the
 * both-magnitude case. The claim of inheritance is true of the `from X to Y`
 * members and FALSE of the dash-joined ones on the parser path.
 * ======================================================================== */

describe("KNOWN_DASH_JOINED_DESCENDING — a recorded floor, pinned in both directions", () => {
  /** text, midpoint, rangeMin, rangeMax — as `parseNumericValue` publishes it. */
  const PARSER_STILL_FABRICATES: ReadonlyArray<readonly [string, number, number, number]> = [
    ["The budget is £50,000 - 3 months of runway.", 25001.5, 50_000, 3],
    ["The cost is £250 - 2 people were needed.", 126, 250, 2],
    ["Budget of £600 - 2 vendors quoted.", 301, 600, 2],
  ];

  it.each(PARSER_STILL_FABRICATES)(
    "OPEN (sampled): parseNumericValue(%s) still publishes %d over an inverted range",
    (text, midpoint, min, max) => {
      const parsed = parseNumericValue(text);
      expect(parsed, `${text} left the recorded floor`).not.toBeNull();
      expect(parsed!.value).toBe(midpoint);
      expect(parsed!.rangeMin).toBe(min);
      expect(parsed!.rangeMax).toBe(max);
      expect(parsed!.rangeMin! > parsed!.rangeMax!, "the inversion itself").toBe(true);
      // "medium", never "high" — the one honest thing about it.
      expect(parsed!.confidence).toBe("medium");
    },
  );

  it("⭐ the FACTOR path is CLOSED on the same strings — the honest point wins again", () => {
    // The other direction, and the reason the floor above is a floor rather
    // than a verdict on the class. On `extractFactors` the fabricated range
    // still exists (inherited) but no longer runs unopposed, and the enricher
    // picks the stated figure. Measured through `enrichGraphWithFactorsAsync`:
    // `raw_value 50000, extractionType "explicit", conf 0.90, display "£50k"`
    // — byte-for-byte the base `f4c8f501` output.
    for (const [text, stated] of [
      ["The budget is £50,000 - 3 months of runway.", 50_000],
      ["The cost is £250 - 2 people were needed.", 250],
      ["Budget of £600 - 2 vendors quoted.", 600],
    ] as const) {
      const point = extractFactors(text).find((f) => f.extractionType === "explicit");
      expect(point, `${text}: the stated figure is gone again`).toBeDefined();
      expect(point!.value, text).toBe(stated);
      expect(point!.confidence, text).toBe(0.9);
    }
  });

  it("⭐ TWIN: an ASCENDING dash-joined pair is untouched on BOTH paths", () => {
    // A refusal or a widening that swallowed these would pass every assertion
    // above while deleting the reason this PR exists.
    const parsed = parseNumericValue("We're budgeting £80-120k for the first hire.");
    expect(parsed!.value).toBe(100_000);
    expect(parsed!.rangeMin).toBe(80_000);
    expect(parsed!.rangeMax).toBe(120_000);
    const range = extractFactors("We're budgeting £80-120k for the first hire.").find(
      (f) => f.extractionType === "range",
    );
    expect(range!.rangeMin).toBe(80_000);
    expect(range!.rangeMax).toBe(120_000);
  });

  it("a YEAR before a percent is read as a figure again, and that is INHERITED", () => {
    // ⚠ DISCLOSED, NOT INTRODUCED. Relaxing the guard re-admits
    // `contextualNumber`'s reading of "revenue 2024-10%" as a revenue of
    // **2024** — which is what base `f4c8f501` did; the first cut of the guard
    // suppressed it as a side effect of a rule aimed at something else.
    // Base parity, a different defect class (`contextualNumber` reading a
    // year), and not this PR's to close. Pinned so it is visible.
    const factors = extractFactors("revenue 2024-10%");
    expect(factors.some((f) => f.value === 2024 && f.extractionType === "explicit")).toBe(true);
    // …and the thing this PR DID close stays closed: no percent band with a
    // floor of 2,024%, on either path.
    expect(factors.filter((f) => f.extractionType === "range")).toEqual([]);
    expect(parseNumericValue("revenue 2024-10%")).toBeNull();
  });
});
