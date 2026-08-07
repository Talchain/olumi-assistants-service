/**
 * V5 coaching — pick the raw `enrichment.robustness` signals from the
 * SAME run_analysis fact that the freshness/projection layer selected.
 *
 * Why a shared selector matters
 * -----------------------------
 * Mirrors `pickLatestDecisionReview` so every grounding layer (freshness,
 * projection, decision_review, raw robustness) reads from the same fact.
 * The canonical `selectRunAnalysisFact` selects the NEWEST successful
 * run_analysis fact in `prior_facts` — it does NOT itself filter by
 * graph hash. Graph-hash-vs-live-graph matching is proved separately by
 * the freshness derivation, and the advice gate already short-circuits
 * to `not_fresh` unless `freshness === 'fresh'`. Pinning every layer
 * onto the same selector closes the drift class where one layer reads a
 * newer fact and another reads an older one.
 *
 * Why only `level` + `near_tie.is_tie`
 * ------------------------------------
 * These are the two raw signals the post-analysis advice gate needs to
 * keep user-facing copy honest when the projected band has been
 * canonicalised. `level` is schema-defined; `near_tie.is_tie` is read
 * defensively via the passthrough `[k: string]: unknown` index on the
 * envelope's robustness shape — present only when upstream emits it,
 * `null` otherwise. No schema change is implied.
 *
 * Returns `null` when no successful run_analysis fact exists, when the
 * selected fact has no `result.enrichment.robustness`, or when neither
 * raw signal is reachable as a useable value.
 */

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { selectRunAnalysisFact } from '../context/freshness.js';

export interface RawRobustnessSignals {
  /** Raw `enrichment.robustness.level` string when present (lower-cased). */
  readonly level: string | null;
  /** Raw `enrichment.robustness.near_tie.is_tie === true` flag — strong override. */
  readonly near_tie_is_tie: boolean;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * Normalise a RAW `robustness` object into {@link RawRobustnessSignals}.
 *
 * Shape-agnostic on purpose (S4 round 5). The same two raw signals live at
 * two different addresses depending on which pipeline holds the analysis:
 *
 * - V5 prior-facts: `fact.result.enrichment.robustness`
 * - V4 deterministic ctx: `ctx.analysis.robustness` (the PLoT `/v2/run`
 *   envelope carries it at the top level — see `V2RunResponseEnvelope`)
 *
 * Before this existed, only the V5 address had a reader, so every V4
 * composer was structurally UNABLE to consult the `near_tie.is_tie`
 * override and reinvented closeness from a local threshold instead. That
 * is the round-5 defect class: a surface reinvents the classification
 * precisely because the shared signal is out of reach at its call site.
 * One normaliser, two addresses.
 *
 * Returns `null` when neither raw signal is reachable as a useable value,
 * which callers treat exactly like "no raw signal" (margin-only verdict).
 */
export function readRawRobustnessSignals(
  robustnessValue: unknown,
): RawRobustnessSignals | null {
  const robustness = asObject(robustnessValue);
  if (robustness === null) return null;

  const rawLevel = robustness['level'];
  const level = typeof rawLevel === 'string' && rawLevel.trim().length > 0
    ? rawLevel.toLowerCase().trim()
    : null;

  const nearTie = asObject(robustness['near_tie']);
  const near_tie_is_tie = nearTie !== null && nearTie['is_tie'] === true;

  if (level === null && !near_tie_is_tie) return null;
  return { level, near_tie_is_tie };
}

export function pickLatestRawRobustness(
  priorFacts: readonly HandlerFact[],
): RawRobustnessSignals | null {
  const selected = selectRunAnalysisFact(priorFacts);
  if (selected === null) return null;
  const fact = selected.fact;
  if (fact.fact_type !== 'run_analysis') return null;
  const enrichment = asObject(fact.result.enrichment);
  if (enrichment === null) return null;
  // Delegate: ONE normaliser, so the V4 and V5 addresses can never disagree
  // about what `near_tie.is_tie` means.
  return readRawRobustnessSignals(enrichment['robustness']);
}
