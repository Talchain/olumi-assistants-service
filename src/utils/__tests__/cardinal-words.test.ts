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
  cardinalReadings,
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
    // Still compounds after the range rule: a unit after a ten, a ten after
    // "hundred", hundreds of a teen, a falling scale.
    ["twenty five", 25],
    ["two hundred twenty five", 225],
    ["fifteen hundred", 1_500],
    ["one thousand two hundred", 1_200],
    ["two thousand and fifty", 2_050],
    // Codex R1 on #3442: compounds that must keep reading.
    ["one hundred twenty", 120],
    ["twelve hundred", 1_200],
    ["nineteen hundred and ninety", 1_990],
    ["one thousand and five hundred", 1_500],
    // Decimals in words (DL-3 ruling): the complete value, never its two halves.
    ["seven point five", 7.5],
    ["two point five million", 2_500_000],
    ["one point two five", 1.25],
    ["one point one million", 1_100_000],
    ["twenty three point zero five", 23.05],
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
    ["banana", "not a number at all"],
    // ⛔ A range is never summed (8b on #3438: "between two and three" read 5).
    // Two numbers are never one: the phrase refuses, never their sum.
    ["two and three", "a range — never 5"],
    ["twenty and thirty", "a range — never 50"],
    ["two three", "two numbers side by side — never 5"],
    ["nineteen ninety", "two numbers — never 109"],
    ["twenty fifteen", "a ten then a teen — never 35"],
    ["two and three million", "a range with a scale — never 5,000,000"],
    ["two hundred and three hundred", "a range of hundreds — never 20,300"],
    ["two thousand and three thousand", "a range of thousands — never 5,000"],
    ["three thousand two million", "a scale that rises is a second number"],
    // Codex R1 on #3442: "and" joins only after "hundred" or a scale word, into a smaller part.
    ["twenty and one hundred", "a range — never 2,100 (\"and\" after a ten joins two numbers)"],
    ["twenty twenty-six", "two numbers — never 46"],
    ["one two three", "three numbers — never 6"],
    ["a hundred and one", "an article is not a count — never 1, never 100"],
    ["seven point", "a point with no digits"],
    ["seven point twenty", "decimal digits are read one by one — never 7.20 as twenty"],
    ["point five", "no whole number before the point"],
    ["two million point five thousand", "a whole number with its own scale takes none after its decimal"],
    ["two or three thousand", "a range — never 2, never 3,000"],
    ["two to three million", "a range — never 2, never 3,000,000"],
    ["between two and three", "a range — never 5"],
    ["one hundred and", "\"and\" with nothing to join"],
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

/* ===========================================================================
 * THE RANGE CLASS (DL-3; Codex R1 on #3442): a range written in words gives its two ends, or nothing — never a sum, a
 * glue of the ends, a fragment, or one end alone. Read through the grammar's own capture and `cardinalReadings`.
 * ========================================================================= */

const readAll = (text: string): number[] =>
  [...text.matchAll(new RegExp(`\\b(?:${CARDINAL_AMOUNT_SOURCE})`, "gi"))].flatMap((m) => cardinalReadings(m[0], m.index!).map((r) => r.magnitude));

describe("the range class: two ends or nothing", () => {
  it.each([
    ["between two and three", "We need between two and three more bakers.", [2, 3]],
    ["between twenty and one hundred", "Between twenty and one hundred orders arrive late.", [20, 100]],
    ["between two hundred and three thousand", "Between two hundred and three thousand loaves are sold.", [200, 3_000]],
    ["between one hundred and fifty and two hundred", "Between one hundred and fifty and two hundred loaves.", [150, 200]],
    ["two to three million (a shared scale)", "Revenue is two to three million pounds.", [2_000_000, 3_000_000]],
    ["two or three thousand (a shared scale)", "We sell two or three thousand loaves.", [2_000, 3_000]],
    ["between twenty and thirty thousand (a shared scale)", "Between twenty and thirty thousand visitors came.", [20_000, 30_000]],
    ["between one and two hundred (hundred is shared)", "Between one and two hundred orders arrive.", [100, 200]],
    ["two hundred to three thousand (the low end's own scale)", "From two hundred to three thousand loaves.", [200, 3_000]],
    ["twenty to one hundred (a shared scale that would make no range)", "We need twenty to one hundred more.", [20, 100]],
    ["two to three", "We need two to three more bakers.", [2, 3]],
    ["a hundred and one", "We sold a hundred and one loaves.", []],
    ["seven point five (a decimal, whole)", "We waited seven point five weeks.", [7.5]],
    ["one point five to two million (a decimal low end shares the scale)", "Revenue is one point five to two million pounds.", [1_500_000, 2_000_000]],
    ["between twenty and two hundred and fifty thousand (a shared scale read two ways)", "Between twenty and two hundred and fifty thousand.", []],
    ["between three and two (low not below high)", "Between three and two bakers.", []],
    ["between three and two thousand (a shared scale that would make no range)", "Between three and two thousand bakers.", [3, 2_000]],
    ["CONTROL a compound with and", "We sell two hundred and fifty loaves.", [250]],
    ["CONTROL two numbers in two clauses", "We have two ovens and three mixers.", [2, 3]],
  ])("%s", (_case, text, expected) => { expect(readAll(text)).toEqual(expected); });

  it("a range's two ends carry the whole capture, so the unit after it is read for both", () => {
    const [m] = [..."Revenue is two to three million pounds.".matchAll(new RegExp(`\\b(?:${CARDINAL_AMOUNT_SOURCE})`, "gi"))];
    expect(cardinalReadings(m![0], m!.index!)).toEqual([
      { magnitude: 2_000_000, index: 11, matchedText: "two to three million" },
      { magnitude: 3_000_000, index: 11, matchedText: "two to three million" },
    ]);
  });

  /**
   * GENERATED: every pair of ends × every connector × a scale on the high end, on both ends, or none. The reading is exactly
   * the oracle's two ends or nothing where the oracle says nothing; never any other number.
   */
  it("generated: ends × connectors × scales — the two ends, never a sum, a glue or a prefix", () => {
    const ENDS: ReadonlyArray<readonly [string, number, boolean]> = [
      ["two", 2, false], ["three", 3, false], ["twenty", 20, false], ["twenty five", 25, false], ["thirty", 30, false],
      ["one hundred", 100, true], ["two hundred", 200, true], ["two hundred and fifty", 250, true], ["three thousand", 3_000, true],
    ];
    const CONNECTORS: ReadonlyArray<(x: string, y: string) => string> = [
      (x, y) => `between ${x} and ${y}`, (x, y) => `${x} to ${y}`, (x, y) => `${x} or ${y}`,
    ];
    const SCALES: ReadonlyArray<readonly [string, number]> = [["", 1], [" thousand", 1_000], [" million", 1_000_000]];
    const failures: string[] = [];
    let cases = 0;
    for (const [lw, lv, lm] of ENDS) for (const [hw, hv, hm] of ENDS) for (const join of CONNECTORS) for (const [sw, sv] of SCALES) {
      for (const both of [false, true]) {
        if (sw === "" && both) continue;
        if (sw !== "" && (hm || (both && lm))) continue; // a scale after a scale is no number
        const low = both ? lw + sw : lw;
        const high = hw + sw;
        const highValue = hv * sv;
        // The agreed reading. Every "between" range, and a bare low end before a high end that closes on a scale, is read WHOLE
        // (the scale is shared where that makes a range); any other "X to Y" / "X or Y" is two figures, each as written.
        const MULT = ["hundred", "thousand", "million"];
        const highWords = high.split(" ");
        const lowWords = low.split(" ");
        const closing = highWords.filter((w, i) => i > 0 && MULT.includes(w) && highWords.slice(i).every((x) => MULT.includes(x)));
        const shared = closing.reduce((m, w) => m * (w === "hundred" ? 100 : w === "thousand" ? 1_000 : 1_000_000), 1);
        const lowLiteral = both ? lv * sv : lv;
        const lowBare = !lowWords.some((w) => MULT.includes(w) || w === "and");
        const whole = (lowBare && closing.length > 0) || join === CONNECTORS[0];
        const highHead = highWords.slice(0, highWords.length - closing.length);
        const ascending = (a: number): number[] => (a < highValue ? [a, highValue] : []);
        const oracle = !whole ? [lowLiteral, highValue]
          : lowBare && closing.length > 0
            ? (highHead.some((w) => w === "and" || MULT.includes(w)) ? [] : lowLiteral * shared < highValue ? [lowLiteral * shared, highValue] : ascending(lowLiteral))
            : ascending(lowLiteral);
        const text = `We plan ${join(low, high)} units.`;
        const read = readAll(text);
        cases += 1;
        if (JSON.stringify(read) !== JSON.stringify(oracle)) failures.push(`${text} → ${JSON.stringify(read)} (expected ${JSON.stringify(oracle)})`);
      }
    }
    expect(cases).toBeGreaterThan(500);
    expect(failures).toEqual([]);
  });
});
