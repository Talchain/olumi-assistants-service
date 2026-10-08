/**
 * ⭐ A RISK NOBODY HAS SAID THE DIRECTION OF IS LEFT OUT OF THE ANALYSIS, NEVER A BLOCK ON IT — THE ONE DEFINITION, read
 * by readiness (`graph-structure-validator.ts`: the orphan check and loop 2, `NO_PATH_TO_GOAL`), admission's ledger
 * (`admit-model.ts`, said as "left out of this analysis") and the Agent's structural facts (`structural-facts.ts`).
 *
 * T2 (MG #85, CEE ccfb1655) K3 rep 1, the brief saying the effect of service-quality problems is "unknown": admission
 * rightly withholds the risk → goal link it will not guess (`no_authored_direction`; #63 5793252993: ask, never default),
 * and the kept risk — its cause still drawn into it — then blocked the WHOLE Run ("A part of the model cannot reach the
 * goal"). A risk with no stated way of moving anything onward changes no option's result, so the Run proceeds without it
 * while it is kept, named, and asked about (MG lease 5945974225; DL GO).
 *
 * In the set: a RISK with at least one cause drawn into it and no outgoing directed edge, that no option acts on (no
 * option → it edge) and no limit names; and any other node EVERY outgoing edge of which ends in the set (an exogenous
 * cause drawn only into that risk) — never a lever (an option or a controllable factor), a node an option acts on, a
 * limited node, a decision or the goal. A risk with NO edge at all stays an orphan unless CEE stamped it `relies_on` an
 * existing option: that option's precondition cannot yet be modelled on that option alone (RC3 a′). The identity stamp,
 * zero incidence (including bidirected edges), and absence of a named limit are ALL required. The same predicate is
 * read by readiness, the edit/apply structural referee, structural facts, the host's disclosure and the Run projection.
 * An unstamped zero-edge risk stays an orphan, as before (the
 * dual-draft guard G12 refuses an enrichment that adds one: `cee/dual-draft/guards.ts`). Any other dead end is still
 * refused. Pure; K3's cause/path logic reads directed edges only.
 */
import { CANONICAL_ID_REGEX } from '../cee/utils/id-normalizer.js';

type RiskNodeLike = {
  readonly id: string;
  readonly kind?: unknown;
  readonly category?: unknown;
  readonly relies_on?: unknown;
};
type RiskEdgeLike = { readonly from: string; readonly to: string; readonly edge_type?: unknown };

/** RC3 a′: identity-keyed server stamp, never an exemption inferred from dead-end shape. */
export function preconditionRiskIds(
  nodes: readonly RiskNodeLike[],
  edges: readonly RiskEdgeLike[],
  limitNodeIds: Iterable<string>,
): Set<string> {
  const counts = new Map<string, number>();
  for (const n of nodes) counts.set(n.id, (counts.get(n.id) ?? 0) + 1);
  const options = new Set(nodes.filter((n) => n.kind === 'option' && counts.get(n.id) === 1).map((n) => n.id));
  const touched = new Set(edges.flatMap((e) => [e.from, e.to]));
  const limits = new Set(limitNodeIds);
  return new Set(nodes.filter((n) => {
    const stamp = n.relies_on;
    if (n.kind !== 'risk' || counts.get(n.id) !== 1 || !CANONICAL_ID_REGEX.test(n.id)
      || stamp === null || typeof stamp !== 'object' || Array.isArray(stamp) || Object.keys(stamp).length !== 1
      || touched.has(n.id) || limits.has(n.id)) return false;
    const optionId = (stamp as { option_id?: unknown }).option_id;
    return typeof optionId === 'string' && CANONICAL_ID_REGEX.test(optionId) && options.has(optionId);
  }).map((n) => n.id));
}

/**
 * Compute-only projection. Eligibility is read from the saved model, before another wire projection drops edges/options.
 * `ref_high_water` is the display-reference allocator, never a causal input. Omit it uniformly, including on a graph
 * with no precondition risks: the first real Add issues R1 and raises R's saved counter, and retaining that counter
 * after omitting its risk would still change the Run wire/digests. Never reconstruct issuance history or lower the
 * saved counter (retired refs must never be reused). All remaining node refs, including actual causal risks and
 * options, stay byte-for-byte intact; this copy is never persisted. Run and the counterfactual reader both use it.
 */
export function withoutPreconditionRisks<T>(graph: T, identityGraph: unknown = graph): T {
  if (graph === null || typeof graph !== 'object' || Array.isArray(graph)) return graph;
  if (identityGraph === null || typeof identityGraph !== 'object' || Array.isArray(identityGraph)) return graph;
  const g = graph as { nodes?: readonly RiskNodeLike[] };
  const identity = identityGraph as { nodes?: readonly RiskNodeLike[]; edges?: readonly RiskEdgeLike[]; goal_constraints?: readonly { node_id?: unknown }[] };
  if (!Array.isArray(g.nodes) || !Array.isArray(identity.nodes) || !Array.isArray(identity.edges)) return graph;
  const limits = (identity.goal_constraints ?? []).flatMap((c) => typeof c.node_id === 'string' ? [c.node_id] : []);
  const leftOut = preconditionRiskIds(identity.nodes, identity.edges, limits);
  if (leftOut.size === 0) return graph;
  // The display-ref allocator stays (stored Runs digest it, Codex r2 P2). Only the risk counter steps back past refs
  // that the left-out risks themselves took at the top, so approving one never changes the next Run's inputs.
  const removedR = new Set(g.nodes.flatMap((n) => {
    const m = leftOut.has(n.id) && typeof (n as { ref?: unknown }).ref === 'string' ? /^R(\d+)$/.exec((n as { ref: string }).ref) : null;
    return m === null ? [] : [Number(m[1])];
  }));
  const allocator = (graph as { ref_high_water?: unknown }).ref_high_water;
  let refHighWater = allocator;
  if (allocator !== null && typeof allocator === 'object' && !Array.isArray(allocator) && typeof (allocator as { R?: unknown }).R === 'number') {
    let r = (allocator as { R: number }).R;
    while (r > 0 && removedR.has(r)) r -= 1;
    const { R: _r, ...rest } = allocator as Record<string, unknown>;
    refHighWater = r > 0 ? { ...rest, R: r } : rest;
  }
  const nodes = g.nodes.filter((n) => !leftOut.has(n.id));
  return (refHighWater === allocator ? { ...graph, nodes } : { ...graph, nodes, ref_high_water: refHighWater }) as T;
}

export function inertRiskBranch(
  nodes: readonly RiskNodeLike[],
  edges: readonly RiskEdgeLike[],
  limitNodeIds: Iterable<string>,
): Set<string> {
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const limits = new Set(limitNodeIds);
  const directed = edges.filter((e) => e.edge_type !== 'bidirected');
  const actedOn = new Set(directed.filter((e) => byId.get(e.from)?.kind === 'option').map((e) => e.to));
  const onward = new Map<string, string[]>();
  for (const e of directed) onward.set(e.from, [...(onward.get(e.from) ?? []), e.to]);
  const free = (id: string): boolean => !actedOn.has(id) && !limits.has(id);
  const hasCause = new Set(directed.map((e) => e.to));
  const branch = new Set(nodes
    .filter((n) => n.kind === 'risk' && n.relies_on === undefined && hasCause.has(n.id) && (onward.get(n.id) ?? []).length === 0 && free(n.id))
    .map((n) => n.id));
  for (const id of preconditionRiskIds(nodes, edges, limits)) branch.add(id);
  const mayJoin = (n: (typeof nodes)[number]): boolean => n.kind !== 'option' && n.kind !== 'decision' && n.kind !== 'goal'
    && !(n.kind === 'risk' && n.relies_on !== undefined)
    && !(n.kind === 'factor' && n.category === 'controllable') && free(n.id);
  for (let grew = branch.size > 0; grew;) {
    grew = false;
    for (const n of nodes) {
      const next = onward.get(n.id) ?? [];
      if (branch.has(n.id) || next.length === 0 || !mayJoin(n) || !next.every((to) => branch.has(to))) continue;
      branch.add(n.id);
      grew = true;
    }
  }
  return branch;
}
