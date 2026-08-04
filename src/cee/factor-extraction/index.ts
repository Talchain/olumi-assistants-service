/**
 * CEE Factor Extraction Module
 *
 * Extracts quantitative factors from natural language briefs.
 * Enables ISL sensitivity, VoI, and tipping point analysis.
 *
 * Supports two extraction modes:
 * - LLM-first (when CEE_LLM_FIRST_EXTRACTION_ENABLED=true): Uses LLM with market context,
 *   with regex as validation/fallback
 * - Regex-only (default): Uses pattern matching for explicit/inferred/range extractions
 *
 * Patterns detected (regex mode):
 * - Currency values: £49, $100, €50
 * - Currency with multipliers: $1 million, £2.5m, €500k, $1B
 * - Percentages: 5%, 3.5%
 * - From-to transitions: "from £49 to £59", "from 3% to 5%"
 * - Increase/decrease language: "increase from 10 to 20"
 */

import { log } from "../../utils/telemetry.js";
import { config } from "../../config/index.js";
import type { ExtractionType } from "../transforms/value-uncertainty-derivation.js";
import type { ResolvedContext, SupportedDomain } from "../../context/index.js";
import { resolveContext } from "../../context/index.js";
import { extractFactorsLLM } from "./llm-extractor.js";
import { mergeFactors, type MergeResult } from "./merge.js";
import {
  AMOUNT_DIGITS,
  isMagnitudeShapedSuffix,
  magnitudeSuffixPattern,
  parseAmountDigits,
  requiredMagnitudeSuffixPattern,
  resolveMagnitude,
} from "../../utils/magnitude-alphabet.js";
import {
  CARDINAL_AMOUNT_SOURCE,
  parseCardinalAmount,
} from "../../utils/cardinal-words.js";

export interface ExtractedFactor {
  /** Human-readable label for the factor */
  label: string;
  /** Current or proposed value */
  value: number;
  /** Baseline value (from "from X to Y" patterns) */
  baseline?: number;
  /** Unit of measurement */
  unit?: string;
  /** Extraction confidence (0-1) */
  confidence: number;
  /** Original text that was matched */
  matchedText: string;
  /** How the value was extracted */
  extractionType: ExtractionType;
  /** For range extractions: minimum bound */
  rangeMin?: number;
  /** For range extractions: maximum bound */
  rangeMax?: number;
}

// Re-export ExtractionType for convenience
export type { ExtractionType } from "../transforms/value-uncertainty-derivation.js";

// Currency symbols and their names
const _CURRENCY_MAP: Record<string, string> = {
  "£": "GBP",
  "$": "USD",
  "€": "EUR",
};

/* ===========================================================================
 * ROADMAP 2.322 — THE ALPHABET NO LONGER LIVES HERE, AND THAT IS THE POINT.
 *
 * #797 and #799 folded three magnitude lists onto one another INSIDE this
 * file. Both times a further copy survived, and the reason was structural
 * rather than careless: the unified list sat behind a 1,500-line extraction
 * module, so `context/resolver.ts`, `utils/reduction-framing.ts` and
 * `cee/compound-goal/extractor.ts` could not reach it without importing the
 * world — and each of them therefore wrote its own. A shared list nobody can
 * import is a shared list that gets copied.
 *
 * The alphabet now lives in `src/utils/magnitude-alphabet.ts`, a leaf with no
 * imports of its own, so every consumer in the service can index the SAME
 * object. This module is now one consumer among several rather than the owner,
 * and the drift guard below proves its patterns are still built from that one
 * alternation.
 *
 * The two symbols are RE-EXPORTED because the drift guard imports them from
 * here, and because a consumer that already reaches this module should not be
 * made to learn a second import path to get the same object.
 * ========================================================================= */

export { MAGNITUDE_MULTIPLIERS, MAGNITUDE_ALTERNATION } from "../../utils/magnitude-alphabet.js";

/* ===========================================================================
 * ROADMAP 2.338 — AND THE *DIGIT* GRAMMAR IS SHARED NOW TOO.
 *
 * Everything above is about the magnitude ALPHABET — the list of suffixes. One
 * layer below it sits the grammar for the digits themselves, and it had drifted
 * exactly the same way, in the same object, unobserved by every guard the
 * alphabet work shipped.
 *
 * MEASURED at `02f7a674`: TEN of the eleven patterns below hand-spelled
 * `\d+(?:\.\d+)?` while this very file imported `AMOUNT_DIGITS` at line 28 and
 * used it in exactly one of them. A hand-spelled digit grammar cannot match a
 * thousands separator, so `"We saved £800,000 last year."` matched only `£800`
 * and published **800** at confidence 0.60 — the identical 1,000× under-read
 * the magnitude rows spent four PRs chasing, arriving through a comma instead
 * of through a suffix, which is why none of their guards could see it.
 *
 * The other failure modes were worse than the one that got reported, and they
 * are recorded in `__tests__/thousands-separator-digit-grammar.test.ts` with
 * the pristine measurement beside each: `"increase from 10,000 to 20,000"`
 * matched NOTHING (the numbers vanished in silence), and
 * `"between 1,000-2,000%"` published **0** from the fragment `000%`.
 *
 * ⚠ THE REPAIR IS TWO-SIDED. Sharing `AMOUNT_DIGITS` makes the pattern MATCH
 * the separator; the consumer must also STRIP it, because
 * `parseFloat("800,000")` is 800 — the same loss through the other door. Every
 * consumer in `extractFactors` now reads its captured amount with
 * `parseAmountDigits`, and a structural guard bans raw `parseFloat` over a
 * captured group from re-entering this file.
 * ========================================================================= */

/**
 * The DIRECTION-VERB stems shared by `changePattern` and the from-to goal
 * grammar (ROADMAP 2.353).
 *
 * Hoisted out of `changePattern`, where it was the only copy, so the goal
 * grammar below reads the SAME alternation rather than writing a second one.
 * The interpolation is byte-identical to the literal it replaced, so
 * `PATTERNS.changePattern.source` — and every `matchedText` in the corpus — is
 * unchanged. One list, two readers: CLAUDE.md trap 12 pre-empted rather than
 * repaired later.
 */
const GOAL_DIRECTION_VERB_STEMS = "increas|decreas|rais|lower|grow|drop|fall|rise";

// Regex patterns for quantitative language
const PATTERNS = {
  // Currency with multiplier: $1 million, £2.5m, €500k, $1B, $1.5 billion
  //
  // ROADMAP 2.316 — the alternation used to be spelled out here as
  // `k|m|b|t|million|billion|trillion`: a THIRD hand-written copy of the
  // alphabet, missing `bn`, so `$5bn` matched nothing and extracted 5. It now
  // shares the ONE alternation, in its REQUIRED spelling (this pattern means
  // "an amount that carries a magnitude"; making the suffix optional would
  // swallow every bare `$100` and promote it to explicit/0.85).
  currencyWithMultiplier: new RegExp(
    `(?<currency>[£$€])(?<amount>${AMOUNT_DIGITS})` + requiredMagnitudeSuffixPattern("multiplier"),
    "gi",
  ),

  // Currency with optional decimals: £49, $100.50, €50, £800,000
  currency: new RegExp(`(?<currency>[£$€])(?<amount>${AMOUNT_DIGITS})`, "g"),

  // Percentage: 5%, 3.5%, 10 percent, 1,200%
  percentage: new RegExp(`(?<amount>${AMOUNT_DIGITS})\\s*(?:%|percent)`, "gi"),

  // From-to with currency: "from £49 to £59", "from £49,000 to £59,000"
  currencyFromTo: new RegExp(
    `from\\s+(?<currency1>[£$€])(?<from>${AMOUNT_DIGITS})\\s+to\\s+(?:[£$€])?(?<to>${AMOUNT_DIGITS})`,
    "gi",
  ),

  // From-to with percentage: "from 3% to 5%"
  percentFromTo: new RegExp(
    `from\\s+(?<from>${AMOUNT_DIGITS})\\s*%?\\s+to\\s+(?:maybe\\s+)?(?<to>${AMOUNT_DIGITS})\\s*%`,
    "gi",
  ),

  // Increase/decrease patterns: "increase from 10 to 20", "increasing by 5%"
  changePattern: new RegExp(
    `(?<direction>${GOAL_DIRECTION_VERB_STEMS})(?:e|ing|ed)?\\s+(?:from\\s+)?` +
      `(?<from>${AMOUNT_DIGITS})\\s*(?:%|[£$€])?\\s+(?:to\\s+)?(?:maybe\\s+)?(?<to>${AMOUNT_DIGITS})`,
    "gi",
  ),

  // Plain numbers with context: "price of 49", "rate of 3.5", "target is 800k"
  //
  // ROADMAP 2.303 — this pattern used to end at `(?<amount>\d+(?:\.\d+)?)`,
  // which read the digits of "target is 800k" and threw the magnitude away.
  // It now shares the module's ONE amount grammar: separators, then the ONE
  // magnitude alphabet, then any REMAINING letters riding on the number —
  // captured, not ignored, so the extractor can refuse by name instead of
  // emitting bare digits for a magnitude it cannot read.
  contextualNumber: new RegExp(
    "(?<context>price|cost|rate|revenue|budget|margin|churn|conversion|growth|target|threshold|limit)" +
      "\\s+(?:of|is|at|was|be)?\\s*(?:[£$€])?" +
      `(?<amount>${AMOUNT_DIGITS})` +
      magnitudeSuffixPattern("mult") +
      "(?<unknownSuffix>[A-Za-z]+)?\\b\\s*(?:%)?",
    "gi",
  ),

  // Approximate values: "around £60", "roughly 50", "approximately $100"
  approximateValue: new RegExp(
    "(?:around|roughly|approximately|about|circa|~)\\s*(?<currency>[£$€])?" +
      `(?<amount>${AMOUNT_DIGITS})\\s*(?<unit>%)?`,
    "gi",
  ),

  // Range with currency: "between £50-70", "£50-£70", "50-70 dollars"
  currencyRange: new RegExp(
    `(?:between\\s+)?(?<currency>[£$€])(?<min>${AMOUNT_DIGITS})\\s*[-–—to]+\\s*(?:[£$€])?` +
      `(?<max>${AMOUNT_DIGITS})`,
    "gi",
  ),

  // Range with percentage: "between 5-10%", "5%-10%"
  percentRange: new RegExp(
    `(?:between\\s+)?(?<min>${AMOUNT_DIGITS})\\s*%?\\s*[-–—to]+\\s*(?<max>${AMOUNT_DIGITS})\\s*%`,
    "gi",
  ),

  // Generic range: "between 50 and 70", "50 to 70"
  genericRange: new RegExp(
    `between\\s+(?<min>${AMOUNT_DIGITS})\\s+(?:and|to)\\s+(?<max>${AMOUNT_DIGITS})`,
    "gi",
  ),
};

/* ---------------------------------------------------------------------------
 * DRIFT-GUARD SURFACE (ROADMAP 2.303).
 *
 * `PATTERNS` and `amountPattern` are module-private and stay that way; these
 * aliases exist ONLY so the drift guard can assert, structurally, that ALL
 * THREE magnitude-bearing patterns are built from the ONE derived alternation.
 * Without them the guard could only test behaviour, and a hand-copied literal
 * that happens to be byte-correct on the day it is written would pass — which
 * is precisely the mirror that later drifts (CLAUDE.md trap 12).
 *
 * ROADMAP 2.316 added `currencyWithMultiplier` to this surface. It is the
 * proof that the behavioural half alone was not enough: the third list passed
 * every behavioural test in the suite for as long as it existed, because the
 * tests only ever exercised the keys the copy happened to contain.
 * ------------------------------------------------------------------------- */
export const PATTERNS_FOR_DRIFT_GUARD: {
  readonly contextualNumber: RegExp;
  readonly currencyWithMultiplier: RegExp;
} = {
  contextualNumber: PATTERNS.contextualNumber,
  currencyWithMultiplier: PATTERNS.currencyWithMultiplier,
};

/**
 * The NAMES of every pattern `extractFactors` runs (ROADMAP 2.316, review).
 *
 * WHY A NAME LIST IS EXPORTED AND NOT JUST THE PATTERNS. The coverage guard in
 * `currency-multiplier-magnitude.test.ts` pins the COMPLETE factor array for a
 * canonical brief per extractor, so that deleting or over-narrowing any
 * extractor REDs. That table is only as good as its completeness — and a table
 * of briefs a human must remember to extend is precisely the hand-maintained
 * mirror this module's whole history is about (CLAUDE.md trap 12).
 *
 * Exporting the name list lets the guard assert its own coverage DERIVED from
 * the pattern set: add a pattern without a canonical brief and the guard REDs
 * immediately, naming the pattern it has no coverage for. The mirror is made to
 * fail loud instead of being trusted to stay in sync.
 */
export const PATTERN_NAMES_FOR_DRIFT_GUARD: readonly string[] = Object.keys(PATTERNS);
export function amountPatternForDriftGuard(prefix: string): string {
  return amountPattern(prefix);
}

/**
 * Every pattern's compiled SOURCE, keyed by name (ROADMAP 2.338).
 *
 * WHY THE SOURCES AND NOT JUST THE NAMES. 2.316's guard surface exposed the two
 * patterns that read a MAGNITUDE, because that was the list under repair. The
 * defect 2.338 closes is one layer down and sits in every pattern at once: the
 * DIGIT grammar. `PATTERNS.currency` hand-spelled `\d+(?:\.\d+)?` beside the
 * canonical `AMOUNT_DIGITS` imported at the top of this file, so `£800,000`
 * matched only `£800` and published a 1,000× under-read at confidence 0.60 —
 * and MEASURED at `02f7a674`, TEN of the eleven patterns carried the same
 * hand-spelled copy. A guard naming two of them could never have seen that.
 *
 * DERIVED from `PATTERNS` itself, so a pattern added tomorrow is inside the
 * guard the instant it lands: there is no list here for anyone to remember to
 * extend, which is the whole of CLAUDE.md trap 12.
 */
export const PATTERN_SOURCES_FOR_DRIFT_GUARD: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(Object.entries(PATTERNS).map(([name, pattern]) => [name, pattern.source])),
);

/* ===========================================================================
 * GOAL-TARGET-WITH-BASELINE (ROADMAP 2.273)
 *
 * THE GAP THESE CLOSE. The from-to extractors above DO capture a `baseline`
 * ("from 85% to 95%" → baseline 0.85), but they are MUTUALLY EXCLUSIVE with
 * the goal redirect: a brief phrased as a target ("from 4000000 to a TARGET of
 * 6000000") is captured by `contextualNumber`, which yields the goal-redirect-
 * eligible label "Target" and NO baseline, while the from-to patterns don't
 * match at all (no currency symbol, no "%", and `changePattern` needs digits
 * immediately after the verb). So the one factor that reaches the goal-
 * threshold mint has never carried a current level, ISL's
 * `delta_threshold = level − baseline + intercept` has no `B`, and it refuses
 * with `missing_goal_baseline`. That absence was pinned deliberately by
 * `goal-baseline-absent-characterisation.test.ts`.
 *
 * THE SAFETY PROPERTY, and why these are single combined patterns rather than
 * two independent scans: BOTH numbers come from ONE regex match, so the
 * current level and the target are about the SAME METRIC by construction. A
 * separate "find any 'currently at N'" scan could pair a baseline from one
 * metric with a target from another and hand ISL two numbers from different
 * scales — arithmetic garbage wearing a confident probability. If no single
 * match states both, NO baseline is produced and ISL keeps refusing honestly.
 *
 * EXTRACTION ONLY. Nothing here infers, defaults, or derives a baseline from a
 * target. A brief that never states its current level yields no baseline —
 * that absence is a coaching moment (elicit the level), never a value to
 * invent.
 * ========================================================================= */

/** Goal/target synonyms that make an extracted label goal-redirect-eligible. */
const GOAL_WORD = '(?:target|goal|objective|threshold)';

/**
 * Connectors that may sit between a goal word and its number — "target IS
 * 800", "target OF 800", "raise the target TO 800", "target: 800". Optional,
 * so a bare "target 800" also matches.
 */
const GOAL_CONNECTOR = '\\s*(?:is|of|to|at|:)?\\s*';

/**
 * A signed-free amount with optional currency prefix, thousands separators,
 * magnitude suffix and percent sign, captured under a caller-chosen prefix so
 * two amounts can coexist in one pattern without named-group collisions.
 *
 * ⚠ L67 — THE AMOUNT NOW READS NUMBER WORDS TOO, and the walk defect this
 * closes is exactly #812's shape one slot over. #812 taught the HORIZON's
 * count slot every duration word; the AMOUNT slot stayed digit-only, so
 * "grow MRR from one hundred and eighty thousand pounds to two hundred and
 * fifty thousand pounds by the end of December 2026" — the live walk brief,
 * runT1b — matched NOTHING and the goal card read "Goal target missing". The
 * words branch is `CARDINAL_AMOUNT_SOURCE`, shared from the leaf module
 * beside the magnitude alphabet (one grammar, every consumer — trap 12), and
 * `resolveAmount` folds it with `parseCardinalAmount`. The digit branch is
 * byte-equivalent to what it replaced, so every digit brief matches
 * identically; the branches cannot race because one opens with a digit and
 * the other with a letter.
 */
function amountPattern(prefix: string): string {
  return (
    `(?<${prefix}Cur>[£$€])?` +
    `(?:(?<${prefix}Words>${CARDINAL_AMOUNT_SOURCE})` +
    `|(?<${prefix}>${AMOUNT_DIGITS})` +
    // ⚠ BOTH `\\b`s ARE LOAD-BEARING, and the absence of the inner one
    // produced a silent 1e12 error in development: without it the `t`
    // alternative matched the "t" of "6000000 THIS year", scaling a 6,000,000
    // target to 6e18 and a 4,000,000 baseline to 5.3e-13 once divided by the
    // resulting cap. Both numbers stayed internally consistent, so nothing
    // failed — it simply produced a confident wrong probability, the exact
    // failure mode this whole train exists to prevent.
    //
    // The OUTER `\\b` closes the amount at a word boundary when NO suffix
    // matched, which is what keeps "800kg" from parsing as 800 with a "kg"
    // metric noun. ROADMAP 2.303 moved the alternation's own `\\s*` inside the
    // optional group (see `magnitudeSuffixPattern`), so this boundary must be
    // spelled here rather than relied on from the group's tail.
    //
    // Alternatives are ordered LONGEST-FIRST — derived, not hand-ordered — so
    // "million" cannot be consumed as a bare "m" nor "bn" as a bare "b".
    `${magnitudeSuffixPattern(`${prefix}Mult`)})\\b\\s*(?<${prefix}Pct>%)?`
  );
}

/**
 * An amount plus its OPTIONAL trailing metric word, CAPTURED — "800k REVENUE",
 * "50 EMPLOYEES", "£6,000,000 WITHIN…" (function words are filtered later by
 * `resolveTrailingMetric`, never here: filtering inside the regex would change
 * what the patterns match, and this wrapper must keep the matchable language
 * of the pre-2.287 grammar byte-identical — the one noun the old CLAUSE_BRIDGE
 * allowance skipped is now captured at the same position instead).
 *
 * Used by the clause-bridge patterns (2 and 3) on BOTH amounts. Pattern 1 does
 * not use it: "from X to a target of Y" is one construction about one metric
 * by design, and widening it to swallow nouns would let "from 50 employees to
 * a target of 800k" start matching — an EXPANSION of the extraction surface
 * this repair has no mandate to make.
 *
 * ⚠ The `\s*` (not `\s+`) before the word is load-bearing: `amountPattern`
 * ends with a greedy `\s*` that has usually consumed the separating space
 * already, and at END-OF-PATTERN position nothing later forces the engine to
 * backtrack into it — so a `\s+` group here would silently NEVER capture the
 * final amount's noun, and probe "Currently at 50 employees, and our target is
 * 800k revenue" would sail through unseen. (Mid-pattern the two spellings are
 * equivalent, because the following connective forces the backtrack.)
 */
function amountWithMetricPattern(prefix: string): string {
  return (
    amountPattern(prefix) +
    `(?:\\s*(?<${prefix}Metric>[A-Za-z][A-Za-z-]{0,19})\\b)?`
  );
}

/**
 * The SAME trailing-metric capture, ZERO-WIDTH (ROADMAP 2.353).
 *
 * WHY A LOOKAHEAD RATHER THAN THE CONSUMING FORM ABOVE. Pattern 1's target sits
 * at end-of-pattern, so consuming its trailing word would extend `m[0]` —
 * measured, it turned the pinned `"from 4000000 to a target of 6000000 "` into
 * `"…6000000 this"` and REDed the #2258 byte-parity guard. The noun is needed
 * for the currency and cross-metric refusals, not for the matched text, so this
 * spelling reads it without moving the match end: byte-parity holds and the
 * guard keeps its meaning instead of being re-baselined around the change.
 *
 * ⚠ USABLE ON A TRAILING AMOUNT ONLY. Mid-pattern the noun must be CONSUMED or
 * whatever follows (`\s+to\s+`) still faces it and the match fails — which is
 * also the property that keeps "from 50 employees to a target of 800k" out of
 * pattern 1 (see the note on that pattern). Zero-width here, consuming there,
 * and the difference is load-bearing in both directions.
 *
 * ⚠⚠ THE OPTIONALITY IS INSIDE THE LOOKAHEAD, AND THE OBVIOUS SPELLING IS A
 * SILENT NO-OP. Writing it as an optional assertion — `(?:(?=…))?` — compiles,
 * matches, and NEVER CAPTURES: ECMAScript's RepeatMatcher discards a
 * zero-repetition-minimum body that consumed nothing (`min === 0 &&
 * y.endIndex === x.endIndex ⇒ failure`), so the group is reset every time and
 * `toMetric` reads `undefined` forever. MEASURED — it turned every
 * mixed-currency refusal below back into a formed pair while the whole file
 * still compiled and 182 other tests stayed green. Spelled as an
 * ALWAYS-SUCCEEDING lookahead wrapping an optional CONSUMING group, the body
 * consumes when it matches, the rule does not fire, and the capture survives.
 * A guard whose input silently reads `undefined` is the exact shape of trap 13.
 */
function trailingMetricLookahead(prefix: string): string {
  return `(?=(?:\\s*(?<${prefix}Metric>[A-Za-z][A-Za-z-]{0,19})\\b)?)`;
}

/**
 * The ONLY bridge permitted between a goal target and its current level when
 * the two sit in separate clauses (patterns 2 and 3).
 *
 * ⚠ THIS REPLACED AN OPEN `[^.?!\n]{0,40}?` WINDOW THAT FABRICATED BASELINES
 * (adversarial review, PR #787). `[^.?!\n]` excludes sentence TERMINATORS but
 * admits `,` and `;`, so the window crossed CLAUSE boundaries and bound a
 * number from an entirely different metric to the goal target:
 *
 *   "Our target is 800k revenue, though headcount is currently at 50"
 *        → baseline 50 (HEADCOUNT) against an 800k REVENUE target
 *   "Marketing is currently 200k; our revenue target is 800k"
 *        → marketing SPEND became the revenue baseline
 *
 * Neither errors. Both produce operands comfortably inside ISL's |1.5| domain
 * guard (threshold 0.8, baseline 0.00005), so ISL converts them and returns a
 * CONFIDENT WRONG PROBABILITY. A magnitude guard cannot catch a provenance
 * error that lands in range — only refusing to form the pair can.
 *
 * THE GRAMMAR IS A CLOSED ALLOW-LIST, and the direction matters: an allow-list
 * fails CLOSED on an unanticipated connective (no baseline → ISL refuses
 * honestly), whereas a block-list of "bad" connectives fails OPEN — the
 * hand-maintained mirror (CLAUDE.md trap 12) in its most dangerous form, where
 * every connective nobody thought of becomes a silent fabrication.
 *
 * Permitted, in order: a connective from the closed set {`,`, ` and`, `, and`},
 * then an optional determiner ("…and OUR objective"). Anything else — a second
 * subject, a concessive ("though"), a semicolon, a colon — does not match, and
 * no baseline is minted.
 *
 * ROADMAP 2.287 — the "at most ONE unit noun" allowance that used to open this
 * bridge ("800 CUSTOMERS, currently…") has MOVED into the amount itself
 * (`amountWithMetricPattern`), where it is CAPTURED rather than skipped. #787
 * closed the window but left the noun unread, so "800k REVENUE, and currently
 * at 50 EMPLOYEES" still paired revenue with headcount — the nouns disagreed
 * and nothing was looking. The matchable language is unchanged (same noun
 * shape, same position); the difference is that the pair-former now SEES both
 * nouns and refuses the pair when they name different metrics.
 */
const CLAUSE_BRIDGE =
  '(?:,|\\s+and|,\\s+and)' + // closed connective set
  '(?:\\s+(?:our|the|my|its))?' + // optional determiner
  '\\s*';

/* ===========================================================================
 * METRIC-PHRASE COMPATIBILITY (ROADMAP 2.287 + 2.288)
 *
 * WHY: `amountPattern` captured the amount but never the metric NOUN beside
 * it, and the pair-former compared nothing — so a target and a "current level"
 * from two different metrics (revenue vs employees; $ vs £) were fused into
 * one (target, baseline) pair. Both operands normalise into ISL's domain, so
 * the result is a CONFIDENT WRONG PROBABILITY, which is strictly worse than a
 * refusal. These helpers give the pair-former eyes: each amount's trailing
 * word is captured, classified, and the pair is REFUSED (with a named reason)
 * when the two amounts carry explicit metric/unit phrases that disagree.
 * ========================================================================= */

/**
 * Function/time words that may legitimately trail an amount without naming a
 * metric — "800 THIS year", "£6,000,000 WITHIN a year", "500 CURRENTLY". A
 * closed set, and the failure direction is the safe one: an unlisted function
 * word gets treated as a metric noun, which can only cause a REFUSAL (the
 * baseline is withheld and ISL refuses honestly), never a fabricated pair.
 * Keep actual metric nouns (revenue, customers, employees…) OUT of this list.
 */
const METRIC_NOUN_STOPWORDS = new Set<string>([
  // determiners / conjunctions / pronouns
  "a", "an", "and", "or", "but", "the", "this", "that", "these", "those",
  "our", "my", "your", "their", "its", "his", "her", "we", "it",
  // auxiliaries / verbs
  "is", "are", "was", "were", "be", "been", "being",
  "will", "would", "can", "could", "should", "may", "might", "must",
  // prepositions
  "in", "on", "at", "by", "for", "of", "to", "from", "per", "with", "within",
  "without", "over", "under", "across", "into", "through", "during", "before",
  "after", "between", "around", "about", "above", "below", "up", "down", "out", "off",
  // temporal
  "now", "today", "tomorrow", "yesterday", "currently", "presently", "soon",
  "already", "still", "again", "then", "than", "when", "while",
  // ⚠ ROADMAP 2.353 (review A4) — THE -ly FORMS ARE NO LONGER LISTED HERE.
  // "annually", "monthly", "weekly", "daily", "yearly", "quarterly" were
  // hand-added entries, and #795 amendment 2 had ALREADY had to add two of them
  // after "6M annual" refused. That is trap 12 caught in the act: the list was
  // short, twice, and the next adverb was always going to be missing. MEASURED
  // at c356531d, still short — "Increase revenue from £4M to 6M EVENTUALLY"
  // refused via currency_vs_metric_noun with target_metric "eventually", losing
  // the 6M entirely; likewise "ultimately", "sustainably", "profitably". They
  // are now recognised by MORPHOLOGY in `isAdverbShaped`, derived not listed.
  "annual", // carries no -ly, so the derived rule does not cover it
  "year", "years", "yr", "yrs", "month", "months", "week", "weeks",
  "day", "days", "quarter", "quarters",
  // quantity/degree qualifiers (they qualify the number, they do not name a metric)
  "most", "more", "less", "least", "only", "just", "each", "every", "all",
  "some", "next", "last", "first", "total", "overall", "combined",
  "minimum", "maximum", "min", "max",
  "roughly", "approximately", "exactly", "ideally", "hopefully", "maybe", "perhaps",
  "if", "so", "as",
]);

/**
 * Currency WORDS fold into the same three-symbol alphabet the amount pattern
 * accepts (`[£$€]`) — "4M dollars" is the same explicit signal as "$4M".
 * Derived from that alphabet, not an open list: a currency this file cannot
 * capture as a symbol is not one it can compare.
 */
const CURRENCY_WORDS: Readonly<Record<string, string>> = {
  dollar: "$", dollars: "$", usd: "$",
  pound: "£", pounds: "£", gbp: "£",
  euro: "€", euros: "€", eur: "€",
};

/**
 * Singular/plural of one noun is one metric: customers ≡ customer,
 * properties ≡ property, branches ≡ branch (#795 review amendment 1 — the
 * first cut stripped only a final "s", so property/properties and
 * branch/branches SAME-noun pairs refused).
 *
 * Folds, in order: `-ies`→`-y`, then `-es` after a sibilant (ch/sh/x/z/ss),
 * then a plain final `-s`. Bare `-ses` is deliberately NOT folded: stripping
 * it would break silent-e plurals that the plain rule already handles
 * ("houses"→"house"), at the price of bus/buses staying a refusal. Anything
 * the fold still misses — irregulars like person/people included — REFUSES,
 * which is the safe direction: a missed fold withholds a baseline, it never
 * fabricates a pair.
 */
function stemMetricNoun(lower: string): string {
  if (lower.length > 4 && lower.endsWith("ies")) {
    return lower.slice(0, -3) + "y";
  }
  if (lower.length > 4 && /(?:ch|sh|x|z|ss)es$/.test(lower)) {
    return lower.slice(0, -2);
  }
  return lower.length > 3 && lower.endsWith("s") && !lower.endsWith("ss")
    ? lower.slice(0, -1)
    : lower;
}

/** The classified metric signal a captured trailing word carries, if any. */
interface TrailingMetric {
  /** Folded currency symbol when the word IS a currency ("dollars" → "$"). */
  readonly currency?: string;
  /** Stemmed metric noun ("employees" → "employee"); never a stopword. */
  readonly noun?: string;
}

/**
 * Is this trailing token an ADVERB rather than a metric noun? (ROADMAP 2.353,
 * review A4.)
 *
 * DERIVED FROM MORPHOLOGY, not from a list. `-ly` is English's adverb suffix,
 * and an adverb trailing an amount qualifies the statement ("6M EVENTUALLY",
 * "6M ANNUALLY", "6M SUSTAINABLY") rather than naming what is measured. The
 * stopword set had to hand-add "annually"/"monthly" once and "quarterly" again
 * a release later; each addition was a confession that the list cannot keep up.
 *
 * ⚠ DISCLOSED IMPRECISION, in the house style: a few genuine NOUNS end in `-ly`
 * — "supply", "assembly", "anomaly" — and this rule reads them as adverbs. The
 * consequence is bounded and one-directional: such a noun stops contributing to
 * a cross-metric REFUSAL, so a pair naming "supply" on one side and a currency
 * on the other now extracts where it previously refused. It cannot invent a
 * number, change a magnitude, or pair across clauses. Pinned BOTH ways in
 * goal-natural-language-targets.test.ts so the cost stays visible.
 *
 * The `length > 3` floor keeps "ly" and "fly" out of the rule.
 */
function isAdverbShaped(lower: string): boolean {
  return lower.length > 3 && lower.endsWith("ly");
}

function resolveTrailingMetric(
  groups: Record<string, string | undefined>,
  prefix: string,
): TrailingMetric {
  const word = groups[`${prefix}Metric`];
  if (!word) return {};
  const lower = word.toLowerCase();
  if (METRIC_NOUN_STOPWORDS.has(lower)) return {};
  if (isAdverbShaped(lower)) return {};
  const currency = CURRENCY_WORDS[lower];
  if (currency) return { currency };
  return { noun: stemMetricNoun(lower) };
}

/** The named refusal reasons for a goal (target, baseline) pair. */
type GoalPairRefusalReason =
  | "mixed_percent_pair"
  | "currency_mismatch"
  | "metric_noun_mismatch"
  | "currency_vs_metric_noun"
  | "direction_unsupported";

/**
 * What the goal grammar concluded about a brief: it stated a pair, it stated
 * one and we REFUSED it by name, or it stated no such pair at all.
 *
 * ⚠ ROADMAP 2.353 — THE THIRD CASE USED TO BE INDISTINGUISHABLE FROM THE
 * SECOND, AND THAT MADE THE REFUSALS DECORATIVE. Both collapsed to `null`, so
 * `extractFactors` could not tell "no goal stated here" from "a goal was
 * stated and its two currencies disagree" — and on the refusal path it went on
 * to let `contextualNumber` mint the very same target anyway, baseline-less and
 * unit-less. MEASURED: "Grow revenue from £4M to a target of 6M dollars"
 * refused the pair and STILL reached the wire with `goal_threshold` 0.8 and
 * `goal_threshold_unit` "count". A refusal that the next extractor quietly
 * overrides is the guarantee-theatre this estate is named for.
 */
type GoalPairResolution =
  | {
      readonly kind: "pair";
      readonly pair: GoalTargetWithBaseline;
      /**
       * Half-open [start, end) of the matched construction in the brief.
       *
       * ⚠ REPLACES A VALUE COMPARISON (review A3, trap 19 in source). The
       * goal-word suppression used to bind by VALUE EQUALITY, so any OTHER
       * goal-word number that happened to share the target's value was
       * collateral: MEASURED, "…to £6 million within 12 months. Alert threshold
       * is 6 million." lost the alert threshold entirely. An assertion — or a
       * suppression — must bind to its object by IDENTITY, and here identity is
       * position: only a match that OVERLAPS the construction the goal grammar
       * resolved is the same statement.
       */
      readonly span: readonly [number, number];
    }
  | {
      readonly kind: "refused";
      readonly reason: GoalPairRefusalReason;
      /**
       * The target the refused pair WOULD have carried, in this file's
       * normalised convention. Carried so the suppression below can be scoped
       * to that one number instead of to the whole brief — see the note there.
       */
      readonly targetValue: number;
      /** Half-open [start, end) of the refused construction — see `span`. */
      readonly span: readonly [number, number];
    };

/**
 * Refuse the pair, BY NAME. Refusal is honest: no baseline is minted, ISL
 * refuses with `missing_goal_baseline`, and the user is asked for the level —
 * instead of being served arithmetic across two different metrics.
 */
function refuseGoalPair(
  reason: GoalPairRefusalReason,
  detail: Record<string, string | undefined>,
  targetValue: number,
  span: readonly [number, number],
): GoalPairResolution {
  log.info(
    { event: "cee.factor_extraction.goal_pair_refused", reason, ...detail },
    `Goal target/baseline pair refused: ${reason}`,
  );
  return { kind: "refused", reason, targetValue, span };
}

/* ===========================================================================
 * THE ORDINARY FROM-TO GOAL (ROADMAP 2.353, absorbing 2.343)
 *
 * WHAT WAS BROKEN. Every shape below was a plain English goal that lost its
 * target, and the three grammars above could not see any of them:
 *
 *   "Increase annual revenue from £4 million today to £6 million within 12
 *    months"  — pattern 1 needs `to` to follow the baseline IMMEDIATELY, and
 *    then needs a GOAL WORD after it. Neither holds.
 *   "Raise the target from £600,000 to £800,000"
 *               — same second reason: `£800,000` is not a goal word.
 *
 * ⚠ THE REPORTED CAUSE FOR THE FIRST WAS THE NOW-QUALIFIER ("`today` sits
 * between the baseline and `to`"), AND THAT WAS MEASURED WRONG. Removing
 * "today" from the brief changes nothing: `extractGoalTargetWithBaseline` still
 * returns null and the goal still reaches the wire with `{}`. The qualifier is
 * a second blocker; the CAUSE is that no pattern accepted a from-to goal
 * without a goal word after `to`. A repair aimed only at the qualifier would
 * have moved nothing, which is why the no-qualifier case is pinned as a
 * permanent control beside the reported one.
 *
 * ⚠ AND THE SECOND WAS ATTRIBUTED TO `inferLabel` RETURNING "Revenue". Also
 * measured wrong, and more generally wrong than it looks: `inferLabel` carries
 * NO target/goal pattern at all, so the label is whatever the surrounding prose
 * suggests — "Revenue" when the word happens to fall in the preceding 50
 * characters, "Value" for the bare phrasing. Neither satisfies
 * `isTargetGoalLabel`, so the value+baseline the from-to extractor DID produce
 * rode on a plain factor and never reached the goal. The fix is not to teach
 * `inferLabel` about targets — that would widen every extractor at once — but
 * to let the shape form a PAIR here, which forces `GOAL_TARGET_LABEL` and
 * routes it to the mint by construction.
 *
 * WHY THIS IS A FOURTH PATTERN AND NOT A LOOSENING OF PATTERN 1. Making the
 * goal word optional in pattern 1 would turn EVERY "from X to Y" in any brief
 * into a goal target. The goal-ness has to come from somewhere, so it comes
 * from the sentence's own verb and its metric — the two things that make
 * "increase annual revenue from … to …" a goal and leave "prices moved from £49
 * to £59" a plain change.
 * ========================================================================= */

/**
 * A now-qualifier may sit between the baseline and its `to` — "£4 million
 * TODAY to £6 million". Closed, and function words only.
 *
 * Single words are largely redundant with `METRIC_NOUN_STOPWORDS` (which the
 * amount's trailing-noun capture already filters), and are listed anyway so the
 * grammar is readable without cross-referencing a stopword set. The MULTI-WORD
 * forms are the ones that genuinely need it: the trailing-noun capture reads at
 * most one word, so "at present" would otherwise leave "present" blocking the
 * `to`. Failure direction is the safe one — an unlisted qualifier means no
 * match, no pair, and ISL refuses honestly.
 */
const NOW_QUALIFIER =
  '(?:as\\s+of\\s+today|at\\s+the\\s+moment|at\\s+present|right\\s+now|' +
  'currently|presently|today|now)';

/**
 * SPELLED DURATIONS — ONE MAP, AND ITS VALUES ARE WHAT MAKE IT CHECKABLE.
 *
 * The three spelled-duration branches of `HORIZON` each carried their own
 * hand-typed alternation — `one|two|three|four|six|nine|twelve` — and all three
 * were SHORT THE SAME FIVE WORDS: five, seven, eight, ten, eleven. "Increase
 * annual revenue from £4 million to £6 million within FIVE months" carried no
 * anchor, so it minted nothing at all (measured at `a6f52ac6`). Three copies of
 * one list, drifting together, is CLAUDE.md trap 12 in its plainest form.
 *
 * ⚠ AND DERIVING THE ALTERNATION FROM A MAP IS ONLY HALF THE ANSWER (trap 12d).
 * A guard that iterates this map proves every key it HAS resolves; it is
 * structurally blind to the map being SHORT — which is exactly how `thousand`
 * went missing from the magnitude alphabet under a green derived guard.
 *
 * So the values are not decoration. They make the list's COMPLETENESS an
 * assertable property rather than a matter of counting by eye: the spec pins
 * that the values are exactly the contiguous run 1…12, which REDs on a deleted
 * key where iterating the keys never could. That is the completeness half 12d
 * says a derivation can never supply, obtained here without a second copy of
 * the list — and the hand-written corpus beside it is the third check, the one
 * that would notice the RANGE itself is wrong.
 *
 * Twelve is the ceiling because the units are day/week/month/quarter/year: a
 * horizon beyond "twelve months" is spoken in the next unit up ("two years"),
 * and the digit branch (`\d+`) covers anything a user writes numerically.
 */
export const DURATION_NUMBER_WORDS: Readonly<Record<string, number>> = Object.freeze({
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
});

/**
 * The alternation the grammar reads, DERIVED from the map above so a word added
 * there is live in all three branches the instant it lands.
 *
 * Sorted LONGEST-FIRST: regex alternation is first-match, not longest-match, so
 * a word that prefixes another would otherwise shadow it. Nothing in the
 * current set collides, and the sort means nothing added later can.
 */
const DURATION_NUMBER_WORD_ALTERNATION = Object.keys(DURATION_NUMBER_WORDS)
  .sort((a, b) => b.length - a.length || a.localeCompare(b))
  .join('|');

/**
 * The count slot every spelled-duration branch shares: "12", "a", "an",
 * "eleven".
 *
 * ⚠ TWO SMALL DELIBERATE CHANGES, both disclosed because "de-duplication"
 * is where capability quietly leaks:
 *
 *   · `over the next` gains "an", which the other two branches already had.
 *     Unreachable in practice (below), and unifying the three was the point.
 *   · "an" is DEAD VOCABULARY in all three branches and is preserved anyway.
 *     `DURATION_UNIT` is day/week/month/quarter/year, none of them
 *     vowel-initial, so no sentence can reach it. Deleting dead vocabulary is
 *     a separate decision from closing a live gap, and this slice is the
 *     latter. Pinned as a finding in the spec rather than silently tidied.
 */
const DURATION_COUNT = `(?:\\d+|an?|${DURATION_NUMBER_WORD_ALTERNATION})`;

/** The unit slot every spelled-duration branch shares. */
const DURATION_UNIT = '(?:day|week|month|quarter|year)s?';

/**
 * Month spellings, abbreviations included. Closed and case-insensitive (the
 * pattern compiles with `i`), so only the lower-case forms are spelled.
 */
const MONTH_NAME =
  '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|' +
  'aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

/**
 * AN ORDINARY CALENDAR DATE, AS A BOUNDED SET OF SHAPES — NOT A DATE PARSER.
 *
 * ⚠ THIS IS THE DEFECT CODEX HIT LIVE, IN BOTH BRIEFS IT TRIED:
 *
 *   "Grow MRR from £180k to £250k by 31 Dec 2026"   -> no pair, no target
 *   "Grow ARR from £4.2m to £6m by 30 June 2027"    -> no pair, no target
 *
 * The `by` branch accepted a broad period ("by year end"), a half or a quarter,
 * or a BARE FOUR-DIGIT YEAR — and nothing else. A calendar date is the single
 * most ordinary way a person writes a deadline, and because the horizon is a
 * GOAL ANCHOR (#807/#809) rather than decoration, a brief that carried one was
 * not merely losing its date: it was losing its TARGET, and being asked to
 * supply the number it had already typed.
 *
 * ⚠ WHAT THIS DELIBERATELY IS NOT: a general date parser, a locale library, or
 * a validity check. Nothing downstream READS the horizon — `isGoalAnchored`
 * only asks whether one is PRESENT — so parsing it would be machinery with no
 * consumer, and rejecting "31 Feb 2026" would cost a user their target over a
 * typo the anchor does not depend on. The shapes below are the ones people
 * write, bounded to four-digit years so a bare "12/26" cannot pass as one.
 *
 * ORDER MATTERS: the full forms precede the month-year form, and the whole set
 * precedes the bare `\d{4}` alternative in the `by` branch, so "2026-12-31"
 * matches as a date rather than leaving "-12-31" trailing behind a bare year.
 */
const CALENDAR_DATE =
  '(?:' +
  // ISO, the form a machine writes: 2026-12-31
  '\\d{4}-\\d{2}-\\d{2}' +
  // All-numeric, day first or month first — the shape is identical either way
  // and nothing reads the parts, so no locale question arises: 31/12/2026
  '|\\d{1,2}[/-]\\d{1,2}[/-]\\d{4}' +
  // Day month year: "31 Dec 2026", "31st December 2026", "30 June 2027"
  `|\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH_NAME}\\.?,?\\s+\\d{4}` +
  // Month day year: "Dec 31, 2026", "December 31 2026"
  `|${MONTH_NAME}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}` +
  // Month year, LAST of the three so it cannot steal a day-bearing form:
  // "June 2027", "Dec 2026"
  `|${MONTH_NAME}\\.?\\s+\\d{4}` +
  ')';

/**
 * THE GOAL ANCHOR (ROADMAP 2.353, review A1 — a CONFIRMED blocker).
 *
 * ⚠ THE FIRST CUT OF PATTERN 4 WAS TOO BROAD, AND THE BREADTH WAS INVISIBLE TO
 * EVERY TEST IT SHIPPED WITH. Its gate was "a direction verb plus a metric
 * phrase", which is the shape of a LEVER as much as of a goal. MEASURED at
 * `c356531d`, on a graph whose goal is "Grow annual revenue":
 *
 *   "We could increase the price from £49 to £59"   -> goal_threshold 0.8,
 *        raw 59, unit £, cap 73.75 stamped on the REVENUE goal
 *   "increasing ad spend from £200k to £300k"        -> raw 300,000
 *   "Drop the price from £49 to £39"                 -> raw 39, baseline 49,
 *        i.e. goal_baseline 1.005 — a baseline ABOVE its own cap
 *   "Lower the cost from £200 to £150"               -> raw 150, baseline 1.067
 *
 * At pristine every one of these minted NOTHING. An honest absence was replaced
 * by a confident wrong number, which is the trade this whole file exists to
 * refuse. Worse, `exec` returns the FIRST match, so a lever sentence STOLE the
 * pair from a genuine goal later in the same brief.
 *
 * WHAT ACTUALLY DISTINGUISHES A GOAL FROM A LEVER, given both are "verb +
 * metric + from + to": the goal names itself, either by a GOAL WORD ("raise the
 * TARGET from…") or by a HORIZON ("…to £6 million WITHIN 12 MONTHS"). A lever
 * sentence has neither — it describes a move, not a commitment. So pattern 4
 * now requires one of the two, and the failure direction is the honest one: an
 * unanchored from-to yields no pair, ISL is not asked, and the user is not
 * served a number they did not commit to.
 *
 * ⚠ AND THIS RETRACTS THIS LANE'S OWN EARLIER SCOPING CALL. The first commit
 * argued "THE HORIZON NEEDS NO GRAMMAR" because it sits after the final amount
 * and nothing has to consume it. That was true about MATCHING and wrong about
 * MEANING: the horizon is not decoration, it is half of what makes the sentence
 * a goal. It needed grammar for exactly the reason the note dismissed it.
 *
 * The spellings below are a closed hand-written set, like NOW_QUALIFIER, and
 * the same justification applies: an unlisted horizon means NO pair, never a
 * fabricated one.
 *
 * ⚠ AND "NEVER A FABRICATED ONE" IS WHY THIS SET BEING SHORT WAS STILL
 * EXPENSIVE. The failure direction is safe but it is not free: an unlisted
 * horizon costs the user the target THEY TYPED, and CEE then asks them for it.
 * Two whole classes were missing at `a6f52ac6` — ordinary calendar dates, and
 * five of the twelve number words — and Codex hit the first of them on both of
 * the two briefs it wrote. Widening HERE is the safe direction of widening:
 * `isProposalFramed` and the direction/comparability refusals are downstream
 * and untouched, so a wider anchor admits more GOALS without admitting a single
 * lever the guards would otherwise have caught.
 */
const HORIZON =
  '(?:' +
  `within\\s+(?:the\\s+)?(?:next\\s+)?${DURATION_COUNT}\\s*${DURATION_UNIT}` +
  `|over\\s+the\\s+next\\s+${DURATION_COUNT}\\s*${DURATION_UNIT}` +
  `|in\\s+(?:the\\s+)?(?:next\\s+)?${DURATION_COUNT}\\s*${DURATION_UNIT}` +
  // A dated deadline. `CALENDAR_DATE` precedes the bare-year alternative so a
  // full date is read whole rather than truncated to its year.
  '|by\\s+(?:the\\s+end\\s+of\\s+)?(?:this|next|the)?\\s*' +
  `(?:${CALENDAR_DATE}|year|quarter|month|week|h[12]|q[1-4]|\\d{4})(?:[-\\s]end)?` +
  '|(?:this|next)\\s+(?:year|quarter|month|week)' +
  '|year[-\\s]end' +
  // VAGUE horizons. "Increase revenue from £4M to 6M EVENTUALLY" commits to a
  // target over time without naming a date, which is still a commitment and
  // still not a lever — review A4's pinned brief. They earn their place in the
  // anchor for the same reason the dated forms do: a lever sentence does not
  // carry them.
  '|eventually|ultimately|over\\s+time|in\\s+due\\s+course|in\\s+the\\s+long\\s+run' +
  '|long[-\\s]term' +
  ')';

/* ---------------------------------------------------------------------------
 * PROPOSAL FRAMING (ROADMAP 2.371(b)) — THE OPTIONALITY GUARD, WIDENED IN BOTH
 * DIMENSIONS IT WAS SHORT IN.
 *
 * #807 shipped `OPTIONALITY_MODAL = '(?:could|might|may|can|perhaps|maybe)'`,
 * consumed as a LOOKBEHIND IMMEDIATELY BEFORE THE DIRECTION VERB. Both halves
 * were too narrow, and the second was the bigger hole:
 *
 *   VOCABULARY — six spellings, all of them single modals.
 *   POSITION   — the marker had to be the token touching the verb. So the
 *                guard fired on "we COULD increase…" and missed "we could
 *                CONSIDER increasing…", where the very same word sits one token
 *                further left.
 *
 * MEASURED at `7bdf30ff`, on a graph whose goal is "Grow annual revenue" —
 * 22 of 25 probed lever phrasings minted `{value: 59, baseline: 49, unit: '£'}`
 * at confidence 0.95, i.e. a fabricated goal contract from a sentence proposing
 * a PRICE MOVE. Among them, all six carrying a LISTED modal:
 *
 *   "We could consider increasing the price from £49 to £59 this year"
 *   "We can also increase the price from £49 to £59 this year"
 *   "We may want to increase the price from £49 to £59 this year"
 *   "Perhaps we increase the price from £49 to £59 this year"
 *   "Maybe we increase the price from £49 to £59 this year"
 *   "We could raise it by 2.5x and increase the price from £49 to £59 this year"
 *
 * The three that DID refuse were exactly the three whose modal touched the
 * verb. So the closed list was not the whole defect — the ADJACENCY was.
 *
 * THE FIX IS ONE MECHANISM, NOT TWO: the lookbehind is withdrawn from the
 * pattern and replaced by a clause-scoped scan (`isProposalFramed`). Keeping
 * both would be a hand-maintained mirror of the kind CLAUDE.md trap 12 is
 * about — two places that must agree about what optionality is.
 * ------------------------------------------------------------------------- */

/**
 * THE CANONICAL SET. Every consumer derives from THIS array; nothing re-spells
 * it (12d, first half). Its other half is `LEVER_CORPUS` in
 * goal-natural-language-targets.test.ts — a hand-written corpus of real lever
 * phrasings, which is the only thing that can notice this list is SHORT, and
 * which no derivation can ever replace.
 *
 * ⚠ THE INCLUSION RULE, so a later addition is a judgement and not a reflex:
 * a marker belongs here when it says the speaker is WEIGHING the move, and
 * stays out when it says they have DECIDED on it. That is why the deontic and
 * volitional forms are absent and stay absent — "will", "shall", "should",
 * "must", "need to", "aim to", "plan to", "intend to", "want to", "going to",
 * "committed to". "We should increase revenue from £4M to £6M within 12
 * months" is a goal, and #807's note saying so is preserved deliberately; the
 * pinned controls below it are what stop this list swallowing them.
 *
 * ⚠ AND THE INTERROGATIVE FORMS ARE PHRASES, NOT BARE MODALS, FOR EXACTLY THAT
 * REASON. "Should we increase the price…?" is a proposal; "We should increase
 * revenue…" is a commitment. The distinguishing signal is the subject-verb
 * INVERSION, so `should we` / `shall we` are listed and bare `should` /
 * `shall` are not.
 *
 * Failure direction, as everywhere else in this grammar: an over-broad marker
 * costs a goal that is then honestly absent and re-askable; a missing one
 * costs a FABRICATED number wearing a 0.95 badge. The two are not symmetric,
 * and this list is sized accordingly.
 */
export const PROPOSAL_FRAME_MARKERS: readonly string[] = Object.freeze([
  // (1) EPISTEMIC MODALS AND THEIR ADVERB SIBLINGS — the speaker is not
  //     committing. The first six are #807's closed list, preserved verbatim;
  //     the union assertion in the spec pins that they can never be lost.
  'could',
  'might',
  'may',
  'can',
  'perhaps',
  'maybe',
  'would',
  'possibly',
  'potentially',
  'conceivably',
  'hypothetically',
  // (2) DELIBERATION VERBS — naming the act of weighing an option.
  'consider',
  'considers',
  'considering',
  'considered',
  'consideration',
  'weigh',
  'weighing',
  'explore',
  'exploring',
  'evaluate',
  'evaluating',
  'assess',
  'assessing',
  'contemplate',
  'contemplating',
  'debate',
  'debating',
  'deliberating',
  'mull',
  'mulling',
  'thinking of',
  'thinking about',
  'looking at',
  'looking into',
  'toying with',
  'tempted',
  'entertaining',
  // (3) PROPOSAL NOUNS AND HYPOTHETICAL FRAMES — the sentence presents a
  //     candidate rather than a plan.
  'option',
  'options',
  'optionality',
  'alternative',
  'alternatives',
  'proposal',
  'proposals',
  'proposed',
  'proposes',
  'proposition',
  'scenario',
  'scenarios',
  'possibility',
  'possibilities',
  'suggestion',
  'suggest',
  'suggests',
  'suggested',
  'what if',
  'suppose',
  'supposing',
  'if we',
  'should we',
  'shall we',
  'could we',
  'can we',
  'may we',
  'might we',
  'were we to',
]);

/**
 * The alternation the guard actually runs, DERIVED from the canonical array so
 * the two cannot drift. Multi-word markers admit any run of whitespace, so a
 * line break inside "thinking\nof" reads the same as a space.
 */
const PROPOSAL_FRAME_PATTERN = new RegExp(
  `\\b(?:${PROPOSAL_FRAME_MARKERS.map((m) => m.replace(/ /g, '\\s+')).join('|')})\\b`,
  'i',
);

/**
 * The text a proposal marker has to appear in to disarm a match: the CLAUSE the
 * construction sits in, from the last sentence boundary up to the direction
 * verb.
 *
 * ⚠ CLAUSE-SCOPED, NOT BRIEF-SCOPED, AND THAT BOUND IS LOAD-BEARING. Scanning
 * the whole preceding brief would re-create by a different route the exact
 * defect review A1 removed: "We could increase the price from £49 to £59.
 * Increase annual revenue from £4 million today to £6 million within 12
 * months." must still yield 6M/4M, and it only does because the `could` is on
 * the other side of a boundary. Pinned.
 *
 * ⚠ A NEWLINE IS A BOUNDARY, and that is not a stylistic choice. Briefs arrive
 * as bulleted lists; a "we could…" on line 1 must not silently delete a goal on
 * line 5.
 *
 * ⚠ A FULL STOP COUNTS ONLY WHEN IT ENDS A SENTENCE — followed by whitespace or
 * by nothing. A decimal point does NOT, and the direction of that error is why
 * the check exists: treating "2.5" as a boundary SHORTENS the scope, drops the
 * marker, and mints the fabricated pair. Measured at `7bdf30ff`: "We could
 * raise it by 2.5x and increase the price from £49 to £59 this year" → 59/49.
 */
function clauseBefore(text: string, index: number): string {
  for (let i = index - 1; i >= 0; i -= 1) {
    const ch = text[i];
    if (ch === '\n' || ch === ';') return text.slice(i + 1, index);
    if (ch === '.' || ch === '!' || ch === '?') {
      const next = text[i + 1];
      if (next === undefined || /\s/.test(next)) return text.slice(i + 1, index);
    }
  }
  return text.slice(0, index);
}

/**
 * Is this match framed as a PROPOSAL rather than a commitment? (ROADMAP
 * 2.371(b).)
 *
 * ⚠ THE REMIT IS FRAMING, AND THE BOUNDARY IS DISCLOSED RATHER THAN IMPLIED.
 * This guard reads how the sentence is put, not what its metric means, so a
 * DECIDED statement about a lever metric — "We plan to increase the price from
 * £49 to £59 this year" — is out of remit and still forms a pair. Separating a
 * lever metric from a goal metric is a different capability (it needs the
 * graph, not the sentence) and is REPORTED OUT OF THIS SLICE, not rowed by it —
 * see this PR's residual list; pinned here as a known
 * cost so it is visible rather than discovered.
 */
function isProposalFramed(text: string, matchIndex: number): boolean {
  return PROPOSAL_FRAME_PATTERN.test(clauseBefore(text, matchIndex));
}

/**
 * The metric a goal verb names before its `from` — "increase ANNUAL REVENUE
 * from …", "raise THE TARGET from …", "grow REVENUE from …".
 *
 * ⚠ AT LEAST ONE WORD IS REQUIRED, AND THAT IS THE SCOPING DECISION OF THIS
 * WHOLE ROW. "We will increase from 10 to 20" names no metric; it is a change,
 * not a goal, and it must keep flowing through `changePattern` as a plain
 * factor rather than minting a goal threshold out of two bare numbers. Making
 * the phrase optional would have swallowed it — and its complete-array pin in
 * `currency-multiplier-magnitude.test.ts` is what says so out loud.
 *
 * ⚠ AND IT IS A CLOSED BRIDGE, NOT A CHARACTER WINDOW. #787 deleted an
 * `[^.?!\n]{0,40}?` window from between two amounts because it admitted `,` and
 * `;` and therefore crossed CLAUSE boundaries, binding a number from a
 * different metric to the goal target. This bridge admits letters and hyphens
 * only, three words at most, so it cannot span a comma, a semicolon or a full
 * stop. Note also that the risk here is structurally smaller than the one that
 * bridge carried: BOTH amounts still come from the single `from … to …`
 * construction, so a wrong bridge could only mislabel a factor, never pair two
 * numbers from different clauses.
 */
const GOAL_METRIC_PHRASE =
  '(?<metricPhrase>' +
  '(?:\\s+(?:the|our|my|its|their|a|an))?' + // optional determiner
  '(?:\\s+[A-Za-z][A-Za-z-]{0,19}){1,3}' + // 1-3 plain words, no punctuation
  ')'

/**
 * The four brief shapes that state a current level AND a target together.
 * Order is priority order; the first match for a given (label, value, unit)
 * wins and later extractors dedup against it.
 */
interface GoalBaselinePattern {
  readonly pattern: RegExp;
  /**
   * When true the scan considers EVERY match in the brief and skips those that
   * carry no goal anchor, so a lever sentence cannot consume the one `exec`
   * result and hide a genuine goal behind it (review A1, measured).
   */
  readonly goalAnchored: boolean;
}

const GOAL_BASELINE_PATTERNS: ReadonlyArray<GoalBaselinePattern> = [
  // "from 4000000 to a target of 6000000", "from 85% to a target of 95%".
  // No bridge needed: both amounts are inside ONE "from … to … target"
  // construction, so they cannot belong to different clauses.
  //
  // ⚠ ROADMAP 2.353 — THE TARGET NOW CAPTURES ITS TRAILING NOUN, AND THE
  // ASYMMETRY WITH THE BASELINE IS DELIBERATE.
  //
  // MEASURED at `210c0ff`: "Grow revenue from £4M to a target of 6M dollars"
  // returned `{value: 6000000, baseline: 4000000, unit: '£'}` — a DOLLAR target
  // served as a POUND figure at confidence 0.95, under a real model card. The
  // 2.288 currency-mismatch refusal was already in place and could not fire,
  // because the bare `amountPattern` stops before "dollars" and the signal it
  // compares was never captured. A guard that cannot see its input is not a
  // guard.
  //
  // The `to` side is safe to widen because the group is OPTIONAL and sits at
  // END OF PATTERN: it cannot change which strings match, only how much of the
  // tail `m[0]` reports and which nouns `resolveTrailingMetric` gets to see.
  //
  // The `from` side is deliberately NOT widened, and the original note is worth
  // keeping sharp about WHY: mid-pattern the group is followed by `\s+to\s+`,
  // so admitting a noun there would let "from 50 employees to a target of 800k"
  // START matching — and with a noun on ONE side only, no refusal fires and the
  // pair FORMS. That is 800k against 50 employees, in range, wearing a
  // confident probability. Pinned in goal-natural-language-targets.test.ts so a
  // later "symmetry" tidy-up cannot land it quietly.
  {
    goalAnchored: false,
    pattern: new RegExp(
      `\\bfrom\\s+${amountPattern('from')}\\s+to\\s+(?:a|an|the)?\\s*` +
        `${GOAL_WORD}\\s*(?:of|is|:)?\\s*${amountPattern('to')}${trailingMetricLookahead('to')}`,
      'i',
    ),
  },
  // "target is 800 customers, currently at 500" — both amounts capture their
  // trailing metric word (2.287), so cross-metric pairs can be REFUSED.
  {
    goalAnchored: false,
    pattern: new RegExp(
      `\\b${GOAL_WORD}${GOAL_CONNECTOR}${amountWithMetricPattern('to')}` +
        `${CLAUSE_BRIDGE}\\bcurrently\\s*(?:at|around|about)?\\s*${amountWithMetricPattern('from')}`,
      'i',
    ),
  },
  // "currently at 500, target 800"
  {
    goalAnchored: false,
    pattern: new RegExp(
      `\\bcurrently\\s*(?:at|around|about)?\\s*${amountWithMetricPattern('from')}` +
        `${CLAUSE_BRIDGE}\\b${GOAL_WORD}${GOAL_CONNECTOR}${amountWithMetricPattern('to')}`,
      'i',
    ),
  },
  // ROADMAP 2.353 — "Increase annual revenue from £4 million today to £6
  // million within 12 months"; "Raise the target from £600,000 to £800,000".
  //
  // Last in priority so patterns 1-3 keep theirs: where both match, the more
  // specific construction wins, and a REFUSAL from an earlier pattern is
  // terminal (`refuseGoalPair` returns out of the scan), so widening the
  // grammar can never route around a refusal that already fired.
  //
  // BOTH amounts carry the trailing-metric capture, so the cross-metric and
  // cross-currency refusals apply to this shape exactly as they do to patterns
  // 2 and 3 — the widening arrives with the guards already attached.
  //
  // THE GOAL ANCHOR (review A1) is `goalAnchored: true` below plus the two
  // optional captures this pattern exposes for it: `goalWord` after `to`,
  // `metricPhrase` before `from` (case B's goal word lives THERE — "raise the
  // TARGET from…" — so the anchor must read both positions), and `horizon`
  // after the target. `resolveGoalPair` requires at least one.
  //
  // ⚠ ROADMAP 2.371(b) — THE OPTIONALITY LOOKBEHIND THAT USED TO OPEN THIS
  // PATTERN IS GONE ON PURPOSE. It could only see the ONE token touching the
  // verb, so "we could CONSIDER increasing…" walked straight past it. Its
  // replacement is `isProposalFramed`, applied in `goalPatternMatches` beside
  // the anchor check, which reads the whole clause. One mechanism, not two.
  {
    goalAnchored: true,
    pattern: new RegExp(
      `\\b(?:${GOAL_DIRECTION_VERB_STEMS})(?:e|es|ing|ed)?\\b` +
        `${GOAL_METRIC_PHRASE}` +
        `\\s+from\\s+${amountWithMetricPattern('from')}(?:\\s+${NOW_QUALIFIER})?` +
        `\\s+to\\s+(?:a|an|the)?\\s*(?:(?<goalWord>${GOAL_WORD})\\s*(?:of|is|:)?\\s*)?` +
        `${amountPattern('to')}` +
        // ⚠ L67 — THE TARGET'S TRAILING WORD IS CONSUMED HERE, NOT PEEKED AT,
        // AND THE DIFFERENCE WAS A LIVE TARGET LOSS. The zero-width
        // `trailingMetricLookahead` is right for pattern 1, whose target ENDS
        // the pattern; here the HORIZON slot follows, so an unconsumed word
        // ("…250 thousand POUNDS by the end of December 2026", or the digit
        // form "…£250,000 REVENUE by 31 December 2026") sat in front of the
        // horizon, the horizon never matched, and `isGoalAnchored` skipped the
        // match as a lever — measured at 959a953f, both forms minted NOTHING.
        // The `(?!HORIZON)` guard is the same one the adverb slot below uses:
        // a token that OPENS a horizon ("by", "within", "this", "eventually")
        // is never eaten, so every pinned horizon-anchored control keeps its
        // exact bytes, while a genuine metric/currency word is consumed and
        // still reaches `resolveTrailingMetric` for the cross-metric and
        // cross-currency refusals.
        `(?:\\s*(?!${HORIZON}\\b)(?<toMetric>[A-Za-z][A-Za-z-]{0,19})\\b)?` +
        // An optional MANNER adverb may sit between the target and its horizon
        // ("…to 6M SUSTAINABLY within 12 months"). The negative lookahead stops
        // this slot swallowing a token that is itself a horizon — without it,
        // "…to 6M eventually" is consumed here and the anchor never sees it,
        // which is precisely how review A4's brief kept failing after the -ly
        // rule landed. Derived from the same `-ly` morphology as
        // `isAdverbShaped`, so the two cannot disagree about what an adverb is.
        `(?:\\s*(?!${HORIZON}\\b)[A-Za-z]{2,}ly\\b)?` +
        `(?:\\s*(?<horizon>${HORIZON}))?`,
      'gi',
    ),
  },
];

/**
 * Every goal-baseline pattern's compiled SOURCE (ROADMAP 2.353).
 *
 * ⚠ THESE PATTERNS HAVE BEEN OUTSIDE THE DIGIT- AND MAGNITUDE-DRIFT GUARDS
 * SINCE 2.273 SHIPPED THEM. `PATTERN_SOURCES_FOR_DRIFT_GUARD` is derived from
 * `PATTERNS`, and `GOAL_BASELINE_PATTERNS` is not a member of it — so the four
 * patterns that carry the goal TARGET, the single most consequential number
 * CEE extracts, were the only amount-reading grammar in this file that no guard
 * checked shared the one alphabet.
 *
 * DERIVED from the array itself, so a fifth pattern is inside the guard the
 * instant it lands. And — CLAUDE.md 12d — this proves AGREEMENT only: it is
 * structurally blind to the pattern set being SHORT A SHAPE, which is exactly
 * the defect 2.353 fixes. The hand-written corpus in
 * `goal-natural-language-targets.test.ts` is the other half, and neither
 * supersedes the other.
 */
export const GOAL_BASELINE_PATTERN_SOURCES_FOR_DRIFT_GUARD: Readonly<Record<string, string>> =
  Object.freeze(
    Object.fromEntries(
      GOAL_BASELINE_PATTERNS.map((entry, index) => [
        `goalBaseline${index + 1}`,
        entry.pattern.source,
      ]),
    ),
  );

/**
 * Resolve one captured amount to a raw magnitude in USER units, plus the unit
 * signals it carried. Percent scaling is applied by the caller, which needs to
 * see BOTH sides before deciding the pair's unit.
 */
function resolveAmount(
  groups: Record<string, string | undefined>,
  prefix: string,
): { readonly raw: number; readonly isPercent: boolean; readonly currency?: string } | null {
  // L67 — the words branch resolves through the ONE cardinal parser. A phrase
  // the parser cannot fold returns null and the whole match yields nothing:
  // fail closed, never a fragment ("two and a half million" must not become 2).
  const words = groups[`${prefix}Words`];
  if (words !== undefined) {
    const parsed = parseCardinalAmount(words);
    if (parsed === null) return null;
    return {
      raw: parsed,
      isPercent: groups[`${prefix}Pct`] === '%',
      currency: groups[`${prefix}Cur`],
    };
  }
  const parsed = parseAmountDigits(groups[prefix]);
  if (parsed === null) return null;
  return {
    raw: parsed * resolveMagnitude(groups[`${prefix}Mult`]),
    isPercent: groups[`${prefix}Pct`] === '%',
    currency: groups[`${prefix}Cur`],
  };
}

/**
 * A resolved target in this file's normalised convention ('%' pre-divided into
 * a 0-1 fraction). ONE spelling, read by the formed pair and by the refusal
 * alike, so the number a refusal reports can never drift from the number the
 * same brief would have published.
 */
function normaliseTargetValue(to: { readonly raw: number; readonly isPercent: boolean }): number {
  return to.isPercent ? to.raw / 100 : to.raw;
}

/**
 * The label forced onto a goal-target-with-baseline extraction.
 *
 * Chosen to be byte-identical to what `contextualNumber` produces for the same
 * phrase ("target of 6000000" → "Target"), so the dedup key collides and the
 * later, baseline-LESS extraction is dropped instead of double-injecting a
 * second target factor. It must also satisfy `isTargetGoalLabel` (enricher.ts)
 * or the factor would never reach the goal-threshold mint at all.
 */
const GOAL_TARGET_LABEL = "Target";

/** A goal target and its user-stated current level, from ONE regex match. */
export interface GoalTargetWithBaseline {
  /** Target in the file's normalised convention ('%' pre-divided to 0-1). */
  readonly value: number;
  /** Current level, same convention and same metric as `value`. */
  readonly baseline: number;
  readonly unit?: string;
  readonly matchedText: string;
}

/**
 * Extract a goal target TOGETHER WITH the current level stated alongside it,
 * or `null` when the text states no such pair (ROADMAP 2.273).
 *
 * Shared by both goal-threshold registration paths so they cannot drift: the
 * draft path (`extractFactors` → enricher redirect) and the chat path
 * (`add_constraint`). Returns `null` far more often than not — that is the
 * design. A brief that never states its current level yields no baseline, ISL
 * refuses with `missing_goal_baseline`, and the user is asked rather than
 * guessed at.
 */
export function extractGoalTargetWithBaseline(text: string): GoalTargetWithBaseline | null {
  const resolution = resolveGoalPair(text);
  return resolution?.kind === "pair" ? resolution.pair : null;
}

/**
 * The same scan, reporting a REFUSAL distinctly from "no goal pair stated"
 * (ROADMAP 2.353). `extractFactors` needs the difference; every other caller
 * wants the pair or nothing, and gets it from the wrapper above with an
 * unchanged signature.
 */
function resolveGoalPair(text: string): GoalPairResolution | null {
  for (const entry of GOAL_BASELINE_PATTERNS) {
    for (const m of goalPatternMatches(entry, text)) {
      const resolved = resolveOneGoalMatch(m);
      if (resolved !== undefined) return resolved;
    }
  }
  return null;
}

/**
 * The matches a pattern offers the resolver.
 *
 * An UNANCHORED pattern offers its first match only — byte-identical to the
 * single `exec` this replaced. An ANCHORED pattern offers every match, minus
 * those carrying no goal anchor, because `exec`'s first-match rule is exactly
 * how a lever sentence stole the pair from a genuine goal later in the brief
 * (review A1, measured: "We could increase the price from £49 to £59. Increase
 * annual revenue from £4 million today to £6 million within 12 months." yielded
 * 59/49).
 */
function* goalPatternMatches(
  entry: GoalBaselinePattern,
  text: string,
): Generator<RegExpExecArray> {
  if (!entry.goalAnchored) {
    const m = entry.pattern.exec(text);
    if (m?.groups) yield m;
    return;
  }
  const scanner = new RegExp(entry.pattern.source, entry.pattern.flags);
  scanner.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = scanner.exec(text)) !== null) {
    if (m[0] === "") {
      scanner.lastIndex += 1;
      continue;
    }
    if (!m.groups) continue;
    if (!isGoalAnchored(m.groups)) {
      log.debug(
        {
          event: "cee.factor_extraction.goal_pair_unanchored",
          matched: m[0],
        },
        "From-to construction skipped: names no target and states no horizon",
      );
      continue;
    }
    // ROADMAP 2.371(b) — the second, independent guard. The anchor asks
    // whether the sentence NAMES a goal; this asks whether it COMMITS to one.
    // A lever can carry a horizon ("we could increase the price from £49 to
    // £59 this year"), so the anchor alone lets it through, and 22 of 25
    // probed lever phrasings did exactly that at `7bdf30ff`.
    if (isProposalFramed(text, m.index)) {
      log.debug(
        {
          event: "cee.factor_extraction.goal_pair_proposal_framed",
          matched: m[0],
        },
        "From-to construction skipped: framed as an option under consideration, not a commitment",
      );
      continue;
    }
    yield m;
  }
}

/**
 * Does this match NAME ITSELF a goal? (review A1.)
 *
 * Either an explicit goal word — after `to` ("…to a TARGET of 6M") or inside
 * the metric phrase ("raise the TARGET from…", which is where case B carries
 * it) — or a HORIZON after the target. A lever sentence has neither.
 */
function isGoalAnchored(groups: Record<string, string | undefined>): boolean {
  if (groups.goalWord !== undefined) return true;
  if (groups.horizon !== undefined) return true;
  return new RegExp(`\\b${GOAL_WORD}\\b`, "i").test(groups.metricPhrase ?? "");
}

/**
 * Resolve ONE match to a pair or a named refusal. `undefined` means "this match
 * carried no readable amounts" — the scan moves on; `null` is never returned
 * here (the caller owns the exhausted case).
 */
function resolveOneGoalMatch(m: RegExpExecArray): GoalPairResolution | undefined {
  const groups = m.groups;
  if (!groups) return undefined;
  const span: readonly [number, number] = [m.index, m.index + m[0].length];
  {
    const to = resolveAmount(groups, "to");
    const from = resolveAmount(groups, "from");
    if (!to || !from) return undefined;

    // A MIXED percent pair is refused, not reconciled (adversarial review, PR
    // #787). This previously read `to.isPercent || from.isPercent`, which
    // scaled BOTH sides by 100 whenever EITHER carried a '%': "from 85 to a
    // target of 95%" wrote baseline 0.85 from a number the user never
    // expressed as a percentage. The result lands squarely inside ISL's |1.5|
    // domain guard, and a MAGNITUDE guard is structurally incapable of
    // catching a UNIT error that lands in range. If the two amounts disagree
    // about being percentages they are not reliably the same quantity, so no
    // pair is formed and ISL keeps refusing honestly.
    //
    // ⚠ ROADMAP 2.371(d) — THIS NOW RUNS BEFORE THE DIRECTION CHECK, AND THE
    // ORDER IS THE WHOLE POINT. Comparability is a PRECONDITION of comparison:
    // a percent target against a non-percent baseline gives `<` two operands
    // that are not on one scale, so whatever it concludes is arithmetic on
    // incommensurable numbers. MEASURED at `7bdf30ff`: "Increase annual
    // retention from 85 today to 95% within 12 months" logged
    // `direction_unsupported target="0.95" baseline="85"` — 0.95 was never
    // below 85 in any sense the user expressed, and the reason named the wrong
    // rule for the wrong reason.
    //
    // The refusal itself is unchanged in every observable way but the logged
    // NAME: both branches return no pair, the same `targetValue` and the same
    // span, and `GoalPairRefusalReason` has no reader outside this file (whole
    // -repo manifest taken at `7bdf30ff`: `goal_pair_refused` and every reason
    // string appear in `src/cee/factor-extraction/index.ts` and nowhere else).
    // So this is an OBSERVABILITY fix with an empty behavioural delta — which
    // is exactly why it is safe to make and worth making: a reason that names
    // the wrong rule teaches the next reader the wrong thing.
    if (to.isPercent !== from.isPercent) {
      return refuseGoalPair("mixed_percent_pair", {}, normaliseTargetValue(to), span);
    }

    // ⚠ ROADMAP 2.353 (review A2) — A DECREASE IS REFUSED, NOT MINTED, AND THE
    // REASON IS THE SEAM RATHER THAN THE SENTENCE.
    //
    // ISL scores P(level >= threshold) and the goal contract carries NO
    // DIRECTION FIELD — `goal_threshold_frame` is the code constant 'level'.
    // So a threshold BELOW its baseline enters a >= seam that INVERTS the
    // question, and what comes back is not a smaller probability, it is the
    // wrong one, wearing the same confident badge. MEASURED at `c356531d`:
    //
    //   "Decrease annual costs from £4 million today to £3 million within 12
    //    months"    -> goal_threshold 0.8, goal_baseline 1.0667 — a baseline
    //                  ABOVE its own cap, which no consumer expects
    //   "Our target is 3%, currently at 5%."  -> 0.03 minted under 0.05, and
    //                  this one is PRE-EXISTING: pattern 2 has always done it,
    //                  so the refusal is placed HERE, at the shared resolution
    //                  point, rather than on pattern 4 alone. Fixing only the
    //                  shape this lane added would have left the identical
    //                  wrong probability reachable through the older grammar.
    //   "…to 0 within 12 months"              -> threshold 0, cap undefined,
    //                  i.e. an UN-NORMALISED zero beside a normalised world
    //
    // Refusing is not a limitation dressed up as a principle: no direction bit
    // exists to carry, so minting one silently is the only alternative, and
    // that is fabrication. Real decrease support is rowed as 2.367 and runs the
    // whole way through the contract and ISL. Equality is deliberately NOT
    // refused — threshold == baseline is a meaningful "hold the line".
    //
    // ⚠ ROADMAP 2.371(d) — AND IT RUNS AFTER THE COMPARABILITY CHECK ABOVE, SO
    // BOTH OPERANDS BELOW ARE ON ONE SCALE BY CONSTRUCTION.
    if (to.raw !== 0 || from.raw !== 0) {
      const target = to.isPercent ? to.raw / 100 : to.raw;
      const level = from.isPercent ? from.raw / 100 : from.raw;
      if (target < level) {
        return refuseGoalPair(
          "direction_unsupported",
          { target: String(target), baseline: String(level) },
          normaliseTargetValue(to),
          span,
        );
      }
    }

    // ROADMAP 2.288 — a MIXED CURRENCY pair is refused, not reconciled. This
    // used to carry a NOTE calling currency "a display unit" and forming the
    // pair anyway: "from $4M to a target of £6M" subtracted dollars from
    // pounds under one cap. That note was wrong at its premise — two explicit,
    // DIFFERENT currencies are not one scale, there is no FX conversion in
    // this codebase, and inventing a rate would be fabrication with extra
    // steps. Currency words fold in first, so "4M dollars" vs "£6M" refuses
    // identically. Same-currency and no-currency pairs are untouched.
    const toMetric = resolveTrailingMetric(groups, "to");
    const fromMetric = resolveTrailingMetric(groups, "from");
    const toCurrency = to.currency ?? toMetric.currency;
    const fromCurrency = from.currency ?? fromMetric.currency;
    if (toCurrency && fromCurrency && toCurrency !== fromCurrency) {
      return refuseGoalPair(
        "currency_mismatch",
        { target_currency: toCurrency, baseline_currency: fromCurrency },
        normaliseTargetValue(to),
        span,
      );
    }

    // ROADMAP 2.287 — CROSS-METRIC NOUNS are refused. When BOTH amounts carry
    // an explicit metric noun and the nouns name different metrics ("800k
    // REVENUE" vs "50 EMPLOYEES"), the two numbers are provably not the same
    // quantity — pairing them hands ISL arithmetic garbage that normalises
    // in-range and comes back as a confident wrong probability. Strictly
    // stemmed equality, no synonym fuzz: "sales" vs "revenue" also refuses,
    // because guessing they are one metric is still guessing. A noun on ONE
    // side only ("800 customers, currently at 500") keeps extracting — that is
    // #787's pinned table and the single-construction trust it encodes.
    if (toMetric.noun && fromMetric.noun) {
      if (toMetric.noun !== fromMetric.noun) {
        return refuseGoalPair(
          "metric_noun_mismatch",
          { target_metric: toMetric.noun, baseline_metric: fromMetric.noun },
          normaliseTargetValue(to),
          span,
        );
      }
    } else if (toCurrency && !fromCurrency && fromMetric.noun) {
      // Cross-signal: an explicit CURRENCY target against an explicit
      // non-currency noun level ("$800k" vs "50 employees") is the same
      // cross-metric class wearing a symbol instead of a word.
      return refuseGoalPair(
        "currency_vs_metric_noun",
        { target_currency: toCurrency, baseline_metric: fromMetric.noun },
        normaliseTargetValue(to),
        span,
      );
    } else if (fromCurrency && !toCurrency && toMetric.noun) {
      return refuseGoalPair(
        "currency_vs_metric_noun",
        { baseline_currency: fromCurrency, target_metric: toMetric.noun },
        normaliseTargetValue(to),
        span,
      );
    }

    // Both sides now agree. Percent values are pre-divided into a 0-1
    // fraction, matching every other extractor in this file; callers that need
    // the RAW percent number reconstruct it.
    //
    // ⚠ ROADMAP 2.353 — THE CURRENCY WORDS NOW REACH THE UNIT, AND THE
    // BYTE-PARITY THAT KEPT THEM OUT IS WITHDRAWN ON PURPOSE.
    //
    // 2.288 taught this function to READ currency words so it could REFUSE a
    // mismatch, but deliberately left the emitted `unit` reading the symbol
    // captures only, for byte-parity with its own pre-change output. The
    // consequence, MEASURED at `210c0ff`: "Currently at 4M pounds, target 6M
    // pounds" agreed on £ well enough to be admitted, then emitted NO unit —
    // and `applyGoalTargetRedirect`'s `factor.unit ?? "count"` turned a pounds
    // figure into a COUNT on the goal card. Byte-parity was the right caution
    // for a refusal-only change; carrying it further meant validating a
    // currency and then throwing it away, which is a worse answer than either
    // refusing or reporting it.
    //
    // The symbols still win when present, so every pair that formed with a
    // symbol is byte-identical to before; only pairs that previously emitted
    // NOTHING are affected, and for those the alternative was "count".
    const isPercent = to.isPercent;
    return {
      kind: "pair",
      span,
      pair: {
        value: isPercent ? to.raw / 100 : to.raw,
        baseline: isPercent ? from.raw / 100 : from.raw,
        unit: isPercent
          ? "%"
          : (to.currency ?? from.currency ?? toMetric.currency ?? fromMetric.currency),
        matchedText: m[0],
      },
    };
  }
}

/**
 * Infer a label from the surrounding context of a match
 */
function inferLabel(brief: string, matchIndex: number, matchText: string): string {
  // Look for context words before the match
  const beforeText = brief.substring(Math.max(0, matchIndex - 50), matchIndex).toLowerCase();

  // Common context patterns
  const contextPatterns = [
    { pattern: /price/i, label: "Price" },
    { pattern: /cost/i, label: "Cost" },
    { pattern: /revenue/i, label: "Revenue" },
    { pattern: /budget/i, label: "Budget" },
    { pattern: /churn/i, label: "Churn Rate" },
    { pattern: /conversion/i, label: "Conversion Rate" },
    { pattern: /growth/i, label: "Growth Rate" },
    { pattern: /margin/i, label: "Margin" },
    { pattern: /subscription/i, label: "Subscription Price" },
    { pattern: /plan/i, label: "Plan Price" },
    { pattern: /trial/i, label: "Trial Period" },
    { pattern: /user/i, label: "User Count" },
    { pattern: /customer/i, label: "Customer Count" },
    { pattern: /retention/i, label: "Retention Rate" },
    { pattern: /attrition/i, label: "Attrition Rate" },
    { pattern: /discount/i, label: "Discount" },
    { pattern: /fee/i, label: "Fee" },
    { pattern: /salary|wage/i, label: "Salary" },
    { pattern: /headcount|staff/i, label: "Headcount" },
  ];

  for (const { pattern, label } of contextPatterns) {
    if (pattern.test(beforeText)) {
      return label;
    }
  }

  // Default: use the matched text as a hint
  if (matchText.includes("%")) {
    return "Rate";
  }
  if (/[£$€]/.test(matchText)) {
    return "Value";
  }

  return "Factor";
}

/**
 * Generate deduplication key from label, value, and unit.
 * Uses normalized label (lowercase, trimmed) for consistent matching.
 */
function dedupKey(label: string, value: number, unit?: string): string {
  const normalizedLabel = label.toLowerCase().trim();
  const normalizedUnit = unit ?? "num";
  return `${normalizedLabel}:${value}:${normalizedUnit}`;
}

/**
 * Extract quantitative factors from a brief
 */
export function extractFactors(brief: string): ExtractedFactor[] {
  const factors: ExtractedFactor[] = [];
  const seenFactors = new Set<string>(); // Dedup by label+value+unit

  let match: RegExpExecArray | null;

  // ============================================================================
  // RANGE EXTRACTIONS (highest priority for uncertainty derivation)
  // ============================================================================

  // Extract currency ranges: "between £50-70", "£50-£70"
  const currencyRangeRegex = new RegExp(PATTERNS.currencyRange.source, "gi");
  while ((match = currencyRangeRegex.exec(brief)) !== null) {
    const currency = match.groups?.currency || "";
    const min = (parseAmountDigits(match.groups?.min) ?? 0);
    const max = (parseAmountDigits(match.groups?.max) ?? 0);
    const midpoint = (min + max) / 2;
    const label = inferLabel(brief, match.index, match[0]);
    const key = dedupKey(label, midpoint, currency);

    if (!seenFactors.has(key)) {
      seenFactors.add(key);
      factors.push({
        label,
        value: midpoint,
        unit: currency,
        confidence: 0.80,
        matchedText: match[0],
        extractionType: "range",
        rangeMin: min,
        rangeMax: max,
      });
    } else {
      log.debug({ label, value: midpoint, unit: currency, event: "cee.factor_extraction.duplicate_dropped" }, "Duplicate factor dropped");
    }
  }

  // Extract percentage ranges: "between 5-10%", "5%-10%"
  const percentRangeRegex = new RegExp(PATTERNS.percentRange.source, "gi");
  while ((match = percentRangeRegex.exec(brief)) !== null) {
    const min = (parseAmountDigits(match.groups?.min) ?? 0) / 100;
    const max = (parseAmountDigits(match.groups?.max) ?? 0) / 100;
    const midpoint = (min + max) / 2;
    const label = inferLabel(brief, match.index, match[0]);
    const key = dedupKey(label, midpoint, "%");

    if (!seenFactors.has(key)) {
      seenFactors.add(key);
      factors.push({
        label,
        value: midpoint,
        unit: "%",
        confidence: 0.80,
        matchedText: match[0],
        extractionType: "range",
        rangeMin: min,
        rangeMax: max,
      });
    } else {
      log.debug({ label, value: midpoint, unit: "%", event: "cee.factor_extraction.duplicate_dropped" }, "Duplicate factor dropped");
    }
  }

  // Extract generic ranges: "between 50 and 70"
  const genericRangeRegex = new RegExp(PATTERNS.genericRange.source, "gi");
  while ((match = genericRangeRegex.exec(brief)) !== null) {
    const min = (parseAmountDigits(match.groups?.min) ?? 0);
    const max = (parseAmountDigits(match.groups?.max) ?? 0);
    const midpoint = (min + max) / 2;
    const label = inferLabel(brief, match.index, match[0]);
    const key = dedupKey(label, midpoint, undefined);

    if (!seenFactors.has(key)) {
      seenFactors.add(key);
      factors.push({
        label,
        value: midpoint,
        confidence: 0.80,
        matchedText: match[0],
        extractionType: "range",
        rangeMin: min,
        rangeMax: max,
      });
    } else {
      log.debug({ label, value: midpoint, event: "cee.factor_extraction.duplicate_dropped" }, "Duplicate factor dropped");
    }
  }

  // ============================================================================
  // APPROXIMATE EXTRACTIONS (inferred type)
  // ============================================================================

  // Extract approximate values: "around £60", "roughly 50"
  const approximateRegex = new RegExp(PATTERNS.approximateValue.source, "gi");
  while ((match = approximateRegex.exec(brief)) !== null) {
    const currency = match.groups?.currency;
    const amount = (parseAmountDigits(match.groups?.amount) ?? 0);
    const unitMatch = match.groups?.unit;
    const unit = unitMatch === "%" ? "%" : currency;
    const normalizedValue = unitMatch === "%" ? amount / 100 : amount;
    const label = inferLabel(brief, match.index, match[0]);
    const key = dedupKey(label, normalizedValue, unit);

    if (!seenFactors.has(key)) {
      seenFactors.add(key);
      factors.push({
        label,
        value: normalizedValue,
        unit,
        confidence: 0.70,
        matchedText: match[0],
        extractionType: "inferred",
      });
    } else {
      log.debug({ label, value: normalizedValue, unit, event: "cee.factor_extraction.duplicate_dropped" }, "Duplicate factor dropped");
    }
  }

  // ============================================================================
  // EXPLICIT EXTRACTIONS (highest confidence)
  // ============================================================================

  // ---------------------------------------------------------------------------
  // GOAL TARGET *WITH* ITS CURRENT LEVEL (ROADMAP 2.273) — runs FIRST among the
  // explicit extractors, deliberately.
  //
  // The label is forced to "Target" rather than inferred from context. Two
  // reasons, both load-bearing:
  //   1. `isTargetGoalLabel` (enricher.ts) is what routes a factor to the goal
  //      node's threshold mint. `inferLabel` would return "Revenue" for
  //      "Grow revenue from 4000000 to a target of 6000000", which does NOT
  //      redirect — the baseline would ride on a plain factor and never reach
  //      the goal.
  //   2. It makes the dedup key byte-identical to the one `contextualNumber`
  //      produces for the same phrase ("target of 6000000" → label "Target"),
  //      so that later, baseline-less extraction is DROPPED by the existing
  //      dedup rather than double-injecting a second target factor. This block
  //      must therefore stay ahead of `contextualNumber` below.
  //
  // First match wins and the scan stops: a brief states one goal target, and
  // pairing a second target with the first baseline is exactly the cross-metric
  // mixing these combined patterns exist to prevent.
  //
  // ⚠ ROADMAP 2.353 — REASON 2 ABOVE IS NOW ENFORCED BY A RULE INSTEAD OF BY A
  // COINCIDENCE, and it had to be. The dedup collision it describes depended on
  // the two extractions producing byte-identical KEYS, which include the UNIT —
  // so the moment a pair started emitting `£` for "target 6M pounds" (where
  // `contextualNumber` still emits none), the keys stopped colliding and TWO
  // "Target" factors appeared, the second baseline-less and racing the first to
  // the mint. A dedup that works only while two unrelated code paths happen to
  // agree on a field neither consults is a hand-maintained mirror in disguise
  // (CLAUDE.md trap 12); the goal-word suppression below states the rule
  // outright and does not care what either unit says.
  const goalResolution = resolveGoalPair(brief);
  if (goalResolution?.kind === "pair") {
    const goalPair = goalResolution.pair;
    const key = dedupKey(GOAL_TARGET_LABEL, goalPair.value, goalPair.unit);
    if (!seenFactors.has(key)) {
      seenFactors.add(key);
      factors.push({
        label: GOAL_TARGET_LABEL,
        value: goalPair.value,
        baseline: goalPair.baseline,
        unit: goalPair.unit,
        confidence: 0.95,
        matchedText: goalPair.matchedText,
        extractionType: "explicit",
      });
    }
  }

  // Extract currency from-to patterns (highest priority for explicit)
  const currencyFromToRegex = new RegExp(PATTERNS.currencyFromTo.source, "gi");
  while ((match = currencyFromToRegex.exec(brief)) !== null) {
    const currency = match.groups?.currency1 || "";
    const from = (parseAmountDigits(match.groups?.from) ?? 0);
    const to = (parseAmountDigits(match.groups?.to) ?? 0);
    const label = inferLabel(brief, match.index, match[0]);
    const key = dedupKey(label, to, currency);

    if (!seenFactors.has(key)) {
      seenFactors.add(key);
      factors.push({
        label,
        value: to,
        baseline: from,
        unit: currency,
        confidence: 0.95,
        matchedText: match[0],
        extractionType: "explicit",
      });
    } else {
      log.debug({ label, value: to, unit: currency, event: "cee.factor_extraction.duplicate_dropped" }, "Duplicate factor dropped");
    }
  }

  // Extract percentage from-to patterns
  const percentFromToRegex = new RegExp(PATTERNS.percentFromTo.source, "gi");
  while ((match = percentFromToRegex.exec(brief)) !== null) {
    const from = (parseAmountDigits(match.groups?.from) ?? 0) / 100;
    const to = (parseAmountDigits(match.groups?.to) ?? 0) / 100;
    const label = inferLabel(brief, match.index, match[0]);
    const key = dedupKey(label, to, "%");

    if (!seenFactors.has(key)) {
      seenFactors.add(key);
      factors.push({
        label,
        value: to,
        baseline: from,
        unit: "%",
        confidence: 0.90,
        matchedText: match[0],
        extractionType: "explicit",
      });
    } else {
      log.debug({ label, value: to, unit: "%", event: "cee.factor_extraction.duplicate_dropped" }, "Duplicate factor dropped");
    }
  }

  // Extract change patterns (increase/decrease)
  const changeRegex = new RegExp(PATTERNS.changePattern.source, "gi");
  while ((match = changeRegex.exec(brief)) !== null) {
    const from = (parseAmountDigits(match.groups?.from) ?? 0);
    const to = (parseAmountDigits(match.groups?.to) ?? 0);
    const isPercent = match[0].includes("%");
    const hasCurrency = /[£$€]/.test(match[0]);
    const unit = isPercent ? "%" : hasCurrency ? match[0].match(/[£$€]/)?.[0] : undefined;

    const normalizedValue = isPercent ? to / 100 : to;
    const normalizedBaseline = isPercent ? from / 100 : from;
    const label = inferLabel(brief, match.index, match[0]);
    const key = dedupKey(label, normalizedValue, unit);

    if (!seenFactors.has(key)) {
      seenFactors.add(key);
      factors.push({
        label,
        value: normalizedValue,
        baseline: normalizedBaseline,
        unit,
        confidence: 0.85,
        matchedText: match[0],
        extractionType: "explicit",
      });
    } else {
      log.debug({ label, value: normalizedValue, unit, event: "cee.factor_extraction.duplicate_dropped" }, "Duplicate factor dropped");
    }
  }

  // Extract contextual numbers: "price is £59", "target is 800k"
  const contextualRegex = new RegExp(PATTERNS.contextualNumber.source, "gi");
  while ((match = contextualRegex.exec(brief)) !== null) {
    const context = match.groups?.context || "";

    // ROADMAP 2.303 — A SUFFIX THIS MODULE CANNOT READ IS A MAGNITUDE IT DOES
    // NOT KNOW, so the mint is REFUSED BY NAME rather than emitting the bare
    // digits. "budget of 500kg" is not 500, and "revenue of 400000USD" is not
    // reliably 400000; publishing either as the user's stated number is the
    // same class of untruth as the dropped multiplier this change fixes, only
    // quieter. A withheld factor asks the user; a confident wrong magnitude
    // does not. (Only letters ATTACHED to the digits refuse — "target is 800
    // customers" is a metric noun beside a whole number and still extracts.)
    const unknownSuffix = match.groups?.unknownSuffix;
    if (unknownSuffix) {
      log.info(
        {
          event: "cee.factor_extraction.contextual_number_refused",
          reason: "unrecognised_magnitude_suffix",
          context,
          suffix: unknownSuffix,
        },
        `Contextual number refused: unrecognised magnitude suffix "${unknownSuffix}"`,
      );
      continue;
    }

    const digits = parseAmountDigits(match.groups?.amount);
    if (digits === null) continue;
    const amount = digits * resolveMagnitude(match.groups?.mult);
    const isPercent = match[0].includes("%");
    const hasCurrency = /[£$€]/.test(match[0]);
    const unit = isPercent ? "%" : hasCurrency ? match[0].match(/[£$€]/)?.[0] : undefined;

    const normalizedValue = isPercent ? amount / 100 : amount;
    const label = context.charAt(0).toUpperCase() + context.slice(1);

    // ROADMAP 2.353 — the goal grammar has already spoken about THIS
    // STATEMENT, so this rule does not get to answer it again with less
    // information.
    //
    // ON A REFUSAL that is the whole point: the pair was refused because its two
    // amounts disagree about currency, percent-ness, metric or direction, and
    // minting the target ALONE from the same sentence republishes the number the
    // refusal just withheld — stripped of the very signal that condemned it.
    // MEASURED before this existed: "Grow revenue from £4M to a target of 6M
    // dollars" refused the pair and still reached the wire with 0.8.
    // ON A FORMED PAIR it is the pre-existing "drop the baseline-less
    // duplicate" intent, stated as a rule rather than left to a key collision.
    //
    // ⚠ BOUND BY SPAN, NOT BY VALUE (review A3, CLAUDE.md trap 19 in source).
    // Two earlier cuts were both wrong in the same direction. The first
    // suppressed every goal-word number in the brief. The second compared
    // VALUES — and a different statement that merely shares the target's number
    // satisfied it, so "…to £6 million within 12 months. Alert threshold is 6
    // million." silently lost the alert threshold. A value predicate is exactly
    // what trap 19 forbids: bind to the object by identity, and here identity is
    // POSITION. Only a match that OVERLAPS the resolved construction is the
    // same statement.
    //
    // Restricted further to contexts `isTargetGoalLabel` would route to the goal
    // mint; "price", "revenue", "budget" and friends are ordinary factors, are
    // not what the goal grammar was reasoning about, and keep extracting.
    if (goalResolution && new RegExp(`^${GOAL_WORD}$`, "i").test(context)) {
      const [goalStart, goalEnd] = goalResolution.span;
      const start = match.index;
      const end = start + match[0].length;
      if (start < goalEnd && goalStart < end) {
        log.debug(
          {
            event: "cee.factor_extraction.goal_word_suppressed",
            resolution: goalResolution.kind,
            context,
            span: `${start}-${end}`,
          },
          "Goal-word contextual number suppressed: inside the construction the goal grammar resolved",
        );
        continue;
      }
    }
    const key = dedupKey(label, normalizedValue, unit);

    if (!seenFactors.has(key)) {
      seenFactors.add(key);
      factors.push({
        label,
        value: normalizedValue,
        unit,
        confidence: 0.90,
        matchedText: match[0],
        extractionType: "explicit",
      });
    } else {
      log.debug({ label, value: normalizedValue, unit, event: "cee.factor_extraction.duplicate_dropped" }, "Duplicate factor dropped");
    }
  }

  // Extract currency with multipliers: $1 million, £2.5m
  const currencyMultiplierRegex = new RegExp(PATTERNS.currencyWithMultiplier.source, "gi");
  while ((match = currencyMultiplierRegex.exec(brief)) !== null) {
    const currency = match.groups?.currency || "";
    const baseAmount = (parseAmountDigits(match.groups?.amount) ?? 0);
    // ROADMAP 2.316 — the SAME resolver the other two magnitude paths use.
    // The private `parseMultiplier` it replaced indexed a case-SENSITIVE map
    // under a case-INSENSITIVE regex, so `$5MILLION` matched and then resolved
    // to 1. `resolveMagnitude` case-folds, and folds against the same key set
    // the alternation is derived from, so the pattern and the lookup cannot
    // disagree about what a magnitude is.
    const multiplier = resolveMagnitude(match.groups?.multiplier);
    const amount = baseAmount * multiplier;
    const label = inferLabel(brief, match.index, match[0]);
    const key = dedupKey(label, amount, currency);

    if (!seenFactors.has(key)) {
      seenFactors.add(key);
      factors.push({
        label,
        value: amount,
        unit: currency,
        confidence: 0.85,
        matchedText: match[0],
        extractionType: "explicit",
      });
    } else {
      log.debug({ label, value: amount, unit: currency, event: "cee.factor_extraction.duplicate_dropped" }, "Duplicate factor dropped");
    }
  }

  // ============================================================================
  // INFERRED EXTRACTIONS (lower confidence, gap fillers)
  // ============================================================================

  // Extract standalone currency values (inferred from context)
  const currencyRegex = new RegExp(PATTERNS.currency.source, "gi");
  while ((match = currencyRegex.exec(brief)) !== null) {
    // ROADMAP 2.316 — THIS IS WHERE AN UNREADABLE MAGNITUDE LEAKED AS BARE
    // DIGITS. `currencyWithMultiplier` cannot match "$5kg" (no `kg` in the
    // alphabet), so the amount fell through to here and was published as 5.
    // #797 established the rule on `contextualNumber` — "budget of 500kg"
    // yields NO factor rather than 500 — and this path now matches it: a
    // suffix that looks like a magnitude the module cannot read is a magnitude
    // it does not know, and a refusal asks the user where a confident wrong
    // number does not.
    //
    // TWO SCOPES, both narrow, and the comment states the rule the code runs:
    //   1. Only letters ATTACHED to the digits, exactly as #797 scoped it —
    //      "$5 kg" is a whole number beside a metric noun and still extracts,
    //      the same way "target is 800 customers" does.
    //   2. Only runs that BEGIN with a magnitude key (`isMagnitudeShapedSuffix`).
    //      A per-month or currency-code trailer — "£49pcm", "$5USD" — cannot be
    //      a mis-read magnitude and must not be destroyed to defend against one.
    //      Refusing those was a live regression in this PR's first cut.
    const attachedSuffix = brief
      .slice(match.index + match[0].length)
      .match(/^[A-Za-z]+/)?.[0];
    if (attachedSuffix && isMagnitudeShapedSuffix(attachedSuffix)) {
      log.info(
        {
          event: "cee.factor_extraction.currency_amount_refused",
          reason: "ambiguous_magnitude_suffix",
          suffix: attachedSuffix,
        },
        `Currency amount refused: suffix "${attachedSuffix}" begins with a magnitude key but is not one`,
      );
      continue;
    }

    const currency = match.groups?.currency || "";
    const amount = (parseAmountDigits(match.groups?.amount) ?? 0);
    const label = inferLabel(brief, match.index, match[0]);
    const key = dedupKey(label, amount, currency);

    if (!seenFactors.has(key)) {
      seenFactors.add(key);
      factors.push({
        label,
        value: amount,
        unit: currency,
        confidence: 0.60,
        matchedText: match[0],
        extractionType: "inferred",
      });
    } else {
      log.debug({ label, value: amount, unit: currency, event: "cee.factor_extraction.duplicate_dropped" }, "Duplicate factor dropped");
    }
  }

  // Extract standalone percentages (inferred from context)
  const percentRegex = new RegExp(PATTERNS.percentage.source, "gi");
  while ((match = percentRegex.exec(brief)) !== null) {
    const amount = (parseAmountDigits(match.groups?.amount) ?? 0) / 100;
    const label = inferLabel(brief, match.index, match[0]);
    const key = dedupKey(label, amount, "%");

    if (!seenFactors.has(key)) {
      seenFactors.add(key);
      factors.push({
        label,
        value: amount,
        unit: "%",
        confidence: 0.60,
        matchedText: match[0],
        extractionType: "inferred",
      });
    } else {
      log.debug({ label, value: amount, unit: "%", event: "cee.factor_extraction.duplicate_dropped" }, "Duplicate factor dropped");
    }
  }

  // Count extraction types for telemetry
  const explicitCount = factors.filter((f) => f.extractionType === "explicit").length;
  const inferredCount = factors.filter((f) => f.extractionType === "inferred").length;
  const rangeCount = factors.filter((f) => f.extractionType === "range").length;

  log.debug({
    event: "cee.factor_extraction.complete",
    factorCount: factors.length,
    explicitCount,
    inferredCount,
    rangeCount,
    deduplicatedCount: seenFactors.size,
  }, "Factor extraction complete");

  return factors;
}

/**
 * Generate a unique factor node ID
 */
export function generateFactorId(label: string, index: number): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .substring(0, 20);
  return `factor_${slug}_${index}`;
}

// ============================================================================
// LLM-First Orchestration
// ============================================================================

/**
 * Alias for regex-based extraction (for clarity when using with LLM orchestration)
 */
export const extractFactorsRegex = extractFactors;

/**
 * Options for orchestrated factor extraction
 */
export interface OrchestratedExtractionOptions {
  /** Market context domain override (auto-detected if not specified) */
  domain?: SupportedDomain;
  /** Pre-resolved context (if already available) */
  context?: ResolvedContext;
  /** Force regex-only extraction even if LLM is enabled */
  forceRegex?: boolean;
  /** Force LLM extraction even if disabled (for testing) */
  forceLLM?: boolean;
  /** Optional model override (e.g., "claude-sonnet-4-20250514") */
  modelOverride?: string;
}

/**
 * Result from orchestrated extraction
 */
export interface OrchestratedExtractionResult {
  /** Extracted factors */
  factors: ExtractedFactor[];
  /** Extraction mode used */
  mode: "llm-first" | "regex-only";
  /** Whether LLM extraction succeeded */
  llmSuccess?: boolean;
  /** Merge statistics (if LLM was used) */
  mergeStats?: MergeResult["stats"];
  /** Any warnings from extraction */
  warnings: string[];
}

/**
 * Orchestrated factor extraction with LLM-first support.
 *
 * When CEE_LLM_FIRST_EXTRACTION_ENABLED=true:
 * 1. Resolves market context for the brief
 * 2. Calls LLM for factor extraction
 * 3. Runs regex extraction as fallback/validation
 * 4. Merges results with LLM taking precedence
 *
 * When disabled (default):
 * - Uses regex-only extraction (original behavior)
 *
 * @param brief - The decision brief text
 * @param options - Extraction options
 * @returns Extraction result with factors and metadata
 */
export async function extractFactorsOrchestrated(
  brief: string,
  options: OrchestratedExtractionOptions = {}
): Promise<OrchestratedExtractionResult> {
  const { domain, context: providedContext, forceRegex = false, forceLLM = false, modelOverride } = options;
  const warnings: string[] = [];

  // Check feature flag
  const llmEnabled = config.cee.llmFirstExtractionEnabled;
  const useLLM = (llmEnabled || forceLLM) && !forceRegex;

  if (!useLLM) {
    // Regex-only mode (default)
    log.debug({ event: "cee.factor_extraction.mode", mode: "regex-only" }, "Using regex-only extraction");
    const factors = extractFactors(brief);
    return {
      factors,
      mode: "regex-only",
      warnings: [],
    };
  }

  // LLM-first mode
  log.debug({ event: "cee.factor_extraction.mode", mode: "llm-first" }, "Using LLM-first extraction");

  // Resolve context
  const context = providedContext ?? resolveContext(brief, domain);

  // Run LLM extraction
  const llmResult = await extractFactorsLLM(brief, {
    context,
    maxFactors: 20,
    minConfidence: 0.5,
    validateHallucinations: true,
    modelOverride,
  });

  if (llmResult.warnings.length > 0) {
    warnings.push(...llmResult.warnings);
  }

  // Always run regex as fallback/validation
  const regexFactors = extractFactors(brief);

  if (!llmResult.success || llmResult.factors.length === 0) {
    // LLM failed, use regex only
    log.info(
      {
        event: "cee.factor_extraction.llm_fallback",
        llmError: llmResult.error,
        regexFactorCount: regexFactors.length,
      },
      "LLM extraction failed, using regex fallback"
    );
    return {
      factors: regexFactors,
      mode: "llm-first",
      llmSuccess: false,
      warnings,
    };
  }

  // Merge LLM and regex results
  const mergeResult = mergeFactors(llmResult.factors, regexFactors, {
    llmConfidenceThreshold: 0.7,
    context,
  });

  log.info(
    {
      event: "cee.factor_extraction.orchestrated_complete",
      llmFactorCount: llmResult.factors.length,
      regexFactorCount: regexFactors.length,
      mergedFactorCount: mergeResult.factors.length,
      ...mergeResult.stats,
    },
    "Orchestrated extraction complete"
  );

  return {
    factors: mergeResult.factors,
    mode: "llm-first",
    llmSuccess: true,
    mergeStats: mergeResult.stats,
    warnings,
  };
}

// Re-export types and functions from sub-modules
export type { MergedFactor, MergeResult } from "./merge.js";
export { mergeFactors, normalizeLabel, labelSimilarity, deduplicateFactors } from "./merge.js";
export { extractFactorsLLM, type LLMExtractionOptions, type LLMExtractionResult } from "./llm-extractor.js";
