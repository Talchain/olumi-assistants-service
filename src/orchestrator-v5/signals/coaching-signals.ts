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
 *     when a prior run_analysis fact exists, i.e. exactly when
 *     FIRST_ANALYSIS_COMPLETE does not; text derives from the shared
 *     `compareRuns` comparator so the rerun acknowledgment names the delta
 *     or the no-change verdict)
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
  type RunDelta,
} from '../coaching/compare-runs.js';
import type { ContextPack } from '../context/context-pack-assembler.js';
import type { CoachingSignalId } from '../coaching/types.js';
import {
  deriveInterveningChange,
  type InterveningChange,
} from '../coaching/intervening-change.js';
import type { RecentChangeAction } from '../context/recent-changes.js';
import { selectRunAnalysisFact } from '../context/freshness.js';
import { formatPercentagePoints } from '../format/format-analysis-value.js';
import { isNoopFact } from '../tools/fact-noop.js';
import type { SuccessfulHandlerOutcome } from '../tools/handler-outcome.js';

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
   * successful run_analysis" from subsequent ones. Failed handler turns
   * throw and never emit facts, so absence of a prior run_analysis fact
   * correctly means "no prior success" per Paul's Task C correction.
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
  readonly runDelta?: RunDelta | null;
  /**
   * PR2 L2 — the authored change that landed between the two runs, or null.
   * Absent/null reproduces the pre-attribution copy BYTE-IDENTICALLY on every
   * branch, which is pinned by test.
   */
  readonly interveningChange?: InterveningChange | null;
}) => string> = {
  STALE_ANALYSIS_AFTER_EDIT: () =>
    'This change affects the model. The current analysis may not reflect it. Run the analysis to see updated results.',
  HIGH_SENSITIVITY_EDIT: ({ factorLabel }) =>
    `You're editing ${factorLabel ?? 'a factor'}, which was one of the strongest drivers in the last analysis. Rerunning will show how this changes the picture.`,
  FIRST_ANALYSIS_COMPLETE: () =>
    'Your first analysis is ready. Take a moment to explore the leading option and the factors shaping it before acting on the result.',
  RERUN_ANALYSIS_COMPLETE: ({ runDelta, interveningChange }) =>
    composeRerunText(runDelta ?? null, interveningChange ?? null),
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
function composeRerunText(
  delta: RunDelta | null,
  interveningChange: InterveningChange | null = null,
): string {
  if (delta === null || !delta.comparable) {
    // Prior run exists but the two runs cannot be lined up (legacy fact
    // without a projectable envelope, or missing labels). Acknowledge the
    // rerun without claiming a comparison we could not make.
    return 'This was a re-run. It replaces the earlier result as the current analysis.';
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
    return (
      `${delta.current_leading_label} leads after this re-run. I cannot line up `
      + 'the earlier result with this one, so I have not compared the two.'
    );
  }

  // Past every abstention. A real comparison exists, so a temporal clause about
  // what preceded it is licensed. Empty string when there is nothing to
  // attribute, which reproduces the pre-attribution copy byte-identically.
  const since = attributionPrefix(interveningChange);
  const attributed = since.length > 0;

  if (delta.leading_option_changed) {
    return attributed
      ? (
        `${since}the result has changed: ${delta.prior_leading_label} led before, `
        + `and ${delta.current_leading_label} now leads. Ask what changed if you want the detail.`
      )
      : (
        `This re-run changed the outcome: ${delta.prior_leading_label} led before, `
        + `and ${delta.current_leading_label} now leads. Ask what changed if you want the detail.`
      );
  }
  if (delta.margin_direction === 'widened') {
    return (
      `${since}${delta.current_leading_label} still leads after this re-run, and its lead `
      + `has widened by about ${formatPercentagePoints(Math.abs(delta.margin_shift_pp))}.`
    );
  }
  if (delta.margin_direction === 'narrowed') {
    return (
      `${since}${delta.current_leading_label} still leads after this re-run, though its lead `
      + `has narrowed by about ${formatPercentagePoints(Math.abs(delta.margin_shift_pp))}.`
    );
  }
  // ⭐ THE UNCHANGED ARM IS THE SCIENTIFIC ONE AND MUST READ AS A FINDING, NOT
  // AN APOLOGY. An intervention that moves nothing is evidence the conclusion
  // is ROBUST to it, and a product that can only report a result when the
  // answer changes cannot report a null result at all. So the attributed form
  // states the finding explicitly rather than reusing the bare "unchanged"
  // sentence, which read as a non-event when the user had just acted.
  //
  // ⚠ "the conclusion", NOT "the recommendation". The design this implements
  // specified "the recommendation does not hinge on that value", and that copy
  // is DEFECTIVE at the egress bytes: `recommendation` is in
  // FORBIDDEN_USER_FACING_PHRASES (the founder ruling that the product does not
  // recommend), so `applyTerminologyRewrite` silently rewrote it to "the
  // leading option" — shipping bytes the copy deck never said AND
  // MANUFACTURING the banned leader vocabulary inside our own safety pass, on
  // every unchanged-arm re-run. Measured with both controls live. The whole
  // composed sentence set is now pinned against the real guard by test.
  return attributed
    ? (
      `${since}the picture is the same: ${delta.current_leading_label} still leads. `
      + 'That is a result in itself: the conclusion does not hinge on that change.'
    )
    : `The result is unchanged: ${delta.current_leading_label} still leads.`;
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
      // STALE wins over HIGH_SENSITIVITY per the authoritative priority order.
      return {
        signal_id: 'STALE_ANALYSIS_AFTER_EDIT',
        coaching_text: COACHING_TEXT.STALE_ANALYSIS_AFTER_EDIT({}),
      };
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

    // The question THIS branch asks: "has an analysis ever completed before,
    // i.e. is this a re-run rather than the first?" — a different question from
    // the edit branch's, with the same answer today.
    if (!hasAnyPriorRunAnalysisFact(input.priorFacts)) {
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
      ? { delta: null, interveningChange: null }
      : buildRerunAcknowledgement(input);
    return {
      signal_id: 'RERUN_ANALYSIS_COMPLETE',
      coaching_text: COACHING_TEXT.RERUN_ANALYSIS_COMPLETE({
        runDelta: rerun.delta,
        interveningChange: rerun.interveningChange,
      }),
    };
  }

  return null;
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

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
  readonly delta: RunDelta | null;
  readonly interveningChange: InterveningChange | null;
} {
  const none = { delta: null, interveningChange: null } as const;

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

  return {
    delta: compareRuns(prior, current, input.interventionControlledFactorIds),
    interveningChange: deriveInterveningChange(input.priorFacts, selected.index),
  };
}

/**
 * "Has an analysis ever completed before this turn, i.e. is this a RE-RUN
 * rather than the first analysis?"
 *
 * ⚠ APPLIES NO SUCCESS TEST, AND THE LOOSENESS IS THE CONTRACT. Presence of a
 * run_analysis fact in priorFacts means the handler returned success on a prior
 * turn (failed handlers throw and never emit facts). Paul's Task C correction:
 * a failed analysis attempt must NOT block FIRST_ANALYSIS_COMPLETE from firing
 * on the first success.
 *
 * ⚠ RENAMED FROM `hasPriorSuccessfulRunAnalysis` (ROADMAP 2.842). The old name
 * claimed a success test this function does not perform, which made it a THIRD
 * status predicate in a codebase whose dominant defect class is predicate
 * drift: a `partial` / `degraded` fact counts as "successful" here while
 * `isSuccessfulRunAnalysisFact` (`context/freshness.ts`) excludes exactly
 * those. The NAME was the defect — tightening the behaviour would change the
 * first-analysis path. The divergence from the freshness authority is now
 * pinned by test rather than remembered; see `__tests__/coaching-signals.test.ts`
 * ("the coaching layer's predicate is DELIBERATELY broader...").
 *
 * ⚠ BYTE-IDENTICAL TO `hasPriorRunAnalysisFactToStale` TODAY, AND KEPT SEPARATE
 * ON PURPOSE. The two answer different questions ("is this a re-run?" vs "could
 * this edit have staled a shown analysis?") that happen to share an answer, and
 * they are loose for different reasons. CLAUDE.md trap #21: when two authorities
 * agree today, the fix is to name the concepts apart, not to collapse them —
 * merging would silently bind a future tightening of one to the other. Their
 * agreement is itself pinned by test, so a divergence is loud rather than
 * silent.
 */
function hasAnyPriorRunAnalysisFact(facts: readonly HandlerFact[]): boolean {
  return facts.some((f) => f.fact_type === 'run_analysis');
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
 * {@link hasAnyPriorRunAnalysisFact} for why the two coaching predicates stay
 * separate despite agreeing today.
 */
function hasPriorRunAnalysisFactToStale(facts: readonly HandlerFact[]): boolean {
  return facts.some((f) => f.fact_type === 'run_analysis');
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
