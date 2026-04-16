/**
 * V5 TurnExecutor (slice A1).
 *
 * Single class implementing addendum §2.1.2 and the invocation order in §2.1.3,
 * scoped to `direct_answer`. Everything else → UNHANDLED per Paul's constraint 1.
 *
 * Ordering (A1):
 *   1. buildTurnContext       — minimal V5 TurnContext
 *   2. dispatch               — direct_answer exclusively; else UnhandledTurnClassError
 *   3. sanitise               — runs inside dispatch for A1
 *   4. compose                — OlumiResponse assembly
 *   5. commit                 — no-op per constraint 11
 *   6. egress validate (caller's route-v2)
 *
 * Budget enforcement: TurnExecutor owns an outer wall-clock AbortSignal with
 * `budgets.turn_ms`. Narrate gets an inner budget via `invokeNarrate`. Per
 * Paul's constraint 7: BUDGET_EXCEEDED wins over LLM_TIMEOUT when both could
 * apply — the wall-clock bound is inspected before mapping inner timeouts.
 *
 * Exactly-one-response invariant (BI-01): the top-level try/finally guarantees
 * every `turn_executor.started` telemetry event has a matching `.completed`
 * with `response_emitted=true`. No exceptions.
 */

import type { OrchestratorTurnPayload, OlumiResponse, FailureTypeLiteral } from '@talchain/schemas/boundary';

import { emit, TelemetryEvents, log } from '../utils/telemetry.js';
import {
  dispatchDirectAnswer,
  UnhandledTurnClassError,
  type DispatchResult,
} from './dispatch.js';
import { NarrateEmptyOutputError, NarrateTimeoutError } from './llm-adapter.js';
import { composeDirectAnswerResponse } from './compose.js';
import { commitDirectAnswer } from './commit.js';
import { buildTurnContext } from './build-turn-context.js';
import { buildFailureResponse } from './failure-response.js';
import { INTERNAL_TO_WIRE, type InternalFailure } from './types.js';

export interface TurnExecutorRunResult {
  response: OlumiResponse;
  telemetry: {
    stages_completed: string[];
    response_emitted: true; // invariant — always true
    llm_calls_used: number;
    commit_performed: boolean;
    failure_type: FailureTypeLiteral | null;
    wall_clock_ms: number;
  };
}

const TURN_CLASS_A1 = 'direct_answer' as const;

/**
 * Run a single V5 turn end-to-end. Always returns a well-formed OlumiResponse;
 * HTTP error conditions are surfaced by the caller (route-v2.ts) after egress
 * validation. Internal runtime failures map to a typed OlumiResponse with an
 * ErrorBlock — never thrown past this function.
 */
export async function runTurnExecutor(
  payload: OrchestratorTurnPayload,
  requestId: string,
): Promise<TurnExecutorRunResult> {
  const startedAt = Date.now();
  const stagesCompleted: string[] = [];

  // Build TurnContext up-front so the telemetry `started` event can carry
  // stage + session info even if later stages fail.
  const context = buildTurnContext(payload, requestId);
  stagesCompleted.push('build_turn_context');

  emit(TelemetryEvents.TurnExecutorStarted, {
    request_id: requestId,
    session_id: context.session_id,
    stage: context.stage,
    turn_class: TURN_CLASS_A1,
  });

  // Wall-clock outer bound. AbortController signals dispatch to give up if
  // the whole turn exceeds `turn_ms`. Used for BUDGET_EXCEEDED precedence:
  // the controller fires before the narrate adapter's inner timeout, so we
  // can detect "the outer budget tripped" and classify correctly.
  const turnAbort = new AbortController();
  const turnTimer = setTimeout(() => turnAbort.abort(), context.budgets.turn_ms);

  let response: OlumiResponse;
  let llmCallsUsed = 0;
  let commitPerformed = false;
  let failureType: FailureTypeLiteral | null = null;

  try {
    let dispatchResult: DispatchResult;
    try {
      dispatchResult = await dispatchDirectAnswer(TURN_CLASS_A1, context, {
        signal: turnAbort.signal,
      });
      llmCallsUsed = dispatchResult.llm_calls_used;
      stagesCompleted.push('dispatch');
    } catch (error) {
      // Timeout precedence (Paul's constraint 7): if the outer wall-clock
      // abort fired, classify as BUDGET_EXCEEDED regardless of whether the
      // inner narrate adapter saw its own timeout.
      if (turnAbort.signal.aborted) {
        failureType = INTERNAL_TO_WIRE.BUDGET_EXCEEDED;
        response = buildFailureResponse('BUDGET_EXCEEDED', context.stage, {
          budget_ms: context.budgets.turn_ms,
        });
        return finalizeRun();
      }
      if (error instanceof NarrateTimeoutError) {
        failureType = INTERNAL_TO_WIRE.LLM_TIMEOUT;
        response = buildFailureResponse('LLM_TIMEOUT', context.stage, {
          phase: 'narrate',
        });
        return finalizeRun();
      }
      if (error instanceof NarrateEmptyOutputError) {
        // Empty output counts as internal — sanitiser consumed everything or
        // provider returned nothing. Surfaces as INTERNAL_ERROR.
        failureType = INTERNAL_TO_WIRE.UNHANDLED;
        response = buildFailureResponse('UNHANDLED', context.stage, {
          reason: 'empty_narrate_output',
        });
        return finalizeRun();
      }
      if (error instanceof UnhandledTurnClassError) {
        // Paul's constraint 1: any non-direct_answer class → UNHANDLED.
        log.error(
          { request_id: requestId, reason: error.reason, message: error.message },
          'V5 TurnExecutor unhandled turn class — invariant violation',
        );
        failureType = INTERNAL_TO_WIRE.UNHANDLED;
        response = buildFailureResponse('UNHANDLED', context.stage, {
          reason: 'unhandled_turn_class',
        });
        return finalizeRun();
      }
      // Everything else bubbles up to UNHANDLED. Log the raw error so we
      // can debug; do NOT leak it into the envelope.
      log.error(
        { request_id: requestId, err: serialiseError(error) },
        'V5 TurnExecutor encountered an unexpected error',
      );
      failureType = INTERNAL_TO_WIRE.UNHANDLED;
      response = buildFailureResponse('UNHANDLED', context.stage, {
        reason: 'unexpected_error',
      });
      return finalizeRun();
    }

    // Contamination telemetry is informational; response stays a success.
    if (dispatchResult.sanitised.contamination_detected) {
      emit(TelemetryEvents.TurnExecutorContaminationNarrate, {
        request_id: requestId,
        raw_length: dispatchResult.raw_text_length,
        sanitised_length: dispatchResult.sanitised.output.length,
      });
    }

    // Compose + commit. Either throwing means STATE_COMMIT_FAILED → INTERNAL_ERROR.
    try {
      const composed = composeDirectAnswerResponse({
        assistant_text: dispatchResult.sanitised.output,
        stage: context.stage,
      });
      stagesCompleted.push('compose');

      const committed = commitDirectAnswer(composed);
      commitPerformed = committed.performed;
      stagesCompleted.push('commit');

      response = committed.response;
      return finalizeRun();
    } catch (error) {
      log.error(
        { request_id: requestId, err: serialiseError(error) },
        'V5 TurnExecutor compose/commit failure',
      );
      failureType = INTERNAL_TO_WIRE.STATE_COMMIT_FAILED;
      response = buildFailureResponse('STATE_COMMIT_FAILED', context.stage, {
        phase: 'compose_or_commit',
      });
      return finalizeRun();
    }
  } finally {
    clearTimeout(turnTimer);
    // Always emit `completed`. `response_emitted` is always `true` — the
    // typed failure envelope counts as a response.
    emit(TelemetryEvents.TurnExecutorCompleted, {
      request_id: requestId,
      session_id: context.session_id,
      stage: context.stage,
      turn_class: TURN_CLASS_A1,
      stages_completed: stagesCompleted,
      response_emitted: true,
      llm_calls_used: llmCallsUsed,
      commit_performed: commitPerformed,
      failure_type: failureType,
      wall_clock_ms: Date.now() - startedAt,
    });
  }

  function finalizeRun(): TurnExecutorRunResult {
    return {
      response,
      telemetry: {
        stages_completed: stagesCompleted,
        response_emitted: true,
        llm_calls_used: llmCallsUsed,
        commit_performed: commitPerformed,
        failure_type: failureType,
        wall_clock_ms: Date.now() - startedAt,
      },
    };
  }
}

function serialiseError(err: unknown): { name?: string; message?: string } {
  if (err instanceof Error) return { name: err.name, message: err.message };
  return { message: String(err) };
}

// Re-exports for callers / tests.
export { TURN_CLASS_A1 };
export type { InternalFailure } from './types.js';
