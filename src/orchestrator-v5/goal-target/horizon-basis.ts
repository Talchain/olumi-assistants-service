import { createHash } from 'node:crypto';
import { NodeV3 } from '../../schemas/cee-v3.js';

type Rec = Record<string, unknown>;
const record = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

/** S5 2b r7 (a2): bind the user's judgement to the goal's trajectory; their model copy keeps it. */
export function horizonBasisMetricKey(goal: Rec): string {
  const label = typeof goal.label === 'string' ? goal.label.trim().toLowerCase().replace(/\s+/g, ' ') : '';
  return createHash('sha256').update(JSON.stringify([
    goal.id, label, goal.goal_threshold_unit ?? null, goal.goal_horizon_months,
  ])).digest('hex').slice(0, 32);
}

/** Only a complete user-stated answer for the sole goal's current meaning licenses steady-state time. */
export function horizonSteadyAttested(graph: unknown): boolean {
  // S5: move to readGoalRecord when #2897 lands
  if (!record(graph) || !Array.isArray(graph.nodes)) return false;
  const nodes = graph.nodes.filter(record);
  if (nodes.some(n => record(n.nonlinear_identity) && n.nonlinear_identity.operation === 'accumulation')) return false;
  const goals = nodes.filter(n => n.kind === 'goal');
  if (goals.length !== 1) return false;
  const goal = goals[0]!;
  const basis = NodeV3.shape.horizon_basis.parse(goal.horizon_basis);
  return typeof goal.id === 'string' && typeof goal.label === 'string'
    && typeof goal.goal_horizon_months === 'number' && Number.isInteger(goal.goal_horizon_months) && goal.goal_horizon_months > 0
    && basis !== undefined && basis.bound_months === goal.goal_horizon_months
    && basis.metric === horizonBasisMetricKey(goal);
}
