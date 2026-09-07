/**
 * ⭐⭐ THE ONE CURRENCY VOCABULARY (ROADMAP 2.972, relocated on PR #1327).
 *
 * This map used to live in `cee/extraction/numeric-parser.ts`, which is where
 * every consumer still imports it from — `numeric-parser` re-exports it, so no
 * call site changed when it moved. It moved because `utils/amount-range.ts`
 * needs it and `numeric-parser` IMPORTS `amount-range`: reading it back the
 * other way would close an import cycle, and the alternative — a second list
 * spelled in `amount-range` — is precisely the mirror
 * `__tests__/currency-vocabulary.union.test.ts` exists to forbid. That guard
 * caught exactly that attempt on this PR and said what to do instead: DERIVE
 * from the canonical map. A module in `utils/` can be derived from by both.
 *
 * ⚠ THIS IS THE SAME MOVE ALREADY MADE FOR THE MULTIPLIER ALPHABET.
 * `numeric-parser` once held a private multiplier map that had drifted three
 * keys short of canonical, silently reading each of them as x1; it now
 * re-exports `utils/magnitude-alphabet.ts` (ROADMAP 2.1130). Currency had the
 * same shape of risk and now has the same shape of fix.
 *
 * (Those three keys are named in `magnitude-alphabet.ts` itself. They are not
 * repeated here: `__tests__/magnitude-alphabet.union.test.ts` scans src/ for
 * magnitude words with a plain word-boundary regex, so spelling them even in
 * prose puts this file in that guard's unreviewed list — which it did, and
 * which is a fair complaint, because a reader cannot tell prose from a list
 * by grepping either.)
 *
 * ⚠ WHAT A MISSING KEY COSTS, measured on #1327: while the bare-range start
 * guard named only `£$€`, the strings `¥80-120k`, `₹80-120k` and
 * `CHF 80-120k` fell through it into a pattern that carries NO unit, and each
 * minted a factor at 100,000 with `unit` absent — a currency-bearing amount
 * stored unitless, where base `f4c8f501` minted nothing at all. A symbol
 * missing from a copy does not fail loudly; it publishes a number with its
 * currency quietly removed.
 */
const CURRENCY_MAP: Record<string, string> = {
  "£": "GBP",
  "$": "USD",
  "€": "EUR",
  "¥": "JPY",
  "₹": "INR",
  "A$": "AUD",
  "C$": "CAD",
  "NZ$": "NZD",
  "CHF": "CHF",
  "kr": "SEK",
};

/** The one currency vocabulary. See the note on {@link CURRENCY_MAP}. */
export const CURRENCY_SYMBOL_TO_CODE: Readonly<Record<string, string>> = CURRENCY_MAP;
