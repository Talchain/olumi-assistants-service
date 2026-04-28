/**
 * V5 deterministic chip-click dispatch for run_analysis.
 *
 * When the UI sends a chip_click with action_type 'run_analysis', we bypass
 * Sonnet routing entirely — the user explicitly asked for analysis, there's
 * no classification ambiguity. Route-v2.ts detects this shape BEFORE
 * TurnExecutor and calls this dispatcher.
 *
 * Scope (per v5-handler-surface brief Task 4):
 *   - ONLY source === 'chip_click' + chip.action_type === 'run_analysis'.
 *   - source === 'chip' (inline chip metadata on a regular message) falls
 *     through to TurnExecutor normally.
 *   - Other chip.action_type values (set_factor_value, explain_result,
 *     etc.) fall through to TurnExecutor, which already returns a typed
 *     FEATURE_NOT_ENABLED via the existing UNSUPPORTED_ACTION path
 *     (v5-exclusive-cee P0 follow-up).
 *
 * Why reinvoke the registered handler rather than TurnExecutor? TurnExecutor
 * runs ORIENT (1 Sonnet call) even for an already-classified chip click.
 * That's wasted latency and tokens when the action is known. The handler
 * registry entry is the same one TurnExecutor would dispatch to post-
 * routing — we just skip steps 1-2 of the seven-step assembly and go
 * straight to EXECUTE. COMMIT and COMPOSE still fire below.
 *
 * LLM semantics: this path makes NO Sonnet classification call. The
 * `run_analysis` handler itself does NOT call Sonnet either, but its
 * decision_review enricher (V5 Group 1 Task B) MAY make one LLM call.
 * Tests that assert "no Sonnet routing" should spy on routeWithToolUse
 * (not on the LLM adapter globally).
 */

import type { MessageTurnPayload, OlumiResponse } from '@talchain/schemas/boundary';

import { log } from '../../utils/telemetry.js';
import { commitDirectAnswer, computeRequestHash } from '../commit.js';
import { composeToolCallResponse } from '../compose.js';
import {
  buildTurnContext,
  loadScenarioSnapshotForRunAnalysis,
} from '../build-turn-context.js';
import type { GraphV3T } from '../../schemas/cee-v3.js';
import { computeStructuralReadiness } from '../../orchestrator/tools/analysis-ready-helper.js';
import type { AnalysisReadyPayload } from '../compose/analysis-ready-emit.js';
import {
  createRegistry,
  getDefaultPlotClient,
  resolveHandler,
  type HandlerRegistry,
  type RunAnalysisScenarioSnapshot,
  type ScenarioReader,
} from '../tools/registry.js';
import { HANDLER_VALIDATION_REGISTRY } from '../routing/validation-registry.js';
import { enrichRunAnalysisWithDecisionReview } from '../coaching/decision-review-enricher.js';
import {
  HandlerInvocationFailedError,
  HandlerResultInvalidError,
} from '../tools/handler-errors.js';

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
    }
  | { readonly outcome: 'commit_failed'; readonly response: OlumiResponse; readonly commitPerformed: false; readonly analysisReady?: undefined }
  | {
      readonly outcome: 'handler_failure';
      readonly response: OlumiResponse;
      readonly commitPerformed: false;
      readonly causeKind: string;
      readonly retryable: boolean;
      readonly analysisReady?: undefined;
    }
  | {
      readonly outcome: 'handler_result_invalid';
      readonly response: OlumiResponse;
      readonly commitPerformed: false;
      readonly analysisReady?: undefined;
    };

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
      });
    } catch (err) {
      // Mirror TurnExecutor's catch ladder so chip-click errors surface
      // with the same typed granularity as Sonnet-routed errors.
      if (err instanceof HandlerInvocationFailedError) {
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
        };
      }
      throw err;
    }

    // Decision_review enrichment — same behaviour as TurnExecutor's EXECUTE
    // branch for run_analysis (V5 Group 1 Task B). Non-blocking; enricher
    // internally guards its own timeout and never throws.
    const enrichedFacts = await enrichRunAnalysisWithDecisionReview({
      handlerFacts: outcome.handler_facts,
      requestId,
      scenarioId: context.session_id,
      signal: turnAbort.signal,
      brief: null,
    });

    // Compose the response using the same composer TurnExecutor uses. The
    // chip-click confirmation template comes from the handler's registered
    // validation-registry declaration.
    const decl = HANDLER_VALIDATION_REGISTRY.run_analysis;
    const confirmationText = typeof decl?.confirmation_template === 'function'
      ? decl.confirmation_template(outcome)
      : (decl?.confirmation_template ?? outcome.assistant_text);
    const response = composeToolCallResponse({
      orientation: '',  // no Sonnet orientation on chip clicks.
      confirmation: confirmationText,
      coaching: null,
      stage: payload.stage,
      handlerFacts: enrichedFacts,
    });

    log.info(
      {
        event: 'v5_fact_chain_commit',
        request_id: requestId,
        scenario_id: payload.scenario_id,
        turn_id: payload.turn_id,
        turn_class: 'handler',
        handler_id: 'run_analysis',
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
      return { outcome: 'ok', response, commitPerformed: true, analysisReady };
    } catch (err) {
      log.error(
        {
          request_id: requestId,
          scenario_id: payload.scenario_id,
          err: err instanceof Error ? { name: err.name, message: err.message } : { message: String(err) },
        },
        'V5 chip_click run_analysis dispatch — commit failed',
      );
      return { outcome: 'commit_failed', response, commitPerformed: false };
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
