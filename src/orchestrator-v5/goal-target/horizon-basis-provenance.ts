import { horizonBasisWriteIsAuthorised, type HorizonBasisWrite } from './goal-steady-write.js';

/** Prepare the caller's postimage before deriving any hash or hash-bound sidecar.
 * Missing/null server base supplies no authority: submitted answers are dropped.
 */
export function prepareHorizonBasisForWrite(
  graph: unknown, stored: unknown, scenarioId: string, authorisation?: HorizonBasisWrite,
): void {
  const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (authorisation !== undefined && !horizonBasisWriteIsAuthorised(authorisation, stored, scenarioId)) {
    throw new Error('horizon_basis write authorisation is invalid');
  }
  if (!record(graph) || !Array.isArray(graph.nodes)) {
    if (authorisation !== undefined) throw new Error('horizon_basis authorised goal is absent');
    return;
  }
  if (authorisation !== undefined && graph.nodes.filter(n => record(n) && n.kind === 'goal' && n.id === authorisation.goal_id).length !== 1) {
    throw new Error('horizon_basis authorised goal is absent or ambiguous');
  }
  const storedNodes = record(stored) && Array.isArray(stored.nodes) ? structuredClone(stored.nodes).filter(record) : [];
  for (const node of graph.nodes) {
    if (!record(node)) continue;
    delete node.horizon_basis;
    if (node.kind !== 'goal') continue;
    if (authorisation !== undefined && node.id === authorisation.goal_id) {
      node.horizon_basis = structuredClone(authorisation.value);
    } else {
      const matches = storedNodes.filter(n => n.kind === 'goal' && n.id === node.id);
      if (matches.length === 1 && matches[0]!.horizon_basis !== undefined) {
        node.horizon_basis = structuredClone(matches[0]!.horizon_basis);
      }
    }
  }
}

/** Assert the prepared fixed point without modifying graph, stored base or capability. */
export function assertDoorProvenance(
  graph: unknown, stored: unknown, scenarioId: string, authorisation?: HorizonBasisWrite,
): void {
  const prepared = structuredClone(graph);
  prepareHorizonBasisForWrite(prepared, stored, scenarioId, authorisation);
  const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (!record(graph) || !Array.isArray(graph.nodes) || !record(prepared) || !Array.isArray(prepared.nodes)) return;
  for (let i = 0; i < graph.nodes.length; i += 1) {
    const node: unknown = graph.nodes[i], expected: unknown = prepared.nodes[i];
    if (record(node) && record(expected) && JSON.stringify(node.horizon_basis) !== JSON.stringify(expected.horizon_basis)) {
      throw new Error('horizon_basis graph write is not prepared from stored provenance');
    }
  }
}

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
