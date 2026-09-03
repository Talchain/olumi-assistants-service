/**
 * V5 Group 1 Task C: deterministic coaching signal detectors for Step 5.
 *
 * Fires at most one signal per action turn. Non-action intents skip Step 5
 * entirely (spec §4); the turn-executor wires only the execute branch.
 *
 * Signals:
 *   - STALE_ANALYSIS_AFTER_EDIT (priority 1)
 *   - HIGH_SENSITIVITY_EDIT     (priority 2)
 *   - FIRST_ANALYSIS_COMPLETE   (priority 3)
 *   - RERUN_ANALYSIS_COMPLETE   (run_analysis branch, ROADMAP 2.73 — fires
 *     when a prior run_analysis result was SHOWN TO THE USER, i.e. exactly when
 *     FIRST_ANALYSIS_COMPLETE does not; text derives from the shared
 *     `compareRuns` comparator so the rerun acknowledgment names the delta
 *     or the no-change verdict. ⚠ "shown to the user" is NOT "a fact exists" —
 *     see `hasPriorRunAnalysisShownToUser`.)
 *
 * Edit-handler signals (STALE_*, HIGH_*) are LIVE. The header previously
 * described them as "dormant until set_factor_value / adjust_edge_strength
 * / add_constraint register in the V5 handler registry" — those handlers
 * have since registered, and the detectors have been firing against their
 * facts on real turns ever since, so the note was stale and understated
 * the blast radius of a change here. `turn-executor.ts` calls this on
 * every successful action turn and composes `coaching_text` into the
 * user-visible `assistant_text`; see
 * `__tests__/turn-executor-noop-edit-claim-integrity.integration.test.ts`
 * for the wired proof.
 *
 * F.6: deterministic only. No LLM calls in Step 5. Field lookups plus the
 * pure `compareRuns` diff (integer percentage-point arithmetic) for the
 * rerun acknowledgment.
 */

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import {
  compareRuns,
  projectRunFact,
  type ContentSafeRunDelta,
} from '../coaching/compare-runs.js';
import type { ContextPack } from '../context/context-pack-assembler.js';
import type { CoachingSignalId } from '../coaching/types.js';
import {
  deriveInterveningChange,
  type InterveningChange,
} from '../coaching/intervening-change.js';
import type { RecentChangeAction } from '../context/recent-changes.js';
import { selectRunAnalysisFact } from '../context/freshness.js';
import { hasUserSeenRunAnalysisResult } from '../context/run-initiator.js';
import { deriveEditComparisonReach } from '../coaching/edit-comparison-reach.js';
import {
  licenceToReportMovementDirection,
  type MovementDirectionLicence,
} from '../coaching/movement-direction-licence.js';
import { formatPercentagePoints } from '../format/format-analysis-value.js';
import { isNoopFact } from '../tools/fact-noop.js';
import type { SuccessfulHandlerOutcome } from '../tools/handler-outcome.js';
import { isAnalysisRefusalFact } from '../context/analysis-refusal-continuity.js';

export type { CoachingSignalId };

export interface CoachingSignalInput {
  /** The handler that just succeeded on this turn. */
  readonly proposedHandlerId: string;
  /** Outcome of the successful handler (its facts are consulted by the
   *  sensitivity detector to find the edit's target_id). */
  readonly outcome: SuccessfulHandlerOutcome;
  /**
   * LLM-facing context pack assembled for this turn. `null` on the
   * chip-click dispatch path (which assembles no pack). Only the
   * edit-handler HIGH_SENSITIVITY branch reads it; the run_analysis
   * branch signals never consult the pack, so a null pack degrades
   * only the edit-target driver-label lookup (to null).
   */
  readonly contextPack: ContextPack | null;
  /**
   * Spine A backstop: factor_ids an option intervenes on. Threaded into
   * `compareRuns` so an option-controlled lever is never reported as
   * having gained/lost influence between runs. Omitted / empty ⇒ no
   * suppression (same contract as `run-comparison-gate.ts`).
   */
  readonly interventionControlledFactorIds?: ReadonlySet<string>;
  /**
   * Facts from prior turns in this scenario. Used to distinguish "first
   * successful run_analysis" from subsequent ones. A refused attempt now
   * emits a continuity fact, but it never counts as a displayed analysis.
   */
  readonly priorFacts: readonly HandlerFact[];
  /**
   * ⭐ ROADMAP 2.804 — MAY THIS TURN NAME A LEADING OPTION ON SCREEN?
   *
   * The TURN-LEVEL, DISPLAY-BOUND permission, derived by
   * `readMayNameLeadingOptionVerdict` in `applyCoachingSignal` (the shared
   * helper both dispatch paths use). It is a conjunction — the entitling
   * fact's verdict AND the DISPLAYED analysis's verdict — and it fails closed.
   *
   * ⚠ THIS IS NOT "did this run's constraint verdict withhold?". That was the
   * old `HandlerOutcome.__leading_option_claim_withheld` channel, now deleted:
   * a per-run answer that structurally could not carry the displayed-analysis
   * conjunct, because it never saw the fact array. Consuming it here meant the
   * confirmation could withhold the leader while the coaching sentence
   * directly beneath it named one. Do not reintroduce a per-run signal on this
   * input — the question this slot must ask is about the TURN.
   *
   * REQUIRED, not optional-defaulting-true: an absent permission must not read
   * as a granted one.
   */
  readonly mayNameLeadingOption: boolean;
}

export interface CoachingSignalDetection {
  readonly signal_id: CoachingSignalId;
  readonly coaching_text: string;
}

const EDIT_HANDLER_IDS = new Set([
  'set_factor_value',
  'adjust_edge_strength',
  'add_constraint',
]);

// Coaching-text bank. British English, sentence case, no em-dashes.
// Typed Record over the derived CoachingSignalId union (coaching/types.ts):
// adding an id to COACHING_SIGNAL_IDS without a bank entry fails to compile.
/**
 * ⚠ EXPORTED 2026-07-31 (ROADMAP 2.149) SO A CANARY CAN USE THE PRODUCTION COPY.
 *
 * `FIRST_ANALYSIS_COMPLETE` is the sentence #755's first cut destroyed — it says
 * "explore the leading option", which trips the shared leader vocabulary and
 * DESIGNATES NOTHING. The wire gate has the same exposure at a new address, and
 * its canary must assert against THIS constant rather than a paraphrase: a
 * paraphrase proves the gate spares a sentence the test author wrote, which is
 * the one sentence that never changes. Reword the copy and the canary follows it
 * in the same commit (CLAUDE.md trap #12).
 */
export const COACHING_TEXT: Record<CoachingSignalId, (ctx: {
  readonly factorLabel?: string;
  readonly runDelta?: ContentSafeRunDelta | null;
  /**
   * PR2 L2 — the authored change that landed between the two runs, or null.
   * Absent/null reproduces the pre-attribution copy BYTE-IDENTICALLY on every
   * branch, which is pinned by test.
   */
  readonly interveningChange?: InterveningChange | null;
  /**
   * ⭐ MAY A DIRECTION BE REPORTED FOR THE MOVEMENT? See
   * `coaching/movement-direction-licence.ts` for why this is a THIRD question
   * and not a restatement of `runDelta.margin_direction`.
   *
   * ⚠ ABSENT MUST NOT READ AS PERMITTED. An omitted licence degrades to
   * `unbounded`, i.e. no direction — the same fail-closed direction
   * `mayNameLeadingOption` takes, and for the same reason: a caller that
   * forgets to supply the evidence must not thereby acquire the claim.
   */
  readonly movementLicence?: MovementDirectionLicence | null;
  /**
   * ⭐ THE INTERVENING EDIT COULD NOT MOVE THIS COMPARISON — every option
   * supplies its own value for the factor the user changed.
   *
   * Its own flag rather than a member of {@link InterveningChange} because it
   * answers a different question: `InterveningChange` answers "what did the
   * user change?", this answers "could that change have moved anything?".
   */
  readonly interveningChangeIsInert?: boolean;
}) => string> = {
  STALE_ANALYSIS_AFTER_EDIT: () =>
    'This change affects the model. The current analysis may not reflect it. Run the analysis to see updated results.',
  HIGH_SENSITIVITY_EDIT: ({ factorLabel }) =>
    `You're editing ${factorLabel ?? 'a factor'}, which was one of the strongest drivers in the last analysis. Rerunning will show how this changes the picture.`,
  FIRST_ANALYSIS_COMPLETE: () =>
    'Your first analysis is ready. Take a moment to explore the leading option and the factors shaping it before acting on the result.',
  RERUN_ANALYSIS_COMPLETE: ({ runDelta, interveningChange, movementLicence, interveningChangeIsInert }) =>
    composeRerunText(
      runDelta ?? null,
      interveningChange ?? null,
      movementLicence ?? { kind: 'unbounded', reason: 'no_identity_bound_pair' },
      interveningChangeIsInert === true,
    ),
};

/**
 * PR2 L2 — how each kind of authored change is NAMED in the attribution
 * clause. Exhaustive `Record` over `RecentChangeAction`, so a new mutation
 * action added to the projection fails to COMPILE here rather than silently
 * losing its verb (the same construction as {@link COACHING_TEXT}).
 *
 * British English, sentence case, no em-dashes (this file's copy contract).
 * Each verb must be true of every fact the action covers: `constraint_added`
 * spans a fresh add AND an in-place update, so "set a limit on" is used rather
 * than "added a limit to", which would be false on an update.
 */
const INTERVENING_CHANGE_PHRASE: Record<RecentChangeAction, (label: string) => string> = {
  constraint_added: (label) => `set a limit on ${label}`,
  factor_value_updated: (label) => `changed ${label}`,
  link_strength_updated: (label) => `adjusted ${label}`,
  graph_edited: (label) => `changed ${label}`,
};

/**
 * The attribution opener, or the empty string when nothing may be attributed.
 *
 * ⭐ TEMPORAL ONLY. "Since" states sequence; "because" / "caused" / "is why"
 * would state causation, which is unlicensed without a pinned seed (see
 * `coaching/intervening-change.ts`). A test asserts the composed output over
 * every branch carries no causal connective.
 */
function attributionPrefix(change: InterveningChange | null): string {
  if (change === null) return '';
  if (change.kind === 'several') return 'Since your recent changes, ';
  return `Since you ${INTERVENING_CHANGE_PHRASE[change.action](change.target_label)}, `;
}

/**
 * ROADMAP 2.73 — rerun acknowledgment copy, derived from the shared
 * `compareRuns` delta (reuse, not a parallel diff). Register mirrors the
 * run-comparison gate's `composeComparison` so the two rerun surfaces
 * cannot drift in vocabulary. Content-safe: labels + integer percentage
 * points only, no raw decimals, no IDs.
 */
/**
 * ⭐⭐ THE EDIT THE USER MADE COULD NOT MOVE THIS COMPARISON, AND SAYING SO IS
 * THE WHOLE COACHING VALUE OF THE TURN.
 *
 * MEASURED, 2026-09-03. Every option in the captured decision set its own
 * value for the edited factor, the analysis scored it
 * `zero_reason: "intervention_override"`, and the product still opened with
 * *"Since you changed a factor, ... its lead has widened by about 1 percentage
 * point."* The temporal clause is honest in isolation, but placing the change
 * immediately before a movement is how a reader infers a cause — and the very
 * next turn proved it, elaborating the juxtaposition into *"because the higher
 * investment value increases the modelled Runway Depletion Risk more
 * strongly"*.
 *
 * So on an inert edit the attribution clause is SUPPRESSED (see `since` below)
 * and this tail replaces it. Suppression alone would be worse than useless:
 * the user would be left with an accepted edit, a moved number and no way to
 * learn the two are unrelated.
 *
 * ⚠ IT NAMES THE MECHANISM, NOT A FAULT. The user's value is now correct and
 * their edit was reasonable; what they need is the model fact they could not
 * see, plus the action that WOULD move the comparison.
 */
export const INERT_EDIT_TAIL =
  ' The value you changed is one every option sets for itself, so it is a'
  + ' baseline they all replace and it could not move this comparison. To change'
  + ' the comparison, set the value each option uses.';

/**
 * ⭐ THE TAIL IS APPLIED HERE, ONCE, RATHER THAN AT EVERY `return` BELOW.
 * `composeRerunBody` has seven exits; appending at each of them is seven
 * places for the next exit to be forgotten (CLAUDE.md trap #12), and it is
 * exactly how the abstention arms below acquired their divergent shapes.
 *
 * The abstention exits ARE deliberately excluded: they are reached before the
 * body has established any comparison, and a tail that says "it could not move
 * this comparison" after "I have not compared the two" would assert a
 * comparison in the act of denying one. The body therefore returns those two
 * exits through {@link RERUN_ABSTENTION_EXITS} and this wrapper leaves them
 * alone.
 */
function composeRerunText(
  delta: ContentSafeRunDelta | null,
  interveningChange: InterveningChange | null = null,
  movementLicence: MovementDirectionLicence = {
    kind: 'unbounded',
    reason: 'no_identity_bound_pair',
  },
  interveningChangeIsInert = false,
): string {
  const body = composeRerunBody(
    delta,
    interveningChange,
    movementLicence,
    interveningChangeIsInert,
  );
  if (!interveningChangeIsInert) return body.text;
  if (RERUN_ABSTENTION_EXITS.has(body.kind)) return body.text;
  return `${body.text}${INERT_EDIT_TAIL}`;
}

/**
 * Which body exits are ABSTENTIONS — exits that made no comparison at all.
 * Named as a set rather than tested inline so the exclusion is enumerable and
 * a new abstention exit is a compile-time decision, not an oversight.
 */
const RERUN_ABSTENTION_EXITS: ReadonlySet<RerunBodyKind> = new Set<RerunBodyKind>([
  'uncomparable',
  'leader_identity_unmatched',
]);

type RerunBodyKind =
  | 'uncomparable'
  | 'leader_identity_unmatched'
  | 'leader_changed'
  | 'margin_moved'
  | 'margin_unavailable'
  | 'unchanged';

interface RerunBody {
  readonly kind: RerunBodyKind;
  readonly text: string;
}

function composeRerunBody(
  delta: ContentSafeRunDelta | null,
  interveningChange: InterveningChange | null,
  movementLicence: MovementDirectionLicence,
  interveningChangeIsInert: boolean,
): RerunBody {
  if (delta === null || !delta.comparable) {
    // Prior run exists but the two runs cannot be lined up (legacy fact
    // without a projectable envelope, or missing labels). Acknowledge the
    // rerun without claiming a comparison we could not make.
    return {
      kind: 'uncomparable',
      text: 'This was a re-run. It replaces the earlier result as the current analysis.',
    };
  }
  // ⭐ THE SAME AMENDMENT AS `composeComparison`, and it belongs here for the
  // same reason: every arm below asserts CONTINUITY between the two runs —
  // "still leads", "The result is unchanged", "its lead has widened" — and
  // `leading_option_changed === false` does not mean the leader is the same
  // option. It also carries the "we could not tell" case, which `compareRuns`
  // folds into `false` deliberately. Branching on the bare boolean would turn
  // an honest abstention into a confident "nothing changed" on precisely the
  // legacy runs where it can be false. Say this run's leader, state the limit,
  // and make no claim relating the two (margin included: the lead being
  // compared may belong to a different option).
  if (delta.leader_identity_basis !== 'option_id') {
    // ⭐ ATTRIBUTION IS SUPPRESSED HERE, AND THIS IS THE SHARPEST CASE IN THE
    // FILE. This branch's whole point is that NO comparison was made. Opening
    // it with "Since you changed X ..." would place an authored change
    // immediately before a statement of what followed, which is precisely how
    // a reader infers a comparison — the implication the sentence then
    // explicitly disclaims. Naming the edit beside an unmade comparison is
    // worse than naming nothing, so the attribution never reaches this arm.
    return {
      kind: 'leader_identity_unmatched',
      text:
        `${delta.current_leading_label} leads after this re-run. I cannot line up `
        + 'the earlier result with this one, so I have not compared the two.',
    };
  }

  // Past every abstention. A real comparison exists, so a temporal clause about
  // what preceded it is licensed. Empty string when there is nothing to
  // attribute, which reproduces the pre-attribution copy byte-identically.
  // ⭐⭐ AN INERT EDIT ATTRIBUTES NOTHING, ON EVERY ARM BELOW — including the
  // leader-changed one. "Since you changed X, the result has changed" is the
  // strongest causal reading in the file, and it is exactly the sentence a
  // factor every option overrides cannot support. Suppressing at the SOURCE of
  // the clause rather than per-arm means a future arm inherits the suppression
  // instead of having to remember it. The explanation the user needs instead
  // rides as {@link INERT_EDIT_TAIL}, applied by the wrapper.
  const since = interveningChangeIsInert ? '' : attributionPrefix(interveningChange);
  const attributed = since.length > 0;
  // The anaphor must AGREE WITH ITS OWN OPENER. `several` deliberately names no
  // antecedent, so a singular "that change" after it is a dangling referent AND
  // makes a claim about one unidentified change when several occurred — the
  // mirror of the sole-cause-by-omission that `deriveInterveningChange` refuses.
  const theChange = interveningChange?.kind === 'several' ? 'those changes' : 'that change';

  if (delta.leading_option_changed) {
    return {
      kind: 'leader_changed',
      text: attributed
        ? (
          `${since}the result has changed: ${delta.prior_leading_label} led before, `
          + `and ${delta.current_leading_label} now leads. Ask what changed if you want the detail.`
        )
        : (
          `This re-run changed the outcome: ${delta.prior_leading_label} led before, `
          + `and ${delta.current_leading_label} now leads. Ask what changed if you want the detail.`
        ),
    };
  }
  // ⭐⭐ THE DIRECTION IS GATED, AND THIS IS THE P0 OF 2026-09-03.
  //
  // `margin_direction` is a ROUNDING verdict: `deriveMargin` calls a movement
  // 'widened' as soon as it exceeds `MARGIN_EPSILON_PP` (0.5), which is a
  // threshold on the DISPLAYED integer and knows nothing about how many
  // samples produced it. On the live capture the leading option moved
  // 62% -> 62.6% at n = 10,000; the 2-SE band on that pair is 1.37pp, so the
  // movement was INSIDE the noise. The product said *"its lead has widened by
  // about 1 percentage point"*, and the next model-authored turn elaborated
  // that sentence into an invented causal mechanism. Two turns later the
  // product contradicted itself: *"Every option's win figure moved by less
  // than what repeated runs vary by anyway."*
  //
  // So the quantified claim requires evidence that the quantity moved, and the
  // licence is REQUIRED rather than optional-defaulting-permitted.
  if (delta.margin_direction === 'widened' || delta.margin_direction === 'narrowed') {
    if (movementLicence.kind === 'licensed') {
      // Byte-identical to the pre-gate copy on the arm that keeps its claim.
      return {
        kind: 'margin_moved',
        text: delta.margin_direction === 'widened'
          ? (
            `${since}${delta.current_leading_label} still leads after this re-run, and its lead `
            + `has widened by about ${formatPercentagePoints(Math.abs(delta.margin_shift_pp))}.`
          )
          : (
            `${since}${delta.current_leading_label} still leads after this re-run, though its lead `
            + `has narrowed by about ${formatPercentagePoints(Math.abs(delta.margin_shift_pp))}.`
          ),
      };
    }
    if (movementLicence.kind === 'within_noise') {
      // WE MEASURED THE BAND AND THE MOVEMENT SAT INSIDE IT. That is a finding
      // and it is said as one: the user asked what their change did, and "less
      // than this model varies between runs" is the answer.
      return {
        kind: 'margin_moved',
        text:
          `${since}${delta.current_leading_label} still leads after this re-run. `
          + 'The figures moved by less than this model varies between runs, so I '
          + 'would not read a direction into that movement.',
      };
    }
    // NO BAND COULD BE COMPUTED. Distinct from the arm above and deliberately
    // so: claiming "less than the model varies" here would assert a bound we
    // did not compute (CLAUDE.md trap 13 — an absence claim needs an
    // instrument that could have seen a presence).
    return {
      kind: 'margin_moved',
      text:
        `${since}${delta.current_leading_label} still leads after this re-run. `
        + 'I cannot tell whether the movement in the figures is real or just '
        + 'sampling variation, so treat the size of its lead as unchanged.',
    };
  }
  // ⭐⭐ THE MARGIN COULD NOT BE COMPUTED — ITS OWN ARM, BECAUSE IT IS NOT A
  // NULL RESULT. `deriveMargin` returns 'unavailable' when either run's
  // `margin_pp` is null (fewer than two recommendable options), and until round
  // 2 this fell THROUGH to the unchanged arm below — so the product reported a
  // no-movement finding about a pair whose margin was never compared. The
  // leader IDENTITY is comparable here (that comparison does not use margins),
  // so the honest form states exactly that and names the limit, in the shape
  // the abstention arm already uses: say what was observed, then say what was
  // not. `since` is empty when nothing is attributable, so the unattributed
  // form is the same sentence without the clause.
  if (delta.margin_direction === 'unavailable') {
    return {
      kind: 'margin_unavailable',
      text:
        `${since}${delta.current_leading_label} still leads after this re-run. `
        + 'I could not compare the size of its lead between the two runs.',
    };
  }

  // ⭐ THE UNCHANGED ARM IS THE SCIENTIFIC ONE AND MUST READ AS A FINDING, NOT
  // AN APOLOGY: a product that can only report a result when the answer changes
  // cannot report a null result at all.
  //
  // ⚠⚠ BUT THE FINDING IS AN OBSERVATION, NOT A ROBUSTNESS CLAIM. Round 1 said
  // "the conclusion does not hinge on that change", which asserts causal
  // INDEPENDENCE — and the temporal-not-causal ruling is SYMMETRIC. Asserting
  // the ABSENCE of a causal link needs the same evidence class as asserting its
  // presence, and C2_unpaired licenses neither: with the seed unpinned, "no
  // observed movement" cannot be separated from "a real effect cancelled by
  // sampling noise". A change with a true -18pp effect masked to -0.4pp by an
  // unlucky pair of draws lands HERE (`MARGIN_EPSILON_PP = 0.5`,
  // compare-runs.ts:266) and would have been reported as non-dependence. The
  // design's own §2.2 conceded the point in passing — "evidence the conclusion
  // is robust to it" — and the shipped copy asserted the conclusion of that
  // inference, unhedged. "Held both before and after" states only what was
  // observed at the two time points, which is exactly what the pair licenses.
  //
  // ⚠ "the conclusion", NOT "the recommendation" — `recommendation` is in
  // FORBIDDEN_USER_FACING_PHRASES (the founder ruling that the product does not
  // recommend), so `applyTerminologyRewrite` silently rewrote the design's
  // wording to "the leading option", MANUFACTURING the banned leader vocabulary
  // inside our own safety pass. All composed arms are pinned against the real
  // guard by test.
  return {
    kind: 'unchanged',
    text: attributed
      ? (
        `${since}the picture has stayed the same: ${delta.current_leading_label} `
        + `still leads. That is a result in itself: the conclusion held both before `
        + `and after ${theChange}.`
      )
      : `The result is unchanged: ${delta.current_leading_label} still leads.`,
  };
}

/**
 * Pick one coaching signal for this turn or return null. Priority:
 * STALE > HIGH_SENSITIVITY > FIRST_ANALYSIS. At most one signal fires.
 */
export function detectCoachingSignal(
  input: CoachingSignalInput,
): CoachingSignalDetection | null {
  // Edit-handler branch.
  if (EDIT_HANDLER_IDS.has(input.proposedHandlerId)) {
    // Gate-1 claim integrity: a no-op edit changed nothing, so it cannot
    // have staled an analysis and there is nothing to re-run for. Both
    // signals on this branch presuppose an actual edit —
    // STALE_ANALYSIS_AFTER_EDIT asserts "This change affects the model.
    // The current analysis may not reflect it", and HIGH_SENSITIVITY_EDIT
    // asserts "You're editing X ... Rerunning will show how this changes
    // the picture" — so the gate sits on the branch rather than on one
    // signal. The fact channel already carries the verdict; this reads it
    // through the same `isNoopFact` predicate `context/recent-changes.ts`
    // uses to keep no-ops out of the recent-changes projection.
    if (isNoopEditOutcome(input.outcome)) return null;

    // The question THIS branch asks: "was an analysis on screen that this edit
    // could have made stale?" — existence, not recency and not success. See the
    // helper's own note for why it is kept separate from the run_analysis
    // branch's predicate even though the two agree today.
    if (hasPriorRunAnalysisFactToStale(input.priorFacts)) {
      // ⭐⭐ AN EDIT THE COMPARISON CANNOT FEEL DID NOT STALE IT — THIRD NOOP
      // GATE ON THIS BRANCH, AND THE THIRD IS NOT THE FIRST TWO.
      //
      // `STALE_ANALYSIS_AFTER_EDIT` asserts *"This change affects the model.
      // The current analysis may not reflect it. Run the analysis to see
      // updated results."* On a factor every option overrides, every clause of
      // that is false: the change does not affect the comparison, the current
      // analysis reflects it exactly, and the re-run cannot show anything new.
      // Measured on the 2026-09-03 capture, where the user duly re-ran and the
      // product then narrated sampling noise as an effect of the edit.
      //
      // ⚠ SUPPRESSED, NOT REWORDED — and the reason is this file's own rule
      // for the withheld arm. `set_factor_value` has ALREADY replaced its
      // staleness narrative with the honest explanation
      // (`BASELINE_REPLACED_BY_OPTIONS_NARRATIVE`, composed into the same
      // `assistant_text` immediately above this slot), so a second sentence
      // here would put a competing call-to-action on one screen.
      //
      // ⚠ ONE DERIVATION, TWO CALL SITES, DIFFERENT EVIDENCE AVAILABLE. The
      // handler calls `deriveEditComparisonReach` WITH the graph; this path has
      // none, so it passes `graph: null` and rides the producer witness alone.
      // The type makes that difference explicit rather than leaving two
      // predicates to drift (CLAUDE.md trap #12).
      if (!editTargetsInertFactor(input.outcome, input.priorFacts)) {
        // STALE wins over HIGH_SENSITIVITY per the authoritative priority order.
        return {
          signal_id: 'STALE_ANALYSIS_AFTER_EDIT',
          coaching_text: COACHING_TEXT.STALE_ANALYSIS_AFTER_EDIT({}),
        };
      }
      // Fall through. HIGH_SENSITIVITY_EDIT cannot fire on an inert factor
      // either — it names the factor as "one of the strongest drivers", and a
      // factor the analysis scored at zero is never a top driver — so the
      // honest coaching on this turn is none, and the handler's own receipt
      // carries the explanation.
      return null;
    }
    const targetLabel = findEditTargetTopDriverLabel(input.outcome, input.contextPack);
    if (targetLabel !== null) {
      return {
        signal_id: 'HIGH_SENSITIVITY_EDIT',
        coaching_text: COACHING_TEXT.HIGH_SENSITIVITY_EDIT({ factorLabel: targetLabel }),
      };
    }
    return null;
  }

  // run_analysis branch.
  if (input.proposedHandlerId === 'run_analysis') {
    // T1 claim safety. When the constraint verdict forbids naming a leading
    // option, BOTH texts below become false statements: the first-run copy
    // tells the user to "explore the leading option", and the rerun copy names
    // the option outright ("{label} still leads"). The confirmation directly
    // above them has just said no option can be put forward.
    //
    // This is not caught by the egress allowlist — that governs only the
    // confirmation segment of `assistant_text`; this piece is a separate
    // compose slot. So the claim-safety machinery built for the headline is
    // bypassed by the sentence underneath it unless the signal itself is aware.
    //
    // ⭐ ROADMAP 2.804 — THE PERMISSION IS THE TURN'S, NOT THE RUN'S. This read
    // used to be `leadingOptionClaimWithheld(input.outcome)`, an internal
    // channel carrying THIS RUN's constraint verdict. That answered a narrower
    // question than the slot asks, and could not see the displayed-analysis
    // conjunct the turn verdict acquired in #737 — so on the divergence path
    // the headline withheld the leader and this sentence named it. Nothing here
    // re-derives the permission: it arrives already computed by the shared
    // `applyCoachingSignal` helper, from ONE derivation (CLAUDE.md trap #12).
    const leaderWithheld = !input.mayNameLeadingOption;

    // ⭐⭐ THE QUESTION THIS BRANCH ASKS IS ABOUT THE USER, NOT ABOUT THE SERVER:
    // "has a result ever been PUT IN FRONT OF THIS USER before this turn?"
    //
    // ⚠ IT USED TO ASK `hasAnyPriorRunAnalysisFact` — "does ANY run_analysis
    // fact exist?" — and since R2 those are different questions, because
    // `scheduleAutoRunAfterFreshDraft` commits a server-initiated provisional
    // run after every admissible fresh draft. Every arm of this branch's rerun
    // copy presupposes the user saw something: "The result is unchanged",
    // "still leads after this re-run", "It replaces the earlier result". On a
    // user's genuinely FIRST analysis, an auto-run fact made all of those fire
    // — witnessed on staging 2026-08-19, "The result is unchanged: build
    // self-hosting this year still leads" on a first-ever run.
    //
    // The edit branch's `hasPriorRunAnalysisFactToStale` is deliberately NOT
    // changed with it: "could this edit have staled an analysis?" is a question
    // about the persisted analysis, which the auto-run really did produce. The
    // two predicates therefore DISAGREE on an auto-run-only scenario, and that
    // disagreement is pinned by test (CLAUDE.md trap #21 — name the concepts
    // apart, never collapse or co-tighten them).
    if (!hasPriorRunAnalysisShownToUser(input.priorFacts)) {
      // SUPPRESSED, not reworded. The whole of this signal's value is the
      // "explore the leading option" nudge, and on a withheld turn there is no
      // leading option to explore. A replacement sentence would either repeat
      // the confirmation's repair step or put a second, competing
      // call-to-action on the same screen — and across the three withholding
      // states, which have three different causes, any single re-diagnosis
      // would be wrong for two of them. The confirmation already names the
      // condition and says what to do; the honest coaching here is none.
      //
      // Telemetry does not go dark: the verdict's own events
      // (v5.run_analysis.constraint_unevaluated /
      // .constraint_identity_unresolved) already count these turns.
      if (leaderWithheld) return null;
      return {
        signal_id: 'FIRST_ANALYSIS_COMPLETE',
        coaching_text: COACHING_TEXT.FIRST_ANALYSIS_COMPLETE({}),
      };
    }
    // ROADMAP 2.73: a prior run_analysis fact exists, so this turn is a
    // re-run. Previously this branch returned null and the rerun turn
    // shipped zero coaching prose by construction. Emit a deterministic
    // rerun acknowledgment whose text derives from the shared compareRuns
    // comparator (prior fact vs this turn's fact); when either run cannot
    // be projected the copy degrades to a comparison-free acknowledgment.
    //
    // On a withheld turn the comparison is not merely unsayable, it is
    // unmakeable: every branch of `composeRerunText` that says anything
    // NAMES an option. So the withheld turn reuses that same comparison-free
    // degrade — the run is still acknowledged, no leader is asserted, and the
    // signal id is unchanged so the telemetry series does not go dark.
    //
    // ⭐ ATTRIBUTION CANNOT OUTLIVE ITS HOST. It is a MODIFIER on a delta
    // sentence, so the withheld path below never receives one: no leader
    // entitlement ⇒ no delta sentence ⇒ no attribution clause. This is
    // structural rather than a second permission check — the withheld arm
    // composes from a null delta and a null change, so there is no branch on
    // which a "since you changed X" clause could survive a withheld leader
    // (CLAUDE.md trap 21, the #709/#737 shape this file already carries a
    // warning about).
    const rerun = leaderWithheld
      ? {
          delta: null,
          interveningChange: null,
          movementLicence: null,
          interveningChangeIsInert: false,
        }
      : buildRerunAcknowledgement(input);
    return {
      signal_id: 'RERUN_ANALYSIS_COMPLETE',
      coaching_text: COACHING_TEXT.RERUN_ANALYSIS_COMPLETE({
        runDelta: rerun.delta,
        interveningChange: rerun.interveningChange,
        movementLicence: rerun.movementLicence,
        interveningChangeIsInert: rerun.interveningChangeIsInert,
      }),
    };
  }

  return null;
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/**
 * Did this turn's edit target a factor whose value the comparison cannot feel?
 *
 * Scoped to `set_factor_value`: the claim is that a FACTOR BASELINE is
 * replaced by every option, and neither an edge-strength adjustment nor a
 * constraint has a baseline for an option to replace. `adjust_edge_strength`
 * and `add_constraint` therefore always answer `false` here, which is the
 * honest answer and not a gap.
 */
function editTargetsInertFactor(
  outcome: SuccessfulHandlerOutcome,
  priorFacts: readonly HandlerFact[],
): boolean {
  const selected = selectRunAnalysisFact(priorFacts);
  if (selected === null) return false;
  const enrichment = runAnalysisEnrichment(selected.fact);
  if (enrichment === null) return false;

  const edits = outcome.handler_facts.filter(
    (f) => f.fact_type === 'set_factor_value' && !isNoopFact(f),
  );
  if (edits.length !== 1) return false;
  const only = edits[0]!;
  if (only.fact_type !== 'set_factor_value') return false;
  const targetId = only.result.target_id;
  if (typeof targetId !== 'string' || targetId.trim().length === 0) return false;

  return (
    deriveEditComparisonReach({
      graph: null,
      priorAnalysisEnrichment: enrichment,
      factorId: targetId,
    }).kind === 'inert'
  );
}

/**
 * True when this turn's edit handler reported that nothing changed.
 *
 * Scoped to the edit fact types (the three ids in `EDIT_HANDLER_IDS`
 * double as their fact types) so an unrelated co-emitted no-op fact
 * cannot suppress coaching for an edit that really happened. `some`
 * rather than `every`: each edit handler emits exactly one fact, and an
 * empty `handler_facts` must not read as "no-op" — with `every` it
 * would, silencing coaching on a shape we never want to guess at.
 */
function isNoopEditOutcome(outcome: SuccessfulHandlerOutcome): boolean {
  return outcome.handler_facts.some(
    (fact) => EDIT_HANDLER_IDS.has(fact.fact_type) && isNoopFact(fact),
  );
}

/**
 * ROADMAP 2.73 — diff this turn's run_analysis fact against the most
 * recent prior successful run. Returns null when either side cannot be
 * projected (legacy fact without a usable enrichment envelope, or the
 * current outcome unexpectedly carries no run_analysis fact); the caller
 * then degrades to comparison-free rerun copy.
 *
 * Prior selection calls `selectRunAnalysisFact` — the canonical newest-first
 * selector the freshness verdict itself is derived from. It used to be
 * `priorFacts.find(isSuccessfulRunAnalysisFact)`: the right PREDICATE but a
 * private ORDERING (first by array position), which is the same drift #738
 * fixed in `selectTwoNewestRunAnalysisFacts` — a legacy fact with no
 * `computed_at`, or any timestamp skew, made this acknowledgment diff against
 * a different "previous run" than the rest of the turn was reasoning about.
 */
function buildRerunAcknowledgement(input: CoachingSignalInput): {
  readonly delta: ContentSafeRunDelta | null;
  readonly interveningChange: InterveningChange | null;
  readonly movementLicence: MovementDirectionLicence | null;
  readonly interveningChangeIsInert: boolean;
} {
  const none = {
    delta: null,
    interveningChange: null,
    movementLicence: null,
    interveningChangeIsInert: false,
  } as const;

  const currentFact = input.outcome.handler_facts.find(
    (f) => f.fact_type === 'run_analysis',
  );
  if (currentFact === undefined) return none;

  // ⭐ ONE SELECTION, TWO CONSUMERS. The delta and the attribution clause are
  // derived from the SAME `selectRunAnalysisFact` result, so "the run we
  // compared against" and "the run the user's change came after" are one fact
  // by construction rather than by two call sites agreeing (CLAUDE.md trap
  // #12; the same reasoning `orderSuccessfulRunAnalysisFactsNewestFirst`
  // records for the comparison pair). Deriving the index separately here would
  // let the sentence attribute a change to a comparison it did not precede.
  const selected = selectRunAnalysisFact(input.priorFacts);
  if (selected === null) return none;

  const prior = projectRunFact(selected.fact);
  const current = projectRunFact(currentFact);
  if (prior === null || current === null) return none;

  const interveningChange = deriveInterveningChange(input.priorFacts, selected.index);

  // ⭐ ONE SELECTION, NOW FOUR CONSUMERS. The delta, the attribution clause,
  // the noise licence and the inertness verdict all derive from the SAME
  // `selectRunAnalysisFact` result, so "the run we compared against" is one
  // fact by construction. A second selection here would let the sentence bound
  // its noise against a different pair than the one it quantifies.
  const priorEnrichment = runAnalysisEnrichment(selected.fact);
  const currentEnrichment = runAnalysisEnrichment(currentFact);

  return {
    delta: compareRuns(prior, current, input.interventionControlledFactorIds),
    interveningChange,
    movementLicence:
      priorEnrichment === null || currentEnrichment === null
        ? null
        : licenceToReportMovementDirection({
            priorEnrichment,
            currentEnrichment,
          }),
    interveningChangeIsInert: interveningEditIsInert(
      input.priorFacts,
      selected.index,
      interveningChange,
      currentEnrichment,
    ),
  };
}

/** The PLoT envelope persisted on a `run_analysis` fact, or null. */
function runAnalysisEnrichment(fact: HandlerFact): Record<string, unknown> | null {
  if (fact.fact_type !== 'run_analysis') return null;
  const enrichment = fact.result.enrichment;
  return enrichment !== null && typeof enrichment === 'object' && !Array.isArray(enrichment)
    ? (enrichment as Record<string, unknown>)
    : null;
}

/**
 * Was the single authored change between the two runs an edit the comparison
 * could not feel?
 *
 * ⚠ SCOPED TO A SINGLE `factor_value_updated` CHANGE, ON PURPOSE. When several
 * changes intervened, `deriveInterveningChange` already returns `several` and
 * names none — and declaring THAT inert would assert something about changes
 * we deliberately did not identify. When the single change is a constraint or
 * an edge adjustment, this module has no inertness question to ask: the claim
 * being made is about a factor's baseline being replaced by every option, and
 * neither of those is a factor baseline.
 *
 * ⚠ AND THE JOIN IS ON `target_id`, NOT ON `target_label`. The captured fact
 * carried NO label at all, so `RecentMutation.target_label` fell back to the
 * literal string "a factor" and the composed sentence read *"Since you changed
 * a factor"*. A label join would therefore have missed the very case this
 * exists for — and worse, a label join CAN match a different factor (trap 19).
 * The structural id is read from the edit fact directly, which is the only
 * place it survives: `projectRecentChanges` deliberately does not carry it.
 *
 * ⭐ THE GRAPH IS NOT AVAILABLE ON THIS PATH, so only the PRODUCER witness
 * (`zero_reason: 'intervention_override'` in the run being narrated) can fire
 * here — `deriveEditComparisonReach` is called with `graph: null`. That is a
 * REAL, NAMED GAP, not an oversight: a factor absent from the current
 * envelope's `factor_sensitivity[]` is not caught, and the residue is pinned
 * by a KNOWN-GAP test rather than left invisible. Closing it needs a graph
 * threaded through `applyCoachingSignal` from `turn-executor.ts` and
 * `chip-click-dispatch.ts`, both of which are outside this lane's ownership.
 */
function interveningEditIsInert(
  priorFacts: readonly HandlerFact[],
  priorRunIndex: number,
  interveningChange: InterveningChange | null,
  currentEnrichment: Record<string, unknown> | null,
): boolean {
  if (interveningChange === null || interveningChange.kind !== 'single') return false;
  if (interveningChange.action !== 'factor_value_updated') return false;
  if (currentEnrichment === null) return false;
  if (priorRunIndex <= 0) return false;

  const edits = priorFacts
    .slice(0, priorRunIndex)
    .filter((f) => f.fact_type === 'set_factor_value' && !isNoopFact(f));
  // Exactly one, or we cannot say which factor the projection named.
  if (edits.length !== 1) return false;

  const only = edits[0]!;
  if (only.fact_type !== 'set_factor_value') return false;
  const targetId = only.result.target_id;
  if (typeof targetId !== 'string' || targetId.trim().length === 0) return false;

  return (
    deriveEditComparisonReach({
      graph: null,
      priorAnalysisEnrichment: currentEnrichment,
      factorId: targetId,
    }).kind === 'inert'
  );
}

/**
 * "Has a run_analysis RESULT been PUT IN FRONT OF THIS USER on a prior turn?"
 *
 * ⚠⚠ SUPERSEDES `hasAnyPriorRunAnalysisFact` (2026-08-20), WHICH ASKED
 * "does ANY run_analysis fact exist?". Those were one question until R2
 * (2026-08-16) gave the SERVER a way to run an analysis nobody asked for:
 * `scheduleAutoRunAfterFreshDraft` commits a provisional `run_analysis` fact
 * after every admissible fresh draft. The old predicate counted it, so the
 * user's first-ever analysis took the RE-RUN arm and the product asserted a
 * comparison against a result the user had never seen. Per Paul's convergence
 * rule the old name is SUPERSEDED, not kept alongside: one canonical owner for
 * this question, no parallel rule.
 *
 * ── WHAT "SEEN" MEANS, AND WHY THIS DERIVATION IS HONEST AT THIS TIP ────────
 * A fact counts as seen when it (a) actually ran and (b) its result was
 * DELIVERED to the user.
 *
 * ⭐⭐ (b) IS NO LONGER "was it user-initiated?" — #1010 SPLIT THAT CONFLATION.
 * This predicate used to read `!isAutoInitiatedRunAnalysisFact(f)`, i.e. it
 * decided delivery from the PROVENANCE STAMP. That was sound only while an
 * auto-initiated run's result reached no client, which was true when #1058
 * shipped and is exactly what #1010 changes: the scenario-graph read leg now
 * returns the committed analysis. The stamp still reads `auto_post_draft` for a
 * run the user may now have seen, so a provenance-only reader would suppress the
 * re-run acknowledgement and the product would claim a FIRST analysis on a
 * genuine re-run — #1058's defect facing the other way (CLAUDE.md trap #21: two
 * questions under one name, coincident until a change decouples them).
 *
 * (b) is therefore now read through {@link hasUserSeenRunAnalysisResult}, which
 * lives beside {@link isAutoInitiatedRunAnalysisFact} in `context/run-initiator.ts`
 * — the one authority on run initiation AND delivery. The two are named apart
 * there: provenance is a permanent fact about the run, delivery is a fact about
 * the channel, and only the second one changes. See that module for why delivery
 * is a constant rather than a derivation today, for the deploy-ordering rule
 * (flip it with UI #752, not before), and for the fully-derived successor.
 *
 * ── (a) IS AN EXCLUSION, NOT A SUCCESS TEST ────────────────────────────────
 * A `noop: true` fact means the analysis did not run, so nothing was displayed.
 * `partial` and `degraded` facts DO count: a degraded analysis is still an
 * analysis the user looked at. That deliberate divergence from
 * `isSuccessfulRunAnalysisFact` (`context/freshness.ts`) is unchanged from the
 * superseded predicate and is pinned by test. The `noop` exclusion also closes,
 * before it can open, a latent inversion the old predicate carried: it counted
 * `noop` facts while `selectRunAnalysisFact` excludes them, so a `noop`-only
 * prior would have taken the re-run arm and then failed to build a comparison,
 * asserting "This was a re-run. It replaces the earlier result as the current
 * analysis" on a genuine first run. Verified at this tip: `run-analysis.ts`
 * emits `noop: false` only (one occurrence, line ~1703), so that inversion is
 * UNREACHABLE today — this makes it unreachable by construction rather than by
 * a property of one handler nobody re-checks.
 *
 * ⚠ NOT BYTE-IDENTICAL TO `hasPriorRunAnalysisFactToStale`, AND THAT IS THE
 * POINT. The two answer different questions and now give different answers on
 * two fixture classes (auto-initiated, and `noop`). CLAUDE.md trap #21: name the
 * concepts apart rather than collapsing or co-tightening them. The divergence is
 * pinned by test in both directions, so a future edit that re-aligns them is
 * LOUD.
 */
function hasPriorRunAnalysisShownToUser(facts: readonly HandlerFact[]): boolean {
  return facts.some(
    (f) =>
      f.fact_type === 'run_analysis' &&
      // (a) DID IT RUN? Owned here — see the `noop` note above.
      f.noop !== true &&
      // A persisted refusal records an attempt, not a result shown to the user.
      !isAnalysisRefusalFact(f) &&
      // (b) WAS ITS RESULT DELIVERED? Owned by `context/run-initiator.ts`, the
      //     one authority on run initiation AND delivery. This used to read
      //     `!isAutoInitiatedRunAnalysisFact(f)` — the PROVENANCE question —
      //     which answered (b) correctly only while an auto-initiated run's
      //     result reached no client. #1010 builds the channel that changes
      //     that, so the two questions are now named apart at their owner
      //     rather than conflated here (CLAUDE.md trap #21).
      hasUserSeenRunAnalysisResult(f),
  );
}

/**
 * "Was an analysis produced before this turn whose displayed results this edit
 * could have made stale?"
 *
 * ⚠ EXISTENCE ONLY — THE ORDERING CLAIM WAS DELETED, NOT CORRECTED (ROADMAP
 * 2.842). This replaced `findMostRecentSuccessfulAnalysisFact`, whose name
 * asserted an ordering it did not deliver: it walked `facts` from the LAST
 * index downwards and returned the first hit, while `prior_facts` arrives
 * NEWEST-FIRST (`build-turn-context.ts`: "Order matches prior_turns
 * (newest-first)", restated at several sites in `context/freshness.ts`). So it
 * returned the OLDEST run_analysis fact under a name promising the newest.
 * There was no live harm — its sole consumer read the result for truthiness, so
 * the direction was unobservable — but the name guaranteed that the first
 * caller to read a FIELD off it would silently get the wrong run's data.
 *
 * The direction was not "fixed", because nothing here consumes recency: a
 * most-recent guarantee with no reader is a guarantee kept alive only by its own
 * test. ⭐ AND A HAND-ROLLED NEWEST-PICKER WOULD BE THE WORSE DEFECT: this file
 * already imports `selectRunAnalysisFact`, the canonical newest-first selector,
 * and `buildRerunDelta` already uses it precisely because #738 removed a private
 * ordering from this same file ("the right PREDICATE but a private ORDERING").
 * A second private ordering alongside it would recreate that drift. If a caller
 * here ever needs the newest prior run_analysis fact, `selectRunAnalysisFact` is
 * the answer.
 *
 * ⚠ Applies no success test either, and no longer claims one — a `partial` /
 * `degraded` fact counts. That is correct for THIS question (an edit invalidates
 * whatever was on screen, degraded or not) and is a deliberate divergence from
 * `isSuccessfulRunAnalysisFact`, pinned by test. See the note on
 * {@link hasPriorRunAnalysisShownToUser} — the run_analysis branch's predicate,
 * which SUPERSEDED `hasAnyPriorRunAnalysisFact` on 2026-08-20 — for why the two
 * coaching predicates stay separate, and for the two fixture classes on which
 * they now deliberately DISAGREE.
 *
 * ⚠ THIS PREDICATE STILL COUNTS A SERVER-INITIATED POST-DRAFT AUTO-RUN, and
 * that is a deliberate scope boundary, not an oversight. The auto-run really did
 * produce a persisted analysis, so an edit really can stale it. What is NOT
 * settled here is that STALE_ANALYSIS_AFTER_EDIT's copy says "The current
 * analysis may not reflect it" — a presupposition about something the user has
 * not been shown when the only prior run was auto-initiated. Same defect class,
 * different surface, materially lower harm (the copy's call to action is
 * correct either way). Rowed rather than widened into this change.
 */
function hasPriorRunAnalysisFactToStale(facts: readonly HandlerFact[]): boolean {
  return facts.some(
    (f) => f.fact_type === 'run_analysis' && !isAnalysisRefusalFact(f),
  );
}

/**
 * For an edit-handler turn, read the edited target_id off the handler fact
 * and, if it is present in contextPack.analysis.top_drivers (matched by
 * factor_label exactly as the ContextPack carries it), return that label
 * so the coaching text can name it. Null when no analysis exists, or when
 * the target is not among top drivers, or when the fact shape does not
 * carry target_id.
 */
function findEditTargetTopDriverLabel(
  outcome: SuccessfulHandlerOutcome,
  contextPack: ContextPack | null,
): string | null {
  if (contextPack === null || contextPack.analysis === null) return null;
  const drivers = contextPack.analysis.top_drivers;
  if (drivers.length === 0) return null;

  for (const fact of outcome.handler_facts) {
    if (
      fact.fact_type === 'set_factor_value' ||
      fact.fact_type === 'adjust_edge_strength' ||
      fact.fact_type === 'add_constraint'
    ) {
      const targetId = fact.result.target_id;
      // top_drivers carries { factor_label, sensitivity_value }; an edit
      // fact carries target_id (factor id). Best-effort label match —
      // ContextPack does not currently expose factor_id, so we compare
      // factor_label against target_id (legacy behaviour preserved).
      const match = drivers.find((d) => d.factor_label === targetId);
      if (match !== undefined) return match.factor_label;
    }
  }
  return null;
}
