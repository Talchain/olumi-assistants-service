/**
 * ROADMAP 2.338 — ONE DIGIT GRAMMAR, EVERY AMOUNT THIS MODULE READS.
 *
 * THE DEFECT, MEASURED AT `02f7a674`. `extractFactors("We saved £800,000 last
 * year.")` returned a single factor: `£800`, value **800**. A 1,000× under-read
 * of a number the user typed in full, published at confidence 0.60, with
 * nothing else in the result to contradict it.
 *
 * WHY THE MAGNITUDE WORK DID NOT CATCH IT, and why this file sits beside those
 * guards rather than inside them. 2.303/2.316/2.322/2.330 unified the magnitude
 * ALPHABET — the list of SUFFIXES (`k`, `m`, `bn`, `grand`, `thousand`…) — and
 * every guard they shipped is derived from that list or spells a phrase from
 * it. A comma is not a suffix. It loses exactly the same 1,000× and it was
 * invisible to all of them, including the union assertion and the hand-written
 * corpus, because neither models a magnitude that arrives as PUNCTUATION.
 * `magnitude-alphabet.corpus.test.ts` pinned it `⚠ KNOWN-WRONG` rather than
 * fixing it; this row is the repair, and that case has moved to the corpus's
 * Part A.
 *
 * ⚠⚠ AND THE SCOPE WAS TEN TIMES THE ONE LINE. The row was raised against
 * `PATTERNS.currency`. Measured across the whole `PATTERNS` object at
 * `02f7a674`, **TEN of the eleven patterns** hand-spelled `\d+(?:\.\d+)?`
 * beside the `AMOUNT_DIGITS` the same file already imported — the canonical
 * grammar was reaching exactly ONE pattern (`contextualNumber`, repaired by
 * 2.303). The failures were not uniform, and two of them are worse than the
 * under-read that was reported:
 *
 *   - UNDER-READ — "£800,000" → 800; "roughly 50,000" → 50; "1,200%" → 2.
 *   - SILENT TOTAL LOSS — "We will increase from 10,000 to 20,000." and
 *     "Headcount between 50,000 and 70,000." matched NOTHING. The separator
 *     breaks the pattern mid-way, so the user's numbers vanish entirely.
 *   - GARBAGE FRAGMENT — "Uplift between 1,000-2,000%." published **0**, from
 *     the span "000%": the regex resumed inside the number and read a piece of
 *     it as a whole percentage.
 *
 * ⚠ THE FIX HAS TWO INDEPENDENT HALVES, AND EITHER ALONE STILL LOSES THE
 * MAGNITUDE. The pattern must MATCH the separator (`AMOUNT_DIGITS`) and the
 * consumer must STRIP it before parsing (`parseAmountDigits`) — because
 * `parseFloat("800,000")` is 800, the identical 1,000× loss arriving through
 * the other door. `magnitude-alphabet.ts` predicts this in the comment on
 * `AMOUNT_DIGITS` itself. Both halves are mutation-checked; the structural ban
 * below covers the consumer half, and the corpus covers both at once.
 *
 * WHAT THIS FILE IS FOR, stated so a later edit does not hollow it out:
 * the STRUCTURAL guards are DERIVED from `PATTERNS`, so they prove no pattern
 * has drifted BACK to a private grammar and they cover patterns that do not
 * exist yet. They can never prove the canonical grammar is RIGHT. Only the
 * hand-written corpus below can do that, and it is written by hand for the
 * reason CLAUDE.md trap 12d gives: a case generated from the grammar cannot
 * notice the grammar is short. Both halves ship, neither supersedes the other.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AMOUNT_DIGITS } from "../../../utils/magnitude-alphabet.js";
import {
  extractFactors,
  PATTERN_NAMES_FOR_DRIFT_GUARD,
  PATTERN_SOURCES_FOR_DRIFT_GUARD,
  type ExtractedFactor,
} from "../index.js";

/**
 * The grammar this row abolished: digits, optional decimals, NO separators.
 * Written out once, here, so the ban below names the exact literal it bans.
 */
const HAND_SPELLED_DIGIT_GRAMMAR = "\\d+(?:\\.\\d+)?";

/**
 * Locate a factor by the SPAN the extractor claims it read (CLAUDE.md trap 19).
 *
 * Identity, never a value predicate: `factors.find(f => f.value === 800_000)`
 * would pass if ANY rule in the result happened to carry that number, so the
 * assertion would silently stop being about the pattern under test — and these
 * briefs deliberately produce several factors each.
 */
function factorAt(factors: readonly ExtractedFactor[], matchedText: string): ExtractedFactor {
  const matches = factors.filter((factor) => factor.matchedText === matchedText);
  expect(
    matches.length,
    `expected exactly one factor whose matchedText is ${JSON.stringify(matchedText)}, got ` +
      `${matches.length}. All factors: ${JSON.stringify(
        factors.map((f) => ({ matchedText: f.matchedText, value: f.value })),
      )}`,
  ).toBe(1);
  return matches[0]!;
}

/* ===========================================================================
 * PART A — THE STRUCTURAL HALF. Derived from `PATTERNS`, so it cannot go stale.
 * ======================================================================== */

describe("ROADMAP 2.338 — ONE digit grammar, derived not copied (drift guard)", () => {
  it("the guard surface names EVERY pattern — derived from PATTERNS itself", () => {
    // The anti-mirror assertion, and the one that makes the two guards below
    // meaningful: they iterate this surface, so a pattern missing from it would
    // be silently exempt from both. Both sides are read from `PATTERNS`.
    expect(Object.keys(PATTERN_SOURCES_FOR_DRIFT_GUARD).sort()).toEqual(
      [...PATTERN_NAMES_FOR_DRIFT_GUARD].sort(),
    );
    expect(Object.keys(PATTERN_SOURCES_FOR_DRIFT_GUARD).length).toBeGreaterThan(0);
  });

  it("POSITIVE CONTROL — the banned literal is not part of the canonical grammar", () => {
    // CLAUDE.md trap 13, applied to a ban rather than to an absence. If
    // `AMOUNT_DIGITS` CONTAINED the hand-spelled literal, the ban below would
    // RED on correct code, someone would delete the ban, and the defect would
    // walk back in. It does not contain it — the separator group sits between
    // the integer part and the decimal part — and that is a fact about the
    // canonical grammar worth asserting rather than assuming.
    expect(AMOUNT_DIGITS).not.toContain(HAND_SPELLED_DIGIT_GRAMMAR);
    // ...and the canonical grammar genuinely reads what the hand-spelled one could not.
    expect(new RegExp(`^${AMOUNT_DIGITS}$`).test("800,000")).toBe(true);
    expect(new RegExp(`^${HAND_SPELLED_DIGIT_GRAMMAR}$`).test("800,000")).toBe(false);
  });

  it("every pattern that reads digits is built from AMOUNT_DIGITS", () => {
    // Completeness over the pattern set, derived. A pattern added tomorrow is
    // covered the instant it lands, with no list for anyone to extend.
    for (const [name, source] of Object.entries(PATTERN_SOURCES_FOR_DRIFT_GUARD)) {
      if (!source.includes("\\d")) continue;
      expect(
        source,
        `PATTERNS.${name} reads digits but not through AMOUNT_DIGITS — a private digit ` +
          `grammar cannot match a thousands separator, and the amount is silently truncated.`,
      ).toContain(AMOUNT_DIGITS);
    }
  });

  it("NO pattern hand-spells a SECOND digit grammar beside the canonical one", () => {
    // ⚠ NOT SUBSUMED by the assertion above, and the difference is the shape
    // this repair could most easily have shipped: a pattern carrying TWO
    // amounts ("from £49,000 to £59,000") can hold `AMOUNT_DIGITS` for one half
    // and the hand-spelled copy for the other. It would satisfy `toContain`
    // and still truncate the second number. Six of the eleven patterns read
    // two amounts, so the half-fixed state is the likely one, not the exotic one.
    for (const [name, source] of Object.entries(PATTERN_SOURCES_FOR_DRIFT_GUARD)) {
      expect(
        source,
        `PATTERNS.${name} still hand-spells ${HAND_SPELLED_DIGIT_GRAMMAR} — a fifth copy of the ` +
          `digit grammar beside AMOUNT_DIGITS.`,
      ).not.toContain(HAND_SPELLED_DIGIT_GRAMMAR);
    }
  });

  it("no consumer parses a captured amount with parseFloat (the OTHER door)", () => {
    // The consumer half, structurally. `parseFloat("800,000")` is 800, so a
    // pattern that correctly MATCHES the separator still publishes the 1,000×
    // under-read if its consumer parses the captured string raw. Read from
    // disk because this is a property of the source text, not of any exported
    // value — there is nothing to import that would expose it.
    const source = readFileSync(new URL("../index.ts", import.meta.url), "utf8");

    // POSITIVE CONTROL FIRST (trap 13): prove the read SEES the call shape it
    // is asserting the absence of. A mistyped path or a moved file would
    // otherwise make this assertion pass by inspecting nothing at all.
    expect(
      source.length,
      "the extraction module read as empty — this guard would then prove nothing",
    ).toBeGreaterThan(1_000);
    expect(
      [...source.matchAll(/parseAmountDigits\(\s*match\.groups/g)].length,
      "no `parseAmountDigits(match.groups…)` call found — the scan cannot see the shape it checks",
    ).toBeGreaterThan(0);

    const offenders = [...source.matchAll(/parseFloat\(\s*match\.groups[^)]*\)/g)].map((m) => m[0]);
    expect(
      offenders,
      `these consumers parse a captured amount with parseFloat, which drops thousands ` +
        `separators (parseFloat("800,000") === 800): ${JSON.stringify(offenders)}`,
    ).toEqual([]);
  });
});

/* ===========================================================================
 * PART B — THE HAND-WRITTEN HALF. One comma-bearing phrasing per extractor.
 *
 * ⚠ NEVER GENERATE THESE FROM `AMOUNT_DIGITS` OR FROM `PATTERNS`. A case built
 * from the grammar agrees with the grammar by construction and cannot notice
 * the grammar is wrong — that is the whole of CLAUDE.md trap 12d, and it is why
 * `£800,000` survived four consecutive unifications of the magnitude machinery.
 * Every brief below is written the way a user writes a number.
 * ======================================================================== */

interface SeparatorCase {
  /** A brief a user might actually type, with the separator they would type. */
  readonly brief: string;
  /** The exact span the extractor must claim it read — identity, not value. */
  readonly span: string;
  /** The value that span must carry. */
  readonly value: number;
  /** What was measured at `02f7a674`, before the repair. */
  readonly pristine: string;
}

const SEPARATOR_CORPUS: Readonly<Record<string, readonly SeparatorCase[]>> = {
  currency: [
    {
      brief: "We saved £800,000 last year.",
      span: "£800,000",
      value: 800_000,
      pristine: "one factor, span `£800`, value 800 — the reported defect",
    },
  ],
  currencyWithMultiplier: [
    {
      brief: "We raised $1,500 million last year.",
      span: "$1,500 million",
      value: 1_500_000_000,
      pristine: "no explicit factor at all; only the `$1` fallback at value 1",
    },
  ],
  percentage: [
    {
      brief: "We measured 1,200% overall.",
      span: "1,200%",
      value: 12,
      pristine: "span `200%`, value 2 — a FRAGMENT of the number read as the whole of it",
    },
  ],
  currencyFromTo: [
    {
      brief: "Move from £49,000 to £59,000.",
      span: "from £49,000 to £59,000",
      value: 59_000,
      pristine: "the from-to never matched; two bare `£49`/`£59` fallbacks at 49 and 59",
    },
  ],
  percentFromTo: [
    {
      brief: "Move from 1,200% to 1,500%.",
      span: "from 1,200% to 1,500%",
      value: 15,
      pristine: "the from-to never matched; fragments `200%`/`500%` at 2 and 5",
    },
  ],
  changePattern: [
    {
      brief: "We will increase from 10,000 to 20,000.",
      span: "increase from 10,000 to 20,000",
      value: 20_000,
      pristine: "NO FACTORS AT ALL — the user's two numbers vanished in silence",
    },
  ],
  contextualNumber: [
    {
      brief: "Our target is 800,000.",
      span: "target is 800,000",
      value: 800_000,
      pristine: "already correct — the ONE pattern 2.303 had repaired. A control, not a fix.",
    },
  ],
  approximateValue: [
    {
      brief: "roughly 50,000 customers",
      span: "roughly 50,000 ",
      value: 50_000,
      pristine: "span `roughly 50 `, value 50",
    },
  ],
  currencyRange: [
    {
      brief: "Pricing between £50,000-70,000.",
      span: "between £50,000-70,000",
      value: 60_000,
      pristine: "the range never matched; one bare `£50` fallback at 50",
    },
  ],
  percentRange: [
    {
      brief: "Uplift between 1,000-2,000%.",
      span: "between 1,000-2,000%",
      value: 15,
      pristine: "span `000%`, value 0 — a garbage fragment published as a rate",
    },
  ],
  genericRange: [
    {
      brief: "Headcount between 50,000 and 70,000.",
      span: "between 50,000 and 70,000",
      value: 60_000,
      pristine: "NO FACTORS AT ALL — silent total loss",
    },
  ],
};

describe("ROADMAP 2.338 — a thousands separator loses nothing, in EVERY extractor", () => {
  it("the corpus names EVERY pattern — derived, so a new extractor cannot arrive uncovered", () => {
    // The same anti-mirror shape 2.316 used for CANONICAL_COVERAGE. Add a
    // pattern without a separator case and this REDs and names it, rather than
    // leaving the new pattern free to hand-spell its own grammar unobserved.
    expect(Object.keys(SEPARATOR_CORPUS).sort()).toEqual([...PATTERN_NAMES_FOR_DRIFT_GUARD].sort());
  });

  for (const [extractor, cases] of Object.entries(SEPARATOR_CORPUS)) {
    for (const testCase of cases) {
      it(`${extractor} — ${JSON.stringify(testCase.brief)} → ${testCase.value.toLocaleString("en-GB")}`, () => {
        const factors = extractFactors(testCase.brief);
        const factor = factorAt(factors, testCase.span);
        expect(
          factor.value,
          `at 02f7a674 this was: ${testCase.pristine}\n  brief: ${testCase.brief}`,
        ).toBe(testCase.value);
      });
    }
  }

  it("NO brief in this corpus publishes a truncated mantissa at ANY confidence", () => {
    // The defect's fingerprint, stated once over the whole corpus and
    // independent of the per-case spans above. Every value the separator repair
    // is about is >= 1000; the truncated readings measured at 02f7a674 were all
    // < 1000 (800, 50, 2, 5, 0). So: no factor from these briefs may carry a
    // value that is a strict prefix-truncation of the number the user typed.
    //
    // Deliberately NOT "no factor below 1000" — the companion fallbacks are
    // pristine documented behaviour and some are legitimately small. This
    // asserts the specific untruth: the digits BEFORE the first comma.
    for (const cases of Object.values(SEPARATOR_CORPUS)) {
      for (const testCase of cases) {
        const truncations = new Set<number>();
        for (const numeral of testCase.brief.match(/\d[\d,]*\d/g) ?? []) {
          if (!numeral.includes(",")) continue;
          const head = Number(numeral.slice(0, numeral.indexOf(",")));
          truncations.add(head);
          truncations.add(head / 100); // the percentage paths divide before publishing
        }
        for (const factor of extractFactors(testCase.brief)) {
          expect(
            truncations.has(factor.value),
            `${JSON.stringify(testCase.brief)} published ${factor.value} from span ` +
              `${JSON.stringify(factor.matchedText)} — that is the number truncated at its first ` +
              `thousands separator, not the number the user typed.`,
          ).toBe(false);
        }
      }
    }
  });

  it("NON-VACUITY — every brief in this corpus actually extracts something", () => {
    // Trap 13. Two of these briefs extracted NOTHING at 02f7a674, so an
    // absence-shaped assertion over them would have passed while testing
    // nothing at all. This is the control that makes the assertion above real.
    for (const [extractor, cases] of Object.entries(SEPARATOR_CORPUS)) {
      for (const testCase of cases) {
        expect(
          extractFactors(testCase.brief).length,
          `${extractor}: ${JSON.stringify(testCase.brief)} extracts NOTHING`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("the corpus is written by hand, and spells separators no grammar handed it", () => {
    // Guards the one property that makes Part B worth having beside Part A.
    // If a later edit generates these briefs from AMOUNT_DIGITS, they inherit
    // the grammar's blind spot and this file collapses into Part A.
    const spelled = Object.values(SEPARATOR_CORPUS)
      .flat()
      .map((testCase) => testCase.brief)
      .join(" ");
    for (const phrase of ["£800,000", "1,200%", "10,000", "50,000", "$1,500 million"]) {
      expect(spelled, `the corpus no longer spells ${JSON.stringify(phrase)}`).toContain(phrase);
    }
  });
});
