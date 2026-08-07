/**
 * Shared reduction-framing detection (ROADMAP 1.52 — goal-fit sign
 * inversion).
 *
 * THE BUG: "reduce/decrease X by N%" states a CHANGE amount — the target
 * metric moves DOWN when the goal succeeds. Encoding that as `{operator:
 * '>=', value: +N}` (the naive positive reading of "N%") asserts the
 * OPPOSITE of the user's intent whenever the constrained node's own
 * distribution is the signed delta itself (a relocation scenario's "cost
 * change" outcome goes NEGATIVE on success): `P(samples >= +0.15)` is
 * then ~0 by construction, no matter how good the option actually is.
 * Hand-verified on the 6B capture: displayed ~0%, honest number ~97-99%.
 *
 * THE "BY" SIGNAL: "by" states a relative change ("reduce cost BY 15%");
 * "to"/"under"/"below" state an absolute level ("reduce cost TO £40k",
 * "keep cost under £40k") and are unaffected — those already round-trip
 * correctly as ordinary upper bounds. Reduction-verb + "by" is therefore
 * a textually determinable, conservative fingerprint: verb list is
 * closed (reduce/decrease/cut/lower/shrink, all unambiguous decrease
 * verbs — no "improve"/"change"/"adjust" style verbs that could go
 * either way), and the pattern requires the literal word "by" nearby.
 * Anything outside that closed pattern is left alone — never guessed.
 *
 * Single source of truth for the verb vocabulary — both the deterministic
 * compound-goal extractor (`cee/compound-goal/extractor.ts`, which builds
 * the flipped `{operator: '<=', value: -N}` encoding) and the
 * `add_constraint` handler backstop (`orchestrator-v5/tools/handlers/
 * add-constraint.ts`, which blocks a live wrong-sign persist rather than
 * guessing a fix) key off this one list so they cannot drift apart.
 */

import {
  AMOUNT_DIGITS,
  magnitudeSuffixPattern,
  resolveMagnitude,
} from './magnitude-alphabet.js';

/** Closed set of unambiguous decrease verbs (all inflections). */
export const REDUCTION_VERB_PATTERN =
  '(?:reduce|reduces|reducing|reduced|decrease|decreases|decreasing|decreased|' +
  'cut|cuts|cutting|lower|lowers|lowering|lowered|shrink|shrinks|shrinking|shrunk)';

/**
 * Whole-text "<reduction verb> ... by" scan. Deliberately coarse (not
 * clause-scoped) — this is a SAFETY check, not an extractor: a false
 * positive only ever routes to a clarify/reject path (see
 * add-constraint.ts), never a silent wrong-sign persist, so
 * over-triggering is the safe failure direction. Bounded lookahead
 * (`{0,60}`, no sentence-boundary crossing) keeps it from spanning
 * unrelated clauses within the same message.
 */
const REDUCTION_BY_FRAMING_RE = new RegExp(
  `\\b${REDUCTION_VERB_PATTERN}\\b[^.?!\\n]{0,60}\\bby\\b`,
  'i',
);

/**
 * True when `text` contains reduction-verb + "by" framing anywhere
 * (case-insensitive). Used as a conservative backstop signal, not an
 * extraction — callers decide what to do (flip, block, clarify).
 */
export function hasReductionByFraming(text: string): boolean {
  return REDUCTION_BY_FRAMING_RE.test(text);
}

/* ===========================================================================
 * INCREASE-side framing (ROADMAP 2.273 prerequisite).
 *
 * This module's verb vocabulary was decrease-ONLY, which left "grow revenue BY
 * 2M" invisible to every backstop above: it encoded naively as `{operator:
 * '>=', value: +2_000_000}` and the goal-threshold mint then attested that
 * number as `goal_threshold_frame: 'level'` — an ABSOLUTE level — when the
 * user stated a CHANGE. Until 2.273 that was inert, because a goal node
 * carried no `observed_state.baseline` and ISL refused to convert a 'level'
 * threshold at all. Populating the baseline (2.273) turns the same
 * misencoding into a live FABRICATION: ISL returns a confident
 * `probability_of_goal` for "P(revenue >= 2M)" when the user asked
 * "P(revenue >= 6M)". Hence this ships before/with the extraction.
 *
 * WHY THIS DETECTOR IS SHARPER THAN THE REDUCTION ONE ABOVE. The reduction
 * scan can be coarse because reduction-verb + "by" is unambiguous and a false
 * positive only costs a clarifying round-trip. An increase verb is NOT
 * unambiguous: "increase conversion TO 5% BY December" is a LEVEL statement
 * whose "by" introduces a DATE, and blocking it would be a product
 * regression — a false positive here would refuse the very registrations the
 * goal-threshold stamp exists to serve. So this requires all three of:
 *   1. an unambiguous increase verb,
 *   2. "by" followed by a NUMBER (never "by December"),
 *   3. NO intervening "to <number>" level statement between verb and "by",
 * and it RETURNS THE STATED DELTA rather than a boolean, so the caller can
 * refuse only when the persisted value provably IS that delta.
 * ========================================================================= */

/**
 * Closed set of unambiguous INCREASE verbs (all inflections).
 *
 * Deliberately excludes "improve"/"change"/"adjust"/"optimise" — the same
 * exclusion the reduction list makes, for the same reason and with a concrete
 * counter-example: "improve churn BY 10%" means churn goes DOWN, so treating
 * "improve" as an increase verb would invert the very sign this module exists
 * to protect.
 */
export const INCREASE_VERB_PATTERN =
  '(?:increase|increases|increasing|increased|grow|grows|growing|grew|grown|' +
  'raise|raises|raising|raised|boost|boosts|boosting|boosted|' +
  'lift|lifts|lifting|lifted|expand|expands|expanding|expanded|' +
  'rise|rises|rising|rose|risen)';


/**
 * `<increase verb> … by <number>`, with the span between verb and "by"
 * TEMPERED so it cannot cross a `to <number>` level statement. The `{0,80}`
 * bound is lazy so the NEAREST qualifying "by" wins, and `[^.?!\n]` keeps the
 * scan inside one sentence (same containment rule as the reduction scan).
 */
const INCREASE_BY_DELTA_RE = new RegExp(
  `\\b${INCREASE_VERB_PATTERN}\\b` +
    `(?:(?!\\bto\\s+[£$€]?\\d)[^.?!\\n]){0,80}?` +
    `\\bby\\s+[£$€]?(?<amount>${AMOUNT_DIGITS})` +
    // ROADMAP 2.322 — this used to spell the alphabet out as
    // `million|billion|trillion|bn|k|m|b|t`: a byte-for-byte COPY of the map
    // that sat ten lines above it, plus a hand-ordered longest-first sort that
    // a future append could silently get wrong. Both are now DERIVED from the
    // one alphabet, which also supplies the trailing `\b` that stops a bare
    // `t`/`m` eating the first letter of the following word ("by 2 THIS
    // quarter" → 2e12).
    // ⚠ THE TRAILING `\b` IS LOAD-BEARING AND IS *NOT* PART OF THE SHARED
    // FRAGMENT. It is what makes an ATTACHED trailer refuse: with it,
    // "by 5mARR" fails to match at all and this returns null ("no stated
    // delta"), which is the conservative answer for a run that may be five
    // million or may be five. Dropping it — measured on the first cut of this
    // change — turned "by 5mARR" into 5, a silent 1e6× under-read on a value
    // used as an EQUALITY fingerprint by the add_constraint backstop. The
    // alphabet is derived; this boundary is this call site's own semantics.
    `${magnitudeSuffixPattern('multiplier')}\\b`,
  'i',
);

/**
 * The DELTA amount stated by an increase-verb "by" framing, or `null` when the
 * text carries no such framing.
 *
 * EXTRACTION ONLY — this never infers, defaults, or rounds. `null` means "no
 * stated delta was found", which callers must treat as "no fingerprint", never
 * as zero. Percentages return the RAW PERCENT NUMBER (10 for "by 10%"),
 * matching the "value stored in USER UNITS" convention `add_constraint` uses
 * for `goal_threshold_raw`, so a caller can compare it directly against a
 * resolved constraint value without re-scaling.
 */
/**
 * Relative-tolerance equality for comparing a resolved constraint value
 * against a stated delta. Both sides originate as decimal literals in user
 * units, so exact `===` holds for every realistic input — the tolerance only
 * guards the float round-trip on values like `2.5e6` and must stay far tighter
 * than any meaningful difference between a delta and a level.
 */
export function valuesMatch(a: number, b: number): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}

export function extractIncreaseByDelta(text: string): number | null {
  const match = INCREASE_BY_DELTA_RE.exec(text);
  if (!match?.groups) return null;

  const amount = Number.parseFloat(match.groups.amount.replace(/,/g, ''));
  if (!Number.isFinite(amount)) return null;

  return amount * resolveMagnitude(match.groups.multiplier);
}
