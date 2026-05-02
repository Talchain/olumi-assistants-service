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
  type DecisionReviewMeta,
} from '../../cee/decision-review/invoke.js';
import { recordModelResolution } from '../debug/turn-debug-store.js';
import { emit, log, TelemetryEvents } from '../../utils/telemetry.js';
import { collectFactorFlipEntries } from '../../orchestrator/context/analysis-compact.js';
import { config } from '../../config/index.js';
import { sanitiseEnrichment } from '../compose/sanitise-enrichment.js';
import type { V2RunResponseEnvelope } from '../../orchestrator/types.js';

import type { DecisionReviewOutput } from './types.js';

export interface EnrichDecisionReviewInput {
  readonly handlerFacts: readonly HandlerFact[];
  readonly requestId: string;
  readonly scenarioId: string;
  /** Outer turn-budget abort signal. */
  readonly signal: AbortSignal;
  /**
   * Scenario brief text. Deliberately NOT read from the run_analysis
   * fact's enrichment — the handler-ownership invariant requires
   * enrichment to be a verbatim pass-through of the PLoT envelope.
   * When null/absent, the enricher skips with reason `no_brief` and
   * the turn succeeds with thin content.
   *
   * Source (V5 Phase 1 brief persistence, 2026-05-02): callers pass
   * `EnrichedTurnContext.scenarioBriefText`, populated from
   * `scenarios.brief_text` via `buildTurnContext`. Both call sites
   * (turn-executor.ts decision-review block, chip-click-dispatch.ts
   * line 323) source from canonical state. The legacy out-of-band
   * `RunTurnExecutorOptions.scenarioBrief` channel is retained as a
   * deprecated fallback in turn-executor only — chip-click had no
   * such fallback (it hardcoded `brief: null`, causing defect B's
   * chip-click leg).
   *
   * Field name kept as `brief` (not renamed to `briefText`) to
   * minimise churn — only the upstream source has changed.
   */
  readonly brief: string | null;
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

  if (!input.brief || input.brief.length === 0) {
    skipTelemetry(input, 'no_brief');
    return input.handlerFacts;
  }

  const invokeInput = buildInvokeInput(input.brief, enrichment, fact.result.leading_option_id);
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
    // V5 holistic audit UU-16: record model resolution unconditionally once
    // the adapter call returned. The decision_review site was previously
    // ROUTED-NO-OBSERVABILITY — the LLM call landed but its resolution
    // never surfaced on the `model_resolutions` dashboard. Recording here
    // (rather than only on output !== null) keeps the attribution honest
    // even when shape extraction failed downstream: the tokens were spent.
    recordModelResolution(input.requestId, input.scenarioId, result.resolution);
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
    // Phase 1 / Commit 5 — analysis-enrichment-critique-prose-safety:
    // Run the parent-level enrichment through the sanitiser BEFORE
    // attaching decision_review. The sanitiser:
    //   - Routes bucket-D ISL critiques (engine validation / preprocessing)
    //     to a separate `_diagnostics.critiques` bucket — gated by
    //     CEE_TURN_DEBUG_ENABLED, omitted from the wire by default.
    //   - Replaces bucket-S critique messages with the approved generic
    //     copy (Paul-reviewed 2026-04-30) using resolved labels.
    //   - Resolves entity IDs to labels in the 15 user-facing prose paths.
    //   - Preserves every structural subtree (payloads, _meta, fragile_edges,
    //     edge_e_values, factor_evpi, etc.) byte-equal.
    // The decision_review subtree itself is kept verbatim (no allowlist
    // path matches inside it; deep-clone preserves it) per the F.6
    // verbatim contract.
    const merged: Record<string, unknown> = {
      ...(enrichment as Record<string, unknown>),
      decision_review: output,
    };
    const sanitised = sanitiseEnrichment(merged);
    let finalEnrichment: Record<string, unknown> = sanitised.enrichment;
    if (config.cee?.turnDebugEnabled === true && sanitised.diagnostic.critiques.length > 0) {
      finalEnrichment = {
        ...finalEnrichment,
        _diagnostics: { critiques: sanitised.diagnostic.critiques },
      };
    }
    const patched: HandlerFact = {
      ...fact,
      result: {
        ...fact.result,
        enrichment: finalEnrichment,
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


/**
 * Exported for contract testing — exercises the full enrichment-to-invoke-input
 * projection without round-tripping through the LLM call. The runtime invocation
 * path (`enrichRunAnalysisWithDecisionReview` above) is the only production caller.
 */
export function buildInvokeInputForTests(
  brief: string,
  enrichment: Record<string, unknown>,
  leadingOptionId: string | null,
): DecisionReviewInvokeInput | null {
  return buildInvokeInput(brief, enrichment, leadingOptionId);
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

  // Build label/unit lookups from enrichment.graph.nodes[]. The graph is
  // opaque (Record<string, unknown>) on this path, so reads are defensive.
  // Same maps are reused by readFlipThresholdData and readIslResults so
  // labels stay consistent across the prompt.
  const graph = readGraph(enrichment);
  const labelMap = buildNodeLabelMap(graph);
  const unitMap = buildNodeUnitMap(graph);

  const flipThresholdData = readFlipThresholdData(enrichment, labelMap, unitMap);
  const islResults = readIslResults(enrichment, labelMap);
  const deterministicCoaching = readDeterministicCoaching(enrichment);

  const margin = runnerUp !== null
    ? winner.win_probability - runnerUp.win_probability
    : null;
  const robustnessLevel = readRobustnessLevel(enrichment);

  const meta: DecisionReviewMeta = {
    input_shape_version: 'v5-normalised',
    flip_threshold_count: flipThresholdData?.length ?? 0,
    factor_sensitivity_count: countArray(islResults.factor_sensitivity),
    fragile_edge_count: countArray(islResults.fragile_edges),
    model_critique_count: 0, // 0 until the M1 deterministic-coaching pipeline ships
    has_deterministic_coaching: false,
    margin,
    robustness_level: robustnessLevel,
  };

  return {
    brief,
    brief_hash: sha256(brief),
    graph,
    isl_results: islResults,
    deterministic_coaching: deterministicCoaching,
    winner,
    runner_up: runnerUp,
    ...(flipThresholdData ? { flip_threshold_data: flipThresholdData } : {}),
    _meta: meta,
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
  // outcome_mean: read from flat field first, then nested outcome.mean.
  // PLoT's option_comparison shape carries the value nested; older fixtures
  // and some test paths use the flat field.
  const outcomeMean = readNumber(r.outcome_mean)
    ?? readNumber(readRecord(r.outcome)?.mean);
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

function readIslResults(
  enrichment: Record<string, unknown>,
  labelMap: Map<string, string>,
): Record<string, unknown> {
  // PLoT V2RunResponseEnvelope carries factor_sensitivity, robustness, and
  // results at the top level. The decision_review prompt (defaults.ts:1245-
  // 1252) expects normalised entries nested inside isl_results with a
  // specific field shape — factor_id/factor_label, from_label/to_label,
  // outcome.{mean,p10,p90}. We rename and reshape rather than passing the
  // raw envelope through.

  // factor_sensitivity: rename id → factor_id and label → factor_label;
  // pin elasticity / confidence to numbers (or null — never invent).
  const factorSensitivity: Record<string, unknown>[] = [];
  if (Array.isArray(enrichment.factor_sensitivity)) {
    for (const raw of enrichment.factor_sensitivity) {
      const e = readRecord(raw);
      if (!e) continue;
      const factorId = (typeof e.factor_id === 'string' ? e.factor_id : null)
        ?? (typeof e.id === 'string' ? e.id : null);
      if (!factorId) continue;
      const factorLabel = (typeof e.factor_label === 'string' && e.factor_label)
        ? e.factor_label
        : (typeof e.label === 'string' && e.label)
          ? e.label
          : labelMap.get(factorId) ?? factorId;
      factorSensitivity.push({
        factor_id: factorId,
        factor_label: factorLabel,
        elasticity: typeof e.elasticity === 'number' && Number.isFinite(e.elasticity) ? e.elasticity : null,
        confidence: typeof e.confidence === 'number' && Number.isFinite(e.confidence) ? e.confidence : null,
      });
    }
  }

  // fragile_edges: pull from enrichment.robustness.fragile_edges[];
  // resolve from_label / to_label via the graph node label map when the
  // edge entry uses *_node_id keys without inline labels.
  const fragileEdges: Record<string, unknown>[] = [];
  const rob = readRecord(enrichment.robustness);
  if (rob && Array.isArray(rob.fragile_edges)) {
    for (const raw of rob.fragile_edges) {
      const e = readRecord(raw);
      if (!e) continue;
      const fromNodeId = typeof e.from_node_id === 'string' ? e.from_node_id : null;
      const toNodeId = typeof e.to_node_id === 'string' ? e.to_node_id : null;
      const fromLabel = (typeof e.from_label === 'string' && e.from_label)
        ? e.from_label
        : (fromNodeId ? labelMap.get(fromNodeId) ?? fromNodeId : null);
      const toLabel = (typeof e.to_label === 'string' && e.to_label)
        ? e.to_label
        : (toNodeId ? labelMap.get(toNodeId) ?? toNodeId : null);
      const out: Record<string, unknown> = {
        edge_id: (typeof e.edge_id === 'string' ? e.edge_id : null)
          ?? (typeof e.id === 'string' ? e.id : null),
        from_label: fromLabel,
        to_label: toLabel,
        switch_probability: typeof e.switch_probability === 'number' ? e.switch_probability : null,
      };
      if (typeof e.marginal_switch_probability === 'number') {
        out.marginal_switch_probability = e.marginal_switch_probability;
      }
      if (typeof e.alternative_winner_id === 'string') {
        out.alternative_winner_id = e.alternative_winner_id;
      }
      if (typeof e.alternative_winner_label === 'string') {
        out.alternative_winner_label = e.alternative_winner_label;
      }
      fragileEdges.push(out);
    }
  }

  // option_comparison: normalise outcome shape so the prompt always sees
  // nested outcome.{mean,p10,p90}. Both flat (outcome_mean / outcome_p10 /
  // outcome_p90) and nested input shapes are accepted.
  const optionComparison: Record<string, unknown>[] = [];
  if (Array.isArray(enrichment.results)) {
    for (const raw of enrichment.results) {
      const r = readRecord(raw);
      if (!r) continue;
      const outcomeNested = readRecord(r.outcome);
      const mean = readNumber(r.outcome_mean) ?? readNumber(outcomeNested?.mean);
      const p10 = readNumber(r.outcome_p10) ?? readNumber(outcomeNested?.p10);
      const p90 = readNumber(r.outcome_p90) ?? readNumber(outcomeNested?.p90);
      optionComparison.push({
        option_id: typeof r.option_id === 'string' ? r.option_id : null,
        option_label: (typeof r.option_label === 'string' && r.option_label)
          ? r.option_label
          : (typeof r.label === 'string' ? r.label : null),
        win_probability: typeof r.win_probability === 'number' ? r.win_probability : null,
        outcome: {
          mean,
          p10,
          p90,
        },
      });
    }
  }

  // robustness: copy the recommendation_stability / overall_confidence
  // signals the prompt reads at defaults.ts:1252. Drop fragile_edges from
  // here (now a sibling field).
  const robustnessOut: Record<string, unknown> = {};
  if (rob) {
    if (typeof rob.recommendation_stability === 'number') {
      robustnessOut.recommendation_stability = rob.recommendation_stability;
    }
    if (typeof rob.overall_confidence === 'number') {
      robustnessOut.overall_confidence = rob.overall_confidence;
    }
    if (typeof rob.level === 'string') {
      robustnessOut.level = rob.level;
    }
  }

  return {
    factor_sensitivity: factorSensitivity,
    fragile_edges: fragileEdges,
    option_comparison: optionComparison,
    robustness: robustnessOut,
  };
}

function readDeterministicCoaching(_enrichment: Record<string, unknown>): Record<string, unknown> {
  // PLoT envelope does not ship an M1-shaped deterministic_coaching payload.
  // We return the minimum required shape so the prompt v11 shape check
  // passes — `readiness: 'unknown'` and `headline_type: 'neutral'` are
  // **intentional safe defaults** kept for v11 compatibility (its tone
  // alignment table at defaults.ts:1320 keys on these enums and would
  // produce miscalibrated tone if we shipped null today).
  //
  // Prompt v12 (drafted separately) will fall back to `_meta.margin` /
  // `_meta.robustness_level` and ignore these defaults. After v12 ships,
  // a follow-up branch will flip these to null. See plan §"Tier 3 timing".
  return {
    readiness: 'unknown',
    headline_type: 'neutral',
    evidence_gaps: [],
    model_critiques: [],
  };
}

/**
 * Derive flip_threshold_data from per-result factor_sensitivity entries.
 * PLoT does not ship a top-level `flip_threshold_data` field; the data
 * exists nested in `results[].factor_sensitivity[].flip_threshold`. This
 * delegates to {@link collectFactorFlipEntries} (shared with
 * analysis-compact.ts) for the read + filter + dedupe step, then projects
 * to the prompt's input shape.
 *
 * Direction is value-delta-driven (`flip_value > current_value` →
 * `'increase'`) — never elasticity-sign-driven. See FactorFlipEntry doc.
 */
function readFlipThresholdData(
  enrichment: Record<string, unknown>,
  graphNodeLabels: Map<string, string>,
  graphNodeUnits: Map<string, string>,
): ReadonlyArray<Record<string, unknown>> | undefined {
  const entries = collectFactorFlipEntries(
    enrichment as V2RunResponseEnvelope,
    graphNodeLabels,
    graphNodeUnits,
  );
  if (entries.length === 0) return undefined;

  return entries.map((entry) => {
    const out: Record<string, unknown> = {
      factor_id: entry.factor_id,
      factor_label: entry.factor_label,
      current_value: entry.current_value,
      flip_value: entry.flip_value,
      direction: entry.direction,
    };
    if (entry.unit !== null) {
      out.unit = entry.unit;
    }
    return out;
  });
}

// ============================================================================
// Helpers — defensive narrowing for opaque enrichment reads
// ============================================================================

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function countArray(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

/**
 * Build factor_id → display label map from `enrichment.graph.nodes[]`.
 * Defensive: returns an empty Map when the graph shape isn't recognisable.
 */
function buildNodeLabelMap(graph: Record<string, unknown>): Map<string, string> {
  const map = new Map<string, string>();
  const nodes = graph.nodes;
  if (!Array.isArray(nodes)) return map;
  for (const raw of nodes) {
    const n = readRecord(raw);
    if (!n) continue;
    const id = typeof n.id === 'string' ? n.id : null;
    const label = typeof n.label === 'string' ? n.label : null;
    if (id && label) map.set(id, label);
  }
  return map;
}

/**
 * Build factor_id → unit map from `enrichment.graph.nodes[]` reading
 * `node.data.unit` (the prompt-side convention from the brief).
 * Falls back to `node.observed_state.unit` for older fixtures.
 */
function buildNodeUnitMap(graph: Record<string, unknown>): Map<string, string> {
  const map = new Map<string, string>();
  const nodes = graph.nodes;
  if (!Array.isArray(nodes)) return map;
  for (const raw of nodes) {
    const n = readRecord(raw);
    if (!n) continue;
    const id = typeof n.id === 'string' ? n.id : null;
    if (!id) continue;
    const data = readRecord(n.data);
    const obs = readRecord(n.observed_state);
    const unit = (typeof data?.unit === 'string' ? data.unit : null)
      ?? (typeof obs?.unit === 'string' ? obs.unit : null);
    if (unit) map.set(id, unit);
  }
  return map;
}

/**
 * Read robustness.level defensively from the V2 envelope.
 */
function readRobustnessLevel(enrichment: Record<string, unknown>): string | null {
  const rob = readRecord(enrichment.robustness);
  if (!rob) return null;
  return typeof rob.level === 'string' ? rob.level : null;
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
