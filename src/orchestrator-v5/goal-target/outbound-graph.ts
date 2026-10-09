/** Outbound graph only: preserve identity when no proof is present, and never
 * mutate stored/hash bytes. Only nodes carrying a proof (and their basis) copy.
 */
export function toOutboundGraph<T>(graph: T): T {
  if (graph === null || typeof graph !== 'object' || Array.isArray(graph)) return graph;
  const value = graph as Record<string, unknown>;
  if (!Array.isArray(value.nodes)) return graph;
  let nodes = value.nodes;
  for (let i = 0; i < value.nodes.length; i += 1) {
    const node = value.nodes[i];
    if (node === null || typeof node !== 'object' || Array.isArray(node)) continue;
    const basis = node.horizon_basis;
    if (basis === null || typeof basis !== 'object' || Array.isArray(basis) || !Object.hasOwn(basis, 'proof')) continue;
    if (nodes === value.nodes) nodes = value.nodes.slice();
    const publicBasis = { ...basis };
    delete publicBasis.proof;
    nodes[i] = { ...node, horizon_basis: publicBasis };
  }
  return nodes === value.nodes ? graph : { ...value, nodes } as T;
}
