/**
 * The comparator on a verified goal-target approval, carried to the existing writer without a wire field.
 * The public goal_target_edit event keeps its inclusive direction; this in-process context carries the exact
 * comparator the user approved, following the stated-link-band-context precedent. It applies only to that write's
 * scenario, goal and authorisation turn, so a different event cannot inherit its strictness.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export interface StatedGoalOperator {
  readonly scenario_id: string;
  readonly goal_node_id: string;
  readonly turn_id: string;
  readonly operator: '<' | '<=' | '>' | '>=';
}

const store = new AsyncLocalStorage<StatedGoalOperator>();

/** Dispatch one verified approval inside its stated comparator. */
export function runWithStatedGoalOperator<T>(stated: StatedGoalOperator, fn: () => Promise<T>): Promise<T> {
  return store.run(stated, fn);
}

/** The stated comparator for this exact write; absent or mismatched context supplies nothing. */
export function statedGoalOperatorFor(
  scenarioId: string,
  goalNodeId: string,
  turnId: string,
): StatedGoalOperator['operator'] | undefined {
  const stated = store.getStore();
  return stated !== undefined && stated.scenario_id === scenarioId && stated.goal_node_id === goalNodeId && stated.turn_id === turnId
    ? stated.operator : undefined;
}
