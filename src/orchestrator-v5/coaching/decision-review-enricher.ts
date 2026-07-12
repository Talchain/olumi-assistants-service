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
import { invokeDecomposedDecisionReview } from '../../cee/decision-review/decompose.js';
import { recordModelResolution } from '../debug/turn-debug-store.js';
import { emit, log, TelemetryEvents } from '../../utils/telemetry.js';
import { collectFactorFlipEntries } from '../../orchestrator/context/analysis-compact.js';
import { config } from '../../config/index.js';
import { sanitiseEnrichment } from '../compose/sanitise-enrichment.js';
// Graph-label readers relocated to a lean, dependency-free context module so
// the projection layer (`analysis-fallback`) can reuse them without importing
// this heavy enricher. Re-exported below to keep existing consumers stable.
import { readGraph, buildNodeLabelMap } from '../context/enrichment-graph-labels.js';
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
  | 'no_winner'
  // Emitted by the caller (turn-executor / chip-click-dispatch) when the
  // `V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW` config flag is false. Listed
  // here so callers share the same union via `TelemetryEvents.V5DecisionReviewSkipped`.
  | 'autofire_disabled';

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

  // Round-1 staging diagnostic (Change A): every skip / invoke / failed
  // telemetry event carries these structural fields so a single grep on
  // `v5.decision_review.skipped` reveals which precondition failed AND
  // what the inputs looked like (brief presence, enrichment shape,
  // leading_option_id presence). Booleans + length only — never the
  // brief text itself, never a raw fact ID.
  const briefLength = typeof input.brief === 'string' ? input.brief.length : 0;
  const leadingOptionPresent =
    typeof fact.result.leading_option_id === 'string' &&
    fact.result.leading_option_id.length > 0;

  const enrichment = fact.result.enrichment;
  if (enrichment === undefined) {
    skipTelemetry(input, 'no_results', {
      brief_present: briefLength > 0,
      brief_length: briefLength,
      has_enrichment: false,
      leading_option_present: leadingOptionPresent,
    });
    return input.handlerFacts;
  }

  if (!input.brief || input.brief.length === 0) {
    skipTelemetry(input, 'no_brief', {
      brief_present: false,
      brief_length: briefLength,
      has_enrichment: true,
      leading_option_present: leadingOptionPresent,
    });
    return input.handlerFacts;
  }

  const invokeInput = buildInvokeInput(input.brief, enrichment, fact.result.leading_option_id);
  if (!invokeInput) {
    skipTelemetry(input, 'no_winner', {
      brief_present: true,
      brief_length: briefLength,
      has_enrichment: true,
      leading_option_present: leadingOptionPresent,
    });
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
    // Change A diagnostic context: lets operators correlate an `invoked`
    // event to the same `brief_length` they'd see on a sibling `skipped`
    // event, without needing to grep two events for the same request_id.
    brief_present: true,
    brief_length: briefLength,
    leading_option_present: leadingOptionPresent,
  });

  const startedAt = Date.now();
  try {
    // ROADMAP 1.77 (B1). Dedicated decomposed-vs-monolith selector. Flag-off
    // (default) is BYTE-IDENTICAL to today: the single gpt-4.1 monolith. Flag-on
    // routes to the 4-parallel-haiku composer, which itself falls back to the
    // monolith on any composed-inconsistency — both paths return the identical
    // DecisionReviewInvokeResult shape, so everything below is unchanged.
    const invoke = config.cee.decisionReviewDecompose
      ? invokeDecomposedDecisionReview
      : invokeDecisionReview;
    const result = await invoke(invokeInput, {
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
        brief_present: true,
        brief_length: briefLength,
        leading_option_present: leadingOptionPresent,
      });
      return input.handlerFacts;
    }

    // Phase 3A content-thinness diagnostic (F1, 2026-05-18). Compute the
    // density snapshot here (cheap, deterministic, never throws) but DO
    // NOT emit until after the attach succeeds at `return next;` below.
    // Emitting earlier would let a downstream throw (e.g. inside
    // sanitiseEnrichment) reach the catch block and fire
    // V5DecisionReviewFailed for the same invocation — operators would see
    // BOTH `completed` and `failed` events with the same request_id.
    // Mutually-exclusive event semantics depend on emitting only once the
    // attach has actually happened.
    //
    // `duration_ms` is intentionally NOT pre-computed here — it is
    // calculated inline at the emit site below, so the reported figure
    // includes sanitise + attach time (the full invoked → emit window).
    // Computing it now would understate latency dashboards by the
    // sanitise/attach budget.
    const completedDensityPayload = {
      request_id: input.requestId,
      scenario_id: input.scenarioId,
      ...computeDecisionReviewInputDensity(enrichment as Record<string, unknown>),
      ...computeDecisionReviewOutputDensity(result.output),
    };

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
    // F1 emit deferred to here so `completed` and `failed` are strictly
    // mutually exclusive: a sanitise or attach throw above would have
    // landed in the catch block and fired V5DecisionReviewFailed instead.
    // `duration_ms` is computed AT this point (not at payload
    // construction) so it includes sanitise + attach time — operators see
    // the full invoked → emit latency, not just the LLM call.
    emit(TelemetryEvents.V5DecisionReviewCompleted, {
      ...completedDensityPayload,
      duration_ms: Date.now() - startedAt,
    });
    return next;
  } catch (err) {
    emit(TelemetryEvents.V5DecisionReviewFailed, {
      request_id: input.requestId,
      scenario_id: input.scenarioId,
      reason: err instanceof Error ? err.message : 'unknown',
      duration_ms: Date.now() - startedAt,
      brief_present: true,
      brief_length: briefLength,
      leading_option_present: leadingOptionPresent,
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
  // Phase 3A fix (2026-05-17): walk every available results source until
  // one can match `leading_option_id`. The previous "first non-empty
  // source wins" shape would skip `no_winner` when (e.g.) a legacy
  // `enrichment.results` was present but truncated, even though the
  // current `enrichment.option_comparison` contained the declared
  // leader. Returning at the first matching source guarantees we honour
  // PLoT's declared winner whenever ANY source carries it.
  //
  // Source ordering for the null-leader case (no declared winner):
  // pick the first non-empty source's highest-probability entry. We
  // deliberately do NOT pool entries across sources for the null-leader
  // case — that would mix shapes and could double-count the same option.
  const sources = readResultsArraySources(enrichment);
  if (sources.length === 0) return null;

  let winner: DecisionReviewInvokeInput['winner'] | null = null;
  let chosenSource: ReadonlyArray<Record<string, unknown>> | null = null;

  if (typeof leadingOptionId === 'string' && leadingOptionId.length > 0) {
    for (const source of sources) {
      const w = selectWinner(source, leadingOptionId);
      if (w !== null) {
        winner = w;
        chosenSource = source;
        break;
      }
    }
  } else {
    chosenSource = sources[0]!;
    winner = selectWinner(chosenSource, null);
  }

  if (winner === null || chosenSource === null) return null;
  const runnerUp = selectRunnerUp(chosenSource, winner);

  // Build label/unit lookups from enrichment.graph.nodes[]. The graph is
  // opaque (Record<string, unknown>) on this path, so reads are defensive.
  // Same maps are reused by readFlipThresholdData and readIslResults so
  // labels stay consistent across the prompt.
  const graph = readGraph(enrichment);
  const labelMap = buildNodeLabelMap(graph);
  const unitMap = buildNodeUnitMap(graph);

  const flipThresholdData = readFlipThresholdData(enrichment, labelMap, unitMap);
  const islResults = readIslResults(enrichment, labelMap);
  const dcResult = normaliseDeterministicCoachingFromM1(enrichment);
  const deterministicCoaching = dcResult.value;

  const margin = runnerUp !== null
    ? winner.win_probability - runnerUp.win_probability
    : null;
  const robustnessLevel = readRobustnessLevel(enrichment);

  const meta: DecisionReviewMeta = {
    input_shape_version: 'v5-normalised',
    flip_threshold_count: flipThresholdData?.length ?? 0,
    factor_sensitivity_count: countArray(islResults.factor_sensitivity),
    fragile_edge_count: countArray(islResults.fragile_edges),
    model_critique_count: dcResult.model_critique_count,
    has_deterministic_coaching: dcResult.has_real_data,
    evidence_gaps_dropped_count: dcResult.evidence_gaps_dropped_count,
    model_critiques_dropped_count: dcResult.model_critiques_dropped_count,
    model_critiques_capped_count: dcResult.model_critiques_capped_count,
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

/**
 * Read all option-level results sources from the PLoT V2 enrichment payload,
 * in priority order.
 *
 * The envelope shape evolved across PLoT versions and the V5 enricher must
 * accept all three published shapes without weakening the `no_winner` skip
 * guarantee for genuinely missing data:
 *
 *   1. `enrichment.results[]`         — legacy shape (kept for backwards
 *                                       compatibility; pre-2026 envelopes).
 *   2. `enrichment.option_comparison[]` — current PLoT V2 (verified on
 *                                         staging build `2e6e0be`); entries
 *                                         carry both `option_id`/`id` and
 *                                         `option_label`/`label` + a nested
 *                                         `outcome.{mean,p10,p50,p90,…}`.
 *   3. `enrichment.decision_brief.options[]` — leaner brief-shape with
 *                                              `option_id`, `label`,
 *                                              `win_probability`, `rank`.
 *
 * Returns every non-empty source as a separate array; the caller
 * (`buildInvokeInput`) walks them in order until one can match
 * `leading_option_id`. This avoids the trap where (e.g.) a legacy
 * `enrichment.results` is non-empty but truncated, while the current
 * `enrichment.option_comparison` contains the declared leader — the
 * walker honours PLoT's declared winner whenever ANY source carries it.
 *
 * `projectOptionAsWinner` was already shape-tolerant (`option_id || id`,
 * `option_label || label`, nested or flat `outcome.mean`), so all three
 * source shapes feed into the same projector unchanged.
 *
 * Returns `[]` only when all three sources are absent or empty.
 */
export function readResultsArraySources(
  enrichment: Record<string, unknown>,
): ReadonlyArray<ReadonlyArray<Record<string, unknown>>> {
  const sources: Array<ReadonlyArray<Record<string, unknown>>> = [];
  const legacy = enrichment.results;
  if (Array.isArray(legacy) && legacy.length > 0) {
    const entries = filterObjectEntries(legacy);
    if (entries.length > 0) sources.push(entries);
  }
  const optionComparison = enrichment.option_comparison;
  if (Array.isArray(optionComparison) && optionComparison.length > 0) {
    const entries = filterObjectEntries(optionComparison);
    if (entries.length > 0) sources.push(entries);
  }
  const briefOptions = readRecord(enrichment.decision_brief)?.options;
  if (Array.isArray(briefOptions) && briefOptions.length > 0) {
    const entries = filterObjectEntries(briefOptions);
    if (entries.length > 0) sources.push(entries);
  }
  return sources;
}


function filterObjectEntries(arr: readonly unknown[]): ReadonlyArray<Record<string, unknown>> {
  return arr.filter(
    (r): r is Record<string, unknown> =>
      r !== null && typeof r === 'object' && !Array.isArray(r),
  );
}

/**
 * Select the winner option, preferring an exact `leading_option_id` match
 * when PLoT has declared one.
 *
 * Tightening (Phase 3A fix, 2026-05-17): when `leadingOptionId` is
 * provided but none of the results carry a matching `option_id` / `id`,
 * return `null` rather than falling back to "highest probability in the
 * envelope". The previous fallback would invent a winner whenever the
 * declared leader was missing from the envelope, masking real
 * data-integrity issues; the enricher's `no_winner` skip is the honest
 * outcome for that case.
 *
 * When `leadingOptionId` is null or empty, the behaviour is unchanged:
 * fall back to the highest-probability entry (returns null if none of
 * the entries carry a usable win_probability).
 */
export function selectWinner(
  results: ReadonlyArray<Record<string, unknown>>,
  leadingOptionId: string | null,
): DecisionReviewInvokeInput['winner'] | null {
  if (results.length === 0) return null;
  if (typeof leadingOptionId === 'string' && leadingOptionId.length > 0) {
    const byId = results.find(
      (r) => r.option_id === leadingOptionId || r.id === leadingOptionId,
    );
    return byId ? projectOptionAsWinner(byId) : null;
  }
  const top = highestWinProbability(results);
  return top ? projectOptionAsWinner(top) : null;
}

function selectRunnerUp(
  results: ReadonlyArray<Record<string, unknown>>,
  winner: DecisionReviewInvokeInput['winner'],
): DecisionReviewInvokeInput['runner_up'] {
  // Filter against BOTH `option_id` and `id` so entries from the
  // `option_comparison` shape (which populates both) and the
  // `decision_brief.options` shape (which only populates `option_id`)
  // are both excluded correctly from the runner-up candidate set.
  const others = results.filter(
    (r) => r.option_id !== winner.id && r.id !== winner.id,
  );
  const top = highestWinProbability(others);
  return top ? projectOptionAsWinner(top) : null;
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

// `readGraph` is relocated to ../context/enrichment-graph-labels.ts and
// re-exported below.

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
  // Allowlisted additive fields (attribution_stability, rank_flip_rate,
  // evpi_percentage_points, direction, sensitivity_score, confidence_components,
  // confidence_source, confidence_provenance) are forwarded when upstream
  // supplies them — see normaliseFactorSensitivity. Unknown PLoT fields are
  // NOT auto-forwarded.
  const factorSensitivity: Record<string, unknown>[] = [];
  if (Array.isArray(enrichment.factor_sensitivity)) {
    for (const raw of enrichment.factor_sensitivity) {
      const n = normaliseFactorSensitivity(raw, labelMap);
      if (n) factorSensitivity.push(n);
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

/**
 * Adapter v1 (2026-05-21) — map `enrichment.m1_coaching` into the
 * `deterministic_coaching` block that v11 prompts read. PLoT supplies this
 * subtree today; previously this function returned a hardcoded default and
 * starved the prompt of evidence. See
 * Docs/v5/captures/decision_review_envelope_audit_2026-05-21.md §7.
 *
 * `_meta.has_deterministic_coaching` is true ONLY when at least one mapped
 * field carries real upstream data:
 *   - readiness present and not 'unknown', OR
 *   - headline_type present and not 'neutral', OR
 *   - evidence_gaps mapped (non-empty after malformed-entry filtering), OR
 *   - model_critiques present (non-empty).
 *
 * Malformed evidence_gaps entries (object-shaped but missing one of the
 * four required fields: factor_id, factor_label, voi_score, confidence)
 * are dropped, counted in `_meta.evidence_gaps_dropped_count`, and the
 * turn continues — the production path is "never throw, never fail the
 * turn." If ALL upstream gaps are malformed, the resulting empty array is
 * treated as "no evidence_gaps supplied" for has_deterministic_coaching
 * purposes (the flag may still flip true via other signals).
 */
interface DeterministicCoachingResult {
  readonly value: Record<string, unknown>;
  readonly has_real_data: boolean;
  readonly model_critique_count: number;
  readonly evidence_gaps_dropped_count: number;
  /** Number of upstream model_critiques entries dropped for missing one of
   *  the three required fields (type, severity, message) — see
   *  {@link normaliseModelCritique}. Mirrors evidence_gaps_dropped_count. */
  readonly model_critiques_dropped_count: number;
  /** Number of well-formed model_critiques entries dropped purely by the
   *  MAX_MODEL_CRITIQUES count cap (FIX 2, 1.41) — distinct from the
   *  dropped-for-malformed count above. */
  readonly model_critiques_capped_count: number;
}

/**
 * Max model_critiques entries forwarded to the decision_review prompt
 * (FIX 2, 1.41 — count cap; mirrors the array-length-capping hygiene
 * convention used elsewhere in this codebase, e.g.
 * cee/decision-review/invoke.ts's DECISION_REVIEW_MAX_* constants). Extra
 * well-formed entries beyond this count are dropped from the tail; the
 * count is tracked in _meta for observability, never silently.
 */
const MAX_MODEL_CRITIQUES = 10;

/**
 * Map a single upstream m1_coaching.model_critiques[] entry into the
 * adapter-output shape the decision_review prompt expects (defaults.ts
 * "DETERMINISTIC COACHING" section: `.model_critiques[]: { type, severity,
 * message, suggested_action?, affected_node_ids? }`).
 *
 * Required: type (string), severity (string), message (string). Returns
 * null when any required field is missing or wrong-typed — caller
 * increments the dropped count (mirrors {@link normaliseEvidenceGap}).
 *
 * Optional additive passthrough (allowlist only): suggested_action
 * (string), affected_node_ids (array — non-string entries filtered out).
 * Unknown upstream fields are NOT forwarded — this closes the gap the
 * flag-activation trial found (previously `filterObjectEntries` forwarded
 * arbitrary upstream objects verbatim, no allowlist at all).
 */
function normaliseModelCritique(e: Record<string, unknown>): Record<string, unknown> | null {
  const type = typeof e.type === 'string' && e.type.length > 0 ? e.type : null;
  const severity = typeof e.severity === 'string' && e.severity.length > 0 ? e.severity : null;
  const message = typeof e.message === 'string' && e.message.length > 0 ? e.message : null;
  if (type === null || severity === null || message === null) return null;
  const out: Record<string, unknown> = { type, severity, message };
  if (typeof e.suggested_action === 'string') out.suggested_action = e.suggested_action;
  if (Array.isArray(e.affected_node_ids)) {
    const ids = e.affected_node_ids.filter((id): id is string => typeof id === 'string');
    if (ids.length > 0) out.affected_node_ids = ids;
  }
  return out;
}

function normaliseDeterministicCoachingFromM1(
  enrichment: Record<string, unknown>,
): DeterministicCoachingResult {
  const m1 = readRecord(enrichment.m1_coaching);
  // Trim whitespace defensively; an upstream value of "  ready  " is
  // semantically "ready" and should not be treated as "unusable, fall back."
  // Any non-empty trimmed string is forwarded verbatim — this is an
  // intentional upstream-contract-trust decision, NOT a claim about v11's
  // behaviour on unknown enums. PLoT owns the readiness/headline_type
  // enum vocabulary; the adapter trusts whatever PLoT publishes. We
  // deliberately do NOT enum-allowlist the strings: a fixed gate (e.g.
  // ["ready","not_ready","unknown"]) would silently fall back when PLoT
  // introduces a new valid value, recreating the exact starvation symptom
  // adapter v1 fixes. If v11 ever mishandles an unknown enum the right
  // response is prompt-side (v13 enum-handling), not adapter strictness.
  const rawReadiness =
    m1 && typeof m1.readiness === 'string' ? m1.readiness.trim() : '';
  const readiness = rawReadiness.length > 0 ? rawReadiness : 'unknown';
  const rawHeadline =
    m1 && typeof m1.headline_type === 'string' ? m1.headline_type.trim() : '';
  const headline_type = rawHeadline.length > 0 ? rawHeadline : 'neutral';
  const rawGaps = m1 && Array.isArray(m1.evidence_gaps) ? m1.evidence_gaps : [];
  const evidence_gaps: Record<string, unknown>[] = [];
  let dropped = 0;
  for (const g of rawGaps) {
    // Non-object entries aren't "populated but malformed" — skip silently
    // without counting (matches the filter-object-entries convention).
    if (g === null || typeof g !== 'object' || Array.isArray(g)) continue;
    const n = normaliseEvidenceGap(g as Record<string, unknown>);
    if (n) {
      evidence_gaps.push(n);
    } else {
      dropped++;
    }
  }
  const rawCrits = m1 && Array.isArray(m1.model_critiques) ? m1.model_critiques : [];
  const mappedCritiques: Record<string, unknown>[] = [];
  let critiquesDropped = 0;
  for (const c of rawCrits) {
    // Non-object entries aren't "populated but malformed" — skip silently
    // without counting (matches the filter-object-entries convention).
    if (c === null || typeof c !== 'object' || Array.isArray(c)) continue;
    const n = normaliseModelCritique(c as Record<string, unknown>);
    if (n) {
      mappedCritiques.push(n);
    } else {
      critiquesDropped++;
    }
  }
  const critiquesCappedCount = Math.max(0, mappedCritiques.length - MAX_MODEL_CRITIQUES);
  const model_critiques = mappedCritiques.slice(0, MAX_MODEL_CRITIQUES);

  const has_real_data =
    readiness !== 'unknown' ||
    headline_type !== 'neutral' ||
    evidence_gaps.length > 0 ||
    model_critiques.length > 0;

  return {
    value: { readiness, headline_type, evidence_gaps, model_critiques },
    has_real_data,
    model_critique_count: model_critiques.length,
    evidence_gaps_dropped_count: dropped,
    model_critiques_dropped_count: critiquesDropped,
    model_critiques_capped_count: critiquesCappedCount,
  };
}

/**
 * Map a single upstream m1_coaching.evidence_gaps[] entry into the
 * adapter-output shape. Returns null when ANY of the four required fields
 * is missing or wrong-typed — caller increments the dropped count.
 *
 * Required: factor_id (string), factor_label (string), voi_score (finite
 * number, renamed to `voi`), confidence (finite number).
 *
 * Optional additive passthrough (allowlist only): suggestion,
 * confidence_display, confidence_defaulted, influence, influence_display,
 * evpi_percentage_points, evpi_method. Unknown upstream fields are NOT
 * forwarded.
 */
function normaliseEvidenceGap(e: Record<string, unknown>): Record<string, unknown> | null {
  const factor_id = typeof e.factor_id === 'string' && e.factor_id.length > 0 ? e.factor_id : null;
  const factor_label =
    typeof e.factor_label === 'string' && e.factor_label.length > 0 ? e.factor_label : null;
  const voi =
    typeof e.voi_score === 'number' && Number.isFinite(e.voi_score) ? e.voi_score : null;
  const confidence =
    typeof e.confidence === 'number' && Number.isFinite(e.confidence) ? e.confidence : null;
  if (factor_id === null || factor_label === null || voi === null || confidence === null) {
    return null;
  }
  const out: Record<string, unknown> = { factor_id, factor_label, voi, confidence };
  if (typeof e.suggestion === 'string') out.suggestion = e.suggestion;
  if (typeof e.confidence_display === 'string') out.confidence_display = e.confidence_display;
  if (typeof e.confidence_defaulted === 'boolean') out.confidence_defaulted = e.confidence_defaulted;
  if (typeof e.influence === 'number' && Number.isFinite(e.influence)) out.influence = e.influence;
  if (typeof e.influence_display === 'string') out.influence_display = e.influence_display;
  if (
    typeof e.evpi_percentage_points === 'number' &&
    Number.isFinite(e.evpi_percentage_points)
  ) {
    out.evpi_percentage_points = e.evpi_percentage_points;
  }
  if (typeof e.evpi_method === 'string') out.evpi_method = e.evpi_method;
  return out;
}

/**
 * Map a single upstream factor_sensitivity entry into the adapter-output
 * shape. Returns null when factor_id can't be resolved.
 *
 * Required fields always emitted: factor_id, factor_label, elasticity
 * (number|null), confidence (number|null).
 *
 * Allowlisted additive passthrough: attribution_stability, rank_flip_rate,
 * evpi_percentage_points, direction, sensitivity_score,
 * confidence_components, confidence_source, confidence_provenance. Unknown
 * upstream fields are NOT auto-forwarded *at the top level of the entry* —
 * this guards v11 against surfacing fields it doesn't know how to interpret.
 *
 * Nested-object passthrough is intentionally NOT recursively allowlisted:
 * `confidence_components` and `confidence_provenance` are forwarded as
 * whole objects. These are bounded provenance subtrees (~2 and ~5 keys
 * respectively on the captured staging shape) whose purpose is audit /
 * traceability for the LLM (e.g. `is_provisional: true` lets the model
 * hedge appropriately). Recursive nested allowlisting would add brittle
 * maintenance burden without proportional value — accepting the upstream
 * shape verbatim within these two sub-objects is the deliberate choice.
 * If PLoT adds new keys here, they will reach v11; that is intended.
 */
function normaliseFactorSensitivity(
  raw: unknown,
  labelMap: Map<string, string>,
): Record<string, unknown> | null {
  const e = readRecord(raw);
  if (!e) return null;
  const factorId =
    (typeof e.factor_id === 'string' ? e.factor_id : null) ??
    (typeof e.id === 'string' ? e.id : null);
  if (!factorId) return null;
  const factorLabel =
    typeof e.factor_label === 'string' && e.factor_label
      ? e.factor_label
      : typeof e.label === 'string' && e.label
        ? e.label
        : labelMap.get(factorId) ?? factorId;
  const out: Record<string, unknown> = {
    factor_id: factorId,
    factor_label: factorLabel,
    elasticity:
      typeof e.elasticity === 'number' && Number.isFinite(e.elasticity) ? e.elasticity : null,
    confidence:
      typeof e.confidence === 'number' && Number.isFinite(e.confidence) ? e.confidence : null,
  };
  if (typeof e.attribution_stability === 'string') {
    out.attribution_stability = e.attribution_stability;
  }
  if (typeof e.rank_flip_rate === 'number' && Number.isFinite(e.rank_flip_rate)) {
    out.rank_flip_rate = e.rank_flip_rate;
  }
  if (
    typeof e.evpi_percentage_points === 'number' &&
    Number.isFinite(e.evpi_percentage_points)
  ) {
    out.evpi_percentage_points = e.evpi_percentage_points;
  }
  if (typeof e.direction === 'string') out.direction = e.direction;
  if (typeof e.sensitivity_score === 'number' && Number.isFinite(e.sensitivity_score)) {
    out.sensitivity_score = e.sensitivity_score;
  }
  const cc = readRecord(e.confidence_components);
  if (cc) out.confidence_components = cc;
  if (typeof e.confidence_source === 'string') out.confidence_source = e.confidence_source;
  const cp = readRecord(e.confidence_provenance);
  if (cp) out.confidence_provenance = cp;
  return out;
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

export function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function countArray(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

// `buildNodeLabelMap` is relocated to ../context/enrichment-graph-labels.ts
// and re-exported below.
export { readGraph, buildNodeLabelMap };

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
export function readRobustnessLevel(enrichment: Record<string, unknown>): string | null {
  const rob = readRecord(enrichment.robustness);
  if (!rob) return null;
  return typeof rob.level === 'string' ? rob.level : null;
}

function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

/**
 * Change A diagnostic context passed by every skipTelemetry call site.
 * Booleans + length only — never the brief text itself, never a raw
 * fact ID, never a user-prose excerpt. Lets a single grep on
 * `v5.decision_review.skipped` answer "did the brief reach the
 * enricher" + "did the precondition shape look as expected" without
 * needing a wire-level diagnostic or admin endpoint.
 */
interface SkipDiagnostics {
  readonly brief_present: boolean;
  readonly brief_length: number;
  readonly has_enrichment: boolean;
  readonly leading_option_present: boolean;
}

function skipTelemetry(
  input: EnrichDecisionReviewInput,
  reason: SkipReason,
  diagnostics: SkipDiagnostics,
): void {
  emit(TelemetryEvents.V5DecisionReviewSkipped, {
    request_id: input.requestId,
    scenario_id: input.scenarioId,
    reason,
    ...diagnostics,
  });
}

/**
 * Phase 3A content-thinness diagnostic (F1). Reads count/length/presence
 * signals off the raw PLoT V2 enrichment envelope. Every returned field is
 * a finite number or boolean — never a string, array, or nested object.
 * Adding a string field here is a privacy regression (this event is
 * promised to operators as content-free) and the contract test in
 * decision-review-enricher.test.ts will fail.
 *
 * Field-by-field rationale (paired with the Phase 3 builders that consume
 * the corresponding source field):
 *  - enrichment_has_graph / *_graph_node_count / *_graph_edge_count:
 *    Phase 3 graph-ref blocks (scenario_context, flip_threshold,
 *    pre_mortem.grounded_in, bias.affected_elements, evidence_priority,
 *    EvidenceBlock label resolution) all depend on `enrichment.graph`.
 *    `has_graph` is **true** only when `enrichment.graph` is an object
 *    AND `graph.nodes` AND `graph.edges` are arrays — i.e. the shape
 *    `buildGraphNodeLookup` can actually consume. A degenerate shape
 *    like `{nodes: 'oops', edges: null}` reports `false`, matching
 *    composer fail-closed semantics. When `has_graph=false`, every
 *    graph-ref block drops at the lookup gate in phase3-blocks.ts.
 *  - enrichment_factor_sensitivity_count / *_with_confidence_count:
 *    EvidenceBlock severity is gated on calibrated confidence sourced
 *    only from `factor_sensitivity[].confidence`. The delta between the
 *    two counts is the EvidenceBlock drop rate from RC-2.
 *  - enrichment_robustness_fragile_edges_count: feeds the prompt's
 *    `fragile_edges` input, which the v11 prompt uses to select
 *    `scenario_contexts` entries. Zero → empty `scenario_contexts: {}`
 *    is the prompt's correct behaviour.
 *  - enrichment_results_count / _option_comparison_count /
 *    _decision_brief_options_count: option-source presence per the
 *    PR #180 fallback chain. Whichever is non-empty drives narrative
 *    grounding.
 */
interface InputDensity {
  readonly enrichment_has_graph: boolean;
  readonly enrichment_graph_node_count: number;
  readonly enrichment_graph_edge_count: number;
  readonly enrichment_factor_sensitivity_count: number;
  readonly enrichment_factor_sensitivity_with_confidence_count: number;
  readonly enrichment_robustness_fragile_edges_count: number;
  readonly enrichment_results_count: number;
  readonly enrichment_option_comparison_count: number;
  readonly enrichment_decision_brief_options_count: number;
}

function computeDecisionReviewInputDensity(
  enrichment: Record<string, unknown>,
): InputDensity {
  const graph = readRecord(enrichment.graph);
  const graphNodesArr = graph !== null && Array.isArray(graph.nodes) ? graph.nodes : null;
  const graphEdgesArr = graph !== null && Array.isArray(graph.edges) ? graph.edges : null;
  // `has_graph` reports the consumer-usable shape, not just "is an
  // object": both nodes[] and edges[] must be arrays for
  // `buildGraphNodeLookup` to read them. A `{nodes: 'oops'}` shape
  // reports false, matching the composer fail-closed gate.
  const hasUsableGraph = graphNodesArr !== null && graphEdgesArr !== null;
  const factorSens = Array.isArray(enrichment.factor_sensitivity)
    ? enrichment.factor_sensitivity
    : [];
  const rob = readRecord(enrichment.robustness);
  const fragileEdges = rob !== null && Array.isArray(rob.fragile_edges)
    ? rob.fragile_edges
    : [];
  const results = Array.isArray(enrichment.results) ? enrichment.results : [];
  const optionComparison = Array.isArray(enrichment.option_comparison)
    ? enrichment.option_comparison
    : [];
  const decisionBrief = readRecord(enrichment.decision_brief);
  const briefOptions = decisionBrief !== null && Array.isArray(decisionBrief.options)
    ? decisionBrief.options
    : [];

  let factorSensWithConfidence = 0;
  for (const raw of factorSens) {
    const e = readRecord(raw);
    if (e === null) continue;
    if (typeof e.confidence === 'number' && Number.isFinite(e.confidence)) {
      factorSensWithConfidence++;
    }
  }

  return {
    enrichment_has_graph: hasUsableGraph,
    enrichment_graph_node_count: graphNodesArr !== null ? graphNodesArr.length : 0,
    enrichment_graph_edge_count: graphEdgesArr !== null ? graphEdgesArr.length : 0,
    enrichment_factor_sensitivity_count: factorSens.length,
    enrichment_factor_sensitivity_with_confidence_count: factorSensWithConfidence,
    enrichment_robustness_fragile_edges_count: fragileEdges.length,
    enrichment_results_count: results.length,
    enrichment_option_comparison_count: optionComparison.length,
    enrichment_decision_brief_options_count: briefOptions.length,
  };
}

/**
 * Phase 3A content-thinness diagnostic (F1). Reads count/length/presence
 * signals off the parsed LLM output BEFORE it is sanitised or attached.
 * Every returned field is a finite number or boolean — never a string,
 * array, or nested object. Strings are reported by `.length` only.
 *
 * Field-by-field rationale (paired with the Phase 3 ReviewCardBlock that
 * consumes the corresponding source field):
 *  - output_narrative_summary_length: drops at phase3-blocks.ts:606 when
 *    empty. Length zero → no narrative card.
 *  - output_robustness_explanation_summary_length / _stability_factors_count
 *    / _fragility_factors_count: robustness card drops at
 *    phase3-blocks.ts:807 when summary is empty.
 *  - output_evidence_enhancements_count: raw count of keys in the
 *    `evidence_enhancements` map — exactly what the LLM emitted.
 *  - output_evidence_enhancements_usable_count: count of entries where
 *    `specific_action`, `rationale`, AND `decision_hygiene` are all
 *    non-empty AFTER TRIMMING. Mirrors the composer's prose-validation
 *    gate at phase3-blocks.ts:469-486, which calls `.trim()` on each
 *    field before length-checking. A `"   "` (whitespace-only) entry is
 *    treated as empty and does NOT count as usable. The delta against
 *    `*_count` exposes stub entries the LLM emitted but the composer
 *    would drop on prose grounds — independent of the RC-2 confidence-
 *    lookup gate, which is observable separately via the input-density
 *    confidence delta.
 *  - output_scenario_contexts_count / _flip_thresholds_count: drop at
 *    the graph-ref lookup gate when `enrichment.graph` is absent.
 *  - output_bias_findings_count / _key_assumptions_count
 *    / _decision_quality_prompts_count / _story_headlines_count: count
 *    drives card emission count.
 *  - output_has_pre_mortem / _has_framing_check: optional sub-objects;
 *    presence drives whether the corresponding card considers emission.
 */
interface OutputDensity {
  readonly output_narrative_summary_length: number;
  readonly output_robustness_explanation_summary_length: number;
  readonly output_robustness_stability_factors_count: number;
  readonly output_robustness_fragility_factors_count: number;
  readonly output_evidence_enhancements_count: number;
  readonly output_evidence_enhancements_usable_count: number;
  readonly output_scenario_contexts_count: number;
  readonly output_flip_thresholds_count: number;
  readonly output_bias_findings_count: number;
  readonly output_key_assumptions_count: number;
  readonly output_story_headlines_count: number;
  readonly output_decision_quality_prompts_count: number;
  readonly output_has_pre_mortem: boolean;
  readonly output_has_framing_check: boolean;
}

function computeDecisionReviewOutputDensity(
  output: Record<string, unknown>,
): OutputDensity {
  const narrative = typeof output.narrative_summary === 'string'
    ? output.narrative_summary
    : '';
  const robustness = readRecord(output.robustness_explanation);
  const robSummary = robustness !== null && typeof robustness.summary === 'string'
    ? robustness.summary
    : '';
  const stabilityFactors = robustness !== null && Array.isArray(robustness.stability_factors)
    ? robustness.stability_factors
    : [];
  const fragilityFactors = robustness !== null && Array.isArray(robustness.fragility_factors)
    ? robustness.fragility_factors
    : [];
  const evidenceEnh = readRecord(output.evidence_enhancements);
  // Mirror the composer's prose-validation gate at phase3-blocks.ts:469-486:
  // the composer trims `specific_action`, `rationale`, AND
  // `decision_hygiene` before checking length, so a whitespace-only field
  // like "   " is treated as empty and the block is dropped. The usable
  // count must apply the SAME trim to stay aligned — without it the
  // count over-reports composer emit potential. Independent of the RC-2
  // confidence lookup, which gates EvidenceBlock emission separately.
  let evidenceUsable = 0;
  if (evidenceEnh !== null) {
    for (const raw of Object.values(evidenceEnh)) {
      const e = readRecord(raw);
      if (e === null) continue;
      const specific = typeof e.specific_action === 'string' ? e.specific_action.trim() : '';
      const rationale = typeof e.rationale === 'string' ? e.rationale.trim() : '';
      const hygiene = typeof e.decision_hygiene === 'string' ? e.decision_hygiene.trim() : '';
      if (specific.length > 0 && rationale.length > 0 && hygiene.length > 0) {
        evidenceUsable++;
      }
    }
  }
  const scenarioCtx = readRecord(output.scenario_contexts);
  const flipThresholds = Array.isArray(output.flip_thresholds)
    ? output.flip_thresholds
    : [];
  const biasFindings = Array.isArray(output.bias_findings)
    ? output.bias_findings
    : [];
  const keyAssumptions = Array.isArray(output.key_assumptions)
    ? output.key_assumptions
    : [];
  const storyHeadlines = Array.isArray(output.story_headlines)
    ? output.story_headlines
    : [];
  const dqPrompts = Array.isArray(output.decision_quality_prompts)
    ? output.decision_quality_prompts
    : [];

  return {
    output_narrative_summary_length: narrative.length,
    output_robustness_explanation_summary_length: robSummary.length,
    output_robustness_stability_factors_count: stabilityFactors.length,
    output_robustness_fragility_factors_count: fragilityFactors.length,
    output_evidence_enhancements_count: evidenceEnh !== null ? Object.keys(evidenceEnh).length : 0,
    output_evidence_enhancements_usable_count: evidenceUsable,
    output_scenario_contexts_count: scenarioCtx !== null ? Object.keys(scenarioCtx).length : 0,
    output_flip_thresholds_count: flipThresholds.length,
    output_bias_findings_count: biasFindings.length,
    output_key_assumptions_count: keyAssumptions.length,
    output_story_headlines_count: storyHeadlines.length,
    output_decision_quality_prompts_count: dqPrompts.length,
    output_has_pre_mortem: readRecord(output.pre_mortem) !== null,
    output_has_framing_check: readRecord(output.framing_check) !== null,
  };
}

/**
 * Exported for contract testing only. Mirrors the private helper used by
 * the success-path emit site. Lets tests prove the payload shape without
 * round-tripping through the LLM mock.
 */
export const __testing__ = {
  computeDecisionReviewInputDensity,
  computeDecisionReviewOutputDensity,
};
