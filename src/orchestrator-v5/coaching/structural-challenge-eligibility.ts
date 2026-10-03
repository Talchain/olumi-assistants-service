/**
 * SCI-DEEP v1 — WHICH LINKS "Test without this link" MAY REMOVE, and what the removal can reach.
 * (PTL ruling programme-docs #87/5972622586; contract @talchain/schemas 0.76.0 `StructuralChallengeResultV1`.)
 *
 * PURE. Reads the canonical graph the selected Run was computed on (the same object `run_analysis` sends) and decides,
 * from graph facts alone, whether deleting ONE link is a fair alternative representation of the same model. Each refusal
 * is a typed contract reason, never a fabricated answer. Evidence for every rule (programme-docs
 * output/sci-deep-20261003, executed on ISL f759de5):
 *
 *   option_wiring_link        decision/option wiring is how options SET factors, not a belief about the world;
 *                             deleting it changes what an option means.
 *   bidirected_link           an unmeasured common cause is a trust annotation, never simulated.
 *   identity_participant_link an operand/addend edge of a nonlinear identity is a DEFINITION (ISL never reads its
 *                             strength); removing it is a 422 at ISL.
 *   anchored_identity_target  any other edge into an identity node changes the identity's single scale k, which
 *                             rescales every operand — a different model, not the same one without a link.
 *   target_becomes_root       if the target would keep no causal parent, ISL re-reads it at its OBSERVED level
 *                             instead of as a composition (P-b: goal 0.0 when zeroed vs 0.3 when removed; live p4: the
 *                             churn constraint 0.87 -> 0.55 for that reason alone). The comparison would measure a
 *                             change of meaning, not the link.
 *
 * Parents are counted among INFERENCE nodes only: decision/option nodes are filtered out before simulation, so a factor
 * whose only parents are options is already a root.
 */

export interface ChallengeLink {
  readonly from_id: string;
  readonly to_id: string;
}

export type StructuralChallengeIneligibleReason =
  | 'link_not_found'
  | 'option_wiring_link'
  | 'bidirected_link'
  | 'identity_participant_link'
  | 'anchored_identity_target'
  | 'target_becomes_root';

export type StructuralChallengeEligibility =
  | {
      readonly eligible: true;
      /** The removed link's target and every node it reaches: the only quantities the removal can move. */
      readonly reachable: ReadonlySet<string>;
    }
  | { readonly eligible: false; readonly reason: StructuralChallengeIneligibleReason };

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Node kinds removed before simulation: option wiring, not causal structure. */
const WIRING_KINDS = new Set(['decision', 'option']);

interface GraphView {
  readonly kinds: ReadonlyMap<string, string | undefined>;
  readonly identities: ReadonlyMap<string, ReadonlySet<string>>;
  readonly directed: ReadonlyArray<ChallengeLink>;
  readonly bidirected: ReadonlyArray<ChallengeLink>;
}

function endpoint(edge: Rec, a: 'from' | 'to'): string | null {
  const v = edge[a] ?? edge[`${a}_id`];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function viewOf(graph: unknown): GraphView {
  const g = isRec(graph) ? graph : {};
  const nodes = Array.isArray(g.nodes) ? g.nodes.filter(isRec) : [];
  const edges = Array.isArray(g.edges) ? g.edges.filter(isRec) : [];
  const kinds = new Map<string, string | undefined>();
  const identities = new Map<string, ReadonlySet<string>>();
  for (const n of nodes) {
    if (typeof n.id !== 'string') continue;
    kinds.set(n.id, typeof n.kind === 'string' ? n.kind : undefined);
    const identity = n.nonlinear_identity;
    if (isRec(identity)) {
      const ids = new Set<string>();
      for (const id of Array.isArray(identity.factor_ids) ? identity.factor_ids : []) if (typeof id === 'string') ids.add(id);
      for (const a of Array.isArray(identity.addends) ? identity.addends : []) {
        if (typeof a === 'string') ids.add(a);
        else if (isRec(a) && typeof a.node_id === 'string') ids.add(a.node_id);
        else if (isRec(a) && typeof a.id === 'string') ids.add(a.id);
      }
      identities.set(n.id, ids);
    }
  }
  const directed: ChallengeLink[] = [];
  const bidirected: ChallengeLink[] = [];
  for (const e of edges) {
    const from = endpoint(e, 'from');
    const to = endpoint(e, 'to');
    if (from === null || to === null) continue;
    (e.edge_type === 'bidirected' ? bidirected : directed).push({ from_id: from, to_id: to });
  }
  return { kinds, identities, directed, bidirected };
}

const same = (a: ChallengeLink, b: ChallengeLink) => a.from_id === b.from_id && a.to_id === b.to_id;
const isWiring = (view: GraphView, id: string) => WIRING_KINDS.has(view.kinds.get(id) ?? '');

/** Every node reachable from `start` along directed causal links (start included). */
export function reachableFrom(graph: unknown, start: string): Set<string> {
  const view = viewOf(graph);
  const out = new Set<string>([start]);
  const stack = [start];
  while (stack.length > 0) {
    const at = stack.pop() as string;
    for (const l of view.directed) {
      if (l.from_id === at && !out.has(l.to_id)) {
        out.add(l.to_id);
        stack.push(l.to_id);
      }
    }
  }
  return out;
}

export function structuralChallengeEligibility(graph: unknown, link: ChallengeLink): StructuralChallengeEligibility {
  const view = viewOf(graph);
  if (!view.directed.some((l) => same(l, link))) {
    const bi = view.bidirected.some((l) => same(l, link) || same(l, { from_id: link.to_id, to_id: link.from_id }));
    return { eligible: false, reason: bi ? 'bidirected_link' : 'link_not_found' };
  }
  if (isWiring(view, link.from_id) || isWiring(view, link.to_id)) return { eligible: false, reason: 'option_wiring_link' };
  const identity = view.identities.get(link.to_id);
  if (identity !== undefined) {
    return { eligible: false, reason: identity.has(link.from_id) ? 'identity_participant_link' : 'anchored_identity_target' };
  }
  const remainingParents = new Set(
    view.directed
      .filter((l) => l.to_id === link.to_id && l.from_id !== link.from_id && !isWiring(view, l.from_id))
      .map((l) => l.from_id),
  );
  if (remainingParents.size === 0) return { eligible: false, reason: 'target_becomes_root' };
  return { eligible: true, reachable: reachableFrom(graph, link.to_id) };
}

/** A copy of `graph` without the directed link (every parallel copy of it); nothing else changes. */
export function graphWithoutLink<T>(graph: T, link: ChallengeLink): T {
  if (!isRec(graph) || !Array.isArray(graph.edges)) return graph;
  return {
    ...graph,
    edges: graph.edges.filter((e) => {
      if (!isRec(e) || e.edge_type === 'bidirected') return true;
      return !(endpoint(e, 'from') === link.from_id && endpoint(e, 'to') === link.to_id);
    }),
  } as T;
}
