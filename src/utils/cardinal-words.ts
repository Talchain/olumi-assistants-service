/**
 * SPELLED CARDINAL AMOUNTS — the parser the magnitude alphabet's own notes
 * call for (L67, closing the walk defect of 4 Aug 2026).
 *
 * WHY THIS MODULE EXISTS. The goal grammar in `cee/factor-extraction` read
 * amounts through `AMOUNT_DIGITS` — digits, mandatory — so a brief whose goal
 * is "grow MRR from one hundred and eighty thousand pounds to two hundred and
 * fifty thousand pounds by the end of December 2026" matched NOTHING and the
 * user was asked for the target they had already typed (measured live,
 * journey walk runT1b; reproduced at pristine `959a953f` through the real
 * extraction path). The magnitude alphabet reads suffixes trailing digits and
 * its `hundred` exclusion says outright: "Multi-word magnitude compounds
 * ('hundred thousand', 'hundred million') need a parser, not an alphabet
 * entry." This is that parser, a leaf beside the alphabet so any consumer can
 * import it rather than copy it (trap 12: the location is the fix).
 *
 * WHAT IT DELIBERATELY IS NOT: a natural-language number library. No "zero"
 * (a spelled zero target would silently bypass the direction refusal's
 * zero-pair carve-out), no fractions ("two and a half million" must REFUSE,
 * never mint 2 — word-numbers.ts learned that the expensive way), no "a
 * hundred" (an article is not a count), no ordinals, no "point five". Every
 * shape outside the grammar yields NO MATCH, and the failure direction is the
 * honest one everywhere in this estate: an unreadable amount asks the user; a
 * confident fragment does not.
 *
 * 12d, BOTH HALVES, BY CONSTRUCTION:
 *   · the SCALE words are DERIVED from `MAGNITUDE_MULTIPLIERS` (word-shaped
 *     keys, ≥1000), so a word form the alphabet gains is readable here the
 *     instant it lands — agreement, guaranteed;
 *   · derivation is structurally blind to the alphabet being SHORT, so the
 *     hand-written corpus in `__tests__/cardinal-words.test.ts` (and the goal
 *     corpus beside the extraction module) is the completeness half. Neither
 *     supersedes the other; ship both.
 */

import { MAGNITUDE_MULTIPLIERS } from "./magnitude-alphabet.js";

/**
 * THE CANONICAL SMALL-CARDINAL MAP — the only place a cardinal word below one
 * hundred may be written. Values make completeness ASSERTABLE (the spec pins
 * the contiguous run 1…20 and the tens 30…90 by ten), which is the property a
 * derived guard can never supply — this is how `DURATION_NUMBER_WORDS`
 * survived the review that found three hand-copied alternations short the
 * same five words.
 */
export const CARDINAL_WORD_VALUES: Readonly<Record<string, number>> = Object.freeze({
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
});

/**
 * The compounder. Deliberately NOT a scale word: "two hundred and fifty
 * thousand" is (2×100 + 50) × 1,000, so `hundred` multiplies the RUNNING
 * group where a scale word CLOSES it. It is also deliberately absent from the
 * magnitude alphabet (see `DELIBERATE_EXCLUSIONS` in the union guard) — this
 * module is the parser that exclusion's reason points at.
 */
export const CARDINAL_HUNDRED_WORD = "hundred";

/**
 * The scale words, DERIVED from the canonical alphabet: word-shaped keys
 * (three or more letters — `k`/`m`/`b`/`t`/`bn`/`mn` are suffix notation, not
 * English) carrying a multiplier of at least 1,000. The ≥1,000 floor is
 * load-bearing: if the alphabet ever gained a sub-thousand word, admitting it
 * here as a group-CLOSER would silently break hundred-compounding ("two
 * hundred X thousand" would close the group at the X).
 *
 * Today this derives to: grand, thousand, million, billion, trillion.
 */
export const CARDINAL_SCALE_MULTIPLIERS: Readonly<Record<string, number>> = Object.freeze(
  Object.fromEntries(
    Object.entries(MAGNITUDE_MULTIPLIERS).filter(
      ([key, multiplier]) => /^[a-z]{3,}$/.test(key) && multiplier >= 1000,
    ),
  ),
);

/** Longest-first, lexicographic tie-break: a pure function of the key set. */
function alternation(words: readonly string[]): string {
  return [...words].sort((a, b) => b.length - a.length || a.localeCompare(b)).join("|");
}

const SMALL_ALTERNATION = alternation(Object.keys(CARDINAL_WORD_VALUES));
const TOKEN_ALTERNATION = alternation([
  ...Object.keys(CARDINAL_WORD_VALUES),
  CARDINAL_HUNDRED_WORD,
  ...Object.keys(CARDINAL_SCALE_MULTIPLIERS),
]);

/** The words that multiply a group: the compounder and every scale word. */
const MULTIPLIER_ALTERNATION = alternation([CARDINAL_HUNDRED_WORD, ...Object.keys(CARDINAL_SCALE_MULTIPLIERS)]);

/**
 * ONE number in words: a small cardinal, then hundred/scale/small tokens joined by whitespace or hyphens. "and" joins
 * ONLY right after "hundred" or a scale word ("two hundred AND fifty", "one thousand AND five"); after a small cardinal
 * it is a connector between two numbers, never part of one ("two and three"). It never starts right after a
 * multiplier word (the fragment "one" of "a hundred and one") or next to "point" ("seven point five" is no 7 and no 5).
 */
const NUMBER_CORE =
  `(?:${SMALL_ALTERNATION})` +
  `(?:(?:(?<=\\b(?:${MULTIPLIER_ALTERNATION}))\\s+and\\s+|[\\s-]+)(?:${TOKEN_ALTERNATION}))*` +
  `(?![\\s-]+(?:(?:${TOKEN_ALTERNATION})[\\s-]+)*point\\b)`;
const ONE_NUMBER = `(?<!\\b(?:${MULTIPLIER_ALTERNATION})(?:\\s+and)?[\\s-]+)(?<!\\bpoint\\s+)${NUMBER_CORE}`;

/**
 * The fraction words whose arrival after a cardinal phrase means the phrase
 * was NOT the whole number ("two AND A HALF million", "two THIRDS"). One
 * list; `word-numbers.ts` (CQE path) carries the same class in its
 * FRACTION_FOLLOW for the same reason — folding a fraction's lead to a digit
 * commits the whole part and drops the fraction. Unifying that sibling onto
 * this export is CQE-path work, reported rather than smuggled in here.
 */
export const CARDINAL_FRACTION_WORDS: readonly string[] = Object.freeze([
  "half",
  "halves",
  "quarter",
  "quarters",
  "third",
  "thirds",
]);

/**
 * The POISON TAIL (review F1): an optional fraction-shaped continuation —
 * mixed form ("and a half") or direct form ("thirds") — meant to be appended
 * INSIDE a words capture, immediately after `CARDINAL_AMOUNT_SOURCE`. When
 * present it rides into the capture, `parseCardinalAmount` meets a token
 * outside its vocabulary, and the amount refuses whole. Consuming rather than
 * asserting is the load-bearing choice: the refusal is decided by the PARSER
 * on the committed capture, so no backtracking split of the phrase can route
 * around it, and a capture that fails one pattern cannot leak a shorter
 * fragment into the next.
 */
export const CARDINAL_FRACTION_CONTINUATION =
  `(?:\\s+and\\s+a\\s+(?:${alternation([...CARDINAL_FRACTION_WORDS])})\\b` +
  `|[\\s-]+(?:${alternation([...CARDINAL_FRACTION_WORDS])})\\b)?`;

/**
 * The phrase grammar, as a SOURCE string with NO capture groups so one pattern can embed it twice under different named
 * wrappers (the same constraint that shaped `MAGNITUDE_SUFFIX_ANON`).
 *
 * Shape: ONE number (above), or a RANGE written in words, consumed WHOLE so no end, sum or fragment of it can be read as
 * one figure: "between X and Y", "X to Y", "X or Y". `parseCardinalAmount` refuses a range capture (its connector is
 * outside the vocabulary); `cardinalReadings` reads its two ends. The repetition is greedy, so "two hundred and fifty
 * thousand" is consumed whole.
 *
 * ⚠ CORRECTED CLAIM (adversarial review F1, executed at `42fe683a`): a fraction-shaped tail ("from one to a target of
 * two and a half million") once committed the fragment 2. The repair is `CARDINAL_FRACTION_CONTINUATION` below, which
 * the embedding amount grammar appends INSIDE its capture: the tail is consumed WITH the phrase and the parser refuses
 * the whole capture by vocabulary, so backtracking cannot re-split "twenty two and a half" into "twenty" + a passing
 * guard. The digit grammar's twin ("2 and a half million" → 2) is out of this module's reach.
 *
 * Case-insensitivity comes from the embedding pattern's `i` flag, exactly as it does for the magnitude alternation.
 */
export const CARDINAL_AMOUNT_SOURCE =
  `(?:between\\s+${NUMBER_CORE}${CARDINAL_FRACTION_CONTINUATION}\\s+and\\s+${NUMBER_CORE}`
  + `|${ONE_NUMBER}(?:${CARDINAL_FRACTION_CONTINUATION}\\s+(?:to|or)\\s+${NUMBER_CORE})?)`;

/**
 * Fold a matched cardinal phrase to its number, or `null` for anything the
 * grammar above did not guarantee — the parser re-checks every token rather
 * than trusting its caller (a guard whose input it cannot see is trap 13's
 * shape).
 *
 * The fold: small cardinals ACCUMULATE into a running group; `hundred`
 * MULTIPLIES the group by 100; a scale word CLOSES the group into the total
 * (group × scale). "two hundred and fifty thousand" → ((2×100)+50)×1,000 =
 * 250,000. A `hundred` or scale word with NOTHING accumulated ("thousand
 * thousand") returns null — fail closed, never guess.
 *
 * ⛔ A RANGE IS NEVER SUMMED (8b on #3438: "between two and three" read 5). Only
 * an English compound accumulates: a small cardinal opens a group, follows
 * `hundred` or a scale word, or is a unit after a ten ("twenty five"); "and"
 * joins only right after `hundred` or a scale word, into a smaller part;
 * `hundred` compounds a group once; scale words only fall ("one million two
 * hundred thousand"). Anything else is two numbers, not one ("two and three",
 * "twenty and one hundred", "two hundred and three hundred"), and the phrase
 * refuses. A range's two ends are read by `cardinalReadings`.
 */
export function parseCardinalAmount(phrase: string | undefined): number | null {
  if (phrase === undefined) return null;
  const tokens = phrase
    .toLowerCase()
    .split(/[\s-]+/)
    .filter((token) => token.length > 0);
  if (tokens.length === 0) return null;

  let total = 0;
  let group = 0;
  let last: "start" | "ten" | "small" | "hundred" | "scale" = "start";
  let hundredSeen = false;
  let lastScale = Infinity;
  for (const [i, token] of tokens.entries()) {
    // "and" joins only right after "hundred" or a scale word, into a smaller part
    // ("two hundred and fifty"); anywhere else it joins two numbers, never one.
    if (token === "and") {
      if ((last !== "hundred" && last !== "scale") || CARDINAL_WORD_VALUES[tokens[i + 1] ?? ""] === undefined) return null;
      continue;
    }
    const small = CARDINAL_WORD_VALUES[token];
    if (small !== undefined) {
      // A small cardinal opens a group, follows "hundred" or a scale word, or is
      // a unit after a ten; any other small after a small is a second number.
      if (last === "small" || (last === "ten" && small >= 10)) return null;
      group += small;
      last = small >= 20 ? "ten" : "small";
      continue;
    }
    if (token === CARDINAL_HUNDRED_WORD) {
      if (group === 0 || hundredSeen) return null;
      group *= 100;
      hundredSeen = true;
      last = "hundred";
      continue;
    }
    const scale = CARDINAL_SCALE_MULTIPLIERS[token];
    if (scale !== undefined) {
      if (group === 0 || scale >= lastScale) return null;
      total += group * scale;
      group = 0;
      hundredSeen = false;
      lastScale = scale;
      last = "scale";
      continue;
    }
    return null; // a token outside the vocabulary — fail closed
  }
  const value = total + group;
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** One figure a capture says: its value, where the capture starts, and the capture as written. */
export interface CardinalReading {
  readonly magnitude: number;
  readonly index: number;
  readonly matchedText: string;
}

const isMultiplier = (w: string): boolean => w === CARDINAL_HUNDRED_WORD || CARDINAL_SCALE_MULTIPLIERS[w] !== undefined;
const tokensOf = (s: string): string[] => s.toLowerCase().split(/[\s-]+/).filter((w) => w.length > 0);

/**
 * A range's two ends, with the scale the high end closes on given to a low end that names none, where that makes a range
 * ("two to three million": 2,000,000 and 3,000,000; "between one and two hundred": 100 and 200; but "twenty to one hundred":
 * 20 and 100). A low end with its own scale keeps it ("between two hundred and three thousand": 200 and 3,000). Null when an
 * end is unreadable, when the high end is a compound whose scale a bare low end could share in two ways ("twenty and two
 * hundred and fifty thousand"), or when low is not below high.
 */
function endsSharingScale(low: string, high: string, valueOf: (phrase: string) => number | null): readonly [number, number] | null {
  const lowValue = valueOf(low);
  const highValue = valueOf(high);
  if (lowValue === null || highValue === null) return null;
  const highTokens = tokensOf(high);
  let k = highTokens.length;
  while (k > 0 && isMultiplier(highTokens[k - 1]!)) k -= 1;
  if (!tokensOf(low).some(isMultiplier) && k < highTokens.length) {
    if (highTokens.slice(0, k).some((w) => isMultiplier(w) || w === "and")) return null;
    const scale = highTokens.slice(k).reduce((m, w) => m * (w === CARDINAL_HUNDRED_WORD ? 100 : CARDINAL_SCALE_MULTIPLIERS[w]!), 1);
    // A shared scale makes a range ("two to three thousand"); where it would not, the low end is as written ("twenty to
    // one hundred": 20, never 2,000).
    if (lowValue * scale < highValue) return [lowValue * scale, highValue];
  }
  return lowValue < highValue ? [lowValue, highValue] : null;
}

/**
 * ⭐ THE ONE READING OF A NUMBER-WORDS CAPTURE (DL-3: the range class; Codex R1 on #3442). What a `CARDINAL_AMOUNT_SOURCE`
 * capture says, as figures:
 *  · ONE number → its value (`valueOf`; by default `parseCardinalAmount`), or nothing.
 *  · A RANGE ("between X and Y", "X to Y", "X or Y") → its two ends (`endsSharingScale`), each carrying the WHOLE capture as
 *    written, so the unit after the range is read for both; or nothing. "between X and Y" splits at the one "and" that leaves
 *    two readable ends, low below high ("between one hundred and fifty and two hundred": 150 and 200); two such splits, none.
 * Never a sum of the ends, a glue of them, or one end alone.
 */
export function cardinalReadings(
  matched: string,
  index: number,
  valueOf: (phrase: string) => number | null = parseCardinalAmount,
): readonly CardinalReading[] {
  const words = matched.trim().split(/\s+/);
  const between = words[0]?.toLowerCase() === "between";
  const body = between ? words.slice(1) : words;
  const connectors = between ? ["and"] : ["to", "or"];
  const splits = body.flatMap((w, i) => (i > 0 && i < body.length - 1 && connectors.includes(w.toLowerCase()) ? [i] : []));
  if (!between && splits.length === 0) {
    const value = valueOf(matched);
    return value === null ? [] : [{ magnitude: value, index, matchedText: matched }];
  }
  const readings = splits.flatMap((i) => {
    const ends = endsSharingScale(body.slice(0, i).join(" "), body.slice(i + 1).join(" "), valueOf);
    return ends === null ? [] : [ends];
  });
  if (readings.length !== 1) return [];
  const [low, high] = readings[0]!;
  return [{ magnitude: low, index, matchedText: matched }, { magnitude: high, index, matchedText: matched }];
}
