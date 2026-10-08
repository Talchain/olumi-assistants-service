/** Science §(ad)(3): only the user's card answer for this held month licences steady-state time. */
export function horizonSteadyAttested(goal: unknown): boolean {
  if (goal === null || typeof goal !== 'object' || Array.isArray(goal)) return false;
  const g = goal as Record<string, unknown>;
  return g.kind === 'goal'
    && typeof g.goal_horizon_months === 'number' && Number.isInteger(g.goal_horizon_months) && g.goal_horizon_months > 0
    && g.horizon_basis === 'steady_attested'
    && g.horizon_basis_source === 'user_stated'
    && g.horizon_basis_months === g.goal_horizon_months;
}
