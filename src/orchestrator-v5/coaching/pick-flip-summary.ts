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
  readFlipClaimPosture,
  type FlipClaimPosture,
} from '../context/flip-threshold-rows.js';
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

/**
 * ROADMAP 2.278 — the same canonical fact's answer to "may user-facing copy
 * claim this result could flip?".
 *
 * Deliberately reads the SAME `selectRunAnalysisFact` as
 * {@link pickLatestFlipSummary} / `pickLatestRawRobustness` /
 * `pickLatestDecisionReview`, so the flip posture and the robustness signal a
 * composer reasons over always come from ONE fact. A posture derived from a
 * newer fact than the robustness band it is correcting would be a fresh
 * instance of exactly the drift this selector family exists to close.
 *
 * Returns `undefined` — not `'permitted'` — when there is no run_analysis fact
 * or no enrichment, so a caller can distinguish "nothing to say" from "the run
 * said a claim is allowed". Both are treated identically downstream today; the
 * distinction is kept because collapsing them would make a future "we had no
 * evidence" telemetry question unanswerable.
 */
export function pickLatestFlipClaimPosture(
  priorFacts: readonly HandlerFact[],
): FlipClaimPosture | undefined {
  const selected = selectRunAnalysisFact(priorFacts);
  if (selected === null) return undefined;
  const fact = selected.fact;
  if (fact.fact_type !== 'run_analysis') return undefined;
  const enrichment = fact.result.enrichment;
  if (enrichment == null || typeof enrichment !== 'object') return undefined;
  return readFlipClaimPosture(enrichment);
}
