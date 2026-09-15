/**
 * WINNER-NAMING EGRESS GUARD — the decision review's headline must name the
 * option the model actually crowned.
 *
 * ## The defect this closes (measured, 2026-09-15)
 *
 * `decision_review.narrative_summary` is free prose written by the review
 * model. It composes the primary `review_card` body (`phase3-blocks.ts`
 * `buildNarrativeCard`) — the first sentence a user reads after an analysis.
 * On the build serving today NOTHING compares that prose against the winner
 * stored on the run:
 *
 *  - `checkDecisionReviewContract` touches `narrative_summary` only to assert
 *    it is a non-empty string (contract-gate.ts);
 *  - `performShapeCheck`'s UNGROUNDED_NUMBER scan is never called on the live
 *    enricher path (dsk-grounding-policy.ts and contract-gate.ts both say so);
 *  - the one check that DOES compare them — `narrativeNamesOption` at
 *    `decompose.ts:759` — is fenced inside the decomposed path, which
 *    `CEE_DECISION_REVIEW_DECOMPOSE` leaves OFF by default (config/index.ts:959;
 *    confirmed ABSENT from the deployed Render env, with
 *    `CEE_DECISION_REVIEW_ENABLED` present as the contrast control). Even when
 *    switched on, its reaction is to FALL BACK to the monolith — the unchecked
 *    path.
 *
 * Measured consequence on three captured runs: the headline stated a price
 * (£44, £59, £52) that appears on NO option in the model, while the sibling
 * `options[].label` and `analysis_summary.leading_option` rendered the stored
 * label (£49, £49, £59) correctly. Same screen, two different prices.
 *
 * ## Why the predicate is REUSED, not re-written
 *
 * `narrativeNamesOption` is already exported and already carries the measured
 * tolerance this problem needs: numerals match EXACTLY (so "£44" cannot satisfy
 * "£49") while word stems absorb inflection (so the gerund "Raising the Pro
 * plan price to £49…" of a correct review is NOT flagged). A second copy of
 * that rule here would be CLAUDE.md trap 12 — two lists drifting apart — and a
 * currency-figure-vs-graph scan would bind by a VALUE PREDICATE another object
 * could satisfy instead of by the winner's own IDENTITY (trap 19).
 *
 * Extracted verbatim and EXECUTED against the three captured narratives it
 * fires 3/3, and returns true for the honest narrative and for the inflected
 * control the tolerance exists for — discriminating, not merely sensitive.
 *
 * ## Why SUBSTITUTE rather than drop (Paul's ruling, 2026-09-15)
 *
 * Nothing may fail silently. Routing this through the contract gate's
 * `mustDrop` path would take out the WHOLE decision review — bias findings,
 * evidence enhancements, flip thresholds and all — and the user would simply
 * see less, with no way to tell that anything had gone wrong. So the narrative
 * is REPLACED with a deterministic sentence composed from the STORED winner,
 * and the substitution DISCLOSES ITSELF in the same sentence with a copyable
 * reference. The failure is Olumi's, never the user's data.
 *
 * ## Why PER-SENTENCE, not the whole narrative (CORRECTED 2026-09-15)
 *
 * This guard originally replaced the WHOLE field, reasoning that "when it fires
 * the winner is named nowhere, so every option name inside it is unvouched".
 * ⛔ THAT WAS FALSE, and it shipped two defects:
 *
 *  1. Absence of the winner's name is NOT presence of a lie. A narrative that
 *     crowns nobody ("The size of the lead is not reported as a gap between
 *     options… ICP Clarity stands out as a key unknown") is honest and contains
 *     no wrong claim, yet was replaced wholesale.
 *  2. Worse, the replacement DISCLOSES AN OLUMI FAULT. Firing it on a healthy
 *     run tells the user Olumi broke when it did not, and invites them to quote
 *     a reference for a turn that was fine. Paul's 2026-09-15 ruling makes the
 *     fault channel load-bearing; a false positive there costs more than
 *     silence, because it spends the credibility the channel runs on.
 *
 * The ordering compounded it: `redactRunnerUpGapStatistic` runs FIRST in the
 * enricher and removes the very sentence that named the winner — so the first
 * policy manufactured this one's trigger, and the surgical result it had just
 * preserved was then demolished (CLAUDE.md trap 21: two policies answering
 * different questions under similar names).
 *
 * So the action is now the one `runner-up-gap-statistic.ts` actually takes, and
 * the one its sibling rule states 40 lines up in the enricher — ⚠ PER-FIELD,
 * PER-SENTENCE, NOT A DROP. The contradicting sentences are removed, the true
 * stored-winner claim leads, the honest remainder SURVIVES, and the
 * substitution discloses itself once.
 *
 * ## The one thing this guard must NOT do
 *
 * On a turn where the leader claim is WITHHELD (`recommendation_suppressed`,
 * set at `buildInvokeInput` from the single constraint verdict) it must not
 * AUTHOR the crowning sentence the withhold exists to prevent. In that state
 * the replacement names no option at all and makes no claim — it discloses the
 * substitution and stops.
 */

import {
  narrativeNamesOption,
  narrativeRestatesLabelWithDifferentNumeral,
  splitNarrativeSentences,
} from '../../cee/decision-review/decompose.js';
import { COACHING_BLOCK_BODY_MAX } from '../coaching/fragile-edge-offer-text.js';

/**
 * The lead-clause grammar. Deliberately the SAME wording the deterministic
 * headline owns (`analysis-result-headline.ts` — "scored highest against your
 * goal in N% of runs of this model"), so a user reading the card and the
 * headline on one screen reads one claim in one voice.
 */
const LEAD_CLAUSE_OPENING = 'scored highest against your goal in';

/** Disclosure sentence. Names the fault as Olumi's without blaming the model. */
const SUBSTITUTION_NOTICE =
  'Olumi replaced the written summary for this run — it did not match the analysed model.';

/** Why the substitution happened, in one stable machine-readable code. */
export const WINNER_NAMING_REASON = 'narrative_did_not_name_stored_winner';

/**
 * Disclosure payload. Rides `ErrorBlock.details` (strict at top level, PASSTHROUGH
 * inside `details`) and the `decision_review` enrichment subtree, so it reaches
 * the wire with no schema release.
 *
 * `fault` DEFAULTS TO `'olumi'` and has no other value here by construction: a
 * narrative that fails to name the stored winner is never the user's doing.
 */
export interface WinnerNamingDetails {
  readonly fault: 'olumi';
  readonly request_id: string;
  readonly readable: string;
  readonly reason: typeof WINNER_NAMING_REASON;
  /** The stored label the narrative failed to name. Never the model's prose. */
  readonly winner_label: string;
}

export interface WinnerNamingGuardResult<T> {
  /** The output with `narrative_summary` replaced. SAME REFERENCE when clean. */
  readonly value: T;
  /** True ⇔ a substitution happened. */
  readonly substituted: boolean;
  /** Disclosure payload, or null when nothing was substituted. */
  readonly details: WinnerNamingDetails | null;
}

/** The stored winner, as `DecisionReviewInvokeInput['winner']` carries it. */
export interface StoredWinner {
  readonly label: string;
  readonly win_probability: number;
  readonly recommendation_suppressed?: boolean;
  readonly [k: string]: unknown;
}

/**
 * The deterministic crowning sentence, composed from the STORED winner.
 *
 * Returns '' when the run's leader claim is WITHHELD (`recommendation_suppressed`)
 * or the label is empty — in that state the guard must not AUTHOR the very
 * sentence the withhold exists to prevent, so the caller discloses and stops.
 */
function buildWinnerNamingLead(winner: StoredWinner): string {
  if (winner.recommendation_suppressed === true) return '';
  const label = winner.label.trim();
  if (label.length === 0) return '';
  const p = winner.win_probability;
  const pct =
    typeof p === 'number' && Number.isFinite(p) && p > 0 && p <= 1 ? Math.round(p * 100) : null;
  return pct === null || pct < 1
    ? `${label} is the option the stored result for this run records as scoring highest.`
    : `${label} ${LEAD_CLAUSE_OPENING} ${pct}% of runs of this model.`;
}

/**
 * Compose the replacement narrative from the STORED winner.
 *
 * Exported for the seam test. Pure; never throws.
 *
 * The reference is placed LAST and the composed string is kept inside
 * `COACHING_BLOCK_BODY_MAX` — the cap `buildNarrativeCard` truncates the body
 * at — by dropping the explanatory middle sentence first, never the reference.
 * A disclosure whose copyable reference is truncated away is not a disclosure.
 */
export function buildWinnerNamingReplacement(
  winner: StoredWinner,
  requestId: string,
): string {
  const reference = `Olumi fault — ref ${requestId}.`;
  const suppressed = winner.recommendation_suppressed === true;
  const label = winner.label.trim();
  const p = winner.win_probability;
  const pct = typeof p === 'number' && Number.isFinite(p) && p > 0 && p <= 1
    ? Math.round(p * 100)
    : null;

  // Withheld leader claim: name no option, make no claim, still disclose.
  if (suppressed || label.length === 0) {
    return `${SUBSTITUTION_NOTICE} ${reference}`;
  }

  const lead = buildWinnerNamingLead(winner);

  const full = `${lead} ${SUBSTITUTION_NOTICE} ${reference}`;
  if (full.length <= COACHING_BLOCK_BODY_MAX) return full;
  // Absurdly long label: keep the two load-bearing halves — who won, and the
  // reference — and shed the explanation.
  return `${lead} ${reference}`;
}

/**
 * Replace `narrative_summary` when it does not name the stored winner.
 *
 * Returns its INPUT REFERENCE untouched when the narrative is honest, when the
 * stored label is empty (nothing to bind to — the same precondition as
 * `decompose.ts:759`), or when `narrative_summary` is not a string.
 *
 * PURE. Never throws, never mutates the input.
 */
export function applyWinnerNamingEgressGuard<T extends Record<string, unknown>>(
  output: T,
  winner: StoredWinner | null | undefined,
  requestId: string,
): WinnerNamingGuardResult<T> {
  const clean: WinnerNamingGuardResult<T> = { value: output, substituted: false, details: null };
  if (winner === null || winner === undefined) return clean;
  const label = typeof winner.label === 'string' ? winner.label.trim() : '';
  // Empty label ⇒ no binding exists. `narrativeNamesOption` returns false for an
  // empty label, so without this the guard would fire on EVERY review.
  if (label.length === 0) return clean;
  const narrative = output.narrative_summary;
  if (typeof narrative !== 'string' || narrative.trim().length === 0) return clean;
  if (narrativeNamesOption(narrative, label)) return clean;

  // ⭐ THE DISCRIMINATION. Not naming the winner is not, by itself, a fault: an
  // honest narrative may crown nobody. Fire only on a sentence that RESTATES the
  // winner's own label with a different numeral — the measured shape of all
  // three captured defects, bound to the winner by IDENTITY.
  //
  // ⛔ Deliberately NOT gated on a win-cue: MEASURED, `WIN_CUE` does not match
  // "produced the best outcome in N% of runs of this model", the template all
  // three defects use, so a crowning-sentence gate would stand this guard down
  // on 3 of 3 real defects. See the note on
  // `narrativeRestatesLabelWithDifferentNumeral`.
  const sentences = splitNarrativeSentences(narrative);
  const offending = sentences.filter((sentence) =>
    narrativeRestatesLabelWithDifferentNumeral(sentence, label),
  );
  // No contradicting sentence ⇒ the narrative is silent about the winner, not
  // wrong about it. Leave it BYTE-IDENTICAL and raise no fault.
  if (offending.length === 0) return clean;

  const offendingSet = new Set(offending);
  const survivors = sentences.filter((sentence) => !offendingSet.has(sentence));
  const lead = buildWinnerNamingLead(winner);
  const reference = `Olumi fault — ref ${requestId}.`;
  const disclosure = `${SUBSTITUTION_NOTICE} ${reference}`;

  const rebuilt = [...(lead === '' ? [] : [lead]), ...survivors, disclosure].join(' ');
  // Budget fallback: keep the two load-bearing halves — who won, and the
  // reference — and shed the surviving discussion rather than the disclosure.
  const replacement =
    rebuilt.length <= COACHING_BLOCK_BODY_MAX
      ? rebuilt
      : buildWinnerNamingReplacement(winner, requestId);

  return {
    value: { ...output, narrative_summary: replacement },
    substituted: true,
    details: {
      fault: 'olumi',
      request_id: requestId,
      readable:
        'The written summary for this analysis did not name the option the model actually ' +
        'scored highest. Olumi replaced it with the stored result.',
      reason: WINNER_NAMING_REASON,
      winner_label: label,
    },
  };
}
