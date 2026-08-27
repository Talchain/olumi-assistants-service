/**
 * Resolve a CoachingCache from persisted sources before ContextPack assembly.
 *
 * Model-facing sources:
 *  - decision_review: the exact successful run_analysis HandlerFact selected
 *    for the display-analysis projection. An older/differently ordered fact
 *    is never substituted when the selected fact has no review.
 *  - last_coaching_signal: the finite, closed projection carried by a
 *    run_analysis fact in the same complete scenario carrier.
 *
 * Draft and last-signal sidecars remain persistence/telemetry mechanisms, but
 * they are not commit-bound to the canonical turn history at current tip. They
 * therefore cannot enter ContextPack until a separate authority licence is
 * established. Capped, degraded, omitted and forged fact carriers all fail
 * weak with an empty model-facing cache.
 *
 * Never throws; every failure surfaces as null sub-fields.
 */

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import {
  EMPTY_COACHING_CACHE,
  isCoachingSignalId,
  type CoachingCache,
  type DecisionReviewOutput,
  type LastCoachingSignal,
} from './types.js';
import {
  isReconciledScenarioAnalysisFactSet,
  type ScenarioAnalysisFactSet,
} from '../context/reconcile-scenario-analysis-facts.js';
import { isSuccessfulRunAnalysisFact } from '../context/freshness.js';

export interface CoachingAnalysisFactSources {
  /** Exact fact selected for the model-facing analysis projection. */
  readonly selectedAnalysisFact: HandlerFact | null;
  /** Exact scenario authority carrier; capped/degraded/forged fails weak. */
  readonly analysisFactSet?: ScenarioAnalysisFactSet;
}

/**
 * Read coaching state for a scenario. Safe: always resolves, never throws.
 */
export async function readCoachingCache(
  scenarioId: string,
  sources: CoachingAnalysisFactSources,
): Promise<CoachingCache> {
  const completeAnalysisFactSet =
    isReconciledScenarioAnalysisFactSet(
      sources.analysisFactSet,
      scenarioId,
    ) &&
    sources.analysisFactSet.status === 'complete'
      ? sources.analysisFactSet
      : null;
  const analysisFactChronology = completeAnalysisFactSet?.facts ?? [];
  // The selected fact must come from the same complete chronology. A detached
  // clone/direct caller cannot acquire Decision Review authority by assertion.
  const selectedAnalysisFact =
    completeAnalysisFactSet !== null &&
    sources.selectedAnalysisFact !== null &&
    analysisFactChronology.includes(sources.selectedAnalysisFact)
      ? sources.selectedAnalysisFact
      : null;
  const decisionReview = extractSelectedDecisionReview(selectedAnalysisFact);
  const lastSignal = extractLatestCoachingSignalFromFacts(
    analysisFactChronology,
  );

  if (decisionReview === null && lastSignal === null) {
    return EMPTY_COACHING_CACHE;
  }

  return {
    draft_coaching: null,
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
    // Signal markers describe a completed local analysis lifecycle event.
    // Partial/refused facts can carry arbitrary producer enrichment, so they
    // cannot license the marker even inside an otherwise attested page. Keep
    // walking: an older successful, locally stamped fact is still usable.
    if (!isSuccessfulRunAnalysisFact(fact)) continue;
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
      return projectValidSignal({
        signal_id: rawSignal,
        turn_id: rawTurn,
        produced_at: rawAt,
      });
    }
  }
  return null;
}

/** Closed prompt projection; strips scenario_id and any future sidecar keys. */
function projectValidSignal(value: LastCoachingSignal | null): LastCoachingSignal | null {
  if (
    value === null ||
    !isCoachingSignalId(value.signal_id) ||
    typeof value.turn_id !== 'string' ||
    !Number.isFinite(Date.parse(value.produced_at))
  ) {
    return null;
  }
  return {
    signal_id: value.signal_id,
    turn_id: value.turn_id,
    produced_at: value.produced_at,
  };
}

function isDecisionReviewOutput(value: unknown): value is DecisionReviewOutput {
  if (value === null || typeof value !== 'object') return false;
  // Decision Review is an open producer payload, but scenario identity is
  // owned by the surrounding reconciled fact carrier. Passing through a
  // nested `scenario_id` would let model-authored enrichment introduce a
  // second identity into prompt bytes. Preserve the artefact verbatim or
  // withhold it whole; never reshape it locally.
  if (containsScenarioIdKey(value, new Set<object>())) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.produced_at === 'string';
}

function containsScenarioIdKey(value: unknown, seen: Set<object>): boolean {
  if (value === null || typeof value !== 'object') return false;
  const object = value as object;
  if (seen.has(object)) return false;
  seen.add(object);
  for (const [key, child] of Object.entries(object)) {
    // Decision Review is an open model-authored object, so spelling is not a
    // provenance boundary. Treat ASCII case and separators as equivalent:
    // `scenario_id`, `scenarioId`, `scenario-id`, and case variants all name
    // the same forbidden second identity. The artefact remains exact-or-null.
    if (key.toLowerCase().replace(/[^a-z0-9]/g, '') === 'scenarioid') {
      return true;
    }
    if (containsScenarioIdKey(child, seen)) return true;
  }
  return false;
}
