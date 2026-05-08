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
 * No behaviour change. The shape is identical to the original
 * definition. `session/store.ts` re-exports this symbol so its
 * public surface is preserved for in-session callers.
 */

import type { HandlerFact } from '@talchain/schemas/orchestrator';

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
  readonly turn_id: string;
  /**
   * The fact row's own `created_at` (DB-stamped). Equivalent to the
   * parent turn's `created_at` due to atomic-write coupling — see
   * the type docstring above.
   */
  readonly fact_created_at: string;
}
