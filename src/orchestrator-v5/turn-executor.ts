/**
 * V5 TurnExecutor (Phase 1 — tool-use routing spine).
 *
 * Implements the seven-step assembly from V5 Architecture Spec v2 §4.1:
 *
 *   1. ORIENT    — assembleContextPack + routeWithToolUse → RoutingResult
 *                  (tool_call proposal or text_only response)
 *   2. VALIDATE  — validateToolCall on execute-intent proposals
 *                  (skipped when graph state is not threaded — Phase 1a gap)
 *   3. EXECUTE   — handler dispatch via the existing HandlerRegistry
 *                  (contract unchanged: HandlerInvocation → HandlerOutcome)
 *   4. CONFIRM   — deterministic confirmation text via the handler's
 *                  registered confirmationTemplate (brief correction 5)
 *   5. COACH     — null stub (no coaching logic in Phase 1a; classification
 *                  is preserved for Phase 2 evaluation)
 *   6. COMPOSE   — composeToolCallResponse / composeDirectAnswerResponse /
 *                  composeClarifyResponse / buildFailureResponse
 *   7. COMMIT    — commitDirectAnswer via append_turn_atomic (unchanged)
 *
 * Intent-class translation (spec §5 → existing C1TurnClass):
 *   - execute  → handler
 *   - clarify  → clarify
 *   - converse → direct_answer  (inferred on text_only routing result)
 *   - coach    → direct_answer  (DISTINCT code path from converse; records
 *                                intent_class="coach" and optional
 *                                coaching_mode for Phase 2 evaluation)
 *
 * Exactly-one-response invariant (BI-01): the top-level try/finally
 * guarantees every `turn_executor.started` telemetry event has a matching
 * `.completed` with `response_emitted=true`. No exceptions escape this
 * function.
 *
 * Budget enforcement: TurnExecutor owns an outer wall-clock AbortSignal
 * with `budgets.turn_ms`. The routing call and handler invocations all
 * listen to it. Paul's constraint 7 (BUDGET_EXCEEDED wins over inner
 * timeouts) is preserved.
 */

import type {
  OrchestratorTurnPayload,
  OlumiResponse,
  FailureTypeLiteral,
} from '@talchain/schemas/boundary';
import type { HandlerFact, V5ActionType } from '@talchain/schemas/orchestrator';

import { emit, TelemetryEvents, log } from '../utils/telemetry.js';
import {
  composeDirectAnswerResponse,
  composeClarifyResponse,
  composeToolCallResponse,
} from './compose.js';
import { commitDirectAnswer, computeRequestHash } from './commit.js';
import { buildTurnContext } from './build-turn-context.js';
import { buildFailureResponse } from './failure-response.js';
import {
  HandlerInvocationFailedError,
  HandlerResultInvalidError,
} from './tools/handler-errors.js';
import {
  getDefaultRegistry,
  resolveHandler,
  type HandlerOutcome,
  type HandlerRegistry,
} from './tools/registry.js';
import { sanitiseNarrateOutput } from './sanitise.js';
import { INTERNAL_TO_WIRE, UnhandledTurnClassError, type C1TurnClass } from './types.js';

import { assembleContextPack } from './context/context-pack-assembler.js';
import {
  RoutingError,
  routeWithToolUse,
  type RoutingResult,
} from './routing/route-with-tool-use.js';
import {
  validateToolCall,
  type GraphLookup,
  type HandlerValidationRegistry,
  type ValidationError,
} from './routing/validator.js';
import { HANDLER_VALIDATION_REGISTRY } from './routing/validation-registry.js';
import type {
  CoachingMode,
  IntentClass,
} from './routing/types.js';

export interface TurnExecutorRunResult {
  response: OlumiResponse;
  telemetry: {
    stages_completed: string[];
    response_emitted: true;
    llm_calls_used: number;
    commit_performed: boolean;
    failure_type: FailureTypeLiteral | null;
    wall_clock_ms: number;
    turn_class: C1TurnClass | null;
    /** Phase 1 addition: spec §5 IntentClass, or null on routing failure. */
    intent_class: IntentClass | null;
    /** Phase 1 addition: spec §5 CoachingMode, or null when not coach / not provided. */
    coaching_mode: CoachingMode | null;
    /** Phase 1 addition: typed validation error code when VALIDATE failed. */
    validation_error_code: ValidationError['code'] | null;
  };
}

export interface RunTurnExecutorOptions {
  /**
   * Injected routing adapter. Tests pass a mock `{ chatWithTools }` adapter;
   * production omits and `routeWithToolUse` resolves via the LLM router.
   */
  readonly routingAdapter?: Parameters<typeof routeWithToolUse>[2]['adapter'];
  /** Injected handler registry (tests); production uses `getDefaultRegistry`. */
  readonly handlerRegistry?: HandlerRegistry;
  /** Injected validation registry (tests); production uses the default. */
  readonly validationRegistry?: HandlerValidationRegistry;
  /**
   * Optional graph lookup. When undefined, VALIDATE skips entity-existence +
   * Dice suspicion checks and emits a telemetry warning. Phase 1a: graph
   * state is not yet threaded through the V5 payload, so production has no
   * lookup and validation is skipped.
   */
  readonly graphLookup?: GraphLookup;
}

/**
 * Run a single V5 turn end-to-end. Always returns a well-formed
 * OlumiResponse; internal runtime failures map to a typed response with an
 * ErrorBlock — never thrown past this function.
 */
export async function runTurnExecutor(
  payload: OrchestratorTurnPayload,
  requestId: string,
  options: RunTurnExecutorOptions = {},
): Promise<TurnExecutorRunResult> {
  const startedAt = Date.now();
  const stagesCompleted: string[] = [];

  const context = await buildTurnContext(payload, requestId);
  stagesCompleted.push('build_turn_context');

  emit(TelemetryEvents.TurnExecutorStarted, {
    request_id: requestId,
    session_id: context.session_id,
    stage: context.stage,
  });

  const turnAbort = new AbortController();
  const turnTimer = setTimeout(() => turnAbort.abort(), context.budgets.turn_ms);

  let response: OlumiResponse;
  let llmCallsUsed = 0;
  let commitPerformed = false;
  let failureType: FailureTypeLiteral | null = null;
  let resolvedTurnClass: C1TurnClass | null = null;
  let intentClass: IntentClass | null = null;
  let coachingMode: CoachingMode | null = null;
  let validationErrorCode: ValidationError['code'] | null = null;

  try {
    // ==================================================================
    // STEP 1 — ORIENT
    // ==================================================================
    let routingResult: RoutingResult;
    try {
      const contextPack = assembleContextPack({
        payload,
        priorTurns: context.prior_turns,
      });
      routingResult = await routeWithToolUse(contextPack, payload.message, {
        requestId,
        signal: turnAbort.signal,
        adapter: options.routingAdapter,
      });
      // Account for actual routing-call count (1 on first-pass success,
      // 2 when REPAIR_ONCE used). The router knows; we trust its count.
      llmCallsUsed = routingResult.llmCallCount;
      stagesCompleted.push('orient');
    } catch (error) {
      if (turnAbort.signal.aborted) {
        failureType = INTERNAL_TO_WIRE.BUDGET_EXCEEDED;
        response = buildFailureResponse('BUDGET_EXCEEDED', context.stage, {
          budget_ms: context.budgets.turn_ms,
        });
        return finalizeRun();
      }
      if (error instanceof RoutingError) {
        return translateRoutingError(error);
      }
      log.error(
        { request_id: requestId, err: serialiseError(error) },
        'V5 TurnExecutor orient step failed with unexpected error',
      );
      failureType = INTERNAL_TO_WIRE.UNHANDLED;
      response = buildFailureResponse('UNHANDLED', context.stage, {
        reason: 'unexpected_routing_error',
      });
      return finalizeRun();
    }

    // Translate RoutingResult → resolved turn_class / intent_class.
    const routingSummary = summariseRouting(routingResult);
    resolvedTurnClass = routingSummary.turnClass;
    intentClass = routingSummary.intentClass;
    coachingMode = routingSummary.coachingMode;

    // Buckets for the remaining steps. Populated conditionally per intent.
    let handlerOutcome: HandlerOutcome | null = null;
    let handlerIdForCommit: V5ActionType | null = null;
    let handlerFactsForCommit: readonly HandlerFact[] = [];
    let composedOk: OlumiResponse | null = null;

    // ==================================================================
    // STEPS 2–4: execute-intent path (VALIDATE → EXECUTE → CONFIRM)
    // ==================================================================
    if (routingResult.type === 'tool_call' && routingResult.proposal.intent_class === 'execute') {
      const action = routingResult.proposal.action;
      const proposedHandlerId = action.handler_id as V5ActionType;

      // STEP 2 — VALIDATE. Skipped when no graph lookup is available
      // (Phase 1a gap: graph state not threaded through V5 payload).
      if (options.graphLookup) {
        const validationRegistry = options.validationRegistry ?? HANDLER_VALIDATION_REGISTRY;
        const validationResult = validateToolCall(action, options.graphLookup, validationRegistry);
        stagesCompleted.push('validate');
        if (!validationResult.valid) {
          validationErrorCode = validationResult.error.code;
          log.warn(
            {
              request_id: requestId,
              validation_error_code: validationResult.error.code,
              details: validationResult.error.details,
            },
            'V5 TurnExecutor validation rejected tool-call proposal',
          );
          failureType = INTERNAL_TO_WIRE.HANDLER_INVOCATION_FAILED;
          response = buildFailureResponse('HANDLER_INVOCATION_FAILED', context.stage, {
            cause_kind: 'validation_failed',
            validation_error_code: validationResult.error.code,
            ...(validationResult.error.details ?? {}),
          });
          return finalizeRun();
        }
      } else {
        log.warn(
          { request_id: requestId, handler_id: proposedHandlerId },
          'V5 TurnExecutor validate step skipped — graph state not threaded through payload',
        );
        stagesCompleted.push('validate_skipped');
      }

      // STEP 3 — EXECUTE. Reuse the existing handler registry; contract is
      // unchanged (HandlerInvocation → HandlerOutcome).
      try {
        const registry = options.handlerRegistry ?? getDefaultRegistry();
        const handlerFn = resolveHandler(registry, proposedHandlerId);
        if (!handlerFn) {
          throw new UnhandledTurnClassError('handler_not_registered', proposedHandlerId);
        }
        handlerOutcome = await handlerFn({
          context,
          payload,
          requestId,
          signal: turnAbort.signal,
        });
        llmCallsUsed += handlerOutcome.llm_calls_used;
        stagesCompleted.push('execute');
        handlerIdForCommit = proposedHandlerId;
        handlerFactsForCommit = handlerOutcome.handler_facts;
      } catch (error) {
        return translateExecuteError(error);
      }

      // STEP 4 — CONFIRM. Typed-per-handler per brief correction 5.
      const confirmationText = renderConfirmation(proposedHandlerId, handlerOutcome, options);
      stagesCompleted.push('confirm');

      // STEP 5 — COACH. Null stub on execute turns. coaching_mode is never
      // set on execute turns per spec §5.

      // STEP 6 — COMPOSE (execute). Orientation is sanitised in-band like
      // the converse/clarify/coach paths — Sonnet's pre-action text could
      // carry contamination (tags, em-dashes) and must be cleaned before it
      // joins the composed assistant_text.
      const sanitisedOrientation = sanitiseNarrateOutput(routingResult.orientationText);
      if (sanitisedOrientation.contamination_detected) {
        emit(TelemetryEvents.TurnExecutorContaminationNarrate, {
          request_id: requestId,
          raw_length: routingResult.orientationText.length,
          sanitised_length: sanitisedOrientation.output.length,
          turn_class: 'handler',
        });
      }
      composedOk = composeToolCallResponse({
        orientation: sanitisedOrientation.output,
        confirmation: confirmationText,
        coaching: null,
        stage: context.stage,
      });
      stagesCompleted.push('compose');
    } else if (
      routingResult.type === 'tool_call' &&
      routingResult.proposal.intent_class === 'clarify'
    ) {
      // Clarify intent — use the clarification question as the assistant text.
      // Run it through the narrate sanitiser for consistency with the existing
      // A2 clarify path (Paul's BI-02: contamination handled in-band).
      const candidateText =
        routingResult.orientationText ||
        routingResult.proposal.clarification.question;
      const sanitised = sanitiseNarrateOutput(candidateText);
      if (sanitised.contamination_detected) {
        emit(TelemetryEvents.TurnExecutorContaminationNarrate, {
          request_id: requestId,
          raw_length: candidateText.length,
          sanitised_length: sanitised.output.length,
          turn_class: 'clarify',
        });
      }
      composedOk = composeClarifyResponse({
        assistant_text: sanitised.output,
        stage: context.stage,
      });
      stagesCompleted.push('compose');
    } else if (
      routingResult.type === 'tool_call' &&
      routingResult.proposal.intent_class === 'coach'
    ) {
      // Distinct coach path — brief correction 2:
      //   (a) use the text response as the user-facing output (same as converse)
      //   (b) log intent_class="coach" distinctly
      //   (c) set coaching_mode on turn metadata
      // Runtime behaviour matches direct_answer compose; classification is
      // preserved so Phase 2 can evaluate coaching-mode accuracy against the GTX.
      const sanitised = sanitiseNarrateOutput(routingResult.orientationText);
      if (sanitised.contamination_detected) {
        emit(TelemetryEvents.TurnExecutorContaminationNarrate, {
          request_id: requestId,
          raw_length: routingResult.orientationText.length,
          sanitised_length: sanitised.output.length,
          turn_class: 'direct_answer',
        });
      }
      composedOk = composeDirectAnswerResponse({
        assistant_text: sanitised.output,
        stage: context.stage,
      });
      stagesCompleted.push('compose');
    } else {
      // text_only → inferred converse.
      const text = routingResult.type === 'text_only' ? routingResult.text : '';
      const sanitised = sanitiseNarrateOutput(text);
      if (sanitised.contamination_detected) {
        emit(TelemetryEvents.TurnExecutorContaminationNarrate, {
          request_id: requestId,
          raw_length: text.length,
          sanitised_length: sanitised.output.length,
          turn_class: 'direct_answer',
        });
      }
      composedOk = composeDirectAnswerResponse({
        assistant_text: sanitised.output,
        stage: context.stage,
      });
      stagesCompleted.push('compose');
    }

    // ==================================================================
    // STEP 7 — COMMIT (unchanged contract)
    // ==================================================================
    try {
      const committed = await commitDirectAnswer(composedOk, {
        scenario_id: context.session_id,
        turn_id: context.request_id,
        turn_class: resolvedTurnClass ?? 'direct_answer',
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
        'V5 TurnExecutor commit failure',
      );
      failureType = INTERNAL_TO_WIRE.STATE_COMMIT_FAILED;
      response = buildFailureResponse('STATE_COMMIT_FAILED', context.stage, {
        phase: 'commit',
      });
      return finalizeRun();
    }
  } finally {
    clearTimeout(turnTimer);
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

  // ==================================================================
  // Helpers closured over mutable state
  // ==================================================================
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
        intent_class: intentClass,
        coaching_mode: coachingMode,
        validation_error_code: validationErrorCode,
      },
    };
  }

  function translateRoutingError(err: RoutingError): TurnExecutorRunResult {
    switch (err.cause) {
      case 'timeout':
        failureType = INTERNAL_TO_WIRE.LLM_TIMEOUT;
        response = buildFailureResponse('LLM_TIMEOUT', context.stage, { phase: 'orient' });
        return finalizeRun();
      case 'aborted':
        // aborted while outer signal hadn't fired yet — treat as orient-side
        // timeout rather than budget; the budget-win branch above already
        // handled the true outer-budget case.
        failureType = INTERNAL_TO_WIRE.LLM_TIMEOUT;
        response = buildFailureResponse('LLM_TIMEOUT', context.stage, { phase: 'orient' });
        return finalizeRun();
      case 'schema_repair_failed':
      case 'empty_response':
      case 'unexpected_stop_reason':
        failureType = INTERNAL_TO_WIRE.LLM_SCHEMA_VIOLATION;
        response = buildFailureResponse('LLM_SCHEMA_VIOLATION', context.stage, {
          phase: 'orient',
          routing_error_cause: err.cause,
        });
        return finalizeRun();
      case 'api_error':
        log.warn(
          { request_id: requestId, cause: err.cause, provider_message: err.provider_message },
          'V5 TurnExecutor routing api_error',
        );
        failureType = INTERNAL_TO_WIRE.LLM_SCHEMA_VIOLATION;
        response = buildFailureResponse('LLM_SCHEMA_VIOLATION', context.stage, {
          phase: 'orient',
          routing_error_cause: err.cause,
        });
        return finalizeRun();
    }
  }

  function translateExecuteError(error: unknown): TurnExecutorRunResult {
    if (turnAbort.signal.aborted) {
      failureType = INTERNAL_TO_WIRE.BUDGET_EXCEEDED;
      response = buildFailureResponse('BUDGET_EXCEEDED', context.stage, {
        budget_ms: context.budgets.turn_ms,
      });
      return finalizeRun();
    }
    if (error instanceof UnhandledTurnClassError) {
      log.error(
        { request_id: requestId, reason: error.reason, message: error.message },
        'V5 TurnExecutor handler not registered',
      );
      failureType = INTERNAL_TO_WIRE.UNHANDLED;
      response = buildFailureResponse('UNHANDLED', context.stage, {
        reason: 'handler_not_registered',
        handler_id: error.attempted,
      });
      return finalizeRun();
    }
    if (error instanceof HandlerInvocationFailedError) {
      log.warn(
        {
          request_id: requestId,
          kind: error.kind,
          cause_kind: error.cause_kind,
          message: error.message,
        },
        'V5 TurnExecutor handler invocation failed',
      );
      failureType = INTERNAL_TO_WIRE.HANDLER_INVOCATION_FAILED;
      response = buildFailureResponse('HANDLER_INVOCATION_FAILED', context.stage, {
        cause_kind: error.cause_kind,
      });
      return finalizeRun();
    }
    if (error instanceof HandlerResultInvalidError) {
      log.error(
        { request_id: requestId, kind: error.kind, message: error.message },
        'V5 TurnExecutor handler result invalid',
      );
      failureType = INTERNAL_TO_WIRE.HANDLER_RESULT_INVALID;
      response = buildFailureResponse('HANDLER_RESULT_INVALID', context.stage, {
        reason: 'fact_schema_violation',
      });
      return finalizeRun();
    }
    log.error(
      { request_id: requestId, err: serialiseError(error) },
      'V5 TurnExecutor execute step failed with unexpected error',
    );
    failureType = INTERNAL_TO_WIRE.UNHANDLED;
    response = buildFailureResponse('UNHANDLED', context.stage, {
      reason: 'unexpected_execute_error',
    });
    return finalizeRun();
  }
}

// -----------------------------------------------------------------------
// Small pure helpers
// -----------------------------------------------------------------------

function summariseRouting(result: RoutingResult): {
  turnClass: C1TurnClass;
  intentClass: IntentClass;
  coachingMode: CoachingMode | null;
} {
  if (result.type === 'text_only') {
    return { turnClass: 'direct_answer', intentClass: 'converse', coachingMode: null };
  }
  const intent = result.proposal.intent_class;
  if (intent === 'execute') {
    return { turnClass: 'handler', intentClass: 'execute', coachingMode: null };
  }
  if (intent === 'clarify') {
    return { turnClass: 'clarify', intentClass: 'clarify', coachingMode: null };
  }
  if (intent === 'coach') {
    return {
      turnClass: 'direct_answer',
      intentClass: 'coach',
      coachingMode: result.proposal.coaching_mode ?? null,
    };
  }
  // converse via tool call — same as text_only runtime path
  return { turnClass: 'direct_answer', intentClass: 'converse', coachingMode: null };
}

function renderConfirmation(
  handlerId: V5ActionType,
  outcome: HandlerOutcome,
  options: RunTurnExecutorOptions,
): string {
  const registry = options.validationRegistry ?? HANDLER_VALIDATION_REGISTRY;
  const decl = registry[handlerId];
  if (!decl) return outcome.assistant_text;
  const tmpl = decl.confirmation_template;
  if (typeof tmpl === 'function') return tmpl(outcome);
  return tmpl;
}

function serialiseError(err: unknown): { name?: string; message?: string } {
  if (err instanceof Error) return { name: err.name, message: err.message };
  return { message: String(err) };
}

export type { InternalFailure } from './types.js';
