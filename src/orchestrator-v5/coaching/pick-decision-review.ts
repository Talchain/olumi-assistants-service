/**
 * V5 coaching — pick the `decision_review` enrichment record from the
 * SAME run_analysis fact that the freshness/projection layer selected.
 *
 * Why a shared selector matters
 * -----------------------------
 * `context.prior_facts` is delivered **newest-first** by the loader
 * convention, so an ad-hoc reverse walk picks the OLDEST successful
 * run_analysis fact instead of the newest — exactly the regression
 * Codex flagged on PR #190. Worse, after an edit-then-rerun, the older
 * pre-edit fact has a `graph_hash_at_run` that no longer matches the
 * live graph, and the freshness verdict on the current turn would be
 * `'stale'` — but the gate gates on `freshness === 'fresh'`, so the
 * stale fact's decision_review must NEVER reach `composeEvidenceGap`.
 *
 * Calling the canonical `selectRunAnalysisFact` here keeps every layer
 * (freshness derivation, analysis projection, advice gate grounding)
 * pointed at the same single fact — eliminating any drift class that
 * could surface stale pre-edit evidence as grounded post-edit advice.
 *
 * Returns `null` when:
 *   - no successful run_analysis fact exists in prior_facts,
 *   - the selected fact has no `result.enrichment`,
 *   - the `enrichment.decision_review` field is missing / not a plain
 *     object (defensive against passthrough payload drift).
 *
 * The advice gate falls back to its projection-only behaviour in any
 * of those cases.
 */

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { selectRunAnalysisFact } from '../context/freshness.js';

/**
 * Return the `decision_review` record from the LATEST successful
 * `run_analysis` fact in `priorFacts`, or `null` when none is
 * available / well-formed.
 *
 * Threading: the turn-executor invokes this when assembling the advice
 * gate input. Only consulted when the freshness verdict has already
 * gated the turn as `'fresh'`, so a stale-pre-edit fact cannot be
 * served (the gate short-circuits before this helper is read).
 */
export function pickLatestDecisionReview(
  priorFacts: readonly HandlerFact[],
): Record<string, unknown> | null {
  const selected = selectRunAnalysisFact(priorFacts);
  if (selected === null) return null;
  // `selectRunAnalysisFact` already filters to noop=false run_analysis
  // facts whose status is missing or canonical-success. The
  // fact_type narrowing below is for TypeScript only — at runtime the
  // selector has already confirmed it.
  const fact = selected.fact;
  if (fact.fact_type !== 'run_analysis') return null;
  const enrichment = fact.result.enrichment;
  if (enrichment == null || typeof enrichment !== 'object') return null;
  const dr = (enrichment as Record<string, unknown>)['decision_review'];
  if (dr == null || typeof dr !== 'object' || Array.isArray(dr)) return null;
  return dr as Record<string, unknown>;
}
