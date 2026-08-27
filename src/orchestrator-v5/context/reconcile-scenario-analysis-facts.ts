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
import { stableStringify } from '../../orchestrator/context/stable-stringify.js';
import type {
  HandlerFactWithTurn,
  IdentifiedHandlerFact,
} from '../types/handler-fact.js';

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
  | 'durable_unavailable'
  | 'durable_contract_invalid'
  | 'snapshot_conflict'
  | 'hot_window_contract_invalid';

export type ScenarioAnalysisFactSet =
  | {
      readonly status: 'complete';
      readonly source: 'scenario';
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
      readonly facts: readonly IdentifiedHandlerFact[];
    }
  | {
      readonly status: 'degraded';
      readonly reason: 'unavailable' | 'contract_invalid';
    };

export interface ReconcileScenarioAnalysisFactsInput {
  readonly scenarioId: string;
  readonly hotWindowFacts: readonly unknown[];
  /**
   * Persisted identities for the same bounded hot-window facts. Production
   * always supplies this. Parsed payloads without row identity are not enough
   * to prove that a byte-identical durable row is the same occurrence.
   */
  readonly hotWindowFactsWithIdentity?: readonly HandlerFactWithTurn[];
  /** Omission is an unavailable durable port, never an empty fact set. */
  readonly durableRead?: DurableScenarioAnalysisFactRead;
}

interface ClassifiedHotFacts {
  readonly eligible: readonly HandlerFact[];
  readonly identified: readonly IdentifiedHandlerFact[];
  readonly invalid: boolean;
}

/**
 * Select one coherent scenario-level analysis fact set.
 *
 * A validated, complete durable read replaces the hot window rather than
 * merging with it. This prevents overlap duplication while retaining
 * genuinely distinct byte-identical durable facts. The hot window is only a
 * one-way contradiction detector. Its turn read, exact count read and LRU
 * cache do not share a database snapshot, so it can never promote itself into
 * complete scenario authority when the durable read is unavailable.
 */
export function reconcileScenarioAnalysisFacts(
  input: ReconcileScenarioAnalysisFactsInput,
): ScenarioAnalysisFactSet {
  const hot = classifyHotFacts(
    input.hotWindowFacts,
    input.hotWindowFactsWithIdentity ?? [],
    input.scenarioId,
  );
  const durable = input.durableRead;

  if (durable?.status === 'ok') {
    const durableContract = validateDurableContract(durable, input.scenarioId);
    if (durableContract === null) {
      return degraded('durable_contract_invalid');
    }

    if (durable.total_count > SCENARIO_ANALYSIS_FACT_CAP) {
      return freezeCapped(durable.total_count);
    }

    // These reads are not one database snapshot. A persisted hot identity that
    // is absent from the complete durable page proves the page was already
    // stale by the time the window arrived. Payload equality is deliberately
    // irrelevant: two legitimate analysis runs can have byte-identical facts.
    if (hot.invalid) {
      return degraded('hot_window_contract_invalid', durable.total_count);
    }
    if (!identifiedSnapshotIncludes(durableContract, hot.identified)) {
      return degraded('snapshot_conflict', durable.total_count);
    }

    return freezeComplete(
      durableContract.map((entry) => entry.fact),
      'scenario',
      durable.total_count,
    );
  }

  if (durable?.status === 'degraded' && durable.reason === 'contract_invalid') {
    return degraded('durable_contract_invalid');
  }

  return degraded('durable_unavailable');
}

function stableFactKey(fact: HandlerFact): string | null {
  try {
    if (!isJsonSafe(fact, new Set<object>())) return null;
    const encoded = stableStringify(fact);
    return typeof encoded === 'string' ? encoded : null;
  } catch {
    return null;
  }
}

/** JSONB-backed facts can contain only finite, acyclic JSON values. */
function isJsonSafe(value: unknown, ancestors: Set<object>): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object') return false;

  const object = value as object;
  if (ancestors.has(object)) return false;
  const prototype = Object.getPrototypeOf(object);
  if (
    !Array.isArray(value) &&
    prototype !== Object.prototype &&
    prototype !== null
  ) {
    return false;
  }
  if (Object.getOwnPropertySymbols(object).length > 0) return false;

  ancestors.add(object);
  const valid = Array.isArray(value)
    ? value.every((entry) => isJsonSafe(entry, ancestors))
    : Object.keys(value as Record<string, unknown>).every((key) =>
        isJsonSafe((value as Record<string, unknown>)[key], ancestors),
      );
  ancestors.delete(object);
  return valid;
}

function validateDurableContract(
  read: Extract<DurableScenarioAnalysisFactRead, { readonly status: 'ok' }>,
  expectedScenarioId: string,
): readonly IdentifiedHandlerFact[] | null {
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

  const out: IdentifiedHandlerFact[] = [];
  const seenIds = new Set<string>();
  for (const candidate of read.facts) {
    const identified = parseIdentifiedRunAnalysisFact(
      candidate,
      expectedScenarioId,
    );
    if (identified === null || seenIds.has(identified.fact_row_id)) return null;
    seenIds.add(identified.fact_row_id);
    out.push(identified);
  }
  out.sort(comparePersistedFactsNewestFirst);
  return Object.freeze(out);
}

function classifyHotFacts(
  candidates: readonly unknown[],
  candidatesWithIdentity: readonly HandlerFactWithTurn[],
  expectedScenarioId: string,
): ClassifiedHotFacts {
  const eligible: HandlerFact[] = [];
  const rawEligibleObjects: object[] = [];
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
    if (fact.fact_type !== 'run_analysis') continue;
    if (fact.noop) {
      invalid = true;
      continue;
    }
    const eligibleFact = parseEligibleRunAnalysisFact(fact, expectedScenarioId);
    if (eligibleFact === null) {
      invalid = true;
      continue;
    }
    eligible.push(eligibleFact);
    rawEligibleObjects.push(candidate as object);
  }

  const identified: IdentifiedHandlerFact[] = [];
  const identifiedFactObjects: object[] = [];
  const seenIds = new Set<string>();
  for (const candidate of candidatesWithIdentity) {
    if (
      candidate === null ||
      typeof candidate !== 'object' ||
      Array.isArray(candidate) ||
      candidate.fact === null ||
      typeof candidate.fact !== 'object' ||
      Array.isArray(candidate.fact) ||
      (candidate.fact as { readonly fact_type?: unknown }).fact_type !==
        'run_analysis'
    ) {
      continue;
    }
    const parsed = parseIdentifiedRunAnalysisFact(candidate, expectedScenarioId);
    if (parsed === null || seenIds.has(parsed.fact_row_id)) {
      invalid = true;
      continue;
    }
    seenIds.add(parsed.fact_row_id);
    identified.push(parsed);
    identifiedFactObjects.push(candidate.fact as object);
  }

  // In production `priorFacts` is mapped directly from
  // `priorFactsWithTurn`, so the fact objects are the same occurrences. A
  // legacy/direct caller that supplies cloned payloads cannot acquire row
  // identity by payload resemblance and therefore fails weak.
  const unmatchedIdentified = [...identifiedFactObjects];
  for (const factObject of rawEligibleObjects) {
    const index = unmatchedIdentified.indexOf(factObject);
    if (index < 0) {
      invalid = true;
      continue;
    }
    unmatchedIdentified.splice(index, 1);
  }
  if (unmatchedIdentified.length > 0) invalid = true;

  return {
    eligible: Object.freeze(eligible),
    identified: Object.freeze(identified),
    invalid,
  };
}

function parseIdentifiedRunAnalysisFact(
  candidate: unknown,
  expectedScenarioId: string,
): IdentifiedHandlerFact | null {
  if (
    candidate === null ||
    typeof candidate !== 'object' ||
    Array.isArray(candidate)
  ) {
    return null;
  }
  const record = candidate as Readonly<Record<string, unknown>>;
  const factRowId = record.fact_row_id;
  const factCreatedAt = record.fact_created_at;
  if (
    typeof factRowId !== 'string' ||
    factRowId.length === 0 ||
    typeof factCreatedAt !== 'string' ||
    persistedInstantOrderKey(factCreatedAt) === null
  ) {
    return null;
  }
  const fact = parseEligibleRunAnalysisFact(record.fact, expectedScenarioId);
  if (fact === null) return null;
  return Object.freeze({
    fact,
    fact_row_id: factRowId,
    fact_created_at: factCreatedAt,
  });
}

function identifiedSnapshotIncludes(
  durable: readonly IdentifiedHandlerFact[],
  hot: readonly IdentifiedHandlerFact[],
): boolean {
  const durableById = new Map(
    durable.map((entry) => [entry.fact_row_id, entry] as const),
  );
  for (const hotEntry of hot) {
    const durableEntry = durableById.get(hotEntry.fact_row_id);
    if (!durableEntry) return false;
    if (
      persistedInstantOrderKey(durableEntry.fact_created_at) !==
        persistedInstantOrderKey(hotEntry.fact_created_at) ||
      stableFactKey(durableEntry.fact) !== stableFactKey(hotEntry.fact)
    ) {
      return false;
    }
  }
  return true;
}

function comparePersistedFactsNewestFirst(
  left: IdentifiedHandlerFact,
  right: IdentifiedHandlerFact,
): number {
  const leftTime = persistedInstantOrderKey(left.fact_created_at)!;
  const rightTime = persistedInstantOrderKey(right.fact_created_at)!;
  if (leftTime !== rightTime) return leftTime < rightTime ? 1 : -1;
  if (left.fact_row_id === right.fact_row_id) return 0;
  return left.fact_row_id < right.fact_row_id ? 1 : -1;
}

/**
 * Lossless ordering key for Postgres timestamptz values. Date.parse truncates
 * sub-millisecond precision, so retain the remaining nanoseconds as well.
 */
function persistedInstantOrderKey(value: string): bigint | null {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/u.exec(
      value,
    );
  if (!match) return null;
  const year = Number.parseInt(match[1]!, 10);
  const month = Number.parseInt(match[2]!, 10);
  const day = Number.parseInt(match[3]!, 10);
  const hour = Number.parseInt(match[4]!, 10);
  const minute = Number.parseInt(match[5]!, 10);
  const second = Number.parseInt(match[6]!, 10);
  const offsetHour = match[10] ? Number.parseInt(match[10], 10) : 0;
  const offsetMinute = match[11] ? Number.parseInt(match[11], 10) : 0;
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59
  ) {
    return null;
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return null;
  const fraction = (match[7] ?? '').padEnd(9, '0');
  const nanos = Number.parseInt(fraction || '0', 10);
  return BigInt(milliseconds) * 1_000_000n + BigInt(nanos % 1_000_000);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
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
  if (!isJsonSafe(fact, new Set<object>())) return null;
  return fact;
}

function freezeComplete(
  facts: readonly HandlerFact[],
  source: 'scenario',
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
