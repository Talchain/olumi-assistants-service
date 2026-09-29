/**
 * ROADMAP 2.653 — A THRESHOLD STATED AS A RISK IS NOT A REQUIREMENT.
 *
 * WHAT THIS CLOSES (witnessed live, twice, byte-identically — walk-2634 J6 and
 * `consent-witness-findings-2026-08-07.md` §2). The tester wrote:
 *
 *     "Key risks: customer churn could rise above 3%"
 *
 * `LOWER_BOUND_PATTERNS` in `extractor.ts` maps "X above N" to `>=` on the word
 * "above" alone, with no reading of WHY the speaker mentioned it. So the brief
 * minted a hard FLOOR — `churn >= 3%` — a constraint DEMANDING the very thing
 * the user said they were afraid of, labelled "churn could rise floor". From
 * there: chat described it as a ceiling; the analysis could not evaluate it and
 * said "no option can be put forward yet" beside a panel ranking a 64% leader;
 * a units repair was prescribed for a constraint the user never wrote; and
 * (row 2.654) the resulting `constraint_verdict_state: "unevaluated"` put every
 * turn in the WITHHELD-CLAIM state, which drops `decision_review` whole and
 * DARKENS THE ENTIRE SCIENCE-GROUNDING SURFACE. One sign error, that far.
 *
 * THE RULE, stated once here and applied once at the merge point:
 *
 *   "X could rise above N" / "X might exceed N" / "risk of X going over N"
 *       — the speaker FEARS HIGH X. The constraint, IF ANY, is a CEILING.
 *   "X could drop below N" / "X might fall under N" / "risk of X falling short"
 *       — the speaker FEARS LOW X. The constraint, IF ANY, is a FLOOR.
 *
 * ⭐ AND THE ACTION IS SUPPRESSION, NOT CORRECTION. This module can only ever
 * REMOVE a constraint whose operator contradicts its own source phrase; it
 * never mints one and never flips one. Three reasons, in order of weight:
 *
 *   1. A possibility-framed clause is not a requirement AT ALL. "churn could
 *      rise above 3%" states a fear, not a limit the analysis must enforce. The
 *      user asked for nothing. Minting the mirror-image ceiling would be a
 *      second constraint they did not write — a smaller version of the same
 *      mistake. (The product already knows this: the panel's own coaching on
 *      this very brief said "Make the churn ceiling an explicit constraint" —
 *      i.e. it treats the phrase as NOT YET a constraint.)
 *   2. A WRONG CONSTRAINT IS WORSE THAN NONE, measured. None costs a coaching
 *      nudge; a wrong one cost this session its entire science surface.
 *   3. Suppression makes the guard's blast radius provable. It cannot invent a
 *      limit, cannot change a value, cannot reverse a user's stated
 *      requirement. The worst case it can produce is the pre-constraint
 *      product, which is exactly the honest fallback.
 *
 * That third point also covers the case where this module's POLARITY LABEL is
 * arguably wrong but its VERDICT is still right: "revenue could grow above
 * £500k" is an upside, not a risk, and `fears_high` is a poor description of
 * it — but it is equally not a requirement, so declining to mint a hard floor
 * from it is the correct outcome either way.
 *
 * WHERE THE EVIDENCE COMES FROM — the precision argument. A naive "is there a
 * risk word anywhere near this?" screen produces false positives that would
 * DELETE constraints users really did state ("Costs might rise above £50k and
 * NPS must be at least 40" — one clause, two thresholds, only the first is a
 * risk). So the two halves of the signal are scoped differently and asymmetrically:
 *
 *   - the MOVEMENT VERB must sit inside the constraint's OWN source quote.
 *     This is what binds the risk framing to THIS threshold rather than to a
 *     neighbouring one — the trap-19 rule (bind by identity, not by a predicate
 *     something else could satisfy) applied to a phrase.
 *   - the POSSIBILITY MARKER may sit in the quote, or in a SHORT window
 *     immediately preceding it, because English routinely puts it outside the
 *     captured span ("there is a risk that costs rise above £50k" — the
 *     extractor's three-word subject capture starts at "that").
 *
 * A phrase carrying a movement verb with no possibility marker in reach is
 * INCONCLUSIVE, and inconclusive never suppresses.
 *
 * ⚠ THE PATTERN LISTS BELOW ARE HAND-WRITTEN AND ARE THEREFORE THE PART THAT
 * CAN GO SHORT (CLAUDE.md trap 12d, second face: derivation proves agreement,
 * never completeness). Nothing derived from these lists can notice a verb
 * missing FROM them. The instrument that can is the hand-written corpus in
 * `__tests__/risk-polarity-corpus.test.ts`, which spells real briefs and
 * asserts the END-TO-END outcome — both the risk set that must be suppressed
 * and the requirement set that must survive untouched.
 *
 * Pure, no I/O, exported for direct test.
 */

/**
 * Which end of the scale the speaker is afraid of.
 *
 * NOT "which operator to use" — deliberately. Naming the FEAR keeps the
 * semantic claim explicit at every call site, so a reader can check the mapping
 * in {@link polaritySafeOperator} rather than trusting a pre-resolved symbol.
 */
export type RiskPolarity = 'fears_high' | 'fears_low';

/**
 * The only operator a constraint may carry under a given fear.
 *
 * Fearing HIGH values can only ever justify an upper bound; fearing LOW values
 * can only ever justify a lower bound. This is the whole semantic content of
 * the fix, in two lines, so that it is reviewable in one glance.
 */
export function polaritySafeOperator(polarity: RiskPolarity): '<=' | '>=' {
  return polarity === 'fears_high' ? '<=' : '>=';
}

/**
 * Markers of POSSIBILITY, not of obligation.
 *
 * "must", "should", "will" and "shall" are deliberately ABSENT: "revenue must
 * rise above £500k" is a requirement whose `>=` is correct, and admitting
 * obligation modals here would suppress it. The discriminator between a fear
 * and a requirement is possibility versus obligation, and that is the single
 * hinge this whole module turns on.
 */
export const POSSIBILITY_MARKER_SRC =
  '(?:' +
  'could|might|may|maybe|possibly|potentially' +
  // ⚠ EACH NOUN STANDS ALONE. An earlier revision spelled these with the
  // preposition REQUIRED (`danger (?:of|that)`), and the corpus caught it on
  // the first run: "The danger that costs escalate above 50000" puts "that"
  // INSIDE the quote and leaves the bare word "danger" in the preceding window,
  // so the marker never matched and the inverted floor survived. A hand-written
  // phrasing found a gap that nothing derived from this list could have — trap
  // 12d, second face, in one line.
  '|risks?|danger(?:s)?|threat(?:s|en(?:s|ed|ing)?)?|hazard(?:s)?' +
  '|afraid|worried|worry|worries|concern(?:s|ed)?|fear(?:s|ed|ing)?|chance' +
  '|likely|liable|prone|exposed|exposure' +
  '|if|in case|should it|what if|scenario where' +
  ')';

/** Upward movement, or crossing an upper bound. The speaker fears HIGH values. */
const RISE_MOVEMENT_SRC =
  '(?:' +
  'ris(?:e|es|en|ing)|increas(?:e|es|ed|ing)|grow(?:s|n|ing)?|climb(?:s|ed|ing)?' +
  '|creep(?:s|ing)? up|crept up|edge(?:s|d)? up|edging up|tick(?:s|ed|ing)? up' +
  '|spik(?:e|es|ed|ing)|surg(?:e|es|ed|ing)|escalat(?:e|es|ed|ing)' +
  '|balloon(?:s|ed|ing)?|spiral(?:s|led|ling|ed|ing)?|jump(?:s|ed|ing)?' +
  '|exceed(?:s|ed|ing)?|overshoot(?:s|ing)?|overshot|blow(?:s|n|ing)? (?:past|through)' +
  '|go(?:es|ing)? (?:above|over|beyond|past)|went (?:above|over|beyond|past)' +
  '|com(?:e|es|ing)? in (?:above|over)|land(?:s|ed|ing)? (?:above|over)' +
  ')';

/** Downward movement, or crossing a lower bound. The speaker fears LOW values. */
const FALL_MOVEMENT_SRC =
  '(?:' +
  'fall(?:s|en|ing)?|drop(?:s|ped|ping)?|declin(?:e|es|ed|ing)|decreas(?:e|es|ed|ing)' +
  '|dip(?:s|ped|ping)?|slip(?:s|ped|ping)?|slid(?:e|es|ing)?|slump(?:s|ed|ing)?' +
  '|sink(?:s|ing)?|sank|shrink(?:s|ing)?|shrank|plung(?:e|es|ed|ing)|tumbl(?:e|es|ed|ing)' +
  '|undershoot(?:s|ing)?|undershot|fall(?:s|ing)? short|com(?:e|es|ing)? up short' +
  '|go(?:es|ing)? (?:below|under|beneath)|went (?:below|under|beneath)' +
  '|com(?:e|es|ing)? in (?:below|under)|land(?:s|ed|ing)? (?:below|under)' +
  ')';

/**
 * How far back from the start of the source quote a possibility marker may sit
 * and still be read as governing it.
 *
 * Sized from the shape the extractor actually produces, not guessed: its simple
 * bound patterns capture at most three words of subject, so a marker just
 * outside that span ("There is a risk that | costs rise above £50k") is within
 * a few words. A window this short cannot reach across a sentence boundary in
 * practice, and {@link precedingWindow} additionally refuses to cross one.
 */
const PRECEDING_WINDOW_CHARS = 48;

/** Clause boundaries a possibility marker may not reach across. */
const CLAUSE_BOUNDARY_RE = /[.;:\n?!]/;

const MOVEMENT_ANY_RE = new RegExp(
  `\\b(?:${RISE_MOVEMENT_SRC}|${FALL_MOVEMENT_SRC})`,
  'i',
);
const RISE_RE = new RegExp(`\\b${RISE_MOVEMENT_SRC}`, 'i');
const FALL_RE = new RegExp(`\\b${FALL_MOVEMENT_SRC}`, 'i');
const POSSIBILITY_RE = new RegExp(`\\b${POSSIBILITY_MARKER_SRC}\\b`, 'i');

/**
 * The bounded left context a possibility marker may come from: at most
 * {@link PRECEDING_WINDOW_CHARS} characters immediately before the quote, cut
 * at the nearest clause boundary so a marker from the PREVIOUS sentence can
 * never license a suppression in this one.
 */
function precedingWindow(brief: string, quote: string): string {
  if (quote.length === 0) return '';
  const at = brief.indexOf(quote);
  if (at <= 0) return '';
  const window = brief.slice(Math.max(0, at - PRECEDING_WINDOW_CHARS), at);
  const lastBoundary = window.split('').reduce(
    (acc, ch, i) => (CLAUSE_BOUNDARY_RE.test(ch) ? i : acc),
    -1,
  );
  return lastBoundary === -1 ? window : window.slice(lastBoundary + 1);
}

/* ===========================================================================
 * ROUTE B — the RISK-LIST HEADER.
 *
 * Route A above needs a movement verb, and the walk's own brief shows the
 * commonest risk phrasing that has none: a bulleted or colon-introduced list.
 *
 *     "... Key risks: churn above 3%, sales team stretched thin."
 *
 * There is no "could rise" to read here — the header does that work for every
 * item under it. And under a risk header the COMPARATOR ITSELF names the feared
 * side: "churn above 3%" means the danger is churn EXCEEDING 3%, so the
 * constraint (if any) is a ceiling, and the `>=` both producers mint from the
 * word "above" is again the exact inverse.
 *
 * This route is deliberately the narrower of the two, because it licenses a
 * suppression from context rather than from the phrase's own verb. Three bounds
 * hold it in:
 *
 *   1. The header must sit in the SAME SENTENCE as the quote and BEFORE it. A
 *      header cannot reach across `.`/`\n`/`?`/`!` into the next sentence.
 *   2. The quote must be a BARE COMPARATOR form. Any requirement marker —
 *      "must", "keep", "at least", "no more than", "maintain" — and this route
 *      declines, because a requirement stated inside a risk list is still a
 *      requirement ("Key risks: churn above 3%, budget must not exceed £50k"
 *      keeps its budget ceiling).
 *   3. The comparator must point ONE way. "between"-style quotes carrying both
 *      are ambiguous, and ambiguity never suppresses.
 * ========================================================================= */

/** A risk-list header: "Key risks:", "Concerns:", "Main threats we see:". */
const RISK_LIST_HEADER_RE =
  /\b(?:key|main|top|primary|biggest|major)?\s*(?:risks?|concerns?|threats?|worries|dangers?|watch[\s-]?outs?)\b[^.\n?!]{0,24}:/i;

/**
 * Markers that make a phrase a REQUIREMENT rather than a bare observation.
 * Their presence disqualifies Route B — see bound 2 above.
 */
const REQUIREMENT_MARKER_RE =
  /\b(?:must|shall|should|need(?:s|ed)?|require(?:s|d)?|keep(?:s|ing)?|maintain(?:s|ing)?|ensur(?:e|es|ing)|guarantee(?:s|d)?|target(?:s|ing)?|aim(?:s|ing)?|want(?:s)?|goal|cap(?:s|ped)?|limit(?:s|ed)?|at least|at most|no more than|no less than|minimum|maximum)\b/i;

/** Comparator words naming the upper side, and the lower side. */
const UPPER_COMPARATOR_RE = /\b(?:above|over|beyond|past|exceed(?:s|ing|ed)?)\b/i;
const LOWER_COMPARATOR_RE = /\b(?:below|under|beneath|short of)\b/i;

/** Sentence boundaries a risk-list header may not reach across. */
const SENTENCE_BOUNDARY_RE = /[.\n?!]/;

/**
 * True when a risk-list header governs this quote: it appears earlier in the
 * SAME sentence.
 */
function riskListHeaderGoverns(brief: string, quote: string): boolean {
  const at = brief.indexOf(quote);
  if (at <= 0) return false;
  const before = brief.slice(0, at);
  let sentenceStart = 0;
  for (let i = before.length - 1; i >= 0; i--) {
    if (SENTENCE_BOUNDARY_RE.test(before[i]!)) {
      sentenceStart = i + 1;
      break;
    }
  }
  return RISK_LIST_HEADER_RE.test(before.slice(sentenceStart));
}

/**
 * Derive the risk polarity a threshold phrase carries, or `null` when it does
 * not carry one.
 *
 * @param quote  the constraint's own source phrase — the ONLY place a movement
 *               verb or comparator is read from, so the polarity binds to this
 *               threshold and not to a neighbouring one.
 * @param brief  the full brief, when available. Used ONLY to look backwards for
 *               a possibility marker (Route A) or a risk-list header (Route B);
 *               never for the direction itself.
 *
 * Returns `null` for: no movement verb and no governing risk header · no
 * possibility marker in reach · a requirement marker under Route B · a quote
 * whose direction words point BOTH ways (genuinely ambiguous — and ambiguity
 * must never delete a user's constraint).
 */
export function deriveRiskPolarity(
  quote: string | null | undefined,
  brief?: string | null,
): RiskPolarity | null {
  if (typeof quote !== 'string' || quote.trim().length === 0) return null;

  // ── Route A: a movement verb under a possibility marker ──────────────
  if (MOVEMENT_ANY_RE.test(quote)) {
    const hasMarker =
      POSSIBILITY_RE.test(quote) ||
      (typeof brief === 'string' && POSSIBILITY_RE.test(precedingWindow(brief, quote)));
    if (hasMarker) {
      const rises = RISE_RE.test(quote);
      const falls = FALL_RE.test(quote);
      // Both directions in one phrase is not a polarity, it is a coin toss —
      // and a coin toss must never delete a user's constraint.
      if (rises !== falls) return rises ? 'fears_high' : 'fears_low';
    }
    // A movement verb with no marker in reach is an ordinary statement of fact
    // ("revenue rises above £500k in the base case"). Fall through: Route B may
    // still apply if a risk header governs it, and it applies the same bounds.
  }

  // ── Route B: a bare comparator under a risk-list header ──────────────
  if (typeof brief !== 'string') return null;
  if (REQUIREMENT_MARKER_RE.test(quote)) return null;
  if (!riskListHeaderGoverns(brief, quote)) return null;
  const upper = UPPER_COMPARATOR_RE.test(quote);
  const lower = LOWER_COMPARATOR_RE.test(quote);
  if (upper === lower) return null;
  return upper ? 'fears_high' : 'fears_low';
}

/**
 * THE INVARIANT, as a predicate: does this constraint's operator contradict the
 * risk polarity of the phrase it was minted from?
 *
 * Returns the offending polarity when it does, `null` when it does not — so a
 * caller can log WHICH fear was contradicted without re-deriving it.
 */
export function contradictedRiskPolarity(
  quote: string | null | undefined,
  operator: string | null | undefined,
  brief?: string | null,
): RiskPolarity | null {
  if (operator !== '>=' && operator !== '<=') return null;
  const polarity = deriveRiskPolarity(quote, brief);
  if (polarity === null) return null;
  return polaritySafeOperator(polarity) === operator ? null : polarity;
}

/** The minimal shape this screen reads. Both producers' entries satisfy it. */
interface ScreenableConstraint {
  readonly operator?: unknown;
  readonly source_quote?: unknown;
  readonly label?: unknown;
}

/**
 * Split a merged constraint list into the entries that may stand and the
 * entries whose operator contradicts their own source phrase.
 *
 * SOURCE-AGNOSTIC BY CONSTRUCTION, and that is the point. Two producers write
 * `goal_constraints[]` — this service's regex extractor and the drafting model's
 * own `goal_constraints[]` — and BOTH are told the same defective rule: the
 * extractor by `LOWER_BOUND_PATTERNS`, the model by the draft prompt's own
 * mapping line (`Patterns: "under/below/at most" -> <=, "at least/above/minimum"
 * -> >=`, `src/prompts/defaults-v187.ts`), which keys on the comparator word
 * alone in exactly the same way. Fixing one producer would leave the other
 * minting the identical inverted constraint. This is the single point both pass
 * through — the same argument, and the same placement, as
 * `partitionTemporalNonBinding` (ROADMAP 2.349).
 *
 * `source_quote` is the evidence; `label` is the documented fallback for a
 * model-emitted entry that omits the quote. An entry offering neither is
 * INCONCLUSIVE and stands — this screen never guesses.
 */
export function partitionRiskFramedInversions<T extends ScreenableConstraint>(
  constraints: readonly T[],
  brief?: string | null,
): { binding: T[]; inverted: Array<{ constraint: T; polarity: RiskPolarity }> } {
  const binding: T[] = [];
  const inverted: Array<{ constraint: T; polarity: RiskPolarity }> = [];
  for (const c of constraints) {
    const quote =
      typeof c?.source_quote === 'string'
        ? c.source_quote
        : typeof c?.label === 'string'
          ? c.label
          : null;
    const polarity = contradictedRiskPolarity(
      quote,
      typeof c?.operator === 'string' ? c.operator : null,
      brief,
    );
    if (polarity === null) binding.push(c);
    else inverted.push({ constraint: c, polarity });
  }
  return { binding, inverted };
}
