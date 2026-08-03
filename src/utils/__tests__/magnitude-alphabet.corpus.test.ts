/**
 * ROADMAP 2.330 — THE HAND-WRITTEN CORPUS: real phrasings, asserted values.
 *
 * WHY THIS FILE IS NOT DERIVED FROM ANYTHING, and must never become so.
 *
 * CLAUDE.md trap 12d, measured: a guard DERIVED from the magnitude alphabet
 * proves the copies AGREE and is structurally blind to a key the alphabet
 * never had. Deleting a key from `MAGNITUDE_MULTIPLIERS` leaves the per-key
 * drift guard GREEN. The only things in this estate with any power to notice
 * that the list is SHORT are corpora that spell a phrase a human actually
 * types — and `thousand` survived a full unification because no corpus
 * happened to spell it, then `grand` survived the repair for the same reason.
 *
 * So the rule for this file, which is the whole point of it:
 *
 *   ⚠ NEVER generate these cases from `MAGNITUDE_MULTIPLIERS`, from
 *   `MAGNITUDE_ALTERNATION`, or from any sibling list. A case that comes from
 *   the list cannot notice the list is missing something. Every entry below is
 *   a phrase written by hand because a user might type it.
 *
 * ⚠ AND EVERY ASSERTION BINDS BY IDENTITY, NEVER BY VALUE (CLAUDE.md trap 19).
 * `factors.find(f => f.value === 50_000)` would pass if ANY factor in the
 * result happened to carry that number — including one produced by a rule the
 * case is not about. Cases here locate their factor by `matchedText` (the exact
 * span the extractor claims it read) and then assert the value on THAT object.
 *
 * WHAT "HONEST" MEANS IN THE `honest` CASES BELOW. Three outcomes are
 * acceptable for a phrase this service cannot fully read, and they are not the
 * same as each other:
 *   - REFUSAL (no factor) — the doctrine for an ambiguous magnitude;
 *   - a CORRECT value at lower confidence;
 *   - a WRONG value, which is never acceptable and is labelled `⚠ KNOWN-WRONG`
 *     with a ROADMAP row. Pinning those is the point: an untruth nobody has
 *     written down is an untruth nobody is going to fix.
 */

import { describe, it, expect } from "vitest";
import { extractFactors, type ExtractedFactor } from "../../cee/factor-extraction/index.js";

/**
 * Locate a factor by the SPAN the extractor says it read.
 *
 * Identity, not a value predicate: two rules can emit the same number from
 * different spans (`"£5K"` yields both 5000 from `£5K` and 5 from `£5`), so a
 * value-keyed lookup would silently bind to whichever came first and the
 * assertion would stop being about the rule under test.
 */
function factorAt(factors: readonly ExtractedFactor[], matchedText: string): ExtractedFactor {
  const matches = factors.filter((factor) => factor.matchedText === matchedText);
  expect(
    matches.length,
    `expected exactly one factor whose matchedText is ${JSON.stringify(matchedText)}, got ` +
      `${matches.length}. All factors: ${JSON.stringify(
        factors.map((f) => ({ matchedText: f.matchedText, value: f.value, confidence: f.confidence })),
      )}`,
  ).toBe(1);
  return matches[0]!;
}

/* ===========================================================================
 * PART A — THE CASES THE SERVICE MUST READ CORRECTLY.
 * ======================================================================== */

interface CorrectCase {
  readonly brief: string;
  readonly span: string;
  readonly value: number;
  readonly why: string;
}

const MUST_READ_CORRECTLY: readonly CorrectCase[] = [
  // --- `grand`: the ROADMAP 2.330 defect. RED at 9a0541b4 (extracted 50/250).
  {
    brief: "We raised $50 grand last year.",
    span: "$50 grand",
    value: 50_000,
    why: "`grand` is slang for thousand and cqe/rules.ts has read it as x1000 since P8 landed",
  },
  {
    brief: "Budget of £250 grand for the rebuild.",
    span: "Budget of £250 grand ",
    value: 250_000,
    why: "the labelled goal-card path — this read 250 at confidence 0.90, the worst shape of the defect",
  },
  {
    brief: "The fee is £5 GRAND flat.",
    span: "£5 GRAND",
    value: 5_000,
    why: "every consumer matches case-insensitively, so the lookup must admit any casing",
  },

  // --- The magnitudes that already worked. Present so a regression in the
  // --- alphabet's ORDERING or its alternation is caught by phrasing, not only
  // --- by the derived guards that share the alphabet's blind spot.
  {
    brief: "We have £5K in the bank.",
    span: "£5K",
    value: 5_000,
    why: "single-letter suffix, upper case, attached",
  },
  {
    brief: "Target revenue of 800k customers.",
    span: "revenue of 800k ",
    value: 800_000,
    why: "suffix with no currency symbol, lower case",
  },
  {
    brief: "We need $5 thousand for the pilot.",
    span: "$5 thousand",
    value: 5_000,
    why: "the ROADMAP 2.322 defect — the word form, separated by a space",
  },
  {
    brief: "Revenue hit £1.2M last year.",
    span: "£1.2M",
    value: 1_200_000,
    why: "decimal amount with an upper-case suffix",
  },
  {
    brief: "The fund is $5b in size.",
    span: "$5b",
    value: 5_000_000_000,
    why: "bare `b` is billions, and must not be swallowed by the `bn` branch or vice versa",
  },
  {
    brief: "Budget is £2.5bn overall.",
    span: "Budget is £2.5bn ",
    value: 2_500_000_000,
    why: "two-letter `bn` — the longest-first ordering is what stops this reading as 2.5 billion-then-n",
  },
  {
    brief: "Cost of $3t globally.",
    span: "Cost of $3t ",
    value: 3_000_000_000_000,
    why: "the trillion rung, added by 2.322",
  },
  {
    brief: "We booked $5mn in new revenue.",
    span: "$5mn",
    value: 5_000_000,
    why: "`mn` for millions — absent from the canonical list until 2.322, when `$5mn` refused outright",
  },
];

describe("ROADMAP 2.330 — magnitude corpus: phrasings the service must read correctly", () => {
  for (const testCase of MUST_READ_CORRECTLY) {
    it(`${JSON.stringify(testCase.brief)} → ${testCase.value.toLocaleString("en-GB")}`, () => {
      const factors = extractFactors(testCase.brief);
      const factor = factorAt(factors, testCase.span);
      expect(factor.value, `${testCase.why}\n  brief: ${testCase.brief}`).toBe(testCase.value);
    });
  }

  it("no factor from ANY corpus brief is a bare mantissa at explicit confidence", () => {
    // The defect's fingerprint, stated once over the whole corpus: a magnitude
    // dropped on the floor shows up as the digits the user typed, published
    // confidently. A companion factor at `inferred` / 0.60 is pristine,
    // documented behaviour (the currency rule also reports the bare amount);
    // the same number at `explicit` confidence is the untruth.
    for (const testCase of MUST_READ_CORRECTLY) {
      for (const factor of extractFactors(testCase.brief)) {
        if (factor.extractionType !== "explicit") continue;
        expect(
          factor.value,
          `${JSON.stringify(testCase.brief)} published ${factor.value} at EXPLICIT confidence from ` +
            `span ${JSON.stringify(factor.matchedText)} — that is the magnitude-dropped mantissa, ` +
            `not the value the user stated (${testCase.value}).`,
        ).toBe(testCase.value);
      }
    }
  });
});

/* ===========================================================================
 * PART B — THE CASES THE SERVICE CANNOT FULLY READ.
 *
 * Pinned so the current behaviour is a decision on the record rather than an
 * accident, and so a later repair has to come here and change a line.
 * ======================================================================== */

describe("ROADMAP 2.330 — magnitude corpus: what the service honestly cannot read yet", () => {
  it("`half a million users` — REFUSES (no digits to anchor a magnitude to)", () => {
    // Correct behaviour, not a gap to close casually: there is no numeral, and
    // guessing 500,000 from prose is how a service starts inventing figures.
    expect(extractFactors("half a million users")).toEqual([]);
  });

  it("`a couple of million pounds` — REFUSES (\"a couple\" is not a number)", () => {
    expect(extractFactors("a couple of million pounds")).toEqual([]);
  });

  it("`We spent 50 grand on it.` — REFUSES (no currency symbol, no label anchor)", () => {
    // `grand` implies GBP in CQE (`normaliseCurrencyUnit`), but the factor
    // extractor infers units from symbols only, so it declines rather than
    // guessing a currency. Refusal is the doctrine; this pins that it refuses
    // rather than emitting a unit-less 50.
    expect(extractFactors("We spent 50 grand on it.")).toEqual([]);
  });

  it("`We hit 2.5m ARR last month.` — REFUSES (bare suffix, no currency anchor)", () => {
    expect(extractFactors("We hit 2.5m ARR last month.")).toEqual([]);
  });

  it("`$5mARR` — REFUSES: an attached run beginning with a magnitude key is ambiguous", () => {
    // #799's narrowing. "$5mARR" may be five million ARR or five m-somethings,
    // and those readings are 1,000,000x apart.
    expect(extractFactors("$5mARR")).toEqual([]);
  });

  it("`£49pcm` still EXTRACTS as 49 — the refusal is narrow, not 'any letters'", () => {
    // The mirror image, and a live regression in #799's first cut: `pcm` cannot
    // be a mis-read magnitude, so destroying this extraction to defend against
    // one would be a loss with no compensating honesty.
    const factor = factorAt(extractFactors("Fees of £49pcm."), "£49");
    expect(factor.value).toBe(49);
  });

  it("⚠ KNOWN-WRONG — `£800,000` reads as 800 (thousands separator dropped)", () => {
    // NOT a magnitude-alphabet defect and NOT fixed by ROADMAP 2.330. The
    // canonical digit grammar `AMOUNT_DIGITS` handles separators and
    // `parseAmountDigits` strips them, but `PATTERNS.currency` in
    // cee/factor-extraction/index.ts hand-spells `\d+(?:\.\d+)?` instead — a
    // FOURTH hand-written digit grammar beside the canonical one. The match
    // therefore stops at "£800" and a 1,000x under-read is published at
    // confidence 0.60, which is the same untruth as a dropped suffix arriving
    // through the comma (the alphabet module's own comment predicts exactly
    // this). Pinned here, RED-labelled, so the repair has a test to flip.
    const factors = extractFactors("We saved £800,000 last year.");
    const factor = factorAt(factors, "£800");
    expect(factor.value, "if this now reads 800000, delete this case and add it to Part A").toBe(800);
  });

  it("⚠ KNOWN-WRONG — `£5 hundred thousand` reads as 5 (multi-word compound)", () => {
    // `hundred` is a DELIBERATE EXCLUSION from the canonical alphabet — see the
    // reason in magnitude-alphabet.union.test.ts. Admitting it would commit 500
    // here, which is still 1,000x short but no longer visibly incomplete.
    // Multi-word magnitude compounds need a parser, not an alphabet entry.
    const factor = factorAt(extractFactors("Our target is £5 hundred thousand."), "target is £5 ");
    expect(factor.value).toBe(5);
  });
});

/* ===========================================================================
 * PART C — THE CORPUS IS NOT VACUOUS.
 *
 * CLAUDE.md trap 13: a corpus that cannot SEE a presence proves nothing by
 * asserting an absence. These are the positive controls for the corpus itself.
 * ======================================================================== */

describe("ROADMAP 2.330 — the corpus can see the thing it is asserting", () => {
  it("every Part A brief actually produces a factor at the span it names", () => {
    for (const testCase of MUST_READ_CORRECTLY) {
      const factors = extractFactors(testCase.brief);
      expect(
        factors.length,
        `${JSON.stringify(testCase.brief)} produced NO factors at all — this case would then ` +
          `"pass" any absence assertion while testing nothing.`,
      ).toBeGreaterThan(0);
      expect(factors.some((factor) => factor.matchedText === testCase.span)).toBe(true);
    }
  });

  it("the corpus spells magnitudes it did not get from the alphabet", () => {
    // Guards the ONE property that makes this file worth having: it must be
    // written by hand. If a future edit generates these briefs from
    // MAGNITUDE_MULTIPLIERS, the corpus inherits the alphabet's blind spot and
    // this whole file stops being the other half of trap 12d's pair.
    const spelled = MUST_READ_CORRECTLY.map((testCase) => testCase.brief.toLowerCase()).join(" ");
    for (const phrase of ["grand", "thousand", "bn", "mn", "$3t", "800k"]) {
      expect(spelled, `the corpus no longer spells ${JSON.stringify(phrase)}`).toContain(phrase);
    }
    expect(MUST_READ_CORRECTLY.length).toBeGreaterThanOrEqual(11);
  });
});
