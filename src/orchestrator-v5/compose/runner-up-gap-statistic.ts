/**
 * F3 — THE RUNNER-UP GAP STATISTIC, REMOVED FROM DECISION-REVIEW PROSE.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THE DEFECT IS
 *
 * PR #906 retired one sentence family from the deterministic run_analysis
 * headline: "{label} currently leads by {N} percentage points". That number is
 * the difference between two P(argmax) statistics — not a difference in
 * outcome, cost or benefit — it invites "N% better", which it is not, and it
 * INFLATES BY CONSTRUCTION: the gap is a function of the whole field, so a
 * third option collapsing widens it with no improvement in the leader at all.
 * The ratified replacement is the leader's OWN win probability: "{label} came
 * out ahead in {N}% of runs of this model."
 *
 * #906 fixed the DETERMINISTIC surface. The external audit of 10 Aug 2026 then
 * measured, on deployed build `5d69ce0`, ONE turn response carrying BOTH:
 *
 *   assistant_text            "HubSpot came out ahead in 61% of runs of this
 *                              model"                          ← #906, working
 *   decision_review
 *     .narrative_summary      "coming out ahead of Salesforce by a margin of
 *                              33 percentage points"           ← the retired
 *                                                                category error
 *
 * The prompts are fixed in the same PR. This module is the SECOND LINE OF
 * DEFENCE, because the decision-review prose is LLM output served from a PMS
 * prompt whose bytes this repo does not control (see the PR body's served-
 * prompt step): a prompt instruction is a request, not a guarantee.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS IS ONE POLICY WIDENED, NOT A NEW FRAMEWORK
 *
 * Three things already existed and are REUSED rather than re-invented:
 *
 *  1. THE FAILURE ACTION. The rule guarding `assistant_text`
 *     (`routing/validation-registry.ts` — `runAnalysisConfirmationTemplate`)
 *     does NOT drop the response when its allowlist rejects: it REPLACES the
 *     offending text with safe copy and salvages the parts that must survive.
 *     Neutralise the claim, keep the surface alive. That is the action extended
 *     here.
 *
 *  2. THE GRANULARITY. `leading-option-egress-guard.ts` ends with the ratified
 *     ruling on where such a decision belongs: *"per-field, not whole-response
 *     — blanking an envelope at egress trades one dishonest answer for no
 *     answer at all"*, honoured by an enforcer that is per-field AND
 *     per-SENTENCE. Dropping the whole review (the contract gate's
 *     `mustDrop` path) would trade a wrong statistic for no decision review at
 *     all — on every analysed turn, for as long as the served prompt still asks
 *     for the margin. That is a worse product, not a safer one.
 *
 *  3. THE MECHANICS. `compose/redactable-units.ts` already owns the sentence
 *     surgery, with its three pinned properties (lossless split, byte identity
 *     when nothing asserts, never empties). This module is its THIRD consumer,
 *     differing — exactly as the other two do — only in the per-unit READER and
 *     the REPLACEMENT string.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE CORPUS THIS READER WAS WRITTEN AGAINST (CLAUDE.md trap 22)
 *
 * Every MUST-TRIP case in `__tests__/runner-up-gap-statistic.test.ts` is a
 * string this estate has ACTUALLY EMITTED — harvested from the deployed audit
 * capture, from `compose/__tests__/fixtures/dsk-walk/*.enrichment.json`, from
 * `src/prompts/Versions /decision_review_prompt_v4_1.txt`, and from the
 * headline module's own historic records. Not one of them came out of the
 * author's head. Every one has an opposite-direction twin that must NOT trip.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE BIAS, STATED (and it is the opposite of the alarm's)
 *
 * This reader ENFORCES: a false positive DELETES a legitimate sentence of the
 * user's own decision content. A false negative ships one wrong statistic that
 * the prompt fix has already made rare. So it is deliberately biased to
 * FALSE-NEGATIVE, in the same words and for the same reason as
 * `leading-option-egress-guard.ts`'s `ENFORCEMENT_FALSE_POSITIVE_SPANS`.
 *
 * The residual is not left to be discovered: {@link KNOWN_UNDETECTED_GAP_FORMS}
 * pins the gap forms this reader deliberately does NOT see, and the test suite
 * asserts EXACTLY that set — so it REDs if the set grows OR shrinks.
 */

import { neutraliseEnforcementFalsePositiveSpans } from './leading-option-egress-guard.js';
import { replaceAssertingUnits } from './redactable-units.js';

// ============================================================================
// The quantity
// ============================================================================

/**
 * A percentage-point quantity, in every dialect this estate has emitted:
 * "33 percentage points", "78 points", "7pp", "7.5 percentage points" — and,
 * since the round-1 review, the HYPHENATED attributive forms "a 20-point lead"
 * and "a 33-percentage-point lead". The separator is `[\s-]*`, not `\s*`: the
 * reviewer's corpus leaked both hyphenated sentences because a digit-hyphen-unit
 * quantity was not a quantity at all to this reader.
 *
 * `50 basis points` still does not match — the unit must follow the digits
 * immediately, and "basis" intervenes. Pinned as a twin.
 *
 * ⚠ BARE `%` IS DELIBERATELY EXCLUDED. "leads by 24%" is the same category
 * error in a third dialect, and it is NOT matched here — see
 * {@link KNOWN_UNDETECTED_GAP_FORMS} for why, and for the test that pins it.
 * Admitting `%` would put this reader one loose window away from redacting
 * "leads with a 42% win probability", which is the RATIFIED-CORRECT sentence.
 */
const QTY_SRC = String.raw`\d+(?:[.,]\d+)?[\s-]*(?:percentage[\s-]?points?|pp|points?)\b`;

/** Approximators and articles that sit between a connector and the quantity. */
const FILLER_SRC = String.raw`[^,.!?;:]{0,22}?`;

// ============================================================================
// Non-ranking uses of this vocabulary — neutralised BEFORE any pattern runs
// ============================================================================

/**
 * Spans that would otherwise bind a legitimate percentage-point figure to a
 * ranking word. Neutralised first, exactly as
 * `leading-option-egress-guard.ts` neutralises `leads to` / `team leads`
 * (whose two spans are imported from there rather than copied — trap #12).
 *
 * Each entry is a MEASURED false positive, not a speculative one:
 *
 *  - ATTRIBUTIVE `by`. "Option A leads, driven by a 12 percentage point rise in
 *    conversion" is a factor attribution, not a gap. Without this the
 *    lead-then-`by` pattern reads it as one.
 *  - BUSINESS MARGIN. "gross margin fell by 3 percentage points" is the
 *    ordinary accounting sense of the word this module's own vocabulary claims.
 *  - TEMPORAL `ahead of`. "5 percentage points ahead of schedule" is a
 *    date, not a ranking.
 *  - MARGIN OF ERROR / SAFETY (round-1 review). "The margin of error is 3
 *    percentage points" is legitimate statistics prose, entirely plausible in
 *    `robustness_explanation.summary`, and this reader was DELETING it.
 *  - MARKET POSITION (round-1 review). "your firm leads competitors by 10
 *    points on NPS" is a user-brief echo about the market, not about two
 *    options in this model. There is no option roster at this seam, so the
 *    discrimination has to come from the OBJECT of the ranking word — which is
 *    what this span names.
 *
 * The replacement token inherits the three properties documented on
 * `ENFORCEMENT_NEUTRALISED_SPAN`: non-word, non-whitespace, not NUL — so
 * neutralisation can only ever REMOVE a match, never manufacture one.
 */
const GAP_FALSE_POSITIVE_SPANS: readonly RegExp[] = [
  /\b(?:driven|caused|explained|supported|underpinned|helped|hurt|shaped|informed|affected|influenced|accompanied|offset|dominated|amplified|dampened)\s+by\b/gi,
  /\b(?:gross|net|operating|profit|contribution|ebitda|ebit|retention|churn)\s+margins?\b/gi,
  /\bmargins?\s+of\s+(?:error|safety)\b/gi,
  // The accounting sense again, this time WITHOUT a qualifier in front —
  // reachable only since `qty_attributive` landed ("a 3 percentage point margin
  // expansion"). Named by its head noun instead: an expanding or contracting
  // margin is a P&L movement, never the distance between two options.
  /\bmargins?\s+(?:expansion|contraction|improvement|erosion|compression|uplift|decline|growth|pressure)\b/gi,
  /\bahead\s+of\s+(?:the\s+)?(?:schedule|time|plan|deadline|launch|target\s+date|forecast)\b/gi,
  // ⚠ THIS LIST MUST TRACK `GAP_BINDER_SRC`. It carves a legitimate use OUT of
  // the binder vocabulary, so a verb added there and forgotten here becomes an
  // immediate over-reach: adding `winning|beating|outperforming` in round 2
  // would have started redacting "your firm is beating competitors by 10 points
  // on NPS" — a user-brief market echo — with nothing red. Both lists moved in
  // the same edit; the twins below pin it.
  /\b(?:leads?|leading|led|wins?|winning|won|beats?|beating|outperforms?|outperforming|outranks?|ahead\s+of)\s+(?:the\s+|our\s+|its\s+|their\s+)?(?:competitors?|rivals?|peers?|market|industry|field|sector|benchmark)\b/gi,
];

const GAP_NEUTRALISED_SPAN = '#';

function neutralise(text: string): string {
  let out = neutraliseEnforcementFalsePositiveSpans(text);
  for (const re of GAP_FALSE_POSITIVE_SPANS) {
    out = out.replace(re, GAP_NEUTRALISED_SPAN);
  }
  return out;
}

// ============================================================================
// The patterns
// ============================================================================

/**
 * Words that name a RANKING GAP. Distinct from the LEADER vocabulary in
 * `leading-option-egress-guard.ts` and deliberately not merged with it: that
 * list answers *"does this text name a leading option?"*, this one answers
 * *"is this quantity the SIZE OF A LEAD?"*. Two questions, two lists — the
 * lesson of CLAUDE.md trap #21, applied before rather than after the fact.
 *
 * ⚠ `wins|won` BUT NEVER BARE `win` (round-1 review, leak class 1). "Option A
 * wins by 12 points" is a gap claim; "Option A's **win probability** rises by 12
 * percentage points under the upside" is a legitimate sensitivity statement, and
 * a bare `win` would read the second as the first. The inflected forms are the
 * verb; the bare form is the noun this estate uses for `win_probability`.
 *
 * ⚠ THE GERUND ARM MUST STAY COMPLETE (round-2 review). `leading`, `trailing`
 * and `lagging` were here from the start; `winning`, `beating` and
 * `outperforming` were not, so "Option A is **winning** by 12 points" leaked
 * while "Option A is **leading** by 12 points" was caught. That is not a new
 * class — it is one class half-declared, which is the worst shape a vocabulary
 * list can take, because the cases it does catch make it look complete. Every
 * base form in this list now carries its progressive.
 *
 * The reviewer could construct no legitimate sentence for any of the three
 * gerunds, and neither could I; the twins that pin them are the market-position
 * ones below, which are legitimate and had to be kept in step (see
 * {@link GAP_FALSE_POSITIVE_SPANS}).
 */
const GAP_BINDER_SRC = String.raw`(?:leads?|leading|led|wins|winning|won|ahead|in\s+front|on\s+top|trails?|trailing|trailed|behind|lags?|lagging|margin|gap|performs?\s+best|outperforms?|outperforming|outranks?|beats?|beating)`;

/**
 * Bounded and ordered: the FIRST match is what rides the log's primary `reason`
 * code, so this list is the cardinality bound. Keep it small.
 *
 * ⚠ THE WINDOW BETWEEN BINDER AND CONNECTOR EXCLUDES `,;:` ON PURPOSE. Measured
 * over the real corpus the widest legitimate gap is 14 characters
 * ("coming out ahead **of Salesforce** by a margin of…", "Its lead **has
 * narrowed** by about…"); 25 covers every observed form with headroom. Allowing
 * a clause boundary through instead admits "Option A leads, driven by a 12
 * percentage point rise" — a factor attribution wearing a gap's clothes. This
 * is CLAUDE.md trap 22b's lesson taken in advance: the same window cannot
 * police a gap AND a lie, so the window is set by what the gap forms need and
 * the attributive frames are carved out separately above.
 */
const GAP_CLAIM_PATTERNS: ReadonlyArray<{ readonly code: string; readonly re: RegExp }> = [
  // "leads by 78 points" · "comes out ahead by a margin of about 22 percentage
  // points" · "trails by just 7 points" · "leads Option A by 6 points" ·
  // "Its lead has narrowed by about 14 percentage points"
  {
    code: 'gap_by',
    re: new RegExp(String.raw`\b${GAP_BINDER_SRC}\b[^,.!?;:]{0,25}?\bby\b${FILLER_SRC}${QTY_SRC}`, 'i'),
  },
  // "a narrow lead of about 7 percentage points" · "a margin of 33 percentage
  // points" · "a gap of 12 points"
  {
    code: 'gap_of',
    re: new RegExp(String.raw`\b(?:lead|margin|gap|difference)\s+of\b${FILLER_SRC}${QTY_SRC}`, 'i'),
  },
  // "The lead is 14 percentage points."
  {
    code: 'gap_is',
    re: new RegExp(
      String.raw`\b(?:lead|margin|gap|difference)\s+(?:is|was|stands\s+at|sits\s+at|comes\s+to|amounts\s+to)\b${FILLER_SRC}${QTY_SRC}`,
      'i',
    ),
  },
  /**
   * "The margin between the two options is 6 percentage points." · "The
   * difference between the two options is 33 percentage points."
   * (round-1 review, leak classes 5 and 6.)
   *
   * ⚠ THE INTERPOSITION IS NOT AN OPEN WINDOW — it must OPEN WITH AN EXPLICIT
   * COMPARISON PREPOSITION. `gap_is` requires the verb adjacent to the gap-noun,
   * so any `between …` phrase defeats it; the tempting fix is to widen `gap_is`
   * to `{0,40}`, which would also swallow "The margin **on this deal** is 6
   * percentage points" — a business margin, and the same one-parameter-two-harms
   * mistake M5 already proved for `gap_by`. Requiring `between|over|versus|
   * against` makes the interposition itself the discriminator: it names a
   * comparison, which is exactly the claim being policed.
   */
  {
    code: 'gap_between_is',
    re: new RegExp(
      String.raw`\b(?:lead|margin|gap|difference)\s+(?:between|over|versus|vs\.?|against)\b[^,.!?;:]{0,40}?\b(?:is|was|stands\s+at|sits\s+at|comes\s+to|amounts\s+to)\b${FILLER_SRC}${QTY_SRC}`,
      'i',
    ),
  },
  // "51 percentage points ahead of the runner-up" · "12 points behind"
  {
    code: 'qty_ahead_of',
    re: new RegExp(String.raw`${QTY_SRC}\s+(?:ahead|behind|clear|adrift|in\s+front)\b`, 'i'),
  },
  /**
   * "It holds a 20-point lead over Salesforce." · "A 33-percentage-point lead
   * separates HubSpot from Salesforce." (round-1 review, leak classes 2 and 3.)
   *
   * The ATTRIBUTIVE form: the quantity modifies the gap-noun directly, with no
   * verb and no connector, so every existing pattern misses it by construction.
   * Hyphen tolerance in {@link QTY_SRC} is half the fix; this pattern is the
   * other half.
   *
   * Bounded to LEAD-NOUNS only. "a 5-point NPS improvement", "a 10-point plan"
   * and "a 3 percentage point gross margin" all carry a quantity in the same
   * position and must survive — the first two because their head noun is not a
   * gap-noun, the third because the business-margin span is neutralised first.
   * All three are pinned as twins.
   */
  {
    code: 'qty_attributive',
    re: new RegExp(String.raw`${QTY_SRC}\s+(?:lead|margin|gap|advantage)\b`, 'i'),
  },
  /**
   * "HubSpot is 33 percentage points better than Salesforce." (round-1 review,
   * leak class 4 — and note it is the PR's OWN motivating word: the margin
   * "invites '33% better'", which is precisely what this reader could not see.)
   *
   * ⚠ RESIDUAL, STATED RATHER THAN LEFT TO BE FOUND: a comparison against a
   * TIME PERIOD or a TARGET in the identical shape ("5 percentage points better
   * than last quarter") is over-removed. Discriminating it needs an option
   * roster, which this pure reader does not have. The direction is
   * over-removal — the same documented-safe direction as the `pp.`
   * sentence-merge below — and the comparator set is deliberately restricted to
   * superiority words: `higher`, `lower`, `faster` and the rest survive, which
   * is what the twins pin.
   */
  {
    code: 'qty_better_than',
    re: new RegExp(String.raw`${QTY_SRC}\s+(?:better|stronger)\s+than\b`, 'i'),
  },
  /**
   * "It sits ahead of Standardise on Dell XPS by 44 percentage points."
   *
   * ⚠ THIS PATTERN EXISTS BECAUSE A FIXED WINDOW CANNOT COVER IT, AND WIDENING
   * `gap_by`'s WINDOW TO REACH IT WOULD REOPEN THE ATTRIBUTIVE-`by` FALSE
   * POSITIVE (CLAUDE.md trap 22b: one predicate, two opposite harms, cannot
   * share one parameter). The string above is a real template —
   * `It sits ahead of ${RUNNER_LABEL} by 44 percentage points` — and the label
   * is USER-SUPPLIED, so the binder→`by` distance is UNBOUNDED by construction.
   * No choice of window fixes that; the discriminator has to be the explicit
   * `ahead OF <the other option>` comparison marker, which attributive `by`
   * never carries. The wider window is safe for exactly that reason, and the
   * clause-boundary exclusion still applies inside it.
   */
  {
    code: 'gap_ahead_of_by',
    re: new RegExp(
      String.raw`\b(?:ahead|behind|clear|adrift|in\s+front)\s+of\b[^,.!?;:]{0,80}?\bby\b${FILLER_SRC}${QTY_SRC}`,
      'i',
    ),
  },
];

/**
 * Gap forms this reader deliberately does NOT detect, pinned so the gap is
 * recorded in the suite rather than discovered in production (CLAUDE.md trap
 * 22f's honest-gap rule: a KNOWN-DROPPED set with a test asserting EXACTLY that
 * set, so the suite REDs if it grows OR shrinks).
 *
 * Each is a decision, with its reason:
 *
 *  - `percent_dialect` — "leads by 24%". Excluded because admitting bare `%`
 *    puts this enforcing reader one window away from redacting the RATIFIED-
 *    CORRECT sentence ("leads with a 42% win probability", "came out ahead in
 *    61% of runs"). The prompts now forbid the percent dialect too; if it is
 *    ever measured on the wire it needs its own discriminator, not a wider `%`.
 *  - `spelled_out_number` — "a swing of around eight percentage points".
 *    Excluded because the same spelled-out forms are overwhelmingly FACTOR
 *    quantities in this corpus, and a number-word list is the hand-maintained
 *    mirror trap #12 warns about.
 *  - `clause_separated` — "Option A leads, and it is 12 percentage points
 *    clear on the current model." A clause boundary between binder and
 *    connector is excluded by the window above, because admitting it admits
 *    attributive `by`. Trap 22b: one predicate cannot police both directions.
 *  - `long_label_transitive` — "Migrate to HubSpot outperforms Consolidate on
 *    the Salesforce Enterprise Agreement by 21 percentage points."
 *    ⚠ THE ROUND-1 REVIEWER FOUND THIS AND EXPLICITLY FORBADE THE OBVIOUS FIX.
 *    A transitive binder takes a USER-SUPPLIED option label as its object, so
 *    the binder→`by` distance is unbounded — and widening `gap_by`'s window to
 *    reach it is measured to reopen the factor-sensitivity false positive (this
 *    module's own M5 mutant, 25→120). `gap_ahead_of_by` solves the same shape
 *    for `ahead of X by` only because `of` is an explicit comparison marker that
 *    attributive `by` never carries; a bare transitive verb has no such marker,
 *    so there is nothing to discriminate on. Catching it needs the OPTION
 *    ROSTER, which this pure reader does not have. Pinned rather than guessed at
 *    — CLAUDE.md trap 22f: stop adding rounds to an unwinnable predicate and
 *    make the gap explicit instead.
 *  - `label_collides_with_carve_out_noun` — "Option A leads Market Expansion by
 *    10 points." (round-2 review, verbatim.) The market-position carve-out just
 *    above neutralises `leads … market`, so an OPTION LABEL that opens with one
 *    of the carve-out's nouns takes the binder down with it. The control that
 *    makes this a carve-out limit rather than a missing binder: "Option A leads
 *    **Partner Channel** by 10 points." IS caught, same shape, different label.
 *    ⚠ THE FIX IS NOT AVAILABLE AT THIS SEAM. Discriminating "the market" (a
 *    thing the user's firm competes in) from "Market Expansion" (a thing the
 *    user named as an option) needs the OPTION ROSTER, and this reader is pure
 *    over the review object. Narrowing the carve-out instead would re-open the
 *    round-1 over-reach it was added to close — the same two-harms-one-parameter
 *    trade M5 already measured. Pinned rather than chased (trap 22f).
 *  - `basis_point_dialect` — "leads by 500 basis points". A real third dialect
 *    (1 pp = 100 bp) that {@link QTY_SRC} does not admit, because the unit must
 *    follow the digits immediately and "basis" intervenes. Left OUT rather than
 *    added: unlike every MUST-TRIP case in the suite, no capture in this estate
 *    shows the product emitting it, and `LEADER_CLAIM_PATTERNS` states the rule
 *    this follows — *"do not add speculative siblings here, add them when the
 *    control asks"*. Written down so it is a known gap, not a surprise.
 *
 * ⚠ WHAT THIS LIST IS NOT: it is not a list of over-reaches. Two are documented
 * at their patterns instead ({@link GAP_CLAIM_PATTERNS} `qty_better_than`'s
 * temporal comparator, and the `pp.` sentence-merge below), because they remove
 * MORE than intended rather than less, which is the safe direction.
 */
export const KNOWN_UNDETECTED_GAP_FORMS = [
  'percent_dialect',
  'spelled_out_number',
  'clause_separated',
  'long_label_transitive',
  'label_collides_with_carve_out_noun',
  'basis_point_dialect',
] as const;

// ============================================================================
// The reader
// ============================================================================

/**
 * Every gap-claim code this unit of prose matches, sorted and deduped. Empty
 * ⇔ the unit states no runner-up gap statistic.
 *
 * PURE. Never throws. Codes only — never the prose, which is the user's own
 * decision content (R-004).
 */
export function findRunnerUpGapCodes(value: string): string[] {
  if (typeof value !== 'string' || value.length === 0) return [];
  // ⚠ A DIGIT-FREE STRING CANNOT MATCH ANY PATTERN, PROVEN AT THE BYTES ON BOTH
  // PREMISES — this is a short-circuit, not a new discriminator, and it may NOT
  // be widened into one.
  //   (a) all eight `GAP_CLAIM_PATTERNS` embed `QTY_SRC`, which OPENS with
  //       `\d+`, so every one of them requires at least one digit;
  //   (b) `neutralise` only ever REPLACES spans with a single `#`
  //       (`GAP_NEUTRALISED_SPAN` and `leading-option-egress-guard`'s
  //       `ENFORCEMENT_NEUTRALISED_SPAN`, both the literal `'#'`), so it cannot
  //       INTRODUCE a digit into a string that had none.
  // Together: no digit in ⇒ no digit after neutralise ⇒ no pattern can match ⇒
  // `[]`, which is what the loop below would have returned after eight regex
  // executions over the whole string. Pinned by a spec asserting `[]` both
  // before and after `neutralise` on a digit-free corpus.
  if (!/\d/.test(value)) return [];
  const neutralised = neutralise(value);
  const codes: string[] = [];
  for (const { code, re } of GAP_CLAIM_PATTERNS) {
    if (re.test(neutralised)) codes.push(code);
  }
  return codes;
}

/** Does this unit of prose state the size of a lead as a gap between options? */
export function unitStatesRunnerUpGap(value: string): boolean {
  return findRunnerUpGapCodes(value).length > 0;
}

/**
 * The substituted sentence.
 *
 * It says ONLY what the policy means. No leader claim, no number, no existence
 * claim, no cause — the same discipline as
 * `WIRE_WITHHELD_LEADER_REPLACEMENT`, and for the same reason: this seam cannot
 * know which of those would be true.
 *
 * ⚠ IT DELIBERATELY DOES NOT SUBSTITUTE THE CORRECT NUMBER. The leader's own
 * win probability is available upstream, and computing it here would put a
 * SECOND implementation of `analysis-result-headline.ts`'s ratified rounding,
 * tie and single-option logic on a different rail — trap #12 in exchange for a
 * nicer sentence. The correct statistic already reaches the user on the same
 * turn, from the one module that owns it.
 *
 * ⚠ ONE KNOWN OVER-REMOVAL, AND ITS DIRECTION (round-1 review). A sentence
 * ending in the `pp` dialect — "…by 9 pp." — is abbreviation-shaped to
 * `redactable-units.ts`'s splitter (a ≤2-letter final token), so it MERGES with
 * the sentence after it and both are replaced. The direction is
 * OVER-REMOVAL, never under: a larger unit removes more, and can never leave
 * half a claim standing. Left as-is deliberately — the splitter's abbreviation
 * rule is shared with two other gates and is structural, not a lexicon, so
 * special-casing `pp` here would fork a shared primitive to widen the blast
 * radius of nothing.
 */
export const RUNNER_UP_GAP_REPLACEMENT =
  'The size of the lead is not reported as a gap between options — the difference between two ' +
  'win frequencies is not a difference in outcome.';

// ============================================================================
// The deep prose walk
// ============================================================================

export interface RunnerUpGapRedaction<T> {
  /** The value with every offending UNIT replaced. Same reference when clean. */
  readonly value: T;
  /** Sorted, deduped pattern codes. Empty ⇔ nothing was replaced. */
  readonly codes: readonly string[];
  /** Sorted dotted field paths that were edited. Never contains prose. */
  readonly paths: readonly string[];
  /** How many string fields were edited. */
  readonly fields: number;
}

/**
 * Walk every string in `value` and replace the sentences that state a
 * runner-up gap statistic.
 *
 * ⚠ WHY THE WALK IS TOTAL RATHER THAN A FIELD ALLOWLIST. The contract gate one
 * rail over already scans EVERY prose string in the decision-review output for
 * R-CONT (`collectStrings`), and the measured corpus puts this statistic in at
 * least three different fields (`narrative_summary`,
 * `robustness_explanation.summary`, `story_headlines[*]`). A guard pointed at
 * one field while the producer writes several is CLAUDE.md trap 3b at the field
 * grain — and a hand-listed field allowlist is trap #12 waiting for the next
 * schema addition.
 *
 * It is SAFE over non-prose strings by construction, not by exclusion: ids,
 * timestamps and enum values cannot satisfy a gap pattern, and
 * `replaceAssertingUnits` returns its INPUT REFERENCE when no unit asserts.
 * `__tests__` pins that with an id/timestamp-only fixture.
 *
 * PURE. Never throws, never mutates the input. Cycles are impossible here (the
 * input is parsed JSON) and depth is bounded by the decision-review schema.
 */
export function redactRunnerUpGapStatistic<T>(value: T): RunnerUpGapRedaction<T> {
  const codes = new Set<string>();
  const paths = new Set<string>();

  const walk = (node: unknown, path: string): unknown => {
    if (typeof node === 'string') {
      const hits = findRunnerUpGapCodes(node);
      if (hits.length === 0) return node;
      const replaced = replaceAssertingUnits(node, unitStatesRunnerUpGap, RUNNER_UP_GAP_REPLACEMENT);
      // `replaceAssertingUnits` returns the input reference when no UNIT
      // asserts. That can differ from `findRunnerUpGapCodes(whole)`: the split
      // can put the binder and the quantity in different sentences, in which
      // case nothing is replaced and nothing is reported — the honest outcome,
      // and the reason this branch reads the RESULT rather than the hits.
      if (replaced === node) return node;
      for (const code of hits) codes.add(code);
      paths.add(path === '' ? '<root>' : path);
      return replaced;
    }
    if (Array.isArray(node)) {
      let changed = false;
      const out = node.map((item, i) => {
        const next = walk(item, `${path}[${i}]`);
        if (next !== item) changed = true;
        return next;
      });
      return changed ? out : node;
    }
    if (node !== null && typeof node === 'object') {
      let changed = false;
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(node as Record<string, unknown>)) {
        const next = walk(item, path === '' ? key : `${path}.${key}`);
        if (next !== item) changed = true;
        out[key] = next;
      }
      return changed ? out : node;
    }
    return node;
  };

  const walked = walk(value, '') as T;
  return {
    value: walked,
    codes: [...codes].sort(),
    paths: [...paths].sort(),
    fields: paths.size,
  };
}

/**
 * THE OPERATOR ALARM for a redaction, emitted identically by both carriers.
 *
 * ⚠ ONE COPY, BECAUSE IT IS AN ALARM AND ALARMS DRIFT SILENTLY. This ~20-line
 * `log.warn` was typed out verbatim at BOTH redaction sites —
 * `orchestrator-v5/coaching/decision-review-enricher.ts` (the V5 enrichment
 * seam) and `routes/assist.v1.decision-review.ts` (the M2 route) — differing
 * only in the event name and one context field. Everything that matters is the
 * SAME: the redaction-safe payload (field PATHS and pattern CODES only, never
 * the matched prose, which is the user's own decision content — R-004) and the
 * operator instruction, which names the PMS row to fix. Two copies of an
 * instruction is the hand-maintained mirror class (CLAUDE.md trap 12) at its
 * most expensive: an operator who fixes one alarm's wording and not the other
 * gets two different accounts of one defect, and nothing goes red. It lives
 * beside {@link redactRunnerUpGapStatistic} — the reader both carriers already
 * share — so the reader and its alarm cannot drift apart either.
 *
 * No-ops when nothing was redacted, so the caller's `if (fields > 0)` guard is
 * not a third thing to keep in step.
 */
export function logRunnerUpGapRedaction(
  logger: { warn: (obj: Record<string, unknown>, msg: string) => void },
  event: string,
  context: Record<string, unknown>,
  redaction: Pick<RunnerUpGapRedaction<unknown>, 'codes' | 'paths' | 'fields'>,
): void {
  if (redaction.fields === 0) return;
  logger.warn(
    {
      event,
      ...context,
      // Field PATHS and pattern CODES only — never the matched prose, which is
      // the user's own decision content (R-004).
      hit_paths: redaction.paths,
      hit_codes: redaction.codes,
      hit_fields: redaction.fields,
    },
    `${event}: the review stated the size of the lead as a ` +
      'gap between options. The gap between two win frequencies is not a difference in outcome ' +
      'and inflates when any other option collapses. FIX THE SERVED PROMPT — the repo default ' +
      'is correct; the PMS `decision_review_default` row is what this alarm is measuring.',
  );
}
