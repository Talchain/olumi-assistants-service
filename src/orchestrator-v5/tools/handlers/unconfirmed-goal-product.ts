/**
 * ⛔ A GRAPH SAVED BEFORE #2300 CANNOT BUY A GOAL CHANCE BY BEING OLD (DL #72 5893532787; R3 acceptance 5893378853).
 *
 * FORK (iii) (AIQ 5891608873, DL 5891633125): every goal product Olumi derives stays `stated_in_brief: false` until the
 * user's Yes on the card, and PLoT #420's variant (d) withholds every goal figure resting on it ("Not shown. Olumi reads
 * 'MRR' as 'Pro plan price' × 'Paying subscribers', but that hasn't been confirmed…"). #2300 mints that reading at
 * CONSTRUCTION, so a graph saved before it carries NO identity at all, and its Run takes the linear walk: served `77afc7b`
 * re-run of saved Run `c96fc4bb` (£49 × 1,500 ≈ £75k, the card's own domain) shipped 14 goal-chance fields.
 *
 * This carries Olumi's reading on the WIRE copy only, as the same unconfirmed product #2300 would have minted
 * (`stated_in_brief: false`), exactly where the card would offer it: the ONE detector the card uses
 * (`proposeProductIdentity`, #2296) on the STORED graph. PLoT then withholds through #420's carrier with its words, and
 * the reason reaches the read and a cold reload the way every withheld Run's does. Nothing is persisted: the stored graph,
 * `graph_hash_at_run` (hashed from the raw persisted graph) and the card are untouched, and no user declaration is minted.
 * A goal that already carries an identity is never touched: a user-stated or confirmed product makes the detector
 * return null (its chance is the user's), and Olumi's own unconfirmed product already reaches PLoT as it is. Pure.
 */
import { proposeProductIdentity } from '../../agent-lane/identity-proposal.js';

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The unconfirmed goal product to carry on the wire, or null: the card's reading on a goal that carries no identity. */
export function unconfirmedGoalProductFor(storedGraph: unknown): { goal_id: string; factor_ids: readonly [string, string] } | null {
  const reading = proposeProductIdentity(storedGraph);
  if (reading === null || reading.operation !== 'product' || !isRec(storedGraph) || !Array.isArray(storedGraph.nodes)) return null;
  const goal = storedGraph.nodes.find((n): n is Rec => isRec(n) && n.id === reading.outcome_id);
  if (goal === undefined || (goal.nonlinear_identity !== undefined && goal.nonlinear_identity !== null)) return null;
  return { goal_id: reading.outcome_id, factor_ids: reading.factor_ids };
}

/**
 * The wire graph with the stored graph's unconfirmed goal product carried on its goal node, or `graph` itself when there
 * is none, or when the wire goal already carries an identity.
 */
export function carryUnconfirmedGoalProduct<G>(graph: G, storedGraph: unknown): G {
  const product = unconfirmedGoalProductFor(storedGraph);
  if (product === null || !isRec(graph) || !Array.isArray(graph.nodes)) return graph;
  let carried = false;
  const nodes = graph.nodes.map((n: unknown) => {
    if (!isRec(n) || n.id !== product.goal_id || (n.nonlinear_identity !== undefined && n.nonlinear_identity !== null)) return n;
    carried = true;
    return { ...n, nonlinear_identity: { operation: 'product', factor_ids: [...product.factor_ids], stated_in_brief: false } };
  });
  return carried ? ({ ...graph, nodes } as G) : graph;
}
