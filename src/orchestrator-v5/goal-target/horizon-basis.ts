type Rec = Record<string, unknown>;

/**
 * Science §(ad) rule 3, P45's predicate (pinned 8 Oct): the user said the goal's level holds still over its own deadline. A deadline edit voids
 * it (the attested month must equal the held one). Read tolerantly until the contract declares these fields; P45 owns the writer.
 */
export function horizonSteadyAttested(goal: unknown): boolean {
  if (goal === null || typeof goal !== 'object' || Array.isArray(goal)) return false;
  const node = goal as Rec;
  return node.kind === 'goal' && Number.isInteger(node.goal_horizon_months) && (node.goal_horizon_months as number) > 0
    && node.horizon_basis === 'steady_attested' && node.horizon_basis_source === 'user_stated'
    && node.horizon_basis_months === node.goal_horizon_months;
}
