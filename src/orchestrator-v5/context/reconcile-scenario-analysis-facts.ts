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
      /** Database-order head for claim-safety only; null proves durable zero. */
      readonly newest_fact: HandlerFact | null;
    }
  | {
      readonly status: 'capped';
      readonly facts: readonly [];
      readonly total_count: number;
      /** Validated database-order head; capped facts remain unusable for reasoning. */
      readonly newest_fact: HandlerFact;
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
  /** Omission is an unavailable durable port, never an empty fact set. */
  readonly durableRead?: DurableScenarioAnalysisFactRead;
}

interface ClassifiedHotFacts {
  readonly eligible: readonly HandlerFact[];
  readonly invalid: boolean;
}

type HotFactTypeClaim = 'run_analysis' | 'unrelated' | 'invalid';

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
  const hot = classifyHotFacts(input.hotWindowFacts, input.scenarioId);
  const durable = input.durableRead;

  if (durable?.status === 'ok') {
    const durableContract = validateDurableContract(durable, input.scenarioId);
    if (durableContract === null) {
      return degraded('durable_contract_invalid');
    }

    // These reads are not one database snapshot. A hot fact that is absent
    // from the complete durable page proves the page was already stale by the
    // time the window arrived; replacing the window would promote an older
    // snapshot. Multiset inclusion is a consistency check only — it never
    // deduplicates the durable output, so two genuinely distinct identical
    // persisted facts remain two facts.
    if (hot.invalid) {
      return degraded('hot_window_contract_invalid', durable.total_count);
    }
    if (durable.total_count > SCENARIO_ANALYSIS_FACT_CAP) {
      const newestFact = durableContract[0];
      // A capped page has a validated 21-row lookahead by construction.
      if (newestFact === undefined) return degraded('durable_contract_invalid');
      return freezeCapped(durable.total_count, newestFact);
    }

    if (!multisetIncludes(durableContract, hot.eligible)) {
      return degraded('snapshot_conflict', durable.total_count);
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

  return degraded('durable_unavailable');
}

function multisetIncludes(
  superset: readonly HandlerFact[],
  subset: readonly HandlerFact[],
): boolean {
  if (subset.length > superset.length) return false;
  const remaining = new Map<string, number>();
  for (const fact of superset) {
    const key = stableFactKey(fact);
    if (key === null) return false;
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  for (const fact of subset) {
    const key = stableFactKey(fact);
    if (key === null) return false;
    const count = remaining.get(key) ?? 0;
    if (count === 0) return false;
    if (count === 1) remaining.delete(key);
    else remaining.set(key, count - 1);
  }
  return true;
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

  const descriptors = Object.getOwnPropertyDescriptors(object);
  if (
    Object.values(descriptors).some(
      (descriptor) => descriptor.get !== undefined || descriptor.set !== undefined,
    )
  ) {
    return false;
  }
  if (Array.isArray(value)) {
    const keys = Object.keys(value);
    if (keys.length !== value.length) return false;
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, String(index))) {
        return false;
      }
    }
  }

  ancestors.add(object);
  const enumerableValues = Object.entries(descriptors)
    .filter(([, descriptor]) => descriptor.enumerable === true)
    .map(([, descriptor]) => descriptor.value);
  const valid = enumerableValues.every((entry) =>
    isJsonSafe(entry, ancestors),
  );
  ancestors.delete(object);
  return valid;
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
    try {
      if (
        candidate === null ||
        typeof candidate !== 'object' ||
        Array.isArray(candidate)
      ) {
        continue;
      }
      // Decide whether the row claims analysis authority from its own data
      // descriptor only. This avoids both accessor execution and broadening
      // this carrier into validation policy for unrelated hot-window facts.
      // A hostile descriptor/proxy cannot prove itself unrelated, so it fails
      // weak; a safely identified non-analysis fact is ignored even if its
      // own payload contains values irrelevant to analysis reconciliation.
      const claim = readHotFactTypeClaim(candidate);
      if (claim === 'invalid') {
        invalid = true;
        continue;
      }
      if (claim === 'unrelated') continue;
      if (!isJsonSafe(candidate, new Set<object>())) {
        invalid = true;
        continue;
      }
      const parsed = HandlerFactSchema.safeParse(candidate);
      if (!parsed.success) {
        invalid = true;
        continue;
      }

      const fact = parsed.data;
      if (fact.fact_type !== 'run_analysis') continue;
      // A valid noop carries no analysis claim. The durable query excludes
      // noop rows at the indexed boundary, so a noop in the ordinary hot
      // window is irrelevant rather than a contradiction.
      if (fact.noop) continue;
      const eligibleFact = parseEligibleRunAnalysisFact(fact, expectedScenarioId);
      if (eligibleFact === null) {
        invalid = true;
        continue;
      }
      eligible.push(eligibleFact);
    } catch {
      // Total fail-weak boundary for hostile proxies whose traps change after
      // the descriptor preflight.
      invalid = true;
    }
  }

  return { eligible: Object.freeze(eligible), invalid };
}

function readHotFactTypeClaim(candidate: object): HotFactTypeClaim {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(candidate, 'fact_type');
    if (descriptor === undefined) return 'unrelated';
    if (descriptor.get !== undefined || descriptor.set !== undefined) {
      return 'invalid';
    }
    return descriptor.value === 'run_analysis' ? 'run_analysis' : 'unrelated';
  } catch {
    return 'invalid';
  }
}

function parseEligibleRunAnalysisFact(
  candidate: unknown,
  expectedScenarioId: string,
): HandlerFact | null {
  try {
    // Preflight before Zod reads any getter/proxy-backed property.
    if (!isJsonSafe(candidate, new Set<object>())) return null;
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
    if (!hasValidProducerSelectorFields(result as Record<string, unknown>)) {
      return null;
    }
    return fact;
  } catch {
    // Contract inputs can be hostile test doubles even though persisted JSONB
    // cannot. Reconciliation is a fail-weak authority boundary, never a turn
    // exception surface.
    return null;
  }
}

/**
 * Validate fields the existing reasoning selectors consume when a producer
 * supplied them. Legacy absence remains valid; malformed presence must not
 * acquire authority merely because the broad HandlerFact schema accepts it.
 */
function hasValidProducerSelectorFields(result: Record<string, unknown>): boolean {
  if (Object.prototype.hasOwnProperty.call(result, 'computed_at')) {
    const computedAt = result.computed_at;
    if (
      typeof computedAt !== 'string' ||
      computedAt.trim().length === 0 ||
      !Number.isFinite(Date.parse(computedAt))
    ) {
      return false;
    }
  }

  if (Object.prototype.hasOwnProperty.call(result, 'graph_hash_at_run')) {
    const graphHash = result.graph_hash_at_run;
    if (typeof graphHash !== 'string' || graphHash.trim().length === 0) {
      return false;
    }
  }

  const enrichment = result.enrichment;
  if (
    enrichment !== null &&
    typeof enrichment === 'object' &&
    !Array.isArray(enrichment) &&
    Object.prototype.hasOwnProperty.call(enrichment, 'analysis_status')
  ) {
    const status = (enrichment as Record<string, unknown>).analysis_status;
    if (typeof status !== 'string' || status.trim().length === 0) return false;
  }
  return true;
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
    newest_fact: facts[0] ?? null,
  });
}

function freezeCapped(
  totalCount: number,
  newestFact: HandlerFact,
): ScenarioAnalysisFactSet {
  return Object.freeze({
    status: 'capped',
    facts: Object.freeze([]) as readonly [],
    total_count: totalCount,
    newest_fact: newestFact,
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
