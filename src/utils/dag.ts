import type { GraphT } from "../schemas/graph.js";

export function isDAG(g: GraphT): boolean {
  const adj = new Map<string, string[]>();
  g.edges.forEach((e) => adj.set(e.from, [...(adj.get(e.from) || []), e.to]));
  const temp = new Set<string>();
  const perm = new Set<string>();
  const visit = (n: string): boolean => {
    if (perm.has(n)) return true;
    if (temp.has(n)) return false;
    temp.add(n);
    for (const m of adj.get(n) || []) if (!visit(m)) return false;
    temp.delete(n);
    perm.add(n);
    return true;
  };
  return g.nodes.every((n) => visit(n.id));
}

export function pruneIsolates(g: GraphT): GraphT {
  const connected = new Set<string>();
  g.edges.forEach((e) => {
    connected.add(e.from);
    connected.add(e.to);
  });
  const nodes = g.nodes.filter((n) => connected.has(n.id));
  const meta = {
    ...g.meta,
    roots: nodes.map((n) => n.id).filter((id) => !g.edges.some((e) => e.to === id)),
    leaves: nodes.map((n) => n.id).filter((id) => !g.edges.some((e) => e.from === id))
  };
  return { ...g, nodes, meta };
}
