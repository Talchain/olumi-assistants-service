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
