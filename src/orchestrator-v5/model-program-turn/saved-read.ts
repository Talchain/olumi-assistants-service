/**
 * The saved scenario, read afresh, and the check that a write is held in it. The program's save path (`program-save.ts`,
 * `core-write.ts`) needs only these, so they live apart from the Living Model's reader (`context-tool.ts`) and its draft
 * replacement (`draft-replacement.ts`), which go with the legacy families (ALPHA-CODE-INVENTORY §1 F0).
 */
import type { InternalDispatch } from '../core-route/internal-dispatch.js';
import { FRESH_READ } from '../agent-lane/turn-read-cache.js';
import { normaliseGraphForIdentity } from '../context/graph-identity-normalise.js';
import { refused, unavailable, type ToolOutcome } from '../path-b/tools/outcome.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** The saved scenario as the product's graph route returns it: the FULL graph, for mutation and readback. */
export interface SavedRead {
  readonly json: Rec;
  readonly graph: Rec;
  readonly graphHash: string;
  readonly identity: string | null;
}

/** ONE fresh read of the saved scenario. The full graph stays internal; `readCanonicalContext` is the AI's view of it. */
export async function readSaved(deps: { readonly dispatch: InternalDispatch }, scenarioId: string): Promise<SavedRead | ToolOutcome> {
  let r: Awaited<ReturnType<InternalDispatch>>;
  try {
    r = await deps.dispatch(`/assist/v1/scenarios/${scenarioId}/graph`, { ...FRESH_READ });
  } catch {
    return unavailable('read_failed');
  }
  if (r.status === 404) return refused('not_found');
  if (r.status !== 200) return unavailable('read_failed', 'none', `HTTP ${r.status}`);
  // A NEW scenario reads `graph: null, graph_present: false` (assist.v1.scenario-graph.ts: "An EMPTY graph is a valid answer"):
  // no model yet, a valid state, never malformed. A non-null read that is not a graph stays malformed.
  if (r.json.graph === null && r.json.graph_present === false) return refused(NO_MODEL_YET);
  const graphHash = str(r.json.graph_hash);
  if (graphHash === null || !isRec(r.json.graph)) return unavailable('read_malformed');
  const identity = isRec(r.json.graph_identity_hash) ? str(r.json.graph_identity_hash.value) : str(r.json.graph_identity_hash);
  return { json: r.json, graph: r.json.graph, graphHash, identity };
}
export const isSavedRead = (v: SavedRead | ToolOutcome): v is SavedRead => 'graphHash' in v;
export const NO_MODEL_YET = 'no_model_yet';
/** The scenario has no model yet: the draft proceeds, the AI's view is empty, and a change says there is nothing to change. */
export const isNoModelYet = (v: SavedRead | ToolOutcome): boolean => !isSavedRead(v) && v.status === 'refused' && v.reason === NO_MODEL_YET;

/**
 * ⛔ THE STORED GRAPH HOLDS THE WHOLE APPROVED CANDIDATE (AIE B34 6119577581: the read-back matching the registration's
 * acknowledgement proves only that the acknowledged graph was read back). Through the canonical identity normaliser
 * (`normaliseGraphForIdentity`), every component the candidate carries — each node, link, option, limit and target, and
 * each of their fields — is held UNCHANGED in the stored graph, and no node, link or row is added beside them. The register
 * route may only ADD fields of its own (its stable `ref` on each node: measured on the REAL route for Paul's L20 candidate,
 * `assist.v1.scenario-graph-register.revised-draft-held.test.ts`). A component omitted or changed BEFORE the
 * acknowledgement fails here even when the read-back agrees with that acknowledgement.
 *
 * ⛔ A NODE'S DISPLAY `ref` IS THE ROUTE'S OWN, ADDED OR RE-ASSIGNED, NEVER THE APPROVED MEANING (P11, proof 2, 18 Oct,
 * scenario 75bc9a57: the reframe landed — revision 2→3, a new hash — and the receipt said "could not be confirmed"; the only
 * difference was the demoted goal's "G1", re-assigned to the new aim). Compared without it; every other field still counts.
 */
export function approvedGraphHeld(candidate: unknown, stored: unknown): boolean {
  const a = withoutDisplayRefs(normaliseGraphForIdentity(candidate as never)?.graph);
  const b = withoutDisplayRefs(normaliseGraphForIdentity(stored as never)?.graph);
  return a !== undefined && b !== undefined && heldUnchanged(a, b);
}

function withoutDisplayRefs<G>(graph: G | undefined): G | undefined {
  const nodes = (graph as { nodes?: unknown } | undefined)?.nodes;
  if (graph === undefined || !Array.isArray(nodes)) return graph;
  return { ...graph, nodes: nodes.map((n) => { if (!isRec(n)) return n; const { ref: _ref, ...rest } = n; return rest; }) };
}

const entityKey = (x: unknown): string | undefined => {
  const k = isRec(x) ? x.id ?? x.constraint_id : undefined;
  return typeof k === 'string' ? k : undefined;
};
/** `a` held in `b`: the same members (by id where every member has one), each field of `a` equal in `b`; `b` may add fields only. */
function heldUnchanged(a: unknown, b: unknown): boolean {
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    const keys = a.map(entityKey);
    if (keys.every((k) => k !== undefined) && new Set(keys).size === keys.length) {
      const byKey = new Map(b.map((x) => [entityKey(x), x] as const));
      return a.every((x, i) => byKey.has(keys[i]) && heldUnchanged(x, byKey.get(keys[i])));
    }
    return a.every((x, i) => heldUnchanged(x, b[i]));
  }
  if (a !== null && typeof a === 'object') {
    if (b === null || typeof b !== 'object' || Array.isArray(b)) return false;
    return Object.entries(a as Record<string, unknown>)
      .every(([k, v]) => Object.prototype.hasOwnProperty.call(b, k) && heldUnchanged(v, (b as Record<string, unknown>)[k]));
  }
  return a === b;
}
