/**
 * V5 coaching — pick the flip-threshold evidence (`enrichment.flip_thresholds`)
 * from the SAME run_analysis fact that the freshness/projection/robustness
 * layers selected, and summarise it for the `what_would_flip` composer.
 *
 * Why a shared selector matters
 * -----------------------------
 * Mirrors `pickLatestRawRobustness` / `pickLatestDecisionReview` so every
 * grounding layer reads from one fact. The canonical `selectRunAnalysisFact`
 * selects the NEWEST successful run_analysis fact in `prior_facts`. Pinning
 * the flip summary onto the same selector closes the drift class where one
 * layer reads a newer fact and another reads an older one. Graph-hash-vs-
 * live-graph matching is proved separately by the freshness derivation.
 *
 * Returns `null` when no successful run_analysis fact exists, when the
 * selected fact has no `result.enrichment`, or when the enrichment carries
 * no flip thresholds (empty `summariseFlipEntries` → `'none'`). `null`
 * makes the composer fall back to its pre-flip behaviour verbatim.
 */

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { selectRunAnalysisFact } from '../context/freshness.js';
import {
  readFlipEntries,
  summariseFlipEntries,
  type FlipSummary,
} from '../compose/flip-proposal.js';

export function pickLatestFlipSummary(
  priorFacts: readonly HandlerFact[],
): FlipSummary | null {
  const selected = selectRunAnalysisFact(priorFacts);
  if (selected === null) return null;
  const fact = selected.fact;
  if (fact.fact_type !== 'run_analysis') return null;
  const enrichment = fact.result.enrichment;
  if (enrichment == null || typeof enrichment !== 'object') return null;

  const summary = summariseFlipEntries(readFlipEntries(enrichment));
  // No flip thresholds in the enrichment → nothing to ground honest copy on;
  // let the composer keep its existing robustness-band behaviour.
  if (summary.overall_status === 'none') return null;
  return summary;
}
