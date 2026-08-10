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
 * "33 percentage points", "78 points", "7pp", "7.5 percentage points".
 *
 * ⚠ BARE `%` IS DELIBERATELY EXCLUDED. "leads by 24%" is the same category
 * error in a third dialect, and it is NOT matched here — see
 * {@link KNOWN_UNDETECTED_GAP_FORMS} for why, and for the test that pins it.
 * Admitting `%` would put this reader one loose window away from redacting
 * "leads with a 42% win probability", which is the RATIFIED-CORRECT sentence.
 */
const QTY_SRC = String.raw`\d+(?:[.,]\d+)?\s*(?:percentage[\s-]?points?|pp|points?)\b`;

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
 *
 * The replacement token inherits the three properties documented on
 * `ENFORCEMENT_NEUTRALISED_SPAN`: non-word, non-whitespace, not NUL — so
 * neutralisation can only ever REMOVE a match, never manufacture one.
 */
const GAP_FALSE_POSITIVE_SPANS: readonly RegExp[] = [
  /\b(?:driven|caused|explained|supported|underpinned|helped|hurt|shaped|informed|affected|influenced|accompanied|offset|dominated|amplified|dampened)\s+by\b/gi,
  /\b(?:gross|net|operating|profit|contribution|ebitda|ebit|retention|churn)\s+margins?\b/gi,
  /\bahead\s+of\s+(?:the\s+)?(?:schedule|time|plan|deadline|launch|target\s+date|forecast)\b/gi,
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
 */
const GAP_BINDER_SRC = String.raw`(?:leads?|leading|led|ahead|in\s+front|on\s+top|trails?|trailing|trailed|behind|lags?|lagging|margin|gap|performs?\s+best|outperforms?|outranks?|beats?)`;

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
  // "51 percentage points ahead of the runner-up" · "12 points behind"
  {
    code: 'qty_ahead_of',
    re: new RegExp(String.raw`${QTY_SRC}\s+(?:ahead|behind|clear|adrift|in\s+front)\b`, 'i'),
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
 */
export const KNOWN_UNDETECTED_GAP_FORMS = [
  'percent_dialect',
  'spelled_out_number',
  'clause_separated',
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
