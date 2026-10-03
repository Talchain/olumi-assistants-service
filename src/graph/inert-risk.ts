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
 * limited node, a decision or the goal. A risk with NO edge at all states nothing and stays an orphan, as before (the
 * dual-draft guard G12 refuses an enrichment that adds one: `cee/dual-draft/guards.ts`). Any other dead end is still
 * refused. Pure; `edges` are directed.
 */
export function inertRiskBranch(
  nodes: readonly { readonly id: string; readonly kind?: unknown; readonly category?: unknown }[],
  edges: readonly { readonly from: string; readonly to: string }[],
  limitNodeIds: Iterable<string>,
): Set<string> {
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const limits = new Set(limitNodeIds);
  const actedOn = new Set(edges.filter((e) => byId.get(e.from)?.kind === 'option').map((e) => e.to));
  const onward = new Map<string, string[]>();
  for (const e of edges) onward.set(e.from, [...(onward.get(e.from) ?? []), e.to]);
  const free = (id: string): boolean => !actedOn.has(id) && !limits.has(id);
  const hasCause = new Set(edges.map((e) => e.to));
  const branch = new Set(nodes
    .filter((n) => n.kind === 'risk' && hasCause.has(n.id) && (onward.get(n.id) ?? []).length === 0 && free(n.id))
    .map((n) => n.id));
  const mayJoin = (n: (typeof nodes)[number]): boolean => n.kind !== 'option' && n.kind !== 'decision' && n.kind !== 'goal'
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
