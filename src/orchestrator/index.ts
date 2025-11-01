import type { GraphT } from "../schemas/graph.js";
import { isDAG, pruneIsolates } from "../utils/dag.js";

export function stabiliseGraph(g: GraphT): GraphT {
  const edgesWithIds = g.edges.map((edge, idx) => ({
    ...edge,
    id: edge.id || `${edge.from}::${edge.to}::${idx}`
  }));
  const nodesSorted = [...g.nodes].sort((a, b) => a.id.localeCompare(b.id));
  const edgesSorted = [...edgesWithIds].sort((a, b) => {
    const from = a.from.localeCompare(b.from);
    if (from !== 0) return from;
    const to = a.to.localeCompare(b.to);
    if (to !== 0) return to;
    return (a.id ?? "").localeCompare(b.id ?? "");
  });
  const meta = {
    roots: g.meta?.roots ?? [],
    leaves: g.meta?.leaves ?? [],
    suggested_positions: g.meta?.suggested_positions ?? {},
    source: g.meta?.source ?? "assistant"
  };
  return { ...g, nodes: nodesSorted, edges: edgesSorted, meta };
}

export function ensureDagAndPrune(g: GraphT): GraphT {
  const pruned = pruneIsolates(g);
  if (!isDAG(pruned)) {
    throw new Error("graph_not_dag");
  }
  return pruned;
}
