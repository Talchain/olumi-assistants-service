/**
 * Reconcile the ordinary bounded turn-window facts with one uncached,
 * scenario-scoped read of the durable `run_analysis` fact set.
 *
 * This module is deliberately pure. It owns no analysis/science policy: it
 * establishes only whether the existing selectors have a coherent fact set
 * from which to apply their already-shipped status and chronology rules.
 *
 * THE CAP IS EPISTEMIC, NOT A SIZE GUARD, AND IT IS NOT AN INSTRUCTION TO
 * FORGET. `capped` says "this scenario has more analysis history than the
 * bound, so nothing here may be read as the WHOLE record" — it never says
 * "there is no analysis". The carrier holds the newest {@link
 * SCENARIO_ANALYSIS_FACT_CAP} facts and discloses the wall through `status`,
 * exactly as the sibling `reconcile-recent-mutation-facts.ts` already does.
 *
 * ⚠ THE ORIGINAL WORDING HERE WAS "a capped prefix is never reasoning
 * authority", AND IT WAS IMPLEMENTED AS `facts: []`. Because run_analysis
 * facts are never pruned, `total_count` only grows: the 21st lifetime run on
 * a scenario emptied this carrier permanently and the model saw
 * `analysis: null` on every later turn, forever, while the wire freshness
 * badge — derived from the separate hot turn window — still read `fresh`.
 * A bound that cannot be crossed back over is not a bound, it is a cliff.
 *
 * Only {@link isScenarioAnalysisReasoningAuthority} decides what may author
 * reasoning state. It is an ALLOW-LIST on purpose: a future status is
 * excluded until someone states why it should not be.
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
      /**
       * The durable set exceeds {@link SCENARIO_ANALYSIS_FACT_CAP}. `facts`
       * carries the NEWEST `SCENARIO_ANALYSIS_FACT_CAP` rows — a usable,
       * bounded window — and this status is the disclosure that older history
       * exists behind it. It is never a claim of completeness.
       */
      readonly status: 'capped';
      readonly facts: readonly HandlerFact[];
      readonly total_count: number;
    }
  | {
      readonly status: 'degraded';
      readonly facts: readonly [];
      readonly reason: ScenarioAnalysisFactSetDegradedReason;
      readonly total_count?: number;
    };

// Context carriers are process-local and ephemeral. Nominally attest the exact
// object returned by this authority boundary so a legacy/direct caller cannot
// manufacture `status: 'complete'` and turn omitted validation into permission.
interface ReconciledScenarioAnalysisFactSetAttestation {
  readonly scenarioId: string;
  /**
   * Existing claim-safety transport, derived from the same validated persisted
   * page as the reasoning carrier. This is not reasoning authority: a capped
   * page may carry its database-newest fact here while exposing no facts in the
   * public `ScenarioAnalysisFactSet`.
   */
  readonly newestAnalysisFact: HandlerFact | null;
  readonly newestAnalysisFactReadOk: boolean;
}

const RECONCILED_SCENARIO_ANALYSIS_FACT_SETS = new WeakMap<
  object,
  ReconciledScenarioAnalysisFactSetAttestation
>();

/**
 * ⭐ THE ONE GATE that decides whether a reconciled carrier may author
 * model-facing reasoning state.
 *
 * ALLOW-LIST, NOT DENY-LIST, deliberately. `complete` and `capped` both rest
 * on a validated durable page, so both carry real facts and a real newest
 * fact; `degraded` proves nothing was read and must keep failing weak. A
 * status added later is excluded here until someone states the case for it —
 * a `!== 'degraded'` written at each call site would have admitted it
 * silently at all of them.
 *
 * `undefined` is an absent carrier (a legacy/direct caller, or a turn whose
 * canonical graph read did not license the durable analysis), and fails weak.
 */
export function isScenarioAnalysisReasoningAuthority(
  value: ScenarioAnalysisFactSet | undefined,
): value is Extract<
  ScenarioAnalysisFactSet,
  { readonly status: 'complete' | 'capped' }
> {
  return value !== undefined && (value.status === 'complete' || value.status === 'capped');
}

export function isReconciledScenarioAnalysisFactSet(
  value: unknown,
  expectedScenarioId?: string,
): value is ScenarioAnalysisFactSet {
  if (value === null || typeof value !== 'object') return false;
  const attestation = RECONCILED_SCENARIO_ANALYSIS_FACT_SETS.get(value);
  return (
    attestation !== undefined &&
    (expectedScenarioId === undefined ||
      attestation.scenarioId === expectedScenarioId)
  );
}

export interface ScenarioAnalysisClaimSafetyRead {
  readonly fact: HandlerFact | null;
  readonly readOk: boolean;
}

/**
 * Project the existing scenario-wide claim-safety input from the one validated
 * exact-count snapshot.
 *
 * `complete` and a successfully validated `capped` page prove the database's
 * newest row (or authoritative emptiness). Degraded reads, malformed
 * contracts and split-snapshot conflicts prove neither. The result is
 * intentionally obtainable only from a nominally attested reconciler output,
 * so a direct caller cannot manufacture `readOk: true`.
 */
export function readScenarioAnalysisClaimSafetyFact(
  value: unknown,
  expectedScenarioId: string,
): ScenarioAnalysisClaimSafetyRead {
  if (value === null || typeof value !== 'object') {
    return { fact: null, readOk: false };
  }
  const attestation = RECONCILED_SCENARIO_ANALYSIS_FACT_SETS.get(value);
  if (
    attestation === undefined ||
    attestation.scenarioId !== expectedScenarioId
  ) {
    return { fact: null, readOk: false };
  }
  return {
    fact: attestation.newestAnalysisFact,
    readOk: attestation.newestAnalysisFactReadOk,
  };
}

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
      return degraded('durable_contract_invalid', input.scenarioId);
    }

    // These reads are not one database snapshot. A persisted hot identity that
    // is absent from the complete durable page proves the page was already
    // stale by the time the window arrived. Payload equality is deliberately
    // irrelevant: two legitimate analysis runs can have byte-identical facts.
    if (hot.invalid) {
      return degraded(
        'hot_window_contract_invalid',
        input.scenarioId,
        durable.total_count,
      );
    }
    if (!identifiedSnapshotIncludes(durableContract, hot.identified)) {
      return degraded('snapshot_conflict', input.scenarioId, durable.total_count);
    }

    // A capped page cannot claim to be the WHOLE record, but it is a validated
    // page, and its newest rows are the analysis the model is actually reasoning
    // about. Retain the bounded window and disclose the wall through `status`;
    // its first row remains the validated database-newest fact used by the
    // pre-existing claim-safety entitlement. Validate the hot-window
    // contradiction evidence first: a split snapshot supplies neither
    // authority, regardless of page size.
    if (durable.total_count > SCENARIO_ANALYSIS_FACT_CAP) {
      return freezeCapped(
        // Contract validation proves a capped page has exactly LOOKAHEAD rows,
        // sorted newest-first. The window is the newest CAP of them.
        durableContract.map((entry) => entry.fact),
        durable.total_count,
        input.scenarioId,
      );
    }

    return freezeComplete(
      durableContract.map((entry) => entry.fact),
      'scenario',
      durable.total_count,
      input.scenarioId,
    );
  }

  if (durable?.status === 'degraded' && durable.reason === 'contract_invalid') {
    return degraded('durable_contract_invalid', input.scenarioId);
  }

  return degraded('durable_unavailable', input.scenarioId);
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
    isoInstantOrderKey(factCreatedAt) === null
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
      isoInstantOrderKey(durableEntry.fact_created_at) !==
        isoInstantOrderKey(hotEntry.fact_created_at) ||
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
  const leftTime = isoInstantOrderKey(left.fact_created_at)!;
  const rightTime = isoInstantOrderKey(right.fact_created_at)!;
  if (leftTime !== rightTime) return leftTime < rightTime ? 1 : -1;
  if (left.fact_row_id === right.fact_row_id) return 0;
  return left.fact_row_id < right.fact_row_id ? 1 : -1;
}

/**
 * Lossless ordering key for Postgres timestamptz values. Date.parse truncates
 * sub-millisecond precision, so retain the remaining nanoseconds as well.
 */
export function isoInstantOrderKey(value: string): bigint | null {
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
  scenarioId: string,
): ScenarioAnalysisFactSet {
  const immutableFacts = Object.freeze(
    facts.map((fact) => cloneAndFreezeJson(fact)),
  );
  return attestReconciled(
    Object.freeze({
      status: 'complete',
      source,
      facts: immutableFacts,
      total_count: totalCount,
    }),
    scenarioId,
    immutableFacts[0] ?? null,
    true,
  );
}

/**
 * `facts` arrives newest-first and over-length by exactly one row (the
 * lookahead that PROVED the wall). Keep the newest {@link
 * SCENARIO_ANALYSIS_FACT_CAP}; the row the slice removes is the OLDEST, so the
 * model loses the tail of its history and never its current analysis. Same
 * shape as `reconcile-recent-mutation-facts.ts` `freezeResult`.
 */
function freezeCapped(
  facts: readonly HandlerFact[],
  totalCount: number,
  scenarioId: string,
): ScenarioAnalysisFactSet {
  const immutableFacts = Object.freeze(
    facts
      .slice(0, SCENARIO_ANALYSIS_FACT_CAP)
      .map((fact) => cloneAndFreezeJson(fact)),
  );
  return attestReconciled(
    Object.freeze({
      status: 'capped',
      facts: immutableFacts,
      total_count: totalCount,
    }),
    scenarioId,
    // The same frozen clone the window exposes — claim safety and reasoning
    // cannot diverge about which fact is newest.
    immutableFacts[0] ?? null,
    true,
  );
}

function degraded(
  reason: ScenarioAnalysisFactSetDegradedReason,
  scenarioId: string,
  totalCount?: number,
): ScenarioAnalysisFactSet {
  return attestReconciled(
    Object.freeze({
      status: 'degraded',
      facts: Object.freeze([]) as readonly [],
      reason,
      ...(totalCount !== undefined ? { total_count: totalCount } : {}),
    }),
    scenarioId,
    null,
    false,
  );
}

function attestReconciled<T extends ScenarioAnalysisFactSet>(
  value: T,
  scenarioId: string,
  newestAnalysisFact: HandlerFact | null,
  newestAnalysisFactReadOk: boolean,
): T {
  RECONCILED_SCENARIO_ANALYSIS_FACT_SETS.set(
    value,
    Object.freeze({
      scenarioId,
      newestAnalysisFact,
      newestAnalysisFactReadOk,
    }),
  );
  return value;
}

/** Clone before recursively freezing so the reconciler never freezes caller input. */
function cloneAndFreezeJson<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry) => cloneAndFreezeJson(entry))) as T;
  }
  const clone: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    clone[key] = cloneAndFreezeJson(entry);
  }
  return Object.freeze(clone) as T;
}
