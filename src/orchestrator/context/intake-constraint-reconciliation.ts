/**
 * DID THE INTAKE RECORD THE HARD LIMIT THE USER STATED?
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE MEASURED DEFECT (fresh-guest journey, deployed build, 2026-08-24).
 *
 * A user's brief stated an explicit cap:
 *
 *   "…with a £50,000 cap."
 *
 * Across THREE journeys CEE minted ZERO `goal_constraints[]` entries. The cap
 * became an ordinary risk node ("Budget Constraint Breach", "50% strength ·
 * est.") — a drafted guess, not the user's stated condition. The £90,000
 * option, £40,000 OVER the cap, was then crowned "Leading option" at 71%
 * (84% on reproduction), with the two compliant options ranked 3rd and 4th.
 * The user was told nothing: zero occurrences of 22 breach/eligibility
 * literals, every magnitude literal and every compliance-unresolved literal,
 * against positive controls firing 3–11 times in the same captures.
 *
 * ⚠ WHY THE EXISTING CONSTRAINT VERDICT CANNOT SEE THIS, and it is not a bug
 * in that module. `deriveConstraintVerdict` reasons over the constraints the
 * user RATIFIED — `readRatifiedConstraints` is the sole reader of
 * `goal_constraints[]`, and constraints are metadata, so that array is the
 * only record of what was represented. With ZERO rows, `effective.length === 0`
 * and the verdict is `not_applicable`, which declares `mayNameLeadingOption:
 * true`. That is the CORRECT answer to the question that module asks ("was the
 * hard condition the user ratified honoured by this result?"): nothing was
 * ratified, so there is nothing to withhold for. The gap is that NOTHING ASKED
 * THE OTHER QUESTION — "did we record the limit the user stated at all?" — and
 * `not_applicable` therefore covers both "the user stated no limits" and "the
 * user stated a limit we never represented". Those are different facts and only
 * one of them licenses a leading-option claim.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE FOUNDER'S RATIFIED DOCTRINE, CLAUSE THREE — what this module implements.
 *
 *   "If compliance CANNOT be evaluated: do not silently recommend across the
 *    unknown — state that compliance is unresolved, identify the missing
 *    information, and withhold or qualify the recommendation."
 *
 * Clauses one and two (represent the cap as an eligibility condition; show the
 * breach and its magnitude) require the drafter and the engine to change.
 * Clause three requires neither, and it is exactly the state the product is in.
 *
 * ⚠⚠ THIS MODULE NEVER ASSERTS A BREACH, AND NEVER ASSERTS COMPLIANCE. It has
 * no access to any option's value on any axis and reads no producer output at
 * all. Its single observable is "the brief states a limit; the model records
 * none", and the only claim built on it is that compliance is UNRESOLVED. The
 * new state means "we do not know", never "it fails".
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠⚠ WHY THIS IS A THIRD AXIS AND NOT A SIXTH `ConstraintVerdictState`.
 *
 * The obvious shape — one more state on the existing five — is NOT LANDABLE at
 * this pin, and that is measured rather than assumed. It is the same finding
 * `intake-option-reconciliation.ts` recorded for its own axis, re-derived here
 * at `@talchain/schemas` 0.48.0 (`package.json:93`):
 *
 *   `ConstraintVerdictStateSchema` is `z.enum([...])` over EXACTLY five
 *   members, and `RunAnalysisResultSchema.constraint_verdict` embeds it
 *   `.strict()`. That schema is embedded in `RunAnalysisHandlerFactSchema`,
 *   which is `safeParse`d ON WRITE in `run_analysis` (throws
 *   `HandlerResultInvalidError`) and again ON READ through `HandlerFactSchema`
 *   in the session store (throws `SessionReadError`). A sixth state would fail
 *   the write, and any row that reached the store would poison every
 *   subsequent session read.
 *
 * There is also a compile-time bolt that makes this loud rather than silent:
 * `constraint-feasibility.ts`'s `_persistedClaimSafetyMatchesContract` asserts
 * bidirectional assignability between `PersistedClaimSafety` and the contract
 * type, so a sixth member fails `pnpm typecheck` — the gate.
 *
 * AND THE SECOND REASON, which survives any schemas release and is the more
 * important one — CLAUDE.md trap 21, the leader-claim permission seam that was
 * closed by one PR and re-opened by its neighbour a day later. The axes ANSWER
 * DIFFERENT QUESTIONS:
 *
 *   `ConstraintVerdictState`  — "was the hard condition the user RATIFIED
 *                               honoured by this result?"      (about the RUN)
 *   `IntakeConstraintState`   — "did we RECORD the limit the user stated?"
 *                                                           (about the INTAKE)
 *
 * A run can be `evaluated_feasible` on every ratified constraint and still have
 * dropped a second limit the user stated. Folding intake into the constraint
 * enum would put a fact about the BRIEF inside a union whose every disclosure
 * and repair step is about constraints that EXIST on the model — and the copy
 * would then tell a user their recorded limit "could not be checked" when the
 * truth is that no limit was recorded at all.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ NOT PERSISTED — DERIVED AT THE POINT OF THE CLAIM, exactly as the option
 * axis is. `run_analysis`'s `result.enrichment` is a byte-for-byte pass-through
 * of the PLoT envelope (enforced by `scripts/validate-handler-ownership.sh` §6),
 * so there is no CEE-owned enrichment slot to stamp, and the brief plus
 * `goal_constraints[]` are canonical persisted state — a copy of them on the
 * fact would be a mirror (CLAUDE.md trap 12).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠⚠ IT READS NOTHING FROM PLoT, AND THAT IS A SAFETY PROPERTY, NOT AN
 * ACCIDENT. PLoT's repair layer is currently observed to CLAMP a real-money cap
 * (`£50,000`) to `<= 1` at `severity: info`. On a 0–1 axis where every option
 * sits at 0.35–0.9 that clamped value would certify the £90,000 option as
 * COMPLIANT. This module consumes no producer value of any kind — not the
 * clamped threshold, not a constraint probability, not a goal-fit — so it
 * cannot inherit that defect. No code path here may ever be extended to read a
 * producer-supplied threshold: the clamp must close before any eligibility
 * RANKING is built on producer values.
 *
 * PURE. No I/O, no clock, no LLM, no coaching field, no producer envelope.
 */

import { findStatedAmounts } from '../../cee/provenance/stated-amounts.js';

import type { PersistedClaimSafety, RatifiedConstraint } from './constraint-feasibility.js';

/**
 * Did the intake record the hard limits the brief states?
 *
 * TWO ANSWERS, AND THE ABSENCE OF A THIRD IS DELIBERATE. The sibling option
 * axis has three because its middle answer is genuinely observable: every
 * enumerated candidate matched an option label, so "the set is as complete as
 * the brief says" is a fact. There is no honest equivalent here. Establishing
 * that a PARTICULAR stated limit is the one a given `goal_constraints[]` row
 * represents would mean matching magnitudes across the row's `value`, whose
 * frame (`goal_threshold_frame` / level-vs-delta) the contract itself declares
 * UNATTESTED and fail-closed. A "represented" state built on that comparison
 * would be a certificate resting on a value nobody has attested — the same
 * shape of mistake as reading a clamped cap as a real one. So this module
 * answers only where its evidence is sound, and says nothing everywhere else.
 */
export type IntakeConstraintState =
  /**
   * No opinion, and today's behaviour byte-for-byte. Reached when the brief is
   * absent, when it states no explicit hard limit this module can read, OR —
   * the load-bearing precision guard — when the model DOES carry at least one
   * ratified constraint. See {@link deriveIntakeConstraintReconciliation}
   * rule 2 for why a partially-recorded set gets no opinion.
   */
  | 'not_applicable'
  /**
   * The brief states at least one explicit hard limit and the model records NO
   * ratified constraint at all. Nothing was sent to the engine to enforce, so
   * compliance with the stated limit is UNRESOLVED — not breached, not held.
   *
   * ⚠ THIS IS NOT A BREACH FINDING. No option value is read to reach it, and
   * no copy built on it may say a limit was broken.
   */
  | 'limits_unrecorded';

/**
 * May a leading option be NAMED as the answer, per intake-constraint state?
 * Exhaustive by construction — `Record<IntakeConstraintState, boolean>` makes a
 * new state without a declared answer a compile error rather than a silent
 * `undefined`.
 *
 * Same doctrine, same shape and deliberately the same NAME-STEM as
 * `MAY_NAME_LEADING_OPTION` (`constraint-feasibility.ts`) and
 * `INTAKE_MAY_NAME_LEADING_OPTION` (`intake-option-reconciliation.ts`),
 * because all three tables answer the same USER-FACING question — "may this run
 * put an option forward?" — from three different bodies of evidence.
 */
export const INTAKE_CONSTRAINT_MAY_NAME_LEADING_OPTION: Readonly<
  Record<IntakeConstraintState, boolean>
> = Object.freeze({
  not_applicable: true,
  limits_unrecorded: false,
});

/** One hard limit the brief spells out, as located and as it is written. */
export interface StatedLimit {
  /**
   * The brief's VERBATIM span covering the limit cue and its amount — e.g.
   * "£50,000 cap", "no more than £50,000". Never re-worded and never
   * synthesised: it is a contiguous `slice` of the submitted text, bounded by
   * the adjacency window, so a disclosure quoting it back is quoting the user.
   */
  readonly text: string;
  /** Absolute magnitude as written (50000 for "£50,000"). For telemetry. */
  readonly magnitude: number;
  /** Index of the span in the brief, for stable first-seen ordering. */
  readonly index: number;
}

/** The intake-constraint reconciliation for one analysis turn. */
export interface IntakeConstraintReconciliation {
  readonly state: IntakeConstraintState;
  /**
   * The state's declared leading-option answer, copied onto every result so
   * callers read it instead of re-deriving it from `state` (and disagreeing).
   * Always `INTAKE_CONSTRAINT_MAY_NAME_LEADING_OPTION[state]`.
   */
  readonly mayNameLeadingOption: boolean;
  /**
   * The stated limits with no record on the model, in the brief's own order.
   * Non-empty EXACTLY on `limits_unrecorded` — the disclosure names these, so
   * it can never say "a limit is missing" without saying which. `[]` on
   * `not_applicable`.
   */
  readonly unrecorded: readonly StatedLimit[];
}

function reconciliation(
  state: IntakeConstraintState,
  parts: { unrecorded?: readonly StatedLimit[] } = {},
): IntakeConstraintReconciliation {
  return {
    state,
    mayNameLeadingOption: INTAKE_CONSTRAINT_MAY_NAME_LEADING_OPTION[state],
    unrecorded: parts.unrecorded ?? [],
  };
}

/**
 * Cues that mark an amount as a NORMATIVE LIMIT rather than a described fact.
 *
 * ⚠ THE DIRECTION OF THE ERROR IS NOT SYMMETRIC, AND THAT IS THE WHOLE DESIGN.
 * A false NEGATIVE costs a withhold we should have made — the status quo, the
 * behaviour witnessed on 24 Aug. A false POSITIVE SUPPRESSES A TRUE RANKING on
 * a brief that stated no limit at all. So every cue below carries explicit
 * normative force, and the common descriptive quantifiers are DELIBERATELY
 * EXCLUDED: bare `under`, `over`, `above`, `below`, `up to`, `within`,
 * `less than` and `more than` all appear constantly in ordinary business prose
 * ("revenue grew over £2m", "we have under 50 staff") where no limit is being
 * set.
 *
 * ⚠ THE EXCLUSION COSTS LESS THAN IT LOOKS. The classic bare-`below` briefs
 * this estate has measured — "total three-year cost below £2,500", "without
 * dropping gross margin below 78%" — are cases where a `goal_constraints[]`
 * row WAS minted, so rule 2 stands this module down regardless of the cue list.
 * The cues only have to reach the case where NOTHING was recorded.
 *
 * ⚠ AND IT IS A HAND-WRITTEN LIST, i.e. exactly what CLAUDE.md trap 12 warns
 * about — which is why a cue that is ABSENT yields `not_applicable` (no
 * opinion) and never a withhold. The mirror can only ever be SHORT, and a short
 * mirror here fails toward today's behaviour. It is the same argument, and the
 * same safe direction, as `ENUMERATION_CUES` in the sibling option axis.
 */
const LIMIT_CUES_BEFORE_AMOUNT: readonly string[] = Object.freeze([
  'no more than',
  'no higher than',
  'no lower than',
  'no less than',
  'not exceed',
  'cannot exceed',
  'must not exceed',
  'may not exceed',
  'without exceeding',
  'cannot go above',
  'cannot go below',
  'cannot fall below',
  'must not fall below',
  'must not drop below',
  'must stay below',
  'must stay above',
  'must remain below',
  'must remain above',
  'without dropping below',
  'without going below',
  'at most',
  'at least',
  'at or above',
  'at or below',
  'capped at',
  'cap of',
  'a cap of',
  'budget of',
  'budget cap of',
  'maximum of',
  'max of',
  'minimum of',
  'min of',
  'limit of',
  'limited to',
  'hard limit of',
  'ceiling of',
  'floor of',
]);

/**
 * Cues that mark a limit when they FOLLOW the amount — "£50,000 cap",
 * "£50,000 at most". The witnessed brief is exactly this shape, which is why
 * both directions are read rather than only the more common prefix form.
 */
const LIMIT_CUES_AFTER_AMOUNT: readonly string[] = Object.freeze([
  'cap',
  'capped',
  'ceiling',
  'hard limit',
  'at most',
  'at the most',
  'at least',
  'maximum',
  'minimum',
  'or less',
  'or lower',
  'or under',
  'budget',
]);

/**
 * How far either side of the amount a cue may sit and still be about it.
 *
 * Small on purpose. A wide window lets a cue in one clause bind to an amount in
 * another ("we must not exceed our remit; last year we spent £2m"), which is
 * the false-positive direction — a suppressed true ranking.
 */
const CUE_WINDOW_CHARS = 32;

/**
 * How far AFTER the amount a trailing cue may sit. Tighter than the before
 * window because the trailing shapes are all adjacent ("£50,000 cap",
 * "78% or lower", "£50,000 at the most") while the leading ones are phrases
 * ("must not fall below "). It also bounds the verbatim span this module
 * quotes back, so a trailing cue cannot drag unrelated words into the quote.
 */
const CUE_ADJACENCY_AFTER_CHARS = 16;

/**
 * Clip a window so it cannot cross a sentence boundary — the BEFORE window
 * keeps only what follows the last terminator, the AFTER window only what
 * precedes the first. A cue in a neighbouring sentence must not bind to this
 * amount ("we must not exceed our remit; last year we spent £2m").
 *
 * ⚠ NO ABBREVIATION ALLOWLIST, DELIBERATELY. An "e.g." inside a window clips it
 * early and costs that one reading, which falls toward `not_applicable` —
 * today's behaviour. A list of abbreviations would be a hand-maintained mirror
 * (CLAUDE.md trap 12) bought to recover coverage in the direction that is
 * already safe to lose.
 *
 * ⚠ AND ON THE DECIMAL-POINT TRAP that shipped six live defects (CLAUDE.md
 * trap 22 — a window cut at the first `[.!?]` turned "£1.5 million" into "1"
 * before the guard ever looked): THIS amount's own decimal can never clip its
 * own windows, because both are measured strictly OUTSIDE the matched span.
 * A decimal belonging to a DIFFERENT amount inside the window can still clip it
 * early — and that is a coverage loss, never a false positive, because clipping
 * can only ever REMOVE a cue. The property is pinned by this module's spec on
 * "£1.5 million" in both cue positions.
 */
function clipToSentence(window: string, keep: 'tail' | 'head'): string {
  const terminators = /[.!?;\n\r]/g;
  if (keep === 'head') {
    const at = window.search(terminators);
    return at < 0 ? window : window.slice(0, at);
  }
  let lastAt = -1;
  for (let m = terminators.exec(window); m !== null; m = terminators.exec(window)) {
    lastAt = m.index;
  }
  return lastAt < 0 ? window : window.slice(lastAt + 1);
}

function containsCue(window: string, cues: readonly string[]): boolean {
  const lower = window.toLowerCase();
  return cues.some((cue) => lower.includes(cue));
}

/**
 * Extract the hard limits the brief SPELLS OUT, in the brief's own order.
 *
 * Exported for its own tests: the extractor and the reconciler fail in
 * different ways, and a corpus that can only see them composed cannot say which
 * one was wrong (the sibling option axis exports its extractor for the same
 * reason).
 *
 * ⚠ THE AMOUNT SCAN IS NOT RE-IMPLEMENTED HERE. `findStatedAmounts`
 * (`cee/provenance/stated-amounts.ts`, ROADMAP 2.972) is this service's
 * measured, adversarially-reviewed reader of "what magnitudes are present in
 * the text the user submitted", with its currency alternations DERIVED from the
 * shared symbol map. A second money regex in this file would be a mirror that
 * drifts, and it would be a fresh natural-language predicate with no corpus
 * behind it (CLAUDE.md trap 22). This module adds only the NORMATIVE half —
 * "is this magnitude being used to set a limit?" — which that module correctly
 * does not answer.
 */
export function extractStatedHardLimits(
  briefText: string | null | undefined,
): StatedLimit[] {
  if (typeof briefText !== 'string' || briefText.length === 0) return [];

  const out: StatedLimit[] = [];
  for (const amount of findStatedAmounts(briefText)) {
    const start = amount.index;
    const end = start + amount.matchedText.length;

    const rawBefore = briefText.slice(Math.max(0, start - CUE_WINDOW_CHARS), start);
    const before = clipToSentence(rawBefore, 'tail');
    // Offset of the clipped before-window within the brief, so a cue offset
    // inside it resolves to a real index in the submitted text.
    const beforeStart = start - before.length;
    const after = clipToSentence(briefText.slice(end, end + CUE_ADJACENCY_AFTER_CHARS), 'head');

    const cueBefore = containsCue(before, LIMIT_CUES_BEFORE_AMOUNT);
    const cueAfter = containsCue(after, LIMIT_CUES_AFTER_AMOUNT);
    if (!cueBefore && !cueAfter) continue;

    // The VERBATIM span covering the cue and its amount. Taken as a contiguous
    // slice of the submitted text and bounded by the clipped window, so it can
    // never pull in a clause the user did not write beside the number, and can
    // never cross a sentence boundary.
    //
    // ⚠ A LEADING CUE WINS AND THE SPAN STOPS AT THE AMOUNT. When both windows
    // carry a cue the trailing one usually belongs to the NEXT clause — "Our
    // budget of £120,000 is fixed and headcount is capped at 12" would
    // otherwise quote "budget of £120,000 is fixed and headcount is cap" back
    // at the user. The leading cue already establishes the limit, so extending
    // past the amount buys nothing and risks quoting words about something else.
    const spanStart = cueBefore ? beforeStart + firstCueOffset(before, LIMIT_CUES_BEFORE_AMOUNT) : start;
    const spanEnd =
      cueAfter && !cueBefore ? end + lastCueEnd(after, LIMIT_CUES_AFTER_AMOUNT) : end;
    const text = briefText.slice(spanStart, spanEnd).trim();
    if (text.length === 0) continue;

    out.push({ text, magnitude: amount.magnitude, index: spanStart });
  }
  return out;
}

/** Offset of the EARLIEST matching cue in a before-window. */
function firstCueOffset(window: string, cues: readonly string[]): number {
  const lower = window.toLowerCase();
  let earliest = window.length;
  for (const cue of cues) {
    const at = lower.indexOf(cue);
    if (at >= 0 && at < earliest) earliest = at;
  }
  return earliest;
}

/** End offset of the EARLIEST matching cue in an after-window. */
function lastCueEnd(window: string, cues: readonly string[]): number {
  const lower = window.toLowerCase();
  let best = 0;
  let earliest = Number.POSITIVE_INFINITY;
  for (const cue of cues) {
    const at = lower.indexOf(cue);
    if (at >= 0 && at < earliest) {
      earliest = at;
      best = at + cue.length;
    }
  }
  return best;
}

/**
 * ⭐ THE reconciliation — the single owner of "did we record the limit the user
 * stated?".
 *
 * PRECEDENCE, and every rule fails toward `not_applicable` (no opinion, today's
 * behaviour) rather than toward a withhold:
 *
 *   1. No brief, or no explicit stated hard limit ⇒ `not_applicable`. There is
 *      nothing to reconcile.
 *   2. ⭐ THE MODEL RECORDS AT LEAST ONE RATIFIED CONSTRAINT ⇒ `not_applicable`.
 *      This is the load-bearing precision guard and it is deliberately blunt.
 *      Once ANY constraint exists, deciding whether THIS stated limit is the
 *      one a given row represents is a vocabulary-and-magnitude question this
 *      module cannot answer soundly: the row's `value` carries a frame the
 *      contract itself declares UNATTESTED, so a magnitude comparison would be
 *      a certificate resting on an unattested number. It is also the direction
 *      of the sibling axis's own rule 3 — "zero overlap is a statement about
 *      this module's reading of the brief, not about the graph".
 *
 *      ⚠ THE DISCLOSED RESIDUAL: a brief stating THREE limits where the drafter
 *      recorded ONE row gets no opinion from this module. That is a real
 *      coverage loss and it is stated rather than left to be found. Closing it
 *      needs attested magnitude reconciliation, which is separate work.
 *   3. A stated hard limit and ZERO recorded constraints ⇒ `limits_unrecorded`.
 *      This is the only case where "we did not represent it" is DIRECTLY
 *      OBSERVABLE rather than inferred: with no rows at all there is no
 *      vocabulary to have failed to line up with, and nothing was sent to the
 *      engine to enforce.
 *
 * ⚠ IT ASSERTS NOTHING ABOUT COMPLIANCE IN EITHER DIRECTION, and it reads no
 * option value to reach any answer.
 *
 * PURE.
 */
export function deriveIntakeConstraintReconciliation(
  briefText: string | null | undefined,
  ratified: readonly RatifiedConstraint[],
): IntakeConstraintReconciliation {
  const stated = extractStatedHardLimits(briefText);
  if (stated.length === 0) return reconciliation('not_applicable');
  // Rule 2 — the precision guard. Any recorded constraint stands this axis down.
  if (ratified.length > 0) return reconciliation('not_applicable');
  return reconciliation('limits_unrecorded', { unrecorded: stated });
}

/**
 * ⭐ THE GATE — fold the intake-constraint answer into the persisted leader
 * permission.
 *
 * `mayNameLeadingOption` is the estate's RATIFIED seam for a withheld-leader
 * turn, and this is one more input to it rather than a second gate beside it —
 * the same fold, and for the same reason, as `applyIntakeToLeaderPermission`.
 * It is a CONJUNCTION on purpose: either authority may withhold, neither may
 * grant. This axis can only ever TAKE the permission away (`not_applicable`
 * declares `true`, so it is transparent), which is what makes it safe to apply
 * unconditionally — a brief this module cannot read leaves the persisted
 * verdict byte-identical.
 *
 * ⚠ THE STATE FIELD IS NOT TOUCHED, AND THAT IS THE POINT.
 * `constraint_verdict_state` is a statement about the CONSTRAINT evidence; this
 * function has nothing true to say about that evidence and must not overwrite
 * it (CLAUDE.md trap 21 — a fix that "aligns" two authorities answering
 * different questions is how the leader-claim seam was re-opened one day after
 * it was closed). The consequence is the one the option axis already records
 * and accepts: the pair can read `{may_name_leading_option: false,
 * constraint_verdict_state: 'not_applicable'}`. Nothing downstream re-derives
 * the boolean from the state (the contract deliberately does not cross-validate
 * them, and `readMayNameLeadingOptionFromResult` reads the boolean), so no
 * surface un-withholds. The one consumer that reads the state alone,
 * `withheldLeaderInputNoteForState`, degrades to the TRUE cause-free note —
 * never a false cause. The user still gets the cause on the analysis turn
 * itself, from the disclosure this module feeds.
 *
 * Called at the SAME single site as `projectClaimSafety` — the one stamp in
 * `run_analysis` — so there is exactly one place where the axes meet.
 *
 * Pure.
 */
export function applyIntakeConstraintToLeaderPermission(
  persisted: PersistedClaimSafety,
  intake: IntakeConstraintReconciliation,
): PersistedClaimSafety {
  if (intake.mayNameLeadingOption) return persisted;
  return {
    may_name_leading_option: false,
    constraint_verdict_state: persisted.constraint_verdict_state,
  };
}
