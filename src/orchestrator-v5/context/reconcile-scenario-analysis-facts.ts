/**
 * Reconcile the ordinary bounded turn-window facts with one uncached,
 * scenario-scoped read of the durable `run_analysis` fact set.
 *
 * This module is deliberately pure. It owns no analysis/science policy: it
 * establishes only whether the existing selectors have a complete fact set
 * from which to apply their already-shipped status and chronology rules.
 * A capped prefix is never reasoning authority.
 */

import {
  HandlerFactSchema,
  type HandlerFact,
} from '@talchain/schemas/orchestrator';

/** Sole bounded scenario-history wall for model-facing analysis authority. */
export const SCENARIO_ANALYSIS_FACT_CAP = 20;

/** One extra row proves that the durable fact set exceeds the authority cap. */
export const SCENARIO_ANALYSIS_FACT_LOOKAHEAD_LIMIT =
  SCENARIO_ANALYSIS_FACT_CAP + 1;

export type ScenarioAnalysisFactSetStatus =
  | 'complete'
  | 'capped'
  | 'degraded';

export type ScenarioAnalysisFactSetDegradedReason =
  | 'durable_unavailable_hot_window_incomplete'
  | 'durable_contract_invalid'
  | 'durable_zero_conflicts_with_hot_fact'
  | 'hot_window_contract_invalid';

export type ScenarioAnalysisFactSet =
  | {
      readonly status: 'complete';
      readonly source: 'scenario' | 'complete_hot_window';
      readonly facts: readonly HandlerFact[];
      readonly total_count: number;
    }
  | {
      readonly status: 'capped';
      readonly facts: readonly [];
      readonly total_count: number;
    }
  | {
      readonly status: 'degraded';
      readonly facts: readonly [];
      readonly reason: ScenarioAnalysisFactSetDegradedReason;
      readonly total_count?: number;
    };

/**
 * Result of the uncached exact-count database read. The store validates row
 * metadata and strict payloads before returning `ok`; this pure layer repeats
 * the semantic fact/scenario checks so a malformed test double or future
 * implementation cannot acquire authority by satisfying the TypeScript type.
 */
export type DurableScenarioAnalysisFactRead =
  | {
      readonly status: 'ok';
      readonly scenario_id: string;
      readonly query_limit: number;
      readonly total_count: number;
      readonly facts: readonly unknown[];
    }
  | {
      readonly status: 'degraded';
      readonly reason: 'unavailable' | 'contract_invalid';
    };

export interface ReconcileScenarioAnalysisFactsInput {
  readonly scenarioId: string;
  readonly hotWindowFacts: readonly unknown[];
  /** True only when both the turn-window and fact reads succeeded. */
  readonly hotWindowReadOk: boolean;
  readonly loadedTurnCount: number;
  /** Exact pre-cap scenario turn count; null/undefined means unknown. */
  readonly priorTurnsTotal?: number | null;
  /** Omission is an unavailable durable port, never an empty fact set. */
  readonly durableRead?: DurableScenarioAnalysisFactRead;
}

interface ClassifiedHotFacts {
  readonly eligible: readonly HandlerFact[];
  readonly invalid: boolean;
}

/**
 * Select one coherent scenario-level analysis fact set.
 *
 * A validated, complete durable read replaces the hot window rather than
 * merging with it. This prevents overlap duplication while retaining
 * genuinely distinct byte-identical durable facts. Hot-window recovery is
 * permitted only for an unavailable read and only when exact turn coverage
 * proves that the window is the whole scenario.
 */
export function reconcileScenarioAnalysisFacts(
  input: ReconcileScenarioAnalysisFactsInput,
): ScenarioAnalysisFactSet {
  const hot = classifyHotFacts(input.hotWindowFacts, input.scenarioId);
  const durable = input.durableRead;

  if (durable?.status === 'ok') {
    const durableContract = validateDurableContract(durable, input.scenarioId);
    if (durableContract === null) {
      return degraded('durable_contract_invalid');
    }

    if (durable.total_count > SCENARIO_ANALYSIS_FACT_CAP) {
      return freezeCapped(durable.total_count);
    }

    // A clean durable zero cannot erase a valid fact already loaded from the
    // same scenario. Preserve neither source as authority until the read
    // disagreement is resolved.
    if (durableContract.length === 0 && hot.eligible.length > 0) {
      return degraded(
        'durable_zero_conflicts_with_hot_fact',
        durable.total_count,
      );
    }

    return freezeComplete(
      durableContract,
      'scenario',
      durable.total_count,
    );
  }

  if (durable?.status === 'degraded' && durable.reason === 'contract_invalid') {
    return degraded('durable_contract_invalid');
  }

  // A malformed hot fact set cannot author either absence or completeness.
  if (hot.invalid) {
    return degraded('hot_window_contract_invalid');
  }

  if (
    input.hotWindowReadOk &&
    hasCompleteTurnCoverage(input.priorTurnsTotal, input.loadedTurnCount)
  ) {
    if (hot.eligible.length > SCENARIO_ANALYSIS_FACT_CAP) {
      return freezeCapped(hot.eligible.length);
    }
    return freezeComplete(
      hot.eligible,
      'complete_hot_window',
      hot.eligible.length,
    );
  }

  return degraded('durable_unavailable_hot_window_incomplete');
}

function validateDurableContract(
  read: Extract<DurableScenarioAnalysisFactRead, { readonly status: 'ok' }>,
  expectedScenarioId: string,
): readonly HandlerFact[] | null {
  if (
    read.scenario_id !== expectedScenarioId ||
    read.query_limit !== SCENARIO_ANALYSIS_FACT_LOOKAHEAD_LIMIT ||
    !Number.isSafeInteger(read.total_count) ||
    read.total_count < 0 ||
    !Array.isArray(read.facts) ||
    read.facts.length > SCENARIO_ANALYSIS_FACT_LOOKAHEAD_LIMIT
  ) {
    return null;
  }

  const expectedLength =
    read.total_count <= SCENARIO_ANALYSIS_FACT_CAP
      ? read.total_count
      : SCENARIO_ANALYSIS_FACT_LOOKAHEAD_LIMIT;
  if (read.facts.length !== expectedLength) return null;

  const out: HandlerFact[] = [];
  for (const candidate of read.facts) {
    const fact = parseEligibleRunAnalysisFact(candidate, expectedScenarioId);
    if (fact === null) return null;
    out.push(fact);
  }
  return Object.freeze(out);
}

function classifyHotFacts(
  candidates: readonly unknown[],
  expectedScenarioId: string,
): ClassifiedHotFacts {
  const eligible: HandlerFact[] = [];
  let invalid = false;

  for (const candidate of candidates) {
    // The hot window contains every fact type. Corruption in an unrelated fact
    // is not analysis authority and must not silently broaden this carrier into
    // a validator for the generic prior-fact channel. Only a row that claims
    // to be `run_analysis` enters this contract.
    if (
      candidate === null ||
      typeof candidate !== 'object' ||
      Array.isArray(candidate) ||
      (candidate as { readonly fact_type?: unknown }).fact_type !==
        'run_analysis'
    ) {
      continue;
    }
    const parsed = HandlerFactSchema.safeParse(candidate);
    if (!parsed.success) {
      invalid = true;
      continue;
    }

    const fact = parsed.data;
    if (fact.fact_type !== 'run_analysis' || fact.noop) continue;
    const eligibleFact = parseEligibleRunAnalysisFact(fact, expectedScenarioId);
    if (eligibleFact === null) {
      invalid = true;
      continue;
    }
    eligible.push(eligibleFact);
  }

  return { eligible: Object.freeze(eligible), invalid };
}

function parseEligibleRunAnalysisFact(
  candidate: unknown,
  expectedScenarioId: string,
): HandlerFact | null {
  const parsed = HandlerFactSchema.safeParse(candidate);
  if (!parsed.success) return null;
  const fact = parsed.data;
  if (fact.fact_type !== 'run_analysis' || fact.noop) return null;

  const result = fact.result;
  if (
    result === null ||
    typeof result !== 'object' ||
    Array.isArray(result) ||
    (result as { readonly scenario_id?: unknown }).scenario_id !==
      expectedScenarioId
  ) {
    return null;
  }
  return fact;
}

function hasCompleteTurnCoverage(
  priorTurnsTotal: number | null | undefined,
  loadedTurnCount: number,
): boolean {
  return (
    Number.isSafeInteger(priorTurnsTotal) &&
    (priorTurnsTotal as number) >= 0 &&
    Number.isSafeInteger(loadedTurnCount) &&
    loadedTurnCount >= 0 &&
    (priorTurnsTotal as number) <= loadedTurnCount
  );
}

function freezeComplete(
  facts: readonly HandlerFact[],
  source: 'scenario' | 'complete_hot_window',
  totalCount: number,
): ScenarioAnalysisFactSet {
  return Object.freeze({
    status: 'complete',
    source,
    facts: Object.freeze([...facts]),
    total_count: totalCount,
  });
}

function freezeCapped(totalCount: number): ScenarioAnalysisFactSet {
  return Object.freeze({
    status: 'capped',
    facts: Object.freeze([]) as readonly [],
    total_count: totalCount,
  });
}

function degraded(
  reason: ScenarioAnalysisFactSetDegradedReason,
  totalCount?: number,
): ScenarioAnalysisFactSet {
  return Object.freeze({
    status: 'degraded',
    facts: Object.freeze([]) as readonly [],
    reason,
    ...(totalCount !== undefined ? { total_count: totalCount } : {}),
  });
}
