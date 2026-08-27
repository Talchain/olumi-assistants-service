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

import { MUTATION_RECEIPT_FACT_TYPES } from '../mutation-receipt-fact-types.js';
import { isNoopFact } from '../tools/fact-noop.js';
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
      readonly facts: readonly unknown[];
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
    const classifiedDurable = classifyFacts(durable.facts);

    // The durable reader promises applied mutation receipts only. A malformed,
    // noop, refused, or foreign fact on this arm contradicts that promise, so
    // preserve any known hot receipts but do not claim complete history.
    if (!classifiedDurable.malformed && !classifiedDurable.ineligible) {
      // A clean scenario-wide zero cannot coexist with a successfully-loaded
      // hot receipt. Treat the disagreement as degraded rather than erasing a
      // change the process already knows about.
      if (classifiedDurable.eligible.length === 0 && hot.eligible.length > 0) {
        return degraded(hot.eligible);
      }

      return freezeResult(
        classifiedDurable.eligible,
        classifiedDurable.eligible.length > RECENT_CHANGES_CAP ? 'capped' : 'complete',
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
