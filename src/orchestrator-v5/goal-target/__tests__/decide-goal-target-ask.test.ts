/**
 * The consumer seam: whether to ask, and what sentence.
 *
 * ⛔ THE PROPERTY UNDER TEST IS CODEX'S RULING, NOT A COPY PREFERENCE:
 * "a neutral amount question must not present a rejected or unrelated amount as
 * the user's choice", and `binding: governed` is never authority to mint,
 * preselect or assert.
 */
import { describe, it, expect } from 'vitest';
import {
  decideGoalTargetAsk,
  composeGoalTargetQuestion,
} from '../decide-goal-target-ask.js';
import type { GoalTargetCandidate } from '../../../cee/factor-extraction/goal-label-target.js';

const GOAL = { id: 'goal_mrr', kind: 'goal' as const };

const candidate = (over: Partial<GoalTargetCandidate> = {}): GoalTargetCandidate =>
  ({
    goal_node_id: 'goal_mrr',
    value_user_units: 64000,
    unit: '£',
    label_span: 'Reach £64k MRR',
    brief_span: '£64k MRR',
    binding: 'present_unbound',
    reason: 'negated_target',
    ...over,
  }) as GoalTargetCandidate;


const THE_QUESTION = 'What target should this goal be scored against? Reply with an amount.';

describe('the figure is NEVER quoted — no value of `binding` licenses it', () => {
  /**
   * ⛔ I FIRST QUOTED ON `binding === 'governed'`, reading the producer's docstring
   * ("how well the user's own words bind the figure"). **The producer's own corpus
   * refutes that:** its S20 case pins "We rejected the proposal to reach £64k MRR."
   * as `governed`, because `governed` means *the round-5 governor would have minted
   * it*, NOT *the user established it*. The rejected proposal is the CANONICAL
   * member of that class — so quoting on `governed` quotes back the one figure the
   * brief explicitly refused.
   *
   * Caught by Codex against the REAL producer output, after my own hostile-case
   * test passed by FABRICATING `present_unbound` for that brief.
   */
  it.each([
    ['governed', 'governed'],
    ['present_unbound', 'quantity_not_stated_as_target'],
    ['present_unbound', 'stated_as_current_level'],
    ['present_unbound', 'stated_as_spend'],
    ['present_unbound', 'stated_as_past'],
    ['present_unbound', 'limit_direction_not_representable'],
    ['present_unbound', 'negated_target'],
    ['present_unbound', 'hypothetical_target'],
    ['present_unbound', 'subject_not_bound'],
    ['present_unbound', 'metric_mismatch'],
    ['present_unbound', 'metric_unbound'],
    ['present_unbound', 'outside_goal_statement'],
    ['present_unbound', 'stated_as_change_amount'],
  ])('%s/%s ⇒ the neutral question, with no figure', (binding, reason) => {
    const q = composeGoalTargetQuestion(
      candidate({ binding: binding as never, reason: reason as never, brief_span: '£64k MRR', value_user_units: 64000 }),
    );
    expect(q).not.toContain('64');
    expect(q).not.toContain('£');
    // ⭐ NON-VACUITY: "never quotes" must not be satisfiable by an empty or
    // degenerate sentence. The exact question is the discriminator.
    expect(q).toBe(THE_QUESTION);
  });

  it("⭐ the two bindings produce the SAME sentence — the rule is not accidentally neutral for one", () => {
    const g = composeGoalTargetQuestion(candidate({ binding: 'governed', reason: 'governed' as never }));
    const u = composeGoalTargetQuestion(candidate({ binding: 'present_unbound', reason: 'negated_target' }));
    expect(g).toBe(u);
    expect(g).toBe(THE_QUESTION);
  });

  it('and it never asks for a yes/no, which the receiver could not honour anyway', () => {
    const q = composeGoalTargetQuestion(candidate({ binding: 'governed', reason: 'governed' as never }));
    expect(q).toMatch(/Reply with an amount/);
    expect(q).not.toMatch(/is your target|confirm|yes\/no/i);
  });
});

describe('unit is carried only when the user established it', () => {
  it('a bare figure yields unit "count", which is NOT user-established ⇒ omitted', () => {
    const d = decideGoalTargetAsk(candidate({ binding: 'governed', unit: 'count' }), [GOAL]);
    expect(d.ask).toBe(true);
    expect(d).not.toHaveProperty('unit');
  });

  it('⭐ TWIN: a symbol from the brief IS carried, so the rule is not a blanket drop', () => {
    const d = decideGoalTargetAsk(candidate({ binding: 'governed', unit: '£' }), [GOAL]);
    expect(d).toMatchObject({ ask: true, unit: '£' });
  });
});

describe('when no question is put, it refuses by name', () => {
  it('no candidate ⇒ no_candidate', () => {
    expect(decideGoalTargetAsk(undefined, [GOAL])).toEqual({
      ask: false,
      refusal: 'no_candidate',
    });
  });

  it('the goal is absent from the PERSISTED graph ⇒ goal_absent_from_persisted_graph', () => {
    expect(decideGoalTargetAsk(candidate(), [{ id: 'goal_other' }])).toEqual({
      ask: false,
      refusal: 'goal_absent_from_persisted_graph',
    });
  });

  it.each([
    ['goal_threshold', { id: 'goal_mrr', goal_threshold: 0.2 }],
    ['goal_threshold_raw', { id: 'goal_mrr', goal_threshold_raw: 20000 }],
    ['a zero target, which is a REAL target', { id: 'goal_mrr', goal_threshold_raw: 0 }],
  ])('a persisted target via %s ⇒ target_already_registered', (_label, goal) => {
    expect(decideGoalTargetAsk(candidate(), [goal])).toEqual({
      ask: false,
      refusal: 'target_already_registered',
    });
  });

  it('⭐ TWIN: a goal with NO registered target still asks — the guard is not a blanket refusal', () => {
    expect(decideGoalTargetAsk(candidate(), [GOAL]).ask).toBe(true);
  });

  it('a non-finite threshold is NOT a registered target', () => {
    expect(decideGoalTargetAsk(candidate(), [{ id: 'goal_mrr', goal_threshold_raw: NaN }]).ask).toBe(
      true,
    );
  });
});

describe('the decision never carries a value', () => {
  it('no arm of the decision exposes value_user_units', () => {
    const d = decideGoalTargetAsk(candidate({ binding: 'governed' }), [GOAL]);
    expect(JSON.stringify(d)).not.toContain('value_user_units');
    expect(d).not.toHaveProperty('value_user_units');
  });
});
