/**
 * CARDINAL WORDS — completeness pins and the HAND-WRITTEN corpus (L67).
 *
 * 12d division of labour, stated so nobody deletes "the redundant half":
 *   · `cardinal-words.ts` DERIVES its scale words from the magnitude alphabet
 *     and the goal-grammar spec asserts that derivation — agreement.
 *   · THIS file is the completeness half: value pins that make a short map
 *     assertable (the contiguous 1…20 run, the tens), and a corpus of real
 *     phrases with their exact numbers, which is the only instrument in this
 *     estate that has ever noticed a vocabulary was short (`thousand`,
 *     `grand`, and the five duration words all survived green derived guards
 *     and fell to corpora).
 */

import { describe, expect, it } from "vitest";

import {
  CARDINAL_AMOUNT_SOURCE,
  CARDINAL_HUNDRED_WORD,
  CARDINAL_SCALE_MULTIPLIERS,
  CARDINAL_WORD_VALUES,
  parseCardinalAmount,
} from "../cardinal-words.js";
import { MAGNITUDE_MULTIPLIERS } from "../magnitude-alphabet.js";

/* ===========================================================================
 * COMPLETENESS — assertable properties of the canonical map, not eyeballs.
 * ========================================================================= */

describe("L67 — the small-cardinal map is complete by construction", () => {
  it("carries the contiguous run 1…20", () => {
    const values = new Set(Object.values(CARDINAL_WORD_VALUES));
    for (let n = 1; n <= 20; n += 1) {
      expect(values.has(n), `no word for ${n} — the run 1…20 has a hole`).toBe(true);
    }
  });

  it("carries every ten from 20 to 90", () => {
    const values = new Set(Object.values(CARDINAL_WORD_VALUES));
    for (let n = 20; n <= 90; n += 10) {
      expect(values.has(n), `no word for ${n} — a tens word is missing`).toBe(true);
    }
  });

  it("carries NOTHING else — every value is in 1…20 or a ten, with no duplicates", () => {
    const values = Object.values(CARDINAL_WORD_VALUES);
    expect(new Set(values).size, "two words map to one value").toBe(values.length);
    for (const value of values) {
      expect(
        (value >= 1 && value <= 20) || (value % 10 === 0 && value <= 90),
        `${value} is neither 1…20 nor a ten — the map has grown past its grammar`,
      ).toBe(true);
    }
  });

  it("no cardinal word collides with a scale word or the compounder", () => {
    for (const word of Object.keys(CARDINAL_WORD_VALUES)) {
      expect(word in CARDINAL_SCALE_MULTIPLIERS, word).toBe(false);
      expect(word === CARDINAL_HUNDRED_WORD, word).toBe(false);
    }
  });

  it("the derived scale words are exactly the alphabet's word-shaped ≥1000 keys", () => {
    const expected = Object.entries(MAGNITUDE_MULTIPLIERS)
      .filter(([key, multiplier]) => /^[a-z]{3,}$/.test(key) && multiplier >= 1000)
      .map(([key]) => key)
      .sort();
    expect(Object.keys(CARDINAL_SCALE_MULTIPLIERS).sort()).toEqual(expected);
    // And the floor is not decorative: nothing below 1,000 may close a group,
    // or hundred-compounding breaks ("two hundred X thousand").
    for (const multiplier of Object.values(CARDINAL_SCALE_MULTIPLIERS)) {
      expect(multiplier).toBeGreaterThanOrEqual(1000);
    }
  });
});

/* ===========================================================================
 * THE CORPUS — real phrases, exact numbers, hand-written on purpose.
 * The values are load-bearing: "two hundred and fifty grand" pinned to
 * 250,000 is what REDs if `grand` ever falls out of the scale derivation and
 * the phrase re-parses as 250 — the 1,000× class arriving through vocabulary.
 * ========================================================================= */

describe("L67 — the hand-written cardinal corpus", () => {
  const CORPUS: ReadonlyArray<readonly [string, number]> = [
    // The walk's own two amounts, verbatim.
    ["one hundred and eighty thousand", 180_000],
    ["two hundred and fifty thousand", 250_000],
    // Every scale word, spelled by hand — the completeness half for the
    // derivation (a filter mutation that drops one REDs here).
    ["two hundred and fifty grand", 250_000],
    ["three thousand", 3_000],
    ["three million", 3_000_000],
    ["two billion", 2_000_000_000],
    ["one trillion", 1_000_000_000_000],
    // Compounding shapes.
    ["nine hundred and ninety nine", 999],
    ["twenty-five thousand", 25_000],
    ["twenty five thousand", 25_000],
    ["one hundred", 100],
    ["five hundred and six", 506],
    ["seven hundred thousand", 700_000],
    ["two hundred fifty thousand", 250_000], // the "and" is optional
    ["one million two hundred thousand", 1_200_000],
    ["sixty", 60],
    ["eighteen", 18],
    ["ninety", 90], // longest-first: "nine" must not shadow it
    ["seventeen", 17], // nor "seven" shadow this
  ];
  for (const [phrase, value] of CORPUS) {
    it(`"${phrase}" → ${value}`, () => {
      expect(parseCardinalAmount(phrase)).toBe(value);
      // And the grammar matches the WHOLE phrase — a partial match is how a
      // fragment would leak into a surrounding pattern.
      const m = new RegExp(`^(?:${CARDINAL_AMOUNT_SOURCE})$`, "i").exec(phrase);
      expect(m, `the grammar does not span "${phrase}"`).not.toBeNull();
    });
  }
});

/* ===========================================================================
 * FAIL-CLOSED — what the parser refuses, pinned with the reason.
 * ========================================================================= */

describe("L67 — the parser fails closed", () => {
  const REFUSED: ReadonlyArray<readonly [string, string]> = [
    ["", "empty"],
    ["and", "a connector is not a number"],
    ["hundred", "a compounder with nothing to compound"],
    ["thousand", "a scale with nothing to scale"],
    ["thousand thousand", "a scale word cannot open a group"],
    ["two half million", "'half' is outside the vocabulary — fractions refuse"],
    // Review F1 — the poison-tail class, refused at the PARSER on the whole
    // committed capture (the grammar consumes these tails on purpose; the
    // parser is the refusal authority, so no regex backtrack can re-split).
    ["two and a half", "mixed fraction — 2.5 must never commit as 2"],
    ["two and a half million", "mixed fraction with scale — truth 2,500,000, never 2"],
    ["twenty two and a half thousand", "mixed fraction mid-compound — never 22"],
    ["two thirds", "direct fraction — never 2"],
    ["three quarters", "direct fraction — never 3"],
    ["a hundred", "'a' is an article, not a count"],
    ["two point five million", "'point' decimals are not folded"],
    ["banana", "not a number at all"],
  ];
  for (const [phrase, why] of REFUSED) {
    it(`"${phrase}" → null (${why})`, () => {
      expect(parseCardinalAmount(phrase)).toBeNull();
    });
  }

  it("case-folds: 'Two Hundred And Fifty Thousand' reads the same as lowercase", () => {
    expect(parseCardinalAmount("Two Hundred And Fifty Thousand")).toBe(250_000);
  });
});
