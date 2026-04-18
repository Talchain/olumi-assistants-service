/**
 * V5 TurnExecutor (slice A2).
 *
 * Single class implementing addendum §2.1.2 and the invocation order in §2.1.3.
 * A1 scoped to `direct_answer`; A2 extends with `clarify`. Everything else
 * → UNHANDLED per Paul's constraint 1.
 *
 * Ordering (A2):
 *   1. buildTurnContext       — minimal V5 TurnContext
 *   2. dispatch               — classify → direct_answer | clarify; else
 *                               UnhandledTurnClassError
 *   3. sanitise               — runs inside each handler branch
 *   4. compose                — OlumiResponse assembly (per turn_class)
 *   5. commit                 — no-op per constraint 11
 *   6. egress validate (caller's route-v2)
 *
 * Budget enforcement: TurnExecutor owns an outer wall-clock AbortSignal with
 * `budgets.turn_ms`. Classifier and narrate each get a fresh
 * `budgets.llm_narrate_ms` inner bound (documented in budgets.ts per Paul's
 * correction 4). Paul's constraint 7: BUDGET_EXCEEDED wins over LLM_TIMEOUT
 * when both could apply — the wall-clock bound is inspected before mapping
 * inner timeouts.
 *
 * Exactly-one-response invariant (BI-01): the top-level try/finally guarantees
 * every `turn_executor.started` telemetry event has a matching `.completed`
 * with `response_emitted=true`. No exceptions.
 *
 * Telemetry: `stages_completed` is now order-tolerant. A2 emits `classify`
 * before `dispatch` on every successful classification. Tests should assert
 * presence, not exact sequence.
 */

import type { OrchestratorTurnPayload, OlumiResponse, FailureTypeLiteral } from '@talchain/schemas/boundary';
import type { HandlerFact, V5ActionType } from '@talchain/schemas/orchestrator';

import { emit, TelemetryEvents, log } from '../utils/telemetry.js';
import {
  dispatch,
  UnhandledTurnClassError,
  type DispatchResult,
} from './dispatch.js';
import { ClassifierSchemaViolationError } from './classify.js';
import { NarrateEmptyOutputError, NarrateTimeoutError } from './llm-adapter.js';
import {
  composeDirectAnswerResponse,
  composeClarifyResponse,
} from './compose.js';
import { commitDirectAnswer, computeRequestHash } from './commit.js';
import { buildTurnContext } from './build-turn-context.js';
import { buildFailureResponse } from './failure-response.js';
import { INTERNAL_TO_WIRE, type C1TurnClass } from './types.js';

export interface TurnExecutorRunResult {
  response: OlumiResponse;
  telemetry: {
    stages_completed: string[];
    response_emitted: true; // invariant — always true
    llm_calls_used: number;
    commit_performed: boolean;
    failure_type: FailureTypeLiteral | null;
    wall_clock_ms: number;
    // `null` when classifier itself failed (schema violation / timeout /
    // abort); the actual C1TurnClass otherwise.
    turn_class: C1TurnClass | null;
  };
}

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

  const context = await buildTurnContext(payload, requestId);
  stagesCompleted.push('build_turn_context');

  // A2: `turn_class` is intentionally omitted from `started`. The classifier
  // hasn't run yet; the authoritative value lands on `completed`. Emitting a
  // provisional value here (e.g. 'direct_answer') would skew any metric that
  // aggregates `started` events by turn_class.
  emit(TelemetryEvents.TurnExecutorStarted, {
    request_id: requestId,
    session_id: context.session_id,
    stage: context.stage,
  });

  const turnAbort = new AbortController();
  const turnTimer = setTimeout(() => turnAbort.abort(), context.budgets.turn_ms);

  let response: OlumiResponse;
  // A2: `llmCallsUsed` accrues AS calls happen, not at dispatch success.
  // - Classifier success → incremented to 1 via `onClassified`.
  // - Narrate success → full dispatch result value (2) assigned after return.
  // - Narrate failure after successful classify → stays at 1 (classifier ran).
  // - Classifier failure → stays at 0 (no usable LLM call completed).
  let llmCallsUsed = 0;
  let commitPerformed = false;
  let failureType: FailureTypeLiteral | null = null;
  // A2/C1: nullable until classifier resolves the actual turn class.
  // `completed` telemetry carries `null` in the rare case that classification
  // itself failed (schema violation / timeout / abort). Downstream consumers
  // can distinguish "class unknown" from a specific class cleanly. Widened
  // to C1TurnClass in Slice C1 to accept the new 'handler' variant.
  let resolvedTurnClass: C1TurnClass | null = null;

  try {
    let dispatchResult: DispatchResult;
    try {
      dispatchResult = await dispatch(context, {
        signal: turnAbort.signal,
        // Slice C1: payload passed through so dispatchHandler can forward it
        // to registered handlers via HandlerInvocation. C1's empty registry
        // means no handler actually reads it, but the contract is kept
        // stable for C2.
        payload,
        // A2: capture classifier outcome even if narrate later throws — so
        // `turn_executor.completed` telemetry reports the true resolved class
        // and `llm_calls_used` reflects that the classifier call DID happen.
        // Slice C1: onClassified now also receives the resolved handler_id
        // when turn_class === 'handler'. Stored on the closure if telemetry
        // ever wants to surface it (not currently emitted on started).
        onClassified: (cls) => {
          resolvedTurnClass = cls;
          llmCallsUsed = 1;
          stagesCompleted.push('classify');
        },
      });
      llmCallsUsed = dispatchResult.llm_calls_used;
      resolvedTurnClass = dispatchResult.turn_class;
      stagesCompleted.push('dispatch');
    } catch (error) {
      // Timeout precedence (Paul's constraint 7): if the outer wall-clock
      // abort fired, classify as BUDGET_EXCEEDED regardless of whether an
      // inner adapter saw its own timeout.
      if (turnAbort.signal.aborted) {
        failureType = INTERNAL_TO_WIRE.BUDGET_EXCEEDED;
        response = buildFailureResponse('BUDGET_EXCEEDED', context.stage, {
          budget_ms: context.budgets.turn_ms,
        });
        return finalizeRun();
      }
      if (error instanceof NarrateTimeoutError) {
        // Preserve phase attribution (correction): classify vs narrate.
        // Wire code is shared (LLM_TIMEOUT → UPSTREAM_TIMEOUT); only the
        // failure-envelope `details.phase` and telemetry differ.
        failureType = INTERNAL_TO_WIRE.LLM_TIMEOUT;
        response = buildFailureResponse('LLM_TIMEOUT', context.stage, {
          phase: error.phase,
        });
        return finalizeRun();
      }
      if (error instanceof ClassifierSchemaViolationError) {
        // Paul's correction 3: classifier parse failure is a recoverable LLM
        // fault (mirrors narrate-mode failures). Not UNHANDLED.
        log.warn(
          { request_id: requestId, kind: error.kind, message: error.message },
          'V5 TurnExecutor classifier schema violation',
        );
        failureType = INTERNAL_TO_WIRE.LLM_SCHEMA_VIOLATION;
        response = buildFailureResponse('LLM_SCHEMA_VIOLATION', context.stage, {
          phase: 'classify',
        });
        return finalizeRun();
      }
      if (error instanceof NarrateEmptyOutputError) {
        failureType = INTERNAL_TO_WIRE.UNHANDLED;
        response = buildFailureResponse('UNHANDLED', context.stage, {
          reason: 'empty_narrate_output',
        });
        return finalizeRun();
      }
      if (error instanceof UnhandledTurnClassError) {
        // Paul's constraint 1: any non-A2TurnClass class → UNHANDLED P0.
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
    // Only A2 branches carry sanitised output (handler outcomes bypass the
    // narrate sanitiser). Slice C1: handler path is unreachable here because
    // dispatch throws before returning a handler DispatchResult — kept in the
    // narrow for C2 forward-compat.
    if (dispatchResult.turn_class !== 'handler' && dispatchResult.sanitised.contamination_detected) {
      emit(TelemetryEvents.TurnExecutorContaminationNarrate, {
        request_id: requestId,
        raw_length: dispatchResult.raw_text_length,
        sanitised_length: dispatchResult.sanitised.output.length,
        turn_class: dispatchResult.turn_class,
      });
    }

    // Compose + commit. Either throwing means STATE_COMMIT_FAILED → INTERNAL_ERROR.
    try {
      let composed;
      let handlerIdForCommit: V5ActionType | null = null;
      let handlerFactsForCommit: readonly HandlerFact[] = [];

      if (dispatchResult.turn_class === 'handler') {
        // Slice C1: unreachable — registry miss throws UnhandledTurnClassError
        // in dispatch.ts before this returns. Slice C2 will compose against
        // HandlerOutcome.assistant_text. For C1 the branch exists to keep
        // the discriminated union exhaustive.
        composed = composeDirectAnswerResponse({
          assistant_text: dispatchResult.handler_outcome.assistant_text,
          stage: context.stage,
        });
        handlerIdForCommit = dispatchResult.handler_id;
        handlerFactsForCommit = dispatchResult.handler_outcome.handler_facts;
      } else if (dispatchResult.turn_class === 'clarify') {
        composed = composeClarifyResponse({
          assistant_text: dispatchResult.sanitised.output,
          stage: context.stage,
        });
      } else {
        // direct_answer
        composed = composeDirectAnswerResponse({
          assistant_text: dispatchResult.sanitised.output,
          stage: context.stage,
        });
      }
      stagesCompleted.push('compose');

      // Slice B: commit persists through append_turn_atomic RPC. A throw here
      // (StateCommitFailedError, SUPABASE_* unset, unexpected) is caught
      // below and mapped to STATE_COMMIT_FAILED per the existing pattern
      // (turn-executor.ts:223-232). `commit_performed` stays false on throw
      // because this assignment is unreached. BI-01 holds: the finally
      // block's hardcoded `response_emitted: true` ensures every `started`
      // has a matching `completed`.
      const committed = await commitDirectAnswer(composed, {
        scenario_id: context.session_id,
        turn_id: context.request_id,
        turn_class: dispatchResult.turn_class,
        handler_id: handlerIdForCommit,
        request_hash: computeRequestHash(payload),
        llm_calls_used: llmCallsUsed,
        duration_ms: Date.now() - startedAt,
        handler_facts: handlerFactsForCommit,
      });
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
      turn_class: resolvedTurnClass,
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
        turn_class: resolvedTurnClass,
      },
    };
  }
}

function serialiseError(err: unknown): { name?: string; message?: string } {
  if (err instanceof Error) return { name: err.name, message: err.message };
  return { message: String(err) };
}

export type { InternalFailure } from './types.js';
