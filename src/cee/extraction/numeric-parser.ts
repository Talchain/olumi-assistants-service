/**
 * Numeric Value Parser
 *
 * Extracts and parses numeric values from text for intervention mapping.
 * Supports currencies, percentages, multipliers, and plain numbers.
 *
 * ⭐⭐ THE MAGNITUDE ALPHABET IS NOT SPELLED HERE (ROADMAP 2.1130, CLAUDE.md
 * trap 12). Every magnitude key, the alternation that matches it and the
 * lookup that resolves it come from `src/utils/magnitude-alphabet.ts`. Until
 * 2.1130 this module carried a private `MULTIPLIERS` map AND spelled the
 * alphabet inline five separate times as `([kKmMbB]|thousand|million|billion)`,
 * and both copies were measurably wrong at `dbd012eb`, in OPPOSITE directions:
 *
 *   · SHORT LIST — `grand`, `t` and `trillion` are canonical and were absent,
 *     so `parseNumericValue("£250 grand")` returned 250. That is the same
 *     1,000x under-read ROADMAP 2.330 was opened to close, still live in the
 *     very module the canonical alphabet's header names as the sibling it took
 *     `thousand` and `mn` FROM.
 *
 *   · NO WORD BOUNDARY — the inline alternations had no `\b`, so an amount
 *     followed by an ordinary word beginning with a magnitude letter was
 *     INFLATED, at `confidence: "high"`:
 *       "£20,000 migration cost" -> 20,000,000,000     (the 'm' of "migration")
 *       "£20,000 board approval" -> 20,000,000,000,000 (the 'b' of "board")
 *       "£100 base"              -> 100,000,000,000
 *     The canonical module documents this exact defect (#787: the 't' of
 *     "THIS year" scaling 6,000,000 to 6e18) and closes it with the `\b` inside
 *     `magnitudeSuffixFragment`. Fabrication is the worse direction of the two,
 *     and it was the one no guard was looking for.
 *
 * ⚠ WHY THE UNION GUARD COULD NOT SEE EITHER, so nobody re-derives comfort from
 * it: `utils/__tests__/magnitude-alphabet.union.test.ts` Part A asserts
 * canonical ⊇ sibling. A SHORT sibling satisfies that by construction, and a
 * sibling whose REGEX disagrees with its own map is outside a key comparison
 * altogether. With `MULTIPLIERS` now a pure re-export, Part A's two assertions
 * about THIS module are tautologies — deliberately, and disclosed. The
 * load-bearing guard is now behavioural and lives in
 * `__tests__/numeric-parser-magnitude-authority.test.ts`: it sweeps
 * `parseNumericValue` itself over every canonical key, and carries a
 * hand-written corpus for the class no list can express (trap 12d).
 */

import {
  AMOUNT_DIGITS,
  MAGNITUDE_MULTIPLIERS,
  MAGNITUDE_SUFFIX_ANON,
  magnitudeSuffixPattern,
  parseAmountDigits,
  resolveMagnitude,
} from "../../utils/magnitude-alphabet.js";
import {
  amountRangePattern,
  RANGE_SEPARATOR,
  rangePointEstimate,
  resolveAmountRange,
  resolvePercentRange,
} from "../../utils/amount-range.js";

/**
 * Relative value kind for precise classification.
 */
export type RelativeKind = "percent" | "multiplier" | "delta";

/**
 * Parsed numeric value with metadata.
 */
export interface ParsedValue {
  /** The numeric value */
  value: number;
  /** Unit of measurement (e.g., "GBP", "USD", "percent", "months") */
  unit?: string;
  /** Whether this is a relative change (e.g., "increase by 20%") */
  isRelative: boolean;
  /** Type of relative change (legacy, use relativeKind instead) */
  relativeType?: "percent" | "absolute";
  /** Precise relative value classification */
  relativeKind?: RelativeKind;
  /** The relative value before resolution (e.g., 20 for "+20%", 2 for "2x") */
  relativeValue?: number;
  /** Direction of change for relative values */
  relativeDirection?: "increase" | "decrease";
  /** Confidence in the extraction */
  confidence: "high" | "medium" | "low";
  /** Original text that was parsed */
  originalText: string;
  /**
   * ⭐ A RANGE IS NOT A POINT (ROADMAP 2.1131).
   *
   * Set when the text stated a RANGE ("£80-120k", "between 5 and 10 thousand").
   * `value` then carries the point estimate this service runs on — the
   * midpoint, chosen once in `rangePointEstimate` so the factor path and this
   * path cannot disagree about which point — and these two carry what the user
   * actually wrote.
   *
   * ⚠ WHY THE FIELDS EXIST RATHER THAN A BARE MIDPOINT. Until now this parser
   * had NO range grammar at all, so it read a range's LOWER BOUND and returned
   * it as `confidence: "high"` — MEASURED at `f4c8f50`,
   * `parseNumericValue("£80-120k for the first hire")` returned **80**, which
   * is the exact number the 3 Sep session then enforced a scale from. A caller
   * that cannot see a range cannot tell the user which point was taken, and a
   * point silently substituted for a range is the product deciding something
   * the user did not.
   */
  isRange?: boolean;
  rangeMin?: number;
  rangeMax?: number;
}

/**
 * Currency symbol to unit mapping.
 *
 * EXPORTED as {@link CURRENCY_SYMBOL_TO_CODE} (ROADMAP 2.972) so the
 * provenance locator (`cee/provenance/stated-amounts.ts`) derives its currency
 * alternation from THIS list rather than re-spelling one. A second hand-written
 * currency vocabulary is exactly the mirror CLAUDE.md trap 12 describes, and a
 * symbol missing from a copy would make a stated amount invisible — i.e. would
 * silently strip a provenance claim that was in fact earned.
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

/**
 * Multiplier suffixes — THE CANONICAL ALPHABET ITSELF, re-exported.
 *
 * ⚠ NO LONGER A HAND-WRITTEN SIBLING (ROADMAP 2.1130). This was a private map
 * that had drifted three keys short of canonical (`grand`, `t`, `trillion`),
 * silently reading each of them as x1. It is now the canonical map by
 * reference, so this module cannot go short again and there is nothing to keep
 * in sync.
 *
 * ⚠ THE EXPORT SURVIVES ONLY FOR THE UNION GUARD, AND IT IS NOW A TAUTOLOGY
 * THERE — stated plainly so no later reader mistakes it for evidence.
 * `utils/__tests__/magnitude-alphabet.union.test.ts` Part A asks "is every
 * sibling key canonical?"; a re-export answers yes by identity. That guard has
 * not been weakened (it was always blind in this direction — a SHORT sibling
 * passed it too); it has simply run out of anything to say about this module.
 * What replaces it is behavioural: `numeric-parser-magnitude-authority.test.ts`
 * sweeps `parseNumericValue` over every canonical key, which is a claim about
 * the STRINGS this module resolves rather than about a list it holds.
 *
 * Nothing outside that guard should index this: consumers take the canonical
 * alphabet's `resolveMagnitude`, which case-folds.
 */
export const MULTIPLIERS: Readonly<Record<string, number>> = MAGNITUDE_MULTIPLIERS;

/**
 * Time unit patterns.
 */
const TIME_UNITS = ["day", "days", "week", "weeks", "month", "months", "year", "years", "hour", "hours"];

/**
 * Count unit patterns.
 */
const COUNT_UNITS = [
  "people",
  "person",
  "engineer",
  "engineers",
  "developer",
  "developers",
  "employee",
  "employees",
  "user",
  "users",
  "customer",
  "customers",
  "unit",
  "units",
  "item",
  "items",
];

/**
 * Parse a numeric value from text.
 *
 * @param text - Text containing a numeric value
 * @returns Parsed value or null if no value found
 *
 * @example
 * parseNumericValue("£59") // { value: 59, unit: "GBP", ... }
 * parseNumericValue("$100k") // { value: 100000, unit: "USD", ... }
 * parseNumericValue("25%") // { value: 25, unit: "percent", ... }
 * parseNumericValue("increase by 20%") // { value: 20, isRelative: true, ... }
 */
export function parseNumericValue(text: string): ParsedValue | null {
  if (!text || typeof text !== "string") {
    return null;
  }

  const trimmed = text.trim();

  // Try each parser in order of specificity.
  //
  // ⚠ `parseRangeValue` RUNS FIRST, AND THE ORDER IS LOAD-BEARING. Every
  // parser below reads the FIRST amount it finds and stops, so on a range each
  // of them returns the lower bound as a confident point — and
  // `parsePercentageValue` does something worse: its sign group reads the
  // range hyphen of "5-10%" as a MINUS, returning **-10** at
  // `confidence: "high"` for a stated 5-to-10% churn band. Both were measured
  // at `f4c8f50`. Recognising the range before any of them is what stops a
  // written range being silently rewritten into a point.
  //
  // ⚠⚠ AND A REFUSED RANGE MUST NOT FALL THROUGH. `parseRangeValue` answers
  // THREE things, not two — "here is a range", "there is no range here", and
  // "there is a range and I will not guess its magnitude" — and the first
  // version of this chain collapsed the last two into `null`, so `£500-2m`
  // refused in the range parser and then returned **500** from
  // `parseCurrencyValue` one line later, at `confidence: "high"`. That is the
  // exact publication the refusal exists to prevent, arriving through the
  // fall-through, and the comment above the parser already said it must not
  // happen while the code did it anyway. `RANGE_REFUSED` makes the third
  // answer a value the chain can see.
  const range = parseRangeValue(trimmed);
  if (range === RANGE_REFUSED) return null;

  return (
    range ||
    parseRelativeValue(trimmed) ||
    parseMultiplierValue(trimmed) ||
    parseCurrencyValue(trimmed) ||
    parsePercentageValue(trimmed) ||
    parseCountValue(trimmed) ||
    parsePlainNumber(trimmed)
  );
}

/**
 * Parse a stated RANGE — "£80-120k", "between 5 and 10 thousand", "5-10%".
 *
 * Returns the point estimate in `value` (so every existing consumer keeps
 * working, and now on a correctly-scaled number instead of the lower bound)
 * WITH the stated bounds beside it, so a consumer that can say "I've taken
 * £100k from your £80k–£120k" has the material to.
 *
 * `confidence` is `"medium"`, not `"high"`: a point taken from a range is an
 * estimate the SERVICE chose, not a figure the user stated, and reporting it
 * at the same confidence as a stated point is what let a midpoint be enforced
 * as if the user had typed it.
 *
 * The grammar and the shared-suffix rule are `utils/amount-range.ts`, the same
 * module `cee/factor-extraction` reads — so the two extractors resolve
 * "£80-120k" to the same two bounds and the same point. That agreement is
 * asserted directly, on one shared corpus, in
 * `utils/__tests__/amount-range.test.ts` — see "the option path and the factor
 * path agree about the same sentence".
 *
 * ⚠ THIS POINTER WAS WRONG AND IS CORRECTED. It named
 * `factor-extraction/__tests__/range-magnitude-cross-extractor.test.ts`, a file
 * that does not exist in this repo; a successor grepping for it would have
 * concluded the agreement was unasserted. The guard is real, only the address
 * was fictional — which is exactly the class of sentence this estate treats as
 * a defect in its own right.
 */
/**
 * The third answer `parseRangeValue` can give: "this text states a range, and
 * its magnitude cannot be scoped without guessing." Distinct from `null`
 * ("no range here"), because the two demand OPPOSITE things of the caller —
 * `null` means try the point parsers, this means stop.
 */
const RANGE_REFUSED = Symbol("range_refused");
type RangeParse = ParsedValue | typeof RANGE_REFUSED | null;

/**
 * ⭐⭐⭐ "from X to Y" IS A CHANGE, NOT A RANGE — and reading it as one turned a
 * confident figure into `null` on exactly the construction "reduce", "cut" and
 * "lower" mean.
 *
 * `RANGE_SEPARATOR` admits `\s+to\s+`, and every range pattern below makes its
 * `between` prefix optional, so a from-to frame matched as a range. When the
 * pair DESCENDS — which is what a reduction is — `resolvePercentRange` refuses,
 * `RANGE_REFUSED` stops the chain, and the caller gets nothing. Measured
 * through `parseNumericValue` at `d2847f2c`, against the base at `f4c8f501`:
 *
 *     "reduce churn from 10% to 5%"    10 (high) →  NULL
 *     "cut CAC from £600 to £400"     600 (high) →  500 (medium), rangeMin > rangeMax
 *     "cut spend from £2m to £500k"     2m (high) →  1.25m (medium), inverted
 *     "raise price from £49 to £59"    49 (high) →  54 (medium)
 *
 * ⚠⚠ AND WHAT THAT COSTS A USER TODAY IS NOT WHAT THIS COMMENT USED TO SAY.
 * It read: *"Both consumers are the option-intervention path —
 * `intervention-extractor.ts` `continue`s on a falsy value at `:407` and
 * pushes `value: null` at `:329` — so the intervention is dropped or nulled
 * outright."* The two call sites are named correctly and what they PASS was
 * never checked. Measured by driving the five real `INTERVENTION_PATTERNS`
 * and the `:407` fallback scan over these sentences, rather than by reading
 * their regexes:
 *
 *   - `:329` takes `valueGroup` from `INTERVENTION_PATTERNS`. Four of the five
 *     capture the single token `([£$€¥₹]?\d+(?:,\d{3})*(?:\.\d+)?[kKmMbB]?%?)`;
 *     the one `valueGroup: 0` pattern's full match terminates at its first
 *     percent, so "reduce churn from 10% to 5%" arrives as "reduce churn from
 *     10%" — one bound, never a span.
 *   - `:407` scans that same single-token pattern with `/g`, so it hands over
 *     "£600" and "£400" separately, never "£600 to £400".
 *   - the two `parseNumericValue` calls inside `extractAllNumericValues` — the
 *     segment loop and the pattern-match loop — belong to a function with ZERO
 *     consumers in `src/`, held there by a live tripwire with its own positive
 *     control at `__tests__/numeric-parser-magnitude-authority.test.ts`.
 *     (⚠ NAMED BY SYMBOL, NOT BY LINE, per review N4: this read `:841/861`,
 *     which had already drifted to `:873/893` by the time it was reviewed. A
 *     line number in a comment is a hand-maintained mirror with no guard on it,
 *     and it goes stale inside the same PR that writes it — trap 12.)
 *
 * Across every sentence above, no from-to SPAN reaches `parseNumericValue` at
 * all (the span detector was itself positive-controlled before the absence was
 * believed). So this class is NOT user-reachable through THIS function, and the
 * range grammar here is currently exercised only by single-token inputs.
 *
 * ⚠⚠⚠ DO NOT READ THAT AS "THE FROM-TO CLASS IS NOT USER-REACHABLE". It is
 * reachable, through the OTHER extractor. `factor-extraction`'s `extractFactors`
 * is called from `enricher.ts` in `enrichGraphWithFactorsAsync` and in
 * `mintGoalTargetOnly` (which that async entry calls); it has NO from-to frame
 * guard of any kind, and its range patterns claim a from-to span exactly as this
 * one did. A manifest for one function is evidence about that function and
 * nothing else (trap 20); the generalisation is where the error enters, and it
 * entered twice here before this sentence was written. What that path does with
 * a descending from-to is decided in `utils/amount-range.ts`, and the measured
 * base/head pair is recorded there.
 *
 * ⚠ THE CALL SITES WERE LISTED AS `:393`, `:858` AND `:982` UNTIL THE REVIEW
 * META-FINDING, and one of the three is NOT REACHABLE: `:393` sits inside
 * `enrichGraphWithFactors`, the `@deprecated` SYNC twin with zero src callers.
 * Naming it beside two reachable sites made the reachability claim read as
 * broader than it is, in a paragraph whose entire subject is not over-reading a
 * manifest. Symbols, not line numbers, for the same reason as above.
 *
 * ⚠ THIS PR ALREADY CONTAINED THE RIGHT ANALYSIS, one module over.
 * `resolveAmountPairBothOrNeither`'s docstring: *"a DECREASE descends by
 * definition, so the ordering precondition that makes shared-suffix ellipsis
 * safe for a range says nothing here."* It was implemented for `changePattern`
 * in `factor-extraction` and not carried here, where the same precondition
 * meets the same construction. This is that rule, applied consistently.
 *
 * ⭐ BOUND BY POSITION, NOT BY OCCURRENCE. The predicate asks whether THIS
 * match's own lower bound is the object of a `from`, never whether the word
 * appears somewhere in the text — an assertion (or a suppression) must bind to
 * its object by identity, and here identity is position (trap 19). So
 * "we cut costs, and the range is £5k-£9k" is untouched.
 *
 * The remedy is to return `null`, not `RANGE_REFUSED`: this text states a
 * figure, it simply is not a range, so the point parsers below should read it —
 * which restores the confident `from`-side value the base returned.
 */
function isFromToChangeFrame(text: string, matchIndex: number | undefined): boolean {
  if (matchIndex === undefined) return false;
  return /\bfrom\s+$/i.test(text.slice(0, matchIndex));
}

function parseRangeValue(text: string): RangeParse {
  const currencyRange = new RegExp(
    `(?<currency>[£$€¥₹])\\s*` +
      amountRangePattern("min", "minMag", "max", "maxMag", {
        currencyBeforeMax: "(?:[£$€¥₹]\\s*)?",
      }),
    "i",
  );
  const currencyMatch = text.match(currencyRange);
  if (currencyMatch && !isFromToChangeFrame(text, currencyMatch.index)) {
    const g = currencyMatch.groups ?? {};
    const resolved = resolveAmountRange({
      minDigits: g.min,
      minMagnitude: g.minMag,
      maxDigits: g.max,
      maxMagnitude: g.maxMag,
    });
    // A refusal emits NOTHING and stops the chain — see `RANGE_REFUSED`.
    if (resolved === null) return RANGE_REFUSED;
    return {
      value: rangePointEstimate(resolved),
      unit: CURRENCY_MAP[g.currency!] || g.currency!,
      isRelative: false,
      confidence: "medium",
      originalText: currencyMatch[0],
      isRange: true,
      rangeMin: resolved.min,
      rangeMax: resolved.max,
    };
  }

  // Percentage range: "5-10%", "between 5 and 10%". No magnitude — a
  // percentage does not take one, and the bounds are read as written.
  // ⚠ THE SEPARATOR IS `RANGE_SEPARATOR`, NOT A PRIVATE COPY. This pattern
  // spelled its own `(?:\\s*[-–—]\\s*|\\s+(?:to|and)\\s+)`, which carried the
  // same unanchored `and` the shared constant has now dropped — so
  // "We saw 5% and 10% in the two cohorts" read as one range with a midpoint
  // nobody wrote. A second spelling of a separator is the mirror this module
  // moved to `amount-range.ts` to abolish (trap 12); it is consumed here.
  const percentRange = new RegExp(
    `(?:between\\s+)?(?<min>${AMOUNT_DIGITS})\\s*%?` +
      RANGE_SEPARATOR +
      `(?<max>${AMOUNT_DIGITS})\\s*%`,
    "i",
  );
  const percentMatch = text.match(percentRange);
  if (percentMatch && !isFromToChangeFrame(text, percentMatch.index)) {
    const g = percentMatch.groups ?? {};
    const resolvedPercent = resolvePercentRange({ minDigits: g.min, maxDigits: g.max });
    // A DESCENDING pair is not a range — "revenue 2024-10%" is a year and a
    // month. Refusing stops the chain: falling through would land on
    // `parsePercentageValue`, whose sign group reads the hyphen as a MINUS and
    // published **-10** at confidence "high" for exactly this text.
    if (resolvedPercent === null) return RANGE_REFUSED;
    return {
      value: rangePointEstimate(resolvedPercent),
      unit: "percent",
      isRelative: false,
      confidence: "medium",
      originalText: percentMatch[0],
      isRange: true,
      rangeMin: resolvedPercent.min,
      rangeMax: resolvedPercent.max,
    };
  }

  // Bare range, word separator only: "between 5 and 10 thousand". The dash
  // form is deliberately not admitted without a currency or a `%` — a bare
  // "80-120" is as likely a date, a version or an id as a range, and this
  // parser has no context to tell them apart.
  const bareRange = new RegExp(
    `between\\s+` +
      amountRangePattern("min", "minMag", "max", "maxMag", {
        separator: "(?:\\s+(?:to|and)\\s+)",
      }),
    "i",
  );
  const bareMatch = text.match(bareRange);
  if (bareMatch) {
    const g = bareMatch.groups ?? {};
    const resolved = resolveAmountRange({
      minDigits: g.min,
      minMagnitude: g.minMag,
      maxDigits: g.max,
      maxMagnitude: g.maxMag,
    });
    if (resolved === null) return RANGE_REFUSED;
    return {
      value: rangePointEstimate(resolved),
      isRelative: false,
      confidence: "medium",
      originalText: bareMatch[0],
      isRange: true,
      rangeMin: resolved.min,
      rangeMax: resolved.max,
    };
  }

  return null;
}

/**
 * Parse relative value expressions like "increase by 20%" or "increase price by 20%".
 */
function parseRelativeValue(text: string): ParsedValue | null {
  // Pattern: (increase|decrease|reduce|raise|lower|cut|boost|grow) [target] by X%
  // The target noun is optional and can be 1-3 words
  const relativePercentPattern =
    /\b(increase|decrease|reduce|raise|lower|cut|boost|grow|up|down)\s+(?:(?:the\s+)?(?:\w+(?:\s+\w+){0,2})\s+)?(?:by\s+)?(\d+(?:\.\d+)?)\s*%/i;
  const percentMatch = text.match(relativePercentPattern);

  if (percentMatch) {
    const direction = getRelativeDirection(percentMatch[1]);
    const percentValue = parseFloat(percentMatch[2]);
    // For decrease, store as negative relative value
    const signedRelativeValue = direction === "decrease" ? -percentValue : percentValue;
    return {
      value: percentValue,
      unit: "percent",
      isRelative: true,
      relativeType: "percent",
      relativeKind: "percent",
      relativeValue: signedRelativeValue,
      relativeDirection: direction,
      confidence: "high",
      originalText: percentMatch[0],
    };
  }

  // Pattern: (increase|decrease) [target] by £50
  // The target noun is optional and can be 1-3 words
  const relativeAbsolutePattern = new RegExp(
    `\\b(?<verb>increase|decrease|reduce|raise|lower|cut|boost|grow)\\s+` +
      `(?:(?:the\\s+)?(?:\\w+(?:\\s+\\w+){0,2})\\s+)?(?:by\\s+)?` +
      `(?<currency>[£$€¥₹])\\s*(?<digits>${AMOUNT_DIGITS})` +
      magnitudeSuffixPattern("mag"),
    "i",
  );
  const absoluteMatch = text.match(relativeAbsolutePattern);

  if (absoluteMatch) {
    const g = absoluteMatch.groups ?? {};
    const direction = getRelativeDirection(g.verb!);
    const currencySymbol = g.currency!;
    const digits = parseAmountDigits(g.digits);
    if (digits === null) return null;
    const value = digits * resolveMagnitude(g.mag);
    // For decrease, store as negative delta
    const signedDelta = direction === "decrease" ? -value : value;

    return {
      value,
      unit: CURRENCY_MAP[currencySymbol] || currencySymbol,
      isRelative: true,
      relativeType: "absolute",
      relativeKind: "delta",
      relativeValue: signedDelta,
      relativeDirection: direction,
      confidence: "high",
      originalText: absoluteMatch[0],
    };
  }

  return null;
}

/**
 * Parse multiplier expressions like "double", "2x", "triple".
 */
function parseMultiplierValue(text: string): ParsedValue | null {
  // Named multipliers
  const namedMultipliers: Record<string, number> = {
    "double": 2,
    "triple": 3,
    "quadruple": 4,
    "halve": 0.5,
    "half": 0.5,
  };

  // Pattern: double/triple/halve the X
  const namedPattern = /\b(double|triple|quadruple|halve|half)\s+(?:the\s+)?(\w+(?:\s+\w+)?)/i;
  const namedMatch = text.match(namedPattern);

  if (namedMatch) {
    const multiplierWord = namedMatch[1].toLowerCase();
    const multiplierValue = namedMultipliers[multiplierWord] || 2;
    return {
      value: multiplierValue,
      isRelative: true,
      relativeType: "percent",
      relativeKind: "multiplier",
      relativeValue: multiplierValue,
      relativeDirection: multiplierValue >= 1 ? "increase" : "decrease",
      confidence: "high",
      originalText: namedMatch[0],
    };
  }

  // Pattern: Nx, N times, N-fold
  const numericMultiplierPattern = /\b(\d+(?:\.\d+)?)\s*(?:x|times|fold)\b/i;
  const numericMatch = text.match(numericMultiplierPattern);

  if (numericMatch) {
    const multiplierValue = parseFloat(numericMatch[1]);
    return {
      value: multiplierValue,
      isRelative: true,
      relativeType: "percent",
      relativeKind: "multiplier",
      relativeValue: multiplierValue,
      relativeDirection: multiplierValue >= 1 ? "increase" : "decrease",
      confidence: "high",
      originalText: numericMatch[0],
    };
  }

  return null;
}

/**
 * Determine direction from relative keyword.
 */
function getRelativeDirection(keyword: string): "increase" | "decrease" {
  const decreaseWords = ["decrease", "reduce", "lower", "cut", "down"];
  return decreaseWords.includes(keyword.toLowerCase()) ? "decrease" : "increase";
}

/**
 * Parse currency values like £59, $100k, €2.5m.
 */
function parseCurrencyValue(text: string): ParsedValue | null {
  // Pattern: £59, $100, €45, £10k, $2.5m
  const currencyPattern = new RegExp(
    `(?<currency>[£$€¥₹]|A\\$|C\\$|NZ\\$|CHF|kr)\\s*(?<digits>${AMOUNT_DIGITS})` +
      magnitudeSuffixPattern("mag") +
      `(?:\\s*(?<code>GBP|USD|EUR|JPY|INR|AUD|CAD|NZD|CHF|SEK))?`,
    "i",
  );
  const match = text.match(currencyPattern);

  if (match) {
    const g = match.groups ?? {};
    const currencySymbol = g.currency!;
    const digits = parseAmountDigits(g.digits);
    if (digits === null) return null;
    const explicitUnit = g.code;
    const value = digits * resolveMagnitude(g.mag);

    return {
      value,
      unit: explicitUnit || CURRENCY_MAP[currencySymbol] || currencySymbol,
      isRelative: false,
      confidence: "high",
      originalText: match[0],
    };
  }

  // Also try: 100 GBP, 50 USD format
  // ⚠ The magnitude here was `([kKmMbB])?` — a char class with no word forms
  // at all, so "5 million GBP" parsed as NOTHING (the pattern needs the code to
  // follow the digits, and "million" sat between them unmatched). The canonical
  // fragment carries every spelling, so the postfix form now reads the same
  // alphabet the prefix form does.
  const postfixPattern = new RegExp(
    `(?<digits>${AMOUNT_DIGITS})` +
      magnitudeSuffixPattern("mag") +
      `\\s*(?<code>GBP|USD|EUR|JPY|INR|AUD|CAD|NZD|CHF|SEK)`,
    "i",
  );
  const postfixMatch = text.match(postfixPattern);

  if (postfixMatch) {
    const g = postfixMatch.groups ?? {};
    const digits = parseAmountDigits(g.digits);
    if (digits === null) return null;
    const unit = g.code!.toUpperCase();
    const value = digits * resolveMagnitude(g.mag);

    return {
      value,
      unit,
      isRelative: false,
      confidence: "high",
      originalText: postfixMatch[0],
    };
  }

  return null;
}

/**
 * Parse percentage values like 25%, 3.5%.
 */
function parsePercentageValue(text: string): ParsedValue | null {
  // Pattern: 25%, 3.5%, -10%
  //
  // ⚠⚠ THIS PATTERN'S `-?` IS THE SIGN-FLIP CARRIER, AND IT IS DELIBERATELY
  // LEFT ALONE (ROADMAP 2.1131). At `f4c8f50` it read the HYPHEN OF A RANGE as
  // a minus — `parseNumericValue("churn between 5-10%")` returned **-10** at
  // `confidence: "high"` — and the first cut of this change added a lookbehind
  // here to stop it.
  //
  // ⭐ THAT LOOKBEHIND WAS REMOVED, BECAUSE A MUTANT PROVED IT COULD NOT BITE.
  // Deleting it left all 138 tests GREEN, and an enumeration of every
  // hyphen-joined percent shape confirmed why: `parseRangeValue` runs FIRST and
  // claims every one of them ("5-10%", "5 - 10%", "5%-10%", "5–10%",
  // "between 5 and 10%", "5    -10%"), while the one shape it declines,
  // "5-10 percent", carries no hyphen-adjacent `%` for this pattern to read.
  // The guard was unreachable — a control that cannot fail, shipped beside a
  // fix that does the work.
  //
  // ⚠ WHAT PROTECTS THIS INSTEAD IS THE CHAIN ORDER, and the order is pinned:
  // `parseRangeValue` is consulted before every point parser, and its refusals
  // STOP the chain rather than falling through (`RANGE_REFUSED`). Mutating
  // either — demoting the range parser, or letting a refusal fall through —
  // turns the -10 back on and REDs
  // `utils/__tests__/amount-range.test.ts`. One guard, demonstrably
  // load-bearing, beats two where only one can fire.
  const percentPattern = /(-?\d+(?:\.\d+)?)\s*%/;
  const match = text.match(percentPattern);

  if (match) {
    return {
      value: parseFloat(match[1]),
      unit: "percent",
      isRelative: false,
      confidence: "high",
      originalText: match[0],
    };
  }

  // Pattern: 25 percent, twenty percent
  const percentWordPattern = /(\d+(?:\.\d+)?)\s+percent/i;
  const wordMatch = text.match(percentWordPattern);

  if (wordMatch) {
    return {
      value: parseFloat(wordMatch[1]),
      unit: "percent",
      isRelative: false,
      confidence: "medium",
      originalText: wordMatch[0],
    };
  }

  return null;
}

/**
 * Parse count values like "2 engineers", "3 months".
 */
function parseCountValue(text: string): ParsedValue | null {
  // Time units
  for (const unit of TIME_UNITS) {
    const pattern = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${unit}`, "i");
    const match = text.match(pattern);
    if (match) {
      // Normalize to singular form
      const normalizedUnit = unit.replace(/s$/, "");
      return {
        value: parseFloat(match[1]),
        unit: normalizedUnit,
        isRelative: false,
        confidence: "high",
        originalText: match[0],
      };
    }
  }

  // Count units
  for (const unit of COUNT_UNITS) {
    const pattern = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${unit}`, "i");
    const match = text.match(pattern);
    if (match) {
      // Normalize to singular form
      const normalizedUnit = unit.replace(/s$/, "").replace(/ies$/, "y");
      return {
        value: parseFloat(match[1]),
        unit: normalizedUnit,
        isRelative: false,
        confidence: "high",
        originalText: match[0],
      };
    }
  }

  return null;
}

/**
 * Parse plain numbers like 50,000 or 100000.
 */
function parsePlainNumber(text: string): ParsedValue | null {
  // Pattern: plain number, possibly with commas.
  // ⚠ The `i` flag is NEW and is part of the canonical contract, not a
  // widening of intent: `MAGNITUDE_MULTIPLIERS` is documented as "matched
  // case-INSENSITIVELY by every consumer", and `resolveMagnitude` case-folds.
  // Without it this one spelling read "5 K" as 5 while every sibling pattern in
  // the same file read it as 5,000 — a disagreement inside one module.
  const numberPattern = new RegExp(
    `^(?<digits>-?${AMOUNT_DIGITS})` + magnitudeSuffixPattern("mag") + `$`,
    "i",
  );
  const match = text.match(numberPattern);

  if (match) {
    const g = match.groups ?? {};
    const digits = parseAmountDigits(g.digits);
    if (digits === null) return null;
    const value = digits * resolveMagnitude(g.mag);

    return {
      value,
      isRelative: false,
      confidence: "medium",
      originalText: match[0],
    };
  }

  return null;
}

/**
 * Resolve a relative value to an absolute value given a baseline.
 *
 * @param parsed - Parsed relative value
 * @param baseline - Baseline value to apply change to
 * @returns Resolved absolute value
 *
 * @example
 * // Increase by 20%
 * resolveRelativeValue({ value: 20, relativeKind: "percent", relativeValue: 20 }, 100)
 * // Returns 120
 *
 * // Decrease by £5
 * resolveRelativeValue({ value: 5, relativeKind: "delta", relativeValue: -5 }, 50)
 * // Returns 45
 *
 * // Double the value
 * resolveRelativeValue({ value: 2, relativeKind: "multiplier", relativeValue: 2 }, 50)
 * // Returns 100
 */
export function resolveRelativeValue(parsed: ParsedValue, baseline: number): number {
  if (!parsed.isRelative) {
    return parsed.value;
  }

  // Use relativeKind if available (new format), fall back to relativeType (legacy)
  const kind = parsed.relativeKind || (parsed.relativeType === "percent" ? "percent" : "delta");

  switch (kind) {
    case "percent": {
      // relativeValue is signed: +20 means +20%, -20 means -20%
      const _percentChange = parsed.relativeValue ?? parsed.value;
      // Handle direction from legacy format
      const signedPercent = parsed.relativeValue !== undefined
        ? parsed.relativeValue
        : (parsed.relativeDirection === "decrease" ? -parsed.value : parsed.value);
      return baseline * (1 + signedPercent / 100);
    }
    case "multiplier": {
      // relativeValue is the multiplier (e.g., 2 for "double")
      const multiplier = parsed.relativeValue ?? parsed.value;
      return baseline * multiplier;
    }
    case "delta": {
      // relativeValue is signed: +50000 for "add $50k", -50000 for "reduce by $50k"
      const delta = parsed.relativeValue !== undefined
        ? parsed.relativeValue
        : (parsed.relativeDirection === "decrease" ? -parsed.value : parsed.value);
      return baseline + delta;
    }
    default: {
      // Legacy fallback
      const direction = parsed.relativeDirection === "decrease" ? -1 : 1;
      if (parsed.relativeType === "percent") {
        return baseline * (1 + (parsed.value / 100) * direction);
      } else {
        return baseline + parsed.value * direction;
      }
    }
  }
}

/**
 * Resolve a relative value to an absolute value using the relativeKind classification.
 *
 * @param relativeKind - Type of relative value
 * @param relativeValue - Signed relative value
 * @param baseline - Baseline value to apply change to
 * @returns Resolved absolute value
 */
export function resolveToAbsolute(
  relativeKind: RelativeKind,
  relativeValue: number,
  baseline: number
): number {
  switch (relativeKind) {
    case "percent":
      // "+20%" means baseline * 1.2, "-20%" means baseline * 0.8
      return baseline * (1 + relativeValue / 100);
    case "multiplier":
      // "2x" means baseline * 2
      return baseline * relativeValue;
    case "delta":
      // "+$50k" means baseline + 50000, "-$50k" means baseline - 50000
      return baseline + relativeValue;
  }
}

/**
 * Extract all numeric values from a text string.
 *
 * @param text - Text to extract values from
 * @returns Array of parsed values
 */
export function extractAllNumericValues(text: string): ParsedValue[] {
  const results: ParsedValue[] = [];

  // Split on common delimiters and try to parse each segment
  const segments = text.split(/[,;]|\band\b|\bor\b/i);

  for (const segment of segments) {
    const parsed = parseNumericValue(segment.trim());
    if (parsed) {
      results.push(parsed);
    }
  }

  // Also look for inline values that might not be split.
  // `MAGNITUDE_SUFFIX_ANON` is the capture-group-free spelling of the same
  // alphabet — required here because these patterns are consumed by
  // `String.prototype.match` with /g, which returns whole matches only.
  const inlinePatterns = [
    // Currency values
    new RegExp(`[£$€¥₹]\\s*${AMOUNT_DIGITS}${MAGNITUDE_SUFFIX_ANON}`, "gi"),
    // Percentages
    /\d+(?:\.\d+)?\s*%/g,
  ];

  for (const pattern of inlinePatterns) {
    const matches = text.match(pattern) || [];
    for (const match of matches) {
      const parsed = parseNumericValue(match);
      if (parsed && !results.some((r) => r.originalText === parsed.originalText)) {
        results.push(parsed);
      }
    }
  }

  return results;
}

/**
 * Format a parsed value back to a human-readable string.
 *
 * @param parsed - Parsed value to format
 * @returns Formatted string
 */
export function formatParsedValue(parsed: ParsedValue): string {
  const { value, unit, isRelative, relativeType, relativeDirection } = parsed;

  if (isRelative) {
    const direction = relativeDirection === "decrease" ? "decrease" : "increase";
    if (relativeType === "percent") {
      return `${direction} by ${value}%`;
    } else {
      const prefix = unit && CURRENCY_MAP[unit] ? getCurrencySymbol(unit) : "";
      return `${direction} by ${prefix}${value.toLocaleString()}${unit && !prefix ? ` ${unit}` : ""}`;
    }
  }

  // Absolute value
  if (unit === "percent") {
    return `${value}%`;
  }

  const currencySymbol = unit ? getCurrencySymbol(unit) : "";
  if (currencySymbol) {
    return `${currencySymbol}${value.toLocaleString()}`;
  }

  if (unit) {
    return `${value.toLocaleString()} ${unit}`;
  }

  return value.toLocaleString();
}

/**
 * Get currency symbol from unit code.
 */
function getCurrencySymbol(unit: string): string {
  const reverseMap: Record<string, string> = {
    GBP: "£",
    USD: "$",
    EUR: "€",
    JPY: "¥",
    INR: "₹",
  };
  return reverseMap[unit] || "";
}
