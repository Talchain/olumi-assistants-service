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

import { createHash } from 'node:crypto';

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
import { buildTurnContext } from './build-turn-context.js';
import {
  buildFailureResponse,
  type FailureResponseRecoveryContext,
} from './failure-response.js';
import { composeValidationFailure } from './compose/validation-failure-responses.js';
import { composeUnsupportedActionResponse } from './compose/unsupported-action-response.js';
import { composeRecoverableValidationResponse } from './compose/recoverable-validation-response.js';
import { computeStructuralReadiness } from '../orchestrator/tools/analysis-ready-helper.js';
import { GraphV3 } from '../schemas/cee-v3.js';
import type { GraphPatchBlockData } from '../orchestrator/types.js';
import { composeHandlerFailure } from './compose/handler-failure-responses.js';
import type { ComposeContext, SuggestedAction } from './compose/types.js';
import {
  tryDeterministicValueUpdate,
  tryDeicticValueUpdate,
  buildClarifyAssistantText,
  buildClarifyChipMessage,
  buildDeicticClarifyAssistantText,
  mapCqeQuantityToProposalValue,
  deriveOperator,
} from './routing/deterministic-value-update.js';
import { tryShortConfirmResume } from './routing/deterministic-short-confirm.js';
import { tryClarificationResume } from './routing/clarification-resume.js';
import {
  composeStateQueryChip,
  tryStateQueryGuard,
} from './routing/state-query-guard.js';
import { tryProposalOrdinalSelect } from './routing/proposal-ordinal-select.js';
import {
  PROPOSAL_DISMISSAL_RESPONSE,
  tryProposalDismissal,
} from './routing/proposal-dismissal.js';
import {
  buildApplyProposedChangeProposal,
  decideProposedChangeSynthesis,
  PROPOSAL_ALREADY_APPLIED_RESPONSE,
  PROPOSAL_SUPERSEDED_RESPONSE,
} from './routing/proposed-change-synthesis.js';
import { isProposedChangeActionType } from './types/proposed-change.js';
import { derivePendingActionsFromChips } from './compose/derive-pending-actions.js';
import {
  RENDER_SAFE_LABEL_FALLBACK,
  RENDER_SAFE_MESSAGE_FALLBACK,
  resolveProposalRenderCopy,
  sanitisePublicCopyOrFallback,
} from './compose/proposed-change.js';
import {
  PENDING_ACTION_DEFAULT_TURN_TTL,
  PENDING_ACTION_DEFAULT_WALL_TTL_MS,
  type PendingAction,
} from './session/pending-action.js';
import { randomUUID } from 'node:crypto';
import type { ProposalAction } from './routing/types.js';
import {
  HandlerInvocationFailedError,
  HandlerResultInvalidError,
} from './tools/handler-errors.js';
import {
  getDefaultRegistry,
  resolveHandler,
  type HandlerInvocation,
  type HandlerOutcome,
  type HandlerRegistry,
} from './tools/registry.js';
import { sanitiseNarrateOutput } from './sanitise.js';
import { sanitiseAssistantTextProse } from './format/numeric-prose-formatter.js';
import { generateChips } from './compose/chip-generator.js';
import { generatePostAnalysisCoaching } from './coaching/post-analysis-wrapper.js';
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
import {
  computeAnalysisAffectingGraphHash,
  computeDeterministicGraphHash,
} from './context/graph-hash.js';
import {
  deriveAnalysisFreshness,
  emitFreshnessTelemetry,
  type FreshnessDerivation,
} from './context/freshness.js';
import { deriveRecentChangesEvidence } from './context/recent-changes.js';
import type { TurnOutcome } from './turn-outcome.js';
import {
  ROUTING_PROMPT_VERSION,
  ROUTING_PROMPT_HASH,
  ROUTING_PROMPT_SYSTEM_CHARS,
  RoutingError,
  routeWithToolUse,
  type RoutingResult,
  type RoutingToolCallResult,
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
import { validateExplanationAnswer } from './routing/validator-explanation.js';
import { EXPLANATION_HANDLER_IDS } from './routing/types.js';
import {
  buildAnalysisProjectionSummary,
  buildStructureProjectionSummary,
} from './context/projection-summaries.js';
import { containsMutationLanguage } from './routing/mutation-language.js';
import {
  GraphStateIngressSchema,
  type GraphStateIngress,
  type AnalysisStateIngress,
} from './boundary/request-extensions.js';
import type { V2RunResponseEnvelope } from '../orchestrator/types.js';
import type { UsageMetrics } from '../adapters/llm/types.js';
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
  /**
   * V5 finaliser contract: pre-computed structural readiness from the
   * per-turn graph (`graphStateForTurn` parsed via GraphV3 +
   * computeStructuralReadiness). Already computed inside this function for
   * chip-gating; surfaced here so the response-finaliser in route-v2.ts can
   * stamp `analysis_ready` onto the wire envelope after composition.
   * Undefined when the turn had no graph state, or the graph failed strict
   * GraphV3 parse, or readiness derivation found no goal node — same gate
   * the chip-generator already uses today.
   */
  analysisReady?: NonNullable<GraphPatchBlockData['analysis_ready']>;
  /**
   * V5 state-trust internal turn-outcome contract. Computed after handler
   * dispatch from the freshness derivation + handler identity. Used by
   * downstream composition (rerun chip gate, analysis_ready freshness
   * field threading) and telemetry. NOT exposed on the wire — wire
   * consumers read freshness via the additive analysis_ready.* fields.
   */
  turn_outcome?: TurnOutcome;
  /**
   * V5 state-trust freshness derivation, threaded through so
   * response-finaliser / analysis-ready-emit can use the selected fact's
   * computed_at instead of restamping with Date.now() on every emit.
   */
  freshness?: FreshnessDerivation;
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
   * P0 V5 golden-path repair (Wave 2): UI-side selection context. The
   * client emits `selected_elements: { node_ids?, edge_ids? }` on
   * conversation/explain turns. CEE consumes `node_ids` ONLY in the
   * deterministic value-update pre-route as a strict tie-breaker
   * (factor-kind, exactly-one-factor narrowing). Other dispatch paths
   * ignore it. Absent / null when the turn carried no selection.
   */
  readonly selectedElements?: {
    readonly node_ids: readonly string[];
    readonly edge_ids: readonly string[];
  } | null;
  /**
   * Set by route-v2 when an ingress arrives with `source='chip_click'`
   * and `chip.action_type === 'what_would_flip'`. The short-confirm
   * pre-route reads this and synthesises the resume just as it does
   * for a typed "yes" — same freshness gate, same entity-pick from
   * graph, same telemetry, byte-equivalent proposal. When the most-
   * recent pending action is missing or expired, the pre-route
   * dispatches a focused recovery referring to the chip's intent
   * rather than falling through to the LLM with bare-message-LLM-
   * passthrough that loses the chip's semantic label.
   */
  readonly chipClickResumeIntent?: 'what_would_flip';
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
   * Privacy override for the routing log. When true (the default), the
   * JSONL sink drops `raw_user_message` and replaces `sonnet_text` with
   * a SHA-256 hash (`sonnet_text_hash`). Opt-in raw capture
   * (`routingLogRedacted: false`) is permitted for debugging only —
   * never the production default. See principle 3 of the V5 resilience
   * contract ("no user decision text in logs") and Part F for the
   * routing-log-specific statement.
   */
  readonly routingLogRedacted?: boolean;
  /**
   * V5 Group 1 Task B: scenario brief text, supplied by the route when
   * the decision_review auto-fire should have a brief available. Passed
   * to the decision-review enricher without ever touching the run_analysis
   * handler fact's enrichment (F.6 / handler-ownership invariant).
   * When null/absent, the enricher skips with reason `no_brief`.
   *
   * @deprecated V5 Phase 1 brief persistence (2026-05-02): the brief is
   *   now sourced from canonical state via
   *   `EnrichedTurnContext.scenarioBriefText` (populated by
   *   `buildTurnContext` from `scenarios.brief_text`). No caller in the
   *   current codebase populates this field. It is retained for one
   *   release as a fallback if a non-null value is supplied — a
   *   deprecation warning is logged when that happens. Remove in
   *   Phase 2.
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

  // V5 alpha hardening Phase 2.5: one-query observability. v5_journey_id
  // aliases scenario_id (= context.session_id) per Paul's locked-in
  // decision — no new correlation layer. The lateBound fields get
  // populated as the turn progresses; obsPayload() snapshots whatever is
  // known at the emit site.
  const v5JourneyId: string = context.session_id;
  let contextPackCharsForObs = 0;
  let handlerProposedForObs: string | null = null;
  let validatorOutcomeForObs: 'valid' | ValidationError['code'] | null = null;
  let responseTypeForObs: C1TurnClass | null = null;
  const obsPayload = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    request_id: requestId,
    session_id: context.session_id,
    v5_journey_id: v5JourneyId,
    prompt_version: ROUTING_PROMPT_VERSION,
    prompt_hash: ROUTING_PROMPT_HASH,
    system_chars: ROUTING_PROMPT_SYSTEM_CHARS,
    context_pack_chars: contextPackCharsForObs,
    handler_proposed: handlerProposedForObs,
    validator_outcome: validatorOutcomeForObs,
    response_type: responseTypeForObs,
    stage: context.stage,
    ...extra,
  });

  emit(TelemetryEvents.TurnExecutorStarted, obsPayload());

  // Recovery-chip context for the egress safety layer (failure-response.ts).
  // Closured over `proposedHandlerIdForLog` and `analysisReadyForTurn` so
  // the values reflect whatever the turn knows at the point of failure.
  // `cause` lets a caller refine LLM_SCHEMA_VIOLATION → ZOD_REPAIR_FAILED
  // when the routing error cause is `schema_repair_failed`.
  //
  // TODO(retry-attribution): `isRetry` is hardcoded false because the
  // current MessageTurnPayload schema does not carry a `retry_of` /
  // chip-source / explicit retry marker. When that signal lands (e.g.
  // chip-click metadata or a payload-level retry hint), thread it through
  // here so `v5.recovery_chip_served.is_retry` is accurate. Until then,
  // false is the safe default — failure dashboards interpret missing
  // signal as "not a retry".
  const recoveryCtx = (cause?: string): FailureResponseRecoveryContext => ({
    previousUserMessage: payload.message,
    analysisReady: analysisReadyForTurn?.status === 'ready',
    scenarioId: context.session_id,
    turnId: requestId,
    isRetry: false,
    handlerId: proposedHandlerIdForLog,
    cause,
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
  // V5 product-state continuity (foamy-bee tranche) — observability for
  // the state-query guard. `'not_evaluated'` covers turns where the
  // guard's pre-route never ran (e.g. an earlier pre-route already
  // synthesised a routingResult); flips to `'unmatched'` /
  // `'with_recent_change'` / `'no_recent_changes'` once the guard fires.
  // Threaded into the routing log (and from there to dashboards) so the
  // misroute class stays observable in production.
  let stateQueryGuardOutcomeForLog:
    | 'unmatched'
    | 'with_recent_change'
    | 'no_recent_changes'
    | 'not_evaluated' = 'not_evaluated';
  // Compute the successful-mutation-fact count ONCE at function entry so
  // every turn class (including those where an earlier pre-route —
  // short-confirm, deterministic value-update — synthesises a routing
  // result before the state-query guard runs) writes the correct count
  // to the routing log. Anchoring this at the guard block alone left
  // turns that short-circuit early reporting `prior_mutation_fact_count:
  // 0` even when the conversation had several persisted mutations.
  const priorMutationFactCountForLog = context.prior_facts.filter(
    (f) =>
      !f.noop &&
      (f.fact_type === 'add_constraint' ||
        f.fact_type === 'set_factor_value' ||
        f.fact_type === 'adjust_edge_strength'),
  ).length;
  // V5 state-trust: freshness derivation. The PRE-dispatch derivation
  // (`routingFreshness`) is built from `context.prior_facts` and is used
  // to ground Sonnet's analysis projection. The POST-dispatch derivation
  // (`freshness`) re-runs against `[...currentTurnFacts, ...prior_facts]`
  // so a just-produced `run_analysis` fact is selected on the same turn
  // — fixing the case where a routed `run_analysis` would otherwise
  // ship the wire with prior-turn freshness. `freshness` is what
  // finalizeRun() surfaces; `routingFreshness` is internal-only.
  let routingFreshness: FreshnessDerivation | null = null;
  let freshness: FreshnessDerivation | null = null;
  let proposedHandlerIdForOutcome: string | null = null;
  let currentAnalysisGraphHashForTurn: string | null = null;
  // P0 V5 golden-path repair (follow-up): hoisted into the function
  // scope so `buildTurnOutcome` (nested below) can read it. Set when a
  // handler outcome carries a non-null `mutated_graph`. Closes the
  // gap where set_factor_value / add_constraint / adjust_edge_strength
  // mutated the graph but turn_outcome.graph_mutated stayed false.
  let handlerEmittedMutatedGraph = false;

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
  // V5 finaliser contract: hoisted to outer scope so `finalizeRun` can
  // surface it on `TurnExecutorRunResult.analysisReady` for the response
  // finaliser. Declared here, populated below at the existing
  // `computeStructuralReadiness` site (chip-gating) — no behavioural change
  // to chip generation; just makes the value reachable from the closure.
  let analysisReadyForTurn:
    | NonNullable<GraphPatchBlockData['analysis_ready']>
    | undefined;

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
      // Fallback: when graphState is absent (follow-up turns), use the
      // persisted graph already loaded by buildTurnContext via
      // loadGraphAndBriefText (the declared session access boundary).
      // V5 Phase 1: this avoids a second Supabase round trip — buildTurnContext
      // reads scenarios.* once for both graph and brief_text on every turn,
      // and the result is surfaced on context.persistedGraph for the
      // executor's fallback to consume.
      if (!graphStateForTurn) {
        const persistedGraph = context.persistedGraph;
        if (persistedGraph) {
          const parsed = GraphStateIngressSchema.safeParse(persistedGraph);
          if (parsed.success) {
            graphStateForTurn = parsed.data;
            log.info(
              { request_id: requestId, scenario_id: payload.scenario_id },
              'V5 TurnExecutor using persisted graph loaded during buildTurnContext for graph lookup fallback',
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

    // V5 alpha hardening Phase 2.4: compute structural readiness once per
    // turn so the chip generator can gate the executable `Run analysis`
    // chip on a full precondition signal (goal + ≥2 options + interventions)
    // rather than the weaker `graphOptionCount > 0` hint. When graph
    // state is absent or fails strict GraphV3 parse, readiness is
    // undefined and the chip generator falls back to the conversational
    // variant. Cheap: runs in ~hundreds of microseconds on typical graphs.
    // V5 finaliser contract: `analysisReadyForTurn` is declared in the
    // outer function scope (above) so `finalizeRun` can surface it on
    // `TurnExecutorRunResult.analysisReady` for the response finaliser.
    if (graphStateForTurn) {
      const parsedGraphForReadiness = GraphV3.safeParse(graphStateForTurn);
      if (parsedGraphForReadiness.success) {
        analysisReadyForTurn = computeStructuralReadiness(
          parsedGraphForReadiness.data,
        );
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
      response = buildFailureResponse(
        'UNHANDLED',
        context.stage,
        {
          reason: 'graph_payload_drift',
          total_nodes: graphLookupStatsForLog.total_nodes,
          dropped_by_unknown_kind: graphLookupStatsForLog.dropped_by_unknown_kind,
          dropped_by_missing_id: graphLookupStatsForLog.dropped_by_missing_id,
        },
        recoveryCtx(),
      );
      return finalizeRun();
    }

    // ==================================================================
    // STEP 1 — ORIENT
    // ==================================================================
    // V5 D1 golden-path closure (A3.1): the deterministic pre-route may
    // synthesise this before the routeWithToolUse call. Wider type so the
    // guard below the pre-route block can compare against undefined.
    let routingResult: RoutingResult | undefined;
    // Resumed pending action, if the short-confirm pre-route synthesised
    // a tool_call. Cleared after the commit-success consumed-telemetry
    // emit. Null on every other path.
    let consumedPendingAction: PendingAction | null = null;
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
    // V5 state-trust: derive routing freshness — the PRE-dispatch view
    // used to ground Sonnet's analysis projection. The wire-bound
    // freshness is re-derived POST-dispatch below (see
    // `re-derive freshness post-dispatch` block) so a just-produced
    // run_analysis fact is selected on the same turn.
    currentAnalysisGraphHashForTurn = computeAnalysisAffectingGraphHash(graphStateForTurn);
    routingFreshness = deriveAnalysisFreshness(
      context.prior_facts,
      currentAnalysisGraphHashForTurn,
    );
    // Until the post-dispatch re-derivation runs, the wire-bound
    // `freshness` defaults to the routing view — this covers exit paths
    // that return before handler dispatch (orient errors, routing
    // errors, validation failures).
    freshness = routingFreshness;

    let analysisSummary: AnalysisResponseSummary | null = null;
    let analysisStalenessReason: string | null = null;
    let analysisStateSource: 'request' | 'fallback' | 'absent' = 'absent';
    if (options.analysisState) {
      analysisSummary = compactAnalysis(coerceIngressAnalysis(options.analysisState));
      analysisStateSource = 'request';
      // Freshness verdict is independent of whether the request carries
      // analysis_state — it is always derived from the prior-fact chain.
      // We still set the legacy staleness reason field when freshness is
      // not 'fresh' so the existing prefix path stays consistent until
      // the call sites are removed in the next commit.
      if (freshness.freshness === 'stale' || freshness.freshness === 'unknown') {
        analysisStalenessReason = FALLBACK_STALENESS_REASON;
      }
    } else {
      // Resolve option labels from the current graph so the fallback doesn't
      // leak raw option_ids into Sonnet's user-facing prose. Filter to
      // option nodes only; the fallback builder uses id → label lookups.
      const optionLabelSource = (graphStateForTurn?.nodes ?? [])
        .filter((n) => (n as { kind?: unknown }).kind === 'option')
        .map((n) => {
          const node = n as { id: string; label?: unknown };
          return {
            id: node.id,
            label: typeof node.label === 'string' ? node.label : null,
          };
        });
      const fallback = buildAnalysisFromPriorFacts(
        context.prior_facts,
        optionLabelSource,
      );
      if (fallback) {
        analysisSummary = fallback;
        analysisStateSource = 'fallback';
        // Legacy staleness reason now driven by the freshness verdict —
        // only set when stale or unknown, NEVER on fresh. Removes the
        // P0 bug where every explain turn after run_analysis stamped
        // the prefix.
        if (freshness.freshness === 'stale' || freshness.freshness === 'unknown') {
          analysisStalenessReason = FALLBACK_STALENESS_REASON;
        }
      }
    }

    // Emit the derivation event regardless of which branch built the
    // summary — freshness reflects the prior-fact state, not the
    // request payload. Telemetry consumers query by this single event
    // to reconstruct freshness state for any turn.
    // Pre-dispatch telemetry — represents the freshness state Sonnet's
    // analysis projection was grounded in. The post-dispatch re-derivation
    // (see line ~1373) emits the same family tagged
    // `dispatch_path: 'turn_executor_post_handler'` when a current-turn
    // fact changes the verdict.
    emitFreshnessTelemetry(
      routingFreshness,
      {
        request_id: requestId,
        scenario_id: context.session_id,
        dispatch_path: 'turn_executor_pre_handler',
      },
      {
        prior_fact_count: context.prior_facts.length,
        analysis_state_source: analysisStateSource,
      },
    );
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
      // V5 review: carry raw goal_constraints alongside the compact graph so
      // Sonnet does not lose decision constraints in the compact path.
      const compactedConstraints = compactedGraph
        ? (graphStateForTurn?.goal_constraints ?? null)
        : null;
      const { contextPack, cqeSummary } = assembleContextPackWithSummary({
        payload,
        priorTurns: context.prior_turns,
        // V5 product-state continuity (foamy-bee tranche): thread
        // prior_facts so the assembler can project the `recent_changes`
        // summary. Without this, follow-up state-queries ("what update
        // did you make?") have no human-readable receipt to ground
        // Sonnet's answer and fall to the legacy `edit_graph` catch-all.
        priorFacts: context.prior_facts,
        graph: compactedGraph ? undefined : graphStateForTurn,
        compactedGraph,
        compactedConstraints,
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
      contextPackCharsForObs = JSON.stringify(contextPack).length;

      // V5 alpha hardening Phase 2.5: primary lifecycle event — carries
      // the full obs field set so one log query reveals ContextPack
      // assembly for the whole journey.
      emit(
        TelemetryEvents.ContextPackAssembled,
        obsPayload({
          conversation_history_turns: contextPack.conversation.recent_turns.length,
          graph_compacted: compactOutcome.kind === 'compacted',
          graph_compact_via:
            compactOutcome.kind === 'compacted' ? compactOutcome.via : null,
          analysis_state_source: analysisStateSource,
          analysis_staleness_reason: analysisStalenessReason,
          analysis_freshness: freshness.freshness,
          analysis_freshness_reason: freshness.reason,
        }),
      );

      // V5 Task 3.2: keep the existing debug log for local dev visibility.
      // Primary event above is the queryable signal; this is extra noise
      // gated behind debug level and carries only minimal fields.
      log.debug(
        {
          request_id: requestId,
          v5_journey_id: v5JourneyId,
          session_id: context.session_id,
          system_chars: ROUTING_PROMPT_SYSTEM_CHARS,
          context_pack_chars: contextPackCharsForObs,
          conversation_history_turns: contextPack.conversation.recent_turns.length,
          graph_compacted: compactOutcome.kind === 'compacted',
          graph_compact_via:
            compactOutcome.kind === 'compacted' ? compactOutcome.via : null,
          analysis_state_source: analysisStateSource,
          analysis_staleness_reason: analysisStalenessReason,
          analysis_freshness: freshness.freshness,
          analysis_freshness_reason: freshness.reason,
        },
        'V5 TurnExecutor context pack assembled',
      );

      // V5 Step 5 grounding probe: collapse the State→Composition→Prompt
      // triage into a single info-level Render log line per turn. The
      // derived `analysis_projection_status` enum makes the failure point
      // grep-friendly; the constituent flags (`has_run_analysis_fact`,
      // `leading_option_populated`, `analysis_section_chars`) remain on
      // the same line for forensic detail.
      const hasRunAnalysisFact = context.prior_facts.some(
        (f) => f.fact_type === 'run_analysis',
      );
      const leadingOptionPopulated = !!contextPack.analysis?.leading_option;
      const projectionStatus: 'facts_absent' | 'projection_empty' | 'projection_populated' =
        !hasRunAnalysisFact
          ? 'facts_absent'
          : !leadingOptionPopulated
            ? 'projection_empty'
            : 'projection_populated';
      log.info(
        {
          event: 'v5_turn_context_analysis_projection',
          request_id: requestId,
          scenario_id: context.session_id,
          analysis_projection_status: projectionStatus,
          has_run_analysis_fact: hasRunAnalysisFact,
          analysis_summary_present: analysisSummary !== null,
          analysis_state_source: analysisStateSource,
          analysis_staleness_reason: analysisStalenessReason,
          analysis_freshness: freshness.freshness,
          analysis_freshness_reason: freshness.reason,
          analysis_freshness_selected_fact_index: freshness.selected_fact_index,
          leading_option_populated: leadingOptionPopulated,
          runner_up_populated: !!contextPack.analysis?.runner_up,
          top_drivers_count: contextPack.analysis?.top_drivers?.length ?? 0,
          analysis_section_keys: contextPack.analysis
            ? Object.keys(contextPack.analysis)
            : [],
          // Char-count of the LLM-facing display-safe projection — what
          // Sonnet actually sees in the prompt. Raw projection size is
          // observable via the keys above plus drivers count.
          analysis_section_chars: JSON.stringify(contextPack.display_analysis ?? {}).length,
        },
        'V5 turnExecutor: context-pack analysis projection',
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

      // Deterministic short-confirmation pre-route. When the user
      // replies with a bare confirmation ("yes", "yes please", "do
      // that" …) and the previous assistant turn persisted a resumable
      // pending action, dispatch the matching handler without an LLM
      // round-trip. Recovery dispatches (expired, ambiguous,
      // rerun-analysis-required) emit safe assistant text + executable
      // chips and short-circuit to commit.
      //
      // Mutual exclusion with the value-update pre-route below is
      // enforced by regex content: short-confirm requires the message
      // to be bare "yes"-style; value-update requires an edit verb
      // plus a CQE quantity. The two cannot match the same message.
      // V5 G7/G8: shared recovery-commit closure for the
      // apply_proposed_change `superseded` / `already_applied` /
      // `invalid` lifecycle states. Both the direct pending_action
      // branch and the ordinal-select branch reach for the same
      // commit shape; centralising prevents drift between them.
      const commitProposedChangeRecovery = async (
        decisionStatus: 'superseded' | 'already_applied' | 'invalid',
        pathTag: string,
      ): Promise<TurnExecutorRunResult> => {
        const recoveryAssistantText =
          decisionStatus === 'superseded'
            ? PROPOSAL_SUPERSEDED_RESPONSE
            : decisionStatus === 'already_applied'
              ? PROPOSAL_ALREADY_APPLIED_RESPONSE
              : 'The offer I had open is no longer valid. Tell me what to explore next.';
        const recoveryResponse = composeDirectAnswerResponse({
          assistant_text: recoveryAssistantText,
          stage: context.stage,
          suggested_actions: [],
        });
        sonnetTextForLog = recoveryResponse.assistant_text;
        resolvedTurnClass = 'direct_answer';
        intentClass = 'converse';
        responseTypeForObs = 'direct_answer';
        llmCallsUsed = 0;
        stagesCompleted.push('orient');
        stagesCompleted.push('compose');
        try {
          const committed = await commitDirectAnswer(recoveryResponse, {
            scenario_id: context.session_id,
            turn_id: context.request_id,
            turn_class: 'direct_answer',
            handler_id: null,
            request_hash: computeRequestHash(payload),
            llm_calls_used: 0,
            duration_ms: Date.now() - startedAt,
            handler_facts: [],
          });
          commitPerformed = committed.performed;
          stagesCompleted.push('commit');
          response = committed.response;
        } catch (error) {
          log.error(
            {
              event: 'v5.state_commit_failed',
              request_id: requestId,
              session_id: context.session_id,
              path: pathTag,
              err: serialiseError(error),
            },
            'V5 TurnExecutor commit failure on proposed-change recovery',
          );
          failureType = INTERNAL_TO_WIRE.STATE_COMMIT_FAILED;
          response = buildFailureResponse(
            'STATE_COMMIT_FAILED',
            context.stage,
            { phase: 'commit' },
            recoveryCtx(),
          );
        }
        return finalizeRun();
      };
      // Chip-click parity for what_would_flip: route-v2 sets
      // `chipClickResumeIntent` so the resumer treats the click as a
      // confirmation regardless of the chip's natural-language
      // message (the brief contract is "chip click produces the same
      // outcome as typing yes"). The synthetic message "yes" is fed
      // into the resumer; below we add a no-pending recovery branch
      // so a chip click that arrives without a matching pending
      // action does not fall through to LLM with a bare-yes
      // passthrough.
      const resumerMessage = options.chipClickResumeIntent
        ? 'yes'
        : payload.message;
      const shortConfirmDispatch = tryShortConfirmResume({
        message: resumerMessage,
        pendingActions: context.most_recent_pending_actions ?? [],
        currentTurnIndex: context.prior_turns.length,
        nowMs: Date.now(),
        analysisFreshness: freshness?.freshness,
      });
      if (!shortConfirmDispatch.matched) {
        emit(TelemetryEvents.PendingActionSkipped, {
          request_id: requestId,
          scenario_id: context.session_id,
          reason: shortConfirmDispatch.skip_reason,
        });
        // No-pending recovery for chip-click: the user clicked a
        // what_would_flip chip but no matching pending action exists
        // (expired, never persisted, or read-degraded). Surface a
        // focused recovery referring to the chip's intent rather
        // than letting "yes" reach the LLM as a bare confirmation.
        if (
          options.chipClickResumeIntent === 'what_would_flip' &&
          (shortConfirmDispatch.skip_reason === 'no_pending' ||
            shortConfirmDispatch.skip_reason === 'kind_not_yet_resumable')
        ) {
          emit(TelemetryEvents.PendingActionRerunAnalysisRequired, {
            request_id: requestId,
            scenario_id: context.session_id,
            pending_action_id: 'chip_click_no_pending',
            kind: 'what_would_flip',
          });
          // Run-analysis is offered as an executable chip ONLY when
          // the model is structurally ready. On a model that's
          // missing options or a goal, clicking the chip would just
          // surface PRECONDITION_UNMET — moving the failure rather
          // than recovering from it. The expired-recovery branch
          // applies the same readiness gate; both paths must agree.
          const noPendingModelReady = analysisReadyForTurn?.status === 'ready';
          const noPendingAssistantText = noPendingModelReady
            ? "The offer to explore what would change this result is no longer available. " +
              'Run the analysis again first, then I can show you what would change it.'
            : "The offer to explore what would change this result is no longer available, " +
              'and the model is not yet ready to analyse. Tell me what to set up next.';
          const noPendingChips: SuggestedAction[] = noPendingModelReady
            ? [
                {
                  id: 'chip_action_run_analysis_after_chip_no_pending',
                  label: 'Run analysis',
                  message: 'Run the analysis.',
                  action_type: 'run_analysis',
                },
              ]
            : [];
          const recoveryResponse = composeDirectAnswerResponse({
            assistant_text: noPendingAssistantText,
            stage: context.stage,
            suggested_actions: noPendingChips,
          });
          sonnetTextForLog = recoveryResponse.assistant_text;
          resolvedTurnClass = 'direct_answer';
          intentClass = 'converse';
          responseTypeForObs = 'direct_answer';
          llmCallsUsed = 0;
          stagesCompleted.push('orient');
          stagesCompleted.push('compose');
          try {
            const committed = await commitDirectAnswer(recoveryResponse, {
              scenario_id: context.session_id,
              turn_id: context.request_id,
              turn_class: 'direct_answer',
              handler_id: null,
              request_hash: computeRequestHash(payload),
              llm_calls_used: 0,
              duration_ms: Date.now() - startedAt,
              handler_facts: [],
            });
            commitPerformed = committed.performed;
            stagesCompleted.push('commit');
            response = committed.response;
          } catch (error) {
            log.error(
              {
                event: 'v5.state_commit_failed',
                request_id: requestId,
                session_id: context.session_id,
                path: 'chip_click_what_would_flip_no_pending',
                err: serialiseError(error),
              },
              'V5 TurnExecutor commit failure on chip-click no-pending recovery',
            );
            failureType = INTERNAL_TO_WIRE.STATE_COMMIT_FAILED;
            response = buildFailureResponse(
              'STATE_COMMIT_FAILED',
              context.stage,
              { phase: 'commit' },
              recoveryCtx(),
            );
          }
          return finalizeRun();
        }
      } else if (shortConfirmDispatch.dispatch === 'pending_action') {
        const pending = shortConfirmDispatch.pending;
        emit(TelemetryEvents.PendingActionMatched, {
          request_id: requestId,
          scenario_id: context.session_id,
          pending_action_id: pending.id,
          kind: pending.action.kind,
          chip_id: pending.chip_id,
          candidate_count: 1,
        });
        // V5 G7/G8: apply_proposed_change carries an inline patch with a
        // handler_id, params and target entity ids. The synthesis helper
        // gates on graph-hash divergence and idempotency before we
        // proceed to handler dispatch — both can short-circuit into a
        // direct-answer recovery without an LLM round-trip.
        if (pending.action.kind === 'apply_proposed_change') {
          const decision = decideProposedChangeSynthesis({
            pending,
            currentGraphHash: freshness?.current_graph_hash ?? undefined,
            priorFactsWithTurn: context.prior_facts_with_turn,
          });
          if (
            decision.status === 'superseded' ||
            decision.status === 'already_applied' ||
            decision.status === 'invalid'
          ) {
            return commitProposedChangeRecovery(
              decision.status,
              `apply_proposed_change_${decision.status}`,
            );
          }
          // status === 'execute' falls through to handler dispatch
          // below, after we synthesise the ProposalAction.
        }
        // Synthesise a proposal entity that will pass the validator's
        // graph-existence check (line 281 of validator.ts). For
        // run_analysis and what_would_flip the validator accepts
        // ['option', 'goal']; pick the first available option, then
        // goal, from the graph. When no graph is present the
        // graph-dependent check is skipped — fall back to the scenario
        // id so the proposal is still well-formed.
        const pickEntity = (): {
          id: string;
          kind: 'option' | 'goal';
          label: string | null;
        } => {
          if (graphLookupForValidate) {
            const opts = graphLookupForValidate.listEntitiesByKind('option');
            if (opts.length > 0) {
              return { id: opts[0]!.id, kind: 'option', label: opts[0]!.label };
            }
            const goals = graphLookupForValidate.listEntitiesByKind('goal');
            if (goals.length > 0) {
              return { id: goals[0]!.id, kind: 'goal', label: goals[0]!.label };
            }
          }
          // No graph or no option/goal nodes: validator's graph-dependent
          // check is skipped, so any well-formed entity passes.
          return { id: context.session_id, kind: 'option', label: null };
        };
        const ent = pickEntity();
        const proposal: ProposalAction =
          pending.action.kind === 'run_analysis'
            ? {
                handler_id: 'run_analysis',
                entity: {
                  id: ent.id,
                  kind: ent.kind,
                  ...(ent.label !== null ? { label: ent.label } : {}),
                  resolution_status: 'resolved',
                  resolution_method: 'id_match',
                },
                parameters: [],
                cited_context_fields: ['graph.options'],
              }
            : pending.action.kind === 'what_would_flip'
              ? {
                  handler_id: 'what_would_flip',
                  entity: {
                    id: ent.id,
                    kind: ent.kind,
                    ...(ent.label !== null ? { label: ent.label } : {}),
                    resolution_status: 'resolved',
                    resolution_method: 'id_match',
                  },
                  parameters: [],
                  cited_context_fields: ['analysis.leading_option'],
                }
              : // apply_proposed_change — use inline_patch handler_id
                // and target. The synthesis helper above already
                // narrowed the kind and rejected invalid/superseded/
                // already-applied cases; here we know the patch is
                // executable. Pass the live graph lookup so the
                // synthesised entity.kind matches the graph-resolved
                // kind (validator runs both structural and per-entity
                // kind checks).
                buildApplyProposedChangeProposal(pending, ent, (id) =>
                  graphLookupForValidate ? graphLookupForValidate.findEntityById(id) : null,
                );
        const synthesisedRouting: RoutingResult = {
          type: 'tool_call',
          proposal: { intent_class: 'execute', action: proposal },
          orientationText: '',
          rawResult: {
            content: [],
            stop_reason: 'tool_use',
            usage: { input_tokens: 0, output_tokens: 0 },
            model: 'deterministic-short-confirm',
            latencyMs: 0,
          },
          llmCallCount: 0,
        };
        routingResult = synthesisedRouting;
        llmCallsUsed = 0;
        sonnetTextForLog = '';
        stagesCompleted.push('orient');
        // Track for the post-commit consumed telemetry — fire only
        // after the commit succeeds, never on validation/handler
        // failure.
        consumedPendingAction = pending;
      } else if (shortConfirmDispatch.dispatch === 'rerun_analysis_required') {
        // Freshness precondition failed: the user said "yes" to an
        // explore-result offer, but the analysis is no longer fresh.
        // Surface a focused recovery and offer to rerun analysis,
        // rather than running what_would_flip on stale data.
        const pending = shortConfirmDispatch.pending;
        emit(TelemetryEvents.PendingActionRerunAnalysisRequired, {
          request_id: requestId,
          scenario_id: context.session_id,
          pending_action_id: pending.id,
          kind: pending.action.kind,
        });
        const recoveryResponse = composeDirectAnswerResponse({
          assistant_text:
            "The analysis is no longer fresh, so the answer to 'what would change this' " +
            'might be misleading. Run analysis again first?',
          stage: context.stage,
          suggested_actions: [
            {
              id: 'chip_action_rerun_analysis',
              label: 'Rerun analysis',
              message: 'Rerun the analysis.',
              action_type: 'run_analysis',
            },
          ],
        });
        sonnetTextForLog = recoveryResponse.assistant_text;
        resolvedTurnClass = 'direct_answer';
        intentClass = 'converse';
        responseTypeForObs = 'direct_answer';
        llmCallsUsed = 0;
        stagesCompleted.push('orient');
        stagesCompleted.push('compose');
        try {
          const committed = await commitDirectAnswer(recoveryResponse, {
            scenario_id: context.session_id,
            turn_id: context.request_id,
            turn_class: 'direct_answer',
            handler_id: null,
            request_hash: computeRequestHash(payload),
            llm_calls_used: 0,
            duration_ms: Date.now() - startedAt,
            handler_facts: [],
          });
          commitPerformed = committed.performed;
          stagesCompleted.push('commit');
          response = committed.response;
        } catch (error) {
          log.error(
            {
              event: 'v5.state_commit_failed',
              request_id: requestId,
              session_id: context.session_id,
              path: 'short_confirm_rerun_analysis_required',
              err: serialiseError(error),
            },
            'V5 TurnExecutor commit failure on rerun-analysis-required recovery',
          );
          failureType = INTERNAL_TO_WIRE.STATE_COMMIT_FAILED;
          response = buildFailureResponse(
            'STATE_COMMIT_FAILED',
            context.stage,
            { phase: 'commit' },
            recoveryCtx(),
          );
        }
        return finalizeRun();
      } else if (shortConfirmDispatch.dispatch === 'recovery_expired') {
        emit(TelemetryEvents.PendingActionRecoveryExpired, {
          request_id: requestId,
          scenario_id: context.session_id,
          expired_count: shortConfirmDispatch.expired_count,
        });
        emit(TelemetryEvents.PendingActionExpired, {
          request_id: requestId,
          scenario_id: context.session_id,
          expired_count: shortConfirmDispatch.expired_count,
        });
        // The offer has lapsed. Recovery copy uses British English,
        // sentence case, no em dash. Run-analysis is offered as an
        // executable chip ONLY when the model is structurally ready
        // — surfacing it on a model that's missing options or goals
        // would just produce a PRECONDITION_UNMET on the next turn,
        // moving the failure rather than recovering from it.
        const modelReady = analysisReadyForTurn?.status === 'ready';
        const expiredAssistantText = modelReady
          ? "The offer I had open has lapsed, so I'm not sure what you want me to do. " +
            'You can run the analysis again, or tell me what to explore next.'
          : "The offer I had open has lapsed, so I'm not sure what you want me to do. " +
            'Tell me what to explore next.';
        const expiredChips: SuggestedAction[] = modelReady
          ? [
              {
                id: 'chip_action_run_analysis_after_expiry',
                label: 'Run analysis',
                message: 'Run the analysis.',
                action_type: 'run_analysis',
              },
            ]
          : [];
        const recoveryResponse = composeDirectAnswerResponse({
          assistant_text: expiredAssistantText,
          stage: context.stage,
          suggested_actions: expiredChips,
        });
        sonnetTextForLog = recoveryResponse.assistant_text;
        resolvedTurnClass = 'direct_answer';
        intentClass = 'converse';
        responseTypeForObs = 'direct_answer';
        llmCallsUsed = 0;
        stagesCompleted.push('orient');
        stagesCompleted.push('compose');
        try {
          const committed = await commitDirectAnswer(recoveryResponse, {
            scenario_id: context.session_id,
            turn_id: context.request_id,
            turn_class: 'direct_answer',
            handler_id: null,
            request_hash: computeRequestHash(payload),
            llm_calls_used: 0,
            duration_ms: Date.now() - startedAt,
            handler_facts: [],
          });
          commitPerformed = committed.performed;
          stagesCompleted.push('commit');
          response = committed.response;
        } catch (error) {
          log.error(
            {
              event: 'v5.state_commit_failed',
              request_id: requestId,
              session_id: context.session_id,
              path: 'short_confirm_recovery_expired',
              err: serialiseError(error),
            },
            'V5 TurnExecutor commit failure on expired-recovery',
          );
          failureType = INTERNAL_TO_WIRE.STATE_COMMIT_FAILED;
          response = buildFailureResponse(
            'STATE_COMMIT_FAILED',
            context.stage,
            { phase: 'commit' },
            recoveryCtx(),
          );
        }
        return finalizeRun();
      } else if (shortConfirmDispatch.dispatch === 'recovery_ambiguous') {
        emit(TelemetryEvents.PendingActionRecoveryAmbiguous, {
          request_id: requestId,
          scenario_id: context.session_id,
          candidate_count: shortConfirmDispatch.candidates.length,
          kinds: shortConfirmDispatch.candidates.map((c) => c.action.kind),
        });
        // Build one chip per candidate so the user can pick the
        // intended action. Chip messages are kind-specific so the
        // server can route them deterministically on the follow-up
        // turn (the chip's action_type carries the intent through
        // the chip_metadata channel the UI already round-trips).
        const ambiguousChips: SuggestedAction[] = shortConfirmDispatch.candidates.map(
          (cand, idx) => {
            if (cand.action.kind === 'run_analysis') {
              return {
                id: `chip_clarify_pending_${idx}`,
                label: 'Run analysis',
                message: 'Run the analysis.',
                action_type: 'run_analysis',
              };
            }
            if (cand.action.kind === 'what_would_flip') {
              return {
                id: `chip_clarify_pending_${idx}`,
                label: 'Explore what would change this',
                message: 'Explore what would change the result.',
                action_type: 'what_would_flip',
              };
            }
            // apply_proposed_change — surface the proposal's chip id
            // (the public proposal_ref) plus the user-facing label,
            // message and the intended public action_type derived
            // from the stored `inline_patch.handler_id`. Hard-coding
            // `add_constraint` would mis-render set_factor_value and
            // adjust_edge_strength proposals with the wrong wire
            // action type. Falls back to generic strings only for
            // legacy entries missing the persisted copy.
            // Pass-8 P1-1: render-copy resolution goes through ONE
            // helper so the strings the user sees are identical to
            // the strings the deterministic label/ordinal pre-route
            // matches against. Emit-time validation (see
            // compose/proposed-change.ts::emitProposedChange) is the
            // primary safety defence; the helper is the belt-and-
            // braces fallback for malformed, legacy, or pre-
            // validation entries that bypass the emit helper.
            const renderCopy = resolveProposalRenderCopy(cand.action);
            const persistedLabel = renderCopy.label;
            const persistedMessage = renderCopy.message;
            const inlineHandlerId =
              cand.action.kind === 'apply_proposed_change'
                ? (cand.action.inline_patch as { handler_id?: unknown })?.handler_id
                : undefined;
            // Use the shared helper so the ambiguous-chip wire
            // `action_type` is always one of the proposal-backing
            // V5ActionType literals. Falls back to add_constraint
            // only for legacy or malformed entries that lack a
            // resolvable handler_id (defence-in-depth — emit-time
            // validation prevents this in practice).
            const proposalActionType: 'add_constraint' | 'set_factor_value' | 'adjust_edge_strength' =
              isProposedChangeActionType(inlineHandlerId) ? inlineHandlerId : 'add_constraint';
            return {
              id: cand.chip_id,
              label: persistedLabel,
              message: persistedMessage,
              action_type: proposalActionType,
            };
          },
        );
        // V5 G7/G8: when every candidate is an apply_proposed_change,
        // try the deterministic ordinal / label pre-route ("the first
        // one", "option 2", exact label). If it matches, fall through
        // into the pending_action synthesis path with the resolved
        // candidate; otherwise emit the numbered clarification below.
        const allProposals = shortConfirmDispatch.candidates.every(
          (c) => c.action.kind === 'apply_proposed_change',
        );
        if (allProposals) {
          // Pass-8 P1-1: pass the same render copy the chips show.
          // The matcher uses both label AND message for exact-match
          // resolution, and demands an unambiguous unique match.
          const ordinal = tryProposalOrdinalSelect({
            message: resumerMessage,
            candidates: shortConfirmDispatch.candidates,
            candidateRenderCopy: ambiguousChips.map((c) => ({
              label: c.label,
              message: c.message,
            })),
          });
          if (ordinal.matched) {
            emit(TelemetryEvents.PendingActionMatched, {
              request_id: requestId,
              scenario_id: context.session_id,
              pending_action_id: ordinal.pending.id,
              kind: ordinal.pending.action.kind,
              chip_id: ordinal.pending.chip_id,
              candidate_count: shortConfirmDispatch.candidates.length,
            });
            const decision = decideProposedChangeSynthesis({
              pending: ordinal.pending,
              currentGraphHash: freshness?.current_graph_hash ?? undefined,
              priorFactsWithTurn: context.prior_facts_with_turn,
            });
            if (decision.status === 'execute') {
              const fallbackEnt = (() => {
                if (graphLookupForValidate) {
                  const opts = graphLookupForValidate.listEntitiesByKind('option');
                  if (opts.length > 0) {
                    return { id: opts[0]!.id, kind: 'option' as const, label: opts[0]!.label };
                  }
                }
                return { id: context.session_id, kind: 'option' as const, label: null };
              })();
              const proposalForOrdinal = buildApplyProposedChangeProposal(
                ordinal.pending,
                fallbackEnt,
                (id) =>
                  graphLookupForValidate ? graphLookupForValidate.findEntityById(id) : null,
              );
              routingResult = {
                type: 'tool_call',
                proposal: { intent_class: 'execute', action: proposalForOrdinal },
                orientationText: '',
                rawResult: {
                  content: [],
                  stop_reason: 'tool_use',
                  usage: { input_tokens: 0, output_tokens: 0 },
                  model: 'deterministic-short-confirm',
                  latencyMs: 0,
                },
                llmCallCount: 0,
              };
              llmCallsUsed = 0;
              sonnetTextForLog = '';
              stagesCompleted.push('orient');
              consumedPendingAction = ordinal.pending;
              // Fall through to the rest of TurnExecutor (validator,
              // handler dispatch). DO NOT return finalizeRun here.
            } else {
              // superseded / already_applied / invalid — emit the
              // matching deterministic recovery copy and finalise via
              // the shared helper.
              return commitProposedChangeRecovery(
                decision.status,
                `apply_proposed_change_ordinal_${decision.status}`,
              );
            }
          }
        }
        // No ordinal match (or candidates aren't all proposals) —
        // fall through to the numbered clarification below.
        // routingResult is `RoutingResult | undefined` (initialised
        // undefined at the top of the run); the ordinal branch above
        // only assigns it on a successful execute decision.
        if (routingResult !== undefined) {
          // Ordinal matched and synthesised a routing result; skip
          // the numbered-clarification commit. The handler-dispatch
          // path picks it up after this if/else block.
        } else {
        // V5 G7/G8 P1-1: when every candidate is a proposal with a
        // persisted public label, render the assistant text as a
        // numbered list of those labels so the user can read the
        // options as a list (per the brief: "Which one would you
        // like? 1) <label> 2) <label>"). Mixed-kind candidates fall
        // back to the generic prompt.
        const allCandidatesHaveLabels = ambiguousChips.every(
          (c) => c.label.length > 0 && c.label !== RENDER_SAFE_LABEL_FALLBACK,
        );
        const numberedList = ambiguousChips
          .map((c, i) => `${i + 1}) ${c.label}`)
          .join(' ');
        const ambiguousAssistantText = allCandidatesHaveLabels
          ? `Which one would you like? ${numberedList}`
          : 'I had more than one offer open. Which would you like?';
        const ambiguousResponse = composeDirectAnswerResponse({
          assistant_text: ambiguousAssistantText,
          stage: context.stage,
          suggested_actions: ambiguousChips,
        });
        sonnetTextForLog = ambiguousResponse.assistant_text;
        resolvedTurnClass = 'direct_answer';
        intentClass = 'converse';
        responseTypeForObs = 'direct_answer';
        llmCallsUsed = 0;
        stagesCompleted.push('orient');
        stagesCompleted.push('compose');
        try {
          // V5 G7/G8 P0-1 + P0-3: re-persist the apply_proposed_change
          // pending actions on the clarification turn so the
          // next-turn ordinal resolution ("the first one") has live
          // offers to match. For mixed ambiguity (a run_analysis or
          // what_would_flip pending action alongside a proposal), we
          // ALSO derive pending actions from the run_analysis /
          // what_would_flip ambiguous chips so those follow-up paths
          // remain resumable on the next turn — passing only the
          // proposals would suppress chip-derivation entirely.
          //
          // Identity is preserved across the re-persist: each
          // proposal's chip_id, proposal_ref, expires_at_iso are
          // unchanged. Wall-clock TTL still applies, so an offer
          // that would have expired before resume still expires.
          const proposalsToRepersist = shortConfirmDispatch.candidates.filter(
            (c) => c.action.kind === 'apply_proposed_change',
          );
          const chipDerivedForAmbiguous = derivePendingActionsFromChips(ambiguousChips, {
            scenario_id: context.session_id,
            emitted_at_iso: new Date().toISOString(),
            ...(freshness?.current_graph_hash != null
              ? { graph_hash: freshness.current_graph_hash }
              : {}),
          });
          const mergedPendingActions = [
            ...proposalsToRepersist,
            ...chipDerivedForAmbiguous,
          ];
          const committed = await commitDirectAnswer(ambiguousResponse, {
            scenario_id: context.session_id,
            turn_id: context.request_id,
            turn_class: 'direct_answer',
            handler_id: null,
            request_hash: computeRequestHash(payload),
            llm_calls_used: 0,
            duration_ms: Date.now() - startedAt,
            handler_facts: [],
            ...(mergedPendingActions.length > 0
              ? { pending_actions: mergedPendingActions }
              : {}),
          });
          commitPerformed = committed.performed;
          stagesCompleted.push('commit');
          response = committed.response;
        } catch (error) {
          log.error(
            {
              event: 'v5.state_commit_failed',
              request_id: requestId,
              session_id: context.session_id,
              path: 'short_confirm_recovery_ambiguous',
              err: serialiseError(error),
            },
            'V5 TurnExecutor commit failure on ambiguous-recovery',
          );
          failureType = INTERNAL_TO_WIRE.STATE_COMMIT_FAILED;
          response = buildFailureResponse(
            'STATE_COMMIT_FAILED',
            context.stage,
            { phase: 'commit' },
            recoveryCtx(),
          );
        }
        return finalizeRun();
        }
      }

      // V5 G7/G8 P1-1: live-proposal label/ordinal pre-route. Fires
      // when short-confirm returned matched=false. A user replying
      // with the proposal's exact public label ("Add the cost cap")
      // would otherwise hit the edit-verb gate on short-confirm and
      // fall through to the LLM, never reaching the recovery_ambiguous
      // ordinal-select branch. This pre-route runs the same helper
      // against ALL live apply_proposed_change candidates so an
      // exact-label or ordinal pick resolves deterministically
      // regardless of how short-confirm classified the message.
      if (!shortConfirmDispatch.matched) {
        const liveProposals = (context.most_recent_pending_actions ?? []).filter(
          (pa) => pa.action.kind === 'apply_proposed_change',
        );
        if (liveProposals.length > 0) {
          // Pass-8 P1-1: build the same render-copy the chip builder
          // would have produced and pass label AND message into the
          // matcher. This guarantees that:
          //   - the user matches on the same strings they would have
          //     seen (rendered fallback for unsafe persisted copy);
          //   - a chip-click replay carrying the message text
          //     resolves the same way as a typed label reply;
          //   - an unsafe persisted label cannot be silently matched
          //     by a user typing its raw form.
          // The matcher (`tryProposalOrdinalSelect`) ALSO requires
          // exactly one candidate to match (P1-2): two proposals
          // sharing the rendered fallback fall through to LLM rather
          // than silently executing the first.
          const liveRenderCopy = liveProposals.map((pa) =>
            resolveProposalRenderCopy(pa.action),
          );
          const labelPick = tryProposalOrdinalSelect({
            message: payload.message,
            candidates: liveProposals,
            candidateRenderCopy: liveRenderCopy.map((c) => ({
              label: c.label,
              message: c.message,
            })),
          });
          if (labelPick.matched) {
            emit(TelemetryEvents.PendingActionMatched, {
              request_id: requestId,
              scenario_id: context.session_id,
              pending_action_id: labelPick.pending.id,
              kind: labelPick.pending.action.kind,
              chip_id: labelPick.pending.chip_id,
              candidate_count: liveProposals.length,
            });
            const decision = decideProposedChangeSynthesis({
              pending: labelPick.pending,
              currentGraphHash: freshness?.current_graph_hash ?? undefined,
              priorFactsWithTurn: context.prior_facts_with_turn,
            });
            if (decision.status === 'execute') {
              const fallbackEnt = (() => {
                if (graphLookupForValidate) {
                  const opts = graphLookupForValidate.listEntitiesByKind('option');
                  if (opts.length > 0) {
                    return { id: opts[0]!.id, kind: 'option' as const, label: opts[0]!.label };
                  }
                }
                return { id: context.session_id, kind: 'option' as const, label: null };
              })();
              const proposalForLabel = buildApplyProposedChangeProposal(
                labelPick.pending,
                fallbackEnt,
                (id) =>
                  graphLookupForValidate ? graphLookupForValidate.findEntityById(id) : null,
              );
              routingResult = {
                type: 'tool_call',
                proposal: { intent_class: 'execute', action: proposalForLabel },
                orientationText: '',
                rawResult: {
                  content: [],
                  stop_reason: 'tool_use',
                  usage: { input_tokens: 0, output_tokens: 0 },
                  model: 'deterministic-short-confirm',
                  latencyMs: 0,
                },
                llmCallCount: 0,
              };
              llmCallsUsed = 0;
              sonnetTextForLog = '';
              stagesCompleted.push('orient');
              consumedPendingAction = labelPick.pending;
              // Fall through to handler dispatch.
            } else {
              return commitProposedChangeRecovery(
                decision.status,
                `apply_proposed_change_label_${decision.status}`,
              );
            }
          } else if (labelPick.reason === 'ambiguous') {
            // Pass-10 P1: the user's input matched the rendered label
            // or message of TWO OR MORE live proposals. Executing the
            // first would silently misroute. Falling through to the
            // LLM would lose the deterministic-routing contract. We
            // commit a numbered clarification listing the matching
            // candidates' rendered copy and re-persist them so the
            // user can disambiguate on the next turn.
            const ambiguousProposals = labelPick.ambiguousIndexes.map(
              (idx) => liveProposals[idx]!,
            );
            const ambiguousRenderCopy = labelPick.ambiguousIndexes.map(
              (idx) => liveRenderCopy[idx]!,
            );
            emit(TelemetryEvents.PendingActionRecoveryAmbiguous, {
              request_id: requestId,
              scenario_id: context.session_id,
              candidate_count: ambiguousProposals.length,
              kinds: ambiguousProposals.map((p) => p.action.kind),
            });
            // Build chips using the SAME rendered copy the user saw.
            // Each candidate's chip carries its persisted chip_id and
            // an action_type derived from its handler_id, matching
            // the format used by the recovery_ambiguous flow.
            const labelAmbiguousChips: SuggestedAction[] = ambiguousProposals.map(
              (cand, idx) => {
                const inlineHandlerId =
                  cand.action.kind === 'apply_proposed_change'
                    ? (cand.action.inline_patch as { handler_id?: unknown })?.handler_id
                    : undefined;
                const proposalActionType:
                  | 'add_constraint'
                  | 'set_factor_value'
                  | 'adjust_edge_strength' = isProposedChangeActionType(inlineHandlerId)
                  ? inlineHandlerId
                  : 'add_constraint';
                return {
                  id: cand.chip_id,
                  label: ambiguousRenderCopy[idx]!.label,
                  message: ambiguousRenderCopy[idx]!.message,
                  action_type: proposalActionType,
                };
              },
            );
            // Numbered clarification text uses the rendered labels
            // when at least one is distinct from the safe fallback;
            // otherwise the generic prompt — both labels equal the
            // fallback means the user's input matched the fallback
            // for every ambiguous candidate, and a numbered list of
            // identical strings would not help.
            const allLabelsAreFallback = labelAmbiguousChips.every(
              (c) => c.label === RENDER_SAFE_LABEL_FALLBACK,
            );
            const numberedList = labelAmbiguousChips
              .map((c, i) => `${i + 1}) ${c.label}`)
              .join(' ');
            const ambiguousAssistantText = allLabelsAreFallback
              ? 'I had more than one offer open. Which would you like?'
              : `Which one would you like? ${numberedList}`;
            const ambiguousResponse = composeDirectAnswerResponse({
              assistant_text: ambiguousAssistantText,
              stage: context.stage,
              suggested_actions: labelAmbiguousChips,
            });
            sonnetTextForLog = ambiguousResponse.assistant_text;
            resolvedTurnClass = 'direct_answer';
            intentClass = 'converse';
            responseTypeForObs = 'direct_answer';
            llmCallsUsed = 0;
            stagesCompleted.push('orient');
            stagesCompleted.push('compose');
            try {
              // Re-persist the ambiguous proposals so the next-turn
              // ordinal / label / message reply has live offers to
              // resolve. Identity preserved: chip_id, proposal_ref,
              // expires_at_iso unchanged; wall-clock TTL still
              // applies.
              const committed = await commitDirectAnswer(ambiguousResponse, {
                scenario_id: context.session_id,
                turn_id: context.request_id,
                turn_class: 'direct_answer',
                handler_id: null,
                request_hash: computeRequestHash(payload),
                llm_calls_used: 0,
                duration_ms: Date.now() - startedAt,
                handler_facts: [],
                pending_actions: ambiguousProposals,
              });
              commitPerformed = committed.performed;
              stagesCompleted.push('commit');
              response = committed.response;
            } catch (error) {
              log.error(
                {
                  event: 'v5.state_commit_failed',
                  request_id: requestId,
                  session_id: context.session_id,
                  path: 'apply_proposed_change_label_ambiguous',
                  err: serialiseError(error),
                },
                'V5 TurnExecutor commit failure on label-pre-route ambiguous clarification',
              );
              failureType = INTERNAL_TO_WIRE.STATE_COMMIT_FAILED;
              response = buildFailureResponse(
                'STATE_COMMIT_FAILED',
                context.stage,
                { phase: 'commit' },
                recoveryCtx(),
              );
            }
            return finalizeRun();
          }
        }
      }

      // V5 G7/G8: dismissal pre-route. Fires when short-confirm
      // returned matched=false (and the label/ordinal pre-route
      // above did not synthesise a routing result) and at least one
      // live apply_proposed_change pending action exists. The
      // negative-control gate ensures messages mixing dismissal with
      // positive tokens ("not now, but add it anyway") fall through
      // to the LLM.
      if (!shortConfirmDispatch.matched && routingResult === undefined) {
        const dismissal = tryProposalDismissal({
          message: payload.message,
          livePendingActions: context.most_recent_pending_actions ?? [],
        });
        if (dismissal.matched) {
          emit(TelemetryEvents.PendingActionRecoveryAmbiguous, {
            request_id: requestId,
            scenario_id: context.session_id,
            candidate_count: dismissal.dismissed_count,
            kinds: ['apply_proposed_change'],
          });
          const dismissalResponse = composeDirectAnswerResponse({
            assistant_text: PROPOSAL_DISMISSAL_RESPONSE,
            stage: context.stage,
            suggested_actions: [],
          });
          sonnetTextForLog = dismissalResponse.assistant_text;
          resolvedTurnClass = 'direct_answer';
          intentClass = 'converse';
          responseTypeForObs = 'direct_answer';
          llmCallsUsed = 0;
          stagesCompleted.push('orient');
          stagesCompleted.push('compose');
          try {
            const committed = await commitDirectAnswer(dismissalResponse, {
              scenario_id: context.session_id,
              turn_id: context.request_id,
              turn_class: 'direct_answer',
              handler_id: null,
              request_hash: computeRequestHash(payload),
              llm_calls_used: 0,
              duration_ms: Date.now() - startedAt,
              handler_facts: [],
            });
            commitPerformed = committed.performed;
            stagesCompleted.push('commit');
            response = committed.response;
          } catch (error) {
            log.error(
              {
                event: 'v5.state_commit_failed',
                request_id: requestId,
                session_id: context.session_id,
                path: 'proposal_dismissal',
                err: serialiseError(error),
              },
              'V5 TurnExecutor commit failure on proposal-dismissal',
            );
            failureType = INTERNAL_TO_WIRE.STATE_COMMIT_FAILED;
            response = buildFailureResponse(
              'STATE_COMMIT_FAILED',
              context.stage,
              { phase: 'commit' },
              recoveryCtx(),
            );
          }
          return finalizeRun();
        }
      }

      // Clarification-resume pre-route. A user who types just a
      // factor label after a value-update clarify ("Engineering Time
      // Commitment") would otherwise lose the parsed quantity from
      // the prior turn and fall through to the LLM. The resumer
      // reads the most-recent prior turn's pending actions and
      // reconstructs the proposal `tryDeterministicValueUpdate`
      // would have produced.
      //
      // Negative gates inside the module ensure messages with edit
      // verbs / quantities (handled by tryDeterministicValueUpdate)
      // and short-confirmations (handled by tryShortConfirmResume)
      // fall through unchanged.
      const clarificationDispatch = tryClarificationResume({
        message: payload.message,
        pendingActions: context.most_recent_pending_actions ?? [],
        graphLookup: graphLookupForValidate,
        nowMs: Date.now(),
        // Live graph hash (derived from the post-edit graph elsewhere
        // in this turn). When undefined and the persisted action
        // carried a hash precondition, the resumer treats this as a
        // hash conflict and falls through — the brief's "never
        // apply across scenarios / never apply on diverged graph"
        // contract.
        ...(freshness?.current_graph_hash != null
          ? { currentGraphHash: freshness.current_graph_hash }
          : {}),
      });
      if (
        clarificationDispatch.matched &&
        clarificationDispatch.dispatch === 'set_factor_value'
      ) {
        const pending = clarificationDispatch.pending;
        const action = pending.action;
        if (action.kind === 'set_factor_value') {
          emit(TelemetryEvents.PendingActionMatched, {
            request_id: requestId,
            scenario_id: context.session_id,
            pending_action_id: pending.id,
            kind: action.kind,
            chip_id: pending.chip_id,
            candidate_count: 1,
          });
          const liveTarget = graphLookupForValidate?.findEntityById(
            action.factor_id,
          );
          const proposal: ProposalAction = {
            handler_id: 'set_factor_value',
            entity: {
              id: action.factor_id,
              kind: 'node',
              ...(liveTarget?.label != null
                ? { label: liveTarget.label }
                : {}),
              resolution_status: 'resolved',
              resolution_method: 'id_match',
            },
            parameters: [
              {
                name: 'value',
                value:
                  action.unit !== undefined
                    ? { value: action.value, unit: action.unit }
                    : action.value,
                operator: action.operator,
                source: 'user_explicit',
                ...(action.unit !== undefined ? { unit: action.unit } : {}),
              },
            ],
            cited_context_fields: ['graph.nodes'],
          };
          const synthesisedRouting: RoutingResult = {
            type: 'tool_call',
            proposal: { intent_class: 'execute', action: proposal },
            orientationText: '',
            rawResult: {
              content: [],
              stop_reason: 'tool_use',
              usage: { input_tokens: 0, output_tokens: 0 },
              model: 'deterministic-clarification-resume',
              latencyMs: 0,
            },
            llmCallCount: 0,
          };
          routingResult = synthesisedRouting;
          llmCallsUsed = 0;
          sonnetTextForLog = '';
          stagesCompleted.push('orient');
          consumedPendingAction = pending;
        }
      } else if (clarificationDispatch.matched) {
        // Focused recovery dispatches — the resumer claimed the turn
        // but the persisted clarification is no longer applicable
        // (expired, graph mutated, targets removed, or the user's
        // reply is ambiguous between candidates). Compose a curated
        // direct_answer rather than letting the user's partial label
        // reach Sonnet with no clarification context — the LLM would
        // have to guess, and the brief's "every promise has an
        // executable path" rule says we should surface the lapse and
        // offer a real next step.
        let recoveryAssistantText: string;
        let recoveryChips: SuggestedAction[] = [];
        // Pending actions to re-persist on the recovery turn.
        // recovery_label_ambiguous re-emits the surviving candidate
        // pendings so a chip click on the next turn finds them on
        // `readMostRecentPendingActions` and can dispatch the original
        // quantity. The other recovery branches (expired, graph changed,
        // targets missing) deliberately persist nothing — the original
        // pendings are no longer safe to apply, so the next turn must
        // collect a fresh proposal from the user.
        let recoveryPendingActions: readonly PendingAction[] | undefined;
        let telemetryReason:
          | 'expired'
          | 'graph_changed'
          | 'targets_missing'
          | 'label_ambiguous';
        if (clarificationDispatch.dispatch === 'recovery_expired') {
          telemetryReason = 'expired';
          recoveryAssistantText =
            'The earlier question I asked has lapsed, so I’m no longer holding the value you wanted me to apply. Tell me again what you’d like to change and I’ll do it directly.';
        } else if (clarificationDispatch.dispatch === 'recovery_graph_changed') {
          telemetryReason = 'graph_changed';
          recoveryAssistantText =
            'The model has changed since I asked, so I can’t safely apply what I had ready. Tell me again what you’d like to change against the current model and I’ll do it directly.';
        } else if (
          clarificationDispatch.dispatch === 'recovery_targets_missing'
        ) {
          telemetryReason = 'targets_missing';
          recoveryAssistantText =
            'The factors I was asking about aren’t in the model any more. Tell me which factor you want to change and what value to set, and I’ll apply it.';
        } else {
          // recovery_label_ambiguous — emit one chip per candidate so
          // the user can disambiguate without retyping. No LLM call.
          // The chip's `message` is the candidate factor label; on
          // click, the next turn's resumer reads the re-persisted
          // pending actions, matches the label uniquely (the user
          // picked one), and dispatches the original quantity. Without
          // re-persisting the pendings, the chip click would lose the
          // quantity the user typed on the original turn.
          //
          // Invariant: reaching this branch implies the resumer's
          // hash-safety filter passed, which for set_factor_value
          // requires a non-undefined live hash (see
          // `graphHashConflicts` and the kind-classification table).
          // Therefore `freshness?.current_graph_hash` MUST be defined
          // here.
          //
          // Production safety: if the invariant is violated (a future
          // refactor of the resumer's gate ordering, or a bug we
          // haven't anticipated), we DO NOT throw — that would surface
          // a 500 BoundaryError to the user instead of a curated
          // recovery. Instead, log + emit telemetry + degrade to the
          // graph_changed recovery (no chips, no re-persistence). The
          // observability event names the invariant so the regression
          // is visible without harming UX.
          //
          // The route-level test `clarification-resume-route-level.test.ts`
          // asserts every re-persisted pending carries a non-empty
          // `preconditions.graph_hash`, which cordons against the
          // production case (pendings without hash never ship).
          const reEmitGraphHash = freshness?.current_graph_hash;
          if (reEmitGraphHash == null) {
            log.error(
              {
                event: 'v5.invariant_violation',
                invariant:
                  'recovery_label_ambiguous_requires_live_graph_hash',
                request_id: requestId,
                scenario_id: context.session_id,
              },
              'V5 TurnExecutor invariant violation: recovery_label_ambiguous reached with null live graph hash. ' +
                'Resumer gate ordering is wrong — degrading to graph_changed recovery to keep UX intact. ' +
                'Fix: re-check `graphHashConflicts` and the gate order in `tryClarificationResume`.',
            );
            emit(TelemetryEvents.PendingActionSkipped, {
              request_id: requestId,
              scenario_id: context.session_id,
              reason: 'clarification_recovery_invariant_violation',
            });
            telemetryReason = 'graph_changed';
            recoveryAssistantText =
              'The model has changed since I asked, so I can’t safely apply what I had ready. Tell me again what you’d like to change against the current model and I’ll do it directly.';
            // Fall through to the shared commit path below with no
            // chips and no re-persisted pendings.
          } else {
            telemetryReason = 'label_ambiguous';
            const labels = clarificationDispatch.candidates.map(
              (c) => c.factorLabel,
            );
            const labelList =
              labels.length === 2
                ? `${labels[0]} or ${labels[1]}`
                : `${labels.slice(0, -1).join(', ')}, or ${labels[labels.length - 1]}`;
            recoveryAssistantText = `Your reply matches more than one factor. Did you mean ${labelList}?`;
            recoveryChips = clarificationDispatch.candidates.map((c, idx) => ({
              id: `chip_clarify_factor_${idx}`,
              label: c.factorLabel,
              message: c.factorLabel,
            }));
            // Re-emit each surviving candidate pending so the chip
            // click on the next turn has something to resume. New id
            // + emit timestamp so the lifecycle treats this as a
            // fresh offer (turn-count and wall-clock TTLs reset). The
            // factor_id, value, unit, and operator are preserved
            // verbatim from the original clarify;
            // preconditions.graph_hash is re-stamped from the live
            // graph hash at recovery time so the next turn's
            // divergence guard reads the right baseline.
            const reEmitIso = new Date().toISOString();
            const reEmitExpiresIso = new Date(
              Date.parse(reEmitIso) + PENDING_ACTION_DEFAULT_WALL_TTL_MS,
            ).toISOString();
            recoveryPendingActions = clarificationDispatch.candidates.map(
              (c, idx): PendingAction => {
                const a = c.pending.action;
                if (a.kind !== 'set_factor_value') {
                  throw new Error(
                    `recovery_label_ambiguous: unexpected pending kind '${a.kind}'`,
                  );
                }
                return {
                  id: randomUUID(),
                  scenario_id: context.session_id,
                  chip_id: `chip_clarify_factor_${idx}`,
                  action: {
                    kind: 'set_factor_value',
                    factor_id: a.factor_id,
                    value: a.value,
                    ...(a.unit !== undefined ? { unit: a.unit } : {}),
                    operator: a.operator,
                  },
                  preconditions: {
                    target_entity_ids: [a.factor_id],
                    graph_hash: reEmitGraphHash,
                  },
                  expires_at_turn_count: PENDING_ACTION_DEFAULT_TURN_TTL,
                  expires_at_iso: reEmitExpiresIso,
                  emitted_at_iso: reEmitIso,
                };
              },
            );
          }
        }
        emit(TelemetryEvents.PendingActionSkipped, {
          request_id: requestId,
          scenario_id: context.session_id,
          reason: `clarification_recovery_${telemetryReason}`,
        });
        const recoveryResponse = composeDirectAnswerResponse({
          assistant_text: recoveryAssistantText,
          stage: context.stage,
          suggested_actions: recoveryChips,
        });
        sonnetTextForLog = recoveryResponse.assistant_text;
        resolvedTurnClass = 'direct_answer';
        intentClass = 'converse';
        responseTypeForObs = 'direct_answer';
        llmCallsUsed = 0;
        stagesCompleted.push('orient');
        stagesCompleted.push('compose');
        try {
          const committed = await commitDirectAnswer(recoveryResponse, {
            scenario_id: context.session_id,
            turn_id: context.request_id,
            turn_class: 'direct_answer',
            handler_id: null,
            request_hash: computeRequestHash(payload),
            llm_calls_used: 0,
            duration_ms: Date.now() - startedAt,
            handler_facts: [],
            ...(recoveryPendingActions !== undefined
              ? { pending_actions: recoveryPendingActions }
              : {}),
          });
          commitPerformed = committed.performed;
          stagesCompleted.push('commit');
          response = committed.response;
        } catch (error) {
          log.error(
            {
              event: 'v5.state_commit_failed',
              request_id: requestId,
              session_id: context.session_id,
              path: `clarification_resume_recovery_${telemetryReason}`,
              err: serialiseError(error),
            },
            'V5 TurnExecutor commit failure on clarification recovery',
          );
          failureType = INTERNAL_TO_WIRE.STATE_COMMIT_FAILED;
          response = buildFailureResponse(
            'STATE_COMMIT_FAILED',
            context.stage,
            { phase: 'commit' },
            recoveryCtx(),
          );
        }
        return finalizeRun();
      }

      // V5 explain-stabilisation Task 4 + V5 D1 golden-path closure
      // (A3.1 Task 1) — deterministic value-update pre-route. Catches
      // explicit "Set X to N" / "Increase Y to N" phrasings before
      // they reach the LLM. Two-path dispatch:
      //
      //   1. UNAMBIGUOUS factor + executable handler:
      //      Single substring match (score=1) on a 'factor'-kind
      //      node, AND set_factor_value is registered in both the
      //      active validation and handler registries. Synthesises
      //      a RoutingToolCallResult so the existing Step 2-7
      //      lifecycle (validate → execute → confirm → commit) runs
      //      unchanged. No LLM call, identical telemetry / fact /
      //      commit shape to a Sonnet-routed tool-call.
      //
      //   2. AMBIGUOUS / NON-FACTOR / NON-EXECUTABLE:
      //      Multi-candidate matches stay clarify; single-substring
      //      matches on a non-factor node downgrade to clarify
      //      (kind gate); any path that requires set_factor_value
      //      but cannot resolve it in the active registries
      //      downgrades to clarify (registry guard). Telemetry
      //      records the original pre-guard dispatch plus a
      //      `downgrade_reason`. Clarify chips fire from the
      //      existing branch; the chip click on the next turn
      //      re-enters Sonnet's normal routing.
      //
      //   3. NO MATCH:
      //      Negative gate suppresses on hypothetical phrasings
      //      ("what if budget increased"); no edit verb / no CQE
      //      quantity / no graph also short-circuits. Falls through
      //      to the LLM via routeWithToolUse.
      //
      // P0 V5 golden-path repair (Wave 2): compute factor-only selection
      // ids once for both the label-based (Path A — multi-candidate
      // narrowing) and deictic (Path B — "that factor") branches.
      // Filter strictly: only nodes whose graph kind is 'factor' qualify.
      // Selected option/risk/outcome/decision must NEVER be accepted as
      // a value-update target — the brief is explicit. We also capture
      // a label resolver for Path B receipts.
      const factorNodes = (graphStateForTurn?.nodes ?? []).filter(
        (n) => (n as { kind?: unknown }).kind === 'factor',
      ) as ReadonlyArray<{ id: string; label?: unknown; kind: string }>;
      const factorIdSet = new Set(factorNodes.map((n) => n.id));
      const factorLabelById = new Map(
        factorNodes
          .filter((n) => typeof n.label === 'string' && (n.label as string).trim().length > 0)
          .map((n) => [n.id, n.label as string]),
      );
      const selectedFactorIds: readonly string[] = (options.selectedElements?.node_ids ?? []).filter(
        (id) => factorIdSet.has(id),
      );

      // Pure detection function; the guards + dispatch live in this
      // executor.
      let deterministicValueUpdate = tryDeterministicValueUpdate(
        payload.message,
        contextPack.parsed_quantities,
        graphLookupForValidate,
        selectedFactorIds,
      );

      // P0 V5 golden-path repair (Wave 2, Path B — selected-deictic):
      // when the user wrote "Update that factor to £30k" or similar
      // with no label evidence, use UI selection to resolve the target.
      // Runs only when label-based detection did NOT match — otherwise
      // the existing single-substring or selection-narrowed dispatch
      // wins (selection is also a tie-breaker for label-based ambiguous
      // cases, handled inside `tryDeterministicValueUpdate`).
      const deicticDispatch = !deterministicValueUpdate.matched
        ? tryDeicticValueUpdate(
            payload.message,
            contextPack.parsed_quantities,
            graphLookupForValidate,
            selectedFactorIds,
            (id) => factorLabelById.get(id) ?? null,
          )
        : { matched: false as const, skip_reason: 'no_deictic' as const };
      if (deicticDispatch.matched && deicticDispatch.dispatch === 'set_factor_value') {
        // Promote to the Path A shape so the rest of the lifecycle
        // (registry guard, synthesised RoutingToolCallResult, etc.)
        // reuses the existing branch with no duplication.
        deterministicValueUpdate = {
          matched: true,
          dispatch: 'set_factor_value',
          candidate: deicticDispatch.candidate,
          quantity: deicticDispatch.quantity,
        };
      }
      // V5 D1 golden-path closure (A3.1): the original (pre-guard)
      // dispatch is what the pre-route function alone would have
      // produced. The guards below (kind check + registry executable)
      // may downgrade `set_factor_value` to clarify, in which case
      // telemetry needs to record both the original candidate AND the
      // reason the downgrade fired so dashboards see the final
      // dispatch path, not just the pre-guard candidate. The single
      // emit at the end of the block carries `downgrade_reason` when
      // a downgrade fired.
      const originalDispatch = deterministicValueUpdate.matched
        ? deterministicValueUpdate.dispatch
        : null;
      let downgradeReason:
        | 'non_factor_kind'
        | 'handler_not_executable'
        | null = null;
      if (
        deterministicValueUpdate.matched &&
        deterministicValueUpdate.dispatch === 'set_factor_value'
      ) {
        // V5 D1 golden-path closure (A3.1): unambiguous match — exactly
        // one substring-matched candidate. Verify the candidate's actual
        // node kind is 'factor' before dispatching the handler.
        // GraphLookup buckets factor/outcome/decision/risk/action under
        // EntityKind 'node', so we re-resolve the kind from raw graph
        // state. Non-factor matches fall through to the existing clarify
        // path (handled by the `dispatch === 'clarify'` branch below).
        //
        // Shared execution path: rather than invoking the handler
        // directly, we synthesise a `RoutingToolCallResult` and let the
        // existing Step 2-7 lifecycle (validate → execute → confirm →
        // coach → compose → commit) run unchanged. Telemetry, fact
        // shape, commit shape are identical to a Sonnet-routed
        // tool-call.
        const candidate = deterministicValueUpdate.candidate;
        const nodeKind = (graphStateForTurn?.nodes ?? []).find(
          (n) => (n as { id?: unknown }).id === candidate.id,
        ) as { kind?: unknown } | undefined;
        const isFactor =
          typeof nodeKind?.kind === 'string' && nodeKind.kind === 'factor';
        // V5 D1 golden-path closure (A3.1) — registry guard:
        // Only synthesise the deterministic dispatch when the active
        // validation AND handler registries can actually execute
        // `set_factor_value`. Without this guard, a misconfigured
        // executor (test override that omits the handler, or a future
        // build that gates handler registration on a flag) would
        // produce a synthesised handler turn that fails at execute
        // time with HANDLER_NOT_FOUND. Falling through to clarify is
        // the safe degradation — the chip click on the next turn
        // re-enters Sonnet's normal routing.
        //
        // Order matters: the kind check is cheap (an array find),
        // the registry resolution may invoke `getDefaultRegistry()`
        // which constructs the production PLoT client on first call.
        // Short-circuiting on `isFactor === false` skips the
        // registry resolution for clarify-bound non-factor matches
        // and avoids unnecessary PLoT client init on the
        // clarify-only path.
        let handlerExecutable = false;
        if (isFactor) {
          const activeValidationRegistry =
            options.validationRegistry ?? HANDLER_VALIDATION_REGISTRY;
          const activeHandlerRegistry = options.handlerRegistry ?? getDefaultRegistry();
          handlerExecutable =
            activeValidationRegistry.set_factor_value !== undefined &&
            resolveHandler(activeHandlerRegistry, 'set_factor_value') !== null;
        }
        if (isFactor && handlerExecutable) {
          const { value: userUnitValue, unit } = mapCqeQuantityToProposalValue(
            deterministicValueUpdate.quantity,
          );
          const operator = deriveOperator(payload.message, deterministicValueUpdate.quantity);
          const proposal: ProposalAction = {
            handler_id: 'set_factor_value',
            entity: {
              id: candidate.id,
              kind: 'node',
              label: candidate.label,
              resolution_status: 'resolved',
              resolution_method: 'label_match',
            },
            parameters: [
              {
                name: 'value',
                value: unit !== undefined ? { value: userUnitValue, unit } : userUnitValue,
                operator,
                source: 'user_explicit',
                ...(unit !== undefined ? { unit } : {}),
              },
            ],
            cited_context_fields: ['graph.nodes'],
          };
          // Synthesise a RoutingToolCallResult so the existing Step 2-7
          // lifecycle treats this exactly like a Sonnet-emitted tool
          // call. The `usage` shape is the canonical `UsageMetrics`
          // interface — zero values are accurate (no LLM tokens
          // consumed on the deterministic path), and a properly typed
          // stub avoids an `as unknown as` cast at the boundary.
          const deterministicUsage: UsageMetrics = {
            input_tokens: 0,
            output_tokens: 0,
          };
          const synthesisedRouting: RoutingToolCallResult = {
            type: 'tool_call',
            proposal: { intent_class: 'execute', action: proposal },
            orientationText: '',
            rawResult: {
              content: [],
              stop_reason: 'tool_use',
              usage: deterministicUsage,
              model: 'deterministic-value-update',
              latencyMs: 0,
            },
            llmCallCount: 0,
          };
          routingResult = synthesisedRouting;
          llmCallsUsed = 0;
          sonnetTextForLog = '';
          stagesCompleted.push('orient');
          // Skip the routeWithToolUse call below; control falls through
          // to STEP 2 (validate) → STEP 3 (execute) → STEP 7 (commit).
        } else {
          // Either the candidate is non-factor (outcome, risk,
          // decision, action — the kind gate per brief correction #3),
          // OR the active registries cannot execute set_factor_value
          // (registry guard — protects against misconfigured executors
          // and future flag-gated handler registration). In both cases
          // fall back to clarify so the user disambiguates / the chip
          // click on the next turn re-enters Sonnet's normal routing.
          // The `downgrade_reason` is recorded for the telemetry emit
          // below so dashboards see why the dispatch flipped.
          downgradeReason = !isFactor ? 'non_factor_kind' : 'handler_not_executable';
          deterministicValueUpdate = {
            matched: true,
            dispatch: 'clarify',
            candidates: [candidate],
            quantity: deterministicValueUpdate.quantity,
          };
        }
      }

      // V5 D1 golden-path closure (A3.1): widen telemetry to handle
      // the `set_factor_value` dispatch variant (single `candidate`,
      // not `candidates[]`) AND surface the post-guard final
      // dispatch so dashboards reflect what actually ran rather than
      // the pre-guard candidate. `original_dispatch` is preserved for
      // observability when a downgrade fires.
      const telemetryCandidates = deterministicValueUpdate.matched
        ? deterministicValueUpdate.dispatch === 'set_factor_value'
          ? [deterministicValueUpdate.candidate]
          : deterministicValueUpdate.candidates
        : [];
      emit(TelemetryEvents.V5DeterministicValueUpdate, {
        request_id: requestId,
        scenario_id: context.session_id,
        matched: deterministicValueUpdate.matched,
        dispatch: deterministicValueUpdate.matched
          ? deterministicValueUpdate.dispatch
          : null,
        original_dispatch: originalDispatch,
        downgrade_reason: downgradeReason,
        candidate_count: telemetryCandidates.length,
        top_score: telemetryCandidates[0]?.score ?? null,
        // Per-candidate source tags ('substring' | 'dice') so routing
        // diagnostics can distinguish exact-label hits from fuzzy hits
        // without inferring from `score`.
        candidate_sources: telemetryCandidates.map((c) => c.source),
        skip_reason: deterministicValueUpdate.matched
          ? null
          : deterministicValueUpdate.skip_reason,
        cqe_quantity_count: contextPack.parsed_quantities.length,
      });

      // P0 V5 golden-path repair (Wave 2, Path B clarify) — deictic
      // reference matched but selection didn't yield exactly one factor.
      // Dispatch a no-chip clarify so the user provides a clearer
      // target. We do NOT route through `edit_graph` for any of this.
      if (
        deicticDispatch.matched &&
        deicticDispatch.dispatch === 'clarify_deictic'
      ) {
        const clarifyResponse = composeDirectAnswerResponse({
          assistant_text: buildDeicticClarifyAssistantText(deicticDispatch.reason),
          stage: context.stage,
          suggested_actions: [],
        });
        sonnetTextForLog = clarifyResponse.assistant_text;
        resolvedTurnClass = 'direct_answer';
        intentClass = 'converse';
        responseTypeForObs = 'direct_answer';
        llmCallsUsed = 0;
        stagesCompleted.push('orient');
        stagesCompleted.push('compose');
        emit(TelemetryEvents.V5DeterministicValueUpdate, {
          request_id: requestId,
          scenario_id: context.session_id,
          matched: true,
          dispatch: 'clarify_deictic',
          original_dispatch: 'clarify_deictic',
          downgrade_reason: null,
          candidate_count: 0,
          top_score: null,
          candidate_sources: [],
          skip_reason: null,
          deictic_reason: deicticDispatch.reason,
          selected_factor_count: selectedFactorIds.length,
          cqe_quantity_count: contextPack.parsed_quantities.length,
        });
        try {
          const committed = await commitDirectAnswer(clarifyResponse, {
            scenario_id: context.session_id,
            turn_id: context.request_id,
            turn_class: 'direct_answer',
            handler_id: null,
            request_hash: computeRequestHash(payload),
            llm_calls_used: 0,
            duration_ms: Date.now() - startedAt,
            handler_facts: [],
          });
          commitPerformed = committed.performed;
          stagesCompleted.push('commit');
          response = committed.response;
        } catch (error) {
          log.error(
            {
              event: 'v5.state_commit_failed',
              request_id: requestId,
              session_id: context.session_id,
              path: 'deictic_value_update_clarify',
              err: serialiseError(error),
            },
            'V5 TurnExecutor commit failure on deictic-clarify pre-route',
          );
          failureType = INTERNAL_TO_WIRE.STATE_COMMIT_FAILED;
          response = buildFailureResponse(
            'STATE_COMMIT_FAILED',
            context.stage,
            { phase: 'commit' },
            recoveryCtx(),
          );
        }
        return finalizeRun();
      }

      if (
        deterministicValueUpdate.matched &&
        deterministicValueUpdate.dispatch === 'clarify'
      ) {
        // Dispatch a clarify-shape direct_answer. No LLM call, no handler
        // fact persisted — the user's chip click on the next turn is what
        // produces a real factor reference for the LLM to act on.
        const clarifyChips: SuggestedAction[] = deterministicValueUpdate.candidates.map(
          (cand, idx) => ({
            id: `chip_clarify_factor_${idx}`,
            label: cand.label,
            message: buildClarifyChipMessage(
              payload.message,
              cand,
              deterministicValueUpdate.quantity,
            ),
          }),
        );
        // Persist set_factor_value pending actions (one per candidate)
        // carrying the parsed quantity + operator from this turn so the
        // clarification-resume pre-route on the next turn can
        // reconstruct the proposal `tryDeterministicValueUpdate` would
        // have produced.
        //
        // `preconditions.graph_hash` captures the live graph hash at
        // emit time. The resumer treats a mismatched live hash on the
        // reply turn as a precondition violation and falls through to a
        // focused recovery rather than applying the original quantity
        // to a graph the client has since edited (e.g. via a
        // direct_graph_edit between clarify and reply). Without this
        // hash there is no way to detect that divergence — the
        // target_entity_ids alone only verify that the factor still
        // exists by id, not that the surrounding model is unchanged.
        const clarifyEmittedAtIso = new Date().toISOString();
        const clarifyExpiresAtIso = new Date(
          Date.parse(clarifyEmittedAtIso) + PENDING_ACTION_DEFAULT_WALL_TTL_MS,
        ).toISOString();
        const { value: userUnitValue, unit } = mapCqeQuantityToProposalValue(
          deterministicValueUpdate.quantity,
        );
        const operator = deriveOperator(payload.message, deterministicValueUpdate.quantity);
        const clarifyEmitGraphHash = freshness?.current_graph_hash;
        const clarifyPendingActions = deterministicValueUpdate.candidates.map(
          (cand, idx): PendingAction => ({
            id: randomUUID(),
            scenario_id: context.session_id,
            chip_id: `chip_clarify_factor_${idx}`,
            action: {
              kind: 'set_factor_value',
              factor_id: cand.id,
              value: userUnitValue,
              ...(unit !== undefined ? { unit } : {}),
              operator,
            },
            preconditions: {
              target_entity_ids: [cand.id],
              ...(clarifyEmitGraphHash != null
                ? { graph_hash: clarifyEmitGraphHash }
                : {}),
            },
            expires_at_turn_count: PENDING_ACTION_DEFAULT_TURN_TTL,
            expires_at_iso: clarifyExpiresAtIso,
            emitted_at_iso: clarifyEmittedAtIso,
          }),
        );
        const clarifyResponse = composeDirectAnswerResponse({
          assistant_text: buildClarifyAssistantText(deterministicValueUpdate.candidates),
          stage: context.stage,
          suggested_actions: clarifyChips,
        });
        sonnetTextForLog = clarifyResponse.assistant_text;
        resolvedTurnClass = 'direct_answer';
        intentClass = 'converse';
        responseTypeForObs = 'direct_answer';
        llmCallsUsed = 0;
        stagesCompleted.push('orient');
        stagesCompleted.push('compose');

        try {
          const committed = await commitDirectAnswer(clarifyResponse, {
            scenario_id: context.session_id,
            turn_id: context.request_id,
            turn_class: 'direct_answer',
            handler_id: null,
            request_hash: computeRequestHash(payload),
            llm_calls_used: 0,
            duration_ms: Date.now() - startedAt,
            handler_facts: [],
            pending_actions: clarifyPendingActions,
          });
          commitPerformed = committed.performed;
          stagesCompleted.push('commit');
          response = committed.response;
        } catch (error) {
          log.error(
            {
              event: 'v5.state_commit_failed',
              request_id: requestId,
              session_id: context.session_id,
              path: 'deterministic_value_update',
              err: serialiseError(error),
            },
            'V5 TurnExecutor commit failure on deterministic value-update pre-route',
          );
          failureType = INTERNAL_TO_WIRE.STATE_COMMIT_FAILED;
          response = buildFailureResponse(
            'STATE_COMMIT_FAILED',
            context.stage,
            { phase: 'commit' },
            recoveryCtx(),
          );
        }
        return finalizeRun();
      }

      // V5 product-state continuity (foamy-bee tranche) — deterministic
      // state-query guard. Closes the named "what update did you make?"
      // misroute class where a state-query falls through every other
      // pre-route, reaches the LLM with no mutation context, and
      // routes to legacy edit_graph (which then emits the denial copy
      // "No changes were needed for this request."). The guard runs
      // AFTER the existing pre-routes (which won't match a state-query
      // — their negative gates exclude messages without edit verbs or
      // quantities) and BEFORE the LLM call.
      //
      // When matched, the turn is dispatched as a `direct_answer` with
      // assistant_text grounded in `contextPack.recent_changes` — no LLM
      // call. When unmatched, control falls through to `routeWithToolUse`
      // unchanged; in the unmatched-but-mutation-exists case Sonnet still
      // sees the same `recent_changes` projection and can ground its
      // answer (Option B layered with this guard's Option A floor).
      if (routingResult === undefined) {
        const stateQueryOutcome = tryStateQueryGuard({
          message: payload.message,
          contextPack,
        });

        // The successful-mutation count is computed once at function
        // entry (see `priorMutationFactCountForLog`) so the routing log
        // is correct even when an earlier pre-route synthesised a
        // routing result before the guard ran. Reuse the same value
        // here for the per-event telemetry payload.
        stateQueryGuardOutcomeForLog = stateQueryOutcome.matched
          ? stateQueryOutcome.dispatch
          : 'unmatched';

        emit(TelemetryEvents.V5StateQueryGuard, {
          request_id: requestId,
          scenario_id: context.session_id,
          matched: stateQueryOutcome.matched,
          dispatch: stateQueryOutcome.matched
            ? stateQueryOutcome.dispatch
            : null,
          recent_change_count: contextPack.recent_changes.length,
          prior_mutation_fact_count: priorMutationFactCountForLog,
        });

        if (stateQueryOutcome.matched) {
          // Compose the state-query continuity chip INLINE (do not call
          // generateChips with empty handlerFacts + priorFacts). The
          // chip-generator's post-mutation rule is now scoped to the
          // current turn's handlerFacts only, so a generic converse
          // turn with stale priorFacts cannot accidentally surface a
          // "Run analysis" chip on every subsequent turn. The
          // state-query guard knows it just dispatched, so it owns the
          // chip decision here and applies the same Run / Rerun
          // analysis logic deterministically.
          const stateQueryChips = composeStateQueryChip({
            recentChangeCount: contextPack.recent_changes.length,
            priorFacts: context.prior_facts,
            analysisFreshness: buildTurnOutcome()?.analysis_freshness,
            analysisReadyStatus: analysisReadyForTurn?.status,
            validationRegistry:
              options.validationRegistry ?? HANDLER_VALIDATION_REGISTRY,
          });
          const stateQueryResponse = composeDirectAnswerResponse({
            assistant_text: stateQueryOutcome.assistant_text,
            stage: context.stage,
            suggested_actions: stateQueryChips,
          });
          sonnetTextForLog = stateQueryResponse.assistant_text;
          resolvedTurnClass = 'direct_answer';
          intentClass = 'converse';
          responseTypeForObs = 'direct_answer';
          llmCallsUsed = 0;
          stagesCompleted.push('orient');
          stagesCompleted.push('compose');
          try {
            const committed = await commitDirectAnswer(stateQueryResponse, {
              scenario_id: context.session_id,
              turn_id: context.request_id,
              turn_class: 'direct_answer',
              handler_id: null,
              request_hash: computeRequestHash(payload),
              llm_calls_used: 0,
              duration_ms: Date.now() - startedAt,
              handler_facts: [],
            });
            commitPerformed = committed.performed;
            stagesCompleted.push('commit');
            response = committed.response;
          } catch (error) {
            log.error(
              {
                event: 'v5.state_commit_failed',
                request_id: requestId,
                session_id: context.session_id,
                path: 'state_query_guard',
                err: serialiseError(error),
              },
              'V5 TurnExecutor commit failure on state-query guard',
            );
            failureType = INTERNAL_TO_WIRE.STATE_COMMIT_FAILED;
            response = buildFailureResponse(
              'STATE_COMMIT_FAILED',
              context.stage,
              { phase: 'commit' },
              recoveryCtx(),
            );
          }
          return finalizeRun();
        }
      }

      // V5 D1 golden-path closure (A3.1): when the deterministic pre-route
      // already synthesised a `routingResult` (unambiguous factor + value
      // case), skip the LLM call entirely. The synthetic result already
      // carries `orientationText: ''` and `llmCallCount: 0`, and the
      // 'orient' stage marker has been pushed.
      if (routingResult === undefined) {
        // E4 evidence — pre-LLM hash + presence + count for the curated
        // `recent_changes` projection. Fires here, AFTER any deterministic
        // pre-route has had its chance to short-circuit (so the event only
        // appears on turns that actually go to the LLM) and BEFORE the
        // routeWithToolUse call (so the payload is captured at the moment
        // it is handed to routing). Never logs the curated content.
        //
        // Presence is derived at runtime from the actual contextPack
        // shape via {@link deriveRecentChangesEvidence} — if a future
        // assembler regression dropped the field or emitted it as a
        // non-array, the event would record `field_present: false`,
        // count 0, and the empty-sentinel hash, making the regression
        // detectable from logs without a code-search.
        const recentChangesEvidence = deriveRecentChangesEvidence(contextPack);
        emit(TelemetryEvents.V5RecentChangesPreLlm, {
          request_id: requestId,
          scenario_id: context.session_id,
          recent_change_count: recentChangesEvidence.count,
          recent_changes_field_present: recentChangesEvidence.field_present,
          recent_changes_hash: recentChangesEvidence.hash,
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
      }
    } catch (error) {
      if (turnAbort.signal.aborted) {
        failureType = INTERNAL_TO_WIRE.BUDGET_EXCEEDED;
        response = buildFailureResponse(
          'BUDGET_EXCEEDED',
          context.stage,
          { budget_ms: context.budgets.turn_ms },
          recoveryCtx(),
        );
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
      response = buildFailureResponse(
        'UNHANDLED',
        context.stage,
        { reason: 'unexpected_routing_error' },
        recoveryCtx(),
      );
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
      proposedHandlerIdForOutcome = action.handler_id;

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
      handlerProposedForObs = proposedHandlerId;
      const validationResult = validateToolCall(
        action,
        graphLookupForValidate,
        validationRegistry,
      );
      stagesCompleted.push('validate');
      if (!graphLookupForValidate) {
        stagesCompleted.push('validate_skipped_no_graph');
        log.info(
          {
            request_id: requestId,
            v5_journey_id: v5JourneyId,
            handler_id: proposedHandlerId,
            stage: context.stage,
          },
          'V5 TurnExecutor graph-dependent validation skipped — no graph on this turn',
        );
      }
      validatorOutcomeForObs = validationResult.valid
        ? 'valid'
        : validationResult.error.code;
      // V5 alpha hardening Phase 2.5: primary lifecycle event. Fires
      // exactly once per validator run (valid or error) with the full
      // obs field set so one query can filter by validator_outcome.
      emit(
        TelemetryEvents.ValidatorOutcome,
        obsPayload({
          valid: validationResult.valid,
          graph_available: graphLookupForValidate != null,
        }),
      );
      if (!validationResult.valid) {
        validationErrorCode = validationResult.error.code;
        // V5 alpha hardening follow-up (P1-2): the raw ValidationError
        // details payload carries user-authored labels (candidates[].label,
        // proposed_label, entity_label, resolved_label, chosen/closer
        // label fields) and free-text parameter values (actual_value,
        // constraint issue strings) — these are user decision text and
        // MUST NOT land in logs per principle 3. Whitelist-build a safe
        // subset: codes, enum-valued kinds, system ids, counts, hashes.
        log.warn(
          {
            request_id: requestId,
            v5_journey_id: v5JourneyId,
            validation_error_code: validationResult.error.code,
            safe_details: buildSafeValidatorLogDetails(validationResult.error),
          },
          'V5 TurnExecutor validation rejected tool-call proposal',
        );
        const composeCtx: ComposeContext = {
          graph: graphLookupForValidate,
          handlerRegistry: validationRegistry,
        };

        // V5 alpha hardening Phase 2.2: EVERY validator outcome is a
        // Sonnet imperfection, not an infrastructure fault. Per principle 1
        // (deterministic layer is a safety net, not a cage) and per Paul's
        // locked-in decision, all 7 codes recover as 200 + coaching
        // committed as a direct_answer turn. HANDLER_NOT_FOUND continues to
        // use its dedicated category-aware composer
        // (`composeUnsupportedActionResponse`); the other 6 share the
        // per-code composer map via `composeRecoverableValidationResponse`.
        // Commit failure remains fatal (Part B of the resilience contract).
        //
        // The `composeValidationFailure` + 500 path is kept as an
        // impossible-state safety net: if the composer map ever returns
        // `template_id: 'unknown_validation_code'` we fail loudly with a
        // BoundaryError rather than silently committing a generic reply.
        const recoverableCode = validationResult.error.code;
        let recoveredResponse: OlumiResponse;
        let recoveredTemplateId: string;
        let recoveredChipType: 'action' | 'text_prompt' | 'entity_suggestion' | null;

        if (recoverableCode === 'HANDLER_NOT_FOUND') {
          const unsupported = composeUnsupportedActionResponse({
            handlerId: action.handler_id,
            context: composeCtx,
            stage: context.stage,
            hasAnalysis: options.analysisState != null,
          });
          recoveredResponse = unsupported.response;
          recoveredTemplateId = unsupported.templateId;
          recoveredChipType =
            unsupported.response.suggested_actions.some((c) => c.action_type != null)
              ? 'action'
              : 'text_prompt';
        } else {
          const recovered = composeRecoverableValidationResponse(
            validationResult.error,
            composeCtx,
            context.stage,
          );
          recoveredResponse = recovered.response;
          recoveredTemplateId = recovered.template_id;
          recoveredChipType = recovered.chip_type;
        }

        // Impossible-state guard (correction 8): if composeBody's fallback
        // fired, the map is out of sync with ValidationErrorCode. Fail
        // loudly via the legacy 500 wrapper so the problem surfaces in
        // deploys instead of masquerading as a normal turn.
        if (recoveredTemplateId === 'unknown_validation_code') {
          log.error(
            {
              event: 'assert_unknown_validation_code',
              request_id: requestId,
              validation_error_code: recoverableCode,
            },
            'V5 TurnExecutor hit impossible-state composer fallback — returning 500',
          );
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
            error_code: recoverableCode,
            template_used: composed.template_id,
            chip_attached: composed.response.suggested_actions.length > 0,
            chip_type: composed.chip_type,
            chip_count: composed.response.suggested_actions.length,
          });
          return finalizeRun();
        }

        response = recoveredResponse;
        resolvedTurnClass = 'direct_answer';
        responseTypeForObs = 'direct_answer';
        intentClass = 'converse';
        stagesCompleted.push('validator_recovery');

        emit(TelemetryEvents.TurnExecutorFailureResponse, {
          request_id: requestId,
          session_id: context.session_id,
          stage: context.stage,
          failure_origin: 'validator',
          error_code: recoverableCode,
          template_used: recoveredTemplateId,
          chip_attached: recoveredResponse.suggested_actions.length > 0,
          chip_type: recoveredChipType,
          chip_count: recoveredResponse.suggested_actions.length,
        });
        // V5 alpha hardening Phase 2.5: primary lifecycle event —
        // recovery_response fires when a validator outcome is composed
        // into a clean-body direct_answer. One query reveals every
        // recovery across the journey.
        emit(
          TelemetryEvents.RecoveryResponse,
          obsPayload({
            validation_error_code: recoverableCode,
            template_used: recoveredTemplateId,
            chip_type: recoveredChipType,
            chip_count: recoveredResponse.suggested_actions.length,
          }),
        );

        // Commit as a direct_answer so route-v2 sees commit_performed=true
        // and returns 200. Commit failure on a recoverable path is still
        // fatal — BUT the original recoverable outcome is logged
        // separately from the commit failure so infrastructure issues
        // are not hidden behind resilience (correction 10 / Part B of
        // the resilience contract).
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
          // Log the ORIGINAL recoverable outcome as one record...
          log.warn(
            {
              event: 'v5.recoverable_outcome_pre_commit_failure',
              request_id: requestId,
              session_id: context.session_id,
              validation_error_code: recoverableCode,
              template_used: recoveredTemplateId,
            },
            'V5 TurnExecutor recoverable outcome before commit failure',
          );
          // ...and the commit failure as a distinct record. Two lines,
          // not one combined record, so a log query can find each
          // independently. Both are queryable by request_id.
          log.error(
            {
              event: 'v5.state_commit_failed',
              request_id: requestId,
              session_id: context.session_id,
              validation_error_code: recoverableCode,
              err: serialiseError(error),
            },
            'V5 TurnExecutor commit failure on recoverable validator path',
          );
          failureType = INTERNAL_TO_WIRE.STATE_COMMIT_FAILED;
          response = buildFailureResponse(
            'STATE_COMMIT_FAILED',
            context.stage,
            { phase: 'commit' },
            recoveryCtx(),
          );
        }
        return finalizeRun();
      }

      // STEP 3 — EXECUTE. Reuse the existing handler registry; contract is
      // unchanged (HandlerInvocation → HandlerOutcome).
      //
      // Answer-carrying explanation handlers: run the side-band answer-text
      // check AFTER validateToolCall succeeds. Verdict drives the handler's
      // happy-path-vs-fallback branch. Validation never blocks execution —
      // invalid answers route to the deterministic fallback so the user
      // always gets a useful response. Mutation/computation handlers
      // tolerate stray `explanation` fields silently with telemetry.
      const isExplanationHandler = EXPLANATION_HANDLER_IDS.has(proposedHandlerId);
      let explanationInvocationPayload: HandlerInvocation['explanation'];
      if (isExplanationHandler) {
        const verdict = validateExplanationAnswer(
          proposedHandlerId,
          action.explanation,
          context.prior_facts,
        );
        if (!verdict.skip && verdict.payload) {
          explanationInvocationPayload = verdict.payload;
          emit(TelemetryEvents.V5ExplanationAnswerVerdict, {
            request_id: requestId,
            scenario_id: context.session_id,
            handler_id: proposedHandlerId,
            answer_text_valid: verdict.payload.answer_text_valid,
            answer_validation_error: verdict.payload.answer_validation_error ?? null,
            answer_text_length: verdict.payload.answer_text.length,
            evidence_used_count: verdict.payload.evidence_used?.length ?? 0,
            cited_fields_count: verdict.payload.cited_fields?.length ?? 0,
          });
          if (
            (verdict.payload.evidence_used && verdict.payload.evidence_used.length > 0) ||
            (verdict.payload.cited_fields && verdict.payload.cited_fields.length > 0)
          ) {
            emit(TelemetryEvents.V5ExplanationEvidence, {
              request_id: requestId,
              scenario_id: context.session_id,
              handler_id: proposedHandlerId,
              evidence_used: verdict.payload.evidence_used ?? [],
              cited_fields: verdict.payload.cited_fields ?? [],
            });
          }
        }
      } else if (action.explanation) {
        // Mutation/computation handler carrying a stray `explanation` field.
        // Drop silently with telemetry; never coach the user about it.
        emit(TelemetryEvents.V5UnexpectedExplanationPayload, {
          request_id: requestId,
          scenario_id: context.session_id,
          handler_id: proposedHandlerId,
        });
      }

      // Build narrow projections used only on the deterministic fallback
      // path. Cheap to construct; handlers consult them only when the
      // happy-path answer_text is unusable.
      const analysisProjection = isExplanationHandler
        ? buildAnalysisProjectionSummary(contextPackForLog?.analysis ?? null) ?? undefined
        : undefined;
      const structureProjection =
        proposedHandlerId === 'explain_from_structure' && contextPackForLog
          ? buildStructureProjectionSummary(contextPackForLog.graph, {
              messageText: payload.message,
            })
          : undefined;

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
          orientationText: routingResult.orientationText,
          proposal: action,
          analysisReady: analysisReadyForTurn,
          explanation: explanationInvocationPayload,
          analysisProjection,
          structureProjection,
          graphForTurn: graphStateForTurn ?? undefined,
          analysisFreshness: routingFreshness ?? undefined,
        });
        llmCallsUsed += handlerOutcome.llm_calls_used;
        stagesCompleted.push('execute');
        handlerIdForCommit = proposedHandlerId;
        handlerFactsForCommit = handlerOutcome.handler_facts;
        // P0 V5 golden-path repair (follow-up): record graph-mutation
        // observation for turn_outcome.graph_mutated. Any non-null
        // `mutated_graph` on the handler outcome counts — handler-id
        // strings are not load-bearing here.
        if (
          handlerOutcome.mutated_graph !== undefined &&
          handlerOutcome.mutated_graph !== null
        ) {
          handlerEmittedMutatedGraph = true;
        }
        // V5 alpha hardening Phase 2.5: primary lifecycle event on
        // successful handler invocation. Fact count + LLM-call count
        // are queryable alongside the obs field set.
        emit(
          TelemetryEvents.HandlerInvocation,
          obsPayload({
            handler_id: proposedHandlerId,
            outcome: 'success',
            fact_count: handlerOutcome.handler_facts.length,
            llm_calls_used: handlerOutcome.llm_calls_used,
          }),
        );
      } catch (error) {
        // Primary lifecycle event on handler failure. `outcome: 'error'`
        // paired with the cause_kind where known so log queries can
        // differentiate infrastructure faults from upstream errors.
        const causeKind =
          error instanceof HandlerInvocationFailedError ? error.cause_kind : 'unknown';
        emit(
          TelemetryEvents.HandlerInvocation,
          obsPayload({
            handler_id: proposedHandlerId,
            outcome: 'error',
            cause_kind: causeKind,
          }),
        );
        return translateExecuteError(error);
      }

      // V5 Group 1 Task B — decision_review auto-fire after run_analysis.
      // Non-blocking: enricher never throws, degrades to thin content on
      // timeout/failure. Hard 15s timeout inside the enricher; outer
      // turn-budget signal still wins when it fires first.
      //
      // Defense-in-depth: the enricher's own try/catch already covers all
      // known failure paths (timeout, abort, shape extraction, downstream
      // LLM error). The wrap here only fires if a future regression lets
      // an exception escape. On escape, we patch the run_analysis fact's
      // enrichment.decision_review to `null` so consumers can distinguish
      // "review attempted, degraded" from "review absent" (the latter is
      // the soft-fail path inside the enricher, where the field is simply
      // not set).
      if (proposedHandlerId === 'run_analysis') {
        // V5 Phase 1 brief persistence: prefer the canonical-state value
        // from buildTurnContext (`scenarios.brief_text`). Fall back to
        // the legacy out-of-band `options.scenarioBrief` for one release
        // — emit a deprecation warning when it is the source so
        // operators see the legacy channel still in use.
        let resolvedBrief: string | null = context.scenarioBriefText;
        if (resolvedBrief === null && options.scenarioBrief != null && options.scenarioBrief.length > 0) {
          log.warn(
            {
              request_id: requestId,
              scenario_id: context.session_id,
              source: 'options.scenarioBrief',
            },
            'V5 decision_review: legacy options.scenarioBrief used as fallback. ' +
              'This channel is deprecated and will be removed in Phase 2.',
          );
          resolvedBrief = options.scenarioBrief;
        }
        try {
          handlerFactsForCommit = await enrichRunAnalysisWithDecisionReview({
            handlerFacts: handlerOutcome.handler_facts,
            requestId,
            scenarioId: context.session_id,
            signal: turnAbort.signal,
            brief: resolvedBrief,
          });
        } catch (err) {
          log.error(
            {
              request_id: requestId,
              scenario_id: context.session_id,
              err: err instanceof Error ? err.message : String(err),
              stack: err instanceof Error ? err.stack : undefined,
            },
            'V5 decision_review enrichment escaped enricher safety net',
          );
          emit(TelemetryEvents.V5DecisionReviewDegraded, {
            request_id: requestId,
            scenario_id: context.session_id,
            reason: err instanceof Error ? err.message : 'unknown',
          });
          handlerFactsForCommit = patchRunAnalysisDecisionReviewNull(
            handlerOutcome.handler_facts,
          );
        }
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
      // V5 0.9.0: handlers may set `suppress_orientation: true` on their
      // outcome to instruct the composer to skip Sonnet's pre-tool-call
      // text. Used by the precondition-fail path of the no-op explanation
      // handlers (explain_results, what_would_flip) where the brief is
      // explicit that the deterministic template "does not fall through to
      // Sonnet text". Default behaviour (flag absent) is unchanged for
      // run_analysis and any future handler that does not opt in.
      //
      // Answer-carrying explanation handlers (post-Commit-3): the handler
      // ALWAYS owns the entire user-visible string — either Sonnet's
      // answer_text (happy path) or the deterministic fallback. Drive
      // suppression off the handler set rather than per-handler opt-in so
      // explanations never get a stale orientation prefix.
      const suppressOrientation =
        handlerOutcome.suppress_orientation === true || isExplanationHandler;
      const orientationForCompose = suppressOrientation ? '' : sanitisedOrientation.output;
      // V5 state-trust: re-derive freshness POST-dispatch so the wire
      // verdict reflects the just-produced run_analysis fact when one
      // was committed this turn. Without this, a routed run_analysis
      // would ship `freshness === 'none'` (or the prior verdict) on
      // the same turn that produced the fresh fact. Re-derivation is
      // free — it's a pure function over the in-memory fact arrays.
      //
      // V5 D1 (P1-3 follow-up): when a mutation handler emits
      // `mutated_graph`, the pre-handler hash (computed from
      // `graphStateForTurn`, the ingress) is stale relative to what
      // we're about to commit. Compute the post-mutation hash so the
      // freshness verdict on this same response correctly reads
      // `'stale'` against any prior run_analysis fact. Falls back to
      // the pre-handler hash for computation/explanation handlers
      // that don't mutate.
      //
      // Same-turn contract is the freshness verdict only — the rerun
      // chip itself is gated to next-turn explanation handlers in
      // chip-generator (`noopExplanationHandlerJustRan != null` +
      // `analysis_freshness === 'stale'`). The wire signal that the
      // analysis went stale is the freshness verdict on this
      // response; the chip surfaces when the user asks an
      // explanation question on the now-stale state.
      //
      // Hash representation: handlers run their candidate post-mutation
      // graph through GraphV3.parse before emitting `mutated_graph`,
      // which strips top-level `options` and `goal_node_id` (they're
      // not declared on GraphV3). Hashing the GraphV3 projection
      // directly would therefore differ from the prior run_analysis
      // fact's `graph_hash_at_run` for projection-shape reasons rather
      // than mutation reasons. Stamp the mutation's structural fields
      // onto the ingress shape so the comparison is apples-to-apples
      // with how `graph_hash_at_run` was originally computed.
      const hashForPostHandlerFreshness = ((): string | null => {
        if (handlerOutcome.mutated_graph === undefined) {
          return currentAnalysisGraphHashForTurn;
        }
        const mutated = handlerOutcome.mutated_graph as Record<string, unknown>;
        const ingress = (graphStateForTurn ?? {}) as Record<string, unknown>;
        const merged: Record<string, unknown> = {
          ...ingress,
          nodes: mutated.nodes,
          edges: mutated.edges,
          ...(mutated.goal_constraints !== undefined
            ? { goal_constraints: mutated.goal_constraints }
            : {}),
        };
        return computeAnalysisAffectingGraphHash(
          merged as GraphStateIngress | null | undefined,
        );
      })();
      freshness = deriveAnalysisFreshness(
        [...handlerFactsForCommit, ...context.prior_facts],
        hashForPostHandlerFreshness,
      );
      emitFreshnessTelemetry(
        freshness,
        {
          request_id: requestId,
          scenario_id: context.session_id,
          dispatch_path: 'turn_executor_post_handler',
        },
        {
          prior_fact_count: context.prior_facts.length,
          current_turn_fact_count: handlerFactsForCommit.length,
        },
      );
      // V5 Task 2.1: deterministic chip suggestions for the execute branch.
      // V5 0.9.0: priorFacts threaded so the new facts_absent rule does not
      // emit a misleading "Run analysis" chip when a prior non-noop
      // run_analysis fact already exists in the conversation.
      const executeChips = generateChips({
        stage: context.stage,
        handlerFacts: handlerFactsForCommit,
        priorFacts: context.prior_facts,
        analysis: contextPackForLog?.analysis ?? null,
        graphOptionCount: contextPackForLog?.graph.counts.options ?? 0,
        analysisReady: analysisReadyForTurn,
        validationRegistry: options.validationRegistry ?? HANDLER_VALIDATION_REGISTRY,
        ...(buildTurnOutcome() ? { turnOutcome: buildTurnOutcome()! } : {}),
      });
      composedOk = composeToolCallResponse({
        orientation: orientationForCompose,
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
        graphOptionCount: contextPackForLog?.graph.counts.options ?? 0,
        analysisReady: analysisReadyForTurn,
        validationRegistry: options.validationRegistry ?? HANDLER_VALIDATION_REGISTRY,
        ...(buildTurnOutcome() ? { turnOutcome: buildTurnOutcome()! } : {}),
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
        graphOptionCount: contextPackForLog?.graph.counts.options ?? 0,
        analysisReady: analysisReadyForTurn,
        validationRegistry: options.validationRegistry ?? HANDLER_VALIDATION_REGISTRY,
        ...(buildTurnOutcome() ? { turnOutcome: buildTurnOutcome()! } : {}),
      });
      // Phase 2 workstream A: post-analysis coaching wrapper for the
      // `analyse` stage direct_answer path. Mines the latest fresh
      // run_analysis fact's review_cards for structured chips so the
      // user always has a next step. No-op outside `analyse` stage.
      const coachWrapper = generatePostAnalysisCoaching({
        stage: context.stage,
        priorFacts: context.prior_facts,
        freshness: freshness?.freshness ?? 'none',
        requestId,
        scenarioId: context.session_id,
        answerText: sanitised.output,
      });
      const coachComposedChips = coachWrapper.fired
        ? [...coachWrapper.chips, ...coachChips]
        : coachChips;
      // No handler_fact append: the wrapper's recovery state ships via
      // the PostAnalysisDirectAnswerRecovered telemetry event because
      // @talchain/schemas has no `post_analysis_coaching` fact_type
      // variant in the pinned version, and supabase-store.readFactsFor
      // strict-parses every persisted fact through HandlerFactSchema —
      // an unschemaed row would poison the entire scenario's chain.
      composedOk = composeDirectAnswerResponse({
        assistant_text: sanitised.output,
        stage: context.stage,
        suggested_actions: coachComposedChips,
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
        graphOptionCount: contextPackForLog?.graph.counts.options ?? 0,
        analysisReady: analysisReadyForTurn,
        validationRegistry: options.validationRegistry ?? HANDLER_VALIDATION_REGISTRY,
        ...(buildTurnOutcome() ? { turnOutcome: buildTurnOutcome()! } : {}),
      });
      // Phase 2 workstream A: same wrapper as the coach path. Catches
      // the LLM's text-only direct_answer in `analyse` stage and
      // injects review-card-derived chips. Skipped outside `analyse`.
      const converseWrapper = generatePostAnalysisCoaching({
        stage: context.stage,
        priorFacts: context.prior_facts,
        freshness: freshness?.freshness ?? 'none',
        requestId,
        scenarioId: context.session_id,
        answerText: sanitised.output,
      });
      const converseComposedChips = converseWrapper.fired
        ? [...converseWrapper.chips, ...converseChips]
        : converseChips;
      // See coach-path comment above re: telemetry-only recovery state.
      composedOk = composeDirectAnswerResponse({
        assistant_text: sanitised.output,
        stage: context.stage,
        suggested_actions: converseComposedChips,
      });
      stagesCompleted.push('compose');
    }

    // V5 review: chip_count on every successful compose path, not only on
    // failure-response telemetry. This is the canonical signal that
    // success-path chips are active in production — the failure-response
    // event fires only on validator/handler failures, which would leave
    // the happy path unobservable.
    log.debug(
      {
        request_id: requestId,
        session_id: context.session_id,
        turn_class: resolvedTurnClass,
        chip_count: composedOk.suggested_actions.length,
      },
      'V5 TurnExecutor composed response chips',
    );

    // STEP 6.4 — Track 2A prose sanitation: detect only.
    //
    // Upstream display-safe projections (A2 / A2.1 / A2.2) prevent raw
    // values from reaching Sonnet in the first place — edge strength
    // floats, exists probabilities, and node value/raw_value/cap are
    // stripped from the LLM-facing context pack; node `display_value`
    // carries the formatted user-facing string only. With those gates
    // in place, the post-compose sanitiser has no remaining work: every
    // known upstream source of raw-numeric leakage has been closed.
    //
    // The sanitiser remains here as a detect-only canary. Telemetry
    // surfaces residual leakage so a regression is loud — if counters
    // trend non-zero in production, investigate the projection gap;
    // do NOT re-enable rewrite. Mutating composed assistant_text after
    // the fact masks upstream regressions and divorces what we audit
    // from what the user reads.
    try {
      const sanitised = sanitiseAssistantTextProse(composedOk.assistant_text ?? '');
      const totalCounters =
        sanitised.probability_rewrites +
        sanitised.sensitivity_rewrites +
        sanitised.structural_matches +
        sanitised.structural_suppressed +
        sanitised.structural_missed_grammar;
      if (totalCounters > 0) {
        emit(TelemetryEvents.V5ResponseProseSanitised, {
          request_id: requestId,
          scenario_id: context.session_id,
          handler_id: handlerIdForCommit ?? null,
          mode: 'detect_only' as const,
          probability_rewrites: sanitised.probability_rewrites,
          sensitivity_rewrites: sanitised.sensitivity_rewrites,
          structural_matches: sanitised.structural_matches,
          structural_suppressed: sanitised.structural_suppressed,
          structural_missed_grammar: sanitised.structural_missed_grammar,
          structural_rule_ids: sanitised.structural_rule_ids,
        });
      }
    } catch (err) {
      log.warn(
        { request_id: requestId, err: err instanceof Error ? err.message : String(err) },
        'V5 prose sanitiser failure — passing through original text',
      );
    }

    // STEP 6.5 — log-only mutation-language guard (defence-in-depth).
    //
    // Primary mutation-language detection lives in
    // `validateExplanationAnswer` (Commit 2): a match there marks the
    // answer invalid, and the handler renders the deterministic fallback.
    // This STEP 6.5 check is detection-only on the FINAL composed
    // assistant_text; if mutation language survived to compose despite
    // the side-band check, emit telemetry so ops can see drift. We
    // explicitly DO NOT swap the text here — the user-visible response is
    // already what the handler chose; mutating it post-compose would risk
    // user-visible inconsistency between assistant_text and chips.
    if (
      handlerIdForCommit &&
      !['draft_graph', 'edit_graph'].includes(handlerIdForCommit) &&
      composedOk.assistant_text &&
      containsMutationLanguage(composedOk.assistant_text)
    ) {
      emit(TelemetryEvents.V5MutationLanguageGuard, {
        request_id: requestId,
        scenario_id: context.session_id,
        handler_id: handlerIdForCommit,
        text_length: composedOk.assistant_text.length,
      });
    }

    // ==================================================================
    // STEP 7 — COMMIT (unchanged contract)
    // ==================================================================
    try {
      // V5 D1 mutation handlers (set_factor_value, add_constraint,
      // adjust_edge_strength) emit a post-mutation graph on
      // HandlerOutcome.mutated_graph. When present it supersedes the
      // per-turn ingress / persisted graph so append_turn_atomic(p_graph)
      // persists the mutated state. Handlers MUST have validated this
      // graph through GraphV3.parse before returning it — invalid graphs
      // do not reach here.
      //
      // Fallback chain when mutated_graph is absent:
      //   1. options.graphState (request ingress, freshest if UI sent it)
      //   2. graphStateForTurn (post-fallback per-turn graph — already
      //      tries options.graphState then context.persistedGraph)
      // We prefer options.graphState directly (matches pre-D1 behaviour:
      // commit only echoes the ingress when the UI explicitly sent it,
      // otherwise leaves scenarios.graph untouched). graphStateForTurn
      // is used only when a mutation handler emits mutated_graph but the
      // UI didn't send graph_state — in that case the persisted graph
      // is the right merge base.
      const graphForCommit =
        handlerOutcome?.mutated_graph !== undefined
          ? handlerOutcome.mutated_graph
          : options.graphState;
      const committed = await commitDirectAnswer(composedOk, {
        scenario_id: context.session_id,
        turn_id: context.request_id,
        turn_class: resolvedTurnClass ?? 'direct_answer',
        handler_id: handlerIdForCommit,
        request_hash: computeRequestHash(payload),
        llm_calls_used: llmCallsUsed,
        duration_ms: Date.now() - startedAt,
        handler_facts: handlerFactsForCommit,
        graph: graphForCommit,
      });
      commitPerformed = committed.performed;
      stagesCompleted.push('commit');
      response = committed.response;
      // Pending-action consumed telemetry fires only after the commit
      // succeeds — never for a pending action whose handler failed,
      // whose validation rejected the dispatch, or whose commit
      // rolled back. Pairs with PendingActionMatched at the
      // synthesis site.
      if (consumedPendingAction !== null) {
        emit(TelemetryEvents.PendingActionConsumed, {
          request_id: requestId,
          scenario_id: context.session_id,
          pending_action_id: consumedPendingAction.id,
          kind: consumedPendingAction.action.kind,
          chip_id: consumedPendingAction.chip_id,
          llm_calls_used: 0,
          duration_ms: Date.now() - startedAt,
        });
      }
      return finalizeRun();
    } catch (error) {
      log.error(
        { request_id: requestId, err: serialiseError(error) },
        'V5 TurnExecutor commit failure',
      );
      failureType = INTERNAL_TO_WIRE.STATE_COMMIT_FAILED;
      response = buildFailureResponse(
        'STATE_COMMIT_FAILED',
        context.stage,
        { phase: 'commit' },
        recoveryCtx(),
      );
      return finalizeRun();
    }
  } finally {
    clearTimeout(turnTimer);
    // V5 alpha hardening Phase 2.5: response_type captures the final
    // turn_class so one log query on `v5_journey_id` can answer both
    // "what happened" (response_type, validator_outcome) and "how"
    // (handler_proposed, prompt_version/hash).
    responseTypeForObs = resolvedTurnClass;
    emit(
      TelemetryEvents.TurnExecutorCompleted,
      obsPayload({
        turn_class: resolvedTurnClass,
        stages_completed: stagesCompleted,
        response_emitted: true,
        llm_calls_used: llmCallsUsed,
        commit_performed: commitPerformed,
        failure_type: failureType,
        wall_clock_ms: Date.now() - startedAt,
      }),
    );
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
      // V5 alpha hardening follow-up: default flipped from false to true.
      // Principle 3 of the resilience contract forbids user decision text
      // in logs; the JSONL sink used to retain raw fields unless the
      // caller opted in to redaction. The opt-in direction is now reversed
      // — callers must explicitly set `routingLogRedacted: false` to
      // capture raw fields (debugging / staging-log audits only).
      redacted: options.routingLogRedacted ?? true,
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
      // V5 product-state continuity (foamy-bee tranche). `recent_changes_count`
      // mirrors the cap on the projection (0..3); `prior_mutation_fact_count`
      // is uncapped (whole-history observability); `state_query_guard_outcome`
      // captures whether the named-follow-up guard matched, dispatched, or
      // was never reached. All three default to safe zero/`'not_evaluated'`
      // when the turn fails before the relevant code runs.
      recent_changes_count: contextPackForLog?.recent_changes.length ?? 0,
      prior_mutation_fact_count: priorMutationFactCountForLog,
      state_query_guard_outcome: stateQueryGuardOutcomeForLog,
    });
    safeFireRoutingLogWrite(writer, record, requestId);
  }

  // ==================================================================
  // Helpers closured over mutable state
  // ==================================================================
  /**
   * V5 state-trust: build the per-turn TurnOutcome from the freshness
   * derivation + the dispatched handler identity. Used by:
   *   - chip-generator (gates the rerun chip on analysis_freshness === 'stale')
   *   - finalizeRun (surfaces the contract on TurnExecutorRunResult)
   *
   * Returns undefined when freshness has not yet been derived (early-
   * return paths that fire before the freshness block at ~line 480).
   */
  function buildTurnOutcome(): TurnOutcome | undefined {
    if (!freshness) return undefined;
    // P0 V5 golden-path repair (follow-up): derive graph_mutated from
    // the actual handler output, not from a hand-maintained allowlist
    // of handler ids. The original allowlist (draft_graph / edit_graph)
    // missed `set_factor_value`, `add_constraint`, and
    // `adjust_edge_strength` — all D1 mutation handlers that emit
    // `mutated_graph` on their outcome. Future graph-mutating handlers
    // are picked up automatically.
    //
    // `proposedHandlerIdForOutcome === 'draft_graph'` is preserved
    // explicitly because draft_graph is a system-layer dispatch that
    // doesn't go through this executor's handler invocation path
    // (handlerEmittedMutatedGraph stays false for it), but the
    // proposed-handler id IS set.
    const isDraftOrEditGraph =
      proposedHandlerIdForOutcome === 'draft_graph' ||
      proposedHandlerIdForOutcome === 'edit_graph';
    return {
      graph_mutated: handlerEmittedMutatedGraph || isDraftOrEditGraph,
      analysis_run:
        proposedHandlerIdForOutcome === 'run_analysis' && commitPerformed,
      analysis_selected_fact_index: freshness.selected_fact_index,
      analysis_freshness: freshness.freshness,
      freshness_reason: freshness.reason,
    };
  }

  function finalizeRun(): TurnExecutorRunResult {
    // V5 finaliser contract: surface `analysisReadyForTurn` on the run
    // result so route-v2.ts can stamp it via `finaliseV5Response`. The
    // per-turn emission-rate telemetry that previously lived here moved to
    // route-v2.ts as `v5.response.finalised` — that's the only point where
    // the actual emitted vs. computed comparison is meaningful, since the
    // wire stamping happens after this function returns.
    //
    // V5 state-trust: surface the per-turn outcome alongside the
    // freshness derivation so the response-finaliser can thread freshness
    // onto the analysis_ready wire fields without re-deriving.
    const turnOutcome = buildTurnOutcome();
    return {
      response,
      analysisReady: analysisReadyForTurn,
      ...(turnOutcome ? { turn_outcome: turnOutcome } : {}),
      ...(freshness ? { freshness } : {}),
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
        response = buildFailureResponse(
          'LLM_TIMEOUT',
          context.stage,
          { phase: 'orient' },
          recoveryCtx(),
        );
        return finalizeRun();
      case 'aborted':
        // aborted while outer signal hadn't fired yet — treat as orient-side
        // timeout rather than budget; the budget-win branch above already
        // handled the true outer-budget case.
        failureType = INTERNAL_TO_WIRE.LLM_TIMEOUT;
        response = buildFailureResponse(
          'LLM_TIMEOUT',
          context.stage,
          { phase: 'orient' },
          recoveryCtx(),
        );
        return finalizeRun();
      case 'schema_repair_failed':
      case 'empty_response':
      case 'unexpected_stop_reason':
        failureType = INTERNAL_TO_WIRE.LLM_SCHEMA_VIOLATION;
        response = buildFailureResponse(
          'LLM_SCHEMA_VIOLATION',
          context.stage,
          { phase: 'orient', routing_error_cause: err.cause },
          recoveryCtx(err.cause),
        );
        return finalizeRun();
      case 'api_error': {
        // R-004: do NOT log err.provider_message verbatim. Provider error
        // strings can include echoed prompt content (validation messages
        // citing the offending field's value, request snippets) and would
        // therefore route user decision text into telemetry. Replace with:
        //  - provider_error_class: the RoutingError cause (typed enum)
        //  - provider_status: the HTTP status (already non-sensitive)
        //  - provider_message_hash: sha256 truncated to 12 hex chars, for
        //    correlation across the error stream when on-call is debugging
        //    a recurring upstream failure pattern.
        const providerMessageHash = err.provider_message
          ? createHash('sha256').update(err.provider_message).digest('hex').slice(0, 12)
          : null;
        log.warn(
          {
            request_id: requestId,
            cause: err.cause,
            provider_error_class: err.cause,
            provider_status: err.status,
            provider_message_hash: providerMessageHash,
          },
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
              response = buildFailureResponse(
                'LLM_RATE_LIMITED',
                context.stage,
                errorContext,
                recoveryCtx(err.cause),
              );
            } else {
              failureType = INTERNAL_TO_WIRE.LLM_REQUEST_INVALID;
              errorContext.retryable = false;
              response = buildFailureResponse(
                'LLM_REQUEST_INVALID',
                context.stage,
                errorContext,
                recoveryCtx(err.cause),
              );
            }
          } else {
            failureType = INTERNAL_TO_WIRE.LLM_SCHEMA_VIOLATION;
            errorContext.retryable = true;
            response = buildFailureResponse(
              'LLM_SCHEMA_VIOLATION',
              context.stage,
              errorContext,
              recoveryCtx(err.cause),
            );
          }
        } else {
          failureType = INTERNAL_TO_WIRE.LLM_SCHEMA_VIOLATION;
          response = buildFailureResponse(
            'LLM_SCHEMA_VIOLATION',
            context.stage,
            errorContext,
            recoveryCtx(err.cause),
          );
        }
        return finalizeRun();
      }
    }
  }

  function translateExecuteError(error: unknown): TurnExecutorRunResult {
    if (turnAbort.signal.aborted) {
      failureType = INTERNAL_TO_WIRE.BUDGET_EXCEEDED;
      response = buildFailureResponse(
        'BUDGET_EXCEEDED',
        context.stage,
        { budget_ms: context.budgets.turn_ms },
        recoveryCtx(),
      );
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
        response = buildFailureResponse(
          'UNSUPPORTED_ACTION',
          context.stage,
          { reason: 'handler_not_registered', handler_id: error.attempted },
          recoveryCtx(),
        );
      } else {
        failureType = INTERNAL_TO_WIRE.UNHANDLED;
        response = buildFailureResponse(
          'UNHANDLED',
          context.stage,
          { reason: error.reason, attempted: error.attempted },
          recoveryCtx(),
        );
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
      response = buildFailureResponse(
        'HANDLER_RESULT_INVALID',
        context.stage,
        { reason: 'fact_schema_violation' },
        recoveryCtx(),
      );
      return finalizeRun();
    }
    log.error(
      { request_id: requestId, err: serialiseError(error) },
      'V5 TurnExecutor execute step failed with unexpected error',
    );
    failureType = INTERNAL_TO_WIRE.UNHANDLED;
    response = buildFailureResponse(
      'UNHANDLED',
      context.stage,
      { reason: 'unexpected_execute_error' },
      recoveryCtx(),
    );
    return finalizeRun();
  }
}

// -----------------------------------------------------------------------
// Small pure helpers
// -----------------------------------------------------------------------

/**
 * Set enrichment.decision_review to `null` on the first run_analysis fact
 * so consumers can distinguish "review attempted, degraded at the call
 * site" from "review absent" (the latter being the enricher's own
 * soft-fail path, where the field is simply not set). Returns a new
 * facts array; the original is unchanged.
 */
function patchRunAnalysisDecisionReviewNull(
  facts: readonly HandlerFact[],
): readonly HandlerFact[] {
  const idx = facts.findIndex((f) => f.fact_type === 'run_analysis');
  if (idx < 0) return facts;
  const fact = facts[idx];
  if (!fact || fact.fact_type !== 'run_analysis') return facts;
  const enrichment = fact.result.enrichment ?? {};
  const patched: HandlerFact = {
    ...fact,
    result: {
      ...fact.result,
      enrichment: { ...enrichment, decision_review: null },
    },
  };
  const next = facts.slice();
  next[idx] = patched;
  return next;
}

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
 * V5 alpha hardening follow-up (P1-2): whitelist-build a safe log payload
 * from a ValidationError's `details`. The raw details object carries
 * user decision text — candidate labels, proposed/entity labels, raw
 * parameter values, Zod issue strings — all of which are user-authored
 * or Sonnet-echoed prose. Principle 3 of the resilience contract forbids
 * user decision text in logs. This helper retains only:
 *   - Error code (already in the parent log payload)
 *   - System identifiers: handler_id, entity_id (graph coordinates,
 *     schema-defined prefixes like opt_/goal_/fac_, not user prose)
 *   - Enum-valued kinds: entity_kind, proposed_kind, resolved_kind,
 *     accepted_kinds, resolution_status, resolution_method
 *   - Counts (not the items themselves): candidate_count, parameter name
 *   - Handler-supplied reason strings (e.g. "no_options_defined") which
 *     are code-level tokens, not user text
 *   - Dice scores (numbers) and the delta
 * Labels, raw values, issue strings, and constraint descriptions are
 * dropped — the downstream composer still renders them for the user,
 * but they MUST NOT reach the log sink.
 */
function buildSafeValidatorLogDetails(
  error: ValidationError,
): Record<string, unknown> {
  const raw = error.details ?? {};
  const safe: Record<string, unknown> = {};
  // System identifiers — ids are graph coordinates, not user prose.
  if (typeof raw.handler_id === 'string') safe.handler_id = raw.handler_id;
  if (typeof raw.entity_id === 'string') safe.entity_id = raw.entity_id;
  // Enum-valued kind fields (union over EntityKind).
  for (const k of ['entity_kind', 'proposed_kind', 'resolved_kind', 'resolution_status', 'resolution_method'] as const) {
    if (typeof raw[k] === 'string') safe[k] = raw[k];
  }
  if (Array.isArray(raw.accepted_kinds)) {
    safe.accepted_kinds = raw.accepted_kinds.filter((v): v is string => typeof v === 'string');
  }
  if (Array.isArray(raw.registered)) {
    // HANDLER_NOT_FOUND list of registered handler_ids — system ids.
    safe.registered = raw.registered.filter((v): v is string => typeof v === 'string');
  }
  // Counts only — candidate ITEMS carry user labels and are dropped.
  if (Array.isArray(raw.candidates)) {
    safe.candidate_count = raw.candidates.length;
  }
  // Handler-supplied reason string (PRECONDITION_UNMET) — a code-level
  // token like "no_options_defined", not user prose.
  if (typeof raw.reason === 'string') safe.reason = raw.reason;
  // PARAMETER_INVALID — parameter NAME is handler-declared (safe); the
  // actual_value and constraint_description may echo user prose (dropped).
  if (typeof raw.parameter === 'string') safe.parameter = raw.parameter;
  // ENTITY_RESOLUTION_SUSPICIOUS — keep the id + dice numbers, drop the
  // label fields on chosen/closer_candidate.
  if (raw.chosen && typeof raw.chosen === 'object') {
    const c = raw.chosen as Record<string, unknown>;
    const entry: Record<string, unknown> = {};
    if (typeof c.id === 'string') entry.id = c.id;
    if (typeof c.dice === 'number') entry.dice = c.dice;
    safe.chosen = entry;
  }
  if (raw.closer_candidate && typeof raw.closer_candidate === 'object') {
    const c = raw.closer_candidate as Record<string, unknown>;
    const entry: Record<string, unknown> = {};
    if (typeof c.id === 'string') entry.id = c.id;
    if (typeof c.dice === 'number') entry.dice = c.dice;
    safe.closer_candidate = entry;
  }
  if (typeof raw.delta === 'number') safe.delta = raw.delta;
  return safe;
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
