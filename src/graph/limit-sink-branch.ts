/**
 * ⭐ A LIMITED TERMINAL AND ALL ITS ANCESTORS ARE A SINK WHEN A LEVER REACHES IT — THE ONE DEFINITION, read by
 * readiness (`graph-structure-validator.ts` loop 2, `NO_PATH_TO_GOAL`) and by admission's "cannot reach the goal"
 * ledger (`admit-model.ts` `sayUnreached`, which the Agent raises as "connect it to the goal").
 *
 * Served cut-costs (`9f75612`, guest `15f48f0b`; R3 #75 5903589565): the drafter routed migration downtime only into the
 * limit it exists for ("≤ 2 weeks") — downtime is not a cause of the bill — and every Run was blocked. A live arm on
 * the corrected drafter prompt then drew downtime's own uncertain causes as roots ("Migration complexity", observable,
 * no parent). AIQ 5903604206 and the DL lease 5903604509: a `goal_constraints` node and its ancestors are a sink.
 *
 * A node is in the returned set when a limited node (named by a limit) has NO outgoing edge (a terminal) and at least
 * one parent, a lever (an option or a controllable factor) is among its ancestors (the decision moves it), and the node
 * is that limited node or one of its ancestors. Any other dead end is not in it: one reaching no limit, a limited node
 * with an onward edge that misses the goal, or a limited island no lever reaches. Pure; `edges` are directed.
 */
export function limitSinkBranch(
  nodes: readonly { readonly id: string; readonly kind?: unknown; readonly category?: unknown }[],
  edges: readonly { readonly from: string; readonly to: string }[],
  limitNodeIds: Iterable<string>,
): Set<string> {
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const isLever = (id: string): boolean => {
    const n = byId.get(id);
    return n !== undefined && (n.kind === 'option' || (n.kind === 'factor' && n.category === 'controllable'));
  };
  const parentsOf = new Map<string, string[]>();
  for (const e of edges) parentsOf.set(e.to, [...(parentsOf.get(e.to) ?? []), e.from]);
  const sink = new Set<string>();
  for (const id of new Set(limitNodeIds)) {
    if (!byId.has(id)) continue;
    if (edges.some((e) => e.from === id)) continue;
    if ((parentsOf.get(id) ?? []).length === 0) continue;
    const ancestors = new Set<string>([id]);
    const walk = [...(parentsOf.get(id) ?? [])];
    while (walk.length > 0) {
      const at = walk.pop()!;
      if (ancestors.has(at)) continue;
      ancestors.add(at);
      walk.push(...(parentsOf.get(at) ?? []));
    }
    // The decision moves it: a lever among its ancestors. A limited island nothing the options change reaches is not.
    if (![...ancestors].some((a) => a !== id && isLever(a))) continue;
    for (const a of ancestors) sink.add(a);
  }
  return sink;
}
