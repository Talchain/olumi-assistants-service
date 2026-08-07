/**
 * ROADMAP 2.73 — shared STEP-5 coaching-signal application.
 *
 * ONE helper owns the detector + telemetry + fact-attach + sidecar-append
 * sequence that used to live inline in turn-executor.ts (STEP 5) while the
 * chip-click dispatch path composed `coaching: null` hardcoded. Both
 * dispatch paths (routed turn-executor AND deterministic chip-click) now
 * invoke this helper, so they cannot drift on whether / how a coaching
 * signal fires on an action turn.
 *
 * Pure apart from the two existing side effects it centralises:
 *   - `TelemetryEvents.V5CoachingSignalFired` emission, and
 *   - the fire-and-forget per-scenario sidecar append (the only
 *     persistence path for edit-handler signals, whose fact variants
 *     have no enrichment field).
 *
 * No LLM calls (F.6 holds on both paths).
 */

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { emit, TelemetryEvents } from '../../utils/telemetry.js';
import {
  readMayNameLeadingOptionVerdict,
  type ClaimSafetyScenarioScope,
} from '../context/claim-safety-read.js';
import type { ContextPack } from '../context/context-pack-assembler.js';
import { detectCoachingSignal } from '../signals/coaching-signals.js';
import type { SuccessfulHandlerOutcome } from '../tools/handler-outcome.js';
import { appendLastCoachingSignal } from './last-coaching-signal-log.js';
import type { CoachingSignalId } from './types.js';

export interface ApplyCoachingSignalInput {
  /** The handler that just succeeded on this turn. */
  readonly proposedHandlerId: string;
  /** Outcome of the successful handler (detector input). */
  readonly outcome: SuccessfulHandlerOutcome;
  /**
   * LLM-facing context pack for this turn, or null on the chip-click
   * path (which assembles no pack). See CoachingSignalInput.contextPack.
   */
  readonly contextPack: ContextPack | null;
  /** Facts from prior turns in this scenario (newest-first). */
  readonly priorFacts: readonly HandlerFact[];
  /**
   * The facts destined for commit on THIS turn (post decision_review
   * enrichment). When a run_analysis signal fires, the signal marker is
   * attached to the run_analysis fact in THIS array and the updated
   * array is returned; callers must commit / compose the returned facts.
   */
  readonly handlerFacts: readonly HandlerFact[];
  readonly requestId: string;
  readonly scenarioId: string;
  /**
   * Spine A backstop for the rerun delta: factor_ids an option intervenes
   * on, threaded through to `compareRuns`. Omitted / empty ⇒ no
   * suppression.
   */
  readonly interventionControlledFactorIds?: ReadonlySet<string>;
  /**
   * ⭐ ROADMAP 2.804 — the scenario scope for the leader-claim permission.
   *
   * REQUIRED, and required on purpose: it is the forcing function that makes
   * every dispatch path state, in the type system, which scenario's claim
   * safety governs its coaching. A new caller cannot inherit a permission by
   * omission, which is exactly how the defect below shipped.
   *
   * Never client-supplied — build it with `claimSafetyScopeFromContext`.
   */
  readonly claimSafetyScope: ClaimSafetyScenarioScope;
}

export interface AppliedCoachingSignal {
  /** Text for compose (joined into assistant_text), or null. */
  readonly coachingText: string | null;
  readonly signalId: CoachingSignalId | null;
  /**
   * The input `handlerFacts`, with the coaching-signal marker attached to
   * the run_analysis fact when a signal fired on a run_analysis turn;
   * otherwise the input array unchanged.
   */
  readonly handlerFacts: readonly HandlerFact[];
}

/**
 * Run the STEP-5 detector and, when a signal fires, perform the canonical
 * follow-through: telemetry, run_analysis fact-attach, sidecar append.
 */
export function applyCoachingSignal(
  input: ApplyCoachingSignalInput,
): AppliedCoachingSignal {
  // ═══════════════════════════════════════════════════════════════════════════
  // ⭐ ROADMAP 2.804 — THE LEADER-CLAIM PERMISSION IS DERIVED HERE, ONCE.
  //
  // WHAT THIS REPLACED. The detector used to read a second authority: an
  // internal `__leading_option_claim_withheld` channel that `run_analysis` set
  // on its own outcome, absent meaning permitted. That answered a DIFFERENT
  // QUESTION — "did THIS RUN's constraint verdict withhold?" — while the
  // coaching slot needs "may THIS TURN name a leading option on screen?".
  //
  // The two came apart when #737 gave the turn-level verdict a second conjunct
  // (`narrowToProjectedAnalysis`: the DISPLAYED analysis must also permit), one
  // day after #709 introduced the outcome channel to close this very harm. The
  // outcome channel structurally cannot carry that conjunct, because it never
  // sees the fact array. So on a turn whose newest CLAIM-BEARING fact is not a
  // canonical success (PLoT emits `analysis_status: 'partial'` with a full
  // option comparison whenever options are usable but robustness or drivers
  // degraded) while an older PROJECTABLE fact reads withheld — every unstamped
  // pre-#710 fact, for which there is no data migration — the channel PERMITTED
  // and the turn verdict WITHHELD. The confirmation withheld the leader and the
  // coaching sentence directly beneath it named one.
  //
  // WHY THE READ LIVES INSIDE THIS HELPER RATHER THAN BEING PASSED IN.
  // In `turn-executor.ts` the STEP-5 coaching call runs BEFORE the post-handler
  // re-read of the turn verdict. A threaded boolean would therefore be sourced,
  // by default, from the TURN-ENTRY hoist — computed over `context.prior_facts`,
  // i.e. the state before this turn's analysis existed. That is a NEW split in
  // the opposite direction: a scenario whose prior fact withheld and whose
  // current analysis permits would have honest coaching suppressed, on the most
  // common turn shape in the product. Deriving it here, from the facts this
  // helper already holds, means there is no path from a caller to the stale
  // value — the ordering hazard is removed rather than navigated. Callers
  // supply only the SCOPE, which is a property of the scenario, not of a moment
  // in the turn.
  //
  // ONE DERIVATION, TWO READ POINTS. This is the same
  // `readMayNameLeadingOptionVerdict` over the same union shape (this turn's
  // facts ∪ the window) and the same scope that the executor's post-handler
  // re-read and the chip-click exit use. Not a second derivation: one function,
  // one selector pair, one leaf reader (CLAUDE.md trap #12).
  // ═══════════════════════════════════════════════════════════════════════════
  const mayNameLeadingOption = readMayNameLeadingOptionVerdict(
    [...input.handlerFacts, ...input.priorFacts],
    input.claimSafetyScope,
  ).may_name_leading_option;

  const detection = detectCoachingSignal({
    proposedHandlerId: input.proposedHandlerId,
    outcome: input.outcome,
    contextPack: input.contextPack,
    priorFacts: input.priorFacts,
    mayNameLeadingOption,
    ...(input.interventionControlledFactorIds !== undefined
      ? { interventionControlledFactorIds: input.interventionControlledFactorIds }
      : {}),
  });
  if (detection === null) {
    return { coachingText: null, signalId: null, handlerFacts: input.handlerFacts };
  }

  emit(TelemetryEvents.V5CoachingSignalFired, {
    request_id: input.requestId,
    scenario_id: input.scenarioId,
    signal_id: detection.signal_id,
    handler_id: input.proposedHandlerId,
  });

  // Persist signal metadata into enrichment on run_analysis facts (frozen
  // schema has enrichment only there) so the next turn's
  // CoachingCache.last_coaching_signal can surface it.
  const handlerFacts =
    input.proposedHandlerId === 'run_analysis'
      ? attachCoachingSignalToRunAnalysisFact(
          input.handlerFacts,
          detection.signal_id,
          input.requestId,
        )
      : input.handlerFacts;

  // Also write to the per-scenario sidecar. This is the only persistence
  // path for edit-handler signals (STALE_*, HIGH_*) because edit
  // HandlerFact variants have no enrichment field. Fire-and-forget; the
  // sidecar helper swallows I/O failures.
  void appendLastCoachingSignal({
    scenario_id: input.scenarioId,
    signal_id: detection.signal_id,
    turn_id: input.requestId,
    produced_at: new Date().toISOString(),
  });

  return {
    coachingText: detection.coaching_text,
    signalId: detection.signal_id,
    handlerFacts,
  };
}

/**
 * V5 Group 1 Task C: attach a coaching signal marker to the run_analysis
 * handler fact's enrichment so the next turn's coaching-cache reader can
 * surface it as last_coaching_signal. For edit handlers (set_factor_value
 * et al.), enrichment does not exist on the fact shape, so signal_id is
 * carried only via the sidecar / routing log. (Moved verbatim from
 * turn-executor.ts so both dispatch paths share one implementation.)
 */
export function attachCoachingSignalToRunAnalysisFact(
  facts: readonly HandlerFact[],
  signalId: CoachingSignalId,
  turnId: string,
): readonly HandlerFact[] {
  const idx = facts.findIndex((f) => f.fact_type === 'run_analysis');
  if (idx < 0) return facts;
  const fact = facts[idx];
  if (fact.fact_type !== 'run_analysis') return facts;
  const base = fact.result.enrichment ?? {};
  const next: HandlerFact = {
    ...fact,
    result: {
      ...fact.result,
      enrichment: {
        ...base,
        coaching_signal_id: signalId,
        coaching_signal_turn_id: turnId,
        coaching_signal_produced_at: new Date().toISOString(),
      },
    },
  };
  const out = facts.slice();
  out[idx] = next;
  return out;
}
