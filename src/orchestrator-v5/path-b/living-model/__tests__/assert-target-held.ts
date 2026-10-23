import { expect } from 'vitest';
import { withGoalChanceLicence, goalChanceLicenceForAgent } from '../../../goal-target/goal-chance-licence.js';
import { goalDependencyCauses } from '../../../admission/target-testability.js';

type Rec = Record<string, any>;
/** Preserve the original negative control: a producer-supplied probability may not escape a held target. */
export function assertTargetHeld(graph: Rec, id: string, expectedTarget?: number): void {
  const target = graph.nodes.find((n: Rec) => n.id === id)!;
  expect(target.goal_rests_on?.length).toBeGreaterThan(0);
  expect(goalDependencyCauses(graph, id).length).toBeGreaterThan(0);
  if (expectedTarget !== undefined) expect(target.goal_threshold_raw).toBe(expectedTarget);
  const rows = graph.nodes.filter((n: Rec) => n.kind === 'option').map((n: Rec) => ({ option_id: n.id, probability_of_goal: 0.75 }));
  const checked = withGoalChanceLicence({ option_comparison: rows, inference_warnings: [] }, graph, id);
  expect(checked.option_comparison.every((r: Rec) => !Object.hasOwn(r, 'probability_of_goal'))).toBe(true);
  expect(goalChanceLicenceForAgent(checked)).toBeUndefined();
}
