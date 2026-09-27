/**
 * ⛔ THE USER'S STATED RESPONSE NEVER REACHES THE ENGINE (MG interface 5854594598; AIQ 5854607789).
 *
 * `stated_response` (NodeV3, `schemas/cee-v3.ts`) is what the user SAID one factor of a product does at a price
 * ("at £59 about 30 would leave"). It is a conditional level for Olumi's own arithmetic (AX1, `agent-lane/break-even.ts`),
 * never an input to the causal model: PLoT and ISL must compute exactly what they computed before it existed. Declared on
 * `NodeV3` so it survives every re-parse, it would otherwise ride the run request verbatim — `loadScenarioSnapshotForRunAnalysis`
 * hands the GraphV3-parsed graph to `run_analysis`, which sends it as `graph`.
 *
 * WIRE COPY ONLY, like the other `run_analysis` wire transforms: the stored graph and the analysis hash are untouched.
 * Returns the SAME graph object when no node carries the field, so a graph without it is sent byte for byte as before.
 */
export const STATED_RESPONSE_FIELD = 'stated_response' as const;

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Ids of the nodes that carry a stated response (ids only — no figures are logged). */
export function statedResponseNodeIds(graph: unknown): string[] {
  const nodes = isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes : [];
  return nodes.filter((n): n is Rec => isRec(n) && Object.hasOwn(n, STATED_RESPONSE_FIELD)).map((n) => String(n.id ?? ''));
}

/** The graph with every node's `stated_response` removed; the same object when there is none. */
export function withoutStatedResponse<G>(graph: G): G {
  if (!isRec(graph) || !Array.isArray(graph.nodes)) return graph;
  if (!graph.nodes.some((n) => isRec(n) && Object.hasOwn(n, STATED_RESPONSE_FIELD))) return graph;
  const nodes = graph.nodes.map((n) => {
    if (!isRec(n) || !Object.hasOwn(n, STATED_RESPONSE_FIELD)) return n;
    const { [STATED_RESPONSE_FIELD]: _stated, ...rest } = n;
    return rest;
  });
  return { ...graph, nodes } as G;
}
