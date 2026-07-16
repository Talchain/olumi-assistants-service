/**
 * Resolve a CoachingCache from persisted sources before ContextPack assembly.
 *
 * Sources:
 *  - draft_coaching: sidecar JSONL (logs/v5-draft-graph-coaching.jsonl),
 *    most recent record for scenario_id.
 *  - decision_review: most recent run_analysis HandlerFact with
 *    enrichment.decision_review present. Reached via priorFacts argument.
 *  - last_coaching_signal: merged from two sources and picked by newest
 *    produced_at:
 *      1. run_analysis handler facts (enrichment.coaching_signal_id).
 *         FIRST_ANALYSIS_COMPLETE attaches here.
 *      2. last-coaching-signal sidecar (per-scenario). Edit-handler signals
 *         (STALE_*, HIGH_SENSITIVITY_EDIT) write only here because edit
 *         HandlerFact variants have no enrichment field in the frozen
 *         schema.
 *    Merging by timestamp (not short-circuit) ensures an older
 *    analysis-turn signal does not mask a newer edit-turn signal; this is
 *    review feedback P1.1.
 *
 * Never throws; every failure surfaces as null sub-fields.
 */

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { readLatestDraftCoaching } from './draft-coaching-log.js';
import { readLatestLastCoachingSignal } from './last-coaching-signal-log.js';
import {
  EMPTY_COACHING_CACHE,
  isCoachingSignalId,
  type CoachingCache,
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
  const [draft, sidecarSignal] = await Promise.all([
    readLatestDraftCoaching(scenarioId),
    readLatestLastCoachingSignal(scenarioId),
  ]);
  const decisionReview = extractLatestDecisionReview(priorFacts);
  const factSignal = extractLatestCoachingSignalFromFacts(priorFacts);
  const lastSignal = pickNewestSignal(factSignal, sidecarSignal);

  if (draft === null && decisionReview === null && lastSignal === null) {
    return EMPTY_COACHING_CACHE;
  }

  return {
    draft_coaching: draft,
    decision_review: decisionReview,
    last_coaching_signal: lastSignal,
  };
}

/**
 * Walk facts newest-first to find the most recent run_analysis fact with
 * enrichment.decision_review set.
 *
 * Correctness note (V5 review cycle 2): `priorFacts` arrives newest-first
 * because `SupabaseSessionStore.readFactsFor` now applies
 * `ORDER BY created_at DESC`. The forward walk therefore returns the NEWEST
 * matching fact. An earlier revision of this function iterated backward
 * (`length - 1 → 0`) assuming facts were oldest-first; that assumption was
 * silently incorrect in production for two reasons: (a) `readFactsFor`
 * originally had no ORDER BY, so the order was undefined; (b) the upstream
 * caller passed `turn_id` into a row-id lookup, which made `priorFacts`
 * always empty. Both pre-existing bugs were fixed in cycle 2, and this
 * function's walk direction is now corrected to match the documented intent.
 */
function extractLatestDecisionReview(
  facts: readonly HandlerFact[],
): DecisionReviewOutput | null {
  for (const fact of facts) {
    if (fact.fact_type !== 'run_analysis') continue;
    const enrichment = fact.result.enrichment;
    if (enrichment === undefined) continue;
    const dr = enrichment.decision_review;
    if (isDecisionReviewOutput(dr)) return dr;
  }
  return null;
}

/**
 * Walk facts newest-first for the most recent enrichment.coaching_signal_id.
 * Returns null for edit-handler turns (their fact shape has no enrichment).
 * Same correctness note as `extractLatestDecisionReview` — forward walk
 * over newest-first `priorFacts`.
 */
function extractLatestCoachingSignalFromFacts(
  facts: readonly HandlerFact[],
): LastCoachingSignal | null {
  for (const fact of facts) {
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

/**
 * Merge the two signal sources by produced_at timestamp. ISO-8601 strings
 * sort lexicographically by time. When both are present, the newer wins;
 * ties resolve to the fact source (ties only happen by coincidence since
 * the enrichment write and the sidecar append are separate operations).
 * Tie resolution is not user-facing: both sources record the same signal
 * on the same turn, so picking either yields the same signal_id.
 */
function pickNewestSignal(
  factSignal: LastCoachingSignal | null,
  sidecarSignal: LastCoachingSignal | null,
): LastCoachingSignal | null {
  if (factSignal === null) return sidecarSignal;
  if (sidecarSignal === null) return factSignal;
  return sidecarSignal.produced_at > factSignal.produced_at
    ? sidecarSignal
    : factSignal;
}

function isDecisionReviewOutput(value: unknown): value is DecisionReviewOutput {
  if (value === null || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.produced_at === 'string';
}
