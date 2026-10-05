/**
 * RT-10 B′ R2 at T1 (Science d5 ruling, 5 Oct): while the goal's target can't be tested, the goal's OWN target row is the
 * target (DR row 1), not a feasibility limit, so the T1/B5 ratified set does not also count it as an unchecked limit.
 *
 * Measured on the red team's rt10b Run 2 (the post-edit graph through the real handler, real PLoT 2473ace minimise body):
 * the leader was withheld with `constraint_withheld`, because T1 counted the "at most 400" row PLoT could not score. The
 * no-target Run of the same graph has no such row, so stating the target removed the leader.
 *
 * `untestableGoalTargetRowId` names the ONE row that leaves the set. Science's conditions, one row each: bound by the
 * row's identity (the row `goalOwnLimitRow` reads); a deadline row on the goal stays; another node's limit stays; a
 * target that can be tested moves nothing.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { targetTestabilityOf, untestableGoalTargetRowId } from '../target-testability.js';
import { statedGoalTargetOf } from '../../goal-target/stated-goal-target.js';

type Json = Record<string, any>;
const RT10B = JSON.parse(readFileSync(new URL('../../tools/handlers/__tests__/fixtures/bprime-rt10b.json', import.meta.url), 'utf8')) as {
  graph_without_target: Json; graph_with_target: Json;
};
const RAW = JSON.parse(readFileSync(new URL('./fixtures/target-testability-20260930.json', import.meta.url), 'utf8')) as { paul: Json };

const TARGET_ROW_ID = 'gc-17b98af2-dcb1-4470-9b2b-b30b403d50c3';
const goalOf = (g: Json): Json => g.nodes.find((n: Json) => n.kind === 'goal');

/** The post-edit graph with a DEADLINE row on the goal listed FIRST ("within 6 months"), then the target row. */
const withDeadlineFirst = (): Json => {
  const g = structuredClone(RT10B.graph_with_target);
  const goal = goalOf(g);
  g.goal_constraints = [
    { constraint_id: 'gc-deadline-6m', node_id: goal.id, operator: '<=', value: 6, unit: 'months', label: 'within 6 months', deadline_metadata: { months: 6 } },
    ...g.goal_constraints,
  ];
  return g;
};
/** The post-edit graph with ANOTHER node's limit listed first (a cost cap on the courier option's factor). */
const withOtherNodeLimitFirst = (): Json => {
  const g = structuredClone(RT10B.graph_with_target);
  g.goal_constraints = [
    { constraint_id: 'gc-cost-cap', node_id: 'annual_incremental_courier_cost', operator: '<=', value: 50000, unit: '£/year', label: 'courier cost' },
    ...g.goal_constraints,
  ];
  return g;
};
// Paul's funding graph: the goal holds its raw threshold AND its own `>=` row. With today's level and every link into the
// goal sized in £ by the user it is testable (target-testability.test.ts's control); without today's level it is not (P1).
const withToday = (g: Json): Json => { const c = structuredClone(g); for (const n of c.nodes) if (n.kind === 'goal') n.observed_state = { value: 0, baseline: 0, raw_value: 0, unit: '£', cap: n.goal_threshold_cap, source: 'user_stated' }; return c; };
const poundsInto = (g: Json): Json => {
  const c = structuredClone(g);
  for (const e of c.edges) if (e.provenance?.source !== 'user_specified') e.provenance = { ...(e.provenance ?? {}), source: 'user_specified' };
  const goal = goalOf(c);
  for (const e of c.edges) if (e.to === goal.id) e.provenance = { ...(e.provenance ?? {}), source: 'user_specified', natural_effect: { amount: 50000, amount_unit: goal.goal_threshold_unit, per_source_change: 1, per_source_change_unit: 'unit' } };
  return c;
};

describe('B′ R2 at T1 — the goal\'s own target row is the target, never also an unchecked limit', () => {
  it('precondition: the served post-edit graph is not_testable and its only row is the goal\'s own "at most 400"', () => {
    expect(targetTestabilityOf(RT10B.graph_with_target).kind).toBe('not_testable');
    expect(RT10B.graph_with_target.goal_constraints).toHaveLength(1);
    expect(RT10B.graph_with_target.goal_constraints[0]).toMatchObject({ constraint_id: TARGET_ROW_ID, node_id: goalOf(RT10B.graph_with_target).id });
  });

  it('the served row leaves the T1 set, by its id', () => {
    expect(untestableGoalTargetRowId(RT10B.graph_with_target)).toBe(TARGET_ROW_ID);
  });

  it('CONTRAST (DR row 3): a deadline row on the goal stays in T1, even listed first; the target row is the one that leaves', () => {
    expect(untestableGoalTargetRowId(withDeadlineFirst())).toBe(TARGET_ROW_ID);
  });

  it('CONTRAST: another node\'s limit stays in T1, even listed first', () => {
    expect(untestableGoalTargetRowId(withOtherNodeLimitFirst())).toBe(TARGET_ROW_ID);
  });

  it('CONTRAST: no target (the pre-edit graph) → nothing leaves', () => {
    expect(untestableGoalTargetRowId(RT10B.graph_without_target)).toBeNull();
  });

  it('CONTRAST (Codex r1 #2606): beside a raw target, a row stating ANOTHER figure is a separate limit — it stays in T1 and lends no comparator', () => {
    const g = poundsInto(RAW.paul);
    const row = g.goal_constraints[0];
    row.value = 1400000; row.operator = '<=';
    expect(targetTestabilityOf(g).kind).toBe('not_testable');
    expect(untestableGoalTargetRowId(g)).toBeNull();
    expect(statedGoalTargetOf(g, goalOf(g))).toEqual({ value: 1200000, unit: '£', frame: 'level' });
  });

  it('CONTRAST: a target that can be tested moves nothing; the same graph without today\'s level names its own row', () => {
    const testable = poundsInto(withToday(RAW.paul));
    expect(targetTestabilityOf(testable).kind).toBe('testable');
    expect(untestableGoalTargetRowId(testable)).toBeNull();
    const untestable = poundsInto(RAW.paul);
    expect(targetTestabilityOf(untestable).kind).toBe('not_testable');
    expect(untestableGoalTargetRowId(untestable)).toBe('gc-063988fd-b2ad-4a51-8261-cf2f1ab105f6');
  });
});
