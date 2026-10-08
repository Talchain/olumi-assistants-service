/** Science §(ad): one typed horizon verdict for the producer and every reply surface. */
import { evaluatedIdentityCarriers } from '../admission/identity-evaluations.js';
import { NodeV3 } from '../../schemas/cee-v3.js';
import { horizonSteadyAttested } from './horizon-basis.js';

type Rec = Record<string, unknown>;
const recordOf = (value: unknown): Rec | undefined => value !== null && typeof value === 'object'
  && !Array.isArray(value) ? value as Rec : undefined;

export type GoalHorizonVerdict = 'no_horizon' | 'computed_at_h' | 'steady_attested' | 'withhold';
export const GOAL_HORIZON_STEADY_ATTESTED = 'GOAL_HORIZON_STEADY_ATTESTED';

/** A Run's carrier must attest the declared positional inputs and the goal's own month. */
export function accumulationTestedAtGoalHorizon(graph: unknown, envelope?: unknown): boolean {
  const rawNodes = recordOf(graph)?.nodes;
  if (!Array.isArray(rawNodes)) return false;
  const nodes = rawNodes.map(recordOf).filter((node): node is Rec => node !== undefined);
  const goals = nodes.filter(node => node.kind === 'goal');
  if (goals.length !== 1) return false;
  const goal = goals[0]!;
  if (!Number.isInteger(goal.goal_horizon_months) || (goal.goal_horizon_months as number) <= 0) return false;
  const product = NodeV3.shape.nonlinear_identity.safeParse(goal.nonlinear_identity).data;
  if (product?.operation !== 'product') return false;
  const env = recordOf(envelope);
  const evaluated = env === undefined ? undefined : evaluatedIdentityCarriers(nodes,
    Array.isArray(env.identity_evaluations) ? env.identity_evaluations : undefined);
  if (evaluated === undefined ? product.stated_in_brief !== true : !evaluated.has(goal.id)) return false;
  return product.factor_ids.some(id => {
    const node = nodes.find(candidate => candidate.id === id);
    const carrier = NodeV3.shape.nonlinear_identity.safeParse(node?.nonlinear_identity).data;
    return carrier?.operation === 'accumulation' && carrier.horizon_months === goal.goal_horizon_months
      && (evaluated === undefined ? carrier.stated_in_brief === true : evaluated.has(id));
  });
}

export function goalHorizonVerdict(graph: unknown, envelope?: unknown): GoalHorizonVerdict {
  const rawNodes = recordOf(graph)?.nodes;
  const goals = Array.isArray(rawNodes) ? rawNodes.map(recordOf).filter((node): node is Rec =>
    node !== undefined && node.kind === 'goal') : [];
  const goal = goals.length === 1 ? goals[0] : undefined;
  if (goal === undefined || !Number.isInteger(goal.goal_horizon_months)
    || (goal.goal_horizon_months as number) <= 0) return 'no_horizon';
  if (accumulationTestedAtGoalHorizon(graph, envelope)) return 'computed_at_h';
  return horizonSteadyAttested(goal) ? 'steady_attested' : 'withhold';
}
