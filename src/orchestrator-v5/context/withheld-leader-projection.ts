/**
 * T1 claim safety — INPUT-SIDE gating. ROADMAP 1.231 (with 1.233).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE RULING THIS IMPLEMENTS, AND THE ONE CORRECTION TO IT.
 *
 * A1's ruling on row 1.231: gate the INPUT, not the output. The model cannot
 * name a leader it never sees, so strip the leader-designating fields from
 * what a withheld turn feeds the coach, and leave the Layer-3 egress guard
 * observe-only. That avoids scrubbing legitimate coaching prose, which is the
 * failure the acceptance criteria weight equally with the leak.
 *
 * The ruling names `context-pack-assembler.ts:1533` as the locus, on the
 * (correct) finding that the assembler never nulls `leading_option` there.
 * **That locus is wrong, and gating there alone would have been theatre.**
 * `buildUserMessage` (`routing/route-with-tool-use.ts:1185-1208`) destructures
 * the raw `analysis` OUT of the pack and re-keys `display_analysis` under the
 * name `analysis` before serialising. The model therefore never sees the field
 * :1533 emits. Verified at the bytes on the tip this lands on:
 *
 *     const { analysis: _rawAnalysis, display_analysis, … } = contextPack;
 *     void _rawAnalysis;
 *     const llmFacing = { ...rest, analysis: display_analysis, … };
 *
 * The ruling's INTENT is right and is implemented in full; its ADDRESS moves
 * one hop, to the model-facing projection. Both shapes are handled here
 * because the raw slot has its own, different consumer problem — see below.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * TWO SHAPES, ONE DOCTRINE, TWO DIFFERENT REASONS.
 *
 *   `projectDisplayAnalysisForWithheldClaim` — the MODEL-facing view. This is
 *   the 1.231 gate proper: it is what reaches Sonnet, and it is where the
 *   POST-#713 walk's `case5.clarify` leak ("the analysis currently favours
 *   Standardise on MacBook Pro, with a probability of 56%", no disclosure)
 *   got its facts.
 *
 *   `projectContextPackAnalysisForWithheldClaim` — the HANDLER-facing raw
 *   view. Not fed to any model; fed to DETERMINISTIC composers that build
 *   leader prose in code. The post-analysis advice gate is the sharp case: it
 *   reads this projection directly and emits, with zero LLM calls, "Based on
 *   this model, the analysis currently favours ${leadingLabel}${probability}"
 *   and "It sits ahead of ${runnerLabel} by ${margin}". Input-gating cannot
 *   help a model that is not involved; what it does instead is hand that gate
 *   the SAME null-leader shape it already handles as
 *   `data_unavailable_for_class` / `missing_inputs: ['leading_option']`.
 *
 * ⚠ WHY THE SECOND ONE IS NOT AN ENUMERATION OF CLASSES. The advice gate has
 * a `needs_leading_option` requirements table over ~10 advice classes. Gating
 * by listing the leader-naming classes at the call site would be exactly the
 * hand-maintained mirror CLAUDE.md trap #12 is about — a new class added later
 * would inherit "safe" silently. Nulling the INPUT instead makes the gate's own
 * `evaluateAvailability` do the work: any class that declares
 * `needs_leading_option` declines automatically, forever, including classes
 * that do not exist yet. Classes that do NOT need a leader (readiness,
 * evidence-gap) keep serving. That is the anti-over-suppression property, and
 * it is structural rather than curated.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT COUNTS AS "LEADER-DESIGNATING", DERIVED RATHER THAN CHOSEN.
 *
 * DROPPED:
 *   - `leading_option` / `runner_up` (`margin_pp` / `margin` with them) — the
 *     explicit designations. `margin` goes because a margin is a statement
 *     ABOUT an ordering; "a 30 point margin" was in the live leak verbatim.
 *   - `options` (the ranked list) — **and this is the load-bearing one.** It is
 *     `validOptions.slice().sort((a, b) => b.win_probability - a.win_probability)`
 *     rendered as `{label, win_probability: "56%"}`. A list ordered by win
 *     probability, carrying the win probabilities, IS a leading-option claim in
 *     data form: `options[0]` is the leader by construction. The live leaking
 *     sentence — "MacBook Pro leads at 56% against Dell XPS at 26%" — is
 *     reconstructible from this field alone. Dropping the two named slots and
 *     keeping the ranked table would be a gate that reads as a gate and stops
 *     nothing, which is this estate's dominant defect class.
 *
 * KEPT, deliberately, and this is where over-suppression is refused:
 *   `status`, `robustness_band`, `top_drivers`, `fragile_edges`,
 *   `fragile_edge_count`, `tipping_points` / `flip_thresholds`,
 *   `value_of_information` / `evidence_gaps`, `goal_fit`, `confidence_tier`
 *   and every disclosure note. None of them ranks options against each other,
 *   and they are exactly the content a user needs MOST on the turn where a
 *   recommendation is being withheld. This mirrors, deliberately, the reasoning
 *   `compose/withheld-claim-projection.ts` already applies to `decision_brief`:
 *   drop the members that carry the comparative claim, ship the rest.
 *
 * KEPT WITH A NAMED EXCEPTION — `constraint_infeasible_note`. It DOES contain
 * an option label: `buildConstraintViolationNote(summary.winner.option_label)`
 * (`orchestrator/context/analysis-compact.ts:891`). It is kept anyway, and the
 * decision is recorded rather than made silently. It names the winner ONLY to
 * say that option fails the user's ratified constraint — an anti-recommendation
 * and a disclosure, not a claim we may not stand behind. Its own contract says
 * it is never dropped even by the char-budget guard because "constraint
 * truthfulness outranks breadth", and suppressing the sentence that tells a
 * user their constraint was violated, on the grounds that it mentions which
 * option violated it, would invert the purpose of the verdict. The residual
 * risk is real and stated: a model handed that note can still write "X, which
 * is leading, fails your constraint" — the POST-#713 walk's `caseINFf` is that
 * shape. It has no win probability to attach any more, and the Layer-3 alarm
 * now actually fires on those turns (1.233), which is how we will find out.
 *
 * NEVER-SILENT. Both projections stamp a note in place of what they removed.
 * Silence is what let a model narrate around a missing section before (the
 * `goal_fit` and `value_of_information_note` papercuts, both live); an absent
 * ranking with no explanation invites either invention or a false "no options
 * exist". The note is deterministic, carries no label and no number, and is
 * checked at module load against the SAME leader vocabulary the egress alarm
 * uses, so the input gate cannot introduce the residue the output alarm
 * measures.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * PURE. Never throws, never mutates its input, returns new objects.
 */

import type { ContextPackAnalysis } from './context-pack-assembler.js';
import type { DisplaySafeAnalysis } from '../format/format-analysis-for-context.js';
import { textAssertsLeadingOption } from '../compose/leading-option-egress-guard.js';

/**
 * The note stamped onto a withheld MODEL-facing projection in place of the
 * dropped ranking. Addressed to the coach, in the receive-vs-author register
 * the other prompt-facing notes use.
 *
 * No option label, no probability, no verdict jargon. It says what is absent,
 * why, and what the model may do instead — the third clause matters, because a
 * bare "this was removed" invites the model to reach for the numbers it can
 * still see in `top_drivers`.
 *
 * ⚠ THE WORDING IS CONSTRAINED BY THE ALARM, and the constraint bit during
 * development rather than in review: the first draft said "do not state or
 * imply which option is out in front", and the build-time probe below rejected
 * it — `out in front` is a live pattern (`out_in_front`) in the shared leader
 * vocabulary, so that phrasing would have injected a guard hit into every
 * withheld prompt and shown up only as an alarm rate nobody had a reason to
 * look at. The instruction is therefore phrased WITHOUT any comparative idiom.
 * Recording that here because the next person to improve this copy will reach
 * for the same natural phrase.
 */
export const WITHHELD_LEADER_INPUT_NOTE =
  'Option ranking is not available for this turn: a condition the user ratified ' +
  'could not be checked against this result, so no option can be put forward and ' +
  'none is shown here. Do not name or imply any option as the answer, and do not ' +
  'infer one from the drivers below. Discuss what the model shows about the ' +
  'drivers, the fragility of the result, and what evidence would firm it up.';

/**
 * Members of the MODEL-facing `DisplaySafeAnalysis` that designate a leading
 * option. See the module docstring for why `options` is in this list.
 */
export const WITHHELD_DROPPED_DISPLAY_ANALYSIS_MEMBERS: readonly string[] =
  Object.freeze(['leading_option', 'runner_up', 'margin', 'options']);

/**
 * Members of the HANDLER-facing `ContextPackAnalysis` that designate a leading
 * option. Same doctrine, different member names (`margin_pp` not `margin`).
 */
export const WITHHELD_DROPPED_PACK_ANALYSIS_MEMBERS: readonly string[] =
  Object.freeze(['leading_option', 'runner_up', 'margin_pp', 'options']);

/**
 * Project the MODEL-facing analysis view for a turn whose verdict WITHHOLDS.
 *
 * The caller owns the permission (`mayNameLeadingOption === false`) and this
 * function assumes it — it does not re-derive the verdict, so the permission
 * and the input it governs describe the same analysis (CLAUDE.md trap #12).
 *
 * `null` in ⇒ `null` out: a turn with no analysis has no ranking to remove and
 * must not grow a note claiming one was withheld.
 */
export function projectDisplayAnalysisForWithheldClaim(
  display: DisplaySafeAnalysis | null,
): DisplaySafeAnalysis | null {
  if (display === null || typeof display !== 'object') return display;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(display as unknown as Record<string, unknown>)) {
    if (WITHHELD_DROPPED_DISPLAY_ANALYSIS_MEMBERS.includes(key)) continue;
    out[key] = value;
  }
  // Never-silent: the note replaces what was removed, and is stamped even when
  // the source carried no ranking to begin with. A withheld turn says so
  // whether or not the producer happened to populate the fields — otherwise
  // the note's presence would leak which shape the producer sent.
  out['leading_option_note'] = WITHHELD_LEADER_INPUT_NOTE;
  return out as unknown as DisplaySafeAnalysis;
}

/**
 * Project the HANDLER-facing raw analysis view for a turn whose verdict
 * WITHHOLDS, for the deterministic composers that read it.
 *
 * `leading_option` / `runner_up` / `margin_pp` are set to `null` rather than
 * removed: unlike the display shape (whose members are all optional), these are
 * DECLARED nullable on `ContextPackAnalysis` and consumers already branch on
 * `=== null`. Handing them the null they are written to expect exercises paths
 * that exist and are tested; deleting a declared member would not.
 *
 * `options` IS removed rather than emptied, for the opposite reason: it is an
 * optional member whose absence is already the shape hand-built projections
 * ship (the chip-click dispatch builds one without it), whereas `[]` is a
 * positive assertion that the analysis contains no options, which is false.
 */
export function projectContextPackAnalysisForWithheldClaim(
  analysis: ContextPackAnalysis | null,
): ContextPackAnalysis | null {
  if (analysis === null || typeof analysis !== 'object') return analysis;
  const { options: _dropped, ...rest } = analysis as ContextPackAnalysis & {
    options?: unknown;
  };
  void _dropped;
  return {
    ...(rest as ContextPackAnalysis),
    leading_option: null,
    runner_up: null,
    margin_pp: null,
  };
}

/**
 * BUILD-TIME PROBE — the note this gate INJECTS must not itself trip the alarm
 * that measures the residue this gate exists to remove.
 *
 * The same mechanism, and the same rationale, as
 * `compose/withheld-explanation-answer.ts`'s `assertSubstitutedCopyIsLeaderFree`:
 * without it, a copy edit that reached for a natural word ("…which option is
 * ahead…") would put a leader-vocabulary hit into every withheld prompt, and the
 * only symptom would be an alarm rate nobody had a reason to look at.
 *
 * Runs at module load and throws on drift, so a violation fails the process at
 * startup and every test that imports the seam — loudly, which is the point
 * (CLAUDE.md trap #12: a mirror must fail loud, never assume-good).
 */
function assertInjectedNoteIsLeaderFree(): void {
  if (textAssertsLeadingOption(WITHHELD_LEADER_INPUT_NOTE)) {
    throw new Error(
      'withheld-leader-projection: WITHHELD_LEADER_INPUT_NOTE trips the shared ' +
        'leader vocabulary (compose/leading-option-egress-guard.ts ' +
        'LEADER_CLAIM_PATTERNS). The input gate would inject the exact residue ' +
        'the output alarm measures, on every withheld turn. Reword the note — ' +
        'do not narrow the pattern set, which is shared with the alarm.',
    );
  }
}
assertInjectedNoteIsLeaderFree();
