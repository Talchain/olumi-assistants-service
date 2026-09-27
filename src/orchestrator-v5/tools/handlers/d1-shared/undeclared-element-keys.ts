/**
 * ⭐ A WRITER THAT REBUILDS FROM A STRICT PARSE KEEPS WHAT IT DOES NOT OWN
 * (writer audit 2026-09-27, #70 5854387709).
 *
 * `NodeV3` / `EdgeV3` are plain `z.object`s: a parse strips every key they do not
 * declare. Writers that take their node and edge arrays from such a parse and then
 * replace the stored arrays erased those keys on EVERY element, not just the one
 * they edited. Served: a registered saved example stores `starterId`, `starterTitle`
 * and `interventionKeys` on its nodes (15/15 on the pricing example), and the first
 * value or link write after the register stripped them. The equality guards that
 * compare the write with the stored bytes then saw a difference on every node and
 * REFUSED legitimate writes (`value_scope_mismatch`,
 * `confirmation_would_change_non_provenance_state`).
 *
 * The rule: for each element that survives the write (nodes by id, edges by
 * from/to), a key the schema does NOT declare and the written element does not
 * carry is copied back from its stored twin. A declared key stays owned by the
 * writer; a removed element has no twin, so nothing is resurrected. Idempotent.
 */
import { EdgeV3, NodeV3 } from '../../../../schemas/cee-v3.js';

const NODE_DECLARED: ReadonlySet<string> = new Set(Object.keys(NodeV3.shape));
const EDGE_DECLARED: ReadonlySet<string> = new Set(Object.keys(EdgeV3.shape));

type Rec = Record<string, unknown>;
const isRec = (x: unknown): x is Rec => x !== null && typeof x === 'object' && !Array.isArray(x);
const edgeKey = (e: Rec): string => `${String(e.from)}\u0000${String(e.to)}`;

function restore<T>(written: T, stored: unknown, declared: ReadonlySet<string>): T {
  if (!isRec(written) || !isRec(stored)) return written;
  let out: Rec | null = null;
  for (const [k, v] of Object.entries(stored)) {
    if (declared.has(k) || Object.prototype.hasOwnProperty.call(written, k)) continue;
    out ??= { ...written };
    out[k] = v;
  }
  return (out ?? written) as T;
}

/** The written arrays, with each surviving element's undeclared keys restored from `storedBase`. */
export function withUndeclaredElementKeysFrom<N, E>(
  storedBase: unknown,
  nodes: ReadonlyArray<N>,
  edges: ReadonlyArray<E>,
): { nodes: N[]; edges: E[] } {
  const storedNodes = isRec(storedBase) && Array.isArray(storedBase.nodes) ? storedBase.nodes : [];
  const storedEdges = isRec(storedBase) && Array.isArray(storedBase.edges) ? storedBase.edges : [];
  const nodeById = new Map<string, unknown>();
  for (const n of storedNodes) if (isRec(n) && typeof n.id === 'string') nodeById.set(n.id, n);
  const edgeByPair = new Map<string, unknown>();
  for (const e of storedEdges) if (isRec(e)) edgeByPair.set(edgeKey(e), e);
  return {
    nodes: nodes.map((n) => (isRec(n) && typeof n.id === 'string' ? restore(n, nodeById.get(n.id), NODE_DECLARED) : n)),
    edges: edges.map((e) => (isRec(e) ? restore(e, edgeByPair.get(edgeKey(e)), EDGE_DECLARED) : e)),
  };
}
