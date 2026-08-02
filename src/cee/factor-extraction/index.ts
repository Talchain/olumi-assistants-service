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

// Multiplier values for k, m, b, million, billion, etc.
const MULTIPLIER_MAP: Record<string, number> = {
  "k": 1_000,
  "K": 1_000,
  "m": 1_000_000,
  "M": 1_000_000,
  "million": 1_000_000,
  "Million": 1_000_000,
  "b": 1_000_000_000,
  "B": 1_000_000_000,
  "billion": 1_000_000_000,
  "Billion": 1_000_000_000,
  "t": 1_000_000_000_000,
  "T": 1_000_000_000_000,
  "trillion": 1_000_000_000_000,
  "Trillion": 1_000_000_000_000,
};

/**
 * Parse a multiplier string (k, m, million, etc.) to its numeric value
 */
function parseMultiplier(multiplier: string | undefined): number {
  if (!multiplier) return 1;
  return MULTIPLIER_MAP[multiplier.trim()] ?? 1;
}

/* ===========================================================================
 * THE MAGNITUDE ALPHABET — ONE list, TWO consumers (ROADMAP 2.303)
 *
 * WHY IT LIVES HERE, above everything that uses it. `contextualNumber` was
 * MULTIPLIER-BLIND: it captured the digits of "target is 800k" and dropped the
 * suffix, so the goal card — the first card a tester reads — displayed `800`
 * against a label saying £800k (journey re-walk 2026-08-02 §5 / N7, live).
 * The paired extractor `extractGoalTargetWithBaseline` has understood the
 * alphabet since #787; the repair is to REUSE that alphabet, never to write a
 * second copy of it beside the first. Two same-purpose lists that can drift is
 * this estate's dominant defect class (CLAUDE.md trap 12) and the reason a
 * hand-copied literal here would be a worse outcome than the bug it fixed.
 *
 * DERIVED, NOT DECLARED TWICE. The regex alternation is COMPUTED from the map
 * keys rather than spelled out beside them, so a key added to the map is
 * matchable on both paths the instant it lands, with nothing to remember.
 *
 * ORDERING IS THE SAFETY PROPERTY, and it is now guaranteed by construction.
 * Alternation is first-match-wins, so a shorter key that PREFIXES a longer one
 * ("b" before "bn", "m" before "million") would swallow it. Sorting
 * longest-first cannot get that wrong for any key, present or future — where a
 * hand-ordered list could, silently, the next time someone appends to it.
 * ========================================================================= */

/**
 * Every magnitude suffix this module recognises, and what it multiplies by.
 * Matched case-INSENSITIVELY (both patterns carry the `i` flag), so `K`, `M`,
 * `BN` and `Million` all resolve through their lower-cased key.
 *
 * Exported for the drift guard, which derives its whole manifest from this map
 * so it cannot go stale as the map grows.
 */
export const MAGNITUDE_MULTIPLIERS: Readonly<Record<string, number>> = {
  k: 1e3,
  m: 1e6,
  bn: 1e9,
  b: 1e9,
  t: 1e12,
  million: 1e6,
  billion: 1e9,
  trillion: 1e12,
};

/**
 * The alternation branch for the alphabet above, longest-first.
 *
 * The tie-break is lexicographic so the string is a pure function of the KEY
 * SET — insertion order cannot change it, and neither can a re-format.
 */
export const MAGNITUDE_ALTERNATION: string = Object.keys(MAGNITUDE_MULTIPLIERS)
  .sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0))
  .join("|");

/**
 * The digit grammar shared by every amount this module reads: optional
 * thousands separators, optional decimals. Separators are stripped before
 * parsing (`parseAmountDigits`) — `parseFloat("800,000")` is 800, which is the
 * same silent 1,000× loss as the dropped suffix, arriving through the comma.
 */
const AMOUNT_DIGITS = "\\d+(?:,\\d{3})*(?:\\.\\d+)?";

/**
 * The magnitude-suffix fragment, under a caller-chosen group name.
 *
 * ⚠ THE `\\s*` SITS INSIDE THE OPTIONAL GROUP, not before it. Spelled
 * `\\s*(?<g>ALT)?\\b`, the `\\s*` consumes the separating space of
 * "target is 800 customers" EVEN WHEN NO SUFFIX FOLLOWS, and every
 * `matchedText` in the corpus gains a trailing byte. Spelled
 * `(?:\\s*(?<g>ALT)\\b)?` the space is consumed only when a suffix is actually
 * there, and byte-parity holds.
 *
 * ⚠ THE INNER `\\b` IS LOAD-BEARING, and its absence produced a silent 1e12
 * error in development (#787): without it the `t` alternative matches the "t"
 * of "6000000 THIS year", scaling a 6,000,000 target to 6e18. With it, the `t`
 * branch fails, the whole group matches empty WITHOUT consuming the space, and
 * the amount reads correctly.
 */
function magnitudeSuffixPattern(group: string): string {
  return `(?:\\s*(?<${group}>${MAGNITUDE_ALTERNATION})\\b)?`;
}

/** Parse a captured digit string, separators and all, to a finite number or null. */
function parseAmountDigits(digits: string | undefined): number | null {
  if (digits === undefined) return null;
  const parsed = Number.parseFloat(digits.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

/** Resolve a captured magnitude suffix to its multiplier; absent suffix ⇒ 1. */
function resolveMagnitude(suffix: string | undefined): number {
  if (!suffix) return 1;
  return MAGNITUDE_MULTIPLIERS[suffix.toLowerCase()] ?? 1;
}

// Regex patterns for quantitative language
const PATTERNS = {
  // Currency with multiplier: $1 million, £2.5m, €500k, $1B, $1.5 billion
  currencyWithMultiplier:
    /(?<currency>[£$€])(?<amount>\d+(?:\.\d+)?)\s*(?<multiplier>k|m|b|t|million|billion|trillion)\b/gi,

  // Currency with optional decimals: £49, $100.50, €50
  currency: /(?<currency>[£$€])(?<amount>\d+(?:\.\d+)?)/g,

  // Percentage: 5%, 3.5%, 10 percent
  percentage: /(?<amount>\d+(?:\.\d+)?)\s*(?:%|percent)/gi,

  // From-to with currency: "from £49 to £59"
  currencyFromTo:
    /from\s+(?<currency1>[£$€])(?<from>\d+(?:\.\d+)?)\s+to\s+(?:[£$€])?(?<to>\d+(?:\.\d+)?)/gi,

  // From-to with percentage: "from 3% to 5%"
  percentFromTo:
    /from\s+(?<from>\d+(?:\.\d+)?)\s*%?\s+to\s+(?:maybe\s+)?(?<to>\d+(?:\.\d+)?)\s*%/gi,

  // Increase/decrease patterns: "increase from 10 to 20", "increasing by 5%"
  changePattern:
    /(?<direction>increas|decreas|rais|lower|grow|drop|fall|rise)(?:e|ing|ed)?\s+(?:from\s+)?(?<from>\d+(?:\.\d+)?)\s*(?:%|[£$€])?\s+(?:to\s+)?(?:maybe\s+)?(?<to>\d+(?:\.\d+)?)/gi,

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
  approximateValue:
    /(?:around|roughly|approximately|about|circa|~)\s*(?<currency>[£$€])?(?<amount>\d+(?:\.\d+)?)\s*(?<unit>%)?/gi,

  // Range with currency: "between £50-70", "£50-£70", "50-70 dollars"
  currencyRange:
    /(?:between\s+)?(?<currency>[£$€])(?<min>\d+(?:\.\d+)?)\s*[-–—to]+\s*(?:[£$€])?(?<max>\d+(?:\.\d+)?)/gi,

  // Range with percentage: "between 5-10%", "5%-10%"
  percentRange:
    /(?:between\s+)?(?<min>\d+(?:\.\d+)?)\s*%?\s*[-–—to]+\s*(?<max>\d+(?:\.\d+)?)\s*%/gi,

  // Generic range: "between 50 and 70", "50 to 70"
  genericRange:
    /between\s+(?<min>\d+(?:\.\d+)?)\s+(?:and|to)\s+(?<max>\d+(?:\.\d+)?)/gi,
};

/* ---------------------------------------------------------------------------
 * DRIFT-GUARD SURFACE (ROADMAP 2.303).
 *
 * `PATTERNS` and `amountPattern` are module-private and stay that way; these
 * two aliases exist ONLY so the drift guard can assert, structurally, that
 * BOTH magnitude-bearing patterns are built from the ONE derived alternation.
 * Without them the guard could only test behaviour, and a hand-copied literal
 * that happens to be byte-correct on the day it is written would pass — which
 * is precisely the mirror that later drifts (CLAUDE.md trap 12).
 * ------------------------------------------------------------------------- */
export const PATTERNS_FOR_DRIFT_GUARD: { readonly contextualNumber: RegExp } = {
  contextualNumber: PATTERNS.contextualNumber,
};
export function amountPatternForDriftGuard(prefix: string): string {
  return amountPattern(prefix);
}

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
 */
function amountPattern(prefix: string): string {
  return (
    `(?<${prefix}Cur>[£$€])?(?<${prefix}>${AMOUNT_DIGITS})` +
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
    `${magnitudeSuffixPattern(`${prefix}Mult`)}\\b\\s*(?<${prefix}Pct>%)?`
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
  "annually", "monthly", "weekly", "daily", "yearly",
  "annual", "quarterly", // #795 review amendment 2 — the -ly/-al forms were
  // missing while "annually"/"monthly" were present, so "6M annual" against a
  // currency level refused via the cross-signal rule
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

function resolveTrailingMetric(
  groups: Record<string, string | undefined>,
  prefix: string,
): TrailingMetric {
  const word = groups[`${prefix}Metric`];
  if (!word) return {};
  const lower = word.toLowerCase();
  if (METRIC_NOUN_STOPWORDS.has(lower)) return {};
  const currency = CURRENCY_WORDS[lower];
  if (currency) return { currency };
  return { noun: stemMetricNoun(lower) };
}

/** The named refusal reasons for a goal (target, baseline) pair. */
type GoalPairRefusalReason =
  | "mixed_percent_pair"
  | "currency_mismatch"
  | "metric_noun_mismatch"
  | "currency_vs_metric_noun";

/**
 * Refuse the pair, BY NAME. Refusal is honest: no baseline is minted, ISL
 * refuses with `missing_goal_baseline`, and the user is asked for the level —
 * instead of being served arithmetic across two different metrics.
 */
function refuseGoalPair(
  reason: GoalPairRefusalReason,
  detail: Record<string, string | undefined>,
): null {
  log.info(
    { event: "cee.factor_extraction.goal_pair_refused", reason, ...detail },
    `Goal target/baseline pair refused: ${reason}`,
  );
  return null;
}

/**
 * The three brief shapes that state a current level AND a target together.
 * Order is priority order; the first match for a given (label, value, unit)
 * wins and later extractors dedup against it.
 */
const GOAL_BASELINE_PATTERNS: ReadonlyArray<RegExp> = [
  // "from 4000000 to a target of 6000000", "from 85% to a target of 95%".
  // No bridge needed: both amounts are inside ONE "from … to … target"
  // construction, so they cannot belong to different clauses.
  new RegExp(
    `\\bfrom\\s+${amountPattern('from')}\\s+to\\s+(?:a|an|the)?\\s*` +
      `${GOAL_WORD}\\s*(?:of|is|:)?\\s*${amountPattern('to')}`,
    'i',
  ),
  // "target is 800 customers, currently at 500" — both amounts capture their
  // trailing metric word (2.287), so cross-metric pairs can be REFUSED.
  new RegExp(
    `\\b${GOAL_WORD}${GOAL_CONNECTOR}${amountWithMetricPattern('to')}` +
      `${CLAUSE_BRIDGE}\\bcurrently\\s*(?:at|around|about)?\\s*${amountWithMetricPattern('from')}`,
    'i',
  ),
  // "currently at 500, target 800"
  new RegExp(
    `\\bcurrently\\s*(?:at|around|about)?\\s*${amountWithMetricPattern('from')}` +
      `${CLAUSE_BRIDGE}\\b${GOAL_WORD}${GOAL_CONNECTOR}${amountWithMetricPattern('to')}`,
    'i',
  ),
];

/**
 * Resolve one captured amount to a raw magnitude in USER units, plus the unit
 * signals it carried. Percent scaling is applied by the caller, which needs to
 * see BOTH sides before deciding the pair's unit.
 */
function resolveAmount(
  groups: Record<string, string | undefined>,
  prefix: string,
): { readonly raw: number; readonly isPercent: boolean; readonly currency?: string } | null {
  const parsed = parseAmountDigits(groups[prefix]);
  if (parsed === null) return null;
  return {
    raw: parsed * resolveMagnitude(groups[`${prefix}Mult`]),
    isPercent: groups[`${prefix}Pct`] === '%',
    currency: groups[`${prefix}Cur`],
  };
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
  for (const pattern of GOAL_BASELINE_PATTERNS) {
    const m = pattern.exec(text);
    if (!m?.groups) continue;

    const to = resolveAmount(m.groups, "to");
    const from = resolveAmount(m.groups, "from");
    if (!to || !from) continue;

    // A MIXED percent pair is refused, not reconciled (adversarial review, PR
    // #787). This previously read `to.isPercent || from.isPercent`, which
    // scaled BOTH sides by 100 whenever EITHER carried a '%': "from 85 to a
    // target of 95%" wrote baseline 0.85 from a number the user never
    // expressed as a percentage. The result lands squarely inside ISL's |1.5|
    // domain guard, and a MAGNITUDE guard is structurally incapable of
    // catching a UNIT error that lands in range. If the two amounts disagree
    // about being percentages they are not reliably the same quantity, so no
    // pair is formed and ISL keeps refusing honestly.
    if (to.isPercent !== from.isPercent) {
      return refuseGoalPair("mixed_percent_pair", {});
    }

    // ROADMAP 2.288 — a MIXED CURRENCY pair is refused, not reconciled. This
    // used to carry a NOTE calling currency "a display unit" and forming the
    // pair anyway: "from $4M to a target of £6M" subtracted dollars from
    // pounds under one cap. That note was wrong at its premise — two explicit,
    // DIFFERENT currencies are not one scale, there is no FX conversion in
    // this codebase, and inventing a rate would be fabrication with extra
    // steps. Currency words fold in first, so "4M dollars" vs "£6M" refuses
    // identically. Same-currency and no-currency pairs are untouched.
    const toMetric = resolveTrailingMetric(m.groups, "to");
    const fromMetric = resolveTrailingMetric(m.groups, "from");
    const toCurrency = to.currency ?? toMetric.currency;
    const fromCurrency = from.currency ?? fromMetric.currency;
    if (toCurrency && fromCurrency && toCurrency !== fromCurrency) {
      return refuseGoalPair("currency_mismatch", {
        target_currency: toCurrency,
        baseline_currency: fromCurrency,
      });
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
        return refuseGoalPair("metric_noun_mismatch", {
          target_metric: toMetric.noun,
          baseline_metric: fromMetric.noun,
        });
      }
    } else if (toCurrency && !fromCurrency && fromMetric.noun) {
      // Cross-signal: an explicit CURRENCY target against an explicit
      // non-currency noun level ("$800k" vs "50 employees") is the same
      // cross-metric class wearing a symbol instead of a word.
      return refuseGoalPair("currency_vs_metric_noun", {
        target_currency: toCurrency,
        baseline_metric: fromMetric.noun,
      });
    } else if (fromCurrency && !toCurrency && toMetric.noun) {
      return refuseGoalPair("currency_vs_metric_noun", {
        baseline_currency: fromCurrency,
        target_metric: toMetric.noun,
      });
    }

    // Both sides now agree. Percent values are pre-divided into a 0-1
    // fraction, matching every other extractor in this file; callers that need
    // the RAW percent number reconstruct it. The emitted `unit` still comes
    // from the SYMBOL captures only (not folded currency words) — byte-parity
    // with the pre-2.288 output for every pair that still forms.
    const isPercent = to.isPercent;
    return {
      value: isPercent ? to.raw / 100 : to.raw,
      baseline: isPercent ? from.raw / 100 : from.raw,
      unit: isPercent ? "%" : (to.currency ?? from.currency),
      matchedText: m[0],
    };
  }
  return null;
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
    const min = parseFloat(match.groups?.min || "0");
    const max = parseFloat(match.groups?.max || "0");
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
    const min = parseFloat(match.groups?.min || "0") / 100;
    const max = parseFloat(match.groups?.max || "0") / 100;
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
    const min = parseFloat(match.groups?.min || "0");
    const max = parseFloat(match.groups?.max || "0");
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
    const amount = parseFloat(match.groups?.amount || "0");
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
  const goalPair = extractGoalTargetWithBaseline(brief);
  if (goalPair) {
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
    const from = parseFloat(match.groups?.from || "0");
    const to = parseFloat(match.groups?.to || "0");
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
    const from = parseFloat(match.groups?.from || "0") / 100;
    const to = parseFloat(match.groups?.to || "0") / 100;
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
    const from = parseFloat(match.groups?.from || "0");
    const to = parseFloat(match.groups?.to || "0");
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
    const baseAmount = parseFloat(match.groups?.amount || "0");
    const multiplier = parseMultiplier(match.groups?.multiplier);
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
    const currency = match.groups?.currency || "";
    const amount = parseFloat(match.groups?.amount || "0");
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
    const amount = parseFloat(match.groups?.amount || "0") / 100;
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
