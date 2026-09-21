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

/**
 * The phrase grammar, as a SOURCE string with NO capture groups so one
 * pattern can embed it twice under different named wrappers (the same
 * constraint that shaped `MAGNITUDE_SUFFIX_ANON`).
 *
 * Shape: a phrase STARTS with a small cardinal (one…ninety) — never with
 * "hundred", a scale word, or "and", so "from thousand to…" and a stray
 * article cannot open an amount — and continues with hundred/scale/small
 * tokens joined by whitespace, hyphens, or a bridging "and". The repetition
 * is greedy, so "two hundred and fifty thousand" is consumed whole.
 *
 * ⚠ CORRECTED CLAIM (adversarial review F1, executed at `42fe683a`) — this
 * comment used to say an out-of-vocabulary continuation "simply ends the
 * phrase … no fragment is ever committed as the amount", AND THAT WAS FALSE
 * AS A GENERAL CLAIM. It held for from-side truncation and for shapes the
 * direction refusal happened to catch — the shapes the first cut's own pins
 * sampled — and failed exactly where a goal word anchored and the fragment
 * was ≥ the baseline: "from one to a target of two and a half million by
 * December 2026" committed 2 (truth 2,500,000) at explicit/0.95, because
 * nothing after the target is mandatory, so nothing made the surrounding
 * pattern fail. The repair is `CARDINAL_FRACTION_CONTINUATION` below, which
 * the embedding amount grammar appends INSIDE its capture: a fraction-shaped
 * tail is consumed WITH the phrase and `parseCardinalAmount` then refuses the
 * whole capture by vocabulary. The refusal fires after the regex has
 * committed, so backtracking cannot re-split "twenty two and a half" into
 * "twenty" + a passing guard — the mistake a positional lookahead guard would
 * have made.
 *
 * WHAT IS ACTUALLY GUARANTEED, stated narrowly: a continuation in the
 * FRACTION class (below) refuses the amount; an in-vocabulary "and" is a
 * compound and parses whole; any OTHER continuation ("and celebrate the win")
 * ends the phrase and the committed value is the complete compound the user
 * spelled before it. The DIGIT grammar's twin behaviour ("2 and a half
 * million" → 2) is pre-existing, out of this module's reach, and disclosed in
 * the PR rather than silently matched.
 *
 * Case-insensitivity comes from the embedding pattern's `i` flag, exactly as
 * it does for the magnitude alternation.
 */
export const CARDINAL_AMOUNT_SOURCE =
  `(?:${SMALL_ALTERNATION})` +
  `(?:(?:\\s+and\\s+|[\\s-]+)(?:${TOKEN_ALTERNATION}))*`;

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
 */
export function parseCardinalAmount(phrase: string | undefined): number | null {
  if (phrase === undefined) return null;
  const tokens = phrase
    .toLowerCase()
    .split(/[\s-]+/)
    .filter((token) => token.length > 0 && token !== "and");
  if (tokens.length === 0) return null;

  let total = 0;
  let group = 0;
  for (const token of tokens) {
    const small = CARDINAL_WORD_VALUES[token];
    if (small !== undefined) {
      group += small;
      continue;
    }
    if (token === CARDINAL_HUNDRED_WORD) {
      if (group === 0) return null;
      group *= 100;
      continue;
    }
    const scale = CARDINAL_SCALE_MULTIPLIERS[token];
    if (scale !== undefined) {
      if (group === 0) return null;
      total += group * scale;
      group = 0;
      continue;
    }
    return null; // a token outside the vocabulary — fail closed
  }
  const value = total + group;
  return Number.isFinite(value) && value > 0 ? value : null;
}
