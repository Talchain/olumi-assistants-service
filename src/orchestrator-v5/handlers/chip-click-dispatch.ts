/**
 * V5 deterministic chip-click dispatch.
 *
 * When the UI sends a chip_click whose `action_type` is in the
 * `DETERMINISTIC_CHIP_ACTION_TYPES` whitelist, we bypass Sonnet routing
 * entirely — the user explicitly asked for the action, there's no
 * classification ambiguity. Route-v2.ts detects this shape BEFORE
 * TurnExecutor and calls `dispatchDeterministicChipClick`.
 *
 * Whitelisted action_types (Phase 2b):
 *   - `run_analysis`     — heavyweight handler, scenario-snapshot pre-load
 *   - `explain_results`  — V5 no-op explanation handler (deterministic
 *                          fallback prose composed from prior analysis fact)
 *   - `what_would_flip`  — V5 no-op explanation handler (deterministic
 *                          fallback prose composed from prior analysis fact)
 *
 * Other chip.action_type values (set_factor_value, explain_result alias,
 * compare_options, etc.) fall through to TurnExecutor, which either routes
 * via Sonnet ORIENT or returns a typed FEATURE_NOT_ENABLED via the
 * existing UNSUPPORTED_ACTION path.
 *
 * Why reinvoke the registered handler rather than TurnExecutor? TurnExecutor
 * runs ORIENT (1 Sonnet call, ~12s) even for an already-classified chip
 * click. That's wasted latency and tokens when the action is known. The
 * handler registry entry is the same one TurnExecutor would dispatch to
 * post-routing — we just skip steps 1-2 of the seven-step assembly and go
 * straight to EXECUTE. COMMIT and COMPOSE still fire below.
 *
 * Trade-off for the V5 explanation handlers (`explain_results`,
 * `what_would_flip`): on the chip-click path the handler does NOT receive
 * Sonnet's `explanation.answer_text`, so it always uses the deterministic
 * fallback (`composeExplainResultsFallback` / `composeWhatWouldFlipFallback`)
 * sourced from the prior `run_analysis` handler-fact projection. We
 * pre-populate `analysisProjection` from prior facts, plus
 * `analysisFreshness` and `analysisReady`, so the precondition decision
 * tree (`decideExplanationPrecondition`) reads the same signals it would
 * have seen on the routed path. Net effect: faster, deterministic prose
 * instead of Sonnet's per-turn answer text — acceptable per the Phase 2b
 * brief because chip clicks are explicit user signals.
 *
 * LLM semantics: this path makes NO Sonnet classification call. The
 * `run_analysis` handler itself does NOT call Sonnet either, but its
 * decision_review enricher (V5 Group 1 Task B) MAY make one LLM call.
 * The explanation handlers make zero LLM calls on the chip-click path.
 * Tests that assert "no Sonnet routing" should spy on routeWithToolUse
 * (not on the LLM adapter globally).
 */

import type { MessageTurnPayload, OlumiResponse, StageType } from '@talchain/schemas/boundary';
import type { HandlerFact, V5ActionType } from '@talchain/schemas/orchestrator';

import { config } from '../../config/index.js';
import { emit, log, TelemetryEvents } from '../../utils/telemetry.js';
import { applyEgressForbiddenPhraseGuard } from '../compose/forbidden-user-facing-phrases.js';
import { commitDirectAnswer, computeRequestHash } from '../commit.js';
import { composeToolCallResponse } from '../compose.js';
import {
  buildTurnContext,
  loadScenarioSnapshotForRunAnalysis,
  type EnrichedTurnContext,
} from '../build-turn-context.js';
import type { GraphV3T } from '../../schemas/cee-v3.js';
import { GraphV3 } from '../../schemas/cee-v3.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import {
  deriveAnalysisFreshness,
  emitFreshnessTelemetry,
  type FreshnessDerivation,
} from '../context/freshness.js';
import { GraphStateIngressSchema } from '../boundary/request-extensions.js';
import { computeStructuralReadiness } from '../../orchestrator/tools/analysis-ready-helper.js';
import type { AnalysisReadyPayload } from '../compose/analysis-ready-emit.js';
import { buildAnalysisFromPriorFacts } from '../context/analysis-fallback.js';
import { buildAnalysisProjectionSummary } from '../context/projection-summaries.js';
import type { AnalysisResponseSummary } from '../../orchestrator/context/analysis-compact.js';
import { projectTopDrivers } from '../context/context-pack-assembler.js';
import {
  createRegistry,
  getDefaultPlotClient,
  getDefaultRegistry,
  resolveHandler,
  type HandlerFn,
  type HandlerRegistry,
  type RunAnalysisScenarioSnapshot,
  type ScenarioReader,
} from '../tools/registry.js';
import { HANDLER_VALIDATION_REGISTRY } from '../routing/validation-registry.js';
import { enrichRunAnalysisWithDecisionReview } from '../coaching/decision-review-enricher.js';
import {
  pickLatestRawRobustness,
  type RawRobustnessSignals,
} from '../coaching/pick-raw-robustness.js';
import { pickLatestFlipSummary } from '../coaching/pick-flip-summary.js';
import type { FlipSummary } from '../compose/flip-proposal.js';
import { generateChips } from '../compose/chip-generator.js';
import {
  HandlerInvocationFailedError,
  HandlerResultInvalidError,
} from '../tools/handler-errors.js';
// V5 C5 — chip-click recoverable-cause escape repair. Reuse the SAME recovery
// machinery the Sonnet/TurnExecutor path uses (no parallel recovery system).
import { isRecoverableHandlerCause } from '../compose/recoverable-handler-causes.js';
import { composeRecoverableHandlerResponse } from '../compose/recoverable-handler-response.js';
import type { ComposeContext } from '../compose/types.js';

/**
 * Note on ingress state (graphState / analysisState):
 * The run_analysis handler reads its scenario state via the injected
 * `scenarioReader` (see createRunAnalysisHandler in tools/handlers/
 * run-analysis.ts) — NOT from the HTTP request body. A chip-click
 * payload does not need to thread graph_state or analysis_state into
 * the handler; passing them here would have been dead weight and
 * invited drift between ingress state and the scenario-read truth.
 * This interface therefore does not accept those fields. If a future
 * handler DOES need ingress-state passthrough, add the fields then,
 * not now.
 */
export interface DispatchChipClickRunAnalysisParams {
  readonly payload: MessageTurnPayload;
  readonly requestId: string;
  /** Injectable registry for tests. Production uses the default singleton. */
  readonly handlerRegistry?: HandlerRegistry;
}

/**
 * Phase 2b — set of chip `action_type` values that bypass LLM routing.
 *
 * Membership criteria for inclusion:
 *   1. The `action_type` is a registered V5 handler ID (see
 *      `tools/registry.ts`'s `createRegistry`). Aliases like the
 *      singular `'explain_result'` are NOT included — chip-emitter
 *      surfaces the registered ID directly.
 *   2. The handler can produce a useful answer without Sonnet's
 *      pre-classified `explanation.answer_text`. The V5 explanation
 *      handlers fall back to a deterministic projection-based composer
 *      when `invocation.explanation` is absent — so they qualify.
 *      Mutation handlers (set_factor_value, etc.) require validated
 *      proposal parameters from the routing layer and must NOT be
 *      whitelisted here.
 *   3. The required handler input context (prior_facts, projection,
 *      freshness, readiness) can be reconstructed from the scenario
 *      snapshot + persisted facts WITHOUT a Sonnet call.
 *
 * If a future handler is whitelisted, validate per the brief's stop
 * conditions: re-check that the routing-layer fields it consumes
 * (`analysisProjection`, `analysisFreshness`, `analysisReady`,
 * `explanation`) are EITHER unused OR can be pre-populated honestly
 * from local state — otherwise the chip-click path will silently
 * degrade UX.
 */
export const DETERMINISTIC_CHIP_ACTION_TYPES: ReadonlySet<V5ActionType> = new Set<V5ActionType>([
  'run_analysis',
  'explain_results',
  'what_would_flip',
]);

/**
 * Predicate guard: is the supplied chip `action_type` whitelisted for
 * deterministic dispatch? Used by route-v2's gate so a single source of
 * truth governs which chip clicks bypass TurnExecutor.
 */
export function isDeterministicChipClickActionType(actionType: string): boolean {
  return DETERMINISTIC_CHIP_ACTION_TYPES.has(actionType as V5ActionType);
}

/**
 * Richer-than-boolean failure carrier. On commit success the discriminator
 * is 'ok'. On typed handler failure it is 'handler_failure' — the route
 * maps these to specific BoundaryError codes (e.g. FEATURE_NOT_ENABLED
 * for unreachable-upstream cases) rather than collapsing everything into
 * INTERNAL_ERROR. This mirrors TurnExecutor's handling of
 * HandlerInvocationFailedError / HandlerResultInvalidError and keeps the
 * chip-click path observationally consistent with the Sonnet-routed path.
 *
 * V5 finaliser contract: every variant declares an optional `analysisReady`
 * for type uniformity at the route-v2.ts call site. Chip-click does not
 * mutate the canvas — the user clicked "Run analysis" on the existing
 * graph — but Step 5 of the V5 golden path needs the wire response from
 * Step 4 (the run_analysis chip-click) to carry `analysis_ready` so the
 * model's gating logic sees a runnability signal.
 *
 * Single-source-of-truth: the `ok` outcome derives structural readiness
 * from the SAME `GraphV3T` reference the run_analysis handler operated
 * on. The dispatcher pre-loads the scenario snapshot once via
 * `loadScenarioSnapshotForRunAnalysis` and injects a one-shot
 * `ScenarioReader` returning that exact snapshot — handler invocation
 * and post-handler readiness derivation share the same in-memory graph
 * reference, so a concurrent edit-graph dispatch from another session
 * cannot drift the emission. Failure outcomes leave `analysisReady`
 * undefined; in route-v2.ts those map to BoundaryError 500 anyway.
 */
export type DispatchChipClickRunAnalysisResult =
  | {
      readonly outcome: 'ok';
      readonly response: OlumiResponse;
      readonly commitPerformed: true;
      readonly analysisReady?: AnalysisReadyPayload;
      /** Snapshot graph for label resolution by central egress sanitiser. */
      readonly graph: GraphV3T | null;
      /** V5 state-trust freshness derivation. Post-dispatch — uses the
       *  just-produced run_analysis fact and the snapshot graph so the
       *  rerun chip-click wire response carries `freshness === 'fresh'`. */
      readonly freshness?: import('../context/freshness.js').FreshnessDerivation;
    }
  | { readonly outcome: 'commit_failed'; readonly response: OlumiResponse; readonly commitPerformed: false; readonly analysisReady?: undefined; readonly graph: GraphV3T | null }
  | {
      readonly outcome: 'handler_failure';
      readonly response: OlumiResponse;
      readonly commitPerformed: false;
      readonly causeKind: string;
      readonly retryable: boolean;
      readonly analysisReady?: undefined;
      readonly graph: GraphV3T | null;
    }
  | {
      // V5 C5 — recoverable handler cause (RECOVERABLE_HANDLER_CAUSES, e.g.
      // options_not_configured when an added option is not yet configured for
      // analysis). The dispatcher composes a clean graceful body via the SAME
      // composeRecoverableHandlerResponse machinery the Sonnet path uses;
      // route-v2 maps this to a 200 (NOT the handler_failure → 500 path).
      // `commitPerformed:false` — no analysis ran and no graph mutated, so
      // `analysisReady` is omitted and the UI retains its prior store value,
      // exactly as for the other failure outcomes.
      readonly outcome: 'handler_recovered';
      readonly response: OlumiResponse;
      readonly commitPerformed: false;
      readonly causeKind: string;
      readonly analysisReady?: undefined;
      readonly graph: GraphV3T | null;
    }
  | {
      readonly outcome: 'handler_result_invalid';
      readonly response: OlumiResponse;
      readonly commitPerformed: false;
      readonly analysisReady?: undefined;
      readonly graph: GraphV3T | null;
    };

/**
 * V5 C5 — chip-click recoverable-cause escape repair.
 *
 * Mirrors TurnExecutor's handler-recovery branch (turn-executor.ts) for the
 * chip-click dispatch path. A handler invocation that fails with a RECOVERABLE
 * cause (`RECOVERABLE_HANDLER_CAUSES` — e.g. `options_not_configured` when an
 * added option is not yet configured for analysis) composes a clean graceful
 * body via the SAME `composeRecoverableHandlerResponse` machinery, so route-v2
 * can return a 200 instead of mapping the failure to a 500 BoundaryError.
 *
 * Cause-gated by the SHARED `isRecoverableHandlerCause` predicate (same locked
 * set as the Sonnet path — the two cannot diverge on which causes recover).
 * Returns `null` for FATAL causes so the caller keeps the existing
 * `handler_failure` → 500 behaviour, and `null` on the impossible-state
 * `fallback` template (cause on the recoverable list but no composer branch),
 * matching TurnExecutor's fail-loud-to-500 guard. The recoverable response
 * carries coaching text + a recovery chip; it never claims the option was
 * configured and never sets `analysis_ready`.
 */
function tryComposeRecoverableChipOutcome(
  err: HandlerInvocationFailedError,
  graph: GraphV3T | null,
  stage: StageType,
  requestId: string,
  scenarioId: string,
  aborted: boolean,
): Extract<DispatchChipClickRunAnalysisResult, { outcome: 'handler_recovered' }> | null {
  // Budget-abort precedence (parity with TurnExecutor's
  // `turnAbort.signal.aborted && isRecoverableHandlerCause(...)` short-circuit):
  // if the turn budget already aborted, a recoverable cause MUST fail loud
  // rather than be masked as a graceful recovery. NB only the FAIL-LOUD
  // precedence is shared — the chip path surfaces this as the existing
  // handler_failure → 500 (INTERNAL_ERROR, chip_click_run_analysis_handler_failed);
  // it deliberately does NOT reproduce TurnExecutor's BUDGET_EXCEEDED wire
  // classification (that would mean a new route outcome, out of scope). A
  // timed-out turn is a degraded outcome, not a clean "needs configuration"
  // recovery, so it must not emit a graceful body or recovery telemetry.
  if (aborted) return null;
  if (!isRecoverableHandlerCause(err.cause_kind)) return null;

  // ComposeContext is unused by composeRecoverableHandlerResponse today (the
  // body comes from the shared per-cause composer), but the signature requires
  // it; pass the canonical validation registry the Sonnet path uses.
  const recoveryCtx: ComposeContext = { handlerRegistry: HANDLER_VALIDATION_REGISTRY };
  const recovered = composeRecoverableHandlerResponse(err, recoveryCtx, stage);

  // Impossible-state guard — the cause is on the recoverable list but the
  // composer has no per-cause branch (template_id === 'fallback'). That is a
  // code bug, not a runtime fault: fall through to the fatal 500 path so the
  // gap is visible, mirroring TurnExecutor.
  if (recovered.template_id === 'fallback') {
    log.error(
      {
        event: 'assert_recoverable_handler_fallback',
        request_id: requestId,
        scenario_id: scenarioId,
        cause_kind: err.cause_kind,
      },
      'V5 chip_click hit recoverable composer fallback — cause on recoverable list but no template; returning typed failure (500)',
    );
    return null;
  }

  log.warn(
    {
      request_id: requestId,
      scenario_id: scenarioId,
      cause_kind: err.cause_kind,
      retryable: err.retryable,
      recoverable: true,
    },
    'V5 chip_click handler invocation failed — recoverable',
  );

  // Recovery telemetry — same cross-layer event the Sonnet path emits, so a
  // single `v5.recovery_response` query finds recoveries across both layers.
  emit(TelemetryEvents.RecoveryResponse, {
    request_id: requestId,
    scenario_id: scenarioId,
    failure_origin: 'handler',
    handler_cause_kind: err.cause_kind,
    template_used: recovered.template_id,
    chip_type: recovered.chip_type,
    chip_count: recovered.response.suggested_actions.length,
    retryable: err.retryable,
  });

  return {
    outcome: 'handler_recovered',
    response: recovered.response,
    commitPerformed: false,
    causeKind: err.cause_kind,
    graph,
  };
}

/**
 * Phase 2b — top-level dispatch entry point.
 *
 * Resolves the whitelisted handler from the registry and invokes it. Throws
 * synchronously when `actionType` is not in the whitelist — callers (route-v2)
 * gate on `isDeterministicChipClickActionType` first, so reaching this with
 * an unwhitelisted value is a programming error rather than a runtime drift.
 *
 * Branching: `run_analysis` keeps its existing heavyweight code path
 * (scenario-snapshot pre-load, decision_review enrichment, single-source-of-
 * truth analysisReady derivation). The V5 no-op explanation handlers
 * (`explain_results`, `what_would_flip`) flow through a lightweight path
 * that pre-populates `analysisProjection` / `analysisFreshness` /
 * `analysisReady` from prior facts so the handler's precondition decision
 * tree reads the same signals it would have seen on the routed path.
 */
export async function dispatchDeterministicChipClick(
  actionType: string,
  params: DispatchChipClickRunAnalysisParams,
): Promise<DispatchChipClickRunAnalysisResult> {
  if (!DETERMINISTIC_CHIP_ACTION_TYPES.has(actionType as V5ActionType)) {
    throw new Error(
      `dispatchDeterministicChipClick: action_type '${actionType}' is not whitelisted ` +
        `(allowed: ${Array.from(DETERMINISTIC_CHIP_ACTION_TYPES).join(', ')})`,
    );
  }
  if (actionType === 'run_analysis') {
    return dispatchChipClickRunAnalysis(params);
  }
  // Whitelist invariant: the only remaining action types here are the V5
  // no-op explanation handlers. The cast is tightened against the static
  // whitelist; an unhandled future addition will fail the dispatch path's
  // exhaustiveness inside `dispatchChipClickNoopExplanation` rather than
  // silently falling through.
  return dispatchChipClickNoopExplanation(
    actionType as 'explain_results' | 'what_would_flip',
    params,
  );
}

export async function dispatchChipClickRunAnalysis(
  params: DispatchChipClickRunAnalysisParams,
): Promise<DispatchChipClickRunAnalysisResult> {
  const { payload, requestId, handlerRegistry } = params;
  const startedAt = Date.now();

  // Build the turn context using the same builder TurnExecutor uses, so the
  // handler invocation is indistinguishable from a Sonnet-routed call.
  const context = await buildTurnContext(payload, requestId);

  // V5 finaliser contract — single-source-of-truth for the scenario graph.
  //
  // Pre-load the scenario snapshot ONCE here. The handler invocation uses
  // a one-shot scenarioReader that returns this exact cached snapshot, and
  // post-handler readiness derivation reads `snapshot.graph` from the same
  // reference. This guarantees `computeStructuralReadiness` operates on
  // the exact GraphV3T the handler operated on — eliminating any
  // TOCTOU window where a concurrent edit-graph dispatch from another
  // session could change the persisted record between two separate reads.
  //
  // Test path: if `handlerRegistry` is injected, the test owns the
  // scenarioReader contract. We skip the production pre-load AND the
  // post-handler readiness derivation in that case (tests assert
  // analysis_ready surfacing via their own injection seam).
  let cachedSnapshot: RunAnalysisScenarioSnapshot | null = null;
  let snapshotLoadError: unknown = null;
  if (!handlerRegistry) {
    try {
      cachedSnapshot = await loadScenarioSnapshotForRunAnalysis(
        payload.scenario_id,
        requestId,
      );
    } catch (err) {
      // Persistence read failed. Cache the error so the handler invocation
      // re-throws it inside the registered ScenarioReader catch ladder,
      // producing the same `HandlerInvocationFailedError('scenario_read_failed')`
      // the production DEFAULT_SCENARIO_READER would have produced. We
      // surface the load failure with a structured warning so the original
      // baseline regression (analysis_ready missing) cannot recur as an
      // unobservable false negative — the `analysis_ready_missing_reason`
      // field tells operators exactly why the wire field is absent.
      snapshotLoadError = err;
      log.warn(
        {
          request_id: requestId,
          scenario_id: payload.scenario_id,
          analysis_ready_missing_reason: 'snapshot_load_failed',
          err: err instanceof Error ? { name: err.name, message: err.message } : { message: String(err) },
        },
        'V5 chip_click run_analysis — pre-handler snapshot load failed; analysis_ready will be omitted',
      );
    }
  }

  const oneShotReader: ScenarioReader = async () => {
    if (snapshotLoadError) throw snapshotLoadError;
    if (!cachedSnapshot) {
      // Defensive — should not be reachable in production (either snapshot
      // loaded or error was cached). If the test path supplies a registry,
      // this reader is never consulted.
      throw new Error('V5 chip_click run_analysis — no cached snapshot');
    }
    return cachedSnapshot;
  };

  // Graph for the central egress sanitiser. Same single-source-of-truth
  // contract as `cachedSnapshot.graph` used for readiness derivation
  // (loadScenarioSnapshotForRunAnalysis already runs GraphV3.safeParse).
  // Null on the test path or when snapshot load failed — sanitiser then
  // falls back to prefix-aware generic wording.
  const snapshotGraph: GraphV3T | null = (cachedSnapshot?.graph as GraphV3T | undefined) ?? null;

  // Reuse the memoised default PLoT client so per-call registry
  // construction does not also construct a fresh PLoTClientImpl (which
  // holds undici dispatchers). The handler swap we need here is the
  // ScenarioReader, not the PLoT transport.
  const registry =
    handlerRegistry ??
    createRegistry({
      scenarioReader: oneShotReader,
      plotClient: getDefaultPlotClient(),
    });
  const handlerFn = resolveHandler(registry, 'run_analysis');
  if (!handlerFn) {
    // Safety net — the default registry registers run_analysis. If that
    // invariant breaks, surface honestly via a commit-false result.
    log.error(
      { request_id: requestId },
      'V5 chip_click dispatch — run_analysis handler missing from registry',
    );
    return {
      outcome: 'commit_failed',
      response: composeToolCallResponse({
        orientation: '',
        confirmation: 'Could not run analysis. The analysis service is temporarily unavailable.',
        coaching: null,
        stage: payload.stage,
        handlerFacts: [],
      }),
      commitPerformed: false,
      graph: snapshotGraph,
    };
  }

  const turnAbort = new AbortController();
  const turnTimer = setTimeout(() => turnAbort.abort(), context.budgets.turn_ms);

  // Response skeleton used for typed-failure paths where the handler never
  // produced a usable outcome.
  const failureResponse = composeToolCallResponse({
    orientation: '',
    confirmation: 'Analysis could not complete.',
    coaching: null,
    stage: payload.stage,
    handlerFacts: [],
  });

  try {
    let outcome;
    try {
      outcome = await handlerFn({
        context,
        payload,
        requestId,
        signal: turnAbort.signal,
        // Chip-click bypasses the routing layer, so there is no Sonnet
        // orientation text to forward. Pass empty string; the run_analysis
        // handler does not read this field, and the field is required by
        // the HandlerInvocation contract added in 0.9.0 to support the
        // V5 no-op handlers (which are never invoked via chip-click).
        orientationText: '',
        // proposal is also absent on the chip-click path — see HandlerInvocation
        // JSDoc; the field is optional precisely for this dispatch.
      });
    } catch (err) {
      // Mirror TurnExecutor's catch ladder so chip-click errors surface
      // with the same typed granularity as Sonnet-routed errors.
      if (err instanceof HandlerInvocationFailedError) {
        // V5 C5 — recoverable causes (e.g. options_not_configured) compose a
        // graceful 200 via the shared machinery instead of a 500. Cause-gated,
        // and budget-gated (an aborted turn fails loud, parity with TurnExecutor).
        // Fatal/aborted causes fall through to the handler_failure → 500 path.
        const recovered = tryComposeRecoverableChipOutcome(
          err,
          snapshotGraph,
          payload.stage,
          requestId,
          payload.scenario_id,
          turnAbort.signal.aborted,
        );
        if (recovered) return recovered;
        log.warn(
          {
            request_id: requestId,
            scenario_id: payload.scenario_id,
            cause_kind: err.cause_kind,
            retryable: err.retryable,
            message: err.message,
          },
          'V5 chip_click run_analysis — handler invocation failed (typed)',
        );
        return {
          outcome: 'handler_failure',
          response: failureResponse,
          commitPerformed: false,
          causeKind: err.cause_kind,
          retryable: err.retryable,
          graph: snapshotGraph,
        };
      }
      if (err instanceof HandlerResultInvalidError) {
        log.error(
          {
            request_id: requestId,
            scenario_id: payload.scenario_id,
            message: err.message,
          },
          'V5 chip_click run_analysis — handler result invalid',
        );
        return {
          outcome: 'handler_result_invalid',
          response: failureResponse,
          commitPerformed: false,
          graph: snapshotGraph,
        };
      }
      throw err;
    }

    // Decision_review enrichment — same behaviour as TurnExecutor's EXECUTE
    // branch for run_analysis (V5 Group 1 Task B). Non-blocking; enricher
    // internally guards its own timeout and never throws.
    //
    // V5 Phase 1 brief persistence (2026-05-02): the brief now sources
    // from canonical state (`scenarios.brief_text`) via
    // `EnrichedTurnContext.scenarioBriefText`, populated by
    // `buildTurnContext` at line 147. The previous hardcoded
    // `brief: null` made decision_review always skip with reason
    // `no_brief` on the chip-click path — independently of TurnExecutor's
    // parallel bug (defect B). Fixing both call sites atomically here.
    //
    // Latency gate (V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW): when this
    // flag is false (the default), the chip-click run_analysis path
    // skips the auto-fire so the click returns immediately on the
    // deterministic PLoT analysis. `v5.decision_review.skipped` with
    // reason `autofire_disabled` is emitted in place of the await.
    let enrichedFacts: readonly HandlerFact[];
    if (!config.cee.runAnalysisAwaitDecisionReview) {
      const briefLength =
        typeof context.scenarioBriefText === 'string'
          ? context.scenarioBriefText.length
          : 0;
      const runAnalysisFact = outcome.handler_facts.find(
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
      enrichedFacts = outcome.handler_facts;
    } else {
      enrichedFacts = await enrichRunAnalysisWithDecisionReview({
        handlerFacts: outcome.handler_facts,
        requestId,
        scenarioId: context.session_id,
        signal: turnAbort.signal,
        brief: context.scenarioBriefText,
      });
    }

    // V5 coaching parity — emit the same post-analysis suggested_actions
    // the Sonnet-routed run_analysis path emits. Reuses the existing
    // `generateChips` rule so chip-click and routed turns produce
    // identical chip sets, including (when the current-turn
    // decision_review enrichment carries a usable `specific_action`) the
    // "What should we validate?" prompt chip.
    //
    // Honesty contract preserved from PR #190: `handlerFacts` is the
    // current turn's `enrichedFacts` ONLY — no `priorFacts` rescue. If
    // the current run_analysis has no usable
    // decision_review.evidence_enhancements[].specific_action, the
    // validation chip is suppressed.
    //
    // Other inputs:
    //   - `analysis: null` — the post-run_analysis branch in
    //     `generateChipsRaw` does not read this field; chip-click does
    //     not build a `ContextPackAnalysis` projection. Passing null is
    //     safe and matches the production-rule chip the post-run_analysis
    //     branch emits (executable explain_results + what_would_flip).
    //   - `priorFacts` — threaded so any future cross-turn rules in the
    //     chip generator stay consistent with the routed path.
    //   - `analysisReady` — omitted; the post-run_analysis branch does
    //     not consult readiness. The `analysisReady` derived after
    //     commit below remains the authoritative wire-emit source.
    //   - `validationRegistry` — required for executable-chip
    //     registry-presence validation (existing chip-generator contract).
    const chipClickSuggestedActions = generateChips({
      stage: payload.stage,
      handlerFacts: enrichedFacts,
      priorFacts: context.prior_facts,
      analysis: null,
      validationRegistry: HANDLER_VALIDATION_REGISTRY,
    });

    // Compose the response using the same composer TurnExecutor uses. The
    // chip-click confirmation template comes from the handler's registered
    // validation-registry declaration.
    const decl = HANDLER_VALIDATION_REGISTRY.run_analysis;
    const confirmationText = typeof decl?.confirmation_template === 'function'
      ? decl.confirmation_template(outcome)
      : (decl?.confirmation_template ?? outcome.assistant_text);
    let response = composeToolCallResponse({
      orientation: '',  // no Sonnet orientation on chip clicks.
      confirmation: confirmationText,
      coaching: null,
      stage: payload.stage,
      handlerFacts: enrichedFacts,
      suggested_actions: chipClickSuggestedActions,
    });

    // V5 stale-aware explain recovery — finaliser-level egress guard.
    // Runs as the LAST step before the chip-click response is
    // committed, so it backstops the confirmation template + any
    // future fallback copy. An upstream hook would miss new emit
    // paths added later; the finaliser hook cannot. See
    // FORBIDDEN_USER_FACING_PHRASES for the contradiction list.
    {
      const guarded = applyEgressForbiddenPhraseGuard(response.assistant_text ?? '');
      if (guarded.rewritten) {
        emit(TelemetryEvents.V5EgressForbiddenPhraseDetected, {
          request_id: requestId,
          scenario_id: payload.scenario_id,
          phrase: guarded.hit,
          dispatch_path: 'chip_click_finalise',
        });
        response = { ...response, assistant_text: guarded.text };
      }
    }

    log.info(
      {
        event: 'v5_fact_chain_commit',
        request_id: requestId,
        scenario_id: payload.scenario_id,
        turn_id: payload.turn_id,
        turn_class: 'handler',
        handler_id: 'run_analysis',
        action_type: 'run_analysis',
        raw_handler_fact_count: outcome.handler_facts.length,
        enriched_handler_fact_count: enrichedFacts.length,
        has_raw_run_analysis_fact: outcome.handler_facts.some(
          (f) => f.fact_type === 'run_analysis',
        ),
        has_enriched_run_analysis_fact: enrichedFacts.some(
          (f) => f.fact_type === 'run_analysis',
        ),
      },
      'V5 chip-click: run_analysis fact persistence pre-commit',
    );
    log.debug(
      {
        event: 'v5_fact_chain_commit_detail',
        request_id: requestId,
        scenario_id: payload.scenario_id,
        turn_id: payload.turn_id,
        action_type: 'run_analysis',
        raw_fact_types: outcome.handler_facts.map((f) => f.fact_type),
        enriched_fact_types: enrichedFacts.map((f) => f.fact_type),
      },
      'V5 chip-click: run_analysis fact persistence pre-commit (verbose)',
    );

    try {
      await commitDirectAnswer(response, {
        scenario_id: payload.scenario_id,
        turn_id: payload.turn_id,
        turn_class: 'handler',
        handler_id: 'run_analysis',
        request_hash: computeRequestHash(payload),
        llm_calls_used: outcome.llm_calls_used,
        duration_ms: Date.now() - startedAt,
        handler_facts: enrichedFacts,
        // V5 Stage 2B-1b: persist the turn-start (pre-dispatch) coaching snapshot.
        coaching_state: context.coaching_state,
        // V5 Conversation Context Reliability: persist the user's turn text;
        // the assistant answer auto-derives from `response.assistant_text`.
        userMessage: payload.message,
        // Same GraphV3T the egress sanitiser uses for this turn — resolves
        // entity-id labels in the stored assistant answer so stored == wire.
        contentGraph: snapshotGraph,
      });
      // V5 finaliser contract: derive readiness from the SAME GraphV3T
      // reference the run_analysis handler operated on (the cached
      // snapshot). Single-source-of-truth — no second read, no TOCTOU
      // window. When the test path injects a custom registry,
      // cachedSnapshot is null by design (tests own the readiness
      // emission via their own seam) and we skip the derivation.
      const analysisReady = cachedSnapshot
        ? deriveAnalysisReadyFromSnapshot(cachedSnapshot, requestId, payload.scenario_id)
        : undefined;

      // V5 state-trust: derive freshness POST-dispatch using the just-
      // produced run_analysis fact + prior chain, against the snapshot
      // graph. The chip-click rerun path is the user's escape hatch from
      // a stale verdict — its wire response MUST report fresh.
      const postDispatchFacts: readonly HandlerFact[] = [
        ...enrichedFacts,
        ...context.prior_facts,
      ];
      // Hash from the RAW persisted graph (parsed via GraphStateIngressSchema,
      // the same parser turn-executor uses on follow-up explain turns).
      // snapshot.graph is V3-parsed and snapshot.options is the PLoT-
      // projection — neither matches what turn-executor sees, so hashing
      // either would surface false-stale. See run-analysis.ts §3.5 for
      // the canonical explanation.
      let currentGraphHash: string | null = null;
      if (
        cachedSnapshot?.rawPersistedGraph !== undefined &&
        cachedSnapshot?.rawPersistedGraph !== null
      ) {
        const parsedForHash = GraphStateIngressSchema.safeParse(
          cachedSnapshot.rawPersistedGraph,
        );
        if (parsedForHash.success) {
          currentGraphHash = computeAnalysisAffectingGraphHash(parsedForHash.data);
        }
      }
      const freshness = deriveAnalysisFreshness(postDispatchFacts, currentGraphHash);
      emitFreshnessTelemetry(
        freshness,
        {
          request_id: requestId,
          scenario_id: payload.scenario_id,
          dispatch_path: 'chip_click_run_analysis',
        },
        {
          prior_fact_count: context.prior_facts.length,
          current_turn_fact_count: enrichedFacts.length,
        },
      );

      return { outcome: 'ok', response, commitPerformed: true, analysisReady, graph: snapshotGraph, freshness };
    } catch (err) {
      log.error(
        {
          request_id: requestId,
          scenario_id: payload.scenario_id,
          err: err instanceof Error ? { name: err.name, message: err.message } : { message: String(err) },
        },
        'V5 chip_click run_analysis dispatch — commit failed',
      );
      return { outcome: 'commit_failed', response, commitPerformed: false, graph: snapshotGraph };
    }
  } finally {
    clearTimeout(turnTimer);
  }
}

function deriveAnalysisReadyFromSnapshot(
  snapshot: RunAnalysisScenarioSnapshot,
  requestId: string,
  scenarioId: string,
): AnalysisReadyPayload | undefined {
  // `loadScenarioSnapshotForRunAnalysis` already runs the persisted graph
  // through `GraphV3.safeParse` and only returns successfully when parse
  // succeeds, so `snapshot.graph` is a valid GraphV3T. The cast is safe.
  const readiness = computeStructuralReadiness(snapshot.graph as GraphV3T);
  if (!readiness) {
    // computeStructuralReadiness returns undefined when no goal node
    // exists — a structural state that legitimately blocks readiness
    // emission. Surface it as an observable signal so the original
    // baseline regression (analysis_ready missing on Step 4) cannot
    // recur as an unobservable false negative.
    log.warn(
      {
        request_id: requestId,
        scenario_id: scenarioId,
        analysis_ready_missing_reason: 'no_goal_node',
      },
      'V5 chip_click run_analysis — computeStructuralReadiness returned undefined; analysis_ready omitted',
    );
  }
  return readiness;
}

// ---------------------------------------------------------------------------
// Phase 2b — V5 no-op explanation chip-click dispatch
// ---------------------------------------------------------------------------
//
// `explain_results` and `what_would_flip` are deterministic no-op handlers:
// they templated their output from prior `run_analysis` facts (precondition-
// fail templates when no analysis exists, deterministic prose otherwise).
// On the routed path the handler additionally consumes Sonnet's
// `explanation.answer_text` when valid — but the chip-click path does not
// produce one (no LLM call). The handler's existing `composeExplain*Fallback`
// composers consume `analysisProjection` directly, so we pre-populate that
// (plus `analysisFreshness` and `analysisReady`) and the precondition decision
// tree behaves identically to the routed path.
//
// What we do NOT replicate from TurnExecutor:
//   - Sonnet's `explanation.answer_text` (the whole point of the bypass)
//   - `structureProjection` (only `explain_from_structure` reads it; not
//     in the whitelist)
//   - `proposal` (no LLM proposal — handler ignores when absent)
//   - `graphForTurn` / `mutated_graph` (explanation handlers don't mutate)
//   - `enrichRunAnalysisWithDecisionReview` (only run_analysis facts get
//     enriched; the explanation handlers produce their own fact type)

const NOOP_EXPLANATION_DISPATCH_PATH = {
  explain_results: 'chip_click_explain_results',
  what_would_flip: 'chip_click_what_would_flip',
} as const;

const NOOP_EXPLANATION_FAILURE_TEXT = {
  explain_results: 'I could not produce an explanation.',
  what_would_flip: 'I could not produce a sensitivity summary.',
} as const;

async function dispatchChipClickNoopExplanation(
  actionType: 'explain_results' | 'what_would_flip',
  params: DispatchChipClickRunAnalysisParams,
): Promise<DispatchChipClickRunAnalysisResult> {
  const { payload, requestId, handlerRegistry } = params;
  const startedAt = Date.now();

  // Same builder TurnExecutor uses — gives prior_facts (the precondition's
  // input), persistedGraph (for the freshness hash), and budgets.turn_ms
  // (for the abort signal).
  const context = await buildTurnContext(payload, requestId);

  // Pick the handler from the registry. Production uses the singleton; tests
  // inject their own mocked registry via `params.handlerRegistry`.
  const registry = handlerRegistry ?? getDefaultRegistry();
  const handlerFn: HandlerFn | null = resolveHandler(registry, actionType);
  if (!handlerFn) {
    log.error(
      { request_id: requestId, action_type: actionType },
      'V5 chip_click dispatch — explanation handler missing from registry',
    );
    return {
      outcome: 'commit_failed',
      response: composeToolCallResponse({
        orientation: '',
        confirmation: NOOP_EXPLANATION_FAILURE_TEXT[actionType],
        coaching: null,
        stage: payload.stage,
        handlerFacts: [],
      }),
      commitPerformed: false,
      graph: null,
    };
  }

  // Reconstruct the routing-layer fields the handler expects so its
  // precondition decision tree behaves identically to the routed path.
  // None of these calls hits the network or makes an LLM call.
  const projectionInputs = buildProjectionInputs(context, payload, requestId);

  const turnAbort = new AbortController();
  const turnTimer = setTimeout(() => turnAbort.abort(), context.budgets.turn_ms);

  const failureResponse = composeToolCallResponse({
    orientation: '',
    confirmation: NOOP_EXPLANATION_FAILURE_TEXT[actionType],
    coaching: null,
    stage: payload.stage,
    handlerFacts: [],
  });

  try {
    let outcome;
    try {
      outcome = await handlerFn({
        context,
        payload,
        requestId,
        signal: turnAbort.signal,
        orientationText: '',
        // No Sonnet `explanation.answer_text` on this path — the handler's
        // deterministic fallback composer kicks in. See handler impl.
        analysisReady: projectionInputs.analysisReady,
        analysisProjection: projectionInputs.analysisProjection,
        analysisFreshness: projectionInputs.analysisFreshness,
        // Raw robustness signals so the what_would_flip fallback composer
        // can suppress the "smaller changes are unlikely" sentence on
        // raw-fragile or near-tie results — same SSOT used by the
        // free-text post-analysis advice gate.
        rawRobustness: projectionInputs.rawRobustness,
        // Honest flip-threshold evidence so the what_would_flip composer
        // answers from the actual analysis (no single-factor tipping point
        // within bounds → say so) instead of contradicting it.
        flipSummary: projectionInputs.flipSummary,
      });
    } catch (err) {
      if (err instanceof HandlerInvocationFailedError) {
        // V5 C5 — same recoverable-cause escape repair as the run_analysis
        // ladder (cause-gated + budget-gated), so the two chip-click paths
        // cannot diverge on recoverability or budget precedence.
        const recovered = tryComposeRecoverableChipOutcome(
          err,
          projectionInputs.graph,
          payload.stage,
          requestId,
          payload.scenario_id,
          turnAbort.signal.aborted,
        );
        if (recovered) return recovered;
        log.warn(
          {
            request_id: requestId,
            scenario_id: payload.scenario_id,
            action_type: actionType,
            cause_kind: err.cause_kind,
            retryable: err.retryable,
            message: err.message,
          },
          'V5 chip_click explanation — handler invocation failed (typed)',
        );
        return {
          outcome: 'handler_failure',
          response: failureResponse,
          commitPerformed: false,
          causeKind: err.cause_kind,
          retryable: err.retryable,
          graph: projectionInputs.graph,
        };
      }
      if (err instanceof HandlerResultInvalidError) {
        log.error(
          {
            request_id: requestId,
            scenario_id: payload.scenario_id,
            action_type: actionType,
            message: err.message,
          },
          'V5 chip_click explanation — handler result invalid',
        );
        return {
          outcome: 'handler_result_invalid',
          response: failureResponse,
          commitPerformed: false,
          graph: projectionInputs.graph,
        };
      }
      throw err;
    }

    const decl = HANDLER_VALIDATION_REGISTRY[actionType];
    const confirmationText = typeof decl?.confirmation_template === 'function'
      ? decl.confirmation_template(outcome)
      : (decl?.confirmation_template ?? outcome.assistant_text);

    // V5 P0-B — post-explanation suggested_actions. The noop explanation
    // chip-click path previously committed `suggested_actions: []`, leaving
    // the user with no next step after a deterministic answer. Reuse the
    // SAME `generateChips` rule the run_analysis chip-click path uses so the
    // follow-ups are deterministic and honest: the generator emits genuine
    // next actions (e.g. "Explain the result", "Re-run analysis") only when a
    // rule matches, and its floor returns `[]` (`v5.chips.empty_intentional`)
    // when no safe chip applies — no filler. `analysis: null` matches the
    // run_analysis chip-click call; the post-handler branch does not read it.
    const noopSuggestedActions = generateChips({
      stage: payload.stage,
      handlerFacts: outcome.handler_facts,
      priorFacts: context.prior_facts,
      analysis: null,
      validationRegistry: HANDLER_VALIDATION_REGISTRY,
      // V5 P0-B blocker fix (Codex review): thread readiness + freshness so a
      // STALE what_would_flip / explain follow-up steers the user to the
      // "Rerun analysis" action (chip-generator stale-recovery rule + floor
      // Priority 1, both of which read `turnOutcome.analysis_freshness` +
      // `analysisReady.status`) instead of looping back into the executable
      // (stale) what_would_flip chip. Sourced from the SAME freshness/readiness
      // the precondition + wire response already use, so no second derivation.
      analysisReady: projectionInputs.analysisReady,
      turnOutcome: {
        graph_mutated: false,
        analysis_run: false,
        analysis_selected_fact_index: projectionInputs.analysisFreshness.selected_fact_index,
        analysis_freshness: projectionInputs.analysisFreshness.freshness,
        freshness_reason: projectionInputs.analysisFreshness.reason,
      },
    });

    let response = composeToolCallResponse({
      orientation: '',
      confirmation: confirmationText,
      coaching: null,
      stage: payload.stage,
      handlerFacts: outcome.handler_facts,
      suggested_actions: noopSuggestedActions,
      // PR 3 — explain/flip handlers do NOT produce a run_analysis fact,
      // so the composer's lifecycle branch 2 fires: it walks prior_facts
      // for the canonical run_analysis fact (selected by the
      // precondition's freshness derivation) and emits Phase 3 blocks
      // tagged by the verdict — fresh blocks when the graph hash still
      // matches the source fact, or a single stale-safe rerun coaching
      // block when the graph has diverged. Without this wiring the
      // explain/flip path emits zero Phase 3 blocks, dropping coaching
      // the user expects after running analysis.
      ...(projectionInputs.analysisFreshness !== undefined
        ? {
            lifecycle: {
              priorFacts: context.prior_facts,
              freshness: projectionInputs.analysisFreshness,
              requestId,
              scenarioId: payload.scenario_id,
            },
          }
        : {}),
    });

    // Same finaliser-level egress guard as the run_analysis path.
    {
      const guarded = applyEgressForbiddenPhraseGuard(response.assistant_text ?? '');
      if (guarded.rewritten) {
        emit(TelemetryEvents.V5EgressForbiddenPhraseDetected, {
          request_id: requestId,
          scenario_id: payload.scenario_id,
          phrase: guarded.hit,
          dispatch_path: 'chip_click_finalise',
        });
        response = { ...response, assistant_text: guarded.text };
      }
    }

    log.info(
      {
        event: 'v5_fact_chain_commit',
        request_id: requestId,
        scenario_id: payload.scenario_id,
        turn_id: payload.turn_id,
        turn_class: 'handler',
        handler_id: actionType,
        action_type: actionType,
        raw_handler_fact_count: outcome.handler_facts.length,
        enriched_handler_fact_count: outcome.handler_facts.length,
        has_raw_run_analysis_fact: outcome.handler_facts.some(
          (f) => f.fact_type === 'run_analysis',
        ),
        has_enriched_run_analysis_fact: outcome.handler_facts.some(
          (f) => f.fact_type === 'run_analysis',
        ),
      },
      'V5 chip-click: explanation fact persistence pre-commit',
    );

    try {
      await commitDirectAnswer(response, {
        scenario_id: payload.scenario_id,
        turn_id: payload.turn_id,
        turn_class: 'handler',
        handler_id: actionType,
        request_hash: computeRequestHash(payload),
        llm_calls_used: outcome.llm_calls_used,
        duration_ms: Date.now() - startedAt,
        handler_facts: outcome.handler_facts,
        // V5 Stage 2B-1b: persist the turn-start (pre-dispatch) coaching snapshot.
        coaching_state: context.coaching_state,
        // V5 Conversation Context Reliability: persist the user's turn text;
        // the assistant answer auto-derives from `response.assistant_text`.
        userMessage: payload.message,
        // Same GraphV3T the egress sanitiser uses for this exit
        // (`projectionInputs.graph`) — resolves entity-id labels in the stored
        // assistant answer so stored == wire.
        contentGraph: projectionInputs.graph,
      });

      // Telemetry parity with run_analysis: emit freshness so dashboards
      // continue to disaggregate by dispatch_path. Reuses the precondition's
      // freshness derivation (no second hash compute).
      emitFreshnessTelemetry(
        projectionInputs.analysisFreshness,
        {
          request_id: requestId,
          scenario_id: payload.scenario_id,
          dispatch_path: NOOP_EXPLANATION_DISPATCH_PATH[actionType],
        },
        {
          prior_fact_count: context.prior_facts.length,
          current_turn_fact_count: outcome.handler_facts.length,
        },
      );

      return {
        outcome: 'ok',
        response,
        commitPerformed: true,
        analysisReady: projectionInputs.analysisReady,
        graph: projectionInputs.graph,
        freshness: projectionInputs.analysisFreshness,
      };
    } catch (err) {
      log.error(
        {
          request_id: requestId,
          scenario_id: payload.scenario_id,
          action_type: actionType,
          err: err instanceof Error ? { name: err.name, message: err.message } : { message: String(err) },
        },
        'V5 chip_click explanation dispatch — commit failed',
      );
      return { outcome: 'commit_failed', response, commitPerformed: false, graph: projectionInputs.graph };
    }
  } finally {
    clearTimeout(turnTimer);
  }
}

interface ProjectionInputs {
  readonly analysisReady: AnalysisReadyPayload | undefined;
  // `buildAnalysisProjectionSummary` returns `AnalysisProjectionSummary | null`;
  // the HandlerInvocation contract takes `AnalysisProjectionSummary | undefined`.
  // We normalise null→undefined in the caller so handlers don't have to.
  readonly analysisProjection:
    | NonNullable<ReturnType<typeof buildAnalysisProjectionSummary>>
    | undefined;
  readonly analysisFreshness: FreshnessDerivation;
  readonly graph: GraphV3T | null;
  // Raw `enrichment.robustness` signals selected off the SAME run_analysis
  // fact as `analysisProjection`. Reused by the `what_would_flip` fallback
  // composer so chip-click copy stays as honest as the free-text advice
  // gate when robustness is raw-fragile or the result is a near-tie.
  // `null` when no successful run_analysis fact is present (the precondition
  // bypasses the composer entirely in that case).
  readonly rawRobustness: RawRobustnessSignals | null;
  // Honest flip-threshold summary from the SAME run_analysis fact. Lets the
  // what_would_flip composer answer from the flip evidence (no single-factor
  // tipping point within bounds → say so) rather than the robustness band.
  // `null` when no successful fact or the enrichment carries no flip
  // thresholds.
  readonly flipSummary: FlipSummary | null;
}

/**
 * Reconstruct the routing-layer fields the V5 explanation handlers expect,
 * using only local context (prior_facts + persistedGraph). No LLM call,
 * no PLoT call, no scenario read beyond what `buildTurnContext` already
 * performed.
 */
function buildProjectionInputs(
  context: EnrichedTurnContext,
  payload: MessageTurnPayload,
  requestId: string,
): ProjectionInputs {
  // Step 1: parse the persisted graph for readiness derivation. Fall back
  // to undefined readiness when the graph is missing or fails parse —
  // mirrors TurnExecutor's behaviour and the precondition tree's defensive
  // null-projection guard.
  let graph: GraphV3T | null = null;
  let analysisReady: AnalysisReadyPayload | undefined;
  if (context.persistedGraph !== undefined && context.persistedGraph !== null) {
    const parsed = GraphV3.safeParse(context.persistedGraph);
    if (parsed.success) {
      graph = parsed.data as GraphV3T;
      analysisReady = computeStructuralReadiness(graph);
    } else {
      log.warn(
        {
          request_id: requestId,
          scenario_id: payload.scenario_id,
          analysis_ready_missing_reason: 'graph_parse_failed',
          issue_count: parsed.error.issues.length,
        },
        'V5 chip_click explanation — persisted graph failed GraphV3 parse; analysis_ready omitted',
      );
    }
  }

  // Step 2: build the analysis projection from the most recent successful
  // (or legacy / degraded) run_analysis fact in prior_facts. The handler's
  // `decideExplanationPrecondition` reads `invocation.context.prior_facts`
  // directly to make the missing-vs-degraded distinction, so this projection
  // only needs to populate the `'execute'` branch's input.
  const optionLabelSource = graph
    ? graph.nodes
        .filter((n) => n.kind === 'option')
        .map((n) => ({ id: n.id, label: n.label ?? null }))
    : undefined;
  const analysisFromPrior: AnalysisResponseSummary | null = buildAnalysisFromPriorFacts(
    context.prior_facts,
    optionLabelSource,
  );
  // `buildAnalysisProjectionSummary` consumes `ContextPackAnalysis` (the
  // post-projection shape used inside the context-pack). On the routed
  // path that comes from `projectAnalysis` after compactAnalysis. Here
  // we map AnalysisResponseSummary → AnalysisProjectionSummary directly
  // by going through a thin contextPack-shaped intermediate, so the
  // handler reads the same field shape.
  const analysisProjection = analysisFromPrior
    ? buildAnalysisProjectionSummary({
        status: analysisFromPrior.analysis_status,
        leading_option:
          analysisFromPrior.options[0] != null
            ? {
                label: analysisFromPrior.options[0].option_label,
                probability: analysisFromPrior.options[0].win_probability,
              }
            : null,
        runner_up:
          analysisFromPrior.options[1] != null
            ? {
                label: analysisFromPrior.options[1].option_label,
                probability: analysisFromPrior.options[1].win_probability,
              }
            : null,
        margin_pp: analysisFromPrior.margin_pp ?? null,
        robustness_band:
          analysisFromPrior.robustness_level &&
          analysisFromPrior.robustness_level !== 'unknown'
            ? analysisFromPrior.robustness_level
            : null,
        // Shared with projectAnalysis via projectTopDrivers: filter non-finite,
        // neutral → 0, sort by |signed value|, cap — so a no-effect driver is
        // never left leading a "would shift the most" claim on this path.
        top_drivers: projectTopDrivers(analysisFromPrior.top_drivers),
        fragile_edges: (analysisFromPrior.top_fragile_edges ?? []).map((e) => ({
          from_label: e.from_label,
          to_label: e.to_label,
        })),
      }) ?? undefined
    : undefined;

  // Step 3: derive freshness from prior_facts + persisted-graph hash. The
  // chip-click path does not produce a new run_analysis fact, so the
  // routing-layer derivation IS the wire-bound view (no need to re-derive
  // post-dispatch the way run_analysis does).
  let currentGraphHash: string | null = null;
  if (context.persistedGraph !== undefined && context.persistedGraph !== null) {
    const parsed = GraphStateIngressSchema.safeParse(context.persistedGraph);
    if (parsed.success) {
      currentGraphHash = computeAnalysisAffectingGraphHash(parsed.data);
    }
  }
  const analysisFreshness = deriveAnalysisFreshness(context.prior_facts, currentGraphHash);

  // Step 4: raw robustness signals from the SAME run_analysis fact the
  // freshness/projection layer selected. Reused by the what_would_flip
  // composer so chip-click copy honours raw-fragile + near-tie overrides
  // the projection band may have flattened.
  const rawRobustness = pickLatestRawRobustness(context.prior_facts);

  // Step 5: honest flip-threshold summary from the SAME run_analysis fact, so
  // the what_would_flip composer answers from the flip evidence rather than a
  // robustness band that can contradict it. `null` when no flip thresholds.
  const flipSummary = pickLatestFlipSummary(context.prior_facts);

  return { analysisReady, analysisProjection, analysisFreshness, graph, rawRobustness, flipSummary };
}
