/** Science §(o′)/(ad): exact horizon detail, populated only by typed graph facts. */
import { heldGoalHorizonMonths } from './goal-horizon-verdict.js';
import { NodeV3 } from '../../schemas/cee-v3.js';

type Rec = Record<string, unknown>;
const rec = (value: unknown): Rec | undefined => value !== null && typeof value === 'object'
  && !Array.isArray(value) ? value as Rec : undefined;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function horizonGoal(graph: unknown): { goal: Rec; nodes: Rec[]; month: number } | undefined {
  const rawNodes = rec(graph)?.nodes;
  const nodes = Array.isArray(rawNodes) ? rawNodes.map(rec).filter((node): node is Rec => node !== undefined) : [];
  const goals = nodes.filter(node => node.kind === 'goal');
  const month = heldGoalHorizonMonths(goals[0]);
  return goals.length === 1 && month !== undefined
    ? { goal: goals[0]!, nodes, month } : undefined;
}

/**
 * The carrier's positional operands are [count today, leave share per month, additions per month]. No label or unit
 * text assigns a role. Without that typed carrier, the factual opening stands alone rather than guessing missing slots.
 */
export function goalHorizonWithholdDetail(graph: unknown): string | null {
  const held = horizonGoal(graph);
  if (held === undefined) return null;
  const { goal, nodes, month } = held;
  const opening = `Your goal is for month ${month}, and this model only has today's numbers.`;
  const product = NodeV3.shape.nonlinear_identity.safeParse(goal.nonlinear_identity).data;
  if (product?.operation !== 'product' || !Array.isArray(product.factor_ids)) return opening;
  const carriers = product.factor_ids.flatMap(id => {
    const node = nodes.find(candidate => candidate.id === id);
    const identity = NodeV3.shape.nonlinear_identity.safeParse(node?.nonlinear_identity).data;
    return identity?.operation === 'accumulation' && identity.horizon_months === month
      && Array.isArray(identity.factor_ids) && identity.factor_ids.length === 3
      && identity.factor_ids.every(id => typeof id === 'string' && id !== '')
      && new Set(identity.factor_ids).size === 3 ? [{ identity }] : [];
  });
  if (carriers.length !== 1) return opening;
  const ids = carriers[0]!.identity.factor_ids as string[];
  const stock = nodes.find(node => node.id === ids[0]);
  if (typeof stock?.label !== 'string' || stock.label.trim() === '') return opening;
  const missing = (index: number): boolean => {
    const state = rec(nodes.find(node => node.id === ids[index])?.observed_state);
    // The accumulation input reader gives a present raw number authority over the framed value.
    return !finite(typeof state?.raw_value === 'number' ? state.raw_value : state?.value);
  };
  const slots = [
    ...(missing(2) ? ['how many sign up each month'] : []),
    ...(missing(1) ? ['what share leave each month'] : []),
    ...(missing(0) ? ['how many there are today'] : []),
  ];
  return slots.length === 0 ? opening
    : `${opening} To work out month ${month}, Olumi needs how ‘${stock.label.trim()}’ changes each month: ${slots.join(' / ')}.`;
}

/** User attestation is licensed by goalHorizonVerdict; this helper owns its verbatim Why? sentence. */
export function goalHorizonSteadyWhyLine(graph: unknown): string | null {
  const held = horizonGoal(graph);
  if (held === undefined || typeof held.goal.label !== 'string' || held.goal.label.trim() === '') return null;
  return `You said ‘${held.goal.label.trim()}’ stays about where it is over ${held.month} months unless you act, so this is its chance once each option is in effect.`;
}
