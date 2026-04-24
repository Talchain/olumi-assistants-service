/**
 * V5 Task 1.4 — analysis state fallback for follow-up turns.
 *
 * The HTTP request body carries `analysis_state` when the UI has it cached
 * client-side. On turns where the UI omits it but a prior `run_analysis`
 * handler DID run in this scenario, the handler persisted its result into a
 * `RunAnalysisHandlerFact.result`. This module builds a minimal fallback
 * summary from that fact so Sonnet is not blind to prior analysis on
 * conversational follow-up turns.
 *
 * Staleness handling (Approach A from the Phase 0 plan): fallback summaries
 * are ALWAYS flagged `loaded_from_prior_run_freshness_unknown`. The run
 * fact does not currently carry a graph hash, so the freshness of the
 * cached win_probabilities cannot be proven against the current graph.
 * Stamping unknown-freshness is honest; the routing prompt is expected to
 * treat this flag as "reference material, not fresh results".
 *
 * Non-goals:
 *   - No new DB reads — `prior_facts` is already loaded by `buildTurnContext`
 *     for the coaching cache.
 *   - No robustness/driver reconstruction — the fact doesn't carry them.
 *     `top_drivers` and `fragile_edges` come through empty; the prompt can
 *     trigger a re-run if it needs those fields.
 *   - Option labels are not stored on the fact. Option IDs stand in as
 *     labels; the routing prompt can resolve them via the ContextPack graph
 *     when the user asks about a specific option.
 */

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import type { AnalysisResponseSummary } from '../../orchestrator/context/analysis-compact.js';

export const FALLBACK_STALENESS_REASON = 'loaded_from_prior_run_freshness_unknown';

/**
 * Scan prior facts (newest-first, same order as `readRecent`) for the most
 * recent non-noop `run_analysis` fact and project it into an
 * `AnalysisResponseSummary`. Returns null when no usable prior analysis
 * exists.
 *
 * The projection is deliberately thin: only fields the fact actually carries
 * are populated. Absent fields take safe defaults (`top_drivers: []`,
 * `fragile_edge_count: 0`, `robustness_level: 'unknown'`).
 */
export function buildAnalysisFromPriorFacts(
  priorFacts: readonly HandlerFact[],
): AnalysisResponseSummary | null {
  const fact = priorFacts.find(
    (f) => f.fact_type === 'run_analysis' && f.noop === false,
  );
  if (!fact || fact.fact_type !== 'run_analysis') return null;

  const result = fact.result;
  const winProbabilities = result.win_probabilities ?? {};

  // Sort option entries by probability desc, tiebreak by option_id lex.
  const sortedEntries = Object.entries(winProbabilities).sort((a, b) => {
    const diff = b[1] - a[1];
    if (diff !== 0) return diff;
    return a[0].localeCompare(b[0]);
  });

  // If the fact declared a leading_option_id, ensure it's the winner even
  // when win_probabilities is absent or ties on probability. Otherwise fall
  // back to the first sorted entry.
  const leadingFromFact = result.leading_option_id;
  let winner: AnalysisResponseSummary['winner'];
  if (leadingFromFact) {
    const leadingProb =
      typeof winProbabilities[leadingFromFact] === 'number'
        ? winProbabilities[leadingFromFact]
        : 0;
    winner = {
      option_id: leadingFromFact,
      option_label: leadingFromFact,
      win_probability: leadingProb,
    };
  } else if (sortedEntries.length > 0) {
    const [optionId, prob] = sortedEntries[0]!;
    winner = {
      option_id: optionId,
      option_label: optionId,
      win_probability: prob,
    };
  } else {
    // No winner extractable — caller should treat this fact as unusable.
    return null;
  }

  const options: AnalysisResponseSummary['options'] = sortedEntries.map(
    ([optionId, prob]) => ({
      option_id: optionId,
      option_label: optionId,
      win_probability: prob,
      outcome_mean: 0,
    }),
  );

  const margin =
    sortedEntries.length >= 2
      ? (sortedEntries[0]![1] - sortedEntries[1]![1])
      : null;

  return {
    winner,
    options,
    top_drivers: [],
    robustness_level: 'unknown',
    fragile_edge_count: 0,
    margin,
    analysis_status: 'complete',
  };
}
