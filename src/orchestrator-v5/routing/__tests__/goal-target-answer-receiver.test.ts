/**
 * ⭐⭐ THE GENERIC RESUMER STILL DOES NOT CLAIM A GOAL-TARGET ANSWER — and that
 * is the boundary the dedicated pre-route was built beside, not inside.
 *
 * ⛔ THIS FILE'S ORIGINAL HEADER IS WITHDRAWN, and the withdrawal is the point.
 * It said "there is no goal-target kind, so a target question cannot be
 * persisted as a resumable pending action at all". That was true when measured
 * and is FALSE NOW: `elicit_goal_target` exists, is armed by the receipt-swap
 * site, and is read back by `tryGoalTargetElicitationResume`. A test header
 * that keeps asserting a resolved absence is how a stale claim outlives its
 * evidence, so it is corrected here rather than left to be re-read as current.
 *
 * WHAT THESE CASES STILL MEASURE, and why they are worth keeping:
 * `tryClarificationResume` — the receiver at `turn-executor.ts:5446` — branches
 * on `set_factor_value` and `edit_graph_add_risk` only, and its FIRST gate
 * deflects any message matching `EDIT_VERB_OR_QUANTITY_PATTERN` to the
 * deterministic value-update path, which targets a FACTOR. So a goal-target
 * answer arriving here would be bound to the wrong subject or to nothing.
 *
 * That is exactly why the goal-target answer is claimed EARLIER, by its own
 * pre-route, before this resumer and before the value-update parser. These
 * cases pin the behaviour this route must keep stepping in front of: if the
 * generic lane ever started claiming bare quantities differently, the ordering
 * argument for the new pre-route would need re-deriving, and this suite REDs.
 *
 * ⚠ NOT a claim about the native pricing run. It does not say the product asked
 *   a target question there; the raw preimage is still absent.
 *
 * Not run locally; hosted CI is the only execution.
 */
import { describe, expect, it } from 'vitest';

import { tryClarificationResume } from '../clarification-resume.js';

const NOW = Date.parse('2026-09-09T07:40:00.000Z');

function resume(message: string, pendingActions: readonly unknown[] = []) {
  return tryClarificationResume({
    message,
    pendingActions: pendingActions as never,
    graphLookup: undefined,
    nowMs: NOW,
  });
}

describe('the generic clarification resumer does not receive a goal-target answer', () => {
  it('⭐ with no pending goal question, an ordinary target answer is not resumed', () => {
    // "£20k" is the answer shape the product's own target question invites.
    const result = resume('£20k');
    expect(result.matched).toBe(false);
  });

  it('a bare quantity is deflected to the value-update path BEFORE any pending is consulted', () => {
    // The ordering matters, and it is the reason the goal-target pre-route sits
    // ABOVE this resumer rather than inside it: this gate runs first, so a
    // goal-target answer reaching here would be parsed as a factor edit.
    const result = resume('20000');
    if (result.matched) throw new Error('expected no match');
    expect(result.skip_reason).toBe('message_likely_value_update');
  });

  it('a prose answer with no pending reports the absent question, not a wrong match', () => {
    const result = resume('the revenue one');
    if (result.matched) throw new Error('expected no match');
    expect(result.skip_reason).toBe('no_pending_clarification');
  });

  it('POSITIVE CONTROL — the resumer does match a kind it supports, so these are real refusals', () => {
    // Without this, every case above could pass on a resumer that never matches
    // anything. `edit_graph_add_risk` is a kind it genuinely branches on.
    //
    // ⚠ AND THE LIMIT OF THIS CONTROL, stated because a reviewer named it: a
    // reason OTHER than `no_pending_clarification` proves the branch was
    // ENTERED, not that a resume succeeded. That is all it is claimed to prove.
    // The evidence that an answer reaches the writer is the route-level suite
    // (`__tests__/goal-target-elicitation-route-level.test.ts`), which asserts
    // the COMMITTED tuple.
    const pending = [
      {
        action: { kind: 'edit_graph_add_risk', label: 'Pro Plan Churn Rate' },
        expires_at_turn_count: 3,
      },
    ];
    const result = resume('the churn one', pending);
    if (result.matched) return;
    expect(result.skip_reason).not.toBe('no_pending_clarification');
  });
});
