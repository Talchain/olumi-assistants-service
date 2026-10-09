import { createHash, createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import { config } from '../../config/index.js';
import { NodeV3 } from '../../schemas/cee-v3.js';
import { readGoalRecord } from './goal-record.js';

type Rec = Record<string, unknown>;
const record = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Server-only key; existing config resolves CEE_HMAC_SECRET ?? HMAC_SECRET. */
export function horizonBasisProofKey(): Buffer | null {
  const secret = config.auth.hmacSecret;
  return typeof secret !== "string" || secret.trim() === "" ? null : Buffer.from(hkdfSync('sha256', secret, '', 'olumi/s5/horizon_basis/v1', 32));
}

/** S5 2b r12 (a2): bind the user's judgement to the goal's trajectory and approved deadline; their model copy keeps it. */
export function horizonBasisMetricKey(graph: unknown, goal: Rec): string {
  const label = typeof goal.label === 'string' ? goal.label.trim().toLowerCase().replace(/\s+/g, ' ') : '';
  const deadline = typeof goal.id === 'string' ? readGoalRecord(graph, goal.id)?.horizon?.deadline ?? null : null;
  return createHash('sha256').update(JSON.stringify([
    goal.id, label, goal.goal_threshold_unit ?? null, goal.goal_horizon_months, deadline,
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
  const key = horizonBasisProofKey();
  if (key === null || basis === undefined || !/^[0-9a-f]{64}$/.test(basis.proof)) return false;
  const expected = createHmac('sha256', key).update(JSON.stringify([
    goal.id, basis.bound_months, basis.metric, basis.basis, basis.source,
  ])).digest();
  return timingSafeEqual(expected, Buffer.from(basis.proof, 'hex')) && typeof goal.id === 'string' && typeof goal.label === 'string'
    && typeof goal.goal_horizon_months === 'number' && Number.isInteger(goal.goal_horizon_months) && goal.goal_horizon_months > 0
    && basis !== undefined && basis.bound_months === goal.goal_horizon_months
    && basis.metric === horizonBasisMetricKey(graph, goal);
}
