import { storedReadingOf } from '../agent-lane/identity-proposal.js';
import { stripInboundReadingLicence } from './reading-licence-ingress.js';

type Rec = Record<string, unknown>;
const rec = (x: unknown): x is Rec => x !== null && typeof x === 'object' && !Array.isArray(x);
const nodesOf = (g: unknown): Rec[] => rec(g) && Array.isArray(g.nodes) ? g.nodes.filter(rec) : [];
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** DL conditions 1/2: pure outbound stamp, minted afresh after removing any inherited authority. */
export function stampGoalReading<G>(graph: G, storedGraph: unknown): G {
  const clean = stripInboundReadingLicence(graph);
  const reading = storedReadingOf(storedGraph);
  if (reading === null || !rec(clean) || !Array.isArray(clean.nodes)) return clean;
  const goal = nodesOf(clean).find(n => n.id === reading.goal.id);
  const identity = goal?.nonlinear_identity;
  if (!rec(identity) || identity.operation !== 'product' || identity.stated_in_brief !== false
    || !Array.isArray(identity.factor_ids) || identity.factor_ids.length !== 2
    || !reading.factors.every(f => (identity.factor_ids as unknown[]).includes(f.id))) return clean;
  // Recheck the actual participating wire, not merely an earlier stored graph. No competing/vetoed parent may survive.
  const actual = storedReadingOf(clean);
  if (actual === null || actual.goal.id !== reading.goal.id
    || !actual.factors.every(f => reading.factors.some(r => r.id === f.id))
    || actual.addends.length !== reading.addends.length || !actual.addends.every(a => reading.addends.some(r => r.id === a.id))) return clean;
  const storedGoal = nodesOf(storedGraph).find(n => n.id === reading.goal.id);
  const original = rec(storedGoal?.nonlinear_identity) ? storedGoal.nonlinear_identity : undefined;
  const listed = original?.addends;
  const byId = new Map(nodesOf(clean).map(n => [n.id, n]));
  const sized = (id: string): boolean => {
    const os = byId.get(id)?.observed_state;
    return rec(os) && (finite(os.value) || finite(os.baseline));
  };
  // Science addendum 4 case (1): a listed levelless operand cannot be evaluated. Never silently repair that definition.
  if (listed !== undefined && (!Array.isArray(listed) || listed.some(id => typeof id !== 'string' || !sized(id)))) return clean;
  // Case (2): levelless definitional parents remain LINEAR parents L, never listed operands A.
  const addends = reading.addends.filter(a => sized(a.id)).map(a => a.id);
  return { ...clean, nodes: clean.nodes.map(n => rec(n) && n.id === reading.goal.id
    ? { ...n, nonlinear_identity: { ...identity, reading_licence: 'olumi_reading', addends } } : n) } as G;
}
