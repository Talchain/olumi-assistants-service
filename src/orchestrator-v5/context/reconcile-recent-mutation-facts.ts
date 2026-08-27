/**
 * Reconcile the bounded hot-window mutation facts with the scenario-scoped,
 * uncached durable mutation-receipt read.
 *
 * This module is deliberately pure and read-only. It does not fetch facts,
 * project user-facing summaries, consult the rolling summary, or write state.
 * The durable reader owns scenario scoping and the stable
 * `created_at DESC, id DESC` ordering. This layer owns the epistemic result:
 * whether the newest receipts are complete, capped, or degraded.
 */

import {
  HandlerFactSchema,
  type HandlerFact,
} from '@talchain/schemas/orchestrator';

import { stableStringify } from '../../orchestrator/context/stable-stringify.js';
import { MUTATION_RECEIPT_FACT_TYPES } from '../mutation-receipt-fact-types.js';
import { isNoopFact } from '../tools/fact-noop.js';
import type {
  HandlerFactWithTurn,
  IdentifiedHandlerFact,
} from '../types/handler-fact.js';
import { RECENT_CHANGES_CAP } from './recent-changes.js';

export type RecentChangesHistoryStatus = 'complete' | 'capped' | 'degraded';

/** One extra row is the executable proof that the visible three are capped. */
export const RECENT_MUTATION_FACT_LOOKAHEAD_LIMIT = RECENT_CHANGES_CAP + 1;

/**
 * Result of the uncached scenario-scoped reader.
 *
 * `ok` means the query itself completed and its facts are in the reader's
 * stable newest-first order. The caller must request exactly
 * `RECENT_CHANGES_CAP + 1`; the fourth row proves that the user-facing three
 * are capped without loading unbounded history.
 */
export type DurableRecentMutationFactRead =
  | {
      readonly status: 'ok';
      readonly scenario_id: string;
      /** Exact limit used for the scenario-scoped database query. */
      readonly query_limit: number;
      readonly facts: readonly IdentifiedHandlerFact[];
    }
  | {
      readonly status: 'degraded';
    };

export interface ReconcileRecentMutationFactsInput {
  /** Scenario whose turn context is being built. */
  readonly scenarioId: string;
  /**
   * Facts loaded through the ordinary bounded turn window. They are already
   * newest-first in production. Non-mutation and noop facts are expected here
   * and are filtered through the shared mutation-receipt authority.
   */
  readonly hotWindowFacts: readonly unknown[];
  /**
   * The same hot facts with their persisted row identity/order metadata.
   * Production always supplies this. Omission is a legacy/direct degraded arm,
   * never permission to equate byte-identical receipt payloads.
   */
  readonly hotWindowFactsWithIdentity?: readonly HandlerFactWithTurn[];
  /** Did both the bounded turn read and its fact read succeed? */
  readonly hotWindowReadOk: boolean;
  /** Number of turn rows actually loaded into the hot window. */
  readonly loadedTurnCount: number;
  /** Exact scenario turn count; null/undefined means unknown. */
  readonly priorTurnsTotal?: number | null;
  /**
   * Uncached scenario-wide mutation read. Omission is a degraded durable read,
   * not evidence that there are no changes (legacy stores may omit the port).
   */
  readonly durableRead?: DurableRecentMutationFactRead;
}

export interface ReconciledRecentMutationFacts {
  /** Newest-first, bounded by the sole existing recent-changes cap. */
  readonly recent_mutation_facts: readonly HandlerFact[];
  /**
   * `complete + []` is the only authoritative no-changes state.
   * `degraded + []` means history could not be established.
   */
  readonly recent_changes_status: RecentChangesHistoryStatus;
}

/**
 * Array-compatible bridge for existing ContextPack call sites.
 *
 * `turn-executor.ts` already passes `context.prior_facts` to the assembler at
 * every live routing seam. Binding the independently-reconciled mutation
 * history to that same array keeps all other fact consumers on the unchanged
 * hot-window facts while allowing the assembler to read the durable receipt
 * slice without a second store read or an executor edit. The two properties
 * are non-enumerable, so array iteration/JSON bytes remain those of the prior
 * facts themselves.
 */
export interface HandlerFactsWithRecentMutationHistory
  extends ReadonlyArray<HandlerFact> {
  readonly recent_mutation_facts: readonly HandlerFact[];
  readonly recent_changes_status: RecentChangesHistoryStatus;
}

interface ClassifiedFacts {
  readonly eligible: readonly HandlerFact[];
  readonly malformed: boolean;
  readonly ineligible: boolean;
}

interface ClassifiedIdentifiedFacts {
  readonly eligible: readonly IdentifiedHandlerFact[];
  readonly malformed: boolean;
  readonly ineligible: boolean;
}

/**
 * Select one coherent recent-mutation history without promoting a summary or
 * a failed read into receipt authority.
 */
export function reconcileRecentMutationFacts(
  input: ReconcileRecentMutationFactsInput,
): ReconciledRecentMutationFacts {
  const hot = classifyFacts(input.hotWindowFacts);
  const durable = input.durableRead;

  if (
    durable?.status === 'ok' &&
    durable.scenario_id === input.scenarioId &&
    durable.query_limit === RECENT_MUTATION_FACT_LOOKAHEAD_LIMIT &&
    durable.facts.length <= RECENT_MUTATION_FACT_LOOKAHEAD_LIMIT
  ) {
    const classifiedDurable = classifyIdentifiedFacts(durable.facts);

    // The durable reader promises applied mutation receipts only. A malformed,
    // noop, refused, or foreign fact on this arm contradicts that promise, so
    // preserve any known hot receipts but do not claim complete history.
    if (!classifiedDurable.malformed && !classifiedDurable.ineligible) {
      const durableFacts = classifiedDurable.eligible.map((entry) => entry.fact);
      const durableStatus =
        durableFacts.length > RECENT_CHANGES_CAP
          ? 'capped'
          : 'complete';

      const hotIdentified = classifyIdentifiedFacts(
        input.hotWindowFactsWithIdentity ?? [],
      );
      const hotIdentityComplete =
        !hotIdentified.malformed &&
        sameFactPayloadMultiset(
          hot.eligible,
          hotIdentified.eligible.map((entry) => entry.fact),
        );

      if (hot.eligible.length > 0 && !hotIdentityComplete) {
        // Legacy/direct callers can supply parsed facts without row identity.
        // They remain useful receipts, but cannot prove that a byte-identical
        // durable payload is the same occurrence. Fail weak and keep every hot
        // receipt ahead of any payload-distinct durable remainder.
        return degraded([
          ...hot.eligible,
          ...findUnmatchedFacts(durableFacts, hot.eligible),
        ]);
      }

      const merged = mergeIdentifiedFacts(
        hotIdentified.eligible,
        classifiedDurable.eligible,
      );
      if (merged.conflict) {
        // A shared persisted identity with contradictory payload or chronology
        // cannot verify either occurrence. Do not let an arbitrary source win
        // and author a user-facing "recorded edit" claim.
        return degraded([]);
      }

      const durableIds = classifiedDurable.eligible.map(
        (entry) => entry.fact_row_id,
      );
      const mergedIds = merged.ordered.map((entry) => entry.fact_row_id);
      const durableIsAuthoritativePage =
        durableStatus === 'capped'
          ? sameStrings(
              durableIds,
              mergedIds.slice(0, RECENT_MUTATION_FACT_LOOKAHEAD_LIMIT),
            )
          : mergedIds.every((id) => durableIds.includes(id));

      if (!durableIsAuthoritativePage) {
        return degraded(merged.ordered.map((entry) => entry.fact));
      }

      return freezeResult(
        merged.ordered.map((entry) => entry.fact),
        durableStatus,
      );
    }
  }

  // Durable history is unavailable, scoped to another scenario, over-bounded,
  // or contradicted its own reader contract. Preserve every successfully
  // parsed hot receipt, but call the result complete only when the hot window
  // itself is healthy and its exact turn count proves it covers the scenario.
  if (
    input.hotWindowReadOk &&
    !hot.malformed &&
    hasCompleteTurnCoverage(input.priorTurnsTotal, input.loadedTurnCount)
  ) {
    return freezeResult(
      hot.eligible,
      hot.eligible.length > RECENT_CHANGES_CAP ? 'capped' : 'complete',
    );
  }

  return degraded(hot.eligible);
}

/** Attach one reconciliation result to an otherwise unchanged prior-fact array. */
export function bindRecentMutationHistoryToPriorFacts(
  priorFacts: readonly HandlerFact[],
  history: ReconciledRecentMutationFacts,
): HandlerFactsWithRecentMutationHistory {
  const carrier = [...priorFacts] as HandlerFact[] & {
    recent_mutation_facts: readonly HandlerFact[];
    recent_changes_status: RecentChangesHistoryStatus;
  };
  Object.defineProperties(carrier, {
    recent_mutation_facts: {
      value: history.recent_mutation_facts,
      enumerable: false,
      writable: false,
      configurable: false,
    },
    recent_changes_status: {
      value: history.recent_changes_status,
      enumerable: false,
      writable: false,
      configurable: false,
    },
  });
  return Object.freeze(carrier);
}

/**
 * Read the array-compatible bridge. Plain/legacy arrays return null and must
 * be interpreted weakly by the caller, never as complete history.
 */
export function readRecentMutationHistoryFromPriorFacts(
  priorFacts: readonly HandlerFact[] | undefined,
): ReconciledRecentMutationFacts | null {
  if (!priorFacts) return null;
  const candidate = priorFacts as Partial<HandlerFactsWithRecentMutationHistory>;
  if (
    !Array.isArray(candidate.recent_mutation_facts) ||
    (candidate.recent_changes_status !== 'complete' &&
      candidate.recent_changes_status !== 'capped' &&
      candidate.recent_changes_status !== 'degraded')
  ) {
    return null;
  }
  return freezeResult(
    candidate.recent_mutation_facts,
    candidate.recent_changes_status,
  );
}

function classifyFacts(candidates: readonly unknown[]): ClassifiedFacts {
  const eligible: HandlerFact[] = [];
  let malformed = false;
  let ineligible = false;

  for (const candidate of candidates) {
    const parsed = HandlerFactSchema.safeParse(candidate);
    if (!parsed.success) {
      malformed = true;
      continue;
    }

    const fact = parsed.data;
    const status = readResultStatus(fact);
    if (
      !MUTATION_RECEIPT_FACT_TYPES.has(fact.fact_type) ||
      isNoopFact(fact) ||
      status !== 'applied'
    ) {
      ineligible = true;
      continue;
    }
    eligible.push(fact);
  }

  return { eligible, malformed, ineligible };
}

function classifyIdentifiedFacts(
  candidates: readonly unknown[],
): ClassifiedIdentifiedFacts {
  const eligible: IdentifiedHandlerFact[] = [];
  const seenIds = new Set<string>();
  let malformed = false;
  let ineligible = false;

  for (const candidate of candidates) {
    if (!isRecord(candidate)) {
      malformed = true;
      continue;
    }
    const parsed = HandlerFactSchema.safeParse(candidate.fact);
    const factRowId = candidate.fact_row_id;
    const factCreatedAt = candidate.fact_created_at;
    if (
      !parsed.success ||
      typeof factRowId !== 'string' ||
      factRowId.length === 0 ||
      seenIds.has(factRowId) ||
      typeof factCreatedAt !== 'string' ||
      instantOrderKey(factCreatedAt) === null
    ) {
      malformed = true;
      continue;
    }
    seenIds.add(factRowId);

    const fact = parsed.data;
    const status = readResultStatus(fact);
    if (
      !MUTATION_RECEIPT_FACT_TYPES.has(fact.fact_type) ||
      isNoopFact(fact) ||
      status !== 'applied'
    ) {
      ineligible = true;
      continue;
    }
    eligible.push({
      fact,
      fact_row_id: factRowId,
      fact_created_at: factCreatedAt,
    });
  }

  return { eligible, malformed, ineligible };
}

/**
 * Return source occurrences that cannot be paired one-for-one with the
 * comparison set. HandlerFact has no persisted row id, so its schema-parsed
 * stable JSON is the narrowest available cross-snapshot receipt identity.
 * This is deliberately multiset matching rather than Set de-duplication.
 */
function findUnmatchedFacts(
  source: readonly HandlerFact[],
  comparison: readonly HandlerFact[],
): readonly HandlerFact[] {
  const remaining = new Map<string, number>();
  for (const fact of comparison) {
    const key = stableStringify(fact);
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }

  const unmatched: HandlerFact[] = [];
  for (const fact of source) {
    const key = stableStringify(fact);
    const available = remaining.get(key) ?? 0;
    if (available === 0) {
      unmatched.push(fact);
      continue;
    }
    if (available === 1) remaining.delete(key);
    else remaining.set(key, available - 1);
  }
  return unmatched;
}

function sameFactPayloadMultiset(
  left: readonly HandlerFact[],
  right: readonly HandlerFact[],
): boolean {
  return (
    left.length === right.length &&
    findUnmatchedFacts(left, right).length === 0
  );
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

interface MergedIdentifiedFacts {
  readonly ordered: readonly IdentifiedHandlerFact[];
  readonly conflict: boolean;
}

/**
 * Merge the two snapshots by persisted row identity, then independently sort
 * their union by the database's exact authority: created_at DESC, id DESC.
 * Neither read's arrival order is allowed to outrank that persisted order.
 */
function mergeIdentifiedFacts(
  hot: readonly IdentifiedHandlerFact[],
  durable: readonly IdentifiedHandlerFact[],
): MergedIdentifiedFacts {
  const byId = new Map<string, IdentifiedHandlerFact>();
  let conflict = false;

  for (const entry of [...durable, ...hot]) {
    const existing = byId.get(entry.fact_row_id);
    if (!existing) {
      byId.set(entry.fact_row_id, entry);
      continue;
    }
    if (
      instantOrderKey(existing.fact_created_at) !==
        instantOrderKey(entry.fact_created_at) ||
      stableStringify(existing.fact) !== stableStringify(entry.fact)
    ) {
      conflict = true;
    }
  }

  const ordered = [...byId.values()].sort((left, right) => {
    const leftTime = instantOrderKey(left.fact_created_at)!;
    const rightTime = instantOrderKey(right.fact_created_at)!;
    if (leftTime !== rightTime) return leftTime < rightTime ? 1 : -1;
    if (left.fact_row_id === right.fact_row_id) return 0;
    return left.fact_row_id < right.fact_row_id ? 1 : -1;
  });
  return { ordered, conflict };
}

/**
 * Lossless ordering key for Postgres timestamptz strings. Date.parse retains
 * only milliseconds; handler rows can differ inside that millisecond. Keep
 * the parsed epoch milliseconds plus the remaining fractional nanoseconds so
 * the JS merge mirrors `ORDER BY created_at DESC, id DESC` exactly.
 */
function instantOrderKey(value: string): bigint | null {
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
  const subMillisecondNanos = nanos % 1_000_000;
  return BigInt(milliseconds) * 1_000_000n + BigInt(subMillisecondNanos);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readResultStatus(fact: HandlerFact): unknown {
  const result = fact.result;
  return result && typeof result === 'object' && !Array.isArray(result)
    ? (result as { readonly status?: unknown }).status
    : undefined;
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

function degraded(facts: readonly HandlerFact[]): ReconciledRecentMutationFacts {
  return freezeResult(facts, 'degraded');
}

function freezeResult(
  facts: readonly HandlerFact[],
  status: RecentChangesHistoryStatus,
): ReconciledRecentMutationFacts {
  return Object.freeze({
    recent_mutation_facts: Object.freeze([...facts.slice(0, RECENT_CHANGES_CAP)]),
    recent_changes_status: status,
  });
}
