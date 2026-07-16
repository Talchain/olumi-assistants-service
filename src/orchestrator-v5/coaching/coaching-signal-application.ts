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
  const detection = detectCoachingSignal({
    proposedHandlerId: input.proposedHandlerId,
    outcome: input.outcome,
    contextPack: input.contextPack,
    priorFacts: input.priorFacts,
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
