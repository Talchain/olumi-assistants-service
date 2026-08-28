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
  isReconciledScenarioAnalysisFactSet,
  isScenarioAnalysisReasoningAuthority,
  isoInstantOrderKey,
  type ScenarioAnalysisFactSet,
} from '../context/reconcile-scenario-analysis-facts.js';
import { selectRunAnalysisFact } from '../context/freshness.js';
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
  analysisFactSet?: ScenarioAnalysisFactSet,
): Promise<CoachingCache> {
  const [draft, sidecarSignal] = await Promise.all([
    readLatestDraftCoaching(scenarioId),
    readLatestLastCoachingSignal(scenarioId),
  ]);
  // Attestation first (a direct caller must not manufacture authority), then
  // the reasoning-authority allow-list. `capped` qualifies: it is a validated
  // durable page carrying the newest bounded window, and its newest fact is
  // exactly the analysis whose Decision Review the user is looking at.
  const authoritativeAnalysisFactSet =
    isReconciledScenarioAnalysisFactSet(analysisFactSet, scenarioId) &&
    isScenarioAnalysisReasoningAuthority(analysisFactSet)
      ? analysisFactSet
      : null;
  const analysisFactChronology = authoritativeAnalysisFactSet?.facts ?? [];
  const selectedAnalysisFact =
    selectRunAnalysisFact(analysisFactChronology)?.fact ?? null;
  const decisionReview = extractSelectedDecisionReview(selectedAnalysisFact);
  const factSignal = extractLatestCoachingSignalFromFacts(analysisFactChronology);
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
 * Merge the two signal sources by represented instant. When both are present,
 * the newer wins;
 * ties resolve to the fact source (ties only happen by coincidence since
 * the enrichment write and the sidecar append are separate operations).
 * Tie resolution is not user-facing: both sources record the same signal
 * on the same turn, so picking either yields the same signal_id.
 */
function pickNewestSignal(
  factSignal: LastCoachingSignal | null,
  sidecarSignal: LastCoachingSignal | null,
): LastCoachingSignal | null {
  const factInstant =
    factSignal === null ? null : isoInstantOrderKey(factSignal.produced_at);
  const sidecarInstant =
    sidecarSignal === null
      ? null
      : isoInstantOrderKey(sidecarSignal.produced_at);
  if (factInstant !== null && sidecarInstant !== null) {
    return sidecarInstant > factInstant ? sidecarSignal! : factSignal!;
  }
  if (factInstant !== null) return factSignal!;
  if (sidecarInstant !== null) return sidecarSignal!;
  // A malformed timestamp cannot establish chronology or mint prompt-facing
  // coaching state, even when it is the only source available.
  return null;
}

function isDecisionReviewOutput(value: unknown): value is DecisionReviewOutput {
  if (value === null || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.produced_at === 'string';
}
