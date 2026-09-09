/**
 * ⭐⭐ THE ACTUAL RECEIVER FOR A GOAL-TARGET ANSWER — reproduced, not assumed.
 *
 * The writer hop works (`add-constraint.ts:566-623, 861-880`, covered by
 * `add-constraint-goal-target-join.test.ts`), and #1413's controls exercise it
 * with an already-resolved action. Neither answers the question that matters
 * here: when the product ASKS for a goal target and the person answers in
 * ordinary words, does anything bind that answer to that question?
 *
 * This runs the real `tryClarificationResume` — the receiver `turn-executor.ts:5446`
 * calls — and records what it actually does. Derived at the bytes first:
 *
 *   · `PendingActionAction` (`session/pending-action.ts:261-330`) admits exactly
 *     `set_factor_value`, `run_analysis`, `what_would_flip`,
 *     `apply_proposed_change`, `edit_graph_add_risk`, `draft_graph`. **There is
 *     no goal-target kind**, so a target question cannot be persisted as a
 *     resumable pending action at all;
 *   · `tryClarificationResume:506-521` branches on `set_factor_value` and
 *     `edit_graph_add_risk` only, and otherwise returns
 *     `no_pending_clarification`;
 *   · its FIRST gate (`:499`) deflects a message matching
 *     `EDIT_VERB_OR_QUANTITY_PATTERN` to the deterministic value-update path —
 *     which targets a factor, not the goal's threshold channel.
 *
 * So the missing hop is upstream of the writer and upstream of the resumer: the
 * question is never recorded in a form an answer can be bound to. These cases
 * pin that boundary exactly, so the repair can be judged against measured
 * behaviour rather than a description of it.
 *
 * ⚠ NOT a claim about the native pricing run. It does not say the product asked
 *   a target question there; it says that if it did, nothing would receive the
 *   answer. The raw preimage is still absent.
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

describe('a goal-target answer has no receiver today', () => {
  it('⭐ with no pending goal question, an ordinary target answer is not resumed', () => {
    // "£20k" is the answer shape the product's own target question invites.
    const result = resume('£20k');
    expect(result.matched).toBe(false);
  });

  it('a bare quantity is deflected to the value-update path BEFORE any pending is consulted', () => {
    // The ordering matters for the repair: this gate runs first, so a
    // goal-target pending would not even be reached by a numeric answer.
    const result = resume('20000');
    expect(result.matched).toBe(false);
    expect(result.skip_reason).toBe('message_likely_value_update');
  });

  it('a prose answer with no pending reports the absent question, not a wrong match', () => {
    const result = resume('the revenue one');
    expect(result.matched).toBe(false);
    expect(result.skip_reason).toBe('no_pending_clarification');
  });

  it('POSITIVE CONTROL — the resumer does match a kind it supports, so these are real refusals', () => {
    // Without this, every case above could pass on a resumer that never matches
    // anything. `edit_graph_add_risk` is a kind it genuinely branches on.
    const pending = [
      {
        action: { kind: 'edit_graph_add_risk', label: 'Pro Plan Churn Rate' },
        expires_at_turn_count: 3,
      },
    ];
    const result = resume('the churn one', pending);
    // Either it claims the turn or it declines for a REASON specific to that
    // branch — what it must not do is report `no_pending_clarification`, which
    // would mean the branch was never entered.
    expect(result.skip_reason).not.toBe('no_pending_clarification');
  });
});
