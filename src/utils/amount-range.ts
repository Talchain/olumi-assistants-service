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
  MAGNITUDE_SUFFIX_ANON_REQUIRED,
  magnitudeSuffixPattern,
  parseAmountDigits,
  requiredMagnitudeSuffixPattern,
  resolveMagnitude,
  SMALLEST_DROPPABLE_MAGNITUDE,
} from "./magnitude-alphabet.js";
import { CURRENCY_SYMBOL_TO_CODE } from "./currency-alphabet.js";

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
 * ⚠⚠⚠ AND IT REQUIRES A **MAGNITUDE** ON THAT UPPER BOUND, WHICH IS THE WHOLE
 * OF THE QUESTION IT ANSWERS. Its first cut asked only "is this amount
 * followed by dash-then-digit?" — a purely SYNTACTIC test, with no opinion on
 * whether the pair is a range or whether reading the amount as a point loses
 * anything. That is one parameter guarding two opposite harms, tuned for one
 * of them (trap 22b), and the other harm was measured through
 * `enrichGraphWithFactorsAsync` — the entry `cee/unified-pipeline/stages/
 * enrich.ts` calls, and the ONLY src call site — at base `f4c8f501` and at
 * `6e982fc3`:
 *
 *     "The budget is £50,000 - 3 months of runway."
 *       f4c8f501   raw_value 50000,   "explicit", conf 0.90, display "£50k"
 *       6e982fc3   raw_value 25001.5, "range",    conf 0.80, display "£25k"
 *                  rangeMin 50000 > rangeMax 3
 *
 * A budget and a number of MONTHS, read as a band, and the writer's own
 * £50,000 replaced by its midpoint. The descending pair is the tolerance
 * `resolveAmountRange` inherits and deliberately keeps — base emits the same
 * 25001.5 factor — so the guard did not create the fabrication. It removed the
 * honest labelled point that had been BEATING it in `mergeFactors`, which is
 * how an inherited tolerance became a user-visible lie.
 *
 * The condition is taken from this guard's own justification two paragraphs
 * up: the range patterns are owed the amount because they READ THE MAGNITUDE
 * THAT SCOPES BOTH BOUNDS. Where there is no magnitude to scope, the point
 * reading loses nothing and the guard has no business declining it.
 *
 *     "£80-120k"      upper carries `k`  →  DECLINE (the 3 Sep defect)
 *     "£500-2m"       upper carries `m`  →  DECLINE (ambiguous; refused both ways)
 *     "£50,000 - 3 months"  no magnitude →  ADMIT   (N1)
 *     "£80-120"             no magnitude →  ADMIT   (the range still wins on value)
 *
 * ⚠ DERIVED, NOT SPELLED: the magnitude test is `MAGNITUDE_SUFFIX_ANON_REQUIRED`
 * from the one alphabet, so it cannot drift from what a magnitude is. There is
 * no length constant here, no ordering arithmetic and no cliff to tune — the
 * four-round oscillation over a hand-tuned natural-language predicate is the
 * bill this estate has already paid (trap 22f).
 *
 * ⚠ AND IT STILL DOES NOT DECIDE WHETHER THE PAIR IS A RANGE (trap 21).
 * `resolveAmountRange` owns that question. This one answers only "would
 * reading this amount as a point drop a magnitude?" Two questions, named
 * apart; aligning their answers is what would put them back together.
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
export const RANGE_LOWER_BOUND_DEFERRAL_SEPARATOR = "\\s*[-–—]\\s*";

/**
 * ⭐⭐ THE DOMAIN THE GUARD DECLINES — SPELLED ONCE, BECAUSE A RANGE PATTERN
 * HAS TO READ EXACTLY IT (ROADMAP 2.1131, PR #1327 behaviour seat, finding B).
 *
 * The guard below declines a point on the PROMISE that a range pattern will
 * read the pair instead. MEASURED at `8ba54157` against base `f4c8f501`,
 * through `extractFactors`: for a pair with **no currency symbol** no range
 * pattern could keep that promise — `currencyRange` REQUIRES `[£$€]`,
 * `genericRange` REQUIRES the literal word `between` — so nine strings in a
 * 32-string corpus lost every factor they had at base, and two of them
 * carried the right MAGNITUDE at base — the pair's lower bound published as a
 * point, so the scale was right and the range was not:
 *
 *     "Budget of 80k-120k for the hire."  f4c8f501 → Budget 80,000 (0.90)
 *                                         8ba54157 → NOTHING
 *     "roughly 800-900k users"            f4c8f501 → 800 (0.70)
 *                                         8ba54157 → NOTHING
 *
 * ⚠ ONE PREDICATE, TWO OPPOSITE HARMS (trap 22b), and this constant is what
 * stops them sharing a parameter by accident. Declining too widely DELETES a
 * stated figure; reading too widely MINTS a band nobody wrote. The two are
 * kept in agreement structurally: `PATTERNS.bareAmountRange` is built from
 * this same tail, so the set of pairs the point patterns defer on and the set
 * a range pattern reads cannot drift apart — which is the only fix that does
 * not need someone to remember (CLAUDE.md trap 12).
 */
export const RANGE_LOWER_BOUND_DEFERRAL_TAIL =
  `${RANGE_LOWER_BOUND_DEFERRAL_SEPARATOR}${AMOUNT_DIGITS}${MAGNITUDE_SUFFIX_ANON_REQUIRED}`;

export const RANGE_LOWER_BOUND_ABSENT_GUARD =
  `${AMOUNT_RUN_END}(?!${RANGE_LOWER_BOUND_DEFERRAL_TAIL})`;

/**
 * "THIS AMOUNT IS NOT ALREADY OWNED BY A CURRENCY-PREFIXED SIBLING, AND IS NOT
 * THE TAIL OF A LONGER DIGIT RUN" — the start anchor for the bare range.
 *
 * ⚠ THE CURRENCY LIMB IS NOT COSMETIC. `currencyRange` reads "£80-120k" and
 * emits one `£` range; without this lookbehind the bare pattern reads the very
 * same digits and emits a SECOND, unitless range beside it — one written range
 * arriving as two factors on two scales, which is the exact harm
 * `RANGE_SEPARATOR_WORDS_ONLY` exists to prevent one pattern over.
 *
 * ⚠ AND THE DIGIT/SEPARATOR LIMB STOPS A PARTIAL-RUN START. With `/g` the
 * engine advances one character at a time, so "£80,000-120k" would otherwise
 * be matched from its "000", yielding a lower bound of **0**. `AMOUNT_RUN_END`
 * closes the same hole at the other end of the run; this closes it at the
 * front.
 *
 * ⚠⚠ THE SIGN LIMB WAS MEASURED, NOT ANTICIPATED, and it is the OVER-read this
 * repair could have shipped. Without `+`/`-`/en dash/em dash in the class,
 * "Growth of -5-10k users." matched from its **5** and published a
 * 5,000..10,000 band for a stated lower bound of MINUS five — a sign silently
 * dropped, which is the fabricated-magnitude direction (trap 22b), and it was
 * invisible to base and head alike because both returned nothing there. A
 * signed lower bound is genuinely ambiguous between "−5 to 10k" and a range
 * whose separator is that same dash, so the doctrine applies unchanged: refuse
 * rather than guess. Pinned in
 * `factor-extraction/__tests__/bare-amount-range-deferral.test.ts`.
 */
/** Regex-escape a literal so it is safe inside a class body or an alternation. */
function escapeForPattern(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * ⭐ THE CURRENCY VOCABULARY AS ONE SET — KEYS ∪ VALUES of the canonical map,
 * DERIVED from `utils/currency-alphabet.ts` (re-exported by
 * `cee/extraction/numeric-parser`).
 *
 * ⚠ DERIVED RATHER THAN SPELLED, and the difference is not stylistic: a
 * hand-written copy here was written first, and
 * `cee/extraction/__tests__/currency-vocabulary.union.test.ts` REDded on it by
 * name — "either DERIVE from CURRENCY_SYMBOL_TO_CODE, or justify the exception".
 * It was right. A currency added to the canonical map now reaches this guard
 * with no second edit, which is the only reason the guard cannot drift short
 * again (CLAUDE.md trap 12).
 *
 * ⚠⚠ THERE USED TO BE A SECOND DERIVATION BESIDE THIS ONE — a
 * `CURRENCY_SYMBOL_CLASS` of the single-character keys, spliced into the guard
 * as a one-character-wide lookbehind. It is gone, and its removal is the
 * repair, not a tidy-up: a character class is FLUSH BY CONSTRUCTION, so the
 * moment the vocabulary was also expressed as a separated alternation the two
 * limbs answered the same question over different domains, and the difference
 * between them was the hole. One vocabulary, one separation, one answer.
 *
 * ⭐⭐ THE VALUES ARE HERE BECAUSE A USER WRITES THE ISO CODE, and until they
 * were, a stated currency amount became a UNITLESS node. This alternation was
 * derived from `Object.keys` alone, so every ISO code — which is a VALUE of
 * that map, not a key — fell through the guard into the bare pattern, which
 * has no unit of its own. MEASURED at `dc0d837d` through `extractFactors`,
 * against base `ad44d445` which minted NOTHING for any of them:
 *
 *     "USD 80-120k"   ad44d445  []
 *                     dc0d837d  Factor=100,000, range 80,000..120,000, unit ABSENT
 *     "EUR 2-5m"      dc0d837d  Factor=3,500,000, unit ABSENT
 *     "usd 80-120k"   dc0d837d  Factor=100,000, unit ABSENT  (the pattern is `gi`)
 *
 * Twelve spellings in all — `USD GBP JPY INR AUD CAD NZD SEK` spaced, `EUR`
 * with an `m` magnitude, `USD80-120k` flush, and the `usd`/`Usd` case variants.
 * `CHF` was already refused because it is the one member that is BOTH a key and
 * a value, which is exactly why a keys-only derivation looked complete.
 *
 * This is the same truth defect this PR fixed for `£`/`$`/`€`, one level out:
 * a currency-bearing amount stored unitless is the input to
 * `unit_redeclares_scale`, so "Set it to USD 150,000" is the correction-loop
 * dead end. The union is DERIVED, and
 * `factor-extraction/__tests__/bare-amount-range-deferral.test.ts` pins every
 * member of it — key and value — so neither half can be dropped in silence.
 *
 * ⚠ THIS DOES NOT WIDEN PARSER ADMISSION. `CURRENCY_PREFIX_ALTERNATION` below
 * is untouched, so `parseNumericValue("USD 80-120k")` still answers `null`,
 * measured identically at `dc0d837d` and after this change. The two paths
 * answer different questions and stay named apart (CLAUDE.md trap 21).
 *
 * ⚠ THE SORT GUARDS NOTHING ON THIS ONE, and saying so is the point. The
 * sentence that stood here — "longest-first so a longer key cannot be shadowed
 * by a shorter one that prefixes it (`NZ$` before `C$`)" — offered a
 * non-example: `C$` is not a prefix of `NZ$`, and no key in this vocabulary is
 * a proper prefix of any other. Worse, this string is spliced into a NEGATIVE
 * LOOKBEHIND in `BARE_AMOUNT_RANGE_START_GUARD`, whose answer is a boolean over
 * the whole disjunction — no alternative's position can change it. MEASURED at
 * `d6f2eef9`: flipping this comparator to shortest-first left the ten specs
 * this PR touches at 328 passed / 0 failed, and no test anywhere reads this
 * one's order. It is kept as a convention shared with the alternation below.
 *
 * ⚠ THE SENTENCE THAT STOOD HERE IS WITHDRAWN. It read: "`A$`/`C$`/`NZ$` are
 * also caught by the class above when they sit flush against the digits — they
 * END in `$` — but they are here too so a prefix separated from its amount by a
 * space is refused as well." True of the guard, and it names the exact reason
 * the class could not be the whole answer: the class caught the FLUSH form of a
 * symbol and nothing caught the SPACED form of one. There is no class above any
 * more, and the separation is applied to every member.
 *
 * ⚠ AND ADDING THE CODES DOES NOT MAKE THE ORDER LOAD-BEARING — CHECKED, not
 * assumed, because it is the one thing that could have changed. A
 * proper-prefix census over the 19-member union returns ZERO, case-sensitively
 * and case-insensitively alike (`A$` is not a prefix of `AUD`; `NZ$` and `NZD`
 * differ at their third character; `CHF` de-duplicates). The same census over
 * `magnitude-alphabet.ts` returns SIX — the contrast control proving it can
 * see an overlap where one exists — and a fabricated three-word vocabulary
 * returns zero. Membership, not ordering, is still what guards currency here.
 */
const CURRENCY_UNION: readonly string[] = [...new Set([
  ...Object.keys(CURRENCY_SYMBOL_TO_CODE),
  ...Object.values(CURRENCY_SYMBOL_TO_CODE),
])];

/** Longest-first, then lexicographic — the ordering convention this file shares. */
function byLongestFirst(a: string, b: string): number {
  return b.length - a.length || (a < b ? -1 : a > b ? 1 : 0);
}

/**
 * ⭐⭐ THE ONE SPELLING OF THE GAP A CURRENCY TOKEN MAY LEAVE BEFORE ITS DIGITS.
 *
 * ⚠ IT IS SHARED ON PURPOSE, AND THE DIRECTION OF ANY DIVERGENCE MATTERS. The
 * bare-range guard DECLINES on this separation and `PATTERNS.currencyRange`
 * ADMITS on it. If the pattern ever admitted MORE than the guard declines, the
 * two would both fire and one written range would arrive as two factors on two
 * scales — one of them unitless. Spelling it once makes the two sets equal by
 * construction rather than by review (CLAUDE.md trap 12).
 *
 * `\s` and not `[^\S\n]`: a line-wrapped brief that puts the symbol at the
 * end of one line and the digits at the start of the next is the commonest way
 * this arrives, and the guard must decline exactly what the pattern reads.
 * Bounded at three so it cannot reach across a paragraph of blank lines.
 */
export const CURRENCY_AMOUNT_SEPARATION = "\\s{0,3}";

/**
 * The currency vocabulary split by whether `\b` can be asserted before it —
 * KEYS ∪ VALUES, every length, sorted longest-first.
 *
 * ⭐⭐ THE PARTITION IS BY THE PROPERTY THAT MATTERS, NOT BY LENGTH, AND THAT
 * IS WHAT CLOSED THE THIRD SPELLING OF THIS DEFECT. The guard below used to
 * hold single-character symbols in a CHARACTER CLASS — one character wide, so
 * flush only — and everything else in a `\b`-anchored alternation carrying the
 * separation. A single-character symbol separated from its digits by a space
 * therefore fell straight through into the bare pattern, which has no unit of
 * its own. MEASURED at `2d46f8e2` through `extractFactors`, against base
 * `ad44d445` which minted NOTHING for any of them:
 *
 *     "£ 80-120k for the hire."            ad44d445  []
 *                                          2d46f8e2  Factor=100,000, unit ABSENT
 *     "Budget of £ 80-120k for the hire."  2d46f8e2  Factor=100,000, unit ABSENT
 *     "$ 400-900k on tooling"              2d46f8e2  Factor=650,000, unit ABSENT
 *
 * Thirty cells in all — `£ $ € ¥ ₹` × {space, non-breaking space, thin space}
 * × two carriers. It is the same truth defect the multi-character symbols and
 * then the ISO codes each showed in turn, in a third spelling, and closing it
 * one spelling at a time is what produced three rounds. The separation now
 * applies to EVERY member of the union; the only thing the partition decides is
 * whether `\b` is assertable, and `\b` is not assertable before `£` — nothing
 * precedes a symbol that could be a word boundary when the character before it
 * is a space, so putting `£` behind `\b` would have left the hole open in a
 * fourth spelling.
 *
 * ⚠ THE SPLIT COINCIDES WITH length===1 IN TODAY'S VOCABULARY and is NOT
 * derived from it: `kr` is two characters and word-initial, `A$` is two
 * characters and word-initial, and a one-character `¥` is symbol-initial. Add a
 * multi-character symbol-initial member (`$U`, say) and it lands on the correct
 * side with no second edit.
 */
const CURRENCY_WORD_INITIAL_ALTERNATION: string = CURRENCY_UNION
  .filter((prefix) => /^\w/.test(prefix))
  .sort(byLongestFirst)
  .map(escapeForPattern)
  .join("|");

const CURRENCY_SYMBOL_INITIAL_ALTERNATION: string = CURRENCY_UNION
  .filter((prefix) => !/^\w/.test(prefix))
  .sort(byLongestFirst)
  .map(escapeForPattern)
  .join("|");

/**
 * ⭐⭐ "THIS `$` IS THE TAIL OF A DIFFERENT CURRENCY" — for the range pattern
 * whose currency class is `[£$€]` and cannot say `A$`.
 *
 * DERIVED: every vocabulary KEY that ends in one of the single-character
 * symbols, minus that symbol — `A$` → `A`, `C$` → `C`, `NZ$` → `NZ`.
 *
 * ⚠⚠ WITHOUT IT THE RANGE PATTERN READS THE `$` INSIDE `A$` AND PUBLISHES
 * AUSTRALIAN DOLLARS AS AMERICAN ONES. This file's own docstring records that
 * defect being closed for `parseNumericValue` at `302556d4`; the SAME defect
 * was still live on the `extractFactors` side, at base and at head alike.
 * MEASURED across a 360-cell enumeration:
 *
 *     "A$80-120k for the hire."   ad44d445  unit `$`, values 100 and 80
 *                                 2d46f8e2  unit `$`, value 100,000
 *
 * Fourteen cells (`A$ a$ C$ c$ NZ$ nz$ Nz$` × two carriers). The repair is a
 * REFUSAL, not a widening: `[£$€]` stays exactly as it is, so no `unit` string
 * this module has never emitted reaches `inferFactorType`, whose currency list
 * is a separate hand-spelled mirror (`factor-extraction/enricher.ts`) and is
 * NOT in this PR's scope. A currency this pattern cannot carry is a currency it
 * must not read — the rule the guard above already applies.
 *
 * `\b` so the assertion fires on a whole token: "Series A$80-120k" is
 * Australian dollars and is refused; "USA$80-120k" is not a vocabulary member
 * at that boundary and still reads as `$`.
 */
const CURRENCY_SYMBOL_INITIAL_SET: ReadonlySet<string> = new Set(
  CURRENCY_UNION.filter((prefix) => prefix.length === 1),
);

export const CURRENCY_SYMBOL_TAIL_OF_LONGER_GUARD: string = (() => {
  const prefixes = Object.keys(CURRENCY_SYMBOL_TO_CODE)
    .filter((key) => key.length > 1 && CURRENCY_SYMBOL_INITIAL_SET.has(key.slice(-1)))
    .map((key) => key.slice(0, -1))
    .sort(byLongestFirst)
    .map(escapeForPattern);
  // A vocabulary with no such key yields the empty string, which disables the
  // guard — expressed here rather than left implicit, because a guard that
  // quietly becomes a no-op is CLAUDE.md trap 13.
  //
  // ⚠ NO TEST NAMES THIS SYMBOL. The sentence that stood here said the
  // emptiness was "asserted in the union test"; it is not, in either union
  // test. MEASURED: `CURRENCY_SYMBOL_TAIL_OF_LONGER_GUARD` has FOUR CODE
  // references repo-wide — this definition, and one import plus two uses in
  // `factor-extraction/index.ts`, both inside `currencyRange`. No test imports
  // it or asserts on it. (A grep returns six: the other two are prose, this
  // sentence and one in `bare-amount-range-deferral.test.ts` bounding the
  // guard's scope. Counting those as coverage is the mistake this note fixes.)
  //
  // What IS pinned is the BEHAVIOUR. Emptying this string while the vocabulary
  // still carries such a key REDs FIVE tests in TWO files: one in
  // `utils/__tests__/amount-range.test.ts` ("⭐ the FACTOR path still DECLINES
  // the prefixes it cannot carry") and four in
  // `factor-extraction/__tests__/bare-amount-range-deferral.test.ts` — three in
  // its cross-product describe, one in "a currency this pattern cannot CARRY is
  // a currency it must not READ".
  // `cee/extraction/__tests__/currency-vocabulary.union.test.ts` stays GREEN
  // under that mutant — so the coverage is real, and it is not where the
  // previous sentence sent a reader to look for it.
  return prefixes.length === 0 ? "" : `(?<!\\b(?:${prefixes.join("|")}))`;
})();

/**
 * ⭐⭐ EVERY CURRENCY PREFIX THE VOCABULARY CARRIES, AS ONE ALTERNATION,
 * SORTED LONGEST-FIRST.
 *
 * ⚠⚠ THE ORDER IS A CONVENTION, NOT WHAT MAKES `A$` READ AS `A$`. The sentence
 * that stood here said longest-first stops a multi-character prefix being
 * "shadowed by the single character it ends in". That mechanism does not
 * exist: JS alternation scans by START POSITION, so `$` — a SUFFIX of `A$` —
 * is never an alternative competing at the same index. Ordering can only
 * shadow a PROPER PREFIX overlap.
 *
 * MEASURED at `d6f2eef9`, two ways. (a) A shortest-first alternation built from
 * the same keys matches all ten of them identically (`£ $ € ¥ ₹ A$ C$ NZ$ CHF
 * kr`): 0 keys where the order changes the match. (b) Flipping this comparator
 * to shortest-first leaves 327 of 328 tests green across the ten specs this PR
 * touches — the single failure is the length-ordering test in
 * `__tests__/amount-range.test.ts`, which asserts the ORDER and no behaviour.
 * A proper-prefix census over this vocabulary returns ZERO; the same census
 * over `magnitude-alphabet.ts` returns SIX (`m` ⊂ `mn`, `b` ⊂ `bn`, `t` ⊂
 * `trillion`, …), which is the contrast control proving the census can see an
 * overlap where one exists — and is why longest-first IS load-bearing there.
 *
 * ⭐ THE SORT STAYS ANYWAY: it costs nothing, it is the ordering that would
 * start mattering the day a key became a proper prefix of another (add `CH`
 * beside `CHF` and shortest-first reads `CH` — checked), and it keeps the two
 * alternations in this file written the same way. What actually keeps a range
 * publishing the right currency is MEMBERSHIP — the derivation from
 * `CURRENCY_SYMBOL_TO_CODE` below — pinned by the per-key behavioural rows.
 *
 * ⚠⚠ WHAT A HAND-SPELLED CLASS COST, MEASURED ON THIS PR AT `302556d4` AND AT
 * BASE `f4c8f501`, through `parseNumericValue`. `cee/extraction/numeric-parser`'s
 * range grammar spelled `[£$€¥₹]` while its own POINT grammar one function
 * below spelled `[£$€¥₹]|A\$|C\$|NZ\$|CHF|kr`. The range pattern therefore
 * read the `$` INSIDE `A$`, and a range said in Australian dollars was
 * published in US ones:
 *
 *     "A$ 80k-120k"   f4c8f501  80,000 AUD (a point)
 *                     302556d4  100,000 **USD**   ← the currency changed
 *     "C$ 80-120k"    f4c8f501  80 CAD
 *                     302556d4  100,000 **USD**
 *     "NZ$ 80-120k"   f4c8f501  80 NZD
 *                     302556d4  100,000 **USD**
 *     "CHF 80-120k"   f4c8f501  80 CHF
 *                     302556d4  80 CHF (the range never matched at all)
 *
 * The non-range spellings were unaffected at both commits ("A$ 80k" → AUD), so
 * the defect was specific to the pattern the shorter list belonged to — which
 * is the signature of a mirror, not of a decision.
 *
 * ⚠ DERIVED, NOT SPELLED, and this file already learned that lesson once:
 * `cee/extraction/__tests__/currency-vocabulary.union.test.ts` REDded on a
 * hand-written copy below and said what to do instead. Note what it could NOT
 * have caught here — by its own documented design it stays silent on a
 * currency class that is a limb of an amount GRAMMAR rather than a whole-token
 * membership test, and both of numeric-parser's lists are grammars. A
 * detection guard proves a copy is REVIEWED; only derivation stops one being
 * SHORT (CLAUDE.md trap 12d — the two are not redundant).
 */
export const CURRENCY_PREFIX_ALTERNATION: string = Object.keys(CURRENCY_SYMBOL_TO_CODE)
  .sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0))
  .map(escapeForPattern)
  .join("|");

export const BARE_AMOUNT_RANGE_START_GUARD =
  `(?<![\\d.,+\\-–—])` +
  `(?<!(?:${CURRENCY_SYMBOL_INITIAL_ALTERNATION})${CURRENCY_AMOUNT_SEPARATION})` +
  `(?<!\\b(?:${CURRENCY_WORD_INITIAL_ALTERNATION})${CURRENCY_AMOUNT_SEPARATION})`;

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
  options?: {
    readonly currencyBeforeMax?: string;
    readonly separator?: string;
    /**
     * Require a magnitude on the UPPER bound (default: optional).
     *
     * ⚠ IT IS HOW A PATTERN WITH NO UNIT OF ITS OWN STAYS NARROW. A bare
     * dash-joined pair with no magnitude on either side — "3-5 people",
     * "2024-2025", "£50,000 - 3 months" — is not a range this module can read,
     * and minting a band from it is the OVER-read direction, the worse of the
     * two. Required, the pattern's domain is exactly
     * `RANGE_LOWER_BOUND_DEFERRAL_TAIL`'s, which is the point.
     */
    readonly requireMaxMagnitude?: boolean;
  },
): string {
  const maxPrefix = options?.currencyBeforeMax ?? "";
  const separator = options?.separator ?? RANGE_SEPARATOR;
  const maxMagnitude = options?.requireMaxMagnitude === true
    ? requiredMagnitudeSuffixPattern(maxMagGroup)
    : magnitudeSuffixPattern(maxMagGroup);
  return (
    `(?<${minGroup}>${AMOUNT_DIGITS})` +
    magnitudeSuffixPattern(minMagGroup) +
    separator +
    maxPrefix +
    `(?<${maxGroup}>${AMOUNT_DIGITS})` +
    maxMagnitude
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
    // The elliptical case — the whole point of this module.
    const multiplier = resolveMagnitude(input.maxMagnitude);
    const maxValue = maxDigits * multiplier;

    if (minDigits <= maxDigits) {
      // The bare digits already ascend, so the shared suffix distributes across
      // both bounds and the pair reads as one band on one scale ("80-120k").
      return {
        min: minDigits * multiplier,
        max: maxValue,
        magnitudeDistributed: multiplier !== 1,
      };
    }

    // ⭐⭐ THE BARE DIGITS DESCEND. THAT IS ONE OBSERVATION AND IT ANSWERS TWO
    // DIFFERENT QUESTIONS, WHICH IS WHY IT USED TO BE ONE REFUSAL AND IS NOW
    // TWO (CLAUDE.md trap 21 — one name over two questions).
    //
    // Distributing is dead here by construction: `minDigits > maxDigits`
    // multiplied through by the same suffix stays descending. What is left is
    // the LITERAL reading — the lower bound as written, the upper bound taking
    // the suffix alone — and the only thing that can defeat it is a rival
    // reading in which the writer DROPPED a suffix from the lower bound.
    //
    //   "£80,000-120k"  literal 80,000..120,000    ascends
    //                   dropped 80,000k..120k      descends — no rival
    //   "£500-2m"       literal 500..2,000,000     ascends
    //                   dropped 500k..2m           ALSO ascends — a rival
    //
    // So: refuse where NEITHER reading ascends (a pair that genuinely
    // descends), refuse where BOTH do (genuinely ambiguous, and guessing is
    // the 1,000x-wrong publication this module exists to stop), and read the
    // literal one where it is the only one standing.
    //
    // ⚠ THE RIVAL IS TESTED AT THE ALPHABET'S SMALLEST RUNG and that is not an
    // arbitrary choice: the smallest rung is the one most easily satisfied, so
    // if it cannot lift the lower bound to or below the upper bound, no larger
    // rung can. One comparison settles the whole alphabet.
    //
    // ⚠ WHAT THIS DELIBERATELY DOES NOT DO is discriminate on TYPOGRAPHY — a
    // thousands separator in the lower bound, a decimal point in the upper. On
    // this corpus a separator test agrees with the rule above on every member
    // but "£1,200-2m", where it would publish a 1,667x band over a reading
    // ("£1,200k-£2m") that is coherent and, for a revenue sentence, likelier.
    // Typography is a proxy for the ambiguity; the rival reading IS the
    // ambiguity, so it is what gets asked.
    if (minDigits > maxValue) return null;
    if (minDigits * SMALLEST_DROPPABLE_MAGNITUDE <= maxValue) return null;
    return { min: minDigits, max: maxValue, magnitudeDistributed: false };
  }

  const min = minDigits * resolveMagnitude(input.minMagnitude);
  const max = maxDigits * resolveMagnitude(input.maxMagnitude);

  // ⚠⚠ THE SENTENCE THAT USED TO STAND HERE WAS FALSE FOR HALF ITS OWN BRANCH,
  // and the half it was false about is the half this change created.
  //
  // It read: *"a descending pair here is the writer's, not an ellipsis
  // artefact, and the extractors already tolerated it — so it is left alone
  // rather than newly refused."* One sentence covering two situations that
  // differ in exactly the way that matters — the estate's signature defect
  // (trap 21).
  //
  // ⚠⚠ AND THE MEASUREMENT BASIS THAT SENTENCE NAMED WAS THE WRONG FUNCTION
  // (review meta-finding). It said *"measured through `enrichGraphWithFactors`,
  // the user-reachable entry"*. `enrichGraphWithFactors` is the SYNC twin: it
  // is marked `@deprecated`, it has ZERO src call sites outside its own module,
  // and it mints no factor cap at all. The user-reachable entry is
  // `enrichGraphWithFactorsAsync`, which `cee/unified-pipeline/stages/enrich.ts`
  // calls and whose own header says "This is the ONLY call site". A verification
  // sentence naming the wrong function reads as audited and is not, and it sends
  // the next lane to a function no user reaches, under a green suite.
  //
  // ⚠⚠ AND THE CORRECTION FIRST WRITTEN HERE REPEATED THAT DEFECT, which is why
  // the sets below now cite assertions instead of a measurement. It read: *"The
  // numbers below were re-derived through the ASYNC entry at base `f4c8f501`
  // and at `6e982fc3`, and they hold"* — ONE measurement basis claimed over
  // THREE sets that do not share one, and the wrong basis for every one of
  // them. `enrichGraphWithFactorsAsync` cannot produce the middle set at all:
  // `cee/extraction/numeric-parser.ts` is NOT in `enricher.ts`'s transitive
  // import closure (contrast control in the same walk: `utils/magnitude-
  // alphabet.ts` IS reached, so the walk sees real edges; and a same-sweep
  // contrast control finds `parseNumericValue` genuinely imported elsewhere,
  // e.g. `cee/provenance/stated-amounts.ts` and
  // `cee/context-integrity/not-modelled-manifest.ts`, so its absence under
  // `cee/factor-extraction/` is a real absence and not a blind sweep). For the
  // outer two sets the producer is not recoverable from the figures at all:
  // `FactorDataT`
  // and `ExtractedFactor` BOTH carry `extractionType` and `confidence`, so the
  // shape of the record discriminates nothing, and no assertion anywhere drives
  // either enricher for these strings.
  //
  // A measurement nothing re-runs is a claim with no guard on it. Each set
  // below therefore names its OWN producer and the assertion that pins it, so
  // the sentence goes red with the behaviour rather than ageing quietly.
  //
  //   NEITHER bound carries a magnitude — "cut CAC from £600 to £400".
  //   PRODUCER: `extractFactors`. It yields {value 500, rangeMin 600,
  //   rangeMax 400}, and base `f4c8f501` yielded the same. The tolerance is
  //   genuinely INHERITED **through the factor path**, so it is not this
  //   change's to narrow.
  //     PINNED BY `__tests__/amount-range.test.ts`, "the FACTOR path has no
  //     frame guard at all, and the adverb makes no difference to it" — which
  //     asserts those three fields on that exact string.
  //
  //   ⚠ THE SAME CLASS IS **NOT** INHERITED ON THE `parseNumericValue` PATH
  //   WHEN THE PAIR IS DASH-JOINED, and that is a genuine residual this change
  //   leaves open.
  //     "The budget is £50,000 - 3 months of runway."
  //   PRODUCER: `parseNumericValue` — NOT either enricher, and not
  //   `extractFactors`. It publishes 25001.5 at "medium" over rangeMin 50000 >
  //   rangeMax 3. At base `f4c8f501` this function had no dash range grammar,
  //   so the shape could not reach the branch: the tolerance was CREATED here,
  //   exactly as it was for the both-magnitude case below. It is NOT closed,
  //   because the refusal that would close it also deletes the `from X to Y`
  //   members of the recorded gap set, which ARE inherited.
  //     PINNED BY `__tests__/amount-range.test.ts`, `PARSER_STILL_FABRICATES`
  //     under `describe("KNOWN_DASH_JOINED_DESCENDING …")` — in both
  //     directions, so the floor REDs if it grows OR shrinks.
  //
  //   BOTH bounds carry one — "We will cut spend from £2m to £500k this year."
  //   Base `f4c8f501` emitted no range at all here, because it could not read a
  //   magnitude on either bound of a `to`-joined pair. Reading the magnitudes
  //   correctly is what put this shape INSIDE the branch, and at `479c7c97`
  //   the branch then published a midpoint of £1,250,000 — a number the writer
  //   never typed — IN PLACE OF their own stated £2m, with min > max.
  //   ⚠ `479c7c97` IS NOT THIS FUNCTION'S ANSWER: the refusal below returns
  //   `null` for that pair, so do not read those numbers as current behaviour.
  //     PINNED BY `__tests__/amount-range.test.ts` at both levels — the
  //     `resolveAmountRange(…) → null` assertion in "a lower-only magnitude, an
  //     AMBIGUOUS elliptical pair and a descending both-magnitude pair each
  //     refuse; …", and "⭐ the refusal reaches the USER-REACHABLE path: a
  //     stated figure is no longer replaced by a midpoint", where
  //     `extractFactors` yields exactly [500_000, 2_000_000].
  //     ⚠ THAT CITATION NAMED A TEST TITLE THAT NO LONGER EXISTED, and it
  //     quoted the false "and nothing else" clause while doing so. The title
  //     has been repaired twice on this PR; citing one by its full text is a
  //     hand-maintained mirror, so the reference above is deliberately a
  //     PREFIX and the assertion it points at is named by what it does.
  //
  // That is the OVER-READ direction this module's header calls the worse of
  // the two, arriving on the path that reaches a user. So the ordering
  // precondition already applied by the other two answers in this file
  // (`resolvePercentRange` refuses a descending pair; the elliptical branch
  // above refuses one) is applied to the members this change added, and to
  // those only. Refusing restores the base output on that set EXACTLY.
  if (hasMinMag && hasMaxMag && min > max) return null;

  // Neither bound carries a magnitude: the inherited tolerance, left alone.
  // Narrowing THAT set is a separate decision from reading magnitudes
  // correctly, and it is not this change's to take.
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
 * ⚠⚠ "ONE RULE, TWO USES" IS STILL NOT WHAT THIS FILE IMPLEMENTS, and the two
 * sentences that have stood here before both described it wrongly. There are
 * FOUR answers to "is a descending pair a range?", and the split is by whether
 * this change put the shape inside the branch, not by tidiness:
 *
 *   percent (here)                        → NO. Refuse.
 *   amount, magnitude on ONE side only    → NO. Refuse (ellipsis needs the
 *                                           ordering precondition to be safe).
 *   amount, magnitude on BOTH sides       → NO. Refuse. This shape could not
 *                                           reach the branch before magnitudes
 *                                           were read on both bounds, so the
 *                                           tolerance was NOT inherited — it
 *                                           was created here, and it published
 *                                           a midpoint over a stated figure on
 *                                           the user-reachable enricher path.
 *                                           Refusing restores the base output
 *                                           on that set exactly.
 *   amount, NEITHER bound carries one     → YES, and it publishes `min > max`.
 *                                           Inherited ONLY IN PART. The
 *                                           unqualified "base and head are
 *                                           identical on it" that used to stand
 *                                           here is false, and it is the same
 *                                           over-broad sentence corrected twice
 *                                           above: it holds for the `from X to
 *                                           Y` members, and NOT for the
 *                                           dash-joined ones on the
 *                                           `parseNumericValue` path, which
 *                                           base `f4c8f501` read as a confident
 *                                           POINT and which this file's grammar
 *                                           now turns into an inverted range.
 *                                           Both halves are pinned as recorded
 *                                           floors, not endorsed:
 *                                           `LIE_FABRICATES_A_MIDPOINT` and
 *                                           `PARSER_STILL_FABRICATES` in
 *                                           `__tests__/amount-range.test.ts`.
 *
 * The fourth is a tolerance carried forward. It is recorded here rather than
 * smoothed over, because a comment asserting an invariant the file does not
 * hold is the most convincing wrong sentence in a module — a successor would
 * reconcile the code to the comment and change behaviour nobody asked to
 * change. The third was described that way too, and it was not true of it.
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
