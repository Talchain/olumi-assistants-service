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
import { buildTurnContext, loadPersistedGraphStrict } from './build-turn-context.js';
import {
  buildFailureResponse,
  type FailureResponseRecoveryContext,
} from './failure-response.js';
import { composeValidationFailure } from './compose/validation-failure-responses.js';
import { composeUnsupportedActionResponse } from './compose/unsupported-action-response.js';
import { composeRecoverableValidationResponse } from './compose/recoverable-validation-response.js';
import { composeRecoverableHandlerResponse } from './compose/recoverable-handler-response.js';
import { isRecoverableHandlerCause } from './compose/recoverable-handler-causes.js';
import { applyEgressForbiddenPhraseGuard } from './compose/forbidden-user-facing-phrases.js';
import { buildAppliedGraphWireField } from './compose/applied-graph-emit.js';
import {
  collectValidEntityLabels,
  neutraliseUnvalidatedBoldEntities,
} from './compose/clarify-entity-guard.js';
import { computeStructuralReadiness } from '../orchestrator/tools/analysis-ready-helper.js';
import { GraphV3, type GraphV3T } from '../schemas/cee-v3.js';
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
import {
  evaluateFactorValueProposal,
  resolveExistingRawValue,
  type FactorValueOperator,
  type ProposalRejectionReason,
} from './tools/handlers/d1-shared/evaluate-factor-value-proposal.js';
import { mergeMutatedGraphForPersistence } from './tools/handlers/d1-shared/apply-graph-mutation.js';
import {
  decideGoalTargetReceipt,
  formatGoalTargetNotSavedText,
} from './compose/goal-target-receipt-guard.js';
import {
  scopePendingsToChipClickIntent,
  tryShortConfirmResume,
  SHORT_CONFIRM_PATTERN,
} from './routing/deterministic-short-confirm.js';
import { tryClarificationResume } from './routing/clarification-resume.js';
import { buildRescaleCapPendingActions } from './session/rescale-cap-pending.js';
import {
  composeStateQueryChip,
  tryStateQueryGuard,
} from './routing/state-query-guard.js';
import {
  tryPostAnalysisAdviceGate,
  hasRenderableTopDriverLabel,
} from './routing/post-analysis-advice-gate.js';
import { tryStaleRerunGuard } from './routing/stale-rerun-guard.js';
import { tryRunComparisonGate } from './routing/run-comparison-gate.js';
import { tryNoAnalysisGuard } from './routing/no-analysis-guard.js';
import { tryFreshAnalysisFollowupGuard } from './routing/fresh-analysis-followup-guard.js';
import { impliesOptionInterventionEdit } from './routing/option-intervention-guard.js';
import { classifyValueUnitAgainstFactor } from './routing/value-unit-resolution.js';
import {
  deriveContextReadiness,
  type ContextReadiness,
} from './context/readiness.js';
import type { V5CoachingDelivery } from './diagnostics/v5-diagnostic-trace.js';
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
import {
  buildGmHeldAppliedReceipt,
  executeGmHeldResume,
  readGmHeldResume,
  GM_HELD_APPLIED_RERUN_CHIP,
  type GmHeldResumeRead,
} from './handlers/gm-held-execute.js';
import { describeHeldOperationsSubject } from './handlers/edit-graph-referee-gate.js';
import { isProposedChangeActionType } from './types/proposed-change.js';
import { derivePendingActionsFromFinalizedChips } from './compose/derive-pending-actions.js';
import {
  RENDER_SAFE_LABEL_FALLBACK,
  resolveProposalRenderCopy,
  sanitisePublicCopyOrFallback,
} from './compose/proposed-change.js';
import {
  derivePendingActivity,
  PENDING_ACTION_DEFAULT_TURN_TTL,
  PENDING_ACTION_DEFAULT_WALL_TTL_MS,
  type PendingAction,
} from './session/pending-action.js';
import { deriveBriefTextSeed } from './session/derive-brief-seed.js';
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
import { buildPendingActionsWithProposalCapture } from './coaching/proposal-continuation.js';
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
import { collectInterventionControlledFactorIds } from './context/intervention-controlled-drivers.js';
import {
  buildAnalysisFromPriorFacts,
  FALLBACK_STALENESS_REASON,
  reconcileAnalysisSummaryWithEnrichment,
  type FragileEdgeSource,
  type TopDriverSource,
} from './context/analysis-fallback.js';
import type { CqeExtractionSummary } from './context/cqe/extract-quantities.js';
import {
  computeAnalysisAffectingGraphHash,
  computeDeterministicGraphHash,
} from './context/graph-hash.js';
import { computeExpectedGraphCasHashes } from './context/graph-cas-conflict.js';
import { extractGraphOptionIds } from './context/option-identity.js';
import {
  deriveAnalysisFreshness,
  emitFreshnessTelemetry,
  selectRunAnalysisFact,
  type FreshnessDerivation,
} from './context/freshness.js';
import { deriveRerunReadiness } from './coaching/compare-runs.js';
import {
  selectCanonicalAnalysisState,
  summariseCoachingStatePack,
  type CanonicalAnalysisState,
} from './context/canonical-analysis-state.js';
// T4 Slice 2 — canonical context frame, built ONCE per turn at the finalise
// seam from the authority outputs already in scope (wrap, never re-derive).
import {
  buildFrame,
  projectRecentChangesToFrame,
  type CanonicalContextFrame,
  type FramePendingDiagnostics,
  type FramePendingLifecycle,
  type FrameRerunReadiness,
} from './context/frame/index.js';
import { summariseGraphCounts } from './context/build-context-summary.js';
import {
  checkCoachingOutput,
  buildCoachingDegradeResponse,
  selectLiveHoldForDegrade,
} from './coaching/coaching-output-postcheck.js';
import {
  buildFlipProposalEmit,
  filterFlipSummaryEntries,
  type FactorNodeInfo,
} from './compose/flip-proposal.js';
import { pickLatestDecisionReview } from './coaching/pick-decision-review.js';
import { pickLatestRawRobustness } from './coaching/pick-raw-robustness.js';
import { pickLatestFlipSummary } from './coaching/pick-flip-summary.js';
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
import { getCachedRoutingPromptIdentity } from './routing/prompt-loader.js';
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
import { resolveRelativeFactorDelta } from './routing/resolve-relative-factor-delta.js';
import { HANDLER_VALIDATION_REGISTRY } from './routing/validation-registry.js';
import { validateExplanationAnswer } from './routing/validator-explanation.js';
import { EXPLANATION_HANDLER_IDS } from './routing/types.js';
import {
  buildAnalysisProjectionSummary,
  buildStructureProjectionSummary,
} from './context/projection-summaries.js';
import {
  containsMutationLanguage,
  classifyStructuralClaim,
  mentionsStructuralEditRequest,
  V5_STRUCTURAL_DECLINE_TEXT,
} from './routing/mutation-language.js';
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
import {
  storeTurnDebug,
  recordFailureContext,
  type TurnDebugFreshnessSummary,
} from './debug/turn-debug-store.js';
import {
  type V5TurnTimings,
  type RunAnalysisTimings,
  PLOT_SLOW_LIKELY_MS,
} from './telemetry/turn-timings.js';
import { config } from '../config/index.js';
import { assessAnalysisReadiness } from './tools/handlers/analysis-ready-core.js';

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
  /**
   * Copy-source delivery diagnostics (Scope C, additive). Set when the
   * deterministic post-analysis advice gate produced the response, so
   * route-v2 can attach it to the flag-gated diagnostic trace. Undefined for
   * every other path. Never reaches the wire body directly.
   */
  coachingDelivery?: V5CoachingDelivery;
  /**
   * V5 M5 (read-only / diagnostic). The unified canonical analysis state for
   * this turn — freshness + structural readiness + degraded/contradiction
   * verdict, composed over the current-turn handler facts + prior facts.
   * Assembled post-dispatch (pure read-only, no side effects) and surfaced
   * ONLY via the flag-gated, default-off redacted context-summary diagnostic
   * at the route seam. NEVER feeds chips, prose, or any product logic. Present on the
   * execute (tool/action) path; absent on paths that finalise before the
   * post-dispatch assembly point — route-v2 then falls back to the
   * freshness-derived partial state for the diagnostic surface.
   */
  canonicalState?: CanonicalAnalysisState;
  /**
   * T4 Slice 2 — the canonical context frame for this turn, built ONCE at the
   * finalise seam by wrapping the SAME authority outputs `canonicalState` /
   * `freshness` carry (never a second derivation). Present exactly when both
   * `canonicalState` and the assembled context pack are available; absent on
   * early exits, so its absence is an honest "not observed" — consumers must
   * not fabricate a fallback frame. First consumer: the route's flag-gated
   * context-summary diagnostic (`context/context-summary-from-frame.ts`).
   * INTERNAL ONLY — the frame itself never reaches the wire.
   */
  frame?: CanonicalContextFrame;
  /**
   * V5 Conversation Context Reliability: the authoritative graph this turn
   * reasoned over (request graphState parsed, or the persisted-graph fallback).
   * route-v2 passes this to `sendFinalised200`'s egress sanitiser so the WIRE
   * resolves entity-id labels against the SAME graph the durable-text scrub
   * used at commit — stored text and wire text cannot diverge. Null when the
   * turn had no graph (egress + storage both run graph-free, consistently).
   */
  effectiveGraph?: GraphV3T | null;
  /**
   * ROADMAP 1.42 — VERBATIM Sonnet-5 extended-thinking text captured from
   * the routing call's `ChatWithToolsResult.reasoning`, when
   * CEE_REASONING_CAPTURE_ENABLED is on and the model emitted thinking
   * blocks. Undefined when the flag is off, or no thinking was emitted.
   * NEVER attached to `response` / assistant_text here — route-v2 attaches
   * it to the wire envelope AFTER egress validation (the `_reasoning`
   * sidecar mechanic), so it must never leak into pre-egress prose or the
   * fallback envelope.
   */
  reasoning?: string;
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
 * Derive canonical readiness from the SAME graph authority the freshness hash
 * was computed from (`canonicalReadinessGraph`) — NOT the request-derived
 * `analysisReadyForTurn`. Shared by the post-dispatch execute assembly and the
 * non-execute `finalizeRun` fallback so both reason over ONE authority; the
 * diagnostic can never pair a persisted-graph hash with request-derived
 * readiness under client lag.
 *
 * Reuses `requestReadiness` when the authority IS the request graph (the
 * identical GraphV3 parse + `computeStructuralReadiness` already ran for it);
 * otherwise parses the authority fresh. `undefined` when there is no parseable
 * authority (no graph, or an unrecoverable/unparseable persisted graph) → the
 * canonical status resolves to null, never a false `ready`. Pure.
 */
function deriveCanonicalReadiness(
  canonicalReadinessGraph: unknown,
  requestGraph: GraphStateIngress | null,
  requestReadiness: NonNullable<GraphPatchBlockData['analysis_ready']> | undefined,
): NonNullable<GraphPatchBlockData['analysis_ready']> | undefined {
  if (canonicalReadinessGraph === requestGraph) return requestReadiness;
  if (canonicalReadinessGraph == null) return undefined;
  const parsed = GraphV3.safeParse(canonicalReadinessGraph);
  return parsed.success ? computeStructuralReadiness(parsed.data) : undefined;
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

  // Fix 4 (observability): per-step wall-clock accumulator. Every collection
  // site checks `timingsEnabled` so production (default `V5_TIMING_DEBUG=false`
  // AND `CEE_DIAGNOSTIC_TRACE_ENABLED=false`) pays zero allocation, no
  // `Date.now()` deltas, no telemetry emit, and no response mutation.
  //
  // V5 diagnostic trace (Phase A) — gate relaxation: timings populate when
  // EITHER the original V5_TIMING_DEBUG operator flag is on OR the new
  // CEE_DIAGNOSTIC_TRACE_ENABLED flag is on. The wire emission of
  // `_timings` still requires the two-gate model in route-v2; the new
  // flag only enables IN-MEMORY substage capture so the V5 diagnostic
  // trace can surface them under `_diagnostic_trace.benchmarking`. The
  // wire surface contract is unchanged. Defence-in-depth at the route
  // egress (sendFinalised200) catches any upstream attach that bypasses
  // this gate.
  const timingsEnabled = config.cee.timingDebugEnabled || config.features.diagnosticTraceEnabled;
  const turnTimings: V5TurnTimings = {};
  // Handler-level run_analysis PLoT timings are reported back via a typed
  // `__plot_timings` slot on the HandlerOutcome. The executor copies them
  // into `runAnalysisTimings` so they reach the response envelope alongside
  // the per-turn timings.
  let runAnalysisTimings: RunAnalysisTimings | undefined;
  // Compose timer: handler-return → commit-start (Steps 6 + intermediate
  // sanitisation in main happy path). 0 when timings disabled or when the
  // turn never reaches the handler-return path (recovery / chip-click /
  // routing-error / short-confirm).
  let composeStartedAt = 0;

  let buildContextStartedAt = 0;
  if (timingsEnabled) buildContextStartedAt = Date.now();
  const context = await buildTurnContext(payload, requestId);
  if (timingsEnabled) {
    turnTimings.build_turn_context_ms = Date.now() - buildContextStartedAt;
  }
  stagesCompleted.push('build_turn_context');

  // Track 2 — pending-confirmation truth, derived ONCE at ORIENT time from the
  // single persisted authority (`most_recent_pending_actions`, the last prior
  // turn's offers) via the shared read-time liveness predicate. The store read
  // does NOT filter expiry, so wall-/turn-expired entries are present in the
  // raw list and MUST NOT read as pending here. The raw context list is left
  // untouched — the dismissal / label / ordinal pre-routes and
  // edit-graph-dispatch deliberately see expired entries to emit their own
  // typed invalidation outcomes. Start-of-turn semantics: a proposal consumed
  // later THIS turn still counts (it was live when the user replied); the
  // next turn's derivation reflects the consumption.
  // Single, pure, unit-tested derivation (`derivePendingActivity`): one pass
  // classifying liveness via the shared predicate + tallying live/kind/
  // confirmation-expecting counts. Reuses the read-time liveness authority so
  // this seam agrees with the short-confirm / route resolvers on what "live"
  // means.
  const pendingActivity = derivePendingActivity(
    context.most_recent_pending_actions ?? [],
    Date.now(),
  );
  // The ONE value both state seams receive — the ContextPack (LLM-routing-
  // visible) and the canonical frame (diagnostics) agree by construction.
  // Kill-switch: CEE_PENDING_CONFIRMATION_TRUTH_ENABLED=false restores the
  // pre-fix constant-false at BOTH seams (agreement preserved either way).
  const pendingConfirmationForTurn =
    config.cee.pendingConfirmationTruthEnabled &&
    pendingActivity.confirmationExpectingLiveCount > 0;
  // Redacted pending observability for the frame (counts + closed-enum kind
  // keys only). Deliberately NOT gated by the kill-switch: manual testers see
  // the derived truth in diagnostics even when threading is disabled, with
  // `threaded` recording the flag state that governed the two seams above.
  const pendingDiagnosticsForTurn: FramePendingDiagnostics = {
    ...pendingActivity,
    threaded: config.cee.pendingConfirmationTruthEnabled,
  };

  // V5 Coaching State Spine — Stage 2B-1b: persist the turn-start (pre-dispatch)
  // coaching_state snapshot on EVERY turn-executor commit. Injected centrally
  // here so no individual commit site can omit it; `context` is the single turn
  // context built above. Forwards the optional sessionStore arg unchanged. The
  // 20 `commitDirectAnswer` call sites in this function were renamed to
  // `commitTurn` so the snapshot threads uniformly.
  // V5 Conversation Context Reliability: also inject userMessage centrally so
  // EVERY turn-executor commit (all 20 sites: happy path, recoveries,
  // clarifications, guards) persists the user's turn text uniformly. The
  // assistant side is derived inside commitDirectAnswer from the composed
  // response. Message-kind turns carry payload.message; system-event-kind
  // turns carry no user text and persist NULL.
  const userMessageForTurn = payload.kind === 'message' ? payload.message : undefined;
  // Lane 28 — brief pipeline seam 1: seed `scenarios.brief_text` centrally.
  // The only production writer was draft-graph-dispatch, whose route-v2
  // trigger never fires for turns that reach the TurnExecutor (continuation
  // scenarios, request graph_state present, non-draft shapes) — and the
  // commit sites here re-passed only `context.scenarioBriefText`, a circular
  // no-op when the brief was never written. Derive a seed ONCE per turn:
  // only when no brief is persisted yet AND the scenario has no COMMITTED
  // graph (`context.persistedGraph` — the server-side scenarios read; a
  // committed graph means the framing turn is behind us, and a permanent
  // first-write-wins field must not be claimable by any mid-conversation
  // message) AND the payload is a frame-stage, non-question message passing
  // the conservative decision-brief shape gate (mirrors the draft-dispatch
  // heuristic's actual scope; see derive-brief-seed.ts). The RPC's
  // first-write-wins predicate (`WHERE brief_text IS NULL OR brief_text =
  // ''`) remains the last line of defence. Injected in `commitTurn` below so
  // ALL commit sites seed uniformly — same doctrine as `userMessage` /
  // `coaching_state`.
  const briefSeedNormForTurn =
    context.scenarioBriefText == null
      ? deriveBriefTextSeed(payload, {
          hasCommittedGraph: context.persistedGraph != null,
        })
      : undefined;
  if (briefSeedNormForTurn?.truncated) {
    // Disclosed truncation — same event + shape as the draft-dispatch write
    // site (existing telemetry enum member; registry unchanged).
    emit(TelemetryEvents.V5BriefTextNormalised, {
      request_id: requestId,
      scenario_id: payload.scenario_id,
      original_length: briefSeedNormForTurn.originalLength,
      truncated_length: briefSeedNormForTurn.value?.length ?? 0,
      reason: 'over_8000_chars',
    });
  }
  const briefSeedForTurn = briefSeedNormForTurn?.value;
  // Track 2 — the last commit's carry-forward lifecycle tally, hoisted here so
  // `finalizeRun` can thread it into the frame's `pending.lifecycle` diagnostics
  // (the tally is only known post-commit; the ORIENT-time pending block carries
  // counts). Undefined on paths that never commit (e.g. early error exits) —
  // honest absence, the frame's pending block then carries no lifecycle.
  let pendingLifecycleForRun: FramePendingLifecycle | undefined;
  const commitTurn = async (
    resp: Parameters<typeof commitDirectAnswer>[0],
    meta: Parameters<typeof commitDirectAnswer>[1],
    store?: Parameters<typeof commitDirectAnswer>[2],
  ): Promise<Awaited<ReturnType<typeof commitDirectAnswer>>> => {
    // A3 graph CAS observe-mode: derive the expected-base hashes ONLY from
    // the server-side persisted read buildTurnContext performed at turn start
    // (`context.persistedGraph`) — NEVER from request-supplied graph_state,
    // which may be the very graph being written (trusted base rule; see
    // graph-cas-conflict.ts). Computed only for graph-bearing commits with
    // the mode on, so flag-off / graph-free commits pay zero hashing.
    // buildTurnContext degrades a failed scenarios read to null, which maps
    // to expected=null → `no_expected`/`first_write` — categories that are
    // never enforced, so a degraded read can never block a write.
    const expectedGraphCasHashes =
      meta.graph !== undefined && config.features.graphCasMode !== 'off'
        ? computeExpectedGraphCasHashes(context.persistedGraph)
        : undefined;
    const result = await commitDirectAnswer(
      resp,
      {
        // Injected BEFORE ...meta so a call site could still override; no
        // current call site does (the wrapper's server-read derivation is
        // the single trusted source on this path).
        ...(expectedGraphCasHashes ?? {}),
        // V5 Signature Loop — carry forward the prior turn's pendings by default
        // so a non-consuming turn does not wipe a live proposal (behaviour #2).
        // Placed BEFORE `...meta` so a call site can still override it; the
        // apply / dismissal sites additionally set `consumedPendingRefs` (via
        // meta) to exclude the proposal they just consumed / rejected, so it
        // can never carry forward and reappear as a zombie.
        priorPendingActions: context.most_recent_pending_actions ?? [],
        ...meta,
        coaching_state: context.coaching_state,
        userMessage: userMessageForTurn,
        // Lane 28 — brief pipeline seam 1: a call site's explicit briefText
        // (the main happy path re-passes `context.scenarioBriefText`) wins;
        // otherwise seed from this turn's payload when it passed the
        // decision-brief shape gate (undefined on non-qualifying turns —
        // the RPC then leaves brief_text untouched).
        briefText: meta.briefText ?? briefSeedForTurn,
        // V5 Conversation Context Reliability: scrub the durable assistant text
        // against `effectiveTurnGraph` — the SAME graph this turn reasoned over
        // and the SAME graph surfaced to the route egress sanitiser (below) —
        // so the stored copy resolves entity-id labels (e.g. `goal_revenue` →
        // "Revenue") identically to the wire copy and the two cannot diverge,
        // even when the request graphState is stale relative to, or absent
        // alongside, the persisted graph. (Earlier this used
        // `context.persistedGraph`, which could differ from the request graph
        // the wire egress used.)
        contentGraph: effectiveTurnGraph,
      },
      store,
    );
    pendingLifecycleForRun = result.pendingLifecycle;
    return result;
  };

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
  const obsPayload = (extra: Record<string, unknown> = {}): Record<string, unknown> => {
    // ROADMAP 1.32 — identity stamp: prefer the SERVED PMS snapshot
    // identity over the static repo-default constants. The constants
    // misreport as v40/21,439 whenever PMS serves a different prompt
    // (live specimen: version 112 / 21,860 chars), so every
    // turn-lifecycle event carried the wrong identity. Field names are
    // unchanged (prompt_version / prompt_hash / system_chars) so
    // dashboards keep joining on the same keys. Falls back to the
    // constants only when the snapshot has not been built yet (pre-boot).
    const servedPrompt = getCachedRoutingPromptIdentity();
    return {
      request_id: requestId,
      session_id: context.session_id,
      v5_journey_id: v5JourneyId,
      prompt_version: servedPrompt?.version ?? ROUTING_PROMPT_VERSION,
      prompt_hash: servedPrompt?.sent_hash ?? ROUTING_PROMPT_HASH,
      system_chars: servedPrompt?.system_chars ?? ROUTING_PROMPT_SYSTEM_CHARS,
      context_pack_chars: contextPackCharsForObs,
      handler_proposed: handlerProposedForObs,
      validator_outcome: validatorOutcomeForObs,
      response_type: responseTypeForObs,
      stage: context.stage,
      ...extra,
    };
  };

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
  // V5 M5 (read-only / diagnostic): unified canonical analysis state, assembled
  // post-dispatch from the SAME fact set + post-handler graph hash that
  // `freshness` uses. Outer-let so `finalizeRun` can surface it on the run
  // result; stays undefined until the post-dispatch assembly point.
  let canonicalStateForRun: CanonicalAnalysisState | undefined;
  // V5 Coaching Context Pack v1 (CEE_COACHING_CONTEXT_PROMPT_ENABLED): the
  // canonical verdict assembled pre-dispatch for the flag-gated coaching prompt
  // pack. Reused in the coaching compose branches for the deterministic
  // post-check + chip threading so the prompt, the enforcement and the chips
  // read ONE live `deriveAnalysisFreshness` verdict. Null when the flag is off
  // or freshness was not derived → no pack, no post-check, no chip threading.
  let coachingPromptCanonical: CanonicalAnalysisState | null = null;
  let proposedHandlerIdForOutcome: string | null = null;
  let currentAnalysisGraphHashForTurn: string | null = null;
  // V5 M5 (read-only / diagnostic): the RAW graph object the freshness hash was
  // computed from, captured so the M5 canonical state derives its readiness
  // from the SAME graph authority as its freshness — the persisted/canonical
  // graph (under client lag, per the H3 stale-aware logic below), the request
  // graph on cold-start, or the post-mutation graph on a mutation. This keeps
  // the diagnostic internally consistent instead of pairing the persisted-graph
  // hash with the request-derived `analysisReadyForTurn`. Null when there is no
  // parseable authority (→ canonical readiness undefined). NOT used for any
  // wire / chip behaviour — `analysisReadyForTurn` carries that, and on a
  // committed D1 mutation it is re-projected onto the committed graph at the
  // STEP 7 post-commit block (F3), not from this diagnostic capture.
  let canonicalReadinessGraphForRun: unknown = null;
  // P0 V5 golden-path repair (follow-up): hoisted into the function
  // scope so `buildTurnOutcome` (nested below) can read it. Set when a
  // handler outcome carries a non-null `mutated_graph`. Closes the
  // gap where set_factor_value / add_constraint / adjust_edge_strength
  // mutated the graph but turn_outcome.graph_mutated stayed false.
  let handlerEmittedMutatedGraph = false;
  // Mission 1 (context authority): ONE pre-dispatch canonical verdict for
  // every non-execute consumer — the flag-gated coaching prompt pack, the
  // clarify / coach / converse chip sites, and the finalise fallback —
  // memoised so those surfaces cannot diverge (previously the prompt pack
  // used a PARTIAL `canonicalStateFromFreshness` object while the finalise
  // fallback recomputed a full one: two canonical objects per turn).
  // Execute turns use the post-dispatch `canonicalStateForRun` instead —
  // the fact chain and graph hash change mid-turn there, so pre-dispatch
  // state would be wrong for them. Pure and cheap; reads the same
  // authorities the routing freshness was derived from, at call time
  // (all stable once routing freshness exists). Returns undefined before
  // the routing-freshness derivation (early exits stay honestly absent).
  let nonExecuteCanonicalMemo: CanonicalAnalysisState | null | undefined;
  const canonicalStateForNonExecute = (): CanonicalAnalysisState | undefined => {
    if (nonExecuteCanonicalMemo === undefined) {
      nonExecuteCanonicalMemo =
        freshness === null
          ? null
          : selectCanonicalAnalysisState({
              handlerFacts: [],
              priorFacts: context.prior_facts,
              readiness: deriveCanonicalReadiness(
                canonicalReadinessGraphForRun,
                graphStateForTurn,
                analysisReadyForTurn,
              ),
              currentGraphHash: currentAnalysisGraphHashForTurn,
              // Option-identity guard: same raw graph source as the
              // routing-freshness hash. undefined when the flag is off.
              currentGraphOptionIds: config.cee.optionIdentityFreshnessGuard
                ? extractGraphOptionIds(
                    context.persistedGraph ?? graphStateForTurn ?? null,
                  )
                : undefined,
            });
    }
    return nonExecuteCanonicalMemo ?? undefined;
  };

  // ROADMAP 1.20(b) — chip-sameness guard. Chip ids offered on the
  // IMMEDIATELY PRIOR turn, derived from `context.most_recent_pending_actions`
  // — the same single-prior-turn authority every other pending-action
  // consumer in this file reads (see that field's doc comment in
  // build-turn-context.ts: "only the LAST prior turn's pending_actions
  // appear here"). Threaded into the coach/converse chip-generation call
  // sites so a chip that was JUST offered is not mechanically repeated —
  // closes the live defect where 5 consecutive turns offered IDENTICAL
  // chips regardless of what the turns were about. Memoised (cheap, but
  // avoids rebuilding the Set if read more than once per turn).
  //
  // FIX 3 (F11, CEE hygiene batch): that field's doc comment only pins
  // WHICH ROW is read (the last prior turn's), not what its CONTENT is.
  // commit.ts's `computeSurvivingPriorPendingsDetailed` carries a
  // non-consumed pending FORWARD across turns (up to
  // `PENDING_ACTION_DEFAULT_TURN_TTL` total turns), decrementing
  // `expires_at_turn_count` by exactly 1 per surviving turn — so the same
  // row can carry a TTL survivor from 2 turns ago alongside (or instead
  // of) a fresh immediately-prior offer, and both look identical by
  // chip_id alone. Every production call site that mints a chip-derived
  // pending stamps exactly `PENDING_ACTION_DEFAULT_TURN_TTL` at creation
  // (none pass a `turn_ttl` override), so `expires_at_turn_count ===
  // PENDING_ACTION_DEFAULT_TURN_TTL` is the reliable turn-recency signal:
  // true only for a pending emitted on the IMMEDIATELY PRIOR turn, false
  // for anything carried forward at least once. Filtering on it scopes
  // suppression to the 1 turn this guard's own contract promises, instead
  // of silently extending it across the full TTL window (chips vanishing
  // for up to `PENDING_ACTION_DEFAULT_TURN_TTL` consecutive turns while
  // coaching copy may still invite the now-unavailable action).
  let recentlyOfferedChipIdsMemo: ReadonlySet<string> | undefined;
  const recentlyOfferedChipIds = (): ReadonlySet<string> => {
    if (recentlyOfferedChipIdsMemo === undefined) {
      recentlyOfferedChipIdsMemo = new Set(
        (context.most_recent_pending_actions ?? [])
          .filter((a) => a.expires_at_turn_count === PENDING_ACTION_DEFAULT_TURN_TTL)
          .map((a) => a.chip_id),
      );
    }
    return recentlyOfferedChipIdsMemo;
  };

  // Routing log fields — closured so the finally block can emit one record
  // per turn regardless of which terminal path fires (success / typed
  // failure / unexpected error).
  let routingErrorCause: string | null = null;
  let resolutionStatus: ResolutionStatus | null = null;
  let proposedHandlerIdForLog: string | null = null;
  let sonnetTextForLog = '';
  let contextPackForLog: ContextPack | null = null;
  /**
   * V5 Coaching Context Pack v1 — shared deterministic post-check for the two
   * LLM-authored coaching compose branches (coach / converse). When the
   * behaviour flag projected a canonical verdict this turn
   * (`coachingPromptCanonical`), inspect the LLM prose against it; on a boundary
   * violation, emit `v5.coaching.output_postcheck` and DEGRADE-TO-SAFE — a
   * verdict-correct deterministic trust response (the #298 stale / unconfirmed /
   * degraded / absent copy) + the existing `chip_action_rerun_analysis` chip. It
   * never surgically rewrites the model's prose. When the flag is off
   * (`coachingPromptCanonical === null`) it is an identity pass-through, so the
   * coaching branches are byte-identical to today (no post-check, no telemetry).
   */
  const applyCoachingOutputGuard = (
    prose: string,
    baseChips: readonly SuggestedAction[],
  ): { assistant_text: string; suggested_actions: readonly SuggestedAction[] } => {
    if (coachingPromptCanonical === null) {
      return { assistant_text: prose, suggested_actions: baseChips };
    }
    const pack = summariseCoachingStatePack(coachingPromptCanonical);
    // Supply the turn's live decision labels (raw, case-preserved) so the
    // post-check recognises the graph's ACTUAL option/factor labels — "I
    // recommend Plan A" / "I updated Pricing" — not just the type nouns.
    const decisionLabels: string[] = [];
    for (const option of analysisReadyForTurn?.options ?? []) {
      const label = (option as { label?: unknown } | null | undefined)?.label;
      if (typeof label === 'string') decisionLabels.push(label);
    }
    for (const node of contextPackForLog?.graph.nodes ?? []) {
      if (node !== null && typeof node === 'object' && 'label' in node) {
        const label = (node as { label?: unknown }).label;
        if (typeof label === 'string') decisionLabels.push(label);
      }
    }
    const verdict = checkCoachingOutput(prose, pack, { decisionLabels });
    if (verdict.safe) {
      return { assistant_text: prose, suggested_actions: baseChips };
    }
    emit(TelemetryEvents.V5CoachingOutputPostcheck, {
      request_id: requestId,
      scenario_id: context.session_id,
      violation: verdict.violation,
      freshness: pack.freshness,
      rerun_required: pack.rerun_required,
      usable_for_chips: pack.usable_for_chips,
      blocked: pack.blocked,
    });
    // F-HELD fix 3b — thread the live hold (if any) into the degrade so a
    // state-unsafe degrade RESTATES the held offer + its confirm chip instead
    // of stomping the reply with buildAnalysisAbsentTemplate + a competing
    // run_analysis chip (wire capture 13c). Selection lives in
    // `selectLiveHoldForDegrade` (same single-prior-turn authority every
    // other pending consumer in this file reads): newest LIVE standard
    // apply_proposed_change with public copy AND `expires_at_turn_count > 1`
    // — a hold at 1 lapses at THIS commit, so restating it would contradict
    // the same-message lapse notice with a dead chip (round-2 FIXUP 3).
    const holdForDegrade = selectLiveHoldForDegrade(
      context.most_recent_pending_actions,
      Date.now(),
    );
    const degrade = buildCoachingDegradeResponse(pack, {
      optionCount: contextPackForLog?.graph.counts.options ?? 0,
      ...(holdForDegrade !== undefined ? { liveHold: holdForDegrade } : {}),
    });
    return {
      assistant_text: degrade.assistant_text,
      suggested_actions: [...degrade.suggested_actions],
    };
  };
  let cqeSummaryForLog: CqeExtractionSummary | null = null;
  let contextReadiness: ContextReadiness | null = null;
  // Scope C: copy-source delivery diagnostics for the deterministic
  // post-analysis advice gate. Set in the advice-gate matched branch and
  // surfaced on TurnExecutorRunResult so route-v2 can attach it to the
  // flag-gated diagnostic trace. Null on every other path.
  let coachingDelivery: V5CoachingDelivery | null = null;

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
  // V5 Conversation Context Reliability: the single authoritative graph this
  // turn reasoned over (`graphStateForTurn` parsed = the request graphState, or
  // the persisted-graph fallback when the request omitted it). Used for BOTH
  // the durable assistant-text scrub (commitTurn → contentGraph) AND the wire
  // egress sanitiser (surfaced on the run result → route-v2), so stored text
  // and wire text resolve entity-id labels against the SAME graph and cannot
  // diverge. Null until the graph is parsed below / when the turn has no graph.
  let effectiveTurnGraph: GraphV3T | null = null;
  // ROADMAP 1.42 — VERBATIM reasoning captured from the real LLM routing
  // call, hoisted to outer scope (same reason as the fields above) so
  // `finalizeRun` — declared OUTSIDE the try block below — can read it.
  // Stashed independently of `routingResult` (itself try-block-scoped) so
  // it survives any later reassignment. Undefined on every deterministic /
  // synthesised path and whenever CEE_REASONING_CAPTURE_ENABLED is off.
  // Surfaced on TurnExecutorRunResult.reasoning by finalizeRun().
  let capturedReasoning: string | undefined;

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
        // Capture the authoritative per-turn graph (same parse the readiness
        // gate uses) for the durable-text scrub + wire egress — one source.
        effectiveTurnGraph = parsedGraphForReadiness.data;
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
    //
    // V5 stale-aware explain recovery (H3 fix): the hash MUST come from
    // the canonical persisted graph (scenarios.graph, loaded into
    // context.persistedGraph by buildTurnContext) — NOT the
    // request-supplied `graphStateForTurn`. The two diverge when the
    // client lags behind a persisted edit: a follow-up explain turn
    // that re-sends the pre-edit graph would otherwise hash to the
    // same value as the prior run_analysis fact's `graph_hash_at_run`,
    // produce a false-fresh verdict, and skip the stale recovery
    // template + Rerun-analysis chip. Mirrors the canonical-hash logic
    // already used by chip-click-dispatch.ts (which hashes
    // cachedSnapshot.rawPersistedGraph for the same reason).
    //
    // Two non-canonical paths are handled differently per the V5
    // stale-aware explain recovery brief (Codex round-3 P1):
    //   - persistedGraph is null/undefined (cold-start / first-draft):
    //     no canonical state exists yet; fall back to hashing the
    //     request graph. That's the only signal available.
    //   - persistedGraph exists but fails ingress parse (corrupt
    //     write, legacy shape, schema-version drift): canonical state
    //     is genuinely unknown. Do NOT fall back to the request graph
    //     here — if the client is also lagging behind a persisted
    //     edit, the request graph could match the prior
    //     `graph_hash_at_run` and silently produce a false-fresh
    //     verdict. Instead return null, route the derivation to
    //     `'unknown' / current_graph_hash_unavailable`, and emit the
    //     `v5.persisted_graph.parse_failed` log signal.
    currentAnalysisGraphHashForTurn = ((): string | null => {
      const persistedGraph = context.persistedGraph;
      if (persistedGraph === undefined || persistedGraph === null) {
        // Cold-start / first-draft path: no canonical state has been
        // persisted yet, so the request graph is the only signal
        // available. Hashing it is correct here.
        canonicalReadinessGraphForRun = graphStateForTurn ?? null; // M5 readiness authority
        return computeAnalysisAffectingGraphHash(graphStateForTurn);
      }
      // EP2 (V5 Edit Safety Core), gated atomically with the run-time guard.
      // When ON: an unrecoverable persisted graph short-circuits to null →
      // freshness resolves as `unknown` (not fresh), so a prior result is never
      // shown as current over an un-analysable graph (Blocker 2); a ready/repaired
      // graph is canonicalised BEFORE hashing so this matches the run-time
      // `graph_hash_at_run` (brief §6 consistency). Flag OFF ⇒ unchanged.
      let graphForHash: unknown = persistedGraph;
      if (config.cee.analysisReadyGuardEnabled) {
        const verdict = assessAnalysisReadiness(persistedGraph);
        if (verdict.status === 'unrecoverable') {
          return null;
        }
        graphForHash = verdict.canonicalGraph ?? persistedGraph;
      }
      const parsed = GraphStateIngressSchema.safeParse(graphForHash);
      if (parsed.success) {
        // M5 readiness authority: derive canonical readiness from the SAME
        // persisted/canonical graph this hash is computed from (not the
        // request graph), so the diagnostic cannot pair this hash with a
        // stale request-derived readiness under client lag.
        canonicalReadinessGraphForRun = graphForHash;
        return computeAnalysisAffectingGraphHash(parsed.data);
      }
      // V5 stale-aware explain recovery (Codex round-3 P1): persisted
      // graph exists but failed ingress parse. Do NOT fall back to
      // `graphStateForTurn` here — if the client is ALSO lagging
      // behind a persisted edit, the request graph could match the
      // prior `graph_hash_at_run` and produce a false-fresh verdict
      // (silently corrupt freshness instead of admitting we don't
      // know the canonical state). Returning null routes the
      // derivation to `'unknown' / current_graph_hash_unavailable`
      // which honestly signals the situation to the wire envelope,
      // telemetry, and downstream chip rules.
      log.warn(
        {
          event: 'v5.persisted_graph.parse_failed',
          request_id: requestId,
          scenario_id: context.session_id,
          issue_count: parsed.error.issues.length,
          first_issue_path: parsed.error.issues[0]?.path.join('.') ?? null,
        },
        'V5 TurnExecutor persisted graph failed ingress parse; freshness will resolve as unknown to avoid a false-fresh verdict',
      );
      return null;
    })();
    // Option-identity guard inputs (CEE_OPTION_IDENTITY_FRESHNESS_GUARD). Read
    // option IDs from the RAW current graph — persisted when present (even when
    // it failed ingress parse above, so the recovered/unparseable-graph case is
    // still covered), else the request graph on cold start. `undefined` when the
    // flag is off → byte-identical pre-guard behaviour.
    const currentGraphOptionIdsForTurn: readonly string[] | null | undefined =
      config.cee.optionIdentityFreshnessGuard
        ? extractGraphOptionIds(context.persistedGraph ?? graphStateForTurn ?? null)
        : undefined;
    routingFreshness = deriveAnalysisFreshness(
      context.prior_facts,
      currentAnalysisGraphHashForTurn,
      currentGraphOptionIdsForTurn,
    );
    // Until the post-dispatch re-derivation runs, the wire-bound
    // `freshness` defaults to the routing view — this covers exit paths
    // that return before handler dispatch (orient errors, routing
    // errors, validation failures).
    freshness = routingFreshness;

    let analysisSummary: AnalysisResponseSummary | null = null;
    let analysisStalenessReason: string | null = null;
    let analysisStateSource: 'request' | 'fallback' | 'absent' = 'absent';
    // Which shape produced the fragile edges / top drivers, for telemetry.
    // Set on the request path (below); null on the fallback/absent paths —
    // the fallback already reconciles both inside buildAnalysisFromPriorFacts.
    let fragileEdgeSource: FragileEdgeSource | null = null;
    let topDriverSource: TopDriverSource | null = null;
    if (options.analysisState) {
      // The body-supplied analysis_state arrives in the V2RunResponse shape:
      // top-level `robustness`, `factor_sensitivity`, `option_comparison`,
      // and NO per-option `results` (coerceIngressAnalysis leaves results
      // empty). compactAnalysis therefore misses BOTH the top-level
      // `robustness.fragile_edges` AND the top-level `factor_sensitivity[]`
      // drivers; apply the SAME overrides the prior-facts fallback uses so
      // the projection is identical on both paths. Without the drivers
      // override, `top_drivers: []` failed the advice gate's
      // `needs_top_driver` classes and a grounded question like "What would
      // change the outcome?" fell through to the fresh-analysis recap copy.
      // coerceIngressAnalysis preserves the top-level fields, so the coerced
      // envelope doubles as the enrichment source. Per-option data still
      // wins when the request carries it.
      const coercedIngress = coerceIngressAnalysis(options.analysisState);
      const ingressSummary = compactAnalysis(coercedIngress);
      if (ingressSummary) {
        // Lane 21 (P0-A): single composite seam shared with
        // buildAnalysisFromPriorFacts — drivers + fragile-edge overrides plus
        // the tipping / VOI / goal-fit signal attachment — so the ingress and
        // prior-facts paths project identically by construction.
        const reconciled = reconcileAnalysisSummaryWithEnrichment(
          ingressSummary,
          coercedIngress as unknown as Record<string, unknown>,
        );
        analysisSummary = reconciled.summary;
        fragileEdgeSource = reconciled.fragile_edge_source;
        topDriverSource = reconciled.top_driver_source;
      }
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
        // Confirms the body-analysis_state fragile-edge fix in real traffic:
        // `analysis_state_source: 'request'` + `fragile_edge_source:
        // 'top_level'` means a request-supplied analysis_state had its fragile
        // edges rescued from the top-level shape — the path that previously
        // dropped them. Null off the request path.
        fragile_edge_source: fragileEdgeSource,
        // Same confirmation for the top-driver parity fix: `'top_level'`
        // means a request-supplied analysis_state had its drivers rescued
        // from the top-level `factor_sensitivity[]` shape — the gap that
        // previously sent advice-gate `needs_top_driver` classes to the
        // fresh-analysis recap copy. Null off the request path.
        top_driver_source: topDriverSource,
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
      const contextPackStartedAt = timingsEnabled ? Date.now() : 0;
      // Coaching Context Pack v1: project the live `deriveAnalysisFreshness`
      // verdict (already computed this turn) + readiness into the hash-free,
      // prompt-safe `CoachingStatePack`. Assembled ONLY when the behaviour flag
      // is on AND a freshness verdict exists; otherwise the field is omitted so
      // the assembled pack — and the serialised prompt — is byte-identical to
      // today. Mission 1 (context authority): sourced from the SHARED
      // memoised pre-dispatch canonical (`canonicalStateForNonExecute`) —
      // the same object the clarify/coach/converse chips and the finalise
      // fallback read — instead of a separate partial
      // `canonicalStateFromFreshness` object, so the prompt pack and the
      // chips can never disagree. The full verdict is contradiction-aware;
      // `summariseCoachingStatePack` still omits hashes/degraded detail.
      if (config.cee.coachingContextPromptEnabled && freshness !== null) {
        coachingPromptCanonical = canonicalStateForNonExecute() ?? null;
      }
      const coachingContext = coachingPromptCanonical
        ? summariseCoachingStatePack(coachingPromptCanonical)
        : undefined;
      const { contextPack, cqeSummary } = assembleContextPackWithSummary({
        payload,
        priorTurns: context.prior_turns,
        // V5 product-state continuity (foamy-bee tranche): thread
        // prior_facts so the assembler can project the `recent_changes`
        // summary. Without this, follow-up state-queries ("what update
        // did you make?") have no human-readable receipt to ground
        // Sonnet's answer and fall to the legacy `edit_graph` catch-all.
        priorFacts: context.prior_facts,
        // Lane 28 — brief pipeline (dossier gap G2): the persisted decision
        // brief (`scenarios.brief_text`, loaded once per turn by
        // buildTurnContext in the same round trip as the graph). Projected
        // into `ContextPack.brief` size-bounded with DISCLOSED truncation and
        // serialised into the routing prompt by buildUserMessage — before
        // this, the brief reached no LLM after the draft turn. Null when no
        // brief has been persisted.
        brief: context.scenarioBriefText,
        graph: compactedGraph ? undefined : graphStateForTurn,
        compactedGraph,
        compactedConstraints,
        analysis: analysisSummary,
        analysisStalenessReason,
        // Spine A backstop: option-controlled levers must not be surfaced as
        // tunable sensitivity drivers. Computed from the RAW, unparsed graph —
        // NOT the compacted projection (strips intervention bundles) and NOT a
        // GraphV3-parsed graph (keeps only top-level `node.interventions`,
        // dropping `node.data.interventions` / top-level `options[]`). Empty
        // set ⇒ no suppression (fail-safe).
        //
        // Authority = `context.persistedGraph ?? options.graphState` (CANONICAL-
        // first; request graph only as a cold-start fallback). This projection's
        // `top_drivers` feed the routed what_would_flip deterministic fallback
        // prose ("Movement on X would shift this result the most"), so it must
        // follow the same canonical graph freshness trusts under client lag —
        // `currentAnalysisGraphHashForTurn` derives from `context.persistedGraph`,
        // "NOT the request-supplied graphStateForTurn". A request-FIRST authority
        // let a stale request graph (intervention not yet echoed) read an empty
        // controlled set and leak an option-pinned lever into that sentence while
        // the analysis stayed anchored to the canonical persisted graph (P0b-2).
        interventionControlledFactorIds: collectInterventionControlledFactorIds(
          context.persistedGraph ?? options.graphState,
        ),
        coaching: coachingCache,
        // Flag-gated, prompt-safe coaching pack (undefined ⇒ field omitted).
        coachingContext,
        // Track 2 — real pending-confirmation truth (was never threaded, so the
        // assembler's `?? false` default made the field constant-false). Same
        // shared const the canonical frame receives at the finalise seam —
        // pack/frame agreement by construction. LLM-routing-visible via the
        // serialised pack; kill-switch documented at the derivation site.
        pendingConfirmation: pendingConfirmationForTurn,
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
      if (timingsEnabled) {
        turnTimings.context_pack_assembly_ms = Date.now() - contextPackStartedAt;
        turnTimings.context_pack_chars = contextPackCharsForObs;
      }

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

      // V5 Context Management v1 — emit context readiness snapshot.
      // Compact structural picture of what the turn executor loaded for
      // this turn (graph/brief presence, prior fact counts, freshness
      // verdict + hashes, pending actions, recent_changes count, Phase 3
      // block context availability, context_pack size). Fires once per
      // turn, here, so operators can see at a glance what shaped routing.
      //
      // Privacy: all non-routing fields are numbers, booleans, the
      // freshness enum, or graph hashes (the same SHA-prefixes already
      // emitted by v5.analysis_freshness.derived). No user prose, no
      // labels, no raw entity / node / edge / option / fact IDs.
      contextReadiness = deriveContextReadiness({
        context,
        freshness,
        recentChangeCount: contextPack.recent_changes.length,
        contextPackChars: contextPackCharsForObs,
      });
      emit(TelemetryEvents.V5ContextReadiness, {
        request_id: requestId,
        scenario_id: context.session_id,
        graph_present: contextReadiness.graph_present,
        graph_node_count: contextReadiness.graph_node_count,
        graph_edge_count: contextReadiness.graph_edge_count,
        brief_present: contextReadiness.brief_present,
        prior_fact_count: contextReadiness.prior_fact_count,
        has_run_analysis_fact: contextReadiness.has_run_analysis_fact,
        latest_analysis_freshness: contextReadiness.latest_analysis_freshness,
        latest_analysis_graph_hash: contextReadiness.latest_analysis_graph_hash,
        current_graph_hash: contextReadiness.current_graph_hash,
        pending_action_count: contextReadiness.pending_action_count,
        recent_change_count: contextReadiness.recent_change_count,
        phase3_block_context_available:
          contextReadiness.phase3_block_context_available,
        context_pack_chars: contextReadiness.context_pack_chars,
      });

      // V5 Task 3.2: keep the existing debug log for local dev visibility.
      // Primary event above is the queryable signal; this is extra noise
      // gated behind debug level and carries only minimal fields.
      log.debug(
        {
          request_id: requestId,
          v5_journey_id: v5JourneyId,
          session_id: context.session_id,
          // ROADMAP 1.32 — served-snapshot identity, constant fallback.
          system_chars:
            getCachedRoutingPromptIdentity()?.system_chars ??
            ROUTING_PROMPT_SYSTEM_CHARS,
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
          const committed = await commitTurn(recoveryResponse, {
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
      // Lane 34 — GM held-execute resume (propose → hold → confirm →
      // apply). Reached ONLY from the pending_action branch below when the
      // matched pending is a GM held one AND CEE_GRAPH_MANAGEMENT_MODE is
      // 'live' at resume time. Hash-gates against the hold-time pin
      // (like-for-like recompute), delegates re-referee + apply + receipt
      // to handlers/gm-held-execute.ts, and commits through the single
      // durable writer. Every decline resolves through the shared
      // proposed-change recovery closure above (fail-closed; nothing
      // persisted).
      const commitGmHeldResume = async (
        heldPending: PendingAction,
        read: GmHeldResumeRead,
      ): Promise<TurnExecutorRunResult> => {
        if (read.kind !== 'ok') {
          // Legacy lane-8 pendings / oversize-degraded holds carry no
          // executable payload — the sanctioned decline (same copy as the
          // generic synthesis 'invalid' outcome).
          return commitProposedChangeRecovery('invalid', 'gm_held_execute_no_payload');
        }
        // Hash precondition, like-for-like with the hold-time pin: the SAME
        // hash function over the SAME graph-authority class (persisted
        // graph, ingress-echo fallback) the gate hashed when it emitted the
        // pending. (The generic synthesis path compares against
        // freshness.current_graph_hash, which under analysisReadyGuard can
        // hash a CANONICALISED graph — a raw recompute avoids false
        // supersessions while staying fail-closed.)
        const gmBaseGraph = context.persistedGraph ?? graphStateForTurn ?? null;
        let gmBaseHash: string | null = null;
        try {
          gmBaseHash = computeAnalysisAffectingGraphHash(
            gmBaseGraph as GraphStateIngress | null | undefined,
          );
        } catch {
          gmBaseHash = null;
        }
        const pinnedHash = heldPending.preconditions.graph_hash;
        if (
          gmBaseHash === null ||
          typeof pinnedHash !== 'string' ||
          pinnedHash.length === 0 ||
          gmBaseHash !== pinnedHash
        ) {
          return commitProposedChangeRecovery('superseded', 'gm_held_execute_superseded');
        }
        const outcome = executeGmHeldResume({
          operations: read.operations,
          currentGraph: gmBaseGraph,
          currentGraphHash: gmBaseHash,
          freshness: freshness?.freshness ?? 'unknown',
          hasExistingAnalysis:
            freshness?.freshness === 'fresh' || freshness?.freshness === 'stale',
          scenarioId: context.session_id,
          turnId: context.request_id,
          requestId,
        });
        if (outcome.status !== 'executed') {
          log.warn(
            {
              request_id: requestId,
              scenario_id: context.session_id,
              pending_action_id: heldPending.id,
              outcome: outcome.status,
              ...(outcome.status === 'referee_blocked'
                ? { governing: outcome.governing }
                : { reason: outcome.reason }),
            },
            'GM held-execute — confirmed hold declined (fail-closed); nothing persisted',
          );
          return commitProposedChangeRecovery('invalid', `gm_held_execute_${outcome.status}`);
        }
        // Honest applied path. The receipt text ships ONLY when the commit
        // below succeeds (a throw surfaces STATE_COMMIT_FAILED instead).
        // CONSENT-CLARITY AMENDMENT — the receipt NAMES what was confirmed
        // ("Confirmed: update 'Marketing'."), never a bare "Done"; falls
        // back to the generic swept copy when no safe subject derives.
        const gmReadiness = computeStructuralReadiness(outcome.appliedGraph);
        const gmAppliedSubject = describeHeldOperationsSubject(read.operations, gmBaseGraph);
        const appliedResponse = composeDirectAnswerResponse({
          assistant_text: buildGmHeldAppliedReceipt(
            gmAppliedSubject !== null ? [gmAppliedSubject] : [],
          ),
          stage: context.stage,
          suggested_actions:
            gmReadiness?.status === 'ready' ? [{ ...GM_HELD_APPLIED_RERUN_CHIP }] : [],
        });
        sonnetTextForLog = appliedResponse.assistant_text;
        resolvedTurnClass = 'direct_answer';
        intentClass = 'execute';
        responseTypeForObs = 'direct_answer';
        llmCallsUsed = 0;
        stagesCompleted.push('orient');
        stagesCompleted.push('compose');
        // Durable-text scrub + egress labels must resolve against the
        // APPLIED graph (set before commitTurn, which snapshots
        // effectiveTurnGraph as contentGraph); reverted on commit failure
        // so a failed turn never advertises unpersisted state.
        const preApplyEffectiveTurnGraph = effectiveTurnGraph;
        effectiveTurnGraph = outcome.appliedGraph;
        try {
          const committed = await commitTurn(appliedResponse, {
            scenario_id: context.session_id,
            turn_id: context.request_id,
            turn_class: 'direct_answer',
            // Same rationale as edit-graph-dispatch: fact-level
            // fact_type='edit_graph' is the canonical discriminator;
            // expanding V5ActionType is a schemas change out of scope.
            handler_id: null,
            request_hash: computeRequestHash(payload),
            llm_calls_used: 0,
            duration_ms: Date.now() - startedAt,
            handler_facts: [outcome.fact],
            graph: outcome.mutatedGraph,
            // Consumed proposal never carries forward (zombie-chip guard).
            consumedPendingRefs: [heldPending.chip_id],
          });
          commitPerformed = committed.performed;
          stagesCompleted.push('commit');
          // F2-CEE (1.16 run-3 diagnosis): a consented held-apply previously
          // shipped `blocks: []` with NO graph payload, assuming the UI
          // re-reads `scenarios.graph` — it never does. Attach the applied
          // post-mutation graph via the EXISTING `draft_graph` wire field
          // (the UI's only inline-graph ingestion path), same shape as the
          // draft dispatch emits (see applied-graph-emit.ts). Post-commit
          // only: a failed commit (catch below) never advertises
          // unpersisted state.
          response = {
            ...committed.response,
            draft_graph: buildAppliedGraphWireField(outcome.appliedGraph),
          };
          // Post-commit honesty plumbing: the mutation is durable, so the
          // turn outcome reports graph_mutated, the structural-claim guard
          // accepts the receipt, readiness reflects the applied graph, and
          // wire freshness re-derives against the post-apply hash (an
          // applied substantive edit honestly reads stale).
          handlerEmittedMutatedGraph = true;
          analysisReadyForTurn = gmReadiness;
          const postApplyHash = ((): string | null => {
            try {
              return computeAnalysisAffectingGraphHash(
                outcome.mutatedGraph as GraphStateIngress | null | undefined,
              );
            } catch {
              return null;
            }
          })();
          freshness = deriveAnalysisFreshness(
            context.prior_facts,
            postApplyHash,
            config.cee.optionIdentityFreshnessGuard
              ? extractGraphOptionIds(outcome.mutatedGraph)
              : undefined,
          );
          emit(TelemetryEvents.PendingActionConsumed, {
            request_id: requestId,
            scenario_id: context.session_id,
            pending_action_id: heldPending.id,
            kind: heldPending.action.kind,
            chip_id: heldPending.chip_id,
            llm_calls_used: 0,
            duration_ms: Date.now() - startedAt,
          });
        } catch (error) {
          effectiveTurnGraph = preApplyEffectiveTurnGraph;
          log.error(
            {
              event: 'v5.state_commit_failed',
              request_id: requestId,
              session_id: context.session_id,
              path: 'gm_held_execute_apply',
              err: serialiseError(error),
            },
            'V5 TurnExecutor commit failure on GM held-execute apply',
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
      // CONSENT-CLARITY AMENDMENT — "all of them" over MULTIPLE GM holds
      // (live mode only; the caller verified every candidate carries an
      // executable payload). Applies the confirmed holds SEQUENTIALLY in
      // one commit: each batch is re-refereed against the WORKING graph
      // (the previous step's applied result) via `executeGmHeldResume`'s
      // internal gate — a "yes to all" never overrides an integrity
      // rejection, and a later hold is judged against the model the
      // earlier ones just produced. Pin gate: every hold must still pin
      // the ORIGINAL base (like-for-like with the single-resume path);
      // any divergence declines the whole set as superseded, applying
      // nothing. Per-step declines are reported BY NAME; the receipt
      // names every applied change (doctrine (a)). Nothing persists
      // unless at least one step executed — and then only through the
      // single durable writer, atomically.
      const commitGmHeldResumeAll = async (
        holds: readonly PendingAction[],
        reads: readonly Extract<GmHeldResumeRead, { kind: 'ok' }>[],
      ): Promise<TurnExecutorRunResult> => {
        const gmBaseGraph = context.persistedGraph ?? graphStateForTurn ?? null;
        let workingGraph: unknown = gmBaseGraph;
        let workingHash: string | null = null;
        try {
          workingHash = computeAnalysisAffectingGraphHash(
            workingGraph as GraphStateIngress | null | undefined,
          );
        } catch {
          workingHash = null;
        }
        if (workingHash === null) {
          return commitProposedChangeRecovery('superseded', 'consent_all_no_base');
        }
        for (const hold of holds) {
          const pin = hold.preconditions.graph_hash;
          if (typeof pin !== 'string' || pin.length === 0 || pin !== workingHash) {
            return commitProposedChangeRecovery('superseded', 'consent_all_superseded');
          }
        }
        type ExecutedGmOutcome = Extract<
          ReturnType<typeof executeGmHeldResume>,
          { status: 'executed' }
        >;
        const appliedSubjects: string[] = [];
        const appliedFacts: ExecutedGmOutcome['fact'][] = [];
        const consumedRefs: string[] = [];
        const declinedLabels: string[] = [];
        let lastExecuted: ExecutedGmOutcome | null = null;
        for (let i = 0; i < holds.length; i += 1) {
          if (workingHash === null) {
            // A mid-chain hash derivation failed — fail closed for the
            // REMAINING holds rather than applying against an unverified
            // base. Already-applied steps stay applied (each was refereed).
            declinedLabels.push(resolveProposalRenderCopy(holds[i]!.action).label);
            continue;
          }
          const preStepGraph = workingGraph;
          const outcome = executeGmHeldResume({
            operations: reads[i]!.operations,
            currentGraph: preStepGraph,
            currentGraphHash: workingHash,
            freshness: freshness?.freshness ?? 'unknown',
            hasExistingAnalysis:
              freshness?.freshness === 'fresh' || freshness?.freshness === 'stale',
            scenarioId: context.session_id,
            turnId: context.request_id,
            requestId,
          });
          if (outcome.status !== 'executed') {
            log.warn(
              {
                request_id: requestId,
                scenario_id: context.session_id,
                pending_action_id: holds[i]!.id,
                outcome: outcome.status,
                position: i,
              },
              'GM held-execute (all) — one confirmed hold declined (fail-closed); the others are unaffected',
            );
            declinedLabels.push(resolveProposalRenderCopy(holds[i]!.action).label);
            continue;
          }
          emit(TelemetryEvents.PendingActionMatched, {
            request_id: requestId,
            scenario_id: context.session_id,
            pending_action_id: holds[i]!.id,
            kind: holds[i]!.action.kind,
            chip_id: holds[i]!.chip_id,
            candidate_count: holds.length,
          });
          const subject = describeHeldOperationsSubject(reads[i]!.operations, preStepGraph);
          if (subject !== null) appliedSubjects.push(subject);
          appliedFacts.push(outcome.fact);
          consumedRefs.push(holds[i]!.chip_id);
          lastExecuted = outcome;
          workingGraph = outcome.mutatedGraph;
          try {
            workingHash = computeAnalysisAffectingGraphHash(
              outcome.mutatedGraph as GraphStateIngress | null | undefined,
            );
          } catch {
            workingHash = null;
          }
        }
        if (lastExecuted === null) {
          // Every hold declined at re-referee / apply — fail-closed, the
          // sanctioned decline copy, nothing persisted.
          return commitProposedChangeRecovery('invalid', 'consent_all_all_declined');
        }
        // Honest applied path (mirrors the single-resume commit exactly).
        // Receipt names every applied change; per-name decline sentence
        // for any hold the re-referee refused — never a silent partial.
        const gmReadiness = computeStructuralReadiness(lastExecuted.appliedGraph);
        let receiptText = buildGmHeldAppliedReceipt(appliedSubjects);
        if (declinedLabels.length > 0) {
          const declinedNamed = declinedLabels.map((l) => `'${l}'`).join(', ');
          receiptText += ` I couldn't take ${declinedNamed} forward, so the model is unchanged for ${
            declinedLabels.length === 1 ? 'that one' : 'those'
          }.`;
        }
        const appliedResponse = composeDirectAnswerResponse({
          assistant_text: receiptText,
          stage: context.stage,
          suggested_actions:
            gmReadiness?.status === 'ready' ? [{ ...GM_HELD_APPLIED_RERUN_CHIP }] : [],
        });
        sonnetTextForLog = appliedResponse.assistant_text;
        resolvedTurnClass = 'direct_answer';
        intentClass = 'execute';
        responseTypeForObs = 'direct_answer';
        llmCallsUsed = 0;
        stagesCompleted.push('orient');
        stagesCompleted.push('compose');
        const preApplyEffectiveTurnGraph = effectiveTurnGraph;
        effectiveTurnGraph = lastExecuted.appliedGraph;
        try {
          const committed = await commitTurn(appliedResponse, {
            scenario_id: context.session_id,
            turn_id: context.request_id,
            turn_class: 'direct_answer',
            handler_id: null,
            request_hash: computeRequestHash(payload),
            llm_calls_used: 0,
            duration_ms: Date.now() - startedAt,
            handler_facts: appliedFacts,
            graph: lastExecuted.mutatedGraph,
            // Every APPLIED hold is consumed (zombie-chip guard); declined
            // holds keep the existing pending lifecycle and its honest
            // outcomes.
            consumedPendingRefs: consumedRefs,
          });
          commitPerformed = committed.performed;
          stagesCompleted.push('commit');
          response = {
            ...committed.response,
            draft_graph: buildAppliedGraphWireField(lastExecuted.appliedGraph),
          };
          handlerEmittedMutatedGraph = true;
          analysisReadyForTurn = gmReadiness;
          const postApplyHash = ((): string | null => {
            try {
              return computeAnalysisAffectingGraphHash(
                lastExecuted!.mutatedGraph as GraphStateIngress | null | undefined,
              );
            } catch {
              return null;
            }
          })();
          freshness = deriveAnalysisFreshness(
            context.prior_facts,
            postApplyHash,
            config.cee.optionIdentityFreshnessGuard
              ? extractGraphOptionIds(lastExecuted.mutatedGraph)
              : undefined,
          );
          for (const ref of consumedRefs) {
            const consumedHold = holds.find((h) => h.chip_id === ref)!;
            emit(TelemetryEvents.PendingActionConsumed, {
              request_id: requestId,
              scenario_id: context.session_id,
              pending_action_id: consumedHold.id,
              kind: consumedHold.action.kind,
              chip_id: consumedHold.chip_id,
              llm_calls_used: 0,
              duration_ms: Date.now() - startedAt,
            });
          }
        } catch (error) {
          effectiveTurnGraph = preApplyEffectiveTurnGraph;
          log.error(
            {
              event: 'v5.state_commit_failed',
              request_id: requestId,
              session_id: context.session_id,
              path: 'gm_held_execute_apply_all',
              err: serialiseError(error),
            },
            'V5 TurnExecutor commit failure on GM held-execute apply-all',
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
      // F-HELD round 2 (FIXUP 1) — intent-vs-kind guard: the synthetic "yes"
      // a chip click produces must only ever resolve pendings of the CLICKED
      // kind. Without this scope, the consent-priority pick would resolve a
      // wwf chip click to a live apply_proposed_change hold and execute a
      // held mutation off an explanation click. Typed "yes" (no intent flag)
      // passes the full set through — consent-priority untouched.
      const pendingsForShortConfirm = scopePendingsToChipClickIntent(
        context.most_recent_pending_actions ?? [],
        options.chipClickResumeIntent,
      );
      const shortConfirmDispatch = tryShortConfirmResume({
        message: resumerMessage,
        pendingActions: pendingsForShortConfirm,
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
            const committed = await commitTurn(recoveryResponse, {
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
          // Lane 34 — GM held-execute wiring. A GM held pending
          // (inline_patch.handler_id = 'graph_management_held_v1') is
          // recognised BEFORE the generic synthesis. Live mode executes
          // the confirmed batch through the dedicated resume path; in
          // off/shadow (flag flipped back mid-flight — the pending can
          // only be CREATED in live mode) it falls through to the generic
          // synthesis, which resolves 'invalid' → the lane-8
          // decline-with-clarify — byte-identical to the pre-wiring
          // posture (flag-gated inertness, pinned by
          // gm-held-execute-route-level.test.ts).
          const gmHeldRead = readGmHeldResume(pending);
          if (
            gmHeldRead.kind !== 'not_gm_held' &&
            config.features.graphManagementMode === 'live'
          ) {
            return commitGmHeldResume(pending, gmHeldRead);
          }
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
          const committed = await commitTurn(recoveryResponse, {
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
          const committed = await commitTurn(recoveryResponse, {
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
        // CONSENT-CLARITY AMENDMENT (Paul ratified 2026-07-11) — LIVE again.
        // This branch was unreachable under V5 P0.2 most-recent-wins
        // (commit 9aa6e2f5); the ratified doctrine reverses that for the
        // CONSENT class: a bare confirmation arriving while MULTIPLE
        // consent-expecting pendings are live must NOT silently resolve
        // one. The resumer now returns every live consent candidate here
        // (apply_proposed_change first, then proposed_concept) and this
        // branch lists them — numbered, short labels, one chip per item
        // plus "All of them" and "None" — with NO mutation on this turn.
        // A follow-up numbered reply / chip click / "all" resolves via
        // the existing pre-routes against the re-persisted candidates.
        emit(TelemetryEvents.PendingActionRecoveryAmbiguous, {
          request_id: requestId,
          scenario_id: context.session_id,
          candidate_count: shortConfirmDispatch.candidates.length,
          kinds: shortConfirmDispatch.candidates.map((c) => c.action.kind),
          // Payload discriminator on the existing frozen event name —
          // distinguishes the doctrine-(b) multi-consent listing from the
          // label-collision clarification that shares this event.
          trigger: 'multi_consent_bare_confirm',
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
            if (cand.action.kind === 'proposed_concept') {
              // CONSENT-CLARITY AMENDMENT — a live concept offer counts as
              // a consent-expecting candidate. Its persisted public copy is
              // parser-required and names the concept; the chip carries NO
              // action_type (a plain message chip), so a click replays the
              // message through the normal pipeline where the concept
              // continuation / edit path resolves it — existing machinery.
              return {
                id: cand.chip_id,
                label: sanitisePublicCopyOrFallback(
                  cand.action.public_label,
                  'Add the suggested idea',
                ),
                message: sanitisePublicCopyOrFallback(
                  cand.action.public_message,
                  'Continue with the suggested idea.',
                ),
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
        // CONSENT-CLARITY guard: a bare short-confirm ("yes") must never
        // exact-match a LEGACY candidate whose persisted public message is
        // itself a bare confirm ('Yes' — the pre-amendment GM hold chip
        // copy). Without this gate, one legacy hold among the candidates
        // would silently swallow the disambiguation the doctrine requires.
        // Genuinely targeted replies (ordinals, labels, named messages)
        // are not short-confirms and still resolve below.
        if (allProposals && !SHORT_CONFIRM_PATTERN.test(resumerMessage)) {
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
            // Lane 34 parity: a GM held pending resolved by ordinal/label
            // must route through the dedicated held-execute resume (live
            // mode), exactly like the bare-confirm pending_action branch —
            // the generic synthesis would resolve it 'invalid' and decline
            // a change the user explicitly picked.
            const ordinalGmRead = readGmHeldResume(ordinal.pending);
            if (
              ordinalGmRead.kind !== 'not_gm_held' &&
              config.features.graphManagementMode === 'live'
            ) {
              return commitGmHeldResume(ordinal.pending, ordinalGmRead);
            }
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
        // CONSENT-CLARITY AMENDMENT — doctrine (b) listing copy: name
        // every pending consent (numbered, short labels) and offer the
        // three resolution routes explicitly (a number, all of them,
        // none). No mutation happens on this turn. Falls back to the
        // generic prompt only when a label is the render-safe fallback
        // (a numbered list of identical placeholders would not help).
        const allCandidatesHaveLabels = ambiguousChips.every(
          (c) => c.label.length > 0 && c.label !== RENDER_SAFE_LABEL_FALLBACK,
        );
        const numberedList = ambiguousChips
          .map((c, i) => `${i + 1}) ${c.label}`)
          .join(' ');
        const ambiguousAssistantText = allCandidatesHaveLabels
          ? `I have more than one change waiting for your go-ahead, so I want to ` +
            `be sure which one you meant. ${numberedList}. Reply with a number ` +
            `to apply one, 'all of them', or 'none'.`
          : 'I had more than one offer open. Which would you like?';
        // Resolution chips: one per candidate (built above), then the
        // collective options. "All of them." resolves via the resumer's
        // consent_all pattern; "Not now." resolves via the proposal-
        // dismissal pre-route. Neither carries an action_type — they are
        // plain message chips riding existing machinery.
        const consentResolutionChips: SuggestedAction[] = [
          ...ambiguousChips,
          {
            id: 'chip_consent_pick_all',
            label: 'All of them',
            message: 'All of them.',
          },
          {
            id: 'chip_consent_pick_none',
            label: 'None',
            message: 'Not now.',
          },
        ];
        const ambiguousResponse = composeDirectAnswerResponse({
          assistant_text: ambiguousAssistantText,
          stage: context.stage,
          suggested_actions: consentResolutionChips,
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
          // CONSENT-CLARITY: BOTH consent kinds re-persist — a listed
          // `proposed_concept` must stay live for the follow-up pick just
          // like a listed proposal (its this-turn copy supersedes the
          // carried prior via the kind-level concept supersession rule).
          const proposalsToRepersist = shortConfirmDispatch.candidates.filter(
            (c) =>
              c.action.kind === 'apply_proposed_change' ||
              c.action.kind === 'proposed_concept',
          );
          const chipDerivedForAmbiguous = derivePendingActionsFromFinalizedChips(ambiguousChips, {
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
          const committed = await commitTurn(ambiguousResponse, {
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
      } else if (shortConfirmDispatch.dispatch === 'consent_all') {
        // CONSENT-CLARITY AMENDMENT — the user confirmed ALL listed
        // consents ("all of them" / the 'All of them' chip). Two paths:
        //
        //  1. Every candidate is a GM hold with an executable payload AND
        //     graph management is live → apply them sequentially in ONE
        //     commit via `commitGmHeldResumeAll` (each step re-refereed
        //     against the working graph; named receipt per applied
        //     change; per-name decline for anything the referee refuses).
        //
        //  2. Any other composition (generic proposals, concept offers,
        //     GM off/shadow) has NO safe one-shot apply: generic
        //     proposals are hash-gated to their emit-time base BY DESIGN,
        //     so applying one invalidates the rest — a one-turn "apply
        //     all" would over-claim. Honest posture: NO mutation, restate
        //     the numbered list and take them one at a time.
        const allCandidates = shortConfirmDispatch.candidates;
        const gmReads = allCandidates.map((c) => readGmHeldResume(c));
        const executableReads = gmReads.filter(
          (r): r is Extract<GmHeldResumeRead, { kind: 'ok' }> => r.kind === 'ok',
        );
        if (
          executableReads.length === allCandidates.length &&
          config.features.graphManagementMode === 'live'
        ) {
          return commitGmHeldResumeAll(allCandidates, executableReads);
        }
        emit(TelemetryEvents.PendingActionRecoveryAmbiguous, {
          request_id: requestId,
          scenario_id: context.session_id,
          candidate_count: allCandidates.length,
          kinds: allCandidates.map((c) => c.action.kind),
          trigger: 'consent_all_one_at_a_time',
        });
        const oneAtATimeChips: SuggestedAction[] = allCandidates.map((cand) => {
          if (cand.action.kind === 'proposed_concept') {
            return {
              id: cand.chip_id,
              label: sanitisePublicCopyOrFallback(
                cand.action.public_label,
                'Add the suggested idea',
              ),
              message: sanitisePublicCopyOrFallback(
                cand.action.public_message,
                'Continue with the suggested idea.',
              ),
            };
          }
          const renderCopy = resolveProposalRenderCopy(cand.action);
          const inlineHandlerId =
            cand.action.kind === 'apply_proposed_change'
              ? (cand.action.inline_patch as { handler_id?: unknown })?.handler_id
              : undefined;
          // Proposal-backed candidates carry their public action_type; a
          // GM hold's dispatch key is NOT a wire action type, so its chip
          // stays a plain message chip (message replay resolves it).
          return isProposedChangeActionType(inlineHandlerId)
            ? {
                id: cand.chip_id,
                label: renderCopy.label,
                message: renderCopy.message,
                action_type: inlineHandlerId,
              }
            : { id: cand.chip_id, label: renderCopy.label, message: renderCopy.message };
        });
        const oneAtATimeNumbered = oneAtATimeChips
          .map((c, i) => `${i + 1}) ${c.label}`)
          .join(' ');
        const oneAtATimeResponse = composeDirectAnswerResponse({
          assistant_text:
            `I can apply those one at a time, checking each against the latest ` +
            `model. ${oneAtATimeNumbered}. Reply with a number to start, or 'none'.`,
          stage: context.stage,
          suggested_actions: [
            ...oneAtATimeChips,
            { id: 'chip_consent_pick_none', label: 'None', message: 'Not now.' },
          ],
        });
        sonnetTextForLog = oneAtATimeResponse.assistant_text;
        resolvedTurnClass = 'direct_answer';
        intentClass = 'converse';
        responseTypeForObs = 'direct_answer';
        llmCallsUsed = 0;
        stagesCompleted.push('orient');
        stagesCompleted.push('compose');
        try {
          // Re-persist every listed consent (identity preserved; wall TTL
          // still applies) so the follow-up pick has live offers.
          const committed = await commitTurn(oneAtATimeResponse, {
            scenario_id: context.session_id,
            turn_id: context.request_id,
            turn_class: 'direct_answer',
            handler_id: null,
            request_hash: computeRequestHash(payload),
            llm_calls_used: 0,
            duration_ms: Date.now() - startedAt,
            handler_facts: [],
            pending_actions: allCandidates,
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
              path: 'consent_all_one_at_a_time',
              err: serialiseError(error),
            },
            'V5 TurnExecutor commit failure on consent-all one-at-a-time listing',
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
            // CONSENT-CLARITY / lane 34 parity: GM holds now carry NAMED
            // public copy ("Yes, update 'Marketing'."), so a hold-chip
            // click (message replay) or a typed named confirmation lands
            // HERE, not in the bare-confirm branch. Route it through the
            // dedicated held-execute resume in live mode — the generic
            // synthesis would resolve the GM handler id 'invalid' and
            // decline a change the user explicitly picked.
            const labelGmRead = readGmHeldResume(labelPick.pending);
            if (
              labelGmRead.kind !== 'not_gm_held' &&
              config.features.graphManagementMode === 'live'
            ) {
              return commitGmHeldResume(labelPick.pending, labelGmRead);
            }
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
              const committed = await commitTurn(ambiguousResponse, {
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
            const committed = await commitTurn(dismissalResponse, {
              scenario_id: context.session_id,
              turn_id: context.request_id,
              turn_class: 'direct_answer',
              handler_id: null,
              request_hash: computeRequestHash(payload),
              llm_calls_used: 0,
              duration_ms: Date.now() - startedAt,
              handler_facts: [],
              // V5 Signature Loop — a REJECTED proposal must not carry forward.
              // Exclude the dismissed refs from this turn's carry-forward so it
              // cannot reappear as a zombie next turn (consumption-path #1).
              consumedPendingRefs: dismissal.dismissed_refs,
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
                // 1.16 item A2 — a pending carrying an explicit `cap` (the
                // consented rescale chip) synthesises the structured
                // {value, unit, cap} shape; proposalCap takes precedence in
                // the shared predicate + handler, so the cap extension
                // applies atomically with the value.
                value:
                  action.unit !== undefined || action.cap !== undefined
                    ? {
                        value: action.value,
                        ...(action.unit !== undefined ? { unit: action.unit } : {}),
                        ...(action.cap !== undefined ? { cap: action.cap } : {}),
                      }
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
      } else if (
        clarificationDispatch.matched &&
        clarificationDispatch.dispatch === 'edit_graph_add_risk'
      ) {
        // F-HELD fix 4b (A-variant) — deterministic continuation for the
        // add-risk driver answer (wire 04c→10c: previously dropped to the
        // LLM, which coached instead of continuing the add). No V5 add
        // handler exists (the deterministic add path lives in legacy
        // handleEditGraph behind the route-level edit dispatch), so the
        // resume acknowledges risk + driver and offers an EXECUTABLE replay
        // chip whose compound message routes to the edit pipeline on click
        // (edit verb present; deliberately NOT end-anchored on "as a risk",
        // so the bare add-risk clarify classifier cannot re-claim it). The
        // answered clarify pending is consumed — its question has been
        // answered; the continuation now rides the chip.
        const pending = clarificationDispatch.pending;
        emit(TelemetryEvents.PendingActionMatched, {
          request_id: requestId,
          scenario_id: context.session_id,
          pending_action_id: pending.id,
          kind: 'edit_graph_add_risk',
          chip_id: pending.chip_id,
          candidate_count: 1,
        });
        const riskLabel = clarificationDispatch.riskLabel;
        const driverLabel = clarificationDispatch.driverLabel;
        const addRiskResumeResponse = composeDirectAnswerResponse({
          // Deterministic copy family: mirrors the swept GM held wording
          // ("Nothing in the model moves until you confirm") — no success
          // claim, no denial phrase, no internal tokens, no em dash.
          assistant_text:
            `Got it: I can add ${riskLabel} as a risk with ${driverLabel} as its main driver. ` +
            'Nothing in the model moves until you confirm. Use the suggestion below to add it, ' +
            'or tell me what to adjust instead.',
          stage: context.stage,
          suggested_actions: [
            {
              id: 'chip_add_risk_apply',
              label: 'Add it to the model',
              message: `Add ${riskLabel} as a risk, with ${driverLabel} as its main driver.`,
            },
          ],
        });
        sonnetTextForLog = addRiskResumeResponse.assistant_text;
        resolvedTurnClass = 'direct_answer';
        intentClass = 'converse';
        responseTypeForObs = 'direct_answer';
        llmCallsUsed = 0;
        stagesCompleted.push('orient');
        stagesCompleted.push('compose');
        try {
          const committed = await commitTurn(addRiskResumeResponse, {
            scenario_id: context.session_id,
            turn_id: context.request_id,
            turn_class: 'direct_answer',
            handler_id: null,
            request_hash: computeRequestHash(payload),
            llm_calls_used: 0,
            duration_ms: Date.now() - startedAt,
            handler_facts: [],
            // The driver question has been ANSWERED — consume the clarify
            // pending so it cannot zombie into a second resume.
            consumedPendingRefs: [pending.chip_id],
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
              path: 'add_risk_driver_resume',
              err: serialiseError(error),
            },
            'V5 TurnExecutor commit failure on add-risk driver resume',
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
                    // 1.16 item A2 — preserve a consented rescale cap
                    // across the ambiguity re-clarify, same as value/unit.
                    ...(a.cap !== undefined ? { cap: a.cap } : {}),
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
          const committed = await commitTurn(recoveryResponse, {
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
      // executor. `factorIdSet` (computed just above for the
      // selection-narrowing path) is threaded through as the type filter
      // too (1.16b) — it already carries the authoritative factor-kind id
      // set from raw graph state, so the label-matching candidate pool
      // inside the matcher never surfaces a decision/outcome/risk/action
      // node as a value-update candidate.
      //
      // Guarded on `graphStateForTurn !== null`: `factorIdSet` is derived
      // FROM `graphStateForTurn.nodes` (see above), so it is only a
      // trustworthy factor-kind id set when that raw graph was actually
      // available. The `options.graphLookup` test-override path can
      // supply a lookup with real candidates while `graphStateForTurn`
      // stays null (no `graphState` given) — passing an empty
      // `factorIdSet` there would filter out every real candidate rather
      // than leaving the pool unfiltered. Falling back to `undefined`
      // preserves the matcher's documented "no kind information supplied
      // → unfiltered pool" behaviour for that narrow case.
      let deterministicValueUpdate = tryDeterministicValueUpdate(
        payload.message,
        contextPack.parsed_quantities,
        graphLookupForValidate,
        selectedFactorIds,
        graphStateForTurn !== null ? factorIdSet : undefined,
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
        // reuses the existing branch with no duplication. The optional
        // `attribution` tag (PR #192 reviewer feedback) carries through
        // so V5DeterministicValueUpdate telemetry distinguishes
        // from/to dispatches on the deictic path the same way it does
        // on the label path.
        deterministicValueUpdate = {
          matched: true,
          dispatch: 'set_factor_value',
          candidate: deicticDispatch.candidate,
          quantity: deicticDispatch.quantity,
          ...(deicticDispatch.attribution
            ? { attribution: deicticDispatch.attribution }
            : {}),
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
      // Granular precheck rejection reason — populated when the
      // pre-synthesis evaluator catches a cap/range/unit/delta problem
      // before the proposal is even built. Feeds the V5DeterministicValueUpdate
      // telemetry payload (Layer C) so dashboards can distinguish the
      // specific rejection cause beyond `downgrade_reason`.
      let precheckRejectionReason: ProposalRejectionReason | null = null;
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

          // Pre-synthesis evaluator check (Layer A.3 of the parity
          // workstream). The validator-side check (Layer A.2) is the
          // canonical safety net, but running the predicate here too
          // means a deterministic proposal that would fail at execute
          // never gets synthesised in the first place. Two benefits:
          //   (a) avoids creating a doomed RoutingToolCallResult only
          //       to have the validator reject it three steps later;
          //   (b) gives us granular telemetry (`precheck_rejection_reason`)
          //       distinguishing detector-time rejection from
          //       validator-time rejection.
          // The check uses the same shared predicate as Layer A.2 and
          // the handler, so divergence is structurally impossible
          // (AC.1 parity invariant).
          const observedState = (nodeKind ?? {}) as {
            observed_state?: {
              value?: unknown;
              raw_value?: unknown;
              unit?: unknown;
              cap?: unknown;
            };
          };
          const obs = observedState.observed_state;
          const factorCap = typeof obs?.cap === 'number' ? obs.cap : undefined;
          const factorUnit = typeof obs?.unit === 'string' ? obs.unit : undefined;
          // De-normalise the delta LHS identically to the handler +
          // validator via `resolveExistingRawValue` (raw_value, else
          // value*cap for capped, else value) — never feed the normalised
          // `value` as the raw LHS. The predicate's `delta_no_existing_value`
          // guard catches "neither present" for delta operators (AC.3).
          const existing = resolveExistingRawValue({
            ...(typeof obs?.raw_value === 'number' ? { raw_value: obs.raw_value } : {}),
            ...(typeof obs?.value === 'number' ? { value: obs.value } : {}),
            ...(factorUnit !== undefined ? { unit: factorUnit } : {}),
            ...(factorCap !== undefined ? { cap: factorCap } : {}),
          });
          const inputHasUnit = unit !== undefined && unit.length > 0;
          const evaluation = evaluateFactorValueProposal({
            rawInput: userUnitValue,
            operator: operator as FactorValueOperator,
            ...(unit !== undefined ? { unit } : {}),
            ...(factorCap !== undefined ? { factorCap } : {}),
            ...(factorUnit !== undefined ? { factorUnit } : {}),
            ...(existing.kind === 'resolved' ? { factorExistingRaw: existing.raw } : {}),
            inputHasUnit,
          });
          if (!evaluation.ok) {
            // Record the granular reason in telemetry, but do NOT
            // downgrade to the clarify dispatch. The earlier draft
            // of this code path downgraded here and the clarify
            // branch persisted a pending `set_factor_value` action
            // carrying the SAME invalid quantity — the user would
            // get a chip whose later resumption would fail
            // validation. Review feedback (2026-05-20, Blocking #2)
            // flagged this as silently persisting an invalid
            // pending action.
            //
            // Correct routing: synthesise the proposal normally;
            // STEP 2 validation runs the SAME shared predicate
            // (Layer A.2) and rejects with PARAMETER_INVALID via
            // the existing recoverable-validator path, which
            // produces the canonical SET_FACTOR_VALUE_USER_GUIDANCE
            // chip WITHOUT persisting a pending action. Single
            // source of truth — both gates call
            // `evaluateFactorValueProposal`, so they cannot
            // disagree.
            precheckRejectionReason = evaluation.reason;
            // Fall through to the synthesis block below — the
            // validator handles the rejection.
          }
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
          // If precheck rejected above, STEP 2 returns PARAMETER_INVALID
          // and the validator-recoverable path produces the chip.
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
          // Preserve any from/to attribution tag across the downgrade
          // so the V5DeterministicValueUpdate telemetry still records
          // that this candidate originated from the from/to branch,
          // even after the kind/registry guard demoted it to clarify.
          // The outer guard at the top of this block already narrowed
          // `deterministicValueUpdate.dispatch === 'set_factor_value'`,
          // so `.attribution` is directly accessible on this variant.
          const carriedAttribution = deterministicValueUpdate.attribution;
          deterministicValueUpdate = {
            matched: true,
            dispatch: 'clarify',
            candidates: [candidate],
            quantity: deterministicValueUpdate.quantity,
            ...(carriedAttribution ? { attribution: carriedAttribution } : {}),
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
        // Quantity-attribution tag — 'from_to' when the dispatch
        // originated from the row-7 from/to branch, null otherwise.
        // Distinct from candidate.source (label-match concern); kept
        // separate so dashboards can filter rows independently.
        attribution:
          deterministicValueUpdate.matched &&
          (deterministicValueUpdate.dispatch === 'set_factor_value' ||
            deterministicValueUpdate.dispatch === 'clarify')
            ? deterministicValueUpdate.attribution ?? null
            : null,
        skip_reason: deterministicValueUpdate.matched
          ? null
          : deterministicValueUpdate.skip_reason,
        cqe_quantity_count: contextPack.parsed_quantities.length,
        // Layer C telemetry (AC.4) — enum-only fields tracking the
        // pre-execute evaluator outcome. Locked vocab per plan
        // "Locked telemetry enums" section.
        //
        // `execution_precheck_result`:
        //   'not_checked' — predicate did not run (no match, no graph,
        //     non-factor candidate, multi-quantity skip, etc.)
        //   'ok'          — predicate ran and accepted the proposal
        //   <ProposalRejectionReason> — predicate rejected; the value
        //     is the granular reason. Current vocabulary (see
        //     `d1-shared/evaluate-factor-value-proposal.ts`):
        //       missing_value, invalid_operator, non_finite,
        //       cap_non_positive, unit_mismatch,
        //       bare_number_outside_cap, value_exceeds_cap,
        //       delta_no_existing_value, delta_no_cap_and_no_unit,
        //       bare_ratio_on_unit_factor.
        //     Additions require a plan amendment AND a matching
        //     update to the telemetry-enum-shape test allowed set.
        //
        // When precheck rejected, the proposal still synthesised
        // (validator catches it via the same predicate → recoverable
        // invalid_parameter path). `downgrade_reason` therefore
        // stays null for value-invalid precheck rejections — it only
        // fires for kind / registry guards. See review feedback
        // 2026-05-20 (Blocking #2).
        execution_precheck_result: precheckRejectionReason
          ? precheckRejectionReason
          : deterministicValueUpdate.matched &&
              deterministicValueUpdate.dispatch === 'set_factor_value'
            ? 'ok'
            : 'not_checked',
        // `failure_reason`: ProposalRejectionReason | null — mirrors
        // `execution_precheck_result` but drops the 'ok' / 'not_checked'
        // sentinels so dashboards can filter "rejected proposals only"
        // without an additional clause.
        failure_reason: precheckRejectionReason,
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
          // Row-7 from/to attribution carries here too so the
          // V5DeterministicValueUpdate schema is consistent across
          // every emit site (PR #192 reviewer feedback round 3).
          // The clarify_deictic path can carry attribution when the
          // user's deictic message included a from/to anchor but the
          // selection narrowing failed.
          attribution: deicticDispatch.attribution ?? null,
          skip_reason: null,
          deictic_reason: deicticDispatch.reason,
          selected_factor_count: selectedFactorIds.length,
          cqe_quantity_count: contextPack.parsed_quantities.length,
          // Layer C / NB #1 — every V5DeterministicValueUpdate event
          // carries the same enum-only field set. The deictic-clarify
          // path doesn't run the value predicate, so these stay at
          // their "not run" defaults.
          execution_precheck_result: 'not_checked',
          failure_reason: null,
        });
        try {
          const committed = await commitTurn(clarifyResponse, {
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
          const committed = await commitTurn(clarifyResponse, {
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

      // V5 P0.2 — run-comparison gate (result-sense "what changed?").
      //
      // Runs BEFORE the state-query guard so the result-comparison sense
      // of "what changed?" / "why did the result change?" is not shadowed
      // by the graph-edit sense (the state-query guard's recent_changes
      // readback). It claims the turn only when a genuine prior/current
      // run comparison exists (>= 2 successful runs) OR the model is stale
      // (edited after the latest run → lead with re-run guidance, never
      // present an old comparison as the current model). Otherwise it
      // declines and the state-query guard keeps its existing behaviour.
      // 0 LLM calls, 0 new DB reads (reuses prior_facts + freshness).
      if (routingResult === undefined) {
        const runComparisonOutcome = tryRunComparisonGate({
          message: payload.message,
          priorFacts: context.prior_facts,
          freshness: freshness?.freshness,
          // Spine A backstop: option-controlled levers must not be reported as
          // gaining/losing influence in run-comparison prose (the comparator
          // diffs the raw `top_drivers`, bypassing projectTopDrivers). Computed
          // from the RAW, unparsed graph — the compacted projection strips
          // intervention bundles. Empty set ⇒ no suppression (fail-safe).
          //
          // Authority = `context.persistedGraph ?? options.graphState` (CANONICAL-
          // first; the request graph is used only when there is no persisted graph
          // — cold-start, or a degraded/failed persisted read) — the SAME
          // authority as the sibling ContextPack top-driver projection and routed
          // what_would_flip fallback after #314/#309. Freshness for this turn
          // already anchors the current-graph hash to `context.persistedGraph`
          // ("NOT the request-supplied graphStateForTurn"), so a request-FIRST
          // authority would read an empty controlled set from a stale request
          // graph (intervention not yet echoed) and leak an option-pinned lever
          // ("<factor> now has more influence …") while the analysis stayed
          // anchored to the canonical persisted graph.
          interventionControlledFactorIds: collectInterventionControlledFactorIds(
            context.persistedGraph ?? options.graphState,
          ),
        });
        emit(TelemetryEvents.V5RunComparisonGate, {
          request_id: requestId,
          scenario_id: context.session_id,
          matched: runComparisonOutcome.matched,
          mode: runComparisonOutcome.matched ? runComparisonOutcome.mode : null,
          unmatched_reason: runComparisonOutcome.matched
            ? null
            : runComparisonOutcome.reason,
          leading_option_changed: runComparisonOutcome.matched
            ? runComparisonOutcome.leading_option_changed
            : null,
          freshness: freshness?.freshness ?? null,
        });
        if (runComparisonOutcome.matched) {
          const runComparisonResponse = composeDirectAnswerResponse({
            assistant_text: runComparisonOutcome.assistant_text,
            stage: context.stage,
            suggested_actions: [...runComparisonOutcome.suggested_actions],
          });
          sonnetTextForLog = runComparisonResponse.assistant_text;
          resolvedTurnClass = 'direct_answer';
          intentClass = 'converse';
          responseTypeForObs = 'direct_answer';
          llmCallsUsed = 0;
          stagesCompleted.push('orient');
          stagesCompleted.push('compose');
          try {
            const committed = await commitTurn(runComparisonResponse, {
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
                path: 'run_comparison_gate',
                err: serialiseError(error),
              },
              'V5 TurnExecutor commit failure on run-comparison gate',
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
            const committed = await commitTurn(stateQueryResponse, {
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

      // V5 Context Management v1 — stale-rerun sibling guard.
      //
      // Fires when prior analysis exists but is NOT confirmed current —
      // `stale` (graph hash diverged; copy asserts the change) or
      // `unknown` (currency unconfirmable; copy must NOT assert a
      // change — authority parity) — AND the user is asking an
      // analytical question (explain / what_drove / what_would_flip /
      // rerun_question) AND there is no INDEPENDENT mutation signal
      // (flip-overlap phrasings stay analytical per Issue #195; a
      // genuine edit clause keeps mutation precedence). Routes to a
      // deterministic direct_answer that nudges re-run, mirroring the
      // Phase 3 stale-safe coaching block copy + action shape.
      //
      // Runs BEFORE `tryPostAnalysisAdviceGate` so the fresh-path gate
      // sees the same input shape it always has — the gate continues
      // to fast-fail on `not_fresh` for everything this guard does
      // not match, so behaviour is additive.
      if (routingResult === undefined) {
        const staleOutcome = tryStaleRerunGuard({
          message: payload.message,
          freshness: freshness?.freshness,
        });
        emit(TelemetryEvents.V5StaleRerunGuard, {
          request_id: requestId,
          scenario_id: context.session_id,
          matched: staleOutcome.matched,
          unmatched_reason: staleOutcome.matched ? null : staleOutcome.reason,
          intent_class: staleOutcome.matched ? staleOutcome.intent_class : null,
          mode: staleOutcome.matched ? staleOutcome.mode : null,
          freshness: freshness?.freshness ?? null,
        });
        if (staleOutcome.matched) {
          const staleResponse = composeDirectAnswerResponse({
            assistant_text: staleOutcome.assistant_text,
            stage: context.stage,
            suggested_actions: [...staleOutcome.suggested_actions],
          });
          sonnetTextForLog = staleResponse.assistant_text;
          resolvedTurnClass = 'direct_answer';
          intentClass = 'converse';
          responseTypeForObs = 'direct_answer';
          llmCallsUsed = 0;
          stagesCompleted.push('orient');
          stagesCompleted.push('compose');
          try {
            const committed = await commitTurn(staleResponse, {
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
                path: 'stale_rerun_guard',
                err: serialiseError(error),
              },
              'V5 TurnExecutor commit failure on stale-rerun guard',
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

      // V5 P0 stabilisation — post-analysis advice gate.
      //
      // When prior analysis is available AND the user's message is an
      // advice/coaching question AND it carries no concrete graph-
      // mutation signal, short-circuit to a deterministic direct_answer
      // composed from the existing analysis projection. Closes the
      // canonical misroute class where "How do you recommend we update
      // the decision based on this?" reaches edit_graph and surfaces
      // the no-op denial copy. The legitimate edit path is preserved by
      // the mutation-signal exclusion patterns inside the gate.
      if (routingResult === undefined) {
        const adviceOutcome = tryPostAnalysisAdviceGate({
          message: payload.message,
          analysis: contextPack.analysis,
          // P0 deterministic post-analysis router: pass the per-turn
          // analysis-ready payload so readiness / evidence_gap classes
          // can compose qualitative copy from the same projection
          // already computed earlier in the turn. The other classes
          // ignore it.
          analysisReady: analysisReadyForTurn,
          // Freshness guard: the gate ONLY short-circuits when the
          // cached projection still matches the live graph; the deterministic
          // "X is currently ahead" copy would otherwise mislead after an
          // edit. `freshness` is populated by the analysis-freshness
          // derivation earlier in the turn.
          freshness: freshness?.freshness,
          // V5 coaching: thread the latest successful run_analysis
          // fact's `decision_review` enrichment so `evidence_gap` can
          // answer validation/research questions grounded in
          // `evidence_enhancements` + `key_assumptions`. The helper
          // delegates to `selectRunAnalysisFact` — the SAME canonical
          // selector freshness/projection use — so every layer is
          // aligned on the same single fact (no stale pre-edit drift).
          // Returns null when no enrichment is available; the gate
          // falls back to its projection-only behaviour.
          decisionReview: pickLatestDecisionReview(context.prior_facts),
          // Raw robustness signals (`enrichment.robustness.level`,
          // `enrichment.robustness.near_tie.is_tie`) from the SAME fact
          // the freshness/projection layer selected. Lets the post-
          // analysis composer prefer the raw fragile/near-tie signal
          // over a canonicalised band that may have already been
          // coerced. Null when no run_analysis fact / no robustness
          // signal is available — composer falls back to margin_pp +
          // projected robustness_band.
          rawRobustness: pickLatestRawRobustness(context.prior_facts),
          // AI Harness capability 1 (CEE_POST_ANALYSIS_LOOP_ENABLED, default
          // OFF). Thread the already-derived canonical analysis state + the
          // recent-changes projection so the gate can compose a grounded
          // safe-now answer instead of falling through `data_unavailable_for_class`
          // to the slow generic LLM router when the thin projection is blank but
          // fresh, usable state exists. Flag OFF → both fields absent (undefined)
          // → the gate's relaxation branch is dead → behaviour byte-identical.
          // Mission 1 (context authority): sourced from the SHARED memoised
          // pre-dispatch canonical — the same object the chips, coaching pack
          // and finalise fallback read — replacing a separate partial
          // `canonicalStateFromFreshness` object.
          ...(config.cee.postAnalysisLoopEnabled && canonicalStateForNonExecute()
            ? {
                canonicalState: canonicalStateForNonExecute()!,
                recentChanges: contextPack.recent_changes,
              }
            : {}),
        });
        emit(TelemetryEvents.V5PostAnalysisAdviceGate, {
          request_id: requestId,
          scenario_id: context.session_id,
          matched: adviceOutcome.matched,
          unmatched_reason: adviceOutcome.matched ? null : adviceOutcome.reason,
          // P0 deterministic router: surface the class on matched OR
          // on `data_unavailable_for_class` fall-through so dashboards
          // see WHICH class is producing fall-throughs. Null otherwise.
          advice_class: adviceOutcome.matched
            ? adviceOutcome.advice_class
            : adviceOutcome.reason === 'data_unavailable_for_class'
              ? (adviceOutcome.advice_class ?? null)
              : null,
          missing_inputs:
            !adviceOutcome.matched
            && adviceOutcome.reason === 'data_unavailable_for_class'
              ? (adviceOutcome.missing_inputs ?? [])
              : null,
          leading_option_present: !!contextPack.analysis?.leading_option,
          // Read `top_driver_present` from the SAME analysis projection that
          // powers `leading_option_present` above — NOT from whether the
          // matched advice copy consumed a driver label. The previous
          // `adviceOutcome.matched ? top_driver_label !== null : false`
          // reported `false` on every non-match (and on matched classes that
          // don't need a driver) even when the projection carried drivers,
          // diverging from the projection state a dashboard expects. What the
          // matched copy actually used is still captured by `copy_source` /
          // `coaching_fields_used`.
          top_driver_present: hasRenderableTopDriverLabel(contextPack.analysis),
          // Structural-only count of chips threaded to the user (no
          // labels, no message strings). Dashboards can verify that
          // the per-class chip set (1 for explain/meaning/advice
          // classes, 0 for what_would_flip / readiness / evidence_gap)
          // matches the matched advice_class.
          suggested_action_count: adviceOutcome.matched
            ? adviceOutcome.suggested_actions.length
            : 0,
          // ── Copy-source delivery diagnostics (Scope C, additive) ────────
          // Structural-only: which source the copy drew from, which projected
          // analysis fields were available, and whether the by-design phase3
          // path was in effect. No labels, no values, no user prose.
          copy_source: adviceOutcome.matched ? adviceOutcome.copy_source : null,
          coaching_fields_used: adviceOutcome.matched
            ? adviceOutcome.coaching_fields_used
            : null,
          // phase3 block context availability at routing time — by-design
          // false when V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW is off. Pairs with
          // `matched` so a dashboard can prove structured copy was delivered
          // even when phase3 block context was unavailable.
          phase3_block_context_available:
            contextReadiness?.phase3_block_context_available ?? null,
          // True when the matched copy drew from the projected analysis
          // fallback rather than the decision_review enrichment.
          fallback_analysis_used: adviceOutcome.matched
            ? adviceOutcome.copy_source !== 'decision_review'
            : null,
          // The advice-gate path is always deterministic (llm_calls_used: 0).
          deterministic: adviceOutcome.matched ? true : null,
          // AI Harness capability 1 latency/grounding diagnostics (additive).
          // `loop_enabled` records the flag state per turn; `routing_path` marks
          // whether the grounded safe-now fallback fired (`canonical_rich`) vs
          // the existing projection-backed match vs an unmatched fall-through.
          // Lets dashboards compare llm_calls_used / fall-through rate ON vs OFF.
          loop_enabled: config.cee.postAnalysisLoopEnabled === true,
          routing_path: adviceOutcome.matched
            ? adviceOutcome.copy_source === 'canonical_rich'
              ? 'canonical_rich'
              : 'advice_gate_projection'
            : adviceOutcome.reason === 'data_unavailable_for_class'
              ? 'fallthrough_data_unavailable'
              : 'fallthrough_other',
        });
        if (adviceOutcome.matched) {
          const adviceResponse = composeDirectAnswerResponse({
            assistant_text: adviceOutcome.assistant_text,
            stage: context.stage,
            suggested_actions: [...adviceOutcome.suggested_actions],
          });
          sonnetTextForLog = adviceResponse.assistant_text;
          resolvedTurnClass = 'direct_answer';
          intentClass = 'converse';
          responseTypeForObs = 'direct_answer';
          llmCallsUsed = 0;
          stagesCompleted.push('orient');
          stagesCompleted.push('compose');
          // Scope C: capture copy-source delivery diagnostics for the
          // flag-gated diagnostic trace. Structural-only; surfaced on the
          // run result, never on the wire body. Deterministic path → no LLM.
          coachingDelivery = {
            handler: 'post_analysis_advice_gate',
            composer: adviceOutcome.advice_class,
            copy_source: adviceOutcome.copy_source,
            coaching_fields_used: adviceOutcome.coaching_fields_used,
            phase3_block_context_available:
              contextReadiness?.phase3_block_context_available ?? false,
            fallback_analysis_used: adviceOutcome.copy_source !== 'decision_review',
            deterministic: true,
          };
          // V5 P0 proposal-memory continuation — emit-time capture at
          // the advice-gate commit. `composeEvidenceGap` can surface
          // decision_review.evidence_enhancements[].specific_action
          // strings verbatim; if a specific_action is shaped like
          // "add team morale as a factor" the user sees a proposal
          // that the next-turn no-op recovery should be able to resume.
          // The helper is a no-op when no proposal pattern matches.
          // Lane 22 (live 2026-07-07): both live proposal captures
          // persisted with EMPTY preconditions because this hash was
          // computed from the RAW request `options.graphState`, which is
          // absent on follow-up turns — the hash helper returns null for
          // a missing graph and the pending action then carries no
          // graph_hash, making hash-divergence invalidation inert. Use
          // `graphStateForTurn` instead: the same authoritative graph
          // this turn reasoned over (request graphState when present,
          // else the persisted-graph fallback loaded by
          // buildTurnContext).
          const adviceGraphHash = (() => {
            try {
              return (
                computeAnalysisAffectingGraphHash(
                  (graphStateForTurn as GraphStateIngress | null | undefined) ?? undefined,
                ) ?? null
              );
            } catch {
              return null;
            }
          })();
          const advicePending = buildPendingActionsWithProposalCapture({
            assistantText: adviceResponse.assistant_text,
            chips: adviceResponse.suggested_actions ?? [],
            scenarioId: context.session_id,
            graphHash: adviceGraphHash,
            requestId,
            originPath: 'advice_gate',
          });
          try {
            const committed = await commitTurn(adviceResponse, {
              scenario_id: context.session_id,
              turn_id: context.request_id,
              turn_class: 'direct_answer',
              handler_id: null,
              request_hash: computeRequestHash(payload),
              llm_calls_used: 0,
              duration_ms: Date.now() - startedAt,
              handler_facts: [],
              ...(advicePending !== undefined ? { pending_actions: advicePending } : {}),
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
                path: 'post_analysis_advice_gate',
                err: serialiseError(error),
              },
              'V5 TurnExecutor commit failure on post-analysis advice gate',
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

      // V5 fresh-analysis follow-up guard — catch-net AFTER
      // `tryPostAnalysisAdviceGate`. The advice gate keeps first refusal
      // and produces its richer synthesis whenever its per-class data
      // requirements hold. After the grounded-fresh-analysis workstream
      // broadened the advice gate's pattern set to own the brief's
      // canonical phrasings ("what drove", "why is X ahead/leading/...",
      // "what would need to change..."), this guard's primary role is
      // the `data_unavailable_for_class` fall-through plus any residual
      // classifier-only phrasing the advice gate's stricter per-class
      // patterns do not cover. It still intercepts cases that would
      // otherwise reach the LLM router (~11s) and misroute to
      // `edit_graph`.
      //
      // Matched response is a deterministic direct_answer that points
      // at the analysis surface and offers an existing chip
      // (`action_type: 'explain_results'` or `'what_would_flip'`). The
      // chip, when clicked, dispatches the real explanation handler via
      // `dispatchDeterministicChipClick` with no LLM call. The fresh
      // path of `tryPostAnalysisAdviceGate` is NOT modified — PR #184
      // preserved it bit-for-bit and this guard preserves that
      // guarantee.
      if (routingResult === undefined && contextReadiness !== null) {
        const freshFollowupOutcome = tryFreshAnalysisFollowupGuard({
          message: payload.message,
          readiness: contextReadiness,
        });
        emit(TelemetryEvents.V5FreshAnalysisFollowupGuard, {
          request_id: requestId,
          scenario_id: context.session_id,
          matched: freshFollowupOutcome.matched,
          unmatched_reason: freshFollowupOutcome.matched
            ? null
            : freshFollowupOutcome.reason,
          intent_class: freshFollowupOutcome.matched
            ? freshFollowupOutcome.intent_class
            : null,
          analysis_freshness: contextReadiness.latest_analysis_freshness,
          selected_path: freshFollowupOutcome.matched
            ? 'fresh_analysis_followup'
            : null,
          selected_action_type: freshFollowupOutcome.matched
            ? freshFollowupOutcome.selected_action_type
            : null,
        });
        if (freshFollowupOutcome.matched) {
          const freshFollowupResponse = composeDirectAnswerResponse({
            assistant_text: freshFollowupOutcome.assistant_text,
            stage: context.stage,
            suggested_actions: [...freshFollowupOutcome.suggested_actions],
          });
          sonnetTextForLog = freshFollowupResponse.assistant_text;
          resolvedTurnClass = 'direct_answer';
          intentClass = 'converse';
          responseTypeForObs = 'direct_answer';
          llmCallsUsed = 0;
          stagesCompleted.push('orient');
          stagesCompleted.push('compose');
          try {
            const committed = await commitTurn(freshFollowupResponse, {
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
                path: 'fresh_analysis_followup_guard',
                err: serialiseError(error),
              },
              'V5 TurnExecutor commit failure on fresh-analysis follow-up guard',
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

      // V5 Context Management v1 — no-analysis sibling guard.
      //
      // Fires when no successful run_analysis fact exists for the
      // scenario AND the user is asking an analytical question AND
      // there is no concrete mutation signal. Routes to a calm direct
      // answer that nudges the user to run analysis first. Closes the
      // misroute class where "walk me through the analysis" lands on
      // edit_graph and produces a no-op denial because Sonnet has
      // nothing analytical to ground a reply.
      //
      // Reuses the readiness snapshot emitted earlier in the turn so
      // the predicate is a single field read, not a re-derivation.
      if (routingResult === undefined && contextReadiness !== null) {
        const noAnalysisOutcome = tryNoAnalysisGuard({
          message: payload.message,
          readiness: contextReadiness,
        });
        emit(TelemetryEvents.V5NoAnalysisGuard, {
          request_id: requestId,
          scenario_id: context.session_id,
          matched: noAnalysisOutcome.matched,
          unmatched_reason: noAnalysisOutcome.matched
            ? null
            : noAnalysisOutcome.reason,
          intent_class: noAnalysisOutcome.matched
            ? noAnalysisOutcome.intent_class
            : null,
          graph_ready: noAnalysisOutcome.matched
            ? noAnalysisOutcome.graph_ready
            : null,
        });
        if (noAnalysisOutcome.matched) {
          const noAnalysisResponse = composeDirectAnswerResponse({
            assistant_text: noAnalysisOutcome.assistant_text,
            stage: context.stage,
            suggested_actions: [...noAnalysisOutcome.suggested_actions],
          });
          sonnetTextForLog = noAnalysisResponse.assistant_text;
          resolvedTurnClass = 'direct_answer';
          intentClass = 'converse';
          responseTypeForObs = 'direct_answer';
          llmCallsUsed = 0;
          stagesCompleted.push('orient');
          stagesCompleted.push('compose');
          try {
            const committed = await commitTurn(noAnalysisResponse, {
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
                path: 'no_analysis_guard',
                err: serialiseError(error),
              },
              'V5 TurnExecutor commit failure on no-analysis guard',
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
        const routingStartedAt = timingsEnabled ? Date.now() : 0;
        routingResult = await routeWithToolUse(contextPack, payload.message, {
          requestId,
          sessionId: context.session_id,
          signal: turnAbort.signal,
          adapter: options.routingAdapter,
        });
        // ROADMAP 1.42 — stash VERBATIM reasoning immediately after the real
        // LLM call. Undefined when the flag was off or no thinking blocks
        // were emitted (see ChatWithToolsResult.reasoning jsdoc).
        capturedReasoning = routingResult.rawResult?.reasoning;
        if (timingsEnabled) {
          turnTimings.routing_llm_ms = Date.now() - routingStartedAt;
          // Fix 4: mirror routing cache state from rawResult.usage so the
          // harness can read it from the response envelope without a log
          // join. cache_hit semantics match emitV5PromptCache: read>0 → hit,
          // read===0 → miss, usage missing → unknown. The routing module
          // emits its own v5.prompt_cache event for canonical dashboards.
          try {
            const usage = routingResult.rawResult?.usage as
              | {
                  cache_read_input_tokens?: number;
                  cache_creation_input_tokens?: number;
                  input_tokens?: number;
                }
              | undefined;
            const cacheRead = usage?.cache_read_input_tokens;
            const cacheCreate = usage?.cache_creation_input_tokens;
            const inputTokens = usage?.input_tokens;
            if (typeof cacheRead === 'number') {
              turnTimings.routing_cache = cacheRead > 0 ? 'hit' : 'miss';
              turnTimings.cache_read_input_tokens = cacheRead;
            } else {
              turnTimings.routing_cache = 'unknown';
            }
            if (typeof cacheCreate === 'number') {
              turnTimings.cache_creation_input_tokens = cacheCreate;
            }
            if (typeof inputTokens === 'number') {
              turnTimings.total_input_tokens = inputTokens;
            }
          } catch {
            turnTimings.routing_cache = 'unknown';
          }
        }
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
        return await translateRoutingError(error);
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

    // Fix 4 review fix (round 3): anchor compose_ms here so non-handler
    // compose branches (text_only / coach / clarify / execute-fallback)
    // also have a value. For the handler branch, the value gets
    // overwritten after `await handlerFn(...)` returns so compose_ms only
    // covers the work AFTER the handler completes. Gated by timingsEnabled.
    if (timingsEnabled) composeStartedAt = Date.now();

    // Buckets for the remaining steps. Populated conditionally per intent.
    let handlerOutcome: HandlerOutcome | null = null;
    let handlerIdForCommit: V5ActionType | null = null;
    let handlerFactsForCommit: readonly HandlerFact[] = [];
    let composedOk: OlumiResponse | null = null;
    // V5 P0.2 — a flip-threshold proposal's pending action, emitted on a
    // what_would_flip turn and merged into the committed pending_actions.
    let flipProposalPending: PendingAction | undefined;

    // ==================================================================
    // STEPS 2–4: execute-intent path (VALIDATE → EXECUTE → CONFIRM)
    // ==================================================================
    if (routingResult.type === 'tool_call' && routingResult.proposal.intent_class === 'execute') {
      let action = routingResult.proposal.action;
      const proposedHandlerId = action.handler_id as V5ActionType;
      resolutionStatus = action.entity.resolution_status;
      proposedHandlerIdForLog = action.handler_id;
      proposedHandlerIdForOutcome = action.handler_id;

      // Lane CEE-D (edit-loop reliability) — relative-delta resolution for
      // set_factor_value, BEFORE validateToolCall so the validator, the
      // P0-A value/unit containment, and the handler all see the same
      // resolved absolute proposal. Live trace request_id baca4f1c:
      // "increase it slightly by 5%" → structured percent delta on a £
      // factor → unit_mismatch → PARAMETER_INVALID → recovered template,
      // while an absolute set succeeded in the same session (91a45b0a).
      // The resolver rewrites an unambiguous relative percent expression
      // (structured '%' with increase/decrease, or a "+5%"/"-10%" string)
      // into an absolute `set` against the factor's CURRENT value. When
      // the current value is unavailable/ambiguous — or the factor itself
      // is a % factor (pp semantics already work) — it declines and the
      // proposal flows through today's clarify/recovery path unchanged
      // (never guess). Every downstream guard still runs against the
      // resolved value (cap range, finiteness, unit match).
      let relativeDeltaResolved = false;
      if (proposedHandlerId === 'set_factor_value') {
        const relOutcome = resolveRelativeFactorDelta(action, graphLookupForValidate);
        if (relOutcome.resolved) {
          relativeDeltaResolved = true;
          action = relOutcome.action;
          emit(TelemetryEvents.V5RelativeDeltaResolved, {
            request_id: requestId,
            scenario_id: context.session_id,
            handler_id: 'set_factor_value',
            target_id: relOutcome.telemetry.target_id,
            direction: relOutcome.telemetry.direction,
            source_shape: relOutcome.telemetry.source_shape,
            value_unit_guard_skipped: true,
          });
        }
      }

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
      let validationResult = validateToolCall(
        action,
        graphLookupForValidate,
        validationRegistry,
      );

      // V5 edit_graph P0 containment (task_99f83f0d) — option-intervention
      // misroute guard. A request that implies editing an OPTION's
      // intervention ("revise the Outsource option's Annual Support Cost
      // intervention to £135k") can be proposed — by the LLM router, or in
      // principle synthesised by the deterministic pre-route — as a
      // `set_factor_value` on the SHARED factor. The proposal validates (the
      // factor is a real, correctly-kinded target), so without this guard it
      // would silently mutate the factor's own value: the wrong entity, and
      // unrecoverable from the user's point of view. Both the LLM and
      // deterministic producers converge on this execute block BEFORE any
      // handler runs, so one guard here covers every dispatch path.
      // `set_factor_value` stays a legitimate handler for genuine factor
      // edits — we refuse ONLY this case, re-using the existing recoverable-
      // validator path so the turn composes a clarify and commits a
      // direct_answer with the graph UNCHANGED (no handler executes).
      if (
        validationResult.valid &&
        proposedHandlerId === 'set_factor_value' &&
        impliesOptionInterventionEdit(
          userMessageForTurn ?? '',
          graphLookupForValidate
            ? graphLookupForValidate
                .listEntitiesByKind('option')
                .map((entity) => entity.label)
                .filter((label): label is string =>
                  typeof label === 'string' && label.trim().length > 0,
                )
            : [],
        )
      ) {
        validationResult = {
          valid: false,
          error: {
            code: 'OPTION_INTERVENTION_MISROUTE',
            message:
              'set_factor_value refused — the request implies an option-specific intervention edit, not a factor-value change',
            details: {
              handler_id: 'set_factor_value',
              ...(action.entity.label ? { factor_label: action.entity.label } : {}),
            },
          },
        };
      }

      // P0-A value/unit fail-closed containment. A set_factor_value request can
      // express the value with a unit the upstream pipeline silently DROPS
      // ("Set Incremental Hiring Cost to 5 agents" → CQE does not recognise
      // "agents", so the proposal carries a bare 5 that sits inside the £
      // factor's cap and every existing guard passes — the factor became £5).
      // The `unit_mismatch` predicate cannot catch this because the dropped
      // unit never reaches it, and a bare number against a typed factor is a
      // legitimate "reuse the existing unit" case the predicate must keep
      // accepting. So we inspect the RAW user message here — the only place the
      // dropped token survives — and fail closed when the value's unit token
      // belongs to a different family than the factor's stored unit. Placed
      // AFTER the misroute guard: both short-circuit on `validationResult.valid`
      // so an option-intervention edit stays classified as misroute. Refuses
      // ONLY the unresolvable case; clean numeric / matching-unit / untyped-
      // factor edits are untouched. Reuses the recoverable-validator path
      // (clarify, direct_answer, graph unchanged, no handler executes).
      // Lane CEE-D: the P0-A raw-message check is SKIPPED when the
      // relative-delta resolver rewrote this proposal. The guard exists to
      // catch unit tokens the pipeline silently DROPPED; here the '%'
      // token in the message was deliberately CONSUMED by the resolution
      // (grounded against the factor's current value), so comparing the
      // message's percent family against the factor's unit family would
      // falsely refuse the resolved absolute proposal. The skip is
      // recorded on the v5.turn_executor.relative_delta_resolved event
      // (value_unit_guard_skipped: true).
      if (
        validationResult.valid &&
        proposedHandlerId === 'set_factor_value' &&
        !relativeDeltaResolved &&
        graphLookupForValidate?.findFactorObservedState !== undefined
      ) {
        const factorObs = graphLookupForValidate.findFactorObservedState(action.entity.id);
        // Bind the check to the value the handler would apply (not just the last
        // number in the message), so a compound turn is judged on this factor's
        // own value. The value parameter is a bare number or { value, unit?, cap? }.
        const valueParam = action.parameters.find((p) => p.name === 'value');
        const rawValueParam = valueParam?.value;
        const proposedValue =
          typeof rawValueParam === 'number'
            ? rawValueParam
            : rawValueParam !== null &&
                typeof rawValueParam === 'object' &&
                typeof (rawValueParam as { value?: unknown }).value === 'number'
              ? (rawValueParam as { value: number }).value
              : undefined;
        const verdict = classifyValueUnitAgainstFactor(
          userMessageForTurn ?? '',
          factorObs?.unit,
          proposedValue,
        );
        if (!verdict.resolved) {
          validationResult = {
            valid: false,
            error: {
              code: 'VALUE_UNIT_UNRESOLVED',
              message:
                'set_factor_value refused — the value\'s unit could not be resolved against the target factor',
              details: {
                handler_id: 'set_factor_value',
                rejection_reason: verdict.reason,
                ...(verdict.user_unit_family ? { user_unit_family: verdict.user_unit_family } : {}),
                factor_unit_family: verdict.factor_unit_family,
                ...(action.entity.label ? { factor_label: action.entity.label } : {}),
              },
            },
          };
        }
      }
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
            // P1.1 follow-up — `outcome` discriminator. Impossible-state
            // safety net composes a fatal envelope (INTERNAL_ERROR block,
            // 500); record as fatal so dashboards joining on this field
            // don't conflate it with the recoverable Phase 2.2 path.
            outcome: 'fatal',
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
          // P1.1 follow-up — `outcome: 'recovered'` for the validator
          // Phase 2.2 clean-body 200 path. Pairs with the
          // `v5.recovery_response` lifecycle event for queries that
          // want a single-event recovery filter.
          outcome: 'recovered',
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

        // 1.16 item A2 — the value_exceeds_cap recovery may carry the
        // user-consented "extend the scale" chip. The chip itself cannot
        // carry the structured {value, unit, cap} (the boundary Action is
        // strict), so persist the matching set_factor_value pending action
        // alongside the recovery turn; the chip's replay is claimed by the
        // clarification-resume pre-route, which synthesises the proposal
        // from this pending — cap included. Fail-closed inside the builder
        // (chip absent / details incomplete / no live graph hash → []).
        const rescalePendingActions = buildRescaleCapPendingActions({
          error: validationResult.error,
          response: recoveredResponse,
          scenarioId: context.session_id,
          currentGraphHash: freshness?.current_graph_hash,
        });

        // Commit as a direct_answer so route-v2 sees commit_performed=true
        // and returns 200. Commit failure on a recoverable path is still
        // fatal — BUT the original recoverable outcome is logged
        // separately from the commit failure so infrastructure issues
        // are not hidden behind resilience (correction 10 / Part B of
        // the resilience contract).
        try {
          const committed = await commitTurn(response, {
            scenario_id: context.session_id,
            turn_id: context.request_id,
            turn_class: 'direct_answer',
            handler_id: null,
            request_hash: computeRequestHash(payload),
            llm_calls_used: llmCallsUsed,
            duration_ms: Date.now() - startedAt,
            handler_facts: [],
            ...(rescalePendingActions.length > 0
              ? { pending_actions: rescalePendingActions }
              : {}),
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
            // FIX 1 (CEE hygiene batch): auditability for
            // forbidden_internal_term verdicts — WHAT was flagged, not
            // just length + error code. Term-only, never an excerpt (see
            // `forbidden_term_matched` docstring on the verdict payload
            // for the PII-safety reasoning); null for every other reason.
            forbidden_term_matched: verdict.payload.forbidden_term_matched ?? null,
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

      // P0b-2: the routed `what_would_flip` deterministic fallback must not name
      // an option-pinned lever as "the clearest one to test". The chip-click path
      // already filters its flip evidence (chip-click-dispatch.ts →
      // filterFlipSummaryEntries); the routed path threaded the RAW summary.
      // Suppress option-controlled levers here with the SAME helper, off the RAW
      // graph (never the GraphV3-parsed graph, which strips
      // `node.data.interventions` / top-level `options[]`).
      //
      // Authority = `context.persistedGraph ?? options.graphState`
      // (CANONICAL-first, request graph only as a cold-start fallback) — the SAME
      // authority as the ContextPack driver suppression above (so the whole
      // routed fallback response, top-driver sentence AND flip sentence, uses one
      // canonical graph) and as the freshness / option-identity guards under
      // client lag (`currentAnalysisGraphHashForTurn` derives from
      // `context.persistedGraph`, "NOT the request-supplied graphStateForTurn").
      // A request-FIRST authority would read an empty controlled set from a stale
      // request graph while the analysis stays anchored to the canonical persisted
      // graph, leaking the pinned lever (P0b-2). (The sibling run-comparison gate
      // expression uses this same persisted-first authority — see its call site.)
      // filterFlipSummaryEntries is a no-op when the controlled
      // set is empty or no entry is pinned, and re-summarises kept entries so
      // `overall_status` stays honest (a dropped sole-concrete entry demotes).
      const routedFlipSummary =
        isExplanationHandler && analysisStateSource !== 'request'
          ? pickLatestFlipSummary(context.prior_facts)
          : undefined;
      const routedFlipSummaryFiltered =
        routedFlipSummary != null
          ? filterFlipSummaryEntries(
              routedFlipSummary,
              collectInterventionControlledFactorIds(
                context.persistedGraph ?? options.graphState,
              ),
            )
          : routedFlipSummary;

      try {
        const registry = options.handlerRegistry ?? getDefaultRegistry();
        const handlerFn = resolveHandler(registry, proposedHandlerId);
        if (!handlerFn) {
          throw new UnhandledTurnClassError('handler_not_registered', proposedHandlerId);
        }
        const handlerStartedAt = timingsEnabled ? Date.now() : 0;
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
          // V5 P0-B (Codex review): thread the SAME robustness + flip evidence
          // the chip-click path threads, so the routed what_would_flip
          // deterministic fallback (used when Sonnet's answer_text is unusable)
          // is just as honest — it must not reintroduce the "small adjustments
          // could shift which option leads" contradiction on a no-practical-flip
          // result.
          //
          // SAME-SOURCE GUARANTEE (Codex review #2): `analysisProjection` is
          // built from `contextPackForLog.analysis`, which on the request path
          // (`analysisStateSource === 'request'`) comes from the body-supplied
          // analysis_state, NOT prior facts. The prior-fact flip / robustness
          // evidence could then describe a DIFFERENT run. So we only pair
          // prior-fact evidence with a prior-fact-built projection; when the
          // projection is request-sourced we withhold it and the composer falls
          // back to the request projection's own band (consistent, no mix).
          rawRobustness: isExplanationHandler && analysisStateSource !== 'request'
            ? pickLatestRawRobustness(context.prior_facts)
            : undefined,
          flipSummary: routedFlipSummaryFiltered,
        });
        if (timingsEnabled) {
          turnTimings.handler_execute_ms = Date.now() - handlerStartedAt;
          turnTimings.handler_id = proposedHandlerId;
          // Fix 4: handlers may opt into surfacing their internal timings
          // (run_analysis exposes PLoT request time) via the typed
          // `__plot_timings` property on the outcome. The executor copies
          // it to runAnalysisTimings for the response envelope; absent on
          // handlers that don't make outbound calls (mutators, explainers).
          if (handlerOutcome.__plot_timings) {
            runAnalysisTimings = handlerOutcome.__plot_timings;
          }
          // Compose step starts at handler return — see the matching delta
          // captured just before commitDirectAnswer in STEP 7.
          composeStartedAt = Date.now();
        }
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
        // V5-LANE-B-STRUCTURAL-01: mirror the explain_results validation-
        // beat mechanism record to telemetry so live smoke can assert
        // appended / dedup_skipped / omitted (and the evidence matched)
        // rather than only inspecting the surface text. Label fields follow
        // the V5ExplanationEvidence precedent — observability-only, never
        // persisted on the fact (generated schema is .strict(); persisted
        // field is a @talchain/schemas follow-up behind V5-CI-01).
        if (handlerOutcome.__validation_beat) {
          const beat = handlerOutcome.__validation_beat;
          emit(TelemetryEvents.V5ExplanationValidationBeat, {
            request_id: requestId,
            scenario_id: context.session_id,
            handler_id: proposedHandlerId,
            mechanism: beat.mechanism,
            variant:
              beat.mechanism === 'appended'
                ? beat.beat.variant
                : beat.mechanism === 'dedup_skipped'
                  ? beat.variant
                  : null,
            from_label:
              beat.mechanism === 'appended' && beat.beat.variant === 'link'
                ? beat.beat.from_label
                : beat.mechanism === 'dedup_skipped'
                  ? beat.from_label ?? null
                  : null,
            to_label:
              beat.mechanism === 'appended' && beat.beat.variant === 'link'
                ? beat.beat.to_label
                : beat.mechanism === 'dedup_skipped'
                  ? beat.to_label ?? null
                  : null,
            driver_label:
              beat.mechanism === 'appended' && beat.beat.variant === 'driver'
                ? beat.beat.driver_label
                : beat.mechanism === 'dedup_skipped'
                  ? beat.driver_label ?? null
                  : null,
            omission_reason: beat.mechanism === 'omitted' ? beat.reason : null,
          });
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
        // Fix 4 review fix (round 4): rebuild RunAnalysisTimings from
        // error.details on PLoT-failure paths so the recovery / fatal
        // wire response carries `_timings.run_analysis` shape-symmetric
        // with the success path. The run_analysis handler attaches
        // `plot_request_ms`, `handler_total_ms`, and `plot_slow_likely`
        // to HandlerInvocationFailedError.details on every failing exit
        // (all gated by the same flag), so default-OFF production runs
        // leave the fields absent and this whole block is a no-op.
        if (
          timingsEnabled &&
          proposedHandlerId === 'run_analysis' &&
          error instanceof HandlerInvocationFailedError
        ) {
          const details = error.details as
            | {
                plot_request_ms?: unknown;
                handler_total_ms?: unknown;
                plot_slow_likely?: unknown;
                analysis_status?: unknown;
              }
            | undefined;
          const reqMs = typeof details?.plot_request_ms === 'number'
            ? details.plot_request_ms
            : undefined;
          // Handler-only wall clock from the handler's own timer; falls
          // back to the executor's turn-relative anchor only when the
          // handler couldn't compute it (defensive — should not happen on
          // run_analysis exits but keeps the field always populated).
          const totalMs = typeof details?.handler_total_ms === 'number'
            ? details.handler_total_ms
            : Date.now() - startedAt;
          const slowLikely = typeof details?.plot_slow_likely === 'boolean'
            ? details.plot_slow_likely
            : reqMs === undefined
              ? null
              : reqMs >= PLOT_SLOW_LIKELY_MS;
          const status = typeof details?.analysis_status === 'string'
            ? details.analysis_status
            : null;
          runAnalysisTimings = {
            handler_total_ms: totalMs,
            ...(reqMs !== undefined ? { plot_request_ms: reqMs } : {}),
            plot_status: status,
            plot_slow_likely: slowLikely,
          };
        }
        // P1.1 follow-up — budget precedence (Paul's constraint 7) for the
        // recoverable handler path. If the outer turn budget has fired
        // AND the error is a recoverable HandlerInvocationFailedError,
        // route to translateExecuteError BEFORE the v5.handler_invocation
        // emit below — so a budget-aborted recoverable turn produces NO
        // observable side effect on the recovery telemetry trail
        // (no v5.handler_invocation{outcome:'error'},
        // no v5.recovery_response,
        // no turn_executor.failure_response{outcome:'recovered'},
        // no commit/append). BUDGET_EXCEEDED wins.
        //
        // Fatal cause-kinds still emit the handler_invocation telemetry
        // because their fatal-path classification (and infrastructure
        // diagnostics) genuinely benefits from the cause_kind record.
        // The budget check inside translateExecuteError still classifies
        // them as BUDGET_EXCEEDED on the wire.
        if (
          turnAbort.signal.aborted &&
          error instanceof HandlerInvocationFailedError &&
          isRecoverableHandlerCause(error.cause_kind)
        ) {
          return translateExecuteError(error);
        }

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

        // V5 alpha hardening Phase 2.6 — handler-recoverable 200 path.
        // Locked recoverable causes (RECOVERABLE_HANDLER_CAUSES) compose
        // a clean direct_answer 200 with coaching text + chip, mirroring
        // the Phase 2.2 validator-recoverable pattern. Everything else
        // (commit/PLoT/scenario/contract-mismatch/handler-result-invalid)
        // falls through to translateExecuteError → 500. See
        // Docs/v5/v5-p1-1-handler-failure-scope.md and
        // src/orchestrator-v5/compose/recoverable-handler-causes.ts.
        if (
          error instanceof HandlerInvocationFailedError &&
          isRecoverableHandlerCause(error.cause_kind)
        ) {
          log.warn(
            {
              request_id: requestId,
              kind: error.kind,
              cause_kind: error.cause_kind,
              retryable: error.retryable,
              handler_id: proposedHandlerId,
              recoverable: true,
            },
            'V5 TurnExecutor handler invocation failed — recoverable',
          );

          const recoveryComposeCtx: ComposeContext = {
            graph: graphLookupForValidate,
            handlerRegistry: options.validationRegistry ?? HANDLER_VALIDATION_REGISTRY,
          };
          const recovered = composeRecoverableHandlerResponse(
            error,
            recoveryComposeCtx,
            context.stage,
          );

          // Impossible-state guard — mirrors the validator-recoverable
          // safety net. If the per-cause switch hits the `default`
          // (template_id === 'fallback'), the cause-kind is on the
          // recoverable list but the composer has no branch — that is
          // a code bug, not a runtime fault. Fail loudly via the
          // existing fatal path so the gap surfaces in deploys.
          if (recovered.template_id === 'fallback') {
            log.error(
              {
                event: 'assert_recoverable_handler_fallback',
                request_id: requestId,
                cause_kind: error.cause_kind,
              },
              'V5 TurnExecutor hit recoverable composer fallback — cause-kind on recoverable list but no template; returning 500',
            );
            return translateExecuteError(error);
          }

          response = recovered.response;
          resolvedTurnClass = 'direct_answer';
          intentClass = 'converse';
          responseTypeForObs = 'direct_answer';
          stagesCompleted.push('handler_recovery');

          emit(TelemetryEvents.TurnExecutorFailureResponse, {
            request_id: requestId,
            session_id: context.session_id,
            stage: context.stage,
            failure_origin: 'handler',
            // P1.1 follow-up — `outcome: 'recovered'` for the handler
            // Phase 2.6 clean-body 200 path. The legacy `recoverable: true`
            // boolean is retained for one release as a deprecation
            // grace period; `outcome` is the canonical discriminator.
            outcome: 'recovered',
            error_code: error.cause_kind,
            template_used: recovered.template_id,
            chip_attached: recovered.response.suggested_actions.length > 0,
            chip_type: recovered.chip_type,
            chip_count: recovered.response.suggested_actions.length,
            retryable: error.retryable,
            recoverable: true,
          });
          // V5 alpha hardening Phase 2.5: primary lifecycle event for
          // recovered handler outcomes. Mirrors the validator-recovery
          // emit so a single query (`v5.recovery_response`) finds every
          // recovery across both layers.
          emit(
            TelemetryEvents.RecoveryResponse,
            obsPayload({
              failure_origin: 'handler',
              handler_cause_kind: error.cause_kind,
              template_used: recovered.template_id,
              chip_type: recovered.chip_type,
              chip_count: recovered.response.suggested_actions.length,
              retryable: error.retryable,
            }),
          );

          // Commit as a direct_answer so route-v2 sees commit_performed
          // and returns 200. Commit failure on the recoverable path is
          // still fatal, but the original recoverable outcome and the
          // commit failure are logged as two distinct records so
          // infrastructure issues are not hidden behind resilience.
          try {
            const committed = await commitTurn(response, {
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
          } catch (commitError) {
            log.warn(
              {
                event: 'v5.recoverable_outcome_pre_commit_failure',
                request_id: requestId,
                session_id: context.session_id,
                failure_origin: 'handler',
                handler_cause_kind: error.cause_kind,
                template_used: recovered.template_id,
              },
              'V5 TurnExecutor recoverable handler outcome before commit failure',
            );
            log.error(
              {
                event: 'v5.state_commit_failed',
                request_id: requestId,
                session_id: context.session_id,
                failure_origin: 'handler',
                handler_cause_kind: error.cause_kind,
                err: serialiseError(commitError),
              },
              'V5 TurnExecutor commit failure on recoverable handler path',
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
      //
      // Latency gate (V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW): when this
      // flag is false (the default), the auto-fire is short-circuited
      // and `run_analysis` returns the deterministic PLoT analysis
      // without waiting on the enrichment LLM call. The persisted
      // analysis fact is unchanged; `enrichment.decision_review` is
      // simply absent, the same shape consumers already see on the
      // legitimate timeout-degrade path. A `v5.decision_review.skipped`
      // event with reason `autofire_disabled` records the skip.
      if (proposedHandlerId === 'run_analysis') {
        // V5 Phase 1 brief persistence: prefer the canonical-state value
        // from buildTurnContext (`scenarios.brief_text`). Fall back to
        // the legacy out-of-band `options.scenarioBrief` for one release.
        const legacyFallbackInUse =
          context.scenarioBriefText === null
          && options.scenarioBrief != null
          && options.scenarioBrief.length > 0;
        const resolvedBrief: string | null = legacyFallbackInUse
          ? (options.scenarioBrief ?? null)
          : context.scenarioBriefText;

        if (!config.cee.runAnalysisAwaitDecisionReview) {
          const briefLength = typeof resolvedBrief === 'string' ? resolvedBrief.length : 0;
          const runAnalysisFact = handlerOutcome.handler_facts.find(
            (f) => f.fact_type === 'run_analysis',
          );
          const enrichment =
            runAnalysisFact && runAnalysisFact.fact_type === 'run_analysis'
              ? runAnalysisFact.result.enrichment
              : undefined;
          const leadingOptionPresent =
            runAnalysisFact !== undefined
            && runAnalysisFact.fact_type === 'run_analysis'
            && typeof runAnalysisFact.result.leading_option_id === 'string'
            && runAnalysisFact.result.leading_option_id.length > 0;
          emit(TelemetryEvents.V5DecisionReviewSkipped, {
            request_id: requestId,
            scenario_id: context.session_id,
            reason: 'autofire_disabled',
            brief_present: briefLength > 0,
            brief_length: briefLength,
            has_enrichment: enrichment !== undefined,
            leading_option_present: leadingOptionPresent,
          });
        } else {
          if (legacyFallbackInUse) {
            log.warn(
              {
                request_id: requestId,
                scenario_id: context.session_id,
                source: 'options.scenarioBrief',
              },
              'V5 decision_review: legacy options.scenarioBrief used as fallback. ' +
                'This channel is deprecated and will be removed in Phase 2.',
            );
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
        // M5 readiness authority: on a mutation the freshness hash reflects the
        // post-mutation graph, so canonical readiness must too. Use the handler's
        // GraphV3 `mutated` projection (computeStructuralReadiness derives option
        // count / goal presence from nodes-by-kind, so the GraphV3 shape is the
        // right input — `merged` only restores the ingress shape for hashing).
        canonicalReadinessGraphForRun = mutated;
        return computeAnalysisAffectingGraphHash(
          merged as GraphStateIngress | null | undefined,
        );
      })();
      // Option-identity guard inputs (CEE_OPTION_IDENTITY_FRESHNESS_GUARD).
      // Options are not altered by value mutations, and a structural option
      // edit already diverges the hash (→ stale by hash), so reading from the
      // raw current graph — persisted when present, else the request graph —
      // is the correct, conservative source. `undefined` when the flag is off.
      const currentGraphOptionIdsForPostHandler: readonly string[] | null | undefined =
        config.cee.optionIdentityFreshnessGuard
          ? extractGraphOptionIds(context.persistedGraph ?? graphStateForTurn ?? null)
          : undefined;
      freshness = deriveAnalysisFreshness(
        [...handlerFactsForCommit, ...context.prior_facts],
        hashForPostHandlerFreshness,
        currentGraphOptionIdsForPostHandler,
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
      // V5 M5 → Mission 1 (context authority) — assemble the canonical
      // analysis state from the SAME unified fact set and post-handler graph
      // hash that `freshness` above derived from. Pure read-only: no dispatch,
      // no mutation, no I/O. Surfaced through the flag-gated redacted
      // context-summary diagnostic at the route seam AND (Mission 1) threaded
      // to `generateChips` below, so execute-path chips read the composed
      // verdict — same freshness derivation as `turnOutcome`, plus the
      // contradiction-aware `requiresRerun`/usability predicates — instead of
      // re-deriving from local fact scans. (The earlier "deliberately NOT
      // passed to generateChips" deferral was the M5 read-only slice; Mission 1
      // is the deliberate activation, with the chip-generator's canonical
      // branches already covered by chip-generator-canonical-convergence
      // tests.)
      //
      // Graph-authority consistency: readiness here is derived from
      // `canonicalReadinessGraphForRun` — the SAME graph the freshness hash was
      // computed from — NOT the request-derived `analysisReadyForTurn`. Under
      // client lag the freshness hash comes from the canonical PERSISTED graph
      // (H3 stale-aware logic) while the request graph can be older; pairing
      // that hash with request-derived readiness could report e.g. `ready`
      // against a persisted graph that now needs mapping. Deriving readiness
      // from the same authority keeps the diagnostic internally consistent.
      // `undefined` when there is no parseable authority (persisted graph
      // unrecoverable / unparseable, or no graph) → canonical status null, never
      // a false `ready`. `analysisReadyForTurn` is left unchanged HERE — the
      // pre-mutation value still drives this turn's chips — but on a committed
      // D1 mutation the WIRE value is re-projected onto the committed graph at
      // the STEP 7 post-commit block (F3), so `analysis_ready` never pairs a
      // post-mutation `current_graph_hash` with pre-mutation interventions.
      // Readiness from the same authority as the freshness hash (see
      // deriveCanonicalReadiness). On cold-start the authority IS the request
      // graph, so `analysisReadyForTurn` (the identical parse) is reused;
      // otherwise the persisted/canonical or post-mutation graph is parsed
      // fresh. Shared verbatim with the non-execute finalise fallback.
      const canonicalReadinessForRun = deriveCanonicalReadiness(
        canonicalReadinessGraphForRun,
        graphStateForTurn,
        analysisReadyForTurn,
      );
      canonicalStateForRun = selectCanonicalAnalysisState({
        handlerFacts: handlerFactsForCommit,
        priorFacts: context.prior_facts,
        readiness: canonicalReadinessForRun,
        currentGraphHash: hashForPostHandlerFreshness,
        currentGraphOptionIds: currentGraphOptionIdsForPostHandler,
      });
      // V5 Task 2.1: deterministic chip suggestions for the execute branch.
      // V5 0.9.0: priorFacts threaded so the new facts_absent rule does not
      // emit a misleading "Run analysis" chip when a prior non-noop
      // run_analysis fact already exists in the conversation.
      let executeChips = generateChips({
        stage: context.stage,
        handlerFacts: handlerFactsForCommit,
        priorFacts: context.prior_facts,
        analysis: contextPackForLog?.analysis ?? null,
        graphOptionCount: contextPackForLog?.graph.counts.options ?? 0,
        analysisReady: analysisReadyForTurn,
        validationRegistry: options.validationRegistry ?? HANDLER_VALIDATION_REGISTRY,
        ...(buildTurnOutcome() ? { turnOutcome: buildTurnOutcome()! } : {}),
        // Mission 1 (context authority): the post-dispatch canonical verdict
        // — same fact chain + hash as `turnOutcome.analysis_freshness`, plus
        // contradiction-aware requiresRerun — so chips read the composed
        // authority instead of local scans.
        canonicalState: canonicalStateForRun,
      });

      // V5 P0.2 — flip-threshold proposal emission (Seam 1). On a
      // what_would_flip turn, offer a deterministic, provenance-safe
      // "Test X at N" set_factor_value proposal when a single-factor flip
      // exists and inverts to an exact, safely-displayable user-scale
      // value. Emits NOTHING otherwise (null flip / unrenderable / no cap /
      // no graph hash). The verified emit logic lives in
      // compose/flip-proposal.ts (buildFlipProposalEmit).
      if (
        proposedHandlerId === 'what_would_flip' &&
        currentAnalysisGraphHashForTurn !== null
      ) {
        const priorRun = selectRunAnalysisFact(context.prior_facts);
        const priorEnrichment = priorRun
          ? (priorRun.fact as { result?: { enrichment?: unknown } }).result?.enrichment
          : undefined;
        const flipEmit = buildFlipProposalEmit(
          priorEnrichment,
          buildFactorNodeLookup(context.persistedGraph),
          {
            scenario_id: context.session_id,
            graph_hash: currentAnalysisGraphHashForTurn,
            emitted_at_iso: new Date().toISOString(),
            registry: options.handlerRegistry ?? getDefaultRegistry(),
          },
        );
        emit(TelemetryEvents.V5ProposedChangeEmitted, {
          request_id: requestId,
          scenario_id: context.session_id,
          handler_id: 'what_would_flip',
          result: flipEmit.status,
        });
        if (flipEmit.status === 'emitted') {
          flipProposalPending = flipEmit.pending;
          // Protect the proposal chip at the front; dedupe by id; cap at 3.
          const deduped: SuggestedAction[] = [];
          const seenChipIds = new Set<string>();
          for (const chip of [flipEmit.chip, ...executeChips]) {
            if (seenChipIds.has(chip.id)) continue;
            seenChipIds.add(chip.id);
            deduped.push(chip);
            if (deduped.length >= 3) break;
          }
          executeChips = deduped;
        }
      }

      composedOk = composeToolCallResponse({
        orientation: orientationForCompose,
        confirmation: confirmationText,
        coaching: coachingText,
        stage: context.stage,
        handlerFacts: handlerFactsForCommit,
        suggested_actions: executeChips,
        // R4 lookup fix — persisted-snapshot fallback for graph-node
        // ID→{label,kind} resolution. The PLoT envelope on the fact has no
        // `graph` key, so without this the Phase 3 target_refs are always
        // empty and the flag-gated ui_directive can never resolve its
        // option target. Already loaded for the turn by buildTurnContext;
        // no extra DB read.
        persistedGraph: context.persistedGraph,
        // Review F1 — hash gate for the current-turn fallback: the
        // canonical analysis-affecting hash of context.persistedGraph,
        // already computed above for the freshness derivation. The
        // run_analysis handler does its OWN persisted read at execution
        // time; compose only consults the turn-start snapshot when this
        // hash equals the fact's `graph_hash_at_run` — a concurrent
        // writer between the two reads makes them diverge → compose
        // fails closed to pre-fix behaviour instead of resolving stale
        // labels. No new hashing here.
        persistedGraphHash: currentAnalysisGraphHashForTurn,
        // PR 3 — thread lifecycle context so the composer can serve
        // Phase 3 blocks from prior_facts when the current turn produced
        // no run_analysis fact, or emit the stale-safe rerun coaching
        // when the graph has diverged from the source fact.
        //
        // Fact-array basis: `freshness` above was derived against the UNIFIED
        // array `[...handlerFactsForCommit, ...context.prior_facts]`, so
        // `freshness.selected_fact_index` is a position in THAT array. Hand the
        // composer the same unified array so the index basis is consistent
        // end-to-end (the composer also re-resolves the fact by content as a
        // safety net — see selectPriorRunAnalysisFact). Passing the unprepended
        // `context.prior_facts` here is the historical routed-turn bug: a
        // non-run_analysis current-turn fact shifts the index by
        // handlerFactsForCommit.length → selected_fact_unavailable.
        ...(freshness !== null
          ? {
              lifecycle: {
                priorFacts: [...handlerFactsForCommit, ...context.prior_facts],
                freshness,
                requestId,
                scenarioId: context.session_id,
              },
            }
          : {}),
      });
      // V5 P0.2 — resume echo. When this execute turn is a RESUMED
      // apply_proposed_change that ACTUALLY applied a change, prepend the
      // proposal's label so the user sees exactly which proposal is being
      // applied — a safety net against a wrong-target most-recent-wins
      // resume. Uses the sanctioned render-safe copy resolver, so unsafe
      // persisted labels are swapped for the deterministic fallback (no
      // handler-id / JSON / prop_ / internal / raw-decimal leakage in the
      // "Applying: …" text). GATED on a non-noop mutation fact (mirrors the
      // canonical mutation-fact predicate used for `priorMutationFactCount`
      // above): a "set X to its current value" resume returns a successful
      // outcome with `noop: true`, and must NOT narrate "Applying:" when
      // nothing changed — honouring "narration must follow persisted state".
      const resumeAppliedRealMutation =
        consumedPendingAction?.action.kind === 'apply_proposed_change' &&
        (handlerOutcome?.handler_facts ?? []).some(
          (f) =>
            !f.noop &&
            (f.fact_type === 'add_constraint' ||
              f.fact_type === 'set_factor_value' ||
              f.fact_type === 'adjust_edge_strength'),
        );
      if (composedOk !== null && resumeAppliedRealMutation) {
        const { label: echoLabel } = resolveProposalRenderCopy(
          consumedPendingAction!.action,
        );
        const rest = composedOk.assistant_text ? ` ${composedOk.assistant_text}` : '';
        composedOk = {
          ...composedOk,
          assistant_text: `Applying: ${echoLabel}.${rest}`,
        };
      }
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
        // Mission 1 (context authority): the shared pre-dispatch canonical
        // verdict — same object the coaching pack and finalise fallback read.
        ...(canonicalStateForNonExecute()
          ? { canonicalState: canonicalStateForNonExecute()! }
          : {}),
      });
      // Area C (deterministic-copy hardening): the routing LLM can emphasise a
      // fragment of the user's question with markdown bold as if it were a
      // graph entity. Preserve bold ONLY around real graph node / option /
      // analysis labels (exact match); strip the `**` markers otherwise so the
      // clarification reads as neutral copy without promoting a fragment to an
      // entity. Bounded: only `**…**` spans are inspected; no other markdown is
      // touched; no fuzzy matching.
      const clarifyValidLabels = collectValidEntityLabels({
        graphNodes: contextPackForLog?.graph.nodes ?? [],
        labels: (analysisReadyForTurn?.options ?? []).map((o) => o?.label),
      });
      const clarifyGuardedText = neutraliseUnvalidatedBoldEntities(
        sanitised.output,
        clarifyValidLabels,
      ).text;
      composedOk = composeClarifyResponse({
        assistant_text: clarifyGuardedText,
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
      //
      // ROADMAP 1.38 — the coach tool-call variant now carries an optional
      // `answer_text` (tool-schema.ts): the FULL coaching answer Sonnet
      // authored, not just the brief pre-tool-call orientation. Prefer it
      // when present; fall back to `orientationText` exactly as before when
      // absent, so old-shaped responses are byte-identical to pre-fix
      // behaviour. This is the fix for the silent-truncation defect
      // (TRUNCATION-BUG-HANDOVER.md): previously only `orientationText` —
      // a single confident sentence — ever reached the user on coach turns.
      // Trimmed-truthiness on both branches (review nit): an empty or
      // whitespace-only answer_text must fall back to orientationText,
      // never ship a blank answer.
      const coachAnswerText = routingResult.proposal.answer_text;
      const coachAnswerSource = coachAnswerText?.trim()
        ? coachAnswerText
        : routingResult.orientationText;
      // ROADMAP 1.38 — source telemetry (NOT flag-gated; see telemetry.ts).
      // Measures which channel shipped for THIS turn, independent of the
      // CEE_ANSWER_TEXT_REQUIRED hardening below — this is what quantifies
      // v42.2g's population lift in the current prompt-only world.
      emit(TelemetryEvents.V5CoachingAnswerSource, {
        request_id: requestId,
        scenario_id: context.session_id,
        intent_class: 'coach',
        source: coachAnswerText?.trim() ? 'answer_text' : 'orientation_fallback',
        answer_text_length: coachAnswerText?.length ?? 0,
        orientation_length: routingResult.orientationText.length,
      });
      const sanitised = sanitiseNarrateOutput(coachAnswerSource);
      if (sanitised.contamination_detected) {
        emit(TelemetryEvents.TurnExecutorContaminationNarrate, {
          request_id: requestId,
          raw_length: coachAnswerSource.length,
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
        // Mission 1 (context authority): the shared pre-dispatch canonical
        // verdict, threaded UNCONDITIONALLY (was flag-gated via the coaching
        // pack object) — chips, prompt pack and finalise fallback now read
        // ONE memoised object and cannot disagree.
        ...(canonicalStateForNonExecute()
          ? { canonicalState: canonicalStateForNonExecute()! }
          : {}),
        // ROADMAP 1.20(b) — chip-sameness guard (see helper doc comment).
        recentlyOfferedChipIds: recentlyOfferedChipIds(),
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
        // ROADMAP 1.16j — chip-sameness guard (see helper doc comment).
        // The wrapper path previously bypassed 1.20(b) entirely: the
        // identical review-card chip was re-offered on all 6 post-analysis
        // turns in the 11 Jul manual test (edf2a4d9).
        recentlyOfferedChipIds: recentlyOfferedChipIds(),
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
      // Coaching Context Pack v1 deterministic post-check (flag-gated). On a
      // boundary violation, degrade to a safe rerun response; otherwise pass
      // the LLM prose + chips through unchanged.
      const coachGuarded = applyCoachingOutputGuard(sanitised.output, coachComposedChips);
      composedOk = composeDirectAnswerResponse({
        assistant_text: coachGuarded.assistant_text,
        stage: context.stage,
        suggested_actions: coachGuarded.suggested_actions,
      });
      stagesCompleted.push('compose');
      // CEE_ANSWER_TEXT_REQUIRED compose guard (belt-and-braces layer B,
      // default OFF — config/index.ts). Layer A (tool-schema.ts) forces a
      // REPAIR_ONCE retry when a coach tool call omits/blanks answer_text,
      // which makes a RAW blank answer_text unreachable here once Layer A
      // has run — but Layer A validates the RAW string, BEFORE the
      // sanitise/guard pipeline below. This is the genuinely independent
      // residual layer B closes: a raw answer_text that is non-blank (so
      // Layer A is satisfied) can still sanitise down to empty — e.g. pure
      // tag/markup content with no retained inner text — or the coaching
      // post-check's degrade path can (in principle) hand back blank prose.
      // Checking the FINAL composedOk.assistant_text, after every existing
      // step (chip generation, coachWrapper, sanitiser, coaching-output
      // guard) has already run unchanged, is the only point that actually
      // reflects what the user would receive — so this also covers Sonnet
      // 5 adaptive thinking starving orientationText to zero (live-observed
      // 1/6, acceptance-evidence/sonnet5-reflip/) for any case that slips
      // past Layer A. Reuses the SAME deterministic copy/chip builder as
      // the routing schema-repair-failure path
      // (commitBoundedRoutingFallback) rather than inventing new copy.
      // Flag OFF: this block never runs — byte-identical to pre-hardening
      // behaviour (the known live defect this lane hardens against).
      if (config.features.answerTextRequired && !composedOk.assistant_text.trim()) {
        const { assistantText: recoveryText, chips: recoveryChips } =
          buildBoundedFallbackCopyAndChips();
        emit(TelemetryEvents.V5CoachingEmptyAnswerRecovered, {
          request_id: requestId,
          scenario_id: context.session_id,
          intent_class: 'coach',
          answer_text_length: routingResult.proposal.answer_text?.length ?? 0,
          orientation_length: routingResult.orientationText.length,
        });
        composedOk = composeDirectAnswerResponse({
          assistant_text: recoveryText,
          stage: context.stage,
          suggested_actions: recoveryChips,
        });
      }
    } else {
      // text_only → inferred converse. tool_call converse falls in here
      // too (execute/clarify/coach are exhaustively handled above).
      //
      // ROADMAP 1.38 — tool-call converse now carries an optional
      // `answer_text` (tool-schema.ts), mirroring the coach branch fix
      // above. Prefer it when present; fall back to `orientationText`
      // exactly as before when absent (byte-identical to pre-fix
      // behaviour). text_only responses are unaffected — they already
      // ship the model's full `.text` and have no separate answer_text
      // channel.
      const text =
        routingResult.type === 'text_only'
          ? routingResult.text
          : routingResult.proposal.intent_class === 'converse' &&
              routingResult.proposal.answer_text?.trim()
            ? routingResult.proposal.answer_text
            : routingResult.orientationText;
      // ROADMAP 1.38 — source telemetry (NOT flag-gated; see telemetry.ts).
      // Same measurement instrument as the coach branch above, scoped to
      // tool_call converse (the only shape with an answer_text channel to
      // measure — text_only ships `.text` directly, no pick to record).
      if (routingResult.type === 'tool_call' && routingResult.proposal.intent_class === 'converse') {
        const converseAnswerText = routingResult.proposal.answer_text;
        emit(TelemetryEvents.V5CoachingAnswerSource, {
          request_id: requestId,
          scenario_id: context.session_id,
          intent_class: 'converse',
          source: converseAnswerText?.trim() ? 'answer_text' : 'orientation_fallback',
          answer_text_length: converseAnswerText?.length ?? 0,
          orientation_length: routingResult.orientationText.length,
        });
      }
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
        // Mission 1 (context authority): the shared pre-dispatch canonical
        // verdict, threaded UNCONDITIONALLY (was flag-gated via the coaching
        // pack object) — chips, prompt pack and finalise fallback now read
        // ONE memoised object and cannot disagree.
        ...(canonicalStateForNonExecute()
          ? { canonicalState: canonicalStateForNonExecute()! }
          : {}),
        // ROADMAP 1.20(b) — chip-sameness guard (see helper doc comment).
        recentlyOfferedChipIds: recentlyOfferedChipIds(),
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
        // ROADMAP 1.16j — chip-sameness guard (see helper doc comment);
        // same threading as the coach-path wrapper call above.
        recentlyOfferedChipIds: recentlyOfferedChipIds(),
      });
      const converseComposedChips = converseWrapper.fired
        ? [...converseWrapper.chips, ...converseChips]
        : converseChips;
      // See coach-path comment above re: telemetry-only recovery state.
      // Coaching Context Pack v1 deterministic post-check (flag-gated). On a
      // boundary violation, degrade to a safe rerun response; otherwise pass
      // the LLM prose + chips through unchanged.
      const converseGuarded = applyCoachingOutputGuard(
        sanitised.output,
        converseComposedChips,
      );
      composedOk = composeDirectAnswerResponse({
        assistant_text: converseGuarded.assistant_text,
        stage: context.stage,
        suggested_actions: converseGuarded.suggested_actions,
      });
      stagesCompleted.push('compose');
      // CEE_ANSWER_TEXT_REQUIRED compose guard (belt-and-braces layer B,
      // default OFF — config/index.ts). Mirrors the coach-branch guard
      // above; see its comment for the full rationale — checks the FINAL
      // composedOk.assistant_text (post sanitise/guard pipeline) rather
      // than the raw answer_text/orientationText, since Layer A only
      // validates the raw string and a non-blank raw string can still
      // sanitise down to empty. Explicitly scoped to tool_call converse —
      // text_only converse can never be empty here (tryInterpret's
      // `empty_response` check already rejects an all-blank text_only
      // response upstream, in route-with-tool-use.ts).
      if (
        config.features.answerTextRequired &&
        routingResult.type === 'tool_call' &&
        routingResult.proposal.intent_class === 'converse' &&
        !composedOk.assistant_text.trim()
      ) {
        const { assistantText: recoveryText, chips: recoveryChips } =
          buildBoundedFallbackCopyAndChips();
        emit(TelemetryEvents.V5CoachingEmptyAnswerRecovered, {
          request_id: requestId,
          scenario_id: context.session_id,
          intent_class: 'converse',
          answer_text_length: routingResult.proposal.answer_text?.length ?? 0,
          orientation_length: routingResult.orientationText.length,
        });
        composedOk = composeDirectAnswerResponse({
          assistant_text: recoveryText,
          stage: context.stage,
          suggested_actions: recoveryChips,
        });
      }
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

    // STEP 6.6 — structural-success-claim honesty gate (Brief 4, ENFORCING).
    //
    // Closes the E1 trust failure: a turn whose free-form text claims a
    // structural graph mutation ("I'll add the … option to your model now")
    // while NO durable typed operation committed and NO graph changed. Unlike
    // the STEP 6.5 monitor above, this gate has NO handler_id filter (the
    // captured failure committed with handler_id === null) and SWAPS the text
    // to an honest decline. The "no mutation" predicate mirrors buildTurnOutcome
    // (handlerEmittedMutatedGraph || isDraftOrEditGraph), exempting every
    // committed mutation. It runs BEFORE proposal-capture/commit so the swapped
    // text is the single source for every downstream surface.
    //
    // PRECISION-FIRST decision (classifyStructuralClaim): the ONLY swap trigger is
    // a tightly-bound, unambiguous first-person structural claim — a past/perfect
    // COMPLETION ("I added a factor", "I updated the model") or an UNCONDITIONAL
    // future/in-progress COMMITMENT ("I'll add a factor", "I'm adding a node").
    // Everything else is MONITOR-ONLY telemetry, never swapped: broad / noun-less /
    // passive / actorless language, ambiguous edges, and CONDITIONAL offers
    // ("I'll add a factor if you approve") — so idioms/people/read-outs/non-graph
    // prose and conditional offers are NOT false-declined. Structural-edit INTENT
    // is computed below and passed as telemetry context but does NOT drive the
    // swap (the intent-gated broad arm was removed); recall for the monitored
    // residual is owned by the durable follow-ups #288/#289.
    {
      const structuralEditIntent = mentionsStructuralEditRequest(payload.message);
      const decision = classifyStructuralClaim({
        assistantText: composedOk.assistant_text,
        handlerEmittedMutatedGraph,
        proposedHandlerId: proposedHandlerIdForOutcome,
        structuralEditIntent,
      });
      if (decision.verdict === 'swap') {
        emit(TelemetryEvents.V5StructuralSuccessClaimSwapped, {
          request_id: requestId,
          scenario_id: context.session_id,
          handler_id: handlerIdForCommit ?? null,
          text_length: composedOk.assistant_text?.length ?? 0,
          match_kind: decision.kind,
        });
        composedOk = { ...composedOk, assistant_text: V5_STRUCTURAL_DECLINE_TEXT };
      } else if (decision.verdict === 'monitor') {
        emit(TelemetryEvents.V5StructuralSuccessClaimCandidateMiss, {
          request_id: requestId,
          scenario_id: context.session_id,
          handler_id: handlerIdForCommit ?? null,
          text_length: composedOk.assistant_text?.length ?? 0,
          candidate_kind: decision.kind,
        });
      }
    }

    // ==================================================================
    // STEP 7 — COMMIT (unchanged contract)
    // ==================================================================
    // F3 ordering parity (PR #414 review) — hoisted OUTSIDE the try so the
    // catch below can revert the pre-commit `effectiveTurnGraph` assignment
    // when the commit fails (mirror of commitGmHeldResume's
    // `preApplyEffectiveTurnGraph` revert): a failed commit must never
    // advertise the unpersisted committed-graph projection.
    let preCommitEffectiveTurnGraph: GraphV3T | null = null;
    let effectiveTurnGraphSetPreCommit = false;
    try {
      // V5 D1 mutation handlers (set_factor_value, add_constraint,
      // adjust_edge_strength) emit a post-mutation graph on
      // HandlerOutcome.mutated_graph. When present it supersedes the
      // per-turn ingress / persisted graph so append_turn_atomic(p_graph)
      // persists the mutated state. Handlers MUST have validated this
      // graph through GraphV3.parse before returning it — invalid graphs
      // do not reach here.
      //
      // When mutated_graph is absent the turn did not change the graph,
      // and the commit MUST NOT write one (p_graph null leaves
      // scenarios.graph untouched — the documented CommitMetadata.graph
      // contract). The previous fallback persisted the client-echoed
      // options.graphState on every spine turn ("pre-D1 behaviour"), but
      // the wire never carries server-only fields (options[],
      // goal_node_id on the draft_graph block), so a non-mutating
      // explain overwrote the rich draft-persisted graph with a lossy
      // echo. The analysis-freshness hash covers exactly those fields →
      // graph_hash_diverged with zero edits → false "re-run analysis
      // first" deflections (V5-FRESH-01 H2). Canvas persistence is
      // UI-owned (DGAI autosaves scenarios.graph directly; client-side
      // edits arrive as system_event turns which deliberately persist no
      // graph), so the echo write was never load-bearing for saves.
      //
      // V5-D1-SHAPE-01 — when a D1 handler DID emit mutated_graph, it
      // must not be committed wholesale: the handler mutated the
      // ingress echo (`applyAndValidateMutation` merges structural
      // fields back onto the INGRESS top-level shape), and the DGAI
      // echo never carries `goal_node_id` / `options[]`, so the raw
      // mutated_graph would replace the rich draft-persisted
      // `scenarios.graph` with a stripped shape — canonical state
      // loss: goal_node_id gone, options[] → 0 (scorecard J5c),
      // top-level metadata stripped, future turns inherit the lossy
      // merge base, and the freshness hash (which covers exactly
      // those fields) can spuriously diverge. run_analysis itself may
      // still succeed — readiness re-derives goal/options from node
      // kinds — so this is corruption, not a guaranteed analysis
      // outage. Mirror of the edit_graph fix (PR #265): strict-
      // read the persisted graph and merge the mutation onto that
      // server-authoritative base. The strict read FAILS CLOSED — a
      // degraded/unavailable read throws here, inside the STEP 7 try,
      // and maps to STATE_COMMIT_FAILED below: the handler facts
      // assert the mutation was applied, so committing them without
      // the graph (or with a lossy graph) would corrupt canonical
      // state. `context.session_id` IS the scenario id
      // (build-turn-context sets `session_id: payload.scenario_id`)
      // and is the same value `commitTurn` receives as `scenario_id`,
      // so the read and the commit target the same scenarios row.
      //
      // Uniform at this chokepoint by design: the ONLY mutated_graph
      // emitters are the three D1 handlers (set_factor_value,
      // add_constraint, adjust_edge_strength — enumeration pinned by
      // d1-mutated-graph-emitters invariant test); the flip-proposal
      // apply path resolves through the same set_factor_value handler.
      let graphForCommit = await (async (): Promise<unknown> => {
        const mutated = handlerOutcome?.mutated_graph;
        if (mutated === undefined || mutated === null) return mutated;
        let persistedBase: unknown;
        try {
          persistedBase = await loadPersistedGraphStrict(context.session_id);
        } catch (err) {
          throw new Error(
            `V5 D1 — refusing to persist mutated graph for scenario ${context.session_id}: persisted merge base unavailable (${err instanceof Error ? err.message : String(err)})`,
          );
        }
        return mergeMutatedGraphForPersistence({
          mutatedGraph: mutated as Record<string, unknown>,
          persistedBase,
          requestId,
          scenarioId: context.session_id,
        });
      })();
      // Lane 20 — goal-target receipt honesty guard (STEP 6.6-class swap
      // discipline for success-target claims, mirrored from the edit_graph
      // dispatch guard). A "Success target set" receipt (formatGoalTargetSet
      // on the add_constraint path, or any composed equivalent) may ship
      // ONLY when the graph committed THIS turn actually REGISTERS the
      // target — a goal-kind node carrying a finite `goal_threshold_raw`,
      // the exact field `has_goal_target` / the UI goal chip / PLoT's
      // explicit-threshold path read. This closes the "merge seam stripped
      // it / handler regressed" class where the receipt is composed from
      // handler-local state while the POST-MERGE `graphForCommit` no longer
      // carries the contract. Non-mutating turns may honestly DESCRIBE an
      // already-registered target (backed by the persisted graph). The swap
      // runs BEFORE commitTurn so the stored assistant_message equals the
      // honest wire copy; a commit FAILURE already withholds the receipt
      // via the STEP 7 catch (STATE_COMMIT_FAILED), so together the
      // formatGoalTargetSet class ships only on a durable commit whose
      // graph carries the threshold.
      {
        const goalReceiptDecision = decideGoalTargetReceipt({
          assistantText: composedOk.assistant_text,
          commitGraph: graphForCommit ?? null,
          persistedGraph: context.persistedGraph ?? null,
        });
        if (goalReceiptDecision.verdict === 'swap') {
          const graphWasWrittenThisTurn =
            graphForCommit !== null && graphForCommit !== undefined;
          log.warn(
            {
              event: 'v5.turn_executor.goal_target_receipt_swapped',
              request_id: requestId,
              scenario_id: context.session_id,
              handler_id: handlerIdForCommit ?? null,
              reason: goalReceiptDecision.reason,
              graph_committed: graphWasWrittenThisTurn,
              graph_write_withheld: graphWasWrittenThisTurn,
            },
            'V5 TurnExecutor — success-target receipt claimed a registration the commit graph does not carry (no goal_threshold_raw on a goal node); swapped for the honest fallback before commit',
          );
          // Overnight review F10 — name any surviving previously-registered
          // target instead of falsely claiming none exists (see
          // formatGoalTargetNotSavedText doc).
          composedOk = {
            ...composedOk,
            assistant_text: formatGoalTargetNotSavedText(context.persistedGraph ?? null),
          };
          // ROADMAP 1.19(b) — swap-vs-commit: swapping the TEXT for the
          // honest fallback while still persisting the graph this turn's
          // (unbacked) mutation produced would commit junk — the exact
          // live shape that opened this guard (LLM stamped non-contract
          // fields onto the goal node). A turn whose registration claim
          // was swapped for dishonesty must not durably write the graph
          // that failed to back it; withhold the write entirely so the
          // stored/committed state matches the honest "I couldn't
          // register that" text (a non-mutating turn, same as any other
          // turn that writes no graph). Only applies when a graph WAS
          // produced this turn — a swap driven by `persistedGraph` not
          // backing a DESCRIBE-only claim has no graph to withhold.
          if (graphWasWrittenThisTurn) {
            graphForCommit = undefined;
            // Overnight review F5 — the withheld write must also withhold
            // the "applied" edit receipt FACT built from the same unbacked
            // mutation. Committing `handlerFactsForCommit` unchanged here
            // (status: 'applied', noop: false) while the graph write is
            // withheld grounds the NEXT turn's LLM on a phantom edit —
            // `recent_changes` / prior_facts readers have no persisted
            // graph to cross-check the fact against, so they take it at
            // face value (DL-7 violation: a receipt narrating an applied
            // mutation with no persistable graph state behind it). A
            // withheld-write turn is a non-mutating turn, same as any
            // other turn that writes no graph and emits no facts.
            handlerFactsForCommit = [];
          }
        }
      }
      // ROADMAP 1.20(a) — empty-direct-answer papering, STEP 7 backstop.
      // UNCONDITIONAL (not gated by CEE_ANSWER_TEXT_REQUIRED). Live
      // evidence: a direct_answer turn shipped a sha256('')-empty
      // assistant_text papered over by a recycled chip — the deterministic
      // chip generators (coachChips/converseChips) build from
      // stage/analysis context independent of the text, so an empty
      // answer still carries a chip and reads as a valid turn. The
      // compose-guard above (STEP 6.7, coach/converse branches) already
      // closes this when CEE_ANSWER_TEXT_REQUIRED is on — but that flag
      // defaults OFF (config/index.ts `features.answerTextRequired`),
      // which is the exact regression the flag-OFF pins in
      // turn-executor-answer-text-compose-guard.test.ts documented as a
      // KNOWN LIVE DEFECT rather than a passing invariant. This backstop
      // makes the honest-recovery behaviour unconditional by running at
      // the shared STEP 7 commit chokepoint every direct_answer-class
      // turn passes through, regardless of which branch composed it.
      // Reuses the SAME buildBoundedFallbackCopyAndChips() helper (#388)
      // so there is one copy/chip source, not a second one drifting
      // apart. Scoped to `direct_answer` only — handler-class turns (D1
      // execute) carry their own claim-integrity-checked receipt
      // formatters (never blank by construction, see
      // d1-shared/format-confirmation.ts) and their own guard above; this
      // must not fire for them.
      if (
        (resolvedTurnClass ?? 'direct_answer') === 'direct_answer' &&
        !composedOk.assistant_text.trim()
      ) {
        const { assistantText: recoveryText, chips: recoveryChips } =
          buildBoundedFallbackCopyAndChips();
        emit(TelemetryEvents.V5CoachingEmptyAnswerRecovered, {
          request_id: requestId,
          scenario_id: context.session_id,
          intent_class: 'direct_answer_backstop',
          answer_text_length: 0,
          orientation_length: 0,
        });
        composedOk = composeDirectAnswerResponse({
          assistant_text: recoveryText,
          stage: context.stage,
          suggested_actions: recoveryChips,
        });
      }
      // Proposal-capture hash — the graph this turn reasoned over
      // (mutated graph when present, else the resolved turn graph).
      // Lane 22 (live 2026-07-07): the fallback was previously the RAW
      // request `options.graphState`, which is absent on follow-up turns —
      // both live proposal captures persisted with EMPTY preconditions
      // (no graph_hash), so hash-divergence invalidation was inert.
      // `graphStateForTurn` is the request graphState when present, else
      // the persisted-graph fallback loaded by buildTurnContext — the
      // same authority every other per-turn graph consumer uses.
      const graphForProposalHash =
        handlerOutcome?.mutated_graph !== undefined
          ? handlerOutcome.mutated_graph
          : graphStateForTurn;
      let commitStartedAt = 0;
      if (timingsEnabled) {
        commitStartedAt = Date.now();
        // compose_ms covers the work between handler return and commit
        // start: response composition, sanitisation, guidance generation,
        // egress-prep. Captured only on the main happy path; absent on
        // recovery/short-confirm/chip-click paths where the handler-return
        // anchor was never set.
        if (composeStartedAt > 0) {
          turnTimings.compose_ms = commitStartedAt - composeStartedAt;
        }
      }
      // V5 P0 proposal-memory continuation — emit-time capture.
      //
      // When the upstream composer (LLM Sonnet on this commit site) has
      // emitted assistant_text shaped like "would you like me to add X
      // as a factor?", persist a `proposed_concept` pending action
      // alongside the commit so the next-turn no-op recovery in
      // edit-graph-dispatch (and the pre-LLM intercept) can resume it
      // as a deterministic clarifier. Conservative — the helper returns
      // undefined when no proposal pattern matches, in which case the
      // commit falls back to its existing chip-derived implicit
      // behaviour. Capture failures degrade silently.
      const llmGraphHash = (() => {
        try {
          return (
            computeAnalysisAffectingGraphHash(
              (graphForProposalHash as GraphStateIngress | null | undefined) ?? undefined,
            ) ?? null
          );
        } catch {
          return null;
        }
      })();
      const proposalPendingForCommit = buildPendingActionsWithProposalCapture({
        assistantText: composedOk.assistant_text,
        chips: composedOk.suggested_actions ?? [],
        scenarioId: context.session_id,
        graphHash: llmGraphHash,
        requestId,
        originPath: 'llm_sonnet',
      });

      // Defence-in-depth brief persistence (V5 Phase 3A prerequisite):
      // re-pass the scenario brief that build-turn-context already
      // loaded. The RPC's first-write-wins predicate makes this a no-op
      // when brief_text is already non-null, so this is safe for every
      // turn class. Covers the case where a draft turn somehow committed
      // without briefText (e.g. legacy draft pre-Fix A) — subsequent
      // non-draft turns will backfill the brief from the enriched
      // context if it's still null.
      // V5 P0.2 — merge the flip-threshold proposal's pending (most recent
      // first) ahead of any chip-derived / proposed-concept pendings, capped
      // at the persisted budget of 3.
      const pendingForCommit = flipProposalPending
        ? [flipProposalPending, ...(proposalPendingForCommit ?? [])].slice(0, 3)
        : proposalPendingForCommit;
      // F3 (response projection, 1.16 run-3 diagnosis) — parse the graph
      // this commit is about to persist ONCE, ahead of the commit, so the
      // committed-graph projection can be applied in the right order at
      // both seams it feeds (see the pre-commit assignment below and the
      // post-commit readiness re-projection after `commitTurn`).
      const committedGraphParse =
        graphForCommit !== null && graphForCommit !== undefined
          ? GraphV3.safeParse(graphForCommit)
          : null;
      if (committedGraphParse?.success) {
        // Ordering parity with `commitGmHeldResume` (PR #414 review):
        // `commitTurn` snapshots `contentGraph = effectiveTurnGraph` for the
        // durable-text scrub, so the egress/label graph must be set to the
        // committed graph BEFORE the commit — otherwise the STORED assistant
        // text on a committed D1 turn resolves entity-id labels against the
        // pre-mutation graph while the WIRE uses the committed graph.
        // Reverted in the catch below so a failed commit never advertises
        // unpersisted state (same rule as the GM-held path).
        preCommitEffectiveTurnGraph = effectiveTurnGraph;
        effectiveTurnGraphSetPreCommit = true;
        effectiveTurnGraph = committedGraphParse.data;
      }
      const committed = await commitTurn(composedOk, {
        scenario_id: context.session_id,
        turn_id: context.request_id,
        turn_class: resolvedTurnClass ?? 'direct_answer',
        handler_id: handlerIdForCommit,
        request_hash: computeRequestHash(payload),
        llm_calls_used: llmCallsUsed,
        duration_ms: Date.now() - startedAt,
        handler_facts: handlerFactsForCommit,
        graph: graphForCommit,
        briefText: context.scenarioBriefText ?? undefined,
        ...(Array.isArray(pendingForCommit) && pendingForCommit.length > 0
          ? { pending_actions: pendingForCommit }
          : {}),
        // V5 Signature Loop — when this turn RESUMED a pending action (apply
        // proposed change / ordinal / label pick), exclude its ref from
        // carry-forward so a consumed proposal cannot reappear next turn. A
        // successful apply also moves the graph hash, which independently
        // invalidates the proposal in carry-forward; this is the explicit,
        // hash-independent guard (consumption-path #2).
        ...(consumedPendingAction !== null
          ? { consumedPendingRefs: [consumedPendingAction.chip_id] }
          : {}),
      });
      if (timingsEnabled) {
        turnTimings.commit_ms = Date.now() - commitStartedAt;
      }
      commitPerformed = committed.performed;
      stagesCompleted.push('commit');
      response = committed.response;
      // F3 (response projection, 1.16 run-3 diagnosis) — post-commit honesty
      // plumbing for the routed D1 execute path, parity with
      // `commitGmHeldResume` above. The commit just durably persisted
      // `graphForCommit` (the merged POST-mutation graph), and `freshness`
      // was already re-derived from the post-mutation hash at the
      // post-handler block — so the wire's
      // `analysis_ready.current_graph_hash` reflects the committed graph.
      // But `analysisReadyForTurn` (the readiness payload the finaliser
      // stamps as `analysis_ready`, carrying the option interventions)
      // still held its PRE-mutation value from the per-turn parse at STEP 0
      // (`effectiveTurnGraph` was re-projected pre-commit above, so the
      // durable-text scrub and the wire egress already share the committed
      // graph). Proven live consequence: the wire paired a post-mutation
      // `current_graph_hash` with pre-mutation option interventions, so the
      // canvas showed stale absolutes (£320k/£80k) while the DB held the
      // correct renormalised values. Re-derive readiness AFTER the commit
      // succeeds — a failed commit (the catch below) never advertises
      // unpersisted state, same rule as the GM-held path.
      if (committedGraphParse !== null) {
        if (committedGraphParse.success) {
          analysisReadyForTurn = computeStructuralReadiness(
            committedGraphParse.data,
          );
          // F-DG (W1 overnight 2026-07-11, wire-proven): #414 attached the
          // applied post-mutation graph as `draft_graph` on the edit_graph
          // apply family (edit-graph-dispatch + GM held-consent), but the
          // routed D1 typed-handler receipts composed HERE — including the
          // pending-action chip replays (e.g. the £250k consented
          // cap-extension resume), which synthesise an execute proposal and
          // funnel into this same commit — shipped without it. The UI's only
          // inline-graph ingestion path is the top-level `draft_graph` wire
          // field (adaptDraftResponse/applyDraftResult), so those applied
          // mutations were invisible on the canvas. Attach the SAME typed
          // parse of the SAME committed graph the readiness/egress
          // re-projections above use, in exactly the draft-dispatch shape
          // (see applied-graph-emit.ts). Gating parity with #414: committed
          // success only — this branch runs after `commitTurn` resolved and
          // only when a graph was persisted this turn (swap-withheld and
          // non-mutating turns never reach it; the commit-failure catch
          // below replaces the response wholesale). On a failed GraphV3
          // parse (the else branch) nothing is attached — fail open to the
          // pre-fix wire, consistent with the readiness fail-open.
          response = {
            ...response,
            draft_graph: buildAppliedGraphWireField(committedGraphParse.data),
          };
        } else {
          // Should be unreachable: D1 handlers GraphV3-validate the mutated
          // graph and the persistence merge only restores top-level fields.
          // Fail open to the pre-mutation projection (the pre-fix behaviour)
          // rather than dropping readiness from the wire, but say so loudly:
          // structured warn + frozen-registry event (PR #414 review) so the
          // merge-seam/schema-drift signal is dashboard-visible. Payload is
          // content-free — correlation ids, the closed handler enum, and the
          // first zod issue path (schema keys/indices only, never values).
          emit(TelemetryEvents.V5CommittedGraphReprojectionFailed, {
            request_id: requestId,
            scenario_id: context.session_id,
            handler_id: handlerIdForCommit ?? null,
            first_issue_path:
              committedGraphParse.error.issues[0]?.path.join('.') ?? '',
          });
          log.warn(
            {
              request_id: requestId,
              scenario_id: context.session_id,
              handler_id: handlerIdForCommit ?? null,
            },
            'V5 TurnExecutor — committed D1 graph failed GraphV3 parse; wire analysis_ready left at its pre-mutation value',
          );
        }
      }
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
      // F3 ordering parity (PR #414 review) — the commit failed, so the
      // pre-commit committed-graph projection must not survive onto the
      // egress/label seam: revert to the STEP-0 view (mirror of
      // `commitGmHeldResume`'s catch).
      if (effectiveTurnGraphSetPreCommit) {
        effectiveTurnGraph = preCommitEffectiveTurnGraph;
      }
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

  /**
   * V5 stale-aware explain recovery — finaliser-level egress guard.
   *
   * Scans `response.assistant_text` for any forbidden phrase (per
   * `FORBIDDEN_USER_FACING_PHRASES`) and, on a hit, replaces the
   * assistant text with a neutral fallback and emits the
   * `v5.egress.forbidden_phrase_detected` telemetry event. The chip
   * set + blocks are preserved so the user retains a recovery
   * affordance.
   *
   * Idempotent: a second call on the rewritten response is a no-op
   * because the neutral fallback contains no forbidden phrase.
   */
  function enforceEgressForbiddenPhraseGuard(
    dispatchPath: 'turn_executor_finalise',
  ): void {
    if (!response) return;
    const assistantText = response.assistant_text;
    if (typeof assistantText !== 'string' || assistantText.length === 0) return;
    const guarded = applyEgressForbiddenPhraseGuard(assistantText);
    if (!guarded.rewritten) return;
    emit(TelemetryEvents.V5EgressForbiddenPhraseDetected, {
      request_id: requestId,
      scenario_id: context.session_id,
      phrase: guarded.hit,
      dispatch_path: dispatchPath,
    });
    response = {
      ...response,
      assistant_text: guarded.text,
    };
  }

  /**
   * AI Harness capability 1 — ALWAYS-ON false-success neutralisation.
   *
   * Finaliser-level companion to `enforceEgressForbiddenPhraseGuard`: that guard
   * catches lexical DENIAL ("I haven't applied any changes"); this one catches a
   * (false) first-person mutation-SUCCESS claim when NO durable mutation
   * committed this turn. STEP 6.6 already enforces this on the main LLM-routed
   * COMPOSE path (pre-commit), but the deterministic short-circuits
   * (advice-gate, stale-rerun, state-query, fresh-followup, no-analysis) and the
   * new post-analysis composer commit and return via `finalizeRun` WITHOUT
   * passing STEP 6.6. Running the SAME precision-first `classifyStructuralClaim`
   * here backstops every emit path uniformly — not gated by
   * CEE_POST_ANALYSIS_LOOP_ENABLED.
   *
   * Commit-anchored, NOT classifier-widening: the swap fires only on the
   * existing high-confidence first-person-completion verdict AND only when
   * `handlerEmittedMutatedGraph || isDraftOrEditGraph` is false (mirrors STEP 6.6
   * and buildTurnOutcome). Monitor-only classes (broad / passive / ambiguous-edge)
   * are NOT swapped — #288/#289 stay deferred. Idempotent: the neutral decline
   * text carries no claim, so a second pass is a no-op.
   */
  function enforceStructuralSuccessClaimGuard(
    dispatchPath: 'turn_executor_finalise',
  ): void {
    if (!response) return;
    const assistantText = response.assistant_text;
    if (typeof assistantText !== 'string' || assistantText.length === 0) return;
    const decision = classifyStructuralClaim({
      assistantText,
      handlerEmittedMutatedGraph,
      proposedHandlerId: proposedHandlerIdForOutcome,
      structuralEditIntent: mentionsStructuralEditRequest(payload.message),
    });
    if (decision.verdict !== 'swap') return;
    emit(TelemetryEvents.V5StructuralSuccessClaimSwapped, {
      request_id: requestId,
      scenario_id: context.session_id,
      handler_id: proposedHandlerIdForOutcome ?? null,
      text_length: assistantText.length,
      match_kind: decision.kind,
      dispatch_path: dispatchPath,
    });
    response = {
      ...response,
      assistant_text: V5_STRUCTURAL_DECLINE_TEXT,
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
    //
    // V5 stale-aware explain recovery — finaliser-level egress guard.
    // Runs as the LAST step before the response leaves this function,
    // so it backstops EVERY emit path: deterministic templates, LLM
    // output, fallback copy, recoverable-handler recovery, state-query
    // guard. An upstream hook would miss new emit paths added later;
    // a finaliser hook cannot. See FORBIDDEN_USER_FACING_PHRASES for
    // the contradiction list this enforces.
    enforceEgressForbiddenPhraseGuard('turn_executor_finalise');
    // AI Harness capability 1 — always-on false-success neutralisation. Runs
    // alongside the forbidden-phrase guard so EVERY emit path (incl. the
    // deterministic short-circuits and the new post-analysis composer, which
    // bypass STEP 6.6) is backstopped against a first-person mutation-success
    // claim with no committed mutation. Commit-anchored, precision-first, not
    // flag-gated. See `enforceStructuralSuccessClaimGuard`.
    enforceStructuralSuccessClaimGuard('turn_executor_finalise');
    const turnOutcome = buildTurnOutcome();
    // Fix 4 (observability): finalise turn timings only when V5_TIMING_DEBUG
    // is enabled. Default-OFF production paths skip the telemetry emit and
    // response mutation entirely so log volume and response shape are
    // unchanged. Staging sets the flag so the replay harness sees per-stage
    // numbers + a single matching telemetry event per turn.
    if (timingsEnabled) {
      turnTimings.total_ms = Date.now() - startedAt;
      turnTimings.llm_calls_used = llmCallsUsed;
      if (!turnTimings.handler_id) {
        turnTimings.handler_id = null;
      }
      emit(TelemetryEvents.V5TurnStageTimings, {
        request_id: requestId,
        session_id: context.session_id,
        v5_journey_id: context.session_id,
        ...turnTimings,
        ...(runAnalysisTimings ? { run_analysis: runAnalysisTimings } : {}),
      });
      if (response && typeof response === 'object') {
        try {
          const existing = (response as Record<string, unknown>)._timings;
          const block = existing && typeof existing === 'object'
            ? { ...(existing as Record<string, unknown>) }
            : ({} as Record<string, unknown>);
          block.turn = turnTimings;
          if (runAnalysisTimings) block.run_analysis = runAnalysisTimings;
          response = {
            ...response,
            _timings: block,
          } as OlumiResponse;
        } catch {
          // Never block the response on a timing-decoration failure.
        }
      }
    }
    // Non-execute shared-state foundation: every non-execute exit (clarify,
    // converse, coaching, recovery, explanation) finalises BEFORE the
    // post-dispatch execute assembly, so `canonicalStateForRun` is still
    // undefined here. Assemble it now from the SAME graph authority + fact
    // chain the routing freshness used, so non-execute turns get a
    // graph-authority-consistent verdict (with degraded detection over prior
    // facts) instead of route-v2's partial freshness-only fallback. Read-only /
    // diagnostic — surfaced ONLY via the route's flag-gated context-summary
    // diagnostic; `analysisReadyForTurn` (wire/chips) and dispatch are untouched.
    //
    //   - `handlerFacts: []`  — a non-execute turn dispatched no mutation/run
    //     handler, so it produced NO current-turn analysis facts. The verdict
    //     is derived purely from `priorFacts` (existing persisted analysis,
    //     incl. any degraded run); we never invent a current-turn fact.
    //   - `freshness !== null` — mirrors route-v2's `ctx.freshness !== undefined`
    //     gate. `freshness` is null ONLY before the routing-freshness derivation
    //     runs (the same point `currentAnalysisGraphHashForTurn` is computed),
    //     so an early exit (e.g. the graph-drift hard-fail) stays honestly
    //     absent. Once derived, `freshness` is non-null even when its verdict is
    //     `unknown`, so "state unknown" still assembles an honest unknown
    //     verdict — distinct from "no state derived yet" (skipped). No path
    //     fabricates freshness/readiness; both come from the real fact chain +
    //     hash via deriveAnalysisFreshness / deriveCanonicalReadiness.
    if (canonicalStateForRun === undefined && freshness !== null) {
      // Mission 1 (context authority): reuse the SAME memoised pre-dispatch
      // canonical the clarify/coach/converse chips and the coaching prompt
      // pack read (identical inputs to the inline derivation this replaced),
      // so the frame/diagnostic verdict is byte-identical to the one that
      // drove this turn's chips — one canonical object per non-execute turn.
      canonicalStateForRun = canonicalStateForNonExecute();
    }
    // T4 Slice 2 — build the canonical context frame ONCE, here at the single
    // finalise seam every path funnels through. Pure wrap of the authority
    // outputs already in scope: the SAME `freshness` derivation and
    // `canonicalStateForRun` verdict returned below, the pack's already-capped
    // recent-changes projection (shape-adapted once via
    // projectRecentChangesToFrame), and integer counts of the SAME
    // `effectiveTurnGraph` the route resolves labels against (identical input
    // to the route's previous count call — parity by construction). Built only
    // when the canonical state AND the assembled pack exist; on earlier exits
    // the frame is honestly absent (never fabricated from partial state).
    // Track 2: `pendingConfirmation` + the redacted `pending` diagnostics are
    // now threaded from the ORIENT-time derivation (the SAME shared const the
    // ContextPack received — pack/frame agreement by construction). `intent` /
    // claim permissions remain deliberately NOT threaded — the builder's
    // documented defaults mean "not supplied"; those are later slices with
    // their own owners.
    let frameForRun: CanonicalContextFrame | undefined;
    if (
      canonicalStateForRun !== undefined &&
      freshness !== null &&
      contextPackForLog !== null
    ) {
      // Track 2 — rerun / what-changed readiness, computed HERE (outside the
      // builder, which the source-scan allowlist forbids from importing the
      // fact selectors) via the pure `deriveRerunReadiness` helper, from the
      // SAME authorities the run-comparison gate consults: successful
      // run_analysis facts in the prior-fact chain and the freshness verdict.
      // Prior-facts (not the current turn's fresh fact) is the honest source —
      // a "what changed?" comparison is answered on a SUBSEQUENT turn, when
      // this turn's run has become a prior fact, exactly matching the gate's
      // own `input.priorFacts` at routing time. Diagnostic only; the gate
      // remains the sole authority for the comparison itself.
      const rerunReadiness: FrameRerunReadiness = deriveRerunReadiness(
        context.prior_facts,
        freshness.freshness,
      );
      try {
        frameForRun = buildFrame({
          freshness,
          canonicalState: canonicalStateForRun,
          canonicalStateSource: 'turn_executor',
          recentChanges: projectRecentChangesToFrame(
            contextPackForLog.recent_changes,
          ),
          graphCounts: summariseGraphCounts(effectiveTurnGraph),
          // Single-sourced from the pack's ASSEMBLED conversation projection
          // (capped at CONTEXT_PACK_RECENT_TURNS_CAP), same rule as
          // recentChanges: the frame reports what the turn actually reasoned
          // over, never the uncapped store total — an uncapped count would
          // over-report context completeness to the harness (A2).
          priorTurnCount: contextPackForLog.conversation.recent_turns.length,
          // Track 2 — the SAME shared const the ContextPack received at ORIENT
          // (agreement by construction), plus the redacted counts-only pending
          // observability block (never gated by the kill-switch; `threaded`
          // records the flag state). The commit-time lifecycle tally is merged
          // in here (post-commit) when this path committed; absent otherwise.
          pendingConfirmation: pendingConfirmationForTurn,
          pending: pendingLifecycleForRun
            ? { ...pendingDiagnosticsForTurn, lifecycle: pendingLifecycleForRun }
            : pendingDiagnosticsForTurn,
          rerunReadiness,
          // Mission 1 — chip IDS from the ALREADY-composed response (ids
          // only; the builder never sees SuggestedAction objects, so
          // labels/messages structurally cannot cross into the frame).
          chipsEmitted: (response?.suggested_actions ?? []).map((a) => a.id),
        });
      } catch {
        // Never block the response on frame construction (mirrors the
        // `_timings` decoration belt above). Every input expression is total
        // today; if a future change breaks that, the frame is honestly absent
        // and the route falls back to the pre-frame diagnostic path — a
        // throw here would otherwise escape the executor on the error
        // translators' own finalise path.
        frameForRun = undefined;
      }
    }
    return {
      response,
      analysisReady: analysisReadyForTurn,
      ...(turnOutcome ? { turn_outcome: turnOutcome } : {}),
      ...(freshness ? { freshness } : {}),
      ...(coachingDelivery ? { coachingDelivery } : {}),
      // V5 read-only canonical state for the route's flag-gated redacted
      // context-summary diagnostic. Present on execute turns (post-dispatch
      // assembly) AND non-execute turns (the finalise fallback above); absent
      // only on early exits before routing freshness is derived (route-v2 then
      // falls back to its partial freshness-only state).
      ...(canonicalStateForRun ? { canonicalState: canonicalStateForRun } : {}),
      // T4 Slice 2: the once-per-turn canonical frame (see above). Absent ⇒
      // honest "not observed"; route consumers fall back to the partial path.
      ...(frameForRun ? { frame: frameForRun } : {}),
      // Authoritative per-turn graph for the wire egress sanitiser (route-v2),
      // so wire label resolution matches the durable-text scrub at commit.
      effectiveGraph: effectiveTurnGraph,
      // ROADMAP 1.42 — VERBATIM reasoning captured from the routing call
      // (flag-gated, see `capturedReasoning` above). NEVER attached to
      // `response` — route-v2 attaches it to the wire envelope as a
      // post-egress-validation sidecar.
      ...(capturedReasoning ? { reasoning: capturedReasoning } : {}),
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

  /**
   * Build the safe failure-path freshness summary surfaced via the
   * turn-debug store. Reads only closure variables that are guaranteed
   * to be in scope at routing-error time (no raw prompt content; no
   * user message text).
   */
  function buildFailureFreshnessSummary(): TurnDebugFreshnessSummary | undefined {
    const freshnessVerdict = freshness;
    const analysisStatus = contextPackForLog?.analysis?.status;
    const leadingOptionPresent = !!contextPackForLog?.analysis?.leading_option;
    if (!freshnessVerdict && !analysisStatus && !contextPackForLog) {
      return undefined;
    }
    const summary: TurnDebugFreshnessSummary = {
      ...(freshnessVerdict ? { freshness: freshnessVerdict.freshness } : {}),
      ...(freshnessVerdict ? { freshness_reason: freshnessVerdict.reason } : {}),
      ...(analysisStatus ? { analysis_status: analysisStatus } : {}),
      leading_option_present: leadingOptionPresent,
    };
    return summary;
  }

  /**
   * Deterministic bounded-recovery copy + chips — freshness-conditional
   * four-way (fresh / stale-but-present / unknown-but-present / none),
   * documented in full on `commitBoundedRoutingFallback` below. Extracted
   * (CEE_ANSWER_TEXT_REQUIRED lane) so the routing schema-repair-failure
   * fallback AND the compose-layer empty-answer guard on coach/converse
   * turns (STEP 6.7, coach/converse branches) share ONE copy/chip source
   * instead of two copies drifting apart. Pure function of the closured
   * `contextPackForLog` / `freshness` turn state — no side effects.
   *
   * Overnight-review F7 (PR #397 left this split incomplete): freshness
   * `'unknown'` — hash derivation genuinely FAILED this turn (e.g. the
   * persisted graph could not be hashed; `freshness.ts`'s
   * `current_graph_hash_unavailable` / `legacy_fact_missing_hash` paths) —
   * is authority-parity DISTINCT from `'stale'` (hashes compared and
   * differ; the model is KNOWN to have changed). Lumping them let this
   * helper assert "the model has changed" on an `unknown` turn, a claim
   * this code cannot actually support. Split below mirrors the doctrine
   * already codified for the explain/no-op surfaces (`no-op-helpers.ts`'s
   * `buildAnalysisUnconfirmedTemplate`, threaded through
   * `stale-rerun-guard.ts`): `unknown` gets an honest
   * can't-confirm-currency framing, never a change assertion.
   */
  function buildBoundedFallbackCopyAndChips(): {
    assistantText: string;
    chips: SuggestedAction[];
    analysisFreshAndAvailable: boolean;
  } {
    const hasAnalysisProjection =
      !!contextPackForLog?.analysis &&
      !!contextPackForLog.analysis.leading_option;
    const freshnessVerdict = freshness?.freshness;
    const isFresh = freshnessVerdict === 'fresh';
    const isUnknown = freshnessVerdict === 'unknown';
    const analysisFreshAndAvailable = hasAnalysisProjection && isFresh;
    const analysisUnknownButPresent = hasAnalysisProjection && isUnknown;
    // Freshness null/undefined (never computed this turn) stays bucketed
    // here alongside confirmed `stale`, matching pre-existing behaviour —
    // this fix only carves the confirmed-`unknown` verdict out of that
    // bucket, per the F7 finding's scope.
    const analysisStaleButPresent =
      hasAnalysisProjection && !isFresh && !isUnknown;
    // Copy contract (review P1 follow-up; F7 adds the unknown row):
    //   - fresh prior analysis   → reassure that it is still usable
    //   - stale prior analysis   → hashes differ: name the change, invite a rerun
    //   - unknown prior analysis → currency unconfirmed: do NOT assert a
    //                              change, invite a rerun to be sure
    //   - no prior analysis      → invite a retry without implying state
    // No "recommendation", no raw IDs, no decimals (forbidden-phrase
    // guard still backstops at the finaliser).
    let assistantText: string;
    if (analysisFreshAndAvailable) {
      assistantText =
        "I couldn't complete that turn cleanly, but your current analysis is still available.";
    } else if (analysisStaleButPresent) {
      assistantText =
        "I couldn't complete that turn cleanly. The model has changed since the last analysis, so the cached results may be out of date — re-run analysis to see the current picture.";
    } else if (analysisUnknownButPresent) {
      assistantText =
        "I couldn't complete that turn cleanly, and I can't confirm whether your current analysis is up to date — re-run analysis to be sure.";
    } else {
      assistantText =
        "I couldn't complete that turn cleanly. Try again, or rephrase what you'd like to do.";
    }
    const runAnalysisChip: SuggestedAction = {
      id: 'chip_action_run_analysis_retry',
      label: 'Re-run analysis',
      message: 'Run the analysis',
      action_type: 'run_analysis',
    };
    const explainResultsChip: SuggestedAction = {
      id: 'chip_action_explain_results',
      label: 'Explain results',
      message: 'Explain the result',
      action_type: 'explain_results',
    };
    // Chip rule:
    //   fresh   → Explain results + Re-run analysis (both safe)
    //   stale   → Re-run analysis only (Explain would surface stale results)
    //   unknown → Re-run analysis only (same conservative choice as stale —
    //             Explain would surface possibly-stale results, and
    //             currency cannot be confirmed)
    //   none    → no action chips
    let chips: SuggestedAction[];
    if (analysisFreshAndAvailable) {
      chips = [explainResultsChip, runAnalysisChip];
    } else if (analysisStaleButPresent || analysisUnknownButPresent) {
      chips = [runAnalysisChip];
    } else {
      chips = [];
    }
    // ROADMAP 1.20(b) chip-sameness guard (overnight review F2). This
    // builder is reached by the STEP 7 unconditional empty-answer backstop
    // and the CEE_ANSWER_TEXT_REQUIRED compose guard, independently of the
    // coach/converse `generateChips` call sites that already thread
    // `recentlyOfferedChipIds()` — without this, a chip offered on the
    // immediately-prior turn (e.g. `chip_action_explain_results`) is
    // mechanically re-offered here on the very next turn if it blanks its
    // answer, the exact defect class the guard closed elsewhere. An honest
    // empty set beats an identical repeat.
    const recentlyOffered = recentlyOfferedChipIds();
    chips = chips.filter((chip) => !recentlyOffered.has(chip.id));
    return { assistantText, chips, analysisFreshAndAvailable };
  }

  /**
   * Bounded routing-failure fallback (V5 P0 stabilisation).
   *
   * Builds a deterministic direct_answer envelope + recovery chips and
   * commits it via the normal direct_answer commit path. This converts
   * model-output failures (max_tokens / empty_response / schema_repair_failed)
   * from a 500 BoundaryError into a 200 OlumiResponse so the user's
   * session and prior analysis stay usable. failure_type telemetry still
   * records the underlying cause via `failureType` + `routingErrorCause`
   * so ops can chase the upstream signal.
   *
   * Copy + chips: see `buildBoundedFallbackCopyAndChips` above.
   */
  async function commitBoundedRoutingFallback(
    err: RoutingError,
  ): Promise<TurnExecutorRunResult> {
    failureType = INTERNAL_TO_WIRE.LLM_SCHEMA_VIOLATION;
    const { assistantText, chips, analysisFreshAndAvailable } =
      buildBoundedFallbackCopyAndChips();
    const fallbackResponse = composeDirectAnswerResponse({
      assistant_text: assistantText,
      stage: context.stage,
      suggested_actions: chips,
    });
    sonnetTextForLog = fallbackResponse.assistant_text;
    resolvedTurnClass = 'direct_answer';
    intentClass = 'converse';
    responseTypeForObs = 'direct_answer';
    stagesCompleted.push('compose');
    emit(TelemetryEvents.V5RoutingBoundedFallback, {
      request_id: requestId,
      scenario_id: context.session_id,
      routing_error_cause: err.cause,
      llm_calls_used: llmCallsUsed,
      analysis_ready: analysisFreshAndAvailable, // finaliser-exempt: telemetry payload field, not the response envelope analysis_ready slot
      analysis_freshness: freshness?.freshness ?? null,
    });
    // recordFailureContext fires at the top of translateRoutingError for
    // every routing-error cause, including this bounded-fallback path.
    try {
      const committed = await commitTurn(fallbackResponse, {
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
        {
          event: 'v5.state_commit_failed',
          request_id: requestId,
          session_id: context.session_id,
          path: 'bounded_routing_fallback',
          err: serialiseError(error),
        },
        'V5 TurnExecutor commit failure on bounded routing fallback',
      );
      response = buildFailureResponse(
        'LLM_SCHEMA_VIOLATION',
        context.stage,
        { phase: 'orient', routing_error_cause: err.cause },
        recoveryCtx(err.cause),
      );
    }
    return finalizeRun();
  }

  async function translateRoutingError(
    err: RoutingError,
  ): Promise<TurnExecutorRunResult> {
    routingErrorCause = err.cause;
    recordFailureContext(requestId, context.session_id, {
      route_failure_type: err.cause,
      freshness_summary: buildFailureFreshnessSummary(),
    });
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
        // V5 P0 stabilisation — bounded routing-failure fallback.
        // Model-output failures (max_tokens, empty response, schema repair
        // exhausted) used to surface as HTTP 500 with LLM_UNAVAILABLE,
        // losing the user's session entirely. The recovery copy + chips
        // below degrade to a deterministic direct_answer envelope with
        // HTTP 200 so the prior analysis remains usable. failure_type
        // telemetry still records LLM_SCHEMA_VIOLATION so ops can chase
        // the underlying upstream cause.
        return commitBoundedRoutingFallback(err);
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
        // P1.1 follow-up — fatal handler path: `outcome: 'fatal'`. This
        // emit fires only for cause-kinds OUTSIDE
        // `RECOVERABLE_HANDLER_CAUSES` (commit, plot_*, scenario,
        // contract-mismatch, handler-result-invalid). Recoverable
        // cause-kinds short-circuit at the recoverable branch above.
        outcome: 'fatal',
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

/**
 * V5 P0.2 — build a factor_id → {cap, unit} lookup from the persisted
 * (raw ingress) graph's `observed_state`, for the flip-threshold proposal
 * producer's model→user-scale inversion. Defensive: tolerates an
 * unknown/partial graph shape and returns undefined for unknown factors.
 */
function buildFactorNodeLookup(
  persistedGraph: unknown,
): (factorId: string) => FactorNodeInfo | undefined {
  const map = new Map<string, FactorNodeInfo>();
  const nodes =
    persistedGraph && typeof persistedGraph === 'object'
      ? (persistedGraph as { nodes?: unknown }).nodes
      : undefined;
  if (Array.isArray(nodes)) {
    for (const n of nodes) {
      if (!n || typeof n !== 'object') continue;
      const node = n as Record<string, unknown>;
      const id = typeof node.id === 'string' ? node.id : null;
      if (!id) continue;
      const obs =
        node.observed_state && typeof node.observed_state === 'object'
          ? (node.observed_state as Record<string, unknown>)
          : null;
      map.set(id, {
        cap: obs && typeof obs.cap === 'number' ? obs.cap : null,
        unit: obs && typeof obs.unit === 'string' ? obs.unit : null,
      });
    }
  }
  return (factorId) => map.get(factorId);
}
