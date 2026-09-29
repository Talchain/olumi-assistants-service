/**
 * ⭐⭐ THE GOAL-TARGET ANSWER RESOLVER — ONE typed way in, and nothing else.
 *
 * `tryGoalTargetElicitationResume` decides whether a message may ANSWER the
 * recorded goal-target question. Because the executor grants the mutation
 * warrant on `isConfirmResume` before inspecting the message, a match supplies
 * both the target and its licence to write — so this is an AUTHORITY decision
 * and every doubtful case must refuse.
 *
 * ⛔ FOUR ROUNDS OF PROSE PREDICATES, EACH REFUTED BY A COUNTEREXAMPLE:
 *   b56f54a7  one amount, no other full label       → says nothing about ROLE
 *   690b8735  + no present-state marker             → "Our baseline MRR is £12,000."
 *   35ed6e22  + a target word anywhere              → the word was in another clause
 *   de9010fe  + target word in the amount's clause  → "Our baseline MRR for choosing
 *                                                      a target is £12,000."
 * CLAUDE.md trap 22f: four reversals is proof the approach is wrong. The gate
 * now keeps ONLY what is typed — the message must be the quantity CQE read,
 * plus hedges — and everything richer falls through to the ordinary receiver.
 *
 * ⚠ THE COVERAGE THIS DELIBERATELY GIVES UP is pinned below as its own case, so
 * it stays a decision rather than becoming an accident: "The target is £20,000."
 * no longer binds HERE. It is not lost to the user — an explicit goal statement
 * still reaches the canonical writer by its ordinary route; it simply does not
 * ride the pre-route's pre-granted warrant.
 *
 * Not run locally; hosted CI is the only execution.
 */
import { describe, expect, it } from 'vitest';

import { tryGoalTargetElicitationResume } from '../clarification-resume.js';

const NOW = Date.parse('2026-09-09T08:00:00.000Z');
const GRAPH_HASH = 'hash-goal-answer';
const NODES = [
  { id: 'g-revenue', label: 'Reach £20k MRR within 12 months' },
  { id: 'f-churn', label: 'Pro Plan Churn Rate' },
];

/**
 * ⛔ THE HELPER THAT SILENTLY DISARMED THREE OF ITS OWN CONTROLS.
 *
 * It used to spread `...overrides` AFTER the nested `action`, so
 * `pending({ action: { unit: 'GBP' } })` REPLACED the whole action with
 * `{ unit: 'GBP' }` — no `kind`, no `goal_node_id`, no `question`. Every case
 * built that way refused for the wrong reason and proved nothing about the
 * branch it named. Found by the independent review in the hosted failures, not
 * by me. `action` is now destructured out and merged, and the caller-visible
 * shape is unchanged.
 */
function pending(overrides: Record<string, unknown> = {}) {
  const { action: actionOverride, ...rest } = overrides;
  return {
    id: 'pa-goal-1',
    ...rest,
    action: {
      kind: 'elicit_goal_target',
      goal_node_id: 'g-revenue',
      question: 'What value counts as success for this goal?',
      ...(actionOverride as Record<string, unknown> | undefined),
    },
    expires_at_turn_count: 3,
    expires_at_iso: new Date(NOW + 600_000).toISOString(),
    preconditions: { graph_hash: GRAPH_HASH },
  };
}

function resume(message: string, pendings: readonly unknown[], hash: string | undefined = GRAPH_HASH) {
  return tryGoalTargetElicitationResume({
    message,
    pendingActions: pendings as never,
    nowMs: NOW,
    ...(hash === undefined ? {} : { currentGraphHash: hash }),
    graphNodes: NODES,
  });
}

/** Narrow to the refusal arm that carries a `reason`, then read it. */
function refusalReason(result: ReturnType<typeof resume>): string {
  if (result.matched) throw new Error('expected a refusal, got a match');
  if (result.skip_reason !== 'unreadable_answer') {
    throw new Error(`expected unreadable_answer, got ${result.skip_reason}`);
  }
  return result.reason;
}

describe('the quantity CQE read, plus hedges — and nothing else', () => {
  it('⭐ POSITIVE — "£20k" answers the question and yields goal, value and unit', () => {
    const result = resume('£20k', [pending()]);
    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.goalNodeId).toBe('g-revenue');
    expect(result.value).toBe(20000);
    // ⚠ `£`, and the route to it matters more than the spelling. CQE emits
    // `GBP`; the resolver crosses to writer units through the ESTABLISHED
    // `mapCqeQuantityToProposalValue`, which maps `GBP` → `£`. So this asserts
    // the shared mapper's output, not a preferred symbol — and I have had this
    // wrong in BOTH directions, first expecting `£` from a producer that emits
    // `GBP`, then expecting `GBP` at a boundary that converts.
    expect(result.unit).toBe('£');
  });

  it('a bare number answers it too, taking the unit the question established', () => {
    // The pending's unit is NOT mapped — it was captured from an already
    // registered target, so it is in writer units already.
    const result = resume('20000', [pending({ action: { unit: '£' } })]);
    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.value).toBe(20000);
    expect(result.unit).toBe('£');
  });

  it('HEDGED — "about £20k" is still just the amount', () => {
    // `about` is answer furniture, from `ANSWER_HEDGE_WORDS` (derived in
    // `stated-level.ts` from its closed qualifier list minus the tense words).
    const result = resume('about £20k', [pending()]);
    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.value).toBe(20000);
  });

  it('⭐ PERCENTAGE — the scale is converted to the writer\'s convention', () => {
    // CQE deliberately represents "92%" as value 0.92 / unit `percentage`.
    // `add_constraint` stores `params.value` in USER UNITS and its cap helper
    // expects the RAW PERCENT NUMBER against the literal '%'. Handing CQE's
    // pair through unchanged registered 0.92 against a 1.15 denominator instead
    // of 92 against 100 — the person's number scored on the wrong scale,
    // silently. The crossing now goes through the established mapper.
    const result = resume('92%', [pending()]);
    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.value).toBe(92);
    expect(result.unit).toBe('%');
  });

  it('PUNCTUATION is not content — "£20,000." binds', () => {
    const result = resume('£20,000.', [pending()]);
    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.value).toBe(20000);
  });
});

describe('every richer message falls through — the four refuted predicates', () => {
  it('⭐ ROUND 4 — "our baseline MRR FOR CHOOSING A TARGET is £12,000"', () => {
    // The counterexample that ended the prose approach: one clause, no `?`, no
    // foreign token, and the word `target` — while £12,000 is explicitly the
    // baseline informing an UNDECIDED target.
    expect(refusalReason(resume('Our baseline MRR for choosing a target is £12,000.', [pending()]))).toBe(
      'not_a_target_answer',
    );
  });

  it('⭐ ROUND 3 — the target word in a DIFFERENT clause', () => {
    expect(
      refusalReason(resume('Our baseline MRR is £12,000; what target should we choose?', [pending()])),
    ).toBe('not_a_target_answer');
  });

  it('⭐ ROUND 2 — a baseline report carrying no present-state marker', () => {
    expect(refusalReason(resume('Our baseline MRR is £12,000.', [pending()]))).toBe(
      'not_a_target_answer',
    );
  });

  it('⭐ ROUND 1 — a current-level report', () => {
    expect(refusalReason(resume('Our current MRR is £12,000.', [pending()]))).toBe(
      'not_a_target_answer',
    );
  });

  it('⭐ ROUND 5 — "Set churn to 4%" is a scoped edit, not the goal\'s answer', () => {
    // The counterexample against subtracting `raw_text`. CQE's instruction
    // pattern matches the WHOLE message — verb and subject included — and
    // `makeResult` assigns all of it to `raw_text`, so subtracting it left an
    // EMPTY residue and `.every()` on an empty array is true. A scoped factor
    // edit was accepted as the revenue goal's answer, with the pre-route's
    // pre-granted warrant behind it.
    //
    // Subtracting the VALUE TOKEN SPAN instead leaves "set churn to" standing,
    // which is exactly the evidence that disqualifies it. Note the fixture's
    // churn node is labelled "Pro Plan Churn Rate", so the bare word `churn`
    // does NOT trip the complete-label fence — this case reaches, and must be
    // refused by, eligibility itself.
    expect(refusalReason(resume('Set churn to 4%', [pending()]))).toBe('not_a_target_answer');
  });

  it('⭐ DISTINCT CHURN — a guardrail wearing the word "target"', () => {
    // A goal minimum is not a churn maximum. Retained from the previous round
    // because the harm is real; it now refuses for the general reason rather
    // than through a subject-token test.
    expect(refusalReason(resume('The churn target is 4%', [pending()]))).toBe(
      'not_a_target_answer',
    );
  });

  it('a question about the target is not an answer to it', () => {
    expect(refusalReason(resume('Should the target be £20,000?', [pending()]))).toBe(
      'not_a_target_answer',
    );
  });

  it('⚠ THE COVERAGE GIVEN UP, PINNED — "The target is £20,000." no longer binds HERE', () => {
    // Recorded as a decision, not an accident. This is a genuine goal statement
    // and the gate declines it, because no test over prose survived four
    // rounds. The user does not lose the capability: the ordinary receiver
    // still routes an explicit goal statement to the canonical writer. What it
    // loses is the pre-route's PRE-GRANTED mutation warrant, which is exactly
    // the authority that made a false match dangerous.
    //
    // If this ever starts binding again, someone has reopened the class.
    expect(refusalReason(resume('The target is £20,000.', [pending()]))).toBe(
      'not_a_target_answer',
    );
  });
});

describe('the fences, unchanged', () => {
  it('⭐ CEILING — "keep it under 4%" is never a success minimum', () => {
    // ISL computes P(samples >= t), so recording a ceiling as a >= target would
    // invert the person's meaning.
    expect(refusalReason(resume('keep it under 4%', [pending()]))).toBe('ceiling_not_minimum');
  });

  it('⭐ OTHER SUBJECT — a reply naming another node is refused before eligibility', () => {
    expect(refusalReason(resume('Pro Plan Churn Rate is 4 percent', [pending()]))).toBe(
      'names_other_subject',
    );
  });

  it('SEVERAL AMOUNTS — the product asks again rather than choosing one', () => {
    expect(resume('somewhere between £20k and £30k', [pending()]).matched).toBe(false);
  });

  it('NO PENDING — an ordinary quantity turn is untouched', () => {
    const result = resume('£59', []);
    expect(result.matched).toBe(false);
    if (result.matched) return;
    expect(result.skip_reason).toBe('no_pending_question');
  });

  it('COMPETING QUESTION — a second number-asking pending blocks the bare answer', () => {
    // Liveness, then claimants, then identity. A competing ask must not be
    // counted out of existence.
    const competitor = {
      id: 'pa-baseline',
      action: { kind: 'elicit_target_baseline', target_id: 'f-churn' },
      expires_at_turn_count: 3,
      expires_at_iso: new Date(NOW + 600_000).toISOString(),
    };
    expect(resume('20000', [pending(), competitor]).matched).toBe(false);
  });

  it('GRAPH DIVERGED — a moved model refuses rather than applying a stale answer', () => {
    const result = resume('£20k', [pending()], 'a-different-hash');
    expect(result.matched).toBe(false);
    if (result.matched) return;
    expect(result.skip_reason).toBe('graph_diverged');
  });

  it('TARGET MISSING — the goal is gone, so nothing is resolved', () => {
    const result = resume('£20k', [pending({ action: { goal_node_id: 'g-deleted' } })]);
    expect(result.matched).toBe(false);
    if (result.matched) return;
    expect(result.skip_reason).toBe('target_missing');
  });
});
