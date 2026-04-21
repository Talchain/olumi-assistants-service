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
import { buildTurnContext } from '../build-turn-context.js';
import {
  getDefaultRegistry,
  resolveHandler,
  type HandlerRegistry,
} from '../tools/registry.js';
import { HANDLER_VALIDATION_REGISTRY } from '../routing/validation-registry.js';
import { enrichRunAnalysisWithDecisionReview } from '../coaching/decision-review-enricher.js';

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

export interface DispatchChipClickRunAnalysisResult {
  readonly response: OlumiResponse;
  readonly commitPerformed: boolean;
}

export async function dispatchChipClickRunAnalysis(
  params: DispatchChipClickRunAnalysisParams,
): Promise<DispatchChipClickRunAnalysisResult> {
  const { payload, requestId, handlerRegistry } = params;
  const startedAt = Date.now();

  // Build the turn context using the same builder TurnExecutor uses, so the
  // handler invocation is indistinguishable from a Sonnet-routed call.
  const context = await buildTurnContext(payload, requestId);

  const registry = handlerRegistry ?? getDefaultRegistry();
  const handlerFn = resolveHandler(registry, 'run_analysis');
  if (!handlerFn) {
    // Safety net — the default registry registers run_analysis. If that
    // invariant breaks, surface honestly via a commit-false result.
    log.error(
      { request_id: requestId },
      'V5 chip_click dispatch — run_analysis handler missing from registry',
    );
    return {
      response: composeToolCallResponse({
        orientation: '',
        confirmation: 'Could not run analysis — handler not available.',
        coaching: null,
        stage: payload.stage,
        handlerFacts: [],
      }),
      commitPerformed: false,
    };
  }

  const turnAbort = new AbortController();
  const turnTimer = setTimeout(() => turnAbort.abort(), context.budgets.turn_ms);

  try {
    const outcome = await handlerFn({
      context,
      payload,
      requestId,
      signal: turnAbort.signal,
    });

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
      return { response, commitPerformed: true };
    } catch (err) {
      log.error(
        {
          request_id: requestId,
          scenario_id: payload.scenario_id,
          err: err instanceof Error ? { name: err.name, message: err.message } : { message: String(err) },
        },
        'V5 chip_click run_analysis dispatch — commit failed',
      );
      return { response, commitPerformed: false };
    }
  } finally {
    clearTimeout(turnTimer);
  }
}
