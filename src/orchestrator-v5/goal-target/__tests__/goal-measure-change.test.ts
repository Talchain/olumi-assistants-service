/** N1 reader pair: the producer retains the old-unit level; it cannot establish a new-unit chance. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { goalChanceTargetCause, withholdUnusableGoalChances } from '../goal-chance-gate.js';
import { goalChanceLicenceOf, withEvaluatedGoalChanceInputs } from '../goal-chance-licence.js';
import { GOAL_FIGURES_PROBABILITY_UNUSABLE } from '../../../orchestrator/context/option-result-source.js';

type Rec = Record<string, any>;
const capacity = JSON.parse(readFileSync(new URL('../../agent-lane/__tests__/fixtures/capacity-003921Z-served-draft.json', import.meta.url), 'utf8')) as Rec;
const goalId = 'weekly_support_capacity';
const scored = (): Rec => ({
  option_comparison: [
    { option_id: 'a', probability_of_goal: 0.62, win_probability: 0.7, outcome: { mean: 0.5 } },
    { option_id: 'b', probability_of_goal: 0.41, win_probability: 0.3, outcome: { mean: 0.4 } },
  ],
  decision_brief: { analysis_summary: { goal_fit: 0.62, leading_option: 'a' } },
  constraint_results: [{ constraint_id: 'budget', probability: 0.83 }],
  inference_warnings: [],
});
const goalOf = (graph: Rec): Rec => graph.nodes.find((n: Rec) => n.id === goalId);

// The saved postimage described in Founder's banked N1 producer row: 20 customers, with the complete
// recorded 80 tickets/week observation retained. This does not apply that foreign producer bank.
function changedMeasure(): Rec {
  const graph = structuredClone(capacity.graph);
  const goal = goalOf(graph);
  Object.assign(goal, { goal_threshold_raw: 20, goal_threshold: 0.8, goal_threshold_cap: 25,
    goal_threshold_unit: 'customers', goal_horizon: { deadline: '2027-06-30' } });
  goal.observed_state = { ...goal.observed_state, source: 'user_override',
    reviewed_by_user: { intent: 'set', at: '2026-10-16T12:00:00Z' } };
  return graph;
}

describe('N1 — a retained current level never changes its measure with the target', () => {
  it('withholds the dependent chance and licence, retaining the old-unit level, independent budget, outcome and ordering', () => {
    const graph = changedMeasure();
    const before = structuredClone(graph);
    const input = scored();
    const out = withholdUnusableGoalChances(input, graph, goalId) as Rec;
    expect(goalChanceTargetCause(graph, goalId)).toBe('current_level_unit_mismatch');
    expect(goalChanceLicenceOf(input, graph, goalId)).toBeNull();
    expect(out.option_comparison).toEqual(input.option_comparison.map(({ probability_of_goal: _p, ...kept }: Rec) => kept));
    expect(out.decision_brief.analysis_summary).toEqual({ leading_option: 'a' });
    expect(out.constraint_results).toBe(input.constraint_results);
    expect(out.inference_warnings).toContainEqual(expect.objectContaining({
      code: GOAL_FIGURES_PROBABILITY_UNUSABLE,
      causes: [{ option_id: 'a', cause: 'current_level_unit_mismatch' }, { option_id: 'b', cause: 'current_level_unit_mismatch' }],
      message: expect.stringContaining('current level'),
    }));
    expect(graph).toEqual(before);
    expect(goalOf(graph).observed_state).toMatchObject({ raw_value: 80, value: 0.16, cap: 500,
      unit: 'tickets per week', source: 'user_override', reviewed_by_user: before.nodes.find((n: Rec) => n.id === goalId).observed_state.reviewed_by_user });
    expect(input.option_comparison[0].probability_of_goal).toBe(0.62);
  });

  it.each([
    ['tickets per week', 'customers'], ['tickets/week', 'tickets/month'], ['GBP/month', 'USD/month'],
    ['GBP MRR', 'GBP ARR'], ['%', 'percentage points'],
  ])('a recorded level in %s cannot support a target in %s', (oldUnit, unit) => {
    const graph = changedMeasure();
    Object.assign(goalOf(graph), { goal_threshold_unit: unit, observed_state: { raw_value: 0, value: 0, unit: oldUnit } });
    expect(goalChanceTargetCause(graph, goalId)).toBe('current_level_unit_mismatch');
    expect(goalChanceLicenceOf(scored(), graph, goalId)).toBeNull();
  });

  it('a normalised-only retained observation is not silently assigned the new target unit', () => {
    const graph = changedMeasure();
    delete goalOf(graph).observed_state.raw_value;
    expect(goalChanceTargetCause(graph, goalId)).toBe('current_level_unit_mismatch');
    expect(goalChanceLicenceOf(scored(), graph, goalId)).toBeNull();
  });

  it('the final dispatched-input scope also refuses that saved postimage without erasing an independent budget claim', () => {
    const graph = changedMeasure();
    const input = scored();
    const checked = withEvaluatedGoalChanceInputs(input, graph, goalId, {
      graph: structuredClone(graph), goal_node_id: goalId, options: [{ id: 'a' }, { id: 'b' }],
    });
    expect(checked.scope).toMatchObject({ status: 'invalid', can_show_goal_chance: false,
      reasons: expect.arrayContaining(['wrong_or_missing_unit']) });
    expect(checked.response.option_comparison.every((r: Rec) => !('probability_of_goal' in r))).toBe(true);
    expect(checked.response.constraint_results).toBe(input.constraint_results);
    expect(goalOf(graph).observed_state.unit).toBe('tickets per week');
  });

  it.each([['tickets per week', 'tickets/week'], ['GBP/month', '£ per month'], ['GBP/month', 'gbp/months']])(
    'same measure control: %s and %s retain the original licensed figures', (oldUnit, unit) => {
      const graph = changedMeasure();
      Object.assign(goalOf(graph), { goal_threshold_unit: unit, observed_state: { raw_value: 80, value: 0.16, cap: 500,
        unit: oldUnit, source: 'user_override' } });
      expect(goalChanceTargetCause(graph, goalId)).toBeNull();
      const input = scored();
      expect(withholdUnusableGoalChances(input, graph, goalId)).toBe(input);
      expect(goalChanceLicenceOf(input, graph, goalId)).toMatchObject({ pct_by_option: { a: 62, b: 41 } });
    });

  it('a mismatch on another goal cannot withhold an independently evidenced goal claim', () => {
    const graph = changedMeasure();
    graph.nodes.push({ id: 'other_goal', kind: 'goal', label: 'Customers', goal_threshold_raw: 20,
      goal_threshold: 0.8, goal_threshold_unit: 'customers', goal_direction: '>=',
      observed_state: { raw_value: 12, value: 0.48, cap: 25, unit: 'customers', source: 'user_override' } });
    expect(goalChanceTargetCause(graph, goalId)).toBe('current_level_unit_mismatch');
    expect(goalChanceTargetCause(graph, 'other_goal')).toBeNull();
    expect(goalChanceLicenceOf(scored(), graph, 'other_goal')).toMatchObject({ goal_node_id: 'other_goal', pct_by_option: { a: 62, b: 41 } });
  });

  it('a historical Run stays on its evaluated graph; today’s new measure supplies no historical level', () => {
    const evaluated = structuredClone(capacity.graph);
    const before = structuredClone(evaluated);
    const today = changedMeasure();
    expect(goalChanceTargetCause(today, goalId)).toBe('current_level_unit_mismatch');
    expect(goalChanceTargetCause(evaluated, goalId)).toBeNull();
    expect(goalChanceLicenceOf(scored(), evaluated, goalId)).toMatchObject({ target: { value: 100, unit: 'tickets per week' }, pct_by_option: { a: 62, b: 41 } });
    expect(evaluated).toEqual(before);
    expect(goalOf(today).goal_threshold_unit).toBe('customers');
  });
});
