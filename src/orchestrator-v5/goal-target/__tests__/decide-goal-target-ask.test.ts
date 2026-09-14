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

/**
 * ⭐ THE HOSTILE SET, drawn from the producer's OWN refusal union rather than
 * from my head — every `present_unbound` reason means the figure was NOT stated
 * as this goal's target. None of them may be quoted back at the user.
 */
const PRESENT_UNBOUND_REASONS = [
  'quantity_not_stated_as_target',
  'stated_as_current_level',
  'stated_as_spend',
  'stated_as_past',
  'limit_direction_not_representable',
  'negated_target',
  'hypothetical_target',
  'subject_not_bound',
  'metric_mismatch',
  'metric_unbound',
  'outside_goal_statement',
  'stated_as_change_amount',
] as const;

describe('the question never presents a rejected or unrelated amount as the choice', () => {
  it.each(PRESENT_UNBOUND_REASONS)(
    'present_unbound/%s ⇒ the figure is NOT quoted',
    (reason) => {
      const q = composeGoalTargetQuestion(
        candidate({ binding: 'present_unbound', reason: reason as never }),
      );
      expect(q).not.toContain('64');
      expect(q).not.toContain('£');
      // NON-VACUITY: it still asks, so "never quotes" cannot be satisfied by
      // returning an empty string.
      expect(q).toContain('Reply with an amount');
    },
  );

  it('⭐ DISCRIMINATING TWIN: a GOVERNED figure IS quoted — so the rule above is a rule, not a mute', () => {
    const q = composeGoalTargetQuestion(
      candidate({ binding: 'governed', reason: 'governed' as never, brief_span: '£20k MRR' }),
    );
    expect(q).toContain('£20k MRR');
    expect(q).toContain('Reply with an amount');
    // and it is a statement of fact, never a proposal
    expect(q).toContain('mentions');
    expect(q).not.toMatch(/is your target|confirm|yes\/no/i);
  });

  it('Codex’s decisive case: "We rejected the proposal to reach £64k MRR" never surfaces 64k', () => {
    const q = composeGoalTargetQuestion(
      candidate({ binding: 'present_unbound', reason: 'negated_target' }),
    );
    expect(q).toBe('What target should this goal be scored against? Reply with an amount.');
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
