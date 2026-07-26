/**
 * V5 deterministic chip-click dispatch.
 *
 * When the UI sends a chip_click whose `action_type` is in the
 * `DETERMINISTIC_CHIP_ACTION_TYPES` whitelist, we bypass Sonnet routing
 * entirely — the user explicitly asked for the action, there's no
 * classification ambiguity. Route-v2.ts detects this shape BEFORE
 * TurnExecutor and calls `dispatchDeterministicChipClick`.
 *
 * Whitelisted action_types:
 *   - `run_analysis`     — heavyweight NO-LLM compute handler,
 *                          scenario-snapshot pre-load
 *
 * F2 CHANGE A: `explain_results` and `what_would_flip` are NO LONGER
 * whitelisted. As explanation intents they must reach the coach LLM with the
 * loaded conversation window, so they now fall through to TurnExecutor with a
 * FORCED explanation intent (see `DETERMINISTIC_CHIP_ACTION_TYPES` below).
 *
 * Other chip.action_type values (set_factor_value, explain_result alias,
 * explain_results, what_would_flip, compare_options, etc.) fall through to
 * TurnExecutor, which either routes via Sonnet ORIENT (explanation intents are
 * pinned by `chipClickForcedIntent`) or returns a typed FEATURE_NOT_ENABLED via
 * the existing UNSUPPORTED_ACTION path.
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
import { composeToolCallResponse, type AnswerKind } from '../compose.js';
import {
  buildTurnContext,
  loadScenarioSnapshotForRunAnalysis,
} from '../build-turn-context.js';
import type { GraphV3T } from '../../schemas/cee-v3.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { extractGraphOptionIds } from '../context/option-identity.js';
import {
  deriveAnalysisFreshness,
  emitFreshnessTelemetry,
  selectRunAnalysisFact,
} from '../context/freshness.js';
// T1 claim safety — READ the verdict the run_analysis handler stamped on the
// fact. This file never derives it (CLAUDE.md trap #12).
import { readMayNameLeadingOptionFromResult } from '../../orchestrator/context/constraint-feasibility.js';
import { GraphStateIngressSchema } from '../boundary/request-extensions.js';
import { computeStructuralReadiness } from '../../orchestrator/tools/analysis-ready-helper.js';
import type { AnalysisReadyPayload } from '../compose/analysis-ready-emit.js';
import { collectInterventionControlledFactorIds } from '../context/intervention-controlled-drivers.js';
import {
  createRegistry,
  getDefaultPlotClient,
  resolveHandler,
  type HandlerRegistry,
  type RunAnalysisScenarioSnapshot,
  type ScenarioReader,
} from '../tools/registry.js';
import { HANDLER_VALIDATION_REGISTRY } from '../routing/validation-registry.js';
import { applyCoachingSignal } from '../coaching/coaching-signal-application.js';
import { enrichRunAnalysisWithDecisionReview } from '../coaching/decision-review-enricher.js';
import type { V5TurnTimings } from '../telemetry/turn-timings.js';
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
// F2 CHANGE A (2026-07-22) — `explain_results` and `what_would_flip` REMOVED
// from this whitelist. They are now routed through the conversation-aware coach
// path (route-v2 `detectChipClickForcedIntent` → TurnExecutor
// `chipClickForcedIntent` → `routeWithToolUse` with a FORCED explanation
// handler + thinking disabled) so the pill answer sees the loaded conversation
// window instead of composing canned deterministic prose with zero LLM sight of
// what the user just said. `run_analysis` STAYS — it is a genuine no-LLM compute
// handler, not an explanation, so bypassing Sonnet for it is correct (and is
// pinned by the test below). The deterministic composers
// (`composeExplainResultsFallback` / `composeWhatWouldFlipFallback`) remain
// wired as the ROUTED fallback (turn-executor), so the honesty guarantees are
// unchanged — the coach authors the prose when its `answer_text` is valid, the
// deterministic composer serves it otherwise.
export const DETERMINISTIC_CHIP_ACTION_TYPES: ReadonlySet<V5ActionType> = new Set<V5ActionType>([
  'run_analysis',
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
      /** ROADMAP 2.73 Fix C — decision_review call attribution for the
       *  chip-click path (mirrors #476's executor wiring). Present ONLY
       *  when the timings/trace gate is on AND the enricher's LLM call
       *  actually RETURNED (sink populated) — never fabricated for a
       *  skip / timeout. route-v2 threads it into sendFinalised200 so the
       *  minimal diagnostic trace carries the decision_review llm_calls
       *  entry, matching the routed path. */
      readonly turnTimings?: V5TurnTimings;
      /**
       * ROADMAP 1.132 (F1) — the declared SUBSTANTIVE/FUNCTIONAL kind of this
       * chip-click answer (see `AnswerKind`). `'substantive'` for the
       * explain_results / what_would_flip explanations (progressive disclosure at
       * egress); `'functional'` for the run_analysis receipt. route-v2 threads it
       * into `sendFinalised200` so the egress synthesiser shapes the substantive
       * chip answers exactly as it shapes the turn_executor advice-gate answers.
       */
      readonly answerKind?: AnswerKind;
      /**
       * T1 claim safety — may THIS chip-click turn name a leading option?
       *
       * The run_analysis chip runs a real analysis, so this path can withhold
       * the leading-option claim exactly as the routed path can. READ from the
       * stamp the run_analysis handler persisted on the fact; never re-derived
       * (CLAUDE.md trap #12). route-v2 threads it into `sendFinalised200` so the
       * layer-3 egress guard is armed on this path too — the coaching slot
       * defect (#709) reached the wire through a dispatch path that had been
       * overlooked, and the two paths must not drift again.
       */
      readonly mayNameLeadingOption?: boolean;
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
 * Whitelist contract: `DETERMINISTIC_CHIP_ACTION_TYPES` has exactly ONE
 * member — `run_analysis`. It is a genuine no-LLM compute handler (not an
 * explanation), so bypassing Sonnet is correct; it keeps its heavyweight code
 * path (scenario-snapshot pre-load, decision_review enrichment, single-source-
 * of-truth analysisReady derivation).
 *
 * The analytical pills `explain_results` / `what_would_flip` are NO LONGER
 * dispatched here (F2 CHANGE A, 2026-07-22 — see the whitelist declaration
 * above). They are owned by the conversation-aware coach via TYPED FORCED
 * INTENT (route-v2 `detectChipClickForcedIntent` → TurnExecutor
 * `chipClickForcedIntent` → `routeWithToolUse` with a forced explanation
 * handler + thinking disabled), with the deterministic composers
 * (`composeExplainResultsFallback` / `composeWhatWouldFlipFallback`) serving
 * as the routed BOUNDED FALLBACK when the coach's `answer_text` is invalid.
 * No lightweight explanation path exists in this dispatcher any more.
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
  // Unreachable: the guard above rejects every action_type except the sole
  // whitelisted `run_analysis`, which returns in the branch above. Retained as a
  // defensive throw so a future whitelist expansion fails loud here rather than
  // silently falling through to an undefined dispatch.
  throw new Error(
    `dispatchDeterministicChipClick: unhandled whitelisted action_type '${actionType}'`,
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
        answerKind: 'functional',
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
    answerKind: 'functional',
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
    // ROADMAP 2.73 Fix C — decision_review call attribution parity with the
    // executor path (#476). Gated exactly like the executor's sink: flag-off
    // production passes no sink and allocates one empty object + one ternary,
    // byte-identical behaviour otherwise.
    const timingsEnabled =
      config.cee.timingDebugEnabled || config.features.diagnosticTraceEnabled;
    let chipTurnTimings: V5TurnTimings | undefined;
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
      // Wall-clock the await on the caller's clock and thread the call's
      // model/tokens back via callTelemetrySink — the same #476 pattern the
      // executor uses. The sink is populated ONLY when the LLM call
      // RETURNED; a skip / timeout leaves it empty, so no phantom
      // decision_review llm_calls entry is ever fabricated.
      const decisionReviewStartedAt = timingsEnabled ? Date.now() : 0;
      const callTelemetrySink: {
        model?: string;
        provider?: string;
        input_tokens?: number;
        output_tokens?: number;
      } = {};
      enrichedFacts = await enrichRunAnalysisWithDecisionReview({
        handlerFacts: outcome.handler_facts,
        requestId,
        scenarioId: context.session_id,
        signal: turnAbort.signal,
        brief: context.scenarioBriefText,
        ...(timingsEnabled ? { callTelemetrySink } : {}),
        // D-ask-1 (2.11 P0-1) — P1-2: same scaffolded-placeholder
        // disclosure threading as the turn-executor decision-review block —
        // the review must never narrate placeholder numbers as user data.
        ...(outcome.__scaffolded_options !== undefined
          ? { scaffoldedOptions: outcome.__scaffolded_options }
          : {}),
      });
      if (timingsEnabled && callTelemetrySink.model !== undefined) {
        chipTurnTimings = {
          decision_review_ms: Date.now() - decisionReviewStartedAt,
          decision_review_model: callTelemetrySink.model,
          decision_review_provider: callTelemetrySink.provider,
          decision_review_input_tokens: callTelemetrySink.input_tokens,
          decision_review_output_tokens: callTelemetrySink.output_tokens,
        };
      }
    }

    // ROADMAP 2.73 Fix A — STEP-5 coaching signal on the chip-click run
    // path, via the SAME shared helper the turn-executor uses (this path
    // previously composed `coaching: null` hardcoded, so a chip-driven
    // first run or rerun shipped zero coaching prose by construction).
    // contextPack is null on this path — the run_analysis branch signals
    // never consult it. The returned facts carry the signal marker on the
    // run_analysis fact and MUST be the array that chips/compose/commit see.
    const coachingApplication = applyCoachingSignal({
      proposedHandlerId: 'run_analysis',
      outcome,
      contextPack: null,
      priorFacts: context.prior_facts,
      handlerFacts: enrichedFacts,
      requestId,
      scenarioId: context.session_id,
      // Same collector + raw-graph source the freshness derivation below
      // uses (snapshot first, turn-context fallback on the test path).
      interventionControlledFactorIds: collectInterventionControlledFactorIds(
        cachedSnapshot?.rawPersistedGraph ?? context.persistedGraph,
      ),
    });
    enrichedFacts = coachingApplication.handlerFacts;

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
      // D-ask-1 (2.11 P0-1): scaffolded-placeholder disclosure channel —
      // same threading as the routed path, so a chip-click run that only
      // completed on disclosed defaults offers the configure chip first.
      ...(outcome.__scaffolded_options !== undefined
        ? { scaffoldedOptions: outcome.__scaffolded_options }
        : {}),
    });

    // Compose the response using the same composer TurnExecutor uses. The
    // chip-click confirmation template comes from the handler's registered
    // validation-registry declaration.
    const decl = HANDLER_VALIDATION_REGISTRY.run_analysis;
    const confirmationText = typeof decl?.confirmation_template === 'function'
      ? decl.confirmation_template(outcome)
      : (decl?.confirmation_template ?? outcome.assistant_text);
    // Review F1 — hash gate for the compose fallback. On this path the
    // snapshot passed below is the EXACT object the handler hashed into
    // `graph_hash_at_run` (one-shot reader, no second DB read), so the
    // fact's own hash gates the fallback open by construction; passing it
    // keeps the compose-side gate uniform with the routed path (where the
    // handler and the turn context read the graph separately).
    const composedRunFact = enrichedFacts.find(
      (f) => f.fact_type === 'run_analysis',
    );
    const composedRunFactGraphHash =
      composedRunFact !== undefined &&
      composedRunFact.fact_type === 'run_analysis' &&
      typeof composedRunFact.result.graph_hash_at_run === 'string'
        ? composedRunFact.result.graph_hash_at_run
        : null;
    let response = composeToolCallResponse({
      answerKind: 'functional',
      orientation: '',  // no Sonnet orientation on chip clicks.
      confirmation: confirmationText,
      // ROADMAP 2.73 Fix A — was `coaching: null` hardcoded; the chip run
      // path now joins the shared STEP-5 signal text (FIRST_ANALYSIS_COMPLETE
      // on a first run, RERUN_ANALYSIS_COMPLETE with the compareRuns delta on
      // a rerun) exactly as the routed path does.
      coaching: coachingApplication.coachingText,
      stage: payload.stage,
      handlerFacts: enrichedFacts,
      suggested_actions: chipClickSuggestedActions,
      // R4 lookup fix — persisted-snapshot fallback for graph-node
      // ID→{label,kind} resolution (Phase 3 target_refs + the flag-gated
      // ui_directive). The snapshot is the SAME reference the handler ran
      // against (single-source-of-truth pre-load above); on the injected-
      // registry test path fall back to the turn context's persisted graph.
      persistedGraph: cachedSnapshot?.rawPersistedGraph ?? context.persistedGraph,
      persistedGraphHash: composedRunFactGraphHash,
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
      const freshness = deriveAnalysisFreshness(
        postDispatchFacts,
        currentGraphHash,
        // Option-identity guard (CEE_OPTION_IDENTITY_FRESHNESS_GUARD): read
        // option IDs from the RAW persisted graph (covers the unparseable case
        // the hash skips). undefined when off → byte-identical.
        config.cee.optionIdentityFreshnessGuard
          ? extractGraphOptionIds(cachedSnapshot?.rawPersistedGraph ?? null)
          : undefined,
      );
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

      return {
        outcome: 'ok',
        response,
        commitPerformed: true,
        analysisReady,
        graph: snapshotGraph,
        freshness,
        // Fix C: present only when the decision_review LLM call returned
        // under an enabled timings/trace gate (never fabricated).
        ...(chipTurnTimings !== undefined ? { turnTimings: chipTurnTimings } : {}),
        // ROADMAP 1.132 (F1) — the run_analysis chip response is a receipt +
        // coaching blocks, not a prose answer: functional (stays plain).
        answerKind: 'functional' as AnswerKind,
        // T1 claim safety — READ off the just-produced run_analysis fact, using
        // the SAME canonical selector the routed path uses. Never re-derived
        // (CLAUDE.md trap #12). No fact ⇒ `true` (this turn withheld nothing);
        // a fact with no stamp ⇒ `readMayNameLeadingOption` fails CLOSED.
        mayNameLeadingOption: ((): boolean => {
          const selected = selectRunAnalysisFact([...enrichedFacts, ...context.prior_facts]);
          if (selected === null) return true;
          return selected.fact.fact_type === 'run_analysis'
            ? readMayNameLeadingOptionFromResult(selected.fact.result)
            : true;
        })(),
      };
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
