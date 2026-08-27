/**
 * Resolve a CoachingCache from persisted sources before ContextPack assembly.
 *
 * Sources:
 *  - draft_coaching: sidecar JSONL (logs/v5-draft-graph-coaching.jsonl),
 *    most recent record for scenario_id.
 *  - decision_review: the exact successful run_analysis HandlerFact selected
 *    for the display-analysis projection. An older/differently ordered fact
 *    is never substituted when the selected fact has no review.
 *  - last_coaching_signal: merged from two sources:
 *      1. run_analysis handler facts (enrichment.coaching_signal_id).
 *         FIRST_ANALYSIS_COMPLETE attaches here. The full validated scenario
 *         chronology remains available independently of display selection.
 *      2. last-coaching-signal sidecar (per-scenario). Edit-handler signals
 *         (STALE_*, HIGH_SENSITIVITY_EDIT) write only here because edit
 *         HandlerFact variants have no enrichment field in the frozen
 *         schema.
 *    The validated fact page supplies its DB-newest signal; merging that with
 *    the sidecar by produced_at (not short-circuit) ensures an older
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

export interface CoachingAnalysisFactSources {
  /** Exact fact selected for the model-facing analysis projection. */
  readonly selectedAnalysisFact: HandlerFact | null;
  /** Complete validated scenario chronology used only for coaching signals. */
  readonly analysisFactChronology: readonly HandlerFact[];
}

/**
 * Read coaching state for a scenario. Safe: always resolves, never throws.
 */
export async function readCoachingCache(
  scenarioId: string,
  sources: CoachingAnalysisFactSources,
): Promise<CoachingCache> {
  const [draft, sidecarSignal] = await Promise.all([
    readLatestDraftCoaching(scenarioId),
    readLatestLastCoachingSignal(scenarioId),
  ]);
  // The selected fact must come from the same complete chronology. A detached
  // clone/direct caller cannot acquire Decision Review authority by assertion.
  const selectedAnalysisFact =
    sources.selectedAnalysisFact !== null &&
    sources.analysisFactChronology.includes(sources.selectedAnalysisFact)
      ? sources.selectedAnalysisFact
      : null;
  const decisionReview = extractSelectedDecisionReview(selectedAnalysisFact);
  const factSignal = extractLatestCoachingSignalFromFacts(
    sources.analysisFactChronology,
  );
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
 * Read Decision Review only from the exact fact selected for display. The
 * selection itself is owned by the shared run-analysis selector; this reader
 * must not create a second chronology by walking the database page.
 */
function extractSelectedDecisionReview(
  fact: HandlerFact | null,
): DecisionReviewOutput | null {
  if (fact === null || fact.fact_type !== 'run_analysis') return null;
  const enrichment = fact.result.enrichment;
  if (enrichment === undefined) return null;
  const dr = enrichment.decision_review;
  return isDecisionReviewOutput(dr) ? dr : null;
}

/**
 * Walk facts newest-first for the most recent enrichment.coaching_signal_id.
 * Returns null for edit-handler turns (their fact shape has no enrichment).
 * The scenario carrier is DB-created-at newest-first, so a forward walk keeps
 * fact chronology independent of the computed_at selector used for display.
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
