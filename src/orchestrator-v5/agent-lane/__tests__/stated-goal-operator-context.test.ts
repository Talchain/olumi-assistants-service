import { describe, expect, it } from 'vitest';
import { runWithStatedGoalOperator, statedGoalOperatorFor } from '../stated-goal-operator-context.js';

const write = { scenario_id: 'scenario-a', goal_node_id: 'churn', turn_id: 'approval-a', operator: '<' } as const;
const read = () => statedGoalOperatorFor(write.scenario_id, write.goal_node_id, write.turn_id);

describe('an approved goal comparator belongs to one exact in-process write', () => {
  it('requires the scenario, goal and authorisation turn, then disappears after the dispatch', async () => {
    expect(read()).toBeUndefined();
    await runWithStatedGoalOperator(write, async () => {
      await Promise.resolve();
      expect(read()).toBe('<');
      expect(statedGoalOperatorFor('scenario-b', write.goal_node_id, write.turn_id)).toBeUndefined();
      expect(statedGoalOperatorFor(write.scenario_id, 'another-goal', write.turn_id)).toBeUndefined();
      expect(statedGoalOperatorFor(write.scenario_id, write.goal_node_id, 'approval-b')).toBeUndefined();
    });
    expect(read()).toBeUndefined();
  });

  it('isolates concurrent writes and restores the outer comparator after a nested write', async () => {
    await Promise.all([
      runWithStatedGoalOperator(write, async () => {
        await Promise.resolve();
        expect(read()).toBe('<');
        await runWithStatedGoalOperator({ ...write, operator: '<=' }, async () => {
          expect(read()).toBe('<=');
        });
        expect(read()).toBe('<');
      }),
      runWithStatedGoalOperator({ ...write, turn_id: 'approval-b', operator: '>' }, async () => {
        await Promise.resolve();
        expect(read()).toBeUndefined();
        expect(statedGoalOperatorFor(write.scenario_id, write.goal_node_id, 'approval-b')).toBe('>');
      }),
    ]);
    expect(read()).toBeUndefined();
  });
});
