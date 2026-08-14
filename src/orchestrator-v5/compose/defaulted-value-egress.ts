/**
 * F6 — THE DEFAULTED-VALUE EGRESS INVARIANT. One authority, at the chokepoint.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE INVARIANT
 *
 * For every ANALYSIS-BEARING conversational answer produced over a run whose
 * engine reported defaulted values:
 *
 *   (a) the canonical disclosure appears EXACTLY ONCE;
 *   (b) stability language is stood down;
 *   (c) p(win) is never re-told as stability or robustness.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY A SEPARATE LAYER, WHEN THE COMPOSERS ALREADY DO THIS
 *
 * They do — and they are not enough, for a reason that is structural rather
 * than a gap in their care. `composeRobustnessVerdict` collapses the stability
 * axis and emits the disclosure, and every DETERMINISTIC surface routes through
 * it. But the deterministic surfaces are not the only way an answer reaches the
 * user. When `tryPostAnalysisAdviceGate` returns `matched: false` — which it
 * does on `data_unavailable_for_class` with `missing_inputs: ['leading_option']`
 * whenever `leading_option_id` is null — control falls through to the GENERIC
 * LLM ROUTER, and the verdict composer never runs at all. That is the exact
 * input cell the live case fired on: defaults present, no leading option, an
 * answer composed by a model that has never heard of this rule.
 *
 * A fix confined to the composers therefore closes the paths it can see and
 * leaves the one it cannot. This layer is the answer to "the producers we do
 * NOT know about" — the same argument `leading-option-egress-guard.ts` makes
 * for leader claims, and the same shape: a whole-text pass at the single
 * chokepoint, downstream of every composer.
 *
 * ⚠ AND IT IS DELIBERATELY *ALSO* APPLIED TO THE DETERMINISTIC PATHS, not
 * bypassed for them. If it ran only on the generic route, the two arms would
 * be two derivations of one rule and would drift (CLAUDE.md trap 12). Running
 * it everywhere is what makes the exactly-once dedupe below load-bearing rather
 * than defensive: on a deterministic answer the disclosure is ALREADY present,
 * this layer finds it, and appends nothing.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * SUPPRESS, NEVER REWRITE — AND THE GAP IS DECLARED, NOT PAPERED OVER
 *
 * Requirement (b)/(c) is a predicate over natural language, which this estate
 * has already paid for four times in one PR (CLAUDE.md trap 22f: four rounds on
 * one NL predicate, each fixing one direction and opening the other; the ruling
 * was that no further punctuation-only rule settles it). The lesson is applied
 * here rather than relearned:
 *
 *   · The patterns are SOURCED FROM THE PRODUCT'S OWN EMITTED SENTENCES
 *     (`explanation-fallback.ts` and `post-analysis-advice-gate.ts`, quoted at
 *     each pattern), never from the author's idea of how a model might phrase
 *     stability. A corpus from the author's head cannot see the class the
 *     author did not imagine (trap 22).
 *   · A matched sentence is DROPPED WHOLE. Nothing is inverted, negated or
 *     reworded, so there is no second direction for a fix to reopen.
 *   · The known-suppressed and known-KEPT corpora are pinned by name in the
 *     suite, which REDs if either set grows OR shrinks — an honest record of a
 *     bounded matcher rather than a claim of completeness.
 *
 * ⭐ THE DECLARED GAP. An arbitrary model paraphrase of stability that uses
 * none of the anchored vocabulary is NOT suppressed by this layer. That is a
 * real limit and it is stated rather than hidden. What makes it tolerable is
 * that (a) is unconditional: the disclosure is appended regardless, so even an
 * unrecognised paraphrase now arrives next to "the comparison is illustrative
 * until those values are set" instead of standing alone. The floor this layer
 * guarantees is that the user is never told the numbers are solid WITHOUT also
 * being told they rest on defaults.
 */

import {
  buildDefaultedAssumptionsDisclosure,
  DEFAULTED_DISCLOSURE_TAIL,
  type DefaultedAssumptionsSignal,
} from '../coaching/pick-defaulted-assumptions.js';

/**
 * Sentence enumeration, decimal-safe.
 *
 * Composed from the same three fragments as `routing/answer-shape.ts`'s
 * `INTERNAL_SENTENCE_BOUNDARY`, and for the identical reason: a boundary is a
 * terminator run, then whitespace, then the start of the next sentence. A bare
 * `.` inside a number never matches, because a decimal point is not followed by
 * whitespace.
 *
 * ⚠ THIS IS THE TRAP-22 FAILURE IN MINIATURE AND IT IS WHY THE SPLIT IS NOT
 * `text.split(/[.!?]/)`. That naive form cuts `£1.5 million` into `£1` and
 * `5 million`, which is precisely how a correct guard came to be pointed at the
 * wrong bytes: "the guard was correct and pointed at the wrong bytes". A
 * suppressor that splits on the decimal point would mangle every recited
 * probability it was written to police.
 */
const SENTENCE_TERMINATOR = `[.!?]["')\\]]*`;
const SENTENCE_GAP = `\\s+`;
const SENTENCE_NEXT_START = `["'([]?[A-Z0-9]`;
const SENTENCE_BOUNDARY_G = new RegExp(
  `(?<=${SENTENCE_TERMINATOR})${SENTENCE_GAP}(?=${SENTENCE_NEXT_START})`,
  'g',
);

/** Split into whole sentences, preserving each sentence's own bytes. */
export function enumerateSentences(text: string): string[] {
  return text.split(SENTENCE_BOUNDARY_G);
}

/**
 * A recited probability — the `p(win)` half of the harm.
 *
 * Structural, not lexical: a digit followed by a percent sign. This is what
 * makes an answer ANALYSIS-BEARING for the purposes of this layer, and it is
 * deliberately a SHAPE rather than a vocabulary, so it cannot be evaded by
 * rephrasing and cannot drift as copy changes.
 */
const PROBABILITY_FIGURE = /\d\s*%/;

/**
 * STABILITY / ROBUSTNESS ASSERTIONS OVER THE RESULT.
 *
 * ⭐ EVERY PATTERN QUOTES THE PRODUCT SENTENCE IT WAS DERIVED FROM. A pattern
 * with no such provenance does not belong in this list — that is the rule that
 * keeps the matcher bound to what we actually emit (trap 22) rather than
 * growing into a general-purpose censor.
 *
 * The subject is pinned to the RESULT/OUTCOME/PICTURE family on purpose. An
 * unanchored `/stable/` would drop "we could stabilise the wholesale price",
 * which is a legitimate sentence about a FACTOR, not a claim about the run —
 * and dropping it would be the over-suppression half of trap 22b, bought for
 * nothing. The known-KEPT corpus pins exactly those near misses.
 */
export const STABILITY_ASSERTION_PATTERNS: readonly RegExp[] = [
  // explanation-fallback.ts — "This result looks ${stabilityPhrase}, so smaller
  // changes are less likely to flip the outcome on their own."
  // post-analysis-advice-gate.ts — "This result looks ${stabilityPhrase}, so
  // smaller adjustments may not move the picture much." / "…so this view should
  // hold under reasonable variation." / "…but it is worth checking the main
  // assumptions before deciding."
  // The four phrases come from `describeRobustnessBand`: very stable, stable,
  // fairly stable, fragile.
  /\bthis result looks (?:very |fairly |quite |highly )?(?:stable|robust|fragile)\b/i,
  // post-analysis-advice-gate.ts — "The picture appears fragile, so …" (both
  // the noFlip and the plain arm).
  /\bthe picture appears fragile\b/i,
  // post-analysis-advice-gate.ts — "Each option's own score is individually
  // stable, so this is a genuine dead heat rather than noise in the estimates."
  /\bindividually stable\b/i,
  // explanation-fallback.ts — the near-tie fragility arm: "The result is
  // sensitive to small movements in the strongest drivers, so the leading
  // option could change without much shifting."
  /\bthe result is sensitive to small movements\b/i,
  // The behavioural prediction the collapse exists to stop, in either
  // direction. explanation-fallback.ts: "…so smaller changes are less likely to
  // flip the outcome on their own."
  /\bless likely to flip\b/i,
  // post-analysis-advice-gate.ts — "…so this view should hold under reasonable
  // variation."
  /\bhold under reasonable variation\b/i,
  // The generic model paraphrase of the same claim, anchored to the RESULT
  // family so a factor-level sentence cannot match. Covers "the result is
  // stable", "these findings appear robust", "the outcome seems very stable".
  /\b(?:this |these |the )?(?:results?|outcomes?|findings?|rankings?|pictures?)\s+(?:is|are|looks?|appears?|seems?)\s+(?:very |fairly |quite |highly )?(?:stable|robust)\b/i,
];

export function findStabilityAssertion(sentence: string): RegExp | null {
  for (const re of STABILITY_ASSERTION_PATTERNS) {
    if (re.test(sentence)) return re;
  }
  return null;
}

/**
 * Does this text make an analysis claim this layer is entitled to qualify?
 *
 * ⚠ THE GATE IS WHY AN EDIT RECEIPT DOES NOT GROW A CAVEAT. A defaulted
 * analysis exists for the WHOLE session once it has run, so an unconditional
 * append would staple the disclosure onto every clarify, every edit receipt and
 * every "let me know what you'd like next" for the rest of the conversation.
 * The caveat would still be TRUE — and it would still be wrong to ship, because
 * a disclosure attached to everything is read as boilerplate and stops being
 * read at all, which is how a true sentence stops disclosing anything.
 */
export function isAnalysisBearing(text: string): boolean {
  return PROBABILITY_FIGURE.test(text) || findStabilityAssertion(text) !== null;
}

export interface DefaultedValueEgressResult {
  /** The text to ship. Reference-identical to the input when unchanged. */
  readonly text: string;
  readonly changed: boolean;
  /** Whole sentences dropped for asserting stability over defaulted inputs. */
  readonly suppressed: readonly string[];
  /** True when this layer appended the disclosure (false when already present). */
  readonly disclosureAdded: boolean;
  /** Duplicate disclosures removed to satisfy the exactly-once invariant. */
  readonly duplicatesRemoved: number;
  readonly mode:
    | 'no_defaults'
    | 'not_analysis_bearing'
    | 'applied';
}

function unchanged(
  text: string,
  mode: DefaultedValueEgressResult['mode'],
): DefaultedValueEgressResult {
  return {
    text,
    changed: false,
    suppressed: [],
    disclosureAdded: false,
    duplicatesRemoved: 0,
    mode,
  };
}

/**
 * Apply the invariant. PURE — never throws, never mutates its input.
 *
 * NEVER THROWS is the house rule at this chokepoint (`turn-executor.ts`'s
 * finalise-path invariant): throwing at egress hands the user a 500 in place of
 * a curated answer, which is strictly worse than the sentence we are trying to
 * qualify.
 *
 * BYTE-NEUTRAL BY REFERENCE when there is nothing to do, so the no-defaults
 * direction can be asserted with `toBe` rather than `toEqual` and no future
 * refactor can quietly start rewriting text on runs that defaulted nothing.
 */
export function applyDefaultedValueEgress(
  text: string | null | undefined,
  signal: DefaultedAssumptionsSignal | null | undefined,
): DefaultedValueEgressResult {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return unchanged(typeof text === 'string' ? text : '', 'no_defaults');
  }
  // NO DEFAULTS ⇒ NOT ONE BYTE. The product must never invent a caveat about a
  // run that defaulted nothing; that would be the mirror-image dishonesty of
  // the defect this closes (CLAUDE.md trap 22b — one predicate, two harms).
  if (signal == null || signal.count <= 0) {
    return unchanged(text, 'no_defaults');
  }
  if (!isAnalysisBearing(text)) {
    return unchanged(text, 'not_analysis_bearing');
  }

  const suppressed: string[] = [];
  let duplicatesRemoved = 0;
  let seenDisclosure = false;

  const kept: string[] = [];
  for (const sentence of enumerateSentences(text)) {
    // (a) EXACTLY ONCE — the first canonical disclosure survives; any further
    // copy is dropped. Recognised by the builder's own invariant tail, imported
    // rather than re-spelled, so this can never stop recognising the
    // deterministic composers' sentence.
    if (sentence.includes(DEFAULTED_DISCLOSURE_TAIL)) {
      if (seenDisclosure) {
        duplicatesRemoved += 1;
        continue;
      }
      seenDisclosure = true;
      kept.push(sentence);
      continue;
    }
    // (b) + (c) — stand down stability language over defaulted inputs.
    const hit = findStabilityAssertion(sentence);
    if (hit !== null) {
      suppressed.push(sentence);
      continue;
    }
    kept.push(sentence);
  }

  let out = kept.join(' ').replace(/\s+\n/g, '\n').trim();

  let disclosureAdded = false;
  if (!seenDisclosure) {
    const disclosure = buildDefaultedAssumptionsDisclosure(signal);
    out = out.length > 0 ? `${out} ${disclosure}` : disclosure;
    disclosureAdded = true;
  }

  if (out === text) return unchanged(text, 'applied');

  return {
    text: out,
    changed: true,
    suppressed: Object.freeze(suppressed),
    disclosureAdded,
    duplicatesRemoved,
    mode: 'applied',
  };
}
