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
 * ⭐ THE DECLARED GAP, STATED NARROWLY — and the wider version of this sentence
 * was WRONG, so it is corrected here rather than softened (CLAUDE.md trap 14).
 *
 * It used to read: *"(a) is unconditional: the disclosure is appended
 * regardless, so even an unrecognised paraphrase now arrives next to the
 * caveat."* That is FALSE. (a) is gated on {@link isAnalysisBearing}, and a
 * gate is not a guarantee. The review measured the gap in both directions
 * before the gate was rebuilt — an edit receipt collecting the caveat because
 * it happened to contain "5%", and a genuine recitation escaping it because it
 * contained no figure at all.
 *
 * THE HONEST STATEMENT OF WHAT THIS LAYER GUARANTEES:
 *
 *   · If the answer asserts stability in the ANCHORED vocabulary, that sentence
 *     is dropped AND the disclosure is appended.
 *   · If the answer recites a standing in the SHARED leader vocabulary or the
 *     supplementary recitation forms, the disclosure is appended.
 *   · Otherwise this layer does nothing at all — deliberately, so the caveat
 *     does not become boilerplate.
 *
 * So an unrecognised paraphrase that ALSO recites a standing still gets the
 * caveat (the common case); one that recites nothing this layer recognises gets
 * neither. That residue is real, is bounded by the pinned corpora, and is the
 * reason the composer-level collapse in `explanation-fallback.ts` remains the
 * primary defence rather than this layer.
 */

import { textAssertsLeadingOption } from './leading-option-egress-guard.js';
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
  `(?<=${SENTENCE_TERMINATOR})(${SENTENCE_GAP})(?=${SENTENCE_NEXT_START})`,
  'g',
);

/**
 * Abbreviations whose full stop is NOT a sentence end.
 *
 * ⚠ SOURCED FROM A REVIEW BREACH, NOT FROM IMAGINATION. `e.g.` was measured
 * splitting mid-sentence, which would let half a sentence be suppressed while
 * the other half shipped — a mangled answer, which is the over-suppression harm
 * this layer must not trade the under-disclosure harm for (trap 22b).
 *
 * `answer-shape.ts` documents the same hazard for the capitalised case
 * (`Mr. Smith`) and accepts it there because its cost is one repair retry. Here
 * the cost is deleted user content, so the guard is explicit.
 */
const ABBREVIATION_TAIL =
  /\b(?:e\.g|i\.e|etc|vs|approx|est|cf|al|no|fig|eq|ref|Mr|Mrs|Ms|Dr|Prof|St|Jr|Sr)\.$/i;

/**
 * Split into whole sentences, preserving each sentence's own bytes AND the
 * exact whitespace that separated them.
 *
 * ⚠ THE SEPARATORS ARE CARRIED, NOT NORMALISED. An earlier form rejoined with a
 * single space, which silently FLATTENED every bulleted or multi-paragraph
 * answer into one run-on block — the layer would have "qualified" an answer by
 * destroying its formatting. Round-tripping the separators makes the no-op case
 * byte-exact by construction rather than by luck.
 */
export function segmentSentences(
  text: string,
): Array<{ readonly text: string; readonly sep: string }> {
  const parts = text.split(SENTENCE_BOUNDARY_G);
  const segments: Array<{ text: string; sep: string }> = [];
  for (let i = 0; i < parts.length; i += 2) {
    segments.push({ text: parts[i] ?? '', sep: parts[i + 1] ?? '' });
  }
  // Re-join across an abbreviation: the "boundary" was a full stop inside
  // `e.g.`, so the following fragment belongs to the SAME sentence.
  const merged: Array<{ text: string; sep: string }> = [];
  for (const seg of segments) {
    const prev = merged[merged.length - 1];
    if (prev !== undefined && ABBREVIATION_TAIL.test(prev.text)) {
      merged[merged.length - 1] = {
        text: `${prev.text}${prev.sep}${seg.text}`,
        sep: seg.sep,
      };
      continue;
    }
    merged.push({ text: seg.text, sep: seg.sep });
  }
  return merged;
}

/** Sentence texts only — the reading most callers and tests want. */
export function enumerateSentences(text: string): string[] {
  return segmentSentences(text).map((s) => s.text);
}

/**
 * The refuse-to-suppress-everything floor.
 *
 * ⭐⭐ THE CASE THIS EXISTS FOR, AND IT IS THE WORST OUTCOME THIS LAYER COULD
 * PRODUCE. A bulleted or markdown answer often contains NO sentence boundary
 * this splitter recognises, so the whole answer is ONE segment. If that segment
 * matched a stability pattern it was dropped WHOLE — and the user received
 * nothing but the caveat. Suppressing a stability claim by deleting the entire
 * answer is not honesty, it is an outage with a disclaimer attached.
 *
 * Above this ratio the layer keeps every byte and appends the disclosure alone:
 * the user still gets the caveat, and the answer survives. Under-suppression is
 * a declared gap; destroying the answer is a defect.
 *
 * ⚠⚠ THE RATIO WAS 0.5 AND THAT WAS MEASURABLY WRONG — recorded rather than
 * silently retuned (CLAUDE.md trap 14), because the way it was caught is the
 * point. The DEPLOYED WITNESS is two sentences, and the stability sentence is
 * the LONGER of them:
 *
 *   "'Adopt HubSpot' currently leads, with a probability of 96%."        (58)
 *   "This result looks stable, so smaller changes are less likely to
 *    flip the outcome on their own."                                     (93)
 *
 * 93/152 = 61%, so a 0.5 floor REFUSED TO SUPPRESS THE EXACT SENTENCE THIS
 * WHOLE LANE EXISTS TO REMOVE. A guard added to stop the layer destroying an
 * answer had instead disabled it on the primary case — trap 22b in one commit:
 * closing the over-suppression direction reopened the under-suppression one.
 *
 * It was caught by the WIRING SPEC on its first run, which is the argument for
 * that spec in miniature: the pure-function tests all passed, because they were
 * written against the same assumption as the floor.
 *
 * THE REAL HAZARD IS NOT A RATIO, IT IS AN EMPTY RESULT. The review's case was
 * a markdown answer with no recognised boundary — ONE segment, matched, dropped
 * whole, user receives only the caveat. That is `kept.length === 0`, which is
 * now the primary condition and is exact rather than tuned. The ratio is kept
 * only as a backstop for "one scrap survives and 90% of the answer vanishes",
 * and is set high enough that ordinary suppression is unaffected.
 */
export const SUPPRESSION_FLOOR_RATIO = 0.8;

/**
 * RESULT-RECITATION forms the shared leader vocabulary does not carry.
 *
 * ⚠⚠ THE BARE `\d\s*%` TEST THAT USED TO LIVE HERE IS GONE, AND ITS REMOVAL IS
 * A CORRECTION, NOT A SIMPLIFICATION (CLAUDE.md trap 14 — replaced, not quietly
 * deleted). It asked "does this text contain a percentage?", which is not the
 * question. Measured consequences, both directions:
 *
 *   OVER — "I raised the growth rate to 5%." is an EDIT RECEIPT. It carries a
 *   percentage, so every such turn for the rest of the session had the caveat
 *   stapled to it. That is precisely the boilerplate effect `isAnalysisBearing`
 *   was written to prevent, produced by the gate itself.
 *
 *   UNDER — "There's little sensitivity here — HubSpot stays in front" recites
 *   a standing and a robustness claim with NO figure at all, so it passed
 *   through with no suppression and no disclosure.
 *
 * The question is "does this text RECITE THE ANALYSIS RESULT?", and the answer
 * is vocabulary, not arithmetic. The base is the estate's existing precise
 * reader; the entries below are only the forms it demonstrably misses, each
 * naming the measured string it came from.
 */
const RESULT_RECITATION_PATTERNS: readonly RegExp[] = [
  // Review-measured breach: "…— HubSpot stays in front". The shared vocabulary
  // carries `out in front` but not `stays in front`.
  /\b(?:stays?|staying|remains?|sits?|holds?)\s+(?:in\s+front|ahead|on\s+top)\b/i,
  // Measured Codex-cell output: "Option B wins in 68% of runs". The shared
  // vocabulary carries `winners?` (the noun), not `wins` (the verb).
  /\bwins?\s+in\b/i,
  // analysis-result-headline.ts — "came out ahead in NN% of runs"; the walk's
  // own capture used "of simulations".
  /\b(?:of|out\s+of)\s+(?:runs|simulations|scenarios)\b/i,
  // explanation-fallback.ts / post-analysis-advice-gate.ts — "with a
  // probability of NN%", the opener of every deterministic recitation.
  /\bprobability\s+of\b/i,
];

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
  // ⭐ REVIEW-MEASURED BREACH: "There's little sensitivity here — HubSpot stays
  // in front" shipped with no suppression. An assertion that the result is
  // INSENSITIVE is the stability claim in another vocabulary, and over defaulted
  // inputs it is exactly as unlicensed.
  //
  // Anchored to the QUANTIFIER so it cannot eat an invitation to test
  // sensitivity — "Which factors should we test for sensitivity?" is a question
  // about what to do next, not a claim about the run, and its KNOWN-KEPT twin
  // pins that.
  /\b(?:little|low|not\s+much|hardly\s+any|no)\s+sensitivity\b/i,
  /\b(?:is|are|looks?|appears?|seems?)\s+(?:fairly\s+|quite\s+|very\s+)?insensitive\b/i,
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
  if (findStabilityAssertion(text) !== null) return true;
  // ⭐ THE SHARED PRECISE READER IS THE BASE, NOT A COPY OF ITS WORDS. This is
  // the same question `compose/leading-option-egress-guard.ts` already answers
  // for the enforcing consumers — "does this text assert a standing?" — and it
  // already carries the documented false-positive carve-outs (`X leads to Y`,
  // `team lead`) that a second hand-written vocabulary here would have to
  // rediscover and would drift from (CLAUDE.md trap 12). Reusing it means a
  // string this layer qualifies is a string that guard also sees.
  if (textAssertsLeadingOption(text)) return true;
  return RESULT_RECITATION_PATTERNS.some((re) => re.test(text));
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
  /**
   * True when suppression would have removed more than
   * {@link SUPPRESSION_FLOOR_RATIO} of the answer, so NOTHING was suppressed and
   * the disclosure was appended to the intact text. Surfaced (not hidden)
   * because it is the signal that the matcher met an answer shape it cannot
   * segment — the thing worth knowing about, and silent otherwise.
   */
  readonly floorTripped: boolean;
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
    floorTripped: false,
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

  const kept: Array<{ text: string; sep: string }> = [];
  for (const seg of segmentSentences(text)) {
    // (a) EXACTLY ONCE — the first canonical disclosure survives; any further
    // copy is dropped. Recognised by the builder's own invariant tail, imported
    // rather than re-spelled, so this can never stop recognising the
    // deterministic composers' sentence.
    if (seg.text.includes(DEFAULTED_DISCLOSURE_TAIL)) {
      if (seenDisclosure) {
        duplicatesRemoved += 1;
        continue;
      }
      seenDisclosure = true;
      kept.push(seg);
      continue;
    }
    // (b) + (c) — stand down stability language over defaulted inputs.
    if (findStabilityAssertion(seg.text) !== null) {
      suppressed.push(seg.text);
      continue;
    }
    kept.push(seg);
  }

  // ⭐ THE FLOOR. Never trade an over-claim for an empty answer — see
  // SUPPRESSION_FLOOR_RATIO. Measured on the ORIGINAL text so a single-segment
  // markdown answer (no recognised boundary ⇒ one segment ⇒ 100% removed) can
  // never be deleted whole.
  const suppressedChars = suppressed.reduce((n, s) => n + s.length, 0);
  const floorTripped =
    suppressed.length > 0
    && (
      // PRIMARY, and exact: suppression would leave NOTHING. The markdown /
      // single-segment case, plus any answer that is stability claims end to
      // end. Never ship a caveat where an answer used to be.
      kept.length === 0
      // BACKSTOP, deliberately high: a scrap survives while almost the whole
      // answer disappears. Tuned to sit well clear of ordinary two-sentence
      // suppression — see the note on SUPPRESSION_FLOOR_RATIO.
      || (text.length > 0 && suppressedChars / text.length > SUPPRESSION_FLOOR_RATIO)
    );
  const segments = floorTripped ? segmentSentences(text) : kept;
  const suppressedFinal = floorTripped ? [] : suppressed;

  let out = segments
    .map((s, i) => (i === segments.length - 1 ? s.text : `${s.text}${s.sep === '' ? ' ' : s.sep}`))
    .join('')
    .trimEnd();

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
    suppressed: Object.freeze(suppressedFinal),
    disclosureAdded,
    duplicatesRemoved,
    floorTripped,
    mode: 'applied',
  };
}
