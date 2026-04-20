/**
 * Resolve a CoachingCache from persisted sources before ContextPack assembly.
 *
 * Sources:
 *  - draft_coaching: sidecar JSONL (logs/v5-draft-graph-coaching.jsonl),
 *    most recent record for scenario_id.
 *  - decision_review: most recent run_analysis HandlerFact with
 *    enrichment.decision_review present. Passed in by the caller (turn
 *    executor) since HandlerFact readers live at that layer.
 *  - last_coaching_signal: most recent fact with
 *    enrichment.coaching_signal_id set.
 *
 * Pure function over the injected inputs; I/O (sidecar read) lives in
 * readLatestDraftCoaching and is awaited before calling this helper.
 */

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { readLatestDraftCoaching } from './draft-coaching-log.js';
import {
  EMPTY_COACHING_CACHE,
  type CoachingCache,
  type CoachingSignalId,
  type DecisionReviewOutput,
  type LastCoachingSignal,
} from './types.js';

/**
 * Read coaching state for a scenario. Safe: always resolves, never throws.
 */
export async function readCoachingCache(
  scenarioId: string,
  priorFacts: readonly HandlerFact[] = [],
): Promise<CoachingCache> {
  const draft = await readLatestDraftCoaching(scenarioId);
  const decisionReview = extractLatestDecisionReview(priorFacts);
  const lastSignal = extractLatestCoachingSignal(priorFacts);

  if (draft === null && decisionReview === null && lastSignal === null) {
    return EMPTY_COACHING_CACHE;
  }

  return {
    draft_coaching: draft,
    decision_review: decisionReview,
    last_coaching_signal: lastSignal,
  };
}

/** Walk facts newest-first to find the most recent run_analysis fact with
 *  enrichment.decision_review set. */
function extractLatestDecisionReview(
  facts: readonly HandlerFact[],
): DecisionReviewOutput | null {
  for (let i = facts.length - 1; i >= 0; i--) {
    const fact = facts[i];
    if (fact.fact_type !== 'run_analysis') continue;
    const enrichment = fact.result.enrichment;
    if (enrichment === undefined) continue;
    const dr = enrichment.decision_review;
    if (isDecisionReviewOutput(dr)) return dr;
  }
  return null;
}

/** Walk facts newest-first to find the most recent enrichment.coaching_signal_id. */
function extractLatestCoachingSignal(
  facts: readonly HandlerFact[],
): LastCoachingSignal | null {
  for (let i = facts.length - 1; i >= 0; i--) {
    const fact = facts[i];
    if (fact.fact_type !== 'run_analysis') continue;
    const enrichment = fact.result.enrichment;
    if (enrichment === undefined) continue;
    const rawSignal = enrichment.coaching_signal_id;
    const rawTurn = enrichment.coaching_signal_turn_id;
    const rawAt = enrichment.coaching_signal_produced_at;
    if (
      isCoachingSignalId(rawSignal) &&
      typeof rawTurn === 'string' &&
      typeof rawAt === 'string'
    ) {
      return { signal_id: rawSignal, turn_id: rawTurn, produced_at: rawAt };
    }
  }
  return null;
}

function isCoachingSignalId(value: unknown): value is CoachingSignalId {
  return (
    value === 'STALE_ANALYSIS_AFTER_EDIT' ||
    value === 'HIGH_SENSITIVITY_EDIT' ||
    value === 'FIRST_ANALYSIS_COMPLETE'
  );
}

function isDecisionReviewOutput(value: unknown): value is DecisionReviewOutput {
  if (value === null || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.produced_at === 'string';
}
