/**
 * V5 Group 1 Task B: auto-fire decision_review after a successful
 * run_analysis and attach the output to the handler fact's enrichment.
 *
 * Invariants:
 *  - Pure augmentation; never throws, never fails the turn.
 *  - Only fires for run_analysis handler facts with a non-empty v5.brief and
 *    non-empty results in the PLoT envelope. Skips (returns input unchanged)
 *    otherwise, logging a telemetry event so operators can see why.
 *  - Hard 15s timeout (DECISION_REVIEW_TIMEOUT_MS). On timeout, abort, or
 *    shape failure: returns the input facts unchanged. The analysis_result
 *    block is composed without enrichment.decision_review, and UI renders
 *    thin content exactly as today.
 *  - Writes `decision_review` under enrichment using a freshly-cloned
 *    Record<string, unknown> so PLoT-originated enrichment keys are
 *    preserved verbatim.
 */

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { DECISION_REVIEW_TIMEOUT_MS } from '../../config/timeouts.js';
import { createHash } from 'node:crypto';

import {
  invokeDecisionReview,
  type DecisionReviewInvokeInput,
} from '../../cee/decision-review/invoke.js';
import { emit, log, TelemetryEvents } from '../../utils/telemetry.js';

import type { DecisionReviewOutput } from './types.js';

export interface EnrichDecisionReviewInput {
  readonly handlerFacts: readonly HandlerFact[];
  readonly requestId: string;
  readonly scenarioId: string;
  /** Outer turn-budget abort signal. */
  readonly signal: AbortSignal;
}

type SkipReason =
  | 'no_run_analysis_fact'
  | 'no_brief'
  | 'no_results'
  | 'no_winner';

/**
 * If the facts array contains a successful run_analysis fact, invoke
 * decision_review and return a new facts array with enrichment.decision_review
 * set on the run_analysis fact. Otherwise return the input array unchanged.
 */
export async function enrichRunAnalysisWithDecisionReview(
  input: EnrichDecisionReviewInput,
): Promise<readonly HandlerFact[]> {
  const idx = input.handlerFacts.findIndex((f) => f.fact_type === 'run_analysis');
  if (idx < 0) {
    return input.handlerFacts;
  }
  const fact = input.handlerFacts[idx];
  if (fact.fact_type !== 'run_analysis') {
    return input.handlerFacts;
  }

  const enrichment = fact.result.enrichment;
  if (enrichment === undefined) {
    skipTelemetry(input, 'no_results');
    return input.handlerFacts;
  }

  const brief = readBrief(enrichment);
  if (!brief) {
    skipTelemetry(input, 'no_brief');
    return input.handlerFacts;
  }

  const invokeInput = buildInvokeInput(brief, enrichment, fact.result.leading_option_id);
  if (!invokeInput) {
    skipTelemetry(input, 'no_winner');
    return input.handlerFacts;
  }

  const childAbort = new AbortController();
  const onOuterAbort = () => childAbort.abort(input.signal.reason);
  if (input.signal.aborted) {
    childAbort.abort(input.signal.reason);
  } else {
    input.signal.addEventListener('abort', onOuterAbort, { once: true });
  }
  const hardTimer = setTimeout(() => childAbort.abort(new Error('decision_review timeout')), DECISION_REVIEW_TIMEOUT_MS);

  emit(TelemetryEvents.V5DecisionReviewInvoked, {
    request_id: input.requestId,
    scenario_id: input.scenarioId,
    brief_hash: invokeInput.brief_hash,
    timeout_ms: DECISION_REVIEW_TIMEOUT_MS,
  });

  const startedAt = Date.now();
  try {
    const result = await invokeDecisionReview(invokeInput, {
      requestId: input.requestId,
      timeoutMs: DECISION_REVIEW_TIMEOUT_MS,
      signal: childAbort.signal,
    });
    if (result.output === null) {
      emit(TelemetryEvents.V5DecisionReviewFailed, {
        request_id: input.requestId,
        scenario_id: input.scenarioId,
        reason: 'shape_extraction_failed',
        duration_ms: Date.now() - startedAt,
      });
      return input.handlerFacts;
    }

    // F.6: verbatim pass-through of the LLM output with a V5-added
    // produced_at timestamp. No field renaming, flattening, or filtering;
    // consumers read required fields defensively. Review feedback P1.2.
    //
    // Spread order: payload first, then produced_at last. The LLM output
    // must not override V5's timestamp — a collision would break the
    // cache-read gate (isDecisionReviewOutput checks produced_at is a
    // string) and could make the decision_review enrichment appear stale
    // when it isn't.
    const output: DecisionReviewOutput = {
      ...result.output,
      produced_at: new Date().toISOString(),
    };
    const patched: HandlerFact = {
      ...fact,
      result: {
        ...fact.result,
        enrichment: { ...enrichment, decision_review: output },
      },
    };
    const next = input.handlerFacts.slice();
    next[idx] = patched;
    return next;
  } catch (err) {
    emit(TelemetryEvents.V5DecisionReviewFailed, {
      request_id: input.requestId,
      scenario_id: input.scenarioId,
      reason: err instanceof Error ? err.message : 'unknown',
      duration_ms: Date.now() - startedAt,
    });
    log.warn(
      {
        request_id: input.requestId,
        scenario_id: input.scenarioId,
        err: err instanceof Error ? err.message : String(err),
      },
      'V5 decision_review auto-fire failed, degrading to thin content',
    );
    return input.handlerFacts;
  } finally {
    clearTimeout(hardTimer);
    input.signal.removeEventListener('abort', onOuterAbort);
  }
}

function readBrief(enrichment: Record<string, unknown>): string | null {
  const raw = enrichment['v5.brief'];
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

function buildInvokeInput(
  brief: string,
  enrichment: Record<string, unknown>,
  leadingOptionId: string | null,
): DecisionReviewInvokeInput | null {
  const results = readResultsArray(enrichment);
  const winner = selectWinner(results, leadingOptionId);
  if (!winner) return null;
  const runnerUp = selectRunnerUp(results, winner);

  return {
    brief,
    brief_hash: sha256(brief),
    graph: readGraph(enrichment),
    isl_results: readIslResults(enrichment),
    deterministic_coaching: readDeterministicCoaching(enrichment),
    winner,
    runner_up: runnerUp,
    flip_threshold_data: readFlipThresholdData(enrichment),
  };
}

function readResultsArray(enrichment: Record<string, unknown>): ReadonlyArray<Record<string, unknown>> {
  const raw = enrichment.results;
  if (!Array.isArray(raw)) return [];
  return raw.filter((r): r is Record<string, unknown> => r !== null && typeof r === 'object');
}

function selectWinner(
  results: ReadonlyArray<Record<string, unknown>>,
  leadingOptionId: string | null,
): DecisionReviewInvokeInput['winner'] | null {
  if (results.length === 0) return null;
  const byId = leadingOptionId
    ? results.find((r) => r.option_id === leadingOptionId)
    : undefined;
  const top = byId ?? highestWinProbability(results);
  if (!top) return null;
  return projectOptionAsWinner(top);
}

function selectRunnerUp(
  results: ReadonlyArray<Record<string, unknown>>,
  winner: DecisionReviewInvokeInput['winner'],
): DecisionReviewInvokeInput['runner_up'] {
  const others = results.filter((r) => r.option_id !== winner.id);
  const top = highestWinProbability(others);
  if (!top) return null;
  return projectOptionAsWinner(top);
}

function highestWinProbability(
  results: ReadonlyArray<Record<string, unknown>>,
): Record<string, unknown> | null {
  let best: Record<string, unknown> | null = null;
  let bestProb = -Infinity;
  for (const r of results) {
    const p = readNumber(r.win_probability);
    if (p !== null && p > bestProb) {
      best = r;
      bestProb = p;
    }
  }
  return best;
}

function projectOptionAsWinner(r: Record<string, unknown>): DecisionReviewInvokeInput['winner'] {
  const id =
    typeof r.option_id === 'string'
      ? r.option_id
      : typeof r.id === 'string'
        ? r.id
        : '';
  const label =
    typeof r.option_label === 'string'
      ? r.option_label
      : typeof r.label === 'string'
        ? r.label
        : id;
  const winProb = readNumber(r.win_probability) ?? 0;
  const outcomeMean = readNumber(r.outcome_mean);
  return {
    id,
    label,
    win_probability: winProb,
    ...(outcomeMean !== null ? { outcome_mean: outcomeMean } : {}),
  };
}

function readGraph(enrichment: Record<string, unknown>): Record<string, unknown> {
  const raw = enrichment.graph;
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

function readIslResults(enrichment: Record<string, unknown>): Record<string, unknown> {
  // PLoT V2RunResponseEnvelope carries factor_sensitivity and robustness at
  // the top level; the decision_review prompt expects them nested inside
  // isl_results. Build a minimal projection.
  const obj: Record<string, unknown> = {};
  if (Array.isArray(enrichment.factor_sensitivity)) {
    obj.factor_sensitivity = enrichment.factor_sensitivity;
  } else {
    obj.factor_sensitivity = [];
  }
  if (enrichment.robustness !== null && typeof enrichment.robustness === 'object') {
    const rob = enrichment.robustness as Record<string, unknown>;
    obj.robustness = rob;
    if (Array.isArray(rob.fragile_edges)) {
      obj.fragile_edges = rob.fragile_edges;
    }
  }
  // option_comparison: the prompt's shape expects an array; PLoT's per-result
  // shape already covers this via `results`, so forward results[] as the
  // comparison slice.
  obj.option_comparison = Array.isArray(enrichment.results) ? enrichment.results : [];
  return obj;
}

function readDeterministicCoaching(enrichment: Record<string, unknown>): Record<string, unknown> {
  // PLoT envelope does not ship an M1-shaped deterministic_coaching payload.
  // Provide the minimum required shape so the shape check passes and the
  // prompt can read readiness / empty arrays.
  return {
    readiness: 'unknown',
    headline_type: 'neutral',
    evidence_gaps: [],
    model_critiques: [],
  };
}

function readFlipThresholdData(
  enrichment: Record<string, unknown>,
): ReadonlyArray<Record<string, unknown>> | undefined {
  const raw = enrichment.flip_threshold_data;
  if (!Array.isArray(raw)) return undefined;
  return raw.filter((r): r is Record<string, unknown> => r !== null && typeof r === 'object');
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

function skipTelemetry(input: EnrichDecisionReviewInput, reason: SkipReason): void {
  emit(TelemetryEvents.V5DecisionReviewSkipped, {
    request_id: input.requestId,
    scenario_id: input.scenarioId,
    reason,
  });
}
