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
 * hundred" (an article is not a count), no ordinals. A decimal is read whole
 * ("seven point five" is 7.5, never 7: DL-3 ruling, 19 Oct). Every
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

import { MAGNITUDE_ALTERNATION, MAGNITUDE_MULTIPLIERS } from "./magnitude-alphabet.js";

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
 * The other compounder: "dozen" multiplies the group by 12, as "hundred" does by 100 ("two dozen" is 24, never the fragment 2). It
 * completes the closed numeral vocabulary; it is no phrase list (DL-3, 19 Oct). Singular only: "dozens of customers" is vague and
 * reads nothing. Like "hundred", it is absent from the magnitude alphabet: it is a numeral, never a suffix.
 */
export const CARDINAL_DOZEN_WORD = "dozen";

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
  CARDINAL_DOZEN_WORD,
  ...Object.keys(CARDINAL_SCALE_MULTIPLIERS),
]);

/**
 * A decimal's digits in words, read one by one after "point" ("seven point five" is 7.5; "one point two five" 1.25): the canonical
 * cardinals below ten, and "zero" (Codex R2 on #3442: one word-value authority, never a second copy of the map).
 */
const DECIMAL_DIGITS: Readonly<Record<string, number>> = Object.freeze({
  zero: 0,
  ...Object.fromEntries(Object.entries(CARDINAL_WORD_VALUES).filter(([, value]) => value < 10)),
});
const DECIMAL_DIGIT_ALTERNATION = alternation(Object.keys(DECIMAL_DIGITS));
const FRACTION_ALTERNATION = "halves|half|quarters|quarter|thirds|third";

/** The words that multiply a group: the compounders and every scale word. */
const MULTIPLIER_ALTERNATION = alternation([CARDINAL_HUNDRED_WORD, CARDINAL_DOZEN_WORD, ...Object.keys(CARDINAL_SCALE_MULTIPLIERS)]);

/**
 * ⭐ THE GRAMMAR: ONE number in words, its SHAPE only (DL-3 on C5's measurement, 19 Oct). A small cardinal, then hundred, compounder,
 * scale or small tokens joined by whitespace, hyphens or "and", then an optional decimal ("seven POINT FIVE", "two point five
 * MILLION"). The capture takes every "and", so the parser sees the whole: "two and three" is one capture that reads no number, never
 * 5, and "between two hundred and three thousand" one capture that the range reader splits (`cardinalReadings`). The repetition is
 * greedy, so "two hundred and fifty thousand" is consumed whole.
 *
 * NO GUARD AND NO RANGE SHAPE IN IT. V8 compiles a large pattern to native code on its second use: the goal extractor's second call
 * took 10 ms with staging's 437-character grammar and about 60 ms with the range shapes and guards written in. So whether a capture
 * may be read where it stands is the code check `cardinalEndStandsAlone`, and which range it opens or closes is `cardinalReadings`;
 * every reader of free text applies them. A pattern that embeds this source takes what follows a number into its own capture
 * where that refuses it (`CARDINAL_FRACTION_CONTINUATION`).
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
  `(?:${SMALL_ALTERNATION})` +
  `(?:(?:\\s+and\\s+|[\\s-]+)(?:${TOKEN_ALTERNATION}))*` +
  `(?:\\s+point(?:\\s+(?:${DECIMAL_DIGIT_ALTERNATION}))+(?:[\\s-]+(?:${MULTIPLIER_ALTERNATION}))*)?`;

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
  // A dash with space beside it, or an en or em dash, joins a range's two ends, never the parts of one number ("five million -
  // seven" is never 5,000,007; "twenty-five" is one number).
  if (/\s-|-\s|[–—]/.test(phrase)) return null;
  const tokens = phrase
    .toLowerCase()
    .split(/[\s-]+/)
    .filter((token) => token.length > 0);
  if (tokens.length === 0) return null;
  // A decimal in words is its value, never its two halves ("seven point five" is 7.5, never 7 and 5): the whole number, its
  // digits one by one, then any scale words ("two point five million"); a whole number with its own scale takes none.
  const point = tokens.indexOf("point");
  if (point >= 0) {
    const whole = parseCardinalAmount(tokens.slice(0, point).join(" "));
    const rest = tokens.slice(point + 1);
    let digits = 0;
    while (digits < rest.length && DECIMAL_DIGITS[rest[digits]!] !== undefined) digits += 1;
    const scales = rest.slice(digits);
    if (whole === null || digits === 0 || !scales.every(isMultiplier)) return null;
    if (scales.length > 0 && tokens.slice(0, point).some(isMultiplier)) return null;
    // In whole units of the last digit, so "one point one million" is exactly 1,100,000.
    let units = whole * 10 ** digits + Number(rest.slice(0, digits).map((d) => DECIMAL_DIGITS[d]).join(""));
    let previous = Infinity;
    for (const w of scales) {
      const factor = multiplierOf(w);
      if (factor >= previous) return null;
      units *= factor;
      previous = factor;
    }
    return units / 10 ** digits;
  }

  let total = 0;
  let group = 0;
  let last: "start" | "ten" | "small" | "hundred" | "dozen" | "scale" = "start";
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
      if (last === "small" || last === "dozen" || (last === "ten" && small >= 10)) return null;
      group += small;
      last = small >= 20 ? "ten" : "small";
      continue;
    }
    if (token === CARDINAL_HUNDRED_WORD) {
      if (group === 0 || hundredSeen || last === "dozen") return null;
      group *= 100;
      hundredSeen = true;
      last = "hundred";
      continue;
    }
    // "dozen" multiplies the whole group by 12 and closes it to all but a scale word ("two hundred dozen" is 2,400; "a dozen
    // hundred", "two dozen five" and "two dozen and five" are no number).
    if (token === CARDINAL_DOZEN_WORD) {
      if (group === 0 || last === "dozen") return null;
      group *= 12;
      last = "dozen";
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

/** The factor of a word `isMultiplier` accepts: "hundred" 100, "dozen" 12, a scale word its own ("million" 1,000,000). */
const multiplierOf = (w: string): number => (w === CARDINAL_HUNDRED_WORD ? 100 : w === CARDINAL_DOZEN_WORD ? 12 : CARDINAL_SCALE_MULTIPLIERS[w]!);
const isMultiplier = (w: string): boolean => w === CARDINAL_HUNDRED_WORD || w === CARDINAL_DOZEN_WORD || CARDINAL_SCALE_MULTIPLIERS[w] !== undefined;
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
    const scale = highTokens.slice(k).reduce((m, w) => m * multiplierOf(w), 1);
    // A shared scale makes a range ("two to three thousand"); where it would not, the low end is as written ("twenty to
    // one hundred": 20, never 2,000).
    if (lowValue * scale < highValue) return [lowValue * scale, highValue];
  }
  return lowValue < highValue ? [lowValue, highValue] : null;
}

/** What one capture, or one range as written, says as figures: one number, a range's two ends (`endsSharingScale`), or nothing. */
function readingsOf(matched: string, index: number, valueOf: (phrase: string) => number | null): readonly CardinalReading[] {
  const words = matched.trim().replace(/\s*([–—])\s*/g, " $1 ").split(/\s+/);
  const between = words[0]?.toLowerCase() === "between";
  const body = between ? words.slice(1) : words;
  const connectors = between ? ["and"] : ["to", "or", "-", "–", "—"];
  const splits = body.flatMap((w, i) => (i > 0 && i < body.length - 1 && connectors.includes(w.toLowerCase()) ? [i] : []));
  if (!between && splits.length === 0) {
    const value = valueOf(matched);
    return value === null ? [] : [{ magnitude: value, index, matchedText: matched }];
  }
  // A low end opened by an article before a compounder or scale word reads it as ONE ("a dozen to twenty": 12 and 20).
  const endValue = (phrase: string): number | null => {
    const article = /^an?\s+(\S+)/i.exec(phrase);
    return valueOf(article !== null && isMultiplier(article[1]!.toLowerCase()) ? `one ${phrase.replace(/^an?\s+/i, "")}` : phrase);
  };
  const readings = splits.flatMap((i) => {
    const ends = endsSharingScale(body.slice(0, i).join(" "), body.slice(i + 1).join(" "), endValue);
    return ends === null ? [] : [ends];
  });
  if (readings.length !== 1) return [];
  const [low, high] = readings[0]!;
  return [{ magnitude: low, index, matchedText: matched }, { magnitude: high, index, matchedText: matched }];
}

/* ===========================================================================
 * THE RANGE CLASS, IN CODE (DL-3 on C5's measurement, 19 Oct: the grammar reads number shapes only). Each rule reads a short window
 * before or after one capture, so no pattern grows with the rules.
 * ========================================================================= */

/** How far a rule looks before or after a capture. */
const WINDOW = 160;
const W = (source: string): RegExp => new RegExp(source, "i");
/** What joins a range's two ends in words: "to", "or", or a dash (a hyphen only with space around it: "twenty-five" is one number). */
const RANGE_JOIN = `(?:\\s+(?:to|or)\\s+|\\s+-\\s+|\\s*[–—]\\s*)`;
/** What joins a range end in digits to the next end: "to", "or", or any dash ("2-3"). */
const DIGIT_RANGE_JOIN = `(?:\\s+(?:to|or)\\s+|\\s*[-–—]\\s*)`;
/** An amount in digits begins: an optional currency mark ("£", "US$"), then a digit. */
const DIGIT_AMOUNT_START = `(?:[A-Z]{0,3}[^\\s\\w])?\\d`;
/** An amount in digits ends: its last digit, then its own magnitude and percent sign, if written. */
const DIGIT_AMOUNT_END = `\\d(?:\\s*(?:${MAGNITUDE_ALTERNATION})\\b)?%?`;
/** A digits amount, written whole: its currency mark, digits, magnitude and percent sign. */
const DIGIT_AMOUNT = `${DIGIT_AMOUNT_START}[\\d,.]*(?:\\s*(?:${MAGNITUDE_ALTERNATION})\\b)?%?`;
/** Number words of any shape, an article and a fraction included ("a million", "two and a half million"). */
const NUMBER_WORD = `(?:${TOKEN_ALTERNATION}|${FRACTION_ALTERNATION})`;
/**
 * ⛔ A RANGE END IS COMPLETE, OR THE WHOLE RANGE GIVES NOTHING (DL-3 on Codex R4 #3445: "a dozen or so to 30" credited 30, "twenty to
 * thirty-odd" an exact 30). An end is complete when its unit, the connector or the phrase end follows it. What makes it no exact end
 * instead: a word glued on by a dash ("thirty-odd", "ten-ish"), "or" before a word that starts no number ("or so", "or more"), or
 * "plus" or "ish" after it. A connector into a new clause ("20 to 30 and keep churn low", "by June") is no continuation. A scalar's
 * own completeness in words is the complete-span rule (`wordsAmountComplete`, #3438); this is the one rule for a range's ends.
 */
const ENDPOINT_CONTINUATION = `(?:[-–]|\\s+or\\s+|\\s+(?=(?:plus|ish)\\b))(?!(?:${NUMBER_WORD})\\b|an?\\s)[a-z]+`;
/** Another end starts here: a number in words or digits, an article before a number word included. */
const AN_END_STARTS = `(?:an?\\s+)?(?:${NUMBER_WORD}\\b|${DIGIT_AMOUNT_START})`;
/**
 * An amount this grammar reads no figure from, written as one end of a range: an article before a number word ("a hundred", "a
 * million"; read only as a range's low end, `cardinalReadings`), or a word that is no number before a scale word ("several hundred",
 * "a few hundred"). An article before any other word is no amount ("grow a business to £20m": the target reads; DL-3, 19 Oct). No
 * word list: amounts are what this grammar's own words make (Codex R3 on #3445).
 */
const UNREAD_AMOUNT = `(?:\\ban?\\s+(?:${TOKEN_ALTERNATION})\\b(?:[\\s-]+(?:${MULTIPLIER_ALTERNATION}))*`
  + `|\\b(?:an?\\s+)?(?!(?:${TOKEN_ALTERNATION})\\b)[a-z]+(?:[\\s-]+(?:${MULTIPLIER_ALTERNATION}))+)`;
/** "between" opened a range whose "and" comes just before this point ("between a dozen and …"). */
const AFTER_BETWEEN_AND = `\\bbetween\\s+[^.;:!?\\n]{1,40}?\\s+and\\s+`;
/** A range's low end with no scale of its own: small cardinals, a decimal, or a fraction ("two", "twenty five", "one point
 * five", "one and a half"). */
const BARE_END = `(?:${SMALL_ALTERNATION})(?:[\\s-]+(?:${SMALL_ALTERNATION}))*(?:\\s+point(?:\\s+(?:${DECIMAL_DIGIT_ALTERNATION}))+)?`
  + `${CARDINAL_FRACTION_CONTINUATION}`;
/**
 * A range's low end opened by an article before a compounder or scale word ("a dozen to twenty", "between a dozen and twenty"):
 * the article is ONE there (`readingsOf`). Never after a fraction word ("half a dozen" is no dozen).
 */
const ARTICLE_LOW_END = `(?<!\\b(?:${FRACTION_ALTERNATION})\\s+)\\ban?\\s+(?:${MULTIPLIER_ALTERNATION})\\b(?:(?:\\s+and\\s+|[\\s-]+)(?:${TOKEN_ALTERNATION})\\b)*`;

// The range a capture opens or closes (`rangeAround`).
const BETWEEN_OPEN = /\bbetween\s+$/i;
const BETWEEN_AN_ARTICLE_AND = W(`\\bbetween\\s+${ARTICLE_LOW_END}\\s+and\\s+$`);
const AN_ARTICLE_END_BEFORE = W(`${ARTICLE_LOW_END}${RANGE_JOIN}$`);
// The leftmost number reaching the connector, as a reader captures it ("a hundred and FIVE to six million" holds "five", which no
// reader reads: so neither end is read).
const A_NUMBER_END_BEFORE = W(`\\b(${CARDINAL_AMOUNT_SOURCE})${CARDINAL_FRACTION_CONTINUATION}${RANGE_JOIN}$`);
const A_NUMBER_END_AFTER = W(`^${RANGE_JOIN}(${CARDINAL_AMOUNT_SOURCE})\\b`);

// What `cardinalEndStandsAlone` refuses.
const INSIDE_A_NUMBER = W(`(?:\\b(?:${TOKEN_ALTERNATION})(?:\\s+and)?|\\bpoint(?:[\\s-]+(?:${TOKEN_ALTERNATION}))*)[\\s-]+$`);
const A_LONGER_AMOUNT = W(`^(?:[\\s-]+(?:${TOKEN_ALTERNATION}|and))*[\\s-]+(?:point|${FRACTION_ALTERNATION})\\b`);
const A_PLURAL_COMPOUNDER = W(`^[\\s-]+(?:${MULTIPLIER_ALTERNATION})s\\b`);
const DIGITS_END_AFTER = W(`^${DIGIT_RANGE_JOIN}${DIGIT_AMOUNT_START}`);
const DIGITS_END_BEFORE = W(`${DIGIT_AMOUNT_END}${DIGIT_RANGE_JOIN}$`);
const UNREAD_END_AFTER = W(`^${RANGE_JOIN}${UNREAD_AMOUNT}`);
const UNREAD_END_BEFORE = W(`${UNREAD_AMOUNT}${RANGE_JOIN}$`);
const INSIDE_A_BETWEEN = W(`${AFTER_BETWEEN_AND}$`);
const A_RANGE_INSIDE = /^between\s|\s(?:to|or|-)\s|[–—]/i;
const A_SCALED_END_BEFORE = W(`\\b(?:${MULTIPLIER_ALTERNATION})(?:(?:\\s+and\\s+|\\s+point\\s+|[\\s-]+)(?:${TOKEN_ALTERNATION}|zero))*${RANGE_JOIN}$`);
const A_BARE_END_AFTER = W(`^${RANGE_JOIN}${BARE_END}\\b(?![\\s-]+(?:${TOKEN_ALTERNATION})\\b)`);
const CONTINUES = W(`^${ENDPOINT_CONTINUATION}`);
const AN_END_BEFORE = W(`(?:\\b${NUMBER_WORD}|${DIGIT_AMOUNT_END})${DIGIT_RANGE_JOIN}$`);
const AN_END_AFTER = W(`^${DIGIT_RANGE_JOIN}${AN_END_STARTS}`);
const AFTER_AN_END_THAT_CONTINUES = W(`(?:\\b${NUMBER_WORD}|\\d)${ENDPOINT_CONTINUATION}${DIGIT_RANGE_JOIN}$`);

/**
 * The text the capture at `[start, end)` is read as: itself, or the range it opens or closes (`cardinalReadings`); null where that
 * range is read at its low end's own capture. A low end with no scale of its own takes a high end that closes on a scale ("two to
 * three million"); "between" takes the capture after it ("between two hundred and three thousand"); an article low end ("a dozen
 * to twenty", "between a dozen and twenty") is no capture, so its high end takes it, where that high end is bare.
 */
function rangeAround(text: string, start: number, end: number): readonly [number, number] | null {
  const before = text.slice(Math.max(0, start - WINDOW), start);
  const at = start - before.length;
  const opened = BETWEEN_OPEN.exec(before) ?? BETWEEN_AN_ARTICLE_AND.exec(before);
  if (opened !== null) return [at + opened.index, end];
  const words = tokensOf(text.slice(start, end));
  const bare = !words.some(isMultiplier);
  const article = bare ? AN_ARTICLE_END_BEFORE.exec(before) : null;
  if (article !== null) return [at + article.index, end];
  const low = bare ? null : A_NUMBER_END_BEFORE.exec(before);
  if (low !== null && isMultiplier(words[words.length - 1]!) && !tokensOf(low[1]!).some(isMultiplier)) return null;
  const high = bare ? A_NUMBER_END_AFTER.exec(text.slice(end, end + WINDOW)) : null;
  return high !== null && isMultiplier(tokensOf(high[1]!).pop()!) ? [start, end + high[0].length] : [start, end];
}

/**
 * ⭐ THE ONE CODE CHECK OF THE RANGE CLASS (DL-3, 19 Oct: the grammar reads number SHAPES only). Whether the number in words, or the
 * range in words, at `[start, end)` of `text` stands alone where no reader may read it: one end of a range no reader reads whole, or
 * no exact figure. True when:
 *  · it starts inside another number, or is the start of a longer amount ("a hundred and ONE", "SEVEN point twenty five", "TWO
 *    thirds"), or a plural compounder follows it ("two dozens");
 *  · its other end is in digits ("2 to three million", "two to 3 million": two forms never share one scale);
 *  · its other end is an amount this grammar reads no figure from (`UNREAD_AMOUNT`: "a hundred to 200", "two to a few hundred");
 *  · it sits in a "between … and" it does not span ("between 20 and thirty"; "between two and three" is read whole);
 *  · a scale belongs to one end only ("five million to seven", "a million to seven": never 7);
 *  · an end is not complete (`ENDPOINT_CONTINUATION`: "twenty to thirty or so", "a dozen or so to thirty").
 * The free-text readers apply it through `cardinalReadings`; the goal extractor to each amount it captures. The digit reader refuses
 * its own end of the same ranges (`rangeEndWithoutItsPair`). Pure.
 */
export function cardinalEndStandsAlone(text: string, start: number, end: number): boolean {
  const matched = text.slice(start, end);
  const before = text.slice(Math.max(0, start - WINDOW), start);
  const after = text.slice(end, end + WINDOW);
  if (INSIDE_A_NUMBER.test(before) || A_LONGER_AMOUNT.test(after) || A_PLURAL_COMPOUNDER.test(after)) return true;
  if (DIGITS_END_AFTER.test(after) || DIGITS_END_BEFORE.test(before) || UNREAD_END_AFTER.test(after) || UNREAD_END_BEFORE.test(before)) return true;
  if (INSIDE_A_BETWEEN.test(before)) return true;
  const range = A_RANGE_INSIDE.test(matched);
  if (!range && (tokensOf(matched).some(isMultiplier) ? A_BARE_END_AFTER.test(after) : A_SCALED_END_BEFORE.test(before))) return true;
  const anEnd = range || AN_END_BEFORE.test(before) || AN_END_AFTER.test(after);
  const continues = CONTINUES.exec(after);
  const pair = A_NUMBER_END_AFTER.exec(after);
  return (continues !== null && (anEnd || AN_END_AFTER.test(after.slice(continues[0].length))))
    || (pair !== null && CONTINUES.test(after.slice(pair[0].length))) || AFTER_AN_END_THAT_CONTINUES.test(before);
}

/**
 * ⭐ THE ONE READING OF A NUMBER IN WORDS IN FREE TEXT (DL-3: the range class; Codex R1 on #3442). What the `CARDINAL_AMOUNT_SOURCE`
 * capture at `[start, end)` of `text` says, as figures:
 *  · ONE number → its value (`valueOf`; by default `parseCardinalAmount`), or nothing.
 *  · A RANGE it opens or closes (`rangeAround`) → its two ends (`endsSharingScale`), each carrying the WHOLE range as written, so the
 *    unit after it is read for both; or nothing ("five million to seven": the low end's own scale is never given to the high end).
 *    "between X and Y" splits at the one "and" that leaves two readable ends, low below high ("between one hundred and fifty and
 *    two hundred": 150 and 200); two such splits, none. A range is read once: at its low end's capture, or at its high end's where
 *    the low end is an article.
 *  · Nothing where the capture or its range stands alone (`cardinalEndStandsAlone`).
 * Never a sum of the ends, a glue of them, or one end alone. Any other "X to Y" is two figures, each as written ("two to three").
 */
export function cardinalReadings(
  text: string,
  start: number,
  end: number,
  valueOf: (phrase: string) => number | null = parseCardinalAmount,
): readonly CardinalReading[] {
  const span = rangeAround(text, start, end);
  if (span === null || cardinalEndStandsAlone(text, span[0], span[1])) return [];
  return readingsOf(text.slice(span[0], span[1]), span[0], valueOf);
}

const WORDS_RANGE_END_AFTER = W(`^(?:${DIGIT_RANGE_JOIN}(?:(?:an?\\s+)?${NUMBER_WORD}\\b|${UNREAD_AMOUNT})|${ENDPOINT_CONTINUATION}${DIGIT_RANGE_JOIN}${AN_END_STARTS})`);
// A scale word straight after digits is that amount's own magnitude ("2 thousand to 3 thousand"), never a words end; a "between"
// whose low end has digits is the digit reader's own range.
const WORDS_RANGE_END_BEFORE = W(`(?:(?:(?<!\\d\\s*)\\b${NUMBER_WORD}|${UNREAD_AMOUNT})${DIGIT_RANGE_JOIN}|\\bbetween\\s+[^\\d.;:!?\\n]{1,40}?\\s+and\\s+`
  + `|(?:\\b${NUMBER_WORD}|\\d)${ENDPOINT_CONTINUATION}${DIGIT_RANGE_JOIN})$`);
const WORDS_RANGE_END_AFTER_BETWEEN = W(`^\\s+and\\s+(?!${DIGIT_AMOUNT_START})\\S`);
/** This end in digits is a range's high end (`ENDPOINT_CONTINUATION` then decides whether it is complete). */
const A_HIGH_END_BEFORE = W(`(?:(?:\\b${NUMBER_WORD}|${DIGIT_AMOUNT_END})${DIGIT_RANGE_JOIN}|\\bbetween\\s+${DIGIT_AMOUNT}\\s+and\\s+)$`);
/** This end's high end, in digits, continues ("20 to 30 or so", "between 20 and 30-odd"). */
const ITS_HIGH_END_CONTINUES = W(`^${DIGIT_RANGE_JOIN}${DIGIT_AMOUNT}${ENDPOINT_CONTINUATION}`);
const ITS_HIGH_END_CONTINUES_AFTER_BETWEEN = W(`^\\s+and\\s+${DIGIT_AMOUNT}${ENDPOINT_CONTINUATION}`);
/** After "between", this end continues before its "and" ("between 2 or so and 3"), or the low end before it did. */
const CONTINUES_TO_AND = W(`^${ENDPOINT_CONTINUATION}\\s+and\\s+${AN_END_STARTS}`);
const AFTER_A_LOW_END_THAT_CONTINUES = W(`\\bbetween\\s+(?:${DIGIT_AMOUNT}|(?:${NUMBER_WORD}[\\s-]+)*${NUMBER_WORD})${ENDPOINT_CONTINUATION}\\s+and\\s+$`);

/**
 * ⛔ A RANGE GIVES BOTH ENDS OR NOTHING, at the digit reader (DL-3 on Codex R2 #3442, R3 and R4 #3445). Whether the amount in digits
 * written at `[start, end)` is one end of a range the digit reader cannot read whole:
 *  · its other end is in words: number words of any shape this grammar reads or not (an article, a fraction: "a million to 3",
 *    "two and a half million to 3"), or an amount it reads no figure from ("several hundred to 2,000", "20 to a few hundred"),
 *    joined by "to", "or" or a dash ("2 to three million", "five million to 7"), or by "and" after "between" ("between 2 and three
 *    thousand", "between a dozen and 20"). The words end is never read alone there (`cardinalEndStandsAlone`);
 *  · either end is not complete (`ENDPOINT_CONTINUATION`: "a dozen or so to 30", "around 2 or so to 5", "20 to 30-odd").
 * Such a range gives nothing, never one end alone. Pure.
 */
export function rangeEndWithoutItsPair(text: string, start: number, end: number): boolean {
  const before = text.slice(Math.max(0, start - WINDOW), start);
  const after = text.slice(end, end + WINDOW);
  const afterBetween = /\bbetween\s+$/i.test(before);
  return WORDS_RANGE_END_AFTER.test(after) || WORDS_RANGE_END_BEFORE.test(before)
    || (afterBetween && (WORDS_RANGE_END_AFTER_BETWEEN.test(after) || ITS_HIGH_END_CONTINUES_AFTER_BETWEEN.test(after) || CONTINUES_TO_AND.test(after)))
    || AFTER_A_LOW_END_THAT_CONTINUES.test(before)
    || (A_HIGH_END_BEFORE.test(before) && CONTINUES.test(after)) || ITS_HIGH_END_CONTINUES.test(after);
}
