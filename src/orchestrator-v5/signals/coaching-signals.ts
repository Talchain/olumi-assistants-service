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
}) => string> = {
  STALE_ANALYSIS_AFTER_EDIT: () =>
    'This change affects the model. The current analysis may not reflect it. Run the analysis to see updated results.',
  HIGH_SENSITIVITY_EDIT: ({ factorLabel }) =>
    `You're editing ${factorLabel ?? 'a factor'}, which was one of the strongest drivers in the last analysis. Rerunning will show how this changes the picture.`,
  FIRST_ANALYSIS_COMPLETE: () =>
    'Your first analysis is ready. Take a moment to explore the leading option and the factors shaping it before acting on the result.',
  RERUN_ANALYSIS_COMPLETE: ({ runDelta }) => composeRerunText(runDelta ?? null),
};

/**
 * ROADMAP 2.73 — rerun acknowledgment copy, derived from the shared
 * `compareRuns` delta (reuse, not a parallel diff). Register mirrors the
 * run-comparison gate's `composeComparison` so the two rerun surfaces
 * cannot drift in vocabulary. Content-safe: labels + integer percentage
 * points only, no raw decimals, no IDs.
 */
function composeRerunText(delta: RunDelta | null): string {
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
    return (
      `${delta.current_leading_label} leads after this re-run. I cannot line up `
      + 'the earlier result with this one, so I have not compared the two.'
    );
  }
  if (delta.leading_option_changed) {
    return (
      `This re-run changed the outcome: ${delta.prior_leading_label} led before, `
      + `and ${delta.current_leading_label} now leads. Ask what changed if you want the detail.`
    );
  }
  if (delta.margin_direction === 'widened') {
    return (
      `${delta.current_leading_label} still leads after this re-run, and its lead `
      + `has widened by about ${formatPercentagePoints(Math.abs(delta.margin_shift_pp))}.`
    );
  }
  if (delta.margin_direction === 'narrowed') {
    return (
      `${delta.current_leading_label} still leads after this re-run, though its lead `
      + `has narrowed by about ${formatPercentagePoints(Math.abs(delta.margin_shift_pp))}.`
    );
  }
  return `The result is unchanged: ${delta.current_leading_label} still leads.`;
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

    const priorSuccessfulAnalysis = findMostRecentSuccessfulAnalysisFact(input.priorFacts);
    if (priorSuccessfulAnalysis) {
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

    if (!hasPriorSuccessfulRunAnalysis(input.priorFacts)) {
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
    return {
      signal_id: 'RERUN_ANALYSIS_COMPLETE',
      coaching_text: leaderWithheld
        ? composeRerunText(null)
        : COACHING_TEXT.RERUN_ANALYSIS_COMPLETE({
            runDelta: buildRerunDelta(input),
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
function buildRerunDelta(input: CoachingSignalInput): RunDelta | null {
  const currentFact = input.outcome.handler_facts.find(
    (f) => f.fact_type === 'run_analysis',
  );
  if (currentFact === undefined) return null;

  const priorFact = selectRunAnalysisFact(input.priorFacts)?.fact;
  if (priorFact === undefined) return null;

  const prior = projectRunFact(priorFact);
  const current = projectRunFact(currentFact);
  if (prior === null || current === null) return null;

  return compareRuns(prior, current, input.interventionControlledFactorIds);
}

function hasPriorSuccessfulRunAnalysis(facts: readonly HandlerFact[]): boolean {
  // Presence of a run_analysis fact in priorFacts means the handler returned
  // success on a prior turn (failed handlers throw and never emit facts).
  // Paul's Task C correction: a failed analysis attempt must NOT block
  // FIRST_ANALYSIS_COMPLETE from firing on the first success.
  return facts.some((f) => f.fact_type === 'run_analysis');
}

function findMostRecentSuccessfulAnalysisFact(
  facts: readonly HandlerFact[],
): HandlerFact | null {
  for (let i = facts.length - 1; i >= 0; i--) {
    if (facts[i].fact_type === 'run_analysis') return facts[i];
  }
  return null;
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
