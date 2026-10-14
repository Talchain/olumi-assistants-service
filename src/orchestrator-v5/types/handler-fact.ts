/**
 * Leaf-level handler-fact type used outside the SessionStore.
 *
 * `HandlerFactWithTurn` was originally defined alongside the
 * `SessionStore` interface in `session/store.ts`. The state-write
 * invariant (enforced by the pre-push hook) forbids importing from
 * `session/store.ts` outside `session/`, `commit.ts`, and
 * `build-turn-context.ts`. The proposed-change synthesis path in
 * `routing/` legitimately needs this shape for its idempotency
 * lookback, so the type is re-homed here at leaf level.
 *
 * `session/store.ts` re-exports this symbol so its public surface is
 * preserved for in-session callers. The fact-row identity is carried here so
 * independent reads can compare occurrences rather than payload lookalikes.
 */

import type { HandlerFact } from '@talchain/schemas/orchestrator';
import type {
  CanonicalNodeLabelTransition,
  CommittedMutationTurnRef,
} from './recent-mutation-transition.js';

/**
 * A {@link HandlerFact} paired with its parent turn's row id and the
 * fact's own creation timestamp. Returned by
 * `SessionStore.readFactsWithTurnFor`.
 *
 * The proposed-change synthesis idempotency path filters by
 * `fact_created_at >= proposal.emitted_at_iso` so pre-emit facts are
 * NEVER eligible. This binding is schema-aligned (the FK
 * `v5_handler_facts.v5_conversation_turn_id` ⇒ `v5_conversation_turns.id`
 * supplies the link) rather than positional.
 *
 * `fact_created_at` is the fact row's own `created_at`. Facts and
 * their parent turns are written inside the same `append_turn_atomic`
 * transaction, so the two timestamps are equivalent for the
 * post-emit gate. We surface the fact-side timestamp directly because
 * it requires no JOIN at read time.
 */
export interface HandlerFactWithTurn {
  readonly fact: HandlerFact;
  /**
   * Stable persisted identity of the handler-fact row. Production reads
   * always supply it; legacy/direct test stores may omit it and therefore
   * cannot establish cross-snapshot receipt identity.
   */
  readonly fact_row_id?: string;
  readonly evaluated_scenario_revision?: number | null;
  readonly turn_id: string;
  /**
   * The fact row's own `created_at` (DB-stamped). Equivalent to the
   * parent turn's `created_at` due to atomic-write coupling — see
   * the type docstring above.
   */
  readonly fact_created_at: string;
}

/**
 * A handler fact with the two database-authored fields needed to compare
 * occurrences across independent reads. Payload equality is insufficient:
 * two legitimate mutations can produce byte-identical receipts.
 */
export interface IdentifiedHandlerFact {
  readonly fact: HandlerFact;
  readonly fact_row_id: string;
  readonly evaluated_scenario_revision?: number | null;
  readonly fact_created_at: string;
  /** Optional exact parent linkage from the durable, scenario-scoped read. */
  readonly committed_turn_ref?: CommittedMutationTurnRef;
  /** Read-only projection from that occurrence's verified immutable versions. */
  readonly label_transition?: CanonicalNodeLabelTransition;
}

/** Durable applied/rerun edit evidence after the selected legacy Run. */
export interface LegacyAnalysisEditFacts {
  readonly since: string | null;
  readonly facts: readonly IdentifiedHandlerFact[];
  readonly readOk: boolean;
  readonly total_count: number | null;
}


/** Database occurrence metadata stays outside the strict HandlerFact payload. */
interface RunAnalysisOccurrence {
  readonly fact_row_id: string;
  readonly run_id: string | null;
  readonly evaluated_scenario_revision: number | null;
}
const RUN_ANALYSIS_OCCURRENCES = new WeakMap<HandlerFact, RunAnalysisOccurrence>();

export function validatedScenarioRevision(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** Bind only this wrapper's row, while its fact is still attached to it. */
export function bindRunAnalysisOccurrence(entry: Pick<HandlerFactWithTurn,
  'fact' | 'fact_row_id' | 'evaluated_scenario_revision'>): void {
  if (entry.fact.fact_type !== 'run_analysis' || !entry.fact_row_id) return;
  RUN_ANALYSIS_OCCURRENCES.set(entry.fact, Object.freeze({
    fact_row_id: entry.fact_row_id,
    run_id: entry.fact.result.run_id ?? null,
    evaluated_scenario_revision: validatedScenarioRevision(entry.evaluated_scenario_revision),
  }));
}

export function readRunAnalysisOccurrence(fact: HandlerFact): RunAnalysisOccurrence | undefined {
  const occurrence = RUN_ANALYSIS_OCCURRENCES.get(fact);
  return fact.fact_type === 'run_analysis' && occurrence?.run_id === (fact.result.run_id ?? null)
    ? occurrence : undefined;
}

/** A read-time replacement retains the exact original occurrence, never an array position. */
export function preserveRunAnalysisOccurrence(original: HandlerFact, replacement: HandlerFact): HandlerFact {
  const occurrence = readRunAnalysisOccurrence(original);
  if (occurrence !== undefined && replacement.fact_type === 'run_analysis'
    && occurrence.run_id === (replacement.result.run_id ?? null)) {
    RUN_ANALYSIS_OCCURRENCES.set(replacement, occurrence);
  }
  return replacement;
}
