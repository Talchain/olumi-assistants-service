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
 * F.6: deterministic only. No LLM calls in Step 5. No math; only field
 * lookups.
 */

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import type { ContextPack } from '../context/context-pack-assembler.js';
import type { CoachingSignalId } from '../coaching/types.js';
import { isNoopFact } from '../tools/fact-noop.js';
import type { SuccessfulHandlerOutcome } from '../tools/handler-outcome.js';

export type { CoachingSignalId };

export interface CoachingSignalInput {
  /** The handler that just succeeded on this turn. */
  readonly proposedHandlerId: string;
  /** Outcome of the successful handler (its facts are consulted by the
   *  sensitivity detector to find the edit's target_id). */
  readonly outcome: SuccessfulHandlerOutcome;
  /** LLM-facing context pack assembled for this turn. */
  readonly contextPack: ContextPack;
  /**
   * Facts from prior turns in this scenario. Used to distinguish "first
   * successful run_analysis" from subsequent ones. Failed handler turns
   * throw and never emit facts, so absence of a prior run_analysis fact
   * correctly means "no prior success" per Paul's Task C correction.
   */
  readonly priorFacts: readonly HandlerFact[];
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
const COACHING_TEXT: Record<CoachingSignalId, (ctx: {
  readonly factorLabel?: string;
}) => string> = {
  STALE_ANALYSIS_AFTER_EDIT: () =>
    'This change affects the model. The current analysis may not reflect it. Run the analysis to see updated results.',
  HIGH_SENSITIVITY_EDIT: ({ factorLabel }) =>
    `You're editing ${factorLabel ?? 'a factor'}, which was one of the strongest drivers in the last analysis. Rerunning will show how this changes the picture.`,
  FIRST_ANALYSIS_COMPLETE: () =>
    'Your first analysis is ready. Take a moment to explore the leading option and the factors shaping it before acting on the result.',
};

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
    if (!hasPriorSuccessfulRunAnalysis(input.priorFacts)) {
      return {
        signal_id: 'FIRST_ANALYSIS_COMPLETE',
        coaching_text: COACHING_TEXT.FIRST_ANALYSIS_COMPLETE({}),
      };
    }
    return null;
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
  contextPack: ContextPack,
): string | null {
  if (contextPack.analysis === null) return null;
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
