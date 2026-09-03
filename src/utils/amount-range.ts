/**
 * ⭐ THE AMOUNT-RANGE GRAMMAR — one spelling, both extractors (ROADMAP 2.1131).
 *
 * ── THE MEASURED DEFECT THIS CLOSES ────────────────────────────────────────
 * Paul's brief on 3 Sep 2026 said **"£80-120k for the first hire"**. The debug
 * bundle `olumi-debug-f2e2df1b-20260903.json` records what the product then
 * did with it: the factor stored `raw_value: 80`, `cap: 100`, and when Paul
 * supplied the true value the product refused — *"Value £100,000 exceeds the
 * factor's cap of £100."* A scale derived from a 1,000×-short extraction was
 * enforced against its own correction.
 *
 * ⚠ THE DISPATCHED PREMISE WAS THAT ONE EXTRACTOR HONOURED THE `k` AND THE
 * OTHER DID NOT — "one magnitude alphabet, two extractors, only one complete".
 * MEASURED at `f4c8f50` (deployed build), on the real brief string, **both drop
 * it**:
 *
 *     extractFactors("...£80-120k...")        →  range 80 .. 120,   value 100
 *     parseNumericValue("£80-120k ...")       →  80, confidence "high"
 *
 * So the alphabet was never short — `src/utils/magnitude-alphabet.ts` carries
 * every key, and its union guard is sound. **The alphabet is complete and NINE
 * OF ELEVEN factor patterns never consult it**, and `parseNumericValue` has no
 * range grammar at all, so it reads a range's LOWER BOUND and publishes it as a
 * confident point. The 117,000 the option-intervention path stored beside the
 * 80 did not come from a better magnitude list; it came from a different
 * producer entirely.
 *
 * That is the same shape as trap 12's second face, one level out: derivation
 * fixed the LIST and nobody asked which patterns READ it. A union assertion
 * over keys cannot see a pattern that consults no keys.
 *
 * ── THE ONE RULE, WRITTEN AGAINST THE SPEC AND NOT AGAINST THE FAILURE ──────
 * A magnitude written once after a coordinate pair scopes the pair. That is
 * shared-suffix ellipsis and it is the dominant reading of "£80-120k",
 * "2 to 5 million", "between 5 and 10 thousand". So:
 *
 *   both bounds carry a magnitude   →  each keeps its own      (£80k-120k)
 *   neither carries one             →  neither is scaled       (£80-120)
 *   only the UPPER carries one      →  it distributes to both, PROVIDED the
 *                                      bare digits already ascend            (£80-120k → 80k..120k)
 *   only the LOWER carries one      →  REFUSE
 *   upper-only, digits DESCEND      →  REFUSE                  (£500-2m)
 *
 * ⚠ WHY THE TWO REFUSALS RATHER THAN A CLEVERER RULE (trap 22f). "£500-2m" has
 * no single reading: distribution gives 500m..2m (absurd), non-distribution
 * gives £500..£2,000,000 (a 4,000× range nobody wrote). "£2m-5" is the same in
 * mirror. Both are genuinely ambiguous, both are 1,000×-class errors in
 * whichever direction we guess, and the doctrine is to refuse rather than
 * publish a confident wrong magnitude. There is no length constant here and no
 * cliff to tune: the predicate is "do the bare digits already ascend", which is
 * a property of the pair, not a threshold someone chose.
 *
 * ⚠ AND THE DIRECTION OF EACH ERROR, because one predicate is guarding TWO
 * OPPOSITE HARMS (trap 22b) and they must not share a parameter:
 *   · failing to distribute is an UNDER-read — the £80 defect, 1,000× short;
 *   · distributing where the writer did not mean it is an OVER-read — a
 *     fabricated magnitude, the worse direction.
 * The ascending-digits precondition is what separates them: it admits exactly
 * the elliptical pairs and refuses the pairs where the two readings diverge.
 * `__tests__/amount-range.test.ts` carries an opposite-direction twin for every
 * corpus case, per trap 22b(b).
 *
 * ── WHY A NEW LEAF AND NOT A CHANGE TO `magnitude-alphabet.ts` ──────────────
 * That module is the ALPHABET — "how many thousands is this suffix?" — and it
 * is imported by eleven modules and pinned by three guard files. This one
 * answers a different question: "how does a suffix written once scope a pair of
 * bounds?" Two questions, named apart (trap 21). This file imports the alphabet
 * and spells no magnitude key of its own, so the union guard's Part D disk scan
 * sees a consumer, not a new sibling vocabulary.
 */

import {
  AMOUNT_DIGITS,
  AMOUNT_RUN_END,
  MAGNITUDE_SUFFIX_ANON,
  magnitudeSuffixPattern,
  parseAmountDigits,
  resolveMagnitude,
} from "./magnitude-alphabet.js";

/**
 * The separators that join the two bounds of a written range, for patterns
 * whose surrounding grammar does NOT commit to a coordinate reading.
 *
 * Hyphen, en dash, em dash, and "to" in its word form only, so "2to5" does not
 * read as a range. Spelled ONCE here because the factor extractor previously
 * carried three private spellings of it and one of them (`[-–—to]+`, a
 * CHARACTER CLASS) matched a bare "o" or "t" as a separator.
 *
 * ⛔⛔ "and" IS NOT HERE, AND ITS ABSENCE IS THE POINT. An earlier cut of this
 * constant admitted it, unanchored — and `percentRange` / `currencyRange` make
 * their `between` prefix OPTIONAL, so two independently stated amounts joined
 * by an ordinary "and" became one range with a MIDPOINT NOBODY WROTE. Measured
 * through `extractFactors` at `d2847f2c`:
 *
 *     "We pay £500 and £700 per month."       → + {v: 600,     500..700}
 *     "Costs are £30k and £45k respectively." → + {v: 37,500,  30k..45k}
 *     "We saw 5% and 10% in the two cohorts." → + {v: 7.5%,      5..10}
 *     "we raised £2.5m and £500k in grants"   → + {v: 1,500,000, min > max}
 *
 * That is the OVER-READ direction — a fabricated magnitude, the worse of the
 * two.
 *
 * ⭐ BUT DELETING "and" OUTRIGHT WAS ALSO WRONG, AND A TEST CAUGHT IT. The
 * first cut of this fix dropped the word entirely, and
 * `parseNumericValue("between £20,000 and £30,000")` — a legitimate,
 * already-pinned, `between`-anchored range — stopped parsing. The harm is not
 * the word "and"; it is "and" WITHOUT the anchor that commits the sentence to a
 * coordinate reading.
 *
 * ⭐⭐ SO THE "and" BRANCH IS BOUND BY POSITION, NOT BY OCCURRENCE. Its
 * lookbehind requires the text immediately before this separator to be
 * `between <optional currency><the digits just matched>` — i.e. THE LOWER
 * BOUND ITSELF IS THE OBJECT OF "between". That is a fixed grammar, not a
 * proximity heuristic and not an open-ended string rule (this estate has burned
 * four consecutive rounds on one of those, trap 22f), and it binds the
 * suppression to its object by identity, where identity is position (trap 19):
 *
 *     "between £20,000 and £30,000"     → range      (anchor adjacent)
 *     "We pay £500 and £700 per month."  → two points (no anchor)
 *     "between two options, we pay £500 and £700"
 *                                         → two points (anchor not adjacent)
 *
 * `genericRange` and `numeric-parser`'s bare range do not need it — they
 * consume `between` as a literal prefix and use `RANGE_SEPARATOR_WORDS_ONLY`.
 */
export const RANGE_SEPARATOR =
  "(?:\\s*[-–—]\\s*|\\s+to\\s+" +
  `|(?<=\\bbetween\\s{1,3}(?:[£$€¥₹]\\s*)?${AMOUNT_DIGITS})\\s+and\\s+)`;

/**
 * The WORD-ONLY separator, for callers whose surrounding grammar already
 * commits to a coordinate reading ("between X and Y").
 *
 * ⚠ IT EXISTS TO KEEP A NARROWER PATTERN NARROW, not as a second opinion about
 * what a separator is. `genericRange` is anchored on the word "between" and
 * required `and`/`to`; widening it to the dash form would make it also match
 * "between 5-10%" and emit a UNITLESS 5..10 beside the percent range's
 * 0.05..0.10 — one written range arriving as two factors with different units.
 * Derived from the same two words the full separator offers, so the two cannot
 * disagree about which words join a range.
 */
export const RANGE_SEPARATOR_WORDS_ONLY = "(?:\\s+(?:to|and)\\s+)";

/**
 * "THIS AMOUNT IS NOT THE LOWER BOUND OF A WRITTEN RANGE" — for the POINT
 * patterns that would otherwise publish it as a figure in its own right.
 *
 * ⚠⚠ THIS IS THE CARRIER THAT ACTUALLY REACHED THE USER ON 3 SEP, and closing
 * the range patterns alone does not close it. MEASURED after the magnitude fix
 * landed, on Paul's own sentence:
 *
 *     extractFactors("We're budgeting £80-120k for the first hire.")
 *       →  { range 80,000 .. 120,000 }        ← now correct
 *          { value: 80, matchedText: "£80" }  ← STILL EMITTED
 *
 * The bare `currency` and `contextualNumber` patterns read `£80` and stop at
 * the hyphen, so a correctly-read range travels beside a 1,000×-short point
 * taken from its own first half. `mergeFactors` picks one, and the debug bundle
 * records which one it picked: `raw_value: 80`, `cap: 100`.
 *
 * ⚠ A DIFFERENT QUESTION FROM `MAGNITUDE_SUFFIX_ABSENT_GUARD` (trap 21). That
 * asks "has a sibling already read this amount's magnitude?"; this asks "is
 * this amount half of something?" Both decline, for different reasons, and a
 * single amount can trip either alone — `£80-120k` trips only this one.
 *
 * Requires a DIGIT after the separator, so ordinary parenthetical dashes
 * ("the £500 — a lot of money — was spent") are untouched.
 *
 * ⚠⚠ AND IT CARRIES `AMOUNT_RUN_END`, WITHOUT WHICH IT DOES NOT DECLINE AT ALL.
 * Its first cut was the bare lookahead, and the greedy digit group simply
 * backtracked past it: `80-120` failed on `80` and matched `8`. That is the
 * IDENTICAL defect `MAGNITUDE_SUFFIX_ABSENT_GUARD` had been fixed for an hour
 * earlier, reproduced by the same hand in the next guard — and it survived
 * because in `PATTERNS.currency` the two guards sit side by side, so the
 * magnitude guard's anchor was silently doing this one's job. It was caught
 * only by asserting THIS guard's regex on its own
 * (`__tests__/amount-range.test.ts`), never by the extractor tests, which all
 * passed. A guard proven only through a caller that supplies its missing
 * precondition has not been proven.
 */
export const RANGE_LOWER_BOUND_ABSENT_GUARD = `${AMOUNT_RUN_END}(?!\\s*[-–—]\\s*\\d)`;

/**
 * The full range grammar: two amounts, each with an OPTIONAL magnitude, joined
 * by a separator. Group names are caller-chosen so a pattern may carry more
 * than one range without colliding (JS rejects duplicate group names outright).
 *
 * The upper bound's currency symbol is consumed but not captured — whether the
 * writer repeated it carries no information the rule above uses, and inventing
 * a second discriminator from a symbol we have no corpus for is how a
 * two-question predicate gets built by accident.
 */
export function amountRangePattern(
  minGroup: string,
  minMagGroup: string,
  maxGroup: string,
  maxMagGroup: string,
  options?: { readonly currencyBeforeMax?: string; readonly separator?: string },
): string {
  const maxPrefix = options?.currencyBeforeMax ?? "";
  const separator = options?.separator ?? RANGE_SEPARATOR;
  return (
    `(?<${minGroup}>${AMOUNT_DIGITS})` +
    magnitudeSuffixPattern(minMagGroup) +
    separator +
    maxPrefix +
    `(?<${maxGroup}>${AMOUNT_DIGITS})` +
    magnitudeSuffixPattern(maxMagGroup)
  );
}

/** The same grammar with no capture groups, for `/g` whole-match scans. */
export const AMOUNT_RANGE_ANON =
  `${AMOUNT_DIGITS}${MAGNITUDE_SUFFIX_ANON}${RANGE_SEPARATOR}${AMOUNT_DIGITS}${MAGNITUDE_SUFFIX_ANON}`;

/** A range this module was able to read without guessing. */
export interface ResolvedAmountRange {
  readonly min: number;
  readonly max: number;
  /** True when a single trailing magnitude was scoped across both bounds. */
  readonly magnitudeDistributed: boolean;
}

/**
 * Resolve a matched range's two bounds, applying the shared-suffix rule above.
 *
 * Returns `null` for every shape the rule refuses — a caller that gets `null`
 * must emit NOTHING for that match, never the bare digits. Emitting the digits
 * is precisely the 1,000×-short publication this module exists to stop, and it
 * is what `factor-extraction` did for every range until now.
 */
export function resolveAmountRange(input: {
  readonly minDigits: string | undefined;
  readonly minMagnitude: string | undefined;
  readonly maxDigits: string | undefined;
  readonly maxMagnitude: string | undefined;
}): ResolvedAmountRange | null {
  const minDigits = parseAmountDigits(input.minDigits);
  const maxDigits = parseAmountDigits(input.maxDigits);
  if (minDigits === null || maxDigits === null) return null;

  const hasMinMag = input.minMagnitude !== undefined && input.minMagnitude !== "";
  const hasMaxMag = input.maxMagnitude !== undefined && input.maxMagnitude !== "";

  // Only the LOWER bound carries a magnitude. Shared-suffix ellipsis reads
  // BACKWARDS from the end of a coordinate structure, never forwards, so there
  // is no reading of "£2m-5" this rule covers. Refuse.
  if (hasMinMag && !hasMaxMag) return null;

  if (hasMaxMag && !hasMinMag) {
    // The elliptical case — the whole point of this module. Distribute only
    // where the pair already reads as an ascending range in its bare digits;
    // a descending pair ("£500-2m") has two incompatible readings and gets
    // neither.
    if (minDigits > maxDigits) return null;
    const multiplier = resolveMagnitude(input.maxMagnitude);
    return {
      min: minDigits * multiplier,
      max: maxDigits * multiplier,
      magnitudeDistributed: multiplier !== 1,
    };
  }

  const min = minDigits * resolveMagnitude(input.minMagnitude);
  const max = maxDigits * resolveMagnitude(input.maxMagnitude);
  // Both bounds stated independently. A descending pair here is the writer's,
  // not an ellipsis artefact, and the extractors already tolerated it — so it
  // is left alone rather than newly refused. Narrowing the accepted set is a
  // separate decision from reading magnitudes correctly.
  return { min, max, magnitudeDistributed: false };
}

/**
 * A PERCENTAGE range's two bounds. Percentages take no magnitude suffix, so the
 * only question left is the one the money range already answers: does this pair
 * read as a range at all?
 *
 * ⚠⚠ IT REFUSES A DESCENDING PAIR, AND THAT CLOSES A LIVE FABRICATION rather
 * than tidying an edge. MEASURED at `f4c8f50`, on text no percent range should
 * ever have claimed:
 *
 *     parseNumericValue("revenue 2024-10%")   →  **-10**   confidence "high"
 *     extractFactors("revenue 2024-10%")      →  range 20.24 .. 0.1
 *
 * A year and a month, read as a percentage band — the first as NEGATIVE ten
 * percent (the hyphen taken for a minus sign), the second as a floor of 2,024%.
 * Both are numbers pointing somewhere the sentence does not.
 *
 * ⚠ THE PRECONDITION IS THE ONE ALREADY WRITTEN AT THE TOP OF THIS FILE, not a
 * new rule invented for this case: a pair whose digits DESCEND is not a range.
 * `resolveAmountRange` uses it to decide whether a trailing magnitude can be
 * distributed; here there is no magnitude to distribute, and the same fact
 * decides whether there is a range at all.
 *
 * ⚠⚠ BUT "ONE RULE, TWO USES" IS NOT WHAT THIS FILE IMPLEMENTS, and the
 * sentence that used to stand here said it was. There are THREE answers to
 * "is a descending pair a range?", and they are deliberately different:
 *
 *   percent (here)                        → NO. Refuse.
 *   amount, magnitude on ONE side only    → NO. Refuse (ellipsis needs the
 *                                           ordering precondition to be safe).
 *   amount, magnitude on BOTH sides       → YES, and it publishes `min > max`
 *                                           — pinned at `amount-range.test.ts`
 *                                           on the stated grounds that the
 *                                           extractors already tolerated it.
 *
 * The third is a tolerance carried forward, not a rule this file endorses. It
 * is recorded here rather than smoothed over, because a comment asserting an
 * invariant the file does not hold is the most convincing wrong sentence in a
 * module — a successor would reconcile the code to the comment and change
 * behaviour nobody asked to change.
 *
 * ⚠ THE COST, AND WHY IT IS THE SAFE DIRECTION: "churn between 10-5%" is now
 * refused. Refusing it loses an extraction and asks the user; admitting it kept
 * publishing 1,017 for a date. A withheld figure is a coaching moment, a
 * confident wrong one is not.
 */
export function resolvePercentRange(input: {
  readonly minDigits: string | undefined;
  readonly maxDigits: string | undefined;
}): { readonly min: number; readonly max: number } | null {
  const min = parseAmountDigits(input.minDigits);
  const max = parseAmountDigits(input.maxDigits);
  if (min === null || max === null) return null;
  if (min > max) return null;
  return { min, max };
}

/**
 * The DIRECTIONAL sibling of `resolveAmountRange`, for a from-to CHANGE
 * ("increase from 400k to 900k") rather than a range.
 *
 * ⚠ TWO QUESTIONS, NAMED APART (trap 21). `resolveAmountRange` asks "what are
 * the two bounds of one quantity?" and can lean on the pair ASCENDING, because
 * a range that descends is not a range. A from-to change asks "where did this
 * quantity move from, and to?" — and a DECREASE descends by definition, so the
 * ordering precondition that makes shared-suffix ellipsis safe for a range says
 * nothing here. Reusing the range resolver would have made
 * "decrease from 900 to 400k" refuse and "increase from 400 to 900k" fabricate
 * a 2,250× jump; both are the range rule applied to a question it does not
 * answer.
 *
 * ⚠⚠ SO THE ELLIPTICAL CASE IS DELIBERATELY NOT RESOLVED HERE — IT IS REFUSED,
 * AND THE GAP IS PINNED. Reading "from 400 to 900k" correctly needs a
 * direction-aware predicate and a corpus of real from-to sentences, and this
 * lane has neither: the defect Paul hit was a RANGE, and writing a second
 * natural-language predicate from my own head is exactly the corpus-from-the-
 * author's-head failure (trap 22). `__tests__/amount-range.test.ts` pins the
 * refused set EXACTLY, so the suite REDs if it grows OR shrinks — an honest
 * recorded gap rather than an invisible one (trap 22f).
 *
 * What this DOES close, measured at `f4c8f50`:
 * `extractFactors("increase from 400k to 900k")` returned **nothing at all** —
 * the pattern could not match a magnitude-bearing bound, so a stated change
 * vanished in silence.
 */
export function resolveAmountPairBothOrNeither(input: {
  readonly minDigits: string | undefined;
  readonly minMagnitude: string | undefined;
  readonly maxDigits: string | undefined;
  readonly maxMagnitude: string | undefined;
}): ResolvedAmountRange | null {
  const from = parseAmountDigits(input.minDigits);
  const to = parseAmountDigits(input.maxDigits);
  if (from === null || to === null) return null;

  const hasFromMag = input.minMagnitude !== undefined && input.minMagnitude !== "";
  const hasToMag = input.maxMagnitude !== undefined && input.maxMagnitude !== "";
  if (hasFromMag !== hasToMag) return null;

  return {
    min: from * resolveMagnitude(input.minMagnitude),
    max: to * resolveMagnitude(input.maxMagnitude),
    magnitudeDistributed: false,
  };
}

/**
 * The point estimate this service takes from a stated range, and the ONE place
 * that choice is made.
 *
 * ⚠ A RANGE IS NOT A POINT, and the product must not pretend otherwise. Until
 * now the factor path silently took the midpoint while the intervention path
 * silently took the LOWER BOUND — two answers to one question, 20% apart on
 * "£80-120k" even after the magnitude is right. Both now call this, so a
 * user told "I've taken £100k" is told the same number the analysis ran on.
 *
 * The midpoint is the choice, not a discovery: it is the only point equidistant
 * from both stated bounds, so it commits to neither end of the user's own
 * uncertainty. Callers that can carry the range MUST carry it as well — the
 * point is what the model runs on, never what the user said.
 */
export function rangePointEstimate(range: { readonly min: number; readonly max: number }): number {
  return (range.min + range.max) / 2;
}
