import { refreshScopePending } from '../agent-lane/goal-scope.js';
import type { PendingAction } from '../session/pending-action.js';
import type { GoalScopeReconciliation } from '../../schemas/goal-scope.js';

/** Input to the existing claim composer, never a persisted permission authority. */
export interface GoalScopeClaimInput {
  readonly status: 'clear' | 'unresolved' | 'unavailable';
  readonly issues: readonly GoalScopeReconciliation[];
}

/** An answer's expired binding does not resolve the underlying scope issue. */
export function goalScopeClaimInput(
  pending: readonly PendingAction[],
  graph: unknown,
): GoalScopeClaimInput {
  const issues = pending.flatMap(p => {
    const current = refreshScopePending(p, graph);
    return current?.action.kind === 'reconcile_goal_scope' ? [current.action] : [];
  });
  return { status: issues.length === 0 ? 'clear' : 'unresolved', issues };
}

/** The caller supplies the existing integrity-strict canonical pending reader. */
export async function readGoalScopeClaimInput(
  graph: unknown,
  readPending: () => Promise<readonly PendingAction[]>,
): Promise<GoalScopeClaimInput> {
  try {
    return goalScopeClaimInput(await readPending(), graph);
  } catch {
    // No fabricated issue list, and no attested empty result after a failed read.
    return { status: 'unavailable', issues: [] };
  }
}
