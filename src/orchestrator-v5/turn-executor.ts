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
  MessageTurnPayload,
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
import { buildTurnContext, loadPersistedGraph } from './build-turn-context.js';
import { buildFailureResponse } from './failure-response.js';
import { composeValidationFailure } from './compose/validation-failure-responses.js';
import { composeUnsupportedActionResponse } from './compose/unsupported-action-response.js';
import { composeHandlerFailure } from './compose/handler-failure-responses.js';
import type { ComposeContext } from './compose/types.js';
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
import { generateChips } from './compose/chip-generator.js';
import { INTERNAL_TO_WIRE, UnhandledTurnClassError, type C1TurnClass } from './types.js';


import { readCoachingCache } from './coaching/coaching-cache-reader.js';
import { enrichRunAnalysisWithDecisionReview } from './coaching/decision-review-enricher.js';
import { appendLastCoachingSignal } from './coaching/last-coaching-signal-log.js';
import type { CoachingSignalId } from './coaching/types.js';
import { detectCoachingSignal } from './signals/coaching-signals.js';
import {
  assembleContextPackWithSummary,
  type ContextPack,
} from './context/context-pack-assembler.js';
import { compactGraphForContextPack } from './context/compact-graph-for-contextpack.js';
import {
  buildAnalysisFromPriorFacts,
  FALLBACK_STALENESS_REASON,
} from './context/analysis-fallback.js';
import type { CqeExtractionSummary } from './context/cqe/extract-quantities.js';
import { computeDeterministicGraphHash } from './context/graph-hash.js';
import {
  ROUTING_SYSTEM_PROMPT,
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
import {
  buildGraphLookup,
  type GraphLookupStats,
} from './routing/graph-lookup-adapter.js';
import { HANDLER_VALIDATION_REGISTRY } from './routing/validation-registry.js';
import {
  GraphStateIngressSchema,
  type GraphStateIngress,
  type AnalysisStateIngress,
} from './boundary/request-extensions.js';
import type { V2RunResponseEnvelope } from '../orchestrator/types.js';
import {
  compactAnalysis,
  type AnalysisResponseSummary,
} from '../orchestrator/context/analysis-compact.js';
import {
  buildRoutingLog,
  writeRoutingLog,
  type RoutingLog,
} from './routing/routing-log.js';
import type {
  CoachingMode,
  IntentClass,
  ResolutionStatus,
} from './routing/types.js';
import { storeTurnDebug } from './debug/turn-debug-store.js';

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
   * Phase 1.5: graph content from the HTTP request body (Zod-parsed ingress
   * shape — permissive content, not the full CEE response envelope). When
   * provided, populates ContextPack.graph and drives a derived GraphLookup
   * for VALIDATE. Absent / null on frame-stage turns and non-UI callers.
   */
  readonly graphState?: GraphStateIngress | null;
  /**
   * Phase 1.5: analysis envelope from the HTTP request body (Zod-parsed
   * ingress shape — permissive; only `analysis_status` is structurally
   * required). When provided, populates ContextPack.analysis via
   * compactAnalysis(). Absent / null on pre-analysis decisions.
   */
  readonly analysisState?: AnalysisStateIngress | null;
  /**
   * Optional graph lookup override — tests pass a mock to exercise validator
   * paths without threading a full GraphV3T. Production derives this from
   * `graphState` via buildGraphLookup(); when both are present, the explicit
   * lookup wins (test ergonomics).
   */
  readonly graphLookup?: GraphLookup;
  /**
   * Routing-log writer override. Tests pass a `vi.fn()` to capture records
   * without touching the filesystem; production omits and the default
   * file-append writer (logs/v5-routing-logs.jsonl) is used.
   */
  readonly routingLogWriter?: (record: RoutingLog) => Promise<void>;
  /**
   * Privacy override for the routing log. When true, raw_user_message is
   * dropped and sonnet_text is hashed. Defaults to false in this PoC.
   */
  readonly routingLogRedacted?: boolean;
  /**
   * V5 Group 1 Task B: scenario brief text, supplied by the route when
   * the decision_review auto-fire should have a brief available. Passed
   * to the decision-review enricher without ever touching the run_analysis
   * handler fact's enrichment (F.6 / handler-ownership invariant).
   * When null/absent, the enricher skips with reason `no_brief`.
   */
  readonly scenarioBrief?: string | null;
}

/**
 * Run a single V5 turn end-to-end. Always returns a well-formed
 * OlumiResponse; internal runtime failures map to a typed response with an
 * ErrorBlock — never thrown past this function.
 */
// v0.7.0 schema: `OrchestratorTurnPayload` is a discriminated union on `kind`.
// `runTurnExecutor` only ever sees `kind: 'message'` payloads — `route-v2.ts`
// catches `kind: 'system_event'` in a deterministic pre-TurnExecutor branch
// (they have no `message` field and do not need LLM routing). Typed as
// `MessageTurnPayload` to make the invariant visible at compile time.
export async function runTurnExecutor(
  payload: MessageTurnPayload,
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
  let coachingSignalId: CoachingSignalId | null = null;
  let validationErrorCode: ValidationError['code'] | null = null;

  // Routing log fields — closured so the finally block can emit one record
  // per turn regardless of which terminal path fires (success / typed
  // failure / unexpected error).
  let routingErrorCause: string | null = null;
  let resolutionStatus: ResolutionStatus | null = null;
  let proposedHandlerIdForLog: string | null = null;
  let sonnetTextForLog = '';
  let contextPackForLog: ContextPack | null = null;
  let cqeSummaryForLog: CqeExtractionSummary | null = null;

  // Phase 1.5: graph lookup + drift detection. Initialised inside the try
  // block so any failure during telemetry emit still lands in the top-level
  // finally — preserves BI-01 (every started → matching completed).
  let graphLookupForValidate: GraphLookup | undefined;
  let graphLookupStatsForLog: GraphLookupStats | undefined;
  let graphLookupBuildReason: 'test_override' | 'no_graph' | 'ok' | 'all_dropped' =
    'no_graph';
  let graphStateForTurn: GraphStateIngress | null = options.graphState ?? null;

  try {
    // Derive GraphLookup from the ingress payload. A payload-drift situation
    // (nodes present but none mappable) fails the turn fast, before we
    // spend LLM tokens on a graph we cannot safely validate against. Tests
    // can pre-supply options.graphLookup to bypass the adapter entirely.
    if (options.graphLookup) {
      graphLookupForValidate = options.graphLookup;
      graphLookupBuildReason = 'test_override';
      emit(TelemetryEvents.TurnExecutorGraphLookup, {
        request_id: requestId,
        outcome: 'test_override',
        total_nodes: 0,
        mapped_nodes: 0,
        dropped_by_unknown_kind: 0,
        dropped_by_missing_id: 0,
      });
    } else {
      // Fallback: when graphState is absent (follow-up turns), load the
      // persisted graph via build-turn-context (the declared session access
      // boundary). Errors are absorbed there; null means no graph available.
      if (!graphStateForTurn) {
        const persistedGraph = await loadPersistedGraph(payload.scenario_id, requestId);
        if (persistedGraph) {
          const parsed = GraphStateIngressSchema.safeParse(persistedGraph);
          if (parsed.success) {
            graphStateForTurn = parsed.data;
            log.info(
              { request_id: requestId, scenario_id: payload.scenario_id },
              'V5 TurnExecutor loaded persisted graph from database for graph lookup fallback',
            );
          } else {
            log.warn(
              { request_id: requestId, scenario_id: payload.scenario_id, issues: parsed.error.issues },
              'V5 TurnExecutor persisted graph failed ingress schema validation, falling back to no_graph',
            );
          }
        }
      }

      const adapterResult = buildGraphLookup(graphStateForTurn);
      graphLookupBuildReason = adapterResult.kind;
      if (adapterResult.kind === 'ok') {
        graphLookupForValidate = adapterResult.lookup;
        graphLookupStatsForLog = adapterResult.stats;
        emit(TelemetryEvents.TurnExecutorGraphLookup, {
          request_id: requestId,
          outcome: 'ok',
          ...adapterResult.stats,
        });
      } else if (adapterResult.kind === 'all_dropped') {
        graphLookupStatsForLog = adapterResult.stats;
        emit(TelemetryEvents.TurnExecutorGraphLookup, {
          request_id: requestId,
          outcome: 'all_dropped',
          ...adapterResult.stats,
        });
      } else {
        emit(TelemetryEvents.TurnExecutorGraphLookup, {
          request_id: requestId,
          outcome: 'no_graph',
          total_nodes: 0,
          mapped_nodes: 0,
          dropped_by_unknown_kind: 0,
          dropped_by_missing_id: 0,
        });
      }
    }

    // Hard-fail on payload drift: nodes were present but NONE mapped to a
    // known kind. Bypassing graph-dependent validation in this case would
    // silently degrade the safety envelope — reject the turn instead.
    if (graphLookupBuildReason === 'all_dropped' && graphLookupStatsForLog) {
      log.error(
        {
          request_id: requestId,
          stats: graphLookupStatsForLog,
        },
        'V5 TurnExecutor graph payload drift — all nodes dropped by adapter, failing turn',
      );
      failureType = INTERNAL_TO_WIRE.UNHANDLED;
      response = buildFailureResponse('UNHANDLED', context.stage, {
        reason: 'graph_payload_drift',
        total_nodes: graphLookupStatsForLog.total_nodes,
        dropped_by_unknown_kind: graphLookupStatsForLog.dropped_by_unknown_kind,
        dropped_by_missing_id: graphLookupStatsForLog.dropped_by_missing_id,
      });
      return finalizeRun();
    }

    // ==================================================================
    // STEP 1 — ORIENT
    // ==================================================================
    let routingResult: RoutingResult;
    // Phase 1.5: compile analysis summary once per turn. compactAnalysis is
    // the existing V4 utility that projects V2RunResponseEnvelope →
    // AnalysisResponseSummary. AnalysisStateIngress is a structural subset
    // (only analysis_status is required; everything else passthrough).
    // coerceIngressAnalysis fills the minimal fields compactAnalysis expects
    // before calling it; compactAnalysis is defensive on missing sub-fields.
    // V5 Task 1.4: when the UI does not send analysis_state on a follow-up
    // turn, fall back to projecting the most recent non-noop run_analysis
    // handler fact. The fallback is flagged unknown-freshness so the
    // routing prompt can treat it as reference material rather than fresh
    // output. prior_facts is already loaded by buildTurnContext — no new
    // DB call.
    let analysisSummary: AnalysisResponseSummary | null = null;
    let analysisStalenessReason: string | null = null;
    let analysisStateSource: 'request' | 'fallback' | 'absent' = 'absent';
    if (options.analysisState) {
      analysisSummary = compactAnalysis(coerceIngressAnalysis(options.analysisState));
      analysisStateSource = 'request';
    } else {
      const fallback = buildAnalysisFromPriorFacts(context.prior_facts);
      if (fallback) {
        analysisSummary = fallback;
        analysisStalenessReason = FALLBACK_STALENESS_REASON;
        analysisStateSource = 'fallback';
      }
    }
    try {
      const coachingCache = await readCoachingCache(
        context.session_id,
        context.prior_facts,
      );
      // V5 Task 1.2: compact the graph before handing it to Sonnet. Full graph
      // stays on graphLookupForValidate for validation; only the Sonnet-facing
      // ContextPack uses the compact projection. `absent` falls through to the
      // assembler's empty-graph branch — Sonnet sees ContextPack.graph empty,
      // same as when the turn genuinely has no graph.
      const compactOutcome = compactGraphForContextPack(graphStateForTurn, {
        requestId,
      });
      const compactedGraph =
        compactOutcome.kind === 'compacted' ? compactOutcome.compact : null;
      const { contextPack, cqeSummary } = assembleContextPackWithSummary({
        payload,
        priorTurns: context.prior_turns,
        graph: compactedGraph ? undefined : graphStateForTurn,
        compactedGraph,
        analysis: analysisSummary,
        analysisStalenessReason,
        coaching: coachingCache,
      });
      cqeSummaryForLog = cqeSummary;
      emit(TelemetryEvents.CqeExtraction, {
        request_id: requestId,
        session_id: context.session_id,
        stage: context.stage,
        ...cqeSummary,
      });
      contextPackForLog = contextPack;

      // V5 Task 3.2: observability — one debug log per turn after ContextPack
      // assembly. Fields confirm context + compose changes are active in
      // production without adding noise to production error/warn streams.
      // Chip count is logged separately at compose time (implicit via the
      // response payload size; audited from Supabase if required).
      log.debug(
        {
          request_id: requestId,
          session_id: context.session_id,
          system_chars: ROUTING_SYSTEM_PROMPT.length,
          context_pack_chars: JSON.stringify(contextPack).length,
          conversation_history_turns: contextPack.conversation.recent_turns.length,
          graph_compacted: compactOutcome.kind === 'compacted',
          graph_compact_via:
            compactOutcome.kind === 'compacted' ? compactOutcome.via : null,
          analysis_state_source: analysisStateSource,
          analysis_staleness_reason: analysisStalenessReason,
        },
        'V5 TurnExecutor context pack assembled',
      );
      storeTurnDebug({
        turn_id: requestId,
        session_id: context.session_id,
        stored_at: Date.now(),
        cqe: {
          parsed_quantities: contextPack.parsed_quantities,
          patterns_matched: cqeSummary.patterns_matched,
          timeout: cqeSummary.timeout,
          compromise_match_count: cqeSummary.compromise_match_count,
          duration_ms: cqeSummary.duration_ms,
          message_too_long: cqeSummary.message_too_long,
          word_range_missed: cqeSummary.word_range_missed,
        },
      });
      routingResult = await routeWithToolUse(contextPack, payload.message, {
        requestId,
        sessionId: context.session_id,
        signal: turnAbort.signal,
        adapter: options.routingAdapter,
      });
      // Account for actual routing-call count (1 on first-pass success,
      // 2 when REPAIR_ONCE used). The router knows; we trust its count.
      llmCallsUsed = routingResult.llmCallCount;
      sonnetTextForLog =
        routingResult.type === 'tool_call' ? routingResult.orientationText : routingResult.text;
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
        // Pull the actual call count off the typed error so failure
        // telemetry / routing-log records reflect attempts (1 on first-call
        // failure, 2 on schema_repair_failed). Without this the failure
        // path under-reports llm_calls_used as 0.
        llmCallsUsed = error.llmCallCount;
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
      resolutionStatus = action.entity.resolution_status;
      proposedHandlerIdForLog = action.handler_id;

      // STEP 2 — VALIDATE. Structural checks (handler existence, resolution
      // status, kind, parameter bounds) ALWAYS run. Graph-dependent checks
      // (entity existence, Dice suspicion, preconditions) activate when the
      // pre-derived graphLookupForValidate is non-undefined (ok or
      // test_override). The all_dropped case already failed the turn
      // before the routing call.
      //
      // Telemetry semantics (Phase 1.5):
      //   • validate_skipped_no_graph — INTENTIONAL skip on frame-stage turns
      //     or non-UI callers that legitimately have no graph yet.
      //   • validate_skipped_graph_checks — the Phase 1a leak; absent from
      //     production code after Phase 1.5. Guarded by invariant script.
      const validationRegistry = options.validationRegistry ?? HANDLER_VALIDATION_REGISTRY;
      const validationResult = validateToolCall(
        action,
        graphLookupForValidate,
        validationRegistry,
      );
      stagesCompleted.push('validate');
      if (!graphLookupForValidate) {
        stagesCompleted.push('validate_skipped_no_graph');
        log.info(
          { request_id: requestId, handler_id: proposedHandlerId, stage: context.stage },
          'V5 TurnExecutor graph-dependent validation skipped — no graph on this turn',
        );
      }
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
        const composeCtx: ComposeContext = {
          graph: graphLookupForValidate,
          handlerRegistry: validationRegistry,
        };
        // V5 golden-path completion: HANDLER_NOT_FOUND is the "not yet
        // available" case — routing proposed a sensible action this
        // deployment hasn't implemented. Return a 200 coaching response
        // (clean body, no error block) committed as a direct_answer turn,
        // rather than a 500 BoundaryError that surfaces "Something went
        // wrong" in the UI. All other validator codes still go through
        // the existing error-block composer + 500 path.
        if (validationResult.error.code === 'HANDLER_NOT_FOUND') {
          const unsupported = composeUnsupportedActionResponse({
            handlerId: action.handler_id,
            context: composeCtx,
            stage: context.stage,
            hasAnalysis: options.analysisState != null,
          });
          response = unsupported.response;
          resolvedTurnClass = 'direct_answer';
          intentClass = 'converse';
          stagesCompleted.push('unsupported_action_fallback');
          // chip_type reflects what the composer actually emitted: 'action'
          // when the registry had a user-facing handler to point at,
          // 'text_prompt' when we fell back to a free-text chip.
          const chipType: 'action' | 'text_prompt' =
            unsupported.response.suggested_actions.some((c) => c.action_type != null)
              ? 'action'
              : 'text_prompt';
          emit(TelemetryEvents.TurnExecutorFailureResponse, {
            request_id: requestId,
            session_id: context.session_id,
            stage: context.stage,
            failure_origin: 'validator',
            error_code: validationResult.error.code,
            template_used: unsupported.templateId,
            chip_attached: unsupported.response.suggested_actions.length > 0,
            chip_type: chipType,
            chip_count: unsupported.response.suggested_actions.length,
          });
          // Commit as a direct_answer so route-v2 sees commit_performed=true
          // and returns 200 — not 500. Commit failures still fall through
          // to the typed STATE_COMMIT_FAILED path (which returns 500, a
          // real infrastructure fault, distinct from the graceful fallback).
          try {
            const committed = await commitDirectAnswer(response, {
              scenario_id: context.session_id,
              turn_id: context.request_id,
              turn_class: 'direct_answer',
              handler_id: null,
              request_hash: computeRequestHash(payload),
              llm_calls_used: llmCallsUsed,
              duration_ms: Date.now() - startedAt,
              handler_facts: [],
            });
            commitPerformed = committed.performed;
            stagesCompleted.push('commit');
            response = committed.response;
          } catch (error) {
            log.error(
              { request_id: requestId, err: serialiseError(error) },
              'V5 TurnExecutor commit failure on unsupported-action fallback',
            );
            failureType = INTERNAL_TO_WIRE.STATE_COMMIT_FAILED;
            response = buildFailureResponse('STATE_COMMIT_FAILED', context.stage, {
              phase: 'commit',
            });
          }
          return finalizeRun();
        }
        failureType = INTERNAL_TO_WIRE.HANDLER_INVOCATION_FAILED;
        const composed = composeValidationFailure(
          validationResult.error,
          composeCtx,
          context.stage,
        );
        response = composed.response;
        emit(TelemetryEvents.TurnExecutorFailureResponse, {
          request_id: requestId,
          session_id: context.session_id,
          stage: context.stage,
          failure_origin: 'validator',
          error_code: validationResult.error.code,
          template_used: composed.template_id,
          chip_attached: composed.response.suggested_actions.length > 0,
          chip_type: composed.chip_type,
          chip_count: composed.response.suggested_actions.length,
        });
        return finalizeRun();
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

      // V5 Group 1 Task B — decision_review auto-fire after run_analysis.
      // Non-blocking: enricher never throws, degrades to thin content on
      // timeout/failure. Hard 15s timeout inside the enricher; outer
      // turn-budget signal still wins when it fires first.
      if (proposedHandlerId === 'run_analysis') {
        handlerFactsForCommit = await enrichRunAnalysisWithDecisionReview({
          handlerFacts: handlerOutcome.handler_facts,
          requestId,
          scenarioId: context.session_id,
          signal: turnAbort.signal,
          brief: options.scenarioBrief ?? null,
        });
      }

      // STEP 4 — CONFIRM. Typed-per-handler per brief correction 5.
      const confirmationText = renderConfirmation(proposedHandlerId, handlerOutcome, options);
      stagesCompleted.push('confirm');

      // STEP 5 — COACH (V5 Group 1 Task C). Deterministic signal detector.
      // At most one signal per action turn. Non-action intents (clarify,
      // coach, converse) never reach this branch. coaching_mode is set by
      // routing; Step 5 emits coaching_signal_id which is distinct.
      // contextPackForLog is always assigned by the time EXECUTE succeeds.
      const coachingDetection = contextPackForLog
        ? detectCoachingSignal({
            proposedHandlerId,
            outcome: handlerOutcome,
            contextPack: contextPackForLog,
            priorFacts: context.prior_facts,
          })
        : null;
      const coachingText = coachingDetection?.coaching_text ?? null;
      coachingSignalId = coachingDetection?.signal_id ?? null;
      if (coachingDetection) {
        emit(TelemetryEvents.V5CoachingSignalFired, {
          request_id: requestId,
          scenario_id: context.session_id,
          signal_id: coachingDetection.signal_id,
          handler_id: proposedHandlerId,
        });
        // Persist signal metadata into enrichment on run_analysis facts
        // (frozen schema has enrichment only there) so the next turn's
        // CoachingCache.last_coaching_signal can surface it.
        if (proposedHandlerId === 'run_analysis') {
          handlerFactsForCommit = attachCoachingSignalToRunAnalysisFact(
            handlerFactsForCommit,
            coachingDetection.signal_id,
            requestId,
          );
        }
        // Also write to the per-scenario sidecar. This is the only
        // persistence path for edit-handler signals (STALE_*, HIGH_*)
        // because edit HandlerFact variants have no enrichment field.
        // Fire-and-forget; the sidecar helper swallows I/O failures.
        void appendLastCoachingSignal({
          scenario_id: context.session_id,
          signal_id: coachingDetection.signal_id,
          turn_id: requestId,
          produced_at: new Date().toISOString(),
        });
      }
      stagesCompleted.push('coach');

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
      // V5 Task 2.1: deterministic chip suggestions for the execute branch.
      const executeChips = generateChips({
        stage: context.stage,
        handlerFacts: handlerFactsForCommit,
        analysis: contextPackForLog?.analysis ?? null,
        validationRegistry: options.validationRegistry ?? HANDLER_VALIDATION_REGISTRY,
      });
      composedOk = composeToolCallResponse({
        orientation: sanitisedOrientation.output,
        confirmation: confirmationText,
        coaching: coachingText,
        stage: context.stage,
        handlerFacts: handlerFactsForCommit,
        suggested_actions: executeChips,
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
      // V5 Task 2.1: clarify turns carry chips so the user has a next step
      // if they can't articulate the clarification themselves.
      const clarifyChips = generateChips({
        stage: context.stage,
        handlerFacts: [],
        analysis: contextPackForLog?.analysis ?? null,
        validationRegistry: options.validationRegistry ?? HANDLER_VALIDATION_REGISTRY,
      });
      composedOk = composeClarifyResponse({
        assistant_text: sanitised.output,
        stage: context.stage,
        suggested_actions: clarifyChips,
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
      // V5 Task 2.1: coach turns carry chips aligned to stage + analysis
      // context (e.g. "Explain the decision" on decide stage).
      const coachChips = generateChips({
        stage: context.stage,
        handlerFacts: [],
        analysis: contextPackForLog?.analysis ?? null,
        validationRegistry: options.validationRegistry ?? HANDLER_VALIDATION_REGISTRY,
      });
      composedOk = composeDirectAnswerResponse({
        assistant_text: sanitised.output,
        stage: context.stage,
        suggested_actions: coachChips,
      });
      stagesCompleted.push('compose');
    } else {
      // text_only → inferred converse.
      const text = routingResult.type === 'text_only'
        ? routingResult.text
        : routingResult.orientationText;
      const sanitised = sanitiseNarrateOutput(text);
      if (sanitised.contamination_detected) {
        emit(TelemetryEvents.TurnExecutorContaminationNarrate, {
          request_id: requestId,
          raw_length: text.length,
          sanitised_length: sanitised.output.length,
          turn_class: 'direct_answer',
        });
      }
      // V5 Task 2.1: converse turns carry chips so the user has a next
      // step even when Sonnet only produced a conversational reply.
      const converseChips = generateChips({
        stage: context.stage,
        handlerFacts: [],
        analysis: contextPackForLog?.analysis ?? null,
        validationRegistry: options.validationRegistry ?? HANDLER_VALIDATION_REGISTRY,
      });
      composedOk = composeDirectAnswerResponse({
        assistant_text: sanitised.output,
        stage: context.stage,
        suggested_actions: converseChips,
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
        graph: options.graphState,
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
    // Phase 1b D10 / review-cycle P1-3: emit one routing log record per
    // turn — success or failure — so Phase 2 evaluation has the route-time
    // signals (intent classification, coaching mode, resolution status,
    // error cause). The default writeRoutingLog is non-throwing, but a
    // custom routingLogWriter (tests / Phase 2 sinks) might throw
    // synchronously OR return a rejecting promise. The fire-and-forget
    // wrapper below catches both — turn execution must NEVER fail because
    // of routing log emission.
    const writer = options.routingLogWriter ?? writeRoutingLog;
    // Phase 1.5: emit graph signal counts + deterministic hash so Phase 2
    // evaluation can correlate validator behaviour with graph state.
    //
    // P1-2 (review): on fail-fast paths (graph_payload_drift, orient
    // failures) the ContextPack never assembled, so fall back to the
    // adapter stats + raw ingress arrays to preserve ingress counts.
    // Without this, dashboards querying "turns with graph > N nodes"
    // would miss fail-fast turns that DID carry a graph payload.
    const ingressNodeCount = graphStateForTurn?.nodes.length ?? 0;
    const ingressEdgeCount = graphStateForTurn?.edges.length ?? 0;
    const graphNodeCount =
      contextPackForLog?.graph.counts.nodes
      ?? graphLookupStatsForLog?.total_nodes
      ?? ingressNodeCount;
    const graphEdgeCount =
      contextPackForLog?.graph.counts.edges ?? ingressEdgeCount;
    const graphHash = computeDeterministicGraphHash(graphStateForTurn);
    const record = buildRoutingLog({
      turn_id: context.request_id,
      scenario_id: context.session_id,
      stage: context.stage,
      intent_class: intentClass,
      handler_id: proposedHandlerIdForLog,
      coaching_mode: coachingMode,
      resolution_status: resolutionStatus,
      routing_error_cause: routingErrorCause,
      validation_error_code: validationErrorCode,
      compound_detected: contextPackForLog?.compound_detected ?? false,
      compound_pattern_matched: contextPackForLog?.compound_pattern_matched ?? null,
      raw_user_message: payload.message,
      sonnet_text: sonnetTextForLog,
      redacted: options.routingLogRedacted ?? false,
      created_at: new Date(startedAt).toISOString(),
      graph_node_count: graphNodeCount,
      graph_edge_count: graphEdgeCount,
      graph_hash: graphHash,
      // Imp-2 + review round 3 Imp-1: adapter stats + categorical outcome
      // on every row. Count fields default to numeric zero (not null) so
      // aggregation queries don't need COALESCE wrappers. `graph_lookup_outcome`
      // mirrors the telemetry event outcome for direct joins between the
      // two streams.
      graph_mapped_nodes: graphLookupStatsForLog?.mapped_nodes ?? 0,
      graph_dropped_by_unknown_kind:
        graphLookupStatsForLog?.dropped_by_unknown_kind ?? 0,
      graph_dropped_by_missing_id:
        graphLookupStatsForLog?.dropped_by_missing_id ?? 0,
      graph_lookup_outcome: graphLookupBuildReason,
      cqe_message_length: cqeSummaryForLog?.message_length ?? 0,
      cqe_result_count: cqeSummaryForLog?.result_count ?? 0,
      cqe_match_count: cqeSummaryForLog?.cqe_match_count ?? 0,
      cqe_compromise_match_count: cqeSummaryForLog?.compromise_match_count ?? 0,
      cqe_patterns_matched: cqeSummaryForLog?.patterns_matched ?? [],
      cqe_duration_ms: cqeSummaryForLog?.duration_ms ?? 0,
      cqe_timeout: cqeSummaryForLog?.timeout ?? false,
      cqe_message_too_long: cqeSummaryForLog?.message_too_long ?? false,
      cqe_word_range_missed: cqeSummaryForLog?.word_range_missed ?? false,
      cqe_ambiguous_phrasing_detected:
        cqeSummaryForLog?.ambiguous_phrasing_detected ?? false,
      coaching_signal_id: coachingSignalId,
    });
    safeFireRoutingLogWrite(writer, record, requestId);
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
    routingErrorCause = err.cause;
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
      case 'api_error': {
        log.warn(
          { request_id: requestId, cause: err.cause, provider_message: err.provider_message, status: err.status },
          'V5 TurnExecutor routing api_error',
        );
        // 400-level → LLM_REQUEST_INVALID (not retryable; bad request from our side)
        // 429       → LLM_RATE_LIMITED (retryable after backoff)
        // 500-level → LLM_SCHEMA_VIOLATION (maps to LLM_UNAVAILABLE; server unavailable)
        // unknown   → LLM_SCHEMA_VIOLATION (fail-safe)
        const errorContext: Record<string, unknown> = {
          phase: 'orient',
          routing_error_cause: err.cause,
        };
        if (err.status) {
          errorContext.http_status = err.status;
          if (err.status >= 400 && err.status < 500) {
            if (err.status === 429) {
              failureType = INTERNAL_TO_WIRE.LLM_RATE_LIMITED;
              // 429 is retryable after the retry-after window; surface both
              // retryable + retry_after_seconds so the UI can render a
              // correct backoff affordance rather than a "please retry"
              // button that fires immediately.
              errorContext.retryable = true;
              errorContext.retry_after_seconds = 60;
              response = buildFailureResponse('LLM_RATE_LIMITED', context.stage, errorContext);
            } else {
              failureType = INTERNAL_TO_WIRE.LLM_REQUEST_INVALID;
              errorContext.retryable = false;
              response = buildFailureResponse('LLM_REQUEST_INVALID', context.stage, errorContext);
            }
          } else {
            failureType = INTERNAL_TO_WIRE.LLM_SCHEMA_VIOLATION;
            errorContext.retryable = true;
            response = buildFailureResponse('LLM_SCHEMA_VIOLATION', context.stage, errorContext);
          }
        } else {
          failureType = INTERNAL_TO_WIRE.LLM_SCHEMA_VIOLATION;
          response = buildFailureResponse('LLM_SCHEMA_VIOLATION', context.stage, errorContext);
        }
        return finalizeRun();
      }
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
      // Two reasons collapse into this branch, but they have different wire
      // semantics (v5-exclusive-cee P0 follow-up):
      //   - `handler_not_registered`: the action IS in V5ActionType but no
      //     handler is registered in this deployment. Typed FEATURE_NOT_ENABLED
      //     (via UNSUPPORTED_ACTION) so clients can distinguish a declared-
      //     but-unbuilt feature from a generic internal bug.
      //   - `unhandled_turn_class`: the classifier returned a turn_class value
      //     not in the C1TurnClass union — a true internal invariant breach.
      //     Stays on UNHANDLED → INTERNAL_ERROR (P0 alert class).
      const isUnsupported = error.reason === 'handler_not_registered';
      log.error(
        {
          request_id: requestId,
          reason: error.reason,
          attempted: error.attempted,
          message: error.message,
        },
        isUnsupported
          ? 'V5 TurnExecutor unsupported action — handler not registered for declared V5ActionType'
          : 'V5 TurnExecutor unhandled turn class — classifier invariant breach',
      );
      if (isUnsupported) {
        failureType = INTERNAL_TO_WIRE.UNSUPPORTED_ACTION;
        response = buildFailureResponse('UNSUPPORTED_ACTION', context.stage, {
          reason: 'handler_not_registered',
          handler_id: error.attempted,
        });
      } else {
        failureType = INTERNAL_TO_WIRE.UNHANDLED;
        response = buildFailureResponse('UNHANDLED', context.stage, {
          reason: error.reason,
          attempted: error.attempted,
        });
      }
      return finalizeRun();
    }
    if (error instanceof HandlerInvocationFailedError) {
      log.warn(
        {
          request_id: requestId,
          kind: error.kind,
          cause_kind: error.cause_kind,
          retryable: error.retryable,
          message: error.message,
        },
        'V5 TurnExecutor handler invocation failed',
      );
      failureType = INTERNAL_TO_WIRE.HANDLER_INVOCATION_FAILED;
      const composeCtx: ComposeContext = {
        graph: graphLookupForValidate,
        handlerRegistry: options.validationRegistry ?? HANDLER_VALIDATION_REGISTRY,
      };
      const composed = composeHandlerFailure(error, composeCtx, context.stage);
      response = composed.response;
      emit(TelemetryEvents.TurnExecutorFailureResponse, {
        request_id: requestId,
        session_id: context.session_id,
        stage: context.stage,
        failure_origin: 'handler',
        error_code: error.cause_kind,
        template_used: composed.template_id,
        chip_attached: composed.response.suggested_actions.length > 0,
        chip_type: composed.chip_type,
        chip_count: composed.response.suggested_actions.length,
        retryable: error.retryable,
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

/**
 * Narrow an ingress analysis payload into the V2RunResponseEnvelope shape
 * that compactAnalysis() consumes. The ingress schema only requires
 * `analysis_status`; compactAnalysis reads `meta`, `results`, `robustness`,
 * `factor_sensitivity`, etc. defensively. We fill required fields ONLY when
 * they are truly missing; when present but non-canonical we normalise into
 * the array shape compactAnalysis expects without lying to the type system
 * (review round 3 P1-2).
 */
function coerceIngressAnalysis(a: AnalysisStateIngress): V2RunResponseEnvelope {
  const raw = a as AnalysisStateIngress & {
    meta?: V2RunResponseEnvelope['meta'];
    results?: unknown;
    [k: string]: unknown;
  };
  return {
    ...raw,
    meta: raw.meta ?? { seed_used: 0, n_samples: 0, response_hash: '' },
    results: normaliseResults(raw.results),
  };
}

/**
 * Convert an arbitrary `results` value into the `unknown[]` that
 * V2RunResponseEnvelope declares.
 *
 *   • array       → unchanged
 *   • object      → Object.values(...) — handles keyed compatibility
 *                   payloads (e.g. `{ opt_1: {...}, opt_2: {...} }`) so
 *                   data is preserved rather than discarded
 *   • missing     → []
 *   • primitive   → [] (meaningless shape; nothing to preserve)
 *
 * No type assertions. The caller can reason about the returned array
 * without guessing about the ingress shape.
 */
function normaliseResults(raw: unknown): unknown[] {
  if (raw === undefined || raw === null) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'object') {
    return Object.values(raw as Record<string, unknown>);
  }
  return [];
}

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

/**
 * V5 Group 1 Task C: attach a coaching signal marker to the run_analysis
 * handler fact's enrichment so the next turn's coaching-cache reader can
 * surface it as last_coaching_signal. For edit handlers (set_factor_value
 * et al.), enrichment does not exist on the fact shape, so signal_id is
 * carried only via the routing log.
 */
function attachCoachingSignalToRunAnalysisFact(
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

/**
 * Fire-and-forget routing-log write that catches every failure path:
 *   - synchronous throw from the writer function
 *   - rejected promise returned by the writer
 *   - non-promise return from the writer (defensive)
 *
 * Logs a warning on failure; never re-raises. Turn execution must complete
 * regardless of routing-log status.
 */
function safeFireRoutingLogWrite(
  writer: (record: RoutingLog) => Promise<void> | void,
  record: RoutingLog,
  requestId: string,
): void {
  try {
    const fired = writer(record);
    Promise.resolve(fired).catch((err) => {
      log.warn(
        { request_id: requestId, err: serialiseError(err) },
        'V5 TurnExecutor routing log writer rejected — swallowed',
      );
    });
  } catch (err) {
    log.warn(
      { request_id: requestId, err: serialiseError(err) },
      'V5 TurnExecutor routing log writer threw synchronously — swallowed',
    );
  }
}

export type { InternalFailure } from './types.js';
