/**
 * Resolve a CoachingCache from persisted sources before ContextPack assembly.
 *
 * Sources:
 *  - draft_coaching: sidecar JSONL (logs/v5-draft-graph-coaching.jsonl),
 *    most recent record for scenario_id.
 *  - decision_review: most recent run_analysis HandlerFact with
 *    enrichment.decision_review present. Reached via priorFacts argument.
 *  - last_coaching_signal: most recent signal fired for this scenario. Two
 *    sources feed this:
 *      1. run_analysis handler facts (enrichment.coaching_signal_id),
 *         because the FIRST_ANALYSIS_COMPLETE signal attaches to the
 *         successful run_analysis fact.
 *      2. the routing-log JSONL, filtered by scenario_id. Edit-handler
 *         signals (STALE_*, HIGH_SENSITIVITY_EDIT) write here because the
 *         edit HandlerFact variants have no enrichment field in the frozen
 *         schema. The routing-log scan is the source-of-truth for those
 *         signals; the fact-enrichment path is a faster check for
 *         run_analysis turns that always have a fact with enrichment.
 *
 * Linear scan of routing-log is fine at PoC volumes.
 */

import { readFile } from 'node:fs/promises';

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { log } from '../../utils/telemetry.js';
import { DEFAULT_ROUTING_LOG_PATH } from '../routing/routing-log.js';

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
  routingLogPath: string = DEFAULT_ROUTING_LOG_PATH,
): Promise<CoachingCache> {
  const draft = await readLatestDraftCoaching(scenarioId);
  const decisionReview = extractLatestDecisionReview(priorFacts);
  const signalFromFacts = extractLatestCoachingSignalFromFacts(priorFacts);
  const signalFromLog = signalFromFacts === null
    ? await extractLatestCoachingSignalFromRoutingLog(scenarioId, routingLogPath)
    : null;
  const lastSignal = signalFromFacts ?? signalFromLog;

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
function extractLatestCoachingSignalFromFacts(
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

/**
 * Scan the routing-log JSONL for the most recent coaching_signal_id rows
 * matching the scenario. Returns null on file-not-found, parse errors, or
 * when no matching row carries a signal. This is the only persistence path
 * for edit-handler signals because edit HandlerFact variants have no
 * enrichment field (schema-frozen).
 */
async function extractLatestCoachingSignalFromRoutingLog(
  scenarioId: string,
  filePath: string,
): Promise<LastCoachingSignal | null> {
  let contents: string;
  try {
    contents = await readFile(filePath, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      log.warn(
        { scenario_id: scenarioId, file_path: filePath, err: (err as Error).message },
        'V5 routing-log read failed during coaching-cache resolve, returning null',
      );
    }
    return null;
  }

  let latest: LastCoachingSignal | null = null;
  for (const line of contents.split('\n')) {
    if (line.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (parsed === null || typeof parsed !== 'object') continue;
    const obj = parsed as Record<string, unknown>;
    if (obj.scenario_id !== scenarioId) continue;
    const signalId = obj.coaching_signal_id;
    if (!isCoachingSignalId(signalId)) continue;
    if (typeof obj.turn_id !== 'string' || typeof obj.created_at !== 'string') continue;
    if (latest === null || obj.created_at >= latest.produced_at) {
      latest = {
        signal_id: signalId,
        turn_id: obj.turn_id,
        produced_at: obj.created_at,
      };
    }
  }
  return latest;
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
